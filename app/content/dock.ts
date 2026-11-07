import { mountNavItems, TOOLKIT_GLYPH, type NavItemHandle, type NavItemSpec } from './nav-button';
import { openOverlay } from './overlay';
import { IS_FULL } from '../shared/credit';
import { currentSlot, openSwitcher } from './switcher';
import { getAutoReplyState, onAutoReplyState } from './autoreply';
import { getBlurState, onBlurState, setBlur } from './privacy-blur';

/**
 * Module dock: puts the toolkit modules directly on WhatsApp's navbar (one item each).
 * If the navbar cannot be found, subscribers (the floating panel) render the same items as a compact strip.
 */

export const PREF_KEY = 'wwt-dock';
const POLL_MS = 30_000;
const GREEN = '#25d366';
const AMBER = '#f2b84b';

export interface DockDef { id: string; label: string; iconPath: string; stroke?: boolean }
export const DOCK_DEFS: DockDef[] = [
  { id: 'account', label: 'Akun', stroke: true, iconPath: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21c0-4 4-6 8-6s8 2 8 6' },
  { id: 'unanswered', label: 'Belum dibalas', stroke: true, iconPath: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2' },
  { id: 'autoreply', label: 'Auto-reply', stroke: true, iconPath: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z' },
  { id: 'crm', label: 'CRM', stroke: true, iconPath: 'M9 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM2.5 20c.6-3.5 3.2-5.5 6.5-5.5s5.9 2 6.5 5.5M17 11a3 3 0 1 0 0-6M18.5 14.7c1.8.6 3 2.3 3.3 5' },
  { id: 'analytics', label: 'Analitik', stroke: true, iconPath: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6' },
  { id: 'templates', label: 'Template', stroke: true, iconPath: 'M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V5a1 1 0 0 1 1-1ZM8 9h8M8 12h5' },
  { id: 'blast', label: 'Blast & Jadwal', stroke: true, iconPath: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1ZM15 9a4 4 0 0 1 0 6M18 7a7 7 0 0 1 0 10' },
  { id: 'pos', label: 'POS', stroke: true, iconPath: 'M3 4h2l2.4 11h10.2l2-8H6.2M9 19.2h.01M17 19.2h.01' },
  ...(IS_FULL ? [{ id: 'groups', label: 'Ekstrak Grup', stroke: true, iconPath: 'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM2 20c.5-3 2.7-5 6-5s5.5 2 6 5M16 11a3 3 0 1 0 0-6M17 15c2.3.3 4 2 4.5 5' }] : []),
  { id: 'presets', label: 'Preset Industri', stroke: true, iconPath: 'M12 3l2.1 5.4L20 10l-5.9 1.6L12 17l-2.1-5.4L4 10l5.9-1.6L12 3Z' },
  { id: 'blur', label: 'Privacy Blur', stroke: true, iconPath: 'M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a14 14 0 0 1-3 3.8M6.5 7.6A14 14 0 0 0 2.5 12c1 2 4.5 6 9.5 6 1.5 0 2.8-.4 4-.9M9.9 9.9a3 3 0 0 0 4.2 4.2' },
  { id: 'toolkit', label: 'Toolkit', iconPath: TOOLKIT_GLYPH },
];
/** Items the user may hide (the Toolkit entry always stays, it opens the panel that holds the setting). */
export const TOGGLEABLE = DOCK_DEFS.filter((d) => d.id !== 'toolkit');

export type DockPrefs = Record<string, boolean>;

/** Missing/invalid -> visible. Only an explicit `false` hides an item. */
export function normalizePrefs(raw: unknown): DockPrefs {
  const out: DockPrefs = {};
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const d of TOGGLEABLE) out[d.id] = r[d.id] !== false;
  return out;
}

const hasStorage = () => { try { return !!chrome.storage?.local; } catch { return false; } };
const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };

export async function loadDockPrefs(): Promise<DockPrefs> {
  try {
    if (!hasStorage()) return normalizePrefs(null);
    const r = await chrome.storage.local.get(PREF_KEY);
    return normalizePrefs(r?.[PREF_KEY]);
  } catch { return normalizePrefs(null); }
}
export async function saveDockPrefs(p: DockPrefs): Promise<void> {
  try { if (hasStorage()) await chrome.storage.local.set({ [PREF_KEY]: normalizePrefs(p) }); } catch { /* ignore */ }
}

export interface Counts { unanswered: number; urgent: number; newLeadsToday: number }
export function parseCounts(r: unknown): Counts | null {
  const o = r as Partial<Counts> | null;
  if (!o || typeof o.unanswered !== 'number' || !Number.isFinite(o.unanswered)) return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return { unanswered: n(o.unanswered), urgent: n(o.urgent), newLeadsToday: n(o.newLeadsToday) };
}

// ---- auto-reply wiring (defaults to ./autoreply; registerDockProvider overrides, used by tests) ----
export interface ArState { enabled: boolean; autoSend: boolean }
export interface DockProviders { autoReply?: { get(): ArState; on(cb: (s: ArState) => void): () => void } }
let providers: DockProviders = { autoReply: { get: getAutoReplyState, on: onAutoReplyState } };
let rebind: (() => void) | null = null;
export function registerDockProvider(p: DockProviders): void { providers = { ...providers, ...p }; rebind?.(); }

export interface DockView {
  id: string; label: string; iconPath: string; stroke?: boolean;
  badge: number | string | null; badgeColor?: string;
  dot: boolean; dotColor?: string; hidden: boolean;
  click(el: HTMLElement): void;
}

export interface Dock {
  setToolkitPressed(on: boolean): void;
  focusToolkit(): void;
  /** true when the items live in WhatsApp's navbar */
  present(): boolean;
  views(): DockView[];
  /** called on any change (badges, prefs, navbar presence). Returns unsubscribe. */
  subscribe(fn: () => void): () => void;
  handles: Record<string, NavItemHandle>;
}

export function mountDock(o: { onToolkit: () => void; onPresence?: (present: boolean) => void }): Dock {
  const clicks: Record<string, (el: HTMLElement) => void> = {
    account: (el) => openSwitcher(el),
    unanswered: () => openOverlay('analytics', 'unanswered'),
    autoreply: () => openOverlay('autoreply'),
    crm: () => openOverlay('crm'),
    analytics: () => openOverlay('analytics'),
    templates: () => openOverlay('templates'),
    blast: () => openOverlay('blast'),
    pos: () => openOverlay('pos'),
    groups: () => openOverlay('groups'),
    presets: () => openOverlay('presets'),
    blur: () => setBlur(!getBlurState().opts.enabled),
    toolkit: () => o.onToolkit(),
  };
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((f) => { try { f(); } catch { /* ignore */ } });

  const specs: NavItemSpec[] = DOCK_DEFS.map((d) => ({ ...d, onClick: clicks[d.id] }));
  const nav = mountNavItems(specs, (p) => { o.onPresence?.(p); emit(); });
  const h = nav.handles;

  const view: Record<string, Pick<DockView, 'badge' | 'badgeColor' | 'dot' | 'dotColor' | 'hidden'>> = {};
  for (const d of DOCK_DEFS) view[d.id] = { badge: null, dot: false, hidden: false };

  const setBadge = (id: string, v: number | string | null, color?: string) => {
    view[id].badge = v; view[id].badgeColor = color; h[id].setBadge(v, color); emit();
  };

  // prefs
  const applyPrefs = (p: DockPrefs) => {
    for (const d of TOGGLEABLE) { const hid = p[d.id] === false; view[d.id].hidden = hid; h[d.id].setHidden(hid); }
    emit();
  };
  void loadDockPrefs().then(applyPrefs);
  try {
    if (hasStorage()) {
      chrome.storage.onChanged.addListener((ch, area) => {
        if (area === 'local' && ch[PREF_KEY]) applyPrefs(normalizePrefs(ch[PREF_KEY].newValue));
      });
    }
  } catch { /* ignore */ }

  // account slot
  const refreshSlot = async () => {
    try {
      const s = await currentSlot();
      const ini = (s.label || '?').trim().slice(0, 2).toUpperCase() || '?';
      setBadge('account', ini, s.color || undefined);
    } catch { /* ignore */ }
  };
  void refreshSlot();

  // auto-reply dot
  let unbindAr: (() => void) | null = null;
  const bindAr = () => {
    const ar = providers.autoReply;
    if (!ar) return;
    unbindAr?.();
    const apply = (s: ArState) => {
      view.autoreply.dot = !!s.enabled;
      view.autoreply.dotColor = s.autoSend ? GREEN : AMBER;
      h.autoreply.setActive(!!s.enabled, s.autoSend ? GREEN : AMBER);
      emit();
    };
    try { apply(ar.get()); unbindAr = ar.on(apply); } catch { /* ignore */ }
  };
  rebind = bindAr;
  bindAr();

  // privacy blur: pressed + dot while blur is applied (manual or auto)
  const applyBlur = (s: { active: boolean }) => {
    view.blur.dot = s.active; view.blur.dotColor = GREEN;
    h.blur.setPressed(s.active);
    emit();
  };
  try { applyBlur(getBlurState()); onBlurState(applyBlur); } catch { /* ignore */ }

  // counts (every 30s, only while the tab is visible; one cheap background query each)
  let busy = false;
  const poll = async () => {
    if (busy || document.visibilityState === 'hidden' || !alive()) return;
    busy = true;
    try {
      const c = parseCounts(await chrome.runtime.sendMessage({ kind: 'ui:counts' }));
      if (c) setBadge('unanswered', c.unanswered > 0 ? c.unanswered : null, c.urgent > 0 ? '#d92d20' : '#667781');
    } catch { /* background asleep / context invalidated */ } finally { busy = false; }
  };
  setTimeout(() => void poll(), 3000);
  window.setInterval(() => void poll(), POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { void poll(); void refreshSlot(); } });

  return {
    handles: h,
    setToolkitPressed: (on) => h.toolkit.setPressed(on),
    focusToolkit: () => h.toolkit.focus(),
    present: () => nav.present(),
    views: () => DOCK_DEFS.map((d) => ({ ...d, ...view[d.id], click: clicks[d.id] })),
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
