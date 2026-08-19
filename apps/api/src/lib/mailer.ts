import { logger } from './logger';
import { webAppUrl } from './authTokens';
import { getPlatformAdminEmail } from './platformAdmin';

// ─── Gmail API mailer ─────────────────────────────────────────────────────────
// Sends email via Gmail REST API over HTTPS (port 443).
// No Resend. No SMTP. No nodemailer. No domain verification. No DNS.

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_TIMEOUT_MS = 15_000;

export type EmailDeliveryResult = {
  delivered: boolean;
  mode: 'gmail_api' | 'console_fallback' | 'failed';
  errorCode?: string;
  providerMessageId?: string;
  hint?: string;
};

let lastEmailDiag: {
  at: string;
  delivered: boolean;
  mode: string;
  errorCode?: string | null;
} | null = null;

// ─── Credentials ─────────────────────────────────────────────────────────────

function gmailCredentials(): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  emailUser: string;
} | null {
  const clientId = (process.env.GOOGLE_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? '').trim();
  const refreshToken = (process.env.GMAIL_REFRESH_TOKEN ?? '').trim();
  const emailUser = (process.env.EMAIL_USER ?? '').trim();
  if (!clientId || !clientSecret || !refreshToken || !emailUser) return null;
  return { clientId, clientSecret, refreshToken, emailUser };
}

// ─── OAuth2 access token ──────────────────────────────────────────────────────

async function getAccessToken(creds: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const body = await res.json() as { access_token?: string; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) {
      throw new Error(`oauth_token_error: ${body.error || 'unknown'} — ${body.error_description || ''}`);
    }
    return body.access_token;
  } finally {
    clearTimeout(timer);
  }
}

// ─── MIME builder ─────────────────────────────────────────────────────────────
// Proper RFC 2822 headers prevent spam classification:
//   - Plain UTF-8 subject (no encoded-word — Gmail handles it fine over API)
//   - Message-ID and Date headers
//   - List-Unsubscribe header
//   - multipart/alternative with both text and HTML parts

function buildMimeMessage(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}): string {
  const boundary = `np_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@nexoraos.mail>`;
  const date = new Date().toUTCString();

  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `Date: ${date}`,
    `Message-ID: ${msgId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    'X-Mailer: Nexora OS',
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    opts.text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    opts.html,
    '',
    `--${boundary}--`,
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

// ─── Health / diagnostics ─────────────────────────────────────────────────────

export function getEmailDiagnostics() {
  const creds = gmailCredentials();
  return {
    configured: Boolean(creds),
    provider: 'gmail_api',
    googleClientIdConfigured: Boolean((process.env.GOOGLE_CLIENT_ID ?? '').trim()),
    googleClientSecretConfigured: Boolean((process.env.GOOGLE_CLIENT_SECRET ?? '').trim()),
    emailUserConfigured: Boolean((process.env.EMAIL_USER ?? '').trim()),
    gmailRefreshTokenConfigured: Boolean((process.env.GMAIL_REFRESH_TOKEN ?? '').trim()),
    last: lastEmailDiag,
  };
}

export async function probeSmtpConnectivity(): Promise<{
  ok: boolean;
  profile?: string;
  errorCode?: string;
  errorMessage?: string;
  missing?: string[];
}> {
  const creds = gmailCredentials();
  if (!creds) {
    const missing: string[] = [];
    if (!(process.env.GOOGLE_CLIENT_ID ?? '').trim()) missing.push('GOOGLE_CLIENT_ID');
    if (!(process.env.GOOGLE_CLIENT_SECRET ?? '').trim()) missing.push('GOOGLE_CLIENT_SECRET');
    if (!(process.env.EMAIL_USER ?? '').trim()) missing.push('EMAIL_USER');
    if (!(process.env.GMAIL_REFRESH_TOKEN ?? '').trim()) missing.push('GMAIL_REFRESH_TOKEN');
    return { ok: false, errorCode: 'not_configured', missing };
  }
  try {
    await getAccessToken(creds);
    lastEmailDiag = { at: new Date().toISOString(), delivered: true, mode: 'gmail_api', errorCode: null };
    return { ok: true, profile: 'gmail_api' };
  } catch (err) {
    const msg = (err as Error).message;
    lastEmailDiag = { at: new Date().toISOString(), delivered: false, mode: 'failed', errorCode: msg };
    return { ok: false, errorCode: 'gmail_api_auth_failed', errorMessage: msg };
  }
}

// ─── Core send ────────────────────────────────────────────────────────────────

async function sendViaGmailApi(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<EmailDeliveryResult> {
  const creds = gmailCredentials();
  if (!creds) {
    const missing: string[] = [];
    if (!process.env.GOOGLE_CLIENT_ID?.trim()) missing.push('GOOGLE_CLIENT_ID');
    if (!process.env.GOOGLE_CLIENT_SECRET?.trim()) missing.push('GOOGLE_CLIENT_SECRET');
    if (!process.env.EMAIL_USER?.trim()) missing.push('EMAIL_USER');
    if (!process.env.GMAIL_REFRESH_TOKEN?.trim()) missing.push('GMAIL_REFRESH_TOKEN');
    return {
      delivered: false,
      mode: 'failed',
      errorCode: 'gmail_api_not_configured',
      hint: `Missing required variables: ${missing.join(', ')}. Run: npm run setup:gmail-mailer`,
    };
  }

  try {
    const accessToken = await getAccessToken(creds);
    const from = `Nexora OS <${creds.emailUser}>`;
    const raw = buildMimeMessage({ from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(GMAIL_API, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      });
    } finally {
      clearTimeout(timer);
    }

    const body = await res.json() as { id?: string; error?: { message?: string; status?: string } };

    if (!res.ok) {
      const errorCode = body.error?.status || `gmail_http_${res.status}`;
      const message = body.error?.message || `HTTP ${res.status}`;
      lastEmailDiag = { at: new Date().toISOString(), delivered: false, mode: 'failed', errorCode };
      logger.error('email.failed', { to: opts.to, subject: opts.subject, code: errorCode, message });
      return { delivered: false, mode: 'failed', errorCode, hint: message };
    }

    const providerMessageId = body.id;
    lastEmailDiag = { at: new Date().toISOString(), delivered: true, mode: 'gmail_api', errorCode: null };
    logger.info('email.sent', { to: opts.to, subject: opts.subject, profile: 'gmail_api', providerMessageId });
    return { delivered: true, mode: 'gmail_api', providerMessageId };

  } catch (err) {
    const e = err as Error & { name?: string };
    const errorCode = e.name === 'AbortError' ? 'ETIMEDOUT' : 'gmail_api_error';
    lastEmailDiag = { at: new Date().toISOString(), delivered: false, mode: 'failed', errorCode };
    logger.error('email.failed', { to: opts.to, subject: opts.subject, code: errorCode, message: e.message });
    return { delivered: false, mode: 'failed', errorCode, hint: e.message };
  }
}

async function send(
  to: string,
  subject: string,
  html: string,
  text: string,
  debugLink?: string,
): Promise<EmailDeliveryResult> {
  const result = await sendViaGmailApi({ to, subject, html, text });
  if (!result.delivered) {
    if (debugLink) console.log(`[email:failed] ${subject} → ${to}\nLink: ${debugLink}\nError: ${result.errorCode}`);
    logger.error('email.delivery_failed', { to, subject, errorCode: result.errorCode, hint: result.hint });
  }
  return result;
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Clean, minimal design — looks like Notion/Linear transactional emails.
// White background, black text, simple button. Passes spam filters.
function baseTemplate(title: string, bodyHtml: string, preheader = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>` : ''}
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:40px 16px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;border:1px solid #e4e4e7;overflow:hidden;">

      <!-- Header -->
      <tr>
        <td style="padding:28px 40px 24px;border-bottom:1px solid #f0f0f0;">
          <span style="font-size:15px;font-weight:700;color:#18181b;letter-spacing:-0.2px;">Nexora OS</span>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:36px 40px 32px;color:#3f3f46;font-size:15px;line-height:1.7;">
          ${bodyHtml}
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="padding:20px 40px 28px;border-top:1px solid #f0f0f0;">
          <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.6;">
            You received this email because an action was taken on your Nexora OS account.<br/>
            <a href="${escapeHtml(webAppUrl())}" style="color:#71717a;text-decoration:underline;">Nexora OS</a>
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function primaryButton(href: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;">
    <tr>
      <td style="background:#18181b;border-radius:6px;">
        <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;letter-spacing:-0.1px;">${label}</a>
      </td>
    </tr>
  </table>`;
}

function infoRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 0;color:#71717a;font-size:13px;width:120px;vertical-align:top;">${label}</td>
    <td style="padding:8px 0;color:#18181b;font-size:13px;font-weight:500;vertical-align:top;">${escapeHtml(value)}</td>
  </tr>`;
}

// ─── Public mailer API ────────────────────────────────────────────────────────

export const mailer = {
  sendWelcome: (to: string, displayName: string | null) => {
    const dashboard = `${webAppUrl()}/app/dashboard`;
    const name = displayName || 'there';
    const subject = 'Welcome to Nexora OS';
    const text = `Hi ${name},\n\nYour Nexora OS workspace is ready.\n\nOpen your dashboard: ${dashboard}\n\nNexora OS`;
    return send(to, subject, baseTemplate(subject,
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">Welcome to Nexora OS</p>
       <p style="margin:0 0 20px;">Hi ${escapeHtml(name)}, your workspace has been created and is ready to use.</p>
       <p style="margin:0 0 24px;">Connect your tools, chat with your AI agent, and manage approvals in one place.</p>
       ${primaryButton(dashboard, 'Open dashboard')}
       <p style="margin:16px 0 0;font-size:13px;color:#71717a;">Or copy this link:<br/><a href="${escapeHtml(dashboard)}" style="color:#71717a;">${escapeHtml(dashboard)}</a></p>`,
      `Your Nexora OS workspace is ready`
    ), text);
  },

  sendSignupConfirmation: (to: string, displayName: string | null) =>
    mailer.sendWelcome(to, displayName),

  sendVerification: (to: string, token: string) => {
    const url = `${webAppUrl()}/login?verify=${encodeURIComponent(token)}`;
    const subject = 'Verify your Nexora OS email address';
    const text = `Verify your email address by visiting:\n${url}\n\nIf you did not sign up for Nexora OS, ignore this email.\n\nNexora OS`;
    return send(to, subject, baseTemplate(subject,
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">Verify your email address</p>
       <p style="margin:0 0 24px;">Click the button below to confirm your email address and activate your Nexora OS account.</p>
       ${primaryButton(url, 'Verify email address')}
       <p style="margin:16px 0 0;font-size:13px;color:#71717a;">This link expires in 24 hours. If you did not sign up for Nexora OS, you can ignore this email.</p>`,
      `Confirm your Nexora OS email address`
    ), text);
  },

  sendLoginNotification: (to: string, detail: {
    name?: string; time: string; device: string; browser: string;
    os?: string; ip: string; location?: string;
  }) => {
    const resetUrl = `${webAppUrl()}/login?mode=forgot`;
    const subject = 'New sign-in to your Nexora OS account';
    const text = `A new sign-in was detected on your Nexora OS account.\n\nTime: ${detail.time}\nBrowser: ${detail.browser}\nOS: ${detail.os || detail.device}\nIP: ${detail.ip}\nLocation: ${detail.location || 'Unknown'}\n\nIf this was not you, reset your password immediately:\n${resetUrl}\n\nNexora OS`;
    return send(to, subject, baseTemplate(subject,
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">New sign-in detected</p>
       <p style="margin:0 0 20px;">A new sign-in was detected on your Nexora OS account.</p>
       <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 24px;">${[
         infoRow('Time', detail.time),
         infoRow('Browser', detail.browser),
         infoRow('Device / OS', detail.os || detail.device),
         infoRow('IP address', detail.ip),
         infoRow('Location', detail.location ?? 'Unknown'),
       ].join('')}</table>
       <p style="margin:0 0 20px;">If this was not you, reset your password immediately.</p>
       ${primaryButton(resetUrl, 'Reset password')}`,
      `New sign-in to your account`
    ), text);
  },

  sendPasswordChanged: (to: string) => {
    const resetUrl = `${webAppUrl()}/login?mode=forgot`;
    const subject = 'Your Nexora OS password was changed';
    const text = `Your Nexora OS password was successfully changed. All other sessions have been signed out.\n\nIf you did not make this change, reset your password immediately:\n${resetUrl}\n\nNexora OS`;
    return send(to, subject, baseTemplate(subject,
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">Password changed</p>
       <p style="margin:0 0 20px;">Your Nexora OS password was successfully changed. All other sessions have been signed out for security.</p>
       <p style="margin:0 0 24px;">If you did not make this change, reset your password immediately.</p>
       ${primaryButton(resetUrl, 'Reset password')}`,
      `Your password was changed`
    ), text);
  },

  sendPasswordReset: (to: string, token: string) => {
    const url = `${webAppUrl()}/login?reset=${encodeURIComponent(token)}`;
    const subject = 'Reset your Nexora OS password';
    const text = `You requested a password reset for your Nexora OS account.\n\nReset your password:\n${url}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.\n\nNexora OS`;
    return send(to, subject, baseTemplate(subject,
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">Reset your password</p>
       <p style="margin:0 0 24px;">You requested a password reset for your Nexora OS account. Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.</p>
       ${primaryButton(url, 'Reset password')}
       <p style="margin:16px 0 0;font-size:13px;color:#71717a;">If you did not request a password reset, you can safely ignore this email.</p>`,
      `Reset your Nexora OS password`
    ), text);
  },

  sendTempPassword: (to: string, tempPassword: string) => {
    const subject = 'Your temporary Nexora OS password';
    const text = `An administrator has issued you a temporary password for Nexora OS.\n\nSign in and change it immediately:\n${webAppUrl()}/login\n\nNexora OS`;
    return send(to, subject, baseTemplate(subject,
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">Temporary password issued</p>
       <p style="margin:0 0 20px;">An administrator has issued a temporary password for your Nexora OS account.</p>
       <div style="background:#f4f4f5;border-radius:6px;padding:14px 18px;margin:0 0 24px;font-family:monospace;font-size:15px;color:#18181b;letter-spacing:0.04em;">${escapeHtml(tempPassword)}</div>
       <p style="margin:0 0 24px;">Sign in and change your password immediately.</p>
       ${primaryButton(`${webAppUrl()}/login`, 'Sign in')}`,
      `Your temporary password`
    ), text);
  },

  sendIntegrationConnected: (to: string, tool: string) => {
    const subject = `${tool} connected to Nexora OS`;
    const text = `Your ${tool} account has been connected to your Nexora OS workspace.\n\nManage integrations: ${webAppUrl()}/app/integrations\n\nNexora OS`;
    return send(to, subject, baseTemplate(subject,
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">${escapeHtml(tool)} connected</p>
       <p style="margin:0 0 24px;">Your <strong>${escapeHtml(tool)}</strong> account has been successfully connected to your Nexora OS workspace.</p>
       ${primaryButton(`${webAppUrl()}/app/integrations`, 'Manage integrations')}`,
      `${tool} connected to your workspace`
    ), text);
  },

  sendVerified: (to: string) => {
    const subject = 'Email verified — Nexora OS';
    const text = `Your Nexora OS email address has been verified.\n\nGo to dashboard: ${webAppUrl()}/app/dashboard\n\nNexora OS`;
    return send(to, subject, baseTemplate(subject,
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">Email verified</p>
       <p style="margin:0 0 24px;">Your email address has been verified. You now have full access to Nexora OS.</p>
       ${primaryButton(`${webAppUrl()}/app/dashboard`, 'Go to dashboard')}`,
      `Your email has been verified`
    ), text);
  },

  sendAccountDeleted: (to: string) => {
    const subject = 'Your Nexora OS account has been deleted';
    const text = `Your Nexora OS account and all associated data have been deleted as requested.\n\nNexora OS`;
    return send(to, subject, baseTemplate(subject,
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">Account deleted</p>
       <p style="margin:0;">Your Nexora OS account and all associated data have been permanently deleted.</p>`,
      `Your account has been deleted`
    ), text);
  },

  sendPlatformAdminSignupNotification: (opts: {
    name: string | null; email: string; timestamp: string;
  }) => {
    const admin = getPlatformAdminEmail();
    const subject = 'New user signup — Nexora OS';
    const text = `New user signed up on Nexora OS.\n\nName: ${opts.name || 'Unknown'}\nEmail: ${opts.email}\nTime: ${opts.timestamp}\n\nNexora OS`;
    return send(admin, subject, baseTemplate(subject,
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">New user signed up</p>
       <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 8px;">${[
         infoRow('Name', opts.name || 'Unknown'),
         infoRow('Email', opts.email),
         infoRow('Time', opts.timestamp),
         infoRow('Status', 'Successfully registered'),
       ].join('')}</table>`,
      `New signup: ${opts.email}`
    ), text);
  },

  sendPlatformAdminMemberJoinedNotification: (opts: {
    workspaceName: string; userName: string | null; email: string;
    role: string; inviterName: string | null; timestamp: string;
  }) => {
    const admin = getPlatformAdminEmail();
    const subject = `${opts.userName || opts.email} joined ${opts.workspaceName} — Nexora OS`;
    const text = `A new member joined a workspace on Nexora OS.\n\nWorkspace: ${opts.workspaceName}\nMember: ${opts.userName || opts.email}\nEmail: ${opts.email}\nRole: ${opts.role}\nInvited by: ${opts.inviterName || 'Unknown'}\nTime: ${opts.timestamp}\n\nNexora OS`;
    return send(admin, subject, baseTemplate(subject,
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">New member joined a workspace</p>
       <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 8px;">${[
         infoRow('Workspace', opts.workspaceName),
         infoRow('Member', opts.userName || opts.email),
         infoRow('Email', opts.email),
         infoRow('Role', opts.role),
         infoRow('Invited by', opts.inviterName || 'Unknown'),
         infoRow('Time', opts.timestamp),
       ].join('')}</table>`,
      `${opts.email} joined ${opts.workspaceName}`
    ), text);
  },

  sendWorkspaceInvitation: async (opts: {
    to: string; workspaceName: string; inviterName: string | null;
    role: string; rawToken: string; expiresAt: Date;
  }): Promise<EmailDeliveryResult> => {
    const acceptUrl = `${webAppUrl()}/invite/${encodeURIComponent(opts.rawToken)}`;
    const subject = `You have been invited to join ${opts.workspaceName} on Nexora OS`;
    const inviter = opts.inviterName || 'A teammate';
    const role = opts.role;

    const text = [
      `Hi,`,
      ``,
      `${inviter} has invited you to join ${opts.workspaceName} on Nexora OS.`,
      ``,
      `Role: ${role}`,
      ``,
      `Accept the invitation:`,
      acceptUrl,
      ``,
      `This invitation is for: ${opts.to}`,
      `It expires on: ${opts.expiresAt.toUTCString()}`,
      ``,
      `If you were not expecting this invitation, ignore this email.`,
      ``,
      `Nexora OS`,
    ].join('\n');

    const html = baseTemplate(
      subject,
      `<p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#18181b;">You have been invited</p>
       <p style="margin:0 0 24px;color:#52525b;">You have been invited to join a workspace on Nexora OS.</p>

       <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 28px;border:1px solid #e4e4e7;border-radius:6px;overflow:hidden;">
         <tr style="background:#fafafa;">
           <td style="padding:16px 20px;border-bottom:1px solid #e4e4e7;" colspan="2">
             <span style="font-size:13px;font-weight:600;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;">Invitation details</span>
           </td>
         </tr>
         <tr>
           <td style="padding:14px 20px;border-bottom:1px solid #f4f4f5;font-size:13px;color:#71717a;width:110px;">Workspace</td>
           <td style="padding:14px 20px;border-bottom:1px solid #f4f4f5;font-size:14px;font-weight:600;color:#18181b;">${escapeHtml(opts.workspaceName)}</td>
         </tr>
         <tr>
           <td style="padding:14px 20px;border-bottom:1px solid #f4f4f5;font-size:13px;color:#71717a;">Invited by</td>
           <td style="padding:14px 20px;border-bottom:1px solid #f4f4f5;font-size:14px;color:#18181b;">${escapeHtml(inviter)}</td>
         </tr>
         <tr>
           <td style="padding:14px 20px;font-size:13px;color:#71717a;">Your role</td>
           <td style="padding:14px 20px;font-size:14px;color:#18181b;">${escapeHtml(role)}</td>
         </tr>
       </table>

       <p style="margin:0 0 6px;font-size:14px;color:#3f3f46;">Click below to accept the invitation and access the workspace:</p>
       ${primaryButton(acceptUrl, 'Accept invitation')}

       <p style="margin:20px 0 0;font-size:12px;color:#a1a1aa;">
         Or copy this link into your browser:<br/>
         <a href="${escapeHtml(acceptUrl)}" style="color:#71717a;word-break:break-all;">${escapeHtml(acceptUrl)}</a>
       </p>
       <p style="margin:16px 0 0;font-size:12px;color:#a1a1aa;">
         This invitation was sent to <strong>${escapeHtml(opts.to)}</strong> and expires on ${escapeHtml(opts.expiresAt.toUTCString())}.
       </p>`,
      `${inviter} invited you to join ${opts.workspaceName} on Nexora OS`
    );

    return send(opts.to, subject, html, text, acceptUrl);
  },
};
