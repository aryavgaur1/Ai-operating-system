import type { Request } from 'express';
import { query } from '@enterprise-ai-os/stores';
import { mailer } from './mailer';
import { logger } from './logger';
import { parseUserAgent } from './authTokens';
import { getPlatformAdminEmail, isPlatformAdminEmail } from './platformAdmin';

export type AuthenticationMethod = 'password' | 'google' | 'email';

export interface RecordSuccessfulLoginInput {
  userId: string;
  email: string;
  displayName?: string | null;
  homeOrganizationId: string;
  authMethod: AuthenticationMethod;
  ip: string;
  userAgent?: string | null;
  device: string;
  browser: string;
  os?: string;
}

export interface RecordSuccessfulLoginResult {
  loginEventId: string | null;
  skippedDuplicate: boolean;
  workspaceId: string | null;
  workspaceName: string | null;
}

const DEDUP_WINDOW_SECONDS = 90;

function authDetail(method: AuthenticationMethod) {
  if (method === 'google') return 'google_login';
  if (method === 'password') return 'login_success';
  return 'login_success';
}

async function logAuthEvent(
  organizationId: string,
  userId: string,
  eventType: string,
  detail: Record<string, unknown>
) {
  await query(
    `insert into audit_logs (organization_id, user_id, event_type, detail) values ($1::uuid, $2::uuid, $3, $4)`,
    [organizationId, userId, 'auth', { subEvent: eventType, ...detail }]
  ).catch((err) => logger.error('audit_log.write_failed', { message: err.message }));
}

async function resolveWorkspaceContext(userId: string, homeOrganizationId: string) {
  const result = await query<{ workspace_id: string; workspace_name: string }>(
    `select coalesce(u.active_organization_id, u.organization_id) as workspace_id,
            o.name as workspace_name
     from users u
     left join organizations o on o.id = coalesce(u.active_organization_id, u.organization_id)
     where u.id = $1`,
    [userId]
  );
  const row = result.rows[0];
  return {
    workspaceId: row?.workspace_id ?? homeOrganizationId,
    workspaceName: row?.workspace_name ?? null,
  };
}

export async function hasRecentSuccessfulLogin(
  userId: string,
  authMethod: AuthenticationMethod,
  windowSeconds = DEDUP_WINDOW_SECONDS
): Promise<boolean> {
  const result = await query<{ id: string }>(
    `select id from login_history
     where user_id = $1
       and success = true
       and coalesce(authentication_method, 'password') = $2
       and created_at > now() - ($3::text || ' seconds')::interval
     limit 1`,
    [userId, authMethod, String(windowSeconds)]
  );
  return Boolean(result.rows[0]);
}

function welcomeMessage(displayName: string | null | undefined, email: string): string {
  const raw = (displayName || '').trim();
  const first = raw.split(/\s+/)[0];
  const name = first && first.length > 1 ? first : email.split('@')[0];
  return `Welcome back, ${name}.`;
}

async function notifyLoginSuccess(
  input: RecordSuccessfulLoginInput,
  workspaceName: string | null
): Promise<void> {
  const time = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const methodLabel = input.authMethod === 'google' ? 'Google' : 'Password';

  void mailer
    .sendLoginNotification(input.email, {
      name: input.displayName || input.email,
      time,
      device: input.device,
      browser: input.browser,
      os: input.os,
      ip: input.ip,
    })
    .catch((err) =>
      logger.warn('auth.login.user_notification_failed', { message: (err as Error).message })
    );

  if (!isPlatformAdminEmail(input.email)) {
    void mailer
      .sendPlatformAdminLoginNotification({
        name: input.displayName ?? null,
        email: input.email,
        method: methodLabel,
        workspaceName,
        timestamp: time,
        ip: input.ip,
        browser: input.browser,
        device: input.device,
      })
      .catch((err) =>
        logger.warn('auth.login.admin_notification_failed', { message: (err as Error).message })
      );
  }
}

/**
 * Record exactly one successful login event (deduped) and fire async notifications.
 * Must only be called after authentication has succeeded.
 */
export async function recordSuccessfulLogin(
  input: RecordSuccessfulLoginInput
): Promise<RecordSuccessfulLoginResult> {
  const duplicate = await hasRecentSuccessfulLogin(input.userId, input.authMethod);
  if (duplicate) {
    logger.info('auth.login.duplicate_skipped', {
      userId: input.userId,
      authMethod: input.authMethod,
    });
    const workspace = await resolveWorkspaceContext(input.userId, input.homeOrganizationId);
    return {
      loginEventId: null,
      skippedDuplicate: true,
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
    };
  }

  const workspace = await resolveWorkspaceContext(input.userId, input.homeOrganizationId);

  await query(`update users set last_login = now() where id = $1`, [input.userId]);

  const inserted = await query<{ id: string }>(
    `insert into login_history (
       user_id, organization_id, ip, user_agent, device, browser, success, authentication_method
     ) values ($1, $2, $3, $4, $5, $6, true, $7)
     returning id`,
    [
      input.userId,
      workspace.workspaceId,
      input.ip,
      input.userAgent ?? null,
      input.device,
      input.browser,
      input.authMethod,
    ]
  );

  await logAuthEvent(workspace.workspaceId, input.userId, authDetail(input.authMethod), {
    email: input.email,
    device: input.device,
    browser: input.browser,
    os: input.os,
    ip: input.ip,
    authenticationMethod: input.authMethod,
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.workspaceName,
  });

  void notifyLoginSuccess(input, workspace.workspaceName);

  return {
    loginEventId: inserted.rows[0]?.id ?? null,
    skippedDuplicate: false,
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.workspaceName,
  };
}

export function loginRequestMeta(req: Pick<Request, 'header' | 'socket'>) {
  const { device, browser, os } = parseUserAgent(req.header('user-agent'));
  const ip = (req.header('x-forwarded-for') ?? req.socket.remoteAddress ?? 'unknown').toString();
  return { device, browser, os, ip, userAgent: req.header('user-agent') };
}

export function buildWelcomeMessage(
  displayName: string | null | undefined,
  email: string
): string {
  return welcomeMessage(displayName, email);
}

export function platformAdminRecipient(): string {
  return getPlatformAdminEmail();
}
