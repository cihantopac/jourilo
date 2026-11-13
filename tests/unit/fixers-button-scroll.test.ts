// The type="button" and scroll-padding fixers on real-shaped sources: JSX with arrow handlers, an existing html rule,
// a global stylesheet fallback, and the submit vocabulary that keeps "Sign in" out of the rule.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lexicon } from '../../src/core/lexicon.js';
import type { Finding } from '../../src/core/types.js';
import { planFixes } from '../../src/repair/fixes.js';

const repo = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), 'jourilo-fix-'));
  for (const [f, t] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), t);
  }
  return root;
};
const finding = (ruleId: string, file: string, line: number, evidence: Finding['evidence']): Finding =>
  ({
    fingerprint: `${ruleId}-fp`,
    ruleId,
    url: 'http://127.0.0.1/',
    sources: [{ file, line, reason: 'x', confidence: 'high' }],
    evidence,
  }) as unknown as Finding;
const buttonFinding = (file: string, name: string, snippet: string) =>
  finding('jourilo/button-implicit-submit', file, 1, [
    { type: 'element', selector: 'form button', snippet, data: { buttonName: name } },
  ]);
const barFinding = (file: string, data: Record<string, unknown>) =>
  finding('jourilo/focus-obscured', file, 1, [{ type: 'element', selector: 'a', data }]);

describe('button-implicit-submit fixer', () => {
  it('types the right JSX button, even when handlers contain => and >', () => {
    const tsx = `export function Form() {
  return (
    <form onSubmit={save}>
      <button onClick={() => setShown((s) => !s)} aria-pressed={shown}>
        Show password
      </button>
      <button disabled={a > b}>Cancel</button>
    </form>
  );
}
`;
    const root = repo({ 'src/Form.tsx': tsx });
    const [plan] = planFixes([buttonFinding('src/Form.tsx', 'Show password', '<button>Show password')], root);
    expect(plan!.edits[0]!.after).toBe(tsx.replace('<button onClick', '<button type="button" onClick'));
  });

  it('leaves a button that already has a type, and is idempotent', () => {
    const html = '<form><button type="button">Show password</button></form>\n';
    const root = repo({ 'a.html': html });
    expect(planFixes([buttonFinding('a.html', 'Show password', '<button>Show password')], root)).toEqual([]);
  });

  it('does not guess between two identical buttons', () => {
    const html = '<form>\n<button>Toggle</button>\n<hr>\n<button>Toggle</button>\n</form>\n';
    const root = repo({ 'a.html': html });
    const f = buttonFinding('a.html', 'Toggle', '<button>Toggle');
    f.sources![0]!.line = 3;
    expect(planFixes([f], root)).toEqual([]);
  });
});

describe('submit vocabulary', () => {
  it.each(['Sign in', 'Log in', 'Giriş yap', 'Anmelden', 'Se connecter', 'Send message'])(
    '%s is a submit word',
    (n) => expect(lexicon('submit').test(n)).toBe(true),
  );
  it.each(['Show password', 'Parolayı göster', 'Close', 'Passwort anzeigen'])('%s is not', (n) =>
    expect(lexicon('submit').test(n)).toBe(false),
  );
});

describe('scroll-padding fixer', () => {
  const sticky = { coverPosition: 'sticky', coverTop: 0, coverHeight: 56 };

  it('updates an existing scroll-padding-top on html', () => {
    const css =
      'html {\n  scroll-behavior: smooth;\n  scroll-padding-top: 10px;\n}\n.bar { position: sticky; }\n';
    const root = repo({ 'a.css': css });
    const [plan] = planFixes([barFinding('a.css', sticky)], root);
    expect(plan!.edits[0]!.after).toBe(css.replace('10px', '56px'));
  });

  it('adds the declaration to an existing html rule', () => {
    const css = 'html {\n  scroll-behavior: smooth\n}\n';
    const root = repo({ 'a.css': css });
    const [plan] = planFixes([barFinding('a.css', { ...sticky, coverPosition: 'fixed' })], root);
    expect(plan!.edits[0]!.after).toBe(
      'html {\n  scroll-behavior: smooth;\n  scroll-padding-top: 56px;\n}\n',
    );
  });

  it('is idempotent once the value is there', () => {
    const root = repo({ 'a.css': 'html { scroll-padding-top: 56px; }\n' });
    expect(planFixes([barFinding('a.css', sticky)], root)).toEqual([]);
  });

  it('falls back to the global stylesheet when no stylesheet was located', () => {
    const root = repo({ 'index.html': '<div></div>', 'src/app/globals.css': 'body { margin: 0; }\n' });
    const [plan] = planFixes([barFinding('index.html', sticky)], root);
    expect(plan!.edits[0]!.file).toBe('src/app/globals.css');
    expect(plan!.edits[0]!.after).toBe('body { margin: 0; }\n\nhtml {\n  scroll-padding-top: 56px;\n}\n');
  });

  it('does nothing for a cover that is not a bar at the top', () => {
    const root = repo({ 'a.css': 'body {}\n' });
    expect(
      planFixes([barFinding('a.css', { coverPosition: 'absolute', coverTop: 0, coverHeight: 56 })], root),
    ).toEqual([]);
    expect(
      planFixes([barFinding('a.css', { coverPosition: 'fixed', coverTop: 600, coverHeight: 56 })], root),
    ).toEqual([]);
  });
});

describe('scroll-padding fixer: where it writes', () => {
  const sticky = { coverPosition: 'sticky', coverTop: 0, coverHeight: 56 };

  it('never writes into a CSS module, even when it is the located stylesheet', () => {
    const root = repo({ 'src/Header.module.css': '.bar { position: sticky; }\n', 'styles.css': 'body {}\n' });
    const [plan] = planFixes([barFinding('src/Header.module.css', sticky)], root);
    expect(plan!.edits[0]!.file).toBe('styles.css');
  });

  it('ignores scoped html rules and html inside @media', () => {
    const css =
      '.dark html { color: #fff; }\n@media (min-width: 40em) {\n  html { scroll-padding-top: 99px; }\n}\n';
    const root = repo({ 'a.css': css });
    const [plan] = planFixes([barFinding('a.css', sticky)], root);
    expect(plan!.edits[0]!.after).toBe(`${css}\nhtml {\n  scroll-padding-top: 56px;\n}\n`);
  });

  it('finds the top-level html rule after other rules', () => {
    const css = '.a { color: red; }\nhtml { scroll-padding-top: 10px; }\n';
    const root = repo({ 'a.css': css });
    const [plan] = planFixes([barFinding('a.css', sticky)], root);
    expect(plan!.edits[0]!.after).toBe(css.replace('10px', '56px'));
  });
});
