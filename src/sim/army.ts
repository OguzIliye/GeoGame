import {
  BUILDINGS,
  COMBAT_CONFIG,
  computeCaptureDurationSec,
  ECONOMY,
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
import { setAutoPauseReason } from './calendar';
import {
  canArmyEnterCountryTerritory,
  declareWar,
  evacuateStrandedArmies,
  getRelationStatus,
  hasTransitPact,
} from './diplomacy';
import {
  getActiveBuildingLevel,
  getCountryRegions,
  getEffectiveBuildingCount,
  getRegionBuildingPoint,
  nextUid,
  pushFloatingEffect,
  pushImportantToast,
} from './economy';

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
  setAutoPauseReason(state, 'move_order', false);
  state.selectedArmyId = null;
  state.selectedArmyIds = [];
  state.selectedShipId = null;
  state.boxSelectRect = null;
}

export function selectSingleArmy(state: GameState, armyId: string | null): void {
  state.selectedArmyId = armyId;
  state.selectedArmyIds = armyId ? [armyId] : [];
  state.selectedShipId = null;
}

export function selectArmiesInWorldBox(
  state: GameState,
  countryId: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): ArmyStack[] {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);

  const hits = Object.values(state.armies)
    .filter(
      (a) =>
        a.countryId === countryId &&
        getTotalSoldiers(a.units) > 0 &&
        a.x >= minX &&
        a.x <= maxX &&
        a.y >= minY &&
        a.y <= maxY,
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  state.selectedShipId = null;
  state.selectedArmyIds = hits.map((a) => a.id);
  state.selectedArmyId = hits.length === 1 ? hits[0].id : null;
  return hits;
}

export function pickArmyAtPoint(
  state: GameState,
  pt: Point,
  radiusMapUnits = 0.65,
  ignorePactForCountryId?: string | null,
): ArmyStack | null {
  let best: ArmyStack | null = null;
  let bestD2 = radiusMapUnits * radiusMapUnits;
  let bestOwn = false;
  for (const army of Object.values(state.armies)) {
    if (getTotalSoldiers(army.units) <= 0) continue;
    if (
      ignorePactForCountryId &&
      army.countryId !== ignorePactForCountryId &&
      hasTransitPact(state, ignorePactForCountryId, army.countryId)
    ) {
      continue;
    }
    const dx = pt[0] - army.x;
    const dy = pt[1] - army.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > radiusMapUnits * radiusMapUnits) continue;
    const isOwn = Boolean(ignorePactForCountryId && army.countryId === ignorePactForCountryId);
    if (!best || (isOwn && !bestOwn) || (isOwn === bestOwn && d2 <= bestD2)) {
      bestD2 = d2;
      best = army;
      bestOwn = isOwn;
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

  // Re-point any third army that was walking to merge into `b` so it merges into `a`
  for (const other of Object.values(state.armies)) {
    if (other.mergeTargetArmyId === b.id && other.id !== a.id) {
      other.mergeTargetArmyId = a.id;
    }
  }

  if (state.selectedArmyIds) {
    state.selectedArmyIds = state.selectedArmyIds.filter((id) => id !== b.id);
    if (state.selectedArmyIds.length === 1) {
      state.selectedArmyId = state.selectedArmyIds[0];
    }
  }
  if (state.selectedArmyId === b.id) {
    state.selectedArmyId = a.id;
  }

  delete state.armies[b.id];
  return { ok: true };
}

/** Order one friendly army to walk to another friendly army and auto-merge upon contact (or merge immediately if close). */
export function orderArmyMergeIntoTarget(
  state: GameState,
  sourceArmyId: string,
  targetArmyId: string,
): { ok: boolean; mergedImmediately?: boolean; targetArmyId?: string; error?: string } {
  const src = state.armies[sourceArmyId];
  const dst = state.armies[targetArmyId];
  if (!src || !dst || src.id === dst.id) {
    return { ok: false, error: 'Geçersiz birleştirme hedefi.' };
  }
  if (src.countryId !== dst.countryId) {
    return { ok: false, error: 'Farklı ülkelerin orduları birleşemez.' };
  }
  if (src.inCombatWithArmyId || dst.inCombatWithArmyId) {
    return { ok: false, error: 'Çatışmadaki ordu birleştirilemez.' };
  }

  if (Math.hypot(src.x - dst.x, src.y - dst.y) <= COMBAT_CONFIG.MERGE_DISTANCE) {
    const m = mergeArmies(state, dst.id, src.id);
    return { ok: m.ok, mergedImmediately: m.ok, targetArmyId: dst.id, error: m.error };
  }

  clearCaptureByArmy(state, src.id);
  src.mergeTargetArmyId = dst.id;
  src.targetArmyId = null;
  src.targetRegionId = null;
  src.embarkingShipId = null;
  src.waypoints = [[dst.x, dst.y]];
  src.targetX = dst.x;
  src.targetY = dst.y;
  return { ok: true, mergedImmediately: false, targetArmyId: dst.id };
}

/** Merge 2+ selected friendly armies: merges immediately if close, otherwise converges on common meeting point and auto-merges. */
export function orderArmiesMerge(
  state: GameState,
  armyIds: string[],
): { ok: boolean; anchorArmyId?: string; mergedImmediately?: boolean; error?: string } {
  const uniqueIds = [...new Set(armyIds)];
  const valid = uniqueIds
    .map((id) => state.armies[id])
    .filter((a): a is ArmyStack => Boolean(a && !a.inCombatWithArmyId && getTotalSoldiers(a.units) > 0));

  if (valid.length < 2) {
    return { ok: false, error: 'Birleştirmek için çatışmada olmayan en az 2 dost ordu seçin.' };
  }

  const cid = valid[0].countryId;
  const sameCountry = valid.filter((a) => a.countryId === cid);
  if (sameCountry.length < 2) {
    return { ok: false, error: 'Seçili ordular aynı ülkeye ait olmalıdır.' };
  }

  const avgX = sameCountry.reduce((s, a) => s + a.x, 0) / sameCountry.length;
  const avgY = sameCountry.reduce((s, a) => s + a.y, 0) / sameCountry.length;

  // Pick central army as anchor
  sameCountry.sort(
    (a, b) => Math.hypot(a.x - avgX, a.y - avgY) - Math.hypot(b.x - avgX, b.y - avgY),
  );
  const anchor = sameCountry[0];

  // Move anchor toward common meeting point if passable and not all already within merge range
  const allNearAnchor = sameCountry.every(
    (a) => Math.hypot(a.x - anchor.x, a.y - anchor.y) <= COMBAT_CONFIG.MERGE_DISTANCE,
  );
  if (!allNearAnchor) {
    const midReg = pickRegionAtPoint([avgX, avgY], state.regions);
    if (midReg && canArmyEnterCountryTerritory(state, cid, midReg.ownerId)) {
      orderArmyMoveToRegion(state, anchor.id, midReg.id, [avgX, avgY]);
    }
  }

  for (let i = 1; i < sameCountry.length; i++) {
    orderArmyMergeIntoTarget(state, sameCountry[i].id, anchor.id);
  }

  const survivingIds = sameCountry.map((a) => a.id).filter((id) => Boolean(state.armies[id]));
  state.selectedArmyIds = survivingIds;
  state.selectedArmyId = survivingIds.length === 1 ? survivingIds[0] : null;

  return {
    ok: true,
    anchorArmyId: anchor.id,
    mergedImmediately: survivingIds.length === 1,
  };
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

  const offsetPt: Point = [army.x + 0.28, army.y + 0.18];
  const regAtOffset = pickRegionAtPoint(offsetPt, state.regions);
  const spawnX = regAtOffset && regAtOffset.ownerId === army.countryId ? offsetPt[0] : army.x + 0.12;
  const spawnY = regAtOffset && regAtOffset.ownerId === army.countryId ? offsetPt[1] : army.y + 0.1;

  const newArmy: ArmyStack = {
    id: nextUid('army'),
    countryId: army.countryId,
    x: spawnX,
    y: spawnY,
    currentRegionId: army.currentRegionId,
    units: newUnits,
    targetX: null,
    targetY: null,
    waypoints: [],
    targetRegionId: null,
    targetArmyId: null,
    mergeTargetArmyId: null,
    inCombatWithArmyId: null,
    embarkingShipId: null,
  };
  state.armies[newArmy.id] = newArmy;
  return { ok: true, newArmy };
}

/** One-click 50/50 split (`✂️ Yarıya Böl (50/50)`) across all unit types in an army. */
export function splitArmyHalf(
  state: GameState,
  armyId: string,
): { ok: boolean; newArmy?: ArmyStack; error?: string } {
  const army = state.armies[armyId];
  if (!army) return { ok: false, error: 'Ordu kümesi bulunamadı.' };
  if (army.inCombatWithArmyId) return { ok: false, error: 'Savaştaki küme ayrılamaz.' };

  const entries = getNonZeroUnits(army.units);
  const total = getTotalSoldiers(army.units);
  if (total <= 1) return { ok: false, error: 'Yarıya bölmek için en az 2 asker olmalı.' };

  const targetHalf = Math.floor(total / 2);
  const splitCounts: Record<string, number> = {};
  let assigned = 0;

  for (const [key, cnt] of entries) {
    const base = Math.floor(cnt / 2);
    splitCounts[key] = base;
    assigned += base;
  }

  // Distribute odd remainders up to targetHalf
  for (const [key, cnt] of entries) {
    if (assigned >= targetHalf) break;
    if (cnt % 2 === 1 && splitCounts[key] < cnt) {
      splitCounts[key] += 1;
      assigned += 1;
    }
  }

  return splitArmyStack(state, armyId, splitCounts);
}

/** Split an exact total soldier count (`amount`) proportionally across unit types in the stack. */
export function splitArmyByCount(
  state: GameState,
  armyId: string,
  amount: number,
): { ok: boolean; newArmy?: ArmyStack; error?: string } {
  const army = state.armies[armyId];
  if (!army) return { ok: false, error: 'Ordu kümesi bulunamadı.' };
  if (army.inCombatWithArmyId) return { ok: false, error: 'Savaştaki küme ayrılamaz.' };

  const entries = getNonZeroUnits(army.units);
  const total = getTotalSoldiers(army.units);
  if (total <= 1) return { ok: false, error: 'Ayırmak için en az 2 asker olmalı.' };
  const target = Math.floor(amount);
  if (!Number.isFinite(amount) || target < 1 || target >= total) {
    return { ok: false, error: `1 ile ${total - 1} arasında bir asker sayısı girin.` };
  }

  const splitCounts: Record<string, number> = {};
  let assigned = 0;
  for (const [key, cnt] of entries) {
    const share = Math.min(cnt, Math.floor((cnt * target) / total));
    splitCounts[key] = share;
    assigned += share;
  }
  for (const [key, cnt] of entries) {
    if (assigned >= target) break;
    const room = cnt - splitCounts[key];
    if (room > 0) {
      const add = Math.min(room, target - assigned);
      splitCounts[key] += add;
      assigned += add;
    }
  }
  return splitArmyStack(state, armyId, splitCounts);
}

function hashSeedSign(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return h & 1;
}

/**
 * Build natural movement waypoints:
 * - No forced stops at intermediate region centroids.
 * - Short marches go straight; long marches (>= LONG_MARCH_WEAVE_MIN_DIST) add subtle left/right weave waypoints,
 *   staying on passable land whenever possible.
 */
export function buildNaturalMarchWaypoints(
  state: GameState,
  countryId: string,
  from: Point,
  to: Point,
  seedId: string,
): Point[] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dist = Math.hypot(dx, dy);
  if (dist < COMBAT_CONFIG.LONG_MARCH_WEAVE_MIN_DIST) {
    return [[to[0], to[1]]];
  }

  const segments = Math.min(5, Math.max(2, Math.round(dist / 1.75)));
  const nx = -dy / dist;
  const ny = dx / dist;
  const parity = hashSeedSign(seedId);
  const pts: Point[] = [];

  for (let k = 1; k < segments; k++) {
    const t = k / segments;
    const bx = from[0] + dx * t;
    const by = from[1] + dy * t;
    const amp = Math.min(0.42, dist * 0.085) * Math.sin(Math.PI * t);
    const sign = (k + parity) % 2 === 0 ? 1 : -1;

    const tryA: Point = [bx + nx * sign * amp, by + ny * sign * amp];
    const regA = pickRegionAtPoint(tryA, state.regions);
    if (regA && canArmyEnterCountryTerritory(state, countryId, regA.ownerId)) {
      pts.push(tryA);
      continue;
    }

    const tryB: Point = [bx - nx * sign * amp, by - ny * sign * amp];
    const regB = pickRegionAtPoint(tryB, state.regions);
    if (regB && canArmyEnterCountryTerritory(state, countryId, regB.ownerId)) {
      pts.push(tryB);
      continue;
    }

    pts.push([bx, by]);
  }

  pts.push([to[0], to[1]]);
  return pts;
}

function segmentCrossesForbiddenTerritory(
  state: GameState,
  countryId: string,
  from: Point,
  to: Point,
): boolean {
  const samples = 10;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const px = from[0] + (to[0] - from[0]) * t;
    const py = from[1] + (to[1] - from[1]) * t;
    const hit = pickRegionAtPoint([px, py], state.regions);
    if (hit && !canArmyEnterCountryTerritory(state, countryId, hit.ownerId)) {
      return true;
    }
  }
  return false;
}

export function findPassableRegionPath(
  state: GameState,
  countryId: string,
  startRegionId: string,
  targetRegionId: string,
): Region[] | null {
  const startReg = state.regions[startRegionId];
  const targetReg = state.regions[targetRegionId];
  if (!startReg || !targetReg) return null;
  if (!canArmyEnterCountryTerritory(state, countryId, targetReg.ownerId)) return null;
  if (startRegionId === targetRegionId) return [targetReg];

  const queue: string[] = [startRegionId];
  const prev = new Map<string, string | null>([[startRegionId, null]]);

  while (queue.length > 0) {
    const curId = queue.shift()!;
    if (curId === targetRegionId) {
      const path: Region[] = [];
      let trace: string | null = targetRegionId;
      while (trace !== null) {
        path.push(state.regions[trace]);
        trace = prev.get(trace) ?? null;
      }
      path.reverse();
      return path;
    }
    const cur = state.regions[curId];
    if (!cur) continue;
    for (const nbId of cur.neighbors) {
      if (prev.has(nbId)) continue;
      const nb = state.regions[nbId];
      if (!nb || !canArmyEnterCountryTerritory(state, countryId, nb.ownerId)) continue;
      prev.set(nbId, curId);
      queue.push(nbId);
    }
  }
  return null;
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
      error: 'Bu ülkenin topraklarına giriş izniniz yok.',
    };
  }

  const dest: Point = destPoint ? [destPoint[0], destPoint[1]] : [reg.centroid[0], reg.centroid[1]];
  const curReg = state.regions[army.currentRegionId];
  const startingOnForbidden =
    Boolean(army.evacuatingHome) ||
    (curReg !== undefined && !canArmyEnterCountryTerritory(state, army.countryId, curReg.ownerId));
  let wps: Point[];

  if (startingOnForbidden && reg.ownerId === army.countryId) {
    wps = [dest];
    army.evacuatingHome = true;
  } else if (segmentCrossesForbiddenTerritory(state, army.countryId, [army.x, army.y], dest)) {
    const startReg =
      state.regions[army.currentRegionId] ?? pickRegionAtPoint([army.x, army.y], state.regions);
    const regionPath = startReg
      ? findPassableRegionPath(state, army.countryId, startReg.id, reg.id)
      : null;
    if (!regionPath) {
      return {
        ok: false,
        error: 'Bu ülkenin topraklarına giriş izniniz yok.',
      };
    }
    wps = regionPath.slice(1, -1).map((r): Point => [r.centroid[0], r.centroid[1]]);
    wps.push(dest);
    army.evacuatingHome = false;
  } else {
    wps = buildNaturalMarchWaypoints(
      state,
      army.countryId,
      [army.x, army.y],
      dest,
      `${army.id}_${targetRegionId}`,
    );
    army.evacuatingHome = false;
  }

  clearCaptureByArmy(state, army.id);
  army.waypoints = wps;
  army.targetX = wps[0][0];
  army.targetY = wps[0][1];
  army.targetRegionId = reg.id;
  army.targetArmyId = null;
  army.mergeTargetArmyId = null;
  army.embarkingShipId = null;
  return { ok: true };
}

export function orderMultipleArmiesMoveToRegion(
  state: GameState,
  armyIds: string[],
  targetRegionId: string,
  destPoint?: Point,
): { ok: boolean; movedCount: number; error?: string } {
  const reg = state.regions[targetRegionId];
  if (!reg) return { ok: false, movedCount: 0, error: 'Geçersiz hedef bölge.' };

  let movedCount = 0;
  let lastError: string | undefined;
  const baseDest: Point = destPoint ? [destPoint[0], destPoint[1]] : [reg.centroid[0], reg.centroid[1]];

  armyIds.forEach((id, idx) => {
    const a = state.armies[id];
    if (!a || a.inCombatWithArmyId) return;
    // Slight fan offset when 2+ armies march together so stacks remain visible unless merged
    let pt: Point = baseDest;
    if (armyIds.length > 1) {
      const ang = (idx / armyIds.length) * Math.PI * 2;
      const cand: Point = [baseDest[0] + Math.cos(ang) * 0.14, baseDest[1] + Math.sin(ang) * 0.14];
      const candReg = pickRegionAtPoint(cand, state.regions);
      if (candReg?.id === reg.id) pt = cand;
    }
    const res = orderArmyMoveToRegion(state, id, targetRegionId, pt);
    if (res.ok) movedCount += 1;
    else lastError = res.error;
  });

  if (movedCount === 0) {
    return { ok: false, movedCount: 0, error: lastError ?? 'Hareket edebilecek ordu bulunamadı.' };
  }
  return { ok: true, movedCount };
}

export function orderArmyAttackEnemyArmy(
  state: GameState,
  armyId: string,
  enemyArmyId: string,
): { ok: boolean; error?: string } {
  const army = state.armies[armyId];
  const enemy = state.armies[enemyArmyId];
  if (!army || !enemy) return { ok: false, error: 'Geçersiz hedef ordu.' };
  if (army.inCombatWithArmyId) return { ok: false, error: 'Ordu zaten çatışmada.' };
  if (army.countryId === enemy.countryId) return { ok: false, error: 'Dost orduya saldırılamaz.' };
  const rel = getRelationStatus(state, army.countryId, enemy.countryId);
  if (rel === 'allied') {
    return { ok: false, error: 'Müttefik ülke askerlerine saldırılamaz!' };
  }
  if (rel !== 'war') {
    return { ok: false, error: 'Bu ülkeyle savaşta değilsiniz! Önce savaş ilan edin.' };
  }

  clearCaptureByArmy(state, army.id);
  army.targetArmyId = enemy.id;
  army.mergeTargetArmyId = null;
  army.waypoints = [[enemy.x, enemy.y]];
  army.targetX = enemy.x;
  army.targetY = enemy.y;
  army.targetRegionId = enemy.currentRegionId;
  army.embarkingShipId = null;
  return { ok: true };
}

export function orderMultipleArmiesAttackEnemyArmy(
  state: GameState,
  armyIds: string[],
  enemyArmyId: string,
): { ok: boolean; count: number; error?: string } {
  let count = 0;
  let lastError: string | undefined;
  for (const id of armyIds) {
    const res = orderArmyAttackEnemyArmy(state, id, enemyArmyId);
    if (res.ok) count += 1;
    else lastError = res.error;
  }
  return count > 0
    ? { ok: true, count }
    : { ok: false, count: 0, error: lastError ?? 'Saldıracak uygun ordu bulunamadı.' };
}

/** Retreat from active combat (`🏃 Geri Çekil`): suffers 10% retreat loss penalty and retreats to nearest friendly region. */
export function retreatFromCombat(
  state: GameState,
  armyId: string,
): { ok: boolean; lostSoldiers?: number; retreatRegionId?: string; error?: string } {
  const army = state.armies[armyId];
  if (!army) return { ok: false, error: 'Ordu bulunamadı.' };
  if (!army.inCombatWithArmyId) return { ok: false, error: 'Bu ordu şu an çatışmada değil.' };

  const foe = state.armies[army.inCombatWithArmyId];
  const foePos: Point = foe ? [foe.x, foe.y] : [army.x, army.y];

  const totalBefore = getTotalSoldiers(army.units);
  const penaltyLoss =
    totalBefore > 1
      ? Math.min(totalBefore - 1, Math.max(1, Math.round(totalBefore * COMBAT_CONFIG.RETREAT_LOSS_RATE)))
      : 0;
  if (penaltyLoss > 0) {
    const lostUnits = takeCasualtiesFromUnits(army.units, penaltyLoss);
    dispatchEscapedWoundedToHospital(state, army.countryId, [army.x, army.y], lostUnits);
  }

  // Detach from combat; keep remaining friendly reinforcements engaged if any
  army.inCombatWithArmyId = null;
  army.combatLossCarry = 0;

  for (const other of Object.values(state.armies)) {
    if (other.inCombatWithArmyId === army.id) {
      const altFriendly = Object.values(state.armies).find(
        (f) =>
          f.id !== army.id &&
          getTotalSoldiers(f.units) > 0 &&
          f.inCombatWithArmyId !== null &&
          getRelationStatus(state, f.countryId, other.countryId) === 'war' &&
          Math.hypot(f.x - other.x, f.y - other.y) <= COMBAT_CONFIG.COMBAT_ENGAGE_DISTANCE * 1.25,
      );
      other.inCombatWithArmyId = altFriendly ? altFriendly.id : null;
    }
  }

  // Choose nearest safe friendly region outside enemy engagement radius
  const owned = getCountryRegions(state, army.countryId);
  const safeOwned = owned.filter(
    (r) =>
      Math.hypot(r.centroid[0] - foePos[0], r.centroid[1] - foePos[1]) >
      COMBAT_CONFIG.COMBAT_ENGAGE_DISTANCE + 0.45,
  );
  const pool = safeOwned.length > 0 ? safeOwned : owned;
  pool.sort(
    (a, b) =>
      Math.hypot(a.centroid[0] - army.x, a.centroid[1] - army.y) -
      Math.hypot(b.centroid[0] - army.x, b.centroid[1] - army.y),
  );
  const retreatReg = pool[0] ?? state.regions[army.currentRegionId];

  // Step slightly outside engagement circle toward retreat destination + set brief retreat grace window
  army.retreatingUntilSimSec = state.simSecondsElapsed + 4.0;
  if (foe) {
    state.encounterCooldownUntilSimSec[encounterPairKey(army.id, foe.id)] =
      state.simSecondsElapsed + COMBAT_CONFIG.ENCOUNTER_COOLDOWN_SEC;
  }

  if (retreatReg) {
    const dest: Point = [retreatReg.centroid[0], retreatReg.centroid[1]];
    const dx = dest[0] - foePos[0];
    const dy = dest[1] - foePos[1];
    const d = Math.hypot(dx, dy);
    const stepOut = COMBAT_CONFIG.COMBAT_ENGAGE_DISTANCE + 0.22;
    if (d > 1e-4) {
      const nudged: Point = [foePos[0] + (dx / d) * stepOut, foePos[1] + (dy / d) * stepOut];
      const nudgedReg = pickRegionAtPoint(nudged, state.regions);
      if (nudgedReg && canArmyEnterCountryTerritory(state, army.countryId, nudgedReg.ownerId)) {
        army.x = nudged[0];
        army.y = nudged[1];
        army.currentRegionId = nudgedReg.id;
      }
    }
    orderArmyMoveToRegion(state, army.id, retreatReg.id, dest);
  }

  return {
    ok: true,
    lostSoldiers: penaltyLoss,
    retreatRegionId: retreatReg?.id,
  };
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
  army.mergeTargetArmyId = null;
  army.targetRegionId = null;
  army.waypoints = [[ship.x, ship.y]];
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

export function getPlayerFocusableUnits(
  state: GameState,
): Array<{ kind: 'army' | 'ship'; id: string; x: number; y: number }> {
  const pid = state.playerCountryId;
  if (!pid) return [];

  const armies = Object.values(state.armies)
    .filter((a) => a.countryId === pid && getTotalSoldiers(a.units) > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((a) => ({ kind: 'army' as const, id: a.id, x: a.x, y: a.y }));

  if (armies.length > 0) return armies;

  const loadedShips = Object.values(state.ships)
    .filter((s) => s.countryId === pid && getTotalSoldiers(s.units) > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => ({ kind: 'ship' as const, id: s.id, x: s.x, y: s.y }));

  return loadedShips;
}

export function cyclePlayerArmyFocus(
  state: GameState,
  nowRealMs = Date.now(),
): { ok: boolean; target?: { kind: 'army' | 'ship'; id: string; x: number; y: number } } {
  const units = getPlayerFocusableUnits(state);
  if (units.length === 0) return { ok: false };

  state.armyFocusIndex = (state.armyFocusIndex + 1) % units.length;
  const chosen = units[state.armyFocusIndex];
  state.focusPing = { x: chosen.x, y: chosen.y, startedRealMs: nowRealMs };
  if (chosen.kind === 'army') {
    selectSingleArmy(state, chosen.id);
  } else {
    state.selectedShipId = chosen.id;
    state.selectedArmyId = null;
    state.selectedArmyIds = [];
  }
  return { ok: true, target: chosen };
}

function encounterPairKey(aId: string, bId: string): string {
  return aId < bId ? `${aId}__${bId}` : `${bId}__${aId}`;
}

export type EncounterChoice = 'attack' | 'declare_war_attack' | 'stand_down' | 'continue_pass';

export function checkPlayerArmyEncounters(state: GameState): void {
  if (state.phase !== 'playing' || state.activeEncounter || !state.playerCountryId) return;
  const pid = state.playerCountryId;

  const allArmies = Object.values(state.armies);
  const myArmies = allArmies.filter(
    (a) =>
      a.countryId === pid &&
      !a.inCombatWithArmyId &&
      !a.evacuatingHome &&
      (a.retreatingUntilSimSec ?? 0) <= state.simSecondsElapsed &&
      getTotalSoldiers(a.units) > 0,
  );
  const foreignArmies = allArmies.filter(
    (a) =>
      a.countryId !== pid &&
      !a.inCombatWithArmyId &&
      !a.evacuatingHome &&
      getTotalSoldiers(a.units) > 0,
  );

  for (const myArmy of myArmies) {
    for (const other of foreignArmies) {
      // Skip if player already explicitly ordered an attack on this exact army
      if (myArmy.targetArmyId === other.id) continue;

      const dist = Math.hypot(myArmy.x - other.x, myArmy.y - other.y);
      if (hasTransitPact(state, pid, other.countryId)) continue;
      const rel = getRelationStatus(state, pid, other.countryId);
      if (
        rel === 'war' &&
        (dist <= COMBAT_CONFIG.COMBAT_ENGAGE_DISTANCE || other.targetArmyId === myArmy.id)
      ) {
        continue;
      }

      const key = encounterPairKey(myArmy.id, other.id);

      // Reset sticky cooldown once the two stacks have separated comfortably
      if (dist > COMBAT_CONFIG.ENCOUNTER_DETECT_DISTANCE * 1.35) {
        if (state.encounterCooldownUntilSimSec[key] === Number.POSITIVE_INFINITY) {
          delete state.encounterCooldownUntilSimSec[key];
        }
        continue;
      }

      if (dist > COMBAT_CONFIG.ENCOUNTER_DETECT_DISTANCE) continue;

      const cdUntil = state.encounterCooldownUntilSimSec[key];
      if (cdUntil !== undefined && state.simSecondsElapsed < cdUntil) continue;

      state.activeEncounter = {
        id: nextUid('enc'),
        playerArmyId: myArmy.id,
        otherArmyId: other.id,
        otherCountryId: other.countryId,
        relation: getRelationStatus(state, pid, other.countryId),
        activeTab: 'encounter',
      };
      setAutoPauseReason(state, 'encounter', true);
      return;
    }
  }
}

export function resolveEncounterChoice(
  state: GameState,
  choice: EncounterChoice,
): { ok: boolean; error?: string } {
  const enc = state.activeEncounter;
  if (!enc) {
    setAutoPauseReason(state, 'encounter', false);
    return { ok: false, error: 'Aktif bir karşılaşma yok.' };
  }

  const myArmy = state.armies[enc.playerArmyId];
  const other = state.armies[enc.otherArmyId];
  const key = encounterPairKey(enc.playerArmyId, enc.otherArmyId);

  state.activeEncounter = null;
  setAutoPauseReason(state, 'encounter', false);

  if (!myArmy || !other) {
    return { ok: true };
  }

  if (choice === 'declare_war_attack') {
    if (getRelationStatus(state, myArmy.countryId, other.countryId) === 'allied') {
      return { ok: false, error: 'Müttefik ülke askerleriyle savaşa girilemez!' };
    }
    if (getRelationStatus(state, myArmy.countryId, other.countryId) !== 'war') {
      const warRes = declareWar(state, myArmy.countryId, other.countryId);
      if (!warRes.ok) return warRes;
    }
    state.encounterCooldownUntilSimSec[key] =
      state.simSecondsElapsed + COMBAT_CONFIG.ENCOUNTER_COOLDOWN_SEC;
    myArmy.inCombatWithArmyId = other.id;
    if (!other.inCombatWithArmyId) other.inCombatWithArmyId = myArmy.id;
    myArmy.targetX = null;
    myArmy.targetY = null;
    myArmy.waypoints = [];
    other.targetX = null;
    other.targetY = null;
    other.waypoints = [];
    clearCaptureByArmy(state, myArmy.id);
    clearCaptureByArmy(state, other.id);
    return { ok: true };
  }

  if (choice === 'attack') {
    if (getRelationStatus(state, myArmy.countryId, other.countryId) !== 'war') {
      return { ok: false, error: 'Bu ülkeyle savaşta değilsiniz.' };
    }
    state.encounterCooldownUntilSimSec[key] =
      state.simSecondsElapsed + COMBAT_CONFIG.ENCOUNTER_COOLDOWN_SEC;
    myArmy.inCombatWithArmyId = other.id;
    if (!other.inCombatWithArmyId) other.inCombatWithArmyId = myArmy.id;
    myArmy.targetX = null;
    myArmy.targetY = null;
    myArmy.waypoints = [];
    other.targetX = null;
    other.targetY = null;
    other.waypoints = [];
    clearCaptureByArmy(state, myArmy.id);
    clearCaptureByArmy(state, other.id);
    return { ok: true };
  }

  if (choice === 'stand_down') {
    myArmy.targetX = null;
    myArmy.targetY = null;
    myArmy.waypoints = [];
    myArmy.targetRegionId = null;
    myArmy.targetArmyId = null;
    myArmy.mergeTargetArmyId = null;
    myArmy.embarkingShipId = null;
    if (other.targetArmyId === myArmy.id) {
      other.targetArmyId = null;
      other.targetX = null;
      other.targetY = null;
      other.waypoints = [];
    }

    // Step slightly back outside encounter/engagement radius if too close
    const dx = myArmy.x - other.x;
    const dy = myArmy.y - other.y;
    const d = Math.hypot(dx, dy);
    const safeDist = COMBAT_CONFIG.ENCOUNTER_DETECT_DISTANCE + 0.16;
    if (d < safeDist) {
      const ux = d > 1e-4 ? dx / d : -1;
      const uy = d > 1e-4 ? dy / d : 0;
      const cand: Point = [other.x + ux * safeDist, other.y + uy * safeDist];
      const regHit = pickRegionAtPoint(cand, state.regions);
      if (regHit && canArmyEnterCountryTerritory(state, myArmy.countryId, regHit.ownerId)) {
        myArmy.x = cand[0];
        myArmy.y = cand[1];
        myArmy.currentRegionId = regHit.id;
      }
    }
    state.encounterCooldownUntilSimSec[key] = Number.POSITIVE_INFINITY;
    return { ok: true };
  }

  // 'continue_pass' — pass peacefully without repeating popup until separated
  state.encounterCooldownUntilSimSec[key] = Number.POSITIVE_INFINITY;
  return { ok: true };
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
    if (reg.building.type !== 'hospital') continue;
    const [hx, hy] = getRegionBuildingPoint(reg);
    const dx = hx - from[0];
    const dy = hy - from[1];
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = reg;
    }
  }
  return best;
}

export function computeArmyAverageStats(units: Record<string, number>): {
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

function computeCombinedForceStats(armies: ArmyStack[]): {
  count: number;
  avgDamage: number;
  avgDefense: number;
} {
  let count = 0;
  let dmgSum = 0;
  let defSum = 0;
  for (const a of armies) {
    const st = computeArmyAverageStats(a.units);
    count += st.count;
    dmgSum += st.count * st.avgDamage;
    defSum += st.count * st.avgDefense;
  }
  if (count <= 0) return { count: 0, avgDamage: 10, avgDefense: 0 };
  return {
    count,
    avgDamage: dmgSum / count,
    avgDefense: defSum / count,
  };
}

/** Apply casualties across unit types (lowest-tier front-line units fall first) and return exact lost unit map. */
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

function mergeIntoWoundedGroup(
  existing: GameState['wounded'][number],
  addedUnits: Record<string, number>,
): void {
  const prevCount = getTotalSoldiers(existing.units);
  let addedCount = 0;
  for (const [k, v] of Object.entries(addedUnits)) {
    if (v > 0) {
      existing.units[k] = (existing.units[k] ?? 0) + v;
      addedCount += v;
    }
  }
  if (existing.travelProgress >= 1 && prevCount > 0 && addedCount > 0) {
    existing.healElapsedSec *= prevCount / (prevCount + addedCount);
  }
}

export function coalesceWoundedByCountry(state: GameState): void {
  if (state.wounded.length <= 1) return;
  const byCountry = new Map<string, GameState['wounded'][number]>();
  for (const w of state.wounded) {
    const cur = byCountry.get(w.countryId);
    if (!cur) {
      byCountry.set(w.countryId, w);
    } else {
      mergeIntoWoundedGroup(cur, w.units);
      if (cur.waitingForHospital && !w.waitingForHospital) {
        cur.waitingForHospital = false;
        cur.toRegionId = w.toRegionId;
        cur.to = [...w.to];
        cur.travelProgress = w.travelProgress;
      }
    }
  }
  state.wounded = [...byCountry.values()];
}

function dispatchEscapedWoundedToHospital(
  state: GameState,
  countryId: string,
  origin: Point,
  lostUnits: Record<string, number>,
): void {
  const hospReg = findNearestHospitalRegion(state, countryId, origin);
  const holdOnFieldForTutorial =
    !hospReg &&
    Boolean(state.tutorialHoldWoundedWithoutHospital) &&
    countryId === state.playerCountryId;

  // In standard play, if country has no standing Hospital, escaped soldiers cannot be saved
  if (!hospReg && !holdOnFieldForTutorial) return;

  const escapedUnits: Record<string, number> = {};
  let totalEscaped = 0;
  for (const [key, cnt] of Object.entries(lostUnits)) {
    if (cnt <= 0) continue;
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

  // v1.3 Rule: Single WoundedGroup per country — coalesce into any existing batch of this country!
  const existingGroup = state.wounded.find((w) => w.countryId === countryId);
  if (existingGroup) {
    mergeIntoWoundedGroup(existingGroup, escapedUnits);
    if (existingGroup.waitingForHospital && hospReg) {
      const [hx, hy] = getRegionBuildingPoint(hospReg);
      existingGroup.waitingForHospital = false;
      existingGroup.toRegionId = hospReg.id;
      existingGroup.to = [hx, hy];
      existingGroup.travelProgress = 0;
    }
    return;
  }

  if (holdOnFieldForTutorial) {
    state.wounded.push({
      id: nextUid('wnd'),
      countryId,
      units: escapedUnits,
      from: [origin[0], origin[1]],
      toRegionId: '',
      to: [origin[0], origin[1]],
      travelProgress: 0,
      healElapsedSec: 0,
      healRequiredSec: COMBAT_CONFIG.HOSPITAL_HEAL_SEC,
      waitingForHospital: true,
    });
    return;
  }

  const [hx, hy] = getRegionBuildingPoint(hospReg!);
  state.wounded.push({
    id: nextUid('wnd'),
    countryId,
    units: escapedUnits,
    from: [origin[0], origin[1]],
    toRegionId: hospReg!.id,
    to: [hx, hy],
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

  const destroyedType = reg.building?.type ?? null;
  const hadBuilding = destroyedType ? BUILDINGS[destroyedType].name : null;
  reg.ownerId = newOwnerId;
  // v1.2 Rule: Enemy building in captured region is DESTROYED, freeing the region for new construction!
  reg.building = null;
  reg.capture = null;

  if (
    destroyedType === 'university' &&
    state.countries[prevOwnerId] &&
    getEffectiveBuildingCount(state, prevOwnerId, 'university') <= 0
  ) {
    state.countries[prevOwnerId].activeResearch = null;
  }

  // v1.2 Rule: Instant +1.000 💰 region capture loot bonus to winner!
  const winner = state.countries[newOwnerId];
  if (winner) {
    winner.money += ECONOMY.REGION_CAPTURE_BONUS;
  }

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
    pushFloatingEffect(state, {
      text: `+${ECONOMY.REGION_CAPTURE_BONUS} 💰`,
      color: '#facc15',
      scope: 'world',
      x: reg.centroid[0],
      y: reg.centroid[1],
      durationMs: 1800,
    });
    pushImportantToast(
      state,
      `🏴 Bölge Ele Geçirildi (+${ECONOMY.REGION_CAPTURE_BONUS}💰): ${defName} (${reg.id})${hadBuilding ? ` — ${hadBuilding} yıkıldı!` : ''}`,
      'capture',
    );
  } else if (prevOwnerId === pid) {
    pushImportantToast(
      state,
      `⚠️ Bölge Kaybedildi: ${reg.id} (${atkName})${hadBuilding ? ` — ${hadBuilding} yıkıldı!` : ''}`,
      'loss',
    );
  }
  evacuateStrandedArmies(state);

  // Check country elimination
  const prevRemaining = getCountryRegions(state, prevOwnerId);
  if (prevRemaining.length === 0 && state.countries[prevOwnerId]) {
    const eliminatedCountry = state.countries[prevOwnerId];
    eliminatedCountry.eliminated = true;
    eliminatedCountry.activeResearch = null;

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

function distributeSideCasualties(
  state: GameState,
  sideArmies: ArmyStack[],
  rawTotalLoss: number,
): void {
  const totalSoldiers = sideArmies.reduce((s, a) => s + getTotalSoldiers(a.units), 0);
  if (totalSoldiers <= 0 || rawTotalLoss <= 0) return;

  for (const a of sideArmies) {
    const cnt = getTotalSoldiers(a.units);
    if (cnt <= 0) continue;
    const share = rawTotalLoss * (cnt / totalSoldiers);
    const acc = (a.combatLossCarry ?? 0) + share;
    let whole = Math.floor(acc);
    // Ensure steady progress even in tiny 1v1 skirmishes when accumulated >= 0.55
    if (whole === 0 && acc >= 0.55) {
      whole = 1;
      a.combatLossCarry = 0;
    } else {
      a.combatLossCarry = acc - whole;
    }
    if (whole > 0) {
      const lostUnits = takeCasualtiesFromUnits(a.units, whole);
      dispatchEscapedWoundedToHospital(state, a.countryId, [a.x, a.y], lostUnits);
    }
  }
}

/** Advance army movement, walking merges, ship sailing/landing/embarking, multi-army reinforcement combats (+10% homeland defense), hospital recovery, and region captures. */
export function tickArmiesCombatAndShips(
  state: GameState,
  dtSimSec: number,
  healSpeedMult = 1,
): void {
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
              waypoints: [],
              targetRegionId: null,
              targetArmyId: null,
              mergeTargetArmyId: null,
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

  // 2. Move Army Stacks (walking merge, chasing enemy army, walking to ship, or natural weave waypoints)
  for (const army of Object.values(state.armies)) {
    if (!state.armies[army.id]) continue;
    if (getTotalSoldiers(army.units) <= 0) {
      delete state.armies[army.id];
      continue;
    }
    if (
      state.activeEncounter &&
      (state.activeEncounter.playerArmyId === army.id ||
        state.activeEncounter.otherArmyId === army.id)
    ) {
      continue; // Frozen awaiting player's Encounter decision
    }
    if (army.inCombatWithArmyId) {
      const foe = state.armies[army.inCombatWithArmyId];
      if (!foe || getRelationStatus(state, army.countryId, foe.countryId) !== 'war') {
        army.inCombatWithArmyId = null;
      } else {
        continue; // Locked in combat
      }
    }

    // Track friendly merge target if ordered to merge on foot
    if (army.mergeTargetArmyId) {
      const mergeTarget = state.armies[army.mergeTargetArmyId];
      if (
        !mergeTarget ||
        mergeTarget.id === army.id ||
        mergeTarget.countryId !== army.countryId ||
        mergeTarget.inCombatWithArmyId
      ) {
        army.mergeTargetArmyId = null;
        army.targetX = null;
        army.targetY = null;
        army.waypoints = [];
        army.evacuatingHome = false;
      } else if (
        Math.hypot(army.x - mergeTarget.x, army.y - mergeTarget.y) <= COMBAT_CONFIG.MERGE_DISTANCE
      ) {
        mergeArmies(state, mergeTarget.id, army.id);
        continue;
      } else {
        army.targetX = mergeTarget.x;
        army.targetY = mergeTarget.y;
        army.waypoints = [[mergeTarget.x, mergeTarget.y]];
      }
    }

    if (army.targetArmyId) {
      const foe = state.armies[army.targetArmyId];
      if (!foe || getRelationStatus(state, army.countryId, foe.countryId) !== 'war') {
        army.targetArmyId = null;
        army.targetX = null;
        army.targetY = null;
        army.waypoints = [];
        army.evacuatingHome = false;
      } else {
        army.targetX = foe.x;
        army.targetY = foe.y;
        army.waypoints = [[foe.x, foe.y]];
      }
    }

    if (army.embarkingShipId) {
      const ship = state.ships[army.embarkingShipId];
      if (!ship || ship.countryId !== army.countryId) {
        army.embarkingShipId = null;
        army.targetX = null;
        army.targetY = null;
        army.waypoints = [];
        army.evacuatingHome = false;
      } else {
        army.targetX = ship.x;
        army.targetY = ship.y;
        army.waypoints = [[ship.x, ship.y]];
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
        if (army.waypoints && army.waypoints.length > 0) {
          army.waypoints.shift();
        }

        if (
          army.waypoints &&
          army.waypoints.length > 0 &&
          !army.embarkingShipId &&
          !army.targetArmyId &&
          !army.mergeTargetArmyId
        ) {
          army.targetX = army.waypoints[0][0];
          army.targetY = army.waypoints[0][1];
          const underMid = pickRegionAtPoint([army.x, army.y], state.regions);
          if (underMid) army.currentRegionId = underMid.id;
          continue;
        }

        army.targetX = null;
        army.targetY = null;
        army.waypoints = [];
        army.evacuatingHome = false;

        if (army.mergeTargetArmyId) {
          const mergeTarget = state.armies[army.mergeTargetArmyId];
          if (
            mergeTarget &&
            Math.hypot(army.x - mergeTarget.x, army.y - mergeTarget.y) <=
              COMBAT_CONFIG.MERGE_DISTANCE
          ) {
            mergeArmies(state, mergeTarget.id, army.id);
            continue;
          }
        }

        if (army.embarkingShipId) {
          const ship = state.ships[army.embarkingShipId];
          if (ship) {
            for (const [k, cnt] of Object.entries(army.units)) {
              if (cnt > 0) ship.units[k] = (ship.units[k] ?? 0) + cnt;
            }
            if (state.selectedArmyId === army.id) state.selectedArmyId = null;
            state.selectedArmyIds = (state.selectedArmyIds ?? []).filter((id) => id !== army.id);
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
        if (!army.targetArmyId || !state.armies[army.targetArmyId]) {
          army.targetArmyId = null;
        }
      } else {
        const nextX = army.x + (dx / dist) * step;
        const nextY = army.y + (dy / dist) * step;
        const under = pickRegionAtPoint([nextX, nextY], state.regions);
        if (
          under &&
          under.id !== army.currentRegionId &&
          !army.evacuatingHome &&
          !canArmyEnterCountryTerritory(state, army.countryId, under.ownerId)
        ) {
          army.targetX = null;
          army.targetY = null;
          army.waypoints = [];
          army.targetRegionId = null;
          continue;
        }
        army.x = nextX;
        army.y = nextY;
        if (under) {
          army.currentRegionId = under.id;
          if (army.evacuatingHome && under.ownerId === army.countryId) {
            army.evacuatingHome = false;
          }
        }

        // Check mid-step auto-merge when walking to mergeTargetArmyId
        if (army.mergeTargetArmyId) {
          const mergeTarget = state.armies[army.mergeTargetArmyId];
          if (
            mergeTarget &&
            !mergeTarget.inCombatWithArmyId &&
            Math.hypot(army.x - mergeTarget.x, army.y - mergeTarget.y) <=
              COMBAT_CONFIG.MERGE_DISTANCE
          ) {
            mergeArmies(state, mergeTarget.id, army.id);
            continue;
          }
        }
      }
    }
  }

  // 3. Detect & lock opposing war armies within engagement range (including multi-army REINFORCEMENTS!)
  const armyList = Object.values(state.armies);
  for (let i = 0; i < armyList.length; i++) {
    const a = armyList[i];
    if (a.inCombatWithArmyId) continue;
    if ((a.retreatingUntilSimSec ?? 0) > state.simSecondsElapsed) continue;
    if (
      state.activeEncounter &&
      (state.activeEncounter.playerArmyId === a.id ||
        state.activeEncounter.otherArmyId === a.id)
    ) {
      continue;
    }

    for (let j = 0; j < armyList.length; j++) {
      if (i === j) continue;
      const b = armyList[j];
      if (a.countryId === b.countryId) continue;
      if ((b.retreatingUntilSimSec ?? 0) > state.simSecondsElapsed) continue;
      if (
        state.activeEncounter &&
        (state.activeEncounter.playerArmyId === b.id ||
          state.activeEncounter.otherArmyId === b.id)
      ) {
        continue;
      }
      if (getRelationStatus(state, a.countryId, b.countryId) !== 'war') continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) <= COMBAT_CONFIG.COMBAT_ENGAGE_DISTANCE) {
        a.inCombatWithArmyId = b.id;
        a.targetX = null;
        a.targetY = null;
        a.targetArmyId = null;
        a.mergeTargetArmyId = null;
        a.waypoints = [];
        clearCaptureByArmy(state, a.id);

        if (!b.inCombatWithArmyId) {
          b.inCombatWithArmyId = a.id;
          b.targetX = null;
          b.targetY = null;
          b.targetArmyId = null;
          b.mergeTargetArmyId = null;
          b.waypoints = [];
          clearCaptureByArmy(state, b.id);
        }
        break;
      }
    }
  }

  // 3.5 Check if any remaining non-fighting Player army encountered a foreign state's army -> auto-pause & prompt!
  checkPlayerArmyEncounters(state);

  // 4. Process multi-army combat ticks (every 0.5s) with reinforcement combined force & +10% Homeland Defense!
  state.combatTickAccumulator += dtSimSec;
  while (state.combatTickAccumulator >= COMBAT_CONFIG.COMBAT_TICK_SEC) {
    state.combatTickAccumulator -= COMBAT_CONFIG.COMBAT_TICK_SEC;
    const visited = new Set<string>();

    for (const seed of Object.values(state.armies)) {
      if (!seed.inCombatWithArmyId || visited.has(seed.id)) continue;

      // Gather connected battle cluster
      const cluster: ArmyStack[] = [];
      const queue: ArmyStack[] = [seed];
      visited.add(seed.id);

      while (queue.length > 0) {
        const cur = queue.shift()!;
        cluster.push(cur);
        for (const other of Object.values(state.armies)) {
          if (visited.has(other.id) || !other.inCombatWithArmyId) continue;
          if (
            cur.inCombatWithArmyId === other.id ||
            other.inCombatWithArmyId === cur.id ||
            (Math.hypot(cur.x - other.x, cur.y - other.y) <=
              COMBAT_CONFIG.COMBAT_ENGAGE_DISTANCE * 1.2 &&
              getRelationStatus(state, cur.countryId, other.countryId) === 'war')
          ) {
            visited.add(other.id);
            queue.push(other);
          }
        }
      }

      const sideA: ArmyStack[] = [];
      const sideB: ArmyStack[] = [];
      for (const member of cluster) {
        if (
          member.countryId === seed.countryId ||
          getRelationStatus(state, member.countryId, seed.countryId) === 'allied'
        ) {
          sideA.push(member);
        } else if (
          getRelationStatus(state, member.countryId, seed.countryId) === 'war' &&
          !sideA.some((a) => getRelationStatus(state, a.countryId, member.countryId) === 'allied')
        ) {
          sideB.push(member);
        }
      }

      if (sideA.length === 0 || sideB.length === 0) {
        for (const m of cluster) {
          m.inCombatWithArmyId = null;
          m.combatLossCarry = 0;
        }
        continue;
      }

      const stA = computeCombinedForceStats(sideA);
      const stB = computeCombinedForceStats(sideB);
      if (stA.count <= 0 || stB.count <= 0) {
        for (const m of cluster) {
          m.inCombatWithArmyId = null;
          m.combatLossCarry = 0;
        }
        continue;
      }

      const numMultA = Math.min(2.0, Math.pow(stA.count / stB.count, 0.35));
      const numMultB = Math.min(2.0, Math.pow(stB.count / stA.count, 0.35));

      const effAtkA = stA.count * stA.avgDamage * numMultA * COMBAT_CONFIG.COMBAT_TICK_SEC;
      const effAtkB = stB.count * stB.avgDamage * numMultB * COMBAT_CONFIG.COMBAT_TICK_SEC;

      // +10% Homeland Defense Bonus (`HOME_DEFENSE_BONUS`) when fighting on own territory!
      const sideACountries = new Set(sideA.map((a) => a.countryId));
      const sideBCountries = new Set(sideB.map((b) => b.countryId));
      const homeA = sideA.some((a) => {
        const reg = state.regions[a.currentRegionId] ?? pickRegionAtPoint([a.x, a.y], state.regions);
        return Boolean(reg && sideACountries.has(reg.ownerId));
      });
      const homeB = sideB.some((b) => {
        const reg = state.regions[b.currentRegionId] ?? pickRegionAtPoint([b.x, b.y], state.regions);
        return Boolean(reg && sideBCountries.has(reg.ownerId));
      });

      const defDenomA =
        (30 + stA.avgDefense * 2) * (homeA ? 1 + COMBAT_CONFIG.HOME_DEFENSE_BONUS : 1);
      const defDenomB =
        (30 + stB.avgDefense * 2) * (homeB ? 1 + COMBAT_CONFIG.HOME_DEFENSE_BONUS : 1);

      const rawLossOnB = effAtkA / defDenomB;
      const rawLossOnA = effAtkB / defDenomA;

      distributeSideCasualties(state, sideB, rawLossOnB);
      distributeSideCasualties(state, sideA, rawLossOnA);

      // Remove wiped armies & maintain combat links among survivors
      const aliveA = sideA.filter((a) => {
        if (getTotalSoldiers(a.units) <= 0) {
          if (state.selectedArmyId === a.id) state.selectedArmyId = null;
          state.selectedArmyIds = (state.selectedArmyIds ?? []).filter((id) => id !== a.id);
          delete state.armies[a.id];
          return false;
        }
        return true;
      });
      const aliveB = sideB.filter((b) => {
        if (getTotalSoldiers(b.units) <= 0) {
          if (state.selectedArmyId === b.id) state.selectedArmyId = null;
          state.selectedArmyIds = (state.selectedArmyIds ?? []).filter((id) => id !== b.id);
          delete state.armies[b.id];
          return false;
        }
        return true;
      });

      if (aliveA.length === 0 || aliveB.length === 0) {
        for (const m of [...aliveA, ...aliveB]) {
          m.inCombatWithArmyId = null;
          m.combatLossCarry = 0;
        }
      } else {
        for (const a of aliveA) {
          if (!a.inCombatWithArmyId || !state.armies[a.inCombatWithArmyId]) {
            a.inCombatWithArmyId = aliveB[0].id;
          }
        }
        for (const b of aliveB) {
          if (!b.inCombatWithArmyId || !state.armies[b.inCombatWithArmyId]) {
            b.inCombatWithArmyId = aliveA[0].id;
          }
        }
      }
    }
  }

  // 5. Process Wounded Batches (single WoundedGroup per country)
  coalesceWoundedByCountry(state);
  const remainingWounded = [];
  for (const w of state.wounded) {
    if (w.waitingForHospital) {
      const newlyBuiltHosp = findNearestHospitalRegion(state, w.countryId, w.from);
      if (newlyBuiltHosp) {
        const [hx, hy] = getRegionBuildingPoint(newlyBuiltHosp);
        w.waitingForHospital = false;
        w.toRegionId = newlyBuiltHosp.id;
        w.to = [hx, hy];
        w.travelProgress = 0;
      } else {
        remainingWounded.push(w);
        continue;
      }
    }

    const hospReg = state.regions[w.toRegionId];
    if (
      !hospReg ||
      hospReg.ownerId !== w.countryId ||
      getActiveBuildingLevel(hospReg.building) <= 0 ||
      !hospReg.building ||
      hospReg.building.type !== 'hospital'
    ) {
      const curPos: Point = [
        w.from[0] + (w.to[0] - w.from[0]) * w.travelProgress,
        w.from[1] + (w.to[1] - w.from[1]) * w.travelProgress,
      ];
      const alt = findNearestHospitalRegion(state, w.countryId, curPos);
      if (!alt) continue;
      const [ax, ay] = getRegionBuildingPoint(alt);
      w.from = curPos;
      w.toRegionId = alt.id;
      w.to = [ax, ay];
      w.travelProgress = 0;
    }

    if (w.travelProgress < 1) {
      const dist = Math.max(0.2, Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]));
      w.travelProgress = Math.min(
        1,
        w.travelProgress +
          (COMBAT_CONFIG.WOUNDED_TRAVEL_SPEED * Math.max(1, healSpeedMult) * dtSimSec) / dist,
      );
      remainingWounded.push(w);
    } else {
      w.healElapsedSec += dtSimSec * Math.max(1, healSpeedMult);
      if (w.healElapsedSec >= w.healRequiredSec) {
        const targetReg = state.regions[w.toRegionId];
        if (targetReg) {
          const [rx, ry] = getRegionBuildingPoint(targetReg);
          const healedTotal = getTotalSoldiers(w.units);
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
              x: rx,
              y: ry,
              currentRegionId: targetReg.id,
              units: { ...w.units },
              targetX: null,
              targetY: null,
              waypoints: [],
              targetRegionId: null,
              targetArmyId: null,
              mergeTargetArmyId: null,
              inCombatWithArmyId: null,
              embarkingShipId: null,
            };
            state.armies[recovered.id] = recovered;
          }

          if (w.countryId === state.playerCountryId && healedTotal > 0) {
            pushFloatingEffect(state, {
              text: `+${healedTotal} İyileşti!`,
              color: '#4ade80',
              scope: 'world',
              x: rx,
              y: ry,
              count: healedTotal,
              durationMs: 1800,
            });
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
