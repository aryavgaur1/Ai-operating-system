import type { ToolCallResult } from '@enterprise-ai-os/shared';
import {
  notImplementedResult,
  type ToolConnector,
  type FetchPage,
  type NormalizedDoc,
} from './base';

// ============================================================
// Gmail Connector — NOT IMPLEMENTED
// Do not return fixture emails or fake send success.
// ============================================================

class GmailConnector implements ToolConnector {
  tool = 'gmail' as const;

  async fetchRecent(_sinceCursor?: string): Promise<FetchPage> {
    return { items: [], nextCursor: undefined };
  }

  async handleWebhook(_payload: unknown): Promise<NormalizedDoc[]> {
    return [];
  }

  listActions(): string[] {
    return ['sendEmail', 'deleteEmail'];
  }

  async execute(action: string, _input: Record<string, unknown>): Promise<ToolCallResult> {
    return notImplementedResult('gmail', action);
  }
}

export const gmailConnector = new GmailConnector();
