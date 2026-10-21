import { MAX_BATCH_BYTES, parseBatch, type GameEvent } from '../../shared/events';
import type { Env } from './env';
import { error, readJson } from './http';

/**
 * Anonymous gameplay event intake. Validates a small batch and writes one
 * Analytics Engine data point per event. The caller's IP is used only as a
 * rate-limit key and is never stored.
 */

/** Fallback limiter when no Rate Limiting binding is configured (per isolate). */
const WINDOW_MS = 60_000;
const LIMIT_PER_WINDOW = 60;
const MAX_TRACKED = 5000;
const recent = new Map<string, { start: number; count: number }>();

async function allowed(env: Env, key: string): Promise<boolean> {
  if (env.EVENTS_LIMITER) return (await env.EVENTS_LIMITER.limit({ key })).success;
  const now = Date.now();
  const entry = recent.get(key);
  if (!entry || now - entry.start > WINDOW_MS) {
    if (recent.size >= MAX_TRACKED) recent.clear();
    recent.set(key, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= LIMIT_PER_WINDOW;
}

/** Column layout of the shape_reveal_events dataset; see docs/ANALYTICS.md. */
export function toDataPoint(event: GameEvent): AnalyticsEngineDataPoint {
  const n = (value: number | undefined) => value ?? -1;
  return {
    indexes: [event.name],
    blobs: [
      event.name, // blob1
      event.mode, // blob2
      event.pictureId ?? '', // blob3
      event.runId ?? '', // blob4
      event.reason ?? event.errorKind ?? '', // blob5
      event.visit ?? '', // blob6
      event.message ?? '', // blob7
    ],
    doubles: [
      1, // double1: count
      n(event.level), // double2
      n(event.chapter), // double3
      n(event.stage), // double4
      n(event.seconds), // double5
      n(event.mistakes), // double6
      n(event.hints), // double7
      n(event.score), // double8
      n(event.pictures), // double9
    ],
  };
}

export async function handleEvents(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return error(405, 'Method not allowed.');

  // Browsers always send Origin on POST; only accept the game's own pages.
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin && origin !== env.GAME_ORIGIN) return error(403, 'Origin not allowed.');

  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BATCH_BYTES) return error(413, 'Too many events.');

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (!(await allowed(env, ip))) return error(429, 'Slow down.');

  const events = parseBatch(await readJson(request, MAX_BATCH_BYTES, true));
  if (!events) return error(400, 'Send { events: [...] } with 1 to 20 events.');

  if (env.ANALYTICS) {
    for (const event of events) env.ANALYTICS.writeDataPoint(toDataPoint(event));
  }
  return new Response(null, { status: 204 });
}
