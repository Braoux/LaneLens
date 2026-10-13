import assert from 'node:assert/strict';
import test from 'node:test';
import type { MatchupAnalysis } from '../server/analysis/types.js';
import {
  applyRemovalReview,
  revalidateEvaluationResults,
  revalidateRepairResults,
} from '../scripts/evaluation/revalidation.js';
import type { EvaluationResultsFile } from '../scripts/evaluation/types.js';
import type { RepairResultsFile } from '../scripts/evaluation/repair-types.js';

const input = {
  allyCarry: 'Ziggs',
  allySupport: 'Galio',
  enemyCarry: 'Jinx',
  enemySupport: 'Swain',
  patch: '26.19',
} as const;

function analysis(): MatchupAnalysis {
  return {
    matchup: input,
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
    cheatSheet: ['Nevermove raté → avance'],
    goldenRule: 'Ne combats pas longtemps dans la zone de Swain.',
  };
}

test('offline evaluation revalidation preserves shape rejections and enriches diagnostics', async () => {
  const invalid = analysis();
  invalid.goldenRule = 'Galio place son W en retrait pour protéger Ziggs.';
  const file: EvaluationResultsFile = {
    schemaVersion: 1,
    results: [
      {
        id: 'fixture#1',
        input,
        sentinel: true,
        status: 'invalid_analysis',
        startedAt: '2026-10-13T00:00:00.000Z',
        completedAt: '2026-10-13T00:00:01.000Z',
        attempts: [],
        candidateAnalysis: invalid,
        rejectionPhase: 'conformance',
        violations: [{
          code: 'ABILITY_TARGETING_MISMATCH',
          category: 'INVALID_ABILITY_EFFECT',
          severity: 'error',
          path: 'goldenRule',
        }],
      },
      {
        id: 'fixture#2',
        input,
        sentinel: true,
        status: 'invalid_analysis',
        startedAt: '2026-10-13T00:00:00.000Z',
        completedAt: '2026-10-13T00:00:01.000Z',
        attempts: [],
        rejectionPhase: 'shape',
      },
    ],
  };

  const artifact = await revalidateEvaluationResults(file, '2026-10-13T00:00:00.000Z');
  assert.equal(artifact.summary.revalidated, 1);
  assert.equal(artifact.summary.shapeRejections, 1);
  assert.deepEqual(artifact.observations[0]?.diagnosticsEnriched, [{
    code: 'ABILITY_TARGETING_MISMATCH',
    path: 'goldenRule',
    subject: 'galio:W',
    knowledgeId: 'ability-galio-w-mechanics',
  }]);
  assert.equal(artifact.observations[1]?.revalidationStatus, 'shape_rejection');

  const reviewed = applyRemovalReview(artifact, [{
    id: 'fixture#1',
    code: 'ABILITY_TARGETING_MISMATCH',
    path: 'goldenRule',
    classification: 'DIAGNOSTIC_REASSOCIATION',
    reason: 'Le diagnostic générique est remplacé par un sujet canonique.',
  }]);
  assert.deepEqual(reviewed.observations[0]?.removalReviews, [{
    violation: {
      code: 'ABILITY_TARGETING_MISMATCH',
      category: 'INVALID_ABILITY_EFFECT',
      severity: 'error',
      path: 'goldenRule',
    },
    classification: 'DIAGNOSTIC_REASSOCIATION',
    reason: 'Le diagnostic générique est remplacé par un sujet canonique.',
  }]);
});

test('offline repair revalidation validates the final analysis without invoking a provider', async () => {
  const file: RepairResultsFile = {
    schemaVersion: 1,
    results: [{
      id: 'fixture#1',
      matchupId: 'fixture',
      repetition: 1,
      input,
      sentinel: true,
      status: 'success',
      startedAt: '2026-10-13T00:00:00.000Z',
      completedAt: '2026-10-13T00:00:01.000Z',
      originalAnalysis: analysis(),
      initialViolations: [],
      finalAnalysis: analysis(),
      finalViolations: [],
      attempts: [],
    }],
  };

  const artifact = await revalidateRepairResults(file, '2026-10-13T00:00:00.000Z');
  assert.equal(artifact.summary.validAfter, 1);
  assert.equal(artifact.summary.invalidAfter, 0);
  assert.equal(artifact.sourceKind, 'repair');
});
