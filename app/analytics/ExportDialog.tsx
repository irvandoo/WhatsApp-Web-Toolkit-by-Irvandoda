import { useEffect, useMemo, useRef, useState } from 'react';
import type { MsgEvent, Summary, UnansweredRow, Interaction } from '../shared/analytics-types';
import type { LeadIntel } from '../shared/lead-intel-logic';
import { ALL_SECTIONS, accountLabelOf, buildReportModel, defaultSubtitle, HONEST_NOTE, reportFilename, type Orientation, type ReportSections } from '../shared/report/model';
import { buildWaReportText } from '../shared/report/wa-text';
import { heatmapGrid } from '../shared/report/model';
import type { Stats } from '../shared/stats-logic';
import { usePersistentState } from '../shared/ui/persist';
import { makePdf, makePng, makeXlsx, renderPreview, saveBlob, type Format, type OutFile } from './exporter';

interface Props {
  stats: Stats;
  summary: Summary; prev: Summary | null; unanswered: UnansweredRow[]; hot: LeadIntel[]; interactions: Interaction[]; events: MsgEvent[];
  includeGroups: boolean; accountNames: Map<string, string>; accountId: string; now: number; onClose: () => void; onOther: () => void;
}

const FORMATS: [Format, string][] = [['xlsx', 'Excel (.xlsx)'], ['wa', 'Teks WhatsApp'], ['pdf', 'PDF'], ['png', 'PNG']];
const SECS: [keyof ReportSections, string][] = [['kpi', 'Ringkasan KPI'], ['charts', 'Grafik harian/mingguan/bulanan'], ['heatmap', 'Heatmap jam x hari'], ['unanswered', 'Belum Dibalas'], ['hot', 'Lead Panas'], ['interactions', 'Daftar interaksi'], ['stats', 'Statistik (insight, funnel, waktu balasan)']];
const BIZ_KEY = 'wwt.report.business';
const loadBiz = () => { try { return localStorage.getItem(BIZ_KEY) ?? ''; } catch { return ''; } };

export function ExportDialog(p: Props) {
  const accLabel = accountLabelOf(p.accountId, p.accountNames);
  const [format, setFormat] = usePersistentState<Format>('analytics.export.format', 'xlsx', (v): v is Format => FORMATS.some(([k]) => k === v));
  const [sections, setSections] = usePersistentState<ReportSections>('analytics.export.sections', ALL_SECTIONS, (v): v is ReportSections => !!v && typeof v === 'object' && Object.keys(ALL_SECTIONS).every((k) => typeof (v as Record<string, unknown>)[k] === 'boolean'));
  const [title, setTitle] = usePersistentState('analytics.export.title', 'Laporan WhatsApp');
  const [subtitle, setSubtitle] = useState(() => defaultSubtitle(p.summary.range, accLabel));
  const [subEdited, setSubEdited] = useState(false);
  const [business, setBusiness] = usePersistentState('analytics.export.business', loadBiz());
  const [orientation, setOrientation] = usePersistentState<Orientation>('analytics.export.orientation', 'portrait', (v): v is Orientation => v === 'portrait' || v === 'landscape');
  const [topN, setTopN] = usePersistentState('analytics.export.topN', 10);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [pages, setPages] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => { if (!subEdited) setSubtitle(defaultSubtitle(p.summary.range, accLabel)); }, [p.summary.range, accLabel, subEdited]);

  const model = useMemo(() => buildReportModel({
    summary: p.summary, prev: p.prev, unanswered: p.unanswered, hot: p.hot, interactions: p.interactions, events: p.events, includeGroups: p.includeGroups,
    accountNames: p.accountNames, accountId: p.accountId, title, subtitle, business, sections, now: p.now, stats: p.stats,
  }), [p.stats, p.summary, p.prev, p.unanswered, p.hot, p.interactions, p.events, p.includeGroups, p.accountNames, p.accountId, title, subtitle, business, sections, p.now]);

  const wa = useMemo(() => format !== 'wa' ? null : buildWaReportText(p.summary, p.unanswered, p.hot, {
    title, business, accountLabel: accLabel, prev: p.prev, topN, now: p.now, sections, heatmap: heatmapGrid(p.events, p.includeGroups).grid, stats: p.stats,
  }), [p.stats, format, p.summary, p.unanswered, p.hot, title, business, accLabel, p.prev, topN, p.now, sections, p.events, p.includeGroups]);

  // live canvas preview (debounced; first page only)
  useEffect(() => {
    if (format !== 'pdf' && format !== 'png') return;
    const t = setTimeout(() => {
      try { if (canvasRef.current) setPages(renderPreview(model, orientation, format, canvasRef.current)); } catch (e) { setStatus(e instanceof Error ? e.message : 'Pratinjau gagal.'); }
    }, 250);
    return () => clearTimeout(t);
  }, [model, orientation, format]);

  // focus trap + Esc
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('select,input,button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); if (!busy) p.onClose(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href]')].filter((x) => !(x as HTMLButtonElement).disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prevFocus?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  const any = Object.values(sections).some(Boolean);
  const acc = p.accountId ? accLabel : null;
  const setSec = (k: keyof ReportSections, v: boolean) => setSections((s) => ({ ...s, [k]: v }));

  async function run(fn: () => Promise<OutFile[]>) {
    setBusy(true); setStatus('Menyiapkan...');
    try {
      await new Promise((r) => setTimeout(r, 0));
      const files = await fn();
      for (let i = 0; i < files.length; i++) { saveBlob(files[i].name, files[i].blob); if (i < files.length - 1) await new Promise((r) => setTimeout(r, 400)); }
      setStatus(`Selesai: ${files.map((f) => f.name).join(', ')}`);
    } catch (e) { setStatus(`Gagal: ${e instanceof Error ? e.message : 'kesalahan tidak diketahui'}`); } finally { setBusy(false); }
  }
  const go = () => {
    if (format === 'xlsx') return run(() => makeXlsx(model, p.summary, acc));
    if (format === 'pdf') return run(() => makePdf(model, p.summary, acc, orientation, setStatus));
    if (format === 'png') return run(() => makePng(model, p.summary, acc, orientation, setStatus));
  };

  async function copy() {
    if (!wa) return;
    try { await navigator.clipboard.writeText(wa.text); setStatus('Teks disalin ke clipboard.'); } catch { setStatus('Gagal menyalin. Pilih teks di pratinjau lalu salin manual.'); }
  }
  function txt() {
    if (!wa) return;
    saveBlob(reportFilename(acc, p.summary.range, 'txt'), new Blob(['﻿' + wa.text], { type: 'text/plain;charset=utf-8' }));
    setStatus('Berkas .txt diunduh.');
  }
  async function insert() {
    if (!wa) return;
    setBusy(true);
    try {
      for (let i = 0; i < wa.parts.length; i++) {
        if (wa.parts.length > 1 && i > 0 && !window.confirm(`Bagian ${i}/${wa.parts.length} sudah disisipkan. Kirim dulu di WhatsApp, lalu OK untuk menyisipkan bagian ${i + 1}.`)) { setStatus(`Dihentikan setelah bagian ${i}.`); return; }
        const r = (await chrome.runtime.sendMessage({ kind: 'pos:draft', text: wa.parts[i] })) as { ok?: boolean; error?: string } | undefined;
        if (r && r.ok === false) throw new Error(r.error || 'Gagal');
      }
      setStatus(`Teks disisipkan ke kotak pesan (belum dikirim${wa.parts.length > 1 ? `, ${wa.parts.length} bagian` : ''}).`);
    } catch (e) { setStatus(`Gagal menyisipkan: ${e instanceof Error ? e.message : 'buka chat tujuan di WhatsApp Web dulu.'}`); } finally { setBusy(false); }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) p.onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="exp-title" ref={ref}>
        <div className="modal-head">
          <h2 id="exp-title">Ekspor laporan</h2>
          <button onClick={p.onClose} disabled={busy} aria-label="Tutup">Tutup</button>
        </div>
        <div className="modal-body">
          <div className="exp-form">
            <fieldset><legend>Format</legend>
              <div className="seg">{FORMATS.map(([k, l]) => <button key={k} className={format === k ? 'on' : ''} aria-pressed={format === k} onClick={() => setFormat(k)}>{l}</button>)}</div>
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>CSV dan JSON tetap tersedia di tab Laporan. <button className="linkbtn" onClick={p.onOther}>Buka tab Laporan</button></p>
            </fieldset>
            <fieldset><legend>Isi laporan</legend>
              {SECS.map(([k, l]) => <label key={k} className="chk"><input type="checkbox" checked={sections[k]} onChange={(e) => setSec(k, e.target.checked)} />{l}</label>)}
            </fieldset>
            <label className="fld">Judul<input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="fld">Subjudul<input value={subtitle} maxLength={160} onChange={(e) => { setSubtitle(e.target.value); setSubEdited(true); }} /></label>
            <label className="fld">Nama usaha (opsional)<input value={business} maxLength={80} onChange={(e) => setBusiness(e.target.value)} /></label>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>Periode dan akun mengikuti filter saat ini: <b>{p.summary.range.key === 'all' ? 'Semua data' : defaultSubtitle(p.summary.range, accLabel).replace(/^Periode /, '')}</b></p>
            {(format === 'pdf' || format === 'png') && (
              <label className="fld">Orientasi
                <select value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation)}><option value="portrait">Potret</option><option value="landscape">Lanskap</option></select>
              </label>
            )}
            {format === 'wa' && <label className="fld">Jumlah teratas per daftar<input type="number" min={3} max={50} value={topN} onChange={(e) => setTopN(Math.min(50, Math.max(3, Number(e.target.value) || 10)))} /></label>}
            <p className="note" style={{ margin: 0 }}>{HONEST_NOTE}</p>
          </div>
          <div className="exp-preview">
            <h3>Pratinjau{(format === 'pdf' || format === 'png') && pages > 0 ? ` (halaman 1 dari ${pages})` : ''}{wa && wa.parts.length > 1 ? ` (${wa.parts.length} bagian)` : ''}</h3>
            {format === 'wa' && wa && <pre className="wa-pre" tabIndex={0} aria-label="Pratinjau teks WhatsApp">{wa.text}</pre>}
            {(format === 'pdf' || format === 'png') && <div className="cv-wrap"><canvas ref={canvasRef} aria-label="Pratinjau halaman pertama" /></div>}
            {format === 'xlsx' && <p className="muted">Sheet: Ringkasan{sections.charts ? ', Harian' : ''}{sections.heatmap ? ', Heatmap' : ''}{sections.unanswered ? `, Belum Dibalas (${p.unanswered.length} baris)` : ''}{sections.hot ? `, Lead Panas (${p.hot.length} baris)` : ''}{sections.interactions ? `, Interaksi (${p.interactions.length} baris)` : ''}{sections.stats ? ', Statistik' : ''}.</p>}
          </div>
        </div>
        <div className="modal-foot">
          <span role="status" aria-live="polite" className="exp-status">{status}</span>
          {format === 'wa' ? (
            <div className="btns" style={{ margin: 0 }}>
              <button onClick={() => void copy()} disabled={busy || !any}>Salin teks</button>
              <button onClick={txt} disabled={busy || !any}>Unduh .txt</button>
              <button className="primary" onClick={() => void insert()} disabled={busy || !any}>Sisipkan ke chat</button>
            </div>
          ) : (
            <button className="primary" onClick={() => void go()} disabled={busy || !any}>{busy ? 'Memproses...' : `Unduh ${format === 'xlsx' ? '.xlsx' : format.toUpperCase()}`}</button>
          )}
        </div>
      </div>
    </div>
  );
}
