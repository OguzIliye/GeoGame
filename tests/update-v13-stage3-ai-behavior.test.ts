import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import { AI_CONFIG } from '../src/config/balance';
import { parseWorldTopology } from '../src/map/worldLoader';
import { consolidateAIPeaceArmies, tickAICountries } from '../src/sim/ai';
import { tickArmiesCombatAndShips } from '../src/sim/army';
import {
  declareWar,
  estimateCountryMilitaryPower,
  getRelationStatus,
  proposePeace,
} from '../src/sim/diplomacy';
import { getCountryRegions, spawnUnitsIntoCountryBarracks } from '../src/sim/economy';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);
const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
const baseState = createInitialGameState();
startGameWithCountry(baseState, turkey.id, worldCountries);

describe('v1.3 Aşama 3 — Daha Az Agresif AI (>= 1.6x Güç Eşiği) & Barışta Maks. 2 Ordu Birliği', () => {
  it('AI 1.6x güç üstünlüğü olmadan savaş ilan etmez; belirgin üstünlükte saldırabilir', () => {
    const state = structuredClone(baseState);
    const pid = turkey.id;
    const myRegs = getCountryRegions(state, pid);
    const aiId =
      myRegs
        .flatMap((r) => r.neighbors.map((nid) => state.regions[nid]?.ownerId))
        .find((id): id is string => Boolean(id && id !== pid)) ??
      Object.keys(state.countries).find((id) => id !== pid)!;
    const ai = state.countries[aiId];
    ai.personality = 'aggressive';
    state.simDaysElapsed = 20;

    // Tüm diğer ülkeleri çok güçlü yap, yalnız pid karşısında < 1.6x bırak
    for (const cid of Object.keys(state.countries)) {
      if (cid !== aiId && cid !== pid) {
        spawnUnitsIntoCountryBarracks(state, cid, 'bazooka:forcefield', 300);
      }
    }
    spawnUnitsIntoCountryBarracks(state, pid, 'sword:wood', 20);
    spawnUnitsIntoCountryBarracks(state, aiId, 'sword:wood', 20);

    const ratioBefore =
      estimateCountryMilitaryPower(state, aiId) / estimateCountryMilitaryPower(state, pid);
    expect(ratioBefore).toBeLessThan(AI_CONFIG.MIN_WAR_POWER_RATIO);

    // rng = 0.01 olsa bile 1.6x eşiği sağlanmadığı için savaş açmaz!
    ai.nextAiThinkSec = 0;
    tickAICountries(state, 1, () => 0.01);
    expect(getRelationStatus(state, aiId, pid)).toBe('neutral');

    // Şimdi AI'ya belirgin güç üstünlüğü (>= 1.6x) verelim -> savaş açabilir!
    spawnUnitsIntoCountryBarracks(state, aiId, 'bazooka:forcefield', 220);
    const ratioAfter =
      estimateCountryMilitaryPower(state, aiId) / estimateCountryMilitaryPower(state, pid);
    expect(ratioAfter).toBeGreaterThanOrEqual(AI_CONFIG.MIN_WAR_POWER_RATIO);
    ai.nextAiThinkSec = 0;
    tickAICountries(state, 1, () => 0.01);
    expect(getRelationStatus(state, aiId, pid)).toBe('war');
  });

  it('AI barış zamanında en fazla 2 birlik tutar, savaşta birlik sayısını artırabilir ve barışta tekrar <= 2 birliğe birleştirir', () => {
    const state = structuredClone(baseState);
    const pid = turkey.id;
    const aiId = Object.keys(state.countries).find(
      (id) => id !== pid && getCountryRegions(state, id).length >= 4,
    )!;
    const ai = state.countries[aiId];
    const aiRegs = getCountryRegions(state, aiId);
    state.simDaysElapsed = 15;

    // Savaşta tek büyük birlik (16 asker) çoklu cephe için bölünebilir (> 2 birliğe kadar çıkabilir)
    declareWar(state, aiId, pid);
    const bigStack = spawnUnitsIntoCountryBarracks(state, aiId, 'sword:wood', 16, aiRegs[0].id)!;
    const s2 = spawnUnitsIntoCountryBarracks(state, aiId, 'sword:wood', 12, aiRegs[1].id)!;
    s2.x += 1.5;
    ai.nextAiThinkSec = 0;
    tickAICountries(state, 1, () => 0.5);
    const warStacks = Object.values(state.armies).filter((a) => a.countryId === aiId);
    expect(warStacks.length).toBeGreaterThanOrEqual(3);
    void bigStack;

    // Fazladan 4 ayrı AI birliği oluşturalım ve Barış imzalayalım -> AI <= 2 birliğe birleştirmeli!
    const s3 = spawnUnitsIntoCountryBarracks(state, aiId, 'sword:wood', 6, aiRegs[2].id)!;
    const s4 = spawnUnitsIntoCountryBarracks(state, aiId, 'sword:wood', 5, aiRegs[3].id)!;
    s3.x = aiRegs[0].centroid[0] + 0.4;
    s3.y = aiRegs[0].centroid[1];
    s4.x = aiRegs[1].centroid[0] + 0.4;
    s4.y = aiRegs[1].centroid[1];

    proposePeace(state, aiId, pid, true);
    consolidateAIPeaceArmies(state, aiId);
    for (let i = 0; i < 20; i++) {
      tickArmiesCombatAndShips(state, 0.5);
      consolidateAIPeaceArmies(state, aiId);
    }

    const peaceStacks = Object.values(state.armies).filter((a) => a.countryId === aiId);
    expect(peaceStacks.length).toBeLessThanOrEqual(AI_CONFIG.MAX_PEACE_ARMIES);
  });
});
