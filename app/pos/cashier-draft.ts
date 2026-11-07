import { ORDER_STATUSES, PAY_METHODS, type DiscountType, type Order, type OrderItem, type OrderStatus, type Payment, type PayMethod } from '../shared/pos-types';

/** Sale in progress (new order). Persisted so a refresh does not lose it. */
export interface CashDraft {
  items: OrderItem[]; contactKey: string; name: string; phone: string; dType: DiscountType; dVal: number; shipping: number;
  taxPct: number | null; notes: string; method: PayMethod; status: OrderStatus; payments: Payment[];
}

export const EMPTY_CASH_DRAFT: CashDraft = {
  items: [], contactKey: '', name: '', phone: '', dType: 'rp', dVal: 0, shipping: 0, taxPct: null, notes: '', method: 'cash', status: 'unpaid', payments: [],
};

export const fromOrder = (e: Order | null): CashDraft => (e ? {
  items: e.items, contactKey: e.contactKey ?? '', name: e.customerName, phone: e.customerPhone, dType: e.discountType, dVal: e.discountValue,
  shipping: e.shipping, taxPct: e.taxPct, notes: e.notes, method: e.method, status: e.status, payments: e.payments,
} : EMPTY_CASH_DRAFT);

export function isCashDraft(v: unknown): v is CashDraft {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return Array.isArray(d.items) && Array.isArray(d.payments)
    && typeof d.contactKey === 'string' && typeof d.name === 'string' && typeof d.phone === 'string' && typeof d.notes === 'string'
    && (d.dType === 'rp' || d.dType === 'pct')
    && typeof d.dVal === 'number' && typeof d.shipping === 'number' && (d.taxPct === null || typeof d.taxPct === 'number')
    && (PAY_METHODS as readonly string[]).includes(d.method as string) && (ORDER_STATUSES as readonly string[]).includes(d.status as string);
}
