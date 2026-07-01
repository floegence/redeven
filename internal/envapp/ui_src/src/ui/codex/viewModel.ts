import { displayStatus, isWorkingStatus } from './presentation';
import {
  resolveCodexApprovalPolicyValue,
  resolveCodexSandboxModeValue,
} from './runtimeDefaults';
import type { I18nHelpers } from '../i18n';
import type {
  CodexCapabilitiesSnapshot,
  CodexModelOption,
  CodexOperationName,
  CodexPendingRequest,
  CodexStatus,
  CodexThread,
  CodexThreadTokenUsage,
  CodexThreadRuntimeConfig,
} from './types';

export type CodexWorkbenchSummary = Readonly<{
  threadTitle: string;
  workspaceLabel: string;
  modelLabel: string;
  statusLabel: string;
  statusFlags: string[];
  contextLabel: string;
  contextDetail: string;
  hostReady: boolean;
  pendingRequestCount: number;
}>;

export type CodexSidebarSummary = Readonly<{
  hostLabel: string;
  hostReady: boolean;
  binaryPath: string;
  pendingRequestCount: number;
  statusError: string;
  secondaryLabel: string;
}>;

export type CodexPendingRequestViewModel = Readonly<{
  id: string;
  title: string;
  detail: string;
  command: string;
  cwd: string;
  questionCount: number;
  decisionLabel: string;
}>;

export type CodexWorkingDirResolutionArgs = Readonly<{
  workingDirDraft?: string | null | undefined;
  runtimeConfig?: CodexThreadRuntimeConfig | null | undefined;
  capabilities?: CodexCapabilitiesSnapshot | null | undefined;
  thread?: CodexThread | null | undefined;
  status?: CodexStatus | null | undefined;
}>;

function firstNonEmpty(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim();
    if (value) return value;
  }
  return '';
}

function firstDefinedList(candidates: unknown[]): string[] {
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const values = candidate
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean);
    if (values.length > 0) return values;
  }
  return [];
}

export function resolveCodexWorkingDir(args: CodexWorkingDirResolutionArgs): string {
  const homeDir = firstNonEmpty(args.status?.agent_home_dir);
  const threadCwd = firstNonEmpty(args.thread?.cwd);
  const runtimeCwd = firstNonEmpty(args.runtimeConfig?.cwd);
  const explicitRuntimeCwd = runtimeCwd && runtimeCwd !== homeDir ? runtimeCwd : '';
  return firstNonEmpty(
    args.workingDirDraft,
    explicitRuntimeCwd,
    threadCwd,
    args.capabilities?.effective_config?.cwd,
    runtimeCwd,
    homeDir,
  );
}

function compactTokenCount(value: number | null | undefined): string {
  const normalized = Math.max(0, Number(value ?? 0) || 0);
  if (normalized >= 1_000_000) {
    return `${(normalized / 1_000_000).toFixed(normalized >= 10_000_000 ? 0 : 1)}M`;
  }
  if (normalized >= 1_000) {
    return `${(normalized / 1_000).toFixed(normalized >= 10_000 ? 0 : 1)}k`;
  }
  return `${normalized}`;
}

function codexStatusLabel(status: string | null | undefined): string {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (isWorkingStatus(normalized)) {
    return 'working';
  }
  switch (normalized) {
    case 'notloaded':
    case 'not_loaded':
    case 'not loaded':
      return 'idle';
    case 'systemerror':
    case 'system_error':
      return 'system error';
    default:
      return displayStatus(status, 'idle');
  }
}

function codexContextSummary(
  tokenUsage: CodexThreadTokenUsage | null | undefined,
  t?: I18nHelpers['t'],
): {
  contextLabel: string;
  contextDetail: string;
} {
  if (!tokenUsage) {
    return {
      contextLabel: '',
      contextDetail: '',
    };
  }
  const totalTokens = Math.max(0, Number(tokenUsage.total?.total_tokens ?? 0) || 0);
  const lastTurnTokens = Math.max(0, Number(tokenUsage.last?.total_tokens ?? 0) || 0);
  const contextWindow = Math.max(0, Number(tokenUsage.model_context_window ?? 0) || 0);
  if (contextWindow > 0) {
    const remainingPercent = Math.max(0, Math.min(100, Math.round(((contextWindow - totalTokens) / contextWindow) * 100)));
    return {
      contextLabel: t
        ? t('codex.context.contextLeft', { percent: remainingPercent })
        : `${remainingPercent}% context left`,
      contextDetail: t
        ? t('codex.context.usedAndLastTokens', { used: compactTokenCount(totalTokens), last: compactTokenCount(lastTurnTokens) })
        : `${compactTokenCount(totalTokens)} used · ${compactTokenCount(lastTurnTokens)} last`,
    };
  }
  return {
    contextLabel: t
      ? t('codex.context.usedTokens', { count: compactTokenCount(totalTokens) })
      : `${compactTokenCount(totalTokens)} used`,
    contextDetail: lastTurnTokens > 0
      ? (
        t
          ? t('codex.context.lastTurnTokens', { count: compactTokenCount(lastTurnTokens) })
          : `${compactTokenCount(lastTurnTokens)} last turn`
      )
      : '',
  };
}

export function findCodexModelOption(
  capabilities: CodexCapabilitiesSnapshot | null | undefined,
  modelID: string | null | undefined,
): CodexModelOption | null {
  const target = String(modelID ?? '').trim();
  const models = Array.isArray(capabilities?.models) ? capabilities?.models : [];
  if (!target) {
    return models.find((model) => Boolean(model.is_default)) ?? models[0] ?? null;
  }
  return models.find((model) => String(model.id ?? '').trim() === target) ?? null;
}

export function codexModelLabel(
  capabilities: CodexCapabilitiesSnapshot | null | undefined,
  modelID: string | null | undefined,
): string {
  const option = findCodexModelOption(capabilities, modelID);
  if (option) {
    return String(option.display_name ?? option.id ?? '').trim();
  }
  return String(modelID ?? '').trim();
}

export function codexModelSupportsImages(
  capabilities: CodexCapabilitiesSnapshot | null | undefined,
  modelID: string | null | undefined,
): boolean {
  const option = findCodexModelOption(capabilities, modelID);
  if (!option) return true;
  return option.supports_image_input !== false;
}

export function codexSupportedReasoningEfforts(
  capabilities: CodexCapabilitiesSnapshot | null | undefined,
  modelID: string | null | undefined,
): string[] {
  const option = findCodexModelOption(capabilities, modelID);
  return firstDefinedList([
    option?.supported_reasoning_efforts,
    option?.default_reasoning_effort ? [option.default_reasoning_effort] : [],
    ['medium'],
  ]);
}

export function codexReasoningEffortLabel(value: string | null | undefined): string {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
    case 'max':
      return 'Max';
    default:
      return displayStatus(String(value ?? '').trim(), 'Medium');
  }
}

export function localizedCodexReasoningEffortLabel(
  value: string | null | undefined,
  t: I18nHelpers['t'],
): string {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'low':
      return t('codex.controls.reasoningEffort.low');
    case 'medium':
      return t('codex.controls.reasoningEffort.medium');
    case 'high':
      return t('codex.controls.reasoningEffort.high');
    case 'max':
      return t('codex.controls.reasoningEffort.max');
    default:
      return displayStatus(String(value ?? '').trim(), t('codex.controls.reasoningEffort.medium'));
  }
}

export function codexAllowedApprovalPolicies(
  capabilities: CodexCapabilitiesSnapshot | null | undefined,
): string[] {
  return firstDefinedList([
    capabilities?.requirements?.allowed_approval_policies,
    ['untrusted', 'on-failure', 'on-request', 'never'],
  ]);
}

export function codexAllowedSandboxModes(
  capabilities: CodexCapabilitiesSnapshot | null | undefined,
): string[] {
  return firstDefinedList([
    capabilities?.requirements?.allowed_sandbox_modes,
    ['read-only', 'workspace-write', 'danger-full-access'],
  ]);
}

const DEFAULT_CODEX_OPERATIONS: readonly CodexOperationName[] = [
  'thread_archive',
  'thread_fork',
  'turn_steer',
  'turn_interrupt',
  'review_start',
];

export function codexSupportsOperation(
  capabilities: CodexCapabilitiesSnapshot | null | undefined,
  operation: CodexOperationName,
): boolean {
  const operations = Array.isArray(capabilities?.operations) && capabilities?.operations.length > 0
    ? capabilities.operations
    : DEFAULT_CODEX_OPERATIONS;
  return operations.some((value) => String(value ?? '').trim() === operation);
}

export function codexApprovalPolicyLabel(value: string | null | undefined): string {
  switch (resolveCodexApprovalPolicyValue(value)) {
    case 'untrusted':
      return 'Untrusted';
    case 'on-failure':
      return 'On failure';
    case 'on-request':
      return 'On request';
    case 'never':
      return 'Never';
    case 'granular':
      return 'Granular';
    default:
      return displayStatus(resolveCodexApprovalPolicyValue(value), 'Never');
  }
}

export function localizedCodexApprovalPolicyLabel(
  value: string | null | undefined,
  t: I18nHelpers['t'],
): string {
  switch (resolveCodexApprovalPolicyValue(value)) {
    case 'untrusted':
      return t('codex.controls.approvalPolicy.untrusted');
    case 'on-failure':
      return t('codex.controls.approvalPolicy.onFailure');
    case 'on-request':
      return t('codex.controls.approvalPolicy.onRequest');
    case 'never':
      return t('codex.controls.approvalPolicy.never');
    case 'granular':
      return t('codex.controls.approvalPolicy.granular');
    default:
      return displayStatus(resolveCodexApprovalPolicyValue(value), t('codex.controls.approvalPolicy.never'));
  }
}

export function codexSandboxModeLabel(value: string | null | undefined): string {
  switch (resolveCodexSandboxModeValue(value)) {
    case 'read-only':
      return 'Read only';
    case 'workspace-write':
      return 'Workspace write';
    case 'danger-full-access':
      return 'Full access';
    case 'external-sandbox':
      return 'External sandbox';
    default:
      return displayStatus(resolveCodexSandboxModeValue(value), 'Full access');
  }
}

export function localizedCodexSandboxModeLabel(
  value: string | null | undefined,
  t: I18nHelpers['t'],
): string {
  switch (resolveCodexSandboxModeValue(value)) {
    case 'read-only':
      return t('codex.controls.sandboxMode.readOnly');
    case 'workspace-write':
      return t('codex.controls.sandboxMode.workspaceWrite');
    case 'danger-full-access':
      return t('codex.controls.sandboxMode.dangerFullAccess');
    case 'external-sandbox':
      return t('codex.controls.sandboxMode.externalSandbox');
    default:
      return displayStatus(resolveCodexSandboxModeValue(value), t('codex.controls.sandboxMode.dangerFullAccess'));
  }
}

function requestTitle(type: string, t?: I18nHelpers['t']): string {
  switch (String(type ?? '').trim().toLowerCase()) {
    case 'user_input':
      return t?.('codex.pendingRequests.titleByType.userInput') ?? 'User input required';
    case 'command_approval':
      return t?.('codex.pendingRequests.titleByType.commandApproval') ?? 'Command approval required';
    case 'file_change_approval':
      return t?.('codex.pendingRequests.titleByType.fileChangeApproval') ?? 'File change approval required';
    case 'permissions':
      return t?.('codex.pendingRequests.titleByType.permissions') ?? 'Permission update required';
    default:
      return t?.('codex.pendingRequests.titleByType.default', { type: displayStatus(type, 'Request') }) ?? `${displayStatus(type, 'Request')} required`;
  }
}

function requestFallbackDetail(request: CodexPendingRequest, t?: I18nHelpers['t']): string {
  switch (String(request.type ?? '').trim().toLowerCase()) {
    case 'user_input':
      return t?.('codex.pendingRequests.fallbackDetail.userInput') ?? 'Codex needs more input before it can continue.';
    case 'command_approval':
      return t?.('codex.pendingRequests.fallbackDetail.commandApproval') ?? 'Review this command before Codex continues.';
    case 'file_change_approval':
      return t?.('codex.pendingRequests.fallbackDetail.fileChangeApproval') ?? 'Review the proposed file changes before Codex continues.';
    case 'permissions':
      return t?.('codex.pendingRequests.fallbackDetail.permissions') ?? 'Review the requested permission changes before Codex continues.';
    default:
      return t?.('codex.pendingRequests.fallbackDetail.default') ?? 'Codex needs a response before it can continue.';
  }
}

export function buildCodexWorkbenchSummary(args: {
  thread: CodexThread | null;
  runtimeConfig: CodexThreadRuntimeConfig | null | undefined;
  capabilities: CodexCapabilitiesSnapshot | null | undefined;
  status: CodexStatus | null | undefined;
  workingDirDraft: string;
  modelDraft: string;
  tokenUsage: CodexThreadTokenUsage | null | undefined;
  activeStatus: string;
  activeStatusFlags: readonly string[];
  pendingRequests: readonly CodexPendingRequest[];
  t?: I18nHelpers['t'];
}): CodexWorkbenchSummary {
  const workspaceLabel = resolveCodexWorkingDir(args);
  const modelValue = firstNonEmpty(args.modelDraft, args.runtimeConfig?.model);
  const hostReady = Boolean(args.status?.available);
  const pendingRequestCount = args.pendingRequests.length;
  const contextSummary = codexContextSummary(args.tokenUsage, args.t);
  return {
    threadTitle: firstNonEmpty(args.thread?.name, args.thread?.preview, args.t?.('codex.common.newThread') ?? 'New thread'),
    workspaceLabel,
    modelLabel: codexModelLabel(args.capabilities, modelValue),
    statusLabel: codexStatusLabel(args.activeStatus),
    statusFlags: args.activeStatusFlags.map((flag) => displayStatus(flag)).filter(Boolean),
    contextLabel: contextSummary.contextLabel,
    contextDetail: contextSummary.contextDetail,
    hostReady,
    pendingRequestCount,
  };
}

export function buildCodexSidebarSummary(args: {
  status: CodexStatus | null | undefined;
  pendingRequests: readonly CodexPendingRequest[];
  statusError: string | null | undefined;
  t?: I18nHelpers['t'];
}): CodexSidebarSummary {
  const binaryPath = String(args.status?.binary_path ?? '').trim();
  const hostReady = Boolean(args.status?.available);
  const statusError = String(args.statusError ?? '').trim();

  return {
    hostLabel: hostReady ? args.t?.('codex.sidebar.hostReady') ?? 'Host ready' : args.t?.('codex.sidebar.installRequired') ?? 'Install required',
    hostReady,
    binaryPath,
    pendingRequestCount: args.pendingRequests.length,
    statusError,
    secondaryLabel: hostReady
      ? args.t?.('codex.sidebar.hostAvailable') ?? 'Host Codex runtime is available.'
      : args.t?.('codex.sidebar.installHostBinary') ?? 'Install the host `codex` binary to use Codex chat.',
  };
}

export function buildCodexPendingRequestViewModel(
  request: CodexPendingRequest,
  t?: I18nHelpers['t'],
): CodexPendingRequestViewModel {
  return {
    id: String(request.id ?? '').trim(),
    title: requestTitle(request.type, t),
    detail: firstNonEmpty(request.reason, requestFallbackDetail(request, t)),
    command: String(request.command ?? '').trim(),
    cwd: String(request.cwd ?? '').trim(),
    questionCount: Array.isArray(request.questions) ? request.questions.length : 0,
    decisionLabel: String(request.type ?? '').trim().toLowerCase() === 'user_input'
      ? t?.('codex.actions.submitResponse') ?? 'Submit response'
      : t?.('codex.actions.reviewApproval') ?? 'Review approval',
  };
}
