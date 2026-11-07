import { db } from '../shared/db';
import { CHUNK_CHARS, type SessionMsg } from '../shared/session-codec';

const cid = (id: string, i: number) => `${id}#${i}`;

async function handle(m: SessionMsg): Promise<unknown> {
  switch (m.kind) {
    case 'sess:begin':
      await db.sessions.put({ id: m.id, accountId: m.accountId, label: m.label, createdAt: Date.now(), bytes: 0, experimental: true });
      return { ok: true };
    case 'sess:chunk': await db.sessionBlobs.put({ id: cid(m.id, m.idx), payload: m.data }); return { ok: true };
    case 'sess:end': {
      const parts = await db.sessionBlobs.bulkGet(Array.from({ length: m.count }, (_, i) => cid(m.id, i)));
      if (parts.some((p) => !p)) throw new Error('missing chunk');
      const payload = parts.map((p) => p!.payload).join('');
      await db.transaction('rw', db.sessions, db.sessionBlobs, async () => {
        await db.sessionBlobs.put({ id: m.id, payload });
        await db.sessionBlobs.where('id').startsWith(`${m.id}#`).delete();
        await db.sessions.update(m.id, { bytes: new Blob([payload]).size });
      });
      return { ok: true };
    }
    case 'sess:get': {
      const b = await db.sessionBlobs.get(m.id);
      if (!b) throw new Error('session not found');
      return { count: Math.max(1, Math.ceil(b.payload.length / CHUNK_CHARS)) };
    }
    case 'sess:chunk-get': {
      const b = await db.sessionBlobs.get(m.id);
      if (!b) throw new Error('session not found');
      return { data: b.payload.slice(m.idx * CHUNK_CHARS, (m.idx + 1) * CHUNK_CHARS) };
    }
  }
}

export function installSessions(): void {
  chrome.runtime.onMessage.addListener((m: SessionMsg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || typeof m?.kind !== 'string' || !m.kind.startsWith('sess:')) return false;
    handle(m).then(sendResponse, (e) => sendResponse({ error: String(e) }));
    return true;
  });
}
