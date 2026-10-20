// flipdash — pure game logic. ZERO DOM, ZERO browser APIs.
// Everything here is deterministic and unit-testable under plain Node.
//
// World: portrait playfield, ship auto-runs rightward at a fixed x and snaps
// between FLOOR and CEILING lanes when gravity flips. Obstacles spawn on either
// lane; stars spawn in the middle band. One hit = death.

export const STATES = {
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAMEOVER: 'gameover',
};

export const DEFAULTS = {
  width: 480,
  height: 720,
  groundH: 56,          // floor/ceiling strip thickness (px)
  shipX: 110,           // ship horizontal position (fixed; world scrolls)
  shipW: 34,
  shipH: 26,
  gravity: 5200,        // px/s^2 while flipping between lanes
  baseSpeed: 260,       // world scroll speed px/s
  maxSpeed: 780,
  speedRamp: 22,        // +px/s gained per survived second
  baseSpawn: 1.05,      // seconds between obstacle spawns (early game)
  minSpawn: 0.42,       // seconds between spawns (late game)
  spawnRampTime: 90,    // seconds until spawn interval bottoms out
  starChance: 0.45,     // probability a star spawns with an obstacle
  obstacleW: [26, 46],
  obstacleH: [34, 80],
  starScore: 50,        // points per star
  distanceDivisor: 100, // distance points = floor(distancePx / divisor)
};

// ---------------------------------------------------------------------------
// Construction / state machine
// ---------------------------------------------------------------------------

export function createGame(opts = {}) {
  const cfg = { ...DEFAULTS, ...(opts || {}) };
  return {
    cfg,
    state: STATES.TITLE,
    time: 0,          // seconds survived this run
    distance: 0,      // px scrolled this run
    score: 0,
    stars: 0,         // stars collected this run
    // best is managed by the shell (loaded from storage at boot, persisted on
    // game over). The pure logic never touches it — kill() must not update it,
    // or the shell cannot detect a new record.
    best: 0,
    speed: cfg.baseSpeed,
    spawnTimer: 0.6,  // first obstacle comes quickly so the game teaches fast
    gravityDown: true,
    ship: { y: cfg.height - cfg.groundH - cfg.shipH, vy: 0 },
    obstacles: [],    // {x,y,w,h,lane}
    pickups: [],      // {x,y,r,taken}
    diedAt: null,
  };
}

export function startGame(g) {
  g.state = STATES.PLAYING;
  g.time = 0;
  g.distance = 0;
  g.score = 0;
  g.stars = 0;
  g.speed = g.cfg.baseSpeed;
  g.spawnTimer = 0.6;
  g.gravityDown = true;
  g.ship.y = floorY(g);
  g.ship.vy = 0;
  g.obstacles = [];
  g.pickups = [];
  g.diedAt = null;
}

export function flipGravity(g) {
  if (g.state !== STATES.PLAYING) return false;
  g.gravityDown = !g.gravityDown;
  return true;
}

export function pauseGame(g) {
  if (g.state !== STATES.PLAYING) return false;
  g.state = STATES.PAUSED;
  return true;
}

export function resumeGame(g) {
  if (g.state !== STATES.PAUSED) return false;
  g.state = STATES.PLAYING;
  return true;
}

export function toTitle(g) {
  g.state = STATES.TITLE;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function floorY(g) {
  return g.cfg.height - g.cfg.groundH - g.cfg.shipH;
}

export function ceilingY(g) {
  return g.cfg.groundH;
}

export function shipRect(g) {
  return { x: g.cfg.shipX, y: g.ship.y, w: g.cfg.shipW, h: g.cfg.shipH };
}

function aabbHit(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function rand(rng, a, b) {
  return a + rng() * (b - a);
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

export function spawnObstacle(g, rng = Math.random) {
  const { cfg } = g;
  const lane = rng() < 0.5 ? 'floor' : 'ceiling';
  const w = rand(rng, cfg.obstacleW[0], cfg.obstacleW[1]);
  const h = rand(rng, cfg.obstacleH[0], cfg.obstacleH[1]);
  const y = lane === 'floor' ? cfg.height - cfg.groundH - h : cfg.groundH;
  g.obstacles.push({ x: cfg.width + 20, y, w, h, lane });
  return g.obstacles[g.obstacles.length - 1];
}

export function spawnStar(g, rng = Math.random) {
  const { cfg } = g;
  const top = cfg.groundH + 44;
  const bottom = cfg.height - cfg.groundH - 44;
  const y = rand(rng, top, bottom);
  g.pickups.push({ x: cfg.width + 20, y, r: 11, taken: false });
  return g.pickups[g.pickups.length - 1];
}

// ---------------------------------------------------------------------------
// Main step
// ---------------------------------------------------------------------------

export function update(g, dt, rng = Math.random) {
  if (g.state !== STATES.PLAYING) return;
  dt = Math.min(Math.max(dt, 0), 1 / 30); // clamp: no tunneling on frame spikes
  const { cfg } = g;

  g.time += dt;

  // difficulty curve: speed ramps with survived time
  g.speed = Math.min(cfg.maxSpeed, cfg.baseSpeed + cfg.speedRamp * g.time);
  g.distance += g.speed * dt;

  // ship physics: constant gravity toward the active lane, rest on lane surface
  const s = g.ship;
  s.vy += (g.gravityDown ? cfg.gravity : -cfg.gravity) * dt;
  s.y += s.vy * dt;
  const fY = floorY(g);
  const cY = ceilingY(g);
  if (g.gravityDown && s.y >= fY) { s.y = fY; s.vy = 0; }
  if (!g.gravityDown && s.y <= cY) { s.y = cY; s.vy = 0; }

  // spawning: interval shrinks as the run gets longer
  g.spawnTimer -= dt;
  if (g.spawnTimer <= 0) {
    spawnObstacle(g, rng);
    if (rng() < cfg.starChance) spawnStar(g, rng);
    const k = Math.min(1, g.time / cfg.spawnRampTime);
    const interval = cfg.baseSpawn + (cfg.minSpawn - cfg.baseSpawn) * k;
    g.spawnTimer = interval * rand(rng, 0.8, 1.2);
  }

  // scroll entities left, cull off-screen
  for (const o of g.obstacles) o.x -= g.speed * dt;
  for (const p of g.pickups) p.x -= g.speed * dt;
  g.obstacles = g.obstacles.filter((o) => o.x + o.w > -10);
  g.pickups = g.pickups.filter((p) => p.x + p.r > -10 && !p.taken);

  // collisions: one hit kills
  const sr = shipRect(g);
  for (const o of g.obstacles) {
    if (aabbHit(sr, o)) {
      kill(g);
      return;
    }
  }

  // star pickup: circle vs ship rect
  for (const p of g.pickups) {
    const nx = Math.max(sr.x, Math.min(p.x, sr.x + sr.w));
    const ny = Math.max(sr.y, Math.min(p.y, sr.y + sr.h));
    const dx = p.x - nx;
    const dy = p.y - ny;
    if (dx * dx + dy * dy < p.r * p.r) {
      p.taken = true;
      g.stars += 1;
    }
  }

  g.score = Math.floor(g.distance / cfg.distanceDivisor) + g.stars * cfg.starScore;
}

function kill(g) {
  g.state = STATES.GAMEOVER;
  g.diedAt = g.time;
  // NOTE: best is intentionally NOT updated here — the shell compares
  // g.score against the stored best after game over to detect a new record.
}
