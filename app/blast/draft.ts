import { normalizeSafety } from '../shared/outbox-logic';
import { isValidMedia } from '../shared/image-logic';
import type { CampaignSource, MediaInput, Recipient, SafetySettings, Schedule } from '../shared/outbox-types';

/**
 * Work-in-progress of the Blast page, kept in chrome.storage.local (on this PC, in the browser profile) so a refresh of the
 * WhatsApp tab / the page, closing the overlay or switching tabs never loses what was being typed. Only the "Data" tab
 * (Bersihkan) or a successfully started campaign removes it.
 */
export const DRAFT_KEY = 'wwt-blast-draft';
const MAX_RECIPIENTS = 20_000;
const SOURCES: CampaignSource[] = ['csv', 'crm', 'mix', 'schedule', 'reminder'];

export interface WizardDraft {
  step: number;
  name: string;
  body: string;
  safety: SafetySettings;
  optIn: boolean;
  later: boolean;
  startLocal: string;
  recipients: Recipient[];
  source: CampaignSource;
  allowDuplicates?: boolean;
  media?: MediaInput;
}
export interface BlastDraft { v: 1; savedAt: number; tab?: string; wizard?: WizardDraft; schedule?: Schedule }

// Writes are merged and debounced; one chain so parts saved by different components never overwrite each other.
let pending: Partial<BlastDraft> = {};
let timer: ReturnType<typeof setTimeout> | undefined;
let chain: Promise<void> = Promise.resolve();

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

function cleanRecipients(v: unknown): Recipient[] {
  if (!Array.isArray(v)) return [];
  const out: Recipient[] = [];
  for (const r of v.slice(0, MAX_RECIPIENTS)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.phone !== 'string' || !/^\d{8,15}$/.test(o.phone)) continue;
    const rec: Recipient = { phone: o.phone };
    if (typeof o.name === 'string') rec.name = o.name.slice(0, 120);
    if (typeof o.contactKey === 'string') rec.contactKey = o.contactKey.slice(0, 200);
    if (typeof o.stage === 'string') rec.stage = o.stage.slice(0, 80);
    if (o.vars && typeof o.vars === 'object') {
      const vars: Record<string, string> = {};
      for (const [k, x] of Object.entries(o.vars as Record<string, unknown>).slice(0, 30)) if (typeof x === 'string') vars[k.slice(0, 40)] = x.slice(0, 400);
      rec.vars = vars;
    }
    out.push(rec);
  }
  return out;
}

/** Defensive parse of the stored draft (missing, corrupt, or from another version -> null). */
export function sanitizeDraft(raw: unknown): BlastDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  const out: BlastDraft = { v: 1, savedAt: typeof o.savedAt === 'number' && Number.isFinite(o.savedAt) ? o.savedAt : 0 };
  if (typeof o.tab === 'string') out.tab = o.tab.slice(0, 20);
  const w = o.wizard as Record<string, unknown> | undefined;
  if (w && typeof w === 'object') {
    out.wizard = {
      step: Math.min(4, Math.max(1, Math.round(Number(w.step)) || 1)),
      name: str(w.name, 120), body: str(w.body, 8000),
      safety: normalizeSafety((w.safety && typeof w.safety === 'object' ? w.safety : {}) as Partial<SafetySettings>),
      optIn: w.optIn === true, later: w.later === true, startLocal: str(w.startLocal, 20),
      recipients: cleanRecipients(w.recipients),
      source: SOURCES.includes(w.source as CampaignSource) ? (w.source as CampaignSource) : 'csv',
      allowDuplicates: w.allowDuplicates === true,
    };
    const md = w.media as Record<string, unknown> | undefined;
    if (md && typeof md === 'object') {
      const media: MediaInput = { name: str(md.name, 120) || 'gambar', mime: str(md.mime, 20), bytes: Number(md.bytes) || 0, dataUrl: typeof md.dataUrl === 'string' ? md.dataUrl : '' };
      if (isValidMedia(media)) out.wizard.media = media;
    }
  }
  const s = o.schedule as Record<string, unknown> | undefined;
  if (s && typeof s === 'object' && typeof s.id === 'string' && s.recurrence && typeof s.recurrence === 'object' && s.target && typeof s.target === 'object') {
    out.schedule = s as unknown as Schedule;
  }
  return out;
}

/** True when the draft holds anything worth restoring (nothing typed yet = nothing to announce). */
export function hasContent(d: BlastDraft | null): boolean {
  const w = d?.wizard;
  return !!w && (w.recipients.length > 0 || !!w.name.trim() || !!w.body.trim() || !!w.media);
}

export async function loadDraft(): Promise<BlastDraft | null> {
  await chain.catch(() => undefined); // never read before a pending write has landed
  try { return sanitizeDraft((await chrome.storage.local.get(DRAFT_KEY))[DRAFT_KEY]); } catch { return null; }
}


async function flush(): Promise<void> {
  const part = pending;
  pending = {};
  timer = undefined;
  chain = chain.then(async () => {
    try {
      const cur = (await loadDraft()) ?? { v: 1 as const, savedAt: 0 };
      await chrome.storage.local.set({ [DRAFT_KEY]: { ...cur, ...part, v: 1, savedAt: Date.now() } });
    } catch { /* storage unavailable: draft is best-effort */ }
  });
  await chain;
}

/** Save one part of the draft (debounced ~400 ms). Pass `undefined` for a part to drop it. */
export function saveDraftPart(part: Partial<BlastDraft>): void {
  pending = { ...pending, ...part };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void flush(); }, 400);
}

export async function clearDraft(): Promise<void> {
  pending = {};
  if (timer) { clearTimeout(timer); timer = undefined; }
  chain = chain.then(async () => { try { await chrome.storage.local.remove(DRAFT_KEY); } catch { /* ignore */ } });
  await chain;
}

/** Write whatever is pending right now (used when a component unmounts, e.g. on tab switch). */
export function flushDraftNow(): Promise<void> {
  if (timer) clearTimeout(timer);
  return Object.keys(pending).length ? flush() : chain;
}
