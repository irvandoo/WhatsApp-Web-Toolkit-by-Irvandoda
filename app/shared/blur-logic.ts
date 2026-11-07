/** Privacy Blur: pure state/CSS logic (no DOM). */
export const BLUR_KEY = 'wwt-blur';
export const BLUR_MIN = 4;
export const BLUR_MAX = 16;

export interface BlurTargets { chatList: boolean; messages: boolean; names: boolean; avatars: boolean; composer: boolean }
export interface BlurOptions {
  enabled: boolean;
  targets: BlurTargets;
  intensity: number;          // px, 4..16
  revealOnHover: boolean;
  onInactive: boolean;        // blur while the window/tab is not active
  autoOnIdle: { enabled: boolean; minutes: number };
}

export const DEFAULT_BLUR: BlurOptions = {
  enabled: false,
  targets: { chatList: true, messages: true, names: true, avatars: true, composer: false },
  intensity: 8,
  revealOnHover: true,
  onInactive: false,
  autoOnIdle: { enabled: false, minutes: 2 },
};

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

export function normalizeBlur(raw: unknown): BlurOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const t = (r.targets && typeof r.targets === 'object' ? r.targets : {}) as Record<string, unknown>;
  const a = (r.autoOnIdle && typeof r.autoOnIdle === 'object' ? r.autoOnIdle : {}) as Record<string, unknown>;
  const D = DEFAULT_BLUR;
  return {
    enabled: bool(r.enabled, D.enabled),
    targets: {
      chatList: bool(t.chatList, D.targets.chatList), messages: bool(t.messages, D.targets.messages),
      names: bool(t.names, D.targets.names), avatars: bool(t.avatars, D.targets.avatars), composer: bool(t.composer, D.targets.composer),
    },
    intensity: clamp(r.intensity, BLUR_MIN, BLUR_MAX, D.intensity),
    revealOnHover: bool(r.revealOnHover, D.revealOnHover),
    onInactive: bool(r.onInactive, D.onInactive),
    autoOnIdle: { enabled: bool(a.enabled, false), minutes: clamp(a.minutes, 1, 120, D.autoOnIdle.minutes) },
  };
}

/** Merge a patch (shallow for top-level, merged for targets/autoOnIdle) and normalize. */
export function mergeBlur(cur: BlurOptions, patch: Partial<Omit<BlurOptions, 'targets' | 'autoOnIdle'>> & { targets?: Partial<BlurTargets>; autoOnIdle?: Partial<BlurOptions['autoOnIdle']> }): BlurOptions {
  return normalizeBlur({ ...cur, ...patch, targets: { ...cur.targets, ...patch.targets }, autoOnIdle: { ...cur.autoOnIdle, ...patch.autoOnIdle } });
}

/** Whether blur is currently applied. `windowActive` = tab visible and focused; `idleMs` = ms since last user activity. */
export function isBlurActive(o: BlurOptions, ctx: { windowActive: boolean; idleMs: number }): boolean {
  if (o.enabled) return true;
  if (o.onInactive && !ctx.windowActive) return true;
  if (o.autoOnIdle.enabled && ctx.idleMs >= o.autoOnIdle.minutes * 60_000) return true;
  return false;
}

// Robust selectors: stable attributes only (id, role, data-testid, aria), never WA's hashed classes.
// Rows are blurred (not scroll containers) so scrolling/virtualization are untouched. Nested targets are excluded
// so a filter never compounds.
const CHAT_ROW = '#pane-side [role="listitem"]';
const MSG_ROW = '#main [data-id]:not([data-id] *)';
const NAME = ['#main header [data-testid="conversation-info-header-chat-title"]', '#main header span[title]', '#pane-side span[title]'];
const AVATAR = ['#pane-side img', '#main header img', '#main [data-testid^="default-"]', '#pane-side [data-testid^="default-"]', '#main [data-id] img[draggable="false"]'];
const COMPOSER = '#main footer';

export function blurSelectors(t: BlurTargets): string[] {
  const out: string[] = [];
  if (t.chatList) out.push(CHAT_ROW);
  if (t.messages) out.push(MSG_ROW);
  if (t.composer) out.push(COMPOSER);
  // avoid compounding with blurred ancestors
  const inBlurred = (s: string) => (t.chatList && s.startsWith('#pane-side')) || (t.messages && s.startsWith('#main [data-id]')) || (t.composer && s.startsWith('#main footer'));
  if (t.names) out.push(...NAME.filter((s) => !inBlurred(s)));
  if (t.avatars) out.push(...AVATAR.filter((s) => !inBlurred(s)));
  return out;
}

export function buildBlurCss(o: BlurOptions): string {
  const sels = blurSelectors(o.targets);
  if (!sels.length) return '';
  let css = `${sels.join(',\n')}{filter:blur(${o.intensity}px) !important;transition:filter .15s ease}\n`;
  if (o.revealOnHover) css += `${sels.map((s) => `${s}:hover,\n${s}:focus-within`).join(',\n')}{filter:none !important}\n`;
  return css;
}
