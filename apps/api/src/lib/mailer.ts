import { logger } from './logger';
import { webAppUrl } from './authTokens';
import { getPlatformAdminEmail } from './platformAdmin';

// ─── Gmail API mailer ─────────────────────────────────────────────────────────
// Sends email via Gmail REST API over HTTPS (port 443).
// Railway cannot block this — it's standard HTTPS to googleapis.com.
//
// No Resend. No SMTP. No nodemailer. No domain verification. No DNS.
//
// Required environment variables:
//   GOOGLE_CLIENT_ID      — existing Google OAuth client
//   GOOGLE_CLIENT_SECRET  — existing Google OAuth client secret
//   EMAIL_USER            — Gmail address that sends Nexora emails
//   GMAIL_REFRESH_TOKEN   — obtained once via: npm run setup:gmail-mailer
//   WEB_APP_URL           — https://ai-lilac-phi.vercel.app

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

// ─── MIME message builder ─────────────────────────────────────────────────────

function encodeMimeSubject(subject: string): string {
  // RFC 2047 encoded-word: =?utf-8?b?<base64>?=
  return `=?utf-8?b?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

function buildMimeMessage(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
}): string {
  const boundary = `nexora_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const lines: string[] = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${encodeMimeSubject(opts.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
  ];
  if (opts.text) {
    lines.push('Content-Type: text/plain; charset=UTF-8', '', opts.text, '', `--${boundary}`);
  }
  lines.push('Content-Type: text/html; charset=UTF-8', '', opts.html, '', `--${boundary}--`);
  const raw = lines.join('\r\n');
  return Buffer.from(raw).toString('base64url');
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
  text?: string;
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
  debugLink?: string,
  text?: string
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

function ctaButton(href: string, label: string): string {
  return `<p style="margin:28px 0 8px;"><a href="${href}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px;">${label}</a></p>`;
}

function baseTemplate(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;background:#070b12;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#070b12;padding:40px 16px;color:#e5e7eb;">
    <div style="max-width:520px;margin:0 auto;background:#0f172a;border-radius:20px;padding:36px 32px;border:1px solid #1e293b;box-shadow:0 20px 60px rgba(0,0,0,.45);">
      <div style="font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:#60a5fa;margin-bottom:18px;font-weight:600;">Nexora OS</div>
      <h1 style="font-size:22px;line-height:1.3;margin:0 0 18px;color:#ffffff;font-weight:650;">${title}</h1>
      <div style="font-size:14px;line-height:1.75;color:#cbd5e1;">${bodyHtml}</div>
      <div style="margin-top:36px;padding-top:20px;border-top:1px solid #1e293b;font-size:12px;color:#64748b;">
        Automated message from Nexora OS · <a href="${webAppUrl()}/app/dashboard" style="color:#93c5fd;text-decoration:none;">Open app</a>
      </div>
    </div>
  </div>
</body></html>`;
}

// ─── Public mailer API ────────────────────────────────────────────────────────

export const mailer = {
  sendWelcome: (to: string, displayName: string | null) => {
    const dashboard = `${webAppUrl()}/app/dashboard`;
    const name = displayName ? escapeHtml(displayName) : 'there';
    return send(
      to,
      'Welcome to Nexora — your workspace is ready',
      baseTemplate(
        `Welcome to Nexora, ${name}`,
        `<p>Your personal workspace has been created successfully.</p>
         <p><strong>Let's build with AI.</strong> Connect your own Slack and Notion, chat with your agent, and keep approvals in one place.</p>
         ${ctaButton(dashboard, 'Open your dashboard')}`
      ),
      dashboard
    );
  },

  sendSignupConfirmation: (to: string, displayName: string | null) =>
    mailer.sendWelcome(to, displayName),

  sendVerification: (to: string, token: string) => {
    const url = `${webAppUrl()}/login?verify=${encodeURIComponent(token)}`;
    return send(
      to,
      'Verify your Nexora email',
      baseTemplate(
        'Confirm your email',
        `<p>Click below to verify your account and unlock chat, approvals, and integrations.</p>
         ${ctaButton(url, 'Verify email')}
         <p style="font-size:12px;color:#94a3b8;word-break:break-all;">Or paste this link:<br/>${escapeHtml(url)}</p>`
      ),
      url
    );
  },

  sendLoginNotification: (to: string, detail: {
    name?: string; time: string; device: string; browser: string;
    os?: string; ip: string; location?: string;
  }) => {
    const resetUrl = `${webAppUrl()}/login?mode=forgot`;
    const name = detail.name ? escapeHtml(detail.name) : 'there';
    return send(
      to,
      'New Login Detected — Nexora OS',
      baseTemplate(
        'New login detected',
        `<p>Hi ${name}, someone just signed in to your Nexora account.</p>
         <table style="width:100%;font-size:13px;color:#cbd5e1;margin:16px 0;border-collapse:collapse;">
           <tr><td style="padding:8px 0;color:#94a3b8;width:110px;">Time</td><td style="padding:8px 0;">${escapeHtml(detail.time)}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Browser</td><td style="padding:8px 0;">${escapeHtml(detail.browser)}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Device / OS</td><td style="padding:8px 0;">${escapeHtml(detail.os || detail.device)}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">IP</td><td style="padding:8px 0;">${escapeHtml(detail.ip)}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Location</td><td style="padding:8px 0;">${escapeHtml(detail.location ?? 'Unknown')}</td></tr>
         </table>
         <p>If this wasn't you, reset your password immediately.</p>
         ${ctaButton(resetUrl, 'Reset password')}`
      )
    );
  },

  sendPasswordChanged: (to: string) => {
    const resetUrl = `${webAppUrl()}/login?mode=forgot`;
    return send(
      to,
      'Your password has been changed successfully — Nexora OS',
      baseTemplate(
        'Password changed successfully',
        `<p>Your Nexora password was updated. All other sessions have been signed out for security.</p>
         <p>If you did not make this change, reset your password now.</p>
         ${ctaButton(resetUrl, 'Secure my account')}`
      )
    );
  },

  sendPasswordReset: (to: string, token: string) => {
    const url = `${webAppUrl()}/login?reset=${encodeURIComponent(token)}`;
    return send(
      to,
      'Reset your Nexora password',
      baseTemplate(
        'Reset your password',
        `<p>We received a request to reset your Nexora password.</p>
         <p>This link expires in <strong>1 hour</strong> and can only be used once.</p>
         ${ctaButton(url, 'Choose a new password')}
         <p style="font-size:12px;color:#94a3b8;word-break:break-all;">Or paste this link:<br/>${escapeHtml(url)}</p>
         <p style="font-size:12px;color:#94a3b8;">If you didn't ask for this, you can ignore this email.</p>`
      ),
      url
    );
  },

  sendTempPassword: (to: string, tempPassword: string) =>
    send(
      to,
      'Temporary password — Nexora OS',
      baseTemplate(
        'Temporary password issued',
        `<p>An administrator issued a temporary password for your account.</p>
         <p style="font-size:16px;letter-spacing:.04em;background:#020617;border:1px solid #1e293b;border-radius:12px;padding:14px 16px;color:#f8fafc;"><code>${escapeHtml(tempPassword)}</code></p>
         <p>Sign in and change it immediately.</p>
         ${ctaButton(`${webAppUrl()}/login`, 'Sign in')}`
      )
    ),

  sendIntegrationConnected: (to: string, tool: string) =>
    send(
      to,
      `${tool} connected to Nexora`,
      baseTemplate(
        'Integration connected',
        `<p>Your <strong>${escapeHtml(tool)}</strong> account is now connected to <em>your</em> Nexora workspace.</p>
         ${ctaButton(`${webAppUrl()}/app/integrations`, 'Manage integrations')}`
      )
    ),

  sendVerified: (to: string) =>
    send(
      to,
      'Email verified — Nexora OS',
      baseTemplate(
        'You are verified',
        `<p>Your email is confirmed. You can use chat, approvals, and connect your own Slack &amp; Notion.</p>
         ${ctaButton(`${webAppUrl()}/app/dashboard`, 'Go to dashboard')}`
      )
    ),

  sendAccountDeleted: (to: string) =>
    send(
      to,
      'Your Nexora account was deleted',
      baseTemplate('Account deleted', `<p>Your Nexora account and workspace data have been deleted as requested.</p>`)
    ),

  sendPlatformAdminSignupNotification: (opts: {
    name: string | null; email: string; timestamp: string;
  }) => {
    const admin = getPlatformAdminEmail();
    return send(
      admin,
      'Nexora OS — New user successfully signed up',
      baseTemplate(
        'New user successfully signed up',
        `<p>A new user has registered on Nexora OS.</p>
         <table style="width:100%;font-size:14px;color:#cbd5e1;margin:16px 0;border-collapse:collapse;">
           <tr><td style="padding:8px 0;color:#94a3b8;width:110px;">Name</td><td style="padding:8px 0;">${escapeHtml(opts.name || 'Unknown')}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Email</td><td style="padding:8px 0;">${escapeHtml(opts.email)}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Time</td><td style="padding:8px 0;">${escapeHtml(opts.timestamp)}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Status</td><td style="padding:8px 0;"><strong>Successfully registered</strong></td></tr>
         </table>`
      )
    );
  },

  sendPlatformAdminMemberJoinedNotification: (opts: {
    workspaceName: string; userName: string | null; email: string;
    role: string; inviterName: string | null; timestamp: string;
  }) => {
    const admin = getPlatformAdminEmail();
    return send(
      admin,
      `Nexora OS — ${opts.userName || opts.email} joined ${opts.workspaceName}`,
      baseTemplate(
        'A new member has successfully joined a workspace',
        `<p>A new member has successfully joined a team workspace.</p>
         <table style="width:100%;font-size:14px;color:#cbd5e1;margin:16px 0;border-collapse:collapse;">
           <tr><td style="padding:8px 0;color:#94a3b8;width:120px;">Workspace</td><td style="padding:8px 0;"><strong>${escapeHtml(opts.workspaceName)}</strong></td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Member</td><td style="padding:8px 0;">${escapeHtml(opts.userName || opts.email)}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Email</td><td style="padding:8px 0;">${escapeHtml(opts.email)}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Role</td><td style="padding:8px 0;">${escapeHtml(opts.role)}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Invited by</td><td style="padding:8px 0;">${escapeHtml(opts.inviterName || 'Unknown')}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Time</td><td style="padding:8px 0;">${escapeHtml(opts.timestamp)}</td></tr>
         </table>`
      )
    );
  },

  sendWorkspaceInvitation: async (opts: {
    to: string; workspaceName: string; inviterName: string | null;
    role: string; rawToken: string; expiresAt: Date;
  }): Promise<EmailDeliveryResult> => {
    const acceptUrl = `${webAppUrl()}/invite/${encodeURIComponent(opts.rawToken)}`;
    const inviter = opts.inviterName ? escapeHtml(opts.inviterName) : 'A teammate';
    const workspace = escapeHtml(opts.workspaceName);
    const role = escapeHtml(opts.role);
    const invitedEmail = escapeHtml(opts.to);
    const expires = escapeHtml(opts.expiresAt.toUTCString());
    const subject = `Nexora OS — You have been invited to join ${opts.workspaceName}`;
    const plainText = [
      `You have been invited to join ${opts.workspaceName} on Nexora OS.`,
      '',
      `Invited by: ${opts.inviterName || 'A teammate'}`,
      `Role: ${opts.role}`,
      '',
      'You have been invited to collaborate in this Nexora workspace.',
      '',
      'ACCESS WORKSPACE:',
      acceptUrl,
      '',
      `This invitation is intended for: ${opts.to}`,
      `This invitation expires on ${opts.expiresAt.toUTCString()}.`,
      '',
      'If you did not expect this invitation, you can ignore this email.',
    ].join('\n');
    return send(
      opts.to,
      subject,
      baseTemplate(
        `You have been invited to join ${workspace}`,
        `<p style="font-size:16px;color:#e2e8f0;margin:0 0 20px;">You have been invited to join:</p>
         <p style="font-size:22px;font-weight:700;color:#ffffff;margin:0 0 20px;">${workspace}</p>
         <table style="width:100%;font-size:14px;color:#cbd5e1;margin:0 0 20px;border-collapse:collapse;">
           <tr><td style="padding:6px 0;color:#94a3b8;width:110px;">Invited by</td><td style="padding:6px 0;"><strong>${inviter}</strong></td></tr>
           <tr><td style="padding:6px 0;color:#94a3b8;">Role</td><td style="padding:6px 0;"><strong>${role}</strong></td></tr>
         </table>
         <p>You have been invited to collaborate in this Nexora workspace.</p>
         ${ctaButton(acceptUrl, 'ACCESS WORKSPACE')}
         <p style="font-size:13px;color:#94a3b8;margin-top:20px;">Or copy this link:<br/><span style="word-break:break-all;">${escapeHtml(acceptUrl)}</span></p>
         <p style="font-size:13px;color:#94a3b8;margin-top:16px;">This invitation is intended for:<br/><strong style="color:#e2e8f0;">${invitedEmail}</strong></p>
         <p style="font-size:12px;color:#64748b;margin-top:16px;">This invitation expires on ${expires}.</p>
         <p style="font-size:12px;color:#64748b;margin-top:12px;">If you did not expect this invitation, you can ignore this email.</p>`
      ),
      acceptUrl,
      plainText
    );
  },
};
