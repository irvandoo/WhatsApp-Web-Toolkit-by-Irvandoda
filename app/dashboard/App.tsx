import { useMemo, useState } from 'react';
import { ScrollTable } from '../shared/ui/ScrollTable';
import { CREDIT, IS_FULL } from '../shared/credit';
import type { Account, AccountGroup, RuntimeMsg } from '../shared/messages';
import { isOnline, useAccounts, useGroups, useNow, useSessions } from '../shared/ui/hooks';
import { clearPersisted, usePersistentState } from '../shared/ui/persist';
import { AccountsHub } from './Hub';
import { relTime, send, t } from '../shared/ui/i18n';

type Tab = 'accounts' | 'sessions' | 'registry' | 'about';
type AccountPatch = Extract<RuntimeMsg, { kind: 'account:update' }>['patch'];
const NOGROUP = '__none__';

export function App() {
  const [tab, setTab] = usePersistentState<Tab>('hub.tab', 'accounts', (v): v is Tab => v === 'accounts' || v === 'sessions' || v === 'registry' || v === 'about');
  const [resetN, setResetN] = useState(0);
  const resetView = () => { setTab('accounts'); setResetN((n) => n + 1); void clearPersisted('hub.'); };
  const hasSessions = useSessions().length > 0;
  const tabs: [Tab, string][] = [['accounts', t.tabAccounts], ...(hasSessions || tab === 'sessions' ? [['sessions', t.tabSessions + ' (usang)'] as [Tab, string]] : []), ['registry', t.tabRegistry], ['about', t.tabAbout]];
  return (
    <div className="page">
      <header className="top"><h1>{CREDIT.product} - {t.hub}</h1>
        <span><button type="button" className="lnk" onClick={resetView} title="Kembalikan tab, filter, dan urutan ke pengaturan awal">Atur ulang tampilan</button>{' '}
        <a href="https://web.whatsapp.com" target="_blank" rel="noreferrer">{t.openWA}</a></span></header>
      <nav role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </nav>
      <div className={'pane' + (tab === 'sessions' ? ' fill' : '')}>
      {tab === 'accounts' && <AccountsHub resetSignal={resetN} />}
      {tab === 'sessions' && <Sessions />}
      {tab === 'registry' && <Registry />}
      {tab === 'about' && <AboutTab />}
      </div>
    </div>
  );
}

function Sessions() {
  const sessions = useSessions(), accounts = useAccounts();
  const nameOf = (id: string) => accounts.find(a => a.id === id)?.name ?? t.unknownAcc;
  const sorted = [...sessions].sort((a, b) => b.createdAt - a.createdAt);
  return <div className="fillcol">
    <div className="warn" role="alert"><strong>{t.expTitle}</strong> <span className="muted">(usang: tidak dipakai lagi, akun kini memakai slot)</span><p style={{ margin: '4px 0 0' }}>{t.expBody}</p></div>
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
