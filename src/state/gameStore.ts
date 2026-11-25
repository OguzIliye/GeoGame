import { ECONOMY } from '../config/balance';
import { buildRegionalTheater } from '../map/arenaBuilder';
import { placeInitialCountryBuildings } from '../sim/economy';
import type { GameState, Point, WorldCountryFeature } from '../types';

export function createInitialGameState(): GameState {
  return {
    phase: 'world_select',
    selectedWorldCountryId: null,
    hoveredWorldCountryId: null,
    simDaysElapsed: 0,
    simSecondsElapsed: 0,
    speed: 1,
    lastNonZeroSpeed: 1,
    arena: null,
    countries: {},
    playerCountryId: null,
    regions: {},
    armies: {},
    ships: {},
    wounded: [],
    diplomacy: {},
    combatTickAccumulator: 0,
    selectedArmyId: null,
    selectedShipId: null,
    selectedRegionId: null,
    moveOrderMode: false,
    toasts: [],
    endReason: null,
  };
}

export function startGameWithCountry(
  state: GameState,
  countryId: string,
  worldCountries: WorldCountryFeature[],
  clickPt?: Point | null,
): void {
  const built = buildRegionalTheater(countryId, worldCountries, clickPt);

  state.phase = 'playing';
  state.selectedWorldCountryId = countryId;
  state.playerCountryId = countryId;
  state.arena = built.arena;
  state.countries = built.countries;
  state.regions = built.regions;
  state.armies = {};
  state.ships = {};
  state.wounded = [];
  state.diplomacy = {};
  state.combatTickAccumulator = 0;
  state.simDaysElapsed = 0;
  state.simSecondsElapsed = 0;
  state.speed = 1;
  state.lastNonZeroSpeed = 1;
  state.selectedArmyId = null;
  state.selectedShipId = null;
  state.selectedRegionId = null;
  state.moveOrderMode = false;
  state.endReason = null;
  state.toasts = [];

  for (const c of Object.values(state.countries)) {
    c.money = ECONOMY.START_MONEY;
    c.manpower = ECONOMY.START_MANPOWER;
  }

  placeInitialCountryBuildings(state);
}
