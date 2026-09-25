import assert from 'node:assert/strict';
import test from 'node:test';
import { MatchupAnalysisError } from '../server/analysis/errors.js';
import { MatchupAnalysisService } from '../server/analysis/MatchupAnalysisService.js';
import type { MatchupAnalysis, MatchupAnalysisInput } from '../server/analysis/types.js';
import {
  createOpenAIProvider,
  MATCHUP_ANALYSIS_JSON_SCHEMA,
  OpenAIProvider,
  OpenAIProviderError,
} from '../server/analysis/providers/OpenAIProvider.js';
import type {
  OpenAIClientOptions,
  OpenAIResponseRequest,
  OpenAIResponsesClient,
} from '../server/analysis/providers/OpenAIProvider.js';
import {
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_TIMEOUT_MS,
  loadOpenAIConfig,
  OpenAIConfigurationError,
} from '../server/analysis/providers/openai-config.js';

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

class FakeResponsesClient implements OpenAIResponsesClient {
  requests: OpenAIResponseRequest[] = [];

  constructor(
    private readonly result: { outputText?: string | null } = {
      outputText: JSON.stringify(validAnalysis()),
    },
  ) {}

  async create(request: OpenAIResponseRequest) {
    this.requests.push(request);
    return this.result;
  }
}

const providerRequest = {
  input,
  instructions: 'Instructions LaneLens exactes.',
};

test('configuration trims values and applies the documented defaults', () => {
  const config = loadOpenAIConfig({ OPENAI_API_KEY: '  test-secret  ' });

  assert.deepEqual(config, {
    apiKey: 'test-secret',
    model: DEFAULT_OPENAI_MODEL,
    timeoutMs: DEFAULT_OPENAI_TIMEOUT_MS,
  });
  assert.ok(Object.isFrozen(config));

  assert.deepEqual(loadOpenAIConfig({
    OPENAI_API_KEY: ' key ',
    OPENAI_MODEL: '  test-model ',
    OPENAI_TIMEOUT_MS: ' 60000 ',
  }), {
    apiKey: 'key',
    model: 'test-model',
    timeoutMs: 60_000,
  });
});

test('blank models and timeouts use defaults', () => {
  const config = loadOpenAIConfig({
    OPENAI_API_KEY: 'key',
    OPENAI_MODEL: '   ',
    OPENAI_TIMEOUT_MS: '   ',
  });

  assert.equal(config.model, 'gpt-6-sol');
  assert.equal(config.timeoutMs, 30_000);
});

test('missing keys and invalid timeouts fail with a fixed safe configuration error', () => {
  const invalidEnvironments = [
    {},
    { OPENAI_API_KEY: '   ' },
    { OPENAI_API_KEY: 'sensitive-key', OPENAI_TIMEOUT_MS: '0' },
    { OPENAI_API_KEY: 'sensitive-key', OPENAI_TIMEOUT_MS: '-1' },
    { OPENAI_API_KEY: 'sensitive-key', OPENAI_TIMEOUT_MS: '1.5' },
    { OPENAI_API_KEY: 'sensitive-key', OPENAI_TIMEOUT_MS: 'abc' },
    { OPENAI_API_KEY: 'sensitive-key', OPENAI_TIMEOUT_MS: '30s' },
    { OPENAI_API_KEY: 'sensitive-key', OPENAI_TIMEOUT_MS: '9007199254740992' },
  ];

  for (const environment of invalidEnvironments) {
    assert.throws(() => loadOpenAIConfig(environment), (error: unknown) => {
      assert.ok(error instanceof OpenAIConfigurationError);
      assert.equal(error.message, 'La configuration OpenAI est invalide.');
      assert.doesNotMatch(error.message, /sensitive|9007199254740992|30s/i);
      return true;
    });
  }
});

test('provider sends the configured model, instructions, full input, strict schema, and no tools or state', async () => {
  const client = new FakeResponsesClient();
  const provider = new OpenAIProvider(client, 'test-model');

  assert.deepEqual(await provider.analyze(providerRequest), validAnalysis());
  assert.equal(client.requests.length, 1);

  const sent = client.requests[0]!;
  assert.equal(sent.model, 'test-model');
  assert.equal(sent.instructions, providerRequest.instructions);
  assert.deepEqual(JSON.parse(sent.input), input);
  assert.deepEqual(sent.reasoning, { effort: 'medium' });
  assert.deepEqual(sent.tools, []);
  assert.equal(sent.store, false);
  assert.equal(sent.text.format.type, 'json_schema');
  assert.equal(sent.text.format.name, 'matchup_analysis');
  assert.equal(sent.text.format.strict, true);
  assert.equal(sent.text.format.schema, MATCHUP_ANALYSIS_JSON_SCHEMA);
  assert.equal('previous_response_id' in sent, false);
  assert.equal('conversation' in sent, false);
});

test('every object in the Structured Outputs schema is strict and requires all properties', () => {
  function assertStrictObjects(schema: unknown): void {
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return;
    const record = schema as Record<string, unknown>;

    if (record.type === 'object') {
      assert.equal(record.additionalProperties, false);
      const properties = record.properties as Record<string, unknown>;
      assert.deepEqual(
        [...(record.required as string[])].sort(),
        Object.keys(properties).sort(),
      );
      for (const child of Object.values(properties)) assertStrictObjects(child);
    }

    if (record.type === 'array') assertStrictObjects(record.items);
  }

  assertStrictObjects(MATCHUP_ANALYSIS_JSON_SCHEMA);
  const root = MATCHUP_ANALYSIS_JSON_SCHEMA as Record<string, unknown>;
  const properties = root.properties as Record<string, unknown>;
  assert.deepEqual(Object.keys(properties), [
    'matchup',
    'lanePlan',
    'threatResponseWindow',
    'earlyLevels',
    'wavePlan',
    'targetPriority',
    'postLevel6',
    'roamPlan',
    'cheatSheet',
    'goldenRule',
  ]);
  assert.equal('sources' in properties, false);
});

test('production factory applies the key, timeout, disabled retries, and disabled SDK logging', async () => {
  let capturedOptions: OpenAIClientOptions | undefined;
  const fakeClient = new FakeResponsesClient();
  const provider = createOpenAIProvider(
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
});

test('production factory cannot bypass configuration validation', () => {
  assert.throws(
    () => createOpenAIProvider({ apiKey: '   ', model: 'gpt-6-sol', timeoutMs: 30_000 }),
    OpenAIConfigurationError,
  );
  assert.throws(
    () => createOpenAIProvider({ apiKey: 'key', model: 'gpt-6-sol', timeoutMs: 0 }),
    OpenAIConfigurationError,
  );
});

test('valid structured output is returned without rewriting matchup fields', async () => {
  const raw = validAnalysis();
  raw.matchup.enemyCarry = 'Caitlyn';
  const provider = new OpenAIProvider(
    new FakeResponsesClient({ outputText: JSON.stringify(raw) }),
    'gpt-6-sol',
  );

  const result = await provider.analyze(providerRequest);
  assert.deepEqual(result, raw);

  await assert.rejects(
    new MatchupAnalysisService(provider).analyze(input),
    (error: unknown) => error instanceof MatchupAnalysisError
      && error.code === 'INVALID_ANALYSIS_RESPONSE',
  );
});

test('refusal, absent output, empty output, and malformed JSON return controlled invalid data', async () => {
  for (const outputText of [undefined, null, '', '{not-json']) {
    const provider = new OpenAIProvider(new FakeResponsesClient({ outputText }), 'gpt-6-sol');
    assert.equal(await provider.analyze(providerRequest), null);

    await assert.rejects(
      new MatchupAnalysisService(provider).analyze(input),
      (error: unknown) => error instanceof MatchupAnalysisError
        && error.code === 'INVALID_ANALYSIS_RESPONSE',
    );
  }
});

test('client failures become safe provider errors and safe LaneLens errors', async () => {
  const sdkError = Object.assign(
    new Error('401 Authorization: Bearer secret-key provider-path=C:\\private'),
    { status: 401 },
  );
  const client: OpenAIResponsesClient = {
    async create() {
      throw sdkError;
    },
  };
  const provider = new OpenAIProvider(client, 'gpt-6-sol');

  await assert.rejects(provider.analyze(providerRequest), (error: unknown) => {
    assert.ok(error instanceof OpenAIProviderError);
    assert.equal(error.message, 'Le provider OpenAI est indisponible.');
    assert.equal(error.provider, 'openai');
    assert.equal(error.model, 'gpt-6-sol');
    assert.equal(error.category, 'authentication');
    assert.equal(error.status, 401);
    assert.equal(error.cause, undefined);
    assert.equal(error.errorName, 'Error');
    assert.match(error.errorMessage ?? '', /\[REDACTED\]/);
    assert.doesNotMatch(error.errorMessage ?? '', /secret-key|private/i);
    assert.doesNotMatch(error.message, /secret|authorization|private/i);
    return true;
  });

  await assert.rejects(new MatchupAnalysisService(provider).analyze(input), (error: unknown) => {
    assert.ok(error instanceof MatchupAnalysisError);
    assert.equal(error.code, 'ANALYSIS_PROVIDER_UNAVAILABLE');
    assert.ok(error.cause instanceof OpenAIProviderError);
    assert.doesNotMatch(error.message, /secret|authorization|private/i);
    return true;
  });
});
