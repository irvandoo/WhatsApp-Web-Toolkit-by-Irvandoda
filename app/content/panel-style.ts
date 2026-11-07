export const PANEL_CSS = `
:host{all:initial}
*{box-sizing:border-box}
.root{--bg:#f6f8f7;--surface:#fbfcfb;--border:#e3e9e6;--text:#26332e;--muted:#66756f;--accent:#3fae6b;--accent-fg:#fff;--accent-soft:#e6f4ec;
--ok:#2f8f57;--warn:#9a6a1f;--bad:#b4483f;--ok-soft:#e6f4ec;--warn-soft:#fbf1dd;--bad-soft:#fbe9e6;--ring:#7fc9a0;--shadow:0 12px 36px rgba(38,51,46,.14);--fabg:linear-gradient(135deg,#58c487,#3fae6b);--dbg:#d9665c;
font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--text)}
.root.dark{--bg:#141b18;--surface:#1b2420;--border:#27322d;--text:#dfe8e3;--muted:#9aaaa3;--accent:#58c487;--accent-fg:#10231a;--accent-soft:#1d3327;
--ok:#6fd49b;--warn:#e8c277;--bad:#f09a92;--ok-soft:#1d3327;--warn-soft:#352c1a;--bad-soft:#38221f;--ring:#58c487;--shadow:0 12px 36px rgba(0,0,0,.45);--dbg:#c9574d}
button,a{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.fab{position:fixed;right:16px;z-index:2147483000;width:48px;height:48px;border-radius:50%;border:0;padding:0;display:grid;place-items:center;
background:var(--fabg);color:#fff;cursor:grab;box-shadow:0 6px 18px rgba(38,51,46,.18);touch-action:none;user-select:none}
.fab.drag{cursor:grabbing}
.fab.run::after{content:"";position:absolute;inset:0;border-radius:50%;border:2px solid var(--accent);animation:ring 1.4s ease-out infinite}
@keyframes ring{from{transform:scale(1);opacity:.9}to{transform:scale(1.7);opacity:0}}
.badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--dbg);color:#fff;
font-size:11px;font-weight:700;line-height:14px;text-align:center;font-variant-numeric:tabular-nums;border:2px solid var(--bg)}
.badge[hidden]{display:none}
.panel{position:fixed;right:76px;bottom:16px;z-index:2147483000;width:380px;max-width:calc(100vw - 24px);max-height:80vh;display:none;flex-direction:column;
background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;opacity:0;transform:translateY(8px) scale(.98);
transition:opacity .16s ease,transform .16s ease}
.panel.show{display:flex}
.nav .fab,.nav .dock{display:none}
.dock{position:fixed;right:16px;z-index:2147483000;width:48px;display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px 0;border-radius:24px;
background:var(--bg);border:1px solid var(--border);box-shadow:0 6px 18px rgba(38,51,46,.14)}
.dk{position:relative;width:36px;height:36px;border-radius:50%;border:0;background:transparent;color:var(--muted);display:grid;place-items:center;cursor:pointer;padding:0}
.dk:hover{background:var(--surface);color:var(--text)}
.dk[hidden]{display:none}
.sb{position:absolute;top:-1px;right:-1px;min-width:15px;height:15px;padding:0 4px;border-radius:8px;background:var(--dbg);color:#fff;font-size:10px;font-weight:700;line-height:15px;text-align:center}
.sd{position:absolute;bottom:3px;right:3px;width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 2px var(--bg)}
.sb[hidden],.sd[hidden]{display:none}
.chk{display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer}
.nav .panel{right:auto;left:76px;bottom:16px}
.panel.in{opacity:1;transform:none}
@media (max-width:480px){.panel{right:8px;bottom:72px}}
@media (prefers-reduced-motion:reduce){.panel{transition:none;transform:none}.fab.run::after{animation:none;opacity:.6}.bar i{transition:none}.bar i.ind{animation:none}}
header{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--border)}
.logo{width:32px;height:32px;border-radius:10px;background:var(--fabg);color:#fff;display:grid;place-items:center;flex:none}
.ttl{flex:1;min-width:0}.ttl b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ttl small{color:var(--muted);font-size:11px}
.pill{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:var(--surface);border:1px solid var(--border);white-space:nowrap}
.pill::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
.pill.ok{color:var(--ok);background:var(--ok-soft)}.pill.warn{color:var(--warn);background:var(--warn-soft)}.pill.bad{color:var(--bad);background:var(--bad-soft)}
.pill span{color:var(--text)}
.x{border:0;background:transparent;width:32px;height:32px;border-radius:8px;display:grid;place-items:center;cursor:pointer;color:var(--muted)}
.x:hover{background:var(--surface)}
nav{display:flex;gap:2px;padding:4px 8px;border-bottom:1px solid var(--border)}
.tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 2px;border:0;background:transparent;border-radius:8px;cursor:pointer;color:var(--muted);font-size:11px;font-weight:600}
.tab:hover{background:var(--surface)}
.tab[aria-selected=true]{background:var(--accent-soft);color:var(--accent)}
main{padding:16px;overflow:auto;flex:1;min-height:200px}
section[hidden]{display:none}
h3{margin:0 0 8px;font-size:13px}
p{margin:0 0 8px;color:var(--muted)}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface);cursor:pointer;font-weight:600;text-decoration:none;transition:background .15s,border-color .15s}
.btn:hover{border-color:var(--accent);background:var(--accent-soft)}
.btn.pri{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
.btn.pri:hover{background:var(--accent);filter:brightness(1.05)}
.btn.dan{color:var(--bad)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:8px}
.kv{display:flex;justify-content:space-between;gap:8px;font-variant-numeric:tabular-nums}.kv span:first-child{color:var(--muted)}
.bar{height:8px;border-radius:4px;background:var(--border);overflow:hidden;margin:4px 0}
.bar i{display:block;height:100%;width:0;background:var(--accent);border-radius:4px;transition:width .3s ease}
.bar i.warn{background:var(--warn)}.bar i.bad{background:var(--bad)}
.bar i.ind{width:40%;animation:ind 1.2s ease-in-out infinite alternate}
@keyframes ind{from{margin-left:0}to{margin-left:60%}}
.chat{margin-bottom:8px}.chat .kv{font-size:12px}.chat .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)!important;max-width:60%}
.empty{color:var(--muted);font-size:12px}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.tile{padding:8px 12px;border:1px dashed var(--border);border-radius:12px;color:var(--muted)}
.tile b{display:block}.tile small{font-size:11px}
.warnbox{display:flex;gap:8px;padding:8px 12px;border-radius:12px;border:1px solid var(--border);background:var(--warn-soft);color:var(--warn);margin-bottom:8px}
.warnbox div{color:var(--text)}
code{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:0 4px}
a.lnk{color:var(--accent);font-weight:600}
footer{padding:8px 16px;border-top:1px solid var(--border);min-height:34px;color:var(--muted);font-size:12px}
@media (forced-colors:active){.pill::before{background:CanvasText}}
`;
