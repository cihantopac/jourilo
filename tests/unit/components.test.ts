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

  it('a navigation array with paths is not a route: Next pages router keeps Header on 3 routes, Promo on 1', () => {
    const idx = index({
      // Field shape: a nav with path-shaped links in a file that imports useRouter from next/router.
      'components/Nav.tsx': `import { useRouter } from 'next/router';
const links = [
  { path: '/a', label: 'A' },
  { path: '/b', label: 'B' },
];
export function Nav() {
  const router = useRouter();
  return <nav>{links.map((l) => <a key={l.path} href={l.path} aria-current={router.pathname === l.path}>{l.label}</a>)}</nav>;
}
`,
      // A path-named config file with plain records is not a router either, and must not turn off pages/.
      'lib/routes.ts': `export const routes = [{ path: '/a' }, { path: '/b' }];\n`,
      'components/Header.tsx': `import { Nav } from './Nav';\nexport function Header() { return <header><Nav /></header>; }\n`,
      'components/Promo.tsx': `export function Promo() { return <aside>Save 20%</aside>; }\n`,
      'pages/index.tsx': `import { Header } from '../components/Header';\nexport default function Home() { return <><Header /><main /></>; }\n`,
      'pages/pricing.tsx': `import { Header } from '../components/Header';
import { Promo } from '../components/Promo';
export default function Pricing() { return <><Header /><Promo /></>; }
`,
      'pages/about.tsx': `import { Header } from '../components/Header';\nexport default function About() { return <><Header /><main /></>; }\n`,
    });
    expect(idx.components.get('components/Header.tsx#Header')?.usedBy).toBe(3);
    expect(idx.components.get('components/Nav.tsx#Nav')?.usedBy).toBe(3);
    expect(idx.components.get('components/Promo.tsx#Promo')?.usedBy).toBe(1);
  });

  it('settings tabs with paths in an app-router page are on that page only', () => {
    const idx = index({
      'src/app/layout.tsx': `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
`,
      'src/app/page.tsx': `export default function Home() { return <main>Home</main>; }\n`,
      'src/app/settings/page.tsx': `import { SettingsTabs } from './SettingsTabs';
export default function Settings() { return <SettingsTabs />; }
`,
      'src/app/settings/SettingsTabs.tsx': `'use client';
import { useRouter } from 'next/navigation';
const tabs = [
  { path: '/settings/profile', label: 'Profile' },
  { path: '/settings/billing', label: 'Billing' },
  { path: '/settings/team', label: 'Team' },
];
export function SettingsTabs() {
  const router = useRouter();
  return <div role="tablist">{tabs.map((t) => <button key={t.path} role="tab" onClick={() => router.push(t.path)}>{t.label}</button>)}</div>;
}
`,
    });
    expect(idx.components.get('src/app/settings/SettingsTabs.tsx#SettingsTabs')?.usedBy).toBe(1);
    expect(idx.components.get('src/app/layout.tsx#RootLayout')?.usedBy).toBe(2);
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
