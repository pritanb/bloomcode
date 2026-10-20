export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function createApi() {
  let session: Promise<string> | undefined;
  async function parse<T>(response: Response): Promise<T> {
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        response.status,
        data?.error?.code ?? 'request_failed',
        data?.error?.message ??
          `Request failed (${response.status}). Check that the local service is running.`,
      );
    return data as T;
  }
  function ensureSession() {
    session ??= fetch('/api/session', { credentials: 'same-origin' })
      .then(parse<{ csrfToken: string }>)
      .then((data) => data.csrfToken)
      .catch((error) => {
        session = undefined;
        throw error;
      });
    return session;
  }
  async function request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    key?: string,
    renewed = false,
  ): Promise<T> {
    const current = ensureSession();
    const csrf = await current;
    const response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    // Sessions expire after a day or vanish when the server restarts. The server
    // rejects these before running the handler, so renewing and replaying once is safe.
    if (response.status === 401 && !renewed) {
      const data = await response
        .clone()
        .json()
        .catch(() => null);
      if (data?.error?.code === 'UNAUTHENTICATED') {
        if (session === current) session = undefined;
        return request<T>(path, method, body, key, true);
      }
    }
    return parse<T>(response);
  }
  return {
    get: <T>(path: string) => request<T>(path),
    send: <T>(path: string, method: 'POST' | 'PATCH', body: unknown, key?: string) =>
      request<T>(path, method, body, key),
  };
}
export const api = createApi();
