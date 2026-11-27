import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import { AI_CONFIG, BUILDINGS, ECONOMY, LOAN_CONFIG, SHIELDS, WEAPONS } from '../src/config/balance';
import { createRng } from '../src/map/arenaBuilder';
import { parseWorldTopology } from '../src/map/worldLoader';
import { tickAICountries } from '../src/sim/ai';
import { advanceClock } from '../src/sim/calendar';
import { getRelationStatus } from '../src/sim/diplomacy';
import {
  demolishBuilding,
  getCountryRegions,
  getEffectiveBuildingCount,
  queueBarracksTrainingBatch,
  queueFactoryParallelBatch,
  repayBankLoan,
  startBuildingConstruction,
  takeBankLoan,
  tickEconomyAndQueues,
} from '../src/sim/economy';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);
const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
const baseState = createInitialGameState();
startGameWithCountry(baseState, turkey.id, worldCountries);

describe('v1.2 Aşama 2 — 100💰 Başlangıç, Tek Üniversite, 5 sn Gelir, Banka Borç, Bina Yıkma, Paralel Fabrika & Kışla min Formülü, AI 3/7 Gün Gecikmesi', () => {
  it('100💰 başlangıç, yalnızca 1 Üniversite, MAX_UNIVERSITIES=1 sınırı ve %50 iadeli demolishBuilding kurallarını uygular', () => {
    const state = structuredClone(baseState);
    const pid = turkey.id;
    const p = state.countries[pid];

    expect(ECONOMY.START_MONEY).toBe(100);
    expect(BUILDINGS.bank.cost).toBe(100);
    expect(p.money).toBe(100);

    const owned = getCountryRegions(state, pid);
    const withBuildings = owned.filter((r) => r.building !== null);
    expect(withBuildings.length).toBe(1);
    expect(withBuildings[0].building?.type).toBe('university');

    // 2. Üniversite kurulamaz
    p.money = 1000;
    const emptyReg = owned.find((r) => !r.building)!;
    expect(startBuildingConstruction(state, pid, emptyReg.id, 'university').ok).toBe(false);

    // Mevcut Üniversite yıkılınca %50 iade (+110💰) gelir ve tekrar 1 Üniversite kurulabilir
    const moneyBefore = p.money;
    const demRes = demolishBuilding(state, pid, withBuildings[0].id);
    expect(demRes.ok).toBe(true);
    expect(demRes.refund).toBe(110);
    expect(p.money).toBe(moneyBefore + 110);
    expect(withBuildings[0].building).toBeNull();

    expect(startBuildingConstruction(state, pid, emptyReg.id, 'university').ok).toBe(true);
    // İnşa halindeyken de 2. Üniversite engellenir
    const anotherEmpty = owned.find((r) => !r.building)!;
    expect(startBuildingConstruction(state, pid, anotherEmpty.id, 'university').ok).toBe(false);
  });

  it('5 sn toplu gelir artışını, Banka 500/1000/10000 (%15 faiz, 20000 tavan, %25 otomatik kesinti) ve repayBankLoan sistemini uygular', () => {
    const state = structuredClone(baseState);
    const pid = turkey.id;
    const p = state.countries[pid];
    const emptyReg = getCountryRegions(state, pid).find((r) => !r.building)!;

    // Banka yokken borç alınamaz
    expect(takeBankLoan(state, pid, 500).ok).toBe(false);

    // 100💰 ile ilk Bankayı kur (maliyet 100💰 -> bakiye 0💰)
    expect(startBuildingConstruction(state, pid, emptyReg.id, 'bank').ok).toBe(true);
    expect(p.money).toBe(0);

    // 4.9 sn sonra para hâlâ 0 (lineer artış yok!)
    tickEconomyAndQueues(state, 4.9);
    expect(p.money).toBe(0);

    // 5.0 sn'de taban gelir (25💰) yatar (Banka henüz 6 sn inşa süresini tamamlamadı)
    tickEconomyAndQueues(state, 0.1);
    expect(p.money).toBe(25);
    expect(state.floatingEffects.some((f) => f.scope === 'hud_money' && f.text.includes('+25'))).toBe(true);

    // 1.1 sn daha ilerlet -> Banka tamamlanır
    tickEconomyAndQueues(state, 1.1);
    expect(getEffectiveBuildingCount(state, pid, 'bank')).toBe(1);

    // +500💰 borç -> +575💰 borç yükü; +10000💰 borç -> +11500💰 borç yükü
    expect(takeBankLoan(state, pid, 500).ok).toBe(true);
    expect(p.debt).toBe(575);
    expect(p.money).toBe(525);

    expect(takeBankLoan(state, pid, 10000).ok).toBe(true);
    expect(p.debt).toBe(575 + 11500);
    // İkinci 10000💰 borç 20.000💰 tavanını aşacağı için reddedilir!
    expect(takeBankLoan(state, pid, 10000).ok).toBe(false);
    expect(LOAN_CONFIG.MAX_DEBT).toBe(20000);

    // Sonraki 5 sn'lik gelirde Banka dahil brüt 85💰'nin %25'i (21💰) borçtan düşer, net +64💰 kasaya girer
    const debtBeforeTick = p.debt;
    const moneyBeforeTick = p.money;
    tickEconomyAndQueues(state, 4.0); // 1.1 + 4.0 = 5.1 sn -> 2. gelir ödemesi!
    expect(p.debt).toBe(debtBeforeTick - 21);
    expect(p.money).toBe(moneyBeforeTick + 64);

    // Borcu kapatma (repayBankLoan)
    p.money = 30000;
    const repay = repayBankLoan(state, pid);
    expect(repay.ok).toBe(true);
    expect(p.debt).toBe(0);
  });

  it('bina-bazlı bağımsız paralel Fabrika (2-15 sn) ve Kışla kıt kaynak min formülü + konumda doğuşu çalıştırır', () => {
    const state = structuredClone(baseState);
    const pid = turkey.id;
    const p = state.countries[pid];
    p.money = 5000;
    p.manpower = 8;
    p.unlockedWeapons = ['sword', 'spear', 'pistol', 'ak', 'bazooka'];
    p.unlockedShields = ['wood', 'bronze', 'steel', 'diamond', 'forcefield'];

    expect([WEAPONS.sword.prodSec, WEAPONS.spear.prodSec, WEAPONS.pistol.prodSec, WEAPONS.ak.prodSec, WEAPONS.bazooka.prodSec]).toEqual([
      2, 4, 7, 11, 15,
    ]);
    expect([SHIELDS.wood.prodSec, SHIELDS.bronze.prodSec, SHIELDS.steel.prodSec, SHIELDS.diamond.prodSec, SHIELDS.forcefield.prodSec]).toEqual([
      2, 4, 7, 11, 15,
    ]);

    const emptyRegs = getCountryRegions(state, pid).filter((r) => !r.building);
    const facA = emptyRegs[0];
    const facB = emptyRegs[1];
    const barA = emptyRegs[2];
    const barB = emptyRegs[3];

    startBuildingConstruction(state, pid, facA.id, 'factory');
    startBuildingConstruction(state, pid, facB.id, 'factory');
    startBuildingConstruction(state, pid, barA.id, 'barracks');
    startBuildingConstruction(state, pid, barB.id, 'barracks');
    tickEconomyAndQueues(state, 8); // Tüm binalar tamamlanır

    // Tek Fabrikada (facA) aynı anda 3 Kılıç (2sn) + 3 Tahta Kalkan (2sn) + 1 Mızrak (4sn) paralel üretilir!
    const batchA = queueFactoryParallelBatch(state, pid, facA.id, [
      { category: 'weapon', itemId: 'sword', count: 3 },
      { category: 'shield', itemId: 'wood', count: 3 },
      { category: 'weapon', itemId: 'spear', count: 1 },
    ]);
    expect(batchA.ok).toBe(true);
    // İkinci Fabrikada (facB) aynı anda 3 Kılıç paralel üretilir -> kapasite ikiye katlanır!
    expect(
      queueFactoryParallelBatch(state, pid, facB.id, [{ category: 'weapon', itemId: 'sword', count: 3 }]).ok,
    ).toBe(true);

    // 4.1 sn sonra: facA (2 Kılıç + 2 Tahta + 1 Mızrak), facB (2 Kılıç) üretmiş olmalı!
    tickEconomyAndQueues(state, 4.1);
    expect(p.weaponsStock.sword).toBe(4);
    expect(p.shieldsStock.wood).toBe(2);
    expect(p.weaponsStock.spear).toBe(1);

    // 2.1 sn daha ilerlet -> kalanlar da biter (toplam 6 Kılıç, 3 Tahta, 1 Mızrak)
    tickEconomyAndQueues(state, 2.1);
    expect(p.weaponsStock.sword).toBe(6);
    expect(p.shieldsStock.wood).toBe(3);
    expect(p.weaponsStock.spear).toBe(1);

    // Kışla A ve Kışla B'de bağımsız eğitim + kıt kaynak min formülü + kalkan opsiyonelliği:
    // p.manpower şu an ~22; 5 yapalım ki manpower darboğazını da test edelim!
    p.manpower = 5;
    // İstenen 10 asker, elde 5 manpower, girilen 6 Kılıç + 1 Mızrak (toplam 7 silah), girilen 10 Tahta Kalkan (stok 3):
    // actualSoldiers = min(10, 5, 7) = 5!
    // En güçlü silah öncelikli: 1 Mızrak + 4 Kılıç harcanır (2 Kılıç stokta kalır!).
    // 3 Tahta Kalkan en güçlü silahlardan başlayarak eşleşir (1 spear:wood, 2 sword:wood, 2 sword:none)!
    const trainA = queueBarracksTrainingBatch(
      state,
      pid,
      barA.id,
      10,
      { sword: 6, spear: 1 },
      { wood: 10 },
    );
    expect(trainA.ok).toBe(true);
    expect(trainA.trainedSoldiers).toBe(5);
    expect(p.weaponsStock.spear).toBe(0);
    expect(p.weaponsStock.sword).toBe(2); // Fazla girilen 2 Kılıç harcanmadı!
    expect(p.shieldsStock.wood).toBe(0);

    // Kışla B'de kalan 2 Kılıç ile kalkansız 2 asker paralel eğitilsin
    p.manpower = 4;
    const trainB = queueBarracksTrainingBatch(state, pid, barB.id, 2, { sword: 2 }, {});
    expect(trainB.ok).toBe(true);
    expect(trainB.trainedSoldiers).toBe(2);

    tickEconomyAndQueues(state, 3);
    const armyAtBarA = Object.values(state.armies).find(
      (a) => a.countryId === pid && a.currentRegionId === barA.id,
    )!;
    const armyAtBarB = Object.values(state.armies).find(
      (a) => a.countryId === pid && a.currentRegionId === barB.id,
    )!;
    expect(armyAtBarA).toBeDefined();
    expect(armyAtBarB).toBeDefined();
    expect(armyAtBarA.units['spear:wood']).toBe(1);
    expect(armyAtBarA.units['sword:wood']).toBe(2);
    expect(armyAtBarA.units['sword:none']).toBe(2);
    expect(armyAtBarB.units['sword:none']).toBe(2);
  });

  it('AI ilk 3 gün hiçbir aksiyon almaz, 7. güne kadar savaş açmaz, sonrasında adil ekipman->asker zincirini işletir', () => {
    const state = structuredClone(baseState);
    const pid = turkey.id;
    const aiIds = Object.keys(state.countries).filter((id) => id !== pid);
    const rng = createRng('v12_ai_delay_test');

    expect(AI_CONFIG.STARTUP_DELAY_DAYS).toBe(3);
    expect(AI_CONFIG.PEACEFUL_DEV_UNTIL_DAYS).toBe(7);

    // İlk 11 sim sn (33 gerçek sn) = 2.75 oyun günü (< 3 gün): AI'lar tek bir bina dahi kurmamış olmalı (sadece başlangıçtaki 1 Üniversite)
    for (let s = 0; s < 11; s++) {
      const dt = advanceClock(state, 3);
      tickEconomyAndQueues(state, dt);
      tickAICountries(state, dt, rng);
    }
    expect(state.simDaysElapsed).toBeLessThan(3);
    for (const aid of aiIds) {
      const bCount = getCountryRegions(state, aid).filter((r) => r.building !== null).length;
      expect(bCount).toBe(1);
    }

    // 11..27 sim sn = 2.75..6.75 oyun günü (< 7 gün): AI'lar bina kurmaya başlar ama HİÇBİR savaş ilanı olmaz!
    for (let s = 11; s < 27; s++) {
      const dt = advanceClock(state, 3);
      tickEconomyAndQueues(state, dt);
      tickAICountries(state, dt, rng);
    }
    expect(state.simDaysElapsed).toBeGreaterThanOrEqual(3);
    expect(state.simDaysElapsed).toBeLessThan(7);

    const totalAiBuildingsDay6 = aiIds.reduce(
      (sum, id) => sum + getCountryRegions(state, id).filter((r) => r.building !== null).length,
      0,
    );
    expect(totalAiBuildingsDay6).toBeGreaterThan(aiIds.length);

    // Hiçbir ülke çifti savaşta olmamalı
    for (let i = 0; i < aiIds.length; i++) {
      expect(getRelationStatus(state, pid, aiIds[i])).not.toBe('war');
      for (let j = i + 1; j < aiIds.length; j++) {
        expect(getRelationStatus(state, aiIds[i], aiIds[j])).not.toBe('war');
      }
    }
  });
});
