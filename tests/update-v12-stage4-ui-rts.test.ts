import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import { RetroMusicController } from '../src/audio/music';
import { KeyBindingsManager } from '../src/config/keybindings';
import { parseWorldTopology } from '../src/map/worldLoader';
import { MapCamera } from '../src/render/camera';
import { renderRegionalTheater } from '../src/render/mapRenderer';
import { selectArmiesInWorldBox } from '../src/sim/army';
import { isAutoPaused } from '../src/sim/calendar';
import {
  getCountryRegions,
  pushFloatingEffect,
  queueBarracksTrainingBatch,
  queueFactoryParallelBatch,
  spawnUnitsIntoCountryBarracks,
  startBuildingConstruction,
  takeBankLoan,
  tickEconomyAndQueues,
} from '../src/sim/economy';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';
import { deleteSlot, saveToSlot } from '../src/state/saveManager';
import { GameUIController } from '../src/ui/windows';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);
const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
const baseState = createInitialGameState();
startGameWithCountry(baseState, turkey.id, worldCountries);

function createMockCanvas() {
  const texts: string[] = [];
  const strokeRects: Array<{ x: number; y: number; w: number; h: number; stroke: string }> = [];
  const fills: string[] = [];
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
    fillRect: () => {
      fills.push(String(mockObj.fillStyle));
    },
    strokeRect: (x: number, y: number, w: number, h: number) => {
      strokeRects.push({ x, y, w, h, stroke: String(mockObj.strokeStyle) });
    },
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    arc: () => {},
    setLineDash: () => {},
    fillText: (t: string) => {
      texts.push(t);
    },
    measureText: (t: string) => ({ width: t.length * 7 }),
  };
  return {
    ctx: mockObj as unknown as CanvasRenderingContext2D,
    texts,
    strokeRects,
    fills,
  };
}

class FakeElement {
  id = '';
  className = '';
  textContent = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  private _innerHTML = '';
  private registry: Map<string, FakeElement>;

  constructor(registry: Map<string, FakeElement>, id = '') {
    this.registry = registry;
    this.id = id;
    if (id) this.registry.set(id, this);
  }

  get innerHTML(): string {
    return this._innerHTML;
  }

  set innerHTML(val: string) {
    this._innerHTML = val;
    // Register any id="..." elements inside innerHTML so document.getElementById works!
    const idRegex = /\bid="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = idRegex.exec(val)) !== null) {
      const foundId = m[1];
      if (!this.registry.has(foundId)) {
        this.registry.set(foundId, new FakeElement(this.registry, foundId));
      }
    }
  }

  classList = {
    toggle: () => {},
  };

  addEventListener(): void {}
  querySelector(): null {
    return null;
  }
  querySelectorAll(): FakeElement[] {
    return [];
  }
  contains(): boolean {
    return false;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 120, height: 40 };
  }
}

function withMinimalDom<T>(fn: (root: HTMLDivElement, getById: (id: string) => FakeElement | undefined) => T): T {
  const registry = new Map<string, FakeElement>();
  const root = new FakeElement(registry, 'ui-layer');
  const prevWin = (globalThis as Record<string, unknown>).window;
  const prevDoc = (globalThis as Record<string, unknown>).document;

  (globalThis as Record<string, unknown>).window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener: () => {},
  };
  (globalThis as Record<string, unknown>).document = {
    body: {
      appendChild: () => {},
      contains: () => false,
    },
    createElement: () => new FakeElement(registry),
    getElementById: (id: string) => registry.get(id) ?? null,
    querySelectorAll: () => [],
  };

  try {
    return fn(root as unknown as HTMLDivElement, (id) => registry.get(id));
  } finally {
    (globalThis as Record<string, unknown>).window = prevWin;
    (globalThis as Record<string, unknown>).document = prevDoc;
  }
}

describe('v1.2 Aşama 4 — RTS Kontrolleri, Evrensel Highlight, Sade HUD (Mağaza), İkon/Ayırıcı Çizgili Popuplar, 2 Sayfalı Diplomasi & 3 Slotlu Save/Continue UI', () => {
  it('haritada box-select dikdörtgenini, bina/çoklu-ordu highlight çerçevelerini, Kışla eğitim barını, yaralı izini ve +X yüzen efektleri çizer', () => {
    const state = structuredClone(baseState);
    const pid = turkey.id;
    const p = state.countries[pid];
    p.money = 2000;
    p.weaponsStock.sword = 5;

    const regs = getCountryRegions(state, pid).filter((r) => !r.building);
    const barReg = regs[0];
    const hospReg = regs[1];
    startBuildingConstruction(state, pid, barReg.id, 'barracks');
    startBuildingConstruction(state, pid, hospReg.id, 'hospital');
    tickEconomyAndQueues(state, 8);

    // Kışlada eğitim başlat -> harita üzerinde yeşil ilerleme çubuğu çizilmeli
    queueBarracksTrainingBatch(state, pid, barReg.id, 3, { sword: 3 }, {});
    tickEconomyAndQueues(state, 0.2);

    // 2 dost orduyu kutu seçimiyle seç
    const a1 = spawnUnitsIntoCountryBarracks(state, pid, 'sword:wood', 5, regs[2].id)!;
    const a2 = spawnUnitsIntoCountryBarracks(state, pid, 'spear:bronze', 6, regs[3].id)!;
    selectArmiesInWorldBox(state, pid, -180, -90, 180, 90);
    expect(state.selectedArmyIds.length).toBe(2);

    // Bina highlight + Box-select + Yaralı sahada ve yolda + Yüzen dünya efekti
    state.activeBuildingRegionId = barReg.id;
    state.boxSelectRect = { x1: 120, y1: 140, x2: 340, y2: 290 };
    state.wounded.push(
      {
        id: 'w_wait',
        countryId: pid,
        units: { 'sword:wood': 2 },
        from: [a1.x, a1.y],
        toRegionId: '',
        to: [a1.x, a1.y],
        travelProgress: 0,
        healElapsedSec: 0,
        healRequiredSec: 8,
        waitingForHospital: true,
      },
      {
        id: 'w_walk',
        countryId: pid,
        units: { 'sword:wood': 3 },
        from: [a2.x, a2.y],
        toRegionId: hospReg.id,
        to: [hospReg.centroid[0], hospReg.centroid[1]],
        travelProgress: 0.4,
        healElapsedSec: 0,
        healRequiredSec: 8,
      },
    );
    pushFloatingEffect(state, {
      text: '+1000 💰',
      color: '#facc15',
      scope: 'world',
      x: barReg.centroid[0],
      y: barReg.centroid[1],
      durationMs: 2000,
    });

    const cam = new MapCamera();
    if (state.arena) cam.setBounds(state.arena, 1280, 720, true);
    cam.restoreView(barReg.centroid[0], barReg.centroid[1], 44);
    expect(cam.cx).toBeCloseTo(barReg.centroid[0], 2);
    expect(cam.scale).toBeCloseTo(44, 2);

    const rec = createMockCanvas();
    renderRegionalTheater(rec.ctx, state, cam, 1280, 720, 500);

    // Box-select dikdörtgeni (220x150) çizilmiş olmalı
    expect(rec.strokeRects.some((r) => r.w === 220 && r.h === 150 && r.stroke === '#facc15')).toBe(
      true,
    );
    // Kışla eğitim barı (#4ade80) ve yaralı bekleyen etiketi + +1000💰 yüzen efekt çizilmiş olmalı
    expect(rec.fills.includes('#4ade80')).toBe(true);
    expect(rec.texts.some((t) => t.includes('Hastane Bekliyor'))).toBe(true);
    expect(rec.texts.some((t) => t.includes('+1000 💰'))).toBe(true);
  });

  it('3 butonlu alt dock (Mağaza/Diplomasi/Harita), building_popup auto-pause, tüm ikon+ayırıcı çizgili bina popupları, 2 sayfalı Diplomasi ve 3 slotlu Save/Continue UI üretir', () => {
    withMinimalDom((root, getById) => {
      const state = structuredClone(baseState);
      const pid = turkey.id;
      const p = state.countries[pid];
      p.money = 3000;

      const emptyRegs = getCountryRegions(state, pid).filter((r) => !r.building);
      startBuildingConstruction(state, pid, emptyRegs[0].id, 'bank');
      startBuildingConstruction(state, pid, emptyRegs[1].id, 'factory');
      startBuildingConstruction(state, pid, emptyRegs[2].id, 'barracks');
      startBuildingConstruction(state, pid, emptyRegs[3].id, 'hospital');
      tickEconomyAndQueues(state, 8);
      takeBankLoan(state, pid, 500);
      queueFactoryParallelBatch(state, pid, emptyRegs[1].id, [
        { category: 'weapon', itemId: 'sword', count: 4 },
      ]);

      const ui = new GameUIController(
        root,
        state,
        new RetroMusicController(),
        new KeyBindingsManager(),
        {
          onStartWorldSelect: () => {},
          onReturnToWorld: () => {},
          onReturnToMainMenu: () => {},
          onSaveAndExitToMain: () => {},
          onSaveAndExitToWorld: () => {},
          onLoadSlotFromMenu: () => {},
          onCycleArmyFocus: () => {},
          onEnterBuildingPlacement: () => {},
          onCancelPlacementOrOrder: () => {},
        },
      );

      // 1. Playing HUD: 3 butonlu sade dock (🏪 Mağaza, 📜 Diplomasi, 🌍 Harita), 5sn gelir barı, borç rozeti, Canlı İşlem Şeridi
      ui.syncFrame();
      expect(root.innerHTML).toContain('🏪 Mağaza');
      expect(root.innerHTML).toContain('📜 Diplomasi');
      expect(root.innerHTML).toContain('🌍 Harita');
      expect(root.innerHTML).not.toContain('data-win="factory"'); // Alt menüde eski Fabrika/Kışla/Bilim yok!
      expect(getById('hud-debt-badge')?.textContent).toContain('575');
      expect(getById('live-ops-strip')?.innerHTML).toContain('×4');

      // 2. Mağaza Popup: piksel ikon + ayırıcı çizgi (.divided-item); mevcut Üniversite varken Üniversite listelenmez!
      ui.openWindow('shop', false);
      const modalHost = getById('modal-host')!;
      expect(modalHost.innerHTML).toContain('🏪 Mağaza');
      expect(modalHost.innerHTML).toContain('divided-item');
      expect(modalHost.innerHTML).toContain('data:image/svg+xml;utf8,');
      expect(modalHost.innerHTML).not.toContain('data-shop-type="university"');

      // 3. Bina Popup + Auto-Pause ('building_popup') + Banka 500/1000/10000 + Kırmızı Binayı Yık
      expect(isAutoPaused(state)).toBe(false);
      ui.openBuildingPopupForRegion(emptyRegs[0].id); // Banka
      expect(ui.activeWindow).toBe('bank');
      expect(isAutoPaused(state)).toBe(true);
      expect(modalHost.innerHTML).toContain('btn-loan-500');
      expect(modalHost.innerHTML).toContain('btn-loan-1000');
      expect(modalHost.innerHTML).toContain('btn-loan-10000');
      expect(modalHost.innerHTML).toContain('btn-demolish-building');

      // 4. İkonlu Paralel Fabrika (isim yazmaz, ayrı loading bar'lar + toplam maliyet vardır)
      ui.openBuildingPopupForRegion(emptyRegs[1].id);
      expect(ui.activeWindow).toBe('factory');
      expect(modalHost.innerHTML).toContain('factory-total-cost');
      expect(modalHost.innerHTML).toContain('data-fac-line="weapon:sword"');
      expect(modalHost.innerHTML).toContain('btn-factory-start');

      // 5. İkonlu Kışla (MAX butonu + +1/+5/+10/MAX ekipman butonları)
      ui.openBuildingPopupForRegion(emptyRegs[2].id);
      expect(ui.activeWindow).toBe('barracks');
      expect(modalHost.innerHTML).toContain('btn-barracks-max-soldiers');
      expect(modalHost.innerHTML).toContain('data-bar-bump="5"');

      // Popup kapatılınca auto-pause kalkar
      ui.openWindow(null, false);
      expect(isAutoPaused(state)).toBe(false);

      // 6. 2 Sayfalı 7 Aksiyonlu Diplomasi
      ui.openWindow('diplomacy', false);
      expect(ui.diplomacyPageCountryId).toBeNull();
      expect(modalHost.innerHTML).toContain('Sayfa 1/2');
      expect(modalHost.innerHTML).toContain('dip-country-card');

      const otherId = Object.keys(state.countries).find((id) => id !== pid)!;
      ui.diplomacyPageCountryId = otherId;
      ui.renderModal();
      expect(modalHost.innerHTML).toContain('Sayfa 2/2');
      expect(modalHost.innerHTML).toContain('btn-dip-back');
      expect(modalHost.innerHTML).toContain('btn-dip-war');
      expect(modalHost.innerHTML).toContain('btn-dip-ally');
      expect(modalHost.innerHTML).toContain('btn-dip-break-ally');
      expect(modalHost.innerHTML).toContain('btn-dip-peace');
      expect(modalHost.innerHTML).toContain('btn-dip-gift');
      expect(modalHost.innerHTML).toContain('btn-dip-nap');
      expect(modalHost.innerHTML).toContain('btn-dip-trade');

      // 7. 3 Slotlu Kaydet & Çık + Ana Ekran Continue
      saveToSlot(1, state, { cx: 30, cy: 38, scale: 40 });
      ui.openWindow('save_exit', false);
      expect(isAutoPaused(state)).toBe(true);
      expect(modalHost.innerHTML).toContain('Slot 1 — ★ Turkey');
      expect(modalHost.innerHTML).toContain('Slot 2 — Boş Slot');
      expect(modalHost.innerHTML).toContain('Slot 3 — Boş Slot');
      ui.openWindow(null, false);

      state.phase = 'main_menu';
      ui.continueModalOpen = true;
      ui.forceRefresh();
      expect(root.innerHTML).toContain('btn-main-continue');
      expect(root.innerHTML).toContain('Slot 1 — ★ Turkey');
      expect(root.innerHTML).toContain('data-load-slot="1"');
      deleteSlot(1);
    });
  });
});
