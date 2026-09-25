import assert from 'node:assert/strict';
import test from 'node:test';
import type { MatchupAnalysisProvider } from '../server/analysis/MatchupAnalysisProvider.js';
import type { MatchupAnalysisProviderRequest } from '../server/analysis/types.js';
import { AIProviderConfigurationError } from '../server/analysis/providers/ai-provider-config.js';
import { GroqProviderError } from '../server/analysis/providers/GroqProvider.js';
import type { LogFields, Logger } from '../server/logging/Logger.js';
import { createRuntimeApp } from '../server/runtime.js';

const requestBody = {
  allyCarry: 'Ziggs',
  allySupport: 'Galio',
  enemyCarry: 'Jinx',
  enemySupport: 'Swain',
  patch: '26.19',
};

function postMatchup(app: ReturnType<typeof createRuntimeApp>) {
  return app.request('/api/matchup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
}

test('runtime starts without an OpenAI key and leaves analysis unconfigured', async () => {
  const app = createRuntimeApp({ environment: {} });

  const health = await app.request('/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const context = await app.request('/api/analysis-context');
  assert.equal(context.status, 200);
  assert.deepEqual(await context.json(), { patch: '26.19', contextVersion: '26.19-v1' });

  const matchup = await postMatchup(app);
  assert.equal(matchup.status, 503);
  assert.equal((await matchup.json() as { error: { code: string } }).error.code, 'ANALYSIS_NOT_CONFIGURED');
});

test('blank OpenAI keys behave like absent keys', async () => {
  const app = createRuntimeApp({ environment: { OPENAI_API_KEY: '   ' } });
  assert.equal((await postMatchup(app)).status, 503);
});

test('configured runtime preserves historical OpenAI selection when AI_PROVIDER is absent', async () => {
  const requests: MatchupAnalysisProviderRequest[] = [];
  const provider: MatchupAnalysisProvider = {
    async analyze(request) {
      requests.push(request);
      return {
        matchup: { ...requestBody },
        lanePlan: 'Contrôler la vague.',
        threatResponseWindow: {
          threat: 'Engage adverse.',
          response: 'Garder la distance.',
          window: 'Après le cooldown principal.',
          winCondition: 'Poke avant le combat.',
        },
        earlyLevels: {
          level1: 'Prendre la priorité.',
          level2: 'Respecter l’engage.',
          level3: 'Jouer les cooldowns.',
        },
        wavePlan: 'Maintenir une vague sûre.',
        targetPriority: {
          primaryTarget: 'Swain',
          explanation: 'Le punir après son contrôle.',
        },
        postLevel6: 'Éviter les combats prolongés.',
        roamPlan: 'Roam après avoir poussé.',
        cheatSheet: ['Contrôle raté → avancer'],
        goldenRule: 'Jouer après les cooldowns adverses.',
      };
    },
  };
  let configuredModel = '';
  const app = createRuntimeApp({
    environment: {
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'test-model',
      OPENAI_TIMEOUT_MS: '1234',
    },
    openAIProviderFactory(config) {
      configuredModel = config.model;
      assert.equal(config.timeoutMs, 1234);
      return provider;
    },
  });

  const response = await postMatchup(app);
  assert.equal(response.status, 200);
  assert.equal(configuredModel, 'test-model');
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input.patchContext.contextVersion, '26.19-v1');
  assert.ok((requests[0]?.input.patchContext.facts.length ?? 0) >= 1);
});

test('AI_PROVIDER=openai explicitly selects OpenAI without falling back to Gemini', async () => {
  let openAICalls = 0;
  let geminiCalls = 0;
  const provider: MatchupAnalysisProvider = {
    async analyze() {
      throw new Error('not used by this composition test');
    },
  };

  createRuntimeApp({
    environment: {
      AI_PROVIDER: '  OPENAI ',
      OPENAI_API_KEY: 'openai-key',
      GEMINI_API_KEY: 'gemini-key',
    },
    openAIProviderFactory() {
      openAICalls += 1;
      return provider;
    },
    geminiProviderFactory() {
      geminiCalls += 1;
      return provider;
    },
  });

  assert.equal(openAICalls, 1);
  assert.equal(geminiCalls, 0);
});

test('AI_PROVIDER=gemini selects Gemini without falling back to OpenAI', async () => {
  let openAICalls = 0;
  let configuredModel = '';
  const provider: MatchupAnalysisProvider = {
    async analyze(request) {
      return {
        matchup: { ...requestBody },
        lanePlan: 'Contrôler la vague.',
        threatResponseWindow: {
          threat: 'Engage adverse.',
          response: 'Garder la distance.',
          window: 'Après le cooldown principal.',
          winCondition: 'Poke avant le combat.',
        },
        earlyLevels: {
          level1: 'Prendre la priorité.',
          level2: 'Respecter l’engage.',
          level3: 'Jouer les cooldowns.',
        },
        wavePlan: 'Maintenir une vague sûre.',
        targetPriority: {
          primaryTarget: 'Swain',
          explanation: 'Le punir après son contrôle.',
        },
        postLevel6: 'Éviter les combats prolongés.',
        roamPlan: 'Roam après avoir poussé.',
        cheatSheet: ['Contrôle raté → avancer'],
        goldenRule: 'Jouer après les cooldowns adverses.',
      };
    },
  };
  const app = createRuntimeApp({
    environment: {
      AI_PROVIDER: ' Gemini ',
      OPENAI_API_KEY: 'unused-openai-key',
      GEMINI_API_KEY: 'gemini-key',
      GEMINI_MODEL: ' test-gemini ',
      GEMINI_TIMEOUT_MS: '4321',
    },
    openAIProviderFactory() {
      openAICalls += 1;
      return provider;
    },
    geminiProviderFactory(config) {
      configuredModel = config.model;
      assert.equal(config.timeoutMs, 4321);
      return provider;
    },
  });

  assert.equal((await postMatchup(app)).status, 200);
  assert.equal(configuredModel, 'test-gemini');
  assert.equal(openAICalls, 0);
});

test('AI_PROVIDER=groq selects Groq without falling back to OpenAI or Gemini', async () => {
  let openAICalls = 0;
  let geminiCalls = 0;
  let configuredModel = '';
  const provider: MatchupAnalysisProvider = {
    async analyze() {
      return {
        matchup: { ...requestBody },
        lanePlan: 'Contrôler la vague.',
        threatResponseWindow: {
          threat: 'Engage adverse.',
          response: 'Garder la distance.',
          window: 'Après le cooldown principal.',
          winCondition: 'Poke avant le combat.',
        },
        earlyLevels: {
          level1: 'Prendre la priorité.',
          level2: 'Respecter l’engage.',
          level3: 'Jouer les cooldowns.',
        },
        wavePlan: 'Maintenir une vague sûre.',
        targetPriority: {
          primaryTarget: 'Swain',
          explanation: 'Le punir après son contrôle.',
        },
        postLevel6: 'Éviter les combats prolongés.',
        roamPlan: 'Roam après avoir poussé.',
        cheatSheet: ['Contrôle raté → avancer'],
        goldenRule: 'Jouer après les cooldowns adverses.',
      };
    },
  };
  const app = createRuntimeApp({
    environment: {
      AI_PROVIDER: '  GROQ ',
      OPENAI_API_KEY: 'unused-openai-key',
      GEMINI_API_KEY: 'unused-gemini-key',
      GROQ_API_KEY: 'groq-key',
      GROQ_MODEL: ' custom-groq-model ',
      GROQ_TIMEOUT_MS: '4321',
    },
    openAIProviderFactory() {
      openAICalls += 1;
      return provider;
    },
    geminiProviderFactory() {
      geminiCalls += 1;
      return provider;
    },
    groqProviderFactory(config) {
      configuredModel = config.model;
      assert.equal(config.timeoutMs, 4321);
      return provider;
    },
  });

  assert.equal((await postMatchup(app)).status, 200);
  assert.equal(configuredModel, 'custom-groq-model');
  assert.equal(openAICalls, 0);
  assert.equal(geminiCalls, 0);
});

test('configured runtime logs only the selected provider name and model', () => {
  const entries: Array<{ event: string; fields: LogFields }> = [];
  const logger: Logger = {
    debug() {},
    info(event, fields = {}) { entries.push({ event, fields }); },
    warn() {},
    error() {},
  };
  const provider: MatchupAnalysisProvider = {
    async analyze() { throw new Error('not called'); },
  };

  createRuntimeApp({
    environment: {
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'must-not-appear',
      GEMINI_MODEL: 'gemini-test-model',
    },
    logger,
    geminiProviderFactory() { return provider; },
  });

  assert.deepEqual(entries, [{
    event: 'analysis_provider_configured',
    fields: { provider: 'gemini', model: 'gemini-test-model' },
  }]);
  assert.doesNotMatch(JSON.stringify(entries), /must-not-appear/);
});

test('selected provider without its key stays unconfigured and never falls back', async () => {
  const app = createRuntimeApp({
    environment: {
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: '   ',
      OPENAI_API_KEY: 'available-but-not-selected',
    },
  });

  assert.equal((await app.request('/api/health')).status, 200);
  const response = await postMatchup(app);
  assert.equal(response.status, 503);
  assert.equal(
    (await response.json() as { error: { code: string } }).error.code,
    'ANALYSIS_NOT_CONFIGURED',
  );
});

test('Groq-selected runtime starts without a Groq key and never falls back', async () => {
  const app = createRuntimeApp({
    environment: {
      AI_PROVIDER: 'groq',
      GROQ_API_KEY: '   ',
      OPENAI_API_KEY: 'available-but-not-selected',
      GEMINI_API_KEY: 'available-but-not-selected',
    },
  });

  assert.equal((await app.request('/api/health')).status, 200);
  const response = await postMatchup(app);
  assert.equal(response.status, 503);
  assert.equal(
    (await response.json() as { error: { code: string } }).error.code,
    'ANALYSIS_NOT_CONFIGURED',
  );
});

test('Groq provider failures keep safe correlated diagnostics without leaking its key', async () => {
  const entries: Array<{ level: string; event: string; fields: LogFields }> = [];
  const logger: Logger = {
    debug(event, fields = {}) { entries.push({ level: 'debug', event, fields }); },
    info(event, fields = {}) { entries.push({ level: 'info', event, fields }); },
    warn(event, fields = {}) { entries.push({ level: 'warn', event, fields }); },
    error(event, fields = {}) { entries.push({ level: 'error', event, fields }); },
  };
  const providerError = Object.assign(
    new Error('401 api_key=gsk_sensitive-secret Authorization: Bearer hidden-token'),
    { status: 401 },
  );
  const app = createRuntimeApp({
    environment: {
      AI_PROVIDER: 'groq',
      GROQ_API_KEY: 'must-not-appear',
      GROQ_MODEL: 'openai/gpt-oss-120b',
    },
    logger,
    groqProviderFactory(config) {
      return {
        async analyze() {
          throw new GroqProviderError(config.model, providerError);
        },
      };
    },
  });

  const response = await postMatchup(app);
  const requestId = response.headers.get('x-request-id');
  assert.equal(response.status, 503);
  assert.equal(
    (await response.json() as { error: { code: string } }).error.code,
    'ANALYSIS_PROVIDER_UNAVAILABLE',
  );

  const correlated = entries.filter((entry) => [
    'http_request_completed',
    'matchup_analysis_started',
    'matchup_analysis_failed',
    'analysis_provider_failed',
  ].includes(entry.event));
  assert.equal(correlated.length, 4);
  assert.ok(correlated.every((entry) => entry.fields.requestId === requestId));
  const failure = entries.find((entry) => entry.event === 'analysis_provider_failed');
  assert.equal(failure?.fields.provider, 'groq');
  assert.equal(failure?.fields.model, 'openai/gpt-oss-120b');
  assert.equal(failure?.fields.category, 'authentication');
  assert.equal(failure?.fields.status, 401);
  assert.doesNotMatch(JSON.stringify(entries), /must-not-appear|gsk_sensitive|hidden-token/);
});

test('unknown AI_PROVIDER values fail with a controlled configuration error', () => {
  assert.throws(
    () => createRuntimeApp({ environment: { AI_PROVIDER: 'other' } }),
    AIProviderConfigurationError,
  );
});
