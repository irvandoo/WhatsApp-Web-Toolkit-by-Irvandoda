import { DEFAULT_SEND_SETTINGS, SEND_SETTINGS_KEY, type SendResult, type SendSettings } from '../shared/messages';
import { IS_FULL } from '../shared/credit';
import { call } from './bridge';

/** Silent-send settings ('wwt-send'). The DOM macro is visible, so it is OFF unless the user opted in; never in the store flavor. */
export async function loadSendSettings(): Promise<SendSettings> {
  try {
    const r = await chrome.storage.local.get(SEND_SETTINGS_KEY);
    return { ...DEFAULT_SEND_SETTINGS, ...(r[SEND_SETTINGS_KEY] ?? {}), allowDomMacro: IS_FULL && r[SEND_SETTINGS_KEY]?.allowDomMacro === true };
  } catch { return { ...DEFAULT_SEND_SETTINGS }; }
}

/** Silent send through the adapter's strategy chain. Rejects with the adapter error code ('send-unavailable', ...). */
export async function sendSilent(chatId: string, text: string, opts: { group?: boolean; timeoutMs?: number } = {}): Promise<SendResult> {
  const s = await loadSendSettings();
  return call<SendResult>({ type: 'send:text', chatId, text, allowDom: s.allowDomMacro, verify: true, group: opts.group === true }, opts.timeoutMs ?? 45_000);
}
