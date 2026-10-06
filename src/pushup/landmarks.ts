/**
 * Minimal landmark shape the detector needs. Structurally compatible with
 * MediaPipe's NormalizedLandmark, but keeping our own type means the detector
 * (and its tests) don't depend on MediaPipe at all.
 *
 * x/y are normalized to the image (0..1, can fall slightly outside when a
 * joint is predicted off-screen). visibility is 0..1.
 */
export interface PoseLandmark {
  x: number;
  y: number;
  visibility?: number;
}

/** MediaPipe BlazePose (33-point) landmark indices we care about. */
export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

export type Side = 'left' | 'right';

export interface SideIndices {
  shoulder: number;
  elbow: number;
  wrist: number;
  hip: number;
  knee: number;
  ankle: number;
}

export const SIDE_INDICES: Record<Side, SideIndices> = {
  left: {
    shoulder: LM.leftShoulder,
    elbow: LM.leftElbow,
    wrist: LM.leftWrist,
    hip: LM.leftHip,
    knee: LM.leftKnee,
    ankle: LM.leftAnkle,
  },
  right: {
    shoulder: LM.rightShoulder,
    elbow: LM.rightElbow,
    wrist: LM.rightWrist,
    hip: LM.rightHip,
    knee: LM.rightKnee,
    ankle: LM.rightAnkle,
  },
};

/** Skeleton segments drawn on the overlay (one side's chain, drawn for both sides). */
export const SIDE_SEGMENTS: Array<[keyof SideIndices, keyof SideIndices]> = [
  ['shoulder', 'elbow'],
  ['elbow', 'wrist'],
  ['shoulder', 'hip'],
  ['hip', 'knee'],
  ['knee', 'ankle'],
];
