import { SHIELD_ORDER, WEAPON_ORDER } from '../config/balance';
import type { BuildingType, Country, GameState, Region } from '../types';
import {
  getMergeableFriendlyArmies,
  getTotalSoldiers,
  mergeArmies,
  orderArmyAttackEnemyArmy,
  orderArmyEmbarkShip,
  orderArmyMoveToRegion,
  orderShipSailToCoastalRegion,
} from './army';
import {
  declareWar,
  estimateCountryMilitaryPower,
  getRelationStatus,
  proposeAlliance,
  proposePeace,
} from './diplomacy';
import {
  getCountryRegions,
  getEffectiveBuildingCount,
  queueBarracksTraining,
  queueFactoryProduction,
  startBuildingConstruction,
  startCombinedBuildingUpgrade,
  startTechResearch,
} from './economy';

function getBestUnlockedWeapon(c: Country) {
  let best = c.unlockedWeapons[0] ?? 'sword';
  for (const w of c.unlockedWeapons) {
    if (WEAPON_ORDER.indexOf(w) > WEAPON_ORDER.indexOf(best)) best = w;
  }
  return best;
}

function getBestUnlockedShield(c: Country) {
  let best = c.unlockedShields[0] ?? 'wood';
  for (const s of c.unlockedShields) {
    if (SHIELD_ORDER.indexOf(s) > SHIELD_ORDER.indexOf(best)) best = s;
  }
  return best;
}

function getCountryLandNeighborIds(state: GameState, countryId: string): string[] {
  const neighbors = new Set<string>();
  for (const reg of getCountryRegions(state, countryId)) {
    for (const nRegId of reg.neighbors) {
      const nReg = state.regions[nRegId];
      if (nReg && nReg.ownerId !== countryId && !state.countries[nReg.ownerId]?.eliminated) {
        neighbors.add(nReg.ownerId);
      }
    }
  }
  return [...neighbors];
}

function isCountryInAnyWar(state: GameState, countryId: string): boolean {
  for (const otherId of Object.keys(state.countries)) {
    if (otherId !== countryId && !state.countries[otherId].eliminated) {
      if (getRelationStatus(state, countryId, otherId) === 'war') return true;
    }
  }
  return false;
}

function getWarEnemyIds(state: GameState, countryId: string): string[] {
  return Object.keys(state.countries).filter(
    (otherId) =>
      otherId !== countryId &&
      !state.countries[otherId].eliminated &&
      getRelationStatus(state, countryId, otherId) === 'war',
  );
}

/** Tick all active AI countries with human-like 2-4s decision intervals, 4 personalities, and zero cheats. */
export function tickAICountries(
  state: GameState,
  dtSimSec: number,
  rng: () => number = Math.random,
): void {
  if (dtSimSec <= 0 || state.phase !== 'playing') return;

  for (const ai of Object.values(state.countries)) {
    if (ai.isPlayer || ai.eliminated) continue;

    ai.nextAiThinkSec -= dtSimSec;
    if (ai.nextAiThinkSec > 0) continue;
    // Human reaction tempo: 2 to 4 seconds between decisions
    ai.nextAiThinkSec = 2 + rng() * 2;

    const owned = getCountryRegions(state, ai.id);
    if (owned.length === 0) continue;

    runAIEconomyAndProduction(state, ai, owned, rng);
    runAIDiplomacy(state, ai, rng);
    runAIMilitaryTactics(state, ai, owned);
  }
}

function runAIEconomyAndProduction(
  state: GameState,
  ai: Country,
  owned: Region[],
  rng: () => number,
): void {
  // 1. Buildings
  if (ai.isSmallCountry) {
    const compReg = owned.find((r) => r.building?.type === 'combined') ?? owned[0];
    if (compReg && ai.money >= 260) {
      startCombinedBuildingUpgrade(state, ai.id, compReg.id);
    }
  } else {
    const emptyRegs = owned.filter((r) => !r.building);
    const constructingAny = owned.some((r) => r.building?.constructing);
    if (emptyRegs.length > 0 && !constructingAny && ai.money >= 165) {
      const banks = getEffectiveBuildingCount(state, ai.id, 'bank');
      const factories = getEffectiveBuildingCount(state, ai.id, 'factory');
      const barracks = getEffectiveBuildingCount(state, ai.id, 'barracks');
      const hospitals = getEffectiveBuildingCount(state, ai.id, 'hospital');
      const unis = getEffectiveBuildingCount(state, ai.id, 'university');
      const ports = getEffectiveBuildingCount(state, ai.id, 'port');

      let desired: Exclude<BuildingType, 'combined'> | null = null;
      if (banks < 1) desired = 'bank';
      else if (factories < 1) desired = 'factory';
      else if (barracks < 1) desired = 'barracks';
      else if (ai.personality === 'economist' && banks < 2) desired = 'bank';
      else if (unis < 1 && (ai.personality === 'economist' || ai.money >= 240)) desired = 'university';
      else if (hospitals < 1) desired = 'hospital';
      else if (ports < 1 && emptyRegs.some((r) => r.isCoastal)) desired = 'port';
      else if (banks < 3) desired = 'bank';
      else if (factories < 2) desired = 'factory';

      if (desired) {
        const targetReg =
          desired === 'port'
            ? emptyRegs.find((r) => r.isCoastal)
            : emptyRegs[Math.floor(rng() * emptyRegs.length)];
        if (targetReg) {
          startBuildingConstruction(state, ai.id, targetReg.id, desired);
        }
      }
    }
  }

  // 2. Science Research
  const unis = getEffectiveBuildingCount(state, ai.id, 'university');
  if (unis > 0 && !ai.activeResearch && ai.money >= 240) {
    const preferWeapon =
      ai.personality === 'aggressive'
        ? true
        : ai.personality === 'diplomat'
          ? ai.unlockedShields.length <= ai.unlockedWeapons.length
            ? false
            : true
          : ai.unlockedWeapons.length <= ai.unlockedShields.length;
    const res = startTechResearch(state, ai.id, preferWeapon ? 'weapon' : 'shield');
    if (!res.ok) {
      startTechResearch(state, ai.id, preferWeapon ? 'shield' : 'weapon');
    }
  }

  // 3. Factory Equipment Orders
  const factories = getEffectiveBuildingCount(state, ai.id, 'factory');
  const bestW = getBestUnlockedWeapon(ai);
  const bestS = getBestUnlockedShield(ai);
  if (factories > 0 && ai.productionQueue.length < 2 && ai.money >= 90) {
    if (ai.weaponsStock[bestW] < 12) {
      queueFactoryProduction(state, ai.id, 'weapon', bestW, 6);
    }
    if (ai.shieldsStock[bestS] < 10 && ai.money >= 60) {
      queueFactoryProduction(state, ai.id, 'shield', bestS, 5);
    }
  }

  // 4. Barracks Soldier Training
  const barracks = getEffectiveBuildingCount(state, ai.id, 'barracks');
  if (barracks > 0 && ai.trainingQueue.length < 2 && Math.floor(ai.manpower) >= 4) {
    // Train with best available weapon & shield in stock
    const wChoice = [...WEAPON_ORDER].reverse().find((w) => ai.weaponsStock[w] >= 3);
    if (wChoice) {
      const sChoice = [...SHIELD_ORDER].reverse().find((s) => ai.shieldsStock[s] >= 3) ?? 'none';
      const maxBatch = Math.min(
        8,
        Math.floor(ai.manpower),
        ai.weaponsStock[wChoice],
        sChoice === 'none' ? 999 : ai.shieldsStock[sChoice],
      );
      if (maxBatch >= 2) {
        queueBarracksTraining(state, ai.id, wChoice, sChoice, maxBatch);
      }
    }
  }
}

function runAIDiplomacy(state: GameState, ai: Country, rng: () => number): void {
  const myPower = estimateCountryMilitaryPower(state, ai.id);
  const warEnemies = getWarEnemyIds(state, ai.id);

  // If losing a war badly, try offering peace
  for (const foeId of warEnemies) {
    const foePower = estimateCountryMilitaryPower(state, foeId);
    if (myPower < foePower * 0.45 && rng() < 0.35) {
      if (!state.countries[foeId]?.isPlayer) {
        proposePeace(state, ai.id, foeId);
      }
    }
  }

  if (warEnemies.length > 0) return; // Already busy in a war

  const neighbors = getCountryLandNeighborIds(state, ai.id);
  const candidates =
    neighbors.length > 0
      ? neighbors
      : Object.keys(state.countries).filter((id) => id !== ai.id && !state.countries[id].eliminated);

  for (const otherId of candidates) {
    const rel = getRelationStatus(state, ai.id, otherId);
    const otherPower = estimateCountryMilitaryPower(state, otherId);

    // Diplomat / defensive AI seeks alliance with strong neighbor
    if (
      rel === 'neutral' &&
      (ai.personality === 'diplomat' || otherPower > myPower * 1.35) &&
      !state.countries[otherId]?.isPlayer &&
      rng() < 0.18
    ) {
      proposeAlliance(state, ai.id, otherId);
      continue;
    }

    // Never declare war without a meaningful army
    if (myPower < 65 || rel !== 'neutral') continue;

    const otherBusyInWar = isCountryInAnyWar(state, otherId);
    let shouldAttack = false;
    if (ai.personality === 'aggressive' && myPower >= otherPower * 0.95 && rng() < 0.28) {
      shouldAttack = true;
    } else if (ai.personality === 'opportunist' && otherBusyInWar && myPower >= otherPower * 0.75 && rng() < 0.4) {
      shouldAttack = true;
    } else if (ai.personality === 'economist' && ai.unlockedWeapons.length >= 2 && myPower >= otherPower * 1.25 && rng() < 0.22) {
      shouldAttack = true;
    } else if (ai.personality === 'diplomat' && myPower >= otherPower * 1.65 && rng() < 0.12) {
      shouldAttack = true;
    }

    if (shouldAttack) {
      declareWar(state, ai.id, otherId);
      break;
    }
  }
}

function runAIMilitaryTactics(state: GameState, ai: Country, owned: Region[]): void {
  const myArmies = Object.values(state.armies).filter((a) => a.countryId === ai.id);

  // Consolidate nearby idle friendly stacks
  for (const a of myArmies) {
    if (!state.armies[a.id] || a.inCombatWithArmyId) continue;
    const near = getMergeableFriendlyArmies(state, a.id);
    if (near.length > 0) {
      mergeArmies(state, a.id, near[0].id);
    }
  }

  const warEnemies = getWarEnemyIds(state, ai.id);
  if (warEnemies.length === 0) return;

  // Gather enemy regions & enemy armies
  const enemyRegions = Object.values(state.regions).filter((r) => warEnemies.includes(r.ownerId));
  const enemyArmies = Object.values(state.armies).filter((a) => warEnemies.includes(a.countryId));
  if (enemyRegions.length === 0) return;

  // Sail any loaded transport ships to an enemy coastal region
  for (const ship of Object.values(state.ships)) {
    if (ship.countryId !== ai.id || ship.targetX !== null) continue;
    if (getTotalSoldiers(ship.units) > 0) {
      const coastalTarget = enemyRegions.find((r) => r.isCoastal && r.coastalAnchor);
      if (coastalTarget) {
        orderShipSailToCoastalRegion(state, ship.id, coastalTarget.id);
      }
    }
  }

  const hasLandBorderWithEnemy = owned.some((r) =>
    r.neighbors.some((nid) => warEnemies.includes(state.regions[nid]?.ownerId ?? '')),
  );

  for (const army of Object.values(state.armies)) {
    if (army.countryId !== ai.id || army.inCombatWithArmyId || army.targetX !== null) continue;
    const mySize = getTotalSoldiers(army.units);
    if (mySize <= 0) continue;

    // If currently capturing an enemy region, stay put until captured!
    const standingReg = state.regions[army.currentRegionId];
    if (standingReg && warEnemies.includes(standingReg.ownerId)) {
      continue;
    }

    // Check if an outnumbered enemy army is close enough to crush
    const crushableFoe = enemyArmies.find(
      (foe) =>
        getTotalSoldiers(foe.units) < mySize * 0.9 &&
        Math.hypot(foe.x - army.x, foe.y - army.y) < 5,
    );
    if (crushableFoe) {
      orderArmyAttackEnemyArmy(state, army.id, crushableFoe.id);
      continue;
    }

    // If enemy is only reachable by sea and we have an idle ship, embark!
    if (!hasLandBorderWithEnemy) {
      const myShip = Object.values(state.ships).find(
        (s) => s.countryId === ai.id && s.targetX === null,
      );
      const coastalTarget = enemyRegions.find((r) => r.isCoastal && r.coastalAnchor);
      if (myShip && coastalTarget) {
        orderArmyEmbarkShip(state, army.id, myShip.id);
        continue;
      }
    }

    // Prioritize enemy regions WITH buildings (strategic targets!) or closest border regions
    const scoredTargets = enemyRegions.map((er) => {
      const dist = Math.hypot(er.centroid[0] - army.x, er.centroid[1] - army.y);
      const buildingBonus = er.building ? -2.8 : 0;
      return { reg: er, score: dist + buildingBonus };
    });
    scoredTargets.sort((a, b) => a.score - b.score);
    if (scoredTargets[0]) {
      orderArmyMoveToRegion(state, army.id, scoredTargets[0].reg.id);
    }
  }
}
