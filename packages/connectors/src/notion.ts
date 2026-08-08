import { Client } from '@notionhq/client';
import type { ToolCallResult } from '@enterprise-ai-os/shared';
import { simulateLatency, isLiveMode, type ToolConnector, type FetchPage, type NormalizedDoc } from './base';
import { getConnectorContext } from './context';

// ============================================================
// Notion Connector
// Live wiring: @notionhq/client, authorized via a Notion
// Internal Integration token (NOTION_API_KEY) or per-request
// OAuth token from ConnectorContext (SaaS).
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

let _client: Client | null = null;
let _clientAuth: string | null = null;

function resolveNotionAuth(explicit?: string): string {
  const ctx = getConnectorContext();
  const fromCtx = ctx.notionToken?.trim();
  if (explicit?.trim()) return explicit.trim();
  if (fromCtx) return fromCtx;
  if (ctx.saasStrict) {
    throw new Error('Notion is not connected for this workspace. Connect Notion under Integrations to continue.');
  }
  const env = process.env.NOTION_API_KEY?.trim();
  if (!env) {
    throw new Error(
      'Notion is not connected. Connect Notion in Integrations, or set NOTION_API_KEY in .env for demo/platform use.'
    );
  }
  return env;
}

/** Initialize Notion client with per-user OAuth token when provided; otherwise ALS / .env. */
export function initializeNotionClient(token?: string): Client {
  const auth = resolveNotionAuth(token);
  if (_client && _clientAuth === auth) return _client;
  _client = new Client({ auth });
  _clientAuth = auth;
  return _client;
}

export function clearNotionClient(): void {
  _client = null;
  _clientAuth = null;
}

function getClient(): Client {
  return initializeNotionClient();
}

/**
 * Resolve a parent page/database for creates.
 * Prefer explicit input → (demo-only) NOTION_DATABASE_ID → first page/DB the token can see.
 * Never use a global NOTION_DATABASE_ID for SaaS OAuth users — that ID belongs to another workspace.
 * OAuth integrations cannot create orphan workspace roots.
 */
async function resolveParentId(client: Client, explicit?: string): Promise<string> {
  const fromInput = explicit?.trim();
  if (fromInput) return fromInput;

  const ctx = getConnectorContext();
  const usingUserOAuth = Boolean(ctx.notionToken?.trim()) || Boolean(ctx.saasStrict);
  const fromEnv = process.env.NOTION_DATABASE_ID?.trim();

  // Demo/platform only: env parent is safe when we are NOT using a per-user OAuth token.
  if (fromEnv && !usingUserOAuth) {
    return fromEnv;
  }

  // If env parent is set in mixed mode, only use it when this token can actually read it.
  if (fromEnv && !ctx.saasStrict) {
    try {
      await client.databases.retrieve({ database_id: fromEnv });
      return fromEnv;
    } catch {
      try {
        await client.pages.retrieve({ page_id: fromEnv });
        return fromEnv;
      } catch {
        // Fall through to search — common when env ID is founder-only.
      }
    }
  }

  const pageSearch = await client.search({
    filter: { property: 'object', value: 'page' },
    page_size: 25,
  });
  const pages = (pageSearch.results as any[]) ?? [];
  const preferredPage = pages.find((p) => /nexora/i.test(extractTitle(p)));
  if (preferredPage?.id) return preferredPage.id as string;
  if (pages[0]?.id) return pages[0].id as string;

  const dbSearch = await client.search({
    filter: { property: 'object', value: 'database' },
    page_size: 25,
  });
  const databases = (dbSearch.results as any[]) ?? [];
  const preferredDb = databases.find((d) => /nexora/i.test(extractTitle(d)));
  if (preferredDb?.id) return preferredDb.id as string;
  if (databases[0]?.id) return databases[0].id as string;

  throw new Error(
    'Notion has no shared parent page for Nexora yet. During Connect, select at least one page (or in Notion open a page → ··· → Connections → add Nexora), then try again from Integrations.'
  );
}

/** Pulls the plain-text title out of whatever property type Notion gives us. */
function extractTitle(page: any): string {
  const props = page.properties ?? {};
  for (const key of Object.keys(props)) {
    const prop = props[key];
    if (prop?.type === 'title' && Array.isArray(prop.title)) {
      return prop.title.map((t: any) => t.plain_text).join('') || 'Untitled';
    }
  }
  return 'Untitled';
}

async function findPageByTitle(client: Client, title: string): Promise<any | null> {
  const response = await client.search({
    query: title,
    filter: { property: 'object', value: 'page' },
    page_size: 20,
  });

  const normalizedTitle = title.trim().toLowerCase();
  const matched = (response.results as any[]).find((page) => extractTitle(page).trim().toLowerCase() === normalizedTitle);
  return matched || ((response.results as any[])[0] ?? null);
}

/** Fetches a page's block content and flattens it into plain text. */
async function fetchPageText(client: Client, pageId: string): Promise<string> {
  const blocks = await client.blocks.children.list({ block_id: pageId, page_size: 50 });
  const chunks: string[] = [];
  for (const block of blocks.results as any[]) {
    const rich = block[block.type]?.rich_text;
    if (Array.isArray(rich)) {
      const text = rich.map((t: any) => t.plain_text).join('');
      if (text) chunks.push(text);
    }
  }
  return chunks.join('\n');
}

async function buildCreateProperties(client: Client, parentId: string, title: string): Promise<{ properties: Record<string, any>; isDatabase: boolean }> {
  if (!parentId) {
    return { properties: { title: { title: [{ text: { content: title } }] } }, isDatabase: false };
  }

  try {
    const database = await client.databases.retrieve({ database_id: parentId });
    const properties = (database as any).properties ?? {};
    const titleProperty = Object.keys(properties).find((key) => (properties[key] as any)?.type === 'title');
    if (titleProperty) {
      return { properties: { [titleProperty]: { title: [{ text: { content: title } }] } }, isDatabase: true };
    }
    return { properties: { title: { title: [{ text: { content: title } }] } }, isDatabase: true };
  } catch {
    // Fall back to the default page-style title property.
    return { properties: { title: { title: [{ text: { content: title } }] } }, isDatabase: false };
  }
}

function buildChildrenBlocks(input: Record<string, unknown>) {
  const body = String(input.body ?? '').trim();
  if (!body) return undefined;

  const template = String(input.template ?? 'doc');
  if (template === 'task' || body.startsWith('- [ ]')) {
    const lines = body.split(/\r?\n/).filter((line) => line.trim());
    return lines.map((line) => {
      const text = line.replace(/^-\s*\[\s*\]\s*/i, '').trim();
      return {
        object: 'block' as const,
        type: 'to_do' as const,
        to_do: {
          rich_text: [{ type: 'text' as const, text: { content: text } }],
          checked: false,
        },
      };
    });
  }

  if (template === 'meeting') {
    return [
      {
        object: 'block' as const,
        type: 'heading_2' as const,
        heading_2: {
          rich_text: [{ type: 'text' as const, text: { content: 'Meeting Notes' } }],
        },
      },
      ...body.split(/\r?\n/).map((line) => ({
        object: 'block' as const,
        type: 'paragraph' as const,
        paragraph: { rich_text: [{ type: 'text' as const, text: { content: line } }] },
      })),
    ];
  }

  if (template === 'summary') {
    return [
      {
        object: 'block' as const,
        type: 'heading_2' as const,
        heading_2: {
          rich_text: [{ type: 'text' as const, text: { content: 'Summary' } }],
        },
      },
      {
        object: 'block' as const,
        type: 'paragraph' as const,
        paragraph: { rich_text: [{ type: 'text' as const, text: { content: body } }] },
      },
    ];
  }

  return [
    {
      object: 'block' as const,
      type: 'paragraph' as const,
      paragraph: { rich_text: [{ type: 'text' as const, text: { content: body } }] },
    },
  ];
}

class NotionConnector implements ToolConnector {
  tool = 'notion' as const;

  async fetchRecent(sinceCursor?: string): Promise<FetchPage> {
    if (isLiveMode('notion')) {
      const client = getClient();
      const response = await client.search({
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        start_cursor: sinceCursor,
        page_size: 25,
        filter: { property: 'object', value: 'page' },
      });

      const items: NormalizedDoc[] = [];
      for (const page of response.results as any[]) {
        const text = await fetchPageText(client, page.id).catch(() => '');
        items.push({
          externalId: page.id,
          resourceType: 'page',
          title: extractTitle(page),
          url: page.url,
          text,
          metadata: {
            lastEditedTime: page.last_edited_time,
            createdTime: page.created_time,
          },
        });
      }

      return { items, nextCursor: response.has_more ? response.next_cursor ?? undefined : undefined };
    }

    await simulateLatency();
    return { items: MOCK_PAGES, nextCursor: undefined };
  }

  async handleWebhook(_payload: unknown): Promise<NormalizedDoc[]> {
    // Notion has no native webhooks for content changes — ingestion
    // for this connector relies solely on fetchRecent() batch polling.
    return [];
  }

  listActions(): string[] {
    return [
      'createPage',
      'createDatabase',
      'publishPage',
      'deletePage',
      'searchPages',
      'searchDatabases',
      'createProject',
      'createMeetingNotes',
      'createPRD',
      'createWiki',
      'createRoadmap',
    ];
  }

  async execute(action: string, input: Record<string, unknown>): Promise<ToolCallResult> {
    if (isLiveMode('notion')) {
      const client = getClient();
      try {
        switch (action) {
          case 'createPage': {
            const parentId = await resolveParentId(client, input.parentPageId as string | undefined);

            const title = String(input.title ?? 'Untitled');
            const propsResult = await buildCreateProperties(client, parentId, title);
            const properties = propsResult.properties;
            const children = buildChildrenBlocks(input);
            const useDatabase = Boolean(input.useDatabase) || propsResult.isDatabase || /\b(database|db|table|board|kanban)\b/i.test(String(input.template ?? ''));

            let page: any;
            try {
              page = await (client.pages.create as any)({
                parent: useDatabase ? { database_id: parentId } : { page_id: parentId },
                properties,
                children,
              });
            } catch (err: any) {
              const message = String(err?.message ?? err?.code ?? '');
              if (message.includes('not a database') || message.includes('Use the pages API') || message.includes('database_id')) {
                page = await (client.pages.create as any)({
                  parent: { page_id: parentId },
                  properties: { title: { title: [{ text: { content: title } }] } },
                  children,
                });
              } else {
                throw err;
              }
            }

            if (!page?.id) {
              return {
                tool: 'notion',
                action,
                ok: false,
                error: 'Notion createPage returned no page id — refusing fake success',
                mocked: false,
              };
            }
            console.log(`[notion.createPage] REAL ok id=${page.id} url=${(page as any).url ?? ''}`);
            return { tool: 'notion', action, ok: true, output: { id: page.id, url: (page as any).url }, mocked: false };
          }

          case 'createDatabase': {
            const parentId = await resolveParentId(client, input.parentPageId as string | undefined);

            const title = String(input.title ?? 'Untitled Database');
            const database = await (client.databases.create as any)({
              parent: { type: 'page_id', page_id: parentId },
              title: [{ type: 'text', text: { content: title } }],
              properties: {
                Name: { title: {} },
                Description: { rich_text: {} },
              },
            });

            return { tool: 'notion', action, ok: true, output: { id: database.id, url: (database as any).url }, mocked: false };
          }

          case 'publishPage': {
            let pageId = input.pageId as string | undefined;
            const title = input.title as string | undefined;
            if (!pageId) {
              if (!title) throw new Error('pageId or title is required to publish a page');
              const page = await findPageByTitle(client, title);
              if (!page) throw new Error(`No Notion page found with title "${title}"`);
              pageId = page.id;
            }
            // Notion has no separate "publish" flag via the API for private pages;
            // this simply confirms the page is not archived (i.e. active/visible).
            const page = await client.pages.update({ page_id: pageId as string, archived: false });
            return { tool: 'notion', action, ok: true, output: { id: page.id, applied: true }, mocked: false };
          }

          case 'deletePage': {
            let pageId = input.pageId as string | undefined;
            const title = input.title as string | undefined;
            if (!pageId) {
              if (!title) throw new Error('pageId or title is required to delete a page');
              const page = await findPageByTitle(client, title);
              if (!page) throw new Error(`No Notion page found with title "${title}"`);
              pageId = page.id;
            }
            const page = await client.pages.update({ page_id: pageId as string, archived: true });
            return { tool: 'notion', action, ok: true, output: { id: page.id, applied: true }, mocked: false };
          }

          case 'searchPages': {
            const q = String(input.query ?? input.title ?? '');
            const response = await client.search({
              query: q,
              filter: { property: 'object', value: 'page' },
              page_size: Number(input.limit ?? 20),
            });
            const results = (response.results as any[]).map((p) => ({
              id: p.id,
              title: extractTitle(p),
              url: p.url,
            }));
            return { tool: 'notion', action, ok: true, output: { results, count: results.length }, mocked: false };
          }

          case 'searchDatabases': {
            const q = String(input.query ?? input.title ?? '');
            const response = await client.search({
              query: q,
              page_size: Number(input.limit ?? 20),
            } as any);
            const results = (response.results as any[])
              .filter((p) => p.object === 'database')
              .map((p) => ({
                id: p.id,
                title: extractTitle(p),
                url: p.url,
              }));
            return { tool: 'notion', action, ok: true, output: { results, count: results.length }, mocked: false };
          }

          case 'createProject':
          case 'createMeetingNotes':
          case 'createPRD':
          case 'createWiki':
          case 'createRoadmap': {
            const parentId = await resolveParentId(client, input.parentPageId as string | undefined);
            const templates: Record<string, string> = {
              createProject: 'Project',
              createMeetingNotes: 'Meeting Notes',
              createPRD: 'PRD',
              createWiki: 'Wiki',
              createRoadmap: 'Roadmap',
            };
            const title = String(input.title ?? `${templates[action]} ${new Date().toISOString().slice(0, 10)}`);
            const defaultBodies: Record<string, string> = {
              createProject: `## Mission\n\n## Owners\n\n## Milestones\n- [ ]\n\n## Risks\n`,
              createMeetingNotes: `## Attendees\n\n## Agenda\n\n## Notes\n\n## Action items\n- [ ]\n`,
              createPRD: `## Problem\n\n## Goals\n\n## Requirements\n\n## Non-goals\n\n## Success metrics\n`,
              createWiki: `## Overview\n\n## How it works\n\n## FAQ\n`,
              createRoadmap: `## Now\n\n## Next\n\n## Later\n`,
            };
            const body = String(input.body ?? defaultBodies[action] ?? '');
            const propsResult = await buildCreateProperties(client, parentId, title);
            const children = buildChildrenBlocks({ body, template: action.replace('create', '').toLowerCase() });
            let page: any;
            try {
              page = await (client.pages.create as any)({
                parent: propsResult.isDatabase ? { database_id: parentId } : { page_id: parentId },
                properties: propsResult.properties,
                children,
              });
            } catch (err: any) {
              const message = String(err?.message ?? '');
              if (message.includes('not a database') || message.includes('database_id')) {
                page = await (client.pages.create as any)({
                  parent: { page_id: parentId },
                  properties: { title: { title: [{ text: { content: title } }] } },
                  children,
                });
              } else {
                throw err;
              }
            }
            if (!page?.id) {
              return { tool: 'notion', action, ok: false, error: 'Notion returned no page id', mocked: false };
            }
            console.log(`[notion.${action}] REAL ok id=${page.id}`);
            return { tool: 'notion', action, ok: true, output: { id: page.id, url: (page as any).url, title }, mocked: false };
          }

          default:
            return { tool: 'notion', action, ok: false, error: `Unknown action: ${action}`, mocked: false };
        }
      } catch (err: any) {
        return { tool: 'notion', action, ok: false, error: err?.message ?? String(err), mocked: false };
      }
    }

    await simulateLatency();
    console.warn(`[MOCK notion.${action}] blocked from reporting fake success — NOTION_MODE is not live`);
    return {
      tool: 'notion',
      action,
      ok: false,
      error:
        'Notion is in MOCK mode. Set NOTION_MODE=live and NOTION_API_KEY in .env — refusing to fake a successful create.',
      mocked: true,
    };
  }
}

export const notionConnector = new NotionConnector();
