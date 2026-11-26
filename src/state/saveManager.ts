import { formatSimDate } from '../sim/calendar';
import type {
  ArenaBounds,
  ArmyStack,
  Country,
  DiplomacyEdge,
  GameState,
  MultiPolygonCoords,
  Point,
  Region,
  SpeedMultiplier,
  TerrainProp,
  TransportShip,
  WoundedBatch,
} from '../types';

export type SaveSlotId = 1 | 2 | 3;
export const SAVE_VERSION = '1.2';
export const SAVE_SLOT_IDS: readonly SaveSlotId[] = [1, 2, 3] as const;

const STORAGE_PREFIX = 'pixelworld_save_v1_2_slot_';

export interface SavedCameraState {
  cx: number;
  cy: number;
  scale: number;
}

export interface SaveSlotSummary {
  slotId: SaveSlotId;
  empty: boolean;
  countryId?: string;
  countryName?: string;
  countryColor?: string;
  simDaysElapsed?: number;
  simDateLabel?: string;
  savedAtIso?: string;
}

interface SerializedPayload {
  saveVersion: string;
  slotId: SaveSlotId;
  savedAtIso: string;
  countryId: string;
  countryName: string;
  countryColor: string;
  simDaysElapsed: number;
  simSecondsElapsed: number;
  speed: SpeedMultiplier;
  lastNonZeroSpeed: Exclude<SpeedMultiplier, 0>;
  selectedWorldCountryId: string | null;
  playerCountryId: string;
  arena: ArenaBounds;
  countries: Record<string, Country>;
  regions: Record<string, Region>;
  armies: Record<string, ArmyStack>;
  ships: Record<string, TransportShip>;
  wounded: WoundedBatch[];
  diplomacy: Record<string, DiplomacyEdge>;
  combatTickAccumulator: number;
  tutorialSeen: boolean;
  camera?: SavedCameraState;
}

// Fallback in-memory storage when running in headless Node/Vitest without localStorage
const memoryFallbackStorage = new Map<string, string>();

function readRawKey(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch {
    // Fallback below
  }
  return memoryFallbackStorage.get(key) ?? null;
}

function writeRawKey(key: string, val: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, val);
      return;
    }
  } catch {
    // Fallback below
  }
  memoryFallbackStorage.set(key, val);
}

function removeRawKey(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore
  }
  memoryFallbackStorage.delete(key);
}

function slotKey(slotId: SaveSlotId): string {
  return `${STORAGE_PREFIX}${slotId}`;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function compactPoint(pt: Point): Point {
  return [round4(pt[0]), round4(pt[1])];
}

function compactPolygons(mp: MultiPolygonCoords): MultiPolygonCoords {
  return mp.map((poly) => poly.map((ring) => ring.map((pt) => compactPoint(pt))));
}

function compactProps(props: TerrainProp[]): TerrainProp[] {
  return props.map((p) => ({
    kind: p.kind,
    x: round4(p.x),
    y: round4(p.y),
    variant: p.variant,
  }));
}

function compactRegions(regions: Record<string, Region>): Record<string, Region> {
  const out: Record<string, Region> = {};
  for (const [id, r] of Object.entries(regions)) {
    out[id] = {
      id: r.id,
      ownerId: r.ownerId,
      initialOwnerId: r.initialOwnerId,
      polygons: compactPolygons(r.polygons),
      centroid: compactPoint(r.centroid),
      bbox: [round4(r.bbox[0]), round4(r.bbox[1]), round4(r.bbox[2]), round4(r.bbox[3])],
      area: round4(r.area),
      neighbors: [...r.neighbors],
      isCoastal: r.isCoastal,
      coastalAnchor: r.coastalAnchor ? compactPoint(r.coastalAnchor) : null,
      biome: r.biome,
      props: compactProps(r.props),
      building: r.building ? structuredClone(r.building) : null,
      capture: r.capture ? structuredClone(r.capture) : null,
    };
  }
  return out;
}

export function saveToSlot(
  slotId: SaveSlotId,
  state: GameState,
  camera?: SavedCameraState,
): { ok: boolean; error?: string } {
  if (!SAVE_SLOT_IDS.includes(slotId)) {
    return { ok: false, error: 'Geçersiz kayıt slotu.' };
  }
  if (!state.playerCountryId || !state.arena || !state.countries[state.playerCountryId]) {
    return { ok: false, error: 'Kaydedilecek aktif bir oyun bulunamadı.' };
  }

  const player = state.countries[state.playerCountryId];
  const payload: SerializedPayload = {
    saveVersion: SAVE_VERSION,
    slotId,
    savedAtIso: new Date().toISOString(),
    countryId: player.id,
    countryName: player.name,
    countryColor: player.color,
    simDaysElapsed: state.simDaysElapsed,
    simSecondsElapsed: state.simSecondsElapsed,
    speed: state.speed === 0 ? state.lastNonZeroSpeed : state.speed,
    lastNonZeroSpeed: state.lastNonZeroSpeed,
    selectedWorldCountryId: state.selectedWorldCountryId,
    playerCountryId: state.playerCountryId,
    arena: structuredClone(state.arena),
    countries: structuredClone(state.countries),
    regions: compactRegions(state.regions),
    armies: structuredClone(state.armies),
    ships: structuredClone(state.ships),
    wounded: structuredClone(state.wounded),
    diplomacy: structuredClone(state.diplomacy),
    combatTickAccumulator: state.combatTickAccumulator,
    tutorialSeen: state.tutorialSeen,
    camera: camera
      ? { cx: round4(camera.cx), cy: round4(camera.cy), scale: round4(camera.scale) }
      : undefined,
  };

  try {
    writeRawKey(slotKey(slotId), JSON.stringify(payload));
    return { ok: true };
  } catch {
    return { ok: false, error: 'Tarayıcı depolama alanı dolu veya erişilemiyor.' };
  }
}

function parseSlotSafely(slotId: SaveSlotId): SerializedPayload | null {
  const key = slotKey(slotId);
  const raw = readRawKey(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SerializedPayload>;
    if (
      !parsed ||
      parsed.saveVersion !== SAVE_VERSION ||
      !parsed.playerCountryId ||
      !parsed.arena ||
      !parsed.countries ||
      !parsed.regions ||
      !parsed.countries[parsed.playerCountryId]
    ) {
      // Corrupt or outdated version -> safely purge slot!
      removeRawKey(key);
      return null;
    }
    return parsed as SerializedPayload;
  } catch {
    removeRawKey(key);
    return null;
  }
}

export function listSaveSlots(): SaveSlotSummary[] {
  return SAVE_SLOT_IDS.map((slotId) => {
    const parsed = parseSlotSafely(slotId);
    if (!parsed) {
      return { slotId, empty: true };
    }
    return {
      slotId,
      empty: false,
      countryId: parsed.countryId,
      countryName: parsed.countryName,
      countryColor: parsed.countryColor,
      simDaysElapsed: parsed.simDaysElapsed,
      simDateLabel: formatSimDate(parsed.simDaysElapsed),
      savedAtIso: parsed.savedAtIso,
    };
  });
}

export function hasAnySavedSlot(): boolean {
  return listSaveSlots().some((s) => !s.empty);
}

export function deleteSlot(slotId: SaveSlotId): void {
  if (!SAVE_SLOT_IDS.includes(slotId)) return;
  removeRawKey(slotKey(slotId));
}

export function loadFromSlot(
  slotId: SaveSlotId,
  targetState?: GameState,
): { ok: boolean; camera?: SavedCameraState; error?: string } {
  if (!SAVE_SLOT_IDS.includes(slotId)) {
    return { ok: false, error: 'Geçersiz kayıt slotu.' };
  }
  const parsed = parseSlotSafely(slotId);
  if (!parsed) {
    return { ok: false, error: 'Bu slotta geçerli bir kayıt bulunamadı.' };
  }

  if (targetState) {
    targetState.phase = 'playing';
    targetState.selectedWorldCountryId = parsed.selectedWorldCountryId ?? parsed.playerCountryId;
    targetState.hoveredWorldCountryId = null;
    targetState.simDaysElapsed = parsed.simDaysElapsed;
    targetState.simSecondsElapsed = parsed.simSecondsElapsed;
    targetState.speed = parsed.speed;
    targetState.lastNonZeroSpeed = parsed.lastNonZeroSpeed;
    targetState.arena = structuredClone(parsed.arena);
    targetState.countries = structuredClone(parsed.countries);
    targetState.playerCountryId = parsed.playerCountryId;
    targetState.regions = structuredClone(parsed.regions);
    targetState.armies = structuredClone(parsed.armies);
    targetState.ships = structuredClone(parsed.ships);
    targetState.wounded = structuredClone(parsed.wounded ?? []);
    targetState.diplomacy = structuredClone(parsed.diplomacy);
    targetState.combatTickAccumulator = parsed.combatTickAccumulator ?? 0;

    targetState.selectedArmyId = null;
    targetState.selectedArmyIds = [];
    targetState.selectedShipId = null;
    targetState.selectedRegionId = null;
    targetState.activeBuildingRegionId = null;
    targetState.boxSelectRect = null;
    targetState.moveOrderMode = false;
    targetState.placingBuildingType = null;
    targetState.placementHoverPoint = null;
    targetState.autoPauseReasons = [];
    targetState.activeEncounter = null;
    targetState.encounterCooldownUntilSimSec = {};
    targetState.armyFocusIndex = -1;
    targetState.focusPing = null;
    targetState.tutorialSeen = parsed.tutorialSeen ?? true;
    targetState.tutorialPromptOpen = false;
    targetState.floatingEffects = [];
    targetState.toasts = [];
    targetState.endReason = null;
  }

  return {
    ok: true,
    camera: parsed.camera ? { ...parsed.camera } : undefined,
  };
}
