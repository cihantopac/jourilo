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

describe('toggle-ui lexicon with Turkish capitals', () => {
  const toggle = lexicon('toggle-ui');
  it.each(['KARANLIK MOD', 'KARANLIK', 'DİL', 'LIGHT MODE', 'Dark mode', 'AYDINLIK MOD', 'Dil'])(
    '"%s" is toggle-ui',
    (text) => {
      expect(toggle.test(text)).toBe(true);
    },
  );
  it.each(['MODEL', 'Model', 'DİLEK'])('"%s" is not toggle-ui', (text) => {
    expect(toggle.test(text)).toBe(false);
  });
});

describe('Italian, Portuguese and Dutch vocabulary', () => {
  const cases: Record<string, Record<string, string[]>> = {
    it: {
      vagueCta: ['Invia', 'Continua', 'Scopri di più', 'Clicca qui'],
      genericHeadline: ['Benvenuto nel nostro negozio', 'Ciao'],
      pricingPeriod: ['€19 / mese', '€190 al anno', 'per utente', 'Fatturazione mensile'],
      freeTrial: ['Prova gratuita di 14 giorni', 'Inizia gratis'],
      formError: ['Il campo email è obbligatorio', 'Password non valida'],
      trustTestimonials: ['Testimonianze', 'Cosa dicono i nostri clienti'],
      trustGuarantee: ['Soddisfatti o rimborsati', 'Garanzia di 30 giorni'],
      trustSecurity: ['Pagamento sicuro', 'Dati crittografati'],
      trustLogos: ['Scelto da oltre 500 aziende', 'Usato da team in tutto il mondo'],
      signup: ['Registrati', 'Crea un account'],
      login: ['Accedi'],
      recovery: ['Password dimenticata'],
      search: ['Cerca'],
      newsletter: ['Iscrizione alla newsletter'],
      checkout: ['Pagamento', 'Carta di credito'],
      submit: ['Invia', 'Salva', 'Avanti', 'Accedi', 'Cerca'],
      'toggle-ui': ['Tema scuro', 'Lingua'],
    },
    pt: {
      vagueCta: ['Clique aqui', 'Saiba mais', 'Próximo', 'Continuar'],
      genericHeadline: ['Bem-vindo à nossa loja', 'Olá'],
      pricingPeriod: ['R$ 19 / mês', 'por usuário', 'Cobrança mensal', 'ao ano'],
      freeTrial: ['Teste grátis por 14 dias', 'Experimente grátis'],
      formError: ['O campo e-mail é obrigatório', 'Senha inválida', 'Erro ao enviar'],
      trustTestimonials: ['Depoimentos', 'Avaliações de clientes'],
      trustGuarantee: ['Garantia de 30 dias', 'Reembolso total', 'Cancele quando quiser'],
      trustSecurity: ['Pagamento seguro', 'Dados criptografados', 'Conformidade com a LGPD'],
      trustLogos: ['Usado por mais de 500 empresas', 'Confiam em nós'],
      signup: ['Cadastre-se', 'Criar conta'],
      login: ['Entrar', 'Iniciar sessão'],
      recovery: ['Esqueci minha senha'],
      search: ['Pesquisar'],
      newsletter: ['Assinar a newsletter', 'Boletim'],
      checkout: ['Pagamento', 'Cartão'],
      submit: ['Enviar', 'Salvar', 'Próximo', 'Entrar', 'Pesquisar'],
      'toggle-ui': ['Modo escuro', 'Idioma', 'Aparência'],
    },
    nl: {
      vagueCta: ['Verzenden', 'Verder', 'Klik hier', 'Lees meer'],
      genericHeadline: ['Welkom bij onze winkel', 'Hallo'],
      pricingPeriod: ['\u20ac 19 / maand', 'per gebruiker', 'Maandelijks', 'Jaarlijks'],
      freeTrial: ['Gratis proberen', 'Probeer gratis'],
      formError: ['E-mailadres is verplicht', 'Ongeldig wachtwoord', 'Er is een fout opgetreden'],
      trustTestimonials: ['Getuigenissen', 'Wat onze klanten zeggen', 'Recensies'],
      trustGuarantee: ['Niet goed, geld terug', 'Op elk moment opzegbaar'],
      trustSecurity: ['Veilig betalen', 'Versleutelde gegevens'],
      trustLogos: ['Vertrouwd door 500 bedrijven', 'Gebruikt door teams'],
      signup: ['Registreren', 'Account aanmaken'],
      login: ['Inloggen'],
      recovery: ['Wachtwoord vergeten'],
      search: ['Zoeken'],
      newsletter: ['Nieuwsbrief'],
      checkout: ['Betaling', 'Kaart'],
      submit: ['Verzenden', 'Opslaan', 'Verder', 'Inloggen', 'Zoeken'],
      'toggle-ui': ['Donkere modus', 'Taal', 'Weergave'],
    },
  };
  for (const [lang, byConcept] of Object.entries(cases)) {
    for (const [concept, texts] of Object.entries(byConcept)) {
      it(`${lang}: ${concept} matches its words`, () => {
        const re = lexicon(concept as Parameters<typeof lexicon>[0]);
        for (const t of texts) expect(re.test(t), t).toBe(true);
      });
    }
  }
  it('keeps whole-label vague CTAs exact in all three languages', () => {
    const vague = lexicon('vagueCta', { exact: true });
    for (const t of ['Invia', 'Continua', 'Próximo', 'Saiba mais', 'Verder', 'Ga', 'Lees meer'])
      expect(vague.test(t), t).toBe(true);
    for (const t of ['Invia la richiesta di preventivo', 'Gerenciar envios', 'Ga naar de kassa'])
      expect(vague.test(t), t).toBe(false);
  });
  it('does not take English look-alikes for Italian, Portuguese or Dutch words', () => {
    const no = (concept: Parameters<typeof lexicon>[0], texts: string[]) => {
      const re = lexicon(concept);
      for (const t of texts) expect(re.test(t), `${concept}: ${t}`).toBe(false);
    };
    // Prefix look-alikes: the words are matched whole, so a longer English word is not a hit.
    no('submit', ['Invention', 'Salvage yard', 'Entrance', 'Verdict', 'Gate', 'Tailor']);
    no('destructive', [
      'Eliminate',
      'Eliminated risks',
      'Remote',
      'Cancellation policy',
      'Wissen',
      'Verwijderingen',
      'Stain remover',
      'Hair remover',
    ]);
    no('financial', ['Pagination', 'Pagani', 'Betaalbaar', 'Kopenhagen', 'Dona Maria']);
    no('signup', ['Registrar', 'Registered']);
    no('login', ['Accedit', 'Entrance', 'Aanmeldingen']);
    no('search', ['Cercal', 'Zoekt', 'Pesquisadores']);
    no('genericHeadline', ['Ciaobella studio', 'Hallow', 'Welkomst']);
    no('pricingPeriod', ['Messenger', 'Annual report', 'Mensalidade']);
    no('toggle-ui', ['Chiarimenti', 'Lichtenstein', 'Taalkunde', 'Modello', 'Escudo']);
  });
});

describe('Italian, Portuguese and Dutch safety policy', () => {
  it.each([
    'Elimina',
    'Elimina account',
    'Cancella il profilo',
    'Disdici l\u2019abbonamento',
    'Excluir',
    'Excluir conta',
    'Cancelar assinatura',
    'Encerrar minha conta',
    'Verwijderen',
    'Account verwijderen',
    'Abonnement opzeggen',
    'Paga ora',
    'Acquista ora',
    'Procedi al pagamento',
    'Pagar agora',
    'Finalizar compra',
    'Confirmar pagamento',
    'Betaal nu',
    'Afrekenen',
    'Bestelling plaatsen',
    'Bestellen',
    'Bestel nu',
    'Ordina',
    'Ordina ora',
    'Ordinare',
    'Compra',
    'Comprare',
    'Comprar',
    'Encomendar',
    'Remover conta',
    'Account wissen',
    'Account deactiveren',
    'Annulla abbonamento',
  ])('never performs "%s" on a public host', (name) => {
    for (const host of [publicHost, local])
      expect(
        checkAction({ action: 'click', name, submitsForm: false, paymentForm: false }, host).allowed,
      ).toBe(false);
  });
  it.each([
    'Prezzi',
    'Preços',
    'Prijzen',
    'Pagina iniziale',
    'Cancelar',
    'Annulla',
    'Annuleren',
    'Eliminate duplicates',
    'Pagamentos aceitos em breve',
    'Kopenhagen',
    'Stain remover',
    'Hair remover',
  ])('does not block the harmless "%s"', (name) => {
    expect(
      checkAction({ action: 'click', name, submitsForm: false, paymentForm: false }, publicHost).allowed,
    ).toBe(true);
  });
});
