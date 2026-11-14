import { db } from '../shared/db';
import { isValidMedia } from '../shared/image-logic';
import { IS_FULL } from '../shared/credit';
import {
  MAX_LATE_MS, assertSendable, autoSentTimes, bumpAfterSend, computeNextRun, nextSendable, normalizePhone, normalizeSafety,
  optOutPhoneSet, planCampaign, retryPlan, shouldAutoPause, validateSchedule,
} from '../shared/outbox-logic';
import type { Campaign, NextItem, ObMsg, OutboxItem, Schedule, SendLogEntry, SendMode } from '../shared/outbox-types';

export const isOutboxMsg = (m: unknown): m is ObMsg =>
  !!m && typeof (m as { kind?: unknown }).kind === 'string' && (m as { kind: string }).kind.startsWith('ob:');

const uid = () => crypto.randomUUID();
const KILL_KEY = 'ob:kill';
const RESUME_KEY = 'ob:resumeAt';
const STALE_SENDING_MS = 3 * 60_000;
const LOG_KEEP_MS = 365 * 86_400_000;
const mode = (): SendMode => (IS_FULL ? 'auto' : 'draft');

// ---------- tiny mutex: ob:next / ob:result / tick must not interleave ----------
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

// ---------- storage helpers ----------
async function getNum(key: string): Promise<number> {
  try { const r = await chrome.storage.local.get(key); return Number(r[key]) || 0; } catch { return 0; }
}
async function isKilled(): Promise<boolean> {
  try { const r = await chrome.storage.local.get(KILL_KEY); return !!r[KILL_KEY]; } catch { return false; }
}

function notify(id: string, title: string, message: string): void {
  try {
    chrome.notifications.create(id, { type: 'basic', iconUrl: chrome.runtime.getURL('public/icons/icon128.png'), title, message });
  } catch { /* ignore */ }
}

/** Recent log (for caps) plus the earliest automatic send (for warm-up day counting). */
async function loadLog(now: number): Promise<SendLogEntry[]> {
  const recent = await db.sendLog.where('ts').aboveOrEqual(now - 2 * 86_400_000).toArray();
  const all = await db.sendLog.orderBy('ts').filter((e) => e.status === 'sent' && e.mode === 'auto').first();
  return all && !recent.some((e) => e.id === all.id) ? [all, ...recent] : recent;
}

async function logEntry(item: OutboxItem, status: SendLogEntry['status'], m: SendMode, error?: string, countable?: boolean): Promise<void> {
  await db.sendLog.put({ id: uid(), ts: Date.now(), campaignId: item.campaignId, itemId: item.id, phone: item.phone, status, mode: m, error, countable });
}

/** running -> done once nothing is pending/sending. */
async function refreshCampaign(id: string): Promise<void> {
  const c = await db.campaigns.get(id);
  if (!c || c.status !== 'running') return;
  const open = await db.outbox.where('campaignId').equals(id).filter((i) => i.status === 'pending' || i.status === 'sending').count();
  if (!open) await db.campaigns.update(id, { status: 'done', doneAt: Date.now() });
}

async function pauseAllRunning(reason: string): Promise<void> {
  const running = await db.campaigns.where('status').equals('running').toArray();
  for (const c of running) await db.campaigns.update(c.id, { status: 'paused', pausedReason: reason });
}

async function failItem(item: OutboxItem, error: string, permanent: boolean, m: SendMode): Promise<void> {
  const now = Date.now();
  const plan = retryPlan(item, permanent, now);
  if (plan.status === 'pending') await db.outbox.update(item.id, { status: 'pending', attempts: plan.attempts, dueAt: plan.dueAt, error, sendingAt: undefined });
  else await db.outbox.update(item.id, { status: 'failed', attempts: plan.attempts, error, sendingAt: undefined });
  await logEntry(item, 'failed', m, error, !permanent);
  if (m === 'auto' && !permanent) {
    const c = await db.campaigns.get(item.campaignId);
    const since = await getNum(RESUME_KEY);
    const log = (await db.sendLog.where('ts').aboveOrEqual(now - 86_400_000).toArray()).filter((e) => e.ts >= since);
    if (shouldAutoPause(log, c?.safety.pauseAfterErrors ?? 3)) {
      await pauseAllRunning('Dijeda otomatis: error kirim berturut-turut');
      notify('ob-autopause', 'Pengiriman dijeda otomatis', 'Beberapa pengiriman gagal berturut-turut. Periksa WhatsApp Web lalu lanjutkan dari halaman Blast.');
    }
  }
  await refreshCampaign(item.campaignId);
}

// ---------- schedules ----------
async function materialize(now: number): Promise<number> {
  const due = await db.schedules.where('nextRunAt').belowOrEqual(now).filter((s) => s.enabled && s.nextRunAt != null).toArray();
  if (!due.length) return 0;
  const contacts = await db.contacts.toArray();
  const optOut = optOutPhoneSet(contacts);
  const log = await loadLog(now);
  let n = 0;
  for (const s of due) {
    const runAt = s.nextRunAt as number;
    const next = computeNextRun(s.recurrence, Math.max(now, runAt));
    const patch: Partial<Schedule> = { lastRunAt: now, nextRunAt: next, enabled: next != null };
    const cid = `sch-${s.id}-${runAt}`;
    if (!(await db.campaigns.get(cid))) {
      const late = now - runAt > MAX_LATE_MS;
      if (late) {
        await db.sendLog.put({ id: uid(), ts: now, campaignId: cid, itemId: '-', phone: s.target.phone, status: 'skipped', mode: mode(), error: 'Jadwal terlewat (lebih dari 12 jam)' });
      } else {
        const contact = s.target.contactKey ? contacts.find((c) => c.key === s.target.contactKey) : undefined;
        const plan = planCampaign({
          id: cid, name: s.name, template: s.text, source: s.reminderId ? 'reminder' : 'schedule',
          recipients: [{ phone: s.target.phone, name: s.target.name || contact?.name, contactKey: s.target.contactKey, stage: contact?.stage }],
          safety: s.safety, optInConfirmed: s.optInConfirmed, startAt: now, now, history: autoSentTimes(log), optOutPhones: optOut,
          mode: mode(), accountId: s.accountId, scheduleId: s.id,
        });
        if (plan.ok && plan.campaign) {
          await db.transaction('rw', db.campaigns, db.outbox, async () => { await db.campaigns.put(plan.campaign!); await db.outbox.bulkPut(plan.items); });
          n++;
        } else {
          await db.sendLog.put({ id: uid(), ts: now, campaignId: cid, itemId: '-', phone: s.target.phone, status: 'skipped', mode: mode(), error: plan.skipped[0]?.reason ?? plan.errors[0] });
        }
      }
    }
    await db.schedules.update(s.id, patch);
  }
  return n;
}

async function tick(): Promise<void> {
  const now = Date.now();
  await materialize(now);
  // stale 'sending' (tab closed mid-send): treat as transient failure
  const stale = await db.outbox.where('status').equals('sending').filter((i) => (i.sendingAt ?? 0) < now - STALE_SENDING_MS).toArray();
  for (const it of stale) await failItem(it, 'Waktu pengiriman habis', false, 'auto');
  if (!IS_FULL) {
    // store flavor: nothing is sent automatically; tell the user which drafts are due
    const dueItems = await db.outbox.where('[status+dueAt]').between(['pending', 0], ['pending', now], true, true).filter((i) => !i.notified).toArray();
    if (dueItems.length) {
      const running = new Set((await db.campaigns.where('status').equals('running').toArray()).map((c) => c.id));
      const mine = dueItems.filter((i) => running.has(i.campaignId));
      if (mine.length) {
        notify('ob-due', `${mine.length} pesan siap dikirim manual`, 'Buka WhatsApp Web: pesan akan disiapkan, Anda yang menekan Kirim.');
        await db.outbox.bulkPut(mine.map((i) => ({ ...i, notified: true })));
      }
    }
  }
  const running = await db.campaigns.where('status').equals('running').toArray();
  for (const c of running) await refreshCampaign(c.id);
  await db.sendLog.where('ts').below(now - LOG_KEEP_MS).delete();
}

/** Needs "alarms" + "notifications" permissions. */
export function registerOutboxAlarms(): void {
  void chrome.alarms.create('outbox-tick', { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === 'outbox-tick') void locked(tick).catch(() => undefined);
  });
}

// ---------- message handler ----------
export async function handleOutbox(m: ObMsg): Promise<unknown> {
  switch (m.kind) {
    case 'ob:campaign:create': {
      const now = Date.now();
      const contacts = await db.contacts.toArray();
      const plan = planCampaign({
        ...m.input, id: uid(), now, history: autoSentTimes(await loadLog(now)), optOutPhones: optOutPhoneSet(contacts), mode: mode(),
        akun: (m.input.accountId && (await db.accounts.get(m.input.accountId))?.name) || undefined,
      });
      if (!plan.ok || !plan.campaign) return { ok: false, errors: plan.errors, skipped: plan.skipped };
      const media = m.input.media;
      await db.transaction('rw', db.campaigns, db.outbox, db.campaignMedia, async () => {
        await db.campaigns.put(plan.campaign!); await db.outbox.bulkPut(plan.items);
        if (media) await db.campaignMedia.put({ ...media, id: plan.campaign!.id });
      });
      return { ok: true, campaign: plan.campaign, skipped: plan.skipped, endAt: plan.endAt, mode: mode() };
    }
    case 'ob:campaign:list':
      return (await db.campaigns.toArray()).sort((a, b) => b.createdAt - a.createdAt);
    case 'ob:campaign:update': {
      const c = await db.campaigns.get(m.id);
      if (!c) return { ok: false, error: 'Kampanye tidak ditemukan' };
      const patch: Partial<Campaign> = {};
      if (m.patch.name?.trim()) patch.name = m.patch.name.trim();
      if (m.patch.safety) patch.safety = normalizeSafety({ ...c.safety, ...m.patch.safety });
      await db.campaigns.update(m.id, patch);
      return { ok: true };
    }
    case 'ob:campaign:pause':
      await db.campaigns.update(m.id, { status: 'paused', pausedReason: 'Dijeda pengguna' });
      return { ok: true };
    case 'ob:campaign:resume': {
      return locked(async () => {
        const c = await db.campaigns.get(m.id);
        if (!c || c.status === 'done' || c.status === 'stopped') return { ok: false, error: 'Kampanye sudah selesai/dihentikan' };
        if (await isKilled()) return { ok: false, error: 'Stop global aktif. Nonaktifkan dulu di bagian atas.' };
        const now = Date.now();
        await chrome.storage.local.set({ [RESUME_KEY]: now });
        const pending = await db.outbox.where('campaignId').equals(m.id).filter((i) => i.status === 'pending').toArray();
        for (const b of bumpAfterSend(pending, c.safety, now)) await db.outbox.update(b.id, { dueAt: b.dueAt });
        await db.campaigns.update(m.id, { status: 'running', pausedReason: undefined });
        return { ok: true };
      });
    }
    case 'ob:campaign:stop': {
      const items = await db.outbox.where('campaignId').equals(m.id).filter((i) => i.status === 'pending' || i.status === 'sending').toArray();
      await db.outbox.bulkPut(items.map((i) => ({ ...i, status: 'cancelled' as const })));
      await db.campaigns.update(m.id, { status: 'stopped', doneAt: Date.now() });
      return { ok: true };
    }
    case 'ob:campaign:delete':
      await db.transaction('rw', db.campaigns, db.outbox, db.campaignMedia, async () => {
        await db.outbox.where('campaignId').equals(m.id).delete();
        await db.campaigns.delete(m.id);
        await db.campaignMedia.delete(m.id);
      });
      return { ok: true };
    case 'ob:media:get': {
      const md = await db.campaignMedia.get(m.campaignId);
      return md && isValidMedia(md) ? { ok: true, media: { name: md.name, mime: md.mime, bytes: md.bytes, dataUrl: md.dataUrl } } : { ok: false, error: 'media-missing' };
    }
    case 'ob:items:list':
      return (await db.outbox.where('campaignId').equals(m.campaignId).toArray()).sort((a, b) => a.dueAt - b.dueAt);

    case 'ob:schedule:upsert': {
      const now = Date.now();
      const s0 = m.schedule;
      const phone = normalizePhone(s0.target?.phone ?? '') ?? '';
      const prev = await db.schedules.get(s0.id);
      const s: Schedule = {
        ...s0, id: s0.id || uid(), name: (s0.name ?? '').trim(), text: s0.text ?? '', target: { ...s0.target, phone },
        safety: s0.safety ? normalizeSafety(s0.safety) : undefined, createdAt: prev?.createdAt ?? now, nextRunAt: null,
      };
      const errors = validateSchedule(s);
      if (errors.length) return { ok: false, errors };
      s.nextRunAt = computeNextRun(s.recurrence, now);
      if (s.nextRunAt == null) return { ok: false, errors: ['Waktu jadwal sudah lewat atau tidak valid.'] };
      await db.schedules.put(s);
      return { ok: true, schedule: s };
    }
    case 'ob:schedule:list':
      return (await db.schedules.toArray()).sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity));
    case 'ob:schedule:delete':
      await db.schedules.delete(m.id);
      return { ok: true };
    case 'ob:schedule:toggle': {
      const s = await db.schedules.get(m.id);
      if (!s) return { ok: false, error: 'Jadwal tidak ditemukan' };
      if (!m.enabled) { await db.schedules.update(m.id, { enabled: false }); return { ok: true }; }
      const next = computeNextRun(s.recurrence, Date.now());
      if (next == null) return { ok: false, error: 'Waktu jadwal sudah lewat. Edit waktunya dulu.' };
      await db.schedules.update(m.id, { enabled: true, nextRunAt: next });
      return { ok: true };
    }

    case 'ob:next':
      return locked(async (): Promise<NextItem> => {
        const now = Date.now();
        const killed = await isKilled();
        if (killed) return { item: null, reason: 'Dihentikan (Stop global)' };
        const [campaigns, items, contacts, log] = await Promise.all([
          db.campaigns.where('status').equals('running').toArray(),
          db.outbox.where('status').equals('pending').toArray(),
          db.contacts.toArray(),
          loadLog(now),
        ]);
        if (!campaigns.length) return { item: null, reason: 'Tidak ada kampanye berjalan' };
        const auto = IS_FULL;
        const r = nextSendable(items, now, { campaigns, log, auto, killed, optOutPhones: optOutPhoneSet(contacts), accountId: m.accountId });
        if (!r.item) return { item: null, reason: r.reason };
        // final guard, independent of nextSendable
        const bad = assertSendable(r.item, r.campaign, optOutPhoneSet(contacts));
        if (bad) {
          await db.outbox.update(r.item.id, { status: 'skipped', error: bad });
          await logEntry(r.item, 'skipped', auto ? 'auto' : 'draft', bad);
          await refreshCampaign(r.item.campaignId);
          return { item: null, reason: bad };
        }
        const chatId = `${r.item.phone}@c.us`;
        if (auto) {
          const upd = { status: 'sending' as const, sendingAt: now, chatId };
          await db.outbox.update(r.item.id, upd);
          return { item: { ...r.item, ...upd }, campaign: r.campaign, mode: 'auto' };
        }
        const upd = { status: 'draft' as const, notified: true, chatId };
        await db.outbox.update(r.item.id, upd);
        await logEntry(r.item, 'draft', 'draft');
        await refreshCampaign(r.item.campaignId);
        return { item: { ...r.item, ...upd }, campaign: r.campaign, mode: 'draft' };
      });

    case 'ob:result':
      return locked(async () => {
        const item = await db.outbox.get(m.itemId);
        if (!item) return { ok: false, error: 'Item tidak ditemukan' };
        const now = Date.now();
        if (item.status === 'draft') {
          // store flavor: user confirms they sent it manually (or marks it failed)
          if (m.status === 'sent') {
            await db.outbox.update(item.id, { status: 'sent', sentAt: now });
            await logEntry(item, 'sent', 'draft');
          } else await db.outbox.update(item.id, { status: 'failed', error: m.error ?? 'Tidak dikirim' });
          return { ok: true };
        }
        if (item.status !== 'sending') return { ok: false, error: 'Item tidak sedang dikirim' };
        if (m.status === 'sent') {
          await db.outbox.update(item.id, { status: 'sent', sentAt: now, sendingAt: undefined, error: undefined, chatId: m.chatId ?? item.chatId });
          await logEntry(item, 'sent', 'auto');
          const c = await db.campaigns.get(item.campaignId);
          if (c) {
            const pending = await db.outbox.where('campaignId').equals(c.id).filter((i) => i.status === 'pending').toArray();
            for (const b of bumpAfterSend(pending, c.safety, now)) await db.outbox.update(b.id, { dueAt: b.dueAt });
          }
          await refreshCampaign(item.campaignId);
        } else {
          await failItem(item, m.error ?? 'Gagal mengirim', !!m.permanent, 'auto');
        }
        return { ok: true };
      });

    case 'ob:log:list': {
      let q = db.sendLog.orderBy('ts').reverse();
      if (m.campaignId) q = q.filter((e) => e.campaignId === m.campaignId);
      return q.limit(Math.min(m.limit ?? 500, 5000)).toArray();
    }

    case 'ob:kill': {
      if (m.on === undefined) return { killed: await isKilled() };
      return locked(async () => {
        await chrome.storage.local.set({ [KILL_KEY]: !!m.on });
        if (m.on) {
          await pauseAllRunning('Stop global');
          const sending = await db.outbox.where('status').equals('sending').toArray();
          await db.outbox.bulkPut(sending.map((i) => ({ ...i, status: 'pending' as const, sendingAt: undefined })));
        }
        return { killed: !!m.on };
      });
    }

    case 'ob:reminder:send': {
      const rem = await db.reminders.get(m.reminderId);
      if (!rem) return { ok: false, errors: ['Pengingat tidak ditemukan'] };
      const contact = await db.contacts.get(rem.contactKey);
      if (!contact) return { ok: false, errors: ['Kontak pengingat tidak ditemukan'] };
      if (contact.optOut) return { ok: false, errors: ['Kontak ini opt-out di CRM.'] };
      const phone = normalizePhone(contact.phone);
      if (!phone || contact.chatId.endsWith('@g.us')) return { ok: false, errors: ['Kontak tidak punya nomor pribadi yang valid.'] };
      const now = Date.now();
      const schedule: Schedule = {
        id: `rem-${rem.id}`, name: `Pengingat: ${contact.name || phone}`, enabled: true, target: { phone, name: contact.name || undefined, contactKey: contact.key },
        text: m.text, recurrence: { type: 'none', at: Math.max(rem.dueAt, now + 60_000) }, nextRunAt: null, optInConfirmed: m.optInConfirmed,
        reminderId: rem.id, accountId: contact.accountId, createdAt: now,
      };
      return handleOutbox({ kind: 'ob:schedule:upsert', schedule });
    }
    default:
      return { ok: false, error: 'unknown' };
  }
}
