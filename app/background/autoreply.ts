import { db } from '../shared/db';
import { phoneFromChatId } from '../shared/crm-logic';
import { normStrategy } from '../shared/rotation';
import { newRule, type ArCtx, type ArMsg, type ArRule } from '../shared/autoreply-types';

export const isArMsg = (m: unknown): m is ArMsg =>
  !!m && typeof (m as { kind?: unknown }).kind === 'string' && (m as { kind: string }).kind.startsWith('ar:');

const LOG_CAP = 2000;

const SAMPLES: Array<Partial<ArRule>> = [
  { name: 'Sapaan pertama', trigger: 'first-message', reply: '{Halo|Hai|Selamat datang} {nama}, terima kasih sudah menghubungi kami. Ada yang bisa kami bantu?', onlyNewLeads: true },
  {
    name: 'Di luar jam kerja', trigger: 'away-hours', schedule: { days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' },
    reply: 'Halo {nama}, saat ini kami sedang di luar jam kerja (Senin-Jumat 09.00-17.00). Pesan Anda sudah kami terima dan akan dibalas besok.',
  },
  { name: 'Harga/Info', trigger: 'keyword', keywords: ['harga', 'price', 'pricelist', 'info', 'katalog'], matchMode: 'regex-safe', reply: 'Halo {nama}, untuk daftar harga dan info produk silakan lihat katalog kami. Kami segera kirimkan detailnya.' },
];

async function ensureSeed(): Promise<void> {
  if (await db.arRules.count()) return;
  const flag = await chrome.storage.local.get('wwt-ar-seeded');
  if (flag['wwt-ar-seeded']) return; // user deleted everything on purpose
  await db.arRules.bulkPut(SAMPLES.map((p, i) => ({ ...newRule(i), ...p, enabled: false })));
  await chrome.storage.local.set({ 'wwt-ar-seeded': true });
}

const sorted = async (): Promise<ArRule[]> => (await db.arRules.toArray()).sort((a, b) => a.order - b.order);

/** Never trust editable-flag fields coming from the UI. */
function sanitize(r: ArRule): ArRule {
  const d = r.delaySec ?? [4, 12];
  return {
    ...r, replyVariants: (r.replyVariants ?? []).filter((v) => typeof v === 'string' && v.trim()).slice(0, 10).map((v) => v.slice(0, 1000)),
    rotation: normStrategy(r.rotation),
    excludeOptOut: true, groups: false, stopAfterHumanReply: true,
    keywords: (r.keywords ?? []).map((k) => k.trim()).filter(Boolean),
    delaySec: [Math.max(0, Number(d[0]) || 0), Math.max(Number(d[0]) || 0, Number(d[1]) || 0)],
    cooldownMin: Math.max(0, Number(r.cooldownMin) || 0),
    maxPerHour: Math.min(60, Math.max(1, Math.round(Number(r.maxPerHour) || 20))),
  };
}

export async function handleAr(m: ArMsg): Promise<unknown> {
  switch (m.kind) {
    case 'ar:rules':
      await ensureSeed();
      return sorted();
    case 'ar:rule:upsert': {
      const prev = await db.arRules.get(m.rule.id);
      const order = prev?.order ?? (m.rule.order > 0 ? m.rule.order : (await db.arRules.count()));
      const r = sanitize({ ...m.rule, order });
      await db.arRules.put(r);
      return r;
    }
    case 'ar:rule:delete':
      await db.arRules.delete(m.id);
      return { ok: true };
    case 'ar:rule:reorder':
      await db.transaction('rw', db.arRules, async () => {
        for (let i = 0; i < m.ids.length; i++) await db.arRules.update(m.ids[i], { order: i });
      });
      return sorted();
    case 'ar:log': {
      await db.arLog.put(m.entry);
      const n = await db.arLog.count();
      if (n > LOG_CAP) {
        const old = await db.arLog.orderBy('ts').limit(n - LOG_CAP).primaryKeys();
        await db.arLog.bulkDelete(old);
      }
      return { ok: true };
    }
    case 'ar:log:list':
      return db.arLog.orderBy('ts').reverse().limit(Math.min(2000, Math.max(1, m.limit ?? 200))).toArray();
    case 'ar:ctx': {
      const [it, c] = await Promise.all([db.interactions.get(m.chatKey), db.contacts.get(m.chatKey)]);
      const ctx: ArCtx = {
        isNewLead: !it || it.firstOutTs == null,
        lastOutTs: it?.lastOutTs ?? null,
        optOut: !!c?.optOut,
        stage: c?.stage ?? '',
        name: c?.name || it?.name || '',
        phone: c?.phone || it?.phone || phoneFromChatId(m.chatKey.slice(m.chatKey.indexOf('|') + 1)),
      };
      return ctx;
    }
  }
}
