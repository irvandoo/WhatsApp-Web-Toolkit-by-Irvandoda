import { db } from '../shared/db';
import type { Template } from '../shared/crm-types';
import { DEFAULT_STAGES } from '../shared/crm-types';
import { PRESET_PACKS } from '../shared/presets';
import { buildRules, planApply, type ApplyOptions } from '../shared/presets-logic';
import { handleCrm } from './crm';

export type PresetMsg =
  | { kind: 'preset:list' }
  | { kind: 'preset:get'; id: string }
  | { kind: 'preset:apply'; id: string; options: ApplyOptions };

export const isPresetMsg = (m: unknown): m is PresetMsg =>
  typeof (m as { kind?: unknown })?.kind === 'string' && (m as { kind: string }).kind.startsWith('preset:');

const APPLIED_KEY = 'wwt-presets-applied';

async function existingState() {
  const [templates, rules, pl] = await Promise.all([db.templates.toArray(), db.arRules.toArray(), db.pipeline.get('default')]);
  return { templates, rules, stages: pl?.stages ?? [...DEFAULT_STAGES] };
}

export async function handlePresets(m: PresetMsg): Promise<unknown> {
  const applied = ((await chrome.storage.local.get(APPLIED_KEY))[APPLIED_KEY] ?? {}) as Record<string, number>;
  switch (m.kind) {
    case 'preset:list':
      return PRESET_PACKS.map((p) => ({
        id: p.id, industry: p.industry, title: p.title, description: p.description,
        counts: { templates: p.templates.length, rules: p.autoReplyRules.length, stages: p.pipelineStages.length, tags: p.tags.length, reminders: p.reminderIdeas.length },
        appliedAt: applied[p.id] ?? null,
      }));
    case 'preset:get': {
      const pack = PRESET_PACKS.find((p) => p.id === m.id);
      if (!pack) return { error: 'Preset tidak ditemukan' };
      const ex = await existingState();
      return { pack, appliedAt: applied[pack.id] ?? null, existing: ex };
    }
    case 'preset:apply': {
      const pack = PRESET_PACKS.find((p) => p.id === m.id);
      if (!pack) return { error: 'Preset tidak ditemukan' };
      const o = m.options ?? ({} as Partial<ApplyOptions>);
      const options: ApplyOptions = {
        templates: !!o.templates, rules: !!o.rules, pipeline: !!o.pipeline,
        selectedTemplateShortcuts: Array.isArray(o.selectedTemplateShortcuts) ? o.selectedTemplateShortcuts : undefined,
      };
      const ex = await existingState();
      const plan = planApply(pack, ex, options);
      const now = Date.now();
      const tpls: Template[] = plan.templates.map((t) => ({
        id: crypto.randomUUID(), shortcut: t.shortcut, title: t.title, body: t.body, category: t.category, usageCount: 0, updatedAt: now,
      }));
      const startOrder = ex.rules.reduce((mx, r) => Math.max(mx, r.order ?? 0), -1) + 1;
      const rules = buildRules(plan, startOrder);
      await db.transaction('rw', db.templates, db.arRules, async () => {
        if (tpls.length) await db.templates.bulkAdd(tpls);
        if (rules.length) await db.arRules.bulkAdd(rules);
      });
      let stagesApplied = false;
      const skipped = [...plan.skipped];
      if (plan.stages) {
        const res = (await handleCrm({ kind: 'crm:pipeline:set', stages: plan.stages })) as { ok?: boolean; error?: string };
        stagesApplied = !!res?.ok;
        if (!stagesApplied) skipped.push(`Pipeline gagal: ${res?.error ?? 'tidak valid'}`);
      }
      if (tpls.length || rules.length || stagesApplied) {
        applied[pack.id] = now;
        await chrome.storage.local.set({ [APPLIED_KEY]: applied });
      }
      return { ok: true, templatesAdded: tpls.length, rulesAdded: rules.length, skipped, stagesApplied, conflicts: plan.conflicts };
    }
    default:
      return { error: 'unknown' };
  }
}
