# CLAUDE.md — WhatsApp Web Toolkit by Irvandoda

Mulai dengan membaca `HANDOFF.md` (status, keputusan, pekerjaan tertunda) lalu `README.md`.

## Aturan kerja
- Bahasa: balas pemilik dalam Bahasa Indonesia; teks UI ekstensi Bahasa Indonesia.
- Stack: TypeScript, Vite + CRXJS (MV3), React 18, Dexie, Vitest (jsdom). Sumber di `app/`.
- Verifikasi sebelum klaim selesai: `npm run typecheck`, `npm test`, `npm run build:full`. Laporkan jujur bila ada yang gagal; jangan klaim "teruji" untuk perilaku WhatsApp Web asli (belum pernah diuji di browser).
- `npm run build:full` MENULIS ke root repo (menghapus artefak lama dulu). Jangan jalankan dua build bersamaan. Root repo = build full yang di-commit.
- Fitur yang bergantung pada internal WhatsApp harus *feature-detected* dan mengembalikan "tidak tersedia" — jangan pernah memalsukan sukses.
- Keamanan/privasi: tanpa `innerHTML` untuk data dinamis, cek `sender.id` pada pesan runtime, tidak ada data keluar dari browser, hormati opt-out, pengaman kirim (jeda, batas, kill switch) tidak boleh dilonggarkan diam-diam.
- Jangan menyalin kode dari ekstensi pihak ketiga (mis. SessionBox); hanya konsepnya.
- Tambah halaman overlay baru → daftarkan di `vite.config.ts`, `manifest.config.ts`, `content/overlay.ts`, `background/ui-open.ts`, `content/dock.ts`.
- Tambah modul background baru → masukkan ke `MODULES` di `app/background/index.ts` dan ke regex skip listener lama.
- Tabel data → bungkus dengan `ScrollTable`.
- Jangan pernah menaruh token/kata sandi di repo. PAT lama sudah bocor di percakapan; minta yang baru.
- Commit: pesan ringkas, trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
