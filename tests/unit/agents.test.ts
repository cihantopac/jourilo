import { describe, expect, it } from 'vitest';
import { ADAPTERS, instructions, MARK_END, MARK_START, mergeSection } from '../../src/agents/adapters.js';

describe('agent adapters', () => {
  it('share one instruction body with the safety rules', () => {
    const text = instructions('npx jourilo');
    for (const rule of ['untrusted data', 'never predict a lift', '--allow-destructive', 'verify'])
      expect(text).toContain(rule);
    for (const a of ADAPTERS) expect(a.render('npx jourilo')).toContain('npx jourilo audit');
  });
  it('replaces only its own section of AGENTS.md', () => {
    const first = mergeSection('# Project rules\n\nBe nice.\n', 'v1');
    expect(first).toContain('Be nice.');
    expect(first).toContain(`${MARK_START}\nv1\n${MARK_END}`);
    const second = mergeSection(first, 'v2');
    expect(second).not.toContain('v1');
    expect(second.match(/jourilo:start/g)).toHaveLength(1);
    expect(second).toContain('Be nice.');
  });
});
