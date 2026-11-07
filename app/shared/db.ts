import Dexie, { type Table } from 'dexie';
import type { Interaction, MsgEvent } from './analytics-types';
import type { Contact, CrmNote, PipelineConfig, Reminder, Template } from './crm-types';
import type { Account, AccountGroup, ArchivedMsg, SessionMeta } from './messages';

export interface SessionBlob { id: string; payload: string } // JSON string of snapshot (see content/session.ts)

export interface ChatSyncState { key: string; accountId: string; chatId: string; name: string; oldestTs: number | null; total: number; reachedStart: boolean; updatedAt: number }

class ToolkitDB extends Dexie {
  messages!: Table<ArchivedMsg, string>;
  syncState!: Table<ChatSyncState, string>;
  accounts!: Table<Account, string>;
  groups!: Table<AccountGroup, string>;
  sessions!: Table<SessionMeta, string>;
  sessionBlobs!: Table<SessionBlob, string>;
  contacts!: Table<Contact, string>;
  notes!: Table<CrmNote, string>;
  reminders!: Table<Reminder, string>;
  pipeline!: Table<PipelineConfig, string>;
  templates!: Table<Template, string>;
  events!: Table<MsgEvent, string>;
  interactions!: Table<Interaction, string>;
  constructor() {
    super('wwt');
    this.version(1).stores({
      messages: 'key, accountId, [accountId+chatId+ts], chatId, ts',
      syncState: 'key, accountId, chatId',
    });
    this.version(2).stores({
      accounts: 'id, groupId, lastSeen',
      groups: 'id',
      sessions: 'id, accountId, createdAt',
      sessionBlobs: 'id',
    });
    this.version(3).stores({
      contacts: 'key, accountId, stage, updatedAt, *tags',
      notes: 'id, contactKey, createdAt',
      reminders: 'id, contactKey, dueAt, done',
      pipeline: 'id',
      templates: 'id, &shortcut, category',
    });
    this.version(4).stores({
      events: 'key, accountId, ts, [accountId+ts], chatId',
      interactions: 'key, accountId, lastInTs, lastOutTs, firstInTs',
    });
  }
}
export const db = new ToolkitDB();
