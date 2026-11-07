import { liveQuery } from 'dexie';
import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_STAGES, type Contact, type CrmMsg, type Reminder } from '../shared/crm-types';
import { db } from '../shared/db';

const send = <T,>(m: CrmMsg): Promise<T> => chrome.runtime.sendMessage(m) as Promise<T>;
const idr = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

function useLive<T>(fn: () => Promise<T>, init: T): T {
  const [v, setV] = useState<T>(init);
  useEffect(() => {
    const sub = liveQuery(fn).subscribe({ next: setV, error: () => {} });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}

function download(name: string, data: string, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

type Tab = 'kanban' | 'daftar' | 'pengingat' | 'pipeline';

export function App() {
  const [tab, setTab] = useState<Tab>('kanban');
  const contacts = useLive(() => db.contacts.toArray(), [] as Contact[]);
  const reminders = useLive(() => db.reminders.toArray(), [] as Reminder[]);
  const stages = useLive(async () => (await db.pipeline.get('default'))?.stages ?? [...DEFAULT_STAGES], [...DEFAULT_STAGES] as string[]);
  const accounts = useLive(() => db.accounts.toArray(), []);
  const [acc, setAcc] = useState('');
  const [tag, setTag] = useState('');
  const [q, setQ] = useState('');

  const allTags = useMemo(() => [...new Set(contacts.flatMap((c) => c.tags))].sort(), [contacts]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return contacts.filter((c) =>
      (!acc || c.accountId === acc) && (!tag || c.tags.includes(tag)) &&
      (!s || c.name.toLowerCase().includes(s) || c.phone.includes(s) || c.tags.some((t) => t.toLowerCase().includes(s))));
  }, [contacts, acc, tag, q]);

  const tabs: [Tab, string][] = [['kanban', 'Kanban'], ['daftar', 'Daftar'], ['pengingat', 'Pengingat'], ['pipeline', 'Pipeline']];
  return (
    <div className="wrap">
      <h1>CRM - WhatsApp Web Toolkit by Irvandoda</h1>
      <nav>{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
      {(tab === 'kanban' || tab === 'daftar') && (
        <div className="bar">
          <input placeholder="Cari nama / telepon / tag" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={acc} onChange={(e) => setAcc(e.target.value)}>
            <option value="">Semua akun</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
          </select>
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">Semua tag</option>
            {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      )}
      {tab === 'kanban' && <Kanban contacts={filtered} stages={stages} />}
      {tab === 'daftar' && <List contacts={filtered} />}
      {tab === 'pengingat' && <Reminders reminders={reminders} contacts={contacts} />}
      {tab === 'pipeline' && <Pipeline stages={stages} />}
    </div>
  );
}

function Kanban({ contacts, stages }: { contacts: Contact[]; stages: string[] }) {
  const [over, setOver] = useState('');
  const drop = (stage: string, key: string) => {
    setOver('');
    const c = contacts.find((x) => x.key === key);
    if (c && c.stage !== stage) void send({ kind: 'crm:contact:upsert', contact: { accountId: c.accountId, chatId: c.chatId, stage } });
  };
  return (
    <div className="board">
      {stages.map((st) => {
        const items = contacts.filter((c) => (stages.includes(c.stage) ? c.stage : stages[0]) === st);
        const total = items.reduce((a, c) => a + (c.value || 0), 0);
        return (
          <div key={st} className={'col' + (over === st ? ' over' : '')}
            onDragOver={(e) => { e.preventDefault(); setOver(st); }}
            onDragLeave={() => setOver('')}
            onDrop={(e) => { e.preventDefault(); drop(st, e.dataTransfer.getData('text/plain')); }}>
            <h3>{st} <small>({items.length}) {idr(total)}</small></h3>
            {items.map((c) => (
              <div key={c.key} className="card" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', c.key)}>
                <b>{c.name || c.phone || c.chatId}</b>
                <div className="mut">{c.phone}{c.assignee ? ` - ${c.assignee}` : ''}</div>
                <div>{c.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
                {c.value > 0 && <div>{idr(c.value)}</div>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

type SortKey = 'name' | 'phone' | 'stage' | 'value' | 'updatedAt';

function List({ contacts }: { contacts: Contact[] }) {
  const [sk, setSk] = useState<SortKey>('updatedAt');
  const [asc, setAsc] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState('');
  const rows = useMemo(() => {
    const r = [...contacts].sort((a, b) => {
      const x = a[sk], y = b[sk];
      return (typeof x === 'number' ? x - (y as number) : String(x).localeCompare(String(y))) * (asc ? 1 : -1);
    });
    return r;
  }, [contacts, sk, asc]);
  const th = (k: SortKey, l: string) => <th onClick={() => { if (sk === k) setAsc(!asc); else { setSk(k); setAsc(true); } }}>{l}{sk === k ? (asc ? ' ▲' : ' ▼') : ''}</th>;
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const applyBulk = async () => {
    const t = bulk.trim();
    if (!t) return;
    for (const c of contacts.filter((x) => sel.has(x.key)))
      await send({ kind: 'crm:contact:upsert', contact: { accountId: c.accountId, chatId: c.chatId, tags: [...new Set([...c.tags, t])] } });
    setBulk('');
  };
  const exp = async (format: 'json' | 'csv') => {
    const r = await send<{ data: string }>({ kind: 'crm:export', format });
    download(`crm.${format}`, r.data, format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json');
  };
  return (
    <>
      <div className="bar">
        <input placeholder="Tag untuk yang dipilih" value={bulk} onChange={(e) => setBulk(e.target.value)} />
        <button disabled={!sel.size || !bulk.trim()} onClick={() => void applyBulk()}>Tambah tag ({sel.size})</button>
        <button onClick={() => void exp('csv')}>Ekspor CSV</button>
        <button onClick={() => void exp('json')}>Ekspor JSON</button>
      </div>
      <table>
        <thead><tr><th><input type="checkbox" checked={!!rows.length && sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.key)) : new Set())} /></th>
          {th('name', 'Nama')}{th('phone', 'Telepon')}{th('stage', 'Tahap')}<th>Tag</th>{th('value', 'Nilai')}{th('updatedAt', 'Diperbarui')}</tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.key}>
              <td><input type="checkbox" checked={sel.has(c.key)} onChange={() => toggle(c.key)} /></td>
              <td>{c.name || c.chatId}{c.optOut ? ' (opt-out)' : ''}</td><td>{c.phone}</td><td>{c.stage}</td>
              <td>{c.tags.join(', ')}</td><td>{idr(c.value)}</td><td>{new Date(c.updatedAt).toLocaleString('id-ID')}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7} className="mut">Belum ada kontak.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

function Reminders({ reminders, contacts }: { reminders: Reminder[]; contacts: Contact[] }) {
  const open = reminders.filter((r) => !r.done).sort((a, b) => a.dueAt - b.dueAt);
  const name = (k: string) => { const c = contacts.find((x) => x.key === k); return c?.name || c?.phone || k; };
  const now = Date.now();
  return (
    <table>
      <thead><tr><th>Jatuh tempo</th><th>Kontak</th><th>Catatan</th><th /></tr></thead>
      <tbody>
        {open.map((r) => (
          <tr key={r.id}>
            <td className={r.dueAt <= now ? 'overdue' : ''}>{new Date(r.dueAt).toLocaleString('id-ID')}</td>
            <td>{name(r.contactKey)}</td><td>{r.text}</td>
            <td><button onClick={() => void send({ kind: 'crm:reminder:done', id: r.id })}>Selesai</button></td>
          </tr>
        ))}
        {!open.length && <tr><td colSpan={4} className="mut">Tidak ada pengingat terbuka.</td></tr>}
      </tbody>
    </table>
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
