import assert from 'node:assert/strict';
import test from 'node:test';
import { compareEvaluationSummaries } from '../scripts/evaluation/comparison.js';
import { buildEvaluationSummary } from '../scripts/evaluation/summary.js';
import type { EvaluationResult } from '../scripts/evaluation/types.js';

function result(id: string, status: EvaluationResult['status'], overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    id,
    input: { allyCarry: 'Jinx', allySupport: 'Thresh', enemyCarry: 'Caitlyn', enemySupport: 'Lux', patch: '26.19' },
    sentinel: true,
    status,
    startedAt: '2026-09-30T10:00:00.000Z',
    completedAt: '2026-09-30T10:00:01.000Z',
    durationMs: 1_000,
    attempts: [],
    ...overrides,
  };
}

test('evaluation summaries separate rejection categories, coverage, factual errors, and strategic issues', () => {
  const before = buildEvaluationSummary([
    result('a', 'invalid_analysis', {
      violations: [{
        code: 'ABILITY_EFFECT_MISMATCH', category: 'INVALID_ABILITY_EFFECT', severity: 'error', path: 'lanePlan',
      }],
      knowledgeCoverage: { status: 'none', coveredChampions: 0, totalChampions: 4, relevantKnowledgeCount: 0 },
      qualityReview: {
        reviewedAt: '2026-09-30T11:00:00.000Z', reviewer: 'human',
        factualErrors: ['invented effect', 'wrong timing'],
        strategicIssues: [{ severity: 'poor', note: 'bad wave plan' }],
      },
    }),
    result('b', 'success'),
  ], ['a', 'b']);
  const after = buildEvaluationSummary([
    result('a', 'success', {
      knowledgeCoverage: { status: 'partial', coveredChampions: 3, totalChampions: 4, relevantKnowledgeCount: 8 },
      qualityReview: {
        reviewedAt: '2026-09-30T12:00:00.000Z', reviewer: 'human', factualErrors: ['minor fact'],
        strategicIssues: [{ severity: 'questionable', note: 'conservative wave plan' }],
      },
    }),
    result('b', 'success'),
  ], ['a', 'b']);

  assert.equal(before.rejectionCategories.INVALID_ABILITY_EFFECT, 1);
  assert.equal(before.quality.factualErrors, 2);
  assert.equal(before.quality.strategicIssues.poor, 1);
  assert.equal(after.knowledgeCoverage.partial, 1);
  const comparison = compareEvaluationSummaries(before, after);
  assert.equal(comparison.before.rejectRate, 0.5);
  assert.equal(comparison.after.rejectRate, 0);
  assert.equal(comparison.deltas.factualErrors, -1);
  assert.equal(comparison.strategicIssues.after.questionable, 1);
});
