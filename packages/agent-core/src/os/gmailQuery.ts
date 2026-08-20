/**
 * Natural-language → Gmail API `q` translator.
 * Produces real Gmail search operators — never invents message content.
 */

export function isGmailDestinationQuery(query: string): boolean {
  const t = query.toLowerCase();
  if (/\b(gmail|inbox)\b/.test(t)) return true;
  if (/\bmy\s+(e-?mails?|mail)\b/.test(t)) return true;
  if (
    /\b(e-?mails?|mail)\b/.test(t) &&
    /\b(search|find|show|read|get|list|check|look|open|fetch|latest|recent|unread|priority|important|starred|attachment|from|about|regarding)\b/.test(
      t
    )
  ) {
    return true;
  }
  if (/\b(top\s+priority|most\s+important)\b/.test(t) && /\b(e-?mails?|mail|inbox)\b/.test(t)) {
    return true;
  }
  return false;
}

export function isGmailSendQuery(query: string): boolean {
  const t = query.toLowerCase();
  return (
    /\b(send|draft|compose|write|reply)\b/.test(t) &&
    /\b(e-?mail|mail|gmail)\b/.test(t) &&
    (/\bto\s+[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(query) ||
      /\breply\b/.test(t) ||
      /\bsend\s+(an?\s+)?(e-?mail|mail)\b/.test(t))
  );
}

const FROM_STOPWORDS = new Set([
  'the',
  'my',
  'a',
  'an',
  'last',
  'past',
  'this',
  'today',
  'week',
  'month',
  'year',
  'email',
  'emails',
  'mail',
  'gmail',
  'inbox',
  'college',
  'university',
  'school',
]);

/**
 * Build a Gmail `users.messages.list` q string from natural language.
 */
export function buildGmailSearchQuery(raw: string): string {
  const q = raw.trim();
  const lower = q.toLowerCase();
  const parts: string[] = [];

  if (/\bunread\b/.test(lower)) parts.push('is:unread');
  if (/\b(starred|star)\b/.test(lower)) parts.push('is:starred');
  if (/\b(important|priority|urgent|top\s+priority|most\s+important)\b/.test(lower)) {
    parts.push('is:important');
  }
  if (/\b(attachment|attachments|attached|with\s+files?)\b/.test(lower)) {
    parts.push('has:attachment');
  }

  const newer =
    lower.match(/\b(?:last|past)\s+(\d+)\s+days?\b/) ||
    lower.match(/\bnewer[_\s-]?than[:\s]?(\d+)d\b/);
  if (newer?.[1]) {
    parts.push(`newer_than:${newer[1]}d`);
  } else if (/\b(today|this\s+morning)\b/.test(lower)) {
    parts.push('newer_than:1d');
  } else if (/\b(this\s+week|past\s+week|last\s+week)\b/.test(lower)) {
    parts.push('newer_than:7d');
  }

  // "from my college/university/school" is free-text — do not invent a domain.
  if (/\bfrom\s+(?:my\s+)?(college|university|school)\b/.test(lower)) {
    const kind = lower.match(/\b(college|university|school)\b/)?.[1];
    if (kind) parts.push(kind);
  } else {
    const fromEmail = q.match(/\bfrom\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i)?.[1];
    const fromQuoted = q.match(/\bfrom\s+["']([^"']+)["']/i)?.[1];
    // Avoid matching "from the last 7 days" / "from my college"
    const fromNamed =
      !fromEmail && !fromQuoted
        ? q.match(
            /\bfrom\s+(?!the\s+(?:last|past)\b)(?!my\s+(?:college|university|school)\b)([A-Za-z][\w.-]*(?:\s+[A-Za-z][\w.-]*){0,2})/i
          )?.[1]
        : undefined;

    if (fromEmail) {
      parts.push(`from:${fromEmail}`);
    } else if (fromQuoted) {
      parts.push(`from:${fromQuoted.trim()}`);
    } else if (fromNamed) {
      const cleaned = fromNamed
        .replace(/[.,!?;:]+$/g, '')
        .replace(/\b(the|my|a|an)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const first = cleaned.split(/\s+/)[0]?.toLowerCase() ?? '';
      if (cleaned && !FROM_STOPWORDS.has(first) && !FROM_STOPWORDS.has(cleaned.toLowerCase())) {
        parts.push(`from:${cleaned}`);
      }
    }
  }

  const about =
    q.match(/\b(?:about|regarding|re:)\s+["']([^"']+)["']/i)?.[1] ||
    q.match(/\b(?:about|regarding)\s+(.+?)(?:\.|$|\?)/i)?.[1];
  if (about) {
    const topic = about
      .replace(/\b(the|my|a|an|email|emails|mail|please|find|show)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    if (topic.length >= 2) parts.push(topic);
  }

  if (parts.length === 0) {
    if (/\b(latest|recent|inbox|priority|important)\b/.test(lower)) {
      return 'in:inbox';
    }
    const stripped = q
      .replace(
        /\b(find|show|get|search|list|check|look\s+for|my|the|a|an|please|emails?|e-mails?|mail|gmail|inbox)\b/gi,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim();
    return stripped.length >= 2 ? stripped : 'in:inbox';
  }

  if (
    !parts.some(
      (p) => p.startsWith('is:') || p.startsWith('from:') || p.startsWith('newer_') || p.startsWith('has:')
    )
  ) {
    parts.unshift('in:inbox');
  }

  return parts.join(' ');
}

export function formatGmailSearchReply(output: Record<string, unknown> | undefined): string {
  if (!output) return 'Gmail search returned no data.';
  const emails = Array.isArray(output.emails) ? output.emails : [];
  const account = typeof output.account === 'string' ? output.account : null;
  const query = typeof output.query === 'string' ? output.query : null;
  const header =
    `Found **${emails.length}** email${emails.length === 1 ? '' : 's'}` +
    (query ? ` matching \`${query}\`` : '') +
    (account ? ` in **${account}**` : '') +
    '.';

  if (emails.length === 0) {
    return (
      header +
      '\n\nNo messages matched. Try a narrower query (sender, subject keywords, or `is:unread`).'
    );
  }

  const lines = emails.slice(0, 12).map((raw, i) => {
    const e = raw as {
      title?: string;
      url?: string;
      metadata?: { subject?: string; from?: string; date?: string; snippet?: string };
      text?: string;
    };
    const subject = e.metadata?.subject || e.title || '(no subject)';
    const from = e.metadata?.from || '';
    const date = e.metadata?.date
      ? new Date(e.metadata.date).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : '';
    const snippet = (e.metadata?.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    const link = e.url ? ` — [Open](${e.url})` : '';
    return (
      `${i + 1}. **${subject}**` +
      (from ? `\n   From: ${from}` : '') +
      (date ? `\n   ${date}` : '') +
      (snippet ? `\n   ${snippet}` : '') +
      link
    );
  });

  return `${header}\n\n${lines.join('\n\n')}`;
}
