import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { interactiveMain, type MenuIO } from '../scripts/evaluation/interactive-runner.js';
import {
  EvaluationLauncherError,
  assertCompatibleNodeVersion,
  assertMatchupExists,
  assertNewOutputPath,
  buildEvaluationArguments,
  createRunOutputPath,
  discoverCorpusPath,
  discoverEvaluationRuns,
  latestIncompleteRun,
  preflightEvaluation,
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
    knowledgeBaseVersion: null,
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
  assert.deepEqual(buildEvaluationArguments({ mode: 'full', corpusPath: corpus, outputDirectory: output }), [
    '--corpus', corpus, '--output', output,
  ]);
  assert.deepEqual(buildEvaluationArguments({ mode: 'sentinels', corpusPath: corpus, outputDirectory: output }), [
    '--corpus', corpus, '--output', output, '--sentinels',
  ]);
  assert.deepEqual(buildEvaluationArguments({ mode: 'single', corpusPath: corpus, outputDirectory: output, matchupId: 'LLC-009' }), [
    '--corpus', corpus, '--output', output, '--id', 'LLC-009',
  ]);
  assert.deepEqual(buildEvaluationArguments({ mode: 'resume', corpusPath: corpus, resumeDirectory: resume }), [
    '--corpus', corpus, '--resume', resume,
  ]);
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
  }), /Corpus introuvable/u);

  const existing = join(directory, 'existing');
  await mkdir(existing);
  await assert.rejects(assertNewOutputPath(existing), /existe déjà/u);
  const generated = await createRunOutputPath({ resultsRoot: directory, now: new Date('2026-09-30T12:00:00Z'), id: 'fixed' });
  assert.equal(generated, resolve(directory, '2026-09-30T12-00-00-000Z-fixed'));
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
  assert.doesNotMatch(output, /n’est pas configurée|Statut : running/u);
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
