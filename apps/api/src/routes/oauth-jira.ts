import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { storeConnection, revokeConnection, query } from '@enterprise-ai-os/stores';
import { mailer } from '../lib/mailer';
import { webAppUrl } from '../lib/authTokens';
import { getJwtSecret } from '../middleware/auth';

// ============================================================
// Jira / Atlassian OAuth 2.0 (3LO) — per-user tokens in Postgres.
// Authorize → token → accessible-resources (cloudId) → store.
// ============================================================

export const oauthJiraRouter = Router();

const JIRA_SCOPES = [
  'read:jira-work',
  'write:jira-work',
  'read:jira-user',
  'offline_access',
  'read:me',
  'read:account',
].join(' ');

function signState(userId: string, organizationId: string): string {
  return jwt.sign({ sub: userId, org: organizationId, typ: 'jira_oauth' }, getJwtSecret(), {
    expiresIn: '30m',
  });
}

function verifyState(state: string): { sub: string; org: string } {
  const payload = jwt.verify(state, getJwtSecret()) as { sub: string; org: string; typ?: string };
  if (!payload.sub || !payload.org) throw new Error('Invalid OAuth state');
  return { sub: payload.sub, org: payload.org };
}

function getRedirectUri(): string | undefined {
  const raw = process.env.JIRA_OAUTH_REDIRECT_URI?.trim();
  if (raw) return raw.replace(/\/$/, '');
  const host = process.env.RAILWAY_PUBLIC_DOMAIN?.trim() || process.env.API_PUBLIC_URL?.trim();
  if (!host) return undefined;
  const base = host.startsWith('http') ? host.replace(/\/$/, '') : `https://${host}`;
  return `${base}/oauth/jira/callback`;
}

oauthJiraRouter.get('/start', (req, res) => {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined);
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

  const clientId = process.env.JIRA_CLIENT_ID?.trim();
  const redirectUri = getRedirectUri();
  if (!clientId || !redirectUri) {
    res.status(500).json({ error: 'JIRA_CLIENT_ID / JIRA_OAUTH_REDIRECT_URI not configured' });
    return;
  }

  const state = signState(payload.sub, payload.org);
  const url = new URL('https://auth.atlassian.com/authorize');
  url.searchParams.set('audience', 'api.atlassian.com');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', JIRA_SCOPES);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('prompt', 'consent');

  console.log('[oauth/jira] start_redirect', {
    redirectUri,
    userId: payload.sub,
    orgId: payload.org,
  });
  res.redirect(url.toString());
});

oauthJiraRouter.get('/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;
  console.log('[oauth/jira] callback_hit', {
    hasCode: Boolean(code),
    hasState: Boolean(state),
    error: error || null,
  });

  if (error) {
    res.status(400).send(`Jira authorization failed: ${error}`);
    return;
  }
  if (!code || !state) {
    res.status(400).send('Missing code or state from Jira callback');
    return;
  }

  let payload: { sub: string; org: string };
  try {
    payload = verifyState(state);
  } catch {
    res.status(401).send('Invalid or expired authorization session — try Connect Jira again.');
    return;
  }

  const clientId = process.env.JIRA_CLIENT_ID?.trim();
  const clientSecret = process.env.JIRA_CLIENT_SECRET?.trim();
  const redirectUri = getRedirectUri();
  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).send('Jira OAuth is not configured on the server');
    return;
  }

  try {
    const tokenRes = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('[oauth/jira] token_exchange_fail', tokenData);
      res
        .status(502)
        .send(
          `Failed to exchange Jira authorization code (${tokenRes.status}). ${tokenData.error_description || tokenData.error || ''}`
        );
      return;
    }

    const resourcesRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/json',
      },
    });
    const resources = (await resourcesRes.json()) as Array<{
      id: string;
      name?: string;
      url?: string;
      scopes?: string[];
    }>;

    if (!resourcesRes.ok || !Array.isArray(resources) || !resources.length) {
      console.error('[oauth/jira] no_accessible_resources', resources);
      res
        .status(502)
        .send(
          'Jira connected, but no accessible site was returned. Open your Jira Cloud site, then try Connect again and select the site.'
        );
      return;
    }

    // Prefer a resource that looks like Jira (has jira scopes) else first site
    const preferred =
      resources.find((r) => (r.scopes || []).some((s) => /jira/i.test(s))) || resources[0];

    const expiresAt =
      typeof tokenData.expires_in === 'number'
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : undefined;

    await storeConnection(payload.org, 'jira', tokenData.access_token, {
      userId: payload.sub,
      refreshToken: tokenData.refresh_token,
      expiresAt,
      scope: tokenData.scope || JIRA_SCOPES,
      metadata: {
        cloudId: preferred.id,
        workspaceId: preferred.id,
        workspaceName: preferred.name || preferred.url || 'Jira',
        siteUrl: preferred.url,
        connectedAt: new Date().toISOString(),
        method: 'oauth',
      },
    });

    const email = await query<{ email: string }>(`select email from users where id = $1`, [payload.sub]);
    if (email.rows[0]) await mailer.sendIntegrationConnected(email.rows[0].email, 'Jira');

    console.log('[oauth/jira] success', {
      userId: payload.sub,
      orgId: payload.org,
      workspace: preferred.name,
      cloudId: preferred.id,
    });
    res.redirect(`${webAppUrl()}/app/integrations?connected=jira`);
  } catch (err) {
    console.error('[oauth/jira] callback_exception', err);
    res.status(500).send('Something went wrong connecting Jira. Try again from Integrations.');
  }
});

oauthJiraRouter.post('/disconnect', async (req, res) => {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { sub: string; org: string };
    await revokeConnection(payload.org, 'jira', payload.sub);
    res.json({ success: true, message: 'Jira disconnected' });
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
});
