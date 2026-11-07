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

### 5. Optimasi memori tab
- `content-visibility: auto` untuk baris chat dan pesan di luar layar.
- Animasi dihentikan saat tab tersembunyi.
- Pembaca JS heap dan tombol pembersihan cache internal ekstensi.

### 6. Rencana berikutnya
POS (katalog, invoice), blast terjadwal dengan jeda aman, ekstrak anggota grup (hanya build `full`), analitik. Lihat [Roadmap](#roadmap).

---

## Status fitur

| Modul | Status |
|---|---|
| Scaffold MV3, dua build, kredit/About | ✅ Selesai, ter-build |
| Memori (CSS-level) | ✅ Diimplementasi, belum diukur |
| Adapter WA (MAIN world) | 🟡 Diimplementasi, **belum diuji di WA nyata** |
| Sync Center + arsip lokal | 🟡 Diimplementasi, belum diuji |
| Multi-akun, grup, Hub | 🟡 Dalam pengerjaan |
| Snapshot sesi | 🧪 Eksperimental, kemungkinan tidak didukung |
| CRM | 🟡 Dalam pengerjaan |
| Template / quick reply | 🟡 Dalam pengerjaan |
| POS, Blast, Ekstrak grup, Analitik | ⏳ Belum dimulai |

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
- **Izin minimal:** `storage`, `alarms`, `scripting`, `unlimitedStorage`, dan host `https://web.whatsapp.com/*` (CRM menambah `notifications`).

---

## Instalasi untuk pengembangan

Prasyarat: Node.js ≥ 20, Google Chrome.

```bash
git clone https://github.com/irvandoo/WhatsApp-Web-Toolkit-by-Irvandoda.git
cd WhatsApp-Web-Toolkit-by-Irvandoda
npm install

npm run build:store    # -> dist/store
npm run build:full     # -> dist/full
npm run typecheck
npm test
```

Memuat ke Chrome:
1. Buka `chrome://extensions`, aktifkan **Developer mode**.
2. Klik **Load unpacked**, pilih folder `dist/store` (atau `dist/full`).
3. Buka https://web.whatsapp.com/, login, lalu klik tombol hijau **W** di pojok kanan bawah.

Jika panel menampilkan *"Store TIDAK terdeteksi"*, nama modul internal WA sudah berubah — buka issue beserta versi WA Web Anda.

---

## Dua build: `store` dan `full`

| | `store` | `full` |
|---|---|---|
| Sync, arsip, memori | ✅ | ✅ |
| Multi-akun, Hub, CRM, template | ✅ | ✅ |
| Blast terjadwal (opt-in, ber-delay) | ❌ | 🔜 |
| Ekstrak anggota grup | ❌ | 🔜 |
| Target | Chrome Web Store | Sideload |

Flavor dipilih lewat konstanta `__FLAVOR__` saat build (`vite build --mode store|full`).

---

## Struktur proyek

```
manifest.config.ts, vite.config.ts, package.json, tsconfig.json
_locales/{id,en}/messages.json
src/
  background/     service worker: akun, sesi, CRM, template, alarm
  content/        panel, memori, sync, bridge, CRM bar, composer
  injected/       wa-adapter.ts (MAIN world)
  dashboard/      Hub multi-akun
  crm/            Kanban, daftar, pengingat
  templates/      pengelola template
  popup/ options/
  shared/         tipe, db (Dexie), codec, template engine, kredit
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
- [ ] Multi-akun, grup, Hub (dalam pengerjaan)
- [ ] CRM & template (dalam pengerjaan)
- [ ] Integrasi manifest, ikon final, i18n lengkap
- [ ] POS: katalog, keranjang, invoice
- [ ] Blast terjadwal opt-in + batas harian (build `full`)
- [ ] Ekstrak anggota grup (build `full`)
- [ ] Analitik, privacy policy, paket Chrome Web Store

---

## Kredit

**Irvando Demas Arifiandani** (`irvandoda`)
- Email: [irvando.d.a@gmail.com](mailto:irvando.d.a@gmail.com)
- Web: [irvandoda.web.id](https://irvandoda.web.id)

## Lisensi

[MIT](LICENSE) © Irvando Demas Arifiandani
