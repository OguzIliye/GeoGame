import { pickRegionAtPoint } from './map/arenaBuilder';
import { fetchWorldCountries, pickWorldCountryAtPoint } from './map/worldLoader';
import { MapCamera } from './render/camera';
import { renderRegionalTheater, renderWorldSelectMap } from './render/mapRenderer';
import {
  cancelSelectionAndOrderMode,
  orderArmyAttackEnemyArmy,
  orderArmyEmbarkShip,
  orderArmyMoveToRegion,
  orderShipSailToCoastalRegion,
  pickArmyAtPoint,
  pickShipAtPoint,
  tickArmiesCombatAndShips,
} from './sim/army';
import { advanceClock, togglePauseSpace } from './sim/calendar';
import { pushImportantToast, tickEconomyAndQueues } from './sim/economy';
import { createInitialGameState, startGameWithCountry } from './state/gameStore';
import type { WorldCountryFeature } from './types';
import { GameUIController } from './ui/windows';

const WORLD_BOUNDS = { minX: -172, minY: -86, maxX: 186, maxY: 66 };

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
  const uiLayer = document.getElementById('ui-layer') as HTMLDivElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D başlatılamadı');

  const state = createInitialGameState();
  const camera = new MapCamera();
  let worldCountries: WorldCountryFeature[] = [];

  const ui = new GameUIController(uiLayer, state, () => {
    state.phase = 'world_select';
    state.arena = null;
    state.countries = {};
    state.regions = {};
    state.armies = {};
    state.ships = {};
    state.wounded = [];
    cancelSelectionAndOrderMode(state);
    state.selectedRegionId = null;
    camera.setBounds(WORLD_BOUNDS, canvas.width, canvas.height, false);
    ui.forceRefresh();
  });

  function syncCursor(): void {
    if (state.phase === 'world_select') {
      canvas.style.cursor = state.hoveredWorldCountryId ? 'pointer' : 'grab';
    } else if (state.moveOrderMode) {
      canvas.style.cursor = 'crosshair';
    } else {
      canvas.style.cursor = 'default';
    }
  }

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

  // Keyboard: Space = Pause/Resume (Esc intentionally NOT bound per DESIGN.md)
  window.addEventListener('keydown', (ev) => {
    if (state.phase !== 'playing') return;
    const tag = (ev.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (ev.code === 'Space') {
      ev.preventDefault();
      togglePauseSpace(state);
      ui.syncFrame();
    }
  });

  // Clicking on any UI element outside the map cancels army move order mode per DESIGN.md
  uiLayer.addEventListener('mousedown', () => {
    if (state.moveOrderMode) {
      state.moveOrderMode = false;
      syncCursor();
    }
  });

  let isDragging = false;
  let dragMoved = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('mousedown', (ev) => {
    // Right-click cancels army/ship move order mode per DESIGN.md
    if (ev.button === 2) {
      ev.preventDefault();
      cancelSelectionAndOrderMode(state);
      if (ui.activeWindow === 'army') ui.openWindow(null, false);
      syncCursor();
      ui.syncFrame();
      return;
    }

    if (ev.button === 0) {
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

    if (state.phase !== 'playing') return;

    // Outside active arena frame -> cancel move order mode per DESIGN.md
    if (
      state.arena &&
      (pt[0] < state.arena.minX ||
        pt[0] > state.arena.maxX ||
        pt[1] < state.arena.minY ||
        pt[1] > state.arena.maxY)
    ) {
      cancelSelectionAndOrderMode(state);
      syncCursor();
      ui.syncFrame();
      return;
    }

    const hitRadius = Math.max(0.35, 16 / camera.scale);
    const clickedArmy = pickArmyAtPoint(state, pt, hitRadius);
    const clickedShip = pickShipAtPoint(state, pt, hitRadius);
    const clickedReg = pickRegionAtPoint(pt, state.regions);

    // A. Move Order Mode active (army or ship selected and awaiting destination)
    if (state.moveOrderMode) {
      if (state.selectedArmyId && state.armies[state.selectedArmyId]) {
        const myArmy = state.armies[state.selectedArmyId];

        // 1. Click friendly ship -> Embark / Re-embark ("önce askere sonra gemiye tıklamalıyız")
        if (clickedShip && clickedShip.countryId === state.playerCountryId) {
          const res = orderArmyEmbarkShip(state, myArmy.id, clickedShip.id);
          if (!res.ok && res.error) pushImportantToast(state, res.error, 'info');
          state.moveOrderMode = false;
          syncCursor();
          return;
        }

        // 2. Click enemy army -> Attack
        if (clickedArmy && clickedArmy.countryId !== state.playerCountryId) {
          const res = orderArmyAttackEnemyArmy(state, myArmy.id, clickedArmy.id);
          if (!res.ok && res.error) pushImportantToast(state, res.error, 'info');
          state.moveOrderMode = false;
          syncCursor();
          return;
        }

        // 3. Click another friendly army -> switch selection to it
        if (clickedArmy && clickedArmy.countryId === state.playerCountryId && clickedArmy.id !== myArmy.id) {
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
      state.moveOrderMode =
        clickedArmy.countryId === state.playerCountryId && !clickedArmy.inCombatWithArmyId;
      ui.openWindow('army', false);
      syncCursor();
      return;
    }

    if (clickedShip && clickedShip.countryId === state.playerCountryId) {
      state.selectedShipId = clickedShip.id;
      state.selectedArmyId = null;
      state.moveOrderMode = true;
      syncCursor();
      return;
    }

    if (clickedReg) {
      cancelSelectionAndOrderMode(state);
      state.selectedRegionId = clickedReg.id;
      if (ui.activeWindow === 'buildings') {
        ui.renderModal();
      } else if (ui.activeWindow === 'army') {
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
      tickArmiesCombatAndShips(state, dtSimSec);
    }

    ui.syncFrame();

    if (state.phase === 'world_select') {
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
