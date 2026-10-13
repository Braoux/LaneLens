import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAnalysisRuntime } from '../../server/analysis/createAnalysisRuntime.js';
import { VersionedPatchContextResolver } from '../../server/patch-context/VersionedPatchContextResolver.js';
import { withEvaluationDeepSeekTimeout } from './deepseek-timeout.js';
import { loadEvaluationRun } from './result-writer.js';
import {
  loadRepairRun,
  prepareRepairRunDirectory,
  type RepairRunFiles,
} from './repair-result-writer.js';
import {
  assertRepairableResults,
  executeRepairs,
  selectRepairableResults,
  type RepairEligibilityIssue,
} from './repair-runner.js';
import type { RepairResult, RepairRun } from './repair-types.js';
import { ConsoleEvaluationProgress } from './progress.js';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 2_000;

export interface RepairCliArguments {
  readonly source: string;
  readonly output?: string;
  readonly resume?: string;
  readonly maxRepairs: 1 | 2;
  readonly maxAttempts: number;
  readonly delayMs: number;
  readonly preflightOnly: boolean;
  readonly maxRepairsProvided: boolean;
  readonly maxAttemptsProvided: boolean;
  readonly delayProvided: boolean;
}

export interface RepairSourcePreflight {
  readonly source: Awaited<ReturnType<typeof loadEvaluationRun>>;
  readonly invalid: number;
  readonly repairable: ReturnType<typeof assertRepairableResults>;
  readonly issues: readonly RepairEligibilityIssue[];
}

function integer(value: string | undefined, option: string, minimum: number, maximum: number): number {
  if (value === undefined || !/^\d+$/u.test(value)) throw new Error(`${option} attend un entier.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${option} doit être compris entre ${minimum} et ${maximum}.`);
  }
  return parsed;
}

export function parseRepairArguments(argv: readonly string[]): RepairCliArguments {
  const values = new Map<string, string>();
  let preflightOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--preflight-only') {
      preflightOnly = true;
      continue;
    }
    if (!['--source', '--output', '--resume', '--max-repairs', '--max-attempts', '--delay-ms'].includes(argument)) {
      throw new Error(`Option inconnue : ${argument}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Valeur manquante pour ${argument}.`);
    if (values.has(argument)) throw new Error(`Option répétée : ${argument}`);
    values.set(argument, value);
    index += 1;
  }
  const source = values.get('--source');
  if (source === undefined) throw new Error('--source est obligatoire.');
  const resume = values.get('--resume');
  const output = values.get('--output');
  if (resume !== undefined && output !== undefined) throw new Error('--resume et --output sont incompatibles.');
  if (!preflightOnly && resume === undefined && output === undefined) {
    throw new Error('--output est obligatoire pour une nouvelle expérimentation.');
  }
  const maxRepairs = integer(values.get('--max-repairs') ?? '1', '--max-repairs', 1, 2) as 1 | 2;
  const maxAttempts = integer(
    values.get('--max-attempts') ?? String(DEFAULT_MAX_ATTEMPTS),
    '--max-attempts',
    1,
    10,
  );
  const delayMs = integer(values.get('--delay-ms') ?? String(DEFAULT_DELAY_MS), '--delay-ms', 0, 3_600_000);
  return {
    source,
    ...(output === undefined ? {} : { output }),
    ...(resume === undefined ? {} : { resume }),
    maxRepairs,
    maxAttempts,
    delayMs,
    preflightOnly,
    maxRepairsProvided: values.has('--max-repairs'),
    maxAttemptsProvided: values.has('--max-attempts'),
    delayProvided: values.has('--delay-ms'),
  };
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
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

function stable(value: Readonly<Record<string, string | number | boolean>> | undefined): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value ?? {}).sort(([left], [right]) => (
    left.localeCompare(right)
  ))));
}

export async function preflightRepairSource(sourceDirectory: string): Promise<RepairSourcePreflight> {
  const source = await loadEvaluationRun(resolve(sourceDirectory));
  if (source.run.completedAt === null || source.results.some(({ status }) => status === 'in_progress')) {
    throw new Error('Le run source doit être terminé avant de lancer un repair. Aucun appel provider n’a été effectué.');
  }
  const selection = selectRepairableResults(source.results);
  const repairable = assertRepairableResults(source.results);
  return Object.freeze({
    source,
    invalid: selection.invalid.length,
    repairable,
    issues: selection.issues,
  });
}

export function formatRepairEligibilityIssues(issues: readonly RepairEligibilityIssue[]): string {
  return issues.map(({ id, missing }) => `- ${id}: ${missing.join(', ')}`).join('\n');
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseRepairArguments(argv);
  const preflight = await preflightRepairSource(args.source);
  const { source, repairable } = preflight;
  process.stdout.write(`Analyses invalides: ${preflight.invalid}\n`);
  process.stdout.write(`Analyses réparables: ${repairable.length}\n`);
  process.stdout.write(`Analyses ignorées car non réparables: ${preflight.issues.length}\n`);
  if (preflight.issues.length > 0) {
    process.stdout.write(`${formatRepairEligibilityIssues(preflight.issues)}\n`);
  }
  process.stdout.write(`Repair passes: ${args.maxRepairs}\n`);
  process.stdout.write(`Appels provider maximum: ${repairable.length * args.maxRepairs * args.maxAttempts}\n`);
  if (args.preflightOnly) return;

  const [sourceRunSha256, sourceResultsSha256] = await Promise.all([
    sha256(source.files.run),
    sha256(source.files.results),
  ]);
  const resumed = args.resume === undefined ? undefined : await loadRepairRun(resolve(args.resume));
  const maxRepairs = resumed?.run.maxRepairs ?? args.maxRepairs;
  const maxAttempts = resumed?.run.maxAttempts ?? args.maxAttempts;
  const delayMs = resumed?.run.delayMs ?? args.delayMs;
  if (resumed !== undefined) {
    if (args.maxRepairsProvided && args.maxRepairs !== resumed.run.maxRepairs) {
      throw new Error('--max-repairs ne peut pas modifier une expérimentation reprise.');
    }
    if (args.maxAttemptsProvided && args.maxAttempts !== resumed.run.maxAttempts) {
      throw new Error('--max-attempts ne peut pas modifier une expérimentation reprise.');
    }
    if (args.delayProvided && args.delayMs !== resumed.run.delayMs) {
      throw new Error('--delay-ms ne peut pas modifier une expérimentation reprise.');
    }
    if (
      resumed.run.sourceRunId !== source.run.runId
      || resumed.run.sourceRunSha256 !== sourceRunSha256
      || resumed.run.sourceResultsSha256 !== sourceResultsSha256
    ) {
      throw new Error('Les artefacts source ne correspondent pas à l’expérimentation reprise.');
    }
  }

  const runtime = createAnalysisRuntime({
    environment: withEvaluationDeepSeekTimeout(process.env),
    knowledgeBaseEnabled: source.run.knowledgeBaseVersion !== null,
    executionContext: 'evaluation',
  });
  if (runtime === undefined) throw new Error('Aucun provider d’analyse configuré pour le repair.');
  if (
    runtime.provider !== source.run.provider
    || runtime.model !== source.run.model
    || runtime.knowledgeBaseVersion !== source.run.knowledgeBaseVersion
    || stable(runtime.generationParameters) !== stable(source.run.generationParameters)
  ) {
    throw new Error('Le provider, le modèle, la KB ou les paramètres diffèrent du run source.');
  }

  let run: RepairRun;
  let results: RepairResult[];
  let files: RepairRunFiles;
  if (resumed !== undefined) {
    run = resumed.run;
    results = resumed.results;
    files = resumed.files;
  } else {
    files = await prepareRepairRunDirectory(resolve(args.output!));
    run = {
      schemaVersion: 1,
      runId: randomUUID(),
      sourceRunId: source.run.runId,
      sourceRunSha256,
      sourceResultsSha256,
      sourceCorpusFile: source.run.corpusFile,
      sourceCorpusVersion: source.run.corpusVersion,
      sourceCorpusSha256: source.run.corpusSha256,
      sourceGitCommit: source.run.gitCommit,
      repairGitCommit: gitCommit(),
      ...(source.run.goldenTruthVersion === undefined ? {} : {
        goldenTruthVersion: source.run.goldenTruthVersion,
      }),
      sourceObservations: source.results.length,
      sourceSuccess: source.results.filter(({ status }) => status === 'success').length,
      sourceInvalid: source.results.filter(({ status }) => status === 'invalid_analysis').length,
      selectedIds: repairable.map(({ id }) => id),
      ineligibleObservations: preflight.issues,
      provider: runtime.provider,
      model: runtime.model,
      ...(runtime.generationParameters === undefined ? {} : {
        generationParameters: runtime.generationParameters,
      }),
      knowledgeBaseVersion: runtime.knowledgeBaseVersion,
      maxRepairs,
      maxAttempts,
      delayMs,
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    results = [];
  }
  const progress = new ConsoleEvaluationProgress();
  try {
    await executeRepairs({
      service: runtime.repairService,
      patchContextResolver: new VersionedPatchContextResolver(),
      sourceResults: source.results,
      files,
      run,
      initialResults: results,
      onProgress: (state) => progress.update(state),
    });
    progress.finish();
  } catch (error) {
    progress.stop();
    throw error;
  }
  process.stdout.write(`Résultats repair: ${files.directory}\n`);
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined && import.meta.url === pathToFileURL(resolve(entryPoint)).href;
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    process.stderr.write(`LaneLens repair failed: ${error instanceof Error ? error.message : 'erreur inconnue'}\n`);
    process.exitCode = 1;
  });
}
