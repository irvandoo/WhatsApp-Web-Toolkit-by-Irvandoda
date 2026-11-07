/** Lets content scripts (which cannot use chrome.tabs) ask the background to open an extension page. */
export type UiOpenMsg = { kind: 'ui:open'; page: 'dashboard' | 'crm' | 'templates' | 'analytics' | 'autoreply' | 'blast' | 'pos' | 'groups' | 'presets' };
const PAGES = new Set(['dashboard', 'crm', 'templates', 'analytics', 'autoreply', 'blast', 'pos', 'groups', 'presets']);

export function installUiOpen(): void {
  chrome.runtime.onMessage.addListener((m: unknown, sender) => {
    const msg = m as Partial<UiOpenMsg> | null;
    if (!msg || msg.kind !== 'ui:open' || sender.id !== chrome.runtime.id) return false;
    if (typeof msg.page !== 'string' || !PAGES.has(msg.page)) return false;
    void chrome.tabs.create({ url: chrome.runtime.getURL(`${msg.page}/index.html`) });
    return false; // no response needed
  });
}
