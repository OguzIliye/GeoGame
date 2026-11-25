import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import { ARENA_CONFIG } from '../src/config/balance';
import { buildRegionalTheater, pickRegionAtPoint } from '../src/map/arenaBuilder';
import { multiPolygonArea } from '../src/map/geometry';
import { parseWorldTopology, pickWorldCountryAtPoint } from '../src/map/worldLoader';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);

describe('Faz 1 — Harita & Bölge Motoru', () => {
  it('statik dünya haritasını Antarktika olmadan ve benzersiz ID ile yükler', () => {
    expect(worldCountries.length).toBeGreaterThan(200);
    expect(worldCountries.some((c) => c.name === 'Antarctica')).toBe(false);
    const ids = new Set(worldCountries.map((c) => c.id));
    expect(ids.size).toBe(worldCountries.length);
  });

  it('Vatikan gibi mikro devletleri İtalya içinde tıklanınca doğru seçer ve tek poligon tutar', () => {
    const vatican = worldCountries.find((c) => c.name === 'Vatican');
    expect(vatican).toBeDefined();
    const hit = pickWorldCountryAtPoint(vatican!.centroid, worldCountries);
    expect(hit?.id).toBe(vatican!.id);

    const built = buildRegionalTheater(vatican!.id, worldCountries);
    const vaticanRegions = Object.values(built.regions).filter((r) => r.ownerId === vatican!.id);
    expect(vaticanRegions.length).toBe(1);
    expect(built.countries[vatican!.id].isSmallCountry).toBe(true);
    expect(built.countries[vatican!.id].unlockedWeapons).toContain('spear');
    expect(built.countries[vatican!.id].unlockedShields).toContain('bronze');
  });

  it('Türkiye seçildiğinde maks. 15 AI sınırı uygular, Rusya dev poligonunu kırpar ve kıyı/komşuluk üretir', () => {
    const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
    const russiaWorld = worldCountries.find((c) => c.name === 'Russia')!;
    expect(turkey).toBeDefined();
    expect(russiaWorld).toBeDefined();

    const built = buildRegionalTheater(turkey.id, worldCountries);
    const activeIds = Object.keys(built.countries);
    expect(activeIds.length).toBeLessThanOrEqual(ARENA_CONFIG.MAX_AI_COUNTRIES + 1);
    expect(activeIds.length).toBeGreaterThanOrEqual(5);

    const trRegions = Object.values(built.regions).filter((r) => r.ownerId === turkey.id);
    expect(trRegions.length).toBeGreaterThan(6);

    // Yaklaşık eşit alan kontrolü (ortalamadan aşırı sapmayan organik alt-poligonlar)
    const areas = trRegions.map((r) => r.area);
    const avgArea = areas.reduce((s, a) => s + a, 0) / areas.length;
    expect(avgArea).toBeGreaterThan(1.2);
    expect(avgArea).toBeLessThan(6.5);

    // Kıyı ve kara komşuluğu kontrolü
    expect(trRegions.some((r) => r.isCoastal && r.coastalAnchor !== null)).toBe(true);
    expect(trRegions.every((r) => r.neighbors.length > 0)).toBe(true);

    // Rusya aktif sete girdiyse tüm Sibirya yerine yalnızca arena çerçevesindeki kısmı kırpılmış olmalı
    if (built.countries[russiaWorld.id]) {
      const ruRegions = Object.values(built.regions).filter((r) => r.ownerId === russiaWorld.id);
      const clippedRuArea = ruRegions.reduce((s, r) => s + multiPolygonArea(r.polygons), 0);
      expect(clippedRuArea).toBeLessThan(russiaWorld.area * 0.25);
    }

    // Bölge tıklama (pickRegionAtPoint) doğrulaması
    const picked = pickRegionAtPoint(trRegions[0].centroid, built.regions);
    expect(picked?.id).toBe(trRegions[0].id);
  });

  it('denize kıyısı olmayan İsviçre seçildiğinde kendi bölgelerine sahte kıyı atamaz', () => {
    const switzerland = worldCountries.find((c) => c.name === 'Switzerland')!;
    expect(switzerland).toBeDefined();
    const built = buildRegionalTheater(switzerland.id, worldCountries);
    const chRegions = Object.values(built.regions).filter((r) => r.ownerId === switzerland.id);
    expect(chRegions.length).toBeGreaterThanOrEqual(1);
    expect(chRegions.every((r) => !r.isCoastal)).toBe(true);
  });
});
