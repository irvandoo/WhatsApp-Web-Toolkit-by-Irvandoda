/** Pure product-management logic (fisik / digital / jasa). No DOM, chrome or Dexie. Money = integer Rupiah. */
import { fmtDateTime, parseCsv, parseMoney, renderTemplate, toCsv } from './pos-logic';
import {
  type DeliveryMode, type LicenseCode, type Order, type OptionGroup, type OrderItem, type OrderStatus, type Product,
  type ProductType, type StockMove, type StockMoveType, type TierPrice, type Variant,
} from './pos-types';

export const TYPES: ProductType[] = ['fisik', 'digital', 'jasa'];
export const TYPE_LABEL: Record<ProductType, string> = { fisik: 'Fisik', digital: 'Digital', jasa: 'Jasa' };
export const DELIVERY_MODES: DeliveryMode[] = ['link', 'kode', 'file-url', 'akses'];
export const DELIVERY_LABEL: Record<DeliveryMode, string> = { link: 'Tautan', kode: 'Kode lisensi / voucher', 'file-url': 'URL file unduhan', akses: 'Akses akun / member' };
export const STOCK_MOVE_LABEL: Record<StockMoveType, string> = { masuk: 'Masuk', keluar: 'Keluar', penyesuaian: 'Penyesuaian', penjualan: 'Penjualan', retur: 'Retur' };
export const DEFAULT_MIN_STOCK = 5;
export const MAX_PHOTOS = 5;
export const MAX_PHOTO_CHARS = 200_000; // ~150KB binary
export const MAX_COMBOS = 200;

export const typeOf = (p: Pick<Product, 'type'> | null | undefined): ProductType => (p?.type === 'digital' || p?.type === 'jasa' ? p.type : 'fisik');
export const hasVariants = (p: Pick<Product, 'type' | 'variants'>) => typeOf(p) === 'fisik' && !!p.variants?.length;
export const isCodeProduct = (p: Pick<Product, 'type' | 'deliveryMode'>) => typeOf(p) === 'digital' && p.deliveryMode === 'kode';
export const minStockOf = (p: Pick<Product, 'minStock'>): number => (typeof p.minStock === 'number' && Number.isFinite(p.minStock) && p.minStock >= 0 ? Math.floor(p.minStock) : DEFAULT_MIN_STOCK);
export const isLunas = (s: OrderStatus) => s === 'paid' || s === 'shipped' || s === 'done';
export const isHttpUrl = (s: string) => { try { const u = new URL(s.trim()); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } };
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const clean = (s: unknown) => (typeof s === 'string' ? s.trim() : '');

// ---------- validation ----------
export function validateTiers(tiers: TierPrice[] | undefined): string[] {
  const errs: string[] = [];
  const seen = new Set<number>();
  for (const t of tiers ?? []) {
    if (!isInt(t.minQty) || t.minQty < 2) errs.push('Grosir: jumlah minimal harus bilangan bulat >= 2');
    else if (seen.has(t.minQty)) errs.push(`Grosir: jumlah minimal ${t.minQty} duplikat`);
    else seen.add(t.minQty);
    if (!isInt(t.price) || t.price < 0) errs.push('Grosir: harga harus bilangan bulat >= 0');
  }
  return errs;
}

/** Validation errors (Indonesian), empty = valid. Type-specific rules. */
export function validateProduct(p: Partial<Product>): string[] {
  const e: string[] = [];
  const type = typeOf(p);
  if (p.type !== undefined && !TYPES.includes(p.type)) e.push('Tipe produk tidak valid');
  if (!clean(p.name)) e.push('Nama produk wajib diisi');
  if (clean(p.name).length > 200) e.push('Nama maksimal 200 karakter');
  if (p.price !== undefined && (!isInt(p.price) || p.price < 0)) e.push('Harga jual harus bilangan bulat >= 0');
  if (p.cost != null && (!isInt(p.cost) || p.cost < 0)) e.push('Harga modal harus bilangan bulat >= 0');
  if (p.taxPct != null && (!(typeof p.taxPct === 'number') || p.taxPct < 0 || p.taxPct > 100)) e.push('Pajak harus 0-100%');
  if ((p.tags?.length ?? 0) > 20) e.push('Maksimal 20 tag');
  if ((p.photos?.length ?? 0) > MAX_PHOTOS) e.push(`Maksimal ${MAX_PHOTOS} foto`);
  if ((p.photos ?? []).some((x) => typeof x !== 'string' || !x.startsWith('data:image/') || x.length > MAX_PHOTO_CHARS)) e.push('Foto harus gambar <= 150KB');
  e.push(...validateTiers(p.tiers));
  if (type === 'fisik') {
    if (p.stock != null && !isInt(p.stock)) e.push('Stok harus bilangan bulat');
    if (p.weight != null && (typeof p.weight !== 'number' || p.weight < 0)) e.push('Berat tidak valid');
    if (p.dims && [p.dims.l, p.dims.w, p.dims.h].some((x) => typeof x !== 'number' || x < 0)) e.push('Dimensi tidak valid');
    if (p.minStock !== undefined && (!isInt(p.minStock) || p.minStock < 0)) e.push('Stok minimum harus bilangan bulat >= 0');
    const names = new Set<string>(), skus = new Set<string>();
    for (const v of p.variants ?? []) {
      const n = clean(v.name).toLowerCase();
      if (!n) e.push('Nama varian kosong');
      else if (names.has(n)) e.push(`Varian "${v.name}" duplikat`);
      names.add(n);
      const sk = clean(v.sku).toLowerCase();
      if (sk) { if (skus.has(sk)) e.push(`SKU varian "${v.sku}" duplikat`); skus.add(sk); }
      if (v.stock != null && (!isInt(v.stock) || v.stock < 0)) e.push(`Stok varian "${v.name}" tidak valid`);
      if (v.price != null && (!isInt(v.price) || v.price < 0)) e.push(`Harga varian "${v.name}" tidak valid`);
      if (v.cost != null && (!isInt(v.cost) || v.cost < 0)) e.push(`Modal varian "${v.name}" tidak valid`);
    }
  } else if (type === 'digital') {
    const m = p.deliveryMode;
    if (!m || !DELIVERY_MODES.includes(m)) e.push('Mode pengiriman digital wajib dipilih');
    else if ((m === 'link' || m === 'file-url') && !isHttpUrl(clean(p.downloadUrl))) e.push('URL unduhan/tautan harus diawali http:// atau https://');
    else if (m === 'akses' && !isHttpUrl(clean(p.accessUrl))) e.push('URL akses harus diawali http:// atau https://');
    if (p.validityDays != null && (!isInt(p.validityDays) || p.validityDays < 1)) e.push('Masa berlaku harus bilangan bulat >= 1 hari');
    if ((p.instructions ?? '').length > 4000) e.push('Instruksi maksimal 4000 karakter');
  } else if ((p.duration ?? '').length > 80) e.push('Durasi maksimal 80 karakter');
  return e;
}

// ---------- SKU ----------
const SKU_PREFIX: Record<ProductType, string> = { fisik: 'P', digital: 'D', jasa: 'J' };
const pad4 = (n: number) => String(n).padStart(4, '0');
/** Next auto SKU for a type ("P-0001", "D-0001", "J-0001"), unique against `existing` (case-insensitive). */
export function generateSku(existing: string[], type: ProductType = 'fisik'): string {
  const pre = SKU_PREFIX[type];
  const re = new RegExp(`^${pre}-(\\d+)$`, 'i');
  let max = 0;
  for (const s of existing) { const m = re.exec(s.trim()); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  const used = new Set(existing.map((s) => s.trim().toLowerCase()));
  let n = max + 1, sku = `${pre}-${pad4(n)}`;
  while (used.has(sku.toLowerCase())) sku = `${pre}-${pad4(++n)}`;
  return sku;
}
/** Make `want` unique by appending -2, -3 ... */
export function uniqueSku(want: string, existing: Iterable<string>): string {
  const used = new Set([...existing].map((s) => s.trim().toLowerCase()));
  const base = want.trim();
  let sku = base, n = 1;
  while (used.has(sku.toLowerCase())) sku = `${base}-${++n}`;
  return sku;
}

// ---------- variants ----------
export function cleanGroups(groups: OptionGroup[]): OptionGroup[] {
  return groups
    .map((g) => ({ name: g.name.trim(), values: [...new Set(g.values.map((v) => v.trim()).filter(Boolean))] }))
    .filter((g) => g.name && g.values.length);
}
const abbr = (s: string) => s.normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'X';

/**
 * Cartesian product of option groups -> variants. Variants whose name already exists are kept untouched
 * (price/stock/sku preserved); new ones get stock 0 and a unique SKU derived from `baseSku`.
 */
export function generateVariants(
  groups: OptionGroup[], existing: Variant[], baseSku: string, mkId: () => string, usedSkus: Iterable<string> = [],
): { variants: Variant[]; truncated: boolean } {
  const gs = cleanGroups(groups);
  if (!gs.length) return { variants: [], truncated: false };
  let combos: string[][] = [[]];
  for (const g of gs) combos = combos.flatMap((c) => g.values.map((v) => [...c, v]));
  const truncated = combos.length > MAX_COMBOS;
  if (truncated) combos = combos.slice(0, MAX_COMBOS);
  const byName = new Map(existing.map((v) => [v.name.toLowerCase(), v]));
  const used = new Set([...usedSkus, ...existing.map((v) => v.sku)].map((s) => s.trim().toLowerCase()).filter(Boolean));
  const out: Variant[] = combos.map((c) => {
    const name = c.join(' / ');
    const prev = byName.get(name.toLowerCase());
    if (prev) return prev;
    const sku = uniqueSku(`${baseSku || 'VAR'}-${c.map(abbr).join('-')}`, used);
    used.add(sku.toLowerCase());
    return { id: mkId(), name, sku, price: null, cost: null, stock: 0 };
  });
  return { variants: out, truncated };
}

// ---------- stock ----------
/** Total sellable stock. null = unlimited / not tracked. `pool` = available license codes (digital kode). */
export function totalStock(p: Product, pool?: number): number | null {
  const t = typeOf(p);
  if (t === 'jasa') return null;
  if (t === 'digital') return isCodeProduct(p) ? pool ?? p.stock ?? 0 : null;
  if (p.variants?.length) {
    let sum = 0;
    for (const v of p.variants) { if (v.stock == null) return null; sum += v.stock; }
    return sum;
  }
  return p.stock;
}
export type StockStatus = 'habis' | 'menipis' | 'aman' | 'tak-terbatas';
export const STATUS_LABEL_STOCK: Record<StockStatus, string> = { habis: 'Habis', menipis: 'Menipis', aman: 'Aman', 'tak-terbatas': 'Tak terbatas' };
export function stockStatus(p: Product, pool?: number): StockStatus {
  const s = totalStock(p, pool);
  if (s == null) return 'tak-terbatas';
  if (s <= 0) return 'habis';
  return s <= minStockOf(p) ? 'menipis' : 'aman';
}
export const isLowStockProduct = (p: Product, pool?: number) => { const s = stockStatus(p, pool); return s === 'habis' || s === 'menipis'; };
export const lowVariants = (p: Product) => (p.variants ?? []).filter((v) => v.stock != null && v.stock <= minStockOf(p));
export function stockSummary(ps: Product[], pools: Record<string, number> = {}) {
  const r = { habis: 0, menipis: 0, aman: 0, tak: 0, total: ps.length };
  for (const p of ps) {
    const s = stockStatus(p, pools[p.id]);
    if (s === 'habis') r.habis++; else if (s === 'menipis') r.menipis++; else if (s === 'aman') r.aman++; else r.tak++;
  }
  return r;
}

export const lineKey = (productId: string, variantId?: string | null) => `${productId}::${variantId ?? ''}`;
export const splitKey = (k: string): { productId: string; variantId: string | null } => {
  const i = k.indexOf('::');
  return { productId: k.slice(0, i), variantId: k.slice(i + 2) || null };
};
const qtyByLine = (items: OrderItem[]) => {
  const m: Record<string, number> = {};
  for (const it of items) if (it.productId) { const k = lineKey(it.productId, it.variantId); m[k] = (m[k] ?? 0) + it.qty; }
  return m;
};
/** Like pos-logic.stockPlan but keyed by product+variant. Positive delta = give back to stock. */
export function stockPlanLines(prev: Pick<Order, 'items' | 'stockApplied'> | null, next: Pick<Order, 'items' | 'status'>): { deltas: Record<string, number>; applied: boolean } {
  const before = prev?.stockApplied ? qtyByLine(prev.items) : {};
  const applied = next.status !== 'draft' && next.status !== 'cancelled';
  const after = applied ? qtyByLine(next.items) : {};
  const deltas: Record<string, number> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const d = (before[k] ?? 0) - (after[k] ?? 0);
    if (d !== 0) deltas[k] = d;
  }
  return { deltas, applied };
}

/** Available stock for a cart line (null = unlimited). */
export function availableFor(p: Product, variantId?: string | null): number | null {
  const t = typeOf(p);
  if (t === 'jasa') return null;
  if (t === 'digital') return isCodeProduct(p) ? p.stock ?? 0 : null;
  if (p.variants?.length) {
    const v = p.variants.find((x) => x.id === variantId);
    return v ? v.stock : 0;
  }
  return p.stock;
}
export interface Shortfall { key: string; name: string; need: number; available: number }
/** Cart lines exceeding stock. `credit` = qty already deducted by the stored order (editing a paid order). */
export function stockShortfalls(items: OrderItem[], products: Product[], credit: Record<string, number> = {}): Shortfall[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const out: Shortfall[] = [];
  for (const [k, need] of Object.entries(qtyByLine(items))) {
    const { productId, variantId } = splitKey(k);
    const p = byId.get(productId);
    if (!p) continue;
    const av = availableFor(p, variantId);
    if (av == null) continue;
    const have = av + (credit[k] ?? 0);
    if (need > have) {
      const vn = variantId ? p.variants?.find((v) => v.id === variantId)?.name : '';
      out.push({ key: k, name: p.name + (vn ? ` (${vn})` : ''), need, available: Math.max(0, have) });
    }
  }
  return out;
}
export const creditFromOrder = (o: Pick<Order, 'items' | 'stockApplied'> | null): Record<string, number> => (o?.stockApplied ? qtyByLine(o.items) : {});

export function makeStockMove(a: {
  id: string; productId: string; variantId?: string | null; ts: number; type: StockMoveType; delta: number; before: number | null; reason?: string; orderId?: string;
}): StockMove {
  return {
    id: a.id, productId: a.productId, variantId: a.variantId ?? null, ts: a.ts, type: a.type, delta: a.delta, before: a.before,
    after: a.before == null ? null : a.before + a.delta, reason: (a.reason ?? '').trim().slice(0, 200), ...(a.orderId ? { orderId: a.orderId } : {}),
  };
}
/** Resolve a manual adjustment. delta (relative) or set (absolute, null = unlimited). */
export function planStockAdjust(
  current: number | null, input: { delta?: number; set?: number | null; type?: StockMoveType; reason?: string },
): { ok: true; after: number | null; delta: number; type: StockMoveType } | { ok: false; error: string } {
  const reason = (input.reason ?? '').trim();
  if (input.set !== undefined) {
    if (input.set == null) return { ok: true, after: null, delta: 0, type: 'penyesuaian' };
    if (!isInt(input.set) || input.set < 0) return { ok: false, error: 'Stok harus bilangan bulat >= 0' };
    if (!reason) return { ok: false, error: 'Alasan wajib diisi' };
    return { ok: true, after: input.set, delta: input.set - (current ?? 0), type: 'penyesuaian' };
  }
  const d = input.delta;
  if (!isInt(d) || d === 0) return { ok: false, error: 'Jumlah harus bilangan bulat bukan nol' };
  if (current == null) return { ok: false, error: 'Stok tak terbatas, atur stok dulu' };
  if (!reason) return { ok: false, error: 'Alasan wajib diisi' };
  if (current + d < 0) return { ok: false, error: 'Stok tidak boleh negatif' };
  const type: StockMoveType = input.type ?? (d > 0 ? 'masuk' : 'keluar');
  if ((type === 'masuk' || type === 'retur') && d < 0) return { ok: false, error: 'Jenis pergerakan tidak sesuai jumlah' };
  if ((type === 'keluar' || type === 'penjualan') && d > 0) return { ok: false, error: 'Jenis pergerakan tidak sesuai jumlah' };
  return { ok: true, after: current + d, delta: d, type };
}

// ---------- pricing ----------
export interface UnitPrice { price: number; base: number; tierMinQty: number | null }
/** Unit price for qty: variant price (or product price), then best wholesale tier (never raises the price). */
export function resolveUnitPrice(p: Pick<Product, 'price' | 'tiers' | 'variants'>, qty: number, variantId?: string | null): UnitPrice {
  const v = variantId ? p.variants?.find((x) => x.id === variantId) : undefined;
  const base = v?.price ?? p.price;
  let best: TierPrice | null = null;
  for (const t of p.tiers ?? []) if (qty >= t.minQty && (!best || t.minQty > best.minQty)) best = t;
  if (best && best.price < base) return { price: best.price, base, tierMinQty: best.minQty };
  return { price: base, base, tierMinQty: null };
}
/** Change qty of a cart line; re-prices only if the current price still equals the auto price for the old qty. */
export function repriceLine(it: OrderItem, p: Product | undefined, newQty: number): OrderItem {
  if (!p || !it.productId) return { ...it, qty: newQty };
  const old = resolveUnitPrice(p, it.qty, it.variantId).price;
  const next = it.price === old ? resolveUnitPrice(p, newQty, it.variantId).price : it.price;
  return { ...it, qty: newQty, price: next };
}

// ---------- filtering ----------
export interface ProductFilter { type?: ProductType | ''; category?: string; q?: string; status?: StockStatus | ''; archived?: boolean }
export function filterProducts(ps: Product[], f: ProductFilter, pools: Record<string, number> = {}): Product[] {
  const s = (f.q ?? '').trim().toLowerCase();
  return ps.filter((p) => {
    if (!!p.archived !== !!f.archived) return false;
    if (f.type && typeOf(p) !== f.type) return false;
    if (f.category && p.category !== f.category) return false;
    if (f.status && stockStatus(p, pools[p.id]) !== f.status) return false;
    if (!s) return true;
    return p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || (p.barcode ?? '').toLowerCase().includes(s)
      || (p.tags ?? []).some((t) => t.toLowerCase().includes(s)) || (p.variants ?? []).some((v) => v.sku.toLowerCase().includes(s));
  });
}

// ---------- license codes ----------
export interface CodeParse { fresh: string[]; duplicateInInput: string[]; alreadyExists: string[]; invalid: string[] }
/** Parse a pasted list (newline / comma / semicolon separated). Dedupes and rejects codes already in `existing`. */
export function parseCodeList(text: string, existing: Iterable<string> = []): CodeParse {
  const have = new Set([...existing].map((c) => c.trim()));
  const seen = new Set<string>();
  const r: CodeParse = { fresh: [], duplicateInInput: [], alreadyExists: [], invalid: [] };
  for (const raw of text.split(/[\r\n,;|\t]+/)) {
    const c = raw.trim();
    if (!c) continue;
    if (c.length > 200 || /[\u0000-\u001f]/.test(c)) { r.invalid.push(c.slice(0, 40)); continue; }
    if (seen.has(c)) { r.duplicateInInput.push(c); continue; }
    seen.add(c);
    if (have.has(c)) r.alreadyExists.push(c); else r.fresh.push(c);
  }
  return r;
}
export function licenseCounts(codes: Pick<LicenseCode, 'status'>[]) {
  const c = { tersedia: 0, terpakai: 0, rusak: 0, total: codes.length };
  for (const x of codes) c[x.status]++;
  return c;
}

export interface LicensePlan {
  assign: { codeId: string; productId: string }[];
  release: string[];
  shortage: { productId: string; name: string; missing: number }[];
}
/**
 * Idempotent license reconciliation for an order. Cancelled -> release all of its codes. Lunas -> every
 * auto-deliver code product gets exactly sum(qty) codes (never double-assigns; extras released; missing taken from the pool).
 * Other statuses -> no change. Running the plan again after applying it yields an empty plan.
 */
export function planLicenses(order: Pick<Order, 'id' | 'status' | 'items'>, products: Product[], codes: LicenseCode[]): LicensePlan {
  const plan: LicensePlan = { assign: [], release: [], shortage: [] };
  const mine = codes.filter((c) => c.orderId === order.id && c.status === 'terpakai');
  if (order.status === 'cancelled') { plan.release = mine.map((c) => c.id); return plan; }
  if (!isLunas(order.status)) return plan;
  const byId = new Map(products.map((p) => [p.id, p]));
  const need = new Map<string, number>();
  for (const it of order.items) {
    const p = it.productId ? byId.get(it.productId) : undefined;
    if (p && isCodeProduct(p) && p.autoDeliver !== false) need.set(p.id, (need.get(p.id) ?? 0) + Math.max(1, Math.ceil(it.qty)));
  }
  const pool = new Map<string, LicenseCode[]>();
  for (const c of codes) if (c.status === 'tersedia') { const a = pool.get(c.productId) ?? []; a.push(c); pool.set(c.productId, a); }
  // codes of a manual-delivery product (autoDeliver off) that were delivered by hand stay assigned
  const manual = new Set(order.items.map((i) => (i.productId ? byId.get(i.productId) : undefined)).filter((p): p is Product => !!p && isCodeProduct(p) && p.autoDeliver === false).map((p) => p.id));
  for (const c of mine) if (!need.has(c.productId) && !manual.has(c.productId)) plan.release.push(c.id);
  for (const [pid, n] of need) {
    const have = mine.filter((c) => c.productId === pid).sort((a, b) => (a.assignedAt ?? 0) - (b.assignedAt ?? 0) || a.id.localeCompare(b.id));
    if (have.length > n) plan.release.push(...have.slice(n).map((c) => c.id));
    else if (have.length < n) {
      const avail = pool.get(pid) ?? [];
      const take = avail.slice(0, n - have.length);
      plan.assign.push(...take.map((c) => ({ codeId: c.id, productId: pid })));
      if (take.length < n - have.length) plan.shortage.push({ productId: pid, name: byId.get(pid)?.name ?? '', missing: n - have.length - take.length });
    }
  }
  return plan;
}

// ---------- digital delivery ----------
export const DELIVERY_VARS = ['nama', 'invoice', 'kode', 'produk', 'link', 'berlaku', 'tanggal'] as const;
const DAY = 86400e3;
const defaultInstruction = (m: DeliveryMode | undefined): string => {
  switch (m) {
    case 'kode': return 'Halo {nama}, terima kasih sudah membeli {produk} (invoice {invoice}).\nKode Anda:\n{kode}';
    case 'akses': return 'Halo {nama}, terima kasih sudah membeli {produk} (invoice {invoice}).\nAkses: {link}';
    case 'file-url': return 'Halo {nama}, terima kasih sudah membeli {produk} (invoice {invoice}).\nUnduh di sini: {link}';
    default: return 'Halo {nama}, terima kasih sudah membeli {produk} (invoice {invoice}).\nTautan: {link}';
  }
};
export function deliveryVars(product: Product, order: Pick<Order, 'customerName' | 'number' | 'createdAt'>, code?: string | string[]): Record<string, string> {
  const codes = (Array.isArray(code) ? code : code ? [code] : []).join('\n');
  const link = product.deliveryMode === 'akses' ? clean(product.accessUrl) : clean(product.downloadUrl);
  const berlaku = product.validityDays ? `${product.validityDays} hari (s.d. ${fmtDateTime(order.createdAt + product.validityDays * DAY).slice(0, 10)})` : '';
  return { nama: order.customerName?.trim() || 'Pelanggan', invoice: order.number, kode: codes, produk: product.name, link, berlaku, tanggal: fmtDateTime(order.createdAt) };
}
/** Delivery message for one digital product using its instruction template; the link / code is appended if the template omits it. */
export function buildDeliveryText(product: Product, order: Pick<Order, 'customerName' | 'number' | 'createdAt'>, code?: string | string[]): string {
  const vars = deliveryVars(product, order, code);
  const tpl = clean(product.instructions) ? product.instructions! : defaultInstruction(product.deliveryMode);
  let out = renderTemplate(tpl, vars);
  if (vars.link && !out.includes(vars.link)) out += `\n${product.deliveryMode === 'akses' ? 'Akses' : 'Tautan'}: ${vars.link}`;
  if (vars.kode && !out.includes(vars.kode)) out += `\nKode:\n${vars.kode}`;
  if (vars.berlaku && !/\{berlaku\}/.test(tpl)) out += `\nMasa berlaku: ${vars.berlaku}`;
  return out.trim();
}
/** Delivery text for a whole order (Lunas only): one block per auto-deliver digital product. */
export function buildOrderDelivery(order: Order, products: Product[], codes: LicenseCode[], force = false): string {
  if (!isLunas(order.status)) return '';
  const byId = new Map(products.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const it of order.items) {
    const p = it.productId ? byId.get(it.productId) : undefined;
    if (!p || typeOf(p) !== 'digital' || seen.has(p.id)) continue;
    const delivered = isCodeProduct(p) && codes.some((c) => c.orderId === order.id && c.productId === p.id && c.status === 'terpakai');
    if (p.autoDeliver === false && !force && !delivered) continue;
    seen.add(p.id);
    if (isCodeProduct(p)) {
      const mine = codes.filter((c) => c.orderId === order.id && c.productId === p.id && c.status === 'terpakai')
        .sort((a, b) => (a.assignedAt ?? 0) - (b.assignedAt ?? 0) || a.id.localeCompare(b.id)).map((c) => c.code);
      if (!mine.length) { blocks.push(`${p.name}: kode sedang disiapkan, mohon tunggu.`); continue; }
      blocks.push(buildDeliveryText(p, order, mine));
    } else blocks.push(buildDeliveryText(p, order));
  }
  return blocks.join('\n\n');
}
export const orderHasDigital = (o: Pick<Order, 'items'>, products: Product[]) => {
  const byId = new Map(products.map((p) => [p.id, p]));
  return o.items.some((i) => i.productId && typeOf(byId.get(i.productId)) === 'digital');
};

// ---------- CSV ----------
export const FISIK_HEADER = ['sku', 'nama', 'kategori', 'tag', 'harga_jual', 'harga_modal', 'stok', 'satuan', 'berat_gram', 'panjang_cm', 'lebar_cm', 'tinggi_cm', 'barcode', 'rak', 'stok_minimum', 'grosir', 'aktif', 'deskripsi'];
export const DIGITAL_HEADER = ['sku', 'nama', 'kategori', 'tag', 'harga_jual', 'harga_modal', 'mode_kirim', 'url', 'instruksi', 'masa_berlaku_hari', 'kirim_otomatis', 'kode', 'aktif', 'deskripsi'];
const HEADERS: Record<'fisik' | 'digital', string[]> = { fisik: FISIK_HEADER, digital: DIGITAL_HEADER };
const ALIASES: Record<string, string> = { harga: 'harga_jual', price: 'harga_jual', name: 'nama', category: 'kategori', stock: 'stok', unit: 'satuan', active: 'aktif', modal: 'harga_modal', hpp: 'harga_modal', kode_produk: 'sku', mode: 'mode_kirim' };

export interface CsvDraft extends Partial<Product> { name: string; codes?: string[] }
export interface CsvRowError { line: number; message: string }
export interface CsvParse { rows: CsvDraft[]; errors: CsvRowError[]; warnings: string[] }

const tiersToText = (t?: TierPrice[]) => (t ?? []).map((x) => `${x.minQty}:${x.price}`).join('|');
const yn = (b: boolean) => (b ? 'ya' : 'tidak');

export function productsToCsvByType(ps: Product[], type: 'fisik' | 'digital', codesByProduct: Record<string, string[]> = {}): string {
  const rows = ps.filter((p) => typeOf(p) === type).map((p) => {
    const common = [p.sku, p.name, p.category, (p.tags ?? []).join('|'), p.price, p.cost ?? ''];
    return type === 'fisik'
      ? [...common, p.stock ?? '', p.unit, p.weight ?? '', p.dims?.l ?? '', p.dims?.w ?? '', p.dims?.h ?? '', p.barcode ?? '', p.shelf ?? '', minStockOf(p), tiersToText(p.tiers), yn(p.active), p.description ?? '']
      : [...common, p.deliveryMode ?? '', p.deliveryMode === 'akses' ? p.accessUrl ?? '' : p.downloadUrl ?? '', p.instructions ?? '', p.validityDays ?? '', yn(p.autoDeliver !== false), (codesByProduct[p.id] ?? []).join('|'), yn(p.active), p.description ?? ''];
  });
  return toCsv(HEADERS[type], rows);
}
export function productTemplateByType(type: 'fisik' | 'digital'): string {
  return toCsv(HEADERS[type], type === 'fisik'
    ? [
      ['', 'Kaos Polos', 'Pakaian', 'kaos|katun', 85000, 45000, 50, 'pcs', 200, 30, 25, 3, '8991234567890', 'A-01', 5, '10:80000|50:75000', 'ya', 'Kaos katun combed'],
      ['', 'Jasa titip (stok tak terbatas)', '', '', 10000, '', '', 'pcs', '', '', '', '', '', '', '', '', 'ya', ''],
    ]
    : [
      ['', 'E-book Panduan', 'Digital', 'ebook', 49000, 0, 'link', 'https://contoh.com/ebook.pdf', 'Halo {nama}, unduh di {link}', 365, 'ya', '', 'ya', 'PDF 120 halaman'],
      ['', 'Voucher Game 100', 'Voucher', 'voucher', 25000, 20000, 'kode', '', 'Halo {nama}, kode Anda: {kode}', '', 'ya', 'ABCD-1234|EFGH-5678', 'ya', ''],
    ]);
}

const unq = (s: string) => s.trim().replace(/^'(?=[=+\-@\t\r])/, '');
const parseBool = (s: string, d: boolean) => (s === '' ? d : /^(1|ya|y|yes|true|aktif)$/i.test(s) ? true : /^(0|tidak|no|false|nonaktif|n)$/i.test(s) ? false : null);

/** Strict CSV import. Rows with any problem are dropped and reported with their line number. */
export function parseProductCsv(text: string, type: 'fisik' | 'digital'): CsvParse {
  const table = parseCsv(text);
  const res: CsvParse = { rows: [], errors: [], warnings: [] };
  if (!table.length) { res.errors.push({ line: 1, message: 'File kosong' }); return res; }
  const known = new Set(HEADERS[type]);
  const cols = table[0].map((h) => { const k = h.trim().toLowerCase().replace(/[\s-]+/g, '_'); return ALIASES[k] ?? k; });
  if (!cols.includes('nama')) { res.errors.push({ line: 1, message: 'Kolom "nama" tidak ditemukan (pakai template yang sesuai)' }); return res; }
  const required = type === 'digital' ? ['nama', 'harga_jual', 'mode_kirim'] : ['nama', 'harga_jual'];
  for (const r of required) if (!cols.includes(r)) { res.errors.push({ line: 1, message: `Kolom wajib "${r}" tidak ada` }); return res; }
  const unknown = cols.filter((c) => c && !known.has(c));
  if (unknown.length) res.warnings.push(`Kolom diabaikan: ${[...new Set(unknown)].join(', ')}`);
  const seen = new Set<string>();
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const g: Record<string, string> = {};
    cols.forEach((c, j) => { if (c && known.has(c) && g[c] === undefined) g[c] = unq(r[j] ?? ''); });
    const fail = (m: string) => res.errors.push({ line, message: m });
    const num = (k: string, label: string, opt = true): number | null | undefined => {
      const v = g[k];
      if (v === undefined || v === '') return opt ? null : undefined;
      const n = parseMoney(v);
      if (Number.isNaN(n) || n < 0) { fail(`${label} tidak valid ("${v}")`); return undefined; }
      return n;
    };
    const d: CsvDraft = { name: g.nama ?? '', type };
    if (!d.name) return fail('Nama kosong');
    if (g.sku) {
      const k = g.sku.toLowerCase();
      if (seen.has(k)) return fail(`SKU "${g.sku}" duplikat di file`);
      seen.add(k);
      d.sku = g.sku;
    }
    const price = num('harga_jual', 'Harga jual', false);
    if (price === undefined) return;
    d.price = price ?? 0;
    const cost = num('harga_modal', 'Harga modal');
    if (cost === undefined) return;
    d.cost = cost;
    if (g.kategori !== undefined) d.category = g.kategori;
    d.tags = (g.tag ?? '').split('|').map((t) => t.trim()).filter(Boolean);
    if (g.deskripsi !== undefined) d.description = g.deskripsi;
    const act = parseBool((g.aktif ?? '').trim(), true);
    if (act === null) return fail(`Kolom aktif tidak valid ("${g.aktif}")`);
    d.active = act;
    if (type === 'fisik') {
      const stok = num('stok', 'Stok');
      if (stok === undefined) return;
      d.stock = stok;
      if (g.satuan) d.unit = g.satuan;
      const w = num('berat_gram', 'Berat'); if (w === undefined) return; d.weight = w;
      const L = num('panjang_cm', 'Panjang'), W = num('lebar_cm', 'Lebar'), H = num('tinggi_cm', 'Tinggi');
      if (L === undefined || W === undefined || H === undefined) return;
      d.dims = L == null && W == null && H == null ? null : { l: L ?? 0, w: W ?? 0, h: H ?? 0 };
      d.barcode = g.barcode ?? ''; d.shelf = g.rak ?? '';
      const ms = num('stok_minimum', 'Stok minimum'); if (ms === undefined) return;
      d.minStock = ms ?? DEFAULT_MIN_STOCK;
      const tiers: TierPrice[] = [];
      for (const part of (g.grosir ?? '').split('|').map((x) => x.trim()).filter(Boolean)) {
        const m = /^(\d+)\s*:\s*(.+)$/.exec(part);
        const pr = m ? parseMoney(m[2]) : NaN;
        if (!m || Number.isNaN(pr)) return fail(`Format grosir salah ("${part}"), pakai minQty:harga|minQty:harga`);
        tiers.push({ minQty: parseInt(m[1], 10), price: pr });
      }
      d.tiers = tiers.sort((a, b) => a.minQty - b.minQty);
    } else {
      const mode = (g.mode_kirim ?? '').trim().toLowerCase() as DeliveryMode;
      if (!DELIVERY_MODES.includes(mode)) return fail(`mode_kirim harus salah satu: ${DELIVERY_MODES.join(', ')}`);
      d.deliveryMode = mode;
      if (mode === 'akses') d.accessUrl = g.url ?? ''; else d.downloadUrl = g.url ?? '';
      d.instructions = g.instruksi ?? '';
      const vd = num('masa_berlaku_hari', 'Masa berlaku'); if (vd === undefined) return; d.validityDays = vd;
      const ao = parseBool((g.kirim_otomatis ?? '').trim(), true);
      if (ao === null) return fail(`Kolom kirim_otomatis tidak valid ("${g.kirim_otomatis}")`);
      d.autoDeliver = ao;
      const cp = parseCodeList(g.kode ?? '', []);
      if (cp.invalid.length) return fail('Kode lisensi tidak valid');
      if (cp.fresh.length) { if (mode !== 'kode') return fail('Kolom kode hanya untuk mode_kirim "kode"'); d.codes = cp.fresh; }
    }
    const errs = validateProduct(d);
    if (errs.length) return fail(errs[0]);
    res.rows.push(d);
  });
  return res;
}
