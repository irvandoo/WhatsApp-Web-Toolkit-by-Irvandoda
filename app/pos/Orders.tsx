import { useEffect, useMemo, useState } from 'react';
import { usePersistentState } from '../shared/ui/persist';
import { buildInvoiceText, fmtDateTime, fmtIdr, ordersToCsv } from '../shared/pos-logic';
import { ORDER_STATUSES, PAY_LABEL, PAY_METHODS, STATUS_LABEL, type Order, type OrderStatus, type PayMethod, type PosSettings } from '../shared/pos-types';
import { Invoice } from './Invoice';
import { ScrollTable } from '../shared/ui/ScrollTable';
import { More, useLimit } from './More';
import { download, send } from './util';
import { WaPreview } from './WaPreview';

interface Props { orders: Order[]; settings: PosSettings; selectedId: string | null; onSelect: (id: string | null) => void; onEdit: (o: Order) => void }

interface OrdersFilter { q: string; st: '' | OrderStatus }
const DEF_FILTER: OrdersFilter = { q: '', st: '' };
const isFilter = (v: unknown): v is OrdersFilter => !!v && typeof v === 'object' && typeof (v as OrdersFilter).q === 'string'
  && ((v as OrdersFilter).st === '' || (ORDER_STATUSES as string[]).includes((v as OrdersFilter).st));

export function Orders({ orders, settings, selectedId, onSelect, onEdit }: Props) {
  const [f, setF] = usePersistentState<OrdersFilter>('pos.orders.filters', DEF_FILTER, isFilter);
  const { q, st } = f;
  const setQ = (v: string) => setF((c) => ({ ...c, q: v }));
  const setSt = (v: '' | OrderStatus) => setF((c) => ({ ...c, st: v }));
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return orders.filter((o) => (!st || o.status === st) && (!s || o.number.toLowerCase().includes(s) || o.customerName.toLowerCase().includes(s) || o.customerPhone.includes(s)));
  }, [orders, q, st]);
  const [lim, more] = useLimit(`${q}|${st}`);
  const sel = orders.find((o) => o.id === selectedId) ?? null;

  return (
    <div className="split">
      <div className="fillcol">
        <div className="bar">
          <input placeholder="Cari nomor / pelanggan" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={st} onChange={(e) => setSt(e.target.value as '' | OrderStatus)}>
            <option value="">Semua status</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <button onClick={() => download('pesanan.csv', ordersToCsv(list))}>Ekspor CSV</button>
        </div>
        <ScrollTable stickyFirst label="Daftar pesanan">
        <table>
          <thead><tr><th>Nomor</th><th>Tanggal</th><th>Pelanggan</th><th>Status</th><th className="num">Total</th><th className="num">Sisa</th></tr></thead>
          <tbody>
            {list.slice(0, lim).map((o) => (
              <tr key={o.id} className={'clk' + (o.id === selectedId ? ' sel' : '')} onClick={() => onSelect(o.id)}>
                <td>{o.number}</td><td>{fmtDateTime(o.createdAt)}</td><td>{o.customerName || 'Umum'}</td>
                <td><span className={'st st-' + o.status}>{STATUS_LABEL[o.status]}</span></td>
                <td className="num">{fmtIdr(o.total)}</td><td className={'num' + (o.remaining > 0 && o.status !== 'cancelled' ? ' neg' : '')}>{fmtIdr(o.remaining)}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={6} className="mut">Belum ada pesanan.</td></tr>}
          </tbody>
        </table>
        </ScrollTable>
        {list.length > lim && <More shown={lim} total={list.length} onMore={more} />}
      </div>
      {sel && <Detail key={sel.id} o={sel} settings={settings} onClose={() => onSelect(null)} onEdit={() => onEdit(sel)} />}
    </div>
  );
}

function Detail({ o, settings, onClose, onEdit }: { o: Order; settings: PosSettings; onClose: () => void; onEdit: () => void }) {
  const auto = useMemo(() => buildInvoiceText(o, settings), [o, settings]);
  const [text, setText] = useState(auto);
  const [dirty, setDirty] = useState(false);
  const [amt, setAmt] = useState(0);
  const [m, setM] = useState<PayMethod>(o.method === 'credit' ? 'cash' : o.method);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (!dirty) setText(auto); }, [auto, dirty]);

  const run = async (fn: () => Promise<unknown>, ok = '') => {
    try { await fn(); setMsg(ok); } catch (e) { setMsg(String((e as Error).message)); }
  };
  const setStatus = (s: OrderStatus) => void run(() => send({ kind: 'pos:order:update', id: o.id, patch: { status: s } }));

  return (
    <aside className="panel detail">
      <div className="bar"><h3>{o.number}</h3><span className="sp" /><button onClick={onClose}>Tutup</button></div>
      <div className="bar">
        <label>Status <select value={o.status} onChange={(e) => setStatus(e.target.value as OrderStatus)}>{ORDER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
        <button onClick={onEdit}>Ubah</button>
        <button onClick={() => { if (confirm(`Hapus ${o.number}? Stok akan dikembalikan.`)) void run(async () => { await send({ kind: 'pos:order:delete', id: o.id }); onClose(); }); }}>Hapus</button>
      </div>
      {o.remaining > 0 && o.status !== 'cancelled' && (
        <div className="bar">
          <span>Sisa {fmtIdr(o.remaining)}</span>
          <input className="n w" type="number" min={0} placeholder="Nominal" value={amt || ''} onChange={(e) => setAmt(Number(e.target.value) || 0)} />
          <select value={m} onChange={(e) => setM(e.target.value as PayMethod)}>{PAY_METHODS.filter((x) => x !== 'credit').map((x) => <option key={x} value={x}>{PAY_LABEL[x]}</option>)}</select>
          <button onClick={() => setAmt(o.remaining)}>Pas</button>
          <button className="pri" disabled={!(amt > 0)} onClick={() => void run(async () => { await send({ kind: 'pos:order:payment', id: o.id, amount: amt, method: m }); setAmt(0); }, 'Pembayaran dicatat')}>Catat bayar</button>
        </div>
      )}
      {o.payments.length > 0 && <small className="mut">Pembayaran: {o.payments.map((p) => `${fmtDateTime(p.at)} ${PAY_LABEL[p.method]} ${fmtIdr(p.amount)}`).join(' | ')}</small>}

      <h4>Nota WhatsApp</h4>
      <textarea className="wa" rows={14} value={text} onChange={(e) => { setText(e.target.value); setDirty(true); }} />
      {dirty && <div className="bar"><button onClick={() => { setDirty(false); setText(auto); }}>Reset teks</button></div>}
      <WaPreview text={text} />

      <h4>Cetak</h4>
      <div className="bar">
        <select value={settings.paper} onChange={(e) => void send({ kind: 'pos:settings:set', patch: { paper: e.target.value as 'a4' | '80mm' } })}>
          <option value="a4">A4</option><option value="80mm">Struk 80mm</option>
        </select>
        <button onClick={() => window.print()}>Cetak / PDF</button>
      </div>
      {msg && <p className="note">{msg}</p>}
      <Invoice o={o} s={settings} />
    </aside>
  );
}
