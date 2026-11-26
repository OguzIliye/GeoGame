import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import {
  computeWorldSpritePixelStep,
  getBuildingSpriteDataUri,
  getCountryFlagDataUri,
} from '../src/art/pixelSprites';
import { ARENA_CONFIG, BUILDINGS, COMBAT_CONFIG } from '../src/config/balance';
import { projectLonLat } from '../src/map/geometry';
import { parseWorldTopology, pickWorldCountryAtPoint } from '../src/map/worldLoader';
import { MapCamera } from '../src/render/camera';
import { renderRegionalTheater } from '../src/render/mapRenderer';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';
import type { BuildingType } from '../src/types';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);

describe('v1.2 Aşama 1 — Ülke/Ada Temizliği, Kompakt Bölge & Nesneler, Kalın Sınırlar & Bina İkonları', () => {
  it('<=4 bölgeli ada ülkelerini (Kıbrıs, Malta, Singapur) eler ve küçük kara ülkelerini en uzun sınırlı büyük komşuya katar', () => {
    expect(ARENA_CONFIG.TARGET_REGION_AREA).toBe(2.0);
    expect(ARENA_CONFIG.MAX_REGIONS_PER_COUNTRY).toBe(64);
    expect(COMBAT_CONFIG.LAND_MOVE_SPEED).toBe(0.36);

    const names = new Set(worldCountries.map((c) => c.name));
    expect(names.has('Cyprus')).toBe(false);
    expect(names.has('N. Cyprus')).toBe(false);
    expect(names.has('Malta')).toBe(false);
    expect(names.has('Singapore')).toBe(false);
    expect(names.has('Vatican')).toBe(false);
    expect(names.has('San Marino')).toBe(false);
    expect(names.has('Monaco')).toBe(false);
    expect(names.has('Andorra')).toBe(false);
    expect(names.has('Luxembourg')).toBe(false);
    expect(names.has('Lebanon')).toBe(false);

    // Lüksemburg koordinatı Almanya veya Fransa toprağına birleşmiş olmalı
    const luxHit = pickWorldCountryAtPoint(projectLonLat(6.13, 49.61), worldCountries);
    expect(luxHit).not.toBeNull();
    expect(['Germany', 'France']).toContain(luxHit!.name);

    // Lübnan koordinatı Suriye veya İsrail toprağına birleşmiş olmalı
    const lebHit = pickWorldCountryAtPoint(projectLonLat(35.85, 33.85), worldCountries);
    expect(lebHit).not.toBeNull();
    expect(['Syria', 'Israel']).toContain(lebHit!.name);

    // Hayatta kalan her dünya ülkesi TARGET_REGION_AREA=2.0 ile en az 5 bölge kapasitesine sahiptir
    for (const c of worldCountries) {
      expect(Math.round(c.area / ARENA_CONFIG.TARGET_REGION_AREA)).toBeGreaterThan(
        ARENA_CONFIG.SMALL_COUNTRY_MAX_REGIONS,
      );
    }
  });

  it('combined (tek bina) sistemini tamamen kaldırır ve 6 standart bina için ayırt edilebilir SVG ikon üretir', () => {
    expect('combined' in BUILDINGS).toBe(false);
    const types: BuildingType[] = ['bank', 'factory', 'barracks', 'hospital', 'university', 'port'];
    const uris = new Set(types.map((t) => getBuildingSpriteDataUri(t, '#3b82f6')));
    expect(uris.size).toBe(6);
    for (const u of uris) {
      expect(u.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    }

    const blueFlag = getCountryFlagDataUri('#3b82f6');
    const redFlag = getCountryFlagDataUri('#ef4444');
    expect(blueFlag.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    expect(blueFlag).not.toBe(redFlag);
  });

  it('harita nesnesi ölçeğini ~%30 küçültür ve haritada 3.8px kalın ülke dış sınırlarını çizer', () => {
    expect(computeWorldSpritePixelStep(36)).toBeCloseTo(36 / 26, 2);
    expect(computeWorldSpritePixelStep(36)).toBeLessThan(1.5);

    const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
    const state = createInitialGameState();
    startGameWithCountry(state, turkey.id, worldCountries);
    const cam = new MapCamera();
    if (state.arena) cam.setBounds(state.arena, 1280, 720, true);

    const strokeWidths: number[] = [];
    const mockObj = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      globalAlpha: 1,
      lineDashOffset: 0,
      font: '',
      textAlign: 'center',
      textBaseline: 'middle',
      imageSmoothingEnabled: false,
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {
        strokeWidths.push(mockObj.lineWidth);
      },
      arc: () => {},
      setLineDash: () => {},
      fillText: () => {},
      measureText: (t: string) => ({ width: t.length * 7 }),
    };
    renderRegionalTheater(mockObj as unknown as CanvasRenderingContext2D, state, cam, 1280, 720, 100);
    expect(strokeWidths.some((w) => w >= 3.5 && w <= 4.1)).toBe(true);
    expect(strokeWidths.some((w) => w === 1)).toBe(true);
  });
});
