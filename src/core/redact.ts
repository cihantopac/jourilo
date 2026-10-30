// Redaction applied to everything Jourilo writes: console text, URLs, HTML excerpts, journey logs.
// Screenshots are masked separately (see browser/capture.ts) because pixels cannot be regex-redacted.

const SENSITIVE_PARAM =
  /^(?:.*[-_])?(token|access[-_]?token|refresh[-_]?token|id[-_]?token|auth|authorization|key|api[-_]?key|apikey|secret|client[-_]?secret|password|passwd|pwd|session|sessionid|sid|jwt|code|signature|sig|otp|ssn|email|phone)$/i;

const PATTERNS: [RegExp, string][] = [
  // JSON Web Tokens
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, '[redacted:jwt]'],
  // Bearer / Basic credentials
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  // Common provider key shapes (Stripe, GitHub, Slack, AWS, Anthropic/OpenAI style)
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}\b/g, '[redacted:key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[redacted:key]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, '[redacted:key]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted:key]'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[redacted:key]'],
  // Card-like digit runs (13-19 digits, optional separators)
  [/\b(?:\d[ -]?){12,18}\d\b/g, '[redacted:number]'],
  // E-mail addresses
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted:email]'],
  // key=value / "key": "value" pairs for sensitive keys
  [
    /\b(password|passwd|pwd|secret|token|api[-_]?key|authorization|cookie|set-cookie|session[-_]?id)(["']?\s*[:=]\s*["']?)([^"'\s&,;}]{3,})/gi,
    '$1$2[redacted]',
  ],
];

export function redactText(input: string): string {
  let out = input;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Removes credentials, fragments that look like tokens, and sensitive query parameters from a URL. */
export function redactUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return redactText(raw);
  }
  if (url.username || url.password) {
    url.username = 'redacted';
    url.password = '';
  }
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_PARAM.test(key)) url.searchParams.set(key, 'redacted');
  }
  if (url.hash && /(access_token|id_token|token|code)=/i.test(url.hash)) url.hash = '#redacted';
  return redactText(url.toString()).replace(/redacted%5D/g, 'redacted]');
}

/** Short excerpt of untrusted page content, redacted and length-limited. */
export function excerpt(input: string | null | undefined, max = 240): string {
  if (!input) return '';
  const clean = redactText(input.replace(/\s+/g, ' ').trim());
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
