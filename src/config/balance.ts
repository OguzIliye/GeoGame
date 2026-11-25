import type { BuildingType, ShieldId, WeaponId } from '../types';

export const CALENDAR = {
  START_YEAR: 2000,
  END_YEAR: 2020,
  TOTAL_DAYS: 20 * 365, // 7300 days
  DAYS_PER_SIM_SECOND: 10, // 1x speed: ~12.1 minutes full campaign
} as const;

export const ARENA_CONFIG = {
  MAX_AI_COUNTRIES: 15,
  SMALL_COUNTRY_MAX_REGIONS: 4,
  /** Target area per region in projected map squared units (1 unit ≈ 1 degree at equator) */
  TARGET_REGION_AREA: 3.2,
  MAX_REGIONS_PER_COUNTRY: 48,
  LLOYD_ITERATIONS: 2,
  MIN_BOX_HALF_W: 11,
  MIN_BOX_HALF_H: 7.5,
  MAX_BOX_HALF_W: 26,
  MAX_BOX_HALF_H: 17,
} as const;

export const ECONOMY = {
  START_MONEY: 300,
  START_MANPOWER: 50,
  BASE_HEALTH_PCT: 50,
  MAX_HEALTH_PCT: 100,
  BASE_MONEY_PER_SEC: 5,
  BASE_MANPOWER_PER_SEC: 1,
  BANK_MONEY_PER_SEC: 12,
  HOSPITAL_HEALTH_BONUS_PCT: 15,
  HOSPITAL_MANPOWER_PER_SEC: 2,
  BARRACKS_TRAIN_SEC_PER_SOLDIER: 0.4,
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
    description: 'Manpower ve ekipman stoğu ile asker yetiştirir.',
  },
  hospital: {
    id: 'hospital',
    name: 'Hastane',
    cost: 150,
    buildSec: 6,
    alwaysActive: false,
    description: '+%15 sağlık (+2 manpower/s) sağlar; savaştan kaçan yaralıları iyileştirir.',
  },
  bank: {
    id: 'bank',
    name: 'Banka',
    cost: 150,
    buildSec: 6,
    alwaysActive: true,
    description: 'Sürekli çalışır ve +12 para/sn üretir.',
  },
  factory: {
    id: 'factory',
    name: 'Fabrika',
    cost: 180,
    buildSec: 7,
    alwaysActive: false,
    description: 'Açılmış teknolojilere göre silah ve kalkan üretir.',
  },
  university: {
    id: 'university',
    name: 'Üniversite',
    cost: 220,
    buildSec: 8,
    alwaysActive: false,
    description: 'Silah ve kalkan teknoloji ağacını araştırır.',
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
  combined: {
    id: 'combined',
    name: 'Merkez Kompleks',
    cost: 150,
    buildSec: 6,
    alwaysActive: true,
    description: 'Küçük ülkeler için tüm bina işlevlerini tek merkezde birleştirir.',
  },
};

export const COMBINED_UPGRADE_COSTS: Record<number, number> = {
  2: 250,
  3: 400,
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
    prodSec: 0.6,
  },
  spear: {
    id: 'spear',
    tier: 2,
    name: 'Mızrak',
    damage: 16,
    researchCost: 200,
    researchSec: 12,
    prodCost: 8,
    prodSec: 0.8,
  },
  pistol: {
    id: 'pistol',
    tier: 3,
    name: 'Pistol',
    damage: 25,
    researchCost: 400,
    researchSec: 18,
    prodCost: 12,
    prodSec: 1.0,
  },
  ak: {
    id: 'ak',
    tier: 4,
    name: 'AK',
    damage: 40,
    researchCost: 750,
    researchSec: 25,
    prodCost: 18,
    prodSec: 1.2,
  },
  bazooka: {
    id: 'bazooka',
    tier: 5,
    name: 'Bazuka',
    damage: 65,
    researchCost: 1200,
    researchSec: 35,
    prodCost: 28,
    prodSec: 1.6,
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
    prodSec: 0.5,
  },
  bronze: {
    id: 'bronze',
    tier: 2,
    name: 'Bronz Kalkan',
    defense: 9,
    researchCost: 180,
    researchSec: 12,
    prodCost: 7,
    prodSec: 0.7,
  },
  steel: {
    id: 'steel',
    tier: 3,
    name: 'Çelik Kalkan',
    defense: 16,
    researchCost: 360,
    researchSec: 18,
    prodCost: 11,
    prodSec: 0.9,
  },
  diamond: {
    id: 'diamond',
    tier: 4,
    name: 'Elmas Kalkan',
    defense: 26,
    researchCost: 700,
    researchSec: 25,
    prodCost: 17,
    prodSec: 1.2,
  },
  forcefield: {
    id: 'forcefield',
    tier: 5,
    name: 'Force Field',
    defense: 42,
    researchCost: 1150,
    researchSec: 35,
    prodCost: 26,
    prodSec: 1.5,
  },
};

export const COMBAT_CONFIG = {
  LAND_MOVE_SPEED: 2.1, // Map units per sim second
  SHIP_MOVE_SPEED: 2.75, // ~1.3x land speed
  MERGE_DISTANCE: 0.95,
  COMBAT_ENGAGE_DISTANCE: 0.65,
  COMBAT_TICK_SEC: 0.5,
  ESCAPE_TO_HOSPITAL_RATE: 0.3,
  HOSPITAL_HEAL_SEC: 8,
  WOUNDED_TRAVEL_SPEED: 3.2,
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
