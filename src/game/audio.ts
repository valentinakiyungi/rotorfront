// Every sound is synthesised live with WebAudio: no audio files to ship.
import type { DamageType } from '../sim';

const PREF_KEY = 'rotorfront.sound';

/** A tenth of a second of silence as a WAV file, built in memory. */
function silentWav(): string {
  const n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private recent = new Map<string, number>();
  private unmuter: HTMLAudioElement | null = null;
  private _enabled = true;

  constructor() {
    try { this._enabled = localStorage.getItem(PREF_KEY) !== 'off'; } catch { /* storage blocked */ }
    // Browsers only allow audio to start inside a user gesture. Listen to every
    // kind of gesture, all the time: iPhones also suspend audio when the screen
    // locks or you switch apps, and the next tap has to wake it up again.
    const wake = () => this.unlock();
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
      document.addEventListener(type, wake, { capture: true, passive: true });
    }
  }

  get enabled(): boolean { return this._enabled; }
  set enabled(on: boolean) {
    this._enabled = on;
    try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch { /* storage blocked */ }
    if (on) this.unlock();
  }

  /** Creates or wakes the audio engine. Only works from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    // iPhone: play through the speaker even when the ring/silent switch is on.
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    try { if (nav.audioSession) nav.audioSession.type = 'playback'; } catch { /* unsupported */ }
    // Older iOS: a moment of HTML audio does the same thing.
    try {
      this.unmuter = new Audio(silentWav());
      this.unmuter.setAttribute('playsinline', '');
      void this.unmuter.play().catch(() => {});
    } catch { /* unsupported */ }

    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(comp);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
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

  ui(kind: 'click' | 'start' | 'select' | 'order' | 'error' | 'built' | 'deposit' | 'alert' | 'ready' | 'win' | 'lose'): void {
    if (!this.ready() || !this.throttle('ui' + kind, kind === 'deposit' ? 150 : 90)) return;
    switch (kind) {
      case 'click': this.tone(1200, 0.04, 0.08, 'triangle'); break;
      case 'start': [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.22, 0.13, 'triangle', i * 0.09)); this.burst(0.6, 600, 0.6, 0.3, 'lowpass', 60); break;
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
