import Dexie, { type Table } from 'dexie';
import type { Interaction, MsgEvent } from './analytics-types';
import type { Contact, CrmNote, PipelineConfig, Reminder, Template } from './crm-types';
import type { Slot } from './slots';
import type { ArLogEntry, ArRule } from './autoreply-types';
import type { Category, LicenseCode, Order, PosSettings, Product, StockMove } from './pos-types';
import type { Campaign, OutboxItem, Schedule, SendLogEntry } from './outbox-types';
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
  slots!: Table<Slot, string>;
  arRules!: Table<ArRule, string>;
  arLog!: Table<ArLogEntry, string>;
  products!: Table<Product, string>;
  orders!: Table<Order, string>;
  posSettings!: Table<PosSettings, string>;
  categories!: Table<Category, string>;
  stockMoves!: Table<StockMove, string>;
  licenseCodes!: Table<LicenseCode, string>;
  campaigns!: Table<Campaign, string>;
  outbox!: Table<OutboxItem, string>;
  schedules!: Table<Schedule, string>;
  sendLog!: Table<SendLogEntry, string>;
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
    this.version(5).stores({
      slots: 'id, lastUsedAt',
    });
    this.version(6).stores({
      arRules: 'id, enabled, order',
      arLog: 'id, ts, chatKey',
    });
    this.version(7).stores({
      campaigns: 'id, status, createdAt',
      outbox: 'id, campaignId, status, dueAt, [status+dueAt]',
      schedules: 'id, enabled, nextRunAt',
      sendLog: 'id, ts, campaignId',
    });
    this.version(8).stores({
      products: 'id, sku, category, active',
      orders: 'id, contactKey, status, createdAt, [status+createdAt]',
      posSettings: 'id',
    });
    this.version(9).stores({
      products: 'id, sku, category, active, type',
      categories: 'id, name',
      stockMoves: 'id, productId, ts',
      licenseCodes: 'id, productId, status, orderId',
    }).upgrade((tx) => tx.table('products').toCollection().modify((p: { type?: string }) => { if (!p.type) p.type = 'fisik'; }));
  }
}
export const db = new ToolkitDB();
