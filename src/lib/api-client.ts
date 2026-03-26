/**
 * Thin wrapper around fetch() that automatically includes the x-api-key header.
 * Used by all client-side code that calls internal API routes.
 */

const API_KEY = process.env.NEXT_PUBLIC_CAREERX_API_KEY ?? '';

export function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (API_KEY) {
    headers.set('x-api-key', API_KEY);
  }
  return fetch(url, { ...init, headers });
}
