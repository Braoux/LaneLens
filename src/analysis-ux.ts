import { AnalysisRequestError, InvalidAnalysisResponseError } from './api';

export type AnalysisErrorAction = 'back' | 'retry' | 'regenerate';

export interface AnalysisErrorViewModel {
  readonly title: string;
  readonly message: string;
  readonly primaryAction: AnalysisErrorAction;
  readonly primaryLabel: string;
  readonly allowBack: boolean;
  readonly requestId?: string;
}

const REQUEST_ERRORS = new Set([
  'UNSUPPORTED_MEDIA_TYPE',
  'INVALID_JSON',
  'INVALID_MATCHUP_REQUEST',
]);

const TEMPORARY_ERRORS = new Set([
  'PATCH_CONTEXT_UNAVAILABLE',
  'ANALYSIS_NOT_CONFIGURED',
  'ANALYSIS_PROVIDER_UNAVAILABLE',
]);

const GENERIC_ERRORS = new Set([
  'ANALYSIS_FAILED',
  'INTERNAL_ERROR',
  'PATCH_CONTEXT_INVALID',
]);

export function toAnalysisErrorViewModel(error: unknown): AnalysisErrorViewModel {
  const requestId = error instanceof AnalysisRequestError ? error.requestId : undefined;
  const code = error instanceof AnalysisRequestError ? error.code : undefined;

  if (error instanceof InvalidAnalysisResponseError || code === 'INVALID_ANALYSIS_RESPONSE') {
    return {
      title: 'Analyse invalide',
      message: 'L’analyse reçue est invalide.',
      primaryAction: 'regenerate',
      primaryLabel: 'Régénérer',
      allowBack: true,
      requestId,
    };
  }

  if (code && REQUEST_ERRORS.has(code)) {
    return {
      title: 'Analyse impossible',
      message: 'Impossible de lancer cette analyse.',
      primaryAction: 'back',
      primaryLabel: 'Retour à la sélection',
      allowBack: false,
      requestId,
    };
  }

  if (code === 'PATCH_CONTEXT_NOT_FOUND') {
    return {
      title: 'Patch indisponible',
      message: 'Ce patch n’est pas disponible pour l’analyse.',
      primaryAction: 'back',
      primaryLabel: 'Retour à la sélection',
      allowBack: false,
      requestId,
    };
  }

  if (code && TEMPORARY_ERRORS.has(code)) {
    return {
      title: 'Service temporairement indisponible',
      message: 'Impossible de générer l’analyse pour le moment.',
      primaryAction: 'retry',
      primaryLabel: 'Réessayer',
      allowBack: true,
      requestId,
    };
  }

  if (code && GENERIC_ERRORS.has(code)) {
    return {
      title: 'Analyse impossible',
      message: 'Impossible de générer l’analyse.',
      primaryAction: 'retry',
      primaryLabel: 'Réessayer',
      allowBack: true,
      requestId,
    };
  }

  return {
    title: 'Service indisponible',
    message: 'Le service d’analyse est indisponible.',
    primaryAction: 'retry',
    primaryLabel: 'Réessayer',
    allowBack: true,
    requestId,
  };
}
