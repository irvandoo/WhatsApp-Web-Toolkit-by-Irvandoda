import { useState } from 'react';
import type { ArGroupRef } from '../shared/autoreply-types';
import type { GroupInfo } from '../shared/messages';

/** Pick groups from the loaded list (full flavor) or type a group name by hand (always available; store flavor only has this). */
export function GroupPicker({ label, value, onChange, loaded }: { label: string; value: ArGroupRef[]; onChange: (v: ArGroupRef[]) => void; loaded: GroupInfo[] | null }) {
  const [manual, setManual] = useState('');
  const has = (g: ArGroupRef) => value.some((x) => (g.id ? x.id === g.id : !x.id && x.name.toLowerCase() === g.name.toLowerCase()));
  const add = (g: ArGroupRef) => { if (!has(g)) onChange([...value, g]); };
  const addManual = () => { const n = manual.trim(); if (n) { add({ id: '', name: n }); setManual(''); } };
  const options = (loaded ?? []).filter((g) => !has({ id: g.id, name: g.name }));
  return (
    <div className="gp">
      <label>{label}</label>
      <div className="row chips">
        {value.map((g) => (
          <button key={g.id || g.name} onClick={() => onChange(value.filter((x) => x !== g))} title="Klik untuk menghapus">
            {g.name || g.id}{g.id ? '' : ' (nama manual)'} ✕
          </button>
        ))}
        {!value.length && <span className="mut">(belum ada)</span>}
      </div>
      <div className="row" style={{ marginTop: 4 }}>
        {loaded && (
          <select aria-label={`${label}: pilih dari daftar grup`} value="" onChange={(e) => { const g = loaded.find((x) => x.id === e.target.value); if (g) add({ id: g.id, name: g.name }); }}>
            <option value="">{options.length ? 'Pilih grup...' : 'Semua grup sudah dipilih'}</option>
            {options.map((g) => <option key={g.id} value={g.id}>{g.name || g.id}</option>)}
          </select>
        )}
        <input placeholder="Atau ketik nama grup persis" value={manual} aria-label={`${label}: nama grup manual`}
          onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addManual(); }} />
        <button onClick={addManual} disabled={!manual.trim()}>Tambah</button>
      </div>
    </div>
  );
}
