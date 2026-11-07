import { IS_FULL } from '../shared/credit';
import type { GroupsUnavailable, RcpExec, RcpMsg } from '../shared/messages';
import { handleGrp } from './groups';

const KINDS = ['rcp:labels', 'rcp:label-chats', 'rcp:groups', 'rcp:group-members'];
export const isRcpMsg = (m: unknown): m is RcpMsg => !!m && KINDS.includes(String((m as { kind?: unknown }).kind));

async function findWaTab(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
  const best = tabs.find((t) => t.active && t.lastAccessed) ?? tabs.find((t) => t.active) ?? tabs[0];
  return best?.id ?? null;
}

/** Blast page -> active WhatsApp Web tab. Groups reuse the groups relay (full flavor only). */
export async function handleRcp(m: RcpMsg): Promise<unknown> {
  const un = (reason: string): GroupsUnavailable => ({ unavailable: true, reason });
  if (m.kind === 'rcp:groups') return IS_FULL ? handleGrp({ kind: 'grp:call', op: 'list' }) : un('store-flavor');
  if (m.kind === 'rcp:group-members') {
    return IS_FULL && typeof m.groupId === 'string' ? handleGrp({ kind: 'grp:call', op: 'members', groupId: m.groupId }) : un('store-flavor');
  }
  const tabId = await findWaTab();
  if (tabId == null) return un('no-tab');
  const msg: RcpExec = m.kind === 'rcp:labels' ? { kind: 'rcp:exec', op: 'labels' } : { kind: 'rcp:exec', op: 'label-chats', labelId: m.labelId };
  try {
    return (await chrome.tabs.sendMessage(tabId, msg)) ?? un('no-response');
  } catch {
    return un('no-receiver');
  }
}
