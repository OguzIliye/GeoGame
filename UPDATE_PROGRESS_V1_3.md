# Pixel World (v1.3) — Güncelleme İlerleme Takibi (UPDATE_PROGRESS_V1_3.md)

> [UPDATE_DESIGN_V1_3.md](UPDATE_DESIGN_V1_3.md) kapsamındaki 5 aşamanın ilerleme durumu.

## Genel Durum
- **Aktif Aşama:** Aşama 2 — Toprak Geçiş Kuralları & Anlaşmalı Ülkelerle Etkileşimsizlik
- **Tamamlanan Aşamalar:** 2 / 5
- **Son Doğrulama (Test + Clean Build + Gerçek Chrome Uçtan Uca Kontrol):** [ ] Bekliyor

---

## Aşama 1 — Global `SIM_TIME_SCALE = 1/3` (3× Yavaş Tempo) & Tek Yaralı Birliği
- [x] `SIM_TIME_SCALE = 1/3` ile tüm simülasyon akışının 3× yavaşlatılması ve tutorial `3×` hız dengesinin korunması
- [x] UI süre metinlerinin (`15 sn` gelir, inşa/üretim/araştırma süreleri) gerçek süreye güncellenmesi
- [x] Ülke başına tek yaralı birliği (`WoundedBatch` birleştirme) ve haritada tek ikon + toplam sayı rozeti
- [x] Aşama 1 testler + temiz build + git commit

## Aşama 2 — Toprak Geçiş Kuralları & Anlaşmalı Ülkelerle Etkileşimsizlik
- [x] Yalnızca savaşta veya barış/saldırmazlık/ittifak anlaşmalı ülke toprağına giriş izni (nötr ülkeye giriş engeli, AI dahil)
- [x] Anlaşmalı ülkelerin askerleri arasında sıfır etkileşim (encounter, çatışma, hedefleme yok)
- [x] Aşama 2 testler + temiz build + git commit

## Aşama 3 — Daha Az Agresif AI & Barışta Maks. 2 Birlik Kuralı
- [ ] Yüksek saldırı eşiği (`≥ 1.6×`) ve düşük savaş ilan sıklığı
- [ ] Barışta en fazla 2 ordu birliği sınırı; sadece savaşta birlik artışı ve barış sonrası tekrar `≤ 2` birleştirme
- [ ] Aşama 3 testler + temiz build + git commit

## Aşama 4 — Tutorial Gizle/Aç, Sağ Üst Buton & Alt-Hedefli Çakışmasız Spotlight
- [ ] Spotlight kartı ve bekleme rozetine `— Gizle` butonu + sağ üst `📖 Tutorial Görevi (Adım X/11)` geri açma butonu
- [ ] Fabrika (`Kılıç +5` → `Tahta Kalkan +5` → `Üretimi Başlat`) ve Kışla (`Asker MAX` → `Kılıç MAX` → `Kalkan MAX` → `Asker Yetiştir`) alt hedefleri
- [ ] Spotlight açıklama kartının tıklanabilir modal butonlarının üstünü kapatmaması
- [ ] Aşama 4 testler + temiz build + git commit

## Aşama 5 — Kapsamlı v1.3 Testleri, Clean Build & Gerçek Chrome Uçtan Uca Doğrulama
- [ ] Tüm v1.3 birim testleri + temiz `npm test` ve `npm run build`
- [ ] Gerçek Chrome'da uçtan uca doğrulama + final `UPDATE_PROGRESS_V1_3.md` + final git commit
