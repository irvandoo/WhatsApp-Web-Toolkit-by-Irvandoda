import { BRIDGE_CHANNEL, type BridgeEnvelope, type BridgeRequest, type BridgeResponse } from '../shared/messages';

type Distribute<T> = T extends { id: string } ? Omit<T, 'id'> : never;
let seq = 0;

export function call<T>(r: Distribute<BridgeRequest>, timeoutMs = 60_000): Promise<T> {
  const id = `${Date.now()}-${++seq}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { window.removeEventListener('message', on); reject(new Error('timeout')); }, timeoutMs);
    function on(e: MessageEvent) {
      const d = e.data as BridgeEnvelope<BridgeResponse> | undefined;
      if (e.source !== window || !d || d.channel !== BRIDGE_CHANNEL || d.dir !== 'res' || d.payload.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener('message', on);
      if (d.payload.ok) resolve(d.payload.data as T);
      else reject(new Error(d.payload.error ?? 'failed'));
    }
    window.addEventListener('message', on);
    const env: BridgeEnvelope<BridgeRequest> = { channel: BRIDGE_CHANNEL, dir: 'req', payload: { ...r, id } as BridgeRequest };
    window.postMessage(env, window.location.origin);
  });
}
