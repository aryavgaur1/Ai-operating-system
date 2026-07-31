import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { storeConnection, revokeConnection } from '@enterprise-ai-os/stores';
import { mailer } from '../lib/mailer';
import { query } from '@enterprise-ai-os/stores';
import { webAppUrl } from '../lib/authTokens';

export const oauthSlackRouter = Router();

function signState(userId: string, organizationId: string): string {
  return jwt.sign({ sub: userId, org: organizationId }, process.env.JWT_SECRET || 'nexora-dev-jwt-secret-change-me', {
    expiresIn: '10m',
  });
}

function verifyState(state: string): { sub: string; org: string } {
  return jwt.verify(state, process.env.JWT_SECRET || 'nexora-dev-jwt-secret-change-me') as { sub: string; org: string };
}

oauthSlackRouter.get('/start', (req, res) => {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined);
  if (!token) {
    res.status(401).json({ error: 'Missing token — pass ?token=<jwt>' });
    return;
  }
  let payload: { sub: string; org: string };
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET || 'nexora-dev-jwt-secret-change-me') as { sub: string; org: string };
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.SLACK_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    res.status(500).json({ error: 'SLACK_CLIENT_ID / SLACK_OAUTH_REDIRECT_URI not configured' });
    return;
  }

  const state = signState(payload.sub, payload.org);
  const scopes = [
    'channels:history',
    'channels:read',
    'channels:join',
    'channels:manage',
    'chat:write',
    'chat:write.public',
    'users:read',
    'groups:read',
    'groups:history',
    'im:read',
    'im:write',
    'im:history',
    'files:write',
    'reactions:write',
    'app_mentions:read',
  ].join(',');

  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', scopes);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

oauthSlackRouter.get('/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;
  if (error) {
    res.status(400).send(`Slack authorization failed: ${error}`);
    return;
  }
  if (!code || !state) {
    res.status(400).send('Missing code or state');
    return;
  }

  let payload: { sub: string; org: string };
  try {
    payload = verifyState(state);
  } catch {
    res.status(401).send('Invalid or expired authorization session');
    return;
  }

  const clientId = process.env.SLACK_CLIENT_ID!;
  const clientSecret = process.env.SLACK_CLIENT_SECRET!;
  const redirectUri = process.env.SLACK_OAUTH_REDIRECT_URI!;

  try {
    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = (await tokenRes.json()) as {
      ok: boolean;
      error?: string;
      access_token?: string;
      scope?: string;
      team?: { id?: string; name?: string };
      bot_user_id?: string;
      app_id?: string;
    };

    if (!tokenData.ok || !tokenData.access_token) {
      res.status(502).send(`Slack token exchange failed: ${tokenData.error ?? 'unknown'}`);
      return;
    }

    await storeConnection(payload.org, 'slack', tokenData.access_token, {
      userId: payload.sub,
      scope: tokenData.scope,
    });

    const email = await query<{ email: string }>(`select email from users where id = $1`, [payload.sub]);
    if (email.rows[0]) await mailer.sendIntegrationConnected(email.rows[0].email, 'Slack');

    res.redirect(`${webAppUrl()}/app/integrations?connected=slack`);
  } catch (err) {
    console.error('Slack OAuth callback error:', err);
    res.status(500).send('Something went wrong connecting Slack');
  }
});

oauthSlackRouter.post('/disconnect', async (req, res) => {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'nexora-dev-jwt-secret-change-me') as {
      sub: string;
      org: string;
    };
    await revokeConnection(payload.org, 'slack', payload.sub);
    res.json({ success: true, message: 'Slack disconnected' });
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
});
