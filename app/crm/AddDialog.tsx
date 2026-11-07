import { useEffect, useMemo, useRef, useState } from 'react';
import { IS_FULL } from '../shared/credit';
import { ContactIndex, parseTags } from '../shared/crm-logic';
import {
  chunk, crmTemplateCsv, entriesFromChats, entriesFromGroupMembers, entriesFromLabelChats, entriesFromManual, parseCrmCsv, planImport, skipReasons,
  type ImportEntry, type PlanAction,
} from '../shared/crm-import-logic';
import { MANUAL_ACCOUNT, type BulkMode, type BulkResult, type Contact } from '../shared/crm-types';
import type { ChatContact, ChatsContactsResult, GroupInfo, GroupMembersResult, GroupsListResult, LabelChatsResult, LabelInfo, LabelsListResult, RcpPingResult } from '../shared/messages';
import { normalizePhone } from '../shared/recipients-logic';
import { ScrollTable } from '../shared/ui/ScrollTable';
import { usePersistentState } from '../shared/ui/persist';
import { download, idr, isUn, rcp, reasonOf, send, tick, why } from './util';

type Src = 'chat' | 'label' | 'manual' | 'csv' | 'grup';
const TABS: [Src, string][] = [['chat', 'Kontak / Chat'], ['label', 'Label'], ['manual', 'Manual'], ['csv', 'CSV'], ...(IS_FULL ? [['grup', 'Anggota grup'] as [Src, string]] : [])];
const EXAMPLE = 'Budi, 0812 3456 7890\nSiti - +62 813-1111-2222\n62 821 5555 6666';
const SHOW = 200;

export function AddDialog({ stages, contacts, assignees, tags: knownTags, onClose, initialSrc }: {
  stages: string[]; contacts: Contact[]; assignees: string[]; tags: string[]; onClose: () => void; initialSrc?: Src;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [src, setSrc, rSrc] = usePersistentState<Src>('crm.draft.add.src', initialSrc ?? 'chat', (v): v is Src => TABS.some(([k]) => k === v));
  const [acct, setAcct] = useState<string>(MANUAL_ACCOUNT);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // chat
  const [chats, setChats] = useState<ChatContact[] | null>(null);
  const [chatSel, setChatSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [incGroups, setIncGroups] = usePersistentState('crm.draft.add.incGroups', false);
  const [shown, setShown] = useState(SHOW);
  // label
  const [labels, setLabels] = useState<LabelInfo[] | null>(null);
  const [labelSel, setLabelSel] = useState<Set<string>>(new Set());
  const [labelEntries, setLabelEntries] = useState<ImportEntry[]>([]);
  // grup
  const [groups, setGroups] = useState<GroupInfo[] | null>(null);
  const [groupSel, setGroupSel] = useState<Set<string>>(new Set());
  const [groupEntries, setGroupEntries] = useState<ImportEntry[]>([]);
  // manual / csv
  const [manual, setManual] = usePersistentState('crm.draft.add.manual', '');
  const [autoFormat, setAutoFormat] = usePersistentState('crm.draft.add.autoFormat', true);
  const [fixes, setFixes] = useState<Record<number, string>>({});
  const [csv, setCsv] = useState('');
  const [csvName, setCsvName] = useState('');
  const file = useRef<HTMLInputElement>(null);
  // step 2
  const [stage, setStage, rStage] = usePersistentState('crm.draft.add.stage', stages[0] ?? '');
  const [tags, setTags] = usePersistentState<string[]>('crm.draft.add.tags', [], (v): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string'));
  const [tagIn, setTagIn] = useState('');
  const [assignee, setAssignee] = usePersistentState('crm.draft.add.assignee', '');
  const [value, setValue] = usePersistentState('crm.draft.add.value', '');
  const [nt, setNt] = usePersistentState('crm.draft.add.note', '');
  const [mode, setMode] = usePersistentState<BulkMode>('crm.draft.add.mode', 'skip', (v): v is BulkMode => v === 'skip' || v === 'update' || v === 'overwrite' as BulkMode);
  const [skipOpt, setSkipOpt] = usePersistentState('crm.draft.add.skipOpt', true);
  const [pf, setPf] = useState<'all' | PlanAction>('all');
  const [pshown, setPshown] = useState(SHOW);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  useEffect(() => { if (rSrc && initialSrc) setSrc(initialSrc); }, [rSrc]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (rStage && stages.length && !stages.includes(stage)) setStage(stages[0]); }, [rStage, stage, stages]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    ref.current?.focus();
    void rcp<RcpPingResult>({ kind: 'rcp:ping' }).then((r) => { if (r && !isUn(r) && r.accountId) setAcct(r.accountId); }).catch(() => {});
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (s: Set<string>, id: string, fn: (s: Set<string>) => void) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); fn(n); };

  // ---- loaders ----
  const loadChats = async () => {
    setBusy('Memuat daftar chat...'); setNote('');
    try {
      const r = await rcp<ChatsContactsResult>({ kind: 'rcp:chats' });
      if (!r || isUn(r)) { setNote(why(reasonOf(r))); setChats([]); }
      else { setChats(r.chats); if (r.accountId) setAcct(r.accountId); setShown(SHOW); }
    } catch { setNote(why('no-response')); } finally { setBusy(''); }
  };
  const loadLabels = async () => {
    setBusy('Memuat label...'); setNote('');
    try {
      const r = await rcp<LabelsListResult>({ kind: 'rcp:labels' });
      if (!r || isUn(r)) { setNote(why(reasonOf(r))); setLabels([]); } else setLabels(r.labels);
    } catch { setNote(why('no-response')); } finally { setBusy(''); }
  };
  const loadLabelContacts = async () => {
    const ids = [...labelSel];
    setNote(''); setLabelEntries([]);
    const out: ImportEntry[] = [];
    try {
      for (let i = 0; i < ids.length; i++) {
        const nm = labels?.find((l) => l.id === ids[i])?.name ?? '';
        setBusy(`Memuat ${i + 1}/${ids.length}: ${nm}`);
        const r = await rcp<LabelChatsResult>({ kind: 'rcp:label-chats', labelId: ids[i] });
        if (!r || isUn(r)) { setNote(why(reasonOf(r))); continue; }
        out.push(...entriesFromLabelChats(r.chats, nm));
      }
      setLabelEntries(out);
    } catch { setNote(why('no-response')); } finally { setBusy(''); }
  };
  const loadGroups = async () => {
    setBusy('Memuat grup...'); setNote('');
    try {
      const r = await rcp<GroupsListResult>({ kind: 'rcp:groups' });
      if (!r || isUn(r)) { setNote(why(reasonOf(r))); setGroups([]); } else setGroups(r.groups);
    } catch { setNote(why('no-response')); } finally { setBusy(''); }
  };
  const loadMembers = async () => {
    const ids = [...groupSel];
    setNote(''); setGroupEntries([]);
    const out: ImportEntry[] = [];
    try {
      for (let i = 0; i < ids.length; i++) {
        const g = groups?.find((x) => x.id === ids[i]);
        setBusy(`Memuat ${i + 1}/${ids.length}: ${g?.name ?? ''}`);
        const r = await rcp<GroupMembersResult>({ kind: 'rcp:group-members', groupId: ids[i] });
        if (!r || isUn(r)) { setNote(why(reasonOf(r))); continue; }
        out.push(...entriesFromGroupMembers(r.members.filter((m) => !m.isMe), g?.name ?? ''));
      }
      setGroupEntries(out);
    } catch { setNote(why('no-response')); } finally { setBusy(''); }
  };

  // ---- entries per source ----
  const filteredChats = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (chats ?? []).filter((c) => (incGroups || !c.isGroup) && (!s || c.name.toLowerCase().includes(s) || (c.phone ?? '').includes(s)));
  }, [chats, q, incGroups]);
  const chatEntries = useMemo(() => entriesFromChats((chats ?? []).filter((c) => chatSel.has(c.chatId)), { includeGroups: true }), [chats, chatSel]);
  const manualBase = useMemo(() => entriesFromManual(manual, autoFormat), [manual, autoFormat]);
  const manualEntries = useMemo(() => manualBase.map((e, i): ImportEntry => {
    const f = fixes[i];
    if (!e.reason || !f) return e;
    const p = normalizePhone(f);
    return p.ok ? { ...e, phone: p.phone as string, reason: undefined } : e;
  }), [manualBase, fixes]);
  const csvParsed = useMemo(() => parseCrmCsv(csv, stages, csvName || undefined), [csv, stages, csvName]);

  const all: ImportEntry[] = useMemo(
    () => [...chatEntries, ...labelEntries, ...groupEntries, ...manualEntries, ...csvParsed.entries],
    [chatEntries, labelEntries, groupEntries, manualEntries, csvParsed],
  );
  const counts: Record<Src, number> = { chat: chatEntries.length, label: labelEntries.length, grup: groupEntries.length, manual: manualEntries.filter((e) => !e.reason).length, csv: csvParsed.entries.filter((e) => !e.reason).length };

  const idx = useMemo(() => new ContactIndex(contacts), [contacts]);
  const valueNum = Number(value.replace(/[^\d]/g, '')) || undefined;
  const plan = useMemo(() => (step === 2
    ? planImport(all, idx, { accountId: acct, stage, stages, tags, assignee: assignee.trim(), value: valueNum, note: nt.trim(), mode, skipOptOut: skipOpt })
    : null), [step, all, idx, acct, stage, stages, tags, assignee, valueNum, nt, mode, skipOpt]);

  const addTag = () => { const t = parseTags(tagIn); if (t.length) setTags(parseTags([...tags, ...t])); setTagIn(''); };

  const run = async () => {
    if (!plan) return;
    const creates = plan.rows.filter((r) => r.action === 'create' && r.contact).map((r) => r.contact!);
    const updates = plan.rows.filter((r) => r.action === 'update' && r.contact).map((r) => r.contact!);
    const total = creates.length + updates.length;
    const res: BulkResult = { created: 0, updated: 0, skipped: plan.counts.skip, errors: 0 };
    setProg({ done: 0, total }); setResult(null);
    let done = 0;
    const go = async (items: typeof creates, m: BulkMode) => {
      for (const part of chunk(items, 200)) {
        try {
          const r = await send<BulkResult>({ kind: 'crm:contact:bulk-upsert', items: part, mode: m });
          res.created += r.created; res.updated += r.updated; res.skipped += r.skipped; res.errors += r.errors;
        } catch { res.errors += part.length; }
        done += part.length; setProg({ done, total });
        await tick();
      }
    };
    await go(creates, 'skip');
    await go(updates, 'update');
    setResult(res); setProg(null);
    if (res.created + res.updated > 0) { setManual(''); setTags([]); setAssignee(''); setValue(''); setNt(''); }
  };

  const rows = plan ? (pf === 'all' ? plan.rows : plan.rows.filter((r) => r.action === pf)) : [];
  const running = !!prog;
  const label: Record<PlanAction, string> = { create: 'Baru', update: 'Perbarui', skip: 'Lewati' };

  return (
    <div className="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !running) onClose(); }}>
      <div className="dlg" role="dialog" aria-modal="true" aria-label="Tambah ke CRM" tabIndex={-1} ref={ref}>
        <header className="dlg-h">
          <h2>Tambah ke CRM <small className="mut">langkah {step}/2</small></h2>
          <button onClick={onClose} disabled={running} aria-label="Tutup">Tutup</button>
        </header>

        {step === 1 && (
          <div className="dlg-b">
            <div className="rp-tabs" role="tablist" aria-label="Sumber lead">
              {TABS.map(([k, l]) => (
                <button key={k} role="tab" aria-selected={src === k} className={src === k ? 'on' : ''} onClick={() => setSrc(k)}>
                  {l}{counts[k] > 0 && <span className="n">{counts[k]}</span>}
                </button>
              ))}
            </div>

            {src === 'chat' && (
              <div role="tabpanel" aria-label="Kontak WhatsApp">
                <p className="mut">Ambil dari daftar chat WhatsApp. Tab WhatsApp Web harus terbuka.</p>
                <div className="bar">
                  <button className="pri" onClick={() => void loadChats()} disabled={!!busy}>{chats ? 'Muat ulang chat' : 'Muat chat'}</button>
                  {chats && chats.length > 0 && <>
                    <input aria-label="Cari chat" placeholder="Cari nama / nomor" value={q} onChange={(e) => { setQ(e.target.value); setShown(SHOW); }} />
                    <label className="chk"><input type="checkbox" checked={incGroups} onChange={(e) => setIncGroups(e.target.checked)} /> termasuk grup</label>
                    <button onClick={() => setChatSel((s) => new Set([...s, ...filteredChats.map((c) => c.chatId)]))}>Pilih semua ({filteredChats.length})</button>
                    <button onClick={() => setChatSel(new Set())}>Kosongkan</button>
                    <span className="mut" aria-live="polite">{chatSel.size} dipilih</span>
                  </>}
                </div>
                {chats && chats.length > 0 && (
                  <ScrollTable maxHeight="max(200px, calc(100vh - 360px))" label="Daftar chat WhatsApp">
                    <table>
                      <thead><tr><th /><th>Nama</th><th>Nomor</th><th className="num">Belum dibaca</th><th>Terakhir</th></tr></thead>
                      <tbody>
                        {filteredChats.slice(0, shown).map((c) => (
                          <tr key={c.chatId}>
                            <td><input type="checkbox" aria-label={`Pilih ${c.name || c.chatId}`} checked={chatSel.has(c.chatId)} onChange={() => toggle(chatSel, c.chatId, setChatSel)} /></td>
                            <td>{c.name || c.chatId}{c.isGroup ? ' (grup)' : ''}</td>
                            <td>{c.isGroup ? '-' : c.phone ?? <span className="warnc">nomor tidak diketahui</span>}</td>
                            <td className="num">{c.unread || ''}</td>
                            <td>{c.lastTs ? new Date(c.lastTs).toLocaleDateString('id-ID') : '-'}</td>
                          </tr>
                        ))}
                        {!filteredChats.length && <tr><td colSpan={5} className="mut">Tidak ada chat cocok.</td></tr>}
                      </tbody>
                    </table>
                  </ScrollTable>
                )}
                {filteredChats.length > shown && <button onClick={() => setShown(shown + SHOW)}>Tampilkan {Math.min(SHOW, filteredChats.length - shown)} lagi ({shown}/{filteredChats.length})</button>}
              </div>
            )}

            {src === 'label' && (
              <div role="tabpanel" aria-label="Label WhatsApp">
                <p className="mut">Ambil dari label WhatsApp Business. Tab WhatsApp Web harus terbuka. Grup dilewati.</p>
                <div className="bar">
                  <button className="pri" onClick={() => void loadLabels()} disabled={!!busy}>{labels ? 'Muat ulang label' : 'Muat label'}</button>
                  {labels && labels.length > 0 && <>
                    <button onClick={() => setLabelSel(new Set(labels.map((l) => l.id)))}>Pilih semua</button>
                    <button onClick={() => setLabelSel(new Set())}>Kosongkan</button>
                    <button className="pri" disabled={!!busy || !labelSel.size} onClick={() => void loadLabelContacts()}>Muat kontak ({labelSel.size} label)</button>
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
                {labelEntries.length > 0 && <p className="mut" aria-live="polite">{labelEntries.length} kontak dimuat ({labelEntries.filter((e) => e.unknownPhone).length} tanpa nomor, tetap bisa diimpor).</p>}
              </div>
            )}

            {src === 'manual' && (
              <div role="tabpanel" aria-label="Input manual">
                <label className="f">Satu per baris: <code>Nama, nomor</code> atau <code>nomor</code> (boleh tempel dari Excel)
                  <textarea rows={6} value={manual} onChange={(e) => { setManual(e.target.value); setFixes({}); }} placeholder={EXAMPLE} spellCheck={false} />
                </label>
                <label className="chk"><input type="checkbox" checked={autoFormat} onChange={(e) => setAutoFormat(e.target.checked)} /> Format otomatis (08xx / +62 menjadi 62xxxxxxxxxx)</label>
                {(() => {
                  const ok = manualEntries.filter((e) => !e.reason);
                  const bad = manualEntries.map((e, i) => ({ e, i })).filter((x) => x.e.reason);
                  const dup = ok.length - new Set(ok.map((e) => e.phone)).size;
                  return <>
                    <p aria-live="polite" className="mut">{ok.length - dup} valid, {dup} duplikat (dilewati), {bad.length} tidak valid</p>
                    {ok.length > 0 && <div className="mini">{ok.slice(0, 8).map((e, i) => <div key={i}>{e.phone} {e.name ? `- ${e.name}` : ''}</div>)}{ok.length > 8 && <div className="mut">dan {ok.length - 8} lagi</div>}</div>}
                    {bad.slice(0, 30).map(({ e, i }) => <FixRow key={i} original={e.original ?? ''} reason={e.reason ?? ''} onFix={(v) => { if (!normalizePhone(v).ok) return false; setFixes((f) => ({ ...f, [i]: v })); return true; }} />)}
                    {bad.length > 30 && <p className="mut">{bad.length - 30} baris tidak valid lain tidak ditampilkan.</p>}
                  </>;
                })()}
              </div>
            )}

            {src === 'csv' && (
              <div role="tabpanel" aria-label="CSV">
                <p className="mut">Kolom: <code>name,phone,stage,tags,value,assignee,note</code> (tag dipisah titik koma). Nomor otomatis diformat.</p>
                <div className="bar">
                  <button onClick={() => file.current?.click()}>Unggah file CSV</button>
                  <input ref={file} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setCsvName(f.name); void f.text().then(setCsv); } e.target.value = ''; }} />
                  <button onClick={() => download('template-crm.csv', crmTemplateCsv(), 'text/csv;charset=utf-8')}>Unduh template</button>
                </div>
                <label className="f">Isi CSV
                  <textarea rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'name,phone,stage,tags\nBudi,081234567890,Lead baru,vip'} spellCheck={false} />
                </label>
                {csv && <p className="mut" aria-live="polite">{csvParsed.entries.filter((e) => !e.reason).length} baris valid, {csvParsed.entries.filter((e) => e.reason).length} tidak valid.</p>}
                {csvParsed.warnings.map((w) => <p key={w} className="warnc">{w}</p>)}
                {csvParsed.entries.filter((e) => e.reason).slice(0, 10).map((e, i) => <div key={i} className="err">{e.original || '(kosong)'}: {e.reason}</div>)}
              </div>
            )}

            {src === 'grup' && IS_FULL && (
              <div role="tabpanel" aria-label="Anggota grup">
                <p className="mut">Ambil anggota grup. Anggota tanpa nomor terbaca tetap bisa diimpor memakai ID chat.</p>
                <div className="bar">
                  <button className="pri" onClick={() => void loadGroups()} disabled={!!busy}>{groups ? 'Muat ulang grup' : 'Muat grup'}</button>
                  {groups && groups.length > 0 && <>
                    <button onClick={() => setGroupSel(new Set(groups.map((g) => g.id)))}>Pilih semua</button>
                    <button onClick={() => setGroupSel(new Set())}>Kosongkan</button>
                    <button className="pri" disabled={!!busy || !groupSel.size} onClick={() => void loadMembers()}>Muat anggota ({groupSel.size} grup)</button>
                  </>}
                </div>
                {groups && groups.length > 0 && (
                  <div className="rp-list" role="group" aria-label="Daftar grup">
                    {groups.map((g) => (
                      <label key={g.id}><input type="checkbox" checked={groupSel.has(g.id)} onChange={() => toggle(groupSel, g.id, setGroupSel)} />
                        <span style={{ flex: 1 }}>{g.name || g.id}</span><span className="mut">{g.size} anggota</span></label>
                    ))}
                  </div>
                )}
                {groupEntries.length > 0 && <p className="mut">{groupEntries.length} anggota dimuat.</p>}
              </div>
            )}

            {busy && <p role="status" className="mut">{busy}</p>}
            {note && <p role="status" className="err">{note}</p>}
          </div>
        )}

        {step === 2 && plan && (
          <div className="dlg-b">
            <h3 className="h3">Masukkan ke funnel</h3>
            <div className="grid2">
              <label className="f">Tahap tujuan
                <select value={stage} onChange={(e) => setStage(e.target.value)}>{stages.map((s) => <option key={s}>{s}</option>)}</select>
              </label>
              <label className="f">Penanggung jawab
                <input list="crm-assignees" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="opsional" />
                <datalist id="crm-assignees">{assignees.map((a) => <option key={a} value={a} />)}</datalist>
              </label>
              <label className="f">Nilai potensi (Rp)
                <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="opsional" />
              </label>
              <label className="f">Catatan
                <input value={nt} onChange={(e) => setNt(e.target.value)} placeholder="opsional" maxLength={1000} />
              </label>
            </div>
            <div className="f">Tag
              <div className="bar">
                {tags.map((t) => <span key={t} className="tag">{t} <button className="x" aria-label={`Hapus tag ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}>x</button></span>)}
                <input list="crm-tags" value={tagIn} placeholder="ketik tag lalu Enter" aria-label="Tambah tag"
                  onChange={(e) => setTagIn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }} onBlur={addTag} />
                <datalist id="crm-tags">{knownTags.map((t) => <option key={t} value={t} />)}</datalist>
              </div>
            </div>
            <div className="bar">
              <label className="chk"><input type="radio" name="mode" checked={mode === 'skip'} onChange={() => setMode('skip')} /> Lewati yang sudah ada di CRM</label>
              <label className="chk"><input type="radio" name="mode" checked={mode === 'update'} onChange={() => setMode('update')} /> Perbarui yang sudah ada</label>
              <label className="chk"><input type="checkbox" checked={skipOpt} onChange={(e) => setSkipOpt(e.target.checked)} /> Lewati opt-out</label>
            </div>

            <div className="rp-chips" aria-live="polite">
              <span className="rp-chip ok"><b>{plan.counts.create}</b> baru</span>
              <span className="rp-chip">{plan.counts.update} diperbarui</span>
              <span className="rp-chip warn">{plan.counts.skip} dilewati</span>
              {skipReasons(plan).map(([r, n]) => <span key={r} className="rp-chip">{r}: {n}</span>)}
              {valueNum ? <span className="rp-chip">{idr(valueNum)} per kontak</span> : null}
            </div>
            <div className="bar">
              <select aria-label="Filter pratinjau" value={pf} onChange={(e) => { setPf(e.target.value as 'all' | PlanAction); setPshown(SHOW); }}>
                <option value="all">Semua</option><option value="create">Baru</option><option value="update">Diperbarui</option><option value="skip">Dilewati</option>
              </select>
              <span className="mut">Akun: {acct === MANUAL_ACCOUNT ? 'manual (akan digabung otomatis saat chat asli muncul)' : acct}</span>
            </div>
            <ScrollTable maxHeight="max(160px, calc(100vh - 560px))" label="Pratinjau impor">
              <table>
                <thead><tr><th className="num">#</th><th>Aksi</th><th>Nama</th><th>Nomor</th><th>Tahap</th><th>Keterangan</th></tr></thead>
                <tbody>
                  {rows.slice(0, pshown).map((r, i) => (
                    <tr key={i}>
                      <td className="num">{i + 1}</td>
                      <td><span className={`act ${r.action}`}>{label[r.action]}</span></td>
                      <td>{r.entry.name || r.prev?.name || '-'}</td>
                      <td>{r.entry.phone || (r.entry.unknownPhone ? 'tidak diketahui' : '-')}</td>
                      <td>{r.contact?.stage ?? '-'}</td>
                      <td className="wrap">{r.reason ?? (r.entry.sourceDetail ? `${r.entry.source}: ${r.entry.sourceDetail}` : r.entry.source)}</td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={6} className="mut">Tidak ada baris.</td></tr>}
                </tbody>
              </table>
            </ScrollTable>
            {rows.length > pshown && <button onClick={() => setPshown(pshown + SHOW)}>Tampilkan {Math.min(SHOW, rows.length - pshown)} lagi ({pshown}/{rows.length})</button>}
            {prog && <div role="progressbar" aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={prog.done} className="progress"><i style={{ width: `${(prog.done / Math.max(1, prog.total)) * 100}%` }} /><span>{prog.done}/{prog.total}</span></div>}
            {result && <p role="status" className="okc">Selesai: {result.created} dibuat, {result.updated} diperbarui, {result.skipped} dilewati{result.errors ? `, ${result.errors} gagal` : ''}.</p>}
          </div>
        )}

        <footer className="dlg-f">
          <span className="mut">{all.filter((e) => !e.reason).length} entri valid terkumpul{all.some((e) => e.reason) ? `, ${all.filter((e) => e.reason).length} tidak valid` : ''}</span>
          <span style={{ flex: 1 }} />
          {step === 1 && <button className="pri" disabled={!all.some((e) => !e.reason) || !!busy} onClick={() => { setStep(2); setResult(null); }}>Lanjut: masukkan ke funnel</button>}
          {step === 2 && !result && <>
            <button disabled={running} onClick={() => setStep(1)}>Kembali</button>
            <button className="pri" disabled={running || !plan || plan.counts.create + plan.counts.update === 0} onClick={() => void run()}>
              {running ? 'Memproses...' : `Masukkan ${plan ? plan.counts.create + plan.counts.update : 0} kontak`}
            </button>
          </>}
          {result && <button className="pri" onClick={onClose}>Selesai</button>}
        </footer>
      </div>
    </div>
  );
}

function FixRow({ original, reason, onFix }: { original: string; reason: string; onFix: (v: string) => boolean }) {
  const [v, setV] = useState('');
  const [bad, setBad] = useState(false);
  const apply = () => setBad(!onFix(v));
  return (
    <div className="bar fix">
      <span className="err">{original}: {reason}</span>
      <input aria-label={`Perbaiki nomor ${original}`} inputMode="tel" value={v} placeholder="nomor yang benar" aria-invalid={bad}
        onChange={(e) => { setV(e.target.value); setBad(false); }} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} />
      <button onClick={apply} disabled={!v.trim()}>Perbaiki</button>
      {bad && <span className="err" role="alert">masih tidak valid</span>}
    </div>
  );
}
