import nodemailer from 'nodemailer';
import { logger } from './logger';
import { webAppUrl } from './authTokens';

type SmtpProfile = {
  label: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
};

const SMTP_TIMEOUT_MS = 12_000;
const SMTP_PROFILES: SmtpProfile[] = [
  { label: 'gmail-465', port: 465, secure: true },
  { label: 'gmail-587', port: 587, secure: false, requireTLS: true },
];

let _transporter: nodemailer.Transporter | null = null;
let _activeProfile: string | null = null;

/** Last SMTP outcome for /health (no secrets, no message bodies). */
let lastEmailDiag: {
  at: string;
  delivered: boolean;
  mode: 'smtp' | 'console_fallback' | 'failed' | 'verify';
  profile?: string | null;
  errorCode?: string | null;
} | null = null;

export function getEmailDiagnostics() {
  return {
    configured: Boolean(emailCredentials()),
    last: lastEmailDiag,
    activeProfile: _activeProfile,
  };
}

function emailCredentials(): { user: string; pass: string } | null {
  const user = (process.env.EMAIL_USER ?? '').trim();
  const pass = (process.env.EMAIL_PASS ?? '').trim().replace(/\s+/g, '');
  if (!user || !pass) return null;
  return { user, pass };
}

function buildTransport(profile: SmtpProfile, creds: { user: string; pass: string }) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: profile.port,
    secure: profile.secure,
    requireTLS: profile.requireTLS,
    auth: { user: creds.user, pass: creds.pass },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    tls: { minVersion: 'TLSv1.2' },
  });
}

function resetTransporter() {
  _transporter = null;
  _activeProfile = null;
}

async function sendMailWithTimeout(
  transporter: nodemailer.Transporter,
  mail: nodemailer.SendMailOptions
): Promise<nodemailer.SentMessageInfo> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      transporter.sendMail(mail),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error('SMTP send timed out'), { code: 'ETIMEDOUT' })),
          SMTP_TIMEOUT_MS + 2_000
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function verifyWithTimeout(transporter: nodemailer.Transporter): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      transporter.verify(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error('SMTP verify timed out'), { code: 'ETIMEDOUT' })),
          SMTP_TIMEOUT_MS + 2_000
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Probe Gmail SMTP from this runtime (used by /health). Never logs secrets. */
export async function probeSmtpConnectivity(): Promise<{
  ok: boolean;
  profile?: string;
  errorCode?: string;
}> {
  const creds = emailCredentials();
  if (!creds) return { ok: false, errorCode: 'not_configured' };

  for (const profile of SMTP_PROFILES) {
    const transporter = buildTransport(profile, creds);
    try {
      await verifyWithTimeout(transporter);
      _transporter = transporter;
      _activeProfile = profile.label;
      lastEmailDiag = {
        at: new Date().toISOString(),
        delivered: true,
        mode: 'verify',
        profile: profile.label,
        errorCode: null,
      };
      return { ok: true, profile: profile.label };
    } catch (err) {
      const e = err as Error & { code?: string; responseCode?: number };
      const errorCode = e.code || (e.responseCode ? `smtp_${e.responseCode}` : 'unknown');
      logger.warn('email.smtp_probe_failed', { profile: profile.label, code: errorCode, message: e.message });
      lastEmailDiag = {
        at: new Date().toISOString(),
        delivered: false,
        mode: 'verify',
        profile: profile.label,
        errorCode,
      };
    }
  }
  resetTransporter();
  return { ok: false, errorCode: lastEmailDiag?.errorCode || 'unreachable' };
}

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
        Automated security message from Nexora OS · <a href="${webAppUrl()}/app/dashboard" style="color:#93c5fd;text-decoration:none;">Open app</a>
      </div>
    </div>
  </div>
</body></html>`;
}

export type EmailDeliveryResult = {
  delivered: boolean;
  mode: 'smtp' | 'console_fallback' | 'failed';
  errorCode?: string;
  profile?: string;
};

async function sendViaProfiles(
  creds: { user: string; pass: string },
  mail: nodemailer.SendMailOptions
): Promise<EmailDeliveryResult> {
  const errors: string[] = [];
  for (const profile of SMTP_PROFILES) {
    const transporter = buildTransport(profile, creds);
    try {
      await sendMailWithTimeout(transporter, mail);
      _transporter = transporter;
      _activeProfile = profile.label;
      lastEmailDiag = {
        at: new Date().toISOString(),
        delivered: true,
        mode: 'smtp',
        profile: profile.label,
        errorCode: null,
      };
      return { delivered: true, mode: 'smtp', profile: profile.label };
    } catch (err) {
      const e = err as Error & { code?: string; responseCode?: number };
      const errorCode = e.code || (e.responseCode ? `smtp_${e.responseCode}` : 'unknown');
      errors.push(`${profile.label}:${errorCode}`);
      logger.error('email.failed', {
        to: mail.to,
        subject: mail.subject,
        profile: profile.label,
        message: e.message,
        code: errorCode,
      });
      lastEmailDiag = {
        at: new Date().toISOString(),
        delivered: false,
        mode: 'failed',
        profile: profile.label,
        errorCode,
      };
    }
  }
  resetTransporter();
  return { delivered: false, mode: 'failed', errorCode: errors.join('|') || 'unknown' };
}

async function send(
  to: string,
  subject: string,
  html: string,
  debugLink?: string
): Promise<EmailDeliveryResult> {
  const creds = emailCredentials();
  if (!creds) {
    logger.info('email.console_fallback', { to, subject, debugLink: debugLink || null });
    lastEmailDiag = {
      at: new Date().toISOString(),
      delivered: false,
      mode: 'console_fallback',
      errorCode: 'not_configured',
    };
    return { delivered: false, mode: 'console_fallback' };
  }
  const result = await sendViaProfiles(creds, {
    from: `Nexora OS <${creds.user}>`,
    to,
    subject,
    html,
  });
  if (!result.delivered && debugLink) {
    console.log(`[email:failed-fallback] ${subject} → ${to}\nLink: ${debugLink}`);
  }
  if (result.delivered) {
    logger.info('email.sent', { to, subject, profile: result.profile });
  }
  return result;
}

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
         ${ctaButton(dashboard, 'Open your dashboard')}
         <p style="font-size:12px;color:#94a3b8;">Check your inbox for a verification link to unlock chat and integrations.</p>`
      ),
      dashboard
    );
  },

  sendSignupConfirmation: (to: string, displayName: string | null) => mailer.sendWelcome(to, displayName),

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

  sendLoginNotification: (
    to: string,
    detail: {
      name?: string;
      time: string;
      device: string;
      browser: string;
      os?: string;
      ip: string;
      location?: string;
    }
  ) => {
    const resetUrl = `${webAppUrl()}/login?mode=forgot`;
    const name = detail.name ? escapeHtml(detail.name) : 'there';
    return send(
      to,
      'New Login Detected — Nexora OS',
      baseTemplate(
        'New login detected',
        `<p>Hi ${name}, someone just signed in to your Nexora account.</p>
         <table style="width:100%;font-size:13px;color:#cbd5e1;margin:16px 0;border-collapse:collapse;">
           <tr><td style="padding:8px 0;color:#94a3b8;width:110px;">Name</td><td style="padding:8px 0;">${name}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Time</td><td style="padding:8px 0;">${escapeHtml(detail.time)}</td></tr>
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
        `<p>Your <strong>${escapeHtml(tool)}</strong> account is now connected to <em>your</em> Nexora workspace — not shared with other users.</p>
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

  sendWorkspaceInvitation: (opts: {
    to: string;
    workspaceName: string;
    inviterName: string | null;
    role: string;
    rawToken: string;
    expiresAt: Date;
  }): Promise<EmailDeliveryResult> => {
    const acceptUrl = `${webAppUrl()}/invite/${encodeURIComponent(opts.rawToken)}`;
    const inviter = opts.inviterName ? escapeHtml(opts.inviterName) : 'A teammate';
    const workspace = escapeHtml(opts.workspaceName);
    const role = escapeHtml(opts.role);
    const expires = escapeHtml(opts.expiresAt.toUTCString());
    return send(
      opts.to,
      `You're invited to join ${opts.workspaceName} on Nexora`,
      baseTemplate(
        'NEXORA',
        `<p>You've been invited to join:</p>
         <p style="font-size:18px;font-weight:600;color:#e2e8f0;">${workspace}</p>
         <p>Invited by: <strong>${inviter}</strong><br/>Role: <strong>${role}</strong></p>
         <p>This invitation expires on <strong>${expires}</strong> and can only be accepted with this email address.</p>
         ${ctaButton(acceptUrl, 'ACCESS WORKSPACE')}
         <p style="font-size:12px;color:#94a3b8;word-break:break-all;">Or paste this link:<br/>${escapeHtml(acceptUrl)}</p>`
      ),
      acceptUrl
    );
  },
};
