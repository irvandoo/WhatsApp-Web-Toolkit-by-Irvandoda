import { DEFAULT_STAGES } from './crm-types';

/** Digits of the phone number for user chats; '' for groups/broadcast/unknown. */
export function phoneFromChatId(chatId: string): string {
  const m = /^(\d+)(?::\d+)?@(c\.us|s\.whatsapp\.net|lid)$/.exec(chatId.trim());
  return m ? m[1] : '';
}

/** CSV cell with quoting and formula-injection guard. */
export function escapeCsvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Trim + validate stages: 2..12 unique, non-empty. Returns null on invalid. */
export function normalizeStages(stages: unknown): string[] | null {
  if (!Array.isArray(stages)) return null;
  const out = stages.map((s) => (typeof s === 'string' ? s.trim() : ''));
  if (out.length < 2 || out.length > 12) return null;
  if (out.some((s) => !s)) return null;
  if (new Set(out).size !== out.length) return null;
  return out;
}

export function remapStage(stage: string, stages: string[]): string {
  return stages.includes(stage) ? stage : (stages[0] ?? DEFAULT_STAGES[0]);
}

export function csvFromRows(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(escapeCsvCell).join(',')).join('\r\n');
}
