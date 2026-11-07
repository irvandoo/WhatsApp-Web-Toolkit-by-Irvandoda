import type { LabelChatsResult, LabelsListResult, RcpExec } from '../shared/messages';
import { call } from './bridge';

/** Relay endpoint for label ops: background sends `rcp:exec`, we call the MAIN-world adapter. Groups use groups-bridge. */
export function mountRecipientsBridge(): void {
  chrome.runtime.onMessage.addListener((m: RcpExec, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || m?.kind !== 'rcp:exec') return false;
    const run = m.op === 'labels'
      ? call<LabelsListResult>({ type: 'labels:list' }, 30_000)
      : m.op === 'label-chats' && typeof m.labelId === 'string'
        ? call<LabelChatsResult>({ type: 'labels:chats', labelId: m.labelId }, 60_000)
        : Promise.reject(new Error('bad-op'));
    run.then(sendResponse, (e) => sendResponse({ unavailable: true, reason: String(e?.message ?? e) }));
    return true;
  });
}
