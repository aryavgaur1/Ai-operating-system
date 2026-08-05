import crypto from 'crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { storeConnection } from '@enterprise-ai-os/stores';
import { webAppUrl } from '../lib/authTokens';
import { getJwtSecret } from '../middleware/auth';

// ============================================================
// Notion OAuth (Public connection) — per-user tokens in Postgres.
// See OAUTH_ROOT_CAUSE_ANALYSIS.md: Allow→redirect failures are usually
// redirect URI / DNS / tunnel / API reachability — not this handler.
// ============================================================

export const oauthNotionRouter = Router();

function oauthDebugEnabled(): boolean {
  return (process.env.OAUTH_DEBUG ?? '').toLowerCase() === 'true';
}

function oauthLog(event: string, data: Record<string, unknown> = {}) {
  const payload = { ts: new Date().toISOString(), event, ...data };
  if (oauthDebugEnabled() || event.includes('error') || event.includes('fail') || event.includes('success')) {
    console.log('[oauth/notion]', JSON.stringify(payload));
  } else {
    console.log('[oauth/notion]', event, data);
  }
}

function isDemoMode(): boolean {
  return (process.env.SAAS_MODE ?? 'true') !== 'true';
}

/** Durable state (JWT) — survives API restart, same pattern as Slack OAuth. */
function signState(userId: string, organizationId: string): string {
  return jwt.sign(
    { sub: userId, org: organizationId, typ: 'notion_oauth' },
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
  if (!payload.sub || !payload.org) {
    throw new Error('Invalid OAuth state payload');
  }
  return { sub: payload.sub, org: payload.org };
}

function getNotionRedirectUri(): string | undefined {
  const raw = process.env.NOTION_OAUTH_REDIRECT_URI?.trim();
  if (!raw) return undefined;
  // Notion rejects IP redirect URIs ("can't use IP addresses"). Keep localhost.
  return raw.replace('http://127.0.0.1:', 'http://localhost:');
}

function assertRedirectUriShape(redirectUri: string): string | null {
  try {
    const u = new URL(redirectUri);
    if (!u.pathname.endsWith('/oauth/notion/callback')) {
      return `NOTION_OAUTH_REDIRECT_URI path must end with /oauth/notion/callback (got ${u.pathname})`;
    }
    if (u.hostname === '127.0.0.1') {
      return 'Notion rejects 127.0.0.1 redirect URIs — use localhost or an HTTPS hostname';
    }
    if (u.hostname.endsWith('trycloudflare.com')) {
      oauthLog('warn_trycloudflare_redirect', {
        hint: 'Quick tunnels break when DNS/ISP cannot resolve the hostname. Prefer localhost for local or a fixed HTTPS API domain for production.',
        host: u.hostname,
      });
    }
  } catch {
    return 'NOTION_OAUTH_REDIRECT_URI is not a valid URL';
  }
  return null;
}

async function assertRedirectReachable(redirectUri: string): Promise<string | null> {
  if (!redirectUri.startsWith('https://')) return null;
  try {
    const origin = new URL(redirectUri).origin;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const probe = await fetch(`${origin}/health`, { signal: controller.signal });
      if (!probe.ok) {
        return `Redirect host /health returned ${probe.status}. Keep the API (and tunnel, if any) running during Allow.`;
      }
      const body = (await probe.json().catch(() => null)) as { ok?: boolean } | null;
      if (!body?.ok) {
        return 'Redirect host did not reach Nexora /health. Keep API + tunnel running, then retry Connect.';
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    oauthLog('preflight_fail', { error: err instanceof Error ? err.message : String(err), redirectUri });
    return (
      'Notion redirect URL is not reachable from this machine (DNS/tunnel/API). ' +
      'For local: use http://localhost:4000/oauth/notion/callback or fix DNS (Chrome Secure DNS → Cloudflare). ' +
      `Configured: ${redirectUri}`
    );
  }
  return null;
}

oauthNotionRouter.get('/start', async (req, res) => {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined);
  if (!token) {
    oauthLog('start_missing_token', {});
    res.status(401).json({ error: 'Missing token — pass ?token=<jwt> or an Authorization header' });
    return;
  }

  let payload: { sub: string; org: string };
  try {
    payload = jwt.verify(token, getJwtSecret()) as { sub: string; org: string };
  } catch {
    oauthLog('start_invalid_session', {});
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  const clientId = process.env.NOTION_OAUTH_CLIENT_ID?.trim();
  const redirectUri = getNotionRedirectUri();
  if (!clientId || !redirectUri) {
    oauthLog('start_misconfigured', { hasClientId: Boolean(clientId), hasRedirect: Boolean(redirectUri) });
    res.status(500).json({ error: 'NOTION_OAUTH_CLIENT_ID / NOTION_OAUTH_REDIRECT_URI not configured' });
    return;
  }

  const shapeError = assertRedirectUriShape(redirectUri);
  if (shapeError) {
    oauthLog('start_bad_redirect_shape', { redirectUri, shapeError });
    res.status(500).type('html').send(
      `<h2>Notion Connect misconfigured</h2><p>${shapeError}</p><p><a href="${webAppUrl()}/app/integrations">Back</a></p>`
    );
    return;
  }

  const preflightError = await assertRedirectReachable(redirectUri);
  if (preflightError) {
    oauthLog('start_preflight_blocked', { redirectUri });
    res.status(503).type('html').send(
      `<h2>Notion Connect blocked</h2><p>${preflightError}</p><p><a href="${webAppUrl()}/app/integrations">Back to Integrations</a></p>`
    );
    return;
  }

  const state = signState(payload.sub, payload.org);
  const authorizeUrl = new URL('https://api.notion.com/v1/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('owner', 'user');
  authorizeUrl.searchParams.set('state', state);

  oauthLog('start_redirect', {
    redirectUri,
    clientIdSuffix: clientId.slice(-8),
    userId: payload.sub,
    orgId: payload.org,
    stateFingerprint: crypto.createHash('sha256').update(state).digest('hex').slice(0, 12),
  });
  res.redirect(authorizeUrl.toString());
});

oauthNotionRouter.get('/callback', async (req, res) => {
  const { code, state, error: notionError } = req.query as Record<string, string>;
  oauthLog('callback_hit', {
    hasCode: Boolean(code),
    hasState: Boolean(state),
    notionError: notionError || null,
    queryKeys: Object.keys(req.query),
  });

  if (notionError) {
    oauthLog('callback_notion_error', { notionError });
    res.status(400).send(`Notion authorization failed: ${notionError}`);
    return;
  }

  if (!code || !state) {
    // Bare /callback (probes, manual open) — NOT a failed Allow redirect with a code.
    oauthLog('callback_bare_or_incomplete', {
      hint: 'This usually means the URL was opened without ?code=&state=. If you clicked Allow and still land here empty, Notion never redirected with a code (timeout / redirect URI / DNS).',
    });
    res.status(400).type('html').send(
      `<h2>Notion OAuth callback incomplete</h2>
       <p>Missing <code>code</code> or <code>state</code> query parameters.</p>
       <p>If you opened this URL yourself, that is expected. Real Connect must come from Notion after <strong>Allow access</strong>.</p>
       <p>If you clicked Allow and still see this, Notion did not finish the redirect — check redirect URI match, API uptime, and DNS (see <code>OAUTH_ROOT_CAUSE_ANALYSIS.md</code>).</p>
       <p><a href="${webAppUrl()}/app/integrations">Back to Integrations</a></p>`
    );
    return;
  }

  let payload: { sub: string; org: string };
  try {
    payload = verifyState(state);
  } catch (err) {
    oauthLog('callback_state_invalid', { error: err instanceof Error ? err.message : String(err) });
    res.status(401).send('Invalid or expired authorization session — please try connecting again from Integrations.');
    return;
  }

  const clientId = process.env.NOTION_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = getNotionRedirectUri();
  if (!clientId || !clientSecret || !redirectUri) {
    oauthLog('callback_misconfigured', {});
    res.status(500).send('Notion OAuth is not configured on the server');
    return;
  }

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let tokenRes: Response;
    try {
      oauthLog('token_exchange_begin', { redirectUri, clientIdSuffix: clientId.slice(-8) });
      tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${basicAuth}`,
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      oauthLog('token_exchange_fail', { status: tokenRes.status, body: body.slice(0, 500) });
      res
        .status(502)
        .send(
          `Failed to exchange authorization code with Notion (${tokenRes.status}). ` +
            `Confirm NOTION_OAUTH_CLIENT_ID/SECRET match the Public connection and redirect URI is exactly ${redirectUri}`
        );
      return;
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      bot_id?: string;
      workspace_id?: string;
      workspace_name?: string;
      workspace_icon?: string | null;
      owner?: Record<string, unknown>;
    };

    if (!tokenData.access_token) {
      oauthLog('token_exchange_empty', {});
      res.status(502).send('Notion did not return an access token');
      return;
    }

    await storeConnection(payload.org, 'notion', tokenData.access_token, {
      userId: payload.sub,
      metadata: {
        workspaceId: tokenData.workspace_id,
        workspaceName: tokenData.workspace_name,
        workspaceIcon: tokenData.workspace_icon ?? null,
        botId: tokenData.bot_id,
        owner: tokenData.owner ?? null,
        connectedAt: new Date().toISOString(),
        method: 'oauth',
      },
    });

    if (isDemoMode()) {
      process.env.NOTION_API_KEY = tokenData.access_token;
    }

    const dest = `${webAppUrl()}/app/integrations?connected=notion`;
    oauthLog('success', {
      dest,
      workspace: tokenData.workspace_name,
      userId: payload.sub,
      orgId: payload.org,
    });
    res.redirect(dest);
  } catch (err) {
    oauthLog('callback_exception', {
      error: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : undefined,
    });
    const msg =
      err instanceof Error && err.name === 'AbortError'
        ? 'Notion token exchange timed out — check network and try Connect again.'
        : 'Something went wrong connecting Notion. Ensure the API is running, then try Connect again.';
    res.status(500).send(msg);
  }
});
