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

/** Upper case, lower case and digit: the character classes a token alternates between. */
const charClass = (c: string) => (/\d/.test(c) ? 0 : c === c.toUpperCase() ? 1 : 2);

/**
 * A base64-like run is volatile only when it looks random: it has a letter and a digit and switches character class
 * (upper, lower, digit) at least every 2.5 characters on average. Random base64 switches about every 1.5 characters;
 * a readable identifier such as `ProductCard2024Summer` or `iphone15promax256gb` keeps long runs of one class and
 * stays as it is. A run whose letters sit mostly (60% or more) in words (`[A-Z]?[a-z]{3,}`, as in
 * `Icon24ArrowLeftBold` or `HeaderV2Mobile3Dark`) is readable and kept too, however often it switches class. Both
 * tests err on the safe side: a random token taken for readable only prevents a collapse.
 * `+` and `/` split runs, so a path or a `+`-joined query never counts as one token.
 */
function randomLooking(run: string): boolean {
  const body = run.replace(/=+$/, '');
  if (!/\d/.test(body) || !/[A-Za-z]/.test(body)) return false;
  const letters = body.replace(/[^A-Za-z]/g, '').length;
  const inWords = (body.match(/[A-Z]?[a-z]{3,}/g) ?? []).join('').length;
  if (inWords >= 0.6 * letters) return false;
  let switches = 0;
  for (let i = 1; i < body.length; i++) if (charClass(body[i]!) !== charClass(body[i - 1]!)) switches++;
  return switches >= 0.4 * (body.length - 1);
}

/** A cache-buster value that changes per build or load: digits or a version, a hex hash, or a random-looking token. */
const volatileValue = (v: string) =>
  /^[\d.]+$/.test(v) || (/^[0-9a-f]{6,}$/i.test(v) && /\d/.test(v)) || (v.length >= 16 && randomLooking(v));

const RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  // Cache-busting query values: named busters whose value looks volatile (never a word or a readable id), and any
  // long numeric value.
  [
    /([?&](?:v|t|_|ts|cb|ver|nonce)=)([^&#\s"'<>)]+)/gi,
    (m, key, v) => (volatileValue(v!) ? `${key}${MARK}` : m!),
  ],
  [/([?&][\w.-]+=)\d{8,}(?=$|[&#\s"'<>)])/g, `$1${MARK}`],
  // CSP nonces and source hashes ('nonce-…', 'sha256-…'); the literal "'nonce-...'" of the message is kept.
  [/nonce-[A-Za-z0-9+/_=-]+/g, `nonce-${MARK}`],
  [/\b(sha256|sha384|sha512)-[A-Za-z0-9+/_=-]+/g, `$1-${MARK}`],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, MARK],
  // Build hashes in file names: main-3f2a9c1b.js, app.9a8b7c6d5e.css.
  [/([A-Za-z0-9_]+)[.-](?=[0-9a-f]*\d)[0-9a-f]{8,}(\.(?:m?js|css|map))(?![\w])/g, `$1-${MARK}$2`],
  // Long hex runs with a digit, and long base64-like runs that look random (see randomLooking).
  [/\b(?=[0-9a-fA-F]*\d)[0-9a-fA-F]{16,}\b/g, MARK],
  [/(?<![A-Za-z0-9])[A-Za-z0-9]{16,}=*(?![A-Za-z0-9=])/g, (m) => (randomLooking(m!) ? MARK : m!)],
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
  for (const [re, to] of RULES) out = typeof to === 'string' ? out.replace(re, to) : out.replace(re, to);
  return out;
}
