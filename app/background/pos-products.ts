/** Product-management side of the POS background: categories, stock moves, license pool, bulk ops, order effects. */
import { db } from '../shared/db';
import {
  cleanGroups, isCodeProduct, isHttpUrl, isLunas, makeStockMove, MAX_PHOTO_CHARS, MAX_PHOTOS, parseCodeList, planLicenses, planStockAdjust,
  splitKey, stockPlanLines, TYPES, typeOf, buildOrderDelivery, DELIVERY_MODES, DEFAULT_MIN_STOCK,
} from '../shared/pos-products-logic';
import type { Category, LicenseCode, Order, PosMsg, Product, StockMove, TierPrice, Variant } from '../shared/pos-types';

const uid = () => crypto.randomUUID();
const int = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const MAX_CODES_PER_IMPORT = 5000;

// ---------- product normalisation ----------
const optInt = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

/** Apply the product-management fields of `p` on top of `out` (already holding the legacy fields). */
export function finalizeProduct(out: Product, p: Partial<Product>, prev: Product | undefined): Product {
  const has = <K extends keyof Product>(k: K) => k in p && p[k] !== undefined;
  const type = has('type') && TYPES.includes(p.type!) ? p.type! : prev?.type ?? 'fisik';
  const validPhoto = (x: unknown): x is string => typeof x === 'string' && x.startsWith('data:image/') && x.length <= MAX_PHOTO_CHARS;
  let photos = prev?.photos ?? (prev?.photo ? [prev.photo] : []);
  if (has('photos')) photos = (p.photos ?? []).filter(validPhoto).slice(0, MAX_PHOTOS);
  else if (has('photo')) photos = out.photo ? [out.photo, ...photos.filter((x) => x !== out.photo).slice(0, MAX_PHOTOS - 1)] : [];
  const archived = has('archived') ? !!p.archived : prev?.archived ?? false;
  const tiers: TierPrice[] = (has('tiers') ? p.tiers! : prev?.tiers ?? [])
    .filter((t) => Number.isInteger(t.minQty) && t.minQty >= 2 && Number.isFinite(t.price) && t.price >= 0)
    .map((t) => ({ minQty: t.minQty, price: Math.round(t.price) })).sort((a, b) => a.minQty - b.minQty);
  const rawVariants = has('variants') ? p.variants! : prev?.variants ?? [];
  const usedSkus = new Set<string>();
  const variants: Variant[] = type !== 'fisik' ? [] : rawVariants.map((v) => {
    let sku = str(v.sku).trim().slice(0, 60);
    if (sku && usedSkus.has(sku.toLowerCase())) sku = '';
    if (sku) usedSkus.add(sku.toLowerCase());
    return {
      id: str(v.id) || uid(), name: str(v.name).trim().slice(0, 100), sku,
      price: v.price == null ? null : optInt(v.price), cost: v.cost == null ? null : optInt(v.cost),
      stock: v.stock == null ? null : Math.max(0, int(v.stock)),
    };
  });
  const mode = has('deliveryMode') ? p.deliveryMode : prev?.deliveryMode;
  const dims = has('dims') ? (p.dims ? { l: Math.max(0, +p.dims.l || 0), w: Math.max(0, +p.dims.w || 0), h: Math.max(0, +p.dims.h || 0) } : null) : prev?.dims ?? null;
  const next: Product = {
    ...out,
    type,
    active: archived ? false : out.active,
    archived,
    description: has('description') ? str(p.description).slice(0, 4000) : prev?.description ?? '',
    tags: (has('tags') ? p.tags! : prev?.tags ?? []).map((t) => str(t).trim().slice(0, 40)).filter(Boolean).slice(0, 20),
    photos,
    photo: photos[0] ?? null,
    taxPct: has('taxPct') ? (p.taxPct == null ? null : Math.min(100, Math.max(0, Number(p.taxPct) || 0))) : prev?.taxPct ?? null,
    minStock: has('minStock') ? Math.max(0, int(p.minStock, DEFAULT_MIN_STOCK)) : prev?.minStock ?? DEFAULT_MIN_STOCK,
    weight: has('weight') ? (p.weight == null ? null : optInt(p.weight)) : prev?.weight ?? null,
    dims,
    barcode: has('barcode') ? str(p.barcode).trim().slice(0, 60) : prev?.barcode ?? '',
    shelf: has('shelf') ? str(p.shelf).trim().slice(0, 60) : prev?.shelf ?? '',
    tiers,
    optionGroups: type === 'fisik' ? cleanGroups(has('optionGroups') ? p.optionGroups! : prev?.optionGroups ?? []) : [],
    variants,
    deliveryMode: type === 'digital' && mode && DELIVERY_MODES.includes(mode) ? mode : undefined,
    downloadUrl: has('downloadUrl') ? str(p.downloadUrl).trim().slice(0, 1000) : prev?.downloadUrl ?? '',
    accessUrl: has('accessUrl') ? str(p.accessUrl).trim().slice(0, 1000) : prev?.accessUrl ?? '',
    instructions: has('instructions') ? str(p.instructions).slice(0, 4000) : prev?.instructions ?? '',
    validityDays: has('validityDays') ? (p.validityDays == null ? null : Math.max(1, int(p.validityDays, 1))) : prev?.validityDays ?? null,
    autoDeliver: has('autoDeliver') ? !!p.autoDeliver : prev?.autoDeliver ?? true,
    duration: has('duration') ? str(p.duration).trim().slice(0, 80) : prev?.duration ?? '',
  };
  for (const k of ['downloadUrl', 'accessUrl'] as const) if (next[k] && !isHttpUrl(next[k]!)) next[k] = '';
  if (type === 'jasa') next.stock = null;
  else if (type === 'digital') next.stock = isCodeProduct(next) ? prev?.stock ?? 0 : null;
  else if (variants.length) next.stock = variants.some((v) => v.stock == null) ? null : variants.reduce((s, v) => s + (v.stock ?? 0), 0);
  return next;
}

// ---------- categories ----------
export async function ensureCategory(name: string): Promise<void> {
  const n = name.trim();
  if (!n) return;
  const all = await db.categories.toArray();
  if (!all.some((c) => c.name.toLowerCase() === n.toLowerCase())) await db.categories.put({ id: uid(), name: n });
}

async function listCategories(): Promise<Category[]> {
  return db.transaction('rw', db.categories, db.products, async () => {
    const cats = await db.categories.toArray();
    const have = new Set(cats.map((c) => c.name.toLowerCase()));
    for (const p of await db.products.toArray()) {
      const n = p.category.trim();
      if (n && !have.has(n.toLowerCase())) { const c = { id: uid(), name: n }; await db.categories.put(c); cats.push(c); have.add(n.toLowerCase()); }
    }
    return cats.sort((a, b) => a.name.localeCompare(b.name));
  });
}

async function upsertCategory(id: string | undefined, name: string): Promise<Category> {
  const n = str(name).trim().slice(0, 80);
  if (!n) throw new Error('Nama kategori wajib diisi');
  return db.transaction('rw', db.categories, db.products, async () => {
    const all = await db.categories.toArray();
    if (all.some((c) => c.name.toLowerCase() === n.toLowerCase() && c.id !== id)) throw new Error(`Kategori "${n}" sudah ada`);
    const prev = id ? all.find((c) => c.id === id) : undefined;
    if (id && !prev) throw new Error('Kategori tidak ditemukan');
    const out: Category = { id: prev?.id ?? uid(), name: n };
    await db.categories.put(out);
    if (prev && prev.name !== n) {
      const now = Date.now();
      await db.products.where('category').equals(prev.name).modify((p) => { p.category = n; p.updatedAt = now; });
    }
    return out;
  });
}

async function deleteCategory(id: string) {
  return db.transaction('rw', db.categories, db.products, async () => {
    const c = await db.categories.get(id);
    if (!c) return { ok: true, cleared: 0 };
    const now = Date.now();
    const cleared = await db.products.where('category').equals(c.name).modify((p) => { p.category = ''; p.updatedAt = now; });
    await db.categories.delete(id);
    return { ok: true, cleared };
  });
}

// ---------- license pool ----------
export async function syncPool(productId: string): Promise<number> {
  const n = await db.licenseCodes.where('productId').equals(productId).filter((c) => c.status === 'tersedia').count();
  const p = await db.products.get(productId);
  if (p && isCodeProduct(p) && p.stock !== n) await db.products.put({ ...p, stock: n, updatedAt: Date.now() });
  return n;
}

/** Add codes to a product's pool (dedupe in input, reject codes that already exist). Caller provides the transaction. */
export async function addCodes(productId: string, text: string) {
  const existing = await db.licenseCodes.where('productId').equals(productId).toArray();
  const r = parseCodeList(text, existing.map((c) => c.code));
  const fresh = r.fresh.slice(0, MAX_CODES_PER_IMPORT);
  await db.licenseCodes.bulkPut(fresh.map((code): LicenseCode => ({ id: uid(), productId, code, status: 'tersedia', orderId: null, assignedAt: null })));
  return { added: fresh.length, duplicateInInput: r.duplicateInInput.length, alreadyExists: r.alreadyExists.length, invalid: r.invalid.length, truncated: r.fresh.length - fresh.length, rejected: r.alreadyExists.slice(0, 10) };
}

async function importLicenses(productId: string, text: string) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Daftar kode kosong');
  if (text.length > 2_000_000) throw new Error('Daftar kode terlalu besar');
  return db.transaction('rw', db.products, db.licenseCodes, db.orders, db.stockMoves, async () => {
    const p = await db.products.get(productId);
    if (!p) throw new Error('Produk tidak ditemukan');
    if (!isCodeProduct(p)) throw new Error('Produk ini bukan produk digital dengan mode kode');
    const r = await addCodes(productId, text);
    await syncPool(productId);
    // fulfil paid orders that were waiting for codes
    const orders = await db.orders.toArray();
    for (const o of orders) {
      if (!isLunas(o.status) || !o.items.some((i) => i.productId === productId)) continue;
      const upd = await reconcileLicenses(o, Date.now());
      if (upd.deliveryText !== o.deliveryText) await db.orders.put(upd);
    }
    return r;
  });
}

async function markLicenses(ids: string[], status: 'tersedia' | 'rusak' | 'hapus') {
  if (!Array.isArray(ids) || !ids.length) return { changed: 0, skipped: 0 };
  return db.transaction('rw', db.products, db.licenseCodes, async () => {
    const rows = (await db.licenseCodes.bulkGet(ids.map(String))).filter((c): c is LicenseCode => !!c);
    let changed = 0, skipped = 0;
    const pids = new Set<string>();
    for (const c of rows) {
      if (c.status === 'terpakai') { skipped++; continue; } // used codes belong to an order; never touched here
      pids.add(c.productId);
      if (status === 'hapus') await db.licenseCodes.delete(c.id);
      else await db.licenseCodes.put({ ...c, status });
      changed++;
    }
    for (const pid of pids) await syncPool(pid);
    return { changed, skipped };
  });
}

/**
 * Idempotently assign/release license codes for an order and (re)build its deliveryText.
 * `force` = deliver even products whose auto-deliver flag is off. Returns the updated order (caller persists it).
 */
export async function reconcileLicenses(o: Order, now: number, force = false): Promise<Order> {
  const ids = [...new Set(o.items.map((i) => i.productId).filter((x): x is string => !!x))];
  const prods = (await db.products.bulkGet(ids)).filter((p): p is Product => !!p).map((p) => (force ? { ...p, autoDeliver: true } : p));
  const codeProds = prods.filter(isCodeProduct).map((p) => p.id);
  const byOrder = await db.licenseCodes.where('orderId').equals(o.id).toArray();
  const pool = codeProds.length ? await db.licenseCodes.where('productId').anyOf(codeProds).toArray() : [];
  const all = [...new Map([...pool, ...byOrder].map((c) => [c.id, c])).values()];
  const plan = planLicenses(o, prods, all);
  const touched = new Set<string>();
  const byId = new Map(all.map((c) => [c.id, c]));
  for (const a of plan.assign) {
    const c = byId.get(a.codeId)!;
    const upd: LicenseCode = { ...c, status: 'terpakai', orderId: o.id, assignedAt: now };
    await db.licenseCodes.put(upd); byId.set(c.id, upd); touched.add(c.productId);
  }
  for (const id of plan.release) {
    const c = byId.get(id)!;
    const upd: LicenseCode = { ...c, status: 'tersedia', orderId: null, assignedAt: null };
    await db.licenseCodes.put(upd); byId.set(c.id, upd); touched.add(c.productId);
  }
  for (const pid of touched) await syncPool(pid);
  const next: Order = { ...o };
  if (o.status === 'cancelled') delete next.deliveryText;
  else if (isLunas(o.status)) {
    const text = buildOrderDelivery(o, prods, [...byId.values()], force);
    if (text) next.deliveryText = text; else delete next.deliveryText;
  }
  return next;
}

// ---------- stock ----------
/** Apply a stock delta to a physical product (variant aware). Returns null when nothing is tracked. */
function applyStock(p: Product, variantId: string | null, delta: number): { product: Product; before: number; after: number } | null {
  if (p.variants?.length) {
    const v = p.variants.find((x) => x.id === variantId);
    if (!v || v.stock == null) return null;
    const variants = p.variants.map((x) => (x.id === v.id ? { ...x, stock: (x.stock ?? 0) + delta } : x));
    const stock = variants.some((x) => x.stock == null) ? null : variants.reduce((s, x) => s + (x.stock ?? 0), 0);
    return { product: { ...p, variants, stock }, before: v.stock, after: v.stock + delta };
  }
  if (p.stock == null) return null;
  return { product: { ...p, stock: p.stock + delta }, before: p.stock, after: p.stock + delta };
}

/** Order stock effects (idempotent via stockPlanLines) + stock-move records. Must run inside the order transaction. */
export async function applyOrderStock(prev: Order | null, out: Order, now: number): Promise<boolean> {
  const plan = stockPlanLines(prev, out);
  const moves: StockMove[] = [];
  for (const [k, d] of Object.entries(plan.deltas)) {
    const { productId, variantId } = splitKey(k);
    const p = await db.products.get(productId);
    if (!p || typeOf(p) !== 'fisik') continue;
    const r = applyStock(p, variantId, d);
    if (!r) continue;
    await db.products.put({ ...r.product, updatedAt: now });
    moves.push(makeStockMove({
      id: uid(), productId, variantId, ts: now, type: d < 0 ? 'penjualan' : 'retur', delta: d, before: r.before,
      reason: d < 0 ? `Pesanan ${out.number}` : `Pembatalan/ubah pesanan ${out.number}`, orderId: out.id,
    }));
  }
  if (moves.length) await db.stockMoves.bulkPut(moves);
  return plan.applied;
}

export async function adjustStock(id: string, variantId: string | null | undefined, delta?: number, set?: number | null, reason?: string, moveType?: StockMove['type']): Promise<Product> {
  return db.transaction('rw', db.products, db.stockMoves, async () => {
    const p = await db.products.get(id);
    if (!p) throw new Error('Produk tidak ditemukan');
    if (typeOf(p) === 'digital' && isCodeProduct(p)) throw new Error('Stok produk kode mengikuti jumlah kode tersedia');
    if (typeOf(p) !== 'fisik') throw new Error('Produk ini tidak memakai stok');
    const hasV = !!p.variants?.length;
    if (hasV && !variantId) throw new Error('Pilih varian yang disesuaikan');
    const v = hasV ? p.variants!.find((x) => x.id === variantId) : undefined;
    if (hasV && !v) throw new Error('Varian tidak ditemukan');
    const current = hasV ? v!.stock : p.stock;
    const plan = planStockAdjust(current, { delta, set, type: moveType, reason: reason?.trim() ? reason : 'Penyesuaian manual' });
    if (!plan.ok) throw new Error(plan.error);
    let out: Product;
    if (hasV) {
      const variants = p.variants!.map((x) => (x.id === v!.id ? { ...x, stock: plan.after } : x));
      out = { ...p, variants, stock: variants.some((x) => x.stock == null) ? null : variants.reduce((s, x) => s + (x.stock ?? 0), 0) };
    } else out = { ...p, stock: plan.after };
    out.updatedAt = Date.now();
    await db.products.put(out);
    await db.stockMoves.put(makeStockMove({ id: uid(), productId: id, variantId: variantId ?? null, ts: out.updatedAt, type: plan.type, delta: plan.delta, before: current, reason: reason?.trim() ? reason : 'Penyesuaian manual' }));
    return out;
  });
}

async function listMoves(productId: string | undefined, limit = 200): Promise<StockMove[]> {
  const n = Math.min(1000, Math.max(1, int(limit, 200)));
  if (productId) return (await db.stockMoves.where('productId').equals(productId).toArray()).sort((a, b) => b.ts - a.ts).slice(0, n);
  return db.stockMoves.orderBy('ts').reverse().limit(n).toArray();
}

// ---------- bulk ----------
async function bulk(ids: string[], action: 'aktif' | 'nonaktif' | 'arsip' | 'kategori' | 'hapus', category?: string) {
  if (!Array.isArray(ids) || !ids.length) return { count: 0 };
  const list = ids.map(String);
  return db.transaction('rw', db.products, db.categories, db.licenseCodes, db.stockMoves, async () => {
    const now = Date.now();
    if (action === 'hapus') {
      await db.products.bulkDelete(list);
      await db.licenseCodes.where('productId').anyOf(list).filter((c) => c.status !== 'terpakai').delete();
      await db.stockMoves.where('productId').anyOf(list).delete();
      return { count: list.length };
    }
    let cat = '';
    if (action === 'kategori') { cat = str(category).trim().slice(0, 80); if (cat) await ensureCategory(cat); }
    const rows = (await db.products.bulkGet(list)).filter((p): p is Product => !!p);
    await db.products.bulkPut(rows.map((p) => {
      const n: Product = { ...p, updatedAt: now };
      if (action === 'aktif') { n.active = true; n.archived = false; }
      else if (action === 'nonaktif') n.active = false;
      else if (action === 'arsip') { n.archived = true; n.active = false; }
      else n.category = cat;
      return n;
    }));
    return { count: rows.length };
  });
}

export async function handleProductsMsg(m: PosMsg): Promise<unknown> {
  switch (m.kind) {
    case 'pos:stock:adjust': return adjustStock(m.id, m.variantId, m.delta, m.set, m.reason, m.moveType);
    case 'pos:stock:moves': return listMoves(m.productId, m.limit);
    case 'pos:category:list': return listCategories();
    case 'pos:category:upsert': return upsertCategory(m.id, m.name);
    case 'pos:category:delete': return deleteCategory(m.id);
    case 'pos:license:import': return importLicenses(m.productId, m.text);
    case 'pos:license:list': return (await db.licenseCodes.where('productId').equals(m.productId).toArray()).slice(0, 20000);
    case 'pos:license:mark': return markLicenses(m.ids, m.status);
    case 'pos:product:bulk': return bulk(m.ids, m.action, m.category);
    case 'pos:order:deliver': {
      return db.transaction('rw', db.orders, db.products, db.licenseCodes, async () => {
        const o = await db.orders.get(m.id);
        if (!o) throw new Error('Order tidak ditemukan');
        if (!isLunas(o.status)) throw new Error('Pesanan belum lunas');
        const next = await reconcileLicenses(o, Date.now(), true);
        await db.orders.put(next);
        return next;
      });
    }
    default: throw new Error('Pesan tidak dikenal');
  }
}
