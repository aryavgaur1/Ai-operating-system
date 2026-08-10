import {
  getAccessToken,
  getConnectionDetails,
  getSlackUserToken,
  touchConnectionLastUsed,
} from '@enterprise-ai-os/stores';
import {
  clearNotionClient,
  initializeNotionClient,
  runWithConnectorContext,
  slackService,
} from '@enterprise-ai-os/connectors';

type AuthUser = {
  id: string;
  organizationId: string;
};

/** Load this user's live connector tokens and run `fn` inside connector context. */
export async function withUserConnectorContext<T>(user: AuthUser, fn: () => Promise<T>): Promise<T> {
  const demoMode = (process.env.SAAS_MODE ?? 'true') !== 'true';

  let slackBotToken: string | undefined;
  let slackUserToken: string | undefined;
  let notionToken: string | undefined;
  let jiraToken: string | undefined;
  let jiraCloudId: string | undefined;
  let jiraSiteUrl: string | undefined;

  if (demoMode) {
    try {
      slackService.clearClient();
      if (process.env.SLACK_BOT_TOKEN?.trim()) {
        slackBotToken = process.env.SLACK_BOT_TOKEN.trim();
        slackService.initializeClient(slackBotToken);
      }
      if (process.env.SLACK_USER_TOKEN?.trim()) {
        slackUserToken = process.env.SLACK_USER_TOKEN.trim();
        slackService.initializeUserClient(slackUserToken);
      }
    } catch {
      // ignore
    }
    try {
      clearNotionClient();
      if (process.env.NOTION_API_KEY?.trim()) {
        notionToken = process.env.NOTION_API_KEY.trim();
        initializeNotionClient(notionToken);
      }
    } catch {
      // ignore
    }
  } else {
    slackService.clearClient();
    clearNotionClient();
    try {
      slackBotToken = await getAccessToken(user.organizationId, 'slack', user.id);
      slackUserToken = await getSlackUserToken(user.organizationId, user.id);
      if (slackBotToken) {
        slackService.initializeClient(slackBotToken);
        void touchConnectionLastUsed(user.organizationId, 'slack', user.id);
      }
      if (slackUserToken) slackService.initializeUserClient(slackUserToken);
    } catch {
      // leave disconnected
    }
    try {
      notionToken = await getAccessToken(user.organizationId, 'notion', user.id);
      if (notionToken) {
        initializeNotionClient(notionToken);
        void touchConnectionLastUsed(user.organizationId, 'notion', user.id);
      }
    } catch {
      // leave disconnected
    }
    try {
      jiraToken = await getAccessToken(user.organizationId, 'jira', user.id);
      if (jiraToken) {
        const details = await getConnectionDetails(user.organizationId, user.id);
        const jira = details.find((d) => d.tool === 'jira' && d.status === 'active');
        const meta = jira?.metadata ?? {};
        jiraCloudId =
          (typeof meta.cloudId === 'string' && meta.cloudId) ||
          (typeof meta.workspaceId === 'string' && meta.workspaceId) ||
          undefined;
        jiraSiteUrl = typeof meta.siteUrl === 'string' ? meta.siteUrl : undefined;
        void touchConnectionLastUsed(user.organizationId, 'jira', user.id);
      }
    } catch {
      // leave disconnected
    }
  }

  return runWithConnectorContext(
    {
      organizationId: user.organizationId,
      userId: user.id,
      slackBotToken,
      slackUserToken,
      notionToken,
      jiraToken,
      jiraCloudId,
      jiraSiteUrl,
      saasStrict: !demoMode,
    },
    fn
  );
}
