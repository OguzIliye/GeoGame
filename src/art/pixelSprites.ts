import type { BuildingType, ShieldId, TerrainProp, WeaponId } from '../types';

/** Draw a crisp integer-aligned pixel rectangle relative to sprite origin (ox, oy) at pixel size S. */
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
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(ox + gx * S), Math.round(oy + gy * S), gw * S, gh * S);
}

export function drawPixelTerrainProp(
  ctx: CanvasRenderingContext2D,
  prop: TerrainProp,
  sx: number,
  sy: number,
  scale: number,
  realTimeMs: number,
): void {
  // Keep pixel size crisp (1 or 2 screen pixels per art pixel depending on zoom)
  const S = scale >= 24 ? 2 : 1;
  const ox = Math.round(sx);
  const oy = Math.round(sy);

  if (prop.kind === 'tree') {
    const sway = Math.floor(realTimeMs / 900 + prop.variant) % 2 === 0 ? 0 : 1;
    // Shadow + trunk
    pRect(ctx, ox, oy, S, -3, 2, 7, 2, 'rgba(15, 23, 42, 0.35)');
    pRect(ctx, ox, oy, S, -1, -2, 2, 5, '#5c3a21');
    if (prop.variant === 0) {
      // Pine tree
      pRect(ctx, ox, oy, S, -4 + sway, -4, 8, 3, '#166534');
      pRect(ctx, ox, oy, S, -3 + sway, -7, 6, 3, '#15803d');
      pRect(ctx, ox, oy, S, -1 + sway, -9, 3, 2, '#22c55e');
    } else {
      // Oak / leafy tree
      pRect(ctx, ox, oy, S, -4, -6, 8, 5, '#15803d');
      pRect(ctx, ox, oy, S, -3 + sway, -8, 6, 3, '#22c55e');
      pRect(ctx, ox, oy, S, 1, -5, 3, 3, '#166534');
    }
    return;
  }

  if (prop.kind === 'mountain') {
    pRect(ctx, ox, oy, S, -7, 1, 14, 2, 'rgba(15, 23, 42, 0.32)');
    // Main peak
    pRect(ctx, ox, oy, S, -6, -1, 12, 3, '#475569');
    pRect(ctx, ox, oy, S, -5, -4, 9, 3, '#64748b');
    pRect(ctx, ox, oy, S, -3, -7, 5, 3, '#94a3b8');
    // Snow cap
    pRect(ctx, ox, oy, S, -2, -9, 3, 2, '#f8fafc');
    pRect(ctx, ox, oy, S, -1, -7, 2, 1, '#e2e8f0');
    if (prop.variant > 0) {
      // Secondary side crag
      pRect(ctx, ox, oy, S, 2, -5, 5, 5, '#334155');
      pRect(ctx, ox, oy, S, 3, -6, 3, 2, '#cbd5e1');
    }
    return;
  }

  if (prop.kind === 'cactus') {
    pRect(ctx, ox, oy, S, -2, 2, 5, 1, 'rgba(15, 23, 42, 0.28)');
    pRect(ctx, ox, oy, S, -1, -6, 2, 8, '#15803d');
    pRect(ctx, ox, oy, S, -3, -4, 2, 1, '#16a34a');
    pRect(ctx, ox, oy, S, -3, -6, 1, 3, '#22c55e');
    pRect(ctx, ox, oy, S, 1, -3, 2, 1, '#16a34a');
    pRect(ctx, ox, oy, S, 2, -5, 1, 3, '#22c55e');
    return;
  }

  if (prop.kind === 'dune') {
    pRect(ctx, ox, oy, S, -6, 0, 12, 2, '#d97706');
    pRect(ctx, ox, oy, S, -4, -2, 8, 2, '#f59e0b');
    pRect(ctx, ox, oy, S, -2, -3, 4, 1, '#fde68a');
    return;
  }

  // 'grass'
  pRect(ctx, ox, oy, S, -2, -2, 1, 3, '#15803d');
  pRect(ctx, ox, oy, S, 0, -3, 1, 4, '#22c55e');
  pRect(ctx, ox, oy, S, 2, -2, 1, 3, '#16a34a');
  if (prop.variant === 2) {
    pRect(ctx, ox, oy, S, 0, -4, 1, 1, '#fde047');
  }
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
): void {
  const S = 2;
  const ox = Math.round(sx);
  const oy = Math.round(sy);
  // DESIGN.md rule: full-time buildings (Bank, Combined) ONLY have Active animation!
  const active =
    constructing ? false : type === 'bank' || type === 'combined' ? true : isWorking;
  const frame = Math.floor(realTimeMs / 260) % 4;

  // Base shadow
  pRect(ctx, ox, oy, S, -8, 5, 16, 2, 'rgba(0,0,0,0.45)');

  if (constructing) {
    // Wooden scaffolding animation
    pRect(ctx, ox, oy, S, -7, -3, 14, 8, '#475569');
    pRect(ctx, ox, oy, S, -8, -4, 16, 1, '#92400e');
    pRect(ctx, ox, oy, S, -8, 0, 16, 1, '#92400e');
    pRect(ctx, ox, oy, S, -7, -5, 1, 10, '#b45309');
    pRect(ctx, ox, oy, S, 6, -5, 1, 10, '#b45309');
    // Construction progress bar
    pRect(ctx, ox, oy, S, -8, 7, 16, 3, '#0f172a');
    pRect(ctx, ox, oy, S, -7, 8, Math.max(1, Math.round(14 * progressPct)), 1, '#38bdf8');
    return;
  }

  if (type === 'bank') {
    // Marble bank + golden roof + always-active floating coin animation
    pRect(ctx, ox, oy, S, -7, 3, 14, 2, '#94a3b8');
    pRect(ctx, ox, oy, S, -6, -3, 12, 6, '#e2e8f0');
    pRect(ctx, ox, oy, S, -5, -3, 2, 6, '#cbd5e1');
    pRect(ctx, ox, oy, S, -1, -3, 2, 6, '#cbd5e1');
    pRect(ctx, ox, oy, S, 3, -3, 2, 6, '#cbd5e1');
    pRect(ctx, ox, oy, S, -8, -5, 16, 2, '#eab308');
    pRect(ctx, ox, oy, S, -5, -7, 10, 2, '#facc15');
    // Always-active bobbing gold coin above roof
    const bob = frame % 2 === 0 ? 0 : -1;
    pRect(ctx, ox, oy, S, -2, -12 + bob, 4, 4, '#facc15');
    pRect(ctx, ox, oy, S, -1, -11 + bob, 2, 2, frame === 1 ? '#ffffff' : '#ca8a04');
    return;
  }

  if (type === 'barracks') {
    // Stone fortress with battlements
    pRect(ctx, ox, oy, S, -7, -3, 14, 8, '#64748b');
    pRect(ctx, ox, oy, S, -7, -5, 3, 2, '#94a3b8');
    pRect(ctx, ox, oy, S, -2, -5, 4, 2, '#94a3b8');
    pRect(ctx, ox, oy, S, 4, -5, 3, 2, '#94a3b8');
    pRect(ctx, ox, oy, S, -2, 0, 4, 5, active && frame % 2 === 0 ? '#f97316' : '#1e293b');
    // Flagpole + banner (waves when Active)
    pRect(ctx, ox, oy, S, 0, -10, 1, 5, '#cbd5e1');
    const wave = active ? (frame % 2 === 0 ? 0 : 1) : 0;
    pRect(ctx, ox, oy, S, 1, -10 + wave, 5, 3, ownerColor);
    if (active) {
      pRect(ctx, ox, oy, S, -5, -8 + (frame % 2), 2, 2, '#fde047');
    }
    return;
  }

  if (type === 'hospital') {
    // White clinic + red cross
    pRect(ctx, ox, oy, S, -7, -4, 14, 9, '#f8fafc');
    pRect(ctx, ox, oy, S, -8, -6, 16, 2, '#cbd5e1');
    const crossColor = active && frame % 2 === 0 ? '#ff2a2a' : '#dc2626';
    pRect(ctx, ox, oy, S, -1, -3, 2, 6, crossColor);
    pRect(ctx, ox, oy, S, -3, -1, 6, 2, crossColor);
    if (active) {
      // Pulsing beacon + warm windows
      pRect(ctx, ox, oy, S, -6, 1, 2, 2, '#fde047');
      pRect(ctx, ox, oy, S, 4, 1, 2, 2, '#fde047');
      pRect(ctx, ox, oy, S, -1, -9 - (frame % 2), 2, 2, '#4ade80');
    }
    return;
  }

  if (type === 'factory') {
    // Brick workshop + smokestacks
    pRect(ctx, ox, oy, S, -7, -2, 14, 7, '#9a3412');
    pRect(ctx, ox, oy, S, -5, -7, 3, 5, '#475569');
    pRect(ctx, ox, oy, S, 2, -7, 3, 5, '#475569');
    pRect(ctx, ox, oy, S, -4, 1, 8, 3, active ? (frame % 2 === 0 ? '#fb923c' : '#facc15') : '#334155');
    if (active) {
      // Rising pixel smoke puffs
      pRect(ctx, ox, oy, S, -5 + (frame % 2), -10 - (frame % 3), 3, 2, '#cbd5e1');
      pRect(ctx, ox, oy, S, 2 + ((frame + 1) % 2), -11 - ((frame + 1) % 3), 3, 2, '#e2e8f0');
    }
    return;
  }

  if (type === 'university') {
    // Blue domed science observatory
    pRect(ctx, ox, oy, S, -7, -1, 14, 6, '#e2e8f0');
    pRect(ctx, ox, oy, S, -5, -5, 10, 4, '#2563eb');
    pRect(ctx, ox, oy, S, -3, -7, 6, 2, '#3b82f6');
    pRect(ctx, ox, oy, S, -1, -9, 2, 2, '#93c5fd');
    pRect(ctx, ox, oy, S, -5, 1, 2, 2, active ? '#fde047' : '#475569');
    pRect(ctx, ox, oy, S, 3, 1, 2, 2, active ? '#fde047' : '#475569');
    if (active) {
      // Orbiting science spark
      const oxOff = [-5, 0, 5, 0][frame];
      const oyOff = [-10, -12, -10, -8][frame];
      pRect(ctx, ox, oy, S, oxOff, oyOff, 2, 2, '#38bdf8');
    }
    return;
  }

  if (type === 'port') {
    // Wooden pier + harbour crane / lighthouse
    pRect(ctx, ox, oy, S, -8, 2, 16, 3, '#78350f');
    pRect(ctx, ox, oy, S, -5, -6, 4, 8, '#f8fafc');
    pRect(ctx, ox, oy, S, -5, -4, 4, 2, '#ef4444');
    pRect(ctx, ox, oy, S, 2, -5, 2, 7, '#b45309');
    pRect(ctx, ox, oy, S, 2, -5, 5, 2, '#d97706');
    if (active) {
      pRect(ctx, ox, oy, S, -5, -8, 4, 2, frame % 2 === 0 ? '#fde047' : '#f59e0b');
    } else {
      pRect(ctx, ox, oy, S, -4, -7, 2, 1, '#94a3b8');
    }
    return;
  }

  // 'combined' — Small-country Grand Citadel (always active!)
  pRect(ctx, ox, oy, S, -8, -2, 16, 7, '#475569');
  pRect(ctx, ox, oy, S, -6, -6, 12, 4, ownerColor);
  pRect(ctx, ox, oy, S, -3, -9, 6, 3, '#eab308');
  pRect(ctx, ox, oy, S, -5, 0, 3, 3, frame % 2 === 0 ? '#fde047' : '#fb923c');
  pRect(ctx, ox, oy, S, 2, 0, 3, 3, frame % 2 === 0 ? '#38bdf8' : '#fde047');
  pRect(ctx, ox, oy, S, -1, -12 - (frame % 2), 2, 2, '#fef08a');
}

export type SoldierPose = 'idle' | 'walk' | 'combat';

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
): void {
  const S = 2;
  const frame = Math.floor(realTimeMs / (pose === 'combat' ? 140 : 210)) % 4;
  const dir = facingRight ? 1 : -1;

  ctx.save();
  ctx.translate(Math.round(sx), Math.round(sy));
  ctx.scale(dir, 1);

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

  // Ground shadow
  pRect(ctx, 0, 0, S, -5, 5, 10, 2, 'rgba(0,0,0,0.45)');

  // Force field outer halo (behind + around soldier)
  if (shield === 'forcefield') {
    const glow = frame % 2 === 0 ? 'rgba(56, 189, 248, 0.45)' : 'rgba(34, 211, 238, 0.65)';
    pRect(ctx, 0, 0, S, -8, -10, 16, 16, glow);
    pRect(ctx, 0, 0, S, -9, -8, 1, 12, '#22d3ee');
    pRect(ctx, 0, 0, S, 8, -8, 1, 12, '#22d3ee');
    pRect(ctx, 0, 0, S, -7, -11, 14, 1, '#67e8f9');
  }

  // Legs (4-frame walk stride!)
  const legLeftX = pose === 'walk' ? [-3, -1, 1, -1][frame] : -3 + lunge;
  const legRightX = pose === 'walk' ? [1, -1, -3, -1][frame] : 1 + lunge;
  pRect(ctx, 0, 0, S, legLeftX, 2, 2, 4, '#1e293b');
  pRect(ctx, 0, 0, S, legRightX, 2, 2, 4, '#334155');

  // Torso (country uniform) & Head + Helmet
  pRect(ctx, 0, 0, S, -3 + lunge, -4 + bob, 6, 6, ownerColor);
  pRect(ctx, 0, 0, S, -2 + lunge, -8 + bob, 4, 4, '#fed7aa');
  pRect(ctx, 0, 0, S, -3 + lunge, -9 + bob, 6, 2, '#475569');
  pRect(ctx, 0, 0, S, 1 + lunge, -7 + bob, 1, 1, '#0f172a'); // Eye

  // Off-hand Shield (Wood, Bronze, Steel, Diamond)
  if (shield !== 'none' && shield !== 'forcefield') {
    const shColor =
      shield === 'wood'
        ? '#92400e'
        : shield === 'bronze'
          ? '#d97706'
          : shield === 'steel'
            ? '#cbd5e1'
            : '#38bdf8'; // diamond
    const shTrim =
      shield === 'wood'
        ? '#78350f'
        : shield === 'bronze'
          ? '#fef08a'
          : shield === 'steel'
            ? '#64748b'
            : '#e0f2fe';
    pRect(ctx, 0, 0, S, -6 + lunge, -4 + bob, 4, 6, shTrim);
    pRect(ctx, 0, 0, S, -5 + lunge, -3 + bob, 2, 4, shColor);
  }

  // Main-hand Weapon + Combat Animation (Max-tier rule!)
  const wx = 3 + lunge;
  const wy = -3 + bob;

  if (weapon === 'sword') {
    if (pose === 'combat' && frame % 2 === 1) {
      // Horizontal slash + white arc
      pRect(ctx, 0, 0, S, wx, wy, 7, 2, '#e2e8f0');
      pRect(ctx, 0, 0, S, wx + 5, wy - 3, 2, 6, '#ffffff');
    } else {
      pRect(ctx, 0, 0, S, wx, wy - 5, 2, 6, '#cbd5e1');
      pRect(ctx, 0, 0, S, wx - 1, wy, 4, 1, '#eab308');
    }
  } else if (weapon === 'spear') {
    const thrust = pose === 'combat' && frame % 2 === 1 ? 4 : 0;
    pRect(ctx, 0, 0, S, wx - 2 + thrust, wy, 9, 1, '#92400e');
    pRect(ctx, 0, 0, S, wx + 7 + thrust, wy - 1, 3, 3, '#e2e8f0');
  } else if (weapon === 'pistol') {
    pRect(ctx, 0, 0, S, wx, wy, 4, 2, '#334155');
    pRect(ctx, 0, 0, S, wx, wy + 1, 2, 2, '#1e293b');
    if (pose === 'combat' && frame % 2 === 1) {
      pRect(ctx, 0, 0, S, wx + 4, wy - 1, 3, 3, '#fde047');
      pRect(ctx, 0, 0, S, wx + 9, wy, 2, 1, '#ffffff');
    }
  } else if (weapon === 'ak') {
    pRect(ctx, 0, 0, S, wx - 2, wy, 8, 2, '#1e293b');
    pRect(ctx, 0, 0, S, wx - 3, wy + 1, 2, 2, '#92400e'); // Wooden stock
    pRect(ctx, 0, 0, S, wx + 2, wy + 2, 2, 2, '#475569'); // Curved mag
    if (pose === 'combat' && frame !== 0) {
      pRect(ctx, 0, 0, S, wx + 6, wy - 1, 4, 3, frame % 2 === 0 ? '#f97316' : '#fde047');
      pRect(ctx, 0, 0, S, wx + 11 + frame * 2, wy, 2, 1, '#fef08a');
    }
  } else if (weapon === 'bazooka') {
    // Shoulder-mounted rocket launcher
    pRect(ctx, 0, 0, S, -4 + lunge, wy - 3, 11, 3, '#3f6212');
    pRect(ctx, 0, 0, S, 6 + lunge, wy - 4, 2, 5, '#1e293b');
    if (pose === 'combat') {
      // Fired missile / rocket animation with exhaust flame & explosion!
      const rx = 8 + frame * 4;
      pRect(ctx, 0, 0, S, rx - 3, wy - 2, 3, 2, '#f97316'); // Flame exhaust
      pRect(ctx, 0, 0, S, rx, wy - 2, 4, 2, '#e2e8f0'); // Rocket body
      pRect(ctx, 0, 0, S, rx + 4, wy - 2, 2, 2, '#ef4444'); // Warhead tip
      if (frame === 3) {
        pRect(ctx, 0, 0, S, rx + 3, wy - 5, 6, 6, '#f97316');
        pRect(ctx, 0, 0, S, rx + 4, wy - 4, 4, 4, '#fef08a');
      }
    }
  }

  ctx.restore();
}

export function drawPixelTransportShip(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ownerColor: string,
  sailing: boolean,
  isSelected: boolean,
  realTimeMs: number,
): void {
  const S = 2;
  const frame = Math.floor(realTimeMs / 240) % 3;
  const bob = sailing ? (frame === 1 ? -1 : 0) : 0;
  const ox = Math.round(sx);
  const oy = Math.round(sy + bob);

  if (isSelected) {
    pRect(ctx, ox, oy, S, -10, -11, 20, 16, 'rgba(253, 224, 71, 0.28)');
  }

  // Hull
  pRect(ctx, ox, oy, S, -8, 0, 16, 3, '#78350f');
  pRect(ctx, ox, oy, S, -6, 3, 12, 2, '#451a03');
  // Mast & billowing sail
  pRect(ctx, ox, oy, S, 0, -9, 1, 9, '#d6d3d1');
  const sailBulge = sailing && frame === 2 ? 1 : 0;
  pRect(ctx, ox, oy, S, -4, -8, 8 + sailBulge, 6, ownerColor);
  pRect(ctx, ox, oy, S, -3, -7, 6 + sailBulge, 4, 'rgba(255,255,255,0.22)');

  // Animated sea wake when sailing
  if (sailing) {
    pRect(ctx, ox, oy, S, -10 - frame, 4, 4, 1, '#e0f2fe');
    pRect(ctx, ox, oy, S, 7 + frame, 4, 3, 1, '#bae6fd');
  }
}
