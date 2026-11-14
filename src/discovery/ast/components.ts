// The component graph: which components a repository declares, which components each one renders, and how many
// routes render each one (directly, or through other components and layouts). Read from the syntax tree, so a tag
// in a comment or a string is never a render. Part of the plugin/dist/ts-parser.mjs chunk.
import { posix } from 'node:path';
import ts from 'typescript-js';
import { DIR_LAYOUT, isRouteFile, ROOT_LAYOUT } from './route-files.js';
import { astRoutes } from './routes.js';

export interface ComponentDef {
  name: string;
  /** Repository-relative file. */
  file: string;
  /** First and last line of the declaration (the whole file for a Vue or Svelte component). */
  line: number;
  endLine: number;
  exported: boolean;
  /** Keys (`file#name`) of the components it renders. */
  renders: string[];
  /** How many routes render it, directly or through other components and layouts. */
  usedBy: number;
}

export interface ComponentIndex {
  /** By key `file#name`. */
  components: Map<string, ComponentDef>;
  /** Components per file, in source order. */
  byFile: Map<string, ComponentDef[]>;
  /** Files whose components could not be read; the caller reports them in one limitation line. */
  failed: string[];
}

export const componentKey = (file: string, name: string) => `${file}#${name}`;

const SFC = /\.(vue|svelte)$/;
const EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.vue', '.svelte'];
/** A router created in code: React Router, Vue Router, Angular, or the routes hook. */
const ROUTER_CALL =
  /\b(create(Browser|Hash|Memory|Static)?Router|useRoutes|RouterModule\.for(Root|Child)|new\s+VueRouter)\s*\(/;

const isComponentName = (n: string) => /^[A-Z]/.test(n);
const kebab = (n: string) => n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

function childrenOf(node: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  ts.forEachChild(node, (c) => {
    out.push(c);
  });
  return out;
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false);

/** `() => …`, `function () {}`, or a wrapper call around one (memo, forwardRef, defineComponent). */
function isComponentValue(e: ts.Expression | undefined): boolean {
  if (!e) return false;
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e))
    return isComponentValue(e.expression);
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e) || ts.isClassExpression(e)) return true;
  if (ts.isCallExpression(e))
    return e.arguments.some((a) => isComponentValue(a) || ts.isObjectLiteralExpression(a));
  return false;
}

interface Binding {
  spec: string;
  /** The imported name, or "default". */
  imported: string;
}

interface FileInfo {
  file: string;
  components: ComponentDef[];
  /** Local component name → its nodes (to walk for rendered tags). */
  nodes: Map<string, ts.Node>;
  defaultName?: string;
  imports: Map<string, Binding>;
  /** `export { a as b } from 's'` → b → { spec: s, imported: a }; `export * from 's'` → specs. */
  reexports: Map<string, Binding>;
  starExports: string[];
  /** Tags rendered by each component, by local name (resolved later). */
  tags: Map<string, Set<string>>;
}

function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

/** Tag names rendered under `root`: `<Header>`, `<Card.Title>` (→ Card). Iterative, like the route walk. */
function renderedTags(root: ts.Node): Set<string> {
  const tags = new Set<string>();
  const stack: ts.Node[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      let t: ts.Node = n.tagName;
      while (ts.isPropertyAccessExpression(t)) t = t.expression;
      if (ts.isIdentifier(t) && isComponentName(t.text)) tags.add(t.text);
    }
    const kids = childrenOf(n);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
  return tags;
}

function readFile(file: string, sf: ts.SourceFile, raw: string | undefined): FileInfo {
  const info: FileInfo = {
    file,
    components: [],
    nodes: new Map(),
    imports: new Map(),
    reexports: new Map(),
    starExports: [],
    tags: new Map(),
  };
  const lines = (raw ?? sf.text).split('\n').length;
  const add = (name: string, node: ts.Node, exported: boolean) => {
    if (info.nodes.has(name)) return;
    info.nodes.set(name, node);
    info.components.push({
      name,
      file,
      line: lineOf(sf, node.getStart(sf)),
      endLine: lineOf(sf, node.getEnd()),
      exported,
      renders: [],
      usedBy: 0,
    });
  };
  const exportedNames = new Set<string>();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause) {
      const spec = st.moduleSpecifier.text;
      const c = st.importClause;
      if (c.name) info.imports.set(c.name.text, { spec, imported: 'default' });
      if (c.namedBindings && ts.isNamedImports(c.namedBindings))
        for (const el of c.namedBindings.elements)
          info.imports.set(el.name.text, { spec, imported: (el.propertyName ?? el.name).text });
      continue;
    }
    if (ts.isExportDeclaration(st)) {
      const spec =
        st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : undefined;
      if (!st.exportClause) {
        if (spec) info.starExports.push(spec);
      } else if (ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) {
          const local = (el.propertyName ?? el.name).text;
          if (spec) info.reexports.set(el.name.text, { spec, imported: local });
          else if (el.name.text === 'default') info.defaultName = local;
          else exportedNames.add(local);
        }
      }
      continue;
    }
    if (ts.isExportAssignment(st) && !st.isExportEquals) {
      if (ts.isIdentifier(st.expression)) info.defaultName = st.expression.text;
      continue;
    }
    const exported = hasModifier(st, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(st, ts.SyntaxKind.DefaultKeyword);
    if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) {
      const name = st.name?.text ?? (isDefault ? posix.basename(file).replace(/\.[^.]+$/, '') : undefined);
      if (!name || (!isComponentName(name) && !isDefault)) continue;
      add(name, st, exported);
      if (isDefault) info.defaultName = name;
      continue;
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name) && isComponentName(d.name.text) && isComponentValue(d.initializer))
          add(d.name.text, d, exported);
    }
  }
  for (const c of info.components)
    if (exportedNames.has(c.name) || c.name === info.defaultName) c.exported = true;
  if (SFC.test(file)) {
    // A Vue or Svelte file is one component; it renders the imported components its template uses.
    const name = posix.basename(file).replace(/\.[^.]+$/, '');
    info.components = [{ name, file, line: 1, endLine: lines, exported: true, renders: [], usedBy: 0 }];
    info.nodes = new Map([[name, sf]]);
    info.defaultName = name;
    const template = raw?.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
    const used = new Set<string>();
    for (const local of info.imports.keys()) {
      if (!isComponentName(local)) continue;
      if (template === undefined || new RegExp(`<(${local}|${kebab(local)})[\\s/>.]`).test(template))
        used.add(local);
    }
    // Svelte and Vue (with JSX) script blocks can also render JSX-like tags; template tags are the main source.
    info.tags.set(name, used);
    return info;
  }
  for (const [name, node] of info.nodes) info.tags.set(name, renderedTags(node));
  return info;
}

/**
 * Builds the component graph from parsed files (repository-relative path → syntax tree). `texts` holds the files'
 * full text; for Vue and Svelte it is needed to read the template (the syntax tree only has the script blocks).
 * A file that cannot be read is listed in `failed` and left out; it never fails the index.
 */
export function componentIndex(
  files: Map<string, ts.SourceFile>,
  texts?: Map<string, string>,
): ComponentIndex {
  const failed: string[] = [];
  const infos = new Map<string, FileInfo>();
  for (const [file, sf] of files) {
    try {
      infos.set(file, readFile(file, sf, texts?.get(file)));
    } catch {
      failed.push(file);
    }
  }

  const resolveModule = (from: string, spec: string): string | undefined => {
    let bases: string[];
    if (spec.startsWith('.')) bases = [posix.join(posix.dirname(from), spec)];
    else {
      const m = spec.match(/^(?:@|~|#)\/(.+)$/) ?? spec.match(/^\$lib\/(.+)$/);
      if (!m) return undefined;
      const rest = spec.startsWith('$lib/') ? `lib/${m[1]}` : m[1]!;
      // An alias points at the app's src/ (or its root); in a monorepo the app is an ancestor of the importer.
      bases = [];
      const parts = posix.dirname(from).split('/');
      for (let i = parts.length; i >= 0; i--) {
        const dir = parts.slice(0, i).join('/');
        bases.push(posix.join(dir || '.', 'src', rest), posix.join(dir || '.', rest));
      }
    }
    for (const b of bases) {
      const base = posix.normalize(b);
      const stripped = base.replace(/\.(m?js|jsx)$/, '');
      for (const c of [base, ...EXTS.map((e) => stripped + e), ...EXTS.map((e) => `${base}/index${e}`)])
        if (infos.has(c)) return c;
    }
    return undefined;
  };

  /** The component a module exports under `name` ("default" for the default export). */
  // Memoised by file#name; an entry is set before recursing, so a cycle of barrels ends at once.
  const exportMemo = new Map<string, string | undefined>();
  const exportedComponent = (file: string, name: string, depth = 0): string | undefined => {
    const memoKey = componentKey(file, name);
    if (exportMemo.has(memoKey)) return exportMemo.get(memoKey);
    exportMemo.set(memoKey, undefined);
    const hit = findExport(file, name, depth);
    exportMemo.set(memoKey, hit);
    return hit;
  };
  const findExport = (file: string, name: string, depth: number): string | undefined => {
    const info = infos.get(file);
    if (!info || depth > 5) return undefined;
    const local = name === 'default' ? info.defaultName : name;
    if (local && info.nodes.has(local)) return componentKey(file, local);
    if (local && info.imports.has(local)) return resolveName(file, local, depth + 1);
    const re = info.reexports.get(name);
    if (re) {
      const target = resolveModule(file, re.spec);
      return target ? exportedComponent(target, re.imported, depth + 1) : undefined;
    }
    for (const spec of info.starExports) {
      const target = resolveModule(file, spec);
      const hit = target ? exportedComponent(target, name, depth + 1) : undefined;
      if (hit) return hit;
    }
    return undefined;
  };

  /** A name used in `file` (a tag or a route's component) → the component key. */
  const resolveName = (file: string, name: string, depth = 0): string | undefined => {
    const info = infos.get(file);
    if (!info) return undefined;
    if (info.nodes.has(name)) return componentKey(file, name);
    const b = info.imports.get(name);
    if (!b) return undefined;
    const target = resolveModule(file, b.spec);
    return target ? exportedComponent(target, b.imported, depth) : undefined;
  };

  const components = new Map<string, ComponentDef>();
  const byFile = new Map<string, ComponentDef[]>();
  for (const info of infos.values()) {
    byFile.set(info.file, info.components);
    for (const c of info.components) components.set(componentKey(c.file, c.name), c);
  }
  for (const info of infos.values()) {
    try {
      for (const c of info.components) {
        const renders = new Set<string>();
        for (const tag of info.tags.get(c.name) ?? []) {
          const key = resolveName(info.file, tag);
          if (key && key !== componentKey(c.file, c.name)) renders.add(key);
        }
        c.renders = [...renders];
      }
    } catch {
      failed.push(info.file);
    }
  }

  // Routes: a route declared in code names its component; every component of a file-based route file is that route.
  const entries = new Map<string, Set<string>>();
  const layouts = new Map<string, Set<string> | 'all'>();
  const allRoutes = new Set<string>();
  const addEntry = (key: string, route: string) => {
    allRoutes.add(route);
    const s = entries.get(key) ?? new Set<string>();
    s.add(route);
    entries.set(key, s);
  };
  let codeRouter = false;
  for (const [file, sf] of files) {
    const info = infos.get(file);
    if (!info) continue;
    let declared: ReturnType<typeof astRoutes> = [];
    try {
      if (/<Route\b|\bpath\s*:/.test(sf.text)) declared = astRoutes(file, sf);
    } catch {
      failed.push(file);
      continue;
    }
    // Only router constructs count: <Route>, TanStack createRoute(), and route records passed to a router call or
    // naming a component. A navigation or tab array ({ path: '/a', label }) in some file is not a route.
    const routerCall = ROUTER_CALL.test(sf.text);
    if (routerCall || declared.some((r) => r.router !== 'Router config')) codeRouter = true;
    const ids: string[] = [];
    for (const r of declared) {
      if (r.router === 'Router config' && !routerCall && !r.component) continue;
      const id = `${file}:${r.path}`;
      ids.push(id);
      allRoutes.add(id);
      if (!r.component) continue;
      const key = /^[./@~#$]/.test(r.component)
        ? (() => {
            const target = resolveModule(file, r.component);
            return target ? exportedComponent(target, 'default') : undefined;
          })()
        : resolveName(file, r.component.split('.')[0]!);
      if (key) addEntry(key, id);
    }
    // The components of a file that declares routes wrap them (an App with a header around its <Routes>).
    if (ids.length)
      for (const c of info.components) {
        const key = componentKey(c.file, c.name);
        const prev = layouts.get(key);
        if (prev !== 'all') layouts.set(key, new Set([...(prev ?? []), ...ids]));
      }
  }
  for (const info of infos.values())
    if (isRouteFile(info.file, codeRouter))
      for (const c of info.components) addEntry(componentKey(c.file, c.name), info.file);
  for (const info of infos.values()) {
    const keys = info.components.map((c) => componentKey(c.file, c.name));
    if (ROOT_LAYOUT.test(info.file)) for (const k of keys) layouts.set(k, 'all');
    else if (DIR_LAYOUT.test(info.file)) {
      const dir = posix.dirname(info.file);
      const under = [...allRoutes].filter((r) => r.startsWith(`${dir}/`));
      for (const k of keys) {
        const prev = layouts.get(k);
        if (prev !== 'all') layouts.set(k, new Set([...(prev ?? []), ...under]));
      }
    }
  }

  // Each route and layout passes its routes down to everything it renders, stopping at another route's component.
  const reached = new Map<string, Set<string>>();
  const spread = (from: string, routes: Iterable<string>) => {
    const list = [...routes];
    const seen = new Set<string>([from]);
    const stack = [from];
    while (stack.length) {
      const key = stack.pop()!;
      const s = reached.get(key) ?? new Set<string>();
      for (const r of list) s.add(r);
      reached.set(key, s);
      for (const next of components.get(key)?.renders ?? [])
        if (!seen.has(next) && !entries.has(next)) {
          seen.add(next);
          stack.push(next);
        }
    }
  };
  for (const [key, routes] of entries) spread(key, routes);
  for (const [key, routes] of layouts)
    if (!entries.has(key)) spread(key, routes === 'all' ? allRoutes : routes);
  for (const [key, c] of components) c.usedBy = reached.get(key)?.size ?? 0;

  return { components, byFile, failed: [...new Set(failed)] };
}
