import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULES } from '../../src/audit/rules/registry.js';
import { RULE_TEXT_TR } from '../../src/report/rule-text-tr.js';

// ASCII spellings that stand in for Turkish words written with ç, ğ, ı, ö, ş or ü. Each pattern starts at a word
// start and only matches a misspelling; the control sentences below keep it from flagging correct words.
const ASCII_SUBSTITUTES: RegExp[] = [
  /(?<!\p{L})gorun/iu, // görün-
  /(?<!\p{L})kullanici/iu, // kullanıcı
  /(?<!\p{L})erisil/iu, // erişil-
  /(?<!\p{L})dugme/iu, // düğme
  /(?<!\p{L})baglanti/iu, // bağlantı
  /(?<!\p{L})sayfasi(?!\p{L})/iu, // sayfası
  /(?<!\p{L})icin(?!\p{L})/iu, // için
  /(?<!\p{L})odagi(?!\p{L})/iu, // odağı
  /(?<!\p{L})ogesi/iu, // öğesi
  /(?<!\p{L})oge(?!\p{L})/iu, // öğe
  /(?<!\p{L})secenek/iu, // seçenek
  /(?<!\p{L})degil/iu, // değil
  /(?<!\p{L})icerik/iu, // içerik
  /(?<!\p{L})goster/iu, // göster-
  /(?<!\p{L})yukle/iu, // yükle-
  /(?<!\p{L})duzelt/iu, // düzelt-
  /(?<!\p{L})basarisiz/iu, // başarısız
  /(?<!\p{L})olcul/iu, // ölçül-
  /(?<!\p{L})gonder/iu, // gönder-
  /(?<!\p{L})ulasil/iu, // ulaşıl-
  /(?<!\p{L})diyalogu/iu, // diyaloğu
  /(?<!\p{L})tiklan/iu, // tıklan-
  /(?<!\p{L})gecersiz/iu, // geçersiz
];

function asciiSubstitutes(text: string): string[] {
  return ASCII_SUBSTITUTES.filter((re) => re.test(text)).map((re) => re.source);
}

const SOURCE = ['src/audit/rules', 'src/journeys', 'src/audit']
  .flatMap((dir) => readdirSync(dir).map((f) => join(dir, f)))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/** Whether the rule's English `field` interpolates a value (`${...}`) in the source that builds the finding. */
function interpolates(rule: string, field: string): boolean {
  // The field's expression, from `field:` to the next property of the same object at the same indent.
  const re = new RegExp(
    `ruleId: '${rule.replace(/[/]/g, '\\/')}',[\\s\\S]*?\\n(\\s+)${field}:\\s*((?:[^\\n]*\\n)+?)(?=\\1[A-Za-z]+:|\\1\\}\\)|\\1\\},?\\n)`,
    'g',
  );
  for (const m of SOURCE.matchAll(re)) if (m[2]!.includes('${')) return true;
  return false;
}

describe('Turkish rule texts', () => {
  it('every native rule in RULES has a Turkish title, impact and recommendation', () => {
    const missing = RULES.filter((r) => {
      const tr = RULE_TEXT_TR[r.id];
      return !tr?.title.trim() || !tr.impact.trim() || !tr.recommendation.trim();
    }).map((r) => r.id);
    expect(missing).toEqual([]);
    // No stale entry for a rule that no longer exists.
    const ids = new Set(RULES.map((r) => r.id));
    expect(Object.keys(RULE_TEXT_TR).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('Turkish texts use correct diacritics', () => {
    // Controls: correct Turkish words that share letters with the misspellings must pass.
    const controls =
      'Klavye odağı görünmüyor. Kullanıcılar için içerik, düğme, bağlantı ve öğe erişilebilir değil; ' +
      'sayfanın tamamı, sayfa, odak, seçenek, düzeltin, gönderin, yükleyin, ölçülen, başarısız, tıklanabilir, ' +
      'geçersiz, ulaşılamıyor, diyaloğu gösterin, ekran okuyucu kullanıcıları, icon, odak göstergesi.';
    expect(asciiSubstitutes(controls)).toEqual([]);
    // The list catches what it is meant to catch.
    expect(asciiSubstitutes('Klavye odagi gorunmuyor icin')).toHaveLength(3);

    const bad = Object.entries(RULE_TEXT_TR).flatMap(([id, t]) =>
      [t.title, t.impact, t.recommendation].flatMap((s) => asciiSubstitutes(s).map((p) => `${id}: ${p}`)),
    );
    expect(bad).toEqual([]);
  });

  it('Turkish texts do not claim WCAG conformance or legal compliance', () => {
    const claims = /uyumlu(dur|sunuz)?\b|uyumluluk|yasal|mevzuat|sertifika/iu;
    // "uygun" alone is ordinary ("amacına uygun"); next to WCAG it claims conformance.
    const wcagConforms = /WCAG\S*\s+(?:\S+\s+){0,3}uygun/iu;
    expect(wcagConforms.test('Sayfa WCAG 2.2 AA ölçütlerine uygundur.')).toBe(true);
    expect(wcagConforms.test('amacına uygun bir autocomplete değeri')).toBe(false);
    const hits = Object.entries(RULE_TEXT_TR)
      .filter(([, t]) => {
        const all = `${t.title} ${t.impact} ${t.recommendation}`;
        return claims.test(all) || wcagConforms.test(all);
      })
      .map(([id]) => id);
    expect(hits).toEqual([]);
  });

  // A rule whose English title, impact or recommendation interpolates a value of the finding must list that field in
  // `dynamic`; otherwise the Turkish report would replace the English text and drop the value (F-dynamic).
  it('every field built from finding values is listed in `dynamic`', () => {
    const missing: string[] = [];
    for (const [id, t] of Object.entries(RULE_TEXT_TR))
      for (const field of ['title', 'impact', 'recommendation'] as const)
        if (interpolates(id, field) && !t.dynamic?.includes(field)) missing.push(`${id}.${field}`);
    expect(missing).toEqual([]);
  });

  it('the dynamic scan sees an interpolated field and ignores a literal one (control)', () => {
    expect(interpolates('jourilo/button-implicit-submit', 'title')).toBe(true);
    expect(interpolates('jourilo/focus-visible', 'title')).toBe(false);
  });
});
