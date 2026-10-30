// Experience Observatory: a self-contained HTML report for one run (optionally with a comparison to a baseline).
// Every string that came from a page is escaped: page content is untrusted and must never execute in the report.
import { severityRank } from '../audit/finding.js';
import type { Evidence, Finding, JourneyResult, PageCapture, Run, Viewport } from '../core/types.js';
import type { RunComparison } from './compare.js';

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

const SEV_LABEL: Record<string, string> = {
  critical: 'Critical',
  serious: 'Serious',
  moderate: 'Moderate',
  minor: 'Minor',
  info: 'Info',
};

const KIND_LABEL: Record<string, string> = {
  defect: 'Defect',
  hypothesis: 'Hypothesis',
  'needs-review': 'Needs review',
};

const PROV_LABEL: Record<string, string> = {
  measured: 'Measured',
  observed: 'Observed',
  heuristic: 'Heuristic',
  inferred: 'AI inference',
  user: 'User input',
};

function viewportOf(run: Run, name: string | undefined): Viewport | undefined {
  const first = (name ?? '').split(', ')[0];
  return run.viewports.find((v) => v.name === first);
}

function crop(run: Run, f: Finding, e: Evidence): string {
  if (!e.file || !e.rect) return '';
  const vp = viewportOf(run, f.viewport);
  if (!vp) return '';
  const W = Math.min(560, vp.width);
  const scale = W / vp.width;
  const pad = 80;
  const top = Math.max(0, e.rect.y - pad);
  const h = Math.min(420, Math.max(80, (e.rect.height + pad * 2) * scale));
  const box = `left:${(e.rect.x * scale).toFixed(1)}px;top:${((e.rect.y - top) * scale).toFixed(1)}px;width:${Math.max(4, e.rect.width * scale).toFixed(1)}px;height:${Math.max(4, e.rect.height * scale).toFixed(1)}px`;
  return `<div class="crop" style="width:${W}px;height:${h.toFixed(0)}px"><img loading="lazy" alt="" src="${safeHref(e.file)}" style="width:${W}px;top:-${(top * scale).toFixed(1)}px"><div class="box" style="${box}"></div></div>`;
}

function evidenceHtml(run: Run, f: Finding): string {
  const items = f.evidence.slice(0, 8).map((e) => {
    const parts: string[] = [];
    if (e.type === 'screenshot' && e.file) {
      parts.push(
        `<a href="${safeHref(e.file)}" target="_blank" rel="noopener"><img class="thumb" loading="lazy" alt="Screenshot evidence" src="${safeHref(e.file)}"></a>`,
      );
    }
    const c = crop(run, f, e);
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
    if (e.note) meta.push(`<div class="note">${esc(e.note)}</div>`);
    return `<li class="ev ev-${esc(e.type)}"><span class="evtype">${esc(e.type)}</span>${parts.join('')}${meta.join('')}</li>`;
  });
  const more =
    f.evidence.length > 8 ? `<li class="muted">+${f.evidence.length - 8} more in run.json</li>` : '';
  return `<ul class="evidence">${items.join('')}${more}</ul>`;
}

function findingHtml(run: Run, f: Finding, status?: string, pages = 1): string {
  const stds = f.standards
    .map((s) =>
      s.url
        ? `<a href="${safeHref(s.url)}" target="_blank" rel="noopener">${esc(s.standard)} ${esc(s.id)} ${esc(s.title)}</a>`
        : `${esc(s.standard)} ${esc(s.id)} ${esc(s.title)}`,
    )
    .join('<br>');
  const sources = f.sources?.length
    ? `<h4>Likely source</h4><ul class="sources">${f.sources
        .map(
          (s) =>
            `<li><code>${esc(s.file)}:${s.line}</code> <span class="pill">${esc(s.confidence)}</span> ${esc(s.reason)}${s.excerpt ? `<pre>${esc(s.excerpt)}</pre>` : ''}</li>`,
        )
        .join('')}</ul>`
    : '';
  return `<details class="finding sev-${f.severity}" data-sev="${f.severity}" data-cat="${esc(f.category)}" data-kind="${esc(f.kind)}" data-page="${esc(f.url)}"${status ? ` data-status="${esc(status)}"` : ''}>
<summary><span class="sev">${SEV_LABEL[f.severity]}</span><span class="title">${esc(f.title)}</span>
<span class="tags"><span class="pill kind-${esc(f.kind)}">${KIND_LABEL[f.kind]}</span><span class="pill">${esc(f.category)}</span>${status ? `<span class="pill st-${esc(status)}">${esc(status)}</span>` : ''}${f.occurrences > 1 ? `<span class="pill">×${f.occurrences}</span>` : ''}${pages > 1 ? `<span class="pill">same cause on ${pages} pages</span>` : ''}</span>
<span class="where">${esc(pathname(f.url))}${f.viewport ? ` · ${esc(f.viewport)}` : ''}</span></summary>
<div class="body">
<p>${esc(f.description)}</p>
<dl><dt>Why it matters</dt><dd>${esc(f.impact)}</dd><dt>Suggested fix</dt><dd>${esc(f.recommendation)}</dd>
<dt>Basis</dt><dd><span class="pill prov">${PROV_LABEL[f.provenance]}</span> confidence: ${esc(f.confidence)} · rule <code>${esc(f.ruleId)}</code> · id <code>${esc(f.fingerprint)}</code></dd>
${stds ? `<dt>Standards</dt><dd>${stds}</dd>` : ''}
<dt>Reproduce</dt><dd><ol>${f.reproduction.map((r) => `<li>${esc(r)}</li>`).join('')}</ol></dd></dl>
${sources}
<h4>Evidence</h4>${evidenceHtml(run, f)}
</div></details>`;
}

function pathname(u: string): string {
  try {
    const x = new URL(u);
    return `${x.pathname}${x.search}`;
  } catch {
    return u;
  }
}

function metricCell(p: PageCapture, name: string): string {
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
      ) => `<tr><td>${p.screenshot ? `<a href="${safeHref(p.screenshot)}" target="_blank" rel="noopener"><img class="mini" loading="lazy" alt="" src="${safeHref(p.screenshot)}"></a>` : ''}</td>
<td><a href="${safeHref(p.url)}" target="_blank" rel="noopener">${esc(pathname(p.url))}</a><div class="muted">${esc(p.title)}</div></td><td>${esc(p.viewport)}</td><td>${p.status ?? '–'}</td>
${metricCell(p, 'LCP')}${metricCell(p, 'CLS')}${metricCell(p, 'TBT')}${metricCell(p, 'Transfer')}<td>${p.consoleErrors}</td><td>${p.failedRequests}</td></tr>`,
    )
    .join('');
  return `<table class="pages"><thead><tr><th></th><th>Page</th><th>Viewport</th><th>HTTP</th><th>LCP</th><th>CLS</th><th>TBT</th><th>Transfer</th><th>JS errors</th><th>Failed req.</th></tr></thead><tbody>${rows}</tbody></table>
<p class="muted">Lab values from one scripted visit (${esc(String(run.settings.throttle ? 'throttled' : 'unthrottled'))}); not field data. Colors use web.dev thresholds.</p>`;
}

function journeysHtml(journeys: JourneyResult[]): string {
  if (!journeys.length)
    return '<p class="muted">No journeys were run. Use <code>jourilo journeys suggest</code> and <code>jourilo journeys run</code>.</p>';
  return journeys
    .map(
      (
        j,
      ) => `<section class="journey ${j.status}"><h3>${esc(j.name)} <span class="pill st-${j.status}">${j.status}</span> <span class="muted">${esc(j.viewport)} · ${(j.durationMs / 1000).toFixed(1)} s</span></h3>
<ol class="steps">${j.steps
        .map(
          (s) =>
            `<li class="${s.status}"><div>${esc(s.description)} <span class="pill st-${s.status}">${s.status}</span> <span class="muted">${s.durationMs} ms</span>${s.error ? `<pre>${esc(s.error)}</pre>` : ''}</div>${s.screenshot ? `<a href="${safeHref(s.screenshot)}" target="_blank" rel="noopener"><img class="stepshot" loading="lazy" alt="" src="${safeHref(s.screenshot)}"></a>` : ''}</li>`,
        )
        .join('')}</ol>
<h4>Success criteria</h4><ul>${j.successCriteria.map((c) => `<li>${c.met ? '✅' : '❌'} ${esc(c.description)}${c.detail ? ` <span class="muted">${esc(c.detail)}</span>` : ''}</li>`).join('')}</ul>
${j.trace ? `<p>Trace: <code>${esc(j.trace)}</code> (open with <code>npx playwright show-trace</code>)</p>` : ''}</section>`,
    )
    .join('');
}

function compareHtml(cmp: RunComparison): string {
  const row = (label: string, n: number, cls: string) =>
    `<div class="card ${cls}"><div class="num">${n}</div><div>${label}</div></div>`;
  return `<div class="cards">${row('Fixed', cmp.fixed.length, 'good')}${row('New', cmp.introduced.length, 'poor')}${row('Still present', cmp.persisting.length, '')}${row('Changed severity', cmp.changed.length, '')}</div>
<p class="muted">Baseline run <code>${esc(cmp.base.id)}</code> (${esc(cmp.base.startedAt)}) vs <code>${esc(cmp.head.id)}</code> (${esc(cmp.head.startedAt)}).</p>
${cmp.metrics.length ? `<table><thead><tr><th>Page</th><th>Viewport</th><th>Metric</th><th>Before</th><th>After</th><th>Δ</th></tr></thead><tbody>${cmp.metrics.map((m) => `<tr><td>${esc(pathname(m.url))}</td><td>${esc(m.viewport)}</td><td>${esc(m.name)}</td><td>${m.before}</td><td>${m.after}</td><td class="${m.delta < 0 ? 'good' : m.delta > 0 ? 'poor' : ''}">${m.delta > 0 ? '+' : ''}${m.delta}</td></tr>`).join('')}</tbody></table><p class="muted">Lab deltas from single visits can be noise; repeat runs before drawing conclusions.</p>` : ''}`;
}

function contextHtml(run: Run): string {
  const c = run.context;
  if (!c || (!c.brand && !c.search)) return '';
  const parts = ['<h2>Context from other tools</h2>'];
  if (c.brand)
    parts.push(
      `<p><b>Brand</b> (${esc(c.brand.source)}, <code>${esc(c.brand.file)}</code>): ${esc(c.brand.name)} · ${c.brand.colors.length} color tokens · fonts ${esc(c.brand.fonts.join(', ') || '—')}${c.brand.locked ? ' · <span class="pill">locked</span> recommendations keep brand tokens unchanged' : ''}</p>`,
    );
  if (c.search) {
    const paths = new Set(run.pages.map((p) => pathname(p.url)));
    const related = c.search.findings.filter((f) => f.url && paths.has(pathname(f.url)));
    parts.push(
      `<p><b>Search</b> (${esc(c.search.source)}, <code>${esc(c.search.file)}</code>): ${c.search.findings.length} finding(s), ${related.length} on pages in this run.</p>`,
    );
    if (related.length)
      parts.push(
        `<ul>${related
          .slice(0, 15)
          .map(
            (f) =>
              `<li><span class="pill">${esc(f.severity)}</span> ${esc(f.title)} — <code>${esc(pathname(f.url ?? ''))}</code></li>`,
          )
          .join('')}</ul>`,
      );
  }
  return parts.join('');
}

export function renderHtml(run: Run, cmp?: RunComparison): string {
  const status = new Map<string, string>();
  if (cmp) {
    for (const f of cmp.introduced) status.set(f.fingerprint, 'new');
    for (const f of cmp.persisting) status.set(f.fingerprint, 'persisting');
  }
  const findings = [...run.findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const defects = findings.filter((f) => f.kind === 'defect');
  // "Fix first" groups by root cause: the same rule traced to the same source line is one fix, however many pages
  // show it.
  const groups = new Map<string, Finding[]>();
  for (const f of defects) {
    const src = f.sources?.[0];
    const key =
      src && src.confidence !== 'low'
        ? `${f.ruleId}|${src.file}:${src.line}`
        : `${f.ruleId}|${f.fingerprint}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const top = [...groups.values()]
    .map((g) => ({
      lead: g.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))[0]!,
      pages: new Set(g.map((x) => x.url)).size,
    }))
    .sort(
      (a, b) =>
        severityRank(a.lead.severity) - severityRank(b.lead.severity) ||
        b.pages - a.pages ||
        b.lead.occurrences - a.lead.occurrences,
    )
    .slice(0, 6);
  const s = run.summary;
  const cats = [...new Set(findings.map((f) => f.category))].sort();
  const pages = [...new Set(findings.map((f) => f.url))];
  const sevCard = (k: keyof typeof s.findings) =>
    `<div class="card sev-${k}"><div class="num">${s.findings[k]}</div><div>${SEV_LABEL[k]}</div></div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Jourilo report · ${esc(run.target)}</title>
<style>${CSS}</style></head>
<body>
<header class="top"><div class="brand">Jourilo <span class="muted">Experience Observatory</span></div>
<div class="meta"><b>${esc(run.target)}</b><br><span class="muted">${esc(run.mode)} mode · ${esc(new Date(run.startedAt).toUTCString())} · ${esc(run.browser.name)} ${esc(run.browser.version)} · ${run.viewports.map((v) => `${esc(v.name)} ${v.width}×${v.height}`).join(', ')} · Jourilo ${esc(run.tool.version)}</span></div></header>
<nav class="tabs" role="tablist">
<button role="tab" aria-selected="true" data-tab="overview">Overview</button>
<button role="tab" aria-selected="false" data-tab="findings">Findings (${findings.length})</button>
<button role="tab" aria-selected="false" data-tab="pages">Pages (${run.pages.length})</button>
<button role="tab" aria-selected="false" data-tab="journeys">Journeys (${run.journeys.length})</button>
${cmp ? '<button role="tab" aria-selected="false" data-tab="compare">Before / after</button>' : ''}
</nav>
<main>
<section id="overview" class="panel">
<div class="cards">${sevCard('critical')}${sevCard('serious')}${sevCard('moderate')}${sevCard('minor')}</div>
<p class="kinds"><span class="pill kind-defect">${s.byKind.defect} defects</span> <span class="pill kind-hypothesis">${s.byKind.hypothesis} conversion hypotheses</span> <span class="pill kind-needs-review">${s.byKind['needs-review']} need manual review</span> across ${new Set(run.pages.map((p) => p.url)).size} page(s)${run.journeys.length ? ` and ${run.journeys.length} journey(s)` : ''}.</p>
<p class="muted">No overall score is shown on purpose: a single number hides what matters. Defects are measured or observed problems; hypotheses are untested ideas that need an experiment or analytics before anyone claims an effect.</p>
<h2>Fix first</h2>
${top.length ? top.map((t) => findingHtml(run, t.lead, status.get(t.lead.fingerprint), t.pages)).join('') : '<p>No defects detected by automated checks. Manual review is still required (see limitations).</p>'}
<h2>By category</h2><ul class="bycat">${Object.entries(s.byCategory)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([k, v]) => `<li><b>${v}</b> ${esc(k)}</li>`)
    .join('')}</ul>
${contextHtml(run)}
<h2>Limitations of this run</h2><ul class="limits">${run.limitations.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
</section>
<section id="findings" class="panel" hidden>
<div class="filters">
<label>Severity <select data-f="sev"><option value="">All</option>${['critical', 'serious', 'moderate', 'minor'].map((v) => `<option>${v}</option>`).join('')}</select></label>
<label>Kind <select data-f="kind"><option value="">All</option><option value="defect">Defect</option><option value="hypothesis">Hypothesis</option><option value="needs-review">Needs review</option></select></label>
<label>Category <select data-f="cat"><option value="">All</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
<label>Page <select data-f="page"><option value="">All</option>${pages.map((p) => `<option value="${esc(p)}">${esc(pathname(p))}</option>`).join('')}</select></label>
<span class="count muted"></span></div>
${findings.map((f) => findingHtml(run, f, status.get(f.fingerprint))).join('\n')}
${cmp?.fixed.length ? `<h2>Fixed since baseline</h2>${cmp.fixed.map((f) => findingHtml(cmp.base, f, 'fixed')).join('')}` : ''}
</section>
<section id="pages" class="panel" hidden>${pagesHtml(run)}</section>
<section id="journeys" class="panel" hidden>${journeysHtml(run.journeys)}</section>
${cmp ? `<section id="compare" class="panel" hidden>${compareHtml(cmp)}</section>` : ''}
</main>
<footer class="muted">Generated by Jourilo ${esc(run.tool.version)} · run <code>${esc(run.id)}</code> · data: run.json</footer>
<script>${JS}</script>
</body></html>`;
}

const CSS = `
:root{--bg:#f7f7f8;--fg:#18181b;--muted:#6b6b76;--card:#fff;--line:#e4e4e7;--accent:#4338ca;--crit:#b91c1c;--ser:#c2410c;--mod:#a16207;--min:#4b5563;--good:#15803d;--poor:#b91c1c;--ni:#a16207}
@media (prefers-color-scheme:dark){:root{--bg:#0f0f12;--fg:#ececf1;--muted:#a1a1aa;--card:#18181d;--line:#2e2e35;--accent:#a5b4fc;--crit:#f87171;--ser:#fb923c;--mod:#facc15;--min:#cbd5e1;--good:#4ade80;--poor:#f87171;--ni:#facc15}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
a{color:var(--accent)}code,pre{font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}pre{white-space:pre-wrap;word-break:break-word;background:var(--bg);border:1px solid var(--line);padding:6px 8px;border-radius:6px;margin:4px 0}
.top{display:flex;gap:24px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:16px 24px;border-bottom:1px solid var(--line);background:var(--card)}
.brand{font-weight:700;font-size:18px}.muted{color:var(--muted)}.meta{text-align:right;font-size:13px;overflow-wrap:anywhere}
.tabs{display:flex;gap:4px;padding:0 24px;background:var(--card);border-bottom:1px solid var(--line);overflow-x:auto}
.tabs button{font:inherit;background:none;border:0;border-bottom:3px solid transparent;padding:12px 12px;color:var(--muted);cursor:pointer;white-space:nowrap}
.tabs button[aria-selected=true]{color:var(--fg);border-color:var(--accent);font-weight:600}.tabs button:focus-visible{outline:2px solid var(--accent)}
main{max-width:1100px;margin:0 auto;padding:16px 24px 48px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:12px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}.card .num{font-size:28px;font-weight:700}
.card.sev-critical .num{color:var(--crit)}.card.sev-serious .num{color:var(--ser)}.card.sev-moderate .num{color:var(--mod)}.card.good .num{color:var(--good)}.card.poor .num{color:var(--poor)}
.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:0 8px;font-size:12px;margin-right:4px;background:var(--card)}
.kind-hypothesis{border-color:var(--accent)}.kind-needs-review{border-style:dashed}.st-new,.st-failed{color:var(--poor);border-color:var(--poor)}.st-fixed,.st-passed{color:var(--good);border-color:var(--good)}.st-blocked{color:var(--mod)}
details.finding{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--min);border-radius:8px;margin:8px 0}
details.sev-critical{border-left-color:var(--crit)}details.sev-serious{border-left-color:var(--ser)}details.sev-moderate{border-left-color:var(--mod)}
summary{cursor:pointer;padding:10px 14px;display:grid;grid-template-columns:auto 1fr;gap:2px 10px;align-items:baseline}
summary .sev{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.03em}summary .title{font-weight:600}
summary .tags,summary .where{grid-column:2;font-size:12.5px}summary .where{color:var(--muted);overflow-wrap:anywhere}
.sev-critical .sev{color:var(--crit)}.sev-serious .sev{color:var(--ser)}.sev-moderate .sev{color:var(--mod)}.sev-minor .sev{color:var(--min)}
.body{padding:0 16px 14px}dl{display:grid;grid-template-columns:140px 1fr;gap:6px 12px;margin:8px 0}dt{color:var(--muted)}dd{margin:0}dd ol{margin:0;padding-left:18px}
@media (max-width:640px){dl{grid-template-columns:1fr}.meta{text-align:left}main{padding:12px 16px}.top{padding:12px 16px}}
ul.evidence{list-style:none;padding:0;display:grid;gap:10px}li.ev{border:1px solid var(--line);border-radius:8px;padding:8px;overflow:hidden}
.evtype{font-size:11px;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:4px}
.crop{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:6px;max-width:100%;background:#fff}
.crop img{position:absolute;left:0}.crop .box{position:absolute;outline:2px solid #e11d48;box-shadow:0 0 0 4px rgba(225,29,72,.25);border-radius:2px}
.thumb{max-width:100%;max-height:260px;border:1px solid var(--line);border-radius:6px}.mini{width:96px;max-height:72px;object-fit:cover;object-position:top;border:1px solid var(--line);border-radius:4px}
.data span{display:inline-block;margin-right:12px;font-size:12.5px}.note{font-size:12.5px;color:var(--muted)}
table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);border-radius:8px;display:block;overflow-x:auto}
th,td{padding:8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:13.5px}td.good{color:var(--good)}td.poor{color:var(--poor);font-weight:600}td.needs-improvement{color:var(--ni)}
.filters{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:8px 0 12px}.filters select{font:inherit;padding:4px;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:6px;max-width:220px}
.journey{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:12px 0}
.steps{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;list-style:none;padding:0;counter-reset:step}
.steps li{counter-increment:step;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:13px;display:flex;flex-direction:column;gap:6px}
.steps li::before{content:counter(step);font-weight:700;color:var(--muted);font-size:12px}
.steps li.skipped{opacity:.55}.steps li.failed,.steps li.blocked{border-color:var(--poor)}
.stepshot{width:100%;aspect-ratio:16/10;object-fit:cover;object-position:top;border:1px solid var(--line);border-radius:6px;display:block}
.steps li.failed b,.steps li.blocked b{color:var(--poor)}ul.bycat{columns:2}ul.limits li{margin:4px 0}
footer{padding:16px 24px;text-align:center;font-size:12.5px}
`;

const JS = `
document.querySelectorAll('.tabs button').forEach(function(b){b.addEventListener('click',function(){
document.querySelectorAll('.tabs button').forEach(function(x){x.setAttribute('aria-selected',x===b?'true':'false')});
document.querySelectorAll('.panel').forEach(function(p){p.hidden=p.id!==b.dataset.tab});});});
var sels=document.querySelectorAll('.filters select');function apply(){var f={};sels.forEach(function(s){f[s.dataset.f]=s.value});var n=0;
document.querySelectorAll('#findings details.finding').forEach(function(d){var ok=(!f.sev||d.dataset.sev===f.sev)&&(!f.kind||d.dataset.kind===f.kind)&&(!f.cat||d.dataset.cat===f.cat)&&(!f.page||d.dataset.page===f.page)&&d.dataset.status!=='fixed';d.hidden=!ok&&d.dataset.status!=='fixed';if(ok)n++});
var c=document.querySelector('.filters .count');if(c)c.textContent=n+' shown';}
sels.forEach(function(s){s.addEventListener('change',apply)});apply();
`;
