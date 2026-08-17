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
