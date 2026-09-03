import { webAppUrl } from './authTokens';

/**
 * Safe post-OAuth return paths only — prevents open redirects.
 * Default remains Integrations for non-onboarding Connect flows.
 */
const ALLOWED_RETURN_PATHS = new Set(['/app/onboarding', '/app/integrations']);

export function sanitizeOAuthReturnPath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '/app/integrations';
  const trimmed = raw.trim();
  // Reject absolute URLs, protocol-relative, and traversal.
  if (
    trimmed.includes('://') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    trimmed.includes('..') ||
    !trimmed.startsWith('/')
  ) {
    return '/app/integrations';
  }
  const pathOnly = trimmed.split('?')[0].split('#')[0];
  if (!ALLOWED_RETURN_PATHS.has(pathOnly)) return '/app/integrations';
  return pathOnly;
}

export function readOAuthReturnTo(query: unknown): string {
  const q = query as { returnTo?: string; return_to?: string };
  return sanitizeOAuthReturnPath(q?.returnTo ?? q?.return_to);
}

export function oauthAppRedirect(
  connected: string,
  returnTo?: string | null,
  extra?: Record<string, string>
): string {
  const path = sanitizeOAuthReturnPath(returnTo);
  const url = new URL(`${webAppUrl()}${path}`);
  url.searchParams.set('connected', connected);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

export function oauthAppErrorRedirect(message: string, returnTo?: string | null): string {
  const path = sanitizeOAuthReturnPath(returnTo);
  const url = new URL(`${webAppUrl()}${path}`);
  url.searchParams.set('error', message);
  return url.toString();
}
