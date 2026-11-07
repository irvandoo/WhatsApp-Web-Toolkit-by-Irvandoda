/** EXPERIMENTAL session snapshot codec: IndexedDB/structured-clone values <-> JSON-safe tagged forms. Pure (no chrome APIs). */
export const CHUNK_CHARS = 1_300_000; // keeps each chunk well under 4MB even with multi-byte chars

/** Session blob transport messages (own contract, NOT part of RuntimeMsg). Handled in background/sessions.ts. */
export type SessionMsg =
  | { kind: 'sess:begin'; id: string; accountId: string; label: string }
  | { kind: 'sess:chunk'; id: string; idx: number; data: string }
  | { kind: 'sess:end'; id: string; count: number }
  | { kind: 'sess:get'; id: string }
  | { kind: 'sess:chunk-get'; id: string; idx: number };

export interface IdbIndex { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }
export interface IdbStore { name: string; keyPath: string | string[] | null; autoIncrement: boolean; indexes: IdbIndex[]; entries: [unknown, unknown][] }
export interface IdbDump { name: string; version: number; stores: IdbStore[] }
export interface Snapshot { ok: true; version: 1; takenAt: number; origin: string; localStorage: Record<string, string>; idb: IdbDump[] }
export interface CaptureFail { ok: false; reason: 'unsupported-values' | 'error'; details: string[]; unsupported: string[] }
export type CaptureResult = Snapshot | CaptureFail;

const TAG = '$t';

export function bytesToB64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToBytes(b: string): Uint8Array {
  const s = atob(b), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
const tag = (v: unknown) => Object.prototype.toString.call(v).slice(8, -1);

/** Encode to JSON-safe form. Non-encodable values (CryptoKey, functions, symbols, cycles...) are recorded in `bad` with `path`. */
export async function encode(v: unknown, path: string, bad: string[], seen: WeakSet<object> = new WeakSet()): Promise<unknown> {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : { [TAG]: 'num', v: String(v) };
  if (v === undefined) return { [TAG]: 'undef' };
  if (typeof v === 'bigint') return { [TAG]: 'big', v: v.toString() };
  if (typeof v !== 'object') { bad.push(`${path} (${typeof v})`); return null; }
  const t = tag(v);
  if (t === 'CryptoKey' || t === 'CryptoKeyPair' || t.startsWith('FileSystem')) { bad.push(`${path} (${t})`); return null; }
  if (v instanceof Date) return { [TAG]: 'date', v: v.getTime() };
  if (v instanceof ArrayBuffer) return { [TAG]: 'ab', b: bytesToB64(new Uint8Array(v)) };
  if (ArrayBuffer.isView(v)) {
    const u8 = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return { [TAG]: v instanceof DataView ? 'dv' : 'ta', n: v.constructor.name, b: bytesToB64(u8) };
  }
  if (typeof Blob !== 'undefined' && v instanceof Blob) {
    const base = { [TAG]: 'blob', mime: v.type, b: bytesToB64(new Uint8Array(await v.arrayBuffer())) };
    return typeof File !== 'undefined' && v instanceof File ? { ...base, file: { name: v.name, lastModified: v.lastModified } } : base;
  }
  if (seen.has(v)) { bad.push(`${path} (cycle)`); return null; }
  seen.add(v);
  try {
    if (v instanceof Map) {
      const out: unknown[] = [];
      let i = 0;
      for (const [k, val] of v) out.push([await encode(k, `${path}<k${i}>`, bad, seen), await encode(val, `${path}<${i++}>`, bad, seen)]);
      return { [TAG]: 'map', v: out };
    }
    if (v instanceof Set) {
      const out: unknown[] = [];
      let i = 0;
      for (const x of v) out.push(await encode(x, `${path}<${i++}>`, bad, seen));
      return { [TAG]: 'set', v: out };
    }
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      for (let i = 0; i < v.length; i++) out.push(await encode(v[i], `${path}[${i}]`, bad, seen));
      return out;
    }
    if (t !== 'Object') { bad.push(`${path} (${t})`); return null; }
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v)) o[k] = await encode((v as Record<string, unknown>)[k], `${path}.${k}`, bad, seen);
    return TAG in o ? { [TAG]: 'obj', v: o } : o;
  } finally { seen.delete(v); }
}

const TA: Record<string, new (b: ArrayBuffer) => ArrayBufferView> = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array,
  BigInt64Array, BigUint64Array,
};
const toAB = (b: string): ArrayBuffer => { const u = b64ToBytes(b); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; };

export function decode(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(decode);
  const o = v as Record<string, unknown>;
  switch (o[TAG]) {
    case undefined: break;
    case 'undef': return undefined;
    case 'num': return Number(o.v);
    case 'big': return BigInt(o.v as string);
    case 'date': return new Date(o.v as number);
    case 'ab': return toAB(o.b as string);
    case 'dv': return new DataView(toAB(o.b as string));
    case 'ta': { const C = TA[o.n as string]; if (!C) throw new Error(`unknown typed array ${String(o.n)}`); return new C(toAB(o.b as string)); }
    case 'blob': {
      const parts = [toAB(o.b as string)], f = o.file as { name: string; lastModified: number } | undefined;
      return f && typeof File !== 'undefined' ? new File(parts, f.name, { type: o.mime as string, lastModified: f.lastModified }) : new Blob(parts, { type: o.mime as string });
    }
    case 'map': return new Map((o.v as [unknown, unknown][]).map(([k, x]) => [decode(k), decode(x)]));
    case 'set': return new Set((o.v as unknown[]).map(decode));
    case 'obj': return decodeObj(o.v as Record<string, unknown>);
    default: throw new Error(`unknown tag ${String(o[TAG])}`);
  }
  return decodeObj(o);
}
function decodeObj(o: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const k of Object.keys(o)) r[k] = decode(o[k]);
  return r;
}

export const splitChunks = (s: string, size = CHUNK_CHARS): string[] => {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out.length ? out : [''];
};
