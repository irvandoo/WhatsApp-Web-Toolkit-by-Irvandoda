import { useId } from 'react';
import type { FunnelStep, ResponseDist } from '../shared/stats-logic';
import { fmtNum } from './util';

const finite = (n: number) => (Number.isFinite(n) ? n : 0);

/** Inline sparkline; flat line when there is no variation, nothing when there is no data. */
export function Spark({ values, color, label }: { values: number[]; color: string; label?: string }) {
  const v = values.map(finite);
  if (v.length < 2 || v.every((x) => x === 0)) return <svg className="spark" aria-hidden="true" />;
  const W = 72, H = 26, p = 2;
  const max = Math.max(...v), min = Math.min(...v), span = max - min || 1;
  const pts = v.map((y, i): [number, number] => [p + ((W - 2 * p) * i) / (v.length - 1), H - p - ((H - 2 * p) * (y - min)) / span]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const area = `${d}L${pts[pts.length - 1][0].toFixed(1)},${H}L${pts[0][0].toFixed(1)},${H}Z`;
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path className="area" d={area} fill={color} />
      <path className="line" d={d} stroke={color} />
      <circle cx={last[0]} cy={last[1]} r={2.2} fill={color} />
    </svg>
  );
}

export interface Slice { label: string; value: number; color: string }

/** Donut with centre label; slices also carry a text legend with value and percent (not colour alone). */
export function Donut({ slices, center, sub, aria }: { slices: Slice[]; center: string; sub?: string; aria: string }) {
  const total = slices.reduce((a, s) => a + Math.max(0, finite(s.value)), 0);
  const R = 46, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 120 120" role="img" aria-label={aria}>
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--card-2)" strokeWidth={14} />
        {total > 0 && slices.map((s) => {
          const len = (Math.max(0, finite(s.value)) / total) * C;
          const el = len > 0 ? <circle key={s.label} cx="60" cy="60" r={R} fill="none" stroke={s.color} strokeWidth={14} strokeDasharray={`${Math.max(0, len - 1.5)} ${C - Math.max(0, len - 1.5)}`} strokeDashoffset={-off} transform="rotate(-90 60 60)" /> : null;
          off += len;
          return el;
        })}
        <text x="60" y={sub ? 60 : 65} textAnchor="middle" className="big">{center}</text>
        {sub && <text x="60" y="76" textAnchor="middle" style={{ fontSize: 9, fill: 'var(--muted)' }}>{sub}</text>}
      </svg>
      <div className="legend">
        {slices.map((s, i) => (
          <span key={s.label}><i className={`sw${i % 2 ? ' dot' : ''}`} style={{ background: s.color }} />{s.label}: <b style={{ color: 'var(--fg)' }}>{fmtNum(s.value)}</b>{total > 0 ? ` (${Math.round((s.value / total) * 100)}%)` : ''}</span>
        ))}
      </div>
    </div>
  );
}

/** Response-time histogram. Count labels sit above every bar so values never rely on colour or height alone. */
export function Histogram({ dist }: { dist: ResponseDist }) {
  const W = 360, H = 170, L = 8, R = 8, T = 22, B = 26;
  const n = dist.buckets.length;
  const max = Math.max(1, ...dist.buckets.map((b) => b.count));
  const bw = (W - L - R) / n;
  return (
    <div className="chart hist">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Distribusi waktu balasan pertama: ${dist.buckets.map((b) => `${b.label} ${b.count}`).join(', ')}`}>
        <line className="grid" x1={L} x2={W - R} y1={H - B} y2={H - B} />
        {dist.buckets.map((b, i) => {
          const h = (b.count / max) * (H - T - B);
          const x = L + bw * i + bw * 0.14, w = bw * 0.72;
          return (
            <g key={b.label}>
              <rect x={x} y={H - B - h} width={w} height={Math.max(b.count ? 2 : 0, h)} rx={5} fill="var(--c-fu)" opacity={b.count ? 1 : 0.3} />
              <text x={x + w / 2} y={H - B - h - 5} textAnchor="middle" style={{ fill: 'var(--fg)', fontSize: 11, fontWeight: 600 }}>{b.count}</text>
              <text x={x + w / 2} y={H - 9} textAnchor="middle">{b.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const colors = ['var(--c-new)', 'var(--c-fu)', 'var(--c-in)', 'var(--c-out)'];
  return (
    <div className="funnel" role="list" aria-label="Funnel konversi lead">
      {steps.map((s, i) => (
        <div className="row" role="listitem" key={s.label}>
          <span>{s.label}</span>
          <div className="track" aria-hidden="true"><div className="fill" style={{ width: `${s.pctOfFirst ?? 0}%`, background: colors[i % colors.length] }} /></div>
          <span className="n">{fmtNum(s.count)}{s.pctOfFirst != null && <span className="muted"> · {s.pctOfFirst}%</span>}</span>
        </div>
      ))}
    </div>
  );
}

/** Small multiple: one tiny area/line chart with title and total. */
export function SmallMultiple({ title, values, color, total }: { title: string; values: number[]; color: string; total: number }) {
  const gid = useId();
  const v = values.map(finite);
  const W = 120, H = 44, p = 3;
  const max = Math.max(1, ...v);
  const pts = v.map((y, i): [number, number] => [v.length < 2 ? W / 2 : p + ((W - 2 * p) * i) / (v.length - 1), H - p - ((H - 2 * p) * y) / max]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  return (
    <div className="cell">
      <div className="t"><span>{title}</span><b>{fmtNum(total)}</b></div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${title}: total ${total}`}>
        <line x1={0} x2={W} y1={H - p} y2={H - p} stroke="var(--bd)" strokeWidth={1} />
        {pts.length > 1 && <path d={`${d}L${pts[pts.length - 1][0]},${H - p}L${pts[0][0]},${H - p}Z`} fill={color} opacity={0.14} id={gid} />}
        {pts.length > 1 && <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}
