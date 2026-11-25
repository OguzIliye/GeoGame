import {
  BUILDINGS,
  COMBAT_CONFIG,
  computeCaptureDurationSec,
  SHIELD_ORDER,
  SHIELDS,
  WEAPON_ORDER,
  WEAPONS,
} from '../config/balance';
import { pickRegionAtPoint } from '../map/arenaBuilder';
import type {
  ArmyStack,
  GameState,
  Point,
  Region,
  ShieldId,
  TransportShip,
  UnitTypeKey,
  WeaponId,
} from '../types';
import { canArmyEnterCountryTerritory, getRelationStatus } from './diplomacy';
import { getActiveBuildingLevel, getCountryRegions, nextUid, pushImportantToast } from './economy';

export function parseUnitKey(key: string): { weapon: WeaponId; shield: ShieldId } {
  const [w, s] = key.split(':');
  return {
    weapon: (w as WeaponId) || 'sword',
    shield: (s as ShieldId) || 'none',
  };
}

export function formatUnitKeyLabel(key: string): string {
  const { weapon, shield } = parseUnitKey(key);
  const wName = WEAPONS[weapon]?.name ?? weapon;
  const sName = shield === 'none' ? 'Kalkansız' : (SHIELDS[shield]?.name ?? shield);
  return `${wName} + ${sName}`;
}

export function getTotalSoldiers(units: Record<string, number>): number {
  let sum = 0;
  for (const cnt of Object.values(units)) {
    if (cnt > 0) sum += cnt;
  }
  return sum;
}

export function getNonZeroUnits(units: Record<string, number>): [UnitTypeKey, number][] {
  const out: [UnitTypeKey, number][] = [];
  for (const [k, v] of Object.entries(units)) {
    if (v > 0) out.push([k as UnitTypeKey, v]);
  }
  return out;
}

/** Max-tier visual representation rule: living highest weapon + living highest shield in the stack. */
export function getMaxTierVisualsForUnits(units: Record<string, number>): {
  weapon: WeaponId;
  shield: ShieldId;
} {
  let maxWIdx = 0;
  let maxSIdx = -1; // -1 = 'none'
  for (const [key, cnt] of Object.entries(units)) {
    if (cnt <= 0) continue;
    const { weapon, shield } = parseUnitKey(key);
    const wi = WEAPON_ORDER.indexOf(weapon);
    if (wi > maxWIdx) maxWIdx = wi;
    if (shield !== 'none') {
      const si = SHIELD_ORDER.indexOf(shield);
      if (si > maxSIdx) maxSIdx = si;
    }
  }
  return {
    weapon: WEAPON_ORDER[maxWIdx] ?? 'sword',
    shield: maxSIdx >= 0 ? SHIELD_ORDER[maxSIdx] : 'none',
  };
}

export function cancelSelectionAndOrderMode(state: GameState): void {
  state.moveOrderMode = false;
  state.selectedArmyId = null;
  state.selectedShipId = null;
}

export function pickArmyAtPoint(
  state: GameState,
  pt: Point,
  radiusMapUnits = 0.65,
): ArmyStack | null {
  let best: ArmyStack | null = null;
  let bestD2 = radiusMapUnits * radiusMapUnits;
  for (const army of Object.values(state.armies)) {
    if (getTotalSoldiers(army.units) <= 0) continue;
    const dx = pt[0] - army.x;
    const dy = pt[1] - army.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = army;
    }
  }
  return best;
}

export function pickShipAtPoint(
  state: GameState,
  pt: Point,
  radiusMapUnits = 0.75,
): TransportShip | null {
  let best: TransportShip | null = null;
  let bestD2 = radiusMapUnits * radiusMapUnits;
  for (const ship of Object.values(state.ships)) {
    const dx = pt[0] - ship.x;
    const dy = pt[1] - ship.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = ship;
    }
  }
  return best;
}

export function getMergeableFriendlyArmies(state: GameState, armyId: string): ArmyStack[] {
  const base = state.armies[armyId];
  if (!base || base.inCombatWithArmyId) return [];
  return Object.values(state.armies).filter(
    (other) =>
      other.id !== base.id &&
      other.countryId === base.countryId &&
      !other.inCombatWithArmyId &&
      Math.hypot(other.x - base.x, other.y - base.y) <= COMBAT_CONFIG.MERGE_DISTANCE,
  );
}

export function mergeArmies(
  state: GameState,
  primaryArmyId: string,
  secondaryArmyId: string,
): { ok: boolean; error?: string } {
  const a = state.armies[primaryArmyId];
  const b = state.armies[secondaryArmyId];
  if (!a || !b || a.id === b.id) return { ok: false, error: 'Geçersiz ordu kümesi.' };
  if (a.countryId !== b.countryId) return { ok: false, error: 'Farklı ülkelerin orduları birleşemez.' };
  if (a.inCombatWithArmyId || b.inCombatWithArmyId) {
    return { ok: false, error: 'Savaştaki ordu birleştirilemez.' };
  }
  if (Math.hypot(a.x - b.x, a.y - b.y) > COMBAT_CONFIG.MERGE_DISTANCE) {
    return { ok: false, error: 'Kümeler birleşmek için birbirine yeterince yakın değil.' };
  }

  for (const [k, cnt] of Object.entries(b.units)) {
    if (cnt > 0) a.units[k] = (a.units[k] ?? 0) + cnt;
  }
  delete state.armies[b.id];
  return { ok: true };
}

/**
 * Split an army stack into two.
 * Rule from DESIGN.md: Every existing (>0) unit type in the stack MUST have an explicit split count specified.
 */
export function splitArmyStack(
  state: GameState,
  armyId: string,
  splitCounts: Record<string, number>,
): { ok: boolean; newArmy?: ArmyStack; error?: string } {
  const army = state.armies[armyId];
  if (!army) return { ok: false, error: 'Ordu kümesi bulunamadı.' };
  if (army.inCombatWithArmyId) return { ok: false, error: 'Savaştaki küme ayrılamaz.' };

  const existingEntries = getNonZeroUnits(army.units);
  const totalBefore = getTotalSoldiers(army.units);
  if (totalBefore <= 1) return { ok: false, error: 'Ayırmak için en az 2 asker olmalı.' };

  let totalSplit = 0;
  for (const [unitKey, available] of existingEntries) {
    if (!(unitKey in splitCounts) || !Number.isInteger(splitCounts[unitKey])) {
      return {
        ok: false,
        error: `Her birlik türü için ayrı bir tam sayı belirtilmelidir (${formatUnitKeyLabel(unitKey)}).`,
      };
    }
    const req = splitCounts[unitKey];
    if (req < 0 || req > available) {
      return { ok: false, error: `${formatUnitKeyLabel(unitKey)} için geçersiz sayı.` };
    }
    totalSplit += req;
  }

  if (totalSplit <= 0) return { ok: false, error: 'Ayrılacak en az 1 asker seçmelisiniz.' };
  if (totalSplit >= totalBefore) {
    return { ok: false, error: 'Ana kümede en az 1 asker kalmalıdır.' };
  }

  const newUnits: Record<string, number> = {};
  for (const [unitKey] of existingEntries) {
    const req = splitCounts[unitKey];
    if (req > 0) {
      newUnits[unitKey] = req;
      army.units[unitKey] -= req;
      if (army.units[unitKey] <= 0) delete army.units[unitKey];
    }
  }

  const offsetPt: Point = [army.x + 0.24, army.y + 0.16];
  const regAtOffset = pickRegionAtPoint(offsetPt, state.regions);
  const spawnX = regAtOffset && regAtOffset.ownerId === army.countryId ? offsetPt[0] : army.x + 0.1;
  const spawnY = regAtOffset && regAtOffset.ownerId === army.countryId ? offsetPt[1] : army.y + 0.08;

  const newArmy: ArmyStack = {
    id: nextUid('army'),
    countryId: army.countryId,
    x: spawnX,
    y: spawnY,
    currentRegionId: army.currentRegionId,
    units: newUnits,
    targetX: null,
    targetY: null,
    targetRegionId: null,
    targetArmyId: null,
    inCombatWithArmyId: null,
    embarkingShipId: null,
  };
  state.armies[newArmy.id] = newArmy;
  return { ok: true, newArmy };
}

export function orderArmyMoveToRegion(
  state: GameState,
  armyId: string,
  targetRegionId: string,
  destPoint?: Point,
): { ok: boolean; error?: string } {
  const army = state.armies[armyId];
  const reg = state.regions[targetRegionId];
  if (!army || !reg) return { ok: false, error: 'Geçersiz hedef bölge.' };
  if (army.inCombatWithArmyId) return { ok: false, error: 'Savaştaki ordu hareket edemez.' };
  if (!canArmyEnterCountryTerritory(state, army.countryId, reg.ownerId)) {
    return {
      ok: false,
      error: 'Nötr ülkenin toprağına girilemez! Önce Diplomasi penceresinden savaş ilan edin.',
    };
  }

  clearCaptureByArmy(state, army.id);
  const dest = destPoint ?? reg.centroid;
  army.targetX = dest[0];
  army.targetY = dest[1];
  army.targetRegionId = reg.id;
  army.targetArmyId = null;
  army.embarkingShipId = null;
  return { ok: true };
}

export function orderArmyAttackEnemyArmy(
  state: GameState,
  armyId: string,
  enemyArmyId: string,
): { ok: boolean; error?: string } {
  const army = state.armies[armyId];
  const enemy = state.armies[enemyArmyId];
  if (!army || !enemy) return { ok: false, error: 'Geçersiz hedef ordu.' };
  if (army.countryId === enemy.countryId) return { ok: false, error: 'Dost orduya saldırılamaz.' };
  if (getRelationStatus(state, army.countryId, enemy.countryId) !== 'war') {
    return { ok: false, error: 'Bu ülkeyle savaşta değilsiniz! Önce savaş ilan edin.' };
  }

  clearCaptureByArmy(state, army.id);
  army.targetArmyId = enemy.id;
  army.targetX = enemy.x;
  army.targetY = enemy.y;
  army.targetRegionId = enemy.currentRegionId;
  army.embarkingShipId = null;
  return { ok: true };
}

/** Re-embark / embark rule: click soldier first, then click friendly transport ship. */
export function orderArmyEmbarkShip(
  state: GameState,
  armyId: string,
  shipId: string,
): { ok: boolean; error?: string } {
  const army = state.armies[armyId];
  const ship = state.ships[shipId];
  if (!army || !ship) return { ok: false, error: 'Geçersiz gemi veya ordu.' };
  if (army.countryId !== ship.countryId) return { ok: false, error: 'Bu gemi ülkenize ait değil.' };
  if (army.inCombatWithArmyId) return { ok: false, error: 'Savaştaki ordu gemiye binemez.' };

  clearCaptureByArmy(state, army.id);
  army.embarkingShipId = ship.id;
  army.targetArmyId = null;
  army.targetRegionId = null;
  army.targetX = ship.x;
  army.targetY = ship.y;
  return { ok: true };
}

export function orderShipSailToCoastalRegion(
  state: GameState,
  shipId: string,
  targetRegionId: string,
): { ok: boolean; error?: string } {
  const ship = state.ships[shipId];
  const reg = state.regions[targetRegionId];
  if (!ship || !reg) return { ok: false, error: 'Geçersiz hedef bölge.' };
  if (!reg.isCoastal || !reg.coastalAnchor) {
    return { ok: false, error: 'Gemiler yalnızca denize kıyısı olan bölgelere gidebilir.' };
  }
  if (!canArmyEnterCountryTerritory(state, ship.countryId, reg.ownerId)) {
    return {
      ok: false,
      error: 'Nötr ülkenin kıyısına çıkartma yapılamaz! Önce savaş ilan edin.',
    };
  }

  ship.targetX = reg.coastalAnchor[0];
  ship.targetY = reg.coastalAnchor[1];
  ship.landingRegionId = reg.id;
  return { ok: true };
}

function clearCaptureByArmy(state: GameState, armyId: string): void {
  for (const reg of Object.values(state.regions)) {
    if (reg.capture?.armyId === armyId) {
      reg.capture = null;
    }
  }
}

export function findNearestHospitalRegion(
  state: GameState,
  countryId: string,
  from: Point,
): Region | null {
  let best: Region | null = null;
  let bestD2 = Infinity;
  for (const reg of Object.values(state.regions)) {
    if (reg.ownerId !== countryId || getActiveBuildingLevel(reg.building) <= 0 || !reg.building) {
      continue;
    }
    if (reg.building.type !== 'hospital' && reg.building.type !== 'combined') continue;
    const dx = reg.centroid[0] - from[0];
    const dy = reg.centroid[1] - from[1];
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = reg;
    }
  }
  return best;
}

function computeArmyAverageStats(units: Record<string, number>): {
  count: number;
  avgDamage: number;
  avgDefense: number;
} {
  let total = 0;
  let dmgSum = 0;
  let defSum = 0;
  for (const [key, cnt] of Object.entries(units)) {
    if (cnt <= 0) continue;
    const { weapon, shield } = parseUnitKey(key);
    total += cnt;
    dmgSum += cnt * (WEAPONS[weapon]?.damage ?? 10);
    defSum += cnt * (shield === 'none' ? 0 : (SHIELDS[shield]?.defense ?? 0));
  }
  if (total <= 0) return { count: 0, avgDamage: 10, avgDefense: 0 };
  return {
    count: total,
    avgDamage: dmgSum / total,
    avgDefense: defSum / total,
  };
}

/** Apply casualties across unit types (lowest-tier front-line units take slightly more or proportional loss) and return exact lost unit map. */
function takeCasualtiesFromUnits(
  units: Record<string, number>,
  lossCount: number,
): Record<string, number> {
  const lost: Record<string, number> = {};
  const entries = getNonZeroUnits(units);
  const total = getTotalSoldiers(units);
  if (total <= 0 || lossCount <= 0) return lost;

  const actualLoss = Math.min(total, lossCount);
  let remainingToRemove = actualLoss;

  // Sort weakest tier first so front-line fodder falls first and elite bazooka fallback rule shines naturally
  entries.sort((a, b) => {
    const pa = parseUnitKey(a[0]);
    const pb = parseUnitKey(b[0]);
    return WEAPON_ORDER.indexOf(pa.weapon) - WEAPON_ORDER.indexOf(pb.weapon);
  });

  for (let i = 0; i < entries.length && remainingToRemove > 0; i++) {
    const [key, avail] = entries[i];
    const take =
      i === entries.length - 1
        ? Math.min(avail, remainingToRemove)
        : Math.min(avail, Math.max(1, Math.round((avail / total) * actualLoss)));
    if (take > 0) {
      units[key] -= take;
      if (units[key] <= 0) delete units[key];
      lost[key] = (lost[key] ?? 0) + take;
      remainingToRemove -= take;
    }
  }

  // Clean up any rounding remainder
  for (const [key] of getNonZeroUnits(units)) {
    if (remainingToRemove <= 0) break;
    const take = Math.min(units[key], remainingToRemove);
    units[key] -= take;
    if (units[key] <= 0) delete units[key];
    lost[key] = (lost[key] ?? 0) + take;
    remainingToRemove -= take;
  }

  return lost;
}

function dispatchEscapedWoundedToHospital(
  state: GameState,
  countryId: string,
  origin: Point,
  lostUnits: Record<string, number>,
): void {
  const hospReg = findNearestHospitalRegion(state, countryId, origin);
  // If country has no standing Hospital (or Combined Building), escaped soldiers cannot be saved
  if (!hospReg) return;

  const escapedUnits: Record<string, number> = {};
  let totalEscaped = 0;
  for (const [key, cnt] of Object.entries(lostUnits)) {
    if (cnt <= 0) continue;
    // 30% escape rate; probabilistic rounding for small batches so even 1-3 losses have accurate 30% expectation
    const exact = cnt * COMBAT_CONFIG.ESCAPE_TO_HOSPITAL_RATE;
    const whole = Math.floor(exact);
    const frac = exact - whole;
    const rescued = whole + (frac > 0.29 ? 1 : 0);
    if (rescued > 0) {
      escapedUnits[key] = rescued;
      totalEscaped += rescued;
    }
  }
  if (totalEscaped <= 0) return;

  state.wounded.push({
    id: nextUid('wnd'),
    countryId,
    units: escapedUnits,
    from: [origin[0], origin[1]],
    toRegionId: hospReg.id,
    to: [hospReg.centroid[0], hospReg.centroid[1]],
    travelProgress: 0,
    healElapsedSec: 0,
    healRequiredSec: COMBAT_CONFIG.HOSPITAL_HEAL_SEC,
  });
}

function handleRegionCaptured(state: GameState, reg: Region, newOwnerId: string): void {
  const prevOwnerId = reg.ownerId;
  if (prevOwnerId === newOwnerId) {
    reg.capture = null;
    return;
  }

  const hadBuilding = reg.building ? BUILDINGS[reg.building.type].name : null;
  reg.ownerId = newOwnerId;
  // DESIGN.md rule: When a region falls, any building inside it is DESTROYED!
  reg.building = null;
  reg.capture = null;

  // Remove empty port ships tied to destroyed port region
  for (const ship of Object.values(state.ships)) {
    if (ship.homeRegionId === reg.id && getTotalSoldiers(ship.units) === 0) {
      delete state.ships[ship.id];
    }
  }

  const pid = state.playerCountryId;
  const atkName = state.countries[newOwnerId]?.name ?? newOwnerId;
  const defName = state.countries[prevOwnerId]?.name ?? prevOwnerId;
  if (newOwnerId === pid) {
    pushImportantToast(
      state,
      `🏴 Bölge Ele Geçirildi: ${defName} (${reg.id})${hadBuilding ? ` — ${hadBuilding} yıkıldı!` : ''}`,
      'capture',
    );
  } else if (prevOwnerId === pid) {
    pushImportantToast(
      state,
      `⚠️ Bölge Kaybedildi: ${reg.id} (${atkName})${hadBuilding ? ` — ${hadBuilding} yıkıldı!` : ''}`,
      'loss',
    );
  }

  // Check country elimination
  const prevRemaining = getCountryRegions(state, prevOwnerId);
  if (prevRemaining.length === 0 && state.countries[prevOwnerId]) {
    const eliminatedCountry = state.countries[prevOwnerId];
    eliminatedCountry.eliminated = true;
    eliminatedCountry.productionQueue = [];
    eliminatedCountry.trainingQueue = [];
    eliminatedCountry.activeResearch = null;

    // Remove eliminated country's remaining armies/ships/wounded
    for (const a of Object.values(state.armies)) {
      if (a.countryId === prevOwnerId) delete state.armies[a.id];
    }
    for (const s of Object.values(state.ships)) {
      if (s.countryId === prevOwnerId) delete state.ships[s.id];
    }
    state.wounded = state.wounded.filter((w) => w.countryId !== prevOwnerId);

    if (prevOwnerId === pid) {
      state.phase = 'ended';
      state.endReason = 'defeat_eliminated';
      state.speed = 0;
    } else {
      pushImportantToast(state, `💀 ${defName} tamamen haritadan silindi!`, 'info');
      const aliveCountries = Object.values(state.countries).filter((c) => !c.eliminated);
      if (aliveCountries.length === 1 && aliveCountries[0].id === pid) {
        state.phase = 'ended';
        state.endReason = 'victory_domination';
        state.speed = 0;
      }
    }
  }
}

/** Advance army movement, ship sailing/landing/embarking, combats, hospital recovery, and region captures. */
export function tickArmiesCombatAndShips(state: GameState, dtSimSec: number): void {
  if (dtSimSec <= 0 || state.phase !== 'playing') return;

  // 1. Move Transport Ships & land armies when reaching destination coast
  for (const ship of Object.values(state.ships)) {
    if (ship.targetX !== null && ship.targetY !== null) {
      const dx = ship.targetX - ship.x;
      const dy = ship.targetY - ship.y;
      const dist = Math.hypot(dx, dy);
      const step = COMBAT_CONFIG.SHIP_MOVE_SPEED * dtSimSec;
      if (dist <= step) {
        ship.x = ship.targetX;
        ship.y = ship.targetY;
        ship.targetX = null;
        ship.targetY = null;

        if (ship.landingRegionId && getTotalSoldiers(ship.units) > 0) {
          const landReg = state.regions[ship.landingRegionId];
          if (landReg && canArmyEnterCountryTerritory(state, ship.countryId, landReg.ownerId)) {
            const landed: ArmyStack = {
              id: nextUid('army'),
              countryId: ship.countryId,
              x: landReg.centroid[0],
              y: landReg.centroid[1],
              currentRegionId: landReg.id,
              units: { ...ship.units },
              targetX: null,
              targetY: null,
              targetRegionId: null,
              targetArmyId: null,
              inCombatWithArmyId: null,
              embarkingShipId: null,
            };
            state.armies[landed.id] = landed;
            ship.units = {};
          }
        }
        ship.landingRegionId = null;
      } else {
        ship.x += (dx / dist) * step;
        ship.y += (dy / dist) * step;
      }
    }
  }

  // 2. Move Army Stacks (chasing enemy army, walking to ship, or walking to region)
  for (const army of Object.values(state.armies)) {
    if (getTotalSoldiers(army.units) <= 0) {
      delete state.armies[army.id];
      continue;
    }
    if (army.inCombatWithArmyId) {
      const foe = state.armies[army.inCombatWithArmyId];
      if (!foe || getRelationStatus(state, army.countryId, foe.countryId) !== 'war') {
        army.inCombatWithArmyId = null;
      } else {
        continue; // Locked in combat
      }
    }

    if (army.targetArmyId) {
      const foe = state.armies[army.targetArmyId];
      if (!foe || getRelationStatus(state, army.countryId, foe.countryId) !== 'war') {
        army.targetArmyId = null;
        army.targetX = null;
        army.targetY = null;
      } else {
        army.targetX = foe.x;
        army.targetY = foe.y;
      }
    }

    if (army.embarkingShipId) {
      const ship = state.ships[army.embarkingShipId];
      if (!ship || ship.countryId !== army.countryId) {
        army.embarkingShipId = null;
        army.targetX = null;
        army.targetY = null;
      } else {
        army.targetX = ship.x;
        army.targetY = ship.y;
      }
    }

    if (army.targetX !== null && army.targetY !== null) {
      const dx = army.targetX - army.x;
      const dy = army.targetY - army.y;
      const dist = Math.hypot(dx, dy);
      const step = COMBAT_CONFIG.LAND_MOVE_SPEED * dtSimSec;
      if (dist <= step) {
        army.x = army.targetX;
        army.y = army.targetY;
        army.targetX = null;
        army.targetY = null;

        if (army.embarkingShipId) {
          const ship = state.ships[army.embarkingShipId];
          if (ship) {
            for (const [k, cnt] of Object.entries(army.units)) {
              if (cnt > 0) ship.units[k] = (ship.units[k] ?? 0) + cnt;
            }
            if (state.selectedArmyId === army.id) state.selectedArmyId = null;
            delete state.armies[army.id];
            continue;
          }
        }

        if (army.targetRegionId && state.regions[army.targetRegionId]) {
          army.currentRegionId = army.targetRegionId;
        } else {
          const under = pickRegionAtPoint([army.x, army.y], state.regions);
          if (under) army.currentRegionId = under.id;
        }
        army.targetRegionId = null;
        army.targetArmyId = null;
      } else {
        army.x += (dx / dist) * step;
        army.y += (dy / dist) * step;
        const under = pickRegionAtPoint([army.x, army.y], state.regions);
        if (under) army.currentRegionId = under.id;
      }
    }
  }

  // 3. Detect & lock opposing war armies within engagement range
  const armyList = Object.values(state.armies);
  for (let i = 0; i < armyList.length; i++) {
    const a = armyList[i];
    if (a.inCombatWithArmyId) continue;
    for (let j = i + 1; j < armyList.length; j++) {
      const b = armyList[j];
      if (b.inCombatWithArmyId || a.countryId === b.countryId) continue;
      if (getRelationStatus(state, a.countryId, b.countryId) !== 'war') continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) <= COMBAT_CONFIG.COMBAT_ENGAGE_DISTANCE) {
        a.inCombatWithArmyId = b.id;
        b.inCombatWithArmyId = a.id;
        a.targetX = null;
        a.targetY = null;
        b.targetX = null;
        b.targetY = null;
        clearCaptureByArmy(state, a.id);
        clearCaptureByArmy(state, b.id);
        break;
      }
    }
  }

  // 4. Process combat ticks (every 0.5s)
  state.combatTickAccumulator += dtSimSec;
  while (state.combatTickAccumulator >= COMBAT_CONFIG.COMBAT_TICK_SEC) {
    state.combatTickAccumulator -= COMBAT_CONFIG.COMBAT_TICK_SEC;
    const processed = new Set<string>();

    for (const a of Object.values(state.armies)) {
      if (!a.inCombatWithArmyId || processed.has(a.id)) continue;
      const b = state.armies[a.inCombatWithArmyId];
      if (!b) {
        a.inCombatWithArmyId = null;
        continue;
      }
      processed.add(a.id);
      processed.add(b.id);

      const stA = computeArmyAverageStats(a.units);
      const stB = computeArmyAverageStats(b.units);
      if (stA.count <= 0 || stB.count <= 0) {
        a.inCombatWithArmyId = null;
        b.inCombatWithArmyId = null;
        continue;
      }

      const numMultA = Math.min(2.0, Math.pow(stA.count / stB.count, 0.35));
      const numMultB = Math.min(2.0, Math.pow(stB.count / stA.count, 0.35));

      const effAtkA = stA.count * stA.avgDamage * numMultA * COMBAT_CONFIG.COMBAT_TICK_SEC;
      const effAtkB = stB.count * stB.avgDamage * numMultB * COMBAT_CONFIG.COMBAT_TICK_SEC;

      const lossOnB = Math.max(1, Math.round(effAtkA / (30 + stB.avgDefense * 2)));
      const lossOnA = Math.max(1, Math.round(effAtkB / (30 + stA.avgDefense * 2)));

      const lostB = takeCasualtiesFromUnits(b.units, lossOnB);
      const lostA = takeCasualtiesFromUnits(a.units, lossOnA);

      dispatchEscapedWoundedToHospital(state, b.countryId, [b.x, b.y], lostB);
      dispatchEscapedWoundedToHospital(state, a.countryId, [a.x, a.y], lostA);

      if (getTotalSoldiers(a.units) <= 0) {
        if (state.selectedArmyId === a.id) state.selectedArmyId = null;
        delete state.armies[a.id];
        b.inCombatWithArmyId = null;
      }
      if (getTotalSoldiers(b.units) <= 0) {
        if (state.selectedArmyId === b.id) state.selectedArmyId = null;
        delete state.armies[b.id];
        if (state.armies[a.id]) a.inCombatWithArmyId = null;
      }
    }
  }

  // 5. Process Wounded Batches walking automatically to Hospital & healing back into original unit types
  const remainingWounded = [];
  for (const w of state.wounded) {
    const hospReg = state.regions[w.toRegionId];
    // If hospital region was lost or building destroyed before healing completed, try rerouting to another hospital
    if (
      !hospReg ||
      hospReg.ownerId !== w.countryId ||
      getActiveBuildingLevel(hospReg.building) <= 0 ||
      !hospReg.building ||
      (hospReg.building.type !== 'hospital' && hospReg.building.type !== 'combined')
    ) {
      const curPos: Point = [
        w.from[0] + (w.to[0] - w.from[0]) * w.travelProgress,
        w.from[1] + (w.to[1] - w.from[1]) * w.travelProgress,
      ];
      const alt = findNearestHospitalRegion(state, w.countryId, curPos);
      if (!alt) continue; // Lost — no standing hospital left!
      w.from = curPos;
      w.toRegionId = alt.id;
      w.to = [alt.centroid[0], alt.centroid[1]];
      w.travelProgress = 0;
    }

    if (w.travelProgress < 1) {
      const dist = Math.max(0.2, Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]));
      w.travelProgress = Math.min(1, w.travelProgress + (COMBAT_CONFIG.WOUNDED_TRAVEL_SPEED * dtSimSec) / dist);
      remainingWounded.push(w);
    } else {
      w.healElapsedSec += dtSimSec;
      if (w.healElapsedSec >= w.healRequiredSec) {
        // Healed soldiers return with their EXACT original unit/equipment types!
        const targetReg = state.regions[w.toRegionId];
        if (targetReg) {
          const existing = Object.values(state.armies).find(
            (a) =>
              a.countryId === w.countryId &&
              a.currentRegionId === targetReg.id &&
              a.targetX === null &&
              !a.inCombatWithArmyId,
          );
          if (existing) {
            for (const [k, cnt] of Object.entries(w.units)) {
              if (cnt > 0) existing.units[k] = (existing.units[k] ?? 0) + cnt;
            }
          } else {
            const recovered: ArmyStack = {
              id: nextUid('army'),
              countryId: w.countryId,
              x: targetReg.centroid[0],
              y: targetReg.centroid[1],
              currentRegionId: targetReg.id,
              units: { ...w.units },
              targetX: null,
              targetY: null,
              targetRegionId: null,
              targetArmyId: null,
              inCombatWithArmyId: null,
              embarkingShipId: null,
            };
            state.armies[recovered.id] = recovered;
          }
        }
      } else {
        remainingWounded.push(w);
      }
    }
  }
  state.wounded = remainingWounded;

  // 6. Process timed Region Captures
  for (const reg of Object.values(state.regions)) {
    // Find stationary, non-fighting war armies inside this region
    const invaders = Object.values(state.armies).filter(
      (a) =>
        a.currentRegionId === reg.id &&
        a.targetX === null &&
        !a.inCombatWithArmyId &&
        a.countryId !== reg.ownerId &&
        getRelationStatus(state, a.countryId, reg.ownerId) === 'war',
    );

    if (invaders.length === 0) {
      reg.capture = null;
      continue;
    }

    const leadArmy = invaders[0];
    const totalInvadingSoldiers = invaders
      .filter((a) => a.countryId === leadArmy.countryId)
      .reduce((s, a) => s + getTotalSoldiers(a.units), 0);
    const reqSec = computeCaptureDurationSec(totalInvadingSoldiers);

    if (!reg.capture || reg.capture.attackerCountryId !== leadArmy.countryId) {
      reg.capture = {
        attackerCountryId: leadArmy.countryId,
        armyId: leadArmy.id,
        elapsedSec: dtSimSec,
        requiredSec: reqSec,
      };
    } else {
      reg.capture.requiredSec = reqSec;
      reg.capture.elapsedSec += dtSimSec;
    }

    if (reg.capture.elapsedSec >= reg.capture.requiredSec) {
      handleRegionCaptured(state, reg, leadArmy.countryId);
    }
  }
}
