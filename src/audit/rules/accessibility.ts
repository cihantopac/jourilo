// Accessibility rules: axe-core results mapped to findings, plus Jourilo's own measured checks for things axe
// does not cover from a static DOM scan (keyboard focus behavior, real tab order, input purpose).
import type { PageObservation } from '../../browser/capture.js';
import type { Evidence, Finding, Severity } from '../../core/types.js';
import { makeFinding } from '../finding.js';
import { nielsen, wcag, wcagFromAxeTags } from '../standards.js';

const AXE_ADVICE: Record<string, string> = {
  'color-contrast':
    'Raise the contrast between text and its background to at least 4.5:1 (3:1 for large text: 24 px, or 18.66 px bold). Prefer adjusting the design token rather than one-off overrides.',
  'image-alt':
    'Give informative images a concise alt text that conveys their purpose; give decorative images alt="".',
  label: 'Associate a visible <label> with every form control (for/id or wrapping), not only a placeholder.',
  'button-name': 'Give every button an accessible name: visible text, or aria-label for icon-only buttons.',
  'link-name': 'Give every link discernible text: visible text, or aria-label for icon-only links.',
  'html-has-lang': 'Add a lang attribute to <html> that matches the page language (e.g. lang="en").',
  'html-lang-valid': 'Use a valid BCP 47 language tag in <html lang>.',
  'document-title': 'Give every page a unique, descriptive <title>.',
  'meta-viewport': 'Remove maximum-scale / user-scalable=no from the viewport meta tag so people can zoom.',
  region:
    'Place all content inside landmarks (header, nav, main, footer) so screen-reader users can navigate.',
  'landmark-one-main': 'Wrap the primary content of each page in a single <main> element.',
  'page-has-heading-one': 'Give each page one <h1> that names its main topic.',
  'heading-order': 'Do not skip heading levels; nest headings in order (h1 → h2 → h3).',
  'target-size':
    'Make pointer targets at least 24×24 CSS px, or space them so a 24 px circle around each does not overlap others.',
  'autocomplete-valid': 'Use valid autocomplete tokens (e.g. email, given-name, new-password).',
  'select-name': 'Associate a <label> with every <select>.',
  'nested-interactive': 'Do not put interactive controls inside other interactive controls.',
  'scrollable-region-focusable': 'Make scrollable regions keyboard-focusable (tabindex="0") and named.',
  'aria-allowed-attr': "Only use ARIA attributes allowed for the element's role.",
  'aria-required-children': 'Include the child roles the parent role requires (e.g. listitems inside list).',
  'duplicate-id-aria': 'Make ids referenced by ARIA attributes unique.',
  'link-in-text-block':
    'Distinguish links inside text by more than color (underline), or give them 3:1 contrast with surrounding text plus a non-color cue on focus/hover.',
  list: 'Only put <li>, <script> or <template> directly inside <ul>/<ol>.',
  'frame-title': 'Give every <iframe> a title describing its content.',
  'input-button-name': 'Give input buttons a value or aria-label.',
};

const SEVERITY: Record<string, Severity> = {
  critical: 'critical',
  serious: 'serious',
  moderate: 'moderate',
  minor: 'minor',
};

export function axeFindings(obs: PageObservation): Finding[] {
  if (!obs.axe) return [];
  const out: Finding[] = [];
  const vp = obs.viewport.name;
  for (const issue of obs.axe.violations) {
    const standards = wcagFromAxeTags(issue.tags);
    const bestPracticeOnly = standards.length === 0;
    if (bestPracticeOnly) {
      standards.push({
        standard: 'axe-core best practice',
        id: issue.id,
        title: issue.help,
        url: issue.helpUrl,
      });
    } else {
      standards.push({ standard: 'axe-core rule', id: issue.id, title: issue.help, url: issue.helpUrl });
    }
    let severity = SEVERITY[issue.impact ?? ''] ?? 'moderate';
    if (bestPracticeOnly && (severity === 'critical' || severity === 'serious')) severity = 'moderate';
    const evidence: Evidence[] = issue.nodes.map((n) => ({
      type: 'element',
      selector: n.target,
      snippet: n.html,
      ...(n.rect ? { rect: n.rect } : {}),
      ...(obs.screenshot ? { file: obs.screenshot } : {}),
      ...(n.data ? { data: pickData(n.data) } : {}),
      note: firstLine(n.summary),
    }));
    out.push(
      makeFinding({
        ruleId: `axe/${issue.id}`,
        title: issue.help,
        category: 'accessibility',
        kind: 'defect',
        severity,
        confidence: 'high',
        provenance: 'measured',
        url: obs.url,
        viewport: vp,
        description: issue.description,
        impact: bestPracticeOnly
          ? 'Not a WCAG failure on its own, but makes the page harder to use with assistive technology.'
          : `Fails WCAG ${standards
              .filter((s) => s.standard.startsWith('WCAG'))
              .map((s) => s.id)
              .join(', ')}: people using assistive technology, keyboards or low vision may be blocked.`,
        recommendation: AXE_ADVICE[issue.id] ?? `${issue.help}. See ${issue.helpUrl}`,
        standards,
        evidence,
        occurrences: issue.nodes.length,
        reproduction: [
          `Open ${obs.url} at the ${vp} viewport.`,
          `Run axe-core ${obs.axe.version} (rule "${issue.id}") or inspect: ${issue.nodes
            .slice(0, 3)
            .map((n) => `\`${n.target}\``)
            .join(', ')}.`,
        ],
      }),
    );
  }
  for (const issue of obs.axe.incomplete) {
    // Only surface manual-review items that relate to WCAG; best-practice "incomplete" items are noise.
    const standards = wcagFromAxeTags(issue.tags);
    if (!standards.length) continue;
    out.push(
      makeFinding({
        ruleId: `axe-review/${issue.id}`,
        title: `Needs manual review: ${issue.help}`,
        category: 'accessibility',
        kind: 'needs-review',
        severity: 'minor',
        confidence: 'low',
        provenance: 'measured',
        url: obs.url,
        viewport: vp,
        description: `axe-core could not decide this automatically (${issue.description}). A person must check it.`,
        impact: 'Unknown until reviewed.',
        recommendation: `Check each listed element by hand. ${issue.helpUrl}`,
        standards: [
          ...standards,
          { standard: 'axe-core rule', id: issue.id, title: issue.help, url: issue.helpUrl },
        ],
        evidence: issue.nodes.slice(0, 8).map((n) => ({
          type: 'element',
          selector: n.target,
          snippet: n.html,
          ...(n.rect ? { rect: n.rect } : {}),
          ...(obs.screenshot ? { file: obs.screenshot } : {}),
          note: firstLine(n.summary),
        })),
        occurrences: issue.nodes.length,
      }),
    );
  }
  return out;
}

function firstLine(s: string): string {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
}

function pickData(d: Record<string, unknown>): Record<string, unknown> {
  const keep = [
    'fgColor',
    'bgColor',
    'contrastRatio',
    'expectedContrastRatio',
    'fontSize',
    'fontWeight',
    'messageKey',
  ];
  const out: Record<string, unknown> = {};
  for (const k of keep) if (k in d) out[k] = d[k];
  return out;
}

export function keyboardFindings(obs: PageObservation): Finding[] {
  const kb = obs.keyboard;
  if (!kb) return [];
  const out: Finding[] = [];
  const vp = obs.viewport.name;
  const shot = obs.screenshot ? { file: obs.screenshot } : {};

  const invisible = kb.stops.filter((s) => s.indicatorChecked && s.indicatorChanges.length === 0);
  if (invisible.length) {
    out.push(
      makeFinding({
        ruleId: 'jourilo/focus-visible',
        title: 'Keyboard focus is not visible',
        category: 'accessibility',
        kind: 'defect',
        severity: 'serious',
        confidence: 'high',
        provenance: 'measured',
        url: obs.url,
        viewport: vp,
        description: `${invisible.length} of ${kb.stops.length} elements reached with Tab look exactly the same focused and unfocused (outline, box-shadow, border, background, color, underline and the parent's styles were compared).`,
        impact: 'Keyboard users cannot see where they are on the page, so they cannot operate it reliably.',
        recommendation:
          'Do not remove the focus outline without a replacement. Add a clearly visible :focus-visible style (e.g. a 2 px outline with 3:1 contrast) to the shared button/link/input components.',
        standards: [wcag('2.4.7')],
        evidence: invisible.slice(0, 10).map((s) => ({
          type: 'element' as const,
          selector: s.selector,
          rect: s.rect,
          snippet: s.name,
          note: `Tab stop #${s.index + 1}`,
          ...shot,
        })),
        occurrences: invisible.length,
        reproduction: [
          `Open ${obs.url} at the ${vp} viewport.`,
          `Press Tab ${invisible[0]!.index + 1} time(s) from the top of the page.`,
          `Observe that \`${invisible[0]!.selector}\` has focus but shows no focus indicator.`,
        ],
      }),
    );
  }

  const obscured = kb.stops.filter((s) => s.obscured);
  if (obscured.length) {
    out.push(
      makeFinding({
        ruleId: 'jourilo/focus-obscured',
        title: 'Focused element is hidden behind fixed or sticky content',
        category: 'accessibility',
        kind: 'defect',
        severity: 'serious',
        confidence: 'high',
        provenance: 'measured',
        url: obs.url,
        viewport: vp,
        description: `${obscured.length} element(s) received keyboard focus while entirely covered by a fixed or sticky element (checked with elementFromPoint at five points).`,
        impact: 'Keyboard users lose track of focus behind headers, banners or chat widgets.',
        recommendation:
          'Add scroll-padding-top (and scroll-padding-bottom) equal to the sticky header/footer height, or make the overlay dismissible.',
        standards: [wcag('2.4.11')],
        evidence: obscured.slice(0, 10).map((s) => ({
          type: 'element' as const,
          selector: s.selector,
          rect: s.rect,
          snippet: s.name,
          ...shot,
        })),
        occurrences: obscured.length,
      }),
    );
  }

  if (kb.trap) {
    out.push(
      makeFinding({
        ruleId: 'jourilo/keyboard-trap',
        title: 'Keyboard focus is trapped',
        category: 'accessibility',
        kind: 'defect',
        severity: 'critical',
        confidence: 'medium',
        provenance: 'observed',
        url: obs.url,
        viewport: vp,
        description: `Pressing Tab cycled between ${kb.trap.selectors.length} element(s) outside any modal dialog while the page has ${kb.focusableCount} focusable elements.`,
        impact: 'Keyboard users cannot reach the rest of the page and may have to reload it.',
        recommendation:
          'Remove custom keydown handlers that intercept Tab outside dialogs; if this is a dialog, mark it aria-modal="true" and provide Escape to close.',
        standards: [wcag('2.1.2')],
        evidence: kb.trap.selectors.map((s) => ({ type: 'element' as const, selector: s })),
        occurrences: 1,
      }),
    );
  }
  return out;
}

export function measuredA11yFindings(obs: PageObservation): Finding[] {
  const p = obs.probe;
  if (!p) return [];
  const out: Finding[] = [];
  const vp = obs.viewport.name;
  const shot = obs.screenshot ? { file: obs.screenshot } : {};

  // axe's target-size rule (explicitly enabled) is preferred; this probe covers runs without axe.
  const small = p.undersized.filter((u) => !u.uaControl);
  if (small.length && !obs.axe) {
    out.push(
      makeFinding({
        ruleId: 'jourilo/target-size',
        title: 'Touch/pointer targets smaller than 24×24 px',
        category: 'accessibility',
        kind: 'defect',
        severity: 'serious',
        confidence: 'high',
        provenance: 'measured',
        url: obs.url,
        viewport: vp,
        description: `${small.length} target(s) are under 24×24 CSS px and too close to a neighbouring target.`,
        impact: 'People with tremors, large fingers or imprecise pointers hit the wrong control.',
        recommendation:
          'Increase the hit area to at least 24×24 px (44×44 px is better on touch) with padding, or add spacing.',
        standards: [wcag('2.5.8')],
        evidence: small.slice(0, 10).map((u) => ({
          type: 'element' as const,
          selector: u.selector,
          rect: u.rect,
          snippet: u.name,
          data: { width: u.width, height: u.height, near: u.near },
          ...shot,
        })),
        occurrences: small.length,
      }),
    );
  }

  if (p.clickable.length) {
    out.push(
      makeFinding({
        ruleId: 'jourilo/pointer-only-control',
        title: 'Clickable elements that keyboard users cannot reach',
        category: 'accessibility',
        kind: 'defect',
        severity: 'serious',
        confidence: 'medium',
        provenance: 'heuristic',
        url: obs.url,
        viewport: vp,
        description: `${p.clickable.length} non-interactive element(s) look clickable (pointer cursor or onclick) but are not buttons/links and have no tabindex or role.`,
        impact: 'Keyboard and screen-reader users cannot activate these controls.',
        recommendation: 'Use a <button> (or <a href> for navigation) instead of a clickable <div>/<span>.',
        standards: [wcag('2.1.1'), wcag('4.1.2')],
        evidence: p.clickable.slice(0, 10).map((c) => ({
          type: 'element' as const,
          selector: c.selector,
          rect: c.rect,
          snippet: `<${c.tag}> ${c.name}`,
          ...shot,
        })),
        occurrences: p.clickable.length,
      }),
    );
  }

  if (p.pasteBlocked?.length) {
    out.push(
      makeFinding({
        ruleId: 'jourilo/paste-blocked',
        title: 'Pasting into password or code fields is blocked',
        category: 'accessibility',
        kind: 'defect',
        severity: 'serious',
        confidence: 'high',
        provenance: 'measured',
        url: obs.url,
        viewport: vp,
        description: `${p.pasteBlocked.length} credential field(s) cancel paste events, so passwords cannot be pasted from a password manager.`,
        impact:
          'People who rely on password managers or cannot memorize and transcribe passwords (cognitive and motor disabilities) are locked out.',
        recommendation:
          'Remove the paste blocking (onpaste handlers / preventDefault on paste) from credential fields.',
        standards: [wcag('3.3.8')],
        evidence: p.pasteBlocked.map((f) => ({
          type: 'element' as const,
          selector: f.selector,
          rect: f.rect,
          snippet: `<input type="${f.type}">`,
          ...shot,
        })),
        occurrences: p.pasteBlocked.length,
      }),
    );
  }

  // Input purpose (1.3.5) and placeholder-as-label checks over discovered forms.
  const PURPOSE =
    /email|e-mail|name|phone|tel|mobile|address|street|city|zip|postal|country|username|user|birthday|organization|company/i;
  for (const form of p.inventory.forms) {
    const missing = form.fields.filter(
      (f) =>
        (f.type === 'email' ||
          f.type === 'tel' ||
          f.type === 'password' ||
          PURPOSE.test(`${f.name ?? ''} ${f.label ?? ''}`)) &&
        !f.autocomplete &&
        f.type !== 'search' &&
        f.type !== 'checkbox' &&
        f.type !== 'radio',
    );
    if (missing.length && form.purpose !== 'search') {
      out.push(
        makeFinding({
          ruleId: 'jourilo/input-purpose',
          key: form.selector,
          title: 'Personal-data fields without autocomplete',
          category: 'accessibility',
          kind: 'defect',
          severity: 'moderate',
          confidence: 'medium',
          provenance: 'heuristic',
          url: obs.url,
          viewport: vp,
          description: `${missing.length} field(s) in the ${form.purpose} form collect information about the user but have no autocomplete attribute.`,
          impact:
            'Browsers and password managers cannot fill them; people with motor or cognitive disabilities type more.',
          recommendation: `Add autocomplete tokens, e.g. ${missing
            .slice(0, 4)
            .map((f) => `${f.name ?? f.type} → ${suggestAutocomplete(f.type, f.name, f.label, form.purpose)}`)
            .join(', ')}.`,
          standards: [wcag('1.3.5')],
          evidence: missing.map((f) => ({
            type: 'element' as const,
            selector: f.selector,
            snippet: `${f.type} name=${f.name ?? '∅'} label=${f.label ?? '∅'}`,
          })),
          occurrences: missing.length,
        }),
      );
    }
    const unlabeled = form.fields.filter((f) => !f.label && f.type !== 'hidden');
    if (unlabeled.length && !obs.axe?.violations.some((v) => v.id === 'label')) {
      out.push(
        makeFinding({
          ruleId: 'jourilo/placeholder-label',
          key: form.selector,
          title: 'Form fields rely on placeholder text instead of a label',
          category: 'usability',
          kind: 'defect',
          severity: 'moderate',
          confidence: 'high',
          provenance: 'measured',
          url: obs.url,
          viewport: vp,
          description: `${unlabeled.length} field(s) in the ${form.purpose} form have no <label>, aria-label or aria-labelledby; their only hint is placeholder text, which disappears while typing.`,
          impact:
            'People forget what a field asks for once they start typing; low-contrast placeholders are hard to read.',
          recommendation: 'Add a visible <label for> to each field; keep placeholders for examples only.',
          standards: [wcag('3.3.2')],
          evidence: unlabeled.map((f) => ({
            type: 'element' as const,
            selector: f.selector,
            snippet: `${f.type} name=${f.name ?? '∅'}`,
          })),
          occurrences: unlabeled.length,
        }),
      );
    }
  }
  return out;
}

export function suggestAutocomplete(
  type: string,
  name: string | null,
  label: string | null,
  purpose: string,
): string {
  // Field names and labels in en, tr, de, es, fr.
  const s = `${name ?? ''} ${label ?? ''}`.toLowerCase();
  if (type === 'password') return purpose === 'signup' ? 'new-password' : 'current-password';
  if (type === 'email' || /e-?mail|e-?posta|correo|courriel/.test(s)) return 'email';
  if (type === 'tel' || /phone|tel|mobile|cep|handy|móvil|portable/.test(s)) return 'tel';
  if (/first|given|vorname|prénom|^\s*ad\b|\bad\s*$|nombre(?! de usuario)/.test(s)) return 'given-name';
  if (/last|family|surname|soyad|nachname|apellido|\bnom de famille\b/.test(s)) return 'family-name';
  if (/user|kullanıcı adı|benutzername|usuario|identifiant/.test(s)) return 'username';
  if (/zip|postal|posta kodu|plz|postleitzahl|código postal|code postal/.test(s)) return 'postal-code';
  if (/city|town|şehir|\bil\b|stadt|\bort\b|ciudad|ville/.test(s)) return 'address-level2';
  if (/country|ülke|land|país|pays/.test(s)) return 'country-name';
  if (/street|address|adres|straße|strasse|dirección|adresse/.test(s)) return 'street-address';
  if (/company|organi[sz]ation|şirket|firma|unternehmen|empresa|entreprise|société/.test(s))
    return 'organization';
  if (/name|isim|\bad\b|nombre|\bnom\b/.test(s)) return 'name';
  return 'on (choose the matching token)';
}

const WIDGET_RULES: Record<
  NonNullable<PageObservation['widgets']>['issues'][number]['kind'],
  {
    ruleId: string;
    title: string;
    severity: Severity;
    impact: string;
    recommendation: string;
    standards: Finding['standards'];
  }
> = {
  'dialog-focus-not-moved': {
    ruleId: 'jourilo/dialog-focus',
    title: 'Opening a dialog does not move keyboard focus into it',
    severity: 'serious',
    impact: 'Keyboard and screen-reader users stay behind the dialog and may not know it opened.',
    recommendation:
      'When the dialog opens, move focus to its first focusable element (or the dialog itself with tabindex="-1"); use <dialog>.showModal() where possible.',
    standards: [
      wcag('2.4.3'),
      {
        standard: 'WAI-ARIA APG',
        id: 'dialog-modal',
        title: 'Dialog (Modal) Pattern',
        url: 'https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/',
      },
    ],
  },
  'dialog-escape': {
    ruleId: 'jourilo/dialog-escape',
    title: 'Escape does not close the dialog',
    severity: 'moderate',
    impact: 'Keyboard users have no quick, expected way out of the dialog.',
    recommendation: 'Close the dialog on Escape (native <dialog> does this) and return focus to the trigger.',
    standards: [
      nielsen(3),
      {
        standard: 'WAI-ARIA APG',
        id: 'dialog-modal',
        title: 'Dialog (Modal) Pattern',
        url: 'https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/',
      },
    ],
  },
  'dialog-focus-not-returned': {
    ruleId: 'jourilo/dialog-focus-return',
    title: 'Focus is lost when the dialog closes',
    severity: 'moderate',
    impact:
      'After closing, keyboard users are sent elsewhere (often the top of the page) and must find their place again.',
    recommendation: 'Store the element that opened the dialog and focus it again when the dialog closes.',
    standards: [wcag('2.4.3')],
  },
  'expanded-state-mismatch': {
    ruleId: 'jourilo/expanded-state',
    title: 'aria-expanded does not match what is shown',
    severity: 'serious',
    impact: 'Screen readers announce the menu or section as collapsed when it is open (or the reverse).',
    recommendation:
      'Toggle aria-expanded on the trigger together with the visibility of the controlled element.',
    standards: [wcag('4.1.2')],
  },
};

export function widgetFindings(obs: PageObservation): Finding[] {
  const w = obs.widgets;
  if (!w?.issues.length) return [];
  const byKind = new Map<string, typeof w.issues>();
  for (const i of w.issues) byKind.set(i.kind, [...(byKind.get(i.kind) ?? []), i]);
  const shot = obs.screenshot ? { file: obs.screenshot } : {};
  return [...byKind].map(([kind, issues]) => {
    const r = WIDGET_RULES[kind as keyof typeof WIDGET_RULES];
    return makeFinding({
      ruleId: r.ruleId,
      title: r.title,
      category: 'accessibility',
      kind: 'defect',
      severity: r.severity,
      confidence: 'high',
      provenance: 'observed',
      url: obs.url,
      viewport: obs.viewport.name,
      description: issues.map((i) => `"${i.name}": ${i.detail}`).join(' '),
      impact: r.impact,
      recommendation: r.recommendation,
      standards: r.standards,
      evidence: issues.map((i) => ({
        type: 'element' as const,
        selector: i.trigger,
        rect: i.rect,
        snippet: i.name,
        note: i.detail,
        ...shot,
      })),
      occurrences: issues.length,
      reproduction: [
        `Open ${obs.url} at the ${obs.viewport.name} viewport.`,
        `Focus "${issues[0]!.name}" with Tab and press Enter.`,
        issues[0]!.detail,
      ],
    });
  });
}
