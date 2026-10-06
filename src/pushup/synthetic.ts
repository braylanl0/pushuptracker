/**
 * Synthetic side-view push-up poses for tests (not used by the app).
 *
 * Builds a 2D stick figure in pixel space with the requested elbow angle, then
 * converts it to normalized MediaPipe-style landmarks. Geometry:
 *   - wrist fixed on the floor, forearm vertical
 *   - upper arm rotates so the elbow angle equals `elbowAngle`
 *   - straight body line from shoulder to an ankle resting on the floor
 */
import { SIDE_INDICES, type PoseLandmark, type Side } from './landmarks';

export interface SyntheticPoseOptions {
  elbowAngle: number;
  width?: number;
  height?: number;
  /** Which side faces the camera (gets high visibility). */
  nearSide?: Side;
  nearVisibility?: number;
  farVisibility?: number;
  /** Pushes the hip down (+) or up (-) off the straight body line, in pixels. */
  hipOffsetPx?: number;
  /** Standing upright instead of a plank. */
  standing?: boolean;
  /** Hide these joints on the near side (visibility 0). */
  hide?: Array<keyof (typeof SIDE_INDICES)['left']>;
  /** Per-coordinate noise amplitude in pixels. */
  noisePx?: number;
  rng?: () => number;
}

export function syntheticPose(opts: SyntheticPoseOptions): PoseLandmark[] {
  const W = opts.width ?? 1280;
  const H = opts.height ?? 720;
  const nearSide = opts.nearSide ?? 'left';
  const farSide: Side = nearSide === 'left' ? 'right' : 'left';
  const L = 0.12 * Math.min(W, H * 16 / 9); // forearm == upper arm length
  const floorY = H * 0.85;
  const theta = (opts.elbowAngle * Math.PI) / 180;

  let pts: Record<'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle', { x: number; y: number }>;

  if (opts.standing) {
    const cx = W * 0.5;
    pts = {
      shoulder: { x: cx, y: H * 0.3 },
      elbow: { x: cx + L * 0.1, y: H * 0.3 + L },
      wrist: { x: cx + L * 0.5, y: H * 0.3 + L * 0.8 },
      hip: { x: cx, y: H * 0.55 },
      knee: { x: cx, y: H * 0.72 },
      ankle: { x: cx, y: H * 0.9 },
    };
  } else {
    const wrist = { x: W * 0.3, y: floorY };
    const elbow = { x: wrist.x, y: wrist.y - L };
    const shoulder = { x: elbow.x - L * Math.sin(theta), y: elbow.y + L * Math.cos(theta) };
    const bodyLen = 3.3 * L;
    const ankleY = floorY - 0.15 * L;
    const dy = ankleY - shoulder.y;
    const dx = Math.sqrt(Math.max(bodyLen * bodyLen - dy * dy, 0));
    const ankle = { x: shoulder.x + dx, y: ankleY };
    const hipOnLine = { x: shoulder.x + 0.45 * dx, y: shoulder.y + 0.45 * dy };
    const hip = { x: hipOnLine.x, y: hipOnLine.y + (opts.hipOffsetPx ?? 0) };
    const knee = { x: hip.x + 0.55 * (ankle.x - hip.x), y: hip.y + 0.55 * (ankle.y - hip.y) };
    pts = { shoulder, elbow, wrist, hip, knee, ankle };
  }

  const rng = opts.rng ?? Math.random;
  const noise = () => (opts.noisePx ? (rng() * 2 - 1) * opts.noisePx : 0);

  const out: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.3, visibility: 0.2 }));
  out[0] = { x: (pts.shoulder.x - L * 0.6) / W, y: pts.shoulder.y / H, visibility: 0.9 };
  const hidden = new Set(opts.hide ?? []);
  for (const joint of Object.keys(pts) as Array<keyof typeof pts>) {
    const p = pts[joint];
    out[SIDE_INDICES[nearSide][joint]] = {
      x: (p.x + noise()) / W,
      y: (p.y + noise()) / H,
      visibility: hidden.has(joint) ? 0 : (opts.nearVisibility ?? 0.95),
    };
    // Far side: nearly the same 2D position, lower confidence.
    out[SIDE_INDICES[farSide][joint]] = {
      x: (p.x + 4 + noise()) / W,
      y: (p.y - 3 + noise()) / H,
      visibility: opts.farVisibility ?? 0.55,
    };
  }
  return out;
}

/** Deterministic PRNG so noisy tests are reproducible. */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
