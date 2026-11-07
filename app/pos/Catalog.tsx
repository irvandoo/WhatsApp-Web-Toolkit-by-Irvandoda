import { useMemo, useRef, useState } from 'react';
import { fmtIdr, isLowStock, productsFromCsv, productsToCsv, productTemplateCsv } from '../shared/pos-logic';
import type { Product } from '../shared/pos-types';
import { ScrollTable } from '../shared/ui/ScrollTable';
import { More, useLimit } from './More';
import { download, downsizePhoto, send } from './util';

const empty = (): Partial<Product> & { name: string } => ({ name: '', sku: '', category: '', price: 0, cost: null, stock: null, unit: 'pcs', active: true, note: '', photo: null });

export function Catalog({ products }: { products: Product[] }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [edit, setEdit] = useState<(Partial<Product> & { name: string }) | null>(null);
  const [msg, setMsg] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const cats = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(), [products]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products
      .filter((p) => (!cat || p.category === cat) && (!onlyLow || isLowStock(p)) && (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, q, cat, onlyLow]);

  const [lim, more] = useLimit(`${q}|${cat}|${onlyLow}`);
  const save = async () => {
    if (!edit) return;
    try { await send({ kind: 'pos:product:upsert', product: edit }); setEdit(null); setMsg(''); } catch (e) { setMsg(String((e as Error).message)); }
  };
  const del = async (p: Product) => { if (confirm(`Hapus produk "${p.name}"?`)) await send({ kind: 'pos:product:delete', id: p.id }); };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const { rows, errors } = productsFromCsv(await f.text());
    if (!rows.length) { setMsg(errors.join('; ') || 'Tidak ada baris valid'); return; }
    const r = await send<{ created: number; updated: number }>({ kind: 'pos:product:import', rows });
    setMsg(`Impor selesai: ${r.created} baru, ${r.updated} diperbarui` + (errors.length ? `, ${errors.length} baris dilewati (${errors.slice(0, 3).join('; ')})` : ''));
    if (file.current) file.current.value = '';
  };
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setEdit((e) => (e ? { ...e, [k]: v } : e));
  const num = (v: string): number | null => (v.trim() === '' ? null : Math.round(Number(v)));

  return (
    <div className="fillcol">
      <div className="bar">
        <input placeholder="Cari nama / SKU" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Semua kategori</option>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Stok menipis</label>
        <span className="sp" />
        <button className="pri" onClick={() => setEdit(empty())}>+ Produk</button>
        <button onClick={() => file.current?.click()}>Impor CSV</button>
        <button onClick={() => download('template-produk.csv', productTemplateCsv())}>Template CSV</button>
        <button onClick={() => download('produk.csv', productsToCsv(products))}>Ekspor CSV</button>
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
      {msg && <p className="note">{msg}</p>}
      <ScrollTable label="Katalog produk">
      <table>
        <thead><tr><th></th><th>SKU</th><th>Nama</th><th>Kategori</th><th className="num">Harga</th><th className="num">Modal</th><th className="num">Stok</th><th></th></tr></thead>
        <tbody>
          {list.slice(0, lim).map((p) => (
            <tr key={p.id} className={(p.active ? '' : 'off ') + (isLowStock(p) ? 'low' : '')}>
              <td>{p.photo ? <img className="thumb" src={p.photo} alt="" /> : null}</td>
              <td>{p.sku}</td>
              <td className="wrap">{p.name}{!p.active && <small className="mut"> (nonaktif)</small>}</td>
              <td>{p.category}</td>
              <td className="num">{fmtIdr(p.price)}</td>
              <td className="num">{p.cost == null ? '-' : fmtIdr(p.cost)}</td>
              <td className="num">{p.stock == null ? '∞' : `${p.stock} ${p.unit}`}</td>
              <td className="num"><button onClick={() => setEdit({ ...p })}>Ubah</button> <button onClick={() => void del(p)}>Hapus</button></td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={8} className="mut">Belum ada produk.</td></tr>}
        </tbody>
      </table>
      </ScrollTable>
      {list.length > lim && <More shown={lim} total={list.length} onMore={more} />}

      {edit && (
        <div className="modal" onClick={() => setEdit(null)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()}>
            <h3>{edit.id ? 'Ubah produk' : 'Produk baru'}</h3>
            <div className="grid">
              <label>Nama<input value={edit.name} onChange={(e) => set('name', e.target.value)} autoFocus /></label>
              <label>SKU (kosong = otomatis)<input value={edit.sku ?? ''} onChange={(e) => set('sku', e.target.value)} /></label>
              <label>Kategori<input list="cats" value={edit.category ?? ''} onChange={(e) => set('category', e.target.value)} /></label>
              <label>Satuan<input value={edit.unit ?? ''} onChange={(e) => set('unit', e.target.value)} /></label>
              <label>Harga jual (Rp)<input type="number" min={0} value={edit.price ?? 0} onChange={(e) => set('price', Math.max(0, Math.round(Number(e.target.value) || 0)))} /></label>
              <label>Harga modal (opsional)<input type="number" min={0} value={edit.cost ?? ''} onChange={(e) => set('cost', num(e.target.value))} /></label>
              <label>Stok (kosong = tak terbatas)<input type="number" value={edit.stock ?? ''} onChange={(e) => set('stock', num(e.target.value))} /></label>
              <label className="chk"><input type="checkbox" checked={edit.active ?? true} onChange={(e) => set('active', e.target.checked)} /> Aktif</label>
            </div>
            <datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
            <label>Catatan<textarea rows={2} value={edit.note ?? ''} onChange={(e) => set('note', e.target.value)} /></label>
            <div className="bar">
              {edit.photo && <img className="thumb big" src={edit.photo} alt="" />}
              <label className="btn">Foto<input type="file" accept="image/*" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) try { set('photo', await downsizePhoto(f)); } catch (er) { setMsg(String((er as Error).message)); }
              }} /></label>
              {edit.photo && <button onClick={() => set('photo', null)}>Hapus foto</button>}
            </div>
            {msg && <p className="note err">{msg}</p>}
            <div className="bar"><span className="sp" /><button onClick={() => setEdit(null)}>Batal</button><button className="pri" disabled={!edit.name.trim()} onClick={() => void save()}>Simpan</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
