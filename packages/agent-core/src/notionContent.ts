/**
 * Notion page body generation — never echo the user's raw command as page content.
 * User-provided structure wins; otherwise produce an AI-draft outline.
 */

export function extractExplicitNotionBody(query: string): string | undefined {
  const bodyMatch =
    query.match(/(?:body|content|notes|description)\s*(?:is|:)?\s*["“]([^"”]+)["”]/i) ||
    query.match(/(?:body|content|notes|description)\s*(?:is|:)?\s*([^\n]+)$/i) ||
    query.match(/(?:with|using|that has)\s*["“]([^"”]+)["”]/i) ||
    query.match(/(?:include|including|with(?:\s+the)?(?:\s+following)?)\s*:\s*([\s\S]+)$/i);

  const quotedSections = [...query.matchAll(/[-•*]\s+([^\n]+)/g)].map((m) => m[1]?.trim()).filter(Boolean);
  if (quotedSections.length >= 2 && /\b(include|with|content|sections?|checklist)\b/i.test(query)) {
    return quotedSections.map((line) => `- ${line}`).join('\n');
  }

  const raw = bodyMatch?.[1]?.trim();
  if (!raw) return undefined;
  if (raw.toLowerCase() === query.trim().toLowerCase()) return undefined;
  return raw;
}

function titleLooksLikeCommand(title: string, query: string): boolean {
  const t = title.trim().toLowerCase();
  const q = query.trim().toLowerCase();
  return !t || t === q || t.startsWith('create a notion') || t.startsWith('create notion');
}

/** Structured draft — clearly marked as AI-generated initial content. */
export function buildNotionDraftBody(opts: {
  title: string;
  query: string;
  userBody?: string;
}): string {
  const userBody = (opts.userBody || '').trim();
  if (userBody && userBody.toLowerCase() !== opts.query.trim().toLowerCase()) {
    return [
      userBody,
      '',
      '---',
      '_AI-assisted draft using your provided details — review and edit as needed._',
    ].join('\n');
  }

  const title = opts.title.trim() || 'Untitled';
  const lower = `${title} ${opts.query}`.toLowerCase();

  if (/\b(meeting|standup|retro)\b/.test(lower)) {
    return [
      `# ${title}`,
      '',
      '## Attendees',
      '- ',
      '',
      '## Agenda',
      '- ',
      '',
      '## Notes',
      '- ',
      '',
      '## Action items',
      '- [ ] ',
      '',
      '---',
      '_AI-generated initial draft — replace placeholders with real details._',
    ].join('\n');
  }

  if (/\b(prd|product\s+req|spec)\b/.test(lower)) {
    return [
      `# ${title}`,
      '',
      '## Problem',
      'Describe the user/business problem this document addresses.',
      '',
      '## Goals',
      '- ',
      '',
      '## Non-goals',
      '- ',
      '',
      '## Proposed solution',
      '',
      '## Success metrics',
      '- ',
      '',
      '## Open questions',
      '- ',
      '',
      '---',
      '_AI-generated initial draft — not company-specific facts._',
    ].join('\n');
  }

  // Default documentation / OS-style page
  const isOs = /\b(os|operating\s+system|nexora)\b/.test(lower);
  const overview = isOs
    ? 'What this system is, the problem it solves, and who it serves.'
    : `Brief overview of **${title}** — purpose, audience, and current status.`;

  return [
    `# ${title}`,
    '',
    '## Overview',
    overview,
    '',
    '## Core capabilities',
    '- Understand natural-language requests',
    '- Connect to company tools',
    '- Plan actions and request approval when required',
    '- Execute real connector actions',
    '- Verify external results',
    '- Maintain conversation and organizational context',
    '',
    '## Architecture',
    '- Intent understanding',
    '- Capability registry and planner',
    '- Approval layer',
    '- Connector layer',
    '- External verification',
    '- Memory / conversation continuity',
    '',
    '## Current integrations',
    '- Jira',
    '- Slack',
    '- Notion',
    '',
    '## Roadmap',
    '- Harden execution reliability',
    '- Expand connector coverage',
    '- Improve clarification and memory resolution',
    '',
    '## Open questions',
    '- Owners and SLAs',
    '- Environments and access boundaries',
    '',
    '---',
    '_AI-generated initial draft — edit with your real company details. Do not treat placeholders as facts._',
  ].join('\n');
}

/**
 * Resolve Notion create body: never use the raw user command as page content.
 */
export function resolveNotionCreateBody(query: string, title: string, parsedBody?: string): string {
  const explicit = extractExplicitNotionBody(query) || (parsedBody || '').trim() || undefined;
  const safeExplicit =
    explicit && explicit.toLowerCase() !== query.trim().toLowerCase() ? explicit : undefined;

  if (titleLooksLikeCommand(title, query) && !safeExplicit) {
    // Still generate useful draft under a cleaned title
    const cleaned =
      query.match(/(?:called|named|titled)\s+["']?([^"'\n.]+)["']?/i)?.[1]?.trim() ||
      title.replace(/^create\s+(a\s+)?notion\s+page\s*/i, '').trim() ||
      title;
    return buildNotionDraftBody({ title: cleaned || title, query, userBody: safeExplicit });
  }

  return buildNotionDraftBody({ title, query, userBody: safeExplicit });
}
