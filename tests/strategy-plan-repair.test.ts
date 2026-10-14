import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ProviderFailureError } from '../server/analysis/ProviderFailure.js';
import type {
  StructuredOutputProvider,
  StructuredOutputRequest,
} from '../server/analysis/StructuredOutputProvider.js';
import { UnparsedProviderOutput } from '../server/analysis/UnparsedProviderOutput.js';
import type { MatchupFactPack } from '../server/knowledge/MatchupFactPack.js';
import { MatchupFactPackBuilder } from '../server/knowledge/MatchupFactPackBuilder.js';
import {
  MATCHUP_STRATEGY_PLAN_VERSION,
  type MatchupStrategyPlan,
  type StrategyAssertion,
} from '../server/strategy/MatchupStrategyPlan.js';
import { TargetedStrategyPlanRepairService } from '../server/strategy/TargetedStrategyPlanRepairService.js';
import { loadEvaluationCorpus } from '../scripts/evaluation/corpus.js';

const corpusPath = fileURLToPath(new URL(
  '../evaluation/corpus/lan-061-golden-v1.json',
  import.meta.url,
));

async function factPack(): Promise<MatchupFactPack> {
  const corpus = (await loadEvaluationCorpus(corpusPath)).corpus;
  return new MatchupFactPackBuilder().build(
    corpus.matchups.find(({ id }) => id === 'L61-G06')!,
  );
}

function strategic(text: string): StrategyAssertion {
  return {
    text,
    grounding: 'strategic-only',
    participantIds: [],
    factIds: [],
    missingKnowledge: [],
  };
}

function leonaAssertion(text: string): StrategyAssertion {
  return {
    text,
    grounding: 'fact-grounded',
    participantIds: ['ally:support', 'enemy:carry'],
    factIds: ['ability:leona:e'],
    missingKnowledge: [],
  };
}

function plan(laneApproach = leonaAssertion(
  'Leona E (Zenith Blade) stuns all nearby enemies.',
)): MatchupStrategyPlan {
  return {
    schemaVersion: 1,
    planVersion: MATCHUP_STRATEGY_PLAN_VERSION,
    matchupId: 'L61-G06',
    patch: '26.19',
    laneApproach,
    threatResponseWindow: {
      threat: strategic('Respect the opposing engage range.'),
      response: strategic('Consider pressuring after Leona misses E.'),
      tradeWindow: strategic('Take a short trade after the opposing window is spent.'),
      winCondition: strategic('Preserve wave priority.'),
    },
    earlyLevels: {
      level1: strategic('Play behind the minion wave.'),
      level2: strategic('Respect level-two pressure.'),
      level3: strategic('Trade only with a safe exit.'),
    },
    wavePlan: strategic('Keep the wave controlled.'),
    targetPriority: strategic('Pressure the exposed target.'),
    postLevel6: strategic('Avoid an unnecessarily prolonged fight.'),
    roamPlan: strategic('Roam only after a clean crash.'),
  };
}

function response(assertion: StrategyAssertion, path = 'laneApproach') {
  return {
    schemaVersion: 1,
    replacements: [{ path, assertion }],
  };
}

const correct = leonaAssertion('Leona E (Zenith Blade) roots its target.');

function serviceWithResponses(
  responses: readonly (unknown | Error)[],
  requests: StructuredOutputRequest[] = [],
): { readonly service: TargetedStrategyPlanRepairService; readonly calls: () => number } {
  let index = 0;
  const provider: StructuredOutputProvider = {
    async generateStructured(request, options) {
      requests.push(request);
      options?.onMetadata?.({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
      const value = responses[index++];
      if (value instanceof Error) throw value;
      return value;
    },
  };
  return {
    service: new TargetedStrategyPlanRepairService(provider),
    calls: () => index,
  };
}

const options = {
  maxRepairs: 2 as const,
  provider: 'fixture-provider',
  model: 'fixture-model',
};

test('strategy repair changes one targeted assertion and preserves every other field', async () => {
  const pack = await factPack();
  const original = plan();
  const originalPack = JSON.stringify(pack);
  const requests: StructuredOutputRequest[] = [];
  const fake = serviceWithResponses([response(correct)], requests);
  const result = await fake.service.repair(original, pack, options);

  assert.equal(result.status, 'success', JSON.stringify(result.finalValidation.diagnostics));
  assert.equal(result.calls, 1);
  assert.equal(result.finalPlan.laneApproach.text, correct.text);
  const expected = { ...structuredClone(original), laneApproach: correct };
  assert.deepEqual(result.finalPlan, expected);
  assert.equal(JSON.stringify(pack), originalPack);
  assert.deepEqual(result.attempts[0]?.paths, ['laneApproach']);
  assert.equal(result.attempts[0]?.provider, 'fixture-provider');
  assert.equal(result.attempts[0]?.providerMetadata?.totalTokens, 15);

  const input = requests[0]?.input as {
    targets: readonly { allowedFacts: readonly { factId: string }[] }[];
  };
  assert.ok(input.targets[0]?.allowedFacts.some(({ factId }) => factId === 'ability:leona:e'));
  assert.equal(input.targets[0]?.allowedFacts.some(({ factId }) => factId === 'ability:morgana:q'), false);
});

test('strategy repair stops early after the first valid pass', async () => {
  const fake = serviceWithResponses([response(correct), response(correct)]);
  const result = await fake.service.repair(plan(), await factPack(), options);
  assert.equal(result.status, 'success', JSON.stringify(result.finalValidation.diagnostics));
  assert.equal(fake.calls(), 1);
  assert.equal(result.attempts.length, 1);
});

test('strategy repair remains invalid after two bounded unsuccessful passes', async () => {
  const invalid = leonaAssertion('Leona E (Zenith Blade) stuns all nearby enemies.');
  const fake = serviceWithResponses([response(invalid), response(invalid)]);
  const result = await fake.service.repair(plan(), await factPack(), options);
  assert.equal(result.status, 'invalid');
  assert.equal(fake.calls(), 2);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.finalValidation.valid, false);
  assert.ok(result.finalValidation.diagnostics.some(({ code }) => code === 'ABILITY_EFFECT_MISMATCH'));
});

test('strategy repair records a newly introduced violation without accepting it', async () => {
  const regression: StrategyAssertion = {
    text: 'Caitlyn uses Black Shield to shield herself.',
    grounding: 'fact-grounded',
    participantIds: ['enemy:carry', 'enemy:support'],
    factIds: ['ability:morgana:e'],
    missingKnowledge: [],
  };
  const fake = serviceWithResponses([response(regression)]);
  const result = await fake.service.repair(plan(), await factPack(), {
    ...options,
    maxRepairs: 1,
  });
  assert.equal(result.status, 'invalid');
  assert.ok(result.attempts[0]?.introducedDiagnosticKeys.some((key) => (
    key.startsWith('ABILITY_CHAMPION_MISMATCH|laneApproach')
  )));
});

test('strategy repair treats malformed output as a failed pass and never widens paths', async () => {
  const malformed = new UnparsedProviderOutput('not-json');
  const wrongPath = response(correct, 'wavePlan');
  const fake = serviceWithResponses([malformed, wrongPath]);
  const result = await fake.service.repair(plan(), await factPack(), options);
  assert.equal(result.status, 'invalid');
  assert.deepEqual(result.attempts.map(({ outcome }) => outcome), [
    'invalid_response',
    'invalid_response',
  ]);
  assert.equal(result.finalPlan.laneApproach.text, plan().laneApproach.text);
  assert.equal(result.finalPlan.wavePlan.text, plan().wavePlan.text);
});

test('strategy repair separates provider failures from mechanical rejection', async () => {
  const failure = new ProviderFailureError({
    provider: 'fixture-provider',
    model: 'fixture-model',
    category: 'rate_limit',
  });
  const fake = serviceWithResponses([failure]);
  const result = await fake.service.repair(plan(), await factPack(), options);
  assert.equal(result.status, 'provider_error');
  assert.equal(result.attempts[0]?.outcome, 'provider_error');
  assert.equal(result.attempts[0]?.providerFailureCategory, 'rate_limit');
  assert.equal(result.finalValidation.valid, false);
});

test('strategy repair performs no call when disabled, already valid, or non-repairable', async () => {
  const pack = await factPack();
  const fake = serviceWithResponses([]);
  const disabled = await fake.service.repair(plan(), pack, { ...options, maxRepairs: 0 });
  assert.equal(disabled.status, 'invalid');

  const valid = await fake.service.repair(plan(correct), pack, options);
  assert.equal(valid.status, 'success', JSON.stringify(valid.finalValidation.diagnostics));

  const wrongPatch = { ...plan(), patch: '99.99' };
  const nonRepairable = await fake.service.repair(wrongPatch, pack, options);
  assert.equal(nonRepairable.status, 'invalid');
  assert.equal(fake.calls(), 0);
});
