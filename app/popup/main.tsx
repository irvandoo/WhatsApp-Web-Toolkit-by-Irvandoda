import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/ui/ui.css';
import './popup.css';
import { CREDIT } from '../shared/credit';
import { db } from '../shared/db';
import { isOnline, useAccounts, useNow } from '../shared/ui/hooks';
import { useLiveCount } from './live';

const WA = 'https://web.whatsapp.com/*';
const open = (p: string) => { void chrome.tabs.create({ url: chrome.runtime.getURL(p) }); window.close(); };
type Page = 'dashboard' | 'crm' | 'templates' | 'analytics';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function focusTab(tab: chrome.tabs.Tab) {
  if (tab.id != null) await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
}
/** Show a module as an in-page overlay on WhatsApp Web; the extension page is only opened as a tab if messaging ultimately fails. */
async function openModule(page: Page) {
  const msg = { kind: 'ui:overlay', page };
  const trySend = async (id: number) => { try { await chrome.tabs.sendMessage(id, msg); return true; } catch { return false; } };
  try {
    let [tab] = await chrome.tabs.query({ url: WA });
    let ok = false;
    if (tab?.id != null) {
      ok = await trySend(tab.id);
    } else {
      tab = await chrome.tabs.create({ url: 'https://web.whatsapp.com' });
      const start = Date.now();
      // wait for load, then retry every 2s up to 10s while the content script boots
      await sleep(2000);
      while (!ok && tab.id != null && Date.now() - start < 12000) {
        const cur = await chrome.tabs.get(tab.id);
        if (cur.status === 'complete') ok = await trySend(tab.id);
        if (!ok) await sleep(2000);
      }
    }
    if (ok) { await focusTab(tab); window.close(); return; }
  } catch { /* fall through */ }
  void chrome.tabs.create({ url: chrome.runtime.getURL(`${page}/index.html`) });
  window.close();
}
async function focusWA(create = true) {
  const [tab] = await chrome.tabs.query({ url: WA });
  if (tab?.id != null) { await chrome.tabs.update(tab.id, { active: true }); if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true }); }
  else if (create) await chrome.tabs.create({ url: 'https://web.whatsapp.com' });
  window.close();
}

const I = (d: ReactNode) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const icons = {
  sync: I(<><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8" /><path d="M21 3v5h-5M3 21v-5h5" /></>),
  hub: I(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>),
  crm: I(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.5 3.2-5.5 6.5-5.5s5.9 2 6.5 5.5" /><path d="M17 11a3 3 0 1 0 0-6M18.5 14.7c1.8.6 3 2.3 3.3 5" /></>),
  tpl: I(<><path d="M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V5a1 1 0 0 1 1-1z" /><path d="M8 9h8M8 12h5" /></>),
  mem: I(<><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></>),
  ses: I(<><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>),
  arc: I(<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></>),
  set: I(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>),
  pos: I(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M16 15h0" /></>),
  blast: I(<><circle cx="12" cy="13" r="8" /><path d="M12 8v5l3 2M9 2h6" /></>),
  grp: I(<><circle cx="12" cy="7" r="3" /><circle cx="5" cy="17" r="2.5" /><circle cx="19" cy="17" r="2.5" /><path d="M10 10l-4 5M14 10l4 5" /></>),
  chart: I(<><path d="M4 20V4M4 20h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></>),
};

function Tile(p: { icon: ReactNode; title: string; desc: string; badge?: ReactNode; onClick?: () => void; soon?: boolean }) {
  return (
    <button className={'tile' + (p.soon ? ' soon' : '')} onClick={p.onClick} disabled={p.soon}
      aria-label={p.soon ? `${p.title} (segera hadir)` : `${p.title}: ${p.desc}`} title={p.soon ? 'Segera hadir' : p.desc}>
      {p.icon}<strong>{p.title}</strong><em>{p.desc}</em>
      {p.soon ? <span className="bd">Segera</span> : p.badge != null && p.badge !== 0 ? <span className="bd">{p.badge}</span> : null}
    </button>
  );
}

function useWaTab() {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => { chrome.tabs.query({ url: WA }).then(r => setN(r.length)).catch(() => setN(0)); }, []);
  return n;
}

function Popup() {
  const accounts = useAccounts(), now = useNow(), tabs = useWaTab();
  const online = accounts.filter(a => isOnline(a, now)).length;
  const unread = accounts.reduce((n, a) => n + (a.unread || 0), 0);
  const contacts = useLiveCount(() => db.contacts.count());
  const reminders = useLiveCount(() => db.reminders.filter(r => !r.done).count());
  const sessions = useLiveCount(() => db.sessions.count());
  const msgs = useLiveCount(() => db.messages.count());
  const unanswered = useLiveCount(() => db.interactions.filter(i => !i.isGroup && i.lastInTs != null && (i.lastOutTs == null || i.lastInTs > i.lastOutTs)).count());
  const [hint, setHint] = useState(false);
  let st: [string, string] = ['wait', 'Memeriksa...'];
  if (tabs === 0) st = ['off', 'WA Web belum dibuka'];
  else if (tabs !== null) st = online > 0 ? ['ok', 'WA Web siap'] : ['wait', 'WA Web terbuka'];
  const ver = chrome.runtime.getManifest().version;
  return (
    <div className="pp">
      <header className="hd">
        <div className="mark" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20l1.2-4A8.5 8.5 0 1 1 8 18.8z" /><path d="M9 9.5c.5 2.5 2.5 4.5 5 5" /></svg>
        </div>
        <div className="grow"><h1>WhatsApp Web Toolkit</h1><small>by Irvandoda</small></div>
        <span className={'pill ' + st[0]} role="status"><i />{st[1]}</span>
      </header>
      <section className="kpis" aria-label="Ringkasan">
        <div className="kpi"><b>{online}</b><span>Akun online</span></div>
        <div className="kpi"><b>{unread}</b><span>Belum dibaca</span></div>
        <div className="kpi"><b>{contacts}</b><span>Kontak CRM</span></div>
        <div className="kpi"><b>{reminders}</b><span>Pengingat terbuka</span></div>
      </section>
      <main className="grid">
        <Tile icon={icons.sync} title="Sync Center" desc="Buka & fokus tab WhatsApp Web" onClick={() => void focusWA()} />
        <Tile icon={icons.hub} title="Hub Akun" desc="Dasbor semua akun" badge={accounts.length} onClick={() => void openModule('dashboard')} />
        <Tile icon={icons.crm} title="CRM" desc="Kontak, tahap, catatan" badge={contacts} onClick={() => void openModule('crm')} />
        <Tile icon={icons.tpl} title="Template" desc="Balasan cepat dengan shortcut" onClick={() => void openModule('templates')} />
        <Tile icon={icons.chart} title="Analitik" desc="Statistik percakapan & lead" badge={unanswered} onClick={() => void openModule('analytics')} />
        <Tile icon={icons.mem} title="Memori" desc="Hemat RAM, buka dari panel" onClick={() => setHint(true)} />
        <Tile icon={icons.ses} title="Sesi tersimpan" desc="Snapshot sesi (eksperimental)" badge={sessions} onClick={() => void openModule('dashboard')} />
        <Tile icon={icons.arc} title="Arsip pesan" desc="Pesan lokal tersimpan" badge={msgs} onClick={() => void focusWA()} />
        <Tile icon={icons.set} title="Pengaturan" desc="Opsi & tentang" onClick={() => open('options/index.html')} />
        <Tile soon icon={icons.pos} title="POS" desc="Kasir & pesanan" />
        <Tile soon icon={icons.blast} title="Blast terjadwal" desc="Kirim terjadwal" />
        <Tile soon icon={icons.grp} title="Ekstrak grup" desc="Ekspor anggota grup" />
      </main>
      {hint && <p className="hint" role="status">Fitur Memori ada di panel melayang pada tab WhatsApp Web.</p>}
      <footer className="ft">
        <button className="wa" onClick={() => void focusWA()} aria-label="Buka WhatsApp Web">Buka WhatsApp Web</button>
        <p><span>{CREDIT.name} · <a href={CREDIT.web} target="_blank" rel="noreferrer">irvandoda.web.id</a></span><span>v{ver}</span></p>
      </footer>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Popup />);
