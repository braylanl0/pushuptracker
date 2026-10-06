# PUSH: camera push-up counter

A mobile-first web app that counts push-ups using your phone's camera. Pose
estimation (MediaPipe Pose Landmarker) runs **entirely in the browser**. No
video is uploaded, recorded or stored.

## Run it

```bash
npm install        # also copies the MediaPipe WASM + downloads the pose model into public/mediapipe
npm run dev        # http://localhost:5173 (desktop, camera works on localhost)
```

### On your phone (same Wi-Fi)

Phones only allow camera access on HTTPS pages, so use the LAN script, which
serves over HTTPS with a self-signed certificate:

```bash
npm run dev:phone
```

1. Open the `Network:` URL it prints (e.g. `https://192.168.1.42:5173`) on your phone.
2. Accept the certificate warning (iOS Safari: *Show Details → visit this website*;
   Android Chrome: *Advanced → Proceed*).
3. Allow camera access when asked.

If the phone can't connect, allow Node.js through the Windows firewall for
private networks.

Production build: `npm run build`, then `npm run preview` (also HTTPS on the LAN).

## Using it

Prop the phone up 2–3 m away, side-on to where you'll do push-ups. Turning the
phone **landscape** fits a horizontal body much better. Get into a high plank
and hold still at the top; the set starts once your shoulders, hips and ankles
are tracked. Nothing is counted before that.

## Tests & checks

```bash
npm test           # detector state machine, depth math, filters, storage
npm run typecheck
```

The detector is plain TypeScript with no DOM, so tests drive it with synthetic
side-view poses (`src/pushup/synthetic.ts`), including noise, dropouts,
shallow reps, standing up, and jitter around thresholds.

## Tuning

All thresholds live in [`src/pushup/config.ts`](src/pushup/config.ts), each
documented. The most useful:

| Setting | Default | Effect |
| --- | --- | --- |
| `topElbowAngle` / `bottomElbowAngle` | 155° / 90° | Elbow angles that map to 0% and 100% depth |
| `minRepDepth` | 80% | Depth a rep must reach to count (tick mark on the depth bar) |
| `topThreshold` / `descentStartThreshold` | 15% / 25% | Hysteresis band at the top |
| `reversalDelta` | 8% | How far you must come back up before it's a reversal |
| `minVisibility` | 0.5 | Landmark confidence needed to measure anything |
| `alignmentToleranceDeg` | 28° | When "Straighten your body" appears |

**Debug overlay** (dev builds only): tap `DBG` in the workout screen, or open
`/?debug`. It shows FPS, state, tracked side, confidence, elbow angle, body
alignment, raw/smoothed depth and per-rep depths.

The model defaults to `full` for steadier elbows and wrists; switch `POSE_MODEL`
in `src/lib/poseLandmarker.ts` to `'lite'` for more FPS on older phones.

## Layout

```
src/
  pushup/        detection core (pure TS, unit-tested)
    config.ts      every threshold, documented
    detector.ts    side selection → gating → depth → rep state machine → cue
    filters.ts     One Euro filter (adaptive smoothing)
    geometry.ts    angles, tilt, clamping
  lib/           camera, MediaPipe loader, localStorage, formatting
  workout/       WorkoutScreen (camera + rAF loop + HUD), skeleton overlay, cue copy
  screens/       Home, Results, History
scripts/setup-assets.mjs   copies WASM + downloads models on install
```
