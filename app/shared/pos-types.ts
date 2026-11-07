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
}

export interface OrderItem {
  productId: string | null;   // null = free item
  sku: string;
  name: string;
  qty: number;
  price: number;
  cost: number | null;
  discount: number;           // Rp, per line total
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
  | { kind: 'pos:stock:adjust'; id: string; delta?: number; set?: number | null }
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
