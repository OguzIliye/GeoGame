# Pixel World (v1.3) — Güncelleme Tasarımı (UPDATE_DESIGN_V1_3.md)

> v1.2 üzerine eklenecek değişiklikler. İlerleme `UPDATE_PROGRESS_V1_3.md` dosyasında takip edilir; her aşama sonunda Vitest + temiz `tsc --noEmit && vite build` + progress güncellemesi + git commit yapılır.

---

## 1. Tutorial Bildirimini Kapat / Aç
- Spotlight kartına (`.tut-spotlight-card`) ve bekleme rozetine (`#tut-live-task-badge`) **`— Gizle`** butonu eklenir.
- Gizlenince maske, halka ve kart kaybolur; oyun normal oynanır (tutorial aşaması **sıfırlanmaz**, arka planda takip edilmeye devam eder).
- Gizli bir tutorial görevi varken **sağ üstte** (HUD üst barının altında, toast şeridinin üstünde) sabit bir **`📖 Tutorial Görevi (Adım X/11)`** butonu görünür.
- Bu butona tıklanınca spotlight kaldığı adımdan tekrar açılır.
- Gizliyken global tıklama koruması (`installGlobalClickGuard`) devre dışıdır; yanlış tıklama flaşı yoktur.
- `Tutorial'ı Geç` ayrı kalır (tamamen bitirir); `Gizle` sadece geçici kapatır.

## 2. Daha Az Agresif Yapay Zeka
- Saldırı kararı eşikleri yükseltilir: AI ancak belirgin güç üstünlüğü (ör. `≥ 1.6×`) ve yeterli rezerv varken savaş ilan eder; savaş ilan sıklığı düşürülür.
- **Ordu bölme sınırı:** AI barış zamanında en fazla **2 ordu birliği** tutar; fazla birlikleri birleştirir.
- **Savaşta esneklik:** AI yalnızca aktif savaştayken cephe ihtiyacına göre birlik sayısını artırabilir (bölme / yeni Kışla çıkışları).
- Savaş bitince (barış) AI birliklerini tekrar `≤ 2` birliğe birleştirir.

## 3. Toprak Geçiş Kuralları
- Bir ordu başka ülkenin bölgesine **yalnızca**:
  - o ülkeyle **savaş** durumundaysa, veya
  - o ülkeyle **barış / saldırmazlık / ittifak** anlaşması varsa (geçiş hakkı) girebilir.
- Nötr (anlaşmasız, savaşsız) ülke topraklarına giriş engellenir; yol bulma (`orderArmyMoveToRegion` / waypoint üretimi) bu bölgeleri geçilemez sayar ve oyuncuya `Bu ülkenin topraklarına giriş izniniz yok.` uyarısı verilir.
- AI de aynı kurala uyar.

## 4. Anlaşmalı Ülkelerle Etkileşim Yok
- Barış / saldırmazlık / ittifak anlaşması olan ülkelerin askerleri birbirleriyle **hiçbir şekilde** etkileşime girmez:
  - Encounter popup'ı açılmaz, çatışma başlamaz, hedeflenemez (tıklama hedef seçmez, içinden geçilir).
  - Aynı bölgede üst üste durabilirler.

## 5. Yaralılar Tek Birlik Olarak Döner
- Bir çatışmadan çıkan tüm yaralılar, ülke başına **tek bir yaralı birliği** (`WoundedGroup`) halinde birleşir.
- Aynı hedef Hastaneye giden / sahada bekleyen yaralı grupları mevcutsa yeni yaralılar o gruba eklenir (görüntü kirliliği engellenir).
- Haritada tek ikon + toplam sayı rozeti gösterilir.

## 6. Oyun Hızı 3× Yavaş
- Tüm simülasyon temposu **3 kat yavaşlatılır** (global zaman çarpanı `SIM_TIME_SCALE = 1/3`):
  - Takvim ilerlemesi, `5 sn` gelir tick'i (gerçek zamanda `15 sn`), inşaat / üretim / eğitim süreleri, ordu & gemi hareketi, çatışma, ele geçirme, AI karar aralıkları, yaralı yürüyüş & iyileşme.
- UI'daki süre metinleri (`5 sn`, `2–15 sn` vb.) gerçek süreyi gösterecek şekilde güncellenir.
- Tutorial hızlandırması (`3×`) korunur → tutorial sırasında efektif tempo v1.2 normal hızına eşit olur.

## 7. Tutorial'ın UI Önüne Geçme Hatası
- Spotlight kartı tıklanması gereken butonların (sayı arttırma, `MAX`, onay) **üstünü kapatmaz**:
  - Kart yerleşimi hedef dışında, aktif modal pencerenin **dışına** (sağ/sol boşluk veya ekran kenarı) yerleştirilir; sığmazsa kart küçültülür / kenara yapışır.
  - Kart ile tıklanabilir modal kontrolleri çakışıyorsa kart otomatik kaydırılır.
- Çoklu eylem gerektiren modal adımları alt hedeflere bölünür ve spotlight sırayla gezer:
  - **Fabrika:** Kılıç `+5` → Tahta Kalkan `+5` → `⚙️ Üretimi Başlat` → `✕` / `▶ Üretimi İzle`.
  - **Kışla:** Asker `MAX` → Kılıç `MAX` → Tahta Kalkan `MAX` → `⚔️ Asker Yetiştir`.
- Modal içindeki input / `+N` / `MAX` tıklamaları anında tutorial senkronunu tetikler (`onModalInteraction`).
- Diğer adımlar (Banka, Böl/Birleştir, Diplomasi, Hastane) aynı kurallara göre taranır.

---

## Aşama Planı
1. **Aşama 1:** Bölüm 6 (3× yavaş tempo) + Bölüm 5 (tek yaralı birliği).
2. **Aşama 2:** Bölüm 3 + 4 (toprak geçiş kuralları, anlaşmalı ülkelerle etkileşimsizlik).
3. **Aşama 3:** Bölüm 2 (daha az agresif AI, `≤ 2` birlik kuralı).
4. **Aşama 4:** Bölüm 1 + 7 (tutorial gizle/aç, sağ üst buton, UI çakışma düzeltmesi, alt hedefli spotlight).
5. **Aşama 5:** Tüm testler + temiz build + gerçek Chrome uçtan uca doğrulama + final commit.
