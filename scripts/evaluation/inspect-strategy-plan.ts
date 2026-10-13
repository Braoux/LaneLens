import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ProviderRetryMetadata } from '../../server/analysis/ProviderFailure.js';
import { createAnalysisRuntime } from '../../server/analysis/createAnalysisRuntime.js';
import { MatchupFactPackBuilder } from '../../server/knowledge/MatchupFactPackBuilder.js';
import type { MatchupFactPack } from '../../server/knowledge/MatchupFactPack.js';
import { strategyAssertions, type MatchupStrategyPlan } from '../../server/strategy/MatchupStrategyPlan.js';
import { StrategyPlanGenerationError } from '../../server/strategy/StrategyPlanGenerationService.js';
import { StrategyPlanValidator } from '../../server/strategy/StrategyPlanValidator.js';
import { loadEvaluationCorpus } from './corpus.js';
import { findDefaultFullCoverageCorpus } from './mechanical-coverage.js';

interface InspectStrategyPlanArguments {
  readonly corpus?: string;
  readonly id: string;
  readonly fixture?: string;
  readonly generate: boolean;
  readonly output?: string;
}

function requiredValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--') || value.trim().length === 0) {
    throw new Error(`${option} attend une valeur non vide.`);
  }
  return value.trim();
}

export function parseInspectStrategyPlanArguments(
  argv: readonly string[],
): InspectStrategyPlanArguments {
  let corpus: string | undefined;
  let id: string | undefined;
  let fixture: string | undefined;
  let output: string | undefined;
  let generate = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (option === '--generate') {
      generate = true;
      continue;
    }
    if (['--corpus', '--id', '--fixture', '--output'].includes(option)) {
      const value = requiredValue(argv, index, option);
      if (option === '--corpus') corpus = value;
      if (option === '--id') id = value;
      if (option === '--fixture') fixture = value;
      if (option === '--output') output = value;
      index += 1;
      continue;
    }
    throw new Error(`Option inconnue : ${option}`);
  }
  if (id === undefined) throw new Error('--id est obligatoire.');
  if ((fixture === undefined) === !generate) {
    throw new Error('Choisir exactement un mode : --fixture <path> ou --generate.');
  }
  return {
    ...(corpus === undefined ? {} : { corpus }),
    id,
    ...(fixture === undefined ? {} : { fixture }),
    generate,
    ...(output === undefined ? {} : { output }),
  };
}

function factCatalog(pack: MatchupFactPack): Map<string, unknown> {
  return new Map<string, unknown>([
    ...pack.championFacts.abilities.map((fact) => [fact.factId, fact] as const),
    ...pack.championFacts.knowledge.map((fact) => [fact.factId, fact] as const),
    ...pack.globalFacts.map((fact) => [fact.factId, fact] as const),
  ]);
}

function diagnosticArtifact(
  mode: 'fixture' | 'provider',
  pack: MatchupFactPack,
  plan: MatchupStrategyPlan | undefined,
  validation: ReturnType<StrategyPlanValidator['validate']>,
  provider?: {
    readonly name: string;
    readonly model: string;
    readonly generationParameters?: Readonly<Record<string, string | number | boolean>>;
    readonly metadata?: ProviderRetryMetadata;
  },
) {
  const facts = factCatalog(pack);
  return Object.freeze({
    schemaVersion: 1,
    inspectedAt: new Date().toISOString(),
    mode,
    matchupId: pack.matchupId,
    patch: pack.patch,
    factPackVersion: pack.factPackVersion,
    ...(provider === undefined ? {} : { provider }),
    ...(plan === undefined ? {} : { plan }),
    validation,
    assertions: plan === undefined ? [] : strategyAssertions(plan).map(({ path, assertion }) => ({
      path,
      text: assertion.text,
      grounding: assertion.grounding,
      factIds: assertion.factIds,
      resolvedFacts: assertion.factIds.flatMap((factId) => {
        const fact = facts.get(factId);
        return fact === undefined ? [] : [fact];
      }),
      invalidFactIds: assertion.factIds.filter((factId) => !facts.has(factId)),
      missingKnowledge: assertion.missingKnowledge,
    })),
  });
}

export async function inspectStrategyPlan(
  argv: readonly string[],
  write: (value: string) => void = (value) => process.stdout.write(value),
): Promise<void> {
  const args = parseInspectStrategyPlanArguments(argv);
  const corpusPath = resolve(args.corpus ?? await findDefaultFullCoverageCorpus());
  const loaded = await loadEvaluationCorpus(corpusPath);
  const matchup = loaded.corpus.matchups.find(({ id }) => id === args.id);
  if (matchup === undefined) throw new Error(`ID de matchup inexistant : ${args.id}`);
  const pack = new MatchupFactPackBuilder().build(matchup);
  const validator = new StrategyPlanValidator();
  let artifact;
  if (args.fixture !== undefined) {
    const candidate = JSON.parse(await readFile(resolve(args.fixture), 'utf8')) as unknown;
    const validation = validator.validate(candidate, pack);
    artifact = diagnosticArtifact('fixture', pack, validation.plan, validation);
  } else {
    const runtime = createAnalysisRuntime({ executionContext: 'evaluation' });
    if (runtime?.strategyPlanService === undefined) {
      throw new Error('Aucun provider structured-output configuré pour la génération.');
    }
    let metadata: ProviderRetryMetadata | undefined;
    try {
      const generated = await runtime.strategyPlanService.generate(pack, {
        onMetadata(value) { metadata = value; },
      });
      artifact = diagnosticArtifact('provider', pack, generated.plan, generated.validation, {
        name: runtime.provider,
        model: runtime.model,
        ...(runtime.generationParameters === undefined ? {} : {
          generationParameters: runtime.generationParameters,
        }),
        ...(metadata === undefined ? {} : { metadata }),
      });
    } catch (error) {
      if (error instanceof StrategyPlanGenerationError) {
        throw new Error(`Strategy Plan rejeté (${error.phase}) : ${error.issues
          .map(({ code, path }) => `${code}@${path}`).join(', ') || 'réponse non JSON'}`, {
          cause: error,
        });
      }
      throw error;
    }
  }
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  if (args.output === undefined) write(serialized);
  else await writeFile(resolve(args.output), serialized, { encoding: 'utf8', flag: 'wx' });
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined && import.meta.url === pathToFileURL(resolve(entryPoint)).href;
}

if (isMainModule()) {
  inspectStrategyPlan(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Strategy Plan inspection failed.'}\n`);
    process.exitCode = 1;
  });
}
