import { useState } from 'react';
import { normalizePhone } from '../shared/recipients-logic';

/** Single-number input that auto-formats on blur ('+62 857-4747-6308' -> '6285747476308'). Used for schedule targets. */
export function PhoneField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [msg, setMsg] = useState('');
  const fix = () => {
    if (!value.trim()) { setMsg(''); return; }
    const r = normalizePhone(value);
    if (r.ok) { setMsg(''); if (r.phone !== value) onChange(r.phone as string); } else setMsg(r.reason ?? 'Nomor tidak valid');
  };
  return (
    <>
      <input inputMode="tel" value={value} onChange={(e) => onChange(e.target.value)} onBlur={fix} placeholder={placeholder ?? '+62 857-4747-6308'} aria-invalid={!!msg} />
      {msg && <span className="err" role="alert">{msg}</span>}
    </>
  );
}
