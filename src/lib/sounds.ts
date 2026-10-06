/**
 * Short synthesized sound effects (Web Audio API; no audio files to download).
 *
 * Browsers (iOS Safari in particular) only allow audio after a user gesture,
 * so `unlock()` must be called from a tap, e.g. "Start workout". After that,
 * sounds can play from the frame loop.
 *
 * iPhone: by default Safari mutes web audio when the ring/silent switch is on.
 * We opt into the "playback" audio session (Safari 17+) so the sounds are
 * heard anyway. Side effect: like any media playback, it can pause music
 * playing in another app while the workout screen is open.
 */

type Note = {
  freq: number;
  /** Start offset in seconds. */
  at: number;
  /** Decay length in seconds. */
  length: number;
  gain: number;
  type?: OscillatorType;
};

class SoundPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  /** Create/resume the audio context. Call from a user gesture (safe to call repeatedly). */
  unlock(): void {
    try {
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session && session.type !== 'playback') session.type = 'playback';
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 1;
        // Gentle low-pass keeps the tones soft rather than piercing.
        const lowpass = this.ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 5000;
        this.master.connect(lowpass).connect(this.ctx.destination);
      }
      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
      // iOS needs a sound started inside the gesture to fully unlock output.
      this.play([{ freq: 440, at: 0, length: 0.01, gain: 0.0001 }]);
    } catch {
      this.ctx = null;
    }
  }

  /** Full-depth rep: a quick, bright two-note "ding" (~0.3 s). */
  fullDepth(): void {
    this.play([
      { freq: 1318.5, at: 0, length: 0.14, gain: 0.3, type: 'sine' }, // E6
      { freq: 1318.5, at: 0, length: 0.1, gain: 0.07, type: 'triangle' },
      { freq: 1760, at: 0.075, length: 0.28, gain: 0.3, type: 'sine' }, // A6
      { freq: 1760, at: 0.075, length: 0.16, gain: 0.07, type: 'triangle' },
      { freq: 3520, at: 0.075, length: 0.09, gain: 0.04, type: 'sine' }, // shimmer
    ]);
  }

  /** Set complete: a soft rising major arpeggio (~0.9 s). */
  setComplete(): void {
    const t = 'triangle';
    this.play([
      { freq: 523.25, at: 0, length: 0.32, gain: 0.26, type: t }, // C5
      { freq: 659.25, at: 0.11, length: 0.32, gain: 0.26, type: t }, // E5
      { freq: 783.99, at: 0.22, length: 0.36, gain: 0.26, type: t }, // G5
      { freq: 1046.5, at: 0.33, length: 0.7, gain: 0.28, type: t }, // C6
      { freq: 2093, at: 0.33, length: 0.5, gain: 0.06, type: 'sine' },
    ]);
  }

  private play(notes: Note[]): void {
    const ctx = this.ctx;
    const out = this.master;
    if (!ctx || !out || ctx.state === 'closed') return;
    // 'suspended', or Safari's 'interrupted' (e.g. after the camera permission prompt).
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    const now = ctx.currentTime + 0.01;
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = n.type ?? 'sine';
      osc.frequency.value = n.freq;
      const start = now + n.at;
      // Fast attack, exponential decay: a clean "struck" envelope with no clicks.
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(n.gain, start + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, start + n.length);
      osc.connect(env).connect(out);
      osc.start(start);
      osc.stop(start + n.length + 0.02);
      osc.onended = () => env.disconnect();
    }
  }
}

export const sounds = new SoundPlayer();
