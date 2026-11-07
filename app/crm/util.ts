import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import type { CrmMsg } from '../shared/crm-types';
import type { RcpMsg } from '../shared/messages';

export const send = <T,>(m: CrmMsg): Promise<T> => chrome.runtime.sendMessage(m) as Promise<T>;
export const rcp = <T,>(m: RcpMsg): Promise<T> => chrome.runtime.sendMessage(m) as Promise<T>;
export const idr = (n: number) => 'Rp ' + (n || 0).toLocaleString('id-ID');
export const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export function useLive<T>(fn: () => Promise<T>, init: T): T {
  const [v, setV] = useState<T>(init);
  useEffect(() => {
    const sub = liveQuery(fn).subscribe({ next: setV, error: () => {} });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}

export function download(name: string, data: string, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const WHY: Record<string, string> = {
  'no-tab': 'Buka tab WhatsApp Web terlebih dahulu.',
  'no-receiver': 'Tab WhatsApp Web belum siap. Muat ulang tab WhatsApp lalu coba lagi.',
  'no-response': 'Tidak ada respons dari WhatsApp Web.',
  'no-labels': 'Label tidak tersedia: hanya untuk akun WhatsApp Business, atau struktur WhatsApp Web berubah.',
  'store-flavor': 'Ekstraksi grup hanya ada di versi Full.',
  store: 'Data WhatsApp Web belum siap. Tunggu daftar chat tampil lalu coba lagi.',
};
export const why = (r?: string) => WHY[r ?? ''] ?? `Tidak tersedia${r ? ` (${r})` : ''}.`;
export const isUn = (x: unknown): x is { unavailable: true; reason?: string } => !!x && (x as { unavailable?: boolean }).unavailable === true;
export const reasonOf = (x: unknown) => (x as { reason?: string } | undefined)?.reason;
