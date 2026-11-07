import { useEffect, useMemo, useState } from 'react';
import type { PresetMsg } from '../background/presets';
import type { PresetPack, ExistingState } from '../shared/presets-logic';
import { planApply } from '../shared/presets-logic';
import { render } from '../shared/template-engine';

const send = <T,>(m: PresetMsg): Promise<T> => chrome.runtime.sendMessage(m) as Promise<T>;

interface Meta {
  id: string; industry: string; title: string; description: string; appliedAt: number | null;
  counts: { templates: number; rules: number; stages: number; tags: number; reminders: number };
}
interface Detail { pack: PresetPack; appliedAt: number | null; existing: ExistingState }
interface Summary { ok?: boolean; error?: string; templatesAdded: number; rulesAdded: number; skipped: string[]; stagesApplied: boolean; conflicts: string[] }

const SAMPLE = { nama: 'Budi', telepon: '081234567890', tahap: 'Negosiasi', tanggal: new Date().toLocaleDateString('id-ID'), akun: 'Toko Kami' };
const TABS = ['Template', 'Aturan Auto-reply', 'Pipeline', 'Tag', 'Pengingat'] as const;
type Tab = (typeof TABS)[number];

const ICONS: Record<string, string> = {
  'toko-online': 'M3 9l1.5-5h15L21 9M4 9v11h16V9M9 20v-6h6v6',
  'restoran-hotel': 'M6 3v8a2 2 0 002 2v8M10 3v6M14 21V3c3 1 4 4 4 8h-4',
  klinik: 'M12 5v14M5 12h14M4 4h16v16H4z',
  pendidikan: 'M2 9l10-5 10 5-10 5zM6 11.5V16c3 2.5 9 2.5 12 0v-4.5',
  keuangan: 'M3 7h18v12H3zM3 11h18M7 15h3',
  'layanan-publik': 'M3 21h18M5 21V10M19 21V10M9 21V10M15 21V10M2 10l10-6 10 6z',
  'umum-cs': 'M4 5h16v11H9l-5 4z',
};
const Icon = ({ id }: { id: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[id] ?? ICONS['umum-cs']} /></svg>
);

export function App() {
  const [list, setList] = useState<Meta[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<Tab>('Template');
  const [doT, setDoT] = useState(true);
  const [doR, setDoR] = useState(true);
  const [doP, setDoP] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState('');

  const reload = () => send<Meta[]>({ kind: 'preset:list' }).then(setList).catch(() => setErr('Gagal memuat preset.'));
  useEffect(() => { void reload(); }, []);

  const open = async (id: string) => {
    setErr(''); setSummary(null);
    const d = await send<Detail | { error: string }>({ kind: 'preset:get', id });
    if ('error' in d) { setErr(d.error); return; }
    setDetail(d); setTab('Template'); setDoT(true); setDoR(true); setDoP(false);
    setSel(new Set(d.pack.templates.map((t) => t.shortcut)));
  };
  const close = () => { setDetail(null); setSummary(null); void reload(); };

  const plan = useMemo(() => detail && planApply(detail.pack, detail.existing, {
    templates: doT, rules: doR, pipeline: doP, selectedTemplateShortcuts: [...sel],
  }), [detail, doT, doR, doP, sel]);

  const apply = async () => {
    if (!detail) return;
    setBusy(true); setErr('');
    try {
      const r = await send<Summary>({ kind: 'preset:apply', id: detail.pack.id, options: { templates: doT, rules: doR, pipeline: doP, selectedTemplateShortcuts: [...sel] } });
      if (r.error) setErr(r.error); else setSummary(r);
    } catch { setErr('Gagal menerapkan preset.'); }
    setBusy(false);
  };
  const toggle = (sc: string) => setSel((s) => { const n = new Set(s); if (n.has(sc)) n.delete(sc); else n.add(sc); return n; });
  const nothing = !plan || (plan.templates.length + plan.rules.length === 0 && !plan.stages);

  return (
    <div className="wrap">
      <h1>Preset Industri</h1>
      <p className="mut" style={{ margin: 0 }}>Pilih paket template, aturan auto-reply, dan pipeline sesuai jenis usaha Anda.</p>
      <div className="note" role="note">Template adalah contoh, sesuaikan dengan bisnis Anda. Isi dalam kurung siku [ ] perlu Anda ganti. Aturan auto-reply dibuat nonaktif dengan mode draft.</div>
      {err && !detail && <p className="err" role="alert">{err}</p>}
      <div className="grid">
        {list.map((p) => (
          <button key={p.id} className="card" onClick={() => void open(p.id)} aria-label={`Buka preset ${p.title}`}>
            <Icon id={p.id} />
            <b>{p.title}</b>
            <span className="mut">{p.description.split('. ')[0]}.</span>
            <span className="counts">
              <span className="pill">{p.counts.templates} template</span>
              <span className="pill">{p.counts.rules} aturan</span>
              <span className="pill">{p.counts.stages} tahap</span>
              {p.appliedAt && <span className="pill ok">Sudah diterapkan</span>}
            </span>
          </button>
        ))}
      </div>

      {detail && plan && (
        <>
          <div className="drawer-bg" onClick={close} />
          <aside className="drawer" role="dialog" aria-modal="true" aria-label={detail.pack.title}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>{detail.pack.title}</h2>
              <button onClick={close} aria-label="Tutup">Tutup</button>
            </div>
            <p className="mut">{detail.pack.description}</p>

            {summary ? (
              <div className="opts" role="status">
                <b className="ok">Preset berhasil diterapkan</b>
                <ul className="plain">
                  <li>{summary.templatesAdded} template ditambahkan</li>
                  <li>{summary.rulesAdded} aturan auto-reply ditambahkan (nonaktif, mode draft)</li>
                  <li>Pipeline: {summary.stagesApplied ? 'diganti' : 'tidak diubah'}</li>
                </ul>
                {summary.conflicts.length > 0 && <div className="warn">Penyesuaian: <ul className="plain">{summary.conflicts.map((c) => <li key={c}>{c}</li>)}</ul></div>}
                {summary.skipped.length > 0 && <div className="mut">Dilewati: <ul className="plain">{summary.skipped.map((c) => <li key={c}>{c}</li>)}</ul></div>}
                <p className="mut">Langkah berikutnya: buka halaman <b>Template</b> (#templates) untuk menyunting isi, dan <b>Auto-reply</b> (#autoreply) untuk meninjau lalu mengaktifkan aturan.</p>
                <button className="pri" onClick={close}>Selesai</button>
              </div>
            ) : (
              <>
                <div className="opts">
                  <b>Yang ingin diterapkan</b>
                  <label><input type="checkbox" checked={doT} onChange={(e) => setDoT(e.target.checked)} /> Template ({sel.size} dipilih dari {detail.pack.templates.length})</label>
                  <label><input type="checkbox" checked={doR} onChange={(e) => setDoR(e.target.checked)} /> Aturan auto-reply ({detail.pack.autoReplyRules.length}, nonaktif)</label>
                  <label><input type="checkbox" checked={doP} onChange={(e) => setDoP(e.target.checked)} /> Ganti pipeline ({detail.pack.pipelineStages.length} tahap)</label>
                </div>

                <div className="tabs" role="tablist">
                  {TABS.map((x) => <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{x}</button>)}
                </div>

                {tab === 'Template' && detail.pack.templates.map((x) => (
                  <div className="item" key={x.shortcut}>
                    <label>
                      <input type="checkbox" checked={sel.has(x.shortcut)} onChange={() => toggle(x.shortcut)} aria-label={`Pilih /${x.shortcut}`} />
                      <span><b>/{x.shortcut}</b> {x.title} <span className="pill">{x.category}</span></span>
                    </label>
                    <div className="preview">{render(x.body, SAMPLE, () => 0)}</div>
                  </div>
                ))}
                {tab === 'Aturan Auto-reply' && detail.pack.autoReplyRules.map((r) => (
                  <div className="item" key={r.name}>
                    <b>{r.name}</b> <span className="pill">{r.trigger}</span>
                    {r.keywords.length > 0 && <div className="mut">Kata kunci: {r.keywords.join(', ')}</div>}
                    {r.schedule && <div className="mut">Di luar jam {r.schedule.from}-{r.schedule.to}</div>}
                    <div className="mut">Cooldown {r.cooldownMin} menit, mode draft, nonaktif</div>
                    <div className="preview">{render(r.reply, SAMPLE, () => 0)}</div>
                  </div>
                ))}
                {tab === 'Pipeline' && (
                  <div className="item">
                    <div className="row">{detail.pack.pipelineStages.map((s, i) => <span className="pill" key={s}>{i + 1}. {s}</span>)}</div>
                    <p className="mut">Saat ini: {detail.existing.stages.join(' > ')}</p>
                  </div>
                )}
                {tab === 'Tag' && <div className="item row">{detail.pack.tags.map((s) => <span className="pill" key={s}>{s}</span>)}<span className="mut">Saran tag, tambahkan manual di CRM.</span></div>}
                {tab === 'Pengingat' && <div className="item"><ul className="plain">{detail.pack.reminderIdeas.map((s) => <li key={s}>{s}</li>)}</ul><span className="mut">Ide pengingat, buat manual di CRM.</span></div>}

                <div className="opts" aria-live="polite">
                  <b>Pratinjau penerapan</b>
                  <ul className="plain">
                    <li>{plan.templates.length} template baru, {plan.rules.length} aturan baru{plan.stages ? ', pipeline diganti' : ''}</li>
                  </ul>
                  {plan.conflicts.length > 0 && <ul className="plain warn">{plan.conflicts.map((c) => <li key={c}>{c}</li>)}</ul>}
                  {plan.skipped.length > 0 && <ul className="plain mut">{plan.skipped.map((c) => <li key={c}>{c}</li>)}</ul>}
                </div>
                {err && <p className="err" role="alert">{err}</p>}
                <div className="sticky row">
                  <button className="pri" disabled={busy || nothing} onClick={() => void apply()}>{busy ? 'Menerapkan...' : 'Terapkan preset'}</button>
                  <span className="mut">Menerapkan ulang tidak menggandakan data.</span>
                </div>
              </>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
