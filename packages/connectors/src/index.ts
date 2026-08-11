import type { ToolName } from '@enterprise-ai-os/shared';
import type { ToolConnector } from './base';
import { slackConnector } from './slack';
import { jiraConnector } from './jira';
import { gmailConnector } from './gmail';
import { salesforceConnector } from './salesforce';
import { notionConnector } from './notion';

export * from './base';
export { slackConnector } from './slack';
export { jiraConnector } from './jira';
export { gmailConnector } from './gmail';
export { salesforceConnector } from './salesforce';
export { notionConnector, initializeNotionClient, clearNotionClient } from './notion';
export { slackService, SlackServiceError, verifySlackSignature } from './slackService';
export { default as slack_service } from './slackService';
export * as slackIntelligence from './slackIntelligence';
export {
  notifyPendingApproval,
  buildApprovalBlocks,
  replyApprovalOutcome,
  getApprovalsChannel,
} from './slackApprovals';
export {
  connectorContext,
  runWithConnectorContext,
  getConnectorContext,
  hasSlackTokenInContext,
  hasNotionTokenInContext,
  hasJiraTokenInContext,
} from './context';

export const connectorRegistry: Record<ToolName, ToolConnector> = {
  slack: slackConnector,
  jira: jiraConnector,
  gmail: gmailConnector,
  salesforce: salesforceConnector,
  notion: notionConnector,
};

export function getConnector(tool: ToolName): ToolConnector {
  const connector = connectorRegistry[tool];
  if (!connector) throw new Error(`No connector registered for tool: ${tool}`);
  return connector;
}

export function allTools(): ToolName[] {
  return Object.keys(connectorRegistry) as ToolName[];
}
