import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { StructuredOutputProvider } from '../../server/analysis/StructuredOutputProvider.js';
import { ExperimentalFactGroundedPipeline } from '../../server/strategy/ExperimentalFactGroundedPipeline.js';
import { StrategyPlanGenerationService } from '../../server/strategy/StrategyPlanGenerationService.js';
import { TargetedStrategyPlanRepairService } from '../../server/strategy/TargetedStrategyPlanRepairService.js';
import { loadEvaluationCorpus } from './corpus.js';
import { findDefaultFullCoverageCorpus } from './mechanical-coverage.js';

export interface InspectFactGroundedPipelineArguments {
  readonly corpus?: string;
  readonly id: string;
  readonly fixture: string;
  readonly repairFixture?: string;
  readonly maxRepairs: 0 | 1 | 2;
  readonly output?: string;
}

function requiredValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--') || value.trim().length === 0) {
    throw new Error(`${option} attend une valeur non vide.`);
  }
  return value.trim();
}

export function parseInspectFactGroundedPipelineArguments(
  argv: readonly string[],
): InspectFactGroundedPipelineArguments {
  let corpus: string | undefined;
  let id: string | undefined;
  let fixture: string | undefined;
  let repairFixture: string | undefined;
  let output: string | undefined;
  let maxRepairs: 0 | 1 | 2 = 0;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (['--corpus', '--id', '--fixture', '--repair-fixture', '--max-repairs', '--output'].includes(option)) {
      const value = requiredValue(argv, index, option);
      if (option === '--corpus') corpus = value;
      if (option === '--id') id = value;
      if (option === '--fixture') fixture = value;
      if (option === '--repair-fixture') repairFixture = value;
      if (option === '--output') output = value;
      if (option === '--max-repairs') {
        const parsed = Number(value);
        if (parsed !== 0 && parsed !== 1 && parsed !== 2) {
          throw new Error('--max-repairs accepte uniquement 0, 1 ou 2.');
        }
        maxRepairs = parsed;
      }
      index += 1;
      continue;
    }
    throw new Error(`Option inconnue : ${option}`);
  }
  if (id === undefined) throw new Error('--id est obligatoire.');
  if (fixture === undefined) throw new Error('--fixture est obligatoire.');
  if (maxRepairs > 0 && repairFixture === undefined) {
    throw new Error('--repair-fixture est obligatoire lorsque --max-repairs est supérieur à 0.');
  }
  return {
    ...(corpus === undefined ? {} : { corpus }),
    id,
    fixture,
    ...(repairFixture === undefined ? {} : { repairFixture }),
    maxRepairs,
    ...(output === undefined ? {} : { output }),
  };
}

export async function inspectFactGroundedPipeline(
  argv: readonly string[],
  write: (value: string) => void = (value) => process.stdout.write(value),
): Promise<void> {
  const args = parseInspectFactGroundedPipelineArguments(argv);
  const corpusPath = resolve(args.corpus ?? await findDefaultFullCoverageCorpus());
  const loaded = await loadEvaluationCorpus(corpusPath);
  const matchup = loaded.corpus.matchups.find(({ id }) => id === args.id);
  if (matchup === undefined) throw new Error(`ID de matchup inexistant : ${args.id}`);
  const initial = JSON.parse(await readFile(resolve(args.fixture), 'utf8')) as unknown;
  const repairs = args.repairFixture === undefined
    ? []
    : JSON.parse(await readFile(resolve(args.repairFixture), 'utf8')) as unknown;
  if (!Array.isArray(repairs)) throw new Error('La fixture de repair doit contenir un tableau JSON.');
  let repairIndex = 0;
  const provider: StructuredOutputProvider = {
    async generateStructured(request) {
      if (request.schemaName === 'matchup_strategy_plan') return initial;
      const replacement = repairs[repairIndex];
      repairIndex += 1;
      return replacement;
    },
  };
  const pipeline = new ExperimentalFactGroundedPipeline(
    new StrategyPlanGenerationService(provider),
    new TargetedStrategyPlanRepairService(provider),
  );
  const artifact = await pipeline.run(matchup, {
    locale: 'fr-FR',
    maxRepairs: args.maxRepairs,
    provider: 'fixture',
    model: 'deterministic-fixture',
  });
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  if (args.output === undefined) write(serialized);
  else await writeFile(resolve(args.output), serialized, { encoding: 'utf8', flag: 'wx' });
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined && import.meta.url === pathToFileURL(resolve(entryPoint)).href;
}

if (isMainModule()) {
  inspectFactGroundedPipeline(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Pipeline inspection failed.'}\n`);
    process.exitCode = 1;
  });
}
