import { Fragment, useEffect, useMemo, useState } from 'react';
import { WA_MAX_CHARS, normalizeForWa, renderWaPreviewNodes, splitForWa, type WaInline } from '../shared/wa-format';
import { copyText, send } from './util';

const CSS = `
.wapv{margin:6px 0}
.wapv .chat{background:#efeae2;border-radius:8px;padding:10px;display:flex;justify-content:flex-end}
.wapv .bub{background:#d9fdd3;color:#111b21;border-radius:8px 0 8px 8px;padding:6px 8px 4px;max-width:min(100%,420px);font:13.5px/1.35 system-ui,sans-serif;box-shadow:0 1px .5px rgba(11,20,26,.13);overflow-wrap:anywhere}
.wapv .ln{white-space:pre-wrap;min-height:1.35em}
.wapv .bl{height:1.35em}
.wapv pre.mono{margin:2px 0;padding:4px 6px;background:rgba(0,0,0,.06);border-radius:4px;font:12.5px/1.3 ui-monospace,Consolas,monospace;white-space:pre;overflow-x:auto}
.wapv code{font:12.5px ui-monospace,Consolas,monospace;background:rgba(0,0,0,.06);border-radius:3px;padding:0 3px}
.wapv blockquote{margin:2px 0;padding:0 0 0 8px;border-left:4px solid #06cf9c;background:rgba(0,0,0,.04)}
.wapv ul,.wapv ol{margin:2px 0;padding-left:20px}
.wapv a{color:#027eb5}
.wapv .ts{text-align:right;font-size:11px;color:#667781;margin-top:1px}
.wapv .raw{width:100%;box-sizing:border-box;font:12px ui-monospace,Consolas,monospace;margin-top:6px}
.wapv .cnt{font-size:12px;opacity:.75}.wapv .cnt.warn{color:#b3261e;opacity:1;font-weight:600}
@media (prefers-color-scheme:dark){.wapv .chat{background:#0b141a}.wapv .bub{background:#005c4b;color:#e9edef}.wapv .ts{color:#8696a0}.wapv pre.mono,.wapv code{background:rgba(255,255,255,.1)}.wapv a{color:#53bdeb}}
`;

function Inl({ nodes }: { nodes: WaInline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text': return <Fragment key={i}>{n.v}</Fragment>;
          case 'bold': return <b key={i}><Inl nodes={n.c} /></b>;
          case 'italic': return <i key={i}><Inl nodes={n.c} /></i>;
          case 'strike': return <s key={i}><Inl nodes={n.c} /></s>;
          case 'code': return <code key={i}>{n.v}</code>;
          case 'link': return <a key={i} href={n.href} target="_blank" rel="noreferrer noopener">{n.v}</a>;
        }
      })}
    </>
  );
}

/** Chat-bubble preview of exactly the normalised text that Salin / Kirim ke chat use. */
export function WaBubble({ text }: { text: string }) {
  const blocks = useMemo(() => renderWaPreviewNodes(text), [text]);
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return (
    <div className="chat" aria-label="Pratinjau pesan WhatsApp">
      <div className="bub">
        {blocks.map((b, i) => {
          switch (b.t) {
            case 'line': return <div key={i} className="ln"><Inl nodes={b.c} /></div>;
            case 'blank': return <div key={i} className="bl" />;
            case 'pre': return <pre key={i} className="mono">{b.v}</pre>;
            case 'quote': return <blockquote key={i}>{b.lines.map((l, k) => <div key={k} className="ln"><Inl nodes={l} /></div>)}</blockquote>;
            case 'ul': return <ul key={i}>{b.items.map((l, k) => <li key={k}><Inl nodes={l} /></li>)}</ul>;
            case 'ol': return <ol key={i} start={b.items[0]?.n}>{b.items.map((l, k) => <li key={k}><Inl nodes={l.c} /></li>)}</ol>;
          }
        })}
        <div className="ts">{hm} ✓✓</div>
      </div>
    </div>
  );
}

export function WaPreview({ text }: { text: string }) {
  const norm = useMemo(() => normalizeForWa(text), [text]);
  const parts = useMemo(() => splitForWa(norm), [norm]);
  const [raw, setRaw] = useState(false);
  const [next, setNext] = useState(0);
  const [msg, setMsg] = useState('');
  useEffect(() => { setNext(0); }, [norm]);
  const over = norm.length > WA_MAX_CHARS;
  const multi = parts.length > 1;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); setMsg(ok); } catch (e) { setMsg(String((e as Error).message)); }
  };
  const insertPart = () => {
    const i = Math.min(next, parts.length - 1);
    void run(async () => {
      await send({ kind: 'pos:draft', text: parts[i] });
      setNext(i + 1 < parts.length ? i + 1 : 0);
    }, multi
      ? `Bagian ${i + 1}/${parts.length} dimasukkan ke kotak pesan (belum dikirim). ${i + 1 < parts.length ? 'Kirim dulu di WhatsApp, lalu klik lagi untuk bagian berikutnya.' : 'Selesai.'}`
      : 'Teks dimasukkan ke kotak pesan (belum dikirim)');
  };
  return (
    <div className="wapv">
      <style>{CSS}</style>
      <WaBubble text={norm} />
      <div className="bar">
        <span className={'cnt' + (over ? ' warn' : '')}>{norm.length} / {WA_MAX_CHARS} karakter{over ? ` - melebihi batas WhatsApp, akan dikirim ${parts.length} bagian` : ''}</span>
        <span className="sp" />
        <label><input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} /> Teks yang akan dikirim</label>
      </div>
      {raw && <textarea className="raw" readOnly rows={Math.min(14, norm.split('\n').length + 1)} value={norm} aria-label="Teks yang akan dikirim" />}
      <div className="bar">
        <button onClick={() => void run(async () => { if (!(await copyText(norm))) throw new Error('Gagal menyalin'); }, 'Disalin')}>Salin</button>
        <button className="pri" disabled={!norm} onClick={insertPart}>
          {multi ? `Sisipkan bagian ${Math.min(next, parts.length - 1) + 1}/${parts.length} ke chat` : 'Kirim ke chat'}
        </button>
        {multi && next > 0 && <button onClick={() => setNext(0)}>Ulangi dari bagian 1</button>}
      </div>
      {msg && <p className="note">{msg}</p>}
    </div>
  );
}
