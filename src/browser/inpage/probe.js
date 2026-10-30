// Runs inside the audited page. Plain JavaScript (no imports, no bundler helpers) evaluated as
// `(probe)(options)`. It only reads the DOM; it never changes the page.
(opts) => {
  // Mobile emulation zooms out to fit wide content, which inflates innerWidth; use the configured CSS viewport.
  const vw = opts.viewportWidth || document.documentElement.clientWidth || window.innerWidth;
  const vh = opts.viewportHeight || window.innerHeight;
  const sy = window.scrollY;
  const sx = window.scrollX;
  const MAX = opts.maxItems || 40;

  const cssEscape = (s) => (window.CSS?.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&'));
  const selectorOf = (el) => {
    if (!(el instanceof Element)) return '';
    for (const attr of ['data-testid', 'data-test', 'data-cy']) {
      const v = el.getAttribute(attr);
      if (v && document.querySelectorAll(`[${attr}="${CSS.escape(v)}"]`).length === 1)
        return `[${attr}="${v}"]`;
    }
    if (
      el.id &&
      !/^\d|[:]|^radix-|^react-/.test(el.id) &&
      document.querySelectorAll(`#${cssEscape(el.id)}`).length === 1
    )
      return `#${cssEscape(el.id)}`;
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && parts.length < 6) {
      let part = cur.tagName.toLowerCase();
      if (
        cur.id &&
        !/^\d|[:]/.test(cur.id) &&
        document.querySelectorAll(`#${cssEscape(cur.id)}`).length === 1
      ) {
        parts.unshift(`#${cssEscape(cur.id)}`);
        break;
      }
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left + sx),
      y: Math.round(r.top + sy),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      if (e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true') return false;
    }
    return true;
  };
  // innerText (not textContent) on purpose: it reflects rendered, visible text.
  // biome-ignore lint/performance/useDomNodeTextContent: rendered text is what users see
  const text = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria?.trim()) return aria.trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by
        .split(/\s+/)
        .map((id) => text(document.getElementById(id)))
        .join(' ')
        .trim();
      if (t) return t;
    }
    if (el.tagName === 'INPUT') return (el.value || el.getAttribute('title') || '').trim();
    const t = text(el);
    if (t) return t;
    const img = el.querySelector('img[alt]');
    if (img) return img.getAttribute('alt').trim();
    return (el.getAttribute('title') || '').trim();
  };
  const parseColor = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const bgOf = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const c = parseColor(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const colorDistance = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

  const INTERACTIVE =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
  const interactive = Array.from(document.querySelectorAll(INTERACTIVE)).filter(isVisible);

  // ---- WCAG 2.5.8 Target Size (Minimum): 24x24 CSS px, with the spacing exception. ----
  const boxes = interactive.map((el) => ({ el, r: el.getBoundingClientRect() }));
  const undersized = [];
  for (const { el, r } of boxes) {
    if (r.width >= 24 && r.height >= 24) continue;
    const cs = getComputedStyle(el);
    // Inline exception: a link inside a run of text.
    if (el.tagName === 'A' && cs.display === 'inline') {
      const parentText = text(el.parentElement);
      if (parentText.length > text(el).length + 20) continue;
    }
    // User-agent control exception: native checkbox/radio without author sizing.
    const uaControl =
      el.tagName === 'INPUT' &&
      /^(checkbox|radio)$/.test(el.type) &&
      cs.appearance !== 'none' &&
      !el.style.width;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let conflict = null;
    for (const o of boxes) {
      if (o.el === el || o.el.contains(el) || el.contains(o.el)) continue;
      // Does a 24px-diameter circle around this target reach the other target (or its circle)?
      const ox = Math.max(o.r.left, Math.min(cx, o.r.right));
      const oy = Math.max(o.r.top, Math.min(cy, o.r.bottom));
      const toBox = Math.hypot(cx - ox, cy - oy);
      const oSmall = o.r.width < 24 || o.r.height < 24;
      const toCircle = oSmall
        ? Math.hypot(cx - (o.r.left + o.r.width / 2), cy - (o.r.top + o.r.height / 2))
        : Infinity;
      if (toBox < 12 || toCircle < 24) {
        conflict = o.el;
        break;
      }
    }
    if (!conflict) continue;
    undersized.push({
      selector: selectorOf(el),
      rect: rectOf(el),
      width: Math.round(r.width * 10) / 10,
      height: Math.round(r.height * 10) / 10,
      name: nameOf(el).slice(0, 80),
      near: selectorOf(conflict),
      uaControl,
    });
    if (undersized.length >= MAX) break;
  }

  // ---- Horizontal overflow (WCAG 1.4.10 Reflow at 320px; layout bug at any width). ----
  const docWidth = Math.max(
    document.documentElement.scrollWidth,
    document.body ? document.body.scrollWidth : 0,
  );
  const overflow = { docWidth, viewportWidth: vw, offenders: [] };
  if (docWidth > vw + 1) {
    const clipped = (el) => {
      for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
        const ox = getComputedStyle(e).overflowX;
        if (ox === 'hidden' || ox === 'auto' || ox === 'scroll' || ox === 'clip') return true;
      }
      return false;
    };
    const all = Array.from(document.body.querySelectorAll('*'));
    const wide = all.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > vw + 1 && r.width > 0 && r.height > 0 && isVisible(el) && !clipped(el);
    });
    // Keep the outermost offenders: their children overflow because they do.
    const roots = wide.filter((el) => !wide.some((o) => o !== el && o.contains(el)));
    for (const el of roots.slice(0, 10)) {
      const r = el.getBoundingClientRect();
      overflow.offenders.push({
        selector: selectorOf(el),
        rect: rectOf(el),
        right: Math.round(r.right),
        width: Math.round(r.width),
        tag: el.tagName.toLowerCase(),
      });
    }
  }

  // ---- Small body text (readability heuristic; not a WCAG requirement). ----
  const small = [];
  let textEls = 0;
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || n.textContent.trim().length < 12) continue;
    seen.add(el);
    if (/^(SCRIPT|STYLE|NOSCRIPT|SVG)$/.test(el.tagName) || !isVisible(el)) continue;
    textEls++;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12 && small.length < MAX)
      small.push({
        selector: selectorOf(el),
        rect: rectOf(el),
        fontSize: fs,
        sample: n.textContent.trim().slice(0, 60),
      });
  }

  // ---- Elements that look clickable but are not reachable by keyboard (WCAG 2.1.1). ----
  const clickable = [];
  const natively = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|LABEL|OPTION|VIDEO|AUDIO)$/;
  for (const el of document.querySelectorAll('body *')) {
    if (clickable.length >= MAX) break;
    if (natively.test(el.tagName) || el.closest('a[href],button,label,summary')) continue;
    if (el.hasAttribute('tabindex') || el.getAttribute('role')) continue;
    const handler = el.hasAttribute('onclick') || getComputedStyle(el).cursor === 'pointer';
    if (!handler) continue;
    const parentPointer = el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer';
    if (parentPointer && !el.hasAttribute('onclick')) continue;
    if (!isVisible(el) || !text(el)) continue;
    if (el.querySelector(INTERACTIVE)) continue;
    clickable.push({
      selector: selectorOf(el),
      rect: rectOf(el),
      name: nameOf(el).slice(0, 80),
      tag: el.tagName.toLowerCase(),
    });
  }

  // ---- Inventory ----
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    .filter(isVisible)
    .slice(0, 60)
    .map((h) => ({ level: Number(h.tagName[1]), text: text(h).slice(0, 120) }));
  const landmarks = Array.from(
    document.querySelectorAll(
      'header,nav,main,footer,aside,[role="banner"],[role="navigation"],[role="main"],[role="contentinfo"],[role="search"],[role="complementary"]',
    ),
  ).map((e) => e.getAttribute('role') || e.tagName.toLowerCase());

  const ctas = [];
  for (const el of interactive) {
    if (!/^(A|BUTTON|INPUT)$/.test(el.tagName) && el.getAttribute('role') !== 'button') continue;
    if (el.tagName === 'INPUT' && !/^(submit|button)$/.test(el.type)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 20) continue;
    const cs = getComputedStyle(el);
    const bg = parseColor(cs.backgroundColor);
    const parentBg = bgOf(el.parentElement || document.body);
    const filled = bg && bg.a > 0.5 && colorDistance(bg, parentBg) > 60;
    const bordered = parseFloat(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none';
    const looksButton = /btn|button|cta/i.test(String(el.className)) || el.tagName !== 'A';
    const emphasis = filled ? 'primary' : bordered && looksButton ? 'secondary' : 'link';
    if (emphasis === 'link' && el.tagName === 'A') continue;
    const name = nameOf(el);
    if (!name) continue;
    ctas.push({
      text: name.slice(0, 80),
      selector: selectorOf(el),
      href: el.getAttribute('href'),
      rect: rectOf(el),
      aboveFold: r.top < vh && r.bottom > 0,
      emphasis,
    });
    if (ctas.length >= MAX) break;
  }

  const labelOf = (f) => {
    const aria = f.getAttribute('aria-label');
    if (aria?.trim()) return aria.trim();
    const by = f.getAttribute('aria-labelledby');
    if (by) {
      const t = by
        .split(/\s+/)
        .map((id) => text(document.getElementById(id)))
        .join(' ')
        .trim();
      if (t) return t;
    }
    if (f.labels?.length)
      return Array.from(f.labels)
        .map((l) => text(l))
        .join(' ')
        .trim();
    return null;
  };
  const classify = (form, fields, submitText) => {
    const blob =
      `${text(form).slice(0, 400)} ${submitText || ''} ${form.getAttribute('action') || ''} ${form.id} ${form.className}`.toLowerCase();
    const types = fields
      .map((f) => `${f.type} ${f.name || ''} ${f.autocomplete || ''}`.toLowerCase())
      .join(' ');
    const pw = fields.filter((f) => f.type === 'password').length;
    if (/cc-number|card|cvc|cvv|expir|checkout|payment|billing/.test(`${types} ${blob}`)) return 'checkout';
    if (
      form.getAttribute('role') === 'search' ||
      (/type="search"|\bsearch\b|\bq\b|query/.test(`${types} ${blob}`) && fields.length <= 2)
    )
      return 'search';
    if (/forgot|reset|recover/.test(blob) && pw === 0) return 'recovery';
    if (
      pw >= 2 ||
      (pw === 1 && /sign ?up|register|create|get started|join|new-password/.test(`${blob} ${types}`))
    )
      return 'signup';
    if (pw === 1) return 'login';
    if (/subscribe|newsletter/.test(blob) && fields.length <= 2) return 'newsletter';
    if (fields.some((f) => f.type === 'textarea') && /email/.test(types)) return 'contact';
    return 'other';
  };
  const formEls = Array.from(document.querySelectorAll('form')).filter(isVisible);
  const forms = formEls.slice(0, 20).map((form) => {
    const fields = Array.from(
      form.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea',
      ),
    )
      .filter(isVisible)
      .map((f) => ({
        selector: selectorOf(f),
        type: f.tagName === 'INPUT' ? f.type || 'text' : f.tagName.toLowerCase(),
        name: f.getAttribute('name'),
        label: labelOf(f),
        required: f.required || f.getAttribute('aria-required') === 'true',
        autocomplete: f.getAttribute('autocomplete'),
      }));
    const submit = form.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
    const submitText = submit ? nameOf(submit) : null;
    return {
      selector: selectorOf(form),
      purpose: classify(form, fields, submitText),
      action: form.getAttribute('action'),
      method: (form.getAttribute('method') || 'get').toLowerCase(),
      fields,
      submitText,
    };
  });

  const links = [];
  for (const a of document.querySelectorAll('a[href]')) {
    if (links.length >= 300) break;
    const href = a.href;
    if (!/^https?:/.test(href)) continue;
    links.push({ href, text: nameOf(a).slice(0, 80), internal: new URL(href).origin === location.origin });
  }

  const imgs = Array.from(document.images);
  const bodyText = text(document.body).slice(0, 200000);
  const lower = bodyText.toLowerCase();
  const TRUST = [
    ['testimonials', /testimonial|what (our )?customers say|reviews?\b/],
    ['ratings', /★|\b[1-5](\.\d)? ?(\/ ?5|out of 5|stars?)\b/],
    ['customer logos', /trusted by|used by|loved by|customers include|companies (use|trust)/],
    ['guarantee', /money.back|guarantee|risk.free|cancel any ?time/],
    ['security', /\bsecure\b|encrypt|ssl|soc ?2|iso ?27001|gdpr|hipaa|pci/],
    [
      'social proof numbers',
      /\b\d[\d,.]*\+? ?(k\b|m\b|million|thousand)?\s*(users|customers|teams|companies|developers)\b/,
    ],
    ['case studies', /case stud(y|ies)/],
  ];
  const trustSignals = TRUST.filter(([, re]) => re.test(lower)).map(([n]) => n);
  if (links.some((l) => /privacy/i.test(l.text) || /privacy/i.test(l.href)))
    trustSignals.push('privacy policy link');
  const PRICING = [
    ['price amounts', /[$€£¥₺]\s?\d|\d\s?(usd|eur|gbp|try)\b/],
    [
      'billing period',
      /\/ ?(mo|month|yr|year)\b|per (month|year|user|seat)|billed (annually|monthly|yearly)/,
    ],
    ['free trial', /free trial|try (it )?free|start free/],
    ['free plan', /\bfree plan\b|\bfree forever\b|\$0\b/],
  ];
  const pricingSignals = PRICING.filter(([, re]) => re.test(lower)).map(([n]) => n);

  return {
    inventory: {
      lang: document.documentElement.getAttribute('lang'),
      h1: headings.filter((h) => h.level === 1).map((h) => h.text),
      headings,
      landmarks: Array.from(new Set(landmarks)),
      ctas,
      forms,
      links,
      images: {
        total: imgs.length,
        withoutAlt: imgs.filter((i) => !i.hasAttribute('alt')).length,
        withoutDimensions: imgs.filter(
          (i) =>
            isVisible(i) &&
            !(i.getAttribute('width') && i.getAttribute('height')) &&
            !getComputedStyle(i).aspectRatio.includes('/'),
        ).length,
      },
      trustSignals,
      pricingSignals,
      wordCount: bodyText ? bodyText.split(/\s+/).length : 0,
      metaDescription: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
      hasViewportMeta: !!document.querySelector('meta[name="viewport"]'),
    },
    undersized,
    overflow,
    smallText: { checked: textEls, samples: small },
    clickable,
    scroll: { height: document.documentElement.scrollHeight, width: docWidth },
  };
};
