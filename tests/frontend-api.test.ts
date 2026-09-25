import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AnalysisRequestError,
  InvalidAnalysisResponseError,
  analyzeMatchup,
  getAnalysisContext,
} from '../src/api';
import type { MatchupAnalysis, MatchupRequest } from '../shared/analysis-contract';

const request: MatchupRequest = {
  allyCarry: 'Ziggs', allySupport: 'Galio', enemyCarry: 'Jinx', enemySupport: 'Swain', patch: '26.19', locale: 'fr-FR',
};

const analysis: MatchupAnalysis = {
  matchup: { allyCarry: request.allyCarry, allySupport: request.allySupport, enemyCarry: request.enemyCarry, enemySupport: request.enemySupport, patch: request.patch },
  lanePlan: 'Plan.',
  threatResponseWindow: { threat: 'Threat.', response: 'Response.', window: 'Window.', winCondition: 'Win.' },
  earlyLevels: { level1: 'N1.', level2: 'N2.', level3: 'N3.' },
  wavePlan: 'Wave.',
  targetPriority: { primaryTarget: 'Jinx', explanation: 'Target.' },
  postLevel6: 'Six.',
  roamPlan: 'Roam.',
  cheatSheet: ['Rappel.'],
  goldenRule: 'Rule.',
};

test('getAnalysisContext validates and normalizes the server response', async () => {
  const fetchImpl = async () => Response.json({ patch: ' 26.19 ', contextVersion: ' 26.19-v1 ' });
  assert.deepEqual(await getAnalysisContext(fetchImpl as typeof fetch), {
    patch: '26.19', contextVersion: '26.19-v1',
  });
});

test('getAnalysisContext rejects unavailable, non-JSON, and invalid responses', async () => {
  const cases = [
    async () => new Response('', { status: 503 }),
    async () => new Response('not-json', { status: 200 }),
    async () => Response.json({ patch: '', contextVersion: 'v1' }),
  ];
  for (const fetchImpl of cases) {
    await assert.rejects(getAnalysisContext(fetchImpl as typeof fetch));
  }
});

test('analyzeMatchup sends the exact public DTO and returns a validated analysis', async () => {
  let url = '';
  let init: RequestInit | undefined;
  const fetchImpl = async (input: string | URL | Request, options?: RequestInit) => {
    url = String(input);
    init = options;
    return Response.json(analysis);
  };

  assert.deepEqual(await analyzeMatchup(request, undefined, fetchImpl as typeof fetch), analysis);
  assert.equal(url, '/api/matchup');
  assert.equal(init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(init?.body)), request);
  assert.deepEqual(Object.keys(JSON.parse(String(init?.body))).sort(), Object.keys(request).sort());
});

test('analyzeMatchup rejects invalid HTTP 200 bodies with a dedicated safe error', async () => {
  for (const response of [
    new Response('not-json', { status: 200 }),
    Response.json({ ...analysis, cheatSheet: [] }),
    Response.json({ ...analysis, matchup: { ...analysis.matchup, patch: '26.19.1' } }),
  ]) {
    const fetchImpl = async () => response.clone();
    await assert.rejects(
      analyzeMatchup(request, undefined, fetchImpl as typeof fetch),
      InvalidAnalysisResponseError,
    );
  }
});

test('analyzeMatchup exposes no backend error body to its caller', async () => {
  const secret = 'provider-secret-token';
  const fetchImpl = async () => Response.json(
    { error: { code: 'INTERNAL_ERROR', message: secret } },
    { status: 500, headers: { 'x-request-id': 'request-correlation-id' } },
  );
  await assert.rejects(
    analyzeMatchup(request, undefined, fetchImpl as typeof fetch),
    (error: unknown) => {
      assert.ok(error instanceof AnalysisRequestError);
      assert.equal(error.status, 500);
      assert.equal(error.code, 'INTERNAL_ERROR');
      assert.equal(error.requestId, 'request-correlation-id');
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test('analyzeMatchup keeps request correlation safe when an error body is malformed', async () => {
  const fetchImpl = async () => new Response('external provider dump', {
    status: 503,
    headers: { 'x-request-id': 'safe-request-id' },
  });

  await assert.rejects(
    analyzeMatchup(request, undefined, fetchImpl as typeof fetch),
    (error: unknown) => error instanceof AnalysisRequestError
      && error.status === 503
      && error.code === undefined
      && error.requestId === 'safe-request-id'
      && !error.message.includes('external provider dump'),
  );
});
