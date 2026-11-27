import type { BuildingType, ShieldId, WeaponId } from '../types';

export const SIM_TIME_SCALE = 1 / 3;

export function simSecToRealSec(simSec: number): number {
  return Math.round(simSec / SIM_TIME_SCALE);
}

export const CALENDAR = {
  START_YEAR: 2000,
  END_YEAR: 2010,
  TOTAL_DAYS: 10 * 365,
  DAYS_PER_SIM_SECOND: 0.25,
} as const;

export const ARENA_CONFIG = {
  MAX_AI_COUNTRIES: 15,
  SMALL_COUNTRY_MAX_REGIONS: 4,
  /** Target area per region in projected map squared units (~38% more compact for extra building slots) */
  TARGET_REGION_AREA: 2.0,
  MAX_REGIONS_PER_COUNTRY: 64,
  LLOYD_ITERATIONS: 1,
  MIN_BOX_HALF_W: 11,
  MIN_BOX_HALF_H: 7.5,
  MAX_BOX_HALF_W: 26,
  MAX_BOX_HALF_H: 17,
} as const;

export const ECONOMY = {
  START_MONEY: 100,
  START_MANPOWER: 50,
  BASE_HEALTH_PCT: 50,
  MAX_HEALTH_PCT: 100,
  BASE_MONEY_PER_SEC: 5,
  BASE_MANPOWER_PER_SEC: 1,
  BANK_MONEY_PER_SEC: 12,
  INCOME_TICK_SEC: 5,
  MAX_UNIVERSITIES: 1,
  DEMOLISH_REFUND_RATE: 0.5,
  REGION_CAPTURE_BONUS: 1000,
  HOSPITAL_HEALTH_BONUS_PCT: 15,
  HOSPITAL_MANPOWER_PER_SEC: 2,
  BARRACKS_TRAIN_SEC_PER_SOLDIER: 0.4,
} as const;

export const LOAN_CONFIG = {
  OPTIONS: [500, 1000, 10000] as const,
  INTEREST_RATE: 0.15,
  AUTO_DEDUCT_RATE: 0.25,
  MAX_DEBT: 20000,
} as const;

export const AI_CONFIG = {
  STARTUP_DELAY_DAYS: 3,
  PEACEFUL_DEV_UNTIL_DAYS: 7,
} as const;

export interface BuildingSpec {
  id: BuildingType;
  name: string;
  cost: number;
  buildSec: number;
  alwaysActive: boolean;
  coastalOnly?: boolean;
  description: string;
}

export const BUILDINGS: Record<BuildingType, BuildingSpec> = {
  barracks: {
    id: 'barracks',
    name: 'Kışla',
    cost: 160,
    buildSec: 6,
    alwaysActive: false,
    description: 'Manpower ve ekipman stoğu ile kendi konumunda asker yetiştirir.',
  },
  hospital: {
    id: 'hospital',
    name: 'Hastane',
    cost: 150,
    buildSec: 6,
    alwaysActive: false,
    description: '+%15 sağlık (+2 manpower/3sn) sağlar; savaştan kaçan yaralıları iyileştirir.',
  },
  bank: {
    id: 'bank',
    name: 'Banka',
    cost: 100,
    buildSec: 6,
    alwaysActive: true,
    description: 'Sürekli çalışır, her 15 sn\'de +60 para üretir ve kredi sağlar.',
  },
  factory: {
    id: 'factory',
    name: 'Fabrika',
    cost: 180,
    buildSec: 7,
    alwaysActive: false,
    description: 'Açılmış teknolojilere göre paralel hatlarda silah ve kalkan üretir.',
  },
  university: {
    id: 'university',
    name: 'Üniversite',
    cost: 220,
    buildSec: 8,
    alwaysActive: false,
    description: 'Silah ve kalkan teknoloji ağacını araştırır (Ülke başına maks. 1).',
  },
  port: {
    id: 'port',
    name: 'Liman',
    cost: 200,
    buildSec: 7,
    alwaysActive: false,
    coastalOnly: true,
    description: 'Kıyı bölgelerinde sınırsız kapasiteli taşıma gemisi sağlar.',
  },
};

export interface WeaponSpec {
  id: WeaponId;
  tier: 1 | 2 | 3 | 4 | 5;
  name: string;
  damage: number;
  researchCost: number;
  researchSec: number;
  prodCost: number;
  prodSec: number;
}

export const WEAPON_ORDER: WeaponId[] = ['sword', 'spear', 'pistol', 'ak', 'bazooka'];

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  sword: {
    id: 'sword',
    tier: 1,
    name: 'Kılıç',
    damage: 10,
    researchCost: 0,
    researchSec: 0,
    prodCost: 5,
    prodSec: 2,
  },
  spear: {
    id: 'spear',
    tier: 2,
    name: 'Mızrak',
    damage: 16,
    researchCost: 200,
    researchSec: 12,
    prodCost: 8,
    prodSec: 4,
  },
  pistol: {
    id: 'pistol',
    tier: 3,
    name: 'Pistol',
    damage: 25,
    researchCost: 400,
    researchSec: 18,
    prodCost: 12,
    prodSec: 7,
  },
  ak: {
    id: 'ak',
    tier: 4,
    name: 'AK',
    damage: 40,
    researchCost: 750,
    researchSec: 25,
    prodCost: 18,
    prodSec: 11,
  },
  bazooka: {
    id: 'bazooka',
    tier: 5,
    name: 'Bazuka',
    damage: 65,
    researchCost: 1200,
    researchSec: 35,
    prodCost: 28,
    prodSec: 15,
  },
};

export interface ShieldSpec {
  id: Exclude<ShieldId, 'none'>;
  tier: 1 | 2 | 3 | 4 | 5;
  name: string;
  defense: number;
  researchCost: number;
  researchSec: number;
  prodCost: number;
  prodSec: number;
}

export const SHIELD_ORDER: Exclude<ShieldId, 'none'>[] = [
  'wood',
  'bronze',
  'steel',
  'diamond',
  'forcefield',
];

export const SHIELDS: Record<Exclude<ShieldId, 'none'>, ShieldSpec> = {
  wood: {
    id: 'wood',
    tier: 1,
    name: 'Tahta Kalkan',
    defense: 4,
    researchCost: 0,
    researchSec: 0,
    prodCost: 4,
    prodSec: 2,
  },
  bronze: {
    id: 'bronze',
    tier: 2,
    name: 'Bronz Kalkan',
    defense: 9,
    researchCost: 180,
    researchSec: 12,
    prodCost: 7,
    prodSec: 4,
  },
  steel: {
    id: 'steel',
    tier: 3,
    name: 'Çelik Kalkan',
    defense: 16,
    researchCost: 360,
    researchSec: 18,
    prodCost: 11,
    prodSec: 7,
  },
  diamond: {
    id: 'diamond',
    tier: 4,
    name: 'Elmas Kalkan',
    defense: 26,
    researchCost: 700,
    researchSec: 25,
    prodCost: 17,
    prodSec: 11,
  },
  forcefield: {
    id: 'forcefield',
    tier: 5,
    name: 'Force Field',
    defense: 42,
    researchCost: 1150,
    researchSec: 35,
    prodCost: 26,
    prodSec: 15,
  },
};

export const COMBAT_CONFIG = {
  LAND_MOVE_SPEED: 0.36, // ~1 compact region (~1.44 map units) per 4 sim sec (= 1 in-game day)
  SHIP_MOVE_SPEED: 0.5, // ~1.38x land speed
  MERGE_DISTANCE: 0.95,
  COMBAT_ENGAGE_DISTANCE: 0.65,
  ENCOUNTER_DETECT_DISTANCE: 1.05,
  ENCOUNTER_COOLDOWN_SEC: 10,
  LONG_MARCH_WEAVE_MIN_DIST: 2.2,
  COMBAT_TICK_SEC: 0.5,
  HOME_DEFENSE_BONUS: 0.1,
  RETREAT_LOSS_RATE: 0.1,
  ESCAPE_TO_HOSPITAL_RATE: 0.3,
  HOSPITAL_HEAL_SEC: 8,
  WOUNDED_TRAVEL_SPEED: 0.78,
} as const;

export const DIPLOMACY_CONFIG = {
  GIFT_COST: 150,
  GIFT_SCORE_BONUS: 25,
  GIFT_COOLDOWN_DAYS: 10,
  NON_AGGRESSION_DAYS: 365,
  BREAK_ALLIANCE_PENALTY: 65,
  TRADE_BONUS_RATE: 0.1,
} as const;

export function computeCaptureDurationSec(totalSoldiers: number): number {
  const n = Math.max(1, totalSoldiers);
  return Math.max(4, 12 - 1.5 * Math.log2(n));
}

export const COUNTRY_PALETTE = [
  '#3b82f6', // Player default royal blue
  '#ef4444',
  '#eab308',
  '#a855f7',
  '#f97316',
  '#14b8a6',
  '#ec4899',
  '#84cc16',
  '#06b6d4',
  '#f43f5e',
  '#8b5cf6',
  '#d97706',
  '#10b981',
  '#6366f1',
  '#fb7185',
  '#22c55e',
];
