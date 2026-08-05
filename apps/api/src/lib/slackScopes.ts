/**
 * Slack OAuth scopes — keep bot vs user scopes explicit.
 * Bot token (xoxb-): acts as @nexora-agent
 * User token (xoxp-): search + broader history on behalf of the authorizing user
 *
 * Keep this list conservative. One invalid/restricted scope → Slack shows
 * "Invalid permissions requested" and blocks the whole install.
 */

export const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'channels:join',
  'channels:manage',
  'channels:read',
  'channels:write.invites',
  'channels:write.topic',
  'chat:write',
  'chat:write.customize',
  'chat:write.public',
  'commands',
  'emoji:read',
  'files:read',
  'files:write',
  'groups:history',
  'groups:read',
  'groups:write',
  'groups:write.invites',
  'groups:write.topic',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'mpim:read',
  'mpim:write',
  'pins:read',
  'pins:write',
  'reactions:read',
  'reactions:write',
  'team:read',
  'users:read',
  'users:read.email',
] as const;

/** User token scopes (xoxp-) — authorize via OAuth user_scope */
export const SLACK_USER_SCOPES = [
  'channels:history',
  'channels:read',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'mpim:history',
  'mpim:read',
  'search:read',
  'users:read',
  'users:read.email',
] as const;
