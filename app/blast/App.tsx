import { liveQuery } from 'dexie';
import { useEffect, useMemo, useState } from 'react';
import { IS_FULL } from '../shared/credit';
import type { Contact, Reminder, Template } from '../shared/crm-types';
import { db } from '../shared/db';
import { ScrollTable } from '../shared/ui/ScrollTable';
import { PhoneField } from './PhoneField';
import { RecipientPicker, type PickerResult } from './RecipientPicker';
import {
  DEFAULT_SAFETY, WARMUP_CAPS, autoSentTimes, countByStatus, describeDuration, logToCsv, normalizeSafety, optOutPhoneSet,
  planCampaign, renderMessage,
} from '../shared/outbox-logic';
import type {
  Campaign, CampaignSource, ObMsg, OutboxItem, Recipient, Recurrence, SafetySettings, Schedule, SendLogEntry,
} from '../shared/outbox-types';

const send = <T,>(m: ObMsg): Promise<T> => chrome.runtime.sendMessage(m) as Promise<T>;
const uid = () => crypto.randomUUID();
const fmt = (t: number | null | undefined) => (t ? new Date(t).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

function useLive<T>(fn: () => Promise<T>, init: T): T {
  const [v, setV] = useState<T>(init);
  useEffect(() => {
    const sub = liveQuery(fn).subscribe({ next: setV, error: () => {} });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}

function download(name: string, data: string, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const toLocalInput = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

type Tab = 'kampanye' | 'berjalan' | 'jadwal' | 'pengingat' | 'log';
const STATUS_ID: Record<string, string> = {
  running: 'Berjalan', paused: 'Dijeda', done: 'Selesai', stopped: 'Dihentikan', pending: 'Menunggu', sending: 'Mengirim',
  sent: 'Terkirim', failed: 'Gagal', draft: 'Draf siap', skipped: 'Dilewati', cancelled: 'Dibatalkan',
};
const Badge = ({ s }: { s: string }) => <span className={`badge ${s}`}>{STATUS_ID[s] ?? s}</span>;

export function App() {
  const [tab, setTab] = useState<Tab>('kampanye');
  const [killed, setKilled] = useState(false);
  const campaigns = useLive(() => db.campaigns.orderBy('createdAt').reverse().toArray(), [] as Campaign[]);

  useEffect(() => {
    const read = () => { void send<{ killed: boolean }>({ kind: 'ob:kill' }).then((r) => setKilled(!!r?.killed), () => {}); };
    read();
    const t = setInterval(read, 4000);
    return () => clearInterval(t);
  }, []);

  const stopAll = async () => {
    if (!confirm('Hentikan SEMUA pengiriman sekarang? Semua kampanye akan dijeda.')) return;
    const r = await send<{ killed: boolean }>({ kind: 'ob:kill', on: true });
    setKilled(!!r?.killed);
  };
  const release = async () => { const r = await send<{ killed: boolean }>({ kind: 'ob:kill', on: false }); setKilled(!!r?.killed); };

  const tabs: [Tab, string][] = [['kampanye', 'Kampanye'], ['berjalan', 'Berjalan'], ['jadwal', 'Jadwal'], ['pengingat', 'Pengingat → Kirim'], ['log', 'Log']];
  return (
    <div className="wrap">
      <header className="top">
        <h1>Blast &amp; Pesan Terjadwal</h1>
        {killed
          ? <button className="pri" onClick={release}>Aktifkan kembali pengiriman</button>
          : <button className="stop" onClick={stopAll} aria-label="Stop semua pengiriman">STOP semua</button>}
      </header>
      {killed && <div className="banner" role="status">Stop global aktif: tidak ada pesan yang dikirim. Kampanye dijeda, lanjutkan satu per satu dari tab Berjalan.</div>}
      {!IS_FULL && (
        <div className="banner" role="note">
          <b>Mode draf saat jatuh tempo.</b> Pada build ini pesan tidak dikirim otomatis. Saat waktunya tiba, muncul notifikasi dan kartu di WhatsApp Web berisi
          teks yang sudah siap. Anda sisipkan ke chat lalu menekan Kirim sendiri. Pengiriman otomatis penuh hanya ada di versi Full.
        </div>
      )}
      <div className="banner" role="note">Kirim senyap bergantung internal WhatsApp Web dan berisiko membuat akun dibatasi WhatsApp. <a href="../autoreply/index.html#diag" target="_blank" rel="noreferrer">Diagnostik pengirim: uji kemampuan kirim senyap</a></div>
      <nav role="tablist" aria-label="Menu blast">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </nav>
      <div className={`main${tab === 'kampanye' ? ' wizmain' : ''}`}>
        {tab === 'kampanye' && <Wizard onStarted={() => setTab('berjalan')} />}
        {tab === 'berjalan' && <Running campaigns={campaigns} />}
        {tab === 'jadwal' && <Schedules />}
        {tab === 'pengingat' && <Reminders />}
        {tab === 'log' && <LogTab campaigns={campaigns} />}
      </div>
    </div>
  );
}

const PAGE = 200;
function MoreBtn({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  return (
    <div className="row" style={{ marginTop: 6 }}>
      <button onClick={onMore}>Tampilkan {Math.min(PAGE, total - shown)} lagi</button>
      <span className="mut">Menampilkan {Math.min(shown, total)} dari {total}</span>
    </div>
  );
}

function RecipientPreview({ list }: { list: Recipient[] }) {
  const [n, setN] = useState(PAGE);
  const cols = useMemo(() => {
    const keys: string[] = [];
    for (const r of list.slice(0, 50)) for (const k of Object.keys(r.vars ?? {})) if (!keys.includes(k)) keys.push(k);
    return keys.slice(0, 8);
  }, [list]);
  if (!list.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <ScrollTable maxHeight="max(240px, 56vh)" stickyFirst label="Pratinjau penerima">
        <table>
          <thead><tr><th className="num">#</th><th>Telepon</th><th>Nama</th>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{list.slice(0, n).map((r, i) => (
            <tr key={r.phone}><td className="num">{i + 1}</td><td>{r.phone}</td><td>{r.name ?? '-'}</td>{cols.map((c) => <td key={c}>{r.vars?.[c] ?? ''}</td>)}</tr>
          ))}</tbody>
        </table>
      </ScrollTable>
      {list.length > n && <MoreBtn shown={n} total={list.length} onMore={() => setN(n + PAGE)} />}
    </div>
  );
}

// ---------------- Wizard ----------------
function SafetyForm({ s, set }: { s: SafetySettings; set: (v: SafetySettings) => void }) {
  const num = (k: keyof SafetySettings) => (e: React.ChangeEvent<HTMLInputElement>) => set({ ...s, [k]: Number(e.target.value) });
  return (
    <div className="grid">
      <label className="f">Jeda minimum (detik, min 8)<input type="number" min={8} value={s.delayMinSec} onChange={num('delayMinSec')} /></label>
      <label className="f">Jeda maksimum (detik)<input type="number" min={8} value={s.delayMaxSec} onChange={num('delayMaxSec')} /></label>
      <label className="f">Maks. pesan per jam<input type="number" min={1} max={120} value={s.maxPerHour} onChange={num('maxPerHour')} /></label>
      <label className="f">Maks. pesan per hari<input type="number" min={1} max={1000} value={s.maxPerDay} onChange={num('maxPerDay')} /></label>
      <label className="chk"><input type="checkbox" checked={s.windowEnabled} onChange={(e) => set({ ...s, windowEnabled: e.target.checked })} /><span>Hanya kirim dalam jam kirim</span></label>
      <label className="f">Dari jam<input type="time" value={s.windowFrom} disabled={!s.windowEnabled} onChange={(e) => set({ ...s, windowFrom: e.target.value })} /></label>
      <label className="f">Sampai jam<input type="time" value={s.windowTo} disabled={!s.windowEnabled} onChange={(e) => set({ ...s, windowTo: e.target.value })} /></label>
      <label className="chk"><input type="checkbox" checked={s.warmup} onChange={(e) => set({ ...s, warmup: e.target.checked })} />
        <span><b>Mode pemanasan</b> (disarankan untuk akun baru): batas harian bertahap {WARMUP_CAPS.join(' → ')} pesan pada hari 1-{WARMUP_CAPS.length}.</span></label>
      <label className="chk"><input type="checkbox" checked={s.checkRegistered} onChange={(e) => set({ ...s, checkRegistered: e.target.checked })} /><span>Cek nomor terdaftar WhatsApp sebelum kirim pertama</span></label>
      <label className="f">Jeda otomatis setelah error berturut-turut<input type="number" min={1} max={10} value={s.pauseAfterErrors} onChange={num('pauseAfterErrors')} /></label>
    </div>
  );
}

function Wizard({ onStarted }: { onStarted: () => void }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<PickerResult>({ recipients: [], source: 'csv', unique: 0 });
  const [pickKey, setPickKey] = useState(0);
  const [body, setBody] = useState('');
  const [safety, setSafety] = useState<SafetySettings>(DEFAULT_SAFETY);
  const [optIn, setOptIn] = useState(false);
  const [later, setLater] = useState(false);
  const [startLocal, setStartLocal] = useState(toLocalInput(Date.now() + 3_600_000));
  const [seed, setSeed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);

  const contacts = useLive(() => db.contacts.toArray(), [] as Contact[]);
  const templates = useLive(() => db.templates.toArray(), [] as Template[]);
  const recent = useLive(() => db.sendLog.where('ts').aboveOrEqual(Date.now() - 2 * 86_400_000).toArray(), [] as SendLogEntry[]);
  const earliest = useLive(async () => (await db.sendLog.orderBy('ts').filter((e) => e.status === 'sent' && e.mode === 'auto').first())?.ts ?? null, null as number | null);

  const optOut = useMemo(() => optOutPhoneSet(contacts), [contacts]);
  const recipients: Recipient[] = picked.recipients;
  const source: CampaignSource = picked.source;
  const safe = useMemo(() => normalizeSafety(safety), [safety]);
  const startAt = later ? Math.max(Date.now(), new Date(startLocal).getTime() || Date.now()) : Date.now();

  const plan = useMemo(() => {
    const history = autoSentTimes(earliest ? [{ id: 'e', ts: earliest, campaignId: '', itemId: '', phone: '', status: 'sent', mode: 'auto' }, ...recent] : recent);
    let n = 0;
    return planCampaign({
      id: 'preview', name: name || 'Pratinjau', template: body, recipients, safety: safe, optInConfirmed: optIn, source, startAt,
      now: Date.now(), history, optOutPhones: optOut, mode: IS_FULL ? 'auto' : 'draft', genId: () => `p${++n}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, body, recipients, safe, optIn, source, startAt, recent, earliest, optOut]);

  const sample: Recipient = recipients[0] ?? { phone: '6281234567890', name: 'Budi' };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prev = useMemo(() => renderMessage(body, sample, {}, Math.random), [body, sample.phone, seed]);

  const chooseTpl = (id: string) => { const t = templates.find((x) => x.id === id); if (t) setBody(t.body); };

  const canNext = step === 1 ? recipients.length > 0 : step === 2 ? !!body.trim() : step === 3 ? optIn : true;

  const start = async () => {
    setBusy(true); setErrs([]);
    try {
      const r = await send<{ ok: boolean; errors?: string[] }>({
        kind: 'ob:campaign:create',
        input: { name: name.trim(), template: body, recipients, safety: safe, startAt, optInConfirmed: optIn, source },
      });
      if (!r?.ok) { setErrs(r?.errors ?? ['Gagal membuat kampanye.']); return; }
      setStep(1); setName(''); setBody(''); setOptIn(false); setPickKey((k) => k + 1);
      onStarted();
    } catch (e) { setErrs([String(e)]); }
    finally { setBusy(false); }
  };

  return (
    <section aria-label="Wizard kampanye" className="wiz">
      <div className="steps" aria-label="Langkah">
        {['1 Penerima', '2 Pesan', '3 Pengaman', '4 Tinjau & mulai'].map((l, i) => <span key={l} className={step === i + 1 ? 'cur' : step > i + 1 ? 'done' : ''}>{l}</span>)}
      </div>

      <div className="wizbody">
      <div hidden={step !== 1}>
        <div className="card">
          <h2>Penerima</h2>
          <p className="mut">Pilih sumber nomor: Manual, Label, Grup, CRM, atau CSV. Nomor otomatis diformat (misal <code>+62 857-4747-6308</code> menjadi <code>6285747476308</code>) dan duplikat dihapus otomatis.</p>
          <RecipientPicker key={pickKey} onChange={setPicked} />
          <p><b>Total penerima unik: {recipients.length}</b></p>
        </div>
      </div>

      {step === 2 && (
        <div className="card">
          <h2>Pesan</h2>
          <div className="row" style={{ marginBottom: 6 }}>
            <select aria-label="Pilih template" value="" onChange={(e) => chooseTpl(e.target.value)}>
              <option value="">Pilih dari template...</option>{templates.map((t) => <option key={t.id} value={t.id}>/{t.shortcut} - {t.title}</option>)}
            </select>
          </div>
          <label className="f">Isi pesan
            <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="{Halo|Hai} {nama}, ..." />
          </label>
          <p className="mut">Variabel: {'{nama} {telepon} {tahap} {tanggal} {akun}'} + kolom CSV. Spintax: {'{Halo|Hai|Selamat pagi}'} dipilih acak per penerima agar pesan tidak identik.</p>
          <div className="row"><b>Pratinjau</b> <span className="mut">untuk {sample.name || sample.phone}</span> <button onClick={() => setSeed((x) => x + 1)}>Acak ulang</button></div>
          <div className="preview" aria-live="polite">{prev.text || <span className="mut">(kosong)</span>}</div>
          {prev.unresolved.length > 0 && <p className="err">Variabel belum terisi: {prev.unresolved.map((u) => `{${u}}`).join(' ')}. Penerima tanpa data ini akan dilewati.</p>}
        </div>
      )}

      {step === 3 && (
        <div className="card">
          <h2>Pengaman</h2>
          <SafetyForm s={safety} set={setSafety} />
          <hr />
          <label className="chk"><input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
            <span><b>Penerima sudah opt-in.</b> Saya memastikan setiap penerima sudah menyetujui menerima pesan ini dari saya. Pesan massal ke orang yang tidak setuju
              melanggar kebijakan WhatsApp dan dapat membuat nomor diblokir. Grup, broadcast, dan status tidak pernah dikirimi; kontak CRM dengan opt-out dilewati.</span></label>
        </div>
      )}

      {step === 4 && (
        <div className="card">
          <h2>Tinjau &amp; mulai</h2>
          <label className="f" style={{ maxWidth: 360 }}>Nama kampanye<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Promo Maret" /></label>
          <label className="chk" style={{ margin: '8px 0' }}><input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} /><span>Jadwalkan mulai nanti</span></label>
          {later && <input type="datetime-local" aria-label="Waktu mulai" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />}
          <ul>
            <li>{recipients.length} penerima, {plan.items.length} pesan akan dibuat{plan.skipped.length ? `, ${plan.skipped.length} dilewati` : ''}</li>
            <li>Mulai: {fmt(plan.startAt)}</li>
            <li>Perkiraan selesai: {plan.ok ? `${fmt(plan.endAt)} (${describeDuration(plan.durationMs)})` : '-'}</li>
            <li>Jeda {safe.delayMinSec}-{safe.delayMaxSec} dtk, maks {safe.maxPerHour}/jam, {safe.maxPerDay}/hari{safe.windowEnabled ? `, jam ${safe.windowFrom}-${safe.windowTo}` : ''}{safe.warmup ? ', mode pemanasan' : ''}</li>
            <li>{IS_FULL ? 'Pengiriman otomatis dari tab WhatsApp Web yang terbuka.' : 'Mode draf: Anda menekan Kirim sendiri tiap pesan.'}</li>
          </ul>
          {plan.skipped.length > 0 && <details><summary>{plan.skipped.length} dilewati</summary><pre className="mini">{plan.skipped.slice(0, 50).map((s) => `${s.phone}: ${s.reason}`).join('\n')}</pre></details>}
          {(errs.length ? errs : plan.errors).map((e) => <p key={e} className="err" role="alert">{e}</p>)}
          <p className="mut">Tab WhatsApp Web harus tetap terbuka agar pesan terkirim.</p>
        </div>
      )}

      </div>

      <div className="row wizfoot">
        <button disabled={step === 1} onClick={() => setStep(step - 1)}>Kembali</button>
        {step < 4
          ? <button className="pri" disabled={!canNext} onClick={() => setStep(step + 1)}>Lanjut</button>
          : <button className="pri" disabled={busy || !plan.ok || !name.trim()} onClick={() => void start()}>{later ? 'Jadwalkan kampanye' : 'Mulai kampanye'}</button>}
      </div>
    </section>
  );
}

// ---------------- Berjalan ----------------
function Running({ campaigns }: { campaigns: Campaign[] }) {
  const items = useLive(() => db.outbox.toArray(), [] as OutboxItem[]);
  const [open, setOpen] = useState('');
  const [limits, setLimits] = useState<Record<string, number>>({});
  const shown = (id: string) => limits[id] ?? PAGE;
  const by = useMemo(() => {
    const m = new Map<string, OutboxItem[]>();
    for (const i of items) { const a = m.get(i.campaignId); if (a) a.push(i); else m.set(i.campaignId, [i]); }
    return m;
  }, [items]);
  const act = (kind: 'pause' | 'resume' | 'stop' | 'delete', id: string) => {
    if ((kind === 'stop' || kind === 'delete') && !confirm(kind === 'stop' ? 'Hentikan kampanye ini? Pesan yang belum terkirim dibatalkan.' : 'Hapus kampanye dan daftar pesannya?')) return;
    void send<{ ok: boolean; error?: string }>({ kind: `ob:campaign:${kind}` as 'ob:campaign:pause', id }).then((r) => { if (r && r.ok === false && r.error) alert(r.error); });
  };
  const visible = campaigns.filter((c) => c.source === 'csv' || c.source === 'crm' || c.source === 'mix' || by.has(c.id));
  if (!visible.length) return <p className="mut">Belum ada kampanye. Buat di tab Kampanye.</p>;
  return (
    <section>
      {visible.map((c) => {
        const list = by.get(c.id) ?? [];
        const cnt = countByStatus(list);
        const done = (cnt.sent ?? 0) + (cnt.draft ?? 0) + (cnt.failed ?? 0) + (cnt.skipped ?? 0) + (cnt.cancelled ?? 0);
        const pct = list.length ? Math.round((done / list.length) * 100) : 0;
        const next = list.filter((i) => i.status === 'pending').sort((a, b) => a.dueAt - b.dueAt)[0];
        return (
          <div className="card" key={c.id}>
            <div className="row">
              <b style={{ flex: 1 }}>{c.name}</b> <Badge s={c.status} />
              {c.status === 'running' && <button onClick={() => act('pause', c.id)}>Jeda</button>}
              {c.status === 'paused' && <button className="pri" onClick={() => act('resume', c.id)}>Lanjutkan</button>}
              {(c.status === 'running' || c.status === 'paused') && <button className="bad" onClick={() => act('stop', c.id)}>Stop</button>}
              <button onClick={() => setOpen(open === c.id ? '' : c.id)} aria-expanded={open === c.id}>Detail</button>
              {(c.status === 'done' || c.status === 'stopped') && <button className="bad" onClick={() => act('delete', c.id)}>Hapus</button>}
            </div>
            <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Progres ${c.name}`} style={{ margin: '8px 0' }}><i style={{ width: `${pct}%` }} /></div>
            <div className="row mut">
              <span>Terkirim {cnt.sent ?? 0}</span><span>Draf {cnt.draft ?? 0}</span><span>Gagal {cnt.failed ?? 0}</span><span>Menunggu {(cnt.pending ?? 0) + (cnt.sending ?? 0)}</span>
              {next && c.status === 'running' && <span>Berikutnya: {fmt(next.dueAt)}</span>}
            </div>
            {c.pausedReason && c.status === 'paused' && <p className="err" role="status">{c.pausedReason}</p>}
            {open === c.id && (
              <div style={{ marginTop: 8 }}>
                <ScrollTable maxHeight="max(260px, 62vh)" stickyFirst label="Status per penerima">
                <table>
                  <thead><tr><th>Nomor</th><th>Nama</th><th>Status</th><th>Jadwal kirim</th><th>Keterangan</th><th /></tr></thead>
                  <tbody>
                    {[...list].sort((a, b) => a.dueAt - b.dueAt).slice(0, shown(c.id)).map((i) => (
                      <tr key={i.id}>
                        <td>{i.phone}</td><td>{i.name ?? '-'}</td><td><Badge s={i.status} /></td><td>{fmt(i.dueAt)}</td><td className="err wrap">{i.error ?? ''}</td>
                        <td>{i.status === 'draft' && <>
                          <button onClick={() => void navigator.clipboard?.writeText(i.text)}>Salin</button>{' '}
                          <button onClick={() => void send({ kind: 'ob:result', itemId: i.id, status: 'sent' })}>Tandai terkirim</button></>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </ScrollTable>
                {list.length > shown(c.id) && <MoreBtn shown={shown(c.id)} total={list.length} onMore={() => setLimits({ ...limits, [c.id]: shown(c.id) + PAGE })} />}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

// ---------------- Jadwal ----------------
const blankSchedule = (): Schedule => ({
  id: uid(), name: '', enabled: true, target: { phone: '' }, text: '', recurrence: { type: 'none', at: Date.now() + 3_600_000 }, nextRunAt: null,
  optInConfirmed: false, createdAt: Date.now(), safety: { ...DEFAULT_SAFETY },
});

function describeRec(r: Recurrence): string {
  if (r.type === 'none') return `Sekali, ${fmt(r.at)}`;
  if (r.type === 'daily') return `Setiap hari ${r.time}`;
  return `Mingguan ${r.weekdays.map((d) => DAYS[d]).join(', ')} ${r.time}`;
}

function Schedules() {
  const list = useLive(() => db.schedules.toArray(), [] as Schedule[]);
  const contacts = useLive(() => db.contacts.toArray(), [] as Contact[]);
  const [f, setF] = useState<Schedule>(blankSchedule);
  const [errs, setErrs] = useState<string[]>([]);
  const rec = f.recurrence;
  const setRec = (r: Recurrence) => setF({ ...f, recurrence: r });
  const pickContact = (key: string) => {
    const c = contacts.find((x) => x.key === key);
    if (c) setF({ ...f, target: { phone: c.phone, name: c.name || undefined, contactKey: c.key } });
  };
  const save = async () => {
    const r = await send<{ ok: boolean; errors?: string[] }>({ kind: 'ob:schedule:upsert', schedule: f });
    if (!r?.ok) { setErrs(r?.errors ?? ['Gagal menyimpan.']); return; }
    setErrs([]); setF(blankSchedule());
  };
  const sorted = [...list].sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity));
  return (
    <section>
      <div className="card">
        <h2>{list.some((s) => s.id === f.id) ? 'Ubah jadwal' : 'Jadwal baru'}</h2>
        <div className="grid">
          <label className="f">Nama jadwal<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="f">Nomor tujuan<PhoneField value={f.target.phone} onChange={(v) => setF({ ...f, target: { ...f.target, phone: v, contactKey: undefined } })} /></label>
          <label className="f">atau pilih kontak CRM
            <select value={f.target.contactKey ?? ''} onChange={(e) => pickContact(e.target.value)}>
              <option value="">-</option>{contacts.filter((c) => c.phone && !c.optOut).map((c) => <option key={c.key} value={c.key}>{c.name || c.phone} ({c.phone})</option>)}
            </select></label>
          <label className="f">Pengulangan
            <select value={rec.type} onChange={(e) => {
              const t = e.target.value;
              setRec(t === 'none' ? { type: 'none', at: Date.now() + 3_600_000 } : t === 'daily' ? { type: 'daily', time: '09:00' } : { type: 'weekly', time: '09:00', weekdays: [1] });
            }}>
              <option value="none">Sekali saja</option><option value="daily">Setiap hari</option><option value="weekly">Mingguan</option>
            </select></label>
          {rec.type === 'none'
            ? <label className="f">Waktu kirim<input type="datetime-local" value={toLocalInput(rec.at)} onChange={(e) => setRec({ type: 'none', at: new Date(e.target.value).getTime() })} /></label>
            : <label className="f">Jam kirim<input type="time" value={rec.time} onChange={(e) => setRec({ ...rec, time: e.target.value })} /></label>}
        </div>
        {rec.type === 'weekly' && (
          <div className="days" role="group" aria-label="Hari" style={{ margin: '8px 0' }}>
            {DAYS.map((d, i) => (
              <label key={d}><input type="checkbox" checked={rec.weekdays.includes(i)} onChange={(e) => setRec({ ...rec, weekdays: e.target.checked ? [...rec.weekdays, i].sort() : rec.weekdays.filter((x) => x !== i) })} />{d}</label>
            ))}
          </div>
        )}
        <label className="f" style={{ marginTop: 8 }}>Isi pesan (boleh pakai {'{nama} {tanggal}'} dan spintax)
          <textarea rows={4} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></label>
        <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" checked={f.safety?.windowEnabled ?? true} onChange={(e) => setF({ ...f, safety: { ...(f.safety ?? DEFAULT_SAFETY), windowEnabled: e.target.checked } })} />
          <span>Tahan sampai jam kirim ({(f.safety ?? DEFAULT_SAFETY).windowFrom}-{(f.safety ?? DEFAULT_SAFETY).windowTo}) bila jatuh tempo di luar jam itu</span></label>
        <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" checked={f.optInConfirmed} onChange={(e) => setF({ ...f, optInConfirmed: e.target.checked })} />
          <span><b>Penerima sudah opt-in</b> dan setuju menerima pesan ini.</span></label>
        <p className="mut">{IS_FULL ? 'Dikirim otomatis dari tab WhatsApp Web yang terbuka saat jatuh tempo.' : 'Saat jatuh tempo: notifikasi + kartu draf di WhatsApp Web; Anda menekan Kirim sendiri.'} Jadwal yang terlewat lebih dari 12 jam dilewati.</p>
        {errs.map((e) => <p key={e} className="err" role="alert">{e}</p>)}
        <div className="row"><button className="pri" onClick={() => void save()}>Simpan jadwal</button>
          {list.some((s) => s.id === f.id) && <button onClick={() => { setF(blankSchedule()); setErrs([]); }}>Batal ubah</button>}</div>
      </div>
      <div className="card">
        <h2>Daftar jadwal</h2>
        {!sorted.length ? <p className="mut">Belum ada jadwal.</p> : (
          <ScrollTable maxHeight="max(260px, 62vh)" label="Daftar jadwal"><table>
            <thead><tr><th>Aktif</th><th>Nama</th><th>Tujuan</th><th>Pengulangan</th><th>Berikutnya</th><th /></tr></thead>
            <tbody>{sorted.map((s) => (
              <tr key={s.id}>
                <td><input type="checkbox" aria-label={`Aktifkan ${s.name}`} checked={s.enabled} onChange={(e) => void send<{ ok: boolean; error?: string }>({ kind: 'ob:schedule:toggle', id: s.id, enabled: e.target.checked }).then((r) => { if (r && !r.ok && r.error) alert(r.error); })} /></td>
                <td>{s.name}</td><td>{s.target.name ? `${s.target.name} (${s.target.phone})` : s.target.phone}</td><td>{describeRec(s.recurrence)}</td><td>{fmt(s.nextRunAt)}</td>
                <td><button onClick={() => { setF({ ...s }); setErrs([]); }}>Ubah</button>{' '}
                  <button className="bad" onClick={() => { if (confirm('Hapus jadwal ini?')) void send({ kind: 'ob:schedule:delete', id: s.id }); }}>Hapus</button></td>
              </tr>))}</tbody>
          </table></ScrollTable>
        )}
      </div>
    </section>
  );
}

// ---------------- Pengingat -> Kirim ----------------
function Reminders() {
  const reminders = useLive(() => db.reminders.toArray(), [] as Reminder[]);
  const contacts = useLive(() => db.contacts.toArray(), [] as Contact[]);
  const schedules = useLive(() => db.schedules.toArray(), [] as Schedule[]);
  const [openId, setOpenId] = useState('');
  const [text, setText] = useState('');
  const [optIn, setOptIn] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);
  const cmap = useMemo(() => new Map(contacts.map((c) => [c.key, c])), [contacts]);
  const smap = useMemo(() => new Map(schedules.filter((s) => s.reminderId).map((s) => [s.reminderId as string, s])), [schedules]);
  const open = reminders.filter((r) => !r.done).sort((a, b) => a.dueAt - b.dueAt);

  const convert = async (id: string) => {
    const r = await send<{ ok: boolean; errors?: string[] }>({ kind: 'ob:reminder:send', reminderId: id, text, optInConfirmed: optIn });
    if (!r?.ok) { setErrs(r?.errors ?? ['Gagal.']); return; }
    setOpenId(''); setErrs([]); setOptIn(false);
  };
  if (!open.length) return <p className="mut">Tidak ada pengingat terbuka. Buat pengingat di CRM.</p>;
  return (
    <section>
      <p className="mut">Ubah pengingat CRM menjadi pesan yang dikirim ke kontak saat jatuh tempo. {IS_FULL ? '' : 'Pada build ini hasilnya draf yang Anda kirim sendiri.'}</p>
      {open.map((r) => {
        const c = cmap.get(r.contactKey);
        const sch = smap.get(r.id);
        return (
          <div className="card" key={r.id}>
            <div className="row">
              <b style={{ flex: 1 }}>{c?.name || c?.phone || 'Kontak'}</b><span className="mut">{fmt(r.dueAt)}</span>
              {sch ? <><span className="badge running">Terjadwal kirim</span><button className="bad" onClick={() => void send({ kind: 'ob:schedule:delete', id: sch.id })}>Batalkan</button></>
                : <button className="pri" onClick={() => { setOpenId(r.id); setText(r.text); setErrs([]); }}>Kirim pesan otomatis saat jatuh tempo</button>}
            </div>
            <div className="mut">{r.text}</div>
            {sch && <pre className="mini">{sch.text}</pre>}
            {openId === r.id && !sch && (
              <div style={{ marginTop: 8 }}>
                <label className="f">Pesan untuk kontak<textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} /></label>
                <label className="chk" style={{ margin: '6px 0' }}><input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} /><span><b>Penerima sudah opt-in</b></span></label>
                {errs.map((e) => <p key={e} className="err" role="alert">{e}</p>)}
                <div className="row"><button className="pri" onClick={() => void convert(r.id)}>Jadwalkan</button><button onClick={() => setOpenId('')}>Batal</button></div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

// ---------------- Log ----------------
function LogTab({ campaigns }: { campaigns: Campaign[] }) {
  const log = useLive(() => db.sendLog.orderBy('ts').reverse().limit(500).toArray(), [] as SendLogEntry[]);
  const names = useMemo(() => Object.fromEntries(campaigns.map((c) => [c.id, c.name])), [campaigns]);
  return (
    <section className="card fill">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ flex: 1, margin: 0 }}>Log pengiriman (500 terakhir)</h2>
        <button disabled={!log.length} onClick={() => download('log-pengiriman.csv', logToCsv(log, names), 'text/csv')}>Ekspor CSV</button>
      </div>
      {!log.length ? <p className="mut">Log kosong.</p> : (
        <ScrollTable stickyFirst label="Log pengiriman"><table>
          <thead><tr><th>Waktu</th><th>Kampanye</th><th>Nomor</th><th>Status</th><th>Keterangan</th></tr></thead>
          <tbody>{log.map((e) => <tr key={e.id}><td>{fmt(e.ts)}</td><td>{names[e.campaignId] ?? e.campaignId.slice(0, 8)}</td><td>{e.phone}</td><td><Badge s={e.status} /></td><td className="err wrap">{e.error ?? ''}</td></tr>)}</tbody>
        </table></ScrollTable>
      )}
    </section>
  );
}
