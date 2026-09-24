export type MatchupAnalysisErrorCode =
  | 'ANALYSIS_PROVIDER_UNAVAILABLE'
  | 'INVALID_ANALYSIS_RESPONSE'
  | 'ANALYSIS_FAILED';

const SAFE_MESSAGES: Record<MatchupAnalysisErrorCode, string> = {
  ANALYSIS_PROVIDER_UNAVAILABLE: 'Le service d’analyse est indisponible.',
  INVALID_ANALYSIS_RESPONSE: 'Le service d’analyse a retourné une réponse invalide.',
  ANALYSIS_FAILED: 'Impossible de générer l’analyse.',
};

export class MatchupAnalysisError extends Error {
  readonly code: MatchupAnalysisErrorCode;

  constructor(code: MatchupAnalysisErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'MatchupAnalysisError';
    this.code = code;
  }
}
