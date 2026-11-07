// Lightweight memory optimizations for WhatsApp Web (DOM/CSS level, no WA internals).
const STYLE_ID = 'wwt-memory-style';

const CSS = `
  /* Skip rendering work for off-screen chat rows and messages. */
  #pane-side [role="listitem"] { content-visibility: auto; contain-intrinsic-size: auto 72px; }
  #main [data-id] { content-visibility: auto; contain-intrinsic-size: auto 60px; }
  /* Save-mode: stop looping animations (stickers/GIF-like) */
  html[data-wwt-saver="1"] *, html[data-wwt-saver="1"] *::before, html[data-wwt-saver="1"] *::after {
    animation-duration: 0s !important; animation-iteration-count: 1 !important; transition-duration: 0s !important;
  }
`;

import { isEngineOn, onRunChange, reportHealth } from './engine-health';

export function installMemorySaver(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);

  // Enable saver mode while tab is hidden, disable when visible.
  const sync = () => {
    const on = isEngineOn('memory');
    (el as HTMLStyleElement).disabled = !on;
    document.documentElement.dataset.wwtSaver = on && document.hidden ? '1' : '0';
    reportHealth('memory', on ? { state: 'jalan', detail: 'Hemat memori aktif' } : { state: 'mati', detail: 'Dimatikan atau dijeda' });
  };
  document.addEventListener('visibilitychange', sync);
  onRunChange(sync);
  setInterval(sync, 60_000);
  sync();
}

export function jsHeapMB(): number | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round(m.usedJSHeapSize / 1048576) : null;
}
