import * as topojson from 'topojson-client';
import type { GeometryCollection, GeometryObject, Polygon, MultiPolygon, Topology } from 'topojson-specification';
import { ARENA_CONFIG } from '../config/balance';
import type { MultiPolygonCoords, Point, PolygonCoords, Ring, WorldCountryFeature } from '../types';
import {
  computeBBox,
  findInteriorPoint,
  multiPolygonArea,
  pointInMultiPolygon,
  projectLonLat,
} from './geometry';

function normalizeRingLonLat(rawRing: number[][]): Ring {
  let hasDatelineJump = false;
  for (let i = 1; i < rawRing.length; i++) {
    if (Math.abs(rawRing[i][0] - rawRing[i - 1][0]) > 170) {
      hasDatelineJump = true;
      break;
    }
  }
  const ring: Ring = [];
  for (let i = 0; i < rawRing.length; i++) {
    let lon = rawRing[i][0];
    const lat = rawRing[i][1];
    // Unwrap Chukotka / Fiji rings across +180° so polygons stay contiguous and valid
    if (hasDatelineJump && lon < 0) lon += 360;
    const pt = projectLonLat(lon, lat);
    if (
      ring.length === 0 ||
      Math.abs(pt[0] - ring[ring.length - 1][0]) > 1e-6 ||
      Math.abs(pt[1] - ring[ring.length - 1][1]) > 1e-6
    ) {
      ring.push(pt);
    }
  }
  if (ring.length >= 3) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
  }
  return ring;
}

function geoJsonToMultiPolygonCoords(geom: { type: string; coordinates?: unknown } | null): MultiPolygonCoords {
  if (!geom || !geom.coordinates) return [];
  const rawPolys: number[][][][] =
    geom.type === 'Polygon'
      ? [geom.coordinates as number[][][]]
      : geom.type === 'MultiPolygon'
        ? (geom.coordinates as number[][][][])
        : [];
  const polygons: MultiPolygonCoords = [];
  for (const rawPoly of rawPolys) {
    const poly: PolygonCoords = [];
    for (const rawRing of rawPoly) {
      const ring = normalizeRingLonLat(rawRing);
      if (ring.length >= 4) poly.push(ring);
    }
    if (poly.length > 0) polygons.push(poly);
  }
  return polygons;
}

function computeTopoArcLengths(topo: Topology): number[] {
  const t = topo.transform;
  return topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    let prevPt: Point | null = null;
    let len = 0;
    for (let i = 0; i < arc.length; i++) {
      x += arc[i][0];
      y += arc[i][1];
      const lon = t ? x * t.scale[0] + t.translate[0] : x;
      const lat = t ? y * t.scale[1] + t.translate[1] : y;
      const pt = projectLonLat(lon, lat);
      if (prevPt) len += Math.hypot(pt[0] - prevPt[0], pt[1] - prevPt[1]);
      prevPt = pt;
    }
    return len;
  });
}

function collectArcIndices(geom: GeometryObject<{ name?: string }>): number[] {
  const out: number[] = [];
  const rawArcs = (geom as Polygon | MultiPolygon).arcs as unknown;
  if (!rawArcs) return out;
  const walk = (arr: unknown): void => {
    if (!Array.isArray(arr) || arr.length === 0) return;
    if (typeof arr[0] === 'number') {
      for (const idx of arr as number[]) {
        out.push(idx < 0 ? ~idx : idx);
      }
    } else {
      for (const sub of arr) walk(sub);
    }
  };
  walk(rawArcs);
  return out;
}

/**
 * Parse world TopoJSON into playable countries:
 * - Drops Antarctica.
 * - Drops <=4-region island countries (e.g. Cyprus, N. Cyprus, Malta, Singapore).
 * - Merges <=4-region land countries (e.g. Vatican, San Marino, Monaco, Luxembourg, Lebanon)
 *   into the major (>4-region) neighbor with which they share the longest border.
 */
export function parseWorldTopology(topo: Topology): WorldCountryFeature[] {
  const countriesObj = topo.objects.countries as GeometryCollection<{ name?: string }>;
  const geoms = countriesObj.geometries;
  const fc = topojson.feature(topo, countriesObj);

  const count = geoms.length;
  const names: string[] = new Array(count);
  const areas: number[] = new Array(count).fill(0);
  const isValid: boolean[] = new Array(count).fill(false);
  const isMajor: boolean[] = new Array(count).fill(false);

  for (let i = 0; i < count; i++) {
    const feat = fc.features[i];
    const name = feat.properties?.name?.trim() || `Country ${i + 1}`;
    names[i] = name;
    if (name === 'Antarctica') continue;
    const polys = geoJsonToMultiPolygonCoords(feat.geometry);
    if (polys.length === 0) continue;
    const area = multiPolygonArea(polys);
    if (area <= 1e-6) continue;
    areas[i] = area;
    isValid[i] = true;
    const estRegions = Math.max(1, Math.round(area / ARENA_CONFIG.TARGET_REGION_AREA));
    isMajor[i] = estRegions > ARENA_CONFIG.SMALL_COUNTRY_MAX_REGIONS;
  }

  // Compute exact shared border lengths from TopoJSON arcs
  const arcLens = computeTopoArcLengths(topo);
  const arcOwners = new Map<number, Set<number>>();
  for (let i = 0; i < count; i++) {
    if (!isValid[i]) continue;
    for (const arcId of collectArcIndices(geoms[i])) {
      let owners = arcOwners.get(arcId);
      if (!owners) {
        owners = new Set<number>();
        arcOwners.set(arcId, owners);
      }
      owners.add(i);
    }
  }

  const sharedBorder: Array<Map<number, number>> = Array.from({ length: count }, () => new Map());
  for (const [arcId, owners] of arcOwners) {
    if (owners.size < 2) continue;
    const arr = [...owners];
    const len = arcLens[arcId] ?? 0;
    for (let a = 0; a < arr.length; a++) {
      for (let b = a + 1; b < arr.length; b++) {
        const u = arr[a];
        const v = arr[b];
        sharedBorder[u].set(v, (sharedBorder[u].get(v) ?? 0) + len);
        sharedBorder[v].set(u, (sharedBorder[v].get(u) ?? 0) + len);
      }
    }
  }

  // Assign each <=4-region land country to the major host with the longest shared border (iteratively for chains)
  const hostOf: number[] = new Array(count).fill(-1);
  for (let i = 0; i < count; i++) {
    if (isValid[i] && isMajor[i]) hostOf[i] = i;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < count; i++) {
      if (!isValid[i] || hostOf[i] !== -1) continue;
      // Sum shared border lengths per candidate resolved major host
      const borderByHost = new Map<number, number>();
      for (const [nb, len] of sharedBorder[i]) {
        const nbHost = hostOf[nb];
        if (nbHost !== -1) {
          borderByHost.set(nbHost, (borderByHost.get(nbHost) ?? 0) + len);
        }
      }
      if (borderByHost.size === 0) continue;
      let bestHost = -1;
      let bestLen = -1;
      for (const [h, len] of borderByHost) {
        if (len > bestLen || (len === bestLen && areas[h] > areas[bestHost])) {
          bestLen = len;
          bestHost = h;
        }
      }
      if (bestHost !== -1) {
        hostOf[i] = bestHost;
        changed = true;
      }
    }
  }

  // Group absorbed small countries under their surviving major host; unassigned small islands are dropped!
  const groupedIndices = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const h = hostOf[i];
    if (h === -1) continue;
    let list = groupedIndices.get(h);
    if (!list) {
      list = [];
      groupedIndices.set(h, list);
    }
    list.push(i);
  }

  const features: WorldCountryFeature[] = [];
  const usedIds = new Set<string>();

  for (const [hostIdx, memberIndices] of groupedIndices) {
    const feat = fc.features[hostIdx];
    const name = names[hostIdx];

    let polygons: MultiPolygonCoords;
    if (memberIndices.length === 1) {
      polygons = geoJsonToMultiPolygonCoords(feat.geometry);
    } else {
      const mergeGeoms = memberIndices
        .map((idx) => geoms[idx])
        .filter((g): g is Polygon | MultiPolygon => g.type === 'Polygon' || g.type === 'MultiPolygon');
      const merged = topojson.merge(topo, mergeGeoms);
      polygons = geoJsonToMultiPolygonCoords(merged);
    }
    if (polygons.length === 0) continue;

    let baseId = feat.id !== undefined && feat.id !== null ? String(feat.id) : slugify(name);
    if (usedIds.has(baseId)) baseId = `${baseId}_${hostIdx}`;
    usedIds.add(baseId);

    const area = multiPolygonArea(polygons);
    if (area <= 1e-6) continue;

    features.push({
      id: baseId,
      name,
      polygons,
      centroid: findInteriorPoint(polygons),
      bbox: computeBBox(polygons),
      area,
    });
  }

  return features;
}

export async function fetchWorldCountries(url = '/assets/world-50m.json'): Promise<WorldCountryFeature[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Dünya haritası yüklenemedi: ${res.status}`);
  const topo = (await res.json()) as Topology;
  return parseWorldTopology(topo);
}

/** Hit-test map point against world countries. */
export function pickWorldCountryAtPoint(
  pt: Point,
  countries: WorldCountryFeature[],
): WorldCountryFeature | null {
  const hits: WorldCountryFeature[] = [];
  for (const c of countries) {
    const [minX, minY, maxX, maxY] = c.bbox;
    if (pt[0] >= minX && pt[0] <= maxX && pt[1] >= minY && pt[1] <= maxY) {
      if (pointInMultiPolygon(pt, c.polygons)) {
        hits.push(c);
      }
    }
  }
  if (hits.length > 0) {
    hits.sort((a, b) => a.area - b.area);
    return hits[0];
  }
  return null;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'country';
}
