import nodemailer from 'nodemailer';
import { logger } from './logger';
import { webAppUrl } from './authTokens';
import { getPlatformAdminEmail } from './platformAdmin';

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

export type EmailProviderMode = 'resend' | 'smtp' | 'none';

/** Last email outcome for /health (no secrets, no bodies). */
let lastEmailDiag: {
  at: string;
  delivered: boolean;
  mode: 'smtp' | 'resend' | 'console_fallback' | 'failed' | 'verify';
  profile?: string | null;
  errorCode?: string | null;
} | null = null;

function normalizeProvider(raw: string | undefined): EmailProviderMode | null {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'resend') return 'resend';
  if (v === 'smtp') return 'smtp';
  if (v === 'none' || v === 'console') return 'none';
  return null;
}

/** Deterministic provider selection — never silently fall back when Resend is expected. */
export function resolveEmailProvider(): {
  mode: EmailProviderMode;
  configured: boolean;
  missing: string[];
  explicit: boolean;
} {
  const explicit = normalizeProvider(process.env.EMAIL_PROVIDER);
  const hasResend = Boolean(resendApiKey());
  const hasSmtp = Boolean(emailCredentials());
  const missing: string[] = [];

  if (explicit === 'resend') {
    if (!hasResend) missing.push('RESEND_API_KEY');
    return { mode: 'resend', configured: hasResend, missing, explicit: true };
  }
  if (explicit === 'smtp') {
    if (!hasSmtp) missing.push('EMAIL_USER', 'EMAIL_PASS');
    return { mode: 'smtp', configured: hasSmtp, missing, explicit: true };
  }
  if (explicit === 'none') {
    return { mode: 'none', configured: false, missing: [], explicit: true };
  }

  // No EMAIL_PROVIDER — infer from credentials (Resend preferred; no silent SMTP when Resend key exists).
  if (hasResend) return { mode: 'resend', configured: true, missing: [], explicit: false };
  if (hasSmtp) return { mode: 'smtp', configured: true, missing: [], explicit: false };
  return { mode: 'none', configured: false, missing: ['RESEND_API_KEY or EMAIL_USER/EMAIL_PASS'], explicit: false };
}

export function getEmailDiagnostics() {
  const selection = resolveEmailProvider();
  return {
    configured: selection.configured,
    provider: selection.mode,
    providerExplicit: selection.explicit,
    providerMissing: selection.missing,
    resendKeyPresent: Boolean(resendApiKey()),
    emailFromConfigured: Boolean((process.env.EMAIL_FROM ?? '').trim()),
    smtpConfigured: Boolean(emailCredentials()),
    last: lastEmailDiag,
    activeProfile: _activeProfile,
  };
}

function resendApiKey(): string | null {
  // Accept common aliases / accidental quoting from Railway paste.
  const raw =
    process.env.RESEND_API_KEY ??
    process.env.RESEND_KEY ??
    process.env.RESEND_TOKEN ??
    '';
  const key = String(raw).trim().replace(/^["']|["']$/g, '');
  return key || null;
}

function emailCredentials(): { user: string; pass: string } | null {
  const user = (process.env.EMAIL_USER ?? '').trim();
  const pass = (process.env.EMAIL_PASS ?? '').trim().replace(/\s+/g, '');
  if (!user || !pass) return null;
  return { user, pass };
}

function mailFromAddress(): string {
  const from = (process.env.EMAIL_FROM ?? '').trim();
  if (from) return from;
  // Resend rejects unverified Gmail "from" addresses — use Resend test sender unless overridden.
  if (resendApiKey()) return 'Nexora OS <onboarding@resend.dev>';
  const user = (process.env.EMAIL_USER ?? '').trim();
  if (user) return `Nexora OS <${user}>`;
  return 'Nexora OS <onboarding@resend.dev>';
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

export type EmailDeliveryResult = {
  delivered: boolean;
  mode: 'smtp' | 'resend' | 'resend_relay' | 'console_fallback' | 'failed';
  errorCode?: string;
  profile?: string;
  /** Resend message id when available (safe to log). */
  providerMessageId?: string;
  /** Safe, user-facing guidance (no secrets). */
  hint?: string;
};

const RESEND_DOMAIN_HINT =
  'Resend is in test mode (onboarding@resend.dev only reaches the Resend account owner). Verify a domain at resend.com/domains, then set EMAIL_FROM to an address on that domain on the API and Vercel.';

function resendFailureMeta(message: string | undefined, errorCode: string): {
  errorCode: string;
  hint?: string;
} {
  const m = (message || '').toLowerCase();
  if (
    m.includes('verify a domain') ||
    m.includes('only send testing emails') ||
    m.includes('domain is not verified') ||
    m.includes('from address is not verified')
  ) {
    return { errorCode: 'resend_domain_unverified', hint: RESEND_DOMAIN_HINT };
  }
  return { errorCode };
}

async function sendViaResend(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<EmailDeliveryResult> {
  const key = resendApiKey();
  if (!key) return { delivered: false, mode: 'failed', errorCode: 'resend_not_configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SMTP_TIMEOUT_MS + 2_000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: mailFromAddress(),
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    const bodyText = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      // ignore
    }
    if (!res.ok) {
      const rawCode = String(parsed?.name || parsed?.statusCode || `resend_http_${res.status}`);
      const message = String(parsed?.message || bodyText.slice(0, 200));
      const { errorCode, hint } = resendFailureMeta(message, rawCode);
      lastEmailDiag = {
        at: new Date().toISOString(),
        delivered: false,
        mode: 'failed',
        profile: 'resend',
        errorCode,
      };
      logger.error('email.failed', {
        to: opts.to,
        subject: opts.subject,
        profile: 'resend',
        code: errorCode,
        message,
      });
      return { delivered: false, mode: 'failed', errorCode, profile: 'resend', hint };
    }
    const providerMessageId =
      typeof parsed?.id === 'string' ? parsed.id : undefined;
    _activeProfile = 'resend';
    lastEmailDiag = {
      at: new Date().toISOString(),
      delivered: true,
      mode: 'resend',
      profile: 'resend',
      errorCode: null,
    };
    logger.info('email.sent', {
      to: opts.to,
      subject: opts.subject,
      profile: 'resend',
      providerMessageId,
    });
    return { delivered: true, mode: 'resend', profile: 'resend', providerMessageId };
  } catch (err) {
    const e = err as Error & { code?: string; name?: string };
    const errorCode = e.name === 'AbortError' ? 'ETIMEDOUT' : e.code || 'resend_error';
    lastEmailDiag = {
      at: new Date().toISOString(),
      delivered: false,
      mode: 'failed',
      profile: 'resend',
      errorCode,
    };
    logger.error('email.failed', {
      to: opts.to,
      subject: opts.subject,
      profile: 'resend',
      code: errorCode,
      message: e.message,
    });
    return { delivered: false, mode: 'failed', errorCode, profile: 'resend' };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe email delivery path from this runtime (used by /health?probeSmtp=1). */
export async function probeSmtpConnectivity(): Promise<{
  ok: boolean;
  profile?: string;
  errorCode?: string;
  missing?: string[];
}> {
  const selection = resolveEmailProvider();
  if (selection.explicit && selection.missing.length) {
    return { ok: false, errorCode: 'provider_misconfigured', missing: selection.missing };
  }
  if (selection.mode === 'none') {
    return { ok: false, errorCode: 'not_configured' };
  }
  if (selection.mode === 'resend') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      // Send-only Resend keys return 401 on /api-keys — that still means the key is present.
      // Prefer a cheap authenticated domains list; accept restricted_api_key as configured.
      const res = await fetch('https://api.resend.com/domains', {
        method: 'GET',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${resendApiKey()}` },
      });
      const bodyText = await res.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        // ignore
      }
      if (res.ok || parsed?.name === 'restricted_api_key' || res.status === 403) {
        _activeProfile = 'resend';
        lastEmailDiag = {
          at: new Date().toISOString(),
          delivered: true,
          mode: 'verify',
          profile: 'resend',
          errorCode: null,
        };
        return { ok: true, profile: 'resend' };
      }
      if (res.status === 401 && parsed?.name !== 'restricted_api_key') {
        lastEmailDiag = {
          at: new Date().toISOString(),
          delivered: false,
          mode: 'verify',
          profile: 'resend',
          errorCode: 'resend_unauthorized',
        };
        return { ok: false, profile: 'resend', errorCode: 'resend_unauthorized' };
      }
      // Any other response: key reached Resend over HTTPS
      _activeProfile = 'resend';
      lastEmailDiag = {
        at: new Date().toISOString(),
        delivered: true,
        mode: 'verify',
        profile: 'resend',
        errorCode: null,
      };
      return { ok: true, profile: 'resend' };
    } catch (err) {
      const e = err as Error & { name?: string };
      const errorCode = e.name === 'AbortError' ? 'ETIMEDOUT' : 'resend_unreachable';
      lastEmailDiag = {
        at: new Date().toISOString(),
        delivered: false,
        mode: 'verify',
        profile: 'resend',
        errorCode,
      };
      return { ok: false, profile: 'resend', errorCode };
    } finally {
      clearTimeout(timer);
    }
  }

  if (selection.mode !== 'smtp') {
    return { ok: false, errorCode: 'smtp_not_selected' };
  }

  const creds = emailCredentials();
  if (!creds) return { ok: false, errorCode: 'not_configured', missing: ['EMAIL_USER', 'EMAIL_PASS'] };

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
      logger.warn('email.smtp_probe_failed', {
        profile: profile.label,
        code: errorCode,
        message: e.message,
      });
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

async function deliverInviteViaWebRelay(rawToken: string): Promise<EmailDeliveryResult> {
  const relayBase = (process.env.EMAIL_RELAY_URL || webAppUrl()).replace(/\/$/, '');
  const url = `${relayBase}/api/internal/deliver-invite`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: rawToken }),
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // ignore
    }
    if (!res.ok || !parsed?.ok) {
      const rawCode = String(parsed?.errorCode || parsed?.error || `relay_http_${res.status}`);
      const detail = String(parsed?.detail || parsed?.hint || text.slice(0, 200));
      const { errorCode, hint } = resendFailureMeta(detail, rawCode);
      lastEmailDiag = {
        at: new Date().toISOString(),
        delivered: false,
        mode: 'failed',
        profile: 'resend_relay',
        errorCode,
      };
      logger.error('email.failed', { profile: 'resend_relay', code: errorCode, message: detail });
      return {
        delivered: false,
        mode: 'failed',
        errorCode,
        profile: 'resend_relay',
        hint: hint || (typeof parsed?.hint === 'string' ? parsed.hint : undefined),
      };
    }
    _activeProfile = 'resend_relay';
    lastEmailDiag = {
      at: new Date().toISOString(),
      delivered: true,
      mode: 'resend',
      profile: 'resend_relay',
      errorCode: null,
    };
    logger.info('email.sent', { profile: 'resend_relay' });
    return { delivered: true, mode: 'resend_relay', profile: 'resend_relay' };
  } catch (err) {
    const e = err as Error & { name?: string };
    const errorCode = e.name === 'AbortError' ? 'ETIMEDOUT' : 'relay_error';
    lastEmailDiag = {
      at: new Date().toISOString(),
      delivered: false,
      mode: 'failed',
      profile: 'resend_relay',
      errorCode,
    };
    return { delivered: false, mode: 'failed', errorCode, profile: 'resend_relay' };
  } finally {
    clearTimeout(timer);
  }
}

async function send(
  to: string,
  subject: string,
  html: string,
  debugLink?: string
): Promise<EmailDeliveryResult> {
  const selection = resolveEmailProvider();

  if (selection.explicit && selection.missing.length) {
    const errorCode = `provider_missing_${selection.missing.join('_').toLowerCase()}`;
    logger.error('email.provider_misconfigured', {
      provider: selection.mode,
      missing: selection.missing,
    });
    lastEmailDiag = {
      at: new Date().toISOString(),
      delivered: false,
      mode: 'failed',
      profile: selection.mode,
      errorCode,
    };
    return {
      delivered: false,
      mode: 'failed',
      errorCode,
      profile: selection.mode,
      hint: `Email provider "${selection.mode}" is selected but required configuration is missing: ${selection.missing.join(', ')}.`,
    };
  }

  if (selection.mode === 'resend') {
    const result = await sendViaResend({ to, subject, html });
    if (result.delivered) return result;
    // Never fall through to SMTP when Resend is the selected provider.
    if (debugLink) console.log(`[email:failed] ${subject} → ${to}\nLink: ${debugLink}`);
    return result;
  }

  if (selection.mode === 'smtp') {
    const creds = emailCredentials();
    if (!creds) {
      return {
        delivered: false,
        mode: 'failed',
        errorCode: 'smtp_not_configured',
        hint: 'SMTP provider selected but EMAIL_USER / EMAIL_PASS are not configured.',
      };
    }
    const result = await sendViaProfiles(creds, { from: mailFromAddress(), to, subject, html });
    if (result.delivered) {
      logger.info('email.sent', { to, subject, profile: result.profile });
      return result;
    }
    if (debugLink) console.log(`[email:failed] ${subject} → ${to}\nLink: ${debugLink}`);
    return result;
  }

  logger.info('email.console_fallback', { to, subject, debugLink: debugLink || null });
  if (debugLink) console.log(`[email:console] ${subject} → ${to}\nLink: ${debugLink}`);
  return {
    delivered: false,
    mode: 'console_fallback',
    errorCode: 'not_configured',
    hint: 'No email provider configured. Set EMAIL_PROVIDER=resend and RESEND_API_KEY.',
  };
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
      baseTemplate(
        'Account deleted',
        `<p>Your Nexora account and workspace data have been deleted as requested.</p>`
      )
    ),

  /** Notify platform admin of a new user signup (not login). */
  sendPlatformAdminSignupNotification: (opts: {
    name: string | null;
    email: string;
    timestamp: string;
  }) => {
    const admin = getPlatformAdminEmail();
    const name = escapeHtml(opts.name || 'Unknown');
    const email = escapeHtml(opts.email);
    const time = escapeHtml(opts.timestamp);
    return send(
      admin,
      'Nexora OS — New user successfully signed up',
      baseTemplate(
        'New user successfully signed up',
        `<p>A new user has registered on Nexora OS.</p>
         <table style="width:100%;font-size:14px;color:#cbd5e1;margin:16px 0;border-collapse:collapse;">
           <tr><td style="padding:8px 0;color:#94a3b8;width:110px;">Name</td><td style="padding:8px 0;">${name}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Email</td><td style="padding:8px 0;">${email}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Time</td><td style="padding:8px 0;">${time}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Status</td><td style="padding:8px 0;"><strong>Successfully registered</strong></td></tr>
         </table>`
      )
    );
  },

  /** Notify platform admin when a user joins a team workspace via invitation. */
  sendPlatformAdminMemberJoinedNotification: (opts: {
    workspaceName: string;
    userName: string | null;
    email: string;
    role: string;
    inviterName: string | null;
    timestamp: string;
  }) => {
    const admin = getPlatformAdminEmail();
    const workspace = escapeHtml(opts.workspaceName);
    const userName = escapeHtml(opts.userName || opts.email);
    const email = escapeHtml(opts.email);
    const role = escapeHtml(opts.role);
    const inviter = escapeHtml(opts.inviterName || 'Unknown');
    const time = escapeHtml(opts.timestamp);
    return send(
      admin,
      `Nexora OS — ${opts.userName || opts.email} joined ${opts.workspaceName}`,
      baseTemplate(
        'A new member has successfully joined a workspace',
        `<p>A new member has successfully joined a team workspace.</p>
         <table style="width:100%;font-size:14px;color:#cbd5e1;margin:16px 0;border-collapse:collapse;">
           <tr><td style="padding:8px 0;color:#94a3b8;width:120px;">Workspace</td><td style="padding:8px 0;"><strong>${workspace}</strong></td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Member</td><td style="padding:8px 0;">${userName}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Email</td><td style="padding:8px 0;">${email}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Role</td><td style="padding:8px 0;">${role}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Invited by</td><td style="padding:8px 0;">${inviter}</td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Status</td><td style="padding:8px 0;"><strong>Successfully joined</strong></td></tr>
           <tr><td style="padding:8px 0;color:#94a3b8;">Time</td><td style="padding:8px 0;">${time}</td></tr>
         </table>`
      )
    );
  },

  sendWorkspaceInvitation: async (opts: {
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
    const invitedEmail = escapeHtml(opts.to);
    const expires = escapeHtml(opts.expiresAt.toUTCString());
    const subject = `Nexora OS — You've been invited to join ${opts.workspaceName}`;
    const first = await send(
      opts.to,
      subject,
      baseTemplate(
        `You've been invited to join ${workspace}`,
        `<p style="font-size:16px;color:#e2e8f0;margin:0 0 8px;">You've been invited to join:</p>
         <p style="font-size:20px;font-weight:650;color:#ffffff;margin:0 0 20px;">${workspace}</p>
         <table style="width:100%;font-size:14px;color:#cbd5e1;margin:0 0 20px;border-collapse:collapse;">
           <tr><td style="padding:6px 0;color:#94a3b8;width:110px;">Invited by</td><td style="padding:6px 0;"><strong>${inviter}</strong></td></tr>
           <tr><td style="padding:6px 0;color:#94a3b8;">Role</td><td style="padding:6px 0;"><strong>${role}</strong></td></tr>
         </table>
         <p>You've been invited to collaborate with your team in Nexora OS.</p>
         ${ctaButton(acceptUrl, 'ACCESS WORKSPACE')}
         <p style="font-size:13px;color:#94a3b8;margin-top:20px;">Access Workspace:<br/><span style="word-break:break-all;">${escapeHtml(acceptUrl)}</span></p>
         <p style="font-size:13px;color:#94a3b8;margin-top:16px;">This invitation is intended for:<br/><strong style="color:#e2e8f0;">${invitedEmail}</strong></p>
         <p style="font-size:12px;color:#64748b;margin-top:16px;">This invitation expires on ${expires}.</p>
         <p style="font-size:12px;color:#64748b;margin-top:12px;">If you did not expect this invitation, you can ignore this email.</p>`
      ),
      acceptUrl
    );
    if (first.delivered) return first;
    // Domain restriction cannot be fixed by the Vercel relay (same Resend account / from).
    if (first.errorCode === 'resend_domain_unverified') return first;
    // Railway often cannot reach Gmail SMTP / may miss RESEND_API_KEY on the running service.
    // Fall back to Vercel HTTPS relay (Resend) using the invite token.
    const relay = await deliverInviteViaWebRelay(opts.rawToken);
    if (relay.delivered) return relay;
    return {
      ...relay,
      hint: relay.hint || first.hint,
      errorCode: relay.errorCode || first.errorCode,
    };
  },
};
