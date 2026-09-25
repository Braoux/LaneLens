import assert from 'node:assert/strict';
import test from 'node:test';
import { MatchupAnalysisError } from '../server/analysis/errors.js';
import { MatchupAnalysisService } from '../server/analysis/MatchupAnalysisService.js';
import type { MatchupAnalysis, MatchupAnalysisInput } from '../server/analysis/types.js';
import {
  createGroqProvider,
  createGroqSDKClient,
  GroqProvider,
  GroqProviderError,
} from '../server/analysis/providers/GroqProvider.js';
import type {
  GroqClient,
  GroqClientOptions,
  GroqRequest,
  GroqSDKRequestOptions,
} from '../server/analysis/providers/GroqProvider.js';
import {
  DEFAULT_GROQ_MODEL,
  DEFAULT_GROQ_TIMEOUT_MS,
  GroqConfigurationError,
  loadGroqConfig,
} from '../server/analysis/providers/groq-config.js';
import { MATCHUP_ANALYSIS_JSON_SCHEMA } from '../server/analysis/providers/matchup-analysis-schema.js';

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

class FakeGroqClient implements GroqClient {
  requests: GroqRequest[] = [];

  constructor(
    private readonly result: { outputText?: string | null } = {
      outputText: JSON.stringify(validAnalysis()),
    },
  ) {}

  async generate(request: GroqRequest) {
    this.requests.push(request);
    return this.result;
  }
}

const providerRequest = {
  input,
  instructions: 'Instructions LaneLens exactes.',
};

test('Groq configuration trims values and applies documented defaults', () => {
  const config = loadGroqConfig({ GROQ_API_KEY: '  test-secret  ' });

  assert.deepEqual(config, {
    apiKey: 'test-secret',
    model: DEFAULT_GROQ_MODEL,
    timeoutMs: DEFAULT_GROQ_TIMEOUT_MS,
  });
  assert.ok(Object.isFrozen(config));

  assert.deepEqual(loadGroqConfig({
    GROQ_API_KEY: ' key ',
    GROQ_MODEL: ' custom-model ',
    GROQ_TIMEOUT_MS: ' 60000 ',
  }), {
    apiKey: 'key',
    model: 'custom-model',
    timeoutMs: 60_000,
  });
});

test('blank Groq model and timeout use defaults', () => {
  const config = loadGroqConfig({
    GROQ_API_KEY: 'key',
    GROQ_MODEL: '   ',
    GROQ_TIMEOUT_MS: '   ',
  });

  assert.equal(config.model, 'openai/gpt-oss-120b');
  assert.equal(config.timeoutMs, 30_000);
});

test('missing Groq keys and invalid timeouts fail with a fixed safe error', () => {
  const invalidEnvironments = [
    {},
    { GROQ_API_KEY: '   ' },
    { GROQ_API_KEY: 'sensitive-key', GROQ_TIMEOUT_MS: '0' },
    { GROQ_API_KEY: 'sensitive-key', GROQ_TIMEOUT_MS: '-1' },
    { GROQ_API_KEY: 'sensitive-key', GROQ_TIMEOUT_MS: '1.5' },
    { GROQ_API_KEY: 'sensitive-key', GROQ_TIMEOUT_MS: 'abc' },
    { GROQ_API_KEY: 'sensitive-key', GROQ_TIMEOUT_MS: '30s' },
    { GROQ_API_KEY: 'sensitive-key', GROQ_TIMEOUT_MS: '9007199254740992' },
  ];

  for (const environment of invalidEnvironments) {
    assert.throws(() => loadGroqConfig(environment), (error: unknown) => {
      assert.ok(error instanceof GroqConfigurationError);
      assert.equal(error.message, 'La configuration Groq est invalide.');
      assert.doesNotMatch(error.message, /sensitive|9007199254740992|30s/i);
      return true;
    });
  }
});

test('Groq provider sends model, instructions, full input, strict schema, timeout, and no tools', async () => {
  const client = new FakeGroqClient();
  const provider = new GroqProvider(client, 'test-model', 12_345);

  assert.deepEqual(await provider.analyze(providerRequest), validAnalysis());
  const sent = client.requests[0]!;
  assert.equal(sent.model, 'test-model');
  assert.equal(sent.instructions, providerRequest.instructions);
  assert.deepEqual(JSON.parse(sent.input), input);
  assert.equal(sent.reasoningEffort, 'medium');
  assert.equal(sent.responseFormat.type, 'json_schema');
  assert.equal(sent.responseFormat.jsonSchema.name, 'matchup_analysis');
  assert.equal(sent.responseFormat.jsonSchema.strict, true);
  assert.equal(sent.responseFormat.jsonSchema.schema, MATCHUP_ANALYSIS_JSON_SCHEMA);
  assert.deepEqual(sent.tools, []);
  assert.equal(sent.timeoutMs, 12_345);
  assert.equal('searchSettings' in sent, false);
  assert.equal('toolChoice' in sent, false);
});

test('Groq SDK adapter maps Chat Completions and disables retries', async () => {
  let sdkOptions: GroqClientOptions | undefined;
  let sdkRequest: unknown;
  let requestOptions: GroqSDKRequestOptions | undefined;
  const client = createGroqSDKClient({
    apiKey: 'factory-secret',
    timeout: 12_345,
    maxRetries: 0,
    logLevel: 'off',
  }, (options) => {
    sdkOptions = options;
    return {
      chat: {
        completions: {
          async create(request, perRequestOptions) {
            sdkRequest = request;
            requestOptions = perRequestOptions;
            return {
              choices: [{ message: { content: JSON.stringify(validAnalysis()) } }],
            };
          },
        },
      },
    };
  });

  const result = await client.generate({
    model: 'test-model',
    instructions: providerRequest.instructions,
    input: JSON.stringify(input),
    reasoningEffort: 'medium',
    responseFormat: {
      type: 'json_schema',
      jsonSchema: {
        name: 'matchup_analysis',
        strict: true,
        schema: MATCHUP_ANALYSIS_JSON_SCHEMA,
      },
    },
    tools: [],
    timeoutMs: 12_345,
  });

  assert.equal(result.outputText, JSON.stringify(validAnalysis()));
  assert.deepEqual(sdkOptions, {
    apiKey: 'factory-secret',
    timeout: 12_345,
    maxRetries: 0,
    logLevel: 'off',
  });
  assert.deepEqual(sdkRequest, {
    model: 'test-model',
    messages: [
      { role: 'system', content: providerRequest.instructions },
      { role: 'user', content: JSON.stringify(input) },
    ],
    reasoning_effort: 'medium',
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'matchup_analysis',
        strict: true,
        schema: MATCHUP_ANALYSIS_JSON_SCHEMA,
      },
    },
    stream: false,
  });
  assert.equal(
    typeof sdkRequest === 'object' && sdkRequest !== null && 'tools' in sdkRequest,
    false,
  );
  assert.deepEqual(requestOptions, { timeout: 12_345, maxRetries: 0 });
});

test('Groq production factory validates config and disables retries', async () => {
  let capturedOptions: GroqClientOptions | undefined;
  const fakeClient = new FakeGroqClient();
  const provider = createGroqProvider(
    { apiKey: 'factory-secret', model: 'factory-model', timeoutMs: 12_345 },
    (options) => {
      capturedOptions = options;
      return fakeClient;
    },
  );

  await provider.analyze(providerRequest);

  assert.deepEqual(capturedOptions, {
    apiKey: 'factory-secret',
    timeout: 12_345,
    maxRetries: 0,
    logLevel: 'off',
  });
  assert.equal(fakeClient.requests[0]?.model, 'factory-model');
  assert.throws(
    () => createGroqProvider({ apiKey: '   ', model: DEFAULT_GROQ_MODEL, timeoutMs: 30_000 }),
    GroqConfigurationError,
  );
  assert.throws(
    () => createGroqProvider({ apiKey: 'key', model: DEFAULT_GROQ_MODEL, timeoutMs: 0 }),
    GroqConfigurationError,
  );
});

test('Groq output stays untrusted and is never rewritten', async () => {
  const raw = validAnalysis();
  raw.matchup.enemyCarry = 'Caitlyn';
  const provider = new GroqProvider(
    new FakeGroqClient({ outputText: JSON.stringify(raw) }),
    DEFAULT_GROQ_MODEL,
    30_000,
  );

  assert.deepEqual(await provider.analyze(providerRequest), raw);
  await assert.rejects(
    new MatchupAnalysisService(provider).analyze(input),
    (error: unknown) => error instanceof MatchupAnalysisError
      && error.code === 'INVALID_ANALYSIS_RESPONSE',
  );
});

test('absent, empty, and malformed Groq output return controlled invalid data', async () => {
  for (const outputText of [undefined, null, '', '{not-json']) {
    const provider = new GroqProvider(
      new FakeGroqClient({ outputText }),
      DEFAULT_GROQ_MODEL,
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

test('Groq failures preserve safe diagnostics and never expose credentials publicly', async () => {
  const sdkError = Object.assign(
    new Error('429 quota exceeded api_key=gsk_sensitive-secret provider-path=C:\\private'),
    { status: 429 },
  );
  const provider = new GroqProvider({
    async generate() { throw sdkError; },
  }, DEFAULT_GROQ_MODEL, 30_000);

  await assert.rejects(provider.analyze(providerRequest), (error: unknown) => {
    assert.ok(error instanceof GroqProviderError);
    assert.equal(error.message, 'Le provider Groq est indisponible.');
    assert.equal(error.provider, 'groq');
    assert.equal(error.model, DEFAULT_GROQ_MODEL);
    assert.equal(error.category, 'rate_limit');
    assert.equal(error.status, 429);
    assert.equal(error.cause, undefined);
    assert.match(error.errorMessage ?? '', /\[REDACTED\]/);
    assert.doesNotMatch(error.errorMessage ?? '', /gsk_sensitive|private/i);
    return true;
  });

  await assert.rejects(new MatchupAnalysisService(provider).analyze(input), (error: unknown) => {
    assert.ok(error instanceof MatchupAnalysisError);
    assert.equal(error.code, 'ANALYSIS_PROVIDER_UNAVAILABLE');
    assert.ok(error.cause instanceof GroqProviderError);
    assert.doesNotMatch(error.message, /gsk_sensitive|quota/i);
    return true;
  });
});
