// Static inline SVG icons (no external assets). Only constant strings are parsed here.
const P: Record<string, string> = {
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18.5 2v4h-4M5.5 22v-4h4"/>',
  memory: '<rect x="4" y="7" width="16" height="10" rx="2"/><path d="M8 7V4M12 7V4M16 7V4M8 20v-3M12 20v-3M16 20v-3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  session: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  broom: '<path d="M14 3l7 7-5 1-3-3zM13 8l-8 9 2 3 3 1 9-8"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
};

/** Brand mark: chat bubble with a spark. */
const BRAND =
  '<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.7-1.2A9 9 0 1 0 12 3z" fill="currentColor" stroke="none"/>' +
  '<path d="M12.5 7.5l-3 4.5h2.5l-1 4 3.5-5H12z" fill="#0a8f45" stroke="none"/>';

export function icon(name: string, size = 18): SVGElement {
  const brand = name === 'brand';
  const body = brand ? BRAND : P[name] ?? '';
  const attrs = brand ? '' : ' fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false"${attrs}>${body}</svg>`,
    'image/svg+xml',
  );
  return document.importNode(doc.documentElement, true) as unknown as SVGElement;
}
