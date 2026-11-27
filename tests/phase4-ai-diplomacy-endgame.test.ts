import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import { createRng } from '../src/map/arenaBuilder';
import { parseWorldTopology } from '../src/map/worldLoader';
import { tickAICountries } from '../src/sim/ai';
import { orderArmyMoveToRegion, tickArmiesCombatAndShips } from '../src/sim/army';
import { advanceClock } from '../src/sim/calendar';
import { declareWar, getRelationStatus, proposeAlliance, proposePeace } from '../src/sim/diplomacy';
import {
  getCountryRegions,
  spawnUnitsIntoCountryBarracks,
  tickEconomyAndQueues,
} from '../src/sim/economy';
import { checkEndGameConditions, computeStandings } from '../src/sim/scoring';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);
const turkeyFeature = worldCountries.find((c) => c.name === 'Turkey')!;
const baseTurkeyState = createInitialGameState();
startGameWithCountry(baseTurkeyState, turkeyFeature.id, worldCountries);

describe('Faz 4 — Diplomasi, İnsan Gibi AI & Oyun Sonu', () => {
  it('İttifak topraklarından barışçıl geçiş, savunma ittifakı çağrısı ve Barış Teklifi ile savaşı bitirmeyi uygular', () => {
    const state = structuredClone(baseTurkeyState);
    const pid = turkeyFeature.id;
    const aiIds = Object.keys(state.countries).filter((id) => id !== pid);
    const allyId = aiIds[0];
    const enemyId = aiIds[1];

    // İttifak kur
    expect(proposeAlliance(state, pid, allyId, true).accepted).toBe(true);
    expect(getRelationStatus(state, pid, allyId)).toBe('allied');

    // Müttefik toprağına ordumuz serbestçe girebilir ama ele geçirmez
    const allyReg = getCountryRegions(state, allyId)[0];
    const myArmy = spawnUnitsIntoCountryBarracks(state, pid, 'sword:wood', 10)!;
    expect(orderArmyMoveToRegion(state, myArmy.id, allyReg.id).ok).toBe(true);
    myArmy.x = allyReg.centroid[0];
    myArmy.y = allyReg.centroid[1];
    myArmy.targetX = null;
    myArmy.targetY = null;
    myArmy.currentRegionId = allyReg.id;
    tickArmiesCombatAndShips(state, 15);
    expect(allyReg.ownerId).toBe(allyId);
    expect(allyReg.capture).toBeNull();

    // Düşman müttefikimize savaş açarsa biz de otomatik savaşa gireriz
    declareWar(state, enemyId, allyId);
    expect(getRelationStatus(state, enemyId, pid)).toBe('war');

    // Barış antlaşması savaşı ve devam eden ele geçirmeleri sonlandırır
    expect(proposePeace(state, pid, enemyId, true).accepted).toBe(true);
    expect(getRelationStatus(state, pid, enemyId)).toBe('neutral');
  });

  it('4 katmanlı AI ülkelerin 2-4 sn aralıklarla bina, üretim, eğitim ve savaş yürüttüğünü doğrular', () => {
    const state = structuredClone(baseTurkeyState);
    const rng = createRng('phase4_ai_seed');

    // 90 simülasyon saniyesi (270 gerçek sn = 22.5 oyun günü) çalıştır -> 3. günden sonra AI ülkeler Banka->Fabrika->Kışla kurup ekipman üreterek ordu çıkarmalı
    for (let t = 0; t < 90; t++) {
      const dt = advanceClock(state, 3);
      tickEconomyAndQueues(state, dt);
      tickAICountries(state, dt, rng);
      tickArmiesCombatAndShips(state, dt);
    }

    const aiArmies = Object.values(state.armies).filter((a) => a.countryId !== turkeyFeature.id);
    expect(aiArmies.length).toBeGreaterThan(0);

    // En az birkaç AI yeni bina inşa etmiş veya araştırma/üretim başlatmış olmalı
    const aiIds = Object.keys(state.countries).filter((id) => id !== turkeyFeature.id);
    const totalAiBuildings = aiIds.reduce(
      (sum, id) => sum + getCountryRegions(state, id).filter((r) => r.building !== null).length,
      0,
    );
    expect(totalAiBuildings).toBeGreaterThan(aiIds.length);
  });

  it('tüm toprakları kaybedince yenilgiyi ve kampanya bitiş tarihinde stat karşılaştırma sıralamasını hesaplar', () => {
    const state = structuredClone(baseTurkeyState);
    const pid = turkeyFeature.id;

    // 1. 2010 bitiş tarihi -> stat karşılaştırması
    advanceClock(state, 45000); // 3750 gün -> 3650 tavanı
    checkEndGameConditions(state);
    expect(state.phase).toBe('ended');
    expect(state.endReason).toBe('date_reached');

    const standings = computeStandings(state);
    expect(standings.length).toBe(Object.keys(state.countries).length);
    expect(standings[0].rank).toBe(1);
    expect(standings[0].totalScore).toBeGreaterThanOrEqual(standings[1].totalScore);

    // 2. Tüm bölgeleri kaybetme -> yenilgi
    state.phase = 'playing';
    state.endReason = null;
    const otherId = standings.find((s) => !s.isPlayer)!.countryId;
    for (const r of getCountryRegions(state, pid)) {
      r.ownerId = otherId;
    }
    checkEndGameConditions(state);
    expect(state.phase).toBe('ended');
    expect(state.endReason).toBe('defeat_eliminated');
  });
});
