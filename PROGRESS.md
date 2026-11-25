# GeoGame — Geliştirme İlerleme Takibi (PROGRESS.md)

> Bu dosya [DESIGN.md](DESIGN.md) kapsamındaki tüm fazların durumunu takip eder. Her faz tamamlandığında otomatik test + temiz build + `PROGRESS.md` güncellemesi + `git commit` yapılır.

## Genel Durum
- **Aktif Faz:** Faz 3 — Ordu Kümeleri, Savaş, Hastane & Liman
- **Tamamlanan Fazlar:** 2 / 5

---

## Faz 1 — Harita & Bölge Motoru
- [x] Proje iskeleti kurulumu (`Vite + TypeScript + Vitest`, statik dünya haritası TopoJSON/GeoJSON asset'i)
- [x] Açılışta statik tam dünya haritası renderı ve tıklayarak ülke seçimi (hover + seçim bilgisi)
- [x] Seçilen ülkenin etrafında sabit **Oyun Alanı Çerçevesi (Arena Bounding Box)** oluşturma ve yumuşak kamera zoomu
- [x] Aktif ülke filtreleme (tavan maks. 15 AI ülke; kalan ~180 ülkeye AI atanmaması ve renderdan tamamen düşürülmesi)
- [x] Dev ülke kırpma (`polygon-clipping` ile Rusya/Çin/USA vb. ülkelerin sadece arena çerçevesine giren aktif kısmının/kıyısının alınması)
- [x] Eşit alanlı rastgele alt-poligon bölme (`Lloyd Relaxation + Voronoi` ülke poligonuna kırpılmış; küçük ülkeler tek poligon kalır, büyük ülkeler yüzölçümüne göre çok parçaya bölünür)
- [x] Bölge komşuluk grafiği (kara komşuluğu) ve kıyı bölgesi (denize kıyısı olma) tespiti
- [x] Sınırlı oyun alanında fare ile Pan & Zoom kontrolleri
- [x] Faz 1 otomatik birim testleri + temiz build + git commit

---

## Faz 2 — Zaman, Ekonomi, Binalar & Teknoloji
- [x] Oyun içi takvim (`1 Ocak 2000 → 1 Ocak 2020`, `1x` hızda `1 sn = 10 gün`)
- [x] Zaman hızı kontrolleri (`Pause / 0x`, `0.5x`, `1x`, `2x`) ve `Space` durdur/devam et kısayolu (`Esc` kullanılmadan)
- [x] Başlangıç kaynakları (`300 Para`, `50 Manpower`, `%50 Sağlık`) ve soft-lock önleyici taban akış (`+5 money/s`, `+1 manpower/s`)
- [x] Bölge başına maks. 1 bina kuralı ve başlangıç binaları (`1 Banka + 1 Kışla`; `1–4` bölgeli küçük ülkelerde `1 Birleşik Bina` + Tier 2 `Mızrak` & `Bronz Kalkan` açık)
- [x] 5 temel bina + 1 kıyı ek binası (**Kışla, Hastane, Banka, Fabrika, Üniversite, Liman**) süre bazlı inşası ve Satın Alma / Binalar UI penceresi
- [x] Küçük ülkeler için 3 kademeli **Birleşik Bina** sistemi
- [x] **Üniversite (Bilim) UI Penceresi:** 2 ayrı dal (`Kılıç → Mızrak → Pistol → AK → Bazuka` ve `Tahta → Bronz → Çelik → Elmas → Force Field`) süre & para bazlı araştırma
- [x] **Fabrika UI Penceresi:** Açık silah ve kalkanlar için süre bazlı üretim emirleri / kuyruğu ve ekipman stoğu
- [x] **Kışla UI Penceresi:** Eldeki `Manpower + Silah (+ opsiyonel Kalkan)` ile süre bazlı asker yetiştirme
- [x] Faz 2 otomatik birim testleri + temiz build + git commit

---

## Faz 3 — Ordu Kümeleri, Savaş, Hastane & Liman
- [ ] Harita üzerinde görünür ordu kümeleri (stack) ve tıklayınca **Ordu Kümesi Penceresi** (toplam sayı + yalnızca `> 0` olan `(Silah + Kalkan)` türleri ve ayrı sayıları)
- [ ] Ordu **Birleştirme (Merge)** (yakın dost kümeler) ve **Ayırma (Split)** (mevcut her birlik türü için ayrı sayı girişi zorunluluğu)
- [ ] Ordu hareket UX: Orduya sol tık → değişen imleç → hedef bölgeye/düşman kümesine sol tık; **sağ tık** veya **harita dışı tık** ile iptal
- [ ] Askerler yürürken harita üzerinde **animasyonlu ok işareti**
- [ ] Süre bazlı **Alan Ele Geçirme** (`max(4s, 12s - 1.5*log2(N))`), bölge ele geçirilince ülke sınırının güncellenmesi ve bölgedeki binanın **yıkılması**
- [ ] Zaman içinde akan **Ordu vs Ordu Savaş** sistemi (Hasar + Koruma + Sayı çoğunluğu çarpanı)
- [ ] **Savaştan Kaçış & Hastane Döngüsü:** Düşen askerlerin `%30`'unun (ayakta Hastane/Birleşik Bina varsa) otomatik en yakın hastaneye yürümesi ve `8 sn`'de iyileşip **eski birlik/ekipman türüyle** geri dönmesi (hastane yoksa kurtarılamaz)
- [ ] **Liman & Deniz Taşımacılığı:** Gemi savaşı yok; sınırsız kapasiteli taşıma gemisinin denizde görünür ve süre bazlı seyri, kıyıya varınca askerlerin karada belirmesi, geri binmek için **önce askere sonra gemiye tıklama**
- [ ] Faz 3 otomatik birim testleri + temiz build + git commit

---

## Faz 4 — Diplomasi, İnsan Gibi AI & Oyun Sonu
- [ ] **Diplomasi UI Penceresi:** Tüm aktif ülkeler listesi, ülke sayfasında anlık ilişki (`Nötr / İttifak / Savaş` + puan) ve **Savaş İlanı, İttifak Teklifi, Barış Teklifi** aksiyonları
- [ ] Yanlış tıklama koruması (yalnızca savaşta olunan ülkeye saldırı/fetih; müttefik topraklarından serbest geçiş)
- [ ] **4 Katmanlı İnsan Gibi AI:** `2–4 sn` karar aralığı, 4 kişilik profili (*Saldırgan, Ekonomist/Teknolojici, Fırsatçı, Savunmacı/Diplomat*), sıralı ihtiyaç/ekonomi/üretim yönetimi, sağduyulu savaş/hedef/liman/diplomasi kararları
- [ ] **Önemli Olay Bildirim Şeridi (Event Toast):** Yalnızca kritik olaylarda (savaş, ittifak, barış, bölge/bina kaybı-fethi, araştırma bitişi) bildirim; rutin eğitim/üretim olaylarında çıkmaması
- [ ] **Kaybetme & Kazanma Ekranı:** Tüm bölgeleri kaybedince yenilgi; `1 Ocak 2020` tarihinde (veya erken tam fetihte) tüm ülkelerin statlarının karşılaştırıldığı sıralama/skor tablosu ve yeniden oyna akışı
- [ ] Faz 4 otomatik birim testleri + temiz build + git commit

---

## Faz 5 — Mid-Res Pixel Art, Animasyonlar, Çevre & Müzik
- [ ] Mid-res pixel art harita çevre & biyom öğeleri (**ağaç, dağ, çimen, çöl, deniz**) ve keskin piksel (`nearest-neighbor`) render
- [ ] **Asker Animasyonları (Maks. Seviye Gösterim Kuralı):** Kümede yaşayan en yüksek silah + en yüksek kalkan görseli (`Idle`, `Yürüme`, `Savaş anı`; üst seviye askerler bitince otomatik alt seviyeye düşüş; bazuka/füze ateşi dahil)
- [ ] **Bina Animasyonları:** `Idle` ve `Çalışır` animasyonları (Banka gibi sürekli aktif binalarda yalnızca `Çalışır` animasyonu)
- [ ] **Transportasyon Gemisi:** Denizde seyir animasyonu
- [ ] **Web Audio API Arka Plan Müziği** (retro/pixel-art döngüsel müzik) + **Ayarlar (Settings) Penceresi** (müzik ses seviyesi slider + susturma/mute)
- [ ] Faz 5 otomatik testler + temiz build + tarayıcıda uçtan uca doğrulama + final git commit
