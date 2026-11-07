/** Blast + scheduled sending contracts (FROZEN). Pure logic lives in outbox-logic.ts. */
export type CampaignStatus = 'running' | 'paused' | 'done' | 'stopped';
export type CampaignSource = 'csv' | 'crm' | 'mix' | 'schedule' | 'reminder';
export type ItemStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'draft' | 'skipped' | 'cancelled';
export type SendMode = 'auto' | 'draft';

export interface SafetySettings {
  delayMinSec: number;      // default 20, floor 8
  delayMaxSec: number;      // default 60
  maxPerHour: number;       // default 40
  maxPerDay: number;        // default 200
  windowEnabled: boolean;   // default true
  windowFrom: string;       // 'HH:MM' local, default '08:00'
  windowTo: string;         // 'HH:MM' local, default '20:00'
  warmup: boolean;          // "Mode pemanasan", default true
  checkRegistered: boolean; // check:registered before first contact, default true
  pauseAfterErrors: number; // consecutive transient errors -> auto pause, default 3
}

export interface Recipient {
  phone: string;                  // normalized digits, e.g. 628123456789
  name?: string;
  vars?: Record<string, string>;  // extra CSV columns (lowercase keys)
  contactKey?: string;            // CRM contact key when from CRM
  stage?: string;
}

export interface Campaign {
  id: string;
  name: string;
  template: string;               // template-engine syntax
  status: CampaignStatus;
  source: CampaignSource;
  createdAt: number;
  startAt: number;
  safety: SafetySettings;
  optInConfirmed: boolean;        // user ticked "Penerima sudah opt-in"
  total: number;
  accountId?: string;             // restrict to this WA account (optional)
  scheduleId?: string;
  pausedReason?: string;
  doneAt?: number;
}

export interface OutboxItem {
  id: string;
  campaignId: string;
  phone: string;
  name?: string;
  text: string;                   // fully rendered (variables + spintax resolved at plan time)
  status: ItemStatus;
  dueAt: number;
  attempts: number;
  createdAt: number;
  contactKey?: string;
  chatId?: string;
  sentAt?: number;
  sendingAt?: number;
  error?: string;
  notified?: boolean;             // store flavor: notification already fired
}

export type Recurrence =
  | { type: 'none'; at: number }                            // one-off, epoch ms
  | { type: 'daily'; time: string }                         // 'HH:MM' local
  | { type: 'weekly'; time: string; weekdays: number[] };   // 0=Min..6=Sab

export interface ScheduleTarget { phone: string; name?: string; contactKey?: string }

export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  target: ScheduleTarget;
  text: string;                   // template-engine syntax
  recurrence: Recurrence;
  nextRunAt: number | null;
  lastRunAt?: number;
  optInConfirmed: boolean;
  safety?: Partial<SafetySettings>;
  reminderId?: string;
  accountId?: string;
  createdAt: number;
}

export interface SendLogEntry {
  id: string;
  ts: number;
  campaignId: string;
  itemId: string;
  phone: string;
  status: 'sent' | 'failed' | 'draft' | 'skipped';
  mode: SendMode;
  error?: string;
  countable?: boolean;            // failed entries: false = permanent (e.g. not registered), ignored by auto-pause
}

export interface CampaignInput {
  name: string;
  template: string;
  recipients: Recipient[];
  safety?: Partial<SafetySettings>;
  startAt?: number;
  optInConfirmed: boolean;
  source: CampaignSource;
  accountId?: string;
}

export interface NextItem {
  item: OutboxItem | null;
  campaign?: Campaign;
  mode?: SendMode;
  reason?: string;
}

/** UI/content -> background. */
export type ObMsg =
  | { kind: 'ob:campaign:create'; input: CampaignInput }
  | { kind: 'ob:campaign:list' }
  | { kind: 'ob:campaign:update'; id: string; patch: { name?: string; safety?: Partial<SafetySettings> } }
  | { kind: 'ob:campaign:pause'; id: string }
  | { kind: 'ob:campaign:resume'; id: string }
  | { kind: 'ob:campaign:stop'; id: string }
  | { kind: 'ob:campaign:delete'; id: string }
  | { kind: 'ob:items:list'; campaignId: string }
  | { kind: 'ob:schedule:upsert'; schedule: Schedule }
  | { kind: 'ob:schedule:list' }
  | { kind: 'ob:schedule:delete'; id: string }
  | { kind: 'ob:schedule:toggle'; id: string; enabled: boolean }
  | { kind: 'ob:next'; accountId?: string | null }
  | { kind: 'ob:result'; itemId: string; status: 'sent' | 'failed'; error?: string; permanent?: boolean; chatId?: string }
  | { kind: 'ob:log:list'; campaignId?: string; limit?: number }
  | { kind: 'ob:kill'; on?: boolean }   // on omitted = query; true = global Stop (pauses all, blocks sending)
  | { kind: 'ob:reminder:send'; reminderId: string; text: string; optInConfirmed: boolean };
