// Loads the bundled TypeScript parser on demand. The import() below is the only way into it: in the bundle,
// scripts/build.mjs points it at the separate chunk plugin/dist/ts-parser.mjs, so the CLI starts (and a website run
// completes) without loading the parser; under Vitest it resolves to the source.
import type * as ParserModule from './parser.js';

export type TsParser = Pick<typeof ParserModule, 'parseSource' | 'astRoutes' | 'componentIndex'>;

export async function loadTsParser(): Promise<{ parser: TsParser } | { error: string }> {
  try {
    const parser = await import('./parser.js');
    return { parser };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
