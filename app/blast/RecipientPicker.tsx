import { liveQuery } from 'dexie';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IS_FULL } from '../shared/credit';
import type { Contact } from '../shared/crm-types';
import { db } from '../shared/db';
import type { GroupInfo, GroupMembersResult, GroupsListResult, LabelChatsResult, LabelInfo, LabelsListResult, RcpMsg } from '../shared/messages';
import { optOutPhoneSet, parseRecipients, recipientsFromContacts, recipientsTemplateCsv } from '../shared/outbox-logic';
import type { CampaignSource, Recipient } from '../shared/outbox-types';
import {
  SOURCE_LABEL, entriesFromRecipients, mergeRecipients, normalizePhone, parseManualInput, recipientsToCsv, toCampaignRecipients,
  type RecipientEntry, type RecipientSource,
} from '../shared/recipients-logic';
import { RecipientTable } from './RecipientTable';
import './recipients.css';

export interface PickerResult { recipients: Recipient[]; source: CampaignSource; unique: number }

type PTab = 'manual' | 'label' | 'grup' | 'crm' | 'csv';
const TABS: [PTab, string][] = [['manual', 'Manual'], ['label', 'Label'], ['grup', 'Grup'], ['crm', 'CRM'], ['csv', 'CSV']];

function useLiveQ<T>(fn: () => Promise<T>, init: T): T {
  const [v, setV] = useState<T>(init);
  useEffect(() => {
    const sub = liveQuery(fn).subscribe({ next: setV, error: () => {} });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}

const rcp = <T,>(m: RcpMsg): Promise<T> => chrome.runtime.sendMessage(m) as Promise<T>;
const WHY: Record<string, string> = {
  'no-tab': 'Buka tab WhatsApp Web terlebih dahulu.',
  'no-receiver': 'Tab WhatsApp Web belum siap. Muat ulang tab WhatsApp Web lalu coba lagi.',
  'no-response': 'Tidak ada respons dari WhatsApp Web.',
  'no-labels': 'Label tidak tersedia: hanya untuk akun WhatsApp Business, atau struktur WhatsApp Web berubah.',
  'store-flavor': 'Ekstraksi grup hanya ada di versi Full.',
  store: 'Data WhatsApp Web belum siap.',
};
const why = (r?: string) => WHY[r ?? ''] ?? `Tidak tersedia${r ? ` (${r})` : ''}.`;
const isUn = (x: unknown): x is { unavailable: true; reason?: string } => !!x && (x as { unavailable?: boolean }).unavailable === true;

function download(name: string, data: string, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const EXAMPLE = '+62 857-4747-6308\n0812 3456 7890, Budi\nSiti - 0813-1111-2222\n62 821 5555 6666';

export function RecipientPicker({ onChange }: { onChange: (r: PickerResult) => void }) {
  const [tab, setTab] = useState<PTab>('manual');
  const [manual, setManual] = useState('');
  const [autoFormat, setAutoFormat] = useState(true);
  const [csv, setCsv] = useState('');
  const [crmOn, setCrmOn] = useState(false);
  const [stage, setStage] = useState('');
  const [tag, setTag] = useState('');
  const [exOpt, setExOpt] = useState(true);
  const [exPrev, setExPrev] = useState(false);
  // label / group state
  const [labels, setLabels] = useState<LabelInfo[] | null>(null);
  const [labelSel, setLabelSel] = useState<Set<string>>(new Set());
  const [labelData, setLabelData] = useState<Record<string, RecipientEntry[]>>({});
  const [groups, setGroups] = useState<GroupInfo[] | null>(null);
  const [groupSel, setGroupSel] = useState<Set<string>>(new Set());
  const [groupData, setGroupData] = useState<Record<string, RecipientEntry[]>>({});
  const [nonAdmin, setNonAdmin] = useState(false);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');
  const [note, setNote] = useState('');
  // corrections
  const [extras, setExtras] = useState<RecipientEntry[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const file = useRef<HTMLInputElement>(null);

  const contacts = useLiveQ(() => db.contacts.toArray(), [] as Contact[]);
  const stages = useLiveQ(async () => (await db.pipeline.get('default'))?.stages ?? [], [] as string[]);
  const previous = useLiveQ(async () => {
    const s = new Set<string>();
    for (const e of await db.sendLog.toArray()) if (e.status === 'sent' || e.status === 'draft') s.add(e.phone);
    for (const i of await db.outbox.toArray()) if (i.status === 'pending' || i.status === 'sending' || i.status === 'sent' || i.status === 'draft') s.add(i.phone);
    return s;
  }, new Set<string>());
  const tags = useMemo(() => [...new Set(contacts.flatMap((c) => c.tags))].sort(), [contacts]);
  const optOut = useMemo(() => optOutPhoneSet(contacts), [contacts]);

  const manualEntries = useMemo(() => parseManualInput(manual, { autoFormat }), [manual, autoFormat]);
  const csvParsed = useMemo(() => parseRecipients(csv), [csv]);
  const crm = useMemo(() => (crmOn ? recipientsFromContacts(contacts, { stage: stage || undefined, tag: tag || undefined }) : null), [crmOn, contacts, stage, tag]);

  const keyOf = (src: RecipientSource, orig: string) => `${src}\u0001${orig}`;
  const lists = useMemo(() => {
    const keep = (src: RecipientSource, es: RecipientEntry[]) => es.filter((e) => !(e.reason && dismissed.has(keyOf(src, e.original ?? e.phone))));
    const csvEntries: RecipientEntry[] = [
      ...entriesFromRecipients(csvParsed.recipients, 'csv'),
      ...csvParsed.invalid.map((x) => ({ phone: x.raw, original: x.raw, reason: x.reason })),
    ];
    return [
      { source: 'manual' as const, entries: [...keep('manual', manualEntries), ...extras] },
      { source: 'label' as const, entries: keep('label', Object.values(labelData).flat()) },
      { source: 'grup' as const, entries: keep('grup', Object.values(groupData).flat()) },
      { source: 'crm' as const, entries: entriesFromRecipients(crm?.recipients ?? [], 'crm') },
      { source: 'csv' as const, entries: keep('csv', csvEntries) },
    ];
  }, [manualEntries, extras, labelData, groupData, crm, csvParsed, dismissed]);

  const merged = useMemo(
    () => mergeRecipients(lists, { optOut, previous, excludeOptOut: exOpt, excludePrevious: exPrev }),
    [lists, optOut, previous, exOpt, exPrev],
  );
  const finalList = useMemo(() => merged.unique.filter((r) => !removed.has(r.phone)), [merged, removed]);

  const source: CampaignSource = useMemo(() => {
    const used = new Set(finalList.flatMap((r) => r.sources));
    if (used.size === 1 && used.has('crm')) return 'crm';
    if (used.has('crm')) return 'mix';
    return 'csv';
  }, [finalList]);

  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => { cb.current({ recipients: toCampaignRecipients(finalList), source, unique: finalList.length }); }, [finalList, source]);

  const counts: Record<PTab, number> = {
    manual: merged.stats.bySource.manual, label: merged.stats.bySource.label, grup: merged.stats.bySource.grup,
    crm: merged.stats.bySource.crm, csv: merged.stats.bySource.csv,
  };

  // ---- label loading ----
  const loadLabels = async () => {
    setBusy('labels'); setNote('');
    try {
      const r = await rcp<LabelsListResult>({ kind: 'rcp:labels' });
      if (!r || isUn(r)) { setNote(why((r as { reason?: string } | undefined)?.reason)); setLabels([]); } else setLabels(r.labels);
    } catch { setNote(why('no-response')); } finally { setBusy(''); }
  };
  const loadLabelRecipients = async () => {
    const ids = [...labelSel];
    setBusy('label-chats'); setNote(''); setLabelData({});
    const next: Record<string, RecipientEntry[]> = {};
    let unknown = 0;
    try {
      for (let i = 0; i < ids.length; i++) {
        setProgress(`Memuat ${i + 1}/${ids.length}: ${labels?.find((l) => l.id === ids[i])?.name ?? ''}`);
        const r = await rcp<LabelChatsResult>({ kind: 'rcp:label-chats', labelId: ids[i] });
        if (!r || isUn(r)) { setNote(why((r as { reason?: string } | undefined)?.reason)); continue; }
        next[ids[i]] = r.chats.filter((c) => !c.isGroup).map((c): RecipientEntry => {
          if (c.phone) return { phone: `+${c.phone}`, name: c.name || undefined, source: 'label', original: c.phone };
          unknown++;
          return { phone: '', name: c.name || undefined, source: 'label', original: c.name || c.chatId, reason: 'nomor tidak diketahui' };
        });
      }
      setLabelData(next);
      if (unknown) setNote(`${unknown} chat tanpa nomor yang bisa dibaca (nomor tidak diketahui). Perbaiki manual di tabel bila perlu.`);
    } catch { setNote(why('no-response')); } finally { setBusy(''); setProgress(''); }
  };

  // ---- group loading ----
  const loadGroups = async () => {
    setBusy('groups'); setNote('');
    try {
      const r = await rcp<GroupsListResult>({ kind: 'rcp:groups' });
      if (!r || isUn(r)) { setNote(why((r as { reason?: string } | undefined)?.reason)); setGroups([]); } else setGroups(r.groups);
    } catch { setNote(why('no-response')); } finally { setBusy(''); }
  };
  const loadGroupMembers = async () => {
    const ids = [...groupSel];
    setBusy('members'); setNote(''); setGroupData({});
    const next: Record<string, RecipientEntry[]> = {};
    let unknown = 0, trunc = false;
    try {
      for (let i = 0; i < ids.length; i++) {
        setProgress(`Memuat ${i + 1}/${ids.length}: ${groups?.find((g) => g.id === ids[i])?.name ?? ''}`);
        const r = await rcp<GroupMembersResult>({ kind: 'rcp:group-members', groupId: ids[i] });
        if (!r || isUn(r)) { setNote(why((r as { reason?: string } | undefined)?.reason)); continue; }
        if (r.truncated) trunc = true;
        next[ids[i]] = r.members.filter((m) => !m.isMe && !(nonAdmin && (m.isAdmin || m.isSuperAdmin))).map((m): RecipientEntry => {
          if (m.phone) return { phone: `+${m.phone}`, name: m.name || undefined, source: 'grup', original: m.phone };
          unknown++;
          return { phone: '', name: m.name || undefined, source: 'grup', original: m.name || m.id, reason: 'nomor tidak diketahui' };
        });
      }
      setGroupData(next);
      const msgs = [unknown ? `${unknown} anggota tanpa nomor terbaca (ID LID).` : '', trunc ? 'Daftar anggota dipotong pada batas maksimum.' : ''].filter(Boolean);
      if (msgs.length) setNote(msgs.join(' '));
    } catch { setNote(why('no-response')); } finally { setBusy(''); setProgress(''); }
  };

  const toggle = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); fn(n); };

  // ---- table actions ----
  const fixInvalid = (idx: number, value: string): string | null => {
    const inv = merged.invalid[idx];
    if (!inv) return null;
    const r = normalizePhone(value);
    if (!r.ok) return r.reason ?? 'tidak valid';
    const entry = lists[inv.listIndex]?.entries[inv.entryIndex];
    setExtras((x) => [...x, { phone: r.phone as string, name: entry?.name, source: 'manual', original: value, formatted: true }]);
    setDismissed((d) => new Set(d).add(keyOf(inv.source, inv.original)));
    return null;
  };
  const dismissAllInvalid = () => setDismissed((d) => { const n = new Set(d); for (const i of merged.invalid) n.add(keyOf(i.source, i.original)); return n; });
  const resetAll = () => {
    setManual(''); setCsv(''); setCrmOn(false); setLabelData({}); setGroupData({}); setExtras([]); setDismissed(new Set()); setRemoved(new Set()); setNote('');
  };

  const st = merged.stats;
  const manualInv = manualEntries.filter((e) => e.reason).length;
  const manualDup = manualEntries.length - manualEntries.filter((e) => e.reason).length - new Set(manualEntries.filter((e) => !e.reason).map((e) => e.phone)).size;

  return (
    <div>
      <div className="rp-tabs" role="tablist" aria-label="Sumber penerima">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}{counts[k] > 0 && <span className="n">{counts[k]}</span>}
          </button>
        ))}
      </div>

      {tab === 'manual' && (
        <div role="tabpanel" aria-label="Input manual">
          <label className="f">Nomor (satu per baris, atau pisahkan dengan koma / titik koma / tab; boleh tempel dari Excel)
            <textarea rows={7} value={manual} onChange={(e) => setManual(e.target.value)} placeholder={EXAMPLE} spellCheck={false} />
          </label>
          <label className="chk" style={{ margin: '6px 0' }}><input type="checkbox" checked={autoFormat} onChange={(e) => setAutoFormat(e.target.checked)} />
            <span><b>Format otomatis</b>: <code>+62 857-4747-6308</code> menjadi <code>6285747476308</code> (tanpa +, spasi, atau tanda hubung). Mendukung <code>Nama, nomor</code> dan <code>Nama - nomor</code>.</span></label>
          <p aria-live="polite" className="mut">{manualEntries.length - manualInv} valid{manualDup > 0 ? `, ${manualDup} duplikat dihapus` : ', 0 duplikat'}, {manualInv} tidak valid</p>
        </div>
      )}

      {tab === 'label' && (
        <div role="tabpanel" aria-label="Label WhatsApp">
          <p className="mut">Ambil penerima dari label WhatsApp Business. Tab WhatsApp Web harus terbuka. Grup dilewati.</p>
          <div className="row">
            <button onClick={() => void loadLabels()} disabled={!!busy}>{labels ? 'Muat ulang label' : 'Muat label'}</button>
            {labels && labels.length > 0 && <>
              <button onClick={() => setLabelSel(new Set(labels.map((l) => l.id)))}>Pilih semua</button>
              <button onClick={() => setLabelSel(new Set())}>Kosongkan</button>
              <button className="pri" disabled={!!busy || !labelSel.size} onClick={() => void loadLabelRecipients()}>Muat penerima ({labelSel.size} label)</button>
            </>}
          </div>
          {labels && !labels.length && !note && <p className="mut">Tidak ada label.</p>}
          {labels && labels.length > 0 && (
            <div className="rp-list" role="group" aria-label="Daftar label">
              {labels.map((l) => (
                <label key={l.id}><input type="checkbox" checked={labelSel.has(l.id)} onChange={() => toggle(labelSel, l.id, setLabelSel)} />
                  <span className="sw" style={l.color ? { background: l.color } : undefined} aria-hidden="true" />
                  <span style={{ flex: 1 }}>{l.name}</span><span className="mut">{l.count} chat</span></label>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'grup' && (
        <div role="tabpanel" aria-label="Grup WhatsApp">
          {!IS_FULL ? (
            <div className="banner" role="note">Mengambil anggota grup hanya tersedia di versi Full. Gunakan sumber Label, Manual, CRM, atau CSV.</div>
          ) : (
            <>
              <p className="mut">Ambil anggota dari grup WhatsApp. Tab WhatsApp Web harus terbuka. Nomor Anda sendiri dilewati; anggota tanpa nomor terbaca ditandai tidak valid.</p>
              <div className="row">
                <button onClick={() => void loadGroups()} disabled={!!busy}>{groups ? 'Muat ulang grup' : 'Muat grup'}</button>
                {groups && groups.length > 0 && <>
                  <button onClick={() => setGroupSel(new Set(groups.map((g) => g.id)))}>Pilih semua</button>
                  <button onClick={() => setGroupSel(new Set())}>Kosongkan</button>
                  <label className="chk"><input type="checkbox" checked={nonAdmin} onChange={(e) => setNonAdmin(e.target.checked)} /><span>Hanya non-admin</span></label>
                  <button className="pri" disabled={!!busy || !groupSel.size} onClick={() => void loadGroupMembers()}>Muat anggota ({groupSel.size} grup)</button>
                </>}
              </div>
              {groups && !groups.length && !note && <p className="mut">Tidak ada grup.</p>}
              {groups && groups.length > 0 && (
                <div className="rp-list" role="group" aria-label="Daftar grup">
                  {groups.map((g) => (
                    <label key={g.id}><input type="checkbox" checked={groupSel.has(g.id)} onChange={() => toggle(groupSel, g.id, setGroupSel)} />
                      <span style={{ flex: 1 }}>{g.name || g.id}</span><span className="mut">{g.size} anggota</span></label>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'crm' && (
        <div role="tabpanel" aria-label="CRM">
          <label className="chk"><input type="checkbox" checked={crmOn} onChange={(e) => setCrmOn(e.target.checked)} /><span>Tambahkan dari CRM</span></label>
          {crmOn && (
            <div className="row" style={{ margin: '6px 0' }}>
              <select aria-label="Filter tahap" value={stage} onChange={(e) => setStage(e.target.value)}>
                <option value="">Semua tahap</option>{stages.map((s) => <option key={s}>{s}</option>)}
              </select>
              <select aria-label="Filter tag" value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">Semua tag</option>{tags.map((s) => <option key={s}>{s}</option>)}
              </select>
              <span className="mut" aria-live="polite">{crm?.recipients.length ?? 0} kontak
                {crm && (crm.skipped.optOut || crm.skipped.group) ? ` (dilewati: ${crm.skipped.optOut} opt-out, ${crm.skipped.group} grup/tanpa nomor)` : ''}</span>
            </div>
          )}
        </div>
      )}

      {tab === 'csv' && (
        <div role="tabpanel" aria-label="CSV">
          <p className="mut">CSV dengan kolom <code>telepon,nama,...</code>. Kolom tambahan menjadi variabel, misal kolom <code>kota</code> dipakai sebagai <code>{'{kota}'}</code>.</p>
          <div className="row" style={{ marginBottom: 6 }}>
            <button onClick={() => file.current?.click()}>Unggah file CSV</button>
            <input ref={file} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(setCsv); e.target.value = ''; }} />
            <button onClick={() => download('template-penerima.csv', recipientsTemplateCsv(), 'text/csv')}>Unduh template CSV</button>
          </div>
          <label className="f">Daftar penerima (CSV)
            <textarea rows={7} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'telepon,nama,kota\n081234567890,Budi,Bandung'} />
          </label>
        </div>
      )}

      {busy && <p role="status" aria-live="polite" className="mut">{progress || 'Memuat...'}</p>}
      {note && <p role="status" className="err">{note}</p>}

      <div className="rp-chips" aria-live="polite">
        <span className="rp-chip ok"><b>{finalList.length}</b> penerima unik</span>
        <span className="rp-chip warn">{st.duplicates} duplikat dihapus</span>
        <span className={`rp-chip ${st.invalid ? 'bad' : ''}`}>{st.invalid} tidak valid</span>
        {st.optOut > 0 && <span className="rp-chip">{st.optOut} opt-out dilewati</span>}
        {st.previous > 0 && <span className="rp-chip">{st.previous} sudah pernah dikirimi</span>}
        {removed.size > 0 && <span className="rp-chip">{removed.size} dihapus manual</span>}
        {(['manual', 'label', 'grup', 'crm', 'csv'] as RecipientSource[]).filter((s) => st.bySource[s] > 0).map((s) => <span key={s} className="rp-chip">{SOURCE_LABEL[s]} {st.bySource[s]}</span>)}
      </div>

      <div className="row">
        <label className="chk"><input type="checkbox" checked={exOpt} onChange={(e) => setExOpt(e.target.checked)} /><span>Lewati kontak CRM opt-out</span></label>
        <label className="chk"><input type="checkbox" checked={exPrev} onChange={(e) => setExPrev(e.target.checked)} /><span>Lewati nomor yang sudah pernah/sedang dikirimi kampanye</span></label>
      </div>

      <RecipientTable
        unique={finalList}
        invalid={merged.invalid}
        duplicates={merged.duplicates}
        excluded={merged.excluded}
        onFix={fixInvalid}
        onRemove={(phone) => setRemoved((s) => new Set(s).add(phone))}
        onDismissInvalid={dismissAllInvalid}
        onExport={() => download('penerima.csv', recipientsToCsv(finalList), 'text/csv')}
        onReset={resetAll}
      />
    </div>
  );
}
