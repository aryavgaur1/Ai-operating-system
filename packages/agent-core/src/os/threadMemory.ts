import { query } from '@enterprise-ai-os/stores';

// ============================================================
// STEP 8 — Thread / workspace memory
// Persist owners, channels, links, tasks, decisions so follow-up
// prompts reuse context instead of re-asking.
// ============================================================

export interface MemoryRecord {
  organizationId: string;
  userId?: string;
  key: string;
  value: Record<string, unknown>;
}

const memoryCache = new Map<string, Record<string, unknown>>();

function cacheKey(orgId: string, key: string) {
  return `${orgId}::${key}`;
}

export async function remember(input: MemoryRecord): Promise<void> {
  memoryCache.set(cacheKey(input.organizationId, input.key), {
    ...input.value,
    updatedAt: new Date().toISOString(),
    userId: input.userId,
  });
  try {
    await query(
      `insert into agent_memory (organization_id, user_id, memory_key, value, updated_at)
       values ($1, $2, $3, $4::jsonb, now())
       on conflict (organization_id, memory_key)
       do update set value = excluded.value, user_id = coalesce(excluded.user_id, agent_memory.user_id), updated_at = now()`,
      [input.organizationId, input.userId ?? null, input.key, JSON.stringify(input.value)]
    );
  } catch (err) {
    // Table may not exist yet — in-memory still works
    console.warn('[agent_memory] persist skipped:', err instanceof Error ? err.message : err);
  }
}

export async function recall(organizationId: string, key: string): Promise<Record<string, unknown> | null> {
  const hit = memoryCache.get(cacheKey(organizationId, key));
  if (hit) return hit;
  try {
    const res = await query<{ value: Record<string, unknown> }>(
      `select value from agent_memory where organization_id = $1 and memory_key = $2 limit 1`,
      [organizationId, key]
    );
    const value = res.rows[0]?.value ?? null;
    if (value) memoryCache.set(cacheKey(organizationId, key), value);
    return value;
  } catch {
    return null;
  }
}

/** Recent memory rows for context pack (bounded — never dumps the whole table). */
export async function listRecentMemory(
  organizationId: string,
  limit = 8
): Promise<Array<{ key: string; value: Record<string, unknown> }>> {
  try {
    const res = await query<{ memory_key: string; value: Record<string, unknown> }>(
      `select memory_key, value from agent_memory
       where organization_id = $1
       order by updated_at desc
       limit $2`,
      [organizationId, limit]
    );
    return res.rows.map((r) => ({ key: r.memory_key, value: r.value }));
  } catch {
    // Fallback: in-memory cache for this org
    const out: Array<{ key: string; value: Record<string, unknown> }> = [];
    const prefix = `${organizationId}::`;
    for (const [k, v] of memoryCache.entries()) {
      if (!k.startsWith(prefix)) continue;
      out.push({ key: k.slice(prefix.length), value: v });
      if (out.length >= limit) break;
    }
    return out;
  }
}

export async function rememberFromExecution(
  organizationId: string,
  userId: string | undefined,
  queryText: string,
  executed: Array<{ tool: string; action: string; ok: boolean; output?: unknown }>
): Promise<string[]> {
  const keys: string[] = [];
  for (const call of executed) {
    if (!call.ok) continue;
    const out = (call.output || {}) as Record<string, unknown>;
    if (call.action === 'createWarRoom' || call.action === 'createIncident' || call.action === 'createChannel') {
      const ch = (out.channel || out) as { id?: string; name?: string };
      const key = `slack:channel:${ch.name || ch.id || 'latest'}`;
      await remember({
        organizationId,
        userId,
        key,
        value: { channelId: ch.id || out.id, channelName: ch.name || out.name, query: queryText, action: call.action },
      });
      keys.push(key);
    }
    if (call.tool === 'notion' && (out.id || out.url)) {
      const key = `notion:page:${String(out.id || 'latest')}`;
      await remember({
        organizationId,
        userId,
        key,
        value: { pageId: out.id, url: out.url, query: queryText, action: call.action },
      });
      keys.push(key);
    }
    if (out.summary) {
      const key = `intel:${call.action}:latest`;
      await remember({
        organizationId,
        userId,
        key,
        value: { summary: out.summary, query: queryText, action: call.action },
      });
      keys.push(key);
    }
  }
  return keys;
}
