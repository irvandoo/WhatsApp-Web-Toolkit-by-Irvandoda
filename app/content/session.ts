/**
 * EXPERIMENTAL / best-effort session snapshot. Runs in the content script (shares page-origin storage).
 * WhatsApp keeps non-extractable CryptoKey objects in IndexedDB; those cannot be serialized, so capture
 * refuses ({ok:false, reason:'unsupported-values'}) and lists them instead of silently dropping.
 */
import { decode, encode, splitChunks, type CaptureResult, type IdbDump, type IdbStore, type SessionMsg, type Snapshot } from '../shared/session-codec';

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const send = async <T = unknown>(m: SessionMsg): Promise<T> => {
  const r = await chrome.runtime.sendMessage(m);
  if (r && typeof r === 'object' && 'error' in r) throw new Error(String((r as { error: unknown }).error));
  return r as T;
};

export async function captureSnapshot(): Promise<CaptureResult> {
  const bad: string[] = [];
  try {
    const ls: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; ls[k] = localStorage.getItem(k) ?? ''; }
    const idb: IdbDump[] = [];
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const d = await req(indexedDB.open(info.name));
      try {
        const dump: IdbDump = { name: d.name, version: d.version, stores: [] };
        for (const sn of Array.from(d.objectStoreNames)) {
          const tx = d.transaction(sn, 'readonly'), os = tx.objectStore(sn);
          const [keys, vals] = await Promise.all([req(os.getAllKeys()), req(os.getAll())]); // read raw first: tx dies on non-IDB awaits
          const st: IdbStore = {
            name: sn, keyPath: os.keyPath, autoIncrement: os.autoIncrement, entries: [],
            indexes: Array.from(os.indexNames).map((n) => { const ix = os.index(n); return { name: n, keyPath: ix.keyPath, unique: ix.unique, multiEntry: ix.multiEntry }; }),
          };
          for (let i = 0; i < keys.length; i++) {
            const p = `${d.name}/${sn}/${String(keys[i])}`;
            st.entries.push([await encode(keys[i], p, bad), await encode(vals[i], p, bad)]);
          }
          dump.stores.push(st);
        }
        idb.push(dump);
      } finally { d.close(); }
    }
    if (bad.length) return { ok: false, reason: 'unsupported-values', unsupported: bad, details: bad };
    return { ok: true, version: 1, takenAt: Date.now(), origin: location.origin, localStorage: ls, idb };
  } catch (e) {
    return { ok: false, reason: 'error', unsupported: bad, details: [e instanceof Error ? e.message : String(e)] };
  }
}

/** Capture and upload to the background in <=4MB chunks. Returns session id or the capture failure. */
export async function saveSession(accountId: string, label: string): Promise<{ ok: true; id: string; bytes: number } | Exclude<CaptureResult, { ok: true }>> {
  const snap = await captureSnapshot();
  if (!snap.ok) return snap;
  const id = `ses-${accountId}-${Date.now()}`;
  const parts = splitChunks(JSON.stringify(snap));
  await send({ kind: 'sess:begin', id, accountId, label });
  for (let i = 0; i < parts.length; i++) await send({ kind: 'sess:chunk', id, idx: i, data: parts[i] });
  await send({ kind: 'sess:end', id, count: parts.length });
  return { ok: true, id, bytes: parts.reduce((n, p) => n + p.length, 0) };
}

async function deleteDb(name: string) {
  await new Promise<void>((res, rej) => {
    const r = indexedDB.deleteDatabase(name);
    const t = setTimeout(res, 5000); // blocked by a live connection: proceed best-effort
    r.onsuccess = () => { clearTimeout(t); res(); };
    r.onerror = () => { clearTimeout(t); rej(r.error); };
  });
}

export async function applySnapshot(s: Snapshot): Promise<void> {
  if (!s || s.ok !== true || s.version !== 1) throw new Error('snapshot not ok');
  if (s.origin !== location.origin) throw new Error('origin mismatch');
  // decode everything first so a bad snapshot fails before we destroy anything
  const plan = s.idb.map((d) => ({ d, stores: d.stores.map((st) => ({ st, rows: st.entries.map(([k, v]) => [decode(k), decode(v)] as const) })) }));
  for (const info of await indexedDB.databases()) if (info.name) await deleteDb(info.name);
  localStorage.clear();
  for (const [k, v] of Object.entries(s.localStorage)) localStorage.setItem(k, v);
  for (const { d, stores } of plan) {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open(d.name, d.version);
      r.onupgradeneeded = () => {
        for (const { st } of stores) {
          const os = r.result.createObjectStore(st.name, { keyPath: st.keyPath, autoIncrement: st.autoIncrement });
          for (const ix of st.indexes) os.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry });
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    try {
      for (const { st, rows } of stores) {
        for (let i = 0; i < rows.length; i += 500) {
          const tx = db.transaction(st.name, 'readwrite'), os = tx.objectStore(st.name);
          for (const [k, v] of rows.slice(i, i + 500)) st.keyPath !== null ? os.put(v) : os.put(v, k as IDBValidKey);
          await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
        }
      }
    } finally { db.close(); }
  }
}

/** Download a stored session from the background and restore it. Destructive: requires confirm === true. */
export async function restoreSession(id: string, opts: { confirm: boolean }): Promise<void> {
  if (opts?.confirm !== true) throw new Error('confirm flag required');
  const { count } = await send<{ count: number }>({ kind: 'sess:get', id });
  let json = '';
  for (let i = 0; i < count; i++) json += (await send<{ data: string }>({ kind: 'sess:chunk-get', id, idx: i })).data;
  const snap = JSON.parse(json) as Snapshot;
  if (!snap.ok) throw new Error('snapshot not ok');
  await applySnapshot(snap);
  location.reload();
}

