// Entry point: menu → game → after-action report → menu.
import './ui/style.css';
import { Sound } from './game/audio';
import { Game, type GameOptions } from './game/game';
import { Hud } from './ui/hud';
import { showEnd, showMenu, showPause } from './ui/menu';

const sound = new Sound();
let game: Game | null = null;
let hud: Hud | null = null;

function stopGame() {
  game?.destroy();
  hud?.destroy();
  game = null;
  hud = null;
}

function startGame(opts: GameOptions) {
  stopGame();
  sound.unlock();
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const mini = document.getElementById('minimap') as HTMLCanvasElement;
  game = new Game(canvas, mini, opts, sound);
  const g = game;
  hud = new Hud(g, document.getElementById('app')!, () => {
    g.paused = true;
    showPause({
      soundOn: sound.enabled,
      onSound: (on) => (sound.enabled = on),
      onResume: () => (g.paused = false),
      onQuit: () => { stopGame(); showMenu(startGame); },
    });
  });
  g.onChange = () => hud?.update();
  g.onEnd = (summary) =>
    showEnd(summary, () => startGame({ ...opts, seed: opts.seed + 1 }), () => { stopGame(); showMenu(startGame); });
  g.start();
}

// Pause when the tab is hidden so a phone in a pocket doesn't lose the match.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game && game.playerTeam !== null && !game.paused) {
    const g = game;
    g.paused = true;
    showPause({
      soundOn: sound.enabled,
      onSound: (on) => (sound.enabled = on),
      onResume: () => (g.paused = false),
      onQuit: () => { stopGame(); showMenu(startGame); },
    });
  }
});

// Handy for debugging from the console: window.rotorfront.game.world
(window as unknown as { rotorfront: unknown }).rotorfront = { get game() { return game; } };

showMenu(startGame);
