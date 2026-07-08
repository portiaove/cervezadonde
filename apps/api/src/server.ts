import Fastify from 'fastify';
import cors from '@fastify/cors';
import { closeSql } from '@minimarket/db';
import { registerHealthRoutes } from './routes/health.js';
import { registerStoresRoutes } from './routes/stores.js';

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? '0.0.0.0';
const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

async function main() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
  });

  await app.register(cors, {
    origin: webOrigin.split(',').map((o) => o.trim()),
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  await app.register(registerHealthRoutes);
  await app.register(registerStoresRoutes, { prefix: '/stores' });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await closeSql();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port, host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
