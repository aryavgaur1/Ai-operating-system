import type { ToolCall, ToolName } from '@enterprise-ai-os/shared';
import { isHighConsequence } from '@enterprise-ai-os/shared';
import type { AuthoritativeRoute, IntentFamily } from './routingPolicy';

/**
 * Application-owned capability registry.
 * Natural language may propose tools; this registry + scope checks decide what may execute.
 * Only actions that exist on live connectors are registered — no fictional capabilities.
 */

export type ReadWriteClass = 'read' | 'write' | 'admin';
export type VerificationMethod = 'none' | 'get_created' | 'external_confirm';

export interface Capability {
  name: string;
  connector: ToolName;
  action: string;
  intentFamilies: IntentFamily[];
  readWriteClass: ReadWriteClass;
  requiredParameters: string[];
  approvalRequired: boolean;
  authorizationRequired: boolean;
  verificationMethod: VerificationMethod;
}

export interface CapabilityScope {
  family: IntentFamily;
  /** Capability names allowed for this turn, e.g. "jira.createIssue" */
  allowed: ReadonlySet<string>;
  lockedCapability?: string | null;
}

export const CAPABILITY_META = {
  family: '_intentFamily',
  scope: '_capabilityScope',
  locked: '_lockedCapability',
} as const;

type CapDef = {
  connector: ToolName;
  action: string;
  families: IntentFamily[];
  rw: ReadWriteClass;
  required?: string[];
  verify?: VerificationMethod;
};

/** Real connector actions only (see packages/connectors listActions / LIVE_ACTIONS). */
const DEFS: CapDef[] = [
  // —— Jira ——
  { connector: 'jira', action: 'createIssue', families: ['jira', 'incident', 'standup'], rw: 'write', required: ['summary'], verify: 'get_created' },
  { connector: 'jira', action: 'updateIssue', families: ['jira', 'incident', 'standup'], rw: 'write', required: ['issueKey'], verify: 'external_confirm' },
  { connector: 'jira', action: 'transitionIssue', families: ['jira', 'incident'], rw: 'write', required: ['issueKey'], verify: 'external_confirm' },
  { connector: 'jira', action: 'addComment', families: ['jira', 'incident', 'standup'], rw: 'write', required: ['issueKey'], verify: 'none' },
  { connector: 'jira', action: 'linkIssues', families: ['jira'], rw: 'write', required: ['issueKey'], verify: 'none' },
  { connector: 'jira', action: 'addAttachment', families: ['jira'], rw: 'write', required: ['issueKey'], verify: 'none' },
  { connector: 'jira', action: 'searchIssues', families: ['jira', 'incident', 'standup', 'read_only'], rw: 'read', verify: 'none' },
  { connector: 'jira', action: 'listBoards', families: ['jira', 'read_only'], rw: 'read', verify: 'none' },
  { connector: 'jira', action: 'listSprints', families: ['jira', 'read_only'], rw: 'read', verify: 'none' },
  { connector: 'jira', action: 'getSprintIssues', families: ['jira', 'standup', 'read_only'], rw: 'read', verify: 'none' },
  { connector: 'jira', action: 'deleteIssue', families: ['jira'], rw: 'admin', required: ['issueKey'], verify: 'external_confirm' },

  // —— Slack writes / workflows ——
  { connector: 'slack', action: 'postMessage', families: ['slack_write', 'launch', 'incident', 'standup', 'reminder'], rw: 'write', required: ['channel', 'text'], verify: 'external_confirm' },
  { connector: 'slack', action: 'postMessageExternalChannel', families: ['slack_write'], rw: 'write', verify: 'external_confirm' },
  { connector: 'slack', action: 'createChannel', families: ['slack_write', 'launch', 'incident'], rw: 'write', verify: 'external_confirm' },
  { connector: 'slack', action: 'inviteUsers', families: ['slack_write', 'launch', 'incident'], rw: 'write', verify: 'external_confirm' },
  { connector: 'slack', action: 'createWarRoom', families: ['launch', 'incident'], rw: 'write', verify: 'external_confirm' },
  { connector: 'slack', action: 'createIncident', families: ['incident'], rw: 'write', verify: 'external_confirm' },
  { connector: 'slack', action: 'uploadFile', families: ['slack_write', 'incident'], rw: 'write', verify: 'none' },
  { connector: 'slack', action: 'createCanvas', families: ['slack_write', 'launch'], rw: 'write', verify: 'none' },
  { connector: 'slack', action: 'scheduleReminder', families: ['reminder', 'slack_write'], rw: 'write', verify: 'none' },
  { connector: 'slack', action: 'followUpPendingReplies', families: ['reminder', 'slack_write'], rw: 'write', verify: 'none' },
  { connector: 'slack', action: 'setChannelTopic', families: ['slack_write', 'launch', 'incident'], rw: 'write', verify: 'none' },
  { connector: 'slack', action: 'setChannelPurpose', families: ['slack_write', 'launch', 'incident'], rw: 'write', verify: 'none' },
  { connector: 'slack', action: 'pinMessage', families: ['slack_write'], rw: 'write', verify: 'none' },
  { connector: 'slack', action: 'createBookmark', families: ['slack_write'], rw: 'write', verify: 'none' },
  { connector: 'slack', action: 'addReaction', families: ['slack_write'], rw: 'write', verify: 'none' },

  // —— Slack reads ——
  { connector: 'slack', action: 'listChannels', families: ['slack_read', 'slack_write', 'standup', 'read_only'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'listUsers', families: ['slack_read', 'slack_write', 'read_only'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'getChannelHistory', families: ['slack_read', 'standup', 'read_only'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'getThread', families: ['slack_read', 'read_only'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'searchHistory', families: ['slack_read', 'standup', 'read_only'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'searchMessages', families: ['slack_read', 'standup', 'read_only'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'summarizeChannel', families: ['slack_read', 'standup'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'summarizeThread', families: ['slack_read'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'listPins', families: ['slack_read'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'searchFiles', families: ['slack_read'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'findUsersByRole', families: ['slack_read'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'findBlockers', families: ['slack_read', 'standup'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'findUnansweredMessages', families: ['slack_read', 'reminder'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'findCustomerComplaints', families: ['slack_read'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'detectActionItems', families: ['slack_read', 'standup'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'dailyDigest', families: ['slack_read', 'standup'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'weeklyDigest', families: ['slack_read', 'standup'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'semanticSearch', families: ['slack_read', 'read_only'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'detectDeadChannels', families: ['slack_read'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'findDecision', families: ['slack_read'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'findOwner', families: ['slack_read'], rw: 'read', verify: 'none' },
  { connector: 'slack', action: 'generateMeetingNotes', families: ['slack_read', 'standup'], rw: 'read', verify: 'none' },

  // —— Notion ——
  { connector: 'notion', action: 'createPage', families: ['notion', 'launch', 'standup'], rw: 'write', verify: 'get_created' },
  { connector: 'notion', action: 'updatePage', families: ['notion', 'launch', 'standup'], rw: 'write', verify: 'external_confirm' },
  { connector: 'notion', action: 'createDatabaseEntry', families: ['notion', 'launch'], rw: 'write', verify: 'get_created' },
  { connector: 'notion', action: 'createDatabase', families: ['notion'], rw: 'write', verify: 'get_created' },
  { connector: 'notion', action: 'publishPage', families: ['notion'], rw: 'write', verify: 'none' },
  { connector: 'notion', action: 'deletePage', families: ['notion'], rw: 'admin', verify: 'external_confirm' },
  { connector: 'notion', action: 'searchPages', families: ['notion', 'standup', 'read_only'], rw: 'read', verify: 'none' },
  { connector: 'notion', action: 'searchDatabases', families: ['notion', 'read_only'], rw: 'read', verify: 'none' },
  { connector: 'notion', action: 'createProject', families: ['notion', 'launch'], rw: 'write', verify: 'get_created' },
  { connector: 'notion', action: 'createMeetingNotes', families: ['notion', 'standup'], rw: 'write', verify: 'get_created' },
  { connector: 'notion', action: 'createPRD', families: ['notion', 'launch'], rw: 'write', verify: 'get_created' },
  { connector: 'notion', action: 'createWiki', families: ['notion'], rw: 'write', verify: 'get_created' },
  { connector: 'notion', action: 'createRoadmap', families: ['notion', 'launch'], rw: 'write', verify: 'get_created' },

  // —— Gmail ——
  { connector: 'gmail', action: 'searchEmails', families: ['gmail_read', 'read_only'], rw: 'read', verify: 'none' },
  { connector: 'gmail', action: 'getEmail', families: ['gmail_read', 'read_only'], rw: 'read', verify: 'none' },
  { connector: 'gmail', action: 'getThread', families: ['gmail_read', 'read_only'], rw: 'read', verify: 'none' },
  { connector: 'gmail', action: 'sendEmail', families: ['gmail_write'], rw: 'write', verify: 'external_confirm' },
];

function toCapability(def: CapDef): Capability {
  return {
    name: `${def.connector}.${def.action}`,
    connector: def.connector,
    action: def.action,
    intentFamilies: def.families,
    readWriteClass: def.rw,
    requiredParameters: def.required ?? [],
    approvalRequired: isHighConsequence(def.connector, def.action),
    authorizationRequired: true,
    verificationMethod: def.verify ?? 'none',
  };
}

const REGISTRY: Map<string, Capability> = new Map(DEFS.map((d) => {
  const c = toCapability(d);
  return [c.name, c] as const;
}));

export function capabilityName(tool: ToolName | string, action: string): string {
  return `${tool}.${action}`;
}

export function getCapability(tool: ToolName | string, action: string): Capability | undefined {
  return REGISTRY.get(capabilityName(tool, action));
}

export function listCapabilities(filter?: {
  connector?: ToolName;
  family?: IntentFamily;
  readWriteClass?: ReadWriteClass;
}): Capability[] {
  let all = [...REGISTRY.values()];
  if (filter?.connector) all = all.filter((c) => c.connector === filter.connector);
  if (filter?.family) all = all.filter((c) => c.intentFamilies.includes(filter.family!));
  if (filter?.readWriteClass) all = all.filter((c) => c.readWriteClass === filter.readWriteClass);
  return all;
}

/** Build deterministic scope for a routed turn. */
export function buildCapabilityScope(route: Pick<AuthoritativeRoute, 'family' | 'lockedTool' | 'lockedAction' | 'ambiguous' | 'mode'>): CapabilityScope {
  const family = route.family;
  const lockedCapability =
    route.lockedTool && route.lockedAction
      ? capabilityName(route.lockedTool, route.lockedAction)
      : null;

  if (route.ambiguous || route.mode === 'cancel' || route.mode === 'clarify') {
    return { family, allowed: new Set(), lockedCapability };
  }

  if (family === 'meta' || family === 'general' || family === 'read_only') {
    // read_only: allow registered read caps only when explicitly useful — still empty by default
    // (chat read path uses retrieval, not connectors). Keep empty to match FAMILY_ALLOWLIST.
    return { family, allowed: new Set(), lockedCapability };
  }

  // Locked connector: entire connector family is in scope (create + search helpers),
  // never other connectors — blocks jira → slack.createWarRoom.
  if (route.lockedTool) {
    const allowed = new Set(
      listCapabilities({ connector: route.lockedTool }).map((c) => c.name)
    );
    return { family, allowed, lockedCapability };
  }

  const allowed = new Set(
    listCapabilities({ family }).map((c) => c.name)
  );
  return { family, allowed, lockedCapability };
}

export function isCapabilityAllowed(tool: ToolName | string, action: string, scope: CapabilityScope): boolean {
  const name = capabilityName(tool, action);
  if (!REGISTRY.has(name)) return false;
  return scope.allowed.has(name);
}

export type CapabilityGateResult =
  | { ok: true; capability: Capability; scope: CapabilityScope }
  | { ok: false; code: 'CAPABILITY_NOT_ALLOWED' | 'CAPABILITY_UNKNOWN'; message: string; capabilityName: string };

/**
 * Hard gate before any connector.execute.
 * Prefer stamped scope on the call; otherwise derive a same-connector-only scope (approve path).
 */
export function validateCapabilityExecution(
  call: Pick<ToolCall, 'tool' | 'action' | 'input'>,
  explicitScope?: CapabilityScope
): CapabilityGateResult {
  const name = capabilityName(call.tool, call.action);
  const capability = REGISTRY.get(name);
  if (!capability) {
    return {
      ok: false,
      code: 'CAPABILITY_UNKNOWN',
      capabilityName: name,
      message: `Unknown capability “${name}” — not registered for execution.`,
    };
  }

  const scope = explicitScope ?? scopeFromCallInput(call.input) ?? sameConnectorScope(call.tool);
  if (!scope.allowed.has(name)) {
    return {
      ok: false,
      code: 'CAPABILITY_NOT_ALLOWED',
      capabilityName: name,
      message: `Capability “${name}” is outside the authorized scope for this turn.`,
    };
  }

  return { ok: true, capability, scope };
}

function sameConnectorScope(tool: ToolName): CapabilityScope {
  return {
    family: tool === 'jira' ? 'jira' : tool === 'notion' ? 'notion' : 'slack_write',
    allowed: new Set(listCapabilities({ connector: tool }).map((c) => c.name)),
    lockedCapability: null,
  };
}

export function scopeFromCallInput(input?: Record<string, unknown>): CapabilityScope | null {
  if (!input) return null;
  const family = input[CAPABILITY_META.family];
  const scopeArr = input[CAPABILITY_META.scope];
  if (typeof family !== 'string' || !Array.isArray(scopeArr)) return null;
  const allowed = new Set(scopeArr.filter((x): x is string => typeof x === 'string'));
  const locked = input[CAPABILITY_META.locked];
  return {
    family: family as IntentFamily,
    allowed,
    lockedCapability: typeof locked === 'string' ? locked : null,
  };
}

/** Stamp scope metadata onto a tool call (persists through Approvals). */
export function stampCapabilityContext(call: ToolCall, route: AuthoritativeRoute): ToolCall {
  const scope = buildCapabilityScope(route);
  return {
    ...call,
    input: {
      ...call.input,
      [CAPABILITY_META.family]: scope.family,
      [CAPABILITY_META.scope]: [...scope.allowed],
      [CAPABILITY_META.locked]: scope.lockedCapability,
    },
  };
}

/** Strip internal capability stamps before sending payload to external APIs. */
export function stripCapabilityMeta(input: Record<string, unknown>): Record<string, unknown> {
  const out = { ...input };
  delete out[CAPABILITY_META.family];
  delete out[CAPABILITY_META.scope];
  delete out[CAPABILITY_META.locked];
  delete out._availableProjects;
  return out;
}

export function filterCallsByCapabilityScope(
  calls: ToolCall[],
  scope: CapabilityScope
): {
  kept: ToolCall[];
  stripped: Array<{ tool: ToolName; action: string; reason: string }>;
} {
  const kept: ToolCall[] = [];
  const stripped: Array<{ tool: ToolName; action: string; reason: string }> = [];
  for (const c of calls) {
    const name = capabilityName(c.tool, c.action);
    if (!REGISTRY.has(name)) {
      stripped.push({ tool: c.tool, action: c.action, reason: 'CAPABILITY_UNKNOWN' });
      continue;
    }
    if (!scope.allowed.has(name)) {
      stripped.push({ tool: c.tool, action: c.action, reason: 'CAPABILITY_NOT_ALLOWED' });
      continue;
    }
    kept.push(c);
  }
  return { kept, stripped };
}
