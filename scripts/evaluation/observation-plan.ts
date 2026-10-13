import type { CorpusMatchup, EvaluationResult, EvaluationRun } from './types.js';

export interface EvaluationObservation {
  readonly observationId: string;
  readonly matchup: CorpusMatchup;
  readonly repetition: number;
}

export function effectiveRepeat(run: Pick<EvaluationRun, 'repeat'>): number {
  return run.repeat ?? 1;
}

export function resultMatchupId(result: Pick<EvaluationResult, 'id' | 'matchupId'>): string {
  return result.matchupId ?? result.id;
}

export function observationId(matchupId: string, repetition: number, repeat: number): string {
  return repeat === 1 ? matchupId : `${matchupId}#${repetition}`;
}

export function buildObservationPlan(
  matchups: readonly CorpusMatchup[],
  repeat: number,
): readonly EvaluationObservation[] {
  if (!Number.isSafeInteger(repeat) || repeat < 1) {
    throw new Error('repeat must be a positive integer.');
  }
  return Object.freeze(matchups.flatMap((matchup) => Array.from(
    { length: repeat },
    (_, index) => Object.freeze({
      observationId: observationId(matchup.id, index + 1, repeat),
      matchup,
      repetition: index + 1,
    }),
  )));
}
