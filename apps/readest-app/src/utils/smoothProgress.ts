/**
 * Presentation-only smoothing for a coarse percentage that arrives every few
 * seconds. The value never runs more than one point ahead of the last reported
 * percentage and never exceeds 99.9 while the job is still running, so the
 * badge reads as continuous without inventing finished work.
 */
export interface SmoothProgress {
  /** Last percentage reported by the server (0-100, integers). */
  server: number;
  /** Timestamp of that report. */
  at: number;
  /** Percentage points per second derived from consecutive reports. */
  rate: number;
  /** Unquantized display value; render it with displayPercent(). */
  value: number;
}

const clampPercent = (percent: number) => Math.max(0, Math.min(100, percent));

/** Quantize a display value to the tenth of a percent the badge shows. */
export const displayPercent = (value: number) => Math.floor(value * 10) / 10;

export const createSmoothProgress = (percent: number, now = 0): SmoothProgress => {
  const value = clampPercent(percent);
  return { server: value, at: now, rate: 0, value };
};

/** Fold a new server percentage into the state and refresh the rate estimate. */
export const observeServerProgress = (
  state: SmoothProgress,
  percent: number,
  now: number,
): SmoothProgress => {
  const server = clampPercent(percent);
  if (server === state.server) return state;
  const rate =
    server > state.server && state.at > 0
      ? Math.min(1, (server - state.server) / Math.max(0.001, (now - state.at) / 1000))
      : 0;
  // A retry restarts the job; otherwise lag at most one point behind the
  // server and lead it by at most one.
  const value =
    server > state.server ? Math.min(Math.max(state.value, server - 1), server + 1) : server;
  return { server, at: now, rate, value };
};

/** Advance the display by at most one tick's worth of the observed rate. */
export const advanceSmoothProgress = (state: SmoothProgress, tickSeconds = 0.1): SmoothProgress => {
  if (state.rate <= 0) return state;
  const limit = Math.min(99.9, state.server + 1);
  const value = Math.min(limit, state.value + state.rate * tickSeconds);
  return value > state.value ? { ...state, value } : state;
};
