import { describe, expect, it } from 'vitest';
import { astRoutes, parseSource, scriptBlocks } from '../../src/discovery/ast/parser.js';

const routes = (file: string, text: string) => {
  const sf = parseSource(file, text);
  if (!sf) throw new Error(`${file} did not parse`);
  return astRoutes(file, sf);
};
const paths = (file: string, text: string) => routes(file, text).map((r) => r.path);

describe('AST route discovery', () => {
  it('joins nested React Router route objects: /settings/profile', () => {
    const src = `import { createBrowserRouter } from 'react-router-dom';
export const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  {
    path: '/settings',
    element: <Settings />,
    children: [
      { index: true, element: <SettingsHome /> },
      { path: 'profile', element: <Profile /> },
      { path: 'billing/:plan', lazy: () => import('./Billing') },
    ],
  },
]);`;
    const r = routes('src/main.tsx', src);
    expect(r.map((x) => x.path)).toEqual(['/', '/settings', '/settings/profile', '/settings/billing/:plan']);
    expect(r.find((x) => x.path === '/settings/profile')).toMatchObject({ component: 'Profile', line: 9 });
  });

  it('joins nested <Route> JSX: <Route path="/a"><Route path="b"/></Route> gives /a/b', () => {
    const src = `export const App = () => (
  <Routes>
    <Route path="/a" element={<A />}>
      <Route path="b" element={<B />} />
      <Route index element={<AIndex />} />
    </Route>
    <Route element={<Layout />}>
      <Route path={'/c'} element={<C />} />
    </Route>
  </Routes>
);`;
    expect(paths('src/App.tsx', src)).toEqual(['/a', '/a/b', '/c']);
  });

  it('reads Vue Router records with nested children', () => {
    const src = `import { createRouter, createWebHistory } from 'vue-router';
const routes = [
  { path: '/', component: Home },
  {
    path: '/account',
    component: () => import('../views/Account.vue'),
    children: [
      { path: '', component: AccountHome },
      { path: 'orders', component: Orders },
      { path: 'orders/:id', component: Order },
    ],
  },
  { path: '/:pathMatch(.*)*', component: NotFound },
];
export default createRouter({ history: createWebHistory(), routes });`;
    const r = routes('src/router/index.ts', src);
    expect(r.map((x) => x.path)).toEqual(
      expect.arrayContaining(['/', '/account', '/account/orders', '/account/orders/:id']),
    );
    expect(r.find((x) => x.path === '/account')!.component).toBe('../views/Account.vue');
  });

  it('reads TanStack Router createRoute() with parents', () => {
    const src = `import { createRootRoute, createRoute } from '@tanstack/react-router';
const rootRoute = createRootRoute({ component: Root });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Index });
const postsRoute = createRoute({ getParentRoute: () => rootRoute, path: 'posts', component: Posts });
const postRoute = createRoute({ getParentRoute: () => postsRoute, path: '$postId', component: Post });`;
    expect(paths('src/routes.tsx', src)).toEqual(['/', '/posts', '/posts/:postId']);
  });

  it('does not report a route inside a comment or a string (the regexes do)', () => {
    const src = `// Old router, kept for reference: <Route path="/legacy" element={<Legacy />} />
/* const routes = [{ path: '/commented-out' }]; */
const help = "Add { path: '/in-a-string' } to the router";
const tpl = \`<Route path="/in-a-template" />\`;
export const App = () => <Routes><Route path="/real" element={<Real />} /></Routes>;`;
    expect(paths('src/router.tsx', src)).toEqual(['/real']);
    // Control: the regex table finds the comment and string routes in this same source.
    expect([...src.matchAll(/<Route\s[^>]*path=["'`]([^"'`]+)["'`]/g)].map((m) => m[1])).toContain('/legacy');
  });

  it('parses a .vue component\'s <script setup lang="ts">', () => {
    const src = `<template>
  <RouterView />
</template>

<script setup lang="ts">
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
const routes: RouteRecordRaw[] = [
  { path: '/shop', component: Shop, children: [{ path: 'item/:id', component: Item }] },
];
const router = createRouter({ history: createWebHistory(), routes });
</script>

<style scoped>
.a { color: red; }
</style>`;
    expect(scriptBlocks(src).lang).toBe('ts');
    const r = routes('src/App.vue', src);
    expect(r.map((x) => x.path)).toEqual(['/shop', '/shop/item/:id']);
    expect(r[0]!.line).toBe(8);
  });

  it('parses a .svelte component script', () => {
    const src = `<script lang="ts">
  const router = createRouter({ routes: [{ path: '/inbox', component: Inbox }] });
</script>
<main>{#if ok}<p>{ path: '/not-a-route' }</p>{/if}</main>`;
    expect(paths('src/Router.svelte', src)).toEqual(['/inbox']);
  });

  it('reads relative Angular-style records, but not other objects with a relative path', () => {
    const src = `export const routes: Routes = [
  { path: 'heroes', component: HeroesComponent },
  { path: '', redirectTo: '/heroes', pathMatch: 'full' },
  { 'path': 'villains', 'loadComponent': () => import('./villains') },
];
export const seed = { path: 'data/seed.json', encoding: 'utf8' };`;
    expect(paths('src/app/app.routes.ts', src)).toEqual(['/heroes', '/villains']);
  });

  it('skips records that only redirect', () => {
    const src = `const routes = [
  { path: '/old', redirect: '/new' },
  { path: '/new', component: New },
  { path: '/docs', redirect: '/docs/intro', children: [{ path: 'intro', component: Intro }] },
];`;
    expect(paths('src/router/index.ts', src)).toEqual(['/new', '/docs', '/docs/intro']);
  });

  it('walks code nested far deeper than the call stack allows', () => {
    // A minifier's comma sequence is one left-nested binary expression: 20,000 terms overflow a recursive walk.
    const terms = Array.from({ length: 20_000 }, (_, i) => `a${i}()`).join(',\n');
    const src = `const routes = [{ path: '/deep', component: Deep }];\nx = (${terms});\n`;
    expect(paths('src/router.ts', src)).toEqual(['/deep']);
  });

  it('returns null for a broken file', () => {
    expect(parseSource('src/router.ts', "const routes = [{ path: '/a' ,, ];\nexport default {")).toBeNull();
    expect(
      parseSource('src/App.tsx', 'export const App = () => <Routes><Route path="/x"></Routes>;'),
    ).toBeNull();
    expect(parseSource('README.md', '# routes')).toBeNull();
  });
});
