# HANDOFF — WhatsApp Web Toolkit by Irvandoda

Dokumen serah terima untuk melanjutkan pekerjaan di sesi/akun Claude lain. Terakhir diperbarui: 7 Nov 2026.
Baca juga `CLAUDE.md` (konvensi proyek) dan `README.md` (gambaran fitur untuk pengguna).

> **STATUS CHECKPOINT TERAKHIR:** semua pekerjaan terpasang. Typecheck bersih, 437 tes lolos, `build:full` (root, IS_FULL=true) dan `build:store` (dist/store) lolos, `npm run audit:contrast` lolos. Baru ditambah: tema lembut bersama (`app/shared/ui/theme.css`), Analitik + tab Statistik, **Mode Otomatis** (indikator di navbar/panel/popup/badge, `app/shared/runmode.ts`, `app/content/engine-health.ts`, `app/content/status.ts`) dan halaman **Mulai cepat** (`app/quickstart`). **Belum ada yang diuji di WhatsApp Web asli.** Langkah berikutnya: muat folder root di Chrome, jalankan *Diagnostik pengirim* (Auto-reply) dan kirim hasil 'Salin hasil'. Belum dibuat: sinkron otomatis terjadwal, asisten AI, webhook, ikon/screenshot Web Store. Notifikasi kecil di halaman WA (autoreply.ts/outbox.ts/switcher.ts) masih memakai warna lama.

> **Catatan multi-akun (penting):** daftar akun (slot) ada di IndexedDB milik EKSTENSI (id ekstensi = pemilik), sedangkan data login tiap slot ada di penyimpanan origin WhatsApp (`wwt:<id>:…`). Build full memakai `key` manifest tetap (id `meeiajdoggeaegfkkjifpmhdikflfghg`, `scripts/extension-key.json`, hanya kunci publik) supaya id tidak berubah antar folder muat. Jika daftar hilang (ganti id/reinstall), `syncRegistry()` di `app/content/slot-status.ts` memulihkan slot yatim otomatis dan menyimpan cermin label di localStorage WA (`wwt-slots-mirror`). Build ulang TIDAK menghapus data login. Build store tidak memakai `key`.

## 1. Ringkasan proyek
Ekstensi Chrome (Manifest V3) untuk `https://web.whatsapp.com/`, fokus marketing WhatsApp. Pemilik: Irvando Demas Arifiandani (`irvandoda`, irvando.d.a@gmail.com, irvandoda.web.id). Repo: https://github.com/irvandoo/WhatsApp-Web-Toolkit-by-Irvandoda (publik, branch `main`).
Bahasa UI: Indonesia. Pengguna berbicara Bahasa Indonesia; jawab dalam Bahasa Indonesia.

## 2. Keputusan penting (jangan dibalik tanpa alasan)
- **Root repo = build `full`** (semua fitur, siap "Load unpacked"). Build `store` ada di `dist/store` untuk Chrome Web Store (auto-kirim dimatikan: hanya menyiapkan draf di kolom chat). Pengguna akhir tidak perlu npm.
- Sumber di `app/` (root Vite). File hasil build di root (`assets/`, `popup/`, `manifest.json`, …) ikut di-commit.
- **Multi-akun = virtual namespace per tab** (konsep SessionBox, tanpa menyalin kodenya): `app/injected/virtual-session.ts` memberi awalan nama IndexedDB/localStorage/BroadcastChannel dengan slot id (`sessionStorage['wwt-sid']`). Snapshot sesi lama tidak dipakai (WA menyimpan `CryptoKey` yang tidak bisa diserialisasi). Satu akun aktif per tab.
- Data semuanya lokal (Dexie/IndexedDB). Tidak ada server. Tidak menyimpan isi pesan untuk analitik (hanya waktu & arah).
- Pengiriman otomatis hanya di build `full`, dengan pengaman: opt-in, jeda acak, batas per jam/hari, jendela jam, hormati opt-out, kill switch.
- UI modul tampil sebagai **overlay iframe di dalam halaman WA** (bukan tab baru) + tombol di **navbar WA** (kloning item navbar saat runtime). Fallback tombol mengambang di tengah-kanan.
- Tabel lebar memakai komponen bersama `app/shared/ui/ScrollTable.tsx` (scroll 4 arah, header sticky, tombol panah, drag-to-pan).

## 3. Cara bekerja
```bash
npm install            # memasang git hook (.githooks/pre-commit) bila core.hooksPath terpasang via "prepare"
npm run typecheck
npm test               # vitest (jsdom), ±240+ tes
npm run build:full     # tsc -> bersihkan artefak root -> vite build ke ROOT repo (hati-hati: menimpa root)
npm run build:store    # ke dist/store
npm run package        # release/*.zip (full + store)
```
- Muat ke Chrome: `chrome://extensions` → Developer mode → Load unpacked → pilih **folder root** repo. Setelah build, klik muat ulang.
- Jangan menjalankan dua build ke root bersamaan (saling menghapus).
- Commit memakai trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Token GitHub:** pemilik sebelumnya memakai PAT di sesi lama. Token itu SUDAH terlihat di percakapan dan harus dicabut/diganti. Minta token baru ke pemilik; jangan simpan di repo. Push tanpa menyimpan token: `git -c http.extraheader="Authorization: Basic $(printf 'x-access-token:%s' "$TOKEN" | base64 -w0)" push`.

## 4. Arsitektur singkat
```
app/
  injected/   wa-adapter.ts (MAIN world; akses internal WA, feature-detected), virtual-session.ts (MAIN, document_start, dikompilasi jadi app/public/virtual-session.js oleh plugin di vite.config.ts)
  content/    index.ts (mount semua), panel*.ts, dock.ts, nav-button.ts, overlay.ts, switcher.ts, tracker.ts, autoreply.ts, outbox.ts, composer*.ts, crm-bridge.ts, pos-bridge.ts, groups-bridge.ts, privacy-blur.ts, memory.ts, …
  background/ index.ts (router modul: MODULES[]), accounts, slots, crm, templates, track, autoreply, outbox, pos, groups, counts, leadintel, presets, ui-open
  shared/     db.ts (Dexie, versi 1–9+), messages.ts (bridge types), *-types.ts, *-logic.ts (+ tes), ui/ (ScrollTable, VariantEditor, …)
  dashboard/ crm/ templates/ analytics/ autoreply/ blast/ pos/ groups/ presets/ popup/ options/   halaman UI (React)
manifest.config.ts, vite.config.ts, scripts/ (clean-root, package, artifacts), .githooks/pre-commit
```
Alur pesan: halaman ekstensi/iframe → `chrome.runtime.sendMessage` → router di `background/index.ts` (cek `sender.id`), atau relay ke tab WA (`chrome.tabs.sendMessage` → content → `postMessage` bridge → adapter MAIN world). Daftar halaman overlay terdaftar di: `vite.config.ts` (input), `manifest.config.ts` (`web_accessible_resources`), `content/overlay.ts` (PAGES), `background/ui-open.ts`, `content/dock.ts` (item navbar).

## 5. Status modul
Terpasang & lulus typecheck/tes unit, **belum ada yang diuji di WhatsApp Web sungguhan**:
Sync Center + arsip lokal, memori, multi-akun (slot) + switcher, dock navbar + overlay (resizable), CRM (+lead intelligence), Template (+`/kode`, rotasi varian), Analitik (WA baru vs follow-up, belum dibalas, lead panas), Auto-reply, Blast & Jadwal, POS, Ekstrak Grup (full), Preset Industri, Privacy Blur, ScrollTable di semua tabel.

## 6. Pekerjaan yang diselesaikan di sesi terakhir (semua sudah terpasang)
1. **Ekspor laporan Analitik** (Excel .xlsx tanpa pustaka, teks WA, PDF, PNG): file di `app/analytics/**` dan `app/shared/report/*` (xlsx.ts, zip.ts, wa-text.ts, canvas-report.ts, pdf.ts + tes).
2. **Penerima Blast dari Label / Grup / Manual**: format otomatis nomor (`+62 857-4747-6308` → `6285747476308`), hapus duplikat otomatis; file `app/blast/RecipientPicker.tsx`, `app/shared/recipients-logic.ts`, adapter `labels:list`/`labels:chats`, relay `app/background/recipients-relay.ts` + `app/content/recipients-bridge.ts`.
   **Wiring yang mungkin belum dipasang:** di `background/index.ts` tambah `{ is: isRcpMsg, handle: handleRcp }` ke `MODULES` dan `rcp` ke regex skip; di `content/index.ts` panggil `mountRecipientsBridge()`.
3. **Manajemen produk POS (fisik/digital/jasa)**: varian, harga grosir, kode lisensi/voucher, kategori, stok & mutasi, impor/ekspor CSV, pengiriman digital otomatis; file `app/pos/products/*`, `app/shared/pos-products-logic.ts`, tabel Dexie baru (`categories`, `stockMoves`, `licenseCodes`).
4. **Format teks chat = preview** (`app/shared/wa-format.ts`, `app/content/composer-insert.ts` dengan paste event + fallback baris-per-baris, adopsi di pos-bridge/composer/outbox/autoreply, preview bubble WA di `app/pos/Invoice.tsx`).
5. **Auto-reply: filter scope pribadi/grup/semua** (pengaman grup ketat) + **kirim senyap** (rantai metode `send:text`, verifikasi pasca-kirim) + **Diagnostik pengirim** (`send:probe`, tombol uji kirim).
   **Wiring yang mungkin belum dipasang:** `background/diag.ts` (`isDiagMsg/handleDiag`, regex `diag`), `content/diag-bridge.ts` (`mountDiagBridge()`).
6. **Hub Akun: tambah akun langsung (scan QR) + CRUD penuh** (status slot: qr/online/offline, purge data sesi, bulk add, ekspor/impor registri); `app/dashboard/**`, `app/content/slot-status.ts`.
   **Wiring yang mungkin belum dipasang:** `mountSlotStatus()` di `content/index.ts`.
Setelah semuanya masuk: `npm run typecheck && npm test && npm run build:full && npm run package`, perbarui README, commit, push.

## 7. Hal yang BELUM terverifikasi (risiko terbesar)
- Nama modul internal WhatsApp Web (`WAWebCollections`, `WAWebChatLoadMessages`, fungsi kirim, grup/label, `check:registered`) adalah **tebakan** dari proyek whatsapp-web.js; WA dapat berubah kapan saja. Adapter mengembalikan "tidak tersedia" bila tidak ada. Langkah terbaik: jalankan **Diagnostik pengirim** / panel "W" di WA asli dan perbaiki dari hasilnya.
- Selector DOM (navbar `[data-testid="navbar-primary-section"]`, composer, header chat, QR) rapuh.
- Overlay iframe mungkin diblokir CSP WA → ada fallback "Buka di tab". Peringatan konsol "upgrade-insecure-requests … report-only" tidak berbahaya.
- Sinkron riwayat tidak bisa "dipaksa" melebihi batas yang diberikan WhatsApp; arsip lokal hanya menyimpan yang pernah termuat.
- Auto-kirim/blast berisiko pembatasan akun WhatsApp; pengaman default harus tetap aktif.

## 8. Ide berikutnya (belum dikerjakan)
Asisten AI (kunci API milik pengguna, opt-in), webhook keluar & Google Form (opt-in; ubah `PRIVACY.md`), leaderboard tim lokal, halaman "Mulai cepat" + cek update dari GitHub Releases, ikon final & screenshot untuk Chrome Web Store (`store/LISTING.md`, `PRIVACY.md` sudah ada), rotasi varian di Blast (`renderWithRotation` di `app/shared/rotation.ts`), i18n Inggris.

## 9. Referensi kompetitor yang diminta pemilik
Blast/Campaign/Mode Aman, auto-reply/chatbot, ekstrak kontak & grup, template, jadwal, pengingat, POS/toko, privacy blur, rotasi pesan, lead intelligence, kotak masuk tim (butuh server; ditunda), restore pesan terhapus (tidak dibuat; hanya arsip lokal), scrap web (tidak direncanakan).
