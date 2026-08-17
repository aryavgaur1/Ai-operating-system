/** Centralized frontend routes for marketing vs private app split */

export const APP_HOME = '/app/dashboard';
export const APP_BASE = '/app';
export const LOGIN = '/login';
export const REGISTER = '/register';

export const APP_ROUTES = {
  home: APP_HOME,
  dashboard: '/app/dashboard',
  chat: '/app/chat',
  approvals: '/app/approvals',
  integrations: '/app/integrations',
  settings: '/app/settings',
  admin: '/app/admin',
  onboarding: '/app/onboarding',
  memory: '/app/memory',
  agents: '/app/agents',
  knowledge: '/app/knowledge',
  files: '/app/files',
  analytics: '/app/analytics',
  profile: '/app/profile',
} as const;

/** Stable chat URL — conversation ID survives Approvals navigation and reload. */
export function chatConversationPath(conversationId: string): string {
  return `${APP_ROUTES.chat}/${encodeURIComponent(conversationId)}`;
}

const ACTIVE_CONVERSATION_KEY = 'nexora:activeConversationId';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Convenience cache only — DB + URL remain authoritative. Survives browser close via localStorage. */
export function readCachedConversationId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const fromSession = window.sessionStorage.getItem(ACTIVE_CONVERSATION_KEY)?.trim();
    if (fromSession && UUID_RE.test(fromSession)) return fromSession;
    const fromLocal = window.localStorage.getItem(ACTIVE_CONVERSATION_KEY)?.trim();
    return fromLocal && UUID_RE.test(fromLocal) ? fromLocal : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Chat nav target: resume last conversation when known so Nav/Approvals never
 * dump the user on empty bare /app/chat.
 */
export function chatResumeHref(): string {
  const id = readCachedConversationId();
  return id ? chatConversationPath(id) : APP_ROUTES.chat;
}

export const MARKETING_ROUTES = [
  '/',
  '/features',
  '/pricing',
  '/integrations',
  '/enterprise',
  '/about',
  '/contact',
  '/privacy',
  '/terms',
  '/docs',
  '/security',
  '/blog',
  '/careers',
] as const;

export const AUTH_ROUTES = ['/login', '/register', '/signin'] as const;

export function isAppPath(pathname: string | null | undefined): boolean {
  return Boolean(pathname?.startsWith(APP_BASE));
}

export function isAuthPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return AUTH_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isOnboardingPath(pathname: string | null | undefined): boolean {
  return Boolean(pathname?.startsWith(APP_ROUTES.onboarding));
}

export function isMarketingPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (isAppPath(pathname) || isAuthPath(pathname)) return false;
  return MARKETING_ROUTES.some((p) => (p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`)));
}

export function isPublicPath(pathname: string | null | undefined): boolean {
  return isMarketingPath(pathname) || isAuthPath(pathname);
}
