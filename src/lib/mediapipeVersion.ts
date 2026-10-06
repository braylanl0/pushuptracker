/**
 * Must match the installed @mediapipe/tasks-vision version: the WASM runtime
 * is loaded from the CDN at this exact version, and a JS/WASM mismatch breaks
 * loading. A unit test (lib.test.ts) fails if they drift apart.
 */
export const MEDIAPIPE_VERSION = '1.1.0';
