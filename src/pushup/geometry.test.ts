import { describe, expect, it } from 'vitest';
import { OneEuroFilter } from './filters';
import { angleAt, normalize, tiltFromHorizontal } from './geometry';

describe('geometry', () => {
  it('computes interior angles', () => {
    expect(angleAt({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(180);
    expect(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
    expect(angleAt({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(45);
  });

  it('returns NaN for degenerate segments', () => {
    expect(angleAt({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNaN();
  });

  it('measures tilt from horizontal regardless of direction', () => {
    expect(tiltFromHorizontal({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0);
    expect(tiltFromHorizontal({ x: 10, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(0);
    expect(tiltFromHorizontal({ x: 0, y: 0 }, { x: 0, y: 5 })).toBeCloseTo(90);
    expect(tiltFromHorizontal({ x: 0, y: 0 }, { x: -1, y: -1 })).toBeCloseTo(45);
  });

  it('normalizes and clamps, including reversed ranges', () => {
    expect(normalize(155, 155, 90)).toBe(0);
    expect(normalize(90, 155, 90)).toBe(1);
    expect(normalize(122.5, 155, 90)).toBeCloseTo(0.5);
    expect(normalize(180, 155, 90)).toBe(0);
    expect(normalize(40, 155, 90)).toBe(1);
  });
});

describe('OneEuroFilter', () => {
  it('converges to a constant signal', () => {
    const f = new OneEuroFilter(1, 0.02);
    let v = 0;
    for (let i = 0; i < 120; i++) v = f.filter(50, i * 33);
    expect(v).toBeCloseTo(50, 1);
  });

  it('reduces jitter on a still signal', () => {
    const f = new OneEuroFilter(1, 0.02);
    const outs: number[] = [];
    for (let i = 0; i < 200; i++) outs.push(f.filter(50 + (i % 2 ? 3 : -3), i * 33));
    const tail = outs.slice(100);
    const spread = Math.max(...tail) - Math.min(...tail);
    expect(spread).toBeLessThan(3);
  });

  it('follows fast movement without excessive lag', () => {
    const f = new OneEuroFilter(1.2, 0.02);
    let v = 0;
    // 0 → 100 over ~600ms, then hold 150ms
    for (let i = 0; i <= 18; i++) v = f.filter((i / 18) * 100, i * 33);
    for (let i = 19; i < 24; i++) v = f.filter(100, i * 33);
    expect(v).toBeGreaterThan(85);
  });
});
