import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import type { PosMsg } from '../shared/pos-types';

export async function send<T>(m: PosMsg): Promise<T> {
  const r = (await chrome.runtime.sendMessage(m)) as T & { error?: string };
  if (r && typeof r === 'object' && 'error' in r && typeof r.error === 'string') throw new Error(r.error);
  return r;
}

export function useLive<T>(fn: () => Promise<T>, init: T): T {
  const [v, setV] = useState<T>(init);
  useEffect(() => {
    const sub = liveQuery(fn).subscribe({ next: setV, error: () => {} });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}

export function download(name: string, data: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

/** Downscale an image file to a JPEG data URL of at most ~150KB. */
export async function downsizePhoto(file: File, maxBytes = 150 * 1024): Promise<string> {
  const bmp = await createImageBitmap(file);
  let side = 320, q = 0.8;
  for (let i = 0; i < 8; i++) {
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', q);
    if (url.length * 0.75 <= maxBytes) return url;
    side = Math.round(side * 0.75); q = Math.max(0.4, q - 0.1);
  }
  throw new Error('Foto terlalu besar');
}

export const toLocalInput = (ts: number) => {
  const d = new Date(ts), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
