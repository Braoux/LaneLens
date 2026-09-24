import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { MatchupAnalysisError } from '../server/analysis/errors.js';
import type { MatchupAnalysis, MatchupAnalysisInput, PatchContext } from '../server/analysis/types.js';
import type { PatchContextResolution } from '../server/patch-context/PatchContextResolver.js';

const requestBody = {
  allyCarry: 'Ziggs',
  allySupport: 'Galio',
  enemyCarry: 'Jinx',
  enemySupport: 'Swain',
  patch: '26.19',
};

const patchContext = (patch = '26.19'): PatchContext => ({
  patch,
  contextVersion: `${patch}-v1`,
  facts: [{ subject: 'Matchup', text: 'Contexte préparé par LaneLens.' }],
});

const analysis = (): MatchupAnalysis => ({
  matchup: { ...requestBody },
  lanePlan: 'Contrôler la vague et jouer les fenêtres de cooldown.',
  threatResponseWindow: {
    threat: 'Swain cherche son E.',
    response: 'Esquiver puis avancer.',
    window: 'Pendant le cooldown du E.',
    winCondition: 'Créer une fenêtre de poke sûre.',
  },
  earlyLevels: {
    level1: 'Prendre la priorité sans s’exposer.',
    level2: 'Respecter le contrôle adverse.',
    level3: 'Jouer autour des cooldowns.',
  },
  wavePlan: 'Maintenir une vague favorable.',
  targetPriority: {
    primaryTarget: 'Swain',
    explanation: 'Punir son positionnement après le E.',
  },
  postLevel6: 'Éviter les combats prolongés dans l’ultime de Swain.',
  roamPlan: 'Roam après avoir poussé la vague.',
  cheatSheet: ['Swain E miss → avance'],
  goldenRule: 'Ne force pas dans les contrôles adverses.',
});

function configuredApp(options: {
  resolution?: PatchContextResolution;
  result?: MatchupAnalysis;
  analysisError?: unknown;
  resolverError?: unknown;
} = {}) {
  const resolvedPatches: string[] = [];
  const analyzedInputs: MatchupAnalysisInput[] = [];

  const app = createApp({
    patchContextResolver: {
      async resolve(patch) {
        resolvedPatches.push(patch);
        if (options.resolverError !== undefined) throw options.resolverError;
        return options.resolution ?? { status: 'ready', context: patchContext(patch) };
      },
    },
    analysisService: {
      async analyze(input) {
        analyzedInputs.push(input);
        if (options.analysisError !== undefined) throw options.analysisError;
        return options.result ?? analysis();
      },
    },
  });

  return { app, resolvedPatches, analyzedInputs };
}

function postJson(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request('/api/matchup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function expectApiError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/i);
  const payload = await response.json() as { error?: { code?: string; message?: string } };
  assert.equal(payload.error?.code, code);
  assert.equal(typeof payload.error?.message, 'string');
  assert.ok((payload.error?.message ?? '').length > 0);
  assert.deepEqual(Object.keys(payload), ['error']);
  assert.deepEqual(Object.keys(payload.error ?? {}).sort(), ['code', 'message']);
}

test('POST /api/matchup resolves context, calls the injected service, and returns its analysis', async () => {
  const expected = analysis();
  const { app, resolvedPatches, analyzedInputs } = configuredApp({ result: expected });

  const response = await postJson(app, requestBody);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/i);
  assert.deepEqual(await response.json(), expected);
  assert.deepEqual(resolvedPatches, ['26.19']);
  assert.deepEqual(analyzedInputs, [{ ...requestBody, patchContext: patchContext() }]);
});

test('request values are trimmed before context resolution and analysis', async () => {
  const { app, resolvedPatches, analyzedInputs } = configuredApp();
  const padded = Object.fromEntries(
    Object.entries(requestBody).map(([key, value]) => [key, ` ${value} `]),
  );

  assert.equal((await postJson(app, padded)).status, 200);
  assert.deepEqual(resolvedPatches, ['26.19']);
  assert.deepEqual(
    analyzedInputs[0],
    { ...requestBody, patchContext: patchContext() },
  );
});

test('missing, mistyped, blank, extra, array, and null request bodies are rejected', async () => {
  const invalidBodies: unknown[] = [
    (({ patch: _patch, ...rest }) => rest)(requestBody),
    { ...requestBody, patch: 2619 },
    { ...requestBody, allySupport: '   ' },
    { ...requestBody, unexpected: true },
    [requestBody],
    null,
  ];

  for (const body of invalidBodies) {
    const { app, resolvedPatches, analyzedInputs } = configuredApp();
    await expectApiError(await postJson(app, body), 422, 'INVALID_MATCHUP_REQUEST');
    assert.equal(resolvedPatches.length, 0);
    assert.equal(analyzedInputs.length, 0);
  }
});

test('same-team duplicates are rejected after trim and case folding', async () => {
  for (const body of [
    { ...requestBody, allySupport: ' ziggs ' },
    { ...requestBody, enemySupport: ' jInX ' },
  ]) {
    const { app } = configuredApp();
    await expectApiError(await postJson(app, body), 422, 'INVALID_MATCHUP_REQUEST');
  }
});

test('a mirrored champion across opposing teams is accepted', async () => {
  const { app, analyzedInputs } = configuredApp();
  const mirrored = { ...requestBody, enemyCarry: 'Ziggs' };

  assert.equal((await postJson(app, mirrored)).status, 200);
  assert.equal(analyzedInputs[0]?.allyCarry, 'Ziggs');
  assert.equal(analyzedInputs[0]?.enemyCarry, 'Ziggs');
});

test('missing or non-JSON Content-Type is rejected with 415', async () => {
  for (const headers of [undefined, { 'content-type': 'text/plain' }]) {
    const { app } = configuredApp();
    const response = await app.request('/api/matchup', {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
    await expectApiError(response, 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
});

test('application/json with parameters is accepted', async () => {
  const { app } = configuredApp();
  const response = await app.request('/api/matchup', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(requestBody),
  });
  assert.equal(response.status, 200);
});

test('absent or malformed declared JSON is rejected with 400', async () => {
  for (const body of [undefined, '{not-json']) {
    const { app } = configuredApp();
    const response = await app.request('/api/matchup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    await expectApiError(response, 400, 'INVALID_JSON');
  }
});

test('unknown and unavailable patch contexts use their documented errors', async () => {
  for (const [resolution, status, code] of [
    [{ status: 'not-found' }, 422, 'PATCH_CONTEXT_NOT_FOUND'],
    [{ status: 'unavailable' }, 503, 'PATCH_CONTEXT_UNAVAILABLE'],
  ] as const) {
    const { app, analyzedInputs } = configuredApp({ resolution });
    await expectApiError(await postJson(app, requestBody), status, code);
    assert.equal(analyzedInputs.length, 0);
  }
});

test('invalid or incoherent resolved contexts are rejected before analysis', async () => {
  const invalidContexts = [
    patchContext('26.18'),
    { ...patchContext(), contextVersion: '   ' },
    { ...patchContext(), facts: [] },
    { ...patchContext(), facts: [{ subject: '', text: 'fact' }] },
  ];

  for (const context of invalidContexts) {
    const { app, analyzedInputs } = configuredApp({ resolution: { status: 'ready', context } });
    await expectApiError(await postJson(app, requestBody), 500, 'PATCH_CONTEXT_INVALID');
    assert.equal(analyzedInputs.length, 0);
  }
});

test('a malformed resolver result is treated as an invalid context contract', async () => {
  const app = createApp({
    patchContextResolver: { async resolve() { return { status: 'unexpected' } as never; } },
    analysisService: { async analyze() { return analysis(); } },
  });

  await expectApiError(await postJson(app, requestBody), 500, 'PATCH_CONTEXT_INVALID');
});

test('LAN-004 errors are translated to the documented HTTP contract', async () => {
  for (const [analysisCode, status] of [
    ['ANALYSIS_PROVIDER_UNAVAILABLE', 503],
    ['INVALID_ANALYSIS_RESPONSE', 502],
    ['ANALYSIS_FAILED', 500],
  ] as const) {
    const { app } = configuredApp({ analysisError: new MatchupAnalysisError(analysisCode) });
    await expectApiError(await postJson(app, requestBody), status, analysisCode);
  }
});

test('unexpected resolver and service errors return a safe INTERNAL_ERROR', async () => {
  for (const options of [
    { resolverError: new Error('token=resolver-secret C:\\private\\context.json') },
    { analysisError: new Error('token=provider-secret C:\\private\\provider.json') },
  ]) {
    const { app } = configuredApp(options);
    const response = await postJson(app, requestBody);
    assert.equal(response.status, 500);
    const serialized = JSON.stringify(await response.json());
    assert.match(serialized, /INTERNAL_ERROR/);
    assert.doesNotMatch(serialized, /secret|private|token/i);
  }
});

test('POST /api/matchup returns ANALYSIS_NOT_CONFIGURED without runtime dependencies', async () => {
  await expectApiError(
    await postJson(createApp(), requestBody),
    503,
    'ANALYSIS_NOT_CONFIGURED',
  );
});

test('partial runtime configuration is also treated as not configured', async () => {
  const app = createApp({
    analysisService: { async analyze() { return analysis(); } },
  });
  await expectApiError(await postJson(app, requestBody), 503, 'ANALYSIS_NOT_CONFIGURED');
});

test('GET /api/health remains unchanged with and without analysis dependencies', async () => {
  for (const app of [createApp(), configuredApp().app]) {
    const response = await app.request('/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  }
});
