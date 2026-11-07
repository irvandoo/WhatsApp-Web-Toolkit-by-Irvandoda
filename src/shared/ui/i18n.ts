import type { RuntimeMsg } from '../messages';

const id = {
  hub: 'Hub Akun', openHub: 'Buka Hub', openWA: 'Buka WhatsApp Web',
  tabAccounts: 'Akun', tabSessions: 'Sesi tersimpan', tabRegistry: 'Registry', tabAbout: 'Tentang',
  total: 'Total akun', online: 'Online', unread: 'Belum dibaca', offline: 'Offline',
  search: 'Cari akun…', filterGroup: 'Filter grup', allGroups: 'Semua grup', noGroup: 'Tanpa grup',
  noAccounts: 'Belum ada akun. Buka WhatsApp Web dan akun akan muncul otomatis.',
  name: 'Nama', waId: 'ID WhatsApp', profile: 'Profil Chrome', note: 'Catatan', chats: 'Chat', lastSeen: 'Terakhir terlihat',
  group: 'Grup', color: 'Warna', deleteAcc: 'Hapus akun', confirmDeleteAcc: 'Hapus akun ini dari registry?',
  groups: 'Kelola grup', newGroup: 'Nama grup baru', add: 'Tambah', rename: 'Nama grup', delete: 'Hapus', confirmDeleteGroup: 'Hapus grup ini? Akun di dalamnya menjadi tanpa grup.',
  never: 'belum pernah', justNow: 'baru saja', sAgo: 'dtk lalu', mAgo: 'mnt lalu', hAgo: 'jam lalu', dAgo: 'hari lalu',
  expTitle: 'EKSPERIMENTAL', expBody: 'Snapshot sesi berisi kredensial akun WhatsApp Anda. Siapa pun yang memegang data ini bisa mengambil alih akun. Fitur ini mungkin tidak didukung WhatsApp dan bisa membuat Anda logout atau akun dibatasi. Pemulihan (restore) dilakukan dari panel di tab WhatsApp, bukan di sini.',
  noSessions: 'Belum ada sesi tersimpan.', label: 'Label', created: 'Dibuat', size: 'Ukuran', account: 'Akun', unknownAcc: '(akun tidak dikenal)', confirmDeleteSession: 'Hapus sesi tersimpan ini?',
  regTitle: 'Ekspor / impor registry',
  regExplain: 'Setiap Profil Chrome memiliki data terpisah, sehingga registry akun di tiap profil juga terpisah. Gunakan ekspor di satu profil lalu impor di profil lain untuk menggabungkan registry.',
  export: 'Ekspor registry (JSON)', import: 'Impor registry', importing: 'Mengimpor…', importOk: 'Impor berhasil.', failed: 'Gagal', exported: 'File diunduh.',
  aboutBuild: 'Build', author: 'Pembuat',
} as const;
export type Strings = { [K in keyof typeof id]: string };
const en: Strings = {
  ...id, hub: 'Account Hub', openHub: 'Open Hub', openWA: 'Open WhatsApp Web', tabAccounts: 'Accounts', tabSessions: 'Saved sessions', tabAbout: 'About',
  total: 'Total accounts', unread: 'Unread', search: 'Search accounts…', allGroups: 'All groups', noGroup: 'No group',
};
const dict: Record<string, Strings> = { id, en };
export const LANG = 'id'; // switch to 'en' (or read from storage) to change language
export const t: Strings = dict[LANG];

export function relTime(ts: number, now = Date.now()): string {
  if (!ts) return t.never;
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 10) return t.justNow;
  if (s < 60) return `${s} ${t.sAgo}`;
  if (s < 3600) return `${Math.floor(s / 60)} ${t.mAgo}`;
  if (s < 86400) return `${Math.floor(s / 3600)} ${t.hAgo}`;
  return `${Math.floor(s / 86400)} ${t.dAgo}`;
}
export function send<T = unknown>(msg: RuntimeMsg): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}
