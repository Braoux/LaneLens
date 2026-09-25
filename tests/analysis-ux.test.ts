import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisRequestError, InvalidAnalysisResponseError, analysisRequestSignal } from '../src/api';
import { toAnalysisErrorViewModel } from '../src/analysis-ux';

test('LaneLens request errors map to deterministic provider-agnostic UX states', () => {
  const cases = [
    ['INVALID_MATCHUP_REQUEST', 'Impossible de lancer cette analyse.', 'back'],
    ['PATCH_CONTEXT_NOT_FOUND', 'Ce patch n’est pas disponible pour l’analyse.', 'back'],
    ['PATCH_CONTEXT_UNAVAILABLE', 'Impossible de générer l’analyse pour le moment.', 'retry'],
    ['ANALYSIS_NOT_CONFIGURED', 'Impossible de générer l’analyse pour le moment.', 'retry'],
    ['ANALYSIS_PROVIDER_UNAVAILABLE', 'Impossible de générer l’analyse pour le moment.', 'retry'],
    ['PATCH_CONTEXT_INVALID', 'Impossible de générer l’analyse.', 'retry'],
    ['ANALYSIS_FAILED', 'Impossible de générer l’analyse.', 'retry'],
    ['INTERNAL_ERROR', 'Impossible de générer l’analyse.', 'retry'],
  ] as const;

  for (const [code, message, action] of cases) {
    const view = toAnalysisErrorViewModel(new AnalysisRequestError(503, code, 'safe-request-id'));
    assert.equal(view.message, message);
    assert.equal(view.primaryAction, action);
    assert.equal(view.requestId, 'safe-request-id');
    assert.doesNotMatch(JSON.stringify(view), /OpenAI|Gemini|Groq|quota|API key/i);
  }
});

test('invalid provider output offers regeneration without exposing partial content', () => {
  const view = toAnalysisErrorViewModel(new InvalidAnalysisResponseError());
  assert.equal(view.message, 'L’analyse reçue est invalide.');
  assert.equal(view.primaryAction, 'regenerate');
  assert.equal(view.primaryLabel, 'Régénérer');
});

test('unknown, network, and timeout errors remain recoverable and sanitized', () => {
  for (const error of [new Error('provider-secret-token'), new DOMException('Timeout', 'TimeoutError'), null]) {
    const view = toAnalysisErrorViewModel(error);
    assert.equal(view.message, 'Le service d’analyse est indisponible.');
    assert.equal(view.primaryAction, 'retry');
    assert.doesNotMatch(JSON.stringify(view), /provider-secret-token|TimeoutError/);
  }
});

test('the analysis signal combines user cancellation with a frontend timeout', async () => {
  const controller = new AbortController();
  const cancelled = analysisRequestSignal(controller.signal, 1000);
  controller.abort();
  assert.equal(cancelled.aborted, true);

  const timedOut = analysisRequestSignal(undefined, 5);
  await new Promise((resolve) => timedOut.addEventListener('abort', resolve, { once: true }));
  assert.equal(timedOut.aborted, true);
  assert.equal(timedOut.reason.name, 'TimeoutError');
});
