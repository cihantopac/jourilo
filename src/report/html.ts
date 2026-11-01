// Experience Observatory: a self-contained HTML report for one run (optionally with a comparison to a baseline).
// Every string that came from a page is escaped: page content is untrusted and must never execute in the report.
// The report is complete without JavaScript; the inline client only adds language, theme, filters and the repair
// prompt, and a strict CSP keeps it offline.
import { severityRank } from '../audit/finding.js';
import { MANUAL_REVIEW } from '../audit/standards.js';
import type { Evidence, Finding, FindingKind, JourneyResult, Run, Severity } from '../core/types.js';
import type { RunListing } from '../core/workspace.js';
import { FAVICON_URL, wordmarkSvg } from './brand.js';
import type { RunComparison } from './compare.js';
import { HEAD_JS, REPORT_JS } from './html-client.js';
import { fill, I18N, type MsgKey, type Vars } from './html-i18n.js';
import { PROMPT_JS } from './html-prompt.js';
import { REPORT_CSS } from './html-style.js';
import { FIX_PATHS, type FixPath, fixPathOf, rootCauseKey } from './remediation.js';

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only relative run files and http(s) links are allowed into href/src attributes. */
function safeHref(u: string | undefined): string {
  if (!u) return '#';
  if (/^https?:\/\//i.test(u)) return esc(u);
  if (/^[a-z0-9_./-]+$/i.test(u) && !u.includes('..')) return esc(u);
  return '#';
}

/** A file of this run, or of the baseline run (a sibling folder in the same workspace) when `base` is given. */
function runFile(file: string | undefined, base?: string): string {
  const href = safeHref(file);
  // Run files only: a page-supplied absolute URL never becomes an image source.
  if (href === '#' || /^https?:/i.test(href)) return '#';
  if (!base) return href;
  return /^[A-Za-z0-9_-]+$/.test(base) ? `../${base}/${href}` : '#';
}

/** English text that the client re-renders in the chosen language. */
function T(key: MsgKey, vars?: Vars): string {
  const v = vars ? ` data-i18n-v="${esc(JSON.stringify(vars))}"` : '';
  return `<span data-i18n="${key}"${v}>${esc(fill(I18N.en[key], vars))}</span>`;
}

/** Translated attributes, e.g. attrs({ 'aria-label': 'nav.label' }). */
function attrs(map: Record<string, MsgKey>, vars?: Vars): string {
  const pairs = Object.entries(map);
  const v = vars ? ` data-i18n-v="${esc(JSON.stringify(vars))}"` : '';
  return `${pairs.map(([a, k]) => ` ${a}="${esc(fill(I18N.en[k], vars))}"`).join('')} data-i18n-attr="${pairs.map(([a, k]) => `${a}=${k}`).join(';')}"${v}`;
}

function pathname(u: string): string {
  try {
    const x = new URL(u);
    return `${x.pathname}${x.search}`;
  } catch {
    return u;
  }
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'x'
  );
}

const SEVS: Severity[] = ['critical', 'serious', 'moderate', 'minor'];
const KINDS: FindingKind[] = ['defect', 'needs-review', 'hypothesis'];

// ---------------------------------------------------------------------------------------------------------------
// Evidence visuals

interface CropOpts {
  /** Narrowest region of the page to show around the element, in CSS px. */
  minW?: number;
  /** Fixed height/width ratio of the crop (cards); otherwise the height follows the element. */
  ratio?: number;
  base?: string;
}

/** The element's neighbourhood on its screenshot, zoomed to fit the container, with the element outlined. */
function crop(run: Run, f: Finding, e: Evidence, o: CropOpts = {}): string {
  return cropAt(run, (f.viewport ?? '').split(', ')[0] ?? '', e, o);
}

function cropAt(run: Run, vpName: string, e: Pick<Evidence, 'file' | 'rect'>, o: CropOpts = {}): string {
  if (!e.file || !e.rect) return '';
  const vp = run.viewports.find((v) => v.name === vpName);
  if (!vp) return '';
  const src = runFile(e.file, o.base);
  if (src === '#') return '';
  const r = e.rect;
  const pad = 48;
  const rw = Math.min(vp.width, Math.max(o.minW ?? 640, r.width + pad * 2));
  const x0 = Math.min(Math.max(0, r.x + r.width / 2 - rw / 2), Math.max(0, vp.width - rw));
  const rh = o.ratio ? rw * o.ratio : Math.min(rw * 0.75, Math.max(160, r.height + pad * 2));
  const y0 = Math.max(0, r.height + pad * 2 <= rh ? r.y + r.height / 2 - rh / 2 : r.y - pad);
  const pct = (n: number, of: number) => `${((n / of) * 100).toFixed(2)}%`;
  const box = `left:${pct(r.x - x0, rw)};top:${pct(r.y - y0, rh)};width:${pct(Math.max(3, r.width), rw)};height:${pct(Math.max(3, r.height), rh)}`;
  return `<div class="crop" style="aspect-ratio:${Math.round(rw)}/${Math.round(rh)}"><img loading="lazy" alt="" src="${src}" style="width:${pct(vp.width, rw)};left:-${pct(x0, rw)};top:-${pct(y0, rh)}"><div class="box" style="${box}"></div></div>`;
}

/** The best picture for a finding: an outlined element, a screenshot it carries, or its page. */
function visualOf(run: Run, f: Finding, o: CropOpts = {}): string {
  for (const e of f.evidence) {
    const c = crop(run, f, e, o);
    if (c) return c;
  }
  const shot = f.evidence.find((e) => e.type === 'screenshot' && e.file)?.file;
  const vp = (f.viewport ?? '').split(', ')[0];
  const page =
    run.pages.find((p) => p.url === f.url && p.viewport === vp && p.screenshot) ??
    run.pages.find((p) => p.url === f.url && p.screenshot);
  const file = shot ?? page?.screenshot;
  const src = runFile(file, o.base);
  if (src === '#') return '';
  return `<img class="cover" loading="lazy" alt="" src="${src}">`;
}

function evidenceHtml(run: Run, f: Finding, base?: string): string {
  const items = f.evidence.slice(0, 8).map((e) => {
    const parts: string[] = [];
    if (e.type === 'screenshot' && e.file) {
      const src = runFile(e.file, base);
      if (src !== '#')
        parts.push(
          `<a href="${src}" target="_blank" rel="noopener"${attrs({ 'aria-label': 'shot.open' })}><img class="thumb" loading="lazy" ${attrs({ alt: 'fd.shot' })} src="${src}"></a>`,
        );
    }
    const c = crop(run, f, e, { base });
    if (c) parts.push(c);
    const meta: string[] = [];
    if (e.selector) meta.push(`<code>${esc(e.selector)}</code>`);
    if (e.snippet) meta.push(`<pre>${esc(e.snippet)}</pre>`);
    if (e.data && Object.keys(e.data).length)
      meta.push(
        `<div class="data">${Object.entries(e.data)
          .map(
            ([k, v]) => `<span><b>${esc(k)}</b> ${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</span>`,
          )
          .join('')}</div>`,
      );
    if (e.note) meta.push(`<div class="note" lang="en">${esc(e.note)}</div>`);
    return `<li class="ev ev-${esc(e.type)}"><span class="evtype">${esc(e.type)}</span>${parts.join('')}${meta.join('')}</li>`;
  });
  const more =
    f.evidence.length > 8 ? `<li class="note">${T('fd.more', { n: f.evidence.length - 8 })}</li>` : '';
  return `<ul class="evidence">${items.join('')}${more}</ul>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Root-cause groups

interface Group {
  id: string;
  lead: Finding;
  members: Finding[];
  pages: string[];
  path: FixPath;
}

function groupFindings(findings: Finding[]): Group[] {
  const byKey = new Map<string, Finding[]>();
  for (const f of findings) {
    const k = `${f.kind}|${rootCauseKey(f)}`;
    byKey.set(k, [...(byKey.get(k) ?? []), f]);
  }
  return [...byKey.values()]
    .map((members) => {
      const sorted = [...members].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
      const lead = sorted[0]!;
      return {
        id: `rc-${slug(lead.fingerprint)}`,
        lead,
        members: sorted,
        pages: [...new Set(sorted.map((m) => m.url))],
        path: fixPathOf(lead),
      };
    })
    .sort(
      (a, b) =>
        severityRank(a.lead.severity) - severityRank(b.lead.severity) ||
        Number(!!b.lead.journey) - Number(!!a.lead.journey) ||
        b.pages.length - a.pages.length ||
        b.lead.occurrences - a.lead.occurrences ||
        a.lead.title.localeCompare(b.lead.title),
    );
}

function chipsHtml(g: Group, status?: string): string {
  const f = g.lead;
  const parts = [
    `<span class="chip sev sev-${f.severity}">${T(`sev.${f.severity}` as MsgKey)}</span>`,
    `<span class="chip path-${g.path}"${attrs({ title: `path.${g.path}.hint` as MsgKey })}>${T(`path.${g.path}` as MsgKey)}</span>`,
    `<span class="chip">${T(`cat.${f.category}` as MsgKey)}</span>`,
  ];
  if (status) parts.push(`<span class="chip st-${esc(status)}">${T(`st.${status}` as MsgKey)}</span>`);
  if (f.occurrences > 1) parts.push(`<span class="chip">${T('rc.occ', { n: f.occurrences })}</span>`);
  if (g.pages.length > 1) parts.push(`<span class="chip">${T('rc.samecause', { n: g.pages.length })}</span>`);
  return `<span class="chips">${parts.join('')}</span>`;
}

function whereHtml(g: Group): string {
  const f = g.lead;
  const more = g.pages.length > 1 ? ` · +${T('rc.pages', { n: g.pages.length - 1 })}` : '';
  return `${esc(pathname(f.url))}${f.viewport ? ` · ${esc(f.viewport)}` : ''}${f.journey ? ` · ${esc(f.journey)}` : ''}${more}`;
}

function pick(g: Group, label: MsgKey = 'rc.select', visible = false): string {
  const ids = g.members.map((m) => esc(m.fingerprint)).join(' ');
  return `<label class="pick"><input type="checkbox" class="sel" data-ids="${ids}"><span class="${visible ? '' : 'sr'}">${T(label)}${visible ? '' : `: ${esc(g.lead.title)}`}</span></label>`;
}

function groupHtml(run: Run, g: Group, status?: string, base?: string): string {
  const f = g.lead;
  const stds = f.standards
    .map((s) =>
      s.url
        ? `<a href="${safeHref(s.url)}" target="_blank" rel="noopener">${esc(s.standard)} ${esc(s.id)} ${esc(s.title)}</a>`
        : `${esc(s.standard)} ${esc(s.id)} ${esc(s.title)}`,
    )
    .map((x) => `<li>${x}</li>`)
    .join('');
  const sources = f.sources?.length
    ? `<h4>${T('fd.sources')}</h4><ul class="sources">${f.sources
        .map(
          (s) =>
            `<li><code>${esc(s.file)}:${s.line}</code> <span class="chip">${T(`conf.${s.confidence}` as MsgKey)}</span> <span lang="en">${esc(s.reason)}</span>${s.excerpt ? `<pre>${esc(s.excerpt)}</pre>` : ''}</li>`,
        )
        .join('')}</ul>`
    : '';
  const instances =
    g.members.length > 1
      ? `<h4>${T('fd.instances')}</h4><ul class="instances">${g.members
          .map(
            (m) =>
              `<li>${base ? '' : `<label class="pick"><input type="checkbox" class="sel" data-ids="${esc(m.fingerprint)}"><span class="sr">${T('rc.selectOne')}: ${esc(m.title)} ${esc(pathname(m.url))}</span></label>`}<code>${esc(pathname(m.url))}</code> <span class="muted">${esc(m.viewport ?? '')}</span> <span class="chip sev sev-${m.severity}">${T(`sev.${m.severity}` as MsgKey)}</span> <span class="muted">${T('fd.id')} <code>${esc(m.fingerprint)}</code></span></li>`,
          )
          .join('')}</ul>`
      : '';
  const data = base
    ? ''
    : ` data-kind="${f.kind}" data-sev="${f.severity}" data-cat="${esc(f.category)}" data-path="${g.path}" data-pages="${esc(g.pages.join(' '))}" data-n="${g.members.length}"`;
  return `<article class="rc sev-${f.severity} k-${f.kind}${status ? ` st-${esc(status)}` : ''}" id="${base ? 'fixed-' : ''}${g.id}"${data}>
${base ? '<span></span>' : pick(g)}
<details><summary>${chipsHtml(g, status)}<span class="t" lang="en">${esc(f.title)}</span><span class="where">${whereHtml(g)}</span></summary>
<div class="body">
<p lang="en">${esc(f.description)}</p>
<dl class="facts"><dt>${T('fd.why')}</dt><dd lang="en">${esc(f.impact)}</dd><dt>${T('fd.fix')}</dt><dd lang="en">${esc(f.recommendation)}</dd>
<dt>${T('fd.basis')}</dt><dd><span class="chip">${T(`prov.${f.provenance}` as MsgKey)}</span> <span class="chip">${T(`conf.${f.confidence}` as MsgKey)}</span> ${T('fd.rule')} <code>${esc(f.ruleId)}</code> · ${T('fd.id')} <code>${esc(f.fingerprint)}</code></dd>
${stds ? `<dt>${T('fd.standards')}</dt><dd><ul class="stds">${stds}</ul></dd>` : ''}
<dt>${T('fd.repro')}</dt><dd><ol lang="en">${f.reproduction.map((r) => `<li>${esc(r)}</li>`).join('')}</ol></dd></dl>
${sources}${instances}
<h4>${T('fd.evidence')}</h4>${evidenceHtml(run, f, base)}
</div></details></article>`;
}

function cardHtml(run: Run, g: Group): string {
  const f = g.lead;
  const src = f.sources?.[0];
  return `<article class="rc-card sev-${f.severity}"><div class="vis">${visualOf(run, f, { minW: 520, ratio: 0.5 })}</div>
<div class="in">${chipsHtml(g)}<h3><a href="#${g.id}" lang="en">${esc(f.title)}</a></h3>
<div class="where">${whereHtml(g)}</div>
${src ? `<div class="src">${T('fd.sources')}: <code>${esc(src.file)}:${src.line}</code></div>` : ''}
${pick(g, 'rc.select', true)}</div></article>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Sections

function journeyAnchor(j: JourneyResult): string {
  return `j-${slug(j.id)}-${slug(j.viewport)}`;
}

/** One card per blocked journey, however many viewports it failed in. */
function blockedHtml(run: Run, groups: Group[]): string {
  const byId = new Map<string, JourneyResult[]>();
  for (const j of run.journeys) if (j.status !== 'passed') byId.set(j.id, [...(byId.get(j.id) ?? []), j]);
  if (!byId.size) return '';
  const cards = [...byId.values()].map((runs) => {
    // A phone-sized screenshot stays legible on a card; prefer it when the journey failed there too.
    const j = runs.find((r) => /mobile|phone/i.test(r.viewport)) ?? runs[0]!;
    const stop = j.steps.find((s) => s.status === 'failed' || s.status === 'blocked');
    const shot = (stop?.screenshot ? stop : [...j.steps].reverse().find((s) => s.screenshot))?.screenshot;
    const src = runFile(shot);
    const ids = groups
      .filter((x) => x.members.some((m) => m.journey === j.id && m.ruleId.startsWith('journey/')))
      .flatMap((x) => x.members.filter((m) => m.journey === j.id).map((m) => esc(m.fingerprint)));
    const unmet = [
      ...new Map(
        runs.flatMap((r) => r.successCriteria.filter((c) => !c.met)).map((c) => [c.description, c]),
      ).values(),
    ];
    return `<article class="bj">${src !== '#' ? `<figure><img loading="lazy" alt="" src="${src}"><figcaption>${T(stop ? 'j.stoppedHere' : 'j.lastStep')}</figcaption></figure>` : ''}
<div class="in"><span class="chips"><span class="chip st-${j.status}">${T(`st.${j.status}` as MsgKey)}</span>${runs.map((r) => `<span class="chip">${esc(r.viewport)}</span>`).join('')}</span>
<h3 lang="en">${esc(j.name)}</h3>
${stop ? `<p class="muted" style="margin:0">${T('blocked.at', { n: stop.index + 1, t: j.steps.length })}</p><div class="err" lang="en">${esc(stop.description)}${stop.error ? ` — ${esc(stop.error)}` : ''}</div>` : ''}
${unmet.length ? `<ul class="criteria" lang="en">${unmet.map((c) => `<li><span class="mark no" aria-hidden="true">✕</span><span><span class="sr">not met: </span>${esc(c.description)}${c.detail ? ` <span class="muted">${esc(c.detail)}</span>` : ''}</span></li>`).join('')}</ul>` : ''}
<div class="row"><a href="#${journeyAnchor(j)}">${T('blocked.open')}</a>${ids.length ? `<label class="pick"><input type="checkbox" class="sel" data-ids="${[...new Set(ids)].join(' ')}"><span>${T('rc.select')}</span></label>` : ''}</div></div></article>`;
  });
  return `<section class="block" aria-labelledby="h-blocked"><div class="block-h"><div><h2 id="h-blocked">${T('blocked.title')}</h2><p>${T('blocked.hint')}</p></div></div><div class="blocked">${cards.join('')}</div></section>`;
}

function lanesHtml(groups: Group[], run: Run): string {
  const lane = (k: FindingKind) => {
    const list = groups.filter((g) => g.lead.kind === k);
    const n = run.findings.filter((f) => f.kind === k).length;
    return `<div class="lane k-${k}"><div class="head"><h3>${T(`sec.${k}` as MsgKey)}</h3><span class="num">${n}</span></div><p>${T(`sec.${k}.hint` as MsgKey)}</p>
${
  list.length
    ? `<ul lang="en">${list
        // Several elements with the same rule are separate causes, but one line in this summary.
        .reduce(
          (acc, g) => {
            const seen = acc.find((x) => x.g.lead.title === g.lead.title);
            if (seen) seen.n++;
            else acc.push({ g, n: 1 });
            return acc;
          },
          [] as { g: Group; n: number }[],
        )
        .slice(0, 4)
        .map(
          ({ g, n }) =>
            `<li><a href="#${g.id}">${esc(g.lead.title)}</a>${n > 1 ? ` <span class="n">×${n}</span>` : ''}</li>`,
        )
        .join('')}</ul>`
    : `<p>${T('sec.empty')}</p>`
}</div>`;
  };
  return `<section class="block" aria-labelledby="h-lanes"><div class="block-h"><h2 id="h-lanes">${T('lanes.title')}</h2></div><div class="lanes">${KINDS.map(lane).join('')}</div></section>`;
}

function networkHtml(run: Run): string {
  const n = run.network;
  if (!n || (!n.blocked.length && !n.escaped.length)) return '';
  return `<h3 style="margin-top:14px">${T('net.title')}</h3>
${n.escaped.length ? `<p class="poor"><strong>${T('net.escaped', { n: n.escaped.length })}</strong></p><ul>${n.escaped.map((e) => `<li><code>${esc(e.url)}</code> — ${esc(e.reason)}</li>`).join('')}</ul>` : ''}
${n.blocked.length ? `<p class="muted">${T('net.blocked')}</p><div class="tablewrap"><table><thead><tr><th>${T('th.host')}</th><th>${T('th.port')}</th><th>${T('th.reason')}</th></tr></thead><tbody>${n.blocked.map((b) => `<tr><td><code>${esc(b.host)}</code></td><td>${b.port}</td><td>${esc(b.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}

function limitsHtml(run: Run): string {
  const first = run.limitations.slice(0, 3);
  const rest = run.limitations.slice(3);
  return `<section class="block" aria-labelledby="h-limits"><div class="limits"><h2 id="h-limits" style="font-size:20px">${T('limits.title')}</h2>
<ul lang="en">${first.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
<details class="more"><summary>${T('limits.more')}</summary>
${rest.length ? `<ul lang="en">${rest.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
<h3 style="margin-top:14px">${T('limits.manual')}</h3><p class="muted">${T('limits.manual.hint')}</p><ul lang="en">${MANUAL_REVIEW.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
${networkHtml(run)}</details></div></section>`;
}

function contextHtml(run: Run): string {
  const c = run.context;
  if (!c || (!c.brand && !c.search)) return '';
  const parts = [`<details class="fold"><summary>${T('context.title')}</summary>`];
  if (c.brand)
    parts.push(
      `<p><b>${T('context.brand')}</b> (${esc(c.brand.source)}, <code>${esc(c.brand.file)}</code>): ${esc(c.brand.name)} · ${c.brand.colors.length} color tokens · fonts ${esc(c.brand.fonts.join(', ') || '—')}${c.brand.locked ? ' · <span class="chip">locked</span> recommendations keep brand tokens unchanged' : ''}</p>`,
    );
  if (c.search) {
    const paths = new Set(run.pages.map((p) => pathname(p.url)));
    const related = c.search.findings.filter((f) => f.url && paths.has(pathname(f.url)));
    parts.push(
      `<p><b>${T('context.search')}</b> (${esc(c.search.source)}, <code>${esc(c.search.file)}</code>): ${c.search.findings.length} finding(s), ${related.length} on pages in this run.</p>`,
    );
    if (related.length)
      parts.push(
        `<ul lang="en">${related
          .slice(0, 15)
          .map(
            (f) =>
              `<li><span class="chip">${esc(f.severity)}</span> ${esc(f.title)} — <code>${esc(pathname(f.url ?? ''))}</code></li>`,
          )
          .join('')}</ul>`,
      );
  }
  parts.push('</details>');
  return parts.join('');
}

function historyHtml(run: Run, history: RunListing[]): string {
  const same = history.filter((h) => h.target === run.target && h.id !== run.id && h.pages > 0).slice(-9);
  if (!same.length) return '';
  const rows = [
    ...same,
    {
      id: run.id,
      startedAt: run.startedAt,
      defects: run.summary.findings,
      kinds: run.summary.byKind,
      current: true,
    },
  ];
  const total = (d: Run['summary']['findings']) => d.critical + d.serious + d.moderate + d.minor;
  const max = Math.max(1, ...rows.map((r) => total(r.defects)));
  return `<details class="fold"><summary>${T('history.title')}</summary><div class="tablewrap" tabindex="0" role="region"${attrs({ 'aria-label': 'history.title' })}><table class="history"><thead><tr><th>${T('th.run')}</th><th>${T('th.date')}</th>${SEVS.map((s) => `<th>${T(`sev.${s}` as MsgKey)}</th>`).join('')}<th>${T('th.defects')}</th></tr></thead><tbody>${rows
    .map((r, i) => {
      const t = total(r.defects);
      const prev = i ? total(rows[i - 1]!.defects) : t;
      const trend = t < prev ? 'good' : t > prev ? 'poor' : '';
      return `<tr${'current' in r ? ' class="current"' : ''}><td><code>${esc(r.id)}</code>${'current' in r ? ` ${T('history.this')}` : ''}</td><td>${esc(new Date(r.startedAt).toISOString().slice(0, 16).replace('T', ' '))}</td><td>${r.defects.critical}</td><td>${r.defects.serious}</td><td>${r.defects.moderate}</td><td>${r.defects.minor}</td><td class="${trend}"><span class="bar" style="width:${Math.round((t / max) * 120)}px"></span> ${t}</td></tr>`;
    })
    .join('')}</tbody></table></div><p class="muted">${T('history.hint')}</p></details>`;
}

function journeysHtml(run: Run): string {
  if (!run.journeys.length) return `<p class="empty">${T('j.none')}</p>`;
  return run.journeys
    .map((j) => {
      const stopIdx = j.steps.findIndex((s) => s.status === 'failed' || s.status === 'blocked');
      return `<section class="journey ${j.status}" id="${journeyAnchor(j)}" aria-labelledby="${journeyAnchor(j)}-h">
<div class="journey-h"><h3 id="${journeyAnchor(j)}-h" lang="en">${esc(j.name)}</h3><span class="chips"><span class="chip st-${j.status}">${T(`st.${j.status}` as MsgKey)}</span>${j.stability ? `<span class="chip st-${j.stability}">${T(`st.${j.stability}` as MsgKey)}</span>` : ''}<span class="chip">${esc(j.viewport)}</span><span class="chip">${(j.durationMs / 1000).toFixed(1)} s</span></span></div>
${j.attempts ? `<p class="muted">${T('j.attempts', { n: j.attempts.length, list: j.attempts.map((a) => a.status).join(', ') })}${j.stability === 'flaky' ? ` ${T('j.flakyNote')}` : ''}</p>` : ''}
<ol class="timeline" tabindex="0"${attrs({ 'aria-label': 'j.timeline' })}>${j.steps
        .map((s, i) => {
          const src = runFile(s.screenshot);
          return `<li class="${s.status}"><div class="rail"><span class="dot" aria-hidden="true"></span>${T('j.step', { n: i + 1 })}</div>
${src !== '#' ? `<a class="shot" href="${src}" target="_blank" rel="noopener"${attrs({ 'aria-label': 'shot.open' })}><img loading="lazy" alt="" src="${src}"></a>` : `<div class="noshot">${T('j.noShot')}</div>`}
<div class="desc"><span class="chips"><span class="chip st-${s.status}">${T(`st.${s.status}` as MsgKey)}</span><span class="muted">${s.durationMs} ms</span></span>${i === stopIdx ? `<div class="here">${T('j.stoppedHere')}</div>` : ''}<div lang="en">${esc(s.description)}</div>${s.error ? `<pre>${esc(s.error)}</pre>` : ''}</div></li>`;
        })
        .join('')}${
        j.successCriteria.length
          ? `<li class="goal ${j.successCriteria.every((c) => c.met) ? 'passed' : 'failed'}"><div class="rail"><span class="dot" aria-hidden="true"></span>${T('j.goal')}</div><div class="goalbox"><h4 style="margin-top:0">${T('j.criteria')}</h4><ul class="criteria" lang="en">${j.successCriteria.map((c) => `<li><span class="mark ${c.met ? 'ok' : 'no'}" aria-hidden="true">${c.met ? '✓' : '✕'}</span><span><span class="sr">${c.met ? 'met' : 'not met'}: </span>${esc(c.description)}${c.detail ? ` <span class="muted">${esc(c.detail)}</span>` : ''}</span></li>`).join('')}</ul></div></li>`
          : ''
      }</ol>
${j.blockedRequests?.length ? `<details class="more"><summary>${T('j.stopped', { n: j.blockedRequests.length })}</summary><ul>${j.blockedRequests.map((b) => `<li><code>${esc(b.method)} ${esc(b.url)}</code> — ${esc(b.reason)}</li>`).join('')}</ul></details>` : ''}
${j.trace ? `<p class="muted">${T('j.trace')} <code>${esc(j.trace)}</code></p>` : ''}</section>`;
    })
    .join('');
}

function metricCell(p: Run['pages'][number], name: string): string {
  const m = p.metrics.find((x) => x.name === name);
  if (!m) return '<td class="muted">–</td>';
  const v =
    m.unit === 'ms'
      ? `${(m.value / 1000).toFixed(2)} s`
      : m.unit === 'bytes'
        ? `${(m.value / 1024).toFixed(0)} KB`
        : String(m.value);
  return `<td class="${m.rating ?? ''}">${esc(v)}</td>`;
}

function pagesHtml(run: Run): string {
  const rows = run.pages
    .map(
      (
        p,
      ) => `<tr><td>${p.screenshot ? `<a href="${runFile(p.screenshot)}" target="_blank" rel="noopener"${attrs({ 'aria-label': 'shot.open' })}><img class="mini" loading="lazy" alt="" src="${runFile(p.screenshot)}"></a>` : ''}</td>
<td><a href="${safeHref(p.url)}" target="_blank" rel="noopener">${esc(pathname(p.url))}</a><div class="muted" lang="en">${esc(p.title)}</div></td><td>${esc(p.viewport)}</td><td>${p.status ?? '–'}</td>
${metricCell(p, 'LCP')}${metricCell(p, 'CLS')}${metricCell(p, 'TBT')}${metricCell(p, 'Transfer')}<td>${p.consoleErrors}</td><td>${p.failedRequests}</td></tr>`,
    )
    .join('');
  return `<div class="tablewrap" tabindex="0" role="region"${attrs({ 'aria-label': 'pages.table' })}><table class="pages"><thead><tr><th><span class="sr">Screenshot</span></th><th>${T('th.page')}</th><th>${T('th.viewport')}</th><th>${T('th.http')}</th><th>LCP</th><th>CLS</th><th>TBT</th><th>Transfer</th><th>${T('th.jserr')}</th><th>${T('th.failedReq')}</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="muted">${T('pages.note', { t: run.settings.throttle ? I18N.en['pages.throttled'] : I18N.en['pages.unthrottled'] })}</p>`;
}

function compareHtml(cmp: RunComparison): string {
  const kpi = (label: MsgKey, n: number, cls: string) =>
    `<div class="kpi ${cls}"><span class="lbl">${T(label)}</span><span class="num">${n}</span></div>`;
  const base = cmp.base.id;
  const fixedPaths = new Set(cmp.fixed.map((f) => pathname(f.url)));
  const pairs = cmp.head.pages
    .map((hp) => ({
      hp,
      bp: cmp.base.pages.find((p) => pathname(p.url) === pathname(hp.url) && p.viewport === hp.viewport),
    }))
    .filter((x) => x.bp?.screenshot && x.hp.screenshot)
    .sort((a, b) => Number(fixedPaths.has(pathname(b.hp.url))) - Number(fixedPaths.has(pathname(a.hp.url))))
    .slice(0, 6);
  // One card per fixed root cause: the element's region in the baseline next to the same region now.
  // Changes a screenshot can show (layout, size, labels) lead; keyboard and screen-reader fixes follow.
  const visible: Record<string, number> = {
    responsive: 0,
    performance: 1,
    usability: 2,
    content: 3,
    conversion: 4,
  };
  const fixedCards = groupFindings(cmp.fixed)
    .sort((a, b) => (visible[a.lead.category] ?? 9) - (visible[b.lead.category] ?? 9))
    .slice(0, 9)
    .map((g) => {
      const f = g.lead;
      const vpName = (f.viewport ?? '').split(', ')[0] ?? '';
      const e = f.evidence.find((x) => x.file && x.rect);
      const now = cmp.head.pages.find((p) => pathname(p.url) === pathname(f.url) && p.viewport === vpName);
      const before = e ? cropAt(cmp.base, vpName, e, { base, minW: 300, ratio: 1 }) : '';
      const after =
        e && now?.screenshot
          ? cropAt(cmp.head, vpName, { file: now.screenshot, rect: e.rect }, { minW: 300, ratio: 1 })
          : '';
      const vis =
        before && after
          ? `<div class="ba"><figure><figcaption>${T('cmp.before')}</figcaption>${before}</figure><figure class="after"><figcaption>${T('cmp.after')}</figcaption>${after}</figure></div>`
          : `<div class="vis">${visualOf(cmp.base, f, { base, minW: 520, ratio: 0.5 })}</div>`;
      return `<article class="rc-card sev-${f.severity}">${vis}<div class="in"><span class="chips"><span class="chip st-fixed">${T('st.fixed')}</span><span class="chip">${T(`cat.${f.category}` as MsgKey)}</span>${g.pages.length > 1 ? `<span class="chip">${T('rc.samecause', { n: g.pages.length })}</span>` : ''}</span><h3 lang="en">${esc(f.title)}</h3><div class="where">${whereHtml(g)} · <code>${esc(f.fingerprint)}</code></div></div></article>`;
    });
  const reg = cmp.introduced.filter(
    (f) => f.kind === 'defect' && (f.severity === 'critical' || f.severity === 'serious'),
  ).length;
  return `<h2 class="sr">${T('tab.compare')}</h2>
<div class="kpis">${kpi('cmp.fixed', cmp.fixed.length, cmp.fixed.length ? 'ok' : '')}${kpi('cmp.new', cmp.introduced.length, reg ? 'alert' : '')}${kpi('cmp.persisting', cmp.persisting.length, '')}${kpi('cmp.changed', cmp.changed.length, '')}</div>
<p class="${reg ? 'poor' : 'muted'}" style="margin:6px 0"><strong>${reg ? T('cmp.regressed', { n: reg }) : T('cmp.ok')}</strong> ${T('cmp.baseline', { b: base, bd: cmp.base.startedAt.slice(0, 16).replace('T', ' '), h: cmp.head.id, hd: cmp.head.startedAt.slice(0, 16).replace('T', ' ') })}</p>
${fixedCards.length ? `<section class="block"><div class="block-h"><h2>${T('cmp.fixed')}</h2></div><div class="cards">${fixedCards.join('')}</div></section>` : ''}
${
  pairs.length
    ? `<section class="block"><div class="block-h"><h2>${T('cmp.visual')}</h2></div><div class="pairs">${pairs
        .map(
          ({ hp, bp }) =>
            `<div class="pair"><h3>${esc(pathname(hp.url))} · ${esc(hp.viewport)}</h3><div class="two"><figure><figcaption>${T('cmp.before')}</figcaption><a href="${runFile(bp!.screenshot, base)}" target="_blank" rel="noopener"${attrs({ 'aria-label': 'shot.open' })}><img loading="lazy" alt="" src="${runFile(bp!.screenshot, base)}"></a></figure><figure class="after"><figcaption>${T('cmp.after')}</figcaption><a href="${runFile(hp.screenshot)}" target="_blank" rel="noopener"${attrs({ 'aria-label': 'shot.open' })}><img loading="lazy" alt="" src="${runFile(hp.screenshot)}"></a></figure></div></div>`,
        )
        .join('')}</div></section>`
    : ''
}
${
  cmp.metrics.length
    ? `<section class="block"><div class="block-h"><h2>${T('cmp.metrics')}</h2></div><div class="tablewrap" tabindex="0" role="region"${attrs({ 'aria-label': 'cmp.metrics' })}><table><thead><tr><th>${T('th.page')}</th><th>${T('th.viewport')}</th><th>${T('th.metric')}</th><th>${T('th.before')}</th><th>${T('th.after')}</th><th>${T('th.delta')}</th><th>${T('th.verdict')}</th></tr></thead><tbody>${cmp.metrics
        .map(
          (m) =>
            `<tr><td>${esc(pathname(m.url))}</td><td>${esc(m.viewport)}</td><td>${esc(m.name)}</td><td>${m.before}</td><td>${m.after}</td><td class="${m.verdict === 'improved' ? 'good' : m.verdict === 'regressed' ? 'poor' : ''}">${m.delta > 0 ? '+' : ''}${m.delta}</td><td><span class="verdict ${m.verdict}">${T(`v.${m.verdict}` as MsgKey)}</span></td></tr>`,
        )
        .join('')}</tbody></table></div><p class="muted">${T('cmp.metricsNote')}</p></section>`
    : ''
}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Data for the repair prompt (the client never reads the DOM for it)

function payload(run: Run): string {
  const findings = run.findings.map((f) => ({
    id: f.fingerprint,
    rc: rootCauseKey(f),
    title: f.title,
    rule: f.ruleId,
    kind: f.kind,
    sev: f.severity,
    cat: f.category,
    prov: f.provenance,
    conf: f.confidence,
    url: f.url,
    vp: f.viewport,
    journey: f.journey,
    desc: f.description,
    impact: f.impact,
    fix: f.recommendation,
    std: f.standards.map((s) => `${s.standard} ${s.id} ${s.title}`),
    repro: f.reproduction,
    src: (f.sources ?? [])
      .slice(0, 4)
      .map((s) => ({ file: s.file, line: s.line, conf: s.confidence, reason: s.reason })),
    ev: f.evidence.slice(0, 6).map((e) => ({
      type: e.type,
      file: e.file,
      rect: e.rect,
      selector: e.selector,
      data: e.data,
      note: e.note,
    })),
    evn: f.evidence.length,
    occ: f.occurrences,
    path: fixPathOf(f),
  }));
  return JSON.stringify({
    run: {
      id: run.id,
      target: run.target,
      mode: run.mode,
      startedAt: run.startedAt,
      version: run.tool.version,
      repo: typeof run.settings.repo === 'string' ? run.settings.repo : undefined,
    },
    findings,
    i18n: I18N,
  })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// ---------------------------------------------------------------------------------------------------------------

const THEME_ICONS: Record<string, string> = {
  light:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="currentColor"/><g stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9 13 13M3 13l1.1-1.1M11.9 4.1 13 3"/></g></svg>',
  dark: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 10.3A6 6 0 0 1 5.7 2.5a6 6 0 1 0 7.8 7.8Z" fill="currentColor"/></svg>',
  system:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor"/></svg>',
};

export function renderHtml(run: Run, cmp?: RunComparison, history: RunListing[] = []): string {
  const status = new Map<string, string>();
  if (cmp) {
    for (const f of cmp.introduced) status.set(f.fingerprint, 'new');
    for (const f of cmp.persisting) status.set(f.fingerprint, 'persisting');
  }
  const findings = [...run.findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const groups = groupFindings(findings);
  const defectGroups = groups.filter((g) => g.lead.kind === 'defect' && g.lead.severity !== 'info');
  const s = run.summary;
  const defects = s.byKind.defect;
  const journeysDone = run.journeys.filter((j) => j.status === 'passed').length;
  const journeysBlocked = run.journeys.length - journeysDone;
  const autoGroups = defectGroups.filter((g) => g.path === 'auto').length;
  const uniquePages = new Set(run.pages.map((p) => p.url)).size;
  const cats = [...new Set(findings.map((f) => f.category))].sort();
  const pages = [...new Set(findings.map((f) => f.url))];
  const top = defectGroups.slice(0, 6);
  const sevTotal = SEVS.reduce((n, k) => n + s.findings[k], 0) || 1;
  const sevColor: Record<string, string> = {
    critical: 'crit',
    serious: 'ser',
    moderate: 'mod',
    minor: 'min',
  };

  const kpi = (label: MsgKey, num: string, sub: string, cls = '', extra = '') =>
    `<div class="kpi ${cls}"><span class="lbl">${T(label)}</span><span class="num">${num}</span><span class="sub">${sub}</span>${extra}</div>`;
  const kpis = [
    run.journeys.length
      ? kpi(
          'kpi.journeys',
          `${journeysDone}/${run.journeys.length}`,
          T('kpi.journeys.sub', { b: journeysBlocked }),
          journeysBlocked ? 'alert' : 'ok',
        )
      : kpi('kpi.journeys', '—', T('kpi.journeys.none')),
    kpi(
      'kpi.defects',
      String(defects),
      T('kpi.defects.sub', { c: s.findings.critical, s: s.findings.serious }),
      s.findings.critical ? 'alert' : '',
      `<span class="sevbar" aria-hidden="true">${SEVS.map((k) => (s.findings[k] ? `<i style="width:${((s.findings[k] / sevTotal) * 100).toFixed(1)}%;background:var(--${sevColor[k]})"></i>` : '')).join('')}</span>`,
    ),
    kpi('kpi.causes', String(defectGroups.length), T('kpi.causes.sub')),
    kpi('kpi.auto', String(autoGroups), T('kpi.auto.sub'), autoGroups ? 'ok' : ''),
    kpi('kpi.review', String(s.byKind['needs-review']), T('kpi.review.sub')),
    kpi('kpi.hyp', String(s.byKind.hypothesis), T('kpi.hyp.sub')),
  ].join('');

  const lede = `${defects ? T('lede.found', { d: defects, r: defectGroups.length }) : T('lede.clean')}${run.journeys.length ? ` ${journeysBlocked ? T('lede.blocked', { b: journeysBlocked, j: run.journeys.length }) : T('lede.journeysOk', { j: run.journeys.length })}` : ''}`;

  const sel = (f: string, label: MsgKey, options: string) =>
    `<label>${T(label)}<select data-f="${f}">${opt('', 'f.all')}${options}</select></label>`;
  const opt = (value: string, key: MsgKey) =>
    `<option value="${esc(value)}" data-i18n="${key}">${esc(I18N.en[key])}</option>`;
  const kindSection = (k: FindingKind) => {
    const list = groups.filter((g) => g.lead.kind === k);
    if (!list.length) return '';
    return `<section class="kgroup" aria-labelledby="h-k-${k}"><header><h2 id="h-k-${k}">${T(`sec.${k}` as MsgKey)}</h2><p>${T(`sec.${k}.hint` as MsgKey)}</p></header>
${list.map((g) => groupHtml(run, g, status.get(g.lead.fingerprint))).join('\n')}</section>`;
  };
  const fixedGroups = cmp?.fixed.length ? groupFindings(cmp.fixed) : [];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<meta name="generator" content="Jourilo ${esc(run.tool.version)}">
<title>Jourilo · ${esc(run.target)}</title>
<link rel="icon" href="${FAVICON_URL}">
<script>${HEAD_JS}</script>
<style>${REPORT_CSS}</style></head>
<body>
<a class="skip" href="#main">${T('skip')}</a>
<header class="mast"><div class="wrap">
<div class="mast-in"><div class="brand">${wordmarkSvg(30)}<span class="brand-sub">${T('observatory')}</span></div>
<div class="tools"><div class="seg" id="lang" role="group"${attrs({ 'aria-label': 'lang.label' })}><button type="button" data-lang="en" lang="en" aria-pressed="true">EN</button><button type="button" data-lang="tr" lang="tr" aria-pressed="false">TR</button></div>
<div class="seg" id="theme" role="group"${attrs({ 'aria-label': 'theme.label' })}>${['light', 'dark', 'system'].map((m) => `<button type="button" data-theme="${m}" aria-pressed="${m === 'system'}">${THEME_ICONS[m]}<span class="lbl">${T(`theme.${m}` as MsgKey)}</span></button>`).join('')}</div></div></div>
<nav class="tabs" role="tablist"${attrs({ 'aria-label': 'nav.label' })}>
<button type="button" role="tab" id="tab-overview" aria-controls="overview" aria-selected="true">${T('tab.overview')}</button>
<button type="button" role="tab" id="tab-findings" aria-controls="findings" aria-selected="false" tabindex="-1">${T('tab.findings')}<span class="count">${groups.length}</span></button>
<button type="button" role="tab" id="tab-journeys" aria-controls="journeys" aria-selected="false" tabindex="-1">${T('tab.journeys')}<span class="count">${run.journeys.length}</span></button>
<button type="button" role="tab" id="tab-pages" aria-controls="pages" aria-selected="false" tabindex="-1">${T('tab.pages')}<span class="count">${uniquePages}</span></button>
${cmp ? `<button type="button" role="tab" id="tab-compare" aria-controls="compare" aria-selected="false" tabindex="-1">${T('tab.compare')}</button>` : ''}
</nav></div></header>
<main id="main" class="wrap" tabindex="-1">
<section id="overview" class="panel" role="tabpanel" aria-labelledby="tab-overview">
<div class="hero"><p class="eyebrow"><span class="diamond" aria-hidden="true"></span>${T(!run.pages.length && run.journeys.length ? 'mode.journeys' : (`mode.${run.mode}` as MsgKey))} · <time datetime="${esc(run.startedAt)}" data-date="${esc(run.startedAt)}">${esc(new Date(run.startedAt).toUTCString())}</time></p>
<h1 class="serif">${esc(run.target)}</h1>
<p class="lede">${lede}</p>
<p class="scope">${uniquePages ? `<span>${T('scope.pages', { n: uniquePages })}</span>` : ''}<span>${T('scope.viewports', { n: run.viewports.length })} · ${run.viewports.map((v) => `${esc(v.name)} ${v.width}×${v.height}`).join(', ')}</span>${run.journeys.length ? `<span>${T('scope.journeys', { n: run.journeys.length })}</span>` : ''}<span>${esc(run.browser.name)} ${esc(run.browser.version)}</span><span>Jourilo ${esc(run.tool.version)}</span></p></div>
<div class="kpis">${kpis}</div>
<p class="noscore"><span class="diamond" aria-hidden="true"></span>${T('noscore')}</p>
${blockedHtml(run, groups)}
<section class="block" aria-labelledby="h-fixfirst"><div class="block-h"><div><h2 id="h-fixfirst">${T('fixfirst.title')}</h2><p>${T('fixfirst.hint')}</p></div>${groups.length ? `<a class="btn" href="#findings">${T('fixfirst.all')} →</a>` : ''}</div>
${top.length ? `<div class="cards">${top.map((g) => cardHtml(run, g)).join('')}</div>` : `<p class="empty">${T('fixfirst.none')}</p>`}</section>
${lanesHtml(groups, run)}
${limitsHtml(run)}
${historyHtml(run, history)}
${contextHtml(run)}
</section>
<section id="findings" class="panel" role="tabpanel" aria-labelledby="tab-findings">
<h2 class="sr">${T('tab.findings')}</h2>
<div class="toolbar"><div class="filters">
${sel('kind', 'f.type', KINDS.map((k) => opt(k, `sec.${k}` as MsgKey)).join(''))}
${sel('sev', 'f.sev', SEVS.map((k) => opt(k, `sev.${k}` as MsgKey)).join(''))}
${sel('cat', 'f.cat', cats.map((c) => opt(c, `cat.${c}` as MsgKey)).join(''))}
${sel('path', 'f.path', FIX_PATHS.map((p) => opt(p, `path.${p}` as MsgKey)).join(''))}
${sel('page', 'f.page', pages.map((p) => `<option value="${esc(p)}">${esc(pathname(p))}</option>`).join(''))}
</div><div class="tb-row"><span><span id="fcount" aria-live="polite">${esc(fill(I18N.en['f.count'], { g: groups.length, n: findings.length }))}</span> · <span class="muted">${T('f.original')}</span></span>${groups.length ? `<button type="button" class="btn" id="selshown">${T('f.selectShown')}</button>` : ''}</div></div>
${KINDS.map(kindSection).join('')}
<p class="empty" id="fnone"${groups.length ? ' hidden' : ''}>${T('f.none')}</p>
${fixedGroups.length && cmp ? `<section class="kgroup"><header><h2>${T('f.fixedTitle')}</h2></header>${fixedGroups.map((g) => groupHtml(cmp.base, g, 'fixed', cmp.base.id)).join('')}</section>` : ''}
</section>
<section id="journeys" class="panel" role="tabpanel" aria-labelledby="tab-journeys"><h2 class="sr">${T('tab.journeys')}</h2>${journeysHtml(run)}</section>
<section id="pages" class="panel" role="tabpanel" aria-labelledby="tab-pages"><h2 class="sr">${T('tab.pages')}</h2>${pagesHtml(run)}</section>
${cmp ? `<section id="compare" class="panel" role="tabpanel" aria-labelledby="tab-compare">${compareHtml(cmp)}</section>` : ''}
</main>
<div class="actionbar" id="actionbar" role="region"${attrs({ 'aria-label': 'ab.region' })} hidden><span class="n" id="selcount" aria-live="polite"></span><button type="button" class="btn" data-action="prompt">${T('ab.generate')}</button><button type="button" class="btn ghost" id="selclear">${T('ab.clear')}</button></div>
<dialog id="prompt" aria-labelledby="prompt-title" aria-describedby="prompt-hint"><div class="dlg">
<div class="dlg-h"><div><h2 id="prompt-title">${T('pr.title')}</h2><p id="prompt-hint">${T('pr.hint')}</p><p class="chips" style="margin-top:6px"><span class="chip" id="prompt-mix"></span></p></div><button type="button" class="iconbtn" id="prompt-close"${attrs({ 'aria-label': 'pr.close' })}>×</button></div>
<label class="sr" for="prompt-text">${T('pr.label')}</label><textarea id="prompt-text" spellcheck="false" lang="en"></textarea>
<div class="dlg-f"><button type="button" class="btn primary" id="prompt-copy">${T('pr.copy')}</button><button type="button" class="btn" id="prompt-download">${T('pr.download')}</button><span class="status" id="prompt-status" role="status" aria-live="polite"></span></div>
</div></dialog>
<footer class="foot"><div class="wrap">${wordmarkSvg(18)}${T('footer', { v: run.tool.version, id: run.id })}</div></footer>
<script type="application/json" id="jourilo-data">${payload(run)}</script>
<script>${PROMPT_JS}
${REPORT_JS}</script>
</body></html>`;
}
