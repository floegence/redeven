import type { Accessor, Component, JSX } from 'solid-js';
import { For, Show, batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { UIFirstSelectionEvent } from '@floegence/floe-webapp-core';
import { AlertCircle, AlertTriangle, ArrowUp, Bot, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, ExternalLink, FileText, FolderOpen, GitBranch, GripVertical, MoreHorizontal, Paperclip, Plus, Refresh, Send, Settings, Shield, Terminal, Trash, XCircle } from '@floegence/floe-webapp-core/icons';
import { Button, ConfirmDialog, SurfaceFloatingLayer } from '@floegence/floe-webapp-core/ui';

import { writeTextToClipboard } from './clipboard';
import { FlowerAttachmentLane } from './attachments/FlowerAttachmentLane';
import {
  FlowerAttachmentPreviewWindow,
  type FlowerAttachmentPreviewSource,
} from './attachments/FlowerAttachmentPreviewWindow';
import {
  createFlowerAttachmentController,
  type FlowerAttachmentController,
  type FlowerAttachmentControllerSnapshot,
  type FlowerAttachmentItem,
} from './attachments/createFlowerAttachmentController';
import {
  FLOWER_INLINE_TEXT_CODE_POINT_LIMIT,
  decideFlowerTextPaste,
  flowerAttachmentIDs,
  flowerAttachmentRoute,
  inspectFlowerText,
  replaceFlowerTextSelection,
} from './attachments/flowerAttachmentModel';
import { FlowerChatContextChips } from './chat/FlowerChatContextChips';
import { FlowerChatContextPreview } from './chat/FlowerChatContextPreview';
import { parseChatContextAction, parseChatMessageReferences } from './chat/flowerChatContextModel';
import {
  createFlowerClientRequestID,
  flowerTurnAdmissionUncertainFailure,
  flowerTurnAdmissionUncertainIdentity,
} from './flowerTurnAdmission';
import { FlowerContextCompactionDivider } from './chat/FlowerContextCompactionDivider';
import { FlowerTurnProjectionUnavailable } from './chat/FlowerTurnProjectionUnavailable';
import { FlowerComposerContextIndicator } from './chat/FlowerComposerContextIndicator';
import type { FlowerComposerContextUsageFreshness } from './chat/flowerContextPresentation';
import { FlowerEmptyState } from './chat/FlowerEmptyState';
import type { FlowerChatContextChip, FlowerChatContextSnapshotPreview } from './contracts/flowerChatContextTypes';
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
  FlowerSubmitApprovalRequest,
  FlowerSubmitInputReceipt,
  FlowerSurfaceAdapter,
  FlowerTerminalProcessSnapshot,
  FlowerTurnLaunchFailure,
  FlowerTurnLaunchReceipt,
  FlowerRouterDecision,
  FlowerThreadActivitySnapshot,
  FlowerThreadListItem,
  FlowerThreadReadStatus,
  FlowerThreadStatus,
  FlowerThreadSnapshot,
  FlowerChatMessage,
  FlowerQueuedTurn,
  FlowerContextUsage,
  FlowerTimelineAnchor,
  FlowerTimelineDecoration,
  FlowerActivityStatus,
  FlowerLiveBootstrap,
  FlowerLiveStreamEnvelope,
  FlowerAttachmentCapability,
  FlowerAttachmentStagingScope,
  FlowerModelIOPhase,
  FlowerModelIOStatus,
  FlowerModelSourceStatus,
  FlowerSurfaceAction,
  FlowerPermissionType,
  FlowerProviderType,
  FlowerReasoningCapability,
  FlowerReasoningSelection,
  FlowerSubagentDetail,
  FlowerSubagentTimelineRow,
  FlowerWorkingDirectoryPathContext,
} from './contracts/flowerSurfaceContracts';
import { projectFlowerThreadListItem, trimString } from './flowerSurfaceModel';
import { projectFlowerCompanionLiveTail, type FlowerCompanionProgressKind } from './flowerCompanionLiveTail';
import { FlowerCompanionTailMotionController } from './flowerCompanionTailMotion';
import {
  buildFlowerTimelineEntries,
  type FlowerRenderableMessageBlock,
  type FlowerTimelineEntry,
} from './flowerTimelineProjection';
import {
  buildFlowerSubagentPanelItems,
  presentSubagentTaskName,
  type FlowerSubagentPanelItem,
  type FlowerSubagentPanelStatus,
} from './flowerSubagentProjection';
import { projectSubagentDetailThread } from './flowerSubagentDetailThread';
import { formatFlowerCurrentModelLabel } from './flowerModelLabel';
import { FLOWER_COMPACT_CONTEXT_COMMAND, parseFlowerSlashCommand } from './flowerSlashCommands';
import {
  pendingApprovalCommandForActivityItem,
  presentFlowerActivityItem,
  type FlowerActivityDetailBlock,
  type FlowerActivityDiffFile,
  type FlowerActivityFileAction,
  type FlowerActivityPresentation,
  type FlowerActivitySubagentDetailItem,
  type FlowerActivityTitle,
  type FlowerActivityTodoStatus,
} from './flowerActivityPresentation';
import { flowerActivityIdentity } from './flowerActivityIdentity';
import {
  createFlowerActivityDisclosureController,
  createFlowerActivityDisclosureMotion,
  flowerActivityDisclosureIntent,
} from './activityDisclosure';
import {
  createTerminalOutputViewportController,
  createTerminalVisibleOutputStore,
  terminalListeningPlaceholderVisible,
  type TerminalVisibleOutputIdentity,
} from './flowerTerminalOutput';
import { formatGitPatchLineNumber, getGitPatchRenderSnapshot, type GitPatchRenderedLine } from './gitPatch';
import { FlowerIcon } from './icons/FlowerIcon';
import { FlowerSoftAuraIcon } from './icons/FlowerSoftAuraIcon';
import { FlowerSettingsSurface } from './settings/FlowerSettingsSurface';
import { FlowerShellCommandHighlight } from './shellCommandHighlight';
import { FlowerThreadList, type FlowerThreadMenuAction } from './threads/FlowerThreadList';
import { FlowerThreadSwitcher, type FlowerThreadSwitcherCopy } from './threads/FlowerThreadSwitcher';
import { SubagentDetailWindow } from './SubagentDetailWindow';
import { applyFlowerLiveEvent, projectFlowerLiveBootstrap } from './flowerLiveReducer';
import { flowerThreadReadSnapshotKey, mergeFlowerThreadListRefresh, sameThreadSnapshot } from './flowerThreadListRefresh';
import { FlowerProviderBrandIcon, flowerModelSupportsImage, formatFlowerTokenCount } from './settings/providerCatalog';
import { FlowerReasoningControl } from './ReasoningControl';
import {
  type FlowerComposerDraftCoordinator,
  type FlowerComposerDraftAttachment,
  type FlowerComposerDraftReference,
  type FlowerComposerDraftSession,
  type FlowerComposerDraftSnapshot,
  type FlowerComposerDraftValue,
} from './composer/createFlowerComposerDraftCoordinator';
import {
  createFlowerComposerAutosizeController,
  type FlowerComposerAutosizeController,
} from './composer/createFlowerComposerAutosizeController';
import {
  createFlowerComposerReferenceIndex,
  normalizeFlowerComposerReferencePath,
  type FlowerComposerReferenceCandidate,
  type FlowerComposerReferenceSearchState,
} from './composer/flowerComposerReferenceIndex';
import {
  findFlowerComposerReferenceToken,
  replaceFlowerComposerReferenceToken,
  type FlowerComposerReferenceToken,
} from './composer/flowerComposerReferenceToken';
import {
  CONTEXT_ACTION_SCHEMA_VERSION,
  type ContextActionEnvelope,
} from './contextActionWire';
import {
  approvalDecisionProjection,
  flowerComposerApprovalAction,
  type ApprovalDecisionHandoff,
} from './approvalDecisionHandoff';
import { FlowerWorkingDirPickerDialog } from './filePicker/FlowerWorkingDirPickerDialog';
import {
  projectFlowerCompanionPresence,
  type FlowerCompanionPriorityStatus,
  type FlowerCompanionTerminalTransition,
  type FlowerCompanionPresenceProjection,
  type FlowerCompanionThreadListItem,
} from './flowerCompanionPresence';
import { createDirectoryPickerDataSource } from './filePicker/createDirectoryPickerDataSource';
import { toPickerTreeAbsolutePath, toPickerTreePath } from './filePicker/directoryPickerTree';
import { basenameFromAbsolutePath, normalizeAbsolutePath } from './filePicker/path';
import {
  defaultReasoningSelectionForCapability,
  normalizeFlowerReasoningSelection,
  reasoningCapabilitySupportsControl,
  sameFlowerReasoningSelection,
  serializeFlowerReasoningSelection,
} from './reasoning';

type FlowerSurfacePanel = 'chat' | 'settings';
const FLOWER_WARM_THREAD_DETAIL_LIMIT = 8;
type UnavailableFlowerModelSourceStatus = Exclude<FlowerModelSourceStatus, { state: 'ready' }>;
type FlowerModelSourceRecoveryActionID = 'local_settings' | 'runtime_settings' | 'connection_center';
type FlowerInputDraft = Readonly<{
  choice_id?: string;
  text?: string;
}>;
type FlowerComposerSessionDraft = Readonly<{
  chatDraft: string;
  references: readonly FlowerComposerDraftReference[];
  inputPromptSignature: string;
  inputDrafts: Record<string, FlowerInputDraft>;
  activeInputQuestionID: string;
  modelIDOverride?: string;
  permissionTypeOverride?: FlowerPermissionType;
  reasoningOverride?: FlowerReasoningSelection;
  workingDirDraft?: string;
}>;

type FlowerMessageAttachmentPreviewTarget = Readonly<{
  id: string;
  name: string;
  mimeType: string;
  url: string;
}>;

function messageHasUserRejectedTool(message: FlowerChatMessage): boolean {
  return (message.blocks ?? []).some((block) => (
    block.type === 'activity-timeline'
    && block.items.some((item) => item.requires_approval && item.approval_state === 'rejected')
  ));
}

function threadHasUserRejectedTool(
  thread: FlowerThreadSnapshot | null | undefined,
  runID = '',
  turnID = '',
): boolean {
  return (thread?.messages ?? []).some((message) => (
    (!runID || trimString(message.run_id) === trimString(runID))
    && (!turnID || trimString(message.turn_id) === trimString(turnID))
    && messageHasUserRejectedTool(message)
  ));
}

function latestThreadFailureIsUserRejectedTool(thread: FlowerThreadSnapshot | null | undefined): boolean {
  const latestFailedMessage = [...(thread?.messages ?? [])].reverse().find((message) => (
    message.role === 'assistant' && message.status === 'error'
  ));
  return latestFailedMessage ? messageHasUserRejectedTool(latestFailedMessage) : false;
}

type FlowerConsumedInputAdmission = Readonly<{
  promptID: string;
}>;
type FlowerComposerContextUsageModel = Readonly<{
  usage: FlowerContextUsage;
  freshness: FlowerComposerContextUsageFreshness;
}>;
type FlowerComposerControlID = 'working_dir' | 'permission' | 'model_reasoning' | 'read_only';
type FlowerComposerControlLocation = 'inline' | 'overflow';
type FlowerComposerControlLayout = Readonly<{
  availableWidth: number;
  itemWidths: Partial<Record<FlowerComposerControlID, number>>;
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
type PendingContextCompactionDecoration = Readonly<{
  thread_id: string;
  started_at_ms: number;
  known_operation_ids: readonly string[];
  decoration: Extract<FlowerTimelineDecoration, { kind: 'context_compaction' }>;
}>;
type FlowerPendingSubmission = Readonly<{
  clientRequestID: string;
  sessionKey: string;
  threadID?: string;
  sourceQueueID?: string;
  prompt: string;
  attachmentNames: readonly string[];
  referenceLabels: readonly string[];
  phase: 'preparing' | 'admitting' | 'awaiting_projection';
  canonicalKind?: 'start' | 'queued' | 'admitting';
  canonicalID?: string;
  startedAtMS: number;
}>;
type FlowerPendingSubmissionEvent =
  | Readonly<{ kind: 'begin'; submission: FlowerPendingSubmission }>
  | Readonly<{ kind: 'admission_started'; clientRequestID: string }>
  | Readonly<{ kind: 'admission_uncertain'; clientRequestID: string; threadID?: string }>
  | Readonly<{
    kind: 'admission_accepted';
    clientRequestID: string;
    threadID: string;
    canonicalKind: 'start' | 'queued' | 'admitting';
    canonicalID: string;
  }>
  | Readonly<{ kind: 'projection_observed'; clientRequestID: string }>
  | Readonly<{ kind: 'admission_failed'; clientRequestID: string }>
  | Readonly<{ kind: 'submission_finished_without_receipt'; clientRequestID: string }>
  | Readonly<{ kind: 'new_conversation' }>
  | Readonly<{ kind: 'thread_selected'; threadID: string }>;
type FlowerQueuedTurnReorderState = Readonly<{
  threadID: string;
  draggedQueueID: string;
  originalQueueIDs: readonly string[];
  orderedQueueIDs: readonly string[];
  phase: 'dragging' | 'saving';
}>;
type FlowerQueuedTurnDeleteState = Readonly<{
  threadID: string;
  queueID: string;
}>;

function transitionFlowerPendingSubmission(
  current: FlowerPendingSubmission | null,
  event: FlowerPendingSubmissionEvent,
): FlowerPendingSubmission | null {
  switch (event.kind) {
    case 'begin':
      return event.submission;
    case 'admission_started':
      return current?.clientRequestID === event.clientRequestID
        ? { ...current, phase: 'admitting' }
        : current;
    case 'admission_uncertain':
      return current?.clientRequestID === event.clientRequestID
        ? {
          ...current,
          ...(event.threadID ? { threadID: event.threadID } : {}),
          phase: 'awaiting_projection',
        }
        : current;
    case 'admission_accepted':
      return current?.clientRequestID === event.clientRequestID
        ? {
          ...current,
          threadID: event.threadID,
          phase: 'awaiting_projection',
          canonicalKind: event.canonicalKind,
          canonicalID: event.canonicalID,
        }
        : current;
    case 'projection_observed':
    case 'admission_failed':
    case 'submission_finished_without_receipt':
      return current?.clientRequestID === event.clientRequestID ? null : current;
    case 'new_conversation':
      return null;
    case 'thread_selected':
      return current?.threadID === event.threadID ? current : null;
  }
}

function sameQueuedTurnIDs(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((queueID) => right.includes(queueID));
}

function moveQueuedTurnID(
  orderedQueueIDs: readonly string[],
  draggedQueueID: string,
  targetQueueID: string,
  afterTarget: boolean,
): readonly string[] {
  if (draggedQueueID === targetQueueID) return orderedQueueIDs;
  const remaining = orderedQueueIDs.filter((queueID) => queueID !== draggedQueueID);
  const targetIndex = remaining.indexOf(targetQueueID);
  if (targetIndex < 0 || remaining.length === orderedQueueIDs.length) return orderedQueueIDs;
  const insertionIndex = targetIndex + (afterTarget ? 1 : 0);
  return [
    ...remaining.slice(0, insertionIndex),
    draggedQueueID,
    ...remaining.slice(insertionIndex),
  ];
}
const APPROVAL_DECISION_RESYNC_MS = 1500;
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
const FLOWER_COMPOSER_CONTROL_ORDER: readonly FlowerComposerControlID[] = ['working_dir', 'permission', 'model_reasoning', 'read_only'];
const FLOWER_COMPOSER_CONTROL_OVERFLOW_ORDER: readonly FlowerComposerControlID[] = ['working_dir', 'model_reasoning', 'read_only', 'permission'];
const FLOWER_COMPOSER_CONTROL_GAP_PX = 6;
const MESSAGE_COPY_RESET_MS = 1600;
const FLOWER_COMPOSER_COMMAND_MENU_ID = 'flower-composer-command-menu';
const FLOWER_COMPOSER_COMPACT_COMMAND_OPTION_ID = 'flower-composer-command-compact-context';
const FLOWER_COMPOSER_REFERENCE_MENU_ID = 'flower-composer-reference-menu';
const FLOWER_COMPOSER_REFERENCE_OPTION_PREFIX = 'flower-composer-reference-option-';
const FLOWER_COMPOSER_REFERENCE_MENU_FALLBACK_HEIGHT = 240;
const FLOWER_COMPOSER_REFERENCE_MENU_GAP = 6;
const FLOWER_COMPOSER_REFERENCE_VIEWPORT_MARGIN = 8;
const FLOWER_COMPOSER_MORE_PANEL_ESTIMATED_WIDTH = 352;
const FLOWER_COMPOSER_MORE_PANEL_ROW_HEIGHT = 44;
const FLOWER_COMPOSER_MORE_PANEL_VERTICAL_CHROME = 12;
const TRANSCRIPT_NEAR_BOTTOM_THRESHOLD_PX = 96;
const TRANSCRIPT_SCROLL_TO_LATEST_MS = 220;
const SELECTED_THREAD_TAIL_REVEAL_FALLBACK_MS = 120;
const SUBAGENT_DETAIL_PAGE_SIZE = 200;
const SUBAGENT_DROPDOWN_ESTIMATED_SIZE = { width: 400, height: 480 } as const;
const SUBAGENT_DETAIL_TAIL_RUNNING_INTERVAL_MS = 1500;
const SUBAGENT_DETAIL_TAIL_QUEUED_INTERVAL_MS = 2500;
const SUBAGENT_DETAIL_TAIL_ERROR_INTERVAL_MS = 4000;
const FLOWER_SURFACE_LAYER = {
  subagentWindow: 160,
  contextPreview: 162,
  attachmentPreview: 164,
} as const;

function flowerComposerDraftAttachments(
  items: readonly FlowerAttachmentItem[],
): readonly FlowerComposerDraftAttachment[] {
  return items.map((item) => ({
    local_id: item.local_id,
    source: item.source,
    name: item.name,
    mime_type: item.mime_type,
    size_bytes: item.size_bytes,
    upload_request_id: item.request_id,
    attempt_state: item.status,
    ...(item.staged ? { staged: item.staged } : {}),
  }));
}
function emptyFlowerComposerSessionDraft(): FlowerComposerSessionDraft {
  return {
    chatDraft: '',
    references: [],
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
    && JSON.stringify(left.references) === JSON.stringify(right.references)
    && left.inputPromptSignature === right.inputPromptSignature
    && left.activeInputQuestionID === right.activeInputQuestionID
    && left.modelIDOverride === right.modelIDOverride
    && left.permissionTypeOverride === right.permissionTypeOverride
    && left.workingDirDraft === right.workingDirDraft
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

const FLOWER_APPROVAL_CONFLICT_ERROR_CODE = 'AI_APPROVAL_CONFLICT';

function isFlowerApprovalConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : '';
  return trimString(code) === FLOWER_APPROVAL_CONFLICT_ERROR_CODE || Number(record.status) === 409;
}

function flowerApprovalRequest(
  thread: FlowerThreadSnapshot,
  action: FlowerApprovalAction,
  approved: boolean,
): FlowerSubmitApprovalRequest {
  const queueGeneration = thread.approval_queue?.generation ?? action.queue_generation ?? 0;
  const queueRevision = thread.approval_queue?.revision ?? 0;
  return {
    thread_id: thread.thread_id,
    origin: action.origin,
    run_id: action.run_id,
    action_id: action.action_id,
    tool_id: action.tool_id,
    approved,
    ...(action.expected_seq ? { expected_seq: action.expected_seq } : {}),
    revision: action.revision,
    ...(action.version ? { version: action.version } : {}),
    ...(action.surface_epoch ? { surface_epoch: action.surface_epoch } : {}),
    queue_generation: queueGeneration,
    queue_revision: queueRevision,
    idempotency_key: `${action.action_id}:${approved ? 'approve' : 'reject'}:${action.revision}:${queueGeneration}:${queueRevision}`,
  };
}

function retryableApprovalAction(
  thread: FlowerThreadSnapshot | null,
  actionID: string,
): FlowerApprovalAction | null {
  if (!thread) return null;
  const pending = (thread.approval_actions ?? []).filter((action) => action.status === 'pending' && action.state === 'requested');
  const action = pending.find((candidate) => candidate.action_id === actionID) ?? null;
  if (!action || !action.can_approve) return null;
  const currentActionID = trimString(thread.approval_queue?.current_action_id);
  if (currentActionID) return currentActionID === actionID ? action : null;
  const primary = action.surface_role === 'primary_action'
    || (!action.surface_role && !thread.approval_queue && pending.length === 1);
  return primary ? action : null;
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
    activity: pageIsNewer ? page.activity : current.activity,
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

export type FlowerThreadFocusRequest = Readonly<{
  request_id: string;
  thread_id: string;
}>;

export type FlowerSurfaceNotification = Readonly<{
  tone: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  message: string;
}>;

export type FlowerSurfaceProps = Readonly<{
  adapter: FlowerSurfaceAdapter;
  notify: (notification: FlowerSurfaceNotification) => void;
  copy?: FlowerSurfaceCopy;
  draftCoordinator: FlowerComposerDraftCoordinator;
  warmup?: FlowerSurfaceWarmupState | null;
  focusThreadRequest?: FlowerThreadFocusRequest | null;
  focusComposerRequest?: number;
  settingsFocusRequest?: number;
  sidebarLeadingAction?: JSX.Element;
  presentation?: 'full' | 'companion';
  engaged?: boolean;
  transcriptVisible?: boolean;
  companionPresenceOwner?: boolean;
  companionOpen?: boolean;
  companionRegionID?: string;
  companionSummary?: Readonly<{
    visualText: string;
    accessibleText: string;
    priorityStatus: FlowerCompanionPriorityStatus;
    progressKind?: FlowerCompanionProgressKind;
    progressIdentity?: string;
    ephemeralKind?: 'completion';
    running: boolean;
  }>;
  companionActionLabel?: string;
  companionCopy?: FlowerThreadSwitcherCopy;
  headerTrailingActions?: JSX.Element;
  onPresenceChange?: (presence: FlowerCompanionPresenceProjection) => void;
  onFocusThreadRequestConsumed?: (requestID: string) => void;
  onCompanionOpenRequest?: () => void;
  onThreadSelectionEvent?: (event: UIFirstSelectionEvent<string, { source: 'thread-list' }>) => void;
  class?: string;
}>;

const FlowerCompanionLiveTailText: Component<Readonly<{
  text: string;
  identity: string;
}>> = (props) => {
  let viewportRef: HTMLSpanElement | undefined;
  let valueRef: HTMLSpanElement | undefined;
  let controller: FlowerCompanionTailMotionController | null = null;

  createEffect(() => {
    const projection = { text: props.text, identity: props.identity };
    controller?.update(projection);
  });

  onMount(() => {
    if (!viewportRef || !valueRef) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    controller = new FlowerCompanionTailMotionController({
      viewport: viewportRef,
      value: valueRef,
    });
    controller.update({ text: props.text, identity: props.identity });
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => controller?.resize());
    resizeObserver?.observe(viewportRef);
    const onMotionChange = () => controller?.reducedMotionChanged();
    const onVisibilityChange = () => controller?.suspend();
    media.addEventListener('change', onMotionChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    onCleanup(() => {
      resizeObserver?.disconnect();
      media.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      controller?.dispose();
      controller = null;
    });
  });

  return (
    <>
      <span class="flower-companion-collapsed-tail-prefix" aria-hidden="true">&hellip;</span>
      <span
        ref={viewportRef}
        class="flower-companion-collapsed-tail-viewport"
        aria-hidden="true"
      >
        <span ref={valueRef} class="flower-companion-collapsed-tail-value" />
      </span>
    </>
  );
};

export const FlowerSurface: Component<FlowerSurfaceProps> = (props) => {
  const presentation = () => props.presentation ?? 'full';
  const companionCollapsed = () => presentation() === 'companion' && !(props.companionOpen ?? true);
  const surfaceEngaged = () => props.engaged ?? true;
  const transcriptVisible = () => props.transcriptVisible ?? true;
  const foregroundEngagementRequested = () => surfaceEngaged() && transcriptVisible() && documentVisible();
  const effectiveEngagement = () => foregroundEngagementRequested() && engagementBootstrapReady();
  const copy = () => props.copy ?? DEFAULT_FLOWER_SURFACE_COPY;
  const attachmentCopy = () => copy().attachments;
  const draftCoordinator = props.draftCoordinator;
  const subagentsCopy = (): FlowerSubagentsCopy => copy().subagents ?? DEFAULT_FLOWER_SURFACE_COPY.subagents!;
  const notify = (notification: FlowerSurfaceNotification) => {
    const message = trimString(notification.message);
    if (!message) return;
    const title = trimString(notification.title);
    props.notify({
      tone: notification.tone,
      message,
      ...(title ? { title } : {}),
    });
  };
  const notifyComposerError = (message: string) => notify({
    tone: 'error',
    title: copy().chat.composerErrorTitle,
    message,
  });
  const notifyStopError = (message: string) => notify({
    tone: 'error',
    title: copy().chat.stopErrorTitle,
    message,
  });
  const notifyPermissionError = (message: string) => notify({
    tone: 'error',
    title: copy().chat.permissionSelectorErrorTitle,
    message,
  });
  const notifyModelError = (message: string) => notify({
    tone: 'error',
    title: 'Flower could not update the model.',
    message,
  });
  const notifyFutureDefaultModelError = (message: string) => notify({
    tone: 'error',
    title: 'Default model was not updated.',
    message,
  });
  const notifyThreadActionError = (message: string) => notify({
    tone: 'error',
    message,
  });
  const notifySuccess = (message: string) => notify({
    tone: 'success',
    message,
  });
  const [loadError, setLoadError] = createSignal('');
  const [saveError, setSaveError] = createSignal('');
  const [savedAt, setSavedAt] = createSignal<number | null>(null);
  const [snapshot, setSnapshot] = createSignal<FlowerSettingsSnapshot | null>(null);
  const [threads, setThreads] = createSignal<readonly FlowerThreadSnapshot[]>([]);
  const [selectedThreadID, setSelectedThreadID] = createSignal('');
  const [selectedThreadDetailID, setSelectedThreadDetailID] = createSignal('');
  const [sidebarActiveThreadID, setSidebarActiveThreadID] = createSignal('');
  const [composerSessionDrafts, setComposerSessionDrafts] = createSignal<Record<string, FlowerComposerSessionDraft>>({});
  const [inputSubmittingPromptID, setInputSubmittingPromptID] = createSignal('');
  const [consumedInputAdmissions, setConsumedInputAdmissions] = createSignal<Record<string, FlowerConsumedInputAdmission>>({});
  const [chatRunning, setChatRunning] = createSignal(false);
  const [pendingSubmission, setPendingSubmission] = createSignal<FlowerPendingSubmission | null>(null);
  const [deferredStopClientRequestID, setDeferredStopClientRequestID] = createSignal('');
  const [queuedTurnReorder, setQueuedTurnReorder] = createSignal<FlowerQueuedTurnReorderState | null>(null);
  const [queuedTurnPromotingID, setQueuedTurnPromotingID] = createSignal('');
  const [queuedTurnDelete, setQueuedTurnDelete] = createSignal<FlowerQueuedTurnDeleteState | null>(null);
  // Reactive state updates are batched. Keep a synchronous guard as well so
  // Enter repeat and a same-tick click cannot admit the same draft twice.
  let launchChatTurnInFlight = false;
  const transitionPendingSubmission = (event: FlowerPendingSubmissionEvent) => {
    setPendingSubmission((current) => transitionFlowerPendingSubmission(current, event));
  };
  const [threadStopping, setThreadStopping] = createSignal(false);
  const [compactSubmitting, setCompactSubmitting] = createSignal(false);
  const [pendingContextCompaction, setPendingContextCompaction] = createSignal<PendingContextCompactionDecoration | null>(null);
  const [settingsSaving, setSettingsSaving] = createSignal(false);
  const [modelSourceRefreshing, setModelSourceRefreshing] = createSignal(false);
  const [threadsRefreshing, setThreadsRefreshing] = createSignal(false);
  const [historyFilter, setHistoryFilter] = createSignal('');
  const [sidePanel, setSidePanel] = createSignal<FlowerSurfacePanel>('chat');
  let consumedSettingsFocusRequest = 0;
  const [contextSnapshotPreview, setContextSnapshotPreview] = createSignal<FlowerChatContextSnapshotPreview | null>(null);
  const [attachmentPreview, setAttachmentPreview] = createSignal<FlowerAttachmentPreviewSource | null>(null);
  const [workingDirectoryPathContext, setWorkingDirectoryPathContext] = createSignal<FlowerWorkingDirectoryPathContext | null>(null);
  const [, setWorkingDirectoryPathContextLoading] = createSignal(false);
  const [workingDirectoryPickerOpen, setWorkingDirectoryPickerOpen] = createSignal(false);
  const [workingDirectoryCopied, setWorkingDirectoryCopied] = createSignal(false);
  const [composerMoreOpen, setComposerMoreOpen] = createSignal(false);
  const [attachmentStateRevision, setAttachmentStateRevision] = createSignal(0);
  const [attachmentDragActive, setAttachmentDragActive] = createSignal(false);
  const [longTextPreparing, setLongTextPreparing] = createSignal(false);
  let cancelActiveLongTextSubmission: (() => void) | null = null;
  const [composerMorePanelPosition, setComposerMorePanelPosition] = createSignal<FlowerFloatingPoint>({ x: 8, y: 8 });
  const [composerControlLayout, setComposerControlLayout] = createSignal<FlowerComposerControlLayout>({
    availableWidth: 0,
    itemWidths: {},
  });
  let workingDirectoryCopyResetTimer: number | undefined;
  const terminalVisibleOutputStore = createTerminalVisibleOutputStore();

  const clearWorkingDirectoryCopyTimer = () => {
    if (workingDirectoryCopyResetTimer !== undefined) {
      window.clearTimeout(workingDirectoryCopyResetTimer);
      workingDirectoryCopyResetTimer = undefined;
    }
  };

  const clearWorkingDirectoryCopyConfirmation = () => {
    clearWorkingDirectoryCopyTimer();
    setWorkingDirectoryCopied(false);
  };

  const confirmWorkingDirectoryCopied = () => {
    clearWorkingDirectoryCopyConfirmation();
    setWorkingDirectoryCopied(true);
    workingDirectoryCopyResetTimer = window.setTimeout(() => {
      setWorkingDirectoryCopied(false);
      workingDirectoryCopyResetTimer = undefined;
    }, MESSAGE_COPY_RESET_MS);
  };

  createEffect(on(
    () => selectedThreadID(),
    (next) => {
      setSidebarActiveThreadID(next);
      setContextSnapshotPreview(null);
      clearWorkingDirectoryCopyConfirmation();
    },
    { defer: false },
  ));
  const setSelectedThreadWithDetail = (threadID: string) => {
    const tid = trimString(threadID);
    setSelectedThreadID(tid);
    setSelectedThreadDetailID(tid);
    setSidebarActiveThreadID(tid);
  };

  const [isComposing, setIsComposing] = createSignal(false);
  const [composerSelection, setComposerSelection] = createSignal({ start: 0, end: 0 });
  const [composerReferenceDismissedSignature, setComposerReferenceDismissedSignature] = createSignal('');
  const [composerReferenceActiveKey, setComposerReferenceActiveKey] = createSignal('');
  const [composerReferenceAnnouncement, setComposerReferenceAnnouncement] = createSignal('');
  const [composerReferenceMutationCount, setComposerReferenceMutationCount] = createSignal(0);
  const composerReferenceMutationActive = () => untrack(composerReferenceMutationCount) > 0;
  const [composerReferenceMenuPosition, setComposerReferenceMenuPosition] = createSignal<FlowerFloatingPoint>({ x: 8, y: 8 });
  const [composerReferenceMenuWidth, setComposerReferenceMenuWidth] = createSignal(320);
  const [composerReferenceMenuHeight, setComposerReferenceMenuHeight] = createSignal(FLOWER_COMPOSER_REFERENCE_MENU_FALLBACK_HEIGHT);
  const [composerReferenceSearchState, setComposerReferenceSearchState] = createSignal<FlowerComposerReferenceSearchState>({
    status: 'idle',
    generation: 0,
  });
  const [composerReferenceLoadingVisible, setComposerReferenceLoadingVisible] = createSignal(false);
  const [handlerState, setHandlerState] = createSignal<FlowerHandlerResolutionState>({ status: 'starting' });
  const [threadLoadError, setThreadLoadError] = createSignal('');
  const [localReadVisibilityRevision, setLocalReadVisibilityRevision] = createSignal(0);
  const [threadActionBusy, setThreadActionBusy] = createSignal<{ threadID: string; action: FlowerThreadMenuAction } | null>(null);
  const forkRequestIDs = new Map<string, string>();
  const pinMutationSequences = new Map<string, number>();
  const [renameThreadID, setRenameThreadID] = createSignal('');
  const [renameDraft, setRenameDraft] = createSignal('');
  const [renameError, setRenameError] = createSignal('');
  const [renameSaving, setRenameSaving] = createSignal(false);
  const [deleteTarget, setDeleteTarget] = createSignal<Readonly<{ item: FlowerThreadListItem; restore?: HTMLElement }> | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal('');
  const [loadingThreadID, setLoadingThreadID] = createSignal('');
  const [selectedThreadTailReveal, setSelectedThreadTailReveal] = createSignal<SelectedThreadTailReveal | null>(null);
  const [threadRailWidth, setThreadRailWidth] = createSignal(THREAD_RAIL_WIDTH_DEFAULT);
  const [threadRailResizing, setThreadRailResizing] = createSignal(false);
  const [threadSwitcherOpen, setThreadSwitcherOpen] = createSignal(false);
  const [threadSwitcherQuery, setThreadSwitcherQuery] = createSignal('');
  const [presentedSelection, setPresentedSelection] = createSignal<Readonly<{ threadID: string; sequence: number }> | null>(null);
  const [documentVisible, setDocumentVisible] = createSignal(
    typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  const [engagementBootstrapReady, setEngagementBootstrapReady] = createSignal(foregroundEngagementRequested());
  const [openActivityRuns, setOpenActivityRuns] = createSignal<Record<string, boolean>>({});
  const [activityClockNow, setActivityClockNow] = createSignal(Date.now());
  const [approvalSubmitting, setApprovalSubmitting] = createSignal<Record<string, FlowerApprovalSubmittingState>>({});
  const [approvalDecisionHandoff, setApprovalDecisionHandoff] = createSignal<ApprovalDecisionHandoff | null>(null);
  const [approvalDisplayFallbackAction, setApprovalDisplayFallbackAction] = createSignal<FlowerApprovalAction | null>(null);
  const [approvalHandoffStyleThreadID, setApprovalHandoffStyleThreadID] = createSignal('');
  const [approvalQueueAnnouncement, setApprovalQueueAnnouncement] = createSignal('');
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
  let engagementBootstrapSequence = 0;
  let threadLocalMutationRevision = 0;
  let threadsRefreshSequence = 0;
  let startedFocusThreadRequestID = '';
  let startedFocusComposerRequest = 0;
  let composerRef: HTMLTextAreaElement | HTMLInputElement | undefined;
  let composerReferenceMenuRef: HTMLDivElement | undefined;
  let composerAutosizeController: FlowerComposerAutosizeController | undefined;
  const composerReferenceRemoveButtons = new Map<string, HTMLButtonElement>();
  let attachmentPickerRef: HTMLInputElement | undefined;
  let attachmentPickerButtonRef: HTMLButtonElement | undefined;
  let attachmentReselectTarget: Readonly<{ sessionKey: string; localID: string }> | null = null;
  let attachmentPickerSessionKey = '';
  let surfaceDisposed = false;
  const [composerFocused, setComposerFocused] = createSignal(false);
  let composerApprovalCardRef: HTMLElement | undefined;
  let previousComposerApprovalActionID = '';
  const [modelMenuOpen, setModelMenuOpen] = createSignal(false);
  const [modelMenuShiftX, setModelMenuShiftX] = createSignal(0);
  const [modelCapabilityRevision, setModelCapabilityRevision] = createSignal(0);
  type ModelCapabilityLoadState =
    | Readonly<{ kind: 'loading' }>
    | Readonly<{ kind: 'ready'; capability: FlowerAttachmentCapability }>
    | Readonly<{ kind: 'failed' }>;
  const modelCapabilityCache = new Map<string, ModelCapabilityLoadState>();
  let modelTriggerRef: HTMLButtonElement | undefined;
  let modelMenuRef: HTMLDivElement | undefined;
  let permissionTriggerRef: HTMLButtonElement | undefined;
  let permissionMenuRef: HTMLDivElement | undefined;
  let composerControlsViewportRef: HTMLDivElement | undefined;
  let composerControlsMeasureRef: HTMLDivElement | undefined;
  let composerMoreButtonRef: HTMLButtonElement | undefined;
  let composerMorePanelRef: HTMLDivElement | undefined;
  let subagentTriggerRef: HTMLButtonElement | undefined;
  let subagentDropdownRef: HTMLDivElement | undefined;
  let renameDialogRef: HTMLDivElement | undefined;
  let renameInputRef: HTMLInputElement | undefined;
  let renameRestoreRef: HTMLElement | undefined;
  let threadSwitcherTriggerRef: HTMLButtonElement | undefined;
  let threadSwitcherRef: HTMLDivElement | undefined;
  let subagentDetailTailTimer: number | undefined;
  let subagentDetailTailInFlight: FlowerSubagentDetailTailRequest | null = null;
  let selectedThreadTailRevealFrame = 0;
  let selectedThreadTailRevealTimer: number | undefined;
  let deferredThreadSelectionFrame = 0;
  const composerReferenceIndex = props.adapter.listWorkingDirectoryEntries
    ? createFlowerComposerReferenceIndex({
      listDirectory: (path) => props.adapter.listWorkingDirectoryEntries!({ path, showHidden: false }),
      onStateChange: setComposerReferenceSearchState,
    })
    : null;
  onCleanup(() => composerReferenceIndex?.dispose());
  let deferredThreadSelectionTimer: number | undefined;
  let deferredThreadSelectionToken = 0;
  let nextThreadSelectionTransactionID = 1;
  let threadSelectionTransaction: Readonly<{
    id: number;
    value: string;
    startedAt: number;
  }> | null = null;
  let threadSelectionContentFrame = 0;
  let threadSelectionContentTimer: number | undefined;
  let composerFocusToken = 0;
  let composerFocusOwner: Element | null = null;
  let approvalDecisionResyncTimer: number | undefined;
  let approvalHandoffStyleFrame = 0;
  let approvalHandoffStyleSettleFrame = 0;
  const [composerFocusRevision, setComposerFocusRevision] = createSignal(0);
  const threadBootstrapRequests = new Map<string, Promise<FlowerLiveBootstrap>>();
  const loadedThreadIDs = new Set<string>();
  const locallyReadSnapshots = new Map<string, string>();
  const persistingReadThreadIDs = new Set<string>();
  const pendingReadPersistenceSnapshots = new Map<string, FlowerThreadActivitySnapshot>();
  const liveCursors = new Map<string, number>();
  const liveStreamGenerations = new Map<string, number>();
  let liveSummaryCursor = 0;
  let liveSummaryGeneration = 1;
  let liveSummaryRefreshTimer: number | undefined;
  let threadsRefreshRequest: Promise<boolean> | null = null;
  const retiredThreadIDs = new Set<string>();
  let copiedMessageResetTimer: number | undefined;
  let copiedApprovalResetTimer: number | undefined;
  let activityClockTimer: number | undefined;
  let composerMorePanelPositionFrame = 0;
  let composerReferenceMenuPositionFrame = 0;
  let composerSelectionFrame = 0;
  let modelMenuPositionFrame = 0;
  let presentedSelectionFrame = 0;
  let presentedSelectionTimer: number | undefined;

  const reducedMotionPreferred = (): boolean => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  onMount(() => {
    activityClockTimer = window.setInterval(() => setActivityClockNow(Date.now()), 1000);
    const handleVisibilityChange = () => setDocumentVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', handleVisibilityChange);
    onCleanup(() => document.removeEventListener('visibilitychange', handleVisibilityChange));
  });

  onCleanup(() => {
    if (activityClockTimer !== undefined) {
      window.clearInterval(activityClockTimer);
      activityClockTimer = undefined;
    }
  });

  const requestTranscriptAnimationFrame = (callback: FrameRequestCallback): number => {
    if (typeof window.requestAnimationFrame === 'function') {
      return window.requestAnimationFrame(callback);
    }
    return window.setTimeout(() => callback(typeof performance !== 'undefined' ? performance.now() : Date.now()), 16);
  };

  const emitThreadSelectionEvent = (
    transaction: NonNullable<typeof threadSelectionTransaction>,
    phase: UIFirstSelectionEvent<string, { source: 'thread-list' }>['phase'],
  ) => {
    const timestamp = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    props.onThreadSelectionEvent?.({
      phase,
      value: transaction.value,
      metadata: { source: 'thread-list' },
      transactionId: transaction.id,
      startedAt: transaction.startedAt,
      timestamp,
      elapsedMs: Math.max(0, timestamp - transaction.startedAt),
    });
  };

  const clearThreadSelectionContentSchedule = () => {
    if (threadSelectionContentFrame) {
      cancelTranscriptAnimationFrame(threadSelectionContentFrame);
      threadSelectionContentFrame = 0;
    }
    if (threadSelectionContentTimer !== undefined) {
      window.clearTimeout(threadSelectionContentTimer);
      threadSelectionContentTimer = undefined;
    }
  };

  const cancelThreadSelectionTransaction = () => {
    clearThreadSelectionContentSchedule();
    const transaction = threadSelectionTransaction;
    threadSelectionTransaction = null;
    if (transaction) emitThreadSelectionEvent(transaction, 'cancelled');
  };

  const scheduleThreadSelectionContentPresented = (threadID: string) => {
    const transaction = threadSelectionTransaction;
    if (!transaction || transaction.value !== trimString(threadID)) return;
    clearThreadSelectionContentSchedule();
    threadSelectionContentFrame = requestTranscriptAnimationFrame(() => {
      threadSelectionContentFrame = 0;
      threadSelectionContentTimer = window.setTimeout(() => {
        threadSelectionContentTimer = undefined;
        if (threadSelectionTransaction !== transaction) return;
        if (selectedThreadDetailID() !== transaction.value) return;
        emitThreadSelectionEvent(transaction, 'content_presented');
        threadSelectionTransaction = null;
      }, 0);
    });
  };

  const cancelTranscriptAnimationFrame = (handle: number) => {
    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(handle);
      return;
    }
    window.clearTimeout(handle);
  };
  const cancelPresentedSelectionSchedule = () => {
    if (presentedSelectionFrame) {
      cancelTranscriptAnimationFrame(presentedSelectionFrame);
      presentedSelectionFrame = 0;
    }
    if (presentedSelectionTimer !== undefined) {
      window.clearTimeout(presentedSelectionTimer);
      presentedSelectionTimer = undefined;
    }
  };
  const schedulePresentedSelection = (threadID: string, sequence: number) => {
    const tid = trimString(threadID);
    cancelPresentedSelectionSchedule();
    setPresentedSelection(null);
    if (!tid || !effectiveEngagement() || sidePanel() !== 'chat') return;
    presentedSelectionFrame = requestTranscriptAnimationFrame(() => {
      presentedSelectionFrame = 0;
      presentedSelectionTimer = window.setTimeout(() => {
        presentedSelectionTimer = undefined;
        if (!effectiveEngagement() || sidePanel() !== 'chat') return;
        if (sequence !== threadLoadSequence || selectedThreadID() !== tid || selectedThreadDetailID() !== tid) return;
        if (loadingThreadID() === tid || threadLoadError()) return;
        setPresentedSelection({ threadID: tid, sequence });
      }, 0);
    });
  };
  const cancelDeferredThreadSelection = () => {
    deferredThreadSelectionToken += 1;
    if (deferredThreadSelectionFrame) {
      cancelTranscriptAnimationFrame(deferredThreadSelectionFrame);
      deferredThreadSelectionFrame = 0;
    }
    if (deferredThreadSelectionTimer !== undefined) {
      window.clearTimeout(deferredThreadSelectionTimer);
      deferredThreadSelectionTimer = undefined;
    }
  };
  createEffect(on(
    () => [
      selectedThreadID(),
      selectedThreadDetailID(),
      loadingThreadID(),
      threadLoadError(),
      sidePanel(),
      effectiveEngagement(),
    ] as const,
    ([threadID, detailID, loadingID, error, , engaged]) => {
      cancelPresentedSelectionSchedule();
      setPresentedSelection(null);
      if (!engaged || !threadID || detailID !== threadID || loadingID === threadID || error) return;
      schedulePresentedSelection(threadID, threadLoadSequence);
    },
    { defer: false },
  ));
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

  const selectedThread = createMemo(() => {
    const detailID = trimString(selectedThreadDetailID());
    if (!detailID) return null;
    return threads().find((thread) => thread.thread_id === detailID) ?? null;
  });
  const selectedCanonicalQueuedTurns = createMemo<readonly FlowerQueuedTurn[]>(() => {
    const thread = selectedThread();
    return thread && trimString(thread.thread_id) === trimString(selectedThreadID())
      ? thread.queued_turns ?? []
      : [];
  });
  const selectedQueuedTurns = createMemo<readonly FlowerQueuedTurn[]>(() => {
    const canonical = selectedCanonicalQueuedTurns();
    const promotingID = trimString(queuedTurnPromotingID());
    const deletingID = queuedTurnDelete()?.threadID === selectedThreadID()
      ? trimString(queuedTurnDelete()?.queueID)
      : '';
    const visibleCanonical = promotingID || deletingID
      ? canonical.filter((turn) => {
        const queueID = trimString(turn.queue_id);
        return queueID !== promotingID && queueID !== deletingID;
      })
      : canonical;
    const reorder = queuedTurnReorder();
    if (!reorder || reorder.threadID !== selectedThreadID()) return visibleCanonical;
    const canonicalIDs = visibleCanonical.map((turn) => trimString(turn.queue_id));
    if (!sameQueuedTurnIDs(canonicalIDs, reorder.orderedQueueIDs)) return visibleCanonical;
    const byID = new Map(visibleCanonical.map((turn) => [trimString(turn.queue_id), turn] as const));
    return reorder.orderedQueueIDs.map((queueID) => byID.get(queueID)).filter((turn): turn is FlowerQueuedTurn => Boolean(turn));
  });
  createEffect(() => {
    const reorder = queuedTurnReorder();
    if (!reorder) return;
    const canonicalIDs = selectedCanonicalQueuedTurns().map((turn) => trimString(turn.queue_id));
    if (reorder.threadID !== selectedThreadID() || !sameQueuedTurnIDs(canonicalIDs, reorder.originalQueueIDs)) {
      setQueuedTurnReorder(null);
    }
  });
  const pendingSubmissionHasCanonicalProjection = (
    pending: FlowerPendingSubmission,
    thread: FlowerThreadSnapshot | null,
  ): boolean => {
    if (!thread) return false;
    const sourceQueueID = trimString(pending.sourceQueueID);
    if (sourceQueueID && thread.messages.some((message) => (
      message.role === 'user'
      && trimString(message.logical_request_id) === sourceQueueID
    ))) return true;
    if (!pending.canonicalID) return false;
    if (pending.canonicalKind === 'queued') {
      return (thread.queued_turns ?? []).some((turn) => trimString(turn.queue_id) === pending.canonicalID);
    }
    if (pending.canonicalKind === 'admitting') {
      return thread.messages.some((message) => (
        message.role === 'user'
        && trimString(message.logical_request_id) === trimString(pending.canonicalID)
      ));
    }
    return thread.messages.some((message) => trimString(message.turn_id) === pending.canonicalID);
  };
  const pendingSubmissionIsQueued = (pending: FlowerPendingSubmission): boolean => (
    !pending.sourceQueueID && pending.canonicalKind === 'queued'
  );
  const queuedPendingSubmission = createMemo<FlowerPendingSubmission | null>(() => {
    const pending = pendingSubmission();
    if (
      !pending
      || !pending.threadID
      || trimString(pending.threadID) !== trimString(selectedThreadID())
      || !pendingSubmissionIsQueued(pending)
      || pendingSubmissionHasCanonicalProjection(pending, selectedThread())
    ) return null;
    return pending;
  });
  createEffect(() => {
    const pending = pendingSubmission();
    if (!pending?.threadID) return;
    const thread = threads().find((candidate) => candidate.thread_id === pending.threadID);
    if (!thread) return;
    if (pendingSubmissionHasCanonicalProjection(pending, thread)) {
      transitionPendingSubmission({ kind: 'projection_observed', clientRequestID: pending.clientRequestID });
      if (pending.sourceQueueID) setQueuedTurnPromotingID('');
    }
  });
  createEffect(() => {
    const promotingID = queuedTurnPromotingID();
    const pending = pendingSubmission();
    if (promotingID && (!pending?.sourceQueueID || pending.threadID !== selectedThreadID())) {
      setQueuedTurnPromotingID('');
    }
  });
  const selectedThreadLiveStatus = createMemo(() => selectedThread()?.status ?? 'idle');
  const pendingAdmissionCanStop = createMemo(() => {
    if (!chatRunning()) return false;
    const pending = pendingSubmission();
    if (!pending || pending.sourceQueueID || pendingSubmissionIsQueued(pending)) return false;
    const selectedID = trimString(selectedThreadID());
    if (pending.threadID) return trimString(pending.threadID) === selectedID;
    return !selectedID && pending.sessionKey === PENDING_NEW_THREAD_ID;
  });
  const deferredStopPending = createMemo(() => {
    const requestID = trimString(deferredStopClientRequestID());
    return Boolean(requestID && requestID === trimString(pendingSubmission()?.clientRequestID));
  });
  const selectedThreadHasRunningContextCompaction = createMemo(() => {
    const thread = selectedThread();
    if (!thread) return false;
    return (thread.context_compactions ?? []).some((compaction) => compaction.status === 'compacting')
      || (thread.timeline_decorations ?? []).some((decoration) => (
        decoration.kind === 'context_compaction'
        && decoration.compaction.status === 'compacting'
      ));
  });
  const surfaceReadOnly = createMemo(() => props.adapter.canMutate === false);
  const selectedThreadReadOnlyReason = createMemo(() => trimString(selectedThread()?.read_only_reason));
  const selectedThreadReadOnly = createMemo(() => surfaceReadOnly() || selectedThreadLiveStatus() === 'read_only' || Boolean(selectedThreadReadOnlyReason()));
  const selectedThreadReadOnlyDisplay = createMemo(() => (
    selectedThreadReadOnlyReason() || subagentsCopy().readOnlyComposerLabel
  ));
  const visibleInputRequest = (thread: FlowerThreadSnapshot | null | undefined): FlowerInputRequest | null => (
    thread?.status === 'waiting_user' ? thread.input_request ?? null : null
  );
  const threadHasLoadedDetail = (thread: FlowerThreadSnapshot): boolean => (
    thread.messages.length > 0
    || thread.queued_turns !== undefined
    || visibleInputRequest(thread) !== null
    || (thread.approval_actions?.length ?? 0) > 0
    || thread.error != null
  );
  const selectedInputRequest = createMemo(() => {
    const thread = selectedThread();
    const request = visibleInputRequest(thread);
    if (!thread || !request) return null;
    const admission = consumedInputAdmissions()[trimString(thread.thread_id)];
    return admission?.promptID === trimString(request.prompt_id) ? null : request;
  });
  const inputSubmitting = createMemo(() => {
    const promptID = trimString(inputSubmittingPromptID());
    return Boolean(promptID && trimString(selectedInputRequest()?.prompt_id) === promptID);
  });
  createEffect(() => {
    const thread = selectedThread();
    if (!thread) return;
    const threadID = trimString(thread.thread_id);
    const admission = consumedInputAdmissions()[threadID];
    if (!admission) return;
    if (trimString(visibleInputRequest(thread)?.prompt_id) === admission.promptID) return;
    setConsumedInputAdmissions((current) => {
      if (current[threadID] !== admission) return current;
      const next = { ...current };
      delete next[threadID];
      return next;
    });
  });
  const selectedThreadCanStop = createMemo(() => (
    !selectedThreadReadOnly() && !selectedInputRequest() && COMPOSER_STOP_THREAD_STATUSES.has(selectedThreadLiveStatus())
  ));
  const selectedThreadHasContent = createMemo(() => {
    const thread = selectedThread();
    if (!thread) return false;
    return thread.messages.length > 0
      || (thread.queued_turns?.length ?? 0) > 0
      || !!visibleInputRequest(thread)
      || (thread.approval_actions?.length ?? 0) > 0
      || trimString(thread.error?.message) !== '';
  });
  const selectedApprovalActions = createMemo(() => (
    selectedThread()?.approval_actions?.filter((action) => action.status === 'pending' && action.state === 'requested') ?? []
  ));
  const approvalActionIsDelegated = (action: FlowerApprovalAction): boolean => action.origin === 'delegated_subagent';
  const approvalActionIsPrimarySurface = (action: FlowerApprovalAction): boolean => (
    action.surface_role === 'primary_action'
    || (!action.surface_role && !selectedThread()?.approval_queue && selectedApprovalActions().length === 1)
  );
  const approvalActionCanDecide = (action: FlowerApprovalAction): boolean => (
    action.can_approve
    && approvalActionIsPrimarySurface(action)
    && action.status === 'pending'
    && action.state === 'requested'
  );
  const selectedComposerApprovalAction = createMemo(() => flowerComposerApprovalAction(selectedThread()));
  const selectedApprovalDecisionHandoff = createMemo(() => {
    const handoff = approvalDecisionHandoff();
    return handoff && handoff.threadID === selectedThreadID() ? handoff : null;
  });
  let approvalDisplayFallbackClearFrame = 0;
  const selectedComposerApprovalDisplayAction = createMemo(() => (
    selectedComposerApprovalAction()
      ?? selectedApprovalDecisionHandoff()?.frozenAction
      ?? approvalDisplayFallbackAction()
  ));
  const bottomActionMode = createMemo<'chat' | 'input_request' | 'approval'>(() => {
    if (selectedComposerApprovalDisplayAction()) return 'approval';
    if (selectedInputRequest()) return 'input_request';
    return 'chat';
  });
  createEffect(() => {
    const current = selectedComposerApprovalAction();
    const handoff = selectedApprovalDecisionHandoff();
    const queue = selectedThread()?.approval_queue;
    if (current) {
      if (approvalDisplayFallbackAction()?.action_id !== current.action_id) {
        setApprovalDisplayFallbackAction(current);
      }
      if (approvalDisplayFallbackClearFrame) {
        cancelTranscriptAnimationFrame(approvalDisplayFallbackClearFrame);
        approvalDisplayFallbackClearFrame = 0;
      }
      return;
    }
    if (handoff || !approvalDisplayFallbackAction()) return;
    if (!queue || queue.unresolved_count <= 0 || !trimString(queue.current_action_id)) {
      if (approvalDisplayFallbackClearFrame) {
        cancelTranscriptAnimationFrame(approvalDisplayFallbackClearFrame);
        approvalDisplayFallbackClearFrame = 0;
      }
      setApprovalDisplayFallbackAction(null);
      return;
    }
    if (approvalDisplayFallbackClearFrame) return;
    approvalDisplayFallbackClearFrame = requestTranscriptAnimationFrame(() => {
      approvalDisplayFallbackClearFrame = requestTranscriptAnimationFrame(() => {
        approvalDisplayFallbackClearFrame = 0;
        if (!selectedComposerApprovalAction() && !selectedApprovalDecisionHandoff()) {
          setApprovalDisplayFallbackAction(null);
        }
      });
    });
  });
  const selectedComposerApprovalHandoffActive = createMemo(() => (
    Boolean(selectedApprovalDecisionHandoff()) || approvalHandoffStyleThreadID() === selectedThreadID()
  ));
  const selectedComposerApprovalHandoffPhase = createMemo(() => selectedApprovalDecisionHandoff()?.phase ?? 'settling');
  createEffect(() => {
    const actionID = trimString(selectedComposerApprovalDisplayAction()?.action_id);
    const queue = selectedThread()?.approval_queue;
    if (actionID && actionID !== previousComposerApprovalActionID) {
      setApprovalQueueAnnouncement(queue && queue.total > 0 ? `Approval ${queue.current_position} of ${queue.total}` : 'Next approval');
      requestTranscriptAnimationFrame(() => {
        const approvalSurface = composerApprovalCardRef;
        if (!approvalSurface?.isConnected) return;
        approvalSurface.querySelector<HTMLButtonElement>(
          '.flower-composer-approval-decision:not(:disabled)',
        )?.focus({ preventScroll: true });
      });
    }
    previousComposerApprovalActionID = actionID;
  });
  const selectedThreadLevelApprovalActions = createMemo(() => {
    const composerActionID = trimString(selectedComposerApprovalDisplayAction()?.action_id);
    return selectedApprovalActions().filter((action) => (
      approvalActionIsDelegated(action)
      && approvalActionIsPrimarySurface(action)
      && trimString(action.action_id) !== composerActionID
    ));
  });
  const clearApprovalDecisionResyncTimer = () => {
    if (approvalDecisionResyncTimer !== undefined) {
      window.clearTimeout(approvalDecisionResyncTimer);
      approvalDecisionResyncTimer = undefined;
    }
  };
  const clearApprovalHandoffStyleSchedule = () => {
    if (approvalHandoffStyleFrame) {
      cancelTranscriptAnimationFrame(approvalHandoffStyleFrame);
      approvalHandoffStyleFrame = 0;
    }
    if (approvalHandoffStyleSettleFrame) {
      cancelTranscriptAnimationFrame(approvalHandoffStyleSettleFrame);
      approvalHandoffStyleSettleFrame = 0;
    }
  };
  const scheduleApprovalHandoffStyleRelease = (threadID: string) => {
    clearApprovalHandoffStyleSchedule();
    approvalHandoffStyleFrame = requestTranscriptAnimationFrame(() => {
      approvalHandoffStyleFrame = 0;
      approvalHandoffStyleSettleFrame = requestTranscriptAnimationFrame(() => {
        approvalHandoffStyleSettleFrame = 0;
        if (approvalHandoffStyleThreadID() === threadID) {
          setApprovalHandoffStyleThreadID('');
        }
      });
    });
  };
  const clearApprovalSubmittingAction = (actionID: string) => {
    setApprovalSubmitting((current) => {
      if (!current[actionID]) return current;
      const next = { ...current };
      delete next[actionID];
      return next;
    });
  };
  const cancelApprovalDecisionHandoff = (actionID: string) => {
    const current = untrack(approvalDecisionHandoff);
    if (!current || current.actionID !== actionID) return;
    clearApprovalDecisionResyncTimer();
    batch(() => {
      setApprovalDecisionHandoff(null);
      clearApprovalSubmittingAction(actionID);
    });
  };
  const settleApprovalDecisionHandoff = (threadID: string, actionID: string) => {
    const current = untrack(approvalDecisionHandoff);
    if (!current || current.threadID !== threadID || current.actionID !== actionID) return;
    clearApprovalDecisionResyncTimer();
    clearApprovalHandoffStyleSchedule();
    batch(() => {
      setApprovalDecisionHandoff(null);
      clearApprovalSubmittingAction(actionID);
      setApprovalHandoffStyleThreadID(threadID);
    });
    scheduleApprovalHandoffStyleRelease(threadID);
  };
  const reconcileApprovalDecisionHandoff = (
    thread: FlowerThreadSnapshot,
    streamGeneration: unknown,
    cursor: unknown,
  ) => {
    const handoff = untrack(approvalDecisionHandoff);
    if (!handoff || handoff.threadID !== thread.thread_id) return;
    const projection = approvalDecisionProjection(thread, handoff.actionID);
    if (projection.kind === 'current_action' || projection.kind === 'waiting') return;
    const generation = liveStreamGenerationValue(streamGeneration);
    const currentCursor = liveCursorValue(cursor);
    const targetReached = handoff.phase === 'submitting'
      || generation > handoff.submittedStreamGeneration
      || (generation === handoff.submittedStreamGeneration && currentCursor >= liveCursorValue(handoff.targetCursor));
    if (!targetReached) return;
    settleApprovalDecisionHandoff(thread.thread_id, handoff.actionID);
  };
  const scheduleApprovalDecisionResync = (threadID: string, actionID: string) => {
    clearApprovalDecisionResyncTimer();
    approvalDecisionResyncTimer = window.setTimeout(() => {
      approvalDecisionResyncTimer = undefined;
      const current = untrack(approvalDecisionHandoff);
      if (!current || current.threadID !== threadID || current.actionID !== actionID) return;
      void reloadSelectedThread(threadID, threadLoadSequence, 'user_action').catch((error) => {
        if (selectedThreadDetailMatches(threadID)) {
          notifyComposerError(getErrorMessage(error));
        }
      });
    }, APPROVAL_DECISION_RESYNC_MS);
  };
  const registerApprovalDecisionReceipt = (
    threadID: string,
    actionID: string,
    currentCursor: unknown,
  ) => {
    const current = untrack(approvalDecisionHandoff);
    if (!current || current.threadID !== threadID || current.actionID !== actionID) return;
    const targetCursor = liveCursorValue(currentCursor);
    clearApprovalDecisionResyncTimer();
    setApprovalDecisionHandoff({ ...current, phase: 'awaiting_projection', targetCursor });
    const thread = threads().find((candidate) => candidate.thread_id === threadID);
    if (thread) {
      reconcileApprovalDecisionHandoff(
        thread,
        liveStreamGenerations.get(threadID),
        liveCursors.get(threadID),
      );
    }
    if (untrack(approvalDecisionHandoff)?.actionID === actionID) {
      scheduleApprovalDecisionResync(threadID, actionID);
    }
  };
  createEffect(on(
    () => selectedThreadID(),
    (threadID) => {
      const handoff = untrack(approvalDecisionHandoff);
      if (!handoff || handoff.threadID === threadID) return;
      clearApprovalDecisionResyncTimer();
      clearApprovalHandoffStyleSchedule();
      batch(() => {
        setApprovalDecisionHandoff(null);
        clearApprovalSubmittingAction(handoff.actionID);
        setApprovalHandoffStyleThreadID('');
      });
    },
  ));
  onCleanup(() => {
    clearApprovalDecisionResyncTimer();
    clearApprovalHandoffStyleSchedule();
    if (approvalDisplayFallbackClearFrame) {
      cancelTranscriptAnimationFrame(approvalDisplayFallbackClearFrame);
      approvalDisplayFallbackClearFrame = 0;
    }
  });
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
  const selectedThreadDetailPending = createMemo(() => {
    const threadID = trimString(selectedThreadID());
    return Boolean(threadID && selectedThreadDetailID() !== threadID);
  });
  const selectedThreadLoading = createMemo(() => (
    selectedThreadDetailPending()
    || (trimString(loadingThreadID()) !== '' && loadingThreadID() === selectedThreadID())
  ));
  const currentComposerSessionKey = createMemo(() => trimString(selectedThreadID()) || PENDING_NEW_THREAD_ID);
  const visiblePendingSubmission = createMemo(() => {
    const pending = pendingSubmission();
    if (!pending) return null;
    const threadID = trimString(selectedThreadID());
    if (pending.threadID) {
      if (pending.threadID !== threadID) return null;
      if (pendingSubmissionIsQueued(pending)) return null;
      if (pendingSubmissionHasCanonicalProjection(pending, selectedThread())) return null;
      return pending;
    }
    return !threadID && pending.sessionKey === PENDING_NEW_THREAD_ID ? pending : null;
  });
  const currentComposerSessionDraft = createMemo(() => composerSessionDrafts()[currentComposerSessionKey()] ?? emptyFlowerComposerSessionDraft());
  const defaultComposerPermissionType = createMemo<FlowerPermissionType>(() => snapshot()?.defaults.permission_type ?? 'approval_required');
  const selectedThreadPermissionType = createMemo<FlowerPermissionType>(() => selectedThread()?.permission_type ?? defaultComposerPermissionType());
  const composerPermissionType = createMemo<FlowerPermissionType>(() => {
    const thread = selectedThread();
    if (thread) return thread.permission_type ?? defaultComposerPermissionType();
    return currentComposerSessionDraft().permissionTypeOverride ?? defaultComposerPermissionType();
  });
  const composerPermissionCopy = createMemo(() => copy().settings.permissionTypes[composerPermissionType()]);
  const selectedThreadPreferenceEditable = createMemo(() => {
    if (selectedThreadDetailPending()) return false;
    if (selectedThreadReadOnly()) return false;
    if (selectedInputRequest()) return false;
    if (selectedThreadHasRunningContextCompaction()) return false;
    const status = selectedThreadLiveStatus();
    return status !== 'running' && status !== 'waiting_approval' && status !== 'waiting_user';
  });
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
      if (key !== PENDING_NEW_THREAD_ID && retiredThreadIDs.has(key)) return current;
      const previous = current[key] ?? emptyFlowerComposerSessionDraft();
      const next = updater(previous);
      if (sameFlowerComposerSessionDraft(previous, next)) return current;
      return { ...current, [key]: next };
    });
  };
  const updateCurrentComposerSessionDraft = (updater: (draft: FlowerComposerSessionDraft) => FlowerComposerSessionDraft) => {
    updateComposerSessionDraft(currentComposerSessionKey(), updater);
  };
  const draftSubmissionActive = (value: FlowerComposerDraftValue): boolean => (
    value.mode === 'preparing_long_text_submission' || value.mode === 'admission_in_flight'
  );
  const updateComposerSessionText = (rawSessionKey: string, text: string) => {
    const sessionKey = trimString(rawSessionKey) || PENDING_NEW_THREAD_ID;
    if (draftSubmissionActive(draftSessionFor(sessionKey).snapshot().value)) return;
    updateComposerSessionDraft(sessionKey, (draft) => (
      draft.chatDraft === text ? draft : { ...draft, chatDraft: text }
    ));
    draftSessionFor(sessionKey).mutate((draft) => (
      draft.text === text ? draft : { ...draft, text }
    ));
  };
  const attachmentControllers = new Map<string, FlowerAttachmentController>();
  const attachmentControllerUnsubscribers = new Map<string, () => void>();
  const draftSessions = new Map<string, FlowerComposerDraftSession>();
  const draftSessionSnapshots = new Map<string, () => FlowerComposerDraftSnapshot>();
  const draftSessionUnsubscribers = new Map<string, () => void>();
  const hydratedDraftSessionRevisions = new Map<string, number>();
  type ComposerAttachmentIntent =
    | Readonly<{ kind: 'add'; files: readonly File[]; source: 'file' | 'paste' | 'drop' }>
    | Readonly<{ kind: 'reselect'; localID: string; file: File }>;
  const attachmentControllerFor = (rawSessionKey: string): FlowerAttachmentController => {
    const sessionKey = trimString(rawSessionKey) || PENDING_NEW_THREAD_ID;
    const existing = attachmentControllers.get(sessionKey);
    const controller = draftCoordinator.attachmentController(sessionKey, () => createFlowerAttachmentController({
      stagingScope: draftCoordinator.attachmentStagingScope(sessionKey),
      upload: props.adapter.uploadAttachment,
      deleteStaged: props.adapter.deleteStagedAttachment,
      readStagedLongText: props.adapter.readStagedLongText,
    }));
    if (existing === controller) return controller;
    attachmentControllerUnsubscribers.get(sessionKey)?.();
    attachmentControllers.set(sessionKey, controller);
    attachmentControllerUnsubscribers.set(sessionKey, controller.subscribe(() => {
      setAttachmentStateRevision((revision) => revision + 1);
    }));
    return controller;
  };
  const ensureAttachmentStagingScope = (rawSessionKey: string): Promise<FlowerAttachmentStagingScope> => {
    const sessionKey = trimString(rawSessionKey) || PENDING_NEW_THREAD_ID;
    if (!props.adapter.createAttachmentStagingScope) {
      return Promise.reject(new Error('Attachment staging is unavailable.'));
    }
    const session = draftSessionFor(sessionKey);
    const targetID = sessionKey === PENDING_NEW_THREAD_ID
      ? session.mutate((value) => value.client_request_id
        ? value
        : { ...value, client_request_id: createFlowerClientRequestID() }).snapshot.value.client_request_id
      : sessionKey;
    if (!targetID) return Promise.reject(new Error('Attachment staging request identity is unavailable.'));
    return draftCoordinator.ensureAttachmentStagingScope(
      sessionKey,
      () => props.adapter.createAttachmentStagingScope!(targetID),
      (scope) => props.adapter.releaseAttachmentStagingScope?.(scope) ?? Promise.resolve(),
    );
  };
  const releaseAttachmentStagingScope = (rawSessionKey: string) => {
    const sessionKey = trimString(rawSessionKey) || PENDING_NEW_THREAD_ID;
    draftCoordinator.releaseAttachmentStagingScope(sessionKey);
  };
  const draftSessionFor = (rawSessionKey: string): FlowerComposerDraftSession => {
    const sessionKey = trimString(rawSessionKey) || PENDING_NEW_THREAD_ID;
    const existing = draftSessions.get(sessionKey);
    if (existing) return existing;
    const session = draftCoordinator.open(sessionKey);
    draftSessions.set(sessionKey, session);
    const [snapshot, setSnapshot] = createSignal(session.snapshot(), { equals: false });
    draftSessionSnapshots.set(sessionKey, snapshot);
    draftSessionUnsubscribers.set(sessionKey, session.subscribe((next) => setSnapshot(() => next)));
    return session;
  };
  const reactiveDraftSnapshotFor = (rawSessionKey: string): FlowerComposerDraftSnapshot => {
    const sessionKey = trimString(rawSessionKey) || PENDING_NEW_THREAD_ID;
    draftSessionFor(sessionKey);
    const snapshot = draftSessionSnapshots.get(sessionKey);
    if (!snapshot) throw new Error('Flower composer draft session snapshot is unavailable.');
    return snapshot();
  };
  const currentAttachmentController = (): FlowerAttachmentController => attachmentControllerFor(currentComposerSessionKey());
  const currentAttachmentSnapshot = createMemo<FlowerAttachmentControllerSnapshot>(() => {
    attachmentStateRevision();
    return currentAttachmentController().snapshot();
  });
  const composerSharedOperationActive = createMemo(() => Boolean(
    draftSubmissionActive(reactiveDraftSnapshotFor(currentComposerSessionKey()).value),
  ));
  const composerPermissionInteractive = createMemo(() => (
    !composerSharedOperationActive()
    && !selectedThreadDetailPending()
    && !selectedThreadReadOnly()
    && (!selectedThreadID() || typeof props.adapter.setThreadPermissionType === 'function')
  ));
  type ComposerDraftOperation = Readonly<{
    sessionKey: string;
    session: FlowerComposerDraftSession;
    controller: FlowerAttachmentController;
  }>;
  const composerDraftOperationCurrent = (operation: ComposerDraftOperation): boolean => (
    !surfaceDisposed && currentComposerSessionKey() === operation.sessionKey
  );
  const composerDraftOperationActive = (_operation: ComposerDraftOperation): boolean => !surfaceDisposed;
  const currentComposerDraftOperation = (): ComposerDraftOperation => {
    const sessionKey = currentComposerSessionKey();
    return {
      sessionKey,
      session: draftSessionFor(sessionKey),
      controller: attachmentControllerFor(sessionKey),
    };
  };
  const queueComposerAttachmentIntent = (
    sessionKey: string,
    intent: ComposerAttachmentIntent,
  ) => {
    const operation = {
      sessionKey,
      session: draftSessionFor(sessionKey),
      controller: attachmentControllerFor(sessionKey),
    };
    if (draftSubmissionActive(operation.session.snapshot().value)) return;
    batch(() => {
      operation.controller.batch(() => {
        if (intent.kind === 'add') operation.controller.addFiles(intent.files, intent.source);
        else operation.controller.reselect(intent.localID, intent.file);
        operation.session.mutate((value) => ({
          ...value,
          attachments: flowerComposerDraftAttachments(operation.controller.snapshot().items),
        }));
      });
    });
    void ensureAttachmentStagingScope(sessionKey).catch(() => {
      operation.controller.markStagingUnavailable();
      notifyComposerError(attachmentCopy().unavailable);
    });
  };
  createEffect(() => {
    const sessionKey = currentComposerSessionKey();
    const sharedSnapshot = reactiveDraftSnapshotFor(sessionKey);
    const sharedDraft = sharedSnapshot.value;
    const sharedStagingScope = draftCoordinator.attachmentStagingScope(sessionKey);
    if (attachmentControllerFor(sessionKey).snapshot().staging_scope !== sharedStagingScope) {
      attachmentControllerFor(sessionKey).setStagingScope(sharedStagingScope);
    }
    const sharedText = sharedDraft.text;
    updateComposerSessionDraft(sessionKey, (draft) => (
      draft.chatDraft === sharedText
        && JSON.stringify(draft.references) === JSON.stringify(sharedDraft.references)
        && draft.modelIDOverride === sharedDraft.model_id
        && draft.permissionTypeOverride === sharedDraft.permission_type
        && sameFlowerReasoningSelection(draft.reasoningOverride, sharedDraft.reasoning_selection)
        && draft.workingDirDraft === sharedDraft.working_dir
        ? draft
        : {
          ...draft,
          chatDraft: sharedText,
          references: sharedDraft.references,
          modelIDOverride: sharedDraft.model_id,
          permissionTypeOverride: sharedDraft.permission_type,
          reasoningOverride: sharedDraft.reasoning_selection,
          workingDirDraft: sharedDraft.working_dir,
        }
    ));
    const attachmentController = attachmentControllerFor(sessionKey);
    const hydratedAttachments = sharedDraft.attachments.map((item) => ({
      local_id: item.local_id,
      request_id: item.upload_request_id,
      source: item.source,
      name: item.name,
      mime_type: item.mime_type,
      size_bytes: item.size_bytes,
      ...(item.staged ? { staged: item.staged } : {}),
    }));
    const currentHydratedAttachments = attachmentController.snapshot().items.map((item) => ({
      local_id: item.local_id,
      request_id: item.request_id,
      source: item.source,
      name: item.name,
      mime_type: item.mime_type,
      size_bytes: item.size_bytes,
      ...(item.staged ? { staged: item.staged } : {}),
    }));
    if (JSON.stringify(currentHydratedAttachments) !== JSON.stringify(hydratedAttachments)) {
      attachmentController.hydrateDraft(hydratedAttachments);
    }
    hydratedDraftSessionRevisions.set(sessionKey, sharedSnapshot.revision);
  });

  createEffect(() => {
    const sessionKey = currentComposerSessionKey();
    const session = draftSessionFor(sessionKey);
    const draft = currentComposerSessionDraft();
    const attachments = currentAttachmentSnapshot().items;
    const inspection = inspectFlowerText(draft.chatDraft);
    const shared = reactiveDraftSnapshotFor(sessionKey);
    if (hydratedDraftSessionRevisions.get(sessionKey) !== shared.revision) return;
    if (draftSubmissionActive(shared.value)) return;
    const mode = inspection && inspection.codePoints > FLOWER_INLINE_TEXT_CODE_POINT_LIMIT
        ? 'over_limit_editing' as const
        : 'ordinary' as const;
    if (composerReferenceMutationCount() > 0) return;
    const projectedAttachments = flowerComposerDraftAttachments(attachments);
    const projectedModelID = selectedComposerModelID();
    const projectedPermissionType = composerPermissionType();
    const projectedReasoningSelection = serializeFlowerReasoningSelection(composerLaunchReasoningSelection());
    const projectedWorkingDir = draftWorkingDirectory();
    const projectedCapabilityRevision = currentAttachmentSnapshot().capability?.revision;
    const unchanged = shared.value.mode === mode
      && shared.value.model_id === projectedModelID
      && shared.value.permission_type === projectedPermissionType
      && JSON.stringify(shared.value.reasoning_selection) === JSON.stringify(projectedReasoningSelection)
      && shared.value.working_dir === projectedWorkingDir
      && shared.value.capability_revision === projectedCapabilityRevision
      && JSON.stringify(shared.value.attachments) === JSON.stringify(projectedAttachments);
    if (unchanged) return;
    session.mutate((value) => ({
      ...value,
      text: value.text,
      references: value.references,
      attachments: projectedAttachments,
      mode,
      model_id: projectedModelID,
      permission_type: projectedPermissionType,
      reasoning_selection: projectedReasoningSelection,
      working_dir: projectedWorkingDir,
      capability_revision: projectedCapabilityRevision,
    }));
  });

  onCleanup(() => {
    surfaceDisposed = true;
    composerAutosizeController?.dispose();
    composerAutosizeController = undefined;
    for (const unsubscribe of attachmentControllerUnsubscribers.values()) unsubscribe();
    for (const unsubscribe of draftSessionUnsubscribers.values()) unsubscribe();
    for (const session of draftSessions.values()) {
      const snapshot = session.snapshot();
      if (
        (snapshot.value.mode === 'preparing_long_text_submission' || snapshot.value.mode === 'admission_in_flight')
        && snapshot.value.admission_started !== true
      ) {
        session.mutate((value) => ({
          ...value,
          mode: (inspectFlowerText(value.text)?.codePoints ?? 0) > FLOWER_INLINE_TEXT_CODE_POINT_LIMIT
            ? 'over_limit_editing'
            : 'ordinary',
          client_request_id: undefined,
          admission_started: undefined,
        }));
      }
    }
  });
  const selectedThreadDetailMatches = (threadID: string): boolean => {
    const tid = trimString(threadID);
    return Boolean(tid && selectedThreadID() === tid && selectedThreadDetailID() === tid);
  };
  const composerSessionStillCurrent = (sessionKey: string): boolean => {
    const key = trimString(sessionKey) || PENDING_NEW_THREAD_ID;
    if (key === PENDING_NEW_THREAD_ID) return !selectedThreadID() && !selectedThreadDetailID();
    return selectedThreadDetailMatches(key);
  };
  const setSelectedThreadWithDetailIfSessionCurrent = (sessionKey: string, threadID: string): boolean => {
    if (!composerSessionStillCurrent(sessionKey)) return false;
    setSelectedThreadWithDetail(threadID);
    return true;
  };
  const warmupState = createMemo(() => props.warmup?.active ? props.warmup : null);
  const surfaceWarmupActive = createMemo(() => warmupState() !== null);
  createEffect(() => {
    const ordinaryComposerBlocked = Boolean(selectedInputRequest())
      || Boolean(selectedComposerApprovalDisplayAction())
      || selectedThreadReadOnly()
      || selectedThreadDetailPending()
      || surfaceWarmupActive();
    if (longTextPreparing() && ordinaryComposerBlocked) cancelActiveLongTextSubmission?.();
  });
  const workingDirectoryPickerAvailable = createMemo(() => (
    typeof props.adapter.getWorkingDirectoryPathContext === 'function'
    && typeof props.adapter.listWorkingDirectoryEntries === 'function'
  ));
  const workingDirectoryHomePath = createMemo(() => normalizeAbsolutePath(
    workingDirectoryPathContext()?.homePathAbs
      || workingDirectoryPathContext()?.agentHomePathAbs
      || '',
  ));
  const selectedThreadWorkingDirectory = createMemo(() => normalizeAbsolutePath(selectedThread()?.working_dir ?? ''));
  const draftWorkingDirectory = createMemo(() => normalizeAbsolutePath(currentComposerSessionDraft().workingDirDraft ?? ''));
  const displayedWorkingDirectory = createMemo(() => {
    if (selectedThreadDetailPending()) return '';
    const threadPath = selectedThreadWorkingDirectory();
    if (threadPath) return threadPath;
    const draftPath = draftWorkingDirectory();
    if (draftPath) return draftPath;
    return workingDirectoryHomePath();
  });
  const displayedWorkingDirectoryLabel = createMemo(() => (
    basenameFromAbsolutePath(displayedWorkingDirectory(), copy().threadList.workingDirectoryLabel)
  ));
  const workingDirectoryPickerInitialPath = createMemo(() => (
    toPickerTreePath(displayedWorkingDirectory() || workingDirectoryHomePath(), workingDirectoryHomePath())
  ));
  const canPickWorkingDirectory = createMemo(() => (
    !selectedThreadID()
    && workingDirectoryPickerAvailable()
    && !composerSharedOperationActive()
    && !chatRunning()
    && !surfaceWarmupActive()
  ));
  const workingDirectoryChipInteractive = createMemo(() => (
    !composerSharedOperationActive()
    && !selectedThreadDetailPending()
    && (selectedThreadID() ? displayedWorkingDirectory() !== '' : canPickWorkingDirectory())
  ));
  const workingDirectoryChipTitle = createMemo(() => {
    const path = displayedWorkingDirectory();
    if (!path) return copy().threadList.workingDirectoryLabel;
    if (selectedThreadID()) return `${copy().threadList.copyWorkingDirectory}: ${path}`;
    return `${copy().threadList.workingDirectoryLabel}: ${path}`;
  });
  const workingDirectoryPicker = createDirectoryPickerDataSource({
    homePath: () => workingDirectoryHomePath(),
    listDirectory: async (absolutePath) => {
      if (!props.adapter.listWorkingDirectoryEntries) {
        throw new Error('Working directory picker is unavailable.');
      }
      return props.adapter.listWorkingDirectoryEntries({
        path: absolutePath,
        showHidden: false,
      });
    },
  });
  let lastWorkingDirectoryHomePath = '';
  let workingDirectoryPathContextRequest: Promise<FlowerWorkingDirectoryPathContext> | null = null;
  createEffect(() => {
    const homePath = workingDirectoryHomePath();
    if (homePath === lastWorkingDirectoryHomePath) return;
    lastWorkingDirectoryHomePath = homePath;
    workingDirectoryPicker.reset();
  });
  const loadWorkingDirectoryPathContext = async (): Promise<FlowerWorkingDirectoryPathContext | null> => {
    if (!workingDirectoryPickerAvailable() || !props.adapter.getWorkingDirectoryPathContext) return null;
    const existing = workingDirectoryPathContext();
    if (existing) return existing;
    if (workingDirectoryPathContextRequest) return workingDirectoryPathContextRequest;
    setWorkingDirectoryPathContextLoading(true);
    workingDirectoryPathContextRequest = props.adapter.getWorkingDirectoryPathContext()
      .then((context) => {
        setWorkingDirectoryPathContext(context);
        return context;
      })
      .finally(() => {
        workingDirectoryPathContextRequest = null;
        setWorkingDirectoryPathContextLoading(false);
      });
    return workingDirectoryPathContextRequest;
  };
  const openWorkingDirectoryPicker = async () => {
    if (!canPickWorkingDirectory()) return;
    try {
      const context = await loadWorkingDirectoryPathContext();
      if (!context && !workingDirectoryPathContext()) return;
      workingDirectoryPicker.reset();
      setWorkingDirectoryPickerOpen(true);
    } catch (error) {
      notifyComposerError(getErrorMessage(error));
    }
  };
  const handleWorkingDirectoryChipClick = async () => {
    if (selectedThreadDetailPending()) return;
    if (selectedThreadID()) {
      const path = displayedWorkingDirectory();
      if (!path) return;
      setComposerMoreOpen(false);
      try {
        await writeClipboardText(path, copy().threadList.workingDirectoryLabel);
        confirmWorkingDirectoryCopied();
      } catch (error) {
        notifyThreadActionError(getErrorMessage(error));
      }
      return;
    }
    setComposerMoreOpen(false);
    clearWorkingDirectoryCopyConfirmation();
    await openWorkingDirectoryPicker();
  };
  createEffect(() => {
    if (!workingDirectoryPickerAvailable()) return;
    if (selectedThreadID()) return;
    void loadWorkingDirectoryPathContext().catch(() => undefined);
  });
  createEffect(() => {
    if (!workingDirectoryPickerOpen()) return;
    if (workingDirectoryPicker.files().length > 0) return;
    void workingDirectoryPicker.ensureRootLoaded();
  });
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
    if (!tid || retiredThreadIDs.has(tid)) return;
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
    if (!tid || !mid || retiredThreadIDs.has(tid)) return;
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
  const applyPersistedDefaultModelLocally = (modelID: string) => {
    const mid = trimString(modelID);
    if (!mid) return;
    setSnapshot((current) => {
      if (!current?.model_profile) return current;
      const profile = current.model_profile;
      const belongsToProfile = profile.providers.some((provider) => (
        provider.models.some((model) => `${trimString(provider.id)}/${trimString(model.model_name)}` === mid)
      ));
      if (!belongsToProfile) return current;
      return { ...current, model_profile: { ...profile, current_model_id: mid } };
    });
  };
  const applyThreadReasoningLocally = (threadID: string, selection: FlowerReasoningSelection | undefined) => {
    const tid = trimString(threadID);
    if (!tid || retiredThreadIDs.has(tid)) return;
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
    if (composerSharedOperationActive()) return;
    const mid = trimString(modelID);
    if (!mid) return;
    const option = modelSelectOptions().find((item) => item.id === mid);
    if (!option) return;
    const persistsRemoteDefault = option.source === 'model_profile';
    const threadID = trimString(selectedThreadID());
    if (!threadID) {
      const previous = selectedComposerModelID();
      if (previous === mid) return;
      const previousDraftOverride = trimString(currentComposerSessionDraft().modelIDOverride);
      updateCurrentComposerSessionDraft((draft) => (
        trimString(draft.modelIDOverride) === mid ? draft : { ...draft, modelIDOverride: mid }
      ));
      if (!persistsRemoteDefault) return;
      const previousSnapshot = snapshot();
      setPendingModelPatch({ threadID: PENDING_NEW_THREAD_ID, requested: mid, previous });
      applyPersistedDefaultModelLocally(mid);
      try {
        const next = await props.adapter.persistDefaultModel(mid);
        setSnapshot(next);
        updateCurrentComposerSessionDraft((draft) => (
          trimString(draft.modelIDOverride) === mid ? { ...draft, modelIDOverride: '' } : draft
        ));
      } catch (error) {
        setSnapshot(previousSnapshot);
        updateCurrentComposerSessionDraft((draft) => (
          trimString(draft.modelIDOverride) === mid ? { ...draft, modelIDOverride: previousDraftOverride } : draft
        ));
        notifyModelError(getErrorMessage(error) || copy().chat.messageErrorFallback);
      } finally {
        setPendingModelPatch((current) => (
          current?.threadID === PENDING_NEW_THREAD_ID && current.requested === mid ? null : current
        ));
      }
      return;
    }
    if (!props.adapter.setThreadModel || !composerModelInteractive()) return;
    const previous = selectedComposerModelID();
    if (previous === mid) return;
    const previousSnapshot = snapshot();
    setPendingModelPatch({ threadID, requested: mid, previous });
    applyThreadModelLocally(threadID, mid);
    try {
      const live = await props.adapter.setThreadModel(threadID, mid);
      const updated = applyLiveBootstrap(live, 'user_action');
      if (persistsRemoteDefault) {
        applyPersistedDefaultModelLocally(mid);
        try {
          const next = await props.adapter.persistDefaultModel(mid);
          setSnapshot(next);
        } catch (error) {
          setSnapshot(previousSnapshot);
          if (selectedThreadDetailMatches(threadID)) {
            notifyFutureDefaultModelError(getErrorMessage(error) || copy().chat.messageErrorFallback);
          }
        }
      }
      if (selectedThreadDetailMatches(threadID)) {
        setSelectedThreadWithDetail(updated.thread_id);
      }
    } catch (error) {
      applyThreadModelLocally(threadID, previous);
      if (selectedThreadDetailMatches(threadID)) {
        notifyModelError(getErrorMessage(error) || copy().chat.messageErrorFallback);
      }
    } finally {
      setPendingModelPatch((current) => (current?.threadID === threadID && current.requested === mid ? null : current));
    }
  };
  const updateComposerReasoningSelection = async (selection: FlowerReasoningSelection | undefined) => {
    if (composerSharedOperationActive()) return;
    const normalized = serializeFlowerReasoningSelection(selection);
    const threadID = trimString(selectedThreadID());
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
      if (selectedThreadDetailMatches(threadID)) {
        setSelectedThreadWithDetail(updated.thread_id);
      }
      updateComposerSessionDraft(threadID, (draft) => (
        draft.reasoningOverride ? { ...draft, reasoningOverride: undefined } : draft
      ));
    } catch (error) {
      applyThreadReasoningLocally(threadID, previous);
      if (selectedThreadDetailMatches(threadID)) {
        notifyComposerError(getErrorMessage(error) || copy().chat.messageErrorFallback);
      }
    }
  };
  const updateComposerPermissionType = async (permissionType: FlowerPermissionType) => {
    const threadID = trimString(selectedThreadID());
    closePermissionMenu(true);
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
      if (selectedThreadDetailMatches(threadID)) {
        setSelectedThreadWithDetail(updated.thread_id);
      }
    } catch (error) {
      applyThreadPermissionLocally(threadID, previous);
      try {
        await reloadSelectedThread(threadID, threadLoadSequence, 'user_action');
      } catch {
        // Keep the concise permission error; the previous snapshot has already been restored locally.
      }
      if (selectedThreadDetailMatches(threadID)) {
        notifyPermissionError(getErrorMessage(error));
      }
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
  const requestComposerFocus = (focusOwner = typeof document === 'undefined' ? null : document.activeElement) => {
    composerFocusOwner = focusOwner;
    setComposerFocusRevision((revision) => revision + 1);
  };
  const scheduleComposerFocus = () => {
    if (typeof queueMicrotask === 'undefined') return;
    const token = ++composerFocusToken;
    const focusOwnerAtRequest = composerFocusOwner;
    queueMicrotask(() => {
      if (token !== composerFocusToken) return;
      if (typeof document !== 'undefined') {
        const activeElement = document.activeElement;
        const focusStillOwned = activeElement == null
          || activeElement === document.body
          || activeElement === focusOwnerAtRequest
          || activeElement === composerRef;
        if (!focusStillOwned) return;
      }
      if (!composerRef?.isConnected) return;
      composerRef.focus();
      if (typeof document !== 'undefined' && document.activeElement !== composerRef) return;
    });
  };
  onCleanup(() => {
    composerFocusToken += 1;
  });
  const warmupCanReplaceTranscript = createMemo(() => (
    surfaceWarmupActive()
    && !selectedThreadHasContent()
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
      case 'provider_stream_interrupted':
        return copy().chat.runErrors.providerStreamInterrupted;
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
  const selectedThreadRunErrorMessage = createMemo(() => {
    const thread = selectedThread();
    const error = thread?.error;
    if (latestThreadFailureIsUserRejectedTool(thread)) return '';
    return presentRunError(error);
  });
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
    if (!tid || retiredThreadIDs.has(tid)) return;
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
  const localAdmissionThreadItems = createMemo<readonly FlowerThreadListItem[]>(() => {
    const items = sidebarListItems();
    const pending = pendingSubmission();
    if (!pending || pending.phase === 'preparing' || pendingSubmissionIsQueued(pending)) return items;
    const pendingThreadID = trimString(pending.threadID);
    const buildPendingItem = (threadID: string): FlowerThreadListItem => {
      const startedAtMS = Math.max(1, pending.startedAtMS);
      const activitySignature = `local-admission:${pending.clientRequestID}`;
      return {
        thread_id: threadID,
        title: copy().threadList.untitled,
        title_status: 'pending',
        model_id: selectedComposerModelID(),
        working_dir: draftWorkingDirectory(),
        pinned: false,
        created_at_ms: startedAtMS,
        updated_at_ms: startedAtMS,
        preview: pending.prompt,
        status: 'running',
        source_label: '',
        target_labels: [],
        admission_pending: true,
        read_status: {
          is_unread: false,
          snapshot: {
            activity_revision: 0,
            last_message_at_unix_ms: startedAtMS,
            activity_signature: activitySignature,
          },
          read_state: {
            last_seen_activity_revision: 0,
            last_read_message_at_unix_ms: startedAtMS,
            last_seen_activity_signature: activitySignature,
          },
        },
      };
    };
    if (pendingThreadID) {
      const matched = items.some((item) => item.thread_id === pendingThreadID);
      const projected = items.map((item) => item.thread_id === pendingThreadID
        ? { ...item, status: 'running' as const, admission_pending: true }
        : item);
      return matched || pending.sessionKey !== PENDING_NEW_THREAD_ID
        ? projected
        : [buildPendingItem(pendingThreadID), ...projected];
    }
    if (pending.sessionKey !== PENDING_NEW_THREAD_ID) return items;
    return [buildPendingItem(PENDING_NEW_THREAD_ID), ...items];
  });
  const visibleSidebarActiveThreadID = createMemo(() => {
    const pending = pendingSubmission();
    return pending
      && pending.phase !== 'preparing'
      && pending.canonicalKind !== 'queued'
      && !pending.threadID
      && pending.sessionKey === PENDING_NEW_THREAD_ID
      ? PENDING_NEW_THREAD_ID
      : sidebarActiveThreadID();
  });
  const [companionLiveThread, setCompanionLiveThread] = createSignal<FlowerThreadSnapshot | null>(null);
  const [companionLiveRunGeneration] = createSignal(0);
  const [companionTerminalTransition, setCompanionTerminalTransition] = createSignal<FlowerCompanionTerminalTransition>();
  const [companionTerminalOverrides, setCompanionTerminalOverrides] = createSignal<ReadonlyMap<string, Readonly<{
    thread: FlowerThreadSnapshot;
    runID: string;
    runGeneration: number;
  }>>>(new Map());
  const companionBaseThreadItems = createMemo<readonly FlowerCompanionThreadListItem[]>(() => {
    const threadStateByID = new Map(threads().map((thread) => [thread.thread_id, thread] as const));
    return sidebarListItems().map((item) => {
      const thread = threadStateByID.get(item.thread_id);
      const liveTail = thread ? projectFlowerCompanionLiveTail(thread, modelStatusLabel) : null;
      return {
        ...item,
        queued_turn_count: thread?.queued_turn_count ?? thread?.queued_turns?.length ?? 0,
        ...(thread?.active_run_id ? { active_run_id: thread.active_run_id } : {}),
        ...(liveTail ? {
          progress_text: liveTail.text,
          progress_kind: liveTail.kind,
          progress_identity: liveTail.identity,
        } : {}),
      };
    });
  });
  const overlayCompanionThreadItem = (
    item: FlowerCompanionThreadListItem,
    thread: FlowerThreadSnapshot,
    runGeneration?: number,
  ): FlowerCompanionThreadListItem => {
    const liveTail = projectFlowerCompanionLiveTail(thread, modelStatusLabel);
    const liveItem = projectFlowerThreadListItem(threadWithLocalReadVisibility(thread));
    const {
      progress_text: _staleProgressText,
      progress_kind: _staleProgressKind,
      progress_identity: _staleProgressIdentity,
      ...baseItem
    } = item;
    return {
      ...baseItem,
      ...liveItem,
      queued_turn_count: thread.queued_turn_count ?? thread.queued_turns?.length ?? 0,
      ...(thread.active_run_id ? { active_run_id: thread.active_run_id } : {}),
      ...(runGeneration !== undefined ? { run_generation: runGeneration } : {}),
      ...(liveTail ? {
        progress_text: liveTail.text,
        progress_kind: liveTail.kind,
        progress_identity: liveTail.identity,
      } : {}),
    };
  };
  const companionPriorityThreadItems = createMemo<readonly FlowerCompanionThreadListItem[]>(() => {
    const overrides = companionTerminalOverrides();
    if (overrides.size === 0) return companionBaseThreadItems();
    return companionBaseThreadItems().map((item) => {
      const override = overrides.get(item.thread_id);
      return override ? overlayCompanionThreadItem(item, override.thread, override.runGeneration) : item;
    });
  });
  const companionThreadItems = createMemo<readonly FlowerCompanionThreadListItem[]>(() => {
    const liveThread = companionLiveThread();
    if (!liveThread) return companionPriorityThreadItems();
    return companionPriorityThreadItems().map((item) => {
      if (item.thread_id !== liveThread.thread_id) return item;
      return overlayCompanionThreadItem(item, liveThread, companionLiveRunGeneration());
    });
  });
  createEffect(() => {
    const baseThreads = new Map(threads().map((thread) => [thread.thread_id, thread] as const));
    const current = companionTerminalOverrides();
    if (current.size === 0) return;
    let next: Map<string, Readonly<{ thread: FlowerThreadSnapshot; runID: string; runGeneration: number }>> | null = null;
    for (const [threadID, override] of current) {
      const baseThread = baseThreads.get(threadID);
      const baseStillTrailsOverride = baseThread?.status === 'running'
        && trimString(baseThread.active_run_id) === override.runID;
      if (baseStillTrailsOverride) continue;
      next ??= new Map(current);
      next.delete(threadID);
    }
    if (next) setCompanionTerminalOverrides(next);
  });
  let lastCompanionPresenceSignature = '';
  createEffect(() => {
    const presence = projectFlowerCompanionPresence(
      companionThreadItems(),
      !loadError(),
      companionTerminalTransition(),
    );
    const signature = JSON.stringify(presence);
    if (signature === lastCompanionPresenceSignature) return;
    lastCompanionPresenceSignature = signature;
    props.onPresenceChange?.(presence);
  });

  const closeThreadSwitcher = (restoreFocus = false) => {
    setThreadSwitcherOpen(false);
    setThreadSwitcherQuery('');
    if (restoreFocus) queueMicrotask(() => threadSwitcherTriggerRef?.focus());
  };
  createEffect(() => {
    if (!threadSwitcherOpen()) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || threadSwitcherRef?.contains(target) || threadSwitcherTriggerRef?.contains(target)) return;
      closeThreadSwitcher(false);
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    onCleanup(() => window.removeEventListener('pointerdown', handlePointerDown, true));
  });

  createEffect(() => {
    const dropdownOpen = subagentDropdownOpen();
    if (!dropdownOpen) return;
    updateSubagentDropdownPosition();
    const focusFrame = window.requestAnimationFrame(() => {
      const firstRow = subagentDropdownRows()[0];
      (firstRow ?? subagentDropdownRef)?.focus();
    });
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
      window.cancelAnimationFrame(focusFrame);
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
  const currentModelID = createMemo(() => {
    const current = snapshot();
    if (current?.model_profile?.current_model_id) return trimString(current.model_profile.current_model_id);
    return current?.model_source?.state === 'ready' ? trimString(current.model_source.current_model_id) : '';
  });
  const selectedComposerModelID = createMemo(() => {
    const thread = selectedThread();
    const threadModelID = thread?.thread_id === trimString(selectedThreadID())
      ? trimString(thread.model_id)
      : '';
    if (threadModelID) return threadModelID;
    return trimString(currentComposerSessionDraft().modelIDOverride) || currentModelID();
  });
  let attachmentCapabilitySequence = 0;
  createEffect(() => {
    const sessionKey = currentComposerSessionKey();
    const modelID = selectedComposerModelID();
    const controller = attachmentControllerFor(sessionKey);
    const sequence = ++attachmentCapabilitySequence;
    controller.setCapability(null);
    if (!modelID || !props.adapter.loadAttachmentCapability || !props.adapter.uploadAttachment) return;
    void props.adapter.loadAttachmentCapability(modelID).then((capability) => {
      if (
        sequence !== attachmentCapabilitySequence
        || currentComposerSessionKey() !== sessionKey
        || selectedComposerModelID() !== modelID
      ) return;
      controller.setCapability(capability.model_id === modelID ? capability : null);
    }).catch(() => {
      if (sequence === attachmentCapabilitySequence && currentComposerSessionKey() === sessionKey) {
        controller.setCapability(null);
      }
    });
  });
  type ComposerModelOption = Readonly<{
    id: string;
    label: string;
    source: 'model_profile' | 'desktop_model_source' | 'thread_snapshot';
    disabled?: boolean;
    providerType?: FlowerProviderType;
    supportsImageInput: boolean;
    contextWindow?: number;
    maxOutputTokens?: number;
    reasoningCapability?: FlowerReasoningCapability;
    defaultReasoningSelection?: FlowerReasoningSelection;
  }>;
  const configuredModelOptions = createMemo<readonly ComposerModelOption[]>(() => (
    snapshot()?.model_profile?.providers.flatMap((provider) => {
      const providerID = trimString(provider.id);
      if (!providerID) return [];
      const providerLabel = trimString(provider.name) || providerID;
      return provider.models.map((model) => {
        const modelName = trimString(model.model_name);
        if (!modelName) return null;
        return {
          id: `${providerID}/${modelName}`,
          label: `${providerLabel} / ${modelName}`,
          source: 'model_profile',
          providerType: provider.type,
          supportsImageInput: flowerModelSupportsImage(model.input_modalities),
          ...(model.context_window != null ? { contextWindow: model.context_window } : {}),
          ...(model.max_output_tokens != null ? { maxOutputTokens: model.max_output_tokens } : {}),
          ...(model.reasoning_capability ? { reasoningCapability: model.reasoning_capability } : {}),
          ...(model.default_reasoning_selection ? { defaultReasoningSelection: model.default_reasoning_selection } : {}),
        } as ComposerModelOption;
      }).filter((option): option is ComposerModelOption => option !== null);
    }) ?? []
  ));
  const sourceModelOptions = createMemo<readonly ComposerModelOption[]>(() => {
    const source = snapshot()?.model_source;
    if (source?.kind !== 'desktop_model_source' || source.state !== 'ready') return [];
    return source.models.map((model) => ({
      id: trimString(model.id),
      label: trimString(model.label) || trimString(model.id),
      source: 'desktop_model_source' as const,
      supportsImageInput: flowerModelSupportsImage(model.input_modalities),
      ...(model.context_window != null ? { contextWindow: model.context_window } : {}),
      ...(model.max_output_tokens != null ? { maxOutputTokens: model.max_output_tokens } : {}),
      ...(model.reasoning_capability ? { reasoningCapability: model.reasoning_capability } : {}),
    })).filter((option) => option.id);
  });
  const catalogModelOptions = createMemo<readonly ComposerModelOption[]>(() => {
    const seen = new Set<string>();
    return [...configuredModelOptions(), ...sourceModelOptions()].filter((option) => {
      if (seen.has(option.id)) return false;
      seen.add(option.id);
      return true;
    });
  });
  const currentModelLabel = createMemo(() => {
    const catalogModel = catalogModelOptions().find((option) => option.id === currentModelID());
    if (catalogModel) return catalogModel.label;
    const current = snapshot();
    return current?.model_profile ? formatFlowerCurrentModelLabel(current.model_profile, copy().chat.noModelSelected) : copy().chat.noModelSelected;
  });
  const reasoningControlLabel = createMemo(() => trimString(copy().chat.reasoningLabel) || DEFAULT_FLOWER_SURFACE_COPY.chat.reasoningLabel);
  const selectedThreadModelLabel = createMemo(() => {
    const threadModelID = selectedComposerModelID();
    if (!threadModelID) return currentModelLabel();
    const catalogModel = catalogModelOptions().find((option) => option.id === threadModelID);
    if (catalogModel) return catalogModel.label;
    return threadModelID;
  });
  const threadSnapshotModelOption = createMemo<ComposerModelOption | null>(() => {
    const threadModelID = trimString(selectedThread()?.model_id);
    if (!threadModelID || catalogModelOptions().some((option) => option.id === threadModelID)) return null;
    return {
      id: threadModelID,
      label: threadModelID,
      source: 'thread_snapshot',
      disabled: true,
      supportsImageInput: false,
    };
  });
  const modelSelectOptions = createMemo(() => {
    const options = catalogModelOptions();
    const threadSnapshot = threadSnapshotModelOption();
    return threadSnapshot ? [threadSnapshot, ...options] : options;
  });
  const selectedModelOption = createMemo(() => modelSelectOptions().find((option) => option.id === selectedComposerModelID()) ?? null);
  const groupedModelOptions = createMemo(() => {
    const options = modelSelectOptions();
    const remoteOptions = options.filter((option) => option.source === 'model_profile');
    const desktopOptions = options.filter((option) => option.source === 'desktop_model_source');
    if (remoteOptions.length === 0 || desktopOptions.length === 0) return null;
    return [
      {
        source: 'model_profile' as const,
        label: trimString(props.adapter.runtime.display_name),
        options: remoteOptions,
      },
      {
        source: 'desktop_model_source' as const,
        label: 'Desktop',
        options: desktopOptions,
      },
    ];
  });
  const selectedReasoningCapability = createMemo(() => {
    const thread = selectedThread();
    const model = selectedModelOption();
    if (model?.reasoningCapability) return model.reasoningCapability;
    return thread?.reasoning_capability ?? null;
  });
	const selectedThreadReasoningSelection = createMemo(() => (
		normalizeFlowerReasoningSelection(selectedThread()?.reasoning_selection)
		?? normalizeFlowerReasoningSelection(selectedModelOption()?.defaultReasoningSelection)
		?? defaultReasoningSelectionForCapability(selectedReasoningCapability())
	));
	const selectedWaitingReasoningSelection = createMemo(() => normalizeFlowerReasoningSelection(selectedInputRequest()?.reasoning_selection));
	const composerReasoningOverride = createMemo(() => normalizeFlowerReasoningSelection(currentComposerSessionDraft().reasoningOverride));
  const composerReasoningSelection = createMemo(() => composerReasoningOverride() ?? selectedWaitingReasoningSelection() ?? selectedThreadReasoningSelection());
  const composerReasoningEnabled = createMemo(() => reasoningCapabilitySupportsControl(selectedReasoningCapability()));
  const composerLaunchReasoningSelection = createMemo(() => (composerReasoningEnabled() ? composerReasoningSelection() : undefined));
  createEffect(() => {
    if (composerReasoningEnabled()) return;
    if (!currentComposerSessionDraft().reasoningOverride) return;
    updateCurrentComposerSessionDraft((draft) => (
      draft.reasoningOverride ? { ...draft, reasoningOverride: undefined } : draft
    ));
  });
  const modelPatchPending = createMemo(() => {
    const pending = pendingModelPatch();
    if (!pending) return false;
    const threadID = selectedThreadID();
    return threadID ? pending.threadID === threadID : pending.threadID === PENDING_NEW_THREAD_ID;
  });
  const composerModelInteractive = createMemo(() => (
    !composerSharedOperationActive()
    && selectedThreadPreferenceEditable()
    && modelSelectOptions().length > 0
    && (!selectedThreadID() || typeof props.adapter.setThreadModel === 'function')
  ));
  const composerReasoningInteractive = createMemo(() => (
    !composerSharedOperationActive()
    && composerReasoningEnabled()
    && (selectedInputRequest() ? !selectedThreadReadOnly() : selectedThreadPreferenceEditable())
    && (!selectedThreadID() || selectedInputRequest() || typeof props.adapter.setThreadReasoningSelection === 'function')
  ));
  const modelSource = createMemo(() => snapshot()?.model_source ?? null);
  const modelOptionReady = (option: ComposerModelOption | null | undefined): boolean => {
    if (!option) return false;
    if (option.source === 'desktop_model_source') {
      const source = modelSource();
      return source?.kind === 'desktop_model_source'
        && source.state === 'ready'
        && source.models.some((model) => trimString(model.id) === option.id);
    }
    if (option.source !== 'model_profile') return false;
    const providerID = option.id.split('/')[0] ?? '';
    const provider = snapshot()?.model_profile?.providers.find((item) => trimString(item.id) === providerID);
    const secrets = snapshot()?.provider_secrets.find((secret) => secret.provider_id === providerID);
    if (!provider || !secrets?.provider_api_key_configured) return false;
    return provider.web_search?.mode !== 'brave' || Boolean(secrets.web_search_api_key_configured);
  };
  const readyForChat = createMemo(() => modelOptionReady(selectedModelOption()));
  const anyModelReady = createMemo(() => catalogModelOptions().some((option) => modelOptionReady(option)));
  const selectedModelNeedsAttention = createMemo(() => !readyForChat() && anyModelReady());
  const unavailableModelSource = createMemo<UnavailableFlowerModelSourceStatus | null>(() => {
    const source = modelSource();
    return source && source.state !== 'ready' ? source : null;
  });
  const modelSourceStatusMessage = createMemo(() => {
    const source = unavailableModelSource();
    const recovery = props.adapter.modelSourceRecovery;
    return source && recovery ? trimString(recovery.describe(source)) : '';
  });
  const modelSourceRecoveryAction = (
    status: UnavailableFlowerModelSourceStatus,
  ): Readonly<{ id: FlowerModelSourceRecoveryActionID; action: FlowerSurfaceAction }> | null => {
    const recovery = props.adapter.modelSourceRecovery;
    if (!recovery) return null;
    if (status.state === 'missing_keys' || status.state === 'empty') {
      return { id: 'local_settings', action: recovery.localSettings };
    }
    if (status.state === 'unsupported') {
      return { id: 'runtime_settings', action: recovery.runtimeSettings };
    }
    return { id: 'connection_center', action: recovery.connectionCenter };
  };
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
  const needsSetup = createMemo(() => !!snapshot() && !anyModelReady());
  const companionCompactComposer = createMemo(() => (
    presentation() === 'companion'
    && !companionCollapsed()
    && !needsSetup()
    && !selectedInputRequest()
    && !selectedThreadReadOnly()
    && !selectedComposerApprovalDisplayAction()
    && !handlerNotice()
    && !selectedThreadDetailPending()
    && !surfaceWarmupActive()
  ));

  const composerControlIDs = createMemo<readonly FlowerComposerControlID[]>(() => {
    if (needsSetup()) return [];
    if (selectedThreadReadOnly()) return ['working_dir', 'permission', 'read_only'];
    if (selectedInputRequest()) return [];
    return [
      'working_dir',
      'permission',
      'model_reasoning',
    ];
  });
  const composerControlWidth = (ids: readonly FlowerComposerControlID[]): number => {
    if (ids.length === 0) return 0;
    const layout = composerControlLayout();
    const controlsWidth = ids.reduce((total, id) => total + Math.max(0, layout.itemWidths[id] ?? 0), 0);
    const controlGaps = Math.max(0, ids.length - 1) * FLOWER_COMPOSER_CONTROL_GAP_PX;
    return controlsWidth + controlGaps;
  };
  const composerOverflowControlIDs = createMemo<readonly FlowerComposerControlID[]>(() => {
    const ids = composerControlIDs();
    if (companionCompactComposer()) return ids;
    const availableWidth = composerControlLayout().availableWidth;
    if (ids.length === 0 || availableWidth <= 0) return [];
    if (composerControlWidth(ids) <= availableWidth) return [];

    const overflow = new Set<FlowerComposerControlID>();
    for (const id of FLOWER_COMPOSER_CONTROL_OVERFLOW_ORDER) {
      if (!ids.includes(id)) continue;
      overflow.add(id);
      const inlineIDs = ids.filter((candidate) => !overflow.has(candidate));
      if (composerControlWidth(inlineIDs) <= availableWidth) break;
    }
    return FLOWER_COMPOSER_CONTROL_ORDER.filter((id) => overflow.has(id));
  });
  const composerInlineControlIDs = createMemo<readonly FlowerComposerControlID[]>(() => {
    const overflow = new Set(composerOverflowControlIDs());
    return composerControlIDs().filter((id) => !overflow.has(id));
  });
  const setComposerControlLayoutIfChanged = (next: FlowerComposerControlLayout) => {
    const previous = composerControlLayout();
    const ids = FLOWER_COMPOSER_CONTROL_ORDER;
    const same = previous.availableWidth === next.availableWidth
      && ids.every((id) => (previous.itemWidths[id] ?? 0) === (next.itemWidths[id] ?? 0));
    if (!same) setComposerControlLayout(next);
  };
  const measureComposerControls = () => {
    const viewportWidth = Math.ceil(
      composerControlsViewportRef?.getBoundingClientRect().width
        || composerControlsViewportRef?.clientWidth
        || 0,
    );
    const itemWidths: Partial<Record<FlowerComposerControlID, number>> = {};
    for (const id of FLOWER_COMPOSER_CONTROL_ORDER) {
      const node = composerControlsMeasureRef?.querySelector<HTMLElement>(`[data-flower-composer-control-measure="${id}"]`);
      const width = Math.ceil(node?.getBoundingClientRect().width || node?.offsetWidth || 0);
      if (width > 0) itemWidths[id] = width;
    }
    setComposerControlLayoutIfChanged({
      availableWidth: viewportWidth,
      itemWidths,
    });
  };
  let composerControlMeasureFrame = 0;
  const scheduleComposerControlMeasure = () => {
    if (typeof window === 'undefined') return;
    if (composerControlMeasureFrame) return;
    composerControlMeasureFrame = window.requestAnimationFrame(() => {
      composerControlMeasureFrame = 0;
      measureComposerControls();
    });
  };
  onMount(() => {
    scheduleComposerControlMeasure();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => scheduleComposerControlMeasure());
    if (composerControlsViewportRef) resizeObserver?.observe(composerControlsViewportRef);
    if (composerControlsMeasureRef) resizeObserver?.observe(composerControlsMeasureRef);
    const onResize = () => scheduleComposerControlMeasure();
    window.addEventListener('resize', onResize);
    onCleanup(() => {
      if (composerControlMeasureFrame) {
        window.cancelAnimationFrame(composerControlMeasureFrame);
        composerControlMeasureFrame = 0;
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', onResize);
    });
  });
  createEffect(() => {
    void composerControlIDs().join('|');
    void displayedWorkingDirectoryLabel();
    void workingDirectoryChipTitle();
    void composerPermissionType();
    void composerPermissionCopy().label;
    void selectedThreadModelLabel();
    void composerReasoningEnabled();
    void composerReasoningSelection();
    void selectedThreadReadOnlyDisplay();
    scheduleComposerControlMeasure();
  });
  createEffect(() => {
    if (composerOverflowControlIDs().length === 0) setComposerMoreOpen(false);
  });
  const viewportShiftXForRect = (rect: DOMRect, margin = 8): number => {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    if (viewportWidth <= 0) return 0;
    let shiftX = 0;
    if (rect.left < margin) {
      shiftX += margin - rect.left;
    }
    if (rect.right + shiftX > viewportWidth - margin) {
      shiftX -= rect.right + shiftX - (viewportWidth - margin);
    }
    return Math.round(shiftX);
  };
  const cancelModelMenuPosition = () => {
    if (!modelMenuPositionFrame) return;
    cancelTranscriptAnimationFrame(modelMenuPositionFrame);
    modelMenuPositionFrame = 0;
  };
  const scheduleModelMenuPosition = () => {
    cancelModelMenuPosition();
    setModelMenuShiftX(0);
    modelMenuPositionFrame = requestTranscriptAnimationFrame(() => {
      modelMenuPositionFrame = 0;
      const menu = modelMenuRef;
      if (!menu) return;
      setModelMenuShiftX(viewportShiftXForRect(menu.getBoundingClientRect()));
    });
  };
  const cancelComposerMorePanelPosition = () => {
    if (!composerMorePanelPositionFrame) return;
    cancelTranscriptAnimationFrame(composerMorePanelPositionFrame);
    composerMorePanelPositionFrame = 0;
  };
  const composerMorePanelEstimatedSize = (): Readonly<{ width: number; height: number }> => ({
    width: FLOWER_COMPOSER_MORE_PANEL_ESTIMATED_WIDTH,
    height: FLOWER_COMPOSER_MORE_PANEL_VERTICAL_CHROME
      + (composerOverflowControlIDs().length + (companionCompactComposer() && selectedContextUsage() ? 1 : 0))
        * FLOWER_COMPOSER_MORE_PANEL_ROW_HEIGHT,
  });
  const scheduleComposerMorePanelPosition = () => {
    cancelComposerMorePanelPosition();
    composerMorePanelPositionFrame = requestTranscriptAnimationFrame(() => {
      composerMorePanelPositionFrame = 0;
      const anchor = composerMoreButtonRef;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const estimated = composerMorePanelEstimatedSize();
      setComposerMorePanelPosition({
        x: rect.right - estimated.width,
        y: rect.top - estimated.height - 8,
      });
    });
  };
  createEffect(() => {
    if (!modelMenuOpen()) {
      cancelModelMenuPosition();
      setModelMenuShiftX(0);
      return;
    }
    void modelSelectOptions().length;
    scheduleModelMenuPosition();
    window.addEventListener('resize', scheduleModelMenuPosition);
    onCleanup(() => {
      cancelModelMenuPosition();
      window.removeEventListener('resize', scheduleModelMenuPosition);
    });
  });
  createEffect(() => {
    if (!composerMoreOpen()) {
      cancelComposerMorePanelPosition();
      return;
    }
    void composerOverflowControlIDs().join('|');
    void selectedContextUsage();
    scheduleComposerMorePanelPosition();
    window.addEventListener('resize', scheduleComposerMorePanelPosition);
    window.addEventListener('scroll', scheduleComposerMorePanelPosition, true);
    onCleanup(() => {
      cancelComposerMorePanelPosition();
      window.removeEventListener('resize', scheduleComposerMorePanelPosition);
      window.removeEventListener('scroll', scheduleComposerMorePanelPosition, true);
    });
  });
  const closeComposerMore = (restoreFocus: boolean) => {
    setComposerMoreOpen(false);
    if (restoreFocus) {
      queueMicrotask(() => {
        let remainingFrames = 2;
        const restoreCurrentButton = () => {
          if (composerMoreButtonRef?.isConnected) composerMoreButtonRef.focus();
          remainingFrames -= 1;
          if (remainingFrames > 0) window.requestAnimationFrame(restoreCurrentButton);
        };
        window.requestAnimationFrame(restoreCurrentButton);
      });
    }
  };
  createEffect(() => {
    if (!composerMoreOpen()) return;
    queueMicrotask(() => {
      const panel = composerMorePanelRef;
      if (!panel || !composerMoreOpen()) return;
      const target = panel.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? panel;
      target.focus({ preventScroll: true });
    });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (composerMoreButtonRef?.contains(target) || composerMorePanelRef?.contains(target)) return;
      closeComposerMore(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeComposerMore(true);
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (composerMoreButtonRef?.contains(target) || composerMorePanelRef?.contains(target)) return;
      closeComposerMore(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
    });
  });

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

  let handlerDecisionRequest: Readonly<{ key: string; token: object; promise: Promise<FlowerRouterDecision> }> | null = null;
  const resolveHandlerDecision = (requestedHandlerID?: string, previousDecision?: FlowerRouterDecision | null): Promise<FlowerRouterDecision> => {
    const baseDecision = previousDecision ?? currentHandlerDecision();
    const key = [
      trimString(requestedHandlerID),
      trimString(baseDecision?.decision_scope.client_surface),
      trimString(baseDecision?.decision_scope.context_envelope_id),
    ].join('\x00');
    if (handlerDecisionRequest?.key === key) return handlerDecisionRequest.promise;
    setHandlerState({ status: 'resolving', decision: baseDecision });
    const token = {};
    const requestPromise = (async () => {
      try {
        const next = await props.adapter.resolveHandler({
          thread_kind: 'chat',
          client_surface: baseDecision?.decision_scope.client_surface || 'flower_surface',
          ...(baseDecision?.decision_scope.context_envelope_id ? { context_envelope_id: baseDecision.decision_scope.context_envelope_id } : {}),
          ...(trimString(requestedHandlerID) ? { requested_handler_id: trimString(requestedHandlerID) } : {}),
        });
        if (handlerDecisionRequest?.token === token) setHandlerState(handlerStateFromDecision(next));
        return next;
      } catch (error) {
        const message = getErrorMessage(error);
        if (handlerDecisionRequest?.token === token) {
          setHandlerState({ status: 'failed', decision: baseDecision, message });
        }
        throw new Error(message);
      } finally {
        if (handlerDecisionRequest?.token === token) handlerDecisionRequest = null;
      }
    })();
    handlerDecisionRequest = { key, token, promise: requestPromise };
    return requestPromise;
  };

  const upsertThread = (thread: FlowerThreadSnapshot) => {
    if (retiredThreadIDs.has(trimString(thread.thread_id))) return;
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
  const stripThreadDetail = (thread: FlowerThreadSnapshot): FlowerThreadSnapshot => {
    const summary = { ...thread, messages: [] as readonly FlowerChatMessage[] };
    delete summary.queued_turns;
    delete summary.model_io_status;
    delete summary.context_usage;
    delete summary.context_compactions;
    delete summary.timeline_decorations;
    delete summary.subagents;
    delete summary.approval_actions;
    delete summary.approval_queue;
    delete summary.input_request;
    delete summary.error;
    return summary;
  };
  const evictThreadDetail = (threadID: string) => {
    const tid = trimString(threadID);
    if (!tid || !loadedThreadIDs.delete(tid)) return;
    liveCursors.delete(tid);
    liveStreamGenerations.delete(tid);
    setThreads((current) => {
      let changed = false;
      const next = current.map((thread) => {
        if (thread.thread_id !== tid) return thread;
        changed = true;
        return stripThreadDetail(thread);
      });
      if (changed) threadLocalMutationRevision += 1;
      return changed ? next : current;
    });
  };
  const rememberThreadDetail = (threadID: string) => {
    const tid = trimString(threadID);
    if (!tid) return;
    loadedThreadIDs.delete(tid);
    loadedThreadIDs.add(tid);
    while (loadedThreadIDs.size > FLOWER_WARM_THREAD_DETAIL_LIMIT) {
      const selectedID = trimString(selectedThreadID());
      const evictedID = [...loadedThreadIDs].find((candidate) => candidate !== tid && candidate !== selectedID);
      if (!evictedID) return;
      evictThreadDetail(evictedID);
    }
  };
  const applyOptimisticPinnedState = (threadID: string, pinned: boolean) => {
    const tid = trimString(threadID);
    if (!tid || retiredThreadIDs.has(tid)) return;
    setThreads((items) => items.map((thread) => (
      thread.thread_id === tid
        ? {
            ...thread,
            ...(pinned ? { pinned_at_ms: Date.now() } : { pinned_at_ms: undefined }),
          }
        : thread
    )));
    threadLocalMutationRevision += 1;
  };
  const applyLiveBootstrap = (live: FlowerLiveBootstrap, reason: LiveBootstrapApplyReason = 'background_refresh'): FlowerThreadSnapshot => {
    const thread = projectFlowerLiveBootstrap(live);
    if (retiredThreadIDs.has(trimString(thread.thread_id))) {
      return threads().find((item) => item.thread_id === thread.thread_id) ?? thread;
    }
    if (!liveBootstrapIsCurrent(live, reason)) {
      return threads().find((item) => item.thread_id === thread.thread_id) ?? thread;
    }
    const previous = threads().find((item) => item.thread_id === thread.thread_id);
    setLivePosition(thread.thread_id, live.stream_generation, live.cursor);
    upsertThread(thread);
    rememberThreadDetail(thread.thread_id);
    reconcileApprovalDecisionHandoff(thread, live.stream_generation, live.cursor);
    if (
      previous
      && previous.model_id !== thread.model_id
      && !sameFlowerReasoningSelection(previous.reasoning_selection, thread.reasoning_selection)
    ) {
      notifySuccess('Reasoning adjusted for this model.');
    }
    return thread;
  };
  let queuedTurnReorderSequence = 0;
  const queuedTurnReorderEnabled = () => Boolean(
    props.adapter.reorderQueuedTurns
    && !selectedThreadReadOnly()
    && selectedCanonicalQueuedTurns().length > 1
    && queuedTurnReorder()?.phase !== 'saving'
    && !queuedTurnDelete()
  );
  const beginQueuedTurnDrag = (event: DragEvent & { currentTarget: HTMLDivElement }, queueID: string) => {
    if (!queuedTurnReorderEnabled()) {
      event.preventDefault();
      return;
    }
    const threadID = trimString(selectedThreadID());
    const orderedQueueIDs = selectedCanonicalQueuedTurns().map((turn) => trimString(turn.queue_id));
    const draggedQueueID = trimString(queueID);
    if (!threadID || !draggedQueueID || !orderedQueueIDs.includes(draggedQueueID)) {
      event.preventDefault();
      return;
    }
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedQueueID);
    setQueuedTurnReorder({
      threadID,
      draggedQueueID,
      originalQueueIDs: orderedQueueIDs,
      orderedQueueIDs,
      phase: 'dragging',
    });
  };
  const previewQueuedTurnDrop = (
    event: DragEvent & { currentTarget: HTMLDivElement },
    targetQueueID: string,
  ) => {
    const reorder = queuedTurnReorder();
    if (!reorder || reorder.phase !== 'dragging' || reorder.threadID !== selectedThreadID()) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.dataTransfer) return;
    event.dataTransfer.dropEffect = 'move';
    const bounds = event.currentTarget.getBoundingClientRect();
    const next = moveQueuedTurnID(
      reorder.orderedQueueIDs,
      reorder.draggedQueueID,
      targetQueueID,
      event.clientY >= bounds.top + bounds.height / 2,
    );
    if (next.every((queueID, index) => queueID === reorder.orderedQueueIDs[index])) return;
    setQueuedTurnReorder({ ...reorder, orderedQueueIDs: next });
  };
  const previewQueuedTurnDropAtEnd = (event: DragEvent & { currentTarget: HTMLDivElement }) => {
    if (event.target !== event.currentTarget) return;
    const reorder = queuedTurnReorder();
    if (!reorder || reorder.phase !== 'dragging' || reorder.threadID !== selectedThreadID()) return;
    event.preventDefault();
    if (!event.dataTransfer) return;
    event.dataTransfer.dropEffect = 'move';
    const next = [
      ...reorder.orderedQueueIDs.filter((queueID) => queueID !== reorder.draggedQueueID),
      reorder.draggedQueueID,
    ];
    if (next.every((queueID, index) => queueID === reorder.orderedQueueIDs[index])) return;
    setQueuedTurnReorder({ ...reorder, orderedQueueIDs: next });
  };
  const commitQueuedTurnReorder = (event: DragEvent) => {
    const reorder = queuedTurnReorder();
    if (!reorder || reorder.phase !== 'dragging' || reorder.threadID !== selectedThreadID()) return;
    event.preventDefault();
    const changed = reorder.orderedQueueIDs.some((queueID, index) => queueID !== reorder.originalQueueIDs[index]);
    if (!changed || !props.adapter.reorderQueuedTurns) {
      setQueuedTurnReorder(null);
      return;
    }
    const sequence = ++queuedTurnReorderSequence;
    setQueuedTurnReorder({ ...reorder, phase: 'saving' });
    void props.adapter.reorderQueuedTurns(reorder.threadID, reorder.orderedQueueIDs).then((live) => {
      if (sequence !== queuedTurnReorderSequence) return;
      applyLiveBootstrap(live, 'user_action');
      setQueuedTurnReorder(null);
    }).catch((error) => {
      if (sequence !== queuedTurnReorderSequence) return;
      setQueuedTurnReorder(null);
      notifyThreadActionError(getErrorMessage(error));
    });
  };
  const finishQueuedTurnDrag = () => {
    if (queuedTurnReorder()?.phase === 'dragging') setQueuedTurnReorder(null);
  };
  const deleteQueuedTurn = async (turn: FlowerQueuedTurn): Promise<void> => {
    const threadID = trimString(selectedThreadID());
    const queueID = trimString(turn.queue_id);
    if (
      !props.adapter.deleteQueuedTurn
      || !threadID
      || !queueID
      || queuedTurnDelete()
      || queuedTurnPromotingID()
      || queuedTurnReorder()?.phase === 'saving'
    ) return;
    setQueuedTurnReorder(null);
    setQueuedTurnDelete({ threadID, queueID });
    try {
      applyLiveBootstrap(await props.adapter.deleteQueuedTurn(threadID, queueID), 'user_action');
    } catch (error) {
      try {
        applyLiveBootstrap(await props.adapter.loadThread(threadID), 'background_refresh');
      } catch {
        // The existing live stream remains the canonical recovery path.
      }
      notifyThreadActionError(getErrorMessage(error));
    } finally {
      const deleting = queuedTurnDelete();
      if (deleting?.threadID === threadID && deleting.queueID === queueID) setQueuedTurnDelete(null);
    }
  };
  const queuedTurnPromotionBlocked = createMemo(() => {
    if (selectedThreadReadOnly() || selectedThreadHasRunningContextCompaction()) return true;
    const status = selectedThreadLiveStatus();
    return status === 'running' || status === 'waiting_approval' || status === 'waiting_user';
  });
  const promoteQueuedTurn = async (turn: FlowerQueuedTurn): Promise<void> => {
    const threadID = trimString(selectedThreadID());
    const queueID = trimString(turn.queue_id);
    if (!threadID || !queueID || queuedTurnPromotionBlocked() || queuedTurnPromotingID()) return;
    const clientRequestID = createFlowerClientRequestID();
    setQueuedTurnPromotingID(queueID);
    transitionPendingSubmission({
      kind: 'begin',
      submission: {
        clientRequestID,
        sessionKey: threadID,
        threadID,
        sourceQueueID: queueID,
        prompt: turn.prompt,
        attachmentNames: (turn.attachments ?? []).map((attachment) => trimString(attachment.name)).filter(Boolean),
        referenceLabels: [],
        phase: 'preparing',
        startedAtMS: Date.now(),
      },
    });
    transcriptScroll.startFollowing();
    scrollTranscriptToBottom({ smooth: false });
    requestTranscriptAnimationFrame(() => scrollTranscriptToBottom({ smooth: false }));
    try {
      const receipt = await props.adapter.launchTurn({
        client_request_id: clientRequestID,
        thread_id: threadID,
        prompt: turn.prompt,
        ...(turn.attachments?.length ? { attachment_ids: turn.attachments.map((attachment) => trimString(attachment.attachment_id)).filter(Boolean) } : {}),
        ...(turn.context_action ? { context_action: turn.context_action } : {}),
        source_followup_id: queueID,
      });
      if (trimString(receipt.thread_id) !== threadID) {
        throw new Error('Flower queued turn admission returned a different conversation.');
      }
      if (receipt.kind === 'start' || receipt.kind === 'admitting') {
        transitionPendingSubmission({
          kind: 'admission_accepted',
          clientRequestID,
          threadID,
          canonicalKind: receipt.kind,
          canonicalID: receipt.kind === 'start' ? receipt.turn_id : receipt.admission_id,
        });
      } else {
        transitionPendingSubmission({ kind: 'admission_started', clientRequestID });
      }
      void reloadSelectedThread(threadID, threadLoadSequence, 'user_action').catch(() => undefined);
      requestComposerFocus();
    } catch (error) {
      transitionPendingSubmission({ kind: 'admission_failed', clientRequestID });
      notifyThreadActionError(getErrorMessage(error));
    } finally {
      if (queuedTurnPromotingID() === queueID && pendingSubmission()?.clientRequestID !== clientRequestID) {
        setQueuedTurnPromotingID('');
      }
    }
  };
  const loadThreadBootstrap = (threadID: string, force = false): Promise<FlowerLiveBootstrap> => {
    const tid = trimString(threadID);
    const existing = force ? undefined : threadBootstrapRequests.get(tid);
    if (existing) return existing;
    const request = props.adapter.loadThread(tid);
    threadBootstrapRequests.set(tid, request);
    const clear = () => {
      if (threadBootstrapRequests.get(tid) === request) threadBootstrapRequests.delete(tid);
    };
    void request.then(clear, clear);
    return request;
  };
  const reloadSelectedThread = async (
    threadID: string,
    sequence = threadLoadSequence,
    reason: LiveBootstrapApplyReason = 'background_refresh',
  ): Promise<FlowerThreadSnapshot | null> => {
    const tid = trimString(threadID);
    if (!tid || retiredThreadIDs.has(tid)) return null;
    const live = await loadThreadBootstrap(tid, reason === 'user_action' || reason === 'resync_reload');
    if (retiredThreadIDs.has(tid) || sequence !== threadLoadSequence || selectedThreadID() !== tid) {
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

  const readAcknowledgementEligible = (threadID: string, sequence: number): boolean => {
    const tid = trimString(threadID);
    const presented = presentedSelection();
    return Boolean(
      tid
      && effectiveEngagement()
      && sidePanel() === 'chat'
      && sequence === threadLoadSequence
      && selectedThreadID() === tid
      && selectedThreadDetailID() === tid
      && loadingThreadID() !== tid
      && !loadError()
      && !threadLoadError()
      && presented?.threadID === tid
      && presented.sequence === sequence,
    );
  };

  const persistThreadRead = (threadID: string, snapshot: FlowerThreadActivitySnapshot, sequence: number) => {
    const tid = trimString(threadID);
    if (!tid || !readAcknowledgementEligible(tid, sequence)) return;
    const submittedSnapshotKey = flowerThreadReadSnapshotKey(snapshot);
    if (!submittedSnapshotKey || locallyReadSnapshots.get(tid) === submittedSnapshotKey) return;
    markThreadReadLocally(tid, snapshot);
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
        if (!readAcknowledgementEligible(tid, sequence)) return;
        persistThreadRead(tid, pendingSnapshot, sequence);
      });
  };

  createEffect(() => {
    const thread = selectedThread();
    const sequence = threadLoadSequence;
    if (!thread?.read_status.is_unread || !readAcknowledgementEligible(thread.thread_id, sequence)) return;
    persistThreadRead(thread.thread_id, thread.read_status.snapshot, sequence);
  });

  const writeClipboardText = async (value: string, label: string) => {
    const text = trimString(value);
    if (!text) return;
    await writeTextToClipboard(text);
    notifySuccess(copy().threadList.copied(label));
  };

  const openRenameDialog = (threadID: string, title: string, restore?: HTMLElement) => {
    setRenameThreadID(trimString(threadID));
    setRenameDraft(title);
    setRenameError('');
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

  const openDeleteDialog = (item: FlowerThreadListItem, restore?: HTMLElement) => {
    setDeleteTarget({ item, restore });
    setDeleteError('');
  };

  const closeDeleteDialog = () => {
    if (deleteSubmitting()) return;
    const restore = deleteTarget()?.restore;
    setDeleteTarget(null);
    setDeleteError('');
    restoreThreadMenuFocus(restore);
  };

  const submitRename = async () => {
    const threadID = renameThreadID();
    if (!threadID || !props.adapter.renameThread || renameUnchanged()) return;
    setRenameSaving(true);
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
    const shouldRestoreFocus = action !== 'rename' && action !== 'delete';
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
        case 'delete':
          if (!props.adapter.deleteThread) return;
          openDeleteDialog(item, restore);
          return;
        case 'stop':
          setThreadActionBusy({ threadID: item.thread_id, action });
          applyLiveBootstrap(await props.adapter.stopThread(item.thread_id), 'user_action');
          return;
        case 'pin':
          if (!props.adapter.setThreadPinned) return;
          {
            const threadID = item.thread_id;
            const pinned = !item.pinned;
            const sequence = (pinMutationSequences.get(threadID) ?? 0) + 1;
            pinMutationSequences.set(threadID, sequence);
            applyOptimisticPinnedState(threadID, pinned);
            setThreadActionBusy({ threadID, action });
            try {
              const live = await props.adapter.setThreadPinned(threadID, pinned);
              if (live) applyLiveBootstrap(live, 'user_action');
              if (pinMutationSequences.get(threadID) === sequence) {
                pinMutationSequences.delete(threadID);
              }
            } catch (error) {
              if (pinMutationSequences.get(threadID) === sequence) {
                applyOptimisticPinnedState(threadID, !pinned);
              }
              throw error;
            }
          }
          return;
        case 'fork':
          if (!props.adapter.forkThread) return;
          setThreadActionBusy({ threadID: item.thread_id, action });
          {
            const clientRequestID = forkRequestIDs.get(item.thread_id) ?? createFlowerClientRequestID();
            forkRequestIDs.set(item.thread_id, clientRequestID);
            const forked = applyLiveBootstrap(await props.adapter.forkThread(item.thread_id, clientRequestID));
            forkRequestIDs.delete(item.thread_id);
            await loadAndSelectThread(forked.thread_id);
          }
          return;
        default:
          return;
      }
    } catch (error) {
      notifyThreadActionError(getErrorMessage(error));
    } finally {
      setThreadActionBusy(null);
      if (shouldRestoreFocus) {
        restoreThreadMenuFocus(restore);
      }
    }
  };

  const loadAndSelectThread = async (threadID: string, revalidateWarmDetail = false) => {
    const tid = trimString(threadID);
    if (!tid || retiredThreadIDs.has(tid)) return;
    const focusOwner = typeof document === 'undefined' ? null : document.activeElement;
    cancelDeferredThreadSelection();
    closeSubagentOverlays();
    const sequence = ++threadLoadSequence;
    cancelPresentedSelectionSchedule();
    setPresentedSelection(null);
    const existing = threads().find((thread) => thread.thread_id === tid) ?? null;
    const detailAvailable = Boolean(existing && (loadedThreadIDs.has(tid) || threadHasLoadedDetail(existing)));
    const detailWarm = Boolean(existing && loadedThreadIDs.has(tid));
    transcriptScroll.startFollowing();
    beginSelectedThreadTailReveal(tid, sequence);
    if (detailAvailable) {
      setSelectedThreadWithDetail(tid);
      scheduleThreadSelectionContentPresented(tid);
    } else {
      setSelectedThreadID(tid);
      setSidebarActiveThreadID(tid);
    }
    scheduleSelectedThreadTailReveal(tid, sequence);
    setThreadLoadError('');
    returnToChat();
    if (existing?.read_status.is_unread) {
      persistThreadRead(tid, existing.read_status.snapshot, sequence);
    }
    if (detailWarm) {
      rememberThreadDetail(tid);
      requestComposerFocus(focusOwner);
      if (revalidateWarmDetail) {
        void reloadSelectedThread(tid, sequence, 'background_refresh').catch((error) => {
          if (sequence === threadLoadSequence && selectedThreadDetailMatches(tid)) {
            setThreadLoadError(getErrorMessage(error));
          }
        });
      }
      return;
    }
    setLoadingThreadID(tid);
    try {
      const live = await loadThreadBootstrap(tid, true);
      if (sequence !== threadLoadSequence || selectedThreadID() !== tid) {
        if (loadingThreadID() === tid) setLoadingThreadID('');
        return;
      }
      const thread = applyLiveBootstrap(live, 'initial_load');
      if (thread.read_status.is_unread) {
        persistThreadRead(tid, thread.read_status.snapshot, sequence);
      }
      setSelectedThreadWithDetail(thread.thread_id);
      scheduleThreadSelectionContentPresented(thread.thread_id);
      setLoadingThreadID('');
      setTranscriptLayoutRevision((revision) => revision + 1);
      if (selectedThreadTailRevealIsCurrent(thread.thread_id, sequence)) {
        scheduleSelectedThreadTailReveal(thread.thread_id, sequence);
      } else {
        scrollSelectedThreadToLatestAfterLayout(thread.thread_id, sequence);
      }
      requestComposerFocus(focusOwner);
    } catch (error) {
      if (sequence !== threadLoadSequence || selectedThreadID() !== tid) {
        if (loadingThreadID() === tid) setLoadingThreadID('');
        return;
      }
      if (loadingThreadID() === tid) setLoadingThreadID('');
      if (selectedThreadTailRevealIsCurrent(tid, sequence)) {
        cancelSelectedThreadTailReveal();
      }
      cancelThreadSelectionTransaction();
      setThreadLoadError(getErrorMessage(error));
    }
  };
  const scheduleThreadSelectionAfterPaint = (threadID: string) => {
    const tid = trimString(threadID);
    if (!tid) return;
    if (typeof window === 'undefined') {
      void loadAndSelectThread(tid);
      return;
    }
    cancelDeferredThreadSelection();
    const token = deferredThreadSelectionToken;
    deferredThreadSelectionFrame = requestTranscriptAnimationFrame(() => {
      deferredThreadSelectionFrame = 0;
      deferredThreadSelectionTimer = window.setTimeout(() => {
        deferredThreadSelectionTimer = undefined;
        if (token !== deferredThreadSelectionToken) return;
        const transaction = threadSelectionTransaction;
        if (transaction?.value === tid) {
          emitThreadSelectionEvent(transaction, 'intent_presented');
          emitThreadSelectionEvent(transaction, 'commit_started');
        }
        void loadAndSelectThread(tid);
        if (transaction?.value === tid && threadSelectionTransaction === transaction) {
          emitThreadSelectionEvent(transaction, 'committed');
        }
      }, 0);
    });
  };

  const focusThreadFromRequest = async (requestID: string, threadID: string) => {
    const tid = trimString(threadID);
    if (!tid) {
      props.onFocusThreadRequestConsumed?.(requestID);
      return;
    }
    cancelThreadSelectionTransaction();
    props.onFocusThreadRequestConsumed?.(requestID);
    await loadAndSelectThread(tid, true);
  };

  const refreshSelectedThread = async (threadID: string) => {
    const tid = trimString(threadID);
    try {
      await reloadSelectedThread(tid, threadLoadSequence, 'user_action');
    } catch (error) {
      if (selectedThreadDetailMatches(tid)) {
        setThreadLoadError(getErrorMessage(error));
      }
    }
  };

  const performThreadsRefresh = async (): Promise<boolean> => {
    const refreshSequence = ++threadsRefreshSequence;
    const startedMutationRevision = threadLocalMutationRevision;
    setThreadsRefreshing(true);
    try {
      const next = (await props.adapter.listThreads()).filter((thread) => !retiredThreadIDs.has(trimString(thread.thread_id)));
      if (refreshSequence !== threadsRefreshSequence) {
        return false;
      }
      setLoadError('');
      const selectedID = selectedThreadID();
      const previousSelected = threads().find((thread) => thread.thread_id === selectedID) ?? null;
      const selectedSummary = next.find((thread) => thread.thread_id === selectedID) ?? null;
      const selectedDetailCurrent = !selectedID || selectedThreadDetailID() === selectedID;
      const pendingSelectedMissing = Boolean(selectedID && !selectedSummary && !selectedDetailCurrent);
      if (pendingSelectedMissing) {
        cancelDeferredThreadSelection();
        cancelThreadSelectionTransaction();
        closeSubagentOverlays();
        setSelectedThreadID('');
        setSelectedThreadDetailID('');
        setSidebarActiveThreadID('');
      }
      if (selectedID && selectedDetailCurrent && selectedSummary?.read_status.is_unread) {
        persistThreadRead(selectedID, selectedSummary.read_status.snapshot, threadLoadSequence);
      }
      let mergedThreads: readonly FlowerThreadSnapshot[] = [];
      setThreads((current) => {
        const currentWithoutRetired = current.some((thread) => retiredThreadIDs.has(trimString(thread.thread_id)))
          ? current.filter((thread) => !retiredThreadIDs.has(trimString(thread.thread_id)))
          : current;
        mergedThreads = mergeFlowerThreadListRefresh(
          currentWithoutRetired,
          next,
          {
            selectedThreadID: pendingSelectedMissing ? '' : selectedID,
            preserveMissingCurrentThreads: startedMutationRevision !== threadLocalMutationRevision && !pendingSelectedMissing,
            sameThreadSnapshot,
          },
        );
        if (mergedThreads.some((thread) => retiredThreadIDs.has(trimString(thread.thread_id)))) {
          mergedThreads = mergedThreads.filter((thread) => !retiredThreadIDs.has(trimString(thread.thread_id)));
        }
        return mergedThreads;
      });
      const mergedSelected = mergedThreads.find((thread) => thread.thread_id === selectedID) ?? null;
      setSelectedThreadID((current) => {
        if (current && !mergedThreads.some((thread) => thread.thread_id === current)) {
          cancelDeferredThreadSelection();
          cancelThreadSelectionTransaction();
          closeSubagentOverlays();
          setSelectedThreadDetailID('');
          setSidebarActiveThreadID('');
          return '';
        }
        return current;
      });
      if (
        effectiveEngagement()
        && selectedID
        && previousSelected
        && selectedSummary
        && mergedSelected
        && selectedDetailCurrent
        && (
          previousSelected.updated_at_ms !== mergedSelected.updated_at_ms
          || previousSelected.status !== mergedSelected.status
          || flowerThreadReadSnapshotKey(previousSelected.read_status.snapshot) !== flowerThreadReadSnapshotKey(mergedSelected.read_status.snapshot)
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

  // Summary events can arrive in bursts while a run is thinking. Coalesce the
  // list reconciliation and never allow overlapping full-list requests.
  const refreshThreads = (): Promise<boolean> => {
    if (threadsRefreshRequest) return threadsRefreshRequest;
    const request = performThreadsRefresh();
    threadsRefreshRequest = request;
    void request.then(
      () => {
        if (threadsRefreshRequest === request) threadsRefreshRequest = null;
      },
      () => {
        if (threadsRefreshRequest === request) threadsRefreshRequest = null;
      },
    );
    return request;
  };
  const scheduleLiveSummaryRefresh = () => {
    if (liveSummaryRefreshTimer !== undefined) return;
    if (typeof window === 'undefined') {
      void refreshThreads();
      return;
    }
    liveSummaryRefreshTimer = window.setTimeout(() => {
      liveSummaryRefreshTimer = undefined;
      void refreshThreads();
    }, 500);
  };

  const loadSurface = async () => {
    try {
      const next = await props.adapter.loadSettings();
      setSnapshot(next);
      setLoadError('');
      await resolveHandlerDecision().catch(() => undefined);
      await refreshThreads();
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

  createEffect(on(
    foregroundEngagementRequested,
    (engaged, previouslyEngaged) => {
      if (!engaged) {
        engagementBootstrapSequence += 1;
        setEngagementBootstrapReady(false);
        cancelPresentedSelectionSchedule();
        setPresentedSelection(null);
        return;
      }
      if (previouslyEngaged) return;
      const threadID = trimString(selectedThreadID());
      if (!threadID) {
        setEngagementBootstrapReady(true);
        return;
      }
      const sequence = threadLoadSequence;
      const bootstrapSequence = ++engagementBootstrapSequence;
      setEngagementBootstrapReady(false);
      cancelPresentedSelectionSchedule();
      setPresentedSelection(null);
      untrack(() => {
        void reloadSelectedThread(threadID, sequence, 'background_refresh')
          .then(() => {
            if (
              bootstrapSequence !== engagementBootstrapSequence
              || !foregroundEngagementRequested()
              || sequence !== threadLoadSequence
              || selectedThreadID() !== threadID
              || !!loadError()
              || !!threadLoadError()
            ) return;
            setEngagementBootstrapReady(true);
            schedulePresentedSelection(threadID, sequence);
          }, (error) => {
            if (sequence === threadLoadSequence && selectedThreadID() === threadID) {
              setThreadLoadError(getErrorMessage(error));
            }
          });
      });
    },
    { defer: true },
  ));

  createEffect(() => {
    if (composerFocusRevision() <= 0) return;
    scheduleComposerFocus();
  });

  const applyFlowerLiveStreamEnvelope = async (
    envelope: FlowerLiveStreamEnvelope,
    selectedID: string,
    sequence: number,
  ): Promise<'continue' | 'resync'> => {
    if (envelope.kind === 'ready') {
      // Ready advertises server high-water marks; only applied replay batches advance local cursors.
      return 'continue';
    }
    if (envelope.kind === 'resync_required') {
      liveSummaryCursor = 0;
      liveSummaryGeneration = liveStreamGenerationValue(envelope.stream_generation);
      await refreshThreads();
      if (selectedThreadID() === selectedID && sequence === threadLoadSequence) {
        await reloadSelectedThread(selectedID, sequence, 'resync_reload');
      }
      return 'resync';
    }
    if (envelope.kind === 'viewer.read_state') {
      const threadID = trimString(envelope.thread_id);
      if (threadID && envelope.read_status && !retiredThreadIDs.has(threadID)) {
        clearLocalReadVisibility(threadID);
        applyThreadReadStatus(threadID, envelope.read_status);
      }
      return 'continue';
    }
    const events = envelope.events ?? [];
    if (events.length === 0) {
      if (envelope.kind === 'summary.batch') {
        liveSummaryCursor = Math.max(liveSummaryCursor, liveCursorValue(envelope.through_seq));
      }
      return 'continue';
    }
    await yieldLiveEventRenderFrame();
    if (sequence !== threadLoadSequence || selectedThreadID() !== selectedID || !documentVisible()) {
      return 'continue';
    }
    const projected = new Map<string, FlowerThreadSnapshot>();
    const advancesThreadCursor = envelope.kind === 'thread.batch';
    let shouldRefreshSummaries = false;
    let shouldResyncSelectedThread = false;
    let shouldScrollTail = false;
    let nextReadSnapshot: FlowerThreadActivitySnapshot | null = null;
    for (const event of events) {
      const threadID = trimString(event.thread_id);
      if (!threadID || retiredThreadIDs.has(threadID)) continue;
      const current = projected.get(threadID) ?? threads().find((thread) => thread.thread_id === threadID) ?? null;
      if (!current) {
        shouldRefreshSummaries = true;
        continue;
      }
      const currentCursor = liveCursorValue(liveCursors.get(threadID));
      const result = applyFlowerLiveEvent(current, currentCursor, event);
      if (result.resyncRequired) {
        if (threadID === selectedID && envelope.kind === 'thread.batch') {
          shouldResyncSelectedThread = true;
        } else {
          shouldRefreshSummaries = true;
        }
        continue;
      }
      projected.set(threadID, result.thread);
      // Summary replay has its own cursor. Its events retain their originating
      // thread sequence for identity, but must not consume detail replay.
      if (advancesThreadCursor) {
        setLivePosition(threadID, envelope.stream_generation, result.cursor);
      }
      if (threadID === selectedID) {
        shouldScrollTail ||= Boolean(result.tailKey && result.tailLength > 0) || event.kind === 'timeline.replaced';
        if (result.thread.read_status.is_unread) {
          nextReadSnapshot = result.thread.read_status.snapshot;
        }
      }
    }
    batch(() => {
      for (const thread of projected.values()) upsertThread(thread);
    });
    for (const thread of projected.values()) {
      reconcileApprovalDecisionHandoff(
        thread,
        liveStreamGenerations.get(thread.thread_id),
        liveCursors.get(thread.thread_id),
      );
    }
    if (shouldScrollTail) scheduleTranscriptTailScroll();
    if (nextReadSnapshot) persistThreadRead(selectedID, nextReadSnapshot, sequence);
    if (envelope.kind === 'summary.batch') {
      liveSummaryGeneration = liveStreamGenerationValue(envelope.stream_generation);
      liveSummaryCursor = Math.max(liveSummaryCursor, liveCursorValue(envelope.through_seq));
    }
    if (shouldRefreshSummaries) scheduleLiveSummaryRefresh();
    if (shouldResyncSelectedThread && selectedThreadID() === selectedID && sequence === threadLoadSequence) {
      // A detail event can be valid on the server but not safely applicable to
      // the current client draft (for example, an activity timeline arriving
      // immediately after an approval decision). Replace the draft from the
      // canonical bootstrap before continuing the live cursor.
      await reloadSelectedThread(selectedID, sequence, 'resync_reload');
      return 'resync';
    }
    return 'continue';
  };

  createEffect(() => {
    const connect = props.adapter.connectLiveStream;
    const threadID = selectedThreadID();
    const visible = documentVisible();
    if (!connect || !threadID || !visible) return;
    const controller = new AbortController();
    let disposed = false;
    let reconnectAttempt = 0;
    const waitForReconnect = async (delayMs: number) => new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, delayMs);
      controller.signal.addEventListener('abort', () => {
        window.clearTimeout(timer);
        resolve();
      }, { once: true });
    });
    const run = async () => {
      while (!disposed && !controller.signal.aborted && documentVisible() && selectedThreadID() === threadID) {
        const readyStartedAt = Date.now();
        try {
          for await (const envelope of connect({
            thread_id: threadID,
            thread_generation: liveStreamGenerationValue(liveStreamGenerations.get(threadID)),
            thread_after_seq: liveCursorValue(liveCursors.get(threadID)),
            summary_generation: liveSummaryGeneration,
            summary_after_seq: liveSummaryCursor,
            signal: controller.signal,
          })) {
            if (disposed || controller.signal.aborted) return;
            const outcome = await applyFlowerLiveStreamEnvelope(envelope, threadID, threadLoadSequence);
            if (outcome === 'resync') break;
          }
          if (Date.now() - readyStartedAt >= 30_000) reconnectAttempt = 0;
        } catch (error) {
          if (disposed || controller.signal.aborted) return;
          const status = Number((error as { status?: unknown })?.status ?? 0);
          if (status === 401 || status === 403) {
            setThreadLoadError(getErrorMessage(error));
            return;
          }
          if (status === 429) {
            const retryAfterSeconds = Number((error as { retryAfter?: unknown })?.retryAfter ?? 0);
            if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
              await waitForReconnect(Math.min(30_000, retryAfterSeconds * 1000));
              continue;
            }
          }
        }
        const baseDelays = [250, 500, 1_000, 2_000, 4_000, 10_000] as const;
        const base = baseDelays[Math.min(reconnectAttempt, baseDelays.length - 1)];
        reconnectAttempt += 1;
        const jittered = Math.round(base * (0.8 + Math.random() * 0.4));
        await waitForReconnect(jittered);
      }
    };
    void run();
    onCleanup(() => {
      disposed = true;
      controller.abort();
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
    const request = selectedInputRequest();
    const signature = request ? `${currentComposerSessionKey()}:${request.prompt_id}` : '';
    const firstQuestion = request?.questions[0] ?? null;
    updateCurrentComposerSessionDraft((draft) => ({
      ...draft,
      inputPromptSignature: signature,
      inputDrafts: request && draft.inputPromptSignature !== signature ? {} : draft.inputDrafts,
      activeInputQuestionID: request
        ? (
          draft.activeInputQuestionID && request.questions.some((question) => question.id === draft.activeInputQuestionID)
            ? draft.activeInputQuestionID
            : (firstQuestion?.id ?? '')
        )
        : '',
    }));
  });

  const saveSettingsMutation = async (mutation: () => Promise<FlowerSettingsSnapshot>) => {
    setSaveError('');
    setSettingsSaving(true);
    try {
      const next = await mutation();
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

  const saveDefaultPermission = async (permissionType: FlowerPermissionType) => {
    try {
      return await saveSettingsMutation(() => props.adapter.saveDefaultPermission(permissionType));
    } catch (error) {
      notifyPermissionError(getErrorMessage(error));
      throw error;
    }
  };

  const saveModelProfile = (draft: FlowerSettingsDraft) => (
    saveSettingsMutation(() => props.adapter.saveModelProfile(draft))
  );

  const returnToChat = () => {
    setSidePanel('chat');
  };

  const openSettings = () => {
    closeSubagentOverlays();
    setSidePanel('settings');
  };

  createEffect(() => {
    const request = Math.max(0, Math.floor(Number(props.settingsFocusRequest ?? 0)));
    if (request <= consumedSettingsFocusRequest) return;
    consumedSettingsFocusRequest = request;
    openSettings();
  });

  const refreshModelSource = async () => {
    if (modelSourceRefreshing()) return;
    setModelSourceRefreshing(true);
    try {
      setSnapshot(await props.adapter.loadSettings());
      setLoadError('');
    } catch (error) {
      notifyComposerError(getErrorMessage(error));
    } finally {
      setModelSourceRefreshing(false);
    }
  };

  const updateSubagentDropdownPosition = () => {
    const rect = subagentTriggerRef?.getBoundingClientRect();
    if (!rect) return;
    setSubagentDropdownPosition({
      x: Math.max(8, rect.right - SUBAGENT_DROPDOWN_ESTIMATED_SIZE.width),
      y: rect.bottom + 8,
    });
  };

  const subagentDropdownRows = (): HTMLButtonElement[] => (
    Array.from(subagentDropdownRef?.querySelectorAll<HTMLButtonElement>('button[data-flower-subagent-row]') ?? [])
  );

  const closeSubagentDropdown = (restoreFocus: boolean) => {
    setSubagentDropdownOpen(false);
    if (restoreFocus) subagentTriggerRef?.focus();
  };

  const handleSubagentDropdownKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSubagentDropdown(true);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const activeRow = subagentDropdownRows().find((row) => row === document.activeElement);
      if (!activeRow) return;
      event.preventDefault();
      event.stopPropagation();
      activeRow.click();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

    const rows = subagentDropdownRows();
    if (rows.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const activeIndex = rows.findIndex((row) => row === document.activeElement);
    let nextIndex = activeIndex;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = rows.length - 1;
    if (event.key === 'ArrowDown') nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % rows.length;
    if (event.key === 'ArrowUp') nextIndex = activeIndex < 0 ? rows.length - 1 : (activeIndex - 1 + rows.length) % rows.length;
    rows[nextIndex]?.focus();
  };

  const openSubagents = () => {
    updateSubagentDropdownPosition();
    setSubagentDropdownOpen((open) => !open);
  };

  const openSubagentDetail = async (item: FlowerSubagentPanelItem) => {
    const parentID = trimString(selectedThread()?.thread_id);
    const childID = trimString(item.threadID);
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
    // Sending disables the textarea while admission is in flight, which makes
    // the browser blur it. Keep the original owner so focus can be restored
    // only when the user has not moved to another control meanwhile.
    const focusOwner = typeof document === 'undefined' ? null : document.activeElement;
    const focusSelectionSequence = threadLoadSequence;
    const inspection = inspectFlowerText(promptInput);
    if (!inspection) {
      notifyComposerError(attachmentCopy().invalidText);
      return;
    }
    if (!snapshot()) {
      notifyComposerError(copy().chat.loadingSettings);
      return;
    }
    if (!readyForChat()) {
      notifyComposerError(copy().chat.configureProviderBeforeChat);
      return;
    }
    if (selectedThreadDetailPending()) {
      notifyComposerError(copy().chat.threadLoading);
      return;
    }
    if (selectedThreadReadOnly()) {
      notifyComposerError(selectedThreadReadOnlyDisplay());
      return;
    }
    if (!handlerAllowsSubmitIntent()) {
      const state = handlerState();
      notifyComposerError('message' in state ? state.message : copy().chat.handlerStillStarting);
      return;
    }
    const operation = currentComposerDraftOperation();
    if (!composerDraftOperationCurrent(operation)) return;
    const clientRequestID = operation.session.snapshot().value.client_request_id || createFlowerClientRequestID();
    const operationMode = inspection.codePoints > FLOWER_INLINE_TEXT_CODE_POINT_LIMIT
      ? 'preparing_long_text_submission' as const
      : 'admission_in_flight' as const;
    const selectedID = trimString(selectedThreadID());
    const frozenModelID = selectedComposerModelID();
    const frozenPermissionType = composerPermissionType();
    const frozenReasoningSelection = serializeFlowerReasoningSelection(composerLaunchReasoningSelection());
    const frozenWorkingDir = draftWorkingDirectory();
    const frozenCapabilityRevision = currentAttachmentSnapshot().capability?.revision;
    const operationClaim = operation.session.mutate((value) => (
      value.client_request_id && value.client_request_id !== clientRequestID
        ? value
        : {
          ...value,
          text: promptInput,
          mode: operationMode,
          client_request_id: clientRequestID,
          admission_started: false,
          model_id: frozenModelID,
          permission_type: frozenPermissionType,
          reasoning_selection: frozenReasoningSelection,
          working_dir: frozenWorkingDir,
          capability_revision: frozenCapabilityRevision,
        }
    ));
    if (
      !operationClaim
      || operationClaim.kind !== 'committed'
      || operationClaim.snapshot.value.client_request_id !== clientRequestID
      || !composerDraftOperationCurrent(operation)
    ) return;
    const launchController = operation.controller;
    const launchSessionKey = operation.sessionKey;
    const frozenDraft = operationClaim.snapshot.value;
    const frozenDraftAttachmentLocalIDs = new Set(frozenDraft.attachments.map((item) => item.local_id));
    const frozenAttachmentLocalIDs = new Set(
      launchController.snapshot().items
        .filter((item) => frozenDraftAttachmentLocalIDs.has(item.local_id) && item.status === 'staged_ready')
        .map((item) => item.local_id),
    );
    const draftReasoningSelection = !selectedID ? frozenDraft.reasoning_selection : undefined;
    const draftModelID = !selectedID ? frozenDraft.model_id ?? '' : '';
    const launchModelID = frozenDraft.model_id ?? frozenModelID;
    const draftPermissionType = !selectedID ? frozenDraft.permission_type : undefined;
    const draftWorkingDir = !selectedID ? frozenDraft.working_dir ?? '' : '';
    const launchContextCurrent = () => (
      composerDraftOperationCurrent(operation)
      && trimString(selectedThreadID()) === selectedID
      && selectedComposerModelID() === launchModelID
    );
    const ordinaryTurnContextCurrent = () => (
      !selectedInputRequest()
      && !selectedComposerApprovalDisplayAction()
      && !selectedThreadReadOnly()
      && !selectedThreadDetailPending()
      && !surfaceWarmupActive()
    );
    let cancelRequested = false;
    const submissionCurrent = () => (
      !cancelRequested
      && launchContextCurrent()
      && ordinaryTurnContextCurrent()
      && operation.session.snapshot().value.client_request_id === clientRequestID
    );
    let preparedLongTextLocalID = '';
    let consumedAttachmentLocalIDs: readonly string[] = [];
    const attachmentItemsForSubmission = (snapshot: FlowerAttachmentControllerSnapshot) => snapshot.items.filter((item) => (
      frozenAttachmentLocalIDs.has(item.local_id) || item.local_id === preparedLongTextLocalID
    ));
    const cancelLongTextSubmission = () => {
      cancelRequested = true;
      if (preparedLongTextLocalID) launchController.cancel(preparedLongTextLocalID);
      setLongTextPreparing(false);
    };
    cancelActiveLongTextSubmission = cancelLongTextSubmission;
    const clearAcceptedComposerDraft = (...sessionKeys: string[]) => {
      launchController.consumeReady(consumedAttachmentLocalIDs);
      const remainingAttachments = flowerComposerDraftAttachments(launchController.snapshot().items);
      const canonicalSessionKey = trimString(sessionKeys[0]);
      if (
        remainingAttachments.length > 0
        && launchSessionKey === PENDING_NEW_THREAD_ID
        && canonicalSessionKey
        && canonicalSessionKey !== launchSessionKey
      ) {
        draftCoordinator.moveScope(launchSessionKey, canonicalSessionKey);
      }
      const acceptedSessionKeys = new Set([
        launchSessionKey,
        ...sessionKeys,
      ].map((value) => trimString(value) || PENDING_NEW_THREAD_ID));
      const retainedSessionKey = canonicalSessionKey || launchSessionKey;
      if (composerDraftOperationActive(operation)) {
        for (const sessionKey of acceptedSessionKeys) draftSessionFor(sessionKey).mutate((value) => ({
          ...value,
          text: '',
          attachments: sessionKey === retainedSessionKey ? remainingAttachments : [],
          references: [],
          mode: 'ordinary',
          client_request_id: undefined,
          admission_started: undefined,
          prepared_long_text_local_id: undefined,
          prepared_long_text_attachment_id: undefined,
        }));
      }
      for (const sessionKey of acceptedSessionKeys) {
        updateComposerSessionDraft(sessionKey, (draft) => ({
          ...draft,
          chatDraft: '',
          references: [],
          inputPromptSignature: '',
          inputDrafts: {},
          activeInputQuestionID: '',
          ...(draft.reasoningOverride ? { reasoningOverride: undefined } : {}),
        }));
      }
    };
    let preserveClientRequestID = false;
    let retainPendingSubmission = false;
    transitionPendingSubmission({
      kind: 'begin',
      submission: {
        clientRequestID,
        sessionKey: launchSessionKey,
        ...(selectedID ? { threadID: selectedID } : {}),
        prompt: promptInput,
        attachmentNames: frozenDraft.attachments
          .filter((attachment) => frozenAttachmentLocalIDs.has(attachment.local_id))
          .map((attachment) => attachment.name),
        referenceLabels: frozenDraft.references.map((reference) => reference.label || reference.path),
        phase: 'preparing',
        startedAtMS: Date.now(),
      },
    });
    setChatRunning(true);
    try {
      let attachmentSnapshot = launchController.snapshot();
      let attachmentItems = attachmentItemsForSubmission(attachmentSnapshot);
      let launchStagingScope = attachmentSnapshot.staging_scope;
      if (attachmentItems.length > 0 || inspection.codePoints > FLOWER_INLINE_TEXT_CODE_POINT_LIMIT) {
        if (
          !launchModelID
          || !props.adapter.loadAttachmentCapability
          || !props.adapter.createAttachmentStagingScope
          || !props.adapter.uploadAttachment
        ) {
          notifyComposerError(attachmentCopy().unavailable);
          return;
        }
        const capabilitySequence = ++attachmentCapabilitySequence;
        try {
          const capability = await props.adapter.loadAttachmentCapability(launchModelID);
          if (!submissionCurrent() || capabilitySequence !== attachmentCapabilitySequence) return;
          launchController.setCapability(capability.model_id === launchModelID ? capability : null);
        } catch {
          if (submissionCurrent() && capabilitySequence === attachmentCapabilitySequence) {
            launchController.setCapability(null);
            notifyComposerError(attachmentCopy().unavailable);
          }
          return;
        }
        try {
          launchStagingScope = await ensureAttachmentStagingScope(launchSessionKey);
        } catch {
          notifyComposerError(attachmentCopy().unavailable);
          return;
        }
        attachmentSnapshot = launchController.snapshot();
        attachmentItems = attachmentItemsForSubmission(attachmentSnapshot);
      }
      if (!submissionCurrent()) return;
      if (attachmentItems.filter((item) => frozenAttachmentLocalIDs.has(item.local_id)).length !== frozenAttachmentLocalIDs.size) return;
      if (attachmentItems.some((item) => item.status !== 'staged_ready')) return;
      if (inspection.codePoints > FLOWER_INLINE_TEXT_CODE_POINT_LIMIT) {
        if (!attachmentSnapshot.capability?.supports_long_text) {
          notifyComposerError(attachmentCopy().unavailable);
          return;
        }
        setLongTextPreparing(true);
        const preparedLongText = launchController.addLongText(promptInput);
        if (preparedLongText.kind !== 'accepted') {
          notifyComposerError(attachmentCopy().unavailable);
          return;
        }
        preparedLongTextLocalID = preparedLongText.local_id;
        await launchController.waitForIdle();
        if (!submissionCurrent()) {
          launchController.remove(preparedLongTextLocalID);
          preparedLongTextLocalID = '';
          return;
        }
        attachmentSnapshot = launchController.snapshot();
        attachmentItems = attachmentItemsForSubmission(attachmentSnapshot);
        const prepared = attachmentItems.find((item) => item.local_id === preparedLongTextLocalID);
        if (prepared?.status !== 'staged_ready') {
          launchController.remove(preparedLongTextLocalID);
          preparedLongTextLocalID = '';
          notifyComposerError(attachmentCopy().unavailable);
          return;
        }
        const transitioned = operation.session.mutate((value) => (
          value.client_request_id === clientRequestID
            ? {
              ...value,
              mode: 'admission_in_flight',
              attachments: attachmentItems.map((item) => ({
                local_id: item.local_id,
                source: item.source,
                name: item.name,
                mime_type: item.mime_type,
                size_bytes: item.size_bytes,
                upload_request_id: item.request_id,
                attempt_state: item.status,
                ...(item.staged ? { staged: item.staged } : {}),
              })),
              prepared_long_text_local_id: prepared.local_id,
              prepared_long_text_attachment_id: prepared.staged?.attachment_id,
            }
            : value
        ));
        if (
          transitioned.kind !== 'committed'
          || transitioned.snapshot.value.client_request_id !== clientRequestID
          || !submissionCurrent()
        ) {
          launchController.remove(preparedLongTextLocalID);
          preparedLongTextLocalID = '';
          return;
        }
        setLongTextPreparing(false);
      }
      const prompt = inspection.codePoints > FLOWER_INLINE_TEXT_CODE_POINT_LIMIT ? '' : promptInput;
      const readyItems = attachmentItems.filter((item) => item.status === 'staged_ready');
      const attachmentIDs = flowerAttachmentIDs(readyItems);
      launchStagingScope = attachmentSnapshot.staging_scope ?? launchStagingScope;
      if (attachmentIDs.length > 0 && !launchStagingScope) {
        notifyComposerError(attachmentCopy().unavailable);
        return;
      }
      const frozenReferences = frozenDraft.references;
      if (!prompt && attachmentIDs.length === 0 && frozenReferences.length === 0) {
        notifyComposerError(copy().chat.enterMessageBeforeSending);
        return;
      }
      consumedAttachmentLocalIDs = readyItems.map((item) => item.local_id);
      if (selectedID) cancelDeferredThreadSelection();
      if (!submissionCurrent()) return;
      transcriptScroll.startFollowing();
      let receipt: FlowerTurnLaunchReceipt;
      try {
        const decision = currentHandlerDecision() ?? await resolveHandlerDecision();
        if (!submissionCurrent()) return;
        if (!decision.selected_handler || decision.blocker || decision.route === 'blocked') {
          if (preparedLongTextLocalID) launchController.remove(preparedLongTextLocalID);
          if (composerSessionStillCurrent(launchSessionKey)) {
            notifyComposerError(decision.blocker?.message || copy().chat.handlerStillStarting);
          }
          return;
        }
        if (!submissionCurrent()) return;
        const admission = operation.session.mutate((value) => (
          value.client_request_id === clientRequestID
            ? { ...value, admission_started: true }
            : value
        ));
        if (
          admission.kind !== 'committed'
          || admission.snapshot.value.client_request_id !== clientRequestID
          || admission.snapshot.value.admission_started !== true
          || !submissionCurrent()
        ) return;
        transitionPendingSubmission({ kind: 'admission_started', clientRequestID });
        const contextAction: ContextActionEnvelope | undefined = frozenReferences.length > 0
          ? {
            schema_version: CONTEXT_ACTION_SCHEMA_VERSION,
            action_id: 'assistant.ask.flower',
            provider: 'flower',
            target: { target_id: 'current', locality: 'auto' },
            source: { surface: 'flower_composer' },
            context: frozenReferences.map((reference) => ({
              kind: 'file_path' as const,
              path: reference.path,
              is_directory: reference.kind === 'directory',
            })),
            presentation: { label: copy().chat.titleFallback, priority: 100 },
          }
          : undefined;
        const returnedReceipt = await props.adapter.launchTurn({
          client_request_id: clientRequestID,
          thread_id: selectedID || undefined,
          ...(launchStagingScope ? { staging_scope: launchStagingScope } : {}),
          prompt,
          ...(attachmentIDs.length > 0 ? { attachment_ids: attachmentIDs } : {}),
          ...(contextAction ? { context_action: contextAction } : {}),
          decision: selectedID ? null : decision,
          ...(!selectedID && draftPermissionType ? { permission_type: draftPermissionType } : {}),
          ...(!selectedID && draftModelID ? { model_id: draftModelID } : {}),
          ...(!selectedID && draftReasoningSelection ? { reasoning_selection: draftReasoningSelection } : {}),
          ...(!selectedID && draftWorkingDir ? { working_dir: draftWorkingDir } : {}),
        });
        if (trimString(returnedReceipt.client_request_id) !== clientRequestID) {
          throw flowerTurnAdmissionUncertainFailure(
            new Error('Flower turn admission returned a different client request identity.'),
            clientRequestID,
            {
              thread_id: returnedReceipt.thread_id,
              ...(returnedReceipt.kind === 'queued'
                ? { queue_id: returnedReceipt.queue_id }
                : returnedReceipt.kind === 'admitting'
                ? { admission_id: returnedReceipt.admission_id }
                : { turn_id: returnedReceipt.turn_id }),
            },
          );
        }
        receipt = returnedReceipt;
      } catch (error) {
        const failure = error as FlowerTurnLaunchFailure;
        if (failure.fresh_decision) {
          setHandlerState(handlerStateFromDecision(failure.fresh_decision));
        }
        const uncertain = flowerTurnAdmissionUncertainIdentity(failure);
        if (uncertain) {
          preserveClientRequestID = true;
          retainPendingSubmission = true;
          if (uncertain.client_request_id !== clientRequestID) {
            throw new Error('Flower turn admission returned a different client request identity.');
          }
          const uncertainSessionKey = trimString(uncertain.thread_id);
          transitionPendingSubmission({
            kind: 'admission_uncertain',
            clientRequestID,
            ...(uncertainSessionKey ? { threadID: uncertainSessionKey } : {}),
          });
          if (uncertainSessionKey && uncertainSessionKey !== launchSessionKey) {
            const sourceSnapshot = operation.session.snapshot();
            if (launchSessionKey === PENDING_NEW_THREAD_ID) {
              draftCoordinator.moveScope(launchSessionKey, uncertainSessionKey);
            }
            const uncertainSession = draftSessionFor(uncertainSessionKey);
            uncertainSession.mutate((value) => ({
              ...value,
              text: promptInput,
              attachments: sourceSnapshot.value.attachments,
              references: sourceSnapshot.value.references,
              mode: inspection.codePoints > FLOWER_INLINE_TEXT_CODE_POINT_LIMIT ? 'over_limit_editing' : 'ordinary',
              client_request_id: clientRequestID,
              admission_started: undefined,
              prepared_long_text_local_id: sourceSnapshot.value.prepared_long_text_local_id,
              prepared_long_text_attachment_id: sourceSnapshot.value.prepared_long_text_attachment_id,
            }));
            updateComposerSessionDraft(uncertainSessionKey, (draft) => ({
              ...draft,
              chatDraft: promptInput,
              references: sourceSnapshot.value.references,
            }));
          }
          const selectionCurrent = uncertainSessionKey
            ? setSelectedThreadWithDetailIfSessionCurrent(launchSessionKey, uncertainSessionKey)
            : false;
          if (selectionCurrent) {
            setThreadLoadError(getErrorMessage(error));
            returnToChat();
            await refreshSelectedThread(uncertainSessionKey);
          } else if (composerSessionStillCurrent(launchSessionKey)) {
            notifyComposerError(getErrorMessage(error));
            operation.session.mutate((value) => value.client_request_id === clientRequestID
              ? { ...value, mode: inspection.codePoints > FLOWER_INLINE_TEXT_CODE_POINT_LIMIT ? 'over_limit_editing' : 'ordinary', admission_started: undefined }
              : value);
          }
          return;
        }
        transitionPendingSubmission({ kind: 'admission_failed', clientRequestID });
        if (composerSessionStillCurrent(launchSessionKey)) {
          notifyComposerError(getErrorMessage(error));
        }
        if (preparedLongTextLocalID) launchController.remove(preparedLongTextLocalID);
        if (composerDraftOperationActive(operation)) {
          const rejected = operation.session.snapshot();
          if (rejected.value.client_request_id === clientRequestID) {
            releaseAttachmentStagingScope(launchSessionKey);
            operation.session.mutate((value) => ({
              ...value,
              mode: inspection.codePoints > FLOWER_INLINE_TEXT_CODE_POINT_LIMIT ? 'over_limit_editing' : 'ordinary',
              client_request_id: undefined,
              admission_started: undefined,
              prepared_long_text_local_id: undefined,
              prepared_long_text_attachment_id: undefined,
            }));
          }
        }
        return;
      }
      retainPendingSubmission = true;
      transitionPendingSubmission({
        kind: 'admission_accepted',
        clientRequestID,
        threadID: receipt.thread_id,
        canonicalKind: receipt.kind,
        canonicalID: receipt.kind === 'queued'
          ? receipt.queue_id
          : receipt.kind === 'admitting'
          ? receipt.admission_id
          : receipt.turn_id,
      });
      const stopAfterAdmission = deferredStopClientRequestID() === clientRequestID;
      if (stopAfterAdmission) setDeferredStopClientRequestID('');
      clearAcceptedComposerDraft(receipt.thread_id);
      if (launchController.snapshot().items.length === 0) {
        releaseAttachmentStagingScope(launchSessionKey);
      }
      const selectionCurrent = setSelectedThreadWithDetailIfSessionCurrent(launchSessionKey, receipt.thread_id);
      if (selectionCurrent) {
        setLoadError('');
        returnToChat();
      }
      if (stopAfterAdmission && receipt.kind !== 'queued') {
        setThreadStopping(true);
        try {
          const stopped = applyLiveBootstrap(await props.adapter.stopThread(receipt.thread_id), 'user_action');
          if (selectedThreadDetailMatches(receipt.thread_id)) {
            setSelectedThreadWithDetail(stopped.thread_id);
            setLoadError('');
            returnToChat();
          }
        } catch (error) {
          if (selectedThreadID() === receipt.thread_id) {
            notifyComposerError(getErrorMessage(error));
          }
        } finally {
          setThreadStopping(false);
        }
      } else if (selectionCurrent) {
        void reloadSelectedThread(receipt.thread_id, threadLoadSequence, 'background_refresh').catch((error) => {
          if (selectedThreadDetailMatches(receipt.thread_id)) {
            setThreadLoadError(getErrorMessage(error));
          }
        });
      }
    } finally {
      if (cancelActiveLongTextSubmission === cancelLongTextSubmission) cancelActiveLongTextSubmission = null;
      setLongTextPreparing(false);
      setChatRunning(false);
      if (!retainPendingSubmission) {
        transitionPendingSubmission({ kind: 'submission_finished_without_receipt', clientRequestID });
        if (deferredStopClientRequestID() === clientRequestID) setDeferredStopClientRequestID('');
      }
      if (composerDraftOperationActive(operation)) {
        const shared = operation.session.snapshot();
        if (!preserveClientRequestID && shared.value.client_request_id === clientRequestID && shared.value.admission_started !== true) {
          releaseAttachmentStagingScope(launchSessionKey);
          operation.session.mutate((value) => ({
            ...value,
            mode: inspection.codePoints > FLOWER_INLINE_TEXT_CODE_POINT_LIMIT ? 'over_limit_editing' : 'ordinary',
            client_request_id: undefined,
            admission_started: undefined,
            prepared_long_text_local_id: undefined,
            prepared_long_text_attachment_id: undefined,
          }));
        }
      }
      if (threadLoadSequence === focusSelectionSequence) {
        requestComposerFocus(focusOwner);
      }
    }
  };

  const stopSelectedThread = async (): Promise<FlowerThreadSnapshot> => {
    if (selectedThreadDetailPending()) throw new Error(copy().chat.threadLoading);
    const threadID = trimString(selectedThread()?.thread_id);
    if (!threadID) throw new Error('Missing thread id.');
    const live = await props.adapter.stopThread(threadID);
    const thread = applyLiveBootstrap(live);
    if (selectedThreadDetailMatches(threadID)) {
      setSelectedThreadWithDetail(thread.thread_id);
      setLoadError('');
    }
    return thread;
  };

  const stopSelectedThreadFromComposer = async (): Promise<void> => {
    if (threadStopping()) return;
    if (chatRunning()) {
      const pending = pendingSubmission();
      if (pendingAdmissionCanStop() && pending) {
        setDeferredStopClientRequestID(pending.clientRequestID);
      }
      return;
    }
    const stoppingThreadID = trimString(selectedThread()?.thread_id);
    setThreadStopping(true);
    try {
      await stopSelectedThread();
      if (selectedThreadDetailMatches(stoppingThreadID)) {
        returnToChat();
      }
    } catch (error) {
      if (selectedThreadDetailMatches(stoppingThreadID)) {
        notifyStopError(getErrorMessage(error));
      }
    } finally {
      setThreadStopping(false);
    }
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
        if ((block.type === 'markdown' || block.type === 'text' || block.type === 'thinking') && trimString(block.content)) {
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

  const compactSelectedThreadContext = async () => {
    if (!snapshot()) {
      notifyComposerError(copy().chat.loadingSettings);
      return;
    }
    if (!readyForChat()) {
      notifyComposerError(copy().chat.configureProviderBeforeChat);
      return;
    }
    if (!handlerAllowsSubmitIntent()) {
      const state = handlerState();
      notifyComposerError('message' in state ? state.message : copy().chat.handlerStillStarting);
      return;
    }
    const thread = selectedThread();
    if (selectedThreadDetailPending()) {
      notifyComposerError(copy().chat.threadLoading);
      return;
    }
    if (!thread) {
      notifyComposerError(copy().chat.compactChooseThread);
      return;
    }
    const threadID = trimString(thread.thread_id);
    if (!threadID) {
      notifyComposerError(copy().chat.compactChooseThread);
      return;
    }
    if (selectedThreadReadOnly()) {
      notifyComposerError(selectedThreadReadOnlyDisplay());
      return;
    }
    if (selectedInputRequest()) {
      notifyComposerError(copy().chat.compactFinishInputRequest);
      return;
    }
    if (!selectedThreadHasContent()) {
      notifyComposerError(copy().chat.compactNeedsConversation);
      return;
    }
    if (compactSubmitting()) return;
    const activeRunID = COMPOSER_STOP_THREAD_STATUSES.has(selectedThreadLiveStatus())
      ? trimString(thread?.active_run_id)
      : '';
    setCompactSubmitting(true);
    setPendingContextCompaction(localPendingCompaction(thread, Date.now()));
    updateComposerSessionText(threadID, '');
    requestComposerFocus();
    revealPendingCompactionDivider();
    try {
      const live = await props.adapter.compactThreadContext({
        thread_id: threadID,
        active_run_id: activeRunID || undefined,
      });
      const updated = applyLiveBootstrap(live);
      const selectionCurrent = selectedThreadDetailMatches(threadID);
      if (selectionCurrent) {
        setSelectedThreadWithDetail(updated.thread_id);
      }
      updateComposerSessionText(threadID, '');
      if (selectionCurrent) {
        setLoadError('');
        returnToChat();
        revealPendingCompactionDivider();
        await refreshSelectedThread(updated.thread_id);
      }
    } catch (error) {
      setPendingContextCompaction((pending) => (
        pending?.thread_id === threadID ? null : pending
      ));
      updateComposerSessionText(threadID, FLOWER_COMPACT_CONTEXT_COMMAND);
      if (selectedThreadDetailMatches(threadID)) {
        notifyComposerError(getErrorMessage(error));
      }
    } finally {
      setCompactSubmitting(false);
    }
  };

  const submitChat = async () => {
    const promptInput = composerRef?.value ?? currentComposerSessionDraft().chatDraft;
    const prompt = trimString(promptInput);
    const promptInspection = inspectFlowerText(promptInput);
    const promptOverLimit = (promptInspection?.codePoints ?? 0) > FLOWER_INLINE_TEXT_CODE_POINT_LIMIT;
    if (selectedThreadReadOnly()) {
      notifyComposerError(selectedThreadReadOnlyDisplay());
      return;
    }
    if (selectedInputRequest()) {
      await submitInputRequest();
      return;
    }
    if (pendingAdmissionCanStop() && !promptOverLimit && !prompt && !composerHasAttachments() && !composerHasReferences()) {
      await stopSelectedThreadFromComposer();
      return;
    }
    const command = parseFlowerSlashCommand(prompt);
    if (command.kind === 'invalid') {
      notifyComposerError(command.message);
      return;
    }
    if (command.kind === 'suggest') {
      if (composerHasAttachments() || composerHasReferences()) {
        notifyComposerError(attachmentCopy().compactBlocked);
        return;
      }
      await compactSelectedThreadContext();
      return;
    }
    if (command.kind === 'intent') {
      if (composerHasAttachments() || composerHasReferences()) {
        notifyComposerError(attachmentCopy().compactBlocked);
        return;
      }
      await compactSelectedThreadContext();
      return;
    }
    if (selectedThreadCanStop() && !promptOverLimit && !prompt && !composerHasAttachments() && !composerHasReferences()) {
      await stopSelectedThreadFromComposer();
      return;
    }
    if (chatRunning() || composerSharedOperationActive()) {
      if (longTextPreparing()) cancelActiveLongTextSubmission?.();
      return;
    }
    if (launchChatTurnInFlight) return;
    launchChatTurnInFlight = true;
    try {
      await launchChatTurn(promptInput);
    } finally {
      launchChatTurnInFlight = false;
    }
  };

  const startCompose = () => {
    const requestID = trimString(props.focusThreadRequest?.request_id);
    if (requestID) props.onFocusThreadRequestConsumed?.(requestID);
    cancelDeferredThreadSelection();
    cancelThreadSelectionTransaction();
    threadLoadSequence += 1;
    cancelPresentedSelectionSchedule();
    setPresentedSelection(null);
    transcriptScroll.startFollowing();
    cancelSelectedThreadTailReveal();
    closeSubagentOverlays();
    transitionPendingSubmission({ kind: 'new_conversation' });
    setSelectedThreadID('');
    setSelectedThreadDetailID('');
    setSidebarActiveThreadID('');
    setThreadLoadError('');
    requestComposerFocus();
    void resolveHandlerDecision();
    returnToChat();
  };

  const retireThreadLocally = (threadID: string) => {
    const tid = trimString(threadID);
    if (!tid || retiredThreadIDs.has(tid)) return;

    const retiringSelected = selectedThreadID() === tid
      || selectedThreadDetailID() === tid
      || sidebarActiveThreadID() === tid;
    retiredThreadIDs.add(tid);
    threadsRefreshSequence += 1;
    threadLocalMutationRevision += 1;
    if (retiringSelected) engagementBootstrapSequence += 1;

    loadedThreadIDs.delete(tid);
    threadBootstrapRequests.delete(tid);
    locallyReadSnapshots.delete(tid);
    persistingReadThreadIDs.delete(tid);
    pendingReadPersistenceSnapshots.delete(tid);
    liveCursors.delete(tid);
    liveStreamGenerations.delete(tid);
    releaseAttachmentStagingScope(tid);

    setThreads((current) => current.filter((thread) => thread.thread_id !== tid));
    setComposerSessionDrafts((current) => {
      if (!(tid in current)) return current;
      const next = { ...current };
      delete next[tid];
      return next;
    });
    setCompanionTerminalOverrides((current) => {
      if (!current.has(tid)) return current;
      const next = new Map(current);
      next.delete(tid);
      return next;
    });
    setCompanionLiveThread((current) => current?.thread_id === tid ? null : current);
    setCompanionTerminalTransition((current) => current?.thread_id === tid ? undefined : current);
    setPendingContextCompaction((current) => current?.thread_id === tid ? null : current);
    setPendingPermissionPatch((current) => current?.threadID === tid ? null : current);
    setPendingModelPatch((current) => current?.threadID === tid ? null : current);
    setLoadingThreadID((current) => current === tid ? '' : current);

    if (retiringSelected) {
      startCompose();
    } else {
      requestComposerFocus();
    }
    void refreshThreads();
  };

  const submitDeleteThread = async () => {
    const target = deleteTarget();
    if (!target || deleteSubmitting() || !props.adapter.deleteThread) return;
    const threadID = trimString(target.item.thread_id);
    if (!threadID) return;

    setDeleteSubmitting(true);
    setDeleteError('');
    setThreadActionBusy({ threadID, action: 'delete' });
    try {
      const outcome = await props.adapter.deleteThread(threadID);
      retireThreadLocally(threadID);
      setDeleteTarget(null);
      if (outcome.status === 'committed') {
        notifySuccess(copy().threadList.deleteCommittedNotification);
      } else if (outcome.status === 'pending') {
        notify({ tone: 'info', message: copy().threadList.deletePendingNotification });
      } else {
        notifyThreadActionError(copy().threadList.deleteFailedNotification);
      }
    } catch (error) {
      setDeleteError(getErrorMessage(error));
    } finally {
      setDeleteSubmitting(false);
      setThreadActionBusy(null);
    }
  };

  const deleteTargetTitle = () => trimString(deleteTarget()?.item.title) || copy().threadList.untitled;
  const deleteTargetHasActiveWork = () => {
    const item = deleteTarget()?.item;
    if (!item) return false;
    return item.status === 'running'
      || item.status === 'waiting_user'
      || item.status === 'waiting_approval';
  };

  createEffect(() => {
    const request = Math.max(0, Math.floor(Number(props.focusComposerRequest ?? 0)));
    if (!request || request === startedFocusComposerRequest) return;
    startedFocusComposerRequest = request;
    requestComposerFocus();
  });

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
    const tid = trimString(threadID);
    if (!tid) return;
    cancelThreadSelectionTransaction();
    if (props.onThreadSelectionEvent) {
      const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
      const transaction = {
        id: nextThreadSelectionTransactionID,
        value: tid,
        startedAt,
      };
      nextThreadSelectionTransactionID += 1;
      threadSelectionTransaction = transaction;
      emitThreadSelectionEvent(transaction, 'requested');
    }
    transcriptScroll.startFollowing();
    closeSubagentOverlays();
    transitionPendingSubmission({ kind: 'thread_selected', threadID: tid });
    setSelectedThreadID(tid);
    setSidebarActiveThreadID(tid);
    scheduleThreadSelectionAfterPaint(tid);
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
    if (liveSummaryRefreshTimer !== undefined) {
      window.clearTimeout(liveSummaryRefreshTimer);
      liveSummaryRefreshTimer = undefined;
    }
    cancelDeferredThreadSelection();
    cancelThreadSelectionTransaction();
    cancelPresentedSelectionSchedule();
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
    clearWorkingDirectoryCopyTimer();
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
  const selectedTimelineEntries = createMemo(() => buildFlowerTimelineEntries(selectedThread()));
  createEffect(() => {
    const preview = contextSnapshotPreview();
    if (!preview) return;
    if (!selectedThreadID() || preview.thread_id !== selectedThreadID()) {
      setContextSnapshotPreview(null);
      return;
    }
    const sourceEntry = selectedTimelineEntries().find((entry) => (
      entry.type === 'message' && entry.message.id === preview.message_id
    ));
    const queuedSource = selectedTimelineEntries().find((entry) => (
      entry.type === 'queued_turn' && `queued:${entry.turn.queue_id}` === preview.message_id
    ));
    const display = sourceEntry?.type === 'message'
      ? parseChatMessageReferences(sourceEntry.message.references)
      : queuedSource?.type === 'queued_turn'
        ? parseChatContextAction(queuedSource.turn.context_action)
        : null;
    const currentAction = display?.chips.find((chip) => (
      chip.action
      && 'context_index' in chip.action
      && chip.action.context_index === preview.action.context_index
      && chip.action.type === preview.action.type
    ))?.action;
    if (!currentAction || JSON.stringify(currentAction) !== JSON.stringify(preview.action)) {
      setContextSnapshotPreview(null);
    }
  });
  const selectedSubagentItems = createMemo(() => buildFlowerSubagentPanelItems(selectedThread()));
  const subagentStatusIsActive = (status: FlowerSubagentPanelStatus): boolean => (
    status === 'waiting_input' || status === 'running' || status === 'queued' || status === 'unknown'
  );
  const selectedActiveSubagentItems = createMemo(() => selectedSubagentItems().filter((item) => subagentStatusIsActive(item.status)));
  const selectedSettledSubagentItems = createMemo(() => selectedSubagentItems().filter((item) => !subagentStatusIsActive(item.status)));
  const selectedRunningSubagentCount = createMemo(() => selectedSubagentItems().filter((item) => item.status === 'running').length);
  const selectedActiveSubagentCount = createMemo(() => selectedActiveSubagentItems().length);
  const selectedSettledSubagentCount = createMemo(() => selectedSettledSubagentItems().length);
  const activeSubagentItem = createMemo(() => {
    const activeID = trimString(activeSubagentID());
    if (!activeID) return null;
    return selectedSubagentItems().find((item) => trimString(item.threadID) === activeID) ?? null;
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

  const retrySubagentDetailTail = () => {
    const parentThreadID = trimString(selectedThread()?.thread_id);
    const childThreadID = trimString(activeSubagentID());
    const openedRevision = subagentDetailOpenedRevision();
    if (!parentThreadID || !childThreadID || !openedRevision || subagentDetailTailInFlight) return;
    if (subagentDetailTailTimer !== undefined) {
      window.clearTimeout(subagentDetailTailTimer);
      subagentDetailTailTimer = undefined;
    }
    const request: FlowerSubagentDetailTailRequest = {
      parentThreadID,
      childThreadID,
      openedRevision,
      afterOrdinal: latestSubagentDetailOrdinal(),
    };
    void runSubagentDetailTailRequest(request).finally(() => {
      setSubagentDetailTailRevision((revision) => revision + 1);
    });
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
    const entries = pending && pendingContextCompactionVisibleForSelectedThread() && thread
      ? [...buildFlowerTimelineEntries({
        ...thread,
        timeline_decorations: [...(thread.timeline_decorations ?? []), pending.decoration],
      })]
      : [...selectedTimelineEntries()];
    return entries.filter((entry) => entry.type !== 'queued_turn');
  });
  const visibleTimelineEntryKeys = createMemo(() => visibleTimelineEntries().map((entry) => entry.key));
  const visibleTimelineEntriesByKey = createMemo(() => new Map(visibleTimelineEntries().map((entry) => [entry.key, entry] as const)));


  const shouldSubmitOnEnterKeydown = (event: KeyboardEvent): boolean => {
    if (event.isComposing || isComposing() || event.keyCode === 229) {
      return false;
    }
    return event.key === 'Enter' && !event.shiftKey;
  };

  const executeCompactContextCommand = async () => {
    if (composerHasAttachments() || composerHasReferences()) {
      notifyComposerError(attachmentCopy().compactBlocked);
      return;
    }
    await compactSelectedThreadContext();
  };

  const handleComposerKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || isComposing() || event.keyCode === 229) return;
    if (composerReferenceMutationActive()) {
      if (event.key === 'Enter') event.preventDefault();
      return;
    }
    if (composerReferenceMenuVisible()) {
      const candidates = composerReferenceCandidates();
      const active = composerReferenceActiveCandidate();
      if (event.key === 'Escape') {
        event.preventDefault();
        setComposerReferenceDismissedSignature(composerReferenceTokenSignature());
        composerReferenceIndex?.softAbort();
        return;
      }
      if (!event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        if (candidates.length > 0) {
          event.preventDefault();
          const activeIndex = Math.max(0, candidates.findIndex((candidate) => (
            composerReferenceCandidateKey(candidate) === composerReferenceCandidateKey(active ?? candidates[0]!)
          )));
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          const nextIndex = Math.max(0, Math.min(candidates.length - 1, activeIndex + delta));
          setComposerReferenceActiveKey(composerReferenceCandidateKey(candidates[nextIndex]!));
        }
        return;
      }
      if (!event.shiftKey && event.key === 'Tab' && active) {
        event.preventDefault();
        completeComposerReference(active);
        return;
      }
      if (
        !event.altKey
        && !event.ctrlKey
        && !event.metaKey
        && event.key === 'ArrowRight'
        && active?.kind === 'directory'
      ) {
        event.preventDefault();
        completeComposerReference(active);
        return;
      }
      if (!event.shiftKey && event.key === 'Enter') {
        if (active) {
          event.preventDefault();
          void commitComposerReference(active);
          return;
        }
        if (composerReferenceSearchState().status === 'loading') {
          event.preventDefault();
          return;
        }
      }
    }
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
        void executeCompactContextCommand();
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

  const runtimeRestartedDivider = () => (
    <div class="flower-runtime-restart-divider" role="separator">
      <span class="flower-runtime-restart-divider-rule" aria-hidden="true" />
      <span class="flower-runtime-restart-divider-label">{copy().chat.runtimeRestartedDivider}</span>
      <span class="flower-runtime-restart-divider-rule" aria-hidden="true" />
    </div>
  );

  const queuedTurnDisplayLabel = (turn: FlowerQueuedTurn): string => {
    const prompt = trimString(turn.prompt);
    if (prompt) return prompt;
    const attachments = (turn.attachments ?? []).map((attachment) => trimString(attachment.name)).filter(Boolean);
    return attachments.join(', ') || copy().chat.pendingQueued;
  };
  const queuedPendingDisplayLabel = (pending: FlowerPendingSubmission): string => (
    trimString(pending.prompt)
      || pending.attachmentNames.map(trimString).filter(Boolean).join(', ')
      || copy().chat.pendingQueued
  );

  const queuedTurnsDock = () => (
    <Show when={selectedQueuedTurns().length > 0 || queuedPendingSubmission()}>
      <div
        class="flower-queued-turn-dock"
        role="list"
        aria-label={copy().chat.pendingQueued}
        aria-busy={queuedTurnReorder()?.phase === 'saving' ? 'true' : undefined}
        onDragOver={previewQueuedTurnDropAtEnd}
        onDrop={commitQueuedTurnReorder}
      >
        <For each={selectedQueuedTurns()}>
          {(turn) => {
            const queueID = () => trimString(turn.queue_id);
            const dragging = () => queuedTurnReorder()?.draggedQueueID === queueID();
            const attachmentCount = () => turn.attachments?.length ?? 0;
            return (
              <div
                class="flower-queued-turn-item"
                role="listitem"
                aria-label={`${copy().chat.pendingQueued}: ${queuedTurnDisplayLabel(turn)}`}
                draggable={queuedTurnReorderEnabled()}
                data-flower-queued-turn-dock-id={queueID()}
                data-flower-queued-turn-dragging={dragging() && queuedTurnReorder()?.phase === 'dragging' ? 'true' : undefined}
                data-flower-queued-turn-saving={queuedTurnReorder()?.phase === 'saving' ? 'true' : undefined}
                onDragStart={(event) => beginQueuedTurnDrag(event, queueID())}
                onDragOver={(event) => previewQueuedTurnDrop(event, queueID())}
                onDrop={(event) => {
                  event.stopPropagation();
                  commitQueuedTurnReorder(event);
                }}
                onDragEnd={finishQueuedTurnDrag}
              >
                <GripVertical class="flower-queued-turn-handle" aria-hidden="true" />
                <div class="flower-queued-turn-content">
                  <span class="flower-queued-turn-label">{queuedTurnDisplayLabel(turn)}</span>
                  <Show when={attachmentCount() > 0}>
                    <span class="flower-queued-turn-compact-meta" title={(turn.attachments ?? []).map((attachment) => attachment.name).join(', ')}>
                      <Paperclip aria-hidden="true" />
                      <span>{attachmentCount()}</span>
                    </span>
                  </Show>
                  <Show when={turn.context_action}>
                    <span class="flower-queued-turn-compact-meta" title={copy().chat.linkedContextLabel}>
                      <FileText aria-hidden="true" />
                    </span>
                  </Show>
                </div>
                <div class="flower-queued-turn-actions">
                  <button
                    type="button"
                    class="flower-queued-turn-action flower-queued-turn-send"
                    disabled={queuedTurnPromotionBlocked() || Boolean(queuedTurnPromotingID()) || Boolean(queuedTurnDelete())}
                    aria-busy={queuedTurnPromotingID() === queueID() ? 'true' : undefined}
                    aria-label={copy().chat.queuedSendNow}
                    title={copy().chat.queuedSendNow}
                    onClick={(event) => {
                      event.stopPropagation();
                      void promoteQueuedTurn(turn);
                    }}
                  >
                    <Send aria-hidden="true" />
                  </button>
                  <Show when={props.adapter.deleteQueuedTurn}>
                    <button
                      type="button"
                      class="flower-queued-turn-action flower-queued-turn-delete"
                      disabled={Boolean(queuedTurnPromotingID()) || Boolean(queuedTurnDelete()) || queuedTurnReorder()?.phase === 'saving'}
                      aria-label={copy().chat.queuedDelete}
                      title={copy().chat.queuedDelete}
                      data-flower-queued-turn-delete={queueID()}
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteQueuedTurn(turn);
                      }}
                    >
                      <Trash aria-hidden="true" />
                    </button>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
        <Show when={queuedPendingSubmission()}>
          {(pending) => (
            <div
              class="flower-queued-turn-item flower-queued-turn-item-pending"
              role="listitem"
              aria-label={`${copy().chat.pendingSending}: ${queuedPendingDisplayLabel(pending())}`}
              data-flower-queued-turn-pending="true"
            >
              <Clock class="flower-queued-turn-handle" aria-hidden="true" />
              <span class="flower-queued-turn-label">{queuedPendingDisplayLabel(pending())}</span>
              <span class="flower-queued-turn-state">{copy().chat.pendingSending}</span>
            </div>
          )}
        </Show>
      </div>
    </Show>
  );

  const permissionSelector = () => {
    const canUseMenu = createMemo(() => composerPermissionInteractive());
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
      || code === 'provider_unreachable'
      || code === 'provider_stream_interrupted';
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
      | 'inputRequestAnswerHidden'
      | 'inputRequestSubmitting'
      | 'inputRequestPrevious'
      | 'inputRequestNext'
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
    transcriptLayoutRevision();
    measureTranscriptNearBottomAfterLayout();
  });
  function modelStatusLabel(phase: FlowerModelIOPhase): string {
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
  }
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
      notifyThreadActionError(getErrorMessage(error));
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
      return;
    }
    updateComposerSessionText(currentComposerSessionKey(), value);
  };

  const composerAttachmentItems = createMemo(() => currentAttachmentSnapshot().items);
  const composerHasAttachments = createMemo(() => composerAttachmentItems().length > 0);
  const composerHasReadyAttachments = createMemo(() => (
    composerAttachmentItems().some((item) => item.status === 'staged_ready')
  ));
  const composerHasSubmissionBlockingAttachments = createMemo(() => (
    composerAttachmentItems().some((item) => item.status !== 'staged_ready' && item.status !== 'incompatible')
  ));
  const composerAttachmentCapabilityEnabled = createMemo(() => (
    currentAttachmentSnapshot().capability?.enabled === true
    && typeof props.adapter.createAttachmentStagingScope === 'function'
    && typeof props.adapter.uploadAttachment === 'function'
  ));
  const composerAttachmentEditingAllowed = createMemo(() => (
    !selectedComposerApprovalDisplayAction()
    && !selectedInputRequest()
    && !selectedThreadDetailPending()
    && !selectedThreadReadOnly()
    && !surfaceWarmupActive()
    && !composerSharedOperationActive()
    && !chatRunning()
    && !longTextPreparing()
  ));
  const composerCanQueueAttachmentIntent = createMemo(() => (
    composerAttachmentEditingAllowed()
    && composerAttachmentCapabilityEnabled()
  ));
  const composerCanAddAttachments = createMemo(() => (
    composerAttachmentEditingAllowed()
    && composerAttachmentCapabilityEnabled()
  ));
  const composerTextInspection = createMemo(() => inspectFlowerText(currentComposerSessionDraft().chatDraft));
  const composerTextOverLimit = createMemo(() => (
    (composerTextInspection()?.codePoints ?? 0) > FLOWER_INLINE_TEXT_CODE_POINT_LIMIT
  ));
  type ModelAttachmentSupportState = 'checking' | 'supported' | 'unsupported' | 'unavailable';
  const composerNeedsModelAttachmentSupport = createMemo(() => composerHasAttachments() || composerTextOverLimit());
  const capabilitySupportsComposerAttachments = (capability: FlowerAttachmentCapability): boolean => {
    const items = composerAttachmentItems();
    if (!capability.enabled) return false;
    if ((composerTextOverLimit() || items.some((item) => item.source === 'long_text')) && !capability.supports_long_text) {
      return false;
    }
    if (items.length > capability.max_attachments) return false;
    if (items.some((item) => item.size_bytes > capability.max_file_size_bytes)) return false;
    if (items.reduce((total, item) => total + item.size_bytes, 0) > capability.max_total_size_bytes) return false;
    return items.every((item) => flowerAttachmentRoute(capability, item.mime_type) !== 'unsupported');
  };
  const modelAttachmentSupportState = (modelID: string): ModelAttachmentSupportState | null => {
    if (!composerNeedsModelAttachmentSupport()) return null;
    modelCapabilityRevision();
    const state = modelCapabilityCache.get(modelID);
    if (!state || state.kind === 'loading') return 'checking';
    if (state.kind === 'failed') return 'unavailable';
    return capabilitySupportsComposerAttachments(state.capability) ? 'supported' : 'unsupported';
  };
  createEffect(() => {
    const capability = currentAttachmentSnapshot().capability;
    if (!capability?.model_id) return;
    modelCapabilityCache.set(capability.model_id, { kind: 'ready', capability });
    setModelCapabilityRevision((revision) => revision + 1);
  });
  createEffect(() => {
    if (!modelMenuOpen() || !composerNeedsModelAttachmentSupport() || !props.adapter.loadAttachmentCapability) return;
    for (const option of catalogModelOptions()) {
      const existing = modelCapabilityCache.get(option.id);
      if (existing?.kind === 'loading' || existing?.kind === 'ready') continue;
      modelCapabilityCache.set(option.id, { kind: 'loading' });
      setModelCapabilityRevision((revision) => revision + 1);
      void props.adapter.loadAttachmentCapability(option.id).then((capability) => {
        modelCapabilityCache.set(
          option.id,
          capability.model_id === option.id ? { kind: 'ready', capability } : { kind: 'failed' },
        );
        setModelCapabilityRevision((revision) => revision + 1);
      }).catch(() => {
        modelCapabilityCache.set(option.id, { kind: 'failed' });
        setModelCapabilityRevision((revision) => revision + 1);
      });
    }
  });
  const scheduleComposerSelection = (
    start: number,
    end = start,
    expectedSessionKey = currentComposerSessionKey(),
    expectedValue?: string,
    expectedCurrentSelection?: Readonly<{ start: number; end: number }>,
    focusOwnerAtRequest = typeof document === 'undefined' ? null : document.activeElement,
  ) => {
    if (composerSelectionFrame) cancelTranscriptAnimationFrame(composerSelectionFrame);
    composerSelectionFrame = requestTranscriptAnimationFrame(() => {
      composerSelectionFrame = 0;
      if (surfaceDisposed || currentComposerSessionKey() !== expectedSessionKey) return;
      if (!(composerRef instanceof HTMLTextAreaElement)) return;
      if (expectedValue !== undefined && composerRef.value !== expectedValue) return;
      if (
        expectedCurrentSelection
        && (composerRef.selectionStart !== expectedCurrentSelection.start
          || composerRef.selectionEnd !== expectedCurrentSelection.end)
      ) return;
      if (typeof document !== 'undefined') {
        const activeElement = document.activeElement;
        const focusStillOwned = activeElement == null
          || activeElement === document.body
          || activeElement === focusOwnerAtRequest
          || activeElement === composerRef;
        if (!focusStillOwned) return;
      }
      composerRef.focus();
      composerRef.setSelectionRange(start, end);
    });
  };
  onCleanup(() => {
    if (!composerSelectionFrame) return;
    cancelTranscriptAnimationFrame(composerSelectionFrame);
    composerSelectionFrame = 0;
  });
  const handleComposerPaste = (event: ClipboardEvent & { currentTarget: HTMLTextAreaElement }) => {
    if (composerReferenceMutationActive()) {
      event.preventDefault();
      event.currentTarget.value = composerTextValue();
      return;
    }
    if (isComposing()) return;
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length > 0) {
      if (!composerCanQueueAttachmentIntent()) return;
      event.preventDefault();
      queueComposerAttachmentIntent(currentComposerSessionKey(), { kind: 'add', files, source: 'paste' });
      return;
    }
    if (!composerCanAddAttachments()) return;
    const payload = event.clipboardData?.getData('text/plain') ?? '';
    if (!payload) return;
    const target = event.currentTarget;
    const retainedPaste = replaceFlowerTextSelection(
      target.value,
      payload,
      target.selectionStart,
      target.selectionEnd,
    );
    const decision = decideFlowerTextPaste({
      value: target.value,
      payload,
      selectionStart: target.selectionStart,
      selectionEnd: target.selectionEnd,
    });
    if (decision.kind === 'reject_ill_formed') {
      event.preventDefault();
      notifyComposerError(attachmentCopy().invalidText);
      return;
    }
    event.preventDefault();
    if (decision.kind === 'attach_payload') {
      const retainedSessionKey = currentComposerSessionKey();
      const focusOwner = typeof document === 'undefined' ? null : document.activeElement;
      updateComposerText(retainedPaste.value);
      scheduleComposerSelection(
        retainedPaste.selectionStart,
        retainedPaste.selectionEnd,
        retainedSessionKey,
        retainedPaste.value,
      );
      void (async () => {
        const operation = currentComposerDraftOperation();
        if (operation.sessionKey !== retainedSessionKey || !composerDraftOperationCurrent(operation)) return;
        if (currentComposerSessionDraft().chatDraft !== retainedPaste.value) return;
        const retained = operation.session.mutate((value) => ({
          ...value,
          text: retainedPaste.value,
          ...(operation.sessionKey === PENDING_NEW_THREAD_ID && !value.client_request_id
            ? { client_request_id: createFlowerClientRequestID() }
            : {}),
        }));
        if (retained.kind !== 'committed' || !composerDraftOperationCurrent(operation)) return;
        if (currentComposerSessionDraft().chatDraft !== retainedPaste.value) return;
        try {
          await ensureAttachmentStagingScope(operation.sessionKey);
        } catch {
          if (composerDraftOperationCurrent(operation)) notifyComposerError(attachmentCopy().unavailable);
          return;
        }
        const beforeAdd = operation.session.snapshot();
        if (
          !composerDraftOperationCurrent(operation)
          || beforeAdd.revision !== retained.snapshot.revision
          || draftSubmissionActive(beforeAdd.value)
          || beforeAdd.value.text !== retainedPaste.value
          || currentComposerSessionDraft().chatDraft !== retainedPaste.value
        ) return;
        const capability = operation.controller.snapshot().capability;
        const added = capability?.supports_long_text
          ? operation.controller.addLongText(decision.payload)
          : { kind: 'rejected' as const };
        if (added.kind !== 'accepted') {
          notifyComposerError(attachmentCopy().unavailable);
          return;
        }
        await operation.controller.waitForIdle();
        const afterUpload = operation.session.snapshot();
        if (!composerDraftOperationCurrent(operation) || draftSubmissionActive(afterUpload.value)) {
          operation.controller.cancel(added.local_id);
          return;
        }
        const item = operation.controller.snapshot().items.find((candidate) => candidate.local_id === added.local_id);
        if (item?.status !== 'staged_ready') {
          if (item?.source === 'long_text') {
            operation.controller.cancel(added.local_id);
          }
          return;
        }
        const unchanged = composerDraftOperationCurrent(operation)
          && !draftSubmissionActive(afterUpload.value)
          && currentComposerSessionDraft().chatDraft === retainedPaste.value
          && afterUpload.value.text === retainedPaste.value
          && (!(composerRef instanceof HTMLTextAreaElement) || composerRef.value === retainedPaste.value);
        if (unchanged) {
          updateComposerText(decision.value);
          scheduleComposerSelection(
            decision.selectionStart,
            decision.selectionEnd,
            retainedSessionKey,
            decision.value,
            undefined,
            focusOwner,
          );
          return;
        }
        if (composerDraftOperationActive(operation) && !draftSubmissionActive(operation.session.snapshot().value)) {
          operation.session.mutate((value) => ({
            ...value,
            attachments: value.attachments.filter((attachment) => attachment.local_id !== added.local_id),
          }));
        }
        operation.controller.cancel(added.local_id);
      })();
      return;
    }
    updateComposerText(decision.value);
    scheduleComposerSelection(decision.selectionStart, decision.selectionEnd, currentComposerSessionKey(), decision.value);
  };
  const handleComposerTextInput = (event: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    if (composerReferenceMutationActive()) {
      event.currentTarget.value = composerTextValue();
      return;
    }
    if (companionCollapsed()) props.onCompanionOpenRequest?.();
    const value = event.currentTarget.value;
    if (!inspectFlowerText(value)) {
      event.currentTarget.value = composerTextValue();
      notifyComposerError(attachmentCopy().invalidText);
      return;
    }
    updateComposerText(value);
    syncComposerSelection(event.currentTarget);
    setComposerReferenceDismissedSignature('');
  };
  const restoreLongTextAttachment = async (localID: string) => {
    const focusOwner = typeof document === 'undefined' ? null : document.activeElement;
    try {
      const operation = currentComposerDraftOperation();
      if (!composerDraftOperationCurrent(operation)) return;
      const shared = operation.session.snapshot();
      if (draftSubmissionActive(shared.value)) return;
      const attachment = shared.value.attachments.find((item) => item.local_id === localID);
      if (!attachment || attachment.source !== 'long_text') throw new Error('attachment_restore_failed');
      const current = shared.value.text;
      const start = composerRef instanceof HTMLTextAreaElement ? composerRef.selectionStart : current.length;
      const end = composerRef instanceof HTMLTextAreaElement ? composerRef.selectionEnd : current.length;
      const text = await operation.controller.restoreLongText(localID);
      const afterRestore = operation.session.snapshot();
      if (
        !composerDraftOperationCurrent(operation)
        || afterRestore.revision !== shared.revision
        || draftSubmissionActive(afterRestore.value)
        || afterRestore.value.text !== current
        || !afterRestore.value.attachments.some((item) => item.local_id === localID && item.source === 'long_text')
      ) return;
      const restored = replaceFlowerTextSelection(current, text, start, end);
      const committed = operation.session.mutate((value) => (
        draftSubmissionActive(value)
          || value.text !== current
          || !value.attachments.some((item) => item.local_id === localID && item.source === 'long_text')
          ? value
          : {
              ...value,
              text: restored.value,
              attachments: value.attachments.filter((item) => item.local_id !== localID),
            }
      ));
      if (
        committed.kind !== 'committed'
        || committed.snapshot.revision === afterRestore.revision
        || draftSubmissionActive(committed.snapshot.value)
        || !composerDraftOperationCurrent(operation)
      ) return;
      updateComposerSessionDraft(operation.sessionKey, (draft) => ({ ...draft, chatDraft: restored.value }));
      operation.controller.remove(localID);
      scheduleComposerSelection(
        restored.selectionStart,
        restored.selectionEnd,
        operation.sessionKey,
        restored.value,
        undefined,
        focusOwner,
      );
    } catch {
      notifyComposerError(attachmentCopy().restoreFailed);
    }
  };
  const previewStagedAttachment = async (item: FlowerAttachmentItem) => {
    if (!item.staged) return;
    const scope = currentAttachmentSnapshot().staging_scope;
    if (!scope) return;
    if (props.adapter.loadStagedAttachmentPreview) {
      const attachment = item.staged;
      setAttachmentPreview({
        id: `staged:${attachment.attachment_id}`,
        name: attachment.name,
        mimeType: attachment.mime_type,
        load: (signal) => props.adapter.loadStagedAttachmentPreview!(attachment, scope, signal),
      });
      return;
    }
    if (!props.adapter.previewStagedAttachment) return;
    try {
      await props.adapter.previewStagedAttachment(item.staged, scope);
    } catch (error) {
      notifyComposerError(getErrorMessage(error));
    }
  };
  const reselectAttachment = (localID: string) => {
    attachmentPickerSessionKey = currentComposerSessionKey();
    attachmentReselectTarget = { sessionKey: attachmentPickerSessionKey, localID };
    attachmentPickerRef?.click();
  };

  const inputTextQuestions = createMemo(() => selectedInputRequest()?.questions.filter(questionAllowsText) ?? []);

  const activeInputQuestion = createMemo(() => {
    const questions = selectedInputRequest()?.questions ?? [];
    const activeID = trimString(currentComposerSessionDraft().activeInputQuestionID);
    return questions.find((question) => question.id === activeID) ?? questions[0] ?? null;
  });
  const inputRequestQuestionIndex = createMemo(() => {
    const questions = selectedInputRequest()?.questions ?? [];
    const activeID = activeInputQuestion()?.id;
    const index = activeID ? questions.findIndex((question) => question.id === activeID) : -1;
    return index >= 0 ? index : 0;
  });
  const setActiveInputQuestionByOffset = (offset: number) => {
    const questions = selectedInputRequest()?.questions ?? [];
    if (questions.length < 2) return;
    const nextIndex = Math.max(0, Math.min(questions.length - 1, inputRequestQuestionIndex() + offset));
    const nextQuestion = questions[nextIndex];
    if (!nextQuestion || nextQuestion.id === activeInputQuestion()?.id) return;
    updateCurrentComposerSessionDraft((draft) => ({ ...draft, activeInputQuestionID: nextQuestion.id }));
  };
  const activeInputQuestionIsSecret = createMemo(() => !!selectedInputRequest() && !!activeInputQuestion()?.is_secret);
  const companionActionVisible = createMemo(() => (
    companionCollapsed()
    && (activeInputQuestionIsSecret() || Boolean(selectedComposerApprovalDisplayAction()))
  ));

  const composerTextValue = createMemo(() => {
    if (!selectedInputRequest()) {
      const pending = visiblePendingSubmission();
      return pending && (pending.phase !== 'awaiting_projection' || Boolean(pending.canonicalID))
        ? ''
        : currentComposerSessionDraft().chatDraft;
    }
    const question = activeInputQuestion();
    return question ? questionDraft(question.id).text ?? '' : '';
  });
  createEffect(() => {
    composerTextValue();
    currentComposerSessionKey();
    if (companionCollapsed()) composerAutosizeController?.suspend();
    else {
      composerAutosizeController?.resume();
      composerAutosizeController?.schedule();
    }
  });
  const composerReferences = createMemo(() => currentComposerSessionDraft().references);
  const composerHasReferences = createMemo(() => composerReferences().length > 0);
  const companionSummaryEligible = createMemo(() => (
    companionCollapsed()
    && !companionActionVisible()
    && !composerFocused()
    && !isComposing()
    && !trimString(composerTextValue())
    && !composerHasAttachments()
    && !composerHasReferences()
    && Boolean(trimString(props.companionSummary?.visualText))
  ));
  const companionSummaryVisible = companionSummaryEligible;
  const companionDescriptionID = createMemo(() => (
    props.companionRegionID ? `${props.companionRegionID}-status` : undefined
  ));
  const companionSummaryAnnounces = createMemo(() => (
    props.companionSummary?.ephemeralKind === 'completion'
    || (
      (props.companionSummary?.priorityStatus === 'running' || props.companionSummary?.priorityStatus === 'queued')
      && props.companionSummary?.progressKind !== 'tool'
      && props.companionSummary?.progressKind !== 'output'
    )
  ));

  const composerPlaceholder = createMemo(() => {
    if (selectedThreadDetailPending()) return copy().chat.threadLoading;
    if (selectedThreadReadOnly()) return selectedThreadReadOnlyDisplay();
    if (surfaceWarmupActive() && !selectedInputRequest()) return copy().chat.warmupComposerPlaceholder;
    if (!selectedInputRequest()) return copy().chat.placeholder;
    const question = activeInputQuestion();
    if (!question || !questionAllowsText(question)) {
      return chatCopyValue('inputRequestChoicePlaceholder', 'Choose an option to continue.');
    }
    return trimString(question.write_placeholder)
      || trimString(question.question)
      || chatCopyValue('inputRequestComposerPlaceholder', 'Reply to continue this conversation.');
  });

  const composerTextareaDisabled = createMemo(() => {
    if (composerSharedOperationActive()) return true;
    if (selectedComposerApprovalDisplayAction()) return true;
    if (selectedThreadDetailPending()) return true;
    if (selectedThreadReadOnly()) return true;
    if (chatRunning()) return true;
    if (!selectedInputRequest()) return false;
    const question = activeInputQuestion();
    return inputSubmitting() || !question || !questionAllowsText(question);
  });

  const composerTextareaReadOnly = createMemo(() => (
    composerReferenceMutationCount() > 0
  ));

  const focusComposerFromBlankArea = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (event.button !== 0 || event.defaultPrevented) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('textarea, input, button, a, select, [role="button"], [role="option"], [contenteditable="true"]')) return;
    const field = composerRef;
    if (
      !(field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement)
      || field.disabled
      || !field.isConnected
      || !event.currentTarget.contains(field)
    ) return;
    const alreadyFocused = document.activeElement === field;
    event.preventDefault();
    field.focus({ preventScroll: true });
    if (!alreadyFocused && field instanceof HTMLTextAreaElement) {
      const end = field.value.length;
      field.setSelectionRange(end, end);
      syncComposerSelection(field);
    }
  };

  const composerReferenceEditingAllowed = createMemo(() => (
    composerAttachmentEditingAllowed()
    && !composerTextareaDisabled()
    && Boolean(displayedWorkingDirectory())
    && composerReferenceIndex !== null
  ));
  const composerReferenceToken = createMemo<FlowerComposerReferenceToken | undefined>(() => {
    if (!composerReferenceEditingAllowed() || isComposing()) return undefined;
    const selection = composerSelection();
    return findFlowerComposerReferenceToken({
      text: currentComposerSessionDraft().chatDraft,
      selectionStart: selection.start,
      selectionEnd: selection.end,
      isComposing: isComposing(),
    });
  });
  const composerReferenceTokenSignature = createMemo(() => {
    const token = composerReferenceToken();
    if (!token) return '';
    return [
      currentComposerSessionKey(),
      displayedWorkingDirectory(),
      token.range.start,
      token.range.end,
      token.query,
    ].join('\0');
  });
  const composerReferenceCandidateKey = (candidate: FlowerComposerReferenceCandidate): string => (
    `${candidate.kind}\0${normalizeFlowerComposerReferencePath(candidate.path)}`
  );
  const composerReferenceCandidates = createMemo(() => {
    const state = composerReferenceSearchState();
    return state.status === 'idle' ? [] : state.candidates;
  });
  const composerReferenceMenuVisible = createMemo(() => {
    const signature = composerReferenceTokenSignature();
    const state = composerReferenceSearchState();
    const hasStableContent = state.status === 'ready'
      || state.status === 'empty'
      || state.status === 'error'
      || (state.status !== 'idle' && state.candidates.length > 0)
      || composerReferenceLoadingVisible();
    return Boolean(
      composerFocused()
      && signature
      && signature !== composerReferenceDismissedSignature()
      && state.status !== 'idle'
      && hasStableContent
      && composerReferenceMutationCount() === 0
      && !selectedInputRequest()
      && !selectedComposerApprovalDisplayAction(),
    );
  });
  const composerReferenceActiveCandidate = createMemo(() => {
    const candidates = composerReferenceCandidates();
    const activeKey = composerReferenceActiveKey();
    return candidates.find((candidate) => composerReferenceCandidateKey(candidate) === activeKey) ?? candidates[0];
  });
  const syncComposerSelection = (target: HTMLTextAreaElement | HTMLInputElement) => {
    setComposerSelection({
      start: Math.max(0, target.selectionStart ?? 0),
      end: Math.max(0, target.selectionEnd ?? 0),
    });
  };
  const focusComposerAt = (cursor: number, preserveExternalFocus = false) => {
    requestAnimationFrame(() => {
      const target = composerRef;
      if (!(target instanceof HTMLTextAreaElement) || target.disabled) return;
      if (
        preserveExternalFocus
        && document.activeElement !== target
        && document.activeElement !== document.body
      ) return;
      target.focus({ preventScroll: true });
      target.setSelectionRange(cursor, cursor);
      setComposerSelection({ start: cursor, end: cursor });
    });
  };
  let composerReferenceSequence = 0;
  let composerReferenceLoadingTimer: number | undefined;
  const createComposerReferenceLocalID = (): string => {
    const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}_${composerReferenceSequence += 1}`;
    return `flower_ref_${uuid}`;
  };
  const beginComposerReferenceMutation = (): boolean => {
    if (composerReferenceMutationActive()) return false;
    setComposerReferenceMutationCount(1);
    return true;
  };
  const finishComposerReferenceMutation = () => {
    setComposerReferenceMutationCount((count) => Math.max(0, count - 1));
  };
  const commitComposerReference = async (candidate: FlowerComposerReferenceCandidate) => {
    if (!beginComposerReferenceMutation()) return;
    try {
      const localDraft = currentComposerSessionDraft();
      const selection = composerRef instanceof HTMLTextAreaElement
        ? { start: composerRef.selectionStart, end: composerRef.selectionEnd }
        : composerSelection();
      const token = findFlowerComposerReferenceToken({
        text: localDraft.chatDraft,
        selectionStart: selection.start,
        selectionEnd: selection.end,
      });
      if (!token) return;
      const operation = currentComposerDraftOperation();
      if (!composerDraftOperationCurrent(operation)) return;
      if (draftSubmissionActive(operation.session.snapshot().value)) return;
      if (currentComposerSessionDraft().chatDraft !== localDraft.chatDraft) return;
      const replacement = replaceFlowerComposerReferenceToken(localDraft.chatDraft, token.range);
      const normalizedPath = normalizeFlowerComposerReferencePath(candidate.path);
      const kind = candidate.kind;
      const identity = `${kind}\0${normalizedPath}`;
      const newReference: FlowerComposerDraftReference = {
        local_id: createComposerReferenceLocalID(),
        kind,
        path: normalizedPath,
        label: basenameFromAbsolutePath(normalizedPath, candidate.label),
      };
      const before = operation.session.snapshot();
      if (before.value.text !== localDraft.chatDraft) return;
      const existing = before.value.references.some((reference) => (
        `${reference.kind}\0${normalizeFlowerComposerReferencePath(reference.path)}` === identity
      ));
      const result = operation.session.mutate((value) => {
        if (value.text !== localDraft.chatDraft) return value;
        const alreadyExists = value.references.some((reference) => (
          `${reference.kind}\0${normalizeFlowerComposerReferencePath(reference.path)}` === identity
        ));
        return {
          ...value,
          text: replacement.text,
          references: alreadyExists ? value.references : [...value.references, newReference],
        };
      });
      if (!composerDraftOperationCurrent(operation)) return;
      if (result.snapshot.value.text !== replacement.text) return;
      updateComposerSessionDraft(operation.sessionKey, (draft) => ({
        ...draft,
        chatDraft: result.snapshot.value.text,
        references: result.snapshot.value.references,
      }));
      setComposerReferenceAnnouncement(existing
        ? copy().chat.composerReferenceExists(normalizedPath)
        : copy().chat.composerReferenceAdded(normalizedPath));
      setComposerReferenceDismissedSignature('');
      composerReferenceIndex?.softAbort();
      focusComposerAt(replacement.cursor, true);
    } finally {
      finishComposerReferenceMutation();
    }
  };
  const completeComposerReference = (candidate: FlowerComposerReferenceCandidate) => {
    const target = composerRef;
    if (!(target instanceof HTMLTextAreaElement) || composerReferenceMutationActive()) return;
    const draft = currentComposerSessionDraft().chatDraft;
    const token = findFlowerComposerReferenceToken({
      text: draft,
      selectionStart: target.selectionStart,
      selectionEnd: target.selectionEnd,
    });
    if (!token) return;
    const root = normalizeFlowerComposerReferencePath(displayedWorkingDirectory());
    const path = normalizeFlowerComposerReferencePath(candidate.path);
    const rootPrefix = root === '/' ? '/' : `${root}/`;
    const relative = path.startsWith(rootPrefix) ? path.slice(rootPrefix.length) : candidate.label;
    const completedToken = `@${relative}${candidate.kind === 'directory' ? '/' : ''}`;
    const nextText = `${draft.slice(0, token.range.start)}${completedToken}${draft.slice(token.range.end)}`;
    const cursor = token.range.start + completedToken.length;
    updateComposerText(nextText);
    setComposerReferenceDismissedSignature('');
    setComposerReferenceActiveKey('');
    scheduleComposerSelection(cursor, cursor, currentComposerSessionKey(), nextText);
  };
  const removeComposerReference = async (reference: FlowerComposerDraftReference, index: number) => {
    if (!beginComposerReferenceMutation()) return;
    const focusOwner = document.activeElement;
    const removeButton = composerReferenceRemoveButtons.get(reference.local_id);
    const restoreComposerFocus = (
      focusOwner === composerRef
      || focusOwner === removeButton
      || focusOwner === document.body
    );
    try {
      const operation = currentComposerDraftOperation();
      if (!composerDraftOperationCurrent(operation)) return;
      if (draftSubmissionActive(operation.session.snapshot().value)) return;
      const result = operation.session.mutate((value) => ({
        ...value,
        references: value.references.filter((item) => item.local_id !== reference.local_id),
      }));
      if (!composerDraftOperationCurrent(operation)) return;
      updateComposerSessionDraft(operation.sessionKey, (draft) => ({
        ...draft,
        references: result.snapshot.value.references,
      }));
      requestAnimationFrame(() => {
        if (!restoreComposerFocus) return;
        const activeElement = document.activeElement;
        if (
          activeElement !== focusOwner
          && activeElement !== removeButton
          && activeElement !== document.body
        ) return;
        const next = result.snapshot.value.references[index] ?? result.snapshot.value.references[index - 1];
        const button = next ? composerReferenceRemoveButtons.get(next.local_id) : undefined;
        if (button) button.focus({ preventScroll: true });
        else focusComposerAt(composerSelection().start, true);
      });
    } finally {
      finishComposerReferenceMutation();
    }
  };

  createEffect(() => {
    const token = composerReferenceToken();
    const signature = composerReferenceTokenSignature();
    const rootPath = displayedWorkingDirectory();
    if (!composerReferenceIndex || !token || !signature || signature === composerReferenceDismissedSignature() || !rootPath) {
      composerReferenceIndex?.softAbort();
      return;
    }
    void composerReferenceIndex.search({
      cacheKey: props.adapter.runtime.runtime_id,
      rootPath,
      query: token.query,
    });
  });
  createEffect(() => {
    const state = composerReferenceSearchState();
    if (composerReferenceLoadingTimer !== undefined) {
      window.clearTimeout(composerReferenceLoadingTimer);
      composerReferenceLoadingTimer = undefined;
    }
    if (state.status !== 'loading' || state.candidates.length > 0) {
      setComposerReferenceLoadingVisible(false);
      return;
    }
    composerReferenceLoadingTimer = window.setTimeout(() => {
      composerReferenceLoadingTimer = undefined;
      if (composerReferenceSearchState().generation === state.generation) {
        setComposerReferenceLoadingVisible(true);
      }
    }, 140);
  });
  onCleanup(() => {
    if (composerReferenceLoadingTimer !== undefined) window.clearTimeout(composerReferenceLoadingTimer);
  });
  createEffect(() => {
    const candidates = composerReferenceCandidates();
    const activeKey = composerReferenceActiveKey();
    if (candidates.some((candidate) => composerReferenceCandidateKey(candidate) === activeKey)) return;
    setComposerReferenceActiveKey(candidates[0] ? composerReferenceCandidateKey(candidates[0]) : '');
  });
  const composerReferenceActiveOptionID = createMemo(() => {
    const active = composerReferenceActiveCandidate();
    const index = active ? composerReferenceCandidates().findIndex((candidate) => (
      composerReferenceCandidateKey(candidate) === composerReferenceCandidateKey(active)
    )) : -1;
    return index >= 0 ? `${FLOWER_COMPOSER_REFERENCE_OPTION_PREFIX}${index}` : undefined;
  });
  const updateComposerReferenceMenuPosition = () => {
    if (composerReferenceMenuPositionFrame) return;
    composerReferenceMenuPositionFrame = requestAnimationFrame(() => {
      composerReferenceMenuPositionFrame = 0;
      const anchor = composerRef?.closest<HTMLElement>('.flower-composer');
      const rect = anchor?.getBoundingClientRect();
      if (!rect) return;
      const measuredHeight = composerReferenceMenuRef?.getBoundingClientRect().height;
      const height = measuredHeight && measuredHeight > 0
        ? measuredHeight
        : composerReferenceMenuHeight();
      const visualViewport = window.visualViewport;
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (visualViewport?.height ?? window.innerHeight);
      const aboveY = rect.top - height - FLOWER_COMPOSER_REFERENCE_MENU_GAP;
      const belowY = rect.bottom + FLOWER_COMPOSER_REFERENCE_MENU_GAP;
      const fitsAbove = aboveY >= viewportTop + FLOWER_COMPOSER_REFERENCE_VIEWPORT_MARGIN;
      const fitsBelow = belowY + height <= viewportBottom - FLOWER_COMPOSER_REFERENCE_VIEWPORT_MARGIN;
      const y = fitsAbove || !fitsBelow
        ? Math.max(viewportTop + FLOWER_COMPOSER_REFERENCE_VIEWPORT_MARGIN, aboveY)
        : belowY;
      const width = Math.max(240, Math.min(480, rect.width));
      setComposerReferenceMenuWidth(width);
      if (measuredHeight && measuredHeight > 0) setComposerReferenceMenuHeight(measuredHeight);
      setComposerReferenceMenuPosition({ x: rect.left, y });
    });
  };
  const retryComposerReferenceSearch = () => {
    const token = composerReferenceToken();
    const rootPath = displayedWorkingDirectory();
    if (!composerReferenceIndex || !token || !rootPath) return;
    composerReferenceIndex.invalidate(props.adapter.runtime.runtime_id);
    void composerReferenceIndex.search({
      cacheKey: props.adapter.runtime.runtime_id,
      rootPath,
      query: token.query,
    });
  };
  createEffect(() => {
    if (!composerReferenceMenuVisible()) return;
    const searchState = composerReferenceSearchState();
    const candidateCount = composerReferenceCandidates().length;
    if (searchState.status === 'idle' && candidateCount === 0) return;
    updateComposerReferenceMenuPosition();
    const target = composerRef?.closest<HTMLElement>('.flower-composer');
    const observer = typeof ResizeObserver === 'function' && target
      ? new ResizeObserver(updateComposerReferenceMenuPosition)
      : null;
    if (target) observer?.observe(target);
    if (composerReferenceMenuRef) observer?.observe(composerReferenceMenuRef);
    const menuObserverFrame = requestAnimationFrame(() => {
      if (composerReferenceMenuRef) observer?.observe(composerReferenceMenuRef);
      updateComposerReferenceMenuPosition();
    });
    let settleFrame = 0;
    const firstSettleFrame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(updateComposerReferenceMenuPosition);
    });
    const visualViewport = window.visualViewport;
    window.addEventListener('resize', updateComposerReferenceMenuPosition);
    window.addEventListener('scroll', updateComposerReferenceMenuPosition, true);
    visualViewport?.addEventListener('resize', updateComposerReferenceMenuPosition);
    visualViewport?.addEventListener('scroll', updateComposerReferenceMenuPosition);
    onCleanup(() => {
      cancelAnimationFrame(menuObserverFrame);
      cancelAnimationFrame(firstSettleFrame);
      if (settleFrame) cancelAnimationFrame(settleFrame);
      observer?.disconnect();
      if (composerReferenceMenuPositionFrame) {
        cancelAnimationFrame(composerReferenceMenuPositionFrame);
        composerReferenceMenuPositionFrame = 0;
      }
      window.removeEventListener('resize', updateComposerReferenceMenuPosition);
      window.removeEventListener('scroll', updateComposerReferenceMenuPosition, true);
      visualViewport?.removeEventListener('resize', updateComposerReferenceMenuPosition);
      visualViewport?.removeEventListener('scroll', updateComposerReferenceMenuPosition);
    });
  });
  createEffect(() => {
    const optionID = composerReferenceMenuVisible() ? composerReferenceActiveOptionID() : undefined;
    if (!optionID) return;
    requestAnimationFrame(() => document.getElementById(optionID)?.scrollIntoView({ block: 'nearest' }));
  });

  const composerChatDraftText = createMemo(() => trimString(currentComposerSessionDraft().chatDraft));
  const composerChatDraftHasRawText = createMemo(() => currentComposerSessionDraft().chatDraft.length > 0);
  const composerSlashCommand = createMemo(() => (selectedInputRequest() || selectedComposerApprovalDisplayAction()) ? { kind: 'none' as const } : parseFlowerSlashCommand(composerChatDraftText()));
  const composerCommandMenuVisible = createMemo(() => (
    !composerReferenceMenuVisible()
    && !selectedComposerApprovalDisplayAction()
    && !selectedInputRequest()
    && composerSlashCommand().kind === 'suggest'
  ));
  const composerPrimaryActionIsCommand = createMemo(() => composerSlashCommand().kind === 'intent');
  const composerPrimaryActionIsStop = createMemo(() => (
    longTextPreparing()
    || pendingAdmissionCanStop()
    || (selectedThreadCanStop() && !composerTextOverLimit() && !composerChatDraftText() && !composerHasAttachments() && !composerHasReferences())
  ));
  type ComposerPrimaryAction = 'send' | 'stop' | 'compact' | 'cancel_long_text';
  const composerPrimaryActionKind = createMemo<ComposerPrimaryAction>(() => (
    longTextPreparing()
      ? 'cancel_long_text'
      : composerPrimaryActionIsStop()
      ? 'stop'
      : composerPrimaryActionIsCommand()
        ? 'compact'
        : 'send'
  ));
  const composerPrimaryActionIcon = createMemo(() => composerPrimaryActionIsStop() ? FlowerStopIcon : composerPrimaryActionIsCommand() ? Clock : ArrowUp);
  const composerPrimaryActionLabel = createMemo(() => composerPrimaryActionIsStop() ? copy().chat.stop : composerPrimaryActionIsCommand() ? copy().chat.compactContext : copy().chat.send);
  const composerPrimaryActionDisabled = createMemo(() => {
    if (composerReferenceMutationCount() > 0) return true;
    if (selectedComposerApprovalDisplayAction()) return true;
    if (selectedThreadDetailPending()) return true;
    if (composerSharedOperationActive() && !chatRunning()) return true;
    if (longTextPreparing()) return false;
    if (threadStopping()) return true;
    if (chatRunning()) return !pendingAdmissionCanStop() || deferredStopPending();
    if (selectedThreadReadOnly()) return true;
    if (composerSlashCommand().kind === 'invalid') return true;
    if (composerPrimaryActionIsCommand()) {
      return composerHasAttachments() || composerHasReferences() || compactSubmitting() || !readyForChat() || !!selectedInputRequest() || !selectedThreadID() || !selectedThreadHasContent();
    }
    if (composerHasSubmissionBlockingAttachments()) return true;
    if (composerTextOverLimit() && !currentAttachmentSnapshot().capability?.supports_long_text) return true;
    if (selectedThreadCanStop() && !composerTextOverLimit() && !composerHasAttachments() && !composerHasReferences()) return false;
    const hasSendableText = composerTextOverLimit() ? composerChatDraftHasRawText() : Boolean(composerChatDraftText());
    return !readyForChat() || !handlerAllowsSubmitIntent() || (!hasSendableText && !composerHasReadyAttachments() && !composerHasReferences());
  });
  const composerPrimaryActionLoading = createMemo(() => (
    threadStopping() || deferredStopPending() || (chatRunning() && !longTextPreparing() && !pendingAdmissionCanStop()) || (composerPrimaryActionIsCommand() && compactSubmitting())
  ));

  let capturedComposerPrimaryAction: ComposerPrimaryAction | undefined;
  const captureComposerPrimaryAction = () => {
    capturedComposerPrimaryAction = composerPrimaryActionKind();
  };
  const executeComposerPrimaryAction = (event: MouseEvent) => {
    const renderedAction = (event.currentTarget as HTMLElement).dataset.flowerPrimaryAction as ComposerPrimaryAction | undefined;
    const action = capturedComposerPrimaryAction ?? renderedAction ?? composerPrimaryActionKind();
    capturedComposerPrimaryAction = undefined;
    switch (action) {
      case 'cancel_long_text':
        cancelActiveLongTextSubmission?.();
        return;
      case 'stop':
        void stopSelectedThreadFromComposer();
        return;
      case 'compact':
        void executeCompactContextCommand();
        return;
      default:
        void submitChat();
    }
  };

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

  const submitInputRequest = async () => {
    const thread = selectedThread();
    const request = selectedInputRequest();
    if (selectedThreadDetailPending()) return;
    if (!thread || !request) return;
    const threadID = trimString(thread.thread_id);
    const answers = inputRequestAnswers();
    if (!answers) {
      notifyComposerError(chatCopyValue('inputRequestAnswerRequired', 'Answer every question before continuing.'));
      return;
    }
    const focusOwner = typeof document === 'undefined' ? null : document.activeElement;
    const promptID = trimString(request.prompt_id);
    const submittedDraft = currentComposerSessionDraft();
    batch(() => {
      setInputSubmittingPromptID(promptID);
      setConsumedInputAdmissions((current) => ({
        ...current,
        [threadID]: { promptID },
      }));
      updateComposerSessionDraft(threadID, (draft) => ({
        ...draft,
        inputPromptSignature: '',
        inputDrafts: {},
        activeInputQuestionID: '',
        reasoningOverride: undefined,
      }));
    });
    try {
      const reasoningSelection = serializeFlowerReasoningSelection(
        composerReasoningEnabled() ? composerReasoningOverride() ?? selectedWaitingReasoningSelection() : undefined,
      );
      const receipt: FlowerSubmitInputReceipt = await props.adapter.submitInput({
        thread_id: thread.thread_id,
        prompt_id: request.prompt_id,
        answers,
        ...(reasoningSelection ? { reasoning_selection: reasoningSelection } : {}),
      });
      if (
        trimString(receipt.thread_id) !== threadID
        || trimString(receipt.consumed_prompt_id) !== trimString(request.prompt_id)
        || !trimString(receipt.turn_id)
        || !trimString(receipt.run_id)
      ) {
        throw new Error('Flower input response admission returned an invalid receipt.');
      }
      const selectionCurrent = selectedThreadDetailMatches(threadID);
      if (selectionCurrent) {
        requestComposerFocus(focusOwner);
      }
    } catch (error) {
      batch(() => {
        setConsumedInputAdmissions((current) => {
          if (current[threadID]?.promptID !== promptID) return current;
          const next = { ...current };
          delete next[threadID];
          return next;
        });
        updateComposerSessionDraft(threadID, (draft) => ({
          ...draft,
          inputPromptSignature: submittedDraft.inputPromptSignature,
          inputDrafts: submittedDraft.inputDrafts,
          activeInputQuestionID: submittedDraft.activeInputQuestionID,
          reasoningOverride: submittedDraft.reasoningOverride,
        }));
        setInputSubmittingPromptID('');
      });
      if (selectedThreadDetailMatches(threadID)) {
        notifyComposerError(getErrorMessage(error));
      }
    } finally {
      setInputSubmittingPromptID('');
    }
  };

  const submitApprovalAction = async (action: FlowerApprovalAction, approved: boolean) => {
    let thread: FlowerThreadSnapshot | null = null;
    let started = false;
    let alreadySubmitting = false;
    batch(() => {
      thread = selectedThread();
      alreadySubmitting = approvalSubmitting()[action.action_id] !== undefined;
      const currentAction = flowerComposerApprovalAction(thread);
      if (
        alreadySubmitting
        || selectedThreadDetailPending()
        || selectedThreadReadOnly()
        || !thread
        || currentAction?.action_id !== action.action_id
      ) {
        return;
      }
      const threadID = trimString(thread.thread_id);
      if (!threadID) return;
      clearApprovalDecisionResyncTimer();
      clearApprovalHandoffStyleSchedule();
      setApprovalHandoffStyleThreadID('');
      setApprovalDecisionHandoff({
        threadID,
        actionID: action.action_id,
        frozenAction: action,
        decision: approved ? 'approve' : 'reject',
        phase: 'submitting',
        submittedStreamGeneration: liveStreamGenerationValue(liveStreamGenerations.get(threadID)),
      });
      setApprovalSubmitting((current) => ({ ...current, [action.action_id]: approved ? 'approve' : 'reject' }));
      setApprovalQueueAnnouncement(copy().chat.toolApprovalSubmitting);
      started = true;
    });
    const submittedThread = thread as FlowerThreadSnapshot | null;
    if (!started || !submittedThread) {
      if (!alreadySubmitting) notifyComposerError(copy().chat.toolApprovalUnavailable);
      return;
    }
    const threadID = trimString(submittedThread.thread_id);
    const reloadCanonicalThread = async (): Promise<FlowerThreadSnapshot | null> => {
      if (!selectedThreadDetailMatches(threadID)) return null;
      return reloadSelectedThread(threadID, threadLoadSequence, 'user_action');
    };
    const reloadAfterFailedDecision = async (error: unknown) => {
      if (selectedThreadDetailMatches(threadID)) {
        notifyComposerError(getErrorMessage(error));
      }
      try {
        const refreshed = await reloadCanonicalThread();
        if (retryableApprovalAction(refreshed, action.action_id)) {
          cancelApprovalDecisionHandoff(action.action_id);
        }
        return refreshed;
      } catch (reloadError) {
        if (selectedThreadDetailMatches(threadID)) {
          notifyComposerError(getErrorMessage(reloadError));
        }
        return null;
      }
    };
    try {
      const receipt = await props.adapter.submitApproval(flowerApprovalRequest(submittedThread, action, approved));
      registerApprovalDecisionReceipt(threadID, action.action_id, receipt?.current_cursor);
      return;
    } catch (error) {
      if (!isFlowerApprovalConflict(error)) {
        await reloadAfterFailedDecision(error);
        return;
      }

      let refreshed: FlowerThreadSnapshot | null = null;
      try {
        refreshed = await reloadCanonicalThread();
      } catch (reloadError) {
        if (selectedThreadDetailMatches(threadID)) {
          notifyComposerError(getErrorMessage(reloadError));
        }
        return;
      }
      if (!selectedThreadDetailMatches(threadID)) return;
      const retryAction = retryableApprovalAction(refreshed, action.action_id);
      if (!retryAction || !refreshed) return;

      const retryHandoff = untrack(approvalDecisionHandoff);
      if (retryHandoff?.actionID === action.action_id) {
        setApprovalDecisionHandoff({
          ...retryHandoff,
          frozenAction: retryAction,
          phase: 'submitting',
          submittedStreamGeneration: liveStreamGenerationValue(liveStreamGenerations.get(threadID)),
          targetCursor: undefined,
        });
      }
      try {
        const receipt = await props.adapter.submitApproval(flowerApprovalRequest(refreshed, retryAction, approved));
        registerApprovalDecisionReceipt(threadID, action.action_id, receipt?.current_cursor);
      } catch (retryError) {
        if (isFlowerApprovalConflict(retryError)) {
          let finalSnapshot: FlowerThreadSnapshot | null = null;
          try {
            finalSnapshot = await reloadCanonicalThread();
          } catch (reloadError) {
            if (selectedThreadDetailMatches(threadID)) {
              notifyComposerError(getErrorMessage(reloadError));
            }
            return;
          }
          if (retryableApprovalAction(finalSnapshot, action.action_id)) {
            cancelApprovalDecisionHandoff(action.action_id);
          }
          return;
        }
        await reloadAfterFailedDecision(retryError);
        return;
      }
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
      notifyThreadActionError(getErrorMessage(error));
    }
  };

  const inputRequestPrompt = (
    request: FlowerInputRequest | null | undefined,
    options: Readonly<{ surface?: 'history' | 'composer' }> = {},
  ) => {
    const composerSurface = options.surface === 'composer';
    const visibleQuestions = (inputRequest: FlowerInputRequest) => (
      composerSurface
        ? inputRequest.questions.filter((question) => question.id === activeInputQuestion()?.id)
        : inputRequest.questions
    );
    return (
    <Show when={request}>
      {(inputRequest) => (
        <section
          class={cn('flower-input-request-panel', composerSurface && 'flower-input-request-surface')}
          data-flower-input-request-prompt
          aria-label={chatCopyValue('inputRequestTitle', 'Waiting for your reply')}
        >
          <Show when={!composerSurface}>
            <div class="flower-input-request-heading">
              <Clock class="flower-input-request-icon h-4 w-4" aria-hidden="true" />
              <div class="flower-input-request-title">{chatCopyValue('inputRequestTitle', 'Waiting for your reply')}</div>
            </div>
          </Show>
          <div class="flower-input-request-questions">
            <For each={visibleQuestions(inputRequest())}>
              {(question) => {
                const selectedChoiceID = () => trimString(questionDraft(question.id).choice_id);
                const summary = trimString(inputRequest().public_summary);
                const questionText = trimString(question.question);
                const showSummary = summary.length > 0 && summary !== questionText && question.id === inputRequest().questions[0]?.id;
                return (
                  <div
                    class={cn(
                      'flower-input-request-question',
                      activeInputQuestion()?.id === question.id && 'flower-input-request-question-active',
                    )}
                  >
                    <div class="flower-input-request-question-copy">
                      <div class="flower-input-request-question-header">{question.header}</div>
                      <Show when={showSummary}>
                        <div class="flower-input-request-description">{summary}</div>
                      </Show>
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
          <Show when={!composerSurface && inputTextQuestions().length > 1}>
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
          <Show when={composerSurface && inputRequest().questions.length > 1}>
            <nav class="flower-input-request-navigation" aria-label={chatCopyValue('inputRequestTitle', 'Waiting for your reply')}>
              <button
                type="button"
                class="flower-input-request-navigation-button"
                aria-label={chatCopyValue('inputRequestPrevious', 'Previous question')}
                title={chatCopyValue('inputRequestPrevious', 'Previous question')}
                disabled={inputSubmitting() || inputRequestQuestionIndex() <= 0}
                onClick={() => setActiveInputQuestionByOffset(-1)}
              >
                <ChevronLeft class="h-4 w-4" aria-hidden="true" />
              </button>
              <span class="flower-input-request-navigation-count" aria-live="polite">
                {inputRequestQuestionIndex() + 1} / {inputRequest().questions.length}
              </span>
              <button
                type="button"
                class="flower-input-request-navigation-button"
                aria-label={chatCopyValue('inputRequestNext', 'Next question')}
                title={chatCopyValue('inputRequestNext', 'Next question')}
                disabled={inputSubmitting() || inputRequestQuestionIndex() >= inputRequest().questions.length - 1}
                onClick={() => setActiveInputQuestionByOffset(1)}
              >
                <ChevronRight class="h-4 w-4" aria-hidden="true" />
              </button>
            </nav>
          </Show>
        </section>
      )}
    </Show>
    );
  };

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

  const approvalActionCard = (
    actionID: string,
    action: Accessor<FlowerApprovalAction>,
    options: Readonly<{ surface?: 'history' | 'composer' }> = {},
  ) => {
    const busy = () => approvalSubmitting()[actionID];
    const canDecide = () => approvalActionCanDecide(action());
    const disabled = () => busy() !== undefined || !canDecide();
    const composerSurface = options.surface === 'composer';
    const queueProgress = createMemo(() => {
      const queue = selectedThread()?.approval_queue;
      return composerSurface && queue && queue.total > 1
        ? `${queue.current_position} / ${queue.total}`
        : '';
    });
    const descriptionID = `flower-approval-description-${actionID}`;
    const statusID = `flower-approval-status-${actionID}`;
    const actionLabel = createMemo(() => action().summary.label || action().tool_name || copy().chat.toolApprovalRequired);
    const scopedThreadID = createMemo(() => (
      action().origin === 'delegated_subagent' && action().scope?.startsWith('thread:')
        ? action().scope!.slice('thread:'.length)
        : ''
    ));
    const subtaskLabel = createMemo(() => scopedThreadID() ? copy().chat.toolApprovalSubtaskSuffix(scopedThreadID()) : '');
    const commandText = createMemo(() => trimString(action().summary.command));
    const descriptionText = createMemo(() => action().summary.description || action().read_only_reason || '');
    const visibleEffects = createMemo(() => approvalVisibleEffects(action()));
    const visibleFlags = createMemo(() => approvalVisibleFlags(action()));
    const commandCopyKey = `approval:${actionID}:command`;
    const commandCopied = () => copiedApprovalAction() === commandCopyKey;
    const statusCopy = createMemo(() => !canDecide() ? action().read_only_reason || copy().chat.toolApprovalUnavailable : '');
    const describedBy = createMemo(() => [descriptionText() ? descriptionID : '', statusCopy() ? statusID : ''].filter(Boolean).join(' '));
    const unavailableCopy = createMemo(() => action().read_only_reason || copy().chat.toolApprovalUnavailable);
    const riskNote = () => {
      const notes: string[] = [];
      if (visibleFlags().includes('May reach outside the workspace')) notes.push(copy().chat.toolApprovalOutsideWorkspaceRisk);
      if (visibleEffects().includes('Writes files')) notes.push(copy().chat.toolApprovalWritesFilesRisk);
      return notes.length > 0 ? notes.join(' ') : '';
    };
    return (
      <section
        ref={composerSurface ? (element) => { composerApprovalCardRef = element; } : undefined}
        class={composerSurface ? 'flower-approval-surface' : 'flower-approval-card'}
        data-flower-approval-action-id={actionID}
        data-flower-approval-origin={action().origin}
        data-flower-approval-surface-role={action().surface_role || 'primary_action'}
        data-flower-composer-approval={composerSurface ? 'true' : undefined}
      >
        <div class="flower-approval-body">
          <Show when={!composerSurface || queueProgress()}>
            <div class="flower-approval-header">
              <Show when={!composerSurface}>
                <p class="flower-approval-intro">{copy().chat.toolApprovalComposerTitle}</p>
              </Show>
              <Show when={queueProgress()}>
                {(progress) => <span class="flower-approval-queue-progress" aria-label={`${copy().chat.toolApprovalRequired} ${progress()}`}>{progress()}</span>}
              </Show>
              <Show when={!composerSurface && commandText()}>
                <button
                  type="button"
                  class="flower-approval-copy-btn"
                  data-copied={commandCopied() ? 'true' : 'false'}
                  aria-label={`${copy().chat.toolApprovalCopyCommand}${subtaskLabel()}`}
                  title={commandCopied() ? copy().chat.toolApprovalCopied : copy().chat.toolApprovalCopyCommand}
                  onClick={() => void copyApprovalCommand(action())}
                >
                  <Copy class="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </Show>
            </div>
          </Show>
          <Show when={composerSurface}>
            <p class="flower-approval-question" id={`flower-approval-question-${actionID}`}>
              {copy().chat.toolApprovalComposerTitle}
            </p>
          </Show>
          <Show when={commandText()}>
            {(command) => (
              <pre class="flower-approval-command-text"><FlowerShellCommandHighlight command={command()} /></pre>
            )}
          </Show>
          <Show when={!commandText() && (action().summary.targets?.length ?? 0) > 0}>
            <div class="flower-approval-targets">
              <For each={action().summary.targets ?? []}>
                {(target) => <span class="flower-approval-target">{target.label}</span>}
              </For>
            </div>
          </Show>
          <Show when={!commandText() && !((action().summary.targets?.length ?? 0) > 0) && action().summary.label}>
            <p class="flower-approval-fallback-label">{action().summary.label}</p>
          </Show>
          <Show when={riskNote()}>
            {(note) => <p class="flower-approval-risk">{note()}</p>}
          </Show>
          <Show when={statusCopy()}>
            {(message) => <p class="flower-approval-status">{message()}</p>}
          </Show>
        </div>
        <div class={cn('flower-approval-actions', composerSurface && 'flower-composer-approval-actions')}>
            <Show when={canDecide()} fallback={<div class="flower-approval-unavailable">{unavailableCopy()}</div>}>
              <Button
                variant="outline"
                size="sm"
                class={composerSurface ? 'flower-composer-approval-decision' : undefined}
                disabled={disabled()}
                loading={busy() === 'reject'}
                aria-busy={busy() === 'reject' ? 'true' : undefined}
                aria-label={copy().chat.toolApprovalRejectAction(actionLabel(), subtaskLabel())}
                aria-describedby={describedBy() || undefined}
                onClick={() => void submitApprovalAction(action(), false)}
              >
                {copy().chat.toolApprovalReject}
              </Button>
              <Button
                variant="primary"
                size="sm"
                class={composerSurface ? 'flower-composer-approval-decision' : undefined}
                disabled={disabled()}
                loading={busy() === 'approve'}
                aria-busy={busy() === 'approve' ? 'true' : undefined}
                aria-label={copy().chat.toolApprovalApproveAction(actionLabel(), subtaskLabel())}
                aria-describedby={describedBy() || undefined}
                onClick={() => void submitApprovalAction(action(), true)}
              >
                {copy().chat.toolApprovalApprove}
              </Button>
            </Show>
        </div>
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
          {(action) => approvalActionCard(action.action_id, () => action)}
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

  const formatActivityDuration = (durationMs: number | undefined): string => {
    const value = Number(durationMs ?? 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value < 1000) return `${Math.round(value)}ms`;
    if (value < 60_000) return `${Math.round(value / 1000)}s`;
    const minutes = Math.floor(value / 60_000);
    const seconds = Math.round((value % 60_000) / 1000);
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  };

  const activityItemKey = (messageID: string, timeline: FlowerActivityTimelineBlock, item: FlowerActivityItem): string => flowerActivityIdentity({
    threadID: timeline.thread_id,
    runID: timeline.run_id,
    turnID: timeline.turn_id,
    itemID: item.item_id,
  });

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
    if (
      item.kind === 'control'
      && trimString(item.tool_name) === 'ask_user'
      && (item.status === 'pending' || item.status === 'running' || item.status === 'waiting')
    ) return false;
    if (activityItemAwaitingApproval(item) && !activityItemHasVisiblePayload(item)) return false;
    return true;
  };

  const activityItemAriaLabel = (item: FlowerActivityItem, timeline: FlowerActivityTimelineBlock): string => (
    [
      presentFlowerActivityItem(item, timeline.file_actions, {
        subagents: subagentsCopy(),
        subagentSummaries: selectedThread()?.subagents ?? [],
      }).label,
      copy().chat.toolStatuses[item.status],
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

  const attachmentPreviewTargetForActivity = (
    item: FlowerActivityItem,
    timeline: FlowerActivityTimelineBlock,
    displayName: string,
  ): FlowerMessageAttachmentPreviewTarget | null => {
    if (trimString(item.tool_name) !== 'attachment.read') return null;
    const turnID = trimString(timeline.turn_id);
    const expectedName = trimString(displayName) || trimString(item.label);
    const candidates: FlowerMessageAttachmentPreviewTarget[] = [];
    for (const message of selectedThread()?.messages ?? []) {
      if (message.role !== 'user' || (turnID && trimString(message.turn_id) !== turnID)) continue;
      for (const [index, block] of (message.blocks ?? []).entries()) {
        if (block.type === 'file' && trimString(block.url)) {
          candidates.push({
            id: `${message.id}:attachment:${index}`,
            name: trimString(block.name) || expectedName || attachmentCopy().preview,
            mimeType: trimString(block.mimeType),
            url: block.url,
          });
        } else if (block.type === 'image' && trimString(block.src)) {
          candidates.push({
            id: `${message.id}:attachment:${index}`,
            name: trimString(block.alt) || expectedName || attachmentCopy().preview,
            mimeType: 'image/*',
            url: block.src,
          });
        }
      }
    }
    return candidates.find((candidate) => trimString(candidate.name) === expectedName)
      ?? (candidates.length === 1 ? candidates[0] : null);
  };

  const openActivityFileBrowser = (messageID: string, blockIndex: number, itemID: string, action: FlowerActivityFileAction) => {
    if (selectedThreadDetailPending()) return;
    if (!action.can_browse_directory || !trimString(action.action_id) || !props.adapter.openFileBrowser) return;
    void props.adapter.openFileBrowser({
      thread_id: trimString(selectedThreadDetailID()) || undefined,
      message_id: messageID,
      block_index: blockIndex,
      item_id: itemID,
      action_id: action.action_id,
    }).catch((error) => {
      notifyThreadActionError(getErrorMessage(error));
    });
  };

  const openActivityFilePreview = (messageID: string, blockIndex: number, itemID: string, action: FlowerActivityFileAction) => {
    if (selectedThreadDetailPending()) return;
    if (!action.can_preview || !trimString(action.action_id) || !props.adapter.openFilePreview) return;
    void props.adapter.openFilePreview({
      thread_id: trimString(selectedThreadDetailID()) || undefined,
      message_id: messageID,
      block_index: blockIndex,
      item_id: itemID,
      action_id: action.action_id,
    }).catch((error) => {
      notifyThreadActionError(getErrorMessage(error));
    });
  };

  const fileActionButtons = (
    messageID: string,
    blockIndex: number,
    itemID: string,
    action: FlowerActivityFileAction | null,
    attachmentTarget: FlowerMessageAttachmentPreviewTarget | null = null,
  ) => {
    const canonicalActionID = trimString(action?.action_id);
    const canPreview = Boolean(
      attachmentTarget
      || (action?.can_preview && canonicalActionID && props.adapter.openFilePreview),
    );
    const canBrowseDirectory = Boolean(
      action?.can_browse_directory
      && canonicalActionID
      && props.adapter.openFileBrowser,
    );
    const displayName = trimString(attachmentTarget?.name) || trimString(action?.display_name) || 'file';
    return (
      <Show when={canPreview || canBrowseDirectory}>
        <div class="flower-activity-file-actions" aria-label="File actions">
          <Show when={canPreview}>
            <button
              type="button"
              class="flower-activity-file-action-button"
              title="Preview file"
              aria-label={`Preview ${displayName}`}
              disabled={!attachmentTarget && selectedThreadDetailPending()}
              onClick={(event) => {
                event.stopPropagation();
                if (attachmentTarget) {
                  openMessageAttachmentPreview(attachmentTarget);
                  return;
                }
                if (action) openActivityFilePreview(messageID, blockIndex, itemID, action);
              }}
            >
              <FileText class="h-3.5 w-3.5" />
            </button>
          </Show>
          <Show when={canBrowseDirectory && action}>
            <button
              type="button"
              class="flower-activity-file-action-button"
              title="Browse folder"
              aria-label={`Browse folder for ${displayName}`}
              disabled={selectedThreadDetailPending()}
              onClick={(event) => {
                event.stopPropagation();
                openActivityFileBrowser(messageID, blockIndex, itemID, action!);
              }}
            >
              <FolderOpen class="h-3.5 w-3.5" />
            </button>
          </Show>
        </div>
      </Show>
    );
  };

  const detailLinesBlock = (block: Extract<FlowerActivityDetailBlock, { kind: 'structured' }>) => (
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

  const normalizeTerminalSnapshotStatus = (raw: unknown): FlowerActivityStatus | '' => {
    const value = String(raw ?? '').trim().toLowerCase();
    if (value === 'success' || value === 'succeeded' || value === 'complete' || value === 'completed') return 'success';
    if (value === 'error' || value === 'failed' || value === 'timeout' || value === 'timed_out') return 'error';
    if (value === 'canceled' || value === 'cancelled' || value === 'aborted') return 'canceled';
    if (value === 'pending') return 'pending';
    if (value === 'running') return 'running';
    return '';
  };

  const terminalSnapshotOutput = (snapshot: FlowerTerminalProcessSnapshot): string => (
    String(snapshot.output).replace(/\r\n?/g, '\n')
  );

  type FlowerTerminalOutputContext = Readonly<{
    ownerThreadID: string;
    renderThreadID: string;
    runID: string;
    turnID: string;
    messageID: string;
    blockIndex: number;
    itemID: string;
    toolID: string;
  }>;

  type FlowerTerminalOutputBlockProps = Readonly<{
    context: Accessor<FlowerTerminalOutputContext>;
    block: Accessor<Extract<FlowerActivityDetailBlock, { kind: 'terminal_output' }>>;
    canonicalStatus: Accessor<FlowerActivityStatus>;
    approvalState: Accessor<FlowerActivityItem['approval_state']>;
    onSettledPresentation: () => void;
  }>;
  type FlowerNonTerminalDetailBlock = Exclude<FlowerActivityDetailBlock, { kind: 'terminal_output' }>;

  const TerminalOutputBlock: Component<FlowerTerminalOutputBlockProps> = (detailProps) => {
    const terminal = () => detailProps.block().terminal;
    const [commandExpanded, setCommandExpanded] = createSignal(false);
    const [commandCopied, setCommandCopied] = createSignal(false);
    const [liveLastSeq, setLiveLastSeq] = createSignal(terminal().last_seq);
    const [liveError, setLiveError] = createSignal('');
    const outputViewport = createTerminalOutputViewportController({
      onPresentationFrame: () => {
        const status = detailProps.canonicalStatus();
        if (status === 'success' || status === 'canceled') {
          detailProps.onSettledPresentation();
        }
      },
    });
    let commandCopyResetTimer: number | undefined;
    const command = () => trimString(terminal().command);
    const commandPanelID = () => `flower-terminal-command-${flowerActivityIdentity({
      threadID: detailProps.context().ownerThreadID,
      runID: detailProps.context().runID,
      turnID: detailProps.context().turnID,
      itemID: detailProps.context().itemID,
    }).replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
    const processID = () => trimString(terminal().process_id);
    const terminalIdentity = (): TerminalVisibleOutputIdentity => {
      const context = detailProps.context();
      return {
        surface_scope: 'flower-surface',
        owner_thread_id: context.ownerThreadID,
        render_thread_id: context.renderThreadID,
        run_id: context.runID,
        turn_id: context.turnID,
        message_id: context.messageID,
        block_index: context.blockIndex,
        item_id: context.itemID,
        tool_id: context.toolID,
        process_id: processID(),
        command: terminal().command,
      };
    };
    const payloadOutput = () => String(terminal().output).replace(/\r\n?/g, '\n');
    const initialOutput = terminalVisibleOutputStore.replaceSnapshot(terminalIdentity(), {
      output: payloadOutput(),
      first_seq: terminal().first_seq,
      last_seq: terminal().last_seq,
      truncated: terminal().truncated,
    });
    const [liveOutput, setLiveOutput] = createSignal(initialOutput);
    const canReadLiveOutput = () => (
      !!props.adapter.readTerminalProcess &&
      detailProps.context().runID !== '' &&
      processID() !== '' &&
      (detailProps.canonicalStatus() === 'running' || detailProps.canonicalStatus() === 'pending')
    );
    const displayStatus = detailProps.canonicalStatus;
    const displayCanceled = () => displayStatus() === 'canceled';
    const displayUserRejected = () => detailProps.approvalState() === 'rejected';
    const visibleOutput = liveOutput;
    const displayOutput = () => {
      const output = visibleOutput();
      if (output.trim()) return output;
      if (displayUserRejected()) return '';
      if (liveError()) return `Live output unavailable: ${liveError()}`;
      if (canReadLiveOutput() && terminalListeningPlaceholderVisible(output, displayStatus())) return 'Listening for output...';
      if ((displayStatus() === 'running' || displayStatus() === 'pending') && processID() === '') {
        return 'Live output handle is not available yet.';
      }
      return 'No output captured.';
    };
    const muted = () => !visibleOutput().trim() && !displayUserRejected();
    const copyTerminalCommand = async () => {
      const value = command();
      if (!value) return;
      try {
        await writeTextToClipboard(value);
        setCommandCopied(true);
        if (commandCopyResetTimer !== undefined) {
          window.clearTimeout(commandCopyResetTimer);
        }
        commandCopyResetTimer = window.setTimeout(() => {
          setCommandCopied(false);
          commandCopyResetTimer = undefined;
        }, MESSAGE_COPY_RESET_MS);
      } catch (error) {
        setCommandCopied(false);
        notifyThreadActionError(getErrorMessage(error));
      }
    };

    const applyTerminalSnapshot = (snapshot: FlowerTerminalProcessSnapshot) => {
      const output = terminalSnapshotOutput(snapshot);
      const mergedOutput = terminalVisibleOutputStore.appendDelta(terminalIdentity(), {
        output,
        first_seq: snapshot.first_seq,
        last_seq: snapshot.last_seq,
        truncated: snapshot.truncated,
      });
      if (mergedOutput !== liveOutput()) {
        setLiveOutput(mergedOutput);
      }
      setLiveLastSeq(Math.max(0, Math.floor(snapshot.last_seq)));
    };

    createEffect(() => {
      if (!canReadLiveOutput()) return;
      let disposed = false;
      let timer: number | undefined;
      const poll = async () => {
        if (disposed || !canReadLiveOutput() || !props.adapter.readTerminalProcess) return;
        try {
          const snapshot = await props.adapter.readTerminalProcess({
            run_id: detailProps.context().runID,
            process_id: processID(),
            after_seq: untrack(() => liveLastSeq()),
          });
          if (disposed) return;
          setLiveError('');
          applyTerminalSnapshot(snapshot);
          const processStatus = normalizeTerminalSnapshotStatus(snapshot.status);
          if (processStatus && processStatus !== 'running' && processStatus !== 'pending') return;
        } catch (error) {
          if (!disposed) setLiveError(getErrorMessage(error));
        }
        if (!disposed && canReadLiveOutput()) {
          timer = window.setTimeout(() => {
            void poll();
          }, 200);
        }
      };
      void poll();
      onCleanup(() => {
        disposed = true;
        if (timer !== undefined) {
          window.clearTimeout(timer);
        }
      });
    });

    createEffect(() => {
      const canonicalOutput = terminalVisibleOutputStore.replaceSnapshot(terminalIdentity(), {
        output: payloadOutput(),
        first_seq: terminal().first_seq,
        last_seq: terminal().last_seq,
        truncated: terminal().truncated,
      });
      if (canonicalOutput !== liveOutput()) {
        setLiveOutput(canonicalOutput);
      }
      setLiveLastSeq((current) => Math.max(current, Math.max(0, Math.floor(terminal().last_seq))));
    });

    createEffect(() => {
      displayOutput();
      displayStatus();
      outputViewport.notifyOutputChanged();
    });

    onCleanup(() => {
      outputViewport.dispose();
      if (commandCopyResetTimer !== undefined) {
        window.clearTimeout(commandCopyResetTimer);
      }
    });

    return (
      <section
        class={cn('flower-activity-terminal-panel', `flower-activity-terminal-panel-${displayStatus()}`)}
        data-flower-activity-terminal-panel
      >
        <div class="flower-activity-terminal-header">
          <span class="flower-activity-terminal-status">
            {statusIcon(displayStatus())}
            <Show when={detailProps.approvalState() === 'rejected'}>
              <span class="flower-activity-user-rejected-marker" aria-hidden="true">-</span>
            </Show>
          </span>
          <span class="flower-activity-terminal-prompt" aria-hidden="true">$</span>
          <span class="flower-activity-terminal-command">
            <FlowerShellCommandHighlight
              command={terminal().command}
              class="flower-activity-terminal-command-code"
              tokenClassPrefix="flower-activity-terminal-command-token"
            />
          </span>
          <div class="flower-activity-terminal-actions" aria-label="Terminal command actions">
            <Show when={command()}>
              <button
                type="button"
                class={cn('flower-activity-terminal-action-button', commandExpanded() && 'flower-activity-terminal-action-button-active')}
                aria-label={commandExpanded() ? copy().chat.hideFullCommand : copy().chat.showFullCommand}
                title={commandExpanded() ? copy().chat.hideFullCommand : copy().chat.showFullCommand}
                aria-expanded={commandExpanded()}
                aria-controls={commandPanelID()}
                onClick={(event) => {
                  event.stopPropagation();
                  setCommandExpanded((open) => !open);
                }}
              >
                <Show when={commandExpanded()} fallback={<ChevronRight class="h-3.5 w-3.5" />}>
                  <ChevronDown class="h-3.5 w-3.5" />
                </Show>
              </button>
              <button
                type="button"
                class={cn('flower-activity-terminal-action-button', commandCopied() && 'flower-activity-terminal-action-button-copied')}
                aria-label={commandCopied() ? copy().chat.commandCopied : copy().chat.copyCommand}
                title={commandCopied() ? copy().chat.commandCopied : copy().chat.copyCommand}
                data-copied={commandCopied() ? 'true' : 'false'}
                onClick={(event) => {
                  event.stopPropagation();
                  void copyTerminalCommand();
                }}
              >
                <Show when={commandCopied()} fallback={<Copy class="h-3.5 w-3.5" />}>
                  <Check class="h-3.5 w-3.5" />
                </Show>
              </button>
            </Show>
          </div>
        </div>
        <Show when={command() && commandExpanded()}>
          <div id={commandPanelID()} class="flower-activity-terminal-command-panel">
            <pre class="flower-activity-terminal-command-full">
              <FlowerShellCommandHighlight
                command={command()}
                class="flower-activity-terminal-command-full-code"
                tokenClassPrefix="flower-activity-terminal-command-token"
              />
            </pre>
          </div>
        </Show>
        <div
          ref={outputViewport.bind}
          class={cn('flower-activity-terminal-output', muted() && 'flower-activity-terminal-output-muted')}
          onScroll={outputViewport.onScroll}
          onWheel={outputViewport.onWheel}
        >
          <pre>
            {displayOutput()}
            <Show when={displayUserRejected()}>
              <span class="flower-activity-terminal-approval-rejected">{copy().chat.toolApprovalRejectedDetail}</span>
            </Show>
            <Show when={displayCanceled() && !displayUserRejected()}>
              <span class="flower-activity-terminal-canceled">{copy().chat.toolCallCanceled}</span>
            </Show>
          </pre>
        </div>
      </section>
    );
  };

  const webEntryList = (label: string, entries: readonly { title: string; url: string; snippet: string; source: string }[]) => (
    <Show when={entries.length > 0}>
      <div class="flower-activity-web-section">
        <div class="flower-activity-detail-heading">{label}</div>
        <div class="flower-activity-web-list" role="list">
          <For each={entries}>
            {(entry) => (
              <div class="flower-activity-web-entry" role="listitem">
                <div class="flower-activity-web-entry-title">{entry.title}</div>
                <Show when={entry.snippet}>
                  {(snippet) => <div class="flower-activity-web-entry-snippet">{snippet()}</div>}
                </Show>
                <Show when={entry.url || entry.source}>
                  <div class="flower-activity-web-entry-meta">{[entry.source, entry.url].filter(Boolean).join(' · ')}</div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );

  const webSearchBlock = (block: Extract<FlowerActivityDetailBlock, { kind: 'web_search' }>) => {
    const search = block.search;
    const resultCount = search.count === 1 ? '1 result' : `${search.count} results`;
    return (
      <section class="flower-activity-web-panel">
        <div class="flower-activity-web-summary">
          <Show when={search.query}>
            {(query) => <span class="flower-activity-web-query">{query()}</span>}
          </Show>
          <Show when={search.provider}>
            {(provider) => <span class="flower-activity-web-chip">{provider()}</span>}
          </Show>
          <Show when={search.count !== undefined}>
            <span class="flower-activity-web-chip">{resultCount}</span>
          </Show>
        </div>
        {webEntryList('Results', search.results)}
        {webEntryList('Matches', search.matches)}
        {webEntryList('Sections', search.sections)}
        {webEntryList('Sources', search.sources)}
      </section>
    );
  };

  const questionBlock = (block: Extract<FlowerActivityDetailBlock, { kind: 'question' }>) => (
    <section class="flower-activity-question-panel">
      <Show when={block.question.reason}>
        {(reason) => <div class="flower-activity-question-reason">{reason()}</div>}
      </Show>
      <Show when={block.question.required.length > 0}>
        <div class="flower-activity-question-required">
          <For each={block.question.required}>
            {(required) => <span class="flower-activity-question-chip">{required}</span>}
          </For>
        </div>
      </Show>
      <For each={block.question.questions}>
        {(question) => {
          const answer = () => block.question.answers.find((candidate) => candidate.question_id === question.id);
          return (
          <div class="flower-activity-question-item">
            <div class="flower-activity-question-text">{question.question}</div>
            <Show
              when={answer()}
              fallback={<Show when={question.choices.length > 0 || question.write_label}>
                <div class="flower-activity-question-choices">
                  <For each={question.choices}>
                    {(choice) => (
                      <span class="flower-activity-question-choice">
                        <span>{choice.label}</span>
                        <Show when={choice.description}>
                          {(description) => <small>{description()}</small>}
                        </Show>
                      </span>
                    )}
                  </For>
                  <Show when={question.write_label}>
                    {(label) => <span class="flower-activity-question-choice">{label()}</span>}
                  </Show>
                </div>
              </Show>}
            >
              {(resolved) => (
              <div class="flower-activity-question-choices">
                <span class="flower-activity-question-choice flower-activity-question-answer">
                  {resolved().redacted
                    ? chatCopyValue('inputRequestAnswerHidden', 'Answer hidden')
                    : resolved().values.join(', ')}
                </span>
              </div>
              )}
            </Show>
          </div>
          );
        }}
      </For>
      <Show when={block.question.questions.length === 0}>
        <div class="flower-activity-question-empty">Waiting for user input.</div>
      </Show>
    </section>
  );

  const completionList = (label: string, values: readonly string[]) => (
    <Show when={values.length > 0}>
      <div class="flower-activity-completion-section">
        <div class="flower-activity-detail-heading">{label}</div>
        <ul class="flower-activity-completion-list">
          <For each={values}>
            {(value) => <li>{value}</li>}
          </For>
        </ul>
      </div>
    </Show>
  );

  const completionBlock = (block: Extract<FlowerActivityDetailBlock, { kind: 'completion' }>) => {
    const value = block.completion;
    return (
      <section class="flower-activity-completion-panel">
        <Show when={value.result || value.summary || value.details}>
          <div class="flower-activity-completion-result">
            {value.result || value.summary || value.details}
          </div>
        </Show>
        {completionList('Evidence', value.evidence_refs)}
        {completionList('Risks', value.remaining_risks)}
        {completionList('Next', value.next_actions)}
      </section>
    );
  };

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

  const subagentsDetailForPresentation = (presentation: FlowerActivityPresentation) => (
    presentation.detailBlocks.find((block): block is Extract<FlowerActivityDetailBlock, { kind: 'subagents' }> => block.kind === 'subagents')?.subagents
  );

  const subagentElapsedText = (agent: FlowerActivitySubagentDetailItem, mode: 'none' | 'running' | 'final'): string => {
    const startedAt = agent.started_at_ms || agent.created_at_ms || 0;
    if (!startedAt || mode === 'none') return '';
    const endAt = mode === 'final' && agent.updated_at_ms ? agent.updated_at_ms : activityClockNow();
    const label = formatActivityDuration(Math.max(0, endAt - startedAt));
    if (!label) return '';
    return mode === 'running' ? `running ${label}` : label;
  };

  const subagentInlineElapsed = (presentation: FlowerActivityPresentation): string => {
    const detail = subagentsDetailForPresentation(presentation);
    if (!detail || detail.elapsed_mode === 'none') return '';
    const first = detail.items.find((agent) => agent.started_at_ms || agent.created_at_ms);
    return first ? subagentElapsedText(first, detail.elapsed_mode) : '';
  };

  const openSubagentMessages = (agent: FlowerActivitySubagentDetailItem) => {
    const action = agent.open_messages;
    if (!action?.thread_id) return;
    void openSubagentDetail({
      key: action.thread_id,
      threadID: action.thread_id,
      taskName: agent.name,
      taskDescription: agent.description,
      title: agent.name,
      displayName: presentSubagentTaskName(agent.name),
      agentType: agent.agent_type,
      status: 'unknown',
      action: 'inspect',
      canOpen: true,
      parentThreadID: selectedThreadID(),
      startedAtMs: agent.started_at_ms || agent.created_at_ms || 0,
      createdAtMs: agent.created_at_ms || agent.started_at_ms || 0,
      updatedAtMs: agent.updated_at_ms || agent.started_at_ms || agent.created_at_ms || activityClockNow(),
      itemStatus: 'success',
    });
  };

  const errorDetailBlock = (block: Extract<FlowerActivityDetailBlock, { kind: 'error' }>) => (
    <section class="flower-activity-error-panel" aria-label="Failure reason">
      <div class="flower-activity-error-message">{block.error.message}</div>
    </section>
  );

  const subagentsDetailBlock = (block: Extract<FlowerActivityDetailBlock, { kind: 'subagents' }>) => {
    const detail = block.subagents;
    return (
      <section class="flower-activity-subagents-panel" aria-label="Subagents">
        <Show when={detail.items.length > 0}>
          <div class="flower-activity-subagents-list" role="list">
            <For each={detail.items}>
              {(agent) => (
                <div class="flower-activity-subagents-item" role="listitem">
                  <div class="flower-activity-subagents-item-main">
                    <div class="flower-activity-subagents-item-head">
                      <span class="flower-activity-subagents-item-title-row">
                        <span class="flower-activity-subagents-item-title">{agent.name}</span>
                        <Show when={agent.open_messages}>
                          <button
                            type="button"
                            class="flower-activity-subagents-open"
                            aria-label={`Open subagent messages for ${agent.name}`}
                            title="Open subagent messages"
                            onClick={(event) => {
                              event.stopPropagation();
                              openSubagentMessages(agent);
                            }}
                          >
                            <ExternalLink class="h-3.5 w-3.5" />
                          </button>
                        </Show>
                      </span>
                      <span class="flower-activity-subagents-item-meta">
                        {[agent.show_status ? agent.status : '', subagentElapsedText(agent, detail.elapsed_mode)].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <Show when={agent.description}>
                      {(description) => <div class="flower-activity-subagents-item-task">{description()}</div>}
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>
    );
  };

  const activityDetailBlock = (
    messageID: string,
    blockIndex: number,
    item: FlowerActivityItem,
    timeline: FlowerActivityTimelineBlock,
    block: FlowerNonTerminalDetailBlock,
  ) => {
    if (block.kind === 'error') return errorDetailBlock(block);
    if (block.kind === 'subagents') return subagentsDetailBlock(block);
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
                  <Show when={todo.note}>
                    {(note) => <span class="flower-activity-todo-note"> · {note()}</span>}
                  </Show>
                </span>
                <span class={cn('flower-activity-todo-badge', `flower-activity-todo-badge-${todo.status}`)}>
                  {todoStatusLabel(todo.status)}
                </span>
              </div>
            )}
          </For>
        </div>
      );
    }
    if (block.kind === 'web_search') return webSearchBlock(block);
    if (block.kind === 'question') return questionBlock(block);
    if (block.kind === 'completion') return completionBlock(block);
    if (block.kind === 'file_read') return fileReadBlock(messageID, blockIndex, item.item_id, block);
    if (block.kind === 'file_diff') return fileDiffBlock(messageID, blockIndex, item.item_id, block);
    return detailLinesBlock(block);
  };

  const activityRow = (
    messageID: Accessor<string>,
    blockIndex: Accessor<number>,
    timeline: Accessor<FlowerActivityTimelineBlock>,
    item: Accessor<FlowerActivityItem>,
  ) => {
    const disclosureKey = createMemo(() => activityItemKey(messageID(), timeline(), item()));
    const presentation = createMemo(() => presentFlowerActivityItem(item(), timeline().file_actions, {
      subagents: subagentsCopy(),
      subagentSummaries: selectedThread()?.subagents ?? [],
    }));
    const pendingApprovalCommand = createMemo(() => pendingApprovalCommandForActivityItem(item(), selectedApprovalActions()));
    const displayTitle = createMemo<FlowerActivityTitle>(() => {
      const command = pendingApprovalCommand();
      return command && presentation().title.kind !== 'command'
        ? { kind: 'command', command }
        : presentation().title;
    });
    const terminalDisclosure = createMemo(() => presentation().detailBlocks.some((block) => block.kind === 'terminal_output'));
    const detailKeys = createMemo(() => presentation().detailBlocks.map((block) => `${disclosureKey()}:${block.kind}`));
    const detailsByKey = createMemo(() => {
      const blocks = presentation().detailBlocks;
      return new Map<string, FlowerActivityDetailBlock>(blocks.map((block) => [`${disclosureKey()}:${block.kind}`, block]));
    });
    const disclosureControl = createFlowerActivityDisclosureController({
      intent: () => flowerActivityDisclosureIntent(item()),
      manualOpen: () => openActivityRuns()[disclosureKey()],
      onManualOpenChange: (open) => {
        const key = disclosureKey();
        setOpenActivityRuns((current) => ({ ...current, [key]: open }));
      },
      reducedMotion: reducedMotionPreferred,
      settle: { anchor: () => terminalDisclosure() ? 'presentation' : 'intent' },
    });
    const open = disclosureControl.open;
    const subagentsDetail = createMemo(() => subagentsDetailForPresentation(presentation()));
    const hasDetails = createMemo(() => presentation().detailBlocks.length > 0);
    const isReadActivity = createMemo(() => {
      const title = presentation().title;
      return title.kind === 'file' && title.verb === 'Read';
    });
    const expandable = createMemo(() => hasDetails() && !isReadActivity());
    let toggleButtonRef: HTMLButtonElement | undefined;
    let detailPanelRef: HTMLDivElement | undefined;
    const disclosure = createFlowerActivityDisclosureMotion(
      () => open() && expandable(),
      {
        animateContentResize: true,
        reducedMotion: reducedMotionPreferred,
        onLayoutFrame: scheduleTranscriptTailScroll,
        onBeforeClose: () => {
          if (detailPanelRef && detailPanelRef.contains(document.activeElement)) {
            toggleButtonRef?.focus();
          }
        },
      },
    );
    const rowFileAction = createMemo(() => presentation().primaryAction ?? null);
    const rowAttachmentPreviewTarget = createMemo(() => {
      const title = presentation().title;
      return title.kind === 'file' && title.verb === 'Read'
        ? attachmentPreviewTargetForActivity(item(), timeline(), title.display_name)
        : null;
    });
    const displayStatus = createMemo(() => item().status);
    const duration = createMemo(() => {
      const subagentDuration = subagentInlineElapsed(presentation());
      if (subagentDuration) return subagentDuration;
      const value = item();
      return formatActivityDuration((value.started_at_unix_ms && value.ended_at_unix_ms
        ? value.ended_at_unix_ms - value.started_at_unix_ms
        : undefined) ?? timeline().summary.duration_ms);
    });
    return (
      <div
        class={cn('flower-activity-inline-row', `flower-activity-inline-row-${displayStatus()}`, subagentsDetail() && 'flower-activity-inline-row-subagents')}
        data-flower-activity-item-id={item().item_id}
        data-flower-activity-status={displayStatus()}
        data-flower-activity-approval-state={item().approval_state}
        data-state={disclosure.state()}
        aria-label={activityItemAriaLabel(item(), timeline())}
      >
        <div class="flower-activity-inline-line">
          <button
            ref={toggleButtonRef}
            type="button"
            class={cn('flower-activity-inline-button', !expandable() && 'flower-activity-inline-button-static')}
            aria-expanded={expandable() ? open() : undefined}
            disabled={!expandable()}
            onClick={disclosureControl.toggle}
          >
            <span class="flower-activity-inline-icon">
              {statusIcon(displayStatus())}
              <Show when={item().approval_state === 'rejected'}>
                <span class="flower-activity-user-rejected-marker" aria-hidden="true">-</span>
              </Show>
            </span>
            <span class="flower-activity-inline-copy">
              <span class="flower-activity-inline-title">{activityTitle(displayTitle())}</span>
              <Show when={presentation().meta}>
                {(meta) => <span class="flower-activity-inline-detail">{meta()}</span>}
              </Show>
            </span>
            <Show when={duration()}>
              {(value) => <span class="flower-activity-inline-duration">{value()}</span>}
            </Show>
            <Show when={expandable()}>
              <ChevronDown class={cn('flower-activity-inline-chevron h-3.5 w-3.5', open() && 'flower-activity-inline-chevron-open')} />
            </Show>
          </button>
          {fileActionButtons(
            messageID(),
            blockIndex(),
            item().item_id,
            rowFileAction(),
            rowAttachmentPreviewTarget(),
          )}
        </div>
        <Show when={disclosure.mounted() && expandable()}>
          <div
            ref={(node) => {
              detailPanelRef = node;
              disclosure.bindViewport(node);
            }}
            class="flower-activity-inline-details"
            data-state={disclosure.state()}
            data-layout-motion={disclosure.layoutMotion()}
            style={{ height: disclosure.height() }}
            onPointerDown={disclosureControl.retainOpen}
            onFocusIn={disclosureControl.retainOpen}
            onWheel={disclosureControl.retainOpen}
            onTouchStart={disclosureControl.retainOpen}
          >
            <div class="flower-activity-inline-details-clip">
              <div ref={disclosure.bindContent} class="flower-activity-inline-details-content">
                <Show when={item().approval_state === 'rejected' && !terminalDisclosure()}>
                  <div class="flower-activity-approval-rejected-detail">
                    {copy().chat.toolApprovalRejectedDetail}
                  </div>
                </Show>
                <For each={detailKeys()}>
                  {(detailKey) => {
                    const block = createMemo(() => detailsByKey().get(detailKey)!);
                    const terminalBlock = createMemo(() => (
                      block().kind === 'terminal_output'
                        ? block() as Extract<FlowerActivityDetailBlock, { kind: 'terminal_output' }>
                        : null
                    ));
                    return (
                      <>
                        <Show when={terminalBlock()}>
                          {(value) => (
                            <TerminalOutputBlock
                              context={() => ({
                                ownerThreadID: trimString(selectedThreadID()),
                                renderThreadID: trimString(timeline().thread_id) || trimString(selectedThreadDetailID()) || trimString(selectedThreadID()),
                                runID: trimString(timeline().run_id),
                                turnID: trimString(timeline().turn_id),
                                messageID: messageID(),
                                blockIndex: blockIndex(),
                                itemID: trimString(item().item_id),
                                toolID: trimString(item().tool_id),
                              })}
                              block={value}
                              canonicalStatus={() => item().status}
                              approvalState={() => item().approval_state}
                              onSettledPresentation={disclosureControl.markSettledPresentation}
                            />
                          )}
                        </Show>
                        <Show when={!terminalBlock()}>
                          {activityDetailBlock(
                            messageID(),
                            blockIndex(),
                            item(),
                            timeline(),
                            block() as FlowerNonTerminalDetailBlock,
                          )}
                        </Show>
                      </>
                    );
                  }}
                </For>
              </div>
            </div>
          </div>
        </Show>
      </div>
    );
  };

  const activityBlock = (
    messageID: Accessor<string>,
    blockIndex: Accessor<number>,
    block: Accessor<FlowerActivityTimelineBlock>,
  ) => {
    const visibleItems = createMemo(() => block().items.filter(activityItemVisible));
    const visibleItemKeys = createMemo(() => visibleItems().map((item) => activityItemKey(messageID(), block(), item)));
    const visibleItemsByKey = createMemo(() => {
      const items = visibleItems();
      return new Map(visibleItemKeys().map((key, index) => [key, items[index]] as const));
    });

    return (
      <Show when={visibleItemKeys().length > 0}>
        <div class="flower-activity-inline" data-flower-activity-run-id={block().run_id}>
          <For each={visibleItemKeys()}>
            {(itemKey) => {
              const visibleItem = createMemo(() => visibleItemsByKey().get(itemKey) ?? null);
              return (
                <Show when={visibleItem()}>
                  {(item) => activityRow(
                    messageID,
                    blockIndex,
                    block,
                    item,
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

  const formatAttachmentSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unit = units[0];
    for (let index = 1; index < units.length && value >= 1024; index += 1) {
      value /= 1024;
      unit = units[index];
    }
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
  };

  const attachmentPreviewURL = (rawURL: string): string => {
    const url = new URL(rawURL, window.location.href);
    url.searchParams.set('preview', '1');
    return url.toString();
  };

  const openMessageAttachmentPreview = (input: Readonly<{
    id: string;
    name: string;
    mimeType: string;
    url: string;
  }>) => {
    const url = trimString(input.url);
    if (!url) return;
    setAttachmentPreview({
      id: input.id,
      name: trimString(input.name) || attachmentCopy().preview,
      mimeType: trimString(input.mimeType),
      load: async (signal) => {
        const response = await fetch(attachmentPreviewURL(url), {
          method: 'GET',
          credentials: 'same-origin',
          headers: { Accept: 'text/plain, image/png, image/jpeg, image/gif, image/webp, application/pdf' },
          signal,
        });
        if (!response.ok) throw new Error(`${attachmentCopy().errorUnavailable} (HTTP ${response.status})`);
        return response.blob();
      },
    });
  };

  const messageAttachmentBlock = (block: Accessor<Extract<FlowerRenderableMessageBlock, { type: 'image' | 'file' }>>) => (
    <Show
      when={block().type === 'image' ? block() as Extract<FlowerRenderableMessageBlock, { type: 'image' }> : null}
      fallback={(
        <a
          class="flower-message-file"
          href={(block() as Extract<FlowerRenderableMessageBlock, { type: 'file' }>).url || undefined}
          download={(block() as Extract<FlowerRenderableMessageBlock, { type: 'file' }>).url
            ? (block() as Extract<FlowerRenderableMessageBlock, { type: 'file' }>).name
            : undefined}
          aria-disabled={!(block() as Extract<FlowerRenderableMessageBlock, { type: 'file' }>).url ? 'true' : undefined}
          onClick={(event) => {
            const file = block() as Extract<FlowerRenderableMessageBlock, { type: 'file' }>;
            if (!file.url) {
              event.preventDefault();
              return;
            }
            event.preventDefault();
            openMessageAttachmentPreview({
              id: file.key,
              name: file.name,
              mimeType: file.mimeType,
              url: file.url ?? '',
            });
          }}
        >
          <FileText class="size-5 shrink-0" aria-hidden="true" />
          <span class="flower-message-file-copy">
            <span class="flower-message-file-name">{(block() as Extract<FlowerRenderableMessageBlock, { type: 'file' }>).name}</span>
            <span class="flower-message-file-meta">
              <Show when={(block() as Extract<FlowerRenderableMessageBlock, { type: 'file' }>).size !== undefined}>
                {formatAttachmentSize((block() as Extract<FlowerRenderableMessageBlock, { type: 'file' }>).size ?? 0)}{' · '}
              </Show>
              {(block() as Extract<FlowerRenderableMessageBlock, { type: 'file' }>).mimeType}
            </span>
          </span>
        </a>
      )}
    >
      {(imageBlock) => (
        <a
          class="flower-message-image"
          href={imageBlock().src}
          onClick={(event) => {
            event.preventDefault();
            openMessageAttachmentPreview({
              id: imageBlock().key,
              name: trimString(imageBlock().alt) || attachmentCopy().preview,
              mimeType: 'image/*',
              url: imageBlock().src,
            });
          }}
        >
          <img src={imageBlock().src} alt={imageBlock().alt ?? ''} loading="lazy" />
        </a>
      )}
    </Show>
  );

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
    const attachment = createMemo(() => (
      block().type === 'image' || block().type === 'file'
        ? block() as Extract<FlowerRenderableMessageBlock, { type: 'image' | 'file' }>
        : null
    ));
    return (
      <Show
        when={activity()}
        fallback={(
          <Show when={content()} fallback={<Show when={attachment()}>{messageAttachmentBlock}</Show>}>
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
        )}
      </Show>
    );
  };

  const messageEntry = (entry: Accessor<Extract<FlowerTimelineEntry, { type: 'message' }>>) => {
    const message = createMemo(() => entry().message);
    const activeCursor = createMemo(() => (
      selectedThreadLiveStatus() === 'running'
      && message().role === 'assistant'
      && message().active_cursor === true
    ));
    const failed = createMemo(() => (
      message().status === 'error'
      && !messageHasUserRejectedTool(message())
      && !threadHasUserRejectedTool(selectedThread(), message().run_id, message().turn_id)
    ));
    const hasRenderableBlock = createMemo(() => entry().blocks.length > 0);
    const contextDisplay = createMemo(() => {
      const msg = message();
      if (msg.role !== 'user') return null;
      return parseChatMessageReferences(msg.references);
    });
    const visible = createMemo(() => {
      if (hasRenderableBlock()) return true;
      if (contextDisplay()) return true;
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
    const canActivateContextChip = (chip: FlowerChatContextChip): boolean => {
      const action = chip.action;
      if (!action) return false;
      if (action.type === 'open_canonical_reference') {
        return contextDisplay()?.authority === 'canonical_references'
          && Boolean(props.adapter.openCanonicalReference)
          && Boolean(trimString(selectedThreadID()))
          && Boolean(trimString(message().turn_id));
      }
      if (action.type === 'open_linked_file_preview') return Boolean(props.adapter.openLinkedFilePreview);
      if (action.type === 'open_linked_directory_browser') return Boolean(props.adapter.openLinkedDirectoryBrowser);
      return true;
    };
    const activateContextChip = async (chip: FlowerChatContextChip): Promise<void> => {
      const action = chip.action;
      const display = contextDisplay();
      if (!action || !display) return;
      if (action.type === 'open_text_preview' || action.type === 'open_process_preview') {
        setContextSnapshotPreview({
          title: chip.label,
          action,
          thread_id: selectedThreadID(),
          message_id: message().id,
        });
        return;
      }

      setContextSnapshotPreview(null);
      if (action.type === 'open_canonical_reference') {
        if (display.authority !== 'canonical_references') return;
        const threadID = trimString(selectedThreadID());
        const turnID = trimString(message().turn_id);
        const referenceID = trimString(action.reference_id);
        if (!threadID || !turnID || !referenceID) return;
        try {
          await props.adapter.openCanonicalReference?.({
            thread_id: threadID,
            turn_id: turnID,
            reference_id: referenceID,
          });
        } catch (error) {
          notifyThreadActionError(getErrorMessage(error));
        }
        return;
      }
      if (display.authority !== 'queued_context_action') return;
      const request = {
        path: action.path,
        thread_id: selectedThreadID() || undefined,
        message_id: message().id,
        context_index: action.context_index,
        source_surface: display.surface,
        target: display.target,
      };
      if (!request.source_surface || !request.target) return;
      try {
        if (action.type === 'open_linked_file_preview') {
          await props.adapter.openLinkedFilePreview?.(request);
          return;
        }
        await props.adapter.openLinkedDirectoryBrowser?.(request);
      } catch (error) {
        notifyThreadActionError(getErrorMessage(error));
      }
    };
    const isUnifiedUserBubble = createMemo(() => message().role === 'user' && contextDisplay() !== null);
    return (
      <Show when={visible()}>
        <div
          class={cn(
            'flower-message-row',
            message().role === 'user' ? 'flower-message-row-user' : 'flower-message-row-assistant',
          )}
          data-flower-message-id={message().id}
          data-flower-message-role={message().role}
          data-flower-message-status={message().status}
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
                  <div class="flower-message-action-row flower-message-action-row-user">
                    <Show when={messageTime()}>
                      {(value) => <time class="flower-message-time" datetime={new Date(message().created_at_ms).toISOString()}>{value()}</time>}
                    </Show>
                    {messageCopyButton(message(), copyText(), 'user')}
                  </div>
                </Show>
              </div>
            }
          >
            <div class="flower-message-block-stack flower-message-block-stack-user">
              <div class="flower-message-bubble flower-message-bubble-framed flower-message-bubble-user flower-chat-context-unified-bubble">
                <For each={blockKeys()}>
                  {(blockKey) => {
                    const block = createMemo(() => blocksByKey().get(blockKey) ?? null);
                    const content = createMemo(() => block()?.type === 'content' ? block() as Extract<FlowerRenderableMessageBlock, { type: 'content' }> : null);
                    const attachment = createMemo(() => (
                      block()?.type === 'image' || block()?.type === 'file'
                        ? block() as Extract<FlowerRenderableMessageBlock, { type: 'image' | 'file' }>
                        : null
                    ));
                    return (
                      <Show when={content()} fallback={<Show when={attachment()}>{(value) => messageAttachmentBlock(value)}</Show>}>
                        {(value) => <span class="flower-message-plain-text">{value().content}</span>}
                      </Show>
                    );
                  }}
                </For>
                <FlowerChatContextChips
                  contextDisplay={contextDisplay()!}
                  linkedContextLabel={copy().chat.linkedContextLabel}
                  truncatedLabel={copy().chat.truncatedLabel}
                  canActivateChip={canActivateContextChip}
                  onChipClick={activateContextChip}
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

  function queuedTurnEntry(entry: Accessor<Extract<FlowerTimelineEntry, { type: 'queued_turn' }>>) {
    const turn = createMemo<FlowerQueuedTurn>(() => entry().turn);
    const blocks = createMemo(() => entry().blocks);
    const blockKeys = createMemo(() => blocks().map((block) => block.key));
    const blocksByKey = createMemo(() => new Map(blocks().map((block) => [block.key, block] as const)));
    const contextDisplay = createMemo(() => parseChatContextAction(turn().context_action));
    const canActivateContextChip = (chip: FlowerChatContextChip): boolean => {
      const action = chip.action;
      if (!action) return false;
      if (action.type === 'open_canonical_reference') return false;
      if (action.type === 'open_linked_file_preview') return Boolean(props.adapter.openLinkedFilePreview);
      if (action.type === 'open_linked_directory_browser') return Boolean(props.adapter.openLinkedDirectoryBrowser);
      return true;
    };
    const activateContextChip = async (chip: FlowerChatContextChip): Promise<void> => {
      const action = chip.action;
      const display = contextDisplay();
      if (!action || !display) return;
      const entryID = `queued:${turn().queue_id}`;
      if (action.type === 'open_text_preview' || action.type === 'open_process_preview') {
        setContextSnapshotPreview({
          title: chip.label,
          action,
          thread_id: selectedThreadID(),
          message_id: entryID,
        });
        return;
      }
      setContextSnapshotPreview(null);
      if (action.type === 'open_canonical_reference') return;
      if (display.authority !== 'queued_context_action') return;
      const request = {
        path: action.path,
        thread_id: selectedThreadID() || undefined,
        message_id: entryID,
        context_index: action.context_index,
        source_surface: display.surface,
        target: display.target,
      };
      try {
        if (action.type === 'open_linked_file_preview') {
          await props.adapter.openLinkedFilePreview?.(request);
          return;
        }
        await props.adapter.openLinkedDirectoryBrowser?.(request);
      } catch (error) {
        notifyThreadActionError(getErrorMessage(error));
      }
    };
    const queuedBlock = (block: Accessor<FlowerRenderableMessageBlock>) => (
      <Show
        when={block().type === 'content' ? block() as Extract<FlowerRenderableMessageBlock, { type: 'content' }> : null}
        fallback={(
          <Show when={block().type === 'image' || block().type === 'file' ? block() as Extract<FlowerRenderableMessageBlock, { type: 'image' | 'file' }> : null}>
            {(attachment) => messageAttachmentBlock(attachment)}
          </Show>
        )}
      >
        {(content) => (
          <div class="flower-message-bubble flower-message-bubble-framed flower-message-bubble-user flower-queued-turn-bubble">
            <Show
              when={content().block_type === 'markdown'}
              fallback={<span class="flower-message-plain-text">{content().content}</span>}
            >
              <FlowerMarkdownBlock
                content={content().content}
                streaming={false}
                copyCodeLabel={copy().chat.copyCode}
                codeCopiedLabel={copy().chat.codeCopied}
              />
            </Show>
          </div>
        )}
      </Show>
    );
    return (
      <div
        class="flower-message-row flower-message-row-user flower-queued-turn-row"
        data-flower-queued-turn-id={turn().queue_id}
        data-flower-queued-turn-state="queued"
      >
        <div class="flower-message-block-stack flower-message-block-stack-user">
          <Show
            when={contextDisplay()}
            fallback={(
              <For each={blockKeys()}>
                {(blockKey) => {
                  const block = createMemo(() => blocksByKey().get(blockKey) ?? null);
                  return <Show when={block()}>{(value) => queuedBlock(value)}</Show>;
                }}
              </For>
            )}
          >
            {(display) => (
              <div class="flower-message-bubble flower-message-bubble-framed flower-message-bubble-user flower-chat-context-unified-bubble flower-queued-turn-bubble">
                <For each={blockKeys()}>
                  {(blockKey) => {
                    const block = createMemo(() => blocksByKey().get(blockKey) ?? null);
                    const content = createMemo(() => block()?.type === 'content' ? block() as Extract<FlowerRenderableMessageBlock, { type: 'content' }> : null);
                    const attachment = createMemo(() => (
                      block()?.type === 'image' || block()?.type === 'file'
                        ? block() as Extract<FlowerRenderableMessageBlock, { type: 'image' | 'file' }>
                        : null
                    ));
                    return (
                      <Show when={content()} fallback={<Show when={attachment()}>{(value) => messageAttachmentBlock(value)}</Show>}>
                        {(value) => <span class="flower-message-plain-text">{value().content}</span>}
                      </Show>
                    );
                  }}
                </For>
                <FlowerChatContextChips
                  contextDisplay={display()}
                  linkedContextLabel={copy().chat.linkedContextLabel}
                  truncatedLabel={copy().chat.truncatedLabel}
                  canActivateChip={canActivateContextChip}
                  onChipClick={activateContextChip}
                />
              </div>
            )}
          </Show>
          <div class="flower-message-action-row flower-message-action-row-user flower-queued-turn-meta">
            <span class="flower-queued-turn-state">{copy().chat.pendingQueued}</span>
            <Show when={formatMessageTime(turn().created_at_ms)}>
              {(value) => <time class="flower-message-time" datetime={new Date(turn().created_at_ms).toISOString()}>{value()}</time>}
            </Show>
          </div>
        </div>
      </div>
    );
  }

  const pendingSubmissionEntry = (submission: Accessor<FlowerPendingSubmission>) => {
    const contextLabels = createMemo(() => [
      ...submission().attachmentNames,
      ...submission().referenceLabels,
    ]);
    return (
      <div
        class="flower-message-row flower-message-row-user flower-pending-submission-row"
        data-flower-pending-submission-id={submission().clientRequestID}
        data-flower-pending-submission-phase={submission().phase}
      >
        <div class="flower-message-block-stack flower-message-block-stack-user">
          <div class="flower-message-bubble flower-message-bubble-framed flower-message-bubble-user flower-pending-submission-bubble">
            <Show when={submission().prompt}>
              <span class="flower-message-plain-text">{submission().prompt}</span>
            </Show>
            <Show when={contextLabels().length > 0}>
              <div class="flower-pending-submission-context">
                <For each={contextLabels()}>{(label) => <span>{label}</span>}</For>
              </div>
            </Show>
          </div>
          <div
            class="flower-message-action-row flower-message-action-row-user flower-pending-submission-meta"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span class="flower-pending-submission-state">{copy().chat.pendingSubmission}</span>
          </div>
        </div>
      </div>
    );
  };

  const compactionDividerEntry = (entry: Accessor<Extract<FlowerTimelineEntry, { type: 'context_compaction' }>>) => {
    const decoration = createMemo(() => entry().decoration);
    return <FlowerContextCompactionDivider decoration={decoration()} copy={copy()} />;
  };

  const projectionUnavailableEntry = (entry: Accessor<Extract<FlowerTimelineEntry, { type: 'turn_projection_unavailable' }>>) => {
    const decoration = createMemo(() => entry().decoration);
    return <FlowerTurnProjectionUnavailable decoration={decoration()} copy={copy()} />;
  };

  const inputRequestEntry = (entry: Accessor<FlowerTimelineEntry>) => {
    const request = createMemo(() => {
      const value = entry();
      if (value.type !== 'input_request') return null;
      return trimString(visibleInputRequest(selectedThread())?.prompt_id) === trimString(value.request.prompt_id)
        ? null
        : value.request;
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
        {(value) => {
          const code = trimString(value().code);
          if (code === 'runtime_restarted') return runtimeRestartedDivider();
          if (code === 'floret_turn_interrupted') return null;
          if (latestThreadFailureIsUserRejectedTool(selectedThread())) return null;
          return runErrorNotice(value());
        }}
      </Show>
    );
  };

  const timelineEntry = (entry: Accessor<FlowerTimelineEntry>) => {
    switch (entry().type) {
      case 'message':
        return messageEntry(() => entry() as Extract<FlowerTimelineEntry, { type: 'message' }>);
      case 'queued_turn':
        return queuedTurnEntry(() => entry() as Extract<FlowerTimelineEntry, { type: 'queued_turn' }>);
      case 'context_compaction':
        return compactionDividerEntry(() => entry() as Extract<FlowerTimelineEntry, { type: 'context_compaction' }>);
      case 'turn_projection_unavailable':
        return projectionUnavailableEntry(() => entry() as Extract<FlowerTimelineEntry, { type: 'turn_projection_unavailable' }>);
      case 'input_request':
        return inputRequestEntry(entry);
      case 'error':
        return errorEntry(entry);
    }
  };

  const subagentStatusLabel = (status: FlowerSubagentPanelStatus): string => subagentsCopy().statusLabels[status] ?? subagentsCopy().statusLabels.unknown;
  const subagentElapsedDuration = (item: FlowerSubagentPanelItem): string => {
    const startedAt = item.startedAtMs || item.createdAtMs || 0;
    if (!startedAt) return '';
    const endedAt = subagentStatusIsActive(item.status)
      ? activityClockNow()
      : item.updatedAtMs || startedAt;
    return formatActivityDuration(Math.max(0, endedAt - startedAt));
  };
  const subagentStatusIndicator = (status: FlowerSubagentPanelStatus) => {
    switch (status) {
      case 'queued':
        return <Clock class="flower-subagent-status-indicator flower-subagent-status-indicator-queued h-3.5 w-3.5" aria-hidden="true" />;
      case 'running':
        return (
          <span class="flower-subagent-status-indicator flower-subagent-status-indicator-running" aria-hidden="true">
            {activityInlineLoader('flower-subagent-status-loader')}
          </span>
        );
      case 'waiting_input':
        return <AlertCircle class="flower-subagent-status-indicator flower-subagent-status-indicator-waiting h-3.5 w-3.5" aria-hidden="true" />;
      case 'completed':
        return <Check class="flower-subagent-status-indicator flower-subagent-status-indicator-completed h-3.5 w-3.5" aria-hidden="true" />;
      case 'failed':
      case 'timed_out':
        return <AlertTriangle class="flower-subagent-status-indicator flower-subagent-status-indicator-failed h-3.5 w-3.5" aria-hidden="true" />;
      case 'canceled':
        return <XCircle class="flower-subagent-status-indicator flower-subagent-status-indicator-canceled h-3.5 w-3.5" aria-hidden="true" />;
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
    trimString(item.displayName) || trimString(item.title) || trimString(item.taskName) || subagentsCopy().typeLabels.unknown
  );
  const activeSubagentTitle = createMemo(() => {
    const item = activeSubagentItem();
    if (item) return subagentRowTitle(item);
    const summary = subagentDetail()?.summary;
    const taskName = trimString(summary?.task_name);
    return taskName ? presentSubagentTaskName(taskName) : subagentsCopy().typeLabels.unknown;
  });
  const subagentSummaryStatus = createMemo(() => {
    return subagentStatusLabel(subagentDetailActiveStatus());
  });
  const subagentDetailMeta = createMemo(() => {
    const detail = subagentDetail();
    const item = activeSubagentItem();
    return trimString(detail?.summary.task_description || item?.taskDescription || detail?.summary.task_name || item?.taskName || '');
  });
  const subagentDetailAgentTypeLabel = createMemo(() => {
    const raw = trimString(subagentDetail()?.summary.agent_type || activeSubagentItem()?.agentType).toLowerCase();
    switch (raw) {
      case 'explore':
        return subagentsCopy().typeLabels.explore;
      case 'worker':
        return subagentsCopy().typeLabels.worker;
      case 'reviewer':
        return subagentsCopy().typeLabels.reviewer;
      default:
        return subagentsCopy().typeLabels.unknown;
    }
  });
  const subagentDetailElapsedLabel = createMemo(() => {
    const detail = subagentDetail();
    const item = activeSubagentItem();
    const startedAtMs = Math.max(0, Number(detail?.summary.created_at_ms || item?.startedAtMs || item?.createdAtMs || 0));
    if (!startedAtMs) return '';
    const status = subagentDetailActiveStatus();
    const terminal = status === 'completed' || status === 'failed' || status === 'canceled' || status === 'timed_out';
    const endedAtMs = terminal
      ? Math.max(startedAtMs, Number(detail?.summary.updated_at_ms || item?.updatedAtMs || startedAtMs))
      : activityClockNow();
    return formatActivityDuration(Math.max(0, endedAtMs - startedAtMs));
  });
  const subagentDetailModelIOStatus = createMemo<FlowerModelIOStatus | null>(() => subagentDetail()?.model_io_status ?? null);
  const subagentDetailModelStatusLabel = createMemo(() => {
    const status = subagentDetailModelIOStatus();
    return status ? modelStatusLabel(status.phase) : '';
  });
  const subagentDropdownGroup = (
    kind: 'active' | 'completed',
    label: Accessor<string>,
    items: Accessor<readonly FlowerSubagentPanelItem[]>,
  ) => (
    <section class="flower-subagents-dropdown-group" data-flower-subagent-group={kind} aria-labelledby={`flower-subagents-${kind}-label`}>
      <div class="flower-subagents-dropdown-group-header">
        <span id={`flower-subagents-${kind}-label`}>{label()}</span>
        <span class="flower-subagents-dropdown-group-count">{items().length}</span>
      </div>
      <ul class="flower-subagents-dropdown-group-list">
        <For each={items()}>
          {(item) => {
            const title = () => subagentRowTitle(item);
            const description = () => trimString(item.taskDescription);
            const elapsed = () => subagentElapsedDuration(item);
            return (
              <li class="flower-subagents-dropdown-list-item">
                <button
                  type="button"
                  class={cn(
                    'flower-subagent-dropdown-row',
                    `flower-subagent-dropdown-row-${item.status}`,
                    activeSubagentID() === trimString(item.threadID) && 'flower-subagent-dropdown-row-active',
                  )}
                  data-flower-subagent-row={selectedSubagentItems().findIndex((candidate) => candidate.key === item.key)}
                  data-flower-subagent-status={item.status}
                  aria-label={`${title()}. ${subagentStatusLabel(item.status)}. ${subagentsCopy().openThread}`}
                  title={[title(), description(), subagentsCopy().openThread].filter(Boolean).join('\n')}
                  onClick={() => void openSubagentDetail(item)}
                >
                  <span class="flower-subagent-dropdown-status">{subagentStatusIndicator(item.status)}</span>
                  <span class="flower-subagent-dropdown-copy">
                    <span class="flower-subagent-dropdown-name">{title()}</span>
                    <Show when={description()}>
                      {(value) => <span class="flower-subagent-dropdown-description">{value()}</span>}
                    </Show>
                  </span>
                  <span class="flower-subagent-dropdown-meta">
                    <span class="flower-subagent-dropdown-status-label">{subagentStatusLabel(item.status)}</span>
                    <Show when={elapsed()}>
                      {(value) => <span class="flower-subagent-dropdown-duration">{value()}</span>}
                    </Show>
                    <ChevronRight class="flower-subagent-dropdown-action h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </button>
              </li>
            );
          }}
        </For>
      </ul>
    </section>
  );
  const subagentDropdown = () => (
    <Show when={subagentDropdownOpen()}>
      <SurfaceFloatingLayer
        position={subagentDropdownPosition()}
        estimatedSize={SUBAGENT_DROPDOWN_ESTIMATED_SIZE}
        class="flower-subagents-dropdown-layer"
        data-flower-floating-layer="true"
      >
        <div
          ref={subagentDropdownRef}
          id="flower-subagents-dropdown"
          class="flower-subagents-dropdown"
          role="dialog"
          aria-label={subagentsCopy().title}
          aria-modal="false"
          tabIndex={-1}
          onKeyDown={handleSubagentDropdownKeyDown}
        >
          <div class="flower-subagents-dropdown-header">
            <div class="flower-subagents-dropdown-title">
              <GitBranch class="h-4 w-4" />
              <span>{subagentsCopy().title}</span>
            </div>
            <span class="flower-subagents-dropdown-count">{selectedSubagentItems().length}</span>
          </div>
          <div class="flower-subagents-dropdown-summary">
            <div class="flower-subagents-dropdown-metric" data-tone="active">
              <span class="flower-subagents-dropdown-metric-mark" aria-hidden="true" />
              <strong>{selectedActiveSubagentCount()}</strong>
              <span>{subagentsCopy().activeLabel}</span>
            </div>
            <div class="flower-subagents-dropdown-metric" data-tone="completed">
              <span class="flower-subagents-dropdown-metric-mark" aria-hidden="true" />
              <strong>{selectedSettledSubagentCount()}</strong>
              <span>{subagentsCopy().completedLabel}</span>
            </div>
          </div>
          <Show
            when={selectedSubagentItems().length > 0}
            fallback={(
              <div class="flower-subagents-dropdown-empty">
                <GitBranch class="h-4 w-4" />
                <span>{subagentsCopy().emptyTitle}</span>
              </div>
            )}
          >
            <div class="flower-subagents-dropdown-list">
              {subagentDropdownGroup('active', () => subagentsCopy().activeLabel, selectedActiveSubagentItems)}
              {subagentDropdownGroup('completed', () => subagentsCopy().completedLabel, selectedSettledSubagentItems)}
            </div>
          </Show>
        </div>
      </SurfaceFloatingLayer>
    </Show>
  );

  const subagentDetailThread = createMemo(() => projectSubagentDetailThread(subagentDetail()));
  const subagentDetailTimelineEntries = createMemo(() => buildFlowerTimelineEntries(subagentDetailThread()));
  const subagentDetailWindowTitle = createMemo(() => activeSubagentTitle());
  const showSubagentDetailScrollToLatestButton = createMemo(() => (
    Boolean(subagentDetailThread())
    && !subagentDetailScroll.nearBottom()
  ));
  const retrySubagentDetailLoad = () => {
    const item = activeSubagentItem();
    if (item) void openSubagentDetail(item);
  };

  const subagentDetailDialog = () => (
    <SubagentDetailWindow
      open={Boolean(activeSubagentID())}
      onOpenChange={(open) => {
        if (!open) closeSubagentOverlays();
      }}
      title={subagentDetailWindowTitle()}
      status={subagentDetailActiveStatus()}
      statusLabel={subagentSummaryStatus()}
      statusIndicator={subagentStatusIndicator(subagentDetailActiveStatus())}
      agentTypeLabel={subagentDetailAgentTypeLabel()}
      elapsedLabel={subagentDetailElapsedLabel()}
      description={subagentDetailMeta()}
      loading={subagentDetailLoading()}
      error={subagentDetailError()}
      detailAvailable={Boolean(subagentDetailThread())}
      entries={subagentDetailTimelineEntries()}
      renderEntry={(entry) => timelineEntry(() => entry)}
      bindScroll={(node) => { subagentDetailScroll.bind(node); }}
      onScroll={() => subagentDetailScroll.onScroll()}
      showScrollToLatest={showSubagentDetailScrollToLatestButton()}
      onScrollToLatest={() => subagentDetailScroll.scrollToBottom({ smooth: true })}
      hasMore={Boolean(subagentDetail()?.has_more)}
      loadingMore={subagentDetailLoadingMore()}
      onLoadMore={() => void loadMoreSubagentDetail()}
      onRetryLoad={retrySubagentDetailLoad}
      modelStatus={subagentDetailModelIOStatus()
        ? modelStatusIndicator(subagentDetailModelIOStatus(), subagentDetailModelStatusLabel())
        : null}
      tailLoading={subagentDetailTailLoading()}
      tailError={subagentDetailTailError()}
      onRetryTail={retrySubagentDetailTail}
      viewportLeftInset={Math.max(12, threadRailWidth() + 12)}
      zIndex={FLOWER_SURFACE_LAYER.subagentWindow}
      threadLoadingLabel={copy().chat.threadLoading}
      scrollToLatestLabel={copy().chat.scrollToLatest}
      copy={subagentsCopy()}
    />
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

  const workingDirectoryChip = (location: FlowerComposerControlLocation = 'inline') => (
    <button
      type="button"
      class={cn(
        'flower-working-dir-chip',
        `flower-composer-control-${location}`,
        workingDirectoryChipInteractive() && 'flower-working-dir-chip-interactive',
      )}
      data-flower-composer-control="working_dir"
      data-copied={workingDirectoryCopied() ? 'true' : 'false'}
      title={workingDirectoryChipTitle()}
      aria-label={workingDirectoryChipTitle()}
      aria-disabled={workingDirectoryChipInteractive() ? undefined : 'true'}
      tabIndex={workingDirectoryChipInteractive() ? 0 : -1}
      onClick={() => {
        if (!workingDirectoryChipInteractive()) return;
        void handleWorkingDirectoryChipClick();
      }}
    >
      <span class="flower-working-dir-chip-icon" aria-hidden="true">
        <FolderOpen class="flower-working-dir-chip-icon-idle h-3.5 w-3.5" />
        <Check class="flower-working-dir-chip-icon-copied h-3.5 w-3.5" />
      </span>
      <span class="flower-working-dir-chip-label">{displayedWorkingDirectoryLabel()}</span>
    </button>
  );

  const modelMenuItem = (option: ComposerModelOption) => {
    const selected = () => option.id === selectedComposerModelID();
    const attachmentSupport = () => modelAttachmentSupportState(option.id);
    const attachmentSupportLabel = () => {
      switch (attachmentSupport()) {
        case 'checking': return copy().attachments.modelSupportChecking;
        case 'supported': return copy().attachments.modelSupported;
        case 'unsupported': return copy().attachments.modelUnsupported;
        case 'unavailable': return copy().attachments.modelSupportUnavailable;
        default: return '';
      }
    };
    return (
      <button
        type="button"
        class={cn('flower-model-menu-item', selected() && 'flower-model-menu-item-active')}
        data-model-source={option.source}
        role="option"
        aria-selected={selected()}
        disabled={option.disabled}
        onClick={() => {
          if (option.disabled) return;
          void updateComposerModelID(option.id);
          closeModelMenu(true);
        }}
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
          <Show when={attachmentSupport()} keyed>
            {(state) => (
              <span
                class="flower-model-menu-attachment-status"
                data-state={state}
                aria-label={attachmentSupportLabel()}
              >
                {state === 'checking' && <Clock class="flower-model-menu-attachment-status-icon" aria-hidden="true" />}
                {state === 'supported' && <Check class="flower-model-menu-attachment-status-icon" aria-hidden="true" />}
                {state === 'unsupported' && <XCircle class="flower-model-menu-attachment-status-icon" aria-hidden="true" />}
                {state === 'unavailable' && <AlertCircle class="flower-model-menu-attachment-status-icon" aria-hidden="true" />}
                <span>{attachmentSupportLabel()}</span>
              </span>
            )}
          </Show>
        </span>
        <Show when={selected()}>
          <Check class="flower-model-menu-check" aria-hidden="true" />
        </Show>
      </button>
    );
  };

  const modelSourceStatusRow = (placement: 'footer' | 'menu') => (
    <Show when={unavailableModelSource()} keyed>
      {(status) => {
        const recoveryAction = modelSourceRecoveryAction(status);
        return (
          <div
            class={cn('flower-model-source-status', `flower-model-source-status-${placement}`)}
            data-state={status.state}
            data-placement={placement}
          >
            <AlertTriangle class="flower-model-source-status-icon" aria-hidden="true" />
            <span class="flower-model-source-status-message" title={modelSourceStatusMessage()}>
              {modelSourceStatusMessage()}
            </span>
            <span class="flower-model-source-status-actions">
              <button
                type="button"
                class="flower-model-source-status-action flower-model-source-status-refresh"
                aria-label={copy().threadList.refreshLabel}
                title={copy().threadList.refreshLabel}
                aria-busy={modelSourceRefreshing() ? 'true' : undefined}
                disabled={modelSourceRefreshing()}
                onClick={() => void refreshModelSource()}
              >
                <Refresh class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <Show when={recoveryAction}>
                {(value) => (
                  <button
                    type="button"
                    class="flower-model-source-status-action"
                    data-model-source-action={value().id}
                    aria-label={value().action.label}
                    title={value().action.label}
                    onClick={() => {
                      void value().action.run().catch((error) => notifyComposerError(getErrorMessage(error)));
                    }}
                  >
                    {value().id === 'connection_center'
                      ? <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
                      : <Settings class="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                )}
              </Show>
            </span>
          </div>
        );
      }}
    </Show>
  );

  const modelMenu = () => (
    <Show when={modelMenuOpen()}>
      <div
        ref={modelMenuRef}
        class="flower-model-menu"
        style={{ '--flower-model-menu-shift-x': `${modelMenuShiftX()}px` } as JSX.CSSProperties}
        role="listbox"
        onKeyDown={handleModelMenuKeyDown}
      >
        <Show when={threadSnapshotModelOption()}>{(option) => modelMenuItem(option())}</Show>
        <Show
          when={groupedModelOptions()}
          fallback={<For each={catalogModelOptions()}>{modelMenuItem}</For>}
        >
          {(groups) => (
            <For each={groups()}>
              {(group, index) => (
                <div
                  class={cn('flower-model-menu-group', index() > 0 && 'flower-model-menu-group-separated')}
                  data-model-source-group={group.source}
                >
                  <div class="flower-model-menu-group-label">{group.label}</div>
                  <For each={group.options}>{modelMenuItem}</For>
                </div>
              )}
            </For>
          )}
        </Show>
        {modelSourceStatusRow('menu')}
      </div>
    </Show>
  );

  const modelReasoningSelector = (location: FlowerComposerControlLocation = 'inline') => (
    <Show
      when={!surfaceWarmupActive() && modelSelectOptions().length > 0}
      fallback={(
        <span class={cn('flower-model-chip', `flower-composer-control-${location}`, surfaceWarmupActive() && 'flower-model-chip-warmup')}>
          {surfaceWarmupActive() ? warmupModelLabel() : selectedThreadModelLabel()}
        </span>
      )}
    >
      <div
        class={cn('flower-model-reasoning-control', `flower-composer-control-${location}`)}
        data-flower-composer-control="model_reasoning"
        data-has-reasoning={composerReasoningEnabled() ? 'true' : 'false'}
        data-model-pending={modelPatchPending() ? 'true' : 'false'}
      >
        <button
          ref={modelTriggerRef}
          type="button"
          class="flower-model-reasoning-model-trigger"
          disabled={!composerModelInteractive() || modelPatchPending()}
          aria-haspopup="listbox"
          aria-expanded={modelMenuOpen()}
          aria-label={selectedModelNeedsAttention()
            ? `${copy().chat.modelLabel}: ${selectedThreadModelLabel()}. ${copy().chat.configureProviderBeforeChat}`
            : `${copy().chat.modelLabel}: ${selectedThreadModelLabel()}`}
          title={selectedModelNeedsAttention()
            ? copy().chat.configureProviderBeforeChat
            : `${copy().chat.modelLabel}: ${selectedThreadModelLabel()}`}
          onClick={() => { if (modelMenuOpen()) { closeModelMenu(false); return; } openModelMenu(); }}
          onKeyDown={handleModelTriggerKeyDown}
        >
          <Show when={selectedModelNeedsAttention()}>
            <AlertTriangle class="flower-model-reasoning-warning" aria-hidden="true" />
          </Show>
          <span class="flower-model-reasoning-model-label">{selectedThreadModelLabel()}</span>
          <ChevronDown class="flower-model-reasoning-chevron" aria-hidden="true" />
        </button>
        {modelMenu()}
        <Show when={composerReasoningEnabled()}>
          <span class="flower-model-reasoning-divider" aria-hidden="true" />
          <FlowerReasoningControl
            compact
            variant="segment"
            capability={selectedReasoningCapability()}
            selection={composerReasoningSelection()}
            label={reasoningControlLabel()}
            readOnly={!composerReasoningInteractive()}
            onChange={(selection) => { void updateComposerReasoningSelection(selection); }}
          />
        </Show>
      </div>
    </Show>
  );

  const readOnlyComposerChip = (location: FlowerComposerControlLocation = 'inline') => (
    <div
      class={cn('flower-composer-readonly-chip', `flower-composer-control-${location}`)}
      data-flower-composer-control="read_only"
      title={selectedThreadReadOnlyReason()}
    >
      {selectedThreadReadOnlyDisplay()}
    </div>
  );

  const composerControlLabel = (id: FlowerComposerControlID): string => {
    switch (id) {
      case 'working_dir':
        return copy().threadList.workingDirectoryLabel;
      case 'permission':
        return copy().chat.permissionSelectorLabel;
      case 'model_reasoning':
        return composerReasoningEnabled()
          ? `${copy().chat.modelLabel} / ${reasoningControlLabel()}`
          : copy().chat.modelLabel;
      case 'read_only':
        return selectedThreadReadOnlyDisplay();
      default:
        return '';
    }
  };

  const composerControlMeasure = (id: FlowerComposerControlID) => {
    switch (id) {
      case 'working_dir':
        return (
          <span class="flower-working-dir-chip flower-composer-control-measure">
            <FolderOpen class="h-3.5 w-3.5" aria-hidden="true" />
            <span class="flower-working-dir-chip-label">{displayedWorkingDirectoryLabel()}</span>
          </span>
        );
      case 'permission':
        return (
          <span class="flower-permission-trigger flower-composer-control-measure" data-permission-type={composerPermissionType()}>
            <Shield class="flower-permission-icon" />
            <span class="flower-permission-label">{composerPermissionCopy().label}</span>
            <ChevronDown class="flower-permission-chevron" aria-hidden="true" />
          </span>
        );
      case 'model_reasoning':
        return (
          <span
            class="flower-model-reasoning-control flower-composer-control-measure"
            data-has-reasoning={composerReasoningEnabled() ? 'true' : 'false'}
          >
            <span class="flower-model-reasoning-model-trigger">
              <span class="flower-model-reasoning-model-label">{selectedThreadModelLabel()}</span>
              <ChevronDown class="flower-model-reasoning-chevron" aria-hidden="true" />
            </span>
            <Show when={composerReasoningEnabled()}>
              <span class="flower-model-reasoning-divider" aria-hidden="true" />
              <span class="flower-reasoning-control flower-reasoning-control-segment">
                <span class="flower-reasoning-segment-button">
                  <span>{reasoningControlLabel()}</span>
                  <ChevronDown class="flower-reasoning-badge-icon" aria-hidden="true" />
                </span>
              </span>
            </Show>
          </span>
        );
      case 'read_only':
        return (
          <span class="flower-composer-readonly-chip flower-composer-control-measure">
            {selectedThreadReadOnlyDisplay()}
          </span>
        );
      default:
        return null;
    }
  };

  const composerControl = (id: FlowerComposerControlID, location: FlowerComposerControlLocation) => {
    switch (id) {
      case 'working_dir':
        return workingDirectoryChip(location);
      case 'permission':
        return permissionSelector();
      case 'model_reasoning':
        return modelReasoningSelector(location);
      case 'read_only':
        return readOnlyComposerChip(location);
      default:
        return null;
    }
  };

  const composerMorePanel = () => (
    <Show when={composerMoreOpen() && composerOverflowControlIDs().length > 0}>
      <SurfaceFloatingLayer
        owner={composerMoreButtonRef}
        position={composerMorePanelPosition()}
        estimatedSize={composerMorePanelEstimatedSize()}
        class="flower-composer-more-layer"
        data-flower-floating-layer="true"
      >
        <div
          ref={composerMorePanelRef}
          class="flower-composer-more-panel"
          role="dialog"
          aria-label={copy().chat.composerMoreLabel}
          tabIndex={-1}
          data-flower-composer-more-panel="true"
        >
          <For each={composerOverflowControlIDs()}>
            {(id) => (
              <div class="flower-composer-more-row" data-flower-composer-more-item={id}>
                <span class="flower-composer-more-label">{composerControlLabel(id)}</span>
                <span class="flower-composer-more-control">{composerControl(id, 'overflow')}</span>
              </div>
            )}
          </For>
          <Show when={companionCompactComposer() && selectedContextUsage()}>
            {(contextUsage) => (
              <div class="flower-composer-more-row" data-flower-composer-more-item="context">
                <span class="flower-composer-more-label">{copy().chat.contextIndicator.label}</span>
                <span class="flower-composer-more-control">
                  <FlowerComposerContextIndicator
                    usage={contextUsage().usage}
                    freshness={contextUsage().freshness}
                    copy={copy()}
                  />
                </span>
              </div>
            )}
          </Show>
        </div>
      </SurfaceFloatingLayer>
    </Show>
  );

  const composerMoreButton = () => (
    <Show when={composerOverflowControlIDs().length > 0}>
      <div class="flower-composer-more-anchor">
        <button
          ref={composerMoreButtonRef}
          type="button"
          class="flower-composer-more-button"
          aria-label={copy().chat.composerMoreLabel}
          title={copy().chat.composerMoreLabel}
          aria-haspopup="dialog"
          aria-expanded={composerMoreOpen()}
          onClick={() => {
            if (!composerMoreOpen()) {
              setComposerMoreOpen(true);
              return;
            }
            closeComposerMore(true);
          }}
        >
          <MoreHorizontal class="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </Show>
  );

  const composerControls = () => (
    <div
      ref={composerControlsViewportRef}
      class="flower-composer-controls-viewport"
      data-flower-composer-controls="true"
      aria-live="polite"
    >
      <div class="flower-composer-controls-inline">
        <For each={composerInlineControlIDs()}>
          {(id) => (
            <span class="flower-composer-control-slot" data-flower-composer-inline-item={id}>
              {composerControl(id, 'inline')}
            </span>
          )}
        </For>
      </div>
      <div ref={composerControlsMeasureRef} class="flower-composer-controls-measure" aria-hidden="true">
        <For each={composerControlIDs()}>
          {(id) => (
            <span data-flower-composer-control-measure={id}>
              {composerControlMeasure(id)}
            </span>
          )}
        </For>
      </div>
    </div>
  );

  const composerReferenceMenu = () => (
    <Show when={composerReferenceMenuVisible()}>
      <SurfaceFloatingLayer
        owner={composerRef}
        position={composerReferenceMenuPosition()}
        estimatedSize={{
          width: composerReferenceMenuWidth(),
          height: composerReferenceMenuHeight(),
        }}
        class="flower-composer-reference-layer"
        data-flower-floating-layer="true"
      >
        <div
          ref={composerReferenceMenuRef}
          id={FLOWER_COMPOSER_REFERENCE_MENU_ID}
          class="flower-composer-reference-menu"
          style={{ '--flower-composer-reference-width': `${composerReferenceMenuWidth()}px` } as JSX.CSSProperties}
          role="listbox"
          aria-label={copy().chat.composerReferencesLabel}
          aria-busy={composerReferenceSearchState().status === 'loading' ? 'true' : 'false'}
        >
          <Show when={composerReferenceLoadingVisible()}>
            <div class="flower-composer-reference-status" role="status" aria-live="polite">
              <Refresh class="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>{copy().chat.composerReferenceLoading}</span>
            </div>
          </Show>
          <Show when={composerReferenceSearchState().status === 'empty'}>
            <div class="flower-composer-reference-status" role="status" aria-live="polite">
              <FileText class="h-4 w-4" aria-hidden="true" />
              <span>{copy().chat.composerReferenceEmpty}</span>
            </div>
          </Show>
          <Show when={composerReferenceSearchState().status === 'error'}>
            <div class="flower-composer-reference-status flower-composer-reference-status-error" role="status" aria-live="polite">
              <AlertCircle class="h-4 w-4" aria-hidden="true" />
              <span>{copy().chat.composerReferenceError}</span>
              <button
                type="button"
                class="flower-composer-reference-retry"
                aria-label={attachmentCopy().retry}
                title={attachmentCopy().retry}
                onPointerDown={(event) => event.preventDefault()}
                onClick={retryComposerReferenceSearch}
              >
                <Refresh class="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </Show>
          <Show when={composerReferenceCandidates().length > 0}>
            <For each={composerReferenceCandidates()}>
              {(candidate, index) => {
                const key = () => composerReferenceCandidateKey(candidate);
                const active = () => key() === composerReferenceCandidateKey(composerReferenceActiveCandidate() ?? candidate);
                return (
                  <div
                    class="flower-composer-reference-option"
                    data-active={active() ? 'true' : 'false'}
                    data-kind={candidate.kind}
                    onPointerEnter={() => setComposerReferenceActiveKey(key())}
                  >
                    <button
                      id={`${FLOWER_COMPOSER_REFERENCE_OPTION_PREFIX}${index()}`}
                      type="button"
                      class="flower-composer-reference-option-main"
                      role="option"
                      tabIndex={-1}
                      disabled={composerReferenceMutationCount() > 0}
                      aria-selected={active() ? 'true' : 'false'}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => void commitComposerReference(candidate)}
                    >
                      <span class="flower-composer-reference-option-icon" aria-hidden="true">
                        {candidate.kind === 'directory'
                          ? <FolderOpen class="h-4 w-4" />
                          : <FileText class="h-4 w-4" />}
                      </span>
                      <span class="flower-composer-reference-option-copy">
                        <span class="flower-composer-reference-option-name">{candidate.label}</span>
                        <Show when={candidate.relativeParent}>
                          <span class="flower-composer-reference-option-path">{candidate.relativeParent}</span>
                        </Show>
                      </span>
                    </button>
                    <Show
                      when={candidate.kind === 'directory'}
                      fallback={<span class="flower-composer-reference-option-hint" aria-hidden="true">Tab</span>}
                    >
                      <button
                        type="button"
                        class="flower-composer-reference-enter"
                        aria-label={copy().chat.composerReferenceBrowseDirectory(candidate.label)}
                        title={copy().chat.composerReferenceBrowseDirectory(candidate.label)}
                        disabled={composerReferenceMutationCount() > 0}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          completeComposerReference(candidate);
                        }}
                      >
                        <ChevronRight class="h-4 w-4" aria-hidden="true" />
                      </button>
                    </Show>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>
      </SurfaceFloatingLayer>
    </Show>
  );

  const companionHeaderIdentity = () => (
    <div class="flower-companion-thread-switcher-anchor" ref={threadSwitcherRef}>
      <button
        ref={threadSwitcherTriggerRef}
        type="button"
        class="flower-companion-thread-trigger"
        aria-label={props.companionCopy?.label}
        aria-haspopup="listbox"
        aria-expanded={threadSwitcherOpen()}
        onClick={() => setThreadSwitcherOpen((open) => !open)}
      >
        <FlowerIcon class="h-4 w-4 shrink-0 text-primary" />
        <span class="truncate">{selectedThread()?.title || copy().chat.titleFallback}</span>
        <ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      <Show when={threadSwitcherOpen() && props.companionCopy}>
        {(switcherCopy) => (
          <div class="flower-companion-thread-switcher-popover">
            <FlowerThreadSwitcher
              items={companionThreadItems()}
              activeThreadID={selectedThreadID()}
              query={threadSwitcherQuery()}
              copy={switcherCopy()}
              onQueryChange={setThreadSwitcherQuery}
              onNewConversation={() => {
                closeThreadSwitcher(false);
                startCompose();
              }}
              onSelect={(threadID) => {
                closeThreadSwitcher(false);
                selectThread(threadID);
              }}
              onEscape={() => closeThreadSwitcher(true)}
            />
          </div>
        )}
      </Show>
    </div>
  );

  const chatPanel = () => (
    <div class="flower-chat-shell flower-chat-shell">
      <div
        class="flower-chat-header flower-chat-header border-b border-border/80 backdrop-blur-md"
        aria-hidden={companionCollapsed() ? 'true' : undefined}
        inert={companionCollapsed()}
      >
        <div class="flower-chat-header-row">
          <Show
            when={presentation() === 'companion'}
            fallback={(
              <div class="flex min-w-0 items-center gap-3">
                <FlowerIcon class="h-5 w-5 text-primary" />
                <div class="flower-chat-header-identity min-w-0">
                  <div class="flower-chat-header-title truncate">{selectedThread()?.title || copy().chat.titleFallback}</div>
                </div>
              </div>
            )}
          >
            {companionHeaderIdentity()}
          </Show>
          <div class="flower-chat-header-actions">
            <Show when={presentation() === 'companion'}>
              <button
                type="button"
                class="flower-header-icon-button"
                aria-label={copy().chat.newChat}
                title={copy().chat.newChat}
                disabled={surfaceWarmupActive()}
                onClick={startCompose}
              >
                <Plus class="h-4 w-4" />
              </button>
            </Show>
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
                  <span
                    class="flower-header-icon-badge"
                    data-running={selectedRunningSubagentCount() > 0 && !subagentDropdownOpen() ? 'true' : 'false'}
                    aria-hidden="true"
                  >
                    {subagentBadgeText()}
                  </span>
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
            {props.headerTrailingActions}
          </div>
        </div>
      </div>
      {subagentDetailDialog()}
      <FlowerChatContextPreview
        preview={contextSnapshotPreview()}
        open={contextSnapshotPreview() !== null}
				truncatedLabel={copy().chat.truncatedLabel}
        zIndex={FLOWER_SURFACE_LAYER.contextPreview}
        onClose={() => setContextSnapshotPreview(null)}
      />
      <FlowerAttachmentPreviewWindow
        source={attachmentPreview()}
        zIndex={FLOWER_SURFACE_LAYER.attachmentPreview}
        loadingLabel={attachmentCopy().uploading}
        unavailableLabel={attachmentCopy().errorUnavailable}
        onClose={() => setAttachmentPreview(null)}
      />
      <div class="flower-chat-main flower-chat-main">
        <div
          ref={(node) => { transcriptScroll.bind(node); }}
          class="flower-chat-transcript flower-chat-transcript"
          aria-hidden={companionCollapsed() ? 'true' : undefined}
          inert={companionCollapsed()}
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
              when={selectedThreadHasContent() || selectedThreadHasModelStatus() || visiblePendingSubmission()}
                fallback={selectedThreadLoading()
                  ? threadLoadingState()
                  : warmupCanReplaceTranscript()
                    ? warmupPanel()
                  : (
                      <FlowerEmptyState
                        copy={copy().emptyState}
                        disabled={!readyForChat()}
                        showSuggestions={presentation() !== 'companion'}
                        onSuggestionClick={(prompt) => updateComposerSessionText(currentComposerSessionKey(), prompt)}
                      />
                    )}
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
              <Show when={visiblePendingSubmission()}>
                {(submission) => pendingSubmissionEntry(submission)}
              </Show>
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
              {composerReferenceMenu()}
              <Show when={composerCommandMenuVisible()}>
                <div
                  id={FLOWER_COMPOSER_COMMAND_MENU_ID}
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
              {queuedTurnsDock()}
              <div
                class={cn(
                  'flower-composer flower-chat-input-floating chat-input-container p-3',
                  bottomActionMode() !== 'chat' && 'flower-decision-surface',
                )}
                inert={composerSharedOperationActive()}
                aria-busy={chatRunning() || composerSharedOperationActive() || selectedApprovalDecisionHandoff() || composerReferenceMutationCount() > 0 ? 'true' : undefined}
                data-flower-turn-submitting={chatRunning() || composerSharedOperationActive() ? 'true' : undefined}
                data-flower-approval-handoff={selectedComposerApprovalHandoffActive() ? 'true' : undefined}
                data-flower-approval-handoff-phase={selectedComposerApprovalHandoffActive() ? selectedComposerApprovalHandoffPhase() : undefined}
                data-flower-bottom-mode={bottomActionMode()}
                data-flower-companion-compact={companionCompactComposer() ? 'true' : undefined}
                data-flower-attachment-drag={attachmentDragActive() ? 'true' : undefined}
                data-flower-text-entry={!selectedComposerApprovalDisplayAction() && !composerTextareaDisabled() ? 'true' : undefined}
                onPointerDown={focusComposerFromBlankArea}
                onDragEnter={(event) => {
                  if (!event.dataTransfer?.types.includes('Files')) return;
                  event.preventDefault();
                  if (composerCanQueueAttachmentIntent()) setAttachmentDragActive(true);
                }}
                onDragOver={(event) => {
                  if (!event.dataTransfer?.types.includes('Files')) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = composerCanQueueAttachmentIntent() ? 'copy' : 'none';
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAttachmentDragActive(false);
                }}
                onDrop={(event) => {
                  setAttachmentDragActive(false);
                  if (!event.dataTransfer?.types.includes('Files')) return;
                  event.preventDefault();
                  const files = Array.from(event.dataTransfer?.files ?? []);
                  if (files.length === 0) return;
                  if (!composerCanQueueAttachmentIntent()) {
                    notifyComposerError(attachmentCopy().unavailable);
                    return;
                  }
                  queueComposerAttachmentIntent(currentComposerSessionKey(), { kind: 'add', files, source: 'drop' });
                }}
              >
                <Show when={companionCollapsed() && !companionSummaryVisible()}>
                  <span
                    class={cn(
                      'flower-companion-collapsed-icon',
                      props.companionSummary?.running && 'flower-companion-collapsed-icon-running',
                    )}
                    aria-hidden="true"
                  >
                    <FlowerIcon />
                  </span>
                  <span
                    class={cn(
                      'flower-companion-collapsed-status',
                      `flower-companion-collapsed-status-${props.companionSummary?.priorityStatus ?? 'idle'}`,
                    )}
                    aria-hidden="true"
                  />
                </Show>
                <Show when={companionActionVisible()}>
                  <button
                    type="button"
                    class="flower-companion-collapsed-action"
                    aria-controls={props.companionRegionID}
                    aria-expanded="false"
                    onClick={() => props.onCompanionOpenRequest?.()}
                  >
                    <span class="truncate">
                      {props.companionActionLabel || props.companionSummary?.visualText}
                    </span>
                  </button>
                </Show>
                <Show when={companionSummaryVisible()}>
                  <button
                    type="button"
                    class={cn(
                      'flower-companion-collapsed-summary',
                      props.companionSummary?.ephemeralKind === 'completion'
                        && 'flower-companion-collapsed-summary-completion',
                    )}
                    data-flower-companion-ephemeral-kind={props.companionSummary?.ephemeralKind}
                    title={props.companionSummary?.accessibleText}
                    aria-label={props.companionSummary?.accessibleText}
                    aria-controls={props.companionRegionID}
                    aria-expanded="false"
                    onClick={() => props.onCompanionOpenRequest?.()}
                  >
                    <span
                      class={cn(
                        'flower-companion-collapsed-icon',
                        props.companionSummary?.running && 'flower-companion-collapsed-icon-running',
                        props.companionSummary?.ephemeralKind === 'completion'
                          && 'flower-companion-collapsed-icon-completion',
                      )}
                      aria-hidden="true"
                    >
                      <FlowerIcon />
                    </span>
                    <span
                      class={cn(
                        'flower-companion-collapsed-status',
                        `flower-companion-collapsed-status-${props.companionSummary?.priorityStatus ?? 'idle'}`,
                      )}
                      aria-hidden="true"
                    />
                    <span
                      class="flower-companion-collapsed-summary-text"
                      data-flower-companion-progress-kind={props.companionSummary?.progressKind}
                    >
                      <Show
                        when={props.companionSummary?.progressKind === 'output'}
                        fallback={props.companionSummary?.visualText}
                      >
                        <FlowerCompanionLiveTailText
                          text={props.companionSummary?.visualText ?? ''}
                          identity={props.companionSummary?.progressIdentity ?? ''}
                        />
                      </Show>
                    </span>
                  </button>
                </Show>
                <Show when={companionCollapsed() && !companionActionVisible() && companionDescriptionID()}>
                  <span
                    id={companionDescriptionID()}
                    class="flower-visually-hidden"
                    role={companionSummaryAnnounces() ? 'status' : undefined}
                    aria-live={companionSummaryAnnounces() ? 'polite' : undefined}
                    aria-atomic={companionSummaryAnnounces() ? 'true' : undefined}
                  >
                    {props.companionSummary?.accessibleText}
                  </span>
                </Show>
                <div
                  class="flower-composer-content"
                  aria-hidden={companionActionVisible() || companionSummaryVisible() ? 'true' : undefined}
                  inert={companionActionVisible() || companionSummaryVisible()}
                >
                <input
                  ref={attachmentPickerRef}
                  class="flower-visually-hidden"
                  type="file"
                  multiple
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = '';
                    const pickerSessionKey = attachmentPickerSessionKey || currentComposerSessionKey();
                    attachmentPickerSessionKey = '';
                    const target = attachmentReselectTarget;
                    attachmentReselectTarget = null;
                    if (pickerSessionKey && currentComposerSessionKey() === pickerSessionKey) {
                      scheduleComposerSelection(
                        composerRef instanceof HTMLTextAreaElement ? composerRef.selectionStart : 0,
                        composerRef instanceof HTMLTextAreaElement ? composerRef.selectionEnd : 0,
                        pickerSessionKey,
                      );
                    }
                    if (target) {
                      if (files[0] && currentComposerSessionKey() === target.sessionKey) {
                        queueComposerAttachmentIntent(target.sessionKey, {
                          kind: 'reselect',
                          localID: target.localID,
                          file: files[0],
                        });
                      }
                      return;
                    }
                    if (files.length === 0) return;
                    queueComposerAttachmentIntent(pickerSessionKey, { kind: 'add', files, source: 'file' });
                  }}
                  onCancel={() => {
                    const pickerSessionKey = attachmentPickerSessionKey;
                    attachmentPickerSessionKey = '';
                    attachmentReselectTarget = null;
                    if (pickerSessionKey && currentComposerSessionKey() === pickerSessionKey) {
                      scheduleComposerSelection(
                        composerRef instanceof HTMLTextAreaElement ? composerRef.selectionStart : 0,
                        composerRef instanceof HTMLTextAreaElement ? composerRef.selectionEnd : 0,
                        pickerSessionKey,
                      );
                    }
                  }}
                />
                <span class="flower-visually-hidden" aria-live="polite" aria-atomic="true">
                  {composerReferenceAnnouncement()}
                </span>
                <Show when={composerHasReferences() && !selectedInputRequest() && !selectedComposerApprovalDisplayAction()}>
                  <div class="flower-composer-reference-lane" role="list" aria-label={copy().chat.composerReferencesLabel}>
                    <For each={composerReferences()}>
                      {(reference, index) => (
                        <div
                          class="flower-composer-reference-chip"
                          role="listitem"
                          title={reference.path}
                          data-reference-kind={reference.kind}
                        >
                          <span class="flower-composer-reference-chip-icon" aria-hidden="true">
                            {reference.kind === 'directory'
                              ? <FolderOpen class="h-3.5 w-3.5" />
                              : <FileText class="h-3.5 w-3.5" />}
                          </span>
                          <span class="flower-composer-reference-chip-label">{reference.label}</span>
                          <button
                            ref={(el) => {
                              composerReferenceRemoveButtons.set(reference.local_id, el);
                              onCleanup(() => composerReferenceRemoveButtons.delete(reference.local_id));
                            }}
                            type="button"
                            class="flower-composer-reference-chip-remove"
                            aria-label={copy().chat.composerReferenceRemove(reference.path)}
                            title={copy().chat.composerReferenceRemove(reference.path)}
                            disabled={composerReferenceMutationCount() > 0 || !composerReferenceEditingAllowed()}
                            onClick={() => void removeComposerReference(reference, index())}
                          >
                            <XCircle class="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={composerHasAttachments() && !selectedInputRequest() && !selectedComposerApprovalDisplayAction()}>
                  <FlowerAttachmentLane
                    items={composerAttachmentItems()}
                    copy={attachmentCopy()}
                    disabled={!composerAttachmentEditingAllowed()}
                    onRetry={(localID) => {
                      const operation = currentComposerDraftOperation();
                      void ensureAttachmentStagingScope(operation.sessionKey).then(() => {
                        if (!composerDraftOperationCurrent(operation) || draftSubmissionActive(operation.session.snapshot().value)) return;
                        operation.controller.retry(localID);
                      }).catch(() => {
                        if (!composerDraftOperationCurrent(operation) || draftSubmissionActive(operation.session.snapshot().value)) return;
                        operation.controller.markStagingUnavailable();
                        notifyComposerError(attachmentCopy().unavailable);
                      });
                    }}
                    onReselect={reselectAttachment}
                    onCancel={(localID) => currentAttachmentController().cancel(localID)}
                    onRemove={(localID) => currentAttachmentController().remove(localID)}
                    onRestore={(localID) => void restoreLongTextAttachment(localID)}
                    onPreview={props.adapter.loadStagedAttachmentPreview || props.adapter.previewStagedAttachment ? previewStagedAttachment : undefined}
                    onFocusFallback={() => attachmentPickerButtonRef?.focus()}
                  />
                </Show>
                <Show when={composerTextOverLimit() && !selectedInputRequest()}>
                  <div class="flower-composer-over-limit" role="status">
                    {attachmentCopy().overLimit(FLOWER_INLINE_TEXT_CODE_POINT_LIMIT)}
                  </div>
                </Show>
                <Show
                  when={trimString(selectedComposerApprovalDisplayAction()?.action_id)}
                  keyed
                  fallback={(
                    <>
                      {inputRequestPrompt(selectedInputRequest(), { surface: 'composer' })}
                      <Show
                        when={activeInputQuestionIsSecret()}
                        fallback={(
                          <textarea
                            ref={(el) => {
                              composerRef = el;
                              composerAutosizeController?.dispose();
                              composerAutosizeController = createFlowerComposerAutosizeController(el);
                              if (companionCollapsed()) composerAutosizeController.suspend();
                            }}
                            class="w-full text-sm leading-6 text-foreground placeholder:text-muted-foreground"
                            placeholder={composerPlaceholder()}
                            value={composerTextValue()}
                            disabled={composerTextareaDisabled()}
                            readOnly={composerTextareaReadOnly()}
                            aria-label={presentation() === 'companion' ? copy().chat.placeholder : undefined}
                            aria-autocomplete={composerReferenceEditingAllowed() ? 'list' : undefined}
                            aria-haspopup="listbox"
                            aria-expanded={composerReferenceMenuVisible() || composerCommandMenuVisible() ? 'true' : undefined}
                            aria-controls={composerReferenceMenuVisible()
                              ? FLOWER_COMPOSER_REFERENCE_MENU_ID
                              : composerCommandMenuVisible()
                                ? FLOWER_COMPOSER_COMMAND_MENU_ID
                              : companionCollapsed()
                                ? props.companionRegionID
                                : undefined}
                            aria-activedescendant={composerReferenceMenuVisible()
                              ? composerReferenceActiveOptionID()
                              : composerCommandMenuVisible()
                                ? FLOWER_COMPOSER_COMPACT_COMMAND_OPTION_ID
                                : undefined}
                            aria-describedby={companionCollapsed() ? companionDescriptionID() : undefined}
                            onFocus={(event) => {
                              setComposerFocused(true);
                              const target = event.currentTarget;
                              syncComposerSelection(target);
                              if (companionCollapsed()) props.onCompanionOpenRequest?.();
                            }}
                            onBlur={() => setComposerFocused(false)}
                            onInput={handleComposerTextInput}
                            onSelect={(event) => syncComposerSelection(event.currentTarget)}
                            onKeyUp={(event) => syncComposerSelection(event.currentTarget)}
                            onPaste={handleComposerPaste}
                            onCompositionStart={() => {
                              setIsComposing(true);
                              composerReferenceIndex?.softAbort();
                              if (companionCollapsed()) props.onCompanionOpenRequest?.();
                            }}
                            onCompositionEnd={(event) => {
                              setIsComposing(false);
                              if (composerReferenceMutationActive()) {
                                event.currentTarget.value = composerTextValue();
                                return;
                              }
                              updateComposerText(event.currentTarget.value);
                              syncComposerSelection(event.currentTarget);
                              setComposerReferenceDismissedSignature('');
                              composerAutosizeController?.schedule();
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
                          readOnly={composerTextareaReadOnly()}
                          aria-haspopup="listbox"
                          aria-expanded={composerCommandMenuVisible() ? 'true' : undefined}
                          aria-controls={composerCommandMenuVisible() ? FLOWER_COMPOSER_COMMAND_MENU_ID : undefined}
                          aria-activedescendant={composerCommandMenuVisible() ? FLOWER_COMPOSER_COMPACT_COMMAND_OPTION_ID : undefined}
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
                  {(actionID) => (
                    <div class="flower-composer-approval-body">
                      <span class="flower-visually-hidden" role="status" aria-live="polite" aria-atomic="true">{approvalQueueAnnouncement()}</span>
                      {approvalActionCard(actionID, () => selectedComposerApprovalDisplayAction()!, { surface: 'composer' })}
                    </div>
                  )}
                </Show>
                <Show when={bottomActionMode() === 'input_request'}>
                  <div class="flower-decision-actions flower-input-request-actions">
                    <Show when={selectedThreadReadOnly()}>
                      <span class="flower-decision-readonly-status flower-composer-readonly-chip" role="status">
                        {selectedThreadReadOnlyDisplay()}
                      </span>
                    </Show>
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
                        : chatCopyValue('inputRequestSubmit', 'Continue')}
                    </Button>
                  </div>
                </Show>
                <Show when={bottomActionMode() === 'chat'}>
                <div class="flower-composer-footer">
                  <Show
                    when={!needsSetup()}
                  fallback={(
                    <Show
                      when={unavailableModelSource()}
                      fallback={(
                        <div
                          class="flower-setup-inline flower-model-source-status flower-model-source-status-footer"
                          data-state="not_configured"
                          data-placement="footer"
                        >
                          <AlertTriangle class="flower-model-source-status-icon" aria-hidden="true" />
                          <span class="flower-model-source-status-message" title={copy().chat.configureProviderBeforeChat}>
                            {copy().chat.configureProviderBeforeChat}
                          </span>
                          <span class="flower-model-source-status-actions">
                            <button
                              type="button"
                              class="flower-model-source-status-action"
                              aria-label={copy().chat.settingsLabel}
                              title={copy().chat.settingsLabel}
                              onClick={openSettings}
                            >
                              <Settings class="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </span>
                        </div>
                      )}
                    >
                      {modelSourceStatusRow('footer')}
                    </Show>
                  )}
                >
                    <div class="flower-model-stack">
                      {composerControls()}
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
                <div class="flower-composer-tool-cluster">
                        <Show when={composerAttachmentEditingAllowed()}>
                          <button
                            ref={attachmentPickerButtonRef}
                            type="button"
                            class="flower-composer-attachment-button"
                            aria-label={composerCanAddAttachments() ? attachmentCopy().add : attachmentCopy().unavailable}
                            title={composerCanAddAttachments() ? attachmentCopy().add : attachmentCopy().unavailable}
                            disabled={composerSharedOperationActive() || !composerCanAddAttachments()}
                            onClick={() => {
                              attachmentPickerSessionKey = currentComposerSessionKey();
                              attachmentReselectTarget = null;
                              attachmentPickerRef?.click();
                            }}
                          >
                            <Paperclip class="h-4 w-4" aria-hidden="true" />
                          </button>
                        </Show>
                  {composerMoreButton()}
                </div>
                {composerMorePanel()}
                      <Show when={!companionCompactComposer() && selectedContextUsage()}>
                        {(contextUsage) => (
                          <FlowerComposerContextIndicator
                            usage={contextUsage().usage}
                            freshness={contextUsage().freshness}
                            copy={copy()}
                          />
                        )}
                      </Show>
                      <Button
                        variant="primary"
                        icon={composerPrimaryActionIcon()}
                        size="icon"
                        class="flower-composer-submit rounded-full"
                        aria-label={composerPrimaryActionLabel()}
                        title={composerPrimaryActionLabel()}
                        disabled={composerPrimaryActionDisabled()}
                        loading={composerPrimaryActionLoading()}
                        data-flower-primary-action={composerPrimaryActionKind()}
                        onPointerDown={captureComposerPrimaryAction}
                        onClick={executeComposerPrimaryAction}
                      />
                    </div>
                  </Show>
                </div>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  );

  return (
    <main
      id="redeven-flower-surface"
      class={cn(
        'flower-component-shell flower-surface',
        presentation() === 'companion' && 'flower-surface-companion',
        companionCollapsed() && 'flower-surface-companion-collapsed',
        threadRailResizing() && 'flower-component-shell-resizing',
        props.class,
      )}
      data-flower-presentation={presentation()}
      data-flower-companion-open={presentation() === 'companion' ? (!companionCollapsed() ? 'true' : 'false') : undefined}
      data-flower-engaged={surfaceEngaged() ? 'true' : 'false'}
      data-flower-transcript-visible={transcriptVisible() ? 'true' : 'false'}
      data-flower-selected-thread-id={selectedThreadID()}
      data-flower-selected-thread-status={selectedThreadLiveStatus()}
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
          items={localAdmissionThreadItems()}
          activeThreadID={visibleSidebarActiveThreadID()}
          query={historyFilter()}
          refreshing={threadsRefreshing()}
          warmup={surfaceWarmupActive()}
          copy={copy().threadList}
          onQueryChange={setHistoryFilter}
          onRefresh={() => void refreshThreads()}
          onSelect={(threadID) => {
            if (threadID !== PENDING_NEW_THREAD_ID) selectThread(threadID);
          }}
          canFork={!!props.adapter.forkThread}
          canRename={!!props.adapter.renameThread}
          canPin={!!props.adapter.setThreadPinned}
          showStopAction
          showDeleteAction={typeof props.adapter.deleteThread === 'function'}
          busyThreadID={threadActionBusy()?.threadID}
          busyAction={threadActionBusy()?.action}
          actionsBusy={threadActionBusy() !== null}
          onMenuAction={(action, item, restore) => void handleThreadMenuAction(action, item, restore)}
        />
      </aside>
      <ConfirmDialog
        open={deleteTarget() !== null}
        onOpenChange={(open) => {
          if (!open) closeDeleteDialog();
        }}
        title={copy().threadList.deleteDialogTitle}
        confirmText={copy().threadList.deleteConfirm}
        variant="destructive"
        loading={deleteSubmitting()}
        onConfirm={() => void submitDeleteThread()}
      >
        <div class="flower-thread-delete-copy">
          <p>{copy().threadList.deleteDialogDescription(deleteTargetTitle())}</p>
          <p
            class="flower-thread-delete-active-warning"
            data-active={deleteTargetHasActiveWork() ? 'true' : 'false'}
          >
            {copy().threadList.deleteDialogActiveDescription}
          </p>
          <p class="flower-thread-delete-workspace-note">{copy().threadList.deleteDialogWorkspaceDescription}</p>
          <Show when={deleteError()}>
            {(message) => <p class="flower-thread-delete-error" role="alert">{message()}</p>}
          </Show>
        </div>
      </ConfirmDialog>
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
            onSaveDefaultPermission={saveDefaultPermission}
            onSaveModelProfile={saveModelProfile}
            saveError={saveError()}
            savedAt={savedAt()}
            saving={settingsSaving()}
            onBackToChat={returnToChat}
          />
        </div>
      </section>
      <FlowerWorkingDirPickerDialog
        open={workingDirectoryPickerOpen()}
        onOpenChange={(open) => {
          if (!open) setWorkingDirectoryPickerOpen(false);
        }}
        files={workingDirectoryPicker.files()}
        initialPath={workingDirectoryPickerInitialPath()}
        homePath={workingDirectoryHomePath()}
        homeLabel={copy().chat.workingDirPickerHomeLabel}
        title={copy().chat.workingDirPickerTitle}
        class="flower-working-dir-picker"
        confirmText={copy().chat.workingDirPickerConfirm}
        onExpand={workingDirectoryPicker.expandPath}
        ensurePath={workingDirectoryPicker.ensurePath}
        onSelect={(selectedPath) => {
          if (!canPickWorkingDirectory()) return;
          const realPath = toPickerTreeAbsolutePath(selectedPath, workingDirectoryHomePath());
          if (!realPath) return;
          updateCurrentComposerSessionDraft((draft) => (
            draft.workingDirDraft === realPath ? draft : { ...draft, workingDirDraft: realPath }
          ));
          setWorkingDirectoryPickerOpen(false);
        }}
      />
    </main>
  );
};
