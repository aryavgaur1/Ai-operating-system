/** Founder / platform admin — only this email may access Admin UI & /admin APIs. */
export const PLATFORM_ADMIN_EMAIL = (
  process.env.NEXT_PUBLIC_PLATFORM_ADMIN_EMAIL ||
  process.env.PLATFORM_ADMIN_EMAIL ||
  'aryavgaur01@gmail.com'
)
  .trim()
  .toLowerCase();

export function getPlatformAdminEmail(): string {
  return PLATFORM_ADMIN_EMAIL;
}

export function isPlatformAdminEmail(email?: string | null): boolean {
  return Boolean(email && email.trim().toLowerCase() === PLATFORM_ADMIN_EMAIL);
}
