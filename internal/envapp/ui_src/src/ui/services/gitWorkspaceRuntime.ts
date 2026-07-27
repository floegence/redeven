import type { GitCapabilitiesResponse } from '../protocol/redeven_v1';

export const GIT_ERROR_WORKSPACE_SNAPSHOT_STALE = 40901;
export const GIT_ERROR_WORKSPACE_RESPONSE_BUDGET = 41302;
export const GIT_ERROR_RESPONSE_BUDGET = 41305;
export const GIT_ERROR_REQUEST_BUDGET = 41307;
export const GIT_ERROR_OPERATION_PLAN_STALE = 409;

export type GitPlanOperation = 'mergeBranch' | 'deleteBranch';

export type GitCapabilityMode = 'unknown' | 'probing' | 'legacy' | 'capable' | 'transient';

export type GitWorkspaceInvalidationEvent = Readonly<{
  clientIdentity: object;
  sequence: number;
  repoRootPath?: string;
}>;

type GitWorkspaceClientState = {
  capabilityMode: GitCapabilityMode;
  capabilityGeneration: number;
  capabilityProbe: Promise<GitCapabilityMode> | null;
  sequence: number;
  globalWatermark: number;
  repoWatermarks: Map<string, number>;
  listeners: Set<(event: GitWorkspaceInvalidationEvent) => void>;
};

const clientStates = new WeakMap<object, GitWorkspaceClientState>();

function stateFor(clientIdentity: object): GitWorkspaceClientState {
  const existing = clientStates.get(clientIdentity);
  if (existing) return existing;
  const created: GitWorkspaceClientState = {
    capabilityMode: 'unknown',
    capabilityGeneration: 0,
    capabilityProbe: null,
    sequence: 0,
    globalWatermark: 0,
    repoWatermarks: new Map(),
    listeners: new Set(),
  };
  clientStates.set(clientIdentity, created);
  return created;
}

function repoKey(repoRootPath: string | null | undefined): string {
  return typeof repoRootPath === 'string' ? repoRootPath : '';
}

export function gitRpcErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' && Number.isFinite(code) ? code : undefined;
}

export function isGitWorkspaceBudgetError(error: unknown): boolean {
  const code = gitRpcErrorCode(error);
  return code === GIT_ERROR_WORKSPACE_RESPONSE_BUDGET
    || code === GIT_ERROR_RESPONSE_BUDGET
    || code === GIT_ERROR_REQUEST_BUDGET;
}

export function isGitWorkspaceSnapshotStale(error: unknown): boolean {
  return gitRpcErrorCode(error) === GIT_ERROR_WORKSPACE_SNAPSHOT_STALE;
}

export function isGitOperationPlanStale(
  error: unknown,
  operation: GitPlanOperation,
): boolean {
  switch (operation) {
    case 'mergeBranch':
    case 'deleteBranch':
      return gitRpcErrorCode(error) === GIT_ERROR_OPERATION_PLAN_STALE;
  }
}

export function getGitCapabilityMode(clientIdentity: object): GitCapabilityMode {
  return stateFor(clientIdentity).capabilityMode;
}

function supportsBoundedWorkspace(capabilities: GitCapabilitiesResponse): boolean {
  return capabilities.workspaceRevisionV1
    && capabilities.workspacePathStatusV1
    && capabilities.workspaceDirectoryScopeV1
    && capabilities.stashSectionDiffV1;
}

export async function probeGitCapabilities(
  clientIdentity: object,
  getCapabilities: () => Promise<GitCapabilitiesResponse>,
  options: { force?: boolean } = {},
): Promise<GitCapabilityMode> {
  const state = stateFor(clientIdentity);
  if (!options.force && (state.capabilityMode === 'legacy' || state.capabilityMode === 'capable')) {
    return state.capabilityMode;
  }
  if (state.capabilityProbe) return state.capabilityProbe;

  const generation = ++state.capabilityGeneration;
  state.capabilityMode = 'probing';
  const probe = getCapabilities()
    .then((capabilities) => supportsBoundedWorkspace(capabilities) ? 'capable' as const : 'legacy' as const)
    .catch((error: unknown) => gitRpcErrorCode(error) === 404 ? 'legacy' as const : 'transient' as const)
    .then((mode) => {
      if (state.capabilityGeneration === generation) state.capabilityMode = mode;
      return state.capabilityMode;
    })
    .finally(() => {
      if (state.capabilityGeneration === generation) state.capabilityProbe = null;
    });
  state.capabilityProbe = probe;
  return probe;
}

export function getGitWorkspaceWatermark(
  clientIdentity: object,
  repoRootPath?: string,
): number {
  const state = stateFor(clientIdentity);
  return Math.max(state.globalWatermark, state.repoWatermarks.get(repoKey(repoRootPath)) ?? 0);
}

export function subscribeGitWorkspaceInvalidation(
  clientIdentity: object,
  listener: (event: GitWorkspaceInvalidationEvent) => void,
): () => void {
  const state = stateFor(clientIdentity);
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function publishGitWorkspaceInvalidation(
  clientIdentity: object,
  repoRootPath?: string,
): GitWorkspaceInvalidationEvent {
  const state = stateFor(clientIdentity);
  const sequence = ++state.sequence;
  const key = repoKey(repoRootPath);
  if (key) state.repoWatermarks.set(key, sequence);
  else state.globalWatermark = sequence;
  const event: GitWorkspaceInvalidationEvent = {
    clientIdentity,
    sequence,
    ...(key ? { repoRootPath: key } : {}),
  };
  for (const listener of state.listeners) listener(event);
  return event;
}

export async function executeWorkspaceEffect<T>(params: {
  clientIdentity: object;
  repoHint?: string;
  effect: () => Promise<T>;
}): Promise<T> {
  try {
    return await params.effect();
  } finally {
    publishGitWorkspaceInvalidation(params.clientIdentity, params.repoHint);
  }
}
