import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '@enterprise-ai-os/stores';
import { authenticate, getJwtSecret, requireRole, verifyToken } from '../middleware/auth';
import { mailer } from '../lib/mailer';
import { logger } from '../lib/logger';
import { AppError, ok, asyncHandler } from '../lib/errors';
import {
  clearRefreshCookie,
  webAppUrl,
  parseUserAgent,
  hashToken,
  issueSession,
  randomToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  slugify,
} from '../lib/authTokens';
import { isPlatformAdminEmail } from '../lib/platformAdmin';

export const authRouter = Router();

async function ensurePlatformAdminRole(user: { id: string; email: string; role: string }) {
  if (!isPlatformAdminEmail(user.email) || user.role === 'super_admin') return user;
  await query(`update users set role = 'super_admin' where id = $1`, [user.id]);
  return { ...user, role: 'super_admin' };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

interface UserProfileRow {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  organization_id: string;
  created_at: string;
  last_login: string | null;
  is_verified: boolean;
  is_suspended: boolean;
}

function serializeUserProfile(row: UserProfileRow) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    organizationId: row.organization_id,
    createdAt: row.created_at,
    lastLogin: row.last_login,
    isVerified: row.is_verified,
    isSuspended: row.is_suspended,
  };
}

async function logAuthEvent(organizationId: string, userId: string, eventType: string, detail: Record<string, unknown>) {
  await query(
    `insert into audit_logs (organization_id, user_id, event_type, detail) values ($1::uuid, $2::uuid, $3, $4)`,
    [organizationId, userId, 'auth', { subEvent: eventType, ...detail }]
  ).catch((err) => logger.error('audit_log.write_failed', { message: err.message }));
}

async function ensureProfile(userId: string) {
  await query(
    `insert into user_profiles (user_id) values ($1) on conflict (user_id) do nothing`,
    [userId]
  ).catch(() => undefined);
}

async function createVerificationToken(userId: string): Promise<string> {
  const raw = randomToken();
  await query(
    `insert into email_verification_tokens (user_id, token_hash, expires_at)
     values ($1, $2, now() + interval '48 hours')`,
    [userId, hashToken(raw)]
  );
  return raw;
}

authRouter.post(
  '/signup',
  asyncHandler(async (req, res) => {
    const { email, password, confirmPassword, displayName, workspaceName } = req.body ?? {};

    if (!email || !isValidEmail(email)) throw new AppError('Please enter a valid email address', 422);
    if (!password || String(password).length < 8) throw new AppError('Password must be at least 8 characters', 422);
    if (confirmPassword !== undefined && password !== confirmPassword) {
      throw new AppError('Passwords do not match', 422);
    }

    const existing = await query('select id from users where email = $1', [String(email).toLowerCase()]);
    if (existing.rows.length > 0) throw new AppError('An account with this email already exists', 409);

    const name = (workspaceName && String(workspaceName).trim()) || `${displayName || email.split('@')[0]}'s Workspace`;
    const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 8)}`;

    const orgCreated = await query<{ id: string }>(
      'insert into organizations (name, slug) values ($1, $2) returning id',
      [name, slug]
    );
    const organizationId = orgCreated.rows[0].id;
    const passwordHash = await bcrypt.hash(password, 12);

    const created = await query<UserProfileRow>(
      `insert into users (organization_id, email, display_name, role, password_hash, is_verified, auth_provider)
       values ($1, $2, $3, 'owner', $4, false, 'email')
       returning id, email, display_name, role, organization_id, created_at, last_login, is_verified, is_suspended`,
      [organizationId, String(email).toLowerCase(), displayName ?? null, passwordHash]
    );
    const user = created.rows[0];
    await ensureProfile(user.id);
    Object.assign(user, await ensurePlatformAdminRole(user));

    // Local/dev: auto-verify so customers can Connect Slack/Notion immediately.
    // - No SMTP configured (EMAIL_USER empty), OR
    // - Explicit AUTO_VERIFY_SIGNUP=true (local SaaS testing with SMTP still set)
    // Production: leave unset / false so email verification is required.
    const autoVerifyLocal =
      !process.env.EMAIL_USER?.trim() ||
      process.env.AUTO_VERIFY_SIGNUP === 'true' ||
      process.env.AUTO_VERIFY_SIGNUP === '1';
    if (autoVerifyLocal) {
      await query(`update users set is_verified = true where id = $1`, [user.id]);
      user.is_verified = true;
    }

    const verifyRaw = await createVerificationToken(user.id);
    await logAuthEvent(organizationId, user.id, 'signup', { email: user.email });
    await mailer.sendWelcome(user.email, user.display_name);
    if (!autoVerifyLocal) {
      await mailer.sendVerification(user.email, verifyRaw);
    } else {
      // Still log the link in console for debugging, but account is already usable
      await mailer.sendVerification(user.email, verifyRaw);
    }

    const { device, browser } = parseUserAgent(req.header('user-agent'));
    const ip = (req.header('x-forwarded-for') ?? req.socket.remoteAddress ?? 'unknown').toString();
    const session = await issueSession(res, user.id, organizationId, {
      rememberMe: false,
      userAgent: req.header('user-agent'),
      ip,
    });

    ok(
      res,
      {
        token: session.accessToken,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        user: serializeUserProfile(user),
        requiresVerification: !autoVerifyLocal,
      },
      autoVerifyLocal
        ? 'Account created — you can connect Slack/Notion now'
        : 'Account created — check your email to verify',
      201
    );
    logger.info('user.registered', { userId: user.id, email: user.email, device, browser });
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password, rememberMe } = req.body ?? {};
    if (!email || !password) throw new AppError('Email and password are required', 422);

    const result = await query<UserProfileRow & { password_hash: string | null }>(
      `select id, email, display_name, role, password_hash, organization_id, created_at, last_login, is_verified, is_suspended
       from users where email = $1`,
      [String(email).toLowerCase()]
    );
    const user = result.rows[0];
    const { device, browser, os } = parseUserAgent(req.header('user-agent'));
    const ip = (req.header('x-forwarded-for') ?? req.socket.remoteAddress ?? 'unknown').toString();

    if (!user || !user.password_hash) {
      throw new AppError('Invalid email or password', 401);
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await query(
        `insert into login_history (user_id, organization_id, ip, user_agent, device, browser, success)
         values ($1, $2, $3, $4, $5, $6, false)`,
        [user.id, user.organization_id, ip, req.header('user-agent'), device, browser]
      ).catch(() => undefined);
      throw new AppError('Invalid email or password', 401);
    }
    if (user.is_suspended) throw new AppError('This account has been suspended', 403);

    await query('update users set last_login = now() where id = $1', [user.id]);
    await query(
      `insert into login_history (user_id, organization_id, ip, user_agent, device, browser, success)
       values ($1, $2, $3, $4, $5, $6, true)`,
      [user.id, user.organization_id, ip, req.header('user-agent'), device, browser]
    ).catch(() => undefined);

    const time = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    await mailer.sendLoginNotification(user.email, {
      name: user.display_name || user.email,
      time,
      device,
      browser,
      os,
      ip,
    });
    await logAuthEvent(user.organization_id, user.id, 'login_success', { device, browser, os, ip });

    const session = await issueSession(res, user.id, user.organization_id, {
      rememberMe: Boolean(rememberMe),
      userAgent: req.header('user-agent'),
      ip,
    });

    ok(res, {
      token: session.accessToken,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: serializeUserProfile(user),
    });
  })
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const raw = req.cookies?.nexora_refresh || req.body?.refreshToken;
    if (!raw) throw new AppError('Refresh token required', 401);
    const rotated = await rotateRefreshToken(res, raw, {
      userAgent: req.header('user-agent'),
      ip: (req.header('x-forwarded-for') ?? req.socket.remoteAddress ?? '').toString(),
    });
    if (!rotated) throw new AppError('Invalid or expired refresh token', 401);
    ok(res, {
      token: rotated.accessToken,
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
    });
  })
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const raw = req.cookies?.nexora_refresh || req.body?.refreshToken;
    if (raw) await revokeRefreshToken(raw);
    clearRefreshCookie(res);
    logger.info('user.logout', { userId: req.user?.id });
    ok(res, null, 'Logged out');
  })
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await query<UserProfileRow>(
      `select id, email, display_name, role, organization_id, created_at, last_login, is_verified, is_suspended
       from users where id = $1`,
      [req.user!.id]
    );
    const row = result.rows[0];
    if (!row) throw new AppError('User not found', 404);

    const profile = await query(
      `select avatar_url, timezone, language, preferences from user_profiles where user_id = $1`,
      [row.id]
    );
    const org = await query(`select name, slug from organizations where id = $1`, [row.organization_id]);

    ok(res, {
      user: serializeUserProfile(row),
      profile: profile.rows[0] ?? null,
      workspace: org.rows[0] ?? null,
    });
  })
);

authRouter.patch(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const { displayName, timezone, language, preferences, avatarUrl } = req.body ?? {};
    if (displayName !== undefined) {
      await query(`update users set display_name = $1 where id = $2`, [displayName, req.user!.id]);
    }
    await ensureProfile(req.user!.id);
    await query(
      `update user_profiles set
         avatar_url = coalesce($1, avatar_url),
         timezone = coalesce($2, timezone),
         language = coalesce($3, language),
         preferences = case when $4::jsonb is null then preferences else preferences || $4::jsonb end,
         updated_at = now()
       where user_id = $5`,
      [
        avatarUrl ?? null,
        timezone ?? null,
        language ?? null,
        preferences ? JSON.stringify(preferences) : null,
        req.user!.id,
      ]
    );
    ok(res, null, 'Profile updated');
  })
);

authRouter.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword || String(newPassword).length < 8) {
      throw new AppError('Current password and a new password (8+ chars) are required', 422);
    }
    const result = await query<{ password_hash: string | null; email: string }>(
      `select password_hash, email from users where id = $1`,
      [req.user!.id]
    );
    const row = result.rows[0];
    if (!row?.password_hash) throw new AppError('Password login is not available for this account', 400);
    const okPw = await bcrypt.compare(currentPassword, row.password_hash);
    if (!okPw) throw new AppError('Current password is incorrect', 401);
    const hash = await bcrypt.hash(newPassword, 12);
    await query(`update users set password_hash = $1 where id = $2`, [hash, req.user!.id]);
    await revokeAllRefreshTokens(req.user!.id);
    await mailer.sendPasswordChanged(row.email);
    ok(res, null, 'Password updated — please sign in again on other devices');
  })
);

authRouter.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email ?? '').toLowerCase();
    if (!isValidEmail(email)) throw new AppError('Valid email required', 422);
    const result = await query<{ id: string }>(`select id from users where email = $1`, [email]);
    // Always succeed to avoid account enumeration
    if (result.rows[0]) {
      await query(`update password_reset_tokens set used_at = now() where user_id = $1 and used_at is null`, [
        result.rows[0].id,
      ]);
      const raw = randomToken();
      await query(
        `insert into password_reset_tokens (user_id, token_hash, expires_at)
         values ($1, $2, now() + interval '1 hour')`,
        [result.rows[0].id, hashToken(raw)]
      );
      await mailer.sendPasswordReset(email, raw);
    }
    ok(res, null, 'If that email exists, a reset link was sent');
  })
);

authRouter.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body ?? {};
    if (!token || !newPassword || String(newPassword).length < 8) {
      throw new AppError('Token and new password (8+ chars) required', 422);
    }
    const result = await query<{ id: string; user_id: string }>(
      `select id, user_id from password_reset_tokens
       where token_hash = $1 and used_at is null and expires_at > now()`,
      [hashToken(String(token))]
    );
    const row = result.rows[0];
    if (!row) throw new AppError('Invalid or expired reset token', 400);
    const hash = await bcrypt.hash(String(newPassword), 12);
    await query(`update users set password_hash = $1 where id = $2`, [hash, row.user_id]);
    await query(`update password_reset_tokens set used_at = now() where user_id = $1 and used_at is null`, [
      row.user_id,
    ]);
    await revokeAllRefreshTokens(row.user_id);
    res.clearCookie('nexora_refresh', { path: '/' });
    const userRow = await query<{ email: string; organization_id: string }>(
      `select email, organization_id from users where id = $1`,
      [row.user_id]
    );
    if (userRow.rows[0]) {
      await mailer.sendPasswordChanged(userRow.rows[0].email);
      await logAuthEvent(userRow.rows[0].organization_id, row.user_id, 'password_reset', {});
    }
    ok(res, null, 'Password reset successful');
  })
);

authRouter.post(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const token = String(req.body?.token ?? req.query.token ?? '');
    if (!token) throw new AppError('Verification token required', 422);
    const result = await query<{ id: string; user_id: string }>(
      `select id, user_id from email_verification_tokens
       where token_hash = $1 and used_at is null and expires_at > now()`,
      [hashToken(token)]
    );
    const row = result.rows[0];
    if (!row) throw new AppError('Invalid or expired verification token', 400);
    await query(`update users set is_verified = true where id = $1`, [row.user_id]);
    await query(`update email_verification_tokens set used_at = now() where id = $1`, [row.id]);
    const email = await query<{ email: string }>(`select email from users where id = $1`, [row.user_id]);
    if (email.rows[0]) await mailer.sendVerified(email.rows[0].email);
    ok(res, null, 'Email verified');
  })
);

authRouter.post(
  '/resend-verification',
  authenticate,
  asyncHandler(async (req, res) => {
    if (req.user!.isVerified) {
      ok(res, null, 'Already verified');
      return;
    }
    const raw = await createVerificationToken(req.user!.id);
    await mailer.sendVerification(req.user!.email, raw);
    ok(res, null, 'Verification email sent');
  })
);

function googleRedirectUri(): string {
  return (
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ||
    `${(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '')}/auth/google/callback`
  );
}

function googleLoginFailRedirect(message: string): string {
  const base = webAppUrl();
  return `${base}/login?error=${encodeURIComponent(message)}`;
}

authRouter.get('/google/start', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirect = googleRedirectUri();
  if (!clientId || !clientSecret) {
    res.redirect(googleLoginFailRedirect('Google login is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'));
    return;
  }

  const state = jwt.sign({ typ: 'google_oauth', nonce: randomToken(8) }, getJwtSecret(), { expiresIn: '10m' });

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  logger.info('auth.google.start', { redirect });
  res.redirect(url.toString());
});

function errMessage(err: unknown): string {
  if (!err) return 'unknown_error';
  if (err instanceof Error) {
    const anyErr = err as Error & { code?: string; errors?: Error[] };
    if (anyErr.code === 'ECONNREFUSED' || /ECONNREFUSED/i.test(anyErr.message)) {
      return 'Database is offline (Postgres not reachable on :5432). Start it with: docker compose up -d';
    }
    if (anyErr.message?.trim()) return anyErr.message;
    if (Array.isArray(anyErr.errors) && anyErr.errors[0]?.message) return anyErr.errors[0].message;
    if (anyErr.code) return String(anyErr.code);
  }
  const s = String(err);
  return s.trim() || 'unknown_error';
}

authRouter.get('/google/callback', async (req, res) => {
  const fail = (message: string) => {
    logger.warn('auth.google.callback_failed', { message, queryError: req.query.error });
    res.redirect(googleLoginFailRedirect(message));
  };

  try {
    const oauthError = String(req.query.error ?? '');
    if (oauthError) {
      fail(`Google denied access (${oauthError}). Try again.`);
      return;
    }

    const code = String(req.query.code ?? '');
    const state = String(req.query.state ?? '');
    if (!code) {
      fail('Missing Google authorization code. Start again from Sign in → Continue with Google.');
      return;
    }

    if (state) {
      try {
        const payload = jwt.verify(state, getJwtSecret()) as { typ?: string };
        if (payload.typ && payload.typ !== 'google_oauth') {
          fail('Invalid Google login state. Please try again.');
          return;
        }
      } catch {
        // Older in-flight logins used random state — allow through but log.
        logger.warn('auth.google.state_unverified', { reason: 'expired_or_legacy' });
      }
    }

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    const redirect = googleRedirectUri();
    if (!clientId || !clientSecret) {
      fail('Google login is not configured on the server.');
      return;
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirect,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      id_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenData.access_token) {
      const detail = tokenData.error_description || tokenData.error || 'token_exchange_failed';
      logger.error('auth.google.token_exchange_failed', {
        error: tokenData.error,
        description: tokenData.error_description,
        redirect,
        status: tokenRes.status,
      });
      if (tokenData.error === 'invalid_grant') {
        fail('Google code expired or already used. Click Continue with Google again (do not refresh the callback URL).');
        return;
      }
      if (tokenData.error === 'redirect_uri_mismatch') {
        fail(`Google redirect URI mismatch. Expected exactly: ${redirect}`);
        return;
      }
      fail(`Google sign-in failed: ${detail}`);
      return;
    }

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = (await profileRes.json()) as { sub?: string; email?: string; name?: string; picture?: string };
    if (!profile.email || !profile.sub) {
      fail('Google profile missing email. Enable email scope in Google Cloud Console.');
      return;
    }

    let userResult = await query<UserProfileRow>(
      `select id, email, display_name, role, organization_id, created_at, last_login, is_verified, is_suspended
       from users where google_sub = $1 or lower(email) = lower($2)
       order by case when google_sub = $1 then 0 else 1 end
       limit 1`,
      [profile.sub, profile.email]
    );

    let user = userResult.rows[0];
    if (!user) {
      const name = `${profile.name || profile.email.split('@')[0]}'s Workspace`;
      const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 8)}`;
      const org = await query<{ id: string }>(`insert into organizations (name, slug) values ($1, $2) returning id`, [
        name,
        slug,
      ]);
      userResult = await query<UserProfileRow>(
        `insert into users (organization_id, email, display_name, role, is_verified, auth_provider, google_sub, last_login)
         values ($1, $2, $3, 'owner', true, 'google', $4, now())
         returning id, email, display_name, role, organization_id, created_at, last_login, is_verified, is_suspended`,
        [org.rows[0].id, profile.email.toLowerCase(), profile.name ?? null, profile.sub]
      );
      user = userResult.rows[0];
      await ensureProfile(user.id);
      Object.assign(user, await ensurePlatformAdminRole(user));
      if (profile.picture) {
        await query(`update user_profiles set avatar_url = $1 where user_id = $2`, [profile.picture, user.id]).catch(
          () => undefined
        );
      }
      void mailer.sendWelcome(user.email, user.display_name).catch((err) =>
        logger.warn('auth.google.welcome_email_failed', { message: (err as Error).message })
      );
    } else {
      await query(
        `update users set
           google_sub = coalesce(google_sub, $1),
           auth_provider = case when auth_provider = 'email' and password_hash is null then 'google' else auth_provider end,
           is_verified = true,
           last_login = now()
         where id = $2`,
        [profile.sub, user.id]
      );
      await ensureProfile(user.id);
      Object.assign(user, await ensurePlatformAdminRole(user));
    }

    const { device, browser } = parseUserAgent(req.header('user-agent'));
    const ip = (req.header('x-forwarded-for') ?? req.socket.remoteAddress ?? 'unknown').toString();
    await query(
      `insert into login_history (user_id, organization_id, ip, user_agent, device, browser, success)
       values ($1, $2, $3, $4, $5, $6, true)`,
      [user.id, user.organization_id, ip, req.header('user-agent'), device, browser]
    ).catch(() => undefined);
    await logAuthEvent(user.organization_id, user.id, 'google_login', { email: user.email, device, browser, ip });

    const session = await issueSession(res, user.id, user.organization_id, {
      rememberMe: true,
      userAgent: req.header('user-agent'),
      ip: (req.header('x-forwarded-for') ?? req.socket.remoteAddress ?? '').toString(),
    });

    const dest = `${webAppUrl()}/app/dashboard?token=${encodeURIComponent(session.accessToken)}&refresh=${encodeURIComponent(session.refreshToken)}`;
    logger.info('auth.google.success', { userId: user.id, email: user.email });
    res.redirect(dest);
  } catch (err) {
    const message = errMessage(err);
    logger.error('auth.google.unhandled', { message, stack: err instanceof Error ? err.stack : undefined });
    if (/Database is offline|ECONNREFUSED/i.test(message)) {
      fail(message);
      return;
    }
    fail(
      message.includes('column')
        ? 'Database not migrated for Google login. Run npm run db:migrate.'
        : `Google sign-in failed: ${message}`
    );
  }
});

authRouter.get(
  '/sessions',
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await query(
      `select id, created_at, expires_at, revoked_at, user_agent, ip
       from refresh_tokens where user_id = $1 order by created_at desc limit 20`,
      [req.user!.id]
    );
    ok(res, { sessions: result.rows });
  })
);

authRouter.get(
  '/login-history',
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await query(
      `select id, ip, device, browser, location, success, created_at
       from login_history where user_id = $1 order by created_at desc limit 50`,
      [req.user!.id]
    );
    ok(res, { history: result.rows });
  })
);

authRouter.post(
  '/onboarding/complete',
  authenticate,
  asyncHandler(async (req, res) => {
    const { workspaceName, avatarUrl, displayName } = req.body ?? {};
    if (displayName) {
      await query(`update users set display_name = $1 where id = $2`, [displayName, req.user!.id]);
    }
    if (workspaceName && String(workspaceName).trim()) {
      await query(`update organizations set name = $1 where id = $2`, [
        String(workspaceName).trim(),
        req.user!.organizationId,
      ]);
    }
    await ensureProfile(req.user!.id);
    await query(
      `update user_profiles set
         avatar_url = coalesce($1, avatar_url),
         preferences = preferences || $2::jsonb,
         updated_at = now()
       where user_id = $3`,
      [
        avatarUrl ?? null,
        JSON.stringify({ onboardingCompleted: true, onboardingCompletedAt: new Date().toISOString() }),
        req.user!.id,
      ]
    );
    ok(res, null, 'Onboarding complete');
  })
);

authRouter.post(
  '/change-email',
  authenticate,
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email ?? '').toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!isValidEmail(email)) throw new AppError('Valid email required', 422);
    if (!password) throw new AppError('Current password required', 422);
    const row = await query<{ password_hash: string | null }>(`select password_hash from users where id = $1`, [
      req.user!.id,
    ]);
    if (!row.rows[0]?.password_hash) throw new AppError('Password login required to change email', 400);
    const okPw = await bcrypt.compare(password, row.rows[0].password_hash);
    if (!okPw) throw new AppError('Current password is incorrect', 401);
    const taken = await query(`select id from users where email = $1 and id <> $2`, [email, req.user!.id]);
    if (taken.rows[0]) throw new AppError('Email already in use', 409);
    await query(`update users set email = $1, is_verified = false where id = $2`, [email, req.user!.id]);
    const verifyRaw = await createVerificationToken(req.user!.id);
    await mailer.sendVerification(email, verifyRaw);
    ok(res, null, 'Email updated — please verify the new address');
  })
);

authRouter.delete(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const password = String(req.body?.password ?? '');
    const row = await query<{ password_hash: string | null; email: string; organization_id: string; role: string }>(
      `select password_hash, email, organization_id, role from users where id = $1`,
      [req.user!.id]
    );
    if (!row.rows[0]) throw new AppError('User not found', 404);
    if (row.rows[0].password_hash) {
      if (!password) throw new AppError('Password required to delete account', 422);
      const okPw = await bcrypt.compare(password, row.rows[0].password_hash);
      if (!okPw) throw new AppError('Current password is incorrect', 401);
    }
    const orgId = row.rows[0].organization_id;
    const email = row.rows[0].email;
    await revokeAllRefreshTokens(req.user!.id);
    await query(`delete from users where id = $1`, [req.user!.id]);
    // Remove empty personal workspace
    const remaining = await query(`select count(*)::int as c from users where organization_id = $1`, [orgId]);
    if ((remaining.rows[0]?.c ?? 0) === 0) {
      await query(`delete from organizations where id = $1`, [orgId]).catch(() => undefined);
    }
    res.clearCookie('nexora_refresh', { path: '/' });
    await mailer.sendAccountDeleted(email);
    ok(res, null, 'Account deleted');
  })
);

// Keep lightweight admin user list on auth for backward compatibility
authRouter.get(
  '/admin/users',
  authenticate,
  requireRole('admin', 'owner', 'super_admin'),
  asyncHandler(async (req, res) => {
    const search = String(req.query.search ?? '').trim();
    const searchClause = search
      ? `where lower(email) like $1 or lower(coalesce(display_name, '')) like $1`
      : '';
    const params = search ? [`%${search.toLowerCase()}%`] : [];
    const result = await query<UserProfileRow>(
      `select id, email, display_name, role, organization_id, created_at, last_login, is_verified, is_suspended
       from users ${searchClause} order by created_at desc`,
      params
    );
    ok(res, { users: result.rows.map(serializeUserProfile) });
  })
);

export { verifyToken };
