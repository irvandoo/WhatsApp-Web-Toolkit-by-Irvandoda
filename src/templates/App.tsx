import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CrmMsg, Template } from '../shared/crm-types';
import { KNOWN_VARS, render, validateShortcut } from '../shared/template-engine';

const SAMPLE = { nama: 'Budi', telepon: '628123456789', tahap: 'Negosiasi', tanggal: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }), akun: 'Toko A' };

const send = <T,>(m: CrmMsg) => chrome.runtime.sendMessage(m) as Promise<T>;
const blank = (): Template => ({ id: crypto.randomUUID(), shortcut: '', title: '', body: '', category: '', usageCount: 0, updatedAt: Date.now() });

function parseImport(text: string): Template[] {
  const data: unknown = JSON.parse(text);
  const arr = Array.isArray(data) ? data : (data as { templates?: unknown })?.templates;
  if (!Array.isArray(arr)) throw new Error('Format harus berupa array template');
  const seen = new Set<string>();
  return arr.map((raw, i) => {
    const r = raw as Record<string, unknown>;
    if (!r || typeof r !== 'object') throw new Error(`Item ${i + 1} tidak valid`);
    const { shortcut, title, body, category } = r;
    if (typeof shortcut !== 'string' || !validateShortcut(shortcut)) throw new Error(`Item ${i + 1}: shortcut tidak valid`);
    if (seen.has(shortcut)) throw new Error(`Item ${i + 1}: shortcut "${shortcut}" duplikat`);
    seen.add(shortcut);
    if (typeof title !== 'string' || !title.trim() || title.length > 200) throw new Error(`Item ${i + 1}: judul tidak valid`);
    if (typeof body !== 'string' || !body.trim() || body.length > 5000) throw new Error(`Item ${i + 1}: isi tidak valid`);
    if (category !== undefined && (typeof category !== 'string' || category.length > 60)) throw new Error(`Item ${i + 1}: kategori tidak valid`);
    return { id: crypto.randomUUID(), shortcut, title: title.trim(), body, category: (category as string | undefined)?.trim() ?? '', usageCount: 0, updatedAt: Date.now() };
  });
}

export function App() {
  const [list, setList] = useState<Template[]>([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [edit, setEdit] = useState<Template | null>(null);
  const [msg, setMsg] = useState<{ t: string; err?: boolean } | null>(null);
  const [seed, setSeed] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const r = await send<Template[]>({ kind: 'tpl:list' });
    if (Array.isArray(r)) setList(r);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const cats = useMemo(() => [...new Set(list.map((t) => t.category).filter(Boolean))].sort(), [list]);
  const shown = list.filter((t) => (!cat || t.category === cat) &&
    (!q || `${t.shortcut} ${t.title} ${t.body}`.toLowerCase().includes(q.toLowerCase())));

  const preview = useMemo(() => {
    let n = seed;
    const rng = () => { n = (n * 9301 + 49297) % 233280; return n / 233280; };
    return edit ? render(edit.body, SAMPLE, rng) : '';
  }, [edit, seed]);

  async function save() {
    if (!edit) return;
    const r = await send<{ error?: string }>({ kind: 'tpl:upsert', template: edit });
    if (r?.error) return setMsg({ t: r.error, err: true });
    setMsg({ t: 'Tersimpan', err: false });
    setEdit(null);
    await reload();
  }
  async function del(t: Template) {
    if (!confirm(`Hapus template /${t.shortcut}?`)) return;
    await send({ kind: 'tpl:delete', id: t.id });
    await reload();
  }
  async function dup(t: Template) {
    const taken = new Set(list.map((x) => x.shortcut));
    let s = `${t.shortcut}-copy`.slice(0, 24), i = 2;
    while (taken.has(s)) s = `${t.shortcut.slice(0, 20)}-${i++}`;
    const r = await send<{ error?: string }>({ kind: 'tpl:upsert', template: { ...t, id: crypto.randomUUID(), shortcut: s, title: `${t.title} (salinan)`, usageCount: 0 } });
    if (r?.error) setMsg({ t: r.error, err: true });
    await reload();
  }
  function exportJson() {
    const out = list.map(({ shortcut, title, category, body }) => ({ shortcut, title, category, body }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
    a.download = 'template-pesan.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function importJson(f: File) {
    try {
      const items = parseImport(await f.text());
      const taken = new Set(list.map((x) => x.shortcut));
      const clash = items.filter((x) => taken.has(x.shortcut));
      if (clash.length) throw new Error(`Shortcut sudah ada: ${clash.map((c) => '/' + c.shortcut).join(', ')}`);
      for (const t of items) {
        const r = await send<{ error?: string }>({ kind: 'tpl:upsert', template: t });
        if (r?.error) throw new Error(r.error);
      }
      setMsg({ t: `${items.length} template diimpor`, err: false });
      await reload();
    } catch (e) {
      setMsg({ t: `Impor gagal: ${e instanceof Error ? e.message : String(e)}`, err: true });
    }
  }
  function insertVar(v: string) {
    const ta = area.current;
    if (!ta || !edit) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const body = edit.body.slice(0, s) + v + edit.body.slice(e);
    setEdit({ ...edit, body });
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + v.length, s + v.length); });
  }

  const scBad = edit && edit.shortcut !== '' && !validateShortcut(edit.shortcut);

  return (
    <div className="wrap">
      <h1>Template Pesan</h1>
      <div className="bar">
        <input placeholder="Cari template..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Semua kategori</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="pri" onClick={() => { setMsg(null); setEdit(blank()); }}>+ Template baru</button>
        <button onClick={exportJson}>Ekspor JSON</button>
        <button onClick={() => file.current?.click()}>Impor JSON</button>
        <input ref={file} type="file" accept="application/json,.json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ''; }} />
      </div>
      {msg && <p className={msg.err ? 'err' : 'ok'}>{msg.t}</p>}

      {edit && (
        <div className="form">
          <div className="two">
            <label>Shortcut (ketik /shortcut di chat)
              <input value={edit.shortcut} maxLength={24} placeholder="sapaan"
                onChange={(e) => setEdit({ ...edit, shortcut: e.target.value.toLowerCase() })} />
              {scBad && <span className="err">Hanya a-z, 0-9, _ dan -, maks 24 karakter</span>}
            </label>
            <label>Kategori
              <input value={edit.category} maxLength={60} onChange={(e) => setEdit({ ...edit, category: e.target.value })} />
            </label>
          </div>
          <label>Judul
            <input value={edit.title} maxLength={200} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          </label>
          <label>Isi pesan
            <textarea ref={area} value={edit.body} maxLength={5000} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
          </label>
          <div className="row">
            {KNOWN_VARS.map((v) => <button key={v} className="chip" onClick={() => insertVar(`{${v}}`)}>{`{${v}}`}</button>)}
            <button className="chip" onClick={() => insertVar('{Halo|Hai}')}>{'{a|b} spintax'}</button>
          </div>
          <div>
            <div className="meta">Pratinjau (contoh data) <button className="chip" onClick={() => setSeed((s) => s + 7)}>Acak ulang</button></div>
            <div className="preview">{preview || '-'}</div>
          </div>
          <div className="row">
            <button className="pri" disabled={!!scBad || !edit.shortcut || !edit.title.trim() || !edit.body.trim()} onClick={() => void save()}>Simpan</button>
            <button onClick={() => setEdit(null)}>Batal</button>
          </div>
        </div>
      )}

      <div className="grid">
        {shown.map((t) => (
          <div className="card" key={t.id}>
            <div><span className="sc">/{t.shortcut}</span> - {t.title}</div>
            <div className="meta">{t.category || 'Tanpa kategori'} · dipakai {t.usageCount}x</div>
            <div className="body">{t.body}</div>
            <div className="row">
              <button onClick={() => { setMsg(null); setEdit({ ...t }); }}>Edit</button>
              <button onClick={() => void dup(t)}>Duplikat</button>
              <button className="del" onClick={() => void del(t)}>Hapus</button>
            </div>
          </div>
        ))}
        {!shown.length && <p className="meta">Belum ada template.</p>}
      </div>
    </div>
  );
}
