import type { GameState, MultiPolygonCoords, Region, WorldCountryFeature } from '../types';
import { MapCamera } from './camera';

function traceMultiPolygon(
  ctx: CanvasRenderingContext2D,
  mp: MultiPolygonCoords,
  camera: MapCamera,
  viewW: number,
  viewH: number,
): void {
  ctx.beginPath();
  for (const poly of mp) {
    for (const ring of poly) {
      if (ring.length < 3) continue;
      const [sx0, sy0] = camera.mapToScreen(ring[0][0], ring[0][1], viewW, viewH);
      ctx.moveTo(sx0, sy0);
      for (let i = 1; i < ring.length; i++) {
        const [sx, sy] = camera.mapToScreen(ring[i][0], ring[i][1], viewW, viewH);
        ctx.lineTo(sx, sy);
      }
      ctx.closePath();
    }
  }
}

function drawSeaBackground(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewW: number,
  viewH: number,
  realTimeMs: number,
): void {
  ctx.fillStyle = '#0f2942';
  ctx.fillRect(0, 0, viewW, viewH);

  // Crisp pixel-art sea wave ticks
  ctx.fillStyle = '#163a5c';
  const stepPx = 44;
  const phase = Math.floor(realTimeMs / 450) % 2;
  const offsetX = ((-camera.cx * camera.scale) % stepPx + stepPx) % stepPx;
  const offsetY = ((-camera.cy * camera.scale) % stepPx + stepPx) % stepPx;

  for (let y = offsetY - stepPx; y < viewH + stepPx; y += stepPx) {
    const row = Math.round((y - offsetY) / stepPx);
    for (let x = offsetX - stepPx; x < viewW + stepPx; x += stepPx) {
      const shift = ((row + phase) % 2) * 14;
      const wx = Math.round(x + shift);
      const wy = Math.round(y);
      ctx.fillRect(wx, wy, 10, 2);
      ctx.fillRect(wx + 3, wy - 2, 4, 2);
    }
  }
}

export function renderWorldSelectMap(
  ctx: CanvasRenderingContext2D,
  worldCountries: WorldCountryFeature[],
  state: GameState,
  camera: MapCamera,
  viewW: number,
  viewH: number,
  realTimeMs: number,
): void {
  ctx.imageSmoothingEnabled = false;
  drawSeaBackground(ctx, camera, viewW, viewH, realTimeMs);

  for (let i = 0; i < worldCountries.length; i++) {
    const c = worldCountries[i];
    const isHovered = c.id === state.hoveredWorldCountryId;
    traceMultiPolygon(ctx, c.polygons, camera, viewW, viewH);

    // Warm pixel-atlas palette on static selection screen
    const shade = 30 + ((i * 37) % 24);
    ctx.fillStyle = isHovered ? '#facc15' : `hsl(142, 26%, ${shade}%)`;
    ctx.fill();
    ctx.lineWidth = isHovered ? 2 : 1;
    ctx.strokeStyle = isHovered ? '#fef08a' : '#0b1929';
    ctx.stroke();
  }

  if (state.hoveredWorldCountryId) {
    const hovered = worldCountries.find((c) => c.id === state.hoveredWorldCountryId);
    if (hovered) {
      const [sx, sy] = camera.mapToScreen(hovered.centroid[0], hovered.centroid[1], viewW, viewH);
      drawPixelTag(ctx, hovered.name, sx, sy - 14, '#fef08a', '#0f172a');
    }
  }
}

function mixHexWithBiome(hex: string, biome: Region['biome']): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  let br = 120;
  let bg = 165;
  let bb = 110;
  if (biome === 'desert') {
    br = 212;
    bg = 184;
    bb = 114;
  } else if (biome === 'mountain') {
    br = 148;
    bg = 152;
    bb = 160;
  } else if (biome === 'forest') {
    br = 74;
    bg = 138;
    bb = 88;
  }
  const mr = Math.round(r * 0.72 + br * 0.28);
  const mg = Math.round(g * 0.72 + bg * 0.28);
  const mb = Math.round(b * 0.72 + bb * 0.28);
  return `rgb(${mr}, ${mg}, ${mb})`;
}

export function renderRegionalTheater(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: MapCamera,
  viewW: number,
  viewH: number,
  realTimeMs: number,
): void {
  ctx.imageSmoothingEnabled = false;
  drawSeaBackground(ctx, camera, viewW, viewH, realTimeMs);

  // Draw subtle arena boundary frame (outside is unrendered void/sea)
  if (state.arena) {
    const [x1, y1] = camera.mapToScreen(state.arena.minX, state.arena.minY, viewW, viewH);
    const [x2, y2] = camera.mapToScreen(state.arena.maxX, state.arena.maxY, viewW, viewH);
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.restore();
  }

  const regionList = Object.values(state.regions);

  // 1. Fill only active regions (inactive ~180 world countries are never rendered!)
  for (const reg of regionList) {
    const owner = state.countries[reg.ownerId];
    if (!owner) continue;
    const isSelected = reg.id === state.selectedRegionId;
    traceMultiPolygon(ctx, reg.polygons, camera, viewW, viewH);
    ctx.fillStyle = mixHexWithBiome(owner.color, reg.biome);
    ctx.fill();

    // Subtle internal province border; brighter if player's own country or selected
    ctx.lineWidth = isSelected ? 2.5 : owner.isPlayer ? 1.3 : 1;
    ctx.strokeStyle = isSelected
      ? '#fde047'
      : owner.isPlayer
        ? 'rgba(255, 255, 255, 0.45)'
        : 'rgba(15, 23, 42, 0.42)';
    ctx.stroke();
  }

  // 2. Country labels centered on weighted average of owned regions
  const labelAcc: Record<string, { x: number; y: number; area: number }> = {};
  for (const reg of regionList) {
    const acc = (labelAcc[reg.ownerId] ??= { x: 0, y: 0, area: 0 });
    acc.x += reg.centroid[0] * reg.area;
    acc.y += reg.centroid[1] * reg.area;
    acc.area += reg.area;
  }

  for (const [cid, acc] of Object.entries(labelAcc)) {
    if (acc.area <= 0) continue;
    const country = state.countries[cid];
    if (!country) continue;
    const [sx, sy] = camera.mapToScreen(acc.x / acc.area, acc.y / acc.area, viewW, viewH);
    drawPixelTag(
      ctx,
      country.isPlayer ? `★ ${country.name}` : country.name,
      sx,
      sy,
      country.isPlayer ? '#fef08a' : '#f8fafc',
      'rgba(15, 23, 42, 0.82)',
    );
  }
}

export function drawPixelTag(
  ctx: CanvasRenderingContext2D,
  text: string,
  sx: number,
  sy: number,
  fg: string,
  bg: string,
): void {
  ctx.save();
  ctx.font = 'bold 12px "Courier New", monospace';
  const m = ctx.measureText(text);
  const w = Math.ceil(m.width) + 12;
  const h = 20;
  const rx = Math.round(sx - w * 0.5);
  const ry = Math.round(sy - h * 0.5);
  ctx.fillStyle = bg;
  ctx.fillRect(rx, ry, w, h);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.strokeRect(rx, ry, w, h);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, Math.round(sx), Math.round(sy + 1));
  ctx.restore();
}
