import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import type { MatchupAnalysisProvider } from '../server/analysis/MatchupAnalysisProvider.js';
import { createRuntimeApp } from '../server/runtime.js';
import {
  DEFAULT_SERVER_PORT,
  LOCAL_SERVER_HOSTNAME,
  PRODUCTION_SERVER_HOSTNAME,
  ServerConfigurationError,
  loadServerConfig,
} from '../server/server-config.js';

function temporaryClientDirectory(t: test.TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'lanelens-client-'));
  mkdirSync(join(directory, 'assets'));
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>LaneLens alpha</title>', 'utf8');
  writeFileSync(join(directory, 'assets', 'app.js'), 'globalThis.LaneLens = true;', 'utf8');
  t.after(() => {
    const resolved = resolve(directory);
    assert.ok(resolved.startsWith(resolve(tmpdir())));
    rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}

test('server configuration keeps local defaults and binds production or Render publicly', () => {
  assert.deepEqual(loadServerConfig({}), {
    hostname: LOCAL_SERVER_HOSTNAME,
    port: DEFAULT_SERVER_PORT,
    production: false,
  });
  assert.deepEqual(loadServerConfig({ NODE_ENV: ' production ', PORT: ' 10000 ' }), {
    hostname: PRODUCTION_SERVER_HOSTNAME,
    port: 10_000,
    production: true,
  });
  assert.deepEqual(loadServerConfig({ RENDER: ' true ', PORT: '12345' }), {
    hostname: PRODUCTION_SERVER_HOSTNAME,
    port: 12_345,
    production: true,
  });
  assert.equal(loadServerConfig({ NODE_ENV: 'production' }).port, DEFAULT_SERVER_PORT);
  assert.equal(loadServerConfig({ PORT: '4567' }).port, DEFAULT_SERVER_PORT);
});

test('production PORT parsing rejects unsafe or malformed values without exposing them', () => {
  for (const port of ['0', '-1', '1.5', 'abc', '65536', '9007199254740992']) {
    assert.throws(
      () => loadServerConfig({ NODE_ENV: 'production', PORT: port }),
      (error: unknown) => {
        assert.ok(error instanceof ServerConfigurationError);
        assert.doesNotMatch(error.message, new RegExp(port.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        return true;
      },
    );
  }
});

test('production runtime serves Vite assets and SPA routes without capturing API routes', async (t) => {
  const clientDirectory = temporaryClientDirectory(t);
  const app = createRuntimeApp({
    environment: { NODE_ENV: 'production' },
    clientDirectory,
  });

  const root = await app.request('/');
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await root.text(), /LaneLens alpha/);

  const asset = await app.request('/assets/app.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type') ?? '', /javascript/);
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.match(await asset.text(), /LaneLens/);

  const spa = await app.request('/matchup/result');
  assert.equal(spa.status, 200);
  assert.match(spa.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await spa.text(), /LaneLens alpha/);

  const health = await app.request('/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const unknownApi = await app.request('/api/not-a-route');
  assert.equal(unknownApi.status, 404);
  assert.doesNotMatch(await unknownApi.text(), /LaneLens alpha/);
});

test('development runtime leaves frontend delivery to Vite', async (t) => {
  const app = createRuntimeApp({
    environment: {},
    clientDirectory: temporaryClientDirectory(t),
  });
  assert.equal((await app.request('/')).status, 404);
  assert.equal((await app.request('/api/health')).status, 200);
});

test('healthcheck never calls the configured analysis provider or feedback tracker', async (t) => {
  let analysisCalls = 0;
  let feedbackCalls = 0;
  const provider: MatchupAnalysisProvider = {
    async analyze() {
      analysisCalls += 1;
      throw new Error('healthcheck must not analyze');
    },
  };
  const app = createRuntimeApp({
    environment: {
      RENDER: 'true',
      AI_PROVIDER: 'groq',
      GROQ_API_KEY: 'server-only-key',
      FEEDBACK_GITHUB_TOKEN: 'server-only-token',
      FEEDBACK_GITHUB_OWNER: 'Braoux',
      FEEDBACK_GITHUB_REPOSITORY: 'LaneLens-Internal',
    },
    clientDirectory: temporaryClientDirectory(t),
    groqProviderFactory() { return provider; },
    feedbackTrackerFactory() {
      return { async create() { feedbackCalls += 1; } };
    },
  });

  const response = await app.request('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(analysisCalls, 0);
  assert.equal(feedbackCalls, 0);
});
