import { useMemo, useRef, useState } from 'react';
import { db } from '../../shared/db';
import { fmtIdr } from '../../shared/pos-logic';
import {
  filterProducts, lowVariants, parseProductCsv, productsToCsvByType, productTemplateByType, STATUS_LABEL_STOCK, stockStatus, stockSummary, totalStock,
  TYPE_LABEL, TYPES, typeOf, type StockStatus,
} from '../../shared/pos-products-logic';
import type { Category, LicenseCode, Product, ProductType } from '../../shared/pos-types';
import { ScrollTable } from '../../shared/ui/ScrollTable';
import { More, useLimit } from '../More';
import { download, send, useLive } from '../util';
import './products.css';
import { CategoryManager } from './CategoryManager';
import { emptyDraft, ProductForm, type Draft } from './ProductForm';
import { StockDialog } from './StockDialog';

const STATUSES: StockStatus[] = ['habis', 'menipis', 'aman'];

export function Products({ products }: { products: Product[] }) {
  const cats = useLive(async () => (await db.categories.toArray()).sort((a, b) => a.name.localeCompare(b.name)), [] as Category[]);
  const codes = useLive(() => db.licenseCodes.where('status').equals('tersedia').toArray(), [] as LicenseCode[]);
  const pools = useMemo(() => { const m: Record<string, number> = {}; for (const c of codes) m[c.productId] = (m[c.productId] ?? 0) + 1; return m; }, [codes]);

  const [type, setType] = useState<'' | ProductType>('');
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState<'' | StockStatus>('');
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<Draft | null>(null);
  const [stockOf, setStockOf] = useState<string | null>(null);
  const [showCats, setShowCats] = useState(false);
  const [msg, setMsg] = useState('');
  const [bulkCat, setBulkCat] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState<'fisik' | 'digital'>('fisik');

  const live = useMemo(() => products.filter((p) => !p.archived), [products]);
  const sum = useMemo(() => stockSummary(live, pools), [live, pools]);
  const lowList = useMemo(() => live.filter((p) => { const s = stockStatus(p, pools[p.id]); return s === 'habis' || s === 'menipis'; }).slice(0, 8), [live, pools]);
  const list = useMemo(() => filterProducts(products, { type, category: cat, q, status, archived }, pools).sort((a, b) => a.name.localeCompare(b.name)), [products, type, cat, q, status, archived, pools]);
  const [lim, more] = useLimit(`${type}|${cat}|${q}|${status}|${archived}`);
  const shown = list.slice(0, lim);
  const stockProduct = products.find((p) => p.id === stockOf) ?? null;
  const countOf = (t: ProductType) => products.filter((p) => !p.archived && typeOf(p) === t).length;

  const allSel = shown.length > 0 && shown.every((p) => sel.has(p.id));
  const toggleAll = () => setSel(allSel ? new Set() : new Set(shown.map((p) => p.id)));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const bulk = async (action: 'aktif' | 'nonaktif' | 'arsip' | 'kategori' | 'hapus') => {
    if (!sel.size) return;
    if (action === 'hapus' && !confirm(`Hapus ${sel.size} produk? Kode lisensi yang belum terpakai ikut terhapus.`)) return;
    try {
      const r = await send<{ count: number }>({ kind: 'pos:product:bulk', ids: [...sel], action, category: bulkCat });
      setMsg(`${r.count} produk diproses (${action})`); setSel(new Set());
    } catch (e) { setMsg((e as Error).message); }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = parseProductCsv(await f.text(), importType);
    const lines = [...r.warnings, ...r.errors.slice(0, 8).map((e) => `Baris ${e.line}: ${e.message}`)];
    if (r.errors.length > 8) lines.push(`...dan ${r.errors.length - 8} kesalahan lain`);
    if (!r.rows.length) { setMsg(['Tidak ada baris valid.', ...lines].join(' | ')); }
    else {
      try {
        const res = await send<{ created: number; updated: number; skipped: number; errors?: string[] }>({ kind: 'pos:product:import', rows: r.rows });
        setMsg([`Impor: ${res.created} baru, ${res.updated} diperbarui, ${res.skipped + r.errors.length} dilewati`, ...lines, ...(res.errors ?? []).slice(0, 3)].join(' | '));
      } catch (e) { setMsg((e as Error).message); }
    }
    if (fileRef.current) fileRef.current.value = '';
  };
  const exportType = async (t: 'fisik' | 'digital') => {
    const all = await db.licenseCodes.where('status').equals('tersedia').toArray();
    const by: Record<string, string[]> = {};
    for (const c of all) (by[c.productId] ??= []).push(c.code);
    download(`produk-${t}.csv`, productsToCsvByType(products, t, by));
  };

  return (
    <div className="fillcol">
      <div className="pm-card">
        <div className="bar">
          <b>Ringkasan stok</b>
          <span>Habis <b className="pm-s-habis">{sum.habis}</b></span>
          <span>Menipis <b className="pm-s-menipis">{sum.menipis}</b></span>
          <span>Aman <b>{sum.aman}</b></span>
          <span className="mut">Tak terbatas {sum.tak}</span>
          <span className="sp" />
          <button onClick={() => setShowCats(true)}>Kategori</button>
        </div>
        {lowList.length > 0 && (
          <div className="bar">
            <small className="mut">Perlu restock:</small>
            {lowList.map((p) => <button key={p.id} className="pm-low" onClick={() => setStockOf(p.id)}>{p.name} ({totalStock(p, pools[p.id]) ?? '∞'})</button>)}
          </div>
        )}
      </div>

      <div className="bar">
        <div className="pm-chips">
          <button className={!type ? 'on' : ''} onClick={() => setType('')}>Semua ({live.length})</button>
          {TYPES.map((t) => <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>{TYPE_LABEL[t]} ({countOf(t)})</button>)}
        </div>
        <div className="pm-chips">
          {STATUSES.map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(status === s ? '' : s)}>{STATUS_LABEL_STOCK[s]}</button>)}
        </div>
        <input placeholder="Cari nama / SKU / barcode / tag" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Semua kategori</option>
          {cats.map((c) => <option key={c.id}>{c.name}</option>)}
        </select>
        <label className="chk"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Arsip</label>
      </div>
      <div className="bar">
        <button className="pri" onClick={() => setForm(emptyDraft(type || 'fisik'))}>Tambah produk</button>
        <span className="sp" />
        <select value={importType} onChange={(e) => setImportType(e.target.value as 'fisik' | 'digital')}>
          <option value="fisik">CSV fisik</option><option value="digital">CSV digital</option>
        </select>
        <button onClick={() => fileRef.current?.click()}>Impor CSV</button>
        <button onClick={() => download('template-produk-fisik.csv', productTemplateByType('fisik'))}>Template fisik</button>
        <button onClick={() => download('template-produk-digital.csv', productTemplateByType('digital'))}>Template digital</button>
        <button onClick={() => void exportType('fisik')}>Ekspor fisik</button>
        <button onClick={() => void exportType('digital')}>Ekspor digital</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
      {sel.size > 0 && (
        <div className="bar pm-card">
          <b>{sel.size} dipilih</b>
          <button onClick={() => void bulk('aktif')}>Aktifkan</button>
          <button onClick={() => void bulk('nonaktif')}>Nonaktifkan</button>
          <button onClick={() => void bulk('arsip')}>Arsipkan</button>
          <select value={bulkCat} onChange={(e) => setBulkCat(e.target.value)}><option value="">(tanpa kategori)</option>{cats.map((c) => <option key={c.id}>{c.name}</option>)}</select>
          <button onClick={() => void bulk('kategori')}>Set kategori</button>
          <button onClick={() => void bulk('hapus')}>Hapus</button>
        </div>
      )}
      {msg && <p className="note">{msg}</p>}

      <ScrollTable label="Daftar produk" stickyFirst>
        <table>
          <thead><tr><th><input type="checkbox" checked={allSel} onChange={toggleAll} /></th><th>Produk</th><th>Tipe</th><th>SKU</th><th>Kategori</th><th className="num">Harga</th><th className="num">Modal</th><th className="num">Stok</th><th></th></tr></thead>
          <tbody>
            {shown.map((p) => {
              const t = typeOf(p);
              const st = stockStatus(p, pools[p.id]);
              const tot = totalStock(p, pools[p.id]);
              const lv = lowVariants(p).length;
              return (
                <tr key={p.id} className={p.active ? '' : 'off'}>
                  <td><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} /></td>
                  <td className="wrap">{p.photo && <img className="thumb" src={p.photo} alt="" />} {p.name}{!p.active && <small className="mut"> (nonaktif)</small>}
                    {!!p.variants?.length && <small className="mut"> · {p.variants.length} varian</small>}</td>
                  <td><span className={'pm-badge ' + t}>{TYPE_LABEL[t]}</span></td>
                  <td>{p.sku}</td><td>{p.category}</td>
                  <td className="num">{fmtIdr(p.price)}{!!p.tiers?.length && <small className="mut"> +grosir</small>}</td>
                  <td className="num">{p.cost == null ? '-' : fmtIdr(p.cost)}</td>
                  <td className={'num pm-s-' + st}>{t === 'jasa' ? '-' : tot == null ? '∞' : `${tot} ${t === 'digital' ? 'kode' : p.unit}`}{lv > 0 && <small> ({lv} varian menipis)</small>}</td>
                  <td className="num">
                    <button onClick={() => setForm({ ...p })}>Ubah</button>{' '}
                    {t === 'fisik' && <button onClick={() => setStockOf(p.id)}>Stok</button>}{' '}
                    <button onClick={() => setForm({ ...p, id: undefined, sku: '', name: p.name + ' (salinan)', variants: (p.variants ?? []).map((v) => ({ ...v, id: crypto.randomUUID(), sku: '' })) })}>Salin</button>
                  </td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={9} className="mut">Tidak ada produk.</td></tr>}
          </tbody>
        </table>
      </ScrollTable>
      {list.length > lim && <More shown={lim} total={list.length} onMore={more} />}

      {form && <ProductForm key={form.id ?? 'new'} initial={form} products={products} cats={cats} onClose={() => setForm(null)} />}
      {stockProduct && <StockDialog product={stockProduct} onClose={() => setStockOf(null)} />}
      {showCats && <CategoryManager cats={cats} onClose={() => setShowCats(false)} />}
    </div>
  );
}
