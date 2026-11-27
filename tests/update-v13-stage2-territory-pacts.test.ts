import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import { parseWorldTopology } from '../src/map/worldLoader';
import {
  orderArmyAttackEnemyArmy,
  orderArmyMoveToRegion,
  pickArmyAtPoint,
  tickArmiesCombatAndShips,
} from '../src/sim/army';
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

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);
const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
const baseState = createInitialGameState();
startGameWithCountry(baseState, turkey.id, worldCountries);

describe('v1.3 Aşama 2 — Toprak Geçiş Kuralları & Anlaşmalı Ülkelerle Sıfır Asker Etkileşimi', () => {
  it('nötr ülke toprağına girişi ve üzerinden geçişi engeller; yalnızca savaşta veya barış/saldırmazlık/ittifak anlaşmasında geçiş izni verir', () => {
    const state = structuredClone(baseState);
    const pid = turkey.id;
    const myRegs = getCountryRegions(state, pid);

    // Doğrudan kara komşumuz olan bir ülke bul
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

    // 1. Nötr (anlaşmasız, savaşsız) ülkeye giriş yasak!
    expect(canArmyEnterCountryTerritory(state, pid, neighborId)).toBe(false);
    const blockedRes = orderArmyMoveToRegion(state, myArmy.id, neighborRegId);
    expect(blockedRes.ok).toBe(false);
    expect(blockedRes.error).toBe('Bu ülkenin topraklarına giriş izniniz yok.');

    // 2. Saldırmazlık Paktı -> geçiş hakkı verir!
    expect(proposeNonAggressionPact(state, pid, neighborId, true).accepted).toBe(true);
    expect(hasTransitPact(state, pid, neighborId)).toBe(true);
    expect(canArmyEnterCountryTerritory(state, pid, neighborId)).toBe(true);
    expect(orderArmyMoveToRegion(state, myArmy.id, neighborRegId).ok).toBe(true);

    // Pakt süresini bitir -> tekrar nötr -> giriş tekrar engellenir!
    state.simDaysElapsed += 400;
    expect(canArmyEnterCountryTerritory(state, pid, neighborId)).toBe(false);
    expect(orderArmyMoveToRegion(state, myArmy.id, neighborRegId).ok).toBe(false);

    // 3. İttifak -> geçiş izni verir; İttifakı Boz -> tekrar engellenir!
    expect(proposeAlliance(state, pid, neighborId, true).accepted).toBe(true);
    expect(orderArmyMoveToRegion(state, myArmy.id, neighborRegId).ok).toBe(true);
    expect(breakAlliance(state, pid, neighborId).ok).toBe(true);
    expect(orderArmyMoveToRegion(state, myArmy.id, neighborRegId).ok).toBe(false);

    // 4. Savaş -> giriş izni verir; Barış Antlaşması -> barış anlaşmalı geçiş hakkı devam eder!
    expect(declareWar(state, pid, neighborId).ok).toBe(true);
    expect(canArmyEnterCountryTerritory(state, pid, neighborId)).toBe(true);
    expect(proposePeace(state, pid, neighborId, true).accepted).toBe(true);
    expect(hasTransitPact(state, pid, neighborId)).toBe(true);
    expect(canArmyEnterCountryTerritory(state, pid, neighborId)).toBe(true);
    expect(orderArmyMoveToRegion(state, myArmy.id, neighborRegId).ok).toBe(true);
  });

  it('barış / saldırmazlık / ittifak anlaşması olan ülkelerin ordularıyla encounter, çatışma veya tıklama hedeflemesi başlatmaz; üst üste durabilirler', () => {
    const state = structuredClone(baseState);
    const pid = turkey.id;
    const pactCountryId = Object.keys(state.countries).find((id) => id !== pid)!;

    // Savaş -> Barış Antlaşması imzala
    declareWar(state, pid, pactCountryId);
    proposePeace(state, pid, pactCountryId, true);

    const myReg = getCountryRegions(state, pid)[0];
    const myArmy = spawnUnitsIntoCountryBarracks(state, pid, 'sword:wood', 12, myReg.id)!;
    const pactArmy = spawnUnitsIntoCountryBarracks(state, pactCountryId, 'spear:wood', 10)!;

    // Aynı bölgeye üst üste yerleştir
    pactArmy.x = myArmy.x;
    pactArmy.y = myArmy.y;
    pactArmy.currentRegionId = myReg.id;

    // Simülasyon ilerlediğinde ne Encounter açılır ne de çatışma başlar!
    tickArmiesCombatAndShips(state, 1.0);
    expect(state.activeEncounter).toBeNull();
    expect(myArmy.inCombatWithArmyId).toBeNull();
    expect(pactArmy.inCombatWithArmyId).toBeNull();

    // Tıklama hedeflemesi anlaşmalı yabancı orduyu seçmez (içinden geçilir / kendi ordumuz seçilir)
    const picked = pickArmyAtPoint(state, [pactArmy.x, pactArmy.y], 0.65, pid);
    expect(picked?.id).toBe(myArmy.id);

    // Sadece anlaşmalı yabancı ordu tek başına dururken de oyuncu tıklaması onu hedeflemez (null döner -> altındaki bölgeye yürünür)
    pactArmy.x += 2.0;
    expect(pickArmyAtPoint(state, [pactArmy.x, pactArmy.y], 0.65, pid)).toBeNull();
    expect(orderArmyAttackEnemyArmy(state, myArmy.id, pactArmy.id).ok).toBe(false);
  });
});
