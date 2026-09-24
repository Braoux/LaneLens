import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import type { LogConfig } from './config.js';
import type { LogFields, Logger, LogLevel } from './Logger.js';
import { redactLogFields, serializeError } from './redaction.js';

const LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const LOG_FILE_PATTERN = /^lanelens-(\d{4}-\d{2}-\d{2})\.log$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface FileLoggerOptions {
  readonly now?: () => Date;
}

export class LoggerInitializationError extends Error {
  constructor() {
    super('Impossible d’initialiser les logs persistants.');
    this.name = 'LoggerInitializationError';
  }
}

function utcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function logFilePath(directory: string, value: Date): string {
  return join(directory, `lanelens-${utcDate(value)}.log`);
}

function parseLogDate(value: string): number | undefined {
  const match = LOG_FILE_PATTERN.exec(value);
  if (match === null) return undefined;
  const [year, month, day] = match[1]!.split('-').map(Number);
  const timestamp = Date.UTC(year!, month! - 1, day!);
  if (utcDate(new Date(timestamp)) !== match[1]) return undefined;
  return timestamp;
}

export class FileLogger implements Logger {
  private readonly now: () => Date;

  constructor(
    private readonly config: LogConfig,
    options: FileLoggerOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  debug(event: string, fields?: LogFields): void {
    this.write('debug', event, fields);
  }

  info(event: string, fields?: LogFields): void {
    this.write('info', event, fields);
  }

  warn(event: string, fields?: LogFields): void {
    this.write('warn', event, fields);
  }

  error(event: string, fields?: LogFields): void {
    this.write('error', event, fields);
  }

  private write(level: LogLevel, event: string, fields: LogFields = {}): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.config.level]) return;

    const timestamp = this.now();
    const safeFields = redactLogFields(fields);
    delete safeFields.timestamp;
    delete safeFields.level;
    delete safeFields.event;
    const entry = {
      timestamp: timestamp.toISOString(),
      level,
      event,
      ...safeFields,
    };
    appendFileSync(logFilePath(this.config.directory, timestamp), `${JSON.stringify(entry)}\n`, {
      encoding: 'utf8',
      flag: 'a',
    });
  }
}

function cleanupExpiredLogs(logger: Logger, config: LogConfig, now: Date): void {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let entries: string[];
  try {
    entries = readdirSync(config.directory);
  } catch (error) {
    logger.warn('log_retention_cleanup_failed', { error: serializeError(error) });
    return;
  }

  for (const fileName of entries) {
    const timestamp = parseLogDate(fileName);
    if (timestamp === undefined || timestamp === today) continue;
    const ageInDays = Math.floor((today - timestamp) / DAY_MS);
    if (ageInDays < config.retentionDays) continue;

    try {
      unlinkSync(join(config.directory, fileName));
    } catch (error) {
      logger.warn('log_retention_cleanup_failed', {
        fileName,
        error: serializeError(error),
      });
    }
  }
}

export function createFileLogger(
  config: LogConfig,
  options: FileLoggerOptions = {},
): FileLogger {
  const now = options.now ?? (() => new Date());
  try {
    mkdirSync(config.directory, { recursive: true });
    const descriptor = openSync(logFilePath(config.directory, now()), 'a');
    closeSync(descriptor);
  } catch {
    throw new LoggerInitializationError();
  }

  const logger = new FileLogger(config, { now });
  cleanupExpiredLogs(logger, config, now());
  return logger;
}
