import type { ToolCallResult } from '@enterprise-ai-os/shared';
import { simulateLatency, isLiveMode, type ToolConnector, type FetchPage, type NormalizedDoc } from './base';

// ============================================================
// Notion Connector
// Live wiring point: @notionhq/client, authorized via a Notion
// internal or public OAuth integration token.
// Ingestion: Notion has no push webhooks for page edits, so this
// connector is driven entirely by batch polling (search API).
// ============================================================

const MOCK_PAGES: NormalizedDoc[] = [
  {
    externalId: 'page-phoenix-brief',
    resourceType: 'page',
    title: 'Project Phoenix — Brief',
    url: 'https://www.notion.so/mock/Project-Phoenix-Brief',
    text: 'Goal: modernize the internal dashboard for Acme Corp. Key stakeholders: Meera (PM), Arjun (Eng lead).',
    metadata: { workspace: 'Engineering', lastEditedBy: 'meera' },
  },
  {
    externalId: 'page-vendor-notes',
    resourceType: 'page',
    title: 'Vendor Contract Notes',
    url: 'https://www.notion.so/mock/Vendor-Contract-Notes',
    text: 'Vendor contract finalized; integration can resume once signed copy is received from legal.',
    metadata: { workspace: 'Legal', lastEditedBy: 'arjun' },
  },
];

class NotionConnector implements ToolConnector {
  tool = 'notion' as const;

  async fetchRecent(sinceCursor?: string): Promise<FetchPage> {
    await simulateLatency();
    if (isLiveMode()) {
      // TODO(live): notion.search({ sort: { direction: 'descending', timestamp: 'last_edited_time' }, start_cursor: sinceCursor })
      throw new Error('Notion live mode not implemented yet — set CONNECTORS_MODE=mock.');
    }
    return { items: MOCK_PAGES, nextCursor: undefined };
  }

  async handleWebhook(_payload: unknown): Promise<NormalizedDoc[]> {
    // Notion has no native webhooks for content changes — ingestion
    // for this connector relies solely on fetchRecent() batch polling.
    return [];
  }

  listActions(): string[] {
    return ['createPage', 'publishPage', 'deletePage'];
  }

  async execute(action: string, input: Record<string, unknown>): Promise<ToolCallResult> {
    await simulateLatency();
    if (isLiveMode()) {
      // TODO(live): notion.pages.create(...) / notion.pages.update(...) / notion.blocks.delete(...)
      throw new Error('Notion live mode not implemented yet — set CONNECTORS_MODE=mock.');
    }
    console.log(`[MOCK notion.${action}]`, input);
    switch (action) {
      case 'createPage':
        return { tool: 'notion', action, ok: true, output: { id: `page-${Date.now()}`, ...input }, mocked: true };
      case 'publishPage':
      case 'deletePage':
        return { tool: 'notion', action, ok: true, output: { ...input, applied: true }, mocked: true };
      default:
        return { tool: 'notion', action, ok: false, error: `Unknown action: ${action}`, mocked: true };
    }
  }
}

export const notionConnector = new NotionConnector();
