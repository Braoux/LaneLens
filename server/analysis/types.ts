export interface PatchContextFact {
  readonly subject: string;
  readonly text: string;
}

export interface PatchContext {
  readonly patch: string;
  readonly contextVersion: string;
  readonly facts: readonly PatchContextFact[];
}

export interface MatchupAnalysisInput {
  readonly allyCarry: string;
  readonly allySupport: string;
  readonly enemyCarry: string;
  readonly enemySupport: string;
  readonly patch: string;
  readonly patchContext: PatchContext;
}

export type {
  MatchupAnalysis,
  MatchupAnalysisSource,
} from '../../shared/analysis-contract.js';

export interface MatchupAnalysisProviderRequest {
  readonly input: MatchupAnalysisInput;
  readonly instructions: string;
}
