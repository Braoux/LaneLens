import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyProviderFailure,
  providerFailureDetails,
} from '../server/analysis/ProviderFailure.js';

function failure(status: number | undefined, message: string, name = 'ProviderError') {
  return Object.assign(new Error(message), {
    name,
    ...(status === undefined ? {} : { status }),
  });
}

test('provider failures are classified without depending on a concrete SDK', () => {
  const cases = [
    [failure(401, 'invalid API key'), 'authentication', 401],
    [failure(402, 'Insufficient Balance (request_id: ds-balance-request)'), 'insufficient_balance', 402],
    [failure(429, 'quota exceeded'), 'rate_limit', 429],
    [failure(404, 'model was not found'), 'model_not_found', 404],
    [failure(400, 'configured model is unavailable'), 'model_not_found', 400],
    [failure(400, 'invalid response format'), 'invalid_request', 400],
    [failure(422, 'invalid parameters'), 'invalid_request', 422],
    [failure(undefined, 'request timed out', 'TimeoutError'), 'timeout', undefined],
    [failure(undefined, 'fetch failed: ECONNRESET'), 'network', undefined],
    [failure(503, 'service unavailable'), 'provider_server_error', 503],
    [failure(undefined, 'unexpected provider failure'), 'unknown', undefined],
  ] as const;

  for (const [error, category, status] of cases) {
    assert.deepEqual(classifyProviderFailure(error), {
      category,
      ...(status === undefined ? {} : { status }),
    });
  }
});

test('safe provider request IDs remain available for correlated diagnostics', () => {
  const details = providerFailureDetails('deepseek', 'deepseek-flash', Object.assign(
    failure(503, 'service unavailable'),
    { requestID: 'ds-request-123' },
  ));
  assert.equal(details.providerRequestId, 'ds-request-123');
  assert.equal(
    providerFailureDetails(
      'deepseek',
      'deepseek-flash',
      failure(402, 'Insufficient Balance (request_id: ds-message-request)'),
    ).providerRequestId,
    'ds-message-request',
  );
});

test('HTTP status takes precedence over misleading text in provider errors', () => {
  assert.deepEqual(
    classifyProviderFailure(failure(429, 'API key quota exceeded')),
    { category: 'rate_limit', status: 429 },
  );
});

test('provider diagnostics prefer the safe API message and discard generated payloads', () => {
  const details = providerFailureDetails('groq', 'openai/gpt-oss-120b', Object.assign(
    new Error('400 body contains failed_generation and a complete model response'),
    {
      status: 400,
      error: {
        message: 'Generated JSON does not match the expected schema.',
        failed_generation: '{"secretResponse":"must-not-appear"}',
      },
    },
  ));

  assert.equal(details.errorMessage, 'Generated JSON does not match the expected schema.');
  assert.doesNotMatch(JSON.stringify(details), /secretResponse|must-not-appear|failed_generation/);
});
