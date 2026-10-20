# flipdash

A one-tap gravity-flip runner for the browser. Your ship auto-runs to the right at ever-increasing speed — tap, click, or press Space to flip gravity and snap between the **floor** and **ceiling** lanes. Dodge the red spikes on both lanes, grab stars, and survive as long as you can. One hit = game over.

**Zero dependencies. Zero build step. Zero external assets.** Open `index.html` and play.

## Features

- **One-tap gravity flip** — the whole game is a single input: tap / click / Space / ↑ / W
- **Two-lane dodging** — spikes spawn on floor *and* ceiling; mid-air flips thread the gap
- **Difficulty curve** — scroll speed ramps from 260 → 780 px/s and spawn density doubles over ~90 s
- **Scoring** — distance points + 50 per star; persistent best score in `localStorage`
- **Full game flow** — title → playing → paused → game over → restart, plus auto-pause when the tab hides
- **Synthesized SFX** — WebAudio flip/star/death/UI sounds, no audio files, with a persisted mute toggle
- **Mobile-first** — portrait 2:3 letterbox (no distortion), Pointer Events touch input with `touch-action: none`, HUD readable at 390 px, 56 px thumb-sized buttons, no horizontal overflow
- **Separated pure logic** — all physics/collision/spawning/scoring/state-machine code lives in DOM-free `game.js`, fully unit-tested under Node

## How to play

1. Open `index.html` in any modern browser (or serve the folder: `python3 -m http.server`).
2. Press **START** (or tap anywhere).
3. **Tap / click / Space / ↑** to flip gravity whenever a spike blocks your lane.
4. Collect ★ stars for bonus points. Survive. One hit ends the run.
5. **P** or **Esc** pauses; the pause button is bottom-right on touch devices.

## Controls

| Input | Action |
|---|---|
| Tap / click / Space / ↑ / W | Flip gravity (also starts / restarts) |
| P / Esc | Pause / resume |
| ⏸ button (bottom-right) | Pause (touch) |
| 🔊 button | Mute toggle (persisted) |

## Project layout

```
flipdash/
├── index.html   # markup + mobile-first CSS (portrait letterbox, HUD, overlays)
├── game.js      # PURE game logic — zero DOM, Node-testable
├── main.js      # rendering (Canvas), input, loop, overlays, persistence
├── audio.js     # synthesized WebAudio SFX, degrades silently without AudioContext
└── tests/
    ├── test.mjs                 # node:test suite (unit + headless playtest + static checks)
    └── evidence-2026-10-20.txt  # recorded test output
```

## Testing

```bash
node --test tests/test.mjs
```

The suite has three parts (32 tests, all passing):

1. **Unit tests** of the pure logic — gravity flip physics, collision on both lanes, star pickup scoring, difficulty ramp (speed + spawn density), pause/resume freezing the world, state-machine edges.
2. **Headless playtest** driving the *production* `main.js` with a fake DOM — start → 3 s of play → touch flip → keyboard flip → pause/resume → forced death → game-over overlay + best-score persistence → restart → mute toggle; asserts **zero console errors**.
3. **Static checks** on `index.html` — viewport meta, `touch-action: none`, aspect-ratio letterbox, ≥44 px tap targets, zero external URLs.

The automated playtest covers the manual checklist (controls work, lose path, restart path, no console errors). A live-browser manual pass is still recommended on a real phone for feel/latency.

## Limitations

- Best score and mute preference live in `localStorage`; clearing site data resets them.
- Sound requires a user gesture first (browser autoplay policy) — the first tap/click unlocks it.
- The game is tuned for portrait; on wide desktop screens it letterboxes to a centered 2:3 column.
- No backend or multiplayer — scores are local only.

## License

MIT — see [LICENSE](LICENSE).
