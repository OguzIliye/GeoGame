# Pixel World (v1.2) — Güncelleme İlerleme Takibi (UPDATE_PROGRESS_V1_2.md)

> Bu dosya [UPDATE_DESIGN_V1_2.md](UPDATE_DESIGN_V1_2.md) kapsamındaki tüm v1.2 özelliklerinin aşama aşama geliştirme ve doğrulama durumunu takip eder. Her aşama tamamlandığında **otomatik Vitest testleri + temiz `tsc --noEmit && vite build` + `UPDATE_PROGRESS_V1_2.md` güncellemesi + `git commit`** yapılır.

## Genel Durum
- **Aktif Aşama:** Aşama 5 — 11 Adımlı `20 px` İnteraktif Spotlight Tutorial (`Banka Borç`, Kontrollü Rakip, Hastane Geri Dönüş Animasyonu) & Gerçek Chrome Uçtan Uca Doğrulama
- **Tamamlanan Aşamalar:** 4 / 5
- **Son Doğrulama (Test + Clean Build + Gerçek Chrome Uçtan Uca Kontrol):** [ ] Bekliyor

---

## Aşama 1 — Harita/Ülke Temizliği, Kompakt Bölgeler (`2.0`) & Nesneler (`~%30` Küçük), Kalın Ülke Sınırları, Tek Bina (`combined`) Kaldırma & Büyük Popup/Font Temeli
- [x] Çalışma dizinindeki büyütülmüş popup ve `Consolas` okunabilirlik değişikliklerinin dahil edilmesi
- [x] Dengeli küçültülmüş bölgeler (`TARGET_REGION_AREA = 2.0`, `MAX_REGIONS_PER_COUNTRY = 64`, `LAND_MOVE_SPEED = 0.36`)
- [x] `≤ 4` bölgeli ufak ada ülkelerinin (Kıbrıs vb.) elenmesi ve `≤ 4` bölgeli kara/kıyı mikro ülkelerinin (Vatikan, San Marino, Monako, Andorra, Lüksemburg, Lübnan vb.) en uzun sınırlı büyük komşuya birleştirilmesi
- [x] Tek bina (`combined` / Merkez Kompleks) sisteminin kod tabanından tamamen kaldırılması
- [x] Harita nesnelerinin (bina, asker, gemi, çevre öğeleri) `~%30` küçültülmesi (`computeWorldSpritePixelStep = cameraScale / 26`), `getBuildingSpriteDataUri` ikon üreticisi ve `3.5–4 px` kalın ülke dış sınırları (ince `1 px` iç bölge sınırları)
- [x] Aşama 1 otomatik testler + temiz build + `UPDATE_PROGRESS_V1_2.md` güncellemesi + git commit

---

## Aşama 2 — Ekonomi & Bina-Bazlı Bağımsız Üretim Motoru (`100💰`, Tek Üniversite, `5 sn` Gelir, Banka Borç, Bina Yıkma, Paralel Fabrika `2–15 sn`, Kışla `min` Formülü & AI `3/7` Gün Gecikmesi)
- [x] Yeni başlangıç kuralı (`START_MONEY = 100`, `BUILDINGS.bank.cost = 100`, başlangıçta yalnızca `1 Üniversite`, `MAX_UNIVERSITIES = 1`, asker bakım maliyeti yok)
- [x] `5 sn`'de bir toplu gelir (`INCOME_TICK_SEC = 5`), Banka borç sistemi (`500 / 1.000 / 10.000`, `%15` faiz, `%25` otomatik kesinti, `20.000` tavan, `repayBankLoan`), `demolishBuilding` (`%50` iade)
- [x] Bina-bazlı bağımsız paralel Fabrika üretim hatları (`BuildingSlot.parallelProduction`, `2 / 4 / 7 / 11 / 15 sn` kademeli süreler)
- [x] Bina-bazlı bağımsız Kışla eğitimi (`BuildingSlot.trainingQueue`), ortak `min` kıt kaynak formülü (kalkan opsiyonel) ve askerlerin üretildiği Kışlanın yanında doğması
- [x] AI başlangıç gecikmesi (`3` gün tam bekleme, `7.` güne kadar barışçıl gelişim) ve bina-bazlı ekipman → asker zincirine tam uyum
- [x] Aşama 2 otomatik testler + temiz build + `UPDATE_PROGRESS_V1_2.md` güncellemesi + git commit

---

## Aşama 3 — Taktiksel Savaş, 7 Aksiyonlu Diplomasi, RTS Çoklu Ordu / Birleştirme & 3 Slotlu Save/Continue Motoru
- [x] Bölge fethinde düşman binasının yıkılması + anında `+1.000 💰` ganimet ödülü
- [x] Savaş taktikleri: kendi toprağında `+%10` Vatan Savunması, çatışmaya dost ordu takviyesi, çatışmadan `🏃 Geri Çekil` (`%10` kayıp cezasıyla en yakın dost bölgeye), tek tık `splitArmyHalf` (`50/50`)
- [x] Çoklu ordu seçimi (`selectedArmyIds`), yürüyerek birleştirme (`mergeTargetArmyId` / `orderArmiesMerge`), tek dost orduya tıklayıp birleştirme ve toplu yürüyüş
- [x] 7 aksiyonlu Diplomasi motoru (`sendDiplomaticGift`, `proposeNonAggressionPact` 365 gün, `breakAlliance`, `proposeTradeAgreement` `+%10 / 5sn` ve savaşta iptal) + `KeyD → KeyP` kısayol uyarlaması (`WASD` kamera kaydırma için)
- [x] 3 slotlu `src/state/saveManager.ts` (`saveToSlot / loadFromSlot / deleteSlot / listSaveSlots`, ülke adı + oyun tarihi metadatası + kompakt serileştirme)
- [x] Aşama 3 otomatik testler + temiz build + `UPDATE_PROGRESS_V1_2.md` güncellemesi + git commit

---

## Aşama 4 — RTS Kontrolleri (Kutu Seçimi + `WASD`/Sağ-Tık Pan), Evrensel Highlight, Sade HUD (`🏪 Mağaza`), İkon/Ayırıcı Çizgili Tüm Bina Popupları, 2 Sayfalı Diplomasi & 3 Slotlu Save/Continue UI
- [x] Sol-tık sürükle **Kutu Seçimi (Box-Select)** + sağ alt çoklu ordu birleştirme paneli; Sağ/Orta-tık sürükle + `WASD`/Ok tuşları Harita Kaydır (sağ-tık tek basış iptal)
- [x] Evrensel tıklama highlight'ı, kendi boş bölgesinde hızlı **Buraya Bina Kur** mini ikon menüsü, kendi binasına tıklayınca otomatik duraklatmalı (`'building_popup'`) bina işlem popup'ı + 2 tık onaylı kırmızı `🗑️ Binayı Yık`
- [x] Sade 3 butonlu alt dock (`🏪 Mağaza`, `📜 Diplomasi`, `🌍 Harita`), üst HUD `5 sn` canlı altın barı + borç rozeti + sol üst şeffaf **Canlı İşlem Şeridi**, haritada Kışla eğitim barı + `+X` yüzen efektler + yaralı kaçış/geri dönüş animasyonu
- [x] **Evrensel Popup Piksel İkon & Ayırıcı Çizgi Standardı** ile: Mağaza (ikon+isim+fiyat), Banka (borç), Üniversite (Bilim Ağacı), Hastane (iyileşen/yoldaki asker), İkonlu Kışla (`MAX` + isimsiz hover ikon + `+1/+5/+10/MAX`), İkonlu Paralel Fabrika (alt toplam maliyet + kapanmayan popup'ta ayrı loading bar'lar), Ordu (`50/50` + `Geri Çekil`), 2 Sayfalı 7-aksiyonlu Diplomasi, 3 Slotlu Kaydet & Çık + Ana Ekran `▶ Continue`
- [x] Aşama 4 otomatik testler + temiz build + `UPDATE_PROGRESS_V1_2.md` güncellemesi + git commit

---

## Aşama 5 — 11 Adımlı `20 px` İnteraktif Spotlight Tutorial (`Banka Borç`, Kontrollü Rakip, Hastane Geri Dönüş Animasyonu) & Gerçek Chrome Uçtan Uca Doğrulama
- [ ] SVG `<mask>` tabanlı `20 px` yarıçaplı açık yuvarlak + nabızlı sarı halka Spotlight motoru, hedefe göre konumlanan popup, adım bitmeden `✕` kapalı, yanlış tıklamada 2 kez kırmızı-sarı flaş, `Tutorial'ı Geç`, otomatik yumuşak kamera odaklanması, bekleme anında canlı görev rozeti
- [ ] 11 adımlı uygulamalı akış (Ana Ekran → Ülke Seç → Amaç → Mağaza & Banka `100💰` → Banka `+500💰` Borç → Fabrika & Ekipman → Kışla & Asker → Yönlendirme → Böl & Birleştir → 2 Sayfalı Diplomasi & Savaş → Savunma [`🩹` yaralı bekler] & Saldırı [`+1000💰`] → Hastane & Yaralı Geri Dönüş Animasyonu → Final 2 seçenekli kapanış) + oyun içi `📖` Hızlı Rehber / Yeniden Başlat
- [ ] Aşama 5 otomatik testler + temiz build + gerçek Chrome tarayıcısında tüm v1.2 özelliklerinin uçtan uca görsel doğrulaması + final `UPDATE_PROGRESS_V1_2.md` + final git commit
