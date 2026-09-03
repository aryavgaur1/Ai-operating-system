/** Founder / platform admin — only these emails may access Admin APIs. */

function parseEmailList(raw?: string | null): string[] {
  return String(raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Canonical founder email (matches DEPLOY / seed defaults). */
export const PLATFORM_ADMIN_EMAIL = (
  process.env.PLATFORM_ADMIN_EMAIL ?? 'aryavgaur01@gmail.com'
)
  .trim()
  .toLowerCase();

/**
 * Additional platform admins (comma-separated).
 * Always includes the canonical founder email plus a common typo/alias of the same account.
 */
const PLATFORM_ADMIN_EMAILS = new Set([
  PLATFORM_ADMIN_EMAIL,
  'aryavgaur01@gmail.com',
  'aryavgaur1@gmail.com',
  ...parseEmailList(process.env.PLATFORM_ADMIN_EMAILS),
]);

const FOUNDER_EMAILS = new Set([
  ...PLATFORM_ADMIN_EMAILS,
  ...parseEmailList(process.env.FOUNDER_NOTION_EMAILS),
]);

export function getPlatformAdminEmail(): string {
  return PLATFORM_ADMIN_EMAIL;
}

export function isPlatformAdminEmail(email?: string | null): boolean {
  return Boolean(email && PLATFORM_ADMIN_EMAILS.has(email.trim().toLowerCase()));
}

/** Founder Notion OAuth often hangs on Notion's Authorizing screen for the Public app owner. */
export function isFounderNotionEmail(email?: string | null): boolean {
  return Boolean(email && FOUNDER_EMAILS.has(email.trim().toLowerCase()));
}
