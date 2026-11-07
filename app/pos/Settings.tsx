import { useState } from 'react';
import { DEFAULT_TEMPLATE, formatInvoiceNumber, TEMPLATE_VARS } from '../shared/pos-logic';
import type { PosSettings } from '../shared/pos-types';
import { send } from './util';

export function Settings({ settings }: { settings: PosSettings }) {
  const [s, setS] = useState(settings);
  const [msg, setMsg] = useState('');
  const set = <K extends keyof PosSettings>(k: K, v: PosSettings[K]) => setS((c) => ({ ...c, [k]: v }));
  const save = async () => {
    try { await send({ kind: 'pos:settings:set', patch: s }); setMsg('Tersimpan'); } catch (e) { setMsg(String((e as Error).message)); }
  };
  return (
    <div className="panel set">
      <div className="grid">
        <label>Nama toko<input value={s.storeName} onChange={(e) => set('storeName', e.target.value)} /></label>
        <label>Telepon toko<input value={s.phone} onChange={(e) => set('phone', e.target.value)} /></label>
        <label>Prefix nomor nota<input value={s.prefix} onChange={(e) => set('prefix', e.target.value)} /><small className="mut">Contoh: {formatInvoiceNumber(s.prefix, Date.now(), 1)}</small></label>
        <label>Pajak default (%)<input type="number" min={0} max={100} step="any" value={s.taxPct} onChange={(e) => set('taxPct', Number(e.target.value) || 0)} /></label>
      </div>
      <label>Alamat<textarea rows={2} value={s.address} onChange={(e) => set('address', e.target.value)} /></label>
      <label>Rekening bank (tampil di nota jika belum lunas)<textarea rows={2} value={s.bankText} onChange={(e) => set('bankText', e.target.value)} /></label>
      <label>Teks / tautan QRIS<textarea rows={2} value={s.qrisText} onChange={(e) => set('qrisText', e.target.value)} /></label>
      <label>Footer nota<input value={s.footer} onChange={(e) => set('footer', e.target.value)} /></label>
      <label>Template nota WhatsApp (kosong = bawaan)
        <textarea rows={12} className="wa" value={s.template} placeholder={DEFAULT_TEMPLATE} onChange={(e) => set('template', e.target.value)} /></label>
      <small className="mut">Variabel: {TEMPLATE_VARS.map((v) => `{${v}}`).join(' ')}</small>
      <div className="bar">
        <button onClick={() => set('template', DEFAULT_TEMPLATE)}>Isi dengan template bawaan</button>
        <span className="sp" />{msg && <small>{msg}</small>}
        <button className="pri" onClick={() => void save()}>Simpan</button>
      </div>
    </div>
  );
}
