// flipdash automated tests. Run with: node --test tests/test.mjs
// Part 1: unit tests of the pure logic in game.js (zero DOM).
// Part 2: integration playtest driving PRODUCTION main.js headless with a
//         fake DOM (touch path via fake pointerdown, keyboard path via fake
//         keydown, pause, death, restart, localStorage best) + 0 console errors.
// Part 3: static checks on index.html (mobile rules).

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  createGame, startGame, flipGravity, pauseGame, resumeGame,
  update, spawnObstacle, spawnStar, floorY, ceilingY, shipRect,
  STATES, DEFAULTS,
} from '../game.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// deterministic rng
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// benign rng: always spawns ceiling-lane obstacles (ship starts on floor)
const safeRng = () => 0.99;

function newPlaying(seed = 1) {
  const g = createGame();
  startGame(g);
  return g;
}

// A run with random spawning disabled: deterministic survival for tests that
// exercise physics/state machine rather than the spawner itself.
function quietPlaying() {
  const g = newPlaying();
  g.spawnTimer = 1e9;
  return g;
}

function runSteps(g, seconds, rng = safeRng, dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    update(g, dt, rng);
    if (g.state !== STATES.PLAYING) break;
  }
}

// ---------------------------------------------------------------------------
// Part 1 — pure logic unit tests
// ---------------------------------------------------------------------------

describe('game.js pure logic', () => {
  it('initial state: title, ship resting on floor', () => {
    const g = createGame();
    assert.equal(g.state, STATES.TITLE);
    assert.equal(g.ship.y, floorY(g));
    assert.equal(g.gravityDown, true);
    assert.deepEqual(g.obstacles, []);
    assert.deepEqual(g.pickups, []);
  });

  it('startGame resets a finished run', () => {
    const g = createGame();
    startGame(g);
    g.score = 999; g.stars = 5; g.obstacles.push({ x: 1, y: 2, w: 3, h: 4 });
    startGame(g);
    assert.equal(g.state, STATES.PLAYING);
    assert.equal(g.score, 0);
    assert.equal(g.stars, 0);
    assert.deepEqual(g.obstacles, []);
    assert.equal(g.speed, DEFAULTS.baseSpeed);
    assert.equal(g.ship.y, floorY(g));
  });

  it('flipGravity toggles only while playing', () => {
    const g = createGame();
    assert.equal(flipGravity(g), false); // TITLE
    startGame(g);
    assert.equal(flipGravity(g), true);
    assert.equal(g.gravityDown, false);
    assert.equal(flipGravity(g), true);
    assert.equal(g.gravityDown, true);
    pauseGame(g);
    assert.equal(flipGravity(g), false); // PAUSED: no-op
    assert.equal(g.gravityDown, true);
  });

  it('ship snaps to ceiling after flip and rests there', () => {
    const g = quietPlaying();
    flipGravity(g);
    update(g, 1 / 60, safeRng); // one physics step so motion actually starts
    assert.ok(g.ship.y < floorY(g), 'ship starts rising');
    runSteps(g, 2);
    assert.equal(g.ship.y, ceilingY(g));
    assert.equal(g.ship.vy, 0);
    assert.equal(g.state, STATES.PLAYING);
  });

  it('ship snaps back to floor on second flip', () => {
    const g = quietPlaying();
    flipGravity(g);
    runSteps(g, 2);
    flipGravity(g);
    runSteps(g, 2);
    assert.equal(g.ship.y, floorY(g));
    assert.equal(g.ship.vy, 0);
  });

  it('floor obstacle kills the ship on the floor', () => {
    const g = newPlaying();
    const sr = shipRect(g);
    g.obstacles.push({ x: sr.x - 4, y: sr.y, w: sr.w + 8, h: sr.h, lane: 'floor' });
    update(g, 1 / 60, safeRng);
    assert.equal(g.state, STATES.GAMEOVER);
    assert.ok(g.diedAt !== null);
  });

  it('floor obstacle is harmless when ship rides the ceiling', () => {
    const g = quietPlaying();
    flipGravity(g);
    runSteps(g, 2);
    assert.equal(g.ship.y, ceilingY(g));
    const sr = shipRect(g);
    g.obstacles.push({ x: sr.x - 4, y: floorY(g), w: sr.w + 8, h: sr.h, lane: 'floor' });
    for (let i = 0; i < 30; i++) update(g, 1 / 60, safeRng);
    assert.equal(g.state, STATES.PLAYING);
  });

  it('ceiling obstacle kills the ship on the ceiling', () => {
    const g = quietPlaying();
    flipGravity(g);
    runSteps(g, 2);
    const sr = shipRect(g);
    g.obstacles.push({ x: sr.x - 4, y: sr.y, w: sr.w + 8, h: sr.h, lane: 'ceiling' });
    update(g, 1 / 60, safeRng);
    assert.equal(g.state, STATES.GAMEOVER);
  });

  it('star pickup awards stars and points', () => {
    const g = newPlaying();
    const sr = shipRect(g);
    g.pickups.push({ x: sr.x + sr.w / 2, y: sr.y + sr.h / 2, r: 11, taken: false });
    const before = g.score;
    update(g, 1 / 60, safeRng);
    assert.equal(g.stars, 1);
    assert.ok(g.score >= before + DEFAULTS.starScore - 1);
  });

  it('score = distance points + star bonus', () => {
    const g = newPlaying();
    runSteps(g, 10);
    const expected = Math.floor(g.distance / DEFAULTS.distanceDivisor) + g.stars * DEFAULTS.starScore;
    assert.equal(g.score, expected);
  });

  it('difficulty ramps: speed rises, spawn density rises', () => {
    const g = newPlaying();
    runSteps(g, 5);
    const earlySpeed = g.speed;
    runSteps(g, 60);
    assert.ok(g.speed > earlySpeed, 'speed should ramp up');
    assert.ok(g.speed <= DEFAULTS.maxSpeed, 'speed capped at max');

    // spawn density: count obstacles spawned in first 10s vs a late 10s window
    const g2 = newPlaying();
    let early = 0;
    for (let i = 0; i < 600; i++) {
      const n0 = g2.obstacles.length;
      update(g2, 1 / 60, safeRng);
      if (g2.obstacles.length > n0) early++;
      if (g2.state !== STATES.PLAYING) break;
    }
    runSteps(g2, 80);
    let late = 0;
    for (let i = 0; i < 600; i++) {
      const n0 = g2.obstacles.length;
      update(g2, 1 / 60, safeRng);
      if (g2.obstacles.length > n0) late++;
      if (g2.state !== STATES.PLAYING) break;
    }
    assert.ok(late >= early, `late spawns (${late}) should be >= early (${early})`);
  });

  it('pause freezes the world, resume continues', () => {
    const g = newPlaying();
    runSteps(g, 1);
    const t = g.time;
    assert.equal(pauseGame(g), true);
    assert.equal(g.state, STATES.PAUSED);
    runSteps(g, 2);
    assert.equal(g.time, t, 'time must not advance while paused');
    assert.equal(resumeGame(g), true);
    assert.equal(g.state, STATES.PLAYING);
    runSteps(g, 1);
    assert.ok(g.time > t + 0.5);
  });

  it('dt is clamped against frame spikes', () => {
    const g = newPlaying();
    update(g, 5, safeRng); // 5s spike -> clamped to 1/30
    assert.ok(g.time <= 1 / 30 + 1e-9);
  });

  it('spawnObstacle places spikes on the correct lane', () => {
    const g = newPlaying();
    for (let i = 0; i < 40; i++) {
      const o = spawnObstacle(g, mulberry32(i));
      if (o.lane === 'floor') assert.equal(o.y + o.h, g.cfg.height - g.cfg.groundH);
      else assert.equal(o.y, g.cfg.groundH);
      assert.ok(o.x > g.cfg.width);
    }
  });

  it('dead game cannot be flipped or double-killed', () => {
    const g = newPlaying();
    const sr = shipRect(g);
    g.obstacles.push({ x: sr.x, y: sr.y, w: sr.w, h: sr.h, lane: 'floor' });
    update(g, 1 / 60, safeRng);
    assert.equal(g.state, STATES.GAMEOVER);
    assert.equal(flipGravity(g), false);
    const score = g.score;
    update(g, 1 / 60, safeRng);
    assert.equal(g.score, score, 'update is a no-op after death');
  });
});

// ---------------------------------------------------------------------------
// Part 2 — headless integration playtest of PRODUCTION main.js
// ---------------------------------------------------------------------------

// --- minimal fake DOM -------------------------------------------------------
class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.listeners = {};
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.textContent = '';
    this.innerHTML = '';
    this.children = [];
    this._classes = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => this._classes.add(x)),
      remove: (...c) => c.forEach((x) => this._classes.delete(x)),
      toggle: (c, f) => {
        if (f === undefined) f = !this._classes.has(c);
        if (f) this._classes.add(c); else this._classes.delete(c);
        return f;
      },
      contains: (c) => this._classes.has(c),
    };
  }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) {
    this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== fn);
  }
  dispatch(t, e = {}) {
    if (!e.preventDefault) e.preventDefault = () => {};
    if (!e.target) e.target = this;
    for (const fn of this.listeners[t] || []) fn(e);
  }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
}

const CTX_METHODS = new Set([
  'save', 'restore', 'translate', 'rotate', 'scale', 'clearRect', 'fillRect',
  'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo',
  'ellipse', 'rect', 'roundRect', 'fill', 'stroke', 'clip', 'fillText',
  'strokeText', 'drawImage', 'setTransform', 'resetTransform', 'setLineDash',
]);

function fakeCtx(canvas) {
  return new Proxy({}, {
    get(t, p) {
      if (p === 'canvas') return canvas;
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createPattern') {
        return () => ({ addColorStop() {} });
      }
      if (typeof p === 'string' && CTX_METHODS.has(p)) return () => {};
      return undefined;
    },
    set() { return true; },
  });
}

class FakeStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

function buildEnv() {
  const ids = [
    'game', 'hud', 'hudScore', 'hudStars', 'hudBest', 'ovTitle', 'ovPause',
    'ovOver', 'finalScore', 'finalBest', 'newBest', 'titleBest', 'btnStart',
    'btnPause', 'btnResume', 'btnRestart', 'btnRestart2', 'btnMute', 'btnMute2', 'btnMute3',
  ];
  const elements = {};
  for (const id of ids) elements[id] = new FakeElement(id === 'game' ? 'canvas' : 'div');
  const canvas = elements.game;
  canvas.width = 0; canvas.height = 0;
  canvas.getContext = () => fakeCtx(canvas);

  const winListeners = {};
  const window = {
    __FLIPDASH_TEST: true,
    AudioContext: undefined,
    addEventListener(t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
    dispatch(t, e = {}) {
      if (!e.preventDefault) e.preventDefault = () => {};
      for (const fn of winListeners[t] || []) fn(e);
    },
  };

  const docListeners = {};
  const document = {
    hidden: false,
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => new FakeElement(tag),
    body: new FakeElement('body'),
    addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
    dispatch(t, e = {}) {
      for (const fn of docListeners[t] || []) fn(e);
    },
  };

  return { elements, canvas, window, document, storage: new FakeStorage(), raf: [] };
}

// capture console errors for the whole run
const consoleErrors = [];
const origConsoleError = console.error;
console.error = (...a) => { consoleErrors.push(a); };

describe('main.js headless playtest (production code)', () => {
  let boot, env, app;

  before(async () => {
    env = buildEnv();
    globalThis.window = env.window; // main.js auto-boot guard reads this
    ({ boot } = await import('../main.js'));
    app = boot({
      document: env.document,
      window: env.window,
      localStorage: env.storage,
      requestAnimationFrame: (cb) => { env.raf.push(cb); return env.raf.length; },
      autostart: false,
    });
  });

  it('boots to title screen with no console errors', () => {
    assert.equal(app.game.state, STATES.TITLE);
    assert.ok(!env.elements.ovTitle.classList.contains('hidden'));
    assert.ok(env.elements.hud.classList.contains('hidden'));
    assert.equal(consoleErrors.length, 0);
  });

  it('start button begins the run', () => {
    env.elements.btnStart.dispatch('click');
    assert.equal(app.game.state, STATES.PLAYING);
    assert.ok(env.elements.ovTitle.classList.contains('hidden'));
    assert.ok(!env.elements.hud.classList.contains('hidden'));
  });

  // deterministic spawner for playtests: ceiling-lane obstacles only,
  // ship rides the floor -> survival is guaranteed, spawning still exercised
  const playRng = () => 0.99;

  function freshRun() {
    app.actions.begin();
    app.game.spawnTimer = 1e9; // suppress random spawns unless the test wants them
  }

  it('plays 3 seconds: world scrolls, obstacles spawn, score grows', () => {
    app.actions.begin();
    for (let i = 0; i < 180; i++) app.step(1 / 60, playRng);
    assert.equal(app.game.state, STATES.PLAYING);
    assert.ok(app.game.time >= 2.9, `time=${app.game.time}`);
    assert.ok(app.game.obstacles.length > 0, 'obstacles must spawn');
    assert.ok(app.game.distance > 0);
    assert.ok(app.game.score > 0);
    assert.equal(env.elements.hudScore.textContent, String(app.game.score));
  });

  it('touch path: pointerdown flips gravity', () => {
    freshRun();
    const before = app.game.gravityDown;
    env.canvas.dispatch('pointerdown', {});
    assert.equal(app.game.gravityDown, !before);
  });

  it('keyboard path: Space flips gravity back', () => {
    freshRun();
    env.canvas.dispatch('pointerdown', {}); // flip once via touch
    const before = app.game.gravityDown;
    env.window.dispatch('keydown', { code: 'Space', repeat: false });
    assert.equal(app.game.gravityDown, !before);
  });

  it('keyboard P pauses and resumes; world freezes while paused', () => {
    freshRun();
    env.window.dispatch('keydown', { code: 'KeyP', repeat: false });
    assert.equal(app.game.state, STATES.PAUSED);
    assert.ok(!env.elements.ovPause.classList.contains('hidden'));
    const t = app.game.time;
    for (let i = 0; i < 60; i++) app.step(1 / 60, playRng);
    assert.equal(app.game.time, t);
    env.elements.btnResume.dispatch('click');
    assert.equal(app.game.state, STATES.PLAYING);
    assert.ok(env.elements.ovPause.classList.contains('hidden'));
  });

  it('pause button + visibilitychange auto-pause', () => {
    freshRun();
    env.elements.btnPause.dispatch('click');
    assert.equal(app.game.state, STATES.PAUSED);
    env.elements.btnResume.dispatch('click');
    env.document.hidden = true;
    env.document.dispatch('visibilitychange', {});
    assert.equal(app.game.state, STATES.PAUSED, 'tab hide should auto-pause');
    env.document.hidden = false;
    env.elements.btnResume.dispatch('click');
    assert.equal(app.game.state, STATES.PLAYING);
  });

  it('death path: forced collision -> game over overlay, best persisted', () => {
    app.actions.begin(); // fresh run
    for (let i = 0; i < 120; i++) app.step(1 / 60, playRng); // build some score
    assert.equal(app.game.state, STATES.PLAYING);
    assert.ok(app.game.score > 0);
    const sr = shipRect(app.game);
    app.game.ship.y = floorY(app.game);
    app.game.gravityDown = true;
    app.game.obstacles = [{ x: sr.x - 2, y: floorY(app.game), w: sr.w + 4, h: sr.h, lane: 'floor' }];
    app.step(1 / 60, playRng);
    assert.equal(app.game.state, STATES.GAMEOVER);
    assert.ok(!env.elements.ovOver.classList.contains('hidden'));
    assert.equal(env.elements.finalScore.textContent, String(app.game.score));
    assert.ok(!env.elements.newBest.classList.contains('hidden'), 'new best badge should show');
    assert.equal(env.storage.getItem('flipdash_best'), String(app.game.score));
    assert.equal(app.game.best, app.game.score);
  });

  it('restart path: play again resets the run', () => {
    env.elements.btnRestart.dispatch('click');
    assert.equal(app.game.state, STATES.PLAYING);
    assert.equal(app.game.score, 0);
    assert.equal(app.game.stars, 0);
    assert.ok(env.elements.ovOver.classList.contains('hidden'));
    for (let i = 0; i < 60; i++) app.step(1 / 60, playRng);
    assert.equal(app.game.state, STATES.PLAYING);
  });

  it('mute toggle persists to localStorage', () => {
    assert.equal(app.isMuted(), false);
    env.elements.btnMute.dispatch('click');
    assert.equal(app.isMuted(), true);
    assert.equal(env.storage.getItem('flipdash_mute'), '1');
    env.elements.btnMute.dispatch('click');
    assert.equal(app.isMuted(), false);
    assert.equal(env.storage.getItem('flipdash_mute'), '0');
    // overlay mute buttons work too
    env.elements.btnMute2.dispatch('click');
    assert.equal(app.isMuted(), true);
    env.elements.btnMute3.dispatch('click');
    assert.equal(app.isMuted(), false);
  });

  it('Sfx degrades silently without AudioContext', async () => {
    const { Sfx } = await import('../audio.js');
    const s = new Sfx();
    s.flip(); s.star(); s.die(); s.click(); s.fanfare(); // must not throw
    s.setMuted(true);
    s.flip();
    assert.equal(consoleErrors.length, 0);
  });

  it('zero console errors across the whole playtest', () => {
    assert.equal(consoleErrors.length, 0, JSON.stringify(consoleErrors.slice(0, 3)));
    console.error = origConsoleError;
  });
});

// ---------------------------------------------------------------------------
// Part 3 — static checks (mobile hard rules live in markup/CSS)
// ---------------------------------------------------------------------------

describe('index.html static checks', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const main = readFileSync(path.join(ROOT, 'main.js'), 'utf8');

  it('has viewport meta for mobile', () => {
    assert.ok(html.includes('name="viewport"'));
    assert.ok(html.includes('width=device-width'));
  });

  it('canvas uses touch-action:none and pointer events', () => {
    assert.ok(html.includes('touch-action: none') || html.includes('touch-action:none'));
    assert.ok(main.includes('pointerdown'));
  });

  it('portrait letterbox with preserved aspect ratio (no distortion)', () => {
    assert.ok(html.includes('aspect-ratio'));
    assert.ok(html.includes('480') && html.includes('720'));
  });

  it('tap targets are thumb-sized (>=44px)', () => {
    assert.ok(html.includes('56px'));
    assert.ok(html.includes('min-height: 56px') || html.includes('min-height:56px'));
  });

  it('zero external dependencies in markup', () => {
    assert.ok(!html.match(/src="https?:\/\//));
    assert.ok(!html.match(/href="https?:\/\//));
    assert.ok(!html.match(/<link[^>]+rel="stylesheet"/));
  });
});
