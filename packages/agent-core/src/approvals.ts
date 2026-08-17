import type {
  ApprovalExecutionStatus,
  ApprovalRequest,
  ApprovalStatus,
  ToolCall,
  ToolCallResult,
} from '@enterprise-ai-os/shared';
import { randomUUID } from 'crypto';
import { query } from '@enterprise-ai-os/stores';
import {
  approvalAuditDetail,
  approvalTtlMs,
  computeApprovalFingerprint,
  isApprovalExpired,
  type ApprovalAuditEvent,
} from './os/approvalIntegrity';

export interface ApprovalCreateOptions {
  /** Originating chat conversation (continuity). Does not replace integrity checks. */
  conversationId?: string;
}

export interface ApprovalStore {
  create(
    organizationId: string,
    toolCall: ToolCall,
    requestedByUserId?: string,
    options?: ApprovalCreateOptions
  ): Promise<ApprovalRequest>;
  get(id: string): Promise<ApprovalRequest | undefined>;
  list(organizationId: string, status?: ApprovalStatus, userId?: string): Promise<ApprovalRequest[]>;
  listAll(status?: ApprovalStatus): Promise<ApprovalRequest[]>;
  /** Update payload while still pending — recomputes integrity fingerprint. */
  updateInput(id: string, input: Record<string, unknown>): Promise<ApprovalRequest | undefined>;
  decide(id: string, decision: 'approved' | 'rejected', decidedByUserId?: string): Promise<ApprovalRequest | undefined>;
  claimForExecution(id: string, decidedByUserId?: string): Promise<ApprovalRequest | undefined>;
  completeExecution(
    id: string,
    result: ToolCallResult,
    verified: boolean
  ): Promise<ApprovalRequest | undefined>;
  /** Mark pending approval expired when past TTL. */
  markExpired(id: string): Promise<ApprovalRequest | undefined>;
}

function parseInput(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      // ignore
    }
  }
  return {};
}

function mapRow(row: any): ApprovalRequest {
  return {
    id: row.id,
    organizationId: row.organization_id,
    tool: row.tool,
    action: row.action,
    riskLevel: row.risk_level,
    input: parseInput(row.input),
    status: row.status,
    requestedByUserId: row.requested_by_user_id ?? undefined,
    conversationId: row.conversation_id ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    payloadFingerprint: row.payload_fingerprint ?? undefined,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : undefined,
    executionStatus: (row.execution_status as ApprovalExecutionStatus | null) ?? undefined,
    executionResult: row.execution_result ?? undefined,
    executionVerified: row.execution_verified ?? undefined,
    executedAt: row.executed_at ? new Date(row.executed_at).toISOString() : undefined,
    decidedByUserId: row.decided_by_user_id ?? undefined,
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : undefined,
  };
}

async function writeAudit(
  organizationId: string,
  userId: string | undefined,
  event: ApprovalAuditEvent,
  approval: ApprovalRequest,
  extra?: Record<string, unknown>
): Promise<void> {
  if ((process.env.SAAS_MODE ?? 'true') !== 'true' || !process.env.DATABASE_URL) return;
  try {
    await query(
      `insert into audit_logs (organization_id, user_id, event_type, tool, detail)
       values ($1, $2, $3, $4, $5::jsonb)`,
      [
        organizationId,
        userId ?? null,
        event,
        approval.tool,
        JSON.stringify(approvalAuditDetail(approval, extra)),
      ]
    );
  } catch (err) {
    console.warn('[approvals] audit_log skipped:', err instanceof Error ? err.message : err);
  }
}

function expiresAtIso(from = Date.now()): string {
  return new Date(from + approvalTtlMs()).toISOString();
}

export class PostgresApprovalStore implements ApprovalStore {
  async create(
    organizationId: string,
    toolCall: ToolCall,
    requestedByUserId?: string,
    options?: ApprovalCreateOptions
  ): Promise<ApprovalRequest> {
    const fingerprint = computeApprovalFingerprint(toolCall.tool, toolCall.action, toolCall.input);
    const expiresAt = expiresAtIso();
    const conversationId =
      options?.conversationId ||
      (typeof toolCall.input?._conversationId === 'string' ? String(toolCall.input._conversationId) : undefined) ||
      null;
    const { rows } = await query(
      `insert into approvals (
         organization_id, requested_by_user_id, conversation_id, tool, action, risk_level, input,
         payload_fingerprint, expires_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning *`,
      [
        organizationId,
        requestedByUserId ?? null,
        conversationId,
        toolCall.tool,
        toolCall.action,
        toolCall.riskLevel,
        JSON.stringify(toolCall.input),
        fingerprint,
        expiresAt,
      ]
    );
    const created = mapRow(rows[0]);
    void writeAudit(organizationId, requestedByUserId, 'approval.created', created);
    return created;
  }

  async get(id: string): Promise<ApprovalRequest | undefined> {
    const { rows } = await query(`select * from approvals where id = $1`, [id]);
    if (!rows[0]) return undefined;
    let approval = mapRow(rows[0]);
    if (approval.status === 'pending' && !approval.payloadFingerprint) {
      const fp = computeApprovalFingerprint(approval.tool, approval.action, approval.input);
      const exp = approval.expiresAt ?? expiresAtIso(Date.parse(approval.createdAt) || Date.now());
      await query(
        `update approvals set payload_fingerprint = $1, expires_at = coalesce(expires_at, $2::timestamptz)
         where id = $3 and status = 'pending'`,
        [fp, exp, id]
      );
      approval = { ...approval, payloadFingerprint: fp, expiresAt: approval.expiresAt ?? exp };
    }
    if (approval.status === 'pending' && isApprovalExpired(approval)) {
      const expired = await this.markExpired(id);
      if (expired) approval = expired;
    }
    return approval;
  }

  async list(organizationId: string, status?: ApprovalStatus, userId?: string): Promise<ApprovalRequest[]> {
    const params: unknown[] = [organizationId];
    let sql = `select * from approvals where organization_id = $1`;
    if (status) {
      params.push(status);
      sql += ` and status = $${params.length}`;
    }
    if (userId) {
      params.push(userId);
      sql += ` and requested_by_user_id = $${params.length}`;
    }
    sql += ` order by created_at desc`;
    const { rows } = await query(sql, params);
    const mapped = rows.map(mapRow);
    // Lazy-expire pending rows in list view
    for (const a of mapped) {
      if (a.status === 'pending' && isApprovalExpired(a)) {
        await this.markExpired(a.id);
      }
    }
    const refreshed = await query(sql, params);
    return refreshed.rows.map(mapRow);
  }

  async listAll(status?: ApprovalStatus): Promise<ApprovalRequest[]> {
    const params: unknown[] = [];
    let sql = `select * from approvals`;
    if (status) {
      params.push(status);
      sql += ` where status = $1`;
    }
    sql += ` order by created_at desc limit 200`;
    const { rows } = await query(sql, params);
    return rows.map(mapRow);
  }

  async updateInput(id: string, input: Record<string, unknown>): Promise<ApprovalRequest | undefined> {
    const existing = await this.get(id);
    if (!existing || existing.status !== 'pending') return undefined;
    if (isApprovalExpired(existing)) {
      await this.markExpired(id);
      return undefined;
    }
    const fingerprint = computeApprovalFingerprint(existing.tool, existing.action, input);
    const { rows } = await query(
      `update approvals set input = $1::jsonb, payload_fingerprint = $2
       where id = $3 and status = 'pending'
       returning *`,
      [JSON.stringify(input), fingerprint, id]
    );
    if (!rows[0]) return undefined;
    const updated = mapRow(rows[0]);
    void writeAudit(updated.organizationId, updated.requestedByUserId, 'approval.updated', updated);
    return updated;
  }

  async decide(id: string, decision: 'approved' | 'rejected', decidedByUserId?: string): Promise<ApprovalRequest | undefined> {
    if (decision === 'approved') {
      return this.claimForExecution(id, decidedByUserId);
    }
    const { rows } = await query(
      `update approvals set status = 'rejected', decided_by_user_id = $1, decided_at = now(),
        execution_status = 'cancelled'
       where id = $2 and status = 'pending'
       returning *`,
      [decidedByUserId ?? null, id]
    );
    if (!rows[0]) return undefined;
    const updated = mapRow(rows[0]);
    void writeAudit(updated.organizationId, decidedByUserId, 'approval.rejected', updated);
    return updated;
  }

  async claimForExecution(id: string, decidedByUserId?: string): Promise<ApprovalRequest | undefined> {
    // Expire-before-claim
    const current = await this.get(id);
    if (!current) return undefined;
    if (current.status === 'expired' || (current.status === 'pending' && isApprovalExpired(current))) {
      await this.markExpired(id);
      return undefined;
    }
    const { rows } = await query(
      `update approvals set status = 'approved', decided_by_user_id = $1, decided_at = now(),
        execution_status = 'executing'
       where id = $2 and status = 'pending'
         and (expires_at is null or expires_at > now())
       returning *`,
      [decidedByUserId ?? null, id]
    );
    if (!rows[0]) return undefined;
    const claimed = mapRow(rows[0]);
    void writeAudit(claimed.organizationId, decidedByUserId, 'approval.approved', claimed);
    void writeAudit(claimed.organizationId, decidedByUserId, 'approval.execution_started', claimed);
    return claimed;
  }

  async completeExecution(
    id: string,
    result: ToolCallResult,
    verified: boolean
  ): Promise<ApprovalRequest | undefined> {
    const status: ApprovalExecutionStatus = result.ok && verified && !result.mocked ? 'completed' : 'failed';
    const { rows } = await query(
      `update approvals set execution_status = $1, execution_result = $2::jsonb,
        execution_verified = $3, executed_at = now()
       where id = $4
       returning *`,
      [status, JSON.stringify(result), verified && result.ok && !result.mocked, id]
    );
    if (!rows[0]) return undefined;
    const done = mapRow(rows[0]);
    void writeAudit(
      done.organizationId,
      done.decidedByUserId,
      status === 'completed' ? 'approval.execution_completed' : 'approval.execution_failed',
      done,
      { ok: result.ok, mocked: result.mocked, verified }
    );
    return done;
  }

  async markExpired(id: string): Promise<ApprovalRequest | undefined> {
    const { rows } = await query(
      `update approvals set status = 'expired', execution_status = coalesce(execution_status, 'cancelled')
       where id = $1 and status = 'pending'
       returning *`,
      [id]
    );
    if (!rows[0]) return undefined;
    const expired = mapRow(rows[0]);
    void writeAudit(expired.organizationId, expired.requestedByUserId, 'approval.expired', expired);
    return expired;
  }
}

export class InMemoryApprovalStore implements ApprovalStore {
  private items: Map<string, ApprovalRequest> = new Map();

  async create(
    organizationId: string,
    toolCall: ToolCall,
    requestedByUserId?: string,
    options?: ApprovalCreateOptions
  ): Promise<ApprovalRequest> {
    const conversationId =
      options?.conversationId ||
      (typeof toolCall.input?._conversationId === 'string' ? String(toolCall.input._conversationId) : undefined);
    const request: ApprovalRequest = {
      id: randomUUID(),
      organizationId,
      tool: toolCall.tool,
      action: toolCall.action,
      riskLevel: toolCall.riskLevel,
      input: toolCall.input,
      status: 'pending',
      requestedByUserId,
      conversationId,
      createdAt: new Date().toISOString(),
      payloadFingerprint: computeApprovalFingerprint(toolCall.tool, toolCall.action, toolCall.input),
      expiresAt: expiresAtIso(),
    };
    this.items.set(request.id, request);
    return request;
  }

  async get(id: string): Promise<ApprovalRequest | undefined> {
    const existing = this.items.get(id);
    if (!existing) return undefined;
    if (existing.status === 'pending' && isApprovalExpired(existing)) {
      return (await this.markExpired(id)) ?? existing;
    }
    return existing;
  }

  async list(organizationId: string, status?: ApprovalStatus, userId?: string): Promise<ApprovalRequest[]> {
    for (const a of this.items.values()) {
      if (a.organizationId === organizationId && a.status === 'pending' && isApprovalExpired(a)) {
        await this.markExpired(a.id);
      }
    }
    return [...this.items.values()].filter(
      (a) =>
        a.organizationId === organizationId &&
        (!status || a.status === status) &&
        (!userId || a.requestedByUserId === userId)
    );
  }

  async listAll(status?: ApprovalStatus): Promise<ApprovalRequest[]> {
    return [...this.items.values()].filter((a) => !status || a.status === status);
  }

  async updateInput(id: string, input: Record<string, unknown>): Promise<ApprovalRequest | undefined> {
    const existing = await this.get(id);
    if (!existing || existing.status !== 'pending') return undefined;
    const updated: ApprovalRequest = {
      ...existing,
      input: { ...input },
      payloadFingerprint: computeApprovalFingerprint(existing.tool, existing.action, input),
    };
    this.items.set(id, updated);
    return updated;
  }

  async decide(id: string, decision: 'approved' | 'rejected', decidedByUserId?: string): Promise<ApprovalRequest | undefined> {
    if (decision === 'approved') return this.claimForExecution(id, decidedByUserId);
    const existing = await this.get(id);
    if (!existing || existing.status !== 'pending') return undefined;
    const updated: ApprovalRequest = {
      ...existing,
      status: 'rejected',
      decidedByUserId,
      decidedAt: new Date().toISOString(),
      executionStatus: 'cancelled',
    };
    this.items.set(id, updated);
    return updated;
  }

  async claimForExecution(id: string, decidedByUserId?: string): Promise<ApprovalRequest | undefined> {
    const existing = this.items.get(id);
    if (!existing || existing.status !== 'pending') return undefined;
    if (isApprovalExpired(existing)) {
      return (await this.markExpired(id)) && undefined;
    }
    // Single-tick claim — concurrent Promise.all sees only one winner
    const updated: ApprovalRequest = {
      ...existing,
      status: 'approved',
      decidedByUserId,
      decidedAt: new Date().toISOString(),
      executionStatus: 'executing',
    };
    this.items.set(id, updated);
    return updated;
  }

  async completeExecution(
    id: string,
    result: ToolCallResult,
    verified: boolean
  ): Promise<ApprovalRequest | undefined> {
    const existing = this.items.get(id);
    if (!existing) return undefined;
    const executionStatus: ApprovalExecutionStatus =
      result.ok && verified && !result.mocked ? 'completed' : 'failed';
    const updated: ApprovalRequest = {
      ...existing,
      executionStatus,
      executionResult: result,
      executionVerified: verified && result.ok && !result.mocked,
      executedAt: new Date().toISOString(),
    };
    this.items.set(id, updated);
    return updated;
  }

  async markExpired(id: string): Promise<ApprovalRequest | undefined> {
    const existing = this.items.get(id);
    if (!existing || existing.status !== 'pending') return undefined;
    const updated: ApprovalRequest = {
      ...existing,
      status: 'expired',
      executionStatus: existing.executionStatus ?? 'cancelled',
    };
    this.items.set(id, updated);
    return updated;
  }
}

let instance: ApprovalStore | null = null;

/** Test-only: reset singleton between integrity tests. */
export function resetApprovalStoreForTests(): void {
  instance = null;
}

export function getApprovalStore(): ApprovalStore {
  if (!instance) {
    instance =
      (process.env.SAAS_MODE ?? 'true') === 'true' && process.env.DATABASE_URL
        ? new PostgresApprovalStore()
        : new InMemoryApprovalStore();
  }
  return instance;
}

/** Test helper: force in-memory store. */
export function useInMemoryApprovalStoreForTests(): InMemoryApprovalStore {
  const store = new InMemoryApprovalStore();
  instance = store;
  return store;
}
