import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareEvaluationSummaries } from './comparison.js';
import type { EvaluationSummary } from './types.js';

function option(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index < 0 ? undefined : argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} est obligatoire.`);
  return value;
}

async function loadSummary(file: string): Promise<EvaluationSummary> {
  return JSON.parse(await readFile(resolve(file), 'utf8')) as EvaluationSummary;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const before = await loadSummary(option(argv, '--before'));
  const after = await loadSummary(option(argv, '--after'));
  process.stdout.write(`${JSON.stringify(compareEvaluationSummaries(before, after), null, 2)}\n`);
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(resolve(entryPoint)).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Comparaison impossible.'}\n`);
    process.exitCode = 1;
  });
}
