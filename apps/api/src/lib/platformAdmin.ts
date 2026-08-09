/** Founder / platform admin — only this email may access Admin APIs. */
export const PLATFORM_ADMIN_EMAIL = (process.env.PLATFORM_ADMIN_EMAIL ?? 'aryavgaur1@gmail.com')
  .trim()
  .toLowerCase();

const FOUNDER_EMAILS = new Set(
  [
    PLATFORM_ADMIN_EMAIL,
    'aryavgaur1@gmail.com',
    'aryavgaur01@gmail.com',
    ...(process.env.FOUNDER_NOTION_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  ].filter(Boolean)
);

export function isPlatformAdminEmail(email?: string | null): boolean {
  return Boolean(email && email.trim().toLowerCase() === PLATFORM_ADMIN_EMAIL);
}

/** Founder Notion OAuth often hangs on Notion's Authorizing screen for the Public app owner. */
export function isFounderNotionEmail(email?: string | null): boolean {
  return Boolean(email && FOUNDER_EMAILS.has(email.trim().toLowerCase()));
}
