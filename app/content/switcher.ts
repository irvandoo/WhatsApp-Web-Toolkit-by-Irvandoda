import { DEFAULT_SID, SID_KEY, SLOT_COLORS, defaultSlot, isValidSid, slotPrefix, type Slot, type SlotMsg } from '../shared/slots';
import { ping } from './sync';

/** Account switcher (one tab, many logins). Storage is virtualized by injected/virtual-session.ts. */
export function currentSlotId(): string {
  try { return sessionStorage.getItem(SID_KEY) || DEFAULT_SID; } catch { return DEFAULT_SID; }
}

const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
async function send<T>(m: SlotMsg): Promise<T | undefined> {
  try { return alive() ? ((await chrome.runtime.sendMessage(m)) as T) : undefined; } catch { return undefined; }
}
const list = async (): Promise<Slot[]> => {
  const r = await send<Slot[] | { error: string }>({ kind: 'slot:list' });
  return Array.isArray(r) && r.length ? r : [defaultSlot()];
};

export async function currentSlot(): Promise<Slot> {
  const id = currentSlotId();
  return (await list()).find((s) => s.id === id) ?? { ...defaultSlot(), id, label: id };
}

const SWITCHED_KEY = 'wwt-switched';

/** Small toast (own shadow DOM) so switching feels instant and the user knows what happens next. */
function showNotice(text: string, ms: number, busy = false): void {
  try {
    document.getElementById('wwt-notice')?.remove();
    const host = document.createElement('div');
    host.id = 'wwt-notice';
    const root = host.attachShadow({ mode: 'closed' });
    const st = document.createElement('style');
    st.textContent = `.n{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483600;max-width:min(92vw,520px);padding:10px 16px;border-radius:12px;font:13px/1.45 system-ui,sans-serif;background:#fbfcfb;color:#26332e;border:1px solid #e3e9e6;box-shadow:0 6px 24px rgba(38,51,46,.16);display:flex;gap:10px;align-items:center}@media(prefers-color-scheme:dark){.n{background:#1b2420;color:#dfe8e3;border-color:#2d3a34}}.s{width:14px;height:14px;border-radius:50%;border:2px solid #3fae6b;border-top-color:transparent;animation:r .8s linear infinite;flex:none}@keyframes r{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.s{animation:none}}`;
    const box = document.createElement('div');
    box.className = 'n';
    box.setAttribute('role', 'status');
    if (busy) { const sp = document.createElement('i'); sp.className = 's'; box.append(sp); }
    const t = document.createElement('span');
    t.textContent = text;
    box.append(t);
    root.append(st, box);
    document.documentElement.appendChild(host);
    if (ms > 0) setTimeout(() => host.remove(), ms);
  } catch { /* never block switching */ }
}

export function switchTo(sid: string): void {
  if (sid !== DEFAULT_SID && !isValidSid(sid)) return;
  try { sessionStorage.setItem(SID_KEY, sid); sessionStorage.setItem(SWITCHED_KEY, sid); } catch { return; }
  showNotice('Membuka akun… halaman akan dimuat ulang', 0, true);
  // Give the touch a brief chance to reach the background, then reload into the new namespace.
  void Promise.race([send({ kind: 'slot:touch', id: sid }), new Promise((r) => setTimeout(r, 120))]).finally(() => location.reload());
}

/**
 * Remove a deleted slot's data. The isolated world sees the REAL (unprefixed-by-us) storage, so
 * it can find `wwt:<sid>:*`. Refuses the active slot (WA is using it).
 */
export async function purgeSlotData(sid: string): Promise<number> {
  if (sid === DEFAULT_SID || sid === currentSlotId() || !isValidSid(sid)) return 0;
  const p = slotPrefix(sid);
  let n = 0;
  try {
    const names = ((await indexedDB.databases?.()) ?? []).map((d) => d.name).filter((x): x is string => !!x && x.startsWith(p));
    await Promise.all(names.map((name) => new Promise<void>((res) => {
      n++;
      try {
        const r = indexedDB.deleteDatabase(name);
        r.onsuccess = r.onerror = r.onblocked = () => res();
        setTimeout(res, 4000);
      } catch { res(); }
    })));
  } catch { /* best effort */ }
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(p)) { localStorage.removeItem(k); n++; }
  } catch { /* best effort */ }
  return n;
}

/** Once the adapter reports an account id, bind it to the current slot (retries until known, ~10 min). */
export function mountSlotBinding(): void {
  const sid = currentSlotId();
  // just switched here: confirm which account is active and what to do if WhatsApp shows a QR code
  try {
    if (sessionStorage.getItem(SWITCHED_KEY)) {
      sessionStorage.removeItem(SWITCHED_KEY);
      void currentSlot().then((s) => showNotice(`Akun aktif: ${s.label}. Jika muncul kode QR, scan lewat HP: Pengaturan → Perangkat tertaut.`, 9000));
    }
  } catch { /* storage blocked */ }
  let tries = 0;
  const t = window.setInterval(async () => {
    if (!alive() || ++tries > 120) return clearInterval(t);
    try {
      const p = await ping();
      if (!p.accountId) return;
      clearInterval(t);
      await send({ kind: 'slot:bind', id: sid, accountId: p.accountId });
    } catch { /* adapter not ready */ }
  }, 5000);
}

const CSS = `
:host{all:initial}*{box-sizing:border-box}
.pop{--bg:#fff;--fg:#111b21;--mut:#667781;--bd:#e2e8ea;--hov:rgba(18,140,126,.1);--g:#128c7e;
 position:fixed;z-index:2147483601;width:292px;max-height:min(480px,80vh);overflow:auto;padding:6px;border-radius:12px;border:1px solid var(--bd);
 background:var(--bg);color:var(--fg);box-shadow:0 12px 40px rgba(0,0,0,.28);font:13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.pop.dark{--bg:#111b21;--fg:#e9edef;--mut:#8696a0;--bd:#26343c;--hov:rgba(37,211,102,.14);--g:#25d366}
button{font:inherit;color:inherit;cursor:pointer;background:transparent;border:0}
button:focus-visible,input:focus-visible{outline:2px solid var(--g);outline-offset:1px}
.row{display:flex;align-items:center;gap:4px;border-radius:8px}.row:hover{background:var(--hov)}
.main{flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:7px 8px;text-align:left;border-radius:8px}
.dot{width:10px;height:10px;border-radius:50%;flex:none}
.t{flex:1;min-width:0}.t b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t small{display:block;color:var(--mut);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.on{font-size:10px;font-weight:700;color:var(--g);border:1px solid var(--g);border-radius:99px;padding:0 6px}
.more{width:28px;height:28px;border-radius:7px;color:var(--mut)}.more:hover{background:var(--hov)}
.menu{display:flex;flex-direction:column;margin:0 0 4px 22px;padding:4px;border:1px solid var(--bd);border-radius:8px}
.menu button{text-align:left;padding:6px 8px;border-radius:6px}.menu button:hover{background:var(--hov)}.menu .danger{color:#dc2626}
.sw{display:flex;gap:6px;padding:6px 8px;flex-wrap:wrap}.sw button{width:20px;height:20px;border-radius:50%;border:2px solid transparent}.sw button.sel{border-color:var(--fg)}
input{width:100%;font:inherit;color:inherit;background:transparent;border:1px solid var(--bd);border-radius:7px;padding:6px 8px}
.add{width:100%;text-align:left;padding:8px;border-top:1px solid var(--bd);margin-top:4px;border-radius:0 0 8px 8px;color:var(--g);font-weight:600}.add:hover{background:var(--hov)}
.f{padding:6px 8px}.hint{padding:4px 8px;color:var(--mut);font-size:11px}
`;

let closeOpen: (() => void) | null = null;

export function openSwitcher(anchor: HTMLElement): void {
  if (closeOpen) { closeOpen(); return; } // toggle
  const host = document.createElement('div');
  host.id = 'wwt-switcher';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const pop = document.createElement('div');
  pop.className = 'pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Ganti akun');
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  pop.classList.toggle('dark', document.body?.classList.contains('dark') || document.documentElement.classList.contains('dark') || (!!mq?.matches && !document.body?.classList.contains('light')));
  root.append(style, pop);

  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.right + 8, innerWidth - 300))}px`;
  pop.style.top = `${Math.max(8, Math.min(r.top, innerHeight - 200))}px`;

  const active = currentSlotId();
  let slots: Slot[] = [];
  let menuFor: string | null = null;
  let editing: { id: string; mode: 'rename' | 'new' } | null = null;

  function close() {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    host.remove();
    closeOpen = null;
    try { anchor.focus(); } catch { /* gone */ }
  }
  closeOpen = close;
  const onDown = (e: Event) => { if (!e.composedPath().includes(host) && !e.composedPath().includes(anchor)) close(); };
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...pop.querySelectorAll<HTMLElement>('button.main, button.add')];
    const i = items.indexOf(root.activeElement as HTMLElement);
    if (!items.length || (root.activeElement instanceof HTMLInputElement)) return;
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  }
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };
  const btn = (cls: string, text: string, fn: () => void, label?: string) => {
    const b = el('button', cls, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.onclick = fn;
    return b;
  };
  function inputRow(value: string, placeholder: string, onOk: (v: string) => void): HTMLElement {
    const w = el('div', 'f');
    const i = el('input');
    i.value = value; i.placeholder = placeholder; i.maxLength = 40;
    i.setAttribute('aria-label', placeholder);
    i.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && i.value.trim()) onOk(i.value.trim());
      else if (e.key === 'Escape') { e.preventDefault(); editing = null; render(); }
    };
    w.append(i);
    setTimeout(() => { i.focus(); i.select(); }, 0);
    return w;
  }
  async function reload() { slots = await list(); render(); }
  async function act(m: SlotMsg) { await send(m); menuFor = null; editing = null; await reload(); }

  function render() {
    pop.replaceChildren();
    for (const s of slots) {
      if (editing?.mode === 'rename' && editing.id === s.id) {
        pop.append(inputRow(s.label, 'Nama akun', (v) => void act({ kind: 'slot:update', id: s.id, patch: { label: v } })));
        continue;
      }
      const row = el('div', 'row');
      const main = btn('main', '', () => (s.id === active ? close() : switchTo(s.id)));
      const dot = el('span', 'dot'); dot.style.background = s.color;
      const t = el('span', 't');
      t.append(el('b', '', s.label));
      if (s.accountId) t.append(el('small', '', s.accountId.replace(/@.*/, '')));
      main.append(dot, t);
      if (s.id === active) { main.append(el('span', 'on', 'aktif')); main.setAttribute('aria-current', 'true'); }
      const more = btn('more', '⋯', () => { menuFor = menuFor === s.id ? null : s.id; render(); }, `Menu ${s.label}`);
      more.setAttribute('aria-expanded', String(menuFor === s.id));
      row.append(main, more);
      pop.append(row);
      if (menuFor === s.id) {
        const menu = el('div', 'menu');
        menu.append(btn('', 'Ganti nama', () => { editing = { id: s.id, mode: 'rename' }; menuFor = null; render(); }));
        const sw = el('div', 'sw');
        for (const c of SLOT_COLORS) {
          const b = btn(c === s.color ? 'sel' : '', '', () => void act({ kind: 'slot:update', id: s.id, patch: { color: c } }), `Warna ${c}`);
          b.style.background = c; sw.append(b);
        }
        menu.append(sw, btn('', 'Buka di tab baru', () => { void send({ kind: 'slot:open-tab', id: s.id }); close(); }));
        if (s.id !== DEFAULT_SID && s.id !== active) {
          menu.append(btn('danger', 'Hapus (data login ikut dihapus)', () => { void purgeSlotData(s.id); void act({ kind: 'slot:delete', id: s.id }); }));
        }
        pop.append(menu);
      }
    }
    if (editing?.mode === 'new') {
      pop.append(inputRow('', 'Nama akun baru', async (v) => {
        const s = await send<Slot>({ kind: 'slot:create', label: v });
        if (s?.id) switchTo(s.id); else { editing = null; await reload(); }
      }));
      pop.append(el('div', 'hint', 'Tab akan dimuat ulang dan WhatsApp menampilkan QR.'));
    } else {
      pop.append(btn('add', '+ Akun baru', () => { editing = { id: '', mode: 'new' }; menuFor = null; render(); }));
    }
  }

  document.body.append(host);
  slots = [defaultSlot()];
  render();
  void list().then((l) => { slots = l; render(); (pop.querySelector('button.main[aria-current]') as HTMLElement | null)?.focus(); });
}
