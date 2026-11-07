import { createRoot } from 'react-dom/client';
import '../shared/ui/ui.css';
import { CREDIT } from '../shared/credit';
import { isOnline, useAccounts, useNow } from '../shared/ui/hooks';
import { t } from '../shared/ui/i18n';

function Popup() {
  const accounts = useAccounts(), now = useNow();
  const online = accounts.filter(a => isOnline(a, now)).length;
  const unread = accounts.reduce((n, a) => n + (a.unread || 0), 0);
  return (
    <div style={{ width: 300, padding: 14 }}>
      <strong>{CREDIT.product}</strong>
      <div className="row" style={{ margin: '10px 0', justifyContent: 'space-between' }}>
        <span>{t.total}: <b>{accounts.length}</b></span><span>{t.online}: <b>{online}</b></span><span>{t.unread}: <b>{unread}</b></span>
      </div>
      <div className="row">
        <button className="primary" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/index.html') })}>{t.openHub}</button>
        <button onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('src/crm/index.html') })}>CRM</button>
        <button onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('src/templates/index.html') })}>Template</button>
        <a href="https://web.whatsapp.com" target="_blank" rel="noreferrer">{t.openWA}</a>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>{CREDIT.nickname} - <a href={CREDIT.web} target="_blank" rel="noreferrer">irvandoda.web.id</a></p>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Popup />);
