import {
  getAccessToken,
  getConnectionDetails,
  storeConnection,
  getRefreshToken,
  getConnectionExpiresAt,
} from '@enterprise-ai-os/stores';

/**
 * Jira OAuth access tokens expire (~1h). Refresh tokens are stored at Connect time
 * but were never used — that produces HTTP 401 on createIssue / project checks.
 * Refresh here without logging secrets.
 */

export type JiraAuthContext = {
  token: string;
  cloudId: string;
  siteUrl?: string;
};

const REFRESH_SKEW_MS = 120_000; // refresh 2 minutes before expiry

async function refreshAtlassianToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
}> {
  const clientId = process.env.JIRA_CLIENT_ID?.trim();
  const clientSecret = process.env.JIRA_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      'Jira OAuth is not configured on the server (missing JIRA_CLIENT_ID/SECRET). Ask an admin to configure Atlassian OAuth.'
    );
  }

  const tokenRes = await fetch('https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
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
    console.warn('[jiraAuth] refresh_failed', {
      status: tokenRes.status,
      error: tokenData.error || null,
      // never log tokens or descriptions that might embed secrets
    });
    throw new Error(
      'Jira auth expired or was revoked. Open Integrations → Disconnect Jira → Connect Jira, then retry.'
    );
  }

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresIn: tokenData.expires_in,
    scope: tokenData.scope,
  };
}

/**
 * Load per-user Jira token + cloudId, refreshing when expired/near-expiry.
 * Returns null when the user has no Jira connection.
 */
export async function resolveFreshJiraAuth(
  organizationId: string,
  userId: string
): Promise<JiraAuthContext | null> {
  let token = await getAccessToken(organizationId, 'jira', userId);
  if (!token) return null;

  const details = await getConnectionDetails(organizationId, userId, 'jira');
  const jira = details.find((d) => d.tool === 'jira' && d.status === 'active');
  if (!jira) return null;

  const meta = jira.metadata ?? {};
  const cloudId =
    (typeof meta.cloudId === 'string' && meta.cloudId) ||
    (typeof meta.workspaceId === 'string' && meta.workspaceId) ||
    undefined;
  const siteUrl = typeof meta.siteUrl === 'string' ? meta.siteUrl : undefined;

  if (!cloudId) {
    throw new Error(
      'Jira is connected but no site (cloudId) is stored. Open Integrations → Disconnect Jira → Connect Jira and select your site.'
    );
  }

  const expiresAt = await getConnectionExpiresAt(organizationId, 'jira', userId);
  const needsRefresh =
    !expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() - Date.now() < REFRESH_SKEW_MS;

  if (needsRefresh) {
    const refreshToken = await getRefreshToken(organizationId, 'jira', userId);
    if (!refreshToken) {
      console.warn('[jiraAuth] access_near_expiry_no_refresh', {
        organizationId,
        userId,
        hasExpiresAt: Boolean(expiresAt),
      });
      // Still return current token — callers may get 401 and surface reconnect
      return { token, cloudId, siteUrl };
    }

    try {
      const refreshed = await refreshAtlassianToken(refreshToken);
      const expiresAtIso =
        typeof refreshed.expiresIn === 'number'
          ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
          : undefined;
      await storeConnection(organizationId, 'jira', refreshed.accessToken, {
        userId,
        refreshToken: refreshed.refreshToken,
        expiresAt: expiresAtIso,
        scope: refreshed.scope,
        metadata: {
          cloudId,
          workspaceId: cloudId,
          siteUrl,
          lastRefreshedAt: new Date().toISOString(),
        },
      });
      token = refreshed.accessToken;
      console.log('[jiraAuth] token_refreshed', { organizationId, userId, cloudId });
    } catch (err) {
      // Bubble actionable reconnect; do not invent success
      throw err;
    }
  }

  return { token, cloudId, siteUrl };
}

/** Lightweight probe — never logs token. */
export async function probeJiraAuth(auth: JiraAuthContext): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`https://api.atlassian.com/ex/jira/${auth.cloudId}/rest/api/3/myself`, {
    headers: { Authorization: `Bearer ${auth.token}`, Accept: 'application/json' },
  });
  return { ok: res.ok, status: res.status };
}
