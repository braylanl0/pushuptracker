import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

/**
 * Loads MediaPipe Pose Landmarker. Inference runs entirely in the browser
 * (WASM + WebGL); camera frames never leave the device.
 *
 * Asset sources, tried in order:
 *   1. this app's own /mediapipe/ folder (populated by scripts/setup-assets.mjs)
 *   2. public CDNs, if the local copy is missing
 *
 * Delegates: GPU first (fast on most phones), CPU as a fallback.
 */

/**
 * 'full' is noticeably steadier on elbows/wrists than 'lite' for side-on
 * push-ups; switch to 'lite' if you need more FPS on older phones.
 */
export const POSE_MODEL: 'full' | 'lite' = 'full';

const BASE = import.meta.env.BASE_URL;
const LOCAL_WASM = `${BASE}mediapipe/wasm`;
const LOCAL_MODEL = `${BASE}mediapipe/models/pose_landmarker_${POSE_MODEL}.task`;
const CDN_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
const CDN_MODEL = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${POSE_MODEL}/float16/latest/pose_landmarker_${POSE_MODEL}.task`;

async function localAssetsAvailable(): Promise<boolean> {
  try {
    const res = await fetch(LOCAL_MODEL, { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    // Dev servers answer unknown paths with index.html; make sure it's really the model.
    return res.ok && !type.includes('text/html');
  } catch {
    return false;
  }
}

export async function loadPoseLandmarker(): Promise<PoseLandmarker> {
  const local = await localAssetsAvailable();
  const wasmPath = local ? LOCAL_WASM : CDN_WASM;
  const modelPath = local ? LOCAL_MODEL : CDN_MODEL;

  const fileset = await FilesetResolver.forVisionTasks(wasmPath);
  const create = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelPath, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });

  let landmarker: PoseLandmarker;
  try {
    landmarker = await create('GPU');
  } catch (gpuErr) {
    console.warn('[pose] GPU delegate failed, falling back to CPU', gpuErr);
    landmarker = await create('CPU');
  }
  warmUp(landmarker);
  return landmarker;
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
