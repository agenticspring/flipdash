// flipdash/audio.js — synthesized WebAudio SFX, zero assets.
// Degrades silently when AudioContext is unavailable (tests, old browsers).

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  _AudioCtor() {
    if (typeof window === 'undefined') return null;
    return window.AudioContext || window.webkitAudioContext || null;
  }

  ensure() {
    if (this.muted) return false;
    if (!this.ctx) {
      const AC = this._AudioCtor();
      if (!AC) return false;
      try {
        this.ctx = new AC();
      } catch (e) {
        return false;
      }
    }
    if (this.ctx.state === 'suspended') {
      try {
        const p = this.ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) {
        /* ignore */
      }
    }
    return true;
  }

  setMuted(m) {
    this.muted = !!m;
  }

  tone(freq, dur, opts = {}) {
    if (!this.ensure()) return;
    const { type = 'square', vol = 0.12, slideTo = null, delay = 0 } = opts;
    try {
      const t0 = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) {
      /* never break the game for sound */
    }
  }

  flip() {
    this.tone(300, 0.12, { type: 'square', slideTo: 640, vol: 0.1 });
  }

  star() {
    this.tone(880, 0.09, { type: 'sine', vol: 0.14 });
    this.tone(1320, 0.12, { type: 'sine', vol: 0.12, delay: 0.06 });
  }

  die() {
    this.tone(220, 0.35, { type: 'sawtooth', slideTo: 60, vol: 0.16 });
  }

  click() {
    this.tone(520, 0.06, { type: 'triangle', vol: 0.1 });
  }

  fanfare() {
    [660, 880, 1100].forEach((f, i) =>
      this.tone(f, 0.1, { type: 'sine', vol: 0.12, delay: i * 0.08 })
    );
  }
}
