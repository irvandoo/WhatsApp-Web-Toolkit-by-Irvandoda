import type { GrpExec, GrpMsg, GroupsUnavailable } from '../shared/messages';

export const isGrpMsg = (m: unknown): m is GrpMsg =>
  !!m && (m as { kind?: unknown }).kind === 'grp:call' && ['list', 'members'].includes((m as { op?: string }).op ?? '');

/** chrome.tabs.query with a url filter only needs the host permission for web.whatsapp.com (already declared). */
async function findWaTab(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
  const best = tabs.find((t) => t.active && t.lastAccessed) ?? tabs.find((t) => t.active) ?? tabs[0];
  return best?.id ?? null;
}

export async function handleGrp(m: GrpMsg): Promise<unknown> {
  const un = (reason: string): GroupsUnavailable => ({ unavailable: true, reason });
  const tabId = await findWaTab();
  if (tabId == null) return un('no-tab');
  const msg: GrpExec = m.op === 'list' ? { kind: 'grp:exec', op: 'list' } : { kind: 'grp:exec', op: 'members', groupId: m.groupId };
  try {
    return (await chrome.tabs.sendMessage(tabId, msg)) ?? un('no-response');
  } catch {
    return un('no-receiver'); // tab not loaded / content script absent (store build or still loading)
  }
}
