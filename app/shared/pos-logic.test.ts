import { describe, expect, it } from 'vitest';
import { resolveRange } from './analytics-logic';
import {
  addPayment, buildInvoiceText, buildReport, computeTotals, crmStageFor, DEFAULT_TEMPLATE, finalizeOrder, formatInvoiceNumber, lineTotal,
  nextInvoice, nextSku, orderProfit, parseCsv, parseMoney, pctOf, productsFromCsv, productsToCsv, productTemplateCsv, reportToCsv,
  renderTemplate, stockPlan, applyDelta, ordersToCsv, fmtIdr,
} from './pos-logic';
import { DEFAULT_SETTINGS, type Order, type OrderItem, type Product } from './pos-types';

const item = (o: Partial<OrderItem> = {}): OrderItem => ({ productId: 'p1', sku: 'P-0001', name: 'Kopi', qty: 2, price: 10000, cost: null, discount: 0, ...o });
const order = (o: Partial<Order> = {}): Order => ({
  id: 'o1', number: 'INV-202611-0001', contactKey: '', customerName: 'Budi', customerPhone: '0812', items: [item()],
  discountType: 'rp', discountValue: 0, shipping: 0, taxPct: 0, notes: '', method: 'cash', status: 'unpaid', payments: [],
  subtotal: 0, discountTotal: 0, tax: 0, total: 0, paid: 0, remaining: 0, stockApplied: false, crmSynced: false,
  createdAt: new Date(2026, 10, 7, 10, 0).getTime(), updatedAt: 0, ...o,
});
const fin = (o: Partial<Order> = {}) => finalizeOrder(order(o), 1000, () => 'pid');

describe('totals', () => {
  it('rounds per line and applies line discount', () => {
    expect(lineTotal({ qty: 3, price: 3333, discount: 100 })).toBe(9899);
    expect(lineTotal({ qty: 1, price: 100, discount: 500 })).toBe(0);
    expect(lineTotal({ qty: 1.5, price: 333, discount: 0 })).toBe(500);
  });
  it('percent discount, tax and shipping', () => {
    const t = computeTotals({ items: [item({ qty: 3, price: 33333 })], discountType: 'pct', discountValue: 10, shipping: 5000, taxPct: 11, payments: [] });
    expect(t.subtotal).toBe(99999);
    expect(t.discountTotal).toBe(10000);
    expect(t.tax).toBe(Math.round(89999 * 0.11));
    expect(t.total).toBe(89999 + 9900 + 5000);
    expect(t.remaining).toBe(t.total);
  });
  it('rupiah discount is capped at subtotal; pct capped at 100', () => {
    const base = { items: [item()], shipping: 0, taxPct: 0, payments: [] };
    expect(computeTotals({ ...base, discountType: 'rp', discountValue: 999999 }).total).toBe(0);
    expect(computeTotals({ ...base, discountType: 'pct', discountValue: 250 }).total).toBe(0);
  });
  it('DP, remaining and change', () => {
    const base = { items: [item()], discountType: 'rp' as const, discountValue: 0, shipping: 0, taxPct: 0 };
    expect(computeTotals({ ...base, payments: [{ amount: 5000 }] })).toMatchObject({ total: 20000, paid: 5000, remaining: 15000, change: 0 });
    expect(computeTotals({ ...base, payments: [{ amount: 25000 }] })).toMatchObject({ remaining: 0, change: 5000 });
  });
  it('pctOf has no float drift', () => { expect(pctOf(1000, 2.5)).toBe(25); expect(pctOf(10, 0.1)).toBe(0); });
});

describe('finalizeOrder', () => {
  it('status paid auto-settles remaining', () => {
    const o = fin({ status: 'paid', payments: [{ id: 'a', at: 1, amount: 5000, method: 'cash' }] });
    expect(o.paid).toBe(20000); expect(o.remaining).toBe(0); expect(o.payments).toHaveLength(2);
  });
  it('credit method + done stays outstanding', () => {
    const o = fin({ status: 'done', method: 'credit' });
    expect(o.remaining).toBe(20000);
  });
  it('promotes unpaid to paid when payments cover total', () => {
    expect(fin({ payments: [{ id: 'a', at: 1, amount: 20000, method: 'transfer' }] }).status).toBe('paid');
    expect(fin({ payments: [{ id: 'a', at: 1, amount: 100, method: 'transfer' }] }).status).toBe('unpaid');
  });
  it('addPayment appends DP then completes', () => {
    let o = fin();
    o = addPayment(o, 8000, 'cash', 2000, 'x1');
    expect(o.remaining).toBe(12000); expect(o.status).toBe('unpaid');
    o = addPayment(o, 12000, 'qris', 3000, 'x2');
    expect(o.remaining).toBe(0); expect(o.status).toBe('paid');
    expect(addPayment(o, -5, 'cash', 1, 'x3')).toBe(o);
  });
});

describe('stockPlan', () => {
  const items = [item({ productId: 'a', qty: 2 }), item({ productId: 'a', qty: 1 }), item({ productId: 'b', qty: 4 }), item({ productId: null, qty: 9 })];
  it('create as unpaid consumes stock', () => {
    expect(stockPlan(null, { items, status: 'unpaid' })).toEqual({ deltas: { a: -3, b: -4 }, applied: true });
  });
  it('draft does not consume', () => {
    expect(stockPlan(null, { items, status: 'draft' })).toEqual({ deltas: {}, applied: false });
  });
  it('cancel restores; re-saving cancelled is idempotent', () => {
    const r = stockPlan({ items, stockApplied: true }, { items, status: 'cancelled' });
    expect(r).toEqual({ deltas: { a: 3, b: 4 }, applied: false });
    expect(stockPlan({ items, stockApplied: false }, { items, status: 'cancelled' }).deltas).toEqual({});
  });
  it('same status twice is a no-op', () => {
    expect(stockPlan({ items, stockApplied: true }, { items, status: 'paid' }).deltas).toEqual({});
  });
  it('editing items applies only the difference', () => {
    const next = [item({ productId: 'a', qty: 1 }), item({ productId: 'c', qty: 2 })];
    expect(stockPlan({ items, stockApplied: true }, { items: next, status: 'unpaid' }).deltas).toEqual({ a: 2, b: 4, c: -2 });
  });
  it('unlimited stock stays null', () => { expect(applyDelta(null, -5)).toBeNull(); expect(applyDelta(10, -3)).toBe(7); });
});

describe('numbering', () => {
  const ts = new Date(2026, 10, 7).getTime();
  it('formats', () => { expect(formatInvoiceNumber('INV', ts, 1)).toBe('INV-202611-0001'); expect(formatInvoiceNumber('a b!', ts, 12345)).toBe('ab-202611-12345'); expect(formatInvoiceNumber('', ts, 2)).toBe('INV-202611-0002'); });
  it('increments per month', () => {
    const a = nextInvoice({ prefix: 'NT', counters: {} }, ts);
    expect(a.number).toBe('NT-202611-0001');
    const b = nextInvoice({ prefix: 'NT', counters: a.counters }, ts);
    expect(b.number).toBe('NT-202611-0002');
    expect(nextInvoice({ prefix: 'NT', counters: b.counters }, new Date(2026, 11, 1).getTime()).number).toBe('NT-202612-0001');
  });
  it('next sku', () => { expect(nextSku([])).toBe('P-0001'); expect(nextSku(['P-0009', 'X', 'P-0003'])).toBe('P-0010'); });
});

describe('misc', () => {
  it('parseMoney', () => {
    expect(parseMoney('Rp 10.000')).toBe(10000); expect(parseMoney('10000')).toBe(10000); expect(parseMoney('10.000,50')).toBe(10000);
    expect(parseMoney('abc')).toBeNaN(); expect(parseMoney('')).toBeNaN(); expect(parseMoney(12.6)).toBe(13);
  });
  it('crm stage', () => { expect(crmStageFor('paid')).toBe('Deal'); expect(crmStageFor('done')).toBe('Selesai'); expect(crmStageFor('draft')).toBeNull(); });
  it('fmtIdr', () => { expect(fmtIdr(1500000).replace(/\s/g, ' ')).toBe('Rp 1.500.000'); });
});

describe('csv', () => {
  const p: Product = { id: '1', sku: 'P-0001', name: 'Kopi, "Susu"', category: 'Minum', price: 18000, cost: null, stock: null, unit: 'cup', active: true, note: '=cmd', photo: null, createdAt: 0, updatedAt: 0 };
  it('parses quotes, multiline, semicolons', () => {
    expect(parseCsv('a,b\r\n"x,1","y ""q"""\n')).toEqual([['a', 'b'], ['x,1', 'y "q"']]);
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\n"l1\nl2",z')).toEqual([['a', 'b'], ['l1\nl2', 'z']]);
  });
  it('round trips products and guards formulas', () => {
    const csv = productsToCsv([p]);
    expect(csv).toContain("'=cmd");
    const { rows, errors } = productsFromCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ sku: 'P-0001', name: 'Kopi, "Susu"', price: 18000, cost: null, stock: null, active: true, note: '=cmd' });
  });
  it('template imports cleanly and reports bad rows', () => {
    const t = productsFromCsv(productTemplateCsv());
    expect(t.errors).toEqual([]); expect(t.rows).toHaveLength(2); expect(t.rows[0]).toMatchObject({ cost: 15000, stock: 100 }); expect(t.rows[1].sku).toBeUndefined();
    const bad = productsFromCsv('nama,harga,stok\n,100,1\nA,xx,1\nB,500,\nC,1000,5');
    expect(bad.errors).toHaveLength(2); expect(bad.rows.map((r) => r.name)).toEqual(['B', 'C']);
    expect(productsFromCsv('foo\n1').errors[0]).toMatch(/nama/);
    expect(productsFromCsv('Nama,Harga Modal,Aktif\nZ,5.000,tidak').rows[0]).toMatchObject({ cost: 5000, active: false });
  });
  it('orders csv', () => { expect(ordersToCsv([fin()])).toContain('INV-202611-0001'); });
});

describe('report', () => {
  const now = new Date(2026, 10, 7, 12).getTime();
  const day = (d: number) => new Date(2026, 10, d, 9).getTime();
  const orders = [
    fin({ id: 'a', createdAt: day(7), status: 'paid', items: [item({ cost: 6000 })], customerName: 'Budi', customerPhone: '0812' }),
    fin({ id: 'b', createdAt: day(6), status: 'unpaid', items: [item({ productId: 'p2', name: 'Teh', qty: 1, price: 5000 })], customerName: 'Ani', customerPhone: '0899', method: 'transfer' }),
    fin({ id: 'c', createdAt: day(6), status: 'cancelled' }),
    fin({ id: 'd', createdAt: day(5), status: 'draft' }),
    fin({ id: 'e', createdAt: new Date(2026, 9, 1).getTime(), status: 'done' }),
  ];
  it('aggregates a week', () => {
    const r = buildReport(orders, resolveRange('week', now));
    expect(r.orderCount).toBe(2); expect(r.revenue).toBe(25000); expect(r.avgOrder).toBe(12500);
    expect(r.receivable).toBe(5000); expect(r.collected).toBe(20000);
    expect(r.grossProfit).toBe(8000);
    expect(r.topProducts[0]).toMatchObject({ name: 'Kopi', qty: 2, revenue: 20000 });
    expect(r.topCustomers[0]).toMatchObject({ name: 'Budi', total: 20000 });
    expect(r.granularity).toBe('day'); expect(r.series).toHaveLength(7);
    expect(r.series.reduce((s, x) => s + x.value, 0)).toBe(25000);
    expect(r.byMethod).toEqual([{ method: 'cash', amount: 20000, count: 1 }]);
  });
  it('null profit without cost, month granularity for all', () => {
    const r = buildReport([orders[4]], resolveRange('all', now));
    expect(r.grossProfit).toBeNull(); expect(r.orderCount).toBe(1);
    const long = buildReport([fin({ createdAt: new Date(2025, 0, 5).getTime(), status: 'paid' }), orders[0]], resolveRange('all', now));
    expect(long.granularity).toBe('month'); expect(long.series.map((s) => s.key)).toEqual(['2025-01', '2026-11']);
  });
  it('profit allocates order discount', () => {
    const o = fin({ items: [item({ cost: 6000 })], discountType: 'rp', discountValue: 2000 });
    expect(orderProfit(o)).toBe(20000 - 2000 - 12000);
  });
  it('csv export', () => {
    const csv = reportToCsv(buildReport(orders, resolveRange('week', now)), 'Minggu');
    expect(csv).toContain('Omzet,25000'); expect(csv).toContain('Kopi,2,20000');
  });
});

describe('invoice text', () => {
  const s = { ...DEFAULT_SETTINGS, storeName: 'Toko Maju', address: 'Jl. Mawar 1', phone: '0811', bankText: 'BCA 123 a/n Toko', footer: 'Makasih' };
  it('builds text with payment info when unpaid', () => {
    const o = fin({ discountType: 'pct', discountValue: 10, shipping: 5000, notes: 'Kirim sore', payments: [{ id: 'a', at: 1, amount: 5000, method: 'cash' }] });
    const t = buildInvoiceText(o, s);
    expect(t).toContain('*Toko Maju*'); expect(t).toContain('INV-202611-0001'); expect(t).toContain('1. Kopi');
    expect(t).toMatch(/2 x Rp 10.000 +Rp 20.000/); expect(t).toContain('Diskon 10%'); expect(t).toContain('Catatan: Kirim sore');
    expect(t).toContain('BCA 123'); expect(t).toContain('Sisa'); expect(t).toContain('Telp: 0811'); expect(t.trim().endsWith('Makasih')).toBe(true);
    const widths = t.split('\n').filter((l) => /^(Subtotal|TOTAL|Dibayar|Sisa)/.test(l)).map((l) => l.length);
    expect(new Set(widths).size).toBe(1);
  });
  it('omits payment block when paid and drops empty lines', () => {
    const t = buildInvoiceText(fin({ status: 'paid' }), { ...s, address: '' });
    expect(t).not.toContain('BCA'); expect(t).not.toMatch(/\n\n\n/); expect(t).not.toContain('Sisa');
    expect(t).not.toContain('{');
  });
  it('custom template with unknown var kept', () => {
    expect(renderTemplate('Hai {pelanggan} {x} {kosong}', { pelanggan: 'Budi', kosong: '' })).toBe('Hai Budi {x}');
    expect(DEFAULT_TEMPLATE).toContain('{ringkasan}');
  });
});
