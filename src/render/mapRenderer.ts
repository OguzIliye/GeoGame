import {
  drawPixelArmyUnit,
  drawPixelBuilding,
  drawPixelTerrainProp,
  drawPixelTransportShip,
  type SoldierPose,
} from '../art/pixelSprites';
import { BUILDINGS } from '../config/balance';
import { getMaxTierVisualsForUnits, getTotalSoldiers } from '../sim/army';
import { isBuildingWorking } from '../sim/economy';
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
      ctx.moveTo(Math.round(sx0), Math.round(sy0));
      for (let i = 1; i < ring.length; i++) {
        const [sx, sy] = camera.mapToScreen(ring[i][0], ring[i][1], viewW, viewH);
        ctx.lineTo(Math.round(sx), Math.round(sy));
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
  ctx.fillStyle = '#0e2a47';
  ctx.fillRect(0, 0, viewW, viewH);

  // Mid-res pixel-art animated sea waves & crests
  const stepPx = 42;
  const phase = Math.floor(realTimeMs / 420) % 3;
  const offsetX = ((-camera.cx * camera.scale) % stepPx + stepPx) % stepPx;
  const offsetY = ((-camera.cy * camera.scale) % stepPx + stepPx) % stepPx;

  for (let y = offsetY - stepPx; y < viewH + stepPx; y += stepPx) {
    const row = Math.round((y - offsetY) / stepPx);
    for (let x = offsetX - stepPx; x < viewW + stepPx; x += stepPx) {
      const shift = ((row + phase) % 3) * 10;
      const wx = Math.round(x + shift);
      const wy = Math.round(y);
      ctx.fillStyle = '#163e66';
      ctx.fillRect(wx, wy, 12, 2);
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(wx + 2, wy - 2, 6, 2);
      if ((row + Math.round(x / stepPx) + phase) % 4 === 0) {
        ctx.fillStyle = '#93c5fd';
        ctx.fillRect(wx + 4, wy - 2, 2, 2);
      }
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
  let br = 114;
  let bg = 166;
  let bb = 104;
  if (biome === 'desert') {
    br = 218;
    bg = 186;
    bb = 112;
  } else if (biome === 'mountain') {
    br = 148;
    bg = 154;
    bb = 164;
  } else if (biome === 'forest') {
    br = 68;
    bg = 136;
    bb = 84;
  }
  const mr = Math.round(r * 0.66 + br * 0.34);
  const mg = Math.round(g * 0.66 + bg * 0.34);
  const mb = Math.round(b * 0.66 + bb * 0.34);
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
  ctx.lineDashOffset = -((realTimeMs * 0.045) % 14);
  ctx.beginPath();
  ctx.moveTo(Math.round(x1), Math.round(y1));
  ctx.lineTo(Math.round(x2), Math.round(y2));
  ctx.stroke();

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

  const t = (realTimeMs % 1000) / 1000;
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
    ctx.strokeRect(Math.round(x1), Math.round(y1), Math.round(x2 - x1), Math.round(y2 - y1));
    ctx.restore();
  }

  const regionList = Object.values(state.regions);

  // 1. Coastal shallow water rim + Region political/biome fills (strictly active <= 16 countries only!)
  for (const reg of regionList) {
    if (!reg.isCoastal) continue;
    traceMultiPolygon(ctx, reg.polygons, camera, viewW, viewH);
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
    ctx.stroke();
  }

  for (const reg of regionList) {
    const owner = state.countries[reg.ownerId];
    if (!owner) continue;
    const isSelected = reg.id === state.selectedRegionId;
    traceMultiPolygon(ctx, reg.polygons, camera, viewW, viewH);
    ctx.fillStyle = mixHexWithBiome(owner.color, reg.biome);
    ctx.fill();

    ctx.lineWidth = isSelected ? 2.5 : owner.isPlayer ? 1.5 : 1.1;
    ctx.strokeStyle = isSelected
      ? '#fde047'
      : owner.isPlayer
        ? 'rgba(255, 255, 255, 0.55)'
        : 'rgba(15, 23, 42, 0.5)';
    ctx.stroke();
  }

  // 2. Mid-res pixel-art environment props (tree, mountain, grass, cactus, dune)
  for (const reg of regionList) {
    for (const prop of reg.props) {
      const [px, py] = camera.mapToScreen(prop.x, prop.y, viewW, viewH);
      if (px < -24 || px > viewW + 24 || py < -24 || py > viewH + 24) continue;
      drawPixelTerrainProp(ctx, prop, px, py, camera.scale, realTimeMs);
    }
  }

  // 3. Pixel-art Buildings (Idle vs Active animations; Bank & Combined always Active!) & Capture bars
  for (const reg of regionList) {
    const [bx, by] = camera.mapToScreen(reg.centroid[0], reg.centroid[1], viewW, viewH);
    const owner = state.countries[reg.ownerId];

    if (reg.building && owner) {
      const b = reg.building;
      const working = isBuildingWorking(state, owner, reg);
      const pct = b.totalSec > 0 ? Math.min(1, b.progressSec / b.totalSec) : 1;
      drawPixelBuilding(ctx, b.type, bx, by - 2, owner.color, working, b.constructing, pct, realTimeMs);

      if (camera.scale >= 14) {
        const label =
          BUILDING_SHORT[b.type] ??
          BUILDINGS[b.type].name.slice(0, 3);
        ctx.save();
        ctx.font = 'bold 9px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fef08a';
        ctx.fillText(label, Math.round(bx), Math.round(by + 16));
        ctx.restore();
      }
    }

    if (reg.capture) {
      const pct = Math.min(1, reg.capture.elapsedSec / Math.max(0.1, reg.capture.requiredSec));
      const atkColor = state.countries[reg.capture.attackerCountryId]?.color ?? '#ef4444';
      ctx.save();
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(Math.round(bx - 20), Math.round(by + 18), 40, 6);
      ctx.fillStyle = atkColor;
      ctx.fillRect(Math.round(bx - 19), Math.round(by + 19), Math.round(38 * pct), 4);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(bx - 20), Math.round(by + 18), 40, 6);
      ctx.restore();
    }
  }

  // 4. Animated movement arrows for armies & sailing ships
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

  // 5. Pixel-art Transport Ships on sea (sailing wake animation!)
  for (const ship of Object.values(state.ships)) {
    const owner = state.countries[ship.countryId];
    if (!owner) continue;
    const [sx, sy] = camera.mapToScreen(ship.x, ship.y, viewW, viewH);
    const carried = getTotalSoldiers(ship.units);
    const isSel = ship.id === state.selectedShipId;
    const sailing = ship.targetX !== null && ship.targetY !== null;

    drawPixelTransportShip(ctx, sx, sy, owner.color, sailing, isSel, realTimeMs);
    if (carried > 0) {
      drawPixelTag(ctx, `⚓${carried}`, sx, sy - 24, '#fef08a', '#0f172a');
    }
  }

  // 6. Wounded soldiers retreating to Hospital
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

  // 7. Mid-res Pixel-art Army Stacks (Max-Tier Weapon + Max-Tier Shield, Idle/Walk/Combat animations!)
  for (const army of Object.values(state.armies)) {
    const owner = state.countries[army.countryId];
    if (!owner) continue;
    const count = getTotalSoldiers(army.units);
    if (count <= 0) continue;

    const [ax, ay] = camera.mapToScreen(army.x, army.y, viewW, viewH);
    const isSel = army.id === state.selectedArmyId;
    const { weapon, shield } = getMaxTierVisualsForUnits(army.units);

    let pose: SoldierPose = 'idle';
    let facingRight = true;
    if (army.inCombatWithArmyId && state.armies[army.inCombatWithArmyId]) {
      pose = 'combat';
      facingRight = state.armies[army.inCombatWithArmyId].x >= army.x;
    } else if (army.targetX !== null) {
      pose = 'walk';
      facingRight = army.targetX >= army.x;
    }

    if (isSel) {
      ctx.save();
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(ax - 18), Math.round(ay - 24), 36, 36);
      ctx.restore();
    }

    drawPixelArmyUnit(
      ctx,
      ax,
      ay - 4,
      weapon,
      shield,
      pose,
      facingRight,
      owner.isPlayer ? '#2563eb' : owner.color,
      realTimeMs,
    );

    drawPixelTag(
      ctx,
      `${count}`,
      ax,
      ay + 18,
      '#ffffff',
      owner.isPlayer ? '#1d4ed8' : 'rgba(15, 23, 42, 0.9)',
    );
  }

  // 8. Country name banners
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
      sy - 28,
      country.isPlayer ? '#fef08a' : '#f8fafc',
      'rgba(15, 23, 42, 0.78)',
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
  ctx.font = 'bold 11px "Courier New", monospace';
  const m = ctx.measureText(text);
  const w = Math.ceil(m.width) + 10;
  const h = 18;
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
