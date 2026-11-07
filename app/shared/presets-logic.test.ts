import { describe, expect, it } from 'vitest';
import { PRESET_PACKS } from './presets';
import { buildRules, planApply, validatePack } from './presets-logic';
import { extractVars, KNOWN_VARS } from './template-engine';

const opts = { templates: true, rules: true, pipeline: true };
const empty = { templates: [], rules: [], stages: [] as string[] };

describe('presets', () => {
  it('all packs valid', () => {
    expect(PRESET_PACKS.length).toBe(7);
    for (const p of PRESET_PACKS) {
      expect(validatePack(p), p.id).toEqual([]);
      expect(p.templates.length).toBeGreaterThanOrEqual(8);
      expect(p.templates.length).toBeLessThanOrEqual(14);
      for (const x of p.templates) for (const v of extractVars(x.body)) expect(KNOWN_VARS as readonly string[]).toContain(v);
    }
  });
  it('validatePack rejects bad data', () => {
    const p = { ...PRESET_PACKS[0], pipelineStages: ['A', 'a'], templates: [{ shortcut: 'Bad!', title: 'x', category: '', body: 'y' }] };
    expect(validatePack(p).length).toBe(2);
  });
  it('suffixes shortcut and rule collisions', () => {
    const p = PRESET_PACKS[0];
    const plan = planApply(p, { templates: [{ shortcut: 'sapaan', body: 'lain' }], rules: [{ name: p.autoReplyRules[0].name, reply: 'lain' }], stages: ['A', 'B'] }, opts);
    expect(plan.templates.find((t) => t.original === 'sapaan')!.shortcut).toBe('sapaan-2');
    expect(plan.rules[0].rule.name).toBe(`${p.autoReplyRules[0].name} (preset)`);
    expect(plan.stages).toEqual(p.pipelineStages);
  });
  it('is idempotent against its own result', () => {
    const p = PRESET_PACKS[1];
    const plan = planApply(p, empty, opts);
    const again = planApply(p, { templates: plan.templates, rules: plan.rules.map((r) => r.rule), stages: p.pipelineStages }, opts);
    expect(again.templates).toEqual([]);
    expect(again.rules).toEqual([]);
    expect(again.stages).toBeNull();
  });
  it('respects options and selection; rules built disabled draft', () => {
    const p = PRESET_PACKS[2];
    const plan = planApply(p, empty, { templates: true, rules: true, pipeline: false, selectedTemplateShortcuts: ['sapaan'] });
    expect(plan.templates.length).toBe(1);
    expect(plan.stages).toBeNull();
    for (const r of buildRules(plan, 3)) { expect(r.enabled).toBe(false); expect(r.mode).toBe('draft'); expect(r.order).toBeGreaterThanOrEqual(3); }
    expect(planApply(p, empty, { templates: false, rules: false, pipeline: false }).templates).toEqual([]);
  });
  it('clinic and finance carry disclaimers', () => {
    expect(PRESET_PACKS.find((p) => p.id === 'klinik')!.description).toMatch(/Bukan nasihat medis/);
    expect(PRESET_PACKS.find((p) => p.id === 'keuangan')!.description).toMatch(/Bukan nasihat keuangan/);
  });
});
