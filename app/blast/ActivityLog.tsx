import { useEffect, useMemo, useRef, useState } from 'react';
import { ACTIVITY_KEY, activityToText, currentActivity, eventsForCampaign, fmtClock, sanitizeActivity, type ActivityEvent, type ActivityLevel } from '../shared/outbox-activity';

/** Live feed of the activity stored by the WhatsApp tab (chrome.storage.local), updated as it changes. */
export function useActivity(): ActivityEvent[] {
  const [list, setList] = useState<ActivityEvent[]>([]);
  useEffect(() => {
    let live = true;
    chrome.storage.local.get(ACTIVITY_KEY).then((r) => { if (live) setList(sanitizeActivity(r[ACTIVITY_KEY])); }, () => {});
    const on = (ch: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && ch[ACTIVITY_KEY]) setList(sanitizeActivity(ch[ACTIVITY_KEY].newValue));
    };
    try { chrome.storage.onChanged.addListener(on); } catch { /* not in an extension page */ }
    return () => { live = false; try { chrome.storage.onChanged.removeListener(on); } catch { /* ignore */ } };
  }, []);
  return list;
}

const MARK: Record<ActivityLevel, string> = { info: '•', work: '…', ok: '✔', warn: '!', err: '✘' };
const LABEL: Record<ActivityLevel, string> = { info: 'info', work: 'sedang bekerja', ok: 'berhasil', warn: 'perhatian', err: 'gagal' };

/** "Sekarang: …" banner for one campaign (what the sender is doing right now). */
export function NowLine({ all, campaignId, running }: { all: ActivityEvent[]; campaignId: string; running: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const cur = useMemo(() => currentActivity(all, campaignId, now), [all, campaignId, now]);
  if (!running) return null;
  if (!cur) return <p className="mut" role="status">Belum ada aktivitas. Pengirim berjalan di tab WhatsApp Web yang terbuka; pastikan tabnya terbuka.</p>;
  const ago = Math.max(0, Math.round((now - cur.ts) / 1000));
  return (
    <p className={`now ${cur.level}`} role="status">
      <b>Sekarang:</b> {cur.text} <span className="mut">({ago < 2 ? 'baru saja' : `${ago} dtk lalu`})</span>
    </p>
  );
}

/** Scrolling timeline of what the sender did, newest first. */
export function ActivityLog({ all, campaignId, onClear }: { all: ActivityEvent[]; campaignId: string; onClear: () => void }) {
  const events = useMemo(() => eventsForCampaign(all, campaignId), [all, campaignId]);
  const [copied, setCopied] = useState(false);
  const top = useRef<HTMLOListElement>(null);
  useEffect(() => { if (top.current) top.current.scrollTop = 0; }, [events[0]?.id]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(activityToText([...events].reverse())); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="actlog">
      <div className="row" style={{ marginBottom: 4 }}>
        <b style={{ flex: 1 }}>Aktivitas langsung</b>
        <button onClick={copy} disabled={!events.length}>{copied ? 'Tersalin' : 'Salin log'}</button>
        <button onClick={onClear} disabled={!all.length}>Bersihkan</button>
      </div>
      {!events.length ? <p className="mut">Belum ada aktivitas untuk kampanye ini.</p> : (
        <ol className="actlist" ref={top} aria-live="polite" aria-label="Log aktivitas kampanye">
          {events.map((e) => (
            <li key={e.id} className={`lv-${e.level}`}>
              <time dateTime={new Date(e.ts).toISOString()}>{fmtClock(e.ts)}</time>
              <span className="mk" aria-label={LABEL[e.level]} title={LABEL[e.level]}>{MARK[e.level]}</span>
              <span className="tx">{e.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
