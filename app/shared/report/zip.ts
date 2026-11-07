/** Minimal ZIP writer ("stored", no compression) with CRC32. Enough for OOXML containers. No ZIP64. */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE 802.3). `prev` allows incremental use: crc32(b, crc32(a)) === crc32(a+b). */
export function crc32(data: Uint8Array, prev = 0): number {
  let c = (prev ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; data: Uint8Array; date?: Date }

function dosDateTime(d: Date): { time: number; date: number } {
  const y = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function zipStored(entries: ZipEntry[], now: Date = new Date()): Uint8Array {
  if (entries.length > 0xffff) throw new Error('Terlalu banyak berkas dalam ZIP');
  const enc = new TextEncoder();
  const names = entries.map((e) => enc.encode(e.name));
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.name)) throw new Error(`Nama berkas ganda: ${e.name}`);
    seen.add(e.name);
  }
  let total = 22;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].data.length > 0xfffffffe) throw new Error('Berkas terlalu besar untuk ZIP');
    total += 30 + names[i].length + entries[i].data.length + 46 + names[i].length;
  }
  if (total > 0xfffffffe) throw new Error('ZIP terlalu besar');
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let p = 0;
  const offsets: number[] = [];
  const crcs: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const { time, date } = dosDateTime(e.date ?? now);
    const crc = crc32(e.data);
    crcs.push(crc);
    offsets.push(p);
    dv.setUint32(p, 0x04034b50, true);
    dv.setUint16(p + 4, 20, true);
    dv.setUint16(p + 6, 0x0800, true); // UTF-8 names
    dv.setUint16(p + 8, 0, true); // stored
    dv.setUint16(p + 10, time, true);
    dv.setUint16(p + 12, date, true);
    dv.setUint32(p + 14, crc, true);
    dv.setUint32(p + 18, e.data.length, true);
    dv.setUint32(p + 22, e.data.length, true);
    dv.setUint16(p + 26, names[i].length, true);
    dv.setUint16(p + 28, 0, true);
    out.set(names[i], p + 30);
    p += 30 + names[i].length;
    out.set(e.data, p);
    p += e.data.length;
  }
  const cdStart = p;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const { time, date } = dosDateTime(e.date ?? now);
    dv.setUint32(p, 0x02014b50, true);
    dv.setUint16(p + 4, 20, true);
    dv.setUint16(p + 6, 20, true);
    dv.setUint16(p + 8, 0x0800, true);
    dv.setUint16(p + 10, 0, true);
    dv.setUint16(p + 12, time, true);
    dv.setUint16(p + 14, date, true);
    dv.setUint32(p + 16, crcs[i], true);
    dv.setUint32(p + 20, e.data.length, true);
    dv.setUint32(p + 24, e.data.length, true);
    dv.setUint16(p + 28, names[i].length, true);
    // extra, comment, disk, internal attrs, external attrs stay 0
    dv.setUint32(p + 42, offsets[i], true);
    out.set(names[i], p + 46);
    p += 46 + names[i].length;
  }
  const cdSize = p - cdStart;
  dv.setUint32(p, 0x06054b50, true);
  dv.setUint16(p + 8, entries.length, true);
  dv.setUint16(p + 10, entries.length, true);
  dv.setUint32(p + 12, cdSize, true);
  dv.setUint32(p + 16, cdStart, true);
  return out;
}
