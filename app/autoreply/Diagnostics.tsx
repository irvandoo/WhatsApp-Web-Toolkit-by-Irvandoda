import { useEffect, useState } from 'react';
import { IS_FULL } from '../shared/credit';
import { diagError, formatProbe, formatSelfTest } from '../shared/diag-format';
import { DEFAULT_SEND_SETTINGS, SEND_SETTINGS_KEY, type ProbeResult, type SendResult, type SendSettings } from '../shared/messages';

type Reply<T> = { ok: boolean; data?: T; error?: string };
const ask = async <T,>(m: unknown): Promise<Reply<T>> => {
  try { return ((await chrome.runtime.sendMessage(m)) as Reply<T>) ?? { ok: false, error: 'no-response' }; } catch { return { ok: false, error: 'no-receiver' }; }
};

/** 'Diagnostik pengirim': probes WhatsApp internals (sends nothing) and can send ONE test message to your own chat. */
export function Diagnostics() {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState('');
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [s, setS] = useState<SendSettings>(DEFAULT_SEND_SETTINGS);

  useEffect(() => {
    chrome.storage.local.get(SEND_SETTINGS_KEY).then((r) => setS({ ...DEFAULT_SEND_SETTINGS, ...(r[SEND_SETTINGS_KEY] ?? {}) }), () => {});
  }, []);
  const saveDom = (v: boolean) => { const n = { ...s, allowDomMacro: v }; setS(n); void chrome.storage.local.set({ [SEND_SETTINGS_KEY]: n }); };

  const run = async () => {
    setBusy(true); setCopied(false);
    const r = await ask<ProbeResult>({ kind: 'diag:probe' });
    if (r.ok && r.data) { setProbe(r.data); setOut(formatProbe(r.data)); } else { setProbe(null); setOut(`✘ Diagnostik gagal: ${diagError(r.error ?? 'unknown')}`); }
    setBusy(false);
  };
  const selfTest = async () => {
    setBusy(true); setCopied(false);
    const kill = await chrome.storage.local.get('ob:kill').catch(() => ({} as Record<string, unknown>));
    if (kill['ob:kill']) { setOut((o) => `${o}\n\n✘ Kirim uji dibatalkan: Stop global sedang aktif.`.trim()); setBusy(false); return; }
    const r = await ask<SendResult>({ kind: 'diag:selftest', allowDom: s.allowDomMacro && IS_FULL });
    const line = r.ok && r.data ? formatSelfTest(r.data) : formatSelfTest({ error: r.error ?? 'unknown' });
    setOut((o) => `${o ? o + '\n\n' : ''}${line}`);
    setConfirm(false); setBusy(false);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(out); setCopied(true); } catch { setCopied(false); } };

  return (
    <div className="diag" id="diag">
      <div className="banner warn">
        <h2>Diagnostik pengirim</h2>
        <p>Mengecek apakah WhatsApp Web di tab Anda menyediakan jalur kirim senyap (tanpa membuka chat). Internal WhatsApp sering berubah, jadi hasil ini adalah fakta di browser Anda. Tab WhatsApp Web harus terbuka.</p>
        <p><b>Peringatan:</b> pengiriman otomatis dapat membuat WhatsApp membatasi atau memblokir akun. Pakai hanya untuk orang yang menghubungi Anda, dengan jeda dan batas yang konservatif.</p>
        {!IS_FULL && <p>Versi Store: pengiriman otomatis sengaja dimatikan (balasan selalu draft). Pengecekan tetap bisa dijalankan.</p>}
      </div>
      <div className="bar">
        <button className="pri" onClick={() => void run()} disabled={busy}>{busy ? 'Memeriksa...' : 'Uji kemampuan kirim senyap'}</button>
        <button onClick={() => void copy()} disabled={!out}>{copied ? 'Tersalin' : 'Salin hasil'}</button>
      </div>
      <label className="row" style={{ fontWeight: 400, margin: '6px 0' }}>
        <input type="checkbox" checked={s.allowDomMacro && IS_FULL} disabled={!IS_FULL} onChange={(e) => saveDom(e.target.checked)} />
        <span><b>Izinkan macro DOM</b> (cadangan, TERLIHAT di layar): jika jalur internal gagal, WhatsApp Web membuka chat tujuan sebentar, mengisi teks lalu menekan Kirim, kemudian kembali ke chat sebelumnya. Default mati.</span>
      </label>
      <div className="fixed">
        <b>Kirim uji ke nomor saya</b>
        <p className="help">Mengirim satu pesan &quot;Tes WhatsApp Web Toolkit&quot; ke chat Anda sendiri, lalu memeriksa apakah pesan benar-benar muncul di chat (terverifikasi).</p>
        <label className="row" style={{ fontWeight: 400 }}>
          <input type="checkbox" checked={confirm} disabled={!IS_FULL} onChange={(e) => setConfirm(e.target.checked)} />
          Saya paham ini benar-benar mengirim satu pesan dari akun saya ke nomor saya sendiri.
        </label>
        <button onClick={() => void selfTest()} disabled={busy || !confirm || !IS_FULL} style={{ marginTop: 6 }}>Kirim uji ke nomor saya</button>
        {!IS_FULL && <p className="help">Tidak tersedia di versi Store.</p>}
      </div>
      {out && <pre className="diag-out" aria-live="polite">{out}</pre>}
      {probe && !probe.store && <p className="help">Store WhatsApp belum terdeteksi: tunggu WhatsApp Web selesai dimuat lalu ulangi.</p>}
    </div>
  );
}
