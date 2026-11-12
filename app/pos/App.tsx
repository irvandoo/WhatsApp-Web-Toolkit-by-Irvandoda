import { useState } from 'react';
import { usePersistentState } from '../shared/ui/persist';
import { oneOf, useViewReset } from '../shared/ui/viewState';
import type { Contact } from '../shared/crm-types';
import { db } from '../shared/db';
import { DEFAULT_SETTINGS, type Order, type PosSettings, type Product } from '../shared/pos-types';
import { Products } from './products/Products';
import { Cashier } from './Cashier';
import { Orders } from './Orders';
import { Report } from './Report';
import { Settings } from './Settings';
import { useLive } from './util';

type Tab = 'kasir' | 'pesanan' | 'katalog' | 'laporan' | 'pengaturan';
const TABS: [Tab, string][] = [['kasir', 'Kasir'], ['pesanan', 'Pesanan'], ['katalog', 'Produk'], ['laporan', 'Laporan'], ['pengaturan', 'Pengaturan']];
const isTab = oneOf<Tab>(TABS.map((t) => t[0]));
// view settings only: the cashier / product drafts (pos.cashier.draft, pos.product.draft) are kept
const VIEW_KEYS = ['pos.tab', 'pos.orders.', 'pos.report.', 'pos.products.'];

export function App() {
  const [tab, setTab, tabReady] = usePersistentState<Tab>('pos.tab', 'kasir', isTab);
  const [editing, setEditing] = useState<Order | null>(null);
  const [selId, setSelId] = usePersistentState<string>('pos.orders.selected', '');
  const selected = selId || null;
  const setSelected = (id: string | null) => setSelId(id ?? '');
  const [off, resetView] = useViewReset(VIEW_KEYS, () => { setTab('kasir'); setSelId(''); });
  const [cashKey, setCashKey] = useState(0);
  const products = useLive(() => db.products.toArray(), [] as Product[]);
  const orders = useLive(async () => (await db.orders.toArray()).sort((a, b) => b.createdAt - a.createdAt), [] as Order[]);
  const contacts = useLive(() => db.contacts.toArray(), [] as Contact[]);
  const settingsLive = useLive(async () => (await db.posSettings.get('main')) ?? DEFAULT_SETTINGS, null as PosSettings | null);
  const settings: PosSettings = settingsLive ?? DEFAULT_SETTINGS;

  const resetCash = () => { setEditing(null); setCashKey((k) => k + 1); };
  return (
    <div className="wrap">
      <h1 className="noprint">Kasir (POS) - WhatsApp Web Toolkit by Irvandoda <button className="sm" onClick={() => void resetView()} title="Kembalikan filter, tab, dan pilihan tampilan ke bawaan">Atur ulang tampilan</button></h1>
      <nav className="noprint">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
      <div className="main">
      {tabReady && !off && <>
      {settingsLive && tab === 'kasir' && (
        <Cashier key={(editing?.id ?? 'new') + cashKey} products={products} contacts={contacts} settings={settings} editing={editing}
          onSaved={(o) => { resetCash(); setSelected(o.id); setTab('pesanan'); }} onCancel={resetCash} />
      )}
      {tab === 'pesanan' && <Orders orders={orders} settings={settings} selectedId={selected} onSelect={setSelected} onEdit={(o) => { setEditing(o); setTab('kasir'); }} />}
      {tab === 'katalog' && <Products products={products} />}
      {tab === 'laporan' && <Report orders={orders} />}
      {settingsLive && tab === 'pengaturan' && <Settings settings={settings} />}
      </>}
      </div>
    </div>
  );
}
