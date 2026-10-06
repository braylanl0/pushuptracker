import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { PushupDetector, type Cue, type DetectorOutput } from '../pushup/detector';
import type { PoseLandmark } from '../pushup/landmarks';
import { actualFacing, CameraError, countCameras, openCamera, stopStream, type FacingMode } from '../lib/camera';
import { loadPoseLandmarker } from '../lib/poseLandmarker';
import { loadPrefs, savePrefs } from '../lib/storage';
import { formatClock } from '../lib/format';
import { computeFit, drawPose } from './overlay';
import { CUE_COPY } from './cues';

export interface SetResult {
  reps: number;
  durationMs: number;
  repDepths: number[];
}

interface Props {
  bestReps: number | null;
  onFinish: (result: SetResult) => void;
  onCancel: () => void;
}

type Stage = 'camera' | 'model' | 'tracking';

interface ErrorInfo {
  title: string;
  body: string;
}

const ACCENT = '#C8FF2E';
/** Pose inference is capped at this rate; the video itself still renders at full rate. */
const MAX_INFERENCE_FPS = 30;
const DEBUG_AVAILABLE = import.meta.env.DEV;

export function WorkoutScreen({ bestReps, onFinish, onCancel }: Props) {
  const [stage, setStage] = useState<Stage>('camera');
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [active, setActive] = useState(false);
  const [reps, setReps] = useState(0);
  const [mirrored, setMirrored] = useState(true);
  const [canSwitch, setCanSwitch] = useState(false);
  const [switching, setSwitching] = useState(false);
  /** Model download progress in whole percent, null if unknown. */
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  const [debug, setDebug] = useState(
    () => DEBUG_AVAILABLE && new URLSearchParams(location.search).has('debug'),
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const depthRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);
  const posTitleRef = useRef<HTMLDivElement>(null);
  const posDetailRef = useRef<HTMLDivElement>(null);
  const readyBarRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const debugRef = useRef<HTMLPreElement>(null);

  const detectorRef = useRef<PushupDetector>(null);
  detectorRef.current ??= new PushupDetector();
  const streamRef = useRef<MediaStream | null>(null);
  const facingRef = useRef<FacingMode>(loadPrefs().facingMode);
  const startTimeRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const debugOnRef = useRef(debug);
  debugOnRef.current = debug;

  /** Puts a stream into the <video>, works out mirroring and whether switching is possible. */
  const attachStream = useCallback(async (stream: MediaStream) => {
    const video = videoRef.current!;
    streamRef.current = stream;
    video.srcObject = stream;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (mountedRef.current && streamRef.current === stream) {
        setError({ title: 'Camera disconnected', body: 'The camera stopped. Try again to reconnect.' });
      }
    });
    try {
      await video.play();
    } catch {
      // Autoplay can be blocked until metadata loads; the `autoPlay` attribute retries.
    }
    const facing = actualFacing(stream, facingRef.current);
    // Mirror the front camera so moving left moves left on screen.
    setMirrored(facing === 'user');
    countCameras().then((n) => mountedRef.current && setCanSwitch(n > 1));
  }, []);

  // ── Camera + model + frame loop ────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    let raf = 0;
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const detector = detectorRef.current!;
    setError(null);
    setStage('camera');

    // Load the model while the camera permission prompt is up; it's cached after the first time.
    let lastPct: number | null = -1;
    const modelPromise = loadPoseLandmarker((fraction) => {
      const pct = fraction === null ? null : Math.floor(fraction * 100);
      if (pct !== lastPct && !cancelled) {
        lastPct = pct;
        setModelProgress(pct);
      }
    });
    modelPromise.catch(() => {});

    // Frame-loop state lives in plain variables, not React state: nothing here
    // re-renders React per frame. HUD text is written straight to the DOM.
    let lastVideoTime = -1;
    let lastInference = 0;
    let lastTimestamp = 0;
    let flashUntil = 0;
    let fps = 0;
    let lastDebug = 0;
    let lastCue: Cue | null = null;
    let lastStatus = '';
    let lastDepthText = '';
    let fitMode = '';

    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(canvas);

    const renderHud = (out: DetectorOutput, landmarks: readonly PoseLandmark[] | null, now: number) => {
      // Overlay
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const fit = computeFit(vw, vh, canvas.clientWidth, canvas.clientHeight);
      const mode = fit.scale === Math.max(canvas.clientWidth / vw, canvas.clientHeight / vh) ? 'cover' : 'contain';
      if (mode !== fitMode) {
        fitMode = mode;
        video.style.objectFit = mode;
      }
      drawPose(ctx, landmarks, vw, vh, fit, out.tracking === 'good' ? out.side : null, {
        accent: ACCENT,
        flash: Math.max(0, (flashUntil - now) / 350),
        depth: out.depth,
        minVisibility: detector.config.minVisibility,
      });

      // Depth readout
      const depthText = out.depth === null ? '––' : String(Math.round(out.depth));
      if (depthText !== lastDepthText) {
        lastDepthText = depthText;
        depthRef.current!.textContent = depthText;
      }
      barRef.current!.style.transform = `scaleX(${(out.depth ?? 0) / 100})`;
      barRef.current!.dataset.lost = String(out.depth === null);
      barRef.current!.dataset.deep = String((out.depth ?? 0) >= detector.config.minRepDepth);

      // Cue
      if (out.cue !== lastCue || out.status !== lastStatus) {
        lastCue = out.cue;
        lastStatus = out.status;
        const copy = CUE_COPY[out.cue];
        cueRef.current!.textContent = copy.title;
        cueRef.current!.dataset.tone = copy.tone;
        posTitleRef.current!.textContent = copy.title;
        posDetailRef.current!.textContent = copy.detail ?? '';
      }
      readyBarRef.current!.style.transform = `scaleX(${out.readyProgress})`;

      if (DEBUG_AVAILABLE && debugOnRef.current && now - lastDebug > 120) {
        lastDebug = now;
        const f = (v: number | null, d = 1) => (v === null ? '—' : v.toFixed(d));
        debugRef.current!.textContent = [
          `fps        ${fps.toFixed(0)}`,
          `status     ${out.status} / ${out.tracking}${out.issue !== 'none' ? ` (${out.issue})` : ''}`,
          `phase      ${out.phase}`,
          `side       ${out.side}`,
          `confidence ${out.confidence.toFixed(2)}`,
          `elbow      ${f(out.elbowAngle)}°`,
          `alignment  ${f(out.alignmentDeviation)}° off`,
          `torso tilt ${f(out.torsoTilt)}°`,
          `depth raw  ${f(out.rawDepth)}%`,
          `depth      ${f(out.depth)}%`,
          `velocity   ${out.velocity.toFixed(0)}%/s`,
          `reps       ${out.reps}  [${detector.getRepDepths().join(' ')}]`,
        ].join('\n');
      }
    };

    const tick = (landmarker: PoseLandmarker) => {
      if (cancelled) return;
      raf = requestAnimationFrame(() => tick(landmarker));
      if (video.readyState < 2 || video.videoWidth === 0) return;
      const now = performance.now();
      // Only run inference on new camera frames, and no faster than the cap.
      if (video.currentTime === lastVideoTime) return;
      if (now - lastInference < 1000 / MAX_INFERENCE_FPS - 2) return;
      const dt = now - lastInference;
      lastInference = now;
      lastVideoTime = video.currentTime;
      if (dt < 1000) fps += (1000 / dt - fps) * 0.1;

      // MediaPipe requires strictly increasing timestamps.
      const ts = Math.max(now, lastTimestamp + 1);
      lastTimestamp = ts;
      let landmarks: PoseLandmark[] | null = null;
      try {
        landmarks = landmarker.detectForVideo(video, ts).landmarks[0] ?? null;
      } catch (err) {
        console.warn('[pose] inference failed for a frame', err);
      }

      const out = detector.update({
        landmarks,
        width: video.videoWidth,
        height: video.videoHeight,
        timeMs: ts,
      });

      if (out.status === 'active' && startTimeRef.current === null) {
        startTimeRef.current = now;
        setActive(true);
      }
      if (out.repCounted) {
        flashUntil = now + 350;
        setReps(out.reps);
      }
      renderHud(out, landmarks, now);
    };

    (async () => {
      try {
        const stream = await openCamera(facingRef.current);
        if (cancelled) {
          stopStream(stream);
          return;
        }
        await attachStream(stream);
        if (cancelled) return;
        setStage('model');
        let landmarker: PoseLandmarker;
        try {
          landmarker = await modelPromise;
        } catch (err) {
          console.error('[pose] failed to load', err);
          throw new ModelLoadError();
        }
        if (cancelled) return;
        setStage('tracking');
        raf = requestAnimationFrame(() => tick(landmarker));
      } catch (err) {
        if (!cancelled) setError(describeError(err));
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      stopStream(streamRef.current);
      streamRef.current = null;
      video.srcObject = null;
      // Closes the detector whether it finished loading already or finishes later.
      modelPromise.then((l) => l.close()).catch(() => {});
    };
  }, [attempt, attachStream]);

  // ── Set clock ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (startTimeRef.current !== null && clockRef.current) {
        clockRef.current.textContent = formatClock(performance.now() - startTimeRef.current);
      }
    }, 250);
    return () => clearInterval(id);
  }, [active]);

  // ── Keep the screen awake during the workout ───────────────────────────
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let released = false;
    const acquire = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') {
          lock = await navigator.wakeLock.request('screen');
          if (released) lock.release().catch(() => {});
        }
      } catch {
        /* not supported / denied: not critical */
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && acquire();
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, []);

  const switchCamera = async () => {
    if (switching) return;
    setSwitching(true);
    const previous = facingRef.current;
    const next: FacingMode = previous === 'user' ? 'environment' : 'user';
    stopStream(streamRef.current);
    streamRef.current = null;
    try {
      const stream = await openCamera(next);
      if (!mountedRef.current) return stopStream(stream);
      facingRef.current = next;
      savePrefs({ facingMode: next });
      await attachStream(stream);
    } catch {
      // Couldn't open the other camera: go back to the one that worked.
      try {
        const stream = await openCamera(previous);
        if (!mountedRef.current) return stopStream(stream);
        await attachStream(stream);
      } catch (err) {
        setError(describeError(err));
      }
    } finally {
      setSwitching(false);
    }
  };

  const endSet = () => {
    const det = detectorRef.current!;
    const start = startTimeRef.current;
    onFinish({
      reps: det.repCount,
      durationMs: start === null ? 0 : performance.now() - start,
      repDepths: det.getRepDepths(),
    });
  };

  const loading = !error && stage !== 'tracking';
  const minRepDepth = detectorRef.current.config.minRepDepth;

  return (
    <div className={`workout ${active ? 'is-active' : 'is-positioning'}`}>
      <div className={`camera ${mirrored ? 'is-mirrored' : ''}`}>
        <video ref={videoRef} playsInline muted autoPlay />
        <canvas ref={canvasRef} />
      </div>
      <div className="scrim scrim-top" />
      <div className="scrim scrim-bottom" />

      <header className="wo-top">
        <div className="pos-eyebrow">{active ? '' : 'Get in frame'}</div>
        <div className="wo-top-right">
          {DEBUG_AVAILABLE && (
            <button
              className={`icon-btn debug-toggle ${debug ? 'is-on' : ''}`}
              onClick={() => setDebug((d) => !d)}
              aria-label="Toggle debug overlay"
            >
              DBG
            </button>
          )}
          {canSwitch && (
            <button className="icon-btn" onClick={switchCamera} disabled={switching} aria-label="Switch camera">
              <FlipIcon />
            </button>
          )}
        </div>
      </header>

      <section className="wo-count" aria-live="polite" aria-atomic="true">
        <div key={reps} className={`wo-count-num ${reps > 0 ? 'bump' : ''}`}>
          {reps}
        </div>
        <div className="wo-count-label">Push-ups</div>
      </section>

      <footer className="wo-bottom">
        <div className="wo-live">
          <div className="wo-readout">
            <div className="wo-cue" ref={cueRef} data-tone="neutral">
              Ready
            </div>
            <div className="wo-depth" aria-label="Push-up depth">
              <span ref={depthRef}>0</span>
              <span className="wo-depth-pct">%</span>
            </div>
          </div>
          <div className="depth-bar" aria-hidden="true">
            <div className="depth-fill" ref={barRef} />
            <div className="depth-target" style={{ left: `${minRepDepth}%` }} />
          </div>
          <div className="wo-meta">
            <span ref={clockRef} className="wo-clock">
              00:00
            </span>
            <span>
              Best <strong>{bestReps ?? '–'}</strong>
            </span>
          </div>
        </div>
        <section className="wo-position" aria-live="polite">
          <div className="pos-title" ref={posTitleRef}>
            Step back
          </div>
          <div className="pos-detail" ref={posDetailRef}>
            Make sure your shoulders, hips and ankles are visible.
          </div>
          <div className="pos-progress">
            <div ref={readyBarRef} />
          </div>
          <p className="pos-tip">Turning your phone sideways fits more of your body in frame.</p>
        </section>
        {active ? (
          <button className="btn btn-primary" onClick={endSet}>
            End set
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </footer>

      {debug && <pre className="debug-panel" ref={debugRef} />}

      {loading && (
        <div className="wo-overlay">
          <div className="loader" />
          <p>{loadingLabel(stage, modelProgress)}</p>
        </div>
      )}

      {error && (
        <div className="wo-overlay wo-error" role="alert">
          <h2>{error.title}</h2>
          <p>{error.body}</p>
          <div className="wo-error-actions">
            <button className="btn btn-primary" onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </button>
            <button className="btn btn-ghost" onClick={active && reps > 0 ? endSet : onCancel}>
              {active && reps > 0 ? 'End set' : 'Back'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

class ModelLoadError extends Error {}

function loadingLabel(stage: Stage, progress: number | null): string {
  if (stage === 'camera') return 'Starting camera';
  if (progress === null) return 'Loading pose tracking';
  return progress < 100 ? `Loading pose tracking · ${progress}%` : 'Preparing pose tracking';
}

function describeError(err: unknown): ErrorInfo {
  if (err instanceof ModelLoadError) {
    return {
      title: "Pose tracking couldn't load",
      body: 'Check your connection and try again. Tracking runs on your device once loaded.',
    };
  }
  if (err instanceof CameraError) {
    switch (err.kind) {
      case 'denied':
        return {
          title: 'Camera access is blocked',
          body: 'Allow camera access for this site in your browser settings, then try again.',
        };
      case 'no-camera':
        return { title: 'No camera found', body: "This device doesn't have a camera the browser can use." };
      case 'in-use':
        return { title: 'Camera is busy', body: 'Close other apps using the camera, then try again.' };
      case 'insecure':
        return {
          title: 'Secure connection needed',
          body: 'Browsers only allow the camera over HTTPS or on localhost. Use the https:// address from `npm run dev:phone`.',
        };
      case 'unsupported':
        return { title: 'Camera not supported', body: "This browser can't access the camera. Try Safari or Chrome." };
      default:
        return { title: "Couldn't start the camera", body: err.message };
    }
  }
  return { title: 'Something went wrong', body: err instanceof Error ? err.message : String(err) };
}

function FlipIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9a8 8 0 0 1 14.3-3.3M20 15a8 8 0 0 1-14.3 3.3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M18.5 2.5v3.5H15M5.5 21.5V18H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
