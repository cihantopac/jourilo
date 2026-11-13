import axe from 'axe-core';
import { RULES, type RuleInfo } from '../../audit/rules/registry.js';
import { wcagFromAxeTags } from '../../audit/standards.js';
import { AXE_TAGS } from '../../browser/capture.js';
import { JouriloError } from '../../core/errors.js';
import { VERSION } from '../../core/version.js';
import type { Command } from '../framework.js';

/** Native rules, then the `axe/<id>` and `axe-review/<id>` rules a run enables (axe-core answers without a DOM). */
export function allRules(): RuleInfo[] {
  const out = [...RULES];
  for (const r of axe.getRules(AXE_TAGS)) {
    const standards = wcagFromAxeTags(r.tags).map((s) => `${s.standard} ${s.id}`);
    out.push({
      id: `axe/${r.ruleId}`,
      category: 'accessibility',
      severity: 'varies',
      kind: 'defect',
      title: r.help,
      standards,
    });
    // Manual-review items are kept only for rules that relate to a WCAG criterion.
    if (standards.length)
      out.push({
        id: `axe-review/${r.ruleId}`,
        category: 'accessibility',
        severity: 'minor',
        kind: 'needs-review',
        title: `Needs manual review: ${r.help}`,
        standards,
      });
  }
  return out;
}

export const rules: Command = {
  name: 'rules',
  summary:
    'List every rule Jourilo can report, with category, severity and kind (machine-readable with --json).',
  usage: 'jourilo rules list [--json]',
  details: `Subcommand:
  list   Native rules (jourilo/…, perf/…, conv/…, ux/…, a11y/…, journey/…, design/…) and the axe/<id> and
         axe-review/<id> rules a run enables from axe-core ${axe.version}. Severity is "varies" when it depends on
         what was measured; kind is "varies" for a rule that reports a defect or, when unsure, a needs-review
         item. With --json: {"jourilo": <version>, "axe": <axe-core version>, "rules": [{id, category,
         severity, kind, title, standards}, …]}.`,
  async run(ctx) {
    if (ctx.positionals[0] !== 'list')
      throw new JouriloError('USAGE', 'Unknown or missing subcommand.', 'Usage: jourilo rules list [--json]');
    const list = allRules();
    const w = (k: 'id' | 'category' | 'severity' | 'kind') => Math.max(...list.map((r) => r[k].length));
    const [wi, wc, ws, wk] = [w('id'), w('category'), w('severity'), w('kind')];
    const text = list
      .map(
        (r) =>
          `${r.id.padEnd(wi)}  ${r.category.padEnd(wc)}  ${r.severity.padEnd(ws)}  ${r.kind.padEnd(wk)}  ${r.title}`,
      )
      .join('\n');
    return {
      data: { jourilo: VERSION, axe: axe.version, rules: list },
      text: `${list.length} rules (Jourilo ${VERSION}, axe-core ${axe.version})\n\n${text}`,
    };
  },
};
