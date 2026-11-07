import { useState } from 'react';
import { db } from '../../shared/db';
import { fmtIdr } from '../../shared/pos-logic';
import {
  buildDeliveryText, DELIVERY_LABEL, DELIVERY_MODES, DELIVERY_VARS, generateSku, generateVariants, licenseCounts, MAX_PHOTOS, TYPE_LABEL, TYPES, typeOf, validateProduct,
} from '../../shared/pos-products-logic';
import type { Category, DeliveryMode, LicenseCode, OptionGroup, Product, ProductType, TierPrice, Variant } from '../../shared/pos-types';
import { ScrollTable } from '../../shared/ui/ScrollTable';
import { downsizePhoto, send, useLive } from '../util';

export type Draft = Partial<Product> & { name: string };
export const emptyDraft = (type: ProductType = 'fisik'): Draft => ({
  name: '', sku: '', category: '', price: 0, cost: null, stock: 0, unit: 'pcs', active: true, note: '', photo: null, type,
  description: '', tags: [], photos: [], minStock: 5, tiers: [], optionGroups: [], variants: [], autoDeliver: true, deliveryMode: 'link', downloadUrl: '', accessUrl: '', instructions: '',
});
const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Math.round(Number(v)));
const DIM_LABEL = { l: 'Panjang', w: 'Lebar', h: 'Tinggi' } as const;

function LicensePool({ productId }: { productId: string }) {
  const codes = useLive(() => db.licenseCodes.where('productId').equals(productId).toArray(), [] as LicenseCode[]);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const c = licenseCounts(codes);
  const run = async (fn: () => Promise<string>) => { try { setMsg(await fn()); } catch (e) { setMsg((e as Error).message); } };
  const imp = () => run(async () => {
    const r = await send<{ added: number; duplicateInInput: number; alreadyExists: number; invalid: number }>({ kind: 'pos:license:import', productId, text });
    setText('');
    return `Ditambah ${r.added}; ditolak: ${r.alreadyExists} sudah ada, ${r.duplicateInInput} dobel di input, ${r.invalid} tidak valid`;
  });
  const mark = (status: 'tersedia' | 'rusak' | 'hapus') => run(async () => {
    const r = await send<{ changed: number; skipped: number }>({ kind: 'pos:license:mark', ids: [...sel], status });
    setSel(new Set());
    return `${r.changed} kode diubah` + (r.skipped ? `, ${r.skipped} kode terpakai dilewati` : '');
  });
  return (
    <div className="pm-sec">
      <h4>Kumpulan kode lisensi / voucher</h4>
      <p className="note">Tersedia <b>{c.tersedia}</b> · Terpakai {c.terpakai} · Rusak {c.rusak} · Total {c.total}. Stok = jumlah kode tersedia.</p>
      <textarea rows={4} placeholder="Tempel kode, satu per baris (atau pisah koma)" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="bar">
        <button className="pri" disabled={!text.trim()} onClick={() => void imp()}>Impor kode</button>
        <button disabled={!sel.size} onClick={() => void mark('rusak')}>Tandai rusak</button>
        <button disabled={!sel.size} onClick={() => void mark('tersedia')}>Tandai tersedia</button>
        <button disabled={!sel.size} onClick={() => { if (confirm(`Hapus ${sel.size} kode?`)) void mark('hapus'); }}>Hapus</button>
      </div>
      {msg && <p className="note">{msg}</p>}
      <ScrollTable maxHeight="28vh" label="Daftar kode">
        <table>
          <thead><tr><th></th><th>Kode</th><th>Status</th><th>Pesanan</th></tr></thead>
          <tbody>
            {codes.slice(0, 500).map((k) => (
              <tr key={k.id}>
                <td><input type="checkbox" disabled={k.status === 'terpakai'} checked={sel.has(k.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(k.id); else n.delete(k.id); return n; })} /></td>
                <td>{k.code}</td><td>{k.status}</td><td>{k.orderId ? k.orderId.slice(0, 8) : '-'}</td>
              </tr>
            ))}
            {!codes.length && <tr><td colSpan={4} className="mut">Belum ada kode.</td></tr>}
          </tbody>
        </table>
      </ScrollTable>
      {codes.length > 500 && <small className="mut">Menampilkan 500 dari {codes.length}.</small>}
    </div>
  );
}

export function ProductForm({ initial, products, cats, onClose }: { initial: Draft; products: Product[]; cats: Category[]; onClose: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [err, setErr] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [tagText, setTagText] = useState((initial.tags ?? []).join(', '));
  const set = <K extends keyof Product>(k: K, v: Product[K] | undefined) => setD((e) => ({ ...e, [k]: v }));
  const type = typeOf(d);
  const isNew = !d.id;
  const hasV = !!d.variants?.length;
  const unlimited = d.stock == null && !hasV;

  const switchType = (t: ProductType) => setD((e) => ({ ...e, type: t, ...(t === 'fisik' && e.stock == null && !e.variants?.length ? { stock: 0 } : {}) }));
  const photos = d.photos ?? (d.photo ? [d.photo] : []);
  const setPhotos = (out: string[]) => setD((e) => ({ ...e, photos: out, photo: out[0] ?? null }));
  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const out = [...photos];
    try { for (const f of [...files]) if (out.length < MAX_PHOTOS) out.push(await downsizePhoto(f)); } catch (e) { setErr([(e as Error).message]); }
    setPhotos(out);
  };

  const tiers = d.tiers ?? [];
  const setTier = (i: number, p: Partial<TierPrice>) => set('tiers', tiers.map((t, j) => (j === i ? { ...t, ...p } : t)));
  const groups = d.optionGroups ?? [];
  const setGroups = (g: OptionGroup[]) => set('optionGroups', g);
  const variants = d.variants ?? [];
  const genVariants = () => {
    const base = d.sku?.trim() || generateSku(products.map((p) => p.sku), 'fisik');
    const used = products.filter((p) => p.id !== d.id).flatMap((p) => [p.sku, ...(p.variants ?? []).map((v) => v.sku)]);
    const r = generateVariants(groups, variants, base, () => crypto.randomUUID(), used);
    set('variants', r.variants);
    setErr(r.truncated ? ['Kombinasi dibatasi 200 varian'] : []);
  };
  const setVar = (i: number, p: Partial<Variant>) => set('variants', variants.map((v, j) => (j === i ? { ...v, ...p } : v)));

  const sample = { customerName: 'Budi', number: 'INV-202611-0001', createdAt: Date.now() };
  const preview = type === 'digital' ? buildDeliveryText({ ...(d as Product), name: d.name || 'Nama Produk' }, sample, d.deliveryMode === 'kode' ? 'ABCD-1234' : undefined) : '';

  const save = async () => {
    const body: Draft = { ...d, tags: tagText.split(',').map((t) => t.trim()).filter(Boolean) };
    if (type === 'fisik' && hasV) body.stock = null;
    const errs = validateProduct(body);
    if (errs.length) { setErr(errs); return; }
    setBusy(true);
    try { await send({ kind: 'pos:product:upsert', product: body }); onClose(); } catch (e) { setErr([(e as Error).message]); } finally { setBusy(false); }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="dlg pm-dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? 'Tambah produk' : 'Ubah produk'}</h3>
        <div className="pm-seg">
          {TYPES.map((t) => <button key={t} className={type === t ? 'on' : ''} onClick={() => switchType(t)}>{TYPE_LABEL[t]}</button>)}
        </div>
        <div className="grid">
          <label>Nama<input value={d.name} onChange={(e) => set('name', e.target.value)} autoFocus /></label>
          <label>SKU (kosong = otomatis)<input value={d.sku ?? ''} onChange={(e) => set('sku', e.target.value)} /></label>
          <label>Kategori
            <select value={d.category ?? ''} onChange={(e) => set('category', e.target.value)}>
              <option value="">(tanpa kategori)</option>
              {cats.map((c) => <option key={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Tag (pisah koma)<input value={tagText} onChange={(e) => setTagText(e.target.value)} /></label>
          <label>Harga jual (Rp){hasV ? ' - dasar' : ''}<input type="number" min={0} value={d.price ?? 0} onChange={(e) => set('price', Math.max(0, Math.round(Number(e.target.value) || 0)))} /></label>
          <label>Harga modal (opsional)<input type="number" min={0} value={d.cost ?? ''} onChange={(e) => set('cost', numOrNull(e.target.value))} /></label>
          <label>Pajak khusus % (kosong = ikut pesanan)<input type="number" min={0} max={100} step="any" value={d.taxPct ?? ''} onChange={(e) => set('taxPct', e.target.value === '' ? null : Number(e.target.value))} /></label>
          <label className="chk"><input type="checkbox" checked={d.active ?? true} onChange={(e) => set('active', e.target.checked)} /> Aktif</label>
          <label className="chk"><input type="checkbox" checked={!!d.archived} onChange={(e) => set('archived', e.target.checked)} /> Arsip</label>
        </div>
        <label>Deskripsi<textarea rows={2} value={d.description ?? ''} onChange={(e) => set('description', e.target.value)} /></label>

        <h4>Foto ({photos.length}/{MAX_PHOTOS}, otomatis dikecilkan maks 150KB)</h4>
        <div className="pm-photos">
          {photos.map((p, i) => <div key={i}><img src={p} alt="" /><button onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>x</button></div>)}
          {photos.length < MAX_PHOTOS && <label className="btn">+ Foto<input type="file" accept="image/*" multiple hidden onChange={(e) => { void addPhotos(e.target.files); e.target.value = ''; }} /></label>}
        </div>

        {type === 'fisik' && (
          <div className="pm-sec">
            <h4>Barang fisik</h4>
            <div className="grid">
              <label>Satuan<input value={d.unit ?? ''} onChange={(e) => set('unit', e.target.value)} /></label>
              <label className="chk"><input type="checkbox" checked={unlimited} disabled={hasV} onChange={(e) => set('stock', e.target.checked ? null : 0)} /> Stok tak terbatas</label>
              {!hasV && !unlimited && <label>Stok<input type="number" value={d.stock ?? 0} onChange={(e) => set('stock', Math.round(Number(e.target.value) || 0))} /></label>}
              <label>Stok minimum (peringatan)<input type="number" min={0} value={d.minStock ?? 5} onChange={(e) => set('minStock', Math.max(0, Math.round(Number(e.target.value) || 0)))} /></label>
              <label>Berat (gram)<input type="number" min={0} value={d.weight ?? ''} onChange={(e) => set('weight', numOrNull(e.target.value))} /></label>
              <label>Barcode<input value={d.barcode ?? ''} onChange={(e) => set('barcode', e.target.value)} /></label>
              <label>Lokasi rak<input value={d.shelf ?? ''} onChange={(e) => set('shelf', e.target.value)} /></label>
            </div>
            <div className="grid">
              {(['l', 'w', 'h'] as const).map((k) => (
                <label key={k}>{DIM_LABEL[k]} (cm)
                  <input type="number" min={0} value={d.dims?.[k] ?? ''} onChange={(e) => set('dims', { l: 0, w: 0, h: 0, ...(d.dims ?? {}), [k]: Number(e.target.value) || 0 })} />
                </label>
              ))}
            </div>

            <h4>Harga grosir bertingkat</h4>
            {tiers.map((t, i) => (
              <div className="bar" key={i}>
                <span>Beli minimal</span><input className="n" type="number" min={2} value={t.minQty} onChange={(e) => setTier(i, { minQty: Math.round(Number(e.target.value) || 0) })} />
                <span>harga/unit</span><input className="n w" type="number" min={0} value={t.price} onChange={(e) => setTier(i, { price: Math.round(Number(e.target.value) || 0) })} />
                <small className="mut">{fmtIdr(t.price)}</small><button onClick={() => set('tiers', tiers.filter((_, j) => j !== i))}>x</button>
              </div>
            ))}
            <button onClick={() => set('tiers', [...tiers, { minQty: (tiers.length ? tiers[tiers.length - 1].minQty : 1) + 9, price: d.price ?? 0 }])}>+ Tingkat grosir</button>

            <h4>Varian</h4>
            {groups.map((g, i) => (
              <div className="bar" key={i}>
                <input placeholder="Grup (mis. Warna)" value={g.name} onChange={(e) => setGroups(groups.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input style={{ flex: 1 }} placeholder="Nilai, pisah koma (Merah, Biru)" defaultValue={g.values.join(', ')}
                  onChange={(e) => setGroups(groups.map((x, j) => (j === i ? { ...x, values: e.target.value.split(',') } : x)))} />
                <button onClick={() => setGroups(groups.filter((_, j) => j !== i))}>x</button>
              </div>
            ))}
            <div className="bar">
              <button onClick={() => setGroups([...groups, { name: '', values: [] }])}>+ Grup opsi</button>
              <button className="pri" disabled={!groups.length} onClick={genVariants}>Buat kombinasi varian</button>
              {hasV && <button onClick={() => { if (confirm('Hapus semua varian?')) { set('variants', []); set('stock', 0); } }}>Hapus semua varian</button>}
            </div>
            {hasV && (
              <ScrollTable maxHeight="32vh" label="Varian">
                <table>
                  <thead><tr><th>Varian</th><th>SKU</th><th className="num">Harga (kosong = dasar)</th><th className="num">Modal</th><th className="num">Stok</th><th></th></tr></thead>
                  <tbody>
                    {variants.map((v, i) => (
                      <tr key={v.id}>
                        <td>{v.name}</td>
                        <td><input value={v.sku} onChange={(e) => setVar(i, { sku: e.target.value })} /></td>
                        <td><input className="n w" type="number" min={0} value={v.price ?? ''} onChange={(e) => setVar(i, { price: numOrNull(e.target.value) })} /></td>
                        <td><input className="n w" type="number" min={0} value={v.cost ?? ''} onChange={(e) => setVar(i, { cost: numOrNull(e.target.value) })} /></td>
                        <td><input className="n" type="number" min={0} value={v.stock ?? ''} placeholder="∞" onChange={(e) => setVar(i, { stock: numOrNull(e.target.value) })} /></td>
                        <td><button onClick={() => set('variants', variants.filter((_, j) => j !== i))}>x</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollTable>
            )}
          </div>
        )}

        {type === 'jasa' && (
          <div className="pm-sec">
            <h4>Jasa</h4>
            <label>Durasi (mis. 60 menit)<input value={d.duration ?? ''} onChange={(e) => set('duration', e.target.value)} /></label>
            <small className="mut">Jasa tidak memakai stok.</small>
          </div>
        )}

        {type === 'digital' && (
          <div className="pm-sec">
            <h4>Produk digital</h4>
            <div className="grid">
              <label>Mode pengiriman
                <select value={d.deliveryMode ?? 'link'} onChange={(e) => set('deliveryMode', e.target.value as DeliveryMode)}>
                  {DELIVERY_MODES.map((m) => <option key={m} value={m}>{DELIVERY_LABEL[m]}</option>)}
                </select>
              </label>
              {(d.deliveryMode === 'link' || d.deliveryMode === 'file-url') && <label>URL {d.deliveryMode === 'link' ? 'tautan' : 'file'}<input value={d.downloadUrl ?? ''} placeholder="https://" onChange={(e) => set('downloadUrl', e.target.value)} /></label>}
              {d.deliveryMode === 'akses' && <label>URL akses<input value={d.accessUrl ?? ''} placeholder="https://" onChange={(e) => set('accessUrl', e.target.value)} /></label>}
              <label>Masa berlaku (hari, opsional)<input type="number" min={1} value={d.validityDays ?? ''} onChange={(e) => set('validityDays', numOrNull(e.target.value))} /></label>
              <label className="chk"><input type="checkbox" checked={d.autoDeliver !== false} onChange={(e) => set('autoDeliver', e.target.checked)} /> Kirim otomatis saat Lunas</label>
            </div>
            <label>Instruksi pemakaian (kosong = teks bawaan)
              <textarea rows={4} value={d.instructions ?? ''} onChange={(e) => set('instructions', e.target.value)} />
            </label>
            <small className="mut">Variabel: {DELIVERY_VARS.map((v) => `{${v}}`).join(' ')}</small>
            <h4>Pratinjau pesan</h4>
            <div className="pm-prev">{preview}</div>
            {d.deliveryMode === 'kode' && (isNew ? <p className="note">Simpan produk dulu, lalu tambahkan kode lisensi.</p> : <LicensePool productId={d.id!} />)}
          </div>
        )}

        {err.length > 0 && <div className="note err">{err.map((x, i) => <div key={i}>{x}</div>)}</div>}
        <div className="bar"><span className="sp" /><button onClick={onClose}>Batal</button><button className="pri" disabled={busy || !d.name.trim()} onClick={() => void save()}>Simpan</button></div>
      </div>
    </div>
  );
}
