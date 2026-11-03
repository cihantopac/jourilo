import { describe, expect, it } from 'vitest';
import { exitCodeForOutcome, runOutcome } from '../../src/audit/outcome.js';

const pages = (...s: (number | null)[]) => ({ pages: s.map((status) => ({ status })) }) as never;

describe('runOutcome', () => {
  it('is complete when any page got a response', () => {
    expect(runOutcome(pages(null, 404))).toBe('complete');
  });
  it('is no-page-loaded when no page got a response', () => {
    expect(runOutcome(pages(null, null))).toBe('no-page-loaded');
    expect(runOutcome(pages())).toBe('no-page-loaded');
  });
  it('is partial when the run was stopped, even with no page loaded', () => {
    expect(runOutcome({ pages: [{ status: 200 }], stoppedBy: 'signal' } as never)).toBe('partial');
    expect(runOutcome({ pages: [], stoppedBy: 'max-duration' } as never)).toBe('partial');
  });
});

describe('exitCodeForOutcome', () => {
  it('lets no-page-loaded outrank the gate', () => {
    expect(exitCodeForOutcome('no-page-loaded', true)).toBe(5);
    expect(exitCodeForOutcome('complete', true)).toBe(1);
    expect(exitCodeForOutcome('complete', false)).toBe(0);
    expect(exitCodeForOutcome(undefined, false)).toBe(0);
  });
  it('exits 6 for a partial run, whatever the gate', () => {
    expect(exitCodeForOutcome('partial', true)).toBe(6);
    expect(exitCodeForOutcome('partial', false)).toBe(6);
  });
});
