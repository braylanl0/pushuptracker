import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { MEDIAPIPE_VERSION } from './mediapipeVersion';

/**
 * Loads MediaPipe Pose Landmarker. Inference runs entirely in the browser
 * (WASM + WebGL); camera frames never leave the device. Only the model and
 * runtime files are downloaded.
 *
 * Asset sources, tried in order:
 *   1. CDNs (jsDelivr for the WASM runtime, Google for the model): fast and
 *      globally cached.
 *   2. This app's own /mediapipe/ folder (populated by scripts/setup-assets.mjs),
 *      in case the CDNs are blocked. Some static hosts serve these large files
 *      slowly, which is why they're the fallback rather than the default.
 *
 * A source that errors or stalls is abandoned and the next one is tried, so the
 * loading screen can't hang forever.
 *
 * Delegates: GPU first (fast on most phones), CPU as a fallback.
 */

/**
 * 'full' is noticeably steadier on elbows/wrists than 'lite' for side-on
 * push-ups; switch to 'lite' (5.6 MB vs 9.4 MB) for faster loading and more
 * FPS on older phones.
 */
export const POSE_MODEL: 'full' | 'lite' = 'full';

/** Model download progress, 0..1, or null when the size is unknown. */
export type ProgressCallback = (fraction: number | null) => void;

interface AssetSource {
  name: string;
  wasm: string;
  model: string;
}

const BASE = import.meta.env.BASE_URL;
const SOURCES: AssetSource[] = [
  {
    name: 'cdn',
    wasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`,
    model: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${POSE_MODEL}/float16/latest/pose_landmarker_${POSE_MODEL}.task`,
  },
  {
    name: 'self-hosted',
    wasm: `${BASE}mediapipe/wasm`,
    model: `${BASE}mediapipe/models/pose_landmarker_${POSE_MODEL}.task`,
  },
];

/** Abandon a model download that receives no data for this long. */
const DOWNLOAD_STALL_MS = 15_000;
/** Max time to fetch + compile the WASM runtime and build the graph. */
const CREATE_TIMEOUT_MS = 45_000;

export async function loadPoseLandmarker(onProgress?: ProgressCallback): Promise<PoseLandmarker> {
  let lastError: unknown;
  for (const source of SOURCES) {
    try {
      const landmarker = await loadFrom(source, onProgress);
      warmUp(landmarker);
      return landmarker;
    } catch (err) {
      console.warn(`[pose] loading from ${source.name} failed`, err);
      lastError = err;
      onProgress?.(0);
    }
  }
  throw lastError;
}

async function loadFrom(source: AssetSource, onProgress?: ProgressCallback): Promise<PoseLandmarker> {
  const [fileset, model] = await Promise.all([
    FilesetResolver.forVisionTasks(source.wasm),
    downloadWithProgress(source.model, onProgress),
  ]);

  const create = (delegate: 'GPU' | 'CPU') =>
    withTimeout(
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: model, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      }),
      CREATE_TIMEOUT_MS,
      `pose landmarker (${delegate})`,
      // If it finishes after we gave up on it, free it.
      (late) => late.close(),
    );

  try {
    return await create('GPU');
  } catch (err) {
    if (err instanceof TimeoutError) throw err; // too slow: try the next source
    console.warn('[pose] GPU delegate failed, falling back to CPU', err);
    return await create('CPU');
  }
}

/** Fetches a file, reporting progress and aborting if data stops arriving. */
async function downloadWithProgress(url: string, onProgress?: ProgressCallback): Promise<Uint8Array> {
  const controller = new AbortController();
  let stallTimer = 0;
  const armStallTimer = () => {
    clearTimeout(stallTimer);
    stallTimer = window.setTimeout(() => controller.abort(), DOWNLOAD_STALL_MS);
  };

  armStallTimer();
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    // Static hosts answer missing files with index.html; don't feed that to MediaPipe.
    if ((res.headers.get('content-type') ?? '').includes('text/html')) {
      throw new Error(`${url}: not found (got HTML)`);
    }
    const encoded = res.headers.get('content-encoding');
    const length = Number(res.headers.get('content-length'));
    // Content-Length is the compressed size when the response is encoded, so it can't measure progress.
    const total = !encoded && length > 0 ? length : null;

    if (!res.body) {
      const buf = new Uint8Array(await res.arrayBuffer());
      onProgress?.(1);
      return buf;
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    onProgress?.(total ? 0 : null);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armStallTimer();
      chunks.push(value);
      received += value.byteLength;
      if (total) onProgress?.(Math.min(received / total, 1));
    }
    onProgress?.(1);

    const out = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  } catch (err) {
    if (controller.signal.aborted) throw new TimeoutError(`${url}: download stalled`);
    throw err;
  } finally {
    clearTimeout(stallTimer);
  }
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string, onLate?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new TimeoutError(`${what} timed out after ${ms / 1000}s`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        if (timedOut) onLate?.(value);
        else resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        if (!timedOut) reject(err);
      },
    );
  });
}

/**
 * The first inference compiles GPU shaders and can take seconds. Doing it
 * here, behind the loading screen, avoids a freeze on the first live frame.
 */
function warmUp(landmarker: PoseLandmarker): void {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    canvas.getContext('2d')?.fillRect(0, 0, canvas.width, canvas.height);
    landmarker.detectForVideo(canvas, performance.now());
  } catch (err) {
    console.warn('[pose] warm-up failed', err);
  }
}
