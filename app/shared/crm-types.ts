/** CRM + template contracts (frozen; agents must not change without reporting). */
export const DEFAULT_STAGES = ['Lead baru', 'Dihubungi', 'Negosiasi', 'Deal', 'Selesai'] as const;

export interface Contact {
  key: string;            // `${accountId}|${chatId}`
  accountId: string;
  chatId: string;         // WA chat id
  name: string;
  phone: string;          // digits only, '' for groups
  stage: string;          // pipeline stage name
  tags: string[];
  value: number;          // potential deal value (IDR)
  assignee: string;       // free text agent name
  optOut: boolean;        // do-not-contact (respected by future blast)
  createdAt: number;
  updatedAt: number;
  lastContactAt: number | null;
  /** where the lead came from (additive; older records have none) */
  source?: ContactSource;
  /** label / group name or file name the lead was imported from */
  sourceDetail?: string;
  note?: string;
}
export type ContactSource = 'chat' | 'label' | 'manual' | 'csv' | 'grup' | 'bar';
export const MANUAL_ACCOUNT = 'manual';
export type BulkMode = 'skip' | 'update';
export interface BulkResult { created: number; updated: number; skipped: number; errors: number }
export interface CrmNote { id: string; contactKey: string; text: string; createdAt: number }
export interface Reminder { id: string; contactKey: string; text: string; dueAt: number; done: boolean; notified: boolean }
export interface PipelineConfig { id: 'default'; stages: string[] }
export interface Template {
  id: string;
  shortcut: string;       // typed as "/shortcut" in the composer, [a-z0-9_-]{1,24}
  title: string;
  body: string;           // supports {nama} {telepon} {tahap} {tanggal} {akun} and spintax {a|b|c}
  category: string;
  usageCount: number;
  updatedAt: number;
  /** extra message variants (body is variant #1); max 10, each <= 4000 chars */
  variants?: string[];
  rotation?: 'random' | 'round-robin' | 'shuffle-bag';
}

export type CrmMsg =
  | { kind: 'crm:contact:upsert'; contact: Partial<Contact> & Pick<Contact, 'accountId' | 'chatId'> }
  | { kind: 'crm:contact:bulk-upsert'; items: (Partial<Contact> & Pick<Contact, 'accountId' | 'chatId'>)[]; mode: BulkMode }
  | { kind: 'crm:contact:bulk-delete'; keys: string[] }
  | { kind: 'crm:contact:list'; accountId?: string }
  | { kind: 'crm:contact:delete'; key: string }
  | { kind: 'crm:note:add'; contactKey: string; text: string }
  | { kind: 'crm:note:list'; contactKey: string }
  | { kind: 'crm:note:delete'; id: string }
  | { kind: 'crm:reminder:add'; contactKey: string; text: string; dueAt: number }
  | { kind: 'crm:reminder:list'; onlyOpen?: boolean }
  | { kind: 'crm:reminder:done'; id: string }
  | { kind: 'crm:pipeline:get' }
  | { kind: 'crm:pipeline:set'; stages: string[] }
  | { kind: 'crm:export'; format: 'json' | 'csv' }
  | { kind: 'tpl:list' }
  | { kind: 'tpl:upsert'; template: Template }
  | { kind: 'tpl:delete'; id: string }
  | { kind: 'tpl:use'; id: string };
