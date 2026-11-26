# Pixel World (GeoGame) — Güncelleme Tasarım Dokümanı (UPDATE_DESIGN.md)

> Bu doküman, [DESIGN.md](DESIGN.md) temel sürümünden (Faz 1–5) sonra planlanan **Oynanış, Görsellik, Kontrol ve UX Güncellemesi (v1.1)** kararlarını toplar.
> **Durum:** Tamamlandı & Tarayıcıda Doğrulandı *(Aşama 1–4 eksiksiz uygulandı; bkz. [UPDATE_PROGRESS.md](UPDATE_PROGRESS.md))*.

---

## 1. Daha Detaylı Pixel Art, Ülke Rengi Outline & Harita Ölçeğine Sabit Zoom

### Amaç
Karakter ve binaların çok daha detaylı görünmesi, ülke aidiyetinin tek bakışta anlaşılması ve haritaya yakınlaştırdığımızda sprite'ların haritayla birlikte büyüyerek yakından incelenebilmesi.

### Tasarım Detayları
- **Genişletilmiş & Çok Daha Detaylı Mid-Res Pixel Art:**
  - **Askerler (`~24×26` piksel ızgarası):** Katmanlı gölgelendirme ve parlama, belirgin miğfer/üniforma/kemer/çizme detayları; her **silahın** (`Kılıç, Mızrak, Pistol, AK, Bazuka`) ve her **kalkanın** (`Kalkansız, Tahta, Bronz, Çelik, Elmas, Force Field`) hem haritada hem birlik inceleme ikonlarında ilk bakışta ayırt edilebilecek kadar keskin ve zengin çizimi.
  - **Binalar (`~28×26` piksel ızgarası):** Çatı dokusu, sütunlar, pencereler, burçlar, fabrika bacaları, liman iskelesi/feneri, birleşik merkez kompleksi ve daha zengin `Idle / Çalışır` animasyon kareleri.
  - **Taşıma Gemisi:** Aynı detaylı piksel kalitesi ve ülke rengi çerçevesiyle uyumlu.
- **Ülke Rengine Göre Pixel Outline (Dış Çizgi):**
  - Hem **asker** hem **bina** sprite'larının tam siluetine **sahip ülkenin renginde (`owner.color`)** keskin piksel dış çizgi (`outline`) eklenir.
  - **Kontrast Koruması:** Kendi ülke toprağının üstünde siluetin erimemesi için dış çizgi, ülke renginin parlak/doygun tonu + 1 px koyu ayırıcı kontur ile desteklenir.
  - **Teknik Yaklaşım:** Animasyon kareleri küçük offscreen pixel canvas'larda önbelleklenerek 4/8-komşuluk piksel taramasıyla temiz siluet outline üretilir (düşük CPU yükü).
- **Zoom Yapınca Harita Ölçeğinde Sabit (World-Space Fixed) Boyut:**
  - Mevcut sürümde bina ve askerler ekran pikseline sabit (`S = 2`) olduğu için haritaya yakınlaştırıldığında küçük kalıyordu.
  - **Yeni Kural:** Binalar, askerler, gemiler ve çevre öğeleri **harita/dünya koordinatlarına sabit boyutta (world-space fixed)** çizilir.
  - Oyuncu haritaya **yakınlaştırdıkça (zoom in)** binalar ve askerler haritayla orantılı olarak **büyür** (`imageSmoothingEnabled = false` korunarak keskin piksellerle); böylece detaylı pixel art yakından incelenebilir.
  - Çok uzak zoom'da kendi ordularımızın yerini kaybetmemek için sayı/yıldız rozeti okunaklı minimum boyutta kalır.

---

## 2. Takvim Hızı (`1 sn = 0.25 Gün`), Yavaş Doğal Yürüyüş & Fetih Kuralı

### Amaç
Oyunun gerçek zamanlı akışını rahat takip edilebilir tempoya çekmek, orduların mekanik düz çizgi yerine doğal ve taktiksel hızda ilerlemesini sağlamak.

### Tasarım Detayları
- **Yeni Takvim Hızı (`1 gerçek saniye = Çeyrek Gün`):**
  - **`1x` hızda:** `1 gerçek saniye = 0.25 oyun günü` → **`1 oyun günü = 4 gerçek saniye`**.
  - **`0.5x` hızda:** `1 gerçek saniye = 0.125 oyun günü` (`1 gün = 8 sn`).
  - **`2x` hızda:** `1 gerçek saniye = 0.50 oyun günü` (`1 gün = 2 sn`).
  - **Kampanya Süresi (~4 Saat):** `1 Ocak 2000 → 1 Ocak 2010` (`10 oyun yılı` = `3.650 oyun günü` → `1x` hızda **~4 saat 3 dk**, `2x`'te **~2 saat**, `0.5x`'te **~8 saat**; erken tam fetihte oyun daha önce biter).
- **Yavaş Hareket Hızı (`Günde ~1 Bölge`):**
  - `1x` hızda `1 oyun günü = 4 gerçek saniye` olduğu için bir ordunun ortalama 1 bölge kat etmesi **`~4 gerçek saniye`** sürer (`LAND_MOVE_SPEED ≈ 0.45` harita birimi/sn — önceki `2.1`'e göre ~4.7× daha yavaş ve rahat yönetilebilir).
  - `SHIP_MOVE_SPEED` (~1.3× kara hızı) ve `WOUNDED_TRAVEL_SPEED` yeni tempoya orantılı yavaşlatılır.
- **Doğal Yürüyüş Rotası (Zorunlu Centroid Yok, Uzun Mesafede Hafif Sağ/Sol):**
  - Ordu bölge merkezlerine (`centroid`) zorunlu olarak uğramaz; oyuncunun tıkladığı hedefe geçerli kara alanından serbest ilerler *(nötr ülke ve açık deniz üstünden geçmeme kuralı korunur)*.
  - **Uzun Mesafelerde Hafif Sağ-Sol Salınım:** Hedef mesafesi uzunsa (ör. ~1.5+ bölge çapı), rota üzerine deterministik hafif sol/sağ ara sapma noktaları (yumuşak zikzak / doğal kıvrım) eklenir; böylece uzun yürüyüşler mekanik düz çizgi yerine doğal bir sefer rotası gibi görünür.
  - Haritadaki animasyonlu hareket oku bu hafif kıvrımlı/çok parçalı rotayı birebir takip eder.
- **Ara Düşman Bölgelerinde Fetih Kuralı:**
  - Ordu yürüyüş esnasında geçtiği ara düşman bölgelerini otomatik ele geçirmez; **yalnızca durduğu, savaştığı veya hedef olarak gönderildiği bölgeyi** ele geçirir.

---

## 3. Oyuncu Eylem Alırken Otomatik Duraklatma (Auto-Pause)

### Amaç
Oyuncu fareyle fiziksel yerleştirme, hedef belirleme veya kritik taktik karar verirken arkada orduların akıp gitmesini ve rahatsız edici zaman baskısını ortadan kaldırmak.

### Tasarım Detayları
- **Otomatik Duraklatmayı Tetikleyen Durumlar:**
  1. **Fare ile Bina Yerleştirme Modu** (haritada yer seçerken).
  2. **Ordu / Gemi Hedef Seçme Modu** (`moveOrderMode` — askere veya gemiye tıklayıp hedef nokta seçerken).
  3. **Başka Devletin Askeriyle Karşılaşma (Encounter) Popup'ı** açıldığında.
  4. **Tutorial (Nasıl Oynanır)** penceresi oyun içinden açıldığında.
- **Akıllı Devam Etme Kuralı:**
  - Otomatik duraklatma devreye girdiğinde üst barda `⏸ Eylem İçin Duraklatıldı` göstergesi belirir ve zaman hızı donar.
  - Eylem tamamlandığında veya iptal edildiğinde (bina koyuldu, rota verildi, popup kapatıldı, sağ tıkla çıkıldı) oyun otomatik olarak önceki hızına (`0.5x / 1x / 2x`) döner.
  - Oyuncu eylemden önce oyunu **manuel olarak `Space` / `⏸` ile durdurmuşsa**, eylem bitince oyun tekrar manuel duraklatılmış halde kalır (oyuncunun durdurma kararını ezmez).

---

## 4. Başka Devletin Askeriyle Karşılaşma Popup'ı (Encounter Modal + Diplomasi Sekmesi)

### Amaç
Sahada başka bir devletin ordusuna denk gelindiğinde oyuncuya körlemesine çarpışma yaşatmak yerine, oyunu durdurup tam kuvvet karşılaştırması ve diplomatik bağlamla bilinçli karar verdirtmek.

### Tasarım Detayları
- **Tetikleme:** Oyuncunun bir ordusu haritada başka bir ülkenin (savaşta, nötr veya müttefik) ordusuyla karşılaşma mesafesine girdiğinde **oyun anında otomatik durur** ve **Karşılaşma Popup'ı** açılır.
  - *(Aynı ordu çifti için karar verildikten sonra hemen tekrar tetiklenmemesi adına kısa soğuma / karar kaydı tutulur.)*
- **Popup Üst Sekmeleri (2 Sekme):**
  1. **`⚔️ Karşılaşma` Sekmesi (Varsayılan):**
     - Başlık: *"Ordunuz, **[Ülke Adı]** ordusuna denk geldi!"* + anlık ilişki etiketi (`Savaşta`, `Nötr`, `Müttefik`).
     - **İki Tarafın Askeri Durumu (Yan Yana Karşılaştırma):**
       - Toplam asker sayısı ve tahmini toplam saldırı / savunma özeti.
       - Her iki ordudaki tüm birlik türlerinin **detaylı piksel ikonları** ve **ayrı ayrı sayıları** *(Bölüm 5'teki ikon bileşeni burada doğrudan kullanılır; ikonların üstüne gelince silah/kalkan/sayı tooltip'i açılır)*.
     - **Karar Aksiyonları:**
       - *Savaşta isek:* **`⚔️ Saldır / Savaşa Gir`** veya **`🏃 Dur / Geri Çekil`**.
       - *Nötr isek:* **`⚔️ Savaş İlan Et ve Saldır`** veya **`🛑 Saldırma / Dur`**.
       - *Müttefik isek:* **`🤝 Devam Et / Geç`**.
  2. **`📜 Diplomasi` Sekmesi (Popup Üst Kısmında):**
     - Popup'ı kapatmadan tüm aktif ülkeler arasındaki **ilişki durumlarını** (`Savaş / İttifak / Nötr`, ilişki puanları, karşılaştığımız ülkenin müttefikleri ve düşmanları) gösterir.
     - Gerekirse doğrudan buradan **Savaş İlanı / İttifak Teklifi / Barış Teklifi** aksiyonları da alınabilir.
- **Kapanış:** Oyuncu karar butonuna bastığında popup kapanır ve otomatik duraklatma kalkar.

---

## 5. İkon Tabanlı Birlik İnceleme (Silah & Kalkan Ayırt Edilebilir + Hover Tooltip)

### Amaç
Ordu içeriğini düz metin listesi yerine ilk bakışta anlaşılır, görsel piksel ikonlarla incelemek.

### Tasarım Detayları
- **Kullanıldığı Yerler:**
  - **Ordu Kümesi Penceresi** (`army` modal — genel görünüm + Ayırma/Split bölümü)
  - **Karşılaşma (Encounter) Popup'ı** (bizim ordu vs karşı ordu karşılaştırması)
  - **Taşıma Gemisi İçeriği** (gemideki birlikleri görüntülerken)
- **Görsel Birlik İkonu Kartı:**
  - Kümede sayısı `> 0` olan her `(Silah, Kalkan)` kombinasyonu için **detaylı mid-res pixel-art asker ikonu** çizilir.
  - İkon, o birliğin **tam silahını ve tam kalkanını** (ör. AK + Çelik Kalkan, Bazuka + Force Field, Kılıç + Kalkansız) ve **ülke rengi outline'ını** netçe ayırt edilecek şekilde gösterir; köşesinde sayı rozeti (`×15`) yer alır.
- **Hover Bilgi Notu (Tooltip):**
  - Herhangi bir birlik ikonunun üstüne fare tutulduğunda anında şu bilgileri gösteren pixel tooltip açılır:
    - **Birlik Sayısı:** ör. `15 Asker`
    - **Silah:** ör. `AK (Hasar: 40)`
    - **Kalkan:** ör. `Elmas Kalkan (Koruma: 26)` *(veya `Kalkansız — Koruma: 0`)*

---

## 6. Görsel Bilim Ağacı (Tech Tree UI)

### Amaç
Bilim (Üniversite) penceresini sade iki kolon liste yerine gerçek bir görsel teknoloji ağacı olarak sunmak.

### Tasarım Detayları
- **Ağaç Yapısı (Node & Bağlantı Çizgileri):**
  - En solda/üstte tek bir **Başlangıç Node'u (`🏛️ Temel Bilim`)** yer alır.
  - Başlangıç node'undan **2 belirgin bağlantı çizgisi (dal)** ayrılır:
    - **1. Dal — Silahlar:** `Kılıç ── Mızrak ── Pistol ── AK ── Bazuka`
    - **2. Dal — Kalkanlar:** `Tahta ── Bronz ── Çelik ── Elmas ── Force Field`
  - Açık teknolojiler arası çizgiler parlak/aktif renkli, kilitli dallar sönük/kesikli çizgiyle gösterilir; araştırılan node üzerinde canlı ilerleme halkası/çubuğu akar.
- **Node Görünümü:**
  - Her node'un ortasında ilgili silah veya kalkanın **detaylı pixel-art ikonu** yer alır.
  - İkonun **hemen altında gereken para miktarı** net şekilde yazar (ör. `200 💰`; açıksa `✓ Açık`, araştırılıyorsa `%54`).
- **Hover Stat Kartı (Tooltip):**
  - Fare herhangi bir teknoloji ikonunun üstüne geldiğinde stat penceresi açılır:
    - Teknoloji adı ve kademesi (`Tier 1–5`)
    - **Savaş Statı:** `Hasar` (silahlar) veya `Koruma` (kalkanlar)
    - **Araştırma:** Gereken Para & Süre (`sn`)
    - **Fabrika Üretimi:** Birim maliyet & üretim süresi (`sn`)
    - Durum bilgisi (*Açık / Araştırmak için tıkla / Önce önceki kademeyi aç*).

---

## 7. Ana Ekran ("Pixel World") & Opsiyonel Tutorial Akışı

### Amaç
Oyunun direkt dünya haritasıyla açılması yerine oyuncuyu kimliği güçlü bir **pixel-art ana ekranla** karşılamak ve yeni oyunculara zorlayıcı olmadan opsiyonel bir **Tutorial** seçeneği sunmak.

### Tasarım Detayları
- **Oyunun İsmi:** **`Pixel World`** *(tarayıcı başlığı `<title>`, ana ekran logosu ve harita seçim üst bandı `Pixel World` olarak güncellenir)*.
- **Açılış Ana Ekranı (`main_menu` fazı — başlangıçta direkt harita açılmaz):**
  - Oyun açıldığında dünya haritası yerine canlı **pixel-art Ana Ekran** görünür (`GamePhase: 'main_menu' | 'world_select' | 'playing' | 'ended'`).
  - **Ekran Yerleşimi (Yukarıdan Aşağıya):**
    1. **En Üstte — Pixel-Art Logo:** Bloklu, gölgeli, keskin piksel harflerle **`PIXEL WORLD`** başlığı.
    2. **Ortada — Canlı Pixel-Art Sahne:** Animasyonlu **Banka binası** (dönen/zıplayan altın para efektli) ve hemen yanında **Bazuka tutan pixel-art asker** (ülke rengi outline'lı, canlı hazır/idle animasyonlu).
    3. **Alt Kısımda — Ana Butonlar:**
       - **`▶ Oyna`**
       - **`📖 Tutorial`**
- **Seçenekli Tutorial ("Oynamak İster Misiniz?" Akışı):**
  - Oyuncu ana ekrandan doğrudan **`📖 Tutorial`** butonuna tıklayarak rehberi açabilir.
  - Oyuncu **`▶ Oyna`** butonuna tıkladığında opsiyonel kısa bir diyalog sorar: **"Oyuna başlamadan önce Tutorial'ı oynamak / incelemek ister misiniz?"**
    - **`📖 Evet, Tutorial'ı Aç`:** 5 adımlı görsel rehberi açar (sonunda **`▶ Haritaya Geç / Oyna`** ve **`← Ana Menü`** butonları bulunur).
    - **`▶ Hayır, Direkt Haritaya Geç`:** Doğrudan **Dünya Haritası Ülke Seçim Ekranı (`world_select`)** açılır *(isteğe bağlı "Bir daha sorma" seçeneğiyle)*.
  - Oyun içinden de (`H` kısayolu veya üst bar) Tutorial'a istenildiği zaman dönülebilir *(oyunu otomatik duraklatır)*.
- **Tutorial İçeriği (5 Kısa Adım):**
  1. **Harita & Amaç:** Ülke seçimi, arena sınırı (maks. 15 AI), Pan/Zoom.
  2. **Ekonomi & Fareyle Bina Kurma:** Para/Manpower/Sağlık, haritada manuel bina yerleştirme, bölge başına 1 bina & küçük ülkelerde Birleşik Bina.
  3. **Bilim Ağacı, Fabrika & Kışla:** Görsel teknoloji ağacı, ekipman üretimi, asker eğitimi.
  4. **Ordu, Karşılaşma, Savaş, Hastane & Liman:** Seç/gönder, otomatik duraklatma, karşılaşma popup'ı, `%30` hastaneye kaçış, Liman & gemi.
  5. **Diplomasi, `Q` Odaklanma & Kısayollar:** Savaş ilanı, ittifak/barış, Ayarlar'dan tuş atama ve hover kısayol ipuçları.

---

## 8. Fare ile Manuel Bina Yerleştirme

### Amaç
Binaları açılır listeden seçip bölgenin ortasına otomatik atmak yerine, oyuncunun harita üzerinde **tam istediği noktaya** mouse ile yerleştirebilmesi.

### Tasarım Detayları
- **Binalar** penceresinden bir bina seçildiğinde pencere kapanır, **Bina Yerleştirme Modu** açılır ve **oyun otomatik duraklatılır** *(Bölüm 3)*.
- Fare harita üzerinde gezerken seçilen binanın yarı saydam **pixel-art ghost önizlemesi** imleci takip eder.
- **Canlı Geçerlilik Geri Bildirimi:**
  - *Geçerli:* Yeşil çerçeve + bölge vurgusu (kendi bölgesi, bölgede başka bina yok, `Liman` için kıyı şartı sağlanıyor, para yeterli).
  - *Geçersiz:* Kırmızı uyarı + kısa neden (*"Bölge dolu"*, *"Kendi toprağınız değil"*, *"Kıyı bölgesi gerekli"*, *"Yetersiz para"*).
- **Sol Tık:** Tam tıklanan `(x, y)` harita koordinatında inşaat başlar ve oyun devam eder.
- **Sağ Tık / Harita Dışı Tık:** Yerleştirme modunu para harcamadan iptal eder ve oyun devam eder.
- **Veri Modeli:** `BuildingSlot` içine `{ x, y }` koordinatı eklenir; render binayı `reg.centroid` yerine bu koordinatta çizer ve bina altındaki çevre öğelerini (`tree/grass` vb.) temizler.

---

## 9. Kendi Ordularımızın Net Görünürlüğü & Sırayla Orduya Zoomlama (`Q` + HUD Butonu)

### Amaç
Haritada kendi birliklerimizi her zoom seviyesinde anında seçebilmek ve tek tuşla/butonla tüm ordularımıza sırayla atlayabilmek.

### Tasarım Detayları
- **Görünürlük İyileştirmeleri:**
  - Ülke rengi pixel outline + oyuncu birliklerine özel yüksek kontrastlı `★` yıldızlı sayı rozeti + zemin altında hafif nabız atan dost halka + en üst çizim önceliği (Z-order).
- **Sırayla Orduya Odaklanma (Cycle Army Focus):**
  - Üst bar / HUD üzerinde **`🎯 Orduma Odaklan`** butonu + varsayılan **`Q`** tuşu *(Ayarlar'dan değiştirilebilir)*.
  - Her tıklama veya `Q` basışında sıradaki oyuncu ordusuna (`(idx + 1) % playerArmies.length`) geçer; karada ordu yoksa içi dolu taşıma gemilerine odaklanır.
  - Kamera (`MapCamera.focusOn`) yumuşak animasyonla o birliğin üzerine kayar ve yakınlaştırır; birliğin etrafında ~1 saniyelik kısa **odak ping halkası** oynar (oyuncuyu yanlışlıkla hareket emrine kilitlemeden).

---

## 10. Ayarlar: Key Binding (Tuş Atama) & Dinamik Hover Kısayol Notları

### Amaç
Klavyeyle kontrol edilebilen her komutu Ayarlar'dan özelleştirebilmek ve ekranda o komutun üstüne gelindiğinde hangi tuşa basılacağını anında görmek.

### Tasarım Detayları
- **Varsayılan Tuş Atamaları (`localStorage`'da kalıcı, `Varsayılanlara Sıfırla` destekli):**

| Komut | İşlev | Varsayılan Tuş |
|---|---|---|
| `togglePause` | Durdur / Devam Et | `Space` |
| `speedSlow` | Zaman Hızı `0.5x` | `1` |
| `speedNormal` | Zaman Hızı `1x` | `2` |
| `speedFast` | Zaman Hızı `2x` | `3` |
| `cycleArmy` | Sıradaki Orduya Zoomla | `Q` |
| `openBuildings` | Binalar Penceresi | `B` |
| `openFactory` | Fabrika Penceresi | `F` |
| `openBarracks` | Kışla Penceresi | `K` |
| `openScience` | Bilim Ağacı Penceresi | `T` |
| `openDiplomacy` | Diplomasi Penceresi | `D` |
| `openSettings` | Ayarlar Penceresi | `O` |
| `openTutorial` | Nasıl Oynanır / Tutorial | `H` |

- **Güvenlik Kuralları:**
  - **`Esc` atanamaz** ([DESIGN.md](DESIGN.md) web tam ekran çakışması kuralı korunur).
  - Çakışan tuş seçilirse otomatik takas (swap) veya net uyarı verilir.
  - `INPUT / SELECT / TEXTAREA` odaktayken kısayollar tetiklenmez.
  - Fiziksel tuş kodu (`KeyboardEvent.code`) kullanılır, ekranda okunaklı tuş adı (`Boşluk`, `Q`, `1` vb.) görünür.
- **Dinamik Hover Kısayol Notu:**
  - Klavye tuşuna bağlı **her UI elemanının** üstüne fareyle gelindiğinde gecikmesiz pixel-art tooltip içinde komut adı ve güncel tuş bilgisi görünür *(ör. `Sıradaki Orduya Zoomla — Tuş: [Q]`)*.
  - Ayarlar'dan bir tuş değiştirildiğinde tüm ekran tooltip'leri anlık güncellenir.

---

## 11. Etkilenecek Modüller Özeti (Kodlama Haritası)

- **Veri & Denge (`src/types.ts`, `src/config/balance.ts`, `src/config/keybindings.ts` [yeni]):**
  - `GamePhase = 'main_menu' | 'world_select' | 'playing' | 'ended'`, `CALENDAR.DAYS_PER_SIM_SECOND = 0.25`, `CALENDAR.END_YEAR = 2010`, `CALENDAR.TOTAL_DAYS = 3650` (~4 saat @ `1x`), `LAND_MOVE_SPEED ≈ 0.45`, `BuildingSlot.{x, y}`, `ArmyStack.waypoints: Point[]`, `GameState.{autoPauseReasons, placingBuildingType, activeEncounter, armyFocusIndex}`, kalıcı KeyBindings yöneticisi.
- **Render & Pixel Art (`src/art/pixelSprites.ts`, `src/render/mapRenderer.ts`, `src/render/camera.ts`):**
  - Detaylı `~24×26` asker + `~28×26` bina sprite'ları + offscreen ülke rengi outline cache + tekil birlik/teknoloji ikon üreticisi (canvas/dataURL); `Pixel World` ana ekran sahnesi (pixel-art logo + animasyonlu Banka + Bazuka tutan asker); world-space fixed ölçekleme; hafif sağ-sol kıvrımlı hareket oku; bina yerleştirme ghost'u; `MapCamera.focusOn`.
- **Simülasyon (`src/sim/army.ts`, `src/sim/economy.ts`, `src/sim/calendar.ts`):**
  - Uzun mesafe hafif sağ-sol rota + ara düşman bölgelerini es geçip sadece durup savaştığı bölgeyi fethetme; karşılaşma (encounter) tespiti ve soğuma; `(x, y)` manuel bina inşası; otomatik duraklatma / eski hıza dönme durumu.
- **Arayüz (`index.html`, `src/ui/windows.ts`, `src/main.ts`, `src/style.css`):**
  - `Pixel World` başlığı & açılış ana ekranı (`Oyna` + `Tutorial` + opsiyonel "Tutorial oynamak ister misiniz?" sorusu); Görsel 2 dallı Bilim Ağacı (SVG/HTML çizgili + ikon + alt fiyat + hover stat); Karşılaşma Popup'ı (2 sekme: Karşılaşma + Diplomasi); ikonlu Birlik İnceleme & hover tooltip; Ayarlar Key Binding + dinamik hover kısayol tooltip bileşeni; `Q` + HUD ordu zoom butonu.
