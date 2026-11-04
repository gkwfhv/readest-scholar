import { useEffect, useRef, useState } from 'react';

import {
  advanceSmoothProgress,
  createSmoothProgress,
  displayPercent,
  observeServerProgress,
  type SmoothProgress,
} from '@/utils/smoothProgress';

export const SMOOTH_PROGRESS_TICK_MS = 100;

/**
 * Tick a coarse percentage forward in 0.1 steps at 10 Hz while a job runs.
 * The value never runs more than one point ahead of the last server report.
 */
export function useSmoothProgress(percent: number, active: boolean): number {
  const [value, setValue] = useState(percent);
  const stateRef = useRef<SmoothProgress>(createSmoothProgress(percent, Date.now()));

  useEffect(() => {
    stateRef.current = observeServerProgress(stateRef.current, percent, Date.now());
    setValue(displayPercent(stateRef.current.value));
  }, [percent]);

  useEffect(() => {
    if (!active) {
      stateRef.current = createSmoothProgress(percent, Date.now());
      setValue(percent);
      return;
    }
    const timer = window.setInterval(() => {
      const next = advanceSmoothProgress(stateRef.current);
      if (next !== stateRef.current) {
        stateRef.current = next;
        setValue(displayPercent(next.value));
      }
    }, SMOOTH_PROGRESS_TICK_MS);
    return () => window.clearInterval(timer);
  }, [active, percent]);

  return value;
}
