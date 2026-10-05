import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';
import { MatchupAnalysisError } from '../server/analysis/errors.js';
import { MatchupAnalysisService } from '../server/analysis/MatchupAnalysisService.js';
import type { MatchupAnalysis, MatchupAnalysisInput } from '../server/analysis/types.js';
import {
  createDeepSeekProvider,
  createDeepSeekSDKClient,
  DeepSeekProvider,
  DeepSeekProviderError,
  type DeepSeekClient,
  type DeepSeekRequest,
} from '../server/analysis/providers/DeepSeekProvider.js';
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_TIMEOUT_MS,
  DEFAULT_DEEPSEEK_TRANSPORT_MARGIN_MS,
  DeepSeekConfigurationError,
  loadDeepSeekConfig,
} from '../server/analysis/providers/deepseek-config.js';

const input: MatchupAnalysisInput = {
  allyCarry: 'Ziggs',
  allySupport: 'Galio',
  enemyCarry: 'Jinx',
  enemySupport: 'Swain',
  patch: '26.19',
  locale: 'fr-FR',
  patchContext: {
    patch: '26.19',
    contextVersion: '26.19-v1',
    facts: [{ subject: 'Ziggs', text: 'Contexte LaneLens.' }],
  },
};

function validAnalysis(): MatchupAnalysis {
  return {
    matchup: {
      allyCarry: 'Ziggs', allySupport: 'Galio', enemyCarry: 'Jinx', enemySupport: 'Swain', patch: '26.19',
    },
    lanePlan: 'Jouer autour du poke et des contrôles adverses.',
    threatResponseWindow: {
      threat: 'Swain cherche son contrôle.',
      response: 'Esquiver puis reprendre l’espace.',
      window: 'Pendant son délai de récupération.',
      winCondition: 'Créer une fenêtre de poke sûre.',
    },
    earlyLevels: {
      level1: 'Prendre la priorité sans s’exposer.',
      level2: 'Respecter les contrôles adverses.',
      level3: 'Jouer autour des délais de récupération.',
    },
    wavePlan: 'Maintenir la vague à portée du poke de Ziggs.',
    targetPriority: { primaryTarget: 'Swain', explanation: 'Le punir après son contrôle.' },
    postLevel6: 'Éviter les combats prolongés dans l’ultime de Swain.',
    roamPlan: 'Galio peut se déplacer après avoir poussé.',
    cheatSheet: ['Contrôle raté → avancer'],
    goldenRule: 'Ne pas forcer dans les contrôles adverses.',
  };
}

class FakeDeepSeekClient implements DeepSeekClient {
  readonly requests: DeepSeekRequest[] = [];

  constructor(private readonly outputText: string | null = JSON.stringify(validAnalysis())) {}

  async generate(request: DeepSeekRequest) {
    this.requests.push(request);
    return { outputText: this.outputText, finishReason: 'stop' };
  }
}

const providerRequest = { input, instructions: 'Instructions LaneLens exactes.' };

test('DeepSeek configuration trims values and applies safe documented defaults', () => {
  assert.deepEqual(loadDeepSeekConfig({ DEEPSEEK_API_KEY: ' secret ' }), {
    apiKey: 'secret',
    model: DEFAULT_DEEPSEEK_MODEL,
    baseURL: DEFAULT_DEEPSEEK_BASE_URL,
    deadlineMs: DEFAULT_DEEPSEEK_TIMEOUT_MS,
    transportTimeoutMs: DEFAULT_DEEPSEEK_TIMEOUT_MS + DEFAULT_DEEPSEEK_TRANSPORT_MARGIN_MS,
  });
  assert.deepEqual(loadDeepSeekConfig({
    DEEPSEEK_API_KEY: ' key ',
    DEEPSEEK_MODEL: ' deepseek-v4-pro ',
    DEEPSEEK_BASE_URL: ' https://proxy.example.test/deepseek/ ',
    DEEPSEEK_TIMEOUT_MS: ' 45000 ',
    DEEPSEEK_TRANSPORT_TIMEOUT_MS: ' 60000 ',
  }), {
    apiKey: 'key',
    model: 'deepseek-v4-pro',
    baseURL: 'https://proxy.example.test/deepseek',
    deadlineMs: 45_000,
    transportTimeoutMs: 60_000,
  });
});

test('DeepSeek configuration rejects missing keys, invalid URLs, and invalid timeouts safely', () => {
  const invalid = [
    {},
    { DEEPSEEK_API_KEY: '   ' },
    { DEEPSEEK_API_KEY: 'sensitive', DEEPSEEK_BASE_URL: 'not-a-url' },
    { DEEPSEEK_API_KEY: 'sensitive', DEEPSEEK_BASE_URL: 'file:///secret' },
    { DEEPSEEK_API_KEY: 'sensitive', DEEPSEEK_TIMEOUT_MS: '0' },
    { DEEPSEEK_API_KEY: 'sensitive', DEEPSEEK_TIMEOUT_MS: '-1' },
    { DEEPSEEK_API_KEY: 'sensitive', DEEPSEEK_TIMEOUT_MS: '1.5' },
    { DEEPSEEK_API_KEY: 'sensitive', DEEPSEEK_TIMEOUT_MS: '9007199254740992' },
    { DEEPSEEK_API_KEY: 'sensitive', DEEPSEEK_TIMEOUT_MS: '9007199254740991' },
    { DEEPSEEK_API_KEY: 'sensitive', DEEPSEEK_TRANSPORT_TIMEOUT_MS: '0' },
    {
      DEEPSEEK_API_KEY: 'sensitive',
      DEEPSEEK_TIMEOUT_MS: '90000',
      DEEPSEEK_TRANSPORT_TIMEOUT_MS: '90000',
    },
  ];
  for (const environment of invalid) {
    assert.throws(() => loadDeepSeekConfig(environment), (error: unknown) => {
      assert.ok(error instanceof DeepSeekConfigurationError);
      assert.equal(error.message, 'La configuration DeepSeek est invalide.');
      assert.doesNotMatch(error.message, /sensitive|file:/u);
      return true;
    });
  }
});

test('DeepSeek provider sends the complete input with stable JSON and reasoning settings', async () => {
  const client = new FakeDeepSeekClient();
  const provider = new DeepSeekProvider(client, 'deepseek-flash', 90_000, 100_000);
  await provider.analyze(providerRequest);

  assert.equal(client.requests.length, 1);
  assert.deepEqual({ ...client.requests[0], signal: undefined }, {
    model: 'deepseek-flash',
    instructions: 'Instructions LaneLens exactes.',
    input: JSON.stringify(input),
    responseFormat: { type: 'json_object' },
    thinking: { type: 'enabled' },
    reasoningEffort: 'high',
    tools: [],
    signal: undefined,
    transportTimeoutMs: 100_000,
  });
  assert.equal(client.requests[0]?.signal.aborted, false);
});

test('DeepSeek provider reports safe request and token metadata to the runner boundary', async () => {
  const observed: unknown[] = [];
  const provider = new DeepSeekProvider({
    async generate() {
      return {
        outputText: JSON.stringify(validAnalysis()),
        finishReason: 'stop',
        providerRequestId: 'ds-request-usage',
        tokenUsage: { inputTokens: 11, outputTokens: 22, totalTokens: 33, reasoningTokens: 7 },
      };
    },
  }, 'deepseek-flash', 90_000, 100_000);
  await provider.analyze(providerRequest, { onMetadata(metadata) { observed.push(metadata); } });
  assert.deepEqual(observed, [{
    providerRequestId: 'ds-request-usage',
    inputTokens: 11,
    outputTokens: 22,
    totalTokens: 33,
    reasoningTokens: 7,
  }]);
});

test('DeepSeek SDK adapter uses Chat Completions without tools and extracts usage metadata', async () => {
  let body: Record<string, unknown> | undefined;
  let requestOptions: Record<string, unknown> | undefined;
  const sdk = {
    chat: {
      completions: {
        create(value: Record<string, unknown>, options: Record<string, unknown>) {
          body = value;
          requestOptions = options;
          return {
            async withResponse() {
              return {
                data: {
                  choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
                  usage: {
                    prompt_tokens: 10,
                    completion_tokens: 20,
                    total_tokens: 30,
                    completion_tokens_details: { reasoning_tokens: 7 },
                  },
                },
                request_id: 'ds-request-123',
              };
            },
          };
        },
      },
    },
  } as unknown as OpenAI;
  const client = createDeepSeekSDKClient({
    apiKey: 'secret', baseURL: 'https://api.deepseek.com', timeout: 30_000, maxRetries: 0, logLevel: 'off',
  }, () => sdk);
  const result = await client.generate({
    model: 'deepseek-flash',
    instructions: 'Instructions LaneLens exactes.',
    input: '{"input":true}',
    responseFormat: { type: 'json_object' },
    thinking: { type: 'enabled' },
    reasoningEffort: 'high',
    tools: [],
    signal: AbortSignal.timeout(90_000),
    transportTimeoutMs: 100_000,
  });

  assert.equal(body?.model, 'deepseek-flash');
  assert.equal(body?.response_format && (body.response_format as { type: string }).type, 'json_object');
  assert.deepEqual(body?.thinking, { type: 'enabled' });
  assert.equal(body?.reasoning_effort, 'high');
  assert.equal('tools' in (body ?? {}), false);
  assert.match(JSON.stringify(body?.messages), /Instructions LaneLens exactes/u);
  assert.match(JSON.stringify(body?.messages), /objet JSON/u);
  assert.match(JSON.stringify(body?.messages), /additionalProperties/u);
  assert.match(JSON.stringify(body?.messages), /\{\\"input\\":true\}/u);
  assert.equal(requestOptions?.timeout, 100_000);
  assert.equal(requestOptions?.maxRetries, 0);
  assert.ok(requestOptions?.signal instanceof AbortSignal);
  assert.deepEqual(result, {
    outputText: '{"ok":true}',
    finishReason: 'stop',
    providerRequestId: 'ds-request-123',
    tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, reasoningTokens: 7 },
  });
  assert.doesNotMatch(JSON.stringify(body), /secret/u);
});

test('DeepSeek output is parsed once and remains subject to LaneLens validation', async () => {
  const service = new MatchupAnalysisService(
    new DeepSeekProvider(new FakeDeepSeekClient(), 'deepseek-flash', 90_000, 100_000),
  );
  assert.deepEqual(await service.analyze(input), validAnalysis());

  const wrongMatchup = { ...validAnalysis(), matchup: { ...validAnalysis().matchup, allyCarry: 'Jinx' } };
  const invalidService = new MatchupAnalysisService(
    new DeepSeekProvider(
      new FakeDeepSeekClient(JSON.stringify(wrongMatchup)),
      'deepseek-flash',
      90_000,
      100_000,
    ),
  );
  await assert.rejects(invalidService.analyze(input), (error: unknown) => (
    error instanceof MatchupAnalysisError && error.code === 'INVALID_ANALYSIS_RESPONSE'
  ));
});

test('empty, malformed, and truncated DeepSeek responses become invalid analyses', async () => {
  for (const result of [
    { outputText: null, finishReason: 'stop' },
    { outputText: '   ', finishReason: 'stop' },
    { outputText: '{', finishReason: 'stop' },
    { outputText: JSON.stringify(validAnalysis()), finishReason: 'length' },
  ]) {
    const provider = new DeepSeekProvider(
      { async generate() { return result; } },
      'deepseek-flash',
      90_000,
      100_000,
    );
    assert.equal(await provider.analyze(providerRequest), null);
  }
});

test('DeepSeek provider exposes safe normalized failures and never includes its key', async () => {
  const cause = Object.assign(
    new Error('401 api_key=deepseek-sensitive Authorization: Bearer hidden-token'),
    { status: 401, requestID: 'ds-error-request' },
  );
  const provider = new DeepSeekProvider(
    { async generate() { throw cause; } },
    'deepseek-flash',
    90_000,
    100_000,
  );
  await assert.rejects(provider.analyze(providerRequest), (error: unknown) => {
    assert.ok(error instanceof DeepSeekProviderError);
    assert.equal(error.category, 'authentication');
    assert.equal(error.status, 401);
    assert.equal(error.providerRequestId, 'ds-error-request');
    assert.doesNotMatch(JSON.stringify(error), /deepseek-sensitive|hidden-token/u);
    return true;
  });
});

test('DeepSeek factory revalidates manual configuration and disables SDK retries and logs', () => {
  let options: unknown;
  createDeepSeekProvider({
    apiKey: ' key ',
    model: ' deepseek-v4-pro ',
    baseURL: ' https://api.deepseek.com/ ',
    deadlineMs: 1_234,
    transportTimeoutMs: 2_345,
  }, (value) => {
    options = value;
    return new FakeDeepSeekClient();
  });
  assert.deepEqual(options, {
    apiKey: 'key',
    baseURL: 'https://api.deepseek.com',
    timeout: 2_345,
    maxRetries: 0,
    logLevel: 'off',
  });
});

test('DeepSeek application deadline aborts a long request and is normalized without retry', async () => {
  let calls = 0;
  let observedSignal: AbortSignal | undefined;
  const provider = new DeepSeekProvider({
    async generate(request) {
      calls += 1;
      observedSignal = request.signal;
      return new Promise((_, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
      });
    },
  }, 'deepseek-flash', 10, 100, 'application');

  await assert.rejects(provider.analyze(providerRequest), (error: unknown) => {
    assert.ok(error instanceof DeepSeekProviderError);
    assert.equal(error.category, 'timeout');
    assert.equal(error.executionContext, 'application');
    assert.equal(error.deadlineMs, 10);
    assert.ok((error.durationMs ?? 0) >= 0);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(observedSignal?.aborted, true);
});

test('DeepSeek accepts a final response received before the LaneLens deadline', async () => {
  const provider = new DeepSeekProvider({
    async generate() {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { outputText: JSON.stringify(validAnalysis()), finishReason: 'stop' };
    },
  }, 'deepseek-flash', 100, 200);

  assert.deepEqual(await provider.analyze(providerRequest), validAnalysis());
});

test('DeepSeek non-streaming keep-alive whitespace remains pending and final JSON is parsed', async () => {
  const encoder = new TextEncoder();
  let finishResponse: (() => void) | undefined;
  const fetchImpl: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('\n\n'));
      finishResponse = () => {
        controller.enqueue(encoder.encode(JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })));
        controller.close();
      };
    },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'keep-alive-request' },
  });
  const client = createDeepSeekSDKClient({
    apiKey: 'secret',
    baseURL: 'https://api.deepseek.com',
    timeout: 1_000,
    maxRetries: 0,
    logLevel: 'off',
  }, (options) => new OpenAI({ ...options, fetch: fetchImpl }));
  let settled = false;
  const pending = client.generate({
    model: 'deepseek-flash',
    instructions: 'JSON seulement.',
    input: '{}',
    responseFormat: { type: 'json_object' },
    thinking: { type: 'enabled' },
    reasoningEffort: 'high',
    tools: [],
    signal: AbortSignal.timeout(500),
    transportTimeoutMs: 1_000,
  }).finally(() => { settled = true; });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.ok(finishResponse !== undefined);
  finishResponse();
  assert.equal((await pending).outputText, '{"ok":true}');
});
