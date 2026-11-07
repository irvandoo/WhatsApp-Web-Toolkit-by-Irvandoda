import type { Contact, CrmMsg, CrmNote, PipelineConfig } from '../shared/crm-types';
import type { ChatInfo } from '../shared/messages';
import { call } from './bridge';
import { ping } from './sync';

const CSS = `
:host{all:initial}
.bar{position:fixed;top:64px;right:12px;z-index:99998;max-width:360px;background:#fff;color:#111;border-radius:8px;padding:6px 8px;font:12px system-ui;box-shadow:0 2px 10px #0004;display:none}
.bar.show{display:block}
.row{display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin:2px 0}
select,input[type=text],input[type=datetime-local]{font:12px system-ui;padding:2px 4px;border:1px solid #bbb;border-radius:4px;max-width:150px}
button{font:12px system-ui;padding:2px 7px;border:1px solid #25d366;background:#fff;border-radius:4px;cursor:pointer}
small{color:#667}
@media (prefers-color-scheme:dark){.bar{background:#1f2c34;color:#e9edef}select,input{background:#2a3942;color:#e9edef;border-color:#555}button{background:#2a3942;color:#e9edef}}`;

const send = <T>(m: CrmMsg): Promise<T> => chrome.runtime.sendMessage(m) as Promise<T>;

export function mountCrmChatBar(): void {
  if (document.getElementById('wwt-crm')) return;
  const host = document.createElement('div');
  host.id = 'wwt-crm';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const bar = document.createElement('div');
  bar.className = 'bar';

  const mkRow = () => { const r = document.createElement('div'); r.className = 'row'; return r; };
  const mkBtn = (t: string) => { const b = document.createElement('button'); b.textContent = t; return b; };
  const stageSel = document.createElement('select');
  const tags = document.createElement('input'); tags.type = 'text'; tags.placeholder = 'tag, tag';
  const optLbl = document.createElement('label');
  const opt = document.createElement('input'); opt.type = 'checkbox';
  optLbl.append(opt, document.createTextNode(' Jangan hubungi'));
  const r1 = mkRow(); r1.append(stageSel, tags);
  const noteIn = document.createElement('input'); noteIn.type = 'text'; noteIn.placeholder = 'Catatan';
  const noteBtn = mkBtn('+ Catatan');
  const r2 = mkRow(); r2.append(noteIn, noteBtn);
  const remText = document.createElement('input'); remText.type = 'text'; remText.placeholder = 'Pengingat';
  const remAt = document.createElement('input'); remAt.type = 'datetime-local';
  const remBtn = mkBtn('+ Pengingat');
  const r3 = mkRow(); r3.append(remText, remAt, remBtn);
  const r4 = mkRow(); r4.append(optLbl);
  const status = document.createElement('small');
  bar.append(r1, r2, r3, r4, status);
  root.append(style, bar);
  document.documentElement.appendChild(host);

  let accountId: string | null = null;
  let chat: ChatInfo | null = null;
  let lastTitle = '';
  let busy = false;
  let timer = 0;

  const say = (s: string) => { status.textContent = s; };
  const dead = () => { try { return !chrome.runtime?.id; } catch { return true; } };
  const stop = () => { clearInterval(timer); host.remove(); };

  async function save(patch: Partial<Contact>) {
    if (!chat || !accountId) return;
    try {
      await send({ kind: 'crm:contact:upsert', contact: { accountId, chatId: chat.id, name: chat.name, ...patch } });
      say('Tersimpan');
    } catch { say('Gagal menyimpan'); }
  }

  async function load() {
    if (!chat || !accountId) return;
    const [pl, list] = await Promise.all([
      send<PipelineConfig>({ kind: 'crm:pipeline:get' }),
      send<Contact[]>({ kind: 'crm:contact:list', accountId }),
    ]);
    const c = list.find((x) => x.chatId === chat!.id);
    stageSel.replaceChildren(...pl.stages.map((s) => { const o = document.createElement('option'); o.value = o.textContent = s; return o; }));
    stageSel.value = c?.stage ?? pl.stages[0];
    tags.value = (c?.tags ?? []).join(', ');
    opt.checked = c?.optOut ?? false;
    say(c ? '' : 'Belum disimpan di CRM');
  }

  async function tick() {
    if (busy) return;
    if (dead()) return stop();
    const title = document.querySelector<HTMLElement>('#main header span[title]')?.title ?? '';
    if (title === lastTitle) return;
    lastTitle = title;
    if (!title) { chat = null; bar.classList.remove('show'); return; }
    busy = true;
    try {
      accountId ??= (await ping()).accountId;
      const chats = await call<ChatInfo[]>({ type: 'chats:list' });
      chat = chats.find((c) => c.name === title) ?? null;
      if (!chat || !accountId) { bar.classList.remove('show'); lastTitle = ''; return; }
      await load();
      bar.classList.add('show');
    } catch (e) {
      lastTitle = '';
      if (dead()) stop();
    } finally { busy = false; }
  }

  stageSel.addEventListener('change', () => void save({ stage: stageSel.value }));
  tags.addEventListener('change', () => void save({ tags: [...new Set(tags.value.split(',').map((t) => t.trim()).filter(Boolean))] }));
  opt.addEventListener('change', () => void save({ optOut: opt.checked }));
  noteBtn.addEventListener('click', async () => {
    const text = noteIn.value.trim();
    if (!text || !chat || !accountId) return;
    try {
      await save({});
      await send<CrmNote>({ kind: 'crm:note:add', contactKey: `${accountId}|${chat.id}`, text });
      noteIn.value = ''; say('Catatan ditambahkan');
    } catch { say('Gagal'); }
  });
  remBtn.addEventListener('click', async () => {
    const dueAt = remAt.valueAsNumber ? new Date(remAt.value).getTime() : NaN;
    if (!chat || !accountId || !Number.isFinite(dueAt)) return say('Pilih waktu pengingat');
    try {
      await save({});
      await send({ kind: 'crm:reminder:add', contactKey: `${accountId}|${chat.id}`, text: remText.value.trim() || `Follow up ${chat.name}`, dueAt });
      remText.value = ''; remAt.value = ''; say('Pengingat ditambahkan');
    } catch { say('Gagal'); }
  });

  timer = window.setInterval(() => void tick(), 1500);
  void tick();
}
