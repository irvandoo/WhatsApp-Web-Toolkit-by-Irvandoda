import { createRoot } from 'react-dom/client';
import '../shared/ui/ui.css';
import { About } from '../shared/About';
import { t } from '../shared/ui/i18n';

createRoot(document.getElementById('root')!).render(<>
  <About />
  <div style={{ padding: '0 16px 16px' }}>
    <button className="primary" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/index.html') })}>{t.openHub}</button>
  </div>
</>);
