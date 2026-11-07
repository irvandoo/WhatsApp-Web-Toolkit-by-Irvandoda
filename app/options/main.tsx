import { createRoot } from 'react-dom/client';
import '../shared/ui/ui.css';
import { About } from '../shared/About';
import { t } from '../shared/ui/i18n';

createRoot(document.getElementById('root')!).render(<>
  <About />
  <div style={{ padding: '0 16px 16px' }}>
    <button className="primary" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') })}>{t.openHub}</button>
    <button onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('crm/index.html') })}>CRM</button>
    <button onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('templates/index.html') })}>Template</button>
  </div>
</>);
