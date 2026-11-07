import { useState } from 'react';
import { fmtDateTime } from '../../shared/pos-logic';
import { STOCK_MOVE_LABEL } from '../../shared/pos-products-logic';
import type { Product, StockMove, StockMoveType } from '../../shared/pos-types';
import { ScrollTable } from '../../shared/ui/ScrollTable';
import { useLive, send } from '../util';
import { db } from '../../shared/db';

export function StockDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const hasV = !!product.variants?.length;
  const [variantId, setVariantId] = useState(product.variants?.[0]?.id ?? '');
  const [mode, setMode] = useState<'delta' | 'set'>('delta');
  const [val, setVal] = useState('');
  const [type, setType] = useState<'' | StockMoveType>('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const moves = useLive(async () => (await db.stockMoves.where('productId').equals(product.id).toArray()).sort((a, b) => b.ts - a.ts).slice(0, 200), [] as StockMove[]);
  const vname = (id: string | null) => (id ? product.variants?.find((v) => v.id === id)?.name ?? '-' : '-');
  const apply = async () => {
    try {
      setErr('');
      const n = Number(val);
      await send({ kind: 'pos:stock:adjust', id: product.id, variantId: hasV ? variantId : null, reason, ...(mode === 'set' ? { set: n } : { delta: n, ...(type ? { moveType: type } : {}) }) });
      setVal(''); setReason('');
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="dlg pm-dlg" onClick={(e) => e.stopPropagation()}>
        <h3>Stok: {product.name}</h3>
        <div className="grid">
          {hasV && <label>Varian<select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            {product.variants!.map((v) => <option key={v.id} value={v.id}>{v.name} (stok {v.stock ?? '∞'})</option>)}</select></label>}
          <label>Cara<select value={mode} onChange={(e) => setMode(e.target.value as 'delta' | 'set')}><option value="delta">Tambah / kurangi</option><option value="set">Set jumlah (opname)</option></select></label>
          <label>{mode === 'set' ? 'Stok baru' : 'Jumlah (+ masuk / - keluar)'}<input type="number" value={val} onChange={(e) => setVal(e.target.value)} /></label>
          {mode === 'delta' && <label>Jenis<select value={type} onChange={(e) => setType(e.target.value as '' | StockMoveType)}>
            <option value="">Otomatis</option>{(['masuk', 'keluar', 'retur'] as const).map((t) => <option key={t} value={t}>{STOCK_MOVE_LABEL[t]}</option>)}</select></label>}
          <label>Alasan (wajib)<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. restock supplier" /></label>
        </div>
        {err && <p className="note err">{err}</p>}
        <div className="bar"><button className="pri" disabled={val.trim() === ''} onClick={() => void apply()}>Terapkan</button><span className="sp" /><button onClick={onClose}>Tutup</button></div>
        <h4>Riwayat</h4>
        <ScrollTable maxHeight="30vh" label="Riwayat stok">
          <table>
            <thead><tr><th>Waktu</th><th>Jenis</th>{hasV && <th>Varian</th>}<th className="num">Jumlah</th><th className="num">Sebelum</th><th className="num">Sesudah</th><th>Alasan</th></tr></thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id}><td>{fmtDateTime(m.ts)}</td><td>{STOCK_MOVE_LABEL[m.type]}</td>{hasV && <td>{vname(m.variantId)}</td>}
                  <td className="num">{m.delta > 0 ? '+' : ''}{m.delta}</td><td className="num">{m.before ?? '∞'}</td><td className="num">{m.after ?? '∞'}</td><td className="wrap">{m.reason}</td></tr>
              ))}
              {!moves.length && <tr><td colSpan={7} className="mut">Belum ada riwayat.</td></tr>}
            </tbody>
          </table>
        </ScrollTable>
      </div>
    </div>
  );
}
