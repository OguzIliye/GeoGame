# Pixel World (GeoGame v1.1) — Güncelleme İlerleme Takibi (UPDATE_PROGRESS.md)

> Bu dosya [UPDATE_DESIGN.md](UPDATE_DESIGN.md) kapsamındaki tüm v1.1 özelliklerinin aşama aşama geliştirme ve doğrulama durumunu takip eder. Her aşama tamamlandığında **otomatik test + temiz build + `UPDATE_PROGRESS.md` güncellemesi + `git commit`** yapılır.

## Genel Durum
- **Aktif Aşama:** Aşama 4 — `Pixel World` Ana Ekranı, Opsiyonel Tutorial, Görsel Bilim Ağacı, Karşılaşma Popup'ı, İkonlu Birlikler & Hover Kısayollar
- **Tamamlanan Aşamalar:** 3 / 4
- **Son Doğrulama (Test + Clean Build + Tarayıcı Uçtan Uca Kontrol):** [ ] Bekliyor

---

## Aşama 1 — Çekirdek Veri, Zaman (`1 sn = 0.25 Gün`, 4 Saat Kampanya), Auto-Pause, Manuel Bina Koordinatı & KeyBindings
- [x] Oyun aşamalarının güncellenmesi (`main_menu | world_select | playing | ended`) ve yeni veri tipleri (`BuildingSlot.{x,y}`, `ArmyStack.waypoints`, `EncounterPrompt`, `AutoPauseReason`)
- [x] Yeni takvim ve hız dengesi (`1 gerçek sn = 0.25 oyun günü`, `1 Ocak 2000 → 1 Ocak 2010` ~4 saatlik kampanya, `LAND_MOVE_SPEED` günde ~1 bölge)
- [x] Oyuncu eylemlerinde otomatik duraklatma (`Auto-Pause`: bina yerleştirme, ordu/gemi hedef seçme, karşılaşma popup'ı, oyun içi tutorial) ve manuel durdurmayı ezmeden eski hıza dönme
- [x] Fareyle seçilen `(x, y)` harita koordinatına bina kurma doğrulaması (`validateBuildingPlacementAtPoint`) ve bina ayak izindeki çevre öğelerini temizleme
- [x] Kalıcı `KeyBindings` yöneticisi (`localStorage`, `Esc` engeli, çakışma takası, varsayılanlara sıfırlama, okunaklı tuş etiketleri)
- [x] Aşama 1 otomatik testler + temiz build + `UPDATE_PROGRESS.md` güncellemesi + git commit

---

## Aşama 2 — Doğal Uzun Mesafe Yürüyüşü, Hedef Fethi, Karşılaşma (Encounter) Sistemi & Ordu Odaklanma (`Q`)
- [x] Zorunlu centroid uğraması olmadan geçerli kara koridorunda serbest yürüyüş + uzun mesafelerde hafif sağ/sol salınım (`waypoints`)
- [x] Ara düşman bölgelerinden geçerken durmadan ilerleme; yalnızca durulan/savaşılan/hedeflenen bölgenin ele geçirilmesi
- [x] Başka devletin ordusuyla karşılaşma tespiti (`Encounter`): oyunu otomatik durdurma, çift bazlı soğuma ve karar çözümleme (`Saldır`, `Savaş İlan Et & Saldır`, `Dur / Geri Çekil`, `Devam Et`)
- [x] `MapCamera.focusOnPoint` yumuşak odaklanma ve oyuncu orduları arasında sırayla zoomlama (`cyclePlayerArmyFocus` — `Q` + HUD butonu + ping halkası)
- [x] Aşama 2 otomatik testler + temiz build + `UPDATE_PROGRESS.md` güncellemesi + git commit

---

## Aşama 3 — Genişletilmiş Detaylı Pixel Art, Ülke Rengi Outline, World-Space Zoom & İkon Üreticisi
- [x] Genişletilmiş ve gölgelendirilmiş detaylı karakter (`~24×26`) ve bina (`~28×26`) mid-res pixel art sprite ızgaraları
- [x] Sahip ülkenin renginde kontrast korumalı piksel dış çizgi (`country-color pixel outline` + önbellekli `PixelGrid` span motoru)
- [x] Haritaya yakınlaştırdıkça bina, asker, gemi ve çevre öğelerinin harita ölçeğine sabit (`world-space fixed`) büyüyerek yakından incelenebilmesi
- [x] Çok parçalı kıvrımlı hareket oku, bina yerleştirme ghost önizlemesi (yeşil/kırmızı geçerlilik) ve belirgin oyuncu ordusu işaretçisi (`★` + dost halka + ping)
- [x] Birlik inceleme (`Silah + Kalkan` ayırt edilebilir) ve Bilim Ağacı node'ları için detaylı pixel-art ikon üreticisi + `PIXEL WORLD` ana ekran piksel sahnesi (Banka + Bazuka tutan asker + piksel logo)
- [x] Aşama 3 otomatik testler + temiz build + `UPDATE_PROGRESS.md` güncellemesi + git commit

---

## Aşama 4 — `Pixel World` Ana Ekranı, Opsiyonel Tutorial, Görsel Bilim Ağacı, Karşılaşma Popup'ı, İkonlu Birlikler & Hover Kısayollar
- [ ] **`Pixel World`** başlığı ve açılış Ana Ekranı (`PIXEL WORLD` piksel logosu, animasyonlu Banka + Bazuka tutan asker, `▶ Oyna` & `📖 Tutorial` butonları)
- [ ] `Oyna` basıldığında opsiyonel *"Tutorial oynamak / incelemek ister misiniz?"* sorusu ve 5 adımlı görsel Tutorial penceresi
- [ ] **Görsel Bilim Ağacı:** Başlangıç node'undan 2 çizgiyle ayrılan Silah ve Kalkan dalları, her node'da piksel ikon + altında gereken para + üstüne gelince stat kartı
- [ ] **Karşılaşma (Encounter) Popup'ı:** İki tarafın toplam asker + ikonlu birlik kırılımlarını gösteren `Karşılaşma` sekmesi ve ülkeler arası ilişkileri gösteren üst `Diplomasi` sekmesi
- [ ] **İkonlu Birlik İnceleme & Hover Tooltip:** Ordu penceresi (genel + Split), Karşılaşma popup'ı ve Gemi görünümünde silah/kalkan ikonları + fare tutunca sayı/silah/kalkan bilgisi
- [ ] Fareyle manuel bina yerleştirme UX akışı, `🎯 Orduma Odaklan` HUD butonu (`Q`), Ayarlar içinde **Key Binding** düzenleyici ve tüm klavye kontrollü butonlarda **dinamik hover kısayol notu**
- [ ] Aşama 4 otomatik testler + temiz build + gerçek Chrome tarayıcısında uçtan uca doğrulama + final `UPDATE_PROGRESS.md` + final git commit
