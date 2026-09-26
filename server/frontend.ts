import { resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
import { isProductionEnvironment } from './server-config.js';
import type { ServerEnvironment } from './server-config.js';

export interface ProductionFrontendOptions {
  readonly environment: ServerEnvironment;
  readonly clientDirectory?: string;
  readonly workingDirectory?: string;
}
// Hono doit conserver les bindings génériques de l'application appelante.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function attachProductionFrontend<T extends Hono<any>>(
  app: T,
  options: ProductionFrontendOptions,
): T {
  if (!isProductionEnvironment(options.environment)) return app;

  const clientDirectory = options.clientDirectory
    ?? resolve(options.workingDirectory ?? process.cwd(), 'dist/client');

  app.all('/api/*', (c) => c.notFound());
  app.use('/assets/*', async (c, next) => {
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    await next();
  });
  app.get('*', serveStatic({ root: clientDirectory }));
  app.get('*', serveStatic({ root: clientDirectory, path: 'index.html' }));
  return app;
}
