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
  /** Enterprise OS execution trace (optional — additive) */
  workflow?: WorkflowTrace;
}

// ---------- Enterprise AI OS workflow layer ----------

export type WorkflowKind =
  | 'launch_workflow'
  | 'incident_workflow'
  | 'standup_workflow'
  | 'reminder_workflow'
  | 'workspace_intelligence'
  | 'notion_project'
  | 'simple_action'
  | 'read_only';

export interface OsIntent {
  kind: WorkflowKind;
  confidence: number;
  rationale: string;
  /** Legacy read/action mapping for existing planner compatibility */
  legacyIntent: QueryIntent;
  entities: Record<string, string>;
}

export interface WorkflowStepResult {
  stepId: string;
  tool: ToolName;
  action: string;
  status: 'success' | 'retryable_failure' | 'fatal_failure' | 'skipped' | 'healed';
  attempts: number;
  durationMs: number;
  error?: string;
  healActions?: string[];
  verified?: boolean;
  output?: unknown;
}

/** Structured operational decision metadata (not model chain-of-thought). */
export interface RoutingDecisionRecord {
  requestMode: 'execute' | 'clarify' | 'cancel' | 'dry_run' | 'question';
  intentKind: WorkflowKind;
  intentFamily: string;
  /** Locked primary tool when routing is authoritative */
  lockedTool?: ToolName | null;
  /** Locked action when routing is authoritative */
  lockedAction?: string | null;
  /** Extracted entities (project, summary, issueKey, vendor, …) */
  entities?: Record<string, string>;
  ambiguous?: boolean;
  allowedTools: ToolName[];
  selectedTools: Array<{ tool: ToolName; action: string }>;
  strippedTools: Array<{ tool: ToolName; action: string; reason: string }>;
  missingFields: string[];
  validation: 'passed' | 'needs_info' | 'blocked' | 'cancelled' | 'dry_run';
  execution: 'queued_approval' | 'executed' | 'skipped' | 'not_started';
  rationale: string;
}

export interface WorkflowTrace {
  intent: OsIntent;
  reasoning: string[];
  planSteps: string[];
  steps: WorkflowStepResult[];
  retries: number;
  durationMs: number;
  memoryKeys?: string[];
  decision?: RoutingDecisionRecord;
}

// ---------- Approvals ----------

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

/** Post-decision execution lifecycle for Approve & run. */
export type ApprovalExecutionStatus =
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'partially_completed';

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
  /** SHA-256 of canonical bound action (tool+action+scope+payload). */
  payloadFingerprint?: string;
  /** ISO expiry — Approve & run must fail after this. */
  expiresAt?: string;
  executionStatus?: ApprovalExecutionStatus;
  executionResult?: ToolCallResult;
  executionVerified?: boolean;
  executedAt?: string;
  decidedByUserId?: string;
  decidedAt?: string;
}

// ---------- High-consequence action policy ----------
// Central source of truth for what requires human approval.
// Both the planner and the tool execution engine consult this.

export const HIGH_CONSEQUENCE_ACTIONS: Record<ToolName, string[]> = {
  gmail: ['sendEmail', 'deleteEmail'],
  // Slack writes that mutate shared workspaces must pause for human review.
  // createWarRoom / createIncident create channels + invites + posts — never auto-run.
  slack: [
    'postMessage',
    'postMessageExternalChannel',
    'deleteMessage',
    'updateMessage',
    'createChannel',
    'inviteUsers',
    'createWarRoom',
    'createIncident',
    'uploadFile',
    'createCanvas',
    'openDm',
    'followUpPendingReplies',
    'scheduleReminder',
    'setChannelTopic',
    'setChannelPurpose',
    'pinMessage',
    'createBookmark',
  ],
  // Ticket creates/changes pause for human review (Approvals risk dial + Approve & run).
  jira: [
    'createIssue',
    'updateIssue',
    'deleteIssue',
    'transitionIssue',
    'addComment',
    'linkIssues',
    'addAttachment',
  ],
  salesforce: ['deleteRecord', 'updateRecord', 'createOpportunity'],
  // Notion writes pause so a human confirms parent/workspace before create.
  notion: [
    'createPage',
    'createDatabase',
    'createProject',
    'createPRD',
    'createWiki',
    'createMeetingNotes',
    'createRoadmap',
    'deletePage',
    'publishPage',
  ],
};

export function isHighConsequence(tool: ToolName, action: string): boolean {
  return HIGH_CONSEQUENCE_ACTIONS[tool]?.includes(action) ?? false;
}

/** Org policy templates — Work Action OS trust layer (not chatbot free-for-all). */
export type ApprovalPolicyId = 'strict_human_gate' | 'ops_fast_lane' | 'read_mostly';

export interface ApprovalPolicyTemplate {
  id: ApprovalPolicyId;
  name: string;
  description: string;
  /** Extra actions to always gate beyond HIGH_CONSEQUENCE_ACTIONS */
  alwaysGate?: Array<{ tool: ToolName; action: string }>;
  /** Actions that may auto-run even if listed high (ops fast lane only) */
  autoApprove?: Array<{ tool: ToolName; action: string }>;
}

export const APPROVAL_POLICY_TEMPLATES: ApprovalPolicyTemplate[] = [
  {
    id: 'strict_human_gate',
    name: 'Strict human gate',
    description: 'Every write to Slack, Notion, or Jira waits for Approve & run. Default for serious teams.',
  },
  {
    id: 'ops_fast_lane',
    name: 'Ops fast lane',
    description: 'Still gates deletes and external posts; Notion page creates can auto-run for trusted ops.',
    autoApprove: [{ tool: 'notion', action: 'createPage' }],
  },
  {
    id: 'read_mostly',
    name: 'Read-mostly',
    description: 'Maximum caution — gates all HIGH_CONSEQUENCE actions with no auto-approve exceptions.',
  },
];

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicyId = 'strict_human_gate';

export function policyAllowsAutoRun(
  policyId: ApprovalPolicyId,
  tool: ToolName,
  action: string
): boolean {
  const policy = APPROVAL_POLICY_TEMPLATES.find((p) => p.id === policyId);
  if (!policy?.autoApprove?.length) return false;
  return policy.autoApprove.some((a) => a.tool === tool && a.action === action);
}
