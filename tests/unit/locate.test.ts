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

describe('state CSS rules', () => {
  const stateRepo = (css: string) => {
    const root = mkdtempSync(join(tmpdir(), 'jourilo-state-'));
    mkdirSync(join(root, 'app'), { recursive: true });
    const pad = Array.from({ length: 35 }, (_, i) => `  // line ${i + 2}`).join('\n');
    writeFileSync(
      join(root, 'app/page.tsx'),
      `export default function P() {\n${pad}\n  return <button className="tool" aria-pressed={on}>Go</button>;\n}\n`,
    );
    writeFileSync(join(root, 'app/globals.css'), css);
    return indexRepository(root);
  };
  const evidence = [
    {
      type: 'element' as const,
      selector: 'main > .tool:nth-of-type(2)',
      snippet: '<button class="tool" aria-pressed="true">',
    },
  ];
  it('locates a focus-visible finding in the state CSS rule that removes the outline', () => {
    const files = stateRepo('.tool[aria-pressed="true"] { outline: none; }\n');
    const src = locate(finding('jourilo/focus-visible', '/', evidence), files);
    expect(src[0]).toMatchObject({ file: 'app/globals.css', confidence: 'high' });
  });
  it('locates a focus-visible finding in a state rule that does not use outline: none', () => {
    const files = stateRepo('.tool[aria-pressed="true"] {\n  outline-color: transparent;\n}\n');
    const src = locate(finding('jourilo/focus-visible', '/', evidence), files);
    expect(src[0]).toMatchObject({ file: 'app/globals.css', line: 1, confidence: 'high' });
  });
  it('does not take a state rule of a longer class name (.tool-bar) for .tool', () => {
    const files = stateRepo('.tool-bar[aria-pressed="true"] {\n  outline-color: transparent;\n}\n');
    const src = locate(finding('jourilo/focus-visible', '/', evidence), files);
    expect(src.filter((s) => s.file === 'app/globals.css')).toEqual([]);
  });
  it('locates a contrast finding in a pressed-state rule', () => {
    const files = stateRepo('.tool[aria-pressed="true"]{color:#999}\n');
    const src = locate(finding('axe/color-contrast', '/', evidence), files);
    expect(src[0]).toMatchObject({ file: 'app/globals.css', confidence: 'high' });
  });
  it('locates a sampled contrast-over-image finding in a state rule like other contrast findings', () => {
    const files = stateRepo('.tool[aria-pressed="true"]{color:#fff;background:url(/sky.jpg)}\n');
    const src = locate(finding('jourilo/contrast-over-image', '/', evidence), files);
    expect(src[0]).toMatchObject({ file: 'app/globals.css', confidence: 'high' });
  });
  // Field case (cihanca.com a49b46a): the keyboard walk's selector has no class; only the element's markup
  // names the class and the pressed state, and the state rule sets an outline instead of removing it.
  it('finds a pressed-state outline rule from the markup of a class-less keyboard selector', () => {
    const root = mkdtempSync(join(tmpdir(), 'jourilo-field-'));
    mkdirSync(join(root, 'app'), { recursive: true });
    mkdirSync(join(root, 'components'), { recursive: true });
    const lines = (n: number, f: (i: number) => string) =>
      Array.from({ length: n }, (_, i) => f(i)).join('\n');
    writeFileSync(
      join(root, 'app/page.tsx'),
      `${lines(35, (i) => `// line ${i + 1}`)}\n      <ShopSection\n        id="hirdavat"\n        sign="AÇIK KAYNAK HIRDAVAT"\n      />\n`,
    );
    writeFileSync(
      join(root, 'components/HardwareShop.tsx'),
      '<div className="peg" role="group" aria-label="Aletler">\n  <button type="button" className="tool" aria-pressed={k === picked}>\n',
    );
    writeFileSync(
      join(root, 'app/globals.css'),
      `${lines(39, (i) => `.r${i} { color: #111; }`)}\n:focus-visible { outline: 3px solid var(--lamp); outline-offset: 3px; }\n${lines(310, (i) => `.s${i} { margin: 0; }`)}\n.tool[aria-pressed="true"] { outline: 3px solid var(--tint); outline-offset: 3px; }\n`,
    );
    const files = indexRepository(root);
    // The bare tag, and the tag followed by the visible name as the keyboard walk records it.
    for (const snippet of [
      '<button class="tool" aria-pressed="true">',
      '<button class="tool" aria-pressed="true">bedava Jourilo v1.1.0',
    ]) {
      const src = locate(
        finding('jourilo/focus-visible', '/', [
          {
            type: 'element',
            selector: '#hirdavat > div > div > div:nth-of-type(1) > button:nth-of-type(2)',
            snippet,
            note: 'Tab stop #39',
          },
        ]),
        files,
      );
      expect(src[0]).toMatchObject({ file: 'app/globals.css', line: 351, confidence: 'high' });
    }
  });
});

describe('design tokens and documentation', () => {
  it('maps color utilities to their token definitions and ignores docs', () => {
    const root = mkdtempSync(join(tmpdir(), 'jourilo-tw-'));
    mkdirSync(join(root, 'app'), { recursive: true });
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(
      join(root, 'app/globals.css'),
      '@theme {\n  --color-mark: var(--mark);\n}\n:root {\n  --mark: #275d42;\n}\n',
    );
    writeFileSync(
      join(root, 'app/page.tsx'),
      'export default () => <p className="t-meta text-mark">02</p>;\n',
    );
    writeFileSync(join(root, 'docs/plan.md'), 'The t-meta text-mark label shows "02".\n');
    writeFileSync(join(root, 'README.md'), 'text-mark\n');
    const files = indexRepository(root);
    expect(files.map((f) => f.rel).sort()).toEqual(['app/globals.css', 'app/page.tsx']);
    const src = locate(
      finding('axe/color-contrast', '/', [
        {
          type: 'element',
          selector: '.text-mark',
          snippet: '<p class="t-meta text-mark">02</p>',
          data: { fgColor: '#275d42' },
        },
      ]),
      files,
    );
    expect(src[0]).toMatchObject({ file: 'app/globals.css', confidence: 'high' });
    expect(src.map((s) => s.line)).toEqual(expect.arrayContaining([2, 5]));
  });
});

describe('selector parsing', () => {
  it('ignores attribute-selector values and unescapes utility classes', async () => {
    const { tokensFor } = await import('../../src/repair/locate.js');
    const t = tokensFor(
      finding('x', '/', [
        { type: 'element', selector: '.hover\\:text-fg.text-\\[0\\.95rem\\][href$="#ovokodo"] > .link-draw' },
      ]),
    );
    const reasons = t.map((x) => x.reason);
    expect(reasons).not.toContain('id "ovokodo"');
    expect(reasons).toEqual(
      expect.arrayContaining(['class "hover:text-fg"', 'class "text-[0.95rem]"', 'class "link-draw"']),
    );
  });
});
