import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { MatchupFactPack } from '../server/knowledge/MatchupFactPack.js';
import { MatchupFactPackBuilder } from '../server/knowledge/MatchupFactPackBuilder.js';
import {
  MATCHUP_STRATEGY_PLAN_VERSION,
  type MatchupStrategyPlan,
  type StrategyAssertion,
} from '../server/strategy/MatchupStrategyPlan.js';
import { StrategyPlanPreRenderValidator } from '../server/strategy/StrategyPlanPreRenderValidator.js';
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

function grounded(
  text: string,
  participantIds: readonly string[],
  factIds: readonly string[],
): StrategyAssertion {
  return { text, grounding: 'fact-grounded', participantIds, factIds, missingKnowledge: [] };
}

function plan(overrides: Partial<MatchupStrategyPlan> = {}): MatchupStrategyPlan {
  return {
    schemaVersion: 1,
    planVersion: MATCHUP_STRATEGY_PLAN_VERSION,
    matchupId: 'L61-G06',
    patch: '26.19',
    laneApproach: strategic('Control the wave before taking a trade.'),
    threatResponseWindow: {
      threat: grounded(
        'Morgana E (Black Shield) shields Caitlyn against Leona crowd control.',
        ['enemy:support', 'enemy:carry', 'ally:support'],
        ['ability:morgana:e', 'morgana-e-vs-leona-engage'],
      ),
      response: strategic('Consider pressuring after Leona misses E.'),
      tradeWindow: strategic('Take a short trade after the opposing window is spent.'),
      winCondition: strategic('Preserve wave priority without forcing every trade.'),
    },
    earlyLevels: {
      level1: strategic('Play behind the minion wave.'),
      level2: strategic('Respect the opposing level-two pressure.'),
      level3: strategic('Trade only with a safe exit.'),
    },
    wavePlan: strategic('Keep the wave controlled.'),
    targetPriority: strategic('Pressure the exposed target.'),
    postLevel6: strategic('Avoid an unnecessarily prolonged fight.'),
    roamPlan: strategic('Roam only after a clean crash.'),
    ...overrides,
  };
}

function codes(result: ReturnType<StrategyPlanPreRenderValidator['validate']>): readonly string[] {
  return result.diagnostics.map(({ code }) => code);
}

test('pre-render accepts a supported mechanical assertion and conditional strategy', async () => {
  const result = new StrategyPlanPreRenderValidator().validate(plan(), await factPack());
  assert.equal(result.valid, true);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    result.assertions.find(({ path }) => path === 'threatResponseWindow.threat')?.mechanicalValidation,
    'supported',
  );
  assert.equal(
    result.assertions.find(({ path }) => path === 'threatResponseWindow.response')?.mechanicalValidation,
    'not-applicable',
  );
});

test('pre-render preserves B2 rejection of unknown and wrong-champion facts', async () => {
  const pack = await factPack();
  const unknown = new StrategyPlanPreRenderValidator().validate(plan({
    laneApproach: grounded('Jinx uses Switcheroo!.', ['ally:carry'], ['unknown:fact']),
  }), pack);
  assert.ok(codes(unknown).includes('UNKNOWN_FACT'));

  const wrongChampion = new StrategyPlanPreRenderValidator().validate(plan({
    laneApproach: grounded('Morgana uses Black Shield.', ['ally:support'], ['ability:morgana:e']),
  }), pack);
  assert.ok(codes(wrongChampion).includes('FACT_PARTICIPANT_MISMATCH'));
});

test('pre-render detects an incorrect slot and wrong ability owner', async () => {
  const pack = await factPack();
  const slot = new StrategyPlanPreRenderValidator().validate(plan({
    laneApproach: grounded(
      'Morgana Q (Black Shield) shields Caitlyn.',
      ['enemy:support', 'enemy:carry'],
      ['ability:morgana:e'],
    ),
  }), pack);
  assert.ok(codes(slot).includes('ABILITY_SLOT_MISMATCH'));

  const owner = new StrategyPlanPreRenderValidator().validate(plan({
    laneApproach: grounded(
      'Caitlyn uses Black Shield to shield herself.',
      ['enemy:support', 'enemy:carry'],
      ['ability:morgana:e'],
    ),
  }), pack);
  assert.ok(codes(owner).includes('ABILITY_CHAMPION_MISMATCH'));
});

test('pre-render rejects a contradictory effect and unavailable ultimate', async () => {
  const pack = await factPack();
  const effect = new StrategyPlanPreRenderValidator().validate(plan({
    laneApproach: grounded(
      'Leona E (Zenith Blade) stuns all nearby enemies.',
      ['ally:support'],
      ['ability:leona:e'],
    ),
  }), pack);
  assert.ok(codes(effect).includes('ABILITY_EFFECT_MISMATCH'));

  const unavailable = new StrategyPlanPreRenderValidator().validate(plan({
    earlyLevels: {
      ...plan().earlyLevels,
      level2: grounded(
        'At level 2 Leona R (Solar Flare) stuns the enemy carry.',
        ['ally:support', 'enemy:carry'],
        ['ability:leona:r'],
      ),
    },
  }), pack);
  const diagnostic = unavailable.diagnostics.find(({ code }) => code === 'ABILITY_UNAVAILABLE_AT_LEVEL');
  assert.equal(diagnostic?.path, 'earlyLevels.level2');
  assert.equal(diagnostic?.repairable, true);
});

test('pre-render distinguishes a valid reference from a supporting reference', async () => {
  const result = new StrategyPlanPreRenderValidator().validate(plan({
    laneApproach: grounded(
      'Leona E (Zenith Blade) roots its target.',
      ['ally:support', 'enemy:carry'],
      ['ability:caitlyn:q'],
    ),
  }), await factPack());
  const diagnostic = result.diagnostics.find(({ code }) => code === 'FACT_NOT_SUPPORTING_ASSERTION');
  assert.equal(result.valid, false);
  assert.deepEqual(diagnostic?.factIds, ['ability:caitlyn:q']);
  assert.equal(diagnostic?.category, 'INSUFFICIENT_SUPPORT');
});

test('pre-render blocks declared or source-level missing mechanical knowledge', async () => {
  const pack = await factPack();
  const declared = new StrategyPlanPreRenderValidator().validate(plan({
    laneApproach: {
      text: 'This interaction cannot be established.',
      grounding: 'insufficient',
      participantIds: ['ally:carry'],
      factIds: [],
      missingKnowledge: ['Critical interaction is absent.'],
    },
  }), pack);
  assert.ok(codes(declared).includes('INSUFFICIENT_MECHANICAL_SUPPORT'));

  const partialPack: MatchupFactPack = {
    ...pack,
    championFacts: {
      ...pack.championFacts,
      abilities: pack.championFacts.abilities.map((fact) => fact.factId === 'ability:leona:e'
        ? { ...fact, coverage: { status: 'partial', missing: ['effects missing'] } }
        : fact),
    },
  };
  const partial = new StrategyPlanPreRenderValidator().validate(plan({
    laneApproach: grounded(
      'Leona E (Zenith Blade) roots its target.',
      ['ally:support', 'enemy:carry'],
      ['ability:leona:e'],
    ),
  }), partialPack);
  assert.ok(partial.diagnostics.some(({ code, factIds }) => (
    code === 'INSUFFICIENT_MECHANICAL_SUPPORT' && factIds.includes('ability:leona:e')
  )));
});

test('pre-render keeps patch mismatches non-repairable', async () => {
  const result = new StrategyPlanPreRenderValidator().validate(
    plan({ patch: '99.99' }),
    await factPack(),
  );
  const diagnostic = result.diagnostics.find(({ code }) => code === 'PATCH_MISMATCH');
  assert.equal(result.valid, false);
  assert.equal(diagnostic?.repairable, false);
});
