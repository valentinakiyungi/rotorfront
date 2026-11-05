// Menu, pause and after-action screens.
import { DIFFICULTIES, MAPS, PERSONALITIES, UNITS, type Difficulty, type Personality, type Team, type UnitKind } from '../sim';
import type { GameOptions, Summary } from '../game/game';
import { TEAM } from '../game/palette';
import { renderTerrain, unitIcon } from '../game/render';

const PREFS_KEY = 'rotorfront.prefs';

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

function choice<T extends string>(label: string, options: { id: T; label: string; blurb?: string; html?: string }[], current: T, onPick: (id: T) => void): HTMLElement {
  const wrap = document.createElement('section');
  wrap.innerHTML = `<h3>${label}</h3>`;
  const row = document.createElement('div');
  row.className = 'choices';
  const blurb = document.createElement('p');
  blurb.className = 'blurb';
  for (const o of options) {
    const b = document.createElement('button');
    b.className = 'choice' + (o.id === current ? ' on' : '');
    b.innerHTML = o.html ?? o.label;
    b.onclick = () => {
      row.querySelectorAll('.choice').forEach((c) => c.classList.remove('on'));
      b.classList.add('on');
      blurb.textContent = o.blurb ?? '';
      onPick(o.id);
    };
    row.append(b);
  }
  wrap.append(row);
  const cur = options.find((o) => o.id === current);
  if (options.some((o) => o.blurb)) { blurb.textContent = cur?.blurb ?? ''; wrap.append(blurb); }
  return wrap;
}

export function showMenu(onStart: (o: GameOptions) => void): void {
  const prefs = loadPrefs();
  const o = overlay('menu');
  const card = document.createElement('div');
  card.className = 'menu-card';
  card.innerHTML = `
    <header>
      <div class="logo"><span>ROTOR</span>FRONT</div>
      <p>Drones and robot tanks fight over crystal fields. Mine, build, out-think the enemy commander, and take out their HQ.</p>
      <div class="roster">${(['skiff', 'ram', 'thistle', 'howler', 'dart', 'kestrel'] as UnitKind[]).map((k) => `<img src="${unitIcon(k, 0, 56)}" title="${UNITS[k].name}: ${UNITS[k].role}" alt="${UNITS[k].name}">`).join('')}</div>
    </header>`;

  const maps = choice('Map', MAPS.map((m) => {
    const t = renderTerrain(m.build(), 3);
    return { id: m.id, label: m.name, blurb: m.blurb, html: `<img class="mapthumb" src="${t.toDataURL()}" alt=""><span>${m.name}</span>` };
  }), prefs.mapId, (id) => (prefs.mapId = id));

  const mode = choice<'play' | 'watch'>('Mode', [
    { id: 'play', label: 'Play vs AI', blurb: 'You command Blue (bottom left).' },
    { id: 'watch', label: 'Watch AI vs AI', blurb: 'Two AI commanders fight it out. Great for learning the counters.' },
  ], prefs.mode, (id) => { prefs.mode = id; blueSel.style.display = id === 'watch' ? '' : 'none'; });

  const pers = (Object.keys(PERSONALITIES) as Personality[]).map((id) => ({ id, label: PERSONALITIES[id].label, blurb: PERSONALITIES[id].blurb }));
  const blueSel = choice<Personality>('Blue commander', pers, prefs.bluePersonality, (id) => (prefs.bluePersonality = id));
  blueSel.style.display = prefs.mode === 'watch' ? '' : 'none';
  const redSel = choice<Personality>('Enemy commander', pers, prefs.personality, (id) => (prefs.personality = id));
  const diff = choice<Difficulty>('Difficulty', (Object.keys(DIFFICULTIES) as Difficulty[]).map((id) => ({ id, label: DIFFICULTIES[id].label })), prefs.difficulty, (id) => (prefs.difficulty = id));

  const go = document.createElement('button');
  go.className = 'start';
  go.textContent = 'Deploy ▸';
  go.onclick = () => {
    prefs.seed = (Date.now() % 100000) + 1;
    savePrefs(prefs);
    o.remove();
    onStart({ ...prefs });
  };
  card.append(maps, mode, blueSel, redSel, diff, go);
  o.append(card);
}

export function showPause(opts: { onResume: () => void; onQuit: () => void; soundOn: boolean; onSound: (on: boolean) => void }): void {
  const o = overlay('pause');
  o.innerHTML = `<div class="menu-card small">
    <h2>Paused</h2>
    <div class="stack">
      <button class="start" data-a="resume">Resume</button>
      <button class="choice" data-a="sound">Sound: ${opts.soundOn ? 'on' : 'off'}</button>
      <button class="choice" data-a="quit">Quit to menu</button>
    </div>
    <h3>How to play</h3>
    <ul class="help">
      <li><b>Mules</b> mine crystals and bring scrap home. More Mules, more scrap — but they cost 150 each.</li>
      <li>Build a <b>Foundry</b> for tanks, then an <b>Aerie</b> for drones. <b>Depots</b> are forward drop-offs; <b>Turrets</b> hit ground and air.</li>
      <li>Counters: Skiff beats Howler &amp; Thistle · Ram beats Skiff · Dart beats Ram &amp; Howler · Thistle &amp; Kestrel beat drones.</li>
      <li>Howler shells are slow: move out of the red circle.</li>
      <li>Woods give cover (−20% damage) but slow tanks down; roads are fast.</li>
      <li>Units with kills earn ★ ranks and hit harder.</li>
    </ul>
  </div>`;
  o.querySelector<HTMLButtonElement>('[data-a=resume]')!.onclick = () => { o.remove(); opts.onResume(); };
  o.querySelector<HTMLButtonElement>('[data-a=quit]')!.onclick = () => { o.remove(); opts.onQuit(); };
  const s = o.querySelector<HTMLButtonElement>('[data-a=sound]')!;
  let on = opts.soundOn;
  s.onclick = () => { on = !on; s.textContent = `Sound: ${on ? 'on' : 'off'}`; opts.onSound(on); };
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
    <div class="stack row">
      <button class="start" data-a="again">Rematch</button>
      <button class="choice" data-a="menu">Menu</button>
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
