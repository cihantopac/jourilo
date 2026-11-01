import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { laravelProfile } from '../../src/discovery/laravel.js';
import { discoverRepository, roleOf } from '../../src/discovery/repo.js';

const repo = (name: string) => discoverRepository(join(import.meta.dirname, '../../fixtures/repos', name));
const paths = (p: ReturnType<typeof repo>) =>
  p.apps.flatMap((a) => a.routes.filter((r) => r.kind === 'page').map((r) => r.path));

describe('repository discovery', () => {
  it('reads a Next.js App Router SaaS', () => {
    const p = repo('next-saas');
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
  it('reads Vue Router routes and locales', () => {
    const p = repo('vue-shop');
    expect(paths(p)).toEqual(expect.arrayContaining(['/', '/products/:id', '/cart', '/checkout', '/search']));
    expect(p.i18n.locales).toEqual(['en', 'tr']);
  });
  it('reads Laravel routes, auth and billing packages', () => {
    const p = repo('laravel-app');
    expect(p.apps[0]!.frameworks.map((f) => f.value)).toContain('Laravel');
    expect(paths(p)).toEqual(expect.arrayContaining(['/', '/pricing', '/register', '/admin/users/:user']));
    expect(p.auth.map((f) => f.value)).toContain('laravel/breeze');
    expect(p.payments.map((f) => f.value)).toContain('laravel/cashier');
    expect(p.apps[0]!.devCommand).toMatchObject({ command: 'php', port: 8000 });
    expect(p.roles.map((r) => r.value)).toContain('admin');
    expect(p.i18n.locales).toEqual(['en', 'fr']);
  });
  it('reads Flutter web go_router routes', () => {
    const p = repo('flutter-web');
    expect(p.apps[0]!.frameworks.map((f) => f.value)).toEqual(
      expect.arrayContaining(['Flutter (web enabled)', 'go_router']),
    );
    expect(paths(p)).toEqual(expect.arrayContaining(['/', '/onboarding', '/settings']));
    expect(p.i18n.locales).toEqual(['en', 'es']);
  });
  it('reads Astro file routes including rest params', () => {
    expect(paths(repo('astro-docs'))).toEqual(expect.arrayContaining(['/', '/docs/:slug', '/contact']));
  });
  it('splits a monorepo into apps and ignores libraries', () => {
    const p = repo('monorepo');
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

  it('reports auth and roles in the product profile', () => {
    const p = discoverRepository(root);
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
