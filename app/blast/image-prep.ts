import { IMAGE_MIMES, MAX_IMAGE_BYTES, dataUrlBytes, fitSize } from '../shared/image-logic';
import type { MediaInput } from '../shared/outbox-types';

const SRC_LIMIT = 25 * 1024 * 1024; // refuse absurd source files before decoding

/**
 * Reads an image file, shrinks it (longest side 1600 px) and re-encodes it so a blast does not store/send multi-MB photos.
 * PNG with transparency stays PNG; everything else becomes JPEG (smaller). Throws an Indonesian message on failure.
 */
export async function prepareImage(file: File): Promise<MediaInput> {
  if (!file.type.startsWith('image/') || !IMAGE_MIMES.includes(file.type)) throw new Error('Format gambar harus JPG, PNG, atau WebP.');
  if (file.size > SRC_LIMIT) throw new Error('File gambar terlalu besar (maks 25 MB).');
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('Gambar tidak bisa dibaca. Coba file lain.'); });
  try {
    const { w, h } = fitSize(bmp.width, bmp.height);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Browser tidak bisa memproses gambar.');
    const keepPng = file.type === 'image/png';
    if (!keepPng) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(bmp, 0, 0, w, h);
    let mime = keepPng ? 'image/png' : 'image/jpeg';
    let dataUrl = canvas.toDataURL(mime, 0.85);
    // A big PNG: fall back to JPEG; a big JPEG: lower the quality step by step.
    if (dataUrlBytes(dataUrl) > MAX_IMAGE_BYTES && keepPng) { mime = 'image/jpeg'; ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); dataUrl = canvas.toDataURL(mime, 0.85); }
    for (let q = 0.75; dataUrlBytes(dataUrl) > MAX_IMAGE_BYTES && q >= 0.4; q -= 0.1) dataUrl = canvas.toDataURL('image/jpeg', q);
    const bytes = dataUrlBytes(dataUrl);
    if (!bytes || bytes > MAX_IMAGE_BYTES) throw new Error('Gambar masih terlalu besar setelah dikompres (maks 4 MB).');
    return { name: file.name.slice(0, 120) || 'gambar', mime: dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', bytes, dataUrl };
  } finally { bmp.close?.(); }
}
