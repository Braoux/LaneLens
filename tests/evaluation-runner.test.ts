import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AnalysisConformanceFailure } from '../server/analysis/AnalysisConformanceValidator.js';
import { MatchupAnalysisError } from '../server/analysis/errors.js';
import type {
  MatchupAnalysisProvider,
  MatchupAnalysisProviderOptions,
} from '../server/analysis/MatchupAnalysisProvider.js';
import { MatchupAnalysisService } from '../server/analysis/MatchupAnalysisService.js';
import { ProviderFailureError } from '../server/analysis/ProviderFailure.js';
import type { MatchupAnalysis, MatchupAnalysisProviderRequest } from '../server/analysis/types.js';
import { VersionedPatchContextResolver } from '../server/patch-context/VersionedPatchContextResolver.js';
import {
  EvaluationCorpusError,
  loadEvaluationCorpus,
  parseEvaluationCorpus,
  selectCorpusMatchups,
} from '../scripts/evaluation/corpus.js';
import {
  DEFAULT_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
  parseEvaluationArguments,
} from '../scripts/evaluation/evaluate-gameplay.js';
import {
  loadEvaluationRun,
  prepareNewRunDirectory,
  replaceFileSafely,
} from '../scripts/evaluation/result-writer.js';
import { ConsoleEvaluationProgress } from '../scripts/evaluation/progress.js';
import { executeEvaluation, type EvaluationProgress } from '../scripts/evaluation/runner.js';
import type {
  CorpusMatchup,
  EvaluationCorpus,
  EvaluationResult,
  EvaluationRun,
} from '../scripts/evaluation/types.js';

const matchups: CorpusMatchup[] = [
  {
    id: 'LLC-001',
    patch: '26.19',
    ally: { carry: 'Jinx', support: 'Thresh' },
    enemy: { carry: 'Caitlyn', support: 'Lux' },
    tags: ['range'],
    sentinel: true,
  },
  {
    id: 'LLC-002',
    patch: '26.19',
    ally: { carry: 'Ezreal', support: 'Karma' },
    enemy: { carry: 'Jhin', support: 'Nautilus' },
    tags: ['poke'],
    sentinel: false,
  },
];

const corpus: EvaluationCorpus = {
  schemaVersion: 1,
  corpusVersion: '1.0.0',
  patch: '26.19',
  frozen: true,
  matchups,
};

function corpusJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    corpusVersion: '1.0.0',
    patch: '26.19',
    frozen: true,
    matchups,
    ...overrides,
  });
}

function validAnalysis(request: MatchupAnalysisProviderRequest): MatchupAnalysis {
  const { input } = request;
  return {
    matchup: {
      allyCarry: input.allyCarry,
      allySupport: input.allySupport,
      enemyCarry: input.enemyCarry,
      enemySupport: input.enemySupport,
      patch: input.patch,
    },
    lanePlan: 'Jouer avec la portée disponible et rester coordonnés.',
    threatResponseWindow: {
      threat: 'La botlane adverse peut prendre l’espace.',
      response: 'Rester groupés et répondre ensemble.',
      window: 'Après une tentative adverse manquée.',
      winCondition: 'Obtenir un échange favorable sans forcer.',
    },
    earlyLevels: {
      level1: 'Contester seulement avec une position sûre.',
      level2: 'Respecter la menace adverse si elle avance.',
      level3: 'Coordonner la pression avec la vague.',
    },
    wavePlan: 'Garder une vague jouable et éviter une exposition inutile.',
    targetPriority: {
      primaryTarget: input.enemySupport,
      explanation: 'Punir la cible exposée sans traverser la botlane adverse.',
    },
    postLevel6: 'Conserver une réponse défensive avant de forcer.',
    roamPlan: 'Roam uniquement après une vague sécurisée.',
    cheatSheet: ['Tentative adverse manquée → reprendre l’espace'],
    goldenRule: 'Ne pas engager sans fenêtre observable.',
  };
}

function run(selectedIds = matchups.map(({ id }) => id)): EvaluationRun {
  return {
    schemaVersion: 1,
    runId: 'test-run',
    corpusSchemaVersion: 1,
    corpusVersion: '1.0.0',
    corpusSha256: 'abc',
    corpusFile: 'corpus.json',
    patch: '26.19',
    gitCommit: 'deadbeef',
    provider: 'fake',
    model: 'fake-model',
    startedAt: '2026-09-28T10:00:00.000Z',
    completedAt: null,
    mode: selectedIds.length === 1 ? 'single' : 'full',
    selectedIds,
    delayMs: 0,
    maxAttempts: 3,
    knowledgeBaseVersion: null,
  };
}

async function temporaryRun(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'lanelens-eval-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, files: await prepareNewRunDirectory(directory) };
}

test('corpus parsing validates schema, JSON, files, and duplicate IDs', async (t) => {
  assert.deepEqual(parseEvaluationCorpus(corpusJson()), corpus);
  assert.throws(() => parseEvaluationCorpus('{'), EvaluationCorpusError);
  assert.throws(() => parseEvaluationCorpus(corpusJson({ schemaVersion: 2 })), /schemaVersion/u);
  assert.throws(
    () => parseEvaluationCorpus(corpusJson({ matchups: [matchups[0], matchups[0]] })),
    /dupliqué/u,
  );

  const directory = await mkdtemp(join(tmpdir(), 'lanelens-corpus-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(loadEvaluationCorpus(join(directory, 'absent.json')), /introuvable/u);
  const path = join(directory, 'corpus.json');
  await writeFile(path, corpusJson(), 'utf8');
  const loaded = await loadEvaluationCorpus(path);
  assert.equal(loaded.corpus.matchups.length, 2);
  assert.match(loaded.sha256, /^[a-f0-9]{64}$/u);
});

test('a new run never overwrites a non-empty output directory', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lanelens-output-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'existing.json'), '{}', 'utf8');
  await assert.rejects(prepareNewRunDirectory(directory), /n’est pas vide/u);
});

test('atomic replacement retries transient Windows EBUSY errors', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lanelens-windows-retry-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, 'summary.json');
  const temporary = join(directory, 'summary.json.tmp');
  await writeFile(target, '{"value":"old"}', 'utf8');
  await writeFile(temporary, '{"value":"new"}', 'utf8');
  const waits: number[] = [];
  let attempts = 0;

  await replaceFileSafely(temporary, target, {
    async renameFile(from, to) {
      attempts += 1;
      if (attempts <= 2) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      await rename(from, to);
    },
    sleep: async (durationMs) => { waits.push(durationMs); },
  });

  assert.equal(attempts, 3);
  assert.deepEqual(waits, [10, 25]);
  assert.equal(await readFile(target, 'utf8'), '{"value":"new"}');
});

test('atomic replacement falls back to a recoverable Windows backup swap after EPERM', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lanelens-windows-swap-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, 'summary.json');
  const temporary = join(directory, 'summary.json.tmp');
  await writeFile(target, '{"value":"old"}', 'utf8');
  await writeFile(temporary, '{"value":"new"}', 'utf8');
  const waits: number[] = [];
  let directAttempts = 0;
  let targetMovedToBackup = false;

  await replaceFileSafely(temporary, target, {
    async renameFile(from, to) {
      if (from === temporary && to === target && !targetMovedToBackup) {
        directAttempts += 1;
        throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      }
      if (from === target && String(to).endsWith('.bak')) targetMovedToBackup = true;
      await rename(from, to);
    },
    sleep: async (durationMs) => { waits.push(durationMs); },
    randomId: () => 'test-backup',
  });

  assert.equal(directAttempts, 6);
  assert.deepEqual(waits, [10, 25, 50, 100, 200]);
  assert.equal(await readFile(target, 'utf8'), '{"value":"new"}');
  assert.deepEqual(await readdir(directory), ['summary.json']);
});

test('atomic replacement restores the previous snapshot when the backup swap cannot finish', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lanelens-windows-restore-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, 'summary.json');
  const temporary = join(directory, 'summary.json.tmp');
  await writeFile(target, '{"value":"old"}', 'utf8');
  await writeFile(temporary, '{"value":"new"}', 'utf8');
  let targetMovedToBackup = false;

  await assert.rejects(replaceFileSafely(temporary, target, {
    async renameFile(from, to) {
      if (from === temporary && to === target) {
        throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      }
      if (from === target && String(to).endsWith('.bak')) targetMovedToBackup = true;
      await rename(from, to);
    },
    sleep: async () => {},
    randomId: () => 'test-backup',
  }), /operation not permitted/u);

  assert.equal(targetMovedToBackup, true);
  assert.equal(await readFile(target, 'utf8'), '{"value":"old"}');
  assert.equal(await readFile(temporary, 'utf8'), '{"value":"new"}');
});

test('corpus selection supports full, sentinels, and one explicit ID', () => {
  assert.deepEqual(selectCorpusMatchups(corpus, { sentinels: false }).matchups, matchups);
  assert.deepEqual(
    selectCorpusMatchups(corpus, { sentinels: true }).matchups.map(({ id }) => id),
    ['LLC-001'],
  );
  assert.deepEqual(
    selectCorpusMatchups(corpus, { sentinels: false, id: 'LLC-002' }).matchups.map(({ id }) => id),
    ['LLC-002'],
  );
  assert.throws(
    () => selectCorpusMatchups(corpus, { sentinels: false, id: 'LLC-999' }),
    /inexistant/u,
  );
});

test('CLI parsing applies safe defaults and rejects ambiguous resume options', () => {
  assert.deepEqual(parseEvaluationArguments(['--corpus', 'corpus.json']), {
    corpus: 'corpus.json',
    sentinels: false,
    delayMs: DEFAULT_DELAY_MS,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    delayProvided: false,
    maxAttemptsProvided: false,
  });
  assert.equal(
    parseEvaluationArguments(['--corpus', 'c.json', '--sentinels', '--delay-ms', '0']).sentinels,
    true,
  );
  assert.throws(() => parseEvaluationArguments([]), /--corpus/u);
  assert.throws(
    () => parseEvaluationArguments(['--corpus', 'c.json', '--resume', 'run', '--id', 'LLC-001']),
    /ne peut pas/u,
  );
  assert.throws(
    () => parseEvaluationArguments(['--corpus', 'c.json', '--max-attempts', '11']),
    /dépasser 10/u,
  );
  assert.throws(
    () => parseEvaluationArguments(['--corpus', 'c.json', '--delay-ms', '3600001']),
    /3600000/u,
  );
});

test('runner executes sequentially, continues after failures, and writes a summary', async (t) => {
  const { files } = await temporaryRun(t);
  const calls: string[] = [];
  let inFlight = 0;
  let maximumInFlight = 0;
  const provider: MatchupAnalysisProvider = {
    async analyze(request) {
      calls.push(request.input.allyCarry);
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return request.input.allyCarry === 'Ezreal' ? {} : validAnalysis(request);
    },
  };
  const result = await executeEvaluation({
    service: new MatchupAnalysisService(provider),
    patchContextResolver: new VersionedPatchContextResolver(),
    matchups,
    files,
    run: run(),
    sleep: async () => {},
  });

  assert.deepEqual(calls, ['Jinx', 'Ezreal']);
  assert.equal(maximumInFlight, 1);
  assert.deepEqual(result.results.map(({ status }) => status), ['success', 'invalid_analysis']);
  const summary = JSON.parse(await readFile(files.summary, 'utf8')) as Record<string, unknown>;
  assert.equal(summary.completed, 2);
  assert.equal(summary.gameplayEvaluable, 2);
  assert.equal(summary.success, 1);
  assert.equal(summary.invalidAnalysis, 1);
});

test('provider errors stay non-gameplay and structured conformance violations are preserved', async (t) => {
  const { files } = await temporaryRun(t);
  let calls = 0;
  const service = {
    async analyze() {
      calls += 1;
      if (calls === 1) {
        throw new MatchupAnalysisError('INVALID_ANALYSIS_RESPONSE', {
          cause: new AnalysisConformanceFailure([{
            code: 'ABILITY_CHAMPION_MISMATCH',
            severity: 'error',
            path: 'earlyLevels.level2',
          }]),
        });
      }
      throw new MatchupAnalysisError('ANALYSIS_PROVIDER_UNAVAILABLE', {
        cause: new ProviderFailureError({
          provider: 'fake',
          category: 'provider_server_error',
          status: 503,
          errorMessage: 'secret=must-not-be-written',
        }),
      });
    },
  };
  await executeEvaluation({
    service,
    patchContextResolver: new VersionedPatchContextResolver(),
    matchups,
    files,
    run: run(),
    sleep: async () => {},
  });
  const persisted = await loadEvaluationRun(files.directory);
  assert.deepEqual(persisted.results.map(({ status }) => status), [
    'invalid_analysis',
    'provider_error',
  ]);
  assert.deepEqual(persisted.results[0]?.violations, [{
    code: 'ABILITY_CHAMPION_MISMATCH',
    severity: 'error',
    path: 'earlyLevels.level2',
  }]);
  const text = await readFile(files.results, 'utf8');
  assert.doesNotMatch(text, /must-not-be-written|secret=/u);
  const summary = JSON.parse(await readFile(files.summary, 'utf8')) as Record<string, unknown>;
  assert.equal(summary.gameplayEvaluable, 1);
  assert.equal(summary.invalidAnalysis, 1);
  assert.equal(summary.providerErrors, 1);
});

test('rate limits honor retry-after, remain traceable, and do not bias gameplay errors', async (t) => {
  const { files } = await temporaryRun(t);
  const waits: number[] = [];
  let callCount = 0;
  const provider: MatchupAnalysisProvider = {
    async analyze(request, options?: MatchupAnalysisProviderOptions) {
      callCount += 1;
      if (callCount === 1) {
        throw new ProviderFailureError({
          provider: 'fake',
          model: 'fake-model',
          category: 'rate_limit',
          status: 429,
          errorMessage: 'api_key=must-not-be-persisted',
          retryMetadata: {
            retryAfterMs: 1_500,
            rateLimitRemainingRequests: 0,
          },
        });
      }
      options?.onMetadata?.({ rateLimitRemainingRequests: 9 });
      return validAnalysis(request);
    },
  };
  await executeEvaluation({
    service: new MatchupAnalysisService(provider),
    patchContextResolver: new VersionedPatchContextResolver(),
    matchups: [matchups[0]!],
    files,
    run: run(['LLC-001']),
    sleep: async (durationMs) => { waits.push(durationMs); },
    random: () => 0,
  });

  const persisted = await loadEvaluationRun(files.directory);
  assert.equal(persisted.results[0]?.status, 'success');
  assert.deepEqual(persisted.results[0]?.attempts.map(({ outcome }) => outcome), [
    'rate_limited',
    'success',
  ]);
  assert.equal(persisted.results[0]?.attempts[0]?.retryAfterMs, 1_500);
  assert.equal(persisted.results[0]?.attempts[1]?.rateLimitRemainingRequests, 9);
  assert.deepEqual(waits, [1_500]);
  const persistedText = await readFile(files.results, 'utf8');
  assert.doesNotMatch(persistedText, /must-not-be-persisted|api_key/u);
  const summary = JSON.parse(await readFile(files.summary, 'utf8')) as Record<string, unknown>;
  assert.equal(summary.success, 1);
  assert.equal(summary.rateLimited, 0);
  assert.equal(summary.retryCount, 1);
});

test('exhausted rate limits are non-evaluable and use bounded exponential fallback', async (t) => {
  const { files } = await temporaryRun(t);
  const waits: number[] = [];
  const provider: MatchupAnalysisProvider = {
    async analyze() {
      throw new ProviderFailureError({
        provider: 'fake',
        category: 'rate_limit',
        status: 429,
      });
    },
  };
  await executeEvaluation({
    service: new MatchupAnalysisService(provider),
    patchContextResolver: new VersionedPatchContextResolver(),
    matchups: [matchups[0]!],
    files,
    run: { ...run(['LLC-001']), maxAttempts: 3 },
    sleep: async (durationMs) => { waits.push(durationMs); },
    random: () => 0,
  });
  const persisted = await loadEvaluationRun(files.directory);
  assert.equal(persisted.results[0]?.status, 'rate_limited');
  assert.deepEqual(waits, [2_000, 4_000]);
  const summary = JSON.parse(await readFile(files.summary, 'utf8')) as Record<string, unknown>;
  assert.equal(summary.gameplayEvaluable, 0);
  assert.equal(summary.rateLimited, 1);
  assert.equal(summary.invalidAnalysis, 0);
});

test('resume skips terminal cases and continues traceable in-progress attempts', async (t) => {
  const { files } = await temporaryRun(t);
  const previous: EvaluationResult = {
    id: 'LLC-001',
    input: {
      allyCarry: 'Jinx',
      allySupport: 'Thresh',
      enemyCarry: 'Caitlyn',
      enemySupport: 'Lux',
      patch: '26.19',
    },
    sentinel: true,
    status: 'success',
    startedAt: '2026-09-28T10:00:00.000Z',
    completedAt: '2026-09-28T10:00:01.000Z',
    durationMs: 1_000,
    analysis: validAnalysis({
      input: {
        allyCarry: 'Jinx', allySupport: 'Thresh', enemyCarry: 'Caitlyn', enemySupport: 'Lux',
        patch: '26.19', locale: 'fr-FR', patchContext: { patch: '26.19', contextVersion: 'x', facts: [] },
      },
      instructions: '',
    }),
    attempts: [{
      attempt: 1,
      startedAt: '2026-09-28T10:00:00.000Z',
      durationMs: 1_000,
      outcome: 'success',
    }],
  };
  const calls: string[] = [];
  const provider: MatchupAnalysisProvider = {
    async analyze(request) {
      calls.push(request.input.allyCarry);
      return validAnalysis(request);
    },
  };
  const resumed = await executeEvaluation({
    service: new MatchupAnalysisService(provider),
    patchContextResolver: new VersionedPatchContextResolver(),
    matchups,
    files,
    run: run(),
    initialResults: [previous],
    sleep: async () => {},
  });
  assert.deepEqual(calls, ['Ezreal']);
  assert.equal(resumed.run.runId, 'test-run');
  assert.equal(resumed.run.startedAt, '2026-09-28T10:00:00.000Z');
  assert.deepEqual(resumed.results.map(({ status }) => status), ['success', 'success']);
});

test('resume preserves LLC-001..031, resumes LLC-032, and continues through LLC-100', async (t) => {
  const { files } = await temporaryRun(t);
  const fullMatchups: CorpusMatchup[] = Array.from({ length: 100 }, (_, index) => {
    const id = `LLC-${String(index + 1).padStart(3, '0')}`;
    return {
      id,
      patch: '26.19',
      ally: { carry: id, support: 'Support allié' },
      enemy: { carry: 'Carry adverse', support: 'Support adverse' },
      tags: ['resume'],
      sentinel: index < 25,
    };
  });
  const selectedIds = fullMatchups.map(({ id }) => id);
  const terminalResults: EvaluationResult[] = fullMatchups.slice(0, 31).map((matchup) => {
    const input = {
      allyCarry: matchup.ally.carry,
      allySupport: matchup.ally.support,
      enemyCarry: matchup.enemy.carry,
      enemySupport: matchup.enemy.support,
      patch: matchup.patch,
    };
    return {
      id: matchup.id,
      input,
      sentinel: matchup.sentinel,
      status: 'success',
      startedAt: '2026-09-28T10:00:00.000Z',
      completedAt: '2026-09-28T10:00:01.000Z',
      durationMs: 1_000,
      analysis: validAnalysis({
        input: {
          ...input,
          locale: 'fr-FR',
          patchContext: { patch: '26.19', contextVersion: '26.19-v1', facts: [] },
        },
        instructions: '',
      }),
      attempts: [{
        attempt: 1,
        startedAt: '2026-09-28T10:00:00.000Z',
        durationMs: 1_000,
        outcome: 'success',
      }],
    };
  });
  const interrupted: EvaluationResult = {
    id: 'LLC-032',
    input: {
      allyCarry: 'LLC-032',
      allySupport: 'Support allié',
      enemyCarry: 'Carry adverse',
      enemySupport: 'Support adverse',
      patch: '26.19',
    },
    sentinel: false,
    status: 'in_progress',
    startedAt: '2026-09-28T10:31:00.000Z',
    attempts: [{
      attempt: 1,
      startedAt: '2026-09-28T10:31:00.000Z',
      durationMs: 500,
      outcome: 'rate_limited',
      httpStatus: 429,
      retryAfterMs: 2_000,
    }],
  };
  const calls: string[] = [];
  const progress: EvaluationProgress[] = [];
  const service = {
    async analyze(input: MatchupAnalysisProviderRequest['input']) {
      calls.push(input.allyCarry);
      return validAnalysis({ input, instructions: '' });
    },
  };

  await executeEvaluation({
    service,
    patchContextResolver: new VersionedPatchContextResolver(),
    matchups: fullMatchups,
    files,
    run: { ...run(selectedIds), delayMs: 0 },
    initialResults: [...terminalResults, interrupted],
    sleep: async () => {},
    onProgress: (state) => progress.push(state),
  });

  assert.equal(progress[0]?.completed, 31);
  assert.equal(progress[0]?.total, 100);
  assert.ok(progress.some((state) => (
    state.phase === 'analyzing'
    && state.currentId === 'LLC-032'
    && state.completed === 31
    && state.attempt === 2
  )));
  assert.deepEqual(progress.at(-1), {
    phase: 'completed',
    completed: 100,
    total: 100,
  });
  assert.equal(calls.length, 69);
  assert.deepEqual(calls, selectedIds.slice(31));
  assert.ok(calls.every((id) => !selectedIds.slice(0, 31).includes(id)));
  const persisted = await loadEvaluationRun(files.directory);
  assert.equal(persisted.results.length, 100);
  assert.ok(persisted.results.every(({ status }) => status === 'success'));
  assert.deepEqual(persisted.results[31]?.attempts.map(({ outcome }) => outcome), [
    'rate_limited',
    'success',
  ]);
  assert.equal(persisted.results[0]?.attempts.length, 1);
  assert.equal(persisted.results[30]?.attempts.length, 1);
  const summary = JSON.parse(await readFile(files.summary, 'utf8')) as Record<string, unknown>;
  assert.equal(summary.completed, 100);
  assert.equal(summary.success, 100);
  assert.equal(summary.retryCount, 1);
});

test('console progress rewrites one TTY line with percentage, current case, and activity', () => {
  const chunks: string[] = [];
  let now = 1_000;
  const output = {
    isTTY: true,
    columns: 120,
    write(chunk: string) { chunks.push(chunk); },
  };
  const progress = new ConsoleEvaluationProgress({
    output,
    refreshMs: 60_000,
    now: () => now,
  });

  progress.update({
    phase: 'analyzing',
    completed: 46,
    total: 100,
    currentId: 'LLC-047',
    attempt: 2,
    maxAttempts: 3,
  });
  now += 2_000;
  progress.update({
    phase: 'waiting_rate_limit',
    completed: 46,
    total: 100,
    currentId: 'LLC-047',
    attempt: 2,
    maxAttempts: 3,
    waitMs: 10_000,
  });
  progress.finish();

  const rendered = chunks.join('');
  assert.match(rendered, /46% · 46\/100 · LLC-047/u);
  assert.match(rendered, /analyse · tentative 2\/3/u);
  assert.match(rendered, /attente rate limit/u);
  assert.ok(chunks.filter((chunk) => chunk.includes('\n')).length === 1);
  assert.ok(chunks.filter((chunk) => chunk.includes('LLC-047')).every(
    (chunk) => chunk.startsWith('\u001B[2K\r'),
  ));
});

test('a failing progress observer never interrupts the evaluation', async (t) => {
  const { files } = await temporaryRun(t);
  let calls = 0;
  const service = {
    async analyze(input: MatchupAnalysisProviderRequest['input']) {
      calls += 1;
      return validAnalysis({ input, instructions: '' });
    },
  };

  const completed = await executeEvaluation({
    service,
    patchContextResolver: new VersionedPatchContextResolver(),
    matchups: [matchups[0]!],
    files,
    run: run(['LLC-001']),
    sleep: async () => {},
    onProgress() { throw new Error('terminal closed'); },
  });

  assert.equal(calls, 1);
  assert.equal(completed.results[0]?.status, 'success');
});
