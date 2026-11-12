import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULES } from '../../src/audit/rules/registry.js';
import { rules } from '../../src/cli/commands/rules.js';
import type { Context } from '../../src/cli/framework.js';

const SRC = join(process.cwd(), 'src');
const REGISTRY_FILE = join(SRC, 'audit', 'rules', 'registry.ts');
// Every emitted rule id has a prefix; `axe/` and `axe-review/` ids are templates over axe-core's own rules.
const ID = /['`"]((?:jourilo|conv|ux|a11y|perf|journey|design)\/[a-z0-9][a-z0-9-]*)['`"]/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

function idsInSrc(): Set<string> {
  const ids = new Set<string>();
  for (const f of sources(SRC)) {
    if (f === REGISTRY_FILE) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(ID)) ids.add(m[1] as string);
  }
  return ids;
}

function ctx(values: Context['values'], positionals: string[]): Context {
  return { values, positionals, json: Boolean(values.json), ws: undefined as never, log: () => undefined };
}

describe('rule registry', () => {
  it('every ruleId string in src is in the registry', () => {
    const known = new Set(RULES.map((r) => r.id));
    expect([...idsInSrc()].filter((id) => !known.has(id)).sort()).toEqual([]);
  });

  it('the registry has no rule that the code never emits', () => {
    const emitted = idsInSrc();
    // perf/<metric> is built from the metric name, so its ids are not literals; perf/inp is one.
    const computed = new Set(['perf/lcp', 'perf/cls', 'perf/fcp', 'perf/ttfb', 'perf/tbt']);
    expect(RULES.map((r) => r.id).filter((id) => !emitted.has(id) && !computed.has(id))).toEqual([]);
  });

  it('has unique ids and a standards list per rule', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RULES) expect(Array.isArray(r.standards)).toBe(true);
  });

  it('rules list --json prints native, perf, axe and axe-review rules with category, severity and kind', async () => {
    const out = await rules.run(ctx({ json: true }, ['list']));
    const list = out.data as { id: string; category: string; severity: string; kind: string }[];
    const byId = new Map(list.map((r) => [r.id, r]));
    expect(byId.get('jourilo/contrast-over-image')).toMatchObject({
      category: 'accessibility',
      kind: 'defect',
    });
    expect(byId.get('jourilo/redirect-chain')?.category).toBe('performance');
    expect(byId.get('perf/lcp')?.category).toBe('performance');
    expect(byId.get('conv/competing-ctas')?.kind).toBe('hypothesis');
    expect(byId.get('axe/color-contrast')).toMatchObject({
      category: 'accessibility',
      kind: 'defect',
      severity: 'varies',
    });
    expect(byId.get('axe-review/color-contrast')).toMatchObject({ kind: 'needs-review' });
    expect(byId.has('axe/target-size')).toBe(true);
    for (const r of list) {
      expect(r.category).toBeTruthy();
      expect(r.severity).toBeTruthy();
      expect(r.kind).toBeTruthy();
    }
    expect(() => JSON.parse(JSON.stringify(out.data))).not.toThrow();
  });

  it('rules list without --json prints a readable table; an unknown subcommand is a usage error', async () => {
    const out = await rules.run(ctx({}, ['list']));
    expect(out.text).toContain('jourilo/focus-visible');
    expect(out.text).toContain('axe/color-contrast');
    await expect(rules.run(ctx({}, ['nope']))).rejects.toMatchObject({ code: 'USAGE' });
  });
});
