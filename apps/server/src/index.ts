// ChitChat server entry point.

import { config } from './config.js';
import { createServer } from './server.js';

const server = createServer();

const port = await server.start(config.port);
console.log(`[chitchat] socket server listening on :${port} (env=${config.nodeEnv})`);
console.log(
  `[chitchat] redis=${config.useRedis ? 'upstash' : 'memory'} supabase=${config.useSupabase ? 'on' : 'off'} turnstile=${config.useTurnstile ? 'on' : 'off'}`,
);

// Gentle self-ping so Render's free tier notices traffic more often. This does
// NOT prevent sleeping (in-process timers stop when the instance sleeps); for
// real uptime use an external pinger like cron-job.org hitting /health.
if (config.isProd && config.socketServerUrl.startsWith('https://')) {
  setInterval(() => {
    fetch(`${config.socketServerUrl}/health`).catch(() => undefined);
  }, 10 * 60_000).unref();
}

const shutdown = async (signal: string): Promise<void> => {
  console.log(`[chitchat] ${signal} received, shutting down…`);
  try {
    await server.stop();
  } finally {
    process.exit(0);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
