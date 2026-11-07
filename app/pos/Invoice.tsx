import { fmtDateTime, fmtIdr, lineTotal } from '../shared/pos-logic';
import { ScrollTable } from '../shared/ui/ScrollTable';
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
      <ScrollTable label="Item nota">
      <table>
        <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Harga</th><th className="num">Jumlah</th></tr></thead>
        <tbody>
          {o.items.map((it, i) => (
            <tr key={i}>
              <td className="wrap">{it.name}{it.discount > 0 && <div className="sm">Diskon -{fmtIdr(it.discount)}</div>}</td>
              <td className="num">{it.qty}</td><td className="num">{fmtIdr(it.price)}</td><td className="num">{fmtIdr(lineTotal(it))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </ScrollTable>
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
