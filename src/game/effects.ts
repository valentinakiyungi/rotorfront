// Short-lived visual effects driven by simulation events. Purely cosmetic:
// they live in real time (ms) and never feed back into the simulation.
import type { DamageType, SimEvent, Team } from '../sim';
import { CRYSTAL, SCRAP, TEAM } from './palette';

export interface Tracer { x0: number; y0: number; x1: number; y1: number; color: string; age: number; life: number; width: number }
export interface Particle { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; color: string; kind: 'fire' | 'smoke' | 'spark' | 'ring' }
export interface FloatText { x: number; y: number; text: string; color: string; age: number; life: number }

const SHOT_COLORS: Record<DamageType, string> = {
  bullet: '#ffe28a', cannon: '#ffb347', shell: '#ff9a3c', missile: '#ff7b5a', flak: '#9fe6ff', turret: '#ffe28a',
};

let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

export class Effects {
  tracers: Tracer[] = [];
  particles: Particle[] = [];
  texts: FloatText[] = [];
  shake = 0;

  handle(ev: SimEvent, playerTeam: Team | null, onScreen: (x: number, y: number) => boolean): void {
    switch (ev.e) {
      case 'shot': {
        if (!onScreen(ev.x0, ev.y0) && !onScreen(ev.x1, ev.y1)) return;
        if (ev.type === 'shell') { this.burst(ev.x0, ev.y0, 3, '#ffd28a', 'spark', 0.6); return; }
        const life = ev.type === 'missile' ? 160 : 90;
        this.tracers.push({ x0: ev.x0, y0: ev.y0, x1: ev.x1, y1: ev.y1, color: SHOT_COLORS[ev.type], age: 0, life, width: ev.type === 'cannon' ? 3 : 1.6 });
        this.burst(ev.x1, ev.y1, 2, SHOT_COLORS[ev.type], 'spark', 0.5);
        return;
      }
      case 'impact':
        this.explosion(ev.x, ev.y, 0.6 + ev.splash * 0.5, false);
        if (onScreen(ev.x, ev.y)) this.shake = Math.max(this.shake, 2);
        return;
      case 'death':
        this.explosion(ev.x, ev.y, ev.big ? 1.4 : 0.9, true);
        if (onScreen(ev.x, ev.y)) this.shake = Math.max(this.shake, ev.big ? 6 : 3);
        return;
      case 'deposit':
        if (ev.team === playerTeam) this.texts.push({ x: ev.x, y: ev.y - 1, text: `+${ev.amount}`, color: SCRAP, age: 0, life: 1200 });
        return;
      case 'rankUp':
        // positioned by the renderer, which knows where the unit is
        return;
      default:
        return;
    }
  }

  rankUp(x: number, y: number, team: Team, rank: number): void {
    this.texts.push({ x, y: y - 0.8, text: rank > 1 ? '★★' : '★', color: TEAM[team].light, age: 0, life: 1500 });
  }

  explosion(x: number, y: number, size: number, debris: boolean): void {
    this.particles.push({ x, y, vx: 0, vy: 0, age: 0, life: 380, size: size * 1.4, color: '#fff3c4', kind: 'ring' });
    this.burst(x, y, Math.round(8 * size), '#ffb347', 'fire', size);
    this.burst(x, y, Math.round(5 * size), '#555', 'smoke', size);
    if (debris) this.burst(x, y, Math.round(6 * size), '#ffd27a', 'spark', size * 1.6);
  }

  crystalSpark(x: number, y: number, rich: boolean): void {
    this.burst(x, y, 1, rich ? CRYSTAL.rich : CRYSTAL.main, 'spark', 0.3);
  }

  burst(x: number, y: number, n: number, color: string, kind: Particle['kind'], power: number): void {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const sp = (kind === 'spark' ? 3 : kind === 'smoke' ? 0.6 : 1.4) * power * (0.4 + rand());
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0,
        life: kind === 'smoke' ? 900 + rand() * 600 : kind === 'fire' ? 350 + rand() * 250 : 220 + rand() * 200,
        size: (kind === 'smoke' ? 0.35 : kind === 'fire' ? 0.28 : 0.06) * (0.6 + rand()) * Math.max(0.6, power),
        color, kind,
      });
    }
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
  }

  update(ms: number): void {
    const dt = ms / 1000;
    for (const t of this.tracers) t.age += ms;
    this.tracers = this.tracers.filter((t) => t.age < t.life);
    for (const p of this.particles) {
      p.age += ms;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = p.kind === 'spark' ? 0.9 : 0.94;
      p.vx *= drag;
      p.vy *= drag;
      if (p.kind === 'smoke') p.vy -= 0.4 * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const t of this.texts) { t.age += ms; t.y -= 0.7 * dt; }
    this.texts = this.texts.filter((t) => t.age < t.life);
    this.shake *= Math.pow(0.0015, dt);
    if (this.shake < 0.1) this.shake = 0;
  }
}
