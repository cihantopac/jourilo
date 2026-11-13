import { describe, expect, it } from 'vitest';
import { componentIndex } from '../../src/discovery/ast/components.js';
import { parseSource } from '../../src/discovery/ast/parser.js';

const index = (files: Record<string, string>) => {
  const parsed = new Map<string, NonNullable<ReturnType<typeof parseSource>>>();
  for (const [file, text] of Object.entries(files)) {
    const sf = parseSource(file, text);
    if (sf) parsed.set(file, sf);
  }
  return componentIndex(parsed, new Map(Object.entries(files)));
};

// A Next.js app router project as it is laid out in the field: an @/ alias to src/, a shared header and footer,
// and a page-only table.
const nextApp = {
  'src/components/Header.tsx': `import Link from 'next/link';
import { NavLink } from './NavLink';

export function Header() {
  return (
    <header className="border-b">
      <Link href="/" className="font-semibold">Acme</Link>
      <nav>
        <NavLink href="/pricing">Pricing</NavLink>
        <NavLink href="/about">About</NavLink>
      </nav>
    </header>
  );
}
`,
  'src/components/NavLink.tsx': `export const NavLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} className="text-gray-400 hover:text-gray-900">{children}</a>
);
`,
  'src/components/index.ts': `export * from './Header';\n`,
  'src/app/page.tsx': `import { Header } from '@/components/Header';
export default function Home() {
  return (<><Header /><main>Home</main></>);
}
`,
  'src/app/pricing/page.tsx': `import { Header } from '@/components';
function PricingTable() {
  return <table className="pricing"><tbody><tr><td>Pro</td></tr></tbody></table>;
}
export default function Pricing() {
  return (<><Header /><PricingTable /></>);
}
`,
  'src/app/about/page.tsx': `import { Header } from '../../components/Header';
// <Footer /> is only mentioned in this comment.
export default function About() {
  return (<><Header /><p>{'<Footer />'}</p></>);
}
`,
};

describe('component graph', () => {
  it('a Header used by three routes is one component with usedBy 3', () => {
    const idx = index(nextApp);
    const header = idx.components.get('src/components/Header.tsx#Header');
    expect(header).toMatchObject({ name: 'Header', line: 4, exported: true, usedBy: 3 });
    expect(header?.renders).toEqual(['src/components/NavLink.tsx#NavLink']);
    // Through the header, its links are on the same three routes.
    expect(idx.components.get('src/components/NavLink.tsx#NavLink')?.usedBy).toBe(3);
    expect(idx.components.get('src/app/pricing/page.tsx#PricingTable')?.usedBy).toBe(1);
    expect(idx.components.get('src/app/pricing/page.tsx#Pricing')?.renders.sort()).toEqual([
      'src/app/pricing/page.tsx#PricingTable',
      'src/components/Header.tsx#Header',
    ]);
    expect(idx.failed).toEqual([]);
  });

  it('a header around React Router <Routes> is on every route; a route component is on its own route', () => {
    const idx = index({
      'src/App.tsx': `import { Routes, Route } from 'react-router-dom';
import SiteHeader from './SiteHeader';
import { Home } from './pages/Home';
import { Docs } from './pages/Docs';
export default function App() {
  return (
    <>
      <SiteHeader />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/docs" element={<Docs />} />
      </Routes>
    </>
  );
}
`,
      'src/SiteHeader.tsx': `export default function SiteHeader() { return <header>Acme</header>; }\n`,
      'src/pages/Home.tsx': `export const Home = () => <main>Home</main>;\n`,
      'src/pages/Docs.tsx': `export const Docs = () => <main>Docs</main>;\n`,
    });
    expect(idx.components.get('src/SiteHeader.tsx#SiteHeader')?.usedBy).toBe(2);
    expect(idx.components.get('src/pages/Home.tsx#Home')?.usedBy).toBe(1);
  });

  it('a Vue component counts only the imported components its template uses', () => {
    const idx = index({
      'src/router/index.ts': `import { createRouter } from 'vue-router';
export default createRouter({ routes: [
  { path: '/', component: () => import('../views/HomeView.vue') },
  { path: '/team', component: () => import('../views/TeamView.vue') },
] });
`,
      'src/views/HomeView.vue': `<script setup lang="ts">
import AppBanner from '../components/AppBanner.vue';
import UnusedCard from '../components/UnusedCard.vue';
</script>
<template><app-banner /><main>Home</main></template>
`,
      'src/views/TeamView.vue': `<script setup lang="ts">
import AppBanner from '../components/AppBanner.vue';
</script>
<template><AppBanner/><main>Team</main></template>
`,
      'src/components/AppBanner.vue': `<template><div class="banner">Sale</div></template>\n`,
      'src/components/UnusedCard.vue': `<template><div class="card" /></template>\n`,
    });
    expect(idx.components.get('src/components/AppBanner.vue#AppBanner')).toMatchObject({
      line: 1,
      usedBy: 2,
    });
    expect(idx.components.get('src/components/UnusedCard.vue#UnusedCard')?.usedBy).toBe(0);
  });

  it('never fails on a file it cannot read: that file is listed, the rest is indexed', () => {
    const parsed = new Map<string, NonNullable<ReturnType<typeof parseSource>>>();
    parsed.set('src/ok.tsx', parseSource('src/ok.tsx', 'export const Ok = () => <b />;\n')!);
    // A syntax tree whose statements throw when read stands for a file the walk cannot handle.
    const broken = parseSource('src/broken.tsx', 'export const B = () => <i />;\n')!;
    Object.defineProperty(broken, 'statements', {
      get() {
        throw new Error('boom');
      },
    });
    parsed.set('src/broken.tsx', broken);
    const idx = componentIndex(parsed);
    expect(idx.failed).toEqual(['src/broken.tsx']);
    expect(idx.components.has('src/ok.tsx#Ok')).toBe(true);
  });
});
