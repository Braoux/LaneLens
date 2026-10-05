import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  EvaluationResult,
  EvaluationResultsFile,
  EvaluationRun,
  EvaluationSummary,
} from './types.js';

export class EvaluationPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvaluationPersistenceError';
  }
}

export interface RunFiles {
  readonly directory: string;
  readonly run: string;
  readonly results: string;
  readonly summary: string;
}

const WINDOWS_RETRY_DELAYS_MS = [10, 25, 50, 100, 200] as const;
const RETRYABLE_WINDOWS_ERROR_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

interface FileReplacementDependencies {
  readonly renameFile?: typeof rename;
  readonly unlinkFile?: typeof unlink;
  readonly fileExists?: (path: string) => Promise<boolean>;
  readonly sleep?: (durationMs: number) => Promise<void>;
  readonly randomId?: () => string;
}

export function runFiles(directory: string): RunFiles {
  const absolute = resolve(directory);
  return {
    directory: absolute,
    run: resolve(absolute, 'run.json'),
    results: resolve(absolute, 'results.json'),
    summary: resolve(absolute, 'summary.json'),
  };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function retryableWindowsError(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && RETRYABLE_WINDOWS_ERROR_CODES.has(code);
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, durationMs));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
}

async function retryWindowsOperation(
  operation: () => Promise<void>,
  sleep: (durationMs: number) => Promise<void>,
): Promise<void> {
  for (const retryDelayMs of WINDOWS_RETRY_DELAYS_MS) {
    try {
      await operation();
      return;
    } catch (error) {
      if (!retryableWindowsError(error)) throw error;
      await sleep(retryDelayMs);
    }
  }
  await operation();
}

async function bestEffortUnlink(
  path: string,
  unlinkFile: typeof unlink,
  sleep: (durationMs: number) => Promise<void>,
): Promise<void> {
  try {
    await retryWindowsOperation(() => unlinkFile(path), sleep);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') return;
  }
}

export async function replaceFileSafely(
  temporaryPath: string,
  targetPath: string,
  dependencies: FileReplacementDependencies = {},
): Promise<void> {
  const renameFile = dependencies.renameFile ?? rename;
  const unlinkFile = dependencies.unlinkFile ?? unlink;
  const exists = dependencies.fileExists ?? pathExists;
  const sleep = dependencies.sleep ?? wait;
  const backupPath = `${targetPath}.${(dependencies.randomId ?? randomUUID)()}.bak`;

  try {
    await retryWindowsOperation(() => renameFile(temporaryPath, targetPath), sleep);
    return;
  } catch (error) {
    if (!retryableWindowsError(error) || !(await exists(targetPath))) throw error;
  }

  await retryWindowsOperation(() => renameFile(targetPath, backupPath), sleep);
  try {
    await retryWindowsOperation(() => renameFile(temporaryPath, targetPath), sleep);
  } catch (error) {
    try {
      await retryWindowsOperation(() => renameFile(backupPath, targetPath), sleep);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        `Impossible de remplacer ou restaurer le snapshot ${targetPath}.`,
        { cause: restoreError },
      );
    }
    throw error;
  }
  await bestEffortUnlink(backupPath, unlinkFile, sleep);
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporaryPath, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await replaceFileSafely(temporaryPath, path);
  } finally {
    await bestEffortUnlink(temporaryPath, unlink, wait);
  }
}

export async function prepareNewRunDirectory(directory: string): Promise<RunFiles> {
  const files = runFiles(directory);
  await mkdir(files.directory, { recursive: true });
  const entries = await readdir(files.directory);
  if (entries.length > 0) {
    throw new EvaluationPersistenceError(
      `Le répertoire de sortie existe déjà et n’est pas vide : ${files.directory}`,
    );
  }
  return files;
}

export async function persistEvaluation(
  files: RunFiles,
  run: EvaluationRun,
  results: readonly EvaluationResult[],
  summary: EvaluationSummary,
): Promise<void> {
  await writeJsonAtomically(files.run, run);
  const resultsFile: EvaluationResultsFile = { schemaVersion: 1, results };
  await writeJsonAtomically(files.results, resultsFile);
  await writeJsonAtomically(files.summary, summary);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new EvaluationPersistenceError(`Run illisible ou invalide : ${path}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function loadEvaluationRun(directory: string): Promise<{
  readonly files: RunFiles;
  readonly run: EvaluationRun;
  readonly results: EvaluationResult[];
}> {
  const files = runFiles(directory);
  const [runValue, resultsValue] = await Promise.all([
    readJson(files.run),
    readJson(files.results),
  ]);
  if (!isRecord(runValue) || runValue.schemaVersion !== 1 || !Array.isArray(runValue.selectedIds)) {
    throw new EvaluationPersistenceError('run.json ne respecte pas le format d’évaluation V1.');
  }
  if (
    runValue.repeat !== undefined
    && (typeof runValue.repeat !== 'number' || !Number.isSafeInteger(runValue.repeat) || runValue.repeat < 1)
  ) {
    throw new EvaluationPersistenceError('run.json contient un nombre de répétitions invalide.');
  }
  if (!isRecord(resultsValue) || resultsValue.schemaVersion !== 1 || !Array.isArray(resultsValue.results)) {
    throw new EvaluationPersistenceError('results.json ne respecte pas le format d’évaluation V1.');
  }
  return {
    files,
    run: runValue as unknown as EvaluationRun,
    results: resultsValue.results as EvaluationResult[],
  };
}
