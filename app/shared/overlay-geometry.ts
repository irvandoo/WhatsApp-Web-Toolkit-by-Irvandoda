/** Pure geometry helpers for the in-page overlay window (no DOM access). */
export interface Geo { x: number; y: number; w: number; h: number }
export type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export type SizePreset = 'compact' | 'medium' | 'wide';

export const MIN_W = 560;
export const MIN_H = 380;
export const HEADER_KEEP = 80;
export const STEP = 40;
export const STORE_KEY = 'wwt-ov-geo';

export const DEFAULT_SIZES: Record<string, [number, number]> = {
  analytics: [1120, 720], crm: [1100, 700], blast: [1040, 700], pos: [1080, 720], groups: [1000, 680],
  autoreply: [980, 680], templates: [900, 640], presets: [980, 680], dashboard: [960, 660],
};
const FALLBACK: [number, number] = [980, 680];

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Minimum size, reduced on tiny viewports so it never exceeds the viewport. */
export const minSize = (vw: number, vh: number): { w: number; h: number } => ({ w: Math.min(MIN_W, vw), h: Math.min(MIN_H, vh) });

/** Clamp a size to [min, max]; `soft` caps at 92vw x 90vh (defaults), otherwise at the viewport (user resize). */
export function clampSize(w: number, h: number, vw: number, vh: number, soft = true): { w: number; h: number } {
  const m = minSize(vw, vh);
  const mw = soft ? Math.floor(vw * 0.92) : vw, mh = soft ? Math.floor(vh * 0.9) : vh;
  return { w: Math.round(clamp(w, m.w, mw)), h: Math.round(clamp(h, m.h, mh)) };
}

/** Keep the whole window inside the viewport. */
export function clampGeo(g: Geo, vw: number, vh: number): Geo {
  const { w, h } = clampSize(g.w, g.h, vw, vh, false);
  return { w, h, x: Math.round(clamp(g.x, 0, vw - w)), y: Math.round(clamp(g.y, 0, vh - h)) };
}

/** Moving: window may leave the viewport as long as HEADER_KEEP px of the header stay visible. */
export function clampMove(g: Geo, vw: number, vh: number): Geo {
  return {
    w: g.w, h: g.h,
    x: Math.round(clamp(g.x, HEADER_KEEP - g.w, vw - HEADER_KEEP)),
    y: Math.round(clamp(g.y, 0, vh - 40)),
  };
}

export const center = (w: number, h: number, vw: number, vh: number): Geo =>
  ({ w, h, x: Math.round(Math.max(0, (vw - w) / 2)), y: Math.round(Math.max(0, (vh - h) / 2)) });

export function defaultSize(page: string, vw: number, vh: number): { w: number; h: number } {
  const [w, h] = DEFAULT_SIZES[page] ?? FALLBACK;
  return clampSize(w, h, vw, vh, true);
}
export const defaultGeo = (page: string, vw: number, vh: number): Geo => { const s = defaultSize(page, vw, vh); return center(s.w, s.h, vw, vh); };

export function presetGeo(preset: SizePreset, page: string, vw: number, vh: number): Geo {
  const d = defaultSize(page, vw, vh);
  if (preset === 'medium') return center(d.w, d.h, vw, vh);
  if (preset === 'compact') { const s = clampSize(d.w * 0.7, d.h * 0.7, vw, vh, true); return center(s.w, s.h, vw, vh); }
  const s = clampSize(Math.min(vw * 0.96, 1400), Math.min(vh * 0.92, 900), vw, vh, false);
  return center(s.w, s.h, vw, vh);
}

export const maximizedGeo = (vw: number, vh: number): Geo => ({ x: 0, y: 0, w: vw, h: vh });

/** Resize from an edge/corner by a pointer delta; the opposite edge stays anchored. */
export function resizeEdge(start: Geo, edge: Edge, dx: number, dy: number, vw: number, vh: number): Geo {
  const m = minSize(vw, vh);
  let { x, y, w, h } = start;
  if (edge.includes('e')) w = clamp(start.w + dx, m.w, vw - start.x);
  if (edge.includes('w')) { const r = start.x + start.w; x = clamp(start.x + dx, 0, r - m.w); w = r - x; }
  if (edge.includes('s')) h = clamp(start.h + dy, m.h, vh - start.y);
  if (edge.includes('n')) { const b = start.y + start.h; y = clamp(start.y + dy, 0, b - m.h); h = b - y; }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** Keyboard: Alt+Arrow resizes (right/down grow), Alt+Shift+Arrow moves. */
export function keyAdjust(g: Geo, key: string, move: boolean, vw: number, vh: number): Geo | null {
  const dx = key === 'ArrowRight' ? STEP : key === 'ArrowLeft' ? -STEP : 0;
  const dy = key === 'ArrowDown' ? STEP : key === 'ArrowUp' ? -STEP : 0;
  if (!dx && !dy) return null;
  if (move) return clampMove({ ...g, x: g.x + dx, y: g.y + dy }, vw, vh);
  return clampGeo({ ...g, w: g.w + dx, h: g.h + dy }, vw, vh);
}

export const isGeo = (v: unknown): v is Geo => {
  const g = v as Geo | null;
  return !!g && typeof g === 'object' && num(g.x) && num(g.y) && num(g.w) && num(g.h) && g.w > 0 && g.h > 0;
};

/** Parse persisted JSON; drops invalid entries, re-clamps valid ones. Never throws. */
export function parseStore(raw: string | null | undefined, vw: number, vh: number): Record<string, Geo> {
  const out: Record<string, Geo> = {};
  if (!raw) return out;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k in DEFAULT_SIZES && isGeo(v)) out[k] = clampGeo(v, vw, vh);
    }
  } catch { /* corrupt */ }
  return out;
}
