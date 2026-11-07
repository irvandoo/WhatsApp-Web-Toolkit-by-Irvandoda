import type { ChatOpenExec, ChatOpenMsg, ChatOpenResult } from '../shared/messages';

export const isChatOpenMsg = (m: unknown): m is ChatOpenMsg => (m as { kind?: unknown } | null)?.kind === 'ui:chat-open';

const err = (error: string): ChatOpenResult => ({ ok: false, error });

/**
 * Ask WhatsApp tabs to open a chat. The tab that holds the chat's account answers; a tab on another account
 * refuses ('wrong-account') and the next tab is tried. The caller's own tab (Analytics overlay) goes first.
 */
export async function handleChatOpen(m: ChatOpenMsg, sender?: chrome.runtime.MessageSender): Promise<ChatOpenResult> {
  if (typeof m.chatId !== 'string' || !m.chatId || m.chatId.length > 200) return err('bad-chat');
  let tabs: chrome.tabs.Tab[] = [];
  try { tabs = (await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' })).filter((t) => typeof t.id === 'number'); } catch { /* none */ }
  if (!tabs.length) return err('no-tab');
  const from = sender?.tab?.id;
  tabs.sort((a, b) => Number(b.id === from) - Number(a.id === from) || Number(!!b.active) - Number(!!a.active));
  const msg: ChatOpenExec = { kind: 'chatx:open', accountId: m.accountId, chatId: m.chatId, phone: m.phone };
  let lastErr = 'no-receiver';
  for (const t of tabs) {
    try {
      const r = (await chrome.tabs.sendMessage(t.id!, msg)) as ChatOpenResult | undefined;
      if (r?.ok) {
        await chrome.tabs.update(t.id!, { active: true }).catch(() => undefined);
        if (t.windowId !== undefined) await chrome.windows.update(t.windowId, { focused: true }).catch(() => undefined);
        return r;
      }
      if (r?.error) lastErr = r.error;
    } catch { /* tab without our content script (not refreshed after an extension reload) */ }
  }
  return err(lastErr);
}
