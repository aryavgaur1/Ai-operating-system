import type { ApprovalRequest, ApprovalStatus, ToolCall } from '@enterprise-ai-os/shared';
import { randomUUID } from 'crypto';

// ============================================================
// Approval Store — pending human-in-the-loop approvals for
// high-consequence tool calls (send email to external client,
// delete a record, transition/delete a Jira issue, etc).
//
// InMemoryApprovalStore is used by default so the API is runnable
// without a database. A production deployment should back this
// with the `approvals` table in db/schema.sql (see the commented
// PostgresApprovalStore sketch below) so approvals survive a
// server restart and are auditable.
// ============================================================

export interface ApprovalStore {
  create(organizationId: string, toolCall: ToolCall, requestedByUserId?: string): Promise<ApprovalRequest>;
  get(id: string): Promise<ApprovalRequest | undefined>;
  list(organizationId: string, status?: ApprovalStatus): Promise<ApprovalRequest[]>;
  decide(id: string, decision: 'approved' | 'rejected', decidedByUserId?: string): Promise<ApprovalRequest | undefined>;
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

  async list(organizationId: string, status?: ApprovalStatus): Promise<ApprovalRequest[]> {
    return [...this.items.values()].filter(
      (a) => a.organizationId === organizationId && (!status || a.status === status)
    );
  }

  async decide(
    id: string,
    decision: 'approved' | 'rejected',
    decidedByUserId?: string
  ): Promise<ApprovalRequest | undefined> {
    const existing = this.items.get(id);
    if (!existing) return undefined;
    const updated: ApprovalRequest = { ...existing, status: decision };
    this.items.set(id, updated);
    return updated;
  }
}

/*
// ---- Postgres-backed implementation (sketch) ----
// import { query } from '@enterprise-ai-os/stores';
//
// export class PostgresApprovalStore implements ApprovalStore {
//   async create(organizationId, toolCall, requestedByUserId) {
//     const { rows } = await query(
//       `insert into approvals (organization_id, requested_by_user_id, tool, action, risk_level, input)
//        values ($1,$2,$3,$4,$5,$6) returning *`,
//       [organizationId, requestedByUserId, toolCall.tool, toolCall.action, toolCall.riskLevel, toolCall.input]
//     );
//     return rows[0];
//   }
//   // ...get / list / decide follow the same pattern against the approvals table
// }
*/

let instance: ApprovalStore | null = null;

export function getApprovalStore(): ApprovalStore {
  if (!instance) instance = new InMemoryApprovalStore();
  return instance;
}
