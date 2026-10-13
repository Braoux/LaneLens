import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { StructuredOutputProvider } from '../server/analysis/StructuredOutputProvider.js';
import { UnparsedProviderOutput } from '../server/analysis/UnparsedProviderOutput.js';
import { ExperimentalFactGroundedPipeline } from '../server/strategy/ExperimentalFactGroundedPipeline.js';
import {
  MATCHUP_STRATEGY_PLAN_VERSION,
  type MatchupStrategyPlan,
  type StrategyAssertion,
} from '../server/strategy/MatchupStrategyPlan.js';
import { StrategyPlanGenerationService } from '../server/strategy/StrategyPlanGenerationService.js';
import { TargetedStrategyPlanRepairService } from '../server/strategy/TargetedStrategyPlanRepairService.js';
import { loadEvaluationCorpus } from '../scripts/evaluation/corpus.js';
import {
  inspectFactGroundedPipeline,
  parseInspectFactGroundedPipelineArguments,
} from '../scripts/evaluation/inspect-fact-grounded-pipeline.js';

const corpusPath = fileURLToPath(new URL(
  '../evaluation/corpus/lan-061-golden-v1.json',
  import.meta.url,
));

function strategic(text: string, participantIds: readonly string[] = []): StrategyAssertion {
  return { text, grounding: 'strategic-only', participantIds, factIds: [], missingKnowledge: [] };
}

function leona(text: string): StrategyAssertion {
  return {
    text,
    grounding: 'fact-grounded',
    participantIds: ['ally:support', 'enemy:carry'],
    factIds: ['ability:leona:e'],
    missingKnowledge: [],
  };
}

function plan(laneApproach: StrategyAssertion, french = true): MatchupStrategyPlan {
  const sentence = (fr: string, en: string) => french ? fr : en;
  return {
    schemaVersion: 1,
    planVersion: MATCHUP_STRATEGY_PLAN_VERSION,
    matchupId: 'L61-G06',
    patch: '26.19',
    laneApproach,
    threatResponseWindow: {
      threat: strategic(sentence('Respectez la menace adverse.', 'Respect the opposing threat and keep your distance.')),
      response: strategic(sentence('Avancez après une erreur adverse.', 'Move forward after the opponent makes a mistake.')),
      tradeWindow: strategic(sentence('Prenez un échange court.', 'Take a short trade during that window.')),
      winCondition: strategic(sentence('Préservez la priorité de vague.', 'Keep wave priority without forcing every trade.')),
    },
    earlyLevels: {
      level1: strategic(sentence('Jouez derrière la vague au niveau 1.', 'Play behind the wave at level one.')),
      level2: strategic(sentence('Respectez le niveau 2.', 'Respect the level two power spike.')),
      level3: strategic(sentence('Gardez une sortie sûre au niveau 3.', 'Keep a safe exit at level three.')),
    },
    wavePlan: strategic(sentence('Contrôlez la vague.', 'Keep the wave controlled on your side.')),
    targetPriority: strategic(sentence('Punissez Caitlyn exposée.', 'Pressure Caitlyn when she is exposed.'), ['enemy:carry']),
    postLevel6: strategic(sentence('Évitez les combats prolongés.', 'Avoid an unnecessarily prolonged fight.')),
    roamPlan: strategic(sentence('Décalez après avoir poussé.', 'Roam only after pushing the wave.')),
  };
}

async function request() {
  const corpus = (await loadEvaluationCorpus(corpusPath)).corpus;
  return corpus.matchups.find(({ id }) => id === 'L61-G06')!;
}

function pipeline(provider: StructuredOutputProvider): ExperimentalFactGroundedPipeline {
  return new ExperimentalFactGroundedPipeline(
    new StrategyPlanGenerationService(provider),
    new TargetedStrategyPlanRepairService(provider),
  );
}

const options = {
  locale: 'fr-FR' as const,
  maxRepairs: 2 as const,
  provider: 'fixture-provider',
  model: 'fixture-model',
};

test('experimental pipeline repairs one assertion, renders deterministically, and records costs', async () => {
  const invalid = plan(leona('Leona E (Zenith Blade) étourdit tous les ennemis proches.'));
  const corrected = leona('Leona E (Zenith Blade) applique un root à la dernière cible touchée.');
  const schemas: string[] = [];
  const provider: StructuredOutputProvider = {
    async generateStructured(request, observer) {
      schemas.push(request.schemaName);
      if (request.schemaName === 'matchup_strategy_plan') {
        observer?.onMetadata?.({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
        return invalid;
      }
      observer?.onMetadata?.({ inputTokens: 30, outputTokens: 10, totalTokens: 40 });
      return { schemaVersion: 1, replacements: [{ path: 'laneApproach', assertion: corrected }] };
    },
  };
  const result = await pipeline(provider).run(await request(), options);
  assert.equal(
    result.status,
    'success',
    JSON.stringify(result.repair?.finalValidation.diagnostics),
  );
  assert.deepEqual(schemas, ['matchup_strategy_plan', 'strategy_plan_repair']);
  assert.equal(result.repair?.attempts.length, 1);
  assert.equal(result.render?.analysis?.lanePlan, corrected.text);
  assert.equal(result.metrics.providerCalls.strategyGeneration, 1);
  assert.equal(result.metrics.providerCalls.functionalRepairs, 1);
  assert.equal(result.metrics.providerCalls.renderer, 0);
  assert.equal(result.metrics.providerCalls.maximumPerAnalysis, 3);
  assert.equal(result.metrics.tokens.total.totalTokens, 190);
  assert.equal(result.metrics.estimatedCost, null);
  assert.equal(result.metrics.quality.initialPlanValid, false);
  assert.equal(result.metrics.quality.planValidAfterRepair, true);
  assert.deepEqual(result.metrics.repair.fieldsRegenerated, ['laneApproach']);
});

test('experimental pipeline rejects an invalid plan when repair is disabled', async () => {
  let calls = 0;
  const provider: StructuredOutputProvider = {
    async generateStructured() {
      calls += 1;
      return plan(leona('Leona E (Zenith Blade) étourdit tous les ennemis proches.'));
    },
  };
  const result = await pipeline(provider).run(await request(), { ...options, maxRepairs: 0 });
  assert.equal(result.status, 'pre_render_rejected');
  assert.equal(calls, 1);
  assert.equal(result.render, undefined);
});

test('experimental pipeline distinguishes parsing failure and final language rejection', async () => {
  const malformed: StructuredOutputProvider = {
    async generateStructured() { return new UnparsedProviderOutput('not-json'); },
  };
  const parsing = await pipeline(malformed).run(await request(), options);
  assert.equal(parsing.status, 'generation_error');
  assert.equal(parsing.error?.phase, 'parsing');

  const english: StructuredOutputProvider = {
    async generateStructured() {
      return plan(strategic('Keep the wave close and avoid forcing a long trade.'), false);
    },
  };
  const language = await pipeline(english).run(await request(), options);
  assert.equal(language.status, 'final_validation_rejected');
  assert.ok(language.render?.finalValidation?.languageViolations.length);
});

test('experimental pipeline preserves its Fact Pack across generation, repair, and render', async () => {
  const valid = plan(strategic('Contrôlez la vague avant l’échange.'));
  const provider: StructuredOutputProvider = { async generateStructured() { return valid; } };
  const result = await pipeline(provider).run(await request(), options);
  assert.equal(result.status, 'success');
  assert.equal(result.factPack.coverage.mechanicallyFullyCovered, true);
  assert.equal(result.repair, undefined);
  assert.equal(result.metrics.providerCalls.functionalRepairs, 0);
});

test('fixture inspection exposes an offline end-to-end artifact and validates bounded options', async () => {
  assert.throws(
    () => parseInspectFactGroundedPipelineArguments([
      '--id', 'L61-G06', '--fixture', 'plan.json', '--max-repairs', '3',
    ]),
    /0, 1 ou 2/,
  );
  let output = '';
  await inspectFactGroundedPipeline([
    '--corpus', corpusPath,
    '--id', 'L61-G06',
    '--fixture', fileURLToPath(new URL('./fixtures/strategy-plan-l61-g06.json', import.meta.url)),
  ], (value) => { output += value; });
  const artifact = JSON.parse(output) as { status: string; metrics: { providerCalls: { renderer: number } } };
  assert.equal(artifact.status, 'success');
  assert.equal(artifact.metrics.providerCalls.renderer, 0);
});
