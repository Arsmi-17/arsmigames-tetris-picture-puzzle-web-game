import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBatch, parseEvent, scrubMessage } from '../shared/events';
import { handleEvents, toDataPoint } from '../worker/src/events';
import { configureAnalytics, flush, track } from '@/analytics';
import { createEnv } from './worker/fakes';

const SITE = 'https://play.example.com';

describe('event validation', () => {
  it('accepts a well-formed event and drops unknown fields', () => {
    expect(parseEvent({ name: 'picture_completed', mode: 'arcade', runId: '0f8b2c9e-1234-4abc-9def-001122334455', pictureId: 'lake-a1', level: 3, seconds: 42, extra: 'x' }))
      .toEqual({ name: 'picture_completed', mode: 'arcade', runId: '0f8b2c9e-1234-4abc-9def-001122334455', pictureId: 'lake-a1', level: 3, seconds: 42 });
  });

  it.each([
    ['unknown name', { name: 'moved_left', mode: 'relaxed' }],
    ['unknown mode', { name: 'run_started', mode: 'speedrun' }],
    ['a URL as picture id', { name: 'picture_started', mode: 'free', pictureId: 'https://images.example.com/a.png' }],
    ['a negative number', { name: 'picture_completed', mode: 'free', seconds: -1 }],
    ['a huge number', { name: 'picture_completed', mode: 'free', level: 1e9 }],
    ['a run id with odd characters', { name: 'run_started', mode: 'relaxed', runId: '<script>' }],
    ['an error without a kind', { name: 'client_error', mode: 'free', message: 'x' }],
  ])('rejects %s', (_name, event) => {
    expect(parseEvent(event)).toBeNull();
  });

  it('scrubs URLs and emails from error messages', () => {
    expect(scrubMessage('Failed https://images.example.com/x.png?sig=abc for me@example.com data:image/png;base64,AAA'))
      .toBe('Failed <url> for <email> <url>');
    expect(scrubMessage('x'.repeat(500))).toHaveLength(120);
  });

  it('limits batch size', () => {
    expect(parseBatch({ events: [] })).toBeNull();
    expect(parseBatch({ events: Array(21).fill({ name: 'run_started', mode: 'relaxed' }) })).toBeNull();
    expect(parseBatch({ events: [{ name: 'run_started', mode: 'relaxed' }, { name: 'bad' }] })).toHaveLength(1);
  });

  it('maps events to Analytics Engine columns without personal data', () => {
    const point = toDataPoint({ name: 'run_ended', mode: 'arcade', runId: 'abcdef12', reason: 'misses', pictures: 7, score: 4200 });
    expect(point.indexes).toEqual(['run_ended']);
    expect(point.blobs).toEqual(['run_ended', 'arcade', '', 'abcdef12', 'misses', '', '']);
    expect(point.doubles?.[0]).toBe(1);
    expect(point.doubles?.[7]).toBe(4200);
    expect(point.doubles?.[8]).toBe(7);
  });
});

describe('event intake endpoint', () => {
  function post(body: unknown, headers: Record<string, string> = {}, env = createEnv()) {
    return handleEvents(new Request(`${SITE}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE, 'cf-connecting-ip': '203.0.113.9', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }), env);
  }

  it('writes one data point per valid event', async () => {
    const written: unknown[] = [];
    const env = createEnv({ ANALYTICS: { writeDataPoint: (p: unknown) => written.push(p) } as AnalyticsEngineDataset });
    const response = await post({ events: [{ name: 'run_started', mode: 'relaxed', visit: 'first' }, { name: 'nope' }] }, {}, env);
    expect(response.status).toBe(204);
    expect(written).toHaveLength(1);
  });

  it('accepts sendBeacon text/plain bodies', async () => {
    const response = await post({ events: [{ name: 'run_started', mode: 'relaxed' }] }, { 'content-type': 'text/plain;charset=UTF-8' });
    expect(response.status).toBe(204);
  });

  it('rejects other origins, wrong methods, junk and oversized bodies', async () => {
    expect((await post({ events: [{ name: 'run_started', mode: 'relaxed' }] }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('not json')).status).toBe(400);
    expect((await post({ events: [{ name: 'run_started', mode: 'relaxed' }] }, { 'content-length': '999999' })).status).toBe(413);
    expect((await handleEvents(new Request(`${SITE}/api/events`), createEnv())).status).toBe(405);
  });

  it('rate-limits a single client', async () => {
    const env = createEnv();
    const statuses: number[] = [];
    for (let i = 0; i < 70; i += 1) {
      statuses.push((await post({ events: [{ name: 'run_started', mode: 'relaxed' }] }, { 'cf-connecting-ip': '198.51.100.7' }, env)).status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 204)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it('uses the Rate Limiting binding when configured', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const env = createEnv({ EVENTS_LIMITER: { limit } });
    expect((await post({ events: [{ name: 'run_started', mode: 'relaxed' }] }, {}, env)).status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.9' });
  });
});

describe('client batching', () => {
  let sent: { events: { name: string }[] }[];
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    configureAnalytics({ enabled: true, sender: (body) => sent.push(JSON.parse(body)) });
  });
  afterEach(() => {
    vi.useRealTimers();
    configureAnalytics({ enabled: false });
  });

  it('sends starts immediately and batches the rest', () => {
    track({ name: 'hint_used', mode: 'relaxed' });
    expect(sent).toHaveLength(0);
    track({ name: 'picture_started', mode: 'relaxed' });
    expect(sent).toHaveLength(1);
    expect(sent[0].events.map((e) => e.name)).toEqual(['hint_used', 'picture_started']);
    track({ name: 'picture_completed', mode: 'relaxed' });
    vi.advanceTimersByTime(10_000);
    expect(sent).toHaveLength(2);
  });

  it('splits large queues into valid batch sizes', () => {
    for (let i = 0; i < 45; i += 1) track({ name: 'hint_used', mode: 'free' });
    flush();
    expect(sent.every((b) => b.events.length <= 20)).toBe(true);
    expect(sent.reduce((n, b) => n + b.events.length, 0)).toBe(45);
  });

  it('sends nothing when disabled', () => {
    configureAnalytics({ enabled: false, sender: (body) => sent.push(JSON.parse(body)) });
    track({ name: 'run_started', mode: 'relaxed' });
    flush();
    expect(sent).toHaveLength(0);
  });
});
