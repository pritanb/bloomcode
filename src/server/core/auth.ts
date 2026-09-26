import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ApiError } from '../db/errors.js';
/** Local capabilities never enter the browser session response or logs. */
export function loadToken(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const path = join(dataDir, 'api-token');
  if (!existsSync(path)) {
    try {
      writeFileSync(path, randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('Credential path must be a regular local file');
  chmodSync(path, 0o600);
  const token = readFileSync(path, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid local API credential file');
  return token;
}

/** In-memory databases (tests) get a throwaway token; real ones keep it beside the database. */
export const tokenFor = (dbPath: string) =>
  dbPath === ':memory:' ? randomBytes(32).toString('hex') : loadToken(dirname(dbPath));

const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const bearerMatches = (header: string | undefined, token: string) =>
  !!header?.startsWith('Bearer ') && safeEqual(header.slice(7), token);

const SESSION_MS = 86400000;
const PUBLIC_PATHS = ['/health', '/api/session'];
/** Bulk data operations are for local tools holding the bearer token, never the browser. */
const BEARER_ONLY_PATHS = ['/api/import', '/api/backup'];

/**
 * Every request must arrive over loopback with a matching Host/Origin. After
 * that, callers authenticate with either the bearer token (CLI, MCP) or a
 * browser session cookie from /api/session plus a CSRF header on mutations.
 */
export async function registerLocalAuth(
  app: FastifyInstance,
  {
    token,
    clock,
    serveStatic,
  }: { token: string; clock: () => Date; serveStatic?: boolean | string },
) {
  const sessions = new Map<string, { csrf: string; expires: number }>();
  await app.register(cookie);
  app.addHook('onRequest', async (req) => {
    const host = req.headers.host ?? '';
    const path = req.url.split('?')[0]!;
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))
      throw new ApiError(403, 'HOST', 'Loopback host required');
    if (
      req.raw.socket.localPort &&
      Number(new URL(`http://${host}`).port || 80) !== req.raw.socket.localPort
    )
      throw new ApiError(403, 'HOST', 'Host port must match the listening port');
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip))
      throw new ApiError(403, 'LOOPBACK', 'Loopback connections only');
    if (req.headers.origin && req.headers.origin !== `http://${host}`)
      throw new ApiError(403, 'ORIGIN', 'Same origin required');

    const isWebAsset =
      serveStatic && !req.url.startsWith('/api/') && ['GET', 'HEAD'].includes(req.method);
    if (PUBLIC_PATHS.includes(path) || isWebAsset) return;
    if (bearerMatches(req.headers.authorization, token)) return;
    if (BEARER_ONLY_PATHS.includes(path))
      throw new ApiError(
        403,
        'BEARER_REQUIRED',
        'This operation requires the local bearer credential',
      );

    const session = sessions.get(req.cookies.lc_session ?? '');
    if (!session || session.expires < clock().getTime())
      throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      !safeEqual(String(req.headers['x-csrf-token'] ?? ''), session.csrf)
    )
      throw new ApiError(403, 'CSRF', 'CSRF token required');
  });
  app.get('/api/session', (_req, reply) => {
    const id = randomBytes(32).toString('hex'),
      csrf = randomBytes(32).toString('hex');
    sessions.set(id, { csrf, expires: clock().getTime() + SESSION_MS });
    reply.setCookie('lc_session', id, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_MS / 1000,
    });
    return { csrfToken: csrf };
  });
}
