// Adds a toolkit button to WhatsApp Web's left navbar (below "Tools"/"Advertise"),
// by cloning an existing navbar item at runtime. We never hardcode WA's hashed CSS classes:
// the clone inherits whatever classes the live item has, so styling survives WA redeploys.
// Anything unexpected -> no button, and the caller keeps its floating-button fallback.

const SECTION = '[data-testid="navbar-primary-section"]';
const MARK = 'data-wwt-nav';
const SVG_NS = 'http://www.w3.org/2000/svg';
// Four rounded squares (module grid), outlined; evenodd cuts the inner squares.
const GLYPH =
  'M5 3h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v5h5V5H5Zm9-2h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v5h5V5h-5ZM5 12h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Zm0 2v5h5v-5H5Zm9-2h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Zm0 2v5h5v-5h-5Z';

export interface NavButton {
  setPressed(on: boolean): void;
  focus(): void;
  present(): boolean;
}

interface Opts { label: string; onClick: () => void; onPresence: (present: boolean) => void }

function makeIcon(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('fill', 'currentColor');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('fill', 'currentColor');
  p.setAttribute('fill-rule', 'evenodd');
  p.setAttribute('d', GLYPH);
  svg.appendChild(p);
  return svg;
}

/** The navbar item to clone: prefer "Advertise"/"Tools", else any non-profile item. */
function findTemplate(section: Element): { wrapper: HTMLElement; button: HTMLButtonElement } | null {
  const buttons = [...section.querySelectorAll<HTMLButtonElement>('button[data-navbar-item]')]
    .filter((b) => !b.closest(`[${MARK}]`) && !b.querySelector('img') && b.querySelector('svg'));
  const pick = buttons.find((b) => b.getAttribute('aria-label') === 'Advertise')
    ?? buttons.find((b) => b.getAttribute('aria-label') === 'Tools')
    ?? buttons[buttons.length - 1];
  if (!pick) return null;
  const container = section.firstElementChild; // the flex column that holds the item wrappers
  if (!container) return null;
  let node: HTMLElement | null = pick;
  while (node && node.parentElement !== container) node = node.parentElement;
  return node ? { wrapper: node, button: pick } : null;
}

function build(tpl: { wrapper: HTMLElement; button: HTMLButtonElement }, o: Opts): HTMLElement | null {
  const clone = tpl.wrapper.cloneNode(true) as HTMLElement;
  clone.setAttribute(MARK, '1');
  const btn = clone.querySelector<HTMLButtonElement>('button[data-navbar-item]');
  const oldSvg = clone.querySelector('svg');
  if (!btn || !oldSvg) return null;
  // Strip anything that belongs to the cloned item rather than to us (badges, tooltips, ids).
  clone.querySelectorAll('[role="status"]').forEach((n) => n.closest('div')?.remove());
  clone.querySelectorAll('[id],[aria-describedby]').forEach((n) => { n.removeAttribute('id'); n.removeAttribute('aria-describedby'); });
  btn.removeAttribute('data-navbar-item-index');
  btn.setAttribute('data-navbar-item-selected', 'false');
  btn.setAttribute('aria-pressed', 'false');
  btn.setAttribute('aria-label', o.label);
  btn.setAttribute('title', o.label);
  btn.setAttribute('tabindex', '0');
  oldSvg.replaceWith(makeIcon());
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); o.onClick(); });
  return clone;
}

export function mountNavButton(o: Opts): NavButton {
  let el: HTMLElement | null = null;
  let last: boolean | null = null;
  let queued = false;
  const button = () => el?.querySelector<HTMLButtonElement>('button') ?? null;

  function ensure() {
    queued = false;
    try {
      const section = document.querySelector(SECTION);
      const existing = document.querySelector<HTMLElement>(`[${MARK}]`);
      if (section && existing && section.contains(existing)) { el = existing; }
      else {
        existing?.remove();
        el = null;
        if (section) {
          const tpl = findTemplate(section);
          const made = tpl ? build(tpl, o) : null;
          if (tpl && made) { tpl.wrapper.after(made); el = made; }
        }
      }
    } catch { el = null; }
    const now = !!el;
    if (now !== last) { last = now; o.onPresence(now); }
  }
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(ensure); } };

  ensure();
  // WA re-renders its navbar with React; re-check on DOM changes (cheap, rAF-throttled).
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });

  return {
    setPressed(on) { const b = button(); if (b) { b.setAttribute('aria-pressed', String(on)); b.setAttribute('data-navbar-item-selected', String(on)); } },
    focus() { button()?.focus(); },
    present() { return !!el; },
  };
}
