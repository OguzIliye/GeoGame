import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import { parseWorldTopology } from '../src/map/worldLoader';
import {
  getMaxTierVisualsForUnits,
  getTotalSoldiers,
  mergeArmies,
  orderArmyAttackEnemyArmy,
  orderArmyEmbarkShip,
  orderArmyMoveToRegion,
  orderShipSailToCoastalRegion,
  splitArmyStack,
  tickArmiesCombatAndShips,
} from '../src/sim/army';
import { declareWar } from '../src/sim/diplomacy';
import {
  ensurePortShipForRegion,
  getCountryRegions,
  spawnUnitsIntoCountryBarracks,
} from '../src/sim/economy';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);

describe('Faz 3 — Ordu Kümeleri, Savaş, Hastane & Liman', () => {
  it('tür bazlı zorunlu ayırma (split), yakın küme birleştirme (merge) ve maks. seviye görsel düşüş kuralını uygular', () => {
    const state = createInitialGameState();
    const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
    startGameWithCountry(state, turkey.id, worldCountries);
    const pid = turkey.id;

    const stack = spawnUnitsIntoCountryBarracks(state, pid, 'sword:wood', 10)!;
    stack.units['bazooka:forcefield'] = 1;

    // 1 bazukalı bile varsa maks. seviye bazuka + forcefield döner
    expect(getMaxTierVisualsForUnits(stack.units)).toEqual({
      weapon: 'bazooka',
      shield: 'forcefield',
    });

    // Eksik tür belirtilirse ayırmayı reddeder ("her tür asker için ayrı bir ayırma sayısı belirtmek şart")
    expect(splitArmyStack(state, stack.id, { 'sword:wood': 4 }).ok).toBe(false);

    // Tüm mevcut türler için sayı verildiğinde ayırır
    const splitRes = splitArmyStack(state, stack.id, {
      'sword:wood': 4,
      'bazooka:forcefield': 1,
    });
    expect(splitRes.ok).toBe(true);
    expect(stack.units['bazooka:forcefield']).toBeUndefined();
    // Bazukalılar ayrılınca/bitince ana küme otomatik bir alt seviyeye (sword + wood) düşer!
    expect(getMaxTierVisualsForUnits(stack.units)).toEqual({
      weapon: 'sword',
      shield: 'wood',
    });

    // Yakın kümeleri tekrar tek kümede birleştirir
    const mergeRes = mergeArmies(state, stack.id, splitRes.newArmy!.id);
    expect(mergeRes.ok).toBe(true);
    expect(getTotalSoldiers(stack.units)).toBe(11);
  });

  it('nötr ülkeye yanlış saldırıyı engeller; savaş ilanından sonra bölgeyi süreyle ele geçirip içindeki binayı yıkar', () => {
    const state = createInitialGameState();
    const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
    startGameWithCountry(state, turkey.id, worldCountries);
    const pid = turkey.id;

    const enemyId = Object.keys(state.countries).find((id) => id !== pid)!;
    const enemyRegions = getCountryRegions(state, enemyId);
    const targetReg = enemyRegions.find((r) => r.building !== null) ?? enemyRegions[0];
    targetReg.building = {
      type: 'factory',
      level: 1,
      constructing: false,
      progressSec: 0,
      totalSec: 0,
    };

    const army = spawnUnitsIntoCountryBarracks(state, pid, 'ak:steel', 20)!;

    // Savaş ilan edilmeden nötr toprağa girilemez
    expect(orderArmyMoveToRegion(state, army.id, targetReg.id).ok).toBe(false);

    // Savaş ilan et -> yürü ve süreyle ele geçir
    expect(declareWar(state, pid, enemyId).ok).toBe(true);
    army.x = targetReg.centroid[0];
    army.y = targetReg.centroid[1];
    army.currentRegionId = targetReg.id;

    tickArmiesCombatAndShips(state, 3);
    expect(targetReg.capture).not.toBeNull();
    expect(targetReg.ownerId).toBe(enemyId);

    tickArmiesCombatAndShips(state, 8);
    expect(targetReg.ownerId).toBe(pid);
    // Bölge düşünce içindeki bina yıkılmış olmalı
    expect(targetReg.building).toBeNull();
  });

  it('zaman içinde savaşı yürütür ve düşenlerin %30 unu Hastaneye gönderip 8 sn sonra eski birlik türüyle döndürür', () => {
    const state = createInitialGameState();
    const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
    startGameWithCountry(state, turkey.id, worldCountries);
    const pid = turkey.id;
    const enemyId = Object.keys(state.countries).find((id) => id !== pid)!;

    // Oyuncuya ayakta bir Hastane ver, düşmanın tüm hastanelerini sil
    const playerRegs = getCountryRegions(state, pid);
    const hospReg = playerRegs.find((r) => !r.building)!;
    hospReg.building = {
      type: 'hospital',
      level: 1,
      constructing: false,
      progressSec: 0,
      totalSec: 0,
    };
    for (const r of getCountryRegions(state, enemyId)) {
      if (r.building?.type === 'hospital' || r.building?.type === 'combined') {
        r.building = null;
      }
    }

    declareWar(state, pid, enemyId);

    const myArmy = spawnUnitsIntoCountryBarracks(state, pid, 'pistol:diamond', 30)!;
    const foeArmy = spawnUnitsIntoCountryBarracks(state, enemyId, 'sword:wood', 25)!;
    // Aynı noktada karşılaştır
    foeArmy.x = myArmy.x + 0.1;
    foeArmy.y = myArmy.y + 0.1;
    orderArmyAttackEnemyArmy(state, myArmy.id, foeArmy.id);

    // Birkaç savaş tick'i çalıştır -> oyuncunun yaralıları hastaneye gitmeli, hastanesi olmayan düşmanınki gitmemeli
    for (let i = 0; i < 12; i++) {
      tickArmiesCombatAndShips(state, 0.5);
    }

    expect(state.wounded.some((w) => w.countryId === enemyId)).toBe(false);
    const playerWounded = state.wounded.filter((w) => w.countryId === pid);
    expect(playerWounded.length).toBeGreaterThan(0);
    expect(playerWounded[0].units['pistol:diamond']).toBeGreaterThan(0);

    // Yürüyüş + 8 sn hastane iyileşme süresi sonunda eski birlik türü ('pistol:diamond') olarak döner
    for (let i = 0; i < 25; i++) {
      tickArmiesCombatAndShips(state, 1);
    }
    expect(state.wounded.filter((w) => w.countryId === pid).length).toBe(0);
    const hospStacks = Object.values(state.armies).filter(
      (a) => a.countryId === pid && a.currentRegionId === hospReg.id,
    );
    expect(hospStacks.some((a) => (a.units['pistol:diamond'] ?? 0) > 0)).toBe(true);
  });

  it('Liman gemisiyle sınırsız kapasiteli asker bindirme, denizden seyir ve hedef kıyıya çıkartma yapar', () => {
    const state = createInitialGameState();
    const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
    startGameWithCountry(state, turkey.id, worldCountries);
    const pid = turkey.id;

    const coastalRegs = getCountryRegions(state, pid).filter((r) => r.isCoastal && r.coastalAnchor);
    expect(coastalRegs.length).toBeGreaterThanOrEqual(2);
    const portReg = coastalRegs[0];
    const destCoastReg = coastalRegs[1];

    portReg.building = {
      type: 'port',
      level: 1,
      constructing: false,
      progressSec: 0,
      totalSec: 0,
    };
    const ship = ensurePortShipForRegion(state, portReg)!;
    expect(ship).toBeDefined();

    // 250 kişilik büyük ordu -> sınırsız kapasiteyle gemiye biner ("önce askere sonra gemiye")
    const army = spawnUnitsIntoCountryBarracks(state, pid, 'ak:steel', 250)!;
    army.x = ship.x + 0.2;
    army.y = ship.y + 0.2;
    expect(orderArmyEmbarkShip(state, army.id, ship.id).ok).toBe(true);

    tickArmiesCombatAndShips(state, 2);
    expect(state.armies[army.id]).toBeUndefined();
    expect(getTotalSoldiers(ship.units)).toBe(250);

    // Gemi hedef kıyıya doğru yola çıkar -> zamanla ulaşır -> askerler karada belirir
    expect(orderShipSailToCoastalRegion(state, ship.id, destCoastReg.id).ok).toBe(true);
    for (let i = 0; i < 30; i++) {
      tickArmiesCombatAndShips(state, 1);
    }

    expect(getTotalSoldiers(ship.units)).toBe(0);
    const landedArmy = Object.values(state.armies).find(
      (a) => a.countryId === pid && a.currentRegionId === destCoastReg.id,
    );
    expect(landedArmy).toBeDefined();
    expect(landedArmy!.units['ak:steel']).toBe(250);
  });
});
