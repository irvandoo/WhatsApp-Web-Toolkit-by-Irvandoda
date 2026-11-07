import { liveQuery } from 'dexie';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IS_FULL } from '../shared/credit';
import { db } from '../shared/db';
import type { Contact, CrmMsg } from '../shared/crm-types';
import {
  buildVcard, crmPhoneSet, filterMembers, membersCsv, membersJson, mergeMembers,
  type MergedMember,
} from '../shared/groups-logic';
import type { GroupInfo, GroupMember, GroupMembersResult, GroupsListResult, GrpMsg } from '../shared/messages';

const relay = <T,>(m: GrpMsg): Promise<T> => chrome.runtime.sendMessage(m) as Promise<T>;
const sendCrm = <T,>(m: CrmMsg): Promise<T> => chrome.runtime.sendMessage(m) as Promise<T>;

const REASONS: Record<string, string> = {
  'no-tab': 'Tab WhatsApp Web tidak ditemukan. Buka web.whatsapp.com dan login dulu.',
  'no-receiver': 'Tab WhatsApp Web belum siap. Muat ulang tab WhatsApp Web lalu coba lagi.',
  store: 'Data WhatsApp belum dimuat. Tunggu chat tampil di WhatsApp Web.',
  'no-participants': 'Daftar anggota grup tidak tersedia (buka grup di WhatsApp Web lalu ulangi).',
  'group-not-found': 'Grup tidak ditemukan.',
};
const reasonText = (r?: string) => REASONS[r ?? ''] ?? 'Fitur ini tidak tersedia di versi WhatsApp Web saat ini.';

function download(name: string, data: string, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function useLive<T>(fn: () => Promise<T>, init: T): T {
  const [v, setV] = useState<T>(init);
  useEffect(() => {
    const sub = liveQuery(fn).subscribe({ next: setV, error: () => {} });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_ROWS = 500;

export function App() {
  const contacts = useLive(() => db.contacts.toArray(), [] as Contact[]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [gq, setGq] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [prog, setProg] = useState<{ done: number; total: number; current: string } | null>(null);
  const [results, setResults] = useState<{ group: GroupInfo; members: GroupMember[] }[]>([]);
  const [warn, setWarn] = useState<string[]>([]);
  const cancel = useRef(false);

  const [nonAdmin, setNonAdmin] = useState(false);
  const [notInCrm, setNotInCrm] = useState(false);
  const [withPhone, setWithPhone] = useState(false);
  const [excludeMe, setExcludeMe] = useState(true);
  const [mq, setMq] = useState('');
  const [msel, setMsel] = useState<Set<string>>(new Set());

  const say = (s: string) => { setToast(s); setTimeout(() => setToast(''), 4000); };

  async function loadGroups() {
    setBusy(true); setErr('');
    try {
      const r = await relay<GroupsListResult | { error: string }>({ kind: 'grp:call', op: 'list' });
      if ('error' in r) throw new Error(r.error);
      if (r.unavailable) { setErr(reasonText(r.reason)); return; }
      setGroups([...r.groups].sort((a, b) => a.name.localeCompare(b.name)));
      setAccountId(r.accountId);
      setLoaded(true); setSel(new Set());
      if (!r.groups.length) setErr('Tidak ada grup yang ditemukan.');
    } catch { setErr('Gagal memuat grup.'); } finally { setBusy(false); }
  }

  async function extract() {
    const targets = groups.filter((g) => sel.has(g.id));
    if (!targets.length) return;
    cancel.current = false; setBusy(true); setErr(''); setWarn([]); setResults([]); setMsel(new Set());
    const out: { group: GroupInfo; members: GroupMember[] }[] = [];
    const warns: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      if (cancel.current) break;
      const g = targets[i];
      setProg({ done: i, total: targets.length, current: g.name });
      try {
        const r = await relay<GroupMembersResult | { error: string }>({ kind: 'grp:call', op: 'members', groupId: g.id });
        if ('error' in r) warns.push(`${g.name}: gagal`);
        else if (r.unavailable) warns.push(`${g.name}: ${reasonText(r.reason)}`);
        else {
          out.push({ group: g, members: r.members });
          if (r.truncated) warns.push(`${g.name}: dibatasi 5000 anggota`);
        }
      } catch { warns.push(`${g.name}: gagal`); }
      await sleep(300);
    }
    setProg(null); setResults(out); setWarn(warns); setBusy(false);
    say(cancel.current ? 'Ekstraksi dihentikan.' : `Selesai: ${out.length} grup.`);
  }

  const crmPhones = useMemo(() => crmPhoneSet(contacts), [contacts]);
  const merged = useMemo(
    () => mergeMembers(results.map((r) => ({ group: { id: r.group.id, name: r.group.name }, members: r.members })), { excludeMe }),
    [results, excludeMe]);
  const rows = useMemo(
    () => filterMembers(merged, { nonAdminOnly: nonAdmin, notInCrmOnly: notInCrm, withPhoneOnly: withPhone, query: mq }, crmPhones),
    [merged, nonAdmin, notInCrm, withPhone, mq, crmPhones]);
  const totalRaw = useMemo(() => results.reduce((a, r) => a + r.members.length, 0), [results]);
  const noPhone = useMemo(() => merged.filter((m) => !m.phone).length, [merged]);

  const target: MergedMember[] = msel.size ? rows.filter((r) => msel.has(r.key)) : rows;
  const withNum = target.filter((m) => m.phone);

  const shownGroups = groups.filter((g) => g.name.toLowerCase().includes(gq.trim().toLowerCase()));
  const toggle = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n; };

  async function addToCrm() {
    if (!accountId) return say('Akun WhatsApp belum terdeteksi. Muat ulang grup.');
    const fresh = withNum.filter((m) => !crmPhones.has(m.phone));
    if (!fresh.length) return say('Semua kontak sudah ada di CRM.');
    setBusy(true);
    try {
      for (const m of fresh) {
        await sendCrm({ kind: 'crm:contact:upsert', contact: { accountId, chatId: `${m.phone}@c.us`, name: m.name, phone: m.phone, tags: [`grup:${m.groups[0]}`] } });
      }
      say(`${fresh.length} kontak ditambahkan ke CRM, ${withNum.length - fresh.length} dilewati (sudah ada).`);
    } catch { say('Gagal menambahkan ke CRM.'); } finally { setBusy(false); }
  }

  async function toBlast() {
    if (!withNum.length) return say('Tidak ada nomor untuk dikirim.');
    try {
      await chrome.storage.local.set({ 'wwt-blast-import': { phones: withNum.map((m) => m.phone), names: withNum.map((m) => m.name), ts: Date.now() } });
      say(`${withNum.length} nomor disimpan untuk halaman Blast.`);
    } catch { say('Gagal menyimpan.'); }
  }

  if (!IS_FULL) {
    return (
      <div className="wrap">
        <h1>Ekstrak grup</h1>
        <div className="notice" role="alert">Fitur hanya di build full.</div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <h1>Ekstrak grup</h1>
      <div className="notice" role="note">
        <b>Gunakan dengan bertanggung jawab.</b> Hanya hubungi kontak yang Anda punya dasar hukum atau persetujuan untuk dihubungi.
        Pengiriman pesan massal dapat melanggar Ketentuan Layanan WhatsApp dan berisiko akun diblokir.
        Data tetap tersimpan lokal di perangkat Anda. Hanya grup yang Anda ikuti yang dapat dibaca; tidak ada pengambilan data dari grup lain.
      </div>
      <div aria-live="polite" className="toast">{toast}</div>

      <section aria-labelledby="s1">
        <h2 id="s1">1. Muat grup</h2>
        <div className="bar">
          <button className="on" disabled={busy} onClick={() => void loadGroups()}>{loaded ? 'Muat ulang grup' : 'Muat grup'}</button>
          <input aria-label="Cari grup" placeholder="Cari grup" value={gq} onChange={(e) => setGq(e.target.value)} />
          {loaded && <>
            <button onClick={() => setSel(new Set(shownGroups.map((g) => g.id)))}>Pilih semua</button>
            <button onClick={() => setSel(new Set())}>Kosongkan</button>
            <span className="mut">{sel.size} dipilih dari {groups.length} grup</span>
          </>}
        </div>
        {err && <div className="err" role="alert">{err}</div>}
        {loaded && (
          <div className="glist" role="group" aria-label="Daftar grup">
            {shownGroups.map((g) => (
              <label key={g.id} className="grow">
                <input type="checkbox" checked={sel.has(g.id)} onChange={() => setSel(toggle(sel, g.id))} />
                <span className="gn">{g.name || g.id}</span>
                {g.isAdmin && <span className="badge">Admin</span>}
                <span className="mut">{g.size} anggota</span>
              </label>
            ))}
            {!shownGroups.length && <div className="mut">Tidak ada grup cocok.</div>}
          </div>
        )}
      </section>

      <section aria-labelledby="s2">
        <h2 id="s2">2. Ekstrak anggota</h2>
        <div className="bar">
          <button className="on" disabled={busy || !sel.size} onClick={() => void extract()}>Ekstrak {sel.size} grup</button>
          {prog && <button onClick={() => { cancel.current = true; }}>Hentikan</button>}
          {prog && <span role="status">Memproses {prog.done + 1}/{prog.total}: {prog.current}</span>}
        </div>
        {prog && <progress max={prog.total} value={prog.done} aria-label="Progres ekstraksi" />}
        {warn.map((w, i) => <div key={i} className="err">{w}</div>)}
      </section>

      {results.length > 0 && (
        <section aria-labelledby="s3">
          <h2 id="s3">Hasil</h2>
          <div className="stats">
            <span>Total mentah: <b>{totalRaw}</b></span>
            <span>Unik: <b>{merged.length}</b></span>
            <span>Tanpa nomor: <b>{noPhone}</b></span>
            <span>Tampil: <b>{rows.length}</b></span>
            <span>Dipilih: <b>{msel.size}</b></span>
          </div>
          <div className="bar">
            <input aria-label="Cari anggota" placeholder="Cari nomor / nama / grup" value={mq} onChange={(e) => setMq(e.target.value)} />
            <label><input type="checkbox" checked={nonAdmin} onChange={(e) => setNonAdmin(e.target.checked)} /> Hanya non-admin</label>
            <label><input type="checkbox" checked={notInCrm} onChange={(e) => setNotInCrm(e.target.checked)} /> Hanya belum di CRM</label>
            <label><input type="checkbox" checked={withPhone} onChange={(e) => setWithPhone(e.target.checked)} /> Hanya yang ada nomor</label>
            <label><input type="checkbox" checked={excludeMe} onChange={(e) => setExcludeMe(e.target.checked)} /> Kecualikan nomor saya</label>
          </div>
          <div className="bar">
            <span className="mut">Aksi berlaku untuk {msel.size ? 'baris terpilih' : 'semua hasil tersaring'} ({target.length}):</span>
            <button disabled={!target.length} onClick={() => download('anggota-grup.csv', membersCsv(target), 'text/csv;charset=utf-8')}>Ekspor CSV</button>
            <button disabled={!withNum.length} onClick={() => download('anggota-grup.vcf', buildVcard(target), 'text/vcard;charset=utf-8')}>Ekspor vCard</button>
            <button disabled={!target.length} onClick={() => download('anggota-grup.json', membersJson(target), 'application/json')}>Ekspor JSON</button>
            <button disabled={busy || !withNum.length} onClick={() => void addToCrm()}>Tambah ke CRM</button>
            <button disabled={!withNum.length} onClick={() => void toBlast()}>Gunakan untuk blast</button>
          </div>
          <div className="tw">
            <table>
              <thead><tr>
                <th><input type="checkbox" aria-label="Pilih semua baris" checked={!!rows.length && rows.every((r) => msel.has(r.key))}
                  onChange={(e) => setMsel(e.target.checked ? new Set(rows.map((r) => r.key)) : new Set())} /></th>
                <th>Nomor</th><th>Nama</th><th>Grup</th><th>Admin?</th><th>Di CRM?</th>
              </tr></thead>
              <tbody>
                {rows.slice(0, MAX_ROWS).map((m) => (
                  <tr key={m.key}>
                    <td><input type="checkbox" aria-label={`Pilih ${m.phone || m.name}`} checked={msel.has(m.key)} onChange={() => setMsel(toggle(msel, m.key))} /></td>
                    <td>{m.phone || <span className="mut">(tidak diketahui)</span>}</td>
                    <td>{m.name}</td>
                    <td>{m.groups.join(', ')}</td>
                    <td>{m.isAdmin ? 'Ya' : '-'}</td>
                    <td>{m.phone && crmPhones.has(m.phone) ? 'Ya' : 'Belum'}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={6} className="mut">Tidak ada data yang cocok.</td></tr>}
              </tbody>
            </table>
          </div>
          {rows.length > MAX_ROWS && <div className="mut">Menampilkan {MAX_ROWS} dari {rows.length} baris. Ekspor mencakup semuanya.</div>}
        </section>
      )}
    </div>
  );
}
