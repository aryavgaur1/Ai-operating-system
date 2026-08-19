const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'nexora_access_token';
const REFRESH_KEY = 'nexora_refresh_token';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function setAccessToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function setRefreshToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(REFRESH_KEY, token);
  else localStorage.removeItem(REFRESH_KEY);
}

export function clearSession() {
  setAccessToken(null);
  setRefreshToken(null);
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    const refreshToken = getRefreshToken();
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const data = body?.data ?? body;
    const token = data?.accessToken || data?.token;
    const nextRefresh = data?.refreshToken;
    if (token) setAccessToken(token);
    if (nextRefresh) setRefreshToken(nextRefresh);
    return token ?? null;
  } catch {
    return null;
  }
}

function redirectToLogin() {
  if (typeof window === 'undefined') return;
  clearSession();
  const path = window.location.pathname;
  const next =
    path.startsWith('/app') || path.startsWith('/invite/')
      ? `?next=${encodeURIComponent(path)}`
      : '';
  window.location.href = `/login${next}`;
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

  if (res.status === 401 && retry && path !== '/auth/login' && path !== '/auth/refresh' && path !== '/auth/signup') {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request<T>(path, init, false);
    // Session truly dead — bounce to login (except when already on auth pages)
    if (
      typeof window !== 'undefined' &&
      (window.location.pathname.startsWith('/app') || window.location.pathname.startsWith('/invite/'))
    ) {
      redirectToLogin();
    }
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
  sources?: string[];
}

export type ChatStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'status'; message: string }
  | { type: 'tool_start'; tool: string; action: string }
  | { type: 'tool_result'; tool: string; action: string; ok: boolean; error?: string }
  | { type: 'approval'; ids: string[] }
  | { type: 'done'; result: AgentTurnResult }
  | { type: 'conversation'; conversationId: string }
  | { type: 'error'; message: string }
  | { type: 'end' };

async function readChatStream(
  res: Response,
  opts: {
    conversationId?: string;
    onEvent: (event: ChatStreamEvent) => void;
  }
): Promise<AgentTurnResult | null> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response stream');
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: AgentTurnResult | null = null;
  let conversationId = opts.conversationId;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        const event = JSON.parse(line.slice(5).trim()) as ChatStreamEvent;
        if (event.type === 'done') finalResult = event.result;
        if (event.type === 'conversation') conversationId = event.conversationId;
        opts.onEvent(event);
      } catch {
        // ignore malformed chunk
      }
    }
  }

  if (finalResult && conversationId) finalResult.conversationId = conversationId;
  return finalResult;
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
  conversationId?: string;
  requestedByUserId?: string;
  payloadFingerprint?: string;
  expiresAt?: string;
  executionStatus?: 'executing' | 'completed' | 'failed' | 'cancelled' | 'partially_completed';
  executionResult?: ToolCallResult;
  executionVerified?: boolean;
  executedAt?: string;
}

export interface IntegrationStatus {
  tool: string;
  status: string;
  mode: string;
  implementation?: string;
  availableActions: string[];
  connectUrl?: string | null;
  canConnect?: boolean;
  workspaceName?: string;
  workspaceId?: string;
  workspaceIcon?: string;
  connectedAt?: string;
  lastUsedAt?: string;
  lastSync?: string;
  botToken?: boolean;
  userToken?: boolean;
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

export type WorkspaceKind = 'personal' | 'team';
export type MembershipRole = 'owner' | 'admin' | 'member';
export type MembershipStatus = 'active' | 'inactive' | 'removed';

export interface WorkspaceListItem {
  id: string;
  name: string;
  slug: string;
  kind: WorkspaceKind;
  role: MembershipRole;
  status: MembershipStatus;
  isPersonalHome: boolean;
  isActive: boolean;
}

export interface WorkspaceContextDto {
  organizationId: string;
  name: string;
  slug: string;
  kind: WorkspaceKind;
  role: MembershipRole;
  status: MembershipStatus;
  isPersonalHome: boolean;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  kind: WorkspaceKind;
  role: MembershipRole;
  status: MembershipStatus;
  isPersonalHome: boolean;
}

export interface WorkspaceMember {
  userId: string;
  email: string;
  displayName: string | null;
  role: MembershipRole;
  status: MembershipStatus;
  createdAt: string;
}

export interface InvitationPublic {
  id: string;
  organizationId: string;
  email: string;
  role: MembershipRole;
  status: string;
  expiresAt: string;
  invitedByUserId: string;
  invitedByEmail?: string | null;
  invitedByDisplayName?: string | null;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  createdAt: string;
}

export interface InvitationPreview {
  invitationId: string;
  organizationId: string;
  organizationName: string;
  organizationKind: string;
  email: string;
  role: MembershipRole;
  status: string;
  expiresAt: string;
  expired: boolean;
  acceptable: boolean;
}

export interface EmailDeliveryResult {
  delivered: boolean;
  mode: 'gmail_api' | 'console_fallback' | 'failed';
  errorCode?: string;
  profile?: string;
  hint?: string;
}

function persistSessionTokens(data: { accessToken?: string; token?: string; refreshToken?: string }) {
  const access = data.accessToken || data.token;
  if (access) setAccessToken(access);
  if (data.refreshToken) setRefreshToken(data.refreshToken);
}

export const api = {
  signup: async (payload: Record<string, unknown>) => {
    const data = await request<{ token: string; accessToken: string; refreshToken?: string; user: AuthUser }>(
      '/auth/signup',
      { method: 'POST', body: JSON.stringify(payload) }
    );
    persistSessionTokens(data);
    return data;
  },
  login: async (payload: Record<string, unknown>) => {
    const data = await request<{ token: string; accessToken: string; refreshToken?: string; user: AuthUser }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify(payload) }
    );
    persistSessionTokens(data);
    return data;
  },
  logout: async () => {
    try {
      await request<null>('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: getRefreshToken() }),
      });
    } finally {
      clearSession();
    }
    return null;
  },
  me: () =>
    request<{
      user: AuthUser;
      profile: any;
      workspace: WorkspaceSummary | null;
      homeOrganizationId?: string;
    }>('/auth/me'),
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

  sendMessage: (message: string, conversationId?: string, attachmentIds?: string[]) =>
    request<AgentTurnResult>('/chat', {
      method: 'POST',
      body: JSON.stringify({ message, conversationId, attachmentIds }),
    }),

  /** Streaming chat via SSE. Calls onEvent for each server event. */
  streamMessage: async (
    message: string,
    opts: {
      conversationId?: string;
      attachmentIds?: string[];
      signal?: AbortSignal;
      onEvent: (event: ChatStreamEvent) => void;
    }
  ): Promise<AgentTurnResult | null> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API_URL}/chat`, {
      method: 'POST',
      headers,
      credentials: 'include',
      signal: opts.signal,
      body: JSON.stringify({
        message,
        conversationId: opts.conversationId,
        attachmentIds: opts.attachmentIds,
        stream: true,
      }),
    });

    if (res.status === 401) {
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        redirectToLogin();
        throw new Error('Unauthorized');
      }
      headers.Authorization = `Bearer ${refreshed}`;
      const retry = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers,
        credentials: 'include',
        signal: opts.signal,
        body: JSON.stringify({
          message,
          conversationId: opts.conversationId,
          attachmentIds: opts.attachmentIds,
          stream: true,
        }),
      });
      if (!retry.ok) {
        const body = await retry.json().catch(() => ({}));
        throw new Error(body.message || body.error || `Chat stream failed (${retry.status})`);
      }
      return readChatStream(retry, opts);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || body.error || `Chat stream failed (${res.status})`);
    }

    return readChatStream(res, opts);
  },

  uploadChatFile: async (file: File) => {
    const headers: Record<string, string> = {};
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_URL}/chat/upload`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || body.error || 'Upload failed');
    const data = body?.data ?? body;
    return data.attachment as {
      id: string;
      filename: string;
      mimeType?: string;
      hasText: boolean;
      error?: string;
    };
  },

  listConversations: () => request<{ conversations: any[] }>('/conversations'),
  resumeConversation: () =>
    request<{ conversationId: string | null; source: 'active' | 'recent' | 'none' }>('/conversations/resume'),
  activateConversation: (id: string) =>
    request<{ conversationId: string }>(`/conversations/${encodeURIComponent(id)}/activate`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  createConversation: (title?: string) =>
    request<{ conversation: { id: string; title: string } }>('/conversations', {
      method: 'POST',
      body: JSON.stringify(title ? { title } : {}),
    }),
  getConversation: (id: string) => request<{ conversation: any; messages: any[] }>(`/conversations/${id}`),
  updateConversation: (id: string, payload: Record<string, unknown>) =>
    request<{ conversation: any }>(`/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteConversation: (id: string) => request<null>(`/conversations/${id}`, { method: 'DELETE' }),

  listApprovals: (status?: string) =>
    request<{ approvals: ApprovalRequest[] }>(`/approvals${status ? `?status=${status}` : ''}`),
  updateApprovalInput: (id: string, input: Record<string, unknown>) =>
    request<{ approval: ApprovalRequest }>(`/approvals/${id}/input`, {
      method: 'PATCH',
      body: JSON.stringify({ input }),
    }),
  decideApproval: (id: string, decision: 'approved' | 'rejected', input?: Record<string, unknown>) =>
    request<{ approval: ApprovalRequest; executionResult?: ToolCallResult; idempotent?: boolean }>(
      `/approvals/${id}/decide`,
      {
        method: 'POST',
        body: JSON.stringify(input ? { decision, input } : { decision }),
      }
    ),
  listIntegrations: () => request<{ tools: IntegrationStatus[] }>('/integrations'),
  disconnectIntegration: (tool: string) =>
    request<null>(`/integrations/${tool}/disconnect`, { method: 'POST' }),
  connectNotionToken: (accessToken: string) =>
    request<{ connected: boolean; workspaceName?: string }>('/integrations/notion/connect-token', {
      method: 'POST',
      body: JSON.stringify({ accessToken }),
    }),
  getDashboard: () => request<any>('/dashboard'),
  getHealth: () => request<HealthCheck>('/health'),

  // ---- P0.5 workspaces / invitations (real backend only) ----
  listWorkspaces: () => request<{ workspaces: WorkspaceListItem[] }>('/workspaces'),
  currentWorkspace: () => request<{ workspace: WorkspaceContextDto }>('/workspaces/current'),
  createTeamWorkspace: (name: string) =>
    request<{ workspace: WorkspaceListItem }>(
      '/workspaces',
      { method: 'POST', body: JSON.stringify({ name }) }
    ),
  activateWorkspace: async (organizationId: string) => {
    const data = await request<{
      workspace: WorkspaceContextDto;
      accessToken: string;
      refreshToken: string;
      token: string;
    }>(`/workspaces/${encodeURIComponent(organizationId)}/activate`, { method: 'POST' });
    persistSessionTokens(data);
    return data;
  },
  listWorkspaceMembers: (organizationId: string) =>
    request<{ members: WorkspaceMember[] }>(
      `/workspaces/${encodeURIComponent(organizationId)}/members`
    ),
  listInvitations: (organizationId: string) =>
    request<{ invitations: InvitationPublic[] }>(
      `/workspaces/${encodeURIComponent(organizationId)}/invitations`
    ),
  createInvitation: (
    organizationId: string,
    payload: { email: string; role: 'member' | 'admin' }
  ) =>
    request<{
      invitation: InvitationPublic;
      email: EmailDeliveryResult;
      acceptToken?: string;
    }>(`/workspaces/${encodeURIComponent(organizationId)}/invitations`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  revokeInvitation: (organizationId: string, invitationId: string) =>
    request<{ invitation: InvitationPublic }>(
      `/workspaces/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitationId)}/revoke`,
      { method: 'POST' }
    ),
  resendInvitation: (organizationId: string, invitationId: string) =>
    request<{
      invitation: InvitationPublic;
      email: EmailDeliveryResult;
      acceptToken?: string;
    }>(
      `/workspaces/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitationId)}/resend`,
      { method: 'POST' }
    ),
  previewInvitation: (token: string) =>
    request<{ invitation: InvitationPreview }>(`/invitations/${encodeURIComponent(token)}`),
  acceptInvitation: (token: string) =>
    request<{
      invitation: InvitationPublic;
      membership: {
        organizationId: string;
        userId: string;
        role: MembershipRole;
        status: 'active';
      };
      alreadyMember: boolean;
    }>(`/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST' }),

  renameWorkspace: (organizationId: string, name: string) =>
    request<{ workspace: { id: string; name: string; slug: string; kind: string } }>(
      `/workspaces/${encodeURIComponent(organizationId)}`,
      { method: 'PATCH', body: JSON.stringify({ name }) }
    ),
  updateMemberRole: (organizationId: string, userId: string, role: string) =>
    request<{ userId: string; role: string }>(
      `/workspaces/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
      { method: 'PATCH', body: JSON.stringify({ role }) }
    ),
  removeMember: (organizationId: string, userId: string) =>
    request<Record<string, never>>(
      `/workspaces/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    ),

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
  adminChatbotDocs: () => request<{ docs: any[]; ready: boolean }>('/admin/chatbot/docs'),
  adminChatbotReindex: () =>
    request<{ docs: number; chunks: number }>('/admin/chatbot/reindex', { method: 'POST' }),
  adminChatbotAnalytics: () => request<any>('/admin/chatbot/analytics'),
};

export function googleLoginUrl(next?: string | null) {
  const params = new URLSearchParams();
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : '';
  if (origin) params.set('returnOrigin', origin);
  const safeNext = typeof next === 'string' ? next.trim() : '';
  if (
    safeNext &&
    safeNext.startsWith('/') &&
    !safeNext.startsWith('//') &&
    (safeNext.startsWith('/app') || safeNext.startsWith('/invite/'))
  ) {
    params.set('next', safeNext);
  }
  const q = params.toString() ? `?${params.toString()}` : '';
  return `${API_URL}/auth/google/start${q}`;
}

export function oauthConnectUrl(tool: 'slack' | 'notion' | 'jira' | 'gmail'): string | null {
  const token = getAccessToken();
  if (!token) return null;
  return `${API_URL}/oauth/${tool}/start?token=${encodeURIComponent(token)}`;
}

export { API_URL };
