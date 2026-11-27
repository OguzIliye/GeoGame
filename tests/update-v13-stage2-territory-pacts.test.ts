import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import { RetroMusicController } from '../src/audio/music';
import { KeyBindingsManager } from '../src/config/keybindings';
import { parseWorldTopology } from '../src/map/worldLoader';
import {
  getTotalSoldiers,
  orderArmyAttackEnemyArmy,
  orderArmyMoveToRegion,
  pickArmyAtPoint,
  splitArmyByCount,
  tickArmiesCombatAndShips,
} from '../src/sim/army';
import { isAutoPaused, isEffectivelyPaused } from '../src/sim/calendar';
import {
  breakAlliance,
  canArmyEnterCountryTerritory,
  declareWar,
  hasTransitPact,
  proposeAlliance,
  proposeNonAggressionPact,
  proposePeace,
} from '../src/sim/diplomacy';
import { getCountryRegions, spawnUnitsIntoCountryBarracks } from '../src/sim/economy';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';
import { GameUIController } from '../src/ui/windows';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);
const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
const baseState = createInitialGameState();
startGameWithCountry(baseState, turkey.id, worldCountries);

describe('Sadece Savaş/Müttefik Toprak Geçişi, İttifak Sonrası Geri Dönüş, Belli Miktar Bölme & AI Savaş İlanı Popup', () => {
  it('yalnızca savaşta veya müttefikken yabancı toprağa girişe izin verir; nötr, barış ve saldırmazlık paktında girişi engeller', () => {
    const state = structuredClone(baseState);
    const pid = turkey.id;
    const myRegs = getCountryRegions(state, pid);

    let neighborId = '';
    let neighborRegId = '';
    for (const r of myRegs) {
      for (const nbId of r.neighbors) {
        const nb = state.regions[nbId];
        if (nb && nb.ownerId !== pid) {
          neighborId = nb.ownerId;
          neighborRegId = nb.id;
          break;
        }
      }
      if (neighborId) break;
    }
    expect(neighborId).not.toBe('');

    const myArmy = spawnUnitsIntoCountryBarracks(state, pid, 'sword:wood', 10)!;

    // 1. Nötr ülkeye giriş yasak!
    expect(canArmyEnterCountryTerritory(state, pid, neighborId)).toBe(false);
    expect(orderArmyMoveToRegion(state, myArmy.id, neighborRegId).ok).toBe(false);

    // 2. Saldırmazlık Paktı geçiş hakkı VERMEZ!
    expect(proposeNonAggressionPact(state, pid, neighborId, true).accepted).toBe(true);
    expect(hasTransitPact(state, pid, neighborId)).toBe(false);
    expect(canArmyEnterCountryTerritory(state, pid, neighborId)).toBe(false);
    expect(orderArmyMoveToRegion(state, myArmy.id, neighborRegId).ok).toBe(false);
    state.simDaysElapsed += 400;

    // 3. İttifak -> geçiş izni verir, ancak müttefik toprağı fethedilemez!
    expect(proposeAlliance(state, pid, neighborId, true).accepted).toBe(true);
    expect(hasTransitPact(state, pid, neighborId)).toBe(true);
    expect(canArmyEnterCountryTerritory(state, pid, neighborId)).toBe(true);
    expect(orderArmyMoveToRegion(state, myArmy.id, neighborRegId).ok).toBe(true);

    myArmy.x = state.regions[neighborRegId].centroid[0];
    myArmy.y = state.regions[neighborRegId].centroid[1];
    myArmy.currentRegionId = neighborRegId;
    myArmy.targetX = null;
    myArmy.targetY = null;
    myArmy.waypoints = [];
    tickArmiesCombatAndShips(state, 5);
    expect(state.regions[neighborRegId].ownerId).toBe(neighborId);
    expect(state.regions[neighborRegId].capture).toBeNull();

    // 4. İttifak bozulduğunda müttefik toprağındaki ordu otomatik olarak en yakın kendi toprağına döner!
    expect(breakAlliance(state, pid, neighborId).ok).toBe(true);
    expect(canArmyEnterCountryTerritory(state, pid, neighborId)).toBe(false);
    expect(myArmy.evacuatingHome).toBe(true);
    expect(myArmy.targetRegionId).not.toBeNull();
    expect(state.regions[myArmy.targetRegionId!]?.ownerId).toBe(pid);

    for (let i = 0; i < 40; i++) {
      tickArmiesCombatAndShips(state, 1);
      if (myArmy.targetX === null) break;
    }
    expect(state.regions[myArmy.currentRegionId]?.ownerId).toBe(pid);
    expect(myArmy.evacuatingHome).toBe(false);

    // 5. Müttefik toprağındayken savaşa girilirse hemen ele geçirme ve savaş başlar; Barışta geçiş tekrar kapanır!
    expect(proposeAlliance(state, pid, neighborId, true).accepted).toBe(true);
    myArmy.x = state.regions[neighborRegId].centroid[0];
    myArmy.y = state.regions[neighborRegId].centroid[1];
    myArmy.currentRegionId = neighborRegId;
    myArmy.targetX = null;
    myArmy.targetY = null;
    expect(declareWar(state, pid, neighborId).ok).toBe(true);
    tickArmiesCombatAndShips(state, 1);
    expect(state.regions[neighborRegId].capture?.attackerCountryId).toBe(pid);

    expect(proposePeace(state, pid, neighborId, true).accepted).toBe(true);
    expect(hasTransitPact(state, pid, neighborId)).toBe(false);
    expect(canArmyEnterCountryTerritory(state, pid, neighborId)).toBe(false);
    expect(myArmy.evacuatingHome).toBe(true);

    // 6. Deniz üzerinden yürüme engeli: kara bağlantısı olmayan (veya arada nötr ülke/deniz olan) bölgeye yürüyerek gidilemez!
    const isolatedSeaReg = Object.values(state.regions).find((r) => {
      if (r.ownerId === pid) return false;
      // Hedef ülkeyle savaşta olsak bile karadan geçilebilir komşu zinciri olmayan bir bölge bul (örn. Mısır/İtalya/Kırım)
      return !r.neighbors.some((nb) => state.regions[nb]?.ownerId === pid);
    });
    if (isolatedSeaReg) {
      // Tüm komşularını geçici kopararak saf ada / deniz aşırı bölge simüle et
      const savedNeighbors = [...isolatedSeaReg.neighbors];
      isolatedSeaReg.neighbors = [];
      for (const nbId of savedNeighbors) {
        if (state.regions[nbId]) {
          state.regions[nbId].neighbors = state.regions[nbId].neighbors.filter(
            (x) => x !== isolatedSeaReg.id,
          );
        }
      }
      declareWar(state, pid, isolatedSeaReg.ownerId);
      const landArmy = spawnUnitsIntoCountryBarracks(state, pid, 'sword:wood', 8)!;
      const seaMove = orderArmyMoveToRegion(state, landArmy.id, isolatedSeaReg.id);
      expect(seaMove.ok).toBe(false);

      // Zorla denize doğru hedef verilse bile step-guard denize adım atmasını anında durdurur!
      landArmy.x = -170;
      landArmy.y = -80;
      landArmy.targetX = -165;
      landArmy.targetY = -75;
      landArmy.waypoints = [[-165, -75]];
      tickArmiesCombatAndShips(state, 0.5);
      expect(landArmy.targetX).toBeNull();
    }
  });

  it('müttefik ülke askerleriyle hiçbir şekilde savaşa, encounter a veya tıklama hedeflemesine girmez; belli miktar ayırma ve AI savaş popup çalışır', () => {
    const state = structuredClone(baseState);
    const pid = turkey.id;
    const allyId = Object.keys(state.countries).find((id) => id !== pid)!;
    const enemyAiId = Object.keys(state.countries).find((id) => id !== pid && id !== allyId)!;

    proposeAlliance(state, pid, allyId, true);

    const myReg = getCountryRegions(state, pid)[0];
    const myArmy = spawnUnitsIntoCountryBarracks(state, pid, 'sword:wood', 12, myReg.id)!;
    const allyArmy = spawnUnitsIntoCountryBarracks(state, allyId, 'spear:wood', 10)!;

    // Belli miktar ayırma (splitArmyByCount): 12 askerden 5 asker ayır -> 7 + 5
    const splitRes = splitArmyByCount(state, myArmy.id, 5);
    expect(splitRes.ok).toBe(true);
    expect(getTotalSoldiers(myArmy.units)).toBe(7);
    expect(getTotalSoldiers(splitRes.newArmy!.units)).toBe(5);

    // Müttefik ordu üst üste dururken ne Encounter açılır ne de çatışma başlar!
    allyArmy.x = myArmy.x;
    allyArmy.y = myArmy.y;
    allyArmy.currentRegionId = myReg.id;
    tickArmiesCombatAndShips(state, 1.0);
    expect(state.activeEncounter).toBeNull();
    expect(myArmy.inCombatWithArmyId).toBeNull();
    expect(allyArmy.inCombatWithArmyId).toBeNull();
    expect(pickArmyAtPoint(state, [allyArmy.x, allyArmy.y], 0.65, pid)?.id).toBe(myArmy.id);
    expect(orderArmyAttackEnemyArmy(state, myArmy.id, allyArmy.id).ok).toBe(false);

    // AI oyuncuya savaş ilan ettiğinde oyunu durdurur (speed=0 & war_alert) ve Savaş İlanı popup'ı çıkarır!
    expect(state.speed).toBe(1);
    expect(declareWar(state, enemyAiId, pid).ok).toBe(true);
    expect(state.speed).toBe(0);
    expect(isAutoPaused(state)).toBe(true);
    expect(isEffectivelyPaused(state)).toBe(true);
    expect(state.warAlertQueue).toContain(enemyAiId);

    // UI war-alert-host kontrolü
    const warHost = { id: 'war-alert-host', innerHTML: '', querySelector: () => null };
    const root = {
      id: 'ui-layer',
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: () => [],
      contains: () => false,
    };
    const prevWin = (globalThis as Record<string, unknown>).window;
    const prevDoc = (globalThis as Record<string, unknown>).document;
    (globalThis as Record<string, unknown>).window = {
      innerWidth: 1280,
      innerHeight: 720,
      addEventListener: () => {},
    };
    (globalThis as Record<string, unknown>).document = {
      body: { appendChild: () => {}, contains: () => false },
      createElement: () => ({ id: '', className: '', style: {} }),
      getElementById: (id: string) => (id === 'war-alert-host' ? warHost : null),
      querySelectorAll: () => [],
    };
    try {
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
          onEnterBuildingPlacement: () => {},
          onCancelPlacementOrOrder: () => {},
        },
      );
      ui.syncFrame();
      expect(warHost.innerHTML).toContain('Savaş İlanı');
      expect(warHost.innerHTML).toContain(state.countries[enemyAiId].name);
      expect(warHost.innerHTML).toContain('btn-war-alert-ok');
    } finally {
      (globalThis as Record<string, unknown>).window = prevWin;
      (globalThis as Record<string, unknown>).document = prevDoc;
    }
  });
});
