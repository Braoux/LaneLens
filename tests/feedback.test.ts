import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { FeedbackService } from '../server/feedback/FeedbackService.js';
import {
  FeedbackTrackerUnavailableError,
  GitHubFeedbackTracker,
} from '../server/feedback/GitHubFeedbackTracker.js';
import {
  FeedbackTrackerConfigurationError,
  loadGitHubFeedbackTrackerConfig,
} from '../server/feedback/github-config.js';
import type { FeedbackIssueDraft, FeedbackTracker } from '../server/feedback/types.js';
import { normalizeFeedbackRequest } from '../server/feedback/validation.js';
import type { Logger, LogFields } from '../server/logging/Logger.js';
import { createRuntimeApp } from '../server/runtime.js';
import type { FeedbackRequest } from '../shared/feedback-contract.js';

const requestId = 'f66dd1f0-b690-4d6d-b28d-725da9d96506';
const analysisFeedback: FeedbackRequest = {
  kind: 'analysis',
  category: 'timing_level',
  comment: 'Galio ne peut pas utiliser son R au niveau 3.',
  matchup: {
    allyCarry: 'Ziggs',
    allySupport: 'Galio',
    enemyCarry: 'Jinx',
    enemySupport: 'Swain',
    patch: '26.19',
  },
  client: {
    view: 'matchup-result',
    viewport: { width: 1440, height: 900 },
    appVersion: '0.1.0',
    requestId,
    userAgent: 'LaneLens test browser',
  },
};

async function postFeedback(app: ReturnType<typeof createApp>, body: unknown): Promise<Response> {
  return app.request('/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('feedback validation normalizes safe analysis and bug requests', () => {
  assert.deepEqual(normalizeFeedbackRequest(analysisFeedback), analysisFeedback);
  assert.deepEqual(normalizeFeedbackRequest({
    kind: 'bug',
    category: 'responsive_mobile',
    client: { view: 'selection', viewport: { width: 390, height: 844 } },
  }), {
    kind: 'bug',
    category: 'responsive_mobile',
    client: { view: 'selection', viewport: { width: 390, height: 844 } },
  });
});

test('feedback validation rejects unknown fields, categories, oversized content, and invalid context', () => {
  const invalid = [
    null,
    [],
    { ...analysisFeedback, secret: 'must-not-be-accepted' },
    { ...analysisFeedback, category: 'provider_failure' },
    { ...analysisFeedback, comment: 'x'.repeat(1001) },
    { ...analysisFeedback, client: { ...analysisFeedback.client, requestId: 'not-a-uuid' } },
    { ...analysisFeedback, client: { ...analysisFeedback.client, viewport: { width: 0, height: 844 } } },
    { ...analysisFeedback, matchup: { ...analysisFeedback.matchup, prompt: 'private' } },
  ];
  for (const value of invalid) assert.equal(normalizeFeedbackRequest(value), undefined);
});

test('POST /api/feedback creates a sanitized private tracker draft and returns no tracker metadata', async () => {
  const drafts: FeedbackIssueDraft[] = [];
  const tracker: FeedbackTracker = { async create(draft) { drafts.push(draft); } };
  const service = new FeedbackService(tracker, () => new Date('2026-09-25T08:21:00.000Z'));
  let analysisCalls = 0;
  const app = createApp({
    feedbackService: service,
    analysisService: { async analyze() { analysisCalls += 1; throw new Error('not expected'); } },
  });

  const response = await postFeedback(app, {
    ...analysisFeedback,
    comment: '@team <script> Galio ne peut pas utiliser son R au niveau 3.',
  });

  assert.equal(response.status, 202);
  const responseBody = await response.json();
  assert.deepEqual(responseBody, { status: 'accepted' });
  assert.equal(analysisCalls, 0);
  assert.equal(drafts.length, 1);
  assert.match(drafts[0]!.title, /^\[Analysis feedback\] Ziggs \+ Galio vs Jinx \+ Swain/);
  assert.match(drafts[0]!.body, /Patch: 26\.19/);
  assert.match(drafts[0]!.body, /Analysis ID: [0-9a-f]{20}/);
  assert.match(drafts[0]!.body, new RegExp(`Request ID: ${requestId}`));
  assert.doesNotMatch(drafts[0]!.body, /@team|<script>/);
  assert.deepEqual(drafts[0]!.labels, ['feedback', 'alpha', 'analysis-error', 'gameplay']);
  assert.doesNotMatch(JSON.stringify(responseBody), /github|issue|repository/i);
});

test('POST /api/feedback validates input and isolates missing or unavailable trackers', async () => {
  const invalid = await postFeedback(createApp(), { kind: 'bug' });
  assert.equal(invalid.status, 422);
  assert.equal((await invalid.json() as { error: { code: string } }).error.code, 'INVALID_FEEDBACK_REQUEST');

  const validBug = {
    kind: 'bug', category: 'ui_display', client: { view: 'selection', viewport: { width: 390, height: 844 } },
  };
  const missing = await postFeedback(createApp(), validBug);
  assert.equal(missing.status, 503);
  assert.equal((await missing.json() as { error: { code: string } }).error.code, 'FEEDBACK_NOT_CONFIGURED');

  const unavailable = await postFeedback(createApp({
    feedbackService: { async submit() { throw new FeedbackTrackerUnavailableError(); } },
  }), validBug);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json() as { error: { code: string } }).error.code, 'FEEDBACK_UNAVAILABLE');
});

test('feedback logs contain diagnostic metadata but never the comment or tracker payload', async () => {
  const entries: Array<{ event: string; fields: LogFields }> = [];
  const logger: Logger = {
    debug() {},
    info(event, fields = {}) { entries.push({ event, fields }); },
    warn(event, fields = {}) { entries.push({ event, fields }); },
    error(event, fields = {}) { entries.push({ event, fields }); },
  };
  const secretComment = 'private-comment-must-not-appear';
  const app = createApp({
    logger,
    feedbackService: { async submit() {} },
  });

  assert.equal((await postFeedback(app, { ...analysisFeedback, comment: secretComment })).status, 202);
  const serialized = JSON.stringify(entries);
  assert.doesNotMatch(serialized, new RegExp(secretComment));
  const completed = entries.find((entry) => entry.event === 'feedback_submission_completed');
  assert.equal(completed?.fields.kind, 'analysis');
  assert.equal(completed?.fields.category, 'timing_level');
  assert.equal(completed?.fields.view, 'matchup-result');
});

test('GitHub tracker configuration is optional but rejects partial configuration', () => {
  assert.equal(loadGitHubFeedbackTrackerConfig({}), undefined);
  assert.deepEqual(loadGitHubFeedbackTrackerConfig({
    FEEDBACK_GITHUB_TOKEN: 'token',
    FEEDBACK_GITHUB_OWNER: 'Braoux',
    FEEDBACK_GITHUB_REPOSITORY: 'LaneLens-Internal',
  }), { token: 'token', owner: 'Braoux', repository: 'LaneLens-Internal' });
  assert.throws(
    () => loadGitHubFeedbackTrackerConfig({ FEEDBACK_GITHUB_TOKEN: 'token' }),
    FeedbackTrackerConfigurationError,
  );
});

test('GitHub tracker creates one private issue request and exposes only a safe failure', async () => {
  let calls = 0;
  let seenUrl = '';
  let seenInit: RequestInit | undefined;
  const tracker = new GitHubFeedbackTracker({ token: 'server-secret', owner: 'Braoux', repository: 'LaneLens-Internal' }, async (input, init) => {
    calls += 1;
    seenUrl = String(input);
    seenInit = init;
    return Response.json({ number: 123, html_url: 'https://private.example/123' }, { status: 201 });
  });
  await tracker.create({ title: 'Issue', body: 'Body', labels: ['feedback'] });
  assert.equal(calls, 1);
  assert.equal(seenUrl, 'https://api.github.com/repos/Braoux/LaneLens-Internal/issues');
  assert.equal((seenInit?.headers as Record<string, string>).authorization, 'Bearer server-secret');
  assert.deepEqual(JSON.parse(String(seenInit?.body)), { title: 'Issue', body: 'Body', labels: ['feedback'] });

  const failing = new GitHubFeedbackTracker({ token: 'secret', owner: 'Braoux', repository: 'LaneLens-Internal' }, async () => {
    throw new Error('upstream secret detail');
  });
  await assert.rejects(failing.create({ title: 'Issue', body: 'Body', labels: [] }), (error: unknown) => {
    assert.ok(error instanceof FeedbackTrackerUnavailableError);
    assert.doesNotMatch(error.message, /secret|upstream/i);
    return true;
  });
});

test('runtime composes feedback independently from the analysis provider', async () => {
  const drafts: FeedbackIssueDraft[] = [];
  let receivedConfig: unknown;
  const app = createRuntimeApp({
    environment: {
      FEEDBACK_GITHUB_TOKEN: 'server-secret',
      FEEDBACK_GITHUB_OWNER: 'Braoux',
      FEEDBACK_GITHUB_REPOSITORY: 'LaneLens-Internal',
    },
    feedbackTrackerFactory(config) {
      receivedConfig = config;
      return { async create(draft) { drafts.push(draft); } };
    },
  });

  const response = await postFeedback(app, analysisFeedback);
  assert.equal(response.status, 202);
  assert.deepEqual(receivedConfig, {
    token: 'server-secret', owner: 'Braoux', repository: 'LaneLens-Internal',
  });
  assert.equal(drafts.length, 1);
  const matchupResponse = await app.request('/api/matchup', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      allyCarry: 'Ziggs', allySupport: 'Galio', enemyCarry: 'Jinx', enemySupport: 'Swain',
      patch: '26.19', locale: 'fr-FR',
    }),
  });
  assert.equal(matchupResponse.status, 503);
});
