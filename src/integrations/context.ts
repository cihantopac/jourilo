// Optional, versioned, tool-neutral integration contract: "jourilo.context/v1".
//
// Jourilo works without any of this. When a project carries brand data (from Markilo or any tool that writes
// the same neutral shape) or search findings (from Searvex or similar), Jourilo uses them to:
//  - check design-system consistency against the real brand palette and fonts,
//  - keep locked brand assets locked (recommendations never ask to change a locked brand color),
//  - show search/discoverability findings for the same pages next to experience findings.
// Adapters translate each tool's own files into this contract; nothing is required and nothing is written back.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { toPosix } from '../core/fs-safety.js';

export const CONTEXT_SCHEMA = 'jourilo.context/v1';

export interface BrandContext {
  source: string;
  file: string;
  name: string;
  /** A locked brand's identity must not be changed; Jourilo adapts recommendations accordingly. */
  locked: boolean;
  colors: { name: string; value: string }[];
  fonts: string[];
}

export interface SearchContext {
  source: string;
  file: string;
  findings: { ruleId: string; title: string; severity: string; url: string | null; message: string }[];
}

export interface ExperienceContext {
  schema: typeof CONTEXT_SCHEMA;
  brand: BrandContext | null;
  search: SearchContext | null;
  notes: string[];
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Flattens W3C Design Tokens (`$type`/`$value`) into named colors and font families. */
export function flattenTokens(tokens: unknown): {
  colors: { name: string; value: string }[];
  fonts: string[];
} {
  const colors: { name: string; value: string }[] = [];
  const fonts: string[] = [];
  const walk = (node: unknown, path: string[]) => {
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if ('$value' in o) {
      const type = o.$type;
      if (type === 'color' && typeof o.$value === 'string')
        colors.push({ name: path.join('.'), value: o.$value.toLowerCase() });
      if (type === 'fontFamily') {
        const v = Array.isArray(o.$value) ? o.$value : [o.$value];
        for (const f of v)
          if (
            typeof f === 'string' &&
            !/^(system-ui|sans-serif|serif|monospace|ui-\w+|-apple-system)$/i.test(f) &&
            !fonts.includes(f)
          )
            fonts.push(f);
      }
      return;
    }
    for (const [k, v] of Object.entries(o)) if (!k.startsWith('$')) walk(v, [...path, k]);
  };
  walk(tokens, []);
  return { colors, fonts };
}

/** Markilo adapter: <root>/{branding,brand}/markilo.json + brands/<slug>/exports/tokens/tokens.json. */
export function readMarkilo(root: string, brandSlug?: string): BrandContext | null {
  for (const dir of ['branding', 'brand']) {
    const manifestFile = join(root, dir, 'markilo.json');
    const manifest = readJson(manifestFile) as {
      brands?: { slug: string; name: string; role?: string; locked?: boolean }[];
    } | null;
    if (!manifest?.brands?.length) continue;
    const brand =
      manifest.brands.find((b) => b.slug === brandSlug) ??
      manifest.brands.find((b) => b.role === 'master') ??
      manifest.brands[0]!;
    const tokensFile = join(root, dir, 'brands', brand.slug, 'exports', 'tokens', 'tokens.json');
    if (!existsSync(tokensFile)) continue;
    const { colors, fonts } = flattenTokens(readJson(tokensFile));
    return {
      source: 'markilo',
      file: toPosix(relative(root, tokensFile)),
      name: brand.name,
      locked: brand.locked === true,
      colors,
      fonts,
    };
  }
  return null;
}

/** Searvex adapter: newest <root>/.searvex/runs/<id>/report.json. */
export function readSearvex(root: string): SearchContext | null {
  const runs = join(root, '.searvex', 'runs');
  if (!existsSync(runs)) return null;
  const dirs = readdirSync(runs)
    .filter((d) => existsSync(join(runs, d, 'report.json')))
    .sort(
      (a, b) =>
        statSync(join(runs, b, 'report.json')).mtimeMs - statSync(join(runs, a, 'report.json')).mtimeMs,
    );
  if (!dirs.length) return null;
  const file = join(runs, dirs[0]!, 'report.json');
  const report = readJson(file) as {
    findings?: {
      ruleId: string;
      title: string;
      severity: string;
      message: string;
      evidence?: { url?: string }[];
    }[];
  } | null;
  if (!report?.findings) return null;
  return {
    source: 'searvex',
    file: toPosix(relative(root, file)),
    findings: report.findings.slice(0, 500).map((f) => ({
      ruleId: String(f.ruleId),
      title: String(f.title),
      severity: String(f.severity),
      url: f.evidence?.find((e) => e.url)?.url ?? null,
      message: String(f.message ?? ''),
    })),
  };
}

/** Explicit, tool-neutral file: <root>/jourilo.context.json following this schema. */
function readExplicit(root: string): Partial<ExperienceContext> | null {
  const file = join(root, 'jourilo.context.json');
  const data = readJson(file) as Partial<ExperienceContext> | null;
  if (!data) return null;
  if (data.schema !== CONTEXT_SCHEMA)
    return { notes: [`jourilo.context.json ignored: schema must be "${CONTEXT_SCHEMA}".`] };
  return data;
}

export function loadContext(root: string, opts: { brand?: string } = {}): ExperienceContext {
  const explicit = readExplicit(root);
  const notes = [...(explicit?.notes ?? [])];
  const brand = (explicit?.brand as BrandContext | undefined) ?? readMarkilo(root, opts.brand);
  const search = (explicit?.search as SearchContext | undefined) ?? readSearvex(root);
  if (brand)
    notes.push(`Brand context from ${brand.source} (${brand.file})${brand.locked ? ' — locked' : ''}.`);
  if (search)
    notes.push(
      `Search context from ${search.source} (${search.file}), ${search.findings.length} finding(s).`,
    );
  return { schema: CONTEXT_SCHEMA, brand: brand ?? null, search: search ?? null, notes };
}

// ---- Color helpers for design-system checks ----

export function parseCssColor(c: string): [number, number, number] | null {
  const hex = c.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1]!.length === 3 ? hex[1]!.replace(/(.)/g, '$1$1') : hex[1]!;
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ];
  }
  const rgb = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?/);
  if (rgb) {
    if (rgb[4] !== undefined && Number.parseFloat(rgb[4]) === 0) return null;
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return null;
}

/** CIE76 ΔE in Lab space; ≈ 2.3 is a just-noticeable difference. */
export function deltaE(a: [number, number, number], b: [number, number, number]): number {
  const lab = ([r, g, bl]: [number, number, number]) => {
    const lin = (v: number) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const [R, G, B] = [lin(r), lin(g), lin(bl)];
    const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1! - l2!, a1! - a2!, b1! - b2!);
}

export function nearestBrandColor(
  value: string,
  brand: BrandContext,
): { name: string; value: string; deltaE: number } | null {
  const c = parseCssColor(value);
  if (!c) return null;
  let best: { name: string; value: string; deltaE: number } | null = null;
  for (const b of brand.colors) {
    const bc = parseCssColor(b.value);
    if (!bc) continue;
    const d = deltaE(c, bc);
    if (!best || d < best.deltaE) best = { ...b, deltaE: Math.round(d * 10) / 10 };
  }
  return best;
}
