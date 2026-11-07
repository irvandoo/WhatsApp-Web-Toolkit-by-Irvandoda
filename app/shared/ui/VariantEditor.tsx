import { useMemo, useState } from 'react';
import { MAX_VARIANTS, ROT_LABEL, ROT_STRATEGIES, normStrategy, renderWithRotation, type RotState, type RotStrategy } from '../rotation';
import type { TplVars } from '../template-engine';

interface Props {
  body: string;
  variants: string[] | undefined;
  rotation: RotStrategy | undefined;
  vars: TplVars;
  maxLen: number;
  onChange: (v: { variants: string[]; rotation: RotStrategy }) => void;
}

const box: React.CSSProperties = { border: '1px solid var(--bd, #ccc)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 };
const mut: React.CSSProperties = { color: 'var(--mut, #6a737d)', fontSize: 12, margin: 0 };

/** "Varian pesan" editor: the main text is variant #1, extra variants are added here. Shared by Templates and Auto-reply. */
export function VariantEditor({ body, variants, rotation, vars, maxLen, onChange }: Props) {
  const list = variants ?? [];
  const strat = normStrategy(rotation);
  const [st, setSt] = useState<RotState | undefined>(undefined);
  const [shown, setShown] = useState<{ text: string; n: number } | null>(null);
  const emit = (v: string[], r: RotStrategy = strat) => { setSt(undefined); setShown(null); onChange({ variants: v, rotation: r }); };
  const total = useMemo(() => 1 + list.filter((v) => v.trim()).length, [list]);

  const next = () => {
    const r = renderWithRotation({ body, variants: list, rotation: strat }, vars, st);
    setSt(r.state);
    setShown({ text: r.text, n: r.index + 1 });
  };

  return (
    <div style={box} aria-label="Varian pesan">
      <b>Varian pesan (rotasi)</b>
      <p style={mut}>Isi pesan di atas adalah varian 1. Tambah varian lain agar tiap kirim memakai teks berbeda, tidak monoton. Urutan: pilih varian, isi variabel, lalu acak {'{a|b}'}.</p>
      {list.map((v, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <span style={{ ...mut, paddingTop: 8, minWidth: 18 }}>{i + 2}</span>
          <textarea style={{ flex: 1, minHeight: 54 }} value={v} maxLength={maxLen} aria-label={`Varian ${i + 2}`}
            onChange={(e) => emit(list.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" aria-label={`Hapus varian ${i + 2}`} onClick={() => emit(list.filter((_, j) => j !== i))}>Hapus</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" disabled={list.length >= MAX_VARIANTS} onClick={() => emit([...list, ''])}>+ Tambah varian</button>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Strategi
          <select value={strat} onChange={(e) => emit(list, e.target.value as RotStrategy)}>
            {ROT_STRATEGIES.map((s) => <option key={s} value={s}>{ROT_LABEL[s]}</option>)}
          </select>
        </label>
        <span style={mut}>{list.length}/{MAX_VARIANTS} varian tambahan</span>
      </div>
      {total > 1 && (
        <div>
          <button type="button" onClick={next}>Pratinjau berikutnya</button>
          <div style={{ ...mut, marginTop: 4 }}>{shown ? `Varian ${shown.n} dari ${total}:` : 'Klik untuk melihat urutan rotasi.'}</div>
          {shown && <div style={{ whiteSpace: 'pre-wrap', border: '1px dashed var(--bd, #ccc)', borderRadius: 8, padding: 8 }}>{shown.text || '-'}</div>}
        </div>
      )}
    </div>
  );
}
