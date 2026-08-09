import { AsyncLocalStorage } from 'async_hooks';

export interface ConnectorContext {
  organizationId?: string;
  userId?: string;
  /** Per-request tokens — preferred over process env / singletons (SaaS isolation). */
  slackBotToken?: string;
  slackUserToken?: string;
  notionToken?: string;
  jiraToken?: string;
  jiraCloudId?: string;
  jiraSiteUrl?: string;
  /** When true, never fall back to platform .env tokens. */
  saasStrict?: boolean;
}

export const connectorContext = new AsyncLocalStorage<ConnectorContext>();

export function runWithConnectorContext<T>(ctx: ConnectorContext, fn: () => T): T {
  return connectorContext.run(ctx, fn);
}

export function getConnectorContext(): ConnectorContext {
  return connectorContext.getStore() ?? {};
}

export function hasSlackTokenInContext(): boolean {
  const ctx = getConnectorContext();
  if (ctx.slackBotToken?.trim()) return true;
  if (ctx.saasStrict) return false;
  return Boolean(process.env.SLACK_BOT_TOKEN?.trim());
}

export function hasNotionTokenInContext(): boolean {
  const ctx = getConnectorContext();
  if (ctx.notionToken?.trim()) return true;
  if (ctx.saasStrict) return false;
  return Boolean(process.env.NOTION_API_KEY?.trim());
}

export function hasJiraTokenInContext(): boolean {
  const ctx = getConnectorContext();
  if (ctx.jiraToken?.trim() && ctx.jiraCloudId?.trim()) return true;
  if (ctx.saasStrict) return false;
  return false;
}
