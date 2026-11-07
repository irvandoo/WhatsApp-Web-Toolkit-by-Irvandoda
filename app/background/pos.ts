import { db } from '../shared/db';
import { cleanPrefix, crmStageFor, finalizeOrder, nextInvoice } from '../shared/pos-logic';
import { generateSku, typeOf, validateProduct } from '../shared/pos-products-logic';
import {
  DEFAULT_SETTINGS, ORDER_STATUSES, PAY_METHODS,
  type Order, type OrderInput, type PosMsg, type PosSettings, type Product,
} from '../shared/pos-types';
import { handleCrm } from './crm';
import { addCodes, applyOrderStock, ensureCategory, finalizeProduct, handleProductsMsg, reconcileLicenses, syncPool } from './pos-products';

export const isPosMsg = (m: unknown): m is PosMsg =>
  !!m && typeof (m as { kind?: unknown }).kind === 'string' && (m as { kind: string }).kind.startsWith('pos:');

const uid = () => crypto.randomUUID();
const int = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const MAX_PHOTO = 200_000; // chars of data URL (~150KB binary)
const WA_URL = 'https://web.whatsapp.com/*';

async function getSettings(): Promise<PosSettings> {
  const s = await db.posSettings.get('main');
  return { ...DEFAULT_SETTINGS, ...s, id: 'main', counters: { ...(s?.counters ?? {}) } };
}

// ---------- products ----------
function cleanProduct(p: Partial<Product> & { name: string }, prev: Product | undefined, sku: string, now: number): Product {
  const has = <K extends keyof Product>(k: K) => k in p && p[k] !== undefined;
  const photo = has('photo') ? p.photo : prev?.photo ?? null;
  return finalizeProduct({
    id: prev?.id ?? p.id ?? uid(),
    sku,
    name: p.name.trim().slice(0, 200),
    category: has('category') ? str(p.category).trim().slice(0, 80) : prev?.category ?? '',
    price: has('price') ? Math.max(0, int(p.price)) : prev?.price ?? 0,
    cost: has('cost') ? (p.cost == null ? null : Math.max(0, int(p.cost))) : prev?.cost ?? null,
    stock: has('stock') ? (p.stock == null ? null : int(p.stock)) : prev?.stock ?? null,
    unit: has('unit') ? str(p.unit).trim().slice(0, 20) || 'pcs' : prev?.unit ?? 'pcs',
    active: has('active') ? !!p.active : prev?.active ?? true,
    note: has('note') ? str(p.note).slice(0, 1000) : prev?.note ?? '',
    photo: typeof photo === 'string' && photo.startsWith('data:image/') && photo.length <= MAX_PHOTO ? photo : null,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  }, p, prev);
}

async function upsertProduct(p: Partial<Product> & { name: string }): Promise<Product> {
  if (!str(p.name).trim()) throw new Error('Nama produk wajib diisi');
  return db.transaction('rw', db.products, db.categories, db.licenseCodes, async () => {
    const all = await db.products.toArray();
    const prev = p.id ? all.find((x) => x.id === p.id) : undefined;
    const want = str(p.sku).trim();
    const type = p.type ?? typeOf(prev);
    const sku = want || prev?.sku || generateSku(all.map((x) => x.sku), type);
    if (all.some((x) => x.sku.toLowerCase() === sku.toLowerCase() && x.id !== prev?.id)) throw new Error(`SKU "${sku}" sudah dipakai`);
    const out = cleanProduct(p, prev, sku, Date.now());
    const errs = validateProduct(out);
    if (errs.length) throw new Error(errs[0]);
    await db.products.put(out);
    await ensureCategory(out.category);
    if (out.type === 'digital' && out.deliveryMode === 'kode') return { ...out, stock: await syncPool(out.id) };
    return out;
  });
}

async function importProducts(rows: Array<Partial<Product> & { name: string; codes?: string[] }>) {
  return db.transaction('rw', db.products, db.categories, db.licenseCodes, async () => {
    const all = await db.products.toArray();
    const bySku = new Map(all.map((x) => [x.sku.toLowerCase(), x]));
    const skus = all.map((x) => x.sku);
    let created = 0, updated = 0, skipped = 0;
    const errors: string[] = [];
    const now = Date.now();
    for (const [i, r] of rows.entries()) {
      if (!str(r.name).trim()) { skipped++; continue; }
      const want = str(r.sku).trim();
      const prev = want ? bySku.get(want.toLowerCase()) : undefined;
      const sku = want || generateSku(skus, r.type ?? typeOf(prev));
      const out = cleanProduct({ ...r, id: undefined }, prev, sku, now);
      const errs = validateProduct(out);
      if (errs.length) { skipped++; errors.push(`Baris ${i + 1}: ${errs[0]}`); continue; }
      await db.products.put(out);
      await ensureCategory(out.category);
      if (out.type === 'digital' && out.deliveryMode === 'kode') {
        if (Array.isArray(r.codes) && r.codes.length) await addCodes(out.id, r.codes.join('\n'));
        await syncPool(out.id);
      }
      if (!prev) { skus.push(sku); bySku.set(sku.toLowerCase(), out); created++; } else { bySku.set(sku.toLowerCase(), out); updated++; }
    }
    return { created, updated, skipped, errors };
  });
}

// ---------- orders ----------
function baseOrder(now: number): Omit<Order, 'id' | 'number'> {
  return {
    contactKey: '', customerName: '', customerPhone: '', items: [], discountType: 'rp', discountValue: 0, shipping: 0, taxPct: 0, notes: '',
    method: 'cash', status: 'unpaid', payments: [], subtotal: 0, discountTotal: 0, tax: 0, total: 0, paid: 0, remaining: 0,
    stockApplied: false, crmSynced: false, createdAt: now, updatedAt: now,
  };
}

function sanitizePatch(p: Partial<Order>): Partial<Order> {
  const o: Partial<Order> = {};
  if (p.contactKey !== undefined) o.contactKey = str(p.contactKey);
  if (p.customerName !== undefined) o.customerName = str(p.customerName).slice(0, 200);
  if (p.customerPhone !== undefined) o.customerPhone = str(p.customerPhone).slice(0, 40);
  if (Array.isArray(p.items)) {
    o.items = p.items.map((i) => ({
      productId: i.productId ? String(i.productId) : null, sku: str(i.sku), name: str(i.name).slice(0, 200) || 'Item',
      qty: typeof i.qty === 'number' && i.qty > 0 ? i.qty : 1, price: Math.max(0, int(i.price)),
      cost: i.cost == null ? null : Math.max(0, int(i.cost)), discount: Math.max(0, int(i.discount)),
      ...(i.variantId ? { variantId: String(i.variantId), variantName: str(i.variantName).slice(0, 100) } : {}),
    }));
  }
  if (p.discountType === 'pct' || p.discountType === 'rp') o.discountType = p.discountType;
  if (p.discountValue !== undefined) o.discountValue = Math.max(0, Number(p.discountValue) || 0);
  if (p.shipping !== undefined) o.shipping = Math.max(0, int(p.shipping));
  if (p.taxPct !== undefined) o.taxPct = Math.min(100, Math.max(0, Number(p.taxPct) || 0));
  if (p.notes !== undefined) o.notes = str(p.notes).slice(0, 2000);
  if (p.method && PAY_METHODS.includes(p.method)) o.method = p.method;
  if (p.status && ORDER_STATUSES.includes(p.status)) o.status = p.status;
  if (Array.isArray(p.payments)) {
    o.payments = p.payments.filter((x) => PAY_METHODS.includes(x.method) && Number.isFinite(x.amount))
      .map((x) => ({ id: str(x.id) || uid(), at: int(x.at, Date.now()), amount: int(x.amount), method: x.method }));
  }
  if (typeof p.createdAt === 'number' && p.createdAt > 0) o.createdAt = Math.round(p.createdAt);
  return o;
}

/** Create (prevId undefined) or update. Stock + numbering + totals in one transaction; CRM link afterwards. */
async function saveOrder(prevId: string | undefined, patch: Partial<Order>): Promise<Order> {
  const now = Date.now();
  const saved = await db.transaction('rw', db.orders, db.products, db.posSettings, db.stockMoves, db.licenseCodes, async () => {
    const prev = prevId ? await db.orders.get(prevId) : undefined;
    if (prevId && !prev) throw new Error('Order tidak ditemukan');
    let id = prev?.id, number = prev?.number;
    if (!prev) {
      const s = await getSettings();
      const n = nextInvoice(s, now);
      await db.posSettings.put({ ...s, counters: n.counters });
      id = uid(); number = n.number;
    }
    const merged = { ...(prev ?? baseOrder(now)), ...sanitizePatch(patch), id: id!, number: number! } as Order;
    if (!merged.items.length) throw new Error('Order belum punya item');
    let out = finalizeOrder(merged, now, uid);
    out.stockApplied = await applyOrderStock(prev ?? null, out, now);
    out = await reconcileLicenses(out, now); // digital codes + deliveryText (Lunas) / release (Batal)
    await db.orders.put(out);
    return out;
  });
  return syncCrm(saved);
}

/** Push CRM stage/value for orders linked to a contact. Value is added once (crmSynced) and removed on cancel. */
async function syncCrm(o: Order): Promise<Order> {
  if (!o.contactKey) return o;
  const stage = crmStageFor(o.status);
  const want = stage != null;
  try {
    const c = await db.contacts.get(o.contactKey);
    if (!c) return o;
    if (want && !o.crmSynced) {
      const rank = (s: string) => ['Deal', 'Selesai'].indexOf(s);
      const keep = rank(c.stage) > rank(stage!);
      await handleCrm({ kind: 'crm:contact:upsert', contact: { accountId: c.accountId, chatId: c.chatId, value: c.value + o.total, ...(keep ? {} : { stage: stage! }) } });
    } else if (want && o.crmSynced && stage === 'Selesai' && c.stage !== 'Selesai') {
      await handleCrm({ kind: 'crm:contact:upsert', contact: { accountId: c.accountId, chatId: c.chatId, stage } });
    } else if (!want && o.crmSynced) {
      await handleCrm({ kind: 'crm:contact:upsert', contact: { accountId: c.accountId, chatId: c.chatId, value: Math.max(0, c.value - o.total) } });
    } else return o;
    const next = { ...o, crmSynced: want };
    await db.orders.put(next);
    return next;
  } catch {
    return o;
  }
}

async function deleteOrder(id: string) {
  const prev = await db.orders.get(id);
  if (!prev) return { ok: true };
  await saveOrder(id, { status: 'cancelled' }).catch(() => undefined); // restores stock + CRM value
  await db.orders.delete(id);
  return { ok: true };
}

async function setSettings(patch: Partial<PosSettings>): Promise<PosSettings> {
  return db.transaction('rw', db.posSettings, async () => {
    const s = await getSettings();
    const n: PosSettings = { ...s };
    for (const k of ['storeName', 'address', 'phone', 'bankText', 'qrisText', 'footer', 'template'] as const) if (typeof patch[k] === 'string') n[k] = patch[k]!.slice(0, 4000);
    if (typeof patch.prefix === 'string') n.prefix = cleanPrefix(patch.prefix);
    if (patch.taxPct !== undefined) n.taxPct = Math.min(100, Math.max(0, Number(patch.taxPct) || 0));
    if (patch.paper === 'a4' || patch.paper === '80mm') n.paper = patch.paper;
    await db.posSettings.put(n);
    return n;
  });
}

// ---------- relay to WhatsApp tab ----------
async function relayDraft(text: string, senderTabId: number | undefined) {
  if (typeof text !== 'string' || !text.trim() || text.length > 20_000) throw new Error('Teks tidak valid');
  let tabId = senderTabId;
  if (tabId == null) {
    const tabs = await chrome.tabs.query({ url: WA_URL });
    const t = tabs.find((x) => x.active && x.highlighted) ?? tabs.find((x) => x.active) ?? tabs[0];
    tabId = t?.id;
  }
  if (tabId == null) throw new Error('Tab WhatsApp Web tidak ditemukan');
  const r = (await chrome.tabs.sendMessage(tabId, { kind: 'pos:insert', text }, { frameId: 0 })) as { ok?: boolean; error?: string } | undefined;
  if (!r?.ok) throw new Error(r?.error || 'Kotak pesan chat tidak ditemukan. Buka chat tujuan dulu.');
  return { ok: true };
}

export async function handlePos(m: PosMsg, sender?: chrome.runtime.MessageSender): Promise<unknown> {
  switch (m.kind) {
    case 'pos:product:upsert': return upsertProduct(m.product);
    case 'pos:product:list': return db.products.toArray();
    case 'pos:product:delete': await handleProductsMsg({ kind: 'pos:product:bulk', ids: [m.id], action: 'hapus' }); return { ok: true };
    case 'pos:product:import': return importProducts(m.rows);
    case 'pos:order:create': return saveOrder(undefined, m.order as OrderInput);
    case 'pos:order:update': return saveOrder(m.id, m.patch);
    case 'pos:order:list': {
      const rows = m.from != null || m.to != null
        ? await db.orders.where('createdAt').between(m.from ?? 0, m.to ?? Infinity, true, false).toArray()
        : await db.orders.toArray();
      return rows.sort((a, b) => b.createdAt - a.createdAt);
    }
    case 'pos:order:delete': return deleteOrder(m.id);
    case 'pos:order:payment': {
      const o = await db.orders.get(m.id);
      if (!o) throw new Error('Order tidak ditemukan');
      if (!(m.amount > 0) || !PAY_METHODS.includes(m.method)) throw new Error('Pembayaran tidak valid');
      return saveOrder(m.id, { payments: [...o.payments, { id: uid(), at: Date.now(), amount: Math.round(m.amount), method: m.method }] });
    }
    case 'pos:settings:get': return getSettings();
    case 'pos:settings:set': return setSettings(m.patch);
    case 'pos:draft': return relayDraft(m.text, sender?.tab?.id);
    default: return handleProductsMsg(m);
  }
}
