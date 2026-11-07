import { useEffect, useMemo, useState } from 'react';
import type { DateRange, MsgEvent, RangeKey } from '../shared/analytics-types';
import { buildUnanswered, formatDuration, resolveRange, summarize } from '../shared/analytics-logic';
import { db } from '../shared/db';
import { BarChart, Heatmap } from './Charts';
import { eventsIn, useContacts, useEarliest, useInteractions, useLive } from './data';
import { HotLeads } from './HotLeads';
import { Report } from './Report';
import { ExportDialog } from './ExportDialog';
import { hotLeads } from '../shared/lead-intel-logic';
import { useLeadIntel } from '../shared/lead-intel-live';
import { Unanswered } from './Unanswered';
import { computeStats } from '../shared/stats-logic';
import { StatHighlights, StatsView } from './Stats';
import { Icon, SectionTitle } from './Icons';
import { Spark } from './Viz';
import { fmtNum } from './util';
import { clearPersisted, usePersistentState } from '../shared/ui/persist';

const RANGES: [RangeKey, string][] = [['today', 'Hari ini'], ['week', 'Minggu'], ['month', 'Bulan'], ['year', 'Tahun'], ['all', 'Semua'], ['custom', 'Custom']];
type Tab = 'ringkasan' | 'statistik' | 'belum' | 'hot' | 'laporan';
const HASH_TAB: Record<string, Tab> = { ringkasan: 'ringkasan', statistik: 'statistik', stats: 'statistik', unanswered: 'belum', belum: 'belum', hot: 'hot', laporan: 'laporan' };
const hashTab = (): Tab | undefined => HASH_TAB[location.hash.replace(/^#/, '')];
const tabFromHash = (): Tab => hashTab() ?? 'ringkasan';
const isTab = (v: unknown): v is Tab => v === 'ringkasan' || v === 'statistik' || v === 'belum' || v === 'hot' || v === 'laporan';
const isRange = (v: unknown): v is RangeKey => RANGES.some(([k]) => k === v);
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const NO_EVENTS: MsgEvent[] = [];
const dateVal = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const startOf = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

function Delta({ cur, prev, invert }: { cur: number; prev: number | null; invert?: boolean }) {
  if (prev == null) return null;
  if (prev === 0) return <span className="delta flat">{cur === 0 ? '0%' : 'baru'}</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const good = invert ? pct < 0 : pct > 0;
  const cls = pct === 0 ? 'flat' : good ? 'up' : 'down';
  return <span className={`delta ${cls}`} title="dibanding periode lalu"><Icon name={pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'} />{Math.abs(pct)}%<span className="sr"> vs periode lalu</span></span>;
}

export function App() {
  const [tab, setTab, rTab] = usePersistentState<Tab>('analytics.tab', tabFromHash(), isTab);
  const [key, setKey, rKey] = usePersistentState<RangeKey>('analytics.range', 'month', isRange);
  const [cFrom, setCFrom, rFrom] = usePersistentState('analytics.custom.from', dateVal(Date.now() - 7 * 86400e3), isDate);
  const [cTo, setCTo, rTo] = usePersistentState('analytics.custom.to', dateVal(Date.now()), isDate);
  const [acc, setAcc, rAcc] = usePersistentState('analytics.account', '');
  const [groups, setGroups, rGroups] = usePersistentState('analytics.groups', false);
  const ready = rTab && rKey && rFrom && rTo && rAcc && rGroups;
  const [resetN, setResetN] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [msg, setMsg] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => { if (rTab) { const h = hashTab(); if (h) setTab(h); } }, [rTab, setTab]);
  const resetView = () => {
    setTab(hashTab() ?? 'ringkasan'); setKey('month'); setCFrom(dateVal(Date.now() - 7 * 86400e3)); setCTo(dateVal(Date.now())); setAcc(''); setGroups(false); setResetN((n) => n + 1);
    void clearPersisted('analytics.'); void clearPersisted('unanswered.');
    setMsg('Tampilan diatur ulang');
  };
  useEffect(() => { const f = () => setTab(tabFromHash()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 3000); return () => clearTimeout(t); }, [msg]);

  const accounts = useLive(() => db.accounts.toArray(), []);
  const interactions = useInteractions();
  const contacts = useContacts();
  const earliest = useEarliest();
  const intel = useLeadIntel(interactions, contacts, now);
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

  const hotScoped = useMemo(() => {
    const groupKeys = new Set(interactions.filter((i) => i.isGroup).map((i) => i.key));
    return hotLeads([...intel.values()].filter((l) => (!acc || l.accountId === acc) && (groups || !groupKeys.has(l.key))));
  }, [intel, interactions, acc, groups]);

  const stats = useMemo(() => computeStats({ events, interactions, summary, prev, accountId: acc || undefined, includeGroups: groups, accountNames }),
    [events, interactions, summary, prev, acc, groups, accountNames]);

  const hasData = interactions.length > 0 || events.length > 0;
  const series = (f: (d: (typeof summary.days)[number]) => number) => summary.days.map(f);
  const kpis: { l: string; v: string; cur: number; prev: number | null; invert?: boolean; icon: string; tone: string; spark?: number[]; color?: string }[] = [
    { l: 'WA Baru', v: fmtNum(summary.newLeads), cur: summary.newLeads, prev: prev?.newLeads ?? null, icon: 'userPlus', tone: 'c-new', spark: series((d) => d.newLeads), color: 'var(--c-new)' },
    { l: 'Follow-up', v: fmtNum(summary.followUps), cur: summary.followUps, prev: prev?.followUps ?? null, icon: 'repeat', tone: 'c-fu', spark: series((d) => d.followUps), color: 'var(--c-fu)' },
    { l: 'Pesan masuk', v: fmtNum(summary.inbound), cur: summary.inbound, prev: prev?.inbound ?? null, icon: 'inbox', tone: 'c-in', spark: series((d) => d.inbound), color: 'var(--c-in)' },
    { l: 'Pesan keluar', v: fmtNum(summary.outbound), cur: summary.outbound, prev: prev?.outbound ?? null, icon: 'send', tone: 'c-out', spark: series((d) => d.outbound), color: 'var(--c-out)' },
    { l: 'Chat aktif', v: fmtNum(summary.activeChats), cur: summary.activeChats, prev: prev?.activeChats ?? null, icon: 'chat', tone: '', spark: series((d) => d.inbound + d.outbound), color: 'var(--accent)' },
    { l: 'Belum dibalas', v: fmtNum(unanswered.length), cur: unanswered.length, prev: null, icon: 'alert', tone: '' },
    { l: 'Rata-rata respon pertama', v: summary.avgFirstResponseMs == null ? '-' : formatDuration(summary.avgFirstResponseMs), cur: summary.avgFirstResponseMs ?? 0,
      prev: summary.avgFirstResponseMs != null && prev?.avgFirstResponseMs != null ? prev.avgFirstResponseMs : null, invert: true, icon: 'clock', tone: '' },
  ];

  const fill = tab === 'belum' && hasData;
  if (!ready) return <div className="page" />;
  return (
    <div className="page">
      <div className="head">
        <span className="logo"><Icon name="logo" /></span>
        <h1>Analitik<small>WhatsApp Web Toolkit by Irvandoda</small></h1>
        <span className="sp" />
        <button className="linkbtn" onClick={resetView} title="Kembalikan rentang, filter, dan tab ke pengaturan awal">Atur ulang tampilan</button>
      </div>
      <div className="bar">
        <div className="seg" role="group" aria-label="Rentang waktu">
          {RANGES.map(([k, l]) => <button key={k} className={key === k ? 'on' : ''} aria-pressed={key === k} onClick={() => setKey(k)}>{l}</button>)}
        </div>
        {key === 'custom' && (
          <span className="seg dates">
            <input type="date" aria-label="Dari tanggal" value={cFrom} max={cTo} onChange={(e) => setCFrom(e.target.value)} />
            <input type="date" aria-label="Sampai tanggal" value={cTo} min={cFrom} onChange={(e) => setCTo(e.target.value)} />
          </span>
        )}
        <span className="sp" />
        <select aria-label="Akun" value={acc} onChange={(e) => setAcc(e.target.value)}>
          <option value="">Semua akun</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
        </select>
        <label className="chk"><input type="checkbox" checked={groups} onChange={(e) => setGroups(e.target.checked)} />Termasuk grup</label>
        <button className="primary" onClick={() => setExporting(true)} aria-haspopup="dialog">Ekspor laporan</button>
      </div>

      <div className="tabs" role="tablist" aria-label="Bagian analitik">
        {([['ringkasan', 'Ringkasan'], ['statistik', 'Statistik'], ['belum', `Belum Dibalas (${unanswered.length})`], ['hot', 'Lead Panas'], ['laporan', 'Laporan']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      <div className={`pane${fill ? ' fill' : ''}`}>
      {!hasData && tab !== 'laporan' && (
        <div className="card empty"><b>Belum ada data.</b><br />Buka WhatsApp Web; pelacakan berjalan otomatis.</div>
      )}

      {tab === 'ringkasan' && hasData && (
        <div role="tabpanel">
          <div className="kpis">
            {kpis.map((k) => (
              <div key={k.l} className="card kpi">
                <div className="top"><span className={`chipic ${k.tone}`}><Icon name={k.icon} /></span><span className="l">{k.l}</span></div>
                <div className="v">{k.v}</div>
                <div className="foot"><Delta cur={k.cur} prev={k.prev} invert={k.invert} />{k.spark && <Spark values={k.spark} color={k.color ?? 'var(--accent)'} label={`Tren harian ${k.l}`} />}</div>
              </div>
            ))}
          </div>
          <StatHighlights stats={stats} onMore={() => setTab('statistik')} />
          <div className="grid2">
            <section className="card">
              <SectionTitle icon="bars">Tren lead dan pesan</SectionTitle>
              <BarChart days={summary.days} range={range} />
            </section>
            <section className="card">
              <SectionTitle icon="grid">Aktivitas masuk (jam x hari)</SectionTitle>
              <Heatmap events={events} includeGroups={groups} />
            </section>
          </div>
          {range.key === 'all' && events.length > 50000 && <p className="muted">Menampilkan semua data ({fmtNum(events.length)} peristiwa); pilih rentang lebih sempit agar lebih ringan.</p>}
        </div>
      )}

      {tab === 'statistik' && hasData && (
        <div role="tabpanel"><StatsView stats={stats} summary={summary} /></div>
      )}

      {tab === 'belum' && hasData && (
        <div role="tabpanel">
          <Unanswered interactions={interactions} contacts={contacts} accountNames={accountNames} accountId={acc} includeGroups={groups} now={now} intel={intel} toast={setMsg} resetSignal={resetN} />
        </div>
      )}

      {tab === 'hot' && hasData && (
        <div role="tabpanel">
          <HotLeads intel={intel} interactions={interactions} accountId={acc} includeGroups={groups} accountNames={accountNames} toast={setMsg} />
        </div>
      )}

      {tab === 'laporan' && (
        <div role="tabpanel"><Report summary={summary} unanswered={unanswered} interactions={scoped} toast={setMsg} /></div>
      )}

      </div>

      {exporting && (
        <ExportDialog stats={stats} summary={summary} prev={prev} unanswered={unanswered} hot={hotScoped} interactions={scoped} events={events} includeGroups={groups}
          accountNames={accountNames} accountId={acc} now={now} onClose={() => setExporting(false)} onOther={() => { setExporting(false); setTab('laporan'); }} />
      )}
      {msg && <div className="toast" role="status">{msg}</div>}
    </div>
  );
}
