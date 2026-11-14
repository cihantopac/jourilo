// Markdown summary (for PRs, issues and agents) and SARIF 2.1.0 (for GitHub code scanning).
import { pagesOf, severityRank } from '../audit/finding.js';
import { MANUAL_REVIEW } from '../audit/standards.js';
import type { Finding, Run } from '../core/types.js';
import { VERSION } from '../core/version.js';
import type { RunComparison } from './compare.js';

function path(u: string): string {
  try {
    const x = new URL(u);
    return `${x.pathname}${x.search}`;
  } catch {
    return u;
  }
}

const md = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The page of a finding, or every page of one collapsed over several pages (F44), the first 8 by name. */
function pageCell(f: Finding): string {
  const pages = pagesOf(f);
  const shown = pages.slice(0, 8).map((u) => `\`${md(path(u))}\``);
  return `${shown.join(', ')}${pages.length > 8 ? ` +${pages.length - 8} more` : ''}`;
}

export function renderMarkdown(run: Run, cmp?: RunComparison, limit = 25): string {
  const s = run.summary;
  const lines = [
    `# Jourilo report — ${run.target}`,
    '',
    `Run \`${run.id}\` · ${run.mode} mode · ${run.browser.name} ${run.browser.version} · viewports: ${run.viewports.map((v) => v.name).join(', ')} · ${s.urls === undefined ? `${s.pages} page capture(s)` : `${s.urls} page${s.urls === 1 ? '' : 's'}, ${s.pages} capture${s.pages === 1 ? '' : 's'}`}, ${s.journeys} journey(s)`,
    '',
    `**${s.byKind.defect} defects** (critical ${s.findings.critical}, serious ${s.findings.serious}, moderate ${s.findings.moderate}, minor ${s.findings.minor}) · **${s.byKind.hypothesis} conversion hypotheses** · **${s.byKind['needs-review']} need manual review**`,
    '',
  ];
  if (cmp) {
    lines.push(
      `## Before / after (baseline \`${cmp.base.id}\`)`,
      '',
      `Fixed: **${cmp.fixed.length}** · New: **${cmp.introduced.length}** · Still present: **${cmp.persisting.length}** · ${cmp.regressionFree ? 'No new serious/critical defects.' : '⚠️ New serious or critical defects.'}`,
      '',
    );
    for (const f of cmp.introduced.slice(0, 10))
      lines.push(`- 🆕 ${f.severity}: ${md(f.title)} — \`${path(f.url)}\``);
    for (const f of cmp.fixed.slice(0, 10)) lines.push(`- ✅ fixed: ${md(f.title)} — \`${path(f.url)}\``);
    for (const f of cmp.dismissed.slice(0, 10))
      lines.push(`- 🚫 dismissed (not fixed): ${md(f.title)} — \`${path(f.url)}\``);
    lines.push('');
    if (cmp.metrics.length) {
      lines.push(
        '| Page | Viewport | Metric | Before | After | Verdict |',
        '| ---- | -------- | ------ | ------ | ----- | ------- |',
        ...cmp.metrics.map(
          (m) =>
            `| \`${path(m.url)}\` | ${m.viewport} | ${m.name} | ${m.before} | ${m.after} | ${m.verdict} |`,
        ),
        '',
        'Lab metrics. Improved/regressed requires repeated visits whose ranges do not overlap (`--runs 5`).',
        '',
      );
    }
  }
  // Only captures that waited for an element or never reached network idle: the rest loaded the ordinary way.
  const loads = run.pages.filter((p) => p.load && (p.load.waitedFor || !p.load.networkIdle));
  if (loads.length) {
    lines.push('## Captured after', '');
    for (const p of loads)
      lines.push(
        `- \`${md(path(p.url))}\` (${p.viewport}): load, network idle (${p.load!.networkIdle ? 'yes' : 'no'})${p.load!.waitedFor ? `, \`${md(p.load!.waitedFor)}\` (${p.load!.found ? 'found' : 'not found'})` : ''}`,
      );
    lines.push('');
  }
  const sorted = [...run.findings].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity) || b.occurrences - a.occurrences,
  );
  const section = (title: string, list: Finding[]) => {
    if (!list.length) return;
    lines.push(
      `## ${title}`,
      '',
      '| Severity | Finding | Page | Viewport | Basis | Id |',
      '|---|---|---|---|---|---|',
    );
    for (const f of list.slice(0, limit))
      lines.push(
        `| ${f.severity} | ${md(f.title)}${f.occurrences > 1 ? ` (×${f.occurrences})` : ''} | ${pageCell(f)} | ${f.viewport ?? ''} | ${f.provenance}/${f.confidence} | \`${f.fingerprint}\` |`,
      );
    if (list.length > limit) lines.push(`| | … ${list.length - limit} more in run.json | | | | |`);
    lines.push('');
  };
  section(
    'Defects',
    sorted.filter((f) => f.kind === 'defect'),
  );
  section(
    'Conversion hypotheses (untested)',
    sorted.filter((f) => f.kind === 'hypothesis'),
  );
  section(
    'Needs manual review',
    sorted.filter((f) => f.kind === 'needs-review'),
  );
  if (run.dismissed?.length) {
    lines.push(
      '## Dismissed as not a problem',
      '',
      'Kept out of the counts above and out of later runs; `jourilo finding undismiss <id>` brings one back.',
      '',
    );
    for (const f of run.dismissed.slice(0, limit))
      lines.push(
        `- ${md(f.title)} — \`${path(f.url)}\` (\`${f.fingerprint}\`): ${md(f.dismissal.reason)} (${f.dismissal.by}, ${f.dismissal.at.slice(0, 10)})`,
      );
    lines.push('');
  }
  if (run.journeys.length) {
    lines.push('## Journeys', '');
    for (const j of run.journeys)
      lines.push(
        `- ${j.status === 'passed' ? '✅' : j.status === 'blocked' ? '⛔' : '❌'} ${md(j.name)} (${j.viewport})`,
      );
    lines.push('');
  }
  lines.push('## Limitations', '', ...run.limitations.map((l) => `- ${md(l)}`), '');
  if (run.network?.blocked.length || run.network?.escaped.length)
    lines.push(
      '## Network safety',
      '',
      ...(run.network.escaped.map((e) => `- ⚠️ security event: \`${md(e.url)}\` — ${md(e.reason)}`) ?? []),
      ...run.network.blocked.map((b) => `- refused \`${md(b.host)}:${b.port}\` — ${md(b.reason)}`),
      '',
    );
  lines.push(
    '## Still needs a person',
    '',
    'Automated checks cannot judge these WCAG 2.2 criteria; no run shows conformance.',
    '',
    ...MANUAL_REVIEW.map((m) => `- ${md(m)}`),
    '',
  );
  return lines.join('\n');
}

export function renderSarif(run: Run): unknown {
  const rules = new Map<string, Finding>();
  for (const f of run.findings) if (!rules.has(f.ruleId)) rules.set(f.ruleId, f);
  const level = (f: Finding) =>
    f.kind !== 'defect'
      ? 'note'
      : f.severity === 'critical' || f.severity === 'serious'
        ? 'error'
        : f.severity === 'moderate'
          ? 'warning'
          : 'note';
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Jourilo',
            version: VERSION,
            informationUri: 'https://github.com/cihantopac/jourilo',
            rules: [...rules.values()].map((f) => ({
              id: f.ruleId,
              name: f.ruleId.replace(/[^A-Za-z0-9]/g, '_'),
              shortDescription: { text: f.title },
              help: { text: f.recommendation },
              ...(f.standards[0]?.url ? { helpUri: f.standards[0].url } : {}),
              properties: { category: f.category, kind: f.kind },
            })),
          },
        },
        results: run.findings.map((f) => {
          const src = f.sources?.[0];
          return {
            ruleId: f.ruleId,
            level: level(f),
            message: {
              text: `${f.title}: ${f.description} (${f.url}${f.viewport ? `, ${f.viewport}` : ''})`,
            },
            partialFingerprints: { jourilo: f.fingerprint },
            locations: [
              src
                ? {
                    physicalLocation: {
                      artifactLocation: { uri: src.file },
                      region: { startLine: Math.max(1, src.line) },
                    },
                  }
                : { physicalLocation: { artifactLocation: { uri: f.url } } },
            ],
          };
        }),
      },
    ],
  };
}
