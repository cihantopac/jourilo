import { describe, expect, it } from 'vitest';
import { runOutcome } from '../../src/audit/outcome.js';

const pages = (...s: (number | null)[]) => ({ pages: s.map((status) => ({ status })) }) as never;

describe('runOutcome', () => {
  it('is complete when any page got a response', () => {
    expect(runOutcome(pages(null, 404))).toBe('complete');
  });
  it('is no-page-loaded when no page got a response', () => {
    expect(runOutcome(pages(null, null))).toBe('no-page-loaded');
    expect(runOutcome(pages())).toBe('no-page-loaded');
  });
});
