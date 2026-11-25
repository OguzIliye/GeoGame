import type { MultiPolygonCoords, Point, PolygonCoords, Ring } from '../types';

/** Project (lon, lat) degrees into clean 2D map coordinates (y-down). */
export function projectLonLat(lon: number, lat: number): Point {
  return [lon, -lat * 1.15];
}

export function unprojectToLat(y: number): number {
  return -y / 1.15;
}

export function ringSignedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    if (Math.abs(x2 - x1) > 170) continue; // Guard antimeridian jump
    sum += x1 * y2 - x2 * y1;
  }
  return sum * 0.5;
}

export function polygonArea(poly: PolygonCoords): number {
  if (poly.length === 0) return 0;
  let area = Math.abs(ringSignedArea(poly[0]));
  for (let i = 1; i < poly.length; i++) {
    area -= Math.abs(ringSignedArea(poly[i]));
  }
  return Math.max(0, area);
}

export function multiPolygonArea(mp: MultiPolygonCoords): number {
  let total = 0;
  for (const poly of mp) total += polygonArea(poly);
  return total;
}

export function computeBBox(mp: MultiPolygonCoords): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of mp) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return [minX, minY, maxX, maxY];
}

export function bboxesOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
  pad = 0,
): boolean {
  return (
    a[0] - pad <= b[2] + pad &&
    a[2] + pad >= b[0] - pad &&
    a[1] - pad <= b[3] + pad &&
    a[3] + pad >= b[1] - pad
  );
}

export function pointInRing(pt: Point, ring: Ring): boolean {
  const [px, py] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (Math.abs(xi - xj) > 170) continue;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(pt: Point, poly: PolygonCoords): boolean {
  if (poly.length === 0 || !pointInRing(pt, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) {
    if (pointInRing(pt, poly[i])) return false;
  }
  return true;
}

export function pointInMultiPolygon(pt: Point, mp: MultiPolygonCoords): boolean {
  for (const poly of mp) {
    if (pointInPolygon(pt, poly)) return true;
  }
  return false;
}

export function ringCentroid(ring: Ring): Point {
  let cx = 0;
  let cy = 0;
  let area2 = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    if (Math.abs(x2 - x1) > 170) continue;
    const cross = x1 * y2 - x2 * y1;
    area2 += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(area2) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    const len = Math.max(1, ring.length);
    return [sx / len, sy / len];
  }
  return [cx / (3 * area2), cy / (3 * area2)];
}

/** Guaranteed interior visual label/anchor point inside the largest polygon of a MultiPolygon. */
export function findInteriorPoint(mp: MultiPolygonCoords): Point {
  if (mp.length === 0) return [0, 0];
  let bestPoly = mp[0];
  let bestArea = -1;
  for (const poly of mp) {
    const a = polygonArea(poly);
    if (a > bestArea) {
      bestArea = a;
      bestPoly = poly;
    }
  }
  const c = ringCentroid(bestPoly[0]);
  if (pointInPolygon(c, bestPoly)) return c;

  // Scanline fallback for crescent/concave shapes
  const [minX, minY, maxX, maxY] = computeBBox([bestPoly]);
  let bestMid: Point = [(minX + maxX) * 0.5, (minY + maxY) * 0.5];
  let bestSpan = -1;
  for (const frac of [0.5, 0.35, 0.65, 0.25, 0.75]) {
    const y = minY + (maxY - minY) * frac;
    const xs: number[] = [];
    const outer = bestPoly[0];
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const [x1, y1] = outer[i];
      const [x2, y2] = outer[j];
      if (y1 > y !== y2 > y && Math.abs(x1 - x2) <= 170) {
        xs.push(x1 + ((x2 - x1) * (y - y1)) / (y2 - y1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const span = xs[k + 1] - xs[k];
      const mid: Point = [(xs[k] + xs[k + 1]) * 0.5, y];
      if (span > bestSpan && pointInPolygon(mid, bestPoly)) {
        bestSpan = span;
        bestMid = mid;
      }
    }
  }
  if (bestSpan > 0) return bestMid;
  return bestPoly[0][0] ?? [0, 0];
}

export function pointToSegmentDistSq(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) {
    const ex = p[0] - a[0];
    const ey = p[1] - a[1];
    return ex * ex + ey * ey;
  }
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  const projX = a[0] + t * dx;
  const projY = a[1] + t * dy;
  const ex = p[0] - projX;
  const ey = p[1] - projY;
  return ex * ex + ey * ey;
}

export function minDistToMultiPolygonSq(p: Point, mp: MultiPolygonCoords): number {
  if (pointInMultiPolygon(p, mp)) return 0;
  let best = Infinity;
  for (const poly of mp) {
    const outer = poly[0];
    for (let i = 0, n = outer.length; i < n; i++) {
      const a = outer[i];
      const b = outer[(i + 1) % n];
      if (Math.abs(a[0] - b[0]) > 170) continue;
      const d = pointToSegmentDistSq(p, a, b);
      if (d < best) best = d;
    }
  }
  return best;
}
