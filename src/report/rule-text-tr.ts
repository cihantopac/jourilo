// Turkish texts of Jourilo's own rules for the Turkish report: one entry per native rule in RULES
// (src/audit/rules/registry.ts); tests/unit/rule-text.test.ts fails when a rule has none. A rule's title, impact and
// recommendation are written here once per rule. Where a rule's English text names values of the finding (a width, a
// journey name, a measured time, autocomplete tokens, brand colors), the field is listed in `dynamic` and the report
// shows the English original after the Turkish text, so a Turkish reader keeps every value. Descriptions are never
// translated. axe-core rules keep axe's English texts (axe-core ships no Turkish locale).

export type RuleTextField = 'title' | 'impact' | 'recommendation';

export interface RuleTextTr {
  title: string;
  impact: string;
  recommendation: string;
  /** Fields whose English text carries values of the finding; the report keeps the English next to the Turkish. */
  dynamic?: readonly RuleTextField[];
}

/** The impact text of every conversion hypothesis, with the metric that would validate it. */
function hypothesis(metric: string): string {
  return `Ölçülmüş bir etki değil, bir hipotez. Doğrulamak için: ${metric}.`;
}

const SLOW_PAGE = 'Yavaş sayfalar, ziyaretçileri teklifi görmeden kaybeder.';

export const RULE_TEXT_TR: Record<string, RuleTextTr> = {
  'jourilo/contrast-over-image': {
    title: 'Görselin veya gradyanın üzerindeki metnin kontrastı yetersiz',
    impact:
      'Az gören kişiler ve parlak ışıkta telefondan okuyanlar, metnin görselin benzer tondaki bölümüne denk gelen kısımlarını okuyamaz.',
    recommendation:
      'Metnin arkasına bir perde katmanı (görselle metin arasında düz veya yarı saydam bir katman) ekleyin, metni görselin daha sade bir bölümüne taşıyın ya da metin rengini değiştirin; arka planın her noktasında kontrast en az 4,5:1, büyük metinde (24 px ya da kalın 18,66 px) 3:1 olsun.',
  },
  'jourilo/focus-visible': {
    title: 'Klavye odağı görünmüyor',
    impact:
      'Klavye kullanıcıları sayfada nerede olduklarını göremez, bu yüzden sayfayı güvenilir biçimde kullanamaz.',
    recommendation:
      'Odak çerçevesini (outline) yerine başka bir gösterge koymadan kaldırmayın. Ortak düğme, bağlantı ve giriş alanı bileşenlerine açıkça görünen bir :focus-visible stili ekleyin (ör. 3:1 kontrastlı 2 px outline).',
  },
  'jourilo/focus-obscured': {
    title: 'Odaktaki öğe başka içeriğin arkasında kalıyor',
    impact:
      'Odak üst bilgi, banner, panel veya sohbet penceresinin arkasında kaldığında klavye kullanıcıları onu gözden kaybeder.',
    recommendation:
      'Odak geldiğinde öğenin üstünü kapatan içeriği başka yere taşıyın veya kapatın ya da yapışkan çubukların yüksekliği kadar scroll-padding (üstte ve altta) verin.',
  },
  'jourilo/button-implicit-submit': {
    dynamic: ['title'],
    title: 'Türü belirtilmemiş bir düğme, adı gönderme anlamı taşımadığı hâlde formu gönderiyor',
    impact:
      'Başka bir iş için konmuş bir kontrol (parolayı göstermek, menü açmak, panel kapatmak) o ana kadar yazılanlarla birlikte formu da gönderir.',
    recommendation:
      'Düğmeye type="button" verin. Formu göndermesi gereken düğme type="submit" olarak kalsın.',
  },
  'jourilo/keyboard-trap': {
    title: 'Klavye odağı bir alanda tutuluyor',
    impact:
      'Klavye kullanıcıları sayfanın geri kalanına ulaşamaz ve sayfayı yeniden yüklemek zorunda kalabilir.',
    recommendation:
      'Diyaloglar dışında Tab tuşunu yakalayan özel keydown işleyicilerini kaldırın; bu bir diyalogsa aria-modal="true" ile işaretleyin ve Escape ile kapanmasını sağlayın.',
  },
  'jourilo/target-size': {
    title: "Dokunma ve tıklama hedefleri 24×24 px'den küçük",
    impact:
      'Eli titreyen, parmakları iri olan veya işaretçiyi hassas kullanamayan kişiler yanlış kontrole basar.',
    recommendation:
      "Tıklanabilir alanı dolgu (padding) ile en az 24×24 px'e çıkarın (dokunmatik ekranda 44×44 px daha iyidir) ya da hedeflerin arasına boşluk bırakın.",
  },
  'jourilo/pointer-only-control': {
    title: 'Klavye kullanıcılarının ulaşamadığı tıklanabilir öğeler',
    impact: 'Klavye ve ekran okuyucu kullanıcıları bu kontrolleri etkinleştiremez.',
    recommendation: 'Tıklanabilir <div>/<span> yerine <button> (sayfa geçişi için <a href>) kullanın.',
  },
  'jourilo/paste-blocked': {
    title: 'Parola veya kod alanlarına yapıştırma engellenmiş',
    impact:
      'Parola yöneticisi kullananlar ve parolayı ezberleyip yeniden yazamayan, bilişsel veya motor engeli olan kişiler giriş yapamaz.',
    recommendation:
      'Kimlik bilgisi alanlarındaki yapıştırma engelini (onpaste işleyicileri, paste olayında preventDefault) kaldırın.',
  },
  'jourilo/input-purpose': {
    dynamic: ['recommendation'],
    title: 'Kişisel veri alanlarında autocomplete yok',
    impact:
      'Tarayıcılar ve parola yöneticileri bu alanları dolduramaz; motor veya bilişsel engeli olan kişiler daha çok yazmak zorunda kalır.',
    recommendation:
      'Kullanıcıyla ilgili bilgi toplayan her alana amacına uygun bir autocomplete değeri ekleyin (ör. e-posta için email, telefon için tel, ad soyad için name, adres için street-address).',
  },
  'jourilo/placeholder-label': {
    title: 'Form alanları etiket yerine yer tutucu metne dayanıyor',
    impact:
      'Kişiler yazmaya başlayınca alanın ne istediğini unutur; düşük kontrastlı yer tutucular zor okunur.',
    recommendation:
      'Her alana görünür bir <label for> ekleyin; yer tutucuları yalnızca örnek göstermek için kullanın.',
  },
  'jourilo/dialog-focus': {
    title: 'Diyalog açıldığında klavye odağı diyaloğa geçmiyor',
    impact: 'Klavye ve ekran okuyucu kullanıcıları diyaloğun arkasında kalır ve açıldığını fark etmeyebilir.',
    recommendation:
      'Diyalog açılınca odağı ilk odaklanabilir öğesine (ya da tabindex="-1" ile diyaloğun kendisine) taşıyın; mümkünse <dialog>.showModal() kullanın.',
  },
  'jourilo/composite-keyboard': {
    title: 'Sekme listesi, radyo grubu, liste kutusu veya menü çubuğundaki öğelere klavyeyle ulaşılamıyor',
    impact:
      'Klavye ve ekran okuyucu kullanıcıları yalnızca geçerli öğeye ulaşabilir; diğer sekmeler, seçenekler veya tercihler ulaşılamaz durumda kalır.',
    recommendation:
      "Bu bileşen için ok tuşu desenini uygulayın (ok tuşlarıyla odağı ya da aria-activedescendant'ı sonraki öğeye taşıyın) veya her öğeyi Tab sırasına ekleyin.",
  },
  'jourilo/menu-arrow-keys': {
    title: 'Ok tuşları menü öğeleri arasında geçiş yapmıyor',
    impact: 'Klavye ve ekran okuyucu kullanıcıları ilk öğeden sonraki menü öğelerine ulaşamaz.',
    recommendation:
      'APG menü düğmesi deseninde anlatıldığı gibi ArrowDown ve ArrowUp ile odağı sonraki veya önceki menü öğesine taşıyın (sondan başa, baştan sona dönerek).',
  },
  'jourilo/menu-home-end': {
    title: 'Home ve End tuşları ilk ve son menü öğesine atlamıyor',
    impact:
      'Klavye kullanıcıları uzun bir menünün başına veya sonuna ulaşmak için ok tuşuna defalarca basmak zorunda kalır.',
    recommendation: 'Home tuşunda odağı ilk menü öğesine, End tuşunda son menü öğesine taşıyın.',
  },
  'jourilo/menu-escape': {
    title: 'Escape menüyü kapatmıyor',
    impact: 'Klavye kullanıcılarının açık bir menüyü kapatmak için hızlı ve beklenen bir yolu yok.',
    recommendation: "Escape'e basılınca menüyü kapatın ve odağı menü düğmesine geri verin.",
  },
  'jourilo/menu-focus-return': {
    title: 'Menü kapanınca odak kayboluyor',
    impact:
      'Menü kapandıktan sonra klavye kullanıcıları başka bir yere gönderilir ve kaldıkları yeri yeniden bulmak zorunda kalır.',
    recommendation: 'Menü Escape ile kapandığında odağı menü düğmesine geri taşıyın.',
  },
  'jourilo/dialog-escape': {
    title: 'Escape diyaloğu kapatmıyor',
    impact: 'Klavye kullanıcılarının diyalogdan çıkmak için hızlı ve beklenen bir yolu yok.',
    recommendation:
      'Diyaloğun Escape ile kapanmasını sağlayın (yerel <dialog> bunu kendisi yapar) ve odağı diyaloğu açan öğeye geri verin.',
  },
  'jourilo/dialog-focus-return': {
    title: 'Diyalog kapanınca odak kayboluyor',
    impact:
      'Diyalog kapandıktan sonra klavye kullanıcıları başka bir yere (çoğunlukla sayfanın başına) gönderilir ve kaldıkları yeri yeniden bulmak zorunda kalır.',
    recommendation: 'Diyaloğu açan öğeyi saklayın ve diyalog kapanınca odağı yeniden ona verin.',
  },
  'jourilo/dialog-focus-containment': {
    title: 'Klavye odağı açık diyaloğun dışına çıkıyor',
    impact:
      'Klavye kullanıcıları Tab ile katmanın arkasında kalan sayfaya geçer ve nerede olduklarını kaybeder.',
    recommendation:
      'Kalıcı (modal) diyalog açıkken odağı içinde tutun (yerel <dialog>.showModal() ya da sayfanın geri kalanında inert özniteliği).',
  },
  'jourilo/dialog-role': {
    title: 'Katman, diyalog rolü olmadan açılıyor',
    impact: 'Ekran okuyucu kullanıcılarına bir diyaloğun açıldığı ya da bunun ne olduğu bildirilmez.',
    recommendation:
      '<dialog> (showModal) ya da aria-modal="true" ve erişilebilir bir adla (aria-labelledby) birlikte role="dialog" kullanın.',
  },
  'jourilo/expanded-state': {
    title: 'aria-expanded, ekranda görünenle uyuşmuyor',
    impact: 'Ekran okuyucular menüyü veya bölümü açıkken kapalı (ya da tersi) olarak duyurur.',
    recommendation:
      'Tetikleyicideki aria-expanded değerini, denetlediği öğenin görünürlüğüyle birlikte değiştirin.',
  },
  'jourilo/fieldset-legend': {
    title: "Fieldset'in legend'ı yok",
    impact:
      'Ekran okuyucu kullanıcıları alanları yanıtladıkları soru olmadan duyar (ör. "Pasaportunuz var mı?" olmadan "Evet / Hayır").',
    recommendation:
      "Her fieldset'e ilk alt öğe olarak grup sorusunu içeren bir <legend> verin (ya da grubu adlandıran bir aria-label / aria-labelledby); yalnızca stil için kullanılan fieldset'leri kaldırın.",
  },
  'jourilo/radio-group': {
    title: 'Radyo düğmeleri adı olan bir grupta toplanmamış',
    impact: 'Seçenekler, ait oldukları soru olmadan duyurulur.',
    recommendation:
      'Her grubu bir <legend> ile birlikte <fieldset> içine alın (ya da aria-labelledby ile role="radiogroup" kullanın).',
  },
  'jourilo/table-headers': {
    title: 'Başlık hücresi olmayan veri tablosu',
    impact:
      'Ekran okuyucu kullanıcıları, hangi satıra veya sütuna ait olduklarını bilmeden art arda değerler duyar.',
    recommendation:
      'Başlıklar için <th scope="col"> / <th scope="row"> kullanın; sayfa düzeni için tablo yerine CSS kullanın.',
  },
  'jourilo/empty-alt-with-title': {
    title: 'Dekoratif olarak işaretlenen görsel, title özniteliğinde açıklanıyor',
    impact:
      'Ekran okuyucular görseli atlar, fareyle gezen gören kullanıcılar ise bilgiyi araç ipucu olarak görür.',
    recommendation:
      'Görsel bilgi veriyorsa metni alt özniteliğine taşıyın; dekoratifse title özniteliğini kaldırın.',
  },
  'a11y/errors-not-associated': {
    title: 'Hata mesajları görünüyor ama yardımcı teknolojilere iletilmiyor',
    impact:
      'Ekran okuyucu kullanıcılarına gönderimin başarısız olduğu veya hangi alanı düzeltmeleri gerektiği bildirilmez.',
    recommendation:
      'Geçersiz alanlara aria-invalid="true" ekleyin, her mesajı aria-describedby ile alanına bağlayın ve hata özetini role="alert" bölgesinde duyurun ya da odağı özete taşıyın.',
  },
  'jourilo/horizontal-overflow': {
    dynamic: ['title'],
    title: 'Sayfa yatay olarak kayıyor',
    impact:
      'İçerik kesilir ya da iki yönlü kaydırma gerektirir; telefonda sayfa kaydırılırken yana doğru oynar.',
    recommendation:
      'Taşmaya neden olan öğeyi sınırlayın (max-width: 100%, flex-wrap, flex alt öğelerinde min-width: 0, uzun dizeler için overflow-wrap: anywhere, tablolar için kaydırılabilir bir kapsayıcı).',
  },
  'jourilo/missing-viewport-meta': {
    title: 'Duyarlı viewport meta etiketi yok',
    impact: 'Telefonlarda metin çok küçük görünür ve kontrollere dokunmak zorlaşır.',
    recommendation:
      'Belgenin head bölümüne <meta name="viewport" content="width=device-width, initial-scale=1"> ekleyin.',
  },
  'jourilo/small-text': {
    title: "Mobilde gövde metni 12 px'in altında",
    impact:
      'Küçük metin telefonda, özellikle yaşlı kullanıcılar için zor okunur; bu bir okunabilirlik değerlendirmesidir, WCAG ihlali değildir.',
    recommendation: 'Mobilde gövde metni için en az 16 px, ikincil metin için en az 12 px kullanın.',
  },
  'ux/required-fields-unmarked': {
    title: 'Zorunlu alanlar belirtilmemiş',
    impact:
      'Kişiler hangi alanların zorunlu olduğunu ancak formu gönderince öğrenir; bu da fazladan hata turlarına ve hayal kırıklığına yol açar.',
    recommendation:
      'Zorunlu alanları required/aria-required ve görünür bir işaretle belirtin ya da isteğe bağlı olanları işaretleyin.',
  },
  'ux/no-validation-feedback': {
    title: 'Eksik veya boş form gönderildiğinde geri bildirim verilmiyor',
    impact: 'Kişiler neyin eksik olduğunu öğrenemez; körlemesine yeniden dener ya da formu bırakır.',
    recommendation:
      'Zorunlu alanları doğrulayın ve her alanın yanında o alana özgü bir mesaj gösterin (uzun formlarda bir hata özeti de ekleyin); alanları aria-invalid ile işaretleyin ve mesajları aria-describedby ile bağlayın.',
  },
  'ux/error-focus': {
    title: 'Odak ilk hataya taşınmıyor',
    impact:
      'Klavye ve ekran okuyucu kullanıcıları sorunu aramak zorunda kalır; mobilde hata ekranın dışında kalabilir.',
    recommendation: 'Başarısız bir gönderimden sonra odağı hata özetine veya ilk geçersiz alana taşıyın.',
  },
  'journey/failed': {
    dynamic: ['title', 'impact'],
    title: 'Yolculuk hedefine ulaşmıyor',
    impact: 'Kişiler bu görevi tamamlayamıyor.',
    recommendation:
      'Başarısız olan adımı düzeltin ve yolculuğu yeniden çalıştırın. Yolculuk Jourilo tarafından önerildiyse önce tanımın amaçlanan akışla eşleştiğini kontrol edin.',
  },
  'journey/blocked-by-policy': {
    dynamic: ['title'],
    title: 'Yolculuk güvenlik politikası tarafından durduruldu',
    impact: 'Bu yolculuğun geri kalanı test edilmedi.',
    recommendation:
      'Bu yolculuğun kapsanması gerekiyorsa test hesaplarıyla yerel veya sandbox bir ortamda çalıştırın.',
  },
  'journey/page-errors': {
    dynamic: ['title'],
    title: 'Yolculuk sırasında yakalanmamış istisnalar',
    impact: 'Etkileşimli özellikler gerçek kullanıcılar için sessizce çalışmayabilir.',
    recommendation: 'Adımları yeniden üretin ve kanıtta listelenen istisnaları düzeltin.',
  },
  'journey/flaky': {
    dynamic: ['title'],
    title: 'Yolculuk denemelerin yalnızca bir kısmında başarılı oldu',
    impact:
      'Aralıklı hatalar gerçek kullanıcılara ulaşır ve önce/sonra karşılaştırmalarını güvenilmez kılar.',
    recommendation:
      'Başarısız denemeyi başarılı bir denemeyle karşılaştırın: farklı sırada tamamlanan isteklere, geç oluşan öğelere veya önceki bir çalışmanın oluşturduğu verilere bakın. Sorun bir yarış durumuysa (race condition) ürünü düzeltin; değilse yolculuğun doğru durumu beklemesini sağlayın.',
  },
  'jourilo/page-unreachable': {
    title: 'Sayfa yüklenemiyor ya da kendine yönlendiren bir döngüye giriyor',
    impact: 'Ziyaretçiler bu sayfayı hiç kullanamaz.',
    recommendation:
      "Bu URL için sunucuyu, DNS'i ve yönlendirmeleri kontrol edin. Sayfa kendine yönlendiriyorsa sunucunun yönlendirme kurallarını veya barındırma yapılandırmasını (HTTP/HTTPS, www ve sondaki eğik çizgi yönlendirmeleri, proxy veya CDN yönlendirmesi) düzeltin.",
  },
  'jourilo/http-error-page': {
    dynamic: ['title'],
    title: 'Sayfa HTTP hata koduyla yanıt veriyor',
    impact: 'Yolculukta çıkmaz sokak; ziyaretçiler siteden ayrılır ya da siteye güvenlerini yitirir.',
    recommendation:
      "Bu URL'ye giden bağlantıları düzeltin veya kaldırın ya da URL'yi doğru sayfaya yönlendirin.",
  },
  'jourilo/console-errors': {
    title: 'Tarayıcı konsoluna hata yazılıyor veya yakalanmamış JavaScript istisnaları var',
    impact:
      'Hatalar çoğu zaman ekran görüntüsünde görünmeyen bozuk özelliklere (hiçbir şey yapmayan düğmeler, eksik içerik) işaret eder.',
    recommendation:
      'Listelenen mesajlarla hatayı yeniden üretin ve asıl istisnayı düzeltin; bir hata izleme aracı ekleyin.',
  },
  'jourilo/failed-requests': {
    title: 'Birinci taraf istekleri başarısız oldu',
    impact: 'Eksik betikler, stiller, veriler veya görseller sayfanın bazı bölümlerini bozar.',
    recommendation: "Kanıtta listelenen URL'leri veya sunucu işleyicilerini düzeltin.",
  },
  'jourilo/failed-third-party': {
    title: 'Üçüncü taraf istekleri başarısız oldu',
    impact: 'Gömülü içerikler, yazı tipleri veya bileşenler bozuk olabilir.',
    recommendation: 'Her bağımlılığın hâlâ gerekli ve ulaşılabilir olup olmadığını kontrol edin.',
  },
  'jourilo/redirect-chain': {
    dynamic: ['title'],
    title: 'Sayfaya birden çok yönlendirmeyle ulaşılıyor',
    impact:
      'Her yönlendirme, sayfa yüklenmeye başlamadan önce bir istek ve bir gidiş-dönüş daha ekler; yavaş mobil ağlarda zincir fark edilir bir gecikme yaratır.',
    recommendation:
      "Doğrudan son URL'ye bağlantı verin (iç bağlantılar, site haritası, canonical) ve her eski adresi tek adımda ona yönlendirin; HTTP'den HTTPS'ye, www ve sondaki eğik çizgi kurallarını birleştirin.",
  },
  'jourilo/unsized-images': {
    title: 'Yeri ayrılmamış görseller düzen kaymasına yol açıyor',
    impact: 'Görseller yüklendikçe içerik yer değiştirir.',
    recommendation: 'Görsellere width ve height öznitelikleri (ya da aspect-ratio) ekleyin.',
  },
  'perf/lcp': {
    dynamic: ['title'],
    title: 'Largest Contentful Paint (LCP) zayıf veya iyileştirilmeli (laboratuvar)',
    impact: SLOW_PAGE,
    recommendation:
      "LCP öğesini daha erken sunun: hero görselini veya yazı tipini önceden yükleyin (preload), lazy loading uygulamayın, sıkıştırın; oluşturmayı engelleyen CSS/JS'yi ve sunucu süresini azaltın.",
  },
  'perf/cls': {
    dynamic: ['title'],
    title: 'Cumulative Layout Shift (CLS) zayıf veya iyileştirilmeli (laboratuvar)',
    impact: 'Kişiler okurken veya dokunmaya çalışırken içerik zıplar ve yanlış tıklamalara yol açar.',
    recommendation:
      'Görseller, reklamlar ve gömülü içerikler için yer ayırın (width/height ya da aspect-ratio), mevcut içeriğin üstüne yeni içerik eklemeyin, boyutu ayarlanmış yedek yazı tipleriyle font-display kullanın.',
  },
  'perf/fcp': {
    dynamic: ['title'],
    title: 'First Contentful Paint (FCP) zayıf veya iyileştirilmeli (laboratuvar)',
    impact: SLOW_PAGE,
    recommendation:
      "Oluşturmayı engelleyen kaynakları ve sunucu yanıt süresini azaltın; kritik CSS'i satır içine alın.",
  },
  'perf/ttfb': {
    dynamic: ['title'],
    title: 'Time to First Byte (TTFB) zayıf veya iyileştirilmeli (laboratuvar)',
    impact: SLOW_PAGE,
    recommendation:
      'Sunucu yanıtını hızlandırın: önbellekleme, CDN, daha az yönlendirme, daha hızlı arka uç sorguları.',
  },
  'perf/tbt': {
    dynamic: ['title'],
    title: 'Total Blocking Time (TBT) zayıf veya iyileştirilmeli (laboratuvar)',
    impact: SLOW_PAGE,
    recommendation:
      'Ana iş parçacığındaki uzun görevleri bölün: kodu parçalara ayırın (code splitting), kritik olmayan betikleri erteleyin, işi ana iş parçacığının dışına taşıyın.',
  },
  'perf/inp': {
    dynamic: ['title'],
    title: 'Yolculuk sırasında etkileşime yavaş yanıt (laboratuvar)',
    impact: 'Arayüz tepkisiz hissettirir; kişiler yeniden tıklar ya da vazgeçer.',
    recommendation:
      'Etkileşimi DevTools Performance panelinde inceleyin; olay işleyicilerindeki uzun görevleri bölün ve acil olmayan işleri erteleyin.',
  },
  'conv/no-primary-cta-above-fold': {
    dynamic: ['title'],
    title: 'İlk ekranda belirgin bir eylem çağrısı yok',
    impact: hypothesis('açılış sayfasından huninin sonraki adımına tıklama oranı'),
    recommendation:
      'Hero alanında tek ve yüksek kontrastlı bir birincil eylemi (ör. "Ücretsiz denemeyi başlat") test edin.',
  },
  'conv/competing-ctas': {
    title: 'İlk ekranda birbiriyle yarışan birden çok birincil eylem var',
    impact: hypothesis('birincil eylem çağrısının tıklama oranı ve ardından kayıt tamamlama oranı'),
    recommendation:
      'Tek bir birincil eylemi, diğerleri görsel olarak ikincil düzeye indirilmiş hâlde test edin.',
  },
  'conv/unclear-value-proposition': {
    title: 'Ana başlık yok ya da bir değer önerisi sunmuyor',
    impact: hypothesis(
      'açılış sayfasında hemen çıkma oranı ve kaydırma derinliği, ayrıca birincil eylem çağrısının tıklama oranı',
    ),
    recommendation:
      'Belirli bir kitle için elde edilecek sonucu anlatan bir başlığı, destekleyici bir alt başlıkla birlikte test edin.',
  },
  'conv/vague-cta-label': {
    dynamic: ['title'],
    title: 'Belirsiz eylem çağrısı etiketi',
    impact: hypothesis('bu kontrolün tıklama oranı'),
    recommendation: 'Sonucu adlandıran bir etiket test edin ("Hesabımı oluştur", "Raporu al").',
  },
  'conv/no-trust-signals': {
    dynamic: ['title'],
    title: 'Kişisel veya ödeme bilgisi isteyen formun yakınında güven sinyali yok',
    impact: hypothesis('formu başlatanların gönderimi tamamlama oranı'),
    recommendation:
      'Formun yanına konuyla ilgili ve doğru güvenceler eklemeyi test edin (gizlilik notu, gerçekten sahip olduğunuz bir güvenlik rozeti, iptal koşulları, gerçek kullanıcı yorumları).',
  },
  'conv/pricing-period-unclear': {
    title: 'Fiyatlar faturalama dönemi belirtilmeden gösteriliyor',
    impact: hypothesis(
      'fiyatlandırma sayfasından ödeme veya kayda geçiş oranı ve fiyatla ilgili destek soruları',
    ),
    recommendation:
      'Her fiyatın yanında faturalama dönemini ve birimi belirtin (ör. "aylık", "kullanıcı başına").',
  },
  'conv/signup-friction': {
    title: 'Kayıt formu gerekenden fazla bilgi istiyor',
    impact: hypothesis('kayıt formunu başlatanların tamamlama oranı'),
    recommendation:
      'Daha kısa bir form (e-posta ve parola ya da SSO) test edin, isteğe bağlı profil sorularını ilk kullanım adımlarına bırakın ve parola onay alanının yerine parolayı gösterme düğmesi koyun.',
  },
  'conv/forced-account-checkout': {
    title: 'Ödeme için hesap oluşturmak zorunlu görünüyor',
    impact: hypothesis('ödemeyi başlatanların siparişi tamamlama oranı'),
    recommendation:
      'Satın almadan sonra isteğe bağlı hesap oluşturmayla birlikte misafir olarak ödemeyi test edin.',
  },
  'design/off-brand-cta-color': {
    dynamic: ['recommendation'],
    title: 'Birincil düğmelerde marka paleti dışında renkler kullanılıyor',
    impact:
      'Tutarsız eylem renkleri neyin tıklanabilir olduğunun tanınmasını zorlaştırır ve markayı zayıflatır.',
    recommendation:
      "Birincil düğmelerde, amaçlanan role en yakın marka renk token'ını kullanın; kanıttaki renkleri marka paletiyle karşılaştırın.",
  },
  'design/off-brand-font': {
    dynamic: ['recommendation'],
    title: 'Metinde marka tipografisinde olmayan yazı tipleri kullanılıyor',
    impact:
      'Ürün markayla tutarsız görünür; yüklenemeyen bir web yazı tipi ayrıca düzen kaymasına yol açabilir.',
    recommendation:
      "Marka yazı tipini ortak tipografi token'ları üzerinden yükleyip uygulayın; ağ panelinde yazı tipi isteğini kontrol edin.",
  },
};
