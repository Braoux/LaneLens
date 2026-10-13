import assert from 'node:assert/strict';
import test from 'node:test';
import type { MatchupAnalysisProvider } from '../server/analysis/MatchupAnalysisProvider.js';
import { MatchupAnalysisService } from '../server/analysis/MatchupAnalysisService.js';
import { TargetedAnalysisRepairService } from '../server/analysis/TargetedAnalysisRepairService.js';
import { findRejectedAnalysisFailure } from '../server/analysis/RejectedAnalysisFailure.js';
import type { MatchupAnalysis, MatchupAnalysisInput } from '../server/analysis/types.js';
import type { AnalysisConformanceViolation } from '../server/analysis/AnalysisConformanceValidator.js';

const input: MatchupAnalysisInput = {
  allyCarry: 'Ziggs',
  allySupport: 'Galio',
  enemyCarry: 'Jinx',
  enemySupport: 'Swain',
  patch: '26.19',
  locale: 'fr-FR',
  patchContext: {
    patch: '26.19',
    contextVersion: 'test-v1',
    facts: [{ subject: 'Swain E', text: 'Nevermove immobilise une cible.' }],
  },
};

function analysis(): MatchupAnalysis {
  return {
    matchup: {
      allyCarry: 'Ziggs',
      allySupport: 'Galio',
      enemyCarry: 'Jinx',
      enemySupport: 'Swain',
      patch: '26.19',
    },
    lanePlan: 'Contrôler la vague et punir les sorts manqués.',
    threatResponseWindow: {
      threat: 'Nevermove peut initier le contrôle adverse.',
      response: 'Esquiver latéralement puis reprendre l’espace.',
      window: 'Avancer après que Swain a raté Nevermove.',
      winCondition: 'Créer des fenêtres de poke répétées.',
    },
    earlyLevels: {
      level1: 'Ziggs Q maintient la pression à distance.',
      level2: 'Galio E peut menacer une cible avancée.',
      level3: 'Coordonner les sorts de base pour contrôler la zone.',
    },
    wavePlan: 'Garder une vague favorable sans pousser automatiquement.',
    targetPriority: {
      primaryTarget: 'Jinx',
      explanation: 'Punir Jinx lorsque Swain ne peut plus engager.',
    },
    postLevel6: 'Hero’s Entrance peut soutenir un engagement confirmé.',
    roamPlan: 'Galio peut roam après avoir sécurisé la vague.',
    cheatSheet: ['Nevermove raté → avance', 'Préserve Satchel Charge pour te replacer'],
    goldenRule: 'Ne combats pas longtemps dans la zone de Swain.',
  };
}

const violation: AnalysisConformanceViolation = {
  code: 'ABILITY_UNAVAILABLE_AT_LEVEL',
  category: 'ABILITY_NOT_AVAILABLE',
  severity: 'error',
  path: 'earlyLevels.level2',
};

test('targeted repair preserves every field outside validator paths', async () => {
  const original = analysis();
  original.earlyLevels.level2 = 'Galio R protège Ziggs au niveau 2.';
  const proposed = analysis();
  proposed.goldenRule = 'Ce changement hors périmètre doit être ignoré.';
  let instructions = '';
  const provider: MatchupAnalysisProvider = {
    async analyze(request) {
      instructions = request.instructions;
      return proposed;
    },
  };

  const repaired = await new TargetedAnalysisRepairService(provider).repair(input, original, [violation]);

  assert.equal(repaired.earlyLevels.level2, proposed.earlyLevels.level2);
  assert.equal(repaired.goldenRule, original.goldenRule);
  assert.match(instructions, /TARGETED REPAIR/u);
  assert.match(instructions, /ABILITY_UNAVAILABLE_AT_LEVEL/u);
  assert.match(instructions, /earlyLevels\.level2/u);
});

test('a repair candidate still rejected by the same validator remains invalid and inspectable', async () => {
  const original = analysis();
  original.earlyLevels.level2 = 'Galio R protège Ziggs au niveau 2.';
  const proposed = structuredClone(original);
  const service = new TargetedAnalysisRepairService({ async analyze() { return proposed; } });

  await assert.rejects(service.repair(input, original, [violation]), (error: unknown) => {
    const rejected = findRejectedAnalysisFailure(error);
    assert.equal(rejected?.phase, 'conformance');
    assert.equal(rejected?.candidate?.earlyLevels.level2, original.earlyLevels.level2);
    assert.equal(rejected?.conformanceViolations?.[0]?.code, 'ABILITY_UNAVAILABLE_AT_LEVEL');
    return true;
  });
});

test('malformed provider output is retained as a rejected response for audit', async () => {
  const malformed = { lanePlan: 'incomplet' };
  const service = new MatchupAnalysisService({ async analyze() { return malformed; } });

  await assert.rejects(service.analyze(input), (error: unknown) => {
    const rejected = findRejectedAnalysisFailure(error);
    assert.equal(rejected?.phase, 'shape');
    assert.deepEqual(rejected?.response, malformed);
    return true;
  });
});
