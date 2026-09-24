import { resolve } from 'node:path';
import { LOG_LEVELS } from './Logger.js';
import type { LogLevel } from './Logger.js';

export const DEFAULT_LOG_DIR = './logs';
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';
export const DEFAULT_LOG_RETENTION_DAYS = 14;

export type LogEnvironment = Readonly<Record<string, string | undefined>>;

export interface LogConfig {
  readonly directory: string;
  readonly level: LogLevel;
  readonly retentionDays: number;
}

export class LogConfigurationError extends Error {
  constructor() {
    super('La configuration des logs est invalide.');
    this.name = 'LogConfigurationError';
  }
}

function parseLevel(rawValue: string | undefined): LogLevel {
  const value = rawValue?.trim().toLowerCase() ?? '';
  if (value.length === 0) return DEFAULT_LOG_LEVEL;
  if ((LOG_LEVELS as readonly string[]).includes(value)) return value as LogLevel;
  throw new LogConfigurationError();
}

function parseRetention(rawValue: string | undefined): number {
  const value = rawValue?.trim() ?? '';
  if (value.length === 0) return DEFAULT_LOG_RETENTION_DAYS;
  if (!/^[1-9]\d*$/.test(value)) throw new LogConfigurationError();

  const retentionDays = Number(value);
  if (!Number.isSafeInteger(retentionDays)) throw new LogConfigurationError();
  return retentionDays;
}

export function loadLogConfig(
  environment: LogEnvironment = process.env,
  workingDirectory = process.cwd(),
): LogConfig {
  const configuredDirectory = environment.LOG_DIR?.trim() ?? '';

  return Object.freeze({
    directory: resolve(workingDirectory, configuredDirectory || DEFAULT_LOG_DIR),
    level: parseLevel(environment.LOG_LEVEL),
    retentionDays: parseRetention(environment.LOG_RETENTION_DAYS),
  });
}
