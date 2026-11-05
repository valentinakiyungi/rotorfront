// A top-down camera: world coordinates are tiles; one tile is TILE px at zoom 1.
export const TILE = 32;

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  w = 1;
  h = 1;
  minZoom = 0.35;
  maxZoom = 2.2;

  get scale(): number {
    return TILE * this.zoom;
  }

  toScreen(wx: number, wy: number): [number, number] {
    const s = this.scale;
    return [(wx - this.x) * s + this.w / 2, (wy - this.y) * s + this.h / 2];
  }

  toWorld(sx: number, sy: number): [number, number] {
    const s = this.scale;
    return [(sx - this.w / 2) / s + this.x, (sy - this.h / 2) / s + this.y];
  }

  zoomAt(factor: number, sx: number, sy: number): void {
    const [wx, wy] = this.toWorld(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    const [nx, ny] = this.toWorld(sx, sy);
    this.x += wx - nx;
    this.y += wy - ny;
  }

  panPixels(dx: number, dy: number): void {
    this.x -= dx / this.scale;
    this.y -= dy / this.scale;
  }

  clamp(mapW: number, mapH: number): void {
    const halfW = this.w / 2 / this.scale, halfH = this.h / 2 / this.scale;
    const pad = 2;
    this.x = halfW * 2 > mapW + pad * 2 ? mapW / 2 : Math.max(halfW - pad, Math.min(mapW - halfW + pad, this.x));
    this.y = halfH * 2 > mapH + pad * 2 ? mapH / 2 : Math.max(halfH - pad, Math.min(mapH - halfH + pad, this.y));
  }

  /** Visible world rectangle, with a margin in tiles. */
  view(margin = 1): { x0: number; y0: number; x1: number; y1: number } {
    const [x0, y0] = this.toWorld(0, 0);
    const [x1, y1] = this.toWorld(this.w, this.h);
    return { x0: x0 - margin, y0: y0 - margin, x1: x1 + margin, y1: y1 + margin };
  }
}
