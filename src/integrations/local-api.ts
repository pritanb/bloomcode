import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
export const defaultDataDir = () => process.env.DATA_DIR || join(homedir(), 'Library/Application Support/LeetcodeTutor-dev');
export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 0) { super(message); }
}
export class LocalApi {
  private baseUrl: string;
  private dataDir: string;
  constructor(options: {baseUrl?: string; dataDir?: string} = {}) {
    const url = new URL(options.baseUrl ?? `http://127.0.0.1:${process.env.PORT || '4317'}`);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new ApiError('UNSAFE_ENDPOINT', 'API must be HTTP on 127.0.0.1 with no path or credentials.');
    this.baseUrl = url.origin; this.dataDir = options.dataDir ?? defaultDataDir();
  }
  async request(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<unknown> {
    if (!path.startsWith('/api/') || path.includes('..') || path.includes('\\')) throw new ApiError('INVALID_PATH', 'Invalid API path.');
    let token: string;
    try { token = (await readFile(join(this.dataDir, 'api-token'), 'utf8')).trim(); } catch { throw new ApiError('TOKEN_UNAVAILABLE', 'Local API token unavailable. Start the app with the same DATA_DIR first.'); }
    if (!token || /[\r\n]/.test(token)) throw new ApiError('TOKEN_INVALID', 'Invalid local API token.');
    let response: Response;
    try { response = await fetch(`${this.baseUrl}${path}`, {method, redirect:'error', signal:AbortSignal.timeout(15000), headers:{Authorization:`Bearer ${token}`, ...(body === undefined ? {} : {'Content-Type':'application/json'}), ...(idempotencyKey ? {'Idempotency-Key':idempotencyKey} : {})}, ...(body === undefined ? {} : {body:JSON.stringify(body)})}); }
    catch { throw new ApiError('API_UNAVAILABLE', 'Local API unavailable or timed out. Check the app is running; retry writes with the SAME idempotency key.'); }
    let result: unknown;
    try { result = await response.json(); } catch { throw new ApiError('INVALID_RESPONSE', 'Local API returned invalid JSON.', response.status); }
    if (!response.ok) {
      const error = (result as {error?:{code?:unknown;message?:unknown}})?.error;
      const code=typeof error?.code==='string' ? error.code.replaceAll(token, '[redacted]') : 'HTTP_ERROR';
      const message=typeof error?.message==='string' ? error.message.replaceAll(token, '[redacted]') : 'Local API request failed.';
      throw new ApiError(code,message,response.status);
    }
    return result;
  }
}
