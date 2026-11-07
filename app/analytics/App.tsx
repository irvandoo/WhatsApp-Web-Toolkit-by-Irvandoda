import { useEffect, useMemo, useState } from 'react';
import type { DateRange, MsgEvent, RangeKey } from '../shared/analytics-types';
import { buildUnanswered, formatDuration, resolveRange, summarize } from '../shared/analytics-logic';
import { db } from '../shared/db';
import { BarChart, Heatmap } from './Charts';
import { eventsIn, useContacts, useEarliest, useInteractions, useLive } from './data';
import { Report } from './Report';
import { Unanswered } from './Unanswered';
import { fmtNum } from './util';

const RANGES: [RangeKey, string][] = [['today', 'Hari ini'], ['week', 'Minggu'], ['month', 'Bulan'], ['year', 'Tahun'], ['all', 'Semua'], ['custom', 'Custom']];
type Tab = 'ringkasan' | 'belum' | 'laporan';
const NO_EVENTS: MsgEvent[] = [];
const dateVal = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const startOf = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

function Delta({ cur, prev, invert }: { cur: number; prev: number | null; invert?: boolean }) {
  if (prev == null) return null;
  if (prev === 0) return <span className="delta flat">{cur === 0 ? '0%' : 'baru'} vs periode lalu</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const good = invert ? pct < 0 : pct > 0;
  const cls = pct === 0 ? 'flat' : good ? 'up' : 'down';
  return <span className={`delta ${cls}`}>{pct > 0 ? '▲' : pct < 0 ? '▼' : '='} {Math.abs(pct)}% vs periode lalu</span>;
}

export function App() {
  const [tab, setTab] = useState<Tab>('ringkasan');
  const [key, setKey] = useState<RangeKey>('month');
  const [cFrom, setCFrom] = useState(() => dateVal(Date.now() - 7 * 86400e3));
  const [cTo, setCTo] = useState(() => dateVal(Date.now()));
  const [acc, setAcc] = useState('');
  const [groups, setGroups] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [msg, setMsg] = useState('');

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 3000); return () => clearTimeout(t); }, [msg]);

  const accounts = useLive(() => db.accounts.toArray(), []);
  const interactions = useInteractions();
  const contacts = useContacts();
  const earliest = useEarliest();
  const accountNames = useMemo(() => new Map(accounts.map((a) => [a.id, a.name || a.id])), [accounts]);

  const day = dateVal(now);
  const range: DateRange = useMemo(() => {
    const custom = key === 'custom' && cFrom && cTo ? { from: startOf(cFrom), to: startOf(cTo) + 86400e3 } : undefined;
    return resolveRange(key, Date.now(), custom, earliest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cFrom, cTo, earliest, day]);
  const prevRange: DateRange | null = useMemo(
    () => (range.key === 'all' ? null : { key: range.key, from: range.from - (range.to - range.from), to: range.from }), [range]);

  const events = useLive(() => eventsIn(range, acc), NO_EVENTS, [range.key, range.from, range.to, acc]);
  const prevEvents = useLive(() => (prevRange ? eventsIn(prevRange, acc) : Promise.resolve(NO_EVENTS)), NO_EVENTS, [prevRange?.from, prevRange?.to, acc]);

  const opts = useMemo(() => ({ accountId: acc || undefined, includeGroups: groups }), [acc, groups]);
  const summary = useMemo(() => summarize(events, interactions, range, opts), [events, interactions, range, opts]);
  const prev = useMemo(() => (prevRange ? summarize(prevEvents, interactions, prevRange, opts) : null), [prevEvents, interactions, prevRange, opts]);
  const unanswered = useMemo(() => buildUnanswered(interactions, now, opts), [interactions, now, opts]);
  const scoped = useMemo(() => interactions.filter((i) => (!acc || i.accountId === acc) && (groups || !i.isGroup)), [interactions, acc, groups]);

  const hasData = interactions.length > 0 || events.length > 0;
  const kpis: { l: string; v: string; cur: number; prev: number | null; invert?: boolean }[] = [
    { l: 'WA Baru', v: fmtNum(summary.newLeads), cur: summary.newLeads, prev: prev?.newLeads ?? null },
    { l: 'Follow-up', v: fmtNum(summary.followUps), cur: summary.followUps, prev: prev?.followUps ?? null },
    { l: 'Pesan masuk', v: fmtNum(summary.inbound), cur: summary.inbound, prev: prev?.inbound ?? null },
    { l: 'Pesan keluar', v: fmtNum(summary.outbound), cur: summary.outbound, prev: prev?.outbound ?? null },
    { l: 'Chat aktif', v: fmtNum(summary.activeChats), cur: summary.activeChats, prev: prev?.activeChats ?? null },
    { l: 'Belum dibalas', v: fmtNum(unanswered.length), cur: unanswered.length, prev: null },
    { l: 'Rata-rata respon pertama', v: summary.avgFirstResponseMs == null ? '-' : formatDuration(summary.avgFirstResponseMs), cur: summary.avgFirstResponseMs ?? 0,
      prev: summary.avgFirstResponseMs != null && prev?.avgFirstResponseMs != null ? prev.avgFirstResponseMs : null, invert: true },
  ];

  return (
    <div className="wrap">
      <h1>Analitik - WhatsApp Web Toolkit by Irvandoda</h1>
      <div className="bar">
        <div className="seg" role="group" aria-label="Rentang waktu">
          {RANGES.map(([k, l]) => <button key={k} className={key === k ? 'on' : ''} aria-pressed={key === k} onClick={() => setKey(k)}>{l}</button>)}
        </div>
        {key === 'custom' && (
          <span className="seg">
            <input type="date" aria-label="Dari tanggal" value={cFrom} max={cTo} onChange={(e) => setCFrom(e.target.value)} />
            <input type="date" aria-label="Sampai tanggal" value={cTo} min={cFrom} onChange={(e) => setCTo(e.target.value)} />
          </span>
        )}
        <select aria-label="Akun" value={acc} onChange={(e) => setAcc(e.target.value)}>
          <option value="">Semua akun</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
        </select>
        <label className="chk"><input type="checkbox" checked={groups} onChange={(e) => setGroups(e.target.checked)} />Termasuk grup</label>
      </div>

      <div className="tabs" role="tablist" aria-label="Bagian analitik">
        {([['ringkasan', 'Ringkasan'], ['belum', `Belum Dibalas (${unanswered.length})`], ['laporan', 'Laporan']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {!hasData && tab !== 'laporan' && (
        <div className="card empty"><b>Belum ada data.</b><br />Buka WhatsApp Web; pelacakan berjalan otomatis.</div>
      )}

      {tab === 'ringkasan' && hasData && (
        <div role="tabpanel">
          <div className="kpis">
            {kpis.map((k) => (
              <div key={k.l} className="card kpi">
                <div className="l">{k.l}</div>
                <div className="v">{k.v}</div>
                <Delta cur={k.cur} prev={k.prev} invert={k.invert} />
              </div>
            ))}
          </div>
          <div className="grid2">
            <section className="card">
              <h2>Tren lead dan pesan masuk</h2>
              <BarChart days={summary.days} range={range} />
            </section>
            <section className="card">
              <h2>Aktivitas masuk (jam x hari)</h2>
              <Heatmap events={events} includeGroups={groups} />
            </section>
          </div>
          {range.key === 'all' && events.length > 50000 && <p className="muted">Menampilkan semua data ({fmtNum(events.length)} peristiwa); pilih rentang lebih sempit agar lebih ringan.</p>}
        </div>
      )}

      {tab === 'belum' && hasData && (
        <div role="tabpanel">
          <Unanswered interactions={interactions} contacts={contacts} accountNames={accountNames} accountId={acc} includeGroups={groups} now={now} toast={setMsg} />
        </div>
      )}

      {tab === 'laporan' && (
        <div role="tabpanel"><Report summary={summary} unanswered={unanswered} interactions={scoped} toast={setMsg} /></div>
      )}

      {msg && <div className="toast" role="status">{msg}</div>}
    </div>
  );
}
