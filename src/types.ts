export type Point = [number, number];
export type Ring = Point[];
export type PolygonCoords = Ring[];
export type MultiPolygonCoords = PolygonCoords[];

export type BiomeType = 'grass' | 'forest' | 'mountain' | 'desert';

export type BuildingType =
  | 'barracks'
  | 'hospital'
  | 'bank'
  | 'factory'
  | 'university'
  | 'port';

export type WeaponId = 'sword' | 'spear' | 'pistol' | 'ak' | 'bazooka';
export type ShieldId = 'none' | 'wood' | 'bronze' | 'steel' | 'diamond' | 'forcefield';

/** Unit key format: `${weapon}:${shield}` */
export type UnitTypeKey = `${WeaponId}:${ShieldId}`;

export type AIPersonality = 'aggressive' | 'economist' | 'opportunist' | 'diplomat';
export type RelationStatus = 'neutral' | 'allied' | 'war';

export interface WorldCountryFeature {
  id: string;
  name: string;
  polygons: MultiPolygonCoords;
  centroid: Point;
  bbox: [number, number, number, number]; // [minX, minY, maxX, maxY]
  area: number;
}

export interface BuildingSlot {
  type: BuildingType;
  level: number;
  constructing: boolean;
  progressSec: number;
  totalSec: number;
  x?: number;
  y?: number;
  parallelProduction?: ProductionOrder[];
  trainingQueue?: TrainingOrder[];
}

export interface TerrainProp {
  kind: 'tree' | 'mountain' | 'grass' | 'cactus' | 'dune';
  x: number;
  y: number;
  variant: number;
}

export interface Region {
  id: string;
  ownerId: string;
  initialOwnerId: string;
  polygons: MultiPolygonCoords;
  centroid: Point;
  bbox: [number, number, number, number];
  area: number;
  neighbors: string[]; // Land-adjacent region IDs
  isCoastal: boolean;
  coastalAnchor: Point | null; // Point near water for port/landing
  biome: BiomeType;
  props: TerrainProp[];
  building: BuildingSlot | null;
  capture: {
    attackerCountryId: string;
    armyId: string;
    elapsedSec: number;
    requiredSec: number;
  } | null;
}

export interface ProductionOrder {
  id: string;
  category: 'weapon' | 'shield';
  itemId: WeaponId | Exclude<ShieldId, 'none'>;
  remainingCount: number;
  progressSec: number;
  unitTimeSec: number;
}

export interface TrainingOrder {
  id: string;
  weapon: WeaponId;
  shield: ShieldId;
  remainingCount: number;
  progressSec: number;
  unitTimeSec: number;
}

export interface ActiveResearch {
  branch: 'weapon' | 'shield';
  targetId: WeaponId | ShieldId;
  progressSec: number;
  totalSec: number;
}

export interface WoundedBatch {
  id: string;
  countryId: string;
  units: Record<string, number>;
  from: Point;
  toRegionId: string;
  to: Point;
  travelProgress: number; // 0..1 walking to hospital
  healElapsedSec: number;
  healRequiredSec: number;
  waitingForHospital?: boolean;
}

export interface Country {
  id: string;
  name: string;
  color: string;
  isPlayer: boolean;
  eliminated: boolean;
  personality: AIPersonality;
  nextAiThinkSec: number;

  money: number;
  manpower: number;
  debt: number;
  incomeTickAccSec: number;
  lastIncomeNet?: number;

  weaponsStock: Record<WeaponId, number>;
  shieldsStock: Record<Exclude<ShieldId, 'none'>, number>;

  unlockedWeapons: WeaponId[];
  unlockedShields: Exclude<ShieldId, 'none'>[];
  activeResearch: ActiveResearch | null;
}

export interface ArmyStack {
  id: string;
  countryId: string;
  x: number;
  y: number;
  currentRegionId: string;
  units: Record<string, number>; // UnitTypeKey -> count (>0)
  targetX: number | null;
  targetY: number | null;
  waypoints?: Point[];
  targetRegionId: string | null;
  targetArmyId: string | null;
  mergeTargetArmyId?: string | null;
  inCombatWithArmyId: string | null;
  embarkingShipId: string | null;
  retreatingUntilSimSec?: number;
  combatLossCarry?: number;
}

export interface TransportShip {
  id: string;
  countryId: string;
  homeRegionId: string;
  x: number;
  y: number;
  targetX: number | null;
  targetY: number | null;
  landingRegionId: string | null;
  units: Record<string, number>; // Unlimited capacity carried units
}

export interface DiplomacyEdge {
  a: string;
  b: string;
  status: RelationStatus;
  score: number; // -100..+100
  nonAggressionUntilDay?: number;
  tradeAgreement?: boolean;
  lastGiftDayByCountry?: Record<string, number>;
}

export interface ImportantToast {
  id: string;
  message: string;
  kind: 'war' | 'alliance' | 'peace' | 'capture' | 'loss' | 'research' | 'info';
  createdAtRealMs: number;
}

export interface ArenaBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type AutoPauseReason =
  | 'building_placement'
  | 'move_order'
  | 'encounter'
  | 'tutorial'
  | 'building_popup'
  | 'tutorial_spotlight'
  | 'save_exit';

export interface EncounterPrompt {
  id: string;
  playerArmyId: string;
  otherArmyId: string;
  otherCountryId: string;
  relation: RelationStatus;
  activeTab: 'encounter' | 'diplomacy';
}

export interface FocusPing {
  x: number;
  y: number;
  startedRealMs: number;
}

export interface FloatingEffect {
  id: string;
  text: string;
  color: string;
  scope: 'hud_money' | 'world';
  x?: number;
  y?: number;
  count?: number;
  createdAtRealMs: number;
  durationMs: number;
}

export interface BoxSelectRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type GamePhase = 'main_menu' | 'world_select' | 'playing' | 'ended';
export type SpeedMultiplier = 0 | 0.5 | 1 | 2;

export interface GameState {
  phase: GamePhase;
  selectedWorldCountryId: string | null;
  hoveredWorldCountryId: string | null;

  simDaysElapsed: number; // 0 = 2000-01-01, 3650 = 2010-01-01
  simSecondsElapsed: number;
  speed: SpeedMultiplier;
  lastNonZeroSpeed: Exclude<SpeedMultiplier, 0>;

  arena: ArenaBounds | null;
  countries: Record<string, Country>;
  playerCountryId: string | null;
  regions: Record<string, Region>;
  armies: Record<string, ArmyStack>;
  ships: Record<string, TransportShip>;
  wounded: WoundedBatch[];
  diplomacy: Record<string, DiplomacyEdge>;
  combatTickAccumulator: number;

  selectedArmyId: string | null;
  selectedArmyIds: string[];
  selectedShipId: string | null;
  selectedRegionId: string | null;
  activeBuildingRegionId?: string | null;
  boxSelectRect?: BoxSelectRect | null;
  moveOrderMode: boolean; // True when an army or loaded ship is awaiting a map target click

  placingBuildingType: BuildingType | null;
  placementHoverPoint: Point | null;
  autoPauseReasons: AutoPauseReason[];
  activeEncounter: EncounterPrompt | null;
  encounterCooldownUntilSimSec: Record<string, number>;
  armyFocusIndex: number;
  focusPing: FocusPing | null;
  tutorialSeen: boolean;
  tutorialPromptOpen: boolean;
  tutorialHoldWoundedWithoutHospital?: boolean;

  floatingEffects: FloatingEffect[];
  toasts: ImportantToast[];
  endReason: 'victory_domination' | 'date_reached' | 'defeat_eliminated' | null;
}
