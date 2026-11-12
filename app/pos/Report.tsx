import { useMemo } from 'react';
import { usePersistentState } from '../shared/ui/persist';
import { oneOf } from '../shared/ui/viewState';
import { resolveRange } from '../shared/analytics-logic';
import type { RangeKey } from '../shared/analytics-types';
import { buildReport, fmtIdr, reportToCsv } from '../shared/pos-logic';
import { PAY_LABEL, type Order } from '../shared/pos-types';
import { ScrollTable } from '../shared/ui/ScrollTable';
import { download, toLocalInput } from './util';

const TABS: [RangeKey, string][] = [['today', 'Hari ini'], ['week', 'Minggu'], ['month', 'Bulan'], ['year', 'Tahun'], ['all', 'Semua'], ['custom', 'Custom']];
const parseDay = (s: string, endOfDay: boolean) => {
  const [y, m, d] = s.split('-').map(Number);
  return y ? new Date(y, m - 1, d + (endOfDay ? 1 : 0)).getTime() : NaN;
};

const isRange = oneOf<RangeKey>(TABS.map((t) => t[0]));

export function Report({ orders }: { orders: Order[] }) {
  const [key, setKey] = usePersistentState<RangeKey>('pos.report.range', 'month', isRange);
  const [from, setFrom] = usePersistentState('pos.report.from', toLocalInput(Date.now() - 6 * 86400e3));
  const [to, setTo] = usePersistentState('pos.report.to', toLocalInput(Date.now()));
  const range = useMemo(() => {
    if (key !== 'custom') return resolveRange(key, Date.now());
    const f = parseDay(from, false), t = parseDay(to, true);
    return resolveRange('custom', Date.now(), { from: Number.isNaN(f) ? 0 : f, to: Number.isNaN(t) ? Date.now() + 1 : t });
  }, [key, from, to]);
  const r = useMemo(() => buildReport(orders, range, 5), [orders, range]);
  const label = TABS.find((t) => t[0] === key)![1] + (key === 'custom' ? ` ${from} s/d ${to}` : '');
  const maxPay = Math.max(1, ...r.byMethod.map((m) => m.amount));

  return (
    <div>
      <nav>
        {TABS.map(([k, l]) => <button key={k} className={key === k ? 'on' : ''} onClick={() => setKey(k)}>{l}</button>)}
        {key === 'custom' && <>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /> <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </>}
        <span className="sp" />
        <button onClick={() => download('laporan-penjualan.csv', reportToCsv(r, label))}>Ekspor CSV</button>
      </nav>
      <div className="kpis">
        <Kpi l="Omzet" v={fmtIdr(r.revenue)} />
        <Kpi l="Jumlah order" v={String(r.orderCount)} />
        <Kpi l="Rata-rata order" v={fmtIdr(r.avgOrder)} />
        <Kpi l="Laba kotor" v={r.grossProfit == null ? '-' : fmtIdr(r.grossProfit)} />
        <Kpi l="Piutang" v={fmtIdr(r.receivable)} warn={r.receivable > 0} />
      </div>

      <h3>Omzet per {r.granularity === 'day' ? 'hari' : r.granularity === 'week' ? 'minggu' : 'bulan'}</h3>
      <BarChart pts={r.series} />

      <div className="cols">
        <div>
          <h3>Produk teratas</h3>
          <ScrollTable maxHeight="max(240px, 56vh)" label="Produk teratas"><table><thead><tr><th>Produk</th><th className="num">Qty</th><th className="num">Omzet</th></tr></thead>
            <tbody>{r.topProducts.map((p) => <tr key={p.key}><td className="wrap">{p.name}</td><td className="num">{p.qty}</td><td className="num">{fmtIdr(p.revenue)}</td></tr>)}
              {!r.topProducts.length && <tr><td colSpan={3} className="mut">Tidak ada data.</td></tr>}</tbody></table></ScrollTable>
        </div>
        <div>
          <h3>Pelanggan teratas</h3>
          <ScrollTable maxHeight="max(240px, 56vh)" label="Pelanggan teratas"><table><thead><tr><th>Pelanggan</th><th className="num">Order</th><th className="num">Total</th></tr></thead>
            <tbody>{r.topCustomers.map((c) => <tr key={c.key}><td className="wrap">{c.name}</td><td className="num">{c.orders}</td><td className="num">{fmtIdr(c.total)}</td></tr>)}
              {!r.topCustomers.length && <tr><td colSpan={3} className="mut">Tidak ada data.</td></tr>}</tbody></table></ScrollTable>
        </div>
        <div>
          <h3>Metode pembayaran</h3>
          {r.byMethod.map((m) => (
            <div key={m.method} className="hb"><span>{PAY_LABEL[m.method]}</span><i style={{ width: `${(m.amount / maxPay) * 100}%` }} /><b>{fmtIdr(m.amount)}</b></div>
          ))}
          {!r.byMethod.length && <p className="mut">Tidak ada data.</p>}
        </div>
      </div>
    </div>
  );
}

const Kpi = ({ l, v, warn }: { l: string; v: string; warn?: boolean }) => <div className="kpi"><small>{l}</small><b className={warn ? 'neg' : ''}>{v}</b></div>;

function BarChart({ pts }: { pts: { key: string; label: string; value: number; count: number }[] }) {
  if (!pts.length) return <p className="mut">Tidak ada data pada periode ini.</p>;
  const W = 720, H = 200, pl = 8, pb = 22, pt = 14;
  const max = Math.max(1, ...pts.map((p) => p.value));
  const bw = (W - pl * 2) / pts.length;
  const step = Math.ceil(pts.length / 12);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Grafik omzet">
      <line x1={pl} x2={W - pl} y1={H - pb} y2={H - pb} className="ax" />
      {pts.map((p, i) => {
        const h = ((H - pb - pt) * p.value) / max;
        const x = pl + i * bw;
        return (
          <g key={p.key}>
            <rect x={x + bw * 0.12} y={H - pb - h} width={Math.max(1, bw * 0.76)} height={h} rx={2} className="bar-r"><title>{`${p.key}: ${fmtIdr(p.value)} (${p.count} order)`}</title></rect>
            {i % step === 0 && <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="tk">{p.label}</text>}
          </g>
        );
      })}
      <text x={W - pl} y={10} textAnchor="end" className="tk">maks {fmtIdr(max)}</text>
    </svg>
  );
}
