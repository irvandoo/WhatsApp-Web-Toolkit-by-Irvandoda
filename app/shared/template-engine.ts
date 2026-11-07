/** Pure template engine: {vars} + spintax {a|b|c}. */
export const KNOWN_VARS = ['nama', 'telepon', 'tahap', 'tanggal', 'akun'] as const;
/** Extra variables only meaningful for group auto-replies ({pengirim} also works in personal chats = contact name). */
export const GROUP_VARS = ['pengirim', 'grup'] as const;
export type TplVars = Partial<Record<(typeof KNOWN_VARS)[number] | (typeof GROUP_VARS)[number], string>>;

const SHORTCUT_RE = /^[a-z0-9_-]{1,24}$/;
export function validateShortcut(s: string): boolean { return SHORTCUT_RE.test(s); }

/** Distinct known/unknown variable names used in body (excludes spintax groups). */
export function extractVars(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\{([a-z_][a-z0-9_]*)\}/gi)) out.add(m[1].toLowerCase());
  return [...out];
}

const clean = (v: string) => v.replace(/[{}|]/g, '');
const SPIN_RE = /\{([^{}|]*(?:\|[^{}|]*)+)\}/; // innermost group containing a pipe

export function expandSpintax(text: string, rng: () => number = Math.random): string {
  let s = text;
  for (let guard = 0; guard < 500; guard++) {
    const m = SPIN_RE.exec(s);
    if (!m) break;
    const opts = m[1].split('|');
    const pick = opts[Math.min(opts.length - 1, Math.floor(rng() * opts.length))];
    s = s.slice(0, m.index) + pick + s.slice(m.index + m[0].length);
  }
  return s;
}

export function render(body: string, vars: TplVars = {}, rng: () => number = Math.random): string {
  const withVars = body.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (whole, k: string) => {
    const v = (vars as Record<string, string | undefined>)[k.toLowerCase()];
    return v === undefined ? whole : clean(v);
  });
  return expandSpintax(withVars, rng);
}
