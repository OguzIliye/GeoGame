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
  orderArmyMergeIntoTarget,
  orderArmyMoveToRegion,
  orderMultipleArmiesAttackEnemyArmy,
  orderMultipleArmiesMoveToRegion,
  orderShipSailToCoastalRegion,
  pickArmyAtPoint,
  pickShipAtPoint,
  selectArmiesInWorldBox,
  selectSingleArmy,
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
  getCountryRegions,
  getRegionBuildingPoint,
  pushImportantToast,
  startBuildingConstruction,
  tickEconomyAndQueues,
  validateBuildingPlacementAtPoint,
} from './sim/economy';
import { checkEndGameConditions } from './sim/scoring';
import { createInitialGameState, startGameWithCountry } from './state/gameStore';
import { loadFromSlot, type SaveSlotId, saveToSlot } from './state/saveManager';
import type { BuildingType, Point, Region, WorldCountryFeature } from './types';
import { SpotlightTutorialController } from './ui/spotlightTutorial';
import { GameUIController } from './ui/windows';

const WORLD_BOUNDS = { minX: -172, minY: -86, maxX: 186, maxY: 66 };
const PAN_KEY_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

function pickPlayerBuildingRegionNearPoint(
  state: ReturnType<typeof createInitialGameState>,
  pt: Point,
  radiusMapUnits: number,
): Region | null {
  const pid = state.playerCountryId;
  if (!pid) return null;
  let best: Region | null = null;
  let bestD2 = radiusMapUnits * radiusMapUnits;
  for (const reg of getCountryRegions(state, pid)) {
    if (!reg.building) continue;
    const [bx, by] = getRegionBuildingPoint(reg);
    const d2 = (pt[0] - bx) * (pt[0] - bx) + (pt[1] - by) * (pt[1] - by);
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = reg;
    }
  }
  return best;
}

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
  let pendingInteractiveTutorial = false;
  const heldPanKeys = new Set<string>();

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
    ui.setQuickBuildTarget(null);
    syncCursor();
  }

  function resetToWorldSelect(startTutorial = false): void {
    pendingInteractiveTutorial = startTutorial;
    tutorial?.skipOrStop();
    clearAllAutoPauses(state);
    heldPanKeys.clear();
    state.phase = 'world_select';
    state.arena = null;
    state.countries = {};
    state.regions = {};
    state.armies = {};
    state.ships = {};
    state.wounded = [];
    state.floatingEffects = [];
    state.activeEncounter = null;
    state.warAlertQueue = [];
    state.placingBuildingType = null;
    state.placementHoverPoint = null;
    state.activeBuildingRegionId = null;
    cancelSelectionAndOrderMode(state);
    state.selectedRegionId = null;
    camera.setBounds(WORLD_BOUNDS, canvas.width, canvas.height, true);
    syncCursor();
    ui.forceRefresh();
    if (startTutorial) {
      ui.mountWorldSelectBanner('📖 Tutorial için başlamak istediğiniz bir ülkeye tıklayın');
    }
  }

  function resetToMainMenu(): void {
    pendingInteractiveTutorial = false;
    resetToWorldSelect(false);
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
    ui.setQuickBuildTarget(null);
    state.placingBuildingType = type;
    state.placementHoverPoint = [camera.cx, camera.cy];
    setAutoPauseReason(state, 'building_placement', true);
    ui.openWindow(null, false, true);
    syncCursor();
    ui.syncFrame();
  }

  let tutorial: SpotlightTutorialController | null = null;

  const ui = new GameUIController(uiLayer, state, music, keyBindings, {
    onStartWorldSelect: (startTutorial = false) => {
      resetToWorldSelect(startTutorial);
    },
    onReturnToWorld: () => resetToWorldSelect(false),
    onReturnToMainMenu: resetToMainMenu,
    onSaveAndExitToMain: (slotId: SaveSlotId) => {
      tutorial?.skipOrStop();
      saveToSlot(slotId, state, { cx: camera.cx, cy: camera.cy, scale: camera.scale });
      resetToMainMenu();
    },
    onSaveAndExitToWorld: (slotId: SaveSlotId) => {
      tutorial?.skipOrStop();
      saveToSlot(slotId, state, { cx: camera.cx, cy: camera.cy, scale: camera.scale });
      resetToWorldSelect(false);
    },
    onLoadSlotFromMenu: (slotId: SaveSlotId) => {
      tutorial?.skipOrStop();
      const res = loadFromSlot(slotId, state);
      if (!res.ok) {
        ui.forceRefresh();
        return;
      }
      if (state.arena) {
        camera.setBounds(state.arena, canvas.width, canvas.height, true);
        if (res.camera) {
          camera.restoreView(res.camera.cx, res.camera.cy, res.camera.scale);
        }
      }
      syncCursor();
      ui.forceRefresh();
    },
    onCycleArmyFocus: triggerCycleArmyFocus,
    onEnterBuildingPlacement: enterBuildingPlacement,
    onCancelPlacementOrOrder: () => {
      clearAllTacticalModes();
      ui.syncFrame();
    },
    onSelectShipForOrder: (shipId: string) => {
      cancelSelectionAndOrderMode(state);
      state.selectedShipId = shipId;
      state.moveOrderMode = true;
      setAutoPauseReason(state, 'move_order', true);
      syncCursor();
      ui.syncFrame();
    },
    onRestartInteractiveTutorial: () => {
      if (state.playerCountryId && worldCountries.length > 0) {
        const currentId = state.playerCountryId;
        startGameWithCountry(state, currentId, worldCountries);
        if (state.arena) camera.setBounds(state.arena, canvas.width, canvas.height, true);
        syncCursor();
        ui.forceRefresh();
        tutorial?.start();
      } else {
        resetToWorldSelect(true);
      }
    },
    onModalInteraction: () => {
      tutorial?.syncFrame();
    },
  });

  tutorial = new SpotlightTutorialController(state, camera, ui, {
    onFinishFreshRestart: () => {
      if (!state.playerCountryId || worldCountries.length === 0) return;
      const cid = state.playerCountryId;
      startGameWithCountry(state, cid, worldCountries);
      if (state.arena) camera.setBounds(state.arena, canvas.width, canvas.height, true);
      syncCursor();
      ui.forceRefresh();
    },
    onFinishKeepPlaying: () => {
      state.tutorialHoldWoundedWithoutHospital = false;
      clearAllAutoPauses(state);
      if (state.speed === 0) setGameSpeed(state, 1);
      syncCursor();
      ui.syncFrame();
    },
  });

  window.addEventListener('pointerdown', () => music.ensureStarted(), { once: true });

  // Expose live runtime handle for automated end-to-end verification
  (window as unknown as Record<string, unknown>).__GEOGAME__ = {
    state,
    camera,
    ui,
    tutorial,
    music,
    keyBindings,
    getWorldCountries: () => worldCountries,
    selectCountryByName: (name: string, withTutorial = false) => {
      const found = worldCountries.find((c) => c.name === name);
      if (!found) return false;
      tutorial?.skipOrStop();
      startGameWithCountry(state, found.id, worldCountries, found.centroid);
      if (state.arena) camera.setBounds(state.arena, canvas.width, canvas.height, true);
      syncCursor();
      ui.forceRefresh();
      if (withTutorial) {
        tutorial?.start();
      }
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

  worldCountries = await fetchWorldCountries('./assets/world-50m.json');
  camera.setBounds(WORLD_BOUNDS, canvas.width, canvas.height, true);
  ui.forceRefresh();

  // Keyboard shortcuts + WASD / Arrow camera panning
  window.addEventListener('keydown', (ev) => {
    if (ui.listeningKeyAction) return;
    const tag = (ev.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    const action = keyBindings.getActionForCode(ev.code);
    if (!action && PAN_KEY_CODES.has(ev.code)) {
      if (state.phase === 'world_select' || state.phase === 'playing') {
        heldPanKeys.add(ev.code);
      }
      return;
    }
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
        ui.openWindow('shop');
        break;
      case 'openFactory':
        ui.openWindow('factory');
        break;
      case 'openBarracks':
        ui.openWindow('barracks');
        break;
      case 'openScience':
        ui.openWindow('university');
        break;
      case 'openDiplomacy':
        ui.openWindow('diplomacy');
        break;
      case 'openSettings':
        ui.openWindow('settings');
        break;
    }
  });

  window.addEventListener('keyup', (ev) => {
    heldPanKeys.delete(ev.code);
  });

  window.addEventListener('blur', () => {
    heldPanKeys.clear();
  });

  // Clicking on UI elements outside the map cancels army move order mode (except bottom-right army panel)
  uiLayer.addEventListener('mousedown', (ev) => {
    const targetEl = ev.target as HTMLElement | null;
    const insideQuickBuild = targetEl?.closest('.quick-build-menu');
    if (!insideQuickBuild && ui.quickBuildTarget) {
      ui.setQuickBuildTarget(null);
    }
    const insideArmyPanel = targetEl?.closest('#multi-army-panel');
    if (state.moveOrderMode && !insideArmyPanel) {
      state.moveOrderMode = false;
      setAutoPauseReason(state, 'move_order', false);
      syncCursor();
    }
  });

  // RTS Mouse State:
  // - Right/Middle drag = Camera Pan (Right single click <4px = Cancel!)
  // - Left drag in 'playing' = Box-Select friendly armies; Left drag in 'world_select' = Pan world map
  let isLeftDown = false;
  let leftMoved = false;
  let leftStartX = 0;
  let leftStartY = 0;
  let leftLastX = 0;
  let leftLastY = 0;

  let isPanDown = false;
  let panButton = -1;
  let panMoved = false;
  let panStartX = 0;
  let panStartY = 0;
  let panLastX = 0;
  let panLastY = 0;

  canvas.addEventListener('mousedown', (ev) => {
    if (state.phase === 'main_menu') return;

    if (ev.button === 1 || ev.button === 2) {
      ev.preventDefault();
      isPanDown = true;
      panButton = ev.button;
      panMoved = false;
      panStartX = ev.clientX;
      panStartY = ev.clientY;
      panLastX = ev.clientX;
      panLastY = ev.clientY;
      canvas.style.cursor = 'grabbing';
      return;
    }

    if (ev.button === 0) {
      isLeftDown = true;
      leftMoved = false;
      leftStartX = ev.clientX;
      leftStartY = ev.clientY;
      leftLastX = ev.clientX;
      leftLastY = ev.clientY;
    }
  });

  window.addEventListener('mousemove', (ev) => {
    if (isPanDown) {
      const dx = ev.clientX - panLastX;
      const dy = ev.clientY - panLastY;
      if (Math.hypot(ev.clientX - panStartX, ev.clientY - panStartY) >= 4) {
        panMoved = true;
      }
      if (panMoved) {
        camera.panByPixels(dx, dy);
        if (ui.quickBuildTarget) ui.setQuickBuildTarget(null);
      }
      panLastX = ev.clientX;
      panLastY = ev.clientY;
      return;
    }

    if (isLeftDown) {
      const totalDist = Math.hypot(ev.clientX - leftStartX, ev.clientY - leftStartY);
      if (totalDist > 5) leftMoved = true;

      if (leftMoved) {
        if (state.phase === 'world_select') {
          camera.panByPixels(ev.clientX - leftLastX, ev.clientY - leftLastY);
        } else if (state.phase === 'playing' && !state.placingBuildingType) {
          state.boxSelectRect = {
            x1: leftStartX,
            y1: leftStartY,
            x2: ev.clientX,
            y2: ev.clientY,
          };
        }
      }
      leftLastX = ev.clientX;
      leftLastY = ev.clientY;
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
    // Finish Right/Middle pan or Right-Click (<4px) Cancel!
    if ((ev.button === 1 || ev.button === 2) && isPanDown && ev.button === panButton) {
      isPanDown = false;
      if (ev.button === 2 && !panMoved) {
        clearAllTacticalModes();
        ui.syncFrame();
      } else {
        syncCursor();
      }
      panButton = -1;
      return;
    }

    if (ev.button !== 0 || !isLeftDown) return;
    isLeftDown = false;

    // Handle Left-Drag Box-Select completion in 'playing' phase!
    if (leftMoved) {
      if (state.phase === 'playing' && state.boxSelectRect && state.playerCountryId) {
        const p1 = camera.screenToMap(
          state.boxSelectRect.x1,
          state.boxSelectRect.y1,
          canvas.width,
          canvas.height,
        );
        const p2 = camera.screenToMap(
          state.boxSelectRect.x2,
          state.boxSelectRect.y2,
          canvas.width,
          canvas.height,
        );
        state.boxSelectRect = null;
        ui.setQuickBuildTarget(null);

        const hits = selectArmiesInWorldBox(
          state,
          state.playerCountryId,
          p1[0],
          p1[1],
          p2[0],
          p2[1],
        );
        if (hits.length >= 2) {
          state.moveOrderMode = false;
          setAutoPauseReason(state, 'move_order', false);
          if (ui.activeWindow) ui.openWindow(null, false);
        } else if (hits.length === 1) {
          const single = hits[0];
          const canCommand = !single.inCombatWithArmyId;
          state.moveOrderMode = canCommand;
          setAutoPauseReason(state, 'move_order', canCommand);
        } else {
          cancelSelectionAndOrderMode(state);
        }
        syncCursor();
        ui.syncFrame();
      } else {
        state.boxSelectRect = null;
      }
      return;
    }

    state.boxSelectRect = null;
    const pt = camera.screenToMap(ev.clientX, ev.clientY, canvas.width, canvas.height);

    if (state.phase === 'world_select') {
      const hit = pickWorldCountryAtPoint(pt, worldCountries);
      if (hit) {
        const shouldRunTutorial = pendingInteractiveTutorial;
        pendingInteractiveTutorial = false;
        startGameWithCountry(state, hit.id, worldCountries, pt);
        if (state.arena) {
          camera.setBounds(state.arena, canvas.width, canvas.height, false);
        }
        syncCursor();
        ui.forceRefresh();
        if (shouldRunTutorial) {
          tutorial?.start();
        }
      }
      return;
    }

    if (
      state.phase !== 'playing' ||
      state.activeEncounter ||
      (state.warAlertQueue?.length ?? 0) > 0
    ) {
      return;
    }

    // Outside active arena frame -> cancel tactical modes
    if (
      state.arena &&
      (pt[0] < state.arena.minX ||
        pt[0] > state.arena.maxX ||
        pt[1] < state.arena.minY ||
        pt[1] > state.arena.maxY)
    ) {
      if (tutorial?.isActive && !tutorial.hidden) {
        tutorial.triggerWrongClickFlash();
        return;
      }
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
        tutorial?.triggerWrongClickFlash();
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
        tutorial?.triggerWrongClickFlash();
        return;
      }
      state.selectedRegionId = check.region.id;
      cancelBuildingPlacement();
      ui.syncFrame();
      tutorial?.syncFrame();
      return;
    }

    const hitRadius = Math.max(0.32, 17 / camera.scale);
    const clickedArmy = pickArmyAtPoint(state, pt, hitRadius, state.playerCountryId);
    const clickedShip = pickShipAtPoint(state, pt, hitRadius);
    const clickedBuildingReg = pickPlayerBuildingRegionNearPoint(
      state,
      pt,
      Math.max(0.36, 20 / camera.scale),
    );
    const clickedReg = pickRegionAtPoint(pt, state.regions);

    // A0. Multi-Army Selection (`selectedArmyIds.length >= 2`) -> Collective Move or Collective Attack!
    if (state.selectedArmyIds.length >= 2 && state.playerCountryId) {
      if (clickedArmy && clickedArmy.countryId !== state.playerCountryId) {
        const res = orderMultipleArmiesAttackEnemyArmy(state, state.selectedArmyIds, clickedArmy.id);
        if (!res.ok && res.error) pushImportantToast(state, res.error, 'info');
        ui.syncFrame();
        return;
      }
      if (clickedReg) {
        const res = orderMultipleArmiesMoveToRegion(state, state.selectedArmyIds, clickedReg.id, pt);
        if (!res.ok && res.error) pushImportantToast(state, res.error, 'info');
        ui.syncFrame();
        return;
      }
      cancelSelectionAndOrderMode(state);
      ui.syncFrame();
      return;
    }

    // A. Single Army / Ship Move Order Mode active
    if (state.moveOrderMode) {
      if (state.selectedArmyId && state.armies[state.selectedArmyId]) {
        const myArmy = state.armies[state.selectedArmyId];

        // 1. Click friendly ship -> Embark
        if (clickedShip && clickedShip.countryId === state.playerCountryId) {
          const res = orderArmyEmbarkShip(state, myArmy.id, clickedShip.id);
          if (!res.ok && res.error) pushImportantToast(state, res.error, 'info');
          state.moveOrderMode = false;
          setAutoPauseReason(state, 'move_order', false);
          syncCursor();
          return;
        }

        // 2. Click enemy army -> Attack / Reinforce!
        if (clickedArmy && clickedArmy.countryId !== state.playerCountryId) {
          const res = orderArmyAttackEnemyArmy(state, myArmy.id, clickedArmy.id);
          if (!res.ok && res.error) pushImportantToast(state, res.error, 'info');
          state.moveOrderMode = false;
          setAutoPauseReason(state, 'move_order', false);
          syncCursor();
          return;
        }

        // 3. Click ANOTHER friendly army -> Walk toward it and auto-merge on contact!
        if (
          clickedArmy &&
          clickedArmy.countryId === state.playerCountryId &&
          clickedArmy.id !== myArmy.id
        ) {
          const res = orderArmyMergeIntoTarget(state, myArmy.id, clickedArmy.id);
          if (!res.ok && res.error) pushImportantToast(state, res.error, 'info');
          state.moveOrderMode = false;
          setAutoPauseReason(state, 'move_order', false);
          selectSingleArmy(state, clickedArmy.id);
          syncCursor();
          ui.syncFrame();
          return;
        }

        // 4. Click target region -> Move / Capture
        if (clickedReg) {
          const res = orderArmyMoveToRegion(state, myArmy.id, clickedReg.id, pt);
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

    // B. Normal Selection Mode (select own army without opening any modal; actions appear in bottom-right panel)
    if (clickedArmy && clickedArmy.countryId === state.playerCountryId) {
      ui.setQuickBuildTarget(null);
      selectSingleArmy(state, clickedArmy.id);
      const canCommand = !clickedArmy.inCombatWithArmyId;
      state.moveOrderMode = canCommand;
      setAutoPauseReason(state, 'move_order', canCommand);
      syncCursor();
      ui.syncFrame();
      return;
    }

    if (clickedShip && clickedShip.countryId === state.playerCountryId) {
      ui.setQuickBuildTarget(null);
      cancelSelectionAndOrderMode(state);
      state.selectedShipId = clickedShip.id;
      state.moveOrderMode = true;
      setAutoPauseReason(state, 'move_order', true);
      syncCursor();
      return;
    }

    // Click own Building on map -> highlight + open that building's popup + auto-pause!
    const ownBuildingTarget =
      clickedBuildingReg ??
      (clickedReg && clickedReg.ownerId === state.playerCountryId && clickedReg.building
        ? clickedReg
        : null);
    if (ownBuildingTarget) {
      cancelSelectionAndOrderMode(state);
      ui.openBuildingPopupForRegion(ownBuildingTarget.id);
      syncCursor();
      return;
    }

    if (clickedReg) {
      cancelSelectionAndOrderMode(state);
      state.selectedRegionId = clickedReg.id;
      if (BUILDING_POPUP_ACTIVE(ui.activeWindow)) {
        ui.openWindow(null, false);
      }

      // Click own EMPTY Region -> highlight + show floating Quick-Build Mini Menu!
      if (clickedReg.ownerId === state.playerCountryId && clickedReg.building === null) {
        ui.setQuickBuildTarget({
          regionId: clickedReg.id,
          point: pt,
          screenX: ev.clientX,
          screenY: ev.clientY,
        });
      } else {
        ui.setQuickBuildTarget(null);
      }
      syncCursor();
      return;
    }

    // Clicked open sea -> clear selection & menus
    clearAllTacticalModes();
    state.selectedRegionId = null;
    syncCursor();
  });

  function BUILDING_POPUP_ACTIVE(w: typeof ui.activeWindow): boolean {
    return (
      w === 'bank' ||
      w === 'university' ||
      w === 'hospital' ||
      w === 'barracks' ||
      w === 'factory' ||
      w === 'port'
    );
  }

  canvas.addEventListener(
    'wheel',
    (ev) => {
      if (state.phase === 'main_menu') return;
      ev.preventDefault();
      if (ui.quickBuildTarget) ui.setQuickBuildTarget(null);
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

    // Smooth WASD / Arrow Key Camera Panning
    if (heldPanKeys.size > 0 && (state.phase === 'world_select' || state.phase === 'playing')) {
      const panSpeedPx = 540 * dtRealSec;
      let vx = 0;
      let vy = 0;
      if (heldPanKeys.has('KeyA') || heldPanKeys.has('ArrowLeft')) vx += panSpeedPx;
      if (heldPanKeys.has('KeyD') || heldPanKeys.has('ArrowRight')) vx -= panSpeedPx;
      if (heldPanKeys.has('KeyW') || heldPanKeys.has('ArrowUp')) vy += panSpeedPx;
      if (heldPanKeys.has('KeyS') || heldPanKeys.has('ArrowDown')) vy -= panSpeedPx;
      if (vx !== 0 || vy !== 0) {
        camera.panByPixels(vx, vy);
      }
    }

    camera.update(dtRealSec);

    const dtSimSec = advanceClock(state, dtRealSec);
    if (dtSimSec > 0) {
      const tutForeground = Boolean(tutorial?.isActive && !tutorial.hidden);
      const speedMult = tutForeground ? 3 : 1;
      tickEconomyAndQueues(state, dtSimSec, speedMult);
      if (!tutForeground) {
        tickAICountries(state, dtSimSec);
      }
      tickArmiesCombatAndShips(state, dtSimSec * speedMult, 1);
      checkEndGameConditions(state);
    }

    ui.syncFrame();
    tutorial?.syncFrame();

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
