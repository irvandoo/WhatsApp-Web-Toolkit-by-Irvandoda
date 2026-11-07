import { describe, expect, it } from 'vitest';
import {
  availableFor, buildDeliveryText, buildOrderDelivery, filterProducts, generateSku, generateVariants, licenseCounts, lowVariants, makeStockMove,
  parseCodeList, parseProductCsv, planLicenses, planStockAdjust, productsToCsvByType, productTemplateByType, repriceLine, resolveUnitPrice,
  stockPlanLines, stockShortfalls, stockStatus, stockSummary, totalStock, typeOf, uniqueSku, validateProduct,
} from './pos-products-logic';
import type { LicenseCode, Order, OrderItem, Product } from './pos-types';

const prod = (o: Partial<Product> = {}): Product => ({
  id: 'p1', sku: 'P-0001', name: 'Kaos', category: '', price: 100000, cost: null, stock: 10, unit: 'pcs', active: true, note: '', photo: null, createdAt: 0, updatedAt: 0, ...o,
});
const digital = (o: Partial<Product> = {}) => prod({ id: 'd1', sku: 'D-0001', name: 'Voucher', type: 'digital', deliveryMode: 'kode', stock: null, ...o });
const item = (o: Partial<OrderItem> = {}): OrderItem => ({ productId: 'p1', sku: 'P-0001', name: 'Kaos', qty: 1, price: 100000, cost: null, discount: 0, ...o });
const order = (o: Partial<Order> = {}): Order => ({
  id: 'o1', number: 'INV-1', contactKey: '', customerName: 'Budi', customerPhone: '', items: [item()], discountType: 'rp', discountValue: 0, shipping: 0, taxPct: 0,
  notes: '', method: 'cash', status: 'paid', payments: [], subtotal: 0, discountTotal: 0, tax: 0, total: 0, paid: 0, remaining: 0, stockApplied: false, crmSynced: false,
  createdAt: new Date(2026, 0, 1).getTime(), updatedAt: 0, ...o,
});
const code = (id: string, o: Partial<LicenseCode> = {}): LicenseCode => ({ id, productId: 'd1', code: id.toUpperCase(), status: 'tersedia', orderId: null, assignedAt: null, ...o });

describe('validation', () => {
  it('requires name and rejects bad numbers', () => {
    expect(validateProduct({ name: '' })).toContain('Nama produk wajib diisi');
    expect(validateProduct({ name: 'a', price: -1 })[0]).toMatch(/Harga jual/);
    expect(validateProduct({ name: 'a', price: 1.5 })[0]).toMatch(/Harga jual/);
  });
  it('legacy product without type is fisik', () => { expect(typeOf(prod())).toBe('fisik'); expect(validateProduct(prod())).toEqual([]); });
  it('fisik: variants and tiers', () => {
    expect(validateProduct(prod({ variants: [{ id: 'a', name: 'M', sku: 'x', stock: 1 }, { id: 'b', name: 'm', sku: 'X', stock: 1 }] })).length).toBe(2);
    expect(validateProduct(prod({ tiers: [{ minQty: 1, price: 5 }] }))[0]).toMatch(/Grosir/);
    expect(validateProduct(prod({ tiers: [{ minQty: 5, price: 5 }, { minQty: 5, price: 4 }] }))[0]).toMatch(/duplikat/);
    expect(validateProduct(prod({ minStock: -1 }))[0]).toMatch(/Stok minimum/);
  });
  it('digital needs mode and valid URL', () => {
    expect(validateProduct(digital({ deliveryMode: undefined }))[0]).toMatch(/Mode/);
    expect(validateProduct(digital({ deliveryMode: 'link', downloadUrl: 'javascript:alert(1)' }))[0]).toMatch(/URL/);
    expect(validateProduct(digital({ deliveryMode: 'link', downloadUrl: 'https://x.id/a' }))).toEqual([]);
    expect(validateProduct(digital({ deliveryMode: 'akses', accessUrl: '' }))[0]).toMatch(/akses/);
    expect(validateProduct(digital())).toEqual([]);
    expect(validateProduct(digital({ validityDays: 0 }))[0]).toMatch(/Masa berlaku/);
  });
  it('limits photos to 5', () => {
    const ph = 'data:image/jpeg;base64,AAA';
    expect(validateProduct(prod({ photos: Array(6).fill(ph) }))[0]).toMatch(/Maksimal 5/);
    expect(validateProduct(prod({ photos: ['http://evil/x.png'] }))[0]).toMatch(/Foto/);
  });
});

describe('sku', () => {
  it('generates per-type prefix, unique', () => {
    expect(generateSku([], 'fisik')).toBe('P-0001');
    expect(generateSku(['P-0001', 'p-0007', 'D-0003'], 'fisik')).toBe('P-0008');
    expect(generateSku(['D-0003'], 'digital')).toBe('D-0004');
    expect(generateSku([], 'jasa')).toBe('J-0001');
  });
  it('uniqueSku appends suffix', () => { expect(uniqueSku('A', ['a', 'A-2'])).toBe('A-3'); expect(uniqueSku('B', ['a'])).toBe('B'); });
});

describe('variants', () => {
  let n = 0;
  const mk = () => 'v' + ++n;
  it('generates combinations and keeps existing', () => {
    const g = [{ name: 'Warna', values: ['Merah', 'Biru'] }, { name: 'Ukuran', values: ['S', 'L', 'L', ' '] }];
    const r = generateVariants(g, [], 'KAOS', mk);
    expect(r.variants.map((v) => v.name)).toEqual(['Merah / S', 'Merah / L', 'Biru / S', 'Biru / L']);
    expect(new Set(r.variants.map((v) => v.sku)).size).toBe(4);
    const edited = r.variants.map((v) => (v.name === 'Biru / L' ? { ...v, stock: 9, price: 5 } : v));
    const again = generateVariants([{ name: 'Warna', values: ['Biru'] }, { name: 'Ukuran', values: ['L', 'XL'] }], edited, 'KAOS', mk);
    expect(again.variants[0]).toMatchObject({ name: 'Biru / L', stock: 9, price: 5 });
    expect(again.variants[1].name).toBe('Biru / XL');
  });
  it('empty groups -> none; caps combos', () => {
    expect(generateVariants([], [], 'X', mk).variants).toEqual([]);
    const big = [{ name: 'a', values: Array.from({ length: 20 }, (_, i) => 'a' + i) }, { name: 'b', values: Array.from({ length: 20 }, (_, i) => 'b' + i) }];
    const r = generateVariants(big, [], 'X', mk);
    expect(r.truncated).toBe(true);
    expect(r.variants.length).toBe(200);
  });
});

describe('stock', () => {
  const withV = prod({ variants: [{ id: 'a', name: 'S', sku: 's', stock: 2 }, { id: 'b', name: 'M', sku: 'm', stock: 8 }], minStock: 3 });
  it('totals variants, unlimited, pool, jasa', () => {
    expect(totalStock(withV)).toBe(10);
    expect(totalStock({ ...withV, variants: [{ id: 'a', name: 'S', sku: '', stock: null }] })).toBeNull();
    expect(totalStock(prod({ stock: null }))).toBeNull();
    expect(totalStock(digital(), 7)).toBe(7);
    expect(totalStock(digital({ deliveryMode: 'link' }), 7)).toBeNull();
    expect(totalStock(prod({ type: 'jasa' }))).toBeNull();
  });
  it('status uses per-product minimum', () => {
    expect(stockStatus(prod({ stock: 6 }))).toBe('aman');
    expect(stockStatus(prod({ stock: 5 }))).toBe('menipis');
    expect(stockStatus(prod({ stock: 6, minStock: 10 }))).toBe('menipis');
    expect(stockStatus(prod({ stock: 0 }))).toBe('habis');
    expect(stockStatus(digital(), 0)).toBe('habis');
    expect(stockStatus(prod({ stock: null }))).toBe('tak-terbatas');
    expect(lowVariants(withV).map((v) => v.id)).toEqual(['a']);
    expect(stockSummary([prod({ stock: 0 }), prod({ stock: 3 }), prod({ stock: 50 }), prod({ stock: null })])).toMatchObject({ habis: 1, menipis: 1, aman: 1, tak: 1 });
  });
  it('plan by product+variant is idempotent', () => {
    const items = [item({ variantId: 'a', qty: 2 }), item({ variantId: 'b', qty: 1 })];
    const first = stockPlanLines(null, { items, status: 'paid' });
    expect(first.deltas).toEqual({ 'p1::a': -2, 'p1::b': -1 });
    const stored = { items, stockApplied: first.applied };
    expect(stockPlanLines(stored, { items, status: 'paid' }).deltas).toEqual({});
    expect(stockPlanLines(stored, { items, status: 'cancelled' }).deltas).toEqual({ 'p1::a': 2, 'p1::b': 1 });
    expect(stockPlanLines({ items, stockApplied: false }, { items, status: 'cancelled' }).deltas).toEqual({});
  });
  it('shortfalls with credit', () => {
    const ps = [withV];
    expect(stockShortfalls([item({ variantId: 'a', qty: 3 })], ps).map((s) => s.available)).toEqual([2]);
    expect(stockShortfalls([item({ variantId: 'a', qty: 3 })], ps, { 'p1::a': 1 })).toEqual([]);
    expect(stockShortfalls([item({ productId: 'x' })], ps)).toEqual([]);
    expect(availableFor(digital({ stock: 4 }))).toBe(4);
    expect(availableFor(prod({ type: 'jasa' }))).toBeNull();
  });
  it('adjust planning', () => {
    expect(planStockAdjust(5, { delta: 3, reason: 'restock' })).toMatchObject({ ok: true, after: 8, type: 'masuk' });
    expect(planStockAdjust(5, { delta: -6, reason: 'x' })).toMatchObject({ ok: false });
    expect(planStockAdjust(5, { delta: 2 })).toMatchObject({ ok: false });
    expect(planStockAdjust(5, { set: 2, reason: 'opname' })).toMatchObject({ ok: true, after: 2, delta: -3, type: 'penyesuaian' });
    expect(planStockAdjust(null, { delta: 1, reason: 'r' })).toMatchObject({ ok: false });
    expect(planStockAdjust(5, { delta: 1, type: 'keluar', reason: 'r' })).toMatchObject({ ok: false });
    const m = makeStockMove({ id: 'm', productId: 'p1', ts: 1, type: 'keluar', delta: -2, before: 5, reason: ' rusak ' });
    expect(m).toMatchObject({ after: 3, reason: 'rusak', variantId: null });
  });
});

describe('pricing', () => {
  const p = prod({ price: 1000, tiers: [{ minQty: 10, price: 900 }, { minQty: 50, price: 800 }], variants: [{ id: 'v', name: 'XL', sku: '', price: 1200, stock: 1 }] });
  it('resolves tiers', () => {
    expect(resolveUnitPrice(p, 1)).toEqual({ price: 1000, base: 1000, tierMinQty: null });
    expect(resolveUnitPrice(p, 10).price).toBe(900);
    expect(resolveUnitPrice(p, 49).price).toBe(900);
    expect(resolveUnitPrice(p, 50).price).toBe(800);
    expect(resolveUnitPrice(p, 1, 'v').price).toBe(1200);
    expect(resolveUnitPrice(p, 10, 'v').price).toBe(900);
  });
  it('reprices only when price is still automatic', () => {
    expect(repriceLine(item({ price: 1000, qty: 1 }), p, 10).price).toBe(900);
    expect(repriceLine(item({ price: 777, qty: 1 }), p, 10).price).toBe(777);
    expect(repriceLine(item({ price: 900, qty: 10 }), p, 2).price).toBe(1000);
  });
});

describe('filter', () => {
  const ps = [prod({ id: 'a', name: 'Kopi', stock: 0, tags: ['minuman'] }), digital({ id: 'b', name: 'E-book', category: 'Digital', deliveryMode: 'link', downloadUrl: 'https://a.id' }), prod({ id: 'c', name: 'Lama', archived: true })];
  it('filters', () => {
    expect(filterProducts(ps, {}).map((p) => p.id)).toEqual(['a', 'b']);
    expect(filterProducts(ps, { type: 'digital' }).map((p) => p.id)).toEqual(['b']);
    expect(filterProducts(ps, { status: 'habis' }).map((p) => p.id)).toEqual(['a']);
    expect(filterProducts(ps, { q: 'minum' }).map((p) => p.id)).toEqual(['a']);
    expect(filterProducts(ps, { archived: true }).map((p) => p.id)).toEqual(['c']);
    expect(filterProducts(ps, { category: 'Digital' }).map((p) => p.id)).toEqual(['b']);
  });
});

describe('license codes', () => {
  it('parses, dedupes and rejects existing', () => {
    const r = parseCodeList('A1\nB2, A1;C3\n\n D4 \nB2', ['C3']);
    expect(r.fresh).toEqual(['A1', 'B2', 'D4']);
    expect(r.duplicateInInput).toEqual(['A1', 'B2']);
    expect(r.alreadyExists).toEqual(['C3']);
    expect(parseCodeList('x'.repeat(201)).invalid.length).toBe(1);
  });
  it('counts', () => {
    expect(licenseCounts([code('a'), code('b', { status: 'rusak' }), code('c', { status: 'terpakai' })])).toEqual({ tersedia: 1, terpakai: 1, rusak: 1, total: 3 });
  });

  const dp = digital();
  const apply = (codes: LicenseCode[], pl: ReturnType<typeof planLicenses>, oid: string): LicenseCode[] =>
    codes.map((c) => pl.assign.some((a) => a.codeId === c.id) ? { ...c, status: 'terpakai' as const, orderId: oid, assignedAt: 5 }
      : pl.release.includes(c.id) ? { ...c, status: 'tersedia' as const, orderId: null, assignedAt: null } : c);
  it('assigns exactly qty codes, idempotently', () => {
    const o = order({ items: [item({ productId: 'd1', qty: 2 })] });
    let codes = [code('a'), code('b'), code('c'), code('r', { status: 'rusak' })];
    const pl = planLicenses(o, [dp], codes);
    expect(pl.assign.map((a) => a.codeId)).toEqual(['a', 'b']);
    codes = apply(codes, pl, o.id);
    expect(planLicenses(o, [dp], codes)).toEqual({ assign: [], release: [], shortage: [] });
    const o2 = order({ id: 'o2', items: [item({ productId: 'd1', qty: 2 })] });
    const p2 = planLicenses(o2, [dp], codes);
    expect(p2.assign.map((a) => a.codeId)).toEqual(['c']);
    expect(p2.shortage[0].missing).toBe(1);
  });
  it('releases on cancel and when qty drops; ignores unpaid', () => {
    const o = order({ items: [item({ productId: 'd1', qty: 2 })] });
    let codes = [code('a'), code('b')];
    codes = apply(codes, planLicenses(o, [dp], codes), o.id);
    expect(planLicenses({ ...o, status: 'unpaid' }, [dp], codes)).toEqual({ assign: [], release: [], shortage: [] });
    const cancelled = planLicenses({ ...o, status: 'cancelled' }, [dp], codes);
    expect([...cancelled.release].sort()).toEqual(['a', 'b']);
    expect(planLicenses({ ...o, items: [item({ productId: 'd1', qty: 1 })] }, [dp], codes).release).toEqual(['b']);
    const released = apply(codes, cancelled, o.id);
    expect(planLicenses({ ...o, status: 'cancelled' }, [dp], released).release).toEqual([]);
  });
  it('skips products with autoDeliver off', () => {
    const o = order({ items: [item({ productId: 'd1', qty: 1 })] });
    expect(planLicenses(o, [digital({ autoDeliver: false })], [code('a')]).assign).toEqual([]);
  });
});

describe('delivery text', () => {
  const o = order({ customerName: 'Budi', number: 'INV-9' });
  it('uses template variables', () => {
    const p = digital({ instructions: 'Hai {nama}, kode {kode} utk {invoice}' });
    expect(buildDeliveryText(p, o, 'ABC')).toBe('Hai Budi, kode ABC utk INV-9');
  });
  it('appends link/code when template omits them; defaults per mode', () => {
    const p = digital({ deliveryMode: 'link', downloadUrl: 'https://x.id/f', instructions: 'Terima kasih' });
    expect(buildDeliveryText(p, o)).toBe('Terima kasih\nTautan: https://x.id/f');
    expect(buildDeliveryText(digital(), o, ['K1', 'K2'])).toContain('K1\nK2');
    expect(buildDeliveryText(digital({ deliveryMode: 'akses', accessUrl: 'https://m.id' }), o)).toContain('https://m.id');
    expect(buildDeliveryText(digital({ validityDays: 30 }), o, 'K')).toMatch(/Masa berlaku: 30 hari/);
  });
  it('order delivery only when Lunas', () => {
    const dp = digital();
    const ord = order({ items: [item({ productId: 'd1', qty: 1 })] });
    const codes = [code('a', { status: 'terpakai', orderId: 'o1', assignedAt: 1 })];
    expect(buildOrderDelivery({ ...ord, status: 'unpaid' }, [dp], codes)).toBe('');
    expect(buildOrderDelivery(ord, [dp], codes)).toContain('A');
    expect(buildOrderDelivery(ord, [dp], [])).toMatch(/disiapkan/);
    expect(buildOrderDelivery(order(), [prod()], [])).toBe('');
  });
});

describe('csv', () => {
  it('templates round-trip through strict parser', () => {
    for (const t of ['fisik', 'digital'] as const) {
      const r = parseProductCsv(productTemplateByType(t), t);
      expect(r.errors).toEqual([]);
      expect(r.rows.length).toBe(2);
    }
    const f = parseProductCsv(productTemplateByType('fisik'), 'fisik').rows;
    expect(f[0]).toMatchObject({ name: 'Kaos Polos', price: 85000, stock: 50, weight: 200, minStock: 5, tiers: [{ minQty: 10, price: 80000 }, { minQty: 50, price: 75000 }] });
    expect(f[1].stock).toBeNull();
    const d = parseProductCsv(productTemplateByType('digital'), 'digital').rows;
    expect(d[1]).toMatchObject({ deliveryMode: 'kode', codes: ['ABCD-1234', 'EFGH-5678'] });
  });
  it('reports per-row errors with line numbers', () => {
    const csv = 'sku,nama,harga_jual,stok\nA,Ok,1000,5\nA,Dup,1000,5\nB,,1000,5\nC,Neg,-5,1\nD,BadStock,10,abc';
    const r = parseProductCsv(csv, 'fisik');
    expect(r.rows.length).toBe(1);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
  });
  it('digital: mode and url validation', () => {
    const base = 'nama,harga_jual,mode_kirim,url\n';
    expect(parseProductCsv(base + 'A,1000,link,notaurl', 'digital').errors[0].message).toMatch(/URL/);
    expect(parseProductCsv(base + 'A,1000,xxx,', 'digital').errors[0].message).toMatch(/mode_kirim/);
    expect(parseProductCsv('nama,harga_jual\nA,1', 'digital').errors[0].message).toMatch(/mode_kirim/);
    expect(parseProductCsv(base + 'A,1000,link,https://a.id', 'digital').rows.length).toBe(1);
  });
  it('warns on unknown columns and rejects missing name column', () => {
    expect(parseProductCsv('nama,harga_jual,foo\nA,1,2', 'fisik').warnings[0]).toMatch(/foo/);
    expect(parseProductCsv('x,y\n1,2', 'fisik').errors[0].line).toBe(1);
  });
  it('export is injection-safe and filtered by type', () => {
    const ps = [prod({ name: '=HYPERLINK("x")', description: '@evil' }), digital({ name: '+cmd' })];
    const csv = productsToCsvByType(ps, 'fisik');
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'@evil");
    expect(csv).not.toContain('+cmd');
    expect(parseProductCsv(csv, 'fisik').rows[0].name).toBe('=HYPERLINK("x")');
    expect(productsToCsvByType(ps, 'digital')).toContain("'+cmd");
  });
});
