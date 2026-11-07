import { useMemo, useState } from 'react';
import { ScrollTable } from '../shared/ui/ScrollTable';
import { CREDIT, IS_FULL } from '../shared/credit';
import type { Account, AccountGroup, RuntimeMsg } from '../shared/messages';
import { isOnline, useAccounts, useGroups, useNow, useSessions } from '../shared/ui/hooks';
import { relTime, send, t } from '../shared/ui/i18n';

type Tab = 'accounts' | 'sessions' | 'registry' | 'about';
type AccountPatch = Extract<RuntimeMsg, { kind: 'account:update' }>['patch'];
const NOGROUP = '__none__';

export function App() {
  const [tab, setTab] = useState<Tab>('accounts');
  const tabs: [Tab, string][] = [['accounts', t.tabAccounts], ['sessions', t.tabSessions], ['registry', t.tabRegistry], ['about', t.tabAbout]];
  return (
    <div className="page">
      <header className="top"><h1>{CREDIT.product} - {t.hub}</h1>
        <a href="https://web.whatsapp.com" target="_blank" rel="noreferrer">{t.openWA}</a></header>
      <nav role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </nav>
      <div className={'pane' + (tab === 'sessions' ? ' fill' : '')}>
      {tab === 'accounts' && <Accounts />}
      {tab === 'sessions' && <Sessions />}
      {tab === 'registry' && <Registry />}
      {tab === 'about' && <AboutTab />}
      </div>
    </div>
  );
}

function Accounts() {
  const accounts = useAccounts(), groups = useGroups(), now = useNow();
  const [filter, setFilter] = useState('all'), [q, setQ] = useState('');
  const on = accounts.filter(a => isOnline(a, now));
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return accounts.filter(a =>
      (filter === 'all' || (filter === NOGROUP ? !a.groupId : a.groupId === filter)) &&
      (!s || [a.name, a.id, a.profileLabel, a.note].some(x => x?.toLowerCase().includes(s))))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [accounts, filter, q]);
  const sections: { g: AccountGroup | null; list: Account[] }[] = [
    ...groups.map(g => ({ g, list: shown.filter(a => a.groupId === g.id) })),
    { g: null, list: shown.filter(a => !a.groupId || !groups.some(g => g.id === a.groupId)) },
  ].filter(s => s.list.length);

  return <>
    <div className="summary">
      <div className="card"><div className="muted">{t.total}</div><div className="num">{accounts.length}</div></div>
      <div className="card"><div className="muted">{t.online}</div><div className="num">{on.length}</div></div>
      <div className="card"><div className="muted">{t.unread}</div><div className="num">{accounts.reduce((n, a) => n + (a.unread || 0), 0)}</div></div>
    </div>
    <div className="toolbar">
      <input type="search" aria-label={t.search} placeholder={t.search} value={q} onChange={e => setQ(e.target.value)} />
      <select aria-label={t.filterGroup} value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="all">{t.allGroups}</option><option value={NOGROUP}>{t.noGroup}</option>
        {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
    </div>
    {!shown.length && <p className="muted">{t.noAccounts}</p>}
    {sections.map(({ g, list }) => (
      <section key={g?.id ?? 'none'}>
        <h2><span className="dot" style={{ background: g?.color ?? '#999' }} /> {g?.name ?? t.noGroup} ({list.length})</h2>
        <div className="grid">{list.map(a => <AccountCard key={a.id} a={a} groups={groups} now={now} />)}</div>
      </section>
    ))}
    <GroupManager groups={groups} />
  </>;
}

function AccountCard({ a, groups, now }: { a: Account; groups: AccountGroup[]; now: number }) {
  const patch = (p: AccountPatch) => send({ kind: 'account:update', id: a.id, patch: p });
  const on = isOnline(a, now);
  return (
    <article className="card acc">
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <span className="dot" style={{ background: a.color }} />
        <input className="name" aria-label={t.name} defaultValue={a.name} key={a.name}
          onBlur={e => { const v = e.target.value.trim(); if (v && v !== a.name) patch({ name: v }); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <span className={`badge ${on ? 'on' : 'off'}`}>{on ? t.online : t.offline}</span>
      </div>
      <dl>
        <dt>{t.waId}</dt><dd>{a.id}</dd>
        <dt>{t.unread}</dt><dd>{a.unread}</dd>
        <dt>{t.chats}</dt><dd>{a.chatCount}</dd>
        <dt>{t.lastSeen}</dt><dd>{relTime(a.lastSeen, now)}</dd>
      </dl>
      <label>{t.profile}<input defaultValue={a.profileLabel} key={a.profileLabel} style={{ width: '100%' }}
        onBlur={e => e.target.value !== a.profileLabel && patch({ profileLabel: e.target.value })} /></label>
      <label>{t.note}<input defaultValue={a.note} key={a.note} style={{ width: '100%' }}
        onBlur={e => e.target.value !== a.note && patch({ note: e.target.value })} /></label>
      <div className="row">
        <label>{t.group}{' '}
          <select value={a.groupId ?? ''} onChange={e => patch({ groupId: e.target.value || null })}>
            <option value="">{t.noGroup}</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select></label>
        <label>{t.color}{' '}<input type="color" value={a.color} onChange={e => patch({ color: e.target.value })} /></label>
        <button className="danger" onClick={() => confirm(t.confirmDeleteAcc) && send({ kind: 'account:delete', id: a.id })}>{t.deleteAcc}</button>
      </div>
    </article>
  );
}

function GroupManager({ groups }: { groups: AccountGroup[] }) {
  const [name, setName] = useState('');
  const add = () => {
    const n = name.trim(); if (!n) return;
    send({ kind: 'group:upsert', group: { id: crypto.randomUUID(), name: n, color: '#128c7e' } }); setName('');
  };
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>{t.groups}</h2>
      {groups.map(g => (
        <div className="row" key={g.id} style={{ marginBottom: 6 }}>
          <input type="color" aria-label={t.color} value={g.color} onChange={e => send({ kind: 'group:upsert', group: { ...g, color: e.target.value } })} />
          <input aria-label={t.rename} defaultValue={g.name} key={g.name}
            onBlur={e => { const v = e.target.value.trim(); if (v && v !== g.name) send({ kind: 'group:upsert', group: { ...g, name: v } }); }} />
          <button className="danger" onClick={() => confirm(t.confirmDeleteGroup) && send({ kind: 'group:delete', id: g.id })}>{t.delete}</button>
        </div>
      ))}
      <form className="row" onSubmit={e => { e.preventDefault(); add(); }}>
        <input aria-label={t.newGroup} placeholder={t.newGroup} value={name} onChange={e => setName(e.target.value)} />
        <button className="primary" type="submit">{t.add}</button>
      </form>
    </section>
  );
}

function Sessions() {
  const sessions = useSessions(), accounts = useAccounts();
  const nameOf = (id: string) => accounts.find(a => a.id === id)?.name ?? t.unknownAcc;
  const sorted = [...sessions].sort((a, b) => b.createdAt - a.createdAt);
  return <div className="fillcol">
    <div className="warn" role="alert"><strong>{t.expTitle}</strong><p style={{ margin: '4px 0 0' }}>{t.expBody}</p></div>
    {!sorted.length ? <p className="muted">{t.noSessions}</p> :
      <ScrollTable stickyFirst label="Sesi tersimpan"><table><thead><tr><th>{t.account}</th><th>{t.label}</th><th>{t.created}</th><th>{t.size}</th><th /></tr></thead>
        <tbody>{sorted.map(s => (
          <tr key={s.id}><td>{nameOf(s.accountId)}</td><td>{s.label}</td>
            <td>{new Date(s.createdAt).toLocaleString('id-ID')}</td><td>{(s.bytes / 1024).toFixed(1)} KB</td>
            <td><button className="danger" onClick={() => confirm(t.confirmDeleteSession) && send({ kind: 'session:delete', id: s.id })}>{t.delete}</button></td></tr>
        ))}</tbody></table></ScrollTable>}
  </div>;
}

function Registry() {
  const [msg, setMsg] = useState('');
  const doExport = async () => {
    try {
      const r = await send<string | { error: string }>({ kind: 'registry:export' });
      if (typeof r !== 'string') throw new Error(r?.error ?? 'error');
      const url = URL.createObjectURL(new Blob([r], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = `wwt-registry-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg(t.exported);
    } catch (e) { setMsg(`${t.failed}: ${(e as Error).message}`); }
  };
  const doImport = async (f: File | undefined) => {
    if (!f) return;
    setMsg(t.importing);
    try {
      const r = await send<{ ok?: boolean; error?: string }>({ kind: 'registry:import', json: await f.text() });
      setMsg(r?.error ? `${t.failed}: ${r.error}` : t.importOk);
    } catch (e) { setMsg(`${t.failed}: ${(e as Error).message}`); }
  };
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>{t.regTitle}</h2>
      <p className="info">{t.regExplain}</p>
      <div className="row">
        <button className="primary" onClick={doExport}>{t.export}</button>
        <label className="row">{t.import}: <input type="file" accept="application/json,.json" onChange={e => { doImport(e.target.files?.[0]); e.target.value = ''; }} /></label>
      </div>
      <div className="msg" role="status">{msg}</div>
    </section>
  );
}

function AboutTab() {
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>{CREDIT.product}</h2>
      <p className="muted">{t.aboutBuild}: {IS_FULL ? 'full' : 'store'}</p>
      <p>{t.author}: <strong>{CREDIT.name}</strong> ({CREDIT.nickname})<br />
        <a href={`mailto:${CREDIT.email}`}>{CREDIT.email}</a><br />
        <a href={CREDIT.web} target="_blank" rel="noreferrer">irvandoda.web.id</a></p>
    </section>
  );
}
