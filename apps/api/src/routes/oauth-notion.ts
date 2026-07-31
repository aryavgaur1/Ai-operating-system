import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { storeConnection } from '@enterprise-ai-os/stores';

// ============================================================
// Real Notion OAuth ("Public integration") flow.
// GET /oauth/notion/start  — redirects the logged-in user to
//   Notion's authorize screen. Requires this connector to be
//   switched from "Internal integration" to "Public integration"
//   in Notion's dashboard (app.notion.com/my-integrations),
//   which gives you a client_id + client_secret instead of a
//   single static token.
// GET /oauth/notion/callback — Notion redirects back here with a
//   `code`; we exchange it for a real access token scoped to
//   whatever workspace the user picked, and store it against
//   *their* user id (not a shared org-wide key).
// ============================================================

export const oauthNotionRouter = Router();

function signState(userId: string, organizationId: string): string {
  const secret = process.env.JWT_SECRET || 'nexora-dev-jwt-secret-change-me';
  return jwt.sign({ sub: userId, org: organizationId }, secret, { expiresIn: '10m' });
}

function verifyState(state: string): { sub: string; org: string } {
  const secret = process.env.JWT_SECRET || 'nexora-dev-jwt-secret-change-me';
  return jwt.verify(state, secret) as { sub: string; org: string };
}

// Mounted BEFORE the global `authenticate` middleware in index.ts
oauthNotionRouter.get('/start', (req, res) => {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined);
  if (!token) {
    res.status(401).json({ error: 'Missing token — pass ?token=<jwt> or an Authorization header' });
    return;
  }

  let payload: { sub: string; org: string };
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET || 'nexora-dev-jwt-secret-change-me') as {
      sub: string;
      org: string;
    };
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  const clientId = process.env.NOTION_OAUTH_CLIENT_ID;
  const redirectUri = process.env.NOTION_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    res.status(500).json({ error: 'NOTION_OAUTH_CLIENT_ID / NOTION_OAUTH_REDIRECT_URI not configured' });
    return;
  }

  const state = signState(payload.sub, payload.org);
  const authorizeUrl = new URL('https://api.notion.com/v1/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('owner', 'user');
  authorizeUrl.searchParams.set('state', state);

  res.redirect(authorizeUrl.toString());
});

oauthNotionRouter.get('/callback', async (req, res) => {
  const { code, state, error: notionError } = req.query as Record<string, string>;

  if (notionError) {
    res.status(400).send(`Notion authorization failed: ${notionError}`);
    return;
  }
  if (!code || !state) {
    res.status(400).send('Missing code or state from Notion callback');
    return;
  }

  let payload: { sub: string; org: string };
  try {
    payload = verifyState(state);
  } catch {
    res.status(401).send('Invalid or expired authorization session — please try connecting again.');
    return;
  }

  const clientId = process.env.NOTION_OAUTH_CLIENT_ID;
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.NOTION_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).send('Notion OAuth is not configured on the server');
    return;
  }

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error('Notion token exchange failed:', body);
      res.status(502).send('Failed to exchange authorization code with Notion');
      return;
    }

    const tokenData = (await tokenRes.json()) as { access_token: string; workspace_name?: string };

    await storeConnection(payload.org, 'notion', tokenData.access_token, { userId: payload.sub });

    const webUrl = process.env.WEB_APP_URL ?? 'http://localhost:3000';
    res.redirect(`${webUrl}/app/integrations?connected=notion`);
  } catch (err) {
    console.error('Notion OAuth callback error:', err);
    res.status(500).send('Something went wrong connecting Notion');
  }
});
