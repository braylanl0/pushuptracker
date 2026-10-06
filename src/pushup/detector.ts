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
 *  0. Pick the view. Works out whether you're side-on to the camera or facing
 *     it, from how far apart the two shoulders are relative to arm length.
 *     The view only changes between reps (never mid-rep).
 *
 *  1–4. Measure, using the logic for that view:
 *
 *     SIDE-ON (measureSide)
 *       1. Pick the tracking side. One arm is usually much clearer than the
 *          other, so we keep a smoothed confidence per side and only switch
 *          when the other side is clearly better.
 *       2. Gate on confidence: shoulder, elbow, wrist and hip on that side
 *          must be visible and in frame. If not, depth is `null`; we never
 *          guess.
 *       3. Gate on pose: the shoulder→hip line must be roughly horizontal
 *          and the wrist below the shoulder. Stops movement while you walk
 *          back from the phone or stand up from being counted.
 *       4. Depth: mostly the elbow angle (top ≈ straight arm, bottom ≈ 90°),
 *          blended with how far the shoulder dropped toward the wrist.
 *
 *     FACING THE CAMERA (measureFront)
 *       1. Uses both sides: both shoulders, and whichever wrists/elbows are
 *          visible (averaged, weighted by confidence).
 *       2. Gate on confidence: both shoulders and at least one wrist.
 *       3. Gate on pose: wrists below shoulders, and not standing (hips/legs
 *          confidently seen far below the shoulders). Head-on, the hips and
 *          legs are hidden behind you, so only confident joints count.
 *       4. Depth: how far the shoulders dropped toward the wrists, in
 *          shoulder-widths, compared with the top position. (The 2D elbow
 *          angle can't be trusted head-on: a tucked arm bending toward the
 *          camera still looks straight.) The top is re-learned from where
 *          you actually stop or turn around, so a drifting top position
 *          can't stop reps from completing.
 *
 *     Either way depth is mapped to 0–100%, clamped, and smoothed with a One
 *     Euro filter.
 *
 *  5. Run the rep state machine on the smoothed depth (shared by both views):
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
 *     - `fullDepthReached` fires once per rep, the first time depth reaches
 *       `fullDepthThreshold` (used for the full-depth sound).
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

/** How the user is oriented relative to the camera. */
export type View = 'side' | 'front';

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
  /** True only on the single frame where the current rep first reached full depth. */
  fullDepthReached: boolean;
  /** Smoothed depth 0–100, or null when tracking isn't confident. */
  depth: number | null;
  /** Unsmoothed depth 0–100 (debug). */
  rawDepth: number | null;
  /** Smoothed elbow angle in degrees (debug). Facing the camera: mean of visible arms. */
  elbowAngle: number | null;
  /** Degrees away from a straight shoulder→hip→ankle line. Side view only. */
  alignmentDeviation: number | null;
  /** Angle of shoulder→hip line vs horizontal (debug, side view). */
  torsoTilt: number | null;
  view: View;
  /** Smoothed shoulder-span / arm-length ratio that decides the view (debug). */
  viewScore: number | null;
  /** Tracked side in the side view (both sides are used facing the camera). */
  side: Side;
  /** Lowest visibility among the required joints. */
  confidence: number;
  /** Depth velocity in %/s (positive = going down). */
  velocity: number;
  cue: Cue;
  /** 0..1 progress of the "hold still" check while positioning. */
  readyProgress: number;
}

/** One frame's measurement from whichever view is active. */
interface Measurement {
  /** 0–100, unsmoothed. */
  rawDepth: number;
  /** Raw elbow angle (degrees), or null if not measurable. */
  elbowAngle: number | null;
  /** Raw deviation from a straight body line (side view only). */
  alignmentDeviation: number | null;
  torsoTilt: number | null;
  /** Everything needed to start the set is in view (side: lower body; front: arms straight). */
  readyOk: boolean;
  /** Side view: shoulder height above the wrist in arm lengths (for calibration). */
  shoulderRatio: number;
  confidence: number;
}

interface Lost {
  lost: TrackingIssue;
  torsoTilt?: number | null;
}

const REQUIRED_JOINTS = ['shoulder', 'elbow', 'wrist', 'hip'] as const;

export class PushupDetector {
  readonly config: PushupConfig;

  private status: SessionStatus = 'positioning';
  private phase: Phase = 'SETUP';
  private reps = 0;
  private repPeaks: number[] = [];

  private view: View = 'side';
  private viewScore: number | null = null;

  private side: Side = 'left';
  private sideScore: Record<Side, number> = { left: 0, right: 0 };

  private depthFilter: OneEuroFilter;
  private angleFilter: OneEuroFilter;
  private alignFilter: OneEuroFilter;
  /** Smooths the front-view shoulder height so the top reference isn't pushed around by noise. */
  private frontRatioFilter = new OneEuroFilter(1.5, 0.3);

  /** Side view: shoulder height above wrist (in arm lengths) at the top position. */
  private topShoulderRatio: number | null = null;
  /** Front view: shoulder height above wrists (in shoulder-widths) at the top position. */
  private frontTopRatio: number | null = null;
  private frontSmoothedRatio = 0;
  /** When the shoulders (front view) last started holding still, or null if moving. */
  private frontStillSince: number | null = null;
  /** Front-view shoulder height at the shallowest point of the current ascent. */
  private extremeRatio = 0;

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
  private fullDepthFired = false;
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

    // ── 0. View ──────────────────────────────────────────────────────────
    this.updateView(lms, frame);
    this.updateSideSelection(lms);

    // ── 1–4. Measure ─────────────────────────────────────────────────────
    let m = this.view === 'front' ? this.measureFront(lms, frame, t) : this.measureSide(lms, frame);
    // Facing-camera tracking needs both shoulders. If one disappeared because
    // the user turned side-on, fall back to the side view (between reps only).
    if (
      'lost' in m &&
      m.lost !== 'not-in-position' &&
      this.view === 'front' &&
      this.canSwitchView() &&
      this.sideUsable(lms, this.side)
    ) {
      this.setView('side');
      m = this.measureSide(lms, frame);
    }
    if ('lost' in m) return this.lost(t, m.lost, m.torsoTilt ?? null);

    // A long gap means the filter's history is stale; start fresh.
    if (this.lostSince !== null && t - this.lostSince > c.lostGraceMs) {
      this.depthFilter.reset();
      this.angleFilter.reset();
      this.alignFilter.reset();
    }
    this.lostSince = null;

    const depth = clamp(this.depthFilter.filter(m.rawDepth, t), 0, 100);
    const elbowAngle = m.elbowAngle === null ? null : this.angleFilter.filter(m.elbowAngle, t);

    let alignmentDeviation: number | null = null;
    if (m.alignmentDeviation !== null) alignmentDeviation = this.alignFilter.filter(m.alignmentDeviation, t);
    const misaligned = alignmentDeviation !== null && alignmentDeviation > c.alignmentToleranceDeg;
    if (misaligned) this.misalignedSince ??= t;
    else this.misalignedSince = null;

    // ── 5a. Positioning: wait for a steady plank at the top ──────────────
    let readyProgress = this.status === 'active' ? 1 : 0;
    let repCounted = false;
    let fullDepthReached = false;

    if (this.status === 'positioning') {
      const atTop = depth <= c.topThreshold || this.settledNearTop(t, depth);
      if (m.readyOk && atTop) {
        this.readySince ??= t;
        if (this.view === 'side') {
          // Average the top shoulder height while holding, for the depth blend.
          this.topShoulderRatio =
            this.topShoulderRatio === null ? m.shoulderRatio : lerp(this.topShoulderRatio, m.shoulderRatio, 0.2);
        }
        readyProgress = clamp((t - this.readySince) / c.readyHoldMs, 0, 1);
        if (readyProgress >= 1) {
          this.status = 'active';
          this.phase = 'UP';
          this.activatedAt = t;
          this.lastTopTime = t;
        }
      } else {
        this.readySince = null;
        if (this.view === 'side') this.topShoulderRatio = null;
      }
    } else {
      // ── 5b. Rep state machine ──────────────────────────────────────────
      repCounted = this.step(depth, m, t);
      if (
        !this.fullDepthFired &&
        (this.phase === 'DESCENDING' || this.phase === 'BOTTOM' || this.phase === 'ASCENDING') &&
        depth >= c.fullDepthThreshold
      ) {
        this.fullDepthFired = true;
        fullDepthReached = true;
      }
    }

    const cue = this.pickCue(t, depth, m.readyOk);
    this.lastCue = cue;

    return {
      status: this.status,
      tracking: 'good',
      issue: 'none',
      phase: this.phase,
      reps: this.reps,
      repCounted,
      fullDepthReached,
      depth,
      rawDepth: clamp(m.rawDepth, 0, 100),
      elbowAngle,
      alignmentDeviation,
      torsoTilt: m.torsoTilt,
      view: this.view,
      viewScore: this.viewScore,
      side: this.side,
      confidence: m.confidence,
      velocity: this.depthFilter.velocity,
      cue,
      readyProgress,
    };
  }

  // ── View selection ─────────────────────────────────────────────────────

  private updateView(lms: readonly PoseLandmark[], frame: PoseFrame): void {
    const c = this.config;
    const L = SIDE_INDICES.left;
    const R = SIDE_INDICES.right;
    if (!this.visible(lms[L.shoulder]) || !this.visible(lms[R.shoulder])) return;

    const px = (i: number): Point => ({ x: lms[i].x * frame.width, y: lms[i].y * frame.height });
    let armLength = 0;
    for (const idx of [L, R]) {
      if (this.visible(lms[idx.elbow]) && this.visible(lms[idx.wrist])) {
        const len = distance(px(idx.shoulder), px(idx.elbow)) + distance(px(idx.elbow), px(idx.wrist));
        armLength = Math.max(armLength, len);
      }
    }
    if (armLength <= 0) return;

    const ratio = distance(px(L.shoulder), px(R.shoulder)) / armLength;
    this.viewScore = this.viewScore === null ? ratio : lerp(this.viewScore, ratio, c.viewSmoothing);

    const wanted: View =
      this.viewScore > c.frontViewEnter ? 'front' : this.viewScore < c.sideViewEnter ? 'side' : this.view;
    if (wanted !== this.view && this.canSwitchView()) this.setView(wanted);
  }

  /** Never change the measuring method in the middle of a rep. */
  private canSwitchView(): boolean {
    return this.status === 'positioning' || this.phase === 'UP' || this.phase === 'SETUP';
  }

  private setView(view: View): void {
    this.view = view;
    // Depth from the two views isn't directly comparable: recalibrate and re-arm.
    this.depthFilter.reset();
    this.angleFilter.reset();
    this.alignFilter.reset();
    this.frontRatioFilter.reset();
    this.frontTopRatio = null;
    this.frontStillSince = null;
    this.topShoulderRatio = null;
    this.readySince = null;
    this.topSince = null;
    this.misalignedSince = null;
    if (this.status === 'active') this.phase = 'SETUP';
  }

  // ── Side-on measurement ────────────────────────────────────────────────

  private updateSideSelection(lms: readonly PoseLandmark[]): void {
    const c = this.config;
    for (const s of ['left', 'right'] as const) {
      const raw = this.sideRawScore(lms, s);
      this.sideScore[s] += c.sideScoreSmoothing * (raw - this.sideScore[s]);
    }
    const other: Side = this.side === 'left' ? 'right' : 'left';
    const currentOk = this.sideUsable(lms, this.side);
    const otherOk = this.sideUsable(lms, other);
    if ((!currentOk && otherOk) || this.sideScore[other] > this.sideScore[this.side] + c.sideSwitchMargin) {
      this.side = other;
    }
  }

  private measureSide(lms: readonly PoseLandmark[], frame: PoseFrame): Measurement | Lost {
    const c = this.config;

    // Confidence gate
    if (!this.sideUsable(lms, this.side)) {
      return { lost: countVisible(lms, c) >= 4 ? 'partial' : 'no-body' };
    }

    const idx = SIDE_INDICES[this.side];
    const px = (i: number): Point => ({ x: lms[i].x * frame.width, y: lms[i].y * frame.height });
    const shoulder = px(idx.shoulder);
    const elbow = px(idx.elbow);
    const wrist = px(idx.wrist);
    const hip = px(idx.hip);
    // Prefer the ankle for alignment; fall back to the knee (e.g. feet cut off or knee push-ups).
    const lowerIdx = this.visible(lms[idx.ankle]) ? idx.ankle : this.visible(lms[idx.knee]) ? idx.knee : null;
    const lower = lowerIdx !== null ? px(lowerIdx) : null;

    // Pose gate
    const armLength = distance(shoulder, elbow) + distance(elbow, wrist);
    const torsoTilt = tiltFromHorizontal(shoulder, hip);
    // Shoulder height above the wrist, in arm lengths (image y grows downward).
    const shoulderRatio = armLength > 0 ? (wrist.y - shoulder.y) / armLength : 0;
    const inPushupPose = torsoTilt <= c.maxTorsoTiltDeg && shoulderRatio > -0.15;
    if (!inPushupPose) return { lost: 'not-in-position', torsoTilt };

    // Depth
    const rawAngle = angleAt(shoulder, elbow, wrist);
    if (!Number.isFinite(rawAngle)) return { lost: 'partial' };

    const elbowDepth = normalize(rawAngle, c.topElbowAngle, c.bottomElbowAngle);
    let rawDepth = elbowDepth;
    if (this.topShoulderRatio !== null && this.topShoulderRatio > 0.2) {
      const drop = (this.topShoulderRatio - shoulderRatio) / (this.topShoulderRatio * c.shoulderDropForFullDepth);
      const shoulderDepth = clamp(drop, 0, 1);
      rawDepth = c.elbowDepthWeight * elbowDepth + (1 - c.elbowDepthWeight) * shoulderDepth;
    }

    let alignmentDeviation: number | null = null;
    if (lower) {
      const a = angleAt(shoulder, hip, lower);
      if (Number.isFinite(a)) alignmentDeviation = 180 - a;
    }

    return {
      rawDepth: rawDepth * 100,
      elbowAngle: rawAngle,
      alignmentDeviation,
      torsoTilt,
      readyOk: lower !== null,
      shoulderRatio,
      confidence: Math.min(...REQUIRED_JOINTS.map((j) => lms[idx[j]].visibility ?? 1)),
    };
  }

  // ── Facing-the-camera measurement ──────────────────────────────────────

  private measureFront(lms: readonly PoseLandmark[], frame: PoseFrame, t: number): Measurement | Lost {
    const c = this.config;
    const L = SIDE_INDICES.left;
    const R = SIDE_INDICES.right;
    const px = (i: number): Point => ({ x: lms[i].x * frame.width, y: lms[i].y * frame.height });

    // Confidence gate: both shoulders + at least one wrist.
    if (!this.visible(lms[L.shoulder]) || !this.visible(lms[R.shoulder])) {
      return { lost: countVisible(lms, c) >= 4 ? 'partial' : 'no-body' };
    }
    const ls = px(L.shoulder);
    const rs = px(R.shoulder);
    const span = distance(ls, rs);
    if (span < 0.02 * Math.min(frame.width, frame.height)) return { lost: 'partial' };
    const mid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };

    // Use both arms where visible, weighted by confidence.
    let ratioSum = 0;
    let weightSum = 0;
    const angles: number[] = [];
    let confidence = Math.min(lms[L.shoulder].visibility ?? 1, lms[R.shoulder].visibility ?? 1);
    for (const idx of [L, R]) {
      const wristLm = lms[idx.wrist];
      if (!this.visible(wristLm)) continue;
      const shoulder = px(idx.shoulder);
      const wrist = px(idx.wrist);
      const w = wristLm.visibility ?? 1;
      ratioSum += ((wrist.y - shoulder.y) / span) * w;
      weightSum += w;
      confidence = Math.min(confidence, w);
      if (this.visible(lms[idx.elbow])) {
        const a = angleAt(shoulder, px(idx.elbow), wrist);
        if (Number.isFinite(a)) angles.push(a);
      }
    }
    if (weightSum === 0) return { lost: 'partial' };
    // Shoulder height above the wrists, in shoulder-widths.
    const ratio = ratioSum / weightSum;

    // Pose gate: wrists below shoulders, and not standing. Only confidently
    // seen hips/legs count: in a plank they're hidden and the model's guesses
    // for them are unreliable.
    if (ratio < -0.2) return { lost: 'not-in-position' };
    const confident = (i: number) =>
      this.visible(lms[i]) && (lms[i].visibility ?? 1) >= c.frontStandingEvidenceVisibility;
    const hips = [L.hip, R.hip].filter(confident).map(px);
    const legs = [L.knee, R.knee, L.ankle, R.ankle].filter(confident).map(px);
    if (hips.length > 0) {
      const hipY = hips.reduce((s, p) => s + p.y, 0) / hips.length;
      if (hipY - mid.y > c.frontMaxHipDrop * span) return { lost: 'not-in-position' };
    }
    if (legs.some((p) => p.y - mid.y > c.frontMaxLegDrop * span)) return { lost: 'not-in-position' };
    // (No head-height check: you naturally look up at the phone at the top of a rep.)

    // Top reference: the highest the shoulders have been (smoothed). It rises
    // quickly if you go higher, and creeps toward your current top position
    // between reps (see calibrateAtTop), so it self-corrects.
    this.frontSmoothedRatio = this.frontRatioFilter.filter(ratio, t);
    if (this.frontTopRatio === null) this.frontTopRatio = this.frontSmoothedRatio;
    else if (this.frontSmoothedRatio > this.frontTopRatio) {
      this.frontTopRatio = lerp(this.frontTopRatio, this.frontSmoothedRatio, 0.3);
    }

    // Track whether the shoulders are holding still (for re-learning the top).
    const speed = Math.abs(this.frontRatioFilter.velocity) / Math.max(this.frontTopRatio, 0.2);
    if (speed < c.frontSettleSpeed) this.frontStillSince ??= t;
    else this.frontStillSince = null;

    const top = this.frontTopRatio;
    const rawDepth = top > 0.2 ? clamp((top - ratio) / (top * c.frontDropForFullDepth), 0, 1) : 0;
    const elbowAngle = angles.length ? angles.reduce((a, b) => a + b, 0) / angles.length : null;

    return {
      rawDepth: rawDepth * 100,
      elbowAngle,
      alignmentDeviation: null,
      torsoTilt: null,
      // Before the set starts, require straight-looking arms so a bent hold isn't taken as "the top".
      readyOk: elbowAngle === null || elbowAngle >= c.frontReadyElbowAngle,
      shoulderRatio: ratio,
      confidence,
    };
  }

  /**
   * Front view: true once the shoulders have held still near the top. Whatever
   * height they settled at becomes the new top reference.
   */
  private settledNearTop(t: number, depth: number): boolean {
    const c = this.config;
    const settled =
      this.view === 'front' &&
      this.frontStillSince !== null &&
      t - this.frontStillSince >= c.frontSettleMs &&
      depth <= c.frontSettleMaxDepth;
    if (settled) this.frontTopRatio = this.frontSmoothedRatio;
    return settled;
  }

  /** Slowly tracks the top position between reps (people shift hand placement). */
  private calibrateAtTop(m: Measurement): void {
    if (this.view === 'side') {
      if (this.topShoulderRatio !== null) this.topShoulderRatio = lerp(this.topShoulderRatio, m.shoulderRatio, 0.05);
    } else if (this.frontTopRatio !== null) {
      this.frontTopRatio = lerp(this.frontTopRatio, this.frontSmoothedRatio, 0.05);
    }
  }

  // ── Rep state machine ──────────────────────────────────────────────────

  /** Advances the rep state machine. Returns true if a rep was counted on this frame. */
  private step(depth: number, m: Measurement, t: number): boolean {
    const c = this.config;
    switch (this.phase) {
      case 'SETUP': {
        // Re-arming after lost tracking or a view change: must be held at the top first.
        if (depth <= c.topThreshold || this.settledNearTop(t, depth)) {
          this.topSince ??= t;
          if (t - this.topSince >= c.topHoldMs) {
            this.phase = 'UP';
            this.lastTopTime = t;
            this.topSince = null;
            if (this.view === 'side') this.topShoulderRatio ??= m.shoulderRatio;
          }
        } else {
          this.topSince = null;
        }
        return false;
      }

      case 'UP': {
        if (depth <= c.topThreshold) {
          this.lastTopTime = t;
          this.calibrateAtTop(m);
        } else if (this.settledNearTop(t, depth)) {
          this.lastTopTime = t; // front view: the top has drifted; follow it
        }
        if (depth >= c.descentStartThreshold) {
          this.phase = 'DESCENDING';
          this.attemptStart = this.lastTopTime;
          this.attemptPeak = depth;
          this.extreme = depth;
          this.reachedDepth = false;
          this.fullDepthFired = false;
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
        if (depth < this.extreme) {
          this.extreme = depth;
          this.extremeRatio = this.frontSmoothedRatio;
        }
        const longEnough = t - this.attemptStart >= c.minRepDurationMs;
        if (depth <= c.topThreshold || this.settledNearTop(t, depth)) {
          this.phase = 'UP';
          this.lastTopTime = t;
          if (this.reachedDepth && longEnough) {
            this.countRep(t);
            return true;
          }
          return false;
        }
        if (depth >= this.extreme + c.reversalDelta) {
          // Front view: turning back down close to the top means the rep is
          // done (continuous reps without a pause). That turning point is the
          // real top, so re-learn it, count, and start the next rep.
          if (this.view === 'front' && this.reachedDepth && longEnough && this.extreme <= c.frontSettleMaxDepth) {
            this.frontTopRatio = this.extremeRatio;
            this.countRep(t);
            this.phase = 'DESCENDING';
            this.attemptStart = t;
            this.attemptPeak = depth;
            this.extreme = depth;
            this.reachedDepth = false;
            this.fullDepthFired = false;
            return true;
          }
          // Went back down mid-ascent; same attempt continues.
          this.extreme = depth;
          this.phase = depth >= c.minRepDepth ? 'BOTTOM' : 'DESCENDING';
          if (this.phase === 'BOTTOM') this.reachedDepth = true;
        }
        return false;
      }
    }
  }

  private countRep(t: number): void {
    this.reps += 1;
    this.repPeaks.push(Math.round(this.attemptPeak));
    this.repCompleteUntil = t + this.config.repCompleteCueMs;
  }

  private pickCue(t: number, depth: number, readyOk: boolean): Cue {
    const c = this.config;
    if (this.status === 'positioning') {
      if (!readyOk) return this.view === 'side' ? 'SHOW_FULL_BODY' : 'STRAIGHTEN_ARMS';
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

    // A single dropped frame shouldn't restart the positioning hold.
    if (lostFor > c.readyDropoutToleranceMs) {
      this.readySince = null;
      if (this.status === 'positioning') this.topShoulderRatio = null;
    }
    this.topSince = null;
    this.misalignedSince = null;

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
      fullDepthReached: false,
      depth: null,
      rawDepth: null,
      elbowAngle: null,
      alignmentDeviation: null,
      torsoTilt,
      view: this.view,
      viewScore: this.viewScore,
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
