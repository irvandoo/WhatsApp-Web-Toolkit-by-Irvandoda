import { ScrollTable } from '../shared/ui/ScrollTable';
import { liveQuery } from 'dexie';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IS_FULL } from '../shared/credit';
import { db } from '../shared/db';
import { validateRule } from '../shared/autoreply-logic';
import {
  AR_GLOBAL_KEY, DEFAULT_AR_GLOBAL, newRule, type ArGlobal, type ArLogEntry, type ArMsg, type ArRule,
} from '../shared/autoreply-types';
import { VariantEditor } from '../shared/ui/VariantEditor';
import { KNOWN_VARS, render } from '../shared/template-engine';

const send = <T,>(m: ArMsg): Promise<T> => chrome.runtime.sendMessage(m) as Promise<T>;

function useLive<T>(fn: () => Promise<T>, init: T): T {
  const [v, setV] = useState<T>(init);
  useEffect(() => {
    const sub = liveQuery(fn).subscribe({ next: setV, error: () => {} });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}

function useGlobal(): [ArGlobal, (p: Partial<ArGlobal>) => void] {
  const [g, setG] = useState<ArGlobal>(DEFAULT_AR_GLOBAL);
  useEffect(() => {
    chrome.storage.local.get(AR_GLOBAL_KEY).then((r) => setG({ ...DEFAULT_AR_GLOBAL, ...(r[AR_GLOBAL_KEY] ?? {}) }), () => {});
    const on = (ch: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && ch[AR_GLOBAL_KEY]) setG({ ...DEFAULT_AR_GLOBAL, ...(ch[AR_GLOBAL_KEY].newValue ?? {}) });
    };
    chrome.storage.onChanged.addListener(on);
    return () => chrome.storage.onChanged.removeListener(on);
  }, []);
  const set = (p: Partial<ArGlobal>) => {
    const next = { ...g, ...p };
    if (!IS_FULL) next.autoSend = false;
    if (!next.enabled) next.autoSend = false;
    setG(next);
    void chrome.storage.local.set({ [AR_GLOBAL_KEY]: next });
  };
  return [g, set];
}

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const TRIGGERS: Record<ArRule['trigger'], string> = {
  keyword: 'Kata kunci', 'first-message': 'Pesan pertama (lead baru)', 'away-hours': 'Di luar jam kerja', any: 'Semua pesan',
};
const MATCH: Record<ArRule['matchMode'], string> = { contains: 'Mengandung kata', exact: 'Sama persis', 'regex-safe': 'Kata utuh (batas kata)' };
const SAMPLE_VARS = { nama: 'Budi', telepon: '628123456789', tahap: 'Lead baru', tanggal: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }), akun: 'Toko Saya' };
const fmt = (ts: number) => new Date(ts).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

type Tab = 'aturan' | 'log' | 'keamanan';

export function App() {
  const [tab, setTab] = useState<Tab>('aturan');
  const [g, setG] = useGlobal();
  const rules = useLive(async () => (await db.arRules.toArray()).sort((a, b) => a.order - b.order), [] as ArRule[]);
  const [editing, setEditing] = useState<ArRule | null>(null);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => { send({ kind: 'ar:rules' }).then(() => setSeeded(true), () => setSeeded(true)); }, []); // triggers sample seed

  const active = g.enabled && rules.some((r) => r.enabled);

  return (
    <div className="page">
      <div className="top">
        <h1>Auto-Reply</h1>
        <div className="switches">
          <label className="sw">
            <input type="checkbox" checked={g.enabled} onChange={(e) => setG({ enabled: e.target.checked })} aria-describedby="d-en" />
            <span><b>Auto-reply aktif</b><small id="d-en">Saklar utama. Mati = tidak ada balasan sama sekali.</small></span>
          </label>
          <label className="sw">
            <input type="checkbox" checked={g.autoSend && IS_FULL} disabled={!IS_FULL || !g.enabled} onChange={(e) => setG({ autoSend: e.target.checked })} aria-describedby="d-as" />
            <span><b>Auto-kirim</b>
              <small id="d-as">{IS_FULL
                ? 'Kirim otomatis untuk aturan bermode "Auto". Tanpa ini, semua balasan hanya menjadi draft.'
                : 'Tidak tersedia di versi Store: balasan selalu berupa draft yang Anda kirim sendiri (aturan Chrome Web Store).'}</small></span>
          </label>
        </div>
      </div>

      <div className={'banner ' + (active ? 'live' : 'warn')} role="status">
        {active
          ? <>Auto-reply AKTIF. {g.autoSend && IS_FULL ? 'Aturan mode Auto akan mengirim sendiri setelah jeda acak.' : 'Balasan dibuat sebagai draft; Anda yang menekan kirim.'}</>
          : g.enabled ? 'Saklar utama menyala, tetapi belum ada aturan yang aktif.' : 'Auto-reply MATI. Sampel aturan di bawah masih nonaktif.'}
        {' '}<span className="mut">Hanya bereaksi pada pesan yang masuk setelah saklar dinyalakan, dan hanya saat tab WhatsApp Web terbuka.</span>
      </div>

      <nav role="tablist" aria-label="Bagian">
        {(['aturan', 'log', 'keamanan'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'aturan' ? 'Aturan' : t === 'log' ? 'Log' : 'Keamanan'}
          </button>
        ))}
      </nav>

      <div className={'pane' + (tab === 'log' ? ' fill' : '')}>
      {tab === 'aturan' && <Rules rules={rules} ready={seeded} onEdit={setEditing} onNew={() => setEditing(newRule(rules.length))} />}
      {tab === 'log' && <Log />}
      {tab === 'keamanan' && <Safety />}
      </div>
      {editing && <Editor key={editing.id} initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ---------------- rules list ----------------
function Rules({ rules, ready, onEdit, onNew }: { rules: ArRule[]; ready: boolean; onEdit: (r: ArRule) => void; onNew: () => void }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const reorder = (ids: string[]) => void send({ kind: 'ar:rule:reorder', ids });
  const move = (id: string, dir: -1 | 1) => {
    const ids = rules.map((r) => r.id);
    const i = ids.indexOf(id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder(ids);
  };
  const drop = (target: string) => {
    if (!dragId || dragId === target) return;
    const ids = rules.map((r) => r.id).filter((x) => x !== dragId);
    ids.splice(ids.indexOf(target), 0, dragId);
    reorder(ids);
  };
  const toggle = (r: ArRule) => void send({ kind: 'ar:rule:upsert', rule: { ...r, enabled: !r.enabled } });
  const del = (r: ArRule) => { if (confirm(`Hapus aturan "${r.name}"?`)) void send({ kind: 'ar:rule:delete', id: r.id }); };

  return (
    <div>
      <div className="bar">
        <button className="pri" onClick={onNew}>+ Aturan baru</button>
        <span className="mut">Urutan menentukan prioritas: aturan pertama yang cocok akan dipakai.</span>
      </div>
      {ready && !rules.length && <p className="mut">Belum ada aturan.</p>}
      {rules.map((r, i) => (
        <div key={r.id} className={'rule' + (dragId === r.id ? ' drag' : '') + (overId === r.id ? ' over' : '')}
          draggable onDragStart={() => setDragId(r.id)} onDragEnd={() => { setDragId(null); setOverId(null); }}
          onDragOver={(e) => { e.preventDefault(); setOverId(r.id); }} onDrop={() => { drop(r.id); setOverId(null); }}>
          <span className="handle" aria-hidden="true" title="Seret untuk mengurutkan">⋮⋮</span>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={r.enabled} onChange={() => toggle(r)} aria-label={`Aktifkan ${r.name}`} />
          </label>
          <div className="main">
            <b>{i + 1}. {r.name}</b>
            <span className="pill">{TRIGGERS[r.trigger]}</span>
            <span className={'pill ' + (r.mode === 'auto' ? 'warn' : 'ok')}>{r.mode === 'auto' ? 'Auto' : 'Draft'}</span>
            {r.trigger === 'keyword' && <span className="mut">{r.keywords.join(', ') || '(tanpa kata kunci)'}</span>}
          </div>
          <div className="acts">
            <button onClick={() => move(r.id, -1)} disabled={i === 0} aria-label="Naikkan">↑</button>
            <button onClick={() => move(r.id, 1)} disabled={i === rules.length - 1} aria-label="Turunkan">↓</button>
            <button onClick={() => onEdit(r)}>Ubah</button>
            <button className="danger" onClick={() => del(r)}>Hapus</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- editor ----------------
function Editor({ initial, onClose }: { initial: ArRule; onClose: () => void }) {
  const [r, setR] = useState<ArRule>(initial);
  const [kw, setKw] = useState(initial.keywords.join('\n'));
  const taRef = useRef<HTMLTextAreaElement>(null);
  const errors = useMemo(() => validateRule({ ...r, keywords: kw.split('\n').map((s) => s.trim()).filter(Boolean) }), [r, kw]);
  const preview = useMemo(() => render(r.reply, SAMPLE_VARS, () => 0), [r.reply]);
  const sched = r.schedule ?? { days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' };
  const set = <K extends keyof ArRule>(k: K, v: ArRule[K]) => setR((p) => ({ ...p, [k]: v }));
  const num = (v: string, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);

  const insertVar = (v: string) => {
    const ta = taRef.current;
    const tok = `{${v}}`;
    if (!ta) return set('reply', r.reply + tok);
    const a = ta.selectionStart ?? r.reply.length, b = ta.selectionEnd ?? a;
    set('reply', r.reply.slice(0, a) + tok + r.reply.slice(b));
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(a + tok.length, a + tok.length); });
  };
  const save = async () => {
    if (errors.length) return;
    const rule: ArRule = { ...r, keywords: kw.split('\n').map((s) => s.trim()).filter(Boolean), schedule: r.trigger === 'away-hours' ? sched : r.schedule };
    await send({ kind: 'ar:rule:upsert', rule });
    onClose();
  };
  const modeAutoBlocked = !IS_FULL;

  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Editor aturan">
        <div className="top"><h2>Editor aturan</h2><button onClick={onClose} aria-label="Tutup">Tutup</button></div>

        <label htmlFor="f-name">Nama aturan</label>
        <input id="f-name" style={{ width: '100%' }} value={r.name} onChange={(e) => set('name', e.target.value)} />

        <label htmlFor="f-trig">Pemicu</label>
        <select id="f-trig" value={r.trigger} onChange={(e) => set('trigger', e.target.value as ArRule['trigger'])}>
          {Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        {r.trigger === 'keyword' && (
          <>
            <label htmlFor="f-kw">Kata kunci (satu per baris)</label>
            <textarea id="f-kw" rows={4} value={kw} onChange={(e) => setKw(e.target.value)} />
            <label htmlFor="f-mm">Cara mencocokkan</label>
            <select id="f-mm" value={r.matchMode} onChange={(e) => set('matchMode', e.target.value as ArRule['matchMode'])}>
              {Object.entries(MATCH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <p className="help">Tanpa regex. "Kata utuh" tidak akan cocok di tengah kata lain (mis. "cat" tidak cocok dengan "category").</p>
          </>
        )}

        {r.trigger === 'away-hours' && (
          <>
            <label>Jam kerja (balasan dikirim DI LUAR jam ini)</label>
            <div className="row days" role="group" aria-label="Hari kerja">
              {DAYS.map((d, i) => (
                <button key={d} className={sched.days.includes(i) ? 'on' : ''} aria-pressed={sched.days.includes(i)}
                  onClick={() => set('schedule', { ...sched, days: sched.days.includes(i) ? sched.days.filter((x) => x !== i) : [...sched.days, i].sort() })}>{d}</button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <input type="time" aria-label="Dari jam" value={sched.from} onChange={(e) => set('schedule', { ...sched, from: e.target.value })} />
              <span>sampai</span>
              <input type="time" aria-label="Sampai jam" value={sched.to} onChange={(e) => set('schedule', { ...sched, to: e.target.value })} />
            </div>
            <p className="help">Rentang lewat tengah malam (mis. 22:00 sampai 06:00) didukung.</p>
          </>
        )}

        <label htmlFor="f-reply">Isi balasan</label>
        <textarea id="f-reply" ref={taRef} rows={5} value={r.reply} onChange={(e) => set('reply', e.target.value)} />
        <div className="row chips" style={{ marginTop: 4 }} aria-label="Sisipkan variabel">
          {KNOWN_VARS.map((v) => <button key={v} onClick={() => insertVar(v)}>{`{${v}}`}</button>)}
        </div>
        <VariantEditor body={r.reply} variants={r.replyVariants} rotation={r.rotation} vars={SAMPLE_VARS} maxLen={1000}
          onChange={(v) => setR((p) => ({ ...p, replyVariants: v.variants, rotation: v.rotation }))} />
        <p className="help">Variasi acak: {'{Halo|Hai|Selamat datang}'} dipilih acak agar balasan tidak identik.</p>
        <label>Pratinjau (contoh data)</label>
        <div className="preview" aria-live="polite">{preview || <span className="mut">(kosong)</span>}</div>

        <label htmlFor="f-mode">Mode</label>
        <select id="f-mode" value={r.mode} onChange={(e) => set('mode', e.target.value as ArRule['mode'])}>
          <option value="draft">Draft (Anda yang menekan kirim)</option>
          <option value="auto" disabled={modeAutoBlocked}>Auto (kirim otomatis){modeAutoBlocked ? ' - tidak tersedia di versi Store' : ''}</option>
        </select>
        <p className="help">Mode Auto tetap butuh saklar "Auto-kirim" di atas. Berisiko pada akun WhatsApp: baca tab Keamanan.</p>

        <div className="row" style={{ marginTop: 8 }}>
          <div><label htmlFor="f-d0">Jeda min (detik)</label>
            <input id="f-d0" type="number" min={0} style={{ width: 80 }} value={r.delaySec[0]} onChange={(e) => set('delaySec', [num(e.target.value, 4), r.delaySec[1]])} /></div>
          <div><label htmlFor="f-d1">Jeda maks (detik)</label>
            <input id="f-d1" type="number" min={0} style={{ width: 80 }} value={r.delaySec[1]} onChange={(e) => set('delaySec', [r.delaySec[0], num(e.target.value, 12)])} /></div>
          <div><label htmlFor="f-cd">Cooldown per chat (menit)</label>
            <input id="f-cd" type="number" min={0} style={{ width: 90 }} value={r.cooldownMin} onChange={(e) => set('cooldownMin', num(e.target.value, 360))} /></div>
          <div><label htmlFor="f-mx">Maks kirim/jam</label>
            <input id="f-mx" type="number" min={1} max={60} style={{ width: 80 }} value={r.maxPerHour} onChange={(e) => set('maxPerHour', num(e.target.value, 20))} /></div>
        </div>
        <label className="row" style={{ marginTop: 8, fontWeight: 400 }}>
          <input type="checkbox" checked={r.onlyNewLeads} onChange={(e) => set('onlyNewLeads', e.target.checked)} /> Hanya untuk lead baru (belum pernah kita balas)
        </label>

        <div className="fixed">
          <b>Pengaman tetap (tidak bisa diubah)</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            <li>Tidak pernah membalas grup, broadcast, atau status.</li>
            <li>Tidak pernah membalas kontak yang ditandai opt-out di CRM.</li>
            <li>Berhenti jika Anda sudah membalas sendiri setelah pesan masuk.</li>
          </ul>
        </div>

        {errors.length > 0 && <ul className="err" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="pri" disabled={errors.length > 0} onClick={() => void save()}>Simpan</button>
          <button onClick={onClose}>Batal</button>
        </div>
      </aside>
    </>
  );
}

// ---------------- log ----------------
function Log() {
  const log = useLive(() => db.arLog.orderBy('ts').reverse().limit(500).toArray(), [] as ArLogEntry[]);
  const [f, setF] = useState<'all' | 'draft' | 'sent' | 'skipped'>('all');
  const [q, setQ] = useState('');
  const rows = log.filter((l) => (f === 'all' || l.action === f) && (!q.trim() || (l.chatName + l.ruleName + l.reason).toLowerCase().includes(q.trim().toLowerCase())));
  const label = { draft: 'Draft', sent: 'Terkirim', skipped: 'Dilewati' } as const;
  const cls = { draft: 'ok', sent: 'warn', skipped: 'bad' } as const;
  const clear = async () => { if (confirm('Hapus seluruh log auto-reply? Cooldown dan batas per jam akan ikut reset.')) await db.arLog.clear(); };
  return (
    <div className="fillcol">
      <div className="bar">
        <select value={f} onChange={(e) => setF(e.target.value as typeof f)} aria-label="Filter aksi">
          <option value="all">Semua aksi</option><option value="draft">Draft</option><option value="sent">Terkirim</option><option value="skipped">Dilewati</option>
        </select>
        <input placeholder="Cari chat / aturan / alasan" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari" />
        <button className="danger" onClick={() => void clear()}>Kosongkan log</button>
        <span className="mut">{rows.length} entri</span>
      </div>
      <ScrollTable stickyFirst label="Log auto-reply">
        <table>
          <thead><tr><th>Waktu</th><th>Chat</th><th>Aturan</th><th>Aksi</th><th className="wrap">Alasan</th><th className="wrap">Isi</th></tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td>{fmt(l.ts)}</td><td>{l.chatName || l.chatKey}</td><td>{l.ruleName}</td>
                <td><span className={'pill ' + cls[l.action]}>{label[l.action]}</span></td>
                <td className="wrap">{l.reason}</td><td className="mut wrap">{l.text.slice(0, 140)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="mut">Belum ada aktivitas.</td></tr>}
          </tbody>
        </table>
      </ScrollTable>
    </div>
  );
}

// ---------------- safety ----------------
function Safety() {
  return (
    <div className="banner warn">
      <h2>Batas keamanan &amp; risiko blokir</h2>
      <p>WhatsApp melarang pesan otomatis/massal yang tidak diminta dan dapat memblokir nomor yang dianggap spam. Fitur ini dirancang konservatif, tetapi tidak ada jaminan 100% aman.</p>
      <ul className="safe">
        <li><b>Hanya membalas orang yang menulis lebih dulu.</b> Tidak pernah memulai percakapan, tidak untuk blast/promosi tak diminta.</li>
        <li><b>Tidak pernah membalas grup, broadcast, status.</b> Dikunci, tidak bisa diubah.</li>
        <li><b>Kontak opt-out di CRM dilewati.</b> Tandai pelanggan yang meminta berhenti.</li>
        <li><b>Berhenti jika Anda membalas sendiri.</b> Dicek lagi tepat sebelum kirim.</li>
        <li><b>Jeda acak</b> (default 4-12 detik) dan <b>variasi teks</b> (spintax) supaya tidak terlihat seperti robot.</li>
        <li><b>Cooldown per chat</b> (default 6 jam per aturan) dan <b>maksimum 20 kirim/jam</b> secara global.</li>
        <li><b>Mulai dari mode Draft.</b> Pakai Auto-kirim hanya setelah teks aturan Anda teruji, dan hanya untuk pelanggan yang memang menghubungi Anda.</li>
        <li><b>Bergantung pada WhatsApp Web.</b> Auto-reply hanya jalan saat tab WhatsApp Web terbuka. Jika WhatsApp mengubah internalnya, kirim otomatis bisa gagal (dicatat di Log) dan tidak pernah dipalsukan sebagai terkirim.</li>
        {!IS_FULL && <li><b>Versi Store:</b> semua balasan berupa draft yang Anda kirim sendiri.</li>}
      </ul>
    </div>
  );
}
