import * as topojson from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
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

export function parseWorldTopology(topo: Topology): WorldCountryFeature[] {
  const countriesObj = topo.objects.countries as GeometryCollection<{ name?: string }>;
  const fc = topojson.feature(topo, countriesObj);
  const features: WorldCountryFeature[] = [];
  const usedIds = new Set<string>();

  fc.features.forEach((feat, idx) => {
    const name = feat.properties?.name?.trim() || `Country ${idx + 1}`;
    if (name === 'Antarctica') return;

    const geom = feat.geometry;
    if (!geom) return;
    const rawPolys: number[][][][] =
      geom.type === 'Polygon'
        ? [geom.coordinates]
        : geom.type === 'MultiPolygon'
          ? geom.coordinates
          : [];
    if (rawPolys.length === 0) return;

    const polygons: MultiPolygonCoords = [];
    for (const rawPoly of rawPolys) {
      const poly: PolygonCoords = [];
      for (const rawRing of rawPoly) {
        const ring = normalizeRingLonLat(rawRing);
        if (ring.length >= 4) poly.push(ring);
      }
      if (poly.length > 0) polygons.push(poly);
    }
    if (polygons.length === 0) return;

    let baseId = feat.id !== undefined && feat.id !== null ? String(feat.id) : slugify(name);
    if (usedIds.has(baseId)) baseId = `${baseId}_${idx}`;
    usedIds.add(baseId);

    const area = multiPolygonArea(polygons);
    if (area <= 1e-6) return;

    features.push({
      id: baseId,
      name,
      polygons,
      centroid: findInteriorPoint(polygons),
      bbox: computeBBox(polygons),
      area,
    });
  });

  return features;
}

export async function fetchWorldCountries(url = '/assets/world-50m.json'): Promise<WorldCountryFeature[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Dünya haritası yüklenemedi: ${res.status}`);
  const topo = (await res.json()) as Topology;
  return parseWorldTopology(topo);
}

/** Hit-test map point against world countries; tiny enclaves (like Vatican) win when overlapping larger countries. */
export function pickWorldCountryAtPoint(
  pt: Point,
  countries: WorldCountryFeature[],
  clickRadiusMapUnits = 0.35,
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
  // Assist clicking microstates (Vatican, Monaco, San Marino, Malta) within small cursor radius
  let nearest: WorldCountryFeature | null = null;
  let nearestDistSq = clickRadiusMapUnits * clickRadiusMapUnits;
  for (const c of countries) {
    if (c.area > 0.5) continue;
    const dx = pt[0] - c.centroid[0];
    const dy = pt[1] - c.centroid[1];
    const d2 = dx * dx + dy * dy;
    if (d2 < nearestDistSq) {
      nearestDistSq = d2;
      nearest = c;
    }
  }
  return nearest;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'country';
}
