import { useRef, useState } from 'react';
import type { Interaction, Summary, UnansweredRow } from '../shared/analytics-types';
import { exportInteractionsCsv, exportReportCsv, exportUnansweredCsv, parseReportCsv, reportTemplateCsv } from '../shared/analytics-logic';
import { ScrollTable } from '../shared/ui/ScrollTable';
import { download, downloadCsv, fmtDateTime, stamp } from './util';

interface Props { summary: Summary; unanswered: UnansweredRow[]; interactions: Interaction[]; toast: (m: string) => void }

export function Report({ summary, unanswered, interactions, toast }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ interactions: Interaction[]; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(f: File | undefined) {
    if (!f) return;
    try { setParsed(parseReportCsv(await f.text())); } catch { setParsed({ interactions: [], errors: ['File tidak dapat dibaca.'] }); }
  }
  async function confirmImport() {
    if (!parsed?.interactions.length) return;
    setBusy(true);
    try {
      await chrome.runtime.sendMessage({ kind: 'track:put', events: [], interactions: parsed.interactions });
      toast(`${parsed.interactions.length} interaksi diimpor.`);
      setParsed(null); if (fileRef.current) fileRef.current.value = '';
    } catch { toast('Gagal mengimpor.'); } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <section className="card">
        <h2>Ekspor</h2>
        <p className="muted" style={{ margin: 0 }}>Ringkasan mengikuti rentang, akun, dan opsi grup yang dipilih di atas.</p>
        <div className="btns">
          <button onClick={() => downloadCsv(`ringkasan-${stamp()}.csv`, exportReportCsv(summary))}>CSV ringkasan</button>
          <button onClick={() => downloadCsv(`belum-dibalas-${stamp()}.csv`, exportUnansweredCsv(unanswered))}>CSV belum dibalas</button>
          <button onClick={() => downloadCsv(`interaksi-${stamp()}.csv`, exportInteractionsCsv(interactions))}>CSV interaksi</button>
          <button onClick={() => download(`laporan-${stamp()}.json`, JSON.stringify({ summary, unanswered, interactions }, null, 2), 'application/json')}>JSON lengkap</button>
        </div>
      </section>

      <section className="card">
        <h2>Impor CSV</h2>
        <div className="btns">
          <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label="Pilih file CSV" onChange={(e) => void onFile(e.target.files?.[0])} />
          <button onClick={() => downloadCsv('template-laporan.csv', reportTemplateCsv())}>Unduh template CSV</button>
        </div>
        {parsed && (
          <div>
            {parsed.errors.length > 0 && (
              <div className="note" role="alert">
                <b className="err">{parsed.errors.length} masalah validasi</b>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18, maxHeight: 140, overflow: 'auto' }}>{parsed.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
            <p>{parsed.interactions.length} baris valid. Pratinjau 10 baris pertama:</p>
            {parsed.interactions.length > 0 && (
              <ScrollTable maxHeight="max(240px, 56vh)" stickyFirst label="Pratinjau impor"><table>
                <thead><tr><th>Nama</th><th>Nomor</th><th>Akun</th><th>Masuk pertama</th><th>Keluar pertama</th><th className="num">Masuk</th><th className="num">Keluar</th></tr></thead>
                <tbody>{parsed.interactions.slice(0, 10).map((i) => (
                  <tr key={i.key}><td>{i.name}</td><td>{i.phone}</td><td>{i.accountId}</td><td>{i.firstInTs ? fmtDateTime(i.firstInTs) : '-'}</td><td>{i.firstOutTs ? fmtDateTime(i.firstOutTs) : '-'}</td><td className="num">{i.inCount}</td><td className="num">{i.outCount}</td></tr>
                ))}</tbody>
              </table></ScrollTable>
            )}
            <div className="btns">
              <button className="primary" disabled={busy || !parsed.interactions.length} onClick={() => void confirmImport()}>Konfirmasi impor {parsed.interactions.length} baris</button>
              <button onClick={() => { setParsed(null); if (fileRef.current) fileRef.current.value = ''; }}>Batal</button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Penjelasan</h2>
        <h3>Definisi</h3>
        <ul style={{ marginTop: 0 }}>
          <li><b>WA Baru</b>: nomor yang pesan masuk pertamanya (yang terlihat) jatuh di periode ini dan belum pernah kita balas sebelum pesan itu. Dihitung pada hari pesan masuk pertama.</li>
          <li><b>Follow-up</b>: nomor yang sudah pernah kita balas, lalu mengirim atau menerima pesan lagi.</li>
          <li><b>Lama</b>: nomor yang sudah berinteraksi sebelum periode dan bukan WA Baru.</li>
          <li><b>Belum dibalas</b>: pesan masuk terakhir lebih baru daripada pesan keluar terakhir. Prioritas: Mendesak &gt; 24 jam, Tinggi &gt; 6 jam, Normal &gt; 1 jam, selebihnya Rendah.</li>
        </ul>
        <h3>Kolom template CSV</h3>
        <p className="muted" style={{ margin: 0 }}>Gunakan tombol Unduh template CSV; header kolom pada file tersebut harus dipertahankan. Setiap baris mewakili satu chat (akun + nomor) beserta waktu masuk/keluar pertama dan terakhir serta jumlah pesan.</p>
        <div className="note">Data hanya sejauh riwayat yang terlihat oleh WhatsApp Web. Chat lama yang belum dimuat dapat membuat &quot;pesan pertama&quot; tidak akurat (ditandai riwayat parsial).</div>
      </section>
    </div>
  );
}
