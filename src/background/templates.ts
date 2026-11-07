import { db } from '../shared/db';
import type { CrmMsg, Template } from '../shared/crm-types';
import { validateShortcut } from '../shared/template-engine';

export const isTplMsg = (m: { kind?: string }): boolean => typeof m?.kind === 'string' && m.kind.startsWith('tpl:');

export async function seedTemplates(): Promise<void> {
  if ((await db.templates.count()) > 0) return;
  const now = Date.now();
  const mk = (shortcut: string, title: string, category: string, body: string): Template =>
    ({ id: crypto.randomUUID(), shortcut, title, body, category, usageCount: 0, updatedAt: now });
  await db.templates.bulkAdd([
    mk('sapaan', 'Sapaan', 'Umum', '{Halo|Hai|Selamat datang} {nama}, terima kasih sudah menghubungi kami. Ada yang bisa kami bantu?'),
    mk('followup', 'Follow-up', 'Penjualan', '{Halo|Hai} {nama}, kami ingin menanyakan kembali tentang penawaran kemarin. Apakah sudah ada keputusan?'),
    mk('terimakasih', 'Terima kasih', 'Umum', 'Terima kasih {nama} atas {kepercayaannya|pesanannya}. {Kami tunggu order berikutnya|Sampai jumpa lagi}!'),
  ]);
}

export async function handleTemplates(m: CrmMsg): Promise<unknown> {
  switch (m.kind) {
    case 'tpl:list': {
      await seedTemplates();
      return (await db.templates.toArray()).sort((a, b) => a.shortcut.localeCompare(b.shortcut));
    }
    case 'tpl:upsert': {
      const t = m.template;
      if (!t || typeof t.id !== 'string' || !t.id) return { error: 'Data template tidak valid' };
      if (!validateShortcut(t.shortcut)) return { error: 'Shortcut harus a-z, 0-9, _ atau -, maksimal 24 karakter' };
      if (!String(t.title ?? '').trim() || !String(t.body ?? '').trim()) return { error: 'Judul dan isi wajib diisi' };
      const dup = await db.templates.where('shortcut').equals(t.shortcut).first();
      if (dup && dup.id !== t.id) return { error: `Shortcut "/${t.shortcut}" sudah dipakai` };
      const prev = await db.templates.get(t.id);
      const saved: Template = {
        id: t.id, shortcut: t.shortcut, title: t.title.trim(), body: t.body, category: (t.category ?? '').trim(),
        usageCount: prev?.usageCount ?? (Number.isFinite(t.usageCount) ? t.usageCount : 0), updatedAt: Date.now(),
      };
      await db.templates.put(saved);
      return { ok: true, template: saved };
    }
    case 'tpl:delete':
      await db.templates.delete(m.id);
      return { ok: true };
    case 'tpl:use': {
      const t = await db.templates.get(m.id);
      if (!t) return { error: 'Template tidak ditemukan' };
      await db.templates.update(m.id, { usageCount: t.usageCount + 1 });
      return { ok: true };
    }
    default:
      return { error: 'unknown' };
  }
}
