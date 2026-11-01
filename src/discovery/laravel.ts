// Laravel route discovery. Real applications split routes across files (`require __DIR__.'/x.php'`, bootstrap
// `withRouting`, `->group(base_path(...))`), nest them in prefixed and middleware groups, register pages through
// Livewire, Volt, Inertia and Filament panels, and protect them with guards. A flat regex over routes/web.php misses
// most of that, so this module follows included files and keeps a small group stack while scanning.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { toPosix } from '../core/fs-safety.js';

export interface LaravelRoute {
  path: string;
  file: string;
  /** How the page is rendered: route closure/controller, Livewire, Volt, Inertia, Filament. */
  via: string;
  dynamic: boolean;
  /** Middleware that requires a signed-in user (auth, auth:guard, verified, a custom *.auth/guest-only group). */
  auth: string[];
}

export interface LaravelProfile {
  routes: LaravelRoute[];
  /** Guards from config/auth.php (web, creator, admin …). */
  guards: string[];
  /** Filament panels: id, path, whether it has a login page. */
  panels: { id: string; path: string; login: boolean; file: string }[];
}

function read(file: string): string {
  try {
    return statSync(file).size > 400_000 ? '' : readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** Removes comments while keeping string contents and offsets roughly intact. */
function stripComments(php: string): string {
  return php
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, (m, p: string) => p + ' '.repeat(m.length - p.length));
}

/** A string argument, or for `$x ? 'a' : 'b'` the non-empty branch (the local/default value). */
function argValue(arg: string): string | null {
  const lit = arg.match(/^\s*(['"])(.*?)\1\s*$/);
  if (lit) return lit[2]!;
  const ternary = arg.match(/\?\s*(['"])(.*?)\1\s*:\s*(['"])(.*?)\3/);
  if (ternary) return ternary[2] || ternary[4] || '';
  return null;
}

function joinPath(prefix: string, path: string): string {
  const p = `/${[prefix, path]
    .map((s) => s.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')}`;
  return p.replace(/\{(\w+)\??\}/g, ':$1');
}

const AUTH_MW = /^(auth(:[\w,]+)?|verified|password\.confirm|can:.+|[\w.]*\.auth|[\w.]*\bauthenticated)$/;

function middlewares(chain: string): string[] {
  const out: string[] = [];
  for (const m of chain.matchAll(/middleware\(\s*(\[[^\]]*\]|['"][^'"]+['"])/g))
    for (const s of m[1]!.matchAll(/['"]([^'"]+)['"]/g)) out.push(s[1]!);
  return out;
}

/** Route files loaded by the application (bootstrap/app.php, RouteServiceProvider, require/include). */
function entryFiles(appRoot: string): string[] {
  const out = new Set<string>();
  const add = (rel: string) => {
    const abs = join(appRoot, rel);
    if (existsSync(abs)) out.add(toPosix(relative(appRoot, abs)));
  };
  add('routes/web.php');
  for (const f of ['bootstrap/app.php', 'app/Providers/RouteServiceProvider.php']) {
    const t = read(join(appRoot, f));
    for (const m of t.matchAll(/web\s*:\s*__DIR__\s*\.\s*['"]([^'"]+)['"]/g)) add(join(dirname(f), m[1]!));
    for (const m of t.matchAll(/base_path\(\s*['"](routes\/[^'"]+\.php)['"]\s*\)/g))
      if (!/routes\/(api|console|channels)\.php$/.test(m[1]!)) add(m[1]!);
  }
  return [...out];
}

function scanFile(
  appRoot: string,
  rel: string,
  inherited: { prefix: string; auth: string[] },
  routes: LaravelRoute[],
  seen: Set<string>,
): void {
  if (seen.has(rel)) return;
  seen.add(rel);
  const text = stripComments(read(join(appRoot, rel)));
  if (!text) return;
  type Frame = { prefix: string; auth: string[]; depth: number };
  const stack: Frame[] = [{ prefix: inherited.prefix, auth: inherited.auth, depth: -1 }];
  let depth = 0;
  let stmtStart = 0;
  let pendingGroup: { prefix: string; auth: string[] } | null = null;
  const top = () => stack[stack.length - 1]!;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      // Skip string literals so braces inside them do not count.
      const q = ch;
      for (i++; i < text.length && text[i] !== q; i++) if (text[i] === '\\') i++;
      continue;
    }
    if (ch === '{') {
      depth++;
      if (pendingGroup) {
        stack.push({ ...pendingGroup, depth });
        pendingGroup = null;
      }
      stmtStart = i + 1;
      continue;
    }
    if (ch === '}') {
      if (top().depth === depth && stack.length > 1) stack.pop();
      depth--;
      stmtStart = i + 1;
      continue;
    }
    if (ch === ';') {
      const stmt = text.slice(stmtStart, i);
      stmtStart = i + 1;
      handleStatement(stmt);
      continue;
    }
    // A group opens: `...->group(function () {` — its chain decides prefix and middleware.
    if (text.startsWith('group(', i) && /->|::/.test(text.slice(Math.max(0, i - 2), i))) {
      const chain = text.slice(stmtStart, i);
      const rest = text.slice(i, i + 200);
      const included = rest.match(
        /^group\(\s*(?:__DIR__\s*\.\s*['"]([^'"]+)['"]|base_path\(\s*['"]([^'"]+)['"]\s*\))/,
      );
      const g = groupOf(chain);
      if (included) {
        const target = included[1] ? join(dirname(rel), included[1]) : included[2]!;
        scanFile(appRoot, toPosix(target), g, routes, seen);
      } else if (/^group\(\s*(?:static\s+)?function/.test(rest)) pendingGroup = g;
    }
  }

  function groupOf(chain: string): { prefix: string; auth: string[] } {
    const pre = chain.match(/prefix\(([^)]*\)?)\)/);
    const value = pre ? argValue(pre[1]!) : null;
    const auth = middlewares(chain).filter((m) => AUTH_MW.test(m));
    return {
      prefix: joinPath(top().prefix, value ?? '').replace(/^\/$/, ''),
      auth: [...top().auth, ...auth],
    };
  }

  function handleStatement(stmt: string) {
    const req = stmt.match(/^\s*(?:require|include)(?:_once)?\s*\(?\s*__DIR__\s*\.\s*['"]([^'"]+\.php)['"]/);
    if (req) {
      scanFile(appRoot, toPosix(join(dirname(rel), req[1]!)), top(), routes, seen);
      return;
    }
    const m = stmt.match(
      /\b(?:Route|Volt)::(get|view|any|match|livewire|inertia|redirect|permanentRedirect|route)\(\s*(?:\[[^\]]*\]\s*,\s*)?(['"])([^'"]*)\2/,
    );
    if (!m) return;
    const verb = m[1]!;
    if (verb === 'match' && !/['"]get['"]/i.test(stmt)) return;
    const via =
      verb === 'livewire'
        ? 'Livewire'
        : verb === 'route' && /Volt::/.test(stmt)
          ? 'Volt'
          : verb === 'inertia'
            ? 'Inertia'
            : verb === 'redirect' || verb === 'permanentRedirect'
              ? 'redirect'
              : 'Laravel';
    if (via === 'redirect') return;
    const path = joinPath(top().prefix, m[3]!);
    const own = middlewares(stmt).filter((x) => AUTH_MW.test(x));
    routes.push({ path, file: rel, via, dynamic: /[:{]/.test(path), auth: [...top().auth, ...own] });
  }
}

function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function plural(word: string): string {
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** PHP files under `dir`, at most `depth` directory levels deep. */
function phpFiles(dir: string, depth: number): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory() && depth > 1) out.push(...phpFiles(full, depth - 1));
    else if (e.isFile() && e.name.endsWith('.php')) out.push(full);
  }
  return out.sort();
}

function filamentPanels(appRoot: string, routes: LaravelRoute[]): LaravelProfile['panels'] {
  const dir = join(appRoot, 'app/Providers/Filament');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('PanelProvider.php')) : [];
  const panels: LaravelProfile['panels'] = [];
  for (const f of files) {
    const rel = `app/Providers/Filament/${f}`;
    const t = stripComments(read(join(appRoot, rel)));
    const id = t.match(/->id\(\s*['"]([^'"]+)['"]/)?.[1] ?? kebab(f.replace(/PanelProvider\.php$/, ''));
    const pathArg = t.match(/->path\(([^)]*\)?)\)/)?.[1];
    const path = joinPath('', (pathArg !== undefined ? argValue(pathArg) : null) ?? id);
    const login = /->login\(/.test(t);
    panels.push({ id, path, login, file: rel });
    const auth = ['filament'];
    routes.push({ path, file: rel, via: 'Filament', dynamic: false, auth });
    if (login)
      routes.push({ path: joinPath(path, 'login'), file: rel, via: 'Filament', dynamic: false, auth: [] });
    // Resources and pages from the conventional directories (Filament 4 nests resources one level deeper).
    // A `protected static ?string $slug` in the class overrides the derived URL segment.
    for (const [sub, isResource] of [
      ['app/Filament/Resources', true],
      ['app/Filament/Pages', false],
    ] as const) {
      for (const file of phpFiles(join(appRoot, sub), 2)) {
        const name = basename(file, '.php');
        if (isResource ? !name.endsWith('Resource') : name === 'Dashboard') continue;
        const relFile = toPosix(join(sub, relative(join(appRoot, sub), file)));
        if (!isResource && /\/(Concerns|Widgets)\//.test(relFile)) continue;
        const own = read(file).match(/static\s+(?:\?string\s+)?\$slug\s*=\s*['"]([^'"]+)['"]/)?.[1];
        const slug = own ?? (isResource ? plural(kebab(name.replace(/Resource$/, ''))) : kebab(name));
        routes.push({ path: joinPath(path, slug), file: relFile, via: 'Filament', dynamic: false, auth });
      }
    }
  }
  return panels;
}

/** Keys of the array assigned to `'name' => [ ... ]`, at its top level only. */
function topLevelKeys(php: string, name: string): string[] {
  const start = php.search(new RegExp(`['"]${name}['"]\\s*=>\\s*\\[`));
  if (start < 0) return [];
  const open = php.indexOf('[', start);
  const keys: string[] = [];
  let depth = 0;
  for (let i = open; i < php.length; i++) {
    const ch = php[i];
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < php.length && php[j] !== ch) j += php[j] === '\\' ? 2 : 1;
      if (depth === 1 && /^\s*=>/.test(php.slice(j + 1, j + 8))) keys.push(php.slice(i + 1, j));
      i = j;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) break;
  }
  return keys;
}

export function laravelProfile(appRoot: string): LaravelProfile {
  const routes: LaravelRoute[] = [];
  const seen = new Set<string>();
  for (const f of entryFiles(appRoot)) scanFile(appRoot, f, { prefix: '', auth: [] }, routes, seen);
  // Route files nobody includes are still routes of the app (e.g. loaded by a package); scan them last.
  const routesDir = join(appRoot, 'routes');
  if (existsSync(routesDir))
    for (const f of readdirSync(routesDir))
      if (f.endsWith('.php') && !/^(api|console|channels)\.php$/.test(f))
        scanFile(appRoot, `routes/${f}`, { prefix: '', auth: [] }, routes, seen);
  const panels = filamentPanels(appRoot, routes);
  const authConfig = stripComments(read(join(appRoot, 'config/auth.php')));
  const guards = topLevelKeys(authConfig, 'guards');
  const unique = new Map<string, LaravelRoute>();
  for (const r of routes) if (!unique.has(r.path)) unique.set(r.path, r);
  return { routes: [...unique.values()], guards, panels };
}
