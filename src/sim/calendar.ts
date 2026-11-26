import { CALENDAR } from '../config/balance';
import type { AutoPauseReason, GameState, SpeedMultiplier } from '../types';

const MONTHS_TR = [
  'Oca',
  'Şub',
  'Mar',
  'Nis',
  'May',
  'Haz',
  'Tem',
  'Ağu',
  'Eyl',
  'Eki',
  'Kas',
  'Ara',
];

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function formatSimDate(simDaysElapsed: number): string {
  const clamped = Math.max(0, Math.min(CALENDAR.TOTAL_DAYS, Math.floor(simDaysElapsed)));
  const yearOffset = Math.floor(clamped / 365);
  const year = CALENDAR.START_YEAR + yearOffset;
  if (clamped >= CALENDAR.TOTAL_DAYS) {
    return `1 Oca ${CALENDAR.END_YEAR}`;
  }
  let dayOfYear = clamped % 365;
  let monthIdx = 0;
  while (monthIdx < 11 && dayOfYear >= MONTH_DAYS[monthIdx]) {
    dayOfYear -= MONTH_DAYS[monthIdx];
    monthIdx++;
  }
  return `${dayOfYear + 1} ${MONTHS_TR[monthIdx]} ${year}`;
}

export function setGameSpeed(state: GameState, speed: SpeedMultiplier): void {
  if (speed !== 0) {
    state.lastNonZeroSpeed = speed;
  }
  state.speed = speed;
}

export function togglePauseSpace(state: GameState): void {
  if (state.speed === 0) {
    state.speed = state.lastNonZeroSpeed;
  } else {
    state.lastNonZeroSpeed = state.speed;
    state.speed = 0;
  }
}

export function setAutoPauseReason(
  state: GameState,
  reason: AutoPauseReason,
  active: boolean,
): void {
  if (!state.autoPauseReasons) state.autoPauseReasons = [];
  if (active) {
    if (!state.autoPauseReasons.includes(reason)) {
      state.autoPauseReasons.push(reason);
    }
  } else {
    state.autoPauseReasons = state.autoPauseReasons.filter((r) => r !== reason);
  }
}

export function clearAllAutoPauses(state: GameState): void {
  state.autoPauseReasons = [];
}

export function isAutoPaused(state: GameState): boolean {
  return (state.autoPauseReasons?.length ?? 0) > 0;
}

export function isEffectivelyPaused(state: GameState): boolean {
  return state.speed === 0 || isAutoPaused(state);
}

/** Advance simulation clock by real-time delta, returning effective simulation seconds elapsed. */
export function advanceClock(state: GameState, dtRealSec: number): number {
  if (state.phase !== 'playing' || isEffectivelyPaused(state)) return 0;
  const dtSimSec = dtRealSec * state.speed;
  state.simSecondsElapsed += dtSimSec;
  state.simDaysElapsed = Math.min(
    CALENDAR.TOTAL_DAYS,
    state.simDaysElapsed + dtSimSec * CALENDAR.DAYS_PER_SIM_SECOND,
  );
  return dtSimSec;
}
