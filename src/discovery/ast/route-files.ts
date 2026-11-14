// File conventions of file-based routers and layouts. Plain path rules with no parser, so the main bundle (locate)
// and the parser chunk (the component graph) can share them.

const basename = (file: string) => file.slice(file.lastIndexOf('/') + 1);

/**
 * File-based routers: Next.js app/ and pages/, Nuxt pages/, SvelteKit +page, Remix and SolidStart routes/. In a
 * project whose router is created in code (`createBrowserRouter`, `<Route>`), a pages/ or routes/ folder is only a
 * naming habit, so `codeRouter` turns those two conventions off; Next's app/ and SvelteKit's +page always count.
 */
export function isRouteFile(file: string, codeRouter = false): boolean {
  const base = basename(file);
  if (/(^|\/)app\/(.*\/)?page\.[jt]sx?$/.test(file) || base === '+page.svelte') return true;
  if (codeRouter) return false;
  if (/(^|\/)pages\/(?!_|api\/).+\.([jt]sx?|vue|svelte)$/.test(file)) return true;
  // routes/: every module is a route, except SvelteKit's +layout, +page.ts (load) and +server files.
  return /(^|\/)routes\/.+\.([jt]sx?|vue|svelte)$/.test(file) && !base.startsWith('+');
}

/** Layouts that wrap the routes in and below their directory. */
export const DIR_LAYOUT =
  /(^|\/)(app\/(.*\/)?layout\.[jt]sx?|(.*\/)?\+layout\.svelte|pages\/_app\.[jt]sx?|app\/root\.[jt]sx?)$/;
/** Layouts that wrap every route: the application root and Nuxt layouts. */
export const ROOT_LAYOUT = /(^|\/)(App\.(vue|svelte|[jt]sx)|layouts\/[^/]+\.vue|app\.vue)$/;

/** A file whose components decide which routes render what: a route, a layout or a router file. */
export function isStructuralFile(file: string): boolean {
  return (
    isRouteFile(file) ||
    DIR_LAYOUT.test(file) ||
    ROOT_LAYOUT.test(file) ||
    /(^|[/.])(routes?|router)\b/i.test(file)
  );
}

/**
 * Whether plain route records (`{ path: '/a', ... }`) in this file are routes: the file is named like router
 * configuration, declares route-typed values, or a `routes` variable or property. Mentioning a router (`import { useRouter } from 'next/router'`) is
 * not enough: navigation and tab arrays have the same shape.
 */
export function isRouterConfigFile(file: string, text: string): boolean {
  return (
    /routes|router/i.test(file) ||
    /\b(RouteRecordRaw|RouteObject|RouterModule|VueRouter|create(Browser|Hash|Memory|Static)?Router)\b|:\s*Routes\b|\b(const|let|var)\s+routes\b|\broutes\s*:/.test(
      text.slice(0, 2000),
    )
  );
}
