/**
 * User-facing copy for tool progress — never expose orchestrator internals.
 */

const TOOL_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  slack: 'Slack',
  notion: 'Notion',
  jira: 'Jira',
  salesforce: 'Salesforce',
};

const ACTION_START: Record<string, string> = {
  'gmail.searchEmails': "I'm checking your Gmail for matching messages.",
  'gmail.getEmail': "I'm opening that email.",
  'gmail.getThread': "I'm reading that email thread.",
  'gmail.sendEmail': "I'm preparing to send an email.",
  'slack.postMessage': "I'm preparing a Slack message.",
  'slack.createChannel': "I'm preparing a Slack channel.",
  'slack.createWarRoom': "I'm preparing a Slack war room.",
  'slack.searchMessages': "I'm searching Slack.",
  'slack.getChannelHistory': "I'm reading recent Slack activity.",
  'slack.dailyDigest': "I'm summarizing today's Slack activity.",
  'slack.weeklyDigest': "I'm preparing a Slack weekly digest.",
  'notion.createPage': "I'm preparing a Notion page.",
  'notion.updatePage': "I'm preparing a Notion update.",
  'notion.searchPages': "I'm searching Notion.",
  'jira.createIssue': "I'm preparing a Jira task.",
  'jira.updateIssue': "I'm preparing a Jira update.",
  'jira.searchIssues': "I'm searching Jira.",
  'jira.deleteIssue': "I'm preparing to delete a Jira issue.",
  'slack.searchHistory': "I'm searching Slack conversations.",
  'slack.semanticSearch': "I'm searching Slack for relevant discussions.",
};

const ACTION_OK: Record<string, string> = {
  'gmail.searchEmails': 'Finished checking Gmail.',
  'gmail.getEmail': 'Finished reading the email.',
  'gmail.getThread': 'Finished reading the thread.',
  'gmail.sendEmail': 'Email sent.',
  'slack.postMessage': 'Slack message posted.',
  'slack.createChannel': 'Slack channel created.',
  'slack.createWarRoom': 'War room is ready.',
  'slack.searchMessages': 'Finished searching Slack.',
  'slack.searchHistory': 'Finished searching Slack.',
  'slack.dailyDigest': 'Digest ready.',
  'notion.createPage': 'Notion page created.',
  'notion.updatePage': 'Notion page updated.',
  'notion.searchPages': 'Finished searching Notion.',
  'jira.createIssue': 'Jira task queued.',
  'jira.searchIssues': 'Finished searching Jira.',
};

export function humanToolLabel(tool: string, action?: string): string {
  const key = action ? `${tool}.${action}` : '';
  if (key && ACTION_START[key]) {
    // Short label for chips
    const product = TOOL_LABELS[tool] || tool;
    if (action?.toLowerCase().includes('search') || action?.toLowerCase().includes('get')) {
      return `Checking ${product}`;
    }
    if (action?.toLowerCase().includes('create') || action?.toLowerCase().includes('send')) {
      return `Working in ${product}`;
    }
    return product;
  }
  return TOOL_LABELS[tool] || 'Connected tool';
}

export function humanToolStart(tool: string, action: string): string {
  const key = `${tool}.${action}`;
  if (ACTION_START[key]) return ACTION_START[key];
  const product = TOOL_LABELS[tool] || 'your tools';
  return `I'm working in ${product}.`;
}

export function humanToolResult(tool: string, action: string, ok: boolean, error?: string): string {
  const key = `${tool}.${action}`;
  if (!ok) {
    const msg = (error || '').trim();
    if (/reauthor|reconnect|oauth|token/i.test(msg)) {
      return `You'll need to reconnect ${TOOL_LABELS[tool] || tool} under Integrations.`;
    }
    if (msg) return msg.length > 160 ? msg.slice(0, 157) + '…' : msg;
    return `Something went wrong with ${TOOL_LABELS[tool] || tool}. Please try again.`;
  }
  if (ACTION_OK[key]) return ACTION_OK[key];
  return `Finished with ${TOOL_LABELS[tool] || 'your tools'}.`;
}
