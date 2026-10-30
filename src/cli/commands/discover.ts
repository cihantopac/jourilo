import { existsSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runAudit } from '../../audit/engine.js';
import { parseViewports } from '../../browser/viewports.js';
import { discoverRepository, type ProductProfile } from '../../discovery/repo.js';
import { buildSiteProfile, type SiteProfile } from '../../discovery/site.js';
import { type Command, flag, num, requirePositional } from '../framework.js';

function repoText(p: ProductProfile): string {
  const v = (xs: { value: string }[]) => (xs.length ? xs.map((x) => x.value).join(', ') : '—');
  const lines = [
    `${p.name} (repository: ${p.root})`,
    p.readmeSummary ? `  About:      ${p.readmeSummary.value.slice(0, 160)} [${p.readmeSummary.source}]` : '',
    p.monorepo ? `  Monorepo:   ${p.monorepo.value}` : '',
  ];
  for (const a of p.apps) {
    lines.push(
      `  App ${a.root}: ${v(a.frameworks)}`,
      `    ${a.routes.filter((r) => r.kind === 'page').length} page routes, ${a.routes.filter((r) => r.kind === 'api').length} API routes, ${a.components.count} components`,
      a.devCommand
        ? `    dev: ${a.devCommand.command} ${a.devCommand.args.join(' ')}${a.devCommand.port ? ` (port ${a.devCommand.port})` : ''}`
        : '    dev: not found',
    );
    for (const r of a.routes.filter((x) => x.kind === 'page').slice(0, 25))
      lines.push(`      ${r.path.padEnd(32)} ${r.role.padEnd(12)} ${r.file}`);
  }
  lines.push(
    `  UI:         ${v(p.designSystem.uiLibraries)}; fonts ${v(p.designSystem.fonts)}; ${p.designSystem.cssVariables} CSS variables`,
    `  i18n:       ${v(p.i18n.libraries)}; locales ${p.i18n.locales.join(', ') || '—'}`,
    `  Auth:       ${v(p.auth)}   Payments: ${v(p.payments)}`,
    `  Analytics:  ${v(p.analytics)}   Flags: ${v(p.featureFlags)}`,
    `  Roles:      ${v(p.roles)}`,
    '  Candidate journeys:',
    ...p.candidateJourneys.map((j) => `    - ${j.name}: ${j.routes.join(', ')}`),
    p.integrations.markilo ? `  Markilo brand data: ${p.integrations.markilo}` : '',
    p.integrations.searvex ? `  Searvex data: ${p.integrations.searvex}` : '',
    '  Gaps:',
    ...p.gaps.map((g) => `    - ${g}`),
  );
  return lines.filter(Boolean).join('\n');
}

function siteText(p: SiteProfile): string {
  return [
    `${p.title ?? p.target} (website)`,
    p.headline ? `  Headline:   ${p.headline}` : '',
    p.description ? `  Meta:       ${p.description}` : '',
    `  Languages:  ${p.languages.join(', ') || '—'}`,
    `  Tech:       ${p.technologies.join(', ') || '—'}`,
    `  Services:   ${p.services.map((s) => `${s.name} (${s.kind})`).join(', ') || '—'}`,
    `  Trust:      ${p.trustSignals.join(', ') || '—'}   Pricing: ${p.pricingSignals.join(', ') || '—'}`,
    '  Pages:',
    ...p.pages.map(
      (x) =>
        `    ${x.path.padEnd(28)} ${x.role.padEnd(10)} ${x.status ?? ''} ${x.h1 ?? x.title}${x.forms.length ? `  forms: ${x.forms.join(', ')}` : ''}`,
    ),
    '  Conversion points:',
    ...p.conversionPoints.map((c) => `    ${c.path.padEnd(28)} ${c.kind}: ${c.label}`),
    '  Gaps:',
    ...p.gaps.map((g) => `    - ${g}`),
  ]
    .filter(Boolean)
    .join('\n');
}

export const discover: Command = {
  name: 'discover',
  summary:
    'Product intelligence: map a repository (frameworks, routes, design system, i18n, auth, analytics) or a website (pages, conversion points, services).',
  usage: 'jourilo discover <path|url> [--pages 10]',
  options: {
    pages: { type: 'string' },
    'allow-private': { type: 'boolean' },
    'ignore-robots': { type: 'boolean' },
  },
  async run(ctx) {
    const target = requirePositional(ctx, 0, 'path|url', discover.usage);
    ctx.ws.ensure();
    if (!target.includes('://') && existsSync(target) && statSync(target).isDirectory()) {
      const profile = discoverRepository(resolve(target));
      const file = join(ctx.ws.root, 'product.json');
      writeFileSync(file, `${JSON.stringify(profile, null, 2)}\n`);
      return { data: { file, profile }, text: `${repoText(profile)}\n\n  Saved: ${file}` };
    }
    const { run, observations } = await runAudit(ctx.ws, {
      target,
      viewports: parseViewports('desktop'),
      maxPages: num(ctx, 'pages', 10),
      maxDepth: 3,
      browser: 'chromium',
      headed: false,
      respectRobots: !flag(ctx, 'ignore-robots'),
      allowPrivate: flag(ctx, 'allow-private'),
      keyboard: false,
      throttle: false,
      timeoutMs: 30_000,
      mask: [],
      inventoryOnly: true,
      mode: 'website',
      onProgress: ctx.log,
    });
    const profile = buildSiteProfile(run, observations);
    const file = join(ctx.ws.root, 'site.json');
    writeFileSync(file, `${JSON.stringify(profile, null, 2)}\n`);
    return { data: { file, profile }, text: `${siteText(profile)}\n\n  Saved: ${file}` };
  },
};
