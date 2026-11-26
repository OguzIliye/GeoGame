import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import { RetroMusicController } from '../src/audio/music';
import { KeyBindingsManager } from '../src/config/keybindings';
import { parseWorldTopology } from '../src/map/worldLoader';
import { MapCamera } from '../src/render/camera';
import {
  getTotalSoldiers,
  orderArmiesMerge,
  orderArmyAttackEnemyArmy,
  orderArmyMoveToRegion,
  selectSingleArmy,
  splitArmyHalf,
  tickArmiesCombatAndShips,
} from '../src/sim/army';
import { isAutoPaused } from '../src/sim/calendar';
import { declareWar } from '../src/sim/diplomacy';
import {
  getCountryRegions,
  queueBarracksTrainingBatch,
  queueFactoryParallelBatch,
  startBuildingConstruction,
  takeBankLoan,
  tickEconomyAndQueues,
} from '../src/sim/economy';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';
import {
  SPOTLIGHT_RADIUS_PX,
  SpotlightTutorialController,
} from '../src/ui/spotlightTutorial';
import { GameUIController } from '../src/ui/windows';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);
const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
const baseState = createInitialGameState();
startGameWithCountry(baseState, turkey.id, worldCountries);

class FakeDomElement {
  id = '';
  className = '';
  textContent = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  private _innerHTML = '';
  private registry: Map<string, FakeDomElement>;

  constructor(registry: Map<string, FakeDomElement>, id = '') {
    this.registry = registry;
    this.id = id;
    if (id) this.registry.set(id, this);
  }

  get innerHTML(): string {
    return this._innerHTML;
  }

  set innerHTML(val: string) {
    this._innerHTML = val;
    const idRegex = /\bid="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = idRegex.exec(val)) !== null) {
      const foundId = m[1];
      if (!this.registry.has(foundId)) {
        this.registry.set(foundId, new FakeDomElement(this.registry, foundId));
      }
    }
  }

  classList = {
    toggle: () => {},
    remove: () => {},
    add: () => {},
  };

  setAttribute(): void {}
  addEventListener(): void {}
  querySelector(): null {
    return null;
  }
  querySelectorAll(): FakeDomElement[] {
    return [];
  }
  contains(): boolean {
    return false;
  }
  getBoundingClientRect() {
    return { left: 200, top: 200, width: 140, height: 42 };
  }
}

describe('v1.2 Aşama 5 — 11 Adımlı 20 px SVG Spotlight Tutorial, Banka Borç, Kontrollü Rakip & Hastane Yaralı Geri Dönüş Akışı', () => {
  it('20 px yarıçaplı SVG maskeli spotlight motorunu, ✕ kapatma kilidini, yanlış tıklama flaşını ve tüm 11 adımı uçtan uca yürütür', () => {
    const registry = new Map<string, FakeDomElement>();
    const root = new FakeDomElement(registry, 'ui-layer');
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
      createElement: () => new FakeDomElement(registry),
      getElementById: (id: string) => registry.get(id) ?? null,
      querySelector: () => null,
      querySelectorAll: () => [],
    };

    try {
      const state = structuredClone(baseState);
      const pid = turkey.id;
      const p = state.countries[pid];
      const cam = new MapCamera();
      if (state.arena) cam.setBounds(state.arena, 1280, 720, true);

      const ui = new GameUIController(
        root as unknown as HTMLDivElement,
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
          onEnterBuildingPlacement: (bt) => {
            state.placingBuildingType = bt;
            ui.openWindow(null, false);
          },
          onCancelPlacementOrOrder: () => {},
        },
      );
      ui.syncFrame();

      expect(SPOTLIGHT_RADIUS_PX).toBe(20);
      const tutorial = new SpotlightTutorialController(state, cam, ui, {
        onFinishFreshRestart: () => {},
        onFinishKeepPlaying: () => {},
      });

      // Adım 1/11: Kısa Amaç + 20px SVG maskeli spotlight + auto-pause
      tutorial.start();
      expect(tutorial.isActive).toBe(true);
      expect(tutorial.stage).toBe('1_goal');
      expect(isAutoPaused(state)).toBe(true);
      const spotHost = registry.get('spotlight-host')!;
      expect(spotHost.innerHTML).toContain('id="tut-spot-mask"');
      expect(spotHost.innerHTML).toContain('r="20"');
      expect(spotHost.innerHTML).toContain('Adım 1 / 11');

      // Yanlış tıklama flaş geri bildirimi
      tutorial.triggerWrongClickFlash();
      expect(tutorial.wrongFlashCount).toBe(1);

      // Adım 2A: Mağaza -> Banka (100💰) -> Haritaya kur -> Canlı görev rozeti ile inşa
      (tutorial as unknown as { setStage: (s: string) => void }).setStage('2a_open_shop');
      ui.openWindow('shop', false);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('2a_pick_bank');
      expect(ui.closeButtonLockedByTutorial).toBe(true);
      // Kilitliyken ✕ ile kapatma engellenir!
      ui.openWindow(null, false);
      expect(ui.activeWindow).toBe('shop');

      state.placingBuildingType = 'bank';
      ui.closeButtonLockedByTutorial = false;
      ui.openWindow(null, false);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('2a_place_bank');

      const emptyRegs = getCountryRegions(state, pid).filter((r) => !r.building);
      const bankReg = emptyRegs[0];
      expect(startBuildingConstruction(state, pid, bankReg.id, 'bank').ok).toBe(true);
      state.placingBuildingType = null;
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('2a_wait_bank');
      expect(isAutoPaused(state)).toBe(false); // Bekleme aşamasında gri maske kalkar, oyun akar!
      expect(spotHost.innerHTML).toContain('tut-live-task-badge');

      tickEconomyAndQueues(state, 2.5, 3); // 3x hızda 6sn'lik Banka biter!
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('2b_click_bank');

      // Adım 2B: Bankaya tıkla -> +500💰 Borç Al
      ui.openBuildingPopupForRegion(bankReg.id);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('2b_take_loan');
      expect(takeBankLoan(state, pid, 500).ok).toBe(true);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('3_open_shop');

      // Adım 3: Fabrika kur & paralel silah+kalkan üret
      ui.openWindow('shop', false);
      tutorial.syncFrame();
      state.placingBuildingType = 'factory';
      ui.closeButtonLockedByTutorial = false;
      ui.openWindow(null, false);
      tutorial.syncFrame();
      const facReg = emptyRegs[1];
      expect(startBuildingConstruction(state, pid, facReg.id, 'factory').ok).toBe(true);
      state.placingBuildingType = null;
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('3_wait_factory');
      tickEconomyAndQueues(state, 3, 3);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('3_click_factory');

      ui.openBuildingPopupForRegion(facReg.id);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('3_order_equip');
      expect(
        queueFactoryParallelBatch(state, pid, facReg.id, [
          { category: 'weapon', itemId: 'sword', count: 6 },
          { category: 'shield', itemId: 'wood', count: 6 },
        ]).ok,
      ).toBe(true);
      tutorial.syncFrame();
      expect(ui.closeButtonLockedByTutorial).toBe(false);
      ui.openWindow(null, false);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('3_wait_equip');
      tickEconomyAndQueues(state, 5, 3);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('4_open_shop');

      // Adım 4: Kışla kur & 6 asker yetiştir
      ui.openWindow('shop', false);
      tutorial.syncFrame();
      state.placingBuildingType = 'barracks';
      ui.closeButtonLockedByTutorial = false;
      ui.openWindow(null, false);
      tutorial.syncFrame();
      const barReg = emptyRegs[2];
      expect(startBuildingConstruction(state, pid, barReg.id, 'barracks').ok).toBe(true);
      state.placingBuildingType = null;
      tutorial.syncFrame();
      tickEconomyAndQueues(state, 3, 3);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('4_click_barracks');

      ui.openBuildingPopupForRegion(barReg.id);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('4_train_soldiers');
      expect(
        queueBarracksTrainingBatch(state, pid, barReg.id, 6, { sword: 6 }, { wood: 6 }).ok,
      ).toBe(true);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('4_wait_soldiers');
      tickEconomyAndQueues(state, 2, 3);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('5_click_army');

      // Adım 5: Orduyu sınır bölgesine yönlendir
      const myArmy = Object.values(state.armies).find((a) => a.countryId === pid)!;
      selectSingleArmy(state, myArmy.id);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('5_move_border');
      const borderRegId = tutorial.playerBorderRegionId ?? emptyRegs[3].id;
      expect(orderArmyMoveToRegion(state, myArmy.id, borderRegId).ok).toBe(true);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('5_wait_march');
      for (let i = 0; i < 30; i++) tickArmiesCombatAndShips(state, 1, 3);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('6_click_army');

      // Adım 6: 50/50 Böl & Tekrar Birleştir
      selectSingleArmy(state, myArmy.id);
      ui.openWindow('army', false);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('6_split_half');
      const sp = splitArmyHalf(state, myArmy.id);
      expect(sp.ok).toBe(true);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('6_merge_armies');
      expect(orderArmiesMerge(state, [myArmy.id, sp.newArmy!.id]).ok).toBe(true);
      for (let i = 0; i < 10; i++) tickArmiesCombatAndShips(state, 0.5, 3);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('7_open_diplomacy');

      // Adım 7: 2 Sayfalı Diplomasi -> Savaş İlan Et -> Kontrollü öncü birlik doğar!
      ui.openWindow('diplomacy', false);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('7_pick_rival');
      const rivalId = tutorial.rivalCountryId!;
      ui.diplomacyPageCountryId = rivalId;
      ui.renderModal();
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('7_declare_war');
      expect(declareWar(state, pid, rivalId).ok).toBe(true);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('8a_click_army');
      expect(tutorial.vanguardArmyId).not.toBeNull();

      // Adım 8A: Alan Savunması -> öncü yenilir ve sahada 🩹 Yaralı — Hastane Bekliyor oluşur!
      const mergedArmy = Object.values(state.armies).find((a) => a.countryId === pid)!;
      selectSingleArmy(state, mergedArmy.id);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('8a_intercept');
      orderArmyAttackEnemyArmy(state, mergedArmy.id, tutorial.vanguardArmyId!);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('8a_wait_defense');
      for (let i = 0; i < 30; i++) {
        tickArmiesCombatAndShips(state, 0.5, 3);
        tutorial.syncFrame();
      }
      expect(tutorial.stage).toBe('8b_click_army');
      expect(state.wounded.some((w) => w.countryId === pid && w.waitingForHospital)).toBe(true);

      // Adım 8B: Karşı Saldırı -> bölge fethi ve +1.000💰 ganimet!
      const atkArmy = Object.values(state.armies).find((a) => a.countryId === pid)!;
      selectSingleArmy(state, atkArmy.id);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('8b_attack_region');
      const targetRivalRegId = tutorial.rivalBorderRegionId!;
      expect(orderArmyMoveToRegion(state, atkArmy.id, targetRivalRegId).ok).toBe(true);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('8b_wait_capture');
      const cashBeforeCap = p.money;
      for (let i = 0; i < 40; i++) {
        tickArmiesCombatAndShips(state, 1, 3);
        tutorial.syncFrame();
        if (tutorial.stage === '9_open_shop') break;
      }
      expect(tutorial.stage).toBe('9_open_shop');
      expect(p.money).toBeGreaterThanOrEqual(cashBeforeCap + 1000);

      // Adım 9: Hastane kur -> sahada bekleyen 🩹 Yaralı askerler yeni Hastaneye koşup iyileşerek orduya döner!
      ui.openWindow('shop', false);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('9_pick_hospital');
      state.placingBuildingType = 'hospital';
      ui.closeButtonLockedByTutorial = false;
      ui.openWindow(null, false);
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('9_place_hospital');

      const hospReg = getCountryRegions(state, pid).find((r) => !r.building)!;
      const soldiersBeforeHeal = Object.values(state.armies)
        .filter((a) => a.countryId === pid)
        .reduce((s, a) => s + getTotalSoldiers(a.units), 0);
      expect(startBuildingConstruction(state, pid, hospReg.id, 'hospital').ok).toBe(true);
      state.placingBuildingType = null;
      tutorial.syncFrame();
      expect(tutorial.stage).toBe('9_wait_rescue');

      for (let i = 0; i < 35; i++) {
        tickEconomyAndQueues(state, 0.5, 3);
        tickArmiesCombatAndShips(state, 0.5, 3);
        tutorial.syncFrame();
        if (tutorial.stage === '10_final') break;
      }

      // Adım 10 (11/11): Yaralılar iyileşip orduya döndü ve 2 seçenekli final ekranı açıldı!
      expect(tutorial.stage).toBe('10_final');
      const soldiersAfterHeal = Object.values(state.armies)
        .filter((a) => a.countryId === pid)
        .reduce((s, a) => s + getTotalSoldiers(a.units), 0);
      expect(soldiersAfterHeal).toBeGreaterThan(soldiersBeforeHeal);
      expect(spotHost.innerHTML).toContain('btn-tut-finish-fresh');
      expect(spotHost.innerHTML).toContain('btn-tut-finish-keep');
    } finally {
      (globalThis as Record<string, unknown>).window = prevWin;
      (globalThis as Record<string, unknown>).document = prevDoc;
    }
  });
});
