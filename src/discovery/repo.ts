// Product intelligence for Repository Mode. Reads a project the way a new engineer would: manifests, routes,
// components, design tokens, i18n, auth, payments, analytics. Every fact records the file it came from
// (provenance "observed"); anything that needs interpretation is left for the agent and labelled as inference.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { toPosix } from '../core/fs-safety.js';

export interface Fact {
  value: string;
  source: string;
  provenance: 'observed';
}

export interface RouteInfo {
  path: string;
  file: string;
  kind: 'page' | 'api' | 'layout';
  framework: string;
  dynamic: boolean;
  role: string;
}

export interface AppProfile {
  root: string;
  name: string;
  frameworks: Fact[];
  routes: RouteInfo[];
  devCommand: { command: string; args: string[]; port: number | null; source: string } | null;
  components: { count: number; dirs: string[] };
}

export interface ProductProfile {
  schemaVersion: 1;
  kind: 'repository';
  root: string;
  name: string;
  description: Fact | null;
  readmeSummary: Fact | null;
  monorepo: Fact | null;
  apps: AppProfile[];
  designSystem: {
    uiLibraries: Fact[];
    tokens: Fact[];
    fonts: Fact[];
    cssVariables: number;
    tailwind: Fact | null;
  };
  i18n: { libraries: Fact[]; locales: string[] };
  auth: Fact[];
  payments: Fact[];
  analytics: Fact[];
  featureFlags: Fact[];
  roles: Fact[];
  candidateJourneys: { name: string; routes: string[]; why: string }[];
  integrations: { markilo: string | null; searvex: string | null };
  gaps: string[];
}

const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  'coverage',
  'vendor',
  '.jourilo',
  '.turbo',
  '.dart_tool',
  'out',
  '.astro',
  'storage',
]);

function walk(root: string, max = 20_000): string[] {
  const out: string[] = [];
  const rec = (dir: string, depth: number) => {
    if (out.length >= max || depth > 14) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of entries) {
      if (SKIP.has(n) || (n.startsWith('.') && n !== '.github')) continue;
      const full = join(dir, n);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) rec(full, depth + 1);
      else out.push(toPosix(relative(root, full)));
    }
  };
  rec(root, 0);
  return out;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function read(file: string, max = 400_000): string {
  try {
    const st = statSync(file);
    if (st.size > max) return '';
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

const fact = (value: string, source: string): Fact => ({ value, source, provenance: 'observed' });

const DEP_SIGNALS: {
  dep: RegExp;
  group: 'framework' | 'ui' | 'i18n' | 'auth' | 'payments' | 'analytics' | 'flags';
  label: string;
}[] = [
  { dep: /^next$/, group: 'framework', label: 'Next.js' },
  { dep: /^nuxt$/, group: 'framework', label: 'Nuxt' },
  { dep: /^@sveltejs\/kit$/, group: 'framework', label: 'SvelteKit' },
  { dep: /^astro$/, group: 'framework', label: 'Astro' },
  { dep: /^@remix-run\/(react|node)$|^react-router$/, group: 'framework', label: 'Remix / React Router' },
  { dep: /^gatsby$/, group: 'framework', label: 'Gatsby' },
  { dep: /^@angular\/core$/, group: 'framework', label: 'Angular' },
  { dep: /^vue$/, group: 'framework', label: 'Vue' },
  { dep: /^react$/, group: 'framework', label: 'React' },
  { dep: /^svelte$/, group: 'framework', label: 'Svelte' },
  { dep: /^solid-js$/, group: 'framework', label: 'Solid' },
  { dep: /^vite$/, group: 'framework', label: 'Vite' },
  { dep: /^react-router-dom$/, group: 'framework', label: 'React Router' },
  { dep: /^vue-router$/, group: 'framework', label: 'Vue Router' },
  { dep: /^@mui\/material$/, group: 'ui', label: 'MUI' },
  { dep: /^@chakra-ui\/react$/, group: 'ui', label: 'Chakra UI' },
  { dep: /^@radix-ui\//, group: 'ui', label: 'Radix UI' },
  { dep: /^antd$/, group: 'ui', label: 'Ant Design' },
  { dep: /^bootstrap$|^react-bootstrap$/, group: 'ui', label: 'Bootstrap' },
  { dep: /^@headlessui\//, group: 'ui', label: 'Headless UI' },
  { dep: /^vuetify$/, group: 'ui', label: 'Vuetify' },
  { dep: /^@mantine\/core$/, group: 'ui', label: 'Mantine' },
  { dep: /^tailwindcss$/, group: 'ui', label: 'Tailwind CSS' },
  {
    dep: /^next-intl$|^next-i18next$|^i18next$|^react-i18next$|^vue-i18n$|^@nuxtjs\/i18n$|^svelte-i18n$|^@lingui\/core$|^react-intl$/,
    group: 'i18n',
    label: '',
  },
  {
    dep: /^next-auth$|^@auth\/core$|^@clerk\/|^@supabase\/auth|^@supabase\/supabase-js$|^firebase$|^passport$|^lucia$|^better-auth$|^@kinde-oss\//,
    group: 'auth',
    label: '',
  },
  {
    dep: /^stripe$|^@stripe\/|^@paddle\/|^@lemonsqueezy\/|^@paypal\/|^braintree/,
    group: 'payments',
    label: '',
  },
  {
    dep: /^posthog-js$|^posthog-node$|^@amplitude\/|^amplitude-js$|^@segment\/|^mixpanel|^@vercel\/analytics$|^plausible|^react-ga4?$|^@next\/third-parties$|^@fullstory\/|^@microsoft\/clarity$/,
    group: 'analytics',
    label: '',
  },
  {
    dep: /^launchdarkly|^@launchdarkly\/|^@growthbook\/|^unleash|^@unleash\/|^@statsig\/|^statsig|^@optimizely\/|^flagsmith|^@vercel\/flags$|^@openfeature\//,
    group: 'flags',
    label: '',
  },
];

/** Converts a file-based route path to a URL path: (group) removed, [id] → :id, index → /. */
function routePath(segments: string[]): { path: string; dynamic: boolean } {
  const parts: string[] = [];
  let dynamic = false;
  for (const raw of segments) {
    if (/^\(.*\)$/.test(raw) || raw.startsWith('@') || raw === 'index' || raw === '') continue;
    const m = raw.match(/^\[{1,2}(\.\.\.)?([^\]]+)\]{1,2}$/) ?? raw.match(/^\$(.*)$/);
    if (m) {
      dynamic = true;
      parts.push(`:${m[2] ?? m[1] ?? 'param'}`);
    } else parts.push(raw);
  }
  return { path: `/${parts.join('/')}`, dynamic };
}

export function roleOf(path: string): string {
  const p = path.toLowerCase();
  if (p === '/') return 'home';
  const table: [RegExp, string][] = [
    [/pric|plans|billing\/plans/, 'pricing'],
    [/sign-?up|register|join|onboard/, 'signup'],
    [/log-?in|sign-?in|auth/, 'login'],
    [/forgot|reset|recover/, 'recovery'],
    [/checkout|cart|basket|payment/, 'checkout'],
    [/cancel|unsubscribe|delete/, 'cancellation'],
    [/dashboard|app\b|home\/|overview/, 'dashboard'],
    [/settings|account|profile|preferences|billing/, 'settings'],
    [/search/, 'search'],
    [/admin/, 'admin'],
    [/product|shop|store|catalog|collection/, 'product'],
    [/docs|help|support|faq|contact/, 'support'],
    [/blog|news|changelog/, 'content'],
    [/terms|privacy|legal|cookie/, 'legal'],
  ];
  for (const [re, r] of table) if (re.test(p)) return r;
  return 'page';
}

function fileRoutes(appRoot: string, files: string[], frameworks: string[]): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const add = (path: string, file: string, kind: RouteInfo['kind'], framework: string, dynamic: boolean) => {
    if (routes.some((r) => r.path === path && r.kind === kind && r.framework === framework)) return;
    routes.push({ path, file, kind, framework, dynamic, role: roleOf(path) });
  };
  const has = (f: string) => frameworks.includes(f);
  // File-based routers: [framework, pattern, how to turn the match into a route].
  type FileRule = [
    string,
    RegExp,
    (m: RegExpMatchArray, f: string) => { segs: string[]; kind: RouteInfo['kind'] } | null,
  ];
  const kindOf = (k: string | undefined): RouteInfo['kind'] =>
    k === 'route' || k === 'server' ? 'api' : k === 'layout' ? 'layout' : 'page';
  const FILE_RULES: FileRule[] = [
    [
      'Next.js',
      /^(?:src\/)?app\/(.*?)\/?(page|route|layout)\.(tsx|jsx|ts|js|mdx|md)$/,
      (m) => ({ segs: (m[1] ?? '').split('/'), kind: kindOf(m[2]) }),
    ],
    [
      'Next.js',
      /^(?:src\/)?pages\/(.+)\.(tsx|jsx|ts|js|mdx|md)$/,
      (m) =>
        /^_(app|document|error)/.test(basename(m[1]!))
          ? null
          : { segs: m[1]!.split('/'), kind: m[1]!.startsWith('api/') ? 'api' : 'page' },
    ],
    ['Nuxt', /^(?:app\/)?pages\/(.+)\.vue$/, (m) => ({ segs: m[1]!.split('/'), kind: 'page' })],
    [
      'SvelteKit',
      /^src\/routes\/(.*?)\/?\+(page|server|layout)\.(svelte|ts|js)$/,
      (m) => ({ segs: (m[1] ?? '').split('/'), kind: kindOf(m[2]) }),
    ],
    [
      'Astro',
      /^src\/pages\/(.+)\.(astro|md|mdx|html|ts|js)$/,
      (m, f) => ({ segs: m[1]!.split('/'), kind: /\.(ts|js)$/.test(f) ? 'api' : 'page' }),
    ],
    // Remix flat routes: app/routes/pricing.tsx, app/routes/_index.tsx, app/routes/blog.$slug.tsx
    [
      'Remix / React Router',
      /^app\/routes\/(.+)\.(tsx|jsx|ts|js)$/,
      (m) => ({
        segs: m[1]!
          .replace(/\/route$/, '')
          .split('.')
          .map((s) => (s === '_index' ? '' : s.replace(/^_/, ''))),
        kind: 'page',
      }),
    ],
  ];
  for (const f of files) {
    let matched = false;
    for (const [fw, re, toRoute] of FILE_RULES) {
      if (!has(fw)) continue;
      const m = f.match(re);
      if (!m) continue;
      matched = true;
      const r = toRoute(m, f);
      if (r) {
        const { path, dynamic } = routePath(r.segs);
        add(path, f, r.kind, fw === 'Remix / React Router' ? 'Remix' : fw, dynamic);
      }
      break;
    }
    if (matched) continue;
    // Plain static sites
    if (
      /\.html?$/.test(f) &&
      !frameworks.length &&
      !/(^|\/)(node_modules|test|tests|fixtures|coverage)\//.test(f)
    ) {
      const segs = f.replace(/\.html?$/, '').split('/');
      if (segs[segs.length - 1] === '404') continue;
      const { path } = routePath(segs);
      add(path, f, 'page', 'Static HTML', false);
    }
  }
  // Router configs declared in code: React Router, Vue Router, Angular, Laravel, Flutter go_router.
  const codeRoute: [RegExp, RegExp, string][] = [
    [/\.(t|j)sx?$/, /<Route\s[^>]*path=["'`]([^"'`]+)["'`]/g, 'React Router'],
    [/\.(t|j)sx?$|\.vue$/, /\bpath:\s*["'`](\/[^"'`]*)["'`]/g, 'Router config'],
    [/routes\/web\.php$/, /Route::(?:get|view|match|any)\(\s*['"]([^'"]+)['"]/g, 'Laravel'],
    [
      /\.dart$/,
      /GoRoute\(\s*(?:name:\s*['"][^'"]*['"]\s*,\s*)?path:\s*['"]([^'"]+)['"]/g,
      'Flutter go_router',
    ],
    [/\.dart$/, /['"](\/[a-z0-9/_-]*)['"]\s*:\s*\(\s*context\s*\)/gi, 'Flutter routes'],
  ];
  for (const f of files) {
    for (const [fileRe, re, label] of codeRoute) {
      if (!fileRe.test(f)) continue;
      const text = read(join(appRoot, f));
      if (!text) continue;
      for (const m of text.matchAll(re)) {
        const raw = m[1]!.trim();
        if (!raw || raw.includes('*') || raw.length > 120) continue;
        const path = raw.startsWith('/') ? raw : `/${raw}`;
        if (label === 'Router config' && !/routes|router/i.test(f + text.slice(0, 2000))) continue;
        add(path.replace(/\{(\w+)\??\}/g, ':$1'), f, 'page', label, /[:{]/.test(path));
      }
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

function devCommand(
  appRoot: string,
  pkg: Record<string, unknown> | null,
  frameworks: string[],
  rel: string,
): AppProfile['devCommand'] {
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
  const script = scripts.dev ? 'dev' : scripts.start ? 'start' : scripts.serve ? 'serve' : null;
  const portFrom = (s: string | undefined) => {
    const m = s?.match(/(?:-p|--port)[ =](\d{2,5})/);
    return m ? Number(m[1]) : null;
  };
  const defaults: Record<string, number> = {
    'Next.js': 3000,
    Nuxt: 3000,
    Astro: 4321,
    SvelteKit: 5173,
    Vite: 5173,
    Gatsby: 8000,
    Angular: 4200,
    Remix: 3000,
  };
  const def = frameworks.map((f) => defaults[f]).find(Boolean) ?? null;
  if (script) {
    const lock = existsSync(join(appRoot, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : existsSync(join(appRoot, 'yarn.lock'))
        ? 'yarn'
        : existsSync(join(appRoot, 'bun.lockb')) || existsSync(join(appRoot, 'bun.lock'))
          ? 'bun'
          : 'npm';
    return {
      command: lock,
      args: ['run', script],
      port: portFrom(scripts[script]) ?? def,
      source: `${rel || '.'}/package.json`,
    };
  }
  if (existsSync(join(appRoot, 'artisan')))
    return { command: 'php', args: ['artisan', 'serve'], port: 8000, source: `${rel || '.'}/artisan` };
  if (existsSync(join(appRoot, 'pubspec.yaml')) && existsSync(join(appRoot, 'web')))
    return {
      command: 'flutter',
      args: ['run', '-d', 'web-server', '--web-port', '8080'],
      port: 8080,
      source: `${rel || '.'}/pubspec.yaml`,
    };
  return null;
}

function profileApp(repoRoot: string, appRoot: string, files: string[]): AppProfile {
  const rel = toPosix(relative(repoRoot, appRoot));
  const pkgFile = join(appRoot, 'package.json');
  const pkg = existsSync(pkgFile) ? readJson(pkgFile) : null;
  const deps = {
    ...((pkg?.dependencies ?? {}) as object),
    ...((pkg?.devDependencies ?? {}) as object),
  } as Record<string, string>;
  const frameworks: Fact[] = [];
  for (const d of Object.keys(deps)) {
    for (const s of DEP_SIGNALS)
      if (s.group === 'framework' && s.dep.test(d) && !frameworks.some((f) => f.value === s.label))
        frameworks.push(fact(s.label, `${rel || '.'}/package.json`));
  }
  const composer = existsSync(join(appRoot, 'composer.json'))
    ? readJson(join(appRoot, 'composer.json'))
    : null;
  if (composer && JSON.stringify(composer.require ?? {}).includes('laravel/framework'))
    frameworks.push(fact('Laravel', `${rel || '.'}/composer.json`));
  const pubspec = read(join(appRoot, 'pubspec.yaml'));
  if (/\bflutter:\s*\n\s+sdk:\s*flutter/.test(pubspec))
    frameworks.push(
      fact(
        existsSync(join(appRoot, 'web')) ? 'Flutter (web enabled)' : 'Flutter',
        `${rel || '.'}/pubspec.yaml`,
      ),
    );
  if (/go_router/.test(pubspec)) frameworks.push(fact('go_router', `${rel || '.'}/pubspec.yaml`));
  const names = frameworks.map((f) => f.value);
  const appFiles = files
    .filter((f) => !rel || f.startsWith(`${rel}/`))
    .map((f) => (rel ? f.slice(rel.length + 1) : f));
  const routes = fileRoutes(appRoot, appFiles, names).map((r) => ({
    ...r,
    file: rel ? `${rel}/${r.file}` : r.file,
  }));
  const componentFiles = appFiles.filter(
    (f) => /(^|\/)components?\//i.test(f) && /\.(tsx|jsx|vue|svelte|astro|dart|blade\.php)$/.test(f),
  );
  return {
    root: rel || '.',
    name: (pkg?.name as string) ?? basename(appRoot),
    frameworks,
    routes,
    devCommand: devCommand(appRoot, pkg, names, rel),
    components: {
      count: componentFiles.length,
      dirs: [...new Set(componentFiles.map((f) => dirname(f)))].slice(0, 12),
    },
  };
}

export function discoverRepository(root: string): ProductProfile {
  const files = walk(root);
  const gaps: string[] = [];
  const rootPkg = existsSync(join(root, 'package.json')) ? readJson(join(root, 'package.json')) : null;

  // Monorepo layout
  let monorepo: Fact | null = null;
  const appRoots: string[] = [];
  const ws = rootPkg?.workspaces;
  const wsGlobs: string[] = Array.isArray(ws)
    ? (ws as string[])
    : Array.isArray((ws as { packages?: string[] })?.packages)
      ? (ws as { packages: string[] }).packages
      : [];
  const pnpm = read(join(root, 'pnpm-workspace.yaml'));
  for (const m of pnpm.matchAll(/^\s*-\s*['"]?([^'"\n]+)['"]?\s*$/gm)) wsGlobs.push(m[1]!);
  if (wsGlobs.length)
    monorepo = fact(
      `workspaces: ${wsGlobs.join(', ')}`,
      existsSync(join(root, 'pnpm-workspace.yaml')) ? 'pnpm-workspace.yaml' : 'package.json',
    );
  for (const g of wsGlobs) {
    const base = g.replace(/\/\*\*?$/, '');
    if (g.endsWith('*')) {
      const dir = join(root, base);
      if (!existsSync(dir)) continue;
      for (const n of readdirSync(dir))
        if (existsSync(join(dir, n, 'package.json'))) appRoots.push(join(dir, n));
    } else if (existsSync(join(root, base, 'package.json'))) appRoots.push(join(root, base));
  }
  const apps = (appRoots.length ? appRoots : [root])
    .map((r) => profileApp(root, r, files))
    // In a monorepo, libraries without routes or a framework are not apps.
    .filter(
      (a, _, all) =>
        all.length === 1 ||
        a.routes.length > 0 ||
        a.frameworks.some((f) => !['React', 'Vue', 'Svelte', 'Vite'].includes(f.value)),
    );
  if (!apps.length) apps.push(profileApp(root, root, files));

  // Dependency-based signals across the whole repository.
  const allPkgs = files.filter((f) => f.endsWith('package.json')).slice(0, 60);
  const signals = new Map<string, Fact[]>();
  for (const p of allPkgs) {
    const j = readJson(join(root, p));
    const deps = Object.keys({
      ...((j?.dependencies ?? {}) as object),
      ...((j?.devDependencies ?? {}) as object),
    });
    for (const d of deps)
      for (const s of DEP_SIGNALS) {
        if (s.group === 'framework' || !s.dep.test(d)) continue;
        const list = signals.get(s.group) ?? [];
        if (!list.some((x) => x.value === (s.label || d))) list.push(fact(s.label || d, p));
        signals.set(s.group, list);
      }
  }
  const composer = existsSync(join(root, 'composer.json'))
    ? JSON.stringify(readJson(join(root, 'composer.json'))?.require ?? {})
    : '';
  if (/laravel\/(breeze|fortify|jetstream|sanctum)/.test(composer))
    (signals.get('auth') ?? signals.set('auth', []).get('auth')!).push(
      fact(composer.match(/laravel\/(breeze|fortify|jetstream|sanctum)/)![0], 'composer.json'),
    );
  if (/laravel\/cashier/.test(composer))
    (signals.get('payments') ?? signals.set('payments', []).get('payments')!).push(
      fact('laravel/cashier', 'composer.json'),
    );

  // Design system: tokens, CSS variables, fonts, Tailwind.
  const tokens: Fact[] = [];
  const fonts: Fact[] = [];
  let cssVariables = 0;
  for (const f of files) {
    if (/(^|\/)(tokens?|design-tokens|theme)\.(json|ts|js|css)$/i.test(f) || /\.tokens\.json$/.test(f))
      tokens.push(fact(basename(f), f));
    if (/\.(css|scss)$/.test(f)) {
      const t = read(join(root, f), 300_000);
      cssVariables += (t.match(/--[a-z0-9-]+\s*:/gi) ?? []).length;
      for (const m of t.matchAll(/font-family\s*:\s*["']?([A-Za-z][\w -]+?)["']?\s*[,;]/g)) {
        const name = m[1]!.trim();
        if (
          !/^(inherit|initial|system-ui|sans-serif|serif|monospace|var)$/i.test(name) &&
          !fonts.some((x) => x.value === name)
        )
          fonts.push(fact(name, f));
      }
    }
    if (/\.(tsx|jsx|ts|js)$/.test(f) && /layout|_app|_document/.test(f)) {
      const t = read(join(root, f));
      for (const m of t.matchAll(/import\s*\{\s*([A-Z][\w,\s]+)\}\s*from\s*['"]next\/font\/google['"]/g))
        for (const n of m[1]!
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean))
          if (!fonts.some((x) => x.value === n)) fonts.push(fact(n.replace(/_/g, ' '), f));
    }
  }
  const twFile = files.find((f) => /(^|\/)tailwind\.config\.(js|ts|cjs|mjs)$/.test(f));
  const tailwind = twFile
    ? fact('Tailwind config', twFile)
    : (signals.get('ui')?.find((x) => x.value === 'Tailwind CSS') ?? null);

  // i18n locales: locale directories or message files.
  const locales = new Set<string>();
  for (const f of files) {
    const m =
      f.match(
        /(?:^|\/)(?:locales?|messages|i18n|lang|translations)\/([a-z]{2}(?:[-_][A-Za-z]{2})?)(?:\/|\.json|\.ya?ml|\.php|\.arb)/,
      ) ?? f.match(/(?:^|\/)app_([a-z]{2})\.arb$/);
    if (m) locales.add(m[1]!.replace('_', '-'));
  }

  // Roles: admin areas and role checks in code (bounded scan).
  const roles: Fact[] = [];
  const allRoutes = apps.flatMap((a) => a.routes);
  if (allRoutes.some((r) => r.role === 'admin'))
    roles.push(fact('admin', allRoutes.find((r) => r.role === 'admin')!.file));
  if (allRoutes.some((r) => r.role === 'dashboard' || r.role === 'settings'))
    roles.push(
      fact('signed-in user', allRoutes.find((r) => r.role === 'dashboard' || r.role === 'settings')!.file),
    );
  roles.unshift(fact('visitor', 'public routes'));
  for (const f of files.filter((x) => /\.(ts|tsx|js|php|dart|rb|py)$/.test(x)).slice(0, 3000)) {
    const t = read(join(root, f), 120_000);
    for (const m of t.matchAll(
      /\brole\s*(?:===?|==|:)\s*['"](owner|admin|editor|viewer|member|manager|customer|seller|vendor|teacher|student)['"]/gi,
    )) {
      const r = m[1]!.toLowerCase();
      if (!roles.some((x) => x.value === r)) roles.push(fact(r, f));
    }
  }

  // Journeys implied by routes.
  const byRole = (r: string) => allRoutes.filter((x) => x.role === r && x.kind === 'page').map((x) => x.path);
  const candidateJourneys: ProductProfile['candidateJourneys'] = [];
  const cj = (name: string, rs: string[], why: string) => {
    if (rs.length) candidateJourneys.push({ name, routes: [...new Set(rs)].slice(0, 6), why });
  };
  cj(
    'Sign up and reach the product',
    [...byRole('signup'), ...byRole('dashboard')],
    'signup and dashboard routes exist',
  );
  cj('Sign in', byRole('login'), 'login route exists');
  cj('Recover access', byRole('recovery'), 'password recovery route exists');
  cj(
    'Compare plans and start checkout',
    [...byRole('pricing'), ...byRole('checkout')],
    'pricing/checkout routes exist',
  );
  cj('Cancel or downgrade', byRole('cancellation'), 'cancellation route exists');
  cj('Find something with search', byRole('search'), 'search route exists');
  cj('Change settings', byRole('settings'), 'settings/account routes exist');
  cj('Browse products', byRole('product'), 'product/catalog routes exist');

  // README summary (first paragraph that is prose).
  let readmeSummary: Fact | null = null;
  const readmeFile = files.find((f) => /^readme\.md$/i.test(f));
  if (readmeFile) {
    const para = read(join(root, readmeFile))
      .split(/\n\s*\n/)
      .map((p) => p.replace(/<[^>]+>|!\[[^\]]*\]\([^)]*\)|\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '').trim())
      .find((p) => p.length > 60 && !p.startsWith('#') && !p.startsWith('```') && !p.startsWith('|'));
    if (para) readmeSummary = fact(para.replace(/\s+/g, ' ').slice(0, 400), readmeFile);
  }
  const description =
    typeof rootPkg?.description === 'string' ? fact(rootPkg.description, 'package.json') : null;

  if (!apps.some((a) => a.routes.length))
    gaps.push('No routes could be read from the code; run a website-mode discovery against the running app.');
  if (!apps.some((a) => a.devCommand))
    gaps.push('No dev server command found; start the app yourself and pass its URL.');
  if (!readmeSummary && !description)
    gaps.push(
      'No README or package description: product purpose must come from the user or the running site.',
    );
  if (!signals.get('analytics')?.length)
    gaps.push(
      'No analytics library detected: funnel metrics for experiments must be instrumented or supplied.',
    );

  const markilo =
    files.find(
      (f) =>
        /(^|\/)(brand|branding)\/brands\/[^/]+\/(exports\/tokens\/)?tokens\.json$/.test(f) ||
        /(^|\/)branding\/markilo\.json$/.test(f),
    ) ?? null;
  const searvex = files.find((f) => /(^|\/)\.searvex\/.*\.json$|(^|\/)searvex-report\.json$/.test(f)) ?? null;

  return {
    schemaVersion: 1,
    kind: 'repository',
    root,
    name: (rootPkg?.name as string) ?? basename(root),
    description,
    readmeSummary,
    monorepo,
    apps,
    designSystem: {
      uiLibraries: signals.get('ui') ?? [],
      tokens: tokens.slice(0, 20),
      fonts: fonts.slice(0, 12),
      cssVariables,
      tailwind,
    },
    i18n: { libraries: signals.get('i18n') ?? [], locales: [...locales].sort() },
    auth: signals.get('auth') ?? [],
    payments: signals.get('payments') ?? [],
    analytics: signals.get('analytics') ?? [],
    featureFlags: signals.get('flags') ?? [],
    roles,
    candidateJourneys,
    integrations: { markilo, searvex },
    gaps,
  };
}
