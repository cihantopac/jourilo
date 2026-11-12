import { describe, expect, it } from 'vitest';
import { redactedQueryPaths, redactUrl } from '../../src/core/redact.js';

describe('redactedQueryPaths sees both redaction forms', () => {
  it('detects ?token= (rewritten to [redacted]) and ?access_token= (left as redacted)', () => {
    const token = redactUrl('https://a.test/x?token=abc');
    const access = redactUrl('https://a.test/y?access_token=abc');
    expect(token).not.toContain('abc');
    expect(access).not.toContain('abc');
    expect(redactedQueryPaths([token, access]).sort()).toEqual(['/x', '/y']);
  });
  it('ignores an ordinary query value', () => {
    expect(redactedQueryPaths(['https://a.test/z?page=2'])).toEqual([]);
  });
});
