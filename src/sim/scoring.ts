import { CALENDAR, SHIELDS, WEAPONS } from '../config/balance';
import type { GameState } from '../types';
import { getTotalSoldiers, parseUnitKey } from './army';
import { getCountryMoneyPerSec, getCountryRegions } from './economy';

export interface CountryStanding {
  rank: number;
  countryId: string;
  name: string;
  color: string;
  isPlayer: boolean;
  eliminated: boolean;
  regionCount: number;
  buildingCount: number;
  soldierCount: number;
  armyPower: number;
  techTierSum: number;
  money: number;
  moneyPerSec: number;
  totalScore: number;
}

export function computeArmyCombatPower(units: Record<string, number>): number {
  let power = 0;
  for (const [key, cnt] of Object.entries(units)) {
    if (cnt <= 0) continue;
    const { weapon, shield } = parseUnitKey(key);
    const dmg = WEAPONS[weapon]?.damage ?? 10;
    const def = shield === 'none' ? 0 : (SHIELDS[shield]?.defense ?? 0);
    power += cnt * (dmg * 0.8 + def * 0.5);
  }
  return Math.round(power);
}

export function computeStandings(state: GameState): CountryStanding[] {
  const list: CountryStanding[] = Object.values(state.countries).map((c) => {
    const regs = getCountryRegions(state, c.id);
    const regionCount = regs.length;
    let buildingCount = 0;
    for (const r of regs) {
      if (r.building && !r.building.constructing) {
        buildingCount += r.building.level;
      }
    }

    let soldierCount = 0;
    let armyPower = 0;
    for (const a of Object.values(state.armies)) {
      if (a.countryId !== c.id) continue;
      soldierCount += getTotalSoldiers(a.units);
      armyPower += computeArmyCombatPower(a.units);
    }
    for (const s of Object.values(state.ships)) {
      if (s.countryId !== c.id) continue;
      soldierCount += getTotalSoldiers(s.units);
      armyPower += computeArmyCombatPower(s.units);
    }

    const techTierSum = c.unlockedWeapons.length + c.unlockedShields.length;
    const totalScore = Math.round(
      regionCount * 100 +
        armyPower * 1 +
        buildingCount * 50 +
        techTierSum * 80 +
        c.money * 0.1,
    );

    return {
      rank: 0,
      countryId: c.id,
      name: c.name,
      color: c.color,
      isPlayer: c.isPlayer,
      eliminated: c.eliminated || regionCount === 0,
      regionCount,
      buildingCount,
      soldierCount,
      armyPower,
      techTierSum,
      money: Math.floor(c.money),
      moneyPerSec: getCountryMoneyPerSec(state, c.id),
      totalScore: c.eliminated || regionCount === 0 ? 0 : totalScore,
    };
  });

  list.sort((a, b) => {
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
    return b.totalScore - a.totalScore || b.regionCount - a.regionCount;
  });

  list.forEach((item, idx) => {
    item.rank = idx + 1;
  });

  return list;
}

export function checkEndGameConditions(state: GameState): void {
  if (state.phase !== 'playing') return;

  const pid = state.playerCountryId;
  if (pid) {
    const playerRegs = getCountryRegions(state, pid);
    if (playerRegs.length === 0) {
      state.phase = 'ended';
      state.endReason = 'defeat_eliminated';
      state.speed = 0;
      return;
    }

    const activeOwners = new Set(Object.values(state.regions).map((r) => r.ownerId));
    if (activeOwners.size === 1 && activeOwners.has(pid)) {
      state.phase = 'ended';
      state.endReason = 'victory_domination';
      state.speed = 0;
      return;
    }
  }

  if (state.simDaysElapsed >= CALENDAR.TOTAL_DAYS) {
    state.phase = 'ended';
    state.endReason = 'date_reached';
    state.speed = 0;
  }
}
