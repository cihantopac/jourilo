// The TypeScript parser bundled into plugin/dist/ts-parser.mjs (entry point of that chunk). Only `load.ts` reaches
// it, through one dynamic import(), so a website run never loads it. The compiler comes from TypeScript 6
// (`typescript-js`, an npm alias): TypeScript 7 is the native port and has no JavaScript compiler API.
import ts from 'typescript-js';

export { astRoutes } from './routes.js';

const KINDS: Record<string, ts.ScriptKind> = {
  ts: ts.ScriptKind.TS,
  mts: ts.ScriptKind.TS,
  cts: ts.ScriptKind.TS,
  tsx: ts.ScriptKind.TSX,
  js: ts.ScriptKind.JS,
  mjs: ts.ScriptKind.JS,
  cjs: ts.ScriptKind.JS,
  jsx: ts.ScriptKind.JSX,
};

/**
 * The `<script>` blocks of a Vue or Svelte component as one source text. Everything outside the blocks becomes
 * blank (newlines kept), so positions and line numbers match the component file. `lang` is the first block's
 * `lang` attribute (`ts`, `tsx`, ...), or null.
 */
export function scriptBlocks(text: string): { text: string; lang: string | null } {
  const out = text.replace(/[^\n]/g, ' ').split('');
  let lang: string | null = null;
  for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = m[1] ?? '';
    const body = m[2] ?? '';
    lang ??= attrs.match(/\blang\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? null;
    const start = m.index + m[0].indexOf('>') + 1;
    for (let i = 0; i < body.length; i++) out[start + i] = body[i]!;
  }
  return { text: out.join(''), lang };
}

/**
 * Parses a `.ts`, `.tsx`, `.js`, `.jsx` or `.mjs` file, or the script blocks of a `.vue` / `.svelte` component.
 * Returns null when the file is not a supported kind or does not parse cleanly (a broken file, or syntax newer than
 * the bundled parser): the caller then falls back to its regular expressions for that file.
 */
export function parseSource(file: string, text: string): ts.SourceFile | null {
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  let source = text;
  let kind = KINDS[ext];
  if (ext === 'vue' || ext === 'svelte') {
    const blocks = scriptBlocks(text);
    source = blocks.text;
    kind =
      blocks.lang === 'tsx'
        ? ts.ScriptKind.TSX
        : blocks.lang === 'jsx'
          ? ts.ScriptKind.JSX
          : ts.ScriptKind.TS;
  }
  if (kind === undefined) return null;
  try {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
    // The parser recovers from errors and records them here; a recovered tree is not trusted for routes.
    const errors = (sf as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics;
    return errors?.length ? null : sf;
  } catch {
    return null;
  }
}
