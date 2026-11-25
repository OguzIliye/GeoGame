import { pickRegionAtPoint } from './map/arenaBuilder';
import { fetchWorldCountries, pickWorldCountryAtPoint } from './map/worldLoader';
import { MapCamera } from './render/camera';
import { renderRegionalTheater, renderWorldSelectMap } from './render/mapRenderer';
import { createInitialGameState, startGameWithCountry } from './state/gameStore';
import type { WorldCountryFeature } from './types';

const WORLD_BOUNDS = { minX: -172, minY: -86, maxX: 186, maxY: 66 };

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
  const uiLayer = document.getElementById('ui-layer') as HTMLDivElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D başlatılamadı');

  const state = createInitialGameState();
  const camera = new MapCamera();
  let worldCountries: WorldCountryFeature[] = [];

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

  function renderUI(): void {
    if (state.phase === 'world_select') {
      const hovered = worldCountries.find((c) => c.id === state.hoveredWorldCountryId);
      uiLayer.innerHTML = `
        <div class="pixel-panel top-banner">
          <strong>GEOGAME</strong>
          <span>Başlamak için dünya haritasından bir ülkeye tıklayın</span>
          ${hovered ? `<span class="badge">${hovered.name}</span>` : ''}
        </div>
      `;
      return;
    }

    const player = state.playerCountryId ? state.countries[state.playerCountryId] : null;
    const activeCount = Object.keys(state.countries).length;
    const regionList = Object.values(state.regions);
    const playerRegions = regionList.filter((r) => r.ownerId === state.playerCountryId);
    const selReg = state.selectedRegionId ? state.regions[state.selectedRegionId] : null;
    const selOwner = selReg ? state.countries[selReg.ownerId] : null;

    uiLayer.innerHTML = `
      <div class="pixel-panel top-banner">
        <strong>★ ${player?.name ?? ''}</strong>
        <span class="badge">${player?.isSmallCountry ? 'Küçük Ülke (Tier 2 Bilim)' : 'Standart Ülke'}</span>
        <span>Aktif Ülke: ${activeCount} (AI: ${activeCount - 1})</span>
        <span>Bölgelerin: ${playerRegions.length} / ${regionList.length}</span>
        <button id="btn-back-world" class="pixel-btn">Harita Seçimine Dön</button>
      </div>
      ${
        selReg
          ? `
        <div class="pixel-panel side-inspector">
          <div><strong>Bölge:</strong> ${selReg.id}</div>
          <div><strong>Sahip:</strong> ${selOwner?.name ?? '-'}</div>
          <div><strong>Biyom:</strong> ${selReg.biome}</div>
          <div><strong>Kıyı Durumu:</strong> ${selReg.isCoastal ? 'Denize Kıyısı Var (Liman Uygun)' : 'İç Bölge'}</div>
          <div><strong>Kara Komşuları:</strong> ${selReg.neighbors.length}</div>
        </div>
      `
          : ''
      }
    `;

    document.getElementById('btn-back-world')?.addEventListener('click', () => {
      state.phase = 'world_select';
      state.arena = null;
      state.countries = {};
      state.regions = {};
      state.selectedRegionId = null;
      camera.setBounds(WORLD_BOUNDS, canvas.width, canvas.height, false);
      renderUI();
    });
  }

  uiLayer.innerHTML = `<div class="pixel-panel top-banner">Dünya haritası yükleniyor...</div>`;
  worldCountries = await fetchWorldCountries('/assets/world-50m.json');
  camera.setBounds(WORLD_BOUNDS, canvas.width, canvas.height, true);
  renderUI();

  // Mouse pan / click / zoom interactions
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
        renderUI();
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
        renderUI();
      }
    } else if (state.phase === 'playing') {
      const reg = pickRegionAtPoint(pt, state.regions);
      state.selectedRegionId = reg?.id ?? null;
      renderUI();
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
    const dtSec = Math.min(0.1, (nowMs - prevMs) / 1000);
    prevMs = nowMs;
    camera.update(dtSec);

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
