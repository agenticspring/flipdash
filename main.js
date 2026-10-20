// flipdash/main.js — browser shell: rendering, input, SFX wiring, persistence.
// Pure logic lives in game.js; this file is the only place touching the DOM.

import {
  createGame,
  startGame,
  flipGravity,
  pauseGame,
  resumeGame,
  update,
  shipRect,
  STATES,
} from './game.js';
import { Sfx } from './audio.js';

export const VIEW_W = 480;
export const VIEW_H = 720;

const BEST_KEY = 'flipdash_best';
const MUTE_KEY = 'flipdash_mute';

function loadInt(storage, key, fallback) {
  try {
    const v = parseInt(storage.getItem(key), 10);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveInt(storage, key, value) {
  try {
    storage.setItem(key, String(value));
  } catch (e) {
    /* storage unavailable (private mode) — game still works */
  }
}

export function boot(deps) {
  const { document, window, localStorage, requestAnimationFrame, autostart = true } = deps;

  const canvas = document.getElementById('game');
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  const ctx = canvas.getContext('2d');

  const g = createGame({ width: VIEW_W, height: VIEW_H });
  g.best = loadInt(localStorage, BEST_KEY, 0);

  const sfx = new Sfx();
  let muted = localStorage.getItem(MUTE_KEY) === '1';
  sfx.setMuted(muted);

  const el = (id) => document.getElementById(id);
  const ui = {
    hud: el('hud'),
    hudScore: el('hudScore'),
    hudStars: el('hudStars'),
    hudBest: el('hudBest'),
    ovTitle: el('ovTitle'),
    ovPause: el('ovPause'),
    ovOver: el('ovOver'),
    finalScore: el('finalScore'),
    finalBest: el('finalBest'),
    newBest: el('newBest'),
    titleBest: el('titleBest'),
    btnStart: el('btnStart'),
    btnPause: el('btnPause'),
    btnResume: el('btnResume'),
    btnRestart: el('btnRestart'),
    btnRestart2: el('btnRestart2'),
    btnMute: el('btnMute'),
    btnMute2: el('btnMute2'),
    btnMute3: el('btnMute3'),
  };

  function show(node, visible) {
    node.classList.toggle('hidden', !visible);
  }

  function refreshMuteIcons() {
    const icon = muted ? '🔇' : '🔊';
    ui.btnMute.textContent = icon;
    ui.btnMute2.textContent = icon;
    ui.btnMute3.textContent = icon;
  }

  function toggleMute() {
    muted = !muted;
    sfx.setMuted(muted);
    saveInt(localStorage, MUTE_KEY, muted ? 1 : 0);
    refreshMuteIcons();
    if (!muted) sfx.click();
  }

  function persistBest() {
    if (g.score > g.best) {
      g.best = g.score;
      saveInt(localStorage, BEST_KEY, g.best);
      return true;
    }
    return false;
  }

  function syncUI() {
    show(ui.ovTitle, g.state === STATES.TITLE);
    show(ui.ovPause, g.state === STATES.PAUSED);
    show(ui.ovOver, g.state === STATES.GAMEOVER);
    show(ui.hud, g.state === STATES.PLAYING || g.state === STATES.PAUSED);
    show(ui.btnPause, g.state === STATES.PLAYING);
    show(ui.btnMute, g.state !== STATES.TITLE);
    ui.hudScore.textContent = String(g.score);
    ui.hudStars.textContent = String(g.stars);
    ui.hudBest.textContent = String(g.best);
    ui.titleBest.textContent = String(g.best);
    if (g.state === STATES.GAMEOVER) {
      ui.finalScore.textContent = String(g.score);
      ui.finalBest.textContent = String(g.best);
    }
  }

  function begin() {
    sfx.ensure();
    sfx.click();
    startGame(g);
    syncUI();
  }

  function doFlip() {
    if (flipGravity(g)) {
      sfx.ensure();
      sfx.flip();
    }
  }

  function doPause() {
    if (pauseGame(g)) {
      sfx.click();
      syncUI();
    }
  }

  function doResume() {
    if (resumeGame(g)) {
      sfx.ensure();
      sfx.click();
      syncUI();
    }
  }

  function handleDeath() {
    sfx.die();
    const isBest = persistBest();
    show(ui.newBest, isBest);
    if (isBest) sfx.fanfare();
    syncUI();
  }

  // --- input -------------------------------------------------------------
  function onKey(e) {
    if (e.repeat) return;
    const k = e.code || e.key;
    if (k === 'Space' || k === ' ' || k === 'Spacebar' || k === 'ArrowUp' || k === 'KeyW') {
      if (g.state === STATES.TITLE || g.state === STATES.GAMEOVER) begin();
      else doFlip();
      if (e.preventDefault) e.preventDefault();
    } else if (k === 'KeyP' || k === 'Escape') {
      if (g.state === STATES.PLAYING) doPause();
      else if (g.state === STATES.PAUSED) doResume();
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.preventDefault) e.preventDefault();
    sfx.ensure();
    if (g.state === STATES.TITLE || g.state === STATES.GAMEOVER) begin();
    else doFlip();
  });

  window.addEventListener('keydown', onKey);

  ui.btnStart.addEventListener('click', begin);
  ui.btnPause.addEventListener('click', doPause);
  ui.btnResume.addEventListener('click', doResume);
  ui.btnRestart.addEventListener('click', begin);
  ui.btnRestart2.addEventListener('click', begin);
  ui.btnMute.addEventListener('click', toggleMute);
  ui.btnMute2.addEventListener('click', toggleMute);
  ui.btnMute3.addEventListener('click', toggleMute);

  if (document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && g.state === STATES.PLAYING) doPause();
    });
  }

  // --- rendering ----------------------------------------------------------
  const bgStars = [];
  for (let i = 0; i < 90; i++) {
    bgStars.push({
      x: Math.random() * VIEW_W,
      y: Math.random() * VIEW_H,
      r: 0.6 + Math.random() * 1.8,
      tw: Math.random() * Math.PI * 2,
    });
  }

  function drawBackground(t) {
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, '#0b1030');
    grad.addColorStop(0.5, '#070a1c');
    grad.addColorStop(1, '#0b1030');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.fillStyle = '#ffffff';
    for (const s of bgStars) {
      const a = 0.25 + 0.55 * Math.abs(Math.sin(t * 1.4 + s.tw));
      const sx = (((s.x - g.distance * 0.15) % VIEW_W) + VIEW_W) % VIEW_W;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(sx, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawLanes() {
    const gh = g.cfg.groundH;
    // ceiling strip
    ctx.fillStyle = '#141b3d';
    ctx.fillRect(0, 0, VIEW_W, gh);
    // floor strip
    ctx.fillRect(0, VIEW_H - gh, VIEW_W, gh);
    // neon edges
    ctx.fillStyle = g.gravityDown ? '#22d3ee' : '#3b2f5e';
    ctx.fillRect(0, gh - 3, VIEW_W, 3);
    ctx.fillStyle = g.gravityDown ? '#3b2f5e' : '#f472b6';
    ctx.fillRect(0, VIEW_H - gh, VIEW_W, 3);
  }

  function drawShip() {
    const sr = shipRect(g);
    const cx = sr.x + sr.w / 2;
    const cy = sr.y + sr.h / 2;
    const tilt = g.gravityDown ? 1 : -1;
    // flame trail (opposite of gravity)
    ctx.save();
    ctx.translate(sr.x - 6, cy);
    ctx.fillStyle = 'rgba(251,146,60,0.85)';
    const fl = 10 + Math.random() * 8;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(-fl, 0);
    ctx.lineTo(0, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // hull: dart pointing right, tilted toward the active lane
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt * 0.12);
    ctx.fillStyle = g.gravityDown ? '#22d3ee' : '#f472b6';
    ctx.beginPath();
    ctx.moveTo(sr.w / 2, 0);
    ctx.lineTo(-sr.w / 2, -sr.h / 2);
    ctx.lineTo(-sr.w / 4, 0);
    ctx.lineTo(-sr.w / 2, sr.h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0b1030';
    ctx.beginPath();
    ctx.arc(sr.w / 8, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSpike(o) {
    ctx.fillStyle = '#ef4444';
    ctx.strokeStyle = '#fca5a5';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (o.lane === 'floor') {
      ctx.moveTo(o.x, o.y + o.h);
      ctx.lineTo(o.x + o.w / 2, o.y);
      ctx.lineTo(o.x + o.w, o.y + o.h);
    } else {
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(o.x + o.w / 2, o.y + o.h);
      ctx.lineTo(o.x + o.w, o.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawStarPickup(p, t) {
    const bob = Math.sin(t * 5 + p.x * 0.02) * 3;
    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.rotate(t * 1.5);
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? p.r : p.r * 0.45;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function render(t) {
    drawBackground(t);
    drawLanes();
    for (const o of g.obstacles) drawSpike(o);
    for (const p of g.pickups) if (!p.taken) drawStarPickup(p, t);
    if (g.state !== STATES.GAMEOVER) drawShip();
  }

  // --- main loop ----------------------------------------------------------
  let last = null;
  let prevState = g.state;

  function frame(t) {
    if (last === null) last = t;
    let dt = (t - last) / 1000;
    last = t;
    if (dt > 0.1) dt = 0.1;
    if (g.state === STATES.PLAYING) {
      update(g, dt);
      if (g.state === STATES.GAMEOVER && prevState !== STATES.GAMEOVER) handleDeath();
    }
    prevState = g.state;
    render(t / 1000);
    syncHudOnly();
    if (autostart) requestAnimationFrame(frame);
  }

  function syncHudOnly() {
    ui.hudScore.textContent = String(g.score);
    ui.hudStars.textContent = String(g.stars);
    ui.hudBest.textContent = String(g.best);
  }

  // Headless single-step used by automated tests (bypasses rAF).
  // rng is injectable so playtests can run deterministically; the live loop
  // always uses Math.random via the update() default.
  function step(dt, rng) {
    if (g.state === STATES.PLAYING) {
      update(g, dt, rng);
      if (g.state === STATES.GAMEOVER && prevState !== STATES.GAMEOVER) handleDeath();
    }
    prevState = g.state;
    render(g.time);
    syncHudOnly();
  }

  refreshMuteIcons();
  syncUI();
  if (autostart) requestAnimationFrame(frame);

  return {
    game: g,
    sfx,
    ui,
    step,
    actions: { begin, doFlip, doPause, doResume, toggleMute },
    isMuted: () => muted,
  };
}

// Auto-boot in a real browser. Tests import boot() directly with fake deps
// and set window.__FLIPDASH_TEST to skip this.
if (typeof window !== 'undefined' && !window.__FLIPDASH_TEST) {
  boot({
    document,
    window,
    localStorage: window.localStorage,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    autostart: true,
  });
}
