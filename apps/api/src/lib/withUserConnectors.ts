import {
  getAccessToken,
  getSlackUserToken,
  touchConnectionLastUsed,
} from '@enterprise-ai-os/stores';
import {
  clearNotionClient,
  initializeNotionClient,
  runWithConnectorContext,
  slackService,
} from '@enterprise-ai-os/connectors';
import { resolveFreshJiraAuth } from './jiraAuth';
import { resolveFreshGmailAuth } from './gmailAuth';

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
  let jiraAuthError: string | undefined;
  let gmailToken: string | undefined;
  let gmailEmail: string | null | undefined;
  let gmailAuthError: string | undefined;

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
      const jira = await resolveFreshJiraAuth(user.organizationId, user.id);
      if (jira) {
        jiraToken = jira.token;
        jiraCloudId = jira.cloudId;
        jiraSiteUrl = jira.siteUrl;
        void touchConnectionLastUsed(user.organizationId, 'jira', user.id);
      }
    } catch (err: unknown) {
      jiraAuthError = err instanceof Error ? err.message : String(err);
      console.warn('[withUserConnectors] jira_auth_error', {
        organizationId: user.organizationId,
        userId: user.id,
        message: jiraAuthError,
      });
    }

    try {
      const gmail = await resolveFreshGmailAuth(user.organizationId, user.id);
      if (gmail) {
        gmailToken = gmail.accessToken;
        gmailEmail = gmail.googleEmail;
        void touchConnectionLastUsed(user.organizationId, 'gmail', user.id);
      }
    } catch (err: unknown) {
      gmailAuthError = err instanceof Error ? err.message : String(err);
      console.warn('[withUserConnectors] gmail_auth_error', {
        organizationId: user.organizationId,
        userId: user.id,
        message: gmailAuthError,
      });
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
      gmailToken,
      gmailEmail,
      gmailAuthError,
      saasStrict: !demoMode,
      jiraAuthError,
    },
    fn
  );
}
