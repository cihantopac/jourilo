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
    let found: string | undefined;
    const visit = (n: ts.Node) => {
      if (found) return;
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword)
        found = literal(n.arguments[0]);
      else ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  }
  return undefined;
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

/** Keys that make an object with a relative `path` a route record rather than some other configuration. */
const ROUTE_KEYS = new Set([
  'component',
  'Component',
  'element',
  'children',
  'redirect',
  'redirectTo',
  'name',
  'lazy',
  'loadComponent',
  'loadChildren',
  'meta',
]);

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

  const visit = (node: ts.Node, prefix: string, inRouter: boolean): void => {
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
      ts.forEachChild(node, (c) => visit(c, prefix, true));
      return;
    }
    // Route records: { path: 'settings', component: Settings, children: [{ path: 'profile' }] }
    if (ts.isObjectLiteralExpression(node) && !tanstackArgs.has(node) && (inRouter || routerFile)) {
      const path = literal(prop(node, 'path'));
      // A top-level relative path ('heroes', Angular style) counts only on an object that looks like a route.
      const routeLike =
        path?.startsWith('/') ||
        prefix ||
        node.properties.some((p) => p.name && ROUTE_KEYS.has(p.name.getText()));
      if (path !== undefined && routeLike) {
        const full = joinPath(prefix, path);
        push(
          full,
          node,
          'Router config',
          componentOf(prop(node, 'component') ?? prop(node, 'Component') ?? prop(node, 'element')),
        );
        ts.forEachChild(node, (c) => visit(c, full, inRouter));
        return;
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
        if (ts.isJsxElement(node)) for (const c of node.children) visit(c, full, inRouter);
        return;
      }
    }
    ts.forEachChild(node, (c) => visit(c, prefix, inRouter));
  };
  visit(sf, '', false);

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
