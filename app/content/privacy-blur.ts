import { BLUR_KEY, DEFAULT_BLUR, buildBlurCss, isBlurActive, mergeBlur, normalizeBlur, type BlurOptions } from '../shared/blur-logic';

/**
 * Privacy Blur (penyamaran layar). CSS-only: one injected <style>, no observers on WhatsApp's DOM, no pointer-event changes.
 * Options persist in chrome.storage.local 'wwt-blur'. Hotkey Ctrl+Shift+B toggles (Esc does not).
 */
const STYLE_ID = 'wwt-blur-style';
const IDLE_CHECK_MS = 10_000;

export interface BlurState { opts: BlurOptions; /** blur is applied right now (manual OR auto) */ active: boolean }
export type BlurPatch = Partial<Omit<BlurOptions, 'targets' | 'autoOnIdle'>> & { targets?: Partial<BlurOptions['targets']>; autoOnIdle?: Partial<BlurOptions['autoOnIdle']> };

let opts: BlurOptions = DEFAULT_BLUR;
let active = false;
let lastActivity = Date.now();
let mounted = false;
let appliedCss: string | null = null;
const subs = new Set<(s: BlurState) => void>();

const hasStorage = () => { try { return !!chrome.storage?.local; } catch { return false; } };
const windowActive = () => document.visibilityState !== 'hidden' && document.hasFocus();

export const getBlurState = (): BlurState => ({ opts, active });
export function onBlurState(cb: (s: BlurState) => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }

function apply(force = false): void {
  const next = isBlurActive(opts, { windowActive: windowActive(), idleMs: Date.now() - lastActivity });
  const css = next ? buildBlurCss(opts) : '';
  if (css !== appliedCss) {
    let el = document.getElementById(STYLE_ID);
    if (!css) el?.remove();
    else {
      if (!el) { el = document.createElement('style'); el.id = STYLE_ID; (document.head ?? document.documentElement).appendChild(el); }
      el.textContent = css;
    }
    appliedCss = css;
  }
  const changed = next !== active;
  active = next;
  if (changed || force) { const s = getBlurState(); subs.forEach((f) => { try { f(s); } catch { /* ignore */ } }); }
}

function persist(): void {
  try { if (hasStorage()) void chrome.storage.local.set({ [BLUR_KEY]: opts }); } catch { /* ignore */ }
}

/**
 * Update options. `true`/`false` toggles blur on/off, a number sets the intensity (4..16px) and turns blur on,
 * an object patches any option.
 */
export function setBlur(level: boolean | number | BlurPatch): void {
  const patch: BlurPatch = typeof level === 'boolean' ? { enabled: level } : typeof level === 'number' ? { enabled: true, intensity: level } : level;
  opts = mergeBlur(opts, patch);
  persist();
  apply(true);
}

export function toggleBlur(): void { setBlur(!opts.enabled); }

function touch(): void {
  const wasIdleBlur = !opts.enabled && opts.autoOnIdle.enabled && active;
  lastActivity = Date.now();
  if (wasIdleBlur) apply(); // activity ends an idle blur immediately
}

function onKey(e: KeyboardEvent): void {
  if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    e.stopPropagation();
    toggleBlur();
  }
}

export function mountPrivacyBlur(): void {
  if (mounted) return;
  mounted = true;
  const load = async () => {
    try {
      if (!hasStorage()) return;
      opts = normalizeBlur((await chrome.storage.local.get(BLUR_KEY))?.[BLUR_KEY]);
    } catch { /* keep defaults */ }
    apply(true);
  };
  void load();
  try {
    if (hasStorage()) {
      chrome.storage.onChanged.addListener((ch, area) => {
        if (area === 'local' && ch[BLUR_KEY]) { opts = normalizeBlur(ch[BLUR_KEY].newValue); apply(true); }
      });
    }
  } catch { /* ignore */ }

  document.addEventListener('keydown', onKey, true);
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const) document.addEventListener(ev, touch, { capture: true, passive: true });
  window.addEventListener('blur', () => apply());
  window.addEventListener('focus', () => { touch(); apply(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) touch(); apply(); });
  window.setInterval(() => { if (opts.autoOnIdle.enabled && !opts.enabled) apply(); }, IDLE_CHECK_MS);
}
