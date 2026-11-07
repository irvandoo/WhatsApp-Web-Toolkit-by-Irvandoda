import type { GrpExec, GroupMembersResult, GroupsListResult } from '../shared/messages';
import { call } from './bridge';

/** Relay endpoint: background sends `grp:exec`, we call the MAIN-world adapter and answer. Nothing runs until asked. */
export function mountGroupsBridge(): void {
  chrome.runtime.onMessage.addListener((m: GrpExec, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || m?.kind !== 'grp:exec') return false;
    const run = m.op === 'list'
      ? call<GroupsListResult>({ type: 'groups:list' }, 30_000)
      : m.op === 'members' && typeof m.groupId === 'string'
        ? call<GroupMembersResult>({ type: 'groups:members', groupId: m.groupId }, 60_000)
        : Promise.reject(new Error('bad-op'));
    run.then(sendResponse, (e) => sendResponse({ unavailable: true, reason: String(e?.message ?? e) }));
    return true;
  });
}
