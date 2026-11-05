// Gesture recognition for touch, mouse and keyboard. Turns raw pointer events
// into a handful of intents (tap, double-tap, box select, pan, zoom) for the Game.

export type TapKind = 'touch' | 'left' | 'right';

export interface InputTarget {
  tap(sx: number, sy: number, kind: TapKind, shift: boolean): void;
  doubleTap(sx: number, sy: number): void;
  boxSelect(x0: number, y0: number, x1: number, y1: number, shift: boolean): void;
  setBox(box: { x0: number; y0: number; x1: number; y1: number } | null): void;
  pan(dx: number, dy: number): void;
  zoom(factor: number, sx: number, sy: number): void;
  hover(sx: number, sy: number): void;
  key(key: string, down: boolean, shift: boolean): void;
}

interface Ptr { x: number; y: number; sx: number; sy: number; t: number; type: string; button: number }

const TAP_SLOP = 10;
const LONG_PRESS_MS = 420;

export class Input {
  private ptrs = new Map<number, Ptr>();
  private mode: 'none' | 'pan' | 'box' | 'pinch' = 'none';
  private longPress = 0;
  private lastTap = { t: 0, x: 0, y: 0 };
  private pinch = { d: 0, mx: 0, my: 0 };
  private cleanup: (() => void)[] = [];

  constructor(private el: HTMLElement, private target: InputTarget) {
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => el.removeEventListener(type, fn as EventListener));
    };
    on('pointerdown', (e) => this.down(e));
    on('pointermove', (e) => this.move(e));
    on('pointerup', (e) => this.up(e));
    on('pointercancel', (e) => this.cancel(e));
    on('contextmenu', (e) => e.preventDefault());
    on('wheel', (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      this.target.zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.target.key(e.key, true, e.shiftKey);
    };
    const ku = (e: KeyboardEvent) => this.target.key(e.key, false, e.shiftKey);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    this.cleanup.push(() => window.removeEventListener('keydown', kd), () => window.removeEventListener('keyup', ku));
  }

  destroy(): void {
    this.cleanup.forEach((f) => f());
    clearTimeout(this.longPress);
  }

  private local(e: PointerEvent): [number, number] {
    const r = this.el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private down(e: PointerEvent) {
    const [x, y] = this.local(e);
    this.el.setPointerCapture(e.pointerId);
    this.ptrs.set(e.pointerId, { x, y, sx: x, sy: y, t: performance.now(), type: e.pointerType, button: e.button });
    clearTimeout(this.longPress);
    if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      this.mode = 'pinch';
      this.target.setBox(null);
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (this.ptrs.size === 1) {
      this.mode = 'none';
      if (e.pointerType === 'touch') {
        // Long-press then drag = box select on touch screens.
        this.longPress = window.setTimeout(() => {
          const p = this.ptrs.get(e.pointerId);
          if (p && this.mode === 'none' && Math.hypot(p.x - p.sx, p.y - p.sy) < TAP_SLOP) {
            this.mode = 'box';
            navigator.vibrate?.(15);
            this.target.setBox({ x0: p.sx, y0: p.sy, x1: p.x, y1: p.y });
          }
        }, LONG_PRESS_MS);
      }
    }
  }

  private move(e: PointerEvent) {
    const [x, y] = this.local(e);
    const p = this.ptrs.get(e.pointerId);
    if (!p) { if (e.pointerType === 'mouse') this.target.hover(x, y); return; }
    const dx = x - p.x, dy = y - p.y;
    p.x = x; p.y = y;
    if (this.mode === 'pinch' && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (this.pinch.d > 0) this.target.zoom(d / this.pinch.d, mx, my);
      this.target.pan(mx - this.pinch.mx, my - this.pinch.my);
      this.pinch = { d, mx, my };
      return;
    }
    if (this.mode === 'none' && Math.hypot(x - p.sx, y - p.sy) > TAP_SLOP) {
      clearTimeout(this.longPress);
      this.mode = p.type === 'mouse' && p.button === 0 ? 'box' : 'pan';
    }
    if (this.mode === 'pan') this.target.pan(dx, dy);
    if (this.mode === 'box') this.target.setBox({ x0: p.sx, y0: p.sy, x1: x, y1: y });
    if (p.type === 'mouse') this.target.hover(x, y);
  }

  private up(e: PointerEvent) {
    const p = this.ptrs.get(e.pointerId);
    clearTimeout(this.longPress);
    if (!p) return;
    this.ptrs.delete(e.pointerId);
    if (this.mode === 'pinch') {
      if (this.ptrs.size === 0) this.mode = 'none';
      return;
    }
    if (this.mode === 'box') {
      this.target.setBox(null);
      this.target.boxSelect(p.sx, p.sy, p.x, p.y, e.shiftKey);
    } else if (this.mode === 'none') {
      const now = performance.now();
      const kind: TapKind = p.type === 'mouse' ? (p.button === 2 ? 'right' : 'left') : 'touch';
      if (kind !== 'right' && now - this.lastTap.t < 300 && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 24) {
        this.target.doubleTap(p.x, p.y);
        this.lastTap.t = 0;
      } else {
        this.target.tap(p.x, p.y, kind, e.shiftKey);
        this.lastTap = { t: now, x: p.x, y: p.y };
      }
    }
    this.mode = 'none';
  }

  private cancel(e: PointerEvent) {
    this.ptrs.delete(e.pointerId);
    clearTimeout(this.longPress);
    this.target.setBox(null);
    if (!this.ptrs.size) this.mode = 'none';
  }
}
