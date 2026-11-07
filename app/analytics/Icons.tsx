import type { ReactNode } from 'react';

/** Tiny inline stroke icons (24x24 viewBox, currentColor). Decorative: aria-hidden. */
const P: Record<string, ReactNode> = {
  logo: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-8" /><path d="M22 20H2" /></>,
  userPlus: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M19 8v6M16 11h6" /></>,
  repeat: <><path d="M17 3l3 3-3 3" /><path d="M4 11V9a3 3 0 0 1 3-3h13" /><path d="M7 21l-3-3 3-3" /><path d="M20 13v2a3 3 0 0 1-3 3H4" /></>,
  inbox: <><path d="M12 3v10" /><path d="M8 9l4 4 4-4" /><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>,
  send: <><path d="M21 3L10 14" /><path d="M21 3l-7 18-4-7-7-4z" /></>,
  chat: <><path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  alert: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>,
  trend: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  flame: <><path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .3 1.5 1 2 2 2-1-3 0-5 1-8z" /></>,
  bars: <><rect x="4" y="12" width="4" height="8" rx="1" /><rect x="10" y="4" width="4" height="16" rx="1" /><rect x="16" y="9" width="4" height="11" rx="1" /></>,
  pie: <><path d="M12 3v9h9" /><path d="M21 12a9 9 0 1 1-9-9" /></>,
  funnel: <><path d="M3 4h18l-7 8v6l-4 2v-8z" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  bulb: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" /></>,
  users: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3 20c.5-3.3 2.8-5 6-5s5.5 1.7 6 5" /><path d="M16 15c2.6-.2 4.5 1.2 5 4" /></>,
  compare: <><path d="M7 4v16M17 4v16" /><path d="M4 8l3-4 3 4M14 16l3 4 3-4" /></>,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  flat: <path d="M5 12h14" />,
};

export function Icon({ name }: { name: keyof typeof P | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{P[name] ?? P.bars}</svg>
  );
}

/** h2 with a small icon chip */
export function SectionTitle({ icon, children }: { icon: string; children: ReactNode }) {
  return <h2><span className="ic"><Icon name={icon} /></span>{children}</h2>;
}
