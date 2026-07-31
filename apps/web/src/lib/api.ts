const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'nexora_access_token';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const token = body?.data?.accessToken || body?.data?.token || body?.accessToken;
    if (token) setAccessToken(token);
    return token ?? null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
    cache: 'no-store',
  });

  if (res.status === 401 && retry && path !== '/auth/login' && path !== '/auth/refresh') {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request<T>(path, init, false);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.message || body.error || `Request to ${path} failed with ${res.status}`);
  }
  // Support both legacy raw JSON and { success, data } envelopes
  if (body && typeof body === 'object' && 'data' in body && ('success' in body || 'error' in body)) {
    return (body.data ?? body) as T;
  }
  return body as T;
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
  conversationId?: string;
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
  connectUrl?: string | null;
  canConnect?: boolean;
}

export interface HealthCheck {
  ok: boolean;
  service: string;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  organizationId: string;
  isVerified: boolean;
  isSuspended: boolean;
}

export const api = {
  signup: (payload: Record<string, unknown>) =>
    request<{ token: string; accessToken: string; user: AuthUser }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  login: (payload: Record<string, unknown>) =>
    request<{ token: string; accessToken: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  logout: () => request<null>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: AuthUser; profile: any; workspace: any }>('/auth/me'),
  updateMe: (payload: Record<string, unknown>) =>
    request<null>('/auth/me', { method: 'PATCH', body: JSON.stringify(payload) }),
  changePassword: (payload: Record<string, unknown>) =>
    request<null>('/auth/change-password', { method: 'POST', body: JSON.stringify(payload) }),
  changeEmail: (payload: Record<string, unknown>) =>
    request<null>('/auth/change-email', { method: 'POST', body: JSON.stringify(payload) }),
  deleteAccount: (password: string) =>
    request<null>('/auth/me', { method: 'DELETE', body: JSON.stringify({ password }) }),
  completeOnboarding: (payload: Record<string, unknown>) =>
    request<null>('/auth/onboarding/complete', { method: 'POST', body: JSON.stringify(payload) }),
  forgotPassword: (email: string) =>
    request<null>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, newPassword: string) =>
    request<null>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword }) }),
  verifyEmail: (token: string) =>
    request<null>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
  resendVerification: () => request<null>('/auth/resend-verification', { method: 'POST' }),
  loginHistory: () => request<{ history: any[] }>('/auth/login-history'),
  sessions: () => request<{ sessions: any[] }>('/auth/sessions'),

  sendMessage: (message: string, conversationId?: string) =>
    request<AgentTurnResult>('/chat', {
      method: 'POST',
      body: JSON.stringify({ message, conversationId }),
    }),
  listConversations: () => request<{ conversations: any[] }>('/conversations'),
  getConversation: (id: string) => request<{ conversation: any; messages: any[] }>(`/conversations/${id}`),
  updateConversation: (id: string, payload: Record<string, unknown>) =>
    request<{ conversation: any }>(`/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteConversation: (id: string) => request<null>(`/conversations/${id}`, { method: 'DELETE' }),

  listApprovals: (status?: string) =>
    request<{ approvals: ApprovalRequest[] }>(`/approvals${status ? `?status=${status}` : ''}`),
  decideApproval: (id: string, decision: 'approved' | 'rejected') =>
    request<{ approval: ApprovalRequest; executionResult?: ToolCallResult }>(`/approvals/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),
  listIntegrations: () => request<{ tools: IntegrationStatus[] }>('/integrations'),
  disconnectIntegration: (tool: string) =>
    request<null>(`/integrations/${tool}/disconnect`, { method: 'POST' }),
  getDashboard: () => request<any>('/dashboard'),
  getHealth: () => request<HealthCheck>('/health'),

  adminMetrics: () => request<any>('/admin/metrics'),
  adminUsers: (search?: string) =>
    request<{ users: any[] }>(`/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  adminUserDetail: (id: string) => request<any>(`/admin/users/${id}/detail`),
  adminSuspend: (id: string, suspended: boolean) =>
    request<any>(`/admin/users/${id}/suspend`, { method: 'POST', body: JSON.stringify({ suspended }) }),
  adminVerify: (id: string) => request<any>(`/admin/users/${id}/verify`, { method: 'POST' }),
  adminSetRole: (id: string, role: string) =>
    request<any>(`/admin/users/${id}/role`, { method: 'POST', body: JSON.stringify({ role }) }),
  adminDeleteUser: (id: string) => request<any>(`/admin/users/${id}`, { method: 'DELETE' }),
  adminResetPassword: (id: string) =>
    request<null>(`/admin/users/${id}/reset-password`, { method: 'POST' }),
  adminIntegrations: () => request<{ connections: any[] }>('/admin/integrations'),
  adminAudit: () => request<{ events: any[] }>('/admin/audit'),
};

export function googleLoginUrl() {
  return `${API_URL}/auth/google/start`;
}
