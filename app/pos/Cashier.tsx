import { useMemo, useRef, useState } from 'react';
import type { Contact } from '../shared/crm-types';
import { computeTotals, fmtIdr, lineTotal } from '../shared/pos-logic';
import {
  ORDER_STATUSES, PAY_LABEL, PAY_METHODS, STATUS_LABEL,
  type DiscountType, type Order, type OrderItem, type OrderStatus, type Payment, type PayMethod, type PosSettings, type Product,
} from '../shared/pos-types';
import { ScrollTable } from '../shared/ui/ScrollTable';
import { send } from './util';

interface Props { products: Product[]; contacts: Contact[]; settings: PosSettings; editing: Order | null; onSaved: (o: Order) => void; onCancel: () => void }

export function Cashier({ products, contacts, settings, editing, onSaved, onCancel }: Props) {
  const e = editing;
  const [items, setItems] = useState<OrderItem[]>(e?.items ?? []);
  const [contactKey, setContactKey] = useState(e?.contactKey ?? '');
  const [name, setName] = useState(e?.customerName ?? '');
  const [phone, setPhone] = useState(e?.customerPhone ?? '');
  const [dType, setDType] = useState<DiscountType>(e?.discountType ?? 'rp');
  const [dVal, setDVal] = useState(e?.discountValue ?? 0);
  const [shipping, setShipping] = useState(e?.shipping ?? 0);
  const [taxPct, setTaxPct] = useState(e?.taxPct ?? settings.taxPct);
  const [notes, setNotes] = useState(e?.notes ?? '');
  const [method, setMethod] = useState<PayMethod>(e?.method ?? 'cash');
  const [status, setStatus] = useState<OrderStatus>(e?.status ?? 'unpaid');
  const [payments, setPayments] = useState<Payment[]>(e?.payments ?? []);
  const [payAmt, setPayAmt] = useState(0);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const qRef = useRef<HTMLInputElement>(null);

  const t = useMemo(() => computeTotals({ items, discountType: dType, discountValue: dVal, shipping, taxPct, payments }), [items, dType, dVal, shipping, taxPct, payments]);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter((p) => p.active && (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s))).slice(0, 60);
  }, [products, q]);

  const addProduct = (p: Product) => {
    setItems((cur) => {
      const i = cur.findIndex((x) => x.productId === p.id);
      if (i >= 0) return cur.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x));
      return [...cur, { productId: p.id, sku: p.sku, name: p.name, qty: 1, price: p.price, cost: p.cost, discount: 0 }];
    });
  };
  const addFree = () => {
    const n = q.trim();
    if (n) { setItems((c) => [...c, { productId: null, sku: '', name: n, qty: 1, price: 0, cost: null, discount: 0 }]); setQ(''); }
  };
  const onSearchKey = (ev: React.KeyboardEvent) => {
    if (ev.key !== 'Enter') return;
    const s = q.trim().toLowerCase();
    if (!s) return;
    const exact = products.find((p) => p.active && p.sku.toLowerCase() === s);
    const hit = exact ?? (matches.length === 1 ? matches[0] : undefined);
    if (hit) { addProduct(hit); setQ(''); } else if (!matches.length) addFree();
  };
  const patchItem = (i: number, p: Partial<OrderItem>) => setItems((c) => c.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const onName = (v: string) => {
    setName(v);
    const c = contacts.find((x) => `${x.name} (${x.phone})` === v || (x.name === v && contacts.filter((y) => y.name === v).length === 1));
    if (c) { setContactKey(c.key); setName(c.name); setPhone(c.phone); } else setContactKey('');
  };

  const addPay = () => {
    if (!(payAmt > 0)) return;
    setPayments((c) => [...c, { id: crypto.randomUUID(), at: Date.now(), amount: Math.round(payAmt), method: method === 'credit' ? 'cash' : method }]);
    setPayAmt(0);
  };

  const save = async (asStatus?: OrderStatus) => {
    setErr(''); setBusy(true);
    try {
      const body = {
        items, contactKey, customerName: name.trim(), customerPhone: phone.trim(), discountType: dType, discountValue: dVal, shipping, taxPct, notes, method,
        status: asStatus ?? status, payments,
      };
      const o = e ? await send<Order>({ kind: 'pos:order:update', id: e.id, patch: body }) : await send<Order>({ kind: 'pos:order:create', order: body });
      onSaved(o);
    } catch (x) { setErr(String((x as Error).message)); } finally { setBusy(false); }
  };

  return (
    <div className="cash">
      <section className="panel">
        <h3>Produk</h3>
        <input ref={qRef} autoFocus placeholder="Cari / ketik SKU lalu Enter" value={q} onChange={(ev) => setQ(ev.target.value)} onKeyDown={onSearchKey} />
        <div className="pgrid">
          {matches.map((p) => (
            <button key={p.id} className="pcard" onClick={() => addProduct(p)} disabled={p.stock != null && p.stock <= 0} title={p.sku}>
              {p.photo ? <img src={p.photo} alt="" /> : <span className="ph" />}
              <b>{p.name}</b><small>{fmtIdr(p.price)}</small>
              <small className="mut">{p.stock == null ? p.sku : `Stok ${p.stock}`}</small>
            </button>
          ))}
        </div>
        {q.trim() && <button onClick={addFree}>+ Item bebas: "{q.trim()}"</button>}
      </section>

      <section className="panel">
        <h3>{e ? `Ubah ${e.number}` : 'Pesanan baru'}</h3>
        <div className="grid">
          <label>Pelanggan (CRM atau ketik bebas)
            <input list="custs" value={name} onChange={(ev) => onName(ev.target.value)} placeholder="Nama" />
            <datalist id="custs">{contacts.filter((c) => c.name).map((c) => <option key={c.key} value={`${c.name} (${c.phone})`} />)}</datalist>
          </label>
          <label>Telepon<input value={phone} onChange={(ev) => setPhone(ev.target.value)} /></label>
        </div>
        {contactKey && <small className="mut">Terhubung ke kontak CRM</small>}

        <ScrollTable maxHeight="45vh" stickyFirst label="Keranjang">
        <table>
          <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Harga</th><th className="num">Diskon</th><th className="num">Jumlah</th><th></th></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td className="wrap">{it.productId ? it.name : <input value={it.name} onChange={(ev) => patchItem(i, { name: ev.target.value })} />}<br /><small className="mut">{it.sku}</small></td>
                <td><input className="n" type="number" min={0.01} step="any" value={it.qty} onChange={(ev) => patchItem(i, { qty: Number(ev.target.value) })} /></td>
                <td><input className="n w" type="number" min={0} value={it.price} onChange={(ev) => patchItem(i, { price: Math.max(0, Math.round(Number(ev.target.value) || 0)) })} /></td>
                <td><input className="n w" type="number" min={0} value={it.discount} onChange={(ev) => patchItem(i, { discount: Math.max(0, Math.round(Number(ev.target.value) || 0)) })} /></td>
                <td className="num">{fmtIdr(lineTotal(it))}</td>
                <td><button onClick={() => setItems((c) => c.filter((_, j) => j !== i))}>x</button></td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={6} className="mut">Keranjang kosong.</td></tr>}
          </tbody>
        </table>
        </ScrollTable>

        <div className="grid">
          <label>Diskon pesanan
            <span className="row"><input type="number" min={0} step="any" value={dVal} onChange={(ev) => setDVal(Math.max(0, Number(ev.target.value) || 0))} />
              <select value={dType} onChange={(ev) => setDType(ev.target.value as DiscountType)}><option value="rp">Rp</option><option value="pct">%</option></select></span></label>
          <label>Ongkir (Rp)<input type="number" min={0} value={shipping} onChange={(ev) => setShipping(Math.max(0, Math.round(Number(ev.target.value) || 0)))} /></label>
          <label>Pajak (%)<input type="number" min={0} max={100} step="any" value={taxPct} onChange={(ev) => setTaxPct(Math.max(0, Number(ev.target.value) || 0))} /></label>
          <label>Metode bayar<select value={method} onChange={(ev) => setMethod(ev.target.value as PayMethod)}>{PAY_METHODS.map((m) => <option key={m} value={m}>{PAY_LABEL[m]}</option>)}</select></label>
          <label>Status<select value={status} onChange={(ev) => setStatus(ev.target.value as OrderStatus)}>{ORDER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
        </div>
        <label>Catatan<textarea rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} /></label>

        <div className="sum">
          <div><span>Subtotal</span><b>{fmtIdr(t.subtotal)}</b></div>
          {t.discountTotal > 0 && <div><span>Diskon</span><b>-{fmtIdr(t.discountTotal)}</b></div>}
          {t.tax > 0 && <div><span>Pajak</span><b>{fmtIdr(t.tax)}</b></div>}
          {shipping > 0 && <div><span>Ongkir</span><b>{fmtIdr(shipping)}</b></div>}
          <div className="tot"><span>Total</span><b>{fmtIdr(t.total)}</b></div>
          {payments.map((p) => (
            <div key={p.id}><span>{PAY_LABEL[p.method]} / DP</span><b>{fmtIdr(p.amount)} <button onClick={() => setPayments((c) => c.filter((x) => x.id !== p.id))}>x</button></b></div>
          ))}
          <div><span>Sisa</span><b className={t.remaining > 0 ? 'neg' : ''}>{fmtIdr(t.remaining)}</b></div>
          {t.change > 0 && <div><span>Kembalian</span><b>{fmtIdr(t.change)}</b></div>}
        </div>
        <div className="bar">
          <input className="n w" type="number" min={0} placeholder="Bayar / DP" value={payAmt || ''} onChange={(ev) => setPayAmt(Number(ev.target.value) || 0)} />
          <button onClick={addPay}>Tambah pembayaran</button>
          <button onClick={() => setPayAmt(t.remaining)}>Pas</button>
        </div>
        {err && <p className="note err">{err}</p>}
        <div className="bar">
          <button onClick={onCancel}>{e ? 'Batal ubah' : 'Reset'}</button>
          <span className="sp" />
          {!e && <button disabled={busy || !items.length} onClick={() => void save('draft')}>Simpan draft</button>}
          <button className="pri" disabled={busy || !items.length} onClick={() => void save()}>{e ? 'Simpan perubahan' : 'Simpan pesanan'}</button>
        </div>
      </section>
    </div>
  );
}
