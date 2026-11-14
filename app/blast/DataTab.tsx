import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '../shared/db';
import { ACTIVITY_KEY, sanitizeActivity } from '../shared/outbox-activity';
import { CLEAN_LABEL, buildBackup, cleanPlan, parseBackup, prepareRestore, type CleanKind } from './backup-logic';
import { DRAFT_KEY, clearDraft, sanitizeDraft } from './draft';

interface Counts { campaigns: number; running: number; items: number; schedules: number; sendLog: number; activity: number; draft: boolean }

const KINDS: CleanKind[] = ['draft', 'activity', 'sendLog', 'finished', 'schedules', 'campaigns'];

async function readCounts(): Promise<Counts> {
  const got = await chrome.storage.local.get([ACTIVITY_KEY, DRAFT_KEY]).catch(() => ({} as Record<string, unknown>));
  const camps = await db.campaigns.toArray();
  return {
    campaigns: camps.length, running: camps.filter((c) => c.status === 'running').length,
    items: await db.outbox.count(), schedules: await db.schedules.count(), sendLog: await db.sendLog.count(),
    activity: sanitizeActivity(got[ACTIVITY_KEY]).length, draft: !!sanitizeDraft(got[DRAFT_KEY]),
  };
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** "Data": what is stored on this PC, backup/restore to a file, and the ONLY place where Blast data is deliberately erased. */
export function DataTab() {
  const [c, setC] = useState<Counts | null>(null);
  const [sel, setSel] = useState<Set<CleanKind>>(new Set());
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => { void readCounts().then(setC, () => {}); }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t); }, [refresh]);

  const plan = c ? cleanPlan([...sel], { campaigns: [], outbox: [], schedules: [], sendLog: c.sendLog, activity: c.activity }) : null;

  const backup = async () => {
    setBusy(true); setMsg(null);
    try {
      const got = await chrome.storage.local.get([ACTIVITY_KEY, DRAFT_KEY]);
      const b = buildBackup({
        campaigns: await db.campaigns.toArray(), outbox: await db.outbox.toArray(), schedules: await db.schedules.toArray(),
        sendLog: await db.sendLog.toArray(), activity: sanitizeActivity(got[ACTIVITY_KEY]), draft: sanitizeDraft(got[DRAFT_KEY]),
      });
      const d = new Date(), p2 = (n: number) => String(n).padStart(2, '0');
      download(`cadangan-blast-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.json`, JSON.stringify(b));
      setMsg({ ok: true, t: `Cadangan diunduh: ${b.campaigns.length} kampanye, ${b.outbox.length} pesan antrean, ${b.schedules.length} jadwal.` });
    } catch (e) { setMsg({ ok: false, t: `Gagal membuat cadangan: ${String(e)}` }); } finally { setBusy(false); }
  };

  const restore = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setMsg(null);
    try {
      const r = parseBackup(await f.text());
      if (!r.ok) { setMsg({ ok: false, t: r.error }); return; }
      if (!confirm(`Pulihkan ${r.backup.campaigns.length} kampanye, ${r.backup.outbox.length} pesan antrean, ${r.backup.schedules.length} jadwal dari cadangan? Data dengan ID yang sama akan ditimpa. Kampanye yang berjalan dipulihkan dalam keadaan DIJEDA, dan jadwal dinonaktifkan.`)) return;
      const b = prepareRestore(r.backup);
      await db.transaction('rw', [db.campaigns, db.outbox, db.schedules, db.sendLog], async () => {
        await db.campaigns.bulkPut(b.campaigns); await db.outbox.bulkPut(b.outbox);
        await db.schedules.bulkPut(b.schedules); await db.sendLog.bulkPut(b.sendLog);
      });
      const got = await chrome.storage.local.get(ACTIVITY_KEY);
      const merged = [...sanitizeActivity(got[ACTIVITY_KEY]), ...b.activity].sort((x, y) => x.ts - y.ts);
      const seen = new Set<string>();
      await chrome.storage.local.set({ [ACTIVITY_KEY]: merged.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).slice(-300) });
      if (b.draft) await chrome.storage.local.set({ [DRAFT_KEY]: b.draft });
      setMsg({ ok: true, t: `Dipulihkan. ${r.dropped ? `${r.dropped} baris rusak dilewati. ` : ''}Kampanye yang tadinya berjalan sekarang dijeda, lanjutkan dari tab Berjalan.` });
      refresh();
    } catch (e) { setMsg({ ok: false, t: `Gagal memulihkan: ${String(e)}` }); } finally { setBusy(false); if (file.current) file.current.value = ''; }
  };

  const clean = async () => {
    setBusy(true); setMsg(null);
    try {
      const camps = await db.campaigns.toArray(), items = await db.outbox.toArray();
      const p = cleanPlan([...sel], { campaigns: camps, outbox: items, schedules: await db.schedules.toArray(), sendLog: c?.sendLog ?? 0, activity: c?.activity ?? 0 });
      if (p.blocked) { setMsg({ ok: false, t: p.blocked }); return; }
      if (p.campaignIds.length) {
        await db.outbox.where('campaignId').anyOf(p.campaignIds).delete();
        await db.campaigns.bulkDelete(p.campaignIds);
        await db.campaignMedia.bulkDelete(p.campaignIds);
      }
      if (sel.has('schedules')) await db.schedules.clear();
      if (sel.has('sendLog')) await db.sendLog.clear();
      if (sel.has('activity')) await chrome.storage.local.set({ [ACTIVITY_KEY]: [] });
      if (sel.has('draft')) await clearDraft();
      setMsg({ ok: true, t: 'Data yang dipilih sudah dihapus.' });
      setSel(new Set()); setTyped('');
      refresh();
    } catch (e) { setMsg({ ok: false, t: `Gagal menghapus: ${String(e)}` }); } finally { setBusy(false); }
  };

  const toggle = (k: CleanKind) => { const n = new Set(sel); if (n.has(k)) n.delete(k); else n.add(k); setSel(n); setTyped(''); };
  const canClean = sel.size > 0 && typed.trim().toUpperCase() === 'HAPUS' && !busy;

  return (
    <section aria-label="Data Blast">
      <div className="card">
        <h2>Data tersimpan di komputer ini</h2>
        <p className="mut">Kampanye, antrean pesan, jadwal, log, dan draf isian disimpan otomatis di penyimpanan browser (profil Chrome) di komputer ini. Memuat ulang atau menutup tab WhatsApp <b>tidak</b> menghapusnya. Data baru terhapus bila kamu memakai &quot;Bersihkan&quot; di bawah, menghapus ekstensi, atau menghapus data browser. Karena itu, buat cadangan berkala.</p>
        {c ? (
          <ul className="datalist">
            <li><b>{c.campaigns}</b> kampanye{c.running ? ` (${c.running} berjalan)` : ''}</li>
            <li><b>{c.items}</b> pesan di antrean</li>
            <li><b>{c.schedules}</b> pesan terjadwal</li>
            <li><b>{c.sendLog}</b> catatan log kirim</li>
            <li><b>{c.activity}</b> kejadian log aktivitas</li>
            <li>Draf isian: <b>{c.draft ? 'ada (dipulihkan otomatis saat halaman dibuka)' : 'kosong'}</b></li>
          </ul>
        ) : <p className="mut">Memuat…</p>}
      </div>

      <div className="card">
        <h2>Cadangan</h2>
        <p className="mut">Simpan semua data Blast ke satu berkas JSON, atau pulihkan dari berkas itu. Berkas disimpan di folder unduhan, jadi aman walau ekstensi dihapus. Isi berkas termasuk nomor penerima: jaga kerahasiaannya.</p>
        <div className="row">
          <button className="pri" onClick={() => void backup()} disabled={busy}>Unduh cadangan (.json)</button>
          <button onClick={() => file.current?.click()} disabled={busy}>Pulihkan dari berkas…</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void restore(e.target.files?.[0])} aria-label="Pilih berkas cadangan" />
        </div>
      </div>

      <div className="card">
        <h2>Bersihkan data</h2>
        <p className="mut">Satu-satunya cara menghapus data Blast dari dalam ekstensi. Pilih apa yang dihapus, lalu ketik <b>HAPUS</b> untuk konfirmasi. Tindakan ini tidak bisa dibatalkan; unduh cadangan dulu bila perlu.</p>
        <div role="group" aria-label="Pilih data yang dihapus">
          {KINDS.map((k) => (
            <label key={k} className="chk"><input type="checkbox" checked={sel.has(k)} onChange={() => toggle(k)} /><span>{CLEAN_LABEL[k]}</span></label>
          ))}
        </div>
        {plan?.blocked && <p className="err" role="alert">{plan.blocked}</p>}
        <div className="row" style={{ marginTop: 8 }}>
          <label className="f" style={{ margin: 0 }}>Ketik HAPUS
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="HAPUS" disabled={sel.size === 0} aria-label="Ketik HAPUS untuk konfirmasi" />
          </label>
          <button className="bad" onClick={() => void clean()} disabled={!canClean}>Hapus data terpilih</button>
        </div>
      </div>

      {msg && <p className={msg.ok ? 'okc' : 'err'} role="status">{msg.t}</p>}
    </section>
  );
}
