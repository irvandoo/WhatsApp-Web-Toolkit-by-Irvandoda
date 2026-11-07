import { useState } from 'react';
import type { ExplainResult } from '../shared/messages';

type Reply = { ok: boolean; data?: ExplainResult; error?: string };

/** "Mengapa auto-reply tidak membalas?": dry run of every precondition + what the engine would do for the newest inbound messages. */
export function Explain() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ExplainResult | null>(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setBusy(true); setErr(''); setCopied(false);
    try {
      const r = ((await chrome.runtime.sendMessage({ kind: 'diag:explain' })) as Reply) ?? { ok: false, error: 'no-response' };
      if (r.ok && r.data) setRes(r.data);
      else { setRes(null); setErr(r.error === 'no-tab' ? 'Tab WhatsApp Web belum terbuka. Buka dulu web.whatsapp.com.' : r.error === 'no-receiver' ? 'Tab WhatsApp belum memuat ekstensi. Muat ulang tab WhatsApp lalu coba lagi.' : `Gagal: ${r.error ?? 'tidak ada jawaban'}`); }
    } catch (e) { setRes(null); setErr(`Gagal: ${String(e)}`); } finally { setBusy(false); }
  };

  const text = () => !res ? '' : [
    ...res.checks.map((c) => `${c.ok ? '[OK]' : '[GAGAL]'} ${c.label}: ${c.detail}`),
    '', 'Pesan masuk terbaru:',
    ...res.items.map((i) => `- ${i.name}${i.isGroup ? ' (grup)' : ''} | "${i.text}" | ${i.ageMin} mnt lalu | ${i.decision} | ${i.reason}`),
  ].join('\n');
  const copy = async () => { try { await navigator.clipboard.writeText(text()); setCopied(true); } catch { setErr('Tidak bisa menyalin otomatis. Blok teks lalu salin manual.'); } };
  const firstFail = res?.checks.find((c) => !c.ok);

  return (
    <div className="card" id="explain">
      <h2>Mengapa auto-reply tidak membalas?</h2>
      <p className="mut">Cek semua syarat satu per satu dan simulasikan apa yang akan dilakukan mesin untuk pesan masuk terbaru. Tidak mengirim apa pun. Buka tab WhatsApp Web lebih dulu.</p>
      <div className="row"><button className="pri" onClick={run} disabled={busy}>{busy ? 'Memeriksa…' : 'Periksa sekarang'}</button>{res && <button onClick={copy}>{copied ? 'Tersalin' : 'Salin hasil'}</button>}</div>
      {err && <p className="err" role="alert">{err}</p>}
      {res && (
        <div aria-live="polite">
          {firstFail && <p className="err"><b>Penyebab utama:</b> {firstFail.label}. {firstFail.detail}</p>}
          {!firstFail && <p className="okc"><b>Semua syarat terpenuhi.</b> Lihat tabel di bawah untuk keputusan tiap pesan.</p>}
          <ul className="exp-list">{res.checks.map((c, i) => <li key={i} className={c.ok ? 'okc' : 'err'}>{c.ok ? '✔' : '✘'} <b>{c.label}</b>: <span className="mut">{c.detail}</span></li>)}</ul>
          <h3>Pesan masuk terbaru</h3>
          {res.items.length === 0 ? <p className="mut">Tidak ada pesan teks masuk yang terbaca.</p> : (
            <div className="st-wrap"><div className="st-scroll" style={{ maxHeight: 'max(200px, 40vh)' }} tabIndex={0} role="region" aria-label="Keputusan per pesan">
              <table><thead><tr><th>Kontak</th><th>Pesan</th><th className="num">Umur</th><th>Keputusan</th><th className="wrap">Alasan</th></tr></thead>
                <tbody>{res.items.map((i, k) => (
                  <tr key={k}><td>{i.name}{i.isGroup ? ' (grup)' : ''}</td><td className="wrap">{i.text}</td><td className="num">{i.ageMin} mnt</td><td>{i.decision}</td><td className="wrap">{i.reason}</td></tr>
                ))}</tbody></table>
            </div></div>
          )}
        </div>
      )}
    </div>
  );
}
