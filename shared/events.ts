/**
 * Gameplay analytics events, shared by the game (sender) and the Worker
 * (validator). Events carry no personal data: no names, no image URLs, no
 * device identifiers. The run id is random per run and is not stored on the
 * server beyond the aggregated data points.
 */

export const EVENT_NAMES = ['run_started', 'picture_started', 'picture_completed', 'hint_used', 'run_ended', 'client_error'] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export const EVENT_MODES = ['relaxed', 'arcade', 'free'] as const;
export type EventMode = (typeof EVENT_MODES)[number];

export const END_REASONS = ['misses', 'stopped'] as const;
export const ERROR_KINDS = ['window_error', 'unhandled_rejection', 'image_load', 'catalog_unavailable'] as const;

export const MAX_EVENTS_PER_BATCH = 20;
export const MAX_BATCH_BYTES = 8 * 1024;

export interface GameEvent {
  name: EventName;
  mode: EventMode;
  /** Random per run; absent in Free play. */
  runId?: string;
  /** Catalog picture id, "custom" for the player's own image. Never a URL. */
  pictureId?: string;
  level?: number;
  chapter?: number;
  stage?: number;
  seconds?: number;
  mistakes?: number;
  hints?: number;
  score?: number;
  pictures?: number;
  /** run_started: whether this browser has played before. */
  visit?: 'first' | 'returning';
  reason?: (typeof END_REASONS)[number];
  errorKind?: (typeof ERROR_KINDS)[number];
  /** client_error only: short message with URLs and emails removed. */
  message?: string;
}

const PICTURE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RUN_ID = /^[a-z0-9-]{8,64}$/i;

function bounded(value: unknown, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? Math.round(value) : undefined;
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** Strip anything that could identify a person or an image from an error message. */
export function scrubMessage(message: string): string {
  return message
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/\b(?:blob|data):\S+/gi, '<url>')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '<email>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** Validate one untrusted event. Unknown fields are dropped. */
export function parseEvent(raw: unknown): GameEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const name = oneOf(e.name, EVENT_NAMES);
  const mode = oneOf(e.mode, EVENT_MODES);
  if (!name || !mode) return null;

  const event: GameEvent = { name, mode };
  if (typeof e.runId === 'string') {
    if (!RUN_ID.test(e.runId)) return null;
    event.runId = e.runId;
  }
  if (e.pictureId !== undefined) {
    if (typeof e.pictureId !== 'string' || !PICTURE_ID.test(e.pictureId)) return null;
    event.pictureId = e.pictureId;
  }
  const numbers: [keyof GameEvent, number][] = [
    ['level', 20], ['chapter', 10000], ['stage', 20], ['seconds', 24 * 3600], ['mistakes', 10000],
    ['hints', 10000], ['score', 100_000_000], ['pictures', 100000],
  ];
  for (const [key, max] of numbers) {
    if (e[key] === undefined) continue;
    const value = bounded(e[key], max);
    if (value === undefined) return null;
    (event as unknown as Record<string, number>)[key] = value;
  }
  const visit = oneOf(e.visit, ['first', 'returning'] as const);
  if (visit) event.visit = visit;
  const reason = oneOf(e.reason, END_REASONS);
  if (reason) event.reason = reason;
  const errorKind = oneOf(e.errorKind, ERROR_KINDS);
  if (errorKind) event.errorKind = errorKind;
  if (name === 'client_error') {
    if (!errorKind) return null;
    if (typeof e.message === 'string') event.message = scrubMessage(e.message);
  }
  return event;
}

export function parseBatch(raw: unknown): GameEvent[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const events = (raw as { events?: unknown }).events;
  if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENTS_PER_BATCH) return null;
  return events.map(parseEvent).filter((e): e is GameEvent => e !== null);
}
