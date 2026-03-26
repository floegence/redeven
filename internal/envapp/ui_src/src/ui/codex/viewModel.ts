import { buildTranscriptSnapshot, displayStatus, formatRelativeThreadTime } from './presentation';
import type { CodexPendingRequest, CodexStatus, CodexThread, CodexTranscriptItem } from './types';

export type CodexChipTone = 'neutral' | 'accent' | 'success' | 'warning';

export type CodexWorkbenchMetric = Readonly<{
  id: string;
  label: string;
  value: string;
  tone: CodexChipTone;
  title?: string;
}>;

export type CodexWorkbenchSummary = Readonly<{
  threadTitle: string;
  workspaceLabel: string;
  modelLabel: string;
  latestActivityLabel: string;
  statusLabel: string;
  statusFlags: string[];
  hostReady: boolean;
  pendingRequestCount: number;
  metrics: CodexWorkbenchMetric[];
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
  transcriptItems: readonly CodexTranscriptItem[];
}): CodexWorkbenchSummary {
  const workspaceLabel = firstNonEmpty(
    args.thread?.cwd,
    args.workingDirDraft,
    args.status?.agent_home_dir,
  );
  const modelLabel = firstNonEmpty(args.modelDraft, args.thread?.model_provider);
  const latestActivityLabel = formatRelativeThreadTime(Number(args.thread?.updated_at_unix_s ?? 0));
  const hostReady = Boolean(args.status?.available);
  const pendingRequestCount = args.pendingRequests.length;
  const snapshot = buildTranscriptSnapshot(args.transcriptItems);
  const metrics: CodexWorkbenchMetric[] = [];

  if (snapshot.artifactCount > 0) {
    metrics.push({
      id: 'artifacts',
      label: 'Files',
      value: String(snapshot.artifactCount),
      tone: 'accent',
    });
  }
  if (snapshot.commandCount > 0) {
    metrics.push({
      id: 'commands',
      label: 'Commands',
      value: String(snapshot.commandCount),
      tone: 'neutral',
    });
  }
  if (snapshot.responseCount > 0) {
    metrics.push({
      id: 'responses',
      label: 'Responses',
      value: String(snapshot.responseCount),
      tone: 'success',
    });
  }
  if (snapshot.reasoningCount > 0) {
    metrics.push({
      id: 'notes',
      label: 'Notes',
      value: String(snapshot.reasoningCount),
      tone: 'warning',
    });
  }
  if (pendingRequestCount > 0) {
    metrics.push({
      id: 'pending',
      label: 'Pending',
      value: String(pendingRequestCount),
      tone: 'warning',
    });
  }
  return {
    threadTitle: firstNonEmpty(args.thread?.name, args.thread?.preview, 'New thread'),
    workspaceLabel,
    modelLabel,
    latestActivityLabel,
    statusLabel: displayStatus(args.activeStatus, 'idle'),
    statusFlags: args.activeStatusFlags.map((flag) => displayStatus(flag)).filter(Boolean),
    hostReady,
    pendingRequestCount,
    metrics,
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
