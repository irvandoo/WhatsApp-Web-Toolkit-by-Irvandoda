import { useState } from 'react';
import { ScrollTable } from '../shared/ui/ScrollTable';
import { SOURCE_LABEL, type DuplicateInfo, type ExcludedInfo, type InvalidInfo, type MergedRecipient } from '../shared/recipients-logic';

const PAGE = 200;
type Filter = 'all' | 'valid' | 'invalid';

const SrcBadge = ({ s }: { s: keyof typeof SOURCE_LABEL }) => <span className={`rp-src ${s}`}>{SOURCE_LABEL[s]}</span>;

function InvalidCell({ inv, onFix }: { inv: InvalidInfo; onFix: (v: string) => string | null }) {
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  const apply = () => { const e = onFix(v); setErr(e ?? ''); };
  return (
    <div className="row">
      <input aria-label={`Perbaiki nomor ${inv.original}`} value={v} placeholder="Ketik nomor yang benar" inputMode="tel"
        onChange={(e) => { setV(e.target.value); setErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} />
      <button onClick={apply} disabled={!v.trim()}>Perbaiki</button>
      {err && <span className="err" role="alert">{err}</span>}
    </div>
  );
}

export function RecipientTable({ unique, invalid, duplicates, excluded, onFix, onRemove, onDismissInvalid, onExport, onReset }: {
  unique: MergedRecipient[];
  invalid: InvalidInfo[];
  duplicates: DuplicateInfo[];
  excluded: ExcludedInfo[];
  onFix: (invalidIndex: number, value: string) => string | null;
  onRemove: (phone: string) => void;
  onDismissInvalid: () => void;
  onExport: () => void;
  onReset: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [n, setN] = useState(PAGE);
  const showInv = filter !== 'valid';
  const showOk = filter !== 'invalid';
  const total = (showInv ? invalid.length : 0) + (showOk ? unique.length : 0);
  if (!unique.length && !invalid.length && !duplicates.length && !excluded.length) return <p className="mut">Belum ada penerima. Pilih sumber di atas.</p>;

  // valid numbers first (they are what the user sends to), invalid ones after: otherwise 900+ invalid rows hide the good ones
  const okRows = showOk ? unique.slice(0, n) : [];
  const invRows = showInv ? invalid.map((inv, idx) => ({ inv, idx })).slice(0, Math.max(0, n - okRows.length)) : [];
  let row = 0;
  return (
    <div style={{ marginTop: 6 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <select aria-label="Filter tabel" value={filter} onChange={(e) => { setFilter(e.target.value as Filter); setN(PAGE); }}>
          <option value="all">Semua</option><option value="valid">Valid saja</option><option value="invalid">Tidak valid saja</option>
        </select>
        <button className="bad" disabled={!invalid.length} onClick={onDismissInvalid}>Hapus semua tidak valid ({invalid.length})</button>
        <button disabled={!unique.length} onClick={onExport}>Ekspor CSV</button>
        <button onClick={() => { if (confirm('Kosongkan semua sumber penerima?')) onReset(); }}>Reset</button>
      </div>

      <ScrollTable maxHeight="max(260px, calc(100vh - 430px))" stickyFirst label="Daftar penerima gabungan">
        <table>
          <thead><tr><th className="num">#</th><th>Sumber</th><th>Nomor</th><th>Nama</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            {okRows.map((r) => (
              <tr key={r.phone}>
                <td className="num">{++row}</td>
                <td><SrcBadge s={r.source} />{r.sources.length > 1 && <span className="mut" title={r.sources.map((s) => SOURCE_LABEL[s]).join(', ')}> +{r.sources.length - 1}</span>}</td>
                <td>{r.phone}</td><td>{r.name ?? '-'}</td><td><span className="okc">Valid</span></td>
                <td><button className="bad" aria-label={`Hapus ${r.phone}`} onClick={() => onRemove(r.phone)}>Hapus</button></td>
              </tr>
            ))}
            {invRows.map(({ inv, idx }) => (
              <tr key={`i${idx}`}>
                <td className="num">{++row}</td><td><SrcBadge s={inv.source} /></td>
                <td className="err wrap">{inv.original || '-'}</td><td>-</td>
                <td className="err wrap">Tidak valid: {inv.reason}</td>
                <td className="rp-bad"><InvalidCell inv={inv} onFix={(v) => onFix(idx, v)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
      {total > n && (
        <div className="row" style={{ marginTop: 6 }}>
          <button onClick={() => setN(n + PAGE)}>Tampilkan {Math.min(PAGE, total - n)} lagi</button>
          <span className="mut">Menampilkan {Math.min(n, total)} dari {total}</span>
        </div>
      )}

      {duplicates.length > 0 && (
        <details className="rp-details">
          <summary>Duplikat dihapus ({duplicates.reduce((a, d) => a + d.count, 0)})</summary>
          <pre className="mini">{duplicates.slice(0, 500).map((d) => `${d.phone}: dipertahankan dari ${SOURCE_LABEL[d.kept]}, dihapus ${d.count}x (${d.removed.map((s) => SOURCE_LABEL[s]).join(', ')})`).join('\n')}</pre>
        </details>
      )}
      {excluded.length > 0 && (
        <details className="rp-details">
          <summary>Dikecualikan ({excluded.length})</summary>
          <pre className="mini">{excluded.slice(0, 500).map((e) => `${e.phone}${e.name ? ` (${e.name})` : ''}: ${e.reason === 'optout' ? 'opt-out CRM' : 'sudah pernah/sedang dikirimi'} [${SOURCE_LABEL[e.source]}]`).join('\n')}</pre>
        </details>
      )}
    </div>
  );
}
