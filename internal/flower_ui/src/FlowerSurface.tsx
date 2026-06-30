import type { Accessor, Component, JSX } from 'solid-js';
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { AlertTriangle, ArrowUp, Bot, Check, ChevronDown, ChevronRight, Clock, Copy, FileText, FolderOpen, GitBranch, GripVertical, Plus, Settings, Shield, Terminal } from '@floegence/floe-webapp-core/icons';
import { Button, FloatingWindow, SurfaceFloatingLayer } from '@floegence/floe-webapp-core/ui';

import { writeTextToClipboard } from './clipboard';
import { FlowerChatContextChips } from './chat/FlowerChatContextChips';
import { FlowerChatContextPreview } from './chat/FlowerChatContextPreview';
import { parseChatContextAction } from './chat/flowerChatContextModel';
import { FlowerContextCompactionDivider } from './chat/FlowerContextCompactionDivider';
import { FlowerComposerContextIndicator } from './chat/FlowerComposerContextIndicator';
import type { FlowerComposerContextUsageFreshness } from './chat/flowerContextPresentation';
import { FlowerEmptyState } from './chat/FlowerEmptyState';
import type { FlowerChatContextChip } from './contracts/flowerChatContextTypes';
import { FlowerMarkdownBlock } from './chat/markdown/FlowerMarkdownBlock';
import type { FlowerSubagentsCopy, FlowerSurfaceCopy } from './copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from './copy';
import type {
  FlowerApprovalAction,
  FlowerActivityItem,
  FlowerActivityTimelineBlock,
  FlowerInputAnswer,
  FlowerInputRequest,
  FlowerInputRequestChoice,
  FlowerInputRequestQuestion,
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerSurfaceAdapter,
  FlowerTurnLaunchFailure,
  FlowerRouterDecision,
  FlowerThreadActivitySnapshot,
  FlowerThreadListItem,
  FlowerThreadReadStatus,
  FlowerThreadStatus,
  FlowerThreadSnapshot,
  FlowerChatMessage,
  FlowerContextUsage,
  FlowerTimelineAnchor,
  FlowerTimelineDecoration,
  FlowerActivityStatus,
  FlowerLiveBootstrap,
  FlowerActivityApprovalState,
  FlowerModelIOPhase,
  FlowerModelIOStatus,
  FlowerPermissionType,
  FlowerProviderType,
  FlowerReasoningSelection,
  FlowerSubagentDetail,
  FlowerSubagentTimelineRow,
} from './contracts/flowerSurfaceContracts';
import { projectFlowerThreadListItem, trimString } from './flowerSurfaceModel';
import {
  buildFlowerTimelineEntries,
  type FlowerRenderableMessageBlock,
  type FlowerTimelineEntry,
} from './flowerTimelineProjection';
import {
  buildFlowerSubagentPanelItems,
  type FlowerSubagentPanelItem,
  type FlowerSubagentPanelStatus,
} from './flowerSubagentProjection';
import { projectSubagentDetailThread } from './flowerSubagentDetailThread';
import { formatFlowerCurrentModelLabel } from './flowerModelLabel';
import { FLOWER_COMPACT_CONTEXT_COMMAND, parseFlowerSlashCommand } from './flowerSlashCommands';
import {
  presentFlowerActivityItem,
  type FlowerActivityDetailBlock,
  type FlowerActivityDiffFile,
  type FlowerActivityFileAction,
  type FlowerActivityTitle,
  type FlowerActivityTodoStatus,
} from './flowerActivityPresentation';
import { formatGitPatchLineNumber, getGitPatchRenderSnapshot, type GitPatchRenderedLine } from './gitPatch';
import { FlowerIcon } from './icons/FlowerIcon';
import { FlowerSoftAuraIcon } from './icons/FlowerSoftAuraIcon';
import { FlowerSettingsSurface } from './settings/FlowerSettingsSurface';
import { FlowerShellCommandHighlight } from './shellCommandHighlight';
import { FlowerThreadList, type FlowerThreadMenuAction } from './threads/FlowerThreadList';
import { applyFlowerLiveEvent, projectFlowerLiveBootstrap } from './flowerLiveReducer';
import { flowerThreadReadSnapshotKey, mergeFlowerThreadListRefresh, sameThreadSnapshot } from './flowerThreadListRefresh';
import { FlowerProviderBrandIcon, flowerModelSupportsImage, formatFlowerTokenCount } from './settings/providerCatalog';
import { FlowerReasoningControl } from './ReasoningControl';
import {
  defaultReasoningSelectionForCapability,
  normalizeFlowerReasoningSelection,
  reasoningCapabilitySupportsControl,
  sameFlowerReasoningSelection,
  serializeFlowerReasoningSelection,
} from './reasoning';

type FlowerSurfacePanel = 'chat' | 'settings';
type FlowerInputDraft = Readonly<{
  choice_id?: string;
  text?: string;
}>;
type FlowerComposerSessionDraft = Readonly<{
  chatDraft: string;
  inputPromptSignature: string;
  inputDrafts: Record<string, FlowerInputDraft>;
  activeInputQuestionID: string;
  modelIDOverride?: string;
  permissionTypeOverride?: FlowerPermissionType;
  reasoningOverride?: FlowerReasoningSelection;
}>;
type FlowerComposerContextUsageModel = Readonly<{
  usage: FlowerContextUsage;
  freshness: FlowerComposerContextUsageFreshness;
}>;
type PendingPermissionPatch = Readonly<{
  threadID: string;
  requested: FlowerPermissionType;
  previous: FlowerPermissionType;
}>;
type PendingModelPatch = Readonly<{
  threadID: string;
  requested: string;
  previous: string;
}>;
type PendingFlowerTurn = Readonly<{
  thread_id: string;
  message_id: string;
  prompt: string;
  state: 'sending' | 'queued';
  created_at_ms: number;
}>;
type PendingContextCompactionDecoration = Readonly<{
  thread_id: string;
  started_at_ms: number;
  known_operation_ids: readonly string[];
  decoration: FlowerTimelineDecoration;
}>;
type SelectedThreadLiveRequest = Readonly<{
  token: number;
  sequence: number;
}>;
type FlowerLiveTimeoutDetail = Readonly<{
  thread_id: string;
  cursor: number;
  stream_generation: number;
  sequence: number;
}>;
const SELECTED_THREAD_LIVE_EVENTS_TIMEOUT_MS = 15000;
const FLOWER_LIVE_EVENTS_TIMEOUT_EVENT = 'redeven:flower-live-events-timeout';
class LiveEventRequestTimeoutError extends Error {
  constructor() {
    super('live event request timed out');
    this.name = 'LiveEventRequestTimeoutError';
  }
}
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0 || typeof window === 'undefined') return promise;
  let timeoutID: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutID = window.setTimeout(() => {
      reject(new LiveEventRequestTimeoutError());
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutID !== undefined) {
      window.clearTimeout(timeoutID);
    }
  });
}
function dispatchFlowerLiveEventsTimeout(detail: FlowerLiveTimeoutDetail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FLOWER_LIVE_EVENTS_TIMEOUT_EVENT, { detail }));
}
type FlowerHandlerResolutionState =
  | Readonly<{ status: 'starting' }>
  | Readonly<{ status: 'resolving'; decision: FlowerRouterDecision | null }>
  | Readonly<{ status: 'ready'; decision: FlowerRouterDecision }>
  | Readonly<{ status: 'blocked'; decision: FlowerRouterDecision; message: string }>
  | Readonly<{ status: 'failed'; decision: FlowerRouterDecision | null; message: string }>;
export type FlowerSurfaceWarmupState = Readonly<{
  active: boolean;
  title?: string;
  detail?: string;
  phaseLabel?: string;
  modelLabel?: string;
}>;
type FlowerApprovalSubmittingState = 'approve' | 'reject';
type FlowerFloatingPoint = Readonly<{
  x: number;
  y: number;
}>;
type SelectedThreadTailReveal = Readonly<{
  threadID: string;
  sequence: number;
}>;
type FlowerScrollTailController = Readonly<{
  bind: (node: HTMLDivElement | undefined) => void;
  nearBottom: Accessor<boolean>;
  userInterruptionRevision: () => number;
  startFollowing: () => void;
  stopFollowing: () => void;
  markNearBottom: () => void;
  captureWasNearBottom: () => boolean;
  onScroll: () => void;
  onWheel: (event: WheelEvent) => void;
  measureAfterLayout: () => void;
  scheduleTailScroll: (options?: Readonly<{ smooth?: boolean; force?: boolean }>) => void;
  scrollToBottom: (options?: Readonly<{ smooth?: boolean }>) => void;
  dispose: () => void;
}>;
type FlowerSubagentDetailTailRequest = Readonly<{
  parentThreadID: string;
  childThreadID: string;
  openedRevision: number;
  afterOrdinal: number;
}>;

const THREAD_RAIL_WIDTH_STORAGE_KEY = 'redeven.flower.threadRailWidth';
const THREAD_RAIL_WIDTH_DEFAULT = 272;
const THREAD_RAIL_WIDTH_MIN = 220;
const THREAD_RAIL_WIDTH_MAX = 380;
const SIDEBAR_STABLE_LIVE_STATUSES = new Set<FlowerThreadStatus>(['running']);
const COMPOSER_STOP_THREAD_STATUSES = new Set<FlowerThreadStatus>(['running', 'waiting_approval']);
const PENDING_NEW_THREAD_ID = '__new_thread__';
const FLOWER_PERMISSION_TYPES: readonly FlowerPermissionType[] = ['readonly', 'approval_required', 'full_access'];
const LIVE_EVENT_RENDER_YIELD_SIZE = 8;
const MESSAGE_COPY_RESET_MS = 1600;
const FLOWER_COMPOSER_COMPACT_COMMAND_OPTION_ID = 'flower-composer-command-compact-context';
const TRANSCRIPT_NEAR_BOTTOM_THRESHOLD_PX = 96;
const TRANSCRIPT_SCROLL_TO_LATEST_MS = 220;
const SELECTED_THREAD_TAIL_REVEAL_FALLBACK_MS = 120;
const SUBAGENT_DETAIL_PAGE_SIZE = 200;
const SUBAGENT_DROPDOWN_ESTIMATED_SIZE = { width: 368, height: 448 } as const;
const SUBAGENT_DETAIL_TAIL_RUNNING_INTERVAL_MS = 1500;
const SUBAGENT_DETAIL_TAIL_QUEUED_INTERVAL_MS = 2500;
const SUBAGENT_DETAIL_TAIL_ERROR_INTERVAL_MS = 4000;
const FLOWER_SURFACE_LAYER = {
  subagentWindow: 160,
  contextPreview: 162,
} as const;
const FLOWER_SUBAGENT_TERMINAL_STATUSES = new Set<FlowerSubagentPanelStatus>(['completed', 'failed', 'canceled', 'timed_out']);

function isModelIOPresentationBoundary(kind: string): boolean {
  return kind === 'model_io.updated';
}

function emptyFlowerComposerSessionDraft(): FlowerComposerSessionDraft {
  return {
    chatDraft: '',
    inputPromptSignature: '',
    inputDrafts: {},
    activeInputQuestionID: '',
  };
}

function sameFlowerInputDrafts(left: Record<string, FlowerInputDraft>, right: Record<string, FlowerInputDraft>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => {
    const leftDraft = left[key] ?? {};
    const rightDraft = right[key] ?? {};
    return leftDraft.choice_id === rightDraft.choice_id && leftDraft.text === rightDraft.text;
  });
}

function sameFlowerComposerSessionDraft(left: FlowerComposerSessionDraft, right: FlowerComposerSessionDraft): boolean {
  return left.chatDraft === right.chatDraft
    && left.inputPromptSignature === right.inputPromptSignature
    && left.activeInputQuestionID === right.activeInputQuestionID
    && left.modelIDOverride === right.modelIDOverride
    && left.permissionTypeOverride === right.permissionTypeOverride
    && sameFlowerInputDrafts(left.inputDrafts, right.inputDrafts)
    && sameFlowerReasoningSelection(left.reasoningOverride, right.reasoningOverride);
}

const FlowerStopIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class}
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <rect x="6" y="6" width="12" height="12" rx="2.4" fill="currentColor" stroke="none" />
  </svg>
);

export {
  projectFlowerThreadListItem,
} from './flowerSurfaceModel';

function createFlowerScrollTailController(options: Readonly<{
  reducedMotionPreferred: () => boolean;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
  setNearBottomValue?: (nearBottom: boolean) => void;
}>): FlowerScrollTailController {
  const [nearBottom, setNearBottom] = createSignal(true);
  let node: HTMLDivElement | undefined;
  let measureFrame = 0;
  let scrollFrame = 0;
  let smoothScrollFrame = 0;
  let scrollToBottomInProgress = false;
  let followingLatest = true;
  let userInterruptionRevision = 0;

  const setValue = (value: boolean) => {
    setNearBottom(value);
    options.setNearBottomValue?.(value);
  };
  const startFollowing = () => {
    followingLatest = true;
    setValue(true);
  };
  const isNearBottom = (): boolean => {
    if (!node) return true;
    return node.scrollHeight - node.scrollTop - node.clientHeight <= TRANSCRIPT_NEAR_BOTTOM_THRESHOLD_PX;
  };
  const cancelScheduledScroll = () => {
    if (scrollFrame) {
      options.cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
    }
  };
  const cancelSmoothScroll = () => {
    if (smoothScrollFrame) {
      options.cancelAnimationFrame(smoothScrollFrame);
      smoothScrollFrame = 0;
    }
    scrollToBottomInProgress = false;
  };
  const stopFollowing = () => {
    followingLatest = false;
    userInterruptionRevision += 1;
    cancelScheduledScroll();
    cancelSmoothScroll();
    setValue(isNearBottom());
  };
  const setScrollTop = (target: HTMLDivElement, scrollTop: number) => {
    target.scrollTop = scrollTop;
  };
  const scrollToBottom = (scrollOptions: Readonly<{ smooth?: boolean }> = {}) => {
    const target = node;
    if (!target) return;
    followingLatest = true;
    const targetScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
    cancelSmoothScroll();
    if (!scrollOptions.smooth || options.reducedMotionPreferred() || typeof performance === 'undefined') {
      scrollToBottomInProgress = false;
      setScrollTop(target, targetScrollTop);
      setValue(true);
      return;
    }
    const startScrollTop = target.scrollTop;
    const delta = targetScrollTop - startScrollTop;
    if (Math.abs(delta) <= 1) {
      setScrollTop(target, targetScrollTop);
      setValue(true);
      return;
    }
    const startedAt = performance.now();
    const step = (timestamp: number) => {
      const progress = Math.min(1, (timestamp - startedAt) / TRANSCRIPT_SCROLL_TO_LATEST_MS);
      const eased = 1 - ((1 - progress) ** 3);
      if (!followingLatest) {
        cancelSmoothScroll();
        setValue(isNearBottom());
        return;
      }
      setScrollTop(target, startScrollTop + (delta * eased));
      if (progress < 1) {
        smoothScrollFrame = options.requestAnimationFrame(step);
        return;
      }
      smoothScrollFrame = 0;
      scrollToBottomInProgress = false;
      setScrollTop(target, targetScrollTop);
      setValue(true);
    };
    scrollToBottomInProgress = true;
    smoothScrollFrame = options.requestAnimationFrame(step);
    setValue(true);
  };
  const measureAfterLayout = () => {
    if (measureFrame) {
      options.cancelAnimationFrame(measureFrame);
    }
    measureFrame = options.requestAnimationFrame(() => {
      measureFrame = 0;
      if (scrollToBottomInProgress) {
        setValue(true);
        return;
      }
      setValue(isNearBottom());
    });
  };
  const scheduleTailScroll = (scrollOptions: Readonly<{ smooth?: boolean; force?: boolean }> = {}) => {
    const force = scrollOptions.force === true;
    if ((!force && !followingLatest) || scrollFrame) return;
    if (force) {
      followingLatest = true;
      setValue(true);
    }
    scrollFrame = options.requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!force && !followingLatest) return;
      scrollToBottom(scrollOptions);
    });
  };

  return {
    bind: (nextNode) => {
      node = nextNode;
      setValue(isNearBottom());
    },
    nearBottom,
    userInterruptionRevision: () => userInterruptionRevision,
    startFollowing,
    stopFollowing,
    markNearBottom: startFollowing,
    captureWasNearBottom: () => {
      const value = isNearBottom();
      followingLatest = value;
      setValue(value);
      return value;
    },
    onScroll: () => {
      if (scrollToBottomInProgress) {
        setValue(true);
        return;
      }
      const value = isNearBottom();
      if (!value && followingLatest) {
        stopFollowing();
        return;
      }
      followingLatest = value;
      setValue(value);
    },
    onWheel: (event) => {
      if (event.deltaY < 0) {
        stopFollowing();
      }
    },
    measureAfterLayout,
    scheduleTailScroll,
    scrollToBottom,
    dispose: () => {
      if (measureFrame) {
        options.cancelAnimationFrame(measureFrame);
        measureFrame = 0;
      }
      if (scrollFrame) {
        cancelScheduledScroll();
      }
      cancelSmoothScroll();
    },
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createClientMessageID(): string {
  const entropy = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `client_${entropy.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

function approvalStateLabel(state: FlowerActivityApprovalState | undefined, surfaceCopy: FlowerSurfaceCopy): string {
  return surfaceCopy.chat.toolApprovalStates[state ?? 'requested'] ?? surfaceCopy.chat.toolApprovalStates.requested;
}

function clampThreadRailWidth(width: number): number {
  return Math.min(THREAD_RAIL_WIDTH_MAX, Math.max(THREAD_RAIL_WIDTH_MIN, Math.round(width)));
}

function loadThreadRailWidth(): number {
  if (typeof window === 'undefined') return THREAD_RAIL_WIDTH_DEFAULT;
  const stored = Number(window.localStorage.getItem(THREAD_RAIL_WIDTH_STORAGE_KEY));
  return Number.isFinite(stored) ? clampThreadRailWidth(stored) : THREAD_RAIL_WIDTH_DEFAULT;
}

function hashSubagentPreview(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function subagentTimelineRowBaseIdentity(row: FlowerSubagentTimelineRow): string {
  return [
    'row',
    String(Math.max(0, Math.floor(Number(row.ordinal ?? 0)))),
    trimString(row.kind),
    trimString(row.type ?? ''),
  ].join(':');
}

function subagentTimelineRowIdentity(row: FlowerSubagentTimelineRow): string {
  const base = subagentTimelineRowBaseIdentity(row);
  const metadataID = trimString(row.metadata?.id)
    || trimString(row.metadata?.row_id)
    || trimString(row.metadata?.event_id)
    || trimString(row.metadata?.activity_id);
  if (metadataID) return `${base}:meta:${metadataID}`;
  const toolCallID = trimString(row.tool_call?.id);
  if (toolCallID) return `${base}:tool-call:${toolCallID}`;
  const toolResultID = trimString(row.tool_result?.call_id);
  if (toolResultID) return `${base}:tool-result:${toolResultID}`;
  const activityItems = row.activity?.items.map((item) => (
    trimString(item.item_id)
    || trimString(item.tool_id)
    || trimString(item.tool_name)
    || trimString(item.label)
  )).filter(Boolean).join('\x1e') ?? '';
  const activityID = activityItems
    || trimString(row.activity?.turn_id)
    || trimString(row.activity?.trace_id)
    || trimString(row.activity?.run_id);
  if (activityID) return `${base}:activity:${activityID}`;
  const preview = [
    row.message?.text,
    row.message?.preview,
    row.error,
    row.generic?.title,
    row.generic?.body,
  ].map((value) => trimString(value)).filter(Boolean).join('\x1e');
  return preview ? `${base}:preview:${hashSubagentPreview(preview)}` : base;
}

function mergeSubagentDetailPage(current: FlowerSubagentDetail | null, page: FlowerSubagentDetail): FlowerSubagentDetail {
  if (!current || current.summary.thread_id !== page.summary.thread_id) return page;
  const pageIsNewer = Number(page.generated_at_ms ?? 0) >= Number(current.generated_at_ms ?? 0);
  const metadataSource = pageIsNewer ? page : current;
  const byKey = new Map<string, FlowerSubagentTimelineRow>();
  const order = new Map<string, number>();
  for (const row of current.timeline) {
    const key = subagentTimelineRowIdentity(row);
    if (!order.has(key)) order.set(key, order.size);
    byKey.set(key, row);
  }
  for (const row of page.timeline) {
    const key = subagentTimelineRowIdentity(row);
    if (!order.has(key)) order.set(key, order.size);
    byKey.set(key, row);
  }
  const timeline = Array.from(byKey.entries())
    .sort(([leftKey, left], [rightKey, right]) => {
      if (left.ordinal !== right.ordinal) return left.ordinal - right.ordinal;
      return (order.get(leftKey) ?? 0) - (order.get(rightKey) ?? 0);
    })
    .map(([, row]) => row);
  return {
    ...metadataSource,
    timeline,
    summary: metadataSource.summary,
    next_ordinal: Math.max(
      Math.floor(Number(current.next_ordinal ?? 0)),
      Math.floor(Number(page.next_ordinal ?? 0)),
    ) || metadataSource.next_ordinal,
    has_more: pageIsNewer ? page.has_more : current.has_more,
    retained_from: Math.min(
      Math.floor(Number(current.retained_from ?? page.retained_from ?? 0)),
      Math.floor(Number(page.retained_from ?? current.retained_from ?? 0)),
    ) || metadataSource.retained_from,
    generated_at_ms: Math.max(Number(current.generated_at_ms ?? 0), Number(page.generated_at_ms ?? 0)),
  };
}

function normalizeSubagentPanelStatus(value: unknown): FlowerSubagentPanelStatus {
  const raw = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? trimString(String(value)).toLowerCase()
    : '';
  switch (raw) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'waiting':
    case 'waiting_input':
    case 'interrupted':
      return 'waiting_input';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'canceled':
    case 'cancelled':
    case 'closed':
      return 'canceled';
    case 'timed_out':
      return 'timed_out';
    default:
      return 'unknown';
  }
}

function isSubagentTerminalStatus(status: FlowerSubagentPanelStatus): boolean {
  return FLOWER_SUBAGENT_TERMINAL_STATUSES.has(status);
}

export type FlowerThreadFocusRequest = Readonly<{
  request_id: string;
  thread_id: string;
}>;

export type FlowerSurfaceProps = Readonly<{
  adapter: FlowerSurfaceAdapter;
  copy?: FlowerSurfaceCopy;
  warmup?: FlowerSurfaceWarmupState | null;
  focusThreadRequest?: FlowerThreadFocusRequest | null;
  sidebarLeadingAction?: JSX.Element;
  onFocusThreadRequestConsumed?: (requestID: string) => void;
  class?: string;
}>;

export const FlowerSurface: Component<FlowerSurfaceProps> = (props) => {
  const copy = () => props.copy ?? DEFAULT_FLOWER_SURFACE_COPY;
  const subagentsCopy = (): FlowerSubagentsCopy => copy().subagents ?? DEFAULT_FLOWER_SURFACE_COPY.subagents!;
  const [loadError, setLoadError] = createSignal('');
  const [saveError, setSaveError] = createSignal('');
  const [savedAt, setSavedAt] = createSignal<number | null>(null);
  const [snapshot, setSnapshot] = createSignal<FlowerSettingsSnapshot | null>(null);
  const [threads, setThreads] = createSignal<readonly FlowerThreadSnapshot[]>([]);
  const [selectedThreadID, setSelectedThreadID] = createSignal('');
  const [composerSessionDrafts, setComposerSessionDrafts] = createSignal<Record<string, FlowerComposerSessionDraft>>({});
  const [chatSubmitError, setChatSubmitError] = createSignal('');
  const [inputSubmitError, setInputSubmitError] = createSignal('');
  const [permissionSubmitError, setPermissionSubmitError] = createSignal('');
  const [inputSubmitting, setInputSubmitting] = createSignal(false);
  const [chatRunning, setChatRunning] = createSignal(false);
  const [threadStopping, setThreadStopping] = createSignal(false);
  const [compactSubmitting, setCompactSubmitting] = createSignal(false);
  const [pendingContextCompaction, setPendingContextCompaction] = createSignal<PendingContextCompactionDecoration | null>(null);
  const [pendingTurns, setPendingTurns] = createSignal<readonly PendingFlowerTurn[]>([]);
  const [settingsSaving, setSettingsSaving] = createSignal(false);
  const [threadsRefreshing, setThreadsRefreshing] = createSignal(false);
  const [historyFilter, setHistoryFilter] = createSignal('');
  const [sidePanel, setSidePanel] = createSignal<FlowerSurfacePanel>('chat');
  const [previewChip, setPreviewChip] = createSignal<FlowerChatContextChip | null>(null);

  createEffect(on(
    () => selectedThreadID(),
    (next) => { if (next) setPreviewChip(null); },
    { defer: false },
  ));

  const [isComposing, setIsComposing] = createSignal(false);
  const [handlerState, setHandlerState] = createSignal<FlowerHandlerResolutionState>({ status: 'starting' });
  const [threadLoadError, setThreadLoadError] = createSignal('');
  const [threadActionError, setThreadActionError] = createSignal('');
  const [threadActionSuccess, setThreadActionSuccess] = createSignal('');
  const [localReadVisibilityRevision, setLocalReadVisibilityRevision] = createSignal(0);
  const [threadActionBusy, setThreadActionBusy] = createSignal<{ threadID: string; action: FlowerThreadMenuAction } | null>(null);
  const [renameThreadID, setRenameThreadID] = createSignal('');
  const [renameDraft, setRenameDraft] = createSignal('');
  const [renameError, setRenameError] = createSignal('');
  const [renameSaving, setRenameSaving] = createSignal(false);
  const [loadingThreadID, setLoadingThreadID] = createSignal('');
  const [selectedThreadTailReveal, setSelectedThreadTailReveal] = createSignal<SelectedThreadTailReveal | null>(null);
  const [threadRailWidth, setThreadRailWidth] = createSignal(THREAD_RAIL_WIDTH_DEFAULT);
  const [threadRailResizing, setThreadRailResizing] = createSignal(false);
  const [openActivityRuns, setOpenActivityRuns] = createSignal<Record<string, boolean>>({});
  const [approvalSubmitting, setApprovalSubmitting] = createSignal<Record<string, FlowerApprovalSubmittingState>>({});
  const [composerApprovalError, setComposerApprovalError] = createSignal('');
  const [copiedMessageAction, setCopiedMessageAction] = createSignal('');
  const [copiedApprovalAction, setCopiedApprovalAction] = createSignal('');
  const [transcriptLayoutRevision, setTranscriptLayoutRevision] = createSignal(0);
  const [subagentDropdownOpen, setSubagentDropdownOpen] = createSignal(false);
  const [subagentDropdownPosition, setSubagentDropdownPosition] = createSignal<FlowerFloatingPoint>({ x: 0, y: 0 });
  const [permissionMenuOpen, setPermissionMenuOpen] = createSignal(false);
  const [permissionMenuActiveIndex, setPermissionMenuActiveIndex] = createSignal(0);
  const [pendingPermissionPatch, setPendingPermissionPatch] = createSignal<PendingPermissionPatch | null>(null);
  const [pendingModelPatch, setPendingModelPatch] = createSignal<PendingModelPatch | null>(null);
  const [activeSubagentID, setActiveSubagentID] = createSignal('');
  const [subagentDetail, setSubagentDetail] = createSignal<FlowerSubagentDetail | null>(null);
  const [subagentDetailLoading, setSubagentDetailLoading] = createSignal(false);
  const [subagentDetailLoadingMore, setSubagentDetailLoadingMore] = createSignal(false);
  const [subagentDetailError, setSubagentDetailError] = createSignal('');
  const [subagentDetailTailLoading, setSubagentDetailTailLoading] = createSignal(false);
  const [subagentDetailTailError, setSubagentDetailTailError] = createSignal('');
  const [subagentDetailTailRevision, setSubagentDetailTailRevision] = createSignal(0);
  const [subagentDetailOpenedRevision, setSubagentDetailOpenedRevision] = createSignal(0);
  let threadLoadSequence = 0;
  let threadLocalMutationRevision = 0;
  let threadsRefreshSequence = 0;
  let startedFocusThreadRequestID = '';
  let composerRef: HTMLTextAreaElement | HTMLInputElement | undefined;
  const [modelMenuOpen, setModelMenuOpen] = createSignal(false);
  let modelTriggerRef: HTMLButtonElement | undefined;
  let modelMenuRef: HTMLDivElement | undefined;
  let permissionTriggerRef: HTMLButtonElement | undefined;
  let permissionMenuRef: HTMLDivElement | undefined;
  let subagentTriggerRef: HTMLButtonElement | undefined;
  let subagentDropdownRef: HTMLDivElement | undefined;
  let renameDialogRef: HTMLDivElement | undefined;
  let renameInputRef: HTMLInputElement | undefined;
  let renameRestoreRef: HTMLElement | undefined;
  let subagentDetailTailTimer: number | undefined;
  let subagentDetailTailInFlight: FlowerSubagentDetailTailRequest | null = null;
  let selectedThreadTailRevealFrame = 0;
  let selectedThreadTailRevealTimer: number | undefined;
  let backgroundThreadsRefreshInFlight = false;
  let composerFocusToken = 0;
  const [composerFocusRevision, setComposerFocusRevision] = createSignal(0);
  const selectedThreadLiveRequests = new Map<string, SelectedThreadLiveRequest>();
  let selectedThreadLiveUpdateToken = 0;
  const locallyReadSnapshots = new Map<string, string>();
  const persistingReadThreadIDs = new Set<string>();
  const pendingReadPersistenceSnapshots = new Map<string, FlowerThreadActivitySnapshot>();
  const liveCursors = new Map<string, number>();
  const liveStreamGenerations = new Map<string, number>();
  let copiedMessageResetTimer: number | undefined;
  let copiedApprovalResetTimer: number | undefined;

  const reducedMotionPreferred = (): boolean => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const requestTranscriptAnimationFrame = (callback: FrameRequestCallback): number => {
    if (typeof window.requestAnimationFrame === 'function') {
      return window.requestAnimationFrame(callback);
    }
    return window.setTimeout(() => callback(typeof performance !== 'undefined' ? performance.now() : Date.now()), 16);
  };

  const cancelTranscriptAnimationFrame = (handle: number) => {
    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(handle);
      return;
    }
    window.clearTimeout(handle);
  };
  const transcriptScroll = createFlowerScrollTailController({
    reducedMotionPreferred,
    requestAnimationFrame: requestTranscriptAnimationFrame,
    cancelAnimationFrame: cancelTranscriptAnimationFrame,
  });
  const subagentDetailScroll = createFlowerScrollTailController({
    reducedMotionPreferred,
    requestAnimationFrame: requestTranscriptAnimationFrame,
    cancelAnimationFrame: cancelTranscriptAnimationFrame,
  });
  const selectedThreadTailPreparing = createMemo(() => {
    const pending = selectedThreadTailReveal();
    return Boolean(pending && pending.threadID === selectedThreadID());
  });
  const selectedThreadTailRevealIsCurrent = (threadID: string, sequence: number): boolean => {
    const pending = selectedThreadTailReveal();
    return Boolean(
      pending
      && pending.threadID === threadID
      && pending.sequence === sequence
      && sequence === threadLoadSequence
      && selectedThreadID() === threadID,
    );
  };
  const clearSelectedThreadTailRevealSchedule = () => {
    if (selectedThreadTailRevealFrame) {
      cancelTranscriptAnimationFrame(selectedThreadTailRevealFrame);
      selectedThreadTailRevealFrame = 0;
    }
    if (selectedThreadTailRevealTimer !== undefined) {
      window.clearTimeout(selectedThreadTailRevealTimer);
      selectedThreadTailRevealTimer = undefined;
    }
  };
  const settleSelectedThreadTailReveal = (threadID: string, sequence: number) => {
    if (!selectedThreadTailRevealIsCurrent(threadID, sequence)) return;
    clearSelectedThreadTailRevealSchedule();
    transcriptScroll.scrollToBottom({ smooth: false });
    setSelectedThreadTailReveal(null);
  };
  const scheduleSelectedThreadTailReveal = (threadID: string, sequence: number) => {
    if (!selectedThreadTailRevealIsCurrent(threadID, sequence)) return;
    clearSelectedThreadTailRevealSchedule();
    selectedThreadTailRevealFrame = requestTranscriptAnimationFrame(() => {
      selectedThreadTailRevealFrame = 0;
      settleSelectedThreadTailReveal(threadID, sequence);
    });
    selectedThreadTailRevealTimer = window.setTimeout(() => {
      selectedThreadTailRevealTimer = undefined;
      settleSelectedThreadTailReveal(threadID, sequence);
    }, SELECTED_THREAD_TAIL_REVEAL_FALLBACK_MS);
  };
  const beginSelectedThreadTailReveal = (threadID: string, sequence: number) => {
    clearSelectedThreadTailRevealSchedule();
    setSelectedThreadTailReveal({ threadID, sequence });
  };
  const cancelSelectedThreadTailReveal = () => {
    clearSelectedThreadTailRevealSchedule();
    setSelectedThreadTailReveal(null);
  };

  const selectedThread = createMemo(() => threads().find((thread) => thread.thread_id === selectedThreadID()) ?? null);
  const selectedThreadLiveStatus = createMemo(() => selectedThread()?.status ?? 'idle');
  const selectedThreadHasRunningContextCompaction = createMemo(() => {
    const thread = selectedThread();
    if (!thread) return false;
    return (thread.context_compactions ?? []).some((compaction) => compaction.status === 'compacting')
      || (thread.timeline_decorations ?? []).some((decoration) => (
        decoration.kind === 'context_compaction'
        && decoration.compaction.status === 'compacting'
      ));
  });
  const selectedThreadReadOnlyReason = createMemo(() => trimString(selectedThread()?.read_only_reason));
  const selectedThreadReadOnly = createMemo(() => selectedThreadLiveStatus() === 'read_only' || Boolean(selectedThreadReadOnlyReason()));
  const selectedThreadReadOnlyDisplay = createMemo(() => (
    selectedThreadReadOnlyReason() || subagentsCopy().readOnlyComposerLabel
  ));
  const visibleInputRequest = (thread: FlowerThreadSnapshot | null | undefined): FlowerInputRequest | null => (
    thread?.status === 'waiting_user' ? thread.input_request ?? null : null
  );
  const selectedInputRequest = createMemo(() => visibleInputRequest(selectedThread()));
  const selectedThreadCanStop = createMemo(() => (
    !selectedThreadReadOnly() && !selectedInputRequest() && COMPOSER_STOP_THREAD_STATUSES.has(selectedThreadLiveStatus())
  ));
  const selectedThreadHasContent = createMemo(() => {
    const thread = selectedThread();
    if (!thread) return false;
    return thread.messages.length > 0
      || !!visibleInputRequest(thread)
      || (thread.approval_actions?.length ?? 0) > 0
      || trimString(thread.error?.message) !== '';
  });
  const selectedApprovalActions = createMemo(() => (
    selectedThread()?.approval_actions?.filter((action) => (
      action.status === 'pending' && action.state === 'requested'
      || action.origin === 'delegated_subagent' && action.delivery_state === 'delivery_pending'
      || action.origin === 'delegated_subagent' && action.delivery_state === 'delivery_delivered'
      || action.origin === 'delegated_subagent' && action.delivery_state === 'delivery_failed'
      || action.origin === 'delegated_subagent' && action.delivery_state === 'delivery_ack_unknown'
      || action.origin === 'delegated_subagent' && action.delivery_state === 'delivery_unavailable'
      || action.origin === 'delegated_subagent' && action.status === 'unavailable'
    )) ?? []
  ));
  const approvalActionIsDelegated = (action: FlowerApprovalAction): boolean => action.origin === 'delegated_subagent';
  const approvalActionIsPrimarySurface = (action: FlowerApprovalAction): boolean => (
    !approvalActionIsDelegated(action) || action.surface_role === 'primary_action'
  );
  const approvalActionCanDecide = (action: FlowerApprovalAction): boolean => (
    action.can_approve
    && approvalActionIsPrimarySurface(action)
    && action.status === 'pending'
    && action.state === 'requested'
    && (!approvalActionIsDelegated(action) || !action.delivery_state || action.delivery_state === 'waiting_decision')
  );
  const selectedComposerApprovalActions = createMemo(() => (
    selectedApprovalActions()
      .filter((action) => approvalActionCanDecide(action))
      .sort((left, right) => {
        const requestedDelta = Number(left.requested_at_ms ?? 0) - Number(right.requested_at_ms ?? 0);
        if (requestedDelta !== 0) return requestedDelta;
        const seqDelta = Number(left.expected_seq ?? 0) - Number(right.expected_seq ?? 0);
        if (seqDelta !== 0) return seqDelta;
        return left.action_id.localeCompare(right.action_id);
      })
  ));
  const selectedComposerApprovalAction = createMemo(() => selectedComposerApprovalActions()[0] ?? null);
  const selectedThreadLevelApprovalActions = createMemo(() => {
    const composerActionID = trimString(selectedComposerApprovalAction()?.action_id);
    return selectedApprovalActions().filter((action) => (
      approvalActionIsDelegated(action)
      && approvalActionIsPrimarySurface(action)
      && trimString(action.action_id) !== composerActionID
    ));
  });
  const pendingTurnsForThread = (threadID: string): readonly PendingFlowerTurn[] => {
    const tid = trimString(threadID) || PENDING_NEW_THREAD_ID;
    return pendingTurns().filter((pending) => pending.thread_id === tid);
  };
  const pendingTurnsForSelectedThread = createMemo(() => pendingTurnsForThread(selectedThreadID() || PENDING_NEW_THREAD_ID));
  const hasPendingTurnForSelectedThread = createMemo(() => pendingTurnsForSelectedThread().length > 0);
  const addPendingTurn = (pending: PendingFlowerTurn) => {
    setPendingTurns((current) => [...current.filter((item) => item.message_id !== pending.message_id), pending]);
  };
  const removePendingTurn = (pending: PendingFlowerTurn) => {
    setPendingTurns((current) => current.filter((item) => item.message_id !== pending.message_id));
  };
  const replacePendingTurn = (previous: PendingFlowerTurn, next: PendingFlowerTurn) => {
    setPendingTurns((current) => {
      const nextTurns = current.filter((item) => item.message_id !== previous.message_id);
      if (next.thread_id) nextTurns.push(next);
      return nextTurns;
    });
  };
  const clearPendingTurns = () => setPendingTurns([]);
  const updatePendingTurnsForSelectedThread = (thread: FlowerThreadSnapshot) => {
    const queuedCount = Number(thread.queued_turn_count ?? 0);
    setPendingTurns((current) => current.flatMap((pending) => {
      if (pending.thread_id !== thread.thread_id) return [pending];
      if (pendingTurnCanonicalMessage(thread, pending)) return [];
      if (queuedCount > 0 && pending.state !== 'queued') return [{ ...pending, state: 'queued' }];
      return [pending];
    }));
  };
  const pendingTurnCanonicalMessage = (thread: FlowerThreadSnapshot, pending: PendingFlowerTurn): FlowerChatMessage | null => {
    const prompt = trimString(pending.prompt);
    const messageID = trimString(pending.message_id);
    return (thread.messages ?? []).find((message) => (
      message.role === 'user'
      && (
        trimString(message.id) === messageID
        || (messageID === '' && trimString(message.content) === prompt)
      )
    )) ?? null;
  };
  const pendingContextCompactionVisible = (thread: FlowerThreadSnapshot | null, pending: PendingContextCompactionDecoration | null): boolean => {
    if (!pending) return false;
    if (!thread || trimString(thread.thread_id) !== trimString(pending.thread_id)) return true;
    const pendingOperationID = trimString(pending.decoration.compaction.operation_id);
    const knownOperationIDs = new Set(pending.known_operation_ids.map(trimString).filter(Boolean));
    const isConfirmedCompaction = (compaction: { operation_id?: string; updated_at_ms?: number }) => {
      const operationID = trimString(compaction.operation_id);
      if (pendingOperationID !== '' && operationID === pendingOperationID) return true;
      const status = trimString((compaction as { status?: string }).status);
      if (operationID !== '') {
        if (operationID.startsWith('local:')) return false;
        if (!knownOperationIDs.has(operationID)) return true;
        return status === 'compacting';
      }
      return Number(compaction.updated_at_ms ?? 0) >= pending.started_at_ms;
    };
    if ((thread.context_compactions ?? []).some(isConfirmedCompaction)) return false;
    return !(thread.timeline_decorations ?? []).some((decoration) => (
      decoration.kind === 'context_compaction'
      && isConfirmedCompaction(decoration.compaction)
    ));
  };
  const pendingContextCompactionForSelectedThread = createMemo(() => {
    const pending = pendingContextCompaction();
    return pending?.thread_id === selectedThreadID() ? pending : null;
  });
  const pendingContextCompactionVisibleForSelectedThread = createMemo(() => (
    pendingContextCompactionVisible(selectedThread(), pendingContextCompactionForSelectedThread())
  ));
  const selectedThreadHasQueuedTurns = createMemo(() => Number(selectedThread()?.queued_turn_count ?? 0) > 0);
  const selectedThreadLoading = createMemo(() => trimString(loadingThreadID()) !== '' && loadingThreadID() === selectedThreadID());
  const currentComposerSessionKey = createMemo(() => trimString(selectedThreadID()) || PENDING_NEW_THREAD_ID);
  const currentComposerSessionDraft = createMemo(() => composerSessionDrafts()[currentComposerSessionKey()] ?? emptyFlowerComposerSessionDraft());
  const defaultComposerPermissionType = createMemo<FlowerPermissionType>(() => snapshot()?.config.permission_type ?? 'approval_required');
  const selectedThreadPermissionType = createMemo<FlowerPermissionType>(() => selectedThread()?.permission_type ?? defaultComposerPermissionType());
  const composerPermissionType = createMemo<FlowerPermissionType>(() => {
    const thread = selectedThread();
    if (thread) return thread.permission_type ?? defaultComposerPermissionType();
    return currentComposerSessionDraft().permissionTypeOverride ?? defaultComposerPermissionType();
  });
  const composerPermissionCopy = createMemo(() => copy().settings.permissionTypes[composerPermissionType()]);
  const selectedThreadPreferenceEditable = createMemo(() => {
    if (selectedThreadReadOnly()) return false;
    if (selectedInputRequest()) return false;
    if (selectedThreadHasRunningContextCompaction()) return false;
    const status = selectedThreadLiveStatus();
    return status !== 'running' && status !== 'waiting_approval' && status !== 'waiting_user';
  });
  const composerPermissionInteractive = createMemo(() => (
    !selectedThreadReadOnly()
    && (!selectedThreadID() || typeof props.adapter.setThreadPermissionType === 'function')
  ));
  const permissionPatchPending = createMemo(() => {
    const pending = pendingPermissionPatch();
    if (!pending) return false;
    const threadID = selectedThreadID();
    return threadID ? pending.threadID === threadID : pending.threadID === PENDING_NEW_THREAD_ID;
  });
  const permissionSelectorTitle = createMemo(() => (
    permissionPatchPending()
      ? copy().chat.permissionSelectorSaving
      : `${copy().chat.permissionSelectorLabel}: ${composerPermissionCopy().label}`
  ));
  const updateComposerSessionDraft = (sessionKey: string, updater: (draft: FlowerComposerSessionDraft) => FlowerComposerSessionDraft) => {
    const key = trimString(sessionKey) || PENDING_NEW_THREAD_ID;
    setComposerSessionDrafts((current) => {
      const previous = current[key] ?? emptyFlowerComposerSessionDraft();
      const next = updater(previous);
      if (sameFlowerComposerSessionDraft(previous, next)) return current;
      return { ...current, [key]: next };
    });
  };
  const updateCurrentComposerSessionDraft = (updater: (draft: FlowerComposerSessionDraft) => FlowerComposerSessionDraft) => {
    updateComposerSessionDraft(currentComposerSessionKey(), updater);
  };
  const permissionOptionID = (permissionType: FlowerPermissionType) => `flower-composer-permission-${permissionType}`;
  const clampPermissionMenuIndex = (index: number): number => {
    const count = FLOWER_PERMISSION_TYPES.length;
    return ((index % count) + count) % count;
  };
  const setPermissionMenuIndexForType = (permissionType: FlowerPermissionType) => {
    const index = FLOWER_PERMISSION_TYPES.indexOf(permissionType);
    setPermissionMenuActiveIndex(index >= 0 ? index : 0);
  };
  const permissionMenuItems = () => Array.from(permissionMenuRef?.querySelectorAll<HTMLButtonElement>('.flower-permission-menu-item:not(:disabled)') ?? []);
  const focusPermissionMenuItem = (index: number) => {
    const nextIndex = clampPermissionMenuIndex(index);
    setPermissionMenuActiveIndex(nextIndex);
    queueMicrotask(() => {
      const item = permissionMenuItems().find((button) => button.dataset.permissionType === FLOWER_PERMISSION_TYPES[nextIndex]);
      item?.focus();
    });
  };
  const closePermissionMenu = (restoreFocus = false) => {
    setPermissionMenuOpen(false);
    if (restoreFocus) queueMicrotask(() => permissionTriggerRef?.focus());
  };
  const closeModelMenu = (restoreFocus = false) => {
    setModelMenuOpen(false);
    if (restoreFocus) queueMicrotask(() => modelTriggerRef?.focus());
  };
  const openModelMenu = () => {
    if (!composerModelInteractive() || modelPatchPending()) return;
    setModelMenuOpen(true);
  };
  const handleModelTriggerKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openModelMenu();
    }
  };
  const handleModelMenuKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); closeModelMenu(true); }
  };
  const openPermissionMenu = () => {
    if (!composerPermissionInteractive() || permissionPatchPending()) return;
    setPermissionMenuIndexForType(composerPermissionType());
    setPermissionMenuOpen(true);
    queueMicrotask(() => focusPermissionMenuItem(permissionMenuActiveIndex()));
  };
  const applyThreadPermissionLocally = (threadID: string, permissionType: FlowerPermissionType) => {
    const tid = trimString(threadID);
    if (!tid) return;
    setThreads((current) => {
      let changed = false;
      const next = current.map((thread) => {
        if (thread.thread_id !== tid || thread.permission_type === permissionType) return thread;
        changed = true;
        return {
          ...thread,
          permission_type: permissionType,
          updated_at_ms: Math.max(Number(thread.updated_at_ms ?? 0), Date.now()),
        };
      });
      if (changed) threadLocalMutationRevision += 1;
      return changed ? next : current;
    });
  };
  const applyThreadModelLocally = (threadID: string, modelID: string) => {
    const tid = trimString(threadID);
    const mid = trimString(modelID);
    if (!tid || !mid) return;
    setThreads((current) => {
      let changed = false;
      const next = current.map((thread) => {
        if (thread.thread_id !== tid || thread.model_id === mid) return thread;
        changed = true;
        return {
          ...thread,
          model_id: mid,
          updated_at_ms: Math.max(Number(thread.updated_at_ms ?? 0), Date.now()),
        };
      });
      if (changed) threadLocalMutationRevision += 1;
      return changed ? next : current;
    });
  };
  const applyThreadReasoningLocally = (threadID: string, selection: FlowerReasoningSelection | undefined) => {
    const tid = trimString(threadID);
    if (!tid) return;
    setThreads((current) => {
      let changed = false;
      const next = current.map((thread) => {
        if (thread.thread_id !== tid) return thread;
        if (sameFlowerReasoningSelection(thread.reasoning_selection, selection)) return thread;
        changed = true;
        return {
          ...thread,
          reasoning_selection: selection,
          updated_at_ms: Math.max(Number(thread.updated_at_ms ?? 0), Date.now()),
        };
      });
      if (changed) threadLocalMutationRevision += 1;
      return changed ? next : current;
    });
  };
  const updateComposerModelID = async (modelID: string) => {
    const mid = trimString(modelID);
    if (!mid) return;
    if (!modelSelectOptions().some((option) => option.id === mid)) return;
    const threadID = trimString(selectedThreadID());
    setChatSubmitError('');
    if (!threadID) {
      updateCurrentComposerSessionDraft((draft) => (
        trimString(draft.modelIDOverride) === mid ? draft : { ...draft, modelIDOverride: mid }
      ));
      return;
    }
    if (!props.adapter.setThreadModel || !composerModelInteractive()) return;
    const previous = selectedComposerModelID();
    if (previous === mid) return;
    setPendingModelPatch({ threadID, requested: mid, previous });
    applyThreadModelLocally(threadID, mid);
    try {
      const live = await props.adapter.setThreadModel(threadID, mid);
      const updated = applyLiveBootstrap(live, 'user_action');
      setSelectedThreadID(updated.thread_id);
      setChatSubmitError('');
    } catch (error) {
      applyThreadModelLocally(threadID, previous);
      setChatSubmitError(getErrorMessage(error) || copy().chat.messageErrorFallback);
    } finally {
      setPendingModelPatch((current) => (current?.threadID === threadID && current.requested === mid ? null : current));
    }
  };
  const updateComposerReasoningSelection = async (selection: FlowerReasoningSelection | undefined) => {
    const normalized = serializeFlowerReasoningSelection(selection);
    const threadID = trimString(selectedThreadID());
    setChatSubmitError('');
    if (!threadID || selectedInputRequest()) {
      updateCurrentComposerSessionDraft((draft) => (
        sameFlowerReasoningSelection(draft.reasoningOverride, normalized)
          ? draft
          : { ...draft, reasoningOverride: normalized }
      ));
      return;
    }
    if (!props.adapter.setThreadReasoningSelection || !composerReasoningInteractive()) return;
    const previous = normalizeFlowerReasoningSelection(selectedThread()?.reasoning_selection);
    if (sameFlowerReasoningSelection(previous, normalized)) return;
    applyThreadReasoningLocally(threadID, normalized);
    try {
      const live = await props.adapter.setThreadReasoningSelection(threadID, normalized);
      const updated = applyLiveBootstrap(live, 'user_action');
      setSelectedThreadID(updated.thread_id);
      updateCurrentComposerSessionDraft((draft) => (
        draft.reasoningOverride ? { ...draft, reasoningOverride: undefined } : draft
      ));
      setChatSubmitError('');
    } catch (error) {
      applyThreadReasoningLocally(threadID, previous);
      setChatSubmitError(getErrorMessage(error) || copy().chat.messageErrorFallback);
    }
  };
  const updateComposerPermissionType = async (permissionType: FlowerPermissionType) => {
    const threadID = trimString(selectedThreadID());
    closePermissionMenu(true);
    setPermissionSubmitError('');
    if (!threadID) {
      updateCurrentComposerSessionDraft((draft) => (
        draft.permissionTypeOverride === permissionType
          ? draft
          : { ...draft, permissionTypeOverride: permissionType }
      ));
      return;
    }
    if (!props.adapter.setThreadPermissionType || !composerPermissionInteractive()) return;
    const previous = selectedThreadPermissionType();
    if (previous === permissionType) return;
    setPendingPermissionPatch({ threadID, requested: permissionType, previous });
    applyThreadPermissionLocally(threadID, permissionType);
    try {
      const live = await props.adapter.setThreadPermissionType(threadID, permissionType);
      const updated = applyLiveBootstrap(live, 'user_action');
      setSelectedThreadID(updated.thread_id);
      setPermissionSubmitError('');
    } catch (error) {
      applyThreadPermissionLocally(threadID, previous);
      try {
        await reloadSelectedThread(threadID, threadLoadSequence, 'user_action');
      } catch {
        // Keep the concise permission error; the previous snapshot has already been restored locally.
      }
      setPermissionSubmitError(getErrorMessage(error));
    } finally {
      setPendingPermissionPatch((pending) => (
        pending?.threadID === threadID && pending.requested === permissionType ? null : pending
      ));
    }
  };
  const handlePermissionTriggerKeyDown = (event: KeyboardEvent) => {
    if (!composerPermissionInteractive() || permissionPatchPending()) return;
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openPermissionMenu();
      if (event.key === 'ArrowUp') {
        queueMicrotask(() => focusPermissionMenuItem(FLOWER_PERMISSION_TYPES.length - 1));
      }
    }
  };
  const handlePermissionMenuKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePermissionMenu(true);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusPermissionMenuItem(permissionMenuActiveIndex() + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusPermissionMenuItem(permissionMenuActiveIndex() - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusPermissionMenuItem(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusPermissionMenuItem(FLOWER_PERMISSION_TYPES.length - 1);
    }
  };
  const requestComposerFocus = () => {
    setComposerFocusRevision((revision) => revision + 1);
  };
  const scheduleComposerFocus = () => {
    if (typeof queueMicrotask === 'undefined') return;
    const token = ++composerFocusToken;
    queueMicrotask(() => {
      if (token !== composerFocusToken) return;
      composerRef?.focus();
    });
  };
  onCleanup(() => {
    composerFocusToken += 1;
  });
  const warmupState = createMemo(() => props.warmup?.active ? props.warmup : null);
  const surfaceWarmupActive = createMemo(() => warmupState() !== null);
  const warmupCanReplaceTranscript = createMemo(() => (
    surfaceWarmupActive()
    && !selectedThreadHasContent()
    && !hasPendingTurnForSelectedThread()
    && !selectedThreadLoading()
  ));
  const warmupTitle = createMemo(() => trimString(warmupState()?.title) || copy().chat.warmupTitle);
  const warmupDetail = createMemo(() => trimString(warmupState()?.detail) || copy().chat.warmupDetail);
  const warmupPhaseLabel = createMemo(() => trimString(warmupState()?.phaseLabel) || copy().chat.loadingSettings);
  const warmupModelLabel = createMemo(() => trimString(warmupState()?.modelLabel) || copy().chat.warmupModelLabel);

  const presentRunError = (error: FlowerThreadSnapshot['error']): string => {
    const code = trimString(error?.code);
    switch (code) {
      case 'provider_auth_failed':
        return copy().chat.runErrors.providerAuthFailed;
      case 'provider_missing_key':
        return copy().chat.runErrors.providerMissingKey;
      case 'provider_rate_limited':
        return copy().chat.runErrors.providerRateLimited;
      case 'provider_unreachable':
        return copy().chat.runErrors.providerUnreachable;
      case 'provider_model_unavailable':
        return copy().chat.runErrors.providerModelUnavailable;
      case 'floret_engine_failed':
        return copy().chat.runErrors.floretEngineFailed;
      case 'runtime_restarted':
        return copy().chat.runErrors.runtimeRestarted;
      default:
        return trimString(error?.message);
    }
  };
  const selectedThreadRunErrorMessage = createMemo(() => presentRunError(selectedThread()?.error));
  const threadItemCache = new Map<string, { item: ReturnType<typeof projectFlowerThreadListItem>; sig: string }>();
  const liveCursorValue = (value: unknown): number => Math.max(0, Math.floor(Number(value ?? 0)));
  const liveStreamGenerationValue = (value: unknown): number => {
    const generation = Math.floor(Number(value ?? 1));
    return Number.isFinite(generation) && generation > 0 ? generation : 1;
  };
  const setLivePosition = (threadID: string, streamGeneration: unknown, cursor: unknown) => {
    const tid = trimString(threadID);
    if (!tid) return;
    const nextGeneration = liveStreamGenerationValue(streamGeneration);
    const currentGeneration = liveStreamGenerationValue(liveStreamGenerations.get(tid));
    const nextCursor = liveCursorValue(cursor);
    if (nextGeneration > currentGeneration) {
      liveStreamGenerations.set(tid, nextGeneration);
      liveCursors.set(tid, nextCursor);
      return;
    }
    if (nextGeneration === currentGeneration) {
      liveStreamGenerations.set(tid, nextGeneration);
      liveCursors.set(tid, Math.max(liveCursorValue(liveCursors.get(tid)), nextCursor));
    }
  };
  type LiveBootstrapApplyReason = 'initial_load' | 'user_action' | 'resync_reload' | 'background_refresh';
  const liveBootstrapIsCurrent = (live: FlowerLiveBootstrap, reason: LiveBootstrapApplyReason): boolean => {
    const tid = trimString(live.thread_id || live.thread.thread_id);
    if (!tid) return true;
    const incomingGeneration = liveStreamGenerationValue(live.stream_generation);
    const currentGeneration = liveStreamGenerationValue(liveStreamGenerations.get(tid));
    if (incomingGeneration > currentGeneration) return true;
    if (incomingGeneration < currentGeneration) return false;
    const incomingCursor = liveCursorValue(live.cursor);
    const currentCursor = liveCursorValue(liveCursors.get(tid));
    if (reason === 'resync_reload') return incomingCursor >= currentCursor;
    return incomingCursor >= currentCursor;
  };
  const readStatusWithUnread = (thread: FlowerThreadSnapshot, isUnread: boolean): FlowerThreadSnapshot => (
    thread.read_status.is_unread === isUnread
      ? thread
      : { ...thread, read_status: { ...thread.read_status, is_unread: isUnread } }
  );
  const threadWithLocalReadVisibility = (thread: FlowerThreadSnapshot): FlowerThreadSnapshot => {
    if (!thread.read_status.is_unread) return thread;
    const localKey = locallyReadSnapshots.get(thread.thread_id);
    if (!localKey || localKey !== flowerThreadReadSnapshotKey(thread.read_status.snapshot)) {
      return thread;
    }
    return readStatusWithUnread(thread, false);
  };
  const threadWithReadStatus = (thread: FlowerThreadSnapshot, readStatus: FlowerThreadReadStatus): FlowerThreadSnapshot => ({
    ...thread,
    read_status: readStatus,
  });
  const applyThreadReadStatus = (threadID: string, readStatus: FlowerThreadReadStatus) => {
    const tid = trimString(threadID);
    if (!tid) return;
    setThreads((items) => items.map((thread) => (
      thread.thread_id === tid ? threadWithReadStatus(thread, readStatus) : thread
    )));
  };
  const threadItemSignature = (t: FlowerThreadSnapshot): string => {
    const visibleThread = threadWithLocalReadVisibility(t);
    const stableLiveSidebar = SIDEBAR_STABLE_LIVE_STATUSES.has(t.status);
    return [
      t.thread_id,
      t.status,
      t.title,
      String(Number(t.pinned_at_ms ?? 0) > 0),
      String(Number(t.pinned_at_ms ?? 0)),
      String(t.created_at_ms),
      t.source_label ?? '',
      t.model_id ?? '',
      t.target_labels?.join('\x1e') ?? '',
      t.working_dir ?? '',
      t.owner_kind ?? '',
      t.owner_id ?? '',
      t.parent_thread_id ?? '',
      t.read_only_reason ?? '',
      stableLiveSidebar ? 'live' : String(visibleThread.read_status.is_unread),
      stableLiveSidebar ? 'live' : flowerThreadReadSnapshotKey(t.read_status.snapshot),
    ].join('\x1f');
  };
  const sidebarItemSignature = (t: FlowerThreadListItem): string => [
    t.thread_id,
    t.status,
    t.title,
    String(t.pinned),
    String(t.pinned_at_ms ?? 0),
    String(t.created_at_ms),
    t.source_label,
    t.model_id,
    t.target_labels.join('\x1e'),
    t.working_dir,
    t.owner_kind ?? '',
    t.owner_id ?? '',
    t.parent_thread_id ?? '',
    t.read_only_reason ?? '',
    SIDEBAR_STABLE_LIVE_STATUSES.has(t.status) ? 'live' : String(t.read_status.is_unread),
    SIDEBAR_STABLE_LIVE_STATUSES.has(t.status) ? 'live' : flowerThreadReadSnapshotKey(t.read_status.snapshot),
  ].join('\x1f');
  const threadItems = createMemo(() => {
    localReadVisibilityRevision();
    return threads().map((t) => {
      const visibleThread = threadWithLocalReadVisibility(t);
      const sig = threadItemSignature(t);
      const cached = threadItemCache.get(t.thread_id);
      if (cached && cached.sig === sig) {
        return cached.item;
      }
      const item = projectFlowerThreadListItem(visibleThread);
      threadItemCache.set(t.thread_id, { item, sig });
      return item;
    });
  });
  // Stable sidebar list items: only updates when sidebar-visible fields change.
  // Detail refreshes can update the selected thread transcript frequently; the
  // sidebar must not receive a new item array unless its own visible model changed.
  const [sidebarListItems, setSidebarListItems] = createSignal<ReturnType<typeof threadItems>>([]);
  let lastSidebarListSignature: string | null = null;
  createEffect(() => {
    const items = threadItems();
    const signature = items.map(sidebarItemSignature).join('\x1d');
    if (signature === lastSidebarListSignature) return;
    lastSidebarListSignature = signature;
    setSidebarListItems(items);
  });

  createEffect(() => {
    const dropdownOpen = subagentDropdownOpen();
    if (!dropdownOpen) return;
    updateSubagentDropdownPosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (subagentTriggerRef?.contains(target) || subagentDropdownRef?.contains(target)) {
        return;
      }
      setSubagentDropdownOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSubagentDropdownOpen(false);
      subagentTriggerRef?.focus();
    };
    const onReposition = () => updateSubagentDropdownPosition();
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    onCleanup(() => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    });
  });

  createEffect(() => {
    if (!permissionMenuOpen()) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (permissionTriggerRef?.contains(target) || permissionMenuRef?.contains(target)) return;
      closePermissionMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closePermissionMenu(true);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    });
  });

  createEffect(() => {
    if (!permissionMenuOpen()) return;
    if (!composerPermissionInteractive() || permissionPatchPending()) {
      closePermissionMenu(false);
    }
  });

  createEffect(() => {
    if (!modelMenuOpen()) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (modelTriggerRef?.contains(target) || modelMenuRef?.contains(target)) return;
      closeModelMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeModelMenu(true);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    });
  });

  const renameOriginalTitle = createMemo(() => threads().find((thread) => thread.thread_id === renameThreadID())?.title ?? '');
  const renameUnchanged = createMemo(() => trimString(renameDraft()) === trimString(renameOriginalTitle()));
  const currentModelID = createMemo(() => trimString(snapshot()?.config.current_model_id));
  const selectedComposerModelID = createMemo(() => {
    const threadModelID = trimString(selectedThread()?.model_id);
    if (threadModelID) return threadModelID;
    return trimString(currentComposerSessionDraft().modelIDOverride) || currentModelID();
  });
  const activeProvider = createMemo(() => {
    const current = selectedComposerModelID();
    const providerID = current.split('/')[0] ?? '';
    return snapshot()?.config.providers.find((provider) => provider.id === providerID) ?? null;
  });
  const currentModelLabel = createMemo(() => {
    const current = snapshot();
    return current ? formatFlowerCurrentModelLabel(current.config, copy().chat.noModelSelected) : copy().chat.noModelSelected;
  });
  const selectedThreadModelLabel = createMemo(() => {
    const threadModelID = selectedComposerModelID();
    if (!threadModelID) return currentModelLabel();
    const current = snapshot();
    if (!current) return threadModelID;
    return formatFlowerCurrentModelLabel({ ...current.config, current_model_id: threadModelID }, copy().chat.noModelSelected);
  });
  type ComposerModelOption = Readonly<{ id: string; label: string; providerLabel: string; providerType?: FlowerProviderType; supportsImageInput: boolean; contextWindow?: number; maxOutputTokens?: number }>;
  const modelSelectOptions = createMemo(() => {
    const current = snapshot();
    const options = current?.config.providers.flatMap((provider) => {
      const providerID = trimString(provider.id);
      if (!providerID) return [];
      const providerLabel = trimString(provider.name) || providerID;
      return provider.models.map((model) => {
        const modelName = trimString(model.model_name);
        if (!modelName) return null;
        return {
          id: `${providerID}/${modelName}`,
          label: `${providerLabel} / ${modelName}`,
          providerLabel,
          providerType: provider.type,
          supportsImageInput: flowerModelSupportsImage(model.input_modalities),
          ...(model.context_window != null ? { contextWindow: model.context_window } : {}),
          ...(model.max_output_tokens != null ? { maxOutputTokens: model.max_output_tokens } : {}),
        } as ComposerModelOption;
      }).filter((option): option is ComposerModelOption => option !== null);
    }) ?? [];
    const selected = selectedComposerModelID();
    if (selected && !options.some((option) => option.id === selected)) {
      const label = selectedThreadModelLabel();
      return [{ id: selected, label, providerLabel: '', supportsImageInput: false } as ComposerModelOption, ...options];
    }
    return options;
  });
  const configuredModelForID = (modelID: string) => {
    const current = snapshot();
    const [providerID, ...modelParts] = trimString(modelID).split('/');
    const modelName = modelParts.join('/');
    if (!current || !providerID || !modelName) return null;
    return current.config.providers
      .find((provider) => provider.id === providerID)
      ?.models.find((model) => model.model_name === modelName) ?? null;
  };
  const selectedReasoningCapability = createMemo(() => {
    const thread = selectedThread();
    if (thread?.reasoning_capability) return thread.reasoning_capability;
    const model = configuredModelForID(selectedComposerModelID());
    return model?.reasoning_capability ?? null;
  });
	const selectedThreadReasoningSelection = createMemo(() => (
		normalizeFlowerReasoningSelection(selectedThread()?.reasoning_selection)
		?? normalizeFlowerReasoningSelection(configuredModelForID(selectedComposerModelID())?.default_reasoning_selection)
		?? defaultReasoningSelectionForCapability(selectedReasoningCapability())
	));
	const selectedWaitingReasoningSelection = createMemo(() => normalizeFlowerReasoningSelection(selectedInputRequest()?.reasoning_selection));
	const composerReasoningOverride = createMemo(() => normalizeFlowerReasoningSelection(currentComposerSessionDraft().reasoningOverride));
	const composerReasoningSelection = createMemo(() => composerReasoningOverride() ?? selectedWaitingReasoningSelection() ?? selectedThreadReasoningSelection());
  const composerReasoningEnabled = createMemo(() => reasoningCapabilitySupportsControl(selectedReasoningCapability()));
  const modelPatchPending = createMemo(() => {
    const pending = pendingModelPatch();
    if (!pending) return false;
    const threadID = selectedThreadID();
    return threadID ? pending.threadID === threadID : pending.threadID === PENDING_NEW_THREAD_ID;
  });
  const composerModelInteractive = createMemo(() => (
    selectedThreadPreferenceEditable()
    && modelSelectOptions().length > 0
    && (!selectedThreadID() || typeof props.adapter.setThreadModel === 'function')
  ));
  const composerReasoningInteractive = createMemo(() => (
    composerReasoningEnabled()
    && (selectedInputRequest() ? !selectedThreadReadOnly() : selectedThreadPreferenceEditable())
    && (!selectedThreadID() || selectedInputRequest() || typeof props.adapter.setThreadReasoningSelection === 'function')
  ));
  const activeProviderSecrets = createMemo(() => {
    const provider = activeProvider();
    if (!provider) return null;
    return snapshot()?.provider_secrets.find((secret) => secret.provider_id === provider.id) ?? null;
  });
  const modelSource = createMemo(() => snapshot()?.model_source ?? null);
  const externalModelSourceReady = createMemo(() => {
    const source = modelSource();
    return source?.kind === 'desktop_model_source' && source.ready && !!currentModelID();
  });
  const readyForChat = createMemo(() => {
    if (externalModelSourceReady()) return true;
    const provider = activeProvider();
    const secrets = activeProviderSecrets();
    if (!currentModelID() || !provider || !secrets?.provider_api_key_configured) return false;
    return provider.web_search?.mode !== 'brave' || Boolean(secrets.web_search_api_key_configured);
  });
  const currentHandlerDecision = createMemo(() => {
    const state = handlerState();
    return 'decision' in state ? state.decision : null;
  });
  const handlerAllowsSubmitIntent = createMemo(() => {
    const state = handlerState();
    if (state.status === 'blocked' || state.status === 'failed') return false;
    if (state.status !== 'ready') return true;
    const decision = state.decision;
    return !!decision?.selected_handler && !decision.blocker && decision.route !== 'blocked';
  });
  const handlerNotice = createMemo(() => {
    const state = handlerState();
    if (state.status === 'blocked' && readyForChat()) {
      return { title: copy().chat.handlerBlockedTitle, message: state.message };
    }
    if (state.status === 'failed') {
      return { title: copy().chat.handlerStartFailedTitle, message: state.message };
    }
    return null;
  });
  const needsSetup = createMemo(() => !!snapshot() && !readyForChat());

  const handlerStateFromDecision = (decision: FlowerRouterDecision): FlowerHandlerResolutionState => {
    if (decision.selected_handler && !decision.blocker && decision.route !== 'blocked') {
      return { status: 'ready', decision };
    }
    return {
      status: 'blocked',
      decision,
      message: trimString(decision.blocker?.message) || trimString(decision.primary_message) || copy().chat.handlerBlockedTitle,
    };
  };

  const resolveHandlerDecision = async (requestedHandlerID?: string, previousDecision?: FlowerRouterDecision | null) => {
    const baseDecision = previousDecision ?? currentHandlerDecision();
    setHandlerState({ status: 'resolving', decision: baseDecision });
    try {
      const next = await props.adapter.resolveHandler({
        thread_kind: 'chat',
        client_surface: baseDecision?.decision_scope.client_surface || 'flower_surface',
        ...(baseDecision?.decision_scope.context_envelope_id ? { context_envelope_id: baseDecision.decision_scope.context_envelope_id } : {}),
        ...(trimString(requestedHandlerID) ? { requested_handler_id: trimString(requestedHandlerID) } : {}),
      });
      setHandlerState(handlerStateFromDecision(next));
      return next;
    } catch (error) {
      const message = getErrorMessage(error);
      setHandlerState({ status: 'failed', decision: baseDecision, message });
      throw new Error(message);
    }
  };

  const upsertThread = (thread: FlowerThreadSnapshot) => {
    setThreads((current) => {
      const existingIndex = current.findIndex((item) => item.thread_id === thread.thread_id);
      if (existingIndex < 0) {
        threadLocalMutationRevision += 1;
        return [thread, ...current];
      }
      if (sameThreadSnapshot(current[existingIndex], thread)) {
        return current;
      }
      const next = [...current];
      next[existingIndex] = thread;
      threadLocalMutationRevision += 1;
      return next;
    });
  };
  const applyLiveBootstrap = (live: FlowerLiveBootstrap, reason: LiveBootstrapApplyReason = 'background_refresh'): FlowerThreadSnapshot => {
    const thread = projectFlowerLiveBootstrap(live);
    if (!liveBootstrapIsCurrent(live, reason)) {
      return threads().find((item) => item.thread_id === thread.thread_id) ?? thread;
    }
    const previous = threads().find((item) => item.thread_id === thread.thread_id);
    setLivePosition(thread.thread_id, live.stream_generation, live.cursor);
    upsertThread(thread);
    if (
      previous
      && previous.model_id !== thread.model_id
      && !sameFlowerReasoningSelection(previous.reasoning_selection, thread.reasoning_selection)
    ) {
      setThreadActionSuccess('Reasoning adjusted for this model.');
    }
    return thread;
  };
  const reloadSelectedThread = async (
    threadID: string,
    sequence = threadLoadSequence,
    reason: LiveBootstrapApplyReason = 'background_refresh',
  ): Promise<FlowerThreadSnapshot | null> => {
    const tid = trimString(threadID);
    if (!tid) return null;
    const live = await props.adapter.loadThread(tid);
    if (sequence !== threadLoadSequence || selectedThreadID() !== tid) {
      const projected = projectFlowerLiveBootstrap(live);
      return threads().find((item) => item.thread_id === tid) ?? projected;
    }
    const thread = applyLiveBootstrap(live, reason);
    if (thread.read_status.is_unread) {
      persistThreadRead(tid, thread.read_status.snapshot, sequence);
    }
    setThreadLoadError('');
    return thread;
  };

  const scrollSelectedThreadToLatestAfterLayout = (threadID: string, sequence: number) => {
    const tid = trimString(threadID);
    if (!tid) return;
    const interruptionRevision = transcriptScroll.userInterruptionRevision();
    requestTranscriptAnimationFrame(() => {
      if (sequence !== threadLoadSequence || selectedThreadID() !== tid) return;
      if (selectedThreadTailRevealIsCurrent(tid, sequence)) {
        settleSelectedThreadTailReveal(tid, sequence);
        return;
      }
      if (transcriptScroll.userInterruptionRevision() !== interruptionRevision) return;
      transcriptScroll.scheduleTailScroll({ smooth: false });
    });
  };

  const markThreadReadLocally = (threadID: string, snapshot: FlowerThreadActivitySnapshot) => {
    const tid = trimString(threadID);
    if (!tid) return;
    const key = flowerThreadReadSnapshotKey(snapshot);
    if (!key) return;
    locallyReadSnapshots.set(tid, key);
    setLocalReadVisibilityRevision((revision) => revision + 1);
  };

  const clearLocalReadVisibility = (threadID: string) => {
    const tid = trimString(threadID);
    if (!tid) return;
    if (locallyReadSnapshots.delete(tid)) {
      setLocalReadVisibilityRevision((revision) => revision + 1);
    }
  };

  const persistThreadRead = (threadID: string, snapshot: FlowerThreadActivitySnapshot, sequence: number) => {
    const tid = trimString(threadID);
    if (!tid) return;
    markThreadReadLocally(tid, snapshot);
    const submittedSnapshotKey = flowerThreadReadSnapshotKey(snapshot);
    if (persistingReadThreadIDs.has(tid)) {
      pendingReadPersistenceSnapshots.set(tid, snapshot);
      return;
    }
    persistingReadThreadIDs.add(tid);
    const readPromise = props.adapter.markThreadRead(tid, snapshot)
      .catch(() => null);
    void readPromise
      .then((readStatus) => {
        if (!readStatus) {
          clearLocalReadVisibility(tid);
          return;
        }
        if (sequence === threadLoadSequence && selectedThreadID() === tid) {
          applyThreadReadStatus(tid, readStatus);
          if (readStatus.is_unread) {
            const nextSnapshotKey = flowerThreadReadSnapshotKey(readStatus.snapshot);
            if (nextSnapshotKey && nextSnapshotKey !== submittedSnapshotKey) {
              pendingReadPersistenceSnapshots.set(tid, readStatus.snapshot);
            }
          }
        }
        clearLocalReadVisibility(tid);
      })
      .finally(() => {
        persistingReadThreadIDs.delete(tid);
        const pendingSnapshot = pendingReadPersistenceSnapshots.get(tid);
        pendingReadPersistenceSnapshots.delete(tid);
        if (!pendingSnapshot) return;
        if (sequence !== threadLoadSequence || selectedThreadID() !== tid) return;
        persistThreadRead(tid, pendingSnapshot, sequence);
      });
  };

  const writeClipboardText = async (value: string, label: string) => {
    const text = trimString(value);
    if (!text) return;
    await writeTextToClipboard(text);
    setThreadActionSuccess(copy().threadList.copied(label));
  };

  const openRenameDialog = (threadID: string, title: string, restore?: HTMLElement) => {
    setRenameThreadID(trimString(threadID));
    setRenameDraft(title);
    setRenameError('');
    setThreadActionError('');
    renameRestoreRef = restore;
    queueMicrotask(() => {
      renameInputRef?.focus();
      renameInputRef?.select();
    });
  };

  const closeRenameDialog = () => {
    if (renameSaving()) return;
    setRenameThreadID('');
    setRenameDraft('');
    setRenameError('');
    renameRestoreRef?.focus();
    renameRestoreRef = undefined;
  };

  const submitRename = async () => {
    const threadID = renameThreadID();
    if (!threadID || !props.adapter.renameThread || renameUnchanged()) return;
    setRenameSaving(true);
    setThreadActionError('');
    setRenameError('');
    try {
      applyLiveBootstrap(await props.adapter.renameThread(threadID, renameDraft()));
      setRenameThreadID('');
      setRenameDraft('');
      renameRestoreRef?.focus();
      renameRestoreRef = undefined;
    } catch (error) {
      setRenameError(getErrorMessage(error));
    } finally {
      setRenameSaving(false);
    }
  };

  const focusRenameDialogEdge = (edge: 'first' | 'last') => {
    const items = Array.from(renameDialogRef?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? []);
    if (items.length === 0) return;
    items[edge === 'first' ? 0 : items.length - 1]?.focus();
  };

  const restoreThreadMenuFocus = (restore?: HTMLElement) => {
    if (!restore) return;
    queueMicrotask(() => {
      if (document.contains(restore)) {
        restore.focus();
      }
    });
  };

  const handleThreadMenuAction = async (action: FlowerThreadMenuAction, item: FlowerThreadListItem, restore?: HTMLElement) => {
    if (threadActionBusy()) {
      restoreThreadMenuFocus(restore);
      return;
    }
    setThreadActionError('');
    setThreadActionSuccess('');
    const shouldRestoreFocus = action !== 'rename';
    try {
      switch (action) {
        case 'copy_thread_id':
          await writeClipboardText(item.thread_id, copy().threadList.threadIDLabel);
          return;
        case 'copy_workdir':
          await writeClipboardText(item.working_dir, copy().threadList.workingDirectoryLabel);
          return;
        case 'rename':
          if (!props.adapter.renameThread) return;
          openRenameDialog(item.thread_id, item.title, restore);
          return;
        case 'pin':
          if (!props.adapter.setThreadPinned) return;
          setThreadActionBusy({ threadID: item.thread_id, action });
          applyLiveBootstrap(await props.adapter.setThreadPinned(item.thread_id, !item.pinned));
          return;
        case 'fork':
          if (!props.adapter.forkThread) return;
          setThreadActionBusy({ threadID: item.thread_id, action });
          {
            const forked = applyLiveBootstrap(await props.adapter.forkThread(item.thread_id));
            await loadAndSelectThread(forked.thread_id);
          }
          return;
        default:
          return;
      }
    } catch (error) {
      setThreadActionError(getErrorMessage(error));
    } finally {
      setThreadActionBusy(null);
      if (shouldRestoreFocus) {
        restoreThreadMenuFocus(restore);
      }
    }
  };

  const loadAndSelectThread = async (threadID: string) => {
    const tid = trimString(threadID);
    if (!tid) return;
    closeSubagentOverlays();
    const sequence = ++threadLoadSequence;
    const existing = threads().find((thread) => thread.thread_id === tid) ?? null;
    transcriptScroll.startFollowing();
    beginSelectedThreadTailReveal(tid, sequence);
    setSelectedThreadID(tid);
    scheduleSelectedThreadTailReveal(tid, sequence);
    setChatSubmitError('');
    setInputSubmitError('');
    setPermissionSubmitError('');
    setThreadLoadError('');
    setThreadActionError('');
    returnToChat();
    if (existing?.read_status.is_unread) {
      persistThreadRead(tid, existing.read_status.snapshot, sequence);
    }
    setLoadingThreadID(tid);
    try {
      const live = await props.adapter.loadThread(tid);
      if (sequence !== threadLoadSequence || selectedThreadID() !== tid) return;
      const thread = applyLiveBootstrap(live, 'initial_load');
      if (thread.read_status.is_unread) {
        persistThreadRead(tid, thread.read_status.snapshot, sequence);
      }
      setSelectedThreadID(thread.thread_id);
      setLoadingThreadID('');
      setTranscriptLayoutRevision((revision) => revision + 1);
      if (selectedThreadTailRevealIsCurrent(thread.thread_id, sequence)) {
        scheduleSelectedThreadTailReveal(thread.thread_id, sequence);
      } else {
        scrollSelectedThreadToLatestAfterLayout(thread.thread_id, sequence);
      }
      requestComposerFocus();
    } catch (error) {
      if (sequence !== threadLoadSequence) return;
      setLoadingThreadID('');
      if (selectedThreadTailRevealIsCurrent(tid, sequence)) {
        cancelSelectedThreadTailReveal();
      }
      setThreadLoadError(getErrorMessage(error));
    }
  };

  const focusThreadFromRequest = async (requestID: string, threadID: string) => {
    const tid = trimString(threadID);
    if (!tid) {
      props.onFocusThreadRequestConsumed?.(requestID);
      return;
    }
    props.onFocusThreadRequestConsumed?.(requestID);
    await loadAndSelectThread(tid);
  };

  const refreshSelectedThread = async (threadID: string) => {
    const tid = trimString(threadID);
    try {
      await reloadSelectedThread(tid, threadLoadSequence, 'user_action');
    } catch (error) {
      setThreadLoadError(getErrorMessage(error));
    }
  };

  const refreshThreads = async (): Promise<boolean> => {
    const refreshSequence = ++threadsRefreshSequence;
    const startedMutationRevision = threadLocalMutationRevision;
    setThreadsRefreshing(true);
    try {
      const next = await props.adapter.listThreads();
      if (refreshSequence !== threadsRefreshSequence) {
        return false;
      }
      setLoadError('');
      const selectedID = selectedThreadID();
      const previousSelected = threads().find((thread) => thread.thread_id === selectedID) ?? null;
      const selectedSummary = next.find((thread) => thread.thread_id === selectedID) ?? null;
      if (selectedID && selectedSummary?.read_status.is_unread) {
        persistThreadRead(selectedID, selectedSummary.read_status.snapshot, threadLoadSequence);
      }
      let mergedThreads: readonly FlowerThreadSnapshot[] = [];
      setThreads((current) => {
        mergedThreads = mergeFlowerThreadListRefresh(current, next, {
          selectedThreadID: selectedID,
          pendingThreadIDs: pendingTurns().map((pending) => pending.thread_id),
          preserveMissingCurrentThreads: startedMutationRevision !== threadLocalMutationRevision,
          sameThreadSnapshot,
        });
        return mergedThreads;
      });
      setSelectedThreadID((current) => {
        if (current && !mergedThreads.some((thread) => thread.thread_id === current)) {
          closeSubagentOverlays();
          return '';
        }
        return current;
      });
      if (
        selectedID
        && previousSelected
        && selectedSummary
        && (
          previousSelected.updated_at_ms !== selectedSummary.updated_at_ms
          || previousSelected.status !== selectedSummary.status
          || flowerThreadReadSnapshotKey(previousSelected.read_status.snapshot) !== flowerThreadReadSnapshotKey(selectedSummary.read_status.snapshot)
        )
      ) {
        void refreshSelectedThread(selectedID);
      }
      return true;
    } catch (error) {
      setLoadError(getErrorMessage(error));
      return false;
    } finally {
      setThreadsRefreshing(false);
    }
  };

  const loadSurface = async () => {
    const startedMutationRevision = threadLocalMutationRevision;
    try {
      const next = await props.adapter.loadSettings();
      setSnapshot(next);
      setLoadError('');
      await resolveHandlerDecision().catch(() => undefined);
      if (startedMutationRevision === threadLocalMutationRevision) {
        await refreshThreads();
      }
    } catch (error) {
      setLoadError(getErrorMessage(error));
    }
  };

  onMount(() => {
    setThreadRailWidth(loadThreadRailWidth());
    void loadSurface();
  });

  createEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(THREAD_RAIL_WIDTH_STORAGE_KEY, String(threadRailWidth()));
  });

  createEffect(() => {
    const request = props.focusThreadRequest;
    const requestID = trimString(request?.request_id);
    const focusedThreadID = trimString(request?.thread_id);
    if (!requestID || requestID === startedFocusThreadRequestID) {
      return;
    }
    startedFocusThreadRequestID = requestID;
    if (!focusedThreadID) {
      props.onFocusThreadRequestConsumed?.(requestID);
      return;
    }
    untrack(() => {
      void focusThreadFromRequest(requestID, focusedThreadID);
    });
  });

  createEffect(() => {
    if (composerFocusRevision() <= 0) return;
    scheduleComposerFocus();
  });

  const applySelectedThreadLiveEvents = async (threadID: string, sequence: number) => {
    const tid = trimString(threadID);
    if (!tid) return;
    const existingRequest = selectedThreadLiveRequests.get(tid);
    if (existingRequest && existingRequest.sequence === sequence) return;
    const token = selectedThreadLiveUpdateToken + 1;
    selectedThreadLiveUpdateToken = token;
    selectedThreadLiveRequests.set(tid, { token, sequence });
    let cursor = liveCursorValue(liveCursors.get(tid));
    let streamGeneration = liveStreamGenerationValue(liveStreamGenerations.get(tid));
    try {
      let keepGoing = true;
      while (keepGoing && sequence === threadLoadSequence && selectedThreadID() === tid) {
        keepGoing = false;
        const requestedCursor = cursor;
        const response = await withTimeout(
          props.adapter.listThreadLiveEvents(tid, cursor, 100),
          SELECTED_THREAD_LIVE_EVENTS_TIMEOUT_MS,
        );
        if (sequence !== threadLoadSequence || selectedThreadID() !== tid) {
          return;
        }
        const responseGeneration = liveStreamGenerationValue(response.stream_generation);
        const currentGeneration = liveStreamGenerationValue(liveStreamGenerations.get(tid));
        if (responseGeneration > currentGeneration && requestedCursor > 0) {
          streamGeneration = responseGeneration;
          cursor = 0;
          liveStreamGenerations.set(tid, responseGeneration);
          liveCursors.set(tid, 0);
          keepGoing = true;
          continue;
        }
        if (
          currentGeneration > responseGeneration
          || (currentGeneration === responseGeneration && liveCursorValue(liveCursors.get(tid)) > requestedCursor)
        ) {
          return;
        }
        streamGeneration = responseGeneration;
        let resyncRequired = false;
        let threadState = threads().find((thread) => thread.thread_id === tid) ?? null;
        if (!threadState) {
          resyncRequired = true;
        } else {
          let shouldPersistRead = false;
          let nextReadSnapshot: FlowerThreadActivitySnapshot | null = null;
          let shouldScrollTail = false;
          let appliedSincePaint = 0;
          const commitLiveThreadState = (nextThread: FlowerThreadSnapshot) => {
            upsertThread(nextThread);
            if (shouldScrollTail) {
              scheduleTranscriptTailScroll();
              shouldScrollTail = false;
            }
          };
          for (const event of response.events) {
            if (event.thread_id !== tid) continue;
            const result = applyFlowerLiveEvent(threadState, cursor, event);
            cursor = result.cursor;
            if (result.resyncRequired) {
              resyncRequired = true;
              continue;
            }
            threadState = result.thread;
            if (event.kind === 'timeline.replaced') {
              resyncRequired = false;
              cursor = Math.max(cursor, event.payload.snapshot_through_seq);
              shouldScrollTail = true;
            }
            if (result.tailKey && result.tailLength > 0) {
              shouldScrollTail = true;
            }
            if (result.thread.read_status.is_unread) {
              shouldPersistRead = true;
              nextReadSnapshot = result.thread.read_status.snapshot;
            }
            appliedSincePaint += 1;
            const modelIOBoundary = isModelIOPresentationBoundary(event.kind);
            if (modelIOBoundary || appliedSincePaint >= LIVE_EVENT_RENDER_YIELD_SIZE) {
              commitLiveThreadState(threadState);
              appliedSincePaint = 0;
              if (modelIOBoundary) {
                await yieldModelIOPresentationFrame();
              } else {
                await yieldLiveEventRenderFrame();
              }
              if (sequence !== threadLoadSequence || selectedThreadID() !== tid) {
                return;
              }
            }
          }
          if (!resyncRequired) {
            commitLiveThreadState(threadState);
          }
          if (shouldPersistRead && nextReadSnapshot) {
            persistThreadRead(tid, nextReadSnapshot, sequence);
          }
        }
        cursor = Math.max(cursor, Math.floor(Number(response.next_cursor ?? 0)));
        if (resyncRequired || (response.retained_from_seq > 0 && cursor > 0 && cursor < response.retained_from_seq)) {
          await reloadSelectedThread(tid, sequence, 'resync_reload');
          return;
        }
        setLivePosition(tid, streamGeneration, cursor);
        keepGoing = response.has_more === true;
      }
      setThreadLoadError('');
    } catch (error) {
      if (error instanceof LiveEventRequestTimeoutError) {
        dispatchFlowerLiveEventsTimeout({
          thread_id: tid,
          cursor,
          stream_generation: streamGeneration,
          sequence,
        });
        return;
      }
      if (sequence === threadLoadSequence && selectedThreadID() === tid) {
        setThreadLoadError(getErrorMessage(error));
      }
    } finally {
      if (selectedThreadLiveRequests.get(tid)?.token === token) {
        selectedThreadLiveRequests.delete(tid);
      }
    }
  };

  createEffect(() => {
    const threadID = selectedThreadID();
    const status = selectedThreadLiveStatus();
    const hasPendingContextCompaction = pendingContextCompactionVisibleForSelectedThread();
    const shouldPollLive = status === 'running'
      || status === 'waiting_approval'
      || status === 'waiting_user'
      || selectedThreadHasRunningContextCompaction()
      || hasPendingContextCompaction
      || selectedThreadHasQueuedTurns()
      || hasPendingTurnForSelectedThread();
    if (!threadID || !shouldPollLive) {
      return;
    }
    const sequence = threadLoadSequence;
    const tick = () => {
      void applySelectedThreadLiveEvents(threadID, sequence);
    };
    const timer = window.setInterval(tick, 350);
    tick();
    onCleanup(() => {
      window.clearInterval(timer);
    });
  });

  createEffect(() => {
    const pending = pendingContextCompactionForSelectedThread();
    if (!pending) return;
    if (!pendingContextCompactionVisibleForSelectedThread()) {
      setPendingContextCompaction(null);
    }
  });

  createEffect(() => {
    const selectedID = selectedThreadID();
    const hasBackgroundActiveThread = threads().some((thread) => (
      thread.thread_id !== selectedID
      && (thread.status === 'running' || thread.status === 'waiting_approval' || thread.status === 'waiting_user')
    ));
    if (!hasBackgroundActiveThread) return;
    const tick = () => {
      if (backgroundThreadsRefreshInFlight) return;
      backgroundThreadsRefreshInFlight = true;
      void refreshThreads().finally(() => {
        backgroundThreadsRefreshInFlight = false;
      });
    };
    const timer = window.setInterval(tick, 1800);
    tick();
    onCleanup(() => {
      window.clearInterval(timer);
      backgroundThreadsRefreshInFlight = false;
    });
  });

  createEffect(() => {
    const request = selectedInputRequest();
    const signature = request ? `${currentComposerSessionKey()}:${request.prompt_id}` : '';
    const textQuestion = request?.questions.find((question) => question.response_mode === 'write' || question.response_mode === 'select_or_write') ?? null;
    updateCurrentComposerSessionDraft((draft) => ({
      ...draft,
      inputPromptSignature: signature,
      inputDrafts: request && draft.inputPromptSignature !== signature ? {} : draft.inputDrafts,
      activeInputQuestionID: request
        ? (
          draft.activeInputQuestionID && request.questions.some((question) => question.id === draft.activeInputQuestionID)
            ? draft.activeInputQuestionID
            : (textQuestion?.id ?? '')
        )
        : '',
    }));
    setInputSubmitError('');
  });

  const saveSettings = async (draft: FlowerSettingsDraft) => {
    setSaveError('');
    setSettingsSaving(true);
    try {
      const next = await props.adapter.saveSettings(draft);
      setSnapshot(next);
      setSavedAt(Date.now());
      return next;
    } catch (error) {
      const message = getErrorMessage(error);
      setSaveError(message);
      throw new Error(message);
    } finally {
      setSettingsSaving(false);
    }
  };

  const returnToChat = () => {
    setChatSubmitError('');
    setSidePanel('chat');
  };

  const clearSubagentDetailTail = () => {
    if (subagentDetailTailTimer !== undefined) {
      window.clearTimeout(subagentDetailTailTimer);
      subagentDetailTailTimer = undefined;
    }
    subagentDetailTailInFlight = null;
    setSubagentDetailTailLoading(false);
    setSubagentDetailTailError('');
    subagentDetailScroll.dispose();
    subagentDetailScroll.markNearBottom();
  };

  const closeSubagentOverlays = () => {
    setSubagentDropdownOpen(false);
    setActiveSubagentID('');
    setSubagentDetail(null);
    setSubagentDetailError('');
    setSubagentDetailLoading(false);
    setSubagentDetailLoadingMore(false);
    clearSubagentDetailTail();
    setSubagentDetailOpenedRevision((revision) => revision + 1);
  };

  const settingsReadOnly = createMemo(() => modelSource()?.kind === 'desktop_model_source');

  const openSettings = () => {
    closeSubagentOverlays();
    setSidePanel('settings');
  };

  const updateSubagentDropdownPosition = () => {
    const rect = subagentTriggerRef?.getBoundingClientRect();
    if (!rect) return;
    setSubagentDropdownPosition({
      x: Math.max(8, rect.right - SUBAGENT_DROPDOWN_ESTIMATED_SIZE.width),
      y: rect.bottom + 8,
    });
  };

  const openSubagents = () => {
    updateSubagentDropdownPosition();
    setSubagentDropdownOpen((open) => !open);
  };

  const openSubagentDetail = async (item: FlowerSubagentPanelItem) => {
    const parentID = trimString(selectedThread()?.thread_id);
    const childID = trimString(item.threadID || item.subagentID);
    if (!parentID || !childID) return;
    const openedRevision = untrack(subagentDetailOpenedRevision) + 1;
    const requestID = `${parentID}\x00${childID}\x00${openedRevision}`;
    setSubagentDetailOpenedRevision(openedRevision);
    clearSubagentDetailTail();
    setActiveSubagentID(childID);
    setSubagentDropdownOpen(false);
    setSubagentDetail(null);
    setSubagentDetailError('');
    setSubagentDetailLoading(true);
    setSubagentDetailLoadingMore(false);
    setSubagentDetailTailRevision(0);
    try {
      const detail = await props.adapter.loadSubagentDetail(parentID, childID, 0, SUBAGENT_DETAIL_PAGE_SIZE);
      if (`${trimString(selectedThread()?.thread_id)}\x00${activeSubagentID()}\x00${subagentDetailOpenedRevision()}` !== requestID) return;
      setSubagentDetail(detail);
      setSubagentDetailTailRevision((revision) => revision + 1);
      requestTranscriptAnimationFrame(() => subagentDetailScroll.scrollToBottom({ smooth: false }));
    } catch (error) {
      if (`${trimString(selectedThread()?.thread_id)}\x00${activeSubagentID()}\x00${subagentDetailOpenedRevision()}` !== requestID) return;
      setSubagentDetailError(getErrorMessage(error));
    } finally {
      if (`${trimString(selectedThread()?.thread_id)}\x00${activeSubagentID()}\x00${subagentDetailOpenedRevision()}` === requestID) {
        setSubagentDetailLoading(false);
      }
    }
  };

  const loadMoreSubagentDetail = async () => {
    const parentID = trimString(selectedThread()?.thread_id);
    const childID = trimString(activeSubagentID());
    const detail = subagentDetail();
    if (!parentID || !childID || !detail?.has_more || subagentDetailLoadingMore() || subagentDetailTailInFlight) return;
    const afterOrdinal = Math.max(0, Math.floor(detail.next_ordinal ?? detail.timeline[detail.timeline.length - 1]?.ordinal ?? 0));
    const openedRevision = subagentDetailOpenedRevision();
    const requestID = `${parentID}\x00${childID}\x00${openedRevision}`;
    const wasNearBottom = subagentDetailScroll.captureWasNearBottom();
    setSubagentDetailError('');
    setSubagentDetailLoadingMore(true);
    try {
      const page = await props.adapter.loadSubagentDetail(parentID, childID, afterOrdinal, SUBAGENT_DETAIL_PAGE_SIZE);
      if (`${trimString(selectedThread()?.thread_id)}\x00${activeSubagentID()}\x00${subagentDetailOpenedRevision()}` !== requestID) return;
      setSubagentDetail((current) => mergeSubagentDetailPage(current, page));
      setSubagentDetailTailRevision((revision) => revision + 1);
      if (wasNearBottom) {
        requestTranscriptAnimationFrame(() => subagentDetailScroll.scheduleTailScroll());
      }
    } catch (error) {
      if (`${trimString(selectedThread()?.thread_id)}\x00${activeSubagentID()}\x00${subagentDetailOpenedRevision()}` !== requestID) return;
      setSubagentDetailError(getErrorMessage(error));
    } finally {
      if (`${trimString(selectedThread()?.thread_id)}\x00${activeSubagentID()}\x00${subagentDetailOpenedRevision()}` === requestID) {
        setSubagentDetailLoadingMore(false);
      }
    }
  };

  const launchChatTurn = async (promptInput: string) => {
    const prompt = trimString(promptInput);
    if (!snapshot()) {
      setChatSubmitError(copy().chat.loadingSettings);
      return;
    }
    if (!readyForChat() && !settingsReadOnly()) {
      openSettings();
      return;
    }
    if (!readyForChat()) {
      setChatSubmitError(copy().chat.configureProviderBeforeChat);
      return;
    }
    if (!prompt) {
      setChatSubmitError(copy().chat.enterMessageBeforeSending);
      return;
    }
    if (selectedThreadReadOnly()) {
      setChatSubmitError(selectedThreadReadOnlyDisplay());
      return;
    }
    if (!handlerAllowsSubmitIntent()) {
      const state = handlerState();
      setChatSubmitError('message' in state ? state.message : copy().chat.handlerStillStarting);
      return;
    }
    const selectedID = trimString(selectedThreadID());
    const draftReasoningSelection = !selectedID ? serializeFlowerReasoningSelection(composerReasoningSelection()) : undefined;
    const draftModelID = !selectedID ? selectedComposerModelID() : '';
    const messageID = createClientMessageID();
    const pending: PendingFlowerTurn = {
      thread_id: selectedThreadID() || PENDING_NEW_THREAD_ID,
      message_id: messageID,
      prompt,
      state: 'sending',
      created_at_ms: Date.now(),
    };
    let accepted = false;
    setChatRunning(true);
    addPendingTurn(pending);
    transcriptScroll.startFollowing();
    requestTranscriptAnimationFrame(() => transcriptScroll.scheduleTailScroll({ smooth: false, force: true }));
    updateCurrentComposerSessionDraft((draft) => ({
      ...draft,
      chatDraft: '',
      inputPromptSignature: '',
      inputDrafts: {},
      activeInputQuestionID: '',
    }));
    try {
      const decision = currentHandlerDecision() ?? await resolveHandlerDecision();
      if (!decision.selected_handler || decision.blocker || decision.route === 'blocked') {
        removePendingTurn(pending);
        updateCurrentComposerSessionDraft((draft) => ({
          ...draft,
          chatDraft: prompt,
        }));
        setChatSubmitError(decision.blocker?.message || copy().chat.handlerStillStarting);
        return;
      }
      const thread = await props.adapter.launchTurn({
        thread_id: selectedID || undefined,
        message_id: messageID,
        prompt,
        decision: selectedID ? null : decision,
        ...(!selectedID ? { permission_type: composerPermissionType() } : {}),
        ...(!selectedID && draftModelID ? { model_id: draftModelID } : {}),
        ...(!selectedID && draftReasoningSelection ? { reasoning_selection: draftReasoningSelection } : {}),
      });
      const acceptedThread = applyLiveBootstrap(thread);
      accepted = true;
      setSelectedThreadID(acceptedThread.thread_id);
      const acceptedPending: PendingFlowerTurn = {
        ...pending,
        thread_id: acceptedThread.thread_id,
      };
      const promptIsCanonical = pendingTurnCanonicalMessage(acceptedThread, acceptedPending) != null;
      if (promptIsCanonical) {
        removePendingTurn(pending);
      } else if (Number(acceptedThread.queued_turn_count ?? 0) > 0) {
        replacePendingTurn(pending, {
          ...acceptedPending,
          state: 'queued',
        });
      } else {
        replacePendingTurn(pending, {
          ...acceptedPending,
          state: 'sending',
        });
      }
      setLoadError('');
      returnToChat();
      await refreshSelectedThread(acceptedThread.thread_id);
    } catch (error) {
      const failure = error as FlowerTurnLaunchFailure;
      if (failure.fresh_decision) {
        setHandlerState(handlerStateFromDecision(failure.fresh_decision));
      }
      removePendingTurn(pending);
      updateCurrentComposerSessionDraft((draft) => ({
        ...draft,
        chatDraft: prompt,
      }));
      setChatSubmitError(getErrorMessage(error));
    } finally {
      if (accepted) {
        updateCurrentComposerSessionDraft((draft) => (
          draft.reasoningOverride ? { ...draft, reasoningOverride: undefined } : draft
        ));
      }
      setChatRunning(false);
    }
  };

  const stopSelectedThread = async (): Promise<FlowerThreadSnapshot> => {
    const threadID = trimString(selectedThreadID());
    if (!threadID) throw new Error('Missing thread id.');
    const live = await props.adapter.stopThread(threadID);
    const thread = applyLiveBootstrap(live);
    setSelectedThreadID(thread.thread_id);
    setLoadError('');
    return thread;
  };

  const contextCompactionOperationIDs = (thread: FlowerThreadSnapshot): readonly string[] => {
    const operationIDs = new Set<string>();
    for (const compaction of thread.context_compactions ?? []) {
      const operationID = trimString(compaction.operation_id);
      if (operationID && !operationID.startsWith('local:')) operationIDs.add(operationID);
    }
    for (const decoration of thread.timeline_decorations ?? []) {
      if (decoration.kind !== 'context_compaction') continue;
      const operationID = trimString(decoration.compaction.operation_id);
      if (operationID && !operationID.startsWith('local:')) operationIDs.add(operationID);
    }
    return [...operationIDs];
  };

  const localPendingCompactionAnchor = (thread: FlowerThreadSnapshot): FlowerTimelineAnchor | null => {
    for (let messageIndex = thread.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const message = thread.messages[messageIndex];
      const messageID = trimString(message.id);
      if (!messageID) continue;
      const blocks = message.blocks ?? [];
      for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
        const block = blocks[blockIndex];
        if (block.type === 'activity-timeline') {
          for (let itemIndex = block.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
            const itemID = trimString(block.items[itemIndex]?.item_id);
            if (itemID) {
              return {
                target_kind: 'activity_item',
                message_id: messageID,
                block_index: blockIndex,
                activity_item_id: itemID,
                edge: 'after',
              };
            }
          }
          continue;
        }
        if (trimString(block.content)) {
          return {
            target_kind: 'block',
            message_id: messageID,
            block_index: blockIndex,
            edge: 'after',
          };
        }
      }
      if (trimString(message.content)) {
        return {
          target_kind: 'message',
          message_id: messageID,
          edge: 'after',
        };
      }
    }
    return null;
  };

  const nextLocalCompactionOrdinal = (thread: FlowerThreadSnapshot, anchor: FlowerTimelineAnchor): number => {
    let ordinal = -1;
    for (const decoration of thread.timeline_decorations ?? []) {
      if (decoration.kind !== 'context_compaction') continue;
      const decorationAnchor = decoration.anchor;
      if (
        trimString(decorationAnchor.target_kind) !== trimString(anchor.target_kind)
        || trimString(decorationAnchor.message_id) !== trimString(anchor.message_id)
        || Math.floor(Number(decorationAnchor.block_index ?? -1)) !== Math.floor(Number(anchor.block_index ?? -1))
        || trimString(decorationAnchor.activity_item_id) !== trimString(anchor.activity_item_id)
        || trimString(decorationAnchor.edge) !== trimString(anchor.edge)
      ) {
        continue;
      }
      ordinal = Math.max(ordinal, Math.max(0, Math.floor(Number(decoration.ordinal ?? 0))));
    }
    return ordinal + 1;
  };

  const localPendingCompaction = (thread: FlowerThreadSnapshot, startedAtMs: number): PendingContextCompactionDecoration => {
    const threadID = trimString(thread.thread_id);
    const anchor = localPendingCompactionAnchor(thread);
    const operationID = `local:${threadID}:${startedAtMs}`;
    return {
      thread_id: threadID,
      started_at_ms: startedAtMs,
      known_operation_ids: contextCompactionOperationIDs(thread),
      decoration: {
        decoration_id: `local-context-compaction:${threadID}:${startedAtMs}`,
        kind: 'context_compaction',
        ordinal: anchor ? nextLocalCompactionOrdinal(thread, anchor) : 0,
        anchor: anchor ?? {
          target_kind: 'message',
          message_id: `local:${threadID}`,
          edge: 'after',
        },
        compaction: {
          operation_id: operationID,
          phase: 'start',
          status: 'compacting',
          updated_at_ms: startedAtMs,
        },
      },
    };
  };

  const revealPendingCompactionDivider = () => {
    transcriptScroll.startFollowing();
    scrollTranscriptToBottom({ smooth: false });
    requestTranscriptAnimationFrame(() => scrollTranscriptToBottom({ smooth: false }));
  };

  const compactSelectedThreadContext = async (rawPrompt: string) => {
    if (!snapshot()) {
      setChatSubmitError(copy().chat.loadingSettings);
      return;
    }
    if (!readyForChat() && !settingsReadOnly()) {
      openSettings();
      return;
    }
    if (!readyForChat()) {
      setChatSubmitError(copy().chat.configureProviderBeforeChat);
      return;
    }
    if (!handlerAllowsSubmitIntent()) {
      const state = handlerState();
      setChatSubmitError('message' in state ? state.message : copy().chat.handlerStillStarting);
      return;
    }
    const thread = selectedThread();
    if (!thread) {
      setChatSubmitError(copy().chat.compactChooseThread);
      return;
    }
    const threadID = trimString(thread.thread_id);
    if (!threadID) {
      setChatSubmitError(copy().chat.compactChooseThread);
      return;
    }
    if (selectedThreadReadOnly()) {
      setChatSubmitError(selectedThreadReadOnlyDisplay());
      return;
    }
    if (selectedInputRequest()) {
      setChatSubmitError(copy().chat.compactFinishInputRequest);
      return;
    }
    if (!selectedThreadHasContent()) {
      setChatSubmitError(copy().chat.compactNeedsConversation);
      return;
    }
    if (compactSubmitting()) return;
    const activeRunID = COMPOSER_STOP_THREAD_STATUSES.has(selectedThreadLiveStatus())
      ? trimString(thread?.active_run_id)
      : '';
    setCompactSubmitting(true);
    setPendingContextCompaction(localPendingCompaction(thread, Date.now()));
    updateCurrentComposerSessionDraft((draft) => ({
      ...draft,
      chatDraft: '',
    }));
    requestComposerFocus();
    revealPendingCompactionDivider();
    try {
      const live = await props.adapter.compactThreadContext({
        thread_id: threadID,
        active_run_id: activeRunID || undefined,
      });
      const updated = applyLiveBootstrap(live);
      setSelectedThreadID(updated.thread_id);
      updateCurrentComposerSessionDraft((draft) => ({
        ...draft,
        chatDraft: '',
      }));
      setLoadError('');
      returnToChat();
      revealPendingCompactionDivider();
      await refreshSelectedThread(updated.thread_id);
    } catch (error) {
      setPendingContextCompaction((pending) => (
        pending?.thread_id === threadID ? null : pending
      ));
      updateCurrentComposerSessionDraft((draft) => ({
        ...draft,
        chatDraft: rawPrompt,
      }));
      setChatSubmitError(getErrorMessage(error));
    } finally {
      setCompactSubmitting(false);
    }
  };

  const submitChat = async () => {
    const prompt = trimString(composerRef?.value ?? currentComposerSessionDraft().chatDraft);
    setChatSubmitError('');
    if (selectedThreadReadOnly()) {
      setChatSubmitError(selectedThreadReadOnlyDisplay());
      return;
    }
    if (selectedInputRequest()) {
      await submitInputRequest();
      return;
    }
    const command = parseFlowerSlashCommand(prompt);
    if (command.kind === 'invalid') {
      setChatSubmitError(command.message);
      return;
    }
    if (command.kind === 'suggest') {
      updateComposerText(FLOWER_COMPACT_CONTEXT_COMMAND);
      requestComposerFocus();
      return;
    }
    if (command.kind === 'intent') {
      await compactSelectedThreadContext(prompt);
      return;
    }
    if (selectedThreadCanStop() && !prompt) {
      if (threadStopping() || chatRunning()) return;
      setThreadStopping(true);
      try {
        await stopSelectedThread();
        returnToChat();
      } catch (error) {
        setChatSubmitError(getErrorMessage(error));
        return;
      } finally {
        setThreadStopping(false);
      }
      return;
    }
    if (chatRunning()) {
      return;
    }
    await launchChatTurn(prompt);
  };

  const startCompose = () => {
    const requestID = trimString(props.focusThreadRequest?.request_id);
    if (requestID) props.onFocusThreadRequestConsumed?.(requestID);
    threadLoadSequence += 1;
    transcriptScroll.startFollowing();
    cancelSelectedThreadTailReveal();
    closeSubagentOverlays();
    setSelectedThreadID('');
    clearPendingTurns();
    setChatSubmitError('');
    setInputSubmitError('');
    setPermissionSubmitError('');
    setThreadLoadError('');
    requestComposerFocus();
    void resolveHandlerDecision();
    returnToChat();
  };

  const startThreadRailResize = (event: PointerEvent) => {
    event.preventDefault();
    setThreadRailResizing(true);
    const startX = event.clientX;
    const startWidth = threadRailWidth();
    const onPointerMove = (moveEvent: PointerEvent) => {
      setThreadRailWidth(clampThreadRailWidth(startWidth + moveEvent.clientX - startX));
    };
    const onPointerUp = () => {
      setThreadRailResizing(false);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('blur', onPointerUp);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('blur', onPointerUp);
  };

  const nudgeThreadRailWidth = (delta: number) => {
    setThreadRailWidth((width) => clampThreadRailWidth(width + delta));
  };

  const selectThread = (threadID: string) => {
    const requestID = trimString(props.focusThreadRequest?.request_id);
    if (requestID) props.onFocusThreadRequestConsumed?.(requestID);
    transcriptScroll.startFollowing();
    void loadAndSelectThread(threadID);
  };

  const updateTranscriptNearBottom = (event?: Event) => {
    if (selectedThreadTailPreparing() && event?.isTrusted) {
      cancelSelectedThreadTailReveal();
    }
    transcriptScroll.onScroll();
  };
  const updateTranscriptFollowFromWheel = (event: WheelEvent) => {
    if (selectedThreadTailPreparing() && event.deltaY < 0) {
      cancelSelectedThreadTailReveal();
    }
    transcriptScroll.onWheel(event);
  };
  const updateTranscriptFollowFromTouch = () => {
    if (selectedThreadTailPreparing()) {
      cancelSelectedThreadTailReveal();
    }
  };
  const scrollTranscriptToBottom = (options: Readonly<{ smooth?: boolean }> = {}) => transcriptScroll.scrollToBottom(options);
  const measureTranscriptNearBottomAfterLayout = () => transcriptScroll.measureAfterLayout();
  const scheduleTranscriptTailScroll = () => transcriptScroll.scheduleTailScroll();
  onCleanup(() => {
    clearSelectedThreadTailRevealSchedule();
    transcriptScroll.dispose();
    subagentDetailScroll.dispose();
    if (copiedMessageResetTimer !== undefined) {
      window.clearTimeout(copiedMessageResetTimer);
      copiedMessageResetTimer = undefined;
    }
    if (copiedApprovalResetTimer !== undefined) {
      window.clearTimeout(copiedApprovalResetTimer);
      copiedApprovalResetTimer = undefined;
    }
  });

  const yieldAnimationFrame = async () => {
    if (typeof window === 'undefined') return;
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  };
  const yieldLiveEventRenderFrame = async () => {
    await yieldAnimationFrame();
  };
  const yieldModelIOPresentationFrame = async () => {
    await yieldAnimationFrame();
    await yieldAnimationFrame();
  };

  const selectedTimelineEntries = createMemo(() => buildFlowerTimelineEntries(selectedThread()));
  const selectedSubagentItems = createMemo(() => buildFlowerSubagentPanelItems(selectedThread()));
  const selectedActiveSubagentCount = createMemo(() => selectedSubagentItems().filter((item) => (
    item.status === 'queued' || item.status === 'running' || item.status === 'waiting_input'
  )).length);
  const selectedSettledSubagentCount = createMemo(() => selectedSubagentItems().length - selectedActiveSubagentCount());
  const activeSubagentItem = createMemo(() => {
    const activeID = trimString(activeSubagentID());
    if (!activeID) return null;
    return selectedSubagentItems().find((item) => trimString(item.threadID || item.subagentID) === activeID) ?? null;
  });
  createEffect(() => {
    const activeID = trimString(activeSubagentID());
    if (!activeID) return;
    if (activeSubagentItem()) return;
    closeSubagentOverlays();
  });

  const subagentDetailActiveStatus = createMemo<FlowerSubagentPanelStatus>(() => {
    const itemStatus = activeSubagentItem()?.status ?? 'unknown';
    const detailStatus = normalizeSubagentPanelStatus(subagentDetail()?.summary.status);
    if (isSubagentTerminalStatus(itemStatus)) return itemStatus;
    if (isSubagentTerminalStatus(detailStatus)) return detailStatus;
    if (detailStatus !== 'unknown') return detailStatus;
    return itemStatus;
  });

  const subagentDetailCanTail = createMemo(() => {
    switch (subagentDetailActiveStatus()) {
      case 'queued':
      case 'running':
      case 'waiting_input':
        return Boolean(activeSubagentID());
      default:
        return false;
    }
  });

  const latestSubagentDetailOrdinal = (): number => {
    const detail = subagentDetail();
    if (!detail) return 0;
    const lastOrdinal = detail.timeline.reduce((max, row) => Math.max(max, Math.floor(Number(row.ordinal ?? 0))), 0);
    const nextOrdinal = Math.floor(Number(detail.next_ordinal ?? 0));
    return Math.max(0, nextOrdinal, lastOrdinal);
  };

  const runSubagentDetailTailRequest = async (request: FlowerSubagentDetailTailRequest): Promise<boolean> => {
    if (subagentDetailTailInFlight) return false;
    subagentDetailTailInFlight = request;
    setSubagentDetailTailLoading(true);
    const wasNearBottom = subagentDetailScroll.captureWasNearBottom();
    try {
      const page = await props.adapter.loadSubagentDetail(
        request.parentThreadID,
        request.childThreadID,
        request.afterOrdinal,
        SUBAGENT_DETAIL_PAGE_SIZE,
      );
      const stillCurrent = trimString(selectedThread()?.thread_id) === request.parentThreadID
        && trimString(activeSubagentID()) === request.childThreadID
        && subagentDetailOpenedRevision() === request.openedRevision;
      if (!stillCurrent) return false;
      setSubagentDetail((current) => mergeSubagentDetailPage(current, page));
      setSubagentDetailTailError('');
      setSubagentDetailTailRevision((revision) => revision + 1);
      if (wasNearBottom) {
        requestTranscriptAnimationFrame(() => subagentDetailScroll.scheduleTailScroll());
      }
      return true;
    } catch (error) {
      const stillCurrent = trimString(selectedThread()?.thread_id) === request.parentThreadID
        && trimString(activeSubagentID()) === request.childThreadID
        && subagentDetailOpenedRevision() === request.openedRevision;
      if (stillCurrent) {
        setSubagentDetailTailError(getErrorMessage(error));
      }
      return false;
    } finally {
      const stillCurrent = trimString(selectedThread()?.thread_id) === request.parentThreadID
        && trimString(activeSubagentID()) === request.childThreadID
        && subagentDetailOpenedRevision() === request.openedRevision;
      if (stillCurrent) {
        setSubagentDetailTailLoading(false);
      }
      if (subagentDetailTailInFlight === request) {
        subagentDetailTailInFlight = null;
      }
    }
  };

  createEffect(() => {
    const parentID = trimString(selectedThread()?.thread_id);
    const childID = trimString(activeSubagentID());
    const openedRevision = subagentDetailOpenedRevision();
    const canTail = subagentDetailCanTail();
    subagentDetailTailRevision();
    if (subagentDetailTailTimer !== undefined) {
      window.clearTimeout(subagentDetailTailTimer);
      subagentDetailTailTimer = undefined;
    }
    if (!parentID || !childID || !openedRevision || !canTail || subagentDetailLoading() || subagentDetailLoadingMore()) {
      subagentDetailTailInFlight = null;
      setSubagentDetailTailLoading(false);
      return;
    }
    const status = subagentDetailActiveStatus();
    const interval = subagentDetailTailError()
      ? SUBAGENT_DETAIL_TAIL_ERROR_INTERVAL_MS
      : status === 'queued'
        ? SUBAGENT_DETAIL_TAIL_QUEUED_INTERVAL_MS
        : SUBAGENT_DETAIL_TAIL_RUNNING_INTERVAL_MS;
    subagentDetailTailTimer = window.setTimeout(() => {
      subagentDetailTailTimer = undefined;
      if (subagentDetailTailInFlight || subagentDetailLoadingMore()) return;
      const request: FlowerSubagentDetailTailRequest = {
        parentThreadID: parentID,
        childThreadID: childID,
        openedRevision,
        afterOrdinal: latestSubagentDetailOrdinal(),
      };
      void runSubagentDetailTailRequest(request).finally(() => {
        setSubagentDetailTailRevision((revision) => revision + 1);
      });
    }, interval);
    onCleanup(() => {
      if (subagentDetailTailTimer !== undefined) {
        window.clearTimeout(subagentDetailTailTimer);
        subagentDetailTailTimer = undefined;
      }
    });
  });

  const visibleTimelineEntries = createMemo((): readonly FlowerTimelineEntry[] => {
    const thread = selectedThread();
    const pending = pendingContextCompactionForSelectedThread();
    let entries = pending && pendingContextCompactionVisibleForSelectedThread() && thread
      ? [...buildFlowerTimelineEntries({
        ...thread,
        timeline_decorations: [...(thread.timeline_decorations ?? []), pending.decoration],
      })]
      : [...selectedTimelineEntries()];
    for (const pendingTurnValue of pendingTurnsForSelectedThread()) {
      if (thread && pendingTurnCanonicalMessage(thread, pendingTurnValue)) continue;
      const pendingMessage: FlowerChatMessage = {
        id: `pending:${pendingTurnValue.message_id}`,
        role: 'user',
        content: pendingTurnValue.prompt,
        status: 'sending',
        created_at_ms: pendingTurnValue.created_at_ms,
        blocks: [{ type: 'text', content: pendingTurnValue.prompt }],
      };
      const pendingEntry: FlowerTimelineEntry = {
        type: 'message',
        key: `pending-turn:${pendingTurnValue.thread_id}:${pendingTurnValue.message_id}`,
        message: pendingMessage,
        blocks: [{
          type: 'content',
          key: `${pendingMessage.id}:content`,
          block_index: 0,
          block_type: 'text',
          content: pendingTurnValue.prompt,
        }],
      };
      const insertAt = entries.findIndex((entry) => (
        entry.type === 'message'
        && entry.message.role === 'assistant'
        && (
          (pendingTurnValue.state === 'sending' && (entry.message.active_cursor === true || entry.message.status === 'streaming'))
          || Number(entry.message.created_at_ms ?? 0) >= pendingTurnValue.created_at_ms
        )
      ));
      entries = insertAt >= 0
        ? [...entries.slice(0, insertAt), pendingEntry, ...entries.slice(insertAt)]
        : [...entries, pendingEntry];
    }
    return entries;
  });
  const visibleTimelineEntryKeys = createMemo(() => visibleTimelineEntries().map((entry) => entry.key));
  const visibleTimelineEntriesByKey = createMemo(() => new Map(visibleTimelineEntries().map((entry) => [entry.key, entry] as const)));

  createEffect(() => {
    const thread = selectedThread();
    if (!thread) return;
    updatePendingTurnsForSelectedThread(thread);
  });

  const shouldSubmitOnEnterKeydown = (event: KeyboardEvent): boolean => {
    if (event.isComposing || isComposing()) {
      return false;
    }
    return event.key === 'Enter' && !event.shiftKey;
  };

  const executeCompactContextCommand = async () => {
    const rawPrompt = trimString(composerRef?.value ?? currentComposerSessionDraft().chatDraft) || FLOWER_COMPACT_CONTEXT_COMMAND;
    await compactSelectedThreadContext(rawPrompt);
  };

  const handleComposerKeyDown = (event: KeyboardEvent) => {
    const command = composerSlashCommand();
    if (!selectedInputRequest() && command.kind === 'suggest') {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        updateComposerText('');
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !isComposing()) {
        event.preventDefault();
        updateComposerText(FLOWER_COMPACT_CONTEXT_COMMAND);
        requestComposerFocus();
        return;
      }
    }
    if (shouldSubmitOnEnterKeydown(event)) {
      event.preventDefault();
      void submitChat();
    }
  };

  const runErrorActionLabel = (code: string): string => {
    switch (code) {
      case 'provider_auth_failed':
        return copy().chat.runErrorActions.updateAPIKey;
      case 'provider_missing_key':
        return copy().chat.runErrorActions.addAPIKey;
      case 'provider_model_unavailable':
        return copy().chat.runErrorActions.switchModel;
      default:
        return copy().chat.runErrorActions.openSettings;
    }
  };

  const errorNotice = (title: string, message: string, action?: JSX.Element) => (
    <div role="alert" class="flower-error-card">
      <div class="flower-error-icon"><AlertTriangle class="h-4 w-4" /></div>
      <div class="flower-error-copy">
        <div class="flower-error-title">{title}</div>
        <div class="flower-error-message">{message}</div>
        <Show when={action}>
          {(item) => <div class="flower-error-actions">{item()}</div>}
        </Show>
      </div>
    </div>
  );

  const permissionSelector = () => {
    const canUseMenu = createMemo(() => (
      !selectedThreadReadOnly()
      && (!selectedThreadID() || typeof props.adapter.setThreadPermissionType === 'function')
    ));
    const interactive = createMemo(() => canUseMenu() && !permissionPatchPending());
    return (
      <div
        class="flower-permission-selector"
        data-permission-type={composerPermissionType()}
        data-permission-pending={permissionPatchPending() ? 'true' : 'false'}
      >
        <Show
          when={canUseMenu()}
          fallback={(
            <span
              class="flower-permission-trigger flower-permission-trigger-static"
              data-permission-type={composerPermissionType()}
              title={`${copy().chat.permissionSelectorLabel}: ${composerPermissionCopy().label}`}
              aria-label={`${copy().chat.permissionSelectorLabel}: ${composerPermissionCopy().label}`}
            >
              <Shield class="flower-permission-icon" />
              <span class="flower-permission-label">{composerPermissionCopy().label}</span>
            </span>
          )}
        >
          <button
            ref={permissionTriggerRef}
            type="button"
            class={cn('flower-permission-trigger', !interactive() && 'flower-permission-trigger-readonly')}
            data-permission-type={composerPermissionType()}
            aria-label={`${copy().chat.permissionSelectorLabel}: ${composerPermissionCopy().label}`}
            aria-haspopup="listbox"
            aria-expanded={permissionMenuOpen()}
            aria-controls="flower-composer-permission-menu"
            title={permissionSelectorTitle()}
            disabled={!interactive()}
            onClick={() => {
              if (permissionMenuOpen()) {
                closePermissionMenu(false);
                return;
              }
              openPermissionMenu();
            }}
            onKeyDown={handlePermissionTriggerKeyDown}
          >
            <Shield class="flower-permission-icon" />
            <span class="flower-permission-label">{composerPermissionCopy().label}</span>
            <Show when={permissionPatchPending()}>
              <span class="flower-permission-saving-dot" aria-hidden="true" />
            </Show>
            <ChevronDown class="flower-permission-chevron" aria-hidden="true" />
          </button>
        </Show>
        <Show when={permissionMenuOpen()}>
          <div
            id="flower-composer-permission-menu"
            ref={permissionMenuRef}
            class="flower-permission-menu"
            role="listbox"
            aria-label={copy().chat.permissionSelectorLabel}
            aria-activedescendant={permissionOptionID(FLOWER_PERMISSION_TYPES[permissionMenuActiveIndex()] ?? composerPermissionType())}
            onKeyDown={handlePermissionMenuKeyDown}
          >
            <For each={FLOWER_PERMISSION_TYPES}>
              {(permissionType, index) => {
                const itemCopy = createMemo(() => copy().settings.permissionTypes[permissionType]);
                const selected = createMemo(() => composerPermissionType() === permissionType);
                return (
                  <button
                    id={permissionOptionID(permissionType)}
                    type="button"
                    role="option"
                    tabIndex={permissionMenuActiveIndex() === index() ? 0 : -1}
                    data-permission-type={permissionType}
                    aria-selected={selected()}
                    class={cn('flower-permission-menu-item', selected() && 'flower-permission-menu-item-active')}
                    onMouseEnter={() => setPermissionMenuActiveIndex(index())}
                    onFocus={() => setPermissionMenuActiveIndex(index())}
                    onClick={() => void updateComposerPermissionType(permissionType)}
                  >
                    <span class="flower-permission-menu-row">
                      <Shield class="flower-permission-menu-icon" />
                      <span class="flower-permission-menu-label">{itemCopy().label}</span>
                      <Show when={selected()}>
                        <Check class="flower-permission-menu-check" aria-hidden="true" />
                      </Show>
                    </span>
                    <span class="flower-permission-menu-description">{itemCopy().description}</span>
                  </button>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    );
  };

  const runErrorNotice = (error: FlowerThreadSnapshot['error']) => {
    const code = trimString(error?.code);
    const actionable = code === 'provider_auth_failed'
      || code === 'provider_missing_key'
      || code === 'provider_model_unavailable'
      || code === 'provider_unreachable';
    return errorNotice(
      copy().chat.runErrorTitle,
      presentRunError(error),
      actionable
        ? (
          <Button size="sm" variant="outline" icon={Settings} onClick={openSettings}>
            {runErrorActionLabel(code)}
          </Button>
        )
        : undefined,
    );
  };

  const chatCopyValue = (
    key: 'inputRequestTitle'
      | 'readOnlyComposerLabel'
      | 'inputRequestDescription'
      | 'inputRequestSubmit'
      | 'inputRequestRetry'
      | 'inputRequestAnswerRequired'
      | 'inputRequestSubmitting'
      | 'inputRequestComposerPlaceholder'
      | 'inputRequestChoicePlaceholder',
    fallback: string,
  ): string => trimString(copy().chat[key]) || trimString(DEFAULT_FLOWER_SURFACE_COPY.chat[key]) || fallback;

  const selectedModelIOStatus = createMemo<FlowerModelIOStatus | null>(() => selectedThread()?.model_io_status ?? null);
  const selectedContextUsage = createMemo<FlowerComposerContextUsageModel | null>(() => {
    const thread = selectedThread();
    const usage = thread?.context_usage ?? null;
    if (!thread || !usage) return null;
    const activeRunID = trimString(thread.active_run_id);
    if (!activeRunID || trimString(usage.run_id) === activeRunID) {
      return { usage, freshness: 'current' };
    }
    return { usage, freshness: 'last_known' };
  });
  const selectedThreadHasModelStatus = createMemo(() => selectedModelIOStatus() != null);
  const showScrollToLatestButton = createMemo(() => (
    (selectedThreadHasContent() || selectedThreadHasModelStatus())
    && !selectedThreadTailPreparing()
    && !transcriptScroll.nearBottom()
  ));
  createEffect(() => {
    selectedThreadID();
    selectedThreadHasContent();
    selectedThreadHasModelStatus();
    hasPendingTurnForSelectedThread();
    transcriptLayoutRevision();
    measureTranscriptNearBottomAfterLayout();
  });
  const modelStatusLabel = (phase: FlowerModelIOPhase): string => {
    const modelStatus = copy().chat.modelStatus;
    const fallback = DEFAULT_FLOWER_SURFACE_COPY.chat.modelStatus;
    const labels: Record<FlowerModelIOPhase, string> = {
      preparing: trimString(modelStatus.preparing) || fallback.preparing,
      waiting_response: trimString(modelStatus.waitingResponse) || fallback.waitingResponse,
      streaming: trimString(modelStatus.streaming) || fallback.streaming,
      retrying: trimString(modelStatus.retrying) || fallback.retrying,
      finalizing: trimString(modelStatus.finalizing) || fallback.finalizing,
    };
    return labels[phase];
  };
  const selectedModelStatusLabel = createMemo(() => {
    const status = selectedModelIOStatus();
    return status ? modelStatusLabel(status.phase) : '';
  });
  const modelStatusIndicator = (status: FlowerModelIOStatus | null, label: string) => {
    const base = label.replace(/\.\.\.$/, '');
    return (
      <div class="flower-model-status-indicator" data-model-io-phase={status?.phase}>
        <span class="flower-model-status-text" data-text={base}>{base}<span class="flower-model-status-dots" aria-hidden="true">...</span></span>
      </div>
    );
  };
  const selectedModelStatusIndicator = () => modelStatusIndicator(selectedModelIOStatus(), selectedModelStatusLabel());

  const formatMessageTime = (createdAtMs: number): string => {
    const value = Math.floor(Number(createdAtMs ?? 0));
    if (!Number.isFinite(value) || value <= 0) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  const messageCopyText = (message: FlowerChatMessage, blocks: readonly FlowerRenderableMessageBlock[]): string => {
    const blockText = blocks
      .flatMap((block) => (
        block.type === 'content' && block.block_type !== 'thinking'
          ? [trimString(block.content)]
          : []
      ))
      .filter(Boolean)
      .join('\n\n');
    return trimString(blockText || message.content);
  };

  const messageCopyActionKey = (message: FlowerChatMessage): string => `message:${message.id}:copy`;


  const copyMessageText = async (message: FlowerChatMessage, text: string) => {
    const value = trimString(text);
    if (!value) return;
    const key = messageCopyActionKey(message);
    try {
      await writeTextToClipboard(value);
      if (copiedMessageResetTimer !== undefined) {
        window.clearTimeout(copiedMessageResetTimer);
      }
      setCopiedMessageAction(key);
      copiedMessageResetTimer = window.setTimeout(() => {
        if (copiedMessageAction() === key) {
          setCopiedMessageAction('');
        }
        copiedMessageResetTimer = undefined;
      }, MESSAGE_COPY_RESET_MS);
    } catch (error) {
      setThreadActionError(getErrorMessage(error));
    }
  };

  const messageCopyButton = (message: FlowerChatMessage, text: string, placement: 'assistant' | 'user'): JSX.Element | null => {
    const value = trimString(text);
    if (!value) return null;
    const copied = () => copiedMessageAction() === messageCopyActionKey(message);
    const label = () => copied() ? copy().chat.messageCopied : copy().chat.copyMessage;
    return (
      <button
        type="button"
        class={cn('flower-message-copy-button', `flower-message-copy-button-${placement}`)}
        data-copied={copied() ? 'true' : 'false'}
        aria-label={label()}
        title={label()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void copyMessageText(message, value);
        }}
      >
        <Copy class="flower-message-copy-icon flower-message-copy-icon-idle h-3.5 w-3.5" />
        <Check class="flower-message-copy-icon flower-message-copy-icon-copied h-3.5 w-3.5" />
      </button>
    );
  };

  const questionMode = (question: FlowerInputRequestQuestion): NonNullable<FlowerInputRequestQuestion['response_mode']> => {
    return question.response_mode;
  };

  const questionAllowsText = (question: FlowerInputRequestQuestion): boolean => {
    const mode = questionMode(question);
    return mode === 'write' || mode === 'select_or_write';
  };

  const questionDraft = (questionID: string): FlowerInputDraft => currentComposerSessionDraft().inputDrafts[questionID] ?? {};

  const setQuestionDraft = (questionID: string, next: FlowerInputDraft) => {
    updateCurrentComposerSessionDraft((draft) => {
      const current = draft.inputDrafts[questionID] ?? {};
      const nextDraft = {
        ...(trimString(next.choice_id) ? { choice_id: trimString(next.choice_id) } : {}),
        ...(next.text !== undefined ? { text: next.text } : {}),
      };
      const nextInputDrafts = {
        ...draft.inputDrafts,
        [questionID]: nextDraft,
      };
      if (sameFlowerInputDrafts({ [questionID]: current }, { [questionID]: nextDraft })) {
        return draft;
      }
      return { ...draft, inputDrafts: nextInputDrafts };
    });
    setInputSubmitError('');
  };

  const selectInputChoice = (question: FlowerInputRequestQuestion, choice: FlowerInputRequestChoice) => {
    setQuestionDraft(question.id, {
      choice_id: choice.choice_id,
    });
  };

  const updateInputText = (question: FlowerInputRequestQuestion, text: string) => {
    if (!questionAllowsText(question)) return;
    setQuestionDraft(question.id, {
      text,
    });
  };

  const updateComposerText = (value: string) => {
    const waitingQuestion = activeInputQuestion();
    if (selectedInputRequest() && waitingQuestion) {
      updateInputText(waitingQuestion, value);
      setInputSubmitError('');
      return;
    }
    updateCurrentComposerSessionDraft((draft) => (draft.chatDraft === value ? draft : { ...draft, chatDraft: value }));
    setChatSubmitError('');
  };

  const inputTextQuestions = createMemo(() => selectedInputRequest()?.questions.filter(questionAllowsText) ?? []);

  const activeInputQuestion = createMemo(() => {
    const questions = inputTextQuestions();
    const activeID = trimString(currentComposerSessionDraft().activeInputQuestionID);
    return questions.find((question) => question.id === activeID) ?? questions[0] ?? null;
  });
  const activeInputQuestionIsSecret = createMemo(() => !!selectedInputRequest() && !!activeInputQuestion()?.is_secret);

  const composerTextValue = createMemo(() => {
    if (!selectedInputRequest()) return currentComposerSessionDraft().chatDraft;
    const question = activeInputQuestion();
    return question ? questionDraft(question.id).text ?? '' : '';
  });

  const composerPlaceholder = createMemo(() => {
    if (selectedThreadReadOnly()) return selectedThreadReadOnlyDisplay();
    if (surfaceWarmupActive() && !selectedInputRequest()) return copy().chat.warmupComposerPlaceholder;
    if (!selectedInputRequest()) return copy().chat.placeholder;
    const question = activeInputQuestion();
    if (!question) {
      return chatCopyValue('inputRequestChoicePlaceholder', 'Choose an option to continue.');
    }
    return trimString(question.write_placeholder)
      || trimString(question.question)
      || chatCopyValue('inputRequestComposerPlaceholder', 'Reply to continue this conversation.');
  });

  const composerTextareaDisabled = createMemo(() => {
    if (selectedComposerApprovalAction()) return true;
    if (selectedThreadReadOnly()) return true;
    if (!selectedInputRequest()) return false;
    return inputSubmitting() || !activeInputQuestion();
  });

  const composerChatDraftText = createMemo(() => trimString(currentComposerSessionDraft().chatDraft));
  const composerSlashCommand = createMemo(() => (selectedInputRequest() || selectedComposerApprovalAction()) ? { kind: 'none' as const } : parseFlowerSlashCommand(composerChatDraftText()));
  const composerPrimaryActionIsCommand = createMemo(() => composerSlashCommand().kind === 'intent');
  const composerPrimaryActionIsStop = createMemo(() => selectedThreadCanStop() && !composerChatDraftText());
  const composerPrimaryActionIcon = createMemo(() => composerPrimaryActionIsStop() ? FlowerStopIcon : composerPrimaryActionIsCommand() ? Clock : ArrowUp);
  const composerPrimaryActionLabel = createMemo(() => composerPrimaryActionIsStop() ? copy().chat.stop : composerPrimaryActionIsCommand() ? copy().chat.compactContext : copy().chat.send);
  const composerPrimaryActionDisabled = createMemo(() => {
    if (selectedComposerApprovalAction()) return true;
    if (threadStopping() || chatRunning()) return true;
    if (selectedThreadReadOnly()) return true;
    if (composerSlashCommand().kind === 'invalid') return true;
    if (composerPrimaryActionIsCommand()) {
      return compactSubmitting() || !readyForChat() || !!selectedInputRequest() || !selectedThreadID() || !selectedThreadHasContent();
    }
    if (selectedThreadCanStop()) return false;
    return !readyForChat() || !handlerAllowsSubmitIntent() || !composerChatDraftText();
  });
  const composerPrimaryActionLoading = createMemo(() => (
    threadStopping() || chatRunning() || (composerPrimaryActionIsCommand() && compactSubmitting())
  ));

  const questionAnswer = (question: FlowerInputRequestQuestion): FlowerInputAnswer | null => {
    const draft = questionDraft(question.id);
    const choiceID = trimString(draft.choice_id);
    const text = trimString(draft.text);
    const mode = questionMode(question);

    if (mode === 'write') return text ? { text } : null;
    if (mode === 'select') return choiceID ? { choice_id: choiceID } : null;
    if (mode === 'select_or_write' && text) {
      return { text };
    }
    if (mode === 'select_or_write' && choiceID) {
      return { choice_id: choiceID };
    }
    return null;
  };

  const inputRequestAnswers = (): Record<string, FlowerInputAnswer> | null => {
    const request = selectedInputRequest();
    if (!request) return null;
    const answers: Record<string, FlowerInputAnswer> = {};
    for (const question of request.questions) {
      const answer = questionAnswer(question);
      if (!answer) {
        return null;
      }
      answers[question.id] = answer;
    }
    return answers;
  };

  const inputRequestReadyToSubmit = createMemo(() => !!selectedInputRequest() && inputRequestAnswers() !== null);
  const composerErrorMessage = createMemo(() => composerApprovalError() || inputSubmitError() || chatSubmitError());

  const submitInputRequest = async () => {
    const thread = selectedThread();
    const request = selectedInputRequest();
    if (!thread || !request) return;
    const answers = inputRequestAnswers();
    if (!answers) {
      setInputSubmitError(chatCopyValue('inputRequestAnswerRequired', 'Answer every question before continuing.'));
      return;
    }
    setInputSubmitting(true);
    setInputSubmitError('');
    try {
      const reasoningSelection = serializeFlowerReasoningSelection(composerReasoningOverride() ?? selectedWaitingReasoningSelection());
      const next = await props.adapter.submitInput({
        thread_id: thread.thread_id,
        prompt_id: request.prompt_id,
        answers,
        ...(reasoningSelection ? { reasoning_selection: reasoningSelection } : {}),
      });
      const nextThread = applyLiveBootstrap(next);
      setSelectedThreadID(nextThread.thread_id);
      updateCurrentComposerSessionDraft((draft) => ({
        ...draft,
        inputPromptSignature: '',
        inputDrafts: {},
        activeInputQuestionID: '',
        reasoningOverride: undefined,
      }));
      requestComposerFocus();
      setInputSubmitError('');
      await refreshSelectedThread(nextThread.thread_id);
    } catch (error) {
      setInputSubmitError(getErrorMessage(error));
    } finally {
      setInputSubmitting(false);
    }
  };

  const submitApprovalAction = async (action: FlowerApprovalAction, approved: boolean) => {
    const thread = selectedThread();
    if (!thread || approvalSubmitting()[action.action_id]) return;
    setThreadActionError('');
    setComposerApprovalError('');
    setApprovalSubmitting((current) => ({ ...current, [action.action_id]: approved ? 'approve' : 'reject' }));
    try {
      if (action.origin === 'delegated_subagent') {
        await props.adapter.submitApproval({
          thread_id: thread.thread_id,
          origin: 'delegated_subagent',
          action_id: action.action_id,
          approved,
          ...(action.version ? { version: action.version } : {}),
          ...(action.surface_epoch ? { surface_epoch: action.surface_epoch } : {}),
          idempotency_key: `${action.action_id}:${approved ? 'approve' : 'reject'}:${action.version}:${action.surface_epoch ?? 0}`,
          delegated_ref: action.delegated_ref,
        });
      } else {
        await props.adapter.submitApproval({
          thread_id: thread.thread_id,
          origin: action.origin,
          run_id: action.run_id,
          action_id: action.action_id,
          tool_id: action.tool_id,
          approved,
          ...(action.expected_seq ? { expected_seq: action.expected_seq } : {}),
          ...(action.revision ? { revision: action.revision } : {}),
          ...(action.version ? { version: action.version } : {}),
          ...(action.surface_epoch ? { surface_epoch: action.surface_epoch } : {}),
        });
      }
      void applySelectedThreadLiveEvents(thread.thread_id, threadLoadSequence);
      setComposerApprovalError('');
    } catch (error) {
      const message = getErrorMessage(error);
      setComposerApprovalError(message);
      setThreadActionError(message);
      await reloadSelectedThread(thread.thread_id);
    } finally {
      setApprovalSubmitting((current) => {
        const next = { ...current };
        delete next[action.action_id];
        return next;
      });
    }
  };

  const copyApprovalCommand = async (action: FlowerApprovalAction) => {
    const command = trimString(action.summary.command);
    if (!command) return;
    const key = `approval:${action.action_id}:command`;
    try {
      await writeTextToClipboard(command);
      setCopiedApprovalAction(key);
      if (copiedApprovalResetTimer !== undefined) {
        window.clearTimeout(copiedApprovalResetTimer);
      }
      copiedApprovalResetTimer = window.setTimeout(() => {
        if (copiedApprovalAction() === key) {
          setCopiedApprovalAction('');
        }
        copiedApprovalResetTimer = undefined;
      }, 1600);
    } catch (error) {
      setThreadActionError(getErrorMessage(error));
    }
  };

  const inputRequestPrompt = (request: FlowerInputRequest | null | undefined) => (
    <Show when={request}>
      {(inputRequest) => (
        <section class="flower-input-request-panel" data-flower-input-request-prompt aria-label={chatCopyValue('inputRequestTitle', 'Waiting for your reply')}>
          <div class="flower-input-request-heading">
            <div class="flower-input-request-icon"><Clock class="h-4 w-4" /></div>
            <div class="flower-input-request-copy">
              <div class="flower-input-request-title">{chatCopyValue('inputRequestTitle', 'Waiting for your reply')}</div>
              <div class="flower-input-request-description">
                {inputRequest().public_summary || chatCopyValue('inputRequestDescription', 'Reply in the composer to continue this conversation.')}
              </div>
            </div>
          </div>
          <div class="flower-input-request-questions">
            <For each={inputRequest().questions}>
              {(question) => {
                const selectedChoiceID = () => trimString(questionDraft(question.id).choice_id);
                return (
                  <div
                    class={cn(
                      'flower-input-request-question',
                      activeInputQuestion()?.id === question.id && 'flower-input-request-question-active',
                    )}
                  >
                    <div class="flower-input-request-question-copy">
                      <div class="flower-input-request-question-header">{question.header}</div>
                      <div class="flower-input-request-question-text">{question.question}</div>
                    </div>
                    <Show when={(question.choices?.length ?? 0) > 0}>
                      <div class="flower-input-request-choice-grid">
                        <For each={question.choices ?? []}>
                          {(choice) => (
                            <button
                              type="button"
                              class={cn(
                                'flower-input-request-choice',
                                selectedChoiceID() === choice.choice_id && 'flower-input-request-choice-selected',
                              )}
                              aria-pressed={selectedChoiceID() === choice.choice_id}
                              disabled={inputSubmitting()}
                              onClick={() => selectInputChoice(question, choice)}
                            >
                              <span class="flower-input-request-choice-label">{choice.label}</span>
                              <Show when={choice.description}>
                                {(description) => <span class="flower-input-request-choice-description">{description()}</span>}
                              </Show>
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
          <Show when={inputTextQuestions().length > 1}>
            <div class="flower-input-request-text-targets" role="tablist" aria-label={chatCopyValue('inputRequestComposerPlaceholder', 'Reply to continue this conversation.')}>
              <For each={inputTextQuestions()}>
                {(question) => (
                  <button
                    type="button"
                    class={cn(
                      'flower-input-request-text-target',
                      activeInputQuestion()?.id === question.id && 'flower-input-request-text-target-active',
                    )}
                    aria-selected={activeInputQuestion()?.id === question.id}
                    disabled={inputSubmitting()}
                    onClick={() => updateCurrentComposerSessionDraft((draft) => (draft.activeInputQuestionID === question.id ? draft : { ...draft, activeInputQuestionID: question.id }))}
                  >
                    {question.write_label || question.header}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </section>
      )}
    </Show>
  );

  const approvalEffectLabel = (raw: string): string => {
    const value = trimString(raw).toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
    switch (value) {
      case 'read':
      case 'reads':
      case 'file_read':
      case 'read_file':
      case 'read_files':
      case 'filesystem_read':
        return 'Reads files';
      case 'write':
      case 'writes':
      case 'file_write':
      case 'write_file':
      case 'filesystem_write':
      case 'mutation':
      case 'mutating':
        return 'Writes files';
      case 'network':
      case 'network_read':
      case 'open_world':
      case 'web':
        return 'Uses network';
      case 'shell':
      case 'terminal':
      case 'command':
      case 'process':
        return 'Runs shell';
      default:
        return '';
    }
  };

  const approvalFlagLabel = (raw: string): string => {
    const value = trimString(raw).toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
    switch (value) {
      case 'destructive':
        return 'May delete or overwrite';
      case 'open_world':
        return 'May reach outside the workspace';
      case 'read_only':
        return 'Read only';
      default:
        return '';
    }
  };

  const approvalVisibleEffects = (action: FlowerApprovalAction): readonly string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of action.summary.effects ?? []) {
      const label = approvalEffectLabel(raw);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      out.push(label);
    }
    return out;
  };

  const approvalVisibleFlags = (action: FlowerApprovalAction): readonly string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of action.summary.flags ?? []) {
      const label = approvalFlagLabel(raw);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      out.push(label);
    }
    return out;
  };

  const approvalActionCard = (action: FlowerApprovalAction, options: Readonly<{ surface?: 'history' | 'composer' }> = {}) => {
    const busy = approvalSubmitting()[action.action_id];
    const canDecide = approvalActionCanDecide(action);
    const disabled = busy !== undefined || !canDecide;
    const composerSurface = options.surface === 'composer';
    const descriptionID = `flower-approval-description-${action.action_id}`;
    const statusID = `flower-approval-status-${action.action_id}`;
    const actionLabel = action.summary.label || action.tool_name || copy().chat.toolApprovalRequired;
    const subtaskLabel = action.delegated_ref?.subagent_id ? copy().chat.toolApprovalSubtaskSuffix(action.delegated_ref.subagent_id) : '';
    const commandText = trimString(action.summary.command);
    const descriptionText = action.summary.description || action.read_only_reason || '';
    const hasDescription = Boolean(descriptionText);
    const visibleEffects = approvalVisibleEffects(action);
    const visibleFlags = approvalVisibleFlags(action);
    const commandCopyKey = `approval:${action.action_id}:command`;
    const commandCopied = () => copiedApprovalAction() === commandCopyKey;
    const delegatedStatusCopy = () => copy().chat.delegatedApprovalStatus;
    const statusCopy = (() => {
      if (action.status === 'unavailable' || action.state === 'unavailable' || action.delivery_state === 'delivery_unavailable') {
        return action.read_only_reason || delegatedStatusCopy().unavailable;
      }
      if (action.delivery_state === 'delivery_pending') {
        return delegatedStatusCopy().pending;
      }
      if (action.delivery_state === 'delivery_delivered') {
        return delegatedStatusCopy().delivered;
      }
      if (action.delivery_state === 'delivery_failed' || action.delivery_state === 'delivery_ack_unknown') {
        return delegatedStatusCopy().failed;
      }
      if (!canDecide && !approvalActionIsPrimarySurface(action)) {
        return delegatedStatusCopy().handledInCurrentThread;
      }
      return '';
    })();
    const describedBy = [hasDescription ? descriptionID : '', statusCopy ? statusID : ''].filter(Boolean).join(' ');
    const unavailableCopy = (() => {
      if (!approvalActionIsPrimarySurface(action)) return delegatedStatusCopy().handledInCurrentThread;
      if (action.delivery_state === 'delivery_pending') return delegatedStatusCopy().deliveryInProgress;
      if (action.delivery_state === 'delivery_delivered') return delegatedStatusCopy().deliveryDelivered;
      if (action.delivery_state === 'delivery_failed' || action.delivery_state === 'delivery_ack_unknown') return delegatedStatusCopy().deliveryNeedsReview;
      return action.read_only_reason || copy().chat.toolApprovalUnavailable;
    })();
    const approvalIntroText = (() => {
      const toolName = action.tool_name;
      if (toolName === 'terminal.exec') return 'Flower wants to execute a shell command';
      if (toolName === 'file.edit') return 'Flower wants to edit a file';
      if (toolName === 'file.write') return 'Flower wants to write a file';
      if (toolName === 'apply_patch') return 'Flower wants to apply a patch';
      return 'Flower needs your approval';
    })();
    const riskNote = () => {
      const notes: string[] = [];
      if (visibleFlags.includes('May reach outside the workspace')) notes.push('This command accesses the network.');
      if (visibleEffects.includes('Writes files')) notes.push('This will modify files.');
      return notes.length > 0 ? notes.join(' ') : '';
    };
    return (
      <section
        class={cn('flower-approval-card', composerSurface && 'flower-approval-card-composer')}
        data-flower-approval-action-id={action.action_id}
        data-flower-approval-origin={action.origin}
        data-flower-approval-surface-role={action.surface_role || 'primary_action'}
        data-flower-composer-approval={composerSurface ? 'true' : undefined}
      >
        <div class="flower-approval-body">
          <div class="flower-approval-header">
            <p class="flower-approval-intro">{approvalIntroText}</p>
            <Show when={commandText}>
              <button
                type="button"
                class="flower-approval-copy-btn"
                data-copied={commandCopied() ? 'true' : 'false'}
                aria-label={`${copy().chat.toolApprovalCopyCommand}${subtaskLabel}`}
                title={commandCopied() ? copy().chat.toolApprovalCopied : copy().chat.toolApprovalCopyCommand}
                onClick={() => void copyApprovalCommand(action)}
              >
                <Copy class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </Show>
          </div>
          <Show when={commandText}>
            {(command) => (
              <pre class="flower-approval-command-text"><FlowerShellCommandHighlight command={command()} /></pre>
            )}
          </Show>
          <Show when={!commandText && (action.summary.targets?.length ?? 0) > 0}>
            <div class="flower-approval-targets">
              <For each={action.summary.targets ?? []}>
                {(target) => <span class="flower-approval-target">{target.label}</span>}
              </For>
            </div>
          </Show>
          <Show when={!commandText && !((action.summary.targets?.length ?? 0) > 0) && action.summary.label}>
            <p class="flower-approval-fallback-label">{action.summary.label}</p>
          </Show>
          <Show when={riskNote()}>
            {(note) => <p class="flower-approval-risk">{note()}</p>}
          </Show>
          <Show when={statusCopy}>
            {(message) => <p class="flower-approval-status">{message()}</p>}
          </Show>
        </div>
        <Show when={!composerSurface}>
          <div class="flower-approval-actions">
            <Show when={canDecide} fallback={<div class="flower-approval-unavailable">{unavailableCopy}</div>}>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                loading={busy === 'reject'}
                aria-label={copy().chat.toolApprovalRejectAction(actionLabel, subtaskLabel)}
                aria-describedby={describedBy || undefined}
                onClick={() => void submitApprovalAction(action, false)}
              >
                {busy === 'reject' ? copy().chat.toolApprovalSubmitting : copy().chat.toolApprovalReject}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={disabled}
                loading={busy === 'approve'}
                aria-label={copy().chat.toolApprovalApproveAction(actionLabel, subtaskLabel)}
                aria-describedby={describedBy || undefined}
                onClick={() => void submitApprovalAction(action, true)}
              >
                {busy === 'approve' ? copy().chat.toolApprovalSubmitting : copy().chat.toolApprovalApprove}
              </Button>
            </Show>
          </div>
        </Show>
      </section>
    );
  };

  const threadLevelApprovalPanel = () => (
    <Show when={selectedThreadLevelApprovalActions().length > 0}>
      <section class="flower-thread-approval-panel" data-flower-thread-approval-panel aria-label={copy().chat.threadApprovalPanelLabel} aria-live="polite">
        <div class="flower-thread-approval-heading">
          <div class="flower-thread-approval-title">{copy().chat.threadApprovalPanelTitle(selectedThreadLevelApprovalActions().length)}</div>
        </div>
        <For each={selectedThreadLevelApprovalActions()}>
          {(action) => approvalActionCard(action)}
        </For>
      </section>
    </Show>
  );

  const activityInlineLoader = (className = '') => (
    <span class={cn('flower-activity-inline-loader', className)} aria-hidden="true">
      <span class="flower-activity-inline-loader-square" />
      <span class="flower-activity-inline-loader-square" />
      <span class="flower-activity-inline-loader-square" />
      <span class="flower-activity-inline-loader-square" />
    </span>
  );

  const statusIcon = (status: FlowerActivityStatus) => {
    switch (status) {
      case 'success':
        return <Check class="h-3.5 w-3.5" />;
      case 'error':
      case 'canceled':
        return <AlertTriangle class="h-3.5 w-3.5" />;
      case 'waiting':
        return <span class="flower-activity-waiting-clock" aria-hidden="true" />;
      case 'pending':
        return <Clock class="h-3.5 w-3.5" />;
      case 'running':
        return activityInlineLoader();
    }
  };

  const todoStatusLabel = (status: FlowerActivityTodoStatus): string => {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'in_progress':
        return 'In progress';
      case 'cancelled':
        return 'Cancelled';
      case 'pending':
        return 'Pending';
    }
  };

  const todoStatusIcon = (status: FlowerActivityTodoStatus) => {
    switch (status) {
      case 'completed':
        return <Check class="h-3 w-3" />;
      case 'in_progress':
        return <Terminal class="h-3 w-3" />;
      case 'cancelled':
        return <AlertTriangle class="h-3 w-3" />;
      case 'pending':
        return <Clock class="h-3 w-3" />;
    }
  };

  const activityItemAwaitingApproval = (item: Pick<FlowerActivityItem, 'status' | 'requires_approval' | 'approval_state'>): boolean => (
    item.requires_approval === true
    && item.approval_state === 'requested'
    && item.status === 'waiting'
  );

  const activityItemNeedsAttention = (item: Pick<FlowerActivityItem, 'status' | 'requires_approval' | 'approval_state' | 'severity' | 'needs_attention'>): boolean => (
    item.needs_attention
    ||
    item.status === 'error'
    || item.status === 'waiting'
    || activityItemAwaitingApproval(item)
    || item.severity === 'blocking'
  );

  const formatActivityDuration = (durationMs: number | undefined): string => {
    const value = Number(durationMs ?? 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value < 1000) return `${Math.round(value)}ms`;
    if (value < 60_000) return `${Math.round(value / 1000)}s`;
    const minutes = Math.floor(value / 60_000);
    const seconds = Math.round((value % 60_000) / 1000);
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  };

  const activityItemKey = (timeline: FlowerActivityTimelineBlock, item: FlowerActivityItem, blockKey: string, index: number): string => (
    [selectedThreadID(), blockKey, timeline.run_id, timeline.turn_id, item.item_id, String(index)].map(trimString).filter(Boolean).join(':')
  );

  const activityItemDefaultOpen = (item: FlowerActivityItem): boolean => activityItemNeedsAttention(item);
  const activityItemHasVisiblePayload = (item: FlowerActivityItem): boolean => {
    const label = trimString(item.label);
    const toolName = trimString(item.tool_name);
    const kind = trimString(item.kind);
    if (label && label !== toolName && label !== kind) return true;
    if (trimString(item.description)) return true;
    if (item.payload && Object.keys(item.payload).length > 0) return true;
    if ((item.chips ?? []).length > 0 || (item.target_refs ?? []).length > 0) return true;
    return item.status !== 'success';
  };
  const activityItemVisible = (item: FlowerActivityItem): boolean => {
    if (activityItemAwaitingApproval(item) && !activityItemHasVisiblePayload(item)) return false;
    return true;
  };

  const activityItemOpen = (timeline: FlowerActivityTimelineBlock, item: FlowerActivityItem, blockKey: string, index: number): boolean => {
    const key = activityItemKey(timeline, item, blockKey, index);
    const local = openActivityRuns()[key];
    if (typeof local === 'boolean') return local;
    return activityItemDefaultOpen(item);
  };

  const toggleActivityItem = (timeline: FlowerActivityTimelineBlock, item: FlowerActivityItem, blockKey: string, index: number) => {
    const key = activityItemKey(timeline, item, blockKey, index);
    setOpenActivityRuns((current) => ({ ...current, [key]: !activityItemOpen(timeline, item, blockKey, index) }));
  };

  const activitySubagentAction = (timeline: FlowerActivityTimelineBlock, item: FlowerActivityItem) => (
    timeline.subagent_actions?.[trimString(item.item_id)]
  );

  const activityItemAriaLabel = (item: FlowerActivityItem, timeline: FlowerActivityTimelineBlock): string => (
    [
      presentFlowerActivityItem(item, timeline.file_actions, { subagents: subagentsCopy() }, { subagentAction: activitySubagentAction(timeline, item) }).label,
      copy().chat.toolStatuses[item.status],
      item.requires_approval ? copy().chat.toolApprovalState(approvalStateLabel(item.approval_state, copy())) : '',
    ].filter(Boolean).join('. ')
  );

  const activityTitle = (title: FlowerActivityTitle) => {
    if (title.kind === 'file') {
      return (
        <>
          <strong class="flower-activity-inline-title-verb">{title.verb}</strong>
          <span class="flower-activity-inline-title-target">{title.display_name}</span>
        </>
      );
    }
    return <span class="flower-activity-inline-title-target">{title.kind === 'command' ? title.command : title.text}</span>;
  };

  const openActivityFileBrowser = (messageID: string, blockIndex: number, itemID: string, action: FlowerActivityFileAction) => {
    if (!action.can_browse_directory || !trimString(action.action_id) || !props.adapter.openFileBrowser) return;
    void props.adapter.openFileBrowser({
      thread_id: trimString(selectedThreadID()) || undefined,
      message_id: messageID,
      block_index: blockIndex,
      item_id: itemID,
      action_id: action.action_id,
    }).catch((error) => {
      setThreadActionError(getErrorMessage(error));
    });
  };

  const openActivityFilePreview = (messageID: string, blockIndex: number, itemID: string, action: FlowerActivityFileAction) => {
    if (!action.can_preview || !trimString(action.action_id) || !props.adapter.openFilePreview) return;
    void props.adapter.openFilePreview({
      thread_id: trimString(selectedThreadID()) || undefined,
      message_id: messageID,
      block_index: blockIndex,
      item_id: itemID,
      action_id: action.action_id,
    }).catch((error) => {
      setThreadActionError(getErrorMessage(error));
    });
  };

  const fileActionButtons = (messageID: string, blockIndex: number, itemID: string, action: FlowerActivityFileAction) => (
    <div class="flower-activity-file-actions" aria-label="File actions">
      <button
        type="button"
        class="flower-activity-file-action-button"
        title="Preview file"
        aria-label={`Preview ${action.display_name || 'file'}`}
        disabled={!action.can_preview || !trimString(action.action_id) || !props.adapter.openFilePreview}
        onClick={(event) => {
          event.stopPropagation();
          openActivityFilePreview(messageID, blockIndex, itemID, action);
        }}
      >
        <FileText class="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        class="flower-activity-file-action-button"
        title="Browse folder"
        aria-label={`Browse folder for ${action.display_name || 'file'}`}
        disabled={!action.can_browse_directory || !trimString(action.action_id) || !props.adapter.openFileBrowser}
        onClick={(event) => {
          event.stopPropagation();
          openActivityFileBrowser(messageID, blockIndex, itemID, action);
        }}
      >
        <FolderOpen class="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const disabledFileAction = (displayName: string): FlowerActivityFileAction => ({
    action_id: '',
    display_name: trimString(displayName) || 'file',
    can_preview: false,
    can_browse_directory: false,
  });

  const detailLinesBlock = (block: Extract<FlowerActivityDetailBlock, { kind: 'structured' | 'terminal' }>) => (
    <>
      <For each={block.lines}>
        {(line) => (
          <div class="flower-activity-inline-detail-line">
            <span class="flower-activity-inline-detail-key">{line.label}</span>
            <span class={cn('flower-activity-inline-detail-value', line.tone === 'code' && 'flower-activity-inline-detail-value-code')}>{line.value}</span>
          </div>
        )}
      </For>
    </>
  );

  const fileReadBlock = (messageID: string, blockIndex: number, itemID: string, block: Extract<FlowerActivityDetailBlock, { kind: 'file_read' }>) => {
    const lineSummary = (() => {
      const start = Math.max(1, Math.floor(Number(block.line_offset || 1)));
      const count = Math.max(0, Math.floor(Number(block.line_count || 0)));
      const total = Math.max(0, Math.floor(Number(block.total_lines || 0)));
      if (count <= 0) return total > 0 ? `0 lines of ${total}` : '0 lines';
      const end = start + count - 1;
      return total > 0 ? `lines ${start}-${end} of ${total}` : `lines ${start}-${end}`;
    })();
    return (
      <div class="flower-activity-file-read">
        <div class="flower-activity-file-toolbar">
          <span class="flower-activity-file-meta">
            {lineSummary}
            <Show when={block.truncated}>
              <span class="flower-activity-file-truncated"> · truncated</span>
            </Show>
          </span>
          {fileActionButtons(messageID, blockIndex, itemID, block.action)}
        </div>
        <pre class="flower-activity-file-read-content"><code>{block.content}</code></pre>
      </div>
    );
  };

  const fileDiffBlock = (messageID: string, blockIndex: number, itemID: string, block: Extract<FlowerActivityDetailBlock, { kind: 'file_diff' }>) => (
    <div class="flower-activity-file-diff-list">
      <For each={block.files}>
        {(file) => fileDiffFile(messageID, blockIndex, itemID, file)}
      </For>
    </div>
  );

  const fileDiffFile = (messageID: string, blockIndex: number, itemID: string, file: FlowerActivityDiffFile) => (
    <section class="flower-activity-file-diff-file">
      <div class="flower-activity-file-toolbar">
        <span class="flower-activity-file-path">{file.display_name}</span>
        <span class="flower-activity-file-change">{file.change_type}</span>
        <Show when={file.additions || file.deletions}>
          <span class="flower-activity-file-change">
            <span class="flower-activity-file-stat-add">+{file.additions}</span>
            {' / '}
            <span class="flower-activity-file-stat-del">-{file.deletions}</span>
          </span>
        </Show>
        <Show when={file.truncated}>
          <span class="flower-activity-file-truncated">Diff truncated</span>
        </Show>
        {fileActionButtons(messageID, blockIndex, itemID, file.action)}
      </div>
      <div class="flower-activity-file-diff-grid">
        <Show
          when={getGitPatchRenderSnapshot(file.patch_text).renderedLines.length > 0}
          fallback={<div class="flower-activity-file-diff-empty">{file.diff_unavailable_reason || 'No textual diff'}</div>}
        >
          <div class="flower-activity-file-diff-unified">
            <For each={getGitPatchRenderSnapshot(file.patch_text).renderedLines}>
              {(line) => fileDiffLine(line)}
            </For>
          </div>
        </Show>
      </div>
    </section>
  );

  const fileDiffLine = (line: GitPatchRenderedLine) => (
    <div class={cn('flower-activity-file-diff-line', `flower-activity-file-diff-line-${line.kind}`)}>
      <span class="flower-activity-file-diff-line-number">{formatGitPatchLineNumber(line.oldLine)}</span>
      <span class="flower-activity-file-diff-line-number flower-activity-file-diff-line-number-new">{formatGitPatchLineNumber(line.newLine)}</span>
      <code>{line.text}</code>
    </div>
  );

  const activityDetailBlock = (messageID: string, blockIndex: number, itemID: string, block: FlowerActivityDetailBlock) => {
    if (block.kind === 'todos') {
      return (
        <div class="flower-activity-todo-list" role="list" aria-label="Todos">
          <For each={block.items}>
            {(todo) => (
              <div
                class={cn('flower-activity-todo-item', `flower-activity-todo-item-${todo.status}`)}
                role="listitem"
                data-status={todo.status}
              >
                <span class="flower-activity-todo-marker" aria-hidden="true">{todoStatusIcon(todo.status)}</span>
                <span class="flower-activity-todo-copy">
                  <span class={cn('flower-activity-todo-content', todo.status === 'completed' && 'flower-activity-todo-content-completed')}>
                    {todo.content}
                  </span>
                  <span class="flower-activity-todo-meta">
                    {todoStatusLabel(todo.status)}
                    <Show when={todo.note}>
                      {(note) => <span class="flower-activity-todo-note"> · {note()}</span>}
                    </Show>
                  </span>
                </span>
              </div>
            )}
          </For>
        </div>
      );
    }
    if (block.kind === 'file_read') return fileReadBlock(messageID, blockIndex, itemID, block);
    if (block.kind === 'file_diff') return fileDiffBlock(messageID, blockIndex, itemID, block);
    return detailLinesBlock(block);
  };

  const activityRow = (
    messageID: Accessor<string>,
    blockIndex: Accessor<number>,
    timeline: Accessor<FlowerActivityTimelineBlock>,
    item: Accessor<FlowerActivityItem>,
    blockKey: Accessor<string>,
    index: Accessor<number>,
  ) => {
    const open = createMemo(() => activityItemOpen(timeline(), item(), blockKey(), index()));
    const presentation = createMemo(() => presentFlowerActivityItem(item(), timeline().file_actions, { subagents: subagentsCopy() }, { subagentAction: activitySubagentAction(timeline(), item()) }));
    const rowFileAction = createMemo(() => {
      const value = presentation();
      return value.primaryAction ?? (value.title.kind === 'file' ? disabledFileAction(value.title.display_name) : null);
    });
    const displayStatus = createMemo(() => item().status);
    const isReadOnly = createMemo(() => activityItemAwaitingApproval(item()));
    const duration = createMemo(() => {
      const value = item();
      return formatActivityDuration((value.started_at_unix_ms && value.ended_at_unix_ms
        ? value.ended_at_unix_ms - value.started_at_unix_ms
        : undefined) ?? timeline().summary.duration_ms);
    });
    return (
      <div
        class={cn('flower-activity-inline-row', `flower-activity-inline-row-${displayStatus()}`)}
        data-flower-activity-item-id={item().item_id}
        data-flower-activity-status={displayStatus()}
        aria-label={activityItemAriaLabel(item(), timeline())}
      >
        <div class="flower-activity-inline-line">
          <button
            type="button"
            class="flower-activity-inline-button"
            aria-expanded={isReadOnly() ? undefined : open()}
            onClick={isReadOnly() ? undefined : () => toggleActivityItem(timeline(), item(), blockKey(), index())}
          >
            <span class="flower-activity-inline-icon">{statusIcon(displayStatus())}</span>
            <span class="flower-activity-inline-copy">
              <span class="flower-activity-inline-title">{activityTitle(presentation().title)}</span>
              <Show when={presentation().meta}>
                {(meta) => <span class="flower-activity-inline-detail">{meta()}</span>}
              </Show>
            </span>
            <Show when={duration()}>
              {(value) => <span class="flower-activity-inline-duration">{value()}</span>}
            </Show>
            <span class={cn('flower-activity-inline-status', `flower-activity-inline-status-${displayStatus()}`)}>
              {copy().chat.toolStatuses[displayStatus()]}
            </span>
            <Show when={!isReadOnly()}>
              <ChevronDown class={cn('flower-activity-inline-chevron h-3.5 w-3.5', open() && 'flower-activity-inline-chevron-open')} />
            </Show>
          </button>
          <Show when={rowFileAction()}>
            {(action) => fileActionButtons(messageID(), blockIndex(), item().item_id, action())}
          </Show>
        </div>
        <Show when={open() && !isReadOnly()}>
          <div class="flower-activity-inline-details">
            <For each={presentation().detailBlocks}>
              {(block) => activityDetailBlock(messageID(), blockIndex(), item().item_id, block)}
            </For>
          </div>
        </Show>
      </div>
    );
  };

  const activityBlock = (
    messageID: Accessor<string>,
    blockIndex: Accessor<number>,
    block: Accessor<FlowerActivityTimelineBlock>,
    blockKey: Accessor<string>,
  ) => {
    const visibleItems = createMemo(() => block().items.filter(activityItemVisible));
    const visibleItemKeys = createMemo(() => visibleItems().map((item, index) => activityItemKey(block(), item, blockKey(), index)));
    const visibleItemsByKey = createMemo(() => {
      const items = visibleItems();
      return new Map(visibleItemKeys().map((key, index) => [key, { item: items[index], index }] as const));
    });

    return (
      <Show when={visibleItemKeys().length > 0}>
        <div class="flower-activity-inline" data-flower-activity-run-id={block().run_id}>
          <For each={visibleItemKeys()}>
            {(itemKey) => {
              const visibleItem = createMemo(() => visibleItemsByKey().get(itemKey) ?? null);
              return (
                <Show when={visibleItem()}>
                  {(value) => activityRow(
                    messageID,
                    blockIndex,
                    block,
                    () => value().item,
                    blockKey,
                    () => value().index,
                  )}
                </Show>
              );
            }}
          </For>
        </div>
      </Show>
    );
  };

  const messageContentBubble = (
    message: Accessor<FlowerChatMessage>,
    block: Accessor<Extract<FlowerRenderableMessageBlock, { type: 'content' }>>,
    streaming: Accessor<boolean>,
    failed: Accessor<boolean>,
    copyAction: Accessor<JSX.Element | null>,
  ) => {
    const markdown = createMemo(() => block().block_type === 'markdown');
    const assistantCopyLayout = createMemo(() => message().role === 'assistant' && block().block_type !== 'thinking');
    const ContentBody: Component = () => (
      <Show
        when={markdown()}
        fallback={<span class="flower-message-plain-text">{block().content}</span>}
      >
        <FlowerMarkdownBlock
          content={block().content}
          streaming={streaming()}
          copyCodeLabel={copy().chat.copyCode}
          codeCopiedLabel={copy().chat.codeCopied}
        />
      </Show>
    );

    const StableContentBody: Component = () => (
      <Show
        when={assistantCopyLayout()}
        fallback={<ContentBody />}
      >
        <div class="flower-message-assistant-copy-line">
          <div class="flower-message-assistant-copy-body">
            <ContentBody />
          </div>
          <Show when={copyAction()}>
            {(action) => action()}
          </Show>
        </div>
      </Show>
    );

    return (
      <div class={cn(
        'flower-message-bubble',
        message().role === 'user'
          ? 'flower-message-bubble-framed'
          : 'flower-message-bubble-plain',
        message().role === 'user'
          ? 'flower-message-bubble-user'
          : 'flower-message-bubble-assistant',
        message().id.startsWith('pending:') && 'flower-pending-turn-bubble',
        streaming() && 'flower-message-bubble-streaming',
        failed() && 'flower-message-bubble-error',
        block().block_type === 'thinking' && 'flower-message-bubble-thinking',
      )}>
        <Show when={failed()}>
          <div class="flower-message-error-kicker">
            <AlertTriangle class="h-3.5 w-3.5" />
            <span>{copy().chat.messageErrorTitle}</span>
          </div>
        </Show>
        <StableContentBody />
      </div>
    );
  };

  const lastCopyableContentBlockKey = (blocks: readonly FlowerRenderableMessageBlock[]): string => {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      if (block?.type === 'content' && block.block_type !== 'thinking' && trimString(block.content)) return block.key;
    }
    return '';
  };

  const lastContentBlockKey = (blocks: readonly FlowerRenderableMessageBlock[]): string => {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      if (block?.type === 'content') return block.key;
    }
    return '';
  };

  const messageBlockView = (
    message: Accessor<FlowerChatMessage>,
    block: Accessor<FlowerRenderableMessageBlock>,
    streamingBlockKey: Accessor<string>,
    failed: Accessor<boolean>,
    copyText: Accessor<string>,
    assistantCopyBlockKey: Accessor<string>,
  ) => {
    const activity = createMemo(() => block().type === 'activity' ? block() as Extract<FlowerRenderableMessageBlock, { type: 'activity' }> : null);
    const content = createMemo(() => block().type === 'content' ? block() as Extract<FlowerRenderableMessageBlock, { type: 'content' }> : null);
    return (
      <Show
        when={activity()}
        fallback={(
          <Show when={content()}>
            {(contentBlock) => {
              const copyAction = () => {
                const value = contentBlock();
                const currentMessage = message();
                return currentMessage.role === 'assistant' && value.key === assistantCopyBlockKey()
                  ? messageCopyButton(currentMessage, copyText(), 'assistant')
                  : null;
              };
              const streaming = () => streamingBlockKey() === contentBlock().key;
              return messageContentBubble(message, contentBlock, streaming, failed, copyAction);
            }}
          </Show>
        )}
      >
        {(activityBlockValue) => activityBlock(
          () => message().id,
          () => activityBlockValue().block_index,
          () => activityBlockValue().block,
          () => activityBlockValue().key,
        )}
      </Show>
    );
  };

  const messageEntry = (entry: Accessor<Extract<FlowerTimelineEntry, { type: 'message' }>>) => {
    const message = createMemo(() => entry().message);
    const pendingMessage = createMemo(() => message().id.startsWith('pending:'));
    const pendingState = createMemo(() => {
      if (!pendingMessage()) return '';
      const pendingID = trimString(message().id).replace(/^pending:/, '');
      const pending = pendingTurnsForSelectedThread().find((item) => item.message_id === pendingID);
      return pending ? pending.state : 'sending';
    });
    const pendingStateLabel = createMemo(() => pendingState() === 'queued' ? copy().chat.pendingQueued : copy().chat.pendingSending);
    const activeCursor = createMemo(() => (
      selectedThreadLiveStatus() === 'running'
      && message().role === 'assistant'
      && message().active_cursor === true
    ));
    const failed = createMemo(() => message().status === 'error');
    const hasRenderableBlock = createMemo(() => entry().blocks.length > 0);
    const visible = createMemo(() => {
      if (hasRenderableBlock()) return true;
      if (activeCursor()) return true;
      if (!failed()) return false;
      return !selectedThreadRunErrorMessage();
    });
    const blocks = createMemo((): readonly FlowerRenderableMessageBlock[] => {
      const placeholderBlock: FlowerRenderableMessageBlock | null = !hasRenderableBlock() && failed()
        ? {
            type: 'content',
            key: `${message().id}:placeholder`,
            block_index: -1,
            block_type: 'text',
            content: copy().chat.messageErrorFallback,
          }
        : null;
      return placeholderBlock ? [placeholderBlock] : entry().blocks;
    });
    const blockKeys = createMemo(() => blocks().map((block) => block.key));
    const blocksByKey = createMemo(() => new Map(blocks().map((block) => [block.key, block] as const)));
    const streamingBlockKey = createMemo(() => activeCursor() ? lastContentBlockKey(blocks()) : '');
    const copyText = createMemo(() => messageCopyText(message(), blocks()));
    const messageTime = createMemo(() => formatMessageTime(message().created_at_ms));
    const assistantCopyBlockKey = createMemo(() => message().role === 'assistant' ? lastCopyableContentBlockKey(blocks()) : '');
    const contextDisplay = createMemo(() => {
      const msg = message();
      if (msg.role !== 'user') return null;
      return parseChatContextAction(msg.context_action);
    });
    const isUnifiedUserBubble = createMemo(() => message().role === 'user' && contextDisplay() !== null);
    return (
      <Show when={visible()}>
        <div
          class={cn(
            'flower-message-row',
            message().role === 'user' ? 'flower-message-row-user' : 'flower-message-row-assistant',
            pendingMessage() && 'flower-pending-turn-row',
          )}
          data-flower-message-id={message().id}
          data-flower-message-role={message().role}
          data-flower-message-status={message().status}
          data-flower-pending-turn={pendingMessage() ? '' : undefined}
          data-flower-pending-turn-state={pendingMessage() ? pendingState() : undefined}
        >
          <Show
            when={isUnifiedUserBubble()}
            fallback={
              <div class={cn('flower-message-block-stack', message().role === 'user' ? 'flower-message-block-stack-user' : 'flower-message-block-stack-assistant')}>
                <For each={blockKeys()}>
                  {(blockKey) => {
                    const block = createMemo(() => blocksByKey().get(blockKey) ?? null);
                    return (
                      <Show when={block()}>
                        {(value) => messageBlockView(message, value, streamingBlockKey, failed, copyText, assistantCopyBlockKey)}
                      </Show>
                    );
                  }}
                </For>
                <Show when={message().role === 'user' && (copyText() || messageTime())}>
                  <div class={cn('flower-message-action-row flower-message-action-row-user', pendingMessage() && 'flower-pending-turn-meta')}>
                    <Show when={pendingMessage()}>
                      <span class="flower-pending-turn-state">{pendingStateLabel()}</span>
                    </Show>
                    <Show when={messageTime()}>
                      {(value) => <time class="flower-message-time" datetime={new Date(message().created_at_ms).toISOString()}>{value()}</time>}
                    </Show>
                    <Show when={!pendingMessage()}>
                      {messageCopyButton(message(), copyText(), 'user')}
                    </Show>
                  </div>
                </Show>
              </div>
            }
          >
            <div class="flower-message-block-stack flower-message-block-stack-user">
              <div class="flower-message-bubble flower-message-bubble-framed flower-message-bubble-user flower-chat-context-unified-bubble">
                <For each={blocks().filter((b): b is Extract<typeof b, { type: 'content' }> => b.type === 'content')}>
                  {(block) => <span class="flower-message-plain-text">{block.content}</span>}
                </For>
                <FlowerChatContextChips
                  contextDisplay={contextDisplay()!}
                  onChipClick={(chip) => setPreviewChip(chip)}
                />
              </div>
              <Show when={copyText() || messageTime()}>
                <div class="flower-message-action-row flower-message-action-row-user">
                  <Show when={messageTime()}>
                    {(value) => <time class="flower-message-time" datetime={new Date(message().created_at_ms).toISOString()}>{value()}</time>}
                  </Show>
                  {messageCopyButton(message(), copyText(), 'user')}
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    );
  };

  const compactionDividerEntry = (entry: Accessor<Extract<FlowerTimelineEntry, { type: 'context_compaction' }>>) => {
    const decoration = createMemo(() => entry().decoration);
    return <FlowerContextCompactionDivider decoration={decoration()} copy={copy()} />;
  };

  const inputRequestEntry = (entry: Accessor<FlowerTimelineEntry>) => {
    const request = createMemo(() => {
      const value = entry();
      return value.type === 'input_request' ? value.request : null;
    });
    return (
      <Show when={request()}>
        {(value) => inputRequestPrompt(value())}
      </Show>
    );
  };

  const errorEntry = (entry: Accessor<FlowerTimelineEntry>) => {
    const error = createMemo(() => {
      const value = entry();
      return value.type === 'error' ? value.error : null;
    });
    return (
      <Show when={error()}>
        {(value) => runErrorNotice(value())}
      </Show>
    );
  };

  const timelineEntry = (entry: Accessor<FlowerTimelineEntry>) => {
    switch (entry().type) {
      case 'message':
        return messageEntry(() => entry() as Extract<FlowerTimelineEntry, { type: 'message' }>);
      case 'context_compaction':
        return compactionDividerEntry(() => entry() as Extract<FlowerTimelineEntry, { type: 'context_compaction' }>);
      case 'input_request':
        return inputRequestEntry(entry);
      case 'error':
        return errorEntry(entry);
    }
  };

  const setupGuide = () => (
    <div class="flower-setup-guide" role="status">
      <FlowerSoftAuraIcon class="redeven-flower-soft-aura-lg h-14 w-14 redeven-flower-icon-breathe" iconClass="redeven-flower-icon-spin" />
      <div class="flower-setup-copy">
        <h2>{copy().chat.setupNeeded}</h2>
        <p>{settingsReadOnly() ? copy().settings.managedByLocalAIProfileOpenLocal : copy().chat.needsProviderNotice}</p>
      </div>
      <Show when={!settingsReadOnly()}>
        <button type="button" class="flower-setup-primary" onClick={openSettings}>
          <Settings class="h-4 w-4" />
          <span>{copy().chat.openSettings}</span>
        </button>
      </Show>
    </div>
  );

  const subagentStatusLabel = (status: FlowerSubagentPanelStatus): string => subagentsCopy().statusLabels[status] ?? subagentsCopy().statusLabels.unknown;
  const subagentTypeLabel = (agentType: string): string => {
    const value = trimString(agentType);
    const labels = subagentsCopy().typeLabels;
    switch (value) {
      case 'explore':
        return labels.explore;
      case 'worker':
        return labels.worker;
      case 'reviewer':
        return labels.reviewer;
      default:
        return labels.unknown;
    }
  };
  const formatSubagentRelativeTime = (updatedAtMs: number): string => {
    const diffMs = Date.now() - updatedAtMs;
    const seconds = Math.round(diffMs / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(updatedAtMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const subagentMeta = (item: FlowerSubagentPanelItem): string => (
    item.updatedAtMs ? formatSubagentRelativeTime(item.updatedAtMs) : ''
  );
  const subagentStatusIndicator = (status: FlowerSubagentPanelStatus) => {
    switch (status) {
      case 'queued':
      case 'running':
      case 'waiting_input':
        return (
          <span class={cn('flower-subagent-status-indicator', 'flower-subagent-status-indicator-running')} aria-hidden="true">
            {activityInlineLoader('flower-subagent-status-loader')}
          </span>
        );
      case 'completed':
        return <Check class="flower-subagent-status-indicator flower-subagent-status-indicator-completed h-3.5 w-3.5" aria-hidden="true" />;
      case 'failed':
      case 'timed_out':
        return <AlertTriangle class="flower-subagent-status-indicator flower-subagent-status-indicator-failed h-3.5 w-3.5" aria-hidden="true" />;
      case 'canceled':
        return <AlertTriangle class="flower-subagent-status-indicator flower-subagent-status-indicator-canceled h-3.5 w-3.5" aria-hidden="true" />;
      default:
        return <Clock class="flower-subagent-status-indicator flower-subagent-status-indicator-unknown h-3.5 w-3.5" aria-hidden="true" />;
    }
  };
  const subagentBadgeLabel = () => subagentsCopy().activity.agentsCount(String(selectedSubagentItems().length));
  const subagentBadgeText = () => {
    const count = selectedSubagentItems().length;
    return count > 99 ? '99+' : String(count);
  };
  const subagentRowTitle = (item: FlowerSubagentPanelItem): string => (
    trimString(item.title) || trimString(item.taskName) || trimString(item.threadID || item.subagentID) || subagentsCopy().typeLabels.unknown
  );
  const subagentDropdownSummary = (): string => (
    [
      `${selectedActiveSubagentCount()} ${subagentsCopy().activeLabel.toLowerCase()}`,
      `${selectedSettledSubagentCount()} ${subagentsCopy().completedLabel.toLowerCase()}`,
    ].join(' · ')
  );
  const activeSubagentTitle = createMemo(() => {
    const item = activeSubagentItem();
    if (item) return subagentRowTitle(item);
    const summary = subagentDetail()?.summary;
    return trimString(summary?.title)
      || trimString(summary?.task_name)
      || trimString(summary?.thread_id || summary?.subagent_id)
      || trimString(activeSubagentID())
      || subagentsCopy().typeLabels.unknown;
  });
  const subagentSummaryStatus = createMemo(() => {
    return subagentStatusLabel(subagentDetailActiveStatus());
  });
  const subagentDetailMeta = createMemo(() => {
    const detail = subagentDetail();
    const item = activeSubagentItem();
    const agentType = subagentTypeLabel(detail?.summary.agent_type || item?.agentType || '');
    const id = trimString(detail?.summary.thread_id || item?.threadID || item?.subagentID || activeSubagentID());
    return [agentType, id].filter(Boolean).join(' · ');
  });
  const subagentDetailHasRunningActivity = createMemo(() => (
    subagentDetail()?.timeline.some((row) => row.activity?.items.some((item) => item.status === 'running')) ?? false
  ));
  const subagentDetailModelIOStatus = createMemo<FlowerModelIOStatus | null>(() => {
    const now = Date.now();
    const runID = trimString(subagentDetail()?.summary.thread_id || activeSubagentID()) || 'subagent';
    switch (subagentDetailActiveStatus()) {
      case 'queued':
        return { phase: 'preparing', run_id: runID, updated_at_ms: now };
      case 'running':
        return {
          phase: subagentDetailHasRunningActivity() ? 'streaming' : 'waiting_response',
          run_id: runID,
          updated_at_ms: now,
        };
      default:
        return null;
    }
  });
  const subagentDetailModelStatusLabel = createMemo(() => {
    const status = subagentDetailModelIOStatus();
    return status ? modelStatusLabel(status.phase) : '';
  });
  const subagentDropdown = () => (
    <Show when={subagentDropdownOpen()}>
      <SurfaceFloatingLayer
        position={subagentDropdownPosition()}
        estimatedSize={SUBAGENT_DROPDOWN_ESTIMATED_SIZE}
        class="flower-subagents-dropdown-layer"
      >
        <div
          ref={subagentDropdownRef}
          id="flower-subagents-dropdown"
          class="flower-subagents-dropdown"
          role="dialog"
          aria-label={subagentsCopy().title}
          aria-modal="false"
        >
          <div class="flower-subagents-dropdown-header">
            <div class="flower-subagents-dropdown-title">
              <GitBranch class="h-4 w-4" />
              <span>{subagentsCopy().title}</span>
            </div>
            <span class="flower-subagents-dropdown-count">{selectedSubagentItems().length}</span>
          </div>
          <div class="flower-subagents-dropdown-summary">{subagentDropdownSummary()}</div>
          <Show
            when={selectedSubagentItems().length > 0}
            fallback={(
              <div class="flower-subagents-dropdown-empty">
                <GitBranch class="h-4 w-4" />
                <span>{subagentsCopy().emptyTitle}</span>
              </div>
            )}
          >
            <div class="flower-subagents-dropdown-list" role="list">
              <For each={selectedSubagentItems()}>
                {(item) => (
                  <button
                    type="button"
                    class={cn(
                      'flower-subagent-dropdown-row',
                      `flower-subagent-dropdown-row-${item.status}`,
                      activeSubagentID() === trimString(item.threadID || item.subagentID) && 'flower-subagent-dropdown-row-active',
                    )}
                    data-flower-subagent-thread-id={item.threadID}
                    data-flower-subagent-status={item.status}
                    title={subagentsCopy().openThread}
                    onClick={() => void openSubagentDetail(item)}
                  >
                    <span class="flower-subagent-dropdown-status">{subagentStatusIndicator(item.status)}</span>
                    <span class="flower-subagent-dropdown-name">{subagentRowTitle(item)}</span>
                    <span class="flower-subagent-dropdown-time">{subagentMeta(item)}</span>
                    <span class="flower-subagent-dropdown-action" aria-hidden="true">
                      <ChevronRight class="h-3.5 w-3.5" />
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </SurfaceFloatingLayer>
    </Show>
  );

  const subagentDetailThread = createMemo(() => projectSubagentDetailThread(subagentDetail(), activeSubagentID(), activeSubagentTitle()));
  const subagentDetailTimelineEntries = createMemo(() => buildFlowerTimelineEntries(subagentDetailThread()));
  const subagentDetailTimelineEntryKeys = createMemo(() => subagentDetailTimelineEntries().map((entry) => entry.key));
  const subagentDetailTimelineEntriesByKey = createMemo(() => new Map(subagentDetailTimelineEntries().map((entry) => [entry.key, entry] as const)));
  const subagentDetailWindowTitle = createMemo(() => [activeSubagentTitle(), subagentSummaryStatus()].filter(Boolean).join(' · '));
  const showSubagentDetailScrollToLatestButton = createMemo(() => (
    Boolean(subagentDetailThread())
    && !subagentDetailScroll.nearBottom()
  ));

  const subagentDetailDialog = () => (
    <FloatingWindow
      open={Boolean(activeSubagentID())}
      onOpenChange={(open) => {
        if (!open) closeSubagentOverlays();
      }}
      title={subagentDetailWindowTitle()}
      class="flower-subagent-detail-window"
      defaultSize={{ width: 760, height: 640 }}
      minSize={{ width: 420, height: 320 }}
      viewportInsets={{ top: 56, right: 12, bottom: 12, left: Math.max(12, threadRailWidth() + 12) }}
      resizable
      draggable
      zIndex={FLOWER_SURFACE_LAYER.subagentWindow}
    >
      <div class="flower-subagent-detail-surface" data-flower-subagent-detail-id={activeSubagentID()}>
        <div class="flower-subagent-detail-toolbar">
          <span class={cn('flower-subagent-status-pill', `flower-subagent-status-${subagentDetailActiveStatus()}`)}>
            {subagentStatusIndicator(subagentDetailActiveStatus())}
            {subagentSummaryStatus()}
          </span>
          <Show when={subagentDetailMeta()}>
            {(meta) => <span class="flower-subagent-detail-meta">{meta()}</span>}
          </Show>
        </div>
        <Show when={subagentDetailLoading()}>
          <div class="flower-subagent-detail-state" role="status">
            <Clock class="h-4 w-4" />
            <span>{copy().chat.threadLoading}</span>
          </div>
        </Show>
        <Show when={subagentDetailError()}>
          {(message) => (
            <div class="flower-subagent-detail-state flower-subagent-detail-state-error" role="alert">
              <AlertTriangle class="h-4 w-4" />
              <span>{message()}</span>
            </div>
          )}
        </Show>
        <Show when={subagentDetailThread()}>
          <div
            ref={(node) => { subagentDetailScroll.bind(node); }}
            class="flower-chat-transcript flower-subagent-detail-transcript"
            role="list"
            aria-label="Subagent timeline"
            onScroll={() => subagentDetailScroll.onScroll()}
          >
            <div class="flower-transcript-stack flower-subagent-detail-transcript-stack">
              <Show
                when={subagentDetailTimelineEntryKeys().length > 0}
                fallback={<div class="flower-subagent-detail-empty">{subagentsCopy().emptyDescription}</div>}
              >
                <For each={subagentDetailTimelineEntryKeys()}>
                  {(entryKey) => {
                    const entry = createMemo(() => subagentDetailTimelineEntriesByKey().get(entryKey) ?? null);
                    return (
                      <Show when={entry()}>
                        {(value) => <div role="listitem">{timelineEntry(value)}</div>}
                      </Show>
                    );
                  }}
                </For>
              </Show>
            </div>
            <Show when={showSubagentDetailScrollToLatestButton()}>
              <div class="flower-subagent-detail-scroll-to-latest">
                <button
                  type="button"
                  class="flower-scroll-to-latest-button"
                  aria-label={copy().chat.scrollToLatest}
                  title={copy().chat.scrollToLatest}
                  onClick={() => subagentDetailScroll.scrollToBottom({ smooth: true })}
                >
                  <ChevronDown class="h-4 w-4" />
                </button>
              </div>
            </Show>
          </div>
        </Show>
        <div class="flower-subagent-detail-bottom-dock">
          <Show when={subagentDetail()?.has_more}>
            <button
              type="button"
              class="flower-subagent-detail-load-more-button"
              disabled={subagentDetailLoadingMore() || subagentDetailTailLoading()}
              onClick={() => void loadMoreSubagentDetail()}
            >
              {subagentDetailLoadingMore() ? (subagentsCopy().loadingMore ?? 'Loading...') : (subagentsCopy().loadMore ?? 'Load more')}
            </button>
          </Show>
          <div class="flower-subagent-detail-live-lane" role="status" aria-live="polite" aria-atomic="true">
            <Show when={subagentDetailModelIOStatus()}>
              {(status) => modelStatusIndicator(status(), subagentDetailModelStatusLabel())}
            </Show>
            <Show when={subagentDetailTailLoading()}>
              <span class="flower-subagent-detail-tail-state">
                {activityInlineLoader('flower-subagent-detail-tail-loader')}
              </span>
            </Show>
            <Show when={subagentDetailTailError()}>
              {(message) => (
                <span class="flower-subagent-detail-tail-error">
                  <AlertTriangle class="h-3.5 w-3.5" />
                  <span>{message()}</span>
                </span>
              )}
            </Show>
          </div>
        </div>
      </div>
    </FloatingWindow>
  );

  const threadLoadingState = () => (
    <div class="flower-thread-loading" role="status" aria-live="polite">
      <div class="flower-thread-loading-panel">
        <div class="flower-thread-loading-eyebrow" aria-hidden="true" data-label="Flower" />
        <div class="flower-thread-loading-indicator" role="progressbar" aria-label={copy().chat.threadLoading}>
          <div class="flower-thread-loading-indicator-bar" />
        </div>
        <div class="flower-thread-loading-message">{copy().chat.threadLoading}</div>
      </div>
    </div>
  );

  const warmupPanel = () => (
    <div class="flower-warmup" role="status" aria-live="polite" aria-label={warmupTitle()}>
      <div class="flower-warmup-panel">
        <FlowerSoftAuraIcon class="redeven-flower-soft-aura-lg h-14 w-14 redeven-flower-icon-breathe" iconClass="redeven-flower-icon-spin" />
        <div class="flower-warmup-copy">
          <div class="flower-warmup-eyebrow">{warmupPhaseLabel()}</div>
          <h2>{warmupTitle()}</h2>
          <p>{warmupDetail()}</p>
        </div>
        <div class="flower-warmup-indicator" aria-hidden="true">
          <div class="flower-warmup-indicator-bar" />
        </div>
      </div>
    </div>
  );

  const chatPanel = () => (
    <div class="flower-chat-shell flower-chat-shell">
      <div class="flower-chat-header flower-chat-header border-b border-border/80 backdrop-blur-md">
        <div class="flower-chat-header-row">
          <div class="flex min-w-0 items-center gap-3">
            <FlowerIcon class="h-5 w-5 text-primary" />
            <div class="min-w-0 flex items-center gap-2">
              <div class="flower-chat-header-title truncate">{selectedThread()?.title || copy().chat.titleFallback}</div>
            </div>
          </div>
          <div class="flower-chat-header-actions">
            <div class="flower-subagents-anchor">
              <button
                ref={subagentTriggerRef}
                type="button"
                class={cn('flower-header-icon-button', (subagentDropdownOpen() || activeSubagentID()) && 'flower-header-icon-button-active')}
                aria-label={selectedSubagentItems().length > 0 ? `${subagentsCopy().openLabel} · ${subagentBadgeLabel()}` : subagentsCopy().openLabel}
                title={selectedSubagentItems().length > 0 ? `${subagentsCopy().openLabel} · ${subagentBadgeLabel()}` : subagentsCopy().openLabel}
                aria-haspopup="dialog"
                aria-expanded={subagentDropdownOpen()}
                aria-controls="flower-subagents-dropdown"
                onClick={openSubagents}
              >
                <GitBranch class="h-4 w-4" />
                <Show when={selectedSubagentItems().length > 0}>
                  <span class="flower-header-icon-badge" aria-hidden="true">{subagentBadgeText()}</span>
                </Show>
              </button>
              {subagentDropdown()}
            </div>
            <button
              type="button"
              class="flower-header-icon-button"
              aria-label={copy().chat.settingsLabel}
              title={copy().chat.settingsLabel}
              onClick={openSettings}
            >
              <Settings class="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      {subagentDetailDialog()}
      <FlowerChatContextPreview
        chip={previewChip()}
        open={previewChip() !== null}
        zIndex={FLOWER_SURFACE_LAYER.contextPreview}
        onClose={() => setPreviewChip(null)}
      />
      <div class="flower-chat-main flower-chat-main">
        <div
          ref={(node) => { transcriptScroll.bind(node); }}
          class="flower-chat-transcript flower-chat-transcript"
          data-flower-tail-preparing={selectedThreadTailPreparing() ? 'true' : undefined}
          aria-busy={selectedThreadTailPreparing() ? 'true' : undefined}
          onScroll={updateTranscriptNearBottom}
          onWheel={updateTranscriptFollowFromWheel}
          onTouchMove={updateTranscriptFollowFromTouch}
        >
          <div class="flower-transcript-stack">
            <Show when={loadError()}>
              {(message) => errorNotice(copy().chat.loadErrorTitle, message())}
            </Show>
            <Show when={threadLoadError()}>
              {(message) => errorNotice(copy().chat.threadLoadErrorTitle, message())}
            </Show>
            <Show
              when={selectedThreadHasContent() || hasPendingTurnForSelectedThread() || selectedThreadHasModelStatus()}
                fallback={selectedThreadLoading()
                  ? threadLoadingState()
                  : warmupCanReplaceTranscript()
                    ? warmupPanel()
                  : needsSetup()
                    ? setupGuide()
                    : <FlowerEmptyState copy={copy().emptyState} disabled={!readyForChat()} onSuggestionClick={(prompt) => updateCurrentComposerSessionDraft((draft) => ({ ...draft, chatDraft: prompt }))} />}
            >
              <For each={visibleTimelineEntryKeys()}>
                {(entryKey) => {
                  const entry = createMemo(() => visibleTimelineEntriesByKey().get(entryKey) ?? null);
                  return (
                    <Show when={entry()}>
                      {(value) => timelineEntry(value)}
                    </Show>
                  );
                }}
              </For>
              {threadLevelApprovalPanel()}
            </Show>
          </div>
        </div>
        <div class="flower-chat-bottom-dock flower-chat-bottom-dock">
          <Show when={showScrollToLatestButton()}>
            <div class="flower-scroll-to-latest-float">
              <button
                type="button"
                class="flower-scroll-to-latest-button"
                aria-label={copy().chat.scrollToLatest}
                title={copy().chat.scrollToLatest}
                onClick={() => {
                  transcriptScroll.startFollowing();
                  scrollTranscriptToBottom({ smooth: true });
                }}
              >
                <ChevronDown class="h-4 w-4" />
              </button>
            </div>
          </Show>
          <div class="flower-chat-bottom-dock-track flower-chat-bottom-dock-track">
            <div class="flower-model-status-lane" role="status" aria-live="polite" aria-atomic="true">
              <Show when={selectedThreadHasModelStatus()}>
                {selectedModelStatusIndicator()}
              </Show>
            </div>
            <div class="flower-composer-anchor">
              <Show when={!selectedComposerApprovalAction() && !selectedInputRequest() && composerSlashCommand().kind === 'suggest'}>
                <div
                  class="flower-composer-command-menu"
                  role="listbox"
                  aria-label={copy().chat.commandMenuLabel}
                  aria-activedescendant={FLOWER_COMPOSER_COMPACT_COMMAND_OPTION_ID}
                >
                  <button
                    id={FLOWER_COMPOSER_COMPACT_COMMAND_OPTION_ID}
                    type="button"
                    role="option"
                    aria-selected="true"
                    class="flower-composer-command-item"
                    onClick={() => void executeCompactContextCommand()}
                  >
                    <Clock class="h-3.5 w-3.5" />
                    <span class="flower-composer-command-token">{FLOWER_COMPACT_CONTEXT_COMMAND}</span>
                    <span class="flower-composer-command-description">{copy().chat.commandCompactContext}</span>
                  </button>
                </div>
              </Show>
              <div class="flower-composer flower-chat-input-floating chat-input-container p-3">
                <Show
                  when={selectedComposerApprovalAction()}
                  fallback={(
                    <>
                      {inputRequestPrompt(selectedInputRequest())}
                      <Show
                        when={activeInputQuestionIsSecret()}
                        fallback={(
                          <textarea
                            ref={(el) => {
                              composerRef = el;
                            }}
                            class="w-full text-sm leading-6 text-foreground placeholder:text-muted-foreground"
                            placeholder={composerPlaceholder()}
                            value={composerTextValue()}
                            disabled={composerTextareaDisabled()}
                            onInput={(event) => updateComposerText(event.currentTarget.value)}
                            onCompositionStart={() => setIsComposing(true)}
                            onCompositionEnd={(event) => {
                              setIsComposing(false);
                              updateComposerText(event.currentTarget.value);
                            }}
                            onKeyDown={handleComposerKeyDown}
                          />
                        )}
                      >
                        <input
                          ref={(el) => {
                            composerRef = el;
                          }}
                          type="password"
                          class="w-full text-sm leading-6 text-foreground placeholder:text-muted-foreground"
                          placeholder={composerPlaceholder()}
                          value={composerTextValue()}
                          disabled={composerTextareaDisabled()}
                          onInput={(event) => updateComposerText(event.currentTarget.value)}
                          onCompositionStart={() => setIsComposing(true)}
                          onCompositionEnd={(event) => {
                            setIsComposing(false);
                            updateComposerText(event.currentTarget.value);
                          }}
                          onKeyDown={handleComposerKeyDown}
                        />
                      </Show>
                    </>
                  )}
                >
                  {(approvalAction) => (
                    <div class="flower-composer-approval-body">
                      {approvalActionCard(approvalAction(), { surface: 'composer' })}
                    </div>
                  )}
                </Show>
                <div class="flower-composer-footer">
                  <Show
                    when={!needsSetup()}
                  fallback={(
                    <>
                      <div class="flower-setup-inline">
                        <span>{copy().chat.configureProviderBeforeChat}</span>
                      </div>
                      <Button variant="primary" icon={Settings} onClick={openSettings}>
                        {copy().chat.openSettings}
                      </Button>
                    </>
                  )}
                >
                    <div class="flower-model-stack" aria-live="polite">
                      <Show
                        when={selectedThreadReadOnly()}
                        fallback={(
                          <>
                            <Show when={!selectedInputRequest()}>
                              <div class="flower-model-selection">
                                {permissionSelector()}
                                <span class="flower-model-selection-label">{copy().chat.modelLabel}</span>
                                <Show
                                  when={!surfaceWarmupActive() && modelSelectOptions().length > 0}
                                  fallback={(
                                    <span class={cn('flower-model-chip', surfaceWarmupActive() && 'flower-model-chip-warmup')}>
                                      {surfaceWarmupActive() ? warmupModelLabel() : selectedThreadModelLabel()}
                                    </span>
                                  )}
                                >
                                  <div class="flower-model-select-anchor">
                                    <button
                                      ref={modelTriggerRef}
                                      type="button"
                                      class="flower-model-select-trigger"
                                      disabled={!composerModelInteractive() || modelPatchPending()}
                                      aria-haspopup="listbox"
                                      aria-expanded={modelMenuOpen()}
                                      aria-label={`Model: ${selectedThreadModelLabel()}`}
                                      title={selectedThreadModelLabel()}
                                      onClick={() => { if (modelMenuOpen()) { closeModelMenu(false); return; } openModelMenu(); }}
                                      onKeyDown={handleModelTriggerKeyDown}
                                    >
                                      <span class="flower-model-select-label">{selectedThreadModelLabel()}</span>
                                      <ChevronDown class="flower-model-select-chevron" aria-hidden="true" />
                                    </button>
                                    <Show when={modelMenuOpen()}>
                                      <div
                                        ref={modelMenuRef}
                                        class="flower-model-menu"
                                        role="listbox"
                                        onKeyDown={handleModelMenuKeyDown}
                                      >
                                        <For each={modelSelectOptions()}>
                                          {(option) => {
                                            const selected = () => option.id === selectedComposerModelID();
                                            return (
                                              <button
                                                type="button"
                                                class={cn('flower-model-menu-item', selected() && 'flower-model-menu-item-active')}
                                                role="option"
                                                aria-selected={selected()}
                                                onClick={() => { void updateComposerModelID(option.id); closeModelMenu(true); }}
                                              >
                                                {option.providerType
                                                  ? <FlowerProviderBrandIcon type={option.providerType} class="flower-model-menu-icon" />
                                                  : <Bot class="flower-model-menu-icon" />}
                                                <span class="flower-model-menu-copy">
                                                  <span class="flower-model-menu-name">{option.label}</span>
                                                  <span class="flower-model-menu-meta">
                                                    <Show when={option.contextWindow}>
                                                      <span>{formatFlowerTokenCount(option.contextWindow)} context</span>
                                                    </Show>
                                                    <Show when={option.maxOutputTokens}>
                                                      <span> · {formatFlowerTokenCount(option.maxOutputTokens)} output</span>
                                                    </Show>
                                                    <Show when={option.supportsImageInput}>
                                                      <span> · Image</span>
                                                    </Show>
                                                  </span>
                                                </span>
                                                <Show when={selected()}>
                                                  <Check class="flower-model-menu-check" aria-hidden="true" />
                                                </Show>
                                              </button>
                                            );
                                          }}
                                        </For>
                                      </div>
                                    </Show>
                                  </div>
                                </Show>
                                <Show when={composerReasoningEnabled()}>
                                  <FlowerReasoningControl
                                    compact
                                    variant="badge"
                                    capability={selectedReasoningCapability()}
                                    selection={composerReasoningSelection()}
                                    label="Reasoning"
                                    readOnly={!composerReasoningInteractive()}
                                    onChange={(selection) => { void updateComposerReasoningSelection(selection); }}
                                  />
                                </Show>
                              </div>
                            </Show>
                          </>
                        )}
                      >
                        <div class="flower-composer-readonly-stack">
                          {permissionSelector()}
                          <div class="flower-composer-readonly-chip" title={selectedThreadReadOnlyReason()}>
                            {selectedThreadReadOnlyDisplay()}
                          </div>
                        </div>
                      </Show>
                      <Show when={handlerNotice()}>
                        {(notice) => <div role="alert" class="flower-handler-error-card">
                          <div class="flower-handler-error-icon"><AlertTriangle class="h-3.5 w-3.5" /></div>
                          <div class="flower-handler-error-copy">
                            <div class="flower-handler-error-title">{notice().title}</div>
                            <div class="flower-handler-error-message">{notice().message}</div>
                          </div>
                          <button
                            type="button"
                            class="flower-handler-retry"
                            onClick={() => void resolveHandlerDecision().catch(() => undefined)}
                          >
                            {copy().chat.handlerRetry}
                          </button>
                        </div>}
                      </Show>
                    </div>
                    <div class="flower-composer-actions">
                      <Show when={selectedContextUsage()}>
                        {(contextUsage) => (
                          <FlowerComposerContextIndicator
                            usage={contextUsage().usage}
                            freshness={contextUsage().freshness}
                            copy={copy()}
                          />
                        )}
                      </Show>
                      <Show
                        when={selectedComposerApprovalAction()}
                        fallback={(
                          <Show
                            when={selectedInputRequest()}
                            fallback={(
                              <Button
                                variant="primary"
                                icon={composerPrimaryActionIcon()}
                                size="icon"
                                class="flower-composer-submit rounded-full"
                                aria-label={composerPrimaryActionLabel()}
                                title={composerPrimaryActionLabel()}
                                disabled={composerPrimaryActionDisabled()}
                                loading={composerPrimaryActionLoading()}
                                onClick={() => void submitChat()}
                              />
                            )}
                          >
                            <Button
                              variant="primary"
                              icon={ArrowUp}
                              class="flower-composer-continue"
                              disabled={selectedThreadReadOnly() || inputSubmitting() || !inputRequestReadyToSubmit()}
                              loading={inputSubmitting()}
                              onClick={() => void submitChat()}
                            >
                              {inputSubmitting()
                                ? chatCopyValue('inputRequestSubmitting', 'Submitting...')
                                : inputSubmitError()
                                  ? chatCopyValue('inputRequestRetry', 'Retry')
                                  : chatCopyValue('inputRequestSubmit', 'Continue')}
                            </Button>
                          </Show>
                        )}
                      >
                        {(approvalAction) => {
                          const busy = () => approvalSubmitting()[approvalAction().action_id];
                          const disabled = () => busy() !== undefined || !approvalActionCanDecide(approvalAction());
                          const actionLabel = () => approvalAction().summary.label || approvalAction().tool_name || copy().chat.toolApprovalRequired;
                          const subtaskLabel = () => {
                            const ref = approvalAction().delegated_ref;
                            return ref?.subagent_id ? copy().chat.toolApprovalSubtaskSuffix(ref.subagent_id) : '';
                          };
                          return (
                            <div class="flower-composer-approval-actions">
                              <Button
                                variant="outline"
                                class="flower-composer-approval-decision"
                                disabled={disabled()}
                                loading={busy() === 'reject'}
                                aria-label={copy().chat.toolApprovalRejectAction(actionLabel(), subtaskLabel())}
                                onClick={() => void submitApprovalAction(approvalAction(), false)}
                              >
                                {busy() === 'reject' ? copy().chat.toolApprovalSubmitting : copy().chat.toolApprovalReject}
                              </Button>
                              <Button
                                variant="primary"
                                class="flower-composer-approval-decision"
                                disabled={disabled()}
                                loading={busy() === 'approve'}
                                aria-label={copy().chat.toolApprovalApproveAction(actionLabel(), subtaskLabel())}
                                onClick={() => void submitApprovalAction(approvalAction(), true)}
                              >
                                {busy() === 'approve' ? copy().chat.toolApprovalSubmitting : copy().chat.toolApprovalApprove}
                              </Button>
                            </div>
                          );
                        }}
                      </Show>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
            <Show when={composerErrorMessage()}>
              {(message) => <div class="flower-composer-error">{errorNotice(copy().chat.composerErrorTitle, message())}</div>}
            </Show>
            <Show when={permissionSubmitError()}>
              {(message) => <div class="flower-composer-error">{errorNotice(copy().chat.permissionSelectorErrorTitle, message())}</div>}
            </Show>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <main
      id="redeven-flower-surface"
      class={cn('flower-component-shell flower-surface', threadRailResizing() && 'flower-component-shell-resizing', props.class)}
      data-flower-selected-thread-id={selectedThreadID()}
      data-flower-selected-thread-status={selectedThread()?.status ?? 'idle'}
      data-flower-selected-thread-loading={selectedThreadLoading() ? 'true' : 'false'}
      data-flower-warmup={surfaceWarmupActive() ? 'true' : 'false'}
      data-flower-side-panel={sidePanel()}
      style={{ '--flower-thread-rail-width': `${threadRailWidth()}px` }}
    >
      <aside class="flower-component-thread-rail" aria-label={copy().chat.conversationsAria}>
        <div class="flower-sidebar-actions">
          {props.sidebarLeadingAction}
          <button
            type="button"
            class="flower-new-chat-button"
            aria-label={copy().chat.newChat}
            title={copy().chat.newChat}
            disabled={surfaceWarmupActive()}
            onClick={startCompose}
          >
            <Plus class="h-4 w-4 shrink-0" />
            <span class="flower-new-chat-label">{copy().chat.newChat}</span>
          </button>
        </div>
        <FlowerThreadList
          items={sidebarListItems()}
          activeThreadID={selectedThreadID()}
          query={historyFilter()}
          refreshing={threadsRefreshing()}
          warmup={surfaceWarmupActive()}
          copy={copy().threadList}
          onQueryChange={setHistoryFilter}
          onRefresh={() => void refreshThreads()}
          onSelect={selectThread}
          canFork={!!props.adapter.forkThread}
          canRename={!!props.adapter.renameThread}
          canPin={!!props.adapter.setThreadPinned}
          busyThreadID={threadActionBusy()?.threadID}
          busyAction={threadActionBusy()?.action}
          actionsBusy={threadActionBusy() !== null}
          onMenuAction={(action, item, restore) => void handleThreadMenuAction(action, item, restore)}
        />
        <Show when={threadActionError()}>
          {(message) => <div class="flower-thread-action-error" role="alert">{message()}</div>}
        </Show>
        <Show when={threadActionSuccess()}>
          {(message) => <div class="flower-thread-action-success" role="status" aria-live="polite">{message()}</div>}
        </Show>
      </aside>
      <Show when={renameThreadID()}>
        <div class="flower-rename-backdrop" role="presentation" onMouseDown={closeRenameDialog}>
          <div
            ref={renameDialogRef}
            class="flower-rename-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="flower-thread-rename-title"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeRenameDialog();
                return;
              }
              if (event.key !== 'Tab') return;
              const items = Array.from(renameDialogRef?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? []);
              if (items.length === 0) {
                event.preventDefault();
                return;
              }
              const first = items[0];
              const last = items[items.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                focusRenameDialogEdge('last');
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                focusRenameDialogEdge('first');
              }
            }}
          >
            <h2 id="flower-thread-rename-title">{copy().threadList.renameTitle}</h2>
            <label>
              <span>{copy().threadList.renameNameLabel}</span>
              <input
                ref={renameInputRef}
                class="flower-rename-input"
                value={renameDraft()}
                disabled={renameSaving()}
                aria-invalid={renameError() ? 'true' : undefined}
                aria-describedby={renameError() ? 'flower-thread-rename-error' : undefined}
                onInput={(event) => {
                  setRenameDraft(event.currentTarget.value);
                  setRenameError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void submitRename();
                  }
                }}
              />
            </label>
            <Show when={renameError()}>
              {(message) => <p id="flower-thread-rename-error" class="flower-rename-error" role="alert">{message()}</p>}
            </Show>
            <div class="flower-rename-actions">
              <button type="button" class="flower-rename-secondary" disabled={renameSaving()} onClick={closeRenameDialog}>{copy().threadList.cancel}</button>
              <button
                type="button"
                class="flower-rename-primary"
                disabled={renameSaving() || renameUnchanged()}
                onClick={() => void submitRename()}
              >
                {renameSaving() ? copy().threadList.saving : copy().threadList.save}
              </button>
            </div>
          </div>
        </div>
      </Show>
      <button
        type="button"
        class="flower-component-rail-resizer"
        role="separator"
        aria-label={copy().chat.resizeConversationsLabel}
        aria-orientation="vertical"
        aria-valuemin={THREAD_RAIL_WIDTH_MIN}
        aria-valuemax={THREAD_RAIL_WIDTH_MAX}
        aria-valuenow={threadRailWidth()}
        title={copy().chat.resizeConversationsLabel}
        onPointerDown={startThreadRailResize}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            nudgeThreadRailWidth(-16);
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            nudgeThreadRailWidth(16);
          }
        }}
      >
        <GripVertical class="h-3.5 w-3.5" />
      </button>
      <section class="flower-component-main">
        <Show when={sidePanel() === 'chat'}>{chatPanel()}</Show>
        <div class={cn('h-full min-h-0', sidePanel() !== 'settings' && 'hidden')} aria-hidden={sidePanel() !== 'settings'}>
          <FlowerSettingsSurface
            snapshot={snapshot()}
            copy={copy().settings}
            onSaveDraft={saveSettings}
            saveError={saveError()}
            savedAt={savedAt()}
            saving={settingsSaving()}
            onBackToChat={returnToChat}
          />
        </div>
      </section>
    </main>
  );
};
