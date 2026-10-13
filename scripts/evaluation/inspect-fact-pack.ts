import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MatchupFactPackBuilder } from '../../server/knowledge/MatchupFactPackBuilder.js';
import { loadEvaluationCorpus } from './corpus.js';
import { findDefaultFullCoverageCorpus } from './mechanical-coverage.js';

interface InspectArguments {
  readonly corpus?: string;
  readonly id: string;
}

function requiredValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--') || value.trim().length === 0) {
    throw new Error(`${option} attend une valeur non vide.`);
  }
  return value.trim();
}

export function parseInspectFactPackArguments(argv: readonly string[]): InspectArguments {
  let corpus: string | undefined;
  let id: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (option === '--corpus') {
      corpus = requiredValue(argv, index, option);
      index += 1;
      continue;
    }
    if (option === '--id') {
      id = requiredValue(argv, index, option);
      index += 1;
      continue;
    }
    throw new Error(`Option inconnue : ${option}`);
  }
  if (id === undefined) throw new Error('--id est obligatoire.');
  return { ...(corpus === undefined ? {} : { corpus }), id };
}

export async function inspectFactPack(
  argv: readonly string[],
  write: (value: string) => void = (value) => process.stdout.write(value),
): Promise<void> {
  const args = parseInspectFactPackArguments(argv);
  const corpusPath = resolve(args.corpus ?? await findDefaultFullCoverageCorpus());
  const loaded = await loadEvaluationCorpus(corpusPath);
  if (loaded.corpus.fullCoverageGate === undefined) {
    throw new Error('Le corpus ne déclare aucun fullCoverageGate.');
  }
  const matchup = loaded.corpus.matchups.find(({ id }) => id === args.id);
  if (matchup === undefined) throw new Error(`ID de matchup inexistant : ${args.id}`);
  const factPack = new MatchupFactPackBuilder().build(matchup);
  write(`${JSON.stringify(factPack, null, 2)}\n`);
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined && import.meta.url === pathToFileURL(resolve(entryPoint)).href;
}

if (isMainModule()) {
  inspectFactPack(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Fact Pack inspection failed.'}\n`);
    process.exitCode = 1;
  });
}
