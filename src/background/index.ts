import { CREDIT } from '../shared/credit';
import { db } from '../shared/db';
import type { RuntimeMsg } from '../shared/messages';
import { handleAccounts, NOT_HANDLED } from './accounts';
import { installSessions } from './sessions';
import { handleCrm, isCrmMsg, registerCrmAlarms } from './crm';
import { handleTemplates, isTplMsg, seedTemplates } from './templates';
import type { CrmMsg } from '../shared/crm-types';

installSessions();
registerCrmAlarms();

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

chrome.runtime.onMessage.addListener((m: RuntimeMsg, sender, sendResponse) => {
  const kind = String((m as { kind?: string })?.kind);
  if (sender.id !== chrome.runtime.id || /^(sess|crm|tpl):/.test(kind)) return false;
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
