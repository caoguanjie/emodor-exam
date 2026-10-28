import type { VideoHeartbeat } from './video-learning.dto';

export const VIDEO_HEARTBEAT_INTERVAL_MS = 30_000;
export const VIDEO_HEARTBEAT_CAP_MS = 45_000;
export const VIDEO_POSITION_TOLERANCE_MS = 2_000;
export const VIDEO_COMPLETION_RATIO = 0.95;

export interface PlaybackAnchor {
  seq: number;
  positionMs: number;
  state: VideoHeartbeat['state'];
}

export interface VideoCredit {
  nextAnchor: PlaybackAnchor;
  creditedMs: number;
  interval: [number, number] | null;
}

function position(value: number, durationMs: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, Math.trunc(value)), Math.max(0, Math.trunc(durationMs)));
}

export function creditVideoInterval(
  previous: PlaybackAnchor,
  input: VideoHeartbeat,
  elapsedMs: number,
  durationMs: number,
): VideoCredit {
  if (!Number.isInteger(input.seq) || input.seq <= previous.seq) {
    return { nextAnchor: previous, creditedMs: 0, interval: null };
  }

  const nextAnchor: PlaybackAnchor = {
    seq: input.seq,
    positionMs: position(input.position_ms, durationMs),
    state: input.state,
  };
  const previousPosition = position(previous.positionMs, durationMs);
  const currentPosition = nextAnchor.positionMs;
  const realElapsed = Math.max(0, Number.isFinite(elapsedMs) ? Math.trunc(elapsedMs) : 0);
  const creditWindow = Math.min(VIDEO_HEARTBEAT_CAP_MS, realElapsed);
  const forwardMs = currentPosition - previousPosition;
  // The incoming state closes the preceding interval. A pause/wait/hide
  // boundary must settle that interval before becoming the next anchor;
  // browsers also emit pause immediately before ended on natural completion.
  const canCreditState = previous.state === 'playing';

  if (!canCreditState || realElapsed === 0 || forwardMs <= 0) {
    return { nextAnchor, creditedMs: 0, interval: null };
  }
  if (forwardMs > realElapsed + VIDEO_POSITION_TOLERANCE_MS) {
    return { nextAnchor, creditedMs: 0, interval: null };
  }

  const creditedMs = Math.min(creditWindow, forwardMs);
  return {
    nextAnchor,
    creditedMs,
    interval: creditedMs > 0 ? [previousPosition, previousPosition + creditedMs] : null,
  };
}

function normalizedInterval(value: [number, number]): [number, number] | null {
  const start = Number(value?.[0]);
  const end = Number(value?.[1]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return [Math.max(0, Math.trunc(start)), Math.max(0, Math.trunc(end))];
}

export function mergeCoverage(
  intervals: [number, number][],
  next: [number, number] | null,
): { intervals: [number, number][]; coverageMs: number } {
  const candidates = [...(Array.isArray(intervals) ? intervals : []), ...(next ? [next] : [])]
    .map(normalizedInterval)
    .filter((value): value is [number, number] => value !== null)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged: [number, number][] = [];

  for (const current of candidates) {
    const tail = merged.at(-1);
    if (!tail || current[0] > tail[1]) {
      merged.push([...current]);
    } else if (current[1] > tail[1]) {
      tail[1] = current[1];
    }
  }

  return {
    intervals: merged,
    coverageMs: merged.reduce((total, [start, end]) => total + end - start, 0),
  };
}

export function courseCompletionRate(required: number, completed: number): number | null {
  if (!Number.isInteger(required) || required <= 0) return null;
  const safeCompleted = Math.min(Math.max(0, Math.trunc(completed)), required);
  return safeCompleted / required;
}
