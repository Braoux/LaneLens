import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { HealthResponse } from './types.js';

const app = new Hono();

app.get('/api/health', (c) => c.json({ status: 'ok' } satisfies HealthResponse));

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 3000 }, (info) => {
  console.log(`LaneLens API : http://127.0.0.1:${info.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
