import type { ChatsContactsResult, LabelChatsResult, LabelsListResult, PingResult, RcpExec } from '../shared/messages';
import { call } from './bridge';

/** Relay endpoint for label ops: background sends `rcp:exec`, we call the MAIN-world adapter. Groups use groups-bridge. */
export function mountRecipientsBridge(): void {
  chrome.runtime.onMessage.addListener((m: RcpExec, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || m?.kind !== 'rcp:exec') return false;
    const run = m.op === 'labels'
      ? call<LabelsListResult>({ type: 'labels:list' }, 30_000)
      : m.op === 'chats'
        ? call<ChatsContactsResult>({ type: 'chats:contacts' }, 90_000)
      : m.op === 'ping'
        ? call<PingResult>({ type: 'ping' }, 5_000).then((p) => ({ accountId: p.accountId }))
      : m.op === 'label-chats' && typeof m.labelId === 'string'
        ? call<LabelChatsResult>({ type: 'labels:chats', labelId: m.labelId }, 60_000)
        : Promise.reject(new Error('bad-op'));
    run.then(sendResponse, (e) => sendResponse({ unavailable: true, reason: String(e?.message ?? e) }));
    return true;
  });
}
