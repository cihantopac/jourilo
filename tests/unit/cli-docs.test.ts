import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../src/cli/registry.js';

describe('CLI reference', () => {
  it('mentions every option of every command in its usage or details', () => {
    const missing: string[] = [];
    for (const c of COMMANDS) {
      const text = `${c.usage}\n${c.details ?? ''}`;
      for (const k of Object.keys(c.options ?? {})) {
        if (!text.includes(`--${k}`)) missing.push(`${c.name} --${k}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
