/**
 * Push-up detector: turns a stream of pose landmarks into
 *   - a live 0–100% depth reading,
 *   - a rep count driven by a state machine,
 *   - a single coaching cue.
 *
 * It is pure TypeScript (no DOM, no MediaPipe), so it can be unit-tested by
 * feeding it synthetic poses. See detector.test.ts.
 *
 * ─── Pipeline (per frame) ─────────────────────────────────────────────────
 *
 *  1. Pick the tracking side. The camera sees the user side-on, so one arm is
 *     usually much clearer than the other. We keep a smoothed confidence
 *     score per side and only switch when the other side is clearly better.
 *
 *  2. Gate on confidence. Shoulder, elbow, wrist and hip on that side must be
 *     visible and inside the frame. If not, depth is `null` — we never guess.
 *
 *  3. Gate on pose. The shoulder→hip line must be roughly horizontal and the
 *     wrist below the shoulder. This is what stops movement while you walk
 *     back from the phone or stand up from being counted.
 *
 *  4. Measure depth. Mostly from the elbow angle (top ≈ straight arm,
 *     bottom ≈ 90°), blended with how far the shoulder has dropped toward the
 *     wrist compared to the top position. Mapped to 0–100%, clamped, then
 *     smoothed with a One Euro filter.
 *
 *  5. Run the rep state machine on the smoothed depth:
 *
 *        SETUP ──(held at top)──▶ UP ──(depth > descentStart)──▶ DESCENDING
 *                                  ▲                                │
 *                                  │                    (depth ≥ minRepDepth)
 *                                  │                                ▼
 *          REP +1 ◀──(depth ≤ top)── ASCENDING ◀──(reversal)──── BOTTOM
 *
 *     - `topThreshold` vs `descentStartThreshold` is a hysteresis band: jitter
 *       near the top can't start/finish reps.
 *     - A reversal requires depth to fall `reversalDelta` below the deepest
 *       point, so jitter at the bottom doesn't count as "coming up".
 *     - Reversing before `minRepDepth` is a shallow rep: it's tracked (cue
 *       "GO LOWER") but never counted.
 *     - A rep is counted exactly once, on the ASCENDING → UP transition. To
 *       count again, depth has to travel all the way through the bands again,
 *       so threshold jitter cannot double count.
 *
 *  6. Lost tracking: short dropouts (< `lostGraceMs`) freeze the state
 *     machine. Longer ones cancel any rep in progress and fall back to SETUP,
 *     which requires returning to the top before counting resumes.
 */

import { DEFAULT_PUSHUP_CONFIG, type PushupConfig } from './config';
import { OneEuroFilter } from './filters';
import { angleAt, clamp, distance, normalize, tiltFromHorizontal, type Point } from './geometry';
import { SIDE_INDICES, type PoseLandmark, type Side } from './landmarks';

export type Phase = 'SETUP' | 'UP' | 'DESCENDING' | 'BOTTOM' | 'ASCENDING';

/** `positioning` = waiting for the user to get in frame; nothing is counted. */
export type SessionStatus = 'positioning' | 'active';

export type TrackingIssue =
  | 'none'
  | 'no-body' // no person detected / almost nothing visible
  | 'partial' // some key joints missing or off-screen
  | 'not-in-position'; // body visible but not in a push-up posture

export type Cue =
  | 'STEP_BACK'
  | 'SHOW_FULL_BODY'
  | 'GET_INTO_POSITION'
  | 'STRAIGHTEN_ARMS'
  | 'HOLD'
  | 'READY'
  | 'GO'
  | 'LOWER'
  | 'GO_LOWER'
  | 'GOOD_DEPTH'
  | 'PUSH_UP'
  | 'REP_COMPLETE'
  | 'BODY_NOT_VISIBLE'
  | 'STRAIGHTEN_BODY';

export interface PoseFrame {
  /** Normalized landmarks for one person, or null if no pose was detected. */
  landmarks: readonly PoseLandmark[] | null;
  /** Source image size in pixels. Needed so angles aren't distorted by aspect ratio. */
  width: number;
  height: number;
  timeMs: number;
}

export interface DetectorOutput {
  status: SessionStatus;
  tracking: 'good' | 'lost';
  issue: TrackingIssue;
  phase: Phase;
  reps: number;
  /** True only on the single frame where a rep was counted. */
  repCounted: boolean;
  /** Smoothed depth 0–100, or null when tracking isn't confident. */
  depth: number | null;
  /** Unsmoothed depth 0–100 (debug). */
  rawDepth: number | null;
  /** Smoothed elbow angle in degrees (debug). */
  elbowAngle: number | null;
  /** Degrees away from a straight shoulder→hip→ankle line. */
  alignmentDeviation: number | null;
  /** Angle of shoulder→hip line vs horizontal (debug). */
  torsoTilt: number | null;
  side: Side;
  /** Lowest visibility among the required joints on the tracked side. */
  confidence: number;
  /** Depth velocity in %/s (positive = going down). */
  velocity: number;
  cue: Cue;
  /** 0..1 progress of the "hold still" check while positioning. */
  readyProgress: number;
}

const REQUIRED_JOINTS = ['shoulder', 'elbow', 'wrist', 'hip'] as const;

export class PushupDetector {
  readonly config: PushupConfig;

  private status: SessionStatus = 'positioning';
  private phase: Phase = 'SETUP';
  private reps = 0;
  private repPeaks: number[] = [];

  private side: Side = 'left';
  private sideScore: Record<Side, number> = { left: 0, right: 0 };

  private depthFilter: OneEuroFilter;
  private angleFilter: OneEuroFilter;
  private alignFilter: OneEuroFilter;

  /** Shoulder height above wrist (in arm lengths) at the top position. */
  private topShoulderRatio: number | null = null;

  // Timers (ms timestamps, null = not running)
  private lostSince: number | null = null;
  private readySince: number | null = null;
  private topSince: number | null = null;
  private misalignedSince: number | null = null;
  private repCompleteUntil = -Infinity;
  private activatedAt = -Infinity;

  // Per-attempt bookkeeping
  private lastTopTime = 0;
  private attemptStart = 0;
  private attemptPeak = 0;
  private reachedDepth = false;
  /** Running extreme used for reversal detection (max while going down, min while going up). */
  private extreme = 0;

  private lastCue: Cue = 'STEP_BACK';

  constructor(config: Partial<PushupConfig> = {}) {
    this.config = { ...DEFAULT_PUSHUP_CONFIG, ...config };
    const c = this.config;
    this.depthFilter = new OneEuroFilter(c.smoothingMinCutoff, c.smoothingBeta);
    // Angles are in degrees; their velocity range is similar to depth %, so the same beta works.
    this.angleFilter = new OneEuroFilter(c.smoothingMinCutoff, c.smoothingBeta);
    this.alignFilter = new OneEuroFilter(1, 0.01);
  }

  get repCount(): number {
    return this.reps;
  }

  /** Peak depth (0–100) of every counted rep, in order. */
  getRepDepths(): number[] {
    return [...this.repPeaks];
  }

  update(frame: PoseFrame): DetectorOutput {
    const c = this.config;
    const t = frame.timeMs;
    const lms = frame.landmarks;

    if (!lms || lms.length < 29) return this.lost(t, 'no-body');

    // ── 1. Side selection ────────────────────────────────────────────────
    const leftOk = this.sideUsable(lms, 'left');
    const rightOk = this.sideUsable(lms, 'right');
    for (const s of ['left', 'right'] as const) {
      const raw = this.sideRawScore(lms, s);
      this.sideScore[s] += c.sideScoreSmoothing * (raw - this.sideScore[s]);
    }
    const other: Side = this.side === 'left' ? 'right' : 'left';
    const currentOk = this.side === 'left' ? leftOk : rightOk;
    const otherOk = other === 'left' ? leftOk : rightOk;
    if (
      (!currentOk && otherOk) ||
      this.sideScore[other] > this.sideScore[this.side] + c.sideSwitchMargin
    ) {
      this.side = other;
    }

    // ── 2. Confidence gate ───────────────────────────────────────────────
    if (!(this.side === 'left' ? leftOk : rightOk)) {
      const anyVisible = countVisible(lms, c) >= 4;
      return this.lost(t, anyVisible ? 'partial' : 'no-body');
    }

    const idx = SIDE_INDICES[this.side];
    const px = (i: number): Point => ({ x: lms[i].x * frame.width, y: lms[i].y * frame.height });
    const shoulder = px(idx.shoulder);
    const elbow = px(idx.elbow);
    const wrist = px(idx.wrist);
    const hip = px(idx.hip);
    // Prefer the ankle for alignment; fall back to the knee (e.g. feet cut off or knee push-ups).
    const lowerIdx = this.visible(lms[idx.ankle])
      ? idx.ankle
      : this.visible(lms[idx.knee])
        ? idx.knee
        : null;
    const lower = lowerIdx !== null ? px(lowerIdx) : null;

    // ── 3. Pose gate ─────────────────────────────────────────────────────
    const armLength = distance(shoulder, elbow) + distance(elbow, wrist);
    const torsoTilt = tiltFromHorizontal(shoulder, hip);
    // Shoulder height above the wrist, in arm lengths (image y grows downward).
    const shoulderRatio = armLength > 0 ? (wrist.y - shoulder.y) / armLength : 0;
    const inPushupPose = torsoTilt <= c.maxTorsoTiltDeg && shoulderRatio > -0.15;
    if (!inPushupPose) return this.lost(t, 'not-in-position', torsoTilt);

    // ── 4. Depth measurement ─────────────────────────────────────────────
    const rawAngle = angleAt(shoulder, elbow, wrist);
    if (!Number.isFinite(rawAngle)) return this.lost(t, 'partial');

    // A long gap means the filter's history is stale; start fresh.
    if (this.lostSince !== null && t - this.lostSince > c.lostGraceMs) {
      this.depthFilter.reset();
      this.angleFilter.reset();
      this.alignFilter.reset();
    }
    this.lostSince = null;

    const elbowDepth = normalize(rawAngle, c.topElbowAngle, c.bottomElbowAngle);
    let rawDepth = elbowDepth;
    if (this.topShoulderRatio !== null && this.topShoulderRatio > 0.2) {
      const drop = (this.topShoulderRatio - shoulderRatio) / (this.topShoulderRatio * c.shoulderDropForFullDepth);
      const shoulderDepth = clamp(drop, 0, 1);
      rawDepth = c.elbowDepthWeight * elbowDepth + (1 - c.elbowDepthWeight) * shoulderDepth;
    }
    rawDepth *= 100;
    const depth = clamp(this.depthFilter.filter(rawDepth, t), 0, 100);
    const elbowAngle = this.angleFilter.filter(rawAngle, t);

    let alignmentDeviation: number | null = null;
    if (lower) {
      const a = angleAt(shoulder, hip, lower);
      if (Number.isFinite(a)) alignmentDeviation = this.alignFilter.filter(180 - a, t);
    }
    const misaligned = alignmentDeviation !== null && alignmentDeviation > c.alignmentToleranceDeg;
    if (misaligned) this.misalignedSince ??= t;
    else this.misalignedSince = null;

    // ── 5a. Positioning: wait for a steady plank at the top ──────────────
    let readyProgress = this.status === 'active' ? 1 : 0;
    let repCounted = false;

    if (this.status === 'positioning') {
      const atTop = depth <= c.topThreshold;
      if (lower && atTop) {
        this.readySince ??= t;
        // Average the top shoulder height while holding, for the depth blend.
        this.topShoulderRatio =
          this.topShoulderRatio === null ? shoulderRatio : lerp(this.topShoulderRatio, shoulderRatio, 0.2);
        readyProgress = clamp((t - this.readySince) / c.readyHoldMs, 0, 1);
        if (readyProgress >= 1) {
          this.status = 'active';
          this.phase = 'UP';
          this.activatedAt = t;
          this.lastTopTime = t;
        }
      } else {
        this.readySince = null;
        this.topShoulderRatio = null;
      }
    } else {
      // ── 5b. Rep state machine ──────────────────────────────────────────
      repCounted = this.step(depth, shoulderRatio, t);
    }

    const cue = this.pickCue(t, depth, lower !== null);
    this.lastCue = cue;

    return {
      status: this.status,
      tracking: 'good',
      issue: 'none',
      phase: this.phase,
      reps: this.reps,
      repCounted,
      depth,
      rawDepth: clamp(rawDepth, 0, 100),
      elbowAngle,
      alignmentDeviation,
      torsoTilt,
      side: this.side,
      confidence: this.sideConfidence(lms, this.side),
      velocity: this.depthFilter.velocity,
      cue,
      readyProgress,
    };
  }

  /** Advances the rep state machine. Returns true if a rep was counted on this frame. */
  private step(depth: number, shoulderRatio: number, t: number): boolean {
    const c = this.config;
    switch (this.phase) {
      case 'SETUP': {
        // Re-arming after lost tracking: must be held at the top first.
        if (depth <= c.topThreshold) {
          this.topSince ??= t;
          if (t - this.topSince >= c.topHoldMs) {
            this.phase = 'UP';
            this.lastTopTime = t;
            this.topSince = null;
          }
        } else {
          this.topSince = null;
        }
        return false;
      }

      case 'UP': {
        if (depth <= c.topThreshold) {
          this.lastTopTime = t;
          // Slowly track the top shoulder height (people shift hand placement).
          if (this.topShoulderRatio !== null) {
            this.topShoulderRatio = lerp(this.topShoulderRatio, shoulderRatio, 0.05);
          }
        }
        if (depth >= c.descentStartThreshold) {
          this.phase = 'DESCENDING';
          this.attemptStart = this.lastTopTime;
          this.attemptPeak = depth;
          this.extreme = depth;
          this.reachedDepth = false;
        }
        return false;
      }

      case 'DESCENDING': {
        this.attemptPeak = Math.max(this.attemptPeak, depth);
        this.extreme = Math.max(this.extreme, depth);
        if (depth >= c.minRepDepth) {
          this.phase = 'BOTTOM';
          this.reachedDepth = true;
        } else if (depth <= this.extreme - c.reversalDelta) {
          // Turned around before reaching depth: shallow rep, won't count.
          this.phase = 'ASCENDING';
          this.extreme = depth;
        }
        return false;
      }

      case 'BOTTOM': {
        this.attemptPeak = Math.max(this.attemptPeak, depth);
        this.extreme = Math.max(this.extreme, depth);
        if (depth <= this.extreme - c.reversalDelta) {
          this.phase = 'ASCENDING';
          this.extreme = depth;
        }
        return false;
      }

      case 'ASCENDING': {
        this.extreme = Math.min(this.extreme, depth);
        if (depth <= c.topThreshold) {
          this.phase = 'UP';
          this.lastTopTime = t;
          const longEnough = t - this.attemptStart >= c.minRepDurationMs;
          if (this.reachedDepth && longEnough) {
            this.reps += 1;
            this.repPeaks.push(Math.round(this.attemptPeak));
            this.repCompleteUntil = t + c.repCompleteCueMs;
            return true;
          }
          return false;
        }
        if (depth >= this.extreme + c.reversalDelta) {
          // Went back down mid-ascent; same attempt continues.
          this.extreme = depth;
          this.phase = depth >= c.minRepDepth ? 'BOTTOM' : 'DESCENDING';
          if (this.phase === 'BOTTOM') this.reachedDepth = true;
        }
        return false;
      }
    }
  }

  private pickCue(t: number, depth: number, lowerVisible: boolean): Cue {
    const c = this.config;
    if (this.status === 'positioning') {
      if (!lowerVisible) return 'SHOW_FULL_BODY';
      if (depth > c.topThreshold) return 'STRAIGHTEN_ARMS';
      return 'HOLD';
    }
    if (t < this.repCompleteUntil) return 'REP_COMPLETE';
    if (this.misalignedSince !== null && t - this.misalignedSince >= c.alignmentHintDelayMs) {
      return 'STRAIGHTEN_BODY';
    }
    switch (this.phase) {
      case 'SETUP':
        return depth > c.topThreshold ? 'STRAIGHTEN_ARMS' : 'READY';
      case 'UP':
        return this.reps === 0 && t - this.activatedAt < 1200 ? 'READY' : 'GO';
      case 'DESCENDING':
        return 'LOWER';
      case 'BOTTOM':
        return 'GOOD_DEPTH';
      case 'ASCENDING':
        return this.reachedDepth ? 'PUSH_UP' : 'GO_LOWER';
    }
  }

  /** Handles a frame where we can't (or shouldn't) measure depth. */
  private lost(t: number, issue: TrackingIssue, torsoTilt: number | null = null): DetectorOutput {
    const c = this.config;
    this.lostSince ??= t;
    const lostFor = t - this.lostSince;

    this.readySince = null;
    this.topSince = null;
    this.misalignedSince = null;
    if (this.status === 'positioning') this.topShoulderRatio = null;

    // Long dropout: cancel any rep in progress. Nothing is counted.
    if (this.status === 'active' && lostFor > c.lostGraceMs) {
      this.phase = 'SETUP';
      this.reachedDepth = false;
    }

    let cue: Cue;
    if (this.status === 'positioning') {
      cue = issue === 'not-in-position' ? 'GET_INTO_POSITION' : issue === 'partial' ? 'SHOW_FULL_BODY' : 'STEP_BACK';
    } else if (lostFor <= c.lostGraceMs) {
      cue = this.lastCue; // don't flicker on a one-frame dropout
    } else {
      cue = issue === 'not-in-position' ? 'GET_INTO_POSITION' : 'BODY_NOT_VISIBLE';
    }
    this.lastCue = cue;

    return {
      status: this.status,
      tracking: 'lost',
      issue,
      phase: this.phase,
      reps: this.reps,
      repCounted: false,
      depth: null,
      rawDepth: null,
      elbowAngle: null,
      alignmentDeviation: null,
      torsoTilt,
      side: this.side,
      confidence: 0,
      velocity: 0,
      cue,
      readyProgress: 0,
    };
  }

  private visible(lm: PoseLandmark | undefined): boolean {
    if (!lm) return false;
    const m = this.config.frameMargin;
    const inFrame = lm.x >= -m && lm.x <= 1 + m && lm.y >= -m && lm.y <= 1 + m;
    return inFrame && (lm.visibility ?? 1) >= this.config.minVisibility;
  }

  private sideUsable(lms: readonly PoseLandmark[], side: Side): boolean {
    const idx = SIDE_INDICES[side];
    return REQUIRED_JOINTS.every((j) => this.visible(lms[idx[j]]));
  }

  private sideRawScore(lms: readonly PoseLandmark[], side: Side): number {
    const idx = SIDE_INDICES[side];
    let sum = 0;
    for (const j of REQUIRED_JOINTS) sum += this.visible(lms[idx[j]]) ? (lms[idx[j]].visibility ?? 1) : 0;
    return sum / REQUIRED_JOINTS.length;
  }

  private sideConfidence(lms: readonly PoseLandmark[], side: Side): number {
    const idx = SIDE_INDICES[side];
    return Math.min(...REQUIRED_JOINTS.map((j) => lms[idx[j]].visibility ?? 1));
  }
}

function countVisible(lms: readonly PoseLandmark[], c: PushupConfig): number {
  let n = 0;
  for (const side of ['left', 'right'] as const) {
    for (const i of Object.values(SIDE_INDICES[side])) {
      const lm = lms[i];
      if (lm && (lm.visibility ?? 1) >= c.minVisibility && lm.x >= 0 && lm.x <= 1 && lm.y >= 0 && lm.y <= 1) n++;
    }
  }
  return n;
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}
