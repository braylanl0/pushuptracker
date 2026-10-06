# PUSH: camera push-up counter

A mobile-first web app that counts push-ups using your phone's camera. Pose
estimation (MediaPipe Pose Landmarker) runs **entirely in the browser**. No
video is uploaded, recorded or stored.

## Run it

```bash
npm install        # also copies the MediaPipe WASM + downloads the pose model into public/mediapipe (offline fallback)
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

Prop the phone up 2–3 m away, either **side-on** to where you'll do push-ups or
**facing you** (in front of your head). The app works out which automatically.
Side-on, turning the phone **landscape** fits a horizontal body much better.
Get into a high plank and hold still at the top; the set starts once you're
tracked. Nothing is counted before that.

- **Side-on**: depth from the elbow angle (plus shoulder drop) on whichever side
  the camera sees best; also gives the "straighten your body" hint.
- **Facing the camera**: uses both sides; depth from how far your shoulders drop
  toward your hands, measured in shoulder-widths against your top position (the
  2D elbow angle can't be trusted head-on). The top is re-learned from where you
  actually stop or turn around, so a drifting top position can't block counting,
  and looking up at the phone is fine. No body-alignment hint in this view.

The view only switches between reps, never mid-rep.

**Sounds**: a short chime the first time each rep reaches full depth (once per
rep, however long you stay down) and an arpeggio when you end a set. Toggle
with the speaker button in the workout screen; the choice is remembered. On
iPhone (Safari 17+) the app uses the "playback" audio session so sounds are heard
even with the silent switch on; like any media playback, that can pause music
playing in another app while you're on the workout screen.

**Activity graph**: History shows a GitHub-style graph of recent weeks (one
square per day, brighter = more push-ups relative to your best day). *Full
graph* opens every year of your history with totals and streaks; tap a day for
details.

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
| `frontViewEnter` / `sideViewEnter` | 0.45 / 0.3 | Shoulder-span ÷ arm-length ratio that switches views |
| `frontDropForFullDepth` | 0.55 | Facing the camera: shoulder drop that counts as 100% |
| `fullDepthThreshold` | 97% | Depth that triggers the full-depth chime |

**Debug overlay**: never shown by default. In dev builds tap `DBG` in the
workout screen; on any build (including the deployed site) open `/?debug`. It shows FPS, state, tracked side, confidence, elbow angle, body
alignment, raw/smoothed depth and per-rep depths.

Pose assets (~22 MB: WASM runtime + model) load from jsDelivr/Google's CDN
first, with a progress readout, and fall back to the self-hosted copy in
`public/mediapipe` if the CDN fails or stalls. Some static hosts (Vercel in
testing) serve these large files far slower than the CDNs. The WASM version is
pinned in `src/lib/mediapipeVersion.ts`; a test fails if it drifts from the
installed package.

The model defaults to `full` for steadier elbows and wrists; switch `POSE_MODEL`
in `src/lib/poseLandmarker.ts` to `'lite'` for more FPS on older phones.

## Layout

```
src/
  pushup/        detection core (pure TS, unit-tested)
    config.ts      every threshold, documented
    detector.ts    view (side/front) → gating → depth → rep state machine → cue
    filters.ts     One Euro filter (adaptive smoothing)
    geometry.ts    angles, tilt, clamping
  lib/           camera, MediaPipe loader, localStorage, sounds, activity stats
  workout/       WorkoutScreen (camera + rAF loop + HUD), skeleton overlay, cue copy
  screens/       Home, Results, History, Activity graph
scripts/setup-assets.mjs   copies WASM + downloads models on install
```
