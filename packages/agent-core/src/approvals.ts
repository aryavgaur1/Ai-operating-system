import type { ApprovalRequest, ApprovalStatus, ToolCall } from '@enterprise-ai-os/shared';
import { randomUUID } from 'crypto';
import { query } from '@enterprise-ai-os/stores';

export interface ApprovalStore {
  create(organizationId: string, toolCall: ToolCall, requestedByUserId?: string): Promise<ApprovalRequest>;
  get(id: string): Promise<ApprovalRequest | undefined>;
  list(organizationId: string, status?: ApprovalStatus, userId?: string): Promise<ApprovalRequest[]>;
  listAll(status?: ApprovalStatus): Promise<ApprovalRequest[]>;
  decide(id: string, decision: 'approved' | 'rejected', decidedByUserId?: string): Promise<ApprovalRequest | undefined>;
}

function mapRow(row: any): ApprovalRequest {
  return {
    id: row.id,
    organizationId: row.organization_id,
    tool: row.tool,
    action: row.action,
    riskLevel: row.risk_level,
    input: row.input,
    status: row.status,
    requestedByUserId: row.requested_by_user_id ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class PostgresApprovalStore implements ApprovalStore {
  async create(organizationId: string, toolCall: ToolCall, requestedByUserId?: string): Promise<ApprovalRequest> {
    const { rows } = await query(
      `insert into approvals (organization_id, requested_by_user_id, tool, action, risk_level, input)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [organizationId, requestedByUserId ?? null, toolCall.tool, toolCall.action, toolCall.riskLevel, JSON.stringify(toolCall.input)]
    );
    return mapRow(rows[0]);
  }

  async get(id: string): Promise<ApprovalRequest | undefined> {
    const { rows } = await query(`select * from approvals where id = $1`, [id]);
    return rows[0] ? mapRow(rows[0]) : undefined;
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
    return rows.map(mapRow);
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

  async decide(id: string, decision: 'approved' | 'rejected', decidedByUserId?: string): Promise<ApprovalRequest | undefined> {
    const { rows } = await query(
      `update approvals set status = $1, decided_by_user_id = $2, decided_at = now()
       where id = $3 returning *`,
      [decision, decidedByUserId ?? null, id]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  }
}

export class InMemoryApprovalStore implements ApprovalStore {
  private items: Map<string, ApprovalRequest> = new Map();

  async create(organizationId: string, toolCall: ToolCall, requestedByUserId?: string): Promise<ApprovalRequest> {
    const request: ApprovalRequest = {
      id: randomUUID(),
      organizationId,
      tool: toolCall.tool,
      action: toolCall.action,
      riskLevel: toolCall.riskLevel,
      input: toolCall.input,
      status: 'pending',
      requestedByUserId,
      createdAt: new Date().toISOString(),
    };
    this.items.set(request.id, request);
    return request;
  }

  async get(id: string): Promise<ApprovalRequest | undefined> {
    return this.items.get(id);
  }

  async list(organizationId: string, status?: ApprovalStatus, userId?: string): Promise<ApprovalRequest[]> {
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

  async decide(id: string, decision: 'approved' | 'rejected', _decidedByUserId?: string): Promise<ApprovalRequest | undefined> {
    const existing = this.items.get(id);
    if (!existing) return undefined;
    const updated: ApprovalRequest = { ...existing, status: decision };
    this.items.set(id, updated);
    return updated;
  }
}

let instance: ApprovalStore | null = null;

export function getApprovalStore(): ApprovalStore {
  if (!instance) {
    instance =
      (process.env.SAAS_MODE ?? 'true') === 'true' && process.env.DATABASE_URL
        ? new PostgresApprovalStore()
        : new InMemoryApprovalStore();
  }
  return instance;
}
