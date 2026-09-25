import assert from 'node:assert/strict';
import test from 'node:test';
import { FeedbackRequestError, sendFeedback } from '../src/api';
import { buildAnalysisFeedbackRequest, buildBugFeedbackRequest } from '../src/feedback';

const environment = {
  view: 'matchup-result' as const,
  viewportWidth: 390,
  viewportHeight: 844,
  userAgent: ' Test browser ',
  appVersion: ' 0.1.0 ',
  requestId: ' f66dd1f0-b690-4d6d-b28d-725da9d96506 ',
};

test('frontend builds bounded feedback DTOs from known context without analysis content', () => {
  const request = buildAnalysisFeedbackRequest('timing_level', '  Galio R est indisponible.  ', {
    allyCarry: 'Ziggs', allySupport: 'Galio', enemyCarry: 'Jinx', enemySupport: 'Swain', patch: '26.19',
  }, environment);
  assert.deepEqual(request, {
    kind: 'analysis',
    category: 'timing_level',
    comment: 'Galio R est indisponible.',
    matchup: { allyCarry: 'Ziggs', allySupport: 'Galio', enemyCarry: 'Jinx', enemySupport: 'Swain', patch: '26.19' },
    client: {
      view: 'matchup-result',
      viewport: { width: 390, height: 844 },
      userAgent: 'Test browser',
      appVersion: '0.1.0',
      requestId: 'f66dd1f0-b690-4d6d-b28d-725da9d96506',
    },
  });
  assert.equal('analysis' in request, false);
  assert.equal('prompt' in request, false);
});

test('frontend omits an empty optional comment for global bug feedback', () => {
  assert.deepEqual(buildBugFeedbackRequest('ui_display', '   ', {
    view: 'selection', viewportWidth: 1440, viewportHeight: 900,
  }), {
    kind: 'bug',
    category: 'ui_display',
    client: { view: 'selection', viewport: { width: 1440, height: 900 } },
  });
});

test('sendFeedback posts only to the LaneLens endpoint and accepts the minimal response', async () => {
  let url = '';
  let init: RequestInit | undefined;
  const request = buildBugFeedbackRequest('history', 'Entrée absente.', {
    view: 'selection', viewportWidth: 820, viewportHeight: 1180,
  });
  const result = await sendFeedback(request, async (input, options) => {
    url = String(input);
    init = options;
    return Response.json({ status: 'accepted' }, { status: 202 });
  });
  assert.deepEqual(result, { status: 'accepted' });
  assert.equal(url, '/api/feedback');
  assert.equal(init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(init?.body)), request);
});

test('sendFeedback exposes neither backend bodies nor tracker details on failure', async () => {
  for (const response of [
    Response.json({ error: { code: 'FEEDBACK_UNAVAILABLE', message: 'private tracker secret' } }, { status: 503 }),
    Response.json({ status: 'accepted', issue: 123 }, { status: 202 }),
    new Response('private tracker dump', { status: 202 }),
  ]) {
    await assert.rejects(sendFeedback(buildBugFeedbackRequest('other', '', {
      view: 'selection', viewportWidth: 390, viewportHeight: 844,
    }), async () => response.clone()), (error: unknown) => {
      assert.ok(error instanceof FeedbackRequestError);
      assert.doesNotMatch(error.message, /private|tracker|secret|123/i);
      return true;
    });
  }
});
