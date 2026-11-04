import { describe, expect, it } from 'vitest';

import {
  advanceSmoothProgress,
  createSmoothProgress,
  displayPercent,
  observeServerProgress,
} from '@/utils/smoothProgress';

const tick = (state: ReturnType<typeof createSmoothProgress>, times: number) => {
  let next = state;
  for (let i = 0; i < times; i++) next = advanceSmoothProgress(next);
  return next;
};

describe('smooth progress', () => {
  it('starts at the reported value without a rate', () => {
    const state = createSmoothProgress(46, 1000);
    expect(state.value).toBe(46);
    expect(state.rate).toBe(0);
    expect(advanceSmoothProgress(state, 0.1)).toBe(state);
  });

  it('derives a rate from consecutive reports and advances by it', () => {
    let state = createSmoothProgress(46, 1000);
    state = observeServerProgress(state, 47, 6000);
    expect(state.rate).toBeCloseTo(0.2, 5);
    expect(state.value).toBe(46);
    state = tick(state, 50);
    expect(displayPercent(state.value)).toBe(47);
  });

  it('moves in 0.1 steps and never leads the server by more than a point', () => {
    let state = createSmoothProgress(40, 1000);
    state = observeServerProgress(state, 41, 2000);
    state = { ...state, rate: 5 };
    state = tick(state, 200);
    expect(displayPercent(state.value)).toBe(42);
  });

  it('stops below 100 while the job is still running', () => {
    let state = createSmoothProgress(99, 1000);
    state = observeServerProgress(state, 100, 2000);
    state = { ...state, rate: 10 };
    state = tick(state, 100);
    expect(displayPercent(state.value)).toBe(99.9);
  });

  it('snaps back when a retry restarts at a lower percentage', () => {
    let state = createSmoothProgress(60, 0);
    state = observeServerProgress(state, 2, 1000);
    expect(state.value).toBe(2);
    expect(state.rate).toBe(0);
  });
});
