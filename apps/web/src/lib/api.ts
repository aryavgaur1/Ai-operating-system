// ============================================================
// API client helper — every call goes through NEXT_PUBLIC_API_URL
// and sends a demo x-user-id header so the API's RBAC middleware
// has someone to authenticate as. Swap this for real session-based
// auth (cookies/JWT) once a login flow exists.
// ============================================================

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'user-meera',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request to ${path} failed with ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface ToolCallResult {
  tool: string;
  action: string;
  ok: boolean;
  output?: unknown;
  error?: string;
  mocked: boolean;
}

export interface AgentTurnResult {
  reply: string;
  plan: {
    intent: { intent: 'read' | 'action'; confidence: number; rationale: string };
    reasoning: string;
    toolCalls: { tool: string; action: string; input: Record<string, unknown>; riskLevel: string; requiresApproval: boolean }[];
    responseDraft: string;
  };
  executedCalls: ToolCallResult[];
  pendingApprovalIds: string[];
}

export interface ApprovalRequest {
  id: string;
  organizationId: string;
  tool: string;
  action: string;
  riskLevel: 'low' | 'medium' | 'high';
  input: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: string;
}

export interface IntegrationStatus {
  tool: string;
  status: string;
  mode: string;
  availableActions: string[];
}

export const api = {
  sendMessage: (message: string) => request<AgentTurnResult>('/chat', { method: 'POST', body: JSON.stringify({ message }) }),
  listApprovals: (status?: string) => request<{ approvals: ApprovalRequest[] }>(`/approvals${status ? `?status=${status}` : ''}`),
  decideApproval: (id: string, decision: 'approved' | 'rejected') =>
    request<{ approval: ApprovalRequest; executionResult?: ToolCallResult }>(`/approvals/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),
  listIntegrations: () => request<{ tools: IntegrationStatus[] }>('/integrations'),
};
