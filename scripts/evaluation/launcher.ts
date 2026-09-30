import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { loadGeminiConfig } from '../../server/analysis/providers/gemini-config.js';
import { loadGroqConfig } from '../../server/analysis/providers/groq-config.js';
import { loadOpenAIConfig } from '../../server/analysis/providers/openai-config.js';
import {
  resolveAIProvider,
  type AIEnvironment,
  type AIProviderName,
} from '../../server/analysis/providers/ai-provider-config.js';
import { loadEvaluationCorpus, selectCorpusMatchups } from './corpus.js';
import { loadEvaluationRun, runFiles } from './result-writer.js';
import type { EvaluationResult } from './types.js';

const CONFIG_RELATIVE_PATH = '.lanelens-evaluation/launcher.json';
const DEFAULT_RESULTS_RELATIVE_PATH = '.lanelens-evaluation/runs';
const TERMINAL_STATUSES = new Set<EvaluationResult['status']>([
  'success',
  'invalid_analysis',
  'rate_limited',
  'provider_error',
  'execution_error',
]);

export interface LauncherConfig {
  readonly corpusPath?: string;
  readonly resultsRoot?: string;
}

export interface ProviderPreflight {
  readonly provider: AIProviderName;
  readonly model: string;
}

export interface EvaluationRunInfo {
  readonly directory: string;
  readonly name: string;
  readonly runId: string;
  readonly corpusFile: string;
  readonly provider: string;
  readonly model: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completed: number;
  readonly total: number;
  readonly remaining: number;
  readonly success: number;
  readonly failed: number;
  readonly isComplete: boolean;
  readonly resultsPath: string;
  readonly summaryPath: string;
}

export type LauncherExecutionMode = 'full' | 'sentinels' | 'single' | 'resume';

export interface LauncherExecutionRequest {
  readonly mode: LauncherExecutionMode;
  readonly corpusPath: string;
  readonly outputDirectory?: string;
  readonly resumeDirectory?: string;
  readonly matchupId?: string;
}

export class EvaluationLauncherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvaluationLauncherError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function launcherConfigPath(workingDirectory: string): string {
  return resolve(workingDirectory, CONFIG_RELATIVE_PATH);
}

export async function loadLauncherConfig(workingDirectory: string): Promise<LauncherConfig> {
  try {
    const value = JSON.parse(await readFile(launcherConfigPath(workingDirectory), 'utf8')) as unknown;
    if (!isRecord(value)) return {};
    return {
      ...(typeof value.corpusPath === 'string' && value.corpusPath.trim().length > 0
        ? { corpusPath: resolve(value.corpusPath) }
        : {}),
      ...(typeof value.resultsRoot === 'string' && value.resultsRoot.trim().length > 0
        ? { resultsRoot: resolve(value.resultsRoot) }
        : {}),
    };
  } catch {
    return {};
  }
}

export async function saveLauncherConfig(
  workingDirectory: string,
  config: LauncherConfig,
): Promise<void> {
  const path = launcherConfigPath(workingDirectory);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export async function discoverCorpusPath(options: {
  readonly workingDirectory: string;
  readonly environment?: AIEnvironment;
  readonly config?: LauncherConfig;
}): Promise<string | undefined> {
  const configured = options.environment?.LANELENS_EVALUATION_CORPUS?.trim();
  if (configured) return resolve(configured);
  if (options.config?.corpusPath) return resolve(options.config.corpusPath);

  const conventional = resolve(
    options.workingDirectory,
    '..',
    'LaneLens-Internal',
    'docs',
    'delivery',
    'LAN-032',
    'evaluation',
    'lan-032-corpus-v1.json',
  );
  return await exists(conventional) ? conventional : undefined;
}

export function resolveResultsRoot(options: {
  readonly workingDirectory: string;
  readonly environment?: AIEnvironment;
  readonly config?: LauncherConfig;
}): string {
  const configured = options.environment?.LANELENS_EVALUATION_RESULTS?.trim();
  return resolve(configured || options.config?.resultsRoot || resolve(
    options.workingDirectory,
    DEFAULT_RESULTS_RELATIVE_PATH,
  ));
}

function terminal(result: EvaluationResult): boolean {
  return TERMINAL_STATUSES.has(result.status);
}

async function latestMtime(paths: readonly string[]): Promise<string> {
  const times = await Promise.all(paths.map(async (path) => {
    try {
      return (await stat(path)).mtimeMs;
    } catch {
      return 0;
    }
  }));
  return new Date(Math.max(...times, 0)).toISOString();
}

export async function readRunInfo(directory: string): Promise<EvaluationRunInfo> {
  const loaded = await loadEvaluationRun(directory);
  const total = loaded.run.selectedIds.length;
  const completedResults = loaded.results.filter(
    (result) => loaded.run.selectedIds.includes(result.id) && terminal(result),
  );
  const completed = completedResults.length;
  const success = completedResults.filter(({ status }) => status === 'success').length;
  const failed = completedResults.filter(({ status }) => status !== 'success').length;
  const updatedAt = await latestMtime([loaded.files.run, loaded.files.results, loaded.files.summary]);
  return Object.freeze({
    directory: loaded.files.directory,
    name: basename(loaded.files.directory),
    runId: loaded.run.runId,
    corpusFile: loaded.run.corpusFile,
    provider: loaded.run.provider,
    model: loaded.run.model,
    startedAt: loaded.run.startedAt,
    updatedAt,
    completed,
    total,
    remaining: Math.max(0, total - completed),
    success,
    failed,
    isComplete: completed >= total && loaded.run.completedAt !== null,
    resultsPath: loaded.files.results,
    summaryPath: loaded.files.summary,
  });
}

async function findRunDirectories(root: string, maxDepth: number): Promise<string[]> {
  if (maxDepth < 0) return [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  if (entries.some((entry) => entry.isFile() && entry.name === 'run.json')) return [root];
  const nested = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => findRunDirectories(resolve(root, entry.name), maxDepth - 1)));
  return nested.flat();
}

export async function discoverEvaluationRuns(
  roots: readonly string[],
): Promise<readonly EvaluationRunInfo[]> {
  const directories = new Set((await Promise.all(
    roots.map((root) => findRunDirectories(resolve(root), 3)),
  )).flat());
  const runs = await Promise.all([...directories].map(async (directory) => {
    try {
      return await readRunInfo(directory);
    } catch {
      return undefined;
    }
  }));
  return Object.freeze(runs
    .filter((run): run is EvaluationRunInfo => run !== undefined)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
}

export function latestIncompleteRun(
  runs: readonly EvaluationRunInfo[],
): EvaluationRunInfo | undefined {
  return runs
    .filter(({ isComplete }) => !isComplete)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export function buildEvaluationArguments(request: LauncherExecutionRequest): readonly string[] {
  const corpusPath = resolve(request.corpusPath);
  if (request.mode === 'resume') {
    if (!request.resumeDirectory) throw new EvaluationLauncherError('Le dossier du run à reprendre est requis.');
    return ['--corpus', corpusPath, '--resume', resolve(request.resumeDirectory)];
  }
  if (!request.outputDirectory) throw new EvaluationLauncherError('Le dossier de sortie est requis.');
  const args = ['--corpus', corpusPath, '--output', resolve(request.outputDirectory)];
  if (request.mode === 'sentinels') args.push('--sentinels');
  if (request.mode === 'single') {
    if (!request.matchupId) throw new EvaluationLauncherError('L’identifiant du matchup est requis.');
    args.push('--id', request.matchupId);
  }
  return args;
}

export async function assertMatchupExists(corpusPath: string, matchupId: string): Promise<string> {
  const normalized = matchupId.trim().toUpperCase();
  if (normalized.length === 0) throw new EvaluationLauncherError('L’identifiant du matchup est vide.');
  const loaded = await loadEvaluationCorpus(resolve(corpusPath));
  try {
    selectCorpusMatchups(loaded.corpus, { sentinels: false, id: normalized });
  } catch {
    throw new EvaluationLauncherError(`ID de matchup inconnu : ${normalized}.`);
  }
  return normalized;
}

export function assertCompatibleNodeVersion(version: string): void {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (match === null) throw new EvaluationLauncherError(`Version Node illisible : ${version}.`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const belowMinimum = major < 22 || (major === 22 && (minor < 13 || (minor === 13 && patch < 1)));
  if (belowMinimum || major >= 25) {
    throw new EvaluationLauncherError('Node.js >= 22.13.1 et < 25 est requis.');
  }
}

export async function assertLocalDependencies(workingDirectory: string): Promise<void> {
  const executable = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';
  const tsxPath = resolve(workingDirectory, 'node_modules', '.bin', executable);
  if (!(await exists(tsxPath))) {
    throw new EvaluationLauncherError('Les dépendances sont absentes. Exécutez « npm install » puis relancez le launcher.');
  }
}

export function preflightProvider(
  environment: AIEnvironment = process.env,
): ProviderPreflight {
  let provider: AIProviderName;
  try {
    provider = resolveAIProvider(environment.AI_PROVIDER);
  } catch {
    throw new EvaluationLauncherError('AI_PROVIDER est invalide. Valeurs acceptées : openai, gemini, groq.');
  }
  const keyName = {
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
    groq: 'GROQ_API_KEY',
  }[provider];
  if ((environment[keyName]?.trim() ?? '').length === 0) {
    throw new EvaluationLauncherError(`${keyName} n’est pas configurée. Configurez la variable puis relancez le launcher.`);
  }
  try {
    const config = {
      openai: loadOpenAIConfig,
      gemini: loadGeminiConfig,
      groq: loadGroqConfig,
    }[provider](environment);
    return Object.freeze({ provider, model: config.model });
  } catch {
    throw new EvaluationLauncherError(`La configuration ${provider} est invalide. Vérifiez le modèle et le timeout configurés.`);
  }
}

export async function ensureWritableDirectory(directory: string): Promise<string> {
  const absolute = resolve(directory);
  try {
    await mkdir(absolute, { recursive: true });
    await access(absolute, constants.R_OK | constants.W_OK);
    return absolute;
  } catch {
    throw new EvaluationLauncherError(`Le répertoire n’est pas accessible en écriture : ${absolute}`);
  }
}

export async function assertNewOutputPath(outputDirectory: string): Promise<void> {
  if (await exists(resolve(outputDirectory))) {
    throw new EvaluationLauncherError(`Le répertoire de sortie existe déjà : ${resolve(outputDirectory)}`);
  }
}

export async function createRunOutputPath(options: {
  readonly resultsRoot: string;
  readonly now?: Date;
  readonly id?: string;
}): Promise<string> {
  const timestamp = (options.now ?? new Date()).toISOString().replaceAll(/[:.]/gu, '-');
  const suffix = options.id ?? randomUUID();
  const output = resolve(options.resultsRoot, `${timestamp}-${suffix}`);
  await assertNewOutputPath(output);
  return output;
}

export async function preflightEvaluation(options: {
  readonly workingDirectory: string;
  readonly corpusPath: string;
  readonly outputDirectory?: string;
  readonly resumeDirectory?: string;
  readonly environment?: AIEnvironment;
  readonly nodeVersion?: string;
}): Promise<ProviderPreflight> {
  assertCompatibleNodeVersion(options.nodeVersion ?? process.versions.node);
  await assertLocalDependencies(options.workingDirectory);
  await loadEvaluationCorpus(resolve(options.corpusPath));
  const provider = preflightProvider(options.environment);
  if (options.outputDirectory !== undefined) {
    await ensureWritableDirectory(dirname(resolve(options.outputDirectory)));
    await assertNewOutputPath(options.outputDirectory);
  }
  if (options.resumeDirectory !== undefined) {
    const files = runFiles(options.resumeDirectory);
    await loadEvaluationRun(files.directory);
    try {
      await access(files.directory, constants.R_OK | constants.W_OK);
    } catch {
      throw new EvaluationLauncherError(`Le run n’est pas accessible en écriture : ${files.directory}`);
    }
  }
  return provider;
}

export function runSearchRoots(options: {
  readonly corpusPath?: string;
  readonly resultsRoot: string;
}): readonly string[] {
  const roots = new Set([resolve(options.resultsRoot)]);
  if (options.corpusPath !== undefined) {
    roots.add(resolve(dirname(options.corpusPath), 'results'));
  }
  return Object.freeze([...roots]);
}
