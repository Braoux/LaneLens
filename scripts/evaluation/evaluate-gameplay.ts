import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAnalysisRuntime } from '../../server/analysis/createAnalysisRuntime.js';
import { VersionedPatchContextResolver } from '../../server/patch-context/VersionedPatchContextResolver.js';
import {
  loadEvaluationCorpus,
  selectCorpusMatchups,
} from './corpus.js';
import {
  loadEvaluationRun,
  prepareNewRunDirectory,
} from './result-writer.js';
import type { RunFiles } from './result-writer.js';
import { executeEvaluation } from './runner.js';
import { ConsoleEvaluationProgress } from './progress.js';
import type { EvaluationResult, EvaluationRun } from './types.js';

export const DEFAULT_DELAY_MS = 2_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_DELAY_MS = 3_600_000;
const MAX_ATTEMPTS = 10;

export interface EvaluationCliArguments {
  readonly corpus: string;
  readonly output?: string;
  readonly resume?: string;
  readonly sentinels: boolean;
  readonly id?: string;
  readonly delayMs: number;
  readonly maxAttempts: number;
  readonly knowledgeBaseVersion?: string;
  readonly delayProvided: boolean;
  readonly maxAttemptsProvided: boolean;
}

export function resolveRunKnowledgeBaseVersion(
  requestedVersion: string | undefined,
  resumedVersion?: string | null,
): string | null {
  if (
    resumedVersion !== undefined
    && requestedVersion !== undefined
    && requestedVersion !== resumedVersion
  ) {
    throw new Error('--knowledge-base-version ne peut pas modifier un run repris.');
  }
  return requestedVersion ?? resumedVersion ?? null;
}

function parseNonNegativeInteger(value: string | undefined, option: string): number {
  if (value === undefined || !/^\d+$/u.test(value)) {
    throw new Error(`${option} attend un entier positif ou nul.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${option} dépasse la plage acceptée.`);
  return parsed;
}

function parsePositiveInteger(value: string | undefined, option: string): number {
  const parsed = parseNonNegativeInteger(value, option);
  if (parsed < 1) throw new Error(`${option} doit être supérieur ou égal à 1.`);
  return parsed;
}

export function parseEvaluationArguments(argv: readonly string[]): EvaluationCliArguments {
  const values = new Map<string, string>();
  let sentinels = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--sentinels') {
      sentinels = true;
      continue;
    }
    if (![
      '--corpus',
      '--output',
      '--resume',
      '--id',
      '--delay-ms',
      '--max-attempts',
      '--knowledge-base-version',
    ].includes(argument)) {
      throw new Error(`Option inconnue : ${argument}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Valeur manquante pour ${argument}.`);
    if (values.has(argument)) throw new Error(`Option répétée : ${argument}`);
    values.set(argument, value);
    index += 1;
  }
  const corpus = values.get('--corpus');
  if (corpus === undefined) throw new Error('--corpus est obligatoire.');
  const resume = values.get('--resume');
  const knowledgeBaseVersion = values.get('--knowledge-base-version')?.trim();
  if (values.has('--knowledge-base-version') && knowledgeBaseVersion?.length === 0) {
    throw new Error('--knowledge-base-version attend une valeur non vide.');
  }
  if (resume !== undefined && (sentinels || values.has('--id') || values.has('--output'))) {
    throw new Error('--resume ne peut pas être combiné avec --sentinels, --id ou --output.');
  }
  const delayMs = values.has('--delay-ms')
    ? parseNonNegativeInteger(values.get('--delay-ms'), '--delay-ms')
    : DEFAULT_DELAY_MS;
  if (delayMs > MAX_DELAY_MS) throw new Error('--delay-ms ne peut pas dépasser 3600000.');
  const maxAttempts = values.has('--max-attempts')
    ? parsePositiveInteger(values.get('--max-attempts'), '--max-attempts')
    : DEFAULT_MAX_ATTEMPTS;
  if (maxAttempts > MAX_ATTEMPTS) throw new Error('--max-attempts ne peut pas dépasser 10.');
  return {
    corpus,
    sentinels,
    ...(values.has('--output') ? { output: values.get('--output')! } : {}),
    ...(resume === undefined ? {} : { resume }),
    ...(values.has('--id') ? { id: values.get('--id')! } : {}),
    ...(knowledgeBaseVersion === undefined ? {} : { knowledgeBaseVersion }),
    delayMs,
    maxAttempts,
    delayProvided: values.has('--delay-ms'),
    maxAttemptsProvided: values.has('--max-attempts'),
  };
}

function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function defaultOutputDirectory(now: Date): string {
  const timestamp = now.toISOString().replaceAll(/[:.]/gu, '-');
  return resolve('.lanelens-evaluation', 'runs', `${timestamp}-${randomUUID()}`);
}

function assertResumeMatches(
  run: EvaluationRun,
  corpus: Awaited<ReturnType<typeof loadEvaluationCorpus>>,
  arguments_: EvaluationCliArguments,
): void {
  if (
    run.corpusSchemaVersion !== corpus.corpus.schemaVersion
    || run.corpusVersion !== corpus.corpus.corpusVersion
    || run.corpusSha256 !== corpus.sha256
    || run.patch !== corpus.corpus.patch
  ) {
    throw new Error('Le corpus fourni ne correspond pas au run à reprendre.');
  }
  if (arguments_.delayProvided && arguments_.delayMs !== run.delayMs) {
    throw new Error('--delay-ms ne peut pas modifier la configuration d’un run repris.');
  }
  if (arguments_.maxAttemptsProvided && arguments_.maxAttempts !== run.maxAttempts) {
    throw new Error('--max-attempts ne peut pas modifier la configuration d’un run repris.');
  }
  if (
    arguments_.knowledgeBaseVersion !== undefined
    && arguments_.knowledgeBaseVersion !== run.knowledgeBaseVersion
  ) {
    throw new Error('--knowledge-base-version ne peut pas modifier un run repris.');
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const arguments_ = parseEvaluationArguments(argv);
  const loadedCorpus = await loadEvaluationCorpus(resolve(arguments_.corpus));
  const resumeSnapshot = arguments_.resume === undefined
    ? undefined
    : await loadEvaluationRun(resolve(arguments_.resume));
  const requestedKnowledgeBaseVersion = resolveRunKnowledgeBaseVersion(
    arguments_.knowledgeBaseVersion,
    resumeSnapshot?.run.knowledgeBaseVersion,
  );
  const analysisRuntime = createAnalysisRuntime({
    knowledgeBaseEnabled: requestedKnowledgeBaseVersion !== null,
  });
  if (analysisRuntime === undefined) {
    throw new Error('Aucun provider d’analyse configuré pour le runner.');
  }
  if (analysisRuntime.knowledgeBaseVersion !== requestedKnowledgeBaseVersion) {
    throw new Error(`Version Knowledge Base attendue : ${analysisRuntime.knowledgeBaseVersion ?? 'aucune'}.`);
  }

  let run: EvaluationRun;
  let initialResults: EvaluationResult[] = [];
  let files: RunFiles;
  let matchups: typeof loadedCorpus.corpus.matchups;
  if (arguments_.resume !== undefined) {
    const resumed = resumeSnapshot!;
    assertResumeMatches(resumed.run, loadedCorpus, arguments_);
    if (
      resumed.run.provider !== analysisRuntime.provider
      || resumed.run.model !== analysisRuntime.model
    ) {
      throw new Error('Le provider ou le modèle configuré ne correspond pas au run à reprendre.');
    }
    run = resumed.run;
    initialResults = resumed.results;
    files = resumed.files;
    const byId = new Map(loadedCorpus.corpus.matchups.map((matchup) => [matchup.id, matchup]));
    matchups = run.selectedIds.map((id) => {
      const matchup = byId.get(id);
      if (matchup === undefined) throw new Error(`Le corpus repris ne contient plus ${id}.`);
      return matchup;
    });
  } else {
    const selection = selectCorpusMatchups(loadedCorpus.corpus, arguments_);
    matchups = selection.matchups;
    const startedAt = new Date();
    const directory = resolve(arguments_.output ?? defaultOutputDirectory(startedAt));
    files = await prepareNewRunDirectory(directory);
    run = {
      schemaVersion: 1,
      runId: randomUUID(),
      corpusSchemaVersion: loadedCorpus.corpus.schemaVersion,
      corpusVersion: loadedCorpus.corpus.corpusVersion,
      corpusSha256: loadedCorpus.sha256,
      corpusFile: loadedCorpus.file,
      patch: loadedCorpus.corpus.patch,
      gitCommit: gitCommit(),
      provider: analysisRuntime.provider,
      model: analysisRuntime.model,
      startedAt: startedAt.toISOString(),
      completedAt: null,
      mode: selection.mode,
      selectedIds: matchups.map(({ id }) => id),
      delayMs: arguments_.delayMs,
      maxAttempts: arguments_.maxAttempts,
      knowledgeBaseVersion: arguments_.knowledgeBaseVersion ?? null,
    };
  }

  process.stdout.write(`Résultats : ${files.directory}\n`);
  const progress = new ConsoleEvaluationProgress();
  try {
    await executeEvaluation({
      service: analysisRuntime.service,
      patchContextResolver: new VersionedPatchContextResolver(),
      matchups,
      files,
      run,
      initialResults,
      onProgress: (state) => progress.update(state),
    });
    progress.finish();
  } catch (error) {
    progress.stop();
    throw error;
  }
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined && import.meta.url === pathToFileURL(resolve(entryPoint)).href;
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Erreur d’évaluation inconnue.';
    process.stderr.write(`LaneLens evaluation failed: ${message}\n`);
    process.exitCode = 1;
  });
}
