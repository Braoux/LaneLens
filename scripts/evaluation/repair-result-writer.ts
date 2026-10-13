import { access, mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeJsonAtomically } from './result-writer.js';
import type { RepairResult, RepairResultsFile, RepairRun, RepairSummary } from './repair-types.js';

export interface RepairRunFiles {
  readonly directory: string;
  readonly run: string;
  readonly results: string;
  readonly summary: string;
}

export function repairRunFiles(directory: string): RepairRunFiles {
  const absolute = resolve(directory);
  return {
    directory: absolute,
    run: resolve(absolute, 'repair-run.json'),
    results: resolve(absolute, 'repair-results.json'),
    summary: resolve(absolute, 'repair-summary.json'),
  };
}

export async function prepareRepairRunDirectory(directory: string): Promise<RepairRunFiles> {
  const files = repairRunFiles(directory);
  await mkdir(files.directory, { recursive: true });
  if ((await readdir(files.directory)).length > 0) {
    throw new Error(`Le répertoire de repair existe déjà et n’est pas vide : ${files.directory}`);
  }
  return files;
}

export async function persistRepairRun(
  files: RepairRunFiles,
  run: RepairRun,
  results: readonly RepairResult[],
  summary: RepairSummary,
): Promise<void> {
  await writeJsonAtomically(files.run, run);
  const resultFile: RepairResultsFile = { schemaVersion: 1, results };
  await writeJsonAtomically(files.results, resultFile);
  await writeJsonAtomically(files.summary, summary);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function loadRepairRun(directory: string): Promise<{
  readonly files: RepairRunFiles;
  readonly run: RepairRun;
  readonly results: RepairResult[];
}> {
  const files = repairRunFiles(directory);
  await Promise.all([access(files.run), access(files.results)]);
  const [run, results] = await Promise.all([readJson(files.run), readJson(files.results)]);
  if (!isRecord(run) || run.schemaVersion !== 1 || !Array.isArray(run.selectedIds)) {
    throw new Error('repair-run.json ne respecte pas le format attendu.');
  }
  if (!isRecord(results) || results.schemaVersion !== 1 || !Array.isArray(results.results)) {
    throw new Error('repair-results.json ne respecte pas le format attendu.');
  }
  return {
    files,
    run: run as unknown as RepairRun,
    results: results.results as RepairResult[],
  };
}
