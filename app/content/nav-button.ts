// Adds toolkit items to WhatsApp Web's left navbar (after "Advertise"/"Tools"),
// by cloning an existing navbar item at runtime. We never hardcode WA's hashed CSS classes:
// the clones inherit whatever classes the live item has, so styling survives WA redeploys.
// Anything unexpected -> no items, and the caller keeps its floating fallback.

const SECTION = '[data-testid="navbar-primary-section"]';
const MARK = 'data-wwt-nav';
const SVG_NS = 'http://www.w3.org/2000/svg';
// Four rounded squares (module grid), outlined; evenodd cuts the inner squares.
export const TOOLKIT_GLYPH =
  'M5 3h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v5h5V5H5Zm9-2h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v5h5V5h-5ZM5 12h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Zm0 2v5h5v-5H5Zm9-2h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Zm0 2v5h5v-5h-5Z';

export interface NavItemSpec {
  id: string;
  label: string;
  /** SVG path data (24x24 box). Filled (evenodd) by default, stroked when `stroke` is true. */
  iconPath: string;
  stroke?: boolean;
  onClick: (btn: HTMLElement) => void;
  badge?: number | string | null;
}

export interface NavItemHandle {
  readonly id: string;
  /** number (0 hides), short string, or null to hide. `color` overrides the bubble background. */
  setBadge(v: number | string | null, color?: string): void;
  setPressed(on: boolean): void;
  /** small status dot (e.g. green = enabled) */
  setActive(on: boolean, color?: string): void;
  setHidden(hidden: boolean): void;
  focus(): void;
  readonly el: HTMLElement | null;
}

export interface NavItems {
  handles: Record<string, NavItemHandle>;
  list: NavItemHandle[];
  present(): boolean;
}

interface Tpl { wrapper: HTMLElement; button: HTMLButtonElement }
interface ItemState { badge: number | string | null; badgeColor?: string; pressed: boolean; active: boolean; dotColor?: string; hidden: boolean }

const isDark = () => document.body?.classList.contains('dark') || document.documentElement.classList.contains('dark') ||
  (!!window.matchMedia?.('(prefers-color-scheme: dark)').matches && !document.body?.classList.contains('light'));

function makeIcon(s: NavItemSpec): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  const p = document.createElementNS(SVG_NS, 'path');
  if (s.stroke) {
    svg.setAttribute('fill', 'none');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.8');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
  } else {
    svg.setAttribute('fill', 'currentColor');
    p.setAttribute('fill', 'currentColor');
    p.setAttribute('fill-rule', 'evenodd');
  }
  p.setAttribute('d', s.iconPath);
  svg.appendChild(p);
  return svg;
}

/** The navbar item to clone: prefer "Advertise"/"Tools", else any non-profile item. */
function findTemplate(section: Element): Tpl | null {
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

function build(tpl: Tpl, s: NavItemSpec): HTMLElement | null {
  const clone = tpl.wrapper.cloneNode(true) as HTMLElement;
  clone.setAttribute(MARK, s.id);
  const btn = clone.querySelector<HTMLButtonElement>('button[data-navbar-item]');
  const oldSvg = clone.querySelector('svg');
  if (!btn || !oldSvg) return null;
  // Strip anything that belongs to the cloned item rather than to us (badges, tooltips, ids).
  clone.querySelectorAll('[role="status"]').forEach((n) => n.closest('div')?.remove());
  clone.querySelectorAll('[id],[aria-describedby]').forEach((n) => { n.removeAttribute('id'); n.removeAttribute('aria-describedby'); });
  btn.removeAttribute('data-navbar-item-index');
  btn.setAttribute('data-navbar-item-selected', 'false');
  btn.setAttribute('aria-pressed', 'false');
  btn.setAttribute('aria-label', s.label);
  btn.setAttribute('title', s.label);
  btn.setAttribute('tabindex', '0');
  oldSvg.replaceWith(makeIcon(s));
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); s.onClick(btn); });
  return clone;
}

const badgeText = (v: number | string): string => (typeof v === 'number' ? (v > 99 ? '99+' : String(v)) : v);

function paint(el: HTMLElement, spec: NavItemSpec, st: ItemState): void {
  const btn = el.querySelector<HTMLButtonElement>('button');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(st.pressed));
  btn.setAttribute('data-navbar-item-selected', String(st.pressed));
  const ring = isDark() ? '#111b21' : '#f0f2f5';
  const get = (attr: string): HTMLElement => {
    let n = btn.querySelector<HTMLElement>(`[${attr}]`);
    if (!n) {
      n = document.createElement('span');
      n.setAttribute(attr, '1');
      n.setAttribute('aria-hidden', 'true');
      btn.appendChild(n);
    }
    return n;
  };
  if (btn.style.position !== 'relative') btn.style.position = 'relative';
  const showBadge = st.badge !== null && st.badge !== 0 && st.badge !== '';
  if (showBadge) {
    const n = get('data-wwt-badge');
    n.textContent = badgeText(st.badge as number | string);
    n.style.cssText = 'position:absolute;top:0;right:0;min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;border-radius:8px;' +
      `background:${st.badgeColor ?? '#d9665c'};color:#fff;font:700 10px/16px system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;` +
      `box-shadow:0 0 0 2px ${ring};pointer-events:none;font-variant-numeric:tabular-nums`;
  } else btn.querySelector('[data-wwt-badge]')?.remove();
  btn.setAttribute('aria-label', typeof st.badge === 'number' && st.badge > 0 ? `${spec.label} (${badgeText(st.badge)})` : spec.label);
  if (st.active) {
    const n = get('data-wwt-dot');
    n.style.cssText = `position:absolute;bottom:2px;right:2px;width:9px;height:9px;border-radius:50%;background:${st.dotColor ?? '#3fae6b'};` +
      `box-shadow:0 0 0 2px ${ring};pointer-events:none`;
  } else btn.querySelector('[data-wwt-dot]')?.remove();
}

let teardown: (() => void) | null = null;

/** Only one set of navbar items exists per page: mounting again replaces the previous instance. */
export function mountNavItems(specs: NavItemSpec[], onPresence?: (present: boolean) => void): NavItems {
  teardown?.();
  const els = new Map<string, HTMLElement>();
  const states = new Map<string, ItemState>();
  for (const s of specs) states.set(s.id, { badge: s.badge ?? null, pressed: false, active: false, hidden: false });
  let last: boolean | null = null;
  let queued = false;

  const alive = (id: string) => { const e = els.get(id); return e && e.isConnected ? e : null; };
  const repaint = (s: NavItemSpec) => { const e = alive(s.id); if (e) paint(e, s, states.get(s.id)!); };

  let dead = false;
  function ensure() {
    queued = false;
    if (dead) return;
    let ok = false;
    try {
      const section = document.querySelector(SECTION);
      const tpl = section ? findTemplate(section) : null;
      if (section && tpl) {
        let anchor: HTMLElement = tpl.wrapper;
        ok = true;
        for (const s of specs) {
          const st = states.get(s.id)!;
          let el = alive(s.id);
          if (st.hidden) { el?.remove(); els.delete(s.id); continue; }
          if (!el || !section.contains(el)) {
            el?.remove();
            el = build(tpl, s);
            if (!el) { ok = false; continue; }
            els.set(s.id, el);
            paint(el, s, st);
          }
          if (anchor.nextElementSibling !== el) anchor.after(el);
          anchor = el;
        }
      } else { for (const e of els.values()) e.remove(); els.clear(); }
    } catch { ok = false; }
    if (ok !== last) { last = ok; onPresence?.(ok); }
  }
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(ensure); } };

  ensure();
  // WA re-renders its navbar with React; re-check on DOM changes (cheap, rAF-throttled).
  const mo = new MutationObserver(schedule);
  mo.observe(document.documentElement, { childList: true, subtree: true });
  teardown = () => { dead = true; mo.disconnect(); for (const e of els.values()) e.remove(); els.clear(); };

  const handles: Record<string, NavItemHandle> = {};
  for (const s of specs) {
    const st = states.get(s.id)!;
    handles[s.id] = {
      id: s.id,
      get el() { return alive(s.id); },
      setBadge(v, color) { st.badge = v; st.badgeColor = color; repaint(s); },
      setPressed(on) { st.pressed = on; repaint(s); },
      setActive(on, color) { st.active = on; st.dotColor = color; repaint(s); },
      setHidden(h) { if (st.hidden === h) return; st.hidden = h; ensure(); },
      focus() { alive(s.id)?.querySelector('button')?.focus(); },
    };
  }
  return { handles, list: specs.map((s) => handles[s.id]), present: () => last === true };
}

// ---- Backwards-compatible single-button API ----
export interface NavButton {
  setPressed(on: boolean): void;
  focus(): void;
  present(): boolean;
}
interface Opts { label: string; onClick: () => void; onPresence: (present: boolean) => void }

export function mountNavButton(o: Opts): NavButton {
  const nav = mountNavItems([{ id: 'toolkit', label: o.label, iconPath: TOOLKIT_GLYPH, onClick: () => o.onClick() }], o.onPresence);
  const h = nav.handles.toolkit;
  return { setPressed: (on) => h.setPressed(on), focus: () => h.focus(), present: () => nav.present() };
}
