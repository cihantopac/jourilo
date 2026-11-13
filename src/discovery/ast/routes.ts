// Routes declared in code, read from the syntax tree instead of the text: React Router (route objects and <Route>
// JSX), Vue Router route records and TanStack Router createRoute(). Nested routes are joined to their parent, and
// anything inside a comment or a string is never a route. Part of the plugin/dist/ts-parser.mjs chunk.
import ts from 'typescript-js';

export interface AstRoute {
  path: string;
  component?: string;
  line: number;
  /** Which router declared it: "React Router", "Router config" (route records) or "TanStack Router". */
  router?: string;
}

/** Joins a child route path to its parent; a child that starts with "/" is absolute. */
function joinPath(parent: string, child: string): string {
  if (child.startsWith('/')) return child;
  const base = parent.replace(/\/+$/, '');
  return child ? `${base}/${child}` : base || '/';
}

function literal(node: ts.Node | undefined): string | undefined {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) return node.text;
  return undefined;
}

function propName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

function prop(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties)
    if (ts.isPropertyAssignment(p) && propName(p.name) === name) return p.initializer;
  return undefined;
}

/** `Home`, `<Home />` or `() => import('./Home.vue')` → a component name or module. */
function componentOf(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isParenthesizedExpression(node)) return componentOf(node.expression);
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    // Iterative: a lazy component's body may be arbitrarily deep.
    const stack: ts.Node[] = [node];
    while (stack.length) {
      const n = stack.pop()!;
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword)
        return literal(n.arguments[0]);
      stack.push(...childrenOf(n).reverse());
    }
    return undefined;
  }
  return undefined;
}

/** A node's children in source order (ts.forEachChild stops early when the callback returns a truthy value). */
function childrenOf(node: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  ts.forEachChild(node, (c) => {
    out.push(c);
  });
  return out;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

/** A JSX attribute's string value: `path="/a"`, `path={'/a'}` or `path={`/a`}`. */
function jsxAttr(attrs: ts.JsxAttributes, name: string): ts.Node | undefined {
  for (const a of attrs.properties) {
    if (!ts.isJsxAttribute(a) || a.name.getText() !== name || !a.initializer) continue;
    return ts.isJsxExpression(a.initializer) ? a.initializer.expression : a.initializer;
  }
  return undefined;
}

/** Keys that make a route record render a page. */
const PAGE_KEYS = new Set([
  'component',
  'Component',
  'element',
  'children',
  'lazy',
  'loadComponent',
  'loadChildren',
]);
/** Keys that make an object with a relative `path` a route record rather than some other configuration. */
const ROUTE_KEYS = new Set([...PAGE_KEYS, 'redirect', 'redirectTo', 'name', 'meta']);

/** TanStack Router: `$postId` → `:postId`. */
const tanstackPath = (p: string) => p.replace(/(^|\/)\$([A-Za-z_]\w*)/g, '$1:$2');

export function astRoutes(file: string, sf: ts.SourceFile): AstRoute[] {
  const routes: AstRoute[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const push = (path: string, node: ts.Node, router: string, component?: string) =>
    routes.push({ path, line: lineOf(node), router, ...(component ? { component } : {}) });
  // Route records (`{ path: '/a', children: [...] }`) count in files that look like router configuration, the same
  // rule the regular expressions used; createBrowserRouter([...]) and friends always count.
  const routerFile = /routes|router/i.test(file + sf.text.slice(0, 2000));
  const tanstack = new Map<string, { path: string; parent?: string; node: ts.Node; component?: string }>();
  const tanstackArgs = new Set<ts.Node>();

  // An explicit stack, not recursion: minified code nests thousands of levels deep (a long comma sequence is one
  // left-nested binary expression), which would overflow the call stack.
  const stack: { node: ts.Node; prefix: string; inRouter: boolean }[] = [
    { node: sf, prefix: '', inRouter: false },
  ];
  const queue = (nodes: readonly ts.Node[], prefix: string, inRouter: boolean) => {
    for (let i = nodes.length - 1; i >= 0; i--) stack.push({ node: nodes[i]!, prefix, inRouter });
  };
  while (stack.length) {
    const { node, prefix, inRouter } = stack.pop()!;
    // TanStack Router: const postRoute = createRoute({ getParentRoute: () => postsRoute, path: '$postId' })
    if (ts.isCallExpression(node) && calleeName(node) === 'createRoute') {
      const arg = node.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        tanstackArgs.add(arg);
        const parentFn = prop(arg, 'getParentRoute');
        const parent =
          parentFn && ts.isArrowFunction(parentFn) && ts.isIdentifier(parentFn.body)
            ? parentFn.body.text
            : undefined;
        const decl = node.parent;
        const name =
          ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name) ? decl.name.text : undefined;
        const component = componentOf(prop(arg, 'component'));
        // A route with only an `id` is a layout: it adds no path segment.
        tanstack.set(name ?? `#${tanstack.size}`, {
          path: literal(prop(arg, 'path')) ?? '',
          node,
          ...(parent ? { parent } : {}),
          ...(component ? { component } : {}),
        });
      }
    }
    if (
      ts.isCallExpression(node) &&
      /^create(Browser|Hash|Memory|Static)?Router$|^useRoutes$/.test(calleeName(node) ?? '')
    ) {
      queue(childrenOf(node), prefix, true);
      continue;
    }
    // Route records: { path: 'settings', component: Settings, children: [{ path: 'profile' }] }
    if (ts.isObjectLiteralExpression(node) && !tanstackArgs.has(node) && (inRouter || routerFile)) {
      const path = literal(prop(node, 'path'));
      // A top-level relative path ('heroes', Angular style) counts only on an object that looks like a route.
      const keys = node.properties.map((p) => (p.name ? propName(p.name) : undefined));
      const routeLike = path?.startsWith('/') || prefix || keys.some((k) => k && ROUTE_KEYS.has(k));
      // A record that only redirects (`{ path: '', redirectTo: '/heroes' }`) is not a page.
      const redirectOnly =
        keys.some((k) => k === 'redirect' || k === 'redirectTo') && !keys.some((k) => k && PAGE_KEYS.has(k));
      if (path !== undefined && redirectOnly) continue;
      if (path !== undefined && routeLike) {
        const full = joinPath(prefix, path);
        push(
          full,
          node,
          'Router config',
          componentOf(prop(node, 'component') ?? prop(node, 'Component') ?? prop(node, 'element')),
        );
        queue(childrenOf(node), full, inRouter);
        continue;
      }
    }
    // <Route path="/a"><Route path="b" /></Route>
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText();
      if (tag === 'Route' || tag.endsWith('.Route')) {
        const path = literal(jsxAttr(opening.attributes, 'path'));
        const full = path === undefined ? prefix : joinPath(prefix, path);
        if (path !== undefined)
          push(
            full,
            node,
            'React Router',
            componentOf(jsxAttr(opening.attributes, 'element') ?? jsxAttr(opening.attributes, 'component')),
          );
        if (ts.isJsxElement(node)) queue(node.children, full, inRouter);
        continue;
      }
    }
    queue(childrenOf(node), prefix, inRouter);
  }

  // TanStack routes join their parent's path (a leading "/" does not make them absolute); the root route
  // (createRootRoute) has none.
  const resolve = (name: string, depth = 0): string => {
    const r = tanstack.get(name);
    if (!r || depth > 20) return '';
    const own = tanstackPath(r.path).replace(/^\/+|\/+$/g, '');
    const parent = r.parent ? resolve(r.parent, depth + 1) : '';
    return own ? `${parent}/${own}` : parent;
  };
  for (const [name, r] of tanstack)
    if (r.path) push(resolve(name) || '/', r.node, 'TanStack Router', r.component);
  return routes;
}
