import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { run } from '../helpers.js';

const schema = JSON.parse(readFileSync('schemas/run.schema.json', 'utf8')) as {
  required: string[];
  properties: Record<string, unknown>;
};

// Keys of `Run` that are optional in src/core/types.ts: a run built by run() may leave them out.
const OPTIONAL_RUN_KEYS = ['product', 'context', 'network', 'outcome', 'stoppedBy', 'dismissed'];

function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) for (const x of node) walk(x, visit);
  else if (node && typeof node === 'object') {
    visit(node as Record<string, unknown>);
    for (const v of Object.values(node)) walk(v, visit);
  }
}

describe('run.schema.json', () => {
  it('every required key of the schema is present on a run built by run(), and the other way round', () => {
    const keys = Object.keys(run([]));
    for (const key of schema.required) expect(keys, `run() lacks ${key}`).toContain(key);
    for (const key of keys) {
      if (OPTIONAL_RUN_KEYS.includes(key)) continue;
      expect(schema.required, `schema does not require ${key}`).toContain(key);
    }
    // Optional keys are described but never required.
    for (const key of OPTIONAL_RUN_KEYS) {
      expect(schema.required).not.toContain(key);
      expect(schema.properties).toHaveProperty(key);
    }
  });

  it('never sets additionalProperties to false', () => {
    walk(schema, (n) => expect(n.additionalProperties).not.toBe(false));
  });
});
