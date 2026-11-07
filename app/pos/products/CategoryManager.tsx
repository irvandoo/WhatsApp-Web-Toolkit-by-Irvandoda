import { useState } from 'react';
import type { Category } from '../../shared/pos-types';
import { send } from '../util';

export function CategoryManager({ cats, onClose }: { cats: Category[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const run = async (fn: () => Promise<unknown>) => { try { setErr(''); await fn(); } catch (e) { setErr((e as Error).message); } };
  return (
    <div className="modal" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>Kategori produk</h3>
        <div className="bar">
          <input placeholder="Nama kategori baru" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="pri" disabled={!name.trim()} onClick={() => void run(async () => { await send({ kind: 'pos:category:upsert', name }); setName(''); })}>Tambah</button>
        </div>
        {cats.map((c) => (
          <div className="bar" key={c.id}>
            <span style={{ flex: 1 }}>{c.name}</span>
            <button onClick={() => { const n = prompt('Ganti nama kategori', c.name); if (n?.trim()) void run(() => send({ kind: 'pos:category:upsert', id: c.id, name: n })); }}>Ubah</button>
            <button onClick={() => { if (confirm(`Hapus kategori "${c.name}"? Produknya jadi tanpa kategori.`)) void run(() => send({ kind: 'pos:category:delete', id: c.id })); }}>Hapus</button>
          </div>
        ))}
        {!cats.length && <p className="mut">Belum ada kategori.</p>}
        {err && <p className="note err">{err}</p>}
        <div className="bar"><span className="sp" /><button onClick={onClose}>Tutup</button></div>
      </div>
    </div>
  );
}
