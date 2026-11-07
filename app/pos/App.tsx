import { useState } from 'react';
import type { Contact } from '../shared/crm-types';
import { db } from '../shared/db';
import { DEFAULT_SETTINGS, type Order, type PosSettings, type Product } from '../shared/pos-types';
import { Catalog } from './Catalog';
import { Cashier } from './Cashier';
import { Orders } from './Orders';
import { Report } from './Report';
import { Settings } from './Settings';
import { useLive } from './util';

type Tab = 'kasir' | 'pesanan' | 'katalog' | 'laporan' | 'pengaturan';
const TABS: [Tab, string][] = [['kasir', 'Kasir'], ['pesanan', 'Pesanan'], ['katalog', 'Katalog'], ['laporan', 'Laporan'], ['pengaturan', 'Pengaturan']];

export function App() {
  const [tab, setTab] = useState<Tab>('kasir');
  const [editing, setEditing] = useState<Order | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [cashKey, setCashKey] = useState(0);
  const products = useLive(() => db.products.toArray(), [] as Product[]);
  const orders = useLive(async () => (await db.orders.toArray()).sort((a, b) => b.createdAt - a.createdAt), [] as Order[]);
  const contacts = useLive(() => db.contacts.toArray(), [] as Contact[]);
  const settingsLive = useLive(async () => (await db.posSettings.get('main')) ?? DEFAULT_SETTINGS, null as PosSettings | null);
  const settings: PosSettings = settingsLive ?? DEFAULT_SETTINGS;

  const resetCash = () => { setEditing(null); setCashKey((k) => k + 1); };
  return (
    <div className="wrap">
      <h1 className="noprint">Kasir (POS) - WhatsApp Web Toolkit by Irvandoda</h1>
      <nav className="noprint">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
      <div className="main">
      {settingsLive && tab === 'kasir' && (
        <Cashier key={(editing?.id ?? 'new') + cashKey} products={products} contacts={contacts} settings={settings} editing={editing}
          onSaved={(o) => { resetCash(); setSelected(o.id); setTab('pesanan'); }} onCancel={resetCash} />
      )}
      {tab === 'pesanan' && <Orders orders={orders} settings={settings} selectedId={selected} onSelect={setSelected} onEdit={(o) => { setEditing(o); setTab('kasir'); }} />}
      {tab === 'katalog' && <Catalog products={products} />}
      {tab === 'laporan' && <Report orders={orders} />}
      {settingsLive && tab === 'pengaturan' && <Settings settings={settings} />}
      </div>
    </div>
  );
}
