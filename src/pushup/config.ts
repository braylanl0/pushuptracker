/**
 * Every tunable number used by the push-up detector lives here.
 *
 * Units:
 *   - angles are in degrees
 *   - depth values are percentages (0 = top of the push-up, 100 = full depth)
 *   - durations are milliseconds
 *   - visibility is MediaPipe's 0..1 landmark visibility score
 *
 * Turn on debug mode (dev builds, `?debug`) to see the live values these
 * thresholds are compared against while you tune them.
 */
export interface PushupConfig {
  // ── Landmark confidence ────────────────────────────────────────────────
  /** A joint counts as "seen" only above this visibility score. */
  minVisibility: number;
  /** Landmarks this far outside the image (normalized units) are rejected. */
  frameMargin: number;

  // ── Tracking side selection ────────────────────────────────────────────
  /** Only switch to the other side of the body if its smoothed confidence beats the current side by this much. Prevents left/right flip-flopping. */
  sideSwitchMargin: number;
  /** EMA factor for per-side confidence (0..1, higher = reacts faster). */
  sideScoreSmoothing: number;

  // ── Depth mapping ──────────────────────────────────────────────────────
  /** Elbow angle at the top of a push-up (arms locked). Angles >= this map to 0% depth. */
  topElbowAngle: number;
  /** Elbow angle that counts as full depth. Angles <= this map to 100% depth. ~90° is the usual "chest near floor" standard. */
  bottomElbowAngle: number;
  /**
   * Weight of the elbow-angle signal in the depth blend. The remaining weight
   * goes to the shoulder-drop signal (how far the shoulder has dropped toward
   * the wrist, relative to the arm length measured at the top). Shoulder drop
   * is only used once a top reference has been captured.
   */
  elbowDepthWeight: number;
  /** Shoulder must drop by this fraction of its top-position height above the wrist to count as 100% shoulder depth. */
  shoulderDropForFullDepth: number;

  // ── Smoothing (One Euro filter) ────────────────────────────────────────
  /** Lower = smoother but laggier when still. */
  smoothingMinCutoff: number;
  /** Higher = less lag during fast movement. */
  smoothingBeta: number;

  // ── Rep state machine (all on smoothed depth %) ────────────────────────
  /** At or below this depth you are "at the top". Used to arm the counter and to finish a rep. */
  topThreshold: number;
  /** Must exceed this depth to leave the top and start a rep. The gap to `topThreshold` is the hysteresis band that absorbs jitter. */
  descentStartThreshold: number;
  /** Minimum depth a rep must reach to count. 100% = `bottomElbowAngle`. */
  minRepDepth: number;
  /** Depth must fall this far below the deepest point before we call it a reversal. Stops jitter at the bottom from looking like "coming up". */
  reversalDelta: number;
  /** Reps faster than this (top → top) are treated as noise. */
  minRepDurationMs: number;
  /** Must be held at the top this long before the first rep can start. */
  topHoldMs: number;

  // ── Pose gating ────────────────────────────────────────────────────────
  /**
   * Max angle between the shoulder→hip line and horizontal. Push-ups (incl.
   * knee and mild incline push-ups) are roughly horizontal; standing up or
   * walking around is not, so movement while positioning is never counted.
   * ASSUMPTION: the phone is upright, so image "down" ≈ gravity.
   */
  maxTorsoTiltDeg: number;

  // ── Positioning (before the set starts) ────────────────────────────────
  /** Good tracking + plank + arms extended must hold this long before the set starts. */
  readyHoldMs: number;
  /** Tracking dropouts shorter than this don't restart the hold (one bad frame shouldn't). */
  readyDropoutToleranceMs: number;

  // ── Lost tracking ──────────────────────────────────────────────────────
  /** Brief dropouts shorter than this keep the current rep alive. Longer ones cancel the rep in progress (no count) and require returning to the top. */
  lostGraceMs: number;

  // ── Body alignment (shoulder → hip → ankle) ────────────────────────────
  /** Deviation from a straight line (degrees) before "Straighten your body" shows. Deliberately generous: it's a hint, not a rep requirement. */
  alignmentToleranceDeg: number;
  /** Alignment must be off for this long before the hint appears. */
  alignmentHintDelayMs: number;

  // ── Coaching ───────────────────────────────────────────────────────────
  /** How long "REP COMPLETE" stays on screen. */
  repCompleteCueMs: number;
  /** Smoothed depth at which a rep counts as "full depth" (fires the full-depth sound once per rep). */
  fullDepthThreshold: number;

  // ── View detection (side-on vs facing the camera) ──────────────────────
  /**
   * The view is decided from (shoulder-to-shoulder distance) / (arm length)
   * in the image. Side-on, the two shoulders overlap (ratio ≈ 0–0.3); facing
   * the camera they're a full shoulder-width apart (ratio ≈ 0.5–0.65). Switch to
   * front above `frontViewEnter`, back to side below `sideViewEnter`; the gap
   * between them stops flip-flopping at a diagonal angle.
   */
  frontViewEnter: number;
  sideViewEnter: number;
  /** EMA factor for the view ratio (0..1, higher = reacts faster). */
  viewSmoothing: number;

  // ── Front-facing depth ─────────────────────────────────────────────────
  /**
   * Facing the camera, the 2D elbow angle is unreliable (a bent, tucked arm
   * points at the camera and still looks straight), so depth comes from how
   * far the shoulders drop toward the wrists, measured in shoulder-widths
   * (stays constant as you move nearer/further) and compared with the top
   * position. 0.55 = shoulders drop 55% of their top height ≈ a 90° elbow.
   */
  frontDropForFullDepth: number;
  /** While positioning facing the camera, visible elbows must be at least this straight to start. */
  frontReadyElbowAngle: number;
  /**
   * "Standing, not in a plank" checks (facing the camera). Only joints at
   * least this confident count as evidence: when you're in a plank your hips
   * and legs are hidden behind you, and the pose model guesses where they
   * are (low confidence), often wrongly placing them below the shoulders.
   */
  frontStandingEvidenceVisibility: number;
  /** Standing if confidently-seen hips are more than this many shoulder-widths below the shoulders. */
  frontMaxHipDrop: number;
  /** Standing if confidently-seen knees/ankles are more than this many shoulder-widths below the shoulders. */
  frontMaxLegDrop: number;

  /**
   * Facing the camera, the "top" is re-learned from where you actually stop:
   * if the shoulders stay still (slower than `frontSettleSpeed` top-heights
   * per second for `frontSettleMs`) within `frontSettleMaxDepth`% of the top,
   * that's your top, and a rep coming up to it completes. Likewise, turning
   * back down within `frontSettleMaxDepth`% of the top completes the rep.
   * This keeps counting reliable when your top position drifts during a set.
   */
  frontSettleSpeed: number;
  frontSettleMs: number;
  frontSettleMaxDepth: number;
}

export const DEFAULT_PUSHUP_CONFIG: PushupConfig = {
  minVisibility: 0.5,
  frameMargin: 0.02,

  sideSwitchMargin: 0.12,
  sideScoreSmoothing: 0.15,

  topElbowAngle: 155,
  bottomElbowAngle: 90,
  elbowDepthWeight: 0.75,
  shoulderDropForFullDepth: 0.45,

  smoothingMinCutoff: 1.2,
  smoothingBeta: 0.02,

  topThreshold: 15,
  descentStartThreshold: 25,
  minRepDepth: 80,
  reversalDelta: 8,
  minRepDurationMs: 450,
  topHoldMs: 250,

  maxTorsoTiltDeg: 50,

  readyHoldMs: 800,
  readyDropoutToleranceMs: 250,

  lostGraceMs: 700,

  alignmentToleranceDeg: 28,
  alignmentHintDelayMs: 600,

  repCompleteCueMs: 700,
  fullDepthThreshold: 97,

  frontViewEnter: 0.45,
  sideViewEnter: 0.3,
  viewSmoothing: 0.15,

  frontDropForFullDepth: 0.55,
  frontReadyElbowAngle: 150,
  frontStandingEvidenceVisibility: 0.8,
  frontMaxHipDrop: 1.2,
  frontMaxLegDrop: 2.0,

  frontSettleSpeed: 0.15,
  frontSettleMs: 250,
  frontSettleMaxDepth: 40,
};
