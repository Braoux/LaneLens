import type { MatchupAnalysis } from './types.js';
import type { AnalysisConformanceViolation } from './AnalysisConformanceValidator.js';
import type { AnalysisLanguageViolation } from './AnalysisLanguageValidator.js';

export type RejectedAnalysisPhase = 'parsing' | 'shape' | 'conformance' | 'language';

export class RejectedAnalysisFailure extends Error {
  readonly response: unknown;
  readonly phase: RejectedAnalysisPhase;
  readonly candidate?: MatchupAnalysis;
  readonly conformanceViolations?: readonly AnalysisConformanceViolation[];
  readonly languageViolations?: readonly AnalysisLanguageViolation[];

  constructor(options: {
    readonly response: unknown;
    readonly phase: RejectedAnalysisPhase;
    readonly candidate?: MatchupAnalysis;
    readonly conformanceViolations?: readonly AnalysisConformanceViolation[];
    readonly languageViolations?: readonly AnalysisLanguageViolation[];
    readonly cause?: Error;
  }) {
    super('Analysis candidate was rejected.', options.cause === undefined ? undefined : {
      cause: options.cause,
    });
    this.name = 'RejectedAnalysisFailure';
    this.response = options.response;
    this.phase = options.phase;
    this.candidate = options.candidate;
    this.conformanceViolations = options.conformanceViolations;
    this.languageViolations = options.languageViolations;
  }
}

export function findRejectedAnalysisFailure(error: unknown): RejectedAnalysisFailure | undefined {
  let current = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof RejectedAnalysisFailure) return current;
    seen.add(current);
    current = current.cause;
  }
  return undefined;
}
