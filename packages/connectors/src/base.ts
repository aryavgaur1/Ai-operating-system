import type { ToolCallResult, ToolName } from '@enterprise-ai-os/shared';

// ============================================================
// ToolConnector — the common interface every third-party
// integration implements, so the ingestion pipeline and the tool
// execution engine never need to know which specific API they're
// talking to.
//
// Every connector in this package is currently a MOCK: it
// generates plausible fixture data and simulates async latency
// instead of calling a real API. Each file below marks exactly
// where a real SDK call replaces the mock — swapping CONNECTORS_MODE
// to 'live' and filling in the marked sections is the whole
// integration surface.
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

export function isLiveMode(): boolean {
  return (process.env.CONNECTORS_MODE ?? 'mock') === 'live';
}
