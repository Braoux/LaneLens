import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createApp } from '../server/app.js';
import type { Logger, LogFields } from '../server/logging/Logger.js';
import { normalizeTelemetryRequest } from '../server/telemetry/validation.js';
import type { LocalStore } from '../src/storage.js';
import {
  TELEMETRY_CLIENT_ID_STORAGE_KEY,
  TELEMETRY_SESSION_ID_STORAGE_KEY,
  TelemetryClient,
  resolveTelemetryIdentity,
} from '../src/telemetry.js';

const clientId = '8a66cf72-6c12-4fd0-81aa-b315f62a83d4';
const sessionId = 'de14061a-dce4-49fb-89ac-d75bbdcb66b0';
const nextSessionId = 'aed3142b-5703-4d4e-a2b4-ae6f28fe8598';
const analysisRequestId = 'f66dd1f0-b690-4d6d-b28d-725da9d96506';

class MemoryStorage implements LocalStore {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

async function postTelemetry(app: ReturnType<typeof createApp>, body: unknown): Promise<Response> {
  return app.request('/api/telemetry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('telemetry identity keeps a stable client and creates one session identifier per session storage', () => {
  const local = new MemoryStorage();
  const firstSession = new MemoryStorage();
  const identifiers = [clientId, sessionId, nextSessionId];
  const uuid = () => identifiers.shift()!;

  const first = resolveTelemetryIdentity(local, firstSession, uuid);
  const sameSession = resolveTelemetryIdentity(local, firstSession, uuid);
  const laterSession = resolveTelemetryIdentity(local, new MemoryStorage(), uuid);

  assert.deepEqual(first, { clientId, sessionId, isNewSession: true });
  assert.deepEqual(sameSession, { clientId, sessionId, isNewSession: false });
  assert.deepEqual(laterSession, { clientId, sessionId: nextSessionId, isNewSession: true });
  assert.equal(local.values.get(TELEMETRY_CLIENT_ID_STORAGE_KEY), clientId);
  assert.equal(firstSession.values.get(TELEMETRY_SESSION_ID_STORAGE_KEY), sessionId);
});

test('telemetry client emits the seven allowlisted events, deduplicates completion, and never sends free text', async () => {
  const requests: unknown[] = [];
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ status: 'accepted' }, { status: 202 });
  }) as typeof fetch;
  const client = new TelemetryClient({ clientId, sessionId, isNewSession: true }, fetchImpl);

  client.appOpened();
  client.appOpened();
  client.analysisStarted({
    allyCarry: 'Jinx', allySupport: 'Thresh', enemyCarry: 'Caitlyn', enemySupport: 'Lux', patch: '26.19',
  });
  client.analysisCompleted({ analysisRequestId, patch: '26.19' });
  client.analysisCompleted({ analysisRequestId, patch: '26.19' });
  client.analysisFailed({ analysisRequestId, errorCode: 'ANALYSIS_PROVIDER_UNAVAILABLE' });
  client.historyOpened({ patch: '26.19' });
  client.feedbackOpened({ kind: 'analysis' });
  client.feedbackSubmitted({ kind: 'analysis', category: 'tactical_advice' });
  await Promise.resolve();

  assert.deepEqual(requests.map((request) => (request as { event: string }).event), [
    'app_opened', 'analysis_started', 'analysis_completed', 'analysis_failed',
    'history_opened', 'feedback_opened', 'feedback_submitted',
  ]);
  const serialized = JSON.stringify(requests);
  assert.doesNotMatch(serialized, /lanePlan|goldenRule|comment|userAgent|prompt/i);
});

test('telemetry failures are fire-and-forget and never escape into product flows', () => {
  const rejected = new TelemetryClient(
    { clientId, sessionId, isNewSession: true },
    (() => Promise.reject(new Error('offline'))) as typeof fetch,
  );
  const throwing = new TelemetryClient(
    { clientId, sessionId, isNewSession: true },
    (() => { throw new Error('offline'); }) as typeof fetch,
  );
  assert.doesNotThrow(() => rejected.analysisStarted({
    allyCarry: 'Jinx', allySupport: 'Thresh', enemyCarry: 'Caitlyn', enemySupport: 'Lux', patch: '26.19',
  }));
  assert.doesNotThrow(() => throwing.historyOpened({ patch: '26.19' }));
});

test('telemetry invokes the injected fetch function without a receiver', () => {
  let receiver: unknown = 'not-called';
  const fetchImpl = (function (this: unknown) {
    // Ce test vérifie volontairement le receiver de l'appel.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    receiver = this;
    return Promise.resolve(Response.json({ status: 'accepted' }, { status: 202 }));
  }) as typeof fetch;
  const client = new TelemetryClient({ clientId, sessionId, isNewSession: true }, fetchImpl);

  client.appOpened();

  assert.equal(receiver, undefined);
});

test('telemetry validation accepts only exact event-specific contexts', () => {
  const valid = [
    { clientId, sessionId, event: 'app_opened' },
    { clientId, sessionId, event: 'analysis_started', context: {
      allyCarry: 'Jinx', allySupport: 'Thresh', enemyCarry: 'Caitlyn', enemySupport: 'Lux', patch: '26.19',
    } },
    { clientId, sessionId, event: 'analysis_completed', context: { analysisRequestId, patch: '26.19' } },
    { clientId, sessionId, event: 'analysis_failed', context: { analysisRequestId, errorCode: 'ANALYSIS_FAILED' } },
    { clientId, sessionId, event: 'history_opened', context: { patch: '26.19' } },
    { clientId, sessionId, event: 'feedback_opened', context: { kind: 'bug' } },
    { clientId, sessionId, event: 'feedback_submitted', context: { kind: 'analysis', category: 'timing_level' } },
  ];
  for (const value of valid) assert.deepEqual(normalizeTelemetryRequest(value), value);

  const invalid = [
    { clientId, sessionId, event: 'unknown' },
    { clientId: 'derived-browser-id', sessionId, event: 'app_opened' },
    { clientId, sessionId, event: 'app_opened', timestamp: '2026-09-26T10:00:00Z' },
    { clientId, sessionId, event: 'history_opened', context: { patch: '26.19', history: [] } },
    { clientId, sessionId, event: 'feedback_submitted', context: { kind: 'bug', category: 'tactical_advice' } },
    { clientId, sessionId, event: 'analysis_completed', context: { patch: '26.19', analysis: { lanePlan: 'secret' } } },
  ];
  for (const value of invalid) assert.equal(normalizeTelemetryRequest(value), undefined);
});

test('POST /api/telemetry logs a sanitized product event with server request correlation', async () => {
  const entries: Array<{ event: string; fields: LogFields }> = [];
  const logger: Logger = {
    debug() {},
    info(event, fields = {}) { entries.push({ event, fields }); },
    warn() {},
    error() {},
  };
  const app = createApp({ logger });
  const response = await postTelemetry(app, {
    clientId,
    sessionId,
    event: 'analysis_started',
    context: { allyCarry: 'Jinx', allySupport: 'Thresh', enemyCarry: 'Caitlyn', enemySupport: 'Lux', patch: '26.19' },
  });

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: 'accepted' });
  const event = entries.find((entry) => entry.event === 'product_telemetry');
  assert.equal(event?.fields.clientId, clientId);
  assert.equal(event?.fields.sessionId, sessionId);
  assert.equal(event?.fields.telemetryEvent, 'analysis_started');
  assert.match(String(event?.fields.requestId), /^[0-9a-f-]{36}$/u);
  assert.doesNotMatch(JSON.stringify(entries), /analysis"|comment|userAgent|prompt/i);
});

test('POST /api/telemetry rejects malformed and unknown events without affecting health', async () => {
  const app = createApp();
  const invalid = await postTelemetry(app, { clientId, sessionId, event: 'scroll' });
  assert.equal(invalid.status, 422);
  assert.equal((await invalid.json() as { error: { code: string } }).error.code, 'INVALID_TELEMETRY_REQUEST');
  const health = await app.request('/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
});

test('frontend instrumentation covers all V1 product events without passing analysis content', () => {
  const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  for (const method of [
    'appOpened', 'analysisStarted', 'analysisCompleted', 'analysisFailed',
    'historyOpened', 'feedbackOpened', 'feedbackSubmitted',
  ]) assert.match(source, new RegExp(`telemetry\\.${method}\\(`));
  assert.doesNotMatch(source, /telemetry\.[A-Za-z]+\([^)]*analysis\b/su);
});
