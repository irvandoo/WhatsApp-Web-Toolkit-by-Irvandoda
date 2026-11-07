import { CREDIT } from '../shared/credit';
import { db } from '../shared/db';
import type { RuntimeMsg } from '../shared/messages';
import { handleAccounts, NOT_HANDLED } from './accounts';
import { installSessions } from './sessions';
import { installUiOpen } from './ui-open';
import { installRunStatus } from './runstatus';
import { handleCrm, isCrmMsg, registerCrmAlarms } from './crm';
import { handleTemplates, isTplMsg, seedTemplates } from './templates';
import { handleTrack, isTrackMsg } from './track';
import { handleSlots, isSlotMsg } from './slots';
import { handleAr, isArMsg } from './autoreply';
import { handleCounts, isCountsMsg } from './counts';
import { handleGrp, isGrpMsg } from './groups';
import { handlePos, isPosMsg } from './pos';
import { handleRcp, isRcpMsg } from './recipients-relay';
import { handleDiag, isDiagMsg } from './diag';
import { handleChatOpen, isChatOpenMsg } from './chatopen';
import { handleOutbox, isOutboxMsg, registerOutboxAlarms } from './outbox';
import { handleLi, isLiMsg } from './leadintel';
import { handlePresets, isPresetMsg } from './presets';
import type { CrmMsg } from '../shared/crm-types';

installSessions();
installUiOpen();
registerCrmAlarms();
registerOutboxAlarms();
installRunStatus();

chrome.runtime.onInstalled.addListener(() => {
  console.info(`${CREDIT.product} installed — ${CREDIT.web}`);
  void seedTemplates();
});

// CRM + template messages (separate listener so the main one never answers them).
chrome.runtime.onMessage.addListener((m: CrmMsg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !(isCrmMsg(m) || isTplMsg(m))) return false;
  (isTplMsg(m) ? handleTemplates(m) : handleCrm(m)).then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true;
});

// Analytics tracking (separate listener).
chrome.runtime.onMessage.addListener((m: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isTrackMsg(m)) return false;
  handleTrack(m).then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true;
});

// Feature modules that own their own message kinds (one shared router).
type Handler = (m: never, sender: chrome.runtime.MessageSender) => Promise<unknown>;
const MODULES: { is: (m: unknown) => boolean; handle: Handler }[] = [
  { is: isSlotMsg as (m: unknown) => boolean, handle: handleSlots as (m: never) => Promise<unknown> },
  { is: isArMsg as (m: unknown) => boolean, handle: handleAr as (m: never) => Promise<unknown> },
  { is: isCountsMsg as (m: unknown) => boolean, handle: handleCounts as (m: never) => Promise<unknown> },
  { is: isGrpMsg as (m: unknown) => boolean, handle: handleGrp as Handler },
  { is: isPosMsg as (m: unknown) => boolean, handle: handlePos as Handler },
  { is: isRcpMsg as (m: unknown) => boolean, handle: handleRcp as Handler },
  { is: isDiagMsg as (m: unknown) => boolean, handle: handleDiag as Handler },
  { is: isChatOpenMsg as (m: unknown) => boolean, handle: handleChatOpen as Handler },
  { is: isOutboxMsg as (m: unknown) => boolean, handle: handleOutbox as Handler },
  { is: isLiMsg as (m: unknown) => boolean, handle: handleLi as Handler },
  { is: isPresetMsg as (m: unknown) => boolean, handle: handlePresets as Handler },
];
chrome.runtime.onMessage.addListener((m: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const mod = MODULES.find((x) => x.is(m));
  if (!mod) return false;
  mod.handle(m as never, sender).then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true;
});

chrome.runtime.onMessage.addListener((m: RuntimeMsg, sender, sendResponse) => {
  const kind = String((m as { kind?: string })?.kind);
  if (sender.id !== chrome.runtime.id || /^(sess|crm|tpl|ui|track|slot|ar|grp|ob|pos|li|preset|rcp|diag):/.test(kind)) return false;
  (async () => {
    switch (m.kind) {
      case 'archive:put':
        await db.messages.bulkPut(m.msgs);
        return { stored: m.msgs.length };
      case 'archive:stats':
        return { messages: await db.messages.where('accountId').equals(m.accountId).count() };
      case 'archive:export':
        return m.chatId
          ? db.messages.where('[accountId+chatId+ts]').between([m.accountId, m.chatId, 0], [m.accountId, m.chatId, Infinity]).toArray()
          : db.messages.where('accountId').equals(m.accountId).toArray();
      default: {
        const r = await handleAccounts(m);
        if (r === NOT_HANDLED) throw new Error('unknown message');
        return r;
      }
    }
  })().then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true;
});
