import { ScrollTable } from '../shared/ui/ScrollTable';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_STAGES, MANUAL_ACCOUNT, type BulkResult, type Contact, type Reminder } from '../shared/crm-types';
import { applyBulkEdit, filterContacts, funnelCounts, parseTags, rangeKeys, type BulkOp } from '../shared/crm-logic';
import { chunk } from '../shared/crm-import-logic';
import { db } from '../shared/db';
import type { Interaction } from '../shared/analytics-types';
import type { RcpPingResult } from '../shared/messages';
import { FOLLOW_LABEL, INTEL_NOTE, MOMENTUM_GLYPH, MOMENTUM_LABEL, TEMP_LABEL, type LeadIntel } from '../shared/lead-intel-logic';
import { useLeadIntel } from '../shared/lead-intel-live';
import { openChatRoom } from '../analytics/openchat';
import { AddDialog } from './AddDialog';
import { Drawer, srcLabel } from './Drawer';
import { download, idr, isUn, rcp, send, tick, useLive } from './util';

type Tab = 'kanban' | 'daftar' | 'pengingat' | 'pipeline';
type OptF = 'all' | 'yes' | 'no';

export function App() {
  const [tab, setTab] = useState<Tab>('kanban');
  const contacts = useLive(() => db.contacts.toArray(), [] as Contact[]);
  const reminders = useLive(() => db.reminders.toArray(), [] as Reminder[]);
  const stages = useLive(async () => (await db.pipeline.get('default'))?.stages ?? [...DEFAULT_STAGES], [...DEFAULT_STAGES] as string[]);
  const accounts = useLive(() => db.accounts.toArray(), []);
  const interactions = useLive(() => db.interactions.toArray(), [] as Interaction[]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const intel = useLeadIntel(interactions, contacts, now);
  const [hotOnly, setHotOnly] = useState(false);
  const [byEng, setByEng] = useState(false);
  const [acc, setAcc] = useState('');
  const [tag, setTag] = useState('');
  const [q, setQ] = useState('');
  const [stageF, setStageF] = useState('');
  const [assF, setAssF] = useState('');
  const [optF, setOptF] = useState<OptF>('all');
  const [srcF, setSrcF] = useState('');
  const [adding, setAdding] = useState<'' | 'dialog' | 'one'>('');
  const [detail, setDetail] = useState<Contact | null>(null);
  const [msg, setMsg] = useState('');
  const [acct, setAcct] = useState(MANUAL_ACCOUNT);
  useEffect(() => { void rcp<RcpPingResult>({ kind: 'rcp:ping' }).then((r) => { if (r && !isUn(r) && r.accountId) setAcct(r.accountId); }).catch(() => {}); }, []);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 6000); return () => clearTimeout(t); }, [msg]);
  const intByKey = useMemo(() => new Map(interactions.map((i) => [i.key, i])), [interactions]);

  const allTags = useMemo(() => [...new Set(contacts.flatMap((c) => c.tags))].sort(), [contacts]);
  const assignees = useMemo(() => [...new Set(contacts.map((c) => c.assignee).filter(Boolean))].sort(), [contacts]);
  const noStage = useMemo(() => {
    const base = filterContacts(contacts, { q, tag, assignee: assF, optOut: optF, source: srcF, accountId: acc }, stages);
    return hotOnly ? base.filter((c) => intel.get(c.key)?.temperature === 'hot') : base;
  }, [contacts, q, tag, assF, optF, srcF, acc, hotOnly, intel, stages]);
  const filtered = useMemo(() => (stageF ? noStage.filter((c) => (stages.includes(c.stage) ? c.stage : stages[0]) === stageF) : noStage), [noStage, stageF, stages]);
  const funnel = useMemo(() => funnelCounts(noStage, stages), [noStage, stages]);
  const filterOn = !!(q || tag || assF || optF !== 'all' || srcF || acc || hotOnly || stageF);
  const reset = () => { setQ(''); setTag(''); setAssF(''); setOptF('all'); setSrcF(''); setAcc(''); setHotOnly(false); setStageF(''); };
  const openChat = async (c: Contact) => setMsg((await openChatRoom({ accountId: c.accountId === MANUAL_ACCOUNT ? '' : c.accountId, chatId: c.chatId, phone: c.phone })).text);

  const tabs: [Tab, string][] = [['kanban', 'Kanban'], ['daftar', 'Daftar'], ['pengingat', 'Pengingat'], ['pipeline', 'Pipeline']];
  const crmView = tab === 'kanban' || tab === 'daftar';
  return (
    <div className="page">
      <div className="head">
        <h1>CRM - WhatsApp Web Toolkit by Irvandoda</h1>
        <span style={{ flex: 1 }} />
        <button onClick={() => setAdding('one')}>Tambah satu kontak</button>
        <button className="pri big" onClick={() => setAdding('dialog')}>+ Tambah ke CRM</button>
      </div>
      <nav>{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
      {msg && <p role="status" aria-live="polite" className="toast">{msg}</p>}
      {crmView && contacts.length > 0 && <FunnelBar rows={funnel} active={stageF} onPick={(s) => setStageF(stageF === s ? '' : s)} />}
      {crmView && contacts.length > 0 && (
        <div className="bar">
          <input aria-label="Cari" placeholder="Cari nama / telepon / tag / catatan" value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="Filter tahap" value={stageF} onChange={(e) => setStageF(e.target.value)}>
            <option value="">Semua tahap</option>{stages.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select aria-label="Filter akun" value={acc} onChange={(e) => setAcc(e.target.value)}>
            <option value="">Semua akun</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
            <option value={MANUAL_ACCOUNT}>manual</option>
          </select>
          <select aria-label="Filter tag" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">Semua tag</option>{allTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select aria-label="Filter penanggung jawab" value={assF} onChange={(e) => setAssF(e.target.value)}>
            <option value="">Semua PJ</option><option value="__none">Tanpa PJ</option>{assignees.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select aria-label="Filter opt-out" value={optF} onChange={(e) => setOptF(e.target.value as OptF)}>
            <option value="all">Opt-out: semua</option><option value="yes">Opt-out saja</option><option value="no">Tanpa opt-out</option>
          </select>
          <select aria-label="Filter sumber" value={srcF} onChange={(e) => setSrcF(e.target.value)}>
            <option value="">Semua sumber</option>{['chat', 'label', 'manual', 'csv', 'grup', 'bar'].map((s) => <option key={s} value={s}>{srcLabel(s)}</option>)}
          </select>
          <button className={hotOnly ? 'on' : ''} aria-pressed={hotOnly} onClick={() => setHotOnly(!hotOnly)}>Hot leads</button>
          <button className={byEng ? 'on' : ''} aria-pressed={byEng} onClick={() => setByEng(!byEng)}>Urut engagement</button>
          {filterOn && <button onClick={reset}>Reset filter</button>}
          <span className="mut" aria-live="polite">{filtered.length} dari {contacts.length}</span>
        </div>
      )}
      <div className={'pane' + (tab === 'kanban' || tab === 'daftar' || tab === 'pengingat' ? ' fill' : '')}>
      {crmView && contacts.length === 0 ? (
        <div className="empty">
          <h2>Belum ada lead di CRM</h2>
          <p className="mut">Masukkan kontak dari chat WhatsApp, label, daftar manual, atau file CSV ke tahap funnel Anda. Kontak dari chat dan label membutuhkan tab WhatsApp Web yang terbuka.</p>
          <div className="bar" style={{ justifyContent: 'center' }}>
            <button className="pri big" onClick={() => setAdding('dialog')}>+ Tambah ke CRM</button>
            <button onClick={() => setAdding('one')}>Tambah satu kontak</button>
          </div>
        </div>
      ) : <>
        {tab === 'kanban' && <Kanban contacts={filtered} stages={stages} intel={intel} byEng={byEng} onOpen={setDetail} onChat={(c) => void openChat(c)} />}
        {tab === 'daftar' && <List contacts={filtered} stages={stages} intel={intel} assignees={assignees} onOpen={setDetail} onChat={(c) => void openChat(c)} onMsg={setMsg} onImport={() => setAdding('dialog')} />}
      </>}
      {tab === 'pengingat' && <Reminders reminders={reminders} contacts={contacts} />}
      {tab === 'pipeline' && <Pipeline stages={stages} />}
      {crmView && <p className="mut note">{INTEL_NOTE}</p>}
      </div>
      {adding === 'dialog' && <AddDialog stages={stages} contacts={contacts} assignees={assignees} tags={allTags} onClose={() => setAdding('')} />}
      {adding === 'one' && <Drawer contact={null} stages={stages} assignees={assignees} tags={allTags} accountId={acct} onClose={() => setAdding('')} onMsg={setMsg} />}
      {detail && <Drawer key={detail.key} contact={contacts.find((c) => c.key === detail.key) ?? detail} stages={stages} assignees={assignees} tags={allTags} accountId={acct} interaction={intByKey.get(detail.key)} onClose={() => setDetail(null)} onMsg={setMsg} />}
    </div>
  );
}

function FunnelBar({ rows, active, onPick }: { rows: { stage: string; count: number; value: number; pct: number }[]; active: string; onPick: (s: string) => void }) {
  const total = rows.reduce((a, r) => a + r.count, 0);
  const val = rows.reduce((a, r) => a + r.value, 0);
  return (
    <div className="funnel" role="group" aria-label="Ringkasan funnel">
      {rows.map((r, i) => (
        <button key={r.stage} className={'fn' + (active === r.stage ? ' on' : '')} aria-pressed={active === r.stage} onClick={() => onPick(r.stage)}
          title={`${r.stage}: ${r.count} kontak, ${idr(r.value)}. Klik untuk memfilter.`}>
          <span className="fn-bar"><i style={{ width: `${Math.max(r.count ? 6 : 0, r.pct * 100)}%`, opacity: 0.35 + 0.65 * (1 - i / Math.max(1, rows.length)) }} /></span>
          <b>{r.count}</b> <span className="fn-n">{r.stage}</span>
          <small className="mut">{idr(r.value)}</small>
        </button>
      ))}
      <span className="fn-total mut">Total {total} | {idr(val)}</span>
    </div>
  );
}

function IntelBadges({ l }: { l?: LeadIntel }) {
  if (!l) return null;
  return (
    <div className="intel" title={`${l.reason}. Saran: ${l.nextAction}`}>
      <span className={`dot t-${l.temperature}`} />{TEMP_LABEL[l.temperature]} | Skor {l.engagement} | {MOMENTUM_GLYPH[l.momentum]} {MOMENTUM_LABEL[l.momentum]}
      <span className={`pri p-${l.followUpPriority}`}>{FOLLOW_LABEL[l.followUpPriority]}</span>
    </div>
  );
}

function Kanban({ contacts, stages, intel, byEng, onOpen, onChat }: { contacts: Contact[]; stages: string[]; intel: Map<string, LeadIntel>; byEng: boolean; onOpen: (c: Contact) => void; onChat: (c: Contact) => void }) {
  const [over, setOver] = useState('');
  const drop = (stage: string, key: string) => {
    setOver('');
    const c = contacts.find((x) => x.key === key);
    if (c && c.stage !== stage) void send({ kind: 'crm:contact:upsert', contact: { accountId: c.accountId, chatId: c.chatId, stage } });
  };
  return (
    <ScrollTable className="fillcol" maxHeight="none" label="Papan kanban CRM">
    <div className="board">
      {stages.map((st) => {
        const items = contacts.filter((c) => (stages.includes(c.stage) ? c.stage : stages[0]) === st);
        if (byEng) items.sort((a, b) => (intel.get(b.key)?.engagement ?? 0) - (intel.get(a.key)?.engagement ?? 0));
        const total = items.reduce((a, c) => a + (c.value || 0), 0);
        return (
          <div key={st} className={'col' + (over === st ? ' over' : '')}
            onDragOver={(e) => { e.preventDefault(); setOver(st); }}
            onDragLeave={() => setOver('')}
            onDrop={(e) => { e.preventDefault(); drop(st, e.dataTransfer.getData('text/plain')); }}>
            <h3 data-pan>{st} <small>({items.length}) {idr(total)}</small></h3>
            <div className="items">
            {items.map((c) => (
              <div key={c.key} className="card" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', c.key)}>
                <b><button type="button" className="lnk" onClick={() => onOpen(c)}>{c.name || c.phone || c.chatId}</button></b>
                <div className="mut">{c.phone}{c.assignee ? ` - ${c.assignee}` : ''}</div>
                <div>{c.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
                {c.value > 0 && <div>{idr(c.value)}</div>}
                <IntelBadges l={intel.get(c.key)} />
                <div className="bar" style={{ margin: '4px 0 0' }}><button className="sm" onClick={() => onChat(c)}>Buka chat</button><button className="sm" onClick={() => onOpen(c)}>Detail</button></div>
              </div>
            ))}
            </div>
          </div>
        );
      })}
    </div>
    </ScrollTable>
  );
}

type SortKey = 'name' | 'phone' | 'stage' | 'value' | 'updatedAt' | 'eng' | 'temp' | 'prio' | 'assignee';
const TR = { hot: 0, warm: 1, cold: 2, dormant: 3 } as const;
const PR = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
const PAGE = 300;

/** Input that commits on blur / Enter (inline edit). */
function Inline({ value, onCommit, label, type = 'text', w, list }: { value: string; onCommit: (v: string) => void; label: string; type?: string; w?: number; list?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const done = () => { if (v !== value) onCommit(v); };
  return <input className="inl" aria-label={label} type={type} list={list} style={w ? { width: w } : undefined} value={v} onChange={(e) => setV(e.target.value)} onBlur={done}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') setV(value); }} />;
}

const patch = (c: Contact, p: Partial<Contact>) => send({ kind: 'crm:contact:upsert', contact: { accountId: c.accountId, chatId: c.chatId, ...p } });

function List({ contacts, stages, intel, assignees, onOpen, onChat, onMsg, onImport }: {
  contacts: Contact[]; stages: string[]; intel: Map<string, LeadIntel>; assignees: string[];
  onOpen: (c: Contact) => void; onChat: (c: Contact) => void; onMsg: (t: string) => void; onImport: () => void;
}) {
  const [sk, setSk] = useState<SortKey>('updatedAt');
  const [asc, setAsc] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const anchor = useRef('');
  const [shown, setShown] = useState(PAGE);
  const [bStage, setBStage] = useState('');
  const [bTag, setBTag] = useState('');
  const [bAss, setBAss] = useState('');
  const [delOpen, setDelOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState('');
  const rows = useMemo(() => {
    const r = [...contacts].sort((a, b) => {
      if (sk === 'eng' || sk === 'temp' || sk === 'prio') {
        const f = (c: Contact) => { const l = intel.get(c.key); return sk === 'eng' ? l?.engagement ?? 0 : sk === 'temp' ? TR[l?.temperature ?? 'dormant'] : PR[l?.followUpPriority ?? 'low']; };
        return (f(a) - f(b)) * (asc ? 1 : -1);
      }
      const x = a[sk] ?? '', y = b[sk] ?? '';
      return (typeof x === 'number' ? x - (y as number) : String(x).localeCompare(String(y))) * (asc ? 1 : -1);
    });
    return r;
  }, [contacts, sk, asc, intel]);
  const visible = rows.slice(0, shown);
  const chosen = useMemo(() => rows.filter((c) => sel.has(c.key)), [rows, sel]);
  const th = (k: SortKey, l: string) => <th aria-sort={sk === k ? (asc ? 'ascending' : 'descending') : 'none'}><button type="button" className="thbtn" onClick={() => { if (sk === k) setAsc(!asc); else { setSk(k); setAsc(true); } }}>{l}{sk === k ? (asc ? ' ▲' : ' ▼') : ''}</button></th>;

  const click = (key: string, shift: boolean) => {
    setSel((s) => {
      const n = new Set(s);
      if (shift && anchor.current) { const on = !s.has(key); for (const k of rangeKeys(rows.map((r) => r.key), anchor.current, key)) { if (on) n.add(k); else n.delete(k); } }
      else if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
    anchor.current = key;
  };

  const bulk = async (op: BulkOp, okText: string) => {
    const items = chosen.map((c) => ({ c, p: applyBulkEdit(c, op) })).filter((x) => x.p);
    if (!items.length) { onMsg('Tidak ada perubahan.'); return; }
    setWorking(`Memperbarui ${items.length} kontak...`);
    let errors = 0;
    for (const part of chunk(items, 200)) {
      try {
        const r = await send<BulkResult>({ kind: 'crm:contact:bulk-upsert', mode: 'update', items: part.map((x) => ({ accountId: x.c.accountId, chatId: x.c.chatId, ...x.p })) });
        errors += r.errors;
      } catch { errors += part.length; }
      await tick();
    }
    setWorking('');
    onMsg(`${okText}: ${items.length - errors} kontak${errors ? `, ${errors} gagal` : ''}.`);
  };
  const doDelete = async () => {
    const keys = chosen.map((c) => c.key);
    setWorking(`Menghapus ${keys.length} kontak...`);
    for (const part of chunk(keys, 200)) { await send({ kind: 'crm:contact:bulk-delete', keys: part }); await tick(); }
    setWorking(''); setDelOpen(false); setTyped(''); setSel(new Set());
    onMsg(`${keys.length} kontak dihapus.`);
  };
  const delOne = async (c: Contact) => {
    if (!confirm(`Hapus kontak "${c.name || c.phone || c.chatId}" beserta catatan dan pengingatnya?`)) return;
    await send({ kind: 'crm:contact:delete', key: c.key });
    setSel((s) => { const n = new Set(s); n.delete(c.key); return n; });
    onMsg('Kontak dihapus.');
  };
  const exp = async (format: 'json' | 'csv') => {
    const r = await send<{ data: string }>({ kind: 'crm:export', format });
    download(`crm.${format}`, r.data, format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json');
  };
  const allOn = !!visible.length && visible.every((r) => sel.has(r.key));
  return (
    <div className="fillcol">
      <div className="bar">
        <button onClick={onImport}>Impor CSV / sumber lain</button>
        <button onClick={() => void exp('csv')}>Ekspor CSV</button>
        <button onClick={() => void exp('json')}>Ekspor JSON</button>
        <span className="mut" aria-live="polite">{chosen.length ? `${chosen.length} dipilih (Shift+klik untuk rentang)` : 'Pilih baris untuk aksi massal.'}</span>
      </div>
      {chosen.length > 0 && (
        <div className="bar bulk" role="group" aria-label="Aksi massal">
          <select aria-label="Pindah ke tahap" value={bStage} onChange={(e) => setBStage(e.target.value)}><option value="">Pindah tahap...</option>{stages.map((s) => <option key={s}>{s}</option>)}</select>
          <button disabled={!bStage || !!working} onClick={() => void bulk({ type: 'stage', stage: bStage }, 'Dipindah')}>Pindah</button>
          <input aria-label="Tag massal" placeholder="Tag" value={bTag} onChange={(e) => setBTag(e.target.value)} style={{ width: 110 }} />
          <button disabled={!parseTags(bTag).length || !!working} onClick={() => void bulk({ type: 'tag-add', tag: bTag }, 'Tag ditambah')}>+ Tag</button>
          <button disabled={!bTag.trim() || !!working} onClick={() => void bulk({ type: 'tag-remove', tag: bTag }, 'Tag dihapus')}>- Tag</button>
          <input aria-label="Penanggung jawab massal" list="crm-ass-bulk" placeholder="Penanggung jawab" value={bAss} onChange={(e) => setBAss(e.target.value)} style={{ width: 140 }} />
          <datalist id="crm-ass-bulk">{assignees.map((a) => <option key={a} value={a} />)}</datalist>
          <button disabled={!!working} onClick={() => void bulk({ type: 'assignee', assignee: bAss }, 'PJ diatur')}>Set PJ</button>
          <button disabled={!!working} onClick={() => void bulk({ type: 'optout', value: true }, 'Opt-out aktif')}>Opt-out</button>
          <button disabled={!!working} onClick={() => void bulk({ type: 'optout', value: false }, 'Opt-out dicabut')}>Cabut opt-out</button>
          <button className="danger" disabled={!!working} onClick={() => { setDelOpen(true); setTyped(''); }}>Hapus ({chosen.length})</button>
          <button onClick={() => setSel(new Set())}>Batal pilih</button>
          {working && <span role="status" className="mut">{working}</span>}
        </div>
      )}
      {delOpen && chosen.length > 0 && (
        <div className="bar warnbox" role="alertdialog" aria-label="Konfirmasi hapus massal">
          <span>Hapus {chosen.length} kontak beserta catatan dan pengingatnya? Ketik <b>{chosen.length}</b> untuk konfirmasi.</span>
          <input aria-label="Ketik jumlah kontak" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)} style={{ width: 80 }} />
          <button className="danger" disabled={typed.trim() !== String(chosen.length) || !!working} onClick={() => void doDelete()}>Hapus permanen</button>
          <button onClick={() => setDelOpen(false)}>Batal</button>
        </div>
      )}
      <ScrollTable label="Daftar kontak CRM" stickyFirst>
      <table>
        <thead><tr><th><input type="checkbox" aria-label="Pilih semua yang tampil" checked={allOn} onChange={(e) => setSel(e.target.checked ? new Set(visible.map((r) => r.key)) : new Set())} /></th>
          {th('name', 'Nama')}{th('phone', 'Telepon')}{th('stage', 'Tahap')}<th className="wrap">Tag</th>{th('assignee', 'PJ')}{th('value', 'Nilai')}<th>Sumber</th>{th('temp', 'Temperature')}{th('eng', 'Eng.')}{th('prio', 'Follow-up')}{th('updatedAt', 'Diperbarui')}<th>Aksi</th></tr></thead>
        <tbody>
          {visible.map((c) => {
            const l = intel.get(c.key);
            const nm = c.name || c.phone || c.chatId;
            return (
              <tr key={c.key} className={sel.has(c.key) ? 'sel' : ''}>
                <td><input type="checkbox" aria-label={`Pilih ${nm}`} checked={sel.has(c.key)} onChange={() => {}} onClick={(e) => click(c.key, e.shiftKey)} /></td>
                <td><button type="button" className="lnk" onClick={() => onOpen(c)}>{nm}</button>{c.optOut ? <span className="tag optb">opt-out</span> : null}</td>
                <td>{c.phone || '-'}</td>
                <td><select className="inl" aria-label={`Tahap ${nm}`} value={stages.includes(c.stage) ? c.stage : stages[0]} onChange={(e) => void patch(c, { stage: e.target.value })}>{stages.map((s) => <option key={s}>{s}</option>)}</select></td>
                <td className="wrap"><Inline label={`Tag ${nm}`} value={c.tags.join(', ')} w={150} onCommit={(v) => void patch(c, { tags: parseTags(v) })} /></td>
                <td><Inline label={`Penanggung jawab ${nm}`} value={c.assignee} w={110} list="crm-ass-bulk" onCommit={(v) => void patch(c, { assignee: v.trim() })} /></td>
                <td className="num"><Inline label={`Nilai ${nm}`} value={c.value ? String(c.value) : ''} w={96} onCommit={(v) => void patch(c, { value: Number(v.replace(/[^\d]/g, '')) || 0 })} /></td>
                <td>{srcLabel(c.source)}{c.sourceDetail ? <small className="mut"> {c.sourceDetail}</small> : null}</td>
                <td>{l ? TEMP_LABEL[l.temperature] : '-'}</td>
                <td className="num">{l?.engagement ?? '-'}</td>
                <td className="wrap" title={l?.nextAction}>{l ? `${FOLLOW_LABEL[l.followUpPriority]}: ${l.reason}` : '-'}</td>
                <td>{new Date(c.updatedAt).toLocaleString('id-ID')}</td>
                <td><div className="bar" style={{ margin: 0, flexWrap: 'nowrap' }}>
                  <button className="sm" onClick={() => onChat(c)}>Buka chat</button>
                  <button className="sm" onClick={() => onOpen(c)}>Edit</button>
                  <button className="sm danger" aria-label={`Hapus ${nm}`} onClick={() => void delOne(c)}>Hapus</button>
                </div></td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={13} className="mut">Tidak ada kontak yang cocok dengan filter.</td></tr>}
        </tbody>
      </table>
      </ScrollTable>
      {rows.length > shown && <div className="bar" style={{ marginTop: 6 }}><button onClick={() => setShown(shown + PAGE)}>Tampilkan {Math.min(PAGE, rows.length - shown)} lagi</button><span className="mut">{shown} dari {rows.length}</span></div>}
    </div>
  );
}

function Reminders({ reminders, contacts }: { reminders: Reminder[]; contacts: Contact[] }) {
  const open = reminders.filter((r) => !r.done).sort((a, b) => a.dueAt - b.dueAt);
  const name = (k: string) => { const c = contacts.find((x) => x.key === k); return c?.name || c?.phone || k; };
  const now = Date.now();
  return (
    <div className="fillcol"><ScrollTable label="Pengingat">
    <table>
      <thead><tr><th>Jatuh tempo</th><th>Kontak</th><th className="wrap">Catatan</th><th /></tr></thead>
      <tbody>
        {open.map((r) => (
          <tr key={r.id}>
            <td className={r.dueAt <= now ? 'overdue' : ''}>{new Date(r.dueAt).toLocaleString('id-ID')}</td>
            <td>{name(r.contactKey)}</td><td className="wrap">{r.text}</td>
            <td><button onClick={() => void send({ kind: 'crm:reminder:done', id: r.id })}>Selesai</button></td>
          </tr>
        ))}
        {!open.length && <tr><td colSpan={4} className="mut">Tidak ada pengingat terbuka.</td></tr>}
      </tbody>
    </table>
    </ScrollTable></div>
  );
}

function Pipeline({ stages }: { stages: string[] }) {
  const [list, setList] = useState(stages);
  const [msg, setMsg] = useState('');
  useEffect(() => setList(stages), [stages]);
  const set = (i: number, v: string) => setList(list.map((s, j) => (j === i ? v : s)));
  const move = (i: number, d: number) => {
    const n = [...list]; const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]]; setList(n);
  };
  const save = async () => {
    const r = await send<{ ok: boolean; error?: string }>({ kind: 'crm:pipeline:set', stages: list });
    setMsg(r.ok ? 'Tersimpan.' : r.error ?? 'Gagal.');
  };
  return (
    <div>
      {list.map((s, i) => (
        <div className="bar" key={i}>
          <input value={s} onChange={(e) => set(i, e.target.value)} />
          <button onClick={() => move(i, -1)}>↑</button>
          <button onClick={() => move(i, 1)}>↓</button>
          <button disabled={list.length <= 2} onClick={() => setList(list.filter((_, j) => j !== i))}>Hapus</button>
        </div>
      ))}
      <div className="bar">
        <button disabled={list.length >= 12} onClick={() => setList([...list, ''])}>+ Tahap</button>
        <button className="on" onClick={() => void save()}>Simpan</button>
        <span className="mut">{msg} Kontak pada tahap yang dihapus dipindah ke tahap pertama.</span>
      </div>
    </div>
  );
}
