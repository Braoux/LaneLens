import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { MatchupFactPackBuilder } from '../server/knowledge/MatchupFactPackBuilder.js';
import type { MatchupFactPack } from '../server/knowledge/MatchupFactPack.js';
import {
  MATCHUP_STRATEGY_PLAN_VERSION,
  type MatchupStrategyPlan,
  type StrategyAssertion,
} from '../server/strategy/MatchupStrategyPlan.js';
import { StrategyPlanValidator } from '../server/strategy/StrategyPlanValidator.js';
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

function plan(overrides: Partial<MatchupStrategyPlan> = {}): MatchupStrategyPlan {
  return {
    schemaVersion: 1,
    planVersion: MATCHUP_STRATEGY_PLAN_VERSION,
    matchupId: 'L61-G06',
    patch: '26.19',
    laneApproach: strategic('Contrôler la vague avant de chercher un échange.'),
    threatResponseWindow: {
      threat: {
        text: 'Black Shield peut protéger Caitlyn des contrôles de Leona.',
        grounding: 'fact-grounded',
        participantIds: ['enemy:support', 'enemy:carry', 'ally:support'],
        factIds: ['ability:morgana:e', 'morgana-e-vs-leona-engage'],
        missingKnowledge: [],
      },
      response: strategic('Attendre que le bouclier soit indisponible.'),
      tradeWindow: strategic('Prendre un échange court après la fenêtre adverse.'),
      winCondition: strategic('Préserver la priorité de vague.'),
    },
    earlyLevels: {
      level1: strategic('Jouer derrière la vague.'),
      level2: strategic('Respecter le pic de niveau 2.'),
      level3: strategic('Échanger avec les kits de base disponibles.'),
    },
    wavePlan: strategic('Maintenir une vague contrôlée.'),
    targetPriority: strategic('Frapper la cible exposée.'),
    postLevel6: strategic('Éviter les combats prolongés.'),
    roamPlan: strategic('Roam uniquement après un crash.'),
    ...overrides,
  };
}

test('strategy plan validates strict shape and references from its Fact Pack', async () => {
  const validation = new StrategyPlanValidator().validate(plan(), await factPack());
  assert.equal(validation.valid, true);
  assert.equal(validation.plan?.planVersion, MATCHUP_STRATEGY_PLAN_VERSION);
  const threat = validation.assertions.find(({ path }) => path === 'threatResponseWindow.threat');
  assert.deepEqual(threat, {
    path: 'threatResponseWindow.threat',
    grounding: 'fact-grounded',
    referenceValidation: 'valid',
    semanticSupportValidation: 'not-evaluated',
    resolvedFactIds: ['ability:morgana:e', 'morgana-e-vs-leona-engage'],
    missingKnowledge: [],
  });
});

test('strategy plan rejects extra properties and an invalid provider-shaped response', async () => {
  const candidate = { ...plan(), unexpected: true };
  const validation = new StrategyPlanValidator().validate(candidate, await factPack());
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.issues.map(({ code }) => code), ['INVALID_SHAPE']);
});

test('strategy plan rejects unknown and cross-matchup facts', async () => {
  const pack = await factPack();
  for (const factId of ['unknown:fact', 'ability:ziggs:q']) {
    const candidate = plan({
      laneApproach: {
        text: 'Affirmation mécanique.',
        grounding: 'fact-grounded',
        participantIds: ['ally:carry'],
        factIds: [factId],
        missingKnowledge: [],
      },
    });
    const validation = new StrategyPlanValidator().validate(candidate, pack);
    assert.equal(validation.valid, false);
    assert.ok(validation.issues.some(({ code, factId: issueFact }) => (
      code === 'UNKNOWN_FACT' && issueFact === factId
    )));
  }
});

test('strategy plan rejects matchup and patch mismatches', async () => {
  const validation = new StrategyPlanValidator().validate(
    plan({ matchupId: 'another-matchup', patch: '99.99' }),
    await factPack(),
  );
  assert.deepEqual(validation.issues.map(({ code }) => code), [
    'MATCHUP_MISMATCH',
    'PATCH_MISMATCH',
  ]);
});

test('strategy plan enforces champion and team ownership for referenced facts', async () => {
  const candidate = plan({
    laneApproach: {
      text: 'Morgana protège son carry.',
      grounding: 'fact-grounded',
      participantIds: ['ally:support'],
      factIds: ['ability:morgana:e'],
      missingKnowledge: [],
    },
  });
  const validation = new StrategyPlanValidator().validate(candidate, await factPack());
  assert.ok(validation.issues.some(({ code, factId }) => (
    code === 'FACT_PARTICIPANT_MISMATCH' && factId === 'ability:morgana:e'
  )));
});

test('strategy plan makes missing knowledge explicit without claiming validation', async () => {
  const candidate = plan({
    laneApproach: {
      text: 'Impossible de justifier cette interaction avec les faits disponibles.',
      grounding: 'insufficient',
      participantIds: ['ally:carry'],
      factIds: [],
      missingKnowledge: ['Interaction critique non couverte.'],
    },
  });
  const validation = new StrategyPlanValidator().validate(candidate, await factPack());
  assert.equal(validation.valid, true);
  const status = validation.assertions.find(({ path }) => path === 'laneApproach');
  assert.equal(status?.referenceValidation, 'insufficient');
  assert.equal(status?.semanticSupportValidation, 'not-evaluated');
});

test('strategy plan does not accept ungrounded mechanical or duplicate references', async () => {
  const candidate = plan({
    laneApproach: {
      text: 'Affirmation mécanique sans preuve.',
      grounding: 'fact-grounded',
      participantIds: ['ally:carry', 'ally:carry'],
      factIds: [],
      missingKnowledge: [],
    },
  });
  const validation = new StrategyPlanValidator().validate(candidate, await factPack());
  assert.ok(validation.issues.some(({ code }) => code === 'INVALID_GROUNDING'));
  assert.ok(validation.issues.some(({ code }) => code === 'DUPLICATE_REFERENCE'));
});

test('strategy plan rejects references whose canonical provenance is missing', async () => {
  const pack = await factPack();
  const modified: MatchupFactPack = {
    ...pack,
    championFacts: {
      ...pack.championFacts,
      abilities: pack.championFacts.abilities.map((fact) => fact.factId === 'ability:morgana:e'
        ? { ...fact, sources: [] }
        : fact),
    },
  };
  const validation = new StrategyPlanValidator().validate(plan(), modified);
  assert.ok(validation.issues.some(({ code, factId }) => (
    code === 'MISSING_PROVENANCE' && factId === 'ability:morgana:e'
  )));
});
