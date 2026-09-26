import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { repoRoot } from '../paths.js';
import { registerLocalAuth } from './auth.js';

/**
 * The HTTP shell around the study routes: error format, security headers,
 * local-only access control, the built web app and /health.
 */
export async function registerHttp(
  app: FastifyInstance,
  options: { token: string; clock: () => Date; serveStatic?: boolean | string },
) {
  registerErrorHandler(app);
  registerSecurityHeaders(app);
  await registerLocalAuth(app, options);
  await registerWebApp(app, options.serveStatic);
  app.get('/health', () => ({ ok: true }));
}

/** Maps thrown errors to the `{ error: { code, message } }` envelope; 500s never leak details. */
function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, _req, reply) => {
    const err = error as Error & { statusCode?: number; code?: string; status?: number };
    const status =
      err instanceof ZodError
        ? 400
        : (err.status ?? (err.statusCode && err.statusCode < 500 ? err.statusCode : 500));
    reply.status(status).send({
      error: {
        code:
          err instanceof ZodError
            ? 'VALIDATION'
            : status === 500
              ? 'INTERNAL'
              : (err.code ?? 'BAD_REQUEST'),
        message: status === 500 ? 'Internal server error' : err.message,
      },
    });
  });
}

function registerSecurityHeaders(app: FastifyInstance) {
  app.addHook('onSend', async (_req, reply, payload) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY')
      .header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      )
      .header('Cache-Control', 'no-store');
    return payload;
  });
}

/**
 * Serves the built web app when enabled. Unknown non-API GETs without a file
 * extension fall back to index.html so client-side routes survive a reload.
 */
async function registerWebApp(app: FastifyInstance, serveStatic?: boolean | string) {
  const root =
    typeof serveStatic === 'string' ? serveStatic : fileURLToPath(new URL('dist/web/', repoRoot));
  const enabled = !!serveStatic && existsSync(root);
  if (enabled) await app.register(fastifyStatic, { root });
  app.setNotFoundHandler((req, reply) => {
    if (
      enabled &&
      req.method === 'GET' &&
      !req.url.startsWith('/api/') &&
      !req.url.split('?')[0]!.split('/').at(-1)!.includes('.')
    )
      return reply.sendFile('index.html');
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
}
