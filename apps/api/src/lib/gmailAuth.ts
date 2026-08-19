import {
  getAccessToken,
  getConnectionDetails,
  getRefreshToken,
  getConnectionExpiresAt,
  storeConnection,
} from '@enterprise-ai-os/stores';

// ============================================================
// Gmail per-user token resolver with automatic refresh.
// Mirrors jiraAuth.ts — completely separate from the invitation
// mailer which uses the server-level GMAIL_REFRESH_TOKEN.
// ============================================================

export type GmailAuthContext = {
  accessToken: string;
  googleEmail: string | null;
};

const REFRESH_SKEW_MS = 120_000; // refresh 2 min before expiry

async function refreshGoogleToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresIn?: number;
  scope?: string;
}> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      'Gmail connector OAuth is not configured on the server (missing GOOGLE_CLIENT_ID/SECRET).'
    );
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }).toString(),
  });

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };

  if (!res.ok || !data.access_token) {
    console.warn('[gmailAuth] refresh_failed', { status: res.status, error: data.error ?? null });
    throw new Error(
      'Gmail connection needs to be reauthorized. Open Integrations → Disconnect Gmail → Connect Gmail.'
    );
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}

/**
 * Load the user's Gmail access token, refreshing if near-expiry.
 * Returns null if the user has no Gmail connection.
 * Never logs or returns refresh tokens.
 */
export async function resolveFreshGmailAuth(
  organizationId: string,
  userId: string
): Promise<GmailAuthContext | null> {
  const existing = await getAccessToken(organizationId, 'gmail', userId);
  if (!existing) return null;

  const details = await getConnectionDetails(organizationId, userId);
  const gmailDetail = details.find((d) => d.tool === 'gmail' && d.status === 'active');
  if (!gmailDetail) return null;

  const googleEmail =
    typeof gmailDetail.metadata?.googleEmail === 'string'
      ? gmailDetail.metadata.googleEmail
      : null;

  // Check if token needs refresh
  const expiresAt = await getConnectionExpiresAt(organizationId, 'gmail', userId);
  const needsRefresh =
    expiresAt !== null && Date.now() + REFRESH_SKEW_MS >= new Date(expiresAt).getTime();

  if (!needsRefresh) {
    return { accessToken: existing, googleEmail };
  }

  // Attempt refresh
  const refreshToken = await getRefreshToken(organizationId, 'gmail', userId);
  if (!refreshToken) {
    // No refresh token — access token will expire. Return it while still valid.
    return { accessToken: existing, googleEmail };
  }

  try {
    const refreshed = await refreshGoogleToken(refreshToken);
    const newExpiresAt =
      typeof refreshed.expiresIn === 'number'
        ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
        : undefined;

    // Update stored access token (keep existing refresh token)
    await storeConnection(organizationId, 'gmail', refreshed.accessToken, {
      userId,
      expiresAt: newExpiresAt,
      scope: refreshed.scope,
      metadata: { googleEmail, updatedAt: new Date().toISOString() },
    });

    return { accessToken: refreshed.accessToken, googleEmail };
  } catch (err) {
    console.warn('[gmailAuth] refresh_error', {
      organizationId,
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
    // Return existing token — caller will handle 401
    return { accessToken: existing, googleEmail };
  }
}
