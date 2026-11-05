// The Game: owns a World, runs the fixed-step loop, and connects the
// renderer, input, sound and HUD to it.
import {
  BUILDINGS,
  Commander,
  TICK_RATE,
  UNITS,
  createWorld,
  getMap,
  isBuilding,
  isUnit,
  issue,
  placementError,
  step,
  type BuildingKind,
  type Difficulty,
  type Personality,
  type SimEvent,
  type Team,
  type Unit,
  type UnitKind,
  type World,
} from '../sim';
import { Sound } from './audio';
import { Camera } from './camera';
import { Effects } from './effects';
import { Input, type InputTarget, type TapKind } from './input';
import { Renderer, type Ghost, type Marker } from './render';

export interface GameOptions {
  mapId: string;
  mode: 'play' | 'watch';
  /** Enemy AI (red) when playing; red AI when watching. */
  personality: Personality;
  /** Blue AI when watching. */
  bluePersonality: Personality;
  difficulty: Difficulty;
  seed: number;
}

export interface Alert { text: string; tone: 'info' | 'good' | 'bad'; at: number }

export interface Summary {
  winner: Team | 'draw';
  playerTeam: Team | null;
  seconds: number;
  world: World;
}

const STEP_MS = 1000 / TICK_RATE;

export class Game implements InputTarget {
  world: World;
  camera = new Camera();
  effects = new Effects();
  sound: Sound;
  renderer: Renderer;
  ais: Commander[] = [];
  playerTeam: Team | null;
  selection = new Set<number>();
  ghost: Ghost | null = null;
  attackMode = false;
  markers: Marker[] = [];
  alerts: Alert[] = [];
  speed = 1;
  paused = false;
  onEnd: ((s: Summary) => void) | null = null;
  onChange: (() => void) | null = null;

  private ctx: CanvasRenderingContext2D;
  private mini: CanvasRenderingContext2D;
  private input: Input;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private time = 0;
  private frame = 0;
  private box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private keys = new Set<string>();
  private lastAlert = new Map<string, number>();
  private ended = false;
  private hoverAt: [number, number] | null = null;

  constructor(private canvas: HTMLCanvasElement, minimap: HTMLCanvasElement, readonly opts: GameOptions, sound: Sound) {
    this.sound = sound;
    this.world = createWorld(getMap(opts.mapId), opts.seed);
    this.playerTeam = opts.mode === 'play' ? 0 : null;
    if (opts.mode === 'watch') this.ais.push(new Commander(0, opts.bluePersonality, opts.difficulty, opts.seed));
    this.ais.push(new Commander(1, opts.personality, opts.difficulty, opts.seed + 1));
    this.ctx = canvas.getContext('2d')!;
    this.mini = minimap.getContext('2d')!;
    this.renderer = new Renderer(this.ctx, this.world.map);
    this.input = new Input(canvas, this);
    this.resize();
    const home = this.world.map.starts[this.playerTeam ?? 0];
    this.camera.x = this.opts.mode === 'watch' ? this.world.map.width / 2 : home.tx + 4;
    this.camera.y = this.opts.mode === 'watch' ? this.world.map.height / 2 : home.ty - 2;
    this.camera.zoom = this.opts.mode === 'watch'
      ? Math.min(this.camera.w / (this.world.map.width * 32), this.camera.h / (this.world.map.height * 32)) * 1.6
      : Math.max(0.7, Math.min(1.3, Math.min(this.camera.w, this.camera.h) / (32 * 13)));
    if (opts.mode === 'watch') this.speed = 2;
  }

  // ------------------------------------------------------------ lifecycle

  start(): void {
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.update(Math.min(250, now - this.last));
      this.last = now;
    };
    this.raf = requestAnimationFrame(loop);
    window.addEventListener('resize', this.resize);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.input.destroy();
    window.removeEventListener('resize', this.resize);
  }

  resize = (): void => {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.camera.w = r.width;
    this.camera.h = r.height;
  };

  private update(ms: number): void {
    this.time += ms;
    this.frame++;
    if (!this.paused && !this.ended) {
      this.acc += ms * this.speed;
      let steps = 0;
      while (this.acc >= STEP_MS && steps < 10 && !this.ended) {
        for (const ai of this.ais) ai.think(this.world);
        step(this.world);
        this.handleEvents(this.world.events);
        this.acc -= STEP_MS;
        steps++;
      }
      if (steps === 10) this.acc = 0;
      this.effects.update(ms);
    }
    for (const m of this.markers) m.age += ms;
    this.markers = this.markers.filter((m) => m.age < 600);
    this.alerts = this.alerts.filter((a) => this.time - a.at < 4000);

    // keyboard panning
    const panSpeed = 0.8 * ms;
    if (this.keys.has('arrowleft') || this.keys.has('a')) this.camera.panPixels(panSpeed, 0);
    if (this.keys.has('arrowright') || this.keys.has('d')) this.camera.panPixels(-panSpeed, 0);
    if (this.keys.has('arrowup') || this.keys.has('w')) this.camera.panPixels(0, panSpeed);
    if (this.keys.has('arrowdown') || this.keys.has('s')) this.camera.panPixels(0, -panSpeed);
    this.camera.clamp(this.world.map.width, this.world.map.height);

    // Prune dead units from the selection.
    for (const id of this.selection) if (!this.world.byId.has(id)) this.selection.delete(id);
    if (this.ghost) this.refreshGhost();

    const state = {
      world: this.world, camera: this.camera, playerTeam: this.playerTeam, selection: this.selection,
      ghost: this.ghost, markers: this.markers, effects: this.effects, alpha: this.paused ? 0 : this.acc / STEP_MS,
      time: this.time, box: this.box,
    };
    this.renderer.draw(state);
    if (this.frame % 3 === 0) this.renderer.drawMinimap(this.mini, state);
    this.onChange?.();
  }

  private onScreen = (x: number, y: number) => {
    const v = this.camera.view(1);
    return x > v.x0 && x < v.x1 && y > v.y0 && y < v.y1;
  };

  private visibleToPlayer(x: number, y: number): boolean {
    if (this.playerTeam === null) return true;
    const m = this.world.map;
    const i = Math.floor(y) * m.width + Math.floor(x);
    return this.world.visible[this.playerTeam][i] === 1;
  }

  alert(text: string, tone: Alert['tone'], key = text, cooldown = 0): void {
    const last = this.lastAlert.get(key) ?? -Infinity;
    if (this.time - last < cooldown) return;
    this.lastAlert.set(key, this.time);
    this.alerts.push({ text, tone, at: this.time });
    if (this.alerts.length > 3) this.alerts.shift();
  }

  private handleEvents(events: SimEvent[]): void {
    const me = this.playerTeam;
    for (const ev of events) {
      const visible = ev.e === 'shot' ? this.visibleToPlayer(ev.x0, ev.y0) || this.visibleToPlayer(ev.x1, ev.y1)
        : 'x' in ev ? this.visibleToPlayer(ev.x, ev.y) : true;
      if (visible) this.effects.handle(ev, me, this.onScreen);
      switch (ev.e) {
        case 'shot': if (visible && this.onScreen(ev.x0, ev.y0)) this.sound.shot(ev.type); break;
        case 'death': if (visible && this.onScreen(ev.x, ev.y)) this.sound.boom(ev.big); break;
        case 'impact': if (visible && this.onScreen(ev.x, ev.y)) this.sound.boom(false); break;
        case 'deposit': if (ev.team === me && this.onScreen(ev.x, ev.y)) this.sound.ui('deposit'); break;
        case 'built':
          if (ev.team === me) { this.alert(`${BUILDINGS[ev.kind].name} complete`, 'good'); this.sound.ui('built'); }
          break;
        case 'spawn':
          if (ev.team === me) { this.alert(`${UNITS[ev.kind].name} ready`, 'info', 'spawn', 1500); this.sound.ui('ready'); }
          break;
        case 'underAttack':
          if (ev.team === me) {
            const key = 'attack';
            if (this.time - (this.lastAlert.get(key) ?? -1e9) > 12000) {
              this.alert(this.onScreen(ev.x, ev.y) ? 'We are under attack!' : 'Under attack off-screen! Tap the minimap', 'bad', key, 12000);
              this.sound.ui('alert');
            }
          }
          break;
        case 'rankUp': {
          const u = this.world.byId.get(ev.id);
          if (isUnit(u) && visible) this.effects.rankUp(u.x, u.y, ev.team, ev.rank);
          if (ev.team === me) this.alert(`${u && isUnit(u) ? UNITS[u.kind].name : 'Unit'} promoted ${ev.rank > 1 ? '★★' : '★'}`, 'good');
          break;
        }
        case 'gameOver':
          this.ended = true;
          if (me !== null) this.sound.ui(ev.winner === me ? 'win' : 'lose');
          setTimeout(() => this.onEnd?.({ winner: ev.winner, playerTeam: me, seconds: this.world.tick / TICK_RATE, world: this.world }), 1800);
          break;
      }
    }
  }

  // ------------------------------------------------------------ queries for the HUD

  selectedUnits(): Unit[] {
    const out: Unit[] = [];
    for (const id of this.selection) {
      const e = this.world.byId.get(id);
      if (isUnit(e)) out.push(e);
    }
    return out;
  }

  selectedBuilding() {
    for (const id of this.selection) {
      const e = this.world.byId.get(id);
      if (isBuilding(e)) return e;
    }
    return null;
  }

  // ------------------------------------------------------------ actions

  train(buildingId: number, kind: UnitKind): void {
    if (this.playerTeam === null) return;
    if (this.world.teams[this.playerTeam].scrap < UNITS[kind].cost) { this.sound.ui('error'); this.alert('Not enough scrap', 'bad', 'scrap', 1500); return; }
    issue(this.world, { t: 'train', team: this.playerTeam, building: buildingId, kind });
    this.sound.ui('order');
  }

  cancel(buildingId: number): void {
    if (this.playerTeam === null) return;
    issue(this.world, { t: 'cancel', team: this.playerTeam, building: buildingId });
  }

  beginPlacement(kind: BuildingKind): void {
    if (this.playerTeam === null) return;
    const def = BUILDINGS[kind];
    if (this.world.teams[this.playerTeam].scrap < def.cost) { this.sound.ui('error'); this.alert('Not enough scrap', 'bad', 'scrap', 1500); return; }
    this.selection.clear();
    // Suggest a good spot near the camera (or the HQ) so on a phone it's one more tap.
    const hq = this.world.buildings.find((b) => b.team === this.playerTeam && b.kind === 'hq');
    const cx = hq ? hq.tx + 1.5 : this.camera.x, cy = hq ? hq.ty + 1.5 : this.camera.y;
    let best: { tx: number; ty: number } | null = null, bestD = Infinity;
    for (let dy = -9; dy <= 9; dy++)
      for (let dx = -9; dx <= 9; dx++) {
        const tx = Math.round(cx + dx - def.size / 2), ty = Math.round(cy + dy - def.size / 2);
        if (placementError(this.world, this.playerTeam, kind, tx, ty)) continue;
        // Keep a one-tile lane around big buildings so harvesters aren't walled in.
        if (kind !== 'turret' && !this.laneClear(tx, ty, def.size)) continue;
        const d = Math.hypot(dx, dy) + Math.hypot(tx - this.camera.x, ty - this.camera.y) * 0.3;
        if (d < bestD) { bestD = d; best = { tx, ty }; }
      }
    const spot = best ?? { tx: Math.round(this.camera.x), ty: Math.round(this.camera.y) };
    this.ghost = { kind, tx: spot.tx, ty: spot.ty, error: null };
    this.refreshGhost();
    if (best) { this.camera.x = best.tx + def.size / 2; this.camera.y = best.ty + def.size / 2 + 1; }
  }

  private laneClear(tx: number, ty: number, size: number): boolean {
    const w = this.world.map.width, h = this.world.map.height;
    for (let y = ty - 1; y <= ty + size; y++)
      for (let x = tx - 1; x <= tx + size; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (this.world.occupancy[y * w + x] || this.world.crystalAt[y * w + x]) return false;
      }
    return true;
  }

  private refreshGhost() {
    if (!this.ghost || this.playerTeam === null) return;
    this.ghost.error = placementError(this.world, this.playerTeam, this.ghost.kind, this.ghost.tx, this.ghost.ty);
  }

  cancelPlacement(): void {
    this.ghost = null;
  }

  confirmPlacement(): void {
    if (!this.ghost || this.playerTeam === null) return;
    this.refreshGhost();
    if (this.ghost.error) { this.sound.ui('error'); return; }
    issue(this.world, { t: 'build', team: this.playerTeam, kind: this.ghost.kind, tx: this.ghost.tx, ty: this.ghost.ty });
    this.sound.ui('order');
    this.ghost = null;
  }

  selectArmy(): void {
    if (this.playerTeam === null) return;
    this.selection.clear();
    for (const u of this.world.units) if (u.team === this.playerTeam && u.kind !== 'mule') this.selection.add(u.id);
    if (this.selection.size) this.sound.ui('select');
  }

  selectIdleHarvester(): void {
    if (this.playerTeam === null) return;
    const mules = this.world.units.filter((u) => u.team === this.playerTeam && u.kind === 'mule');
    const idle = mules.find((u) => u.order.type === 'idle') ?? mules[0];
    if (!idle) return;
    this.selection = new Set([idle.id]);
    this.camera.x = idle.x; this.camera.y = idle.y;
    this.sound.ui('select');
  }

  stopSelected(): void {
    if (this.playerTeam === null) return;
    const ids = this.selectedUnits().map((u) => u.id);
    if (ids.length) issue(this.world, { t: 'stop', team: this.playerTeam, ids });
  }

  deselect(): void {
    this.selection.clear();
    this.attackMode = false;
  }

  toggleAttackMode(): void {
    this.attackMode = !this.attackMode;
  }

  jumpTo(x: number, y: number): void {
    this.camera.x = x;
    this.camera.y = y;
  }

  // ------------------------------------------------------------ input intents

  private pick(wx: number, wy: number) {
    const w = this.world;
    let best: { id: number; d: number } | null = null;
    for (const u of w.units) {
      if (!this.renderer.canSee({ world: w, playerTeam: this.playerTeam }, u)) continue;
      const air = UNITS[u.kind].layer === 'air';
      const d = Math.hypot(u.x - wx, u.y - (air ? 0.55 : 0) - wy);
      const r = UNITS[u.kind].radius + (this.camera.zoom < 0.9 ? 0.45 : 0.3);
      if (d < r && (!best || d < best.d)) best = { id: u.id, d };
    }
    if (best) return w.byId.get(best.id)!;
    const tx = Math.floor(wx), ty = Math.floor(wy);
    if (tx >= 0 && ty >= 0 && tx < w.map.width && ty < w.map.height) {
      const bid = w.occupancy[ty * w.map.width + tx];
      const b = bid && w.byId.get(bid);
      if (b && this.renderer.canSee({ world: w, playerTeam: this.playerTeam }, b)) return b;
      const cid = w.crystalAt[ty * w.map.width + tx];
      if (cid) return w.crystalById.get(cid)!;
    }
    return null;
  }

  tap(sx: number, sy: number, kind: TapKind, shift: boolean): void {
    this.sound.unlock();
    const [wx, wy] = this.camera.toWorld(sx, sy);
    if (this.ghost) {
      const size = BUILDINGS[this.ghost.kind].size;
      if (kind === 'right') { this.cancelPlacement(); return; }
      const inside = wx >= this.ghost.tx && wx < this.ghost.tx + size && wy >= this.ghost.ty && wy < this.ghost.ty + size;
      if (kind === 'touch' && !inside) {
        this.ghost.tx = Math.round(wx - size / 2);
        this.ghost.ty = Math.round(wy - size / 2);
        this.refreshGhost();
        return;
      }
      if (kind === 'left') { this.ghost.tx = Math.round(wx - size / 2); this.ghost.ty = Math.round(wy - size / 2); }
      this.confirmPlacement();
      return;
    }
    if (this.playerTeam === null) return;
    const hit = this.pick(wx, wy);
    const mine = hit && 'team' in hit && hit.team === this.playerTeam;
    const units = this.selectedUnits();

    if (kind === 'right') { this.order(hit, wx, wy); return; }
    if (mine) {
      this.select((hit as { id: number }).id, shift);
      return;
    }
    if (kind === 'left') {
      if (!shift) this.deselect();
      return;
    }
    // touch on non-own thing / ground
    if (units.length) { this.order(hit, wx, wy); return; }
    const b = this.selectedBuilding();
    if (b && BUILDINGS[b.kind].trains) {
      issue(this.world, { t: 'rally', team: this.playerTeam, building: b.id, x: wx, y: wy });
      this.markers.push({ x: wx, y: wy, age: 0, attack: false });
      this.sound.ui('order');
      return;
    }
    this.deselect();
  }

  private select(id: number, additive: boolean) {
    const e = this.world.byId.get(id);
    if (!e) return;
    if (isBuilding(e)) this.selection = new Set([id]);
    else if (additive) {
      if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id);
      for (const s of [...this.selection]) if (isBuilding(this.world.byId.get(s))) this.selection.delete(s);
    } else this.selection = new Set([id]);
    this.attackMode = false;
    this.sound.ui('select');
  }

  private order(hit: ReturnType<Game['pick']>, wx: number, wy: number) {
    const team = this.playerTeam;
    if (team === null) return;
    const units = this.selectedUnits();
    if (!units.length) {
      const b = this.selectedBuilding();
      if (b && BUILDINGS[b.kind].trains) {
        issue(this.world, { t: 'rally', team, building: b.id, x: wx, y: wy });
        this.markers.push({ x: wx, y: wy, age: 0, attack: false });
        this.sound.ui('order');
      }
      return;
    }
    const ids = units.map((u) => u.id);
    if (hit && 'team' in hit && hit.team !== team) {
      issue(this.world, { t: 'attack', team, ids, target: hit.id });
      const p = isBuilding(hit) ? { x: hit.tx + hit.size / 2, y: hit.ty + hit.size / 2 } : { x: hit.x, y: hit.y };
      this.markers.push({ x: p.x, y: p.y, age: 0, attack: true });
    } else if (hit && 'amount' in hit) {
      const mules = units.filter((u) => u.kind === 'mule').map((u) => u.id);
      const others = units.filter((u) => u.kind !== 'mule').map((u) => u.id);
      if (mules.length) issue(this.world, { t: 'harvest', team, ids: mules, crystal: hit.id });
      if (others.length) issue(this.world, { t: 'move', team, ids: others, x: wx, y: wy, attack: this.attackMode });
      this.markers.push({ x: wx, y: wy, age: 0, attack: false });
    } else {
      issue(this.world, { t: 'move', team, ids, x: wx, y: wy, attack: this.attackMode });
      this.markers.push({ x: wx, y: wy, age: 0, attack: this.attackMode });
    }
    this.attackMode = false;
    this.sound.ui('order');
  }

  doubleTap(sx: number, sy: number): void {
    if (this.playerTeam === null) return;
    const [wx, wy] = this.camera.toWorld(sx, sy);
    const hit = this.pick(wx, wy);
    if (!hit || 'amount' in hit || !isUnit(hit) || hit.team !== this.playerTeam) { this.tap(sx, sy, 'touch', false); return; }
    const v = this.camera.view(0);
    this.selection = new Set(
      this.world.units.filter((u) => u.team === this.playerTeam && u.kind === hit.kind && u.x > v.x0 && u.x < v.x1 && u.y > v.y0 && u.y < v.y1).map((u) => u.id),
    );
    this.sound.ui('select');
  }

  setBox(box: { x0: number; y0: number; x1: number; y1: number } | null): void {
    this.box = box;
  }

  boxSelect(x0: number, y0: number, x1: number, y1: number, shift: boolean): void {
    if (this.playerTeam === null) return;
    const [ax, ay] = this.camera.toWorld(Math.min(x0, x1), Math.min(y0, y1));
    const [bx, by] = this.camera.toWorld(Math.max(x0, x1), Math.max(y0, y1));
    const inBox = this.world.units.filter((u) => u.team === this.playerTeam && u.x >= ax && u.x <= bx && u.y - (UNITS[u.kind].layer === 'air' ? 0.55 : 0) >= ay && u.y - (UNITS[u.kind].layer === 'air' ? 0.55 : 0) <= by);
    // Grab the army; harvesters only if they're all that's in the box.
    const army = inBox.filter((u) => u.kind !== 'mule');
    const pick = army.length ? army : inBox;
    if (!shift) this.selection.clear();
    for (const s of [...this.selection]) if (isBuilding(this.world.byId.get(s))) this.selection.delete(s);
    for (const u of pick) this.selection.add(u.id);
    if (pick.length) this.sound.ui('select');
  }

  pan(dx: number, dy: number): void {
    this.camera.panPixels(dx, dy);
  }

  zoom(factor: number, sx: number, sy: number): void {
    this.camera.zoomAt(factor, sx, sy);
  }

  hover(sx: number, sy: number): void {
    this.hoverAt = [sx, sy];
    if (this.ghost) {
      const [wx, wy] = this.camera.toWorld(sx, sy);
      const size = BUILDINGS[this.ghost.kind].size;
      this.ghost.tx = Math.round(wx - size / 2);
      this.ghost.ty = Math.round(wy - size / 2);
    }
  }

  key(key: string, down: boolean, shift: boolean): void {
    const k = key.toLowerCase();
    if (!down) { this.keys.delete(k); return; }
    this.keys.add(k);
    if (k === 'escape') { if (this.ghost) this.cancelPlacement(); else this.deselect(); }
    if (k === 'q') this.toggleAttackMode();
    if (k === 'x') this.stopSelected();
    if (k === ' ') this.selectArmy();
    if (k === 'h') {
      const hq = this.world.buildings.find((b) => b.team === this.playerTeam && b.kind === 'hq');
      if (hq) this.jumpTo(hq.tx + 1.5, hq.ty + 1.5);
    }
    if (k === 'p') this.paused = !this.paused;
    void shift;
    void this.hoverAt;
  }
}
