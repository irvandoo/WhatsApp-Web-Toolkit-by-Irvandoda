import type { ArRule } from './autoreply-types';
import { newRule } from './autoreply-types';
import { validateShortcut } from './template-engine';

export interface PresetTemplate { shortcut: string; title: string; category: string; body: string }
export type PresetRule = Omit<ArRule, 'id' | 'order' | 'enabled' | 'mode' | 'excludeOptOut' | 'groups' | 'stopAfterHumanReply'>;
export interface PresetPack {
  id: string; industry: string; title: string; description: string;
  templates: PresetTemplate[]; autoReplyRules: PresetRule[]; pipelineStages: string[]; tags: string[]; reminderIdeas: string[];
}
export interface ApplyOptions { templates: boolean; rules: boolean; pipeline: boolean; selectedTemplateShortcuts?: string[] }
export interface ExistingState {
  templates: { shortcut: string; body?: string }[];
  rules: { name: string; reply?: string; order?: number }[];
  stages: string[];
}
export interface ApplyPlan {
  templates: (PresetTemplate & { original: string; renamed: boolean })[];
  rules: { rule: PresetRule; originalName: string; renamed: boolean }[];
  stages: string[] | null;
  skipped: string[];
  conflicts: string[];
}

export function validatePack(p: PresetPack): string[] {
  const errs: string[] = [];
  if (!p.id || !p.title) errs.push('id/title kosong');
  const seen = new Set<string>();
  for (const t of p.templates) {
    if (!validateShortcut(t.shortcut)) errs.push(`shortcut tidak valid: ${t.shortcut}`);
    if (seen.has(t.shortcut)) errs.push(`shortcut ganda: ${t.shortcut}`);
    seen.add(t.shortcut);
    if (!t.title.trim() || !t.body.trim()) errs.push(`template kosong: ${t.shortcut}`);
  }
  const n = p.pipelineStages.length;
  if (n < 2 || n > 12) errs.push('tahap harus 2-12');
  const low = p.pipelineStages.map((s) => s.trim().toLowerCase());
  if (low.some((s) => !s) || new Set(low).size !== n) errs.push('tahap harus unik dan tidak kosong');
  return errs;
}

function uniqueShortcut(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const suf = `-${i}`;
    const c = base.slice(0, 24 - suf.length) + suf;
    if (!taken.has(c)) return c;
  }
  return base;
}

export function planApply(pack: PresetPack, existing: ExistingState, options: ApplyOptions): ApplyPlan {
  const plan: ApplyPlan = { templates: [], rules: [], stages: null, skipped: [], conflicts: [] };
  if (options.templates) {
    const taken = new Set(existing.templates.map((t) => t.shortcut));
    const sel = options.selectedTemplateShortcuts ? new Set(options.selectedTemplateShortcuts) : null;
    for (const t of pack.templates) {
      if (sel && !sel.has(t.shortcut)) continue;
      const same = existing.templates.some((e) => e.body === t.body && (e.shortcut === t.shortcut || e.shortcut.replace(/-\d+$/, '') === t.shortcut));
      if (same) { plan.skipped.push(`Template /${t.shortcut} sudah ada`); continue; }
      const sc = uniqueShortcut(t.shortcut, taken);
      taken.add(sc);
      const renamed = sc !== t.shortcut;
      if (renamed) plan.conflicts.push(`Shortcut /${t.shortcut} sudah dipakai, jadi /${sc}`);
      plan.templates.push({ ...t, shortcut: sc, original: t.shortcut, renamed });
    }
  }
  if (options.rules) {
    const names = new Set(existing.rules.map((r) => r.name));
    for (const r of pack.autoReplyRules) {
      if (existing.rules.some((e) => e.name === r.name && e.reply === r.reply) || existing.rules.some((e) => e.name === `${r.name} (preset)` && e.reply === r.reply)) {
        plan.skipped.push(`Aturan "${r.name}" sudah ada`); continue;
      }
      let name = r.name;
      if (names.has(name)) {
        name = `${r.name} (preset)`;
        if (names.has(name)) { plan.skipped.push(`Aturan "${r.name}" sudah ada`); continue; }
        plan.conflicts.push(`Nama aturan "${r.name}" sudah dipakai, jadi "${name}"`);
      }
      names.add(name);
      plan.rules.push({ rule: { ...r, name }, originalName: r.name, renamed: name !== r.name });
    }
  }
  if (options.pipeline) {
    const same = existing.stages.length === pack.pipelineStages.length && existing.stages.every((s, i) => s === pack.pipelineStages[i]);
    if (same) plan.skipped.push('Pipeline sudah sama');
    else {
      plan.stages = [...pack.pipelineStages];
      plan.conflicts.push('Pipeline akan diganti; kontak pada tahap yang tidak ada di daftar baru dipindahkan ke tahap pertama.');
    }
  }
  return plan;
}

/** Build full disabled draft ArRules from plan rules. */
export function buildRules(plan: ApplyPlan, startOrder: number): ArRule[] {
  return plan.rules.map((p, i) => ({
    ...newRule(startOrder + i), ...p.rule, id: crypto.randomUUID(), order: startOrder + i,
    enabled: false, mode: 'draft' as const, excludeOptOut: true as const, groups: false as const, stopAfterHumanReply: true as const,
  }));
}
