# Pixel World — v1.2 Güncelleme Tasarım Dokümanı (UPDATE_DESIGN_V1_2.md)

> Bu doküman, [UPDATE_DESIGN.md](UPDATE_DESIGN.md) (v1.1) sonrası geliştirilecek **v1.2 — Harita/Ülke Temizliği, 5 Saniyelik Ekonomi & Banka Borcu, RTS Kutu Seçimi, Bina İşlem Popupları (İkonlu Kışla & Paralel Fabrika, 2 Sayfalı Diplomasi) ve 11 Adımlı İnteraktif Spotlight Tutorial** güncellemesinin kesinleştirilmiş tasarım kararlarını içerir.
> **Durum:** Tasarım Onaylandı & Kodlamaya Hazır *(Henüz kodlanmadı)*.

---

## 1. Harita Temizliği, Daha Kompakt Bölgeler & Nesneler, Kalın Ülke Sınırları & Tek Bina Sisteminin Kaldırılması

### Tasarım Detayları
- **Dengeli Şekilde Küçültülmüş Bölge Boyutları (Daha Fazla Bina Alanı):**
  - `ARENA_CONFIG.TARGET_REGION_AREA`: `3.2` → **`2.0`** *(alan olarak ~%38 daha kompakt, çap olarak ~%21 daha küçük — fazla küçülüp okunmaz olmadan orta/küçük ülkelerde ~%60 daha fazla bölge ve dolayısıyla çok daha fazla bina yerleştirme alanı sağlar)*.
  - `ARENA_CONFIG.MAX_REGIONS_PER_COUNTRY`: `48` → **`64`** *(büyük ülkelerin orantısını korumak için)*.
  - Ordu yürüyüş hızı yeni bölge çapına orantılı ayarlanır (`LAND_MOVE_SPEED ≈ 0.36`, yine günde ~1 bölge temposunda).
- **Genel Olarak Daha Küçük Harita Nesneleri (Bina, Asker, Gemi & Çevre Öğeleri):**
  - Harita üzerindeki **tüm nesnelerin** (binalar, askerler, taşıma gemileri, ağaçlar, dağlar, çimen/kaktüs/kumullar) world-space baz ölçeği çözünürlükten bağımsız olarak **~%30 küçültülür** (`computeWorldSpritePixelStep`: `cameraScale / 18` → **`cameraScale / 26`**, taban `0.55`).
  - Piksel art detayı ve yakın zoom inceleme kabiliyeti tamamen korunur; yeni bölge boyutlarının içine binalar ve askerler çok daha temiz ve orantılı oturur.
- **Kalın Ülke Dış Sınırları & İnce İç Bölge Sınırları:**
  - Farklı ülkelere ait komşu bölgeler arasındaki **ülke dış sınırları** `3.5–4 px` kalınlığında koyu/yüksek kontrastlı çizgiyle çizilir; ülke sınırları tek bakışta net okunur.
  - Aynı ülkenin içindeki bölge sınırları ince (`1 px`) yarı saydam çizgi olarak kalır.
- **Küçük Ada Ülkeleri & Mikro Ülke Birleştirme (Eşik: `≤ 4` Bölge):**
  - **`≤ 4` bölgeli ufak ada ülkeleri** (Kıbrıs vb.) oyuna hiç dahil edilmez (ne dünya ülke seçiminde ne de bölgesel arenada yer alır).
  - **`≤ 4` bölgeli küçük kara/kıyı ülkeleri** (Venedik, Vatikan, San Marino, Monako, Andorra, Lüksemburg, Lübnan vb.) en uzun sınırı paylaştığı büyük komşu ülkenin toprağına birleştirilir.
- **Tek Bina (`Merkez Kompleks / combined`) Sisteminin Komple Kaldırılması:**
  - Küçük ülkeler elenip/birleştirildiği ve bölgeler dengeli küçültüldüğü için artık her ülke yeterli bölgeye sahiptir.
  - `combined` bina tipi, yükseltme maliyetleri ve küçük ülke özel mantığı kod tabanından tamamen kaldırılır; tüm ülkeler standart binaları (`Banka`, `Fabrika`, `Kışla`, `Hastane`, `Üniversite`, `Liman`) ayrı ayrı kurar.

---

## 2. AI Başlangıç Bekleme Süresi & Adil Üretim Zinciri

### Tasarım Detayları
- **AI Tam Bekleme Penceresi (`AI_STARTUP_DELAY_DAYS = 3`):**
  - Oyun başladığında ilk **`3` oyun günü** (`1x` hızda `12` gerçek sn) boyunca AI ülkeler hiçbir aksiyon (bina, üretim, eğitim, diplomasi, saldırı) almaz.
- **Erken Barışçıl Gelişim Dönemi (`AI_PEACEFUL_DEV_UNTIL_DAYS = 7`):**
  - `3.` günden **`7.` oyun gününe** (`~28` gerçek sn) kadar AI ülkeler yalnızca kendi iç ekonomisine, binalarına ve teknolojisine odaklanır; **savaş ilanı ve saldırı yapmaz** *(oyuncu savaş açarsa savunma hakkı saklıdır)*.
- **AI'lar da Aynı Ekipman → Asker Formülüne Dahil (Anında Asker Yok):**
  - Yapay zekâ ülkeler anında/yoktan asker üretemez; önce Banka → **Fabrika** kurup `2–15 sn` birim süreyle **silah ve kalkan üretir**, ekipman stoğa girdikten sonra yalnızca elindeki `Manpower` ve ekipman stoğuna göre ortak Kışla `min` formülüyle (`Bölüm 7`) asker eğitir.

---

## 3. Ekonomi: Başlangıç Binası (Tek Üniversite), 5 Saniyelik Gelir, Fetih Ganimeti (`+1.000 💰`) & Banka Borç Sistemi

### Tasarım Detayları
- **Başlangıç Binası & Tek Üniversite Kuralı (`MAX_UNIVERSITIES = 1`):**
  - Oyun başladığında her ülkede **yalnızca `1` adet `Üniversite`** otomatik olarak bulunur; başlangıçta Banka, Kışla, Fabrika veya başka bina verilmez.
  - Üniversitenin tek amacı teknoloji gelişimi olduğu için **daha fazla Üniversite satın alınamaz** (ülke başına tavan `1` adet; yalnızca mevcut Üniversite düşman fethiyle yok olursa veya oyuncu yerini değiştirmek için yıkarsa tekrar `1` adet kurulabilir).
- **Başlangıç Parası, Banka Maliyeti & Sıfır Bakım Maliyeti:**
  - `ECONOMY.START_MONEY`: `300` → **`100` Para** | `BUILDINGS.bank.cost`: `150` → **`100` Para**.
  - **Asker bakım/maaş maliyeti (upkeep) YOK:** Askerler yalnızca üretilirken Manpower + ekipman harcar; ekonomi ferah ve anlaşılır kalır.
- **5 Saniyede Bir Toplu Para Artışı (`INCOME_TICK_SEC = 5`):**
  - Para her karede lineer artmaz; birikimli sayaç her **`5` simülasyon saniyesinde bir** tetiklenir ve 5 saniyelik toplam gelir (Banka gelirleri + varsa aktif Ticaret Anlaşması bonusları) tek seferde kasaya eklenir.
  - Üst HUD'da paranın altında/yanında **canlı dolan ince altın bar** yer alır; her `5 sn`'de para yatınca **`+X 💰`** yüzen animasyon efekti oynar.
- **Bölge Fethi: Düşman Binası Yıkılır & `+1.000 💰` Ganimet:**
  - Bir düşman bölgesi ele geçirildiğinde **o bölgedeki düşman binası yıkılır** (`reg.building = null`), kazanan tarafa anında **`+1.000 💰`** fetih ödülü yatar *(oyuncu fethinde `+1000 💰` yüzen efekt çıkar)* ve boşalan o bölgeye kendi istediği binayı kurabilir.
- **Banka Borç Sistemi (`500 / 1.000 / 10.000`):**
  - Haritadaki Banka binasına tıklandığında açılan popup'ta **`+500 💰`**, **`+1.000 💰`** ve **`+10.000 💰`** borç butonları bulunur.
  - **Faiz & Tavan:** Alınan borca **`%15` faiz** eklenir (`debt += miktar * 1.15`). Maksimum toplam borç tavanı **`20.000 💰`**'dir; tavana ulaşılınca yeni borç butonları kapanır (ek iflas/moral cezası yok).
  - Her `5 sn`'lik gelir ödemesinde brüt gelirin **`%25`'i** otomatik olarak borçtan düşülür; borç `> 0` iken üst HUD'da **borç rozeti** görünür ve Banka popup'ında **`Borcu Kapat`** butonu yer alır.

---

## 4. RTS Fare Kontrolleri, Kutu Seçimi (Box-Select), Evrensel Highlight & Bina Yıkma

### Fare & Kamera Kontrolleri
- **Sol Tık + Sürükle:** Dikdörtgen **Alan / Kutu Seçimi (Box-Select)** — sürüklenen yeşil/altın çerçeve içindeki tüm dost birlikleri aynı anda seçer.
- **Sağ Tık + Sürükle / Orta Tık + Sürükle / `WASD` & Ok Tuşları:** Harita Kaydır (**Pan**).
  - *(Sağ tık sürüklemeden tek tıklanırsa `< 4 px` mevcut İptal aksiyonu çalışır. `WASD` kamera kaydırma ile çakışmaması için Diplomasi varsayılan kısayolu `D → P` güncellenir.)*
- **Çoklu Seçili Ordular — Sağ Alt Panel & Birleştirme:**
  - Kutuyla `2+` dost birlik seçildiğinde ekranın **sağ alt köşesinde** kompakt çoklu ordu paneli açılır: seçili birlik sayısı + toplam asker + **`🔗 Seçilenleri Birleştir`** + **`✕ Seçimi İptal`**.
  - **`🔗 Birleştir`** basıldığında seçili birlikler yakınsa anında birleşir; uzaklarsa ortak buluşma noktasına yürüyüp buluşunca otomatik birleşir.
  - Çoklu seçim aktifken haritada bir hedef bölgeye/düşmana sol tıklayınca seçili **tüm ordular birlikte** hedefe yürür.
  - Tek bir dost ordu seçiliyken başka bir dost ordunun üstüne sol tıklayınca seçili ordu ona doğru yürüyüp buluşunca otomatik birleşir.

### Evrensel Highlight, Boş Bölge Hızlı İnşa & Bina Yıkma
- **Evrensel Tıklama Highlight'ı:** Haritada tıklanan her öğe (bina, bölge, ordu, gemi) parlak altın/camgöbeği piksel çerçeveyle belirgin şekilde vurgulanır.
- **Kendi Boş Bölgene Tıklama:** Bölge highlight olur; tıklanan bölgenin yanında hızlı **`Buraya Bina Kur`** mini ikon menüsü (satın alınabilir bina ikonları + fiyat, tıklayınca direkt o bölgeye kurulum) açılır ve sol alt bölge bilgi kutusu güncellenir.
- **Haritadaki Kendi Binana Tıklama → İşlem Popup'ı + Auto-Pause:**
  - Askerler harici haritadaki herhangi bir kendi binasına (Banka, Üniversite, Hastane, Kışla, Fabrika, Liman) tıklayınca o bina highlight olur, doğrudan **o binaya özel işlem popup'ı** açılır ve **oyun otomatik durur** (`autoPauseReasons` → `'building_popup'`). Popup kapanınca önceki hıza dönülür.
- **Bina Yıkma (`🗑️ Binayı Yık`):**
  - Her bina popup'ında kırmızı **`🗑️ Binayı Yık`** butonu bulunur.
  - İlk tıklamada hızlı 2. tık onayı (**`⚠️ Emin misiniz? (+%50 İade)`**) ister; onaylanınca bina yıkılır, bölge boşalır ve **bina maliyetinin `%50`'si** kasaya iade edilir.

---

## 5. Sadeleşmiş HUD, Alt Menü (`🏪 Mağaza`), Evrensel Popup İkon/Ayırıcı Standardı & Canlı İşlem Şeridi

### Tasarım Detayları
- **Sadeleşmiş Alt Menü (Dock):**
  - Bina işlemleri doğrudan haritadaki binalara tıklayarak (veya kısayollarla) açıldığı için alt menüde yalnızca 3 ana buton bulunur:
    - **`🏪 Mağaza`** *(binaları ikon + isim + fiyatla seçip haritaya yerleştirme)*
    - **`📜 Diplomasi`** *(2 sayfalı İlişkideki Ülkeler popup'ı)*
    - **`🌍 Harita`** *(3 slotlu Kaydet & Çık / Haritaya Dön popup'ı — bkz. Bölüm 11)*
- **🏪 Mağaza Popup'ı (Bina Satın Alma & Haritaya Yerleştirme):**
  - Satın alınabilir binalar (`Banka`, `Fabrika`, `Kışla`, `Hastane`, `Liman`; `Üniversite` yalnızca mevcut sayısı `0` ise görünür/açıktır) düzenli bir liste halinde görünür.
  - Her bina satırında **binanın kendi piksel-art ikonu (`getBuildingSpriteDataUri`) + bina adı + fiyatı (`100 💰` vb.) + kısa açıklama + `Haritaya Yerleştir` butonu** bulunur.
  - **Her bina satırının arasında belirgin yatay ayırıcı çizgi** yer alır.
- **Evrensel Popup Görsel Standardı (TÜM Popuplarda Geçerli):**
  - Oyundaki **her popup'ta** (Mağaza, Banka, Üniversite/Bilim, Hastane, Kışla, Fabrika, Ordu, 2 Sayfalı Diplomasi, Karşılaşma, Kaydet/Çık, Continue, Ayarlar) **ilgili binanın/nesnenin kendi piksel-art ikonu** (başlıkta ve her satır/öğede) mutlaka yer alır.
  - Tüm popuplardaki listelenen **her nesne/satır arasında belirgin yatay ayırıcı çizgi (`divider`)** bulunur; görsel hiyerarşi ve taranabilirlik maksimumda tutulur.
  - *(Not: Mağaza'da her bina için **ikon + isim + fiyat** birlikte yazar; Kışla ve Fabrika'daki silah/kalkan listelerinde ise Bölüm 7–8 kararı gereği **sadece ikon** görünür, isimler hover tooltip'te çıkar — her iki yerde de nesneler arasında ayırıcı çizgi bulunur.)*
- **Sade Üst HUD Barı:**
  - Sol: `★ Ülke Adı` + `Tarih` + varsa `Auto-Pause / İptal` rozeti.
  - Orta: `💰 Para` (+ altında ince canlı `5 sn` altın dolum barı & `+X` yüzen efekt) + varsa `🏦 Borç` rozeti + `👥 Manpower` + `❤️ Sağlık` + `⚔️ Asker` + `🎯 Ordum [Q]`.
  - Sağ: Hız butonları (`⏸ 0.5x 1x 2x`) + `📖 Tutorial` + `⚙️ Ayarlar`.
- **Sol Üst Şeffaf "Canlı İşlem Şeridi":**
  - Üst HUD'un hemen sol altında, yalnızca aktif bir işlem varken otomatik görünen kompakt yarı şeffaf şerit:
    - Tüm Fabrikalardaki devam eden **ekipman üretimleri** (ikon + kalan adet + mini bar),
    - Aktif **Bilim araştırması** (ikon + `%`),
    - **Hastanelerde iyileşmekte olan** toplam yaralı asker sayısı (kırmızı haç + sayı).

---

## 6. Binaların Stratejik Rolleri: Banka, Üniversite, Hastane & Yaralı Geri Dönüş Animasyonu

- **Bina-Bazlı Bağımsız Mimari Özeti:** Her bina haritadaki **konumu** ve **bağımsız kapasitesiyle** anlam kazanır:
  - **Bankalar:** Her ekstra Banka `5 sn`'lik para basma hızını artırır (`+60 💰 / 5sn` ek).
  - **Fabrikalar:** Her Fabrika kendi bağımsız paralel silah/kalkan üretim hatlarını çalıştırır → birden fazla Fabrika aynı anda daha fazla ekipman üretir *(Bölüm 8)*.
  - **Kışlalar:** Her Kışla kendi bağımsız asker eğitim kuyruğunu çalıştırır ve çıkan askerler **tam o Kışlanın yanında** doğar → hem cepheye yakınlık hem aynı anda çoklu eğitim avantajı sağlar *(Bölüm 7)*.
  - **Hastaneler:** Hem **konum** (yaralılar en yakın ayakta Hastaneye koştuğu için cepheye yakın Hastane yaralıları çok daha çabuk kurtarır) hem **hız/sağlık** (`+%15` sağlık, `+2/sn` Manpower) açısından kritik önem taşır.
  - **Üniversite:** Tek amacı teknoloji ağacı araştırmasıdır; oyun başında `1` tane otomatik gelir, fazlası satın alınamaz (`MAX_UNIVERSITIES = 1`).
- **Banka Popup'ı (`bank`):** Başlıkta Banka piksel ikonu, toplam Banka sayısı, `+X 💰 / 5sn` brüt/net gelir, kalan borç, **`+500 / +1.000 / +10.000`** borç butonları (`%15` faiz, `20.000` tavan), **`Borcu Kapat`** ve kırmızı **`🗑️ Binayı Yık`** *(bölümler arası net ayırıcı çizgilerle)*.
- **Üniversite Popup'ı (`university`):** Başlıkta Üniversite piksel ikonu, mevcut 2 dallı görsel Bilim Ağacı + kırmızı **`🗑️ Binayı Yık`**.
- **Hastane Popup'ı (`hospital`):**
  - Başlıkta Hastane piksel ikonu; tıklanan **o hastanede** aktif iyileşmekte olan asker sayısı (`travelProgress >= 1`) + iyileşme ilerleme çubuğu.
  - O hastaneye **yolda olan** yaralı asker sayısı (`travelProgress < 1`) ve iyileşen birliklerin ikonlu dökümü.
  - Sağlık (`+%15`) & Manpower (`+2/sn`) katkısı + kırmızı **`🗑️ Binayı Yık`** *(satırlar arası ayırıcı çizgilerle)*.
- **Savaştan Kaçan Yaralıların Geri Dönüş Animasyonu:**
  - Çatışmadan kaçan (`%30`) askerler haritada hareketli kırmızı haçlı yaralı piksel figürü + kesikli yeşil/beyaz iz ile **en yakın ayakta Hastaneye** koşar.
  - İyileşme bitince hastaneden parlak yeşil-altın **`+X İyileşti!`** animasyonuyla eski silah/kalkanlarıyla aktif orduya geri dönerler.

---

## 7. İkonlu Kışla Popup'ı (Bina-Bazlı Bağımsız Eğitim, Konumda Doğuş, `MAX` & Kıt Kaynak Formülü)

### Tasarım Detayları
- Haritada **hangi Kışla binasına** tıklanırsa o Kışlanın kendi bağımsız eğitim popup'ı açılır ve oyun durur (başlıkta Kışla piksel ikonu + bölge adı).
- **Konum & Paralel Çoklu Kışla Avantajı:**
  - Her Kışla kendi eğitim kuyruğunu (`building.trainingQueue`) bağımsız işletir; üretilen askerler **tam üretildikleri o Kışlanın yanında** haritada doğar (cepheye yakın Kışla birlikleri cepheye çok daha hızlı ulaştırır; birden fazla Kışla aynı anda paralel asker yetiştirir).
- **Asker Sayısı & `MAX` Butonu:**
  - Üretilecek asker sayısı girişi + hemen yanında **`MAX`** butonu → eldeki maksimum Manpower (`Math.floor(manpower)`) kadar asker sayısını yazar.
- **2 Sütunlu İkonlu Ekipman Seçimi (İsimsiz, Hover Tooltip'li, Ayırıcı Çizgili):**
  - **Sol sütun: Silahlar** (`Kılıç → Mızrak → Pistol → AK → Bazuka`), **Sağ sütun: Kalkanlar** (`Tahta → Bronz → Çelik → Elmas → Force Field`) — değerine (Tier 1 → 5) göre üst üste dizili; her nesne arasında yatay ayırıcı çizgi bulunur.
  - **İsimler Yazmaz:** Yalnızca piksel ikonlar görünür; farenin ucu ikonun **üstüne gelince** adı ve statı tooltip olarak çıkar *(ör. `Kılıç — Hasar: 10`, `Force Field Kalkan — Koruma: 42`)*.
  - Her ikonun yanında: **eldeki ortak stok (`Stok: X`)**, **kullanılacak adet girişi** ve hızlı **`+1` / `+5` / `+10` / `MAX`** mini butonları.
- **Kıt Kaynak Sınırı & Kalkan Opsiyonelliği (AI'lar Dahil):**
  - `effW[w] = min(girilenW[w], weaponsStock[w])`, `effS[s] = min(girilenS[s], shieldsStock[s])`.
  - `actualSoldiers = min(istenenAsker, Math.floor(manpower), Σ effW)`.
  - **Kalkan opsiyoneldir:** Seçilen kalkanlar (`min(actualSoldiers, Σ effS)`) en güçlü silahlardan başlayarak askerlere verilir; kalkan yetmeyen kalan askerler kalkansız üretilir. Fazla girilen stoklar harcanmaz.
  - Yapay zekâ ülkeler de doğrudan aynı ortak fonksiyonu (`queueBarracksTrainingBatch`) kullanır ve kendi Kışla konumlarından asker çıkarır.
- **Harita Üstü Eğitim Geri Bildirimi & Yıkım:**
  - Eğitim başlayıp oyun akarken haritada **o Kışlanın üzerinde** canlı eğitim ilerleme çubuğu görünür; asker çıktığında **`+X Asker`** yüzen efekti oynar. Popup'ta kırmızı **`🗑️ Binayı Yık`** butonu bulunur.

---

## 8. İkonlu Paralel Fabrika Popup'ı (Bina-Bazlı Bağımsız Hatlar, `2–15 sn`, Toplam Maliyet & Ayrı Loading Bar'lar)

### Tasarım Detayları
- Haritada **hangi Fabrika binasına** tıklanırsa o Fabrikanın kendi bağımsız üretim popup'ı açılır ve oyun durur (başlıkta Fabrika piksel ikonu + bölge adı).
- **Bina-Bazlı Bağımsız Paralel Üretim:**
  - Her Fabrika kendi tür-bazlı paralel üretim hatlarına (`building.parallelProduction`) sahiptir; üretilen tüm silah ve kalkanlar ülkenin ortak ekipman stoğuna girer.
  - Birden fazla Fabrika kurmak aynı anda daha fazla paralel üretim kapasitesi sağlar!
- **İkonlu 2 Sütun (Silahlar | Kalkanlar — Değerine Göre Üst Üste, Ayırıcı Çizgili):**
  - Yalnızca piksel ikonlar görünür (hover'da isim + stat + birim maliyet + birim üretim süresi) ve her nesne satırı arasında belirgin ayırıcı çizgi yer alır.
  - Açılmış her türün yanında **üretilecek adet girişi** + hızlı **`+1` / `+5` / `+10` / `MAX`** mini butonları *(bakiyenin yettiği maksimum adet)*.
  - En altta seçilen tüm silah ve kalkanların **canlı toplam maliyeti (`Toplam Maliyet: X 💰`)** yazar; onaylanınca bakiye kesilir.
- **Yeni Kademeli Üretim Süreleri (`2 sn` → `15 sn` / adet):**
  - **Tier 1** (`Kılıç / Tahta`): **`2 sn`** | **Tier 2** (`Mızrak / Bronz`): **`4 sn`** | **Tier 3** (`Pistol / Çelik`): **`7 sn`** | **Tier 4** (`AK / Elmas`): **`11 sn`** | **Tier 5** (`Bazuka / Force Field`): **`15 sn`**.
- **Kapanmayan Popup'ta Tür Bazlı Ayrı Loading Bar'lar:**
  - **`⚙️ Üretimi Başlat`** tıklandığında popup hemen kapanmaz; yeni siparişler eklenebilir ve o Fabrikada üretimde olan **her tür aletin kendi satırında ayrı ayrı canlı loading bar** + kalan adet görünür (`✕` ile kapatınca oyun akmaya devam eder). Kırmızı **`🗑️ Binayı Yık`** butonu da bulunur.

---

## 9. 2 Sayfalı Diplomasi, Taktiksel Savaş (Geri Çekilme / Takviye / Vatan Savunması) & Deniz Kuralları

### 2 Sayfalı İlişkideki Ülkeler (Diplomasi) Popup'ı
- **Sayfa 1 — Ülkeler Listesi:** Haritadaki tüm aktif ülkeler **2–3 sütunlu tıklanabilir kartlar / ayırıcı çizgili öğeler** halinde görünür (ülke rengi piksel bayrağı/ikonu, isim, anlık ilişki rozeti `⚪ Nötr / 🟢 İttifak / 🔴 Savaşta`, bölge sayısı).
- **Sayfa 2 — Ülke İlişki Sayfası (Aynı Popup İçinde Ayrı Sayfa):**
  - Sayfa 1'de herhangi bir ülkeye tıklayınca popup içeriği o ülkenin ilişki sayfasına geçer; üstte **`← Ülkelere Dön`** butonu ve ülkenin piksel bayrak ikonu yer alır.
  - Gösterilenler: görsel **ilişki puan çubuğu (`-100..+100`)**, o ülkenin müttefikleri ve savaşta olduğu ülkeler, aktif anlaşmalar (Saldırmazlık / Ticaret) ve şu **7 diplomatik aksiyon**:
    1. **`⚔️ Savaş İlan Et`** *(aktif Saldırmazlık Paktı yoksa)*
    2. **`🤝 İttifak Teklif Et`** *(nötr ülkelerle)*
    3. **`💥 İttifakı Boz`** *(mevcut müttefikten ağır ilişki cezasıyla ayrılma)*
    4. **`🕊️ Barış Teklif Et`** *(savaştaki ülkelerle)*
    5. **`🎁 İlişki Geliştir (-150 💰 → +25 İlişki)`** *(kısa soğuma süresiyle)*
    6. **`🛡️ Saldırmazlık Paktı (1 Yıl / 365 Gün)`** *(iki taraf arası 1 yıl savaş ilanı engeli)*
    7. **`💰 Ticaret Anlaşması`** *(savaşta olmayan ülkelerle; kabul edilince iki tarafa da `5 sn`'de **`+%10` ek gelir** sağlar, savaş ilanında otomatik iptal olur)*

### Taktiksel Savaş, Ordu Bölme & Deniz Kuralları
- **Biyomlar Sadece Görsel:** Haritadaki arazi türleri (`grass`, `forest`, `mountain`, `desert`) sadece görseldir; savaş matematiği ve yürüyüş hızı saf ve öngörülebilir biçimde asker sayısı + silah/kalkan statlarına bağlıdır.
- **Vatan Savunması (`+%10` Savunma Bonusu):** Kendi toprağımızda savaşan birliklerimiz **`+%10`** ek savunma bonusu kazanır.
- **Çatışmaya Takviye (Çoklu Ordu Çarpışması):** Devam eden bir çatışmaya başka bir dost ordumuzu gönderince takviye olarak çatışmaya katılır ve düşmana karşı birleşik kuvvetle (kuşatma / sayı üstünlüğüyle) savaşır.
- **Çatışma Sırasında `🏃 Geri Çekil`:** Çatışmadaki dost ordunun popup'ında **`🏃 Geri Çekil`** butonu bulunur; basılınca küçük bir geri çekilme kayıp cezasıyla (`%10` kayıp) çatışmadan çıkıp en yakın dost bölgeye çekilir.
- **Ordu Popup'ı Bölme (Split):** Mevcut ikon bazlı adet girerek bölmenin yanında tek tıkla **`✂️ Yarıya Böl (50/50)`** hızlı butonu yer alır.
- **Taşıma Gemileri (Sade Taşımacılık):** Gemiler yalnızca deniz üzerinden asker taşır; deniz çatışması yoktur.

---

## 10. İnteraktif Spotlight Tutorial (`20 px` Açık Yuvarlak, Banka Borç Dahil 11 Adım & Kontrollü Rakip)

### Başlatma & Ortam Kuralları
- **Tetikleme:**
  - Ana Ekrandan **`📖 Tutorial`** veya **`▶ Oyna → Evet, Tutorial'ı Aç`** seçildiğinde Dünya Haritası (**"Tutorial için bir ülke seçin"** üst bandıyla) açılır; oyuncu bir ülkeye tıkladığında Spotlight Tutorial doğrudan o ülkede başlar.
  - Oyun başladıktan sonra üst bardaki **`📖`** (`H`) butonuna tıklandığında kısa **Hızlı Rehber & Kısayol Özeti** penceresi + içinde **`↺ Tutorial'ı Yeniden Başlat`** seçeneği sunulur.
- **Ortam & Tempo:**
  - Tutorial süresince diğer AI ülkeler tamamen pasiftir; yalnızca **dibimizdeki 1 komşu ülke** savunma/saldırı pratiği için **yenebileceğimiz kapasitede 1 öncü birlik** üretir.
  - Oyuncu gereksiz bekletilmeden aksın diye Tutorial boyunca **bina inşası ve Fabrika/Kışla üretimi `3×` hızlandırılır** *(bütçe akışı Adım 2B'deki Banka `+500 💰` kredisi + Adım 8'deki `+1.000 💰` fetih ödülüyle doğal biçimde karşılanır)*.

### Spotlight, Bekleme, Kamera & Hata Kurtarma Kuralları
1. **Spotlight & Popup (`20 px` Yarıçaplı Açıklık):**
   - Her popup çıktığında **oyun otomatik durur** (`'tutorial_spotlight'`), ekran hafif grileşir (`rgba(15, 23, 42, 0.58)`).
   - Tıklanacak hedef butonun merkezinde **`20 px` yarıçaplı (`40 px` çaplı) grileşmeyen yuvarlak açıklık + hafif nabız atan sarı halka** gösterilir; açıklama popup'ı hedefin hemen üstünde/yanında (ekrandan taşmadan) açılır.
2. **Harita Adımlarında Esnek Seçim:**
   - Haritada bina yerleştirme veya ordu yönlendirme adımlarında önerilen boş bölgenin/hedefin merkezinde `20 px` açık yuvarlak + sarı halka gösterilir; ancak oyuncu isterse kendi ülkesindeki **herhangi bir geçerli noktaya** da tıklayabilir *(geçersiz noktada kısa uyarı çıkar)*.
3. **Kısa Bekleme Anları (Canlı Görev Rozeti):**
   - Bina inşası, Fabrika ekipman üretimi, ordu yürüyüşü, çatışma veya yaralı dönüşü beklenirken gri maske kalkar, oyun otomatik akar ve üstte canlı görev rozeti görünür *(ör. **`⏳ Görev: Silah & kalkan üretimi — 4/10`**)*. Şart tamamlandığı an oyun tekrar otomatik durur ve sıradaki spotlight popup'ı açılır.
4. **Hata Kurtarma & Yanlış Tıklama Geri Bildirimi:**
   - Tutorial adımı tamamlanmadan ilgili popup'ın kapatma (`✕`) butonu devre dışıdır *(yalnızca köşedeki **`Tutorial'ı Geç`** her an aktiftir)*.
   - Oyuncu gri alana veya yanlış bir yere tıklarsa hedef **`20 px` yuvarlak 2 kez kırmızı-sarı yanıp sönerek** dikkati doğru hedefe çeker.
5. **Otomatik Yumuşak Kamera Odaklanması:**
   - Harita nesnesine tıklama veya olay izleme (bina, savaş, yaralı dönüşü) adımlarında kamera otomatik yumuşak kayarak (`focusOnPoint`) hedefi ekranın ortasına alır; böylece `20 px` spotlight asla ekran dışında kalmaz.

### 11 Adımlı Uygulamalı Akış
1. **Adım 1 — Kısa Amaç:** *"Oyunda amacımız toprak yönetimi, gelişme, ekonomi, insan yönetimi (Manpower) ve toprak ele geçirme. **1 Ocak 2010** tarihinin sonunda en çok statlara sahip ülke kazanır."* → **`▶ Devam`** (`20 px` spotlight).
2. **Adım 2A — İlk Bina (`🏪 Mağaza` → Banka `100 💰`):** Alt bardaki **`🏪 Mağaza`** (`20 px` spotlight) → *"Cebimizde **100 para** var, Mağaza'dan ilk Bankamızı alıp yerleştirelim."* → `Banka (100💰)` seç → haritada kendi toprağımıza yerleştir (inşa `3×` hızda bitene kadar canlı görev rozeti).
3. **Adım 2B — Bankadan İlk Borç (`+500 💰`):** Kamera yeni Bankaya odaklanır; Banka'ya tıkla (`20 px` spotlight) → Banka popup'ında **`+500 💰 Borç Al`** butonuna bas (böylece Fabrika, Kışla, ekipman ve Hastane için doğal sermaye oluşur).
4. **Adım 3 — Fabrika Kurma & Silah/Kalkan Üretimi:** Mağaza'dan Fabrika satın al & yerleştir → haritadaki Fabrikaya tıkla → ikonlu Fabrika popup'ında silah & kalkan siparişi ver (`+1/+5/+10` butonlarıyla), paralel loading bar'ları gör, üretim bitimini canlı görev rozetinden izle.
5. **Adım 4 — Kışla Kurma, Asker Yetiştirme & Ekipman Verme:** Mağaza'dan Kışla satın al & yerleştir → haritadaki Kışlaya tıkla → **`MAX`** / asker sayısı + ikonlu silah ve kalkan adetlerini seçerek ilk ordunu yetiştir (haritada Kışla üstü eğitim barı + `+X Asker` efekti).
6. **Adım 5 — Askerleri Yönlendirme:** Kamera ordumuza odaklanır → orduya tıkla → sınır bölgemize sol tıklayarak ordunu yürüt.
7. **Adım 6 — 2 Parçaya Bölme (Split) & Birleştirme (Merge):**
   - Orduya tıkla → **`✂️ Yarıya Böl (50/50)`** ile 2 ayrı birlik oluştur.
   - Sol tık sürükleyip **kutu seçimiyle** (veya birini diğerinin üstüne tıklayarak) sağ alttaki **`🔗 Birleştir`** butonundan birlikleri tekrar tek ordu yap.
8. **Adım 7 — 2 Sayfalı İlişkideki Ülkeler (Diplomasi) Popup'ı:**
   - `📜 Diplomasi` butonunda `20 px` spotlight → Sayfa 1'de aktif ülkeleri gör → dibimizdeki komşu ülkeye tıkla → Sayfa 2'de ilişki çubuğunu & detayları incele ve **Savaş İlan Et**.
9. **Adım 8 — Alan Savunması & Alana Saldırma:**
   - *Alan Savunması:* Komşu ülkeden yenebileceğimiz kapasitede küçük bir öncü birlik bizim bölgemize yürür → kamera olaya odaklanır, ordumuzu yönlendirip kendi toprağımızı savunuruz. Çatışmada birkaç yaralı asker haritada **`🩹 Yaralı — Hastane Bekliyor`** işaretiyle sahada bekler.
   - *Alana Saldırma:* Ardından ordumuzu komşunun sınır bölgesine gönderip saldırarak bölgeyi ele geçiririz (**`+1.000 💰`** fetih ödülü).
10. **Adım 9 — Hastane İnşası & Kaçan Askerlerin Geri Dönüş Animasyonu:**
    - Sahada bekleyen yaralı askerleri geri çağırmak için oyuncuya Mağaza'dan bir **Hastane** satın aldırıp haritaya kurdurulur.
    - Hastane tamamlandığı an sahada bekleyen **`🩹 Yaralı`** askerler kırmızı haç/koşma animasyonuyla yeni Hastaneye koşar; kamera onları takip eder, Hastane popup'ında iyileşen sayı gösterilir ve iyileşme bitince parlak **`+X İyileşti!`** animasyonuyla eski ekipmanlarıyla orduya geri dönerler.
11. **Adım 10 — Dünyaya Salma (2 Seçenekli Kapanış):**
    - Final popup'ı: *"Artık Pixel World'e hazırsın!"*
    - **`🔄 Sıfırdan Adil Başla`** *(seçilen ülkede temiz 1 Ocak 2000, `1 Üniversite`, `100 💰`, borçsuz, tüm AI'lar 3 gün bekleme ile başlar)*
    - **`▶ Kurduklarımla Devam Et`** *(tutorial'da kurulan binalar ve ordular korunarak tüm AI'lar serbest bırakılır)*

---

## 11. 3 Slotlu Kayıt & Devam Et Sistemi (`Save & Exit` + Ana Ekran `▶ Continue`)

### Tasarım Detayları
- **`🌍 Harita` Butonu → 3 Slotlu Kaydet & Çık Popup'ı:**
  - Oyun içindeki alt menüden **`🌍 Harita`** butonuna tıklandığında harita doğrudan sıfırlanmaz; oyun otomatik durur ve ikonlu, ayırıcı çizgili **Kaydet & Çık** popup'ı açılır.
  - Popup içinde **`Slot 1`**, **`Slot 2`** ve **`Slot 3`** kayıt yuvaları alt alta görünür *(doluysa mevcut kayıtlı **ülke adı** + **oyun tarihi**, boşsa `Boş Slot` yazar; oyuncu istediği slota kaydedebilir veya mevcut slotun üstüne yazabilir)*.
  - Her slotun yanında (veya seçili slot için):
    - **`💾 Kaydet & Ana Ekrana Dön`**
    - **`💾 Kaydet & Dünya Haritasına Geç`**
  - Alt kısımda ayrıca **`🚪 Kaydetmeden Çık`** ve **`✕ İptal (Oyuna Dön)`** butonları bulunur.
- **Ana Ekranda `▶ Continue` Ekranı / Popup'ı (3 Save Dosyası):**
  - Ana Ekranda (`main_menu`) `▶ Oyna` ve `📖 Tutorial` butonlarının yanında **`▶ Continue`** butonu bulunur *(en az 1 dolu kayıt slotu varsa aktif ve vurgulu, hiç kayıt yoksa pasif/`disabled`)*.
  - **`▶ Continue`** tıklandığında **3 Save Dosyalı Continue Popup'ı** açılır; 3 slot aralarında belirgin ayırıcı çizgiyle listelenir:
    - **Dolu Slot:** Ülkenin piksel renk/bayrak ikonu + **Oynanan Ülke Adı** *(ör. `★ Turkey`)* + **Gelinen Oyun Tarihi** *(ör. `14 Mar 2003`)* + **`▶ Devam Et`** butonu + kırmızı **`🗑️ Sil`** butonu.
    - **Boş Slot:** `Slot X — Boş Kayıt`.
  - **`▶ Devam Et`** tıklandığında o slottaki kayıt (`arena`, `countries`, `regions`, `buildings`, `armies`, `ships`, `wounded`, `diplomacy`, `debt`, `parallelProduction`, `simDaysElapsed`, kamera konumu) birebir kaldığı yerden yüklenir.
  - Depolama boyutu (`3` dolu slot) için kayıt verisi hafif/kompakt serileştirilir (sürüm kontrolü: `saveVersion: '1.2'`; bozuk/uyumsuz slot güvenle temizlenir).

---

## 12. Etkilenecek Modüller (Kodlama Haritası)

- **[`src/map/worldLoader.ts`](src/map/worldLoader.ts) & [`src/map/arenaBuilder.ts`](src/map/arenaBuilder.ts):** `≤ 4` bölgeli ada ülkelerini çıkarma, `≤ 4` bölgeli kara/kıyı ülkelerini en uzun sınırlı büyük komşuya birleştirme; ülke dış sınır segmentlerini tespit etme (`countryBorderEdges`).
- **[`src/config/balance.ts`](src/config/balance.ts) & [`src/config/keybindings.ts`](src/config/keybindings.ts):** `TARGET_REGION_AREA = 2.0`, `MAX_REGIONS_PER_COUNTRY = 64`, `LAND_MOVE_SPEED = 0.36`, `START_MONEY = 100`, `INCOME_TICK_SEC = 5`, `REGION_CAPTURE_BONUS = 1000`, `MAX_UNIVERSITIES = 1`, `HOME_DEFENSE_BONUS = 0.10`, `RETREAT_LOSS_RATE = 0.10`, `BUILDINGS.bank.cost = 100`, `LOAN_CONFIG` (`500/1000/10000`, `%15` faiz, `%25` kesinti, `20000` tavan), `combined` kaldırma, Fabrika `prodSec` (`2, 4, 7, 11, 15`), `AI_CONFIG` (`3 / 7` gün), Diplomasi kısayolu `KeyD → KeyP` (`WASD` kamera kaydırma), `openBuildings` etiketi → `Mağaza Penceresi`.
- **[`src/types.ts`](src/types.ts), [`src/state/gameStore.ts`](src/state/gameStore.ts) & `src/state/saveManager.ts` [yeni]:** `BuildingSlot.{trainingQueue, parallelProduction}` (bina-bazlı bağımsız üretim hatları), `Country.{debt, incomeTickAccSec}`, `DiplomacyEdge.{nonAggressionUntilDay, tradeAgreement, lastGiftDay}`, `selectedArmyIds: string[]`, `boxSelectRect`, `activeBuildingRegionId`, `floatingEffects`, `tutorialSpotlight` durum makinesi, `'tutorial_spotlight' | 'building_popup'` `AutoPauseReason`, 3 slotlu `saveToSlot(slotId) / loadFromSlot(slotId) / deleteSlot(slotId) / listSaveSlots()` (`slotId: 1 | 2 | 3`, ülke adı + oyun tarihi metadatası, sürüm kontrollü).
- **[`src/sim/economy.ts`](src/sim/economy.ts), [`src/sim/diplomacy.ts`](src/sim/diplomacy.ts), [`src/sim/army.ts`](src/sim/army.ts) & [`src/sim/ai.ts`](src/sim/ai.ts):** 5 sn toplu gelir (Ticaret Anlaşması `+%10` dahil) + borç taksiti, fetihte düşman binasını yıkma + `+1000 💰` ganimet, `MAX_UNIVERSITIES = 1` kuralı, `takeBankLoan / repayBankLoan / demolishBuilding` (`%50` iade), bina-bazlı paralel Fabrika & Kışla konum doğuşu (`queueBarracksTrainingBatch` ortak `min` formülü), 4 yeni diplomasi aksiyonu (`sendGift`, `proposeNonAggression`, `breakAlliance`, `proposeTradeAgreement`), `retreatFromCombat`, takviye çoklu ordu çatışması, `+%10` Vatan Savunması, çoklu ordu seçme / yürüyerek birleştirme, `splitArmyHalf`, AI 3/7 gün gecikmesi & ekipman-öncelikli üretim.
- **[`src/art/pixelSprites.ts`](src/art/pixelSprites.ts), [`src/render/mapRenderer.ts`](src/render/mapRenderer.ts) & [`src/main.ts`](src/main.ts):** `getBuildingSpriteDataUri` (tüm popuplar için bina piksel ikonu), tüm harita nesneleri (bina/asker/gemi/ağaç/dağ) için ~%30 daha küçük world-space ölçek (`computeWorldSpritePixelStep = cameraScale / 26`), `3.5–4 px` kalın ülke dış sınırları, sol-tık box-select çerçevesi + sağ/orta-tık & `WASD` pan, evrensel highlight, kendi boş bölgesinde hızlı inşa menüsü, kendi binasına tıklayınca o binaya özel işlem popup'ı, Kışla üstü eğitim barı + `+X` yüzen efektler + yaralı kaçış/geri dönüş animasyonu.
- **[`src/ui/windows.ts`](src/ui/windows.ts) & [`src/style.css`](src/style.css):** Ana Ekranda **`▶ Continue`** + 3 slotlu Continue popup'ı (ülke adı & tarih + Sil), sade 3 butonlu alt dock (**`🏪 Mağaza`**, **`📜 Diplomasi`**, **`🌍 Harita`**), **tüm popuplarda piksel ikon + nesneler arası ayırıcı çizgi standardı**, 3 slotlu Kaydet & Çık popup'ı, 5 sn altın barlı üst HUD + sol üst şeffaf Canlı İşlem Şeridi, sağ alt çoklu ordu birleştirme paneli, Mağaza / Banka / Hastane / İkonlu Kışla / Paralel Fabrika / 2 Sayfalı 7-aksiyonlu Diplomasi / Çatışma Geri Çekilme popupları + kırmızı `🗑️ Binayı Yık` onaylı butonu, `20 px` yarıçaplı nabızlı SVG maskeli 11 adımlı Spotlight Tutorial motoru.
- **Testler:** Mevcut faz/v1.1 testlerinin v1.2 kurallarına güncellenmesi + v1.2 birim/entegrasyon testleri (bina-bazlı Kışla/Fabrika, fetihte bina yıkımı + `+1000 💰`, geri çekilme/takviye/vatan savunması, 7 diplomasi aksiyonu, 3 slotlu `saveManager`) ve gerçek Chrome uçtan uca görsel doğrulaması.
