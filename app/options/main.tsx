import { createRoot } from 'react-dom/client';
import '../shared/ui/theme.css';
import '../shared/ui/ui.css';
import { About } from '../shared/About';
import { t } from '../shared/ui/i18n';

const tab = (p: string) => () => { void chrome.tabs.create({ url: chrome.runtime.getURL(`${p}/index.html`) }); };

createRoot(document.getElementById('root')!).render(<>
  <About />
  <div style={{ padding: '0 16px 16px' }}>
    <button className="primary" onClick={tab('dashboard')}>{t.openHub}</button>
    <button onClick={tab('crm')}>CRM</button>
    <button onClick={tab('templates')}>Template</button>
    <button onClick={tab('analytics')}>Analitik</button>
  </div>
</>);
