export interface Point {
  x: number;
  y: number;
}

/**
 * Interior angle at `b` formed by the segments b→a and b→c, in degrees (0..180).
 * e.g. angleAt(shoulder, elbow, wrist) is the elbow angle: ~180 = straight arm.
 * Returns NaN if either segment has zero length.
 */
export function angleAt(a: Point, b: Point, c: Point): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y);
  const n2 = Math.hypot(v2x, v2y);
  if (n1 === 0 || n2 === 0) return NaN;
  const cos = (v1x * v2x + v1y * v2y) / (n1 * n2);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Angle between the line a→b and the horizontal, folded into 0..90°.
 * 0 = perfectly horizontal (plank), 90 = vertical (standing).
 */
export function tiltFromHorizontal(a: Point, b: Point): number {
  const deg = (Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)) * 180) / Math.PI;
  return deg;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear map of `v` from [inA, inB] to [0, 1], clamped. Works for inA > inB too. */
export function normalize(v: number, inA: number, inB: number): number {
  if (inA === inB) return 0;
  return clamp((v - inA) / (inB - inA), 0, 1) + 0; // + 0 turns -0 into 0
}
