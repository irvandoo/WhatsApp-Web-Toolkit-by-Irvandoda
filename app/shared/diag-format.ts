import type { ProbeResult, SendResult } from './messages';

const ERRORS: Record<string, string> = {
  'no-tab': 'Tab WhatsApp Web tidak ditemukan. Buka web.whatsapp.com dulu.',
  'no-receiver': 'Tab WhatsApp Web belum siap (muat ulang tab) atau ini versi Store tanpa fitur ini.',
  'no-response': 'Tidak ada jawaban dari tab WhatsApp Web.',
  timeout: 'Waktu habis menunggu WhatsApp Web.',
  'send-unavailable': 'Tidak ada cara kirim senyap yang tersedia (internal WhatsApp berubah).',
  'send-failed': 'WhatsApp menolak/gagal mengirim.',
  'chat-not-found': 'Chat sendiri tidak ditemukan.',
  'account-unknown': 'Akun WhatsApp belum terdeteksi (login dulu).',
  'composer-busy': 'Kotak pesan sedang berisi draft, makro DOM dibatalkan.',
};
export const diagError = (code: string): string => ERRORS[code] ?? code;

/** Plain-Indonesian check list: one line per probed item, grouped, with a verdict line first. */
export function formatProbe(r: ProbeResult): string {
  const lines: string[] = [];
  const send = r.items.filter((i) => i.group === 'Kirim pesan' && i.found && i.type === 'function' && i.name.includes('.'));
  lines.push(send.length ? `Kemungkinan kirim senyap: ADA (${send.length} fungsi kirim ditemukan)` : 'Kemungkinan kirim senyap: TIDAK ADA fungsi kirim yang ditemukan');
  lines.push(`Store WhatsApp: ${r.store ? 'terdeteksi' : 'TIDAK terdeteksi'} | Akun: ${r.accountId ?? 'belum terdeteksi'} | Tab tersembunyi: ${r.hidden ? 'ya' : 'tidak'}`);
  let g = '';
  for (const i of r.items) {
    if (i.group !== g) { g = i.group; lines.push('', `[${g}]`); }
    lines.push(`${i.found ? '✔' : '✘'} ${i.name}${i.found ? ` (${i.type})` : ' (tidak ditemukan)'}`);
  }
  return lines.join('\n');
}

export function formatSelfTest(r: SendResult | { error: string }): string {
  if (!('method' in r)) return `✘ Kirim uji gagal: ${diagError(r.error)}`;
  return `${r.ok ? '✔' : '✘'} Kirim uji: metode ${r.method}; ${r.verified ? '✔ terverifikasi muncul di chat' : '✘ belum terverifikasi muncul di chat (bisa jadi terlambat; cek chat Anda)'}`;
}
