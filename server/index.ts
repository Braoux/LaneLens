import 'dotenv/config';
import { hostname as getHostname } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { createRuntimeApp } from './runtime.js';
import { loadLogConfig, loadLogLevel } from './logging/config.js';
import type { LogEnvironment } from './logging/config.js';
import { createFileLogger } from './logging/FileLogger.js';
import { createConsoleLogger } from './logging/ConsoleLogger.js';
import type { Logger } from './logging/Logger.js';
import { serializeError } from './logging/redaction.js';
import { loadServerConfig } from './server-config.js';

export function startServer(environment: LogEnvironment = process.env) {
  const serverConfig = loadServerConfig(environment);
  const logLevel = loadLogLevel(environment.LOG_LEVEL);
  const logConfig = serverConfig.production ? undefined : loadLogConfig(environment);
  const logger = serverConfig.production
    ? createConsoleLogger({ level: logLevel })
    : createFileLogger(logConfig!);
  const logFields = {
    logLevel,
    ...(logConfig === undefined ? {} : { logDirectory: logConfig.directory }),
  };

  try {
    logger.info('server_starting', {
      port: serverConfig.port,
      hostname: getHostname(),
      bindAddress: serverConfig.hostname,
      nodeEnvironment: environment.NODE_ENV?.trim() || undefined,
      ...logFields,
    });

    const app = createRuntimeApp({ environment, logger });
    const server = serve(
      { fetch: app.fetch, hostname: serverConfig.hostname, port: serverConfig.port },
      (info) => {
        logger.info('server_started', {
          port: info.port,
          hostname: getHostname(),
          bindAddress: serverConfig.hostname,
          nodeEnvironment: environment.NODE_ENV?.trim() || undefined,
          ...logFields,
        });
      },
    );

    server.once('error', (error) => {
      try {
        logger.error('server_start_failed', {
          error: serializeError(error, true),
        });
      } catch {
        process.stderr.write('LaneLens failed to persist its startup error.\n');
      }
      process.exitCode = 1;
    });

    installShutdownHandlers(server, logger);
    return server;
  } catch (error) {
    logger.error('server_start_failed', {
      error: serializeError(error, true),
    });
    throw error;
  }
}

function installShutdownHandlers(
  server: ReturnType<typeof serve>,
  logger: Logger,
): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      try {
        logger.info('server_stopping', { signal });
        server.close(() => {
          try {
            logger.info('server_stopped', { signal });
            process.exit(0);
          } catch {
            process.stderr.write('LaneLens failed to persist its shutdown log.\n');
            process.exit(1);
          }
        });
      } catch {
        process.stderr.write('LaneLens failed to persist its shutdown log.\n');
        process.exit(1);
      }
      setTimeout(() => process.exit(1), 5000).unref();
    });
  }
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined
    && import.meta.url === pathToFileURL(resolve(entryPoint)).href;
}

if (isMainModule()) {
  try {
    startServer();
  } catch {
    process.stderr.write('LaneLens server failed to start.\n');
    process.exitCode = 1;
  }
}
