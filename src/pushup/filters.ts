/**
 * One Euro filter (Casiez et al., 2012): an adaptive low-pass filter.
 *
 * When the signal is nearly still it smooths heavily (kills landmark jitter);
 * when the signal moves fast it raises its cutoff so it doesn't lag behind.
 * That's exactly the trade-off we want for a live depth readout.
 *
 * Timestamps are in milliseconds.
 */
export class OneEuroFilter {
  private prevValue: number | null = null;
  private prevDeriv = 0;
  private prevTime = 0;

  constructor(
    private minCutoff: number,
    private beta: number,
    private derivCutoff = 1,
  ) {}

  filter(value: number, timeMs: number): number {
    if (this.prevValue === null) {
      this.prevValue = value;
      this.prevTime = timeMs;
      this.prevDeriv = 0;
      return value;
    }
    // Guard against duplicate/out-of-order timestamps.
    const dt = Math.max((timeMs - this.prevTime) / 1000, 1 / 240);
    const deriv = (value - this.prevValue) / dt;
    const dAlpha = smoothingFactor(dt, this.derivCutoff);
    const smoothedDeriv = dAlpha * deriv + (1 - dAlpha) * this.prevDeriv;

    const cutoff = this.minCutoff + this.beta * Math.abs(smoothedDeriv);
    const alpha = smoothingFactor(dt, cutoff);
    const out = alpha * value + (1 - alpha) * this.prevValue;

    this.prevValue = out;
    this.prevDeriv = smoothedDeriv;
    this.prevTime = timeMs;
    return out;
  }

  /** Smoothed rate of change in units per second (positive = increasing). */
  get velocity(): number {
    return this.prevDeriv;
  }

  reset(): void {
    this.prevValue = null;
    this.prevDeriv = 0;
  }
}

function smoothingFactor(dtSeconds: number, cutoffHz: number): number {
  const r = 2 * Math.PI * cutoffHz * dtSeconds;
  return r / (r + 1);
}
