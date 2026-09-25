import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { MatchupAnalysisError } from '../server/analysis/errors.js';
import { ProviderFailureError } from '../server/analysis/ProviderFailure.js';
import type { MatchupAnalysis } from '../server/analysis/types.js';
import {
  DEFAULT_LOG_LEVEL,
  DEFAULT_LOG_RETENTION_DAYS,
  LogConfigurationError,
  loadLogConfig,
} from '../server/logging/config.js';
import {
  createFileLogger,
  LoggerInitializationError,
} from '../server/logging/FileLogger.js';
import type { LogFields, Logger, LogLevel } from '../server/logging/Logger.js';

const NOW = new Date('2026-09-24T14:31:12.482Z');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RecordedEntry {
  readonly level: LogLevel;
  readonly event: string;
  readonly fields: LogFields;
}

class MemoryLogger implements Logger {
  readonly entries: RecordedEntry[] = [];

  debug(event: string, fields: LogFields = {}): void {
    this.entries.push({ level: 'debug', event, fields });
  }

  info(event: string, fields: LogFields = {}): void {
    this.entries.push({ level: 'info', event, fields });
  }

  warn(event: string, fields: LogFields = {}): void {
    this.entries.push({ level: 'warn', event, fields });
  }

  error(event: string, fields: LogFields = {}): void {
    this.entries.push({ level: 'error', event, fields });
  }
}

function temporaryDirectory(t: test.TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'lanelens-logging-'));
  t.after(() => {
    const resolved = resolve(directory);
    assert.ok(resolved.startsWith(resolve(tmpdir())));
    rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}

function readEntries(directory: string, date = '2026-09-24'): Record<string, unknown>[] {
  const content = readFileSync(join(directory, `lanelens-${date}.log`), 'utf8');
  return content.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function logConfig(directory: string, level: LogLevel = 'debug', retentionDays = 14) {
  return { directory, level, retentionDays } as const;
}

const requestBody = {
  allyCarry: 'Ziggs',
  allySupport: 'Galio',
  enemyCarry: 'Jinx',
  enemySupport: 'Swain',
  patch: '26.19',
};

const validAnalysis = (): MatchupAnalysis => ({
  matchup: { ...requestBody },
  lanePlan: 'Contrôler la vague.',
  threatResponseWindow: {
    threat: 'Engage adverse.',
    response: 'Garder la distance.',
    window: 'Après le cooldown principal.',
    winCondition: 'Poke avant le combat.',
  },
  earlyLevels: {
    level1: 'Prendre la priorité.',
    level2: 'Respecter l’engage.',
    level3: 'Jouer les cooldowns.',
  },
  wavePlan: 'Maintenir une vague sûre.',
  targetPriority: {
    primaryTarget: 'Swain',
    explanation: 'Le punir après son contrôle.',
  },
  postLevel6: 'Éviter les combats prolongés.',
  roamPlan: 'Roam après avoir poussé.',
  cheatSheet: ['Contrôle raté → avancer'],
  goldenRule: 'Jouer après les cooldowns adverses.',
});

function configuredApp(logger: Logger, analysisError?: unknown) {
  return createApp({
    logger,
    analysisProviderName: 'gemini',
    patchContextResolver: {
      async resolve(patch) {
        return {
          status: 'ready',
          context: {
            patch,
            contextVersion: `${patch}-v1`,
            facts: [{ subject: 'Botlane', text: 'Contexte versionné.' }],
          },
        };
      },
    },
    analysisService: {
      async analyze() {
        if (analysisError !== undefined) throw analysisError;
        return validAnalysis();
      },
    },
  });
}

function postMatchup(app: ReturnType<typeof createApp>, headers: Record<string, string> = {}) {
  return app.request('/api/matchup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(requestBody),
  });
}

test('log configuration applies defaults, trims values, and rejects invalid values', () => {
  assert.deepEqual(loadLogConfig({}, 'C:\\LaneLens'), {
    directory: resolve('C:\\LaneLens', './logs'),
    level: DEFAULT_LOG_LEVEL,
    retentionDays: DEFAULT_LOG_RETENTION_DAYS,
  });
  assert.deepEqual(loadLogConfig({
    LOG_DIR: ' nested/logs ',
    LOG_LEVEL: ' WARN ',
    LOG_RETENTION_DAYS: ' 30 ',
  }, 'C:\\LaneLens'), {
    directory: resolve('C:\\LaneLens', 'nested/logs'),
    level: 'warn',
    retentionDays: 30,
  });

  for (const environment of [
    { LOG_LEVEL: 'verbose' },
    { LOG_RETENTION_DAYS: '0' },
    { LOG_RETENTION_DAYS: '-1' },
    { LOG_RETENTION_DAYS: '1.5' },
    { LOG_RETENTION_DAYS: 'abc' },
    { LOG_RETENTION_DAYS: '9007199254740992' },
  ]) {
    assert.throws(() => loadLogConfig(environment), LogConfigurationError);
  }
});

test('logger creates nested directories and appends valid JSON Lines without overwriting', (t) => {
  const root = temporaryDirectory(t);
  const directory = join(root, 'nested', 'logs');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'lanelens-2026-09-24.log');
  writeFileSync(file, '{"existing":true}\n', 'utf8');
  rmSync(join(root, 'nested'), { recursive: true, force: true });

  const logger = createFileLogger(logConfig(directory), { now: () => NOW });
  logger.info('server_started', { port: 3000 });
  assert.ok(existsSync(directory));

  const entries = readEntries(directory);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.timestamp, NOW.toISOString());
  assert.equal(entries[0]?.level, 'info');
  assert.equal(entries[0]?.event, 'server_started');
  assert.equal(entries[0]?.port, 3000);

  const restarted = createFileLogger(logConfig(directory), { now: () => NOW });
  restarted.info('server_restarted');
  assert.equal(readEntries(directory).length, 2);
});

test('log level filters entries according to debug < info < warn < error', (t) => {
  const root = temporaryDirectory(t);
  const expected: Record<LogLevel, readonly LogLevel[]> = {
    debug: ['debug', 'info', 'warn', 'error'],
    info: ['info', 'warn', 'error'],
    warn: ['warn', 'error'],
    error: ['error'],
  };

  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    const directory = join(root, level);
    const logger = createFileLogger(logConfig(directory, level), { now: () => NOW });
    logger.debug('debug_event');
    logger.info('info_event');
    logger.warn('warn_event');
    logger.error('error_event');
    assert.deepEqual(readEntries(directory).map((entry) => entry.level), expected[level]);
  }
});

test('logger rotates at UTC midnight and retains append-only daily files', (t) => {
  const directory = temporaryDirectory(t);
  let current = new Date('2026-09-24T23:59:59.999Z');
  const logger = createFileLogger(logConfig(directory), { now: () => current });
  logger.info('before_midnight');
  current = new Date('2026-09-25T00:00:00.001Z');
  logger.info('after_midnight');

  assert.equal(readEntries(directory, '2026-09-24')[0]?.event, 'before_midnight');
  assert.equal(readEntries(directory, '2026-09-25')[0]?.event, 'after_midnight');
});

test('retention removes only expired LaneLens files and preserves today and foreign files', (t) => {
  const directory = temporaryDirectory(t);
  for (const [name, content] of [
    ['lanelens-2026-09-10.log', 'expired'],
    ['lanelens-2026-09-11.log', 'retained'],
    ['lanelens-2026-09-24.log', 'today'],
    ['application-2020-01-01.log', 'foreign'],
    ['lanelens-invalid.log', 'foreign-pattern'],
  ]) writeFileSync(join(directory, name), content, 'utf8');

  createFileLogger(logConfig(directory, 'info', 14), { now: () => NOW });

  assert.equal(existsSync(join(directory, 'lanelens-2026-09-10.log')), false);
  assert.equal(existsSync(join(directory, 'lanelens-2026-09-11.log')), true);
  assert.equal(readFileSync(join(directory, 'lanelens-2026-09-24.log'), 'utf8'), 'today');
  assert.equal(existsSync(join(directory, 'application-2020-01-01.log')), true);
  assert.equal(existsSync(join(directory, 'lanelens-invalid.log')), true);
});

test('logger initialization fails explicitly when the log directory is unusable', (t) => {
  const root = temporaryDirectory(t);
  const fileInsteadOfDirectory = join(root, 'not-a-directory');
  writeFileSync(fileInsteadOfDirectory, 'occupied', 'utf8');

  assert.throws(
    () => createFileLogger(logConfig(fileInsteadOfDirectory), { now: () => NOW }),
    LoggerInitializationError,
  );
});

test('nested secrets and credential-shaped strings are redacted before persistence', (t) => {
  const directory = temporaryDirectory(t);
  const logger = createFileLogger(logConfig(directory), { now: () => NOW });
  logger.error('safe_error', {
    apiKey: 'top-secret',
    nested: {
      api_key: 'nested-secret',
      Authorization: 'Bearer credential-value',
      accessToken: 'access-value',
      refreshToken: 'refresh-value',
      cookie: 'session=value',
      'set-cookie': 'session=other',
      password: 'password-value',
      secret: 'secret-value',
      safe: 'Bearer should-not-survive',
    },
  });

  const serialized = JSON.stringify(readEntries(directory)[0]);
  assert.doesNotMatch(serialized, /top-secret|nested-secret|credential-value|access-value|refresh-value|session=value|session=other|password-value|secret-value|should-not-survive/);
  assert.match(serialized, /\[REDACTED\]/);
});

test('request IDs are server-generated and correlate HTTP and successful analysis logs', async () => {
  const logger = new MemoryLogger();
  const response = await postMatchup(configuredApp(logger), {
    authorization: 'Bearer client-controlled',
    'x-request-id': 'attacker-controlled',
  });
  const requestId = response.headers.get('x-request-id');

  assert.equal(response.status, 200);
  assert.match(requestId ?? '', UUID_PATTERN);
  assert.notEqual(requestId, 'attacker-controlled');
  const relevant = logger.entries.filter((entry) => [
    'http_request_completed',
    'matchup_analysis_started',
    'matchup_analysis_completed',
  ].includes(entry.event));
  assert.equal(relevant.length, 3);
  assert.ok(relevant.every((entry) => entry.fields.requestId === requestId));
  assert.equal(relevant.find((entry) => entry.event === 'http_request_completed')?.level, 'info');
  assert.doesNotMatch(JSON.stringify(logger.entries), /client-controlled|attacker-controlled/);
});

test('HTTP logs use info for 200, warn for 422, and error for 500', async () => {
  const logger = new MemoryLogger();
  const app = configuredApp(logger);

  assert.equal((await app.request('/api/health')).status, 200);
  assert.equal((await postMatchup(app, {})).status, 200);
  assert.equal((await app.request('/api/matchup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...requestBody, allySupport: 'Ziggs' }),
  })).status, 422);
  const failing = configuredApp(logger, new Error('unexpected password=do-not-log'));
  assert.equal((await postMatchup(failing)).status, 500);

  const httpEntries = logger.entries.filter((entry) => entry.event === 'http_request_completed');
  assert.deepEqual(httpEntries.map((entry) => entry.level), ['info', 'info', 'warn', 'error']);
  assert.deepEqual(httpEntries.map((entry) => entry.fields.status), [200, 200, 422, 500]);
});

test('analysis failures keep the request ID, normalized code, and provider name', async () => {
  const logger = new MemoryLogger();
  const sdkError = Object.assign(
    new Error('429 quota exceeded Authorization: Bearer provider-secret-token'),
    { status: 429 },
  );
  const response = await postMatchup(configuredApp(
    logger,
    new MatchupAnalysisError('ANALYSIS_PROVIDER_UNAVAILABLE', {
      cause: new ProviderFailureError({
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        category: 'rate_limit',
        status: 429,
        errorName: sdkError.name,
        errorMessage: '429 quota exceeded Authorization: Bearer [REDACTED]',
      }),
    }),
  ));
  const requestId = response.headers.get('x-request-id');

  assert.equal(response.status, 503);
  const failed = logger.entries.find((entry) => entry.event === 'matchup_analysis_failed');
  const provider = logger.entries.find((entry) => entry.event === 'analysis_provider_failed');
  const correlated = logger.entries.filter((entry) => [
    'http_request_completed',
    'matchup_analysis_started',
    'matchup_analysis_failed',
    'analysis_provider_failed',
  ].includes(entry.event));
  assert.equal(correlated.length, 4);
  assert.ok(correlated.every((entry) => entry.fields.requestId === requestId));
  assert.equal(failed?.fields.requestId, requestId);
  assert.equal(failed?.fields.errorCode, 'ANALYSIS_PROVIDER_UNAVAILABLE');
  assert.equal(provider?.fields.requestId, requestId);
  assert.equal(provider?.fields.provider, 'gemini');
  assert.equal(provider?.fields.model, 'gemini-3.8-flash');
  assert.equal(provider?.fields.category, 'rate_limit');
  assert.equal(provider?.fields.status, 429);
  assert.equal(provider?.fields.errorName, 'Error');
  assert.match(String(provider?.fields.errorMessage), /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(provider), /provider-secret-token/);
  assert.equal(provider?.fields.errorCode, 'ANALYSIS_PROVIDER_UNAVAILABLE');
});

test('provider diagnostics are redacted before being persisted', async (t) => {
  const directory = temporaryDirectory(t);
  const logger = createFileLogger(logConfig(directory), { now: () => NOW });
  const sdkError = Object.assign(
    new Error('401 api_key=AIzaSensitiveCredential123456789 Authorization: Bearer hidden-token'),
    { status: 401 },
  );
  const response = await postMatchup(configuredApp(
    logger,
    new MatchupAnalysisError('ANALYSIS_PROVIDER_UNAVAILABLE', {
      cause: new ProviderFailureError({
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        category: 'authentication',
        status: 401,
        errorName: sdkError.name,
        errorMessage: '401 api_key=[REDACTED] Authorization: Bearer [REDACTED]',
      }),
    }),
  ));

  assert.equal(response.status, 503);
  const serialized = JSON.stringify(readEntries(directory));
  assert.match(serialized, /analysis_provider_failed/);
  assert.match(serialized, /authentication/);
  assert.doesNotMatch(serialized, /AIzaSensitiveCredential|hidden-token/);
});
