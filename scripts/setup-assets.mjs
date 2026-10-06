// Copies the MediaPipe WASM runtime into /public and downloads the pose model
// once, so the app can run pose detection entirely from your own dev server
// (no third-party CDN needed at runtime). Runs automatically on `npm install`.
//
// If the download fails (offline install), the app falls back to loading the
// model/WASM from Google's CDN at runtime — see src/pose/poseLandmarker.ts.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDest = join(root, 'public', 'mediapipe', 'wasm');
const modelDest = join(root, 'public', 'mediapipe', 'models');

const MODELS = {
  'pose_landmarker_full.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
};

function copyWasm() {
  if (!existsSync(wasmSrc)) {
    console.warn('[assets] @mediapipe/tasks-vision not installed yet, skipping WASM copy');
    return;
  }
  mkdirSync(wasmDest, { recursive: true });
  for (const file of readdirSync(wasmSrc)) {
    copyFileSync(join(wasmSrc, file), join(wasmDest, file));
  }
  console.log('[assets] MediaPipe WASM copied to public/mediapipe/wasm');
}

async function downloadModels() {
  mkdirSync(modelDest, { recursive: true });
  for (const [name, url] of Object.entries(MODELS)) {
    const target = join(modelDest, name);
    if (existsSync(target) && statSync(target).size > 1000) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      writeFileSync(target, Buffer.from(await res.arrayBuffer()));
      console.log(`[assets] downloaded ${name}`);
    } catch (err) {
      console.warn(`[assets] could not download ${name} (${err.message}); the app will use the CDN instead`);
    }
  }
}

copyWasm();
await downloadModels();
