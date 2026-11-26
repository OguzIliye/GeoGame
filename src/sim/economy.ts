import {
  BUILDINGS,
  ECONOMY,
  LOAN_CONFIG,
  SHIELD_ORDER,
  SHIELDS,
  WEAPON_ORDER,
  WEAPONS,
} from '../config/balance';
import { pickRegionAtPoint } from '../map/arenaBuilder';
import type {
  ArmyStack,
  BuildingType,
  Country,
  FloatingEffect,
  GameState,
  ImportantToast,
  Point,
  ProductionOrder,
  Region,
  ShieldId,
  TrainingOrder,
  TransportShip,
  UnitTypeKey,
  WeaponId,
} from '../types';

let uidCounter = 1;
export function nextUid(prefix: string): string {
  return `${prefix}_${uidCounter++}`;
}

export function getCountryRegions(state: GameState, countryId: string): Region[] {
  return Object.values(state.regions).filter((r) => r.ownerId === countryId);
}

export function getRegionBuildingPoint(reg: Region): Point {
  return [reg.building?.x ?? reg.centroid[0], reg.building?.y ?? reg.centroid[1]];
}

export function clearPropsUnderBuilding(reg: Region, bx: number, by: number, radius = 0.44): void {
  const r2 = radius * radius;
  reg.props = reg.props.filter((p) => {
    const dx = p.x - bx;
    const dy = p.y - by;
    return dx * dx + dy * dy > r2;
  });
}

export function getActiveBuildingLevel(b: Region['building']): number {
  if (!b) return 0;
  return b.constructing ? Math.max(0, b.level - 1) : b.level;
}

/** Count effective active (completed) buildings of a given type for a country. */
export function getEffectiveBuildingCount(
  state: GameState,
  countryId: string,
  type: BuildingType,
): number {
  let total = 0;
  for (const reg of Object.values(state.regions)) {
    if (reg.ownerId !== countryId || !reg.building) continue;
    const activeLv = getActiveBuildingLevel(reg.building);
    if (activeLv <= 0) continue;
    if (reg.building.type === type) {
      total += activeLv;
    }
  }
  return total;
}

/** Count all buildings of a given type including under-construction ones (e.g. MAX_UNIVERSITIES = 1 check). */
export function getTotalBuildingCountIncludingConstructing(
  state: GameState,
  countryId: string,
  type: BuildingType,
): number {
  let total = 0;
  for (const reg of Object.values(state.regions)) {
    if (reg.ownerId === countryId && reg.building?.type === type) {
      total += 1;
    }
  }
  return total;
}

export function getActiveTradeAgreementCount(state: GameState, countryId: string): number {
  let count = 0;
  for (const edge of Object.values(state.diplomacy)) {
    if (edge.a !== countryId && edge.b !== countryId) continue;
    if (edge.status === 'war') continue;
    const otherId = edge.a === countryId ? edge.b : edge.a;
    if (state.countries[otherId]?.eliminated) continue;
    if ((edge as { tradeAgreement?: boolean }).tradeAgreement) {
      count += 1;
    }
  }
  return count;
}

export function getCountryHealthPct(state: GameState, countryId: string): number {
  const hospitals = getEffectiveBuildingCount(state, countryId, 'hospital');
  return Math.min(
    ECONOMY.MAX_HEALTH_PCT,
    ECONOMY.BASE_HEALTH_PCT + hospitals * ECONOMY.HOSPITAL_HEALTH_BONUS_PCT,
  );
}

export function getCountryGrossIncomePerTick(state: GameState, countryId: string): number {
  const banks = getEffectiveBuildingCount(state, countryId, 'bank');
  const basePerTick =
    (ECONOMY.BASE_MONEY_PER_SEC + banks * ECONOMY.BANK_MONEY_PER_SEC) * ECONOMY.INCOME_TICK_SEC;
  const tradeCount = getActiveTradeAgreementCount(state, countryId);
  return Math.round(basePerTick * (1 + tradeCount * 0.1));
}

export function getCountryMoneyPerSec(state: GameState, countryId: string): number {
  return Math.round((getCountryGrossIncomePerTick(state, countryId) / ECONOMY.INCOME_TICK_SEC) * 100) / 100;
}

export function getCountryManpowerPerSec(state: GameState, countryId: string): number {
  const healthPct = getCountryHealthPct(state, countryId);
  const fromHealth =
    ECONOMY.BASE_MANPOWER_PER_SEC +
    ((healthPct - ECONOMY.BASE_HEALTH_PCT) / ECONOMY.HOSPITAL_HEALTH_BONUS_PCT) *
      ECONOMY.HOSPITAL_MANPOWER_PER_SEC;
  return Math.round(fromHealth * 100) / 100;
}

/** v1.2 Rule: Each country starts with ONLY 1 University (no Bank, Barracks, or Factory). */
export function placeInitialCountryBuildings(state: GameState): void {
  for (const country of Object.values(state.countries)) {
    const owned = getCountryRegions(state, country.id);
    if (owned.length === 0) continue;

    const sorted = [...owned].sort((a, b) => b.area - a.area);
    sorted[0].building = {
      type: 'university',
      level: 1,
      constructing: false,
      progressSec: 0,
      totalSec: 0,
      x: sorted[0].centroid[0],
      y: sorted[0].centroid[1],
    };
    clearPropsUnderBuilding(sorted[0], sorted[0].centroid[0], sorted[0].centroid[1]);
  }
}

export function ensurePortShipForRegion(state: GameState, reg: Region): TransportShip | null {
  if (!reg.isCoastal || !reg.coastalAnchor) return null;
  const existing = Object.values(state.ships).find(
    (s) => s.homeRegionId === reg.id && s.countryId === reg.ownerId,
  );
  if (existing) return existing;

  const ship: TransportShip = {
    id: nextUid('ship'),
    countryId: reg.ownerId,
    homeRegionId: reg.id,
    x: reg.coastalAnchor[0],
    y: reg.coastalAnchor[1],
    targetX: null,
    targetY: null,
    landingRegionId: null,
    units: {},
  };
  state.ships[ship.id] = ship;
  return ship;
}

export function validateBuildingPlacementAtPoint(
  state: GameState,
  countryId: string,
  type: BuildingType,
  pt: Point,
): { ok: boolean; region: Region | null; reason?: string } {
  const country = state.countries[countryId];
  if (!country) return { ok: false, region: null, reason: 'Geçersiz ülke.' };

  if (
    type === 'university' &&
    getTotalBuildingCountIncludingConstructing(state, countryId, 'university') >=
      ECONOMY.MAX_UNIVERSITIES
  ) {
    return {
      ok: false,
      region: null,
      reason: `Ülke başına en fazla ${ECONOMY.MAX_UNIVERSITIES} Üniversite kurulabilir.`,
    };
  }

  const reg = pickRegionAtPoint(pt, state.regions);
  if (!reg) {
    return { ok: false, region: null, reason: 'Haritada geçerli bir kara noktası seçin.' };
  }
  if (reg.ownerId !== countryId) {
    return { ok: false, region: reg, reason: 'Yalnızca kendi toprağınıza bina kurabilirsiniz.' };
  }
  if (reg.building !== null) {
    return { ok: false, region: reg, reason: 'Bu bölgede zaten bir bina var (maks. 1).' };
  }
  if (type === 'port' && !reg.isCoastal) {
    return { ok: false, region: reg, reason: 'Liman yalnızca kıyı bölgesine kurulabilir.' };
  }
  const spec = BUILDINGS[type];
  if (country.money < spec.cost) {
    return { ok: false, region: reg, reason: `Yetersiz para (${spec.cost} gerekli).` };
  }
  return { ok: true, region: reg };
}

export function startBuildingConstruction(
  state: GameState,
  countryId: string,
  regionId: string,
  type: BuildingType,
  customPoint?: Point,
): { ok: boolean; error?: string } {
  const country = state.countries[countryId];
  const reg = state.regions[regionId];
  if (!country || !reg) return { ok: false, error: 'Geçersiz bölge veya ülke.' };
  if (reg.ownerId !== countryId) return { ok: false, error: 'Bu bölge ülkenize ait değil.' };
  if (reg.building !== null) return { ok: false, error: 'Bu bölgede zaten bir bina var (maks. 1).' };
  if (
    type === 'university' &&
    getTotalBuildingCountIncludingConstructing(state, countryId, 'university') >=
      ECONOMY.MAX_UNIVERSITIES
  ) {
    return {
      ok: false,
      error: `Ülke başına en fazla ${ECONOMY.MAX_UNIVERSITIES} Üniversite kurulabilir.`,
    };
  }
  if (type === 'port' && !reg.isCoastal) {
    return { ok: false, error: 'Liman yalnızca denize kıyısı olan bölgelere kurulabilir.' };
  }

  let bx = reg.centroid[0];
  let by = reg.centroid[1];
  if (customPoint) {
    const hit = pickRegionAtPoint(customPoint, { [reg.id]: reg });
    if (!hit) {
      return { ok: false, error: 'Seçilen nokta bu bölgenin sınırları içinde değil.' };
    }
    bx = customPoint[0];
    by = customPoint[1];
  }

  const spec = BUILDINGS[type];
  if (country.money < spec.cost) return { ok: false, error: 'Yetersiz para.' };

  country.money -= spec.cost;
  reg.building = {
    type,
    level: 1,
    constructing: true,
    progressSec: 0,
    totalSec: spec.buildSec,
    x: bx,
    y: by,
    parallelProduction: type === 'factory' ? [] : undefined,
    trainingQueue: type === 'barracks' ? [] : undefined,
  };
  clearPropsUnderBuilding(reg, bx, by);
  return { ok: true };
}

export function demolishBuilding(
  state: GameState,
  countryId: string,
  regionId: string,
): { ok: boolean; refund?: number; demolishedType?: BuildingType; error?: string } {
  const country = state.countries[countryId];
  const reg = state.regions[regionId];
  if (!country || !reg) return { ok: false, error: 'Geçersiz bölge veya ülke.' };
  if (reg.ownerId !== countryId) return { ok: false, error: 'Bu bölge ülkenize ait değil.' };
  if (!reg.building) return { ok: false, error: 'Bu bölgede yıkılacak bina yok.' };

  const bType = reg.building.type;
  const refund = Math.floor(BUILDINGS[bType].cost * ECONOMY.DEMOLISH_REFUND_RATE);
  country.money += refund;

  if (bType === 'port') {
    for (const ship of Object.values(state.ships)) {
      const carried = Object.values(ship.units).reduce((s, v) => s + (v > 0 ? v : 0), 0);
      if (ship.homeRegionId === reg.id && ship.countryId === countryId && carried === 0 && ship.targetX === null) {
        delete state.ships[ship.id];
      }
    }
  }

  reg.building = null;
  if (
    bType === 'university' &&
    getEffectiveBuildingCount(state, countryId, 'university') <= 0
  ) {
    country.activeResearch = null;
  }

  return { ok: true, refund, demolishedType: bType };
}

export function takeBankLoan(
  state: GameState,
  countryId: string,
  amount: (typeof LOAN_CONFIG.OPTIONS)[number],
): { ok: boolean; addedDebt?: number; error?: string } {
  const country = state.countries[countryId];
  if (!country) return { ok: false, error: 'Ülke bulunamadı.' };
  if (!(LOAN_CONFIG.OPTIONS as readonly number[]).includes(amount)) {
    return { ok: false, error: 'Geçersiz kredi tutarı.' };
  }
  const banks = getEffectiveBuildingCount(state, countryId, 'bank');
  if (banks <= 0) {
    return { ok: false, error: 'Borç almak için tamamlanmış bir Banka gerekli.' };
  }

  const addedDebt = Math.round(amount * (1 + LOAN_CONFIG.INTEREST_RATE));
  if (country.debt + addedDebt > LOAN_CONFIG.MAX_DEBT) {
    return {
      ok: false,
      error: `Maksimum borç tavanı (${LOAN_CONFIG.MAX_DEBT} 💰) aşılıyor.`,
    };
  }

  country.money += amount;
  country.debt += addedDebt;
  return { ok: true, addedDebt };
}

export function repayBankLoan(
  state: GameState,
  countryId: string,
  customAmount?: number,
): { ok: boolean; paid?: number; remainingDebt?: number; error?: string } {
  const country = state.countries[countryId];
  if (!country) return { ok: false, error: 'Ülke bulunamadı.' };
  if (country.debt <= 0) return { ok: false, error: 'Aktif borcunuz bulunmuyor.' };

  const available = Math.floor(country.money);
  if (available <= 0) return { ok: false, error: 'Borç kapatmak için yeterli para yok.' };

  const desired = customAmount !== undefined ? Math.floor(customAmount) : country.debt;
  const paid = Math.min(country.debt, available, Math.max(1, desired));
  country.money -= paid;
  country.debt = Math.max(0, Math.round((country.debt - paid) * 100) / 100);
  return { ok: true, paid, remainingDebt: country.debt };
}

export function startTechResearch(
  state: GameState,
  countryId: string,
  branch: 'weapon' | 'shield',
): { ok: boolean; error?: string } {
  const country = state.countries[countryId];
  if (!country) return { ok: false, error: 'Ülke bulunamadı.' };
  const uniCount = getEffectiveBuildingCount(state, countryId, 'university');
  if (uniCount <= 0) return { ok: false, error: 'Araştırma için Üniversite gerekli.' };
  if (country.activeResearch) return { ok: false, error: 'Zaten devam eden bir araştırma var.' };

  if (branch === 'weapon') {
    const nextWeapon = WEAPON_ORDER.find((w) => !country.unlockedWeapons.includes(w));
    if (!nextWeapon) return { ok: false, error: 'Tüm silahlar açıldı.' };
    const spec = WEAPONS[nextWeapon];
    if (country.money < spec.researchCost) return { ok: false, error: 'Yetersiz para.' };
    country.money -= spec.researchCost;
    country.activeResearch = {
      branch: 'weapon',
      targetId: nextWeapon,
      progressSec: 0,
      totalSec: spec.researchSec,
    };
    return { ok: true };
  } else {
    const nextShield = SHIELD_ORDER.find((s) => !country.unlockedShields.includes(s));
    if (!nextShield) return { ok: false, error: 'Tüm kalkanlar açıldı.' };
    const spec = SHIELDS[nextShield];
    if (country.money < spec.researchCost) return { ok: false, error: 'Yetersiz para.' };
    country.money -= spec.researchCost;
    country.activeResearch = {
      branch: 'shield',
      targetId: nextShield,
      progressSec: 0,
      totalSec: spec.researchSec,
    };
    return { ok: true };
  }
}

export interface FactoryBatchItemInput {
  category: 'weapon' | 'shield';
  itemId: WeaponId | Exclude<ShieldId, 'none'>;
  count: number;
}

/** Queue one or more equipment types in parallel lines on a specific Factory building. */
export function queueFactoryParallelBatch(
  state: GameState,
  countryId: string,
  regionId: string,
  orders: FactoryBatchItemInput[],
): { ok: boolean; totalCost?: number; error?: string } {
  const country = state.countries[countryId];
  const reg = state.regions[regionId];
  if (!country || !reg || reg.ownerId !== countryId) {
    return { ok: false, error: 'Geçersiz Fabrika bölgesi.' };
  }
  if (!reg.building || reg.building.type !== 'factory' || reg.building.constructing) {
    return { ok: false, error: 'Bu bölgede aktif bir Fabrika bulunmuyor.' };
  }

  const clean = orders
    .map((o) => ({ ...o, count: Math.floor(o.count) }))
    .filter((o) => o.count > 0);
  if (clean.length === 0) {
    return { ok: false, error: 'Üretilecek en az 1 ekipman seçin.' };
  }

  let totalCost = 0;
  for (const item of clean) {
    if (item.category === 'weapon') {
      const wId = item.itemId as WeaponId;
      if (!country.unlockedWeapons.includes(wId)) {
        return { ok: false, error: `${WEAPONS[wId]?.name ?? wId} henüz Üniversitede açılmadı.` };
      }
      totalCost += WEAPONS[wId].prodCost * item.count;
    } else {
      const sId = item.itemId as Exclude<ShieldId, 'none'>;
      if (!country.unlockedShields.includes(sId)) {
        return { ok: false, error: `${SHIELDS[sId]?.name ?? sId} henüz Üniversitede açılmadı.` };
      }
      totalCost += SHIELDS[sId].prodCost * item.count;
    }
  }

  if (country.money < totalCost) {
    return { ok: false, error: `Yetersiz para (${totalCost} 💰 gerekli).` };
  }

  country.money -= totalCost;
  if (!reg.building.parallelProduction) {
    reg.building.parallelProduction = [];
  }

  for (const item of clean) {
    const unitTimeSec =
      item.category === 'weapon'
        ? WEAPONS[item.itemId as WeaponId].prodSec
        : SHIELDS[item.itemId as Exclude<ShieldId, 'none'>].prodSec;

    const existing = reg.building.parallelProduction.find(
      (p) => p.category === item.category && p.itemId === item.itemId,
    );
    if (existing) {
      existing.remainingCount += item.count;
      existing.unitTimeSec = unitTimeSec;
    } else {
      reg.building.parallelProduction.push({
        id: nextUid('prod'),
        category: item.category,
        itemId: item.itemId,
        remainingCount: item.count,
        progressSec: 0,
        unitTimeSec,
      });
    }
  }

  return { ok: true, totalCost };
}

/** Convenience wrapper that dispatches to a specific or least-busy active Factory of the country. */
export function queueFactoryProduction(
  state: GameState,
  countryId: string,
  category: 'weapon' | 'shield',
  itemId: WeaponId | Exclude<ShieldId, 'none'>,
  count: number,
  regionId?: string,
): { ok: boolean; error?: string } {
  const country = state.countries[countryId];
  if (!country || count <= 0) return { ok: false, error: 'Geçersiz üretim miktarı.' };

  let targetRegId = regionId;
  if (!targetRegId) {
    const activeFactories = getCountryRegions(state, countryId).filter(
      (r) => r.building?.type === 'factory' && !r.building.constructing,
    );
    if (activeFactories.length === 0) {
      return { ok: false, error: 'Üretim için tamamlanmış bir Fabrika gerekli.' };
    }
    // Prefer factory where this item line has shortest remaining queue
    activeFactories.sort((a, b) => {
      const loadA =
        a.building?.parallelProduction?.find((p) => p.category === category && p.itemId === itemId)
          ?.remainingCount ?? 0;
      const loadB =
        b.building?.parallelProduction?.find((p) => p.category === category && p.itemId === itemId)
          ?.remainingCount ?? 0;
      return loadA - loadB;
    });
    targetRegId = activeFactories[0].id;
  }

  const res = queueFactoryParallelBatch(state, countryId, targetRegId, [
    { category, itemId, count },
  ]);
  return { ok: res.ok, error: res.error };
}

/**
 * Shared v1.2 Barracks scarce-resource `min` training formula (used by BOTH Player UI & AI):
 * - effW[w] = min(inputW[w], weaponsStock[w]), effS[s] = min(inputS[s], shieldsStock[s])
 * - actualSoldiers = min(requestedSoldiers, floor(manpower), sum(effW))
 * - Shields are OPTIONAL: up to min(actualSoldiers, sum(effS)) shields are paired starting from the strongest weapons;
 *   remaining soldiers train with shield = 'none'. Unused inputs are never wasted!
 */
export function queueBarracksTrainingBatch(
  state: GameState,
  countryId: string,
  regionId: string,
  requestedSoldiers: number,
  weaponInputs: Partial<Record<WeaponId, number>>,
  shieldInputs: Partial<Record<Exclude<ShieldId, 'none'>, number>>,
): { ok: boolean; trainedSoldiers?: number; error?: string } {
  const country = state.countries[countryId];
  const reg = state.regions[regionId];
  if (!country || !reg || reg.ownerId !== countryId) {
    return { ok: false, error: 'Geçersiz Kışla bölgesi.' };
  }
  if (!reg.building || reg.building.type !== 'barracks' || reg.building.constructing) {
    return { ok: false, error: 'Bu bölgede aktif bir Kışla bulunmuyor.' };
  }

  const req = Math.floor(requestedSoldiers);
  if (req <= 0) {
    return { ok: false, error: 'En az 1 asker sayısı girmelisiniz.' };
  }

  const availManpower = Math.floor(country.manpower);
  if (availManpower <= 0) {
    return { ok: false, error: 'Yetersiz Manpower.' };
  }

  const effW: Record<WeaponId, number> = {
    sword: 0,
    spear: 0,
    pistol: 0,
    ak: 0,
    bazooka: 0,
  };
  let sumEffW = 0;
  for (const w of WEAPON_ORDER) {
    const entered = Math.max(0, Math.floor(weaponInputs[w] ?? 0));
    effW[w] = Math.min(entered, country.weaponsStock[w]);
    sumEffW += effW[w];
  }

  if (sumEffW <= 0) {
    return { ok: false, error: 'Asker yetiştirmek için en az 1 stokta silah seçmelisiniz.' };
  }

  const actualSoldiers = Math.min(req, availManpower, sumEffW);
  if (actualSoldiers <= 0) {
    return { ok: false, error: 'Yeterli kaynak bulunmuyor.' };
  }

  const effS: Record<Exclude<ShieldId, 'none'>, number> = {
    wood: 0,
    bronze: 0,
    steel: 0,
    diamond: 0,
    forcefield: 0,
  };
  for (const s of SHIELD_ORDER) {
    const entered = Math.max(0, Math.floor(shieldInputs[s] ?? 0));
    effS[s] = Math.min(entered, country.shieldsStock[s]);
  }

  // Allocate actualSoldiers across highest-tier weapons first so excess lower-tier inputs aren't consumed
  const weaponsDesc = [...WEAPON_ORDER].reverse();
  const shieldsDesc = [...SHIELD_ORDER].reverse();

  const chosenWeapons: { weapon: WeaponId; count: number }[] = [];
  let remSoldiers = actualSoldiers;
  for (const w of weaponsDesc) {
    if (remSoldiers <= 0) break;
    const take = Math.min(effW[w], remSoldiers);
    if (take > 0) {
      chosenWeapons.push({ weapon: w, count: take });
      remSoldiers -= take;
    }
  }

  // Pair highest-tier shields with highest-tier chosen weapons; remainder gets 'none'
  if (!reg.building.trainingQueue) {
    reg.building.trainingQueue = [];
  }

  country.manpower -= actualSoldiers;

  let sCursor = 0;
  for (const cw of chosenWeapons) {
    country.weaponsStock[cw.weapon] -= cw.count;
    let leftForWeapon = cw.count;

    while (leftForWeapon > 0 && sCursor < shieldsDesc.length) {
      const sId = shieldsDesc[sCursor];
      const sAvail = effS[sId];
      if (sAvail <= 0) {
        sCursor++;
        continue;
      }
      const pairCount = Math.min(leftForWeapon, sAvail);
      effS[sId] -= pairCount;
      country.shieldsStock[sId] -= pairCount;
      leftForWeapon -= pairCount;

      reg.building.trainingQueue.push({
        id: nextUid('train'),
        weapon: cw.weapon,
        shield: sId,
        remainingCount: pairCount,
        progressSec: 0,
        unitTimeSec: ECONOMY.BARRACKS_TRAIN_SEC_PER_SOLDIER,
      });
    }

    if (leftForWeapon > 0) {
      reg.building.trainingQueue.push({
        id: nextUid('train'),
        weapon: cw.weapon,
        shield: 'none',
        remainingCount: leftForWeapon,
        progressSec: 0,
        unitTimeSec: ECONOMY.BARRACKS_TRAIN_SEC_PER_SOLDIER,
      });
    }
  }

  return { ok: true, trainedSoldiers: actualSoldiers };
}

/** Backwards-compatible wrapper that queues training on a specific or least-busy active Barracks. */
export function queueBarracksTraining(
  state: GameState,
  countryId: string,
  weapon: WeaponId,
  shield: ShieldId,
  count: number,
  regionId?: string,
): { ok: boolean; error?: string } {
  const country = state.countries[countryId];
  if (!country || count <= 0) return { ok: false, error: 'Geçersiz asker sayısı.' };

  let targetRegId = regionId;
  if (!targetRegId) {
    const activeBarracks = getCountryRegions(state, countryId).filter(
      (r) => r.building?.type === 'barracks' && !r.building.constructing,
    );
    if (activeBarracks.length === 0) {
      return { ok: false, error: 'Asker yetiştirmek için tamamlanmış bir Kışla gerekli.' };
    }
    activeBarracks.sort((a, b) => {
      const qA = (a.building?.trainingQueue ?? []).reduce((s, o) => s + o.remainingCount, 0);
      const qB = (b.building?.trainingQueue ?? []).reduce((s, o) => s + o.remainingCount, 0);
      return qA - qB;
    });
    targetRegId = activeBarracks[0].id;
  }

  if (Math.floor(country.manpower) < count) return { ok: false, error: 'Yetersiz Manpower.' };
  if (country.weaponsStock[weapon] < count) return { ok: false, error: 'Yetersiz silah stoğu.' };
  if (shield !== 'none' && country.shieldsStock[shield] < count) {
    return { ok: false, error: 'Yetersiz kalkan stoğu.' };
  }

  const res = queueBarracksTrainingBatch(
    state,
    countryId,
    targetRegId,
    count,
    { [weapon]: count },
    shield === 'none' ? {} : { [shield]: count },
  );
  return { ok: res.ok, error: res.error };
}

export function getCountryActiveProductionOrders(
  state: GameState,
  countryId: string,
): { regionId: string; order: ProductionOrder }[] {
  const out: { regionId: string; order: ProductionOrder }[] = [];
  for (const reg of Object.values(state.regions)) {
    if (reg.ownerId !== countryId || reg.building?.type !== 'factory' || reg.building.constructing) {
      continue;
    }
    for (const order of reg.building.parallelProduction ?? []) {
      if (order.remainingCount > 0) {
        out.push({ regionId: reg.id, order });
      }
    }
  }
  return out;
}

export function getCountryActiveTrainingOrders(
  state: GameState,
  countryId: string,
): { regionId: string; order: TrainingOrder }[] {
  const out: { regionId: string; order: TrainingOrder }[] = [];
  for (const reg of Object.values(state.regions)) {
    if (reg.ownerId !== countryId || reg.building?.type !== 'barracks' || reg.building.constructing) {
      continue;
    }
    for (const order of reg.building.trainingQueue ?? []) {
      if (order.remainingCount > 0) {
        out.push({ regionId: reg.id, order });
      }
    }
  }
  return out;
}

export function getBarracksTrainingProgress(
  b: Region['building'],
): { active: boolean; remainingSoldiers: number; pct: number } {
  if (!b || b.type !== 'barracks' || b.constructing || !b.trainingQueue || b.trainingQueue.length === 0) {
    return { active: false, remainingSoldiers: 0, pct: 0 };
  }
  const remainingSoldiers = b.trainingQueue.reduce((s, o) => s + o.remainingCount, 0);
  if (remainingSoldiers <= 0) return { active: false, remainingSoldiers: 0, pct: 0 };
  const head = b.trainingQueue[0];
  const pct = head.unitTimeSec > 0 ? Math.min(1, head.progressSec / head.unitTimeSec) : 0;
  return { active: true, remainingSoldiers, pct };
}

export function pushImportantToast(
  state: GameState,
  message: string,
  kind: ImportantToast['kind'],
): void {
  state.toasts.unshift({
    id: nextUid('toast'),
    message,
    kind,
    createdAtRealMs: Date.now(),
  });
  if (state.toasts.length > 5) {
    state.toasts.length = 5;
  }
}

export function pushFloatingEffect(
  state: GameState,
  eff: Omit<FloatingEffect, 'id' | 'createdAtRealMs'>,
): void {
  if (!state.floatingEffects) state.floatingEffects = [];
  const now = Date.now();
  // Prune expired effects first
  state.floatingEffects = state.floatingEffects.filter(
    (e) => now - e.createdAtRealMs < e.durationMs,
  );
  state.floatingEffects.push({
    ...eff,
    id: nextUid('fx'),
    createdAtRealMs: now,
  });
  if (state.floatingEffects.length > 24) {
    state.floatingEffects.splice(0, state.floatingEffects.length - 24);
  }
}

export function spawnUnitsAtBarracksRegion(
  state: GameState,
  countryId: string,
  spawnRegion: Region,
  unitKey: UnitTypeKey,
  count: number,
): ArmyStack | null {
  if (count <= 0) return null;
  const [sx, sy] = getRegionBuildingPoint(spawnRegion);

  // Merge into an idle friendly stack already standing right at this barracks
  const existing = Object.values(state.armies).find(
    (a) =>
      a.countryId === countryId &&
      a.currentRegionId === spawnRegion.id &&
      a.targetX === null &&
      a.inCombatWithArmyId === null &&
      Math.hypot(a.x - sx, a.y - sy) < 0.45,
  );

  if (existing) {
    existing.units[unitKey] = (existing.units[unitKey] ?? 0) + count;
    return existing;
  }

  const stack: ArmyStack = {
    id: nextUid('army'),
    countryId,
    x: sx,
    y: sy,
    currentRegionId: spawnRegion.id,
    units: { [unitKey]: count },
    targetX: null,
    targetY: null,
    waypoints: [],
    targetRegionId: null,
    targetArmyId: null,
    inCombatWithArmyId: null,
    embarkingShipId: null,
  };
  state.armies[stack.id] = stack;
  return stack;
}

export function spawnUnitsIntoCountryBarracks(
  state: GameState,
  countryId: string,
  unitKey: UnitTypeKey,
  count: number,
  preferredRegionId?: string,
): ArmyStack | null {
  if (count <= 0) return null;
  const owned = getCountryRegions(state, countryId);
  if (owned.length === 0) return null;

  const preferred =
    preferredRegionId && state.regions[preferredRegionId]?.ownerId === countryId
      ? state.regions[preferredRegionId]
      : null;

  const spawnRegion =
    preferred ??
    owned.find(
      (r) => r.building && !r.building.constructing && r.building.type === 'barracks',
    ) ??
    owned[0];

  return spawnUnitsAtBarracksRegion(state, countryId, spawnRegion, unitKey, count);
}

/** Tick all economy (5s batch income + debt deduction), construction, research, and building-level Factory/Barracks queues. */
export function tickEconomyAndQueues(
  state: GameState,
  dtSimSec: number,
  buildAndProdSpeedMult = 1,
): void {
  if (dtSimSec <= 0) return;

  const workDt = dtSimSec * Math.max(1, buildAndProdSpeedMult);

  // 1. Building constructions + Building-level Factory & Barracks queues
  for (const reg of Object.values(state.regions)) {
    const b = reg.building;
    if (!b) continue;
    const owner = state.countries[reg.ownerId];
    if (!owner || owner.eliminated) continue;

    if (b.constructing) {
      b.progressSec += workDt;
      if (b.progressSec >= b.totalSec) {
        b.constructing = false;
        b.progressSec = b.totalSec;
        if (b.type === 'port') {
          ensurePortShipForRegion(state, reg);
        }
      }
      continue;
    }

    // Independent parallel Factory production lines (each unlocked item line runs in parallel!)
    if (b.type === 'factory' && b.parallelProduction && b.parallelProduction.length > 0) {
      for (const line of b.parallelProduction) {
        if (line.remainingCount <= 0) continue;
        line.progressSec += workDt;
        while (line.progressSec >= line.unitTimeSec && line.remainingCount > 0) {
          line.progressSec -= line.unitTimeSec;
          line.remainingCount -= 1;
          if (line.category === 'weapon') {
            owner.weaponsStock[line.itemId as WeaponId] += 1;
          } else {
            owner.shieldsStock[line.itemId as Exclude<ShieldId, 'none'>] += 1;
          }
        }
        if (line.remainingCount <= 0) {
          line.progressSec = 0;
        }
      }
      b.parallelProduction = b.parallelProduction.filter((l) => l.remainingCount > 0);
    }

    // Independent Barracks training queue (spawns right next to THIS Barracks!)
    if (b.type === 'barracks' && b.trainingQueue && b.trainingQueue.length > 0) {
      let budgetSec = workDt;
      let spawnedTotal = 0;
      while (budgetSec > 0 && b.trainingQueue.length > 0) {
        const order = b.trainingQueue[0];
        const needed = order.unitTimeSec - order.progressSec;
        if (budgetSec >= needed) {
          budgetSec -= needed;
          order.progressSec = 0;
          order.remainingCount -= 1;
          const unitKey: UnitTypeKey = `${order.weapon}:${order.shield}`;
          spawnUnitsAtBarracksRegion(state, owner.id, reg, unitKey, 1);
          spawnedTotal += 1;
          if (order.remainingCount <= 0) {
            b.trainingQueue.shift();
          }
        } else {
          order.progressSec += budgetSec;
          budgetSec = 0;
        }
      }

      if (spawnedTotal > 0 && owner.isPlayer) {
        const [bx, by] = getRegionBuildingPoint(reg);
        const now = Date.now();
        const recent = state.floatingEffects?.find(
          (e) =>
            e.scope === 'world' &&
            e.color === '#4ade80' &&
            e.x !== undefined &&
            e.y !== undefined &&
            Math.hypot(e.x - bx, e.y - by) < 0.1 &&
            now - e.createdAtRealMs < 650,
        );
        if (recent) {
          const nextCnt = (recent.count ?? 1) + spawnedTotal;
          recent.count = nextCnt;
          recent.text = `+${nextCnt} Asker`;
          recent.createdAtRealMs = now;
        } else {
          pushFloatingEffect(state, {
            text: `+${spawnedTotal} Asker`,
            color: '#4ade80',
            scope: 'world',
            x: bx,
            y: by,
            count: spawnedTotal,
            durationMs: 1400,
          });
        }
      }
    }
  }

  // 2. Country 5-second batch income (+25% debt auto-repayment), manpower, and University research
  for (const country of Object.values(state.countries)) {
    if (country.eliminated) continue;

    country.manpower += getCountryManpowerPerSec(state, country.id) * dtSimSec;

    country.incomeTickAccSec = (country.incomeTickAccSec ?? 0) + dtSimSec;
    while (country.incomeTickAccSec >= ECONOMY.INCOME_TICK_SEC) {
      country.incomeTickAccSec -= ECONOMY.INCOME_TICK_SEC;
      const gross = getCountryGrossIncomePerTick(state, country.id);
      let net = gross;
      if (country.debt > 0) {
        const deduct = Math.min(country.debt, Math.round(gross * LOAN_CONFIG.AUTO_DEDUCT_RATE));
        country.debt = Math.max(0, Math.round((country.debt - deduct) * 100) / 100);
        net = gross - deduct;
      }
      country.money += net;
      country.lastIncomeNet = net;

      if (country.isPlayer && net > 0) {
        pushFloatingEffect(state, {
          text: `+${net} 💰`,
          color: '#facc15',
          scope: 'hud_money',
          durationMs: 1500,
        });
      }
    }

    // Science research
    const unis = getEffectiveBuildingCount(state, country.id, 'university');
    if (country.activeResearch && unis > 0) {
      country.activeResearch.progressSec += workDt;
      if (country.activeResearch.progressSec >= country.activeResearch.totalSec) {
        const done = country.activeResearch;
        country.activeResearch = null;
        if (done.branch === 'weapon') {
          const wId = done.targetId as WeaponId;
          if (!country.unlockedWeapons.includes(wId)) country.unlockedWeapons.push(wId);
          if (country.isPlayer) {
            pushImportantToast(state, `Araştırma tamamlandı: ${WEAPONS[wId].name}!`, 'research');
          }
        } else {
          const sId = done.targetId as Exclude<ShieldId, 'none'>;
          if (!country.unlockedShields.includes(sId)) country.unlockedShields.push(sId);
          if (country.isPlayer) {
            pushImportantToast(state, `Araştırma tamamlandı: ${SHIELDS[sId].name}!`, 'research');
          }
        }
      }
    }
  }
}

export function isBuildingWorking(state: GameState, country: Country, reg: Region): boolean {
  const b = reg.building;
  if (!b || b.constructing) return false;
  if (b.type === 'bank') return true;
  if (b.type === 'factory') return (b.parallelProduction?.length ?? 0) > 0;
  if (b.type === 'barracks') return (b.trainingQueue?.length ?? 0) > 0;
  if (b.type === 'university') return country.activeResearch !== null;
  if (b.type === 'hospital') {
    return state.wounded.some((w) => w.countryId === country.id && w.toRegionId === reg.id);
  }
  if (b.type === 'port') {
    return Object.values(state.ships).some(
      (s) => s.homeRegionId === reg.id && (s.targetX !== null || Object.keys(s.units).length > 0),
    );
  }
  return false;
}
