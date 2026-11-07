import { useMemo, useState } from 'react';
import type { Interaction, LeadKind, UnansweredRow } from '../shared/analytics-types';
import type { Contact, CrmMsg } from '../shared/crm-types';
import { buildUnanswered, formatDuration } from '../shared/analytics-logic';
import { exportLeadIntelCsv, INTENT_LABEL, INTEL_NOTE, MOMENTUM_GLYPH, MOMENTUM_LABEL, TEMP_LABEL, type LeadIntel, type Momentum, type Temperature } from '../shared/lead-intel-logic';
import { ScrollTable } from '../shared/ui/ScrollTable';
import { downloadCsv, fmtDateTime, KIND_LABEL, PRIO_LABEL, stamp } from './util';

type Prio = UnansweredRow['priority'];
type SortKey = 'name' | 'phone' | 'accountId' | 'kind' | 'waitingMs' | 'since' | 'priority' | 'stage' | 'temp' | 'eng' | 'momentum';
const PRIOS: Prio[] = ['urgent', 'high', 'normal', 'low'];
const PRANK: Record<Prio, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const H = 3600e3;
const TRANK: Record<Temperature, number> = { hot: 0, warm: 1, cold: 2, dormant: 3 };
const TEMPS: Temperature[] = ['hot', 'warm', 'cold', 'dormant'];
const MOMS: Momentum[] = ['rising', 'steady', 'slipping', 'stalled'];
const MIN_PRESETS: [string, number][] = [['Semua', 0], ['> 1 jam', H], ['> 6 jam', 6 * H], ['> 24 jam', 24 * H], ['> 3 hari', 72 * H], ['> 7 hari', 168 * H]];

interface Props {
  interactions: Interaction[]; contacts: Contact[]; accountNames: Map<string, string>;
  accountId: string; includeGroups: boolean; now: number; intel: Map<string, LeadIntel>; toast: (m: string) => void;
}

export function Unanswered({ interactions, contacts, accountNames, accountId, includeGroups, now, intel, toast }: Props) {
  const [prios, setPrios] = useState<Set<Prio>>(new Set());
  const [kind, setKind] = useState<'' | LeadKind>('');
  const [minMs, setMinMs] = useState(0);
  const [stage, setStage] = useState('');
  const [tag, setTag] = useState('');
  const [q, setQ] = useState('');
  const [temp, setTemp] = useState<'' | Temperature>('');
  const [mom, setMom] = useState<'' | Momentum>('');
  const [minEng, setMinEng] = useState(0);
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'waitingMs', dir: -1 });

  const cmap = useMemo(() => new Map(contacts.map((c) => [c.key, c])), [contacts]);
  const rows = useMemo(() => buildUnanswered(interactions, now, { accountId: accountId || undefined, includeGroups }).map((r) => {
    const c = cmap.get(r.key);
    return c ? { ...r, stage: c.stage, tags: c.tags, optOut: c.optOut } : r;
  }), [interactions, now, accountId, includeGroups, cmap]);

  const counts = useMemo(() => {
    const c: Record<Prio, number> = { urgent: 0, high: 0, normal: 0, low: 0 };
    for (const r of rows) c[r.priority]++;
    return c;
  }, [rows]);
  const stages = useMemo(() => [...new Set(rows.map((r) => r.stage).filter((x): x is string => !!x))].sort(), [rows]);
  const tags = useMemo(() => [...new Set(rows.flatMap((r) => r.tags ?? []))].sort(), [rows]);

  const view = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = rows.filter((r) =>
      (!prios.size || prios.has(r.priority)) && (!kind || r.kind === kind) && r.waitingMs >= minMs &&
      (!stage || r.stage === stage) &&
      (!temp || intel.get(r.key)?.temperature === temp) && (!mom || intel.get(r.key)?.momentum === mom) && (intel.get(r.key)?.engagement ?? 0) >= minEng && (!tag || r.tags?.includes(tag)) &&
      (!s || r.name.toLowerCase().includes(s) || r.phone.includes(s)));
    const val = (r: UnansweredRow): string | number => {
      switch (sort.k) {
        case 'name': return r.name.toLowerCase();
        case 'phone': return r.phone;
        case 'accountId': return (accountNames.get(r.accountId) ?? r.accountId).toLowerCase();
        case 'kind': return r.kind;
        case 'waitingMs': return r.waitingMs;
        case 'since': return r.waitingSinceTs;
        case 'priority': return PRANK[r.priority];
        case 'temp': return TRANK[intel.get(r.key)?.temperature ?? 'dormant'];
        case 'eng': return intel.get(r.key)?.engagement ?? 0;
        case 'momentum': return MOMS.indexOf(intel.get(r.key)?.momentum ?? 'steady');
        case 'stage': return (r.stage ?? '').toLowerCase();
      }
    };
    return list.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'id');
      return (c || b.waitingMs - a.waitingMs) * (c ? sort.dir : 1);
    });
  }, [rows, prios, kind, minMs, stage, tag, q, sort, accountNames, intel, temp, mom, minEng]);

  const toggleP = (p: Prio) => setPrios((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const th = (k: SortKey, label: string, cls = '') => (
    <th scope="col" className={cls} aria-sort={sort.k === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => setSort((s) => s.k === k ? { k, dir: (-s.dir) as 1 | -1 } : { k, dir: k === 'waitingMs' || k === 'since' || k === 'eng' ? -1 : 1 })}>
        {label}{sort.k === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );

  async function remind(r: UnansweredRow) {
    const msg: CrmMsg = { kind: 'crm:reminder:add', contactKey: r.key, text: `Balas chat ${r.name || r.phone}`, dueAt: Date.now() + H };
    try { await chrome.runtime.sendMessage(msg); toast('Pengingat dibuat (1 jam lagi).'); } catch { toast('Gagal membuat pengingat.'); }
  }

  if (!rows.length) return <div className="card empty">Tidak ada chat yang menunggu balasan. Buka WhatsApp Web; pelacakan berjalan otomatis.</div>;

  return (
    <div className="fillcol">
      <div className="counts" role="group" aria-label="Ringkasan prioritas">
        {PRIOS.map((p) => <div key={p} className="card"><b className={`w-${p}`}>{counts[p]}</b><span className="muted">{PRIO_LABEL[p]}</span></div>)}
        <div className="card"><b>{rows.length}</b><span className="muted">Total</span></div>
      </div>
      <div className="filters">
        <span role="group" aria-label="Filter prioritas" className="seg">
          {PRIOS.map((p) => <button key={p} className={`chip ${prios.has(p) ? 'on' : ''}`} aria-pressed={prios.has(p)} onClick={() => toggleP(p)}>{PRIO_LABEL[p]}</button>)}
        </span>
        <select aria-label="Jenis" value={kind} onChange={(e) => setKind(e.target.value as '' | LeadKind)}>
          <option value="">Semua jenis</option><option value="new">WA Baru</option><option value="followup">Follow-up</option>
        </select>
        <select aria-label="Minimal menunggu" value={minMs} onChange={(e) => setMinMs(Number(e.target.value))}>
          {MIN_PRESETS.map(([l, v]) => <option key={v} value={v}>{v ? `Menunggu ${l}` : 'Semua durasi'}</option>)}
        </select>
        <select aria-label="Tahap CRM" value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">Semua tahap</option>{stages.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Semua tag</option>{tags.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select aria-label="Temperature" value={temp} onChange={(e) => setTemp(e.target.value as '' | Temperature)}>
          <option value="">Semua temperature</option>{TEMPS.map((t) => <option key={t} value={t}>{TEMP_LABEL[t]}</option>)}
        </select>
        <select aria-label="Momentum" value={mom} onChange={(e) => setMom(e.target.value as '' | Momentum)}>
          <option value="">Semua momentum</option>{MOMS.map((t) => <option key={t} value={t}>{MOMENTUM_LABEL[t]}</option>)}
        </select>
        <select aria-label="Engagement minimal" value={minEng} onChange={(e) => setMinEng(Number(e.target.value))}>
          {[0, 30, 50, 70].map((v) => <option key={v} value={v}>{v ? `Engagement >= ${v}` : 'Semua engagement'}</option>)}
        </select>
        <button onClick={() => downloadCsv(`belum-dibalas-intel-${stamp()}.csv`, exportLeadIntelCsv(view.map((r) => intel.get(r.key)).filter((x): x is LeadIntel => !!x)))}>Ekspor CSV (+intel)</button>
        <input type="search" aria-label="Cari" placeholder="Cari nama / nomor" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="muted" aria-live="polite" style={{ marginBottom: 6 }}>{view.length} dari {rows.length} chat</div>
      <ScrollTable stickyFirst label="Tabel chat belum dibalas">
        <table>
          <thead><tr>
            {th('name', 'Nama')}{th('phone', 'Nomor')}{th('accountId', 'Akun')}{th('kind', 'Jenis')}{th('waitingMs', 'Menunggu')}{th('since', 'Sejak')}{th('priority', 'Prioritas')}{th('temp', 'Temperature')}{th('eng', 'Engagement')}{th('momentum', 'Momentum')}<th scope="col" title="Intent hanya terbaca saat chat dibuka di WhatsApp Web (isi pesan tidak disimpan)">Intent</th>{th('stage', 'Tahap CRM & tag')}
            <th scope="col"><span className="sr">Aksi</span></th>
          </tr></thead>
          <tbody>
            {view.map((r) => (
              <tr key={r.key}>
                <td>{r.name || '-'}{r.optOut && <span className="badge b-urgent" style={{ marginLeft: 6 }} title="Tidak boleh dihubungi (opt-out)">Opt-out</span>}</td>
                <td>{r.phone || '-'}</td>
                <td>{accountNames.get(r.accountId) ?? r.accountId}</td>
                <td><span className={`badge b-${r.kind}`}>{KIND_LABEL[r.kind]}</span></td>
                <td className={`w-${r.priority}`}>{formatDuration(r.waitingMs)}</td>
                <td>{fmtDateTime(r.waitingSinceTs)}</td>
                <td><span className={`badge b-${r.priority}`}>{PRIO_LABEL[r.priority]}</span></td>
                <IntelCells l={intel.get(r.key)} />
                <td>{r.stage ?? <span className="muted">-</span>}{r.tags?.map((t) => <span key={t} className="badge" style={{ marginLeft: 4, fontWeight: 400 }}>{t}</span>)}</td>
                <td><button onClick={() => void remind(r)}>Buat pengingat</button></td>
              </tr>
            ))}
            {!view.length && <tr><td colSpan={13} className="empty">Tidak ada yang cocok dengan filter.</td></tr>}
          </tbody>
        </table>
      </ScrollTable>
      <p className="muted" style={{ fontSize: 12 }}>{INTEL_NOTE}</p>
    </div>
  );
}

export function IntelCells({ l }: { l?: LeadIntel }) {
  if (!l) return <><td>-</td><td>-</td><td>-</td><td>-</td></>;
  return (
    <>
      <td><span className={`badge t-${l.temperature}`}>{TEMP_LABEL[l.temperature]}</span></td>
      <td className="num" title={l.reason}>{l.engagement}</td>
      <td title={MOMENTUM_LABEL[l.momentum]}>{MOMENTUM_GLYPH[l.momentum]} {MOMENTUM_LABEL[l.momentum]}</td>
      <td>{l.intent ? INTENT_LABEL[l.intent] : <span className="muted" title="Tidak ada teks pesan tersimpan">-</span>}</td>
    </>
  );
}
