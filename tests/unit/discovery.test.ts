import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { loadTsParser } from '../../src/discovery/ast/load.js';
import { laravelProfile } from '../../src/discovery/laravel.js';
import { discoverRepository, roleOf } from '../../src/discovery/repo.js';

// Passthrough spy: discovery behaves as before, and tests can see whether the parser chunk was requested.
vi.mock('../../src/discovery/ast/load.js', async (original) => {
  const m = await original<typeof import('../../src/discovery/ast/load.js')>();
  return { ...m, loadTsParser: vi.fn(m.loadTsParser) };
});

const repo = (name: string) => discoverRepository(join(import.meta.dirname, '../../fixtures/repos', name));
const paths = (p: Awaited<ReturnType<typeof repo>>) =>
  p.apps.flatMap((a) => a.routes.filter((r) => r.kind === 'page').map((r) => r.path));

describe('repository discovery', () => {
  it('reads a Next.js App Router SaaS', async () => {
    const p = await repo('next-saas');
    expect(p.apps[0]!.frameworks.map((f) => f.value)).toEqual(expect.arrayContaining(['Next.js', 'React']));
    expect(paths(p)).toEqual(
      expect.arrayContaining([
        '/',
        '/pricing',
        '/sign-up',
        '/login',
        '/dashboard/:projectId',
        '/settings/billing',
      ]),
    );
    expect(p.apps[0]!.routes.find((r) => r.path === '/api/events')!.kind).toBe('api');
    expect(p.apps[0]!.devCommand).toMatchObject({ command: 'npm', args: ['run', 'dev'], port: 3100 });
    expect(p.auth.map((f) => f.value)).toContain('next-auth');
    expect(p.payments.map((f) => f.value)).toContain('stripe');
    expect(p.analytics.map((f) => f.value)).toContain('posthog-js');
    expect(p.i18n.locales).toEqual(['de', 'en']);
    expect(p.designSystem.fonts.map((f) => f.value)).toContain('Inter');
    expect(p.designSystem.cssVariables).toBe(2);
    expect(p.roles.map((r) => r.value)).toEqual(
      expect.arrayContaining(['visitor', 'signed-in user', 'owner']),
    );
    expect(p.readmeSummary!.value).toMatch(/privacy-friendly product analytics/);
    expect(p.candidateJourneys.map((j) => j.name)).toEqual(
      expect.arrayContaining(['Sign up and reach the product', 'Compare plans and start checkout']),
    );
    expect(p.description!.source).toBe('package.json');
  });
  it('reads Vue Router routes and locales', async () => {
    const p = await repo('vue-shop');
    expect(paths(p)).toEqual(expect.arrayContaining(['/', '/products/:id', '/cart', '/checkout', '/search']));
    expect(p.i18n.locales).toEqual(['en', 'tr']);
  });
  it('reads Laravel routes, auth and billing packages', async () => {
    const p = await repo('laravel-app');
    expect(p.apps[0]!.frameworks.map((f) => f.value)).toContain('Laravel');
    expect(paths(p)).toEqual(expect.arrayContaining(['/', '/pricing', '/register', '/admin/users/:user']));
    expect(p.auth.map((f) => f.value)).toContain('laravel/breeze');
    expect(p.payments.map((f) => f.value)).toContain('laravel/cashier');
    expect(p.apps[0]!.devCommand).toMatchObject({ command: 'php', port: 8000 });
    expect(p.roles.map((r) => r.value)).toContain('admin');
    expect(p.i18n.locales).toEqual(['en', 'fr']);
  });
  it('reads Flutter web go_router routes', async () => {
    const p = await repo('flutter-web');
    expect(p.apps[0]!.frameworks.map((f) => f.value)).toEqual(
      expect.arrayContaining(['Flutter (web enabled)', 'go_router']),
    );
    expect(paths(p)).toEqual(expect.arrayContaining(['/', '/onboarding', '/settings']));
    expect(p.i18n.locales).toEqual(['en', 'es']);
  });
  it('reads Astro file routes including rest params', async () => {
    expect(paths(await repo('astro-docs'))).toEqual(expect.arrayContaining(['/', '/docs/:slug', '/contact']));
  });
  it('splits a monorepo into apps and ignores libraries', async () => {
    const p = await repo('monorepo');
    expect(p.monorepo?.source).toBe('pnpm-workspace.yaml');
    expect(p.apps.map((a) => a.root).sort()).toEqual(['apps/admin', 'apps/web']);
    const admin = p.apps.find((a) => a.root === 'apps/admin')!;
    expect(admin.routes.map((r) => r.path)).toEqual(['/', '/users']);
    expect(admin.devCommand?.port).toBe(5200);
  });
  it('classifies route roles', () => {
    expect(roleOf('/pricing')).toBe('pricing');
    expect(roleOf('/settings/billing')).toBe('settings');
    expect(roleOf('/account/cancel')).toBe('cancellation');
  });
});

describe('Laravel discovery on a realistic layout', () => {
  const root = join(import.meta.dirname, '../../fixtures/repos/laravel-portal');
  it('follows included route files, groups and prefixes, and Livewire/Inertia/Filament pages', () => {
    const lp = laravelProfile(root);
    const paths = lp.routes.map((r) => r.path).sort();
    expect(paths).toEqual(
      [
        '/',
        '/about',
        '/admin',
        '/admin/categories',
        '/admin/clients',
        '/admin/login',
        '/admin/orders',
        '/admin/review-queue',
        '/cart',
        '/help',
        '/help/articles/:slug',
        '/members',
        '/members/dashboard',
        '/members/login',
        '/members/reset-password/:token',
        '/members/settings',
        '/products',
        '/products/:product',
      ].sort(),
    );
    // Not pages: POST/DELETE endpoints, redirects, API routes, commented-out code.
    for (const p of [
      '/help/feedback',
      '/members/account',
      '/members/giris',
      '/v1/catalog',
      '/commented-out',
      '/old',
    ])
      expect(paths, p).not.toContain(p);
    const byPath = new Map(lp.routes.map((r) => [r.path, r]));
    expect(byPath.get('/members/dashboard')).toMatchObject({ via: 'Livewire', file: 'routes/members.php' });
    expect(byPath.get('/members/dashboard')!.auth).toEqual(['members.auth', 'verified']);
    expect(byPath.get('/members/login')!.auth).toEqual([]);
    expect(byPath.get('/cart')).toMatchObject({ via: 'Inertia', file: 'routes/shop.php' });
    expect(byPath.get('/admin/orders')).toMatchObject({
      via: 'Filament',
      file: 'app/Filament/Resources/OrderResource.php',
    });
    // Filament 4 nests resources in their own folder; a $slug property overrides the derived segment.
    expect(byPath.get('/admin/clients')!.file).toBe('app/Filament/Resources/Customers/CustomerResource.php');
    expect(paths).not.toContain('/admin/has-queue');
    expect(lp.guards).toEqual(['web', 'members']);
    expect(lp.panels).toEqual([
      { id: 'admin', path: '/admin', login: true, file: 'app/Providers/Filament/AdminPanelProvider.php' },
    ]);
  });

  it('reports auth and roles in the product profile', async () => {
    const p = await discoverRepository(root);
    const auth = p.auth.map((f) => f.value).join(' | ');
    expect(auth).toContain('Laravel guards: web, members');
    expect(auth).toContain('Filament panel "admin" with login at /admin/login');
    expect(auth).toMatch(/route\(s\) behind members\.auth, verified/);
    expect(p.roles.map((r) => r.value)).toEqual(
      expect.arrayContaining(['visitor', 'members', 'admin panel user']),
    );
    expect(p.i18n.locales.sort()).toEqual(['en', 'tr']);
    expect(p.apps[0]!.routes.find((r) => r.path === '/members/login')?.role).toBe('login');
    // No registration route: no sign-up journey, even though a dashboard exists (found by the plugin run).
    expect(p.candidateJourneys.map((j) => j.name)).not.toContain('Sign up and reach the product');
    expect(p.candidateJourneys.map((j) => j.name)).toContain('Sign in');
  });
});

describe('route discovery with the bundled parser', () => {
  const tmpRoot = join(import.meta.dirname, '../.tmp');
  mkdirSync(tmpRoot, { recursive: true });
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  /** A small React Router app written to a temporary directory. */
  const reactApp = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpRoot, 'ast-repo-'));
    dirs.push(root);
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'spa', dependencies: { react: '19.0.0', 'react-router-dom': '7.0.0' } }),
    );
    for (const [f, text] of Object.entries(files)) {
      mkdirSync(join(root, f, '..'), { recursive: true });
      writeFileSync(join(root, f), text);
    }
    return root;
  };
  const pagePaths = (p: Awaited<ReturnType<typeof discoverRepository>>) =>
    p.apps.flatMap((a) => a.routes.map((r) => r.path)).sort();

  it('joins nested routes and skips commented-out ones', async () => {
    const root = reactApp({
      'src/router.tsx': `import { createBrowserRouter } from 'react-router-dom';
// <Route path="/old-checkout" element={<Old />} />
export const router = createBrowserRouter([
  { path: '/settings', element: <Settings />, children: [{ path: 'profile', element: <Profile /> }] },
]);`,
    });
    const p = await discoverRepository(root);
    expect(pagePaths(p)).toEqual(['/settings', '/settings/profile']);
    expect(p.limitations).toEqual([]);
  });

  it('falls back to the regexes for a file the parser cannot read, and says so', async () => {
    const root = reactApp({
      'src/App.tsx': `export const App = () => (
  <Routes>
    <Route path="/pricing" element={<Pricing />} />
    <Route path="/signup" element={<Signup />}>
  </Routes>
);`,
      'src/router.ts': "export const routes = [{ path: '/ok' }];",
    });
    const p = await discoverRepository(root);
    expect(pagePaths(p)).toEqual(['/ok', '/pricing', '/signup']);
    expect(p.limitations).toEqual([
      '1 code file(s) were read with the regex fallback instead of the bundled TypeScript parser (broken or newer syntax, minified code, or code it could not walk), so their routes can include ones in comments or strings: src/App.tsx.',
    ]);
  });

  it('never fails on a minified bundle with a route (the shape that overflowed the AST walk)', async () => {
    // Field shape: a one-line minified bundle in public/ whose comma sequence nests ~1,500+ levels deep; Flow-typed
    // .js files (older React apps) do not parse as TypeScript.
    const terms = Array.from({ length: 5_000 }, (_, i) => `a${i}()`).join(',');
    const root = reactApp({
      'public/assets/router.js': `const routes=[{path:"/bundled",component:B}];x=(${terms});`,
      'public/assets/vendor.min.js': 'var routes=[{path:"/vendored",component:V}];',
      'src/router.ts': "export const routes = [{ path: '/ok', component: Ok }];",
      'src/broken.tsx': 'export const App = () => <Routes><Route path="/b"></Routes>;',
      'src/flow1.js': "// @flow\ntype Props = {| id: number |};\nexport const routes = [{ path: '/f1' }];",
      'src/flow2.js': "// @flow\ntype Props = {| id: number |};\nexport const routes = [{ path: '/f2' }];",
    });
    const p = await discoverRepository(root);
    expect(pagePaths(p)).toEqual(
      expect.arrayContaining(['/bundled', '/vendored', '/ok', '/b', '/f1', '/f2']),
    );
    // One aggregated line with a count and the first three files.
    expect(p.limitations).toEqual([
      '5 code file(s) were read with the regex fallback instead of the bundled TypeScript parser (broken or newer syntax, minified code, or code it could not walk), so their routes can include ones in comments or strings: public/assets/router.js, public/assets/vendor.min.js, src/broken.tsx and 2 more.',
    ]);
  });

  it('falls back to the regexes when the AST walk throws', async () => {
    const real = await import('../../src/discovery/ast/parser.js');
    vi.mocked(loadTsParser).mockResolvedValueOnce({
      parser: {
        parseSource: real.parseSource,
        astRoutes: () => {
          throw new RangeError('Maximum call stack size exceeded');
        },
      },
    });
    const p = await discoverRepository(
      reactApp({ 'src/router.ts': "export const routes = [{ path: '/still-found' }];" }),
    );
    expect(pagePaths(p)).toEqual(['/still-found']);
    expect(p.limitations).toHaveLength(1);
    expect(p.limitations![0]).toMatch(
      /^1 code file\(s\) were read with the regex fallback.*: src\/router\.ts\.$/,
    );
  });

  it('does not load the parser when no code file declares routes', async () => {
    vi.mocked(loadTsParser).mockClear();
    const root = reactApp({ 'src/main.ts': 'console.log(1);', 'index.html': '<p>hi</p>' });
    const p = await discoverRepository(root);
    expect(p.limitations).toEqual([]);
    expect(loadTsParser).not.toHaveBeenCalled();
    // Control: a file that may declare routes loads it.
    await discoverRepository(reactApp({ 'src/router.ts': "export const routes = [{ path: '/a' }];" }));
    expect(loadTsParser).toHaveBeenCalledTimes(1);
  });

  // The CLI loads plugin/dist/ts-parser.mjs with import(): a stand-in chunk that records when it is loaded shows
  // that startup and a website target never load it, while a repository with code routes does.
  it.skipIf(!existsSync(join(import.meta.dirname, '../../plugin/dist/jourilo.mjs')))(
    'the CLI starts without loading ts-parser.mjs for a website target',
    () => {
      const dist = mkdtempSync(join(tmpRoot, 'dist-'));
      dirs.push(dist);
      copyFileSync(join(import.meta.dirname, '../../plugin/dist/jourilo.mjs'), join(dist, 'jourilo.mjs'));
      const marker = join(dist, 'loaded.txt');
      writeFileSync(
        join(dist, 'ts-parser.mjs'),
        `import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(marker)}, 'loaded\\n');
export const parseSource = () => null;
export const astRoutes = () => [];
`,
      );
      const cli = (...args: string[]) =>
        spawnSync(process.execPath, [join(dist, 'jourilo.mjs'), ...args, '--workspace', join(dist, 'ws')], {
          encoding: 'utf8',
        });
      expect(cli('--version').status).toBe(0);
      const site = cli('discover', 'http://localhost:1/', '--deny-local', '--json', '-q');
      expect(site.stdout + site.stderr).toMatch(/UNSAFE_URL/);
      expect(existsSync(marker)).toBe(false);
      // Control: a repository with code routes loads the chunk; this stand-in parses nothing, so the regexes run.
      const repoRun = cli(
        'discover',
        join(import.meta.dirname, '../../fixtures/repos/vue-shop'),
        '--json',
        '-q',
      );
      expect(repoRun.status).toBe(0);
      expect(existsSync(marker)).toBe(true);
      const profile = JSON.parse(repoRun.stdout).profile;
      expect(profile.apps[0].routes.map((r: { path: string }) => r.path)).toContain('/checkout');
      expect(profile.limitations.join(' ')).toMatch(/regex fallback/);
      // The real chunk next to the committed bundle parses the same repository without a fallback.
      const real = spawnSync(
        process.execPath,
        [
          join(import.meta.dirname, '../../plugin/dist/jourilo.mjs'),
          'discover',
          join(import.meta.dirname, '../../fixtures/repos/monorepo'),
          '--workspace',
          join(dist, 'ws-real'),
          '--json',
          '-q',
        ],
        { encoding: 'utf8' },
      );
      expect(real.status).toBe(0);
      const admin = JSON.parse(real.stdout).profile.apps.find(
        (a: { root: string }) => a.root === 'apps/admin',
      );
      expect(admin.routes.map((r: { path: string }) => r.path)).toEqual(['/', '/users']);
      expect(JSON.parse(real.stdout).profile.limitations).toEqual([]);
    },
  );
});
