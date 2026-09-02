function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Official Slack deep link when a real channel id is known from the API. */
export function slackAppRedirectUrl(channelId: string): string {
  return `https://slack.com/app_redirect?channel=${encodeURIComponent(channelId)}`;
}

/**
 * Flatten nested Slack channel payloads (e.g. createWarRoom) so downstream
 * action outcomes can read url / id / name at the top level.
 */
export function normalizeSlackChannelOutput(
  output: Record<string, unknown>
): Record<string, unknown> {
  const channel = asRecord(output.channel);
  const id = String(output.id || channel.id || output.channelId || '').trim();
  const name = String(output.name || output.channelName || channel.name || '')
    .replace(/^#/, '')
    .trim();

  let url: string | undefined;
  if (typeof output.url === 'string' && output.url.startsWith('http')) {
    url = output.url;
  } else if (typeof channel.url === 'string' && channel.url.startsWith('http')) {
    url = channel.url;
  } else if (id) {
    url = slackAppRedirectUrl(id);
  }

  return {
    ...output,
    ...(id ? { id } : {}),
    ...(name ? { name, channelName: name } : {}),
    ...(url ? { url } : {}),
  };
}
