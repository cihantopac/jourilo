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
});
