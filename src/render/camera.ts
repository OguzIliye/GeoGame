import type { ArenaBounds, Point } from '../types';

export class MapCamera {
  cx = 10;
  cy = -22;
  scale = 4; // Screen pixels per map unit

  private targetCx = 10;
  private targetCy = -22;
  private targetScale = 4;
  private bounds: ArenaBounds = { minX: -180, minY: -98, maxX: 192, maxY: 72 };
  private minScale = 2;
  private maxScale = 180;

  setBounds(bounds: ArenaBounds, viewW: number, viewH: number, immediate = false): void {
    this.bounds = bounds;
    const bw = Math.max(1, bounds.maxX - bounds.minX);
    const bh = Math.max(1, bounds.maxY - bounds.minY);
    const fitScale = Math.min((viewW * 0.92) / bw, (viewH * 0.88) / bh);
    this.minScale = Math.max(1.2, fitScale * 0.85);
    this.maxScale = Math.max(80, fitScale * 14);

    this.targetCx = (bounds.minX + bounds.maxX) * 0.5;
    this.targetCy = (bounds.minY + bounds.maxY) * 0.5;
    this.targetScale = fitScale;

    if (immediate) {
      this.cx = this.targetCx;
      this.cy = this.targetCy;
      this.scale = this.targetScale;
    }
  }

  update(dtRealSec: number): void {
    const k = Math.min(1, dtRealSec * 9);
    this.cx += (this.targetCx - this.cx) * k;
    this.cy += (this.targetCy - this.cy) * k;
    this.scale += (this.targetScale - this.scale) * k;
    this.clampTargets();
  }

  panByPixels(dxPx: number, dyPx: number): void {
    this.targetCx -= dxPx / this.scale;
    this.targetCy -= dyPx / this.scale;
    this.cx = this.targetCx;
    this.cy = this.targetCy;
    this.clampTargets();
    this.cx = this.targetCx;
    this.cy = this.targetCy;
  }

  zoomAtScreenPoint(factor: number, sx: number, sy: number, viewW: number, viewH: number): void {
    const before = this.screenToMap(sx, sy, viewW, viewH);
    const nextScale = Math.max(this.minScale, Math.min(this.maxScale, this.targetScale * factor));
    this.targetScale = nextScale;
    this.scale = nextScale;
    // Keep cursor anchored on same map coordinate
    this.targetCx = before[0] - (sx - viewW * 0.5) / this.scale;
    this.targetCy = before[1] - (sy - viewH * 0.5) / this.scale;
    this.clampTargets();
    this.cx = this.targetCx;
    this.cy = this.targetCy;
  }

  focusOnPoint(mx: number, my: number, preferredMinScale?: number): void {
    this.targetCx = mx;
    this.targetCy = my;
    const minFocus = preferredMinScale ?? Math.min(this.maxScale, Math.max(38, this.minScale * 3.2));
    this.targetScale = Math.max(this.targetScale, minFocus);
    this.clampTargets();
  }

  mapToScreen(mx: number, my: number, viewW: number, viewH: number): Point {
    return [
      (mx - this.cx) * this.scale + viewW * 0.5,
      (my - this.cy) * this.scale + viewH * 0.5,
    ];
  }

  screenToMap(sx: number, sy: number, viewW: number, viewH: number): Point {
    return [
      (sx - viewW * 0.5) / this.scale + this.cx,
      (sy - viewH * 0.5) / this.scale + this.cy,
    ];
  }

  private clampTargets(): void {
    const padX = (this.bounds.maxX - this.bounds.minX) * 0.08;
    const padY = (this.bounds.maxY - this.bounds.minY) * 0.08;
    this.targetCx = Math.max(
      this.bounds.minX - padX,
      Math.min(this.bounds.maxX + padX, this.targetCx),
    );
    this.targetCy = Math.max(
      this.bounds.minY - padY,
      Math.min(this.bounds.maxY + padY, this.targetCy),
    );
    this.targetScale = Math.max(this.minScale, Math.min(this.maxScale, this.targetScale));
  }
}
