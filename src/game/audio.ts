// Every sound is synthesised live with WebAudio: no audio files to ship.
import type { DamageType } from '../sim';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private recent = new Map<string, number>();
  enabled = true;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Avoid machine-gunning the same sound dozens of times a frame. */
  private throttle(key: string, ms: number): boolean {
    const now = performance.now();
    if ((this.recent.get(key) ?? 0) + ms > now) return false;
    this.recent.set(key, now);
    return true;
  }

  private burst(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass', sweepTo?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start();
    src.stop(ctx.currentTime + dur);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'square', at = 0, slideTo?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + at;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private ready() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  shot(type: DamageType): void {
    if (!this.ready() || !this.throttle('shot' + type, 70)) return;
    switch (type) {
      case 'bullet': case 'turret': this.burst(0.06, 2400, 1.2, 0.25); break;
      case 'cannon': this.burst(0.25, 500, 0.8, 0.5, 'lowpass', 120); break;
      case 'shell': this.burst(0.35, 300, 0.7, 0.45, 'lowpass', 80); break;
      case 'missile': this.burst(0.18, 1500, 2, 0.25, 'bandpass', 400); break;
      case 'flak': this.burst(0.08, 3200, 3, 0.2); break;
    }
  }

  boom(big: boolean): void {
    if (!this.ready() || !this.throttle('boom', 60)) return;
    this.burst(big ? 0.9 : 0.5, big ? 400 : 700, 0.6, big ? 0.8 : 0.5, 'lowpass', 40);
  }

  ui(kind: 'select' | 'order' | 'error' | 'built' | 'deposit' | 'alert' | 'ready' | 'win' | 'lose'): void {
    if (!this.ready() || !this.throttle('ui' + kind, kind === 'deposit' ? 150 : 90)) return;
    switch (kind) {
      case 'select': this.tone(880, 0.06, 0.12, 'square'); this.tone(1320, 0.05, 0.08, 'square', 0.04); break;
      case 'order': this.tone(660, 0.06, 0.12, 'triangle'); this.tone(990, 0.07, 0.1, 'triangle', 0.05); break;
      case 'error': this.tone(180, 0.18, 0.15, 'sawtooth'); break;
      case 'built': [523, 659, 784].forEach((f, i) => this.tone(f, 0.15, 0.12, 'triangle', i * 0.08)); break;
      case 'ready': this.tone(740, 0.08, 0.1, 'triangle'); this.tone(1110, 0.1, 0.1, 'triangle', 0.07); break;
      case 'deposit': this.tone(1568, 0.12, 0.06, 'sine'); this.tone(2093, 0.15, 0.05, 'sine', 0.06); break;
      case 'alert': this.tone(440, 0.18, 0.15, 'square'); this.tone(330, 0.25, 0.15, 'square', 0.2); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 0.14, 'triangle', i * 0.15)); break;
      case 'lose': [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.45, 0.14, 'sawtooth', i * 0.2)); break;
    }
  }
}
