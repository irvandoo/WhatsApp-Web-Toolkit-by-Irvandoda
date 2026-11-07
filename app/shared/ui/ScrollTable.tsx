import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './scroll-table.css';

/**
 * Scroll wrapper for wide / long data tables.
 *  - scrolls both ways, header row stays visible (sticky), optional sticky first column
 *  - on-screen arrow buttons appear only in directions that can scroll (← → ↑ ↓) + "ke awal / ke akhir"
 *  - drag the header row or empty area to pan; Shift+wheel scrolls sideways; arrow keys work when focused
 *  - always-visible, thick scrollbars and edge shadows hint that more data exists
 * Usage: <ScrollTable maxHeight="60vh" stickyFirst><table className="st">…</table></ScrollTable>
 */
export interface ScrollTableProps {
  children: ReactNode;
  /** CSS max-height of the scroll area (default: fills available height up to 70vh). */
  maxHeight?: string;
  /** Keep the first column visible while scrolling sideways. */
  stickyFirst?: boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
}

type Dir = { left: boolean; right: boolean; up: boolean; down: boolean };
const NONE: Dir = { left: false, right: false, up: false, down: false };
const INTERACTIVE = 'input,select,textarea,button,a,label,[contenteditable="true"],[role="button"]';

export function ScrollTable({ children, maxHeight, stickyFirst, label = 'Tabel data', className, style }: ScrollTableProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [can, setCan] = useState<Dir>(NONE);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const t = 2;
    const next: Dir = {
      left: el.scrollLeft > t,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - t,
      up: el.scrollTop > t,
      down: el.scrollTop + el.clientHeight < el.scrollHeight - t,
    };
    setCan((p) => (p.left === next.left && p.right === next.right && p.up === next.up && p.down === next.down ? p : next));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [measure]);

  const by = (dx: number, dy: number) => ref.current?.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
  const page = () => {
    const el = ref.current;
    return { w: Math.max(120, (el?.clientWidth ?? 400) * 0.8), h: Math.max(80, (el?.clientHeight ?? 300) * 0.8) };
  };
  const edge = (x: 'start' | 'end' | null, y: 'start' | 'end' | null) => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({
      left: x === 'start' ? 0 : x === 'end' ? el.scrollWidth : el.scrollLeft,
      top: y === 'start' ? 0 : y === 'end' ? el.scrollHeight : el.scrollTop,
      behavior: 'smooth',
    });
  };

  // drag-to-pan on the header row / empty space (cell text stays selectable)
  const drag = useRef<{ x: number; y: number; l: number; t: number; id: number } | null>(null);
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const tgt = e.target as HTMLElement;
    if (tgt.closest(INTERACTIVE)) return;
    const onHeadOrBlank = !!tgt.closest('thead') || tgt === ref.current || tgt.tagName === 'TABLE' || tgt.closest('[data-pan]');
    if (!onHeadOrBlank) return;
    const el = ref.current!;
    drag.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop, id: e.pointerId };
    el.setPointerCapture(e.pointerId);
    el.classList.add('panning');
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const el = ref.current!;
    el.scrollLeft = d.l - (e.clientX - d.x);
    el.scrollTop = d.t - (e.clientY - d.y);
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    try { ref.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    drag.current = null;
    ref.current?.classList.remove('panning');
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== ref.current) return; // don't hijack keys inside inputs
    const { w, h } = page();
    const map: Record<string, () => void> = {
      Home: () => edge('start', e.ctrlKey ? 'start' : null),
      End: () => edge('end', e.ctrlKey ? 'end' : null),
      PageDown: () => by(0, h),
      PageUp: () => by(0, -h),
    };
    if (e.shiftKey && e.key === 'ArrowRight') { by(w / 2, 0); e.preventDefault(); return; }
    if (e.shiftKey && e.key === 'ArrowLeft') { by(-w / 2, 0); e.preventDefault(); return; }
    const f = map[e.key];
    if (f) { f(); e.preventDefault(); }
  };

  const Btn = ({ cls, onClick, title, children: c }: { cls: string; onClick: () => void; title: string; children: ReactNode }) => (
    <button type="button" className={`st-btn ${cls}`} onClick={onClick} title={title} aria-label={title}>{c}</button>
  );

  return (
    <div className={`st-wrap${className ? ` ${className}` : ''}`} style={style}>
      <div
        ref={ref}
        className="st-scroll"
        data-sticky-first={stickyFirst ? '1' : undefined}
        style={maxHeight ? { maxHeight } : undefined}
        tabIndex={0}
        role="region"
        aria-label={label}
        onScroll={measure}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
      >
        {children}
      </div>
      <div className={`st-shadow l${can.left ? ' on' : ''}`} aria-hidden="true" />
      <div className={`st-shadow r${can.right ? ' on' : ''}`} aria-hidden="true" />
      <div className={`st-shadow t${can.up ? ' on' : ''}`} aria-hidden="true" />
      <div className={`st-shadow b${can.down ? ' on' : ''}`} aria-hidden="true" />
      {can.left && <Btn cls="l" title="Geser ke kiri (Shift+←)" onClick={() => by(-page().w, 0)}>‹</Btn>}
      {can.right && <Btn cls="r" title="Geser ke kanan (Shift+→)" onClick={() => by(page().w, 0)}>›</Btn>}
      {can.up && <Btn cls="u" title="Naik (PageUp)" onClick={() => by(0, -page().h)}>︿</Btn>}
      {can.down && <Btn cls="d" title="Turun (PageDown)" onClick={() => by(0, page().h)}>﹀</Btn>}
      {(can.left || can.right || can.up || can.down) && (
        <div className="st-edges" role="group" aria-label="Lompat ke tepi tabel">
          {can.left && <button type="button" onClick={() => edge('start', null)} title="Ke kolom pertama">⇤</button>}
          {can.right && <button type="button" onClick={() => edge('end', null)} title="Ke kolom terakhir">⇥</button>}
          {can.up && <button type="button" onClick={() => edge(null, 'start')} title="Ke baris pertama">⤒</button>}
          {can.down && <button type="button" onClick={() => edge(null, 'end')} title="Ke baris terakhir">⤓</button>}
        </div>
      )}
    </div>
  );
}
