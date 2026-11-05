// Main menu, How to play, pause and after-action screens.
import { DIFFICULTIES, MAPS, PERSONALITIES, UNITS, type Difficulty, type Personality, type Team, type UnitKind } from '../sim';
import type { GameOptions, Summary } from '../game/game';
import { TEAM } from '../game/palette';
import { renderTerrain, unitIcon } from '../game/render';

const PREFS_KEY = 'rotorfront.prefs';

const MAP_TAGS: Record<string, string> = { proving: 'Open', fords: 'River', badlands: 'Mesas' };

function loadPrefs(): GameOptions {
  const defaults: GameOptions = { mapId: 'proving', mode: 'play', personality: 'balanced', bluePersonality: 'rush', difficulty: 'easy', seed: 1 };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

function savePrefs(p: GameOptions) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

function overlay(cls: string): HTMLElement {
  const o = document.createElement('div');
  o.className = `overlay ${cls}`;
  document.getElementById('app')!.append(o);
  return o;
}

/** A row of mutually exclusive buttons (a segmented control). */
function segmented<T extends string>(label: string, options: { id: T; label: string }[], current: T, onPick: (id: T) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'seg';
  row.setAttribute('role', 'radiogroup');
  row.setAttribute('aria-label', label);
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = o.label;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(o.id === current));
    b.onclick = () => {
      row.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', 'false'));
      b.setAttribute('aria-checked', 'true');
      onPick(o.id);
    };
    row.append(b);
  }
  return row;
}

let thumbs: Map<string, { url: string; w: number; h: number }> | null = null;
function mapThumbs() {
  if (!thumbs) {
    thumbs = new Map();
    for (const m of MAPS) {
      const map = m.build();
      thumbs.set(m.id, { url: renderTerrain(map, 3).toDataURL(), w: map.width, h: map.height });
    }
  }
  return thumbs;
}

export function showMenu(onStart: (o: GameOptions) => void): void {
  const prefs = loadPrefs();
  const o = overlay('menu');
  const screen = document.createElement('div');
  screen.className = 'menu-screen';

  // Title
  const head = document.createElement('header');
  head.className = 'title';
  head.innerHTML = `
    <h1 class="logo"><span>ROTOR</span><span>FRONT</span></h1>
    <div class="roster" aria-hidden="true">${(['skiff', 'ram', 'thistle', 'howler', 'dart', 'kestrel'] as UnitKind[])
      .map((k) => `<img src="${unitIcon(k, 0, 56)}" alt="">`).join('')}</div>
    <p class="tagline">Mine crystal. Build your army. Destroy the enemy HQ.</p>`;

  // Map carousel
  const mapBlurb = document.createElement('p');
  mapBlurb.className = 'blurb';
  const carWrap = document.createElement('div');
  carWrap.className = 'carousel-wrap';
  const car = document.createElement('div');
  car.className = 'carousel';
  car.setAttribute('role', 'radiogroup');
  car.setAttribute('aria-label', 'Map');
  const th = mapThumbs();
  for (const m of MAPS) {
    const t = th.get(m.id)!;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'map-card';
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(m.id === prefs.mapId));
    card.innerHTML = `<img src="${t.url}" alt=""><b>${m.name}</b><small>${t.w}×${t.h} · ${MAP_TAGS[m.id] ?? ''}</small>`;
    card.onclick = () => {
      car.querySelectorAll('.map-card').forEach((c) => c.setAttribute('aria-checked', 'false'));
      card.setAttribute('aria-checked', 'true');
      prefs.mapId = m.id;
      mapBlurb.textContent = m.blurb;
      if (car.scrollWidth > car.clientWidth + 4) card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    };
    car.append(card);
  }
  const prev = document.createElement('button');
  prev.className = 'chev left';
  prev.textContent = '‹';
  prev.setAttribute('aria-label', 'Previous maps');
  const next = document.createElement('button');
  next.className = 'chev right';
  next.textContent = '›';
  next.setAttribute('aria-label', 'More maps');
  prev.onclick = () => car.scrollBy({ left: -car.clientWidth * 0.8, behavior: 'smooth' });
  next.onclick = () => car.scrollBy({ left: car.clientWidth * 0.8, behavior: 'smooth' });
  const chevrons = () => {
    const overflow = car.scrollWidth > car.clientWidth + 4;
    prev.hidden = !overflow || car.scrollLeft < 4;
    next.hidden = !overflow || car.scrollLeft + car.clientWidth > car.scrollWidth - 4;
  };
  car.addEventListener('scroll', chevrons, { passive: true });
  window.addEventListener('resize', chevrons);
  carWrap.append(car, prev, next);
  mapBlurb.textContent = MAPS.find((m) => m.id === prefs.mapId)?.blurb ?? '';

  // Enemy commander
  const enemyBlurb = document.createElement('p');
  enemyBlurb.className = 'blurb';
  const pers = (Object.keys(PERSONALITIES) as Personality[]).map((id) => ({ id, label: PERSONALITIES[id].label }));
  const enemy = segmented<Personality>('Enemy commander', pers, prefs.personality, (id) => {
    prefs.personality = id;
    enemyBlurb.textContent = `Enemy: ${PERSONALITIES[id].blurb}`;
  });
  enemy.classList.add('four');
  enemyBlurb.textContent = `Enemy: ${PERSONALITIES[prefs.personality].blurb}`;

  // Difficulty
  const diff = segmented<Difficulty>('Difficulty', (Object.keys(DIFFICULTIES) as Difficulty[]).map((id) => ({ id, label: DIFFICULTIES[id].label })), prefs.difficulty, (id) => (prefs.difficulty = id));

  // Play
  const launch = (mode: 'play' | 'watch') => {
    prefs.mode = mode;
    prefs.seed = (Date.now() % 100000) + 1;
    if (mode === 'watch') {
      // Pit the chosen enemy against a different personality.
      const others = (Object.keys(PERSONALITIES) as Personality[]).filter((p) => p !== prefs.personality);
      prefs.bluePersonality = others[prefs.seed % others.length];
    }
    savePrefs(prefs);
    window.removeEventListener('resize', chevrons);
    o.remove();
    onStart({ ...prefs });
  };
  const play = document.createElement('button');
  play.className = 'play-btn';
  play.innerHTML = '<span aria-hidden="true">▶</span> Play';
  play.onclick = () => launch('play');

  const tiles = document.createElement('div');
  tiles.className = 'tiles';
  const watch = document.createElement('button');
  watch.className = 'tile';
  watch.innerHTML = '<span aria-hidden="true">🤖</span> Watch AI vs AI';
  watch.onclick = () => launch('watch');
  const help = document.createElement('button');
  help.className = 'tile';
  help.innerHTML = '<span aria-hidden="true">?</span> How to play';
  help.onclick = () => showHelp();
  tiles.append(watch, help);

  const foot = document.createElement('footer');
  foot.className = 'credits';
  foot.textContent = 'Every sound synthesised live · Inspired by Battle Drones';

  screen.append(head, carWrap, mapBlurb, enemy, enemyBlurb, diff, play, tiles, foot);
  o.append(screen);
  requestAnimationFrame(() => {
    if (car.scrollWidth > car.clientWidth + 4) car.querySelector<HTMLElement>('[aria-checked=true]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    chevrons();
  });
}

export function showHelp(onBack?: () => void): void {
  const o = overlay('help');
  o.innerHTML = `<div class="menu-card small">
    <h2>How to play</h2>
    <h3>Goal</h3>
    <p class="help-p">Destroy the enemy HQ before they destroy yours.</p>
    <h3>Economy</h3>
    <ul class="help">
      <li><b>Mules</b> mine crystals and bring scrap home. More Mules means more scrap, but each one costs 150.</li>
      <li>Purple crystals are rich: they pay 50% more.</li>
      <li>A <b>Depot</b> near a far crystal field shortens the trip home.</li>
    </ul>
    <h3>Building</h3>
    <ul class="help">
      <li>Build a <b>Foundry</b> for tanks, then an <b>Aerie</b> for drones.</li>
      <li><b>Turrets</b> hit both ground and air.</li>
      <li>Tap a building in the bottom row. Tap the map to move the outline, then tap it to build.</li>
    </ul>
    <h3>Counters</h3>
    <ul class="help counters">
      ${([['skiff', 'Howler, Thistle'], ['ram', 'Skiff, buildings'], ['thistle', 'Dart, Kestrel'], ['howler', 'Clumps, Turrets'], ['dart', 'Ram, Howler, Mules'], ['kestrel', 'Dart']] as [UnitKind, string][])
        .map(([k, beats]) => `<li><img src="${unitIcon(k, 0, 40)}" alt=""><b>${UNITS[k].name}</b> beats ${beats}</li>`).join('')}
    </ul>
    <h3>Controls</h3>
    <ul class="help">
      <li><b>Tap</b> a unit to select it. <b>Tap the map</b> to move, or an enemy to attack.</li>
      <li><b>Long-press, then drag</b> to select a group. <b>Double-tap</b> a unit to select all of that type.</li>
      <li><b>Pinch</b> to zoom, <b>drag</b> to pan. Tap the minimap to jump.</li>
      <li>Keyboard: right-click to order, <b>Q</b> attack-move, <b>Space</b> army, <b>X</b> stop, <b>WASD</b> pan, <b>P</b> pause.</li>
    </ul>
    <h3>Tips</h3>
    <ul class="help">
      <li>Howler shells are slow. Move out of the red circle.</li>
      <li>Woods give 20% cover but slow tanks down. Roads are fast.</li>
      <li>Units with kills earn ★ ranks and hit harder.</li>
    </ul>
    <button class="play-btn" data-a="back">Got it</button>
  </div>`;
  o.querySelector<HTMLButtonElement>('[data-a=back]')!.onclick = () => { o.remove(); onBack?.(); };
}

export function showPause(opts: { onResume: () => void; onRestart: () => void; onQuit: () => void; soundOn: boolean; onSound: (on: boolean) => void }): void {
  const o = overlay('pause');
  o.innerHTML = `<div class="menu-card small">
    <h2>Paused</h2>
    <div class="stack">
      <button class="play-btn" data-a="resume"><span aria-hidden="true">▶</span> Resume</button>
      <div class="tiles">
        <button class="tile" data-a="restart"><span aria-hidden="true">↻</span> Restart</button>
        <button class="tile" data-a="sound"></button>
        <button class="tile" data-a="help"><span aria-hidden="true">?</span> How to play</button>
        <button class="tile" data-a="quit"><span aria-hidden="true">⌂</span> Main menu</button>
      </div>
    </div>
  </div>`;
  const s = o.querySelector<HTMLButtonElement>('[data-a=sound]')!;
  let on = opts.soundOn;
  const label = () => (s.innerHTML = `<span aria-hidden="true">${on ? '🔊' : '🔇'}</span> Sound ${on ? 'on' : 'off'}`);
  label();
  s.onclick = () => { on = !on; label(); opts.onSound(on); };
  o.querySelector<HTMLButtonElement>('[data-a=resume]')!.onclick = () => { o.remove(); opts.onResume(); };
  o.querySelector<HTMLButtonElement>('[data-a=restart]')!.onclick = () => { o.remove(); opts.onRestart(); };
  o.querySelector<HTMLButtonElement>('[data-a=quit]')!.onclick = () => { o.remove(); opts.onQuit(); };
  o.querySelector<HTMLButtonElement>('[data-a=help]')!.onclick = () => { o.hidden = true; showHelp(() => (o.hidden = false)); };
}

export function showEnd(s: Summary, onRematch: () => void, onMenu: () => void): void {
  const o = overlay('end');
  const me = s.playerTeam;
  const title = s.winner === 'draw' ? 'Draw' : me === null ? `${TEAM[s.winner].name} wins` : s.winner === me ? 'Victory' : 'Defeat';
  const tone = s.winner === 'draw' || me === null ? 'neutral' : s.winner === me ? 'win' : 'lose';
  const st = s.world.teams;
  const row = (label: string, f: (t: Team) => number | string) =>
    `<tr><th>${label}</th><td style="color:${TEAM[0].main}">${f(0)}</td><td style="color:${TEAM[1].main}">${f(1)}</td></tr>`;
  o.innerHTML = `<div class="menu-card small">
    <h1 class="result ${tone}">${title}</h1>
    <p class="sub">${Math.floor(s.seconds / 60)}:${String(Math.floor(s.seconds % 60)).padStart(2, '0')} on ${s.world.map.name}</p>
    <canvas class="timeline" width="560" height="160"></canvas>
    <table class="stats">
      <tr><th></th><td>Blue</td><td>Red</td></tr>
      ${row('Scrap harvested', (t) => st[t].stats.harvested)}
      ${row('Units built', (t) => st[t].stats.unitsBuilt)}
      ${row('Units lost', (t) => st[t].stats.unitsLost)}
      ${row('Kills', (t) => st[t].stats.kills)}
    </table>
    <div class="stack">
      <button class="play-btn" data-a="again"><span aria-hidden="true">▶</span> Play again</button>
      <div class="tiles"><button class="tile" data-a="menu"><span aria-hidden="true">⌂</span> Main menu</button></div>
    </div>
  </div>`;
  drawTimeline(o.querySelector('canvas')!, st[0].stats.armyValueTimeline, st[1].stats.armyValueTimeline);
  o.querySelector<HTMLButtonElement>('[data-a=again]')!.onclick = () => { o.remove(); onRematch(); };
  o.querySelector<HTMLButtonElement>('[data-a=menu]')!.onclick = () => { o.remove(); onMenu(); };
}

function drawTimeline(c: HTMLCanvasElement, a: number[], b: number[]) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height, pad = 24;
  const max = Math.max(500, ...a, ...b);
  const n = Math.max(a.length, b.length, 2);
  g.fillStyle = 'rgba(255,255,255,0.04)';
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.font = '12px system-ui';
  g.fillText('Army value over time', pad, 16);
  const line = (arr: number[], color: string) => {
    g.strokeStyle = color;
    g.lineWidth = 2.5;
    g.beginPath();
    arr.forEach((v, i) => {
      const x = pad + (i / (n - 1)) * (W - pad * 2);
      const y = H - pad / 2 - (v / max) * (H - pad * 2);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.stroke();
  };
  line(a, TEAM[0].main);
  line(b, TEAM[1].main);
}
