import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareKnowledgeBaseImpact } from './comparison.js';
import type { EvaluationRun, EvaluationSummary } from './types.js';

function option(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index < 0 ? undefined : argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} est obligatoire.`);
  return value;
}

async function loadInput(file: string): Promise<{ readonly summary: EvaluationSummary; readonly run: EvaluationRun }> {
  const summaryPath = resolve(file);
  const [summary, run] = await Promise.all([
    readFile(summaryPath, 'utf8'),
    readFile(resolve(dirname(summaryPath), 'run.json'), 'utf8'),
  ]);
  return {
    summary: JSON.parse(summary) as EvaluationSummary,
    run: JSON.parse(run) as EvaluationRun,
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const before = await loadInput(option(argv, '--before'));
  const after = await loadInput(option(argv, '--after'));
  process.stdout.write(`${JSON.stringify(compareKnowledgeBaseImpact(before, after), null, 2)}\n`);
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(resolve(entryPoint)).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Comparaison impossible.'}\n`);
    process.exitCode = 1;
  });
}
