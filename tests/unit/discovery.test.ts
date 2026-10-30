import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
