// ============================================================
// Shared types — the common vocabulary every package/app in the
// monorepo imports from. Keeping this dependency-free (no pg,
// no SDKs) so it can be imported anywhere without pulling in
// runtime code.
// ============================================================

export type ToolName = 'slack' | 'jira' | 'gmail' | 'salesforce' | 'notion';

export type ResourceType = 'channel' | 'project' | 'mailbox' | 'object' | 'page';

export type AccessLevel = 'read' | 'write' | 'admin';

export interface ToolPermission {
  tool: ToolName;
  resourceType: ResourceType;
  resourceId: string;
  accessLevel: AccessLevel;
}

export interface ActingUser {
  id: string;
  organizationId: string;
  email: string;
  role: 'super_admin' | 'owner' | 'admin' | 'member' | 'viewer';
  displayName?: string;
  isVerified?: boolean;
  isSuspended?: boolean;
  permissions: ToolPermission[];
}

// ---------- Retrieval ----------

export interface VectorMatch {
  id: string;
  score: number;
  text: string;
  metadata: Record<string, unknown>;
}

export interface GraphNode {
  id: string;
  label: string; // 'Person' | 'Project' | 'Issue' | 'Client' | ...
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  relationship: string; // 'ASSIGNED_TO' | 'PERTAINS_TO' | 'MEMBER_OF' | ...
  properties?: Record<string, unknown>;
}

export interface GraphTraversalResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RetrievedContext {
  vectorMatches: VectorMatch[];
  graph: GraphTraversalResult;
}

// ---------- Intent classification ----------

export type QueryIntent = 'read' | 'action';

export interface ClassifiedIntent {
  intent: QueryIntent;
  confidence: number;
  rationale: string;
}

// ---------- Planning / tool execution ----------

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ToolCall {
  tool: ToolName;
  action: string; // e.g. 'sendEmail', 'createIssue', 'postMessage'
  input: Record<string, unknown>;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
}

export interface ToolCallResult {
  tool: ToolName;
  action: string;
  ok: boolean;
  output?: unknown;
  error?: string;
  mocked: boolean;
}

export interface AgentPlan {
  intent: ClassifiedIntent;
  reasoning: string;
  toolCalls: ToolCall[];
  responseDraft: string;
}

export interface AgentTurnResult {
  reply: string;
  plan: AgentPlan;
  executedCalls: ToolCallResult[];
  pendingApprovalIds: string[];
}

// ---------- Approvals ----------

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalRequest {
  id: string;
  organizationId: string;
  tool: ToolName;
  action: string;
  riskLevel: RiskLevel;
  input: Record<string, unknown>;
  status: ApprovalStatus;
  requestedByUserId?: string;
  createdAt: string;
}

// ---------- High-consequence action policy ----------
// Central source of truth for what requires human approval.
// Both the planner and the tool execution engine consult this.

export const HIGH_CONSEQUENCE_ACTIONS: Record<ToolName, string[]> = {
  gmail: ['sendEmail', 'deleteEmail'],
  slack: ['postMessageExternalChannel', 'deleteMessage'],
  jira: ['deleteIssue', 'transitionIssue'],
  salesforce: ['deleteRecord', 'updateRecord', 'createOpportunity'],
  notion: [],
};

export function isHighConsequence(tool: ToolName, action: string): boolean {
  return HIGH_CONSEQUENCE_ACTIONS[tool]?.includes(action) ?? false;
}
