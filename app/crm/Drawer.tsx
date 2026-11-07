import { useEffect, useRef, useState } from 'react';
import { readPersisted, writePersisted } from '../shared/ui/persist';
import { parseTags } from '../shared/crm-logic';
import { MANUAL_ACCOUNT, type Contact, type CrmNote, type Reminder } from '../shared/crm-types';
import { db } from '../shared/db';
import type { Interaction } from '../shared/analytics-types';
import { normalizePhone } from '../shared/recipients-logic';
import { openChatRoom } from '../analytics/openchat';
import { idr, send, useLive } from './util';

const SRC: Record<string, string> = { chat: 'Chat WhatsApp', label: 'Label', manual: 'Manual', csv: 'CSV', grup: 'Grup', bar: 'Bar chat' };
export const srcLabel = (s?: string) => SRC[s ?? 'bar'] ?? s ?? '';

/** Drawer for a contact (detail + edit + notes/reminders/history) or, with contact=null, the quick "Tambah satu kontak" form. */
export function Drawer({ contact, stages, assignees, tags: known, accountId, interaction, onClose, onMsg }: {
  contact: Contact | null; stages: string[]; assignees: string[]; tags: string[]; accountId: string; interaction?: Interaction;
  onClose: () => void; onMsg: (t: string) => void;
}) {
  const isNew = !contact;
  const [name, setName] = useState(contact?.name ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [stage, setStage] = useState(contact?.stage ?? stages[0] ?? '');
  const [tags, setTags] = useState((contact?.tags ?? []).join(', '));
  const [value, setValue] = useState(contact?.value ? String(contact.value) : '');
  const [assignee, setAssignee] = useState(contact?.assignee ?? '');
  const [note, setNote] = useState(contact?.note ?? '');
  const [optOut, setOptOut] = useState(!!contact?.optOut);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [nt, setNt] = useState('');
  const [rt, setRt] = useState('');
  const [rd, setRd] = useState('');
  const ref = useRef<HTMLElement>(null);
  // draft of the quick add-contact form (new contact only): restored after a refresh, cleared once saved
  const DRAFT = 'crm.draft.one';
  const draftReady = useRef(false);
  type Draft = { name: string; phone: string; stage: string; tags: string; value: string; assignee: string; note: string };
  useEffect(() => {
    if (!isNew) return;
    void readPersisted<Draft | null>(DRAFT, null, (v): v is Draft => !!v && typeof v === 'object' && typeof (v as Draft).name === 'string').then((d) => {
      if (d) { setName((x) => x || d.name); setPhone((x) => x || d.phone); setStage((x) => (stages.includes(d.stage) ? d.stage : x)); setTags((x) => x || d.tags); setValue((x) => x || d.value); setAssignee((x) => x || d.assignee); setNote((x) => x || d.note); }
      draftReady.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!isNew || !draftReady.current) return;
    const t = setTimeout(() => { if (draftReady.current) void writePersisted(DRAFT, { name, phone, stage, tags, value, assignee, note }); }, 300);
    return () => clearTimeout(t);
  }, [isNew, name, phone, stage, tags, value, assignee, note]);
  const key = contact?.key ?? '';
  const notes = useLive(() => (key ? db.notes.where('contactKey').equals(key).reverse().sortBy('createdAt') : Promise.resolve([] as CrmNote[])), [] as CrmNote[]);
  const reminders = useLive(() => (key ? db.reminders.where('contactKey').equals(key).sortBy('dueAt') : Promise.resolve([] as Reminder[])), [] as Reminder[]);

  useEffect(() => {
    ref.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setErr('');
    let ph = phone.trim();
    if (ph) { const p = normalizePhone(ph); if (!p.ok) { setErr(`Nomor: ${p.reason}`); return; } ph = p.phone as string; }
    if (isNew && !ph) { setErr('Nomor wajib diisi.'); return; }
    setBusy(true);
    try {
      const v = Number(value.replace(/[^\d]/g, '')) || 0;
      const base = { name: name.trim(), phone: ph, stage, tags: parseTags(tags), value: v, assignee: assignee.trim(), note: note.trim(), optOut };
      if (isNew) {
        const chatId = `${ph}@c.us`;
        const r = await send<Contact | { ok: false; error: string }>({ kind: 'crm:contact:upsert', contact: { ...base, accountId: accountId || MANUAL_ACCOUNT, chatId, source: 'manual' } });
        if ((r as { error?: string }).error) { setErr(String((r as { error?: string }).error)); return; }
        draftReady.current = false; void writePersisted(DRAFT, null);
        onMsg('Kontak ditambahkan.');
      } else {
        await send({ kind: 'crm:contact:upsert', contact: { ...base, accountId: contact.accountId, chatId: contact.chatId } });
        onMsg('Kontak diperbarui.');
      }
      onClose();
    } catch { setErr('Gagal menyimpan.'); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!contact || !confirm(`Hapus kontak "${contact.name || contact.phone || contact.chatId}" beserta catatan dan pengingatnya?`)) return;
    await send({ kind: 'crm:contact:delete', key: contact.key });
    onMsg('Kontak dihapus.');
    onClose();
  };
  const openChat = async () => { if (contact) onMsg((await openChatRoom({ accountId: contact.accountId === MANUAL_ACCOUNT ? '' : contact.accountId, chatId: contact.chatId, phone: contact.phone })).text); };
  const addNote = async () => { if (key && nt.trim()) { await send({ kind: 'crm:note:add', contactKey: key, text: nt.trim() }); setNt(''); } };
  const addRem = async () => {
    const t = rd ? new Date(rd).getTime() : NaN;
    if (key && Number.isFinite(t)) { await send({ kind: 'crm:reminder:add', contactKey: key, text: rt.trim(), dueAt: t }); setRt(''); setRd(''); }
  };

  return (
    <div className="drawer-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={isNew ? 'Tambah satu kontak' : 'Detail kontak'} tabIndex={-1} ref={ref}>
        <header className="dlg-h">
          <h2>{isNew ? 'Tambah satu kontak' : (contact.name || contact.phone || contact.chatId)}</h2>
          <button onClick={onClose} aria-label="Tutup">Tutup</button>
        </header>
        <div className="dlg-b">
          {contact && (
            <p className="mut">
              {contact.chatId} | akun {contact.accountId} | sumber {srcLabel(contact.source)}{contact.sourceDetail ? ` (${contact.sourceDetail})` : ''}
              <br />Dibuat {new Date(contact.createdAt).toLocaleString('id-ID')}, diperbarui {new Date(contact.updatedAt).toLocaleString('id-ID')}
            </p>
          )}
          <div className="grid2">
            <label className="f">Nama<input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="f">Nomor<input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xx / +62 ..." aria-invalid={!!err && err.startsWith('Nomor')} /></label>
            <label className="f">Tahap<select value={stages.includes(stage) ? stage : stages[0]} onChange={(e) => setStage(e.target.value)}>{stages.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="f">Nilai potensi (Rp)<input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} /></label>
            <label className="f">Penanggung jawab<input list="crm-ass2" value={assignee} onChange={(e) => setAssignee(e.target.value)} /><datalist id="crm-ass2">{assignees.map((a) => <option key={a} value={a} />)}</datalist></label>
            <label className="f">Tag (pisah koma)<input list="crm-tags2" value={tags} onChange={(e) => setTags(e.target.value)} /><datalist id="crm-tags2">{known.map((a) => <option key={a} value={a} />)}</datalist></label>
          </div>
          <label className="f">Catatan<textarea rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></label>
          <label className="chk"><input type="checkbox" checked={optOut} onChange={(e) => setOptOut(e.target.checked)} /> Opt-out (jangan dihubungi / diblast)</label>
          {err && <p role="alert" className="err">{err}</p>}
          <div className="bar">
            <button className="pri" disabled={busy} onClick={() => void save()}>{isNew ? 'Tambah' : 'Simpan'}</button>
            {contact && <button onClick={() => void openChat()}>Buka chat</button>}
            {contact && <button className="danger" onClick={() => void del()}>Hapus</button>}
          </div>

          {contact && <>
            <h3 className="h3">Riwayat</h3>
            {interaction ? (
              <p className="mut">Masuk {interaction.inCount}, keluar {interaction.outCount}. Pesan masuk terakhir {interaction.lastInTs ? new Date(interaction.lastInTs).toLocaleString('id-ID') : '-'}; keluar terakhir {interaction.lastOutTs ? new Date(interaction.lastOutTs).toLocaleString('id-ID') : '-'}.
                {contact.value > 0 ? ` Nilai ${idr(contact.value)}.` : ''}</p>
            ) : <p className="mut">Belum ada riwayat percakapan terekam.</p>}

            <h3 className="h3">Catatan ({notes.length})</h3>
            <div className="bar"><input aria-label="Catatan baru" value={nt} onChange={(e) => setNt(e.target.value)} placeholder="Tulis catatan" onKeyDown={(e) => { if (e.key === 'Enter') void addNote(); }} /><button onClick={() => void addNote()} disabled={!nt.trim()}>Tambah</button></div>
            <ul className="lst">{notes.map((n) => <li key={n.id}><span>{n.text}<small className="mut"> {new Date(n.createdAt).toLocaleString('id-ID')}</small></span><button aria-label="Hapus catatan" onClick={() => void send({ kind: 'crm:note:delete', id: n.id })}>x</button></li>)}</ul>

            <h3 className="h3">Pengingat ({reminders.filter((r) => !r.done).length} terbuka)</h3>
            <div className="bar"><input aria-label="Teks pengingat" value={rt} onChange={(e) => setRt(e.target.value)} placeholder="Follow up..." /><input aria-label="Jatuh tempo" type="datetime-local" value={rd} onChange={(e) => setRd(e.target.value)} /><button onClick={() => void addRem()} disabled={!rd}>Tambah</button></div>
            <ul className="lst">{reminders.map((r) => <li key={r.id}><span className={r.done ? 'mut' : r.dueAt <= Date.now() ? 'overdue' : ''}>{new Date(r.dueAt).toLocaleString('id-ID')} {r.text}{r.done ? ' (selesai)' : ''}</span>{!r.done && <button onClick={() => void send({ kind: 'crm:reminder:done', id: r.id })}>Selesai</button>}</li>)}</ul>
          </>}
        </div>
      </aside>
    </div>
  );
}
