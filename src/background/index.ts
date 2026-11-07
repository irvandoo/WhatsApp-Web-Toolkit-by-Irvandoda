import { CREDIT } from '../shared/credit';
import { db } from '../shared/db';
import type { RuntimeMsg } from '../shared/messages';
import { handleAccounts, NOT_HANDLED } from './accounts';
import { installSessions } from './sessions';

installSessions();

chrome.runtime.onInstalled.addListener(() => console.info(`${CREDIT.product} installed — ${CREDIT.web}`));

chrome.runtime.onMessage.addListener((m: RuntimeMsg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || String((m as { kind?: string })?.kind).startsWith('sess:')) return false;
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
