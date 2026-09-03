import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { storeConnection, revokeConnection, upsertSlackInstallation, query } from '@enterprise-ai-os/stores';
import { mailer } from '../lib/mailer';
import { oauthAppRedirect, readOAuthReturnTo } from '../lib/oauthReturn';
import { SLACK_BOT_SCOPES, SLACK_USER_SCOPES } from '../lib/slackScopes';
import { getJwtSecret } from '../middleware/auth';

export const oauthSlackRouter = Router();

function isDemoMode(): boolean {
  return (process.env.SAAS_MODE ?? 'true') !== 'true';
}

function signState(userId: string, organizationId: string, returnTo?: string): string {
  return jwt.sign({ sub: userId, org: organizationId, ret: returnTo }, getJwtSecret(), {
    expiresIn: '10m',
  });
}

function verifyState(state: string): { sub: string; org: string; ret?: string } {
  return jwt.verify(state, getJwtSecret()) as { sub: string; org: string; ret?: string };
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
    payload = jwt.verify(token, getJwtSecret()) as { sub: string; org: string };
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

  const returnTo = readOAuthReturnTo(req.query);
  const state = signState(payload.sub, payload.org, returnTo);
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', SLACK_BOT_SCOPES.join(','));
  url.searchParams.set('user_scope', SLACK_USER_SCOPES.join(','));
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

  let payload: { sub: string; org: string; ret?: string };
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
      token_type?: string;
      team?: { id?: string; name?: string };
      bot_user_id?: string;
      app_id?: string;
      authed_user?: {
        id?: string;
        scope?: string;
        access_token?: string;
        token_type?: string;
      };
      incoming_webhook?: { url?: string; channel?: string; channel_id?: string };
    };

    if (!tokenData.ok || !tokenData.access_token) {
      res.status(502).send(`Slack token exchange failed: ${tokenData.error ?? 'unknown'}`);
      return;
    }

    const userToken = tokenData.authed_user?.access_token;
    const metadata = {
      teamId: tokenData.team?.id,
      teamName: tokenData.team?.name,
      botUserId: tokenData.bot_user_id,
      appId: tokenData.app_id,
      authedUserId: tokenData.authed_user?.id,
      userTokenPresent: Boolean(userToken),
      incomingWebhook: tokenData.incoming_webhook
        ? {
            channel: tokenData.incoming_webhook.channel,
            channelId: tokenData.incoming_webhook.channel_id,
          }
        : null,
      connectedAt: new Date().toISOString(),
    };

    await storeConnection(payload.org, 'slack', tokenData.access_token, {
      userId: payload.sub,
      scope: [
        tokenData.scope,
        tokenData.authed_user?.scope ? `user:${tokenData.authed_user.scope}` : '',
      ]
        .filter(Boolean)
        .join(' '),
      userAccessToken: userToken,
      metadata,
    });

    await upsertSlackInstallation({
      organizationId: payload.org,
      teamId: tokenData.team?.id,
      teamName: tokenData.team?.name,
      botUserId: tokenData.bot_user_id,
      appId: tokenData.app_id,
      scopes: tokenData.scope,
      status: 'active',
      metadata: { userId: payload.sub, ...metadata },
    });

    // Admin/demo only: mirror into process env. Never mutate env in SaaS customer mode.
    if (isDemoMode()) {
      process.env.SLACK_BOT_TOKEN = tokenData.access_token;
      if (userToken) process.env.SLACK_USER_TOKEN = userToken;
    }

    const email = await query<{ email: string }>(`select email from users where id = $1`, [payload.sub]);
    if (email.rows[0]) await mailer.sendIntegrationConnected(email.rows[0].email, 'Slack');

    res.redirect(oauthAppRedirect('slack', payload.ret));
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
    const payload = jwt.verify(token, getJwtSecret()) as {
      sub: string;
      org: string;
    };
    await revokeConnection(payload.org, 'slack', payload.sub);
    res.json({ success: true, message: 'Slack disconnected' });
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
});
