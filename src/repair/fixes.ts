// Deterministic, minimal fixes for mechanical defects whose correct change is unambiguous. Everything else is left
// to a person or an AI agent with the evidence and source candidates; Jourilo then verifies the result.
// Each fixer edits only the lines it located and explains the change. Fixes are previewed (dry run) by default.
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { suggestAutocomplete } from '../audit/rules/accessibility.js';
import { resolveInside } from '../core/fs-safety.js';
import type { Finding } from '../core/types.js';

export interface FileEdit {
  file: string;
  before: string;
  after: string;
}

export interface FixPlan {
  fingerprint: string;
  ruleId: string;
  title: string;
  explanation: string;
  expectedEffect: string;
  edits: FileEdit[];
  /** Assumptions a reviewer must confirm (e.g. the page language). */
  assumptions: string[];
}

type Fixer = (f: Finding, root: string, read: (file: string) => string | null) => FixPlan | null;

function base(
  f: Finding,
  title: string,
  explanation: string,
  expectedEffect: string,
): Omit<FixPlan, 'edits' | 'assumptions'> {
  return { fingerprint: f.fingerprint, ruleId: f.ruleId, title, explanation, expectedEffect };
}

const isJsx = (file: string) => /\.(jsx|tsx)$/.test(file);

/** html-has-lang: add lang to the <html> tag of the file that renders the page. */
const htmlLang: Fixer = (f, _root, read) => {
  const src = f.sources?.find((s) => s.reason.includes('<html>'));
  if (!src) return null;
  const text = read(src.file);
  if (!text) return null;
  const path = (() => {
    try {
      return new URL(f.url).pathname;
    } catch {
      return '/';
    }
  })();
  const seg = path.split('/').filter(Boolean)[0] ?? '';
  const lang = /^[a-z]{2}(-[a-z]{2})?$/i.test(seg) ? seg.toLowerCase() : 'en';
  const after = text.replace(/<html(?![^>]*\blang=)([^>]*)>/i, `<html lang="${lang}"$1>`);
  if (after === text) return null;
  return {
    ...base(
      f,
      `Add lang="${lang}" to <html>`,
      'Screen readers choose pronunciation from the page language; without it they guess.',
      'axe html-has-lang passes; correct pronunciation in screen readers.',
    ),
    edits: [{ file: src.file, before: text, after }],
    assumptions: [
      seg === lang
        ? `Language "${lang}" was inferred from the URL path /${seg}; confirm it matches the page content.`
        : 'Language "en" is assumed; change it if the page is in another language.',
    ],
  };
};

/** missing-viewport-meta: insert the standard responsive viewport tag into the document head (HTML files). */
const viewportMeta: Fixer = (f, _root, read) => {
  const src = f.sources?.find((s) => /\.html?$/.test(s.file) && s.reason.includes('viewport'));
  if (!src) return null;
  const text = read(src.file);
  if (!text || /name=["']viewport["']/i.test(text)) return null;
  // Keep <meta charset> first (it must be within the first 1024 bytes); insert right after it, else after <head>.
  const anchor = /<meta\s+charset=[^>]*>/i.test(text)
    ? /(<meta\s+charset=[^>]*>)(\r?\n?)(\s*)/i
    : /(<head\b[^>]*>)(\r?\n?)(\s*)/i;
  const after = text.replace(
    anchor,
    (_m, tag: string, nl: string, indent: string) =>
      `${tag}${nl || '\n'}${indent}<meta name="viewport" content="width=device-width, initial-scale=1">\n${indent}`,
  );
  if (after === text) return null;
  return {
    ...base(
      f,
      'Add a responsive viewport meta tag',
      'Without it, mobile browsers lay the page out at ~980 px and zoom out.',
      'The page renders at device width on phones; text and targets get their intended size.',
    ),
    edits: [{ file: src.file, before: text, after }],
    assumptions: [
      'Check that the layout actually works at narrow widths after this change (rerun the mobile audit).',
    ],
  };
};

/** input-purpose: add autocomplete tokens to the located inputs. */
const autocomplete: Fixer = (f, root, read) => {
  const edits = new Map<string, { before: string; after: string }>();
  const tokens: string[] = [];
  for (const e of f.evidence) {
    const m = e.snippet?.match(/^(\w+) name=(\S+) label=(.*)$/);
    if (!m) continue;
    const [, type, name, label] = m;
    if (!name || name === '∅') continue;
    const purpose = /signup|register/i.test(f.description) ? 'signup' : 'other';
    const token = suggestAutocomplete(type!, name, label === '∅' ? null : label!, purpose);
    if (token.startsWith('on (')) continue;
    // Find the input with this name in the located files.
    for (const s of f.sources ?? []) {
      const cur = edits.get(s.file)?.after ?? read(s.file);
      if (!cur) continue;
      const attr = isJsx(s.file) ? 'autoComplete' : 'autocomplete';
      const re = new RegExp(
        `(<input\\b(?=[^>]*\\bname=["']${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'])(?![^>]*\\bauto[cC]omplete=)[^>]*?)(\\s*/?>)`,
      );
      const next = cur.replace(re, `$1 ${attr}="${token}"$2`);
      if (next !== cur) {
        edits.set(s.file, { before: edits.get(s.file)?.before ?? read(s.file)!, after: next });
        tokens.push(`${name} → ${token}`);
        break;
      }
    }
  }
  void root;
  if (!edits.size) return null;
  return {
    ...base(
      f,
      'Add autocomplete tokens to personal-data fields',
      `Lets browsers and password managers fill: ${tokens.join(', ')}.`,
      'WCAG 1.3.5 satisfied for these fields; fewer keystrokes in signup/checkout.',
    ),
    edits: [...edits].map(([file, v]) => ({ file, ...v })),
    assumptions: [
      'Tokens were chosen from field names and labels; confirm each matches what the field collects.',
    ],
  };
};

/** focus-visible: keep the author's outline removal for mouse focus, restore a visible ring for keyboard focus. */
const focusVisible: Fixer = (f, _root, read) => {
  const src = f.sources?.find((s) => /\.(css|scss|less)$/.test(s.file) && s.reason.includes('focus outline'));
  if (!src) return null;
  const text = read(src.file);
  if (!text) return null;
  // Find the rule containing the outline removal and derive :focus-visible selectors from its :focus selectors.
  const lines = text.split('\n');
  let start = src.line - 1;
  while (start > 0 && !lines[start]!.includes('{')) start--;
  const selectorText = lines
    .slice(Math.max(0, start - 3), start + 1)
    .join(' ')
    .split('}')
    .pop()!
    .split('{')[0]!
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
  const sels = selectorText
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /:focus\b/.test(s) && !/:focus-visible/.test(s))
    .map((s) => s.replace(/:focus\b/, ':focus-visible'));
  if (!sels.length) return null;
  // Idempotent: a :focus-visible rule for these selectors already exists.
  if (sels.some((sel) => text.includes(sel))) return null;
  const rule = `\n/* Keyboard focus indicator (WCAG 2.4.7). Mouse focus keeps the original look. */\n${sels.join(',\n')} {\n  outline: 2px solid currentColor;\n  outline-offset: 2px;\n}\n`;
  const after = `${text.replace(/\n*$/, '\n')}${rule}`;
  return {
    ...base(
      f,
      'Restore a visible keyboard focus indicator',
      `The stylesheet removes the outline on ${selectorText}. A :focus-visible rule with the same specificity, later in the file, shows a ring only for keyboard focus.`,
      'Keyboard users see where focus is (WCAG 2.4.7); mouse users see no change.',
    ),
    edits: [{ file: src.file, before: text, after }],
    assumptions: [
      'currentColor must have at least 3:1 contrast against the surrounding background; adjust to a brand token if needed.',
    ],
  };
};

/** paste-blocked: remove inline onpaste handlers from credential inputs. */
const pasteAllowed: Fixer = (f, _root, read) => {
  const src = f.sources?.find((s) => s.reason.includes('paste'));
  if (!src) return null;
  const text = read(src.file);
  if (!text) return null;
  const after = text.replace(/(<input\b[^>]*?)\s+on[pP]aste=(?:"[^"]*"|'[^']*'|\{[^}]*\})([^>]*>)/g, '$1$2');
  if (after === text) return null;
  return {
    ...base(
      f,
      'Allow pasting into credential fields',
      'Inline paste handlers cancel pasting, which blocks password managers.',
      'Password managers and copy-paste work again (WCAG 3.3.8).',
    ),
    edits: [{ file: src.file, before: text, after }],
    assumptions: [
      'Script-attached paste listeners (addEventListener) are not removed automatically; search for them if the finding remains.',
    ],
  };
};

export const FIXERS: Record<string, Fixer> = {
  'axe/html-has-lang': htmlLang,
  'jourilo/missing-viewport-meta': viewportMeta,
  'jourilo/input-purpose': autocomplete,
  'jourilo/focus-visible': focusVisible,
  'jourilo/paste-blocked': pasteAllowed,
};

export function planFixes(findings: Finding[], root: string): FixPlan[] {
  const cache = new Map<string, string | null>();
  const read = (file: string) => {
    if (!cache.has(file)) {
      try {
        const abs = resolveInside(root, file);
        cache.set(
          file,
          existsSync(abs) &&
            [
              '.html',
              '.htm',
              '.css',
              '.scss',
              '.less',
              '.jsx',
              '.tsx',
              '.js',
              '.ts',
              '.vue',
              '.svelte',
              '.astro',
              '.php',
            ].includes(extname(abs).toLowerCase())
            ? readFileSync(abs, 'utf8')
            : null,
        );
      } catch {
        cache.set(file, null);
      }
    }
    return cache.get(file)!;
  };
  const plans: FixPlan[] = [];
  const touched = new Map<string, string>();
  for (const f of findings) {
    const fixer = FIXERS[f.ruleId];
    if (!fixer || !f.sources?.length) continue;
    // Later fixes build on earlier ones in the same file.
    const plan = fixer(f, root, (file) => touched.get(file) ?? read(file));
    if (!plan) continue;
    for (const e of plan.edits) {
      e.before = touched.get(e.file) ?? read(e.file) ?? e.before;
      touched.set(e.file, e.after);
    }
    // One fix per identical change (same rule fixed on several pages through a shared file).
    if (
      plans.some(
        (p) => p.ruleId === plan.ruleId && p.edits.every((e) => plan.edits.some((x) => x.file === e.file)),
      )
    )
      continue;
    plans.push(plan);
  }
  return plans;
}
