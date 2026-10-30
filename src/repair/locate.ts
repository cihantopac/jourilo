// Root-cause location: maps a finding's browser evidence (selectors, HTML excerpts, texts, CSS facts) to the most
// likely source lines in a repository. Purely lexical and explainable: every candidate says why it was chosen.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { toPosix } from '../core/fs-safety.js';
import type { Confidence, Finding, Run, SourceLocation } from '../core/types.js';

const SOURCE_EXT = new Set([
  '.html',
  '.htm',
  '.jsx',
  '.tsx',
  '.js',
  '.ts',
  '.mjs',
  '.vue',
  '.svelte',
  '.astro',
  '.php',
  '.erb',
  '.liquid',
  '.hbs',
  '.njk',
  '.twig',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.dart',
  '.md',
  '.mdx',
]);
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.jourilo',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.astro',
  'coverage',
  'vendor',
  '.turbo',
  '.cache',
  'out',
  'storage',
  '.dart_tool',
]);
const STYLE_EXT = new Set(['.css', '.scss', '.sass', '.less']);

export interface SourceFile {
  rel: string;
  ext: string;
  lines: string[];
}

export function indexRepository(root: string, maxFiles = 6000): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= maxFiles || depth > 12) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.length >= maxFiles) return;
      if (name.startsWith('.') && name !== '.vitepress') continue;
      const full = join(dir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        // Project documentation describes the UI but does not render it.
        const docsDir =
          name === 'docs' && !/(^|[\\/])(src|content|app|pages)([\\/]|$)/.test(relative(root, dir));
        if (!SKIP_DIRS.has(name) && !docsDir) walk(full, depth + 1);
        continue;
      }
      if (depth === 0 && /\.(md|mdx)$/i.test(name)) continue;
      const ext = name.endsWith('.blade.php') ? '.php' : extname(name).toLowerCase();
      if (!SOURCE_EXT.has(ext) || st.size > 512 * 1024 || /\.min\.(js|css)$/.test(name)) continue;
      try {
        out.push({ rel: toPosix(relative(root, full)), ext, lines: readFileSync(full, 'utf8').split('\n') });
      } catch {
        // unreadable file: skip
      }
    }
  };
  walk(root, 0);
  return out;
}

interface Token {
  value: string;
  weight: number;
  reason: string;
  /** Only search style sheets (CSS facts) or only markup. */
  scope?: 'style' | 'markup';
  regex?: RegExp;
  /** Page-level problem: only files that render this route (or shared layouts) can be the cause. */
  route?: boolean;
  /** Describes the root cause itself (a CSS rule, a missing attribute), not just where the element is. */
  primary?: boolean;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const attrRe = (attr: string, value: string) =>
  new RegExp(`\\b${attr}\\s*[=:]\\s*\\{?\\s*["'\`]${escapeRe(value)}["'\`]`, 'i');

export function tokensFor(f: Finding): Token[] {
  const tokens: Token[] = [];
  const add = (t: Token) => {
    if (t.value.length < 3 || tokens.some((x) => x.value === t.value && x.scope === t.scope)) return;
    tokens.push(t);
  };
  for (const e of f.evidence) {
    // Attribute selectors ([href$="#x"]) are values, not ids or classes; drop them before reading the selector.
    const rawSel = e.selector ?? '';
    const sel = rawSel.replace(/(?<!\\)\[(?:\\.|[^\]\\])*\]/g, ' ');
    for (const m of sel.matchAll(/#((?:\\.|[\w-])+)/g)) {
      const id = m[1]!.replace(/\\(.)/g, '$1');
      if (!/^[A-Za-z]/.test(id)) continue;
      add({
        value: id,
        weight: 4,
        reason: `id "${id}"`,
        regex: new RegExp(
          `${attrRe('id', id).source}|#${escapeRe(id)}\\b|getElementById\\(\\s*["']${escapeRe(id)}`,
          'i',
        ),
      });
    }
    for (const m of rawSel.matchAll(/\[data-(?:testid|test|cy)="([^"]+)"\]/g))
      add({
        value: m[1]!,
        weight: 5,
        reason: `test id "${m[1]}"`,
        regex: attrRe('data-(?:testid|test|cy)', m[1]!),
      });
    // Classes may contain escaped characters (Tailwind: .hover\:text-fg, .text-\[0\.95rem\]).
    for (const m of sel.matchAll(/\.((?:\\.|[\w-])+)/g)) {
      const cls = m[1]!.replace(/\\(.)/g, '$1');
      if (cls.length > 2 && /^[A-Za-z]/.test(cls)) add({ value: cls, weight: 1, reason: `class "${cls}"` });
    }
    const snip = e.snippet ?? '';
    for (const m of snip.matchAll(/\b(id|name|placeholder|href|src|for|class|aria-label)="([^"]{3,80})"/g)) {
      const [, attr, val] = m;
      if (attr === 'class') {
        for (const c of val!
          .split(/\s+/)
          .filter((c) => c.length > 2)
          .slice(0, 3))
          add({ value: c, weight: 1, reason: `class "${c}"` });
      } else {
        add({
          value: `${attr}=${val}`,
          weight: attr === 'id' || attr === 'name' ? 4 : 3,
          reason: `${attr}="${val}"`,
          scope: 'markup',
          regex: attrRe(attr === 'for' ? '(?:for|htmlFor)' : attr!, val!),
        });
      }
    }
    // Visible text of the element (e.g. a CTA label or a heading), when it is distinctive enough.
    if (e.type !== 'console' && e.type !== 'network' && e.type !== 'metric') {
      const text = snip
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (
        text.length >= 4 &&
        text.length <= 60 &&
        /[A-Za-z\u00C0-\u024F]{3}/.test(text) &&
        !/^\w+ name=/.test(text)
      )
        add({ value: text, weight: 3, reason: `text "${text}"`, scope: 'markup' });
    }
    // Utility classes that set colors (Tailwind and similar) → the design token that defines the color.
    // text-mark → --color-mark (Tailwind v4 theme) or --mark (plain custom property).
    if (f.ruleId.includes('contrast') && e.type === 'element') {
      const classes = [...snip.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/));
      for (const c of classes) {
        const cm = c.match(/^(?:[a-z-]+:)?(?:text|bg)-([a-z][a-z0-9-]*)$/);
        if (
          !cm ||
          /^(xs|sm|base|lg|xl|\dxl|left|right|center|justify|start|end|wrap|nowrap|balance|pretty|clip|ellipsis|opacity|none|transparent|current|inherit)$/.test(
            cm[1]!,
          ) ||
          /^\d/.test(cm[1]!)
        )
          continue;
        const name = cm[1]!;
        add({
          value: `--color-${name}`,
          weight: 6,
          reason: `color token for .${c}`,
          scope: 'style',
          primary: true,
          regex: new RegExp(`--(?:color-)?${escapeRe(name)}\\s*:`),
        });
      }
    }
    // Color facts from contrast checks → CSS declarations using that color.
    const fg = e.data?.fgColor;
    if (typeof fg === 'string' && /^#[0-9a-f]{6}$/i.test(fg)) {
      add({
        value: fg,
        weight: 5,
        reason: `text color ${fg}`,
        scope: 'style',
        regex: colorRegex(fg),
        primary: true,
      });
    }
  }
  // Rule-specific source patterns describe the root cause itself, so they outrank element matches.
  switch (f.ruleId) {
    case 'jourilo/focus-visible':
      add({
        value: 'outline:none',
        weight: 10,
        reason: 'removes the focus outline',
        scope: 'style',
        regex: /outline\s*:\s*(none|0)\b/i,
      });
      break;
    case 'axe/html-has-lang':
      add({
        value: '<html>',
        weight: 10,
        reason: '<html> without lang',
        scope: 'markup',
        regex: /<html(?![^>]*\blang=)[^>]*>/i,
        route: true,
      });
      break;
    case 'axe/document-title':
      add({
        value: '<head>',
        weight: 6,
        reason: 'document head without <title>',
        scope: 'markup',
        regex: /<head\b[^>]*>/i,
        route: true,
      });
      break;
    case 'jourilo/missing-viewport-meta':
      add({
        value: '<head>',
        weight: 8,
        reason: 'document head without a viewport meta tag',
        scope: 'markup',
        regex: /<head\b[^>]*>/i,
        route: true,
      });
      break;
    case 'jourilo/paste-blocked':
      add({
        value: 'onpaste',
        weight: 10,
        reason: 'cancels paste events',
        regex: /onpaste\s*=|addEventListener\(\s*['"]paste['"]|onPaste\s*=/i,
      });
      break;
    case 'axe/meta-viewport':
      add({
        value: 'user-scalable',
        weight: 10,
        reason: 'viewport meta blocks zoom',
        regex: /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i,
      });
      break;
    case 'jourilo/horizontal-overflow':
      for (const e of f.evidence) {
        for (const m of (e.selector ?? '').matchAll(/\.([A-Za-z][\w-]{2,})/g))
          add({
            value: `.${m[1]}{width}`,
            weight: 8,
            reason: `fixed width on .${m[1]}`,
            scope: 'style',
            regex: new RegExp(`\\.${escapeRe(m[1]!)}\\b[^{]*\\{[^}]*\\b(min-)?width\\s*:\\s*\\d{3,}px`, 'i'),
          });
      }
      add({
        value: 'width:NNNpx',
        weight: 4,
        reason: 'fixed pixel width ≥ 400px',
        scope: 'style',
        regex: /(^|[;{\s])(min-)?width\s*:\s*([4-9]\d{2}|\d{4,})px/i,
      });
      break;
  }
  return tokens;
}

/** Files that probably render the page at `url` (static HTML, file-based routers, server views). */
export function routeFiles(url: string, files: SourceFile[]): Set<string> {
  let path = '/';
  try {
    path = new URL(url).pathname;
  } catch {
    // not a URL: no route match
  }
  const segs = path
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/\.html?$/, ''));
  const route = segs.join('/') || 'index';
  const last = segs[segs.length - 1] ?? 'index';
  const out = new Set<string>();
  for (const f of files) {
    if (STYLE_EXT.has(f.ext)) continue;
    const noExt = f.rel.replace(/(\.blade)?\.[a-z]+$/i, '');
    const candidates = [route, `${route}/index`, `${route}/page`, `${route}/+page`, `${route}/route`];
    if (route === 'index')
      candidates.push(
        'page',
        '+page',
        'home',
        'Home',
        'App',
        'welcome',
        'layout',
        '+layout',
        '_document',
        '_app',
      );
    if (
      candidates.some((c) => noExt === c || noExt.endsWith(`/${c}`)) ||
      (last !== 'index' && new RegExp(`(^|/)${escapeRe(last)}$`, 'i').test(noExt))
    )
      out.add(f.rel);
    // Shared layouts render every page.
    if (/(^|\/)(layout|\+layout|_document|_app|app)\.(t|j)sx?$|(^|\/)layouts?\//i.test(f.rel)) out.add(f.rel);
  }
  return out;
}

function colorRegex(hex: string): RegExp {
  const h = hex.toLowerCase().slice(1);
  const short = h[0] === h[1] && h[2] === h[3] && h[4] === h[5] ? `|#${h[0]}${h[2]}${h[4]}\\b` : '';
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return new RegExp(`#${h}\\b${short}|rgba?\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\b`, 'i');
}

export function locate(f: Finding, files: SourceFile[], max = 3): SourceLocation[] {
  const tokens = tokensFor(f);
  if (!tokens.length) return [];
  const hits = new Map<
    string,
    { file: SourceFile; line: number; score: number; reasons: string[]; primary: boolean }
  >();
  const routed = routeFiles(f.url, files);
  for (const t of tokens) {
    const re = t.regex ?? new RegExp(`(^|[^\\w-])${escapeRe(t.value)}($|[^\\w-])`);
    for (const file of files) {
      const isStyle = STYLE_EXT.has(file.ext);
      if (
        t.scope === 'style' &&
        !isStyle &&
        !/<style|styled\.|css`/.test(file.lines.join('\n').slice(0, 200000))
      )
        continue;
      if (t.scope === 'markup' && isStyle) continue;
      if (t.route && !routed.has(file.rel)) continue;
      // Class tokens only count in markup when they appear inside a class attribute.
      file.lines.forEach((line, i) => {
        if (!re.test(line)) return;
        if (t.reason.startsWith('class') && !isStyle && !/class(Name)?\s*=|:class|class:/.test(line)) return;
        const key = `${file.rel}:${i + 1}`;
        const h = hits.get(key) ?? { file, line: i + 1, score: 0, reasons: [], primary: false };
        h.score += t.weight;
        if (t.primary || t.weight >= 8) h.primary = true;
        if (!h.reasons.includes(t.reason)) h.reasons.push(t.reason);
        hits.set(key, h);
      });
    }
  }
  // Element matches in the file that renders this page are more likely than look-alikes elsewhere.
  for (const h of hits.values()) if (routed.has(h.file.rel)) h.score += 2;
  const ranked = [...hits.values()]
    .sort((a, b) => Number(b.primary) - Number(a.primary) || b.score - a.score)
    .slice(0, 25);
  return ranked.slice(0, max).map((h) => {
    const confidence: Confidence =
      h.score >= 6 || (h.primary && h.score >= 5) ? 'high' : h.score >= 3 ? 'medium' : 'low';
    return {
      file: h.file.rel,
      line: h.line,
      excerpt: h.file.lines
        .slice(Math.max(0, h.line - 2), h.line + 1)
        .join('\n')
        .slice(0, 400),
      reason: `matches ${h.reasons.join(', ')}`,
      confidence,
    };
  });
}

/** Adds `sources` to every finding in the run; returns how many got at least one candidate. */
export function locateFindings(run: Run, repoRoot: string): number {
  const files = indexRepository(repoRoot);
  let n = 0;
  for (const f of run.findings) {
    const src = locate(f, files);
    if (src.length) {
      f.sources = src;
      n++;
    }
  }
  return n;
}
