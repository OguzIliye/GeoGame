import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import { ARENA_CONFIG } from '../src/config/balance';
import { buildRegionalTheater, pickRegionAtPoint } from '../src/map/arenaBuilder';
import { multiPolygonArea, projectLonLat } from '../src/map/geometry';
import { parseWorldTopology, pickWorldCountryAtPoint } from '../src/map/worldLoader';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);

describe('Faz 1 — Harita & Bölge Motoru', () => {
  it('statik dünya haritasını Antarktika ve <=4 bölgeli ufak ada ülkeleri olmadan benzersiz ID ile yükler', () => {
    expect(worldCountries.length).toBeGreaterThan(100);
    expect(worldCountries.some((c) => c.name === 'Antarctica')).toBe(false);
    expect(worldCountries.some((c) => c.name === 'Cyprus')).toBe(false);
    expect(worldCountries.some((c) => c.name === 'N. Cyprus')).toBe(false);
    const ids = new Set(worldCountries.map((c) => c.id));
    expect(ids.size).toBe(worldCountries.length);
  });

  it('Vatikan ve San Marino gibi küçük kara ülkelerini komşu büyük ülkeye (İtalya) birleştirir', () => {
    expect(worldCountries.some((c) => c.name === 'Vatican')).toBe(false);
    expect(worldCountries.some((c) => c.name === 'San Marino')).toBe(false);
    const italy = worldCountries.find((c) => c.name === 'Italy')!;
    expect(italy).toBeDefined();
    const vaticanPt = projectLonLat(12.45, 41.9);
    const hit = pickWorldCountryAtPoint(vaticanPt, worldCountries);
    expect(hit?.id).toBe(italy.id);
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
    expect(trRegions.length).toBeGreaterThan(25);

    // Yaklaşık eşit alan kontrolü (ortalamadan aşırı sapmayan kompakt organik alt-poligonlar)
    const areas = trRegions.map((r) => r.area);
    const avgArea = areas.reduce((s, a) => s + a, 0) / areas.length;
    expect(avgArea).toBeGreaterThan(0.9);
    expect(avgArea).toBeLessThan(4.5);

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

  it('denize kıyısı olmayan Belarus seçildiğinde kendi bölgelerine sahte kıyı atamaz', () => {
    const belarus = worldCountries.find((c) => c.name === 'Belarus')!;
    expect(belarus).toBeDefined();
    const built = buildRegionalTheater(belarus.id, worldCountries);
    const byRegions = Object.values(built.regions).filter((r) => r.ownerId === belarus.id);
    expect(byRegions.length).toBeGreaterThanOrEqual(5);
    expect(byRegions.every((r) => !r.isCoastal)).toBe(true);
  });
});
