/** CSS for the Status popover / first-run toast (Shadow DOM) and the pulsing navbar dot (document-level). */
export const LEVEL_COLOR = { ok: '#58c487', working: '#5b9bd5', attention: '#f2b84b', paused: '#9aa5a0', off: '#9aa5a0' } as const;

export const STATUS_CSS = `
:host{all:initial}
*{box-sizing:border-box}
.pop,.toast{--bg:#fbfcfb;--fg:#26332e;--mut:#66756f;--bd:#e3e9e6;--hov:rgba(63,174,107,.12);--g:#3fae6b;--gfg:#fff;--bad:#a3403d;--badbg:#fbe9e7;
 font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg)}
@media (prefers-color-scheme:dark){.pop,.toast{--bg:#1b2420;--fg:#dfe8e3;--mut:#9aaaa3;--bd:#2d3a34;--hov:rgba(88,196,135,.14);--g:#58c487;--gfg:#10231a;--bad:#f0a09a;--badbg:rgba(240,130,122,.15)}}
.pop{position:fixed;z-index:2147483500;width:340px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;background:var(--bg);border:1px solid var(--bd);border-radius:14px;box-shadow:0 18px 48px rgba(38,51,46,.2);padding:14px}
.hd{display:flex;gap:10px;align-items:flex-start}
.dot{width:12px;height:12px;border-radius:50%;margin-top:4px;flex:none}
.dot.working{animation:wst 1.6s ease-in-out infinite}
@keyframes wst{0%,100%{box-shadow:0 0 0 0 rgba(91,155,213,.55)}50%{box-shadow:0 0 0 7px rgba(91,155,213,0)}}
.ti{font-weight:700;font-size:14px}.de{color:var(--mut);margin-top:2px}
.x{margin-left:auto;border:0;background:transparent;color:var(--mut);font-size:18px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:6px}
button{font:inherit;color:inherit;cursor:pointer}
button:focus-visible,input:focus-visible{outline:2px solid var(--g);outline-offset:2px}
.big{width:100%;margin-top:12px;height:42px;border-radius:10px;border:0;background:var(--g);color:var(--gfg);font-weight:700;font-size:14px}
.big.sec{background:transparent;color:var(--fg);border:1px solid var(--bd)}
.menu{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
.menu button{border:1px solid var(--bd);background:transparent;border-radius:8px;padding:8px}
.menu button:hover,.x:hover{background:var(--hov)}
.dan{width:100%;margin-top:8px;height:36px;border-radius:10px;border:1px solid var(--bad);background:var(--badbg);color:var(--bad);font-weight:600}
h4{margin:14px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
.row{display:flex;gap:8px;align-items:center;padding:7px 0;border-top:1px solid var(--bd)}
.row .t{flex:1;min-width:0}.row b{display:block;font-weight:600}.row small{color:var(--mut);display:block}
.chip{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--bd);flex:none;color:var(--mut)}
.chip.jalan{background:rgba(88,196,135,.18);color:#24714a;border-color:transparent}
.chip.siaga{background:rgba(91,155,213,.16);color:#2f6590;border-color:transparent}
.chip.error{background:rgba(242,184,75,.25);color:#845508;border-color:transparent}
@media (prefers-color-scheme:dark){.chip.jalan{color:#86d9a7}.chip.siaga{color:#93c3e9}.chip.error{color:#e8bd70}}
.sw{flex:none;width:36px;height:20px;accent-color:var(--g)}
.note{margin-top:10px;padding:8px 10px;border-radius:10px;background:var(--hov);color:var(--fg);font-size:12px}
.note.w{background:var(--badbg)}
.lnk{margin-top:10px;width:100%;height:34px;border-radius:10px;border:1px solid var(--bd);background:transparent}
.toast{position:fixed;left:84px;bottom:20px;z-index:2147483500;width:300px;max-width:calc(100vw - 24px);background:var(--bg);border:1px solid var(--bd);border-left:4px solid var(--g);border-radius:12px;box-shadow:0 10px 30px rgba(38,51,46,.2);padding:12px}
.toast b{display:block;margin-bottom:4px}.toast p{margin:0 0 8px;color:var(--mut)}
.toast .b{display:flex;gap:6px;flex-wrap:wrap}
.toast button{border:1px solid var(--bd);background:transparent;border-radius:8px;padding:5px 10px}
.toast button.pri{background:var(--g);color:var(--gfg);border-color:var(--g)}
@media (prefers-reduced-motion:reduce){.dot.working{animation:none}}
`;

/** Document-level rule for the navbar item (its dot lives in WhatsApp's DOM, not in a shadow root). */
export const NAV_PULSE_CSS = `
@keyframes wwt-st{0%,100%{transform:scale(1)}50%{transform:scale(1.45)}}
[data-wwt-nav="status"][data-wwt-pulse="1"] [data-wwt-dot]{animation:wwt-st 1.6s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){[data-wwt-nav="status"][data-wwt-pulse="1"] [data-wwt-dot]{animation:none}}
`;

/** Extra rules for the panel's shadow root: FAB dot + the Status tab rows. */
export const FAB_DOT_CSS = `
.st-row{display:flex;gap:8px;align-items:center;padding:6px 0;border-top:1px solid rgba(128,128,128,.25)}
.st-row .t{flex:1;min-width:0}.st-row small{display:block;opacity:.7}
.chip{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid rgba(128,128,128,.35);flex:none}
.chip.jalan{background:rgba(88,196,135,.22);border-color:transparent}
.chip.siaga{background:rgba(91,155,213,.2);border-color:transparent}
.chip.error{background:rgba(242,184,75,.32);border-color:transparent}
.wst{position:absolute;right:2px;top:2px;width:12px;height:12px;border-radius:50%;border:2px solid #fff;pointer-events:none}
.wst.working{animation:wstp 1.6s ease-in-out infinite}
@keyframes wstp{0%,100%{transform:scale(1)}50%{transform:scale(1.3)}}
@media (prefers-reduced-motion:reduce){.wst.working{animation:none}}
`;
