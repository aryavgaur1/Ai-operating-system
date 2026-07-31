import type { ClassifiedIntent } from '@enterprise-ai-os/shared';

// ============================================================
// Query Router — is this a Read Query ("What's the status of
// Client ABC?") or an Action/Automation Query ("Draft a summary
// email and open a Jira task")?
//
// This mock implementation uses lexical cues. In production this
// step is itself a small, fast LLM call (or a fine-tuned
// classifier) — the interface is intentionally provider-agnostic
// so that swap is a one-file change (see classifyIntent below).
// ============================================================

const ACTION_VERBS = [
  'draft', 'send', 'email', 'create', 'open', 'file', 'schedule',
  'post', 'message', 'update', 'delete', 'remove', 'close',
  'assign', 'transition', 'publish', 'notify', 'reply',
  'list', 'search', 'upload', 'invite', 'react', 'summarize', 'summarise',
  'make', 'add', 'show', 'get', 'fetch', 'read', 'history',
];

export function classifyIntent(query: string): ClassifiedIntent {
  const lower = query.toLowerCase();
  const matched = ACTION_VERBS.filter((v) => lower.includes(v));

  if (matched.length > 0) {
    return {
      intent: 'action',
      confidence: Math.min(0.6 + matched.length * 0.1, 0.95),
      rationale: `Detected action verb(s): ${matched.join(', ')}`,
    };
  }

  return {
    intent: 'read',
    confidence: 0.8,
    rationale: 'No action verbs detected — treating as an informational query.',
  };
}
