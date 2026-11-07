import { fmtDateTime, fmtIdr, lineTotal } from '../shared/pos-logic';
import { PAY_LABEL, STATUS_LABEL, type Order, type PosSettings } from '../shared/pos-types';

/** Printable invoice. On screen it is a preview; @media print shows only this element (see pos.css). */
export function Invoice({ o, s }: { o: Order; s: PosSettings }) {
  const thermal = s.paper === '80mm';
  const due = o.remaining > 0 && o.status !== 'cancelled';
  return (
    <div className={'print-area inv ' + (thermal ? 'th' : 'a4')}>
      <style>{thermal ? '@page{size:80mm auto;margin:3mm}' : '@page{size:A4;margin:14mm}'}</style>
      <header>
        <h2>{s.storeName}</h2>
        {s.address && <div>{s.address}</div>}
        {s.phone && <div>Telp: {s.phone}</div>}
      </header>
      <div className="meta">
        <div><span>Nota</span><b>{o.number}</b></div>
        <div><span>Tanggal</span><b>{fmtDateTime(o.createdAt)}</b></div>
        <div><span>Pelanggan</span><b>{o.customerName || 'Umum'}{o.customerPhone ? ` (${o.customerPhone})` : ''}</b></div>
        <div><span>Status</span><b>{STATUS_LABEL[o.status]} / {PAY_LABEL[o.method]}</b></div>
      </div>
      <table>
        <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Harga</th><th className="r">Jumlah</th></tr></thead>
        <tbody>
          {o.items.map((it, i) => (
            <tr key={i}>
              <td>{it.name}{it.discount > 0 && <div className="sm">Diskon -{fmtIdr(it.discount)}</div>}</td>
              <td className="r">{it.qty}</td><td className="r">{fmtIdr(it.price)}</td><td className="r">{fmtIdr(lineTotal(it))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tots">
        <div><span>Subtotal</span><b>{fmtIdr(o.subtotal)}</b></div>
        {o.discountTotal > 0 && <div><span>Diskon{o.discountType === 'pct' ? ` ${o.discountValue}%` : ''}</span><b>-{fmtIdr(o.discountTotal)}</b></div>}
        {o.shipping > 0 && <div><span>Ongkir</span><b>{fmtIdr(o.shipping)}</b></div>}
        {o.tax > 0 && <div><span>Pajak {o.taxPct}%</span><b>{fmtIdr(o.tax)}</b></div>}
        <div className="g"><span>TOTAL</span><b>{fmtIdr(o.total)}</b></div>
        {o.paid > 0 && <div><span>Dibayar</span><b>{fmtIdr(o.paid)}</b></div>}
        {due && <div><span>Sisa</span><b>{fmtIdr(o.remaining)}</b></div>}
      </div>
      {o.notes && <p className="sm">Catatan: {o.notes}</p>}
      {due && (s.bankText || s.qrisText) && <pre className="sm">{[s.bankText && 'Pembayaran ke:\n' + s.bankText, s.qrisText && 'QRIS:\n' + s.qrisText].filter(Boolean).join('\n')}</pre>}
      {s.footer && <p className="foot">{s.footer}</p>}
    </div>
  );
}
