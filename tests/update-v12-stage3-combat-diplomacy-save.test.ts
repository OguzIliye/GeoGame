import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import { KeyBindingsManager } from '../src/config/keybindings';
import { parseWorldTopology } from '../src/map/worldLoader';
import {
  getTotalSoldiers,
  orderArmiesMerge,
  orderArmyAttackEnemyArmy,
  orderMultipleArmiesMoveToRegion,
  retreatFromCombat,
  selectArmiesInWorldBox,
  splitArmyHalf,
  tickArmiesCombatAndShips,
} from '../src/sim/army';
import {
  breakAlliance,
  declareWar,
  getDiplomacyEdge,
  getRelationStatus,
  proposeAlliance,
  proposeNonAggressionPact,
  proposePeace,
  proposeTradeAgreement,
  sendDiplomaticGift,
} from '../src/sim/diplomacy';
import {
  getCountryGrossIncomePerTick,
  getCountryRegions,
  queueFactoryParallelBatch,
  spawnUnitsIntoCountryBarracks,
  startBuildingConstruction,
  takeBankLoan,
  tickEconomyAndQueues,
} from '../src/sim/economy';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';
import {
  deleteSlot,
  hasAnySavedSlot,
  listSaveSlots,
  loadFromSlot,
  saveToSlot,
} from '../src/state/saveManager';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);
const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
const baseState = createInitialGameState();
startGameWithCountry(baseState, turkey.id, worldCountries);

describe('v1.2 Aşama 3 — Taktiksel Savaş (+1000💰 Fetih, +%10 Vatan Savunması, Takviye, Geri Çekil, 50/50), Çoklu Ordu Birleştirme, 7 Aksiyonlu Diplomasi & 3 Slotlu Save/Continue', () => {
  it('bölge fethinde düşman binasını yıkar ve kazanan ülkeye anında +1000💰 ganimet + yüzen efekt verir', () => {
    const state = structuredClone(baseState);
    const pid = turkey.id;
    const p = state.countries[pid];
    const enemyId = Object.keys(state.countries).find((id) => id !== pid)!;
    const enemyReg = getCountryRegions(state, enemyId)[0];

    enemyReg.building = {
      type: 'bank',
      level: 1,
      constructing: false,
      progressSec: 0,
      totalSec: 0,
    };

    declareWar(state, pid, enemyId);
    const army = spawnUnitsIntoCountryBarracks(state, pid, 'ak:steel', 24)!;
    army.x = enemyReg.centroid[0];
    army.y = enemyReg.centroid[1];
    army.currentRegionId = enemyReg.id;

    const moneyBefore = p.money;
    tickArmiesCombatAndShips(state, 10);

    expect(enemyReg.ownerId).toBe(pid);
    expect(enemyReg.building).toBeNull();
    expect(p.money).toBe(moneyBefore + 1000);
    expect(state.floatingEffects.some((f) => f.text.includes('+1000'))).toBe(true);
  });

  it('+%10 Vatan Savunması, çoklu ordu takviyesi (reinforcement), %10 cezalı Geri Çekil ve 50/50 bölme kurallarını uygular', () => {
    // 1) +%10 Vatan Savunması: Kendi toprağında eşit güçte iki ordu çarpışınca ev sahibi kazanır!
    const stateHome = structuredClone(baseState);
    const pid = turkey.id;
    const enemyId = Object.keys(stateHome.countries).find((id) => id !== pid)!;
    declareWar(stateHome, pid, enemyId);

    const homeReg = getCountryRegions(stateHome, pid)[0];
    const defender = spawnUnitsIntoCountryBarracks(stateHome, pid, 'sword:wood', 25, homeReg.id)!;
    const invader = spawnUnitsIntoCountryBarracks(stateHome, enemyId, 'sword:wood', 25)!;
    defender.x = homeReg.centroid[0];
    defender.y = homeReg.centroid[1];
    defender.currentRegionId = homeReg.id;
    invader.x = homeReg.centroid[0] + 0.15;
    invader.y = homeReg.centroid[1];
    invader.currentRegionId = homeReg.id;

    for (let i = 0; i < 40; i++) {
      tickArmiesCombatAndShips(stateHome, 0.5);
    }
    expect(stateHome.armies[defender.id]).toBeDefined();
    expect(getTotalSoldiers(defender.units)).toBeGreaterThan(0);
    expect(stateHome.armies[invader.id]).toBeUndefined();

    // 2) Takviye (Reinforcement) & Geri Çekilme (Retreat) & 50/50 Bölme
    const state = structuredClone(baseState);
    declareWar(state, pid, enemyId);
    const enemyTerritory = getCountryRegions(state, enemyId)[0];

    const myA1 = spawnUnitsIntoCountryBarracks(state, pid, 'sword:wood', 12)!;
    const myA2 = spawnUnitsIntoCountryBarracks(state, pid, 'sword:wood', 20, getCountryRegions(state, pid)[1].id)!;
    const foe = spawnUnitsIntoCountryBarracks(state, enemyId, 'sword:wood', 22, enemyTerritory.id)!;

    myA1.x = foe.x + 0.2;
    myA1.y = foe.y;
    myA1.currentRegionId = enemyTerritory.id;
    myA2.x = foe.x + 0.9;
    myA2.y = foe.y;
    myA2.currentRegionId = enemyTerritory.id;

    // İlk tıkta A1 çatışmaya girer; A2 takviye olarak düşmana yürür ve çatışmaya katılır!
    tickArmiesCombatAndShips(state, 0.5);
    expect(myA1.inCombatWithArmyId).toBe(foe.id);
    orderArmyAttackEnemyArmy(state, myA2.id, foe.id);
    tickArmiesCombatAndShips(state, 1.2);
    expect(myA2.inCombatWithArmyId).toBe(foe.id);

    // Şimdi A1'i çatışmadan geri çekelim (%10 kayıp cezası, çatışmadan çıkar, A2 savaşmaya devam eder)
    const countBeforeRetreat = getTotalSoldiers(myA1.units);
    const retRes = retreatFromCombat(state, myA1.id);
    expect(retRes.ok).toBe(true);
    expect(retRes.lostSoldiers).toBeGreaterThanOrEqual(1);
    expect(getTotalSoldiers(myA1.units)).toBe(countBeforeRetreat - retRes.lostSoldiers!);
    expect(myA1.inCombatWithArmyId).toBeNull();
    expect(myA1.targetX).not.toBeNull();
    expect(foe.inCombatWithArmyId).toBe(myA2.id);

    // 50/50 tek tık bölme kontrolü
    myA1.targetX = null;
    myA1.targetY = null;
    const beforeHalf = getTotalSoldiers(myA1.units);
    const halfRes = splitArmyHalf(state, myA1.id);
    expect(halfRes.ok).toBe(true);
    expect(getTotalSoldiers(halfRes.newArmy!.units)).toBe(Math.floor(beforeHalf / 2));
    expect(getTotalSoldiers(myA1.units) + getTotalSoldiers(halfRes.newArmy!.units)).toBe(beforeHalf);
  });

  it('kutu seçimi (selectArmiesInWorldBox), uzaktan yürüyerek birleşme (orderArmiesMerge) ve toplu yürüyüşü çalıştırır', () => {
    const state = structuredClone(baseState);
    const pid = turkey.id;
    const regs = getCountryRegions(state, pid);

    const a1 = spawnUnitsIntoCountryBarracks(state, pid, 'sword:wood', 6, regs[0].id)!;
    const a2 = spawnUnitsIntoCountryBarracks(state, pid, 'spear:bronze', 8, regs[1].id)!;
    a1.x = regs[0].centroid[0];
    a1.y = regs[0].centroid[1];
    a2.x = a1.x + 2.2;
    a2.y = a1.y + 0.4;

    const selected = selectArmiesInWorldBox(
      state,
      pid,
      a1.x - 0.5,
      a1.y - 0.5,
      a2.x + 0.5,
      a2.y + 0.5,
    );
    expect(selected.length).toBe(2);
    expect(state.selectedArmyIds.length).toBe(2);

    // Toplu hedef yürüyüşü
    const multiMove = orderMultipleArmiesMoveToRegion(state, state.selectedArmyIds, regs[2].id);
    expect(multiMove.ok).toBe(true);
    expect(multiMove.movedCount).toBe(2);

    // Uzaktan yürüyerek birleştirme -> buluşunca tek orduda (14 asker) birleşir!
    const mergeOrder = orderArmiesMerge(state, [a1.id, a2.id]);
    expect(mergeOrder.ok).toBe(true);
    expect(mergeOrder.mergedImmediately).toBe(false);

    for (let i = 0; i < 20; i++) {
      tickArmiesCombatAndShips(state, 0.5);
    }

    const remainingPlayerArmies = Object.values(state.armies).filter((a) => a.countryId === pid);
    expect(remainingPlayerArmies.length).toBe(1);
    expect(getTotalSoldiers(remainingPlayerArmies[0].units)).toBe(14);
  });

  it('7 aksiyonlu Diplomasi motorunu (Hediye, 365 gün Saldırmazlık Paktı, +%10 Ticaret Anlaşması, İttifakı Boz) ve KeyP kısayolunu doğrular', () => {
    const kb = new KeyBindingsManager();
    kb.resetDefaults();
    expect(kb.getCode('openDiplomacy')).toBe('KeyP');
    expect(kb.getTooltipText('openBuildings')).toContain('Mağaza Penceresi');

    const state = structuredClone(baseState);
    const pid = turkey.id;
    const p = state.countries[pid];
    const otherId = Object.keys(state.countries).find((id) => id !== pid)!;
    p.money = 1000;

    // 1) Hediye Gönder (-150💰 -> +25 İlişki, soğuma süresi aktif)
    const gift1 = sendDiplomaticGift(state, pid, otherId);
    expect(gift1.ok).toBe(true);
    expect(gift1.newScore).toBe(25);
    expect(p.money).toBe(850);
    expect(sendDiplomaticGift(state, pid, otherId).ok).toBe(false); // Cooldown

    // 2) Ticaret Anlaşması (+%10 5sn geliri)
    const grossBefore = getCountryGrossIncomePerTick(state, pid);
    expect(proposeTradeAgreement(state, pid, otherId, true).accepted).toBe(true);
    const grossWithTrade = getCountryGrossIncomePerTick(state, pid);
    expect(grossWithTrade).toBe(Math.round(grossBefore * 1.1));

    // 3) 1 Yıllık (365 Gün) Saldırmazlık Paktı -> savaş ilanını engeller!
    expect(proposeNonAggressionPact(state, pid, otherId, true).accepted).toBe(true);
    expect(declareWar(state, pid, otherId).ok).toBe(false);
    expect(declareWar(state, otherId, pid).ok).toBe(false);

    // 4) İttifak Kur & İttifakı Boz (-65 ceza)
    expect(proposeAlliance(state, pid, otherId, true).accepted).toBe(true);
    expect(getRelationStatus(state, pid, otherId)).toBe('allied');
    const scoreWhileAllied = getDiplomacyEdge(state, pid, otherId)!.score;
    expect(breakAlliance(state, pid, otherId).ok).toBe(true);
    expect(getRelationStatus(state, pid, otherId)).toBe('neutral');
    expect(getDiplomacyEdge(state, pid, otherId)!.score).toBe(scoreWhileAllied - 65);

    // 366 gün geçince Saldırmazlık Paktı biter -> Savaş ilan edilebilir ve Ticaret iptal olur, Barış ile biter
    state.simDaysElapsed += 366;
    proposeTradeAgreement(state, pid, otherId, true);
    expect(getDiplomacyEdge(state, pid, otherId)!.tradeAgreement).toBe(true);
    expect(declareWar(state, pid, otherId).ok).toBe(true);
    expect(getDiplomacyEdge(state, pid, otherId)!.tradeAgreement).toBe(false);
    expect(proposePeace(state, pid, otherId, true).accepted).toBe(true);
    expect(getRelationStatus(state, pid, otherId)).toBe('neutral');
  });

  it('3 slotlu saveManager ile kaydetme, ülke adı + tarih metadatası, yükleme ve silme işlemlerini eksiksiz yapar', () => {
    deleteSlot(1);
    deleteSlot(2);
    deleteSlot(3);
    expect(hasAnySavedSlot()).toBe(false);

    const state = structuredClone(baseState);
    const pid = turkey.id;
    const p = state.countries[pid];
    p.money = 1500;
    state.simDaysElapsed = 412; // ~2001 yılı

    const emptyRegs = getCountryRegions(state, pid).filter((r) => !r.building);
    startBuildingConstruction(state, pid, emptyRegs[0].id, 'bank');
    startBuildingConstruction(state, pid, emptyRegs[1].id, 'factory');
    tickEconomyAndQueues(state, 8);
    takeBankLoan(state, pid, 500);
    queueFactoryParallelBatch(state, pid, emptyRegs[1].id, [
      { category: 'weapon', itemId: 'sword', count: 4 },
    ]);
    spawnUnitsIntoCountryBarracks(state, pid, 'sword:wood', 9);

    expect(saveToSlot(2, state, { cx: 34.5, cy: 39.2, scale: 42 }).ok).toBe(true);
    expect(hasAnySavedSlot()).toBe(true);

    const slots = listSaveSlots();
    expect(slots.length).toBe(3);
    expect(slots[0].empty).toBe(true);
    expect(slots[1].empty).toBe(false);
    expect(slots[1].countryName).toBe('Turkey');
    expect(slots[1].simDateLabel).toContain('2001');
    expect(slots[2].empty).toBe(true);

    const loadedState = createInitialGameState();
    const loadRes = loadFromSlot(2, loadedState);
    expect(loadRes.ok).toBe(true);
    expect(loadRes.camera?.scale).toBeCloseTo(42, 2);
    expect(loadedState.phase).toBe('playing');
    expect(loadedState.playerCountryId).toBe(pid);
    expect(loadedState.countries[pid].debt).toBe(575);
    expect(loadedState.regions[emptyRegs[1].id].building?.parallelProduction?.length).toBe(1);
    expect(Object.values(loadedState.armies).some((a) => getTotalSoldiers(a.units) === 9)).toBe(true);

    deleteSlot(2);
    expect(hasAnySavedSlot()).toBe(false);
  });
});
