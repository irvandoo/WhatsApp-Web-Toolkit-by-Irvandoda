import { useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { usePersistentState } from '../shared/ui/persist';
import { EMPTY_CASH_DRAFT, fromOrder, isCashDraft, type CashDraft } from './cashier-draft';
import type { Contact } from '../shared/crm-types';
import { computeTotals, fmtIdr, lineTotal } from '../shared/pos-logic';
import {
  ORDER_STATUSES, PAY_LABEL, PAY_METHODS, STATUS_LABEL,
  type Order, type OrderItem, type OrderStatus, type PosSettings, type Product,
} from '../shared/pos-types';
import { availableFor, creditFromOrder, isCodeProduct, repriceLine, resolveUnitPrice, stockShortfalls, totalStock, TYPE_LABEL, typeOf } from '../shared/pos-products-logic';
import { ScrollTable } from '../shared/ui/ScrollTable';
import './products/products.css';
import { send } from './util';

interface Props { products: Product[]; contacts: Contact[]; settings: PosSettings; editing: Order | null; onSaved: (o: Order) => void; onCancel: () => void }

export function Cashier({ products, contacts, settings, editing, onSaved, onCancel }: Props) {
  const e = editing;
  const [pd, setPd, ready] = usePersistentState<CashDraft>('pos.cashier.draft', EMPTY_CASH_DRAFT, isCashDraft);
  const [ld, setLd] = useState<CashDraft>(() => fromOrder(e));
  const d = e ? ld : pd;
  const setD = e ? setLd : setPd;
  const up = <K extends keyof CashDraft>(k: K) => (v: CashDraft[K] | ((p: CashDraft[K]) => CashDraft[K])) =>
    setD((c) => ({ ...c, [k]: typeof v === 'function' ? (v as (p: CashDraft[K]) => CashDraft[K])(c[k]) : v }));
  const { items, contactKey, name, phone, dType, dVal, shipping, notes, method, status, payments } = d;
  const taxPct = d.taxPct ?? settings.taxPct;
  const setItems = up('items'), setContactKey = up('contactKey'), setName = up('name'), setPhone = up('phone'), setDType = up('dType'), setDVal = up('dVal');
  const setShipping = up('shipping'), setTaxPct = up('taxPct'), setNotes = up('notes'), setMethod = up('method'), setStatus = up('status'), setPayments = up('payments');
  const [payAmt, setPayAmt] = useState(0);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const qRef = useRef<HTMLInputElement>(null);
  const [pick, setPick] = useState<Product | null>(null);
  const [override, setOverride] = useState(false);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const t = useMemo(() => computeTotals({ items, discountType: dType, discountValue: dVal, shipping, taxPct, payments }), [items, dType, dVal, shipping, taxPct, payments]);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter((p) => p.active && (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s))).slice(0, 60);
  }, [products, q]);

  const addProduct = (p: Product, variantId?: string | null) => {
    if (typeOf(p) === 'fisik' && p.variants?.length && !variantId) { setPick(p); return; }
    setPick(null);
    const v = variantId ? p.variants?.find((x) => x.id === variantId) : undefined;
    const av = availableFor(p, variantId);
    const inCart = items.filter((x) => x.productId === p.id && (x.variantId ?? null) === (variantId ?? null)).reduce((n, x) => n + x.qty, 0);
    if (av != null && inCart + 1 > av + (creditFromOrder(e)[`${p.id}::${variantId ?? ''}`] ?? 0) && !override) {
      setErr(`Stok ${p.name}${v ? ` (${v.name})` : ''} tidak cukup (tersedia ${av}). Aktifkan "Izinkan jual melebihi stok" untuk melanjutkan.`);
      return;
    }
    setErr('');
    setItems((cur) => {
      const i = cur.findIndex((x) => x.productId === p.id && (x.variantId ?? null) === (variantId ?? null));
      if (i >= 0) return cur.map((x, j) => (j === i ? repriceLine(x, p, x.qty + 1) : x));
      return [...cur, {
        productId: p.id, sku: v?.sku || p.sku, name: p.name, qty: 1, price: resolveUnitPrice(p, 1, variantId).price, cost: v?.cost ?? p.cost, discount: 0,
        ...(v ? { variantId: v.id, variantName: v.name } : {}),
      }];
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
  const patchItem = (i: number, p: Partial<OrderItem>) => setItems((c) => c.map((x, j) => {
    if (j !== i) return x;
    if (p.qty !== undefined && x.productId) return { ...repriceLine(x, byId.get(x.productId), p.qty), ...p, price: p.price ?? repriceLine(x, byId.get(x.productId), p.qty).price };
    return { ...x, ...p };
  }));

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
    setErr('');
    const short = (asStatus ?? status) === 'draft' || (asStatus ?? status) === 'cancelled' || override ? [] : stockShortfalls(items, products, creditFromOrder(e));
    if (short.length) { setErr('Stok tidak cukup: ' + short.map((x) => `${x.name} (butuh ${x.need}, tersedia ${x.available})`).join('; ')); return; }
    setBusy(true);
    try {
      const body = {
        items, contactKey, customerName: name.trim(), customerPhone: phone.trim(), discountType: dType, discountValue: dVal, shipping, taxPct, notes, method,
        status: asStatus ?? status, payments,
      };
      const o = e ? await send<Order>({ kind: 'pos:order:update', id: e.id, patch: body }) : await send<Order>({ kind: 'pos:order:create', order: body });
      if (!e) flushSync(() => setPd(EMPTY_CASH_DRAFT));
      onSaved(o);
    } catch (x) { setErr(String((x as Error).message)); } finally { setBusy(false); }
  };

  if (!e && !ready) return null;
  return (
    <div className="cash">
      <section className="panel">
        <h3>Produk</h3>
        <input ref={qRef} autoFocus placeholder="Cari / ketik SKU lalu Enter" value={q} onChange={(ev) => setQ(ev.target.value)} onKeyDown={onSearchKey} />
        <div className="pgrid">
          {matches.map((p) => (
            <button key={p.id} className="pcard" onClick={() => addProduct(p)} disabled={!override && (() => { const st = totalStock(p, isCodeProduct(p) ? p.stock ?? 0 : undefined); return st != null && st <= 0; })()} title={p.sku}>
              {p.photo ? <img src={p.photo} alt="" /> : <span className="ph" />}
              <b>{p.name}</b><small><span className={'pm-badge ' + typeOf(p)}>{TYPE_LABEL[typeOf(p)]}</span> {fmtIdr(p.price)}{p.tiers?.length ? ' +grosir' : ''}</small>
              <small className="mut">{(() => { const st = totalStock(p, isCodeProduct(p) ? p.stock ?? 0 : undefined); return st == null ? p.sku : `Stok ${st}`; })()}{p.variants?.length ? ` · ${p.variants.length} varian` : ''}</small>
              {typeOf(p) === 'digital' && p.autoDeliver !== false && <small className="mut">Dikirim otomatis</small>}
            </button>
          ))}
        </div>
        {pick && (
          <div className="pm-card">
            <b>Pilih varian: {pick.name}</b>
            <div className="bar">
              {pick.variants!.map((v) => (
                <button key={v.id} disabled={!override && v.stock != null && v.stock <= 0} onClick={() => addProduct(pick, v.id)}>
                  {v.name} · {fmtIdr(v.price ?? pick.price)} · {v.stock == null ? '∞' : `stok ${v.stock}`}
                </button>
              ))}
              <button onClick={() => setPick(null)}>Batal</button>
            </div>
          </div>
        )}
        <label className="chk"><input type="checkbox" checked={override} onChange={(ev) => setOverride(ev.target.checked)} /> Izinkan jual melebihi stok</label>
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

        <ScrollTable maxHeight="max(260px, 62vh)" stickyFirst label="Keranjang">
        <table>
          <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Harga</th><th className="num">Diskon</th><th className="num">Jumlah</th><th></th></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td className="wrap">{it.productId ? it.name : <input value={it.name} onChange={(ev) => patchItem(i, { name: ev.target.value })} />}{it.variantName && <small> ({it.variantName})</small>}<br /><small className="mut">{it.sku}</small>{it.productId && typeOf(byId.get(it.productId)) === 'digital' && <small className="mut"> · Dikirim otomatis</small>}</td>
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
          <button onClick={() => { if (!e) flushSync(() => setPd(EMPTY_CASH_DRAFT)); onCancel(); }}>{e ? 'Batal ubah' : 'Reset'}</button>
          <span className="sp" />
          {!e && <button disabled={busy || !items.length} onClick={() => void save('draft')}>Simpan draft</button>}
          <button className="pri" disabled={busy || !items.length} onClick={() => void save()}>{e ? 'Simpan perubahan' : 'Simpan pesanan'}</button>
        </div>
      </section>
    </div>
  );
}
