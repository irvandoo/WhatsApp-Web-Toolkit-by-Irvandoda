import type { DiagExec, ProbeResult, SendResult } from '../shared/messages';
import { call } from './bridge';
import { loadSendSettings } from './send-settings';
import { explainAutoReply } from './autoreply';

/** Relay endpoint: background sends `diag:exec`; we call the MAIN-world adapter (send:probe / send:self-test). Nothing runs until asked. */
export function mountDiagBridge(): void {
  chrome.runtime.onMessage.addListener((m: DiagExec, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || m?.kind !== 'diag:exec') return false;
    const run: Promise<unknown> = m.op === 'explain'
      ? explainAutoReply()
      : m.op === 'probe'
      ? call<ProbeResult>({ type: 'send:probe' }, 15_000)
      : m.op === 'selftest'
        ? loadSendSettings().then((s) => call<SendResult>({ type: 'send:self-test', allowDom: s.allowDomMacro }, 60_000))
        : Promise.reject(new Error('bad-op'));
    run.then((data) => sendResponse({ ok: true, data }), (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
    return true;
  });
}
