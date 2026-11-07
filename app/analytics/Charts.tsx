import { useMemo, useState } from 'react';
import type { DateRange, DayStat, MsgEvent } from '../shared/analytics-types';
import { ScrollTable } from '../shared/ui/ScrollTable';
import { fmtNum } from './util';

const DAY = 86400e3;
interface Bucket { label: string; full: string; newLeads: number; followUps: number; inbound: number; outbound: number }

function parseDate(s: string) { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function buildBuckets(days: DayStat[], range: DateRange): { unit: string; buckets: Bucket[] } {
  const spanDays = Math.max(1, Math.round((range.to - range.from) / DAY));
  const unit = spanDays <= 31 ? 'hari' : spanDays <= 180 ? 'minggu' : 'bulan';
  const map = new Map<string, Bucket>();
  const keyOf = (d: Date): [string, string, string] => {
    if (unit === 'hari') return [ymd(d), `${d.getDate()}`, `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`];
    if (unit === 'minggu') {
      const m = new Date(d); m.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return [ymd(m), `${m.getDate()} ${MON[m.getMonth()]}`, `Minggu ${m.getDate()} ${MON[m.getMonth()]} ${m.getFullYear()}`];
    }
    return [`${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`, `${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, `${MON[d.getMonth()]} ${d.getFullYear()}`];
  };
  const add = (d: Date, s?: DayStat) => {
    const [k, label, full] = keyOf(d);
    let b = map.get(k);
    if (!b) { b = { label, full, newLeads: 0, followUps: 0, inbound: 0, outbound: 0 }; map.set(k, b); }
    if (s) { b.newLeads += s.newLeads; b.followUps += s.followUps; b.inbound += s.inbound; b.outbound += s.outbound; }
  };
  if (unit === 'hari') for (let t = range.from, n = 0; t < range.to && n < 40; t += DAY, n++) add(new Date(t));
  for (const s of days) add(parseDate(s.date), s);
  const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return { unit, buckets: sorted.map(([, b]) => b) };
}

export function BarChart({ days, range }: { days: DayStat[]; range: DateRange }) {
  const { unit, buckets } = useMemo(() => buildBuckets(days, range), [days, range]);
  const [hi, setHi] = useState<number | null>(null);
  const W = 640, H = 240, L = 36, R = 10, T = 10, B = 30;
  const n = Math.max(1, buckets.length);
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.newLeads + b.followUps, b.inbound, b.outbound)));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const bw = (W - L - R) / n;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const every = Math.ceil(n / 12);
  const line = buckets.map((b, i) => `${i ? 'L' : 'M'}${(L + bw * (i + 0.5)).toFixed(1)},${y(b.inbound).toFixed(1)}`).join('');
  const line2 = buckets.map((b, i) => `${i ? 'L' : 'M'}${(L + bw * (i + 0.5)).toFixed(1)},${y(b.outbound).toFixed(1)}`).join('');
  const tip = hi != null ? buckets[hi] : null;
  const total = buckets.reduce((s, b) => s + b.newLeads + b.followUps + b.inbound, 0);
  return (
    <div>
      <div className="legend" aria-hidden="true">
        <span><i className="sw" style={{ background: 'var(--c-new)' }} />WA Baru (batang bawah)</span>
        <span><i className="sw" style={{ background: 'var(--c-fu)' }} />Follow-up (batang atas)</span>
        <span><i className="sw ln" style={{ borderColor: 'var(--c-in)' }} />Pesan masuk (garis, titik)</span>
        <span><i className="sw ln dash" style={{ borderColor: 'var(--c-out)' }} />Pesan keluar (garis putus-putus)</span>
        <span className="muted">per {unit}</span>
      </div>
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Grafik batang per ${unit}: WA Baru dan Follow-up, garis pesan masuk dan keluar`}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}><line className="grid" x1={L} x2={W - R} y1={y(top * f)} y2={y(top * f)} /><text x={L - 4} y={y(top * f) + 3} textAnchor="end">{fmtNum(Math.round(top * f))}</text></g>
          ))}
          {buckets.map((b, i) => {
            const x = L + bw * i, w = Math.max(2, bw * 0.7), bx = x + (bw - w) / 2;
            const hN = y(0) - y(b.newLeads), hF = y(0) - y(b.followUps);
            return (
              <g key={i} className="bk" tabIndex={0} role="img" onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} onFocus={() => setHi(i)} onBlur={() => setHi(null)}
                aria-label={`${b.full}: WA Baru ${b.newLeads}, Follow-up ${b.followUps}, masuk ${b.inbound}, keluar ${b.outbound}`}>
                <rect className="hit" x={x} y={T} width={bw} height={H - T - B} />
                <rect x={bx} y={y(b.newLeads)} width={w} height={hN} fill="var(--c-new)" rx={2} />
                <rect x={bx} y={y(b.newLeads) - hF} width={w} height={hF} fill="var(--c-fu)" rx={2} />
                {i % every === 0 && <text x={x + bw / 2} y={H - 12} textAnchor="middle">{b.label}</text>}
              </g>
            );
          })}
          <path d={line2} fill="none" stroke="var(--c-out)" strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" pointerEvents="none" />
          <path d={line} fill="none" stroke="var(--c-in)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
          {buckets.length <= 40 && buckets.map((b, i) => <circle key={i} cx={L + bw * (i + 0.5)} cy={y(b.inbound)} r={2.5} fill="var(--c-in)" pointerEvents="none" />)}
        </svg>
        {tip && hi != null && (
          <div className="tip" role="status" style={{ left: `${((L + bw * (hi + 0.5)) / W) * 100}%`, top: `${(y(Math.max(tip.newLeads + tip.followUps, tip.inbound, tip.outbound)) / H) * 100}%` }}>
            <b>{tip.full}</b> · Baru {tip.newLeads} · Follow-up {tip.followUps} · Masuk {tip.inbound} · Keluar {tip.outbound}
          </div>
        )}
      </div>
      <details>
        <summary>Lihat sebagai tabel{total === 0 ? ' (belum ada data)' : ''}</summary>
        <ScrollTable maxHeight="max(240px, 56vh)" stickyFirst label="Data grafik"><table>
          <caption className="sr">Data grafik per {unit}</caption>
          <thead><tr><th scope="col">Periode</th><th scope="col" className="num">WA Baru</th><th scope="col" className="num">Follow-up</th><th scope="col" className="num">Pesan masuk</th><th scope="col" className="num">Pesan keluar</th></tr></thead>
          <tbody>{buckets.map((b, i) => <tr key={i}><th scope="row">{b.full}</th><td className="num">{b.newLeads}</td><td className="num">{b.followUps}</td><td className="num">{b.inbound}</td><td className="num">{b.outbound}</td></tr>)}</tbody>
        </table></ScrollTable>
      </details>
    </div>
  );
}

const WD = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
export function Heatmap({ events, includeGroups }: { events: MsgEvent[]; includeGroups: boolean }) {
  const { grid, max } = useMemo(() => {
    const g = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    let m = 0;
    for (const e of events) {
      if (e.dir !== 'in' || (!includeGroups && e.isGroup)) continue;
      const d = new Date(e.ts); const v = ++g[d.getDay()][d.getHours()]; if (v > m) m = v;
    }
    return { grid: g, max: m };
  }, [events, includeGroups]);
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div>
      <div className="hm" role="group" aria-label="Peta panas pesan masuk per jam dan hari">
        <div className="lb" />
        {Array.from({ length: 24 }, (_, h) => <div key={h} className="lb" style={{ justifyContent: 'center' }}>{h % 3 === 0 ? h : ''}</div>)}
        {order.map((d) => [
          <div key={`l${d}`} className="lb">{WD[d]}</div>,
          ...grid[d].map((v, h) => (
            <div key={`${d}-${h}`} className="c" title={`${WD[d]} ${String(h).padStart(2, '0')}:00 - ${v} pesan masuk`} style={{ opacity: v ? 0.15 + 0.85 * (v / max) : 0.06 }} />
          )),
        ])}
      </div>
      <details>
        <summary>Lihat sebagai tabel</summary>
        <ScrollTable maxHeight="max(240px, 56vh)" stickyFirst label="Data peta panas"><table>
          <thead><tr><th scope="col">Hari</th>{Array.from({ length: 24 }, (_, h) => <th key={h} scope="col" className="num">{h}</th>)}</tr></thead>
          <tbody>{order.map((d) => <tr key={d}><th scope="row">{WD[d]}</th>{grid[d].map((v, h) => <td key={h} className="num">{v}</td>)}</tr>)}</tbody>
        </table></ScrollTable>
      </details>
    </div>
  );
}
