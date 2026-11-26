import type { BuildingType, ShieldId, TerrainProp, WeaponId } from '../types';

export type SoldierPose = 'idle' | 'walk' | 'combat';

interface PixelSpan {
  gx: number;
  gy: number;
  gw: number;
  color: string;
}

class PixelGrid {
  readonly w: number;
  readonly h: number;
  readonly ox: number;
  readonly oy: number;
  readonly data: (string | null)[];

  constructor(w: number, h: number, ox: number, oy: number) {
    this.w = w;
    this.h = h;
    this.ox = ox;
    this.oy = oy;
    this.data = new Array(w * h).fill(null);
  }

  rect(gx: number, gy: number, gw: number, gh: number, color: string): void {
    const x0 = Math.max(0, gx + this.ox);
    const y0 = Math.max(0, gy + this.oy);
    const x1 = Math.min(this.w, gx + gw + this.ox);
    const y1 = Math.min(this.h, gy + gh + this.oy);
    for (let y = y0; y < y1; y++) {
      const row = y * this.w;
      for (let x = x0; x < x1; x++) {
        this.data[row + x] = color;
      }
    }
  }

  px(gx: number, gy: number, color: string): void {
    const x = gx + this.ox;
    const y = gy + this.oy;
    if (x >= 0 && x < this.w && y >= 0 && y < this.h) {
      this.data[y * this.w + x] = color;
    }
  }

  /** Apply 1px country-color silhouette outline + 1px outer dark contrast rim for readability on any terrain. */
  applyCountryOutline(ownerColor: string): void {
    const vivid = brightenHex(ownerColor, 0.28);
    const copy = this.data.slice();
    const outlined = new Uint8Array(this.w * this.h);

    const dirs4 = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const idx = y * this.w + x;
        if (copy[idx] !== null) continue;
        for (const [dx, dy] of dirs4) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < this.w && ny >= 0 && ny < this.h && copy[ny * this.w + nx] !== null) {
            this.data[idx] = vivid;
            outlined[idx] = 1;
            break;
          }
        }
      }
    }

    // Subtle 1px dark contrast rim around the country-color outline so matching territory never swallows it
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const idx = y * this.w + x;
        if (this.data[idx] !== null) continue;
        for (const [dx, dy] of dirs4) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < this.w && ny >= 0 && ny < this.h && outlined[ny * this.w + nx] === 1) {
            this.data[idx] = '#090d16';
            break;
          }
        }
      }
    }
  }

  toSpans(): PixelSpan[] {
    const spans: PixelSpan[] = [];
    for (let y = 0; y < this.h; y++) {
      const row = y * this.w;
      let x = 0;
      while (x < this.w) {
        const c = this.data[row + x];
        if (c === null) {
          x++;
          continue;
        }
        let end = x + 1;
        while (end < this.w && this.data[row + end] === c) {
          end++;
        }
        spans.push({
          gx: x - this.ox,
          gy: y - this.oy,
          gw: end - x,
          color: c,
        });
        x = end;
      }
    }
    return spans;
  }
}

export function brightenHex(hex: string, ratio: number): string {
  if (!hex.startsWith('#') || hex.length < 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const nr = Math.min(255, Math.round(r + (255 - r) * ratio));
  const ng = Math.min(255, Math.round(g + (255 - g) * ratio));
  const nb = Math.min(255, Math.round(b + (255 - b) * ratio));
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

function darkenHex(hex: string, ratio: number): string {
  if (!hex.startsWith('#') || hex.length < 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const nr = Math.max(0, Math.round(r * (1 - ratio)));
  const ng = Math.max(0, Math.round(g * (1 - ratio)));
  const nb = Math.max(0, Math.round(b * (1 - ratio)));
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

const spanCache = new Map<string, PixelSpan[]>();
const svgUriCache = new Map<string, string>();

function getCachedSpans(key: string, builder: () => PixelSpan[]): PixelSpan[] {
  const hit = spanCache.get(key);
  if (hit) return hit;
  if (spanCache.size > 800) spanCache.clear();
  const built = builder();
  spanCache.set(key, built);
  return built;
}

/** Draw cached spans with seamless integer-snapped world-space pixel scaling (zero subpixel seams, crisp zoom!). */
function drawSpansWorldScaled(
  ctx: CanvasRenderingContext2D,
  spans: PixelSpan[],
  sx: number,
  sy: number,
  pixelScale: number,
  flipX = false,
): void {
  const ox = Math.round(sx);
  const oy = Math.round(sy);
  const S = Math.max(0.55, pixelScale);

  for (let i = 0; i < spans.length; i++) {
    const sp = spans[i];
    const gx0 = flipX ? -(sp.gx + sp.gw) : sp.gx;
    const gx1 = gx0 + sp.gw;
    const x0 = Math.round(ox + gx0 * S);
    const x1 = Math.round(ox + gx1 * S);
    const y0 = Math.round(oy + sp.gy * S);
    const y1 = Math.round(oy + (sp.gy + 1) * S);
    ctx.fillStyle = sp.color;
    ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  }
}

function spansToSvgDataUri(spans: PixelSpan[], gridW: number, gridH: number, ox: number, oy: number): string {
  const rects = spans
    .map(
      (s) =>
        `<rect x="${s.gx + ox}" y="${s.gy + oy}" width="${s.gw}" height="1" fill="${s.color}"/>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${gridW} ${gridH}" shape-rendering="crispEdges">${rects}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Compute world-space pixel step (~30% more compact in v1.2) so all map objects fit compact regions cleanly while zooming crisply! */
export function computeWorldSpritePixelStep(cameraScale = 36): number {
  return Math.max(0.55, cameraScale / 26);
}

function pRect(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  S: number,
  gx: number,
  gy: number,
  gw: number,
  gh: number,
  color: string,
): void {
  const x0 = Math.round(ox + gx * S);
  const x1 = Math.round(ox + (gx + gw) * S);
  const y0 = Math.round(oy + gy * S);
  const y1 = Math.round(oy + (gy + gh) * S);
  ctx.fillStyle = color;
  ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
}

export function drawPixelTerrainProp(
  ctx: CanvasRenderingContext2D,
  prop: TerrainProp,
  sx: number,
  sy: number,
  scale: number,
  realTimeMs: number,
): void {
  const S = Math.max(0.55, scale / 31);
  const ox = Math.round(sx);
  const oy = Math.round(sy);

  if (prop.kind === 'tree') {
    const sway = Math.floor(realTimeMs / 900 + prop.variant) % 2 === 0 ? 0 : 1;
    pRect(ctx, ox, oy, S, -4, 2, 9, 2, 'rgba(15, 23, 42, 0.35)');
    pRect(ctx, ox, oy, S, -1, -2, 2, 5, '#5c3a21');
    pRect(ctx, ox, oy, S, 0, -2, 1, 4, '#7c4d2b');
    if (prop.variant === 0) {
      pRect(ctx, ox, oy, S, -5 + sway, -4, 10, 3, '#14532d');
      pRect(ctx, ox, oy, S, -4 + sway, -7, 8, 3, '#15803d');
      pRect(ctx, ox, oy, S, -2 + sway, -10, 5, 3, '#22c55e');
      pRect(ctx, ox, oy, S, -1 + sway, -11, 2, 1, '#86efac');
    } else {
      pRect(ctx, ox, oy, S, -5, -7, 10, 6, '#15803d');
      pRect(ctx, ox, oy, S, -4 + sway, -9, 8, 3, '#22c55e');
      pRect(ctx, ox, oy, S, -2 + sway, -8, 4, 2, '#4ade80');
      pRect(ctx, ox, oy, S, 1, -5, 4, 4, '#14532d');
    }
    return;
  }

  if (prop.kind === 'mountain') {
    pRect(ctx, ox, oy, S, -8, 2, 16, 2, 'rgba(15, 23, 42, 0.32)');
    pRect(ctx, ox, oy, S, -7, -1, 14, 4, '#334155');
    pRect(ctx, ox, oy, S, -6, -4, 11, 3, '#475569');
    pRect(ctx, ox, oy, S, -4, -7, 7, 3, '#64748b');
    pRect(ctx, ox, oy, S, -3, -9, 5, 2, '#94a3b8');
    pRect(ctx, ox, oy, S, -2, -11, 3, 2, '#f8fafc');
    pRect(ctx, ox, oy, S, -3, -9, 2, 2, '#e2e8f0');
    if (prop.variant > 0) {
      pRect(ctx, ox, oy, S, 2, -6, 6, 6, '#1e293b');
      pRect(ctx, ox, oy, S, 3, -7, 4, 2, '#cbd5e1');
    }
    return;
  }

  if (prop.kind === 'cactus') {
    pRect(ctx, ox, oy, S, -2, 2, 6, 1, 'rgba(15, 23, 42, 0.28)');
    pRect(ctx, ox, oy, S, -1, -7, 3, 9, '#15803d');
    pRect(ctx, ox, oy, S, 0, -7, 1, 9, '#22c55e');
    pRect(ctx, ox, oy, S, -4, -4, 3, 1, '#16a34a');
    pRect(ctx, ox, oy, S, -4, -6, 1, 3, '#22c55e');
    pRect(ctx, ox, oy, S, 2, -3, 3, 1, '#16a34a');
    pRect(ctx, ox, oy, S, 4, -6, 1, 4, '#22c55e');
    return;
  }

  if (prop.kind === 'dune') {
    pRect(ctx, ox, oy, S, -7, 0, 14, 2, '#b45309');
    pRect(ctx, ox, oy, S, -5, -2, 10, 2, '#f59e0b');
    pRect(ctx, ox, oy, S, -3, -3, 6, 1, '#fde68a');
    return;
  }

  pRect(ctx, ox, oy, S, -2, -2, 1, 3, '#15803d');
  pRect(ctx, ox, oy, S, 0, -4, 1, 5, '#22c55e');
  pRect(ctx, ox, oy, S, 2, -2, 1, 3, '#16a34a');
  if (prop.variant === 2) {
    pRect(ctx, ox, oy, S, 0, -5, 1, 1, '#fde047');
  }
}

function buildBuildingSpans(
  type: BuildingType,
  ownerColor: string,
  active: boolean,
  constructing: boolean,
  frame: number,
): PixelSpan[] {
  const g = new PixelGrid(34, 34, 17, 20);
  const darkOwner = darkenHex(ownerColor, 0.3);
  const lightOwner = brightenHex(ownerColor, 0.22);

  if (constructing) {
    // Detailed wooden scaffolding & stone foundation under construction
    g.rect(-10, 4, 20, 3, '#475569');
    g.rect(-9, -4, 18, 8, '#64748b');
    g.rect(-11, -5, 22, 1, '#92400e');
    g.rect(-11, 0, 22, 1, '#92400e');
    g.rect(-10, -8, 2, 12, '#b45309');
    g.rect(8, -8, 2, 12, '#b45309');
    g.rect(-2, -7, 4, 11, '#78350f');
    g.applyCountryOutline(ownerColor);
    return g.toSpans();
  }

  if (type === 'bank') {
    // Stepped marble foundation
    g.rect(-11, 5, 22, 2, '#64748b');
    g.rect(-10, 3, 20, 2, '#94a3b8');
    // Classical recessed inner wall + 4 fluted columns
    g.rect(-9, -5, 18, 8, '#475569');
    g.rect(-2, -2, 4, 5, '#1e293b'); // Vault door
    g.rect(-1, -1, 2, 3, '#eab308'); // Golden vault lock
    for (const cx of [-8, -4, 2, 6]) {
      g.rect(cx, -5, 2, 8, '#f1f5f9');
      g.rect(cx + 1, -5, 1, 8, '#cbd5e1');
    }
    // Architrave + Country banner trim + Golden Pediment
    g.rect(-10, -7, 20, 2, ownerColor);
    g.rect(-11, -9, 22, 2, '#ca8a04');
    g.rect(-8, -11, 16, 2, '#eab308');
    g.rect(-4, -13, 8, 2, '#facc15');
    g.applyCountryOutline(ownerColor);

    // Floating spinning coin above roof (always active!)
    const bob = frame % 2 === 0 ? 0 : -1;
    const coinW = frame === 1 || frame === 3 ? 2 : 4;
    g.rect(-Math.floor(coinW / 2), -18 + bob, coinW, 4, '#facc15');
    g.px(0, -17 + bob, '#ffffff');
    return g.toSpans();
  }

  if (type === 'barracks') {
    // Fortress stone base + twin side towers + battlements
    g.rect(-11, 4, 22, 3, '#334155');
    g.rect(-10, -4, 20, 8, '#64748b');
    g.rect(-11, -7, 5, 11, '#475569'); // Left tower
    g.rect(6, -7, 5, 11, '#475569'); // Right tower
    // Merlons (crenellations)
    for (const mx of [-11, -8, -4, -1, 2, 6, 9]) {
      g.rect(mx, -9, 2, 2, '#94a3b8');
    }
    // Country shield crest on facade
    g.rect(-2, -6, 4, 3, ownerColor);
    g.rect(-1, -5, 2, 1, '#fef08a');
    // Iron portcullis gate (glows warm forge-orange when training!)
    g.rect(-3, -1, 6, 6, active && frame % 2 === 0 ? '#f97316' : '#0f172a');
    g.rect(-2, -1, 1, 6, '#475569');
    g.rect(1, -1, 1, 6, '#475569');
    // Flagpole + waving country flag
    g.rect(0, -15, 1, 6, '#e2e8f0');
    const wave = active ? (frame % 2 === 0 ? 0 : 1) : 0;
    g.rect(1, -15 + wave, 6, 4, ownerColor);
    g.rect(1, -15 + wave, 3, 2, lightOwner);
    g.applyCountryOutline(ownerColor);
    return g.toSpans();
  }

  if (type === 'hospital') {
    // Multi-story white medical center + country-trimmed roof
    g.rect(-11, 5, 22, 2, '#64748b');
    g.rect(-10, -6, 20, 11, '#f8fafc');
    g.rect(-10, 2, 20, 3, '#e2e8f0');
    g.rect(-11, -8, 22, 2, ownerColor);
    g.rect(-8, -10, 16, 2, '#f1f5f9');
    // Side clinic windows
    const winCol = active ? '#fde047' : '#93c5fd';
    g.rect(-8, -4, 3, 3, winCol);
    g.rect(5, -4, 3, 3, winCol);
    g.rect(-8, 1, 3, 3, winCol);
    g.rect(5, 1, 3, 3, winCol);
    // Double entrance
    g.rect(-2, 1, 4, 4, '#38bdf8');
    // Prominent Red Cross emblem
    const crossCol = active && frame % 2 === 0 ? '#ff2a2a' : '#dc2626';
    g.rect(-1, -6, 2, 6, crossCol);
    g.rect(-3, -4, 6, 2, crossCol);
    g.applyCountryOutline(ownerColor);
    if (active) {
      const lift = frame % 3;
      g.rect(-1, -14 - lift, 2, 3, '#4ade80');
      g.rect(-2, -13 - lift, 4, 1, '#4ade80');
    }
    return g.toSpans();
  }

  if (type === 'factory') {
    // Brick industrial hall + twin tall banded smokestacks
    g.rect(-11, 5, 22, 2, '#334155');
    g.rect(-10, -3, 20, 8, '#9a3412');
    g.rect(-10, -1, 20, 1, '#7c2d12');
    // Sawtooth roof with country trim
    g.rect(-11, -5, 22, 2, ownerColor);
    g.rect(-9, -7, 6, 2, '#475569');
    g.rect(-1, -7, 6, 2, '#475569');
    // Twin smokestacks
    g.rect(-7, -12, 3, 7, '#334155');
    g.rect(-7, -12, 3, 1, '#94a3b8');
    g.rect(4, -12, 3, 7, '#334155');
    g.rect(4, -12, 3, 1, '#94a3b8');
    // Furnace bay + industrial windows
    g.rect(-4, 0, 8, 5, active ? (frame % 2 === 0 ? '#fb923c' : '#fde047') : '#1e293b');
    g.rect(-8, -2, 2, 3, active ? '#fde047' : '#475569');
    g.rect(6, -2, 2, 3, active ? '#fde047' : '#475569');
    g.applyCountryOutline(ownerColor);
    if (active) {
      g.rect(-7 + (frame % 2), -16 - (frame % 3), 4, 2, '#cbd5e1');
      g.rect(4 + ((frame + 1) % 2), -17 - ((frame + 1) % 3), 4, 2, '#f1f5f9');
    }
    return g.toSpans();
  }

  if (type === 'university') {
    // Stone wings + grand observatory dome + golden rib
    g.rect(-11, 5, 22, 2, '#64748b');
    g.rect(-10, -2, 20, 7, '#e2e8f0');
    g.rect(-11, -3, 22, 1, ownerColor);
    // Grand dome
    g.rect(-7, -7, 14, 4, darkOwner);
    g.rect(-6, -9, 12, 3, ownerColor);
    g.rect(-4, -11, 8, 2, lightOwner);
    g.rect(-1, -13, 2, 8, '#facc15'); // Golden meridian rib & spire
    // Arched windows & portal
    const lit = active ? '#fde047' : '#334155';
    g.rect(-8, 0, 3, 4, lit);
    g.rect(5, 0, 3, 4, lit);
    g.rect(-2, 0, 4, 5, '#1e3a8a');
    g.applyCountryOutline(ownerColor);
    if (active) {
      const oxOff = [-7, 0, 7, 0][frame];
      const oyOff = [-13, -16, -13, -11][frame];
      g.rect(oxOff, oyOff, 2, 2, '#38bdf8');
    }
    return g.toSpans();
  }

  // 'port' — Timber pier pilings + wooden deck + lighthouse + crane
  g.rect(-11, 3, 22, 3, '#78350f');
  g.rect(-11, 3, 22, 1, '#b45309');
  for (const px of [-9, -4, 1, 6, 9]) {
    g.rect(px, 6, 2, 2, '#451a03');
  }
  // Lighthouse tower on left
  g.rect(-8, -9, 5, 12, '#f8fafc');
  g.rect(-8, -6, 5, 3, ownerColor);
  g.rect(-8, -2, 5, 2, '#ef4444');
  g.rect(-9, -11, 7, 2, '#334155');
  g.rect(-7, -13, 3, 2, active && frame % 2 === 0 ? '#fde047' : '#bae6fd');
  // Harbor crane & cargo crate on right
  g.rect(3, -8, 2, 11, '#b45309');
  g.rect(3, -8, 7, 2, '#d97706');
  g.rect(8, -6, 1, 4, '#94a3b8');
  g.rect(6, -2, 4, 4, ownerColor);
  g.applyCountryOutline(ownerColor);
  return g.toSpans();
}

export function drawPixelBuilding(
  ctx: CanvasRenderingContext2D,
  type: BuildingType,
  sx: number,
  sy: number,
  ownerColor: string,
  isWorking: boolean,
  constructing: boolean,
  progressPct: number,
  realTimeMs: number,
  cameraScale = 36,
): void {
  const S = computeWorldSpritePixelStep(cameraScale);
  const ox = Math.round(sx);
  const oy = Math.round(sy);
  const active = constructing ? false : type === 'bank' ? true : isWorking;
  const frame = Math.floor(realTimeMs / 260) % 4;

  // Ground shadow
  pRect(ctx, ox, oy, S, -11, 6, 22, 2, 'rgba(0, 0, 0, 0.42)');

  const key = `bld_${type}_${ownerColor}_${active ? 1 : 0}_${constructing ? 1 : 0}_${frame}`;
  const spans = getCachedSpans(key, () =>
    buildBuildingSpans(type, ownerColor, active, constructing, frame),
  );
  drawSpansWorldScaled(ctx, spans, ox, oy, S, false);

  if (constructing) {
    pRect(ctx, ox, oy, S, -10, 9, 20, 3, '#0f172a');
    pRect(ctx, ox, oy, S, -9, 10, Math.max(1, Math.round(18 * progressPct)), 1, '#38bdf8');
  }
}

function buildSoldierSpans(
  weapon: WeaponId,
  shield: ShieldId,
  pose: SoldierPose,
  ownerColor: string,
  frame: number,
): PixelSpan[] {
  const g = new PixelGrid(38, 34, 16, 20);
  const darkUniform = darkenHex(ownerColor, 0.28);
  const lightUniform = brightenHex(ownerColor, 0.25);

  const bob =
    pose === 'idle'
      ? frame % 2 === 0
        ? 0
        : -1
      : pose === 'walk'
        ? frame % 2 === 0
          ? -1
          : 0
        : 0;
  const lunge = pose === 'combat' && (frame === 1 || frame === 2) ? 2 : 0;

  // Forcefield rear energyemitter halo
  if (shield === 'forcefield') {
    const rimCol = frame % 2 === 0 ? '#06b6d4' : '#22d3ee';
    g.rect(-10, -13, 20, 1, '#67e8f9');
    g.rect(-11, -12, 1, 18, rimCol);
    g.rect(10, -12, 1, 18, rimCol);
    g.rect(-10, 6, 20, 1, '#0891b2');
  }

  // Boots & Greaves (4-frame walk cycle)
  const legLX = pose === 'walk' ? [-4, -2, 1, -2][frame] : -4 + lunge;
  const legRX = pose === 'walk' ? [1, -1, -3, -1][frame] : 1 + lunge;
  g.rect(legLX, 2, 3, 4, '#334155');
  g.rect(legLX, 5, 4, 2, '#0f172a'); // Left boot
  g.rect(legRX, 2, 3, 4, '#475569');
  g.rect(legRX, 5, 4, 2, '#1e293b'); // Right boot

  // Torso armor / country tunic + belt + shoulder pauldron
  g.rect(-4 + lunge, -5 + bob, 8, 7, ownerColor);
  g.rect(-4 + lunge, -5 + bob, 3, 6, darkUniform); // Shading
  g.rect(-1 + lunge, -4 + bob, 4, 4, lightUniform); // Chestplate highlight
  g.rect(-4 + lunge, 1 + bob, 8, 1, '#78350f'); // Leather belt
  g.px(0 + lunge, 1 + bob, '#facc15'); // Belt buckle

  // Head + Face + Detailed Helmet with Crest
  g.rect(-3 + lunge, -10 + bob, 6, 5, '#fed7aa');
  g.rect(-3 + lunge, -10 + bob, 2, 5, '#fdba74');
  g.px(1 + lunge, -8 + bob, '#0f172a'); // Eye
  // Helmet
  g.rect(-4 + lunge, -12 + bob, 8, 3, '#475569');
  g.rect(-3 + lunge, -13 + bob, 6, 1, '#94a3b8');
  g.rect(-2 + lunge, -14 + bob, 4, 1, ownerColor); // Country helmet plume/crest!

  // Off-hand Shield (left side — unmistakable per shield tier!)
  if (shield === 'none') {
    // Armored gauntlet/bracer only
    g.rect(-6 + lunge, -2 + bob, 2, 3, '#fed7aa');
    g.rect(-6 + lunge, -4 + bob, 2, 2, '#64748b');
  } else if (shield === 'wood') {
    // Round oak buckler + iron boss
    g.rect(-8 + lunge, -5 + bob, 5, 7, '#78350f');
    g.rect(-7 + lunge, -4 + bob, 3, 5, '#b45309');
    g.rect(-6 + lunge, -2 + bob, 1, 1, '#cbd5e1');
  } else if (shield === 'bronze') {
    // Bronze heater shield + golden chevron
    g.rect(-8 + lunge, -6 + bob, 5, 8, '#b45309');
    g.rect(-7 + lunge, -5 + bob, 3, 6, '#f59e0b');
    g.rect(-7 + lunge, -3 + bob, 3, 2, '#fef08a');
  } else if (shield === 'steel') {
    // Tall knightly tower steel shield + specular shine
    g.rect(-9 + lunge, -7 + bob, 6, 10, '#475569');
    g.rect(-8 + lunge, -6 + bob, 4, 8, '#cbd5e1');
    g.rect(-7 + lunge, -5 + bob, 1, 6, '#ffffff');
  } else if (shield === 'diamond') {
    // Faceted crystalline cyan-diamond shield
    g.rect(-8 + lunge, -7 + bob, 5, 9, '#0284c7');
    g.rect(-9 + lunge, -5 + bob, 7, 5, '#38bdf8');
    g.rect(-7 + lunge, -4 + bob, 3, 3, '#e0f2fe');
    g.px(-6 + lunge, -3 + bob, '#ffffff');
  } else if (shield === 'forcefield') {
    // Bright curved energy barrier arc in front
    g.rect(-8 + lunge, -6 + bob, 3, 9, '#22d3ee');
    g.rect(-7 + lunge, -5 + bob, 2, 7, '#a5f3fc');
  }

  // Main-hand Weapon (right side — unmistakable per weapon tier!)
  const wx = 4 + lunge;
  const wy = -3 + bob;

  if (weapon === 'sword') {
    if (pose === 'combat' && frame % 2 === 1) {
      g.rect(wx, wy, 9, 2, '#e2e8f0');
      g.rect(wx + 1, wy, 7, 1, '#ffffff');
      g.rect(wx + 7, wy - 4, 2, 8, '#ffffff');
    } else {
      g.rect(wx, wy + 1, 2, 2, '#78350f'); // Grip
      g.rect(wx - 1, wy, 4, 1, '#eab308'); // Golden crossguard
      g.rect(wx, wy - 8, 2, 8, '#cbd5e1'); // Steel blade
      g.rect(wx, wy - 8, 1, 7, '#ffffff'); // Blade edge shine
    }
  } else if (weapon === 'spear') {
    const thrust = pose === 'combat' && frame % 2 === 1 ? 4 : 0;
    g.rect(wx - 3 + thrust, wy, 12, 1, '#92400e'); // Long wooden shaft
    g.rect(wx + 7 + thrust, wy - 1, 2, 3, '#ef4444'); // Red tassel
    g.rect(wx + 9 + thrust, wy - 1, 4, 3, '#cbd5e1'); // Broad spearhead
    g.rect(wx + 10 + thrust, wy, 3, 1, '#ffffff');
  } else if (weapon === 'pistol') {
    g.rect(wx, wy + 1, 2, 3, '#1e293b'); // Grip
    g.rect(wx, wy - 1, 6, 2, '#475569'); // Slide/barrel
    g.rect(wx + 1, wy - 1, 4, 1, '#94a3b8');
    if (pose === 'combat' && frame % 2 === 1) {
      g.rect(wx + 6, wy - 2, 3, 4, '#fde047');
      g.rect(wx + 11, wy - 1, 3, 1, '#ffffff');
    }
  } else if (weapon === 'ak') {
    g.rect(wx - 4, wy, 3, 2, '#92400e'); // Wooden stock
    g.rect(wx - 1, wy - 1, 7, 2, '#1e293b'); // Receiver
    g.rect(wx + 2, wy + 1, 2, 3, '#d97706'); // Iconic curved magazine
    g.rect(wx + 6, wy - 1, 4, 1, '#475569'); // Barrel + front sight
    g.px(wx + 8, wy - 2, '#475569');
    if (pose === 'combat' && frame !== 0) {
      g.rect(wx + 10, wy - 2, 4, 3, frame % 2 === 0 ? '#f97316' : '#fde047');
      g.rect(wx + 15, wy - 1, 3, 1, '#fef08a');
    }
  } else if (weapon === 'bazooka') {
    // Heavy olive-drab shoulder rocket launcher + rear bell + warhead
    g.rect(-6 + lunge, wy - 4, 2, 4, '#1e293b'); // Flared exhaust bell
    g.rect(-4 + lunge, wy - 3, 13, 3, '#3f6212'); // Tube
    g.rect(-3 + lunge, wy - 3, 11, 1, '#65a30d'); // Tube highlight
    g.rect(2 + lunge, wy - 5, 2, 2, '#38bdf8'); // Optical sight
    g.rect(9 + lunge, wy - 4, 2, 5, '#1e293b'); // Muzzle collar
    g.rect(11 + lunge, wy - 3, 2, 3, '#ef4444'); // Loaded warhead nose

    if (pose === 'combat') {
      g.rect(-9 + lunge, wy - 4, 3, 4, '#f97316'); // Backblast!
      const rx = 12 + frame * 2;
      g.rect(rx - 2, wy - 3, 2, 2, '#fde047');
      g.rect(rx, wy - 3, 4, 2, '#f8fafc');
      g.rect(rx + 4, wy - 3, 2, 2, '#ef4444');
    }
  }

  g.applyCountryOutline(ownerColor);
  return g.toSpans();
}

export function drawPixelArmyUnit(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  weapon: WeaponId,
  shield: ShieldId,
  pose: SoldierPose,
  facingRight: boolean,
  ownerColor: string,
  realTimeMs: number,
  cameraScale = 36,
): void {
  const S = computeWorldSpritePixelStep(cameraScale);
  const ox = Math.round(sx);
  const oy = Math.round(sy);
  const frame = Math.floor(realTimeMs / (pose === 'combat' ? 140 : 210)) % 4;

  pRect(ctx, ox, oy, S, -7, 6, 14, 2, 'rgba(0, 0, 0, 0.45)');

  const key = `sol_${weapon}_${shield}_${pose}_${ownerColor}_${frame}`;
  const spans = getCachedSpans(key, () =>
    buildSoldierSpans(weapon, shield, pose, ownerColor, frame),
  );
  drawSpansWorldScaled(ctx, spans, ox, oy, S, !facingRight);
}

export function drawPixelTransportShip(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ownerColor: string,
  sailing: boolean,
  isSelected: boolean,
  realTimeMs: number,
  cameraScale = 36,
): void {
  const S = computeWorldSpritePixelStep(cameraScale);
  const frame = Math.floor(realTimeMs / 240) % 3;
  const bob = sailing ? (frame === 1 ? -1 : 0) : 0;
  const ox = Math.round(sx);
  const oy = Math.round(sy + bob * S);

  if (isSelected) {
    pRect(ctx, ox, oy, S, -12, -13, 24, 20, 'rgba(253, 224, 71, 0.28)');
  }

  const key = `ship_${ownerColor}_${sailing ? frame : 0}`;
  const spans = getCachedSpans(key, () => {
    const g = new PixelGrid(30, 26, 15, 16);
    g.rect(-10, 0, 20, 3, '#92400e');
    g.rect(-8, 3, 16, 3, '#451a03');
    g.rect(-9, 1, 18, 1, '#d97706');
    g.rect(0, -11, 1, 11, '#e2e8f0');
    const bulge = sailing && frame === 2 ? 1 : 0;
    g.rect(-5, -10, 10 + bulge, 8, ownerColor);
    g.rect(-4, -9, 7 + bulge, 5, brightenHex(ownerColor, 0.25));
    g.applyCountryOutline(ownerColor);
    return g.toSpans();
  });

  drawSpansWorldScaled(ctx, spans, ox, oy, S, false);

  if (sailing) {
    pRect(ctx, ox, oy, S, -12 - frame, 6, 5, 1, '#e0f2fe');
    pRect(ctx, ox, oy, S, 8 + frame, 6, 4, 1, '#bae6fd');
  }
}

/** Generate crisp SVG data-URI icon for any BuildingType (Shop, Building Popups, Quick Build, Live Strip)! */
export function getBuildingSpriteDataUri(type: BuildingType, ownerColor = '#3b82f6'): string {
  const cacheKey = `bicon_${type}_${ownerColor}`;
  const hit = svgUriCache.get(cacheKey);
  if (hit) return hit;

  const spans = buildBuildingSpans(type, ownerColor, true, false, 0);
  const uri = spansToSvgDataUri(spans, 34, 32, 17, 22);
  svgUriCache.set(cacheKey, uri);
  return uri;
}

/** Generate crisp SVG pixel-art banner/flag icon in a country's color (Diplomacy, Save/Continue, Standings)! */
export function getCountryFlagDataUri(ownerColor = '#3b82f6'): string {
  const cacheKey = `ficon_${ownerColor}`;
  const hit = svgUriCache.get(cacheKey);
  if (hit) return hit;

  const g = new PixelGrid(22, 22, 11, 11);
  const light = brightenHex(ownerColor, 0.28);
  const dark = darkenHex(ownerColor, 0.28);
  // Flagpole + golden finial
  g.rect(-7, -8, 2, 17, '#cbd5e1');
  g.rect(-8, -9, 4, 2, '#facc15');
  // Waving banner cloth
  g.rect(-5, -7, 8, 9, ownerColor);
  g.rect(-5, -7, 8, 2, light);
  g.rect(3, -6, 5, 9, dark);
  g.rect(3, -6, 5, 2, ownerColor);
  g.applyCountryOutline(ownerColor);

  const uri = spansToSvgDataUri(g.toSpans(), 22, 22, 11, 11);
  svgUriCache.set(cacheKey, uri);
  return uri;
}

/** Generate crisp SVG data-URI icon for a specific (Weapon + Shield) unit card! */
export function getUnitSpriteDataUri(
  weapon: WeaponId,
  shield: ShieldId,
  ownerColor = '#3b82f6',
): string {
  const cacheKey = `uicon_${weapon}_${shield}_${ownerColor}`;
  const hit = svgUriCache.get(cacheKey);
  if (hit) return hit;

  const spans = buildSoldierSpans(weapon, shield, 'idle', ownerColor, 0);
  const uri = spansToSvgDataUri(spans, 38, 34, 16, 20);
  svgUriCache.set(cacheKey, uri);
  return uri;
}

/** Generate crisp SVG data-URI icon for Visual Science Tree nodes (root, weapons, shields)! */
export function getTechItemSpriteDataUri(
  branch: 'root' | 'weapon' | 'shield',
  itemId: string,
): string {
  const cacheKey = `ticon_${branch}_${itemId}`;
  const hit = svgUriCache.get(cacheKey);
  if (hit) return hit;

  const g = new PixelGrid(24, 24, 12, 12);

  if (branch === 'root') {
    // Classical science scroll + glowing crystal flask
    g.rect(-6, -8, 12, 16, '#fef3c7');
    g.rect(-7, -9, 14, 2, '#d97706');
    g.rect(-7, 7, 14, 2, '#d97706');
    g.rect(-2, -5, 4, 3, '#94a3b8');
    g.rect(-4, -2, 8, 7, '#38bdf8');
    g.rect(-3, 0, 6, 4, '#22d3ee');
    g.px(-1, -1, '#ffffff');
    g.applyCountryOutline('#eab308');
  } else if (branch === 'weapon') {
    if (itemId === 'sword') {
      g.rect(-1, -9, 3, 11, '#cbd5e1');
      g.rect(-1, -9, 1, 10, '#ffffff');
      g.rect(-5, 2, 11, 2, '#eab308');
      g.rect(-1, 4, 3, 4, '#78350f');
      g.rect(-2, 8, 5, 2, '#facc15');
    } else if (itemId === 'spear') {
      g.rect(-1, -4, 2, 14, '#92400e');
      g.rect(-3, -5, 6, 2, '#ef4444');
      g.rect(-2, -10, 4, 5, '#e2e8f0');
      g.rect(-1, -10, 2, 4, '#ffffff');
    } else if (itemId === 'pistol') {
      g.rect(-6, -4, 12, 4, '#64748b');
      g.rect(-5, -4, 10, 2, '#cbd5e1');
      g.rect(-6, 0, 4, 6, '#1e293b');
      g.rect(-2, 0, 3, 2, '#eab308');
    } else if (itemId === 'ak') {
      g.rect(-10, -1, 5, 3, '#92400e');
      g.rect(-5, -3, 10, 4, '#334155');
      g.rect(-1, 1, 3, 6, '#d97706');
      g.rect(5, -2, 6, 2, '#64748b');
      g.rect(9, -4, 1, 2, '#64748b');
    } else {
      // bazooka
      g.rect(-10, -3, 3, 6, '#1e293b');
      g.rect(-7, -2, 14, 4, '#4d7c0f');
      g.rect(-6, -2, 12, 1, '#84cc16');
      g.rect(-1, -5, 3, 3, '#38bdf8');
      g.rect(7, -3, 4, 6, '#ef4444');
    }
    g.applyCountryOutline('#f97316');
  } else {
    if (itemId === 'wood') {
      g.rect(-7, -7, 14, 14, '#78350f');
      g.rect(-5, -5, 10, 10, '#b45309');
      g.rect(-2, -2, 4, 4, '#cbd5e1');
    } else if (itemId === 'bronze') {
      g.rect(-7, -8, 14, 15, '#92400e');
      g.rect(-5, -6, 10, 11, '#f59e0b');
      g.rect(-4, -2, 8, 3, '#fef08a');
    } else if (itemId === 'steel') {
      g.rect(-7, -8, 14, 16, '#475569');
      g.rect(-5, -6, 10, 12, '#cbd5e1');
      g.rect(-3, -5, 2, 10, '#ffffff');
    } else if (itemId === 'diamond') {
      g.rect(-6, -8, 12, 16, '#0284c7');
      g.rect(-8, -5, 16, 10, '#38bdf8');
      g.rect(-4, -4, 8, 8, '#e0f2fe');
      g.rect(-2, -2, 4, 4, '#ffffff');
    } else {
      // forcefield
      g.rect(-8, -8, 16, 16, '#0891b2');
      g.rect(-6, -6, 12, 12, '#22d3ee');
      g.rect(-3, -3, 6, 6, '#cffafe');
      g.rect(-1, -1, 2, 2, '#ffffff');
    }
    g.applyCountryOutline('#38bdf8');
  }

  const uri = spansToSvgDataUri(g.toSpans(), 24, 24, 12, 12);
  svgUriCache.set(cacheKey, uri);
  return uri;
}

const FONT_5X5: Record<string, string[]> = {
  P: ['11110', '10001', '11110', '10000', '10000'],
  I: ['11111', '00100', '00100', '00100', '11111'],
  X: ['10001', '01010', '00100', '01010', '10001'],
  E: ['11111', '10000', '11110', '10000', '11111'],
  L: ['10000', '10000', '10000', '10000', '11111'],
  W: ['10001', '10001', '10101', '11011', '10001'],
  O: ['01110', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '11110', '10100', '10011'],
  D: ['11110', '10001', '10001', '10001', '11110'],
  ' ': ['00000', '00000', '00000', '00000', '00000'],
};

export function drawPixelBlockText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  pixelSize: number,
  topColor = '#facc15',
  bottomColor = '#f97316',
  shadowColor = '#090d16',
): void {
  const upper = text.toUpperCase();
  const charW = 6;
  const totalCols = upper.length * charW - 1;
  const startX = Math.round(cx - (totalCols * pixelSize) / 2);
  const startY = Math.round(cy - (5 * pixelSize) / 2);

  for (let i = 0; i < upper.length; i++) {
    const glyph = FONT_5X5[upper[i]] ?? FONT_5X5[' '];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if (glyph[r][c] !== '1') continue;
        const px = startX + (i * charW + c) * pixelSize;
        const py = startY + r * pixelSize;
        ctx.fillStyle = shadowColor;
        ctx.fillRect(px + pixelSize, py + pixelSize, pixelSize, pixelSize);
      }
    }
  }

  for (let i = 0; i < upper.length; i++) {
    const glyph = FONT_5X5[upper[i]] ?? FONT_5X5[' '];
    for (let r = 0; r < 5; r++) {
      const col = r < 2 ? '#fef08a' : r < 4 ? topColor : bottomColor;
      for (let c = 0; c < 5; c++) {
        if (glyph[r][c] !== '1') continue;
        const px = startX + (i * charW + c) * pixelSize;
        const py = startY + r * pixelSize;
        ctx.fillStyle = col;
        ctx.fillRect(px, py, pixelSize, pixelSize);
      }
    }
  }
}

/** Render the animated 'PIXEL WORLD' Main Menu scene: Pixel Title + Bank + Bazooka Soldier! */
export function renderMainMenuPixelScene(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  realTimeMs: number,
): void {
  ctx.imageSmoothingEnabled = false;

  // Deep retro twilight sky + animated sea horizon
  ctx.fillStyle = '#071120';
  ctx.fillRect(0, 0, viewW, viewH);

  // Twinkling pixel stars
  for (let i = 0; i < 36; i++) {
    const sx = ((i * 197 + 53) % Math.max(200, viewW));
    const sy = ((i * 113 + 29) % Math.max(120, Math.floor(viewH * 0.55)));
    const blink = (Math.floor(realTimeMs / 500) + i) % 4 === 0;
    ctx.fillStyle = blink ? '#fef08a' : '#64748b';
    ctx.fillRect(sx, sy, blink ? 3 : 2, blink ? 3 : 2);
  }

  const horizonY = Math.round(viewH * 0.62);
  ctx.fillStyle = '#0e2a47';
  ctx.fillRect(0, horizonY, viewW, viewH - horizonY);

  const cx = Math.round(viewW * 0.5);
  const stageY = Math.round(viewH * 0.54);

  // Pixel-art grass island diorama platform in center
  const platW = Math.min(440, Math.round(viewW * 0.72));
  ctx.fillStyle = '#0b1929';
  ctx.fillRect(Math.round(cx - platW * 0.5 - 8), stageY + 26, platW + 16, 22);
  ctx.fillStyle = '#78350f';
  ctx.fillRect(Math.round(cx - platW * 0.5), stageY + 14, platW, 24);
  ctx.fillStyle = '#15803d';
  ctx.fillRect(Math.round(cx - platW * 0.5 - 4), stageY + 4, platW + 8, 12);
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(Math.round(cx - platW * 0.5 - 4), stageY + 4, platW + 8, 4);

  // Decorative background trees on the diorama
  drawPixelTerrainProp(ctx, { kind: 'tree', x: 0, y: 0, variant: 0 }, cx - 150, stageY + 4, 126, realTimeMs);
  drawPixelTerrainProp(ctx, { kind: 'mountain', x: 0, y: 0, variant: 1 }, cx + 150, stageY + 4, 118, realTimeMs);

  // 1. Pixel-Art Title Logo at Top: "PIXEL WORLD"
  const logoPixelSize = Math.max(5, Math.min(10, Math.floor(viewW / 120)));
  const titleY = Math.max(76, Math.round(viewH * 0.2));
  drawPixelBlockText(ctx, 'PIXEL WORLD', cx, titleY, logoPixelSize);

  // 2. Animated Detailed Bank Building (Left of center)
  drawPixelBuilding(ctx, 'bank', cx - 68, stageY - 12, '#3b82f6', true, false, 1, realTimeMs, 132);

  // 3. Detailed Bazooka-Holding Soldier with Country Outline (Right of center)
  const demoCombat = Math.floor(realTimeMs / 2400) % 3 === 2;
  drawPixelArmyUnit(
    ctx,
    cx + 62,
    stageY - 10,
    'bazooka',
    'steel',
    demoCombat ? 'combat' : 'idle',
    true,
    '#3b82f6',
    realTimeMs,
    138,
  );
}
