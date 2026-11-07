import { useEffect, useState, type ReactNode } from 'react';
import { IS_FULL } from '../shared/credit';
import { HEALTH_PREFIX, HONESTY_BG, HONESTY_RISK, RUN_KEY, isFresh, loadRun, setEnabled, type HealthMap, type RunState } from '../shared/runmode';
import { readAllHealth } from '../content/engine-health';

const WA = 'https://web.whatsapp.com/*';
const QS_KEY = 'wwt-qs';
type Marks = { diag?: boolean; preset?: boolean };
type St = 'ok' | 'warn' | 'wait';

const openPage = (path: string) => {
  const url = chrome.runtime.getURL(path);
  try { void chrome.tabs.create({ url }); } catch { window.open(url, '_blank', 'noopener'); }
};

function Step(p: { n: number; st: St; title: string; text: string; hint?: string; children?: ReactNode }) {
  const icon = p.st === 'ok' ? '✔' : p.st === 'warn' ? '!' : '…';
  const label = p.st === 'ok' ? 'Siap' : p.st === 'warn' ? 'Perlu perbaikan' : 'Menunggu';
  return (
    <li className={`qs-card ${p.st}`}>
      <span className="qs-n" aria-hidden="true">{p.n}</span>
      <div className="qs-body">
        <h2>{p.title} <span className={`qs-st ${p.st}`} role="img" aria-label={label}>{icon}</span></h2>
        <p>{p.text}</p>
        {p.st === 'warn' && p.hint ? <p className="qs-fix"><b>Perbaiki:</b> {p.hint}</p> : null}
        <div className="qs-act">{p.children}</div>
      </div>
    </li>
  );
}

export function App() {
  const [tabs, setTabs] = useState<number | null>(null);
  const [health, setHealth] = useState<HealthMap>({});
  const [run, setRun] = useState<RunState | null>(null);
  const [marks, setMarks] = useState<Marks>({});
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [t, h, r, m] = await Promise.all([
          chrome.tabs.query({ url: WA }).then((x) => x.length).catch(() => 0),
          readAllHealth(), loadRun(IS_FULL), chrome.storage.local.get(QS_KEY),
        ]);
        if (!alive) return;
        setTabs(t); setHealth(h); setRun(r); setMarks((m?.[QS_KEY] as Marks) ?? {}); setNow(Date.now());
      } catch { /* ignore */ }
    };
    void load();
    const t = setInterval(() => void load(), 3000);
    const onCh = (ch: Record<string, chrome.storage.StorageChange>) => { if (RUN_KEY in ch || QS_KEY in ch || Object.keys(ch).some((k) => k.startsWith(HEALTH_PREFIX))) void load(); };
    try { chrome.storage.onChanged.addListener(onCh); } catch { /* ignore */ }
    return () => { alive = false; clearInterval(t); try { chrome.storage.onChanged.removeListener(onCh); } catch { /* ignore */ } };
  }, []);

  const mark = (k: keyof Marks) => { const next = { ...marks, [k]: true }; setMarks(next); void chrome.storage.local.set({ [QS_KEY]: next }); };
  const acc = health.accountStatus;
  const accFresh = isFresh(acc, now);

  let s1: St = 'wait', t1 = 'Memeriksa tab WhatsApp Web...', h1 = '';
  if (tabs === 0) { s1 = 'warn'; t1 = 'Tab WhatsApp Web belum dibuka.'; h1 = 'Klik tombol "Buka WhatsApp Web", lalu scan kode QR dari HP (WhatsApp > Perangkat tertaut > Tautkan perangkat).'; }
  else if (tabs && accFresh && acc.code === 'online') { s1 = 'ok'; t1 = 'WhatsApp sudah login dan tersambung.'; }
  else if (tabs && accFresh && acc.code === 'qr') { s1 = 'warn'; t1 = 'Menunggu Anda scan kode QR.'; h1 = 'Buka WhatsApp di HP, pilih Perangkat tertaut, lalu arahkan kamera ke kode QR di layar.'; }
  else if (tabs && accFresh && (acc.code === 'offline' || acc.code === 'logged-out')) { s1 = 'warn'; t1 = acc.detail ?? 'WhatsApp belum tersambung.'; h1 = 'Cek internet Anda, lalu muat ulang tab WhatsApp Web atau login ulang.'; }
  else if (tabs) { t1 = 'Tab terbuka, menunggu WhatsApp selesai memuat...'; }

  let s2: St = 'wait', t2 = 'Menunggu langkah 1.', h2 = '';
  if (s1 === 'ok') {
    if (acc?.ready) { s2 = 'ok'; t2 = 'Koneksi ke WhatsApp Web siap (adapter dan data terdeteksi).'; }
    else { s2 = 'warn'; t2 = 'Adapter belum mendeteksi data WhatsApp.'; h2 = 'Muat ulang tab WhatsApp Web (Ctrl+R) dan tunggu daftar chat tampil. Jika tetap gagal, versi WhatsApp mungkin berubah; coba Diagnostik pengirim.'; }
  }
  const s3: St = marks.diag ? 'ok' : 'wait';
  const s4: St = marks.preset ? 'ok' : 'wait';
  const s5: St = !IS_FULL ? 'ok' : run?.enabled ? 'ok' : run ? 'warn' : 'wait';
  const done = [s1, s2, s3, s4, s5].filter((x) => x === 'ok').length;

  return (
    <main className="qs">
      <header>
        <h1>Mulai cepat</h1>
        <p>{done} dari 5 langkah siap. Ikuti urutannya; langkah 1, 2, dan 5 diperiksa otomatis.</p>
        <div className="qs-bar" role="progressbar" aria-valuemin={0} aria-valuemax={5} aria-valuenow={done}><i style={{ width: `${done * 20}%` }} /></div>
      </header>
      <section className="qs-info" aria-label="Penting">
        <p><b>Perlu diketahui:</b> {HONESTY_BG}</p>
        <p>{HONESTY_RISK}</p>
        {!IS_FULL ? <p><b>Mode draf:</b> Edisi Toko tidak mengirim otomatis. Pesan hanya disiapkan, Anda yang menekan Kirim.</p> : null}
      </section>
      <ol className="qs-list">
        <Step n={1} st={s1} title="Buka WhatsApp Web & login (scan QR)" text={t1} hint={h1}>
          <button className="qs-btn pri" onClick={() => void chrome.tabs.create({ url: 'https://web.whatsapp.com' })}>Buka WhatsApp Web</button>
        </Step>
        <Step n={2} st={s2} title="Cek koneksi" text={t2} hint={h2} />
        <Step n={3} st={s3} title="Uji kirim senyap" text="Coba satu kali agar Anda tahu pengiriman otomatis berfungsi di akun Anda (opsional, disarankan sebelum memakai balas otomatis).">
          <button className="qs-btn" onClick={() => { mark('diag'); openPage('autoreply/index.html#diag'); }}>Buka Diagnostik pengirim</button>
          {!marks.diag ? <button className="qs-btn ghost" onClick={() => mark('diag')}>Lewati / sudah</button> : null}
        </Step>
        <Step n={4} st={s4} title="Pilih preset industri" text="Pasang contoh template, aturan, dan tahap pipeline sesuai jenis usaha Anda. Tidak ada yang aktif sendiri.">
          <button className="qs-btn" onClick={() => { mark('preset'); openPage('presets/index.html'); }}>Buka Preset Industri</button>
          {!marks.preset ? <button className="qs-btn ghost" onClick={() => mark('preset')}>Lewati / sudah</button> : null}
        </Step>
        <Step n={5} st={s5} title="Aktifkan Mode Otomatis"
          text={IS_FULL ? 'Pencatat aktivitas, hemat memori, status akun, dan kirim terjadwal berjalan di latar belakang. Balas otomatis tetap mati sampai Anda menyalakannya sendiri.' : 'Edisi Toko selalu dalam mode draf. Tidak ada yang dikirim otomatis.'}
          hint="Nyalakan saklar di bawah ini.">
          {IS_FULL ? (
            <label className="qs-sw">
              <input type="checkbox" checked={!!run?.enabled} disabled={!run} onChange={(e) => { void setEnabled(e.target.checked).then(setRun); }} />
              <span>{run?.enabled ? 'Mode Otomatis menyala' : 'Mode Otomatis mati'}</span>
            </label>
          ) : null}
        </Step>
      </ol>
      <footer><p>Pantau kapan saja lewat ikon <b>Status</b> di bilah kiri WhatsApp Web. Tombol "Jeda semua" menghentikan semuanya sementara.</p></footer>
    </main>
  );
}
