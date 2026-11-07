# WhatsApp Web Toolkit by Irvandoda

Ekstensi Google Chrome (Manifest V3) untuk **https://web.whatsapp.com/** yang difokuskan pada kebutuhan **marketing WhatsApp**: sinkronisasi riwayat chat, manajemen banyak akun, CRM, template pesan, dan optimasi memori tab.

> **Status: pengembangan aktif (v0.1.0 — checkpoint awal).** Sebagian besar fitur belum diuji pada WhatsApp Web sungguhan. Lihat bagian [Status fitur](#status-fitur) dan [Batasan jujur](#batasan-teknis-yang-jujur) sebelum mengandalkannya.

---

## Daftar isi

- [Fitur](#fitur)
- [Status fitur](#status-fitur)
- [Batasan teknis yang jujur](#batasan-teknis-yang-jujur)
- [Arsitektur](#arsitektur)
- [Instalasi untuk pengembangan](#instalasi-untuk-pengembangan)
- [Dua build: `store` dan `full`](#dua-build-store-dan-full)
- [Struktur proyek](#struktur-proyek)
- [Privasi & keamanan](#privasi--keamanan)
- [Penggunaan yang bertanggung jawab](#penggunaan-yang-bertanggung-jawab)
- [Roadmap](#roadmap)
- [Kredit](#kredit)
- [Lisensi](#lisensi)

---

## Fitur

### 1. Sync Center (sinkronisasi riwayat)
- Memuat riwayat lama per chat secara berulang (dengan jeda acak) sampai WhatsApp melaporkan awal percakapan atau tidak ada pesan baru.
- **Arsip lokal** (IndexedDB) menyimpan setiap pesan yang pernah berhasil dimuat, sehingga tidak hilang walaupun WhatsApp memangkas tampilan.
- Panel mengambang di WA Web: *Sync chat terbuka*, *Sync semua*, *Stop*, status adapter dan penggunaan heap.

### 2. Multi-akun & Hub
- Registri akun: nama, warna, grup (mis. "Toko A", "CS", "Promo"), label profil Chrome, catatan.
- **Hub dashboard** menampilkan kartu akun per grup, status online, jumlah belum dibaca, jumlah chat, serta ekspor/impor registri.
- Snapshot sesi tersimpan — **eksperimental**, lihat batasan di bawah.

### 3. CRM
- Kontak per chat dengan tahap pipeline, tag, nilai potensi deal, penanggung jawab, status opt-out.
- Papan **Kanban** (drag & drop), daftar, catatan, pengingat (notifikasi Chrome), ekspor CSV/JSON (aman dari injeksi rumus).
- Bilah CRM kecil di samping chat yang sedang terbuka.

### 4. Template & Quick Reply
- Ketik `/kode` di kolom chat untuk menyisipkan template. **Tidak dikirim otomatis** — Anda menekan Enter.
- Variabel `{nama}` `{telepon}` `{tahap}` `{tanggal}` `{akun}` dan spintax `{halo|hai|selamat siang}`.
- Pengelola template dengan pratinjau, impor/ekspor JSON.

### 5. Analitik & pengingat "belum dibalas"
- Pelacakan pesan masuk/keluar **tanpa menyimpan isi pesan** (hanya waktu dan arah).
- Rentang: Hari ini, Minggu, Bulan, Tahun, Semua, dan Custom; grafik harian/mingguan/bulanan, heatmap jam×hari, perbandingan dengan periode sebelumnya.
- **WA Baru** = nomor yang pertama kali mengirim pesan dan belum pernah kamu balas. Setelah dibalas, pesan berikutnya dihitung **follow-up**.
- Tab **Belum Dibalas**: berapa lama chat menunggu, prioritas (urgent ≥ 24 jam, high ≥ 6 jam, normal ≥ 1 jam), urut dan filter (akun, jenis, tahap CRM, tag, lama menunggu), tombol buat pengingat.
- Laporan: ekspor CSV/JSON, impor CSV, dan unduh template CSV.
- Semua modul (Hub, CRM, Template, Analitik) tampil sebagai **overlay di layar WhatsApp Web**, bukan tab baru. Jika WhatsApp memblokir pembingkaian, tersedia tombol "Buka di tab".

### Modul di halaman depan WhatsApp Web
Semua modul muncul sebagai tombol di **navbar WhatsApp Web** dan terbuka sebagai **overlay di layar** (tanpa tab baru):

| Modul | Isi |
|---|---|
| **Akun** | Dropdown ganti akun/sesi di tab yang sama (namespace virtual per tab, konsep ala SessionBox; satu akun aktif per tab) |
| **Belum dibalas** | Lama menunggu, prioritas, sort & filter, badge jumlah |
| **Auto-reply** | Aturan kata kunci / pesan pertama / di luar jam kerja, jeda acak, batas per jam, jeda ulang per chat, varian & rotasi pesan |
| **CRM** | Kanban, tag, catatan, pengingat, **lead intelligence** (skor keterlibatan, hot lead, momentum, prioritas tindak lanjut) |
| **Analitik** | WA baru vs follow-up, rentang waktu, grafik, laporan CSV/JSON, template impor |
| **Blast & Jadwal** | Kampanye ber-delay, batas harian/jam, jendela jam kirim, jeda otomatis saat error, pesan terjadwal sekali/berulang, pengingat yang bisa mengirim pesan |
| **POS** | Katalog, kasir, nota (teks WA & cetak), stok, laporan penjualan |
| **Ekstrak Grup** | Anggota grup → CSV/vCard/JSON, tambah ke CRM (build `full`) |
| **Preset Industri** | Paket template + aturan + pipeline untuk toko online, restoran/hotel, klinik, pendidikan, jasa keuangan, pemerintahan, CS umum |
| **Privacy Blur** | Samarkan daftar chat, pesan, nama, foto; Ctrl+Shift+B; blur otomatis saat idle/tidak aktif |

**Aturan pengiriman:** build `store` **tidak mengirim otomatis** — Auto-reply, Blast, dan Jadwal menyiapkan *draf* di kolom chat + notifikasi, Anda yang menekan Enter. Hanya build `full` yang bisa mengirim otomatis, dengan semua pengaman (opt-in wajib, tanpa grup, hormati opt-out, delay & batas).

### 6. Optimasi memori tab
- `content-visibility: auto` untuk baris chat dan pesan di luar layar.
- Animasi dihentikan saat tab tersembunyi.
- Pembaca JS heap dan tombol pembersihan cache internal ekstensi.

### 7. Rencana berikutnya
POS (katalog, invoice), blast terjadwal dengan jeda aman, ekstrak anggota grup (hanya build `full`), analitik. Lihat [Roadmap](#roadmap).

---

## Status fitur

| Modul | Status |
|---|---|
| Scaffold MV3, dua build, kredit/About | ✅ Selesai, ter-build |
| Memori (CSS-level) | ✅ Diimplementasi, belum diukur |
| Adapter WA (MAIN world) | 🟡 Diimplementasi, **belum diuji di WA nyata** |
| Sync Center + arsip lokal | 🟡 Diimplementasi, belum diuji |
| Multi-akun, grup, Hub | 🟡 Terpasang, belum diuji di browser |
| Snapshot sesi | 🧪 Eksperimental, kemungkinan tidak didukung |
| CRM | 🟡 Terpasang, belum diuji di browser |
| Template / quick reply | 🟡 Terpasang, belum diuji di browser |
| Analitik, pelacakan, belum dibalas, overlay, dock navbar | 🟡 Terpasang, belum diuji di browser |
| Auto-reply, Blast & Jadwal, POS, Ekstrak grup, Preset, Lead intelligence, Privacy Blur, rotasi pesan | 🟡 Terpasang, belum diuji di browser |

---

## Batasan teknis yang jujur

1. **Sinkron penuh dari HP tidak bisa "dipaksa" 100%.** Riwayat untuk perangkat tertaut dibatasi oleh WhatsApp (laporan beta menyebut sekitar satu tahun untuk teks; tidak ada angka resmi). Ekstensi hanya memaksimalkan apa yang bisa dimuat dan **mengarsipkannya secara lokal**.
2. **Akun bersamaan = satu akun per profil Chrome.** Semua tab `web.whatsapp.com` dalam satu profil berbagi storage yang sama, dan WhatsApp menolak dua sesi aktif di profil yang sama. Jalankan beberapa profil Chrome; masing-masing memiliki ekstensi dan Hub sendiri. Registri antar profil digabung lewat ekspor/impor JSON. Sinkron realtime antar profil memerlukan relay lokal (belum ada).
3. **Snapshot sesi eksperimental.** WhatsApp Web diduga menyimpan kunci `CryptoKey` non-ekstraktabel di IndexedDB yang tidak bisa dipindahkan lewat pesan ekstensi. Fitur akan menolak dengan alasan jelas bila menemukan data yang tidak didukung. Snapshot berisi kredensial akun — perlakukan sebagai rahasia.
4. **Bergantung pada internal WhatsApp Web.** Nama modul/metode dapat berubah kapan saja tanpa pemberitahuan. Adapter melakukan *feature detection* dan menampilkan "Store tidak terdeteksi" bila gagal, bukan error diam-diam. Selector DOM (mis. kolom chat) juga rapuh.
5. **Kebijakan Chrome Web Store.** Kirim massal dan ekstrak nomor grup berisiko ditolak, sehingga fitur tersebut hanya direncanakan di build `full` (sideload).
6. **Ekstensi tidak resmi.** Proyek ini tidak berafiliasi dengan, disponsori, atau didukung oleh WhatsApp/Meta.

---

## Arsitektur

```
┌────────────────────────── web.whatsapp.com ──────────────────────────┐
│  MAIN world            ◄── postMessage (bertipe) ──►  Content script │
│  src/injected/wa-adapter.ts                           src/content/*  │
│  (akses modul internal WA,                            (panel, memori,│
│   feature-detected)                                    CRM bar, /tpl)│
└───────────────────────────────────────────────┬──────────────────────┘
                                                │ chrome.runtime.sendMessage
                                   ┌────────────▼────────────┐
                                   │ Service worker          │
                                   │ src/background/*        │──► Dexie (IndexedDB)
                                   │ akun, CRM, template,    │    arsip, akun, CRM,
                                   │ alarm pengingat         │    template, sesi
                                   └────────────┬────────────┘
                                                │ liveQuery
                             ┌──────────────────▼─────────────────┐
                             │ Halaman ekstensi: Hub, CRM,        │
                             │ Template, Popup, Options (React)   │
                             └────────────────────────────────────┘
```

- **Stack:** TypeScript, Vite + CRXJS, React 18, Dexie, Vitest.
- **Jembatan MAIN ↔ isolated world** memakai envelope bertipe dan memvalidasi `source` serta `origin`.
- **Izin minimal:** `storage`, `alarms`, `scripting`, `unlimitedStorage`, `notifications`, dan host `https://web.whatsapp.com/*` (CRM menambah `notifications`).

---

## Instalasi

### Plug & play (tanpa build)
Folder root repositori ini **sudah berisi build `store` yang siap dimuat** (`manifest.json`, `assets/`, `popup/`, dll.).

1. Unduh/clone repositori ini.
2. Buka `chrome://extensions` dan aktifkan **Developer mode**.
3. Klik **Load unpacked**, lalu pilih **folder root repositori** (yang berisi `manifest.json`).
4. Buka https://web.whatsapp.com/, login, lalu klik tombol hijau **W** di pojok kanan bawah.

```bash
git clone https://github.com/irvandoo/WhatsApp-Web-Toolkit-by-Irvandoda.git
```

Jika panel menampilkan *"Store TIDAK terdeteksi"*, nama modul internal WA sudah berubah — buka issue beserta versi WA Web Anda.

### Untuk pengembangan
Prasyarat: Node.js ≥ 20. Kode sumber ada di folder `app/`.

```bash
npm install
npm run build:store    # menulis ulang file ekstensi di root repo
npm run build:full     # -> dist/full (sideload, fitur lanjutan)
npm run typecheck
npm test
```

> `build:store` menghapus dan membuat ulang file hasil build di root (`assets/`, `popup/`, `manifest.json`, dst.). Jangan menaruh file sendiri di folder-folder tersebut. Setelah build, muat ulang ekstensi di `chrome://extensions`.

---

## Dua build: `store` dan `full`

| | `store` | `full` |
|---|---|---|
| Sync, arsip, memori | ✅ | ✅ |
| Multi-akun, Hub, CRM, template | ✅ | ✅ |
| Blast terjadwal (opt-in, ber-delay) | ❌ | 🔜 |
| Ekstrak anggota grup | ❌ | 🔜 |
| Target | Chrome Web Store | Sideload |

Flavor dipilih lewat konstanta `__FLAVOR__` saat build (`vite build --mode store|full`). Build `store` ditulis ke root repo, `full` ke `dist/full`.

---

## Struktur proyek

```
app/                      kode sumber (root Vite)
  background/             service worker: akun, sesi, CRM, template, alarm
  content/                panel, memori, sync, bridge, CRM bar, composer
  injected/               wa-adapter.ts (MAIN world)
  dashboard/ crm/ templates/ popup/ options/   halaman UI (React)
  shared/                 tipe, db (Dexie), codec, template engine, kredit
  public/                 ikon dan _locales
manifest.config.ts, vite.config.ts, scripts/clean-root.mjs
manifest.json, assets/, popup/, dashboard/, ...   hasil build `store` (siap dimuat)
```

---

## Privasi & keamanan

- Semua data (arsip pesan, CRM, template, registri akun) disimpan **lokal** di browser Anda (IndexedDB ekstensi). Tidak ada server, analitik, atau pengiriman data keluar.
- Snapshot sesi berisi kredensial akun WhatsApp. Jangan dibagikan atau diekspor ke tempat yang tidak tepercaya.
- Jangan memasukkan token/kata sandi apa pun ke repositori ini.
- Laporkan celah keamanan secara privat ke email di bagian [Kredit](#kredit).

---

## Penggunaan yang bertanggung jawab

Gunakan hanya untuk kontak yang **telah memberi persetujuan (opt-in)** dan hormati permintaan berhenti (flag *opt-out* tersedia di CRM). Pesan massal atau otomasi yang melanggar Ketentuan Layanan WhatsApp dapat menyebabkan **akun diblokir**. Pengembang tidak bertanggung jawab atas konsekuensi penggunaan ekstensi ini.

---

## Roadmap

- [x] Scaffold, dua build, kredit
- [x] Adapter WA + Sync Center + arsip lokal (perlu uji nyata)
- [x] Optimasi memori dasar
- [x] Multi-akun, grup, Hub (terpasang, perlu uji nyata)
- [x] CRM & template (terpasang, perlu uji nyata)
- [x] Integrasi manifest
- [ ] Ikon final, i18n lengkap
- [x] POS, Blast terjadwal, Ekstrak grup, Auto-reply, Preset, Lead intelligence (terpasang, perlu uji nyata)
- [ ] Asisten AI (kunci API milik pengguna), webhook & Google Form (opt-in)
- [ ] Analitik, privacy policy, paket Chrome Web Store

---

## Kredit

**Irvando Demas Arifiandani** (`irvandoda`)
- Email: [irvando.d.a@gmail.com](mailto:irvando.d.a@gmail.com)
- Web: [irvandoda.web.id](https://irvandoda.web.id)

## Lisensi

[MIT](LICENSE) © Irvando Demas Arifiandani
