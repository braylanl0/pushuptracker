import type { Cue } from '../pushup/detector';

export type CueTone = 'neutral' | 'accent' | 'warn';

export interface CueCopy {
  title: string;
  detail?: string;
  tone: CueTone;
}

const FULL_BODY = 'Make sure your shoulders, hips and ankles are visible.';

export const CUE_COPY: Record<Cue, CueCopy> = {
  STEP_BACK: { title: 'Step back', detail: FULL_BODY, tone: 'neutral' },
  SHOW_FULL_BODY: { title: 'Show your full body', detail: FULL_BODY, tone: 'neutral' },
  GET_INTO_POSITION: { title: 'Get into position', detail: 'Side-on to the camera, in a high plank.', tone: 'neutral' },
  STRAIGHTEN_ARMS: { title: 'Arms straight', detail: 'Start from the top of a push-up.', tone: 'neutral' },
  HOLD: { title: 'Hold', detail: 'Hold still at the top.', tone: 'accent' },
  READY: { title: 'Ready', tone: 'accent' },
  GO: { title: 'Go', tone: 'accent' },
  LOWER: { title: 'Lower', tone: 'neutral' },
  GO_LOWER: { title: 'Go lower', tone: 'warn' },
  GOOD_DEPTH: { title: 'Good depth', tone: 'accent' },
  PUSH_UP: { title: 'Push up', tone: 'neutral' },
  REP_COMPLETE: { title: 'Rep complete', tone: 'accent' },
  BODY_NOT_VISIBLE: { title: 'Body not visible', detail: 'Move back so your full body is visible.', tone: 'warn' },
  STRAIGHTEN_BODY: { title: 'Straighten your body', tone: 'warn' },
};
