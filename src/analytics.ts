import { MAX_EVENTS_PER_BATCH, scrubMessage, type GameEvent } from '../shared/events';
import { readStorage, writeStorage } from './storage';

/**
 * Anonymous gameplay analytics. A handful of events per picture, never one
 * per move. Starts are sent at once so a quick exit still counts as a start;
 * everything else is batched and flushed when the page is hidden.
 */

export const EVENTS_URL = '/api/events';
const FLUSH_DELAY_MS = 10_000;
const MAX_QUEUE = 100;
const MAX_ERRORS_PER_PAGE = 5;
const VISITED_KEY = 'shape-reveal:visited:v1';

type Sender = (body: string, useBeacon: boolean) => void;

const defaultSender: Sender = (body, useBeacon) => {
  if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    // text/plain keeps the beacon a simple request (no CORS preflight).
    if (navigator.sendBeacon(EVENTS_URL, new Blob([body], { type: 'text/plain' }))) return;
  }
  void fetch(EVENTS_URL, { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => undefined);
};

let queue: GameEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sender: Sender = defaultSender;
let enabled = import.meta.env.PROD && import.meta.env.VITE_ANALYTICS !== 'off';
let errorsSent = 0;

/** Test hook: capture payloads instead of sending them. */
export function configureAnalytics(options: { enabled: boolean; sender?: Sender }): void {
  enabled = options.enabled;
  sender = options.sender ?? defaultSender;
  queue = [];
  errorsSent = 0;
  if (timer) clearTimeout(timer);
  timer = null;
}

export function flush(useBeacon = false): void {
  if (timer) clearTimeout(timer);
  timer = null;
  while (queue.length > 0) {
    const batch = queue.splice(0, MAX_EVENTS_PER_BATCH);
    if (enabled) sender(JSON.stringify({ events: batch }), useBeacon);
  }
}

export function track(event: GameEvent): void {
  if (!enabled) return;
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push(event);
  if (event.name === 'run_started' || event.name === 'picture_started' || queue.length >= MAX_EVENTS_PER_BATCH) {
    flush();
  } else if (!timer) {
    timer = setTimeout(() => flush(), FLUSH_DELAY_MS);
  }
}

/** Whether this browser has started a run before. Marks it as visited. */
export function visitKind(): 'first' | 'returning' {
  const seen = readStorage(VISITED_KEY) === true;
  if (!seen) writeStorage(VISITED_KEY, true);
  return seen ? 'returning' : 'first';
}

export function trackError(errorKind: GameEvent['errorKind'], message: string, mode: GameEvent['mode'] = 'free', pictureId?: string): void {
  if (errorsSent >= MAX_ERRORS_PER_PAGE) return;
  errorsSent += 1;
  track({ name: 'client_error', mode, errorKind, message: scrubMessage(message), pictureId });
}

/** Report uncaught errors and flush on hide. Call once at startup. */
export function installAnalytics(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (event) => trackError('window_error', event.message || 'Error'));
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
    trackError('unhandled_rejection', reason);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', () => flush(true));
}
