import type { ToolCallResult } from '@enterprise-ai-os/shared';
import { simulateLatency, isLiveMode, type ToolConnector, type FetchPage, type NormalizedDoc } from './base';

// ============================================================
// Salesforce Connector
// Live wiring point: jsforce (or raw REST) against the Salesforce
// REST/Bulk API, authorized via Salesforce Connected App OAuth.
// Webhooks: Salesforce Platform Events / Change Data Capture.
// ============================================================

const MOCK_RECORDS: NormalizedDoc[] = [
  {
    externalId: '0061-ACME',
    resourceType: 'record',
    title: 'Opportunity: Acme Corp — Dashboard Rollout',
    url: 'https://mock.my.salesforce.com/0061-ACME',
    text: 'Stage: Negotiation. Amount: 480,000. Close date: next month. Owner: Meera.',
    metadata: { object: 'Opportunity', stage: 'Negotiation', account: 'Acme Corp', owner: 'meera' },
  },
  {
    externalId: '0031-ACME-CONTACT',
    resourceType: 'record',
    title: 'Contact: J. Sharma (Acme Corp)',
    url: 'https://mock.my.salesforce.com/0031-ACME-CONTACT',
    text: 'Primary technical contact for the Acme Corp dashboard project.',
    metadata: { object: 'Contact', account: 'Acme Corp' },
  },
];

class SalesforceConnector implements ToolConnector {
  tool = 'salesforce' as const;

  async fetchRecent(sinceCursor?: string): Promise<FetchPage> {
    await simulateLatency();
    if (isLiveMode()) {
      // TODO(live): SOQL query via conn.query('SELECT ... WHERE LastModifiedDate > :sinceCursor')
      throw new Error('Salesforce live mode not implemented yet — set CONNECTORS_MODE=mock.');
    }
    return { items: MOCK_RECORDS, nextCursor: undefined };
  }

  async handleWebhook(payload: unknown): Promise<NormalizedDoc[]> {
    await simulateLatency(20, 60);
    // TODO(live): parse Change Data Capture event envelope
    const p = payload as { recordId?: string; objectType?: string; name?: string };
    if (!p?.recordId) return [];
    return [
      {
        externalId: p.recordId,
        resourceType: 'record',
        title: `${p.objectType ?? 'Record'}: ${p.name ?? p.recordId}`,
        url: `https://mock.my.salesforce.com/${p.recordId}`,
        text: p.name ?? '',
        metadata: { object: p.objectType },
      },
    ];
  }

  listActions(): string[] {
    return ['createOpportunity', 'updateRecord', 'deleteRecord'];
  }

  async execute(action: string, input: Record<string, unknown>): Promise<ToolCallResult> {
    await simulateLatency();
    // Never report fake success — Salesforce live API is not wired yet.
    if (isLiveMode('salesforce')) {
      return {
        tool: 'salesforce',
        action,
        ok: false,
        error:
          'Salesforce live mode is not implemented yet. Connect Salesforce under Integrations when available, or use Slack/Jira/Notion.',
        mocked: false,
      };
    }
    console.warn(`[MOCK salesforce.${action}] blocked from reporting fake success`);
    return {
      tool: 'salesforce',
      action,
      ok: false,
      error:
        'Salesforce is not live. Refusing to fake a successful CRM write — connect a live integration or use Slack/Jira/Notion.',
      mocked: true,
    };
  }
}

export const salesforceConnector = new SalesforceConnector();
