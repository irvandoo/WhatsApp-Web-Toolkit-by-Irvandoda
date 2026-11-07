# Kebijakan Privasi — WhatsApp Web Toolkit by Irvandoda

_Terakhir diperbarui: 7 November 2026_

**Ringkasnya: ekstensi ini tidak mengirim data Anda ke mana pun.**

## Data yang diproses
Saat Anda memakai `web.whatsapp.com`, ekstensi dapat membaca dan menyimpan **secara lokal** di browser Anda (IndexedDB milik ekstensi):
- Pesan dan daftar chat yang dimuat (arsip lokal) dan metadata kontak (nama, nomor).
- Data yang Anda buat sendiri: catatan CRM, tag, pengingat, template pesan, registri akun, grup.
- (Eksperimental, hanya jika Anda memintanya) snapshot sesi penyimpanan WhatsApp Web.

## Yang tidak dilakukan
- Tidak ada server milik pengembang, analitik, pelacakan, iklan, atau penjualan data.
- Tidak ada pengiriman data ke pihak ketiga. Ekstensi tidak memuat kode dari luar paketnya.
- Pesan tidak pernah dikirim otomatis tanpa tindakan Anda.

## Izin yang diminta
| Izin | Alasan |
|---|---|
| Akses `https://web.whatsapp.com/*` | Satu-satunya situs tempat ekstensi bekerja. |
| `storage` | Sinkron pembaruan template antar tab. |
| `unlimitedStorage` | Arsip riwayat chat lokal bisa besar. |
| `alarms` | Menjadwalkan pengingat CRM. |
| `notifications` | Menampilkan notifikasi pengingat CRM. |

## Penyimpanan & penghapusan
Semua data tersimpan di profil Chrome Anda. Menghapus ekstensi atau data situs ekstensi menghapus seluruh data tersebut. Anda juga dapat menghapus data dari dalam ekstensi dan mengekspornya (JSON/CSV).

## Keamanan
Snapshot sesi dan ekspor berisi data sensitif; simpan dengan hati-hati. Laporkan kerentanan secara privat ke irvando.d.a@gmail.com.

## Afiliasi
Ekstensi tidak resmi; tidak berafiliasi dengan WhatsApp atau Meta.

## Kontak
Irvando Demas Arifiandani (irvandoda) · irvando.d.a@gmail.com · https://irvandoda.web.id
