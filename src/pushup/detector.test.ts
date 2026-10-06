import { describe, expect, it } from 'vitest';
import { PushupDetector, type DetectorOutput } from './detector';
import { seededRng, syntheticPose, type SyntheticPoseOptions } from './synthetic';

const FPS = 30;
const DT = 1000 / FPS;
const W = 1280;
const H = 720;

/** Feeds frames to a detector and keeps the clock. */
class Sim {
  t = 0;
  outputs: DetectorOutput[] = [];
  constructor(
    public det = new PushupDetector(),
    public base: Partial<SyntheticPoseOptions> = {},
  ) {}

  frame(opts: Partial<SyntheticPoseOptions> & { elbowAngle: number }, missing = false): DetectorOutput {
    const lms = missing ? null : syntheticPose({ width: W, height: H, ...this.base, ...opts });
    const out = this.det.update({ landmarks: lms, width: W, height: H, timeMs: this.t });
    this.outputs.push(out);
    this.t += DT;
    return out;
  }

  hold(elbowAngle: number, ms: number, extra: Partial<SyntheticPoseOptions> = {}) {
    for (let i = 0; i < ms / DT; i++) this.frame({ ...extra, elbowAngle });
  }

  /** Linearly sweep the elbow angle from a to b over `ms`. */
  sweep(a: number, b: number, ms: number, extra: Partial<SyntheticPoseOptions> = {}) {
    const n = Math.max(1, Math.round(ms / DT));
    for (let i = 1; i <= n; i++) this.frame({ ...extra, elbowAngle: a + ((b - a) * i) / n });
  }

  missing(ms: number) {
    for (let i = 0; i < ms / DT; i++) this.frame({ elbowAngle: 170 }, true);
  }

  rep(bottom = 80, downMs = 700, upMs = 600) {
    this.sweep(170, bottom, downMs);
    this.hold(bottom, 100);
    this.sweep(bottom, 170, upMs);
    this.hold(170, 300);
  }

  /** Gets the detector into the active state at the top. */
  activate() {
    this.hold(170, 1200);
    expect(this.last.status).toBe('active');
  }

  get last() {
    return this.outputs[this.outputs.length - 1];
  }
}

describe('PushupDetector – positioning', () => {
  it('starts in positioning and does not count while no body is visible', () => {
    const sim = new Sim();
    sim.missing(500);
    expect(sim.last.status).toBe('positioning');
    expect(sim.last.cue).toBe('STEP_BACK');
    expect(sim.last.depth).toBeNull();
  });

  it('becomes active only after holding a plank at the top', () => {
    const sim = new Sim();
    sim.hold(170, 400);
    expect(sim.last.status).toBe('positioning');
    expect(sim.last.cue).toBe('HOLD');
    expect(sim.last.readyProgress).toBeGreaterThan(0);
    sim.hold(170, 800);
    expect(sim.last.status).toBe('active');
    expect(sim.last.cue).toBe('READY');
  });

  it('asks for the full body when ankles and knees are not visible', () => {
    const sim = new Sim(new PushupDetector(), { hide: ['ankle', 'knee'], farVisibility: 0.1 });
    sim.hold(170, 1500);
    expect(sim.last.status).toBe('positioning');
    expect(sim.last.cue).toBe('SHOW_FULL_BODY');
  });

  it('does not activate while arms are bent', () => {
    const sim = new Sim();
    sim.hold(110, 1500);
    expect(sim.last.status).toBe('positioning');
    expect(sim.last.cue).toBe('STRAIGHTEN_ARMS');
  });

  it('ignores a standing person moving their arms', () => {
    const sim = new Sim(new PushupDetector(), { standing: true });
    for (let i = 0; i < 5; i++) {
      sim.sweep(170, 70, 500, { standing: true });
      sim.sweep(70, 170, 500, { standing: true });
    }
    expect(sim.last.status).toBe('positioning');
    expect(sim.last.issue).toBe('not-in-position');
    expect(sim.last.reps).toBe(0);
  });
});

describe('PushupDetector – depth', () => {
  it('maps top to ~0% and full depth to ~100%', () => {
    const sim = new Sim();
    sim.activate();
    expect(sim.last.depth!).toBeLessThan(5);
    sim.sweep(170, 90, 600);
    sim.hold(90, 600);
    expect(sim.last.depth!).toBeGreaterThan(95);
  });

  it('reads roughly halfway at a half-bent elbow', () => {
    const sim = new Sim();
    sim.activate();
    sim.sweep(170, 122, 500);
    sim.hold(122, 800);
    expect(sim.last.depth!).toBeGreaterThan(40);
    expect(sim.last.depth!).toBeLessThan(65);
  });

  it('is always clamped to 0..100', () => {
    const sim = new Sim();
    sim.activate();
    sim.sweep(170, 40, 400);
    sim.hold(40, 400);
    sim.sweep(40, 180, 400);
    for (const o of sim.outputs) {
      if (o.depth !== null) {
        expect(o.depth).toBeGreaterThanOrEqual(0);
        expect(o.depth).toBeLessThanOrEqual(100);
      }
    }
  });

  it('returns null depth (never guesses) when key joints are low confidence', () => {
    const sim = new Sim(new PushupDetector(), { nearVisibility: 0.3, farVisibility: 0.3 });
    sim.hold(170, 500);
    expect(sim.last.depth).toBeNull();
    expect(sim.last.tracking).toBe('lost');
  });
});

describe('PushupDetector – rep counting', () => {
  it('counts clean reps exactly once each', () => {
    const sim = new Sim();
    sim.activate();
    for (let i = 0; i < 5; i++) sim.rep();
    expect(sim.last.reps).toBe(5);
    expect(sim.outputs.filter((o) => o.repCounted)).toHaveLength(5);
  });

  it('walks through the expected phases for one rep', () => {
    const sim = new Sim();
    sim.activate();
    sim.rep();
    const phases = sim.outputs.map((o) => o.phase).filter((p, i, arr) => p !== arr[i - 1]);
    expect(phases).toEqual(['SETUP', 'UP', 'DESCENDING', 'BOTTOM', 'ASCENDING', 'UP']);
  });

  it('does not count shallow reps', () => {
    const sim = new Sim();
    sim.activate();
    for (let i = 0; i < 3; i++) sim.rep(130);
    expect(sim.last.reps).toBe(0);
    expect(sim.outputs.some((o) => o.cue === 'GO_LOWER')).toBe(true);
  });

  it('does not count tiny arm movements at the top', () => {
    const sim = new Sim();
    sim.activate();
    for (let i = 0; i < 10; i++) {
      sim.sweep(170, 150, 200);
      sim.sweep(150, 170, 200);
    }
    expect(sim.last.reps).toBe(0);
  });

  it('does not double count when holding near thresholds with heavy jitter', () => {
    const rng = seededRng(42);
    const sim = new Sim(new PushupDetector(), { noisePx: 6, rng });
    sim.activate();
    // Hover around the top threshold, then the bottom threshold, then the top again.
    sim.sweep(170, 143, 300);
    sim.hold(143, 1500);
    sim.sweep(143, 100, 400);
    sim.hold(100, 1500);
    sim.sweep(100, 85, 300);
    sim.hold(85, 1000);
    sim.sweep(85, 170, 600);
    sim.hold(170, 1500);
    expect(sim.last.reps).toBe(1);
  });

  it('counts reps reliably with noisy landmarks', () => {
    const rng = seededRng(7);
    const sim = new Sim(new PushupDetector(), { noisePx: 4, rng });
    sim.activate();
    for (let i = 0; i < 8; i++) sim.rep(82, 650, 550);
    expect(sim.last.reps).toBe(8);
  });

  it('ignores impossibly fast rep glitches', () => {
    const sim = new Sim();
    sim.activate();
    sim.sweep(170, 80, 130);
    sim.sweep(80, 170, 130);
    sim.hold(170, 300);
    expect(sim.last.reps).toBe(0);
  });

  it('counts a rep that pauses and dips again at the bottom only once', () => {
    const sim = new Sim();
    sim.activate();
    sim.sweep(170, 85, 600);
    sim.sweep(85, 115, 300); // partial push up
    sim.sweep(115, 85, 300); // back down
    sim.sweep(85, 170, 600);
    sim.hold(170, 300);
    expect(sim.last.reps).toBe(1);
  });

  it('records per-rep peak depth', () => {
    const sim = new Sim();
    sim.activate();
    sim.rep(80);
    sim.rep(100);
    const depths = sim.det.getRepDepths();
    expect(depths).toHaveLength(2);
    expect(depths[0]).toBeGreaterThanOrEqual(95);
    expect(depths[1]).toBeGreaterThan(70);
    expect(depths[1]).toBeLessThan(depths[0]);
  });
});

describe('PushupDetector – lost tracking', () => {
  it('survives a brief dropout mid-rep and still counts', () => {
    const sim = new Sim();
    sim.activate();
    sim.sweep(170, 80, 700);
    sim.missing(200);
    expect(sim.last.depth).toBeNull();
    sim.hold(80, 100);
    sim.sweep(80, 170, 600);
    sim.hold(170, 300);
    expect(sim.last.reps).toBe(1);
  });

  it('cancels the rep after a long dropout and requires returning to the top', () => {
    const sim = new Sim();
    sim.activate();
    sim.sweep(170, 80, 700);
    sim.missing(1500);
    expect(sim.last.cue).toBe('BODY_NOT_VISIBLE');
    expect(sim.last.phase).toBe('SETUP');
    // Comes back at the bottom and pushes up: no rep (didn't see the descent).
    sim.hold(80, 300);
    sim.sweep(80, 170, 600);
    sim.hold(170, 500);
    expect(sim.last.reps).toBe(0);
    // Next full rep counts normally.
    sim.rep();
    expect(sim.last.reps).toBe(1);
  });

  it('does not count while the user stands up mid-set', () => {
    const sim = new Sim();
    sim.activate();
    sim.rep();
    for (let i = 0; i < 4; i++) {
      sim.sweep(170, 70, 500, { standing: true });
      sim.sweep(70, 170, 500, { standing: true });
    }
    expect(sim.last.reps).toBe(1);
    expect(sim.last.cue).toBe('GET_INTO_POSITION');
  });
});

describe('PushupDetector – side selection & alignment', () => {
  it('tracks the side with better confidence', () => {
    const sim = new Sim(new PushupDetector(), { nearSide: 'right' });
    sim.hold(170, 1500);
    expect(sim.last.side).toBe('right');
  });

  it('does not flip-flop between sides when confidences are close', () => {
    const sim = new Sim(new PushupDetector(), { nearVisibility: 0.8, farVisibility: 0.75 });
    sim.hold(170, 2000);
    const switches = sim.outputs.filter((o, i) => i > 0 && o.side !== sim.outputs[i - 1].side);
    expect(switches.length).toBeLessThanOrEqual(1);
  });

  it('flags a strongly sagging body without blocking reps', () => {
    const sim = new Sim(new PushupDetector(), { hipOffsetPx: 90 });
    sim.activate();
    sim.hold(170, 1000);
    expect(sim.last.alignmentDeviation!).toBeGreaterThan(28);
    expect(sim.last.cue).toBe('STRAIGHTEN_BODY');
    sim.rep();
    sim.rep();
    expect(sim.last.reps).toBe(2);
  });

  it('does not flag a straight body', () => {
    const sim = new Sim();
    sim.activate();
    sim.rep();
    expect(sim.outputs.some((o) => o.cue === 'STRAIGHTEN_BODY')).toBe(false);
    expect(sim.last.alignmentDeviation!).toBeLessThan(5);
  });

  it('works with a portrait camera frame', () => {
    const det = new PushupDetector();
    let t = 0;
    const feed = (angle: number) => {
      const out = det.update({
        landmarks: syntheticPose({ elbowAngle: angle, width: 720, height: 1280 }),
        width: 720,
        height: 1280,
        timeMs: t,
      });
      t += DT;
      return out;
    };
    for (let i = 0; i < 40; i++) feed(170);
    for (let r = 0; r < 3; r++) {
      for (let a = 170; a >= 80; a -= 4) feed(a);
      for (let a = 80; a <= 170; a += 4) feed(a);
      for (let i = 0; i < 10; i++) feed(170);
    }
    expect(det.repCount).toBe(3);
  });
});
