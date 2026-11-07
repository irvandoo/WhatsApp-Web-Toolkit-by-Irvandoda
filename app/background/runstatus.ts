import { IS_FULL } from '../shared/credit';
import { QS_PENDING_KEY, RUN_KEY, HEALTH_PREFIX, computeBadge, computeIndicator, loadRun } from '../shared/runmode';
import { readAllHealth } from '../content/engine-health';

/**
 * Toolbar badge ('!' amber = needs attention) computed from run state + engine heartbeats, and the first-install flag
 * that makes the content script show the "panduan cepat" toast. The service worker may sleep, so everything is driven
 * by top-level listeners + a 1-minute alarm (no new permission: storage + alarms are already declared).
 */
const ALARM = 'wwt-badge';
let deb: ReturnType<typeof setTimeout> | undefined;

export async function updateBadge(): Promise<void> {
  try {
    const [run, health] = await Promise.all([loadRun(IS_FULL), readAllHealth()]);
    const b = computeBadge(computeIndicator(run, health, Date.now(), IS_FULL), IS_FULL);
    await chrome.action.setBadgeText({ text: b.text });
    await chrome.action.setBadgeBackgroundColor({ color: b.color });
  } catch { /* action API unavailable */ }
}

export function installRunStatus(): void {
  // let content scripts write heartbeats into session storage (otherwise they fall back to local)
  try { void chrome.storage.session?.setAccessLevel?.({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }); } catch { /* ignore */ }
  try { void chrome.alarms.create(ALARM, { periodInMinutes: 1 }); } catch { /* ignore */ }
  chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) void updateBadge(); });
  chrome.storage.onChanged.addListener((ch) => {
    if (!Object.keys(ch).some((k) => k === RUN_KEY || k.startsWith(HEALTH_PREFIX))) return;
    clearTimeout(deb);
    deb = setTimeout(() => void updateBadge(), 800);
  });
  chrome.runtime.onStartup?.addListener(() => void updateBadge());
  chrome.runtime.onInstalled.addListener((d) => {
    void updateBadge();
    if (d.reason !== 'install') return;
    void chrome.storage.local.set({ [QS_PENDING_KEY]: true });
    // FULL: open WhatsApp Web once so the quick-start toast appears there (the least intrusive reliable path).
    if (IS_FULL) {
      void chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }).then((t) => { if (!t.length) void chrome.tabs.create({ url: 'https://web.whatsapp.com' }); }).catch(() => undefined);
    }
  });
  void updateBadge();
}
