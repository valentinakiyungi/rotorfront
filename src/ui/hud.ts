// The DOM overlay: top bar, alerts, minimap, and the context-sensitive command panel.
import { BUILDINGS, PERSONALITIES, PLACEABLE, UNITS, hasBuilding, type UnitKind } from '../sim';
import type { Game } from '../game/game';
import { TEAM } from '../game/palette';
import { buildingIcon, unitIcon } from '../game/render';

const h = (tag: string, cls = '', html = ''): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Hud {
  root: HTMLElement;
  private scrap: HTMLElement;
  private clock: HTMLElement;
  private speedBtn: HTMLButtonElement;
  private alerts: HTMLElement;
  private context: HTMLElement;
  private buildRow: HTMLElement;
  private sig = '';
  private buildSig = '';
  private alertSig = '';

  constructor(private game: Game, mount: HTMLElement, onPause: () => void) {
    this.root = h('div', 'hud');
    const top = h('div', 'topbar');
    this.scrap = h('div', 'pill scrap');
    this.clock = h('div', 'pill clock');
    this.speedBtn = h('button', 'pill btn') as HTMLButtonElement;
    this.speedBtn.onclick = () => {
      const speeds = game.playerTeam === null ? [1, 2, 4] : [1, 1.5, 2];
      game.speed = speeds[(speeds.indexOf(game.speed) + 1) % speeds.length] ?? 1;
    };
    const pause = h('button', 'pill btn', '❚❚') as HTMLButtonElement;
    pause.setAttribute('aria-label', 'Pause');
    pause.onclick = onPause;
    top.append(this.scrap, this.clock, h('div', 'spacer'), this.speedBtn, pause);

    this.alerts = h('div', 'alerts');
    const miniWrap = h('div', 'minimap');
    const mini = document.getElementById('minimap')!;
    miniWrap.append(mini);
    mini.onpointerdown = (e) => this.miniJump(e as PointerEvent, mini);
    mini.onpointermove = (e) => { if ((e as PointerEvent).buttons) this.miniJump(e as PointerEvent, mini); };

    const panel = h('div', 'panel');
    this.context = h('div', 'context');
    this.buildRow = h('div', 'buildrow');
    panel.append(this.context, this.buildRow);
    this.root.append(top, this.alerts, miniWrap, panel);
    mount.append(this.root);
    this.root.classList.toggle('spectating', game.playerTeam === null);
  }

  private miniJump(e: PointerEvent, mini: HTMLElement) {
    const r = mini.getBoundingClientRect();
    const m = this.game.world.map;
    this.game.jumpTo(((e.clientX - r.left) / r.width) * m.width, ((e.clientY - r.top) / r.height) * m.height);
  }

  destroy(): void {
    // The minimap canvas outlives the HUD: park it back in #app for the next game.
    const mini = document.getElementById('minimap');
    if (mini) document.getElementById('app')!.append(mini);
    this.root.remove();
  }

  update(): void {
    const g = this.game;
    const w = g.world;
    const me = g.playerTeam;
    this.clock.textContent = fmtTime(w.tick / 10) + (g.paused ? ' ❚❚' : '');
    this.speedBtn.textContent = `${g.speed}×`;
    if (me !== null) {
      this.scrap.innerHTML = `<span class="gem"></span><b>${Math.floor(w.teams[me].scrap)}</b>`;
    } else {
      this.scrap.innerHTML = `<span style="color:${TEAM[0].main}">${Math.floor(w.teams[0].scrap)}</span> · <span style="color:${TEAM[1].main}">${Math.floor(w.teams[1].scrap)}</span>`;
    }

    const asig = g.alerts.map((a) => a.text + a.at).join('|');
    if (asig !== this.alertSig) {
      this.alertSig = asig;
      this.alerts.innerHTML = '';
      for (const a of g.alerts) this.alerts.append(h('div', `alert ${a.tone}`, a.text));
    }

    if (me === null) { this.spectatorPanel(); return; }
    this.updateBuildRow();
    this.updateContext();
  }

  private spectatorPanel() {
    const g = this.game;
    const sig = 'spec';
    if (sig === this.sig) return;
    this.sig = sig;
    this.buildRow.innerHTML = '';
    const blue = PERSONALITIES[g.opts.bluePersonality].label, red = PERSONALITIES[g.opts.personality].label;
    this.context.innerHTML = `<div class="hint"><b style="color:${TEAM[0].main}">${blue}</b> vs <b style="color:${TEAM[1].main}">${red}</b> · ${g.opts.difficulty} · pinch or scroll to zoom, drag to pan</div>`;
  }

  private updateBuildRow() {
    const g = this.game;
    const me = g.playerTeam!;
    const scrap = g.world.teams[me].scrap;
    const states = PLACEABLE.map((k) => {
      const def = BUILDINGS[k];
      const locked = def.requires && !hasBuilding(g.world, me, def.requires);
      return `${k}:${locked ? 'L' : scrap >= def.cost ? 'Y' : 'N'}`;
    });
    const idle = g.world.units.some((u) => u.team === me && u.kind === 'mule' && u.order.type === 'idle');
    const sig = states.join(',') + (g.ghost ? 'G' : '') + (idle ? 'I' : '');
    if (sig === this.buildSig) return;
    this.buildSig = sig;
    this.buildRow.innerHTML = '';
    for (const k of PLACEABLE) {
      const def = BUILDINGS[k];
      const locked = def.requires && !hasBuilding(g.world, me, def.requires);
      const b = h('button', 'cmd build' + (locked ? ' locked' : scrap < def.cost ? ' poor' : '')) as HTMLButtonElement;
      b.innerHTML = `<img src="${buildingIcon(k, me)}" alt=""><span class="name">${def.name}</span><span class="cost">${def.cost}</span>`;
      b.title = locked ? `Needs a ${BUILDINGS[def.requires!].name}` : `Build ${def.name}`;
      b.onclick = () => {
        if (locked) { g.alert(`${def.name} needs a ${BUILDINGS[def.requires!].name}`, 'bad', 'lock', 1000); g.sound.ui('error'); return; }
        g.beginPlacement(k);
      };
      this.buildRow.append(b);
    }
    const army = h('button', 'cmd quick', `<span class="glyph">⚔</span><span class="name">Army</span>`) as HTMLButtonElement;
    army.title = 'Select all combat units (Space)';
    army.onclick = () => g.selectArmy();
    const mule = h('button', 'cmd quick' + (idle ? ' attention' : ''), `<img src="${unitIcon('mule', me)}" alt=""><span class="name">${idle ? 'Idle!' : 'Mule'}</span>`) as HTMLButtonElement;
    mule.title = 'Jump to a harvester (idle ones first)';
    mule.onclick = () => g.selectIdleHarvester();
    this.buildRow.append(army, mule);
  }

  private updateContext() {
    const g = this.game;
    const me = g.playerTeam!;
    const w = g.world;
    const scrap = w.teams[me].scrap;

    if (g.ghost) {
      const sig = `ghost:${g.ghost.kind}:${g.ghost.error}`;
      if (sig === this.sig) return;
      this.sig = sig;
      this.context.innerHTML = '';
      const def = BUILDINGS[g.ghost.kind];
      const info = h('div', 'hint', g.ghost.error ? `<b class="bad">${g.ghost.error}</b> — tap the map to move it` : `Placing <b>${def.name}</b> — tap the map to move, tap it to build`);
      const ok = h('button', 'cmd action primary', '✓ Build') as HTMLButtonElement;
      ok.disabled = !!g.ghost.error;
      ok.onclick = () => g.confirmPlacement();
      const no = h('button', 'cmd action', '✕') as HTMLButtonElement;
      no.onclick = () => g.cancelPlacement();
      this.context.append(info, ok, no);
      return;
    }

    const b = g.selectedBuilding();
    if (b && b.team === me) {
      const def = BUILDINGS[b.kind];
      const trains = def.trains ?? [];
      const counts = trains.map((k) => b.queue.filter((q) => q === k).length);
      const prog = b.queue.length ? Math.floor((b.prodTicks / (UNITS[b.queue[0]].buildTime * 10)) * 100) : 0;
      const sig = `b:${b.id}:${b.complete}:${counts.join(',')}:${trains.map((k) => (scrap >= UNITS[k].cost ? 1 : 0)).join('')}:${Math.floor(b.hp / def.hp * 20)}:${Math.floor(prog / 5)}:${b.complete ? 0 : Math.floor(b.progress / (def.buildTime * 10) * 20)}`;
      if (sig === this.sig) return;
      this.sig = sig;
      this.context.innerHTML = '';
      const head = h('div', 'sel-head');
      head.innerHTML = `<img src="${buildingIcon(b.kind, me)}" alt=""><div><b>${def.name}</b><small>${Math.ceil(b.hp)} / ${def.hp}</small></div>`;
      this.context.append(head);
      if (!b.complete) {
        this.context.append(h('div', 'hint', `Under construction… ${Math.floor((b.progress / (def.buildTime * 10)) * 100)}%`));
      } else if (trains.length) {
        trains.forEach((k: UnitKind, i) => {
          const ud = UNITS[k];
          const btn = h('button', 'cmd train' + (scrap < ud.cost ? ' poor' : '')) as HTMLButtonElement;
          btn.innerHTML = `<img src="${unitIcon(k, me)}" alt=""><span class="name">${ud.name}</span><span class="cost">${ud.cost}</span>` +
            (counts[i] ? `<span class="badge">${counts[i]}</span>` : '') +
            (b.queue[0] === k ? `<span class="prog" style="width:${prog}%"></span>` : '');
          btn.title = `${ud.name}: ${ud.role}`;
          btn.onclick = () => g.train(b.id, k);
          this.context.append(btn);
        });
        if (b.queue.length) {
          const c = h('button', 'cmd action', '↶') as HTMLButtonElement;
          c.title = 'Cancel last (refund)';
          c.onclick = () => g.cancel(b.id);
          this.context.append(c);
        }
        if (b.kind !== 'hq') this.context.append(h('div', 'hint small', 'Tap the map to set a rally point'));
      } else {
        this.context.append(h('div', 'hint', b.kind === 'depot' ? 'Harvesters unload here.' : 'Defends itself against ground and air.'));
      }
      const x = h('button', 'cmd action', '✕') as HTMLButtonElement;
      x.onclick = () => g.deselect();
      this.context.append(x);
      return;
    }

    const units = g.selectedUnits().filter((u) => u.team === me);
    if (units.length) {
      const byKind = new Map<UnitKind, number>();
      for (const u of units) byKind.set(u.kind, (byKind.get(u.kind) ?? 0) + 1);
      const sig = `u:${[...byKind].join(',')}:${g.attackMode}:${units.length === 1 ? Math.floor((units[0].hp / UNITS[units[0].kind].hp) * 20) : 0}`;
      if (sig === this.sig) return;
      this.sig = sig;
      this.context.innerHTML = '';
      const chips = h('div', 'chips');
      for (const [k, n] of byKind) {
        const c = h('div', 'chip', `<img src="${unitIcon(k, me)}" alt=""><span>${n > 1 ? n + '×' : UNITS[k].name}</span>`);
        c.title = UNITS[k].role;
        chips.append(c);
      }
      if (units.length === 1) {
        const u = units[0];
        chips.append(h('div', 'hint small', `${Math.ceil(u.hp)} hp${u.rank ? ' · ' + '★'.repeat(u.rank) : ''}${u.kind === 'mule' ? ' · ' + Math.floor(u.cargo) + ' cargo' : ''}`));
      }
      this.context.append(chips);
      if (units.some((u) => UNITS[u.kind].weapon)) {
        const am = h('button', 'cmd action' + (g.attackMode ? ' active' : ''), '⚔ Attack-move') as HTMLButtonElement;
        am.title = 'Next move order fights everything on the way (Q)';
        am.onclick = () => g.toggleAttackMode();
        this.context.append(am);
      }
      const st = h('button', 'cmd action', '■') as HTMLButtonElement;
      st.title = 'Stop (X)';
      st.onclick = () => g.stopSelected();
      const x = h('button', 'cmd action', '✕') as HTMLButtonElement;
      x.title = 'Deselect (Esc)';
      x.onclick = () => g.deselect();
      this.context.append(st, x);
      return;
    }

    const sig = 'none';
    if (sig === this.sig) return;
    this.sig = sig;
    const touch = matchMedia('(pointer: coarse)').matches;
    this.context.innerHTML = `<div class="hint">${touch
      ? 'Tap to select · tap the map to move · long-press &amp; drag to box-select · double-tap selects all of a type · pinch to zoom'
      : 'Click or drag to select · right-click to move/attack · Q attack-move · Space army · WASD pan · scroll to zoom'}</div>`;
  }
}
