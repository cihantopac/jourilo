import { describe, expect, it } from 'vitest';
import { suggestAutocomplete } from '../../src/audit/rules/accessibility.js';
import { lexicon } from '../../src/core/lexicon.js';
import { checkAction } from '../../src/journeys/safety.js';

const local = { hostClass: 'local' as const, allowSubmit: false, allowDestructive: false };
const publicHost = { hostClass: 'public' as const, allowSubmit: true, allowDestructive: true };

describe('multilingual safety policy', () => {
  it.each([
    'Satın al',
    'Satın alın',
    'Ödeyin',
    'Ödemeyi tamamla',
    'Siparişi onayla',
    'Hesabı sil',
    'Aboneliği iptal et',
    'Sil',
    'Jetzt kaufen',
    'Kostenpflichtig bestellen',
    'Konto löschen',
    'Abo kündigen',
    'Comprar ahora',
    'Pagar',
    'Finalizar compra',
    'Eliminar cuenta',
    'Cancelar suscripción',
    'Payer',
    'Acheter',
    'Valider la commande',
    'Supprimer le compte',
    'Résilier',
    'Pay now',
    'Delete account',
  ])('never performs "%s" on a public host', (name) => {
    expect(
      checkAction({ action: 'click', name, submitsForm: false, paymentForm: false }, publicHost).allowed,
    ).toBe(false);
    expect(
      checkAction({ action: 'click', name, submitsForm: false, paymentForm: false }, local).allowed,
    ).toBe(false);
  });
  it.each([
    'Paylaş',
    'Kaldırım taşı',
    'Silver plan',
    'Ödev',
    'Bezahlung sicher',
    'Pagina 2',
    'Payment options',
    'Ara',
    'Fiyatlar',
  ])('does not block the harmless "%s"', (name) => {
    expect(
      checkAction({ action: 'click', name, submitsForm: false, paymentForm: false }, publicHost).allowed,
    ).toBe(true);
  });
});

describe('multilingual heuristics', () => {
  it('recognizes vague calls to action as whole labels only', () => {
    const vague = lexicon('vagueCta', { exact: true });
    for (const t of ['Gönder', 'Devam', 'Weiter', 'Enviar', 'En savoir plus', 'Submit'])
      expect(vague.test(t), t).toBe(true);
    for (const t of ['Ücretsiz denemeyi başlat', 'Gönderim ücretleri', 'Jetzt 14 Tage testen'])
      expect(vague.test(t), t).toBe(false);
  });
  it('reads error messages in several languages', () => {
    const err = lexicon('formError');
    for (const t of [
      'Bu alan zorunludur',
      'E-posta geçersiz',
      'Pflichtfeld',
      'Campo obligatorio',
      'Ce champ est obligatoire',
    ])
      expect(err.test(t), t).toBe(true);
  });
  it('suggests autocomplete tokens for Turkish, German, Spanish and French field names', () => {
    expect(suggestAutocomplete('text', 'soyad', 'Soyadınız', 'signup')).toBe('family-name');
    expect(suggestAutocomplete('text', 'vorname', null, 'other')).toBe('given-name');
    expect(suggestAutocomplete('text', 'codigo_postal', 'Código postal', 'other')).toBe('postal-code');
    expect(suggestAutocomplete('text', 'ville', null, 'other')).toBe('address-level2');
    expect(suggestAutocomplete('text', 'eposta', 'E-posta adresi', 'other')).toBe('email');
  });
});
