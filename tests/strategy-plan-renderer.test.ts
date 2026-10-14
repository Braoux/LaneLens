import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ConstrainedStrategyPlanRenderer } from '../server/strategy/ConstrainedStrategyPlanRenderer.js';
import {
  MATCHUP_STRATEGY_PLAN_VERSION,
  strategyAssertions,
  type MatchupStrategyPlan,
  type StrategyAssertion,
} from '../server/strategy/MatchupStrategyPlan.js';
import { MatchupFactPackBuilder } from '../server/knowledge/MatchupFactPackBuilder.js';
import { loadEvaluationCorpus } from '../scripts/evaluation/corpus.js';

const corpusPath = fileURLToPath(new URL(
  '../evaluation/corpus/lan-061-golden-v1.json',
  import.meta.url,
));

async function factPack() {
  const corpus = (await loadEvaluationCorpus(corpusPath)).corpus;
  return new MatchupFactPackBuilder().build(corpus.matchups.find(({ id }) => id === 'L61-G06')!);
}

function strategic(text: string, participantIds: readonly string[] = []): StrategyAssertion {
  return { text, grounding: 'strategic-only', participantIds, factIds: [], missingKnowledge: [] };
}

function plan(overrides: Partial<MatchupStrategyPlan> = {}): MatchupStrategyPlan {
  return {
    schemaVersion: 1,
    planVersion: MATCHUP_STRATEGY_PLAN_VERSION,
    matchupId: 'L61-G06',
    patch: '26.19',
    laneApproach: strategic('Contrôlez la vague avant de chercher un échange.'),
    threatResponseWindow: {
      threat: strategic('Respectez la portée d’engagement adverse.'),
      response: strategic('Envisagez d’avancer après que Leona a raté son E.'),
      tradeWindow: strategic('Prenez un échange court pendant cette fenêtre.'),
      winCondition: strategic('Préservez la priorité sans forcer chaque échange.'),
    },
    earlyLevels: {
      level1: strategic('Jouez derrière la vague au niveau 1.'),
      level2: strategic('Respectez la pression du niveau 2.'),
      level3: strategic('Échangez uniquement avec une sortie sûre au niveau 3.'),
    },
    wavePlan: strategic('Gardez une vague contrôlée de votre côté.'),
    targetPriority: strategic('Punissez Caitlyn lorsqu’elle est exposée.', ['enemy:carry']),
    postLevel6: strategic('Évitez les combats inutilement prolongés après le niveau 6.'),
    roamPlan: strategic('Décalez uniquement après avoir poussé la vague.'),
    ...overrides,
  };
}

test('deterministic renderer produces the current MatchupAnalysis contract without new prose', async () => {
  const source = plan();
  const result = new ConstrainedStrategyPlanRenderer().render(source, await factPack(), 'fr-FR');
  assert.equal(result.status, 'success');
  assert.equal(result.finalValidation?.valid, true);
  assert.equal(result.analysis?.targetPriority.primaryTarget, 'Caitlyn');
  assert.equal(result.analysis?.threatResponseWindow.window, source.threatResponseWindow.tradeWindow.text);
  assert.equal(result.analysis?.goldenRule, source.threatResponseWindow.winCondition.text);

  const allowedTexts = new Set(strategyAssertions(source).map(({ assertion }) => assertion.text));
  const analysisTexts = [
    result.analysis?.lanePlan,
    result.analysis?.threatResponseWindow.threat,
    result.analysis?.threatResponseWindow.response,
    result.analysis?.threatResponseWindow.window,
    result.analysis?.threatResponseWindow.winCondition,
    result.analysis?.earlyLevels.level1,
    result.analysis?.earlyLevels.level2,
    result.analysis?.earlyLevels.level3,
    result.analysis?.wavePlan,
    result.analysis?.targetPriority.explanation,
    result.analysis?.postLevel6,
    result.analysis?.roamPlan,
    ...(result.analysis?.cheatSheet ?? []),
    result.analysis?.goldenRule,
  ];
  assert.ok(analysisTexts.every((text) => text !== undefined && allowedTexts.has(text)));
});

test('renderer refuses a mechanically invalid Strategy Plan before rendering', async () => {
  const invalid = plan({
    laneApproach: {
      text: 'Leona E (Zenith Blade) étourdit tous les ennemis proches.',
      grounding: 'fact-grounded',
      participantIds: ['ally:support'],
      factIds: ['ability:leona:e'],
      missingKnowledge: [],
    },
  });
  const result = new ConstrainedStrategyPlanRenderer().render(invalid, await factPack(), 'fr-FR');
  assert.equal(result.status, 'pre_render_rejected');
  assert.equal(result.analysis, undefined);
});

test('renderer requires one explicit enemy target and never guesses it from prose', async () => {
  const missingTarget = plan({ targetPriority: strategic('Punissez la cible exposée.') });
  const result = new ConstrainedStrategyPlanRenderer().render(missingTarget, await factPack(), 'fr-FR');
  assert.equal(result.status, 'render_rejected');
  assert.equal(result.diagnostics[0]?.code, 'TARGET_PRIORITY_UNRESOLVED');
});

test('renderer preserves conditional recommendations and rejects a final locale mismatch', async () => {
  const english = plan({
    laneApproach: strategic('Keep the wave close and avoid forcing a long trade.'),
  });
  const result = new ConstrainedStrategyPlanRenderer().render(english, await factPack(), 'fr-FR');
  assert.equal(result.status, 'final_validation_rejected');
  assert.equal(result.analysis?.threatResponseWindow.response, plan().threatResponseWindow.response.text);
  assert.ok(result.finalValidation?.languageViolations.some(({ path }) => path === 'lanePlan'));
});
