/** Pure POS logic (no DOM / chrome / Dexie). Money = integer Rupiah. */
import { dayKeyOf } from './analytics-logic';
import type { DateRange } from './analytics-types';
import {
  PAY_LABEL, PAY_METHODS, STATUS_LABEL,
  type DiscountType, type Order, type OrderItem, type OrderStatus, type Payment, type PayMethod, type PosSettings, type Product,
} from './pos-types';
import { WA_LINE_WIDTH, fenceLines, formatInvoiceTable, leftRight, normalizeForWa } from './wa-format';

// ---------- formatting ----------
const NF = new Intl.NumberFormat('id-ID');
export const fmtNum = (n: number) => NF.format(Math.round(n));
export const fmtIdr = (n: number) => (n < 0 ? '-Rp ' : 'Rp ') + NF.format(Math.abs(Math.round(n)));
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse "Rp 10.000", "10000", "10.000,50" into an integer (decimals dropped). Invalid -> NaN. */
export function parseMoney(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : NaN;
  let s = String(v ?? '').trim().replace(/rp\.?/i, '').replace(/\s/g, '');
  if (!s) return NaN;
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');
  if (/[^\d.,]/.test(s)) return NaN;
  s = s.replace(/,\d{1,2}$/, ''); // decimal comma
  s = s.replace(/\.\d{1,2}$/, ''); // decimal dot (1-2 digits; 3 digits = thousands)
  s = s.replace(/[.,]/g, '');
  if (!s) return NaN;
  const n = parseInt(s, 10);
  return neg ? -n : n;
}

// ---------- totals ----------
/** round(base * pct / 100) with pct kept to 2 decimals (avoids float drift). */
export const pctOf = (base: number, pct: number) => Math.round((base * Math.round(pct * 100)) / 10000);

export const lineTotal = (it: Pick<OrderItem, 'qty' | 'price' | 'discount'>) =>
  Math.max(0, Math.round(it.qty * it.price) - Math.max(0, Math.round(it.discount || 0)));

export interface Totals { subtotal: number; discountTotal: number; tax: number; total: number; paid: number; remaining: number; change: number }

export function computeTotals(o: {
  items: OrderItem[]; discountType: DiscountType; discountValue: number; shipping: number; taxPct: number; payments: Pick<Payment, 'amount'>[];
}): Totals {
  const subtotal = o.items.reduce((s, it) => s + lineTotal(it), 0);
  const dv = Math.max(0, o.discountValue || 0);
  const discountTotal = Math.min(subtotal, o.discountType === 'pct' ? pctOf(subtotal, Math.min(100, dv)) : Math.round(dv));
  const base = subtotal - discountTotal;
  const tax = pctOf(base, Math.max(0, o.taxPct || 0));
  const total = base + tax + Math.max(0, Math.round(o.shipping || 0));
  const paid = o.payments.reduce((s, p) => s + Math.round(p.amount), 0);
  return { subtotal, discountTotal, tax, total, paid, remaining: Math.max(0, total - paid), change: Math.max(0, paid - total) };
}

export const countsAsSale = (s: OrderStatus) => s !== 'draft' && s !== 'cancelled';
export const consumesStock = countsAsSale;

const cleanItem = (it: OrderItem): OrderItem => ({
  ...it,
  qty: Number.isFinite(it.qty) && it.qty > 0 ? it.qty : 1,
  price: Math.max(0, Math.round(it.price || 0)),
  discount: Math.max(0, Math.round(it.discount || 0)),
  cost: it.cost == null ? null : Math.max(0, Math.round(it.cost)),
});

/**
 * Normalise an order: clean items, recompute totals, settle payments for paid/done statuses, promote draft/unpaid to paid
 * when fully covered. Pure (new payment ids come from `mkId`).
 */
export function finalizeOrder(o: Order, now: number, mkId: () => string = () => String(Math.random())): Order {
  const items = o.items.map(cleanItem);
  let payments = o.payments.map((p) => ({ ...p, amount: Math.round(p.amount) })).filter((p) => p.amount !== 0);
  let status = o.status;
  let t = computeTotals({ ...o, items, payments });
  const settleMethod: PayMethod = o.method === 'credit' ? 'cash' : o.method;
  if (t.remaining > 0 && (status === 'paid' || (status === 'done' && o.method !== 'credit'))) {
    payments = [...payments, { id: mkId(), at: now, amount: t.remaining, method: settleMethod }];
    t = computeTotals({ ...o, items, payments });
  }
  if ((status === 'draft' || status === 'unpaid') && t.total > 0 && t.remaining === 0 && payments.length) status = 'paid';
  return { ...o, items, payments, status, ...t, updatedAt: now };
}

export function addPayment(o: Order, amount: number, method: PayMethod, now: number, id: string): Order {
  const amt = Math.round(amount);
  if (!(amt > 0)) return o;
  return finalizeOrder({ ...o, payments: [...o.payments, { id, at: now, amount: amt, method }] }, now, () => id + 'x');
}

// ---------- stock ----------
export const qtyByProduct = (items: OrderItem[]): Record<string, number> => {
  const m: Record<string, number> = {};
  for (const it of items) if (it.productId) m[it.productId] = (m[it.productId] ?? 0) + it.qty;
  return m;
};

/**
 * Idempotent stock plan. `prev` is the stored order (null on create); the effect already applied is prev.items iff
 * prev.stockApplied. Returns product deltas (positive = add back to stock) and the new stockApplied flag.
 */
export function stockPlan(prev: Pick<Order, 'items' | 'stockApplied'> | null, next: Pick<Order, 'items' | 'status'>): { deltas: Record<string, number>; applied: boolean } {
  const before = prev?.stockApplied ? qtyByProduct(prev.items) : {};
  const applied = consumesStock(next.status);
  const after = applied ? qtyByProduct(next.items) : {};
  const deltas: Record<string, number> = {};
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const d = (before[id] ?? 0) - (after[id] ?? 0);
    if (d !== 0) deltas[id] = d;
  }
  return { deltas, applied };
}

/** Apply a delta; unlimited (null) stays null. */
export const applyDelta = (stock: number | null, delta: number): number | null => (stock == null ? null : stock + delta);
export const isLowStock = (p: Pick<Product, 'stock'>, threshold = 5) => p.stock != null && p.stock <= threshold;

// ---------- numbering ----------
export const monthKey = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}${pad(d.getMonth() + 1)}`; };
export const cleanPrefix = (p: string) => (p || 'INV').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'INV';

export function formatInvoiceNumber(prefix: string, ts: number, seq: number): string {
  return `${cleanPrefix(prefix)}-${monthKey(ts)}-${pad(seq, 4)}`;
}
/** Next number from settings counters (does not mutate). */
export function nextInvoice(s: Pick<PosSettings, 'prefix' | 'counters'>, ts: number): { number: string; counters: Record<string, number> } {
  const k = monthKey(ts);
  const seq = (s.counters?.[k] ?? 0) + 1;
  return { number: formatInvoiceNumber(s.prefix, ts, seq), counters: { ...s.counters, [k]: seq } };
}

/** Next auto SKU "P-0001" given existing SKUs. */
export function nextSku(existing: string[]): string {
  let max = 0;
  for (const s of existing) { const m = /^P-(\d+)$/i.exec(s.trim()); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `P-${pad(max + 1, 4)}`;
}

/** CRM stage to push when an order reaches a status (null = no change). */
export const crmStageFor = (s: OrderStatus): string | null => (s === 'done' ? 'Selesai' : s === 'paid' || s === 'shipped' ? 'Deal' : null);

// ---------- CSV ----------
export function csvCell(v: unknown): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",;\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
export const toCsv = (header: string[], rows: unknown[][]) =>
  '﻿' + [...(header.length ? [header] : []), ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

/** RFC4180-ish parser; auto-detects `,` or `;` from the first line. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  let delim = ',';
  {
    let inQ = false, c = 0, sc = 0;
    for (const ch of src) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ && (ch === '\n' || ch === '\r')) break;
      else if (!inQ && ch === ',') c++;
      else if (!inQ && ch === ';') sc++;
    }
    if (sc > c) delim = ';';
  }
  const rows: string[][] = [];
  let row: string[] = [], cell = '', inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export const PRODUCT_CSV_HEADER = ['sku', 'nama', 'kategori', 'harga', 'harga_modal', 'stok', 'satuan', 'aktif', 'catatan'];
const ALIAS: Record<string, string> = {
  sku: 'sku', kode: 'sku', nama: 'name', name: 'name', produk: 'name', kategori: 'category', category: 'category',
  harga: 'price', price: 'price', harga_jual: 'price', harga_modal: 'cost', modal: 'cost', cost: 'cost', hpp: 'cost',
  stok: 'stock', stock: 'stock', satuan: 'unit', unit: 'unit', aktif: 'active', active: 'active', catatan: 'note', note: 'note',
};

export function productsToCsv(ps: Product[]): string {
  return toCsv(PRODUCT_CSV_HEADER, ps.map((p) => [p.sku, p.name, p.category, p.price, p.cost ?? '', p.stock ?? '', p.unit, p.active ? 'ya' : 'tidak', p.note]));
}
export const productTemplateCsv = () =>
  toCsv(PRODUCT_CSV_HEADER, [
    ['P-0001', 'Contoh Produk', 'Umum', 25000, 15000, 100, 'pcs', 'ya', 'Catatan opsional'],
    ['', 'Produk tanpa SKU (otomatis)', '', 10000, '', '', 'pcs', 'ya', ''],
  ]);

export type ImportRow = Partial<Product> & { name: string };
export function productsFromCsv(text: string): { rows: ImportRow[]; errors: string[] } {
  const table = parseCsv(text);
  const errors: string[] = [];
  if (!table.length) return { rows: [], errors: ['File kosong'] };
  const cols = table[0].map((h) => ALIAS[h.trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? '');
  if (!cols.includes('name')) return { rows: [], errors: ['Kolom "nama" tidak ditemukan'] };
  const unq = (s: string) => s.trim().replace(/^'(?=[=+\-@])/, '');
  const rows: ImportRow[] = [];
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const g: Record<string, string> = {};
    cols.forEach((c, j) => { if (c) g[c] = unq(r[j] ?? ''); });
    if (!g.name) { errors.push(`Baris ${line}: nama kosong`); return; }
    const price = g.price === undefined || g.price === '' ? 0 : parseMoney(g.price);
    if (Number.isNaN(price) || price < 0) { errors.push(`Baris ${line}: harga tidak valid`); return; }
    const row: ImportRow = { name: g.name, price };
    if (g.sku) row.sku = g.sku;
    if (g.category !== undefined) row.category = g.category;
    if (g.cost) {
      const c = parseMoney(g.cost);
      if (Number.isNaN(c) || c < 0) { errors.push(`Baris ${line}: harga modal tidak valid`); return; }
      row.cost = c;
    } else row.cost = null;
    if (g.stock) {
      const s = parseMoney(g.stock);
      if (Number.isNaN(s)) { errors.push(`Baris ${line}: stok tidak valid`); return; }
      row.stock = s;
    } else row.stock = null;
    if (g.unit) row.unit = g.unit;
    if (g.active) row.active = !/^(0|tidak|no|false|nonaktif|n)$/i.test(g.active);
    if (g.note !== undefined) row.note = g.note;
    rows.push(row);
  });
  return { rows, errors };
}

export function ordersToCsv(os: Order[]): string {
  return toCsv(
    ['nomor', 'tanggal', 'pelanggan', 'telepon', 'status', 'metode', 'subtotal', 'diskon', 'ongkir', 'pajak', 'total', 'dibayar', 'sisa', 'item', 'catatan'],
    os.map((o) => [o.number, fmtDateTime(o.createdAt), o.customerName, o.customerPhone, STATUS_LABEL[o.status], PAY_LABEL[o.method], o.subtotal, o.discountTotal, o.shipping, o.tax, o.total, o.paid, o.remaining,
      o.items.map((i) => `${i.qty}x ${i.name}`).join('; '), o.notes]),
  );
}

// ---------- report ----------
export type Granularity = 'day' | 'week' | 'month';
export interface SeriesPoint { key: string; label: string; value: number; count: number }
export interface SalesReport {
  revenue: number; orderCount: number; avgOrder: number;
  grossProfit: number | null; receivable: number; collected: number;
  topProducts: { key: string; name: string; qty: number; revenue: number }[];
  topCustomers: { key: string; name: string; orders: number; total: number }[];
  series: SeriesPoint[]; granularity: Granularity;
  byMethod: { method: PayMethod; amount: number; count: number }[];
}

const DAY = 86400e3;
function bucketOf(ts: number, g: Granularity): string {
  const d = new Date(ts);
  if (g === 'month') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  if (g === 'week') return dayKeyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime());
  return dayKeyOf(ts);
}
const bucketLabel = (k: string, g: Granularity) => (g === 'month' ? k.slice(5) + '/' + k.slice(2, 4) : k.slice(8) + '/' + k.slice(5, 7));

export function pickGranularity(from: number, to: number): Granularity {
  const days = (to - from) / DAY;
  return days <= 35 ? 'day' : days <= 140 ? 'week' : 'month';
}

/** Gross profit of one order: costed line margin minus proportional order discount. Null when no line has cost. */
export function orderProfit(o: Order): number | null {
  const costed = o.items.filter((i) => i.cost != null);
  if (!costed.length) return null;
  const rev = costed.reduce((s, i) => s + lineTotal(i), 0);
  const cost = costed.reduce((s, i) => s + Math.round(i.qty * (i.cost as number)), 0);
  const disc = o.subtotal > 0 ? Math.round((o.discountTotal * rev) / o.subtotal) : 0;
  return rev - disc - cost;
}

export const customerKey = (o: Pick<Order, 'contactKey' | 'customerPhone' | 'customerName'>) =>
  o.contactKey || (o.customerPhone ? 'tel:' + o.customerPhone.replace(/\D/g, '') : 'nama:' + (o.customerName.trim().toLowerCase() || 'umum'));

export function buildReport(orders: Order[], range: DateRange, topN = 5): SalesReport {
  const os = orders.filter((o) => countsAsSale(o.status) && o.createdAt >= range.from && o.createdAt < range.to);
  const revenue = os.reduce((s, o) => s + o.total, 0);
  const receivable = os.reduce((s, o) => s + o.remaining, 0);
  const collected = os.reduce((s, o) => s + Math.min(o.paid, o.total), 0);
  let profit = 0, anyCost = false;
  const prod = new Map<string, { key: string; name: string; qty: number; revenue: number }>();
  const cust = new Map<string, { key: string; name: string; orders: number; total: number }>();
  const meth = new Map<PayMethod, { method: PayMethod; amount: number; count: number }>();
  for (const o of os) {
    const p = orderProfit(o);
    if (p != null) { anyCost = true; profit += p; }
    for (const it of o.items) {
      const k = it.productId ?? 'free:' + it.name.toLowerCase();
      const e = prod.get(k) ?? { key: k, name: it.name, qty: 0, revenue: 0 };
      e.qty += it.qty; e.revenue += lineTotal(it); prod.set(k, e);
    }
    const ck = customerKey(o);
    const c = cust.get(ck) ?? { key: ck, name: o.customerName || 'Umum', orders: 0, total: 0 };
    c.orders++; c.total += o.total; if (o.customerName) c.name = o.customerName; cust.set(ck, c);
    for (const p2 of o.payments) {
      const m = meth.get(p2.method) ?? { method: p2.method, amount: 0, count: 0 };
      m.amount += p2.amount; m.count++; meth.set(p2.method, m);
    }
  }
  let from = range.from;
  if (range.key === 'all' && os.length) from = Math.min(...os.map((o) => o.createdAt));
  const granularity = pickGranularity(from, range.to);
  const buckets = new Map<string, SeriesPoint>();
  if (granularity === 'day') {
    const s = new Date(from);
    let t = new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime();
    for (let i = 0; t < range.to && i < 40; i++) {
      const k = dayKeyOf(t);
      buckets.set(k, { key: k, label: bucketLabel(k, 'day'), value: 0, count: 0 });
      const d = new Date(t);
      t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    }
  }
  for (const o of os) {
    const k = bucketOf(o.createdAt, granularity);
    const b = buckets.get(k) ?? { key: k, label: bucketLabel(k, granularity), value: 0, count: 0 };
    b.value += o.total; b.count++; buckets.set(k, b);
  }
  return {
    revenue, orderCount: os.length, avgOrder: os.length ? Math.round(revenue / os.length) : 0,
    grossProfit: anyCost ? profit : null, receivable, collected,
    topProducts: [...prod.values()].sort((a, b) => b.revenue - a.revenue || b.qty - a.qty).slice(0, topN),
    topCustomers: [...cust.values()].sort((a, b) => b.total - a.total).slice(0, topN),
    series: [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)), granularity,
    byMethod: PAY_METHODS.map((m) => meth.get(m)).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.amount - a.amount),
  };
}

export function reportToCsv(r: SalesReport, rangeLabel: string): string {
  const rows: unknown[][] = [
    ['Periode', rangeLabel], ['Omzet', r.revenue], ['Jumlah order', r.orderCount], ['Rata-rata order', r.avgOrder],
    ['Laba kotor', r.grossProfit ?? ''], ['Piutang', r.receivable], ['Terbayar', r.collected], [],
    ['Produk teratas', 'Qty', 'Omzet'], ...r.topProducts.map((p) => [p.name, p.qty, p.revenue]), [],
    ['Pelanggan teratas', 'Order', 'Total'], ...r.topCustomers.map((c) => [c.name, c.orders, c.total]), [],
    ['Metode bayar', 'Jumlah transaksi', 'Nominal'], ...r.byMethod.map((m) => [PAY_LABEL[m.method], m.count, m.amount]), [],
    ['Per ' + r.granularity, 'Order', 'Omzet'], ...r.series.map((s) => [s.key, s.count, s.value]),
  ];
  return toCsv([], rows);
}

// ---------- WhatsApp invoice text ----------
export const TEMPLATE_VARS = [
  'toko', 'alamat', 'telepon_toko', 'kontak_toko', 'nomor', 'tanggal', 'pelanggan', 'telepon', 'items', 'ringkasan', 'subtotal', 'diskon',
  'ongkir', 'pajak', 'total', 'dibayar', 'sisa', 'status', 'metode', 'catatan', 'catatan_baris', 'rekening', 'qris', 'pembayaran', 'footer',
] as const;

export const DEFAULT_TEMPLATE = [
  '*{toko}*', '{alamat}', '{kontak_toko}', '--------------------------------',
  'NOTA      : {nomor}', 'Tanggal   : {tanggal}', 'Pelanggan : {pelanggan}', '--------------------------------',
  '{items}', '--------------------------------', '{ringkasan}', 'Status : {status}', 'Metode : {metode}', '{catatan_baris}', '{pembayaran}', '', '{footer}',
].join('\n');

const row2 = (l: string, v: string) => leftRight(l, v, WA_LINE_WIDTH);

export function invoiceVars(o: Order, s: PosSettings): Record<string, string> {
  // item table in a monospace block so columns stay aligned (see wa-format); long names wrap at WA_LINE_WIDTH
  const items = formatInvoiceTable(o.items.map((it) => ({
    name: it.name, qty: String(it.qty), price: fmtIdr(it.price), total: fmtIdr(Math.round(it.qty * it.price)),
    extra: it.discount > 0 ? [{ label: 'Diskon', value: '-' + fmtIdr(it.discount) }] : undefined,
  })));
  const due = o.remaining > 0 && o.status !== 'cancelled';
  const rows: string[] = [row2('Subtotal', fmtIdr(o.subtotal))];
  if (o.discountTotal > 0) rows.push(row2(o.discountType === 'pct' ? `Diskon ${o.discountValue}%` : 'Diskon', '-' + fmtIdr(o.discountTotal)));
  if (o.shipping > 0) rows.push(row2('Ongkir', fmtIdr(o.shipping)));
  if (o.tax > 0) rows.push(row2(`Pajak ${o.taxPct}%`, fmtIdr(o.tax)));
  rows.push(row2('TOTAL', fmtIdr(o.total)));
  if (o.paid > 0) rows.push(row2('Dibayar', fmtIdr(o.paid)));
  if (due) rows.push(row2('Sisa', fmtIdr(o.remaining)));
  const pay: string[] = [];
  if (due && s.bankText.trim()) pay.push('Pembayaran ke:\n' + s.bankText.trim());
  if (due && s.qrisText.trim()) pay.push('QRIS:\n' + s.qrisText.trim());
  return {
    toko: s.storeName, alamat: s.address, telepon_toko: s.phone, kontak_toko: s.phone ? 'Telp: ' + s.phone : '',
    nomor: o.number, tanggal: fmtDateTime(o.createdAt), pelanggan: o.customerName || 'Umum', telepon: o.customerPhone,
    items, ringkasan: fenceLines(rows),
    subtotal: fmtIdr(o.subtotal), diskon: fmtIdr(o.discountTotal), ongkir: fmtIdr(o.shipping), pajak: fmtIdr(o.tax),
    total: fmtIdr(o.total), dibayar: fmtIdr(o.paid), sisa: fmtIdr(o.remaining),
    status: STATUS_LABEL[o.status], metode: PAY_LABEL[o.method], catatan: o.notes, catatan_baris: o.notes.trim() ? 'Catatan: ' + o.notes.trim() : '',
    rekening: s.bankText, qris: s.qrisText, pembayaran: pay.join('\n'), footer: s.footer,
  };
}

/** Render template; lines that consist solely of an empty variable are dropped; unknown variables are kept verbatim. */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  const out: string[] = [];
  for (const line of tpl.split('\n')) {
    const solo = /^\s*\{(\w+)\}\s*$/.exec(line);
    if (solo && solo[1] in vars && !vars[solo[1]].trim()) continue;
    out.push(line.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m)));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export const buildInvoiceText = (o: Order, s: PosSettings) => renderTemplate(s.template.trim() ? s.template : DEFAULT_TEMPLATE, invoiceVars(o, s));
