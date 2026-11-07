/** POS contracts. All money = integer Rupiah. */
export type PayMethod = 'cash' | 'transfer' | 'qris' | 'cod' | 'credit';
export type OrderStatus = 'draft' | 'unpaid' | 'paid' | 'shipped' | 'done' | 'cancelled';
export type DiscountType = 'pct' | 'rp';

export const PAY_METHODS: PayMethod[] = ['cash', 'transfer', 'qris', 'cod', 'credit'];
export const PAY_LABEL: Record<PayMethod, string> = { cash: 'Tunai', transfer: 'Transfer', qris: 'QRIS', cod: 'COD', credit: 'Hutang' };
export const ORDER_STATUSES: OrderStatus[] = ['draft', 'unpaid', 'paid', 'shipped', 'done', 'cancelled'];
export const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Draft', unpaid: 'Belum bayar', paid: 'Lunas', shipped: 'Dikirim', done: 'Selesai', cancelled: 'Batal',
};

export type ProductType = 'fisik' | 'digital' | 'jasa';
export type DeliveryMode = 'link' | 'kode' | 'file-url' | 'akses';
export interface TierPrice { minQty: number; price: number }
export interface OptionGroup { name: string; values: string[] }
export interface Variant { id: string; name: string; sku: string; price?: number | null; cost?: number | null; stock: number | null }
export interface Category { id: string; name: string }
export type StockMoveType = 'masuk' | 'keluar' | 'penyesuaian' | 'penjualan' | 'retur';
export interface StockMove {
  id: string; productId: string; variantId: string | null; ts: number; type: StockMoveType;
  delta: number; before: number | null; after: number | null; reason: string; orderId?: string;
}
export type LicenseStatus = 'tersedia' | 'terpakai' | 'rusak';
export interface LicenseCode { id: string; productId: string; code: string; status: LicenseStatus; orderId: string | null; assignedAt: number | null }

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  cost: number | null;        // harga modal
  stock: number | null;       // null = unlimited
  unit: string;
  active: boolean;
  note: string;
  photo: string | null;       // downsized data URL (<=150KB)
  createdAt: number;
  updatedAt: number;
  // ---- product management (all optional; legacy rows = fisik) ----
  type?: ProductType;
  description?: string;
  tags?: string[];
  photos?: string[];          // max 5, each <=150KB; photos[0] mirrors `photo`
  archived?: boolean;
  taxPct?: number | null;     // per-product tax override (null = use order tax)
  minStock?: number;          // low-stock threshold (default 5)
  weight?: number | null;     // gram
  dims?: { l: number; w: number; h: number } | null; // cm
  barcode?: string;
  shelf?: string;
  tiers?: TierPrice[];        // wholesale tiers
  optionGroups?: OptionGroup[];
  variants?: Variant[];
  deliveryMode?: DeliveryMode;
  downloadUrl?: string;
  accessUrl?: string;
  instructions?: string;      // supports {nama} {invoice} {kode} {produk} {link} {berlaku}
  validityDays?: number | null;
  autoDeliver?: boolean;
  duration?: string;          // jasa
}

export interface OrderItem {
  productId: string | null;   // null = free item
  sku: string;
  name: string;
  qty: number;
  price: number;
  cost: number | null;
  discount: number;           // Rp, per line total
  variantId?: string | null;
  variantName?: string;
}

export interface Payment { id: string; at: number; amount: number; method: PayMethod }

export interface Order {
  id: string;
  number: string;
  contactKey: string;         // CRM contact key or ''
  customerName: string;
  customerPhone: string;
  items: OrderItem[];
  discountType: DiscountType;
  discountValue: number;      // % (may be fractional) or Rp
  shipping: number;
  taxPct: number;
  notes: string;
  method: PayMethod;
  status: OrderStatus;
  payments: Payment[];
  // derived, stored for querying/reporting
  subtotal: number;
  discountTotal: number;      // order-level discount in Rp
  tax: number;
  total: number;
  paid: number;
  remaining: number;
  stockApplied: boolean;
  crmSynced: boolean;
  deliveryText?: string;      // digital delivery message (set when Lunas)
  createdAt: number;
  updatedAt: number;
}

export interface PosSettings {
  id: 'main';
  storeName: string;
  address: string;
  phone: string;
  bankText: string;           // rekening
  qrisText: string;
  footer: string;
  prefix: string;
  taxPct: number;
  template: string;           // '' = default
  paper: 'a4' | '80mm';
  counters: Record<string, number>; // 'YYYYMM' -> last seq
}

export type OrderInput = Partial<Omit<Order, 'id' | 'number'>> & { items: OrderItem[] };

export type PosMsg =
  | { kind: 'pos:product:upsert'; product: Partial<Product> & { name: string } }
  | { kind: 'pos:product:list' }
  | { kind: 'pos:product:delete'; id: string }
  | { kind: 'pos:product:import'; rows: Array<Partial<Product> & { name: string }> }
  | { kind: 'pos:stock:adjust'; id: string; variantId?: string | null; delta?: number; set?: number | null; reason?: string; moveType?: StockMoveType }
  | { kind: 'pos:stock:moves'; productId?: string; limit?: number }
  | { kind: 'pos:category:list' }
  | { kind: 'pos:category:upsert'; id?: string; name: string }
  | { kind: 'pos:category:delete'; id: string }
  | { kind: 'pos:license:import'; productId: string; text: string }
  | { kind: 'pos:license:list'; productId: string }
  | { kind: 'pos:license:mark'; ids: string[]; status: 'tersedia' | 'rusak' | 'hapus' }
  | { kind: 'pos:product:bulk'; ids: string[]; action: 'aktif' | 'nonaktif' | 'arsip' | 'kategori' | 'hapus'; category?: string }
  | { kind: 'pos:order:deliver'; id: string }
  | { kind: 'pos:order:create'; order: OrderInput }
  | { kind: 'pos:order:update'; id: string; patch: Partial<Order> }
  | { kind: 'pos:order:list'; from?: number; to?: number }
  | { kind: 'pos:order:delete'; id: string }
  | { kind: 'pos:order:payment'; id: string; amount: number; method: PayMethod }
  | { kind: 'pos:settings:get' }
  | { kind: 'pos:settings:set'; patch: Partial<PosSettings> }
  | { kind: 'pos:draft'; text: string };

export const DEFAULT_SETTINGS: PosSettings = {
  id: 'main', storeName: 'Toko Saya', address: '', phone: '', bankText: '', qrisText: '',
  footer: 'Terima kasih atas pesanan Anda.', prefix: 'INV', taxPct: 0, template: '', paper: 'a4', counters: {},
};
