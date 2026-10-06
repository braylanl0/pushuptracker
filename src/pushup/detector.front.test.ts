import { describe, expect, it } from 'vitest';
import { PushupDetector, type DetectorOutput } from './detector';
import {
  seededRng,
  syntheticFrontPose,
  syntheticPose,
  type SyntheticFrontPoseOptions,
} from './synthetic';

const DT = 1000 / 30;
const W = 1280;
const H = 720;

/** Feeds facing-the-camera poses (and optionally side-on poses) to one detector. */
class Sim {
  t = 0;
  outputs: DetectorOutput[] = [];
  constructor(
    public det = new PushupDetector(),
    public base: Partial<SyntheticFrontPoseOptions> = {},
  ) {}

  private push(landmarks: ReturnType<typeof syntheticFrontPose> | null) {
    const out = this.det.update({ landmarks, width: W, height: H, timeMs: this.t });
    this.outputs.push(out);
    this.t += DT;
    return out;
  }

  front(h: number, extra: Partial<SyntheticFrontPoseOptions> = {}) {
    return this.push(syntheticFrontPose({ width: W, height: H, ...this.base, ...extra, shoulderHeight: h }));
  }

  side(elbowAngle: number) {
    return this.push(syntheticPose({ width: W, height: H, elbowAngle }));
  }

  hold(h: number, ms: number, extra: Partial<SyntheticFrontPoseOptions> = {}) {
    for (let i = 0; i < ms / DT; i++) this.front(h, extra);
  }

  sweep(a: number, b: number, ms: number, extra: Partial<SyntheticFrontPoseOptions> = {}) {
    const n = Math.max(1, Math.round(ms / DT));
    for (let i = 1; i <= n; i++) this.front(a + ((b - a) * i) / n, extra);
  }

  /** One push-up facing the camera. h = shoulder height (1 = top, 0.45 ≈ 90° elbow). */
  rep(bottom = 0.4, extra: Partial<SyntheticFrontPoseOptions> = {}) {
    this.sweep(1, bottom, 700, extra);
    this.hold(bottom, 100, extra);
    this.sweep(bottom, 1, 600, extra);
    this.hold(1, 300, extra);
  }

  sideRep() {
    const n = 21;
    for (let i = 1; i <= n; i++) this.side(170 - (90 * i) / n);
    for (let i = 0; i < 3; i++) this.side(80);
    for (let i = 1; i <= 18; i++) this.side(80 + (90 * i) / 18);
    for (let i = 0; i < 9; i++) this.side(170);
  }

  activate() {
    this.hold(1, 1200);
    expect(this.last.status).toBe('active');
  }

  get last() {
    return this.outputs[this.outputs.length - 1];
  }
}

describe('PushupDetector – facing the camera', () => {
  it('detects the front view', () => {
    const sim = new Sim();
    sim.hold(1, 300);
    expect(sim.last.view).toBe('front');
    expect(sim.last.viewScore!).toBeGreaterThan(0.55);
  });

  it('keeps side-on poses in the side view', () => {
    const sim = new Sim();
    for (let i = 0; i < 40; i++) sim.side(170);
    expect(sim.last.view).toBe('side');
    expect(sim.last.viewScore!).toBeLessThan(0.1);
  });

  it('activates from a held plank without needing ankles', () => {
    const sim = new Sim();
    sim.hold(1, 400);
    expect(sim.last.status).toBe('positioning');
    expect(sim.last.cue).toBe('HOLD');
    sim.hold(1, 800);
    expect(sim.last.status).toBe('active');
  });

  it('maps top to ~0%, halfway to ~50% and full depth to ~100%', () => {
    const sim = new Sim();
    sim.activate();
    expect(sim.last.depth!).toBeLessThan(5);
    sim.sweep(1, 0.725, 400);
    sim.hold(0.725, 800);
    expect(sim.last.depth!).toBeGreaterThan(40);
    expect(sim.last.depth!).toBeLessThan(60);
    sim.sweep(0.725, 0.45, 400);
    sim.hold(0.45, 800);
    expect(sim.last.depth!).toBeGreaterThan(95);
  });

  it('counts clean reps exactly once each', () => {
    const sim = new Sim();
    sim.activate();
    for (let i = 0; i < 5; i++) sim.rep();
    expect(sim.last.reps).toBe(5);
    expect(sim.outputs.filter((o) => o.repCounted)).toHaveLength(5);
  });

  it('counts reps with noisy landmarks', () => {
    const sim = new Sim(new PushupDetector(), { noisePx: 3, rng: seededRng(11) });
    sim.activate();
    for (let i = 0; i < 6; i++) sim.rep();
    expect(sim.last.reps).toBe(6);
  });

  it('does not count shallow reps', () => {
    const sim = new Sim();
    sim.activate();
    for (let i = 0; i < 3; i++) sim.rep(0.75);
    expect(sim.last.reps).toBe(0);
  });

  it('works with hidden hips and with only one arm visible', () => {
    const sim = new Sim(new PushupDetector(), { hipVisibility: 0.1, hideArm: 'left' });
    sim.activate();
    for (let i = 0; i < 3; i++) sim.rep();
    expect(sim.last.reps).toBe(3);
  });

  it('works in a portrait camera frame', () => {
    const det = new PushupDetector();
    let t = 0;
    const feed = (h: number) => {
      det.update({ landmarks: syntheticFrontPose({ shoulderHeight: h, width: 720, height: 1280 }), width: 720, height: 1280, timeMs: t });
      t += DT;
    };
    for (let i = 0; i < 40; i++) feed(1);
    for (let r = 0; r < 3; r++) {
      for (let h = 1; h >= 0.4; h -= 0.03) feed(h);
      for (let h = 0.4; h <= 1; h += 0.03) feed(h);
      for (let i = 0; i < 10; i++) feed(1);
    }
    expect(det.repCount).toBe(3);
  });

  it('ignores a standing person facing the camera', () => {
    const sim = new Sim(new PushupDetector(), { standing: true });
    for (let i = 0; i < 4; i++) {
      sim.sweep(1, 0.4, 500, { standing: true });
      sim.sweep(0.4, 1, 500, { standing: true });
    }
    expect(sim.last.status).toBe('positioning');
    expect(sim.last.issue).toBe('not-in-position');
    expect(sim.last.reps).toBe(0);
  });

  it('never reports a body-alignment warning facing the camera', () => {
    const sim = new Sim();
    sim.activate();
    sim.rep();
    expect(sim.outputs.some((o) => o.cue === 'STRAIGHTEN_BODY')).toBe(false);
    expect(sim.last.alignmentDeviation).toBeNull();
  });

  it('switches views between sets and keeps counting', () => {
    const sim = new Sim();
    for (let i = 0; i < 40; i++) sim.side(170);
    expect(sim.last.status).toBe('active');
    sim.sideRep();
    sim.sideRep();
    expect(sim.last.reps).toBe(2);
    expect(sim.last.view).toBe('side');

    sim.hold(1, 800); // turn to face the camera, hold the top to re-arm
    expect(sim.last.view).toBe('front');
    sim.rep();
    sim.rep();
    expect(sim.last.reps).toBe(4);
  });
});

describe('PushupDetector – full-depth event', () => {
  it('fires once per rep even while holding at the bottom', () => {
    const sim = new Sim();
    sim.activate();
    sim.sweep(1, 0.4, 700);
    sim.hold(0.4, 2000); // stay at 100%
    sim.sweep(0.4, 1, 600);
    sim.hold(1, 300);
    sim.rep();
    expect(sim.outputs.filter((o) => o.fullDepthReached)).toHaveLength(2);
    expect(sim.last.reps).toBe(2);
  });

  it('does not re-fire when dipping again at the bottom of the same rep', () => {
    const sim = new Sim();
    sim.activate();
    sim.sweep(1, 0.4, 700);
    sim.sweep(0.4, 0.6, 300);
    sim.sweep(0.6, 0.4, 300);
    sim.sweep(0.4, 1, 600);
    sim.hold(1, 300);
    expect(sim.outputs.filter((o) => o.fullDepthReached)).toHaveLength(1);
  });

  it('does not fire for reps that stop short of full depth', () => {
    const sim = new Sim();
    sim.activate();
    sim.rep(0.75); // shallow
    sim.rep(0.5); // counts (≈90%) but not full depth
    expect(sim.last.reps).toBe(1);
    expect(sim.outputs.some((o) => o.fullDepthReached)).toBe(false);
  });

  it('fires in the side view too', () => {
    const sim = new Sim();
    for (let i = 0; i < 40; i++) sim.side(170);
    sim.sideRep();
    sim.sideRep();
    expect(sim.outputs.filter((o) => o.fullDepthReached)).toHaveLength(2);
  });
});

/**
 * Real-world conditions the idealized poses above don't cover. Each of these
 * reproduced "shows 100% at the bottom but never counts" before the fix.
 */
describe('PushupDetector – facing the camera, real-world conditions', () => {
  /** A rep where the extra options vary with shoulder height h (1 = top, 0.4 = bottom). */
  function repWith(sim: Sim, f: (h: number) => Partial<SyntheticFrontPoseOptions>, top = 1, bottom = 0.4) {
    const n = 21;
    for (let i = 1; i <= n; i++) { const h = top + ((bottom - top) * i) / n; sim.front(h, f(h)); }
    for (let i = 0; i < 3; i++) sim.front(bottom, f(bottom));
    for (let i = 1; i <= 18; i++) { const h = bottom + ((top - bottom) * i) / 18; sim.front(h, f(h)); }
    for (let i = 0; i < 30; i++) sim.front(top, f(top)); // pause ~1s at the top
  }

  it('counts when you look up at the phone at the top of each rep', () => {
    const sim = new Sim();
    const look = (h: number) => ({ noseRise: 0.15 + 0.75 * Math.max(0, (h - 0.4) / 0.6) });
    sim.hold(1, 1200, look(1));
    for (let i = 0; i < 4; i++) repWith(sim, look);
    expect(sim.last.reps).toBe(4);
  });

  it('counts when hidden hips are guessed below the shoulders', () => {
    const sim = new Sim(new PushupDetector(), { hipDrop: 1.0, hipVisibility: 0.65 });
    sim.hold(1, 1200);
    for (let i = 0; i < 4; i++) sim.rep();
    expect(sim.last.reps).toBe(4);
  });

  it('counts when the top position ends up lower than when the set started', () => {
    const sim = new Sim(new PushupDetector(), { noisePx: 3, rng: seededRng(5) });
    sim.hold(1.08, 1200); // started with shoulders pushed extra high
    for (let i = 0; i < 4; i++) repWith(sim, () => ({}), 0.95);
    expect(sim.last.reps).toBe(4);
  });

  it('detects the front view with realistic (narrower) shoulder width', () => {
    const sim = new Sim(new PushupDetector(), { spanRatio: 0.52 });
    sim.hold(1, 1200);
    expect(sim.last.view).toBe('front');
    for (let i = 0; i < 3; i++) sim.rep();
    expect(sim.last.reps).toBe(3);
  });

  it('counts continuous reps with no pause at a drifted-down top', () => {
    const sim = new Sim(new PushupDetector(), { noisePx: 3, rng: seededRng(21) });
    sim.hold(1.08, 1200);
    for (let r = 0; r < 6; r++) {
      sim.sweep(0.95, 0.4, 650);
      sim.sweep(0.4, 0.95, 550);
    }
    sim.hold(0.95, 600);
    expect(sim.last.reps).toBe(6);
    expect(sim.outputs.filter((o) => o.repCounted)).toHaveLength(6);
  });

  it('does not double count while hovering near the thresholds with jitter', () => {
    const sim = new Sim(new PushupDetector(), { noisePx: 5, rng: seededRng(33) });
    sim.activate();
    sim.sweep(1, 0.88, 300);
    sim.hold(0.88, 1500); // hovering around the top band
    sim.sweep(0.88, 0.5, 400);
    sim.hold(0.5, 1500); // hovering around min depth
    sim.sweep(0.5, 0.42, 200);
    sim.hold(0.42, 1000);
    sim.sweep(0.42, 0.85, 500);
    sim.hold(0.85, 1500); // hovering just below the top on the way up
    sim.sweep(0.85, 1, 300);
    sim.hold(1, 1500);
    expect(sim.last.reps).toBe(1);
  });

  it('counts with everything at once', () => {
    const sim = new Sim(new PushupDetector(), { spanRatio: 0.55, hipDrop: 1.0, hipVisibility: 0.65, noisePx: 3, rng: seededRng(9) });
    const look = (h: number) => ({ noseRise: 0.15 + 0.75 * Math.max(0, (h - 0.4) / 0.6) });
    sim.hold(1.06, 1200, look(1));
    for (let i = 0; i < 5; i++) repWith(sim, look, 0.96);
    expect(sim.last.reps).toBe(5);
  });

  it('still ignores a standing person facing the camera', () => {
    const sim = new Sim(new PushupDetector(), { standing: true, spanRatio: 0.55 });
    for (let i = 0; i < 4; i++) {
      sim.sweep(1, 0.4, 500, { standing: true });
      sim.sweep(0.4, 1, 500, { standing: true });
    }
    expect(sim.last.status).toBe('positioning');
    expect(sim.last.reps).toBe(0);
  });
});
