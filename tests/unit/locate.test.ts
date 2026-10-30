import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeFinding } from '../../src/audit/finding.js';
import { indexRepository, locate, routeFiles } from '../../src/repair/locate.js';

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'jourilo-repo-'));
  mkdirSync(join(root, 'src/app/pricing'), { recursive: true });
  mkdirSync(join(root, 'src/components'), { recursive: true });
  mkdirSync(join(root, 'node_modules/lib'), { recursive: true });
  writeFileSync(join(root, 'src/app/layout.tsx'), '<html>\n<body>{children}</body>\n</html>\n');
  writeFileSync(
    join(root, 'src/app/pricing/page.tsx'),
    'export default function P() {\n  return <a href="/signup" className="cta">Start free</a>;\n}\n',
  );
  writeFileSync(
    join(root, 'src/components/Hero.tsx'),
    'export const Hero = () => (\n  <form id="signup">\n    <input name="email" />\n  </form>\n);\n',
  );
  writeFileSync(
    join(root, 'src/app/globals.css'),
    '.cta { color: #b5b5b5; }\nbutton:focus { outline: none; }\n',
  );
  writeFileSync(join(root, 'node_modules/lib/x.js'), 'outline: none; id="signup"');
  return root;
}

const finding = (ruleId: string, path: string, evidence: Parameters<typeof makeFinding>[0]['evidence']) =>
  makeFinding({
    ruleId,
    title: 't',
    category: 'accessibility',
    kind: 'defect',
    severity: 'serious',
    confidence: 'high',
    provenance: 'measured',
    url: `http://localhost:3000${path}`,
    description: '',
    impact: '',
    recommendation: '',
    standards: [],
    evidence,
  });

describe('source location', () => {
  const files = indexRepository(repo());
  it('skips dependencies and build output', () => {
    expect(files.some((f) => f.rel.includes('node_modules'))).toBe(false);
  });
  it('maps routes to file-based router files', () => {
    const r = routeFiles('http://localhost:3000/pricing', files);
    expect(r.has('src/app/pricing/page.tsx')).toBe(true);
    expect(r.has('src/app/layout.tsx')).toBe(true);
    expect(r.has('src/components/Hero.tsx')).toBe(false);
  });
  it('finds ids by attribute, not by look-alike hrefs', () => {
    const src = locate(
      finding('jourilo/input-purpose', '/', [{ type: 'element', selector: '#signup > input' }]),
      files,
    );
    expect(src[0]!.file).toBe('src/components/Hero.tsx');
    expect(src[0]!.line).toBe(2);
  });
  it('puts the CSS root cause first for focus and contrast problems', () => {
    const focus = locate(
      finding('jourilo/focus-visible', '/pricing', [
        { type: 'element', selector: 'a.cta', snippet: 'Start free' },
      ]),
      files,
    );
    expect(focus[0]).toMatchObject({ file: 'src/app/globals.css', line: 2, confidence: 'high' });
    const contrast = locate(
      finding('axe/color-contrast', '/pricing', [
        { type: 'element', selector: '.cta', data: { fgColor: '#b5b5b5' } },
      ]),
      files,
    );
    expect(contrast[0]).toMatchObject({ file: 'src/app/globals.css', line: 1 });
  });
});
