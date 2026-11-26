import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import {
  drawPixelArmyUnit,
  drawPixelBuilding,
  drawPixelTerrainProp,
  drawPixelTransportShip,
} from '../src/art/pixelSprites';
import { RetroMusicController } from '../src/audio/music';
import { SHIELD_ORDER, WEAPON_ORDER } from '../src/config/balance';
import { parseWorldTopology } from '../src/map/worldLoader';
import { getCountryRegions, isBuildingWorking, queueFactoryProduction } from '../src/sim/economy';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';
import type { BuildingType, TerrainProp } from '../src/types';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);
const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
const baseTurkeyState = createInitialGameState();
startGameWithCountry(baseTurkeyState, turkey.id, worldCountries);

function createMockCanvas2D(): { ctx: CanvasRenderingContext2D; fillRectCount: () => number } {
  let rects = 0;
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
    imageSmoothingEnabled: false,
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    fillRect: () => {
      rects++;
    },
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    arc: () => {},
    setLineDash: () => {},
    fillText: () => {},
    measureText: (t: string) => ({ width: t.length * 7 }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, fillRectCount: () => rects };
}

describe('Faz 5 — Mid-Res Pixel Art, Animasyonlar, Çevre & Müzik', () => {
  it('Ayarlar ses seviyesi ve susturma (mute) kontrollerini doğru yönetir', () => {
    const music = new RetroMusicController();
    music.setVolume(0.6);
    expect(music.getVolume()).toBeCloseTo(0.6);
    expect(music.isMuted()).toBe(false);

    music.toggleMute();
    expect(music.isMuted()).toBe(true);

    // Ses seviyesi açıldığında susturmayı kaldırır
    music.setVolume(0.8);
    expect(music.isMuted()).toBe(false);
    expect(music.getVolume()).toBeCloseTo(0.8);

    // 0..1 sınırlarını korur
    music.setVolume(5);
    expect(music.getVolume()).toBe(1);
    music.setVolume(-2);
    expect(music.getVolume()).toBe(0);
  });

  it('Banka ve Birleşik Binayı her zaman çalışır (active), diğer binaları ise aktif işe göre idle/çalışır döndürür', () => {
    const state = structuredClone(baseTurkeyState);
    const p = state.countries[turkey.id];
    const owned = getCountryRegions(state, turkey.id);

    const bankReg = owned.find((r) => r.building?.type === 'bank')!;
    expect(isBuildingWorking(state, p, bankReg)).toBe(true);

    const facReg = owned.find((r) => !r.building)!;
    facReg.building = {
      type: 'factory',
      level: 1,
      constructing: false,
      progressSec: 0,
      totalSec: 0,
    };
    expect(isBuildingWorking(state, p, facReg)).toBe(false);
    queueFactoryProduction(state, turkey.id, 'weapon', 'sword', 2);
    expect(isBuildingWorking(state, p, facReg)).toBe(true);
  });

  it('tüm çevre biyom öğelerini, bina idle/çalışır animasyonlarını, asker silah+kalkan (bazuka + forcefield dahil) animasyonlarını ve gemiyi çizer', () => {
    const { ctx, fillRectCount } = createMockCanvas2D();

    const propKinds: TerrainProp['kind'][] = ['tree', 'mountain', 'grass', 'cactus', 'dune'];
    for (const kind of propKinds) {
      drawPixelTerrainProp(ctx, { kind, x: 0, y: 0, variant: 1 }, 100, 100, 28, 500);
    }

    const buildings: BuildingType[] = [
      'barracks',
      'hospital',
      'bank',
      'factory',
      'university',
      'port',
    ];
    for (const bt of buildings) {
      drawPixelBuilding(ctx, bt, 100, 100, '#3b82f6', false, false, 1, 200);
      drawPixelBuilding(ctx, bt, 100, 100, '#3b82f6', true, false, 1, 500);
      drawPixelBuilding(ctx, bt, 100, 100, '#3b82f6', false, true, 0.5, 500);
    }

    for (const w of WEAPON_ORDER) {
      for (const s of ['none', ...SHIELD_ORDER] as const) {
        drawPixelArmyUnit(ctx, 120, 120, w, s, 'idle', true, '#2563eb', 100);
        drawPixelArmyUnit(ctx, 120, 120, w, s, 'walk', false, '#ef4444', 300);
        drawPixelArmyUnit(ctx, 120, 120, w, s, 'combat', true, '#2563eb', 450);
      }
    }

    drawPixelTransportShip(ctx, 150, 150, '#2563eb', true, true, 480);
    expect(fillRectCount()).toBeGreaterThan(500);
  });
});
