import { RetroMusicController } from './audio/music';
import { KeyBindingsManager } from './config/keybindings';
import { pickRegionAtPoint } from './map/arenaBuilder';
import { fetchWorldCountries, pickWorldCountryAtPoint } from './map/worldLoader';
import { MapCamera } from './render/camera';
import {
  renderMainMenuPixelScene,
  renderRegionalTheater,
  renderWorldSelectMap,
} from './render/mapRenderer';
import { tickAICountries } from './sim/ai';
import {
  cancelSelectionAndOrderMode,
  cyclePlayerArmyFocus,
  orderArmyAttackEnemyArmy,
  orderArmyEmbarkShip,
  orderArmyMoveToRegion,
  orderShipSailToCoastalRegion,
  pickArmyAtPoint,
  pickShipAtPoint,
  tickArmiesCombatAndShips,
} from './sim/army';
import {
  advanceClock,
  clearAllAutoPauses,
  setAutoPauseReason,
  setGameSpeed,
  togglePauseSpace,
} from './sim/calendar';
import {
  pushImportantToast,
  startBuildingConstruction,
  tickEconomyAndQueues,
  validateBuildingPlacementAtPoint,
} from './sim/economy';
import { checkEndGameConditions } from './sim/scoring';
import { createInitialGameState, startGameWithCountry } from './state/gameStore';
import type { BuildingType, WorldCountryFeature } from './types';
import { GameUIController } from './ui/windows';

const WORLD_BOUNDS = { minX: -172, minY: -86, maxX: 186, maxY: 66 };

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
  const uiLayer = document.getElementById('ui-layer') as HTMLDivElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D başlatılamadı');

  const state = createInitialGameState();
  const camera = new MapCamera();
  const music = new RetroMusicController();
  const keyBindings = new KeyBindingsManager();
  let worldCountries: WorldCountryFeature[] = [];

  function syncCursor(): void {
    if (state.phase === 'main_menu') {
      canvas.style.cursor = 'default';
    } else if (state.phase === 'world_select') {
      canvas.style.cursor = state.hoveredWorldCountryId ? 'pointer' : 'grab';
    } else if (state.placingBuildingType || state.moveOrderMode) {
      canvas.style.cursor = 'crosshair';
    } else {
      canvas.style.cursor = 'default';
    }
  }

  function cancelBuildingPlacement(): void {
    state.placingBuildingType = null;
    state.placementHoverPoint = null;
    setAutoPauseReason(state, 'building_placement', false);
    syncCursor();
  }

  function clearAllTacticalModes(): void {
    cancelBuildingPlacement();
    cancelSelectionAndOrderMode(state);
    syncCursor();
  }

  function resetToWorldSelect(): void {
    clearAllAutoPauses(state);
    state.phase = 'world_select';
    state.arena = null;
    state.countries = {};
    state.regions = {};
    state.armies = {};
    state.ships = {};
    state.wounded = [];
    state.floatingEffects = [];
    state.activeEncounter = null;
    state.placingBuildingType = null;
    state.placementHoverPoint = null;
    cancelSelectionAndOrderMode(state);
    state.selectedRegionId = null;
    camera.setBounds(WORLD_BOUNDS, canvas.width, canvas.height, true);
    syncCursor();
    ui.forceRefresh();
  }

  function resetToMainMenu(): void {
    resetToWorldSelect();
    state.phase = 'main_menu';
    state.tutorialPromptOpen = false;
    syncCursor();
    ui.forceRefresh();
  }

  function triggerCycleArmyFocus(): void {
    const res = cyclePlayerArmyFocus(state, performance.now());
    if (!res.ok || !res.target) {
      pushImportantToast(state, 'Haritada aktif ordunuz bulunmuyor.', 'info');
      return;
    }
    camera.focusOnPoint(res.target.x, res.target.y);
    ui.syncFrame();
  }

  function enterBuildingPlacement(type: BuildingType): void {
    cancelSelectionAndOrderMode(state);
    state.placingBuildingType = type;
    state.placementHoverPoint = [camera.cx, camera.cy];
    setAutoPauseReason(state, 'building_placement', true);
    ui.openWindow(null, false);
    syncCursor();
    ui.syncFrame();
  }

  const ui = new GameUIController(uiLayer, state, music, keyBindings, {
    onStartWorldSelect: () => {
      state.phase = 'world_select';
      camera.setBounds(WORLD_BOUNDS, canvas.width, canvas.height, true);
      syncCursor();
      ui.forceRefresh();
    },
    onReturnToWorld: resetToWorldSelect,
    onReturnToMainMenu: resetToMainMenu,
    onCycleArmyFocus: triggerCycleArmyFocus,
    onEnterBuildingPlacement: enterBuildingPlacement,
    onCancelPlacementOrOrder: () => {
      clearAllTacticalModes();
      if (ui.activeWindow === 'army') ui.openWindow(null, false);
      ui.syncFrame();
    },
  });

  // Start Web Audio music loop on first user interaction (browser autoplay compliance)
  window.addEventListener('pointerdown', () => music.ensureStarted(), { once: true });

  // Expose live runtime handle for automated end-to-end verification
  (window as unknown as Record<string, unknown>).__GEOGAME__ = {
    state,
    camera,
    ui,
    music,
    keyBindings,
    getWorldCountries: () => worldCountries,
    selectCountryByName: (name: string) => {
      const found = worldCountries.find((c) => c.name === name);
      if (!found) return false;
      startGameWithCountry(state, found.id, worldCountries, found.centroid);
      if (state.arena) camera.setBounds(state.arena, canvas.width, canvas.height, true);
      syncCursor();
      ui.forceRefresh();
      return true;
    },
  };

  function resize(): void {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (state.phase === 'world_select') {
      camera.setBounds(WORLD_BOUNDS, canvas.width, canvas.height, true);
    } else if (state.arena) {
      camera.setBounds(state.arena, canvas.width, canvas.height, false);
    }
  }
  window.addEventListener('resize', resize);
  resize();

  worldCountries = await fetchWorldCountries('/assets/world-50m.json');
  camera.setBounds(WORLD_BOUNDS, canvas.width, canvas.height, true);
  ui.forceRefresh();

  // Keyboard shortcuts via KeyBindingsManager (Esc never bound per DESIGN.md)
  window.addEventListener('keydown', (ev) => {
    if (ui.listeningKeyAction) return;
    const tag = (ev.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    const action = keyBindings.getActionForCode(ev.code);
    if (!action) return;

    if (action === 'openTutorial') {
      ev.preventDefault();
      ui.toggleTutorial();
      return;
    }

    if (state.phase !== 'playing') return;
    ev.preventDefault();

    switch (action) {
      case 'togglePause':
        togglePauseSpace(state);
        ui.syncFrame();
        break;
      case 'speedSlow':
        setGameSpeed(state, 0.5);
        ui.syncFrame();
        break;
      case 'speedNormal':
        setGameSpeed(state, 1);
        ui.syncFrame();
        break;
      case 'speedFast':
        setGameSpeed(state, 2);
        ui.syncFrame();
        break;
      case 'cycleArmy':
        triggerCycleArmyFocus();
        break;
      case 'openBuildings':
        ui.openWindow('buildings');
        break;
      case 'openFactory':
        ui.openWindow('factory');
        break;
      case 'openBarracks':
        ui.openWindow('barracks');
        break;
      case 'openScience':
        ui.openWindow('science');
        break;
      case 'openDiplomacy':
        ui.openWindow('diplomacy');
        break;
      case 'openSettings':
        ui.openWindow('settings');
        break;
    }
  });

  // Clicking on UI elements outside the map cancels army move order mode per DESIGN.md
  uiLayer.addEventListener('mousedown', () => {
    if (state.moveOrderMode) {
      state.moveOrderMode = false;
      setAutoPauseReason(state, 'move_order', false);
      syncCursor();
    }
  });

  let isDragging = false;
  let dragMoved = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('mousedown', (ev) => {
    // Right-click cancels building placement or army/ship move order mode
    if (ev.button === 2) {
      ev.preventDefault();
      clearAllTacticalModes();
      if (ui.activeWindow === 'army') ui.openWindow(null, false);
      ui.syncFrame();
      return;
    }

    if (ev.button === 0 && state.phase !== 'main_menu') {
      isDragging = true;
      dragMoved = false;
      lastX = ev.clientX;
      lastY = ev.clientY;
    }
  });

  window.addEventListener('mousemove', (ev) => {
    if (isDragging) {
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      if (Math.hypot(dx, dy) > 4) dragMoved = true;
      if (dragMoved) {
        camera.panByPixels(dx, dy);
      }
      lastX = ev.clientX;
      lastY = ev.clientY;
      return;
    }

    if (state.phase === 'world_select' && worldCountries.length > 0) {
      const pt = camera.screenToMap(ev.clientX, ev.clientY, canvas.width, canvas.height);
      const hit = pickWorldCountryAtPoint(pt, worldCountries);
      const nextId = hit?.id ?? null;
      if (nextId !== state.hoveredWorldCountryId) {
        state.hoveredWorldCountryId = nextId;
        syncCursor();
        ui.setHoveredWorldCountryName(hit?.name ?? null);
      }
      return;
    }

    if (state.phase === 'playing' && state.placingBuildingType) {
      state.placementHoverPoint = camera.screenToMap(
        ev.clientX,
        ev.clientY,
        canvas.width,
        canvas.height,
      );
    }
  });

  window.addEventListener('mouseup', (ev) => {
    if (ev.button !== 0 || !isDragging) return;
    isDragging = false;
    if (dragMoved) return;

    const pt = camera.screenToMap(ev.clientX, ev.clientY, canvas.width, canvas.height);
    if (state.phase === 'world_select') {
      const hit = pickWorldCountryAtPoint(pt, worldCountries);
      if (hit) {
        startGameWithCountry(state, hit.id, worldCountries, pt);
        if (state.arena) {
          camera.setBounds(state.arena, canvas.width, canvas.height, false);
        }
        syncCursor();
        ui.forceRefresh();
      }
      return;
    }

    if (state.phase !== 'playing' || state.activeEncounter) return;

    // Outside active arena frame -> cancel placement or move order mode
    if (
      state.arena &&
      (pt[0] < state.arena.minX ||
        pt[0] > state.arena.maxX ||
        pt[1] < state.arena.minY ||
        pt[1] > state.arena.maxY)
    ) {
      clearAllTacticalModes();
      ui.syncFrame();
      return;
    }

    // 0. Interactive Mouse Building Placement Mode!
    if (state.placingBuildingType && state.playerCountryId) {
      const check = validateBuildingPlacementAtPoint(
        state,
        state.playerCountryId,
        state.placingBuildingType,
        pt,
      );
      if (!check.ok || !check.region) {
        pushImportantToast(state, check.reason || 'Buraya bina kurulamaz.', 'info');
        return;
      }
      const res = startBuildingConstruction(
        state,
        state.playerCountryId,
        check.region.id,
        state.placingBuildingType,
        pt,
      );
      if (!res.ok) {
        pushImportantToast(state, res.error || 'İnşaat başlatılamadı.', 'info');
        return;
      }
      state.selectedRegionId = check.region.id;
      cancelBuildingPlacement();
      ui.syncFrame();
      return;
    }

    const hitRadius = Math.max(0.35, 18 / camera.scale);
    const clickedArmy = pickArmyAtPoint(state, pt, hitRadius);
    const clickedShip = pickShipAtPoint(state, pt, hitRadius);
    const clickedReg = pickRegionAtPoint(pt, state.regions);

    // A. Move Order Mode active (army or ship selected and awaiting destination; game auto-paused!)
    if (state.moveOrderMode) {
      if (state.selectedArmyId && state.armies[state.selectedArmyId]) {
        const myArmy = state.armies[state.selectedArmyId];

        // 1. Click friendly ship -> Embark / Re-embark
        if (clickedShip && clickedShip.countryId === state.playerCountryId) {
          const res = orderArmyEmbarkShip(state, myArmy.id, clickedShip.id);
          if (!res.ok && res.error) pushImportantToast(state, res.error, 'info');
          state.moveOrderMode = false;
          setAutoPauseReason(state, 'move_order', false);
          syncCursor();
          return;
        }

        // 2. Click enemy army -> Attack
        if (clickedArmy && clickedArmy.countryId !== state.playerCountryId) {
          const res = orderArmyAttackEnemyArmy(state, myArmy.id, clickedArmy.id);
          if (!res.ok && res.error) pushImportantToast(state, res.error, 'info');
          state.moveOrderMode = false;
          setAutoPauseReason(state, 'move_order', false);
          syncCursor();
          return;
        }

        // 3. Click another friendly army -> switch selection to it
        if (
          clickedArmy &&
          clickedArmy.countryId === state.playerCountryId &&
          clickedArmy.id !== myArmy.id
        ) {
          state.selectedArmyId = clickedArmy.id;
          ui.openWindow('army', false);
          syncCursor();
          return;
        }

        // 4. Click target region -> Move / Capture
        if (clickedReg) {
          const res = orderArmyMoveToRegion(state, myArmy.id, clickedReg.id, pt);
          if (!res.ok && res.error) pushImportantToast(state, res.error, 'info');
          state.moveOrderMode = false;
          setAutoPauseReason(state, 'move_order', false);
          if (ui.activeWindow === 'army') ui.openWindow(null, false);
          syncCursor();
          return;
        }

        // Clicked open sea / non-target -> cancel
        cancelSelectionAndOrderMode(state);
        if (ui.activeWindow === 'army') ui.openWindow(null, false);
        syncCursor();
        return;
      }

      if (state.selectedShipId && state.ships[state.selectedShipId]) {
        if (clickedReg) {
          const res = orderShipSailToCoastalRegion(state, state.selectedShipId, clickedReg.id);
          if (!res.ok && res.error) pushImportantToast(state, res.error, 'info');
          state.moveOrderMode = false;
          setAutoPauseReason(state, 'move_order', false);
          syncCursor();
          return;
        }
        cancelSelectionAndOrderMode(state);
        syncCursor();
        return;
      }
    }

    // B. Normal Selection Mode
    if (clickedArmy) {
      state.selectedArmyId = clickedArmy.id;
      state.selectedShipId = null;
      const canCommand =
        clickedArmy.countryId === state.playerCountryId && !clickedArmy.inCombatWithArmyId;
      state.moveOrderMode = canCommand;
      setAutoPauseReason(state, 'move_order', canCommand);
      ui.openWindow('army', false);
      syncCursor();
      return;
    }

    if (clickedShip && clickedShip.countryId === state.playerCountryId) {
      state.selectedShipId = clickedShip.id;
      state.selectedArmyId = null;
      state.moveOrderMode = true;
      setAutoPauseReason(state, 'move_order', true);
      syncCursor();
      return;
    }

    if (clickedReg) {
      cancelSelectionAndOrderMode(state);
      state.selectedRegionId = clickedReg.id;
      if (ui.activeWindow === 'army') {
        ui.openWindow(null, false);
      }
      syncCursor();
      return;
    }

    // Clicked outside land/units -> cancel selection
    cancelSelectionAndOrderMode(state);
    state.selectedRegionId = null;
    if (ui.activeWindow === 'army') ui.openWindow(null, false);
    syncCursor();
  });

  canvas.addEventListener(
    'wheel',
    (ev) => {
      if (state.phase === 'main_menu') return;
      ev.preventDefault();
      const factor = ev.deltaY < 0 ? 1.18 : 1 / 1.18;
      camera.zoomAtScreenPoint(factor, ev.clientX, ev.clientY, canvas.width, canvas.height);
    },
    { passive: false },
  );

  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  let prevMs = performance.now();
  function frame(nowMs: number): void {
    const dtRealSec = Math.min(0.1, (nowMs - prevMs) / 1000);
    prevMs = nowMs;
    camera.update(dtRealSec);

    const dtSimSec = advanceClock(state, dtRealSec);
    if (dtSimSec > 0) {
      tickEconomyAndQueues(state, dtSimSec);
      tickAICountries(state, dtSimSec);
      tickArmiesCombatAndShips(state, dtSimSec);
      checkEndGameConditions(state);
    }

    ui.syncFrame();

    if (state.phase === 'main_menu') {
      renderMainMenuPixelScene(ctx!, canvas.width, canvas.height, nowMs);
    } else if (state.phase === 'world_select') {
      renderWorldSelectMap(ctx!, worldCountries, state, camera, canvas.width, canvas.height, nowMs);
    } else {
      renderRegionalTheater(ctx!, state, camera, canvas.width, canvas.height, nowMs);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

bootstrap().catch((err) => {
  console.error(err);
});
