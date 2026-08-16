import { createHash } from 'crypto';
import type { ApprovalRequest, ToolName } from '@enterprise-ai-os/shared';
import { CAPABILITY_META, capabilityName, validateCapabilityExecution } from './capabilityRegistry';

/**
 * P0.3 — Approval integrity helpers.
 * Server-side binding of WHO / WHERE / WHAT / WITH WHAT / SCOPE / WHEN.
 * Not cryptographic signatures over a KMS — SHA-256 fingerprints of canonical JSON.
 */

export type ApprovalIntegrityCode =
  | 'APPROVAL_NOT_FOUND'
  | 'APPROVAL_NOT_AUTHORIZED'
  | 'APPROVAL_ALREADY_EXECUTED'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_INVALID_STATE'
  | 'APPROVAL_PAYLOAD_CHANGED'
  | 'APPROVAL_CAPABILITY_CHANGED'
  | 'APPROVAL_SCOPE_CHANGED'
  | 'CAPABILITY_NOT_ALLOWED'
  | 'CAPABILITY_UNKNOWN';

export class ApprovalIntegrityError extends Error {
  readonly code: ApprovalIntegrityCode;
  constructor(code: ApprovalIntegrityCode, message: string) {
    super(message);
    this.name = 'ApprovalIntegrityError';
    this.code = code;
  }
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function approvalTtlMs(): number {
  const raw = Number(process.env.APPROVAL_TTL_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_TTL_MS;
}

/** Recursive key-sorted JSON for stable fingerprints. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortValue(obj[key]);
  }
  return out;
}

/** Payload used for binding — includes capability stamps; drops UI-only lists. */
export function bindingPayload(input: Record<string, unknown> | undefined): Record<string, unknown> {
  const src = { ...(input || {}) };
  delete src._availableProjects;
  return src;
}

export function computeApprovalFingerprint(
  tool: ToolName | string,
  action: string,
  input: Record<string, unknown> | undefined
): string {
  const payload = bindingPayload(input);
  const scope = payload[CAPABILITY_META.scope];
  const binding = {
    tool,
    action,
    capability: capabilityName(tool, action),
    intentFamily: payload[CAPABILITY_META.family] ?? null,
    capabilityScope: Array.isArray(scope) ? [...scope].map(String).sort() : [],
    lockedCapability: payload[CAPABILITY_META.locked] ?? null,
    payload,
  };
  return createHash('sha256').update(canonicalJson(binding)).digest('hex');
}

export function isApprovalExpired(approval: Pick<ApprovalRequest, 'expiresAt' | 'status' | 'createdAt'>): boolean {
  if (approval.status === 'expired') return true;
  const exp = approval.expiresAt ? Date.parse(approval.expiresAt) : NaN;
  if (Number.isFinite(exp)) return Date.now() > exp;
  // Legacy rows without expiresAt: use createdAt + TTL
  const created = Date.parse(approval.createdAt);
  if (!Number.isFinite(created)) return false;
  return Date.now() > created + approvalTtlMs();
}

export type AuthUserLike = {
  id: string;
  organizationId: string;
  role?: string;
};

/** Ownership / workspace gate — uses existing auth roles only. */
export function assertApprovalAuthorized(
  approval: ApprovalRequest,
  user: AuthUserLike
): void {
  const isSuper = user.role === 'super_admin';
  const isAdmin = isSuper || user.role === 'admin';
  if (!isSuper && approval.organizationId !== user.organizationId) {
    throw new ApprovalIntegrityError('APPROVAL_NOT_AUTHORIZED', 'Approval belongs to another workspace.');
  }
  if (isAdmin) return;
  if (!approval.requestedByUserId) {
    throw new ApprovalIntegrityError(
      'APPROVAL_NOT_AUTHORIZED',
      'Approval has no owner — only an admin can act on it.'
    );
  }
  if (approval.requestedByUserId !== user.id) {
    throw new ApprovalIntegrityError(
      'APPROVAL_NOT_AUTHORIZED',
      'Only the requester (or an admin) can approve this action.'
    );
  }
}

export type IntegrityCheckOk = {
  ok: true;
  fingerprint: string;
  capability: string;
  intentFamily?: string;
};

/**
 * Full pre-execution integrity check. Throws ApprovalIntegrityError.
 * Must run BEFORE any connector.execute.
 */
export function assertApprovalExecutable(
  approval: ApprovalRequest,
  opts?: { expectedTool?: string; expectedAction?: string }
): IntegrityCheckOk {
  if (approval.status === 'rejected') {
    throw new ApprovalIntegrityError('APPROVAL_INVALID_STATE', 'Approval was rejected and cannot execute.');
  }
  if (isApprovalExpired(approval)) {
    throw new ApprovalIntegrityError('APPROVAL_EXPIRED', 'Approval has expired and cannot execute.');
  }
  if (approval.executionStatus === 'completed' || approval.executionStatus === 'failed') {
    throw new ApprovalIntegrityError('APPROVAL_ALREADY_EXECUTED', 'Approval already finished execution.');
  }

  if (approval.status !== 'approved' || approval.executionStatus !== 'executing') {
    throw new ApprovalIntegrityError(
      'APPROVAL_INVALID_STATE',
      `Approval is not executable (status=${approval.status}, execution=${approval.executionStatus ?? 'none'}).`
    );
  }

  const liveFp = computeApprovalFingerprint(approval.tool, approval.action, approval.input);
  const storedFp = approval.payloadFingerprint?.trim();
  if (!storedFp) {
    throw new ApprovalIntegrityError(
      'APPROVAL_PAYLOAD_CHANGED',
      'Approval is missing an integrity fingerprint — cannot execute safely.'
    );
  }
  if (liveFp !== storedFp) {
    throw new ApprovalIntegrityError(
      'APPROVAL_PAYLOAD_CHANGED',
      'Approved action payload or binding no longer matches the integrity fingerprint.'
    );
  }

  if (opts?.expectedTool && opts.expectedTool !== approval.tool) {
    throw new ApprovalIntegrityError('APPROVAL_CAPABILITY_CHANGED', 'Connector/tool mismatch.');
  }
  if (opts?.expectedAction && opts.expectedAction !== approval.action) {
    throw new ApprovalIntegrityError('APPROVAL_CAPABILITY_CHANGED', 'Capability/action mismatch.');
  }

  const call = {
    tool: approval.tool,
    action: approval.action,
    input: approval.input ?? {},
  };
  const gate = validateCapabilityExecution(call);
  if (!gate.ok) {
    throw new ApprovalIntegrityError(
      gate.code === 'CAPABILITY_UNKNOWN' ? 'CAPABILITY_UNKNOWN' : 'CAPABILITY_NOT_ALLOWED',
      gate.message
    );
  }

  // Scope stamp must still be present and match locked capability when locked
  const scope = approval.input?.[CAPABILITY_META.scope];
  if (!Array.isArray(scope) || scope.length === 0) {
    throw new ApprovalIntegrityError('APPROVAL_SCOPE_CHANGED', 'Capability scope missing from approval.');
  }
  const name = capabilityName(approval.tool, approval.action);
  if (!scope.map(String).includes(name)) {
    throw new ApprovalIntegrityError(
      'APPROVAL_SCOPE_CHANGED',
      'Capability is outside the scope stamped on this approval.'
    );
  }

  return {
    ok: true,
    fingerprint: liveFp,
    capability: name,
    intentFamily: typeof approval.input?.[CAPABILITY_META.family] === 'string'
      ? String(approval.input[CAPABILITY_META.family])
      : undefined,
  };
}

export type ApprovalAuditEvent =
  | 'approval.created'
  | 'approval.updated'
  | 'approval.approved'
  | 'approval.rejected'
  | 'approval.execution_started'
  | 'approval.execution_completed'
  | 'approval.execution_failed'
  | 'approval.expired';

/** Safe audit detail — never includes tokens/secrets. */
export function approvalAuditDetail(
  approval: ApprovalRequest,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return {
    approvalId: approval.id,
    organizationId: approval.organizationId,
    requestedByUserId: approval.requestedByUserId ?? null,
    tool: approval.tool,
    action: approval.action,
    capability: capabilityName(approval.tool, approval.action),
    intentFamily: approval.input?.[CAPABILITY_META.family] ?? null,
    status: approval.status,
    executionStatus: approval.executionStatus ?? null,
    payloadFingerprint: approval.payloadFingerprint ?? null,
    expiresAt: approval.expiresAt ?? null,
    ...extra,
  };
}
