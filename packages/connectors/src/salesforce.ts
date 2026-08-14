import type { ToolCallResult } from '@enterprise-ai-os/shared';
import {
  notImplementedResult,
  type ToolConnector,
  type FetchPage,
  type NormalizedDoc,
} from './base';

// ============================================================
// Salesforce Connector — NOT IMPLEMENTED
// Do not return fixture CRM records or fake write success.
// ============================================================

class SalesforceConnector implements ToolConnector {
  tool = 'salesforce' as const;

  async fetchRecent(_sinceCursor?: string): Promise<FetchPage> {
    return { items: [], nextCursor: undefined };
  }

  async handleWebhook(_payload: unknown): Promise<NormalizedDoc[]> {
    return [];
  }

  listActions(): string[] {
    return ['createOpportunity', 'updateRecord', 'deleteRecord'];
  }

  async execute(action: string, _input: Record<string, unknown>): Promise<ToolCallResult> {
    return notImplementedResult('salesforce', action);
  }
}

export const salesforceConnector = new SalesforceConnector();
