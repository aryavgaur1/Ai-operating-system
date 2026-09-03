/** Founder / platform admin — UI gate only; APIs still enforce requireAdmin. */

function parseEmailList(raw?: string | null): string[] {
  return String(raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const PLATFORM_ADMIN_EMAIL = (
  process.env.NEXT_PUBLIC_PLATFORM_ADMIN_EMAIL ||
  process.env.PLATFORM_ADMIN_EMAIL ||
  'aryavgaur01@gmail.com'
)
  .trim()
  .toLowerCase();

const PLATFORM_ADMIN_EMAILS = new Set([
  PLATFORM_ADMIN_EMAIL,
  'aryavgaur01@gmail.com',
  'aryavgaur1@gmail.com',
  ...parseEmailList(process.env.NEXT_PUBLIC_PLATFORM_ADMIN_EMAILS),
  ...parseEmailList(process.env.PLATFORM_ADMIN_EMAILS),
]);

export function getPlatformAdminEmail(): string {
  return PLATFORM_ADMIN_EMAIL;
}

export function isPlatformAdminEmail(email?: string | null): boolean {
  return Boolean(email && PLATFORM_ADMIN_EMAILS.has(email.trim().toLowerCase()));
}
