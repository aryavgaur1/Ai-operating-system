import type { ToolCallResult, ToolName } from '@enterprise-ai-os/shared';
import { hasJiraTokenInContext, hasNotionTokenInContext, hasSlackTokenInContext } from './context';

// ============================================================
// ToolConnector — the common interface every third-party
// integration implements, so the ingestion pipeline and the tool
// execution engine never need to know which specific API they're
// talking to.
//
// Every connector in this package starts as a MOCK: it
// generates plausible fixture data and simulates async latency
// instead of calling a real API. Each file marks exactly
// where a real SDK call replaces the mock.
//
// isLiveMode(tool) checks a per-tool override first (e.g.
// NOTION_MODE=live) so you can flip individual connectors to
// live one at a time, without forcing every other connector
// (Slack, Jira, Gmail, Salesforce) into live mode as well.
// Falls back to the global CONNECTORS_MODE if no per-tool
// override is set.
// ============================================================

export interface NormalizedDoc {
  externalId: string;
  resourceType: 'message' | 'issue' | 'email' | 'record' | 'page';
  title: string;
  url: string;
  text: string;
  metadata: Record<string, unknown>;
}

export interface FetchPage {
  items: NormalizedDoc[];
  nextCursor?: string;
}

export interface ToolConnector {
  tool: ToolName;
  /** Batch polling — periodic incremental backfill (Phase 1, Sprint 1-2). */
  fetchRecent(sinceCursor?: string): Promise<FetchPage>;
  /** Event-driven ingestion — normalizes an inbound webhook payload. */
  handleWebhook(payload: unknown): Promise<NormalizedDoc[]>;
  /** Actions the Tool Execution Engine is allowed to call on this connector. */
  listActions(): string[];
  /** Executes a single tool call. Always returns a ToolCallResult, never throws. */
  execute(action: string, input: Record<string, unknown>): Promise<ToolCallResult>;
}

/** Shared helper: simulate realistic network latency for mocked calls. */
export function simulateLatency(minMs = 150, maxMs = 500): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks whether a connector should run live.
 * Per-request SaaS OAuth tokens always win (connected ⇒ live).
 * Otherwise per-tool *_MODE / CONNECTORS_MODE / platform tokens apply.
 */
export function isLiveMode(tool?: ToolName): boolean {
  if (tool === 'slack' && hasSlackTokenInContext()) return true;
  if (tool === 'notion' && hasNotionTokenInContext()) return true;
  if (tool === 'jira' && hasJiraTokenInContext()) return true;

  if (tool === 'slack' && process.env.SLACK_BOT_TOKEN?.trim()) {
    const override = process.env.SLACK_MODE;
    if (!override || override === 'live') return true;
  }
  if (tool === 'notion' && process.env.NOTION_API_KEY?.trim()) {
    const override = process.env.NOTION_MODE;
    if (!override || override === 'live') return true;
  }
  if (tool) {
    const override = process.env[`${tool.toUpperCase()}_MODE`];
    if (override) return override === 'live';
  }
  return (process.env.CONNECTORS_MODE ?? 'mock') === 'live';
}
