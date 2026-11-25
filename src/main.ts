import { pickRegionAtPoint } from './map/arenaBuilder';
import { fetchWorldCountries, pickWorldCountryAtPoint } from './map/worldLoader';
import { MapCamera } from './render/camera';
import { renderRegionalTheater, renderWorldSelectMap } from './render/mapRenderer';
import { advanceClock, togglePauseSpace } from './sim/calendar';
import { tickEconomyAndQueues } from './sim/economy';
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
    state.selectedRegionId = null;
    camera.setBounds(WORLD_BOUNDS, canvas.width, canvas.height, false);
    ui.forceRefresh();
  });

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

  let isDragging = false;
  let dragMoved = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('mousedown', (ev) => {
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
        canvas.style.cursor = nextId ? 'pointer' : 'grab';
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
        canvas.style.cursor = 'default';
        ui.forceRefresh();
      }
    } else if (state.phase === 'playing') {
      const reg = pickRegionAtPoint(pt, state.regions);
      state.selectedRegionId = reg?.id ?? null;
      if (ui.activeWindow === 'buildings') {
        ui.renderModal();
      }
    }
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
