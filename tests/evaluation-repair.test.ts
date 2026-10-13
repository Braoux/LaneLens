import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  AnalysisConformanceFailure,
  type AnalysisConformanceViolation,
} from '../server/analysis/AnalysisConformanceValidator.js';
import { MatchupAnalysisError } from '../server/analysis/errors.js';
import { ProviderFailureError } from '../server/analysis/ProviderFailure.js';
import { RejectedAnalysisFailure } from '../server/analysis/RejectedAnalysisFailure.js';
import type { MatchupAnalysis } from '../server/analysis/types.js';
import { parseRepairArguments } from '../scripts/evaluation/repair-gameplay.js';
import { prepareRepairRunDirectory } from '../scripts/evaluation/repair-result-writer.js';
import {
  assertRepairableResults,
  executeRepairs,
  repairEligibilityIssues,
  selectRepairableResults,
} from '../scripts/evaluation/repair-runner.js';
import type { EvaluationProgress } from '../scripts/evaluation/runner.js';
import { buildRepairSummary } from '../scripts/evaluation/repair-summary.js';
import type { RepairResult, RepairRun } from '../scripts/evaluation/repair-types.js';
import type { EvaluationResult } from '../scripts/evaluation/types.js';

function analysis(text = 'Conseil invalide.'): MatchupAnalysis {
  return {
    matchup: {
      allyCarry: 'Ziggs', allySupport: 'Galio', enemyCarry: 'Jinx', enemySupport: 'Swain', patch: '26.19',
    },
    lanePlan: text,
    threatResponseWindow: {
      threat: 'Menace adverse.', response: 'Réponse prudente.', window: 'Fenêtre relative.', winCondition: 'Échange favorable.',
    },
    earlyLevels: { level1: 'Rester prudent.', level2: 'Avancer ensemble.', level3: 'Contrôler la zone.' },
    wavePlan: 'Garder une vague sûre.',
    targetPriority: { primaryTarget: 'Jinx', explanation: 'Punir la cible exposée.' },
    postLevel6: 'Respecter les ultimes.',
    roamPlan: 'Roam après la vague.',
    cheatSheet: ['Sort manqué → avancer'],
    goldenRule: 'Ne pas forcer sans fenêtre.',
  };
}

const initialViolation: AnalysisConformanceViolation = {
  code: 'ABILITY_EFFECT_MISMATCH', category: 'INVALID_ABILITY_EFFECT', severity: 'error', path: 'lanePlan',
};
const secondViolation: AnalysisConformanceViolation = {
  code: 'UNSUPPORTED_COOLDOWN_RESET', category: 'IMPOSSIBLE_INTERACTION', severity: 'error', path: 'wavePlan',
};

function source(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    id: 'LLC-001',
    input: { allyCarry: 'Ziggs', allySupport: 'Galio', enemyCarry: 'Jinx', enemySupport: 'Swain', patch: '26.19' },
    sentinel: true,
    status: 'invalid_analysis',
    startedAt: '2026-10-01T00:00:00.000Z',
    completedAt: '2026-10-01T00:00:01.000Z',
    candidateAnalysis: analysis(),
    violations: [initialViolation],
    attempts: [{ attempt: 1, startedAt: '2026-10-01T00:00:00.000Z', durationMs: 1000, outcome: 'invalid_analysis' }],
    ...overrides,
  };
}

function run(maxRepairs: 1 | 2 = 2): RepairRun {
  return {
    schemaVersion: 1,
    runId: 'repair-run',
    sourceRunId: 'source-run',
    sourceRunSha256: 'a',
    sourceResultsSha256: 'b',
    sourceCorpusFile: 'corpus.json',
    sourceCorpusVersion: '1.0.0',
    sourceCorpusSha256: 'c',
    sourceGitCommit: 'source-commit',
    repairGitCommit: 'repair-commit',
    sourceObservations: 100,
    sourceSuccess: 34,
    sourceInvalid: 66,
    selectedIds: ['LLC-001'],
    provider: 'fake',
    model: 'fake-model',
    knowledgeBaseVersion: 'kb-v1',
    maxRepairs,
    maxAttempts: 2,
    delayMs: 0,
    startedAt: '2026-10-01T00:00:00.000Z',
    completedAt: null,
  };
}

const patchResolver = {
  async resolve(patch: string) {
    return {
      status: 'ready' as const,
      context: { patch, contextVersion: 'test', facts: [{ subject: 'test', text: 'fact' }] },
    };
  },
};

async function files(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'lanelens-repair-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return prepareRepairRunDirectory(directory);
}

test('repair CLI accepts only one or two bounded passes and supports preflight', () => {
  assert.equal(parseRepairArguments(['--source', 'run', '--output', 'out']).maxRepairs, 1);
  assert.equal(parseRepairArguments(['--source', 'run', '--output', 'out', '--max-repairs', '2']).maxRepairs, 2);
  assert.equal(parseRepairArguments(['--source', 'run', '--preflight-only']).preflightOnly, true);
  assert.throws(() => parseRepairArguments(['--source', 'run', '--output', 'out', '--max-repairs', '0']), /entre 1 et 2/u);
  assert.throws(() => parseRepairArguments(['--source', 'run', '--output', 'out', '--max-repairs', '3']), /entre 1 et 2/u);
});

test('historical-style invalid results fail eligibility before any repair service exists', () => {
  const historical = source({ candidateAnalysis: undefined });
  assert.deepEqual(repairEligibilityIssues([historical]), [{ id: 'LLC-001', missing: ['candidateAnalysis'] }]);
  assert.throws(() => assertRepairableResults([historical]), /Aucun appel provider/u);
});

test('three incomplete observations do not block the other thirty-nine invalid analyses', () => {
  const incompleteIds = new Set(['L61-G01#5', 'L61-G05#5', 'L61-G10#5']);
  const invalid = Array.from({ length: 42 }, (_, index) => {
    const id = index === 4
      ? 'L61-G01#5'
      : index === 24
        ? 'L61-G05#5'
        : index === 41
          ? 'L61-G10#5'
          : `repairable-${index + 1}`;
    return source({
      id,
      ...(incompleteIds.has(id) ? { candidateAnalysis: undefined, violations: undefined } : {}),
    });
  });
  const selection = selectRepairableResults(invalid);
  assert.equal(selection.invalid.length, 42);
  assert.equal(selection.repairable.length, 39);
  assert.deepEqual(selection.issues.map(({ id }) => id), [...incompleteIds]);
  assert.equal(assertRepairableResults(invalid).length, 39);
});

test('ineligible invalid analyses are reported without blocking eligible repairs', async (t) => {
  const eligible = source();
  const ineligible = source({
    id: 'LLC-002',
    candidateAnalysis: undefined,
    violations: undefined,
  });
  const selection = selectRepairableResults([eligible, ineligible]);
  assert.deepEqual(selection.repairable.map(({ id }) => id), ['LLC-001']);
  assert.deepEqual(selection.issues, [{
    id: 'LLC-002',
    missing: ['candidateAnalysis', 'violations'],
  }]);
  assert.deepEqual(assertRepairableResults([eligible, ineligible]).map(({ id }) => id), ['LLC-001']);

  let calls = 0;
  const repairRun: RepairRun = {
    ...run(1),
    sourceInvalid: 2,
    ineligibleObservations: selection.issues,
  };
  const result = await executeRepairs({
    service: { async repair() { calls += 1; return analysis('Conseil corrigé.'); } },
    patchContextResolver: patchResolver,
    sourceResults: [eligible, ineligible],
    files: await files(t),
    run: repairRun,
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.results.map(({ id }) => id), ['LLC-001']);
  assert.equal(buildRepairSummary(result.run, result.results).ineligibleForRepair, 1);
});

test('one repair recovers an invalid analysis and produces comparative metrics', async (t) => {
  let calls = 0;
  const result = await executeRepairs({
    service: { async repair() { calls += 1; return analysis('Conseil corrigé.'); } },
    patchContextResolver: patchResolver,
    sourceResults: [source()],
    files: await files(t),
    run: run(1),
  });
  assert.equal(calls, 1);
  assert.equal(result.results[0]?.status, 'success');
  const summary = buildRepairSummary(result.run, result.results);
  assert.equal(summary.recoveredAfterFirst, 1);
  assert.deepEqual(summary.configurations.map(({ success }) => success), [34, 35]);
});

test('repair reports live completion progress through the evaluation loader contract', async (t) => {
  const sources = [source(), source({ id: 'LLC-002' })];
  const progress: EvaluationProgress[] = [];
  const result = await executeRepairs({
    service: { async repair() { return analysis('Conseil corrigé.'); } },
    patchContextResolver: patchResolver,
    sourceResults: sources,
    files: await files(t),
    run: {
      ...run(1),
      selectedIds: sources.map(({ id }) => id),
      sourceInvalid: sources.length,
    },
    onProgress: (state) => progress.push(state),
  });

  assert.equal(result.results.length, 2);
  assert.deepEqual(progress[0], { phase: 'preparing', completed: 0, total: 2 });
  assert.ok(progress.some((state) => (
    state.phase === 'repairing'
    && state.currentId === 'LLC-001'
    && state.repair === 1
    && state.maxRepairs === 1
    && state.attempt === 1
  )));
  assert.ok(progress.some((state) => state.phase === 'case_completed' && state.completed === 1));
  assert.deepEqual(progress.at(-1), { phase: 'completed', completed: 2, total: 2 });
});

test('a second repair uses the latest rejected candidate and preserves intermediate diagnostics', async (t) => {
  const seen: string[] = [];
  let calls = 0;
  const rejectedCandidate = analysis('Candidate après repair 1.');
  const service = {
    async repair(_input: unknown, candidate: MatchupAnalysis) {
      calls += 1;
      seen.push(candidate.lanePlan);
      if (calls === 1) {
        throw new MatchupAnalysisError('INVALID_ANALYSIS_RESPONSE', {
          cause: new RejectedAnalysisFailure({
            response: rejectedCandidate,
            phase: 'conformance',
            candidate: rejectedCandidate,
            conformanceViolations: [secondViolation],
            cause: new AnalysisConformanceFailure([secondViolation]),
          }),
        });
      }
      return analysis('Candidate finale.');
    },
  };
  const result = await executeRepairs({
    service,
    patchContextResolver: patchResolver,
    sourceResults: [source()],
    files: await files(t),
    run: run(2),
  });
  assert.deepEqual(seen, ['Conseil invalide.', 'Candidate après repair 1.']);
  assert.deepEqual(result.results[0]?.attempts.map(({ repair }) => repair), [1, 2]);
  assert.equal(result.results[0]?.attempts[0]?.violations?.[0]?.code, 'UNSUPPORTED_COOLDOWN_RESET');
  assert.equal(result.results[0]?.attempts[0]?.rejectionPhase, 'conformance');
  assert.equal(buildRepairSummary(result.run, result.results).recoveredAfterSecond, 1);
});

test('rate-limit retries stay inside one repair pass', async (t) => {
  let calls = 0;
  const result = await executeRepairs({
    service: {
      async repair() {
        calls += 1;
        if (calls === 1) {
          throw new MatchupAnalysisError('ANALYSIS_PROVIDER_UNAVAILABLE', {
            cause: new ProviderFailureError({ provider: 'fake', category: 'rate_limit', status: 429 }),
          });
        }
        return analysis('Corrigé.');
      },
    },
    patchContextResolver: patchResolver,
    sourceResults: [source()],
    files: await files(t),
    run: run(1),
    sleep: async () => {},
  });
  assert.deepEqual(result.results[0]?.attempts.map(({ repair, attempt, outcome }) => ({ repair, attempt, outcome })), [
    { repair: 1, attempt: 1, outcome: 'rate_limited' },
    { repair: 1, attempt: 2, outcome: 'success' },
  ]);
});

test('resume continues after a persisted invalid first pass without duplicating it', async (t) => {
  const initial: RepairResult = {
    id: 'LLC-001',
    matchupId: 'LLC-001',
    repetition: 1,
    input: source().input,
    sentinel: true,
    status: 'in_progress',
    startedAt: '2026-10-01T00:00:00.000Z',
    originalAnalysis: analysis(),
    initialViolations: [initialViolation],
    finalAnalysis: analysis('Après le premier repair.'),
    finalViolations: [secondViolation],
    attempts: [{
      repair: 1,
      attempt: 1,
      startedAt: '2026-10-01T00:00:01.000Z',
      durationMs: 100,
      outcome: 'invalid_analysis',
      candidateAnalysis: analysis('Après le premier repair.'),
      violations: [secondViolation],
    }],
  };
  let calls = 0;
  const result = await executeRepairs({
    service: { async repair() { calls += 1; return analysis('Final.'); } },
    patchContextResolver: patchResolver,
    sourceResults: [source()],
    files: await files(t),
    run: run(2),
    initialResults: [initial],
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.results[0]?.attempts.map(({ repair }) => repair), [1, 2]);
});

test('unresolved repairs remain invalid and report remaining violations and regressions', async (t) => {
  const regressed = analysis('Toujours invalide.');
  const result = await executeRepairs({
    service: {
      async repair() {
        throw new MatchupAnalysisError('INVALID_ANALYSIS_RESPONSE', {
          cause: new RejectedAnalysisFailure({
            response: regressed,
            phase: 'conformance',
            candidate: regressed,
            conformanceViolations: [secondViolation],
            cause: new AnalysisConformanceFailure([secondViolation]),
          }),
        });
      },
    },
    patchContextResolver: patchResolver,
    sourceResults: [source()],
    files: await files(t),
    run: run(1),
  });
  assert.equal(result.results[0]?.status, 'invalid_analysis');
  const summary = buildRepairSummary(result.run, result.results);
  assert.equal(summary.violationsRemaining.UNSUPPORTED_COOLDOWN_RESET, 1);
  assert.equal(summary.regressionsIntroduced.UNSUPPORTED_COOLDOWN_RESET, 1);
  assert.equal(summary.violationsFixed.ABILITY_EFFECT_MISMATCH, 1);
});
