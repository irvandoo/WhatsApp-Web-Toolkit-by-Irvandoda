import { CREDIT } from '../shared/credit';
import { installMemorySaver } from './memory';
import { mountAccountReporter } from './account';
import { mountPanel } from './panel';
import { mountSlotStatus } from './slot-status';
import { mountDiagBridge } from './diag-bridge';
import { mountPrivacyBlur } from './privacy-blur';
import { mountCrmChatBar } from './crm-bridge';
import { mountComposer } from './composer';
import { mountTracker } from './tracker';
import { mountSlotBinding } from './switcher';
import { mountAutoReply } from './autoreply';
import { mountGroupsBridge } from './groups-bridge';
import { mountRecipientsBridge } from './recipients-bridge';
import { mountPosBridge } from './pos-bridge';
import { mountOutbox } from './outbox';
import { initRunGate } from './engine-health';
import { maybeShowFirstRunToast, startStatus } from './status';
import { RUN_KEY, normalizeRunState } from '../shared/runmode';
import { IS_FULL } from '../shared/credit';
import { AR_GLOBAL_KEY } from '../shared/autoreply-types';

document.documentElement.dataset.wwt = CREDIT.nickname;
void initRunGate();
void ensureRunState();
installMemorySaver();
mountPrivacyBlur();
mountPanel();
mountAccountReporter();
mountCrmChatBar();
mountComposer();
mountTracker();
mountSlotBinding();
mountAutoReply();
mountGroupsBridge();
mountPosBridge();
mountOutbox();
mountRecipientsBridge();
mountSlotStatus();
mountDiagBridge();
startStatus();
setTimeout(() => void maybeShowFirstRunToast(), 4000);

/** First run: persist the safe defaults once. Auto-reply is armed only if the user already had it switched on (upgrade). */
async function ensureRunState(): Promise<void> {
  try {
    const got = await chrome.storage.local.get([RUN_KEY, AR_GLOBAL_KEY]);
    if (got[RUN_KEY]) return;
    const run = normalizeRunState(null, IS_FULL);
    run.engines.autoReply = (got[AR_GLOBAL_KEY] as { enabled?: boolean } | undefined)?.enabled === true;
    await chrome.storage.local.set({ [RUN_KEY]: run });
  } catch { /* storage unavailable: defaults apply in memory */ }
}
