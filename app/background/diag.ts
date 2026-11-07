import type { DiagExec, DiagMsg } from '../shared/messages';

export const isDiagMsg = (m: unknown): m is DiagMsg => {
  const k = (m as { kind?: unknown } | null)?.kind;
  return k === 'diag:probe' || k === 'diag:selftest' || k === 'diag:explain';
};

async function findWaTab(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
  const best = tabs.find((t) => t.active && t.lastAccessed) ?? tabs.find((t) => t.active) ?? tabs[0];
  return best?.id ?? null;
}

/** Relays to the active WhatsApp Web tab. Always answers `{ok:boolean,data?,error?}`; errors: no-tab / no-receiver. */
export async function handleDiag(m: DiagMsg): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const tabId = await findWaTab();
  if (tabId == null) return { ok: false, error: 'no-tab' };
  const msg: DiagExec = m.kind === 'diag:probe' ? { kind: 'diag:exec', op: 'probe' } : m.kind === 'diag:explain' ? { kind: 'diag:exec', op: 'explain' } : { kind: 'diag:exec', op: 'selftest', allowDom: m.allowDom === true };
  try {
    return (await chrome.tabs.sendMessage(tabId, msg)) ?? { ok: false, error: 'no-response' };
  } catch {
    return { ok: false, error: 'no-receiver' };
  }
}
