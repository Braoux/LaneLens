import { AnalysisRequestError, InvalidAnalysisResponseError } from './api';
import { createTranslator, DEFAULT_LOCALE } from './i18n';
import type { Translator } from './i18n';

const defaultTranslate = createTranslator(DEFAULT_LOCALE);

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

export function toAnalysisErrorViewModel(error: unknown, t: Translator = defaultTranslate): AnalysisErrorViewModel {
  const requestId = error instanceof AnalysisRequestError ? error.requestId : undefined;
  const code = error instanceof AnalysisRequestError ? error.code : undefined;

  if (error instanceof InvalidAnalysisResponseError || code === 'INVALID_ANALYSIS_RESPONSE') {
    return {
      title: t('error.analysisInvalidTitle'),
      message: t('error.analysisInvalid'),
      primaryAction: 'regenerate',
      primaryLabel: t('error.regenerate'),
      allowBack: true,
      requestId,
    };
  }

  if (code && REQUEST_ERRORS.has(code)) {
    return {
      title: t('error.analysisImpossibleTitle'),
      message: t('error.launchImpossible'),
      primaryAction: 'back',
      primaryLabel: t('error.back'),
      allowBack: false,
      requestId,
    };
  }

  if (code === 'PATCH_CONTEXT_NOT_FOUND') {
    return {
      title: t('error.patchUnavailableTitle'),
      message: t('error.patchUnavailable'),
      primaryAction: 'back',
      primaryLabel: t('error.back'),
      allowBack: false,
      requestId,
    };
  }

  if (code && TEMPORARY_ERRORS.has(code)) {
    return {
      title: t('error.temporaryTitle'),
      message: t('error.temporary'),
      primaryAction: 'retry',
      primaryLabel: t('error.retry'),
      allowBack: true,
      requestId,
    };
  }

  if (code && GENERIC_ERRORS.has(code)) {
    return {
      title: t('error.analysisImpossibleTitle'),
      message: t('error.analysisImpossible'),
      primaryAction: 'retry',
      primaryLabel: t('error.retry'),
      allowBack: true,
      requestId,
    };
  }

  return {
    title: t('error.serviceUnavailableTitle'),
    message: t('error.serviceUnavailable'),
    primaryAction: 'retry',
    primaryLabel: t('error.retry'),
    allowBack: true,
    requestId,
  };
}
