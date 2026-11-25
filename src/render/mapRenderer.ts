import { BUILDINGS } from '../config/balance';
import { getTotalSoldiers } from '../sim/army';
import type { BuildingType, GameState, MultiPolygonCoords, Region, WorldCountryFeature } from '../types';
import { MapCamera } from './camera';

const BUILDING_SHORT: Record<BuildingType, string> = {
  barracks: 'KŞL',
  hospital: 'HST',
  bank: 'BNK',
  factory: 'FBR',
  university: 'ÜNİ',
  port: 'LMN',
  combined: 'MRK',
};

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

/** Draw an animated pixel-style movement arrow between two screen points. */
export function drawAnimatedMovementArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  realTimeMs: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 6) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  ctx.lineDashOffset = -((realTimeMs * 0.04) % 14);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Solid arrowhead at destination + pulsing chevron marching along the line
  ctx.setLineDash([]);
  const angle = Math.atan2(dy, dx);
  const headLen = 10;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - 0.5), y2 - headLen * Math.sin(angle - 0.5));
  ctx.lineTo(x2 - headLen * Math.cos(angle + 0.5), y2 - headLen * Math.sin(angle + 0.5));
  ctx.closePath();
  ctx.fill();

  const t = (realTimeMs % 1100) / 1100;
  const mx = x1 + dx * t;
  const my = y1 + dy * t;
  ctx.beginPath();
  ctx.moveTo(mx + 6 * Math.cos(angle), my + 6 * Math.sin(angle));
  ctx.lineTo(mx - 5 * Math.cos(angle - 0.6), my - 5 * Math.sin(angle - 0.6));
  ctx.lineTo(mx - 5 * Math.cos(angle + 0.6), my - 5 * Math.sin(angle + 0.6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
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

  // 1. Fill only active regions (inactive ~180 world countries are never rendered)
  for (const reg of regionList) {
    const owner = state.countries[reg.ownerId];
    if (!owner) continue;
    const isSelected = reg.id === state.selectedRegionId;
    traceMultiPolygon(ctx, reg.polygons, camera, viewW, viewH);
    ctx.fillStyle = mixHexWithBiome(owner.color, reg.biome);
    ctx.fill();

    ctx.lineWidth = isSelected ? 2.5 : owner.isPlayer ? 1.3 : 1;
    ctx.strokeStyle = isSelected
      ? '#fde047'
      : owner.isPlayer
        ? 'rgba(255, 255, 255, 0.45)'
        : 'rgba(15, 23, 42, 0.42)';
    ctx.stroke();
  }

  // 2. Render buildings & capture progress bars on regions
  for (const reg of regionList) {
    const [bx, by] = camera.mapToScreen(reg.centroid[0], reg.centroid[1], viewW, viewH);

    if (reg.building) {
      const b = reg.building;
      ctx.save();
      ctx.fillStyle = b.constructing ? 'rgba(30, 41, 59, 0.85)' : 'rgba(15, 23, 42, 0.92)';
      ctx.fillRect(Math.round(bx - 15), Math.round(by - 9), 30, 14);
      ctx.strokeStyle = b.constructing ? '#94a3b8' : '#facc15';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(bx - 15), Math.round(by - 9), 30, 14);
      ctx.fillStyle = b.constructing ? '#cbd5e1' : '#fde047';
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = BUILDING_SHORT[b.type] ?? BUILDINGS[b.type].name.slice(0, 3);
      ctx.fillText(label, Math.round(bx), Math.round(by - 2));

      if (b.constructing && b.totalSec > 0) {
        const pct = Math.min(1, b.progressSec / b.totalSec);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(Math.round(bx - 15), Math.round(by + 7), 30, 4);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(Math.round(bx - 15), Math.round(by + 7), Math.round(30 * pct), 4);
      }
      ctx.restore();
    }

    if (reg.capture) {
      const pct = Math.min(1, reg.capture.elapsedSec / Math.max(0.1, reg.capture.requiredSec));
      const atkColor = state.countries[reg.capture.attackerCountryId]?.color ?? '#ef4444';
      ctx.save();
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(Math.round(bx - 20), Math.round(by + 12), 40, 6);
      ctx.fillStyle = atkColor;
      ctx.fillRect(Math.round(bx - 19), Math.round(by + 13), Math.round(38 * pct), 4);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(bx - 20), Math.round(by + 12), 40, 6);
      ctx.restore();
    }
  }

  // 3. Animated movement arrows for armies & sailing ships
  for (const army of Object.values(state.armies)) {
    if (army.targetX !== null && army.targetY !== null) {
      const [x1, y1] = camera.mapToScreen(army.x, army.y, viewW, viewH);
      const [x2, y2] = camera.mapToScreen(army.targetX, army.targetY, viewW, viewH);
      const isPlayer = army.countryId === state.playerCountryId;
      drawAnimatedMovementArrow(
        ctx,
        x1,
        y1,
        x2,
        y2,
        isPlayer ? '#fde047' : '#fca5a5',
        realTimeMs,
      );
    }
  }

  for (const ship of Object.values(state.ships)) {
    if (ship.targetX !== null && ship.targetY !== null) {
      const [x1, y1] = camera.mapToScreen(ship.x, ship.y, viewW, viewH);
      const [x2, y2] = camera.mapToScreen(ship.targetX, ship.targetY, viewW, viewH);
      drawAnimatedMovementArrow(ctx, x1, y1, x2, y2, '#38bdf8', realTimeMs);
    }
  }

  // 4. Render Transport Ships on sea
  for (const ship of Object.values(state.ships)) {
    const owner = state.countries[ship.countryId];
    if (!owner) continue;
    const [sx, sy] = camera.mapToScreen(ship.x, ship.y, viewW, viewH);
    const carried = getTotalSoldiers(ship.units);
    const isSel = ship.id === state.selectedShipId;

    ctx.save();
    // Pixel boat hull
    ctx.fillStyle = isSel ? '#fde047' : '#92400e';
    ctx.fillRect(Math.round(sx - 10), Math.round(sy - 2), 20, 6);
    // Sail
    ctx.fillStyle = owner.color;
    ctx.fillRect(Math.round(sx - 5), Math.round(sy - 11), 10, 9);
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(sx - 5), Math.round(sy - 11), 10, 9);
    if (carried > 0) {
      drawPixelTag(ctx, `⚓${carried}`, sx, sy - 20, '#fef08a', '#0f172a');
    }
    ctx.restore();
  }

  // 5. Render Wounded soldiers retreating to Hospital & healing progress
  for (const w of state.wounded) {
    const wx = w.from[0] + (w.to[0] - w.from[0]) * w.travelProgress;
    const wy = w.from[1] + (w.to[1] - w.from[1]) * w.travelProgress;
    const [sx, sy] = camera.mapToScreen(wx, wy, viewW, viewH);
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(sx - 5), Math.round(sy - 5), 10, 10);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(Math.round(sx - 1), Math.round(sy - 4), 2, 8);
    ctx.fillRect(Math.round(sx - 4), Math.round(sy - 1), 8, 2);
    ctx.restore();
  }

  // 6. Render Army Stacks & Combat flashes
  for (const army of Object.values(state.armies)) {
    const owner = state.countries[army.countryId];
    if (!owner) continue;
    const count = getTotalSoldiers(army.units);
    if (count <= 0) continue;
    const [ax, ay] = camera.mapToScreen(army.x, army.y, viewW, viewH);
    const isSel = army.id === state.selectedArmyId;

    if (isSel) {
      ctx.save();
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(ax - 22), Math.round(ay - 28), 44, 24);
      ctx.restore();
    }

    if (army.inCombatWithArmyId) {
      const pulse = Math.floor(realTimeMs / 180) % 2 === 0;
      ctx.save();
      ctx.strokeStyle = pulse ? '#ef4444' : '#facc15';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ax, ay - 14, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    drawPixelTag(
      ctx,
      `${army.inCombatWithArmyId ? '💥' : '⚔'}${count}`,
      ax,
      ay - 16,
      '#ffffff',
      owner.isPlayer ? '#1d4ed8' : owner.color,
    );
  }

  // 7. Country labels
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
      sy + 20,
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
