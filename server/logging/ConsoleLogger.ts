import type { LogFields, Logger, LogLevel } from './Logger.js';
import { redactLogFields } from './redaction.js';

const LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface ConsoleLoggerOptions {
  readonly level: LogLevel;
  readonly now?: () => Date;
  readonly stdout?: (line: string) => void;
  readonly stderr?: (line: string) => void;
}

export class ConsoleLogger implements Logger {
  private readonly now: () => Date;
  private readonly stdout: (line: string) => void;
  private readonly stderr: (line: string) => void;

  constructor(private readonly options: ConsoleLoggerOptions) {
    this.now = options.now ?? (() => new Date());
    this.stdout = options.stdout ?? ((line) => process.stdout.write(line));
    this.stderr = options.stderr ?? ((line) => process.stderr.write(line));
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
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.options.level]) return;

    const safeFields = redactLogFields(fields);
    delete safeFields.timestamp;
    delete safeFields.level;
    delete safeFields.event;
    const line = `${JSON.stringify({
      timestamp: this.now().toISOString(),
      level,
      event,
      ...safeFields,
    })}\n`;
    (level === 'error' ? this.stderr : this.stdout)(line);
  }
}

export function createConsoleLogger(options: ConsoleLoggerOptions): ConsoleLogger {
  return new ConsoleLogger(options);
}
