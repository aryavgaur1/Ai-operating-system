/**
 * Slack OAuth scopes for nexora-agent.
 *
 * Bot token (xoxb-): acts as @nexora-agent
 * User token (xoxp-): admin / history / search on behalf of the authorizing user
 *
 * These must ALSO be enabled under api.slack.com → Your App →
 * OAuth & Permissions (Bot Token Scopes + User Token Scopes).
 * Then reinstall / reconnect from Nexora → Integrations.
 *
 * Note: `admin` / `admin.*` only succeed when a Workspace Owner/Admin
 * authorizes, and usually need Enterprise Grid / admin APIs. If Slack
 * shows "Invalid permissions requested", remove those from the Slack
 * app dashboard and from SLACK_USER_SCOPES below.
 */

export const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'assistant:write',
  'bookmarks:read',
  'bookmarks:write',
  'calls:read',
  'calls:write',
  'canvases:read',
  'canvases:write',
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
  'conversations.connect:manage',
  'conversations.connect:read',
  'conversations.connect:write',
  'dnd:read',
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
  'im:write.topic',
  'incoming-webhook',
  'links.embed:write',
  'lists:read',
  'lists:write',
  'mcp:connect',
  'metadata.message:read',
  'mpim:history',
  'mpim:read',
  'mpim:write',
  'pins:read',
  'pins:write',
  'reactions:read',
  'reactions:write',
  'reminders:read',
  'reminders:write',
  'search:read.im',
  'search:read.mpim',
  'team.billing:read',
  'team.preferences:read',
  'team:read',
  'users:read',
  'users:read.email',
] as const;

/** User token scopes (xoxp-) — authorize via OAuth user_scope */
export const SLACK_USER_SCOPES = [
  'admin',
  'admin.conversations:manage_objects',
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
