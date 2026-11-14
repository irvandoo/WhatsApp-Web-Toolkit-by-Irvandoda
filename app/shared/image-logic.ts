import type { MediaInput } from './outbox-types';

/** Pure helpers for blast images. The canvas work lives in `app/blast/image-prep.ts` (needs a DOM). */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // stored size after compression
export const MAX_IMAGE_SIDE = 1600;             // px, longest side after resize
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** Longest side capped at `max`, aspect ratio kept, never upscaled. */
export function fitSize(w: number, h: number, max = MAX_IMAGE_SIDE): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Decoded byte size of a base64 data URL (0 when it is not one). */
export function dataUrlBytes(dataUrl: string): number {
  const m = DATA_URL.exec(dataUrl);
  if (!m) return 0;
  const b64 = m[2];
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
}

export const dataUrlMime = (dataUrl: string): string | null => DATA_URL.exec(dataUrl)?.[1] ?? null;

/** Strict check used by the planner AND the background: only real image data URLs within the size cap. */
let lastValid: { url: string; mime: string } | null = null; // the UI re-validates the same multi-MB string on every keystroke
export function isValidMedia(m: MediaInput | undefined | null): boolean {
  if (!m || typeof m.dataUrl !== 'string' || !IMAGE_MIMES.includes(m.mime)) return false;
  if (lastValid && lastValid.url === m.dataUrl && lastValid.mime === m.mime) return true;
  if (dataUrlMime(m.dataUrl) !== m.mime) return false;
  const n = dataUrlBytes(m.dataUrl);
  const ok = n > 0 && n <= MAX_IMAGE_BYTES;
  if (ok) lastValid = { url: m.dataUrl, mime: m.mime };
  return ok;
}

export const formatBytes = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Data URL -> Blob (used by the WA adapter / composer paste). */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = DATA_URL.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: m[1] });
}
