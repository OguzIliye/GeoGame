import { Delaunay } from 'd3-delaunay';
import polygonClipping from 'polygon-clipping';
import { ARENA_CONFIG, COUNTRY_PALETTE } from '../config/balance';
import type {
  AIPersonality,
  ArenaBounds,
  BiomeType,
  Country,
  MultiPolygonCoords,
  Point,
  PolygonCoords,
  Region,
  TerrainProp,
  WorldCountryFeature,
} from '../types';
import {
  bboxesOverlap,
  computeBBox,
  findInteriorPoint,
  minDistToMultiPolygonSq,
  multiPolygonArea,
  pointInMultiPolygon,
  pointInPolygon,
  polygonArea,
  unprojectToLat,
} from './geometry';

export function createRng(seedStr: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick core mainland bbox so overseas islands (e.g. Greenland/French Guiana) don't stretch the local theater. */
export function computeCountryFocusBBox(
  country: WorldCountryFeature,
  clickPt?: Point | null,
): [number, number, number, number] {
  let anchorPoly = country.polygons[0];
  if (clickPt) {
    let bestDist = Infinity;
    for (const poly of country.polygons) {
      const d = minDistToMultiPolygonSq(clickPt, [poly]);
      if (d < bestDist) {
        bestDist = d;
        anchorPoly = poly;
      }
    }
  } else {
    let maxA = -1;
    for (const poly of country.polygons) {
      const a = polygonArea(poly);
      if (a > maxA) {
        maxA = a;
        anchorPoly = poly;
      }
    }
  }

  const anchorBox = computeBBox([anchorPoly]);
  const nearPolys: MultiPolygonCoords = [anchorPoly];
  for (const poly of country.polygons) {
    if (poly === anchorPoly) continue;
    const pb = computeBBox([poly]);
    if (bboxesOverlap(anchorBox, pb, 14)) {
      nearPolys.push(poly);
    }
  }
  return computeBBox(nearPolys);
}

export function computeArenaBounds(
  selected: WorldCountryFeature,
  clickPt?: Point | null,
): ArenaBounds {
  const [cMinX, cMinY, cMaxX, cMaxY] = computeCountryFocusBBox(selected, clickPt);
  let cx = (cMinX + cMaxX) * 0.5;
  let cy = (cMinY + cMaxY) * 0.5;

  // If country itself is huge (e.g. Russia/USA/China), center around clickPt or interior centroid
  const spanW = cMaxX - cMinX;
  const spanH = cMaxY - cMinY;
  if (spanW > ARENA_CONFIG.MAX_BOX_HALF_W * 1.6 || spanH > ARENA_CONFIG.MAX_BOX_HALF_H * 1.6) {
    const focus = clickPt ?? selected.centroid;
    cx = focus[0];
    cy = focus[1];
  }

  let halfW = Math.max(ARENA_CONFIG.MIN_BOX_HALF_W, Math.min(ARENA_CONFIG.MAX_BOX_HALF_W, spanW * 1.15 + 7));
  let halfH = Math.max(ARENA_CONFIG.MIN_BOX_HALF_H, Math.min(ARENA_CONFIG.MAX_BOX_HALF_H, spanH * 1.15 + 5));

  // Keep clean ~1.55 widescreen aspect
  const targetAspect = 1.55;
  if (halfW / halfH < targetAspect) {
    halfW = Math.min(ARENA_CONFIG.MAX_BOX_HALF_W, halfH * targetAspect);
  } else {
    halfH = Math.min(ARENA_CONFIG.MAX_BOX_HALF_H, halfW / targetAspect);
  }

  return {
    minX: cx - halfW,
    minY: cy - halfH,
    maxX: cx + halfW,
    maxY: cy + halfH,
  };
}

function makeRectPolygon(b: ArenaBounds): MultiPolygonCoords {
  return [
    [
      [
        [b.minX, b.minY],
        [b.maxX, b.minY],
        [b.maxX, b.maxY],
        [b.minX, b.maxY],
        [b.minX, b.minY],
      ],
    ],
  ];
}

function sanitizeClippedMultiPolygon(
  raw: polygonClipping.MultiPolygon,
  minPolyArea = 0.0004,
): MultiPolygonCoords {
  const out: MultiPolygonCoords = [];
  for (const poly of raw) {
    const rings: PolygonCoords = [];
    for (const r of poly) {
      if (r.length < 4) continue;
      const cleanRing: Point[] = r.map((pt) => [pt[0], pt[1]]);
      rings.push(cleanRing);
    }
    if (rings.length > 0 && polygonArea(rings) >= minPolyArea) {
      out.push(rings);
    }
  }
  return out;
}

export function clipMultiPolygonToBox(
  mp: MultiPolygonCoords,
  box: ArenaBounds,
  minPolyArea = 0.0004,
): MultiPolygonCoords {
  try {
    const clipped = polygonClipping.intersection(
      mp as unknown as polygonClipping.Geom,
      makeRectPolygon(box) as unknown as polygonClipping.Geom,
    );
    return sanitizeClippedMultiPolygon(clipped, minPolyArea);
  } catch {
    // Fallback: filter polygons whose centroids lie inside box
    return mp.filter((poly) => {
      const [x, y] = findInteriorPoint([poly]);
      return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
    });
  }
}

function approxMultiPolygonDistanceSq(a: MultiPolygonCoords, b: MultiPolygonCoords): number {
  let best = Infinity;
  for (const poly of a) {
    const ring = poly[0];
    const step = Math.max(1, Math.floor(ring.length / 24));
    for (let i = 0; i < ring.length; i += step) {
      const d = minDistToMultiPolygonSq(ring[i], b);
      if (d < best) {
        best = d;
        if (best < 1e-4) return 0;
      }
    }
  }
  for (const poly of b) {
    const ring = poly[0];
    const step = Math.max(1, Math.floor(ring.length / 24));
    for (let i = 0; i < ring.length; i += step) {
      const d = minDistToMultiPolygonSq(ring[i], a);
      if (d < best) {
        best = d;
        if (best < 1e-4) return 0;
      }
    }
  }
  return best;
}

/** Subdivide a country's clipped MultiPolygon into approximately equal-area organic sub-polygons. */
export function subdivideCountryIntoRegions(
  countryId: string,
  mp: MultiPolygonCoords,
  rng: () => number,
): MultiPolygonCoords[] {
  const totalArea = multiPolygonArea(mp);
  const desiredCount = Math.min(
    ARENA_CONFIG.MAX_REGIONS_PER_COUNTRY,
    Math.max(1, Math.round(totalArea / ARENA_CONFIG.TARGET_REGION_AREA)),
  );

  // Small countries (like Vatican, Luxembourg, Cyprus) stay as a single polygon region
  if (desiredCount <= 1 || totalArea < ARENA_CONFIG.TARGET_REGION_AREA * 1.3) {
    return [mp];
  }

  const [bMinX, bMinY, bMaxX, bMaxY] = computeBBox(mp);
  const seeds = generateInteriorSeeds(mp, desiredCount, rng);
  if (seeds.length <= 1) return [mp];

  const vorBounds: [number, number, number, number] = [
    bMinX - 1,
    bMinY - 1,
    bMaxX + 1,
    bMaxY + 1,
  ];

  const polyBBoxes = mp.map((p) => computeBBox([p]));
  let finalCells: MultiPolygonCoords[] = [];

  for (let iter = 0; iter < ARENA_CONFIG.LLOYD_ITERATIONS; iter++) {
    const delaunay = Delaunay.from(seeds);
    const voronoi = delaunay.voronoi(vorBounds);
    const iterCells: MultiPolygonCoords[] = [];

    for (let i = 0; i < seeds.length; i++) {
      const cellRing = voronoi.cellPolygon(i);
      if (!cellRing || cellRing.length < 4) continue;
      const cellPts: Point[] = cellRing.map((p) => [p[0], p[1]]);
      const cellGeom: MultiPolygonCoords = [[cellPts]];
      const cellBox = computeBBox(cellGeom);
      const localMp = mp.filter((_, idx) => bboxesOverlap(polyBBoxes[idx], cellBox, 0.01));
      if (localMp.length === 0) continue;
      try {
        const clipped = polygonClipping.intersection(
          localMp as unknown as polygonClipping.Geom,
          cellGeom as unknown as polygonClipping.Geom,
        );
        const clean = sanitizeClippedMultiPolygon(clipped, 0.002);
        if (clean.length > 0) {
          if (iter + 1 < ARENA_CONFIG.LLOYD_ITERATIONS) {
            seeds[i] = findInteriorPoint(clean);
          }
          iterCells.push(clean);
        }
      } catch {
        // Keep previous seed if degenerate
      }
    }
    if (iterCells.length > 0) {
      finalCells = iterCells;
    }
  }

  void countryId;
  return finalCells.length > 0 ? finalCells : [mp];
}

function generateInteriorSeeds(
  mp: MultiPolygonCoords,
  count: number,
  rng: () => number,
): Point[] {
  const polyAreas = mp.map((p) => polygonArea(p));
  const totalArea = polyAreas.reduce((s, v) => s + v, 0);
  if (totalArea <= 0) return [findInteriorPoint(mp)];

  // Allocate seeds across disjoint polygons proportional to area
  const allocations = polyAreas.map((a) => Math.floor((a / totalArea) * count));
  let assigned = allocations.reduce((s, v) => s + v, 0);
  const remainders = polyAreas
    .map((a, idx) => ({ idx, rem: (a / totalArea) * count - allocations[idx] }))
    .sort((x, y) => y.rem - x.rem);
  let rIdx = 0;
  while (assigned < count && rIdx < remainders.length) {
    allocations[remainders[rIdx].idx]++;
    assigned++;
    rIdx++;
  }

  const seeds: Point[] = [];
  for (let pIdx = 0; pIdx < mp.length; pIdx++) {
    const need = allocations[pIdx];
    if (need <= 0) continue;
    const poly = mp[pIdx];
    const [minX, minY, maxX, maxY] = computeBBox([poly]);
    const w = maxX - minX;
    const h = maxY - minY;
    let found = 0;
    let attempts = 0;
    const maxAttempts = need * 60 + 80;
    while (found < need && attempts < maxAttempts) {
      attempts++;
      const pt: Point = [minX + rng() * w, minY + rng() * h];
      if (pointInPolygon(pt, poly)) {
        seeds.push(pt);
        found++;
      }
    }
    while (found < need) {
      const base = findInteriorPoint([poly]);
      seeds.push([base[0] + (rng() - 0.5) * 0.05, base[1] + (rng() - 0.5) * 0.05]);
      found++;
    }
  }
  return seeds;
}

function detectBiome(centroid: Point, rng: () => number): BiomeType {
  const lon = centroid[0];
  const lat = unprojectToLat(centroid[1]);
  const absLat = Math.abs(lat);

  // Subtropical desert belts (Sahara, Arabia, Central Asia/Gobi, SW US, Outback)
  const inSaharaArabia = lat >= 13 && lat <= 33 && lon >= -17 && lon <= 62;
  const inOutback = lat <= -19 && lat >= -31 && lon >= 115 && lon <= 142;
  const inSWUS = lat >= 24 && lat <= 36 && lon >= -118 && lon <= -103;
  if (inSaharaArabia || inOutback || inSWUS) {
    return rng() < 0.82 ? 'desert' : 'mountain';
  }

  // Major mountain belts (Alps, Anatolia/Caucasus/Zagros, Himalayas, Andes, Rockies)
  const inAlpineCaucasus = lat >= 35 && lat <= 48 && lon >= 5 && lon <= 52 && rng() < 0.38;
  const inHimalaya = lat >= 27 && lat <= 40 && lon >= 68 && lon <= 102 && rng() < 0.65;
  const inAndes = lat <= 10 && lat >= -50 && lon >= -80 && lon <= -64 && rng() < 0.55;
  if (inAlpineCaucasus || inHimalaya || inAndes || rng() < 0.16) {
    return 'mountain';
  }

  if (absLat > 44 || (absLat < 12 && rng() < 0.7) || rng() < 0.45) {
    return 'forest';
  }
  return 'grass';
}

function scatterTerrainProps(
  mp: MultiPolygonCoords,
  biome: BiomeType,
  area: number,
  rng: () => number,
): TerrainProp[] {
  const props: TerrainProp[] = [];
  const target = Math.min(7, Math.max(2, Math.round(area * 1.1)));
  const [minX, minY, maxX, maxY] = computeBBox(mp);
  let tries = 0;
  while (props.length < target && tries < target * 25) {
    tries++;
    const pt: Point = [minX + rng() * (maxX - minX), minY + rng() * (maxY - minY)];
    if (!pointInMultiPolygon(pt, mp)) continue;
    let kind: TerrainProp['kind'] = 'grass';
    if (biome === 'forest') kind = rng() < 0.72 ? 'tree' : 'grass';
    else if (biome === 'mountain') kind = rng() < 0.65 ? 'mountain' : rng() < 0.5 ? 'tree' : 'grass';
    else if (biome === 'desert') kind = rng() < 0.55 ? 'dune' : 'cactus';
    else kind = rng() < 0.35 ? 'tree' : 'grass';

    props.push({
      kind,
      x: pt[0],
      y: pt[1],
      variant: Math.floor(rng() * 3),
    });
  }
  return props;
}

export interface BuiltTheater {
  arena: ArenaBounds;
  countries: Record<string, Country>;
  regions: Record<string, Region>;
}

const PERSONALITIES: AIPersonality[] = ['aggressive', 'economist', 'opportunist', 'diplomat'];

export function buildRegionalTheater(
  selectedCountryId: string,
  allWorldCountries: WorldCountryFeature[],
  clickPt?: Point | null,
  seedSuffix = 'geogame',
): BuiltTheater {
  const selectedFeature = allWorldCountries.find((c) => c.id === selectedCountryId);
  if (!selectedFeature) {
    throw new Error(`Seçilen ülke bulunamadı: ${selectedCountryId}`);
  }

  const arena = computeArenaBounds(selectedFeature, clickPt);
  const playerMinArea = Math.min(0.0001, selectedFeature.area * 0.25);
  const playerClipped = clipMultiPolygonToBox(selectedFeature.polygons, arena, playerMinArea);
  const playerPolys = playerClipped.length > 0 ? playerClipped : selectedFeature.polygons;

  // Gather candidate neighboring/nearby countries inside the arena frame
  const candidates: {
    feature: WorldCountryFeature;
    clipped: MultiPolygonCoords;
    distSq: number;
    clippedArea: number;
  }[] = [];

  for (const c of allWorldCountries) {
    if (c.id === selectedFeature.id) continue;
    if (!bboxesOverlap(c.bbox, [arena.minX, arena.minY, arena.maxX, arena.maxY], 0.1)) continue;
    const minKeep = Math.min(0.0004, c.area * 0.5);
    const clipped = clipMultiPolygonToBox(c.polygons, arena, minKeep);
    if (clipped.length === 0) continue;
    const clippedArea = multiPolygonArea(clipped);
    if (clippedArea <= 0) continue;
    const distSq = approxMultiPolygonDistanceSq(playerPolys, clipped);
    candidates.push({ feature: c, clipped, distSq, clippedArea });
  }

  candidates.sort((a, b) => a.distSq - b.distSq || b.clippedArea - a.clippedArea);
  const activeAI = candidates.slice(0, ARENA_CONFIG.MAX_AI_COUNTRIES);

  const activeEntries: {
    feature: WorldCountryFeature;
    clipped: MultiPolygonCoords;
    isPlayer: boolean;
  }[] = [
    { feature: selectedFeature, clipped: playerPolys, isPlayer: true },
    ...activeAI.map((item) => ({ feature: item.feature, clipped: item.clipped, isPlayer: false })),
  ];

  const countries: Record<string, Country> = {};
  const regions: Record<string, Region> = {};
  const rng = createRng(`${selectedFeature.id}:${seedSuffix}`);

  activeEntries.forEach((entry, idx) => {
    const cid = entry.feature.id;
    const subPolys = subdivideCountryIntoRegions(cid, entry.clipped, rng);
    const personality = PERSONALITIES[Math.floor(rng() * PERSONALITIES.length)];

    countries[cid] = {
      id: cid,
      name: entry.feature.name,
      color: COUNTRY_PALETTE[idx % COUNTRY_PALETTE.length],
      isPlayer: entry.isPlayer,
      eliminated: false,
      personality,
      nextAiThinkSec: 2 + rng() * 2,
      money: 300,
      manpower: 50,
      weaponsStock: { sword: 0, spear: 0, pistol: 0, ak: 0, bazooka: 0 },
      shieldsStock: { wood: 0, bronze: 0, steel: 0, diamond: 0, forcefield: 0 },
      unlockedWeapons: ['sword'],
      unlockedShields: ['wood'],
      activeResearch: null,
      productionQueue: [],
      trainingQueue: [],
    };

    subPolys.forEach((rmp, rIdx) => {
      const rid = `${cid}_r${rIdx}`;
      const centroid = findInteriorPoint(rmp);
      const area = multiPolygonArea(rmp);
      const biome = detectBiome(centroid, rng);
      regions[rid] = {
        id: rid,
        ownerId: cid,
        initialOwnerId: cid,
        polygons: rmp,
        centroid,
        bbox: computeBBox(rmp),
        area,
        neighbors: [],
        isCoastal: false,
        coastalAnchor: null,
        biome,
        props: scatterTerrainProps(rmp, biome, area, rng),
        building: null,
        capture: null,
      };
    });
  });

  const marginBox: ArenaBounds = {
    minX: arena.minX - 0.35,
    minY: arena.minY - 0.35,
    maxX: arena.maxX + 0.35,
    maxY: arena.maxY + 0.35,
  };
  const arenaLandChunks: { bbox: [number, number, number, number]; poly: PolygonCoords }[] = [];
  for (const c of allWorldCountries) {
    if (!bboxesOverlap(c.bbox, [marginBox.minX, marginBox.minY, marginBox.maxX, marginBox.maxY], 0)) {
      continue;
    }
    const clipped = clipMultiPolygonToBox(c.polygons, marginBox, 0.0001);
    for (const poly of clipped) {
      arenaLandChunks.push({ bbox: computeBBox([poly]), poly });
    }
  }

  computeAdjacencyAndCoasts(Object.values(regions), arenaLandChunks, arena);

  return { arena, countries, regions };
}

function isOnArenaCutBorder(pt: Point, arena: ArenaBounds, eps = 0.08): boolean {
  return (
    Math.abs(pt[0] - arena.minX) <= eps ||
    Math.abs(pt[0] - arena.maxX) <= eps ||
    Math.abs(pt[1] - arena.minY) <= eps ||
    Math.abs(pt[1] - arena.maxY) <= eps
  );
}

function isPointOnAnyWorldLand(
  pt: Point,
  landChunks: { bbox: [number, number, number, number]; poly: PolygonCoords }[],
): boolean {
  for (let i = 0; i < landChunks.length; i++) {
    const [minX, minY, maxX, maxY] = landChunks[i].bbox;
    if (pt[0] >= minX && pt[0] <= maxX && pt[1] >= minY && pt[1] <= maxY) {
      if (pointInPolygon(pt, landChunks[i].poly)) return true;
    }
  }
  return false;
}

function computeAdjacencyAndCoasts(
  regionList: Region[],
  arenaLandChunks: { bbox: [number, number, number, number]; poly: PolygonCoords }[],
  arena: ArenaBounds,
): void {
  const n = regionList.length;

  // 1. Land adjacency graph
  for (let i = 0; i < n; i++) {
    const a = regionList[i];
    for (let j = i + 1; j < n; j++) {
      const b = regionList[j];
      if (!bboxesOverlap(a.bbox, b.bbox, 0.09)) continue;
      if (approxMultiPolygonDistanceSq(a.polygons, b.polygons) <= 0.08 * 0.08) {
        a.neighbors.push(b.id);
        b.neighbors.push(a.id);
      }
    }
  }

  // 2. Active sea coast detection (ignoring artificial arena cut border & culled land neighbors)
  for (const reg of regionList) {
    let foundCoast: Point | null = null;
    for (const poly of reg.polygons) {
      const outer = poly[0];
      const step = Math.max(1, Math.floor(outer.length / 36));
      for (let i = 0; i < outer.length; i += step) {
        const p1 = outer[i];
        const p2 = outer[(i + 1) % outer.length];
        const mx = (p1[0] + p2[0]) * 0.5;
        const my = (p1[1] + p2[1]) * 0.5;
        if (isOnArenaCutBorder([mx, my], arena, 0.1)) continue;

        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const len = Math.hypot(dx, dy);
        if (len < 1e-5) continue;
        const nx = -dy / len;
        const ny = dx / len;
        const probeDist = 0.15;
        const plus: Point = [mx + nx * probeDist, my + ny * probeDist];
        const minus: Point = [mx - nx * probeDist, my - ny * probeDist];

        const outward = !pointInMultiPolygon(plus, reg.polygons)
          ? plus
          : !pointInMultiPolygon(minus, reg.polygons)
            ? minus
            : null;
        if (!outward) continue;
        if (
          outward[0] <= arena.minX + 0.05 ||
          outward[0] >= arena.maxX - 0.05 ||
          outward[1] <= arena.minY + 0.05 ||
          outward[1] >= arena.maxY - 0.05
        ) {
          continue;
        }
        if (!isPointOnAnyWorldLand(outward, arenaLandChunks)) {
          foundCoast = outward;
          break;
        }
      }
      if (foundCoast) break;
    }
    if (foundCoast) {
      reg.isCoastal = true;
      reg.coastalAnchor = foundCoast;
    }
  }
}

export function pickRegionAtPoint(
  pt: Point,
  regions: Record<string, Region>,
): Region | null {
  for (const reg of Object.values(regions)) {
    const [minX, minY, maxX, maxY] = reg.bbox;
    if (pt[0] >= minX && pt[0] <= maxX && pt[1] >= minY && pt[1] <= maxY) {
      if (pointInMultiPolygon(pt, reg.polygons)) {
        return reg;
      }
    }
  }
  return null;
}
