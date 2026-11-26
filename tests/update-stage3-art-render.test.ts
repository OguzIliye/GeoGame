import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import {
  brightenHex,
  computeWorldSpritePixelStep,
  drawPixelArmyUnit,
  drawPixelBuilding,
  getTechItemSpriteDataUri,
  getUnitSpriteDataUri,
  renderMainMenuPixelScene,
} from '../src/art/pixelSprites';
import { SHIELD_ORDER, WEAPON_ORDER } from '../src/config/balance';
import { parseWorldTopology } from '../src/map/worldLoader';
import { MapCamera } from '../src/render/camera';
import { renderRegionalTheater } from '../src/render/mapRenderer';
import { getCountryRegions, spawnUnitsIntoCountryBarracks } from '../src/sim/economy';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);
const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
const baseTurkeyState = createInitialGameState();
startGameWithCountry(baseTurkeyState, turkey.id, worldCountries);

function createRecordingCanvas() {
  const calls: Array<{ x: number; y: number; w: number; h: number; fill: string }> = [];
  const mockObj = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
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
    fillRect: (x: number, y: number, w: number, h: number) => {
      calls.push({ x, y, w, h, fill: String(mockObj.fillStyle) });
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
  };
  const ctx = mockObj as unknown as CanvasRenderingContext2D;

  const getSpanWidth = () => {
    if (calls.length === 0) return 0;
    const minX = Math.min(...calls.map((c) => c.x));
    const maxX = Math.max(...calls.map((c) => c.x + c.w));
    return maxX - minX;
  };

  return { ctx, calls, getSpanWidth };
}

describe('v1.1 Aşama 3 — Detaylı Pixel Art, Ülke Rengi Outline, World-Space Zoom & İkon Üreticisi', () => {
  it('asker ve binalara sahip ülkenin renginde kontrastlı pixel outline ekler', () => {
    const blueRec = createRecordingCanvas();
    const redRec = createRecordingCanvas();

    drawPixelArmyUnit(blueRec.ctx, 200, 200, 'bazooka', 'diamond', 'idle', true, '#3b82f6', 0, 54);
    drawPixelArmyUnit(redRec.ctx, 200, 200, 'bazooka', 'diamond', 'idle', true, '#ef4444', 0, 54);

    const vividBlue = brightenHex('#3b82f6', 0.28);
    const vividRed = brightenHex('#ef4444', 0.28);
    expect(blueRec.calls.some((c) => c.fill === vividBlue)).toBe(true);
    expect(redRec.calls.some((c) => c.fill === vividRed)).toBe(true);

    const bldRec = createRecordingCanvas();
    drawPixelBuilding(bldRec.ctx, 'hospital', 200, 200, '#22c55e', true, false, 1, 0, 54);
    expect(bldRec.calls.some((c) => c.fill === brightenHex('#22c55e', 0.28))).toBe(true);
  });

  it('haritaya zoomlandığında bina ve asker boyutlarını world-space oranında büyütür', () => {
    expect(computeWorldSpritePixelStep(180)).toBeGreaterThan(computeWorldSpritePixelStep(36));

    const farBld = createRecordingCanvas();
    const zoomBld = createRecordingCanvas();
    drawPixelBuilding(farBld.ctx, 'bank', 300, 300, '#3b82f6', true, false, 1, 0, 30);
    drawPixelBuilding(zoomBld.ctx, 'bank', 300, 300, '#3b82f6', true, false, 1, 0, 140);
    expect(zoomBld.getSpanWidth()).toBeGreaterThan(farBld.getSpanWidth() * 3.5);

    const farSol = createRecordingCanvas();
    const zoomSol = createRecordingCanvas();
    drawPixelArmyUnit(farSol.ctx, 300, 300, 'ak', 'steel', 'idle', true, '#3b82f6', 0, 30);
    drawPixelArmyUnit(zoomSol.ctx, 300, 300, 'ak', 'steel', 'idle', true, '#3b82f6', 0, 140);
    expect(zoomSol.getSpanWidth()).toBeGreaterThan(farSol.getSpanWidth() * 3.5);
  });

  it('tüm silah/kalkan kombinasyonları ve Bilim Ağacı node ları için ayırt edilebilir SVG ikonları üretir', () => {
    const swordNone = getUnitSpriteDataUri('sword', 'none', '#3b82f6');
    const akSteel = getUnitSpriteDataUri('ak', 'steel', '#3b82f6');
    const bazookaForce = getUnitSpriteDataUri('bazooka', 'forcefield', '#ef4444');

    expect(swordNone.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    expect(swordNone).not.toBe(akSteel);
    expect(akSteel).not.toBe(bazookaForce);

    const rootIcon = getTechItemSpriteDataUri('root', 'base');
    expect(rootIcon.startsWith('data:image/svg+xml;utf8,')).toBe(true);

    const seenTechUris = new Set<string>([rootIcon]);
    for (const w of WEAPON_ORDER) {
      seenTechUris.add(getTechItemSpriteDataUri('weapon', w));
    }
    for (const s of SHIELD_ORDER) {
      seenTechUris.add(getTechItemSpriteDataUri('shield', s));
    }
    // 1 root + 5 weapons + 5 shields = 11 distinct pixel icons!
    expect(seenTechUris.size).toBe(11);
  });

  it('PIXEL WORLD ana ekran sahnesini ve bina yerleştirme ghost önizlemeli bölge haritasını hatasız çizer', () => {
    const menuRec = createRecordingCanvas();
    renderMainMenuPixelScene(menuRec.ctx, 1280, 720, 400);
    expect(menuRec.calls.length).toBeGreaterThan(250);

    const state = structuredClone(baseTurkeyState);
    const pid = turkey.id;
    spawnUnitsIntoCountryBarracks(state, pid, 'bazooka:forcefield', 8);
    const emptyReg = getCountryRegions(state, pid).find((r) => !r.building)!;
    state.placingBuildingType = 'factory';
    state.placementHoverPoint = [emptyReg.centroid[0], emptyReg.centroid[1]];
    state.focusPing = { x: emptyReg.centroid[0], y: emptyReg.centroid[1], startedRealMs: 100 };

    const cam = new MapCamera();
    if (state.arena) cam.setBounds(state.arena, 1280, 720, true);
    const mapRec = createRecordingCanvas();
    renderRegionalTheater(mapRec.ctx, state, cam, 1280, 720, 350);
    expect(mapRec.calls.length).toBeGreaterThan(300);
  });
});
