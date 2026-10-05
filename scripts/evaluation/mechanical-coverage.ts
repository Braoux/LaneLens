import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  evaluateMechanicalCoverage,
  type MechanicalCoverageGateResult,
} from '../../server/knowledge/MechanicalCoverageGate.js';
import { EvaluationCorpusError, loadEvaluationCorpus } from './corpus.js';
import type { EvaluationCorpus } from './types.js';

export function mechanicalCoverageReport(corpus: EvaluationCorpus): MechanicalCoverageGateResult | undefined {
  if (corpus.fullCoverageGate === undefined) return undefined;
  return evaluateMechanicalCoverage(corpus.matchups, corpus.patch);
}

export function formatMechanicalCoverageReport(result: MechanicalCoverageGateResult): string {
  const lines = [
    'Golden benchmark',
    `${result.coveredMatchups}/${result.totalMatchups} mechanically fully covered`,
    `Champions: ${result.coveredChampions}/${result.totalChampions}`,
  ];
  for (const matchup of result.matchups.filter(({ fullyCovered }) => !fullyCovered)) {
    lines.push(`${matchup.id}: NOT FULLY COVERED`);
    lines.push(...matchup.missing.map((missing) => `- ${missing}`));
  }
  return lines.join('\n');
}

export function assertMechanicalCoverageGate(corpus: EvaluationCorpus): void {
  const result = mechanicalCoverageReport(corpus);
  if (result !== undefined && !result.fullyCovered) {
    throw new EvaluationCorpusError(
      `Corpus bloqué par le gate de couverture mécanique.\n${formatMechanicalCoverageReport(result)}`,
    );
  }
}

async function findDefaultGoldenCorpus(): Promise<string> {
  const directory = resolve('evaluation', 'corpus');
  const candidates = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => resolve(directory, entry.name));
  const gated: string[] = [];
  for (const candidate of candidates) {
    try {
      const loaded = await loadEvaluationCorpus(candidate);
      if (loaded.corpus.fullCoverageGate !== undefined) gated.push(candidate);
    } catch {
      // Invalid or unrelated files are reported by their own evaluation command.
    }
  }
  if (gated.length !== 1) {
    throw new EvaluationCorpusError(
      `Un unique corpus golden avec fullCoverageGate est attendu; trouvé : ${gated.length}.`,
    );
  }
  return gated[0]!;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (argv.length > 1) throw new Error('Usage: npm run eval:golden-coverage -- [corpus]');
  const path = argv[0] ?? await findDefaultGoldenCorpus();
  const loaded = await loadEvaluationCorpus(resolve(path));
  const result = mechanicalCoverageReport(loaded.corpus);
  if (result === undefined) throw new EvaluationCorpusError('Le corpus ne déclare aucun fullCoverageGate.');
  process.stdout.write(`${formatMechanicalCoverageReport(result)}\n`);
  if (!result.fullyCovered) process.exitCode = 1;
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined && import.meta.url === pathToFileURL(resolve(entryPoint)).href;
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Mechanical coverage failed.'}\n`);
    process.exitCode = 1;
  });
}
