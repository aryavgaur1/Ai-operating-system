import { logger } from './logger';
import { webAppUrl } from './authTokens';
import { getPlatformAdminEmail } from './platformAdmin';

// ─── Gmail API mailer ─────────────────────────────────────────────────────────
// Sends email via Gmail REST API over HTTPS (port 443).
// No Resend. No SMTP. No nodemailer. No domain verification. No DNS.

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_TIMEOUT_MS = 15_000;

/** Match Nexora web typography (Instrument Sans / Inter stack with email-safe fallbacks). */
const EMAIL_FONT =
  "'Inter','Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif";

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
// RFC 2047 encoded-word for non-ASCII subjects (prevents em-dash mojibake on mobile Gmail).

function encodeMimeSubject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  const b64 = Buffer.from(subject, 'utf8').toString('base64');
  return `=?UTF-8?B?${b64}?=`;
}

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

  // multipart/alternative: text first (lowest priority), HTML last (highest priority).
  // Gmail always picks the LAST part — HTML card will always render, never plain text.
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${encodeMimeSubject(opts.subject)}`,
    `Date: ${date}`,
    `Message-ID: ${msgId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    'X-Mailer: Nexora OS',
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    opts.text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
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

function baseTemplate(title: string, bodyHtml: string, preheader = ''): string {
  // Gmail-safe dark card:
  // - background-color on every td (not just table/body — Gmail strips those)
  // - no CSS variables, no @media, no shorthand background
  // - border via box-shadow (Gmail strips border on tables in some clients)
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&amp;display=swap" rel="stylesheet"/>
<style>
  body{margin:0;padding:0;background-color:#070b12 !important;font-family:${EMAIL_FONT};}
  .wrapper{background-color:#070b12 !important;}
  .card{background-color:#0f172a !important;}
  .card-header{background-color:#0f172a !important;}
  .card-body{background-color:#0f172a !important;}
  .card-footer{background-color:#0f172a !important;}
  .details-header{background-color:#0a1628 !important;}
  .details-row{background-color:#0f172a !important;}
</style>
</head>
<body style="margin:0;padding:0;background-color:#070b12;" bgcolor="#070b12">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:#070b12;">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>` : ''}
<table class="wrapper" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#070b12">
  <tr>
    <td align="center" style="padding:40px 16px;background-color:#070b12;" bgcolor="#070b12">

      <table class="card" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:560px;background-color:#0f172a;border-radius:16px;box-shadow:0 0 0 1px #1e293b;"
             bgcolor="#0f172a">

        <!-- Brand header -->
        <tr>
          <td class="card-header" style="padding:28px 32px 0;background-color:#0f172a;border-radius:16px 16px 0 0;" bgcolor="#0f172a">
            <span style="font-family:${EMAIL_FONT};font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#60a5fa;font-weight:700;">NEXORA OS</span>
          </td>
        </tr>

        <!-- Main content -->
        <tr>
          <td class="card-body" style="padding:20px 32px 32px;background-color:#0f172a;font-family:${EMAIL_FONT};font-size:14px;line-height:1.7;color:#cbd5e1;" bgcolor="#0f172a">
            ${bodyHtml}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td class="card-footer" style="padding:18px 32px 24px;background-color:#0f172a;border-top:1px solid #1e293b;border-radius:0 0 16px 16px;" bgcolor="#0f172a">
            <p style="margin:0;font-family:${EMAIL_FONT};font-size:12px;color:#475569;line-height:1.5;">
              Automated message from Nexora OS &nbsp;&middot;&nbsp;
              <a href="${escapeHtml(webAppUrl())}/app/dashboard" style="color:#60a5fa;text-decoration:none;">Open app</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function primaryButton(href: string, label: string): string {
  // Solid background fallback for clients that don't support gradients
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;">
    <tr>
      <td align="center" bgcolor="#4f6ef7" style="background-color:#4f6ef7;border-radius:50px;mso-padding-alt:0;">
        <a href="${escapeHtml(href)}"
           style="display:inline-block;padding:14px 32px;font-family:${EMAIL_FONT};font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:50px;letter-spacing:0.5px;background-color:#4f6ef7;"
           target="_blank">${label}</a>
      </td>
    </tr>
  </table>`;
}

function infoRow(label: string, value: string): string {
  return `<tr class="details-row" bgcolor="#0f172a">
    <td colspan="2" style="padding:14px 20px;border-bottom:1px solid #1e293b;font-family:${EMAIL_FONT};background-color:#0f172a;" bgcolor="#0f172a">
      <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">${escapeHtml(label)}</p>
      <p style="margin:0;font-size:15px;font-weight:600;line-height:1.4;color:#e2e8f0;word-break:break-word;">${escapeHtml(value)}</p>
    </td>
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

  sendPlatformAdminLoginNotification: (opts: {
    name: string | null;
    email: string;
    method: string;
    workspaceName: string | null;
    timestamp: string;
    ip?: string;
    browser?: string;
    device?: string;
  }) => {
    const admin = getPlatformAdminEmail();
    const subject = 'New successful login — Nexora OS';
    const workspace = opts.workspaceName || 'Unknown workspace';
    const text = [
      'New successful login on Nexora OS.',
      '',
      opts.name || opts.email,
      opts.email,
      '',
      `Signed in with ${opts.method}`,
      `Workspace: ${workspace}`,
      opts.timestamp,
      opts.browser ? `Browser: ${opts.browser}` : '',
      opts.ip ? `IP: ${opts.ip}` : '',
      '',
      'Nexora OS',
    ]
      .filter(Boolean)
      .join('\n');
    return send(admin, subject, baseTemplate(subject,
      `<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">New successful login</p>
       <p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#18181b;">${escapeHtml(opts.name || opts.email)}</p>
       <p style="margin:0 0 20px;color:#52525b;">${escapeHtml(opts.email)}</p>
       <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 8px;">${[
         infoRow('Method', opts.method),
         infoRow('Workspace', workspace),
         infoRow('Time', opts.timestamp),
         opts.browser ? infoRow('Browser', opts.browser) : '',
         opts.device ? infoRow('Device', opts.device) : '',
         opts.ip ? infoRow('IP address', opts.ip) : '',
       ].filter(Boolean).join('')}</table>`,
      `Login: ${opts.email}`
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
    const subject = `Nexora OS - You've been invited to join ${opts.workspaceName}`;
    const inviter = opts.inviterName || 'A teammate';
    const role = opts.role;

    const text = [
      `Hi,`,
      ``,
      `${inviter} has invited you to join ${opts.workspaceName} on Nexora OS.`,
      ``,
      `Your role: ${role}`,
      ``,
      `Click the link below to accept your invitation and access the workspace:`,
      acceptUrl,
      ``,
      `This invitation was sent to: ${opts.to}`,
      `It expires on: ${opts.expiresAt.toUTCString()}`,
      ``,
      `If you don't see this email in your inbox, please check your Spam/Junk or Promotions folder.`,
      ``,
      `If you were not expecting this invitation, you can safely ignore this email.`,
      ``,
      `— Nexora OS`,
    ].join('\n');

    const html = baseTemplate(
      subject,
      `<p style="margin:0 0 8px;font-family:${EMAIL_FONT};font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">You've been invited to join<br/><span style="color:#60a5fa;">${escapeHtml(opts.workspaceName)}</span></p>
       <p style="margin:0 0 24px;font-family:${EMAIL_FONT};color:#94a3b8;font-size:14px;">${escapeHtml(inviter)} has invited you to collaborate on <strong style="color:#cbd5e1;">Nexora OS</strong>.</p>

       <table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:0 0 28px;border-radius:10px;box-shadow:0 0 0 1px #1e293b;">
         <tr class="details-header" bgcolor="#0a1628">
           <td colspan="2" bgcolor="#0a1628" style="padding:14px 20px;border-bottom:1px solid #1e293b;border-radius:10px 10px 0 0;background-color:#0a1628;">
             <span style="font-family:${EMAIL_FONT};font-size:11px;font-weight:700;color:#60a5fa;text-transform:uppercase;letter-spacing:2px;">Invitation Details</span>
           </td>
         </tr>
         ${infoRow('Workspace', opts.workspaceName)}
         ${infoRow('Invited by', inviter)}
         ${infoRow('Your role', role)}
       </table>

       <p style="margin:0 0 6px;font-family:${EMAIL_FONT};font-size:14px;color:#94a3b8;">Click the button below to access your workspace:</p>
       ${primaryButton(acceptUrl, 'ACCESS WORKSPACE')}

       <p style="margin:20px 0 0;font-size:12px;color:#475569;">
         Or copy this link into your browser:<br/>
         <a href="${escapeHtml(acceptUrl)}" style="color:#60a5fa;word-break:break-all;text-decoration:none;">${escapeHtml(acceptUrl)}</a>
       </p>
       <p style="margin:16px 0 0;font-size:12px;color:#475569;">
         This invitation was sent to <strong style="color:#94a3b8;">${escapeHtml(opts.to)}</strong> and expires on ${escapeHtml(opts.expiresAt.toUTCString())}.
       </p>
       <p style="margin:14px 0 0;font-size:12px;color:#64748b;font-style:italic;">
         If you don't see this email in your inbox, please check your <strong style="color:#94a3b8;">Spam/Junk</strong> or <strong style="color:#94a3b8;">Promotions</strong> folder.
       </p>`,
      `${inviter} invited you to join ${opts.workspaceName} on Nexora OS`
    );

    return send(opts.to, subject, html, text, acceptUrl);
  },
};
