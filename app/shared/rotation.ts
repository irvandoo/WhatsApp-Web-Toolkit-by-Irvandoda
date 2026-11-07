/** Message rotation: pick one variant per send, avoiding immediate repeats. Pure; callers persist the returned state. */
import { render, type TplVars } from './template-engine';

export type RotStrategy = 'random' | 'round-robin' | 'shuffle-bag';
export const ROT_STRATEGIES: RotStrategy[] = ['random', 'round-robin', 'shuffle-bag'];
export const ROT_LABEL: Record<RotStrategy, string> = {
  random: 'Acak (tanpa pengulangan langsung)', 'round-robin': 'Berurutan (bergiliran)', 'shuffle-bag': 'Kantong acak (semua terpakai dulu)',
};
export const ROT_KEY = 'wwt-rot';
export const MAX_VARIANTS = 10;
export const MAX_VARIANT_LEN = 4000;

/** Per-key state (key = template id / rule id). `last` = index of the previous pick (-1 none), `bag` = remaining indexes (shuffle-bag). */
export interface RotState { last: number; bag: number[] }
export type RotStore = Record<string, RotState>;
export const emptyRotState = (): RotState => ({ last: -1, bag: [] });

export function sanitizeRotState(raw: unknown): RotState {
  const r = raw && typeof raw === 'object' ? (raw as Partial<RotState>) : {};
  const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1000;
  return { last: int(r.last) ? (r.last as number) : -1, bag: Array.isArray(r.bag) ? (r.bag.filter(int) as number[]) : [] };
}
export function sanitizeRotStore(raw: unknown): RotStore {
  const out: RotStore = {};
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw as object)) out[k] = sanitizeRotState(v);
  return out;
}
export const normStrategy = (s: unknown): RotStrategy => (ROT_STRATEGIES.includes(s as RotStrategy) ? (s as RotStrategy) : 'random');

export interface RotPick { index: number; text: string; state: RotState }

/** Empty/blank variants are ignored. Returns index into the ORIGINAL array (-1 when nothing usable). */
export function pickVariant(variants: string[], strategy: RotStrategy, state: RotState | undefined, rng: () => number = Math.random): RotPick {
  const st = sanitizeRotState(state);
  const cand: number[] = [];
  variants.forEach((v, i) => { if (typeof v === 'string' && v.trim()) cand.push(i); });
  if (!cand.length) return { index: -1, text: '', state: emptyRotState() };
  const rnd = (n: number) => Math.min(n - 1, Math.floor(rng() * n));
  const done = (index: number, bag: number[]): RotPick => ({ index, text: variants[index], state: { last: index, bag } });
  if (cand.length === 1) return done(cand[0], []);

  if (strategy === 'round-robin') {
    const next = cand.find((i) => i > st.last) ?? cand[0];
    return done(next, []);
  }
  if (strategy === 'shuffle-bag') {
    let bag = st.bag.filter((i) => cand.includes(i));
    if (!bag.length) {
      bag = [...cand];
      for (let i = bag.length - 1; i > 0; i--) { const j = rnd(i + 1); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      // never start a new bag with the item just sent (the bag is consumed from the end)
      if (bag[bag.length - 1] === st.last) { const k = rnd(bag.length - 1); [bag[bag.length - 1], bag[k]] = [bag[k], bag[bag.length - 1]]; }
    }
    return done(bag[bag.length - 1], bag.slice(0, -1));
  }
  const pool = cand.filter((i) => i !== st.last);
  return done(pool[rnd(pool.length)], []);
}

export interface RotatingTemplate { body: string; variants?: string[]; rotation?: RotStrategy }

/** Pool = [body, ...variants]. Order: pick variant -> render vars -> expand spintax (render() does the latter two). */
export function renderWithRotation(
  template: RotatingTemplate, vars: TplVars, state: RotState | undefined, rng: () => number = Math.random,
): { text: string; state: RotState; index: number } {
  const extra = (template.variants ?? []).filter((v) => typeof v === 'string' && v.trim());
  if (!extra.length) return { text: render(template.body, vars, rng), state: sanitizeRotState(state), index: 0 };
  const pool = [template.body, ...extra];
  const p = pickVariant(pool, normStrategy(template.rotation), state, rng);
  return { text: render(p.text, vars, rng), state: p.state, index: p.index };
}

/** Validation shared by template/rule save: returns an error string or null. */
export function validateVariants(variants: unknown): string | null {
  if (variants === undefined) return null;
  if (!Array.isArray(variants)) return 'Varian pesan tidak valid';
  if (variants.length > MAX_VARIANTS) return `Varian pesan maksimal ${MAX_VARIANTS}`;
  if (variants.some((v) => typeof v !== 'string' || v.length > MAX_VARIANT_LEN)) return `Setiap varian maksimal ${MAX_VARIANT_LEN} karakter`;
  return null;
}
export const cleanVariants = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);
