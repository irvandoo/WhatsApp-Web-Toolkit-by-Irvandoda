import { CREDIT } from '../shared/credit';
import { call } from './bridge';
import { jsHeapMB } from './memory';
import { restoreSession, saveSession } from './session';
import type { RuntimeMsg, SessionMeta } from '../shared/messages';
import { listChats, ping, syncAll, syncChat, type SyncProgress } from './sync';

const CSS = `
:host{all:initial}
.fab{position:fixed;right:12px;bottom:12px;z-index:99999;width:40px;height:40px;border-radius:50%;border:0;background:#25d366;color:#fff;font:700 16px system-ui;cursor:pointer;box-shadow:0 2px 8px #0004}
.box{position:fixed;right:12px;bottom:60px;z-index:99999;width:300px;max-height:70vh;overflow:auto;background:#fff;color:#111;border-radius:10px;padding:12px;font:13px system-ui;box-shadow:0 4px 18px #0005;display:none}
.box.open{display:block}
button.a{margin:2px 4px 2px 0;padding:5px 9px;border:1px solid #25d366;background:#fff;border-radius:6px;cursor:pointer}
pre{white-space:pre-wrap;background:#f4f4f4;padding:6px;border-radius:6px;max-height:160px;overflow:auto}
small{color:#667}`;

export function mountPanel(): void {
  if (document.getElementById('wwt-panel')) return;
  const host = document.createElement('div');
  host.id = 'wwt-panel';
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = CSS;
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.title = CREDIT.product;
  fab.textContent = 'W';
  const box = document.createElement('div');
  box.className = 'box';
  const title = document.createElement('b');
  title.textContent = CREDIT.product;
  const credit = document.createElement('small');
  credit.textContent = `${CREDIT.name} · ${CREDIT.web}`;
  const st = document.createElement('div');
  st.textContent = 'Memeriksa adapter…';
  const log = document.createElement('pre');
  const mk = (label: string) => {
    const b = document.createElement('button');
    b.className = 'a';
    b.textContent = label;
    return b;
  };
  const s1 = mk('Sync chat terbuka'), s2 = mk('Sync semua'), stop = mk('Stop'), trim = mk('Bersihkan memori');
  const sv = mk('Simpan sesi (eksperimental)'), rs = mk('Pulihkan sesi');
  box.append(title, document.createElement('br'), credit, document.createElement('hr'), st, s1, s2, stop, trim, sv, rs, log);
  root.append(style, fab, box);
  document.documentElement.appendChild(host);

  let ctl: AbortController | null = null;
  const say = (s: string) => { log.textContent = s + '\n' + (log.textContent ?? '').slice(0, 2000); };
  const prog = (p: SyncProgress) =>
    say(`${p.name}: ${p.total} pesan, ronde ${p.rounds}${p.done ? (p.error ? ' ✗ ' + p.error : p.reachedStart ? ' ✓ awal tercapai' : ' ✓ selesai (tidak bertambah)') : ''}`);

  async function refresh() {
    try {
      const p = await ping();
      const heap = jsHeapMB();
      st.textContent = `Adapter OK · Store ${p.store ? 'terdeteksi' : 'TIDAK terdeteksi'} · akun ${p.accountId ?? '?'}${heap ? ' · heap ' + heap + ' MB' : ''}`;
    } catch { st.textContent = 'Adapter belum siap'; }
  }

  fab.addEventListener('click', () => { box.classList.toggle('open'); void refresh(); });
  stop.addEventListener('click', () => ctl?.abort());
  trim.addEventListener('click', async () => {
    try { const r = await call<{ trimmed: number }>({ type: 'memory:trim' }); say(`Memori: ${r.trimmed} chat dipangkas`); }
    catch (e) { say(String(e)); }
  });
  s1.addEventListener('click', async () => {
    const title = document.querySelector<HTMLElement>('#main header span[title]')?.title;
    const chats = await listChats().catch(() => []);
    const chat = chats.find((c) => c.name === title);
    if (!chat) return say('Buka sebuah chat dulu (atau Store belum terdeteksi).');
    ctl = new AbortController();
    await syncChat(chat, ctl.signal, prog);
  });
  s2.addEventListener('click', async () => {
    const chats = await listChats().catch(() => []);
    if (!chats.length) return say('Daftar chat kosong / Store tidak terdeteksi.');
    ctl = new AbortController();
    await syncAll(chats, ctl.signal, prog);
    say('Selesai.');
  });
  sv.addEventListener('click', async () => {
    try {
      const id = (await ping()).accountId;
      if (!id) return say('Akun belum terdeteksi.');
      say('Menyimpan sesi (EKSPERIMENTAL)…');
      const r = await saveSession(id, new Date().toLocaleString());
      say(r.ok ? `Sesi tersimpan (${Math.round(r.bytes / 1024)} KB).` : `Gagal (${r.reason}): ${r.details.slice(0, 5).join(', ')}${r.details.length > 5 ? ' …' : ''}`);
    } catch (e) { say(String(e)); }
  });
  rs.addEventListener('click', async () => {
    try {
      const id = (await ping()).accountId;
      const list = (await chrome.runtime.sendMessage({ kind: 'session:list', accountId: id ?? undefined } satisfies RuntimeMsg)) as SessionMeta[];
      const last = Array.isArray(list) ? list.sort((a, b) => b.createdAt - a.createdAt)[0] : undefined;
      if (!last) return say('Belum ada sesi tersimpan untuk akun ini.');
      if (!confirm(`EKSPERIMENTAL: ini menghapus semua data penyimpanan WhatsApp Web saat ini dan menggantinya dengan sesi "${last.label}". Lanjutkan?`)) return;
      await restoreSession(last.id, { confirm: true });
    } catch (e) { say(String(e)); }
  });
}
