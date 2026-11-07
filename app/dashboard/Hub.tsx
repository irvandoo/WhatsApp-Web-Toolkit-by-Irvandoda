import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../shared/db';
import { ScrollTable } from '../shared/ui/ScrollTable';
import { useGroups, useNow } from '../shared/ui/hooks';
import { relTime } from '../shared/ui/i18n';
import type { AccountGroup } from '../shared/messages';
import { DEFAULT_SID, SLOT_COLORS, type Slot, type SlotMsg, type SlotPatch } from '../shared/slots';
import {
  VIEW_LABEL, effectiveView, needsQr, parseBulkLabels, parseSlotRegistry, sortSlots, waPhoneFromId, type SortKey,
} from '../shared/slots-logic';
import type { SlotView } from '../shared/slots';

/** Inside the WhatsApp overlay the Hub runs in an iframe. */
export const IN_OVERLAY = (() => { try { return window.parent !== window; } catch { return true; } })();

async function slotSend<T = unknown>(m: SlotMsg): Promise<T> {
  const r = (await chrome.runtime.sendMessage(m)) as T | { error: string } | undefined;
  if (r && typeof r === 'object' && 'error' in r && typeof (r as { error: unknown }).error === 'string') throw new Error((r as { error: string }).error.replace(/^Error:\s*/, ''));
  return r as T;
}

function useSlots(): Slot[] {
  const [v, setV] = useState<Slot[]>([]);
  useEffect(() => {
    const sub = liveQuery(() => db.slots.toArray()).subscribe({ next: setV, error: () => undefined });
    // make sure the default slot exists even if no WA tab was ever opened
    void slotSend({ kind: 'slot:list' }).catch(() => undefined);
    return () => sub.unsubscribe();
  }, []);
  return v;
}

type ToastT = { id: number; text: string; bad?: boolean };
function useToasts() {
  const [list, setList] = useState<ToastT[]>([]);
  const push = (text: string, bad = false) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, bad }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), bad ? 7000 : 4000);
  };
  const el = <div className="toasts" role="status" aria-live="polite">{list.map((x) => <div key={x.id} className={'toast' + (x.bad ? ' bad' : '')}>{x.text}</div>)}</div>;
  return { push, el };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Badge({ view }: { view: SlotView }) {
  return <span className={`sbadge s-${view}`}>{VIEW_LABEL[view]}</span>;
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('keydown', k); try { prev?.focus(); } catch { /* gone */ } };
  }, [onClose]);
  return (
    <div className="modal-bd" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button type="button" aria-label="Tutup" onClick={onClose}>x</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ColorPick({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="row" role="group" aria-label="Warna">
      {SLOT_COLORS.map((c) => (
        <button key={c} type="button" className={'sw' + (c === value ? ' sel' : '')} style={{ background: c }} aria-label={`Warna ${c}`} aria-pressed={c === value} onClick={() => onChange(c)} />
      ))}
      <input type="color" aria-label="Warna kustom" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function GroupPick({ groups, value, onChange }: { groups: AccountGroup[]; value: string | null; onChange: (g: string | null) => void }) {
  const [creating, setCreating] = useState(false), [name, setName] = useState('');
  const create = async () => {
    const n = name.trim(); if (!n) return;
    const g = { id: crypto.randomUUID(), name: n.slice(0, 60), color: '#128c7e' };
    await chrome.runtime.sendMessage({ kind: 'group:upsert', group: g });
    onChange(g.id); setCreating(false); setName('');
  };
  return (
    <div className="row">
      <select aria-label="Grup akun" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Tanpa grup</option>
        {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      {creating
        ? <><input aria-label="Nama grup baru" placeholder="Nama grup baru" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void create(); } }} />
          <button type="button" onClick={() => void create()}>Buat</button></>
        : <button type="button" onClick={() => setCreating(true)}>+ Grup baru</button>}
    </div>
  );
}

export const QR_STEPS = ['Buka WhatsApp di HP', 'Ketuk Perangkat tertaut', 'Ketuk Tautkan perangkat', 'Arahkan kamera HP ke kode QR di layar'];
function QrGuide() {
  return (
    <div className="guide" aria-label="Panduan scan QR">
      <strong>Cara scan QR</strong>
      <ol>{QR_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
    </div>
  );
}

// ---------- Add dialog ----------
function AddDialog({ groups, onClose, toast }: { groups: AccountGroup[]; onClose: () => void; toast: (t: string, bad?: boolean) => void }) {
  const [label, setLabel] = useState(''), [color, setColor] = useState(SLOT_COLORS[0]);
  const [groupId, setGroupId] = useState<string | null>(null), [note, setNote] = useState('');
  const [where, setWhere] = useState<'here' | 'tab'>(IN_OVERLAY ? 'here' : 'tab');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!label.trim()) { toast('Isi nama akun dulu.', true); return; }
    setBusy(true);
    try {
      const s = await slotSend<Slot>({ kind: 'slot:create', label, color, groupId, note });
      if (where === 'here' && IN_OVERLAY) {
        toast('Akun dibuat. Tab ini dimuat ulang, lalu scan QR yang tampil.');
        await slotSend({ kind: 'slot:switch-here', id: s.id });
      } else {
        const r = await slotSend<{ opened?: boolean }>({ kind: 'slot:open-tab', id: s.id });
        toast(r?.opened ? 'Akun dibuat. Tab WhatsApp baru dibuka, scan QR di sana.' : 'Akun dibuat. Tab WhatsApp yang sudah terbuka dialihkan ke akun ini, scan QR di sana.');
      }
      onClose();
    } catch (e) { toast(`Gagal menambah akun: ${errText(e)}`, true); } finally { setBusy(false); }
  };
  return (
    <Modal title="Tambah akun" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <label>Nama / label akun<input autoFocus value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="mis. Toko Utama" /></label>
        <label>Warna<ColorPick value={color} onChange={setColor} /></label>
        <label>Grup akun<GroupPick groups={groups} value={groupId} onChange={setGroupId} /></label>
        <label>Catatan<textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <fieldset>
          <legend>Buka &amp; scan QR</legend>
          {IN_OVERLAY && <label className="inl"><input type="radio" name="w" checked={where === 'here'} onChange={() => setWhere('here')} /> Di tab ini (tab dimuat ulang, QR tampil di layar)</label>}
          <label className="inl"><input type="radio" name="w" checked={where === 'tab'} onChange={() => setWhere('tab')} /> Di tab baru</label>
        </fieldset>
        <QrGuide />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>Batal</button>
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Memproses...' : 'Tambah & scan QR'}</button>
        </div>
      </form>
    </Modal>
  );
}

function BulkDialog({ slots, groups, onClose, toast }: { slots: Slot[]; groups: AccountGroup[]; onClose: () => void; toast: (t: string, bad?: boolean) => void }) {
  const [text, setText] = useState(''), [groupId, setGroupId] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseBulkLabels(text, slots.map((s) => s.label)), [text, slots]);
  const go = async () => {
    if (!parsed.labels.length) { toast('Tidak ada label valid.', true); return; }
    setBusy(true);
    try {
      await slotSend({ kind: 'slot:bulk-create', labels: parsed.labels, groupId });
      toast(`${parsed.labels.length} akun dibuat (belum login). Pakai tombol Scan QR di tiap akun.`);
      onClose();
    } catch (e) { toast(`Gagal: ${errText(e)}`, true); } finally { setBusy(false); }
  };
  return (
    <Modal title="Tambah beberapa akun" onClose={onClose}>
      <div className="form">
        <label>Satu label per baris<textarea autoFocus rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Toko A\nToko B\nCS 1'} /></label>
        <label>Grup<GroupPick groups={groups} value={groupId} onChange={setGroupId} /></label>
        <p className="muted">{parsed.labels.length} akun akan dibuat{parsed.skipped ? `, ${parsed.skipped} baris dilewati (kosong/duplikat)` : ''}{parsed.truncated ? ' (maks 50 sekaligus)' : ''}.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>Batal</button>
          <button type="button" className="primary" disabled={busy || !parsed.labels.length} onClick={() => void go()}>Buat {parsed.labels.length || ''} akun</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Delete dialog ----------
function DeleteDialog({ targets, onClose, toast }: { targets: Slot[]; onClose: () => void; toast: (t: string, bad?: boolean) => void }) {
  const one = targets.length === 1 ? targets[0] : null;
  const [typed, setTyped] = useState(''), [purge, setPurge] = useState(true), [busy, setBusy] = useState(false);
  const phrase = one ? one.label : 'HAPUS';
  const go = async () => {
    setBusy(true);
    const refused: string[] = [];
    let done = 0, queued = 0;
    for (const s of targets) {
      try {
        if (purge) {
          try {
            const r = await slotSend<{ queued?: boolean }>({ kind: 'slot:purge', id: s.id });
            if (r?.queued) queued++;
          } catch (e) { refused.push(`${s.label}: ${errText(e)}`); continue; }
        }
        await slotSend({ kind: 'slot:delete', id: s.id });
        done++;
      } catch (e) { refused.push(`${s.label}: ${errText(e)}`); }
    }
    if (done) toast(`${done} akun dihapus${purge ? (queued ? ` (${queued} data sesi menunggu dibersihkan saat tab WhatsApp dibuka)` : ', data sesi dibersihkan') : ''}.`);
    for (const r of refused) toast(`Tidak dihapus - ${r}`, true);
    setBusy(false);
    onClose();
  };
  return (
    <Modal title={one ? `Hapus akun "${one.label}"?` : `Hapus ${targets.length} akun?`} onClose={onClose}>
      <div className="form">
        <p>Akun dihapus dari daftar Hub. Data CRM/arsip tidak ikut dihapus.</p>
        <label className="inl"><input type="checkbox" checked={purge} onChange={(e) => setPurge(e.target.checked)} /> Hapus juga data sesi (login) dari browser</label>
        {purge && <p className="muted">Akun yang sedang aktif di tab WhatsApp tidak bisa dihapus datanya; pindah akun dulu.</p>}
        <label>Ketik <b>{phrase}</b> untuk konfirmasi<input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus /></label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>Batal</button>
          <button type="button" className="primary danger-bg" disabled={busy || typed.trim() !== phrase} onClick={() => void go()}>Hapus</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Detail drawer ----------
interface Stats { contacts?: number; interactions?: number; messages?: number; campaigns?: number; orders?: number }
async function loadStats(accountId: string): Promise<Stats> {
  const n = async (f: () => Promise<number>) => { try { return await f(); } catch { return undefined; } };
  return {
    contacts: await n(() => db.contacts.where('accountId').equals(accountId).count()),
    interactions: await n(() => db.interactions.where('accountId').equals(accountId).count()),
    messages: await n(() => db.messages.where('accountId').equals(accountId).count()),
    campaigns: await n(() => db.campaigns.filter((c: { accountId?: string }) => c.accountId === accountId).count()),
    orders: await n(() => db.orders.filter((o) => (o as { accountId?: string }).accountId === accountId).count()),
  };
}

function Drawer({ slot, groups, now, onClose, toast, onDelete }: { slot: Slot; groups: AccountGroup[]; now: number; onClose: () => void; toast: (t: string, bad?: boolean) => void; onDelete: (s: Slot) => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [f, setF] = useState({ label: slot.label, color: slot.color, groupId: slot.groupId, note: slot.note, order: slot.order ?? '' as number | '' });
  const [showLogout, setShowLogout] = useState(false);
  useEffect(() => { setF({ label: slot.label, color: slot.color, groupId: slot.groupId, note: slot.note, order: slot.order ?? '' }); }, [slot.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { let on = true; setStats(null); if (slot.accountId) void loadStats(slot.accountId).then((s) => on && setStats(s)); return () => { on = false; }; }, [slot.accountId]);
  const view = effectiveView(slot, now);
  const save = async () => {
    try {
      const patch: SlotPatch = { label: f.label, color: f.color, groupId: f.groupId, note: f.note, order: f.order === '' ? undefined : Number(f.order) };
      await slotSend({ kind: 'slot:update', id: slot.id, patch });
      toast('Perubahan disimpan.');
    } catch (e) { toast(`Gagal menyimpan: ${errText(e)}`, true); }
  };
  const row = (k: string, v: ReactNode) => <><dt>{k}</dt><dd>{v}</dd></>;
  const st = (v?: number) => (v === undefined ? '-' : v.toLocaleString('id-ID'));
  return (
    <aside className="drawer" role="dialog" aria-label={`Detail ${slot.label}`}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <h2 style={{ margin: 0 }}><span className="dot" style={{ background: slot.color }} /> {slot.label}</h2>
        <button type="button" aria-label="Tutup detail" onClick={onClose}>x</button>
      </div>
      <Badge view={view} />
      <dl className="kv">
        {row('Nomor WA', slot.waPhone || waPhoneFromId(slot.accountId) || 'belum login')}
        {row('ID WhatsApp', slot.accountId ?? '-')}
        {row('ID slot', <code>{slot.id}</code>)}
        {row('Dibuat', new Date(slot.createdAt).toLocaleString('id-ID'))}
        {row('Terakhir dipakai', slot.lastUsedAt ? relTime(slot.lastUsedAt, now) : 'belum pernah')}
        {row('Belum dibaca', slot.unread ?? 0)}
        {row('Kontak CRM', st(stats?.contacts))}{row('Interaksi', st(stats?.interactions))}
        {row('Pesan terarsip', st(stats?.messages))}{row('Kampanye', st(stats?.campaigns))}{row('Order POS', st(stats?.orders))}
      </dl>
      {!slot.accountId && <p className="muted">Statistik muncul setelah akun login dan terhubung.</p>}
      <h3>Edit</h3>
      <div className="form">
        <label>Label<input value={f.label} maxLength={40} onChange={(e) => setF({ ...f, label: e.target.value })} /></label>
        <label>Warna<ColorPick value={f.color} onChange={(c) => setF({ ...f, color: c })} /></label>
        <label>Grup<GroupPick groups={groups} value={f.groupId} onChange={(g) => setF({ ...f, groupId: g })} /></label>
        <label>Catatan<textarea rows={2} maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <label>Urutan manual<input type="number" value={f.order} onChange={(e) => setF({ ...f, order: e.target.value === '' ? '' : Number(e.target.value) })} /></label>
        <div className="row"><button type="button" className="primary" onClick={() => void save()}>Simpan</button></div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" onClick={() => void slotSend({ kind: 'slot:update', id: slot.id, patch: { pinned: !slot.pinned } }).then(() => toast(slot.pinned ? 'Sematan dilepas.' : 'Disematkan.')).catch((e) => toast(errText(e), true))}>{slot.pinned ? 'Lepas sematan' : 'Sematkan'}</button>
        {slot.id !== DEFAULT_SID && <button type="button" onClick={() => void slotSend({ kind: 'slot:update', id: slot.id, patch: { archived: !slot.archived } }).then(() => toast(slot.archived ? 'Akun diaktifkan.' : 'Akun diarsipkan.')).catch((e) => toast(errText(e), true))}>{slot.archived ? 'Aktifkan' : 'Arsipkan'}</button>}
        <button type="button" onClick={() => setShowLogout((v) => !v)}>Putuskan / Logout</button>
        {slot.id !== DEFAULT_SID && <button type="button" className="danger" onClick={() => onDelete(slot)}>Hapus</button>}
      </div>
      {showLogout && (
        <div className="guide">
          <strong>Logout tidak bisa dilakukan diam-diam</strong>
          <ol>
            <li>Klik &quot;Buka akun ini&quot; di bawah.</li>
            <li>Di HP: WhatsApp &gt; Perangkat tertaut &gt; pilih perangkat ini &gt; Logout. Atau di WhatsApp Web: menu &gt; Logout.</li>
          </ol>
          <button type="button" onClick={() => void openSlot(slot, toast)}>Buka akun ini</button>
        </div>
      )}
    </aside>
  );
}

async function openSlot(s: Slot, toast: (t: string, bad?: boolean) => void) {
  try {
    const r = await slotSend<{ opened?: boolean; switched?: boolean }>({ kind: 'slot:focus', id: s.id });
    toast(r?.opened ? 'Tab baru dibuka (belum ada tab WhatsApp yang terbuka).' : r?.switched ? 'Tab WhatsApp yang sudah terbuka dialihkan ke akun ini.' : 'Tab akun difokuskan.');
  } catch (e) { toast(`Gagal membuka: ${errText(e)}`, true); }
}

// ---------- Main ----------
const STATUS_FILTERS: [string, string][] = [['all', 'Semua status'], ['qr', 'Perlu scan QR'], ['online', 'Online'], ['loading', 'Memuat'], ['offline', 'Offline'], ['inactive', 'Tidak aktif']];

export function AccountsHub() {
  const slots = useSlots(), groups = useGroups(), now = useNow();
  const { push, el: toasts } = useToasts();
  const [q, setQ] = useState(''), [fg, setFg] = useState('all'), [fs, setFs] = useState('all'), [sort, setSort] = useState<SortKey>('manual');
  const [cards, setCards] = useState(false), [showArch, setShowArch] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState<'add' | 'bulk' | null>(null), [del, setDel] = useState<Slot[] | null>(null), [detail, setDetail] = useState<string | null>(null);
  const [bulkGroup, setBulkGroup] = useState('');

  const gname = (id: string | null) => groups.find((g) => g.id === id);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = slots.filter((x) =>
      (showArch ? !!x.archived : !x.archived) &&
      (fg === 'all' || (fg === '__none__' ? !x.groupId : x.groupId === fg)) &&
      (fs === 'all' || (fs === 'qr' ? needsQr(effectiveView(x, now)) : effectiveView(x, now) === fs)) &&
      (!s || [x.label, x.note, x.accountId, x.waPhone, x.id].some((v) => v?.toLowerCase().includes(s))));
    return sortSlots(list, sort);
  }, [slots, q, fg, fs, sort, showArch, now]);

  const detailSlot = slots.find((x) => x.id === detail) ?? null;
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSel = shown.length > 0 && shown.every((x) => sel.has(x.id));
  const chosen = slots.filter((x) => sel.has(x.id));
  const total = slots.filter((x) => !x.archived).length;
  const nOnline = slots.filter((x) => effectiveView(x, now) === 'online').length;
  const nQr = slots.filter((x) => !x.archived && needsQr(effectiveView(x, now))).length;
  const nUnread = slots.reduce((n, x) => n + (effectiveView(x, now) === 'inactive' ? 0 : x.unread ?? 0), 0);

  const bulk = async (patch: SlotPatch, ok: string) => {
    try { await slotSend({ kind: 'slot:bulk-update', ids: [...sel], patch }); push(ok); setSel(new Set()); } catch (e) { push(`Gagal: ${errText(e)}`, true); }
  };
  const scanQr = async (s: Slot) => {
    try {
      const view = effectiveView(s, now);
      if (IN_OVERLAY && view === 'inactive') {
        await slotSend({ kind: 'slot:switch-here', id: s.id });
        push('Tab dimuat ulang ke akun ini, lalu scan QR.');
      } else await openSlot(s, push);
    } catch (e) { push(`Gagal: ${errText(e)}`, true); }
  };

  const actions = (s: Slot) => (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      {needsQr(effectiveView(s, now)) || !s.accountId ? <button type="button" className="primary" onClick={() => void scanQr(s)}>Scan QR</button> : null}
      <button type="button" onClick={() => void openSlot(s, push)}>Buka</button>
      <button type="button" onClick={() => setDetail(s.id)} aria-label={`Detail ${s.label}`}>Detail</button>
    </div>
  );
  const meta = (s: Slot) => {
    const v = effectiveView(s, now);
    return { v, g: gname(s.groupId), phone: s.waPhone || waPhoneFromId(s.accountId) };
  };

  const doExport = async () => {
    try {
      const r = await slotSend<string>({ kind: 'slot:export' });
      const url = URL.createObjectURL(new Blob([r], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `wwt-akun-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      push('Daftar akun diunduh (tanpa data login).');
    } catch (e) { push(`Gagal ekspor: ${errText(e)}`, true); }
  };
  const doImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      const text = await f.text();
      parseSlotRegistry(text); // strict validation up front for a clear message
      const r = await slotSend<{ added: number; updated: number }>({ kind: 'slot:import', json: text });
      push(`Impor berhasil: ${r.added} baru, ${r.updated} diperbarui. Akun baru perlu scan QR.`);
    } catch (e) { push(`Impor ditolak: ${errText(e)}`, true); }
  };

  return <>
    <div className="hero card">
      <div>
        <h2 style={{ margin: 0 }}>Akun WhatsApp</h2>
        <p className="muted" style={{ margin: '2px 0 0' }}>Tambah akun, lalu scan QR dengan HP. Satu tab hanya menampilkan satu akun aktif.</p>
      </div>
      <div className="row">
        <button type="button" className="primary big" onClick={() => setDlg('add')}>+ Tambah akun</button>
        <button type="button" onClick={() => setDlg('bulk')}>Tambah beberapa akun</button>
      </div>
    </div>
    <div className="summary">
      <div className="card"><div className="muted">Total akun</div><div className="num">{total}</div></div>
      <div className="card"><div className="muted">Online</div><div className="num">{nOnline}</div></div>
      <div className="card"><div className="muted">Perlu scan QR</div><div className="num">{nQr}</div></div>
      <div className="card"><div className="muted">Belum dibaca</div><div className="num">{nUnread}</div></div>
    </div>
    <div className="toolbar">
      <input type="search" aria-label="Cari akun" placeholder="Cari akun..." value={q} onChange={(e) => setQ(e.target.value)} />
      <select aria-label="Filter grup" value={fg} onChange={(e) => setFg(e.target.value)}>
        <option value="all">Semua grup</option><option value="__none__">Tanpa grup</option>
        {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <select aria-label="Filter status" value={fs} onChange={(e) => setFs(e.target.value)}>{STATUS_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <select aria-label="Urutkan" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
        <option value="manual">Urutan manual</option><option value="name">Nama</option><option value="active">Terakhir aktif</option><option value="unread">Belum dibaca</option><option value="created">Terbaru dibuat</option>
      </select>
      <label className="inl"><input type="checkbox" checked={showArch} onChange={(e) => setShowArch(e.target.checked)} /> Arsip</label>
      <button type="button" aria-pressed={cards} onClick={() => setCards((v) => !v)}>{cards ? 'Tampilan tabel' : 'Tampilan kartu'}</button>
    </div>
    {sel.size > 0 && (
      <div className="bulkbar row" role="region" aria-label="Aksi massal">
        <strong>{sel.size} dipilih</strong>
        <select aria-label="Pindah ke grup" value={bulkGroup} onChange={(e) => setBulkGroup(e.target.value)}>
          <option value="">Pilih grup...</option><option value="__none__">Tanpa grup</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <button type="button" disabled={!bulkGroup} onClick={() => void bulk({ groupId: bulkGroup === '__none__' ? null : bulkGroup }, 'Grup dipindahkan.')}>Pindah grup</button>
        <button type="button" onClick={() => void bulk({ archived: !showArch }, showArch ? 'Akun diaktifkan.' : 'Akun diarsipkan.')}>{showArch ? 'Aktifkan' : 'Arsipkan'}</button>
        <button type="button" className="danger" onClick={() => { const t = chosen.filter((x) => x.id !== DEFAULT_SID); if (!t.length) push('Akun utama tidak bisa dihapus.', true); else setDel(t); }}>Hapus</button>
        <button type="button" onClick={() => setSel(new Set())}>Batal pilih</button>
      </div>
    )}
    {!shown.length && (
      <div className="card empty">
        <p>{slots.filter((x) => !x.archived).length <= 1 && !q ? 'Belum ada akun tambahan. Klik "+ Tambah akun" lalu scan QR.' : 'Tidak ada akun yang cocok dengan filter.'}</p>
        <QrGuide />
      </div>
    )}
    {shown.length > 0 && !cards && (
      <ScrollTable stickyFirst label="Daftar akun" maxHeight="max(260px, 62vh)">
        <table>
          <thead><tr>
            <th><input type="checkbox" aria-label="Pilih semua" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(shown.map((x) => x.id)))} /></th>
            <th>Akun</th><th>Status</th><th>Nomor</th><th>Grup</th><th>Belum dibaca</th><th>Terakhir aktif</th><th>Aksi</th>
          </tr></thead>
          <tbody>{shown.map((s) => {
            const { v, g, phone } = meta(s);
            return (
              <tr key={s.id} className={sel.has(s.id) ? 'picked' : ''}>
                <td><input type="checkbox" aria-label={`Pilih ${s.label}`} checked={sel.has(s.id)} onChange={() => toggle(s.id)} /></td>
                <td><span className="dot" style={{ background: s.color }} /> {s.pinned ? '★ ' : ''}<b>{s.label}</b>{s.id === DEFAULT_SID ? <span className="muted"> (utama)</span> : null}</td>
                <td><Badge view={v} /></td>
                <td>{phone || <span className="muted">-</span>}</td>
                <td>{g ? <><span className="dot" style={{ background: g.color }} /> {g.name}</> : <span className="muted">-</span>}</td>
                <td>{v === 'inactive' ? '-' : s.unread ?? 0}</td>
                <td>{s.lastUsedAt ? relTime(s.lastUsedAt, now) : 'belum pernah'}</td>
                <td>{actions(s)}</td>
              </tr>);
          })}</tbody>
        </table>
      </ScrollTable>
    )}
    {shown.length > 0 && cards && (
      <div className="grid">{shown.map((s) => {
        const { v, g, phone } = meta(s);
        return (
          <article key={s.id} className={'card acc' + (sel.has(s.id) ? ' picked' : '')}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input type="checkbox" aria-label={`Pilih ${s.label}`} checked={sel.has(s.id)} onChange={() => toggle(s.id)} />
              <span className="dot" style={{ background: s.color }} /><b style={{ flex: 1 }}>{s.pinned ? '★ ' : ''}{s.label}</b><Badge view={v} />
            </div>
            <div className="muted">{phone || 'belum login'}{g ? ` - ${g.name}` : ''}</div>
            <div className="muted">Belum dibaca: {v === 'inactive' ? '-' : s.unread ?? 0} - {s.lastUsedAt ? relTime(s.lastUsedAt, now) : 'belum pernah'}</div>
            {actions(s)}
          </article>);
      })}</div>
    )}
    <GroupManager groups={groups} toast={push} />
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Ekspor / impor daftar akun</h2>
      <p className="info">Hanya berisi label, warna, grup, dan catatan. <strong>Tidak</strong> berisi sesi login atau kredensial WhatsApp; akun yang diimpor harus scan QR lagi.</p>
      <div className="row">
        <button type="button" className="primary" onClick={() => void doExport()}>Ekspor daftar akun (JSON)</button>
        <label className="row">Impor: <input type="file" accept="application/json,.json" onChange={(e) => { void doImport(e.target.files?.[0]); e.target.value = ''; }} /></label>
      </div>
    </section>
    {dlg === 'add' && <AddDialog groups={groups} onClose={() => setDlg(null)} toast={push} />}
    {dlg === 'bulk' && <BulkDialog slots={slots} groups={groups} onClose={() => setDlg(null)} toast={push} />}
    {del && <DeleteDialog targets={del} onClose={() => { setDel(null); setSel(new Set()); setDetail(null); }} toast={push} />}
    {detailSlot && <Drawer slot={detailSlot} groups={groups} now={now} onClose={() => setDetail(null)} toast={push} onDelete={(s) => setDel([s])} />}
    {toasts}
  </>;
}

function GroupManager({ groups, toast }: { groups: AccountGroup[]; toast: (t: string, bad?: boolean) => void }) {
  const [name, setName] = useState('');
  const call = async (m: unknown, ok: string) => {
    try {
      const r = (await chrome.runtime.sendMessage(m)) as { error?: string } | undefined;
      if (r?.error) throw new Error(r.error);
      toast(ok);
    } catch (e) { toast(`Gagal: ${errText(e)}`, true); }
  };
  const add = () => {
    const n = name.trim(); if (!n) return;
    void call({ kind: 'group:upsert', group: { id: crypto.randomUUID(), name: n.slice(0, 60), color: '#128c7e' } }, 'Grup dibuat.'); setName('');
  };
  // group:delete only clears Account.groupId in the background; slots are cleared here too.
  const remove = async (g: AccountGroup) => {
    if (!confirm('Hapus grup ini? Akun di dalamnya menjadi tanpa grup.')) return;
    try {
      const ids = (await db.slots.filter((s) => s.groupId === g.id).toArray()).map((s) => s.id);
      if (ids.length) await slotSend({ kind: 'slot:bulk-update', ids, patch: { groupId: null } });
    } catch { /* fall through to delete */ }
    await call({ kind: 'group:delete', id: g.id }, 'Grup dihapus.');
  };
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Kelola grup akun</h2>
      {groups.map((g) => (
        <div className="row" key={g.id} style={{ marginBottom: 6 }}>
          <input type="color" aria-label="Warna grup" value={g.color} onChange={(e) => void call({ kind: 'group:upsert', group: { ...g, color: e.target.value } }, 'Warna grup diubah.')} />
          <input aria-label="Nama grup" defaultValue={g.name} key={g.name}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== g.name) void call({ kind: 'group:upsert', group: { ...g, name: v } }, 'Grup diganti nama.'); }} />
          <button type="button" className="danger" onClick={() => void remove(g)}>Hapus</button>
        </div>
      ))}
      <form className="row" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input aria-label="Nama grup baru" placeholder="Nama grup baru" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary" type="submit">Tambah grup</button>
      </form>
    </section>
  );
}
