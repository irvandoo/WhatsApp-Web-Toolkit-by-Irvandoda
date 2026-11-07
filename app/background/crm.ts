import { db } from '../shared/db';
import { DEFAULT_STAGES, type Contact, type CrmMsg } from '../shared/crm-types';
import { csvFromRows, normalizeStages, phoneFromChatId, remapStage } from '../shared/crm-logic';

export const isCrmMsg = (m: unknown): m is CrmMsg =>
  !!m && typeof (m as { kind?: unknown }).kind === 'string' && (m as { kind: string }).kind.startsWith('crm:');

const uid = () => crypto.randomUUID();

async function getStages(): Promise<string[]> {
  const p = await db.pipeline.get('default');
  return p?.stages?.length ? p.stages : [...DEFAULT_STAGES];
}

export async function handleCrm(m: CrmMsg): Promise<unknown> {
  switch (m.kind) {
    case 'crm:contact:upsert': {
      const c = m.contact;
      const key = `${c.accountId}|${c.chatId}`;
      const stages = await getStages();
      const now = Date.now();
      const prev = await db.contacts.get(key);
      const merged: Contact = {
        key,
        accountId: c.accountId,
        chatId: c.chatId,
        name: c.name ?? prev?.name ?? '',
        phone: c.phone ?? prev?.phone ?? phoneFromChatId(c.chatId),
        stage: remapStage(c.stage ?? prev?.stage ?? stages[0], stages),
        tags: c.tags ?? prev?.tags ?? [],
        value: c.value ?? prev?.value ?? 0,
        assignee: c.assignee ?? prev?.assignee ?? '',
        optOut: c.optOut ?? prev?.optOut ?? false,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        lastContactAt: c.lastContactAt !== undefined ? c.lastContactAt : (prev?.lastContactAt ?? null),
      };
      await db.contacts.put(merged);
      return merged;
    }
    case 'crm:contact:list':
      return m.accountId ? db.contacts.where('accountId').equals(m.accountId).toArray() : db.contacts.toArray();
    case 'crm:contact:delete':
      await db.transaction('rw', db.contacts, db.notes, db.reminders, async () => {
        await db.notes.where('contactKey').equals(m.key).delete();
        await db.reminders.where('contactKey').equals(m.key).delete();
        await db.contacts.delete(m.key);
      });
      return { ok: true };
    case 'crm:note:add': {
      const n = { id: uid(), contactKey: m.contactKey, text: m.text, createdAt: Date.now() };
      await db.notes.put(n);
      return n;
    }
    case 'crm:note:list':
      return (await db.notes.where('contactKey').equals(m.contactKey).toArray()).sort((a, b) => b.createdAt - a.createdAt);
    case 'crm:note:delete':
      await db.notes.delete(m.id);
      return { ok: true };
    case 'crm:reminder:add': {
      const r = { id: uid(), contactKey: m.contactKey, text: m.text, dueAt: m.dueAt, done: false, notified: false };
      await db.reminders.put(r);
      return r;
    }
    case 'crm:reminder:list': {
      const all = await db.reminders.toArray();
      return all.filter((r) => !m.onlyOpen || !r.done).sort((a, b) => a.dueAt - b.dueAt);
    }
    case 'crm:reminder:done':
      await db.reminders.update(m.id, { done: true });
      return { ok: true };
    case 'crm:pipeline:get':
      return { id: 'default', stages: await getStages() };
    case 'crm:pipeline:set': {
      const stages = normalizeStages(m.stages);
      if (!stages) return { ok: false, error: 'Tahap harus 2-12 nama unik dan tidak kosong.' };
      await db.transaction('rw', db.pipeline, db.contacts, async () => {
        await db.pipeline.put({ id: 'default', stages });
        const all = await db.contacts.toArray();
        const now = Date.now();
        for (const c of all) {
          const s = remapStage(c.stage, stages);
          if (s !== c.stage) await db.contacts.update(c.key, { stage: s, updatedAt: now });
        }
      });
      return { ok: true, stages };
    }
    case 'crm:export': {
      const contacts = await db.contacts.toArray();
      if (m.format === 'json') {
        const [notes, reminders, stages] = await Promise.all([db.notes.toArray(), db.reminders.toArray(), getStages()]);
        return { format: 'json', data: JSON.stringify({ stages, contacts, notes, reminders }, null, 2) };
      }
      const header = ['akun', 'chat_id', 'nama', 'telepon', 'tahap', 'tag', 'nilai', 'penanggung_jawab', 'opt_out', 'dibuat', 'diperbarui', 'kontak_terakhir'];
      const iso = (t: number | null) => (t ? new Date(t).toISOString() : '');
      const rows = contacts.map((c) => [c.accountId, c.chatId, c.name, c.phone, c.stage, c.tags.join(';'), c.value, c.assignee, c.optOut ? 'ya' : 'tidak', iso(c.createdAt), iso(c.updatedAt), iso(c.lastContactAt)]);
      return { format: 'csv', data: csvFromRows(header, rows) };
    }
    default:
      return { ok: false, error: 'unknown' };
  }
}

/** Needs "alarms" + "notifications" permissions. */
export function registerCrmAlarms(): void {
  void chrome.alarms.create('crm-reminders', { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener(async (a) => {
    if (a.name !== 'crm-reminders') return;
    const now = Date.now();
    const due = await db.reminders.where('dueAt').belowOrEqual(now).filter((r) => !r.done && !r.notified).toArray();
    for (const r of due) {
      const c = await db.contacts.get(r.contactKey);
      try {
        chrome.notifications.create(`crm-${r.id}`, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('public/icons/icon128.png'),
          title: `Pengingat: ${c?.name || c?.phone || 'Kontak'}`,
          message: r.text || 'Waktunya follow up.',
        });
      } catch { /* ignore */ }
      await db.reminders.update(r.id, { notified: true });
    }
  });
}
