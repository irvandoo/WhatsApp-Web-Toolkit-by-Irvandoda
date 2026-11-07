import { useEffect, useState } from 'react';
import './runstatus.css';
import { IS_FULL } from '../shared/credit';
import {
  HEALTH_PREFIX, HONESTY_BG, RUN_KEY, computeIndicator, defaultRunState, isPaused, loadRun, pauseRun, resumeRun, setEnabled,
  type HealthMap, type RunState,
} from '../shared/runmode';
import { readAllHealth } from '../content/engine-health';

const COLOR = { ok: '#58c487', working: '#5b9bd5', attention: '#f2b84b', paused: '#9aa5a0', off: '#9aa5a0' } as const;
const CHIP = { jalan: 'Jalan', siaga: 'Siaga', mati: 'Mati', error: 'Perlu dicek' } as const;

/** Run-status card at the top of the popup: same indicator as the in-page Status item. */
export function RunStatus({ onQuickStart }: { onQuickStart: () => void }) {
  const [run, setRun] = useState<RunState>(defaultRunState(IS_FULL));
  const [health, setHealth] = useState<HealthMap>({});
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [r, h] = await Promise.all([loadRun(IS_FULL), readAllHealth()]);
      if (alive) { setRun(r); setHealth(h); setNow(Date.now()); }
    };
    void load();
    const t = setInterval(() => void load(), 4000);
    const onCh = (ch: Record<string, chrome.storage.StorageChange>) => { if (RUN_KEY in ch || Object.keys(ch).some((k) => k.startsWith(HEALTH_PREFIX))) void load(); };
    try { chrome.storage.onChanged.addListener(onCh); } catch { /* ignore */ }
    return () => { alive = false; clearInterval(t); try { chrome.storage.onChanged.removeListener(onCh); } catch { /* ignore */ } };
  }, []);

  const ind = computeIndicator(run, health, now, IS_FULL);
  const paused = isPaused(run, now);
  const act = (p: Promise<unknown>) => { void p.then(() => loadRun(IS_FULL).then(setRun)); };
  return (
    <section className={`rs ${ind.level}`} aria-label="Status otomatis">
      <div className="rs-top">
        <span className={`rs-dot ${ind.level}`} style={{ background: COLOR[ind.level] }} aria-hidden="true" />
        <div className="rs-tx"><b>{ind.title}</b><small>{ind.detail}</small></div>
        <button className="rs-lnk" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Tutup' : 'Rincian'}</button>
      </div>
      {IS_FULL && (
        <div className="rs-act">
          {paused
            ? <button className="rs-btn pri" onClick={() => act(resumeRun())}>Lanjutkan</button>
            : run.enabled
              ? <button className="rs-btn" onClick={() => setMenu(!menu)}>Jeda semua</button>
              : <button className="rs-btn pri" onClick={() => act(setEnabled(true))}>Nyalakan Mode Otomatis</button>}
          <button className="rs-btn ghost" onClick={onQuickStart}>Panduan cepat</button>
        </div>
      )}
      {!IS_FULL && <div className="rs-act"><button className="rs-btn ghost" onClick={onQuickStart}>Panduan cepat</button></div>}
      {menu && IS_FULL && !paused && (
        <div className="rs-menu">
          {([['15 menit', 15], ['1 jam', 60], ['Sampai besok', 'tomorrow'], ['Sampai saya lanjutkan', 'manual']] as const).map(([l, k]) => (
            <button key={l} className="rs-btn" onClick={() => { setMenu(false); act(pauseRun(k)); }}>{l}</button>
          ))}
        </div>
      )}
      {open && (
        <ul className="rs-list">
          {ind.items.map((i) => (
            <li key={i.id}><span><b>{i.label}</b><small>{i.detail}</small></span><em className={`rs-chip ${i.status}`}>{CHIP[i.status]}</em></li>
          ))}
          <li className="rs-note">{HONESTY_BG}</li>
        </ul>
      )}
    </section>
  );
}
