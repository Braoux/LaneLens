import assert from 'node:assert/strict';
import test from 'node:test';
import { MatchupAnalysisError } from '../server/analysis/errors.js';
import { MatchupAnalysisService } from '../server/analysis/MatchupAnalysisService.js';
import type { MatchupAnalysis, MatchupAnalysisInput } from '../server/analysis/types.js';
import {
  createGeminiProvider,
  createGoogleGenAIClient,
  GeminiProvider,
  GeminiProviderError,
} from '../server/analysis/providers/GeminiProvider.js';
import type {
  GeminiClient,
  GeminiClientOptions,
  GeminiRequest,
  GeminiSDKOptions,
  GeminiSDKRequest,
  GeminiSDKRequestOptions,
} from '../server/analysis/providers/GeminiProvider.js';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_TIMEOUT_MS,
  GeminiConfigurationError,
  loadGeminiConfig,
} from '../server/analysis/providers/gemini-config.js';
import { MATCHUP_ANALYSIS_JSON_SCHEMA } from '../server/analysis/providers/matchup-analysis-schema.js';

const input: MatchupAnalysisInput = {
  allyCarry: 'Ziggs',
  allySupport: 'Galio',
  enemyCarry: 'Jinx',
  enemySupport: 'Swain',
  patch: '26.19',
  patchContext: {
    patch: '26.19',
    contextVersion: '26.19-v1',
    facts: [
      { subject: 'Ziggs', text: 'Contexte préparé par LaneLens.' },
      { subject: 'Swain E', text: 'Contexte préparé par LaneLens.' },
    ],
  },
};

const validAnalysis = (): MatchupAnalysis => ({
  matchup: {
    allyCarry: 'Ziggs',
    allySupport: 'Galio',
    enemyCarry: 'Jinx',
    enemySupport: 'Swain',
    patch: '26.19',
  },
  lanePlan: 'Jouer autour du poke et des cooldowns adverses.',
  threatResponseWindow: {
    threat: 'Swain cherche son E.',
    response: 'Esquiver puis reprendre l’espace.',
    window: 'Pendant le cooldown du E.',
    winCondition: 'Créer une fenêtre de poke sûre.',
  },
  earlyLevels: {
    level1: 'Prendre la priorité sans s’exposer.',
    level2: 'Respecter les contrôles adverses.',
    level3: 'Jouer autour des cooldowns.',
  },
  wavePlan: 'Maintenir la vague à portée du poke de Ziggs.',
  targetPriority: {
    primaryTarget: 'Swain',
    explanation: 'Le punir après son E.',
  },
  postLevel6: 'Éviter les combats prolongés dans l’ultime de Swain.',
  roamPlan: 'Galio peut roam après avoir poussé.',
  cheatSheet: ['Swain E miss → avance'],
  goldenRule: 'Ne force pas dans les contrôles adverses.',
});

class FakeGeminiClient implements GeminiClient {
  requests: GeminiRequest[] = [];

  constructor(
    private readonly result: { outputText?: string | null } = {
      outputText: JSON.stringify(validAnalysis()),
    },
  ) {}

  async generate(request: GeminiRequest) {
    this.requests.push(request);
    return this.result;
  }
}

const providerRequest = {
  input,
  instructions: 'Instructions LaneLens exactes.',
};

test('Gemini configuration trims values and applies documented defaults', () => {
  const config = loadGeminiConfig({ GEMINI_API_KEY: '  test-secret  ' });

  assert.deepEqual(config, {
    apiKey: 'test-secret',
    model: DEFAULT_GEMINI_MODEL,
    timeoutMs: DEFAULT_GEMINI_TIMEOUT_MS,
  });
  assert.ok(Object.isFrozen(config));

  assert.deepEqual(loadGeminiConfig({
    GEMINI_API_KEY: ' key ',
    GEMINI_MODEL: ' test-model ',
    GEMINI_TIMEOUT_MS: ' 60000 ',
  }), {
    apiKey: 'key',
    model: 'test-model',
    timeoutMs: 60_000,
  });
});

test('blank Gemini model and timeout use defaults', () => {
  const config = loadGeminiConfig({
    GEMINI_API_KEY: 'key',
    GEMINI_MODEL: '   ',
    GEMINI_TIMEOUT_MS: '   ',
  });

  assert.equal(config.model, 'gemini-3.8-flash');
  assert.equal(config.timeoutMs, 30_000);
});

test('missing Gemini keys and invalid timeouts fail with a fixed safe error', () => {
  const invalidEnvironments = [
    {},
    { GEMINI_API_KEY: '   ' },
    { GEMINI_API_KEY: 'sensitive-key', GEMINI_TIMEOUT_MS: '0' },
    { GEMINI_API_KEY: 'sensitive-key', GEMINI_TIMEOUT_MS: '-1' },
    { GEMINI_API_KEY: 'sensitive-key', GEMINI_TIMEOUT_MS: '1.5' },
    { GEMINI_API_KEY: 'sensitive-key', GEMINI_TIMEOUT_MS: 'abc' },
    { GEMINI_API_KEY: 'sensitive-key', GEMINI_TIMEOUT_MS: '30s' },
    { GEMINI_API_KEY: 'sensitive-key', GEMINI_TIMEOUT_MS: '9007199254740992' },
  ];

  for (const environment of invalidEnvironments) {
    assert.throws(() => loadGeminiConfig(environment), (error: unknown) => {
      assert.ok(error instanceof GeminiConfigurationError);
      assert.equal(error.message, 'La configuration Gemini est invalide.');
      assert.doesNotMatch(error.message, /sensitive|9007199254740992|30s/i);
      return true;
    });
  }
});

test('Gemini provider sends the model, instructions, prepared input, strict schema, timeout, and no tools', async () => {
  const client = new FakeGeminiClient();
  const provider = new GeminiProvider(client, 'test-model', 12_345);

  assert.deepEqual(await provider.analyze(providerRequest), validAnalysis());
  assert.equal(client.requests.length, 1);

  const sent = client.requests[0]!;
  assert.equal(sent.model, 'test-model');
  assert.equal(sent.instructions, providerRequest.instructions);
  assert.deepEqual(JSON.parse(sent.input), input);
  assert.equal(sent.responseFormat.type, 'text');
  assert.equal(sent.responseFormat.mimeType, 'application/json');
  assert.equal(sent.responseFormat.schema, MATCHUP_ANALYSIS_JSON_SCHEMA);
  assert.deepEqual(sent.tools, []);
  assert.equal(sent.store, false);
  assert.equal(sent.timeoutMs, 12_345);
  assert.equal('grounding' in sent, false);
  assert.equal('previousInteractionId' in sent, false);
});

test('Google SDK adapter disables retries and maps the stateless structured request', async () => {
  let sdkOptions: GeminiSDKOptions | undefined;
  let sdkRequest: GeminiSDKRequest | undefined;
  let requestOptions: GeminiSDKRequestOptions | undefined;
  const client = createGoogleGenAIClient({
    apiKey: 'factory-secret',
    timeoutMs: 12_345,
    retryAttempts: 1,
  }, (options) => {
    sdkOptions = options;
    return {
      interactions: {
        async create(request, perRequestOptions) {
          sdkRequest = request;
          requestOptions = perRequestOptions;
          return { output_text: JSON.stringify(validAnalysis()) };
        },
      },
    };
  });

  const result = await client.generate({
    model: 'test-model',
    instructions: providerRequest.instructions,
    input: JSON.stringify(input),
    responseFormat: {
      type: 'text',
      mimeType: 'application/json',
      schema: MATCHUP_ANALYSIS_JSON_SCHEMA,
    },
    tools: [],
    store: false,
    timeoutMs: 12_345,
  });

  assert.equal(result.outputText, JSON.stringify(validAnalysis()));
  assert.deepEqual(sdkOptions, {
    apiKey: 'factory-secret',
    httpOptions: {
      timeout: 12_345,
      retryOptions: { attempts: 1 },
    },
  });
  assert.deepEqual(sdkRequest, {
    model: 'test-model',
    system_instruction: providerRequest.instructions,
    input: JSON.stringify(input),
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: MATCHUP_ANALYSIS_JSON_SCHEMA,
    },
    tools: [],
    store: false,
  });
  assert.deepEqual(requestOptions, { timeout: 12_345, maxRetries: 0 });
});

test('Gemini production factory validates config and applies disabled retries', async () => {
  let capturedOptions: GeminiClientOptions | undefined;
  const fakeClient = new FakeGeminiClient();
  const provider = createGeminiProvider(
    { apiKey: 'factory-secret', model: 'factory-model', timeoutMs: 12_345 },
    (options) => {
      capturedOptions = options;
      return fakeClient;
    },
  );

  await provider.analyze(providerRequest);

  assert.deepEqual(capturedOptions, {
    apiKey: 'factory-secret',
    timeoutMs: 12_345,
    retryAttempts: 1,
  });
  assert.equal(fakeClient.requests[0]?.model, 'factory-model');

  assert.throws(
    () => createGeminiProvider({ apiKey: '   ', model: 'gemini-3.8-flash', timeoutMs: 30_000 }),
    GeminiConfigurationError,
  );
  assert.throws(
    () => createGeminiProvider({ apiKey: 'key', model: 'gemini-3.8-flash', timeoutMs: 0 }),
    GeminiConfigurationError,
  );
});

test('valid Gemini output remains untrusted and is never rewritten', async () => {
  const raw = validAnalysis();
  raw.matchup.enemyCarry = 'Caitlyn';
  const provider = new GeminiProvider(
    new FakeGeminiClient({ outputText: JSON.stringify(raw) }),
    'gemini-3.8-flash',
    30_000,
  );

  assert.deepEqual(await provider.analyze(providerRequest), raw);
  await assert.rejects(
    new MatchupAnalysisService(provider).analyze(input),
    (error: unknown) => error instanceof MatchupAnalysisError
      && error.code === 'INVALID_ANALYSIS_RESPONSE',
  );
});

test('blocked, absent, empty, and malformed Gemini output return controlled invalid data', async () => {
  for (const outputText of [undefined, null, '', '{not-json']) {
    const provider = new GeminiProvider(
      new FakeGeminiClient({ outputText }),
      'gemini-3.8-flash',
      30_000,
    );
    assert.equal(await provider.analyze(providerRequest), null);

    await assert.rejects(
      new MatchupAnalysisService(provider).analyze(input),
      (error: unknown) => error instanceof MatchupAnalysisError
        && error.code === 'INVALID_ANALYSIS_RESPONSE',
    );
  }
});

test('Gemini client failures become safe provider and LaneLens errors', async () => {
  const sdkError = Object.assign(
    new Error('429 quota exceeded api_key=secret-key provider-path=C:\\private'),
    { status: 429 },
  );
  const client: GeminiClient = {
    async generate() {
      throw sdkError;
    },
  };
  const provider = new GeminiProvider(client, 'gemini-3.8-flash', 30_000);

  await assert.rejects(provider.analyze(providerRequest), (error: unknown) => {
    assert.ok(error instanceof GeminiProviderError);
    assert.equal(error.message, 'Le provider Gemini est indisponible.');
    assert.equal(error.provider, 'gemini');
    assert.equal(error.model, 'gemini-3.8-flash');
    assert.equal(error.category, 'rate_limit');
    assert.equal(error.status, 429);
    assert.equal(error.cause, undefined);
    assert.equal(error.errorName, 'Error');
    assert.match(error.errorMessage ?? '', /\[REDACTED\]/);
    assert.doesNotMatch(error.errorMessage ?? '', /secret-key|private/i);
    assert.doesNotMatch(error.message, /secret|x-goog|private/i);
    return true;
  });

  await assert.rejects(new MatchupAnalysisService(provider).analyze(input), (error: unknown) => {
    assert.ok(error instanceof MatchupAnalysisError);
    assert.equal(error.code, 'ANALYSIS_PROVIDER_UNAVAILABLE');
    assert.ok(error.cause instanceof GeminiProviderError);
    assert.doesNotMatch(error.message, /secret|x-goog|private/i);
    return true;
  });
});
