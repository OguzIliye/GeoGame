import {
  BUILDINGS,
  COMBINED_UPGRADE_COSTS,
  ECONOMY,
  SHIELD_ORDER,
  SHIELDS,
  WEAPON_ORDER,
  WEAPONS,
} from '../config/balance';
import type {
  ArmyStack,
  BuildingType,
  Country,
  GameState,
  ImportantToast,
  Region,
  ShieldId,
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

export function getActiveBuildingLevel(b: Region['building']): number {
  if (!b) return 0;
  return b.constructing ? Math.max(0, b.level - 1) : b.level;
}

/** Count effective active building capacity for a country (including small-country Combined Building levels). */
export function getEffectiveBuildingCount(
  state: GameState,
  countryId: string,
  type: Exclude<BuildingType, 'combined'>,
): number {
  let total = 0;
  for (const reg of Object.values(state.regions)) {
    if (reg.ownerId !== countryId || !reg.building) continue;
    const activeLv = getActiveBuildingLevel(reg.building);
    if (activeLv <= 0) continue;
    if (reg.building.type === type) {
      total += activeLv;
    } else if (reg.building.type === 'combined') {
      if (type === 'port') {
        if (reg.isCoastal) total += 1;
      } else {
        total += activeLv;
      }
    }
  }
  return total;
}

export function getCountryHealthPct(state: GameState, countryId: string): number {
  const hospitals = getEffectiveBuildingCount(state, countryId, 'hospital');
  return Math.min(
    ECONOMY.MAX_HEALTH_PCT,
    ECONOMY.BASE_HEALTH_PCT + hospitals * ECONOMY.HOSPITAL_HEALTH_BONUS_PCT,
  );
}

export function getCountryMoneyPerSec(state: GameState, countryId: string): number {
  const banks = getEffectiveBuildingCount(state, countryId, 'bank');
  return ECONOMY.BASE_MONEY_PER_SEC + banks * ECONOMY.BANK_MONEY_PER_SEC;
}

export function getCountryManpowerPerSec(state: GameState, countryId: string): number {
  const healthPct = getCountryHealthPct(state, countryId);
  const fromHealth =
    ECONOMY.BASE_MANPOWER_PER_SEC +
    ((healthPct - ECONOMY.BASE_HEALTH_PCT) / ECONOMY.HOSPITAL_HEALTH_BONUS_PCT) *
      ECONOMY.HOSPITAL_MANPOWER_PER_SEC;
  return Math.round(fromHealth * 100) / 100;
}

/** Place starting buildings per DESIGN.md: 1 Bank + 1 Barracks for normal countries; 1 Combined Building for small countries. */
export function placeInitialCountryBuildings(state: GameState): void {
  for (const country of Object.values(state.countries)) {
    const owned = getCountryRegions(state, country.id);
    if (owned.length === 0) continue;

    if (country.isSmallCountry) {
      // Prefer a coastal region if available so Combined Building also grants Port capability
      const target = owned.find((r) => r.isCoastal) ?? owned[0];
      target.building = {
        type: 'combined',
        level: 1,
        constructing: false,
        progressSec: 0,
        totalSec: 0,
      };
      if (target.isCoastal) {
        ensurePortShipForRegion(state, target);
      }
    } else {
      // Sort largest/most central regions first
      const sorted = [...owned].sort((a, b) => b.area - a.area);
      sorted[0].building = {
        type: 'bank',
        level: 1,
        constructing: false,
        progressSec: 0,
        totalSec: 0,
      };
      if (sorted[1]) {
        sorted[1].building = {
          type: 'barracks',
          level: 1,
          constructing: false,
          progressSec: 0,
          totalSec: 0,
        };
      }
    }
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

export function startBuildingConstruction(
  state: GameState,
  countryId: string,
  regionId: string,
  type: Exclude<BuildingType, 'combined'>,
): { ok: boolean; error?: string } {
  const country = state.countries[countryId];
  const reg = state.regions[regionId];
  if (!country || !reg) return { ok: false, error: 'Geçersiz bölge veya ülke.' };
  if (reg.ownerId !== countryId) return { ok: false, error: 'Bu bölge ülkenize ait değil.' };
  if (reg.building !== null) return { ok: false, error: 'Bu bölgede zaten bir bina var (maks. 1).' };
  if (type === 'port' && !reg.isCoastal) {
    return { ok: false, error: 'Liman yalnızca denize kıyısı olan bölgelere kurulabilir.' };
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
  };
  return { ok: true };
}

export function startCombinedBuildingUpgrade(
  state: GameState,
  countryId: string,
  regionId: string,
): { ok: boolean; error?: string } {
  const country = state.countries[countryId];
  const reg = state.regions[regionId];
  if (!country || !reg || reg.ownerId !== countryId) {
    return { ok: false, error: 'Geçersiz bölge.' };
  }
  if (!country.isSmallCountry) {
    return { ok: false, error: 'Merkez Kompleks yalnızca küçük ülkeler içindir.' };
  }
  if (!reg.building) {
    if (country.money < BUILDINGS.combined.cost) return { ok: false, error: 'Yetersiz para.' };
    country.money -= BUILDINGS.combined.cost;
    reg.building = {
      type: 'combined',
      level: 1,
      constructing: true,
      progressSec: 0,
      totalSec: BUILDINGS.combined.buildSec,
    };
    return { ok: true };
  }
  if (reg.building.type !== 'combined') return { ok: false, error: 'Bu bölgede farklı bina var.' };
  if (reg.building.constructing) return { ok: false, error: 'İnşaat/geliştirme devam ediyor.' };
  const nextLevel = reg.building.level + 1;
  const cost = COMBINED_UPGRADE_COSTS[nextLevel];
  if (!cost) return { ok: false, error: 'Maksimum kademeye ulaşıldı.' };
  if (country.money < cost) return { ok: false, error: 'Yetersiz para.' };

  country.money -= cost;
  reg.building.level = nextLevel;
  reg.building.constructing = true;
  reg.building.progressSec = 0;
  reg.building.totalSec = BUILDINGS.combined.buildSec;
  return { ok: true };
}

export function startTechResearch(
  state: GameState,
  countryId: string,
  branch: 'weapon' | 'shield',
): { ok: boolean; error?: string } {
  const country = state.countries[countryId];
  if (!country) return { ok: false, error: 'Ülke bulunamadı.' };
  const uniCount = getEffectiveBuildingCount(state, countryId, 'university');
  if (uniCount <= 0) return { ok: false, error: 'Araştırma için Üniversite (Bilim Binası) gerekli.' };
  if (country.activeResearch) return { ok: false, error: 'Zaten devam eden bir araştırma var.' };

  if (branch === 'weapon') {
    const nextWeapon = WEAPON_ORDER.find((w) => !country.unlockedWeapons.includes(w));
    if (!nextWeapon) return { ok: false, error: 'Tüm silahlar açıldı.' };
    const spec = WEAPONS[nextWeapon];
    if (country.money < spec.researchCost) return { ok: false, error: 'Yetersiz para.' };
    country.money -= spec.researchCost;
    const speedFactor = 1 + (uniCount - 1) * 0.35;
    country.activeResearch = {
      branch: 'weapon',
      targetId: nextWeapon,
      progressSec: 0,
      totalSec: spec.researchSec / speedFactor,
    };
    return { ok: true };
  } else {
    const nextShield = SHIELD_ORDER.find((s) => !country.unlockedShields.includes(s));
    if (!nextShield) return { ok: false, error: 'Tüm kalkanlar açıldı.' };
    const spec = SHIELDS[nextShield];
    if (country.money < spec.researchCost) return { ok: false, error: 'Yetersiz para.' };
    country.money -= spec.researchCost;
    const speedFactor = 1 + (uniCount - 1) * 0.35;
    country.activeResearch = {
      branch: 'shield',
      targetId: nextShield,
      progressSec: 0,
      totalSec: spec.researchSec / speedFactor,
    };
    return { ok: true };
  }
}

export function queueFactoryProduction(
  state: GameState,
  countryId: string,
  category: 'weapon' | 'shield',
  itemId: WeaponId | Exclude<ShieldId, 'none'>,
  count: number,
): { ok: boolean; error?: string } {
  const country = state.countries[countryId];
  if (!country || count <= 0) return { ok: false, error: 'Geçersiz üretim miktarı.' };
  const factories = getEffectiveBuildingCount(state, countryId, 'factory');
  if (factories <= 0) return { ok: false, error: 'Üretim için Fabrika gerekli.' };

  if (category === 'weapon') {
    const wId = itemId as WeaponId;
    if (!country.unlockedWeapons.includes(wId)) {
      return { ok: false, error: 'Bu silah henüz Üniversitede açılmadı.' };
    }
    const spec = WEAPONS[wId];
    const totalCost = spec.prodCost * count;
    if (country.money < totalCost) return { ok: false, error: 'Yetersiz para.' };
    country.money -= totalCost;
    country.productionQueue.push({
      id: nextUid('prod'),
      category: 'weapon',
      itemId: wId,
      remainingCount: count,
      progressSec: 0,
      unitTimeSec: spec.prodSec,
    });
    return { ok: true };
  } else {
    const sId = itemId as Exclude<ShieldId, 'none'>;
    if (!country.unlockedShields.includes(sId)) {
      return { ok: false, error: 'Bu kalkan henüz Üniversitede açılmadı.' };
    }
    const spec = SHIELDS[sId];
    const totalCost = spec.prodCost * count;
    if (country.money < totalCost) return { ok: false, error: 'Yetersiz para.' };
    country.money -= totalCost;
    country.productionQueue.push({
      id: nextUid('prod'),
      category: 'shield',
      itemId: sId,
      remainingCount: count,
      progressSec: 0,
      unitTimeSec: spec.prodSec,
    });
    return { ok: true };
  }
}

export function queueBarracksTraining(
  state: GameState,
  countryId: string,
  weapon: WeaponId,
  shield: ShieldId,
  count: number,
): { ok: boolean; error?: string } {
  const country = state.countries[countryId];
  if (!country || count <= 0) return { ok: false, error: 'Geçersiz asker sayısı.' };
  const barracks = getEffectiveBuildingCount(state, countryId, 'barracks');
  if (barracks <= 0) return { ok: false, error: 'Asker yetiştirmek için Kışla gerekli.' };
  if (Math.floor(country.manpower) < count) return { ok: false, error: 'Yetersiz Manpower.' };
  if (country.weaponsStock[weapon] < count) return { ok: false, error: 'Yetersiz silah stoğu.' };
  if (shield !== 'none' && country.shieldsStock[shield] < count) {
    return { ok: false, error: 'Yetersiz kalkan stoğu.' };
  }

  country.manpower -= count;
  country.weaponsStock[weapon] -= count;
  if (shield !== 'none') {
    country.shieldsStock[shield] -= count;
  }

  country.trainingQueue.push({
    id: nextUid('train'),
    weapon,
    shield,
    remainingCount: count,
    progressSec: 0,
    unitTimeSec: ECONOMY.BARRACKS_TRAIN_SEC_PER_SOLDIER,
  });
  return { ok: true };
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

export function spawnUnitsIntoCountryBarracks(
  state: GameState,
  countryId: string,
  unitKey: UnitTypeKey,
  count: number,
): ArmyStack | null {
  if (count <= 0) return null;
  const owned = getCountryRegions(state, countryId);
  if (owned.length === 0) return null;

  const spawnRegion =
    owned.find(
      (r) =>
        r.building &&
        !r.building.constructing &&
        (r.building.type === 'barracks' || r.building.type === 'combined'),
    ) ?? owned[0];

  // Merge into an idle friendly stack already standing in spawnRegion
  const existing = Object.values(state.armies).find(
    (a) =>
      a.countryId === countryId &&
      a.currentRegionId === spawnRegion.id &&
      a.targetX === null &&
      a.inCombatWithArmyId === null &&
      Math.hypot(a.x - spawnRegion.centroid[0], a.y - spawnRegion.centroid[1]) < 0.45,
  );

  if (existing) {
    existing.units[unitKey] = (existing.units[unitKey] ?? 0) + count;
    return existing;
  }

  const stack: ArmyStack = {
    id: nextUid('army'),
    countryId,
    x: spawnRegion.centroid[0],
    y: spawnRegion.centroid[1],
    currentRegionId: spawnRegion.id,
    units: { [unitKey]: count },
    targetX: null,
    targetY: null,
    targetRegionId: null,
    targetArmyId: null,
    inCombatWithArmyId: null,
    embarkingShipId: null,
  };
  state.armies[stack.id] = stack;
  return stack;
}

/** Tick all economy, construction, science research, factory production, and barracks training. */
export function tickEconomyAndQueues(state: GameState, dtSimSec: number): void {
  if (dtSimSec <= 0) return;

  // 1. Building constructions
  for (const reg of Object.values(state.regions)) {
    if (reg.building && reg.building.constructing) {
      reg.building.progressSec += dtSimSec;
      if (reg.building.progressSec >= reg.building.totalSec) {
        reg.building.constructing = false;
        reg.building.progressSec = reg.building.totalSec;
        if (reg.building.type === 'port' || (reg.building.type === 'combined' && reg.isCoastal)) {
          ensurePortShipForRegion(state, reg);
        }
      }
    }
  }

  // 2. Country passive income, science research, factory queue, barracks queue
  for (const country of Object.values(state.countries)) {
    if (country.eliminated) continue;

    country.money += getCountryMoneyPerSec(state, country.id) * dtSimSec;
    country.manpower += getCountryManpowerPerSec(state, country.id) * dtSimSec;

    // Science research
    const unis = getEffectiveBuildingCount(state, country.id, 'university');
    if (country.activeResearch && unis > 0) {
      country.activeResearch.progressSec += dtSimSec;
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

    // Factory production queue (routine — does NOT emit toast per DESIGN.md)
    const factories = getEffectiveBuildingCount(state, country.id, 'factory');
    if (factories > 0 && country.productionQueue.length > 0) {
      const speedMult = 1 + (factories - 1) * 0.5;
      let budgetSec = dtSimSec * speedMult;
      while (budgetSec > 0 && country.productionQueue.length > 0) {
        const order = country.productionQueue[0];
        const needed = order.unitTimeSec - order.progressSec;
        if (budgetSec >= needed) {
          budgetSec -= needed;
          order.progressSec = 0;
          order.remainingCount -= 1;
          if (order.category === 'weapon') {
            country.weaponsStock[order.itemId as WeaponId] += 1;
          } else {
            country.shieldsStock[order.itemId as Exclude<ShieldId, 'none'>] += 1;
          }
          if (order.remainingCount <= 0) {
            country.productionQueue.shift();
          }
        } else {
          order.progressSec += budgetSec;
          budgetSec = 0;
        }
      }
    }

    // Barracks training queue (routine — does NOT emit toast per DESIGN.md)
    const barracks = getEffectiveBuildingCount(state, country.id, 'barracks');
    if (barracks > 0 && country.trainingQueue.length > 0) {
      const speedMult = 1 + (barracks - 1) * 0.5;
      let budgetSec = dtSimSec * speedMult;
      while (budgetSec > 0 && country.trainingQueue.length > 0) {
        const order = country.trainingQueue[0];
        const needed = order.unitTimeSec - order.progressSec;
        if (budgetSec >= needed) {
          budgetSec -= needed;
          order.progressSec = 0;
          order.remainingCount -= 1;
          const unitKey: UnitTypeKey = `${order.weapon}:${order.shield}`;
          spawnUnitsIntoCountryBarracks(state, country.id, unitKey, 1);
          if (order.remainingCount <= 0) {
            country.trainingQueue.shift();
          }
        } else {
          order.progressSec += budgetSec;
          budgetSec = 0;
        }
      }
    }
  }
}

export function isBuildingWorking(state: GameState, country: Country, reg: Region): boolean {
  const b = reg.building;
  if (!b || b.constructing) return false;
  if (b.type === 'bank' || b.type === 'combined') return true;
  if (b.type === 'factory') return country.productionQueue.length > 0;
  if (b.type === 'barracks') return country.trainingQueue.length > 0;
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
