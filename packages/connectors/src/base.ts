import type { ToolCallResult, ToolName } from '@enterprise-ai-os/shared';
import { hasJiraTokenInContext, hasNotionTokenInContext, hasSlackTokenInContext } from './context';

// ============================================================
// ToolConnector — common interface for third-party integrations.
// Write actions must hit real APIs or return an explicit failure:
//   "Not connected" | "Not implemented"
// Never report fake success from fixtures / latency stubs.
// ============================================================

/** Tools with real OAuth + execute paths in production. */
export const PRODUCTION_LIVE_TOOLS: readonly ToolName[] = ['slack', 'jira', 'notion'];

/** Tools that must never be proposed or shown as connectable. */
export const NOT_IMPLEMENTED_TOOLS: readonly ToolName[] = ['gmail', 'salesforce'];

export function isProductionLiveTool(tool: ToolName): boolean {
  return (PRODUCTION_LIVE_TOOLS as readonly string[]).includes(tool);
}

export function isNotImplementedTool(tool: ToolName): boolean {
  return (NOT_IMPLEMENTED_TOOLS as readonly string[]).includes(tool);
}

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

/** Rare non-success delay helper — do not use to fake successful API calls. */
export function simulateLatency(minMs = 40, maxMs = 120): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function notConnectedResult(tool: ToolName, action: string): ToolCallResult {
  return {
    tool,
    action,
    ok: false,
    error: `Not connected — ${tool} is not connected for this user. Connect it under Integrations, then retry.`,
    mocked: false,
  };
}

export function notImplementedResult(tool: ToolName, action: string): ToolCallResult {
  return {
    tool,
    action,
    ok: false,
    error: `Not implemented — ${tool}.${action} is not available. Use Slack, Jira, or Notion for live actions.`,
    mocked: false,
  };
}

/**
 * Checks whether a connector should run live.
 * Per-request SaaS OAuth tokens always win (connected ⇒ live).
 * Gmail/Salesforce are never live until implemented.
 */
export function isLiveMode(tool?: ToolName): boolean {
  if (tool && isNotImplementedTool(tool)) return false;

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
