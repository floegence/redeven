import { displayStatus } from './presentation';
import type { CodexPendingRequest, CodexStatus, CodexThread } from './types';

export type CodexWorkbenchSummary = Readonly<{
  threadTitle: string;
  workspaceLabel: string;
  modelLabel: string;
  statusLabel: string;
  statusFlags: string[];
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

function firstNonEmpty(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim();
    if (value) return value;
  }
  return '';
}

function requestTitle(type: string): string {
  switch (String(type ?? '').trim().toLowerCase()) {
    case 'user_input':
      return 'User input required';
    case 'command_approval':
      return 'Command approval required';
    case 'file_change_approval':
      return 'File change approval required';
    case 'permissions':
      return 'Permission update required';
    default:
      return `${displayStatus(type, 'Request')} required`;
  }
}

function requestFallbackDetail(request: CodexPendingRequest): string {
  switch (String(request.type ?? '').trim().toLowerCase()) {
    case 'user_input':
      return 'Codex needs more input before it can continue.';
    case 'command_approval':
      return 'Review this command before Codex continues.';
    case 'file_change_approval':
      return 'Review the proposed file changes before Codex continues.';
    case 'permissions':
      return 'Review the requested permission changes before Codex continues.';
    default:
      return 'Codex needs a response before it can continue.';
  }
}

export function buildCodexWorkbenchSummary(args: {
  thread: CodexThread | null;
  status: CodexStatus | null | undefined;
  workingDirDraft: string;
  modelDraft: string;
  activeStatus: string;
  activeStatusFlags: readonly string[];
  pendingRequests: readonly CodexPendingRequest[];
}): CodexWorkbenchSummary {
  const workspaceLabel = firstNonEmpty(
    args.thread?.cwd,
    args.workingDirDraft,
    args.status?.agent_home_dir,
  );
  const modelLabel = firstNonEmpty(args.modelDraft, args.thread?.model_provider);
  const hostReady = Boolean(args.status?.available);
  const pendingRequestCount = args.pendingRequests.length;
  return {
    threadTitle: firstNonEmpty(args.thread?.name, args.thread?.preview, 'New thread'),
    workspaceLabel,
    modelLabel,
    statusLabel: displayStatus(args.activeStatus, 'idle'),
    statusFlags: args.activeStatusFlags.map((flag) => displayStatus(flag)).filter(Boolean),
    hostReady,
    pendingRequestCount,
  };
}

export function buildCodexSidebarSummary(args: {
  status: CodexStatus | null | undefined;
  pendingRequests: readonly CodexPendingRequest[];
  statusError: string | null | undefined;
}): CodexSidebarSummary {
  const binaryPath = String(args.status?.binary_path ?? '').trim();
  const hostReady = Boolean(args.status?.available);
  const statusError = String(args.statusError ?? '').trim();

  return {
    hostLabel: hostReady ? 'Host ready' : 'Install required',
    hostReady,
    binaryPath,
    pendingRequestCount: args.pendingRequests.length,
    statusError,
    secondaryLabel: hostReady
      ? 'Dedicated Codex runtime bridge is ready on this host.'
      : 'Install the host `codex` binary and refresh to enable Codex chats.',
  };
}

export function buildCodexPendingRequestViewModel(request: CodexPendingRequest): CodexPendingRequestViewModel {
  return {
    id: String(request.id ?? '').trim(),
    title: requestTitle(request.type),
    detail: firstNonEmpty(request.reason, requestFallbackDetail(request)),
    command: String(request.command ?? '').trim(),
    cwd: String(request.cwd ?? '').trim(),
    questionCount: Array.isArray(request.questions) ? request.questions.length : 0,
    decisionLabel: String(request.type ?? '').trim().toLowerCase() === 'user_input'
      ? 'Submit response'
      : 'Review approval',
  };
}
