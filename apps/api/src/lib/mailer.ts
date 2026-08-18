import nodemailer from 'nodemailer';
import { logger } from './logger';
import { webAppUrl } from './authTokens';

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) return null;
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
  }
  return _transporter;
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
  /** True only when SMTP accepted the message. Console fallback is NOT delivery. */
  delivered: boolean;
  mode: 'smtp' | 'console_fallback' | 'failed';
};

async function send(
  to: string,
  subject: string,
  html: string,
  debugLink?: string
): Promise<EmailDeliveryResult> {
  const transporter = getTransporter();
  if (!transporter) {
    logger.info('email.console_fallback', { to, subject, debugLink: debugLink || null });
    console.log('\n========== NEXORA EMAIL (dev fallback — EMAIL_USER/EMAIL_PASS not set) ==========');
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    if (debugLink) console.log(`Link:    ${debugLink}`);
    console.log('================================================================================\n');
    // Invitation created ≠ email delivered. Callers must not claim "sent".
    return { delivered: false, mode: 'console_fallback' };
  }
  try {
    const from = process.env.EMAIL_USER;
    await transporter.sendMail({ from: `Nexora OS <${from}>`, to, subject, html });
    logger.info('email.sent', { to, subject });
    return { delivered: true, mode: 'smtp' };
  } catch (err) {
    logger.error('email.failed', { to, subject, message: (err as Error).message });
    // Still surface links in logs so reset/verify never silently fails
    if (debugLink) {
      console.log(`[email:failed-fallback] ${subject} → ${to}\nLink: ${debugLink}`);
    }
    return { delivered: false, mode: 'failed' };
  }
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

  /**
   * Team workspace invitation. Returns delivery status — never invents success
   * when SMTP is unset or send fails.
   */
  sendWorkspaceInvitation: (opts: {
    to: string;
    workspaceName: string;
    inviterName: string | null;
    role: string;
    rawToken: string;
    expiresAt: Date;
  }): Promise<EmailDeliveryResult> => {
    const acceptUrl = `${webAppUrl()}/app/invitations/accept?token=${encodeURIComponent(opts.rawToken)}`;
    const inviter = opts.inviterName ? escapeHtml(opts.inviterName) : 'A teammate';
    const workspace = escapeHtml(opts.workspaceName);
    const role = escapeHtml(opts.role);
    const expires = escapeHtml(opts.expiresAt.toUTCString());
    return send(
      opts.to,
      `You're invited to join ${opts.workspaceName} on Nexora`,
      baseTemplate(
        'Team invitation',
        `<p>${inviter} invited you to join <strong>${workspace}</strong> as <strong>${role}</strong>.</p>
         <p>This invitation expires on <strong>${expires}</strong> and can only be accepted with this email address.</p>
         ${ctaButton(acceptUrl, 'Accept invitation')}
         <p style="font-size:12px;color:#94a3b8;word-break:break-all;">Or paste this link:<br/>${escapeHtml(acceptUrl)}</p>`
      ),
      acceptUrl
    );
  },
};
