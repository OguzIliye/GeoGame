import {
  computeWorldSpritePixelStep,
  drawPixelArmyUnit,
  drawPixelBuilding,
  drawPixelTerrainProp,
  drawPixelTransportShip,
  renderMainMenuPixelScene,
  type SoldierPose,
} from '../art/pixelSprites';
import { BUILDINGS } from '../config/balance';
import { minDistToMultiPolygonSq } from '../map/geometry';
import { getMaxTierVisualsForUnits, getTotalSoldiers } from '../sim/army';
import {
  getBarracksTrainingProgress,
  getRegionBuildingPoint,
  isBuildingWorking,
  validateBuildingPlacementAtPoint,
} from '../sim/economy';
import type {
  BuildingType,
  GameState,
  MultiPolygonCoords,
  Point,
  Region,
  WorldCountryFeature,
} from '../types';
import { MapCamera } from './camera';

export { renderMainMenuPixelScene };

const BUILDING_SHORT: Record<BuildingType, string> = {
  barracks: 'KŞL',
  hospital: 'HST',
  bank: 'BNK',
  factory: 'FBR',
  university: 'ÜNİ',
  port: 'LMN',
};

interface CachedCountryBorders {
  sig: string;
  allOuterSegments: [Point, Point][];
  playerOuterSegments: [Point, Point][];
}

let borderCache: CachedCountryBorders | null = null;

function getCountryOuterBorders(state: GameState, regionList: Region[]): CachedCountryBorders {
  const sig = `${state.playerCountryId ?? ''}|${regionList.map((r) => `${r.id}:${r.ownerId}`).join(',')}`;
  if (borderCache && borderCache.sig === sig) return borderCache;

  const allOuterSegments: [Point, Point][] = [];
  const playerOuterSegments: [Point, Point][] = [];
  const threshSq = 0.028 * 0.028;

  for (const reg of regionList) {
    const sameNeighbors: Region[] = [];
    for (const nid of reg.neighbors) {
      const nb = state.regions[nid];
      if (nb && nb.ownerId === reg.ownerId) sameNeighbors.push(nb);
    }
    const isPlayerOwner = reg.ownerId === state.playerCountryId;

    for (const poly of reg.polygons) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          const p1 = ring[i];
          const p2 = ring[i + 1];
          const mid: Point = [(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5];

          let isInternal = false;
          for (let k = 0; k < sameNeighbors.length; k++) {
            if (minDistToMultiPolygonSq(mid, sameNeighbors[k].polygons) <= threshSq) {
              isInternal = true;
              break;
            }
          }
          if (!isInternal) {
            allOuterSegments.push([p1, p2]);
            if (isPlayerOwner) playerOuterSegments.push([p1, p2]);
          }
        }
      }
    }
  }

  borderCache = { sig, allOuterSegments, playerOuterSegments };
  return borderCache;
}

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
    ctx.lineWidth = isHovered ? 3.2 : 2.2;
    ctx.strokeStyle = isHovered ? '#fef08a' : '#090d16';
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

/** Draw an animated multi-segment pixel-style movement arrow along screen waypoints. */
export function drawAnimatedRouteArrow(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  color: string,
  realTimeMs: number,
): void {
  if (pts.length < 2) return;

  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segLens.push(len);
    totalLen += len;
  }
  if (totalLen < 6) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  ctx.lineDashOffset = -((realTimeMs * 0.04) % 14);
  ctx.beginPath();
  ctx.moveTo(Math.round(pts[0][0]), Math.round(pts[0][1]));
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(Math.round(pts[i][0]), Math.round(pts[i][1]));
  }
  ctx.stroke();

  ctx.setLineDash([]);
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const endAngle = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
  const headLen = 10;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(last[0], last[1]);
  ctx.lineTo(last[0] - headLen * Math.cos(endAngle - 0.5), last[1] - headLen * Math.sin(endAngle - 0.5));
  ctx.lineTo(last[0] - headLen * Math.cos(endAngle + 0.5), last[1] - headLen * Math.sin(endAngle + 0.5));
  ctx.closePath();
  ctx.fill();

  const targetDist = ((realTimeMs % 1200) / 1200) * totalLen;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (acc + segLens[i] >= targetDist || i === segLens.length - 1) {
      const localT = segLens[i] > 0 ? Math.min(1, (targetDist - acc) / segLens[i]) : 0;
      const mx = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * localT;
      const my = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * localT;
      const ang = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
      ctx.beginPath();
      ctx.moveTo(mx + 6 * Math.cos(ang), my + 6 * Math.sin(ang));
      ctx.lineTo(mx - 5 * Math.cos(ang - 0.6), my - 5 * Math.sin(ang - 0.6));
      ctx.lineTo(mx - 5 * Math.cos(ang + 0.6), my - 5 * Math.sin(ang + 0.6));
      ctx.closePath();
      ctx.fill();
      break;
    }
    acc += segLens[i];
  }
  ctx.restore();
}

export function drawAnimatedMovementArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  realTimeMs: number,
): void {
  drawAnimatedRouteArrow(ctx, [[x1, y1], [x2, y2]], color, realTimeMs);
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
  const spriteStep = computeWorldSpritePixelStep(camera.scale);
  const selectedArmySet = new Set(state.selectedArmyIds ?? []);
  if (state.selectedArmyId) selectedArmySet.add(state.selectedArmyId);

  const placementCheck =
    state.placingBuildingType && state.placementHoverPoint && state.playerCountryId
      ? validateBuildingPlacementAtPoint(
          state,
          state.playerCountryId,
          state.placingBuildingType,
          state.placementHoverPoint,
        )
      : null;

  // 1. Coastal shallow water rim + Region political/biome fills
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
    const isHoveredPlacement = placementCheck?.region?.id === reg.id;

    traceMultiPolygon(ctx, reg.polygons, camera, viewW, viewH);
    ctx.fillStyle = mixHexWithBiome(owner.color, reg.biome);
    ctx.fill();

    if (isHoveredPlacement && placementCheck) {
      ctx.fillStyle = placementCheck.ok ? 'rgba(34, 197, 94, 0.24)' : 'rgba(239, 68, 68, 0.26)';
      ctx.fill();
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.34)';
    ctx.stroke();
  }

  // 1.5 Thick (3.8px) Country Outer Borders + Universal Selected/Hovered Region Highlight
  const borders = getCountryOuterBorders(state, regionList);
  if (borders.allOuterSegments.length > 0) {
    ctx.save();
    ctx.lineWidth = 3.8;
    ctx.strokeStyle = '#090d16';
    ctx.beginPath();
    for (let i = 0; i < borders.allOuterSegments.length; i++) {
      const [p1, p2] = borders.allOuterSegments[i];
      const [x1, y1] = camera.mapToScreen(p1[0], p1[1], viewW, viewH);
      const [x2, y2] = camera.mapToScreen(p2[0], p2[1], viewW, viewH);
      ctx.moveTo(Math.round(x1), Math.round(y1));
      ctx.lineTo(Math.round(x2), Math.round(y2));
    }
    ctx.stroke();

    if (borders.playerOuterSegments.length > 0) {
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(254, 240, 138, 0.85)';
      ctx.beginPath();
      for (let i = 0; i < borders.playerOuterSegments.length; i++) {
        const [p1, p2] = borders.playerOuterSegments[i];
        const [x1, y1] = camera.mapToScreen(p1[0], p1[1], viewW, viewH);
        const [x2, y2] = camera.mapToScreen(p2[0], p2[1], viewW, viewH);
        ctx.moveTo(Math.round(x1), Math.round(y1));
        ctx.lineTo(Math.round(x2), Math.round(y2));
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  for (const reg of regionList) {
    const isSelected = reg.id === state.selectedRegionId || reg.id === state.activeBuildingRegionId;
    const isHoveredPlacement = placementCheck?.region?.id === reg.id;
    if (!isSelected && !isHoveredPlacement) continue;
    traceMultiPolygon(ctx, reg.polygons, camera, viewW, viewH);
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = isHoveredPlacement
      ? placementCheck?.ok
        ? '#4ade80'
        : '#f87171'
      : '#38bdf8';
    ctx.stroke();
  }

  // 2. Compact pixel-art environment props
  const cullMargin = Math.max(40, spriteStep * 20);
  for (const reg of regionList) {
    for (const prop of reg.props) {
      const [px, py] = camera.mapToScreen(prop.x, prop.y, viewW, viewH);
      if (px < -cullMargin || px > viewW + cullMargin || py < -cullMargin || py > viewH + cullMargin) {
        continue;
      }
      drawPixelTerrainProp(ctx, prop, px, py, camera.scale, realTimeMs);
    }
  }

  // 3. Pixel-art Buildings + Universal Building Highlight + On-Map Barracks Training Bar!
  for (const reg of regionList) {
    const owner = state.countries[reg.ownerId];

    if (reg.building && owner) {
      const b = reg.building;
      const [bMapX, bMapY] = getRegionBuildingPoint(reg);
      const [bx, by] = camera.mapToScreen(bMapX, bMapY, viewW, viewH);
      const working = isBuildingWorking(state, owner, reg);
      const pct = b.totalSec > 0 ? Math.min(1, b.progressSec / b.totalSec) : 1;

      if (state.activeBuildingRegionId === reg.id) {
        const frameHalf = Math.max(18, Math.round(14 * spriteStep));
        ctx.save();
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(
          Math.round(bx - frameHalf),
          Math.round(by - frameHalf - 2),
          frameHalf * 2,
          frameHalf * 2,
        );
        ctx.restore();
      }

      drawPixelBuilding(
        ctx,
        b.type,
        bx,
        by,
        owner.color,
        working,
        b.constructing,
        pct,
        realTimeMs,
        camera.scale,
      );

      // Live Barracks training bar right above the Barracks on the map!
      if (b.type === 'barracks' && !b.constructing) {
        const trainProg = getBarracksTrainingProgress(b);
        if (trainProg.active) {
          const barW = 36;
          const barH = 6;
          const barX = Math.round(bx - barW * 0.5);
          const barY = Math.round(by - 15 * spriteStep - 10);
          ctx.save();
          ctx.fillStyle = '#090d16';
          ctx.fillRect(barX, barY, barW, barH);
          ctx.fillStyle = '#4ade80';
          ctx.fillRect(barX + 1, barY + 1, Math.round((barW - 2) * trainProg.pct), barH - 2);
          ctx.strokeStyle = '#fef08a';
          ctx.lineWidth = 1;
          ctx.strokeRect(barX, barY, barW, barH);
          ctx.restore();
        }
      }

      if (camera.scale >= 16) {
        const label = BUILDING_SHORT[b.type] ?? BUILDINGS[b.type].name.slice(0, 3);
        ctx.save();
        ctx.font = 'bold 12px Consolas, "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#090d16';
        ctx.fillText(label, Math.round(bx + 1), Math.round(by + 11 * spriteStep + 11));
        ctx.fillStyle = '#fef047';
        ctx.fillText(label, Math.round(bx), Math.round(by + 11 * spriteStep + 10));
        ctx.restore();
      }
    }

    if (reg.capture) {
      const [cx, cy] = camera.mapToScreen(reg.centroid[0], reg.centroid[1], viewW, viewH);
      const pct = Math.min(1, reg.capture.elapsedSec / Math.max(0.1, reg.capture.requiredSec));
      const atkColor = state.countries[reg.capture.attackerCountryId]?.color ?? '#ef4444';
      ctx.save();
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(Math.round(cx - 22), Math.round(cy + 20), 44, 7);
      ctx.fillStyle = atkColor;
      ctx.fillRect(Math.round(cx - 21), Math.round(cy + 21), Math.round(42 * pct), 5);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(cx - 22), Math.round(cy + 20), 44, 7);
      ctx.restore();
    }
  }

  // 4. Multi-segment animated movement arrows for armies & sailing ships
  for (const army of Object.values(state.armies)) {
    if (army.targetX !== null && army.targetY !== null) {
      const routeMapPts: Point[] =
        army.waypoints && army.waypoints.length > 0
          ? [[army.x, army.y], ...army.waypoints]
          : [
              [army.x, army.y],
              [army.targetX, army.targetY],
            ];
      const screenPts = routeMapPts.map(([mx, my]) => camera.mapToScreen(mx, my, viewW, viewH));
      const isPlayer = army.countryId === state.playerCountryId;
      const arrowColor = army.mergeTargetArmyId
        ? '#38bdf8'
        : isPlayer
          ? '#fde047'
          : '#fca5a5';
      drawAnimatedRouteArrow(ctx, screenPts, arrowColor, realTimeMs);
    }
  }

  for (const ship of Object.values(state.ships)) {
    if (ship.targetX !== null && ship.targetY !== null) {
      const [x1, y1] = camera.mapToScreen(ship.x, ship.y, viewW, viewH);
      const [x2, y2] = camera.mapToScreen(ship.targetX, ship.targetY, viewW, viewH);
      drawAnimatedMovementArrow(ctx, x1, y1, x2, y2, '#38bdf8', realTimeMs);
    }
  }

  // 5. Pixel-art Transport Ships on sea
  for (const ship of Object.values(state.ships)) {
    const owner = state.countries[ship.countryId];
    if (!owner) continue;
    const [sx, sy] = camera.mapToScreen(ship.x, ship.y, viewW, viewH);
    const carried = getTotalSoldiers(ship.units);
    const isSel = ship.id === state.selectedShipId;
    const sailing = ship.targetX !== null && ship.targetY !== null;

    drawPixelTransportShip(ctx, sx, sy, owner.color, sailing, isSel, realTimeMs, camera.scale);
    if (carried > 0) {
      drawPixelTag(
        ctx,
        owner.isPlayer ? `★⚓${carried}` : `⚓${carried}`,
        sx,
        sy - 14 * spriteStep - 8,
        '#fef08a',
        '#0f172a',
        owner.isPlayer ? '#facc15' : '#334155',
      );
    }
  }

  // 6. Wounded Soldiers: Field-Waiting (`🩹 Yaralı — Hastane Bekliyor`) OR Dashed Trail + Red-Cross Running Figure!
  for (const w of state.wounded) {
    const ownerColor = state.countries[w.countryId]?.color ?? '#3b82f6';
    const wCount = getTotalSoldiers(w.units);
    const { weapon, shield } = getMaxTierVisualsForUnits(w.units);

    if (w.waitingForHospital) {
      const [sx, sy] = camera.mapToScreen(w.from[0], w.from[1], viewW, viewH);
      drawPixelArmyUnit(ctx, sx, sy, weapon, shield, 'idle', true, ownerColor, realTimeMs, camera.scale * 0.85);
      drawRedCrossBadge(ctx, sx + 10, sy - 12, spriteStep);
      drawPixelTag(
        ctx,
        `🩹 Yaralı (${wCount}) — Hastane Bekliyor`,
        sx,
        sy - 24,
        '#fecaca',
        'rgba(127, 29, 29, 0.94)',
        '#f87171',
      );
      continue;
    }

    if (w.travelProgress < 1) {
      const wx = w.from[0] + (w.to[0] - w.from[0]) * w.travelProgress;
      const wy = w.from[1] + (w.to[1] - w.from[1]) * w.travelProgress;
      const [sx, sy] = camera.mapToScreen(wx, wy, viewW, viewH);
      const [hx, hy] = camera.mapToScreen(w.to[0], w.to[1], viewW, viewH);

      // Dashed green/white rescue trail toward the Hospital
      ctx.save();
      ctx.strokeStyle = '#86efac';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -((realTimeMs * 0.05) % 10);
      ctx.beginPath();
      ctx.moveTo(Math.round(sx), Math.round(sy));
      ctx.lineTo(Math.round(hx), Math.round(hy));
      ctx.stroke();
      ctx.restore();

      drawPixelArmyUnit(
        ctx,
        sx,
        sy,
        weapon,
        shield,
        'walk',
        w.to[0] >= wx,
        ownerColor,
        realTimeMs,
        camera.scale * 0.82,
      );
      drawRedCrossBadge(ctx, sx, sy - 14 * spriteStep - 4, spriteStep);
    }
  }

  // 7. Army Stacks — AI first, Player on top Z-order
  const sortedArmies = Object.values(state.armies).sort((a, b) => {
    const ap = a.countryId === state.playerCountryId ? 1 : 0;
    const bp = b.countryId === state.playerCountryId ? 1 : 0;
    return ap - bp;
  });

  for (const army of sortedArmies) {
    const owner = state.countries[army.countryId];
    if (!owner) continue;
    const count = getTotalSoldiers(army.units);
    if (count <= 0) continue;

    const [ax, ay] = camera.mapToScreen(army.x, army.y, viewW, viewH);
    const isSel = selectedArmySet.has(army.id);
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

    if (owner.isPlayer) {
      const pulse = 1 + 0.14 * Math.sin(realTimeMs * 0.006);
      const ringW = Math.max(20, Math.round(22 * spriteStep * pulse));
      const ringH = Math.max(8, Math.round(8 * spriteStep * pulse));
      ctx.save();
      ctx.fillStyle = isSel ? 'rgba(250, 204, 21, 0.28)' : 'rgba(56, 189, 248, 0.24)';
      ctx.fillRect(Math.round(ax - ringW * 0.5), Math.round(ay + 4 * spriteStep), ringW, ringH);
      ctx.strokeStyle = isSel ? '#fde047' : '#38bdf8';
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(ax - ringW * 0.5), Math.round(ay + 4 * spriteStep), ringW, ringH);
      ctx.restore();
    }

    if (isSel) {
      const boxHalf = Math.max(16, Math.round(14 * spriteStep));
      ctx.save();
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(
        Math.round(ax - boxHalf),
        Math.round(ay - boxHalf * 1.15),
        boxHalf * 2,
        Math.round(boxHalf * 1.95),
      );
      ctx.restore();
    }

    drawPixelArmyUnit(
      ctx,
      ax,
      ay,
      weapon,
      shield,
      pose,
      facingRight,
      owner.color,
      realTimeMs,
      camera.scale,
    );

    drawPixelTag(
      ctx,
      owner.isPlayer ? `★ ${count}` : `${count}`,
      ax,
      ay + Math.max(16, Math.round(11 * spriteStep + 8)),
      owner.isPlayer ? '#fef08a' : '#ffffff',
      owner.isPlayer ? '#1e3a8a' : 'rgba(15, 23, 42, 0.92)',
      owner.isPlayer ? '#facc15' : '#475569',
    );
  }

  // 7.5 Q-Focus Ping Ring Animation
  if (state.focusPing) {
    const nowRef = state.focusPing.startedRealMs > 1e11 ? Date.now() : realTimeMs;
    const elapsed = nowRef - state.focusPing.startedRealMs;
    if (elapsed >= 0 && elapsed <= 1350) {
      const t = elapsed / 1350;
      const [px, py] = camera.mapToScreen(state.focusPing.x, state.focusPing.y, viewW, viewH);
      const rad = Math.round(20 + t * 56);
      ctx.save();
      ctx.strokeStyle = `rgba(250, 204, 21, ${(1 - t).toFixed(2)})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(Math.round(px - rad), Math.round(py - rad), rad * 2, rad * 2);
      const inner = Math.round(12 + t * 28);
      ctx.strokeStyle = `rgba(56, 189, 248, ${(1 - t * 0.85).toFixed(2)})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(px - inner), Math.round(py - inner), inner * 2, inner * 2);
      ctx.restore();
    }
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
      country.isPlayer ? '#eab308' : '#334155',
    );
  }

  // 8.5 Floating World Effects (`+X Asker`, `+1000 💰`, `+X İyileşti!`)
  if (state.floatingEffects && state.floatingEffects.length > 0) {
    const nowEpoch = Date.now();
    for (const fx of state.floatingEffects) {
      if (fx.scope !== 'world' || fx.x === undefined || fx.y === undefined) continue;
      const age = nowEpoch - fx.createdAtRealMs;
      if (age < 0 || age > fx.durationMs) continue;
      const t = age / fx.durationMs;
      const [sx, sy] = camera.mapToScreen(fx.x, fx.y, viewW, viewH);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t * 0.85);
      drawPixelTag(
        ctx,
        fx.text,
        sx,
        sy - 18 - t * 28,
        fx.color,
        'rgba(9, 13, 22, 0.92)',
        fx.color,
      );
      ctx.restore();
    }
  }

  // 9. Interactive Mouse Building Placement Ghost Preview
  if (state.placingBuildingType && state.placementHoverPoint && state.playerCountryId) {
    const [gx, gy] = camera.mapToScreen(
      state.placementHoverPoint[0],
      state.placementHoverPoint[1],
      viewW,
      viewH,
    );
    const pColor = state.countries[state.playerCountryId]?.color ?? '#3b82f6';
    const isOk = Boolean(placementCheck?.ok);
    const frameHalf = Math.max(20, Math.round(14 * spriteStep));

    ctx.save();
    ctx.globalAlpha = 0.78;
    drawPixelBuilding(
      ctx,
      state.placingBuildingType,
      gx,
      gy,
      pColor,
      true,
      false,
      1,
      realTimeMs,
      camera.scale,
    );
    ctx.globalAlpha = 1;
    ctx.strokeStyle = isOk ? '#4ade80' : '#ef4444';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(Math.round(gx - frameHalf), Math.round(gy - frameHalf), frameHalf * 2, frameHalf * 2);
    ctx.restore();

    const spec = BUILDINGS[state.placingBuildingType];
    const msg = isOk
      ? `✓ ${spec.name} Kur (${spec.cost}💰) — Sol Tık`
      : `✕ ${placementCheck?.reason ?? 'Buraya kurulamaz'}`;
    drawPixelTag(
      ctx,
      msg,
      gx,
      gy + frameHalf + 14,
      isOk ? '#bbf7d0' : '#fecaca',
      isOk ? 'rgba(20, 83, 45, 0.94)' : 'rgba(69, 10, 10, 0.94)',
      isOk ? '#4ade80' : '#ef4444',
    );
  }

  // 10. Left-Drag RTS Box-Select Rectangle
  if (state.boxSelectRect) {
    const rx = Math.round(Math.min(state.boxSelectRect.x1, state.boxSelectRect.x2));
    const ry = Math.round(Math.min(state.boxSelectRect.y1, state.boxSelectRect.y2));
    const rw = Math.round(Math.abs(state.boxSelectRect.x2 - state.boxSelectRect.x1));
    const rh = Math.round(Math.abs(state.boxSelectRect.y2 - state.boxSelectRect.y1));
    if (rw >= 2 || rh >= 2) {
      ctx.save();
      ctx.fillStyle = 'rgba(250, 204, 21, 0.14)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    }
  }
}

function drawRedCrossBadge(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  spriteStep: number,
): void {
  const r = Math.max(5, Math.round(spriteStep * 2.8));
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(Math.round(sx - r), Math.round(sy - r), r * 2, r * 2);
  ctx.strokeStyle = '#090d16';
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(sx - r), Math.round(sy - r), r * 2, r * 2);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(Math.round(sx - 1), Math.round(sy - r + 1), 2, r * 2 - 2);
  ctx.fillRect(Math.round(sx - r + 1), Math.round(sy - 1), r * 2 - 2, 2);
  ctx.restore();
}

export function drawPixelTag(
  ctx: CanvasRenderingContext2D,
  text: string,
  sx: number,
  sy: number,
  fg: string,
  bg: string,
  borderColor = '#334155',
): void {
  ctx.save();
  ctx.font = 'bold 13px Consolas, "Courier New", monospace';
  const m = ctx.measureText(text);
  const w = Math.ceil(m.width) + 14;
  const h = 22;
  const rx = Math.round(sx - w * 0.5);
  const ry = Math.round(sy - h * 0.5);
  ctx.fillStyle = bg;
  ctx.fillRect(rx, ry, w, h);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(rx, ry, w, h);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, Math.round(sx), Math.round(sy + 1));
  ctx.restore();
}
