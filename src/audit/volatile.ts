// Volatile tokens: parts of an error message or request URL that change on every page load or every page (CSP
// nonces, hashes, ids, cache-busters, chunk hashes, timestamps, the page's own address) while the defect stays the
// same. Normalizing them lets one cause seen on many pages be recognized as one finding (F44). Conservative by design:
// a short word, a status code or a different file name is never volatile.

const MARK = '*';
/** Characters that end a URL or path inside a message. */
const END = String.raw`(?=$|[\s"'(),;:#?<>\]])`;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The page's own URL (and path) as it may appear in a message, longest first. */
function pageForms(pageUrl: string): { urls: string[]; path: string | null } {
  try {
    const u = new URL(pageUrl);
    u.hash = '';
    const bare = `${u.origin}${u.pathname}`;
    const urls = new Set([u.toString(), bare, bare.replace(/\/+$/, '')]);
    urls.delete('');
    const path = u.pathname.replace(/\/+$/, '');
    return { urls: [...urls].sort((a, b) => b.length - a.length), path: path.length > 1 ? path : null };
  } catch {
    return { urls: [], path: null };
  }
}

const RULES: [RegExp, string][] = [
  // Cache-busting query values: named busters, and any long numeric value.
  [/([?&](?:v|t|_|ts|cb|ver|nonce)=)[^&#\s"'<>)]+/gi, `$1${MARK}`],
  [/([?&][\w.-]+=)\d{8,}(?=$|[&#\s"'<>)])/g, `$1${MARK}`],
  // CSP nonces and source hashes ('nonce-…', 'sha256-…'); the literal "'nonce-...'" of the message is kept.
  [/nonce-[A-Za-z0-9+/_=-]+/g, `nonce-${MARK}`],
  [/\b(sha256|sha384|sha512)-[A-Za-z0-9+/_=-]+/g, `$1-${MARK}`],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, MARK],
  // Build hashes in file names: main-3f2a9c1b.js, app.9a8b7c6d5e.css.
  [/([A-Za-z0-9_]+)[.-](?=[0-9a-f]*\d)[0-9a-f]{8,}(\.(?:m?js|css|map))(?![\w])/g, `$1-${MARK}$2`],
  // Long hex runs, and long base64-like runs that mix letters and digits.
  [/\b[0-9a-fA-F]{16,}\b/g, MARK],
  [/(?<![A-Za-z0-9+])(?=[A-Za-z0-9+]*\d)(?=[A-Za-z0-9+]*[A-Za-z])[A-Za-z0-9+]{16,}=*(?![A-Za-z0-9+])/g, MARK],
  // Numeric timestamps (seconds or milliseconds).
  [/(?<![\w.])\d{10,}(?![\w])/g, MARK],
];

/** Replaces volatile tokens with `*`, and the page's own URL or path (when given) with `{page}`. */
export function normalizeVolatile(text: string, pageUrl?: string): string {
  let out = text;
  if (pageUrl) {
    const { urls, path } = pageForms(pageUrl);
    for (const u of urls) out = out.replace(new RegExp(`${escapeRe(u)}${END}`, 'g'), '{page}');
    if (path) out = out.replace(new RegExp(`(^|[\\s"'(=])${escapeRe(path)}${END}`, 'g'), '$1{page}');
  }
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out;
}
