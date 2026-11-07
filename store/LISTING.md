# Bahan listing Chrome Web Store

## Nama
WhatsApp Web Toolkit by Irvandoda

## Ringkasan (≤132 karakter)
Toolkit WhatsApp Web: arsip riwayat, multi-akun, CRM, template /kode, dan hemat memori. Oleh Irvandoda.

## Single purpose
Menambahkan alat produktivitas dan manajemen pelanggan (CRM, template, arsip, manajemen akun) pada situs WhatsApp Web.

## Deskripsi (id)
WhatsApp Web Toolkit membantu penjual dan tim CS bekerja lebih rapi di WhatsApp Web:
• Arsip riwayat chat lokal dengan Sync Center
• Hub multi-akun dengan pengelompokan
• CRM: pipeline Kanban, tag, catatan, pengingat
• Template pesan dengan variabel — ketik /kode di kolom chat
• Optimasi memori tab
Semua data tersimpan lokal di browser Anda. Tidak ada server, tidak ada pelacakan.
Ekstensi tidak resmi dan tidak berafiliasi dengan WhatsApp/Meta.
Pengembang: Irvando Demas Arifiandani · irvandoda.web.id

## Justifikasi izin (isi di Developer Dashboard)
- Host `web.whatsapp.com`: satu-satunya situs tempat fitur berjalan.
- `storage`: sinkron pembaruan template antar tab.
- `unlimitedStorage`: arsip riwayat chat lokal.
- `alarms` + `notifications`: pengingat CRM.
- Kode jarak jauh: **tidak ada**.

## Privacy practices (dashboard)
- Data pengguna yang diproses: konten komunikasi pribadi (disimpan lokal, tidak dikirim keluar), info kontak.
- Tidak dijual / tidak dipakai di luar fungsi utama / tidak untuk kelayakan kredit.
- URL kebijakan privasi: https://github.com/irvandoo/WhatsApp-Web-Toolkit-by-Irvandoda/blob/main/PRIVACY.md

## Aset yang masih perlu disiapkan (manual)
- Ikon 128×128 final (saat ini placeholder lingkaran hijau)
- Screenshot 1280×800 (min. 1) — ambil dari Hub, CRM, template, panel di WA Web
- Tile promo kecil 440×280
- Akun developer Chrome Web Store (biaya satu kali US$5)

## Risiko review (jujur)
- Ekstensi memakai modul internal WhatsApp Web (MAIN world) → bisa dianggap melanggar ToS pihak ketiga / ditolak. Kemungkinan perlu mengurangi ke fitur DOM-only.
- Fitur blast/ekstrak grup tidak ada di build store (sengaja).
- Pesan "ekstensi tidak resmi" wajib terlihat jelas.
