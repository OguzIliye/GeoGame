# GeoGame — Tasarım Not Defteri

> Bu dosya oyunun tasarım aşamasındaki kararları, fikirleri ve açık soruları toplamak için kullanılan canlı not defteridir.

## 1. Temel Konsept (Kesinleşenler)
- **Platform:** Web tabanlı oyun (tarayıcıda çalışacak).
- **Tür & İlham:** **EU4 (Europa Universalis IV) tarzı** harita üstünden oynanan strateji oyunu, ancak **çok daha sade / erişilebilir** mekaniklerle.
- **Harita Başlangıcı:** Oyunun başında elimizde yalnızca **düz statik asset olarak ana dünya ülke poligonları** olacak (hazır eyalet/alt-bölge verisi kullanılmayacak).
- **Bölgesel Oyun Alanı (Local Theater):** Oyuncu dünya haritasından bir ülke seçtiğinde kamera o ülke ve etrafına zoomlar; oyun yalnızca **seçilen ülke + etrafındaki en fazla 15 ülke** (toplam maks. 16 aktif ülke) ile sınırlı kalır.
- **Dinamik Poligon & Alan Ele Geçirme:** Aktif oyun alanındaki ülke poligonları oyun içinde **değiştirilebilir** olacak; ilerleme toprak/alan ele geçirme mantığıyla gerçekleşecek.
- **Otonom Ülkeler:** Yalnızca aktif oyun alanındaki diğer ülkeler (maks. 15 ülke) kendi kendine oynayabilecek algoritmalara (AI) sahip olacak.

---

## 2. Oyun Başlangıç Akışı & Oyun Alanı *(Kesinleşti)*
1. **Ülke Seçim Ekranı:** Tüm dünya haritası statik asset olarak ekrana gelir. Oyuncu harita üzerinden bir ülkeye **tıklayarak** ülkesini seçer.
2. **Bölge Oluşturma, Arena Çerçevesi & Zoom:**
   - Seçilen ülkenin etrafında sabit boyutlu bir **Oyun Alanı Çerçevesi (Arena Bounding Box)** açılır ve kamera bu alana odaklanır/zoomlar.
   - Çerçevenin içine giren ülkeler aktif oyun setine alınır (**üst sınır en fazla 15 AI ülke** — Avrupa gibi yoğun bölgeler için tavan; büyük ülkelerin olduğu yerlerde doğal olarak daha az ülke yer alır).
   - **Dev Ülke Kırpma Kuralı:** Rusya, Çin, ABD gibi çerçevenin dışına taşan büyük ülkelerin yalnızca **oyun alanı çerçevesine giren aktif kısmı/kıyısı** oyuna dahil edilir, dışarıda kalan kısım kırpılır.
3. **İzolasyon & Optimizasyon:**
   - Kalan ~180 ülkeye **hiçbir AI/algoritma atanmaz**.
   - Aktif bölge dışındaki poligonlar oyun başladıktan sonra **arka planda renderlanmaz** (bellek ve çizim yükünden tamamen düşürülür; dış sınır sade okyanus/koyu çerçeve ile biter).

---

## 3. Oyun Türü ve Temel Döngü *(Kesinleşti)*
- **Referans:** Basitleştirilmiş EU4 (diplomasi, savaş, genişleme, kaynak/ekonomi dengesi — mikro yönetim yükü olmadan).
- **Oyuncu rolü:** Oyuncu başlangıçta tıklayarak seçtiği 1 ülkeyi yönetir; etrafındaki aktif ülkeler (en fazla 15) AI tarafından yönetilir.
- **Zaman Akışı, Takvim & Evrensel Süre Kuralı:**
  - Oyun **gerçek zamanlı** akar (`money/s`, `manpower/s`, oyun içi takvim).
  - **Takvim & Oyun Uzunluğu:** Başlangıç `1 Ocak 2000` -> Bitiş `1 Ocak 2020` (20 oyun yılı). `1x` hızda `1 sn = 10 oyun günü` -> toplam maç süresi **~12 dakika** (`2x`'te ~6 dk, `0.5x`'te ~24 dk).
  - **Zaman Kontrolleri (UI):** Durdurma (`Pause / 0x`), yavaşlatma (`0.5x`), normal (`1x`) ve hızlandırma (`2x`).
  - **Her süreç zaman gerektirir:** Bina inşası, fabrikada ekipman üretimi, kışlada asker yetiştirme, bilim araştırması, ordu yürüyüşü, gemi seyri, bölge ele geçirme, savaş ve hastanede iyileşme anlık değil **süre bazlı** ilerler.
- **Kaybetme Koşulu:** Oyuncunun ülkesinin **tüm topraklarını (tüm alt-poligon bölgelerini)** kaybetmesi.
- **Kazanma Koşulu & Oyun Sonu Skoru:**
  - `1 Ocak 2020` tarihine gelindiğinde hayatta kalan tüm aktif ülkelerin statları karşılaştırılır ve sıralama açıklanır. *(Bitiş tarihinden önce aktif bölgedeki tüm toprakları ele geçiren ülke erken zafer kazanır.)*
  - **Başlangıç Skor Formülü *(Ayarlanabilir)*:**
    `Skor = (Bölge Sayısı × 100) + (Toplam Asker Gücü × 1) + (Bina Sayısı × 50) + (Açık Teknoloji Kademesi × 80) + (Para × 0.1)`
    *(Oyun sonu tablosunda Toprak, Ekonomi, Ordu ve Teknoloji sütunları ayrı ayrı da gösterilir.)*

---

## 4. Harita ve Değiştirilebilir Poligon Yapısı *(Kesinleşti)*
- **Başlangıç verisi:** Düz statik asset olarak ana dünya ülke poligonları (GeoJSON / TopoJSON).
- **Aktif çalışma seti:** Yalnızca 1 oyuncu + maks. 15 AI = **en fazla 16 aktif ülke** (arena çerçevesine kırpılmış).
- **Seçilen Yöntem — Eşit Alanlı Rastgele Alt-Poligon Bölme (Equal-Area Procedural Regions):**
  - Oyun başladığında yalnızca aktif ülkeler için, her ülke poligonu **ülke büyüklüğünden bağımsız**, yaklaşık olarak **aynı hedef alana ($A_{\text{hedef}}$)** sahip rastgele (organik) alt-poligonlara bölünür.
  - **Bölge sayısı:** $N = \max(1, \text{round}(A_{\text{ülke}} / A_{\text{hedef}}))$.
  - **Küçük ülkeler (örn. Vatikan, Lüksemburg):** Ülkenin toplam alanı hedef alandan küçükse bölünmez, **tek poligon** olarak kalır.
  - **Büyük ülkeler (örn. Rusya'nın aktif kesiti):** Yüzölçümü oranında **çok sayıda** eşit alanlı bölge poligonuna bölünür.
  - **Alan ele geçirme:** Ordu kümeleri bu alt-poligon bölgelerini süreyle ele geçirir; ele geçirilen alt-poligon saldıran ülkeye geçer ve haritada ülke sınırları dinamik olarak yeniden şekillenir.
  - **Teknik uygulama:** Her ülke içine $N$ nokta dağıtılıp 2–3 iterasyon **Lloyd Relaxation + Voronoi (ülke poligonuna clip edilmiş)** ile organik ve yaklaşık eşit alanlı bölgeler milisaniyeler içinde üretilir.
- **Deniz Bağlantıları:** Denize kıyısı olan ülkeler **Liman** ek binası ile **transportasyon gemisi** kullanır *(detaylar Bölüm 6.6'da)*. Gemi savaşı yoktur, yalnızca asker taşımacılığı yapılır.
- **Harita Çevresi & Biyom Öğeleri:** Harita poligonları düz renk olarak kalmaz; bölgenin enlem/konum/yapısına göre mid-resolution pixel art **ağaç, dağ, çimen, çöl** ve varsa **deniz** görselleriyle zenginleştirilir.
- **Render yaklaşımı:** HTML5 Canvas 2D (`imageSmoothingEnabled = false` ile net pixel art).

---

## 5. Mekanikler: Kaynaklar, Binalar & Teknoloji Ağacı *(Başlangıç Denge Değerleri — Değiştirilebilir)*

### 5.1 Temel Kaynaklar, Başlangıç & Soft-Lock Koruması
- **Başlangıç Değerleri:** Her ülke `300 Para`, `50 Manpower` ve `%50 Sağlık Oranı` ile başlar.
- **Binasız Taban Akış (Soft-Lock Önleme):** Bütün binalar yıkılsa bile kilitlenmemek için her ülkenin sabit taban geliri vardır: `+5 money/s` ve `+1 manpower/s`.
- **Başlangıç Binaları:** Normal ülkeler hazır **1 Banka + 1 Kışla** ile; küçük ülkeler hazır **1 Birleşik Bina** ile başlar.
- **Para (`Money` & `money/s`):** Doğrudan **Banka**'ya bağlıdır (`+12 money/s` / Banka).
- **İnsan Gücü (`Manpower` & `manpower/s`):** Ülkenin **sağlık oranına**, sağlık oranı da **Hastane oranına** bağlıdır. (Temel `%50` sağlık; her Hastane sağlık oranını `+15%` — maks. `%100` — ve manpower üretimini `+2 manpower/s` artırır.)
- **Ekipman Stoğu:** Fabrikada üretim emriyle biriken silahlar ve kalkanlar.

### 5.2 Satın Alma Ekranı & Binalar (5 Temel + 1 Kıyı Ek Binası)
| # | Bina | Maliyet & Süre (`1x`) | Temel Görevi | Notlar |
|---|------|-----------------------|--------------|--------|
| 1 | **Kışla** | `160 para`, `6 sn` | Asker yetiştirme | `1 Manpower + 1 Silah (+ opsiyonel 1 Kalkan)` -> `0.4 sn / asker`. Ek kışla eğitimi hızlandırır. |
| 2 | **Hastane** | `150 para`, `6 sn` | Sağlık oranı & kaçan yaralılar | Sağlık oranı `+15%` (`+2 manpower/s`). Kaçan yaralılar otomatik buraya yürür ve `8 sn`'de iyileşir. |
| 3 | **Banka** | `150 para`, `6 sn` | Para üretimi | `+12 money/s` *(sürekli aktif çalışır animasyon)*. |
| 4 | **Fabrika** | `180 para`, `7 sn` | Ekipman üretimi | Açılmış silah/kalkan üretim emri alır. Ek fabrika üretim hızını artırır. |
| 5 | **Üniversite (Bilim)** | `220 para`, `8 sn` | Gelişim ağacı (Tech Tree) | Silah ve kalkan dallarında araştırma yapar. Ek üniversite araştırma süresini kısaltır. |
| 6 | **Liman *(Kıyı Şartı)*** | `200 para`, `7 sn` | Deniz transportasyonu | Yalnızca kıyı bölgelerinde açılır. Sınırsız kapasiteli taşıma gemisi verir (gemi savaşı yok). |

### 5.3 Bilim Binası — Gelişim Ağacı (2 Ayrı Dal)
Tüm silah ve kalkanların mekanik olarak **tek etkisi sayısal Hasar (Damage) ve Koruma (Defense)** değerleridir.

| Kademe | Silah (Saldırı Dalı) | Araştırma (`Para / Süre`) | Hasar | Fabrika (`Para / Süre`) | Kalkan (Savunma Dalı) | Araştırma (`Para / Süre`) | Koruma | Fabrika (`Para / Süre`) |
|---|---|---|---|---|---|---|---|---|
| **Tier 1** | Kılıç | *Açık* | `10` | `5 / 0.6 sn` | Tahta Kalkan | *Açık* | `4` | `4 / 0.5 sn` |
| **Tier 2** | Mızrak | `200 / 12 sn` | `16` | `8 / 0.8 sn` | Bronz Kalkan | `180 / 12 sn` | `9` | `7 / 0.7 sn` |
| **Tier 3** | Pistol | `400 / 18 sn` | `25` | `12 / 1.0 sn` | Çelik Kalkan | `360 / 18 sn` | `16` | `11 / 0.9 sn` |
| **Tier 4** | AK | `750 / 25 sn` | `40` | `18 / 1.2 sn` | Elmas Kalkan | `700 / 25 sn` | `26` | `17 / 1.2 sn` |
| **Tier 5** | Bazuka | `1200 / 35 sn` | `65` | `28 / 1.6 sn` | Force Field | `1150 / 35 sn` | `42` | `26 / 1.5 sn` |

### 5.4 Bina Yerleşimi & Küçük Ülke Dengelemesi
- **Bölge Başına Bina Limiti:** Normal ülkelerde **her alt-poligon bölgesine en fazla 1 bina** kurulur (harita temiz ve okunaklı kalır).
- **Bölge Düşerse Bina Yıkılır:** Bir bölge düşman tarafından ele geçirildiğinde, o bölgedeki bina **doğrudan yıkılır** (yeniden inşa = para harcama döngüsü).
- **Küçük Ülke Avantajı (`1–4` Bölgeye Sahip Ülkeler — "Tall vs Wide" Dengesi):**
  - **Birleşik Bina:** Alan yetmeyeceği için tüm 5 temel bina (ve kıyıysa Liman) işlevi **tek bir birleşik merkez binada** toplanır. Bu bina 3 kademeye yükseltilebilir (`150 / 250 / 400 para`, `6 sn`).
  - **Bilim Avantajı:** Küçük ülkeler oyuna **Tier 2 (`Mızrak` + `Bronz Kalkan`) açık** olarak 1 tık önde başlar.

---

## 6. Ordu Kümeleri, Kontroller, Savaş & Alan Ele Geçirme *(Kesinleşti — Denge Değerleri Ayarlanabilir)*

### 6.1 Harita Üzerinde Ordu Kümeleri (Army Stacks)
- Askerler harita üzerinde **görünür halde** ve **küme (stack)** biçiminde hareket eder.
- Birlikler `(Silah + Kalkan)` kombinasyonuyla tutulur (kalkansız asker de olabilir).
- Bir ordu kümesine tıklandığında açılan bilgide:
  - Kümedeki **toplam asker sayısı**
  - Yalnızca kümede **sayısı `> 0` olan birlik türleri** ve her birinin ayrı sayısı listelenir (boş kombinasyonlar gösterilmez, ekran kalabalıklaşmaz).

### 6.2 Küme Birleştirme (Merge) & Ayırma (Split)
- **Birleştirme:** Aynı ülkeye ait ayrı kümeler birbirine yaklaştığında tek kümede birleştirilebilir.
- **Ayırma:** Tek bir küme bölünürken **yalnızca kümede mevcut (`> 0`) her birlik türü için ayrı ayırma sayısı** girilir.

### 6.3 Hareket & Kontrol Akışı (UX)
- **Seç & Gönder:**
  1. Hareket ettirilecek ordu kümesine **sol tıklanır** -> **imleç (cursor) değişir** (hedef seçme modu).
  2. Haritada ordunun gideceği hedef bölgeye veya düşman kümesine **sol tıklanır** -> ordu yola çıkar.
- **Hareket Görseli:** Askerler bir yerden bir yere yürürken harita üzerinde **animasyonlu ok işareti** ile hareket yönü/rotası gösterilir.
- **İptal Koşulları:** **Sağ tık** yapıldığında veya **harita dışındaki herhangi bir yere** tıklandığında gönderme emri iptal edilir.

### 6.4 Alan Ele Geçirme (Capture)
- Yalnızca **savaşta olunan** ülkenin bölgeleri ele geçirilebilir (nötr ülkeye yanlışlıkla saldırılmaz; müttefik topraklarından serbest geçilir).
- Bir ordu kümesi düşman bölgesine girdiğinde ele geçirme sayacı başlar:
  - **Ele Geçirme Süresi Formülü:** `max(4 sn, 12 sn - 1.5 × log2(AskerSayısı))` *(1 asker ≈ 12 sn, 10 asker ≈ 7 sn, 40+ asker = 4 sn)*.
- Süre dolduğunda o bölge **saldıran ülkenin topraklarına katılır** (ülke sınırları güncellenir) ve **bölgedeki bina yıkılır**.
- Ele geçirme sırasında düşman ordusu o bölgeye gelirse ele geçirme duraklayıp savaş başlar.
- Aynı kurallar **AI ülkeler** için de birebir geçerlidir.

### 6.5 Savaş Mekaniği (Ordu vs Ordu) & Kaçış/Hastane Döngüsü
- Savaşta olan iki ülkenin ordu kümeleri temas ettiğinde **çatışma başlar** ve `0.5 sn` aralıklarla (zaman içinde) ilerler.
- **Hasar & Kayıp Formülü *(Başlangıç Denge)*:**
  - Sayı Çoğunluğu Çarpanı: `min(2.0, (N_biz / N_rakip)^0.35)`
  - Etkin Saldırı Gücü: `N_biz × OrtalamaHasar × SayıÇarpanı`
  - Rakibin Birim Dayanıklılığı: `30 + OrtalamaKoruma × 2`
  - Tick başına kayıp orantılı olarak iki taraftan düşülür; taraflardan biri sıfırlanınca savaş biter.
- **Savaştan Kaçış & Hastane:**
  - Çatışmada düşen askerlerin **`%30`'u** (eğer ülkenin ayakta **Hastane**'si veya Birleşik Binası varsa) "yaralı/kaçan" olarak otomatik en yakın Hastane bölgesine yürür.
  - Hastaneye varınca `8 sn` iyileşme süresi sonunda **eski birlik / ekipman türleriyle** doğrudan savaşa hazır ordu olarak devam ederler.
  - Ülkenin hiç hastanesi yoksa (veya hepsi yıkıldıysa) kaçan askerler kurtarılamaz.

### 6.6 Deniz Taşımacılığı (Liman & Transportasyon Gemisi)
- **Kıyı Koşulu:** Denize kıyısı olan ülkeler (kıyı bölgelerinde) **Liman** ek binası inşa edebilir.
- **Sadece Transportasyon (Gemi Savaşı Yok):** Denizde gemi savaşı yoktur; gemiler yalnızca askerleri bir kıyıdan başka bir kıyıya taşır.
- **Sınırsız Kapasite:** Taşıma gemisinin asker kapasitesi **sınırsızdır** (küme boyutu limiti yok).
- **Süre & Görünür Seyir:** Gemi deniz üzerinden hedef kıyıya **zaman alarak** (`kara hızının ~1.3x`'i) gider ve haritada canlı görünür.
- **Çıkartma (Landing):** Gemi hedef kıyıya ulaştığında taşıdığı askerler **karada belirir** (düşman kıyısıysa hemen ele geçirme/çatışma başlar).
- **Geri Binme (Re-embark):** Askerleri tekrar gemiye aktarmak için **önce askere, sonra gemiye tıklanır**.

---

## 7. Diplomasi Sistemi *(Kesinleşti — Değiştirilebilir)*
- **Diplomasi Penceresi (UI):** Aktif oyun alanındaki her bir ülkeyi listeleyen ayrı bir diplomasi penceresi bulunur.
- **Ülke Detay Sayfası:** Listeden bir ülkenin sayfasına girildiğinde:
  - O ülkeyle olan **anlık ilişki durumu** görünür (`Nötr`, `İttifak`, `Savaş` + ilişki puanı).
  - **Diplomatik aksiyonlar:** **Savaş İlanı**, **İttifak Teklifi**, **Barış Teklifi** *(mevcut sınırlarla savaşı bitirme)*.
- **Temel Kurallar:**
  - Yalnızca **savaşta olunan** ülkenin toprağına/ordusuna saldırılabilir (yanlış tıklama koruması).
  - **Müttefik** topraklarından ordular serbest geçebilir; müttefikler birbirine saldıramaz.
- **AI Karşılığı:** AI ülkeler de oyuncuya ve birbirlerine savaş ilanı, ittifak ve barış teklifleri gönderir veya gelen teklifleri güç/kişilik durumuna göre değerlendirir.

---

## 8. Ülke Algoritmaları (AI) *(Karar Verildi — Değiştirilebilir)*
- **Hedef:** Normal bir insan oyuncu gibi hissettiren, basit ve anlaşılır karar mantığı.
- **Kapsam:** Yalnızca aktif oyun alanındaki AI ülkeler (yoğun küçük ülke bölgelerinde üst sınır 15; büyük ülkelerin olduğu bölgelerde doğal olarak daha az).
- **4 Katmanlı "İnsan Gibi AI" Yapısı:**
  1. **İnsan Tepki Hızı (Decision Interval):** AI her karede kusursuz hamle yapmaz; her `2–4 saniyede` bir durum değerlendirir (insan tıklama temposu + çok düşük CPU yükü).
  2. **Kişilik Profilleri (Rastgele Dağıtım):** Her ülkeye oyun başında basit bir ağırlık profili verilir:
     - *Saldırgan:* Erken kışla/fabrika basar, zayıf komşuya hızlı savaş açar.
     - *Ekonomist / Teknolojici:* Önce Banka + Üniversite kasar, üst silah açıp sonra genişler.
     - *Fırsatçı:* Başka biriyle savaşta yorulmuş komşuyu görünce arkadan dalar.
     - *Savunmacı / Diplomat:* Önce güçlü komşuyla ittifak arar, saldırı gelirse savunur.
  3. **Basit İhtiyaç Önceliği (Ekonomi & Üretim):** Para/sağlık/ekipman/asker/liman eksiğine göre sıradaki binayı, araştırmayı veya üretimi seçer (oyuncuyla tamamen aynı kurallar ve sürelerle).
  4. **Ordu & Diplomasi Sağduyusu:**
     - Kendinden belirgin şekilde güçlü komşuya durduk yere savaş açmaz (hatta ittifak teklif eder).
     - Orduları tek/iki güçlü kümede toplar; savaşta önce düşmanın **bina bulunan** veya sınırındaki bölgelerini hedefler (gerekirse kıyıysa Liman/gemi kullanır); ağır dezavantaja düşerse geri çekilip savunmaya geçer.

---

## 9. Görsel Stil, Pixel Art, Animasyonlar & Arayüz (UI/UX) *(Büyük Ölçüde Belirlendi)*
- **Sanat Tarzı:** **Mid-resolution pixel art** (keskin pikseller, net okunaklı strateji haritası).
- **Akış:** Açılışta tam dünya haritası (ülke seçimi) -> seçim sonrası bölgesel oyun haritasına yumuşak zoom geçişi -> bitiş tarihinde/yenilgide oyun sonu stat karşılaştırma ekranı.
- **Harita Çevre & Biyom Öğeleri (Pixel Art):**
  - Harita üzerinde **ağaç, dağ, çimen, çöl** ve varsa **deniz** detayları bulunacak (ülke/bölge görselini zenginleştiren canlı çevre).
- **Animasyon Gereksinimleri:**
  - **Askerler (Maks. Seviye Gösterim Kuralı):**
    - Bir ordu kümesi haritada çizilirken tüm kombinasyonlar yerine, **kümenin içinde yaşayan en yüksek seviyeli silah + en yüksek seviyeli kalkan** görseli ve animasyonu gösterilir.
    - Örnek: Kümede 1 tane bile **Bazuka (füze)** kullanan asker varsa çatışmada füze animasyonu oynar; o askerler bittiğinde otomatik olarak bir sonraki en yüksek seviyeli silahın animasyonuna geçilir. (Aynı kural kalkan görseli için de geçerlidir.)
    - Her seviye için: `Idle` (bekleme), `Yürüme` (hareket) ve `Savaş anı` (çatışma) animasyonları.
  - **Binalar:**
    - `Idle` (boşta) ve `Çalışır` (aktif üretim/eğitim/araştırma) animasyonları.
    - **Sürekli aktif (full çalışan) binalar** (ör. Banka / sürekli çalışan yapılar) yalnızca **`Çalışır`** animasyonuna sahip olur.
  - **Deniz Taşımacılığı:**
    - Transportasyon gemisinin denizde hareket (seyir) animasyonu.
- **Modüler UI Pencereleri (Her sistem için ayrı pencere):**
  - **Üst Bar:** Oyun içi tarih (ve bitiş tarihine kalan süre), Para (`money/s`), Manpower (`manpower/s`), Sağlık oranı, Ordu sayısı, zaman hızı butonları (`Pause / 0.5x / 1x / 2x`), Ayarlar butonu.
  - **Önemli Olay Bildirim Şeridi (Event Toast):** Yalnızca **kritik/önemli olaylarda** çıkar (savaş ilanı, ittifak teklifi/kabulü, bölge kaybı/fethi, bina yıkılması, araştırma tamamlanması vb.). Basit/rutin olaylarda (asker eğitimi bitti, ekipman üretildi vb.) **çıkmaz**.
  - **Ayarlar (Settings) Penceresi:** Arka plan müziği ses seviyesi (kısma/açma slider) ve **susturma (mute)** düğmesi.
  - **Satın Alma / Binalar Penceresi:** Kışla, Hastane, Banka, Fabrika, Üniversite + kıyı ülkelerinde **Liman** (küçük ülkelerde birleşik bina) inşası ve inşa süreleri.
  - **Fabrika Penceresi:** Silah & kalkan üretim emirleri ve üretim kuyruğu/süreleri.
  - **Kışla Penceresi:** Eldeki Manpower + ekipmanlarla asker yetiştirme ve eğitim süreleri.
  - **Bilim (Üniversite) Penceresi:** 2 dallı teknoloji ağacı (Silahlar & Kalkanlar) ve araştırma süreleri.
  - **Diplomasi Penceresi:** Tüm aktif ülkeler listesi -> seçilen ülkenin sayfasında mevcut ilişki durumu + **Savaş İlanı**, **İttifak Teklifi**, **Barış Teklifi** butonları.
  - **Ordu Kümesi Penceresi:** Seçilen kümenin toplam sayısı, yalnızca `> 0` olan birlik türleri ve ayrı sayıları; **Birleştir** (yakın küme varsa) ve **Ayır** (her mevcut tür için ayrı sayı girişi) aksiyonları.
  - **Oyun Sonu (Skor/Stat) Ekranı:** Bitiş tarihinde tüm aktif ülkelerin statlarının karşılaştırıldığı kazanan/sıralama tablosu.
- **Ses & Müzik:**
  - **Arka Plan Müziği:** Eklenecek (pixel-art temasına uygun hafif döngüsel müzik; Ayarlar menüsünden kısılabilir / susturulabilir).
  - **Aksiyon Ses Efektleri (SFX):** Şimdilik kapsam dışı; sonraki aşamaya bırakıldı.
- **Harita Görsel Geri Bildirimleri:**
  - Ordu yürürken **animasyonlu ok işareti** (hareket yönü/rotası).
  - Ordu seçiliyken değişen imleç, bölge ele geçirme ilerleme çubuğu (timer), çatışma göstergesi, denizde ilerleyen transportasyon gemisi.
- **Kontroller & Kısayollar:**
  - Fare: Sınırlı alanda pan & zoom, sol tık seç/gönder (askere tıkla -> gemiye tıkla ile geri binme dahil), sağ tık veya harita dışı tık ile iptal.
  - Zaman hızı: `Pause / 0.5x / 1x / 2x`.
  - Klavye: `Space` = Durdur / Devam Et. *(Web tarayıcılarında tam ekrandan çıkardığı için `Esc` kullanılmayacak; diğer kısayollar daha sonra detaylandırılacak.)*

---

## 10. Teknik Mimari & Geliştirme Yol Haritası *(Uygulama Planı)*

### 10.1 Teknoloji Yığını (Sade & Hızlı)
- **Çekirdek:** `Vite + TypeScript` (sıfır ağır oyun motoru şişkinliği, hızlı geliştirme).
- **Render:** `HTML5 Canvas 2D` (`imageSmoothingEnabled = false` ile net mid-res pixel art) + modüler DOM/CSS pixel-art UI pencereleri.
- **Harita & Poligon İşlemleri:**
  - Statik dünya haritası asset'i (`world-atlas` / Natural Earth 110m/50m TopoJSON -> GeoJSON).
  - `d3-delaunay` (Lloyd Relaxation + Voronoi alt-poligon üretimi).
  - `polygon-clipping` (dev ülkelerin arena çerçevesinden kırpılması + Voronoi hücrelerinin ülke sınırına kırpılması).
- **Müzik:** `Web Audio API` ile sıfır harici bağımlılıklı retro/pixel-art döngüsel müzik + Ayarlar'dan ses/mute kontrolü.
- **Optimizasyon:** Dünya haritası yalnızca seçim ekranında statik çizilir; oyun başlayınca en fazla **16 kırpılmış ülke** bellekte tutulur, kalan ~180 ülke simülasyondan ve renderdan tamamen düşürülür.

### 10.2 5 Fazlı Geliştirme Planı (Önce Oynanabilir İskelet, Sonra Görsel Parlatma)
- **Faz 1 — Harita & Bölge Motoru:** Statik dünya haritası açılış ekranı -> ülke seçimi -> arena çerçevesi + maks. 15 AI + dev ülke kırpma -> eşit alanlı rastgele alt-poligon bölme (Lloyd + Voronoi) -> pan/zoom + kıyı bölgesi tespiti.
- **Faz 2 — Zaman, Ekonomi, Binalar & Teknoloji:** Takvim (`2000–2020`), `Pause / 0.5x / 1x / 2x` + `Space`, taban gelir & kaynak sayaçları, 5+1 bina inşası (bölge başına maks. 1, küçük ülkelerde Birleşik Bina), Fabrika üretim kuyruğu, 2 dallı Bilim Ağacı, Kışla asker eğitimi.
- **Faz 3 — Ordu Kümeleri, Savaş, Hastane & Liman:** Haritada ordu kümeleri, sol tık -> değişen imleç -> hedef + sağ tık/harita dışı iptal, animasyonlu hareket oku, birleştirme + tür bazlı ayırma, süreyle bölge ele geçirme + bina yıkımı, çatışma formülü + `%30` kaçış/hastane iyileşme, Liman + sınırsız transportasyon gemisi.
- **Faz 4 — Diplomasi, İnsan Gibi AI & Oyun Sonu:** Diplomasi penceresi (Savaş/İttifak/Barış + yanlış saldırı koruması), 4 katmanlı AI (2–4 sn karar, 4 kişilik, ihtiyaç önceliği, savaş/diplomasi), önemli olay bildirim şeridi, yenilgi & `2020` stat karşılaştırma ekranı.
- **Faz 5 — Mid-Res Pixel Art, Animasyonlar, Çevre & Müzik:** Tüm mid-res pixel-art sprite sheet'ler (maks. silah + maks. kalkan kuralıyla asker `idle/yürüme/savaş`, bina `idle/çalışır`, gemi seyir, ağaç/dağ/çimen/çöl/deniz biyomları) + Web Audio arka plan müziği + Ayarlar (ses/mute).

---

## 11. Fikirler & Karar Günlüğü
- **Başlangıç:** Poligon tabanlı dünya haritası + kendi kendine oynayabilen ülke algoritmaları ile web oyunu tasarımına başlandı.
- **Tür & Harita Kararı:** Basitleştirilmiş EU4 tarzı strateji oyunu. Oyunun başında yalnızca ana dünya ülke poligonları bulunacak; harita poligonları alan ele geçirme mantığıyla oyun içinde dinamik olarak değişecek.
- **Bölgesel Arena & Optimizasyon Kararı:** Başlangıçta düz statik dünya haritasından tıklayarak ülke seçilecek; kamera seçilen ülke ve etrafındaki maks. 15 ülkeye zoomlayacak. Kalan dünyaya AI atanmayacak ve oyun içinde renderlanmayacak.
- **Bina Sistemi (Taslak):** Satın alma ekranı eklendi. 5 temel bina belirlendi: Kışla, Hastane, Banka, Fabrika, Üniversite (Bilim Binası).
- **Kaynaklar & Teknoloji Ağacı:** Gerçek zamanlı akış (`money/s` Banka'ya, `manpower/s` Sağlık/Hastane oranına bağlı). Fabrika silah/kalkan üretir, Kışla eldeki kaynaklarla asker çıkarır. Bilim Binası 2 dallı 5 kademeli ağaç verir — Silahlar (`Kılıç -> Mızrak -> Pistol -> AK -> Bazuka`, hasar) ve Kalkanlar (`Tahta -> Bronz -> Çelik -> Elmas -> Force Field`, koruma). Tüm detaylar değiştirilebilir.
- **Ordu, Savaş & Kontroller:** Askerler haritada görünür kümeler halinde gezer; tıklayınca toplam sayı + tür bazlı dağılım görünür. Yaklaşınca birleştirme, tür bazlı sayı girerek ayırma var. Kontrol: orduya sol tık -> imleç değişir -> hedefe sol tık; sağ tık veya harita dışına tık iptal eder. Bölgeye gönderilen ordu süre sonunda orayı ele geçirir; düşman ordusuna gönderince hasar + koruma + sayı çoğunluğuna göre zaman içinde savaşılır (AI için de aynı).
- **Bölge Bölme & Hastane Kararı:** Aktif ülkeler büyüklükten bağımsız yaklaşık eşit alana sahip rastgele alt-poligonlara bölünecek (Vatikan gibi küçük ülkeler tek poligon kalır, Rusya gibi büyükler çok sayıda parçaya ayrılır). Savaşlardan kaçmayı başaran askerler otomatik olarak hastanelere gidecek.
- **Bina Yerleşimi & Küçük Ülke Dengesi:** Binalar alt-poligon bölgelerine kurulacak ve bölge düşerse bina da düşecek. Yeterli alanı olmayan küçük ülkeler tüm işlevleri tek bir birleşik binada toplayabilecek ve denge için bilimde 1 tık önde (ör. erken mızrak / demir-bronz kalkan) başlayabilecek.
- **Zaman, Diplomasi UI, Hareket Oku & Oyun Sonu:** Her süreç (üretim, inşa, araştırma, yürüyüş, ele geçirme, savaş) zaman alacak. Asker hareketinde haritada animasyonlu ok işareti olacak. Her sistem için ayrı UI penceresi bulunacak; Diplomasi penceresinden tüm ülkeler, mevcut ilişki ve savaş/ittifak teklifleri yönetilecek. Kaybetme = tüm toprakları kaybetmek; Kazanma = belirli bir bitiş tarihinden sonra tüm ülkelerin statlarının karşılaştırılması.
- **Mid-Res Pixel Art, Animasyonlar & Liman Transportasyonu:** Oyun mid-resolution pixel art olacak; çevrede ağaç, dağ, çimen, çöl ve deniz bulunacak. Asker tipleri için idle/yürüme/savaş, binalar için idle/çalışır (sürekli çalışan binalarda sadece çalışır) animasyonları olacak. Kıyı ülkeleri için 6. ek bina **Liman** eklendi: gemi savaşı yok, sınırsız kapasiteli düz transportasyon gemisi süreyle denizden gider, hedef kıyıya varınca askerler karada belirir; geri binmek için önce askere sonra gemiye tıklanır.
- **Müzik, Ayarlar & Zaman Hızı:** Arka plan müziği eklenecek (aksiyon ses efektleri sonraya bırakıldı). UI'da müzik sesi kısma ve susturma içeren Ayarlar menüsü olacak. Zaman hızı kontrolleri `Pause / 0.5x / 1x / 2x` olarak netleşti.
- **Animasyon Kuralı, Yıkım, Bildirim & Kısayollar:** Ordu kümesinde yaşayan **maks. silah + maks. kalkan** animasyonu gösterilecek (üst seviye askerler bitince bir alt seviyeye düşer). Bölge düşünce içindeki bina **yıkılacak** (para harcama döngüsü). Sadece **önemli olaylar** için bildirim şeridi olacak (rutin olaylarda çıkmayacak). `Space` = Pause/Resume; web tam ekran çakışması nedeniyle `Esc` kullanılmayacak, diğer kısayollar sonra belirlenecek.
- **Hastane İyileşme & AI Mantığı Onayı:** Hastanede iyileşen askerler eski birlik/ekipman türleriyle doğrudan devam eder. 15 AI sınırı yoğun küçük ülke bölgeleri için tavan değerdir (büyük ülkelerde daha az ülke olur). 4 katmanlı "insan gibi AI" yapısı (2–4 sn karar aralığı, 4 kişilik profili, ihtiyaç önceliği, sağduyulu savaş/diplomasi) onaylandı.
- **Tasarım Finalizasyonu & Denge Değerleri:** Dev ülke arena kırpması, bölge başına 1 bina + soft-lock taban geliri, yalnızca `> 0` birlik türlerinin listelenmesi, Barış Teklifi + yanlış saldırı koruması, başlangıç denge/formül tablosu (`2000–2020`, maliyetler, hasar/koruma, `%30` kaçış, `4–12 sn` ele geçirme) ve 5 fazlı geliştirme yol haritası eklendi. Kodlamaya hazır.
