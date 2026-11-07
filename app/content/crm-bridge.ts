import type { Contact, CrmMsg, CrmNote, PipelineConfig } from '../shared/crm-types';
import type { ChatInfo } from '../shared/messages';
import { call } from './bridge';
import { ping } from './sync';
import { formatDuration } from '../shared/analytics-logic';
import { INTENT_LABEL, INTEL_NOTE, MOMENTUM_GLYPH, MOMENTUM_LABEL, TEMP_LABEL, type LeadIntel } from '../shared/lead-intel-logic';

const CSS = `
:host{all:initial}
.bar{position:fixed;top:64px;right:12px;z-index:99998;max-width:360px;background:#fff;color:#111;border-radius:8px;padding:6px 8px;font:12px system-ui;box-shadow:0 2px 10px #0004;display:none}
.bar.show{display:block}
.row{display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin:2px 0}
select,input[type=text],input[type=datetime-local]{font:12px system-ui;padding:2px 4px;border:1px solid #bbb;border-radius:4px;max-width:150px}
button{font:12px system-ui;padding:2px 7px;border:1px solid #25d366;background:#fff;border-radius:4px;cursor:pointer}
small{color:#667}
.li{border-bottom:1px solid #ddd;padding-bottom:4px;margin-bottom:4px;display:none}
.li.show{display:block}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;background:#889}
.t-hot{background:#d93025}.t-warm{background:#f29900}.t-cold{background:#3b82f6}.t-dormant{background:#889}
.tb{font-weight:700}
.meter{flex:1;min-width:60px;height:6px;background:#0002;border-radius:3px;overflow:hidden}
.meter>i{display:block;height:100%;background:#25d366}
.chip{background:#0001;border-radius:10px;padding:0 7px}
.mom{font-weight:700}
.next{font-weight:600}
@media (prefers-color-scheme:dark){.li{border-color:#444}.bar{background:#1f2c34;color:#e9edef}select,input{background:#2a3942;color:#e9edef;border-color:#555}button{background:#2a3942;color:#e9edef}}`;

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
  // Lead intelligence strip (all text via textContent; values come from the local background only)
  const li = document.createElement('div'); li.className = 'li';
  const liHead = mkRow();
  const liDot = document.createElement('span'); liDot.className = 'dot';
  const liTemp = document.createElement('span'); liTemp.className = 'tb';
  const liMeter = document.createElement('span'); liMeter.className = 'meter';
  const liFill = document.createElement('i'); liMeter.append(liFill);
  const liScore = document.createElement('small');
  const liMom = document.createElement('span'); liMom.className = 'mom';
  liHead.append(liDot, liTemp, liMeter, liScore, liMom);
  const liLast = mkRow(); const liLastTxt = document.createElement('small'); liLast.append(liLastTxt);
  const liResp = mkRow(); const liRespTxt = document.createElement('small'); liResp.append(liRespTxt);
  const liIntentRow = mkRow(); const liIntent = document.createElement('span'); liIntent.className = 'chip'; liIntent.hidden = true;
  const liPrio = document.createElement('small'); liIntentRow.append(liIntent, liPrio);
  const liNext = mkRow(); const liNextTxt = document.createElement('span'); liNextTxt.className = 'next'; liNext.append(liNextTxt);
  const liNote = document.createElement('small'); liNote.textContent = INTEL_NOTE; liNote.style.display = 'block'; liNote.style.fontSize = '10px';
  li.append(liHead, liLast, liResp, liIntentRow, liNext, liNote);
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
  bar.append(li, r1, r2, r3, r4, status);
  root.append(style, bar);
  document.documentElement.appendChild(host);

  let accountId: string | null = null;
  let chat: ChatInfo | null = null;
  let lastTitle = '';
  let busy = false;
  let timer = 0;

  const say = (s: string) => { status.textContent = s; };
  const dead = () => { try { return !chrome.runtime?.id; } catch { return true; } };
  let intelTimer2 = 0;
  const stop = () => { clearInterval(timer); clearInterval(intelTimer2); host.remove(); };

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

  const PRIO: Record<string, string> = { urgent: 'Mendesak', high: 'Tinggi', normal: 'Normal', low: 'Rendah' };
  function render(x: LeadIntel) {
    liDot.className = `dot t-${x.temperature}`;
    liTemp.textContent = TEMP_LABEL[x.temperature];
    liFill.style.width = `${x.engagement}%`;
    liScore.textContent = `Skor ${x.engagement}/100`;
    liMom.textContent = `${MOMENTUM_GLYPH[x.momentum]} ${MOMENTUM_LABEL[x.momentum]}`;
    const who = x.lastSender === 'in' ? 'Pelanggan' : x.lastSender === 'out' ? 'Kita' : null;
    liLastTxt.textContent = who && x.lastActivityTs ? `Terakhir: ${who}, ${formatDuration(Date.now() - x.lastActivityTs)} lalu` : 'Belum ada aktivitas terlacak';
    const rs = (ms: number | null) => (ms == null ? '-' : formatDuration(ms));
    liRespTxt.textContent = `Respon kita ${rs(x.ourAvgResponseMs)} | respon mereka ${rs(x.theirAvgResponseMs)} | ${x.totalMsgs} pesan (${x.msgs7d} dlm 7 hr)`;
    liIntent.hidden = !x.intent;
    liIntent.textContent = x.intent ? `Intent: ${INTENT_LABEL[x.intent]}` : '';
    liPrio.textContent = `Follow-up ${PRIO[x.followUpPriority]}: ${x.reason}`;
    liNextTxt.textContent = `Saran: ${x.nextAction}`;
    li.classList.add('show');
  }

  /** Best-effort text of the latest incoming message; sent transiently for keyword intent, never stored. */
  function lastIncomingText(): string | undefined {
    try {
      const nodes = document.querySelectorAll<HTMLElement>('#main div.message-in span.selectable-text');
      const t = nodes[nodes.length - 1]?.innerText?.trim();
      return t ? t.slice(0, 500) : undefined;
    } catch { return undefined; }
  }

  async function refreshIntel() {
    if (!chat || !accountId) { li.classList.remove('show'); return; }
    try {
      const x = await send<LeadIntel | { error: string } | null>({ kind: 'li:get', accountId, chatId: chat.id, snippet: lastIncomingText() } as never);
      if (x && !('error' in x)) render(x); else li.classList.remove('show');
    } catch { li.classList.remove('show'); }
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
      void refreshIntel();
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
  intelTimer2 = window.setInterval(() => { if (dead()) return stop(); void refreshIntel(); }, 30_000);
  void tick();
}
