import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { storeConnection, revokeConnection, query } from '@enterprise-ai-os/stores';
import { mailer } from '../lib/mailer';
import { webAppUrl } from '../lib/authTokens';
import { getJwtSecret } from '../middleware/auth';

// ============================================================
// Gmail OAuth 2.0 (per-user connector) — stored in oauth_connections.
// SEPARATE from the invitation mailer which uses GMAIL_REFRESH_TOKEN.
// This flow grants per-user Gmail read/send access for the Nexora
// chat integration. Tokens are AES-256-GCM encrypted at rest.
// ============================================================

export const oauthGmailRouter = Router();

// Minimum scopes: read messages + send on behalf of the user.
// We do NOT request full account access.
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function signState(userId: string, organizationId: string): string {
  return jwt.sign(
    { sub: userId, org: organizationId, typ: 'gmail_connector_oauth' },
    getJwtSecret(),
    { expiresIn: '30m' }
  );
}

function verifyState(state: string): { sub: string; org: string } {
  const payload = jwt.verify(state, getJwtSecret()) as {
    sub: string;
    org: string;
    typ?: string;
  };
  if (payload.typ !== 'gmail_connector_oauth' || !payload.sub || !payload.org) {
    throw new Error('Invalid OAuth state');
  }
  return { sub: payload.sub, org: payload.org };
}

function getClientId(): string | undefined {
  return process.env.GOOGLE_CLIENT_ID?.trim();
}

function getClientSecret(): string | undefined {
  return process.env.GOOGLE_CLIENT_SECRET?.trim();
}

function getRedirectUri(): string | undefined {
  // Prefer explicit override; fall back to convention from Railway domain.
  const explicit = process.env.GOOGLE_GMAIL_REDIRECT_URI?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const host =
    process.env.RAILWAY_PUBLIC_DOMAIN?.trim() || process.env.API_PUBLIC_URL?.trim();
  if (!host) return undefined;
  const base = host.startsWith('http') ? host.replace(/\/$/, '') : `https://${host}`;
  return `${base}/oauth/gmail/callback`;
}

// ─── Start ────────────────────────────────────────────────────────────────────

oauthGmailRouter.get('/start', (req, res) => {
  const header = req.header('authorization');
  const token =
    header?.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined);

  if (!token) {
    res.status(401).json({ error: 'Missing token — pass ?token=<jwt>' });
    return;
  }

  let payload: { sub: string; org: string };
  try {
    payload = jwt.verify(token, getJwtSecret()) as { sub: string; org: string };
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  const clientId = getClientId();
  const redirectUri = getRedirectUri();
  if (!clientId || !redirectUri) {
    res.status(500).json({
      error:
        'Gmail connector OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_GMAIL_REDIRECT_URI to environment variables.',
    });
    return;
  }

  const state = signState(payload.sub, payload.org);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GMAIL_SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'offline');   // needed for refresh token
  url.searchParams.set('prompt', 'consent');         // force refresh token on every connect

  console.log('[oauth/gmail] start_redirect', {
    redirectUri,
    userId: payload.sub,
    orgId: payload.org,
  });
  res.redirect(url.toString());
});

// ─── Callback ─────────────────────────────────────────────────────────────────

oauthGmailRouter.get('/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;

  console.log('[oauth/gmail] callback_hit', {
    hasCode: Boolean(code),
    hasState: Boolean(state),
    error: error || null,
  });

  if (error) {
    const friendly =
      error === 'access_denied'
        ? 'You denied Gmail access. To connect Gmail, click Connect Gmail and allow the requested permissions.'
        : `Gmail authorization failed: ${error}`;
    res.redirect(
      `${webAppUrl()}/app/integrations?error=${encodeURIComponent(friendly)}`
    );
    return;
  }

  if (!code || !state) {
    res.status(400).send('Missing code or state from Gmail OAuth callback');
    return;
  }

  let payload: { sub: string; org: string };
  try {
    payload = verifyState(state);
  } catch {
    res
      .status(401)
      .send('Invalid or expired authorization session — try Connect Gmail again.');
    return;
  }

  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const redirectUri = getRedirectUri();
  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).send('Gmail connector OAuth is not configured on the server');
    return;
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('[oauth/gmail] token_exchange_fail', {
        status: tokenRes.status,
        error: tokenData.error,
        // never log error_description — may embed secrets in some providers
      });
      res.status(502).send(
        `Failed to exchange Gmail authorization code (${tokenRes.status}). ${tokenData.error || 'Unknown error'}`
      );
      return;
    }

    // Fetch the user's Gmail address so we can display it in the UI.
    const userInfoRes = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    const userInfo = (await userInfoRes.json()) as {
      id?: string;
      email?: string;
      name?: string;
      picture?: string;
    };

    const googleEmail = userInfo.email ?? null;
    const googleName = userInfo.name ?? null;
    const googleAccountId = userInfo.id ?? null;

    const expiresAt =
      typeof tokenData.expires_in === 'number'
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : undefined;

    // Store encrypted — refresh token mandatory for long-lived access.
    // If Google didn't return a refresh_token it means the app was already
    // authorized without 'prompt=consent'. The UI should show "Reconnect Gmail".
    if (!tokenData.refresh_token) {
      console.warn('[oauth/gmail] no_refresh_token', {
        userId: payload.sub,
        hint: 'prompt=consent was set but no refresh_token returned — user may have previously authorized',
      });
    }

    await storeConnection(payload.org, 'gmail', tokenData.access_token, {
      userId: payload.sub,
      refreshToken: tokenData.refresh_token,
      expiresAt,
      scope: tokenData.scope || GMAIL_SCOPES,
      metadata: {
        googleEmail,
        googleName,
        googleAccountId,
        connectedAt: new Date().toISOString(),
        method: 'oauth',
      },
    });

    // Notify the Nexora account owner's email (not the Google email)
    const nexoraEmail = await query<{ email: string }>(
      `select email from users where id = $1`,
      [payload.sub]
    );
    if (nexoraEmail.rows[0]) {
      await mailer.sendIntegrationConnected(nexoraEmail.rows[0].email, 'Gmail');
    }

    console.log('[oauth/gmail] success', {
      userId: payload.sub,
      orgId: payload.org,
      googleEmail,
      hasRefreshToken: Boolean(tokenData.refresh_token),
    });

    res.redirect(`${webAppUrl()}/app/integrations?connected=gmail`);
  } catch (err) {
    console.error('[oauth/gmail] callback_exception', err);
    res.status(500).send('Something went wrong connecting Gmail. Try again from Integrations.');
  }
});

// ─── Disconnect ───────────────────────────────────────────────────────────────

oauthGmailRouter.post('/disconnect', async (req, res) => {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { sub: string; org: string };
    await revokeConnection(payload.org, 'gmail', payload.sub);
    // Note: we do NOT revoke the Google OAuth token via accounts.google.com/o/oauth2/revoke
    // because the user should be able to reconnect without re-authorizing in Google.
    // The stored tokens are simply deleted from Nexora's DB.
    res.json({ success: true, message: 'Gmail disconnected from Nexora' });
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
});
