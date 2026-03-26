import { NextResponse } from 'next/server';

const API_KEY = process.env.CAREERX_API_KEY || '';

/**
 * Validates the x-api-key header against the CAREERX_API_KEY env var.
 * Returns null if authenticated, or a 401 NextResponse if not.
 *
 * Usage in route handlers:
 *   const authError = requireAuth(req);
 *   if (authError) return authError;
 */
export function requireAuth(req: Request): NextResponse | null {
  if (!API_KEY) {
    // No key configured — auth disabled (dev mode)
    return null;
  }

  const provided = req.headers.get('x-api-key') ?? '';
  if (provided !== API_KEY) {
    return NextResponse.json(
      { error: 'Unauthorized — invalid or missing x-api-key header' },
      { status: 401 },
    );
  }

  return null;
}
