import { SIDE_INDICES, SIDE_SEGMENTS, type PoseLandmark, type Side } from '../pushup/landmarks';

/**
 * How the video is fitted into its container. The canvas overlay uses the same
 * mapping so the skeleton sits exactly on top of the body.
 */
export interface Fit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Cover (edge-to-edge) unless that would crop away more than `maxCrop` of the
 * video. A landscape webcam in a tall phone-shaped window would lose the
 * user's feet, so we letterbox instead in that case.
 */
export function computeFit(videoW: number, videoH: number, boxW: number, boxH: number, maxCrop = 0.3): Fit {
  const cover = Math.max(boxW / videoW, boxH / videoH);
  const contain = Math.min(boxW / videoW, boxH / videoH);
  const visibleFraction = Math.min(boxW / (videoW * cover), boxH / (videoH * cover));
  const scale = 1 - visibleFraction > maxCrop ? contain : cover;
  return {
    scale,
    offsetX: (boxW - videoW * scale) / 2,
    offsetY: (boxH - videoH * scale) / 2,
  };
}

export interface OverlayStyle {
  accent: string;
  /** 0..1, brief accent flash after a rep is counted. */
  flash: number;
  /** Current depth 0..100 or null. Drawn as a small arc at the tracked elbow. */
  depth: number | null;
  minVisibility: number;
}

/**
 * Draws a subtle skeleton. The tracked side is brighter; the far side is
 * faint. Joints below the visibility threshold aren't drawn at all, so the
 * overlay never shows a "guessed" limb.
 */
export function drawPose(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly PoseLandmark[] | null,
  videoW: number,
  videoH: number,
  fit: Fit,
  trackedSide: Side | null,
  style: OverlayStyle,
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  if (!landmarks) return;

  const dpr = width / Math.max(1, ctx.canvas.clientWidth || width);
  const map = (lm: PoseLandmark) => ({
    x: (lm.x * videoW * fit.scale + fit.offsetX) * dpr,
    y: (lm.y * videoH * fit.scale + fit.offsetY) * dpr,
  });
  const ok = (lm: PoseLandmark | undefined): lm is PoseLandmark =>
    !!lm && (lm.visibility ?? 1) >= style.minVisibility;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const sides: Side[] = trackedSide === 'right' ? ['left', 'right'] : ['right', 'left'];
  for (const side of sides) {
    const tracked = side === trackedSide;
    const idx = SIDE_INDICES[side];
    ctx.strokeStyle = tracked
      ? style.flash > 0
        ? mixAccent(style.accent, style.flash)
        : 'rgba(255,255,255,0.72)'
      : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = (tracked ? 3 : 2) * dpr;
    ctx.beginPath();
    for (const [a, b] of SIDE_SEGMENTS) {
      const la = landmarks[idx[a]];
      const lb = landmarks[idx[b]];
      if (!ok(la) || !ok(lb)) continue;
      const pa = map(la);
      const pb = map(lb);
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();

    if (!tracked) continue;

    // Joints
    for (const key of Object.keys(idx) as Array<keyof typeof idx>) {
      const lm = landmarks[idx[key]];
      if (!ok(lm)) continue;
      const p = map(lm);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
    }

    // Depth arc around the elbow: fills as you go down.
    const sh = landmarks[idx.shoulder];
    const el = landmarks[idx.elbow];
    const wr = landmarks[idx.wrist];
    if (style.depth !== null && ok(sh) && ok(el) && ok(wr)) {
      const pe = map(el);
      const ps = map(sh);
      const pw = map(wr);
      const a1 = Math.atan2(ps.y - pe.y, ps.x - pe.x);
      const a2 = Math.atan2(pw.y - pe.y, pw.x - pe.x);
      let sweep = a2 - a1;
      while (sweep > Math.PI) sweep -= Math.PI * 2;
      while (sweep < -Math.PI) sweep += Math.PI * 2;
      ctx.beginPath();
      ctx.arc(pe.x, pe.y, 18 * dpr, a1, a1 + sweep, sweep < 0);
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = withAlpha(style.accent, 0.35 + 0.55 * (style.depth / 100));
      ctx.stroke();
    }
  }
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha.toFixed(3)})`;
}

function mixAccent(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(255 + (c - 255) * amount);
  return `rgba(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)},0.9)`;
}
