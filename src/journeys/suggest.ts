// Journey discovery: derives candidate journeys from what a run actually measured (CTAs, global navigation,
// forms and their purpose). Suggestions are marked source: "suggested" and should be reviewed; they are a
// starting point, not a claim about what the product's key journeys are.
import { pathOf } from '../audit/finding.js';
import { slug } from '../core/hash.js';
import { lexicon } from '../core/lexicon.js';
import type { FieldInfo, FormInfo, PageCapture, Run, ToggleInfo } from '../core/types.js';
import type { JourneySpec, Step, Target } from './schema.js';

function fieldTarget(f: FieldInfo): Target {
  if (f.label) return { label: f.label, exact: true };
  if (f.placeholder) return { placeholder: f.placeholder };
  if (f.name) return { css: `[name="${f.name.replace(/"/g, '\\"')}"]` };
  return { css: f.selector };
}

export function valueFor(f: FieldInfo): string | null {
  const s = `${f.type} ${f.name ?? ''} ${f.label ?? ''} ${f.autocomplete ?? ''}`.toLowerCase();
  if (f.type === 'checkbox' || f.type === 'radio' || f.type === 'file' || f.type === 'hidden') return null;
  if (f.type === 'password') return '{{password}}';
  if (f.type === 'email' || /e-?mail|e-?posta|correo|courriel/.test(s)) return '{{email}}';
  if (f.type === 'tel' || /phone|tel|mobile|cep|handy|móvil/.test(s)) return '{{phone}}';
  if (f.type === 'search' || /search|query|\bq\b|arama|suche|buscar|recherche/.test(s)) return '{{search}}';
  if (/first|given|vorname|prénom|given-name/.test(s)) return '{{firstName}}';
  if (/last|family|surname|soyad|nachname|apellido/.test(s)) return '{{lastName}}';
  if (/company|organi[sz]ation|şirket|firma|empresa|entreprise/.test(s)) return '{{company}}';
  if (/zip|postal|posta kodu|plz/.test(s)) return '{{zip}}';
  if (/card|cc-number|kart|karte|tarjeta|carte/.test(s)) return '{{testCard}}';
  if (/name|user|isim|\bad\b|nombre|\bnom\b|kullanıcı/.test(s)) return '{{name}}';
  if (f.type === 'textarea' || f.type === 'text') return 'Jourilo test message';
  if (f.type === 'number') return '1';
  return null;
}

function formJourney(page: PageCapture, form: FormInfo): JourneySpec | null {
  const path = pathOf(page.url).split('?')[0]!;
  const steps: Step[] = [];
  for (const f of form.fields) {
    if (f.type === 'select') continue;
    if (f.type === 'checkbox') {
      if (f.required) steps.push({ action: 'check', target: fieldTarget(f) });
      continue;
    }
    const v = valueFor(f);
    if (v) steps.push({ action: 'fill', target: fieldTarget(f), value: v });
  }
  if (!steps.length) return null;
  const submit: Step = form.submitText
    ? { action: 'click', target: { role: 'button', name: form.submitText, exact: true } }
    : { action: 'press', key: 'Enter', target: fieldTarget(form.fields.find((f) => valueFor(f))!) };
  steps.push(submit);
  const names: Record<string, string> = {
    signup: 'Create an account',
    login: 'Sign in',
    search: 'Search the site',
    checkout: 'Complete checkout (sandbox)',
    contact: 'Send a contact message',
    newsletter: 'Subscribe to the newsletter',
    recovery: 'Request a password reset',
    other: 'Submit the form',
  };
  const id = slug(`${form.purpose}-${path === '/' ? 'home' : path}`, 60);
  return {
    version: 1,
    id,
    name: `${names[form.purpose]} (${path})`,
    goal: names[form.purpose]!.toLowerCase(),
    start: path,
    steps,
    success: [
      ...(form.purpose === 'login'
        ? []
        : [{ description: 'Leaves the form page or shows a result', urlNot: path === '/' ? '/' : path }]),
      { description: 'No uncaught exceptions', noPageErrors: true },
      { description: 'No failed first-party requests', noFailedRequests: true },
    ].filter((c) => !(form.purpose === 'search' && 'urlNot' in c)),
    safety: { submitsForms: true, destructive: form.purpose === 'checkout' },
    source: 'suggested',
    tags: ['form', form.purpose],
  };
}

const TOGGLE_UI = lexicon('toggle-ui');
/** A button without a destination that is named like a theme or language switch is not a call to action. */
const isUiSwitch = (c: { text: string; href: string | null }) => !c.href && TOGGLE_UI.test(c.text);
const DESTRUCTIVE = lexicon('destructive');

/** Opens a collapsed disclosure or presses a toggle and checks the visible result; null when nothing can be checked. */
export function toggleJourney(page: PageCapture, toggle: ToggleInfo): JourneySpec | null {
  if (DESTRUCTIVE.test(toggle.name)) return null;
  const path = pathOf(page.url).split('?')[0]!;
  let check: Step;
  if (toggle.state === 'expanded') {
    if (!toggle.controls) return null;
    const id = toggle.controls;
    check = {
      action: 'expect',
      visible: { css: /^[A-Za-z][\w-]*$/.test(id) ? `#${id}` : `[id="${id.replace(/"/g, '\\"')}"]` },
    };
  } else {
    check = { action: 'expect', visible: { css: `${toggle.selector}[aria-pressed="true"]` } };
  }
  return {
    version: 1,
    id: slug(`toggle-${toggle.name}-${path === '/' ? 'home' : path}`, 60),
    name: `${toggle.state === 'expanded' ? 'Open' : 'Press'} "${toggle.name}" (${path})`,
    goal: toggle.state === 'expanded' ? 'reveal the hidden content' : 'switch the control on',
    start: path,
    steps: [{ action: 'click', target: { role: 'button', name: toggle.name, exact: true } }, check],
    success: [{ description: 'No uncaught exceptions', noPageErrors: true }],
    safety: { submitsForms: false },
    source: 'suggested',
    tags: ['toggle', toggle.state],
  };
}

export function suggestJourneys(run: Run): JourneySpec[] {
  const out: JourneySpec[] = [];
  const desktop = run.pages.filter((p) => p.viewport === run.viewports[0]?.name && (p.status ?? 200) < 400);
  const seen = new Set<string>();
  const push = (j: JourneySpec | null) => {
    if (!j || seen.has(j.id)) return;
    seen.add(j.id);
    out.push(j);
  };

  // 1. The landing page's primary call to action.
  const home = desktop.find((p) => pathOf(p.url).split('?')[0] === '/') ?? desktop[0];
  const cta = home?.inventory.ctas.find((c) => c.emphasis === 'primary' && c.aboveFold && !isUiSwitch(c));
  if (home && cta) {
    const href = cta.href && !cta.href.startsWith('#') ? cta.href : null;
    const dest = href ? pathOf(new URL(href, home.url).toString()).split('?')[0]! : null;
    push({
      version: 1,
      id: 'landing-primary-cta',
      name: `Follow the main call to action ("${cta.text}")`,
      goal: 'move from the landing page to the next step of the funnel',
      start: pathOf(home.url),
      steps: [{ action: 'click', target: { role: href ? 'link' : 'button', name: cta.text, exact: true } }],
      success: [
        dest && dest !== '/'
          ? { description: `Arrives at ${dest}`, url: dest }
          : { description: 'Leaves the landing page', urlNot: '/' },
        { description: 'No uncaught exceptions', noPageErrors: true },
      ],
      safety: { submitsForms: false },
      source: 'suggested',
      tags: ['conversion', 'cta'],
    });
  }

  // 2. Global navigation: links present on most pages.
  const counts = new Map<string, { text: string; href: string; n: number }>();
  for (const p of desktop) {
    const uniq = new Map(
      p.inventory.links.filter((l) => l.internal && l.text).map((l) => [`${l.text}|${pathOf(l.href)}`, l]),
    );
    for (const [k, l] of uniq) {
      const c = counts.get(k) ?? { text: l.text, href: l.href, n: 0 };
      c.n++;
      counts.set(k, c);
    }
  }
  const nav = [...counts.values()]
    .filter((c) => c.n >= Math.max(2, Math.ceil(desktop.length * 0.6)) && pathOf(c.href) !== '/')
    .slice(0, 6);
  if (home && nav.length) {
    push({
      version: 1,
      id: 'global-navigation',
      name: 'Reach each main section from the navigation',
      goal: 'find the main sections of the product',
      start: pathOf(home.url),
      steps: nav.flatMap((n) => [
        { action: 'click', target: { role: 'link', name: n.text, exact: true } } as Step,
        { action: 'expect', url: pathOf(n.href).split('?')[0]! } as Step,
        { action: 'goto', url: pathOf(home.url) } as Step,
      ]),
      success: [
        { description: 'No uncaught exceptions', noPageErrors: true },
        { description: 'No failed first-party requests', noFailedRequests: true },
      ],
      safety: { submitsForms: false },
      source: 'suggested',
      tags: ['navigation'],
    });
  }

  // 3. Forms by purpose.
  for (const p of desktop) for (const f of p.inventory.forms) push(formJourney(p, f));

  // 4. Pricing → next step.
  const pricing = desktop.find((p) => /pric|plans/i.test(pathOf(p.url)));
  const planCta = pricing?.inventory.ctas.find(
    (c) => c.emphasis === 'primary' && c.href && !c.href.startsWith('#') && !isUiSwitch(c),
  );
  if (pricing && planCta) {
    push({
      version: 1,
      id: 'pricing-to-signup',
      name: `Choose a plan on ${pathOf(pricing.url)} ("${planCta.text}")`,
      goal: 'choose a plan and continue',
      start: pathOf(pricing.url),
      steps: [{ action: 'click', target: { role: 'link', name: planCta.text, exact: true } }],
      success: [
        { description: 'Leaves the pricing page', urlNot: pathOf(pricing.url).split('?')[0]! },
        { description: 'No uncaught exceptions', noPageErrors: true },
      ],
      safety: { submitsForms: false },
      source: 'suggested',
      tags: ['conversion', 'pricing'],
    });
  }

  // 5. Disclosures and toggles, after the funnel journeys (at most 3 per run).
  let toggleCount = 0;
  for (const p of desktop) {
    for (const t of p.inventory.toggles ?? []) {
      if (toggleCount >= 3) break;
      const j = toggleJourney(p, t);
      if (j && !seen.has(j.id)) {
        push(j);
        toggleCount++;
      }
    }
  }
  return out;
}
