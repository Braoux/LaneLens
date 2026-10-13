import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
  interactiveMain,
  knowledgeBaseVersionForChoice,
  launchNewEvaluation,
  repairPassesForChoice,
  repeatForInput,
  runDirectoryForInput,
  type MenuIO,
} from '../scripts/evaluation/interactive-runner.js';
import {
  CURRENT_KNOWLEDGE_BASE_VERSION,
  EvaluationLauncherError,
  assertCompatibleNodeVersion,
  assertMatchupExists,
  assertNewOutputPath,
  buildEvaluationArguments,
  buildRepairArguments,
  createRepairOutputPath,
  createRunOutputPath,
  discoverCorpusPath,
  discoverEvaluationRuns,
  discoverRepairRuns,
  formatEvaluationConfiguration,
  latestIncompleteRun,
  latestIncompleteRepairRun,
  preflightEvaluation,
  preflightKnowledgeCoverage,
  preflightProvider,
  resolveResultsRoot,
  saveLauncherConfig,
} from '../scripts/evaluation/launcher.js';

const corpusValue = {
  schemaVersion: 1,
  corpusVersion: '1.0.0',
  patch: '26.19',
  frozen: true,
  rules: { expectedMatchups: 2, expectedSentinels: 1 },
  matchups: [
    {
      id: 'LLC-001', patch: '26.19',
      ally: { carry: 'Jinx', support: 'Thresh' }, enemy: { carry: 'Caitlyn', support: 'Lux' },
      tags: ['baseline'], sentinel: true,
    },
    {
      id: 'LLC-002', patch: '26.19',
      ally: { carry: 'Ashe', support: 'Leona' }, enemy: { carry: 'Ezreal', support: 'Karma' },
      tags: ['range'], sentinel: false,
    },
  ],
};

async function tempDirectory(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lanelens-launcher-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeCorpus(directory: string): Promise<string> {
  const path = join(directory, 'corpus.json');
  await writeFile(path, JSON.stringify(corpusValue), 'utf8');
  return path;
}

async function writeRun(options: {
  directory: string;
  completed: number;
  completedAt?: string | null;
  updatedAt: Date;
  knowledgeBaseVersion?: string | null;
  repairableInvalid?: boolean;
}): Promise<void> {
  await mkdir(options.directory, { recursive: true });
  const selectedIds = ['LLC-001', 'LLC-002'];
  const results = selectedIds.slice(0, options.completed).map((id, index) => ({
    id,
    input: { allyCarry: 'Jinx', allySupport: 'Thresh', enemyCarry: 'Caitlyn', enemySupport: 'Lux', patch: '26.19' },
    sentinel: index === 0,
    status: index === 0 ? 'success' : 'invalid_analysis',
    startedAt: '2026-09-30T10:00:00.000Z',
    completedAt: '2026-09-30T10:00:01.000Z',
    attempts: [],
    ...(index === 1 && options.repairableInvalid ? {
      candidateAnalysis: {
        matchup: { allyCarry: 'Jinx', allySupport: 'Thresh', enemyCarry: 'Caitlyn', enemySupport: 'Lux', patch: '26.19' },
        lanePlan: 'Plan invalide.',
        threatResponseWindow: { threat: 'Menace.', response: 'Réponse.', window: 'Fenêtre.', winCondition: 'Condition.' },
        earlyLevels: { level1: 'Prudent.', level2: 'Ensemble.', level3: 'Contrôle.' },
        wavePlan: 'Plan de vague.',
        targetPriority: { primaryTarget: 'Caitlyn', explanation: 'Cible exposée.' },
        postLevel6: 'Respecter les ultimes.',
        roamPlan: 'Roam après la vague.',
        cheatSheet: ['Attendre une fenêtre.'],
        goldenRule: 'Ne pas forcer.',
      },
      violations: [{ code: 'ABILITY_EFFECT_MISMATCH', category: 'INVALID_ABILITY_EFFECT', severity: 'error', path: 'lanePlan' }],
    } : {}),
  }));
  const run = {
    schemaVersion: 1,
    runId: `run-${options.completed}`,
    corpusSchemaVersion: 1,
    corpusVersion: '1.0.0',
    corpusSha256: 'fixture',
    corpusFile: 'corpus.json',
    patch: '26.19',
    gitCommit: 'test',
    provider: 'groq',
    model: 'test-model',
    startedAt: '2026-09-30T10:00:00.000Z',
    completedAt: options.completedAt ?? null,
    mode: 'full',
    selectedIds,
    delayMs: 0,
    maxAttempts: 1,
    knowledgeBaseVersion: options.knowledgeBaseVersion ?? null,
  };
  const files = [
    ['run.json', run],
    ['results.json', { schemaVersion: 1, results }],
    ['summary.json', { total: 2, completed: options.completed }],
  ] as const;
  for (const [name, value] of files) {
    const path = join(options.directory, name);
    await writeFile(path, JSON.stringify(value), 'utf8');
    await utimes(path, options.updatedAt, options.updatedAt);
  }
}

async function writeRepairRun(options: {
  directory: string;
  sourceRunId: string;
  complete: boolean;
  updatedAt: Date;
}): Promise<void> {
  await mkdir(options.directory, { recursive: true });
  const run = {
    schemaVersion: 1,
    runId: `repair-${options.sourceRunId}`,
    sourceRunId: options.sourceRunId,
    sourceRunSha256: 'source-run-hash',
    sourceResultsSha256: 'source-results-hash',
    sourceCorpusFile: 'corpus.json',
    sourceCorpusVersion: '1.0.0',
    sourceCorpusSha256: 'corpus-hash',
    sourceGitCommit: 'source-commit',
    repairGitCommit: 'repair-commit',
    sourceObservations: 2,
    sourceSuccess: 1,
    sourceInvalid: 1,
    selectedIds: ['LLC-002'],
    provider: 'groq',
    model: 'test-model',
    knowledgeBaseVersion: null,
    maxRepairs: 2,
    maxAttempts: 3,
    delayMs: 0,
    startedAt: '2026-09-30T12:00:00.000Z',
    completedAt: options.complete ? '2026-09-30T12:00:01.000Z' : null,
  };
  const results = options.complete ? [{
    id: 'LLC-002', matchupId: 'LLC-002', repetition: 1,
    input: { allyCarry: 'Jinx', allySupport: 'Thresh', enemyCarry: 'Caitlyn', enemySupport: 'Lux', patch: '26.19' },
    sentinel: false, status: 'success', startedAt: run.startedAt, completedAt: run.completedAt,
    originalAnalysis: {}, initialViolations: [], finalAnalysis: {}, attempts: [],
  }] : [{
    id: 'LLC-002', matchupId: 'LLC-002', repetition: 1,
    input: { allyCarry: 'Jinx', allySupport: 'Thresh', enemyCarry: 'Caitlyn', enemySupport: 'Lux', patch: '26.19' },
    sentinel: false, status: 'in_progress', startedAt: run.startedAt,
    originalAnalysis: {}, initialViolations: [], attempts: [],
  }];
  for (const [name, value] of [
    ['repair-run.json', run],
    ['repair-results.json', { schemaVersion: 1, results }],
    ['repair-summary.json', { completed: options.complete ? 1 : 0 }],
  ] as const) {
    const path = join(options.directory, name);
    await writeFile(path, JSON.stringify(value), 'utf8');
    await utimes(path, options.updatedAt, options.updatedAt);
  }
}

test('launcher discovers runs, identifies completion, and selects the latest incomplete run', async (t) => {
  const root = await tempDirectory(t);
  const older = join(root, 'pre-kb', 'older');
  const latest = join(root, 'post-kb', 'latest');
  const complete = join(root, 'complete');
  await writeRun({ directory: older, completed: 0, updatedAt: new Date('2026-09-30T10:00:00Z') });
  await writeRun({ directory: latest, completed: 1, updatedAt: new Date('2026-09-30T12:00:00Z') });
  await writeRun({ directory: complete, completed: 2, completedAt: '2026-09-30T11:00:00Z', updatedAt: new Date('2026-09-30T11:00:00Z') });

  const runs = await discoverEvaluationRuns([root]);
  assert.equal(runs.length, 3);
  assert.equal(runs[0]?.directory, resolve(latest));
  assert.equal(runs.find(({ directory }) => directory === resolve(complete))?.isComplete, true);
  assert.equal(latestIncompleteRun(runs)?.directory, resolve(latest));
  assert.deepEqual(
    { completed: runs[0]?.completed, remaining: runs[0]?.remaining, success: runs[0]?.success, failed: runs[0]?.failed },
    { completed: 1, remaining: 1, success: 1, failed: 0 },
  );
});

test('launcher builds exact existing runner arguments for every execution mode', () => {
  const corpus = resolve('corpus.json');
  const output = resolve('output');
  const resume = resolve('resume');
  assert.deepEqual(buildEvaluationArguments({
    mode: 'full', corpusPath: corpus, outputDirectory: output, knowledgeBaseVersion: null,
  }), [
    '--corpus', corpus, '--output', output,
  ]);
  assert.deepEqual(buildEvaluationArguments({
    mode: 'full', corpusPath: corpus, outputDirectory: output, knowledgeBaseVersion: null, repeat: 5,
  }), [
    '--corpus', corpus, '--output', output, '--repeat', '5',
  ]);
  assert.deepEqual(buildEvaluationArguments({
    mode: 'sentinels', corpusPath: corpus, outputDirectory: output, knowledgeBaseVersion: null,
  }), [
    '--corpus', corpus, '--output', output, '--sentinels',
  ]);
  assert.deepEqual(buildEvaluationArguments({
    mode: 'sentinels', corpusPath: corpus, outputDirectory: output,
    knowledgeBaseVersion: CURRENT_KNOWLEDGE_BASE_VERSION,
  }), [
    '--corpus', corpus, '--output', output, '--sentinels',
    '--knowledge-base-version', CURRENT_KNOWLEDGE_BASE_VERSION,
  ]);
  assert.deepEqual(buildEvaluationArguments({
    mode: 'single', corpusPath: corpus, outputDirectory: output,
    matchupId: 'LLC-009', knowledgeBaseVersion: null,
  }), [
    '--corpus', corpus, '--output', output, '--id', 'LLC-009',
  ]);
  assert.deepEqual(buildEvaluationArguments({
    mode: 'resume', corpusPath: corpus, resumeDirectory: resume, knowledgeBaseVersion: null,
  }), [
    '--corpus', corpus, '--resume', resume,
  ]);
  assert.deepEqual(buildEvaluationArguments({
    mode: 'resume', corpusPath: corpus, resumeDirectory: resume,
    knowledgeBaseVersion: CURRENT_KNOWLEDGE_BASE_VERSION,
  }), [
    '--corpus', corpus, '--resume', resume,
    '--knowledge-base-version', CURRENT_KNOWLEDGE_BASE_VERSION,
  ]);
  assert.deepEqual(buildRepairArguments({
    sourceDirectory: output, outputDirectory: resume, maxRepairs: 2,
  }), ['--source', output, '--output', resume, '--max-repairs', '2']);
  assert.deepEqual(buildRepairArguments({
    sourceDirectory: output, resumeDirectory: resume,
  }), ['--source', output, '--resume', resume]);
});

test('launcher discovers repair runs and identifies the latest incomplete repair', async (t) => {
  const root = await tempDirectory(t);
  const complete = join(root, 'repair-complete');
  const incomplete = join(root, 'repair-incomplete');
  await writeRepairRun({
    directory: complete, sourceRunId: 'source-complete', complete: true,
    updatedAt: new Date('2026-09-30T11:00:00Z'),
  });
  await writeRepairRun({
    directory: incomplete, sourceRunId: 'source-incomplete', complete: false,
    updatedAt: new Date('2026-09-30T12:00:00Z'),
  });
  const repairs = await discoverRepairRuns([root]);
  assert.equal(repairs.length, 2);
  assert.equal(repairs[0]?.directory, resolve(incomplete));
  assert.equal(latestIncompleteRepairRun(repairs)?.sourceRunId, 'source-incomplete');
  assert.equal(repairs.find(({ directory }) => directory === resolve(complete))?.isComplete, true);
});

test('knowledge mode is explicit and preflight summaries make baseline and KB impossible to confuse', () => {
  assert.equal(knowledgeBaseVersionForChoice('1'), null);
  assert.equal(knowledgeBaseVersionForChoice('2'), CURRENT_KNOWLEDGE_BASE_VERSION);
  assert.equal(knowledgeBaseVersionForChoice('0'), undefined);
  assert.throws(() => knowledgeBaseVersionForChoice(''), /invalide/u);
  assert.equal(repeatForInput(''), 1);
  assert.equal(repeatForInput('5'), 5);
  assert.throws(() => repeatForInput('0'), /entier positif/u);
  assert.throws(() => repeatForInput('-1'), /entier positif/u);
  assert.throws(() => repeatForInput('1.5'), /entier positif/u);
  assert.equal(repairPassesForChoice('0'), 0);
  assert.equal(repairPassesForChoice('1'), 1);
  assert.equal(repairPassesForChoice('2'), 2);
  assert.throws(() => repairPassesForChoice('oui'), /repair invalide/u);

  const base = {
    corpusFile: 'lan-032-corpus-v1.json',
    mode: 'full' as const,
    provider: 'groq',
    model: 'test-model',
    outputDirectory: 'pre-kb-run',
    repeat: 1,
    selectedMatchups: 2,
  };
  const baseline = formatEvaluationConfiguration({ ...base, knowledgeBaseVersion: null });
  assert.match(baseline, /DÉSACTIVÉE — BASELINE PRÉ-KB/u);
  assert.match(baseline, /Version KB {6}: aucune/u);
  const kb = formatEvaluationConfiguration({
    ...base,
    knowledgeBaseVersion: CURRENT_KNOWLEDGE_BASE_VERSION,
    coverage: {
      version: CURRENT_KNOWLEDGE_BASE_VERSION,
      selectedMatchups: 25,
      nonEmptyCoverage: 23,
      emptyCoverage: 2,
    },
  });
  assert.match(kb, /Knowledge Base {2}: ACTIVÉE/u);
  assert.match(kb, new RegExp(`Version KB {6}: ${CURRENT_KNOWLEDGE_BASE_VERSION}`, 'u'));
  assert.match(kb, /couverture non nulle attendue : 23/u);
});

test('KB coverage preflight is local and blocks a selection with 100% none coverage', async (t) => {
  const directory = await tempDirectory(t);
  const coveredCorpus = await writeCorpus(directory);
  const covered = await preflightKnowledgeCoverage({
    corpusPath: coveredCorpus,
    mode: 'sentinels',
    knowledgeBaseVersion: CURRENT_KNOWLEDGE_BASE_VERSION,
  });
  assert.equal(covered.selectedMatchups, 1);
  assert.ok(covered.nonEmptyCoverage > 0);

  const uncoveredPath = join(directory, 'uncovered.json');
  const uncovered = {
    ...corpusValue,
    rules: { expectedMatchups: 1, expectedSentinels: 1 },
    matchups: [{
      id: 'LLC-999', patch: '26.19',
      ally: { carry: 'Aatrox', support: 'Ahri' },
      enemy: { carry: 'Akali', support: 'Alistar' },
      tags: ['fallback'], sentinel: true,
    }],
  };
  await writeFile(uncoveredPath, JSON.stringify(uncovered), 'utf8');
  await assert.rejects(preflightKnowledgeCoverage({
    corpusPath: uncoveredPath,
    mode: 'full',
    knowledgeBaseVersion: CURRENT_KNOWLEDGE_BASE_VERSION,
  }), /couverture locale est nulle.*Aucun appel provider/u);
});

test('mandatory configuration confirmation happens before the runner can consume tokens', async (t) => {
  const directory = await tempDirectory(t);
  const corpus = await writeCorpus(directory);
  const answers = ['1', '5', '0', 'n'];
  let output = '';
  let runnerCalls = 0;
  const io: MenuIO = {
    async question() { return answers.shift() ?? 'n'; },
    write(message) { output += message; },
    close() {},
  };
  await launchNewEvaluation({
    io,
    workingDirectory: process.cwd(),
    config: { corpusPath: corpus, resultsRoot: join(directory, 'runs') },
    mode: 'full',
    environment: { AI_PROVIDER: 'groq', GROQ_API_KEY: 'fake-test-key' },
    async executeEvaluation() { runnerCalls += 1; },
  });
  assert.match(output, /Configuration de l’évaluation/u);
  assert.match(output, /DÉSACTIVÉE — BASELINE PRÉ-KB/u);
  assert.match(output, /Répétitions {5}: 5/u);
  assert.match(output, /Observations {4}: 10/u);
  assert.equal(runnerCalls, 0);
});

test('a new run can invoke a separately persisted targeted repair after completion', async (t) => {
  const directory = await tempDirectory(t);
  const corpus = await writeCorpus(directory);
  const resultsRoot = join(directory, 'runs');
  const answers = ['1', '1', '2', 'o'];
  let output = '';
  let repairArguments: readonly string[] | undefined;
  const io: MenuIO = {
    async question() { return answers.shift() ?? ''; },
    write(message) { output += message; },
    close() {},
  };
  await launchNewEvaluation({
    io,
    workingDirectory: process.cwd(),
    config: { corpusPath: corpus, resultsRoot },
    mode: 'full',
    environment: { AI_PROVIDER: 'groq', GROQ_API_KEY: 'fake-test-key' },
    async executeEvaluation(args = []) {
      const outputIndex = args.indexOf('--output');
      assert.notEqual(outputIndex, -1);
      await writeRun({
        directory: args[outputIndex + 1]!, completed: 2,
        completedAt: '2026-09-30T12:00:00Z', updatedAt: new Date('2026-09-30T12:00:00Z'),
        repairableInvalid: true,
      });
    },
    async executeRepair(args = []) {
      repairArguments = args;
      const sourceIndex = args.indexOf('--source');
      const outputIndex = args.indexOf('--output');
      const sourceRun = JSON.parse(await readFile(join(args[sourceIndex + 1]!, 'run.json'), 'utf8')) as { runId: string };
      await writeRepairRun({
        directory: args[outputIndex + 1]!, sourceRunId: sourceRun.runId, complete: true,
        updatedAt: new Date('2026-09-30T12:01:00Z'),
      });
    },
  });
  assert.deepEqual(repairArguments?.slice(-2), ['--max-repairs', '2']);
  assert.match(output, /Repair ciblé {3}: 2 passe\(s\) après le run/u);
  assert.match(output, /Démarrage du repair ciblé : 1 analyse/u);
  assert.match(output, /Repair : repair-/u);
});

test('a new run keeps repair disabled when the operator selects zero passes', async (t) => {
  const directory = await tempDirectory(t);
  const corpus = await writeCorpus(directory);
  const answers = ['1', '1', '0', 'o'];
  let repairCalls = 0;
  const io: MenuIO = {
    async question() { return answers.shift() ?? ''; },
    write() {},
    close() {},
  };
  await launchNewEvaluation({
    io,
    workingDirectory: process.cwd(),
    config: { corpusPath: corpus, resultsRoot: join(directory, 'runs') },
    mode: 'full',
    environment: { AI_PROVIDER: 'groq', GROQ_API_KEY: 'fake-test-key' },
    async executeEvaluation(args = []) {
      const outputIndex = args.indexOf('--output');
      await writeRun({
        directory: args[outputIndex + 1]!, completed: 2,
        completedAt: '2026-09-30T12:00:00Z', updatedAt: new Date('2026-09-30T12:00:00Z'),
        repairableInvalid: true,
      });
    },
    async executeRepair() { repairCalls += 1; },
  });
  assert.equal(repairCalls, 0);
});

test('interactive menu exposes repair of an existing run and blocks incomplete historical artifacts locally', async (t) => {
  const directory = await tempDirectory(t);
  const corpus = await writeCorpus(directory);
  const resultsRoot = join(directory, 'runs');
  await writeRun({
    directory: join(resultsRoot, 'historical'), completed: 2,
    completedAt: '2026-09-30T12:00:00Z', updatedAt: new Date('2026-09-30T12:00:00Z'),
  });
  await saveLauncherConfig(directory, { corpusPath: corpus, resultsRoot });
  const answers = ['7', '1', '1', '', '0'];
  let output = '';
  const io: MenuIO = {
    async question() { return answers.shift() ?? '0'; },
    write(message) { output += message; },
    close() {},
  };
  await interactiveMain(io, directory);
  assert.match(output, /7\. Réparer un run terminé/u);
  assert.match(output, /candidateAnalysis, violations/u);
  assert.match(output, /Aucun appel provider/u);
});

test('repair source accepts a manual run path when discovery finds no completed run', async (t) => {
  const directory = await tempDirectory(t);
  const corpus = await writeCorpus(directory);
  const manualRun = join(directory, 'manual-source');
  await writeRun({
    directory: manualRun, completed: 2,
    completedAt: '2026-09-30T12:00:00Z', updatedAt: new Date('2026-09-30T12:00:00Z'),
    repairableInvalid: true,
  });
  await saveLauncherConfig(directory, {
    corpusPath: corpus,
    resultsRoot: join(directory, 'empty-discovery-root'),
  });
  const answers = ['7', `"${join(manualRun, 'results.json')}"`, '0', '', '0'];
  let output = '';
  const io: MenuIO = {
    async question() { return answers.shift() ?? '0'; },
    write(message) { output += message; },
    close() {},
  };

  await interactiveMain(io, directory);

  assert.match(output, /Aucun run découvert automatiquement/u);
  assert.match(output, /Run : manual-source/u);
  assert.match(output, /Repair ciblé après génération/u);
});

test('manual repair paths accept a run directory or one of its standard artifacts', () => {
  const base = resolve('manual-path-base');
  const run = resolve(base, 'my-run');
  assert.equal(runDirectoryForInput('', base), undefined);
  assert.equal(runDirectoryForInput('my-run', base), run);
  assert.equal(runDirectoryForInput(`"${join(run, 'run.json')}"`, base), run);
  assert.equal(runDirectoryForInput(join(run, 'results.json'), base), run);
  assert.equal(runDirectoryForInput(join(run, 'summary.json'), base), run);
});

test('mechanical coverage failure blocks the launcher before runner execution', async (t) => {
  const directory = await tempDirectory(t);
  const corpus = join(directory, 'gated-corpus.json');
  await writeFile(corpus, JSON.stringify({
    ...corpusValue,
    rules: { expectedMatchups: 1, expectedSentinels: 1, fullCoverageGate: 'required' },
    matchups: [{
      ...corpusValue.matchups[0],
      ally: { carry: 'Ahri', support: 'Thresh' },
    }],
  }), 'utf8');
  const answers = ['1', '5', '0'];
  let runnerCalls = 0;
  const io: MenuIO = {
    async question() { return answers.shift() ?? ''; },
    write() {},
    close() {},
  };
  await assert.rejects(launchNewEvaluation({
    io,
    workingDirectory: process.cwd(),
    config: { corpusPath: corpus, resultsRoot: join(directory, 'runs') },
    mode: 'full',
    environment: { AI_PROVIDER: 'groq', GROQ_API_KEY: 'fake-test-key' },
    async executeEvaluation() { runnerCalls += 1; },
  }), /NOT FULLY COVERED|couverture mécanique/u);
  assert.equal(runnerCalls, 0);
});

test('launcher preflight recognizes DeepSeek without exposing its key', () => {
  const preflight = preflightProvider({
    AI_PROVIDER: 'deepseek',
    DEEPSEEK_API_KEY: 'must-not-appear',
    DEEPSEEK_MODEL: 'deepseek-v4-pro',
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
    DEEPSEEK_TIMEOUT_MS: '30000',
  });
  assert.deepEqual(preflight, { provider: 'deepseek', model: 'deepseek-v4-pro' });
  assert.doesNotMatch(JSON.stringify(preflight), /must-not-appear/u);
});

test('matchup validation is friendly and corpus discovery remains configurable', async (t) => {
  const directory = await tempDirectory(t);
  const corpus = await writeCorpus(directory);
  assert.equal(await assertMatchupExists(corpus, ' llc-001 '), 'LLC-001');
  await assert.rejects(assertMatchupExists(corpus, 'LLC-999'), /ID de matchup inconnu : LLC-999/u);
  await assert.rejects(assertMatchupExists(join(directory, 'missing.json'), 'LLC-001'), /Corpus introuvable/u);

  assert.equal(await discoverCorpusPath({
    workingDirectory: directory,
    environment: { LANELENS_EVALUATION_CORPUS: corpus },
  }), resolve(corpus));
  const config = { corpusPath: corpus, resultsRoot: join(directory, 'custom-results') };
  await saveLauncherConfig(directory, config);
  assert.equal(await discoverCorpusPath({ workingDirectory: directory, config }), resolve(corpus));
  assert.equal(resolveResultsRoot({ workingDirectory: directory, config }), resolve(config.resultsRoot));

  const canonicalDirectory = await mkdtemp(join(tmpdir(), 'lanelens-launcher-canonical-'));
  t.after(() => rm(canonicalDirectory, { recursive: true, force: true }));
  const canonicalCorpus = join(canonicalDirectory, 'evaluation', 'corpus', 'lan-032-corpus-v1.json');
  await mkdir(dirname(canonicalCorpus), { recursive: true });
  await writeFile(canonicalCorpus, JSON.stringify(corpusValue), 'utf8');
  assert.equal(
    await discoverCorpusPath({ workingDirectory: canonicalDirectory, environment: {} }),
    resolve(canonicalCorpus),
  );
});

test('preflight rejects unsupported Node, missing provider config, missing corpus, and existing output safely', async (t) => {
  assert.throws(() => assertCompatibleNodeVersion('22.13.0'), EvaluationLauncherError);
  assert.doesNotThrow(() => assertCompatibleNodeVersion('22.13.1'));
  assert.doesNotThrow(() => assertCompatibleNodeVersion('23.0.0'));
  assert.doesNotThrow(() => assertCompatibleNodeVersion('24.19.0'));
  assert.throws(() => assertCompatibleNodeVersion('25.0.0'), EvaluationLauncherError);
  assert.throws(() => preflightProvider({ AI_PROVIDER: 'groq' }), /GROQ_API_KEY n’est pas configurée/u);
  assert.throws(() => preflightProvider({ AI_PROVIDER: 'invalid', OPENAI_API_KEY: 'secret' }), /AI_PROVIDER est invalide/u);

  const directory = await tempDirectory(t);
  const executable = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';
  const bin = join(directory, 'node_modules', '.bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, executable), '', 'utf8');
  await assert.rejects(preflightEvaluation({
    workingDirectory: directory,
    corpusPath: join(directory, 'missing.json'),
    environment: { GROQ_API_KEY: 'must-not-appear', AI_PROVIDER: 'groq' },
    nodeVersion: '22.13.1',
    knowledgeBaseVersion: null,
  }), /Corpus introuvable/u);

  const existing = join(directory, 'existing');
  await mkdir(existing);
  await assert.rejects(assertNewOutputPath(existing), /existe déjà/u);
  const generated = await createRunOutputPath({
    resultsRoot: directory,
    knowledgeBaseVersion: null,
    now: new Date('2026-09-30T12:00:00Z'),
    id: 'fixed',
  });
  assert.equal(generated, resolve(directory, 'pre-kb-2026-09-30T12-00-00-000Z-fixed'));
  const kbGenerated = await createRunOutputPath({
    resultsRoot: directory,
    knowledgeBaseVersion: CURRENT_KNOWLEDGE_BASE_VERSION,
    now: new Date('2026-09-30T12:00:00Z'),
    id: 'kb-fixed',
  });
  assert.equal(kbGenerated, resolve(directory, `kb-${CURRENT_KNOWLEDGE_BASE_VERSION}-2026-09-30T12-00-00-000Z-kb-fixed`));
  const repairGenerated = await createRepairOutputPath({
    resultsRoot: directory,
    maxRepairs: 2,
    now: new Date('2026-09-30T12:00:00Z'),
    id: 'repair-fixed',
  });
  assert.equal(repairGenerated, resolve(directory, 'repair-2-pass-2026-09-30T12-00-00-000Z-repair-fixed'));
  assert.doesNotMatch(JSON.stringify({ error: 'GROQ_API_KEY n’est pas configurée.' }), /must-not-appear/u);
});

test('information mode reads the latest run without provider configuration or runner invocation', async (t) => {
  const directory = await tempDirectory(t);
  const corpus = await writeCorpus(directory);
  const resultsRoot = join(directory, 'runs');
  await writeRun({ directory: join(resultsRoot, 'latest'), completed: 1, updatedAt: new Date('2026-09-30T12:00:00Z') });
  await saveLauncherConfig(directory, { corpusPath: corpus, resultsRoot });
  const answers = ['6', '', '0'];
  let output = '';
  const io: MenuIO = {
    async question() { return answers.shift() ?? '0'; },
    write(message) { output += message; },
    close() {},
  };
  await interactiveMain(io, directory);
  assert.match(output, /Progression : 1 \/ 2/u);
  assert.match(output, /Provider \/ modèle : groq \/ test-model/u);
  assert.match(output, /Knowledge Base : DÉSACTIVÉE — BASELINE PRÉ-KB/u);
  assert.doesNotMatch(output, /n’est pas configurée|Statut : running/u);
});

test('run information exposes the immutable KB version for resumed and inspected runs', async (t) => {
  const directory = await tempDirectory(t);
  const corpus = await writeCorpus(directory);
  const resultsRoot = join(directory, 'runs');
  await writeRun({
    directory: join(resultsRoot, 'kb-latest'),
    completed: 2,
    completedAt: '2026-09-30T12:00:00Z',
    updatedAt: new Date('2026-09-30T12:00:00Z'),
    knowledgeBaseVersion: CURRENT_KNOWLEDGE_BASE_VERSION,
  });
  await saveLauncherConfig(directory, { corpusPath: corpus, resultsRoot });
  const answers = ['6', '', '0'];
  let output = '';
  const io: MenuIO = {
    async question() { return answers.shift() ?? '0'; },
    write(message) { output += message; },
    close() {},
  };
  await interactiveMain(io, directory);
  assert.match(output, /Knowledge Base : ACTIVÉE/u);
  assert.match(output, new RegExp(`Version KB : ${CURRENT_KNOWLEDGE_BASE_VERSION}`, 'u'));
});

test('Windows launcher is thin and exposes a provider-free smoke mode', async () => {
  const launcher = await readFile(resolve('run-gameplay-evaluation.cmd'), 'utf8');
  assert.match(launcher, /interactive-runner\.ts/u);
  assert.match(launcher, /--smoke/u);
  assert.doesNotMatch(launcher, /OPENAI_API_KEY|GROQ_API_KEY|GEMINI_API_KEY/u);
  if (process.platform === 'win32') {
    const result = spawnSync('cmd.exe', ['/d', '/c', 'run-gameplay-evaluation.cmd', '--smoke'], {
      cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      assertCompatibleNodeVersion(process.versions.node);
      assert.equal(result.status, 0);
      assert.match(result.stdout, /smoke check: OK/u);
    } catch (error) {
      assert.ok(error instanceof EvaluationLauncherError);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /Node\.js >= 22\.13\.1 et < 25 est requis/u);
    }
  }
});
