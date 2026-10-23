import { createThreadRailResize, loadThreadRailWidth, saveThreadRailWidth, THREAD_RAIL_WIDTH_DEFAULT, THREAD_RAIL_WIDTH_MIN, THREAD_RAIL_WIDTH_MAX } from './threadRailResize';
import { createHistoryBodyLoader, createHistoryBodyVisibility, HISTORY_BODY_CONCURRENCY, HISTORY_BODY_VIEWPORT_MARGIN_PX } from './historyBodyLoader';
import { createFlowerThreadBaseline } from './threadBaseline';
import { loadFlowerThreadList } from './threadListLoad';
import { createThreadReadSync } from './threadReadSync';
import { scheduleThreadSelectionCommit } from './threadSelectionSchedule';
import { createThreadDetailLoader } from './threadDetailLoader';
import type { FlowerConversationPreferencePatch, FlowerConversationPreferences } from './contracts/flowerSurfaceContracts';
import { ParentEventRow, createParentEventReading } from './parentEvents';
import { createStore } from 'solid-js/store';
import { FlowerAnswerActions } from './FlowerAnswerActions';
import { FlowerGoalIcon } from './FlowerGoalIcon';
import { flowerAnswerHTML, downloadFlowerAnswer } from './chat/markdown/flowerAnswerExport';
import { flowerToolCallPreviewIdentity } from './toolCallPreview';
import { flowerQueuedDraftReferences } from './composer/flowerQueuedDraft';
import { flowerMessageTextForCopy } from './chat/markdown/flowerCitations';
import { flowerDraftReferenceIdentity, flowerDraftReferenceContextItem, flowerDraftReferenceDescription } from './composer/flowerDraftReferenceModel';
import type { ThreadReferenceSnapshot } from './contextActionWire';
import { withFlowerModelDirectory } from './modelDirectory';
import { FlowerReadDeadlineError, FlowerRequestDeadlineError, withFlowerRequestDeadline, withFlowerReadDeadline } from './requestDeadline';
import { FileItemIcon } from '@floegence/floe-webapp-core/file-browser';
import { flowerMenuModels } from './modelMenu';
import { flowerDirectoryDesktopStatus } from './modelDirectory';
import {
  Input,
  StableText,
  Button,
  ConfirmDialog,
  Dialog,
  DialogPlacementProvider,
  SurfaceFloatingLayer,
  Dropdown,
} from '@floegence/floe-webapp-core/ui';
import { FlowerActivityRows } from './FlowerActivityRows';
import { FlowerComputerConnections, type FlowerRequestedComputerAccess } from './FlowerComputerConnections';
import { computerAssistance } from './computerAssistance';
import { computerFrameRate } from './computerViewer';
import type { FlowerComputerFrameSource, FlowerComputerInputCommand, FlowerThreadPinMetadata, FlowerThreadPinPosition } from './contracts/flowerSurfaceContracts';
import { FLOE_HOT_INTERACTION_ATTR, secureRandomUUID } from '@floegence/floe-webapp-core';
import { WebSearchCapabilityBadge } from './WebSearchCapabilityBadge';
import { FlowerKeyedList } from './FlowerKeyedList';
import { FlowerApprovalRow, FlowerApprovalDecisionActions } from './FlowerApprovalRow';
import { createFlowerLiveFrameQueue } from './flowerLiveFrameQueue';
import { retainEqualValue, retainKeyedItems } from './presentationIdentity';
import { FlowerProviderBrandIcon } from './settings/FlowerProviderBrandIcon';
import { WebSearchActivity } from './WebSearchActivity';
import type { Accessor, Component, JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { For, Match, Show, Suspense, Switch, batch, createComputed, createEffect, createMemo, createResource, createSignal, createUniqueId, lazy, on, onCleanup, onMount, untrack } from 'solid-js';
import { cn, useMobileLayout, createAdaptiveSidebar, createRetainedContent } from '@floegence/floe-webapp-core';
import type { UIFirstSelectionEvent } from '@floegence/floe-webapp-core';
import { AlertCircle, AlertTriangle, ArrowUp, Bot, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, ExternalLink, FileText, Globe, GripVertical, Link, Menu, MoreHorizontal, MonitorPointer, Paperclip, Pencil, Plus, Refresh, Search, Send, Settings, Shield, Terminal, Trash, X, XCircle, Zap } from '@floegence/floe-webapp-core/icons';
import { createInputHistoryController, MarkdownMedia, type InputHistoryEntry, type MarkdownMediaProps } from '@floegence/floe-webapp-core/chat';
import { flowerInputHistoryEntries } from './composer/flowerInputHistory';

import { FlowerContextMenu } from './FlowerContextMenu';
import { FlowerDirectoryMenuItems, type FlowerDirectoryMenuAction, type FlowerDirectoryMenuAvailability } from './FlowerDirectoryMenuItems';
import type { FlowerWorkingDirectoryOpenRequest } from './contracts/flowerSurfaceContracts';

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
import { FlowerUserMessageBody } from './chat/FlowerUserMessageBody';
import { FlowerChatContextChips } from './chat/FlowerChatContextChips';
import { FlowerChatContextPreview, type FlowerContextSnapshotPreviewProps } from './chat/FlowerChatContextPreview';
import { FlowerContextIcon } from './icons/FlowerContextIcon';
import { FlowerProgressIndicator } from './chat/FlowerProgressIndicator';
import { parseChatContextAction, parseChatMessageReferences } from './chat/flowerChatContextModel';
import {
  createFlowerClientRequestID,
} from './flowerRequestIdentity';
import {
  flowerTurnAdmissionError,
  flowerTurnAdmissionFailureKind,
} from './flowerTurnAdmission';
import { FlowerContextCompactionDivider } from './chat/FlowerContextCompactionDivider';
import { compactionDividerDetail } from './chat/flowerContextPresentation';
import { SubagentAvatar } from './SubagentAvatar';
import { SubagentAvatarStack } from './SubagentAvatarStack';
import { FlowerToolSequenceNode } from './FlowerToolSequenceNode';
import { FlowerThinkingDisclosure } from './FlowerThinkingDisclosure';
import { FlowerTurnTimeline } from './FlowerTurnTimeline';
import { useFlowerActivityTitleReveal } from './flowerActivityTitleReveal';
import { createFlowerTurnDisclosureStore } from './flowerTurnDisclosure';
import type { FlowerComputerStageSessionState, FlowerComputerStageSnapshot } from './FlowerComputerStage';
import { FlowerToolIcon } from './FlowerToolIcon';
import { FlowerThreadToolPreview } from './FlowerThreadToolPreview';
import { FlowerActivityPreview } from './FlowerActivityPreview';
import { FlowerComposerContextIndicator } from './chat/FlowerComposerContextIndicator';
import { FlowerMessageImage } from './chat/FlowerMessageImage';
import { FlowerEmptyState } from './chat/FlowerEmptyState';
import { FlowerWorkingDirectoryControl } from './chat/FlowerWorkingDirectoryControl';
import { FlowerSetupWelcome } from './chat/FlowerSetupWelcome';
import type { FlowerChatContextChip, FlowerChatContextSnapshotPreview } from './contracts/flowerChatContextTypes';
import { FlowerMarkdownBlock } from './chat/markdown/FlowerMarkdownBlock';
import { htmlPreviewSourceDirectory, openHtmlPreviewLink, resolveFlowerMarkdownMedia } from './chat/markdown/flowerMarkdownMedia';
import type { FlowerSubagentsCopy, FlowerSurfaceCopy } from './copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from './copy';
import type {
  FlowerApprovalAction,
  FlowerActivityItem,
  FlowerActivityTimelineBlock,
  FlowerToolCallPreviewBlock,
  FlowerArgumentPreview,
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
  FlowerToolPreviewRequest,
  FlowerTurnLaunchFailure,
  FlowerTurnLaunchInput,
  FlowerGoalInput,
  FlowerGoalResult,
  FlowerTurnLaunchReceipt,
  FlowerRouterDecision,
  FlowerThreadListItem,
  FlowerThreadReadStatus,
  FlowerThreadStatus,
  FlowerThreadSnapshot,
  FlowerChatMessage,
  FlowerQueuedTurn,
  FlowerQueuedTurnAttachment,
  FlowerContextUsage,
  FlowerActivityStatus,
  FlowerForkThreadInput,
  FlowerThreadView,
  FlowerLiveStreamEnvelope,
  FlowerRuntimeCurrentView,
  FlowerAttachmentCapability,
  FlowerAttachmentStagingScope,
  FlowerRunProgressPhase,
  FlowerModelSourceStatus,
  FlowerSurfaceAction,
  FlowerPermissionType,
  FlowerProviderType,
  FlowerReasoningCapability,
  FlowerReasoningSelection,
  FlowerSubagentDetail,
  FlowerSubagentInputOperation,
  FlowerSubagentSummary,
} from './contracts/flowerSurfaceContracts';
import { flowerThreadIsStopping, flowerThreadHasActiveTurnEvidence, projectFlowerThreadListItem, trimString } from './flowerSurfaceModel';
import { presentFlowerApproval } from './flowerApprovalPresentation';
import { canonicalFlowerThreadSnapshotTitle, flowerForkTitle, flowerThreadDisplayTitle } from './flowerThreadTitle';
import { projectFlowerCompanionLiveTail, type FlowerCompanionProgressKind } from './flowerCompanionLiveTail';
import {
  flowerRunProgress,
  flowerRetrySeconds,
  type FlowerLiveProgress,
  type FlowerLiveProgressKind,
} from './flowerLiveProgress';
import { FlowerCompanionTailMotionController } from './flowerCompanionTailMotion';
import { FlowerCompanionRunTracker } from './flowerCompanionRunTracker';
import {
  buildFlowerTimelineEntries, createFlowerTimelineProjection,
  flowerTimelineHasUserRejectedTool,
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
import type { FlowerModelDirectory } from './contracts/flowerSurfaceContracts';
import { FLOWER_COMPACT_CONTEXT_COMMAND, FLOWER_GOAL_COMMAND, parseFlowerSlashCommand } from './flowerSlashCommands';
import {
  pendingApprovalCommandForActivityItem,
  presentFlowerActivityItem,
  safeWebFetchURL,
  type FlowerActivityDetailBlock,
  computerActivityResource,
  isSavedComputerScreenshot,
  type FlowerActivityDiffFile,
  type FlowerActivityFileAction,
  type FlowerActivityPresentation,
  type FlowerActivitySubagentDetailItem,
  type FlowerActivityTitle,
  type FlowerActivityTodoStatus,
} from './flowerActivityPresentation';
import { flowerActivityIdentity } from './flowerActivityIdentity';
import { inputResponseVisibleText } from './inputResponse';
import {
  createFlowerActivityDisclosureController,
  createFlowerActivityDisclosureMotion,
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
import { FlowerShellCommandHighlight } from './shellCommandHighlight';
import { FlowerThreadList, type FlowerThreadMenuAction } from './threads/FlowerThreadList';
import { comparePinnedFlowerThreads } from './threads/threadListModel';
import { FlowerThreadSwitcher, type FlowerThreadSwitcherCopy } from './threads/FlowerThreadSwitcher';
import {
  createThreadCache,
  threadSnapshotRevision,
  threadSettingsRevision,
  threadSummaryNeedsDetail,
  type ThreadView,
  type ThreadViewAcceptance,
} from './threadCache';
import {
  createTransportOutbox,
  restoreTransportOutbox,
  type TransportOutboxEntry,
  type TransportOutboxProvisionalThreadSettings,
} from './transportOutbox';
import { createLiveTransport, type LiveTransportState } from './liveTransport';
import { flowerThreadActivityRevision } from './flowerThreadListRefresh';
import { flowerModelSupportsImage, formatFlowerTokenCount } from './flowerModelLabel';
import { FlowerReasoningControl } from './ReasoningControl';
import {
  type FlowerComposerDraftCoordinator,
  type FlowerComposerDraftAttachment,
  type FlowerComposerDraftReference,
  type FlowerComposerDraftSession,
  type FlowerComposerDraftSnapshot,
  type FlowerComposerDraftValue,
  type FlowerPageContextSnapshot,
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
import { flowerDisplayApprovalAction, flowerPendingApprovalActions } from './approvalAction';
import { FlowerWorkingDirPickerDialog } from './filePicker/FlowerWorkingDirPickerDialog';
import {
  projectFlowerCompanionPresence,
  type FlowerCompanionPriorityStatus,
  type FlowerCompanionPresenceProjection,
  type FlowerCompanionTerminalTransition,
  type FlowerCompanionThreadListItem,
} from './flowerCompanionPresence';
import { formatFilesystemPickerError, mapFilesystemPickerContext, mapFilesystemPickerEntries } from './filePicker/filesystemPicker';
import { applyFlowerRuntimeContext, applyFlowerRuntimeCurrentView } from './runtimeCurrentView';
import { threadNeedsFileActivityTargets } from './fileActivityTargets';
import { mapFlowerGoal } from './flowerLiveMapper';
import { createFlowerScrollTailController, type FlowerScrollTailController } from './flowerScrollTail';
import { basenameFromAbsolutePath, normalizeAbsolutePath } from './filePicker/path';
import {
  defaultReasoningSelectionForCapability,
  normalizeFlowerReasoningSelection,
  reasoningCapabilitySupportsControl,
  reasoningCapabilityHasPresentation,
  sameFlowerReasoningSelection,
  serializeFlowerReasoningSelection,
} from './reasoning';

const FlowerInputChoices = lazy(() => import('./FlowerInputChoices'));
const SubagentDetailWindow = lazy(() => import('./SubagentDetailWindow').then((module) => ({ default: module.SubagentDetailWindow })));
const FlowerSettingsSurface = lazy(() => import('./settings/FlowerSettingsSurface').then((module) => ({ default: module.FlowerSettingsSurface })));
const FlowerExtensionsSurface = lazy(() => import('./extensions/FlowerExtensionsSurface').then((module) => ({ default: module.FlowerExtensionsSurface })));
const FlowerComputerStage = lazy(() => import('./FlowerComputerStage').then((module) => ({ default: module.FlowerComputerStage })));

type FlowerSurfacePanel = 'chat' | 'settings' | 'extensions';
type UnavailableFlowerModelSourceStatus = Exclude<FlowerModelSourceStatus, { state: 'ready' }>;
type FlowerModelSourceRecoveryActionID = 'local_settings' | 'remote_settings' | 'runtime_settings' | 'connection_center';
type FlowerInputDraft = Readonly<{
  answer_kind?: 'choice' | 'custom';
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
  reasoningModelID?: string;
  workingDirDraft?: string;
}>;

type FlowerMessageAttachmentPreviewTarget = Readonly<{
  id: string;
  name: string;
  mimeType: string;
  url: string;
}>;

function runErrorNoticeVisible(thread: FlowerThreadSnapshot | null | undefined, error = thread?.error): boolean {
  const code = trimString(error?.code);
  return (Boolean(trimString(error?.message)) || thread?.status === 'failed')
    && code !== 'runtime_restarted' && code !== 'floret_turn_interrupted';
}

type FlowerComposerControlID = 'permission' | 'model_reasoning' | 'read_only';
type FlowerComposerControlLocation = 'inline' | 'overflow';
type FlowerComposerControlLayout = Readonly<{
  availableWidth: number | null;
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
type FlowerQueuedTurnReorderState = Readonly<{
  threadID: string;
  draggedQueueID: string;
  originalQueueIDs: readonly string[];
  orderedQueueIDs: readonly string[];
  phase: 'dragging';
}>;

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
type FlowerFloatingPoint = Readonly<{
  x: number;
  y: number;
}>;
type SelectedThreadTailReveal = Readonly<{
  threadID: string;
  sequence: number;
}>;
type ActiveSubagentDetail = Readonly<{
  parentThreadID: string;
  childThreadID: string;
  item: FlowerSubagentPanelItem;
  generation: number;
  requestStatus: 'idle' | 'loading';
  connectionEpoch?: number;
  summary: FlowerSubagentSummary | null;
  error: string;
}>;
type FlowerQueueDockRow = Readonly<{
  requestKey: string;
  canonical?: FlowerQueuedTurn;
  transport?: TransportOutboxEntry;
}>;
type PendingAdmissionHandoff = Readonly<{
  sessionKey: string;
  selectionSequence: number;
  scopeBinding?: { transferred: boolean; threadID?: string };
  goalEdit?: FlowerComposerDraftValue['goal_edit'];
  goalPopupAttempt?: number;
  goalFromCommand?: boolean;
  settle: (threadID: string, transferDraftScope: boolean) => void;
}>;

const SIDEBAR_STABLE_LIVE_STATUSES = new Set<FlowerThreadStatus>(['running']);
const PENDING_NEW_THREAD_ID = '__new_thread__';
const FLOWER_PERMISSION_TYPES: readonly FlowerPermissionType[] = ['readonly', 'approval_required', 'full_access'];
const FLOWER_COMPOSER_COMMAND_MENU_ID = 'flower-composer-command-menu';
const flowerComposerCommandOptionID = (command: string) => command === '/goal' ? 'flower-composer-command-goal' : command === 'compact-only' ? 'flower-composer-command-compact-only' : 'flower-composer-command-compact-context';
const FLOWER_COMPOSER_CONTROL_ORDER: readonly FlowerComposerControlID[] = ['permission', 'model_reasoning', 'read_only'];
const FLOWER_COMPOSER_CONTROL_OVERFLOW_ORDER: readonly FlowerComposerControlID[] = ['model_reasoning', 'read_only', 'permission'];
const FLOWER_COMPOSER_CONTROL_GAP_PX = 6;
const MESSAGE_COPY_RESET_MS = 1600;
const FLOWER_COMPOSER_REFERENCE_MENU_ID = 'flower-composer-reference-menu';
const FLOWER_COMPOSER_REFERENCE_OPTION_PREFIX = 'flower-composer-reference-option-';
const FLOWER_COMPOSER_REFERENCE_MENU_FALLBACK_HEIGHT = 240;
const FLOWER_COMPOSER_REFERENCE_MENU_GAP = 6;
const FLOWER_COMPOSER_REFERENCE_VIEWPORT_MARGIN = 8;
const FLOWER_COMPOSER_MORE_PANEL_ESTIMATED_WIDTH = 352;
const FLOWER_COMPOSER_MORE_PANEL_ROW_HEIGHT = 44;
const FLOWER_COMPOSER_MORE_PANEL_VERTICAL_CHROME = 12;
const FLOWER_TERMINAL_THREAD_STATUSES = new Set<FlowerThreadStatus>(['idle', 'failed', 'success', 'canceled', 'read_only']);
const FLOWER_ACTIVE_THREAD_STATUSES = new Set<FlowerThreadStatus>(['running', 'waiting_approval', 'waiting_user']);
const SUBAGENT_DROPDOWN_ESTIMATED_SIZE = { width: 400, height: 480 } as const;
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
    ...(item.admitted ? { admitted: item.admitted } : {}),
  }));
}
function sameFlowerInputDrafts(left: Record<string, FlowerInputDraft>, right: Record<string, FlowerInputDraft>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => {
    const leftDraft = left[key] ?? {};
    const rightDraft = right[key] ?? {};
    return leftDraft.answer_kind === rightDraft.answer_kind
      && leftDraft.choice_id === rightDraft.choice_id
      && leftDraft.text === rightDraft.text;
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
    && left.reasoningModelID === right.reasoningModelID
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
  rejectAll = false,
): FlowerSubmitApprovalRequest {
  return {
    thread_id: thread.thread_id,
    interaction_id: action.action_id,
    approved,
    ...(rejectAll ? { reject_all: true } : {}),
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
    case 'waiting_user':
    case 'waiting_approval':
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

/** Two placements over the same Flower conversation, drafts and live runtime. */
export type FlowerEmbeddedConversation = Readonly<{
  scope: string;
  /** Durable conversation identity supplied by an embedding surface. */
  threadID?: string;
  /** Implicit surface context for the first turn of a new conversation only. */
  initialContextAction?: ContextActionEnvelope;
  /** Explicit references selected by the user for the current composer. */
  contextAction?: ContextActionEnvelope;
  request?: Readonly<{ nonce: number; prompt?: string }>;
  placeholder?: string;
  emptyContent?: JSX.Element;
  composerContext?: JSX.Element;
  onSubmit?: () => void;
  /** Captured at submission and invoked once after canonical admission. */
  onAccepted?: (receipt: Pick<FlowerTurnLaunchReceipt, 'client_request_id' | 'thread_id'>) => void;
  render: (parts: FlowerConversationParts) => JSX.Element;
}>;

export type FlowerConversationAction = Readonly<{
  id: string;
  label: string;
  icon: () => JSX.Element;
  disabled?: boolean;
  run: (source: HTMLElement) => void;
}>;

export type FlowerConversationParts = Readonly<{
  conversation: JSX.Element;
  composer: JSX.Element;
  actionLayout: Accessor<'chat' | 'input_request' | 'approval'>;
  actions: Accessor<readonly FlowerConversationAction[]>;
  actionOverlays: JSX.Element;
  trailingActions?: JSX.Element;
  threadID: Accessor<string>;
  newConversation: () => void;
}>;

export type FlowerSurfaceProps = Readonly<{
  adapter: FlowerSurfaceAdapter;
  embeddedConversation?: FlowerEmbeddedConversation;
  /** Read and freeze the current host page for a new draft only. */
  captureNewConversationContext?: () => FlowerPageContextSnapshot | undefined;
  /** Host-owned presentation shared with Ask Flower; snapshot validity stays here. */
  renderContextSnapshotPreview?: Component<FlowerContextSnapshotPreviewProps>;
  filesystemScopeKey?: string;
  filesystemScrollViewportProps?: JSX.HTMLAttributes<HTMLDivElement>;
  approvalScrollViewportProps?: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'> & { style?: JSX.CSSProperties } & Readonly<Record<`data-${string}`, string>>;
  approvalReadingProps?: JSX.HTMLAttributes<HTMLDivElement> & Readonly<Record<`data-${string}`, string>>;
  notify: (notification: FlowerSurfaceNotification) => void;
  copy?: FlowerSurfaceCopy;
  draftCoordinator: FlowerComposerDraftCoordinator;
  /** External settings version used to refresh environment defaults in place. */
  settingsRevision?: Accessor<string | number>;
  warmup?: FlowerSurfaceWarmupState | null;
  focusThreadRequest?: FlowerThreadFocusRequest | null;
  focusComposerRequest?: number;
  mobileThreadsOpen?: boolean;
  onMobileThreadsOpenChange?: (open: boolean) => void;
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
    targetThreadID?: string;
    running: boolean;
  }>;
  companionActionLabel?: string;
  companionCopy?: FlowerThreadSwitcherCopy;
  headerTrailingActions?: JSX.Element;
  onPresenceChange?: (presence: FlowerCompanionPresenceProjection) => void;
  onFocusThreadRequestConsumed?: (requestID: string) => void;
  onCompanionOpenRequest?: (threadID?: string) => void;
  onThreadSelectionEvent?: (event: UIFirstSelectionEvent<string, { source: 'thread-list' }>) => void;
  class?: string;
}>;

const FlowerCompanionLiveTailText: Component<Readonly<{
  text: string;
  identity: string;
}>> = (props) => {
  let prefixRef: HTMLSpanElement | undefined;
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
      prefix: prefixRef,
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
      <span ref={prefixRef} class="flower-companion-collapsed-tail-prefix" aria-hidden="true" hidden>&hellip;</span>
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
  const [embeddedDraftKeys, setEmbeddedDraftKeys] = createSignal<Record<string, string>>({});
  const pendingDraftKey = () => props.embeddedConversation
    ? embeddedDraftKeys()[props.embeddedConversation.scope] ?? `${PENDING_NEW_THREAD_ID}:${props.embeddedConversation.scope}`
    : PENDING_NEW_THREAD_ID;
  const isPendingDraftKey = (key: string) => key === PENDING_NEW_THREAD_ID || key.startsWith(`${PENDING_NEW_THREAD_ID}:`);
  const embeddedThreads = new Map<string, string>();
  const mobileInteraction = useMobileLayout();
  const [surfaceElement, setSurfaceElement] = createSignal<HTMLElement>();
  const [threadRailWidth, setThreadRailWidth] = createSignal(THREAD_RAIL_WIDTH_DEFAULT);
  const sidebarPresentation = createAdaptiveSidebar({
    container: surfaceElement,
    sidebarWidth: threadRailWidth,
    minContentWidth: () => 480,
  });
  const mobileNavigation = () => presentation() === 'full' && mobileInteraction();
  const navigationOverlay = () => presentation() === 'full' && (mobileInteraction() || sidebarPresentation() === 'overlay');
  const [desktopThreadsOpen, setDesktopThreadsOpen] = createSignal(false);
  const [localMobileThreadsOpen, setLocalMobileThreadsOpen] = createSignal(false);
  const mobileThreadsOpen = () => props.mobileThreadsOpen ?? localMobileThreadsOpen();
  const threadNavigationOpen = () => mobileNavigation() ? mobileThreadsOpen() : desktopThreadsOpen();
  const setThreadNavigationOpen = (open: boolean) => {
    if (!open || mobileNavigation()) {
      setLocalMobileThreadsOpen(open);
      props.onMobileThreadsOpenChange?.(open);
    }
    if (!open || !mobileNavigation()) setDesktopThreadsOpen(open);
  };
  createEffect(() => { if (!navigationOverlay()) setDesktopThreadsOpen(false); });
  const [threadDrawerPresent, setThreadDrawerPresent] = createSignal(false);
  const threadDrawerOpen = () => navigationOverlay() && threadNavigationOpen();
  const companionCollapsed = () => presentation() === 'companion' && !(props.companionOpen ?? true);
  const surfaceEngaged = () => props.engaged ?? true;
  const requestCompanionForEditing = () => {
    // Closing retains expanded content, but explicit editing restores engagement.
    if (presentation() === 'companion' && (companionCollapsed() || !surfaceEngaged())) {
      requestCompanionOpen();
    }
  };
  const transcriptVisible = () => props.transcriptVisible ?? true;
  const foregroundEngagementRequested = () => surfaceEngaged() && transcriptVisible() && !threadDrawerPresent() && documentVisible();
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
  const notifyPermissionError = (message: string) => notify({
    tone: 'error',
    title: copy().chat.permissionSelectorErrorTitle,
    message,
  });
  const notifyModelError = (message: string) => notify({
    tone: 'error',
    title: copy().chat.modelUpdateFailedTitle,
    message,
  });
  const notifyConversationPreferenceError = (message: string) => notify({
    tone: 'error', title: copy().settings.autoSave.saveFailed, message,
  });
  const notifyFutureDefaultModelError = (message: string) => notify({
    tone: 'error',
    title: copy().chat.defaultModelUpdateFailedTitle,
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
  const [settingsState, setSettingsState] = createSignal<Readonly<{ status: 'loading' | 'ready' | 'error'; error?: string }>>({ status: 'loading' });
  const settingsError = () => settingsState().error ?? '';
  const settingsReady = () => settingsState().status === 'ready';
  const [saveError, setSaveError] = createSignal('');
  const [savedAt, setSavedAt] = createSignal<number | null>(null);
  const [snapshot, setSnapshot] = createSignal<FlowerSettingsSnapshot | null>(null);
  const settingsLoading = () => settingsState().status === 'loading';
  // A preference save notifies every mounted surface. The originating surface
  // already has the authoritative response and must not reload its composer.
  let localPreferenceRefreshesPending = 0;
	const [threadCache, setThreadCache] = createSignal(createThreadCache());
  const outboxExpirationChanged = () => setOutboxRetryTick(tick => tick + 1);
  const [transportOutbox, setTransportOutbox] = createSignal(createTransportOutbox({ onExpired: outboxExpirationChanged }));
  const [stoppingThreadIDs, setStoppingThreadIDs] = createSignal<ReadonlySet<string>>(new Set());
  const stopThreadRequests = new Map<string, Promise<void>>();
  const updateThreadIDMembership = (
    setter: typeof setStoppingThreadIDs,
    threadID: string,
    present: boolean,
  ) => {
    const tid = trimString(threadID);
    if (!tid) return;
    setter((current) => {
      if (current.has(tid) === present) return current;
      const next = new Set(current);
      if (present) next.add(tid);
      else next.delete(tid);
      return next;
    });
  };
  const liveTransport = createLiveTransport<FlowerLiveStreamEnvelope>();
  const [liveSyncState, setLiveSyncState] = createSignal<LiveTransportState>({ status: 'stopped', connectionEpoch: 0 });
  const livePresentationConfirmed = () => !props.adapter.connectLiveStream || liveSyncState().status === 'ready';
  const [unconfirmedStops, setUnconfirmedStops] = createSignal<ReadonlySet<string>>(new Set());
  const readDetail = <T,>(read: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => (
    withFlowerReadDeadline(read, copy().chat.syncTimeout, signal)
  );
  let subagentDetailReadController: AbortController | undefined;
  const [computerObserverID, setComputerObserverID] = createSignal('');
  const [computerLiveFrame, setComputerLiveFrame] = createSignal<FlowerLiveStreamEnvelope>();
  let computerViewerRevision = 0;
  const companionRunTracker = new FlowerCompanionRunTracker();
  const [companionRunRevision, setCompanionRunRevision] = createSignal(0);
  const [companionRunReceipt, setCompanionRunReceipt] = createSignal<FlowerCompanionTerminalTransition>();
	const outboxResendInFlight = new Set<string>();
	const pendingAdmissionHandoffs = new Map<string, PendingAdmissionHandoff>();
	const canConfirmOutboxEntry = (entry: TransportOutboxEntry): boolean => (
		!isPendingDraftKey(entry.threadId)
		|| pendingAdmissionHandoffs.has(entry.requestId)
	);
	let transportOutboxDisposed = false;
	onMount(() => {
		void restoreTransportOutbox({ onExpired: outboxExpirationChanged }).then((restored) => {
			if (transportOutboxDisposed) {
				restored.dispose();
				return;
			}
			setTransportOutbox((current) => {
				let merged = restored;
				for (const entry of current.entries.values()) merged = merged.put(entry);
				current.dispose();
				return merged;
			});
		}).catch((error) => {
			if (!transportOutboxDisposed) notifyComposerError(getErrorMessage(error));
		});
	});
	onCleanup(() => {
		transportOutboxDisposed = true;
		pendingAdmissionHandoffs.clear();
    outboxResendInFlight.clear();
    launchChatTurnInFlight.clear();
    outboxDraftRestorers.clear();
    outboxOperations.clear();
		transportOutbox().dispose();
	});
	const threads = createMemo<readonly FlowerThreadSnapshot[]>((previous) => retainEqualValue(previous, [...threadCache().summaries.values()]));
	const selectedThreadID = createMemo(() => threadCache().selectedId ?? '');
  // The rail may acknowledge navigation before committing the expensive conversation projection.
  const [pendingThreadSelection, setPendingThreadSelection] = createSignal('');
  const activeThreadID = () => pendingThreadSelection() || selectedThreadID();
	const setSelectedThreadID = (threadID: string) => {
		setThreadCache((cache) => cache.select(trimString(threadID) || null));
	};
  const [queuedTurnReorder, setQueuedTurnReorder] = createSignal<FlowerQueuedTurnReorderState | null>(null);
  const queuedTurnSendInFlight = new Map<string, string>();
  const [queuedTurnSendRevision, setQueuedTurnSendRevision] = createSignal(0);
  const queuedTurnSendPending = (threadID: string, queueID?: string): boolean => {
    queuedTurnSendRevision();
    const pendingQueueID = queuedTurnSendInFlight.get(trimString(threadID));
    return Boolean(pendingQueueID && (!queueID || pendingQueueID === trimString(queueID)));
  };
  // Reactive state updates are batched. Keep a synchronous guard as well so
  // Enter repeat and a same-tick click cannot admit the same draft twice.
  const launchChatTurnInFlight = new Set<string>();
  const [preparingSendRevision, setPreparingSendRevision] = createSignal(0);
  const composerSendPreparing = () => {
    preparingSendRevision();
    return launchChatTurnInFlight.has(currentComposerSessionKey());
  };
  const outboxDraftRestorers = new Map<string, () => boolean>();
  const outboxOperations = new Map<string, Readonly<{ adapter: FlowerSurfaceAdapter; prepare?: () => Promise<FlowerTurnLaunchInput> }>>();
  const [settingsSaving, setSettingsSaving] = createSignal(false);
  const [modelSourceRefreshing, setModelSourceRefreshing] = createSignal(false);
  const [threadsRefreshing, setThreadsRefreshing] = createSignal(false);
  const [threadListState, setThreadListState] = createSignal<'loading' | 'ready' | 'error'>('loading');
  const [threadListError, setThreadListError] = createSignal('');
  const [historyFilter, setHistoryFilter] = createSignal('');
  const [sidePanel, setSidePanel] = createSignal<FlowerSurfacePanel>('chat');
  const visiblePanel = () => companionCollapsed() || sidePanel() === 'settings' ? 'chat' : sidePanel();
  const [settingsDialogPresent, setSettingsDialogPresent] = createSignal(false);
  let settingsRestoreFocus: HTMLElement | null = null;
  createEffect(on(companionCollapsed, (collapsed) => {
    // Shell keeps companionOpen true through closing; reset only at its final phase.
    if (collapsed) setSidePanel('chat');
  }));
  const [settingsOpened, setSettingsOpened] = createSignal(false);
  const [extensionsOpened, setExtensionsOpened] = createSignal(false);
  let consumedSettingsFocusRequest = 0;
  const [contextSnapshotPreview, setContextSnapshotPreview] = createSignal<FlowerChatContextSnapshotPreview | null>(null);
  const [attachmentPreview, setAttachmentPreview] = createSignal<FlowerAttachmentPreviewSource | null>(null);
  const [workingDirectoryPickerOpen, setWorkingDirectoryPickerOpen] = createSignal(false);
  const [composerMoreOpen, setComposerMoreOpen] = createSignal(false);
  const [attachmentStateRevision, setAttachmentStateRevision] = createSignal(0);
  const [attachmentDragActive, setAttachmentDragActive] = createSignal(false);
  const [longTextPreparing, setLongTextPreparing] = createSignal(false);
  let cancelActiveLongTextSubmission: (() => void) | null = null;
  const [composerMorePanelPosition, setComposerMorePanelPosition] = createSignal<FlowerFloatingPoint>({ x: 8, y: 8 });
  const [composerControlLayout, setComposerControlLayout] = createSignal<FlowerComposerControlLayout>({
    availableWidth: null,
    itemWidths: {},
  });
  const terminalVisibleOutputStore = createTerminalVisibleOutputStore();

  createEffect(on(
    () => selectedThreadID(),
    (threadID) => {
      setContextSnapshotPreview(null);
      const active = untrack(activeSubagentDetail);
      if (active && active.parentThreadID !== trimString(threadID)) closeSubagentOverlays();
    },
    { defer: false },
  ));
	const setSelectedThreadWithDetail = (threadID: string) => {
		const tid = trimString(threadID);
		setSelectedThreadID(tid);
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
  let historyReadingRevision = 0;
  let historyReadingThreadID = '';
  let historyReadingInput: import('./contracts/flowerSurfaceContracts').FlowerHistoryRequest = {};
  const [historyBusy, setHistoryBusy] = createSignal(false);
  const [historyError, setHistoryError] = createSignal('');
  const [historyBodyRevision, setHistoryBodyRevision] = createSignal(0);
  const historyBodies = createHistoryBodyLoader(() => copy().chat.syncTimeout, () => setHistoryBodyRevision(value => value + 1));
  const historyBodyVisibility = createHistoryBodyVisibility();
  const [threadDetailLoadingIDs, setThreadDetailLoadingIDs] = createSignal<ReadonlySet<string>>(new Set());
  const [localReadVisibilityRevision, setLocalReadVisibilityRevision] = createSignal(0);
  const [threadActionBusy, setThreadActionBusy] = createSignal<{ threadID: string; action: FlowerThreadMenuAction } | null>(null);
  const forkRequests = new Map<string, FlowerForkThreadInput>();
  const [createdForkThreadID, setCreatedForkThreadID] = createSignal('');
  type ThreadPinCommand = Readonly<{ threadID: string } & (
    | { kind: 'pin'; pinned: boolean; wasPinned: boolean; pinnedAt: number }
    | { kind: 'move'; position: FlowerThreadPinPosition }
  )>;
  const [pinMutation, setPinMutation] = createSignal<ReadonlyMap<string, FlowerThreadPinMetadata>>(new Map());
  const [pinCommands, setPinCommands] = createSignal<readonly ThreadPinCommand[]>([]);
  createEffect(() => {
    const pending = pinMutation();
    const summaries = threadCache().summaries;
    const retained = new Map([...pending].filter(([id, pin]) => {
      const summary = summaries.get(id);
      return summary && summary.settings_revision < pin.settings_revision;
    }));
    if (retained.size !== pending.size) setPinMutation(retained);
  });
  let pinMutationGeneration = 0;
  onCleanup(() => { pinMutationGeneration += 1; });
  const projectThreadPins = (summaries: readonly FlowerThreadSnapshot[]) => {
    const acknowledged = pinMutation();
    const pending = pinCommands();
    const projected = new Map(summaries.filter(thread => !thread.parent_thread_id).map(thread => {
      const pin = acknowledged.get(thread.thread_id);
      return [thread.thread_id, pin && thread.settings_revision < pin.settings_revision
        ? { ...thread, pinned_at_ms: pin.pinned_at_ms, pin_rank: pin.pin_rank } : thread] as const;
    }));
    for (const command of pending) {
      const current = projected.get(command.threadID);
      if (!current) continue;
      if (command.kind === 'pin') {
        if ((Number(current.pinned_at_ms) > 0) === command.pinned && (!command.pinned || command.wasPinned)) continue;
        if (command.pinned) {
          const ordered = [...projected.values()].filter(thread => thread.thread_id !== command.threadID && Number(thread.pinned_at_ms) > 0).sort(comparePinnedFlowerThreads);
          ordered.forEach((thread, index) => projected.set(thread.thread_id, { ...thread, pin_rank: ordered.length - index + 1 }));
        }
        const rank = command.pinned ? 1 : 0;
        projected.set(command.threadID, { ...current, pinned_at_ms: command.pinned ? command.pinnedAt : 0, pin_rank: rank });
        continue;
      }
      const ordered = [...projected.values()].filter(thread => Number(thread.pinned_at_ms) > 0).sort(comparePinnedFlowerThreads);
      const source = ordered.findIndex(thread => thread.thread_id === command.threadID);
      if (source < 0 || !ordered.some(thread => thread.thread_id === command.position.anchor_thread_id)) continue;
      const [moved] = ordered.splice(source, 1);
      const anchor = ordered.findIndex(thread => thread.thread_id === command.position.anchor_thread_id);
      ordered.splice(anchor + (command.position.placement === 'after' ? 1 : 0), 0, moved);
      ordered.forEach((thread, index) => projected.set(thread.thread_id, { ...thread, pin_rank: ordered.length - index }));
    }
    return [...projected.values()];
  };
  const [renameTarget, setRenameTarget] = createSignal<Readonly<{ threadID: string; placement: 'dialog' | 'header' }> | null>(null);
  const renameThreadID = () => renameTarget()?.threadID ?? '';
  const headerTitleEditing = () => renameTarget()?.placement === 'header' && renameThreadID() === selectedThreadID();
  const [renameDraft, setRenameDraft] = createSignal('');
  const [renameError, setRenameError] = createSignal('');
  const [renameSaving, setRenameSaving] = createSignal(false);
  const [deleteTarget, setDeleteTarget] = createSignal<Readonly<{ item: FlowerThreadListItem; restore?: HTMLElement }> | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal('');
  const [selectedThreadTailReveal, setSelectedThreadTailReveal] = createSignal<SelectedThreadTailReveal | null>(null);
  const [threadSwitcherOpen, setThreadSwitcherOpen] = createSignal(false);
  const [threadSwitcherQuery, setThreadSwitcherQuery] = createSignal('');
  const [presentedSelection, setPresentedSelection] = createSignal<Readonly<{ threadID: string; sequence: number; contentRevision: number }> | null>(null);
  const [documentVisible, setDocumentVisible] = createSignal(
    typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  const [engagementBootstrapReady, setEngagementBootstrapReady] = createSignal(foregroundEngagementRequested());
  const [openActivityRuns, setOpenActivityRuns] = createSignal<Record<string, boolean>>({});
  const [activityClockNow, setActivityClockNow] = createSignal(Date.now());
  const [approvalQueueAnnouncement, setApprovalQueueAnnouncement] = createSignal('');
  const [approvalErrors, setApprovalErrors] = createSignal<Readonly<Record<string, string>>>({});
  const decisionSubmissionIDs = new Set<string>();
  const [decisionSubmissionRevision, setDecisionSubmissionRevision] = createSignal(0);
  const [copiedMessageAction, setCopiedMessageAction] = createSignal('');
  const [copiedApprovalAction, setCopiedApprovalAction] = createSignal('');
  const [transcriptLayoutRevision, setTranscriptLayoutRevision] = createSignal(0);
  const [subagentDropdownOpen, setSubagentDropdownOpen] = createSignal(false);
  const [settledSubagentsExpanded, setSettledSubagentsExpanded] = createSignal(false);
  const [subagentDropdownPosition, setSubagentDropdownPosition] = createSignal<FlowerFloatingPoint>({ x: 0, y: 0 });
  const [permissionMenuOpen, setPermissionMenuOpen] = createSignal(false);
  const [permissionMenuActiveIndex, setPermissionMenuActiveIndex] = createSignal(0);
  const [pendingPermissionPatch, setPendingPermissionPatch] = createSignal<PendingPermissionPatch | null>(null);
  const [pendingModelPatch, setPendingModelPatch] = createSignal<PendingModelPatch | null>(null);
  const [pendingReasoningThreadIDs, setPendingReasoningThreadIDs] = createSignal<ReadonlySet<string>>(new Set());
  const [activeSubagentDetail, setActiveSubagentDetail] = createSignal<ActiveSubagentDetail | null>(null);
  const [attentionNavigation, setAttentionNavigation] = createSignal<{parentThreadID: string; childThreadID: string} | null>(null);
  const handleChildAttention = (parentThreadID: string, childThreadID: string) => {
    setAttentionNavigation({ parentThreadID, childThreadID });
    selectThread(childThreadID);
  };
  const subagentDetailOpen = createMemo(() => activeSubagentDetail() !== null);
  const activeSubagentID = createMemo(() => activeSubagentDetail()?.childThreadID ?? '');
  const retainedAttentionChildID = createMemo(() => attentionNavigation()?.childThreadID === selectedThreadID() ? selectedThreadID() : '');
  createComputed(on([activeSubagentID, retainedAttentionChildID], (ids) => {
    setThreadCache(cache => cache.retainDetails(ids));
  }));
  const subagentDetailSummary = () => activeSubagentDetail()?.summary ?? null;
  const subagentDetailLoading = () => {
    const active = activeSubagentDetail();
    return active?.requestStatus === 'loading';
  };
  const subagentDetailError = () => {
    const active = activeSubagentDetail();
    return active?.error || (active?.requestStatus === 'idle' && !threadCache().views.has(active.childThreadID) ? copy().chat.threadSyncFailed : '');
  };
  let subagentDetailGeneration = 0;
  type SubagentInputAction = FlowerSubagentInputOperation['action'];
  type SubagentInputCommand = Readonly<{ busy: boolean; error: string; action: SubagentInputAction; requestID: string; fingerprint?: string }>;
  const [subagentInputCommands, setSubagentInputCommands] = createSignal<Readonly<Record<string, SubagentInputCommand>>>({});
  const subagentInputKey = (itemID: string) => JSON.stringify([activeSubagentDetail()?.parentThreadID, activeSubagentID(), itemID]);
  const subagentInputCommand = (itemID: string) => subagentInputCommands()[subagentInputKey(itemID)];

  let threadLoadSequence = 0;
  let engagementBootstrapSequence = 0;
  let threadsRefreshSequence = 0;
  let threadsReadController: AbortController | undefined;
  let flowerLiveReadyCount = 0;
  const flowerBaseline = createFlowerThreadBaseline();
  let navigationReadController = new AbortController();
  const releaseNavigationReads = () => {
    navigationReadController.abort();
    for (const controller of preparingBodyReads.values()) controller.abort();
    preparingBodyReads.clear();
    navigationReadController = new AbortController();
  };
  let startedFocusThreadRequestID = '';
  let startedFocusComposerRequest = 0;
  let composerRef: HTMLTextAreaElement | HTMLInputElement | undefined;
  let companionActionRef: HTMLButtonElement | undefined;
  let companionSummaryRef: HTMLButtonElement | undefined;
  let surfaceRef: HTMLElement | undefined;
  let mobileThreadsTrigger: HTMLButtonElement | undefined;

  let composerSurfaceRef: HTMLDivElement | undefined;
  let restoringCompanionFocus = false;
  let companionActivationToken = 0;
  let composerReferenceMenuRef: HTMLDivElement | undefined;
  let composerAutosizeController: FlowerComposerAutosizeController | undefined;
  const composerReferenceRemoveButtons = new Map<string, HTMLButtonElement>();
  let attachmentPickerRef: HTMLInputElement | undefined;
  let attachmentPickerButtonRef: HTMLButtonElement | undefined;
  let attachmentReselectTarget: Readonly<{ sessionKey: string; localID: string }> | null = null;
  let attachmentPickerSessionKey = '';
  let surfaceDisposed = false;
  const [composerFocused, setComposerFocused] = createSignal(false);
  const [composerHistoryBrowsing, setComposerHistoryBrowsing] = createSignal(false);
  const [composerHistoryAnnouncement, setComposerHistoryAnnouncement] = createSignal('');
  let composerApprovalCardRef: HTMLElement | undefined;
  let previousComposerApprovalAnnouncementKey = '';
  const [modelMenuOpen, setModelMenuOpen] = createSignal(false);
  const [modelQuery, setModelQuery] = createSignal('');
  const [modelMenuExpanded, setModelMenuExpanded] = createSignal(false);
  let modelSearchRef: HTMLInputElement | undefined;
  const [modelMenuPosition, setModelMenuPosition] = createSignal({ x: 0, y: 0 });
  const [modelMenuSize, setModelMenuSize] = createSignal({ width: 416, height: 480 });
  const [modelMenuAvailableHeight, setModelMenuAvailableHeight] = createSignal(480);
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
  let subagentTriggerRef: HTMLElement | undefined;
  let subagentDropdownRef: HTMLDivElement | undefined;
  let renameDialogRef: HTMLDivElement | undefined;
  let renameInputRef: HTMLInputElement | undefined;
  let renameRestoreRef: HTMLElement | undefined;
  let headerRenameTriggerRef: HTMLButtonElement | undefined;
  let threadSwitcherTriggerRef: HTMLButtonElement | undefined;
  let threadSwitcherRef: HTMLDivElement | undefined;
  const preparingBodyReads = new Map<string, AbortController>();
  let cancelSelectionCommit: (() => void) | undefined;
  const composerReferenceIndex = props.adapter.listWorkingDirectoryEntries
    ? createFlowerComposerReferenceIndex({
      listDirectory: (path) => props.adapter.listWorkingDirectoryEntries!({ path, showHidden: false }),
      onStateChange: setComposerReferenceSearchState,
    })
    : null;
  onCleanup(() => composerReferenceIndex?.dispose());
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
  type ComposerFocusRequest = Readonly<{
    token: number;
    owner: Element | null;
    identity: string;
    restoreCompanion: boolean;
  }>;
  const [composerFocusRequest, setComposerFocusRequest] = createSignal<ComposerFocusRequest | null>(null);
  type BottomActionFocusHandoff = Readonly<{
    threadID: string;
    owner: Element | null;
    approvalActionID: string;
    owned: boolean;
  }>;
  const [pendingStopFocusHandoff, setPendingStopFocusHandoff] = createSignal<BottomActionFocusHandoff | null>(null);
  const captureBottomActionFocus = (threadID: string, requestedApprovalActionID = ''): BottomActionFocusHandoff => {
    const owner = typeof document === 'undefined' ? null : document.activeElement;
    const surface = owner instanceof HTMLElement && composerSurfaceRef?.contains(owner)
      ? composerSurfaceRef
      : null;
    const approvalActionID = surface && owner instanceof HTMLElement
      ? trimString(owner.closest<HTMLElement>('[data-flower-approval-action-id]')?.dataset.flowerApprovalActionId) || requestedApprovalActionID
      : '';
    return {
      threadID,
      owner,
      approvalActionID,
      owned: Boolean(surface && owner && surface.contains(owner)),
    };
  };
  const bottomActionFocusStillOwned = (handoff: BottomActionFocusHandoff): boolean => {
    if (!handoff.owned || typeof document === 'undefined') return false;
    if (!surfaceEngaged() || companionCollapsed() || surfaceRef?.closest('[inert]')) return false;
    const active = document.activeElement;
    return active == null
      || active === document.body
      || active === handoff.owner;
  };
  const scheduleBottomActionFocus = (handoff: BottomActionFocusHandoff) => {
    if (!handoff.owned) return;
    queueMicrotask(async () => {
      if (bottomActionMode() === 'input_request') await FlowerInputChoices.preload();
      let attempts = 0;
      const focusNextAction = () => {
        if (!selectedThreadDetailMatches(handoff.threadID) || !bottomActionFocusStillOwned(handoff)) return;
        if (handoff.approvalActionID && handoff.owner?.isConnected && bottomActionMode() === 'approval') return;
        const target = handoff.approvalActionID && bottomActionMode() === 'approval'
          ? composerSurfaceRef?.querySelector<HTMLElement>('[data-flower-composer-approval]') ?? composerApprovalCardRef
          : bottomActionEditTarget();
        if (target?.isConnected && !target.closest('[inert]') && !target.matches(':disabled')) {
          target.focus({ preventScroll: true });
          if (document.activeElement === target) return;
        }
        if (bottomActionMode() === 'chat' && attempts++ < 3) requestTranscriptAnimationFrame(focusNextAction);
      };
      requestTranscriptAnimationFrame(focusNextAction);
    });
  };
  let threadsRefreshRequest: Promise<boolean> | null = null;
  const retiredThreadIDs = new Set<string>();
  let copiedMessageResetTimer: number | undefined;
  let copiedApprovalResetTimer: number | undefined;
  let activityClockTimer: number | undefined;
  let composerMorePanelPositionFrame = 0;
  let composerReferenceMenuPositionFrame = 0;
  let composerSelectionFrame = 0;
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
        if (threadSelectionTransaction !== transaction || selectedThreadTailReveal()) return;
		if (!threadCache().views.has(transaction.value)) return;
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
  const readPresentationVisible = () => effectiveEngagement() && sidePanel() === 'chat'
    && !companionCollapsed() && !settingsDialogPresent();
  const schedulePresentedSelection = (threadID: string, sequence: number, contentRevision = threadCache().views.get(threadID)?.contentRevision ?? 0) => {
    const tid = trimString(threadID);
    cancelPresentedSelectionSchedule();
    setPresentedSelection(null);
    if (!tid || !readPresentationVisible()) return;
    presentedSelectionFrame = requestTranscriptAnimationFrame(() => {
      presentedSelectionFrame = 0;
      presentedSelectionTimer = window.setTimeout(() => {
        presentedSelectionTimer = undefined;
        if (!readPresentationVisible()) return;
			if (sequence !== threadLoadSequence || selectedThreadID() !== tid || !threadCache().views.has(tid)) return;
        if (threadLoadError() || threadDetailLoadingIDs().has(tid) || pendingThreadSelection() || selectedThreadTailReveal()) return;
        if (threadCache().views.get(tid)?.contentRevision !== contentRevision) return;
        setPresentedSelection({ threadID: tid, sequence, contentRevision });
      }, 0);
    });
  };
  const cancelDeferredThreadSelection = () => {
    setPendingThreadSelection('');
    deferredThreadSelectionToken += 1;
    cancelSelectionCommit?.();
    cancelSelectionCommit = undefined;
  };
  createEffect(on(
    () => [
      selectedThreadID(),
			threadCache().views.get(selectedThreadID())?.contentRevision,
      threadLoadError(),
      sidePanel(),
      readPresentationVisible(),
      threadDetailLoadingIDs().has(selectedThreadID()),
      pendingThreadSelection(),
      selectedThreadTailReveal(),
    ] as const,
			([threadID, detailReady, error, , engaged, loading, pending]) => {
      cancelPresentedSelectionSchedule();
      setPresentedSelection(null);
				if (!engaged || !threadID || !detailReady || error || loading || pending) return;
      schedulePresentedSelection(threadID, threadLoadSequence, detailReady);
    },
    { defer: false },
  ));
  const turnDisclosureChoices = createFlowerTurnDisclosureStore();
  const [expandedDetails, setExpandedDetails] = createStore<Record<string, boolean>>({});
  const detailDisclosureKey = (threadID: string, kind: string, id: string) =>
    JSON.stringify([props.adapter.runtime.runtime_id, threadID, kind, id]);
  const transcriptScroll = createFlowerScrollTailController({
    canFollowLatest: () => selectedThreadHasContent() || selectedThreadHasLiveProgress() || visibleTransportOutbox().length > 0,
    onUserInteraction: () => { if (selectedThreadTailPreparing()) cancelSelectedThreadTailReveal(); },
    onLayout: () => {
      const pending = selectedThreadTailReveal();
      if (pending) settleSelectedThreadTailReveal(pending.threadID, pending.sequence);
    },
    reducedMotionPreferred,
    requestAnimationFrame: requestTranscriptAnimationFrame,
    cancelAnimationFrame: cancelTranscriptAnimationFrame,
  });
  const subagentDetailScroll = createFlowerScrollTailController({
    reducedMotionPreferred,
    requestAnimationFrame: requestTranscriptAnimationFrame,
    cancelAnimationFrame: cancelTranscriptAnimationFrame,
  });
  const resetSubagentDetailScroll = () => {
    subagentDetailScroll.dispose();
    subagentDetailScroll.bind(undefined);
    subagentDetailScroll.startFollowing();
  };
  const closeSubagentOverlays = () => {
    setSubagentDropdownOpen(false);
    subagentDetailGeneration += 1;
    subagentDetailReadController?.abort();
    setActiveSubagentDetail(null);
    setSubagentInputCommands({});
    resetSubagentDetailScroll();
  };
  const selectedThreadTailPreparing = createMemo(() => {
    const pending = selectedThreadTailReveal();
    return Boolean(pending && pending.threadID === selectedThreadID());
  });
  const selectedThreadTailRevealIsCurrent = (threadID: string, sequence: number): boolean => {
    const pending = selectedThreadTailReveal();
    return Boolean(
      !surfaceDisposed && pending
      && pending.threadID === threadID
      && pending.sequence === sequence
      && sequence === threadLoadSequence
      && selectedThreadID() === threadID,
    );
  };
  const releasePreparingBodyReads = () => {
    for (const [itemID, controller] of preparingBodyReads) {
      // A failed read keeps its local Retry state until navigation cancels it.
      const pending = selectedThreadTailReveal();
      if (!pending || historyBodies.state(historyBodyKey(pending.threadID, itemID)) !== 'failed') controller.abort();
    }
    preparingBodyReads.clear();
  };
  const settleSelectedThreadTailReveal = (threadID: string, sequence: number) => {
    if (!selectedThreadTailRevealIsCurrent(threadID, sequence)) return;
    if (threadLoadError()) { cancelSelectedThreadTailReveal(); return; }
    if (!selectedThread()) return;
    const viewport = transcriptScroll.viewport();
    if (!viewport?.isConnected || viewport.clientHeight <= 0) return;
    // Prepare only text in the positioned destination, newest first. Earlier
    // placeholders must not occupy read slots ahead of the visible tail.
    const bounds = viewport.getBoundingClientRect();
    // content-visibility:auto can report only intrinsic placeholder geometry
    // even after all message bodies have loaded. Wait for the browser to lay
    // out destination-visible rows before using that geometry to reveal them.
    // The scroll owner receives content-visibility and resize notifications.
    const visibleRows = viewport.querySelectorAll<HTMLElement>('.flower-turn-row[data-flower-turn-settled="true"]');
    for (const row of visibleRows) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue;
      const content = row.querySelector<HTMLElement>('.flower-turn-row-viewport:not([data-state="closed"]) > .flower-turn-row-content');
      if (content && !content.checkVisibility({ contentVisibilityAuto: true })) {
        return;
      }
    }
    const needed: string[] = [];
    if (props.adapter.loadHistoryItem) {
      const placeholders = viewport.querySelectorAll<HTMLElement>('.flower-history-text-loading');
      for (let index = placeholders.length - 1; index >= 0; index--) {
        const element = placeholders[index];
        const rect = element.getBoundingClientRect();
        if (rect.height <= 0 || rect.bottom <= bounds.top - HISTORY_BODY_VIEWPORT_MARGIN_PX || rect.top >= bounds.bottom + HISTORY_BODY_VIEWPORT_MARGIN_PX) continue;
        const id = element.closest<HTMLElement>('[data-flower-message-id]')?.dataset.flowerMessageId;
        if (id && historyBodies.state(historyBodyKey(threadID, id)) !== 'failed') needed.push(id);
        if (needed.length === HISTORY_BODY_CONCURRENCY) break;
      }
    }
    const wanted = new Set(needed);
    for (const [id, controller] of preparingBodyReads) {
      if (!wanted.has(id)) {
        if (historyBodies.state(historyBodyKey(threadID, id)) !== 'failed') controller.abort();
        preparingBodyReads.delete(id);
      }
    }
    if (needed.length) {
      for (const id of wanted) {
        if (preparingBodyReads.has(id)) continue;
        const controller = new AbortController();
        preparingBodyReads.set(id, controller);
        loadHistoryItem(threadID, id, controller.signal, false, transcriptScroll);
      }
      return;
    }
    releasePreparingBodyReads();
    setSelectedThreadTailReveal(null);
    scheduleThreadSelectionContentPresented(threadID);
  };
  const scheduleSelectedThreadTailReveal = (threadID: string, sequence: number) => {
    if (selectedThreadTailRevealIsCurrent(threadID, sequence)) transcriptScroll.measureAfterLayout();
  };
  const beginSelectedThreadTailReveal = (threadID: string, sequence: number) => {
    releasePreparingBodyReads();
    setSelectedThreadTailReveal({ threadID, sequence });
  };
  const cancelSelectedThreadTailReveal = () => {
    releasePreparingBodyReads();
    const pending = selectedThreadTailReveal();
    setSelectedThreadTailReveal(null);
    if (pending && selectedThreadID() === pending.threadID) scheduleThreadSelectionContentPresented(pending.threadID);
  };

	const selectedThread = createMemo(() => {
		const threadID = trimString(selectedThreadID());
		if (!threadID) return null;
		return threadCache().views.get(threadID)?.thread ?? null;
	});
	const selectedThreadSummary = createMemo(() => {
		const threadID = trimString(selectedThreadID());
		return threadID ? threadCache().summaries.get(threadID) : undefined;
	});
  const selectedThreadSettings = createMemo(() => {
    const detail = selectedThread();
    const summary = selectedThreadSummary();
    return summary && (!detail || threadSettingsRevision(summary) > threadSettingsRevision(detail))
      ? summary
      : detail;
  });
	const selectedThreadSummaryNeedsDetail = createMemo(() => (
		threadSummaryNeedsDetail(selectedThreadSummary(), selectedThread() ?? undefined, threadCache().views.get(selectedThreadID())?.contentRevision)
      || (Boolean(computerObserverID()) && threadCache().views.get(selectedThreadID())?.version === 0)
	));
	const selectedThreadTerminalSyncing = createMemo(() => {
		const summary = selectedThreadSummary();
		const detail = selectedThread();
		return Boolean(
			summary
			&& detail
			&& selectedThreadSummaryNeedsDetail()
			&& FLOWER_TERMINAL_THREAD_STATUSES.has(summary.status)
			&& FLOWER_ACTIVE_THREAD_STATUSES.has(detail.status)
		);
	});
	const selectedThreadTitle = createMemo(() => {
		const threadID = trimString(selectedThreadID());
		if (!threadID) return copy().chat.titleFallback;
		return canonicalFlowerThreadSnapshotTitle(threadCache().summaries.get(threadID))
			|| canonicalFlowerThreadSnapshotTitle(threadCache().views.get(threadID)?.thread)
      || flowerThreadDisplayTitle({ thread_id: threadID, title: '', title_status: 'unset' }, copy().threadList.untitled);
	});
  const companionCollapsedEmptySelection = createMemo(() => (
    companionCollapsed() && !trimString(selectedThreadID())
  ));
  const selectedCanonicalQueuedTurns = createMemo<readonly FlowerQueuedTurn[]>(() => {
    const thread = selectedThread();
    return thread && trimString(thread.thread_id) === trimString(selectedThreadID())
      ? thread.queued_turns ?? []
      : [];
  });
  const selectedQueuedTurns = createMemo<readonly FlowerQueuedTurn[]>(() => {
    const canonical = selectedCanonicalQueuedTurns();
    const reorder = queuedTurnReorder();
    if (!reorder || reorder.threadID !== selectedThreadID()) return canonical;
    const canonicalIDs = canonical.map((turn) => trimString(turn.queue_id));
    if (!sameQueuedTurnIDs(canonicalIDs, reorder.orderedQueueIDs)) return canonical;
    const byID = new Map(canonical.map((turn) => [trimString(turn.queue_id), turn] as const));
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
  const selectedThreadLiveStatus = createMemo(() => (
    selectedThreadTerminalSyncing()
      ? selectedThreadSummary()?.status ?? 'idle'
      : selectedThread()?.status ?? 'idle'
  ));
  const surfaceReadOnly = createMemo(() => props.adapter.canMutate === false);
  const selectedThreadReadOnlyReason = createMemo(() => trimString(selectedThread()?.read_only_reason));
  const selectedThreadReadOnly = createMemo(() => surfaceReadOnly() || selectedThreadLiveStatus() === 'read_only' || Boolean(selectedThreadReadOnlyReason()));
  const selectedThreadReadOnlyDisplay = createMemo(() => (
    selectedThreadReadOnlyReason()
      || (selectedThreadLiveStatus() === 'read_only' ? copy().chat.threadReference.unavailable : subagentsCopy().readOnlyComposerLabel)
  ));
  const visibleInputRequest = (thread: FlowerThreadSnapshot | null | undefined): FlowerInputRequest | null => (
    thread?.status === 'waiting_user' ? thread.input_request ?? null : null
  );
  const selectedInputRequest = createMemo(() => {
    const thread = selectedThread();
    return visibleInputRequest(thread);
  });
  const selectedThreadStopPending = createMemo(() => (
    stoppingThreadIDs().has(trimString(selectedThreadID())) || flowerThreadIsStopping(selectedThread())
  ));
  createEffect(() => {
    const cache = threadCache();
    for (const threadID of stoppingThreadIDs()) {
      const thread = cache.views.get(threadID)?.thread ?? cache.summaries.get(threadID);
      // Acceptance can arrive before its live observation. Keep request
      // feedback until the canonical view confirms Stop or a terminal race.
      if (thread && (thread.cancellation || !flowerThreadHasActiveTurnEvidence(thread))) {
        updateThreadIDMembership(setStoppingThreadIDs, threadID, false);
      }
    }
  });
  const selectedThreadStopLabel = createMemo(() => (
    selectedThreadStopPending() ? copy().chat.stopping : copy().chat.stop
  ));
  const selectedThreadHasActiveTurnEvidence = createMemo(() => {
    const threadID = trimString(selectedThreadID());
    if (!threadID) return false;
    return flowerThreadHasActiveTurnEvidence(selectedThread())
      || flowerThreadHasActiveTurnEvidence(selectedThreadSummary())
      || stoppingThreadIDs().has(threadID);
  });
  const selectedThreadCanStop = createMemo(() => (
    !selectedThreadReadOnly()
    && Boolean(trimString(selectedThreadID()))
    && selectedThreadHasActiveTurnEvidence()
  ));
  createEffect(() => {
    const handoff = pendingStopFocusHandoff();
    if (!handoff) return;
    if (trimString(selectedThreadID()) !== handoff.threadID) {
      setPendingStopFocusHandoff(null);
      return;
    }
    if (selectedThreadHasActiveTurnEvidence()) return;
    setPendingStopFocusHandoff(null);
    scheduleBottomActionFocus(handoff);
  });
	const selectedThreadDetailPending = createMemo(() => {
		const threadID = trimString(selectedThreadID());
		return Boolean(threadID && !threadCache().views.has(threadID));
  });
  const selectedDecisionAvailable = createMemo(() => (
    !selectedThreadReadOnly() && !selectedThreadDetailPending() && !threadLoadError()
  ));
  const selectedThreadHasContent = createMemo(() => {
    const thread = selectedThread();
    if (!thread) return false;
    return thread.messages.length > 0
      || (thread.parent_events ? thread.parent_events.events.length : 0) > 0
      || (thread.queued_turns?.length ?? 0) > 0
      || !!visibleInputRequest(thread)
      || (thread.approval_actions?.length ?? 0) > 0
      || trimString(thread.error?.message) !== '';
  });
  const selectedApprovalActions = createMemo(() => (
    selectedThread()?.approval_actions?.filter((action) => action.status === 'pending' && action.state === 'requested') ?? []
  ));
  const selectedComposerApprovalActions = createMemo(() => flowerPendingApprovalActions(selectedThread()));
  const approvalActionIsDelegated = (action: FlowerApprovalAction): boolean => action.origin === 'delegated_subagent';
  const approvalActionIsPrimarySurface = (action: FlowerApprovalAction): boolean => (
    action.surface_role === 'primary_action'
    || !action.surface_role
  );
  const decisionSubmissionKey = (threadID: string, interactionID: string) => JSON.stringify([threadID, interactionID]);
  const decisionIsSubmitting = (threadID: string, interactionID: string): boolean => {
    decisionSubmissionRevision();
    return decisionSubmissionIDs.has(decisionSubmissionKey(threadID, interactionID));
  };
  const setDecisionSubmitting = (threadID: string, interactionID: string, submitting: boolean): boolean => {
    if (!threadID || !interactionID) return false;
    const key = decisionSubmissionKey(threadID, interactionID);
    if (submitting) {
      if (decisionSubmissionIDs.has(key)) return false;
      decisionSubmissionIDs.add(key);
    } else {
      decisionSubmissionIDs.delete(key);
    }
    setDecisionSubmissionRevision((revision) => revision + 1);
    return true;
  };
  const approvalActionIsSubmitting = (actionID: string): boolean => decisionIsSubmitting(selectedThreadID(), actionID);
  const inputRequestIsSubmitting = () => decisionIsSubmitting(selectedThreadID(), selectedInputRequest()?.prompt_id ?? '');
  const approvalActionCanDecide = (action: FlowerApprovalAction): boolean => (
    action.can_approve
    && Boolean(selectedThread()?.approval_actions?.some(candidate => candidate.action_id === action.action_id))
    && approvalActionIsPrimarySurface(action)
    && action.status === 'pending'
    && action.state === 'requested'
    && !approvalActionIsSubmitting(action.action_id)
    && selectedDecisionAvailable()
  );
  const selectedComposerApprovalAction = createMemo(() => flowerDisplayApprovalAction(selectedThread()));
  const selectedApprovalBatchActions = createMemo(() => {
    return selectedComposerApprovalActions().filter((action) => action.can_approve);
  });
  createEffect(() => {
    const keys = new Set(selectedComposerApprovalActions().map(action => decisionSubmissionKey(selectedThreadID(), action.action_id)));
    setApprovalErrors(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => keys.has(key))));
  });
  const clearApprovalError = (threadID: string, actionID: string) => setApprovalErrors(previous => {
    const next = { ...previous };
    delete next[decisionSubmissionKey(threadID, actionID)];
    return next;
  });
  const selectedComposerApprovalDisplayAction = selectedComposerApprovalAction;
  createEffect(() => {
    const actionID = trimString(selectedComposerApprovalDisplayAction()?.action_id);
    const actionCount = selectedComposerApprovalActions().length;
    const key = JSON.stringify([selectedThreadID(), actionID, actionCount]);
    if (actionCount > 0 && key !== previousComposerApprovalAnnouncementKey) {
      setApprovalQueueAnnouncement(copy().chat.toolApprovalPendingCount(actionCount));
    }
    previousComposerApprovalAnnouncementKey = key;
  });
  const selectedThreadLevelApprovalActions = createMemo(() => {
    const composerActionIDs = new Set(selectedComposerApprovalActions().map((action) => trimString(action.action_id)));
    return selectedApprovalActions().filter((action) => (
      approvalActionIsDelegated(action)
      && approvalActionIsPrimarySurface(action)
      && !composerActionIDs.has(trimString(action.action_id))
    ));
  });
  const selectedThreadLoading = createMemo(() => (
    threadDetailLoadingIDs().has(trimString(selectedThreadID()))
  ));
	const attachmentControllers = new Map<string, FlowerAttachmentController>();
	const attachmentControllerUnsubscribers = new Map<string, () => void>();
	const draftSessions = new Map<string, FlowerComposerDraftSession>();
	const draftSessionSnapshots = new Map<string, () => FlowerComposerDraftSnapshot>();
	const draftSessionUnsubscribers = new Map<string, () => void>();
	const hydratedDraftSessionRevisions = new Map<string, number>();
	const draftSessionFor = (rawSessionKey: string): FlowerComposerDraftSession => {
		const sessionKey = trimString(rawSessionKey) || pendingDraftKey();
		const existing = draftSessions.get(sessionKey);
		if (existing) return existing;
		const session = draftCoordinator.open(sessionKey);
		draftSessions.set(sessionKey, session);
		const [draftSnapshot, setDraftSnapshot] = createSignal(session.snapshot(), { equals: false });
		draftSessionSnapshots.set(sessionKey, draftSnapshot);
		draftSessionUnsubscribers.set(sessionKey, session.subscribe((next) => setDraftSnapshot(() => next)));
		return session;
	};
	const reactiveDraftSnapshotFor = (rawSessionKey: string): FlowerComposerDraftSnapshot => {
		const sessionKey = trimString(rawSessionKey) || pendingDraftKey();
		draftSessionFor(sessionKey);
		const draftSnapshot = draftSessionSnapshots.get(sessionKey);
		if (!draftSnapshot) throw new Error('Flower composer draft session snapshot is unavailable.');
		return draftSnapshot();
	};
  const currentComposerSessionKey = createMemo(() => trimString(selectedThreadID()) || pendingDraftKey());
  const bottomActionMode = createMemo<'chat' | 'input_request' | 'approval'>(() => {
    if (reactiveDraftSnapshotFor(currentComposerSessionKey()).value.goal_command) return 'chat';
    if (selectedInputRequest()) return 'input_request';
    if (selectedComposerApprovalActions().length > 0) return 'approval';
    return 'chat';
  });
  const [queueTakeBackPending, setQueueTakeBackPending] = createSignal<ReadonlyMap<string, string>>(new Map());
  const composerTakingBackQueuedTurn = () => queueTakeBackPending().has(trimString(selectedThreadID()));
  const takeBackQueuedTurn = async (turn: FlowerQueuedTurn) => {
    const threadID = trimString(selectedThreadID());
    const adapter = props.adapter;
    if (!threadID || !turn.input_fingerprint || !adapter.prepareQueuedTurnDraft || !adapter.takeBackQueuedTurn
      || queueTakeBackPending().has(threadID) || queuedTurnSendBlocked(threadID) || composerSendPreparing()
      || selectedInputRequest() || selectedComposerApprovalDisplayAction()) return;
    setQueueTakeBackPending(previous => new Map(previous).set(threadID, turn.queue_id));
    const epoch = liveTransport.connectionEpoch();
    const draftSession = draftSessionFor(threadID);
    const attachmentController = attachmentControllerFor(threadID);
    let prepared: Awaited<ReturnType<NonNullable<FlowerSurfaceAdapter['prepareQueuedTurnDraft']>>> | undefined;
    const restoreDraft = () => {
      if (!prepared) return;
      const attachments = prepared.attachments.map(staged => ({ local_id: `restored:${staged.attachment_id}`, source: staged.source,
        name: staged.name, mime_type: staged.mime_type, size_bytes: staged.size_bytes, upload_request_id: '', request_id: '', attempt_state: 'staged_ready', staged }));
      attachmentController.hydrateDraft(attachments);
      draftSession.mutate(value => ({ ...value, text: prepared!.prompt, references: flowerQueuedDraftReferences(prepared!), attachments,
        mode: 'ordinary', client_request_id: undefined, prepared_long_text_local_id: undefined, prepared_long_text_attachment_id: undefined,
        page_context_captured: true, omit_embedded_context: true }));
      if (!surfaceDisposed && selectedThreadID() === threadID) {
        composerHistory.reset();
        returnToChat(); focusComposerIfConnected();
        queueMicrotask(() => { if (selectedThreadID() === threadID && composerRef instanceof HTMLTextAreaElement) composerRef.setSelectionRange(composerRef.value.length, composerRef.value.length); });
      }
    };
    try {
      const scope = turn.attachments?.length ? await ensureAttachmentStagingScope(threadID) : undefined;
      prepared = await withFlowerRequestDeadline(() => adapter.prepareQueuedTurnDraft!(threadID, turn.queue_id, { expected_input_fingerprint: turn.input_fingerprint!, ...(scope ? { staging_scope: scope } : {}) }), copy().chat.syncTimeout);
      // Validate all references before removing the canonical message.
      flowerQueuedDraftReferences(prepared);
      if (surfaceDisposed) return;
      const current = await withFlowerRequestDeadline(() => adapter.takeBackQueuedTurn!(threadID, turn.queue_id, turn.input_fingerprint!), copy().chat.syncTimeout);
      if (epoch === liveTransport.connectionEpoch()) applyRuntimeCurrent(current);
      restoreDraft();
    } catch (error) {
      if (prepared && flowerTurnAdmissionFailureKind(error) === 'unknown') {
        restoreDraft();
        notifyThreadActionError(copy().chat.queueTakeBackUnknown);
      } else notifyThreadActionError(flowerTurnAdmissionFailureKind(error) === 'rejected' ? copy().chat.queueTakeBackConflict : getErrorMessage(error));
      try { if (epoch === liveTransport.connectionEpoch()) await requestThreadDetail(threadID, 'background_refresh', true, true); }
      catch (refreshError) { reportThreadDetailDiagnostic(threadID, 'request_or_mapping', 'background_refresh', refreshError); }
    } finally {
      setQueueTakeBackPending(previous => { const next = new Map(previous); next.delete(threadID); return next; });
    }
  };
	const [outboxRetryTick, setOutboxRetryTick] = createSignal(0);
	const visibleTransportOutbox = createMemo(() => {
    outboxRetryTick();
    return transportOutbox().forThread(trimString(selectedThreadID()) || pendingDraftKey());
  });
  const selectedQueueDockRows = createMemo<readonly FlowerQueueDockRow[]>(() => {
    const canonical = selectedQueuedTurns().map(turn => ({ requestKey: trimString(turn.request_key) || trimString(turn.queue_id), canonical: turn }));
    const confirmed = new Set(canonical.map(row => row.requestKey));
    return [...canonical, ...visibleTransportOutbox().filter(entry => !confirmed.has(entry.requestId)
      && (entry.presentation !== 'composer' || entry.delivery === 'failed' || entry.delivery === 'unknown' || entry.terminalError))
      .map(entry => ({ requestKey: entry.requestId, transport: entry }))];
  });
  const selectedComposerPendingSend = createMemo(() => visibleTransportOutbox().find(entry =>
    entry.presentation === 'composer' && !entry.terminalError
    && entry.delivery !== 'accepted' && entry.delivery !== 'failed' && entry.delivery !== 'unknown'));
  const consumeSubmittedComposerDraft = (entry: TransportOutboxEntry, scopeKey: string, restoredTextRevision?: number) => {
    const session = draftSessionFor(scopeKey);
    const snapshot = session.snapshot();
    if (snapshot.value.client_request_id !== entry.requestId && restoredTextRevision === undefined) return;
    const controller = attachmentControllerFor(scopeKey);
    controller.consumeReady(entry.draftAttachments?.map(item => item.local_id) ?? []);
    const consumesText = snapshot.text_revision === (restoredTextRevision ?? entry.draftTextRevision)
      && snapshot.value.text === entry.draftText;
    const consumed = session.mutate(value => ({ ...value,
      text: consumesText ? '' : value.text,
      omit_embedded_context: consumesText ? undefined : value.omit_embedded_context,
      references: value.references.filter(reference => !entry.draftReferences?.some(submitted =>
        submitted.local_id === reference.local_id && retainEqualValue(submitted, reference) === submitted)),
      attachments: flowerComposerDraftAttachments(controller.snapshot().items),
      ...(value.client_request_id === entry.requestId ? { client_request_id: undefined,
        prepared_long_text_local_id: undefined, prepared_long_text_attachment_id: undefined, mode: 'ordinary' as const } : {}),
    }));
    updateComposerSessionDraft(scopeKey, draft => ({ ...draft,
      chatDraft: consumed.snapshot.value.text, references: consumed.snapshot.value.references }));
  };
  const composerSessionDraftFromValue = (value: FlowerComposerDraftValue): FlowerComposerSessionDraft => ({
    chatDraft: value.text,
    references: value.references,
    inputPromptSignature: value.input_prompt_signature ?? '',
    inputDrafts: { ...(value.input_drafts ?? {}) },
    activeInputQuestionID: value.active_input_question_id ?? '',
    modelIDOverride: value.model_id_override,
    permissionTypeOverride: value.permission_type_override,
    reasoningOverride: value.reasoning_selection,
    reasoningModelID: value.reasoning_model_id,
    workingDirDraft: value.working_dir_override,
  });
  const currentComposerSessionDraft = createMemo(() => (
    composerSessionDraftFromValue(reactiveDraftSnapshotFor(currentComposerSessionKey()).value)
  ));
  const newConversationDefaults = () => reactiveDraftSnapshotFor(currentComposerSessionKey()).value.inherited_defaults
    ?? snapshot()?.conversation_preferences;
  const defaultComposerPermissionType = createMemo<FlowerPermissionType>(() => snapshot()?.defaults.permission_type ?? 'approval_required');
  const selectedThreadPermissionType = createMemo<FlowerPermissionType | undefined>(() => {
    const pending = pendingPermissionPatch();
    const threadID = trimString(selectedThreadID());
    if (pending && threadID && pending.threadID === threadID) return pending.requested;
    return selectedThread()?.permission_type;
  });
  const composerPermissionType = createMemo<FlowerPermissionType | undefined>(() => {
    if (selectedThreadID()) return selectedThreadPermissionType();
    return currentComposerSessionDraft().permissionTypeOverride ?? defaultComposerPermissionType();
  });
  const composerPermissionCopy = createMemo(() => {
    const permissionType = composerPermissionType();
    return permissionType ? copy().settings.permissionTypes[permissionType] : undefined;
  });
  const selectedThreadPreferenceEditable = createMemo(() => {
    if (selectedThreadDetailPending()) return false;
    if (selectedThreadReadOnly()) return false;
    if (!selectedThreadID()) return true;
    return visibleTransportOutbox().length === 0 && !selectedThreadHasActiveTurnEvidence()
      && Number(selectedThread()?.queued_turn_count ?? 0) === 0
      && selectedCanonicalQueuedTurns().length === 0
      && selectedApprovalActions().length === 0
      && !selectedInputRequest();
  });
  const permissionPatchPending = createMemo(() => {
    const pending = pendingPermissionPatch();
    if (!pending) return false;
    const threadID = selectedThreadID();
    return threadID ? pending.threadID === threadID : pending.threadID === pendingDraftKey();
  });
  const permissionSelectorTitle = createMemo(() => {
    if (permissionPatchPending()) return copy().chat.permissionSelectorSaving;
    const permissionCopy = composerPermissionCopy();
    return permissionCopy
      ? `${copy().chat.permissionSelectorLabel}: ${permissionCopy.label}`
      : copy().chat.permissionSelectorLabel;
  });
  const updateComposerSessionDraft = (sessionKey: string, updater: (draft: FlowerComposerSessionDraft) => FlowerComposerSessionDraft) => {
    const key = trimString(sessionKey) || pendingDraftKey();
    if (key !== pendingDraftKey() && retiredThreadIDs.has(key)) return;
    draftSessionFor(key).mutate((value) => {
      const previous = composerSessionDraftFromValue(value);
      const next = updater(previous);
      if (sameFlowerComposerSessionDraft(previous, next)) return value;
      return {
        ...value,
        text: next.chatDraft,
        references: next.references,
        input_prompt_signature: next.inputPromptSignature || undefined,
        input_drafts: next.inputDrafts,
        active_input_question_id: next.activeInputQuestionID || undefined,
        model_id_override: next.modelIDOverride,
        permission_type_override: next.permissionTypeOverride,
        reasoning_selection: next.reasoningOverride,
        reasoning_model_id: next.reasoningModelID,
        working_dir_override: next.workingDirDraft,
      };
    });
  };
  const reconcileInputDraft = (threadID: string, request: FlowerInputRequest | null | undefined) => {
    const signature = request ? `${threadID}:${request.prompt_id}` : '';
    updateComposerSessionDraft(threadID, (draft) => ({
      ...draft,
      inputPromptSignature: signature,
      inputDrafts: draft.inputPromptSignature === signature ? draft.inputDrafts : {},
      activeInputQuestionID: request
        ? request.questions.find((question) => question.id === draft.activeInputQuestionID)?.id ?? request.questions[0]?.id ?? ''
        : '',
    }));
  };
  const updateCurrentComposerSessionDraft = (updater: (draft: FlowerComposerSessionDraft) => FlowerComposerSessionDraft) => {
    updateComposerSessionDraft(currentComposerSessionKey(), updater);
  };
  const draftSubmissionActive = (value: FlowerComposerDraftValue): boolean => (
    value.mode === 'preparing_long_text_submission'
  );
  const updateComposerSessionText = (rawSessionKey: string, text: string) => {
    const sessionKey = trimString(rawSessionKey) || pendingDraftKey();
    if (draftSubmissionActive(draftSessionFor(sessionKey).snapshot().value)) return;
    updateComposerSessionDraft(sessionKey, (draft) => (
      draft.chatDraft === text ? draft : { ...draft, chatDraft: text }
    ));
    draftSessionFor(sessionKey).mutate((draft) => (
      draft.text === text ? draft : { ...draft, text }
    ));
  };
  type ComposerAttachmentIntent =
    | Readonly<{ kind: 'add'; files: readonly File[]; source: 'file' | 'paste' | 'drop' }>
    | Readonly<{ kind: 'reselect'; localID: string; file: File }>;
  const attachmentControllerFor = (rawSessionKey: string): FlowerAttachmentController => {
    const sessionKey = trimString(rawSessionKey) || pendingDraftKey();
    const existing = attachmentControllers.get(sessionKey);
    const controller = draftCoordinator.attachmentController(sessionKey, () => createFlowerAttachmentController({
      stagingScope: draftCoordinator.attachmentStagingScope(sessionKey),
      upload: props.adapter.uploadAttachment,
      deleteStaged: props.adapter.deleteStagedAttachment,
      readStagedLongText: props.adapter.readStagedLongText,
    }));
    controller.setTransport({
      get upload() { return props.adapter.uploadAttachment; },
      get deleteStaged() { return props.adapter.deleteStagedAttachment; },
      get readStagedLongText() { return props.adapter.readStagedLongText; },
    });
    if (existing === controller) return controller;
    controller.setSuspended(surfaceReadOnly() || !settingsReady());
    attachmentControllerUnsubscribers.get(sessionKey)?.();
    attachmentControllers.set(sessionKey, controller);
    attachmentControllerUnsubscribers.set(sessionKey, controller.subscribe(() => {
      setAttachmentStateRevision((revision) => revision + 1);
    }));
    return controller;
  };
  const ensureAttachmentStagingScope = async (rawSessionKey: string): Promise<FlowerAttachmentStagingScope> => {
    const sessionKey = trimString(rawSessionKey) || pendingDraftKey();
    if (!props.adapter.createAttachmentStagingScope) {
      return Promise.reject(new Error('Attachment staging is unavailable.'));
    }
    const session = draftSessionFor(sessionKey);
    const targetID = isPendingDraftKey(sessionKey)
      ? session.mutate((value) => value.client_request_id
        ? value
        : { ...value, client_request_id: createFlowerClientRequestID() }).snapshot.value.client_request_id
      : sessionKey;
    if (!targetID) return Promise.reject(new Error('Attachment staging request identity is unavailable.'));
    const scope = await draftCoordinator.ensureAttachmentStagingScope(
      sessionKey,
      () => props.adapter.createAttachmentStagingScope!(targetID),
      (scope) => props.adapter.releaseAttachmentStagingScope?.(scope) ?? Promise.resolve(),
    );
    if (scope.target_id === targetID || isPendingDraftKey(sessionKey)) return scope;
    if (!props.adapter.bindAttachmentStagingScope) throw new Error('Attachment staging binding is unavailable.');
    const bound = await props.adapter.bindAttachmentStagingScope(scope, targetID);
    if (bound.target_id !== targetID) throw new Error('Attachment staging binding returned a different target.');
    draftCoordinator.updateAttachmentStagingScope(sessionKey, scope, bound);
    return bound;
  };
  const releaseAttachmentStagingScope = (rawSessionKey: string) => {
    const sessionKey = trimString(rawSessionKey) || pendingDraftKey();
    draftCoordinator.releaseAttachmentStagingScope(sessionKey);
  };
  const currentAttachmentController = (): FlowerAttachmentController => attachmentControllerFor(currentComposerSessionKey());
  const currentAttachmentSnapshot = createMemo<FlowerAttachmentControllerSnapshot>(() => {
    attachmentStateRevision();
    return currentAttachmentController().snapshot();
  });
  const composerPermissionAvailable = createMemo(() => (
    !selectedThreadDetailPending()
    && !selectedThreadReadOnly()
    && (Boolean(selectedThreadID()) || snapshot() !== null)
    && (!selectedThreadID() || (threadSettingsRevision(selectedThread() ?? undefined) > 0 && selectedThreadPermissionType() !== undefined))
    && (!selectedThreadID() || typeof props.adapter.setThreadPermissionType === 'function')
  ));
  const composerPermissionInteractive = createMemo(() => (
    settingsReady()
    && composerPermissionAvailable()
    && !permissionPatchPending()
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
  const capturePageContext = (sessionKey = currentComposerSessionKey(), mode: 'initial' | 'refresh' = 'initial') => {
    if (selectedThreadID() || props.embeddedConversation || !isPendingDraftKey(sessionKey)) return;
    const session = draftSessionFor(sessionKey);
    if (mode === 'initial' && session.snapshot().value.page_context_captured) return;
    const snapshot = props.captureNewConversationContext?.();
    session.mutate(value => ({
      ...value,
      page_context_captured: true,
      references: [...(snapshot ? [{
        ...snapshot, kind: 'page_context' as const, local_id: secureRandomUUID(),
      }] : []), ...value.references.filter(reference => reference.kind !== 'page_context')],
    }));
  };
  const requestCompanionOpen = (threadID?: string) => {
    setSidePanel('chat');
    if (!threadID) capturePageContext(currentComposerSessionKey(), 'refresh');
    props.onCompanionOpenRequest?.(threadID);
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
    if (intent.kind === 'add' && intent.files.length > 0) capturePageContext(sessionKey);
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
      notifyComposerError(attachmentCopy().errorUploadFailed);
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
        && draft.modelIDOverride === sharedDraft.model_id_override
        && draft.permissionTypeOverride === sharedDraft.permission_type_override
        && draft.reasoningModelID === sharedDraft.reasoning_model_id
        && sameFlowerReasoningSelection(draft.reasoningOverride, sharedDraft.reasoning_selection)
        && draft.workingDirDraft === sharedDraft.working_dir_override
        ? draft
        : {
          ...draft,
          chatDraft: sharedText,
          references: sharedDraft.references,
          modelIDOverride: sharedDraft.model_id_override,
          reasoningModelID: sharedDraft.reasoning_model_id,
          permissionTypeOverride: sharedDraft.permission_type_override,
          reasoningOverride: sharedDraft.reasoning_selection,
          workingDirDraft: sharedDraft.working_dir_override,
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
      ...(item.admitted ? { admitted: item.admitted } : {}),
    }));
    const currentHydratedAttachments = attachmentController.snapshot().items.map((item) => ({
      local_id: item.local_id,
      request_id: item.request_id,
      source: item.source,
      name: item.name,
      mime_type: item.mime_type,
      size_bytes: item.size_bytes,
      ...(item.staged ? { staged: item.staged } : {}),
      ...(item.admitted ? { admitted: item.admitted } : {}),
    }));
    if (JSON.stringify(currentHydratedAttachments) !== JSON.stringify(hydratedAttachments)) {
      attachmentController.hydrateDraft(hydratedAttachments);
    }
    hydratedDraftSessionRevisions.set(sessionKey, sharedSnapshot.revision);
  });

  // Freeze inherited defaults once editing starts; hydration/projection is not
  // a selection event and must never write personal preferences.
  createEffect(() => {
    if (selectedThreadID() || !snapshot()) return;
    const sessionKey = currentComposerSessionKey();
    const value = reactiveDraftSnapshotFor(sessionKey).value;
    if (value.inherited_defaults || draftSubmissionActive(value)
      || !(value.text || value.references.length || value.attachments.length)) return;
    const modelID = selectedComposerModelID();
    const reasoning = composerReasoningSelection();
    const defaults = {
      model_id: modelID, working_dir: displayedWorkingDirectory(),
      reasoning_by_model: { ...newConversationDefaults()?.reasoning_by_model,
        ...(reasoning ? { [modelID]: reasoning } : {}) },
    };
    draftSessionFor(sessionKey).mutate(current => current.inherited_defaults ? current
      : { ...current, inherited_defaults: defaults });
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
    const projectedPermissionTypeOverride = currentComposerSessionDraft().permissionTypeOverride;
    const projectedWorkingDir = displayedWorkingDirectory();
    const projectedCapabilityRevision = currentAttachmentSnapshot().capability?.revision;
    const unchanged = shared.value.mode === mode
      && shared.value.model_id === projectedModelID
      && shared.value.permission_type_override === projectedPermissionTypeOverride
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
      permission_type_override: projectedPermissionTypeOverride,
      working_dir: projectedWorkingDir,
      capability_revision: projectedCapabilityRevision,
    }));
  });

  onCleanup(() => {
    surfaceDisposed = true;
    for (const controller of attachmentControllers.values()) controller.setSuspended(true);
    releaseNavigationReads();
    detailLoader.dispose();
    referenceReadController?.abort();
    subagentDetailReadController?.abort();
    composerAutosizeController?.dispose();
    composerAutosizeController = undefined;
    for (const unsubscribe of attachmentControllerUnsubscribers.values()) unsubscribe();
    for (const unsubscribe of draftSessionUnsubscribers.values()) unsubscribe();
    for (const session of draftSessions.values()) {
      const snapshot = session.snapshot();
      if (
        snapshot.value.mode === 'preparing_long_text_submission'
      ) {
        session.mutate((value) => ({
          ...value,
          mode: (inspectFlowerText(value.text)?.codePoints ?? 0) > FLOWER_INLINE_TEXT_CODE_POINT_LIMIT
            ? 'over_limit_editing'
            : 'ordinary',
          client_request_id: undefined,
        }));
      }
    }
  });
	const selectedThreadDetailMatches = (threadID: string): boolean => {
		const tid = trimString(threadID);
		return Boolean(tid && selectedThreadID() === tid && threadCache().views.has(tid));
	};
	const composerSessionStillCurrent = (sessionKey: string): boolean => {
		const key = trimString(sessionKey) || pendingDraftKey();
		if (key === pendingDraftKey()) return !selectedThreadID();
    return key === currentComposerSessionKey() && selectedThreadDetailMatches(trimString(selectedThreadID()));
  };
  const warmupState = createMemo(() => props.warmup?.active ? props.warmup : null);
  // The first applied list page (including an empty list) admits the surface
  // once. Embedded conversations retain their own detail loading boundary.
  // Refresh and reconnect never replace an admitted surface.
  const initialConversationPending = createMemo<boolean>(pending => (
    pending && !props.embeddedConversation && threadListState() !== 'ready'
  ), true);
  const initialConversationFailed = () => props.adapter.connectLiveStream
    ? liveSyncState().status === 'failed'
    : threadListState() === 'error';
  const surfaceWarmupActive = createMemo(() => warmupState() !== null || initialConversationPending());
  createEffect(() => {
    const ordinaryComposerBlocked = Boolean(selectedInputRequest())
      || Boolean(selectedComposerApprovalDisplayAction())
      || selectedThreadReadOnly()
      || surfaceWarmupActive();
    if (longTextPreparing() && ordinaryComposerBlocked) cancelActiveLongTextSubmission?.();
  });
  const workingDirectoryPickerAvailable = createMemo(() => (
    typeof props.adapter.getWorkingDirectoryPathContext === 'function'
    && typeof props.adapter.listWorkingDirectoryEntries === 'function'
  ));
  const recentWorkingDirectories = createMemo(() => {
    if (!workingDirectoryPickerOpen()) return [];
    const recent = threads()
      .filter((thread) => !thread.parent_thread_id)
      .sort((left, right) => right.updated_at_ms - left.updated_at_ms || right.created_at_ms - left.created_at_ms);
    return [...new Set(recent.map((thread) => normalizeAbsolutePath(thread.working_dir)).filter(Boolean))].slice(0, 10);
  });
  let filesystemRevision = 0;
  const filesystemScopeKey = createMemo(() => {
    void props.adapter;
    void props.filesystemScopeKey;
    return String(++filesystemRevision);
  });
  // Default display is independent of the picker. Resources discard responses from old scopes.
  const [workingDirectoryDefaults] = createResource(
    () => ({ adapter: props.adapter, scope: filesystemScopeKey() }),
    async ({ adapter, scope }) => {
      try { return { scope, context: await adapter.getWorkingDirectoryPathContext?.() }; }
      catch (error) { return { scope, error }; }
    },
  );
  const defaultWorkingDirectory = createMemo(() => {
    const result = workingDirectoryDefaults();
    const context = result?.scope === filesystemScopeKey() ? result.context : undefined;
    return context?.roots?.find((root) => root.id === context.defaultRootId)?.pathAbs ?? '';
  });
  const selectedThreadWorkingDirectory = createMemo(() => normalizeAbsolutePath(selectedThread()?.working_dir ?? ''));
  const createThreadMedia = (thread: Accessor<FlowerThreadSnapshot | null | undefined>) => {
    const threadID = createMemo(() => thread()?.thread_id ?? '');
    const workingDirectory = createMemo(() => normalizeAbsolutePath(thread()?.working_dir ?? ''));
    const valid = createMemo(() => {
      const owner = threadID();
      const parent = thread()?.parent_thread_id;
      if (!owner) return false;
      if (owner === selectedThreadID()) return true;
      if (!parent) return false;
      const active = activeSubagentDetail();
      return parent === selectedThreadID() && active?.parentThreadID === parent && active.childThreadID === owner;
    });
    return createMemo(() => {
      filesystemScopeKey();
      const adapter = props.adapter;
      const owner = threadID();
      const directory = workingDirectory();
      const available = valid();
      const assertCurrent = (signal: AbortSignal) => {
        signal.throwIfAborted();
        if (!available || owner !== threadID() || !valid()) throw new DOMException('Conversation changed', 'AbortError');
      };
      const resolve: NonNullable<MarkdownMediaProps['resolve']> = (source, signal) => {
        assertCurrent(signal);
        return resolveFlowerMarkdownMedia(source, signal, {
          adapter, threadID: owner, workingDirectory: directory, get copy() { return copy().chat.media; },
          onActionError: error => notifyThreadActionError(getErrorMessage(error)),
        });
      };
      const openLink: NonNullable<MarkdownMediaProps['onOpenLink']> = (source, href, signal) => {
        assertCurrent(signal);
        return openHtmlPreviewLink(href, htmlPreviewSourceDirectory(source, directory), signal, {
          adapter, get copy() { return copy().chat.media; },
        });
      };
      return { resolve, openLink };
    });
  };
  const draftWorkingDirectory = createMemo(() => normalizeAbsolutePath(currentComposerSessionDraft().workingDirDraft ?? ''));
  const displayedWorkingDirectory = createMemo(() => {
    if (selectedThreadDetailPending()) return '';
    if (selectedThreadID()) return selectedThreadWorkingDirectory();
    const draftPath = draftWorkingDirectory();
    if (draftPath) return draftPath;
    return normalizeAbsolutePath(newConversationDefaults()?.working_dir ?? '') || defaultWorkingDirectory();
  });
  const displayedWorkingDirectoryLabel = createMemo(() => (
    basenameFromAbsolutePath(displayedWorkingDirectory(), copy().threadList.workingDirectoryLabel)
  ));
  const canPickWorkingDirectory = createMemo(() => (
    settingsReady()
    && !surfaceReadOnly()
    && !selectedThreadID()
    && workingDirectoryPickerAvailable()
    && !surfaceWarmupActive()
  ));
  const workingDirectoryPickerTitle = createMemo(() => (
    `${copy().chat.workingDirPickerTitle}: ${displayedWorkingDirectory() || copy().threadList.workingDirectoryLabel}`
  ));
  const openWorkingDirectoryPicker = () => {
    if (canPickWorkingDirectory()) setWorkingDirectoryPickerOpen(true);
  };
  createEffect(() => {
    if (!canPickWorkingDirectory() || props.engaged === false) setWorkingDirectoryPickerOpen(false);
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
    setModelQuery(''); setModelMenuExpanded(false);
    setModelMenuOpen(true);
    queueMicrotask(() => modelSearchRef?.focus());
  };
  const modelErrorMessage = (error: unknown) => (
    error && typeof error === 'object' && 'code' in error && error.code === 'thread_image_model_unsupported'
      ? copy().settings.imageModelRequired
      : (error instanceof FlowerRequestDeadlineError ? copy().settings.dialog.catalog.settingsSaveTimedOut : error instanceof FlowerReadDeadlineError ? copy().chat.syncTimeout : getErrorMessage(error)) || copy().settings.autoSave.saveFailed
  );
  const handleModelTriggerKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openModelMenu();
    }
  };
  const handleModelMenuKeyDown = (event: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target === modelSearchRef && (event.key === 'Home' || event.key === 'End')) return;
    const items = [...(modelMenuRef?.querySelectorAll<HTMLButtonElement>('.flower-model-menu-item:not(:disabled)') ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (current + 1) % items.length : current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    items[index]?.focus();
  };
  const openPermissionMenu = () => {
    if (!composerPermissionInteractive()) return;
    const permissionType = composerPermissionType();
    if (!permissionType) return;
    if (composerOverflowControlIDs().includes('permission')) setComposerMoreOpen(true);
    setPermissionMenuIndexForType(permissionType);
    setPermissionMenuOpen(true);
    queueMicrotask(() => focusPermissionMenuItem(permissionMenuActiveIndex()));
  };
  createEffect(() => {
    const suspended = surfaceReadOnly() || !settingsReady();
    for (const controller of attachmentControllers.values()) controller.setSuspended(suspended);
  });
  const preferenceAdapterCurrent = (adapter: FlowerSurfaceAdapter) => !surfaceDisposed && props.adapter === adapter;
  const acceptSettingsSnapshot = (adapter: FlowerSurfaceAdapter, next: FlowerSettingsSnapshot) => {
    if (!preferenceAdapterCurrent(adapter)) return;
    setSnapshot(current => (current?.conversation_preferences?.revision ?? -1) > (next.conversation_preferences?.revision ?? -1)
      ? { ...next, conversation_preferences: current!.conversation_preferences } : next);
  };
  const acceptConversationPreferences = (adapter: FlowerSurfaceAdapter, preferences: FlowerConversationPreferences) => {
    if (!preferenceAdapterCurrent(adapter)) return;
    setSnapshot(current => current && (current.conversation_preferences?.revision ?? -1) <= preferences.revision
      ? { ...current, conversation_preferences: preferences }
      : current);
  };
  const rememberConversationPreference = async (adapter: FlowerSurfaceAdapter, patch: FlowerConversationPreferencePatch) => {
    if (!adapter.saveConversationPreferences) return;
    const generation = settingsRefreshGeneration;
    const revision = props.settingsRevision?.();
    if (revision !== undefined) localPreferenceRefreshesPending += 1;
    try {
      const preferences = await adapter.saveConversationPreferences(patch);
      if (generation === settingsRefreshGeneration) acceptConversationPreferences(adapter, preferences);
      return preferences;
    } finally {
      // Adapters notify before resolving. If no revision changed, this save
      // does not need to reserve a future external refresh.
      if (revision !== undefined && props.settingsRevision?.() === revision) {
        localPreferenceRefreshesPending = Math.max(0, localPreferenceRefreshesPending - 1);
      }
    }
  };
  const updateComposerModelID = async (modelID: string) => {
    const mid = trimString(modelID);
    const option = modelSelectOptions().find((item) => item.id === mid);
    if (!mid || !option || !composerModelInteractive()) return;
    const adapter = props.adapter;
    const threadID = trimString(selectedThreadID());
    const sessionKey = currentComposerSessionKey();
    const previous = selectedComposerModelID();
    setPendingModelPatch({ threadID: threadID || sessionKey, requested: mid, previous });
    try {
      if (threadID) {
        if (!adapter.setThreadModel) return;
        if (previous !== mid) {
          const requestEpoch = liveTransport.connectionEpoch();
          const live = await adapter.setThreadModel(threadID, mid);
          if (preferenceAdapterCurrent(adapter)) {
            const updated = receiveThreadView(live, 'user_action', requestEpoch).thread;
            if (selectedThreadDetailMatches(threadID)) setSelectedThreadWithDetail(updated.thread_id);
          }
        }
      } else {
        updateComposerSessionDraft(sessionKey, draft => ({ ...draft,
          modelIDOverride: mid,
          reasoningOverride: draft.reasoningModelID === mid ? draft.reasoningOverride : undefined,
          reasoningModelID: draft.reasoningModelID === mid ? mid : undefined,
        }));
      }
      // Same-value selection is still an explicit request to remember this field.
      try {
        if (adapter.saveConversationPreferences) {
          await rememberConversationPreference(adapter, { model_id: mid });
        } else if (option.source === 'model_profile' || option.source === 'platform') {
          const next = await adapter.persistDefaultModel(mid);
          if (preferenceAdapterCurrent(adapter)) {
            acceptSettingsSnapshot(adapter, next);
            if (next.model_directory) setModelDirectory(next.model_directory);
          }
        }
      } catch (error) {
        if (preferenceAdapterCurrent(adapter)) {
          notifyFutureDefaultModelError(modelErrorMessage(error));
        }
      }
    } catch (error) {
      if (preferenceAdapterCurrent(adapter) && selectedThreadDetailMatches(threadID)) {
        notifyModelError(modelErrorMessage(error));
      }
    } finally {
      setPendingModelPatch(current => current?.threadID === (threadID || sessionKey) && current.requested === mid ? null : current);
    }
  };
  const updateComposerReasoningSelection = async (selection: FlowerReasoningSelection | undefined) => {
    const normalized = serializeFlowerReasoningSelection(selection) ?? { level: 'default' as const };
    const threadID = trimString(selectedThreadID());
    const modelID = selectedComposerModelID();
    if (!modelID || !composerReasoningInteractive()) return;
    const adapter = props.adapter;
    if (!threadID) {
      updateCurrentComposerSessionDraft(draft => ({ ...draft, reasoningOverride: normalized, reasoningModelID: modelID }));
      try {
        await rememberConversationPreference(adapter, { reasoning: { model_id: modelID, selection: normalized } });
      } catch (error) {
        if (preferenceAdapterCurrent(adapter)) notifyConversationPreferenceError(modelErrorMessage(error));
      }
      return;
    }
    if (!adapter.setThreadReasoningSelection) return;
    const previous = normalizeFlowerReasoningSelection(selectedThreadSettings()?.reasoning_selection);
    setPendingReasoningThreadIDs(current => new Set(current).add(threadID));
    try {
      if (!sameFlowerReasoningSelection(previous, normalized)) {
        const requestEpoch = liveTransport.connectionEpoch();
        const live = await adapter.setThreadReasoningSelection(threadID, normalized);
        if (preferenceAdapterCurrent(adapter)) {
          const updated = receiveThreadView(live, 'user_action', requestEpoch).thread;
          if (selectedThreadDetailMatches(threadID)) setSelectedThreadWithDetail(updated.thread_id);
        }
      }
      updateComposerSessionDraft(threadID, draft => ({ ...draft, reasoningOverride: undefined, reasoningModelID: undefined }));
      try {
        await rememberConversationPreference(adapter, { reasoning: { model_id: modelID, selection: normalized } });
      } catch (error) {
        if (preferenceAdapterCurrent(adapter)) notifyConversationPreferenceError(modelErrorMessage(error));
      }
    } catch (error) {
      if (preferenceAdapterCurrent(adapter) && selectedThreadDetailMatches(threadID)) {
        notifyComposerError(modelErrorMessage(error));
      }
    } finally {
      setPendingReasoningThreadIDs(current => {
        const next = new Set(current);
        next.delete(threadID);
        return next;
      });
    }
  };
  const updateComposerPermissionType = async (permissionType: FlowerPermissionType) => {
    const threadID = trimString(selectedThreadID());
    closePermissionMenu(true);
    if (!threadID) {
      const nextOverride = permissionType === defaultComposerPermissionType()
        ? undefined
        : permissionType;
      updateCurrentComposerSessionDraft((draft) => (
        draft.permissionTypeOverride === nextOverride
          ? draft
          : { ...draft, permissionTypeOverride: nextOverride }
      ));
      return;
    }
    if (!props.adapter.setThreadPermissionType || !composerPermissionInteractive()) return;
    const previous = selectedThreadPermissionType();
    if (!previous) return;
    if (previous === permissionType) return;
    setPendingPermissionPatch({ threadID, requested: permissionType, previous });
    try {
      const requestEpoch = liveTransport.connectionEpoch();
      const live = await props.adapter.setThreadPermissionType(threadID, permissionType);
      const updated = receiveThreadView(live, 'user_action', requestEpoch).thread;
      if (selectedThreadDetailMatches(threadID)) {
        setSelectedThreadWithDetail(updated.thread_id);
      }
    } catch (error) {
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
    if (!composerPermissionInteractive()) return;
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
  const requestComposerFocus = (
    owner = typeof document === 'undefined' ? null : document.activeElement,
    restoreCompanion = false,
  ) => {
    setComposerFocusRequest({ token: ++composerFocusToken, owner, identity: bottomActionFocusIdentity(), restoreCompanion });
  };
  const scheduleComposerFocus = (request: ComposerFocusRequest) => {
    queueMicrotask(() => {
      if (pendingThreadSelection() || request.token !== composerFocusToken || request.identity !== bottomActionFocusIdentity()) return;
      const active = document.activeElement;
      if (active !== document.body && active !== request.owner && active !== composerRef) return;
      if (!surfaceRef?.isConnected || surfaceRef.closest('[inert]')) return;
      if (request.restoreCompanion ? !companionCollapsed() : companionCollapsed() || !surfaceEngaged()) return;
      // Reading-area focus is an explicit navigation intent, not an edit request.
      if (!request.restoreCompanion && request.owner === surfaceRef) return;
      const entry = companionEntry();
      const target = request.restoreCompanion
        ? entry.kind === 'editor' ? composerRef : entry.kind === 'status' ? companionSummaryRef : companionActionRef
        : bottomActionEditTarget();
      if (!target?.isConnected || target.closest('[inert]') || target.matches(':disabled')) return;
      restoringCompanionFocus = request.restoreCompanion;
      try { target.focus({ preventScroll: true }); }
      finally { restoringCompanionFocus = false; }
    });
  };
  onCleanup(() => {
    composerFocusToken += 1;
    companionActivationToken += 1;
  });
  onMount(() => {
    const cancelFocusHandoff = (event: FocusEvent) => {
      if (!(event.target instanceof Node) || surfaceRef?.contains(event.target)) return;
      composerFocusToken += 1;
      companionActivationToken += 1;
      setComposerFocusRequest(null);
    };
    document.addEventListener('focusin', cancelFocusHandoff);
    onCleanup(() => document.removeEventListener('focusin', cancelFocusHandoff));
  });
  const warmupCanReplaceTranscript = createMemo(() => (
    surfaceWarmupActive()
    && !selectedThreadID()
    && !selectedThreadHasContent()
    && !selectedThreadLoading()
  ));
  const warmupTitle = createMemo(() => trimString(warmupState()?.title) || copy().chat.warmupTitle);
  const warmupDetail = createMemo(() => trimString(warmupState()?.detail) || copy().chat.warmupDetail);
  const warmupPhaseLabel = createMemo(() => trimString(warmupState()?.phaseLabel) || copy().chat.loadingSettings);
  const warmupModelLabel = createMemo(() => trimString(warmupState()?.modelLabel) || copy().chat.warmupModelLabel);

  const presentRunError = (
    error: FlowerThreadSnapshot['error'],
    includeUnmappedMessage = true,
  ): string => {
    const code = trimString(error?.code);
    // The backend owns message selection and redaction. Provider prose is
    // literal text; it is never rendered as Markdown or executable markup.
    if (code.startsWith('provider_') || code.startsWith('chatgpt_')) {
      try {
        const diagnostic = JSON.parse(trimString(error?.detail)) as { message?: unknown };
        if (typeof diagnostic.message === 'string' && diagnostic.message.trim()
          && diagnostic.message !== '[redacted]'
          && !/^(provider returned error|provider error|request failed|internal server error)$/i.test(diagnostic.message.trim())) {
          return diagnostic.message.trim();
        }
      } catch { /* Historical failures may have no structured details. */ }
    }
    switch (code) {
      case 'chatgpt_review_required': return copy().settings.dialog.chatGPT.reviewRequired;
      case 'chatgpt_temporarily_unavailable': return copy().settings.dialog.chatGPT.temporarilyUnavailable;
      case 'chatgpt_storage_unavailable': return copy().settings.dialog.chatGPT.storageUnavailable;
      case 'chatgpt_usage_unavailable': return copy().settings.dialog.chatGPT.usageUnavailable;
      case 'chatgpt_authorization_required': return copy().settings.dialog.chatGPT.authorizationRequired;
      case 'chatgpt_plan_permission_required': return copy().settings.dialog.chatGPT.planPermission;
      case 'provider_auth_failed':
        return copy().chat.runErrors.providerAuthFailed;
      case 'provider_missing_key':
        return copy().chat.runErrors.providerMissingKey;
      case 'provider_rate_limited':
        return copy().chat.runErrors.providerRateLimited;
      case 'provider_upstream_rate_limited':
        return copy().chat.runErrors.providerUpstreamRateLimited;
      case 'provider_server_error':
        return copy().chat.runErrors.providerServerError;
      case 'provider_unreachable':
        return copy().chat.runErrors.providerUnreachable;
      case 'provider_request_timeout':
        return copy().chat.runErrors.providerRequestTimeout;
      case 'provider_stream_interrupted':
        return copy().chat.runErrors.providerStreamInterrupted;
      case 'provider_request_invalid': return copy().chat.runErrors.providerRequestInvalid;
      case 'provider_request_failed': return copy().chat.runErrors.providerRequestFailed;
      case 'provider_request_rejected': return copy().chat.runErrors.providerRequestRejected;
      case 'provider_model_unavailable':
        return copy().chat.runErrors.providerModelUnavailable;
      case 'model_gateway_contract_failed':
        return copy().chat.runErrors.modelGatewayContractFailed;
      case 'model_context_unavailable': return copy().chat.runErrors.modelContextUnavailable;
      case 'context_budget_invalid':
        return copy().chat.runErrors.contextBudgetInvalid;
      case 'context_fixed_overhead':
        return copy().chat.runErrors.contextFixedOverhead;
      case 'context_compaction_limit':
        return copy().chat.runErrors.contextCompactionLimit;
      case 'floret_repeated_tool_calls': return copy().chat.runErrors.repeatedToolCalls;
      case 'floret_no_progress': return copy().chat.runErrors.noProgress;
      case 'floret_duplicate_tool_call_id': return copy().chat.runErrors.duplicateToolCallID;
      case 'floret_stop_hook_loop': return copy().chat.runErrors.stopHookLoop;
      case 'floret_tool_argument_correction_exhausted': return copy().chat.runErrors.toolArgumentCorrectionExhausted;
      case 'floret_tool_dispatch_failed': return copy().chat.runErrors.toolDispatchFailed;
      case 'floret_storage_failed': return copy().chat.runErrors.storageFailed;
      case 'floret_authorization_failed': return copy().chat.runErrors.authorizationFailed;
      case 'floret_engine_failed':
        return copy().chat.runErrors.floretEngineFailed;
      case 'floret_control_contract_failed':
        return copy().chat.runErrors.floretControlContractFailed;
      case 'floret_authority_consistency_failed':
        return copy().chat.runErrors.floretAuthorityConsistencyFailed;
      case 'floret_effect_outcome_unknown':
        return copy().chat.runErrors.floretEffectOutcomeUnknown;
      case 'runtime_restarted':
        return copy().chat.runErrors.runtimeRestarted;
      default:
        return includeUnmappedMessage ? trimString(error?.message) : '';
    }
  };
  const threadItemCache = new Map<string, { item: ReturnType<typeof projectFlowerThreadListItem>; sig: string }>();
  type ThreadDetailSource =
    | 'initial_load'
    | 'goal_popup'
    | 'user_action'
    | 'background_refresh'
    | 'summary_update'
    | 'live_current';
  type ThreadDetailReceiveResult = Readonly<{
    state: ThreadViewAcceptance;
    runtimeState: ThreadViewAcceptance;
    activityState: ThreadViewAcceptance;
    settingsState: ThreadViewAcceptance;
    thread: FlowerThreadSnapshot;
  }>;
  const threadWithLocalReadVisibility = (thread: FlowerThreadSnapshot): FlowerThreadSnapshot => {
    const unread = flowerThreadActivityRevision(thread.read_status.snapshot) > Math.max(
      thread.read_status.read_state.last_seen_activity_revision, readSync.presentedRevision(thread.thread_id));
    return thread.read_status.is_unread === unread ? thread
      : { ...thread, read_status: { ...thread.read_status, is_unread: unread } };
  };
  const applyThreadReadStatus = (threadID: string, readStatus: FlowerThreadReadStatus) => {
    if (retiredThreadIDs.has(threadID)) return;
    setThreadCache(cache => cache.applyReadStatus(threadID, readStatus));
    readSync.confirm(threadID, readStatus);
  };
  const readSync = createThreadReadSync({
    send: (threadID, revision) => props.adapter.markThreadRead(threadID, { activity_revision: revision }),
    apply: applyThreadReadStatus,
    changed: () => setLocalReadVisibilityRevision(revision => revision + 1),
  });
  const [readSyncOnline, setReadSyncOnline] = createSignal(typeof navigator === 'undefined' || navigator.onLine !== false);
  onMount(() => {
    const online = () => { setReadSyncOnline(true); readSync.setAvailable(true, true); };
    const offline = () => { setReadSyncOnline(false); readSync.setAvailable(false); };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    onCleanup(() => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); });
  });
  let readSyncRuntimeID = props.adapter.runtime.runtime_id;
  createEffect(() => {
    const runtimeID = props.adapter.runtime.runtime_id;
    if (runtimeID !== readSyncRuntimeID) { readSync.reset(); readSyncRuntimeID = runtimeID; }
    readSync.setAvailable(readSyncOnline());
  });
  const threadItemSignature = (t: FlowerThreadSnapshot): string => {
    const visibleThread = threadWithLocalReadVisibility(t);
    const stableLiveSidebar = SIDEBAR_STABLE_LIVE_STATUSES.has(t.status);
    return [
      t.thread_id,
      t.status,
      JSON.stringify(t.cancellation ?? null),
		flowerThreadDisplayTitle(t, copy().threadList.untitled),
      String(Number(t.pinned_at_ms ?? 0) > 0),
      String(Number(t.pinned_at_ms ?? 0)),
      String(t.pin_rank ?? 0),
      String(t.created_at_ms),
      t.source_label ?? '',
      t.model_id ?? '',
      t.target_labels?.join('\x1e') ?? '',
      t.working_dir ?? '',
      t.read_only_reason ?? '',
      stableLiveSidebar ? 'live' : String(visibleThread.read_status.is_unread),
      stableLiveSidebar ? 'live' : String(flowerThreadActivityRevision(t.read_status.snapshot)),
    ].join('\x1f');
  };
  const sidebarItemSignature = (t: FlowerThreadListItem): string => [
    t.thread_id,
    t.status,
    JSON.stringify(t.cancellation ?? null),
    t.title,
    String(t.pinned),
    String(t.pinned_at_ms ?? 0),
    String(t.pin_rank ?? 0),
    String(t.created_at_ms),
    t.source_label,
    t.model_id,
    t.target_labels.join('\x1e'),
    t.working_dir,
    t.read_only_reason ?? '',
    SIDEBAR_STABLE_LIVE_STATUSES.has(t.status) ? 'live' : String(t.read_status.is_unread),
    SIDEBAR_STABLE_LIVE_STATUSES.has(t.status) ? 'live' : String(flowerThreadActivityRevision(t.read_status.snapshot)),
  ].join('\x1f');
  const threadItems = createMemo(() => {
    localReadVisibilityRevision();
		return projectThreadPins(threads()).map((t) => {
      const visibleThread = threadWithLocalReadVisibility(t);
      const sig = threadItemSignature(visibleThread);
      const cached = threadItemCache.get(t.thread_id);
      if (cached && cached.sig === sig) {
			return cached.item;
      }
      const item = projectFlowerThreadListItem(visibleThread, copy().threadList.untitled);
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
  const [retryNow, setRetryNow] = createSignal(Date.now());
  const companionThreadItems = createMemo<readonly FlowerCompanionThreadListItem[]>(() => {
    if (!props.onPresenceChange && !threadSwitcherOpen()) return [];
    localReadVisibilityRevision();
    companionRunRevision();
    const cache = threadCache();
    return projectThreadPins(threads()).map((summary) => {
      const visibleSummary = threadWithLocalReadVisibility(summary);
      const item = projectFlowerThreadListItem(visibleSummary, copy().threadList.untitled);
      const detail = cache.views.get(summary.thread_id)?.thread;
      const activeRunID = trimString(summary.active_run_id);
      const matchingActiveDetail = detail?.status === 'running'
        && trimString(detail.active_run_id) === activeRunID
        ? detail
        : undefined;
      const matchingFailedDetail = summary.status === 'failed' && detail?.status === 'failed'
        ? detail
        : undefined;
      const liveTail = matchingActiveDetail
        ? projectFlowerCompanionLiveTail(matchingActiveDetail, liveProgressLabel)
        : null;
      const runGeneration = activeRunID
        ? companionRunTracker.generationFor(summary.thread_id, activeRunID)
        : undefined;
      const errorText = matchingFailedDetail ? presentRunError(matchingFailedDetail.error, false) : '';
      return {
        ...item,
        queued_turn_count: summary.queued_turn_count ?? summary.queued_turns?.length ?? 0,
        ...(activeRunID ? { active_run_id: activeRunID } : {}),
        ...(runGeneration !== undefined ? { run_generation: runGeneration } : {}),
        ...(liveTail ? {
          progress_text: liveTail.text,
          progress_kind: liveTail.kind,
          progress_identity: liveTail.identity,
        } : {}),
        ...(errorText ? { error_text: errorText } : {}),
      };
    });
  });
  let lastCompanionPresenceSignature = '';
  createEffect(() => {
    if (!props.onPresenceChange) return;
    const presence = projectFlowerCompanionPresence(
      companionThreadItems(),
      true,
      companionRunReceipt(),
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
    // Measure in the menu's local coordinates so projected Workbench scale stays owned by Floe.
    const measureMenu = () => {
      const menu = permissionMenuRef;
      if (!menu || !surfaceRef) return;
      const bounds = menu.getBoundingClientRect();
      const scale = menu.offsetWidth > 0 ? bounds.width / menu.offsetWidth : 1;
      const surface = surfaceRef.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = Math.max(surface.top, viewport?.offsetTop ?? 0);
      const left = Math.max(surface.left, viewport?.offsetLeft ?? 0) + 8;
      const right = Math.min(surface.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth)) - 8;
      const priorShift = Number.parseFloat(menu.style.getPropertyValue('--flower-permission-menu-shift-x')) || 0;
      const originalLeft = bounds.left - priorShift * scale;
      const shift = Math.max(left, Math.min(originalLeft, right - bounds.width)) - originalLeft;
      menu.style.setProperty('--flower-permission-menu-shift-x', `${shift / (scale || 1)}px`);
      menu.style.setProperty('--flower-permission-menu-available-height', `${Math.max(0, (bounds.bottom - top) / (scale || 1) - 8)}px`);
    };
    const observer = new ResizeObserver(measureMenu);
    if (surfaceRef) observer.observe(surfaceRef);
    if (permissionTriggerRef) observer.observe(permissionTriggerRef);
    const frame = requestAnimationFrame(measureMenu);
    window.addEventListener('resize', measureMenu);
    window.visualViewport?.addEventListener('resize', measureMenu);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', measureMenu);
      window.visualViewport?.removeEventListener('resize', measureMenu);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    });
  });

  createEffect(() => {
    if (!permissionMenuOpen()) return;
    if (!composerPermissionInteractive()) {
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
      event.preventDefault();
      event.stopImmediatePropagation();
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
  const [modelDirectory, setModelDirectory] = createSignal<FlowerModelDirectory | null>(null);
  const currentModelID = createMemo(() => trimString(modelDirectory()?.current_model_id) || trimString(snapshot()?.model_profile?.current_model_id));
  const selectedComposerModelID = createMemo(() => {
    const pending = pendingModelPatch();
    const threadID = trimString(selectedThreadID());
    if (pending && threadID && pending.threadID === threadID) return pending.requested;
    const thread = selectedThreadSettings();
    const threadModelID = thread?.thread_id === trimString(selectedThreadID())
      ? trimString(thread.model_id)
      : '';
    if (threadID) return threadModelID;
    return trimString(currentComposerSessionDraft().modelIDOverride)
      || trimString(newConversationDefaults()?.model_id)
      || currentModelID();
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
      if (capability.model_id === modelID) controller.setCapability(capability);
      else controller.markCapabilityUnavailable();
    }).catch(() => {
      if (sequence === attachmentCapabilitySequence && currentComposerSessionKey() === sessionKey) {
        controller.markCapabilityUnavailable();
      }
    });
  });
  type ComposerModelOption = Readonly<{
    billingSource?: 'chatgpt_plan';
    id: string;
    label: string;
    name?: string;
    group: string;
    aliasKey?: string;
    quantization?: string;
    aliases?: readonly string[];
    source: 'model_profile' | 'desktop_model_source' | 'platform' | 'thread_snapshot';
    disabled?: boolean;
    providerType?: FlowerProviderType;
    supportsImageInput: boolean;
    webSearch?: import('./contracts/flowerSurfaceContracts').FlowerWebSearchAvailability;
    contextWindow?: number;
    maxOutputTokens?: number;
    reasoningCapability?: FlowerReasoningCapability;
    defaultReasoningSelection?: FlowerReasoningSelection;
    pending?: boolean;
    unavailableReason?: string;
  }>;
  const catalogModelOptions = createMemo<readonly ComposerModelOption[]>(() => (modelDirectory()?.models ?? []).map(model => ({
    id: model.id, label: model.label || model.id, billingSource: model.billing_source,
    name: model.label?.split(' / ').slice(1).join(' / ') || model.model_name,
    group: model.provider_name || (model.source === 'platform' ? 'Redeven AI' : model.source === 'desktop_model_source' ? 'Desktop' : copy().settings.dialog.catalog.unavailableModel),
    source: model.source === 'runtime_config' ? 'model_profile' : model.source || 'thread_snapshot',
    unavailableReason: ({ missing_keys: copy().chat.modelUnavailableMissingKeys, provider_disabled: copy().chat.modelUnavailableProviderDisabled, model_missing: copy().chat.modelUnavailableModelMissing, chatgpt_renewing: copy().settings.dialog.chatGPT.renewing, chatgpt_temporarily_unavailable: copy().settings.dialog.chatGPT.temporarilyUnavailable, chatgpt_review_required: copy().settings.dialog.chatGPT.reviewRequired, chatgpt_plan_permission_required: copy().settings.dialog.chatGPT.planPermission, chatgpt_authorization_required: copy().settings.dialog.chatGPT.authorizationRequired, chatgpt_signing_out: copy().settings.dialog.chatGPT.signingOut, chatgpt_signed_out: copy().settings.dialog.chatGPT.signedOut, chatgpt_storage_unavailable: copy().settings.dialog.chatGPT.storageUnavailable } as Record<string, string>)[model.reason ?? ''],
    disabled: model.state !== 'ready', pending: model.state === 'pending', providerType: model.provider_type,
    aliasKey: model.alias_group, quantization: model.quantization,
    supportsImageInput: flowerModelSupportsImage(model.input_modalities),
    webSearch: model.web_search, contextWindow: model.context_window,
    maxOutputTokens: model.max_output_tokens, reasoningCapability: model.reasoning_capability,
    defaultReasoningSelection: model.default_reasoning_selection,
  })));
  const currentModelLabel = createMemo(() => catalogModelOptions().find(model => model.id === currentModelID())?.label || currentModelID() || copy().chat.noModelSelected);
  const reasoningControlLabel = createMemo(() => trimString(copy().chat.reasoningLabel) || DEFAULT_FLOWER_SURFACE_COPY.chat.reasoningLabel);
  const selectedThreadModelLabel = createMemo(() => {
    const threadModelID = selectedComposerModelID();
    if (!threadModelID) return currentModelLabel();
    const catalogModel = catalogModelOptions().find((option) => option.id === threadModelID);
    if (catalogModel) return catalogModel.label;
    return threadModelID;
  });
  const threadSnapshotModelOption = createMemo<ComposerModelOption | null>(() => {
    const threadModelID = trimString(selectedThread()?.model_id) || selectedComposerModelID();
    if (!threadModelID || catalogModelOptions().some((option) => option.id === threadModelID)) return null;
    return {
      id: threadModelID,
      label: threadModelID,
      source: 'thread_snapshot',
      group: copy().settings.dialog.catalog.unavailableModel,
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
  const menuModelOptions = createMemo(() => flowerMenuModels(modelSelectOptions(), selectedComposerModelID(), [...threads()].sort((a, b) => b.updated_at_ms - a.updated_at_ms).map((thread) => trimString(thread.model_id)), modelQuery(), modelMenuExpanded()));
  const groupedModelOptions = createMemo(() => {
    const groups = new Map<string, ComposerModelOption[]>();
    for (const model of menuModelOptions().models) {
      const key = `${model.source}/${model.group}`;
      groups.set(key, [...(groups.get(key) ?? []), model]);
    }
    return [...groups.values()].map((options) => ({ label: options[0].group, options, source: options[0].source }));
  });
  const selectedReasoningCapability = createMemo(() => {
    const thread = selectedThreadSettings();
    const model = selectedModelOption();
    if (model?.reasoningCapability) return model.reasoningCapability;
    return thread?.reasoning_capability ?? null;
  });
  const composerReasoningLoading = createMemo(() => Boolean(selectedThreadID() && !selectedThreadSettings()));
  const composerReasoningSelection = createMemo(() => {
    if (composerReasoningLoading()) return undefined;
    const draft = currentComposerSessionDraft();
    const explicit = !draft.reasoningModelID || draft.reasoningModelID === selectedComposerModelID()
      ? draft.reasoningOverride : undefined;
    const selection = selectedThreadID()
      ? selectedThreadSettings()?.reasoning_selection
      : explicit ?? newConversationDefaults()?.reasoning_by_model[selectedComposerModelID()];
    return normalizeFlowerReasoningSelection(selection)
      ?? normalizeFlowerReasoningSelection(selectedModelOption()?.defaultReasoningSelection)
      ?? defaultReasoningSelectionForCapability(selectedReasoningCapability());
  });
  const composerReasoningVisible = createMemo(() => reasoningCapabilityHasPresentation(selectedReasoningCapability()));
  const composerReasoningEnabled = createMemo(() => reasoningCapabilitySupportsControl(selectedReasoningCapability()));
  // Preserve a new draft's inherited/explicit intent even when capability has
  // changed. Admission must reject it, not silently use a different preference.
  const composerLaunchReasoningSelection = createMemo(() => !selectedThreadID()
    ? composerReasoningSelection() ?? { level: 'default' as const }
    : composerReasoningEnabled() ? composerReasoningSelection() : undefined);
  const modelPatchPending = createMemo(() => {
    const pending = pendingModelPatch();
    if (!pending) return false;
    const threadID = selectedThreadID();
    return threadID ? pending.threadID === threadID : pending.threadID === pendingDraftKey();
  });
  const composerModelInteractive = createMemo(() => (
    settingsReady()
    && selectedThreadPreferenceEditable()
    && !pendingReasoningThreadIDs().has(trimString(selectedThreadID()))
    && (!selectedThreadID() || typeof props.adapter.setThreadModel === 'function')
  ));
  const composerReasoningInteractive = createMemo(() => (
    settingsReady()
    && composerReasoningEnabled()
    && !composerReasoningLoading()
    && !pendingReasoningThreadIDs().has(trimString(selectedThreadID()))
    && !modelPatchPending()
    && selectedThreadPreferenceEditable()
    && (!selectedThreadID() || typeof props.adapter.setThreadReasoningSelection === 'function')
  ));
  const modelSource = createMemo(() => modelDirectory() ? flowerDirectoryDesktopStatus(modelDirectory()!) ?? null : null);
  const modelOptionReady = (option: ComposerModelOption | null | undefined): boolean => Boolean(option
    && catalogModelOptions().some(model => model.id === option.id && !model.disabled && !model.pending));
  const readyForChat = createMemo(() => modelOptionReady(selectedModelOption()));
  const anyModelReady = createMemo(() => catalogModelOptions().some(option => !option.disabled));
  const selectedModelNeedsAttention = createMemo(() => Boolean(snapshot() && selectedComposerModelID()
    && !readyForChat() && !selectedModelOption()?.pending));
  const selectedModelAvailabilityMessage = createMemo(() => selectedModelOption()?.unavailableReason ?? copy().chat.modelsUnavailable);
  const unavailableModelSource = createMemo<UnavailableFlowerModelSourceStatus | null>(() => {
    const source = modelSource();
    if (source && (source.state === 'not_configured' || source.state === 'empty') && snapshot()?.model_profile) return null;
    return source && source.state !== 'ready' ? source : null;
  });
  const modelSourceStatusMessage = createMemo(() => {
    const source = unavailableModelSource();
    const recovery = props.adapter.modelSourceRecovery;
    return source && recovery ? trimString(recovery.describe(source)) : '';
  });
  const noModelProfileSetupActions = createMemo(() => {
    const recovery = props.adapter.modelSourceRecovery;
    const source = modelSource();
    if (!recovery || snapshot()?.model_profile || (source && source.state !== 'not_configured' && source.state !== 'empty')) return [];
    return [
      { id: 'local_settings' as const, action: recovery.localSettings },
      ...(recovery.remoteSettings ? [{ id: 'remote_settings' as const, action: recovery.remoteSettings }] : []),
    ];
  });
  const modelSourceRecoveryAction = (
    status: UnavailableFlowerModelSourceStatus,
  ): readonly Readonly<{ id: FlowerModelSourceRecoveryActionID; action: FlowerSurfaceAction }>[] => {
    const recovery = props.adapter.modelSourceRecovery;
    if (!recovery) return [];
    if ((status.state === 'not_configured' || status.state === 'empty') && !snapshot()?.model_profile) {
      return noModelProfileSetupActions();
    }
    if (status.state === 'unsupported') {
      return [{ id: 'runtime_settings', action: recovery.runtimeSettings }];
    }
    if (status.state === 'missing_keys') return [{ id: 'local_settings', action: recovery.localSettings }];
    return [{ id: 'connection_center', action: recovery.connectionCenter }];
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
  const showSetupWelcome = createMemo(() => {
    const source = unavailableModelSource();
    return needsSetup() && !selectedThreadID() && !snapshot()?.model_profile?.providers.length
      && (!source || source.state === 'not_configured' || source.state === 'empty');
  });
  const companionCompactComposer = createMemo(() => (
    presentation() === 'companion'
    && !props.embeddedConversation
    && !companionCollapsed()
    && !selectedInputRequest()
    && !selectedThreadReadOnly()
    && !selectedComposerApprovalDisplayAction()
    && !selectedThreadDetailPending()
    && !surfaceWarmupActive()
  ));

  const composerControlIDs = createMemo<readonly FlowerComposerControlID[]>(() => {
    if (bottomActionMode() !== 'chat') return [];
    if (selectedThreadReadOnly()) return ['permission', 'read_only'];
    return [
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
    if (presentation() === 'companion' && !props.embeddedConversation) return ids;
    const availableWidth = composerControlLayout().availableWidth;
    const overflow = new Set<FlowerComposerControlID>();
    if (mobileInteraction() && ids.includes('permission')) overflow.add('permission');
    for (const id of FLOWER_COMPOSER_CONTROL_OVERFLOW_ORDER) {
      const inlineIDs = ids.filter((candidate) => !overflow.has(candidate));
      if (availableWidth === null || (availableWidth > 0 && composerControlWidth(inlineIDs) <= availableWidth)) break;
      if (ids.includes(id)) overflow.add(id);
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
  createEffect(() => {
    if (initialConversationPending()) return;
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
    void composerPermissionType();
    void composerPermissionCopy()?.label;
    void selectedThreadModelLabel();
    void composerReasoningEnabled();
    void composerReasoningSelection();
    void selectedThreadReadOnlyDisplay();
    scheduleComposerControlMeasure();
  });
  createEffect(() => {
    if (composerOverflowControlIDs().length === 0) setComposerMoreOpen(false);
  });
  const cancelComposerMorePanelPosition = () => {
    if (!composerMorePanelPositionFrame) return;
    cancelTranscriptAnimationFrame(composerMorePanelPositionFrame);
    composerMorePanelPositionFrame = 0;
  };
  const composerMorePanelEstimatedSize = (): Readonly<{ width: number; height: number }> => ({
    width: FLOWER_COMPOSER_MORE_PANEL_ESTIMATED_WIDTH,
    height: FLOWER_COMPOSER_MORE_PANEL_VERTICAL_CHROME
      + composerOverflowControlIDs().length * FLOWER_COMPOSER_MORE_PANEL_ROW_HEIGHT,
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
    if (!modelMenuOpen()) return;
    const measureMenu = () => {
      const anchor = modelTriggerRef;
      const menu = modelMenuRef;
      if (!anchor || !menu) return;
      setModelMenuAvailableHeight(Math.max(0, (surfaceRef?.clientHeight || window.innerHeight) - 16));
      const rect = anchor.getBoundingClientRect();
      const size = menu.getBoundingClientRect();
      setModelMenuSize(previous => previous.width === size.width && previous.height === size.height
        ? previous : { width: size.width, height: size.height });
      setModelMenuPosition(previous => {
        const next = { x: rect.left, y: rect.top - size.height - 8 };
        return previous.x === next.x && previous.y === next.y ? previous : next;
      });
    };
    const observer = new ResizeObserver(measureMenu);
    if (surfaceRef) observer.observe(surfaceRef);
    if (modelTriggerRef) observer.observe(modelTriggerRef);
    if (modelMenuRef) observer.observe(modelMenuRef);
    const frame = requestAnimationFrame(measureMenu);
    window.addEventListener('resize', measureMenu);
    window.visualViewport?.addEventListener('resize', measureMenu);
    window.addEventListener('scroll', measureMenu, true);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', measureMenu);
      window.visualViewport?.removeEventListener('resize', measureMenu);
      window.removeEventListener('scroll', measureMenu, true);
    });
  });
  createEffect(() => {
    if (!composerMoreOpen()) {
      cancelComposerMorePanelPosition();
      return;
    }
    void composerOverflowControlIDs().join('|');
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
    const closingPanel = composerMorePanelRef;
    setComposerMoreOpen(false);
    if (restoreFocus) {
      queueMicrotask(() => {
        // Restore after responsive controls settle; a newer focus choice wins.
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
          const active = document.activeElement;
          if (!composerMoreOpen() && composerMoreButtonRef?.isConnected
            && (!active || active === document.body || closingPanel?.contains(active))) {
            composerMoreButtonRef.focus({ preventScroll: true });
          }
        }));
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
      if (composerMoreButtonRef?.contains(target) || composerMorePanelRef?.contains(target) || modelMenuRef?.contains(target)) return;
      closeComposerMore(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (permissionMenuOpen() || modelMenuOpen()) return;
      event.preventDefault();
      closeComposerMore(true);
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (composerMoreButtonRef?.contains(target) || composerMorePanelRef?.contains(target) || modelMenuRef?.contains(target)) return;
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

  let pinCommandRunning = false;
  let activePinCommand: ThreadPinCommand | undefined;
  let pinRefreshRunning = false;
  let pinRefreshNeeded = false;
  let pinRefreshNotify = false;
  const reconcileThreadPins = async (saved: boolean) => {
    pinRefreshNeeded = true;
    pinRefreshNotify ||= saved;
    if (pinRefreshRunning) return;
    pinRefreshRunning = true;
    const generation = pinMutationGeneration;
    try {
      while (pinRefreshNeeded && generation === pinMutationGeneration) {
        pinRefreshNeeded = false;
        const notifyFailure = pinRefreshNotify;
        pinRefreshNotify = false;
        try {
          // Coalesce post-command reads independently of writes and interaction.
          const summaries = await loadFlowerThreadList(props.adapter);
          if (generation !== pinMutationGeneration) return;
          setThreadCache(cache => cache.replaceSummaries(summaries.filter(thread => !retiredThreadIDs.has(thread.thread_id))));
        } catch {
          if (generation === pinMutationGeneration && notifyFailure) notifyThreadActionError(copy().threadList.pinRefreshFailed);
        }
      }
    } finally {
      pinRefreshRunning = false;
    }
  };
  const drainThreadPins = async () => {
    if (pinCommandRunning) return;
    pinCommandRunning = true;
    const generation = pinMutationGeneration;
    let saved = false;
    try {
      while (pinCommands().length && generation === pinMutationGeneration) {
        const command = pinCommands()[0];
        activePinCommand = command;
        try {
          // Serialize relative moves and membership changes, never the UI or list read.
          const result = command.kind === 'pin'
            ? await props.adapter.setThreadPinned!(command.threadID, command.pinned)
            : await props.adapter.movePinnedThread!(command.threadID, command.position);
          if (generation !== pinMutationGeneration) return;
          saved = true;
          batch(() => {
            setPinMutation(previous => {
              const next = new Map(previous);
              for (const pin of result) {
                if (!next.has(pin.thread_id) || next.get(pin.thread_id)!.settings_revision < pin.settings_revision) next.set(pin.thread_id, pin);
              }
              return next;
            });
            setPinCommands(previous => previous.slice(1));
          });
        } catch (error) {
          if (generation !== pinMutationGeneration) return;
          // Remove only the failed intent, then replay later intents over current facts.
          setPinCommands(previous => previous.slice(1));
          notifyThreadActionError(copy().threadList.pinUpdateFailed + ' ' + getErrorMessage(error));
        }
      }
    } finally {
      activePinCommand = undefined;
      pinCommandRunning = false;
      if (generation === pinMutationGeneration) void reconcileThreadPins(saved);
    }
  };
  const enqueueThreadPin = (command: ThreadPinCommand) => {
    setPinCommands(previous => {
      const last = previous.at(-1);
      // Unsent adjacent toggles need only the latest requested membership.
      return command.kind === 'pin' && last?.kind === 'pin' && last !== activePinCommand && last.threadID === command.threadID
        ? [...previous.slice(0, -1), { ...command, wasPinned: last.wasPinned }]
        : [...previous, command];
    });
    void drainThreadPins();
  };
  const toggleThreadPin = (item: FlowerThreadListItem) => {
    if (!props.adapter.setThreadPinned) return;
    const current = sidebarListItems().find(thread => thread.thread_id === item.thread_id);
    if (!current) return;
    enqueueThreadPin({ kind: 'pin', threadID: item.thread_id, pinned: !current.pinned, wasPinned: current.pinned, pinnedAt: Date.now() });
  };
  const movePinnedThread = (threadID: string, input: FlowerThreadPinPosition) => {
    if (!props.adapter.movePinnedThread) return;
    const items = sidebarListItems().filter(item => item.pinned).sort(comparePinnedFlowerThreads);
    const source = items.findIndex(item => item.thread_id === threadID);
    if (source < 0 || threadID === input.anchor_thread_id || !items.some(item => item.thread_id === input.anchor_thread_id)) return;
    items.splice(source, 1);
    const anchor = items.findIndex(item => item.thread_id === input.anchor_thread_id) + (input.placement === 'after' ? 1 : 0);
    if (anchor === source) return;
    enqueueThreadPin({ kind: 'move', threadID, position: input });
  };
  const reportThreadDetailDiagnostic = (
    threadID: string,
    stage: 'request_or_mapping' | 'current_projection' | 'cache_receive' | 'detail_not_converged',
    source: ThreadDetailSource,
    error: unknown,
    viewVersion = 0,
    acceptance?: Pick<ThreadDetailReceiveResult, 'runtimeState' | 'activityState' | 'settingsState'>,
  ) => {
    const cache = threadCache();
    const normalizedThreadID = trimString(threadID);
    const summary = cache.summaries.get(normalizedThreadID);
    const detail = cache.views.get(normalizedThreadID);
    console.error('Flower thread detail convergence failed.', {
      thread_id: normalizedThreadID,
      stage,
      source,
      summary_revision: threadSnapshotRevision(summary),
      detail_activity_revision: threadSnapshotRevision(detail?.thread),
      summary_settings_revision: threadSettingsRevision(summary),
      settings_revision: threadSettingsRevision(detail?.thread),
      content_revision: detail?.contentRevision,
      summary_status: summary?.status,
      detail_status: detail?.thread.status,
      summary_run_id: summary?.active_run_id,
      detail_run_id: detail?.thread.active_run_id,
      view_version: Math.max(0, Math.floor(Number(viewVersion || detail?.version) || 0)),
      ...(acceptance ? {
        runtime_state: acceptance.runtimeState,
        activity_state: acceptance.activityState,
        settings_state: acceptance.settingsState,
      } : {}),
      error: getErrorMessage(error),
    });
  };

  const threadDetailUserError = (error: unknown): string => {
    const message = getErrorMessage(error);
    if (message === copy().chat.syncTimeout) return message;
    return message.startsWith('Flower contract error:')
      ? message
      : copy().chat.threadSyncFailed;
  };

  const reconcileRuntimeObservation = (current: FlowerRuntimeCurrentView | undefined, initialCache: ReturnType<typeof createThreadCache>, threadID: string) => {
    let currentOutbox = transportOutbox();
    if (current) {
      for (const entry of currentOutbox.matchCurrent(current, { canConfirm: canConfirmOutboxEntry })) {
        if (!entry.input.thread_id) currentOutbox = currentOutbox.bindAcceptedThread(entry.requestId, threadID);
      }
    }
    const reconciliation = current
      ? currentOutbox.reconcile(current, { canConfirm: canConfirmOutboxEntry })
      : { outbox: currentOutbox, admitted: [] };
    let nextCache = initialCache;
    let selectionTransferred = false;
    const admittedHandoffs = reconciliation.admitted.flatMap((entry) => {
      if (entry.threadId.startsWith(`${PENDING_NEW_THREAD_ID}:`)) embeddedThreads.set(entry.threadId, threadID);
      const handoff = pendingAdmissionHandoffs.get(entry.requestId);
      if (!handoff) {
        if (entry.presentation === 'composer') consumeSubmittedComposerDraft(entry, threadID);
        return [];
      }
      if (handoff.sessionKey.startsWith(`${PENDING_NEW_THREAD_ID}:`)) embeddedThreads.set(handoff.sessionKey, threadID);
      const transferDraftScope = Boolean(
        !selectionTransferred
        && isPendingDraftKey(handoff.sessionKey)
        && handoff.selectionSequence === threadLoadSequence
        && !nextCache.selectedId
      );
      if (transferDraftScope) {
        nextCache = nextCache.select(threadID);
        selectionTransferred = true;
      }
      return [{ entry, handoff, transferDraftScope }];
    });
    batch(() => {
      for (const entry of reconciliation.admitted) { outboxDraftRestorers.delete(entry.requestId); outboxOperations.delete(entry.requestId); }
      for (const { entry, handoff, transferDraftScope } of admittedHandoffs) {
        handoff.settle(threadID, transferDraftScope);
        pendingAdmissionHandoffs.delete(entry.requestId);
      }
      setTransportOutbox(reconciliation.outbox);

      const retained = nextCache.views.get(threadID)?.thread;
      if (retained) reconcileInputDraft(threadID, retained.input_request);
      if (selectionTransferred) {
        setThreadLoadError('');
        setSidePanel('chat');
      }
    });
    return nextCache;
  };

  const receiveThreadDetail = (
    candidate: ThreadView,
    source: ThreadDetailSource,
    current?: FlowerRuntimeCurrentView,
    canonicalTitle = true,
  ): ThreadDetailReceiveResult => batch(() => {
    const threadID = trimString(candidate.thread.thread_id);
    if (!threadID || retiredThreadIDs.has(threadID)) {
      return {
        state: 'stale',
        runtimeState: 'stale',
        activityState: 'stale',
        settingsState: 'stale',
        thread: candidate.thread,
      };
    }
    const previous = threadCache().views.get(threadID)?.thread
      ?? threadCache().summaries.get(threadID);
    let result: ReturnType<ReturnType<typeof createThreadCache>['receiveView']>;
    try {
      const summary = threadCache().summaries.get(threadID);
      const cache = threadCache();
      const options = {
        current,
        preserveSummary: source === 'summary_update'
          && (threadSnapshotRevision(summary) > (candidate.contentRevision ?? threadSnapshotRevision(candidate.thread))
            || threadSettingsRevision(summary) > threadSettingsRevision(candidate.thread)),
      };
      result = canonicalTitle ? cache.receiveView(candidate, options) : cache.receiveCurrent(candidate, options);
    } catch (error) {
      reportThreadDetailDiagnostic(threadID, 'cache_receive', source, error, candidate.version);
      throw error;
    }
    const {
      state,
      runtimeState,
      activityState,
      settingsState,
    } = result;
    const retained = result.cache.views.get(threadID)?.thread ?? candidate.thread;
    let nextCache = reconcileRuntimeObservation(current, result.cache, threadID);
    for (const observation of result.observations ?? []) nextCache = reconcileRuntimeObservation(observation, nextCache, threadID);
    setThreadCache(nextCache);
    if (state !== 'accepted') return {
      state,
      runtimeState,
      activityState,
      settingsState,
      thread: retained,
    };
    const acceptedSummary = nextCache.summaries.get(threadID);
    const detailConverged = !threadSummaryNeedsDetail(acceptedSummary, retained, result.cache.views.get(threadID)?.contentRevision);
    if (runtimeState === 'accepted' && (retained.cancellation || !flowerThreadHasActiveTurnEvidence(retained))) {
      updateThreadIDMembership(setUnconfirmedStops, threadID, false);
    }
    if (detailConverged && createdForkThreadID() === threadID) setCreatedForkThreadID('');
    if (detailConverged && threadID === selectedThreadID()) setThreadLoadError('');

    if (runtimeState === 'accepted' && (
      previous
      && previous.model_id !== retained.model_id
      && !sameFlowerReasoningSelection(previous.reasoning_selection, retained.reasoning_selection)
    )) {
      notifySuccess(copy().chat.reasoningAdjusted);
    }
    if (runtimeState === 'accepted' && threadID === selectedThreadID()) {
      setTranscriptLayoutRevision((revision) => revision + 1);
    }
    return {
      state,
      runtimeState,
      activityState,
      settingsState,
      thread: retained,
    };
  });

  const receiveThreadView = (
    live: FlowerThreadView,
    source: ThreadDetailSource,
    requestEpoch: number,
    readingBaseline = false,
  ): ThreadDetailReceiveResult => {
    if (requestEpoch !== liveTransport.connectionEpoch()) return {
      state: 'stale', runtimeState: 'stale', activityState: 'stale', settingsState: 'stale',
      thread: threadCache().views.get(live.thread.thread_id)?.thread ?? live.thread,
    };
    if (!readingBaseline && live.current.window && props.adapter.loadHistory && selectedThreadID() === live.thread.thread_id
      && threadCache().views.get(live.thread.thread_id)?.thread.history_window) {
      setThreadCache(cache => cache.replaceSummary(live.thread));
      void requestThreadDetail(live.thread.thread_id, 'user_action', true);
      return { state: 'unchanged', runtimeState: 'unchanged', activityState: 'unchanged', settingsState: 'unchanged',
        thread: threadCache().views.get(live.thread.thread_id)!.thread };
    }
    // Validate the complete presentation contract before this view can enter
    // the cache. Rendering must never be the first place malformed history is
    // discovered.
    buildFlowerTimelineEntries(live.thread);
    readSync.setAvailable(readSyncOnline(), true);
    const navigation = attentionNavigation();
    return receiveThreadDetail({
      thread: { ...live.thread, ...(navigation?.childThreadID === live.thread.thread_id ? { parent_thread_id: navigation.parentThreadID } : {}) },
      version: Math.max(1, Math.floor(Number(live.current.view_version) || 0)),
    }, source, live.current);
  };
  let queuedTurnReorderSequence = 0;
  const queuedTurnReorderEnabled = () => Boolean(
    props.adapter.reorderQueuedTurns
    && !selectedThreadReadOnly()
    && !queuedTurnSendPending(trimString(selectedThreadID())) && !queueTakeBackPending().has(trimString(selectedThreadID()))
    && selectedCanonicalQueuedTurns().length > 1
  );
  const beginQueuedTurnDrag = (event: DragEvent & { currentTarget: HTMLDivElement }, queueID: string) => {
    if (!queuedTurnReorderEnabled()) {
      event.preventDefault();
      return;
    }
    const threadID = trimString(selectedThreadID());
    const orderedQueueIDs = selectedCanonicalQueuedTurns().map((turn) => trimString(turn.queue_id));
    const draggedQueueID = trimString(queueID);
    if (!threadID || queuedTurnSendPending(threadID) || !draggedQueueID || !orderedQueueIDs.includes(draggedQueueID)) {
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
    if (queuedTurnSendPending(reorder.threadID)) return;
    event.preventDefault();
    const changed = reorder.orderedQueueIDs.some((queueID, index) => queueID !== reorder.originalQueueIDs[index]);
    if (!changed || !props.adapter.reorderQueuedTurns) {
      setQueuedTurnReorder(null);
      return;
    }
    const sequence = ++queuedTurnReorderSequence;
    setQueuedTurnReorder(null);
    const requestEpoch = liveTransport.connectionEpoch();
    void withFlowerRequestDeadline(() => props.adapter.reorderQueuedTurns!(reorder.threadID, reorder.orderedQueueIDs), copy().chat.syncTimeout).then(async () => {
      if (sequence !== queuedTurnReorderSequence || requestEpoch !== liveTransport.connectionEpoch()) return;
      await requestThreadDetail(reorder.threadID, 'user_action', true, true);
    }).catch((error) => {
      if (sequence !== queuedTurnReorderSequence) return;
      notifyThreadActionError(getErrorMessage(error));
    });
  };
  const finishQueuedTurnDrag = () => {
    if (queuedTurnReorder()?.phase === 'dragging') setQueuedTurnReorder(null);
  };
  const deleteQueuedTurn = async (turn: FlowerQueuedTurn): Promise<void> => {
    if (pendingThreadSelection()) return;
    const threadID = trimString(selectedThreadID());
    const queueID = trimString(turn.queue_id);
    if (
      !props.adapter.deleteQueuedTurn
      || !threadID
      || !queueID
      || queuedTurnSendPending(threadID)
      || queueTakeBackPending().has(threadID)
    ) return;
    setQueuedTurnReorder(null);
    const requestEpoch = liveTransport.connectionEpoch();
    try {
      await withFlowerRequestDeadline(() => props.adapter.deleteQueuedTurn!(threadID, queueID), copy().chat.syncTimeout);
      if (requestEpoch === liveTransport.connectionEpoch()) await requestThreadDetail(threadID, 'user_action', true, true);
    } catch (error) {
      try {
        if (requestEpoch === liveTransport.connectionEpoch()) await requestThreadDetail(threadID, 'background_refresh', true, true);
      } catch (recoveryError) {
        reportThreadDetailDiagnostic(threadID, 'request_or_mapping', 'background_refresh', recoveryError);
      }
      notifyThreadActionError(getErrorMessage(error));
    }
  };
  const queuedTurnSendBlocked = (threadID: string): boolean => {
    return !settingsReady()
      || !!pendingThreadSelection()
      || selectedThreadReadOnly()
      || selectedThreadStopPending()
      || queuedTurnSendPending(threadID)
      || queueTakeBackPending().has(threadID)
      || transportOutbox().forThread(threadID).some((entry) => !entry.terminalError);
  };
  const sendQueuedTurnNow = async (turn: FlowerQueuedTurn): Promise<void> => {
    const threadID = trimString(selectedThreadID());
    const queueID = trimString(turn.queue_id);
    const adapter = props.adapter;
    if (!adapter.sendQueuedTurnNow || !threadID || !queueID || queuedTurnSendBlocked(threadID)) return;
    const requestEpoch = liveTransport.connectionEpoch();
    queuedTurnSendInFlight.set(threadID, queueID);
    setQueuedTurnSendRevision((value) => value + 1);
    setQueuedTurnReorder(null);
    transcriptScroll.startFollowing();
    scrollTranscriptToBottom({ smooth: false });
    requestTranscriptAnimationFrame(() => scrollTranscriptToBottom({ smooth: false }));
    try {
      await withFlowerRequestDeadline(() => adapter.sendQueuedTurnNow!(threadID, queueID), copy().chat.syncTimeout);
      if (requestEpoch === liveTransport.connectionEpoch()) await requestThreadDetail(threadID, 'user_action', true, true);
      if (requestEpoch === liveTransport.connectionEpoch() && selectedThreadID() === threadID) requestComposerFocus();
    } catch (error) {
      try {
        if (requestEpoch === liveTransport.connectionEpoch()) await requestThreadDetail(threadID, 'background_refresh', true, true);
      } catch (recoveryError) {
        reportThreadDetailDiagnostic(threadID, 'request_or_mapping', 'background_refresh', recoveryError);
      }
      notifyThreadActionError(getErrorMessage(error));
    } finally {
      if (queuedTurnSendInFlight.get(threadID) === queueID) {
        queuedTurnSendInFlight.delete(threadID);
        setQueuedTurnSendRevision((value) => value + 1);
      }
    }
  };
  const setThreadDetailLoading = (threadID: string, loading: boolean) => {
    setThreadDetailLoadingIDs((current) => {
      if (current.has(threadID) === loading) return current;
      const next = new Set(current);
      if (loading) next.add(threadID);
      else next.delete(threadID);
      return next;
    });
  };

  const historyBodyKey = (threadID: string, itemID: string) => JSON.stringify([threadID, itemID]);
  const loadHistoryItem = (threadID: string, itemID: string, visibleSignal?: AbortSignal, retry = false, viewportScope?: FlowerScrollTailController) => {
    const expected = threadCache().runtimeItem(threadID, itemID);
    if (!expected || (!expected.body && !expected.activity_bodies?.length) || !props.adapter.loadHistoryItem) return;
    const signal = visibleSignal ? AbortSignal.any([navigationReadController.signal, visibleSignal]) : navigationReadController.signal;
    const epoch = liveTransport.connectionEpoch();
    historyBodies.request(historyBodyKey(threadID, itemID), expected, signal, async readSignal => {
      const item = await props.adapter.loadHistoryItem!(threadID, itemID, readSignal);
      readSignal.throwIfAborted();
      if (epoch !== liveTransport.connectionEpoch()) throw new DOMException('Read was superseded.', 'AbortError');
      const viewport = viewportScope?.viewport();
      const bounds = viewport?.getBoundingClientRect();
      const anchor = viewport && bounds && !viewportScope!.followingLatest()
        ? [...viewport.querySelectorAll<HTMLElement>('[data-flower-message-id]')].find(element => {
          const top = element.getBoundingClientRect().top;
          return top >= bounds.top && top < bounds.bottom;
        }) : undefined;
      if (anchor) {
        viewportScope!.preserveLayoutAnchor(anchor);
        requestTranscriptAnimationFrame(() => viewportScope!.finishDisclosure(anchor));
      }
      if (!threadCache().hydrateItem(threadID, expected, item)) {
        if (threadCache().runtimeItem(threadID, itemID)?.body || threadCache().runtimeItem(threadID, itemID)?.activity_bodies?.length) throw new Error('Body changed during read.');
        return;
      }
      setTranscriptLayoutRevision(value => value + 1);
    }, retry);
  };
  const historyBodyControl = (threadID: Accessor<string>, itemID: Accessor<string>, viewportScope: FlowerScrollTailController) => {
    const state = () => { historyBodyRevision(); return historyBodies.state(historyBodyKey(threadID(), itemID())); };
    return <div class="flower-history-body-control" role="status" aria-busy={state() !== 'failed'}>
      <Show when={state() === 'failed'} fallback={<span>{copy().chat.history.loading}</span>}>
        <span>{copy().chat.history.failed}</span>
        <button type="button" class="flower-parent-event-action"
          onClick={() => loadHistoryItem(threadID(), itemID(), undefined, true, viewportScope)}>{copy().chat.handlerRetry}</button>
      </Show>
    </div>;
  };
  const readHistory = async (tid: string, input: import('./contracts/flowerSurfaceContracts').FlowerHistoryRequest, signal: AbortSignal, foreground: boolean) => {
    if (!props.adapter.loadHistory) return props.adapter.loadThread(tid, signal);
    const observer = foreground ? computerObserverID() : '';
    const revision = observer ? ++historyReadingRevision : 0;
    if (observer) {
      historyReadingThreadID = tid;
    }
    const view = await props.adapter.loadHistory(tid, { ...input, ...(observer ? { observer_id: observer, reading_revision: revision } : {}) }, signal);
    signal.throwIfAborted();
    if (observer && (revision !== historyReadingRevision || observer !== computerObserverID())) throw new DOMException('History read was superseded.', 'AbortError');
    if (observer) historyReadingInput = input;
    return view;
  };
  const moveHistory = async (direction: 'before' | 'after' | 'latest') => {
    const tid = selectedThreadID();
    const window = selectedThread()?.history_window;
    if (!tid || !window || !props.adapter.loadHistory || historyBusy()) return;
    const input = direction === 'latest' ? {} : { direction, anchor_id: direction === 'before' ? window.first_item_id : window.last_item_id };
    const signal = navigationReadController.signal;
    const epoch = liveTransport.connectionEpoch();
    const release = threadCache().beginRuntimeRead(tid);
    setHistoryBusy(true); setHistoryError('');
    try {
      const view = await readHistory(tid, input, signal, true);
      signal.throwIfAborted();
      if (tid !== selectedThreadID()) return;
      receiveThreadView(view, 'user_action', epoch, true);
      if (direction === 'latest') transcriptScroll.startFollowing();
      else transcriptScroll.stopFollowing();
      requestTranscriptAnimationFrame(() => {
        const viewport = transcriptScroll.viewport();
        if (viewport && selectedThreadID() === tid) viewport.scrollTop = direction === 'before' ? viewport.scrollHeight : 0;
        if (direction === 'latest') transcriptScroll.scrollToBottom();
      });
    } catch (error) {
      if (!signal.aborted && tid === selectedThreadID()) {
        setHistoryError(copy().chat.history.failed);
        if (computerObserverID()) liveTransport.restart();
        if ((error as { code?: string })?.code === 'flower_live_sync_error') liveTransport.fail(error, epoch);
      }
    } finally { release(); setHistoryBusy(false); }
  };
  const historyNavigation = (placement: 'before' | 'after') => <Show when={selectedThread()?.history_window}>
    <nav class="flower-history-navigation" aria-label={copy().chat.history.label}>
      <Show when={placement === 'before' && selectedThread()?.history_window?.has_before}>
        <button type="button" class="flower-parent-event-action" disabled={historyBusy()} aria-busy={historyBusy()} onClick={() => void moveHistory('before')}>{historyBusy() ? copy().chat.history.loading : copy().chat.history.older}</button>
      </Show>
      <Show when={placement === 'after' && selectedThread()?.history_window?.has_after}>
        <button type="button" class="flower-parent-event-action" disabled={historyBusy()} onClick={() => void moveHistory('after')}>{copy().chat.history.newer}</button>
      </Show>
      <Show when={placement === 'after' && (selectedThread()?.history_window?.has_after || historyReadingInput.anchor_id)}>
        <button type="button" class="flower-parent-event-action" disabled={historyBusy()} onClick={() => void moveHistory('latest')}>{copy().chat.history.latest}</button>
      </Show>
      <Show when={placement === 'before' && historyError()}><span role="alert">{historyError()}</span></Show>
    </nav>
  </Show>;
  const threadDetailRuntimeKey = (thread: FlowerThreadSnapshot | undefined) => thread
    ? JSON.stringify([thread.status, thread.active_run_id, thread.approval_pending, thread.approval_pending_count]) : '';
  const detailLoader = createThreadDetailLoader<FlowerThreadSnapshot>({
    read: async (tid, target, signal) => {
      const releaseRead = threadCache().beginRuntimeRead(tid);
      try {
      const foreground = tid === selectedThreadID() && target.source !== 'goal_popup';
      const input = foreground && historyReadingThreadID === tid ? historyReadingInput : {};
      const live = await readDetail(readSignal => readHistory(tid, input, readSignal, foreground), signal);
      signal.throwIfAborted();
      if (surfaceDisposed || retiredThreadIDs.has(tid) || target.epoch !== liveTransport.connectionEpoch()) {
        throw new DOMException('Read was superseded.', 'AbortError');
      }
      const result = receiveThreadView(live, target.source as ThreadDetailSource, target.epoch, true);
      const latest = threadCache().summaries.get(tid);
      if (threadSummaryNeedsDetail(latest, result.thread, threadCache().views.get(tid)?.contentRevision)
        && threadSnapshotRevision(latest) <= target.activityRevision
        && threadSettingsRevision(latest) <= target.settingsRevision
        && threadDetailRuntimeKey(latest) === target.runtimeKey) {
        throw new Error('thread detail did not converge to the requested revision');
      }
      return result.thread;
      } finally { releaseRead(); }
    },
    onError: (tid, target, error) => {
      if (surfaceDisposed || retiredThreadIDs.has(tid) || target.epoch !== liveTransport.connectionEpoch()) return;
      if ((error as { code?: unknown })?.code === 'flower_live_sync_error') { liveTransport.fail(error, target.epoch); return; }
      if ((error as { name?: string })?.name === 'AbortError') return;
      // A failed HTTP baseline may already have installed a different server
      // interest. Fence that observation until the user retries the read.
      if (props.adapter.loadHistory && selectedThreadID() === tid && computerObserverID()) liveTransport.fail(error, target.epoch);
      reportThreadDetailDiagnostic(tid, 'request_or_mapping', target.source as ThreadDetailSource, error);
      if (target.source !== 'goal_popup' && selectedThreadID() === tid && !pendingThreadSelection()) setThreadLoadError(threadDetailUserError(error));
    },
    onLoading: (tid, loading, target) => setThreadDetailLoading(tid, loading && target?.source !== 'goal_popup'),
  });
  createEffect(() => {
    const cache = threadCache();
    detailLoader.retain([...cache.views.keys(), ...(cache.selectedId ? [cache.selectedId] : [])]);
  });
  const beginThreadDetailDisplayCycle = (threadID: string) => detailLoader.invalidate(threadID);
  const requestThreadDetail = (
    threadID: string,
    source: ThreadDetailSource,
    force = false,
    background = false,
    demandSignal?: AbortSignal,
  ): Promise<FlowerThreadSnapshot | null> => {
    const tid = trimString(threadID);
    if (!tid || surfaceDisposed || retiredThreadIDs.has(tid)
      || (!background && (pendingThreadSelection() || tid !== selectedThreadID()))) return Promise.resolve(null);
    const cached = threadCache().views.get(tid);
    const summary = threadCache().summaries.get(tid);
    if (!force && cached?.version && !threadSummaryNeedsDetail(summary, cached.thread, cached.contentRevision)) return Promise.resolve(cached.thread);
    if (force) detailLoader.invalidate(tid);
    const signal = background ? demandSignal : demandSignal
      ? AbortSignal.any([navigationReadController.signal, demandSignal]) : navigationReadController.signal;
    const target = { epoch: liveTransport.connectionEpoch(), activityRevision: threadSnapshotRevision(summary),
      settingsRevision: threadSettingsRevision(summary), runtimeKey: threadDetailRuntimeKey(summary), source };
    return detailLoader.request(tid, target, signal);
  };

  createEffect(() => {
    const threadID = trimString(selectedThreadID());
    const summary = selectedThreadSummary();
    if (pendingThreadSelection() || !threadID || !summary || !selectedThreadSummaryNeedsDetail()) return;
    untrack(() => { void requestThreadDetail(threadID, 'summary_update'); });
  });

  const scrollSelectedThreadToLatestAfterLayout = (threadID: string, sequence: number) => {
    const tid = trimString(threadID);
    if (!tid) return;
    const interruptionRevision = transcriptScroll.userInterruptionRevision();
    requestTranscriptAnimationFrame(() => {
      if (sequence !== threadLoadSequence || selectedThreadID() !== tid) return;
      if (selectedThreadTailRevealIsCurrent(tid, sequence)) {
        scheduleSelectedThreadTailReveal(tid, sequence);
        return;
      }
      if (transcriptScroll.userInterruptionRevision() !== interruptionRevision) return;
      transcriptScroll.scheduleTailScroll({ smooth: false });
    });
  };

  createEffect(() => {
    const presented = presentedSelection();
    const thread = selectedThread();
    if (!presented || !thread || !readPresentationVisible()
      || threadLoadError() || pendingThreadSelection()
      || threadDetailLoadingIDs().has(thread.thread_id) || presented.threadID !== selectedThreadID()
      || presented.sequence !== threadLoadSequence
      || presented.contentRevision !== threadCache().views.get(thread.thread_id)?.contentRevision) return;
    readSync.present(thread.thread_id, presented.contentRevision, thread.read_status.read_state.last_seen_activity_revision);
  });

  const writeClipboardText = async (value: string, label: string) => {
    const text = trimString(value);
    if (!text) return;
    await writeTextToClipboard(text);
    notifySuccess(copy().threadList.copied(label));
  };

  const openRename = (threadID: string, title: string, restore?: HTMLElement, placement: 'dialog' | 'header' = 'dialog') => {
    if (renameSaving()) return;
    setRenameDraft(title);
    setRenameError('');
    renameRestoreRef = restore;
    setRenameTarget({ threadID: trimString(threadID), placement });
    queueMicrotask(() => {
      renameInputRef?.focus();
      renameInputRef?.select();
    });
  };

  const finishRename = (target: ReturnType<typeof renameTarget>, restoreFocus: boolean) => {
    if (!target || renameTarget() !== target) return;
    const restore = target.placement === 'header' ? headerRenameTriggerRef : renameRestoreRef;
    const shouldRestoreFocus = restoreFocus && (target.placement !== 'header'
      || Boolean(headerRenameTriggerRef?.parentElement?.contains(document.activeElement)));
    setRenameTarget(null);
    setRenameDraft('');
    setRenameError('');
    setRenameSaving(false);
    renameRestoreRef = undefined;
    if (shouldRestoreFocus) queueMicrotask(() => restore?.focus({ preventScroll: true }));
  };

  const closeRename = () => {
    if (!renameSaving()) finishRename(renameTarget(), true);
  };

  createEffect(() => {
    const target = renameTarget();
    if (target?.placement === 'header' && (target.threadID !== selectedThreadID()
      || presentation() !== 'full' || visiblePanel() !== 'chat' || !props.adapter.renameThread)) {
      finishRename(target, false);
    }
  });

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

  const submitRename = async (restoreFocus = true) => {
    const target = renameTarget();
    if (!target || !props.adapter.renameThread || renameSaving()) return;
    if (renameUnchanged()) {
      if (target.placement === 'header') finishRename(target, restoreFocus);
      return;
    }
    if (target.placement === 'header' && !trimString(renameDraft())) return;
    setRenameSaving(true);
    setRenameError('');
    try {
      const requestEpoch = liveTransport.connectionEpoch();
      const live = await props.adapter.renameThread(target.threadID, renameDraft());
      receiveThreadView(live, 'user_action', requestEpoch);
      finishRename(target, restoreFocus);
    } catch (error) {
      if (renameTarget() === target) setRenameError(getErrorMessage(error));
      else notifyThreadActionError(getErrorMessage(error));
    } finally {
      if (renameTarget() === target) setRenameSaving(false);
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
        restore.focus({ preventScroll: true });
      }
    });
  };

  const directoryMenuAvailability = createMemo<FlowerDirectoryMenuAvailability>(() => {
    const state = props.adapter.workingDirectoryActionAvailability?.();
    return {
      favorites: props.adapter.directoryFavorites?.(() => copy().filesystemPicker.favoritesLoadFailed),
      favoriteLabel: copy().filesystemPicker.favoriteDirectory,
      unfavoriteLabel: copy().filesystemPicker.unfavoriteDirectory,
      onFavoriteError: error => notifyThreadActionError(getErrorMessage(error)),
      ...(props.adapter.openWorkingDirectoryInFileBrowser ? { browse: state?.browse ?? { enabled: true } } : {}),
      ...(props.adapter.openWorkingDirectoryInTerminal ? { terminal: state?.terminal ?? { enabled: true } } : {}),
    };
  });
  const workingDirectoryBrowseDisabledReason = createMemo(() => {
    if (!displayedWorkingDirectory()) return copy().threadList.workingDirectoryUnavailable;
    const availability = directoryMenuAvailability().browse;
    return availability?.enabled ? '' : availability?.reason || copy().threadList.workingDirectoryUnavailable;
  });
  const workingDirectoryBrowseTitle = createMemo(() => (
    [copy().threadList.browseWorkingDirectory, displayedWorkingDirectory(), workingDirectoryBrowseDisabledReason()]
      .filter(Boolean).join(' — ')
  ));
  const browseWorkingDirectory = async (request: FlowerWorkingDirectoryOpenRequest, origin?: HTMLElement) => {
    try {
      const path = normalizeAbsolutePath(request.path);
      const availability = directoryMenuAvailability().browse;
      if (!path || !availability?.enabled) throw new Error(availability?.reason || copy().threadList.workingDirectoryUnavailable);
      // The destination captures this origin before taking focus and owns loading errors.
      if (origin?.isConnected) origin.focus({ preventScroll: true });
      await props.adapter.openWorkingDirectoryInFileBrowser?.({ ...request, path });
    } catch (error) {
      notifyThreadActionError(getErrorMessage(error));
      restoreThreadMenuFocus(origin);
    }
  };
  const handleDirectoryMenuAction = async (
    action: FlowerDirectoryMenuAction,
    request: FlowerWorkingDirectoryOpenRequest,
    restore?: HTMLElement,
  ) => {
    const path = normalizeAbsolutePath(request.path);
    const target = { thread_id: request.thread_id, path };
    try {
      if (!path || !request.thread_id) throw new Error(copy().threadList.workingDirectoryUnavailable);
      if (action === 'favorite_workdir') { restoreThreadMenuFocus(restore); return; }
      if (action === 'copy_workdir') {
        await writeClipboardText(path, copy().threadList.workingDirectoryLabel);
        restoreThreadMenuFocus(restore);
        return;
      }
      if (action === 'browse_workdir') {
        await browseWorkingDirectory(target, restore);
        return;
      }
      const availability = directoryMenuAvailability().terminal;
      if (!availability?.enabled) throw new Error(availability?.reason || copy().threadList.workingDirectoryUnavailable);
      await props.adapter.openWorkingDirectoryInTerminal?.(target);
    } catch (error) {
      notifyThreadActionError(getErrorMessage(error));
      restoreThreadMenuFocus(restore);
    }
  };
  const [transcriptMenu, setTranscriptMenu] = createSignal<Readonly<{
    target: FlowerWorkingDirectoryOpenRequest | null;
    title: string;
    x: number;
    y: number;
    restore: HTMLElement;
    selection: string;
  }> | null>(null);
  const closeTranscriptMenu = (restoreFocus = true) => {
    const restore = transcriptMenu()?.restore;
    setTranscriptMenu(null);
    if (restoreFocus) restore?.focus({ preventScroll: true });
  };
  const openTranscriptMenu = (event: MouseEvent | KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const viewport = event.currentTarget;
    const target = event.target;
    if (!(viewport instanceof HTMLElement) || !(target instanceof Element)) return;
    if (target.closest('a, input, textarea, button, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="menu"], [data-flower-context-menu-owner], .flower-activity-terminal-output')) return;
    const selection = window.getSelection();
    const text = selection && !selection.isCollapsed
      && selection.anchorNode && viewport.contains(selection.anchorNode)
      && selection.focusNode && viewport.contains(selection.focusNode)
      ? selection.toString() : '';
    const threadID = selectedThreadID();
    if (!threadID && !text) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = viewport.getBoundingClientRect();
    setTranscriptMenu({
      target: threadID ? { thread_id: threadID, path: selectedThreadDetailPending() ? '' : selectedThreadWorkingDirectory() } : null,
      title: selectedThread()?.title || copy().threadList.title,
      x: event instanceof MouseEvent ? event.clientX : rect.left + 18,
      y: event instanceof MouseEvent ? event.clientY : rect.top + 18,
      restore: viewport,
      selection: text,
    });
  };
  createEffect(() => {
    const menu = transcriptMenu();
    if (menu && (menu.target && menu.target.thread_id !== selectedThreadID()
      || !surfaceEngaged() || !transcriptVisible() || companionCollapsed() || sidePanel() !== 'chat')) setTranscriptMenu(null);
  });

  const handleThreadMenuAction = async (action: FlowerThreadMenuAction, item: FlowerThreadListItem, restore?: HTMLElement, sourceItemID?: string) => {
    if (action === 'reference') { addThreadReference(item); return; }
    if (action === 'pin') { toggleThreadPin(item); restoreThreadMenuFocus(restore); return; }
    if (action === 'browse_workdir' || action === 'terminal_workdir' || action === 'copy_workdir' || action === 'favorite_workdir') {
      await handleDirectoryMenuAction(action, { thread_id: item.thread_id, path: item.working_dir }, restore);
      return;
    }
    if (threadActionBusy()) {
      restoreThreadMenuFocus(restore);
      return;
    }
    let shouldRestoreFocus = action !== 'rename' && action !== 'delete';
    try {
      switch (action) {
        case 'copy_thread_id':
          await writeClipboardText(item.thread_id, copy().threadList.threadIDLabel);
          return;
        case 'rename':
          if (!props.adapter.renameThread) return;
          openRename(item.thread_id, item.title, restore);
          return;
        case 'delete':
          if (!props.adapter.deleteThread) return;
          openDeleteDialog(item, restore);
          return;
        case 'stop': {
          setThreadActionBusy({ threadID: item.thread_id, action });
          await requestThreadStop(item.thread_id);
          return;
        }
        case 'fork':
          if (!props.adapter.forkThread) return;
          setThreadActionBusy({ threadID: item.thread_id, action });
          {
            const requestKey = JSON.stringify([item.thread_id, sourceItemID ?? '']);
            const request = forkRequests.get(requestKey) ?? {
              client_request_id: createFlowerClientRequestID(),
              title: flowerForkTitle(item.title, copy().threadList.forkSuffix),
              ...(sourceItemID ? { source_item_id: sourceItemID } : {}),
            };
            forkRequests.set(requestKey, request);
            const forked = await props.adapter.forkThread(item.thread_id, request);
            forkRequests.delete(requestKey);
            setThreadCache((cache) => cache.replaceSummary(forked));
            setCreatedForkThreadID(forked.thread_id);
            shouldRestoreFocus = false;
            notifySuccess(copy().threadList.forkCreated);
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

  const loadAndSelectThread = async (
    threadID: string,
    revalidateWarmDetail = false,
    claimedSequence?: number,
    focusOwner = typeof document === 'undefined' ? null : document.activeElement,
  ) => {
    const tid = trimString(threadID);
    if (!tid || retiredThreadIDs.has(tid)) return;
    if (
      claimedSequence !== undefined
      && (claimedSequence !== threadLoadSequence || pendingThreadSelection() !== tid)
    ) {
      return;
    }
    releaseNavigationReads();
    const sequence = claimedSequence ?? ++threadLoadSequence;
    const detailAvailable = threadCache().views.has(tid);
    batch(() => {
      setThreadNavigationOpen(false);
      cancelDeferredThreadSelection();
      closeSubagentOverlays();
      cancelPresentedSelectionSchedule();
      setPresentedSelection(null);
      historyReadingRevision++; historyReadingInput = {}; historyReadingThreadID = tid; setHistoryBusy(false); setHistoryError('');
      beginThreadDetailDisplayCycle(tid);
      setThreadLoadError('');
      transcriptScroll.startFollowing();
      beginSelectedThreadTailReveal(tid, sequence);
      // ThreadCache remains the single owner of the committed conversation identity.
      setSelectedThreadID(tid);
    });
	if (detailAvailable) {
		scheduleThreadSelectionContentPresented(tid);
    }
    scheduleSelectedThreadTailReveal(tid, sequence);
    returnToChat();
    if (detailAvailable) {
      // Cached DOM is mounted by this batch's render effects. Position and
      // reveal it in the same task, before a loading frame can be painted.
      queueMicrotask(() => {
        if (selectedThreadTailRevealIsCurrent(tid, sequence)) transcriptScroll.flushLayout();
      });
      if (!mobileNavigation()) requestComposerFocus(focusOwner);
      if (props.adapter.loadHistory || revalidateWarmDetail || threadNeedsFileActivityTargets(threadCache().views.get(tid)!.thread)) {
        void requestThreadDetail(
          tid,
          'background_refresh',
          true,
        );
      }
      return;
    }
    await requestThreadDetail(tid, 'initial_load');
    if (sequence !== threadLoadSequence || selectedThreadID() !== tid) return;
    const loaded = threadCache().views.get(tid)?.thread;
    if (loaded) {
      setSelectedThreadWithDetail(loaded.thread_id);
      scheduleThreadSelectionContentPresented(loaded.thread_id);
      if (selectedThreadTailRevealIsCurrent(loaded.thread_id, sequence)) {
        scheduleSelectedThreadTailReveal(loaded.thread_id, sequence);
      } else {
        scrollSelectedThreadToLatestAfterLayout(loaded.thread_id, sequence);
      }
      if (!mobileNavigation()) requestComposerFocus(focusOwner);
    } else {
      if (selectedThreadTailRevealIsCurrent(tid, sequence)) {
        cancelSelectedThreadTailReveal();
      }
      cancelThreadSelectionTransaction();
    }
  };
  const scheduleThreadSelectionAfterPaint = (threadID: string, claimedSequence: number, focusOwner: Element | null) => {
    const tid = trimString(threadID);
    if (!tid) return;
    if (typeof window === 'undefined') {
      void loadAndSelectThread(tid, false, claimedSequence, focusOwner);
      return;
    }
    const token = deferredThreadSelectionToken;
    cancelSelectionCommit = scheduleThreadSelectionCommit({
      document,
      requestFrame: requestTranscriptAnimationFrame,
      cancelFrame: cancelTranscriptAnimationFrame,
      presented: () => {
        if (token !== deferredThreadSelectionToken) return;
        const transaction = threadSelectionTransaction;
        if (transaction?.value === tid) emitThreadSelectionEvent(transaction, 'intent_presented');
      },
      commit: () => {
        cancelSelectionCommit = undefined;
        if (token !== deferredThreadSelectionToken) return;
        const transaction = threadSelectionTransaction;
        if (transaction?.value === tid) emitThreadSelectionEvent(transaction, 'commit_started');
        void loadAndSelectThread(tid, false, claimedSequence, focusOwner);
        if (transaction?.value === tid && threadSelectionTransaction === transaction) emitThreadSelectionEvent(transaction, 'committed');
      },
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

  const performThreadsRefresh = async (): Promise<boolean> => {
    const refreshSequence = ++threadsRefreshSequence;
    const adapter = props.adapter;
    threadsReadController?.abort();
    const controller = new AbortController();
    threadsReadController = controller;
    setThreadsRefreshing(true);
    setThreadListState('loading');
    setThreadListError('');
    try {
      const next = (await loadFlowerThreadList(adapter, page => {
        if (surfaceDisposed || props.adapter !== adapter || refreshSequence !== threadsRefreshSequence) return;
        setThreadCache(cache => page.reduce((next, thread) => retiredThreadIDs.has(trimString(thread.thread_id)) ? next : next.replaceSummary(thread), cache));
        setThreadListState('ready');
      }, controller.signal)).filter((thread) => !retiredThreadIDs.has(trimString(thread.thread_id)));
      if (surfaceDisposed || props.adapter !== adapter || refreshSequence !== threadsRefreshSequence) {
        return false;
      }
      const selectedID = selectedThreadID();
      const selectedSummary = next.find((thread) => thread.thread_id === selectedID) ?? null;
      const selectedDetailCurrent = !selectedID || threadCache().views.has(selectedID);
      const pendingSelectedMissing = Boolean(selectedID && !selectedSummary && !selectedDetailCurrent && attentionNavigation()?.childThreadID !== selectedID);
      if (pendingSelectedMissing) {
        cancelDeferredThreadSelection();
        cancelThreadSelectionTransaction();
        closeSubagentOverlays();
        setSelectedThreadID('');
      }
      setThreadCache((cache) => cache.replaceSummaries(next));
      setThreadListState('ready');
      const currentSelection = selectedThreadID();
      if (currentSelection && !next.some((thread) => thread.thread_id === currentSelection) && !threadCache().views.has(currentSelection) && attentionNavigation()?.childThreadID !== currentSelection) {
        cancelDeferredThreadSelection();
        cancelThreadSelectionTransaction();
        closeSubagentOverlays();
        setSelectedThreadID('');
      }
      if (effectiveEngagement() && selectedID && selectedSummary && selectedDetailCurrent) {
        void requestThreadDetail(selectedID, 'summary_update');
      }
      return true;
    } catch (error) {
      if (surfaceDisposed || props.adapter !== adapter || controller.signal.aborted || refreshSequence !== threadsRefreshSequence) return false;
      const message = getErrorMessage(error);
      setThreadListState('error');
      setThreadListError(message);
      return false;
    } finally {
      if (threadsReadController === controller) {
        threadsReadController = undefined;
        setThreadsRefreshing(false);
      }
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
  let settingsRefreshRequest: Promise<void> | null = null;
  let settingsRefreshGeneration = 0;
  let settingsReadController: AbortController | undefined;
  const refreshSettingsForRevision = (invalidateInFlight = false): Promise<void> => {
    if (surfaceDisposed) return Promise.resolve();
    if (invalidateInFlight) {
      settingsRefreshGeneration += 1;
      settingsReadController?.abort();
      settingsRefreshRequest = null;
    }
    if (settingsRefreshRequest) return settingsRefreshRequest;
    const generation = settingsRefreshGeneration;
    const adapter = props.adapter;
    const controller = new AbortController();
    settingsReadController = controller;
    const current = () => preferenceAdapterCurrent(adapter) && generation === settingsRefreshGeneration && !controller.signal.aborted;
    setSettingsState({ status: 'loading' });
    const request = withFlowerReadDeadline(signal => adapter.loadSettings(invalidateInFlight, signal), copy().chat.syncTimeout, controller.signal).then(next => {
      if (!current()) return;
      acceptSettingsSnapshot(adapter, next);
      if (next.model_directory) setModelDirectory(next.model_directory);
      setSettingsState({ status: 'ready' });
    }).catch(error => {
      if (!current()) return;
      setSettingsState({ status: 'error', error: error instanceof FlowerReadDeadlineError ? copy().chat.syncTimeout : getErrorMessage(error) || copy().chat.loadErrorTitle });
      throw error;
    }).finally(() => {
      if (settingsRefreshRequest === request) {
        settingsRefreshRequest = null;
        settingsReadController = undefined;
      }
    });
    settingsRefreshRequest = request;
    return request;
  };

  let accountRefresh: Promise<void> | null = null;
  const refreshAccounts = (): Promise<void> => {
    if (accountRefresh) return accountRefresh;
    if (!props.adapter.loadChatGPTAccounts || !snapshot()?.auth_capabilities?.openai_chatgpt.available) return Promise.resolve();
    const adapter = props.adapter;
    const generation = settingsRefreshGeneration;
    const binding = snapshot()?.auth_capabilities?.openai_chatgpt.binding_id;
    const request = props.adapter.loadChatGPTAccounts().then(result => {
      if (preferenceAdapterCurrent(adapter) && generation === settingsRefreshGeneration && snapshot()?.auth_capabilities?.openai_chatgpt.available === true && binding === snapshot()?.auth_capabilities?.openai_chatgpt.binding_id) {
        setSnapshot(previous => {
          if (!previous || JSON.stringify([previous.chatgpt_accounts, previous.saved_chatgpt_accounts, previous.account_sign_outs]) === JSON.stringify([result.accounts, result.saved_accounts, result.account_sign_outs])) return previous;
          return { ...previous, chatgpt_accounts: result.accounts, saved_chatgpt_accounts: result.saved_accounts, account_sign_outs: result.account_sign_outs };
        });
      }
    }).catch(() => undefined).finally(() => { if (accountRefresh === request) accountRefresh = null; });
    accountRefresh = request;
    return request;
  };
  const accountAction: NonNullable<FlowerSurfaceAdapter['chatGPTAuth']> = async (action, input) => {
    if (!props.adapter.chatGPTAuth) throw new Error('Account actions are unavailable.');
    try { return await props.adapter.chatGPTAuth(action, input); }
    finally { if (action !== 'status' && action !== 'start') void refreshAccounts(); }
  };
  const refreshDirectory = () => {
    const adapter = props.adapter;
    const generation = settingsRefreshGeneration;
    return adapter.loadModelDirectory?.(true).then(directory => {
      if (!preferenceAdapterCurrent(adapter) || generation !== settingsRefreshGeneration) return;
      setModelDirectory(directory);
      setSnapshot(previous => previous ? withFlowerModelDirectory(previous, directory) : previous);
    }).catch(() => undefined);
  };
  const loadSurface = async () => {
    if (!props.adapter.connectLiveStream) void refreshThreads();
    void resolveHandlerDecision().catch(() => undefined);
    try { await refreshSettingsForRevision(); } catch {
      // Configuration errors do not gate conversation history or navigation.
    }
    if (!surfaceDisposed) { void refreshDirectory(); void refreshAccounts(); }
  };

  createEffect(on(
    () => props.settingsRevision?.() ?? 0,
    (revision, previousRevision) => {
      if (revision === previousRevision) return;
      if (localPreferenceRefreshesPending > 0) {
        localPreferenceRefreshesPending = 0;
        return;
      }
      void refreshSettingsForRevision(true).then(() => { void refreshAccounts(); return refreshDirectory(); }).catch(() => undefined);
    },
    { defer: true },
  ));

  onMount(() => {
    setThreadRailWidth(loadThreadRailWidth());
    const adapter = props.adapter;
    const unsubscribe = adapter.subscribeModelDirectory?.(directory => { if (preferenceAdapterCurrent(adapter)) { setModelDirectory(directory); setSnapshot(previous => previous ? withFlowerModelDirectory(previous, directory) : previous); } });
    onCleanup(() => unsubscribe?.());
    void loadSurface();
  });

  onCleanup(() => {
    settingsRefreshGeneration += 1;
    threadsReadController?.abort();
    settingsReadController?.abort();
    settingsRefreshRequest = null;
    accountRefresh = null;
    setSettingsSaving(false);
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
        void requestThreadDetail(
          threadID,
          'background_refresh',
        ).then(() => {
            if (
              bootstrapSequence !== engagementBootstrapSequence
              || !foregroundEngagementRequested()
              || sequence !== threadLoadSequence
              || selectedThreadID() !== threadID
              || !!threadLoadError()
            ) return;
            setEngagementBootstrapReady(true);
            schedulePresentedSelection(threadID, sequence);
          });
      });
    },
    { defer: true },
  ));

  createEffect(() => {
    const request = composerFocusRequest();
    if (!request) return;
    if (request.identity !== bottomActionFocusIdentity()
      || (request.restoreCompanion && (presentation() !== 'companion' || surfaceEngaged()))) {
      setComposerFocusRequest(null);
      return;
    }
    if (request.restoreCompanion && !companionCollapsed()) return;
    setComposerFocusRequest(null);
    untrack(() => scheduleComposerFocus(request));
  });

  const applyRuntimeCurrent = (
    current: FlowerRuntimeCurrentView,
    contextUsage?: FlowerLiveStreamEnvelope['context_usage'],
    contextCompactions?: FlowerLiveStreamEnvelope['context_compactions'],
    timelineDecorations?: FlowerLiveStreamEnvelope['timeline_decorations'],
    source: ThreadDetailSource = 'user_action',
    admissionSettings?: TransportOutboxProvisionalThreadSettings,
    modelContext?: FlowerLiveStreamEnvelope['model_context'],
  ): boolean => {
    const threadID = trimString(current.thread_id);
    if (!threadID || retiredThreadIDs.has(threadID)) return false;
    // The current reading subscription owns item membership. A command's
    // latest-page receipt must not replace an older interval underneath it.
    if (source === 'user_action' && current.window && props.adapter.loadHistory && selectedThreadID() === threadID
      && threadCache().views.get(threadID)?.thread.history_window) {
      void requestThreadDetail(threadID, 'user_action', true);
      return false;
    }
    const matchingAdmission = transportOutbox()
      .matchCurrent(current, { canConfirm: canConfirmOutboxEntry })
      .find((entry) => entry.provisionalThreadSettings);
    const provisionalSettings = admissionSettings ?? matchingAdmission?.provisionalThreadSettings;
    const now = Date.now();
    const base = threadCache().views.get(threadID)?.thread ?? threadCache().summaries.get(threadID) ?? {
      thread_id: threadID,
		title: '',
      title_status: 'unset',
      title_generation: 0,
      model_id: selectedComposerModelID(),
      working_dir: draftWorkingDirectory(),
      created_at_ms: now,
      updated_at_ms: 0,
      status: 'idle' as const,
      source_label: props.adapter.runtime.display_name,
      target_labels: [],
      settings_revision: 0,
      messages: [],
      read_status: {
        is_unread: false,
        snapshot: {
          activity_revision: 0,
        },
        read_state: {
          last_seen_activity_revision: 0,
        },
      },
    } satisfies FlowerThreadSnapshot;
    const contextualBase = {
      ...base,
      ...(provisionalSettings ? {
        model_id: provisionalSettings.model_id || base.model_id,
        working_dir: provisionalSettings.working_dir || base.working_dir,
        permission_type: provisionalSettings.permission_type,
        ...(provisionalSettings.reasoning_selection
          ? { reasoning_selection: provisionalSettings.reasoning_selection }
          : {}),
      } : {}),
    };
    try {
      const projected = applyFlowerRuntimeCurrentView(contextualBase, current, {
        model_context: modelContext, context_usage: contextUsage,
        context_compactions: contextCompactions, timeline_decorations: timelineDecorations,
      });
      buildFlowerTimelineEntries(projected);
      const received = receiveThreadDetail({
        thread: projected,
        version: Math.max(1, Math.floor(Number(current.view_version) || 0)),
        contentRevision: threadCache().views.get(threadID)?.contentRevision ?? 0,
      }, source, current, false);
      if (received.runtimeState === 'unchanged') {
        applyThreadContext(threadID, {
          model_context: modelContext, context_usage: contextUsage,
          context_compactions: contextCompactions, timeline_decorations: timelineDecorations,
        });
      }
      if (received.runtimeState === 'accepted' && threadID === selectedThreadID()) {
        for (const operation of contextCompactions ?? []) {
          const prior = base.context_compactions?.find((item) => item.operation_id === operation.operation_id);
          const anchored = timelineDecorations?.some((item) => item.kind === 'context_compaction' && item.compaction.operation_id === operation.operation_id);
          if (operation.status === 'noop' && prior?.status === 'compacting' && !anchored) {
            notifySuccess(compactionDividerDetail(operation, copy()));
          }
        }
      }
      if (
        received.runtimeState === 'accepted'
        && current.turn_kind !== 'context_compaction'
        && current.last_outcome === 'completed'
        && projected.status === 'success'
        && !projected.error
        && !projected.messages.some((message) => (
          message.role === 'assistant'
          && (message.content.trim() !== '' || (message.blocks?.length ?? 0) > 0)
        ))
      ) {
        const summary = threadCache().summaries.get(threadID);
        if (summary) void requestThreadDetail(threadID, 'summary_update');
      }
      return received.runtimeState === 'accepted';
    } catch (error) {
      reportThreadDetailDiagnostic(
        threadID,
        'current_projection',
        source,
        error,
        current.view_version,
      );
      if (threadID === selectedThreadID()) {
        setThreadLoadError(threadDetailUserError(error));
      }
      if (source === 'live_current') throw error;
      return false;
    }
  };

  const applyThreadContext = (threadID: string, context: Parameters<typeof applyFlowerRuntimeContext>[1]) => {
    const base = threadCache().views.get(threadID)?.thread;
    if (!base || retiredThreadIDs.has(threadID)) return;
    const projected = applyFlowerRuntimeContext(base, context);
    buildFlowerTimelineEntries(projected);
    if (projected === base) return;
    setThreadCache(cache => cache.updateDetailAdjuncts(threadID, thread => applyFlowerRuntimeContext(thread, context)));
  };

  const acceptTurnLaunchReceipt = (receipt: FlowerTurnLaunchReceipt): boolean => {
    const requestID = trimString(receipt.client_request_id);
    const threadID = trimString(receipt.thread_id);
    if (!requestID || !threadID) {
      throw flowerTurnAdmissionError(
        'unknown',
        new Error('Flower send returned an invalid acceptance receipt.'),
      );
    }
    const currentOutbox = transportOutbox();
    const entry = currentOutbox.entries.get(requestID);
    if (!entry) return false;
    const requestedThreadID = trimString(entry.input.thread_id);
    if (requestedThreadID && requestedThreadID !== threadID) {
      throw flowerTurnAdmissionError(
        'unknown',
        new Error('Flower send returned a different thread identity.'),
      );
    }
    if (entry.threadId.startsWith(`${PENDING_NEW_THREAD_ID}:`)) embeddedThreads.set(entry.threadId, threadID);
    const handoff = pendingAdmissionHandoffs.get(requestID);
    const transferDraftScope = Boolean(
      handoff
      && isPendingDraftKey(handoff.sessionKey)
      && handoff.selectionSequence === threadLoadSequence
      && !threadCache().selectedId
    );
    if (transferDraftScope) beginThreadDetailDisplayCycle(threadID);
    batch(() => {
      handoff?.settle(threadID, transferDraftScope);
      if (!handoff && entry.presentation === 'composer') consumeSubmittedComposerDraft(entry, threadID);
      pendingAdmissionHandoffs.delete(requestID);
      setTransportOutbox(currentOutbox.bindAcceptedThread(requestID, threadID).put({
        ...entry, threadId: threadID, input: { ...entry.input, thread_id: threadID }, delivery: 'accepted', deliveryError: undefined,
      }));
      outboxDraftRestorers.delete(requestID);
      outboxOperations.delete(requestID);
      if (transferDraftScope) {
        setThreadCache((cache) => cache.select(threadID));
        setThreadLoadError('');
        setSidePanel('chat');
      }
    });
    return true;
  };

  const applyAcceptedTurnLaunchReceipt = (receipt: FlowerTurnLaunchReceipt, requestEpoch: number): void => {
    const entry = transportOutbox().entries.get(trimString(receipt.client_request_id));
    if (receipt.current && requestEpoch === liveTransport.connectionEpoch()) {
      if (entry?.parentThreadId) acceptActiveSubagentCurrent(entry.parentThreadId, receipt.current);
      else applyRuntimeCurrent(
        receipt.current,
        undefined,
        undefined,
        undefined,
        'user_action',
        entry?.provisionalThreadSettings,
      );
    }
    const waitingForCanonicalDetail = acceptTurnLaunchReceipt(receipt);
    const threadID = trimString(receipt.thread_id);
    if (selectedThreadID() === threadID && (waitingForCanonicalDetail
      || threadSettingsRevision(threadCache().views.get(threadID)?.thread) === 0)) {
      void requestThreadDetail(
        threadID,
        'user_action',
        true,
      );
    }
  };

  // One ordered transport owner per thread. A current confirmation can release
  // the next request before a slow HTTP response returns; unknown outcomes pause
  // only their originating thread until the user retries the same identity.
  createEffect(() => {
    outboxRetryTick();
    const retainedIDs = new Set(transportOutbox().entries.keys());
    for (const requestID of pendingAdmissionHandoffs.keys()) if (!retainedIDs.has(requestID)) pendingAdmissionHandoffs.delete(requestID);
    for (const requestID of outboxDraftRestorers.keys()) if (!retainedIDs.has(requestID)) outboxDraftRestorers.delete(requestID);
    for (const requestID of outboxOperations.keys()) if (!retainedIDs.has(requestID)) outboxOperations.delete(requestID);
    for (const requestID of outboxResendInFlight) if (!retainedIDs.has(requestID)) outboxResendInFlight.delete(requestID);
    if (surfaceDisposed) return;
    const blockedThreads = new Set<string>();
    const activeThreads = new Set([...transportOutbox().entries.values()].filter(entry => outboxResendInFlight.has(entry.requestId) && entry.delivery !== 'accepted').map(entry => entry.threadId));
    for (const entry of transportOutbox().entries.values()) {
      if (entry.delivery === 'failed' || entry.delivery === 'accepted') continue;
      if (blockedThreads.has(entry.threadId)) continue;
      if (entry.terminalError) {
        if (entry.delivery === 'unknown') blockedThreads.add(entry.threadId);
        continue;
      }
      blockedThreads.add(entry.threadId);
      if (entry.operation === 'context_compaction' && !props.adapter.compactThreadContext) continue;
      if (entry.operation === 'goal' && !props.adapter.manageGoal) {
        if (entry.delivery !== 'unknown') setTransportOutbox(outbox => outbox.put({ ...entry, delivery: 'failed', deliveryError: copy().chat.goalUnavailable }));
        continue;
      }
      if (!entry.operation && !props.adapter.launchTurn) continue;
      if ((entry.input.attachment_ids?.length ?? 0) > 0 && !trimString(entry.input.staging_scope?.capability)) continue;
      if (isPendingDraftKey(entry.threadId) && !pendingAdmissionHandoffs.has(entry.requestId)) {
        pendingAdmissionHandoffs.set(entry.requestId, {
          sessionKey: entry.threadId,
          selectionSequence: entry.threadId === pendingDraftKey() ? threadLoadSequence : -1,
          settle: canonicalThreadID => {
            if (entry.operation === 'goal') draftCoordinator.moveScope(entry.threadId, canonicalThreadID);
          },
        });
      }
      if (entry.delivery === 'unknown' || activeThreads.has(entry.threadId)) continue;
      outboxResendInFlight.add(entry.requestId);
      setOutboxRetryTick(tick => tick + 1);
      const operation = outboxOperations.get(entry.requestId);
      const adapter = operation?.adapter ?? props.adapter;
      const requestEpoch = liveTransport.connectionEpoch();
      const dispatch = async () => {
        try {
          await transportOutbox().flushPersistence();
        } catch (error) {
          throw flowerTurnAdmissionError('not_sent', error);
        }
        if (surfaceDisposed || !transportOutbox().entries.has(entry.requestId)) return;
        let input = transportOutbox().entries.get(entry.requestId)!.input;
        if (entry.preparation === 'pending') {
          if (!operation?.prepare) throw flowerTurnAdmissionError('not_sent', new Error('Submission preparation is unavailable.'));
          try { input = await operation.prepare(); }
          catch (error) { throw flowerTurnAdmissionError('not_sent', error); }
          const retained = transportOutbox().entries.get(entry.requestId);
          if (surfaceDisposed || !retained) return;
          // A provisional thread may have been bound while this request waited.
          input = { ...input, thread_id: retained.input.thread_id ?? input.thread_id,
            ...(retained.input.thread_id ? { decision: null } : {}) };
          setTransportOutbox(outbox => outbox.put({ ...retained, input, preparation: undefined }));
          try { await transportOutbox().flushPersistence(); }
          catch (error) { throw flowerTurnAdmissionError('not_sent', error); }
          if (surfaceDisposed || !transportOutbox().entries.has(entry.requestId)) return;
        }
        if (entry.operation === 'goal') {
          if (!entry.goalInput) throw flowerTurnAdmissionError('not_sent', new Error('Goal request is unavailable.'));
          const result = await withFlowerRequestDeadline(() => adapter.manageGoal!(entry.goalInput!), copy().settings.dialog.catalog.retryTimedOut);
          if (!surfaceDisposed) acceptGoalResult(entry, result, requestEpoch);
          return;
        }
        const receipt = entry.operation === 'context_compaction'
          ? await withFlowerRequestDeadline(() => adapter.compactThreadContext!(entry.threadId, { storage_generation: entry.input.storage_generation ?? '', client_request_id: entry.requestId, continue_goal: entry.continueGoal === true }), copy().settings.dialog.catalog.retryTimedOut).then(current => ({ client_request_id: entry.requestId, thread_id: entry.threadId, current }))
          : await adapter.launchTurn!(input);
        if (surfaceDisposed) return;
        if (trimString(receipt.client_request_id) !== entry.requestId) {
          throw flowerTurnAdmissionError('unknown', new Error('Flower send returned a different client request identity.'));
        }
        if (entry.operation === 'context_compaction') {
          pendingAdmissionHandoffs.get(entry.requestId)?.settle(receipt.thread_id, false);
          pendingAdmissionHandoffs.delete(entry.requestId);
          if (receipt.current?.thread_id !== entry.threadId) throw flowerTurnAdmissionError('unknown', new Error('Context recovery returned a different thread.'));
          if (requestEpoch === liveTransport.connectionEpoch()) {
            applyRuntimeCurrent(receipt.current);
            if (entry.parentThreadId) acceptActiveSubagentCurrent(entry.parentThreadId, receipt.current);
          }
          setTransportOutbox(outbox => outbox.drop(entry.requestId));
        } else applyAcceptedTurnLaunchReceipt(receipt, requestEpoch);
      };
      void dispatch().catch(error => {
        if (surfaceDisposed) return;
        const retained = transportOutbox().entries.get(entry.requestId);
        // A canonical confirmation wins over a late transport error.
        if (!retained || retained.delivery === 'accepted') return;
        const failure = error as FlowerTurnLaunchFailure;
        if (failure.fresh_decision) setHandlerState(handlerStateFromDecision(failure.fresh_decision));
        if (error && typeof error === 'object' && error.code === 'AI_STORAGE_RESTORED') {
          pendingAdmissionHandoffs.delete(entry.requestId);
          setTransportOutbox(outbox => outbox.put({ ...retained, terminalError: 'storage_restored', delivery: 'failed', deliveryError: getErrorMessage(error) }));
          return;
        }
        const unknown = error instanceof FlowerRequestDeadlineError || flowerTurnAdmissionFailureKind(error) === 'unknown';
        if (entry.operation === 'context_compaction') {
          const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
          notifyComposerError(code === 'context_compaction_busy' ? copy().chat.compactContextBusy : getErrorMessage(error));
          if (!unknown) {
            pendingAdmissionHandoffs.delete(entry.requestId);
            setTransportOutbox(outbox => outbox.drop(entry.requestId));
            return;
          }
        }
        if (!unknown && entry.presentation !== 'composer' && entry.draftReferences?.some(reference => reference.kind === 'thread')) outboxDraftRestorers.get(entry.requestId)?.();
        setTransportOutbox(outbox => outbox.put({ ...retained, delivery: unknown ? 'unknown' : 'failed', deliveryError: getErrorMessage(error) }));
        if (retained.parentThreadId) {
          if (activeSubagentID() === retained.threadId) void refreshActiveSubagentDetail();
        } else if (!isPendingDraftKey(retained.threadId)) void requestThreadDetail(retained.threadId, 'background_refresh', true).catch(() => undefined);
      }).finally(() => {
        outboxResendInFlight.delete(entry.requestId);
        if (!surfaceDisposed) setOutboxRetryTick(tick => tick + 1);
      });
    }
  });

  const applyFlowerLiveStreamEnvelope = (envelope: FlowerLiveStreamEnvelope): void => {
    if (envelope.reading_revision !== undefined && envelope.reading_revision !== historyReadingRevision) return;
    if (envelope.facts_only) {
      const update = envelope.update;
      if (!update || retiredThreadIDs.has(update.thread_id)
        || (threadCache().views.get(update.thread_id)?.version ?? 0) >= update.view_version) return;
      const facts = update.facts;
      const status: FlowerThreadSnapshot['status'] = facts.attention?.input_count ? 'waiting_user'
        : facts.attention?.approval_count ? 'waiting_approval' : facts.activity === 'active' ? 'running'
          : facts.last_outcome === 'failed' || facts.last_outcome === 'interrupted' ? 'failed'
            : facts.last_outcome === 'cancelled' ? 'canceled' : facts.last_outcome === 'completed' ? 'success' : 'idle';
      setThreadCache(cache => cache.updateSummaryAdjuncts(update.thread_id, summary => ({ ...summary,
        status, active_run_id: facts.activity === 'active' ? update.run_id : undefined,
        approval_pending: Boolean(facts.attention?.approval_count), approval_pending_count: facts.attention?.approval_count ?? 0,
        queued_turn_count: facts.queue_count,
      })));
      return;
    }
    const update = envelope.update ?? envelope.subagent_update;
    if (update && !retiredThreadIDs.has(update.thread_id)) {
      batch(() => {
        const received = threadCache().receiveUpdate(update);
        const observation = received.observation ?? {
          ...update.facts, thread_id: update.thread_id, turn_id: update.turn_id, run_id: update.run_id, view_version: update.view_version,
          items: update.items?.flatMap(change => change.item ? [change.item] : []),
          queue: update.queue?.value ?? [], interactions: update.interactions?.value ?? [],
          turns: update.turns?.value ?? [], goal: update.goal?.value ?? undefined,
        };
        const nextCache = reconcileRuntimeObservation(observation, received.cache, update.thread_id);
        setThreadCache(nextCache);
        if (received.accepted && received.observation) {
          const retained = received.cache.views.get(update.thread_id)?.thread;
          if (retained) reconcileInputDraft(update.thread_id, retained.input_request);
          if (retained?.cancellation || retained && !flowerThreadHasActiveTurnEvidence(retained)) updateThreadIDMembership(setUnconfirmedStops, update.thread_id, false);
          if (update.thread_id === selectedThreadID()) {
            setThreadLoadError(''); setTranscriptLayoutRevision(revision => revision + 1);
          }
          const observation = companionRunTracker.observe(received.observation);
          if (observation.changed) { setCompanionRunReceipt(observation.terminalTransition); setCompanionRunRevision(revision => revision + 1); }
        }
      });
      return;
    }
    if (envelope.kind === 'model_directory.changed') { void refreshDirectory(); void refreshAccounts(); return; }
    if (envelope.kind === 'computer.frame') {
      const frame = envelope.computer_frame;
      if (envelope.thread_id !== selectedThreadID() || !frame || frame.session_id !== computerObserverID()
        || frame.target_id !== selectedComputerStage()?.targetID || !computerViewerKey()
        || frame.viewer_revision !== activeComputerViewerRevision()) return;
      if (frame.error_code) { batch(() => { setComputerViewerAssistance(frame.error_code === 'computer_control_required' ? frame.assistance_kind || 'inspection' : undefined); setComputerLiveFrame(undefined); setComputerViewFailed(true); }); return; }
      const previous = computerLiveFrame()?.computer_frame;
      if (previous?.session_id === frame.session_id && previous.sequence >= frame.sequence) return;
      setComputerLiveFrame(envelope);
      computerLastFrameAt = Date.now();
      computerRateFrames++;
      const elapsed = Date.now() - computerRateWindow;
      if (elapsed >= 1000) { setReceivedComputerFPS(Math.round(computerRateFrames * 10000 / elapsed) / 10); computerRateWindow = Date.now(); computerRateFrames = 0; }
      return;
    }
    if (envelope.kind === 'computer.status') {
      const status = envelope.computer_status;
      if (!status || envelope.thread_id !== status.thread_id || status.thread_id !== selectedThreadID() || status.interaction_id !== selectedInputRequest()?.prompt_id
        || status.target_id !== selectedComputerStage()?.targetID) return;
      const previous = computerResourceStatus();
      if (previous && previous.thread_id === status.thread_id && previous.interaction_id === status.interaction_id
        && previous.target_id === status.target_id && previous.at_unix_ms > status.at_unix_ms) return;
      setComputerResourceStatus(status);
      if (status.state === 'unavailable') {
        setComputerControlDisconnected(true);
        setComputerControlReady(false);
        computerInputGeneration++; queuedComputerText = undefined;
      } else if (status.state === 'available' || status.state === 'changed') {
        setComputerControlDisconnected(false);
        setComputerControlReady(false);
      }
      return;
    }
    if (envelope.kind === 'ready') { setComputerObserverID(envelope.observer_id ?? ''); setComputerLiveFrame(undefined); }
    if (envelope.kind === 'ready' || envelope.kind === 'summary.batch') {
      if (envelope.kind === 'ready') { flowerLiveReadyCount += 1; readSync.setAvailable(readSyncOnline(), true); }
      const selectedID = selectedThreadID();
      const incoming = (envelope.summaries ?? [])
        .filter((summary) => !retiredThreadIDs.has(summary.thread_id));
      setThreadCache(cache => flowerBaseline.apply(cache, envelope, incoming));
      setThreadListState('ready');
      setThreadListError('');
      if (envelope.baseline_complete === true && selectedID && !threadCache().selectedId) {
        closeSubagentOverlays();
        setSelectedThreadID('');
      }
      if (selectedID) {
        void requestThreadDetail(selectedID, 'summary_update', envelope.kind === 'ready');
      }
      if (envelope.kind === 'ready') {
        for (const threadID of unconfirmedStops()) {
          if (threadID !== selectedID) { void requestThreadDetail(threadID, 'user_action', true, true); }
        }
      }
      if (envelope.kind === 'ready' && flowerLiveReadyCount > 1 && activeSubagentDetail()) {
        void refreshActiveSubagentDetail();
      }
      return;
    }
    if (envelope.kind === 'thread.batch' && envelope.subagents !== undefined) {
      const parentThreadID = trimString(envelope.thread_id);
      if (parentThreadID && !retiredThreadIDs.has(parentThreadID)) {
        const subagents = envelope.subagents;
        setThreadCache((cache) => cache.updateDetailAdjuncts(parentThreadID, (thread) => ({
          ...thread,
          subagents,
        })));
      }
    }
    if (envelope.kind === 'thread.batch' && envelope.subagent_current) {
      const parentThreadID = trimString(envelope.thread_id);
      acceptActiveSubagentCurrent(parentThreadID, envelope.subagent_current, undefined, envelope.model_context, envelope.context_usage, envelope.context_compactions, envelope.timeline_decorations);
      const navigation = attentionNavigation();
      if (navigation?.parentThreadID === parentThreadID && navigation.childThreadID === selectedThreadID() && navigation.childThreadID === envelope.subagent_current.thread_id) {
        applyRuntimeCurrent(envelope.subagent_current, envelope.context_usage, envelope.context_compactions, envelope.timeline_decorations, 'live_current', undefined, envelope.model_context);
      }
      return;
    }
    if (envelope.current) {
      const accepted = applyRuntimeCurrent(
        envelope.window ? { ...envelope.current, window: envelope.window } : envelope.current,
        envelope.context_usage,
        envelope.context_compactions,
        envelope.timeline_decorations,
        'live_current',
        undefined,
        envelope.model_context,
      );
      if (accepted && envelope.kind === 'thread.batch') {
        const observation = companionRunTracker.observe(envelope.current);
        if (observation.changed) {
          setCompanionRunReceipt(observation.terminalTransition);
          setCompanionRunRevision((revision) => revision + 1);
        }
      }
      return;
    }
    if (envelope.kind === 'thread.batch') {
      applyThreadContext(trimString(envelope.thread_id), envelope);
    }
    if (envelope.kind === 'viewer.read_state') {
      const threadID = trimString(envelope.thread_id);
      if (threadID && envelope.read_status && !retiredThreadIDs.has(threadID)) {
        applyThreadReadStatus(threadID, envelope.read_status);
      }
    }
  };

  createEffect(() => {
    const connect = props.adapter.connectLiveStream;
    const keepLiveWhenHidden = props.adapter.keepLiveWhenHidden === true;
    // Desktop owns one workspace stream for the lifetime of the surface. Do
    // not subscribe this effect to document visibility when the transport is
    // explicitly allowed to remain live in the background.
    const visible = keepLiveWhenHidden ? true : documentVisible();
    if (!connect || (!visible && !keepLiveWhenHidden)) return;
    const frames = createFlowerLiveFrameQueue({
      batch,
      apply: (envelope, epoch) => {
        if (epoch === liveTransport.connectionEpoch()) applyFlowerLiveStreamEnvelope(envelope);
      },
      onError: (error, epoch) => liveTransport.fail(error, epoch),
      connectionEpoch: liveTransport.connectionEpoch,
      requestFrame: requestTranscriptAnimationFrame,
      cancelFrame: cancelTranscriptAnimationFrame,
      interaction: { root: document.documentElement, attribute: FLOE_HOT_INTERACTION_ATTR },

    });
    const stop = liveTransport.start({
      connect,
      onCurrent: frames.push,
      isReady: envelope => envelope.kind === 'ready',
      onState: setLiveSyncState,
      onBoundary: () => {
        frames.boundary();
        flowerBaseline.reset();
        releaseNavigationReads();
        referenceReadController?.abort();
        detailLoader.reset();
        subagentDetailReadController?.abort();
        setThreadCache(cache => cache.invalidateRuntimeVersions());
        if (untrack(privateControlRequested)) setComputerControlDisconnected(true);
        computerInputGeneration++; queuedComputerText = undefined;
        setComputerResponseSubmitting(false); setComputerResponseCommitting(false);
        setComputerControlReady(false);
        setActiveComputerViewerRevision(++computerViewerRevision);
        setComputerObserverID(''); setComputerLiveFrame(undefined);
      },
      onTerminalError: error => {
        const failure = error as { name?: unknown; code?: unknown; status?: unknown } | null;
        // Never log payloads, credentials or arbitrary server error messages.
        console.error('Flower live synchronization stopped.', {
          connection_epoch: liveTransport.connectionEpoch(),
          error_name: typeof failure?.name === 'string' ? failure.name.slice(0, 80) : 'Error',
          error_code: typeof failure?.code === 'string' ? failure.code.slice(0, 80) : 'unclassified',
          http_status: Number(failure?.status) || 0,
        });
      },
    });
    onCleanup(() => { frames.dispose(); stop(); });
  });


  createEffect(() => {
    if (selectedThreadID()) return;
    untrack(() => {
      if (!historyReadingThreadID || !computerObserverID() || !props.adapter.loadHistory) return;
      historyReadingThreadID = ''; historyReadingInput = {}; historyReadingRevision++;
      liveTransport.restart();
    });
  });

  createEffect(() => {
    const threadID = selectedThreadID();
    const detail = threadCache().views.get(threadID);
    if (detail && !selectedThreadDetailPending()) reconcileInputDraft(threadID, detail.thread.input_request);
  });

  const saveSettingsMutation = async (mutation: () => Promise<FlowerSettingsSnapshot>) => {
    if (!settingsReady() || surfaceReadOnly() || settingsSaving()) throw new DOMException('Flower settings are unavailable.', 'NotAllowedError');
    setSaveError('');
    setSettingsSaving(true);
    const adapter = props.adapter;
    const generation = settingsRefreshGeneration;
    const current = () => preferenceAdapterCurrent(adapter) && generation === settingsRefreshGeneration;
    try {
      const next = await withFlowerRequestDeadline(mutation, copy().settings.dialog.catalog.settingsSaveTimedOut);
      if (!current()) return next;
      acceptSettingsSnapshot(adapter, next);
      if (next.model_directory) setModelDirectory(next.model_directory);
      void refreshDirectory();
      setSavedAt(Date.now());
      return next;
    } catch (error) {
      const message = getErrorMessage(error);
      if (current()) setSaveError(message);
      throw error;
    } finally {
      if (preferenceAdapterCurrent(adapter)) setSettingsSaving(false);
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

  const saveComputerUseEnabled = (enabled: boolean) => (
    props.adapter.saveComputerUseEnabled
      ? saveSettingsMutation(() => props.adapter.saveComputerUseEnabled!(enabled))
      : Promise.reject(new Error('Computer use settings are unavailable.'))
  );

  const saveAutoUpdateModelCatalog = (enabled: boolean) => (
    props.adapter.saveAutoUpdateModelCatalog
      ? saveSettingsMutation(() => props.adapter.saveAutoUpdateModelCatalog!(enabled))
      : Promise.reject(new Error('Automatic model-list updates are unavailable.'))
  );

  const saveModelProfile = (draft: FlowerSettingsDraft) => (
    saveSettingsMutation(() => props.adapter.saveModelProfile(draft))
  );

  const returnToChat = () => {
    setSidePanel('chat');
    setProviderFocusRequest(undefined);
  };

  const [providerFocusRequest, setProviderFocusRequest] = createSignal<{ providerID: string; modelName: string; sequence: number; threadID: string }>();
  const [retryingThreads, setRetryingThreads] = createSignal<ReadonlySet<string>>(new Set());
  createEffect(() => {
    const request = providerFocusRequest();
    if (request && request.threadID !== trimString(selectedThreadID())) setProviderFocusRequest(undefined);
  });
  let providerFocusSequence = 0;
  const [configuringProviderThreadID, setConfiguringProviderThreadID] = createSignal('');
  const configureThreadProvider = async (target: FlowerThreadSnapshot | null | undefined) => {
    const threadID = trimString(target?.thread_id);
    if (!threadID || props.adapter.canMutate === false || configuringProviderThreadID() === threadID) return;
    const sequence = ++providerFocusSequence;
    const requestEpoch = liveTransport.connectionEpoch();
    setConfiguringProviderThreadID(threadID);
    setProviderFocusRequest(undefined);
    try {
      let selectionSequence = threadLoadSequence;
      const stillTargeted = () => !surfaceDisposed && sequence === providerFocusSequence
        && props.adapter.canMutate !== false
        && requestEpoch === liveTransport.connectionEpoch() && selectionSequence === threadLoadSequence
        && threadID === trimString(selectedThreadID());
      const child = activeSubagentDetail();
      if (child?.childThreadID === threadID) {
        setAttentionNavigation({ parentThreadID: child.parentThreadID, childThreadID: threadID });
        const loading = loadAndSelectThread(threadID);
        selectionSequence = threadLoadSequence;
        await loading;
        if (!stillTargeted()) return;
        // Subagent streams contain runtime facts, not editable product settings.
        await requestThreadDetail(threadID, 'user_action', true);
      }
      if (!stillTargeted()) return;
      const current = threadCache().views.get(threadID)?.thread;
      if (!current) return;
      const modelID = trimString(current.model_id) || selectedComposerModelID();
      const slash = modelID.indexOf('/');
      const request = { providerID: slash > 0 ? modelID.slice(0, slash) : '', modelName: slash > 0 ? modelID.slice(slash + 1) : '', threadID, sequence };
      await readDetail(openSettings);
      if (stillTargeted() && sidePanel() === 'settings') setProviderFocusRequest(request);
    } catch (error) {
      if (!surfaceDisposed && sequence === providerFocusSequence && requestEpoch === liveTransport.connectionEpoch()
        && threadID === trimString(selectedThreadID())) notifyThreadActionError(getErrorMessage(error));
    } finally {
      if (sequence === providerFocusSequence) setConfiguringProviderThreadID('');
    }
  };

  const openSettings = () => {
    if (sidePanel() !== 'settings') settingsRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setThreadNavigationOpen(false);
    closeSubagentOverlays();
    setSidePanel('settings');
    setSettingsOpened(true);
    return (settingsRefreshRequest ?? refreshSettingsForRevision(true)).catch(() => undefined);
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
      await props.adapter.recoverModelSource?.();
      const [directory] = await Promise.all([
        props.adapter.loadModelDirectory?.(true),
        settingsError() ? refreshSettingsForRevision() : undefined,
      ]);
      if (directory && !surfaceDisposed) setModelDirectory(directory);
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
    Array.from(subagentDropdownRef?.querySelectorAll<HTMLButtonElement>('button[data-flower-subagent-row], button[data-flower-subagent-disclosure]') ?? [])
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
    if (!subagentDropdownOpen()) setSettledSubagentsExpanded(false);
    updateSubagentDropdownPosition();
    setSubagentDropdownOpen((open) => !open);
  };

  const subagentSummaryFromItem = (parentThreadID: string, item: FlowerSubagentPanelItem): FlowerSubagentSummary => {
    const childThreadID = trimString(item.threadID);
    const canonical = selectedThread()?.subagents?.find((summary) => (
      trimString(summary.parent_thread_id) === parentThreadID
      && trimString(summary.thread_id) === childThreadID
    ));
    if (canonical) return canonical;
    return {
      parent_thread_id: parentThreadID,
      thread_id: childThreadID,
      title: '', title_status: 'unset', title_generation: 0,
      task_name: trimString(item.taskName) || trimString(item.title),
      task_description: trimString(item.taskDescription),
      status: item.status,
      can_send_input: false,
      can_interrupt: false,
      can_close: false,
      created_at_ms: item.createdAtMs,
      updated_at_ms: item.updatedAtMs,
    };
  };

  const acceptActiveSubagentCurrent = (
    parentThreadID: string,
    current: FlowerSubagentDetail['current'],
    summary?: FlowerSubagentSummary,
    modelContext?: FlowerLiveStreamEnvelope['model_context'],
    contextUsage?: FlowerLiveStreamEnvelope['context_usage'],
    contextCompactions?: FlowerLiveStreamEnvelope['context_compactions'],
    timelineDecorations?: FlowerLiveStreamEnvelope['timeline_decorations'],
  ): boolean => {
    const childThreadID = trimString(current.thread_id);
    const viewVersion = Math.max(0, Math.floor(Number(current.view_version) || 0));
    if (!parentThreadID || !childThreadID || !viewVersion) return false;
    const selected = untrack(activeSubagentDetail);
    if (!selected || selected.parentThreadID !== parentThreadID || selected.childThreadID !== childThreadID) return false;
    const nextSummary = summary
      && trimString(summary.parent_thread_id) === parentThreadID
      && trimString(summary.thread_id) === childThreadID
      ? summary
      : selected.summary ?? subagentSummaryFromItem(parentThreadID, selected.item);
    const projected = projectSubagentDetailThread({ summary: nextSummary, current }, untrack(subagentDetailThread), {
      model_context: modelContext, context_usage: contextUsage,
      context_compactions: contextCompactions, timeline_decorations: timelineDecorations,
    });
    if (!projected) {
      throw new Error('Subagent current view is invalid.');
    }
    buildFlowerTimelineEntries(projected);
    const cached = threadCache().views.get(childThreadID);
    if (cached?.version && viewVersion < cached.version) return false;
    const result = receiveThreadDetail({ thread: projected, version: viewVersion }, 'live_current', current);
    if (cached?.version === viewVersion) {
      // Context supplements have independent acceptance at the same actor
      // version, exactly as the selected root detail does.
      const context = { model_context: modelContext, context_usage: contextUsage,
        context_compactions: contextCompactions, timeline_decorations: timelineDecorations };
      setThreadCache(cache => cache.updateDetailAdjuncts(childThreadID,
        thread => applyFlowerRuntimeContext(thread as FlowerThreadSnapshot, context)));
    }
    if (!threadCache().views.has(childThreadID)) {
      const error = new Error('Subagent detail did not remain available after receipt.');
      reportThreadDetailDiagnostic(childThreadID, 'detail_not_converged', 'live_current', error, viewVersion, result);
      throw error;
    }
    const accepted = result.state === 'accepted';
    setActiveSubagentDetail(active => !active || active.parentThreadID !== parentThreadID || active.childThreadID !== childThreadID ? active : {
      ...active, summary: nextSummary, connectionEpoch: liveTransport.connectionEpoch(), error: '',
    });
    if (accepted) {
      subagentDetailScroll.measureAfterLayout();
    }
    return accepted;
  };

  const refreshActiveSubagentDetail = async (scrollToBottom = false): Promise<void> => {
    const active = untrack(activeSubagentDetail);
    if (!active) return;
    subagentDetailReadController?.abort();
    const readController = new AbortController();
    subagentDetailReadController = readController;
    const requestEpoch = liveTransport.connectionEpoch();
    const generation = ++subagentDetailGeneration;
    const request = { ...active, generation, requestStatus: 'loading' as const, error: '' };
    setActiveSubagentDetail(request);
    const releaseRead = threadCache().beginRuntimeRead(request.childThreadID);
    try {
      const detail = await readDetail(() => props.adapter.loadSubagentDetail(request.parentThreadID, request.childThreadID), readController.signal);
      const parentThreadID = trimString(detail.summary.parent_thread_id);
      const childThreadID = trimString(detail.summary.thread_id);
      if (
        parentThreadID !== request.parentThreadID
        || childThreadID !== request.childThreadID
        || trimString(detail.current.thread_id) !== request.childThreadID
      ) {
        throw new Error('Subagent detail identity does not match the selected thread.');
      }
      try {
        if (!projectSubagentDetailThread(detail)) throw new Error();
      } catch {
        throw new Error('Subagent detail is invalid.');
      }
      const current = untrack(activeSubagentDetail);
      if (!current || current.generation !== generation || requestEpoch !== liveTransport.connectionEpoch()) return;
      acceptActiveSubagentCurrent(request.parentThreadID, detail.current, detail.summary, detail.model_context, detail.context_usage, detail.context_compactions, detail.timeline_decorations);
      setActiveSubagentDetail((latest) => (
        latest?.generation === generation ? { ...latest, requestStatus: 'idle', error: '' } : latest
      ));
      if (scrollToBottom) {
        requestTranscriptAnimationFrame(() => subagentDetailScroll.scrollToBottom({ smooth: false }));
      }
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'flower_live_sync_error') liveTransport.fail(error, requestEpoch);
      setActiveSubagentDetail((current) => (
        current?.generation === generation
          ? { ...current, requestStatus: 'idle', error: readController.signal.aborted ? '' : threadDetailUserError(error) }
          : current
      ));
    } finally { releaseRead(); }
  };

  const operateSubagentInput = async (action: SubagentInputAction, itemID: string, fingerprint?: string): Promise<void> => {
    const selected = untrack(activeSubagentDetail);
    const operate = props.adapter.operateSubagentInput;
    if (!selected || !operate || props.adapter.canMutate === false) return;
    const key = subagentInputKey(itemID);
    const previous = subagentInputCommands()[key];
    if (previous?.busy) return;
    const requestID = previous?.action === action && previous.fingerprint === fingerprint ? previous.requestID : createFlowerClientRequestID();
    const command: SubagentInputCommand = { busy: true, error: '', action, requestID, fingerprint };
    const epoch = liveTransport.connectionEpoch();
    const stillSelected = () => {
      const active = untrack(activeSubagentDetail);
      return active?.parentThreadID === selected.parentThreadID && active.childThreadID === selected.childThreadID
        && active.generation === selected.generation && epoch === liveTransport.connectionEpoch();
    };
    setSubagentInputCommands((commands) => ({ ...commands, [key]: command }));
    try {
      const detail = await readDetail(() => operate(selected.parentThreadID, selected.childThreadID, {
        action, item_id: itemID, client_request_id: requestID,
        ...(fingerprint ? { expected_input_fingerprint: fingerprint } : {}),
      }));
      if (!stillSelected()) return;
      if (detail.summary.parent_thread_id !== selected.parentThreadID || detail.summary.thread_id !== selected.childThreadID
        || detail.current.thread_id !== selected.childThreadID) throw new Error('Subagent input response identity mismatch.');
      acceptActiveSubagentCurrent(selected.parentThreadID, detail.current, detail.summary, detail.model_context, detail.context_usage, detail.context_compactions, detail.timeline_decorations);
      setSubagentInputCommands((commands) => { const next = { ...commands }; delete next[key]; return next; });
    } catch (error) {
      if (!stillSelected()) return;
      const code = (error as { code?: string })?.code;
      const text = code === 'subagent_input_busy' ? subagentsCopy().input.busy
        : code === 'subagent_input_conflict' ? subagentsCopy().input.changed : subagentsCopy().input.failed;
      setSubagentInputCommands((commands) => ({ ...commands, [key]: { ...command, busy: false, error: text } }));
      void refreshActiveSubagentDetail();
    } finally {
      setSubagentInputCommands((commands) => commands[key] === command
        ? { ...commands, [key]: { ...command, busy: false } } : commands);
    }
  };

  const openSubagentDetail = (item: FlowerSubagentPanelItem) => {
    const parentID = trimString(selectedThread()?.thread_id);
    const childID = trimString(item.threadID);
    if (!parentID || item.parentThreadID !== parentID || !selectedSubagentItems().some(child => child.parentThreadID === parentID && child.threadID === childID)) return;
    subagentDetailGeneration += 1;
    setSubagentInputCommands({});
    resetSubagentDetailScroll();
    setActiveSubagentDetail({
      parentThreadID: parentID,
      childThreadID: childID,
      item,
      generation: subagentDetailGeneration,
      requestStatus: 'idle',
      summary: null,
      error: '',
    });
    setSubagentDropdownOpen(false);
    void refreshActiveSubagentDetail(true);
  };

  const launchChatTurn = async (promptInput: string) => {
    if (pendingThreadSelection()) return;
    // Preserve focus ownership while preparing this immutable submission.
    const focusOwner = typeof document === 'undefined' ? null : document.activeElement;
    const focusSelectionSequence = threadLoadSequence;
    const inspection = inspectFlowerText(promptInput);
    if (!inspection) {
      notifyComposerError(attachmentCopy().invalidText);
      return;
    }
    if (!settingsReady()) {
      notifyComposerError(settingsError() || copy().chat.loadingSettings);
      return;
    }
    if (!readyForChat()) {
      notifyComposerError(selectedModelNeedsAttention() ? selectedModelAvailabilityMessage() : copy().chat.configureProviderBeforeChat);
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
      : 'ordinary' as const;
    const selectedID = trimString(selectedThreadID());
    const frozenContextAction = operation.session.snapshot().value.omit_embedded_context ? undefined : (props.embeddedConversation?.contextAction
      ?? (!selectedID ? props.embeddedConversation?.initialContextAction : undefined));
    const notifyEmbeddedAccepted = props.embeddedConversation?.onAccepted;
    const launchAdapter = props.adapter;
    const capturedDecision = currentHandlerDecision();
    const presentation: 'composer' | 'queue' = selectedThreadHasActiveTurnEvidence()
      || visibleTransportOutbox().some(entry => entry.delivery !== 'failed' && !entry.terminalError) ? 'queue' : 'composer';
    const frozenModelID = selectedComposerModelID();
    const frozenPermissionType = composerPermissionType();
    const frozenReasoningSelection = serializeFlowerReasoningSelection(composerLaunchReasoningSelection());
    const frozenWorkingDir = displayedWorkingDirectory();
    if (!selectedID && workingDirectoryPickerAvailable() && !frozenWorkingDir) {
      const failure = workingDirectoryDefaults()?.error;
      notifyComposerError(workingDirectoryDefaults.loading
        ? copy().filesystemPicker.loading
        : failure ? formatFilesystemPickerError(failure, copy().filesystemPicker) : copy().filesystemPicker.unavailableContext);
      return;
    }
    const frozenDisplayedWorkingDir = displayedWorkingDirectory();
    const frozenCapabilityRevision = currentAttachmentSnapshot().capability?.revision;
    const operationClaim = operation.session.mutate((value) => (
      value.client_request_id && value.client_request_id !== clientRequestID
        ? value
        : {
          ...value,
          text: promptInput,
          mode: operationMode,
          client_request_id: clientRequestID,
          model_id: frozenModelID,
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
    props.embeddedConversation?.onSubmit?.();
    const launchController = operation.controller;
    const launchSessionKey = operation.sessionKey;
    const scopeBinding = [...pendingAdmissionHandoffs.values()].find(handoff => handoff.sessionKey === launchSessionKey)?.scopeBinding ?? { transferred: false };
    const submissionScopeKey = () => scopeBinding.transferred && scopeBinding.threadID ? scopeBinding.threadID : launchSessionKey;
    const submissionSession = () => submissionScopeKey() === launchSessionKey ? operation.session : draftSessionFor(submissionScopeKey());
    const frozenDraft = operationClaim.snapshot.value;
    const frozenTextRevision = operationClaim.snapshot.text_revision;
    const frozenDraftAttachmentLocalIDs = new Set(frozenDraft.attachments.map((item) => item.local_id));
    const frozenAttachmentLocalIDs = new Set(
      launchController.snapshot().items
        .filter((item) => frozenDraftAttachmentLocalIDs.has(item.local_id) && item.status === 'staged_ready')
        .map((item) => item.local_id),
    );
    const draftReasoningSelection = !selectedID ? frozenReasoningSelection : undefined;
    const draftModelID = !selectedID ? frozenDraft.model_id ?? '' : '';
    const launchModelID = frozenDraft.model_id ?? frozenModelID;
    const draftPermissionType = !selectedID ? frozenDraft.permission_type_override : undefined;
    const draftWorkingDir = !selectedID ? frozenDraft.working_dir ?? '' : '';
    let cancelRequested = false;
    // Transport ownership is request-scoped. Once the immutable request has
    // been captured below, later edits to this thread's composer must not
    // cancel the request or become owned by its eventual response.
    const submissionCurrent = () => !cancelRequested && composerDraftOperationActive(operation);
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
    const settleAcceptedComposerDraft = (canonicalThreadID: string, transferDraftScope: boolean) => {
      const canonicalSessionKey = trimString(canonicalThreadID);
      scopeBinding.threadID = canonicalSessionKey;
      const moveDraft = transferDraftScope || launchSessionKey.startsWith(`${PENDING_NEW_THREAD_ID}:`);
      if (moveDraft && !scopeBinding.transferred && isPendingDraftKey(launchSessionKey) && canonicalSessionKey && canonicalSessionKey !== launchSessionKey) {
        scopeBinding.transferred = true;
        if (launchChatTurnInFlight.has(launchSessionKey)) {
          launchChatTurnInFlight.add(canonicalSessionKey);
          setPreparingSendRevision(revision => revision + 1);
        }
        // A refreshed origin belongs only to first-turn intent, not to the
        // newer user edits carried into an accepted conversation.
        draftSessionFor(launchSessionKey).mutate(value => ({
          ...value, references: value.references.filter(reference => reference.kind !== 'page_context'),
        }));
        draftCoordinator.moveScope(launchSessionKey, canonicalSessionKey);
      }
      const submitted = transportOutbox().entries.get(clientRequestID);
      if (submitted && (presentation === 'composer' || restoredSubmissionSnapshot)) {
        consumeSubmittedComposerDraft(submitted, submissionScopeKey(), restoredSubmissionSnapshot?.text_revision);
      }
      const controller = attachmentControllerFor(submissionScopeKey());
      const stagingScopeID = controller.snapshot().staging_scope?.staging_scope_id;
      const scopeStillPending = stagingScopeID && [...transportOutbox().entries.values()].some(entry => entry.requestId !== clientRequestID && entry.input.staging_scope?.staging_scope_id === stagingScopeID);
      if (controller.snapshot().items.length === 0 && !scopeStillPending) releaseAttachmentStagingScope(submissionScopeKey());
      notifyEmbeddedAccepted?.({ client_request_id: clientRequestID, thread_id: canonicalThreadID });
    };
    let restoredSubmissionSnapshot: FlowerComposerDraftSnapshot | undefined;
    let handedToOutbox = false;
    try {
      let attachmentSnapshot = launchController.snapshot();
      let attachmentItems = attachmentItemsForSubmission(attachmentSnapshot);
      let launchStagingScope = attachmentSnapshot.staging_scope;
      if (launchStagingScope && selectedID && launchStagingScope.target_id !== selectedID) {
        launchStagingScope = await ensureAttachmentStagingScope(submissionScopeKey());
        attachmentSnapshot = launchController.snapshot();
      }
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
        if (attachmentSnapshot.capability?.model_id !== launchModelID) {
          const capabilitySequence = ++attachmentCapabilitySequence;
          try {
            const capability = await props.adapter.loadAttachmentCapability(launchModelID);
            if (!submissionCurrent() || capabilitySequence !== attachmentCapabilitySequence) return;
            if (capability.model_id !== launchModelID) throw new Error('Attachment capability model identity changed.');
            launchController.setCapability(capability);
          } catch {
            if (submissionCurrent() && capabilitySequence === attachmentCapabilitySequence) {
              launchController.markCapabilityUnavailable();
              notifyComposerError(attachmentCopy().errorUploadFailed);
            }
            return;
          }
        }
        if (!launchStagingScope) {
          try { launchStagingScope = await ensureAttachmentStagingScope(submissionScopeKey()); }
          catch { notifyComposerError(attachmentCopy().errorUploadFailed); return; }
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
        const transitioned = submissionSession().mutate((value) => (
          value.client_request_id === clientRequestID
            ? {
              ...value,
              mode: 'ordinary',
              attachments: attachmentItems.map((item) => ({
                local_id: item.local_id,
                source: item.source,
                name: item.name,
                mime_type: item.mime_type,
                size_bytes: item.size_bytes,
                upload_request_id: item.request_id,
                attempt_state: item.status,
                ...(item.staged ? { staged: item.staged } : {}),
                ...(item.admitted ? { admitted: item.admitted } : {}),
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
      if (!prompt && readyItems.length === 0 && !frozenReferences.some(reference => reference.kind !== 'page_context')) {
        notifyComposerError(copy().chat.enterMessageBeforeSending);
        return;
      }
      consumedAttachmentLocalIDs = readyItems.map((item) => item.local_id);
      if (!submissionCurrent() || !settingsReady() || surfaceReadOnly()) return;
      transcriptScroll.startFollowing();
      try {
        const referenceItems: ContextActionEnvelope['context'] = frozenReferences.map(flowerDraftReferenceContextItem);
        const contextAction: ContextActionEnvelope | undefined = frozenContextAction
          ? { ...frozenContextAction, context: [...frozenContextAction.context, ...referenceItems] }
          : referenceItems.length > 0 ? {
            schema_version: CONTEXT_ACTION_SCHEMA_VERSION,
            action_id: 'assistant.ask.flower',
            provider: 'flower',
            target: { target_id: 'current', locality: 'auto' },
            source: { surface: 'flower_composer' },
            context: referenceItems,
            presentation: { label: copy().chat.titleFallback, priority: 100 },
          } : undefined;
        const admittedThreadID = selectedID || scopeBinding.threadID;
        const launchInput: FlowerTurnLaunchInput = {
          client_request_id: clientRequestID,
          thread_id: admittedThreadID || undefined,
          ...(launchStagingScope ? { staging_scope: launchStagingScope } : {}),
          prompt,
          ...(attachmentIDs.length > 0 ? { attachment_ids: attachmentIDs } : {}),
          ...(contextAction ? { context_action: contextAction } : {}),
          decision: admittedThreadID ? null : capturedDecision,
          ...(!admittedThreadID && draftPermissionType ? { permission_type: draftPermissionType } : {}),
          ...(!admittedThreadID && draftModelID ? { model_id: draftModelID } : {}),
          ...(!admittedThreadID && draftReasoningSelection ? { reasoning_selection: draftReasoningSelection } : {}),
          ...(!admittedThreadID && draftWorkingDir ? { working_dir: draftWorkingDir } : {}),
        };
        const provisionalThreadSettings = !admittedThreadID && frozenPermissionType
          ? {
            model_id: launchModelID,
            working_dir: frozenDisplayedWorkingDir,
            permission_type: frozenPermissionType,
            ...(draftReasoningSelection ? { reasoning_selection: draftReasoningSelection } : {}),
          } satisfies TransportOutboxProvisionalThreadSettings
          : undefined;
        let storageGenerationRequest = launchAdapter.resolveStorageGeneration?.();
        // A paused predecessor may delay awaiting this captured request.
        void storageGenerationRequest?.catch(() => undefined);
        outboxOperations.set(clientRequestID, {
          adapter: launchAdapter,
          prepare: async () => {
            const decision = capturedDecision ?? await launchAdapter.resolveHandler({ thread_kind: 'chat', client_surface: 'flower_surface' });
            if (!decision.selected_handler || decision.blocker || decision.route === 'blocked') {
              throw new Error(decision.blocker?.message || copy().chat.handlerStillStarting);
            }
            // Resolve once for this explicit submission; retries retain the frozen generation.
            storageGenerationRequest ??= launchAdapter.resolveStorageGeneration?.();
            let storageGeneration: string | undefined;
            try { storageGeneration = await storageGenerationRequest; }
            catch (error) { storageGenerationRequest = undefined; throw error; }
            return { ...launchInput, decision: admittedThreadID ? null : decision,
              ...(storageGeneration ? { storage_generation: storageGeneration } : {}) };
          },
        });
        pendingAdmissionHandoffs.set(clientRequestID, {
          sessionKey: launchSessionKey,
          selectionSequence: focusSelectionSequence,
          scopeBinding,
          settle: settleAcceptedComposerDraft,
        });
        let durableOutbox = transportOutbox();
        setTransportOutbox((outbox) => {
          durableOutbox = outbox.put({
            presentation, preparation: 'pending',
            requestId: clientRequestID,
            threadId: admittedThreadID || launchSessionKey,
            input: launchInput,
            attachmentLabels: readyItems.map((attachment) => attachment.name),
            draftReferences: frozenDraft.references,
            draftText: promptInput,
            draftTextRevision: frozenTextRevision,
            draftAttachments: flowerComposerDraftAttachments(readyItems),
            createdAtMs: Date.now(),
            delivery: 'pending',
            ...(provisionalThreadSettings ? { provisionalThreadSettings } : {}),
          });
          return durableOutbox;
        });
        // The outbox owns frozen submission contents before request preparation.
        // Ordinary sends retain the editor until admission; queued sends release
        // it now. Later edits never belong to this request.
        handedToOutbox = true;
        const submittedFiles = launchController.localFiles().filter(file => consumedAttachmentLocalIDs.includes(file.local_id));
        const submittedAttachments = flowerComposerDraftAttachments(readyItems);
        outboxDraftRestorers.set(clientRequestID, () => {
          const sessionKey = transportOutbox().entries.get(clientRequestID)?.threadId ?? launchSessionKey;
          const value = draftSessionFor(sessionKey).snapshot().value;
          if (value.text || value.attachments.length || value.references.length) return false;
          const controller = attachmentControllerFor(sessionKey);
          const localFileIDs = new Set(submittedFiles.map(file => file.local_id));
          batch(() => {
            controller.hydrateDraft(submittedAttachments.map(item => ({
              local_id: item.local_id, request_id: item.upload_request_id, source: item.source,
              name: item.name, mime_type: item.mime_type, size_bytes: item.size_bytes,
              ...(!localFileIDs.has(item.local_id) && item.staged ? { staged: item.staged } : {}),
            })));
            controller.restoreLocalFiles(submittedFiles);
            restoredSubmissionSnapshot = draftSessionFor(sessionKey).mutate(current => ({ ...current, text: promptInput, references: frozenDraft.references,
              attachments: flowerComposerDraftAttachments(controller.snapshot().items), mode: 'ordinary', client_request_id: undefined })).snapshot;
            updateComposerSessionDraft(sessionKey, draft => ({ ...draft, chatDraft: promptInput, references: frozenDraft.references }));
          });
          return true;
        });
        if (presentation === 'queue') {
          consumeSubmittedComposerDraft(durableOutbox.entries.get(clientRequestID)!, submissionScopeKey());
        }
        // Do not wait for IndexedDB or HTTP in the preparation guard.
        // Dispatch waits for durable storage in the sole owner above.
        void durableOutbox.flushPersistence().catch(() => undefined);
      } catch (error) {
        if (!handedToOutbox) {
          pendingAdmissionHandoffs.delete(clientRequestID);
          if (preparedLongTextLocalID) launchController.remove(preparedLongTextLocalID);
          if (composerSessionStillCurrent(launchSessionKey)) notifyComposerError(getErrorMessage(error));
        }
      }
    } finally {
      if (scopeBinding.transferred && scopeBinding.threadID) launchChatTurnInFlight.delete(scopeBinding.threadID);
      if (cancelActiveLongTextSubmission === cancelLongTextSubmission) cancelActiveLongTextSubmission = null;
      setLongTextPreparing(false);
      if (composerDraftOperationActive(operation)) {
        const shared = submissionSession().snapshot();
        if (!handedToOutbox && shared.value.client_request_id === clientRequestID) {
          submissionSession().mutate((value) => ({
            ...value,
            mode: inspection.codePoints > FLOWER_INLINE_TEXT_CODE_POINT_LIMIT ? 'over_limit_editing' : 'ordinary',
            client_request_id: undefined,
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

  const requestThreadStop = (threadID: string): Promise<void> => {
    const stoppingThreadID = trimString(threadID);
    if (!stoppingThreadID) return Promise.resolve();
    const existing = stopThreadRequests.get(stoppingThreadID);
    if (existing) return existing;
    if (stoppingThreadIDs().has(stoppingThreadID)) return Promise.resolve();
    if (flowerThreadIsStopping(threadCache().views.get(stoppingThreadID)?.thread ?? threadCache().summaries.get(stoppingThreadID))) return Promise.resolve();
    updateThreadIDMembership(setStoppingThreadIDs, stoppingThreadID, true);
    const request = (async () => {
      const requestEpoch = liveTransport.connectionEpoch();
      try {
        if (unconfirmedStops().has(stoppingThreadID)) {
          const current = await requestThreadDetail(stoppingThreadID, 'user_action', true, true);
          if (!current || surfaceDisposed || requestEpoch !== liveTransport.connectionEpoch()
            || current.cancellation || !flowerThreadHasActiveTurnEvidence(current)) return;
        }
        await withFlowerRequestDeadline(() => props.adapter.stopThread(stoppingThreadID), copy().chat.stopUnconfirmed);
        if (surfaceDisposed || requestEpoch !== liveTransport.connectionEpoch()) return;
        const confirmed = await requestThreadDetail(stoppingThreadID, 'user_action', true, true);
        if (!confirmed || (!confirmed.cancellation && flowerThreadHasActiveTurnEvidence(confirmed))) {
          updateThreadIDMembership(setUnconfirmedStops, stoppingThreadID, true);
        }
        if (selectedThreadDetailMatches(stoppingThreadID)) {
          returnToChat();
        }
      } catch (error) {
        const handoff = pendingStopFocusHandoff();
        if (handoff?.threadID === stoppingThreadID) {
          setPendingStopFocusHandoff(null);
        }
        console.error('Flower stop request failed.', { threadID: stoppingThreadID, error });
        updateThreadIDMembership(setStoppingThreadIDs, stoppingThreadID, false);
        const current = threadCache().views.get(stoppingThreadID)?.thread;
        if (!surfaceDisposed && requestEpoch === liveTransport.connectionEpoch()
          && !current?.cancellation && (!current || flowerThreadHasActiveTurnEvidence(current))) {
          updateThreadIDMembership(setUnconfirmedStops, stoppingThreadID, true);
          notifyThreadActionError(copy().chat.stopUnconfirmed);
        }
      } finally {
        updateThreadIDMembership(setStoppingThreadIDs, stoppingThreadID, false);
        stopThreadRequests.delete(stoppingThreadID);
      }
    })();
    stopThreadRequests.set(stoppingThreadID, request);
    return request;
  };

  const stopSelectedThreadFromComposer = (): Promise<void> => {
    if (pendingThreadSelection()) return Promise.resolve();
    const stoppingThreadID = trimString(selectedThreadID());
    if (!stoppingThreadID) return Promise.resolve();
    if (!stopThreadRequests.has(stoppingThreadID)) {
      setPendingStopFocusHandoff(captureBottomActionFocus(stoppingThreadID));
    }
    return requestThreadStop(stoppingThreadID);
  };

  const submitChat = async () => {
    if (pendingThreadSelection()) return;
    if (composerTakingBackQueuedTurn()) return;
    composerHistory.reset();
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
    if (selectedThreadCanStop() && !promptOverLimit && !prompt && !composerHasAttachments() && !composerHasReferences()) {
      await stopSelectedThreadFromComposer();
      return;
    }
    if (threadLoadError() && selectedThreadID()) return;
    const sessionKey = currentComposerSessionKey();
    if (selectedComposerPendingSend() || launchChatTurnInFlight.has(sessionKey)
      || !selectedThreadID() && (goalPreparingScopes().includes(sessionKey) || transportOutbox().forThread(sessionKey).some(entry => entry.operation === 'goal' && !entry.terminalError))) return;
    if (!prompt && !composerHasReadyAttachments() && !composerHasExplicitReferences()) return;
    const retained = visibleTransportOutbox().find(entry => entry.presentation === 'composer'
      && (entry.delivery === 'failed' || entry.delivery === 'unknown'));
    if (retained) {
      const sameDraft = (retained.draftText ?? retained.input.prompt) === promptInput
        && JSON.stringify(retained.draftReferences ?? []) === JSON.stringify(currentComposerSessionDraft().references)
        && JSON.stringify(retained.draftAttachments?.map(item => item.local_id) ?? [])
          === JSON.stringify(currentAttachmentSnapshot().items.filter(item => item.status === 'staged_ready').map(item => item.local_id));
      if (sameDraft) {
        if (retained.delivery === 'failed' && !retained.terminalError) retryOutboxEntry(retained);
        else notifyComposerError(retained.terminalError ? copy().chat.sendPreparationRecoveryDescription : copy().chat.sendUnknownDescription);
        return;
      }
      // Editing a known rejection replaces that unadmitted request. An unknown
      // request retains its identity and pauses later transport dispatch.
      if (retained.delivery === 'failed' && !retained.terminalError) discardUnsentOutboxEntry(retained);
      draftSessionFor(sessionKey).mutate(value => value.client_request_id === retained.requestId
        ? { ...value, client_request_id: undefined } : value);
    }
    launchChatTurnInFlight.add(sessionKey);
    setPreparingSendRevision(revision => revision + 1);
    try {
      await launchChatTurn(promptInput);
    } finally {
      launchChatTurnInFlight.delete(sessionKey);
      setPreparingSendRevision(revision => revision + 1);
    }
  };

  const resetCompose = () => {
    releaseNavigationReads();
    setThreadNavigationOpen(false);
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
    setSelectedThreadID('');
    if (props.embeddedConversation) {
      const scope = props.embeddedConversation.scope;
      setEmbeddedDraftKeys(keys => ({ ...keys, [scope]: `${PENDING_NEW_THREAD_ID}:${scope}:${createFlowerClientRequestID()}` }));
    }
	// A new chat must not inherit a slash command or transient input state
	// from the previously selected thread.
    updateComposerSessionDraft(pendingDraftKey(), (draft) => ({
		...draft,
    modelIDOverride: undefined,
    reasoningOverride: undefined,
    reasoningModelID: undefined,
    workingDirDraft: undefined,
		chatDraft: '',
		references: [],
		inputPromptSignature: '',
		inputDrafts: {},
		activeInputQuestionID: '',
	}));
    draftSessionFor(pendingDraftKey()).mutate(value => ({ ...value, page_context_captured: false, inherited_defaults: undefined }));
		setThreadLoadError('');
    requestComposerFocus();
    void resolveHandlerDecision();
    returnToChat();
  };

  const startCompose = () => {
    resetCompose();
    capturePageContext(currentComposerSessionKey(), 'refresh');
  };

  const retireThreadLocally = (threadID: string) => {
    const tid = trimString(threadID);
    if (!tid || retiredThreadIDs.has(tid)) return;

	const retiringSelected = selectedThreadID() === tid;
    retiredThreadIDs.add(tid);
    if (pendingThreadSelection() === tid) {
      cancelDeferredThreadSelection();
      cancelThreadSelectionTransaction();
    }
    threadsRefreshSequence += 1;
    threadsReadController?.abort();
    threadsRefreshRequest = null;
    if (retiringSelected) engagementBootstrapSequence += 1;

    detailLoader.forget(tid);
    setThreadDetailLoading(tid, false);
    readSync.retire(tid);
    releaseAttachmentStagingScope(tid);

    setThreadCache((cache) => cache.evict(tid));
    setTransportOutbox((outbox) => outbox.dropThread(tid));
    draftSessionFor(tid).clear();
    setPendingPermissionPatch((current) => current?.threadID === tid ? null : current);
    setPendingModelPatch((current) => current?.threadID === tid ? null : current);

    if (retiringSelected) {
      resetCompose();
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
      await props.adapter.deleteThread(threadID);
      retireThreadLocally(threadID);
      setDeleteTarget(null);
      notifySuccess(copy().threadList.deleteCommittedNotification);
    } catch (error) {
      setDeleteError(getErrorMessage(error));
    } finally {
      setDeleteSubmitting(false);
      setThreadActionBusy(null);
    }
  };

	const deleteTargetTitle = () => trimString(deleteTarget()?.item.title);
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
    untrack(() => requestComposerFocus(document.activeElement, presentation() === 'companion' && !surfaceEngaged()));
  });

  const threadRailResize = createThreadRailResize({
    width: threadRailWidth, setWidth: setThreadRailWidth, save: saveThreadRailWidth,
  });
  createEffect(() => {
    if (navigationOverlay() || presentation() !== 'full' || props.embeddedConversation || !surfaceEngaged()) threadRailResize.stop();
  });
  onCleanup(threadRailResize.stop);

  const selectThread = (threadID: string) => batch(() => {
    const focusOwner = typeof document === 'undefined' ? null : document.activeElement;
    const requestID = trimString(props.focusThreadRequest?.request_id);
    if (requestID) props.onFocusThreadRequestConsumed?.(requestID);
    const tid = trimString(threadID);
    if (!tid || retiredThreadIDs.has(tid)) return;
    setThreadNavigationOpen(false);
    cancelDeferredThreadSelection();
    cancelThreadSelectionTransaction();
    releaseNavigationReads();
    const claimedSequence = ++threadLoadSequence;
    if (tid === selectedThreadID() && threadCache().views.has(tid) && !threadLoadError()) {
      returnToChat();
      if (selectedThreadSummaryNeedsDetail()) {
        beginThreadDetailDisplayCycle(tid);
        void requestThreadDetail(tid, 'summary_update');
      }
      if (selectedThreadTailPreparing()) {
        beginSelectedThreadTailReveal(tid, claimedSequence);
        scheduleSelectedThreadTailReveal(tid, claimedSequence);
      }
      schedulePresentedSelection(tid, claimedSequence);
      if (!mobileNavigation()) requestComposerFocus(focusOwner);
      return;
    }
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
    closeSubagentOverlays();
    closeTranscriptMenu();
    closePermissionMenu(false);
    closeModelMenu(false);
    closeComposerMore(false);
    setPendingThreadSelection(tid);
    scheduleThreadSelectionAfterPaint(tid, claimedSequence, focusOwner);
  });

  let embeddedSessionKey = '';
  createEffect(() => {
    const sessionKey = props.embeddedConversation ? pendingDraftKey() : '';
    if (!sessionKey || sessionKey === embeddedSessionKey) return;
    untrack(() => {
      if (embeddedSessionKey && selectedThreadID()) embeddedThreads.set(embeddedSessionKey, selectedThreadID());
      embeddedSessionKey = sessionKey;
      const threadID = embeddedThreads.get(sessionKey) ?? trimString(props.embeddedConversation?.threadID);
      if (threadID) selectThread(threadID);
      else {
        cancelDeferredThreadSelection();
        cancelThreadSelectionTransaction();
        threadLoadSequence += 1;
        cancelPresentedSelectionSchedule();
        setPresentedSelection(null);
        closeSubagentOverlays();
        releaseNavigationReads();
        setSelectedThreadID('');
        setThreadLoadError('');
        returnToChat();
      }
    });
  });
  createEffect(on(() => props.embeddedConversation?.request?.nonce, (nonce, previousNonce) => {
    const request = props.embeddedConversation?.request;
    if (!nonce || nonce === previousNonce || !request) return;
    untrack(() => {
      if (request.prompt !== undefined) updateComposerSessionText(currentComposerSessionKey(), request.prompt);
      returnToChat();
      requestComposerFocus();
    });
  }));

  const updateTranscriptNearBottom = () => {
    transcriptScroll.onScroll();
  };
  const scrollTranscriptToBottom = (options: Readonly<{ smooth?: boolean }> = {}) => transcriptScroll.scrollToBottom(options);
  const measureTranscriptNearBottomAfterLayout = () => transcriptScroll.measureAfterLayout();
  onCleanup(() => {
    cancelDeferredThreadSelection();
    cancelThreadSelectionTransaction();
    cancelPresentedSelectionSchedule();
    releasePreparingBodyReads();
    transcriptScroll.dispose();
    subagentDetailScroll.dispose();
    setThreadCache(cache => cache.retainDetails([]));
    readSync.dispose();
    if (copiedMessageResetTimer !== undefined) {
      window.clearTimeout(copiedMessageResetTimer);
      copiedMessageResetTimer = undefined;
    }
    if (copiedApprovalResetTimer !== undefined) {
      window.clearTimeout(copiedApprovalResetTimer);
      copiedApprovalResetTimer = undefined;
    }
  });

  const parentEventReading = createParentEventReading({
    get threadID() { return selectedThreadID(); },
    get page() { return selectedThread()?.parent_events; },
    get read() { return props.adapter.readParentEvents; },
    get connectionEpoch() { return liveSyncState().connectionEpoch; },
    get timeoutMessage() { return subagentsCopy().events.readTimeout; },
  });
  const projectSelectedTimeline = createFlowerTimelineProjection();
  const selectedTimelineEntries = createMemo(() => projectSelectedTimeline(selectedThread(), parentEventReading.events()));
  const [computerDialog, setComputerDialog] = createSignal<'settings' | 'connection' | 'installation' | null>(null);
  createEffect(on([activeThreadID, () => selectedInputRequest()?.prompt_id], () => setComputerDialog(null), { defer: true }));
  const [computerStageOpen, setComputerStageOpen] = createSignal(false);
  const [computerStageRestoreFocus, setComputerStageRestoreFocus] = createSignal<HTMLElement>();
  const restoreComputerStage = (source: HTMLElement) => {
    if (!computerStageOpen()) setComputerStageRestoreFocus(source);
    setComputerStageOpen(true);
  };
  const [computerStageBoundary, setComputerStageBoundary] = createSignal<HTMLElement>();
  const [computerLauncherBoundary, setComputerLauncherBoundary] = createSignal<HTMLElement>();
  const [viewerFPS, setViewerFPS] = createSignal(computerFrameRate(props.adapter.computerFrameRate?.read()));
  const [privateControlRequested, setPrivateControlRequested] = createSignal(false);
  const [computerControlDisconnected, setComputerControlDisconnected] = createSignal(false);
  const [computerResourceStatus, setComputerResourceStatus] = createSignal<FlowerLiveStreamEnvelope['computer_status']>();
  const [computerControlReady, setComputerControlReady] = createSignal(false);
  const [computerResponseSubmitting, setComputerResponseSubmitting] = createSignal(false);
  const [computerResponseCommitting, setComputerResponseCommitting] = createSignal(false);
  const [computerResponseError, setComputerResponseError] = createSignal('');
  const [computerViewFailed, setComputerViewFailed] = createSignal(false);
  const [computerViewerAssistance, setComputerViewerAssistance] = createSignal<string>();
  const [computerViewerRetry, setComputerViewerRetry] = createSignal(0);
  const [activeComputerViewerRevision, setActiveComputerViewerRevision] = createSignal(0);
  const [receivedComputerFPS, setReceivedComputerFPS] = createSignal(0);
  let computerRateWindow = 0, computerRateFrames = 0, computerLastFrameAt = 0;
  let computerRateChanging = false;
  const changeComputerFrameRate = (fps: number) => {
    const next = computerFrameRate(fps);
    props.adapter.computerFrameRate?.write(next);
    computerRateChanging = true;
    void computerInputQueue.then(() => { setViewerFPS(next); computerRateChanging = false; });
  };
  const computerCurrentVerified = () => (threadCache().views.get(selectedThreadID())?.version ?? 0) > 0;
  const resumeComputerViewer = () => batch(() => {
    if (computerControlDisconnected() && (!computerObserverID() || !computerCurrentVerified())) return;
    setComputerControlDisconnected(false);
    setComputerControlError(false); setComputerViewFailed(false); setComputerViewerAssistance(undefined);
    setComputerControlReady(false); setComputerViewerRetry(value => value + 1);
  });
  const takeComputerControl = (source: HTMLElement) => batch(() => {
    restoreComputerStage(source); setPrivateControlRequested(true); resumeComputerViewer();
  });
  const [computerControlError, setComputerControlError] = createSignal(false);
  const isComputerInput = (request: FlowerInputRequest | null | undefined) => Boolean(request?.computer_assistance?.target_id);
  const isBrowserConnectionInput = (request: FlowerInputRequest | null | undefined) => request?.computer_assistance?.kind === 'connection';
  const isBrowserInstallInput = (request: FlowerInputRequest | null | undefined) => request?.computer_assistance?.kind === 'installation';
  const isComputerAssistanceInput = (request: FlowerInputRequest | null | undefined) => Boolean(request?.computer_assistance);
  const isToolOriginComputerInput = (request: FlowerInputRequest | null | undefined) => isComputerAssistanceInput(request) && Boolean(request?.prompt_id.startsWith('tool-input:'));
  let computerInputQueue = Promise.resolve();
  let computerInputCount = 0;
  let computerInputGeneration = 0;
  let queuedComputerText: { action: 'type'; text: string } | undefined;
  const inputComputerControl = (input: FlowerComputerInputCommand) => {
    const request = selectedInputRequest();
    const thread_id = selectedThreadID();
    const control = props.adapter.inputComputerControl;
    if (!thread_id || !request || !isComputerInput(request) || !control) return;
    if (computerControlDisconnected() || computerRateChanging || computerControlError() || computerViewFailed() || computerResponseSubmitting() || !computerControlReady()) return;
    if (input.action === 'type' && queuedComputerText && queuedComputerText.text.length + (input.text?.length ?? 0) <= 4000) {
      queuedComputerText.text += input.text ?? '';
      return;
    }
    if (computerInputCount >= 32) {
      computerInputGeneration++; queuedComputerText = undefined; setComputerControlError(true);
      return;
    }
    const queued = input.action === 'type' ? { action: 'type' as const, text: input.text ?? '' } : input;
    queuedComputerText = queued.action === 'type' ? queued as { action: 'type'; text: string } : undefined;
    const interaction_id = request.prompt_id;
    const generation = computerInputGeneration;
    computerInputCount++;
    computerInputQueue = computerInputQueue.then(async () => {
      if (queuedComputerText === queued) queuedComputerText = undefined;
      if (generation !== computerInputGeneration || thread_id !== selectedThreadID() || selectedInputRequest()?.prompt_id !== interaction_id) return;
      await control({ ...queued, thread_id, interaction_id, observer_id: computerObserverID(), viewer_revision: activeComputerViewerRevision() });
      if (generation !== computerInputGeneration || thread_id !== selectedThreadID() || selectedInputRequest()?.prompt_id !== interaction_id) return;
      setComputerControlError(false);
    }).catch(() => {
      if (generation === computerInputGeneration && thread_id === selectedThreadID() && selectedInputRequest()?.prompt_id === interaction_id) {
        computerInputGeneration++; queuedComputerText = undefined; setComputerControlError(true);
      }
    }).finally(() => {
      computerInputCount--;
    });
  };
  createEffect(() => {
    activeThreadID();
    void selectedInputRequest()?.prompt_id;
    computerInputGeneration++;
    queuedComputerText = undefined;
    setComputerControlDisconnected(false);
    setComputerResourceStatus(undefined);
    setPrivateControlRequested(false); setComputerControlReady(false); setComputerControlError(false);
    setComputerResponseSubmitting(false); setComputerResponseCommitting(false); setComputerResponseError(''); setComputerViewFailed(false);
  });
  const selectedComputerStage = createMemo<FlowerComputerStageSnapshot | null>(() => {
    const entries = selectedTimelineEntries();
    const candidates: FlowerComputerStageSnapshot[] = [];
    for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
      const entry = entries[entryIndex];
      if (entry?.type !== 'message' && entry?.type !== 'queued_turn') continue;
      const blocks = entry.blocks;
      for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
        const block = blocks[blockIndex];
        if (block?.type !== 'activity') continue;
        for (let itemIndex = block.block.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
          const item = block.block.items[itemIndex];
          const toolName = item?.tool_name || '';
          if (toolName[0] !== 'c' && toolName[0] !== 'b') continue;
          const presentation = presentFlowerActivityItem(item, { tools: copy().chat.toolActivity });
          const detail = computerActivityResource(item);
          if (!detail.target_id && !detail.frame) continue;
          candidates.push({
            item,
            runID: block.block.run_id,
            turnID: block.block.turn_id,
            target: detail.target,
            action: presentation.label,
            ...(detail.target_id ? { targetID: detail.target_id } : {}),
            ...(detail.frame ? { frame: detail.frame } : {}),
            status: item.status,
          });
        }
      }
    }
    const pending = selectedInputRequest();
    if (isComputerInput(pending)) {
      const execution = selectedThread()?.current_execution;
      const control = candidates.find(candidate => candidate.turnID === execution?.turn_id && candidate.item.tool_id === pending?.computer_assistance?.tool_call_id);
      if (control) return control;
    }
    const execution = selectedThread()?.current_execution;
    const active = candidates.find(candidate => candidate.turnID === execution?.turn_id
      && candidate.runID === execution?.run_id && Boolean(candidate.targetID));
    if (active && (execution?.status === 'running' || execution?.status === 'waiting_user' || execution?.status === 'waiting_approval')) return { ...active, frame: active.frame ?? candidates.find(candidate => candidate.frame && candidate.runID === active.runID && candidate.targetID === active.targetID)?.frame };
    const latest = candidates.find(candidate => Boolean(candidate.targetID)) ?? candidates[0] ?? null;
    if (latest?.runID === selectedThread()?.active_run_id && selectedThread()?.status === 'running') return latest;
    // A later semantic observation has no image of its own. Completed viewing
    // resolves the last canonical capture of this run and target, not live media.
    return candidates.find(candidate => candidate.frame && candidate.runID === latest?.runID && candidate.targetID === latest?.targetID)
      ?? latest;
  });
  const computerStageExecution = createMemo(() => {
    const stage = selectedComputerStage(), execution = selectedThread()?.current_execution;
    return stage?.turnID && stage?.runID && stage.turnID === execution?.turn_id && stage.runID === execution.run_id ? execution : undefined;
  });
  const computerStageHistorical = createMemo(() => {
    const status = computerStageExecution()?.status;
    return (status !== 'running' && status !== 'waiting_user' && status !== 'waiting_approval');
  });
  const selectedComputerAssistance = createMemo(() => {
    if (isBrowserInstallInput(selectedInputRequest())) return computerAssistance(undefined, copy().computer, { kind: 'installation' });
    if (isBrowserConnectionInput(selectedInputRequest())) return computerAssistance(undefined, copy().computer, { kind: 'connection' });
    return computerAssistance(selectedComputerStage()?.item, copy().computer, undefined, selectedThread()?.permission_type === 'full_access');
  });
  const selectedComputerAssistanceInstruction = createMemo(() => computerResourceStatus()?.state === 'unavailable'
    ? copy().chat.computerControlNotReady
    : selectedComputerAssistance().instruction);
  const requestedComputerAccess = createMemo<FlowerRequestedComputerAccess>(() => selectedComputerAssistance().requested);
  const computerExecutionMode = () => {
    const mode = selectedComputerStage()?.item.chips?.find(chip => chip.kind === 'execution_mode')?.value;
    return mode === 'foreground' ? copy().computer.usingDesktop : mode === 'background' ? copy().computer.background : '';
  };
  const computerStageSessionState = createMemo<FlowerComputerStageSessionState>(() => {
    if (computerStageHistorical()) {
      switch (computerStageExecution()?.status) {
        case 'success': return 'completed';
        case 'canceled': return 'stopped';
        case 'failed': return 'failed';
        default: return 'historical';
      }
    }
    if (computerControlDisconnected()) return 'disconnected';
    if (computerResponseSubmitting()) return 'checking';
    if (computerViewFailed() || computerControlError()) return 'paused';
    if (privateControlRequested() && isComputerInput(selectedInputRequest())) return computerControlReady() ? 'user_control' : 'taking_control';
    if (isComputerInput(selectedInputRequest())) return 'awaiting_control';
    return computerStageExecution()?.status === 'running' ? 'running' : 'awaiting_user';
  });
  const computerStageEntryLabel = createMemo(() => {
    if (computerStageHistorical()) return copy().chat.computerViewLastScreenshot;
    if (isComputerAssistanceInput(selectedInputRequest())) return selectedComputerAssistance().title;
    const state = computerStageSessionState();
    if (state === 'running') {
      const mode = computerExecutionMode();
      if (mode) return mode;
    }
    return copy().chat.computerStageStatus[state];
  });
  createEffect(() => {
    selectedThreadID();
    setComputerLiveFrame(undefined);
    setComputerStageRestoreFocus(undefined);
    setComputerStageOpen(false);
  });
  let previousComputerThread = '';
  let previousComputerLive = false;
  createEffect(() => {
    const thread = selectedThreadID(), status = selectedThread()?.current_execution?.status;
    const live = status === 'running' || status === 'waiting_user' || status === 'waiting_approval';
    if (thread === previousComputerThread && previousComputerLive && !live) {
      setComputerStageOpen(false); setComputerViewFailed(false);
    }
    previousComputerThread = thread; previousComputerLive = live;
  });
  const computerViewScope = createMemo(() => JSON.stringify([selectedThreadID(), selectedThread()?.active_run_id, selectedComputerStage()?.targetID]));
  createEffect(() => {
    computerViewScope();
    // A failed preview pauses this execution only. A later run still waits for
    // its own observation before starting a fresh sampler.
    setComputerViewFailed(false); setComputerViewerAssistance(undefined);
  });
  const computerViewerKey = createMemo(() => {
    const stage = selectedComputerStage();
    if (!computerCurrentVerified() || computerStageHistorical() || computerControlDisconnected() || computerResourceStatus()?.state === 'unavailable' || !computerStageOpen() || !documentVisible() || !computerObserverID() || !stage?.targetID || computerResponseCommitting() || computerViewFailed()) return '';
    const interaction = privateControlRequested() && isComputerInput(selectedInputRequest()) ? selectedInputRequest()?.prompt_id : '';
    if (!interaction && (!stage.runID || stage.runID !== selectedThread()?.active_run_id || selectedThread()?.status !== 'running')) return '';
    return JSON.stringify([computerObserverID(), selectedThreadID(), stage.targetID, interaction || '', viewerFPS(), computerViewerRetry()]);
  });
  createEffect(() => {
    const key = computerViewerKey();
    setComputerLiveFrame(undefined); setComputerControlReady(false);
    setReceivedComputerFPS(0); computerRateWindow = Date.now(); computerLastFrameAt = computerRateWindow; computerRateFrames = 0;
    const update = props.adapter.setComputerViewer;
    if (!key || !update) return;
    const [observer_id, thread_id, target_id, interaction_id, fps] = JSON.parse(key) as [string,string,string,string,number,number];
    const revision = ++computerViewerRevision;
    setActiveComputerViewerRevision(revision);
    const resource_ref = interaction_id ? undefined : untrack(() => selectedComputerStage()?.frame);
    let disposed = false;
    const watchdog = setInterval(() => {
      if (Date.now() - computerLastFrameAt > 10000) { setReceivedComputerFPS(0); setComputerViewFailed(true); }
    }, 1000);
    void update({ observer_id, revision, thread_id, target_id, resource_ref, ...(interaction_id ? { interaction_id } : {}), fps })
      .catch(() => { if (!disposed) setComputerViewFailed(true); });
    onCleanup(() => {
      disposed = true; clearInterval(watchdog);
      computerInputGeneration++; queuedComputerText = undefined;
      void update({ observer_id, revision: ++computerViewerRevision }).catch(() => undefined);
    });
  });
  const computerStageFrame = createMemo<FlowerComputerFrameSource | undefined>(() => {
    const stage = selectedComputerStage();
    if (!stage?.targetID || computerViewFailed() || computerControlDisconnected()) return;
    const thread_id = selectedThreadID(), target_id = stage.targetID;
    const live = computerLiveFrame()?.computer_frame;
    if (privateControlRequested() && isComputerInput(selectedInputRequest())) {
      if (live?.interaction_id && live.interaction_id === selectedInputRequest()?.prompt_id && live.frame_id) return { thread_id, target_id, private_frame: {
        observer_id: live.session_id, viewer_revision: live.viewer_revision, interaction_id: live.interaction_id, frame_id: live.frame_id,
      } };
      return;
    }
    const resource_ref = computerViewerKey() && live?.resource_ref ? live.resource_ref : stage.frame;
    const sha256 = /^computer:\/\/[^/]+\/([a-f0-9]{64})$/u.exec(resource_ref ?? '')?.[1];
    return resource_ref && sha256 ? { thread_id, target_id, resource_ref, sha256, ...(computerViewerKey() && live ? { viewer_revision: live.viewer_revision, sequence: live.sequence } : {}) } : undefined;
  });
  const computerStageAvailable = createMemo(() => {
    const stage = selectedComputerStage();
    return Boolean(stage?.targetID && (stage.frame || privateControlRequested() || !computerStageHistorical()));
  });
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
    if (preview.canonical_reference) {
      const scope = preview.canonical_reference;
      const references = scope.queue_id
        ? selectedCanonicalQueuedTurns().find(turn => turn.queue_id === scope.queue_id)?.references
        : selectedTimelineEntries().flatMap(entry => entry.type === 'message' && entry.message.turn_id === scope.turn_id ? entry.message.references ?? [] : []);
      if (!references?.some(reference => reference.reference_id === scope.reference_id)) setContextSnapshotPreview(null);
      return;
    }
    const queuedSource = selectedQueueDockRows().find(row => `queued:${row.canonical?.queue_id ?? row.requestKey}` === preview.message_id);
    const queuedTurn = queuedSource?.canonical;
    const display = sourceEntry?.type === 'message'
      ? parseChatMessageReferences(sourceEntry.message.references)
      : parseChatMessageReferences(queuedTurn?.references) ?? parseChatContextAction(queuedTurn?.context_action ?? queuedSource?.transport?.input.context_action);
    const sourceAction = preview.source_action ?? preview.action;
    const currentAction = display?.chips.find((chip) => (
      chip.action
      && 'context_index' in chip.action
      && 'context_index' in sourceAction
      && chip.action.context_index === sourceAction.context_index
      && chip.action.type === sourceAction.type
    ))?.action;
    if (!currentAction || JSON.stringify(currentAction) !== JSON.stringify(sourceAction)) {
      setContextSnapshotPreview(null);
    }
  });
  const selectedSubagentSummaries = createMemo(() => selectedThread()?.subagents?.filter(summary => trimString(summary.parent_thread_id) === selectedThreadID()));
  const selectedSubagentItems = createMemo<readonly FlowerSubagentPanelItem[]>((previous) => {
    const threadID = selectedThreadID();
    const subagents = selectedSubagentSummaries();
    const projected = untrack(() => buildFlowerSubagentPanelItems(selectedThread() ? { ...selectedThread()!, thread_id: threadID, subagents } : null));
    return retainKeyedItems(previous, projected, (item) => JSON.stringify([item.parentThreadID, item.threadID]));
  });
  const subagentStatusIsActive = (status: FlowerSubagentPanelStatus): boolean => (
    status === 'waiting_input' || status === 'running' || status === 'queued' || status === 'unknown'
  );
  const selectedActiveSubagentItems = createMemo(() => selectedSubagentItems().filter((item) => subagentStatusIsActive(item.status)));
  const selectedSettledSubagentItems = createMemo(() => selectedSubagentItems().filter((item) => !subagentStatusIsActive(item.status)));
  const selectedRunningSubagentItems = createMemo(() => selectedSubagentItems().filter((item) => item.status === 'running'));
  const subagentHeaderItems = createMemo(() => {
    const running = selectedRunningSubagentItems();
    const active = selectedActiveSubagentItems();
    return [...(running.length ? running : active.length ? active : selectedSubagentItems())].sort((left, right) => (
      left.createdAtMs - right.createdAtMs || left.threadID.localeCompare(right.threadID)
    ));
  });
  const subagentHeaderState = () => selectedRunningSubagentItems().length ? 'running' as const
    : selectedActiveSubagentItems().length ? 'active' as const : 'settled' as const;
  // Navigation follows immutable creation identity, not the dropdown's live priority.
  const subagentSwitcherItems = createMemo(() => [...selectedSubagentItems()].sort((left, right) => (
    left.createdAtMs - right.createdAtMs || left.threadID.localeCompare(right.threadID)
  )));
  const selectedActiveSubagentCount = createMemo(() => selectedActiveSubagentItems().length);
  const selectedSettledSubagentCount = createMemo(() => selectedSettledSubagentItems().length);
  const selectedFailedSubagentCount = createMemo(() => selectedSettledSubagentItems().filter((item) => item.status === 'failed' || item.status === 'timed_out').length);
  const activeSubagentItem = createMemo(() => {
    const active = activeSubagentDetail();
    if (!active) return null;
    return selectedSubagentItems().find((item) => trimString(item.threadID) === active.childThreadID) ?? active.item;
  });
  const subagentDetailThread = createMemo<FlowerThreadSnapshot | null>(() => threadCache().views.get(activeSubagentID())?.thread ?? null);
  const selectedThreadMedia = createThreadMedia(selectedThread);
  const subagentThreadMedia = createThreadMedia(subagentDetailThread);
  const subagentDetailRunProgress = createMemo(() => flowerRunProgress(subagentDetailThread()));

  const subagentDetailActiveStatus = createMemo<FlowerSubagentPanelStatus>(() => {
    const itemStatus = activeSubagentItem()?.status ?? 'unknown';
    const detailStatus = normalizeSubagentPanelStatus(subagentDetailThread()?.status ?? subagentDetailSummary()?.status);
    if (detailStatus !== 'unknown') return detailStatus;
    return itemStatus;
  });

  const visibleTimelineEntries = createMemo((): readonly FlowerTimelineEntry[] => {
    return selectedTimelineEntries().filter((entry) => entry.type !== 'queued_turn');
  });


  const shouldSubmitOnEnterKeydown = (event: KeyboardEvent): boolean => {
    if (event.isComposing || isComposing() || event.keyCode === 229) {
      return false;
    }
    return event.key === 'Enter' && !event.shiftKey;
  };

  type GoalEdit = NonNullable<FlowerComposerDraftValue['goal_edit']>;
  const goalCommand = createMemo(() => reactiveDraftSnapshotFor(currentComposerSessionKey()).value.goal_command);
  const [goalPopupScope, setGoalPopupScope] = createSignal('');
  const goalPopupOpen = () => Boolean(goalPopupScope()) && goalPopupScope() === currentComposerSessionKey();
  const goalEditor = createMemo(() => reactiveDraftSnapshotFor(currentComposerSessionKey()).value.goal_edit);
  // A discarded draft cannot inherit a pending edit's successful write version.
  const goalEditOrigins = new WeakMap<GoalEdit, GoalEdit>();
  const goalEditOrigin = (edit: GoalEdit) => goalEditOrigins.get(edit) ?? edit;
  const storeGoalEditor = (sessionKey: string, editor: GoalEdit | null, previous?: GoalEdit) => {
    if (editor && previous) goalEditOrigins.set(editor, goalEditOrigin(previous));
    draftSessionFor(sessionKey).mutate(value => ({ ...value, goal_edit: editor ?? undefined }));
  };
  const [goalPreparingScopes, setGoalPreparingScopes] = createSignal<readonly string[]>([]);
  const selectedGoal = createMemo(() => selectedThread()?.goal);
  const [goalPopupLoad, setGoalPopupLoad] = createSignal<'loading' | 'ready' | 'error'>('loading');
  const [goalRequestedView, setGoalPopupView] = createSignal<'current' | 'draft'>('current');
  const goalPopupView = () => goalEditor() ? goalRequestedView() : 'current';
  const [goalEditing, setGoalEditing] = createSignal(false);
  const [goalReviewedVersion, setGoalReviewedVersion] = createSignal<number>();
  const [goalCurrentVersionSeen, setGoalCurrentVersionSeen] = createSignal<number>();
  const [goalDeleteConflict, setGoalDeleteConflict] = createSignal(false);
  const [goalComposing, setGoalComposing] = createSignal(false);
  const goalDraftStale = () => Boolean(goalEditor() && goalEditor()!.version !== (selectedGoal()?.version ?? 0));
  const goalVersionReviewed = () => !goalDraftStale() || goalReviewedVersion() === (selectedGoal()?.version ?? 0);
  const goalCanSave = () => goalPopupLoad() === 'ready' && goalEditing() && Boolean(goalEditor()?.text.trim()) && goalVersionReviewed();
  const goalPopupID = createUniqueId();
  let goalReadController: AbortController | undefined;
  onCleanup(() => goalReadController?.abort());
  let goalPopupAttempt = 0;
  let goalPopupEpoch = 0;
  const goalDraftSelections = new Map<string, { start: number; end: number; direction: 'forward' | 'backward' | 'none'; scroll: number }>();
  let goalInputRef: HTMLTextAreaElement | undefined;
  let goalTriggerRef: HTMLButtonElement | undefined;
  let goalPanelRef: HTMLDivElement | undefined;
  const [goalPopupPosition, setGoalPopupPosition] = createSignal({ x: 8, y: 8 });
  const [goalPopupSize, setGoalPopupSize] = createSignal({ width: 352, height: 220 });
  const rememberGoalSelection = () => {
    if (goalPopupView() !== 'draft' || !goalInputRef) return;
    goalDraftSelections.set(goalPopupScope(), { start: goalInputRef.selectionStart, end: goalInputRef.selectionEnd,
      direction: goalInputRef.selectionDirection, scroll: goalInputRef.scrollTop });
  };
  const showGoalView = (view: 'current' | 'draft', edit = false) => {
    if (goalComposing()) return;
    rememberGoalSelection();
    setGoalPopupView(view);
    setGoalEditing(edit);
    const attempt = goalPopupAttempt;
    requestAnimationFrame(() => {
      if (surfaceDisposed || attempt !== goalPopupAttempt || !goalPopupOpen() || !goalInputRef) return;
      const selection = goalDraftSelections.get(currentComposerSessionKey());
      if (view === 'draft' && selection) {
        goalInputRef.setSelectionRange(selection.start, selection.end, selection.direction);
        goalInputRef.scrollTop = selection.scroll;
      } else goalInputRef.scrollTop = 0;
      if (edit) goalInputRef.focus();
    });
  };
  const closeGoalEditor = (discard = false, restoreFocus = true) => {
    goalReadController?.abort();
    goalReadController = undefined;
    rememberGoalSelection();
    if (discard) storeGoalEditor(currentComposerSessionKey(), null);
    goalPopupAttempt++;
    setGoalPopupScope('');
    setGoalComposing(false);
    if (restoreFocus) (goalTriggerRef ?? composerRef)?.focus();
  };
  const confirmGoalPopup = async () => {
    goalReadController?.abort();
    const controller = new AbortController();
    goalReadController = controller;
    const attempt = ++goalPopupAttempt;
    const sessionKey = currentComposerSessionKey();
    const threadID = selectedThreadID();
    goalPopupEpoch = liveTransport.connectionEpoch();
    const epoch = goalPopupEpoch;
    const sequence = threadLoadSequence;
    setGoalPopupLoad('loading');
    setGoalReviewedVersion(undefined);
    const result = await requestThreadDetail(threadID, 'goal_popup', true, false, controller.signal);
    if (surfaceDisposed || attempt !== goalPopupAttempt || !goalPopupOpen() || sessionKey !== currentComposerSessionKey()
      || sequence !== threadLoadSequence || epoch !== liveTransport.connectionEpoch()) return;
    setGoalPopupLoad(result ? 'ready' : 'error');
    if (result) {
      const editable = !goalEditor();
      setGoalEditing(editable);
      requestAnimationFrame(() => {
        if (!surfaceDisposed && attempt === goalPopupAttempt && goalPopupOpen() && editable) goalInputRef?.focus();
      });
    }
  };
  const openGoalEditor = () => {
    goalPopupEpoch = liveTransport.connectionEpoch();
    setGoalPopupLoad('loading');
    setGoalPopupView('current');
    setGoalEditing(false);
    setGoalDeleteConflict(false);
    setGoalCurrentVersionSeen(undefined);
    setGoalPopupScope(currentComposerSessionKey());
    void confirmGoalPopup();
    const attempt = goalPopupAttempt;
    requestAnimationFrame(() => {
      if (!surfaceDisposed && attempt === goalPopupAttempt && goalPopupOpen() && document.activeElement === goalTriggerRef)
        goalPanelRef?.querySelector<HTMLButtonElement>('.flower-goal-popup-controls button:last-child')?.focus();
    });
  };
  const continueGoalEditing = () => {
    if (goalPopupLoad() !== 'ready' || goalDraftStale() && goalPopupView() !== 'current') return;
    setGoalReviewedVersion(selectedGoal()?.version ?? 0);
    showGoalView('draft', true);
  };
  const discardGoalDraft = () => {
    storeGoalEditor(currentComposerSessionKey(), null);
    goalDraftSelections.delete(currentComposerSessionKey());
    setGoalReviewedVersion(undefined);
    showGoalView('current', goalPopupLoad() === 'ready');
  };
  createEffect(() => {
    if (goalPopupOpen() && goalPopupLoad() === 'ready' && goalPopupView() === 'current') setGoalCurrentVersionSeen(selectedGoal()?.version ?? 0);
  });
  const enterGoalCommand = (text = '') => {
    draftSessionFor(currentComposerSessionKey()).mutate(value => ({ ...value, goal_command: { text } }));
    requestAnimationFrame(() => { if (!surfaceDisposed) composerRef?.focus(); });
  };
  const exitGoalCommand = () => {
    draftSessionFor(currentComposerSessionKey()).mutate(value => ({ ...value, goal_command: undefined }));
    requestAnimationFrame(() => { if (!surfaceDisposed) composerRef?.focus(); });
  };
  createEffect(() => {
    const epoch = liveSyncState().connectionEpoch;
    if (goalPopupScope() && (goalPopupScope() !== currentComposerSessionKey() || epoch !== goalPopupEpoch || !selectedGoal()?.text && !goalEditor())) closeGoalEditor(false, false);
  });
  createEffect(() => {
    if (selectedGoal()?.status === 'completed' && goalPopupScope()) closeGoalEditor(false, false);
  });
  createEffect(() => {
    if (!goalPopupOpen()) return;
    const measure = () => {
      if (!goalTriggerRef || !goalPanelRef) return;
      const anchor = goalTriggerRef.getBoundingClientRect();
      const panel = goalPanelRef.getBoundingClientRect();
      setGoalPopupSize(previous => previous.width === panel.width && previous.height === panel.height ? previous : { width: panel.width, height: panel.height });
      setGoalPopupPosition(previous => previous.x === anchor.right - panel.width && previous.y === anchor.top - panel.height - 8 ? previous : { x: anchor.right - panel.width, y: anchor.top - panel.height - 8 });
    };
    const observer = new ResizeObserver(measure);
    if (goalTriggerRef) observer.observe(goalTriggerRef);
    if (goalPanelRef) observer.observe(goalPanelRef);
    if (surfaceRef) observer.observe(surfaceRef);
    const frame = requestAnimationFrame(measure);
    const outside = (event: PointerEvent) => {
      const path = event.composedPath();
      if (goalPanelRef && path.includes(goalPanelRef) || goalTriggerRef && path.includes(goalTriggerRef)) return;
      closeGoalEditor(false, false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || goalComposing()) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeGoalEditor(); }
      if (event.key === 'Tab' && goalPanelRef) {
        const items = [...goalPanelRef.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), textarea:not(:disabled)')];
        if (event.shiftKey && document.activeElement === items[0] || !event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); closeGoalEditor(); }
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown, true);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    onCleanup(() => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keydown, true); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); });
  });
  const goalPending = createMemo(() => goalPreparingScopes().includes(currentComposerSessionKey())
    || transportOutbox().forThread(currentComposerSessionKey()).some(entry => (entry.operation === 'goal' || !selectedThreadID()) && !entry.terminalError)
    || !selectedThreadID() && composerSendPreparing());
  const enqueueGoal = async (operation: 'set' | 'delete', text: string, fromCommand = false) => {
    if (pendingThreadSelection()) return;
    const adapter = props.adapter;
    if (adapter.canMutate === false || selectedThreadReadOnly() || !adapter.manageGoal) {
      notifyComposerError(copy().chat.goalUnavailable); return;
    }
    const sessionKey = currentComposerSessionKey();
    if (goalPending()) return;
    if (operation === 'set' && !text.trim()) return;
    const session = draftSessionFor(sessionKey);
    const frozen = session.snapshot();
    const threadID = selectedThreadID();
    if (operation === 'delete' && !threadID) {
      if (fromCommand) exitGoalCommand();
      closeGoalEditor(); return;
    }
    const selectionSequence = threadLoadSequence;
    const requestID = createFlowerClientRequestID();
    const editor = frozen.value.goal_edit;
    if (!fromCommand && (goalPopupLoad() !== 'ready' || goalComposing() || operation === 'set' && !goalCanSave())) return;
    const expectedVersion = !fromCommand && operation === 'delete' ? goalCurrentVersionSeen()
      : !fromCommand && editor ? (goalDraftStale() ? goalReviewedVersion()! : editor.version) : selectedGoal()?.version ?? 0;
    if (expectedVersion === undefined) return;
    const popupAttempt = !fromCommand ? goalPopupAttempt : undefined;
    const reasoning = serializeFlowerReasoningSelection(composerLaunchReasoningSelection());
    const newSettings = { model_id: selectedComposerModelID(), working_dir: displayedWorkingDirectory(),
      permission_type: composerPermissionType() || defaultComposerPermissionType(),
      ...(reasoning ? { reasoning_selection: reasoning } : {}) };
    setGoalPreparingScopes(scopes => [...scopes, sessionKey]);
    try {
      const generation = await withFlowerRequestDeadline(() => adapter.resolveStorageGeneration?.() ?? Promise.resolve(''), copy().settings.dialog.catalog.retryTimedOut);
      if (surfaceDisposed) return;
      const goalInput: FlowerGoalInput = { storage_generation: generation, client_request_id: requestID,
        ...(threadID ? { thread_id: threadID } : { new_thread: newSettings }),
        operation: operation === 'set' && fromCommand ? 'submit' : operation, expected_version: expectedVersion, ...(operation === 'set' ? { text } : {}) };
      outboxOperations.set(requestID, { adapter });
      pendingAdmissionHandoffs.set(requestID, { sessionKey, selectionSequence, goalEdit: editor, goalPopupAttempt: popupAttempt, goalFromCommand: fromCommand, settle: (canonicalThreadID) => {
        if (fromCommand && frozen.value.goal_command && session.snapshot().value.goal_command === frozen.value.goal_command) session.mutate(value => ({ ...value, goal_command: undefined }));
        else if (fromCommand && !frozen.value.goal_command && session.snapshot().text_revision === frozen.text_revision) updateComposerSessionText(sessionKey, '');
        if (!fromCommand && operation === 'set' && session.snapshot().value.goal_edit === frozen.value.goal_edit) session.mutate(value => ({ ...value, goal_edit: undefined }));
        if (isPendingDraftKey(sessionKey)) {
          draftCoordinator.moveScope(sessionKey, canonicalThreadID);
          if (sessionKey.startsWith(PENDING_NEW_THREAD_ID + ':')) embeddedThreads.set(sessionKey, canonicalThreadID);
        }
      } });
      setTransportOutbox(outbox => outbox.put({ operation: 'goal', goalInput,
        requestId: requestID, threadId: threadID || sessionKey,
        input: { client_request_id: requestID, ...(threadID ? { thread_id: threadID } : {}), storage_generation: generation, prompt: '' },
        ...(!threadID ? { provisionalThreadSettings: newSettings } : {}),
        attachmentLabels: [], createdAtMs: Date.now(), delivery: 'pending' }));
    } catch (error) { notifyComposerError(getErrorMessage(error)); }
    finally { setGoalPreparingScopes(scopes => scopes.filter(key => key !== sessionKey)); }
  };
  const acceptGoalResult = (entry: TransportOutboxEntry, result: FlowerGoalResult, requestEpoch: number) => {
    if (!result || result.client_request_id !== entry.requestId || !result.thread_id || !result.current || result.current.thread_id !== result.thread_id
      || (entry.goalInput?.thread_id && entry.goalInput.thread_id !== result.thread_id)) throw flowerTurnAdmissionError('unknown', new Error('Goal response identity differs from the request.'));
    let goal, currentGoal;
    try { goal = mapFlowerGoal(result.goal); currentGoal = mapFlowerGoal(result.current.goal); }
    catch (error) { throw flowerTurnAdmissionError('unknown', error); }
    if (currentGoal.version < goal.version || typeof result.conflict !== 'boolean'
      || result.replayed !== undefined && typeof result.replayed !== 'boolean'
      || currentGoal.version === goal.version && (currentGoal.text !== goal.text || currentGoal.actor !== goal.actor)) {
      throw flowerTurnAdmissionError('unknown', new Error('Goal response state is inconsistent.'));
    }
    const handoff = pendingAdmissionHandoffs.get(entry.requestId);
    const transfer = Boolean(handoff && isPendingDraftKey(handoff.sessionKey) && handoff.selectionSequence === threadLoadSequence && !selectedThreadID());
    batch(() => {
      if (!result.conflict) handoff?.settle(result.thread_id, transfer);
      else if (handoff && isPendingDraftKey(handoff.sessionKey)) draftCoordinator.moveScope(handoff.sessionKey, result.thread_id);
      if (!entry.goalInput?.thread_id) setTransportOutbox(outbox => outbox.bindAcceptedThread(entry.requestId, result.thread_id));
      if (transfer) {
        beginThreadDetailDisplayCycle(result.thread_id);
        setThreadCache(cache => cache.select(result.thread_id));
        setThreadLoadError(''); setSidePanel('chat');
      }
      if (requestEpoch === liveTransport.connectionEpoch()) applyRuntimeCurrent(result.current, undefined, undefined, undefined, 'user_action', entry.provisionalThreadSettings);
      const editorScope = handoff?.sessionKey ?? entry.threadId;
      const editor = draftSessionFor(result.thread_id).snapshot().value.goal_edit
        ?? draftSessionFor(editorScope).snapshot().value.goal_edit;
      const retainedText = editor?.text ?? entry.goalInput?.text ?? result.goal.text ?? '';
      if (result.conflict) {
        const command = draftSessionFor(result.thread_id).snapshot().value.goal_command;
        if (entry.goalInput?.operation === 'submit' || handoff?.goalFromCommand) {
          draftSessionFor(result.thread_id).mutate(value => ({ ...value, goal_command: { text: command?.text ?? entry.goalInput?.text ?? '', error: copy().chat.goalConflict } }));
        } else {
          if (entry.goalInput?.operation === 'set' && !editor && !handoff) storeGoalEditor(result.thread_id, { text: retainedText, version: entry.goalInput.expected_version });
          if (selectedThreadID() === result.thread_id && goalPopupOpen() && handoff?.goalPopupAttempt === goalPopupAttempt) {
            setGoalReviewedVersion(undefined);
            if (entry.goalInput?.operation === 'delete') setGoalDeleteConflict(true);
          }
        }
      } else if (entry.goalInput?.operation === 'set' && editor && handoff?.goalEdit
        && goalEditOrigin(editor) === goalEditOrigin(handoff.goalEdit) && editor.version === handoff.goalEdit.version) {
        storeGoalEditor(result.thread_id, { ...editor, version: goal.version }, editor);
      }
      if (!result.conflict && !draftSessionFor(result.thread_id).snapshot().value.goal_edit && selectedThreadID() === result.thread_id && goalPopupOpen() && handoff?.goalPopupAttempt === goalPopupAttempt) closeGoalEditor(false, false);
      pendingAdmissionHandoffs.delete(entry.requestId);
      outboxOperations.delete(entry.requestId);
      setTransportOutbox(outbox => outbox.drop(entry.requestId));
    });
    void requestThreadDetail(result.thread_id, 'user_action', true).catch(() => undefined);
  };
  const executeComposerCommand = (suggested?: '/compact' | '/goal' | 'compact-only') => {
    if (!settingsReady()) return;
    if (goalCommand()) {
      const text = goalCommand()!.text.trim();
      if (text) void enqueueGoal(text === 'clear' ? 'delete' : 'set', text === 'clear' ? '' : text, true);
      return;
    }
    const command = composerSlashCommand();
    const choice = suggested ?? composerCommandSuggested();
    if (choice === 'compact-only') { void executeCompactContextCommand(selectedThread(), () => true, false); return; }
    const parsed = suggested || command.kind === 'suggest' ? parseFlowerSlashCommand(choice) : command;
    if (parsed.kind !== 'intent') return;
    if (parsed.command === '/compact') { void executeCompactContextCommand(); return; }
    if (parsed.operation === 'open') {
      if (command.kind === 'intent' || command.kind === 'suggest') updateComposerText('');
      enterGoalCommand();
    } else void enqueueGoal(parsed.operation, parsed.text ?? '', true);
  };

  const executeCompactContextCommand = async (target = selectedThread(), stillTargeted = () => true, continueGoal = true) => {
    const mutationAllowed = () => props.adapter.canMutate !== false;
    const threadID = trimString(target?.thread_id);
    const child = trimString(target?.parent_thread_id);
    const fromComposer = threadID === selectedThreadID();
    const requestEpoch = liveTransport.connectionEpoch();
    const selectionSequence = threadLoadSequence;
    const childGeneration = activeSubagentDetail()?.generation;
    const targetCurrent = () => !surfaceDisposed && requestEpoch === liveTransport.connectionEpoch()
      && selectionSequence === threadLoadSequence
      && (fromComposer ? selectedThreadID() === threadID
        : activeSubagentID() === threadID && activeSubagentDetail()?.generation === childGeneration);
    if (!threadID) { notifyComposerError(copy().chat.compactContextEmpty); return; }
    if (!mutationAllowed() || (fromComposer && (threadLoadError() || selectedThreadReadOnly()))) return;
    if (!props.adapter.compactThreadContext) { notifyComposerError(copy().chat.compactContextUnavailable); return; }
    const thread = target;
    if (thread?.active_run_id || thread?.queued_turn_count || thread?.input_request || thread?.approval_pending) {
      notifyComposerError(copy().chat.compactContextBusy);
      return;
    }
    const pendingOperation = transportOutbox().forThread(threadID).find(entry => entry.operation === 'context_compaction' && !entry.terminalError);
    if (pendingOperation) {
      notifyComposerError(pendingOperation.delivery === 'unknown' ? copy().chat.sendUnknownDescription : copy().chat.compactContextBusy);
      return;
    }
    const sessionKey = fromComposer ? currentComposerSessionKey() : threadID;
    if (launchChatTurnInFlight.has(sessionKey)) return;
    launchChatTurnInFlight.add(sessionKey);
    setPreparingSendRevision(revision => revision + 1);
    const session = draftSessionFor(sessionKey);
    const frozen = session.snapshot();
    const frozenCommand = parseFlowerSlashCommand(frozen.value.text);
    const requestID = createFlowerClientRequestID();
    const selectionSignal = !fromComposer && subagentDetailReadController
      ? AbortSignal.any([navigationReadController.signal, subagentDetailReadController.signal]) : navigationReadController.signal;
    try {
      if (outboxResendInFlight.has(requestID)) return;
      const storageGeneration = await withFlowerRequestDeadline(() => props.adapter.resolveStorageGeneration?.() ?? Promise.resolve(''), copy().settings.dialog.catalog.retryTimedOut, selectionSignal);
      if (!targetCurrent() || !stillTargeted() || !mutationAllowed()) return;
      outboxOperations.set(requestID, { adapter: props.adapter });
      if (fromComposer) pendingAdmissionHandoffs.set(requestID, { sessionKey, selectionSequence: threadLoadSequence, settle: () => {
        if (session.snapshot().text_revision === frozen.text_revision && (frozenCommand.kind === 'intent' || frozenCommand.kind === 'suggest')) updateComposerSessionText(sessionKey, '');
      } });
      setTransportOutbox(outbox => outbox.put({
        operation: 'context_compaction', continueGoal, requestId: requestID, threadId: threadID,
        ...(child ? { parentThreadId: child } : {}),
        input: { client_request_id: requestID, thread_id: threadID, storage_generation: storageGeneration, prompt: '' },
        attachmentLabels: [], createdAtMs: Date.now(), delivery: 'pending',
      }));
    } catch (error) {
      if (targetCurrent() && stillTargeted()) notifyComposerError(getErrorMessage(error));
    } finally {
      launchChatTurnInFlight.delete(sessionKey);
      setPreparingSendRevision(revision => revision + 1);
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent) => {
    if (pendingThreadSelection()) { event.preventDefault(); return; }
    if (event.defaultPrevented) return;
    if (event.isComposing || isComposing() || event.keyCode === 229) return;
    if (goalCommand()) {
      if (event.key === 'Escape' || event.key === 'Backspace' && !goalCommand()!.text) { event.preventDefault(); exitGoalCommand(); return; }
      if (shouldSubmitOnEnterKeydown(event)) { event.preventDefault(); executeComposerCommand(); return; }
      return;
    }
    if ((event.key === ' ' || event.key === 'Tab') && composerTextValue().trim() === '/goal') {
      event.preventDefault(); updateComposerText(''); enterGoalCommand(); return;
    }
    if (composerTakingBackQueuedTurn() || composerReferenceMutationActive()) {
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
    if (threadLoadError() && selectedThreadID() && !composerPrimaryActionIsStop() && shouldSubmitOnEnterKeydown(event)) {
      event.preventDefault();
      return;
    }
    if (
      event.currentTarget instanceof HTMLTextAreaElement
      && !composerCommandMenuVisible()
      && composerHistory.handleKeyDown(event, event.currentTarget)
    ) {
      syncComposerSelection(event.currentTarget);
      return;
    }
    const command = composerSlashCommand();
    if (command.kind === 'intent' && shouldSubmitOnEnterKeydown(event)) {
      event.preventDefault();
      executeComposerCommand(composerCommandMenuVisible() ? composerCommandSuggested() : undefined);
      return;
    }
    if (command.kind === 'suggest' || composerCommandMenuVisible()) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const choices = composerCommandChoices();
        const index = choices.indexOf(composerCommandSuggested());
        setComposerCommandIndex((index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        updateComposerText('');
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        executeComposerCommand(composerCommandSuggested());
        return;
      }
    }
    if (command.kind === 'invalid' && shouldSubmitOnEnterKeydown(event)) {
      event.preventDefault();
      notifyComposerError(command.reason === 'arguments'
        ? copy().chat.commandArgumentsInvalid
        : copy().chat.commandUnknown(command.command));
      return;
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
      case 'provider_request_invalid': return copy().chat.runErrors.providerRequestInvalid;
      case 'provider_request_failed': return copy().chat.runErrors.providerRequestFailed;
      case 'provider_request_rejected': return copy().chat.runErrors.providerRequestRejected;
      case 'provider_model_unavailable':
      case 'model_gateway_contract_failed':
        return copy().chat.runErrorActions.switchModel;
      default:
        return copy().chat.runErrorActions.openSettings;
    }
  };

  const errorNotice = (title: string, message: string, action?: JSX.Element, className = '', detail?: JSX.Element) => (
    <div role="alert" class={cn('flower-error-card', className)}>
      <div class="flower-error-icon" aria-hidden="true"><AlertTriangle class="h-4 w-4" /></div>
      <div class="flower-error-copy">
        <div class="flower-error-title">{title}</div>
        <div class="flower-error-message">{message}</div>
        <Show when={action}>
          {(item) => <div class="flower-error-actions">{item()}</div>}
        </Show>
        {detail}
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
  const discardUnsentOutboxEntry = (entry: TransportOutboxEntry) => {
    if ((entry.delivery === 'unknown' && !entry.terminalError && entry.operation !== 'goal') || entry.delivery === 'accepted' || outboxResendInFlight.has(entry.requestId)) return;
    draftSessionFor(entry.threadId).mutate(value => value.client_request_id === entry.requestId
      ? { ...value, client_request_id: undefined, prepared_long_text_local_id: undefined, prepared_long_text_attachment_id: undefined } : value);
    pendingAdmissionHandoffs.delete(entry.requestId);
    outboxDraftRestorers.delete(entry.requestId);
    outboxOperations.delete(entry.requestId);
    setTransportOutbox(outbox => outbox.drop(entry.requestId));
  };
  const restoreUnsentOutboxEntry = (entry: TransportOutboxEntry) => {
    if ((entry.delivery === 'unknown' && !entry.terminalError) || entry.delivery === 'accepted' || outboxResendInFlight.has(entry.requestId)) return;
    const draft = draftSessionFor(entry.threadId).snapshot().value;
    if (draft.text || draft.references.length || draft.attachments.length) return;
    const restore = !entry.terminalError && outboxDraftRestorers.get(entry.requestId);
    if (restore) {
      if (!restore()) return;
    } else {
      if (!entry.terminalError && (entry.input.attachment_ids?.length ?? 0) > 0) return;
      batch(() => {
        draftSessionFor(entry.threadId).mutate(value => ({ ...value, text: entry.draftText ?? entry.input.prompt, references: entry.draftReferences ?? [], mode: 'ordinary', client_request_id: undefined }));
        updateComposerSessionDraft(entry.threadId, value => ({ ...value, chatDraft: entry.draftText ?? entry.input.prompt, references: entry.draftReferences ?? [] }));
      });
    }
    if (entry.delivery !== 'unknown') discardUnsentOutboxEntry(entry);
    focusComposerIfConnected();
  };
  const retryOutboxEntry = (entry: TransportOutboxEntry) => {
    if (entry.terminalError || outboxResendInFlight.has(entry.requestId)) return;
    setTransportOutbox(outbox => outbox.put({ ...entry, delivery: 'pending', deliveryError: undefined }));
    setOutboxRetryTick(tick => tick + 1);
  };
  const refreshOutboxEntry = (entry: TransportOutboxEntry) => {
    if (isPendingDraftKey(entry.threadId)) { void refreshDirectory(); return; }
    if (entry.parentThreadId && activeSubagentID() === entry.threadId) { void refreshActiveSubagentDetail(); return; }
    void requestThreadDetail(entry.threadId, 'user_action', true).catch(error => notifyThreadActionError(getErrorMessage(error)));
  };
  const outboxRecoveryActions = (entry: Accessor<TransportOutboxEntry>) => {
    const unknown = () => entry().delivery === 'unknown';
    const failed = () => entry().delivery === 'failed';
    const settled = () => entry().delivery === 'accepted';
    const recoveryCopy = () => Boolean(entry().terminalError);
    const localRecoveryCopy = () => recoveryCopy() || unknown() && entry().operation === 'goal';
    const mutableUnsent = () => { outboxRetryTick(); return (!unknown() || recoveryCopy() || entry().operation === 'goal') && !settled() && !outboxResendInFlight.has(entry().requestId); };
    const emptyDraft = () => { const value = reactiveDraftSnapshotFor(entry().threadId).value; return !value.text && !value.references.length && !value.attachments.length; };
    return <>
      <Show when={(failed() || unknown()) && !recoveryCopy()}><button type="button" class="flower-queued-turn-action" aria-label={copy().chat.retrySend} title={copy().chat.retrySend}
        onClick={() => retryOutboxEntry(entry())}><Refresh aria-hidden="true" /></button></Show>
      <Show when={unknown() || settled() || recoveryCopy()}><button type="button" class="flower-queued-turn-action" aria-label={copy().chat.refreshSend} title={copy().chat.refreshSend}
        onClick={() => refreshOutboxEntry(entry())}><Refresh aria-hidden="true" /></button></Show>
      <Show when={(failed() || unknown()) && !entry().operation}><button type="button" class="flower-queued-turn-action" aria-label={copy().chat.restoredInputCopy} title={copy().chat.restoredInputCopy}
        onClick={() => void writeClipboardText(entry().draftText ?? entry().input.prompt, copy().chat.restoredInputCopy).catch(error => notifyThreadActionError(getErrorMessage(error)))}><Copy aria-hidden="true" /></button></Show>
      <Show when={mutableUnsent()}>
        <Show when={!entry().operation}><button type="button" class="flower-queued-turn-action" aria-label={copy().chat.restoreSend} title={copy().chat.restoreSend}
          disabled={!emptyDraft()}
          onClick={() => restoreUnsentOutboxEntry(entry())}><Pencil aria-hidden="true" /></button></Show>
        <button type="button" class="flower-queued-turn-action flower-queued-turn-delete" aria-label={localRecoveryCopy() ? copy().chat.removeRecoveryCopy : copy().chat.deleteUnsent}
          title={localRecoveryCopy() ? copy().chat.removeRecoveryCopyDescription : copy().chat.deleteUnsent}
          onClick={() => discardUnsentOutboxEntry(entry())}><Trash aria-hidden="true" /></button>
      </Show>
    </>;
  };
  const canonicalReferencePreviewAvailable = () => Boolean(props.adapter.openCanonicalReference || props.adapter.resolveCanonicalReference);
  const openQueuedPathPreview = async (
    target: Readonly<{ kind: 'file' | 'directory'; label: string; path: string }>,
    source: Omit<FlowerChatContextSnapshotPreview, 'title' | 'action'>,
  ) => {
    const selection = threadLoadSequence;
    captureSnapshotPreviewFocus();
    if (target.kind === 'file' && props.adapter.loadMessageFile) {
      setAttachmentPreview({ id: `reference:${source.thread_id}:${source.message_id}:${target.path}`, name: target.label,
        mimeType: '', load: signal => props.adapter.loadMessageFile!({ path: target.path, signal }) });
    } else if (target.kind === 'directory' && props.adapter.listWorkingDirectoryEntries) {
      const entries = await props.adapter.listWorkingDirectoryEntries({ path: target.path, showHidden: true });
      if (surfaceDisposed || selection !== threadLoadSequence) return;
      setContextSnapshotPreview({ ...source, title: target.label,
        action: { type: 'open_text_preview', title: target.label, context_index: 0, subtitle: target.path, body: entries.map(entry => entry.name + (entry.isDirectory ? '/' : '')).join('\n') || copy().filesystemPicker.empty } });
    }
  };
  const openCanonicalReferencePreview = async (request: Parameters<NonNullable<FlowerSurfaceAdapter['openCanonicalReference']>>[0]) => {
    if (!props.adapter.resolveCanonicalReference) return props.adapter.openCanonicalReference?.(request);
    const selection = threadLoadSequence;
    const target = await props.adapter.resolveCanonicalReference(request);
    if (surfaceDisposed || selection !== threadLoadSequence) return;
    await openQueuedPathPreview(target, { thread_id: request.thread_id, message_id: request.queue_id || request.turn_id || '', canonical_reference: request });
  };
  const queuedContextDisplay = (turn: FlowerQueuedTurn) => (parseChatMessageReferences(turn.references) ?? parseChatContextAction(turn.context_action));
  const activateQueuedContextChip = async (turn: FlowerQueuedTurn, chip: FlowerChatContextChip) => {
    const action = chip.action;
    if (!action) return;
    const threadID = trimString(selectedThreadID());
    if (action.type === 'open_text_preview' || action.type === 'open_process_preview' || action.type === 'open_thread_preview') {
      captureSnapshotPreviewFocus(); setContextSnapshotPreview({ title: chip.label, action, thread_id: threadID, message_id: `queued:${turn.queue_id}` }); return;
    }
    try {
      if (action.type === 'open_canonical_reference') {
        await openCanonicalReferencePreview({ thread_id: threadID, queue_id: turn.queue_id, reference_id: action.reference_id }); return;
      }
      const display = queuedContextDisplay(turn);
      if (display?.authority !== 'queued_context_action') return;
      if ((action.type === 'open_linked_file_preview' && props.adapter.loadMessageFile)
        || (action.type === 'open_linked_directory_browser' && props.adapter.listWorkingDirectoryEntries)) {
        await openQueuedPathPreview({ kind: action.type === 'open_linked_file_preview' ? 'file' : 'directory', label: chip.label, path: action.path },
          { thread_id: threadID, message_id: `queued:${turn.queue_id}`, source_action: action });
        return;
      }
      const request = { path: action.path, thread_id: threadID, message_id: `queued:${turn.queue_id}`, context_index: action.context_index, source_surface: display.surface, target: display.target };
      if (action.type === 'open_linked_file_preview') await props.adapter.openLinkedFilePreview?.(request);
      else await props.adapter.openLinkedDirectoryBrowser?.(request);
    } catch (error) { notifyThreadActionError(getErrorMessage(error)); }
  };
  const queuedReferenceCanOpen = (chip: FlowerChatContextChip) => {
    const action = chip.action;
    if (!action) return false;
    if (action.type === 'open_canonical_reference') return canonicalReferencePreviewAvailable();
    if (action.type === 'open_linked_file_preview') return Boolean(props.adapter.loadMessageFile || props.adapter.openLinkedFilePreview);
    if (action.type === 'open_linked_directory_browser') return Boolean(props.adapter.listWorkingDirectoryEntries || props.adapter.openLinkedDirectoryBrowser);
    return true;
  };
  const queuedContentPreviews = (turn: Accessor<FlowerQueuedTurn>, transport: Accessor<TransportOutboxEntry | undefined>) => {
    const attachments = createMemo(() => turn().attachments ?? transport()?.draftAttachments?.flatMap(item => item.staged ? [{ ...item.staged, url: `staged:${item.staged.attachment_id}` }] : []) ?? []);
    const load = (attachment: FlowerQueuedTurnAttachment, signal: AbortSignal) => {
      const entry = transport(), staged = entry?.draftAttachments?.find(item => item.staged?.attachment_id === attachment.attachment_id)?.staged;
      if (staged && entry?.input.staging_scope && props.adapter.loadStagedAttachmentPreview) return props.adapter.loadStagedAttachmentPreview(staged, entry.input.staging_scope, signal);
      return loadMessageAttachmentBlob(attachment.url ?? '', signal);
    };
    type Preview = Readonly<{ id: string; label: string; attachment?: FlowerQueuedTurnAttachment; chip?: FlowerChatContextChip }>;
    const previews = createMemo<readonly Preview[]>(previous => retainKeyedItems(previous, [
      ...attachments().map(attachment => ({ id: `attachment:${attachment.attachment_id}`, label: attachment.name, attachment })),
      ...(queuedContextDisplay(turn())?.chips ?? []).map(chip => ({ id: `reference:${chip.id}`, label: chip.label, chip })),
    ], preview => preview.id));
    const available = (preview: Preview) => preview.attachment ? Boolean(preview.attachment.url) : Boolean(preview.chip && queuedReferenceCanOpen(preview.chip));
    const open = (preview: Preview) => {
      if (preview.attachment) {
        const attachment = preview.attachment;
        captureSnapshotPreviewFocus();
        setAttachmentPreview({ id: preview.id, name: attachment.name, mimeType: attachment.mime_type, load: signal => load(attachment, signal) });
      } else if (preview.chip) void activateQueuedContextChip(turn(), preview.chip);
    };
    const icon = (preview: Preview) => preview.attachment ? <Show when={preview.attachment.mime_type.startsWith('image/') && preview.attachment.url}
      fallback={<FileItemIcon size={18} item={{ name: preview.label, type: 'file' }} />}>
      <FlowerMessageImage src={preview.attachment.url!} alt="" name={preview.label} unavailableLabel={copy().chat.media.unavailable} thumbnail
        load={(_url, signal) => load(preview.attachment!, signal)} onOpen={() => open(preview)} />
    </Show> : <FlowerContextIcon tone={preview.chip!.tone} name={preview.label} />;
    return <Show when={previews().length}><div class="flower-queue-previews">
      <For each={previews().slice(0, 3)}>{preview => <button type="button" class="flower-queue-preview" disabled={!available(preview)}
        data-flower-queued-attachment={preview.attachment?.attachment_id} data-flower-queued-reference={preview.chip?.id}
        aria-label={`${attachmentCopy().preview}: ${preview.label}`} title={preview.label} onClick={() => open(preview)}>{icon(preview)}</button>}</For>
      <Show when={previews().length > 3}><Dropdown trigger={<span aria-hidden="true">+{previews().length - 3}</span>}
        triggerClass="flower-queue-preview" triggerAriaLabel={copy().chat.linkedContextLabel} align="end"
        items={() => previews().slice(3).map(preview => ({ id: preview.id, label: preview.label, disabled: !available(preview), icon: () => icon(preview) }))}
        onSelect={id => { const preview = previews().find(item => item.id === id); if (preview) open(preview); }} /></Show>
    </div></Show>;
  };
  const queuedTurnsDock = () => (
    <Show when={selectedQueueDockRows().length > 0}>
      <div class="flower-queued-turn-dock" role="list" aria-label={copy().chat.pendingQueued}
        onDragOver={previewQueuedTurnDropAtEnd} onDrop={commitQueuedTurnReorder}>
        <FlowerKeyedList scope={trimString(selectedThreadID()) || pendingDraftKey()} focusFallback={focusComposerIfConnected}
          each={selectedQueueDockRows()} identity={row => row.requestKey}>
          {row => {
            const transport = () => row().transport;
            const turn = (): FlowerQueuedTurn => row().canonical ?? {
              queue_id: row().requestKey, prompt: transport()?.input.prompt ?? '',
              created_at_ms: transport()?.createdAtMs ?? 0, context_action: transport()?.input.context_action,
            };
            const queueID = () => trimString(turn().queue_id);
            const label = () => transport()?.operation === 'goal' ? copy().chat.goalTitle : transport()?.operation === 'context_compaction' ? transport()?.continueGoal === true ? copy().chat.compactContext : copy().chat.compactContextOnly
              : transport()?.draftText || transport()?.input.prompt || transport()?.attachmentLabels.join(', ') || queuedTurnDisplayLabel(turn());
            const dragging = () => queuedTurnReorder()?.draggedQueueID === queueID();
            const failed = () => transport()?.delivery === 'failed' || Boolean(transport()?.terminalError && transport()?.delivery !== 'unknown' && transport()?.delivery !== 'accepted');
            const unknown = () => transport()?.delivery === 'unknown';
            const status = () => transport() ? failed() ? copy().chat.sendFailed : unknown() ? copy().chat.sendUnknown
              : transport()?.operation ? copy().chat.sendWaiting : copy().chat.pendingQueueAdmission : copy().chat.pendingQueued;
            const deliveryDescription = () => transport()?.terminalError === 'attachments_unavailable_after_restart' ? copy().chat.attachmentRecoveryDescription
              : transport()?.terminalError === 'storage_restored' ? transport()?.operation === 'context_compaction' ? copy().chat.compactionStorageRestored : copy().chat.restoredInputDescription
              : transport()?.terminalError === 'preparation_unavailable_after_restart' ? copy().chat.sendPreparationRecoveryDescription
              : unknown() ? copy().chat.sendUnknownDescription : '';
            return <div class="flower-queued-turn-item" role="listitem" aria-label={`${status()}: ${label()}`} aria-description={deliveryDescription() || undefined}
              draggable={!transport() && queuedTurnReorderEnabled()}
              data-flower-queued-turn-dock-id={queueID()}
              data-flower-transport-outbox-id={transport()?.requestId}
              data-flower-transport-delivery={transport()?.delivery}
              data-flower-delivery-explanation={deliveryDescription() ? 'true' : undefined}
              data-flower-queued-turn-dragging={dragging() && queuedTurnReorder()?.phase === 'dragging' ? 'true' : undefined}
              title={deliveryDescription() || transport()?.deliveryError}
              onDragStart={event => { if (!transport()) beginQueuedTurnDrag(event, queueID()); }}
              onDragOver={event => { if (!transport()) previewQueuedTurnDrop(event, queueID()); }}
              onDrop={event => { event.stopPropagation(); commitQueuedTurnReorder(event); }} onDragEnd={finishQueuedTurnDrag}>
              <Show when={!transport()} fallback={<Show when={failed() || unknown()} fallback={<Clock class="flower-queued-turn-handle" aria-hidden="true" />}><AlertCircle class="flower-queued-turn-handle" aria-hidden="true" /></Show>}>
                <GripVertical class="flower-queued-turn-handle" aria-hidden="true" />
              </Show>
              <div class="flower-queued-turn-content">
                <span class="flower-queued-turn-label" title={label()}>{label()}</span>
                <Show when={transport()}><span class="flower-queued-turn-compact-meta" role="status">{status()}</span></Show>
                {queuedContentPreviews(turn, transport)}
              </div>
              <div class="flower-queued-turn-actions">
                <Show when={transport()} fallback={<>
                  <Show when={props.adapter.prepareQueuedTurnDraft && props.adapter.takeBackQueuedTurn && turn().input_fingerprint}><button type="button" class="flower-queued-turn-action"
                    disabled={queuedTurnSendBlocked(trimString(selectedThreadID())) || composerSendPreparing() || Boolean(selectedInputRequest()) || Boolean(selectedComposerApprovalDisplayAction())}
                    data-flower-queued-turn-edit={queueID()} aria-label={copy().chat.queuedEdit} title={copy().chat.queuedEdit}
                    aria-busy={queueTakeBackPending().get(trimString(selectedThreadID())) === queueID() ? 'true' : undefined}
                    onClick={event => { event.stopPropagation(); void takeBackQueuedTurn(turn()); }}><Show when={queueTakeBackPending().get(trimString(selectedThreadID())) !== queueID()} fallback={<Refresh class="motion-safe:animate-spin" aria-hidden="true" />}><Pencil aria-hidden="true" /></Show></button></Show>
                  <Show when={props.adapter.sendQueuedTurnNow}><button type="button" class="flower-queued-turn-action flower-queued-turn-send"
                    disabled={queuedTurnSendBlocked(trimString(selectedThreadID()))}
                    aria-busy={queuedTurnSendPending(trimString(selectedThreadID()), queueID()) ? 'true' : undefined}
                    aria-label={copy().chat.queuedSendNow} title={copy().chat.queuedSendNowDescription}
                    onClick={event => { event.stopPropagation(); void sendQueuedTurnNow(turn()); }}>
                    <Show when={!queuedTurnSendPending(trimString(selectedThreadID()), queueID())} fallback={<Refresh class="motion-safe:animate-spin" aria-hidden="true" />}><Send aria-hidden="true" /></Show>
                  </button></Show>
                  <Show when={props.adapter.deleteQueuedTurn}><button type="button" class="flower-queued-turn-action flower-queued-turn-delete"
                    disabled={queuedTurnSendPending(trimString(selectedThreadID())) || queueTakeBackPending().has(trimString(selectedThreadID()))} aria-label={copy().chat.queuedDelete} title={copy().chat.queuedDelete}
                    data-flower-queued-turn-delete={queueID()} onClick={event => { event.stopPropagation(); void deleteQueuedTurn(turn()); }}><Trash aria-hidden="true" /></button></Show>
                </>}>
                  {entry => outboxRecoveryActions(entry)}
                </Show>
              </div>

            </div>;
          }}
        </FlowerKeyedList>
      </div>
    </Show>
  );

  const permissionSelector = () => {
    const canUseMenu = createMemo(() => composerPermissionAvailable());
    const interactive = createMemo(() => composerPermissionInteractive());
    const permissionLabel = createMemo(() => composerPermissionCopy()?.label ?? copy().chat.permissionSelectorLabel);
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
              title={permissionSelectorTitle()}
              aria-label={permissionSelectorTitle()}
            >
              <Shield class="flower-permission-icon" />
              <span class="flower-permission-label">{permissionLabel()}</span>
            </span>
          )}
        >
          <button
            ref={permissionTriggerRef}
            type="button"
            class={cn('flower-permission-trigger', !interactive() && 'flower-permission-trigger-readonly')}
            data-permission-type={composerPermissionType()}
            aria-label={permissionSelectorTitle()}
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
            <span class="flower-permission-label">{permissionLabel()}</span>
            <span class="flower-permission-saving-dot" aria-hidden="true" style={{ visibility: permissionPatchPending() ? 'visible' : 'hidden' }} />
          </button>
        </Show>
        <Show when={permissionMenuOpen()}>
          <div
            id="flower-composer-permission-menu"
            ref={permissionMenuRef}
            class="flower-permission-menu"
            data-floe-local-interaction-surface="true"
            role="listbox"
            aria-label={copy().chat.permissionSelectorLabel}
            aria-activedescendant={permissionOptionID(FLOWER_PERMISSION_TYPES[permissionMenuActiveIndex()] ?? composerPermissionType() ?? 'readonly')}
            onKeyDown={handlePermissionMenuKeyDown}
          >
            <For each={FLOWER_PERMISSION_TYPES}>
              {(permissionType, index) => {
                const itemCopy = createMemo(() => copy().settings.permissionTypes[permissionType]);
                const selected = createMemo(() => composerPermissionType() === permissionType);
                return (
                  <div class="flower-permission-menu-entry">
                    <button
                      id={permissionOptionID(permissionType)}
                      type="button"
                      role="option"
                      tabIndex={permissionMenuActiveIndex() === index() ? 0 : -1}
                      data-permission-type={permissionType}
                      aria-selected={selected()}
                      aria-describedby={`${permissionOptionID(permissionType)}-description`}
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
                    </button>
                    <span id={`${permissionOptionID(permissionType)}-description`} class="flower-permission-menu-description">{itemCopy().description}</span>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    );
  };

  const latestExecutionCompaction = (thread: FlowerThreadSnapshot | null | undefined) =>
    thread?.context_compactions?.filter(item => item.run_id === thread.current_execution?.run_id)
      .reduce<NonNullable<FlowerThreadSnapshot['context_compactions']>[number] | undefined>((last, item) =>
        !last || item.canonical_ordinal >= last.canonical_ordinal ? item : last, undefined);
  const isCompactionRecovery = (thread: FlowerThreadSnapshot | null | undefined) => {
    if (!thread || thread.current_execution?.turn_kind !== 'context_compaction' || thread.active_run_id) return false;
    const operation = latestExecutionCompaction(thread);
    return operation ? operation.status === 'failed' || operation.status === 'cancelled'
      : thread.status === 'failed' || thread.status === 'canceled';
  };
  const compactionRecoveryPending = (thread: FlowerThreadSnapshot | null | undefined) => {
    preparingSendRevision();
    outboxRetryTick();
    const threadID = trimString(thread?.thread_id);
    return retryingThreads().has(threadID) || launchChatTurnInFlight.has(threadID)
      || (threadID === selectedThreadID() && launchChatTurnInFlight.has(currentComposerSessionKey()))
      || transportOutbox().forThread(threadID).some(entry => !entry.terminalError
        && (entry.delivery === 'pending' || outboxResendInFlight.has(entry.requestId)));
  };
  const threadRecoveryBlocked = (thread: FlowerThreadSnapshot | null | undefined, ownsPreflight = false) =>
    !thread || !settingsReady() || props.adapter.canMutate === false
    || (!thread.parent_thread_id && Boolean(trimString(thread.read_only_reason)))
    || thread.error?.code === 'floret_effect_outcome_unknown'
    || Boolean(thread.active_run_id || thread.input_request || thread.approval_pending || thread.queued_turn_count)
    || ['running', 'waiting_approval', 'waiting_user'].includes(thread.status)
    || transportOutbox().forThread(thread.thread_id).some(entry => !entry.terminalError && entry.delivery !== 'accepted')
    || (!ownsPreflight && compactionRecoveryPending(thread));
  const latestCompactionRecovery = (thread: FlowerThreadSnapshot | null | undefined) => {
    if (!isCompactionRecovery(thread)) return undefined;
    const latest = latestExecutionCompaction(thread);
    return latest && (latest.status === 'failed' || latest.status === 'cancelled') ? latest : undefined;
  };
  const retryThreadContinuation = async (targetThread: Accessor<FlowerThreadSnapshot | null | undefined>, expectedCompactionRunID?: string) => {
    const threadID = trimString(targetThread()?.thread_id);
    if (!threadID || threadRecoveryBlocked(targetThread())) return;
    setRetryingThreads(previous => new Set([...previous, threadID]));
    const requestEpoch = liveTransport.connectionEpoch();
    const selectionSequence = threadLoadSequence;
    const childSelection = activeSubagentDetail();
    const child = childSelection?.childThreadID === threadID ? childSelection : null;
    const selectionSignal = child && subagentDetailReadController
      ? AbortSignal.any([navigationReadController.signal, subagentDetailReadController.signal]) : navigationReadController.signal;
    const stillTargeted = () => !surfaceDisposed && requestEpoch === liveTransport.connectionEpoch()
        && selectionSequence === threadLoadSequence
        && (child ? activeSubagentDetail()?.childThreadID === threadID && activeSubagentDetail()?.parentThreadID === child.parentThreadID && activeSubagentDetail()?.generation === child.generation
          : selectedThreadID() === threadID);
    try {
      let current: FlowerThreadSnapshot | null;
      if (child) {
        const detail = await withFlowerRequestDeadline(() => props.adapter.loadSubagentDetail(child.parentThreadID, threadID), copy().settings.dialog.catalog.retryTimedOut, selectionSignal);
        if (!stillTargeted()) return;
        if (detail.summary.thread_id !== threadID || detail.summary.parent_thread_id !== child.parentThreadID || detail.current.thread_id !== threadID) throw new Error('Subagent recovery returned a different thread.');
        current = projectSubagentDetailThread(detail);
        acceptActiveSubagentCurrent(child.parentThreadID, detail.current, detail.summary, detail.model_context, detail.context_usage, detail.context_compactions, detail.timeline_decorations);
      } else {
        current = await requestThreadDetail(threadID, 'user_action', true);
      }
      if (!current || !stillTargeted() || (current.status !== 'failed' && !isCompactionRecovery(current)) || current.error?.code === 'floret_effect_outcome_unknown'
        || (expectedCompactionRunID !== undefined && (!isCompactionRecovery(current) || current.current_execution?.run_id !== expectedCompactionRunID))
        || threadRecoveryBlocked(current, true)) return;
      if (current.current_execution?.turn_kind === 'context_compaction') {
        if (!isCompactionRecovery(current)) return;
        await executeCompactContextCommand(current, () => stillTargeted()
          && !threadRecoveryBlocked(targetThread(), true)
          && targetThread()?.current_execution?.run_id === current.current_execution?.run_id, false);
        return;
      }
      await withFlowerRequestDeadline(() => props.adapter.retryThread(threadID), copy().settings.dialog.catalog.retryTimedOut, selectionSignal);
      if (!stillTargeted()) return;
      if (child) {
        await refreshActiveSubagentDetail();
      } else await requestThreadDetail(threadID, 'user_action', true, true);
    } catch (error) {
      if (selectionSignal.aborted) return;
      reportThreadDetailDiagnostic(threadID, 'request_or_mapping', 'user_action', error);
      if (stillTargeted()) notifyThreadActionError(getErrorMessage(error));
    } finally {
      setRetryingThreads(previous => { const next = new Set(previous); next.delete(threadID); return next; });
    }
  };

  const runErrorNotice = (error: FlowerThreadSnapshot['error'], targetThread: Accessor<FlowerThreadSnapshot | null | undefined>) => {
    const code = trimString(error?.code);
    const correctionFailure = code === 'floret_tool_argument_correction_exhausted';
    const contextFailure = code === 'context_budget_invalid' || code === 'context_fixed_overhead' || code === 'context_compaction_limit';
    const retryPending = () => retryingThreads().has(trimString(targetThread()?.thread_id));
    const retryBlocked = () => threadRecoveryBlocked(targetThread())
      || (isCompactionRecovery(targetThread()) && !props.adapter.compactThreadContext);
    const configureBlocked = () => props.adapter.canMutate === false || configuringProviderThreadID() === trimString(targetThread()?.thread_id);
    const [detailsCopied, setDetailsCopied] = createSignal(false);
    const stoppedUnknown = () => code === 'floret_effect_outcome_unknown' && targetThread()?.cancellation?.source === 'user_stop';
    const continuationFailure = createMemo(() => {
      const thread = targetThread();
      return code === 'floret_control_contract_failed'
        || Boolean(thread && flowerTimelineHasUserRejectedTool(buildFlowerTimelineEntries(thread))
          && (code === 'provider_unreachable' || code === 'provider_stream_interrupted'));
    });
    const actionable = code === 'chatgpt_review_required' || code === 'chatgpt_storage_unavailable' || code === 'chatgpt_authorization_required' || code === 'chatgpt_plan_permission_required' || code === 'provider_auth_failed'
      || code === 'provider_missing_key'
      || code === 'provider_request_failed'
      || code === 'provider_request_timeout'
      || code === 'provider_model_unavailable'
      || code === 'provider_unreachable'
      || code === 'provider_stream_interrupted'
      || code === 'model_gateway_contract_failed';
    const retryContinuation = () => retryThreadContinuation(targetThread, isCompactionRecovery(targetThread()) ? targetThread()?.current_execution?.run_id : undefined);
    const inspectPending = () => retryPending() || transportOutbox().forThread(trimString(targetThread()?.thread_id)).some(entry => entry.delivery !== 'accepted');
    const inspectBlocked = () => !settingsReady() || props.adapter.canMutate === false || inspectPending()
      || (Boolean(targetThread()?.parent_thread_id) && !subagentDetailSummary()?.can_send_input)
      || !props.adapter.launchTurn || (!targetThread()?.parent_thread_id && Boolean(trimString(targetThread()?.read_only_reason)))
      || ['running', 'waiting_approval', 'waiting_user'].includes(targetThread()?.status ?? '')
      || (trimString(targetThread()?.thread_id) === selectedThreadID() && selectedThreadReadOnly());
    const inspectAndContinue = async () => {
      const threadID = trimString(targetThread()?.thread_id);
      if (!threadID || inspectBlocked()) return;
      setRetryingThreads(previous => new Set([...previous, threadID]));
      const requestEpoch = liveTransport.connectionEpoch();
      const selectionSequence = threadLoadSequence;
      const child = activeSubagentDetail()?.childThreadID === threadID ? activeSubagentDetail() : null;
      const stillTargeted = () => !surfaceDisposed && requestEpoch === liveTransport.connectionEpoch()
        && selectionSequence === threadLoadSequence
        && (child ? activeSubagentDetail()?.childThreadID === threadID && activeSubagentDetail()?.generation === child.generation : selectedThreadID() === threadID);
      try {
        let current: FlowerThreadSnapshot | null;
        if (child) {
          const detail = await withFlowerRequestDeadline(() => props.adapter.loadSubagentDetail(child.parentThreadID, threadID), copy().settings.dialog.catalog.retryTimedOut);
          if (!stillTargeted()) return;
          if (detail.current.thread_id !== threadID || detail.summary.thread_id !== threadID || detail.summary.parent_thread_id !== child.parentThreadID) throw new Error('Recovery returned a different thread.');
          current = projectSubagentDetailThread(detail);
          acceptActiveSubagentCurrent(child.parentThreadID, detail.current, detail.summary, detail.model_context, detail.context_usage, detail.context_compactions, detail.timeline_decorations);
        } else current = await requestThreadDetail(threadID, 'user_action', true);
        if (!current || !stillTargeted() || current.status !== 'failed' || current.error?.code !== 'floret_effect_outcome_unknown'
          || current.active_run_id || current.input_request || current.approval_pending || current.queued_turn_count) return;
        const storageGeneration = await withFlowerRequestDeadline(() => props.adapter.resolveStorageGeneration?.() ?? Promise.resolve(''), copy().settings.dialog.catalog.retryTimedOut);
        const latest = targetThread();
        if (!stillTargeted() || props.adapter.canMutate === false || !latest || latest.thread_id !== threadID
          || latest.status !== 'failed' || latest.error?.code !== 'floret_effect_outcome_unknown'
          || latest.active_run_id || latest.input_request || latest.approval_pending || latest.queued_turn_count
          || (!child && trimString(latest.read_only_reason))
          || (child && (!props.adapter.loadSubagentDetail || !subagentDetailSummary()?.can_send_input))
          || transportOutbox().forThread(threadID).some(entry => entry.delivery !== 'accepted')) return;
        const requestID = createFlowerClientRequestID();
        outboxOperations.set(requestID, { adapter: props.adapter });
        setTransportOutbox(outbox => outbox.put({
          presentation: 'queue', requestId: requestID, threadId: threadID,
          ...(child ? { parentThreadId: child.parentThreadID } : {}),
          input: { client_request_id: requestID, thread_id: threadID, storage_generation: storageGeneration,
            prompt: copy().chat.inspectAndContinuePrompt, decision: null },
          attachmentLabels: [], createdAtMs: Date.now(), delivery: 'pending',
        }));
      } catch (failure) { notifyThreadActionError(getErrorMessage(failure)); }
      finally { setRetryingThreads(previous => { const next = new Set(previous); next.delete(threadID); return next; }); }
    };
    const runtimeFailure = code.startsWith('floret_') && code !== 'floret_effect_outcome_unknown';
    const retryableRuntimeFailure = ['floret_engine_failed', 'floret_control_contract_failed', 'floret_repeated_tool_calls', 'floret_no_progress', 'floret_duplicate_tool_call_id', 'floret_stop_hook_loop', 'floret_tool_dispatch_failed', 'floret_storage_failed', 'floret_authorization_failed'].includes(code);
    const providerFailure = code.startsWith('provider_') || code.startsWith('chatgpt_');
    const diagnostics = () => (contextFailure || providerFailure || runtimeFailure || code === 'model_context_unavailable') && trimString(error?.detail) ? (
      <details class="flower-error-details">
        <summary>{copy().chat.runErrorDetails}</summary>
        <pre>{trimString(error?.detail)}</pre>
        <Button size="sm" variant="ghost" icon={Copy} onClick={() => {
          void writeTextToClipboard(trimString(error?.detail)).then(() => setDetailsCopied(true)).catch((cause) => notifyThreadActionError(getErrorMessage(cause)));
        }}><StableText reserve={[copy().chat.messageCopied, copy().chat.runErrorCopyDetails]}>{detailsCopied() ? copy().chat.messageCopied : copy().chat.runErrorCopyDetails}</StableText></Button>
      </details>
    ) : undefined;
    const hasCompactionRecoveryDivider = () => {
      const operation = latestCompactionRecovery(targetThread());
      return operation && targetThread()?.timeline_decorations?.some(item => item.compaction.operation_id === operation.operation_id);
    };
    const retryAction = () => <Show when={!hasCompactionRecoveryDivider()
      && (targetThread()?.current_execution?.turn_kind !== 'context_compaction' || isCompactionRecovery(targetThread()))}>
      <Button size="sm" variant="ghost" loading={retryPending()} disabled={retryBlocked()}
        onClick={() => void retryContinuation()}>{isCompactionRecovery(targetThread())
          ? compactionRecoveryPending(targetThread()) ? copy().chat.compactionDivider.retrying : copy().chat.compactionDivider.retry
          : copy().chat.retryReply}</Button>
    </Show>;
    const action = () => code === 'floret_effect_outcome_unknown' ? (
      <Button size="sm" variant="ghost" disabled={inspectBlocked()} onClick={() => void inspectAndContinue()}>{copy().chat.inspectAndContinue}</Button>
    ) : correctionFailure ? (
      <>
        {retryAction()}
        <Button size="sm" variant="ghost" disabled={configureBlocked()} onClick={() => void configureThreadProvider(targetThread())}>{copy().chat.runErrorActions.configureCurrentModel}</Button>
      </>
    ) : providerFailure ? (
      <>
        <Button size="sm" variant="ghost" disabled={configureBlocked()} onClick={() => void configureThreadProvider(targetThread())}>{copy().settings.dialog.catalog.searchConfigure}</Button>
        {retryAction()}
        <Show when={code === 'chatgpt_usage_unavailable'}><a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer" class="cursor-pointer whitespace-nowrap text-sm font-medium text-primary hover:underline">{copy().settings.dialog.chatGPT.manageUsage}</a></Show>
      </>
    ) : code === 'model_context_unavailable' || retryableRuntimeFailure ? (
      retryAction()
    ) : contextFailure ? (
      <>
        <Button size="sm" variant="ghost" onClick={openSettings}>{copy().chat.runErrorActions.openSettings}</Button>
        {retryAction()}
      </>
    ) : continuationFailure()
      ? retryAction()
      : actionable
      ? (
        <Button size="sm" variant="ghost" onClick={openSettings}>
          {runErrorActionLabel(code)}
        </Button>
      )
      : undefined;
    return (
      <Show
        when={continuationFailure()}
        fallback={errorNotice(stoppedUnknown() ? copy().chat.stopOutcomeUnknownTitle : contextFailure ? copy().chat.runContextErrorTitle : copy().chat.runErrorTitle, stoppedUnknown() ? copy().chat.stopOutcomeUnknownDescription : presentRunError(error), action(), 'flower-run-error', diagnostics())}
      >
        {errorNotice(
          copy().chat.runContinuationErrorTitle,
          presentRunError(error),
          action(),
          'flower-run-error flower-continuation-error',
          diagnostics(),
        )}
      </Show>
    );
  };

  const chatCopyValue = (
    key: 'inputRequestTitle'
      | 'readOnlyComposerLabel'
      | 'inputRequestSubmit'
      | 'inputRequestRetry'
      | 'inputRequestAnswerRequired'
      | 'inputRequestAnswerHidden'
      | 'inputRequestPrevious'
      | 'inputRequestNext'
      | 'inputRequestComposerPlaceholder'
      | 'inputRequestChoicePlaceholder'
      | 'inputRequestOther'
      | 'inputRequestAnswered',
    fallback: string,
  ): string => trimString(copy().chat[key]) || trimString(DEFAULT_FLOWER_SURFACE_COPY.chat[key]) || fallback;

  const selectedRunProgress = createMemo<FlowerLiveProgress | null>((previous) => retainEqualValue(
    previous, !livePresentationConfirmed() || selectedThreadTerminalSyncing() ? null : flowerRunProgress(selectedThread()),
  ));
  const selectedContextUsage = createMemo<FlowerContextUsage | null>((previous) => {
    const thread = selectedThread();
    const usage = thread?.context_usage ?? null;
    if (!thread || !usage) return null;
    if (!usage.confirmed && !usage.estimate) return null;
    return retainEqualValue(previous, usage);
  });
  const selectedThreadHasLiveProgress = createMemo(() => selectedRunProgress() != null);
  createEffect(() => {
    const retrying = selectedRunProgress()?.retry != null
      || (subagentDetailOpen() && subagentDetailThread()?.run_progress?.retry != null)
      || [...threadCache().views.values()].some(view => view.thread.status === 'running' && view.thread.run_progress?.retry != null);
    if (!retrying) return;
    setRetryNow(Date.now());
    const timer = window.setInterval(() => setRetryNow(Date.now()), 250);
    onCleanup(() => window.clearInterval(timer));
  });

  const showScrollToLatestButton = createMemo(() => (
    (selectedThreadHasContent() || selectedThreadHasLiveProgress())
    && !selectedThreadTailPreparing()
    && transcriptScroll.showLatest()
  ));
  createEffect(() => {
    selectedThreadID();
    selectedThreadHasContent();
    parentEventReading.events();
    selectedThreadHasLiveProgress();
    transcriptLayoutRevision();
    if (selectedThreadTailPreparing()) {
      historyBodyRevision();
      threadLoadError();
      documentVisible();
    }
    measureTranscriptNearBottomAfterLayout();
  });
  function modelStatusLabel(phase: FlowerRunProgressPhase): string {
    const modelStatus = copy().chat.modelStatus;
    const fallback = DEFAULT_FLOWER_SURFACE_COPY.chat.modelStatus;
    const labels: Record<FlowerRunProgressPhase, string> = {
      preparing: trimString(modelStatus.preparing) || fallback.preparing,
      waiting_response: trimString(modelStatus.waitingResponse) || fallback.waitingResponse,
      streaming: trimString(modelStatus.streaming) || fallback.streaming,
      retrying: trimString(modelStatus.retrying) || fallback.retrying,
      finalizing: trimString(modelStatus.finalizing) || fallback.finalizing,
      tool_execution: trimString(copy().chat.liveProgressTool) || DEFAULT_FLOWER_SURFACE_COPY.chat.liveProgressTool,
    };
    return labels[phase];
  }
  function liveProgressLabel(kind: FlowerLiveProgressKind, retry?: FlowerLiveProgress['retry']): string {
    if (kind === 'retrying' && retry) {
      const seconds = flowerRetrySeconds(retry.next_attempt_at, retryNow());
      const label = retry.reason === 'stream_interrupted' ? copy().chat.providerRetryRegenerating : copy().chat.providerRetryWaiting;
      return label(seconds, retry.retry, retry.max_retries);
    }
    return kind === 'compacting' ? copy().chat.compactionDivider.compacting : modelStatusLabel(kind);
  }
  const messageTimeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  const formatMessageTime = (createdAtMs: number): string => {
    const value = Math.floor(Number(createdAtMs ?? 0));
    if (!Number.isFinite(value) || value <= 0) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return messageTimeFormatter.format(date);
  };

  const messageCopyText = (message: FlowerChatMessage, blocks: readonly FlowerRenderableMessageBlock[]): string => {
    const blockText = blocks
      .flatMap((block) => (
        block.type === 'content' && block.block_type !== 'thinking'
          ? [trimString(block.content)]
          : block.type === 'input_response'
            ? [inputResponseVisibleText(block.block, chatCopyValue('inputRequestAnswerHidden', 'Answer hidden'))]
          : []
      ))
      .filter(Boolean)
      .join('\n\n');
    const text = blockText || message.content;
    return trimString(message.role === 'assistant' ? flowerMessageTextForCopy(text) : text);
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

  const MessageCopyButton: Component<{
    message: FlowerChatMessage;
    text: string;
    placement: 'assistant' | 'user';
  }> = (buttonProps) => {
    const value = () => trimString(buttonProps.text);
    const copied = () => copiedMessageAction() === messageCopyActionKey(buttonProps.message);
    const label = () => copied() ? copy().chat.messageCopied : copy().chat.copyMessage;
    return (
      <Show when={Boolean(value())}>
        <button
          type="button"
          class={cn('flower-message-copy-button', `flower-message-copy-button-${buttonProps.placement}`)}
          data-copied={copied() ? 'true' : 'false'}
          aria-label={label()}
          title={label()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void copyMessageText(buttonProps.message, value());
          }}
        >
          <Copy class="flower-message-copy-icon flower-message-copy-icon-idle h-3.5 w-3.5" />
          <Check class="flower-message-copy-icon flower-message-copy-icon-copied h-3.5 w-3.5" />
        </button>
      </Show>
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
        ...(next.answer_kind ? { answer_kind: next.answer_kind } : {}),
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
      answer_kind: 'choice',
      choice_id: choice.choice_id,
      text: questionDraft(question.id).text,
    });
  };

  const selectInputCustomAnswer = (question: FlowerInputRequestQuestion) => {
    if (!questionAllowsText(question)) return;
    setQuestionDraft(question.id, {
      answer_kind: 'custom',
      text: questionDraft(question.id).text ?? '',
    });
    queueMicrotask(() => composerRef?.focus());
  };

  const updateInputText = (question: FlowerInputRequestQuestion, text: string) => {
    if (!questionAllowsText(question)) return;
    setQuestionDraft(question.id, {
      answer_kind: questionMode(question) === 'select_or_write' ? 'custom' : undefined,
      choice_id: questionDraft(question.id).choice_id,
      text,
    });
  };

  const updateComposerText = (value: string) => {
    if (goalCommand()) {
      draftSessionFor(currentComposerSessionKey()).mutate(draft => ({ ...draft, goal_command: { text: value } }));
      return;
    }
    const waitingQuestion = activeInputQuestion();
    if (selectedInputRequest() && waitingQuestion) {
      updateInputText(waitingQuestion, value);
      return;
    }
    if (value) capturePageContext();
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
    !composerTakingBackQueuedTurn()
    && !selectedComposerApprovalDisplayAction()
    && !selectedInputRequest()
    && !selectedThreadDetailPending()
    && !selectedThreadReadOnly()
    && !surfaceWarmupActive()
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
    for (const option of menuModelOptions().models) {
      if (option.disabled) continue;
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
    composerHistory.reset();
    // Goal text stays text; long-paste attachment conversion belongs to chat drafts.
    if (goalCommand()) return;
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
          ...(operation.sessionKey === pendingDraftKey() && !value.client_request_id
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
    composerHistory.reset();
    if (composerTakingBackQueuedTurn() || composerReferenceMutationActive()) {
      event.currentTarget.value = composerTextValue();
      return;
    }
    requestCompanionForEditing();
    const value = event.currentTarget.value;
    if (!goalCommand() && /^\/goal\s/.test(value)) {
      updateComposerText(''); enterGoalCommand(value.slice(6)); return;
    }
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
    if (item.admitted?.url) { openMessageAttachmentPreview({ id: item.local_id, name: item.name, mimeType: item.mime_type, url: item.admitted.url }); return; }
    if (!item.staged && item.preview_url) {
      setAttachmentPreview({
        id: `local:${item.local_id}`,
        name: item.name,
        mimeType: item.mime_type,
        load: async (signal) => {
          const response = await fetch(item.preview_url!, { signal });
          if (!response.ok) throw new Error(copy().chat.media.unavailable);
          return response.blob();
        },
      });
      return;
    }
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
  const activeInputQuestionIsSecret = createMemo(() => !goalCommand() && !!selectedInputRequest() && !!activeInputQuestion()?.is_secret);

  const composerTextValue = createMemo(() => {
    if (goalCommand()) return goalCommand()!.text;
    if (!selectedInputRequest()) {
      return currentComposerSessionDraft().chatDraft;
    }
    const question = activeInputQuestion();
    return question ? questionDraft(question.id).text ?? '' : '';
  });
  const activeInputQuestionUsesTextEditor = createMemo(() => {
    if (goalCommand()) return true;
    const question = activeInputQuestion();
    if (!question) return false;
    if (questionMode(question) === 'write') return true;
    return questionMode(question) === 'select_or_write' && questionDraft(question.id).answer_kind === 'custom';
  });
  const bottomActionFocusIdentity = () => JSON.stringify([
    selectedThreadID(), bottomActionMode(), selectedInputRequest()?.prompt_id,
    selectedInputRequest()?.tool_id, activeInputQuestion()?.id,
    selectedComposerApprovalActions().map((action) => action.action_id),
  ]);
  const composerTextareaDisabled = createMemo(() => {
    if (selectedThreadReadOnly()) return true;
    if (goalCommand()) return false;
    if (!selectedInputRequest()) return false;
    return !activeInputQuestion() || !activeInputQuestionUsesTextEditor();
  });
  const composerReferences = createMemo(() => currentComposerSessionDraft().references);
  const composerHasReferences = createMemo(() => composerReferences().length > 0);
  const composerHasExplicitReferences = createMemo(() => composerReferences().some(reference => reference.kind !== 'page_context'));
  const [composerSnapshotPreviewID, setComposerSnapshotPreviewID] = createSignal('');
  const composerSnapshotPreview = createMemo(() => composerReferences().find((reference): reference is Extract<FlowerComposerDraftReference, { kind: 'page_context' | 'thread' | 'snapshot' }> => reference.local_id === composerSnapshotPreviewID() && (reference.kind === 'page_context' || reference.kind === 'thread' || reference.kind === 'snapshot')));
  createEffect(() => { if (composerSnapshotPreviewID() && !composerSnapshotPreview()) setComposerSnapshotPreviewID(''); });

  type CompanionEntry = Readonly<{
    kind: 'pending' | 'status' | 'editor' | 'inspect';
    targetThreadID: string;
    text: string;
  }>;
  const companionEntry = createMemo<CompanionEntry>(() => {
    const targetThreadID = selectedThreadID();
    const actionLabel = props.companionActionLabel || copy().chat.placeholder;
    if (bottomActionMode() !== 'chat') {
      const question = activeInputQuestion();
      const publicQuestion = bottomActionMode() === 'input_request' && question && !question.is_secret
        && !isToolOriginComputerInput(selectedInputRequest());
      return { kind: 'pending', targetThreadID, text: publicQuestion
        ? trimString(selectedInputRequest()?.public_summary) || trimString(question.question) || actionLabel
        : actionLabel };
    }
    const editing = composerFocused() || isComposing() || Boolean(trimString(composerTextValue()))
      || composerHasAttachments() || composerHasReferences();
    if (!editing && trimString(props.companionSummary?.visualText)) {
      return { kind: 'status', targetThreadID: props.companionSummary?.targetThreadID || targetThreadID,
        text: props.companionSummary!.visualText };
    }
    return { kind: composerTextareaDisabled() || selectedThreadDetailPending() ? 'inspect' : 'editor',
      targetThreadID, text: actionLabel };
  });
  const companionActionVisible = () => companionCollapsed()
    && (companionEntry().kind === 'pending' || companionEntry().kind === 'inspect');
  const companionSummaryVisible = () => companionCollapsed() && companionEntry().kind === 'status';
  createEffect(() => {
    composerTextValue();
    currentComposerSessionKey();
    if (companionCollapsed()) composerAutosizeController?.suspend();
    else {
      composerAutosizeController?.resume();
      composerAutosizeController?.schedule();
    }
  });

  const currentQuestionFocusTarget = () => {
    const surface = composerSurfaceRef;
    const region = surface?.querySelector<HTMLElement>('.flower-input-request-surface');
    if (isToolOriginComputerInput(selectedInputRequest())) return region;
    return surface?.querySelector<HTMLElement>('textarea:not(:disabled), input:not([type="radio"]):not(:disabled)')
      ?? surface?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]:not(:disabled), input[role="radio"]:checked:not(:disabled)')
      ?? surface?.querySelector<HTMLElement>('[role="radio"]:not(:disabled)')
      ?? region;
  };
  const bottomActionEditTarget = () => {
    if (bottomActionMode() === 'input_request') return currentQuestionFocusTarget();
    if (bottomActionMode() === 'chat') return composerRef;
    return composerSurfaceRef?.querySelector<HTMLElement>('.flower-composer-approval-decision:not(:disabled)')
      ?? composerSurfaceRef?.querySelector<HTMLElement>('.flower-composer-stop-thread:not(:disabled)')
      ?? composerApprovalCardRef;
  };
  const activateCompanionEntry = (event: MouseEvent) => {
    if (!companionCollapsed() || event.defaultPrevented || event.button !== 0) return;
    const entry = companionEntry();
    const identity = bottomActionFocusIdentity();
    const token = ++companionActivationToken;
    const owner = document.activeElement;
    // Cancel an earlier editing request before navigation claims focus.
    composerFocusToken += 1;
    setComposerFocusRequest(null);
    requestCompanionOpen(entry.kind === 'status' ? entry.targetThreadID : undefined);
    queueMicrotask(async () => {
      const stillOwned = () => document.activeElement === owner || document.activeElement === document.body
        || document.activeElement === surfaceRef;
      const available = () => token === companionActivationToken && surfaceEngaged() && !companionCollapsed()
        && surfaceRef?.isConnected && !surfaceRef.closest('[inert]') && stillOwned()
        && (entry.kind === 'status' || identity === bottomActionFocusIdentity());
      if (!available()) return;
      surfaceRef?.focus({ preventScroll: true });
      if (entry.kind === 'editor') {
        composerRef?.focus({ preventScroll: true });
        return;
      }
      if (event.detail !== 0 || entry.kind !== 'pending') return;
      if (bottomActionMode() === 'input_request' && !isToolOriginComputerInput(selectedInputRequest())) {
        try { await FlowerInputChoices.preload(); }
        catch { return; } // The existing lazy surface owns load-error presentation; keep reading focus.
      }
      requestTranscriptAnimationFrame(() => {
        if (!available() || identity !== bottomActionFocusIdentity()) return;
        const target = bottomActionMode() === 'input_request' ? currentQuestionFocusTarget() : composerApprovalCardRef;
        target?.focus({ preventScroll: true });
      });
    });
  };
  createEffect(on(
    () => [companionCollapsed(), surfaceEngaged(), presentation()] as const,
    ([collapsed, engaged, placement]) => {
      if (collapsed || !engaged || placement !== 'companion') companionActivationToken += 1;
    },
    { defer: true },
  ));
  const companionDescriptionID = createMemo(() => (
    props.companionRegionID ? `${props.companionRegionID}-status` : undefined
  ));
  const companionSummaryAnnounces = createMemo(() => (
    props.companionSummary?.ephemeralKind === 'completion'
    || props.companionSummary?.priorityStatus === 'failed'
    || (
      (props.companionSummary?.priorityStatus === 'running' || props.companionSummary?.priorityStatus === 'queued')
      && props.companionSummary?.progressKind !== 'tool'
      && props.companionSummary?.progressKind !== 'output'
    )
  ));

  const composerHistoryEntries = createMemo<readonly InputHistoryEntry[]>((previous) => (
    retainKeyedItems(previous, flowerInputHistoryEntries(selectedThread()?.messages ?? []), (entry) => entry.id)
  ));
  const composerHistoryEnabled = createMemo(() => (
    Boolean(selectedThreadID())
    && Boolean(selectedThread())
    && !selectedThreadDetailPending()
    && !threadLoadError()
    && bottomActionMode() === 'chat'
    && !composerTextareaDisabled()
    && composerReferenceMutationCount() === 0
    && reactiveDraftSnapshotFor(currentComposerSessionKey()).value.mode === 'ordinary'
    && surfaceEngaged() && transcriptVisible() && documentVisible()
    && !companionCollapsed() && sidePanel() === 'chat'
  ));
  const composerHistory = createInputHistoryController({
    read: () => ({
      scope: currentComposerSessionKey(),
      value: currentComposerSessionDraft().chatDraft,
      revision: reactiveDraftSnapshotFor(currentComposerSessionKey()).revision,
      entries: composerHistoryEntries(),
      enabled: composerHistoryEnabled(),
    }),
    write: (text) => {
      // Suppress completion before the shared draft publishes recalled tokens.
      batch(() => {
        setComposerHistoryBrowsing(true);
        updateComposerSessionText(currentComposerSessionKey(), text);
      });
      composerAutosizeController?.schedule();
    },
    onChange: (state, reason) => {
      setComposerHistoryBrowsing(state !== null);
      setComposerHistoryAnnouncement(reason === 'navigate'
        ? state ? copy().chat.inputHistoryPosition(state.position, state.total) : copy().chat.inputHistoryCleared
        : '');
    },
  });
  createEffect(on(
    () => [
      currentComposerSessionKey(),
      reactiveDraftSnapshotFor(currentComposerSessionKey()).revision,
      composerHistoryEntries(),
      composerHistoryEnabled(),
    ] as const,
    () => composerHistory.synchronize(),
  ));

  const composerPlaceholder = createMemo(() => {
    if (goalCommand()) return copy().chat.goalEmpty;
    if (selectedThreadReadOnly()) return selectedThreadReadOnlyDisplay();
    if (surfaceWarmupActive() && !selectedInputRequest()) return copy().chat.warmupComposerPlaceholder;
    if (!selectedInputRequest()) return copy().chat.placeholder;
    const question = activeInputQuestion();
    if (!question || !questionAllowsText(question)) {
      return chatCopyValue('inputRequestChoicePlaceholder', 'Choose an option to continue.');
    }
    return trimString(question.write_placeholder)
      || chatCopyValue('inputRequestComposerPlaceholder', 'Reply to continue this conversation.');
  });

  const composerTextareaReadOnly = createMemo(() => (
    composerTakingBackQueuedTurn() || composerReferenceMutationCount() > 0
  ));

  const handleComposerBlankClick = (event: MouseEvent & { currentTarget: HTMLDivElement }) => {
    if (event.button !== 0 || event.defaultPrevented) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('textarea, input, label, button, a, select, [role="button"], [role="option"], [contenteditable="true"], .flower-composer-context-indicator')) return;
    if (companionCollapsed()) {
      activateCompanionEntry(event);
      return;
    }
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

  const composerReferenceRemovalAllowed = createMemo(() => composerAttachmentEditingAllowed() && !composerTextareaDisabled() && !composerSendPreparing());
  const threadReferenceDisabledReason = createMemo(() => {
    const labels = copy().chat.threadReference;
    if (pendingThreadSelection()) return labels.frozen;
    if (selectedThreadReadOnly()) return labels.readOnly;
    if (selectedComposerApprovalDisplayAction()) return labels.approval;
    if (selectedInputRequest()) return labels.input;
    if (!composerReferenceRemovalAllowed() || draftSubmissionActive(currentComposerDraftOperation().session.snapshot().value)) return labels.frozen;
    return '';
  });
  const addThreadReference = (item: FlowerThreadListItem) => {
    if (threadReferenceDisabledReason()) return;
    const operation = currentComposerDraftOperation();
    const reference: FlowerComposerDraftReference = {
      local_id: createComposerReferenceLocalID(), kind: 'thread', label: item.title || copy().chat.titleFallback,
      thread: { runtime_id: props.adapter.runtime.runtime_id, thread_id: item.thread_id, title: item.title,
        status: item.status, working_dir: item.working_dir, created_at_ms: item.created_at_ms,
        updated_at_ms: item.updated_at_ms, captured_at_ms: Date.now() },
    };
    const identity = flowerDraftReferenceIdentity(reference);
    const existing = operation.session.snapshot().value.references.some(item => flowerDraftReferenceIdentity(item) === identity);
    const result = operation.session.mutate(value => ({ ...value,
      references: existing ? value.references : [...value.references, reference],
    }));
    updateComposerSessionDraft(operation.sessionKey, draft => ({ ...draft, references: result.snapshot.value.references }));
    setComposerReferenceAnnouncement(existing ? copy().chat.composerReferenceExists(reference.label) : copy().chat.composerReferenceAdded(reference.label));
    setThreadNavigationOpen(false);
    returnToChat();
    focusComposerAt(composerSelection().start, true);
  };
  let snapshotPreviewOpener: HTMLElement | null = null;
  const [referenceOpenBusy, setReferenceOpenBusy] = createSignal(false);
  const [referenceOpenError, setReferenceOpenError] = createSignal('');
  let referencePreviewGeneration = 0;
  let referenceReadController: AbortController | undefined;
  const captureSnapshotPreviewFocus = () => {
    referenceReadController?.abort();
    referenceReadController = undefined;
    referencePreviewGeneration++;
    snapshotPreviewOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReferenceOpenError(''); setReferenceOpenBusy(false);
  };
  const closeSnapshotPreview = () => {
    referenceReadController?.abort();
    referenceReadController = undefined;
    referencePreviewGeneration++;
    const restore = snapshotPreviewOpener;
    setComposerSnapshotPreviewID(''); setContextSnapshotPreview(null);
    setReferenceOpenBusy(false); setReferenceOpenError('');
    queueMicrotask(() => { if (restore?.isConnected) restore.focus({ preventScroll: true }); });
  };
  const threadSnapshotBody = (thread: ThreadReferenceSnapshot): string => {
    const labels = copy().chat.threadReference;
    const statuses = copy().threadList.statuses;
    const date = (ms: number) => new Date(ms).toLocaleString();
    return [
      `${labels.title}: ${thread.title || copy().chat.titleFallback}`,
      `${copy().threadList.threadIDLabel}: ${thread.thread_id}`,
      `${labels.status}: ${Object.hasOwn(statuses, thread.status) ? statuses[thread.status as keyof typeof statuses] : thread.status}`,
      `${copy().threadList.workingDirectoryLabel}: ${thread.working_dir}`,
      `${labels.created}: ${date(thread.created_at_ms)}`, `${labels.updated}: ${date(thread.updated_at_ms)}`,
      `${labels.captured}: ${date(thread.captured_at_ms)}`, `${labels.runtime}: ${thread.runtime_id}`,
    ].join('\n');
  };
  const referencedThreadUnavailable = (thread: ThreadReferenceSnapshot): string => (
    thread.runtime_id !== props.adapter.runtime.runtime_id ? copy().chat.threadReference.wrongRuntime
      : retiredThreadIDs.has(thread.thread_id) ? copy().chat.threadReference.unavailable : ''
  );
  const openReferencedThread = async (thread: ThreadReferenceSnapshot) => {
    if (referenceOpenBusy() || referencedThreadUnavailable(thread)) return;
    const generation = referencePreviewGeneration, selectedID = selectedThreadID();
    const epoch = liveTransport.connectionEpoch();
    referenceReadController?.abort();
    const controller = new AbortController();
    referenceReadController = controller;
    setReferenceOpenBusy(true); setReferenceOpenError('');
    try {
      const detail = await requestThreadDetail(thread.thread_id, 'user_action', true, true, controller.signal);
      if (surfaceDisposed || generation !== referencePreviewGeneration || selectedID !== selectedThreadID() || epoch !== liveTransport.connectionEpoch()) return;
      if (!detail || detail.thread_id !== thread.thread_id || retiredThreadIDs.has(thread.thread_id)) throw new Error('Referenced conversation unavailable');
      closeSnapshotPreview();
      await loadAndSelectThread(thread.thread_id);
    } catch {
      if (generation === referencePreviewGeneration && !surfaceDisposed) setReferenceOpenError(copy().chat.threadReference.unavailable);
    } finally {
      if (generation === referencePreviewGeneration && !surfaceDisposed) setReferenceOpenBusy(false);
    }
  };
  const composerReferenceEditingAllowed = createMemo(() => (
    !goalCommand() && composerReferenceRemovalAllowed()
    && Boolean(displayedWorkingDirectory())
    && composerReferenceIndex !== null
  ));
  const composerReferenceToken = createMemo<FlowerComposerReferenceToken | undefined>(() => {
    if (!composerReferenceEditingAllowed() || isComposing() || composerHistoryBrowsing()) return undefined;
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
  createEffect(() => {
    if (bottomActionMode() === 'chat') return;
    setWorkingDirectoryPickerOpen(false);
    closePermissionMenu(false);
    closeModelMenu(false);
    closeComposerMore(false);
    setComposerReferenceDismissedSignature(composerReferenceTokenSignature());
    setComposerReferenceActiveKey('');
    composerReferenceIndex?.softAbort();
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
  let composerReferenceLoadingTimer: number | undefined;
  const createComposerReferenceLocalID = (): string => {
    return `flower_ref_${secureRandomUUID()}`;
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
      capturePageContext();
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
        flowerDraftReferenceIdentity(reference) === identity
      ));
      const result = operation.session.mutate((value) => {
        if (value.text !== localDraft.chatDraft) return value;
        const alreadyExists = value.references.some((reference) => (
          flowerDraftReferenceIdentity(reference) === identity
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
  const composerSlashCommand = createMemo(() => {
    if (goalCommand()) return { kind: 'intent' as const, command: '/goal' as const, operation: 'set' as const, text: goalCommand()!.text };
    if (composerHistoryBrowsing()) return { kind: 'none' as const };
    const parsed = parseFlowerSlashCommand(composerTextValue().trim());
    if (selectedInputRequest() || selectedComposerApprovalDisplayAction()) {
      return parsed.kind === 'intent' && parsed.command === '/goal' || parsed.kind === 'suggest' && 'goal'.startsWith(parsed.query)
        ? parsed : { kind: 'none' as const };
    }
    return parsed;
  });
  const [composerCommandIndex, setComposerCommandIndex] = createSignal(0);
  const composerCommandChoices = createMemo(() => {
    const parsed = composerSlashCommand();
    const query = parsed.kind === 'suggest' ? parsed.query : parsed.kind === 'intent' ? parsed.command.slice(1) : '';
    return ([FLOWER_COMPACT_CONTEXT_COMMAND, FLOWER_GOAL_COMMAND, 'compact-only'] as const).filter(command => (command === 'compact-only' ? 'compact' : command.slice(1)).startsWith(query) && (!(selectedInputRequest() || selectedComposerApprovalDisplayAction()) || command === FLOWER_GOAL_COMMAND));
  });
  createEffect(() => { composerChatDraftText(); setComposerCommandIndex(0); });
  const composerCommandSuggested = createMemo(() => composerCommandChoices()[composerCommandIndex()] ?? FLOWER_COMPACT_CONTEXT_COMMAND);
  const composerCommandMenuVisible = createMemo(() => (
    !composerReferenceMenuVisible()
    && composerFocused()
    && (composerSlashCommand().kind === 'suggest' || composerSlashCommand().kind === 'intent' && 'command' in composerSlashCommand() && (composerSlashCommand() as { command: string }).command === '/compact')
  ));
  const composerPrimaryActionIsCommand = createMemo(() => {
    const command = composerSlashCommand();
    return command.kind === 'intent' || command.kind === 'suggest';
  });
  const composerPrimaryActionIsStop = createMemo(() => (
    !goalCommand() && (longTextPreparing()
    || (Boolean(selectedThreadID()) && selectedThreadCanStop() && !composerTextOverLimit() && !composerChatDraftText() && !composerHasAttachments() && !composerHasReferences()))
  ));
  type ComposerPrimaryAction = 'send' | 'stop' | 'compact' | 'goal' | 'cancel_long_text';
  const composerPrimaryActionKind = createMemo<ComposerPrimaryAction>(() => (
    longTextPreparing()
      ? 'cancel_long_text'
      : composerPrimaryActionIsStop()
      ? 'stop'
      : composerPrimaryActionIsCommand()
      ? (composerSlashCommand().kind === 'intent' && 'command' in composerSlashCommand() && (composerSlashCommand() as { command: string }).command === '/goal' || composerSlashCommand().kind === 'suggest' && composerCommandSuggested() === '/goal' ? 'goal' : 'compact')
      : 'send'
  ));
  const composerPrimaryActionIcon = createMemo(() => composerPrimaryActionIsStop() ? FlowerStopIcon : composerPrimaryActionIsCommand() ? Clock : ArrowUp);
  const composerPrimaryActionLabel = createMemo(() => composerPrimaryActionIsStop() ? selectedThreadStopLabel() : composerSendPreparing() ? copy().chat.preparingSend : selectedComposerPendingSend() ? copy().chat.pendingSending : composerPrimaryActionIsCommand() ? (composerSlashCommand().kind === 'intent' && (composerSlashCommand() as { command?: string }).command === '/goal' ? copy().chat.goalTitle : composerCommandSuggested() === 'compact-only' ? copy().chat.compactContextOnly : copy().chat.compactContext) : copy().chat.send);
  const composerPrimaryActionDisabled = createMemo(() => {
    if (goalCommand()) return !settingsReady() || !goalCommand()!.text.trim() || goalPending() || !props.adapter.manageGoal || props.adapter.canMutate === false || selectedThreadReadOnly();
    if (composerTakingBackQueuedTurn()) return true;
    if (composerReferenceMutationCount() > 0) return true;
    if (longTextPreparing()) return false;
    if ((composerSendPreparing() || selectedComposerPendingSend()) && !composerPrimaryActionIsStop()) return true;
    if (selectedThreadStopPending()) return true;
    if (selectedThreadReadOnly()) return true;
    // A detail-sync error belongs to the selected conversation. New chats
    // have no detail to recover and must remain admissible through the same
    // workspace transport while it reconnects.
    if (threadLoadError() && selectedThreadID() && !composerPrimaryActionIsStop()) return true;
    if (composerSlashCommand().kind === 'invalid') return true;
    if (!selectedThreadID() && goalPending()) return true;
    if (!composerPrimaryActionIsStop() && !settingsReady()) return true;
    if (composerPrimaryActionIsCommand()) {
      const parsed = composerSlashCommand();
      if (parsed.kind === 'intent' && parsed.command === '/goal') return !props.adapter.manageGoal;
      return !readyForChat();
    }
    if (composerHasSubmissionBlockingAttachments()) return true;
    if (composerTextOverLimit() && !currentAttachmentSnapshot().capability?.supports_long_text) return true;
    if (selectedThreadCanStop() && !composerTextOverLimit() && !composerHasAttachments() && !composerHasReferences()) return false;
    const hasSendableText = composerTextOverLimit() ? composerChatDraftHasRawText() : Boolean(composerChatDraftText());
    return !readyForChat() || !handlerAllowsSubmitIntent() || (!hasSendableText && !composerHasReadyAttachments() && !composerHasExplicitReferences());
  });
  const composerPrimaryActionLoading = createMemo(() => selectedThreadStopPending() || (!composerPrimaryActionIsStop() && (composerSendPreparing() || Boolean(selectedComposerPendingSend()))));

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
      case 'goal':
      case 'compact':
        executeComposerCommand();
        return;
      default:
        void submitChat();
    }
  };

  const questionAnswer = (question: FlowerInputRequestQuestion): FlowerInputAnswer | null => {
    const draft = questionDraft(question.id);
    const choiceID = trimString(draft.choice_id);
    const choiceValue = question.choices?.find((choice) => choice.choice_id === choiceID)?.value;
    const text = trimString(draft.text);
    const mode = questionMode(question);

    if (mode === 'write') return text ? { text } : null;
    if (mode === 'select') return choiceValue ? { choice_id: choiceValue } : null;
    if (mode === 'select_or_write' && draft.answer_kind === 'custom' && text) {
      return { text };
    }
    if (mode === 'select_or_write' && draft.answer_kind === 'choice' && choiceValue) {
      return { choice_id: choiceValue };
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

  const submitInputRequest = async (grant?: FlowerRequestedComputerAccess) => {
    if (pendingThreadSelection()) return;
    const thread = selectedThread();
    const request = selectedInputRequest();
    if (!selectedDecisionAvailable()) return;
    if (!thread || !request || inputRequestIsSubmitting()) return;
    const threadID = trimString(thread.thread_id);
    const answers = inputRequestAnswers();
    if (!answers) {
      notifyComposerError(chatCopyValue('inputRequestAnswerRequired', 'Answer every question before continuing.'));
      return;
    }
    const focusHandoff = captureBottomActionFocus(threadID);
    if (!setDecisionSubmitting(threadID, request.prompt_id, true)) return;
    const computer = isComputerInput(request);
    const requestEpoch = liveTransport.connectionEpoch();
    const selectionSequence = threadLoadSequence;
    const stillTargeted = () => !surfaceDisposed && requestEpoch === liveTransport.connectionEpoch()
      && selectionSequence === threadLoadSequence && !pendingThreadSelection()
      && threadID === selectedThreadID() && selectedInputRequest()?.prompt_id === request.prompt_id;
    let accessSaved = !grant;
    try {
      if (computer) {
        setComputerResponseSubmitting(true); setComputerResponseError('');
        await computerInputQueue;
        if (!stillTargeted()) return;
        if (grant) {
          const management = props.adapter.computerManagement;
          if (!management) throw new Error('computer access unavailable');
          const access = await management.loadAccess(threadID);
          if (!stillTargeted()) return;
          await management.saveAccess(threadID, {
            origins: [...new Set([...(access.origins ?? []), ...(grant.origin ? [grant.origin] : [])])],
            apps: [...new Set([...(access.apps ?? []), ...(grant.app ? [grant.app] : [])])],
            allow_foreground: access.allow_foreground || grant.foreground === true,
          });
          accessSaved = true;
          if (!stillTargeted()) return;
        }
        setComputerResponseCommitting(true);
      }
      const receipt: FlowerSubmitInputReceipt = await props.adapter.submitInput({
        thread_id: thread.thread_id,
        prompt_id: request.prompt_id,
        answers,
      });
      if (
        trimString(receipt.thread_id) !== threadID
        || trimString(receipt.consumed_prompt_id) !== trimString(request.prompt_id)
        || trimString(receipt.current.thread_id) !== threadID
      ) {
        throw new Error('Flower input response returned an invalid current view.');
      }
      if (requestEpoch !== liveTransport.connectionEpoch()) return;
      applyRuntimeCurrent(receipt.current);
      if (selectedThreadDetailMatches(threadID)) {
        scheduleBottomActionFocus(focusHandoff);
      }
    } catch (error) {
      if (requestEpoch !== liveTransport.connectionEpoch()) return;
      if (Number((error as { status?: number })?.status) === 409) {
        void requestThreadDetail(threadID, 'user_action', true);
      }
      if (selectedThreadDetailMatches(threadID) && selectedInputRequest()?.prompt_id === request.prompt_id) {
        if (computer) {
          setComputerResponseError(!accessSaved ? copy().computer.accessFailed : copy().chat.computerControlFailed ?? '');
        }
        else notifyComposerError(getErrorMessage(error));
      }
    } finally {
      if (computer && stillTargeted()) { setComputerResponseSubmitting(false); setComputerResponseCommitting(false); }
      setDecisionSubmitting(threadID, request.prompt_id, false);
    }
  };

  const submitApprovalAction = async (
    action: FlowerApprovalAction,
    approved: boolean,
  ) => {
    if (pendingThreadSelection()) return;
    const focusHandoff = captureBottomActionFocus(selectedThreadID(), action.action_id);
    let thread: FlowerThreadSnapshot | null = null;
    let submittedAction: FlowerApprovalAction | null = null;
    batch(() => {
      thread = selectedThread();
      const currentAction = thread?.approval_actions?.find((candidate) => (
        candidate.action_id === action.action_id
        && candidate.status === 'pending'
        && candidate.state === 'requested'
      ));
      if (!thread || !currentAction || !approvalActionCanDecide(currentAction) || !setDecisionSubmitting(thread.thread_id, currentAction.action_id, true)) {
        thread = null;
        return;
      }
      submittedAction = currentAction;
      clearApprovalError(thread.thread_id, currentAction.action_id);
      const threadID = trimString(thread.thread_id);
      if (!threadID) return;
      setApprovalQueueAnnouncement(copy().chat.toolApprovalSubmitting);
    });
    const submittedThread = thread as FlowerThreadSnapshot | null;
    const submittedApproval = submittedAction as FlowerApprovalAction | null;
    if (!submittedThread || !submittedApproval) {
      notifyComposerError(copy().chat.toolApprovalUnavailable);
      return;
    }
    const threadID = trimString(submittedThread.thread_id);
    let focusAfterSubmit = false;
    try {
      const requestEpoch = liveTransport.connectionEpoch();
      const result = await props.adapter.submitApproval(flowerApprovalRequest(submittedThread, submittedApproval, approved));
      if (requestEpoch !== liveTransport.connectionEpoch()) return;
      applyRuntimeCurrent(result.current);
      focusAfterSubmit = true;
    } catch (error) {
      if (isFlowerApprovalConflict(error)) {
        notifyThreadActionError(copy().chat.toolApprovalUnavailable);
        void requestThreadDetail(threadID, 'user_action', true);
      }
      if (selectedThreadDetailMatches(threadID) && !isFlowerApprovalConflict(error)) {
        if (selectedComposerApprovalActions().some(candidate => candidate.action_id === submittedApproval.action_id)) {
          setApprovalErrors(previous => ({ ...previous, [decisionSubmissionKey(threadID, submittedApproval.action_id)]: getErrorMessage(error) }));
        } else {
          notifyComposerError(getErrorMessage(error));
        }
      }
    } finally {
      setDecisionSubmitting(threadID, submittedApproval.action_id, false);
      if (focusAfterSubmit && selectedThreadDetailMatches(threadID)) {
        scheduleBottomActionFocus(focusHandoff);
      }
    }
  };

  const copyApprovalCommand = async (actionID: string, rawCommand: string) => {
    const command = rawCommand;
    if (!command.trim()) return;
    const key = `approval:${actionID}:command`;
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

  const submitApprovalBatchDecision = async (approved: boolean) => {
    if (pendingThreadSelection()) return;
    const thread = selectedThread();
    const pending = selectedApprovalBatchActions();
    if (!thread || pending.length < 2 || pending.some((action) => !approvalActionCanDecide(action))) return;
    const threadID = trimString(thread.thread_id);
    const focusHandoff = captureBottomActionFocus(threadID, pending[0]?.action_id);
    const submissionIDs = pending.map((action) => action.action_id);
    batch(() => submissionIDs.forEach((id) => { clearApprovalError(threadID, id); setDecisionSubmitting(threadID, id, true); }));
    setApprovalQueueAnnouncement(copy().chat.toolApprovalSubmitting);
    try {
      const requestEpoch = liveTransport.connectionEpoch();
      const result = await props.adapter.submitApproval({ thread_id: threadID, interaction_ids: submissionIDs, approved });
      if (requestEpoch !== liveTransport.connectionEpoch()) return;
      applyRuntimeCurrent(result.current);
      if (selectedThreadDetailMatches(threadID)) scheduleBottomActionFocus(focusHandoff);
    } catch (error) {
      if (isFlowerApprovalConflict(error)) {
        notifyThreadActionError(copy().chat.toolApprovalUnavailable);
        void requestThreadDetail(threadID, 'user_action', true);
      }
      if (selectedThreadDetailMatches(threadID) && !isFlowerApprovalConflict(error)) {
        setApprovalErrors(previous => ({ ...previous, ...Object.fromEntries(submissionIDs.map(id => [decisionSubmissionKey(threadID, id), getErrorMessage(error)])) }));
      }
    } finally {
      batch(() => submissionIDs.forEach((id) => setDecisionSubmitting(threadID, id, false)));
    }
  };

  const focusComposerIfConnected = () => { if (composerRef?.isConnected) composerRef.focus({ preventScroll: true }); };

  const isSubagentAttention = (request: FlowerInputRequest) => request.tool_name === 'subagents' && request.questions.some(question => question.id === 'subagent_attention');
  const subagentAttentionChoice = (label: string) => label === 'Continue after handling the child thread' ? copy().chat.subagentWaitAfterHandling : label === 'Continue using available results' ? copy().chat.subagentWaitAvailable : label;

  const inputRequestPrompt = (
    request: Accessor<FlowerInputRequest | null | undefined>,
    options: Readonly<{ surface?: 'history' | 'composer' }> = {},
  ) => {
    const composerSurface = options.surface === 'composer';
    const visibleQuestions = (inputRequest: FlowerInputRequest) => (
      composerSurface
        ? inputRequest.questions.filter((question) => question.id === activeInputQuestion()?.id)
        : inputRequest.questions
    );
    return (
    <Show when={request()}>
      {(inputRequest) => (
        <section
          class={cn('flower-input-request-panel', composerSurface && 'flower-input-request-surface', isComputerAssistanceInput(inputRequest()) && 'flower-computer-control-panel')}
          data-flower-input-request-prompt
          tabIndex={composerSurface ? -1 : undefined}
          aria-label={chatCopyValue('inputRequestTitle', 'Waiting for your reply')}
        >
          <Show when={isSubagentAttention(inputRequest())}>
            <div class="flower-input-request-description">{copy().chat.subagentWaitDescription}</div>
            <div class="flower-error-actions">
              <For each={selectedSubagentItems().filter(item => item.status === 'waiting_input')}>
                {(item) => <Button size="sm" variant="ghost" class="flower-attention-child" onClick={() => handleChildAttention(item.parentThreadID, item.threadID)}>{item.displayName || item.taskName || item.threadID}</Button>}
              </For>
            </div>
          </Show>
          <Show when={!isToolOriginComputerInput(inputRequest())}>
          <Show when={!composerSurface}>
          <div class="flower-input-request-heading">
            <span class="flower-input-request-heading-icon" aria-hidden="true">
              <Clock class="flower-input-request-icon h-4 w-4" />
            </span>
            <div class="flower-input-request-heading-copy">
              <div class="flower-input-request-title">{chatCopyValue('inputRequestTitle', 'Waiting for your reply')}</div>
            </div>
          </div>
          </Show>
          <div class="flower-input-request-questions" {...(composerSurface ? props.approvalScrollViewportProps : {})}>
            <FlowerKeyedList scope={selectedThreadID()} focusFallback={focusComposerIfConnected} each={visibleQuestions(inputRequest())} identity={(question) => JSON.stringify([selectedThreadID(), inputRequest().prompt_id, inputRequest().tool_id, question.id])}>
              {(question) => {
                const selectedChoiceID = () => questionDraft(question().id).answer_kind === 'choice'
                  ? trimString(questionDraft(question().id).choice_id)
                  : '';
                const customSelected = () => questionDraft(question().id).answer_kind === 'custom';
                const showCustomChoice = () => questionMode(question()) === 'select_or_write';
                const summary = () => isSubagentAttention(inputRequest()) ? '' : trimString(inputRequest().public_summary);
                const questionText = () => trimString(question().question);
                const showSummary = () => summary().length > 0 && summary() !== questionText() && summary() !== trimString(question().header) && question().id === inputRequest().questions[0]?.id;
                return (
                  <div
                    class={cn(
                      'flower-input-request-question',
                      activeInputQuestion()?.id === question().id && 'flower-input-request-question-active',
                    )}
                  >
                    <div class="flower-input-request-question-copy">
                      <Show when={trimString(question().header) && question().header !== question().question}>
                        <div class="flower-input-request-question-header">{question().header}</div>
                      </Show>
                      <div class="flower-input-request-question-text">{isSubagentAttention(inputRequest()) ? copy().chat.subagentWaitQuestion : question().question}</div>
                      <Show when={showSummary()}>
                        <div class="flower-input-request-description">{summary()}</div>
                      </Show>
                    </div>
                    <Show when={(question().choices?.length ?? 0) > 0 || showCustomChoice()}>
                      <Suspense fallback={<div class="h-20 animate-pulse rounded-md bg-muted/40" aria-hidden="true" />}>
                        <FlowerInputChoices
                          threadID={selectedThreadID()}
                          question={isSubagentAttention(inputRequest()) ? { ...question(), choices: question().choices?.map(choice => ({ ...choice, label: subagentAttentionChoice(choice.label) })) } : question()}
                          selectedChoiceID={selectedChoiceID()}
                          customSelected={customSelected()}
                          showCustomChoice={showCustomChoice()}
                          customLabel={trimString(question().write_label) || chatCopyValue('inputRequestOther', 'None of the above / Other')}
                          disabled={selectedThreadReadOnly()}
                          onSelectChoice={(choice) => selectInputChoice(question(), choice)}
                          onSelectCustom={() => selectInputCustomAnswer(question())}
                          focusFallback={focusComposerIfConnected}
                        />
                      </Suspense>
                    </Show>
                  </div>
                );
              }}
            </FlowerKeyedList>
          </div>
          <Show when={!composerSurface && inputTextQuestions().length > 1}>
            <div class="flower-input-request-text-targets" role="tablist" aria-label={chatCopyValue('inputRequestComposerPlaceholder', 'Reply to continue this conversation.')}>
              <FlowerKeyedList scope={selectedThreadID()} focusFallback={focusComposerIfConnected} each={inputTextQuestions()} identity={(question) => JSON.stringify([inputRequest().prompt_id, question.id])}>
                {(question) => (
                  <button
                    type="button"
                    class={cn(
                      'flower-input-request-text-target',
                      activeInputQuestion()?.id === question().id && 'flower-input-request-text-target-active',
                    )}
                    aria-selected={activeInputQuestion()?.id === question().id}
                    onClick={() => updateCurrentComposerSessionDraft((draft) => (draft.activeInputQuestionID === question().id ? draft : { ...draft, activeInputQuestionID: question().id }))}
                  >
                    {question().write_label || question().header}
                  </button>
                )}
              </FlowerKeyedList>
            </div>
          </Show>
          <Show when={composerSurface && inputRequest().questions.length > 1}>
            <nav class="flower-input-request-navigation" aria-label={chatCopyValue('inputRequestTitle', 'Waiting for your reply')}>
              <button
                type="button"
                class="flower-input-request-navigation-button"
                aria-label={chatCopyValue('inputRequestPrevious', 'Previous question')}
                title={chatCopyValue('inputRequestPrevious', 'Previous question')}
                disabled={inputRequestQuestionIndex() <= 0}
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
                disabled={inputRequestQuestionIndex() >= inputRequest().questions.length - 1}
                onClick={() => setActiveInputQuestionByOffset(1)}
              >
                <ChevronRight class="h-4 w-4" aria-hidden="true" />
              </button>
            </nav>
          </Show>
          </Show>
          <Show when={isComputerAssistanceInput(inputRequest())}>
            <div class="flower-computer-control-heading">
              <span class="flower-computer-control-icon" aria-hidden="true"><MonitorPointer class="h-4 w-4" /></span>
              <div class="flower-computer-control-copy">
                <div class="flower-computer-control-title">{selectedComputerAssistance().title}</div>
                <p class="flower-computer-control-hint">{selectedComputerAssistanceInstruction()}</p>
                <Show when={requestedComputerAccess().origin || requestedComputerAccess().app || requestedComputerAccess().foreground}>
                  <p class="flower-computer-control-resource">{[requestedComputerAccess().origin, requestedComputerAccess().app, requestedComputerAccess().foreground ? copy().computer.foreground : ''].filter(Boolean).join(' · ')}</p>
                </Show>
                <Show when={selectedComputerStage()?.target}><p class="flower-computer-control-hint">{selectedComputerStage()?.target}</p></Show>
              </div>
            </div>
            <Show when={computerControlError() || computerViewFailed() || computerResponseError()}>
              <div class="flower-computer-control-notice" role="alert">
                <AlertCircle class="h-4 w-4" aria-hidden="true" />
                <p>{(computerControlError() || computerViewFailed()) ? copy().chat.computerControlNotReady : computerResponseError()}</p>
              </div>
            </Show>
            <div class="flower-computer-control-footer">
              <Show when={composerSurface && isToolOriginComputerInput(inputRequest())}>
                <Button variant="ghost" icon={FlowerStopIcon} class="flower-composer-stop flower-computer-control-stop"
                  aria-label={selectedThreadStopLabel()} title={selectedThreadStopLabel()}
                  disabled={!selectedThreadCanStop() || selectedThreadStopPending()} loading={selectedThreadStopPending()}
                  onClick={() => void stopSelectedThreadFromComposer()}>{selectedThreadStopLabel()}</Button>
              </Show>
              <Show when={selectedThreadReadOnly()}><span class="flower-decision-readonly-status" role="status">{selectedThreadReadOnlyDisplay()}</span></Show>
              <div class="flower-computer-control-actions">
              <Show when={props.adapter.computerManagement && (selectedComputerAssistance().kind === 'access' || selectedComputerAssistance().kind === 'target')}><Button variant="secondary" disabled={inputRequestIsSubmitting()} onClick={() => setComputerDialog('settings')}>{copy().computer.title}</Button></Show>
              <Show when={selectedComputerAssistance().kind !== 'connection' && selectedComputerAssistance().kind !== 'installation' && selectedComputerAssistance().kind !== 'access' && selectedComputerAssistance().kind !== 'authorized' && selectedComputerAssistance().kind !== 'target' && computerResourceStatus()?.state !== 'unavailable'}>
              <Button variant="secondary" data-computer-control-action="take" disabled={computerResponseSubmitting() || !computerObserverID() || !computerCurrentVerified() || !props.adapter.inputComputerControl || (privateControlRequested() && computerStageOpen() && computerControlReady() && !computerControlError() && !computerViewFailed())} onClick={(event) => takeComputerControl(event.currentTarget)}>{computerControlDisconnected() ? copy().chat.computerResumeControl : privateControlRequested() && computerControlReady() && !computerControlError() && !computerViewFailed() ? copy().chat.computerControlTaken : copy().chat.computerTakeControl}</Button>
              </Show>
              <Show when={selectedComputerAssistance().kind === 'installation'}><Button variant="primary" disabled={!selectedDecisionAvailable() || inputRequestIsSubmitting()} onClick={() => setComputerDialog('installation')}>{copy().computer.browserInstallTitle}</Button></Show>
              <Show when={selectedComputerAssistance().kind === 'connection'}><Button variant="primary" disabled={!selectedDecisionAvailable() || inputRequestIsSubmitting()} onClick={() => setComputerDialog('connection')}>{copy().computer.connectionTitle}</Button></Show>
              <Show when={isToolOriginComputerInput(inputRequest()) && selectedComputerAssistance().kind !== 'connection' && selectedComputerAssistance().kind !== 'installation'}><Button variant="primary" icon={selectedComputerAssistance().kind === 'access' || selectedComputerAssistance().kind === 'authorized' ? Check : Refresh} data-computer-control-action={selectedComputerAssistance().kind === 'access' ? 'grant' : 'return'} disabled={!selectedDecisionAvailable() || inputRequestIsSubmitting() || (selectedComputerAssistance().kind === 'access' && !props.adapter.computerManagement)} loading={inputRequestIsSubmitting()} onClick={() => {
                const question = inputRequest().questions.find((question) => question.id === 'computer_control');
                const choice = question?.choices?.[0];
                if (!question || !choice) return;
                selectInputChoice(question, choice);
                void submitInputRequest(selectedComputerAssistance().kind === 'access' ? requestedComputerAccess() : undefined);
              }}>{selectedComputerAssistance().kind === 'access' ? copy().computer.allowContinue : selectedComputerAssistance().kind === 'authorized' ? copy().computer.continueTask : copy().chat.computerContinueCheck}</Button></Show>
              </div>
            </div>
          </Show>
        </section>
      )}
    </Show>
    );
  };

  const approvalActionCard = (
    actionID: string,
    action: Accessor<FlowerApprovalAction>,
    composerSurface = false,
  ) => {
    const canDecide = () => approvalActionCanDecide(action());
    const disabled = () => !canDecide();

    const submitting = () => approvalActionIsSubmitting(actionID);
    const statusID = `flower-approval-status-${actionID}`;
    const presentation = createMemo(() => presentFlowerApproval(action(), {
      title: copy().chat.toolApprovalComposerTitle,
      editFile: copy().chat.toolApprovalEditFile,
      runCommand: copy().chat.toolApprovalRunCommand,
      accessNetwork: copy().chat.toolApprovalAccessNetwork,
      outsideWorkspaceRisk: copy().chat.toolApprovalOutsideWorkspaceRisk,
      writesFilesRisk: copy().chat.toolApprovalWritesFilesRisk,
      executeRequestedAction: copy().chat.toolApprovalExecuteRequestedAction,
      workingDirectory: copy().chat.toolApprovalWorkingDirectoryDetail,
    }));
    const actionLabel = createMemo(() => presentation().operationLabel || copy().chat.toolApprovalRequired);
    const scopedThreadID = createMemo(() => (
      action().origin === 'delegated_subagent' && action().scope?.startsWith('thread:')
        ? action().scope!.slice('thread:'.length)
        : ''
    ));
    const subtaskLabel = createMemo(() => scopedThreadID() ? copy().chat.toolApprovalSubtaskSuffix(scopedThreadID()) : '');
    const commandText = createMemo(() => presentation().command ?? '');
    const commandCopyKey = `approval:${actionID}:command`;
    const commandCopied = () => copiedApprovalAction() === commandCopyKey;
    const operationIcon = () => {
      switch (presentation().operationKind) {
        case 'file':
          return <Pencil class="h-4 w-4" />;
        case 'terminal':
          return <Terminal class="h-4 w-4" />;
        case 'network':
          return <Globe class="h-4 w-4" />;
        default:
          return <Shield class="h-4 w-4" />;
      }
    };
    const unavailableCopy = createMemo(() => {
      if (selectedThreadDetailPending()) return copy().chat.threadLoading;
      if (selectedThreadReadOnly()) return selectedThreadReadOnlyDisplay();
      return action().read_only_reason || copy().chat.toolApprovalUnavailable;
    });
    const statusCopy = createMemo(() => submitting() ? '' : !canDecide() ? unavailableCopy() : '');
    const describedBy = createMemo(() => statusCopy() ? statusID : '');
    if (composerSurface) return <FlowerApprovalRow action={action()} presentation={presentation()} copy={copy().chat}
      disabled={disabled()} submitting={submitting()} status={statusCopy()}
      error={approvalErrors()[decisionSubmissionKey(selectedThreadID(), actionID)] || ''}
      copied={commandCopied()} subtaskLabel={subtaskLabel()} readingProps={props.approvalReadingProps}
      onCopy={() => void copyApprovalCommand(actionID, commandText())}
      onDecide={approved => void submitApprovalAction(action(), approved)} />;
    return (
      <section
        class="flower-approval-card"
        data-flower-approval-action-id={actionID}
        data-flower-approval-origin={action().origin}
        data-flower-approval-surface-role={action().surface_role || 'primary_action'}
        data-flower-approval-submitting={submitting() ? 'true' : undefined}
        aria-busy={submitting() ? 'true' : undefined}
      >
        <div class="flower-approval-body">
          <div class="flower-approval-header">
            <p class="flower-approval-intro">{presentation().title}</p>
            <Show when={commandText()}>
              <button
                type="button"
                class="flower-approval-copy-btn"
                data-copied={commandCopied() ? 'true' : 'false'}
                aria-label={`${copy().chat.toolApprovalCopyCommand}${subtaskLabel()}`}
                title={commandCopied() ? copy().chat.toolApprovalCopied : copy().chat.toolApprovalCopyCommand}
                onClick={() => void copyApprovalCommand(actionID, commandText())}
              >
                <Copy class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </Show>
          </div>
          <div class="flower-approval-operation" data-flower-approval-operation-kind={presentation().operationKind}>
            <span class="flower-approval-operation-icon" aria-hidden="true">{operationIcon()}</span>
            <div class="flower-approval-operation-copy">
              <div class="flower-approval-operation-heading">
                <strong class="flower-approval-operation-label">{presentation().operationLabel}</strong>
                <Show when={presentation().description}>
                  {(description) => (
                    <span class="flower-approval-operation-description" title={description()}>
                      <span aria-hidden="true">·</span> {description()}
                    </span>
                  )}
                </Show>
              </div>
              <Show when={presentation().targets.length > 0}>
                <div class="flower-approval-targets">
                  <For each={presentation().targets}>
                    {(target) => <span class="flower-approval-target">{target}</span>}
                  </For>
                </div>
              </Show>
            </div>
          </div>
          <Show when={commandText()}>
            {(command) => (
              <pre class="flower-approval-command-text"><FlowerShellCommandHighlight command={command()} /></pre>
            )}
          </Show>
          <Show when={presentation().details.length > 0}>
            <div class="flower-approval-context">
              <div class="flower-approval-targets">
                <For each={presentation().details}>
                  {(detail) => <span class="flower-approval-target">{detail}</span>}
                </For>
              </div>
            </div>
          </Show>
          <Show when={presentation().risk}>
            {(note) => <p class="flower-approval-risk"><AlertCircle class="h-3.5 w-3.5" aria-hidden="true" /><span>{note()}</span></p>}
          </Show>
          <Show when={statusCopy()}>
            {(message) => <p id={statusID} class="flower-approval-status">{message()}</p>}
          </Show>
        </div>
        <div class="flower-approval-actions">
          <Show when={canDecide()} fallback={<div class="flower-approval-unavailable">{unavailableCopy()}</div>}>
            <Button
              variant="outline"
              size="sm"
              class="flower-composer-continue rounded-full"
              disabled={disabled()}
              aria-label={copy().chat.toolApprovalRejectAction(actionLabel(), subtaskLabel())}
              aria-describedby={describedBy() || undefined}
              onClick={() => void submitApprovalAction(action(), false)}
            >
              {copy().chat.toolApprovalReject}
            </Button>
            <Button
              variant="primary"
              size="sm"
              class="flower-composer-continue rounded-full"
              disabled={disabled()}
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
        <FlowerKeyedList scope={selectedThreadID()} focusFallback={focusComposerIfConnected} each={selectedThreadLevelApprovalActions()} identity={(action) => JSON.stringify([selectedThreadID(), action.turn_id, action.run_id, action.action_id])}>
          {(action) => approvalActionCard(action().action_id, action)}
        </FlowerKeyedList>
      </section>
    </Show>
  );

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
    itemID: item.kind === 'tool' && item.tool_id ? item.tool_id : item.item_id,
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

  const activityItemAriaLabel = (item: FlowerActivityItem): string => (
    [
      presentFlowerActivityItem(item, {
        tools: copy().chat.toolActivity,
      webSearch: copy().chat.webSearch,
        statuses: copy().chat.toolStatuses,
        subagents: subagentsCopy(),
        goal: copy().chat,
        subagentSummaries: selectedSubagentSummaries() ?? [],
        terminal: {
          runCommand: copy().chat.toolActivityRunCommand,
          readCommandOutput: copy().chat.toolActivityReadCommandOutput,
          writeCommandInput: copy().chat.toolActivityWriteCommandInput,
          terminateCommand: copy().chat.toolActivityTerminateCommand,
        },
      }).label,
      copy().chat.toolStatuses[item.status],
    ].filter(Boolean).join('. ')
  );

  const activityTitle = (title: FlowerActivityTitle) => {
    if (title.kind === 'file') {
      return (
        <>
          <strong class="flower-activity-inline-title-verb">{copy().chat.toolActivity[title.verb === 'Read' ? 'read' : title.verb === 'Delete' ? 'delete' : 'edit']}</strong>
          <span class="flower-activity-inline-title-target">{title.display_name}</span>
        </>
      );
    }
    if (title.kind === 'web_search') {
      return <>
        <span class="flower-activity-inline-title-target" title={title.url || title.text}>{title.text || copy().chat.webSearch.search}</span>
      </>;
    }
    if (title.kind === 'web_fetch') {
      return (
        <>
          <strong class="flower-activity-inline-title-verb">{copy().chat.toolActivity.fetch}</strong>
          <span class="flower-activity-inline-title-target flower-activity-web-fetch-title-url" title={title.url}>{title.url}</span>
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
            url: trimString(block.url),
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

  const pendingActivityFileOpens = new Set<string>();
  const openActivityFile = (action: FlowerActivityFileAction, preview: boolean) => {
    if (selectedThreadDetailPending() || !action.path || !props.adapter.openMessageFile) return;
    const key = JSON.stringify([action.path, preview, action.target_kind]);
    if (pendingActivityFileOpens.has(key)) return;
    pendingActivityFileOpens.add(key);
    void props.adapter.openMessageFile({
      path: action.path,
      action: preview ? 'preview' : 'reveal',
      kind: action.target_kind === 'directory' ? 'directory' : 'file',
    }).catch(error => notifyThreadActionError(getErrorMessage(error)))
      .finally(() => pendingActivityFileOpens.delete(key));
  };

  const fileActionButtons = (
    action: Accessor<FlowerActivityFileAction | null>,
    attachmentTarget: Accessor<FlowerMessageAttachmentPreviewTarget | null> = () => null,
  ) => {
    const targetPath = () => trimString(action()?.path);
    const canPreview = () => Boolean(
      attachmentTarget()
      || (action()?.can_preview && targetPath() && props.adapter.openMessageFile),
    );
    const canBrowseDirectory = () => Boolean(
      action()?.can_browse_directory
      && targetPath()
      && props.adapter.openMessageFile,
    );
    const displayName = () => trimString(attachmentTarget()?.name) || trimString(action()?.display_name) || copy().chat.toolActivity.file;
    return (
      <Show when={canPreview() || canBrowseDirectory()}>
        <div class="flower-activity-file-actions" aria-label={copy().chat.toolActivity.fileActions}>
          <Show when={canPreview()}>
            <button
              type="button"
              class="flower-activity-file-action-button"
              title={copy().chat.toolActivity.previewFile}
              aria-label={`${copy().chat.toolActivity.previewFile}: ${displayName()}`}
              disabled={!attachmentTarget() && selectedThreadDetailPending()}
              onClick={(event) => {
                event.stopPropagation();
                if (attachmentTarget()) {
                  openMessageAttachmentPreview(attachmentTarget()!);
                  return;
                }
                if (action()) openActivityFile(action()!, true);
              }}
            >
              <FileItemIcon size={14} item={{ name: displayName(), type: 'file' }} class="size-3.5" />
            </button>
          </Show>
          <Show when={canBrowseDirectory() && action()}>
            <button
              type="button"
              class="flower-activity-file-action-button"
              title={copy().chat.toolActivity.browseFolder}
              aria-label={`${copy().chat.toolActivity.browseFolder}: ${displayName()}`}
              disabled={selectedThreadDetailPending()}
              onClick={(event) => {
                event.stopPropagation();
                openActivityFile(action()!, false);
              }}
            >
              <FileItemIcon size={14} item={{ name: displayName(), type: 'folder' }} open class="size-3.5" />
            </button>
          </Show>
        </div>
      </Show>
    );
  };

  const detailLinesBlock = (block: Accessor<Extract<FlowerActivityDetailBlock, { kind: 'structured' }>>) => (
    <>
      <For each={block().lines}>
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
    failureDetailPresent: Accessor<boolean>;
  }>;
  type FlowerNonTerminalDetailBlock = Exclude<FlowerActivityDetailBlock, { kind: 'terminal_output' }>;

  const TerminalOutputBlock: Component<FlowerTerminalOutputBlockProps> = (detailProps) => {
    const terminal = createMemo(() => detailProps.block().terminal);
    const [commandExpanded, setCommandExpanded] = createSignal(false);
    const [commandCopied, setCommandCopied] = createSignal(false);
    const [liveLastSeq, setLiveLastSeq] = createSignal(terminal().last_seq);
    const [liveError, setLiveError] = createSignal('');
    const outputViewport = createTerminalOutputViewportController({
      interaction: { root: document.documentElement, attribute: FLOE_HOT_INTERACTION_ATTR },
    });
    let commandCopyResetTimer: number | undefined;
    const command = () => trimString(terminal().command);
    const commandPanelID = () => `flower-terminal-command-${flowerActivityIdentity({
      threadID: detailProps.context().ownerThreadID,
      runID: detailProps.context().runID,
      turnID: detailProps.context().turnID,
      itemID: detailProps.context().itemID,
    }).replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
    const processID = createMemo(() => trimString(terminal().process_id));
    const liveRunID = createMemo(() => detailProps.context().runID);
    const liveExecutionIdentity = createMemo(() => {
      const context = detailProps.context();
      return JSON.stringify([context.ownerThreadID, context.renderThreadID, context.turnID, context.runID, context.itemID, context.toolID]);
    });
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
    outputViewport.setOutput(initialOutput);
    const canReadLiveOutput = createMemo(() => (
      terminal().operation !== 'write' && terminal().operation !== 'read' &&
      !!props.adapter.readTerminalProcess &&
      detailProps.context().runID !== '' &&
      processID() !== '' &&
      (detailProps.canonicalStatus() === 'running' || detailProps.canonicalStatus() === 'pending')
    ));
    const displayStatus = detailProps.canonicalStatus;
    const displayCanceled = () => displayStatus() === 'canceled';
    const displayUserRejected = () => detailProps.approvalState() === 'rejected';
    const visibleOutput = liveOutput;
    const resultNotice = () => {
      if (displayUserRejected()) return copy().chat.toolApprovalRejectedDetail;
      if (displayCanceled()) return copy().chat.toolCallCanceled;
      if (terminal().operation === 'write') {
        if (displayStatus() === 'success') return copy().chat.terminalInputSent;
        if (displayStatus() === 'error') return detailProps.failureDetailPresent() ? '' : copy().chat.terminalInputFailed;
        return copy().chat.terminalInputPending;
      }
      if (terminal().timed_out) return copy().chat.terminalTimedOut;
      if (terminal().terminated) return copy().chat.terminalStopped;
      const exitCode = terminal().exit_code;
      if (exitCode != null && exitCode !== 0) return copy().chat.terminalExitCode(exitCode);
      return '';
    };
    const emptyOutputNotice = () => {
      if (resultNotice() || liveError() || detailProps.failureDetailPresent()) return '';
      if (terminalListeningPlaceholderVisible(visibleOutput(), displayStatus())) {
        return copy().chat.terminalWaitingOutput;
      }
      if (terminal().operation === 'read') return copy().chat.terminalNoNewOutput;
      if (terminal().exit_code === 0) return copy().chat.terminalFinishedNoOutput;
      if (terminal().operation === 'exec' && displayStatus() === 'success') return copy().chat.terminalStartedNoOutput;
      return copy().chat.terminalNoOutput;
    };
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

    createEffect(on([canReadLiveOutput, liveRunID, processID, liveExecutionIdentity], ([enabled, runID, process]) => {
      if (!enabled) return;
      let disposed = false;
      let timer: number | undefined;
      const poll = async () => {
        if (disposed || !canReadLiveOutput() || !props.adapter.readTerminalProcess) return;
        try {
          const snapshot = await props.adapter.readTerminalProcess({
            run_id: runID,
            process_id: process,
            after_seq: untrack(() => liveLastSeq()),
          });
          if (disposed) return;
          setLiveError('');
          applyTerminalSnapshot(snapshot);
          const processStatus = normalizeTerminalSnapshotStatus(snapshot.status);
          if (processStatus && processStatus !== 'running' && processStatus !== 'pending') {
            outputViewport.setOutput(untrack(liveOutput), true);
            return;
          }
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
    }));

    createEffect(on([terminal, liveExecutionIdentity, processID], () => {
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
    }));

    createEffect(() => {
      const status = displayStatus();
      outputViewport.setOutput(visibleOutput(), (status !== 'running' && status !== 'pending')
        || Boolean(liveError()) || detailProps.failureDetailPresent());
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
        <Show when={command()}>
          <div class="flower-activity-terminal-header">
            <span class="flower-activity-terminal-prompt" aria-hidden="true">$</span>
            <span
              id={commandPanelID()}
              class={cn('flower-activity-terminal-command', commandExpanded() && 'flower-activity-terminal-command-expanded')}
            >
              <FlowerShellCommandHighlight
                command={terminal().command}
                class="flower-activity-terminal-command-code"
                tokenClassPrefix="flower-activity-terminal-command-token"
              />
            </span>
            <div class="flower-activity-terminal-actions" aria-label={copy().chat.terminalCommandActions}>
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
            </div>
          </div>
        </Show>
        <Show when={terminal().operation !== 'write' && visibleOutput().trim()} fallback={
          <Show when={emptyOutputNotice()}>
            {(notice) => <p class="flower-activity-terminal-notice">{notice()}</p>}
          </Show>
        }>
          <div class="flower-activity-terminal-output-heading">
            <span>{copy().chat.terminalOutputLabel}</span>
            <Show when={terminal().exit_code === 0 && displayStatus() === 'success' && !terminal().timed_out && !terminal().terminated && !displayUserRejected()}>
              <span class="flower-activity-terminal-exit">
                <Check class="h-3 w-3" aria-hidden="true" />
                {copy().chat.terminalExitCodeLabel(0)}
              </span>
            </Show>
          </div>
          <div
            ref={outputViewport.bind}
            class="flower-activity-terminal-output"
            onScroll={outputViewport.onScroll}
            onWheel={outputViewport.onWheel}
          >
            <pre ref={outputViewport.bindOutput} />
          </div>
        </Show>
        <Show when={resultNotice()}>
          {(notice) => <p class={cn('flower-activity-terminal-notice', (displayCanceled() || terminal().timed_out || displayStatus() === 'error') && 'flower-activity-terminal-notice-error')}>{notice()}</p>}
        </Show>
        <Show when={terminal().operation !== 'write' && (terminal().has_more || terminal().truncated)}>
          <p class="flower-activity-terminal-notice">{copy().chat.terminalPartialOutput}</p>
        </Show>
        <Show when={liveError()}>
          {(error) => <p class="flower-activity-terminal-notice flower-activity-terminal-notice-error">{copy().chat.terminalLiveOutputUnavailable(error())}</p>}
        </Show>
      </section>
    );
  };

  const webEntryList = (label: string, entries: Accessor<readonly { title: string; url: string; snippet: string; source: string }[]>) => (
    <Show when={entries().length > 0}>
      <div class="flower-activity-web-section">
        <div class="flower-activity-detail-heading">{label}</div>
        <div class="flower-activity-web-list" role="list">
          <For each={entries()}>
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

  const webSearchBlock = (block: Accessor<Extract<FlowerActivityDetailBlock, { kind: 'web_search' }>>) => {
    const search = () => block().search;
    const resultCount = () => search().count === 1 ? '1 result' : `${search().count} results`;
    return (
      <section class="flower-activity-web-panel">
        <div class="flower-activity-web-summary">
          <Show when={search().query}>
            {(query) => <span class="flower-activity-web-query">{query()}</span>}
          </Show>
          <Show when={search().provider}>
            {(provider) => <span class="flower-activity-web-chip">{provider()}</span>}
          </Show>
          <Show when={search().count !== undefined}>
            <span class="flower-activity-web-chip">{resultCount()}</span>
          </Show>
        </div>
        {webEntryList('Results', () => search().results)}
        {webEntryList('Matches', () => search().matches)}
        {webEntryList('Sections', () => search().sections)}
        {webEntryList('Sources', () => search().sources)}
      </section>
    );
  };

  const formatWebFetchBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const webFetchBlock = (block: Accessor<Extract<FlowerActivityDetailBlock, { kind: 'web_fetch' }>>) => {
    const fetch = () => block().fetch;
    const openURL = () => safeWebFetchURL(fetch().final_url || fetch().url);
    const redirected = () => fetch().url && fetch().final_url && fetch().url !== fetch().final_url;
    return (
      <section class="flower-activity-web-fetch-panel">
        <div class="flower-activity-web-fetch-route">
          <Show when={fetch().url}>
            {(url) => <span class="flower-activity-web-fetch-url" title={url()}>{url()}</span>}
          </Show>
          <Show when={redirected()}>
            <span class="flower-activity-web-fetch-arrow" aria-hidden="true">→</span>
            <span class="flower-activity-web-fetch-url" title={fetch().final_url}>{fetch().final_url}</span>
          </Show>
          <Show when={openURL()}>
            {(url) => (
              <a
                class="flower-activity-web-fetch-open"
                href={url()}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={copy().chat.toolActivityOpenWebPage}
                title={copy().chat.toolActivityOpenWebPage}
                onClick={(event) => event.stopPropagation()}
              >
                <ExternalLink class="h-3.5 w-3.5" />
              </a>
            )}
          </Show>
        </div>
        <div class="flower-activity-web-summary">
          <Show when={fetch().status_code !== undefined}>
            <span class="flower-activity-web-chip">HTTP {fetch().status_code}</span>
          </Show>
          <Show when={fetch().content_type}>
            {(contentType) => <span class="flower-activity-web-chip">{contentType()}</span>}
          </Show>
          <Show when={fetch().format}>
            {(format) => <span class="flower-activity-web-chip">{format()}</span>}
          </Show>
          <Show when={fetch().bytes_read !== undefined}>
            <span class="flower-activity-web-chip">{formatWebFetchBytes(fetch().bytes_read ?? 0)}</span>
          </Show>
          <Show when={fetch().truncated}>
            <span class="flower-activity-web-chip flower-activity-web-fetch-truncated">{copy().chat.truncatedLabel}</span>
          </Show>
        </div>
        <Show when={fetch().content_preview}>
          {(preview) => (
            <div class="flower-activity-web-fetch-preview-section">
              <div class="flower-activity-web-fetch-untrusted" role="note">
                {copy().chat.toolActivityExternalContentNotice}
              </div>
              <div class="flower-activity-web-fetch-preview" data-format={fetch().format || 'text'}>
                <Show
                  when={fetch().format === 'markdown'}
                  fallback={<pre>{preview()}</pre>}
                >
                  <FlowerMarkdownBlock
                    content={preview()}
                    streaming={false}
                    copyCodeLabel={copy().chat.copyCode}
                    codeCopiedLabel={copy().chat.codeCopied}
                    class="flower-activity-web-fetch-preview-markdown"
                  />
                </Show>
              </div>
              <Show when={fetch().preview_truncated}>
                <div class="flower-activity-web-fetch-preview-truncated">{copy().chat.toolActivityPreviewTruncated}</div>
              </Show>
            </div>
          )}
        </Show>
      </section>
    );
  };

  const questionBlock = (block: Accessor<Extract<FlowerActivityDetailBlock, { kind: 'question' }>>) => (
    <section class="flower-activity-question-panel">
      <Show when={block().question.reason}>
        {(reason) => <div class="flower-activity-question-reason">{reason()}</div>}
      </Show>
      <Show when={block().question.required.length > 0}>
        <div class="flower-activity-question-required">
          <For each={block().question.required}>
            {(required) => <span class="flower-activity-question-chip">{required}</span>}
          </For>
        </div>
      </Show>
      <For each={block().question.questions}>
        {(question) => {
          const answer = () => block().question.answers.find((candidate) => candidate.question_id === question.id);
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
      <Show when={block().question.questions.length === 0}>
        <div class="flower-activity-question-empty">{copy().chat.inputRequestTitle}</div>
      </Show>
    </section>
  );

  const fileReadBlock = (block: Accessor<Extract<FlowerActivityDetailBlock, { kind: 'file_read' }>>) => {
    const lineSummary = () => {
      const start = Math.max(1, Math.floor(Number(block().line_offset || 1)));
      const count = Math.max(0, Math.floor(Number(block().line_count || 0)));
      const total = Math.max(0, Math.floor(Number(block().total_lines || 0)));
      if (count <= 0) return total > 0 ? copy().chat.fileReadEmptyTotal(total) : copy().chat.fileReadEmpty;
      const end = start + count - 1;
      return total > 0 ? copy().chat.fileReadRangeTotal(start, end, total) : copy().chat.fileReadRange(start, end);
    };
    return (
      <div class="flower-activity-file-read">
        <div class="flower-activity-file-toolbar">
          <span class="flower-activity-file-meta">
            {lineSummary()}
            <Show when={block().truncated}>
              <span class="flower-activity-file-truncated"> · {copy().chat.truncatedLabel}</span>
            </Show>
          </span>
          {fileActionButtons(() => block().action)}
        </div>
        <pre class="flower-activity-file-read-content"><code>{block().content}</code></pre>
      </div>
    );
  };

  const fileDiffBlock = (block: Accessor<Extract<FlowerActivityDetailBlock, { kind: 'file_diff' }>>) => (
    <div class="flower-activity-file-diff-list">
      <FlowerKeyedList scope={selectedThreadID()} focusFallback={focusComposerIfConnected} each={block().files} identity={(file) => file.action.path || file}>
        {(file) => fileDiffFile(file, () => block().files.length > 1)}
      </FlowerKeyedList>
    </div>
  );

  const fileDiffFile = (file: Accessor<FlowerActivityDiffFile>, showFileHeader: Accessor<boolean>) => (
    <section class="flower-activity-file-diff-file">
      <Show when={showFileHeader()}>
        <div class="flower-activity-file-toolbar">
          <span class="flower-activity-file-path">{file().display_name}</span>
          <Show when={file().additions || file().deletions}>
            <span class="flower-activity-file-change">
              <span class="flower-activity-file-stat-add">+{file().additions}</span>
              {' / '}
              <span class="flower-activity-file-stat-del">-{file().deletions}</span>
            </span>
          </Show>
          <Show when={file().truncated}>
            <span class="flower-activity-file-truncated">{copy().chat.toolActivityDiffTruncated}</span>
          </Show>
          {fileActionButtons(() => file().action)}
        </div>
      </Show>
      <div class="flower-activity-file-diff-grid">
        <Show
          when={getGitPatchRenderSnapshot(file().patch_text).renderedLines.length > 0}
          fallback={<div class="flower-activity-file-diff-empty">{copy().chat.toolActivityNoTextualDiff}</div>}
        >
          <div class="flower-activity-file-diff-unified">
            <For each={getGitPatchRenderSnapshot(file().patch_text).renderedLines}>
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

  const openSubagentMessages = (agent: FlowerActivitySubagentDetailItem) => {
    const action = agent.open_messages;
    if (!action?.thread_id) return;
    const item = selectedSubagentItems().find(child => child.threadID === action.thread_id);
    if (item) openSubagentDetail(item);
  };

  const errorDetailBlock = (block: Accessor<Extract<FlowerActivityDetailBlock, { kind: 'error' }>>) => (
    <section class="flower-activity-error-panel" aria-label={copy().chat.toolStatuses.error}>
      <div class="flower-activity-error-message">{block().error.message}</div>
      <Show when={block().error.code || block().error.target_state || block().error.repair_action}>
        <div class="flower-activity-error-recovery" role="status">
          <Show when={block().error.code}>
            <span class="flower-activity-error-chip">{block().error.code}</span>
          </Show>
          <Show when={block().error.target_state}>
            <span class="flower-activity-error-state">{block().error.target_state}</span>
          </Show>
          <Show when={block().error.repair_action}>
            <span class="flower-activity-error-repair">{copy().chat.toolActivityComputerSuggestedAction.replace('{action}', block().error.repair_action!)}</span>
          </Show>
        </div>
      </Show>
      <Show when={block().error.suggested_targets && block().error.suggested_targets!.length > 0}>
        <div class="flower-activity-error-targets">
          {copy().chat.toolActivityComputerAvailableTargets.replace('{targets}', block().error.suggested_targets!.join(', '))}
        </div>
      </Show>
    </section>
  );

  const subagentsDetailBlock = (block: Accessor<Extract<FlowerActivityDetailBlock, { kind: 'subagents' }>>) => (
    <section class="flower-activity-subagents-panel" aria-label={subagentsCopy().title}>
      <div class="flower-activity-subagents-list" role="list">
        <FlowerKeyedList scope={selectedThreadID()} focusFallback={focusComposerIfConnected} each={block().subagents.items} identity={(agent) => agent.thread_id || agent}>
          {(agent) => {
            const current = createMemo(() => selectedSubagentItems().find((item) => item.threadID === agent().open_messages?.thread_id));
            const status = () => normalizeSubagentPanelStatus(agent().raw_status);
            const title = () => [agent().name, subagentStatusLabel(status()), subagentsCopy().openThread].join('. ');
            return <div class="flower-activity-subagents-item" role="listitem">
              <Show when={agent().open_messages && current()} fallback={<span class="flower-activity-subagent-unavailable">{agent().name}</span>}>
                <button type="button" class="flower-subagent-capsule"
                  data-flower-subagent-capsule={agent().open_messages?.thread_id}
                  data-flower-subagent-status={status()}
                  aria-label={title()} title={[title(), agent().description].filter(Boolean).join('\n')}
                  aria-pressed={activeSubagentID() === agent().open_messages?.thread_id}
                  onClick={() => openSubagentMessages(agent())}>
                  <SubagentAvatar threadID={agent().open_messages!.thread_id} class="flower-subagent-capsule-avatar" />
                  <span class="flower-subagent-capsule-name">{presentSubagentTaskName(agent().name)}</span>
                  <span class="flower-subagent-capsule-status" aria-hidden="true">{subagentStatusIndicator(status())}</span>
                </button>
              </Show>
            </div>;
          }}
        </FlowerKeyedList>
      </div>
    </section>
  );

  const ActivityDetailBlock: Component<{
    media: ReturnType<ReturnType<typeof createThreadMedia>>;
    block: FlowerNonTerminalDetailBlock;
  }> = (detailProps) => {
    const blockOfKind = <K extends FlowerNonTerminalDetailBlock['kind']>(_kind: K) =>
      () => detailProps.block as Extract<FlowerNonTerminalDetailBlock, { kind: K }>;
    return <Switch>
      <Match when={detailProps.block.kind === 'parent_report'}>
        <FlowerActivityRows block={{ kind: 'structured_rows', section: 'results', rows: [],
          notice: blockOfKind('parent_report')().accepted ? copy().chat.toolActivity.parentReportRecorded : undefined }} copy={copy().chat} />
        <Show when={blockOfKind('parent_report')().accepted && blockOfKind('parent_report')().parentThreadID === selectedThreadID()
          && parentEventReading.events().some(event => event.id === blockOfKind('parent_report')().eventID)}>
          <button type="button" class="flower-parent-event-action" onClick={() => {
            const eventID = blockOfKind('parent_report')().eventID;
            const event = parentEventReading.events().find(event => event.id === eventID);
            if (event?.parent_turn_id) turnDisclosureChoices.retainExpanded(JSON.stringify([
              props.adapter.runtime.runtime_id, selectedThreadID(), event.parent_turn_id,
            ]));
            closeSubagentOverlays();
            requestTranscriptAnimationFrame(() => {
              const row = [...(transcriptScroll.viewport()?.querySelectorAll<HTMLElement>('[data-parent-event]') ?? [])].find(row => row.dataset.parentEvent === eventID);
              if (!row) return;
              transcriptScroll.stopFollowing();
              const disclosure = row.querySelector<HTMLButtonElement>('.flower-parent-event-disclosure');
              if (disclosure?.getAttribute('aria-expanded') === 'false') disclosure.click();
              row.scrollIntoView({ block: 'nearest' });
              disclosure?.focus({ preventScroll: true });
            });
          }}>{copy().chat.toolActivity.parentReportView}<ExternalLink class="h-3 w-3" aria-hidden="true" /></button>
        </Show>
        <FlowerActivityRows block={{ kind: 'structured_rows', section: 'inputs', rows: blockOfKind('parent_report')().message
          ? [{ title: copy().chat.toolActivity.parentReportContent, content: blockOfKind('parent_report')().message, meta: '', format: 'text' }] : [] }} copy={copy().chat} />
      </Match>
      <Match when={detailProps.block.kind === 'goal'}>
        <div class="flower-goal-review-body">
          <Show when={blockOfKind('goal')().text}><p class="flower-goal-review-text">{blockOfKind('goal')().text}</p></Show>
          <Show when={blockOfKind('goal')().evidence}><p class="flower-goal-review-evidence">{blockOfKind('goal')().evidence}</p></Show>
        </div>
      </Match>
      <Match when={detailProps.block.kind === 'error'}>{errorDetailBlock(blockOfKind('error'))}</Match>
      <Match when={detailProps.block.kind === 'structured_rows'}>
        <Show when={blockOfKind('structured_rows')().preview} fallback={<FlowerActivityRows block={blockOfKind('structured_rows')()} copy={copy().chat} renderTargetActions={target => fileActionButtons(() => ({ path: target.path ?? '', target_kind: target.kind, display_name: target.label, can_preview: target.kind === 'file', can_browse_directory: true }))} />}>
          <FlowerActivityPreview block={blockOfKind('structured_rows')()} copy={copy().chat} />
        </Show>
      </Match>
      <Match when={detailProps.block.kind === 'image'}><MarkdownMedia class="flower-activity-image-thumbnail" source={{ kind: 'image', src: blockOfKind('image')().resource_ref, title: blockOfKind('image')().name }} labels={{ ...copy().chat.media, unavailable: blockOfKind('image')().resource_ref.startsWith('computer://') ? copy().chat.computerScreenshotLoadFailed : copy().chat.media.unavailable }} resolve={detailProps.media.resolve} loadTimeoutMs={15_000} /></Match>
      <Match when={detailProps.block.kind === 'subagents'}>{subagentsDetailBlock(blockOfKind('subagents'))}</Match>
      <Match when={detailProps.block.kind === 'web_search'}>{webSearchBlock(blockOfKind('web_search'))}</Match>
      <Match when={detailProps.block.kind === 'web_fetch'}>{webFetchBlock(blockOfKind('web_fetch'))}</Match>
      <Match when={detailProps.block.kind === 'question'}>{questionBlock(blockOfKind('question'))}</Match>
      <Match when={detailProps.block.kind === 'structured'}>{detailLinesBlock(blockOfKind('structured'))}</Match>
      <Match when={detailProps.block.kind === 'file_read'}>{fileReadBlock(blockOfKind('file_read'))}</Match>
      <Match when={detailProps.block.kind === 'file_diff'}>{fileDiffBlock(blockOfKind('file_diff'))}</Match>
      <Match when={detailProps.block.kind === 'web_operation'}><WebSearchActivity search={(detailProps.block as Extract<FlowerActivityDetailBlock, { kind: 'web_operation' }>).search} copy={copy().chat.webSearch} openLabel={copy().chat.toolActivityOpenWebPage} /></Match>
      <Match when={detailProps.block.kind === 'todos'}>
        <div class="flower-activity-todo-list" role="list" aria-label={copy().chat.toolActivity.todos}>
          <For each={(detailProps.block as Extract<FlowerActivityDetailBlock, { kind: 'todos' }>).items}>
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
                </span>
                <span class={cn('flower-activity-todo-badge', `flower-activity-todo-badge-${todo.status}`)}>
                  {todoStatusLabel(todo.status)}
                </span>
              </div>
            )}
          </For>
        </div>
</Match>
    </Switch>;
  };

  const changeStats = (stats: Accessor<FlowerArgumentPreview | undefined>, preview: Accessor<boolean>) => (
    <Show when={stats()}>
      {(value) => <span class="flower-activity-inline-change-stats" title={preview() ? copy().chat.outputProgress.previewTooltip : undefined}>
        <Show when={value().additions !== undefined}><span class="flower-activity-file-stat-add">+{value().additions}</span></Show>
        <Show when={value().additions !== undefined && value().deletions !== undefined}><span aria-hidden="true"> / </span></Show>
        <Show when={value().deletions !== undefined}><span class="flower-activity-file-stat-del">−{value().deletions}</span></Show>
      </span>}
    </Show>
  );

  const argumentPreviewRow = (block: Accessor<FlowerToolCallPreviewBlock>) => {
    const revealTitle = useFlowerActivityTitleReveal(() => flowerToolCallPreviewIdentity(block().call));
    return (
      <div class="flower-activity-inline-row flower-activity-inline-row-generating" data-flower-tool-call-id={block().call.call_id} data-flower-argument-generation="true" data-flower-activity-active={livePresentationConfirmed() ? 'true' : undefined}>
        <div class="flower-activity-inline-line">
          <div class="flower-activity-inline-button flower-activity-inline-button-static">
            <span class="flower-activity-inline-icon"><FlowerToolIcon toolName={block().call.name} running={livePresentationConfirmed()} /></span>
            <span class="flower-activity-inline-copy">
              <span ref={revealTitle.bind} class="flower-activity-inline-title" data-floe-progress-shimmer={livePresentationConfirmed() && !revealTitle.revealing() ? 'text' : undefined}>
                <span class="flower-activity-inline-title-verb">{block().call.name === 'goal' ? copy().chat.goalTitle : block().call.name === 'apply_patch' ? copy().chat.toolActivity.patch : copy().chat.toolActivity.edit}</span>
                <Show when={block().call.preview?.display_name}>{(name) => <span class="flower-activity-inline-title-target" title={name()}>{name()}</span>}</Show>
              </span>
              <Show when={block().call.name !== 'goal'}><span class="flower-activity-inline-detail">{copy().chat.outputProgress.preparingChanges}</span></Show>
              {changeStats(() => block().call.preview ?? undefined, () => true)}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const activityRow = (
    messageID: Accessor<string>,
    blockIndex: Accessor<number>,
    timeline: Accessor<FlowerActivityTimelineBlock>,
    item: Accessor<FlowerActivityItem>,
    viewportScope: FlowerScrollTailController,
    media: ReturnType<typeof createThreadMedia>,
  ) => {
    const disclosureKey = createMemo(() => activityItemKey(messageID(), timeline(), item()));
    const presentation = createMemo<FlowerActivityPresentation>((previous) => retainEqualValue(previous, presentFlowerActivityItem(item(), {
      tools: copy().chat.toolActivity,
      webSearch: copy().chat.webSearch,
      statuses: copy().chat.toolStatuses,
      subagents: subagentsCopy(),
      goal: copy().chat,
      subagentSummaries: timeline().thread_id === selectedThreadID() ? selectedSubagentSummaries() ?? [] : [],
      terminal: {
        runCommand: copy().chat.toolActivityRunCommand,
        readCommandOutput: copy().chat.toolActivityReadCommandOutput,
        writeCommandInput: copy().chat.toolActivityWriteCommandInput,
        terminateCommand: copy().chat.toolActivityTerminateCommand,
      },
    })));
    const pendingApprovalCommand = createMemo(() => pendingApprovalCommandForActivityItem(item(), selectedApprovalActions()));
    const displayTitle = createMemo<FlowerActivityTitle>(() => {
      const command = pendingApprovalCommand();
      return command && item().renderer !== 'terminal' && presentation().title.kind !== 'command'
        ? { kind: 'command', command }
        : presentation().title;
    });
    const revealTitle = useFlowerActivityTitleReveal(disclosureKey,
      () => !['pending', 'running', 'success'].includes(item().status) || Boolean(item().requires_approval || item().approval_state));
    const terminalDisclosure = createMemo(() => presentation().detailBlocks.some((block) => block.kind === 'terminal_output'));
    const detailKeys = createMemo(() => presentation().detailBlocks.map((block) => `${disclosureKey()}:${block.kind}:${block.kind === 'structured_rows' ? block.section ?? '' : ''}`));
    const detailsByKey = createMemo(() => {
      const blocks = presentation().detailBlocks;
      return new Map<string, FlowerActivityDetailBlock>(blocks.map((block) => [`${disclosureKey()}:${block.kind}:${block.kind === 'structured_rows' ? block.section ?? '' : ''}`, block]));
    });
    const disclosureControl = createFlowerActivityDisclosureController({
      manualOpen: () => openActivityRuns()[disclosureKey()],
      defaultOpen: () => isSavedComputerScreenshot(item()),
      onManualOpenChange: (open) => {
        const key = disclosureKey();
        setOpenActivityRuns((current) => ({ ...current, [key]: open }));
      },
    });
    const hasDetails = createMemo(() => presentation().detailBlocks.length > 0);
    const subagentOperation = () => item().renderer === 'subagent' || item().renderer === 'subagent_operation';
    const inlineSubagent = createMemo(() => presentation().detailBlocks.find((block) => (
      block.kind === 'subagents' && block.subagents.items.length === 1 && Boolean(block.subagents.items[0]?.open_messages)
    )));
    const compactReports = () => item().tool_name === 'subagent_events';
    const subagentReadHint = () => {
      const rawAction = item().payload?.action;
      const action = typeof rawAction === 'string' ? rawAction : '';
      return subagentOperation() && (action === 'status' || action === 'inspect') ? subagentsCopy().activity.hints[action] : undefined;
    };
    const expandable = createMemo(() => item().body_pending || !compactReports() && !subagentOperation() && ((presentation().suppressEmptyDisclosure
      || item().renderer === 'web_search' && !item().tool_name?.startsWith('okf.')) ? hasDetails() : item().kind === 'tool' || hasDetails()));
    const open = () => expandable() && disclosureControl.open();
    createEffect(() => {
      void liveSyncState().connectionEpoch;
      if (!open() || !item().body_pending) return;
      const tid = timeline().thread_id ?? '';
      const id = messageID();
      const controller = new AbortController();
      untrack(() => loadHistoryItem(tid, id, controller.signal, false, viewportScope));
      onCleanup(() => controller.abort());
    });
    const threadPreviewTool = () => item().status === 'success' && ['threads.query', 'threads.read', 'threads.aggregate'].includes(item().tool_name ?? '') && Boolean(props.adapter.loadToolPreview);
    const [previewRequest, setPreviewRequest] = createSignal<FlowerToolPreviewRequest>();
    const [toolPreview, { refetch: reloadToolPreview }] = createResource(previewRequest, (request) => props.adapter.loadToolPreview!(request));
    createEffect(on(disclosureKey, () => setPreviewRequest(undefined)));
    createEffect(() => {
      if (!open() || !threadPreviewTool()) return;
      const request = {
        thread_id: trimString(timeline().thread_id),
        turn_id: trimString(timeline().turn_id), run_id: trimString(timeline().run_id), tool_call_id: trimString(item().tool_id),
      };
      if (!Object.values(request).every(Boolean)) return;
      if (JSON.stringify(untrack(previewRequest)) !== JSON.stringify(request)) setPreviewRequest(request);
    });

    let toggleButtonRef: HTMLButtonElement | undefined;
    let detailPanelRef: HTMLDivElement | undefined;
    const staticActivityRef = (node: HTMLDivElement) => {
      const focused = document.activeElement;
      if (focused !== toggleButtonRef && !detailPanelRef?.contains(focused)) return;
      queueMicrotask(() => {
        if (node.isConnected && (document.activeElement === focused || document.activeElement === document.body)) node.focus({ preventScroll: true });
      });
    };
    onCleanup(() => { if (toggleButtonRef) viewportScope.releaseDisclosure(toggleButtonRef); });
    const toggleDisclosure = () => {
      if (toggleButtonRef) viewportScope.activateDisclosure(toggleButtonRef);
      disclosureControl.toggle();
    };
    const disclosure = createFlowerActivityDisclosureMotion(open, {
      reducedMotion: reducedMotionPreferred,
      onLayoutFrame: viewportScope.measureAfterLayout,
      onMotionEnd: () => { if (toggleButtonRef) viewportScope.finishDisclosure(toggleButtonRef); },
      onBeforeClose: () => {
        if (detailPanelRef?.contains(document.activeElement)) toggleButtonRef?.focus({ preventScroll: true });
      },
    });
    const rowFileAction = createMemo(() => presentation().primaryAction ?? null);
    const rowAttachmentPreviewTarget = createMemo(() => {
      const title = presentation().title;
      return title.kind === 'file' && title.verb === 'Read'
        ? attachmentPreviewTargetForActivity(item(), timeline(), title.display_name)
        : null;
    });
    const webOperation = createMemo(() => {
      const title = presentation().title;
      return title.kind === 'web_search' ? title.operation : undefined;
    });
    const displayStatus = createMemo(() => item().status);
    const progressShimmer = createMemo(() => {
      const value = item();
      const subagentWait = subagentOperation() && value.payload?.action === 'wait'
        && (value.status === 'running' || value.status === 'waiting');
      return livePresentationConfirmed() && (value.status === 'running' || subagentWait);
    });
    const controlError = createMemo(() => (
      item().kind === 'control'
      && trimString(item().metadata?.control_error_code) === 'control_error'
    ));
    const duration = createMemo(() => {
      const value = item();
      if (value.tool_name === 'goal') return '';
      const start = value.started_at_unix_ms;
      if (!start) return '';
      const end = value.ended_at_unix_ms;
      if (end) return formatActivityDuration(end - start);
      if (value.status !== 'running' && value.status !== 'waiting') return '';
      return formatActivityDuration(activityClockNow() - start);
    });
    // Keep the title and its arrival animation when results make the row expandable.
    const activityRowContent = (
      <>
        <span class="flower-activity-inline-icon">
          <FlowerToolIcon toolName={item().tool_name} source={item().metadata?.source} webOperation={webOperation()} running={livePresentationConfirmed() && displayStatus() === 'running'} />
        </span>
        <div class="flower-activity-inline-copy">
          <span ref={revealTitle.bind} class="flower-activity-inline-title" data-floe-progress-shimmer={progressShimmer() && !revealTitle.revealing() ? 'text' : undefined}>{activityTitle(displayTitle())}</span>
          <Show when={presentation().subagentThreadIDs?.length}>
            <span class="flower-activity-report-sources">
              <For each={presentation().subagentThreadIDs}>{threadID => {
                const name = () => selectedSubagentSummaries()?.find(child => child.thread_id === threadID)?.task_name || threadID;
                return <span class="flower-activity-report-source" data-flower-report-source={threadID} role="img" aria-label={name()} title={name()}>
                  <SubagentAvatar threadID={threadID} />
                </span>;
              }}</For>
            </span>
          </Show>
          <Show when={inlineSubagent()}>{(block) => (
            <ActivityDetailBlock media={media()} block={block() as FlowerNonTerminalDetailBlock} />
          )}</Show>
          <Show when={!subagentOperation() && presentation().meta}>
            {(meta) => <span class="flower-activity-inline-detail">{meta()}</span>}
          </Show>
          {changeStats(() => item().argument_preview ?? presentation().changeStats, () => item().argument_preview !== undefined)}
        </div>
        <Show when={duration()}>
          {(value) => <span class="flower-activity-inline-duration">{value()}</span>}
        </Show>
        <Show when={expandable()}>
          <ChevronDown class={cn('flower-activity-inline-chevron h-3.5 w-3.5', open() && 'flower-activity-inline-chevron-open')} />
        </Show>
      </>
    );
    return (
      <div
        class={cn('flower-activity-inline-row', item().tool_name === 'goal' && 'flower-activity-inline-row-goal', `flower-activity-inline-row-${displayStatus()}`, item().tool_name === 'subagent_events' && 'flower-activity-inline-row-reports', item().renderer === 'web_search' && 'flower-activity-inline-row-web-search', subagentOperation() && 'flower-activity-inline-row-subagents', inlineSubagent() && 'flower-activity-inline-row-single-subagent')}
        data-flower-activity-item-id={item().item_id}
        title={subagentReadHint()}
        aria-description={subagentReadHint()}
        data-flower-activity-status={displayStatus()}
        data-flower-activity-active={progressShimmer() ? 'true' : undefined}
        data-flower-activity-approval-state={item().approval_state}
        data-flower-control-error={controlError() ? 'true' : undefined}
        data-state={disclosure.state()}
        aria-label={subagentOperation() ? presentation().label : item().tool_name === 'goal' ? presentation().label + (presentation().meta ? ': ' + presentation().meta : '') : compactReports() ? presentation().label + ': ' + copy().chat.toolStatuses[displayStatus()] : activityItemAriaLabel(item())}
      >
        <div class="flower-activity-inline-line">
          <Show
            when={expandable()}
            fallback={<div ref={staticActivityRef} tabindex={-1} class="flower-activity-inline-button flower-activity-inline-button-static">{activityRowContent}</div>}
          >
            <button
              ref={toggleButtonRef}
              data-flower-disclosure-trigger
              type="button"
              class="flower-activity-inline-button"
              aria-expanded={open()}
              data-flower-manual-open={openActivityRuns()[disclosureKey()] === true ? 'true' : undefined}
              aria-controls={`flower-activity-detail-${disclosureKey()}`}
              onClick={toggleDisclosure}
            >
              {activityRowContent}
            </button>
          </Show>
          {fileActionButtons(rowFileAction, rowAttachmentPreviewTarget)}
        </div>
        <Show when={subagentOperation() || compactReports()}>
          <For each={detailKeys().filter((key) => detailsByKey().get(key) !== inlineSubagent())}>{(key) => {
            const block = createMemo(() => detailsByKey().get(key)!);
            return <ActivityDetailBlock media={media()} block={block() as FlowerNonTerminalDetailBlock} />;
          }}</For>
        </Show>
        <Show when={disclosure.mounted()}>
          <div
            ref={(node) => {
              detailPanelRef = node;
              disclosure.bindViewport(node);
            }}
            id={`flower-activity-detail-${disclosureKey()}`}
            class="flower-activity-inline-details"
            data-state={disclosure.state()}
            style={{ height: disclosure.height() }}
          >
            <div class="flower-activity-inline-details-clip">
              <div
                ref={disclosure.bindContent}
                class={cn(
                  'flower-activity-inline-details-content',
                  terminalDisclosure() && 'flower-activity-inline-details-content-terminal',
                )}
              >
                <Show when={item().body_pending}>{historyBodyControl(() => timeline().thread_id ?? '', messageID, viewportScope)}</Show>
                <Show when={item().approval_state === 'rejected' && !terminalDisclosure()}>
                  <div class="flower-activity-approval-rejected-detail">
                    {copy().chat.toolApprovalRejectedDetail}
                  </div>
                </Show>
                <Show when={threadPreviewTool() && previewRequest()} fallback={null}>
                  <FlowerThreadToolPreview preview={toolPreview.loading || toolPreview.error ? undefined : toolPreview()} loading={toolPreview.loading}
                    failed={Boolean(toolPreview.error)} retry={() => { void reloadToolPreview(); }} copy={copy().chat} />
                </Show>
                <Show when={!threadPreviewTool() || !previewRequest()}>
                  <Show when={!hasDetails() && !item().body_pending}>
                    <div class="flower-activity-empty-detail">
                      <p>{trimString(item().description) || presentation().label}</p>
                      <p>{copy().chat.toolStatuses[item().status]}</p>
                      <p class="flower-activity-empty-detail-hint">
                        {item().status === 'pending' || item().status === 'running' || item().status === 'waiting'
                          ? copy().chat.toolActivityDetailsPending
                          : copy().chat.toolActivityNoAdditionalDetails}
                      </p>
                    </div>
                  </Show>
                  {/* Keep the script input in a stable section when new results arrive. */}
                  <For each={['results', 'inputs', 'error'] as const}>{section => <div class="flower-activity-detail-section"><For each={detailKeys().filter(key => {
                    const block = detailsByKey().get(key);
                    return (block?.kind === 'error' ? 'error' : block?.kind === 'structured_rows' && block.section === 'inputs' ? 'inputs' : 'results') === section;
                  })}>
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
                                  renderThreadID: trimString(timeline().thread_id) || trimString(selectedThreadID()),
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
                                failureDetailPresent={() => presentation().detailBlocks.some(block => block.kind === 'error')}
                              />
                            )}
                          </Show>
                          <Show when={!terminalBlock()}>
                            <ActivityDetailBlock media={media()} block={block() as FlowerNonTerminalDetailBlock} />
                          </Show>
                        </>
                      );
                    }}
                  </For></div>}</For>
                </Show>
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
    block: Accessor<FlowerActivityTimelineBlock | null>,
    preview: Accessor<FlowerToolCallPreviewBlock | null>,
    viewportScope: FlowerScrollTailController,
    media: ReturnType<typeof createThreadMedia>,
  ) => {
    const visibleItems = createMemo(() => block()?.items.filter(activityItemVisible) ?? []);
    const visibleItemsByKey = createMemo(() => new Map(visibleItems().map(item => [activityItemKey(messageID(), block()!, item), item])));
    const visibleItemKeys = createMemo(() => preview()
      ? [flowerToolCallPreviewIdentity(preview()!.call)] : [...visibleItemsByKey().keys()]);
    return (
      <Show when={visibleItemKeys().length > 0}>
        <div class={cn("flower-activity-inline", visibleItems().length > 0 && visibleItems().every(item => item.tool_name === "goal") && "flower-activity-inline-goal")} data-flower-activity-run-id={block()?.run_id ?? preview()?.call.run_id}>
          <For each={visibleItemKeys()}>
            {(itemKey) => {
              const visibleItem = createMemo(() => visibleItemsByKey().get(itemKey) ?? null);
              return <FlowerToolSequenceNode nodeKey={itemKey}>
                <Show when={visibleItem()} fallback={<Show when={preview()}>{argumentPreviewRow}</Show>}>
                  {(item) => activityRow(messageID, blockIndex, () => block()!, item, viewportScope, media)}
                </Show>
              </FlowerToolSequenceNode>;
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
    showCopyAction: Accessor<boolean>,
    copyText: Accessor<string>,
    thread: Accessor<FlowerThreadSnapshot | null | undefined>,
    media: ReturnType<typeof createThreadMedia>,
  ) => {
    const markdown = createMemo(() => block().block_type === 'markdown');
    const thinking = createMemo(() => block().block_type === 'thinking');
    const thinkingLive = createMemo(() => thinking() && message().live === true);
    const thinkingEndsAbnormally = createMemo(() => {
      const currentThread = thread();
      const currentMessage = message();
      if (!currentThread || currentMessage.thread_id !== currentThread.thread_id) return false;
      const turn = currentThread.turns?.find(candidate => candidate.turn_id === currentMessage.turn_id);
      if (turn && turn.run_id === currentMessage.run_id && turn.outcome && turn.outcome !== 'completed') return true;
      const cancellation = currentThread.cancellation;
      return cancellation != null && cancellation.turn_id === currentMessage.turn_id && cancellation.run_id === currentMessage.run_id;
    });
    const answerTime = () => {
      const turn = thread()?.turns?.find(value => value.turn_id === message().turn_id);
      const ended = turn?.ended_at ? Date.parse(turn.ended_at) : NaN;
      return Number.isFinite(ended) ? ended : message().created_at_ms;
    };
    const AnswerFooter: Component = () => <Show when={showCopyAction()}>
      <FlowerAnswerActions
        copyButton={<MessageCopyButton message={message()} text={copyText()} placement="assistant" />}
        timestamp={answerTime()}
        exportLabel={copy().chat.exportAnswerHTML} exportedLabel={copy().chat.answerExported}
        forkLabel={copy().chat.forkFromAnswer} forkBusyLabel={copy().threadList.forkCreating}
        settled={message().status === 'complete' && message().live !== true}
        forkBusy={threadActionBusy() !== null}
        onExport={() => {
          try {
            downloadFlowerAnswer(flowerAnswerHTML({ content: message().content, blocks: message().blocks, sources: message().sources ?? block().sources ?? [], title: thread()?.title || 'Flower', timestamp: answerTime(), sourcesLabel: copy().chat.citationSources, unavailableLabel: copy().chat.citationUnavailable }), answerTime());
            return true;
          } catch (error) { notifyThreadActionError(getErrorMessage(error)); return false; }
        }}
        onFork={props.adapter.forkThread && thread() && thread()?.status !== 'read_only' ? () => {
          const current = thread();
          const item = current ? projectFlowerThreadListItem(current, copy().threadList.untitled) : undefined;
          if (item) void handleThreadMenuAction('fork', item, undefined, message().id);
        } : undefined}
      />
    </Show>;
    const assistantCopyLayout = createMemo(() => message().role === 'assistant' && block().block_type !== 'thinking');
    const ContentBody: Component = () => (
      <Show
        when={markdown()}
        fallback={<><span class="flower-message-plain-text">{block().content}</span><AnswerFooter /></>}
      >
        <FlowerMarkdownBlock
          content={block().content}
          textSource={message().text_source}
          footer={assistantCopyLayout() ? <AnswerFooter /> : undefined}
          sources={message().role === 'assistant' ? block().sources : undefined}
          citationLabels={message().role === 'assistant' ? { sources: copy().chat.citationSources, unavailable: copy().chat.citationUnavailable } : undefined}
          streaming={streaming()}
          mediaLabels={message().role === 'assistant' ? copy().chat.media : undefined}
          mediaEnabled={message().role === 'assistant'}
          resolveSourceIcon={props.adapter.resolveSourceIcon}
          resolveMedia={media().resolve}
          onOpenMediaLink={media().openLink}
          onOpenMediaLinkError={error => notifyThreadActionError(getErrorMessage(error))}
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
        </div>
      </Show>
    );

    return (
      <Show
        when={thinking()}
        fallback={(
          <div class={cn(
            'flower-message-bubble',
            message().role === 'user'
              ? 'flower-message-bubble-framed'
              : 'flower-message-bubble-plain',
            message().role === 'user'
              ? 'flower-message-bubble-user'
              : 'flower-message-bubble-assistant',
            streaming() && 'flower-message-bubble-streaming',
          )}>
            <StableContentBody />
          </div>
        )}
      >
        <FlowerToolSequenceNode nodeKey={block().key}>
          <FlowerThinkingDisclosure
            contentID={block().key}
            manualExpanded={() => expandedDetails[detailDisclosureKey(message().thread_id ?? '', 'thinking', block().key)]}
            onManualExpanded={expanded => setExpandedDetails(detailDisclosureKey(message().thread_id ?? '', 'thinking', block().key), expanded)}
            content={() => block().content}
            live={thinkingLive}
            liveConfirmed={livePresentationConfirmed}
            preserveOnEnd={thinkingEndsAbnormally}
            elapsed={() => formatActivityDuration(activityClockNow() - (message().created_at_ms ?? activityClockNow()))}
            label={() => thinkingLive() && livePresentationConfirmed() ? copy().chat.thinkingActiveLabel : copy().chat.thinkingLabel}
            expandLabel={() => copy().chat.expandThinking}
            collapseLabel={() => copy().chat.collapseThinking}
            contentBody={ContentBody}
          />
        </FlowerToolSequenceNode>
      </Show>
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

  const loadMessageAttachmentBlob = async (url: string, signal: AbortSignal): Promise<Blob> => {
    try {
      if (!props.adapter.loadMessageAttachment) throw new Error('Attachment loader is unavailable.');
      return await props.adapter.loadMessageAttachment({ url, signal });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error(copy().chat.media.unavailable);
    }
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
      load: (signal) => loadMessageAttachmentBlob(url, signal),
    });
  };

  const messageAttachmentBlock = (block: Accessor<Extract<FlowerRenderableMessageBlock, { type: 'image' | 'file' }>>) => (
    <Show
      when={block().type === 'image' ? block() as Extract<FlowerRenderableMessageBlock, { type: 'image' }> : null}
      fallback={(
        <a
          class="flower-message-file flower-message-resource"
          title={(block() as Extract<FlowerRenderableMessageBlock, { type: 'file' }>).name}
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
          <FileItemIcon size={24} item={{ name: (block() as Extract<FlowerRenderableMessageBlock, { type: 'file' }>).name, type: 'file' }} class="size-6 shrink-0" />
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
        <FlowerMessageImage
          src={imageBlock().src}
          alt={imageBlock().alt ?? ''}
          name={imageBlock().alt || attachmentCopy().preview}
          unavailableLabel={copy().chat.media.unavailable}
          load={loadMessageAttachmentBlob}
          onOpen={() => openMessageAttachmentPreview({
            id: imageBlock().key,
            name: trimString(imageBlock().alt) || attachmentCopy().preview,
            mimeType: 'image/*',
            url: imageBlock().src,
          })}
        />
      )}
    </Show>
  );

  const messageInputResponseBlock = (
    block: Accessor<Extract<FlowerRenderableMessageBlock, { type: 'input_response' }>>,
  ) => (
    <section
      class="flower-message-bubble flower-message-bubble-framed flower-message-bubble-user flower-input-response-receipt"
      data-flower-input-response
      aria-label={chatCopyValue('inputRequestAnswered', 'Answered')}
    >
      <div class="flower-input-response-status">
        {chatCopyValue('inputRequestAnswered', 'Answered')}
      </div>
      <dl class="flower-input-response-list">
        <For each={block().block.questions}>
          {(question) => (
            <div class="flower-input-response-row" data-flower-input-response-question={question.question_id}>
              <dt class="flower-input-response-question">{question.question}</dt>
              <dd class={cn('flower-input-response-answer', question.redacted && 'flower-input-response-answer-redacted')}>
                {question.redacted
                  ? chatCopyValue('inputRequestAnswerHidden', 'Answer hidden')
                  : question.answer}
              </dd>
            </div>
          )}
        </For>
      </dl>
    </section>
  );

  const messageBlockView = (
    message: Accessor<FlowerChatMessage>,
    block: Accessor<FlowerRenderableMessageBlock>,
    streamingBlockKey: Accessor<string>,
    copyText: Accessor<string>,
    assistantCopyBlockKey: Accessor<string>,
    viewportScope: FlowerScrollTailController,
    thread: Accessor<FlowerThreadSnapshot | null | undefined>,
    media: ReturnType<typeof createThreadMedia>,
  ) => {
    const activity = createMemo(() => block().type === 'activity' || block().type === 'tool_preview' ? block() as Extract<FlowerRenderableMessageBlock, { type: 'activity' | 'tool_preview' }> : null);
    const content = createMemo(() => block().type === 'content' ? block() as Extract<FlowerRenderableMessageBlock, { type: 'content' }> : null);
    const inputResponse = createMemo(() => block().type === 'input_response' ? block() as Extract<FlowerRenderableMessageBlock, { type: 'input_response' }> : null);
    const attachment = createMemo(() => (
      block().type === 'image' || block().type === 'file'
        ? block() as Extract<FlowerRenderableMessageBlock, { type: 'image' | 'file' }>
        : null
    ));
    return (
      <Show
        when={activity()}
        fallback={(
          <Show
            when={content()}
            fallback={(
              <Show when={inputResponse()} fallback={<Show when={attachment()}>{messageAttachmentBlock}</Show>}>
                {messageInputResponseBlock}
              </Show>
            )}
          >
            {(contentBlock) => {
                const showCopyAction = () => !message().body_pending && message().role === 'assistant'
                  && contentBlock().key === assistantCopyBlockKey();
                const streaming = () => streamingBlockKey() === contentBlock().key;
                let shell!: HTMLDivElement;
                const [visible, setVisible] = createSignal(false);
                onMount(() => createEffect(() => {
                  if (message().body_pending?.kind !== 'text') return;
                  const viewport = viewportScope.viewport();
                  if (viewport) onCleanup(historyBodyVisibility.observe(shell, viewport, setVisible));
                }));
                createEffect(() => {
                  const pending = message().body_pending;
                  const tid = thread()?.thread_id ?? '';
                  const itemID = message().id;
                  // Reconnection establishes new read authority even when the same
                  // retained message stays mounted. Failed reads wait for Retry.
                  void liveSyncState().connectionEpoch;
                  if (!visible() || pending?.kind !== 'text'
                    || viewportScope === transcriptScroll && selectedThreadTailPreparing()) return;
                  // Hydration can move a previously intersecting placeholder
                  // offscreen before the observer delivers its next notification.
                  const viewport = viewportScope.viewport();
                  if (!viewport) return;
                  const bounds = viewport.getBoundingClientRect();
                  const rect = shell.getBoundingClientRect();
                  if (rect.height <= 0 || rect.bottom <= bounds.top - HISTORY_BODY_VIEWPORT_MARGIN_PX || rect.top >= bounds.bottom + HISTORY_BODY_VIEWPORT_MARGIN_PX) return;
                  const controller = new AbortController();
                  untrack(() => loadHistoryItem(tid, itemID, controller.signal, false, viewportScope));
                  onCleanup(() => controller.abort());
                });
                return <div ref={shell} class="flower-history-message">
                  <Show when={message().body_pending?.kind === 'text'} fallback={messageContentBubble(message, contentBlock, streaming, showCopyAction, copyText, thread, media)}>
                    <div class={cn('flower-history-text-loading', 'flower-message-bubble', message().role === 'user' && 'flower-message-bubble-user')}>
                      <div class="flower-history-text-skeleton" aria-hidden="true"><span /><span /><span /></div>
                      {historyBodyControl(() => thread()?.thread_id ?? '', () => message().id, viewportScope)}
                    </div>
                  </Show>
                </div>;
              }}
          </Show>
        )}
      >
        {(activityBlockValue) => activityBlock(
          () => message().id,
          () => activityBlockValue().block_index,
          () => { const value = activityBlockValue(); return value.type === 'activity' ? value.block : null; },
          () => { const value = activityBlockValue(); return value.type === 'tool_preview' ? value.block : null; },
          viewportScope,
          media,
        )}
      </Show>
    );
  };

  const messageEntry = (
    entry: Accessor<Extract<FlowerTimelineEntry, { type: 'message' }>>,
    viewportScope: FlowerScrollTailController,
    thread: Accessor<FlowerThreadSnapshot | null | undefined>,
    media: ReturnType<typeof createThreadMedia>,
  ) => {
    const message = createMemo(() => entry().message);
    const activeCursor = createMemo(() => (
      livePresentationConfirmed() && selectedThreadLiveStatus() === 'running'
      && message().role === 'assistant'
      && message().active_cursor === true
    ));
    const hasRenderableBlock = createMemo(() => entry().blocks.length > 0);
    const contextDisplay = createMemo(() => {
      const msg = message();
      if (msg.role !== 'user') return null;
      return parseChatMessageReferences(msg.references);
    });
    const visible = createMemo(() => Boolean(message().goal) || hasRenderableBlock() || Boolean(contextDisplay()) || activeCursor());
    const blocks = createMemo(() => entry().blocks);
    const blockKeys = createMemo(() => blocks().map((block) => block.key));
    const blocksByKey = createMemo(() => new Map(blocks().map((block) => [block.key, block] as const)));
    const streamingBlockKey = createMemo(() => activeCursor() ? lastContentBlockKey(blocks()) : '');
    // Copy normalization belongs to the visible action boundary, not each delta.
    const copyText = () => messageCopyText(message(), blocks());
    const messageTime = createMemo(() => formatMessageTime(message().created_at_ms));
    const assistantCopyBlockKey = createMemo(() => {
      const currentMessage = message();
      const turn = thread()?.turns?.find(value => value.turn_id === currentMessage.turn_id && value.run_id === currentMessage.run_id);
      return currentMessage.role === 'assistant' && turn?.final_boundary_complete && turn.final_item_ids.includes(currentMessage.id)
        ? lastCopyableContentBlockKey(blocks()) : '';
    });
    const canActivateContextChip = (chip: FlowerChatContextChip): boolean => {
      const action = chip.action;
      if (!action) return false;
      if (action.type === 'open_canonical_reference') {
        return contextDisplay()?.authority === 'canonical_references'
          && canonicalReferencePreviewAvailable()
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
      if (action.type === 'open_text_preview' || action.type === 'open_process_preview' || action.type === 'open_thread_preview') {
        captureSnapshotPreviewFocus();
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
          await openCanonicalReferencePreview({
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
    return (
      <Show when={visible()}>
        <Show when={!message().goal} fallback={<details class="flower-goal-history" data-flower-goal-change={message().goal?.operation} onToggle={() => viewportScope.measureAfterLayout()}>
          <summary>
            <FlowerGoalIcon class="flower-goal-history-icon" size={16} strokeWidth={1.65} aria-hidden="true" />
            <span class="flower-goal-history-label">{message().goal?.operation === 'completed' ? copy().chat.goalCompleted : message().goal?.operation === 'delete' ? copy().chat.goalDeleted : copy().chat.goalSet}</span>
            <span class="flower-goal-history-preview">{message().goal?.goal.text || message().goal?.reason}</span>
            <ChevronRight class="flower-goal-history-chevron" aria-hidden="true" />
          </summary>
          <div class="flower-goal-history-body">
            <p class="flower-goal-history-text">{message().goal?.goal.text || message().goal?.reason}</p>
          </div>
        </details>}>
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
            when={message().role === 'user'}
            fallback={
              <div class="flower-message-block-stack flower-message-block-stack-assistant">
                <For each={blockKeys()}>
                  {(blockKey) => {
                    const block = createMemo(() => blocksByKey().get(blockKey) ?? null);
                    return (
                      <Show when={block()}>
                        {(value) => messageBlockView(
                          message,
                          value,
                          streamingBlockKey,
                          copyText,
                          assistantCopyBlockKey,
                          viewportScope,
                          thread,
                          media,
                        )}
                      </Show>
                    );
                  }}
                </For>
              </div>
            }
          >
            <div class="flower-message-block-stack flower-message-block-stack-user">
              <FlowerUserMessageBody
                blocks={blocks()}
                renderBlock={(block) => messageBlockView(message, block, streamingBlockKey, copyText, assistantCopyBlockKey, viewportScope, thread, media)}
                references={(
                  <Show when={contextDisplay()}>
                    {(display) => <FlowerChatContextChips
                      contextDisplay={display()}
                      truncatedLabel={copy().chat.truncatedLabel}
                      canActivateChip={canActivateContextChip}
                      onChipClick={activateContextChip}
                    />}
                  </Show>
                )}
                hasReferences={Boolean(contextDisplay())}
              />
              <Show when={copyText() || messageTime()}>
                <div class="flower-message-action-row flower-message-action-row-user">
                  <Show when={messageTime()}>
                    {(value) => <time class="flower-message-time" datetime={new Date(message().created_at_ms).toISOString()}>{value()}</time>}
                  </Show>
                  <MessageCopyButton message={message()} text={copyText()} placement="user" />
                </div>
              </Show>
            </div>
          </Show>
        </div>
        </Show>
      </Show>
    );
  };

  function queuedTurnEntry(entry: Accessor<Extract<FlowerTimelineEntry, { type: 'queued_turn' }>>) {
    const turn = createMemo<FlowerQueuedTurn>(() => entry().turn);
    const blocks = createMemo(() => entry().blocks);
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
      if (action.type === 'open_text_preview' || action.type === 'open_process_preview' || action.type === 'open_thread_preview') {
        captureSnapshotPreviewFocus();
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
          <FlowerUserMessageBody
            blocks={blocks()}
            renderBlock={queuedBlock}
            references={(
              <Show when={contextDisplay()}>
                {(display) => <FlowerChatContextChips
                  contextDisplay={display()}
                  truncatedLabel={copy().chat.truncatedLabel}
                  canActivateChip={canActivateContextChip}
                  onChipClick={activateContextChip}
                />}
              </Show>
            )}
            hasReferences={Boolean(contextDisplay())}
          />
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


  const compactionDividerEntry = (entry: Accessor<Extract<FlowerTimelineEntry, { type: 'context_compaction' }>>, target: Accessor<FlowerThreadSnapshot | null | undefined>, visible: Accessor<boolean>) => {
    const decoration = createMemo(() => entry().decoration);
    const retryable = () => latestCompactionRecovery(target())?.operation_id === decoration().compaction.operation_id
      && props.adapter.canMutate !== false && Boolean(props.adapter.compactThreadContext)
      && (Boolean(target()?.parent_thread_id) || !trimString(target()?.read_only_reason));
    return <FlowerContextCompactionDivider decoration={decoration()} copy={copy()} visible={visible()}
      retrying={compactionRecoveryPending(target())} retryDisabled={threadRecoveryBlocked(target())}
      onRetry={retryable() ? () => void retryThreadContinuation(target, decoration().compaction.run_id) : undefined} />;
  };

  const inputRequestEntry = (entry: Accessor<FlowerTimelineEntry>, thread: Accessor<FlowerThreadSnapshot | null | undefined>) => {
    const request = createMemo(() => {
      const value = entry();
      if (value.type !== 'input_request') return null;
      return trimString(visibleInputRequest(thread())?.prompt_id) === trimString(value.request.prompt_id)
        ? null
        : value.request;
    });
    return (
      <Show when={request()}>
        {(value) => <Show when={thread()?.thread_id === selectedThreadID()} fallback={
          <section class="flower-input-request-panel" aria-label={copy().chat.inputRequestTitle}>
            <For each={value().questions}>{question => <div class="flower-input-request-question-copy">
              <div class="flower-input-request-question-text">{isSubagentAttention(value()) ? copy().chat.subagentWaitQuestion : question.question}</div>
              <For each={question.choices}>{choice => <p>{isSubagentAttention(value()) ? subagentAttentionChoice(choice.label) : choice.label}</p>}</For>
            </div>}</For>
          </section>
        }>{inputRequestPrompt(value)}</Show>}
      </Show>
    );
  };

  const errorEntry = (entry: Accessor<FlowerTimelineEntry>, thread: Accessor<FlowerThreadSnapshot | null | undefined>) => {
    const error = createMemo(() => {
      const value = entry();
      return value.type === 'error' ? value.error : null;
    });
    return (
      <Show when={error()}>
        {(value) => {
          const code = trimString(value().code);
          if (code === 'runtime_restarted') return runtimeRestartedDivider();
          if (!runErrorNoticeVisible(thread(), value())) return null;
          return runErrorNotice(value(), thread);
        }}
      </Show>
    );
  };

  const timelineEntry = (
    entry: Accessor<FlowerTimelineEntry>,
    viewportScope: FlowerScrollTailController,
    thread: Accessor<FlowerThreadSnapshot | null | undefined>,
    media: ReturnType<typeof createThreadMedia>,
    visible: Accessor<boolean> = () => true,
  ) => {
    switch (entry().type) {
      case 'message': {
        const message = () => (entry() as Extract<FlowerTimelineEntry, { type: 'message' }>).message;
        return <>
          {messageEntry(() => entry() as Extract<FlowerTimelineEntry, { type: 'message' }>, viewportScope, thread, media)}
          <Show when={message().steering?.status !== 'applied' && message().steering}>{(steering) => <div class="flower-steering-status" data-flower-steering-status={steering().status}>
            <span role="status">{subagentsCopy().input[steering().status]}</span>
            <Show when={steering().status === 'cancelled'}>
              <span>{steering().reason === 'effect_outcome_unknown' ? subagentsCopy().input.unknown
                : steering().reason === 'stopped' ? subagentsCopy().input.stopped : subagentsCopy().input.ended}</span>
              <Show when={steering().reason === 'stopped' && activeSubagentID() === thread()?.thread_id && props.adapter.canMutate !== false && props.adapter.operateSubagentInput}>
                <Button size="sm" variant="outline" disabled={subagentInputCommand(message().id)?.busy}
                  aria-busy={subagentInputCommand(message().id)?.busy}
                  onClick={() => void operateSubagentInput('resend_steering', message().id)}>{subagentsCopy().input.resend}</Button>
              </Show>
            </Show>
            <Show when={activeSubagentID() === thread()?.thread_id && subagentInputCommand(message().id)?.error}>
              <span role="alert">{subagentInputCommand(message().id)?.error}</span>
            </Show>
          </div>}</Show>
        </>;
      }
      case 'queued_turn':
        return queuedTurnEntry(() => entry() as Extract<FlowerTimelineEntry, { type: 'queued_turn' }>);
      case 'context_compaction':
        return compactionDividerEntry(() => entry() as Extract<FlowerTimelineEntry, { type: 'context_compaction' }>, thread, visible);
      case 'input_request':
        return inputRequestEntry(entry, thread);
      case 'error':
        return errorEntry(entry, thread);
      case 'parent_event': {
        const event = () => (entry() as Extract<FlowerTimelineEntry, { type: 'parent_event' }>).event;
        const source = () => event().parent_thread_id === selectedThreadID()
          ? selectedSubagentItems().find(item => item.threadID === event().source_thread_id) : undefined;
        return <ParentEventRow event={event()} copy={subagentsCopy()} sourceName={source() ? subagentRowTitle(source()!) : event().source_thread_id}
          expanded={expandedDetails[detailDisclosureKey(event().parent_thread_id, 'report', event().id)] === true}
          onExpandedChange={expanded => setExpandedDetails(detailDisclosureKey(event().parent_thread_id, 'report', event().id), expanded)}
          canOpenSource={Boolean(source())} onOpenSource={() => { const item = source(); if (item) openSubagentDetail(item); }}
          onDisclosureClick={title => {
            viewportScope.activateDisclosure(title);
            requestTranscriptAnimationFrame(() => viewportScope.finishDisclosure(title));
          }} />;
      }
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
        return <span class="flower-subagent-status-indicator flower-subagent-status-indicator-running" aria-hidden="true" />;
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
  const subagentRowTitle = (item: FlowerSubagentPanelItem): string => (
    trimString(item.displayName) || trimString(item.title) || trimString(item.taskName) || subagentsCopy().activity.labels.subagent
  );
  const activeSubagentTitle = createMemo(() => {
    const item = activeSubagentItem();
    if (item) return subagentRowTitle(item);
    const summary = subagentDetailSummary();
    const taskName = trimString(summary?.task_name);
    return taskName ? presentSubagentTaskName(taskName) : subagentsCopy().activity.labels.subagent;
  });
  const subagentSummaryStatus = createMemo(() => {
    return subagentStatusLabel(subagentDetailActiveStatus());
  });
  const subagentDetailMeta = createMemo(() => {
    const summary = subagentDetailSummary();
    const item = activeSubagentItem();
    return trimString(summary?.task_description || item?.taskDescription || summary?.task_name || item?.taskName || '');
  });
  const subagentDetailElapsedLabel = createMemo(() => {
    const summary = subagentDetailSummary();
    const item = activeSubagentItem();
    const startedAtMs = Math.max(0, Number(summary?.created_at_ms || item?.startedAtMs || item?.createdAtMs || 0));
    if (!startedAtMs) return '';
    const status = subagentDetailActiveStatus();
    const terminal = status === 'completed' || status === 'failed' || status === 'canceled' || status === 'timed_out';
    const endedAtMs = terminal
      ? Math.max(startedAtMs, Number(summary?.updated_at_ms || item?.updatedAtMs || startedAtMs))
      : activityClockNow();
    return formatActivityDuration(Math.max(0, endedAtMs - startedAtMs));
  });
  const subagentDropdownList = (
    kind: 'active' | 'completed',
    label: Accessor<string>,
    items: Accessor<readonly FlowerSubagentPanelItem[]>,
  ) => (
    <ul
      class="flower-subagents-dropdown-group-list"
      data-flower-subagent-group={kind}
      aria-label={label()}
    >
      <FlowerKeyedList scope={selectedThreadID()} focusFallback={() => (subagentDropdownRows()[0] ?? subagentDropdownRef)?.focus()} each={items()} identity={(value) => JSON.stringify([selectedThreadID(), value.threadID])}>
        {(item) => {
          const title = () => subagentRowTitle(item());
          const description = () => trimString(item().taskDescription);
          const elapsed = () => subagentElapsedDuration(item());
          return (
            <li class="flower-subagents-dropdown-list-item">
              <button
                type="button"
                class={cn(
                  'flower-subagent-dropdown-row',
                  `flower-subagent-dropdown-row-${item().status}`,
                  activeSubagentID() === trimString(item().threadID) && 'flower-subagent-dropdown-row-active',
                )}
                data-flower-subagent-row={selectedSubagentItems().findIndex((candidate) => candidate.key === item().key)}
                data-flower-subagent-status={item().status}
                aria-label={`${title()}. ${subagentStatusLabel(item().status)}. ${subagentsCopy().openThread}`}
                title={[title(), description(), subagentsCopy().openThread].filter(Boolean).join('\n')}
                onClick={() => void openSubagentDetail(item())}
              >
                <SubagentAvatar threadID={item().threadID} />
                <span class="flower-subagent-dropdown-copy">
                  <span class="flower-subagent-dropdown-name">{title()}</span>
                  <Show when={description()}>
                    {(value) => <span class="flower-subagent-dropdown-description">{value()}</span>}
                  </Show>
                </span>
                <span class="flower-subagent-dropdown-meta">
                  <span class="flower-subagent-dropdown-status-label">
                    {subagentStatusIndicator(item().status)}
                    <Show when={item().status !== 'running' && item().status !== 'completed'}>
                      <span>{subagentStatusLabel(item().status)}</span>
                    </Show>
                  </span>
                  <Show when={elapsed()}>
                    {(value) => <span class="flower-subagent-dropdown-duration">{value()}</span>}
                  </Show>
                </span>
              </button>
            </li>
          );
        }}
      </FlowerKeyedList>
    </ul>
  );
  const subagentDropdown = () => (
    <Show when={subagentDropdownOpen()}>
      <SurfaceFloatingLayer
        position={subagentDropdownPosition()}
        owner={subagentTriggerRef}
        estimatedSize={SUBAGENT_DROPDOWN_ESTIMATED_SIZE}
        class="flower-subagents-dropdown-layer"
        data-flower-floating-layer="true"
      >
        <div
          ref={subagentDropdownRef}
          id="flower-subagents-dropdown"
          data-floe-surface="floating"
          class="flower-subagents-dropdown"
          role="dialog"
          aria-label={subagentsCopy().title}
          aria-modal="false"
          tabIndex={-1}
          onKeyDown={handleSubagentDropdownKeyDown}
        >
          <div class="flower-subagents-dropdown-header">
            <div class="flower-subagents-dropdown-title">
              <span>{subagentsCopy().title}</span>
              <span class="flower-subagents-dropdown-count">{selectedSubagentItems().length}</span>
            </div>
            <Show when={selectedActiveSubagentCount() > 0}>
              <span class="flower-subagents-dropdown-active-count">
                <span class="flower-subagent-status-indicator flower-subagent-status-indicator-running" aria-hidden="true" />
                {selectedActiveSubagentCount()} {subagentsCopy().activeLabel}
              </span>
            </Show>
          </div>
          <div class="flower-subagents-dropdown-content" {...props.approvalScrollViewportProps}>
            <Show
              when={selectedSubagentItems().length > 0}
              fallback={(
                <div class="flower-subagents-dropdown-empty">
                  <Bot class="h-4 w-4" />
                  <span>{subagentsCopy().emptyTitle}</span>
                </div>
              )}
            >
              <div class="flower-subagents-dropdown-list">
                <Show when={selectedActiveSubagentCount() > 0}>
                  {subagentDropdownList('active', () => subagentsCopy().activeLabel, selectedActiveSubagentItems)}
                </Show>
                <Show when={selectedSettledSubagentCount() > 0}>
                  <section class="flower-subagents-dropdown-ended">
                    <button
                      type="button"
                      class="flower-subagents-dropdown-disclosure"
                      data-flower-subagent-disclosure="true"
                      aria-expanded={settledSubagentsExpanded()}
                      aria-controls="flower-subagents-ended-list"
                      onClick={() => setSettledSubagentsExpanded((expanded) => !expanded)}
                    >
                      <ChevronRight class="flower-subagents-dropdown-disclosure-chevron h-3 w-3" aria-hidden="true" />
                      <span>{subagentsCopy().completedLabel}</span>
                      <span class="flower-subagents-dropdown-count">{selectedSettledSubagentCount()}</span>
                      <Show when={selectedFailedSubagentCount() > 0}>
                        <span class="flower-subagents-dropdown-failed-count">
                          {subagentStatusIndicator('failed')}
                          {selectedFailedSubagentCount()} {subagentStatusLabel('failed')}
                        </span>
                      </Show>
                      <Show when={!settledSubagentsExpanded()}>
                        <span class="flower-subagents-dropdown-avatar-summary" aria-hidden="true">
                          <For each={selectedSettledSubagentItems().slice(0, 2)}>{(item) => (
                            <SubagentAvatar threadID={item.threadID} class="flower-subagent-summary-avatar" />
                          )}</For>
                          <Show when={selectedSettledSubagentCount() > 2}>
                            <span class="flower-subagents-dropdown-overflow">+{selectedSettledSubagentCount() - 2}</span>
                          </Show>
                        </span>
                      </Show>
                    </button>
                    <div id="flower-subagents-ended-list" hidden={!settledSubagentsExpanded()}>
                      <Show when={settledSubagentsExpanded()}>
                        {subagentDropdownList('completed', () => subagentsCopy().completedLabel, selectedSettledSubagentItems)}
                      </Show>
                    </div>
                  </section>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </SurfaceFloatingLayer>
    </Show>
  );

  const projectSubagentTimeline = createFlowerTimelineProjection();
  const subagentDetailTimelineEntries = createMemo(() => projectSubagentTimeline(subagentDetailThread(), []).filter(entry => entry.type !== 'queued_turn'));
  const subagentDetailWindowTitle = createMemo(() => activeSubagentTitle());
  const showSubagentDetailScrollToLatestButton = createMemo(() => (
    Boolean(subagentDetailThread())
    && subagentDetailScroll.showLatest()
  ));
  const retrySubagentDetailLoad = () => {
    void refreshActiveSubagentDetail(true);
  };
  const bindSubagentDetailViewport = (node: HTMLDivElement) => {
    subagentDetailScroll.bind(node);
  };
  // Keep the detail panel mounted after first use so closing preserves its
  // animation and scroll state without loading it during ordinary chat startup.
  const subagentDetailMounted = createMemo<boolean>((mounted) => mounted || subagentDetailOpen(), false);
  const subagentDetailDialog = () => (
    <SubagentDetailWindow
      agentSwitcher={<Show when={selectedSubagentItems().length > 1}>
        <nav class="flower-subagent-switcher" data-flower-subagent-switcher aria-label={subagentsCopy().title}>
          <FlowerKeyedList scope={selectedThreadID()} each={subagentSwitcherItems()} identity={(item) => item.threadID}>
            {(item) => <button type="button" class="flower-subagent-switch" data-flower-subagent-switch={item().threadID}
              aria-pressed={activeSubagentID() === item().threadID}
              aria-label={[subagentRowTitle(item()), subagentStatusLabel(item().status), subagentsCopy().openThread].join('. ')}
              title={[subagentRowTitle(item()), subagentStatusLabel(item().status)].join(' · ')}
              onClick={() => void openSubagentDetail(item())}>
              <SubagentAvatar threadID={item().threadID} class="flower-subagent-switch-avatar" />
            </button>}
          </FlowerKeyedList>
        </nav>
      </Show>}
      syncNotice={workspaceSyncNotice()}
      runProgress={<Show when={subagentDetailRunProgress()}>{(progress) => (
        <div class="flower-subagent-detail-progress">
          <FlowerProgressIndicator progress={progress()} label={liveProgressLabel(progress().kind, progress().retry)} outputCopy={copy().chat.outputProgress} />
        </div>
      )}</Show>}
      open={subagentDetailOpen()}
      onOpenChange={(open) => {
        if (!open) closeSubagentOverlays();
      }}
      threadID={activeSubagentID()}
      title={subagentDetailWindowTitle()}
      status={subagentDetailActiveStatus()}
      statusLabel={subagentSummaryStatus()}
      statusIndicator={subagentStatusIndicator(subagentDetailActiveStatus())}
      elapsedLabel={subagentDetailElapsedLabel()}
      description={subagentDetailMeta()}
      loading={subagentDetailLoading()}
      error={subagentDetailError()}
      detailAvailable={Boolean(subagentDetailThread())}
      entries={subagentDetailTimelineEntries()}
      inputControls={<>
      <Show when={subagentDetailThread()?.status === 'waiting_user' || subagentDetailThread()?.status === 'waiting_approval'}>
        <Button size="sm" variant="outline" onClick={() => { const active = activeSubagentDetail(); if (active) handleChildAttention(active.parentThreadID, active.childThreadID); }}>{copy().chat.subagentHandleRequest}</Button>
      </Show>
      <For each={transportOutbox().forThread(activeSubagentID())}>{entry => (
        <div class="flower-error-card" role="status" data-flower-child-compaction-delivery={entry.operation === 'context_compaction' ? entry.delivery : undefined} data-flower-child-send-delivery={entry.operation ? undefined : entry.delivery}>
          <div class="flower-error-copy"><p>{entry.terminalError === 'storage_restored' ? entry.operation === 'context_compaction' ? copy().chat.compactionStorageRestored : copy().chat.restoredInputDescription : entry.delivery === 'unknown' ? copy().chat.sendUnknownDescription : entry.operation === 'context_compaction' ? entry.continueGoal === true ? copy().chat.compactContext : copy().chat.compactContextOnly : entry.input.prompt}</p>
            <div class="flower-queued-turn-actions">{outboxRecoveryActions(() => entry)}</div>
          </div>
        </div>
      )}</For>
      <Show when={subagentDetailThread()?.queued_turns?.length}>
        <section class="flower-subagent-inputs" aria-label={subagentsCopy().input.queueTitle}>
          <h3>{subagentsCopy().input.queueTitle}</h3>
          <For each={subagentDetailThread()?.queued_turns}>{(item) => <div class="flower-subagent-input-row" data-flower-subagent-input-id={item.queue_id}>
            <p>{item.prompt}</p>
            <Show when={item.attachments?.length}><p>{item.attachments?.map(file => file.name).join(', ')}</p></Show>
            <Show when={item.references?.length}><p>{item.references?.map(ref => ref.label).join(', ')}</p></Show>
            <Show when={props.adapter.canMutate !== false && props.adapter.operateSubagentInput}>
              <div class="flower-subagent-input-actions">
                <Button size="sm" variant="outline" disabled={subagentInputCommand(item.queue_id)?.busy || !item.input_fingerprint}
                  aria-busy={subagentInputCommand(item.queue_id)?.busy}
                  onClick={() => void operateSubagentInput('steer_queue', item.queue_id, item.input_fingerprint)}>{subagentsCopy().input.steerNow}</Button>
                <Button size="sm" variant="ghost" disabled={subagentInputCommand(item.queue_id)?.busy || !item.input_fingerprint}
                  onClick={() => void operateSubagentInput('remove_queue', item.queue_id, item.input_fingerprint)}>{subagentsCopy().input.remove}</Button>
              </div>
            </Show>
            <Show when={subagentInputCommand(item.queue_id)?.error}><p role="alert">{subagentInputCommand(item.queue_id)?.error}</p></Show>
          </div>}</For>
        </section>
      </Show></>}

      contextIndicator={<Show when={subagentDetailThread()?.model_context}><FlowerComposerContextIndicator placement="below-start" usage={subagentDetailThread()?.context_usage ?? {}} modelContext={subagentDetailThread()?.model_context} copy={copy()} /></Show>}
      renderTimeline={() => <FlowerTurnTimeline thread={subagentDetailThread()} entries={subagentDetailTimelineEntries()}
        failureNoticeVisible={runErrorNoticeVisible(subagentDetailThread())}
        runtimeID={props.adapter.runtime.runtime_id} scope="subagent" choices={turnDisclosureChoices}
        scroll={subagentDetailScroll} reducedMotion={reducedMotionPreferred} liveConfirmed={livePresentationConfirmed} copy={copy().chat.turnProcess}
        renderEntry={(entry, visible) => timelineEntry(entry, subagentDetailScroll, subagentDetailThread, subagentThreadMedia, visible)} />}
      bindScroll={bindSubagentDetailViewport}
      onScroll={subagentDetailScroll.onScroll}
      onWheel={subagentDetailScroll.onWheel}
      onPointerDown={subagentDetailScroll.onPointerDown}
      onTouchMove={subagentDetailScroll.onTouchMove}
      onKeyDown={subagentDetailScroll.onKeyDown}
      latestPointerBlocked={subagentDetailScroll.latestPointerBlocked()}
      showScrollToLatest={showSubagentDetailScrollToLatestButton()}
      onScrollToLatest={() => subagentDetailScroll.scrollToBottom({ smooth: true })}
      onRetryLoad={retrySubagentDetailLoad}
      viewportLeftInset={presentation() === 'full' && !navigationOverlay() && threadNavigationOpen() ? threadRailWidth() + 12 : 12}
      zIndex={FLOWER_SURFACE_LAYER.subagentWindow}
      threadLoadingLabel={copy().chat.threadLoading}
      scrollToLatestLabel={copy().chat.scrollToLatest}
      copy={subagentsCopy()}
    />
  );

  const threadRecoveryNavigation = () => <>
    <Show when={!props.embeddedConversation}>
      <Button size="sm" variant="ghost" icon={Menu} onClick={() => setThreadNavigationOpen(true)}>
        {copy().chat.conversationsAria}
      </Button>
    </Show>
    <Button size="sm" variant="ghost" icon={Plus} disabled={surfaceWarmupActive()} onClick={startCompose}>
      {copy().chat.newChat}
    </Button>
  </>;

  const threadLoadingState = () => (
    <div class="flower-thread-loading" role="status" aria-live="polite">
      <div class="flower-thread-loading-panel">
        <div class="flower-thread-loading-eyebrow" aria-hidden="true" data-label="Flower" />
        <div class="flower-thread-loading-indicator" role="progressbar" aria-label={copy().chat.threadLoading}>
          <div class="flower-thread-loading-indicator-bar" />
        </div>
        <div class="flower-thread-loading-message">{copy().chat.threadLoading}</div>
        <div class="flower-error-actions">{threadRecoveryNavigation()}</div>
      </div>
    </div>
  );

  const threadEmptyState = () => (
    <div class="flower-thread-empty" role="status">
      <div class="flower-thread-loading-panel">
        <div class="flower-thread-loading-eyebrow" aria-hidden="true" data-label="Flower" />
        <div class="flower-thread-empty-message">{copy().chat.threadEmpty}</div>
      </div>
    </div>
  );

  const retrySelectedThreadDetail = () => {
    if (props.adapter.loadHistory && props.adapter.connectLiveStream && liveSyncState().status === 'failed') { liveTransport.restart(); return; }
    const threadID = trimString(selectedThreadID());
    if (!threadID || retiredThreadIDs.has(threadID)) return;
    void requestThreadDetail(
      threadID,
      'user_action',
      true,
    );
  };

  const workspaceSyncMessage = () => {
    if (unconfirmedStops().size > 0) return copy().chat.stopUnconfirmed;
    const state = liveSyncState();
    if (state.status === 'connecting') return copy().chat.syncConnecting;
    if (state.status === 'reconnecting') return copy().chat.syncReconnecting;
    const error = state.error as { status?: number; code?: string } | undefined;
    if (Number(error?.status) === 423) return copy().chat.syncLocked;
    if (Number(error?.status) === 426 || error?.code === 'flower_live_version_error') return copy().chat.syncVersion;
    if (Number(error?.status) === 429) return copy().chat.syncCapacity;
    if ([401, 403].includes(Number(error?.status))) return copy().chat.syncAuthorization;
    if (error?.code === 'flower_live_handshake_timeout') return copy().chat.syncTimeout;
    return copy().chat.syncFailed;
  };
  const resyncWorkspace = () => {
    if (props.adapter.connectLiveStream) { liveTransport.restart(); return; }
    for (const threadID of unconfirmedStops()) {
      void requestThreadDetail(threadID, 'user_action', true, true);
    }
  };
  const workspaceSyncNotice = () => (
    <Show when={(props.adapter.connectLiveStream && liveSyncState().status !== 'ready' && liveSyncState().status !== 'stopped') || unconfirmedStops().size > 0}>
      <div class="flower-workspace-sync" role="status" aria-live="polite" data-flower-sync-state={liveSyncState().status}>
        <span>{workspaceSyncMessage()}</span>
        <Show when={liveSyncState().status === 'failed' || unconfirmedStops().size > 0}>
          <Button size="sm" variant="outline" icon={Refresh} onClick={resyncWorkspace}>{copy().chat.syncResync}</Button>
        </Show>
      </div>
    </Show>
  );

  const threadSyncErrorNotice = () => (
    <Show when={selectedThread() ? threadLoadError() : ''}>
      {(message) => (
        <div class="flower-thread-sync-error">
          {errorNotice(
            copy().chat.threadLoadErrorTitle,
            message(),
            <Button
              size="sm"
              variant="outline"
              icon={Refresh}
              onClick={retrySelectedThreadDetail}
            >
              {copy().chat.handlerRetry}
            </Button>,
          )}
        </div>
      )}
    </Show>
  );

  const selectedThreadFallbackState = () => {
    if (threadLoadError() && !selectedThread()) {
      return (
        <div class="flower-thread-load-error">
          {errorNotice(
            createdForkThreadID() === selectedThreadID() ? copy().threadList.forkLoadFailed : copy().chat.threadLoadErrorTitle,
            threadLoadError(),
            <>
            <Button
              size="sm"
              variant="outline"
              icon={Refresh}
              onClick={retrySelectedThreadDetail}
            >
              {copy().chat.handlerRetry}
            </Button>
            {threadRecoveryNavigation()}
            </>,
          )}
        </div>
      );
    }
    if (selectedThread()) return threadEmptyState();
    if (selectedThreadLoading() || selectedThreadID()) return threadLoadingState();
    if (props.embeddedConversation?.emptyContent && !needsSetup() && !surfaceWarmupActive()) return props.embeddedConversation.emptyContent;
    if (showSetupWelcome()) return (
      <FlowerSetupWelcome copy={copy()} actions={noModelProfileSetupActions()} onOpenSettings={openSettings}
        refreshing={modelSourceRefreshing()} onRefresh={() => void refreshModelSource()}
        onAction={(action) => void action.run().catch((error) => notifyComposerError(getErrorMessage(error)))} />
    );
    return warmupCanReplaceTranscript()
      ? warmupPanel()
      : (
          <FlowerEmptyState
            copy={copy().emptyState}
            disabled={!readyForChat()}
            showSuggestions={presentation() !== 'companion'}
            workingDirectory={(
              <Show when={presentation() !== 'companion' && workingDirectoryPickerAvailable()}>
                <div class="flower-new-working-directory">
                  <span class="flower-new-working-directory-label">{copy().threadList.workingDirectoryLabel}</span>
                  <FlowerWorkingDirectoryControl
                    variant="select"
                    name={displayedWorkingDirectoryLabel()}
                    title={workingDirectoryPickerTitle()}
                    disabled={!canPickWorkingDirectory()}
                    expanded={workingDirectoryPickerOpen()}
                    onClick={openWorkingDirectoryPicker}
                  />
                </div>
              </Show>
            )}
            onSuggestionClick={(prompt) => {
              updateComposerSessionText(currentComposerSessionKey(), prompt);
              focusComposerAt(prompt.length);
            }}
          />
        );
  };

  const threadSyncingLatestState = () => (
    <div class="flower-thread-syncing-latest" role="status" aria-live="polite">
      <Refresh class="h-4 w-4" aria-hidden="true" />
      <span>{copy().chat.threadSyncingLatest}</span>
    </div>
  );

  const initialConversationFailureMessage = () => {
    const error = liveSyncState().error as { status?: number; code?: string } | undefined;
    if (props.adapter.connectLiveStream) {
      if ([401, 403].includes(Number(error?.status))) return copy().chat.initialAuthorization;
      if (Number(error?.status) === 423) return copy().chat.initialLocked;
      if (Number(error?.status) === 426 || error?.code === 'flower_live_version_error') return copy().chat.syncVersion;
      if (Number(error?.status) === 429) return copy().chat.syncCapacity;
      if (error?.code === 'flower_live_handshake_timeout') return copy().chat.syncTimeout;
    }
    return copy().chat.history.failed;
  };
  const warmupPanel = (initial = false) => {
    const failed = () => initial && initialConversationFailed();
    const title = () => failed() ? copy().threadList.title : warmupTitle();
    return (
      <div class={cn('flower-warmup', initial && 'h-full col-span-full')} role="status" aria-live="polite" aria-label={title()} aria-busy={!failed()}>
        <div class="flower-warmup-panel">
          <FlowerSoftAuraIcon class="redeven-flower-soft-aura-lg h-14 w-14" />
          <div class="flower-warmup-copy">
            <Show when={!initial}><div class="flower-warmup-eyebrow">{warmupPhaseLabel()}</div></Show>
            <h2>{title()}</h2>
            <p>{failed() ? initialConversationFailureMessage() : initial ? copy().chat.threadLoading : warmupDetail()}</p>
          </div>
          <Show when={!failed()} fallback={
            <Button size="sm" variant="outline" icon={Refresh} onClick={() => {
              if (props.adapter.connectLiveStream) liveTransport.restart();
              else void refreshThreads();
            }}>{copy().chat.handlerRetry}</Button>
          }>
            <div class="flower-warmup-indicator" aria-hidden="true"><div class="flower-warmup-indicator-bar" /></div>
          </Show>
        </div>
      </div>
    );
  };

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
          <span class="flower-model-menu-name" title={option.label}>{option.name || option.label}</span>
          <span class="flower-model-menu-meta">
            <Show when={option.quantization}><span>{option.quantization} · </span></Show>
            <Show when={option.disabled}><span>{option.unavailableReason ?? (option.pending ? copy().chat.modelsChecking : copy().settings.dialog.catalog.unavailableModel)}{option.contextWindow ? ' · ' : ''}</span></Show>
            <Show when={option.contextWindow}>
              <span>{formatFlowerTokenCount(option.contextWindow)} {copy().settings.dialog.contextSuffix}</span>
            </Show>
            <Show when={option.maxOutputTokens}>
              <span> · {formatFlowerTokenCount(option.maxOutputTokens)} {copy().settings.dialog.outputSuffix}</span>
            </Show>
            <Show when={option.supportsImageInput}>
              <span> · {copy().settings.dialog.imageInput}</span>
            </Show>
          </span>
          <Show when={option.aliases?.length}><span class="flower-model-menu-meta flower-model-menu-aliases" title={option.aliases?.join(', ')}>{copy().settings.dialog.catalog.aliases}: {option.aliases?.join(', ')}</span></Show>
          <WebSearchCapabilityBadge availability={option.webSearch} copy={copy().settings.dialog.catalog} />
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
        const recoveryActions = modelSourceRecoveryAction(status);
        return (
          <div
            class={cn('flower-model-source-status', `flower-model-source-status-${placement}`)}
            classList={{ 'flower-model-source-status-setup': recoveryActions.length > 1 }}
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
              <For each={recoveryActions}>
                {(value) => (
                  <button
                    type="button"
                    class="flower-model-source-status-action"
                    data-model-source-action={value.id}
                    aria-label={value.action.label}
                    title={value.action.label}
                    classList={{ 'flower-model-source-status-action-text': recoveryActions.length > 1 }}
                    onClick={() => {
                      void value.action.run().catch((error) => notifyComposerError(getErrorMessage(error)));
                    }}
                  >
                    {recoveryActions.length > 1 ? value.action.label : value.id === 'connection_center'
                      ? <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
                      : <Settings class="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                )}
              </For>
            </span>
          </div>
        );
      }}
    </Show>
  );

  const modelMenu = () => (
    <Show when={modelMenuOpen()}>
      <SurfaceFloatingLayer
        owner={modelTriggerRef}
        position={modelMenuPosition()}
        estimatedSize={modelMenuSize()}
        class="flower-model-menu-layer"
        style={{ '--flower-model-menu-available-height': `${modelMenuAvailableHeight()}px` } as JSX.CSSProperties}
        data-flower-floating-layer="true"
      >
      <div
        ref={modelMenuRef}
        class="flower-model-menu"
        role="dialog"
        aria-label={copy().settings.dialog.catalog.search}
        onKeyDown={handleModelMenuKeyDown}
      >
        <div class="flower-model-menu-header">
          <Input ref={modelSearchRef} class="flower-model-menu-search" leftIcon={<Search class="flower-model-menu-search-icon" aria-hidden="true" />} value={modelQuery()} onInput={(event) => setModelQuery(event.currentTarget.value)} placeholder={copy().settings.dialog.catalog.search} aria-label={copy().settings.dialog.catalog.search} size="sm" />
        </div>
        <div class="flower-model-menu-list" role="listbox" aria-label={copy().settings.dialog.catalog.search}>
          <Show when={menuModelOptions().models.length} fallback={<p class="flower-model-menu-empty">{copy().settings.dialog.catalog.empty}</p>}>
            <For each={groupedModelOptions()}>{(group, index) => (
              <div class={cn('flower-model-menu-group', index() > 0 && 'flower-model-menu-group-separated')} data-model-source-group={group.source} role="group" aria-label={group.label}>
                <div class="flower-model-menu-group-label">{group.label}</div>
                <For each={group.options}>{modelMenuItem}</For>
              </div>
            )}</For>
          </Show>
        </div>
        <Show when={!modelQuery().trim() && !modelMenuExpanded() && menuModelOptions().total > menuModelOptions().models.length}>
          <Button class="flower-model-menu-expand" size="sm" variant="ghost" onClick={() => setModelMenuExpanded(true)}>{copy().settings.dialog.catalog.showAll} ({menuModelOptions().total})</Button>
        </Show>
        <Show when={modelAvailabilityChecking() || modelDirectory()?.error || selectedModelNeedsAttention()}>
          <p class="flower-model-menu-status" role="status">{modelAvailabilityChecking() ? copy().chat.modelsChecking
            : modelDirectory()?.error === 'directory_timeout' ? copy().chat.modelsCheckTimedOut
            : modelDirectory()?.error ? copy().chat.modelsCheckFailed : selectedModelAvailabilityMessage()}</p>
        </Show>
        <div class="flower-model-menu-footer">
          <Button class="flower-model-menu-action" size="xs" variant="ghost" icon={Refresh} loading={modelSourceRefreshing()} onClick={() => void refreshModelSource()}>{copy().settings.dialog.catalog.refresh}</Button>
          <Button class="flower-model-menu-action flower-model-menu-manage" size="xs" variant="ghost" icon={Settings} onClick={() => { closeModelMenu(false); openSettings(); }}>{copy().settings.dialog.catalog.manage}</Button>
        </div>
        {modelSourceStatusRow('menu')}
      </div>
      </SurfaceFloatingLayer>
    </Show>
  );

  const composerModelLoading = () => !surfaceWarmupActive() && settingsLoading();
  const composerNotices = () => (
    <Show when={bottomActionMode() === 'chat' && !companionCollapsed()}>
      <div class="flower-composer-notices">
        <Show when={(needsSetup() || selectedModelNeedsAttention()) && !composerModelLoading() && (presentation() !== 'companion' || !unavailableModelSource())}>
          <div class="flower-setup-inline" role="status">{modelAvailabilityChecking() ? copy().chat.modelsChecking : selectedModelNeedsAttention() ? selectedModelAvailabilityMessage() : selectedComposerModelID() ? copy().chat.modelsUnavailable : copy().chat.configureProviderBeforeChat}</div>
        </Show>
        <Show when={!anyModelReady() || selectedComposerModelID().startsWith('desktop:')}>{modelSourceStatusRow('footer')}</Show>
        <Show when={handlerNotice()}>
          {(notice) => <div role="alert" class="flower-handler-error-card">
            <div class="flower-handler-error-icon"><AlertTriangle class="h-3.5 w-3.5" /></div>
            <div class="flower-handler-error-copy">
              <div class="flower-handler-error-title">{notice().title}</div>
              <div class="flower-handler-error-message">{notice().message}</div>
            </div>
            <button type="button" class="flower-handler-retry" onClick={() => void resolveHandlerDecision().catch(() => undefined)}>
              {copy().chat.handlerRetry}
            </button>
          </div>}
        </Show>
      </div>
    </Show>
  );
  const modelAvailabilityChecking = () => Boolean(modelSourceRefreshing() || modelDirectory()?.checking || modelDirectory()?.models.some(model => model.state === 'pending') || modelDirectory()?.sources.some(source => source.state === 'pending'));
  const modelReasoningSelector = (location: FlowerComposerControlLocation = 'inline') => (
    <Show
      when={!surfaceWarmupActive()}
      fallback={(
        <span class={cn('flower-model-chip', `flower-composer-control-${location}`, surfaceWarmupActive() && 'flower-model-chip-warmup')}>
          {warmupModelLabel()}
        </span>
      )}
    >
      <div
        class={cn('flower-model-reasoning-control', `flower-composer-control-${location}`)}
        data-flower-composer-control="model_reasoning"
        data-has-reasoning={composerReasoningVisible() || composerReasoningLoading() ? 'true' : 'false'}
        data-model-pending={modelPatchPending() ? 'true' : 'false'}
      >
        <button
          ref={modelTriggerRef}
          type="button"
          class="flower-model-reasoning-model-trigger"
          disabled={!composerModelInteractive() || modelPatchPending()}
          aria-haspopup="dialog"
          aria-expanded={modelMenuOpen()}
          aria-label={selectedModelNeedsAttention()
            ? `${copy().chat.modelLabel}: ${selectedThreadModelLabel()}. ${selectedModelAvailabilityMessage()}`
            : `${copy().chat.modelLabel}: ${selectedThreadModelLabel()}`}
          title={selectedModelNeedsAttention()
            ? selectedModelAvailabilityMessage()
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
        <Show when={composerReasoningVisible() || composerReasoningLoading()}>
          <span class="flower-model-reasoning-divider" aria-hidden="true" />
          <Show when={!composerReasoningLoading()} fallback={
            <span class="flower-reasoning-loading" role="status" aria-label={copy().chat.reasoningLoading} title={copy().chat.reasoningLoading}>
              <span aria-hidden="true">…</span>
            </span>
          }>
            <FlowerReasoningControl
              copy={copy().reasoningControl}
              compact
              variant="segment"
              capability={selectedReasoningCapability()}
              selection={composerReasoningSelection()}
              label={reasoningControlLabel()}
              readOnly={!composerReasoningInteractive()}
              onChange={(selection) => { void updateComposerReasoningSelection(selection); }}
            />
          </Show>
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
      case 'permission':
        return (
          <span class="flower-permission-trigger flower-composer-control-measure" data-permission-type={composerPermissionType()}>
            <Shield class="flower-permission-icon" />
            <span class="flower-permission-label">{composerPermissionCopy()?.label ?? copy().chat.permissionSelectorLabel}</span>
          </span>
        );
      case 'model_reasoning':
        return (
          <span
            class="flower-model-reasoning-control flower-composer-control-measure"
            data-has-reasoning={composerReasoningVisible() || composerReasoningLoading() ? 'true' : 'false'}
          >
            <span class="flower-model-reasoning-model-trigger">
              <span class="flower-model-reasoning-model-label">{selectedThreadModelLabel()}</span>
              <ChevronDown class="flower-model-reasoning-chevron" aria-hidden="true" />
            </span>
            <Show when={composerReasoningVisible() || composerReasoningLoading()}>
              <span class="flower-model-reasoning-divider" aria-hidden="true" />
              <Show when={!composerReasoningLoading()} fallback={<span class="flower-reasoning-loading">…</span>}>
              <span class="flower-reasoning-control flower-reasoning-control-segment">
                <span class="flower-reasoning-segment-button">
                  <span>{reasoningControlLabel()}</span>
                  <ChevronDown class="flower-reasoning-badge-icon" aria-hidden="true" />
                </span>
              </span>
              </Show>
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
                        <FileItemIcon size={18} item={{ name: candidate.label, type: candidate.kind === 'directory' ? 'folder' : 'file' }} class="size-[18px] shrink-0" />
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
        title={companionCollapsedEmptySelection()
          ? props.companionCopy?.label || selectedThreadTitle()
          : selectedThreadTitle()}
        data-flower-companion-empty-selection={companionCollapsedEmptySelection() ? 'true' : undefined}
        aria-haspopup="listbox"
        aria-expanded={threadSwitcherOpen()}
        onClick={() => {
          if (companionCollapsed() || !surfaceEngaged()) {
            requestCompanionOpen();
            setThreadSwitcherOpen(true);
            return;
          }
          setThreadSwitcherOpen((open) => !open);
        }}
      >
        <FlowerIcon class="flower-companion-thread-trigger-icon h-4 w-4 shrink-0 text-primary" />
        <Show when={!companionCollapsedEmptySelection()}>
          <span class="truncate">{selectedThreadTitle()}</span>
          <ChevronDown class="flower-companion-thread-trigger-chevron h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Show>
      </button>
      <Show when={threadSwitcherOpen() && props.companionCopy}>
        {(switcherCopy) => (
          <div class="flower-companion-thread-switcher-popover">
            <FlowerThreadSwitcher
              items={companionThreadItems()}
              activeThreadID={activeThreadID()}
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

  const composerTextEditor = () => (
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
          class="w-full flower-body-copy leading-6 text-foreground placeholder:text-muted-foreground"
          placeholder={bottomActionMode() === 'chat' ? props.embeddedConversation?.placeholder ?? composerPlaceholder() : composerPlaceholder()}
          value={composerTextValue()}
          disabled={composerTextareaDisabled()}
          readOnly={composerTextareaReadOnly()}
          aria-label={copy().chat.placeholder}
          data-flower-input-custom-answer={selectedInputRequest() && questionMode(activeInputQuestion()!) === 'select_or_write' ? 'true' : undefined}
          aria-autocomplete={composerReferenceEditingAllowed() || composerCommandMenuVisible() ? 'list' : undefined}
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
              ? flowerComposerCommandOptionID(composerCommandSuggested())
              : undefined}
          aria-describedby={companionCollapsed() ? companionDescriptionID() : undefined}
          onFocus={(event) => {
            setComposerFocused(true);
            const target = event.currentTarget;
            syncComposerSelection(target);
            if (!restoringCompanionFocus) requestCompanionForEditing();
          }}
          onBlur={() => {
            composerHistory.reset();
            setComposerFocused(false);
          }}
          onPointerDown={() => composerHistory.reset()}
          onClick={requestCompanionForEditing}
          onInput={handleComposerTextInput}
          onSelect={(event) => syncComposerSelection(event.currentTarget)}
          onKeyUp={(event) => syncComposerSelection(event.currentTarget)}
          onPaste={handleComposerPaste}
          onCompositionStart={() => {
            composerHistory.reset();
            setIsComposing(true);
            composerReferenceIndex?.softAbort();
            requestCompanionForEditing();
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
        class="w-full flower-body-copy leading-6 text-foreground placeholder:text-muted-foreground"
        placeholder={bottomActionMode() === 'chat' ? props.embeddedConversation?.placeholder ?? composerPlaceholder() : composerPlaceholder()}
        value={composerTextValue()}
        disabled={composerTextareaDisabled()}
        readOnly={composerTextareaReadOnly()}
        aria-label={copy().chat.placeholder}
        aria-haspopup="listbox"
        data-flower-input-custom-answer={selectedInputRequest() && questionMode(activeInputQuestion()!) === 'select_or_write' ? 'true' : undefined}
        onInput={(event) => updateComposerText(event.currentTarget.value)}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={(event) => {
          setIsComposing(false);
          updateComposerText(event.currentTarget.value);
        }}
        onKeyDown={handleComposerKeyDown}
      />
    </Show>
  );

  const goalControls = () => (
    <Show when={selectedGoal()?.status !== 'completed' && (selectedGoal()?.text || goalEditor())}>
      <button ref={goalTriggerRef} type="button" class="flower-goal-tag" aria-label={copy().chat.goalTitle}
        title={selectedGoal()?.text || copy().chat.goalDraft} aria-haspopup="dialog" aria-expanded={goalPopupOpen()}
        data-goal-status={selectedGoal()?.status} onClick={() => goalPopupOpen() ? closeGoalEditor() : openGoalEditor()}>
        <FlowerGoalIcon size={13} strokeWidth={1.65} aria-hidden="true" />{copy().chat.goalTitle}
        <Show when={selectedGoal()?.reviewing}><span class="flower-visually-hidden" role="status">{copy().chat.goalReviewing}</span></Show>
      </button>
      <Show when={goalPopupOpen()}>
        <SurfaceFloatingLayer owner={goalTriggerRef} position={goalPopupPosition()} estimatedSize={goalPopupSize()} class="flower-goal-layer" data-flower-floating-layer="true">
          <div ref={goalPanelRef} role="dialog" aria-label={copy().chat.goalTitle} class="flower-goal-popup" data-floe-surface="floating">
            <div class="flower-goal-popup-header"><span class="flower-goal-popup-title"><FlowerGoalIcon size={15} strokeWidth={1.65} aria-hidden="true" />{copy().chat.goalTitle}</span>
              <div class="flower-goal-popup-controls">
                <button type="button" aria-label={copy().chat.goalDelete} title={copy().chat.goalDelete} disabled={goalPopupLoad() !== 'ready' || goalCurrentVersionSeen() === undefined || !selectedGoal()?.text || goalPending() || goalComposing() || props.adapter.canMutate === false || selectedThreadReadOnly()} onClick={() => void enqueueGoal('delete', '')}><Trash class="h-3.5 w-3.5" /></button>
                <button type="button" aria-label={copy().computer.close} title={copy().computer.close} onClick={() => closeGoalEditor()}><X class="h-3.5 w-3.5" /></button>
              </div>
            </div>
            <Show when={goalEditor() && goalPopupLoad() !== 'loading'}>
              <div class="flower-goal-tabs" role="tablist" aria-label={copy().chat.goalTitle}>
                <For each={['current', 'draft'] as const}>{view => (
                  <button type="button" role="tab" id={goalPopupID + '-' + view} data-goal-view={view} aria-controls={goalPopupID}
                    aria-selected={goalPopupView() === view} tabIndex={goalPopupView() === view ? 0 : -1}
                    disabled={goalComposing()} onClick={() => showGoalView(view)}
                    onKeyDown={event => {
                      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                        event.preventDefault();
                        const next = event.key === 'Home' ? 'current' : event.key === 'End' ? 'draft' : view === 'current' ? 'draft' : 'current';
                        showGoalView(next);
                        event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('[data-goal-view="' + next + '"]')?.focus();
                      }
                    }}>
                    {view === 'current' ? copy().chat.goalCurrent : copy().chat.goalDraft}
                    <Show when={view === 'draft'}><span class="flower-goal-unsaved">{copy().chat.goalUnsaved}</span></Show>
                  </button>
                )}</For>
              </div>
            </Show>
            <div id={goalPopupID} role={goalEditor() && goalPopupLoad() !== 'loading' ? 'tabpanel' : undefined} aria-labelledby={goalEditor() && goalPopupLoad() !== 'loading' ? goalPopupID + '-' + goalPopupView() : undefined} class="flower-goal-body" aria-busy={goalPopupLoad() === 'loading'}>
              <Show when={goalPopupLoad() === 'loading'}>
                <p class="flower-goal-loading" role="status"><StableText reserve={[copy().chat.goalConfirming]}>{copy().chat.goalConfirming}</StableText></p>
              </Show>
              <Show when={goalPopupLoad() === 'error'}><p class="flower-goal-notice" role="alert">{copy().chat.goalConfirmFailed}</p></Show>
              <Show when={goalPopupLoad() === 'ready' || goalPopupLoad() === 'error' && goalPopupView() === 'draft' && goalEditor()}>
                <Show when={goalPopupLoad() === 'ready' && (goalDraftStale() || goalDeleteConflict())}>
                  <p class="flower-goal-notice" role="status">{copy().chat.goalUpdated}</p>
                </Show>
                <Show when={goalPopupView() === 'draft' || selectedGoal()?.text} fallback={<p class="flower-goal-notice">{copy().chat.goalMissing}</p>}>
                  <textarea ref={goalInputRef} aria-label={goalPopupView() === 'draft' ? copy().chat.goalDraft : copy().chat.goalTitle}
                    value={goalPopupView() === 'draft' ? goalEditor()?.text ?? '' : selectedGoal()?.text ?? ''} rows={4}
                    class="flower-goal-input" readOnly={!goalEditing() && Boolean(goalEditor()) || goalPopupLoad() !== 'ready' || props.adapter.canMutate === false || selectedThreadReadOnly()}
                    onCompositionStart={() => setGoalComposing(true)} onCompositionEnd={() => setGoalComposing(false)}
                    onInput={event => {
                      if (!goalEditing() && goalEditor() || goalPopupLoad() !== 'ready') return;
                      const editor = goalEditor();
                      if (!editor && event.currentTarget.value === (selectedGoal()?.text ?? '')) return;
                      batch(() => {
                        storeGoalEditor(currentComposerSessionKey(), { text: event.currentTarget.value, version: editor?.version ?? selectedGoal()?.version ?? 0 }, editor);
                        setGoalEditing(true);
                        setGoalPopupView('draft');
                      });
                    }}
                    onKeyDown={event => {
                      if (!event.isComposing && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        if (goalCanSave()) void enqueueGoal('set', goalEditor()?.text ?? '');
                      }
                    }} />
                </Show>
              </Show>
            </div>
            <Show when={goalPopupLoad() === 'error' || goalEditor() && goalPopupLoad() === 'ready'}>
              <div class="flower-goal-actions">
                <Show when={goalEditor()}><Button size="xs" class="flower-goal-discard" variant="ghost" disabled={goalComposing()} onClick={discardGoalDraft}>{copy().chat.goalDiscardDraft}</Button></Show>
                <Show when={goalPopupLoad() === 'error'} fallback={
                  <Show when={goalPopupView() === 'current' || !goalEditing() && !goalDraftStale()} fallback={
                    <Show when={goalEditing() && goalVersionReviewed()} fallback={<Button size="xs" class="flower-goal-primary" onClick={() => showGoalView('current')}>{copy().chat.goalViewCurrent}</Button>}>
                      <Button size="xs" class="flower-goal-primary" aria-label={goalDraftStale() ? copy().chat.goalReplace : copy().chat.goalSave} disabled={!goalCanSave() || goalPending() || goalComposing() || props.adapter.canMutate === false || selectedThreadReadOnly()} onClick={() => void enqueueGoal('set', goalEditor()?.text ?? '')}>
                        <StableText reserve={[copy().chat.goalSave, copy().chat.goalReplace]}>{goalDraftStale() ? copy().chat.goalReplace : copy().chat.goalSave}</StableText>
                      </Button>
                    </Show>
                  }>
                    <Button size="xs" class="flower-goal-primary" disabled={goalComposing() || props.adapter.canMutate === false || selectedThreadReadOnly()} onClick={continueGoalEditing}>{copy().chat.goalContinueEditing}</Button>
                  </Show>
                }><Button size="xs" class="flower-goal-primary" onClick={() => void confirmGoalPopup()}>{copy().chat.goalRetry}</Button></Show>
              </div>
            </Show>
          </div>
        </SurfaceFloatingLayer>
      </Show>
    </Show>
  );

  const progressLane = (conversation = false) => (
    <div class={cn('flower-model-status-lane', conversation && 'flower-model-status-lane--conversation')}>
      <Show when={selectedThreadStopPending()} fallback={
        <Show when={selectedThreadID() && props.adapter.connectLiveStream && !livePresentationConfirmed() && liveSyncState().status !== 'stopped'} fallback={
          <FlowerProgressIndicator
            progress={selectedRunProgress()}
            outputCopy={copy().chat.outputProgress}
            label={selectedRunProgress() ? liveProgressLabel(selectedRunProgress()!.kind, selectedRunProgress()!.retry) : ''}
          />
        }>
          <div class="flower-model-status-sync" data-flower-progress-sync-state={liveSyncState().status}>
            <Show when={liveSyncState().status === 'failed'} fallback={<Refresh class="size-3.5 shrink-0" aria-hidden="true" />}>
              <AlertCircle class="size-3.5 shrink-0" aria-hidden="true" />
            </Show>
            <span role="status" aria-live="polite" aria-atomic="true">{liveSyncState().status === 'failed'
              ? copy().chat.syncStatusFailed : liveSyncState().status === 'reconnecting'
                ? copy().chat.syncStatusReconnecting : copy().chat.syncStatusConnecting}</span>
            <Show when={liveSyncState().status === 'failed'}>
              <Button size="xs" variant="ghost" onClick={resyncWorkspace}>{copy().chat.syncResync}</Button>
            </Show>
          </div>
        </Show>
      }><span class="flower-turn-stopping text-xs text-muted-foreground" role="status" aria-live="polite">{copy().chat.stopping}</span></Show>
      {goalControls()}
    </div>
  );

  const composerPanel = () => (
        <div class="flower-chat-bottom-dock" data-flower-action-layout={bottomActionMode()}>
          <Show when={showScrollToLatestButton()}>
            <div class="flower-scroll-to-latest-float">
              <button
                type="button"
                class="flower-scroll-to-latest-button"
                data-flower-scroll-to-latest
                data-pointer-blocked={transcriptScroll.latestPointerBlocked() ? 'true' : undefined}
                onPointerDown={transcriptScroll.onPointerDown}
                onKeyDown={transcriptScroll.onKeyDown}
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
          <div class="flower-chat-bottom-dock-track">
            <Show when={!props.embeddedConversation}>{progressLane()}</Show>
            <Show when={bottomActionMode() !== 'approval'}>{threadSyncErrorNotice()}</Show>
            <div class="flower-composer-anchor">
              <Show when={bottomActionMode() !== 'approval'}>
                {composerReferenceMenu()}
                <Show when={composerCommandMenuVisible()}>
                  <div
                    id={FLOWER_COMPOSER_COMMAND_MENU_ID}
                    data-floe-surface="floating"
                    class="flower-composer-command-menu"
                    role="listbox"
                    aria-label={copy().chat.commandMenuLabel}
                    aria-activedescendant={flowerComposerCommandOptionID(composerCommandSuggested())}
                  >
                    <For each={composerCommandChoices()}>{command => <button
                      id={flowerComposerCommandOptionID(command)}
                      type="button"
                      role="option"
                      data-flower-compact-only={command === 'compact-only' ? '' : undefined}
                      aria-selected={composerCommandSuggested() === command}
                      class="flower-composer-command-item"
                      onPointerDown={(event) => event.preventDefault()}
                      onPointerMove={() => setComposerCommandIndex(composerCommandChoices().indexOf(command))}
                      onClick={() => executeComposerCommand(command)}
                    >
                      <Show when={command === '/goal'} fallback={<Clock class="h-3.5 w-3.5" aria-hidden="true" />}><FlowerGoalIcon class="h-3.5 w-3.5" strokeWidth={1.65} aria-hidden="true" /></Show>
                      <Show when={command !== 'compact-only'}><span class="flower-composer-command-token">{command}</span></Show>
                      <span class="flower-composer-command-description">{command === '/goal' ? copy().chat.commandGoal : command === 'compact-only' ? copy().chat.compactContextOnly : copy().chat.commandCompactContext}</span>
                    </button>}</For>
                  </div>
                </Show>
                <Show when={(selectedThread()?.restored_inputs?.length ?? 0) > 0}>
                  <section class="flower-restored-inputs" aria-label={copy().chat.restoredInputTitle}>
                    <h4>{copy().chat.restoredInputTitle}</h4>
                    <p>{copy().chat.restoredInputDescription}</p>
                    <For each={selectedThread()?.restored_inputs}>{(item) => {
                      const text = () => [item.input.text ?? '', ...(item.input.attachments ?? []).map((attachment) => attachment.name), ...(item.input.references ?? []).map((reference) => ('text' in reference ? reference.text : '') || reference.label)].filter(Boolean).join('\n');
                      return <div class="flower-restored-input" data-flower-restored-input-id={item.id}>
                        <pre>{text()}</pre>
                        <button type="button" class="flower-copy-input" onClick={() => void writeClipboardText(text(), copy().chat.restoredInputCopy).catch((error) => notifyThreadActionError(getErrorMessage(error)))}>{copy().chat.restoredInputCopy}</button>
                      </div>;
                    }}</For>
                  </section>
                </Show>
                {queuedTurnsDock()}
              </Show>
              {composerNotices()}
              <div
                data-floe-input-surface={!companionCollapsed() && (bottomActionMode() === 'chat' || (bottomActionMode() === 'input_request' && activeInputQuestionUsesTextEditor())) ? '' : undefined}
                data-floe-surface={companionCollapsed() ? 'flat' : 'inset'}
                class={cn(
                  'flower-composer p-3',
                  bottomActionMode() !== 'chat' && 'flower-decision-surface',
                )}
                aria-busy={composerReferenceMutationCount() > 0 ? 'true' : undefined}
                data-flower-bottom-mode={bottomActionMode()}
                data-flower-companion-compact={companionCompactComposer() ? 'true' : undefined}
                data-flower-attachment-drag={attachmentDragActive() ? 'true' : undefined}
                data-flower-text-entry={(bottomActionMode() === 'chat' || (bottomActionMode() === 'input_request' && activeInputQuestionUsesTextEditor())) && !composerTextareaDisabled() ? 'true' : undefined}
                ref={composerSurfaceRef}
                onClick={handleComposerBlankClick}
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
                <Show when={companionCollapsed() && !props.companionCopy && !companionSummaryVisible()}>
                  <span
                    class={cn(
                      'flower-companion-collapsed-icon',
                      livePresentationConfirmed() && props.companionSummary?.running && 'flower-companion-collapsed-icon-running',
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
                <Show when={companionCollapsed() && props.companionCopy}>
                  <div
                    class="flower-companion-collapsed-thread-switcher"
                    data-flower-companion-empty-selection={companionCollapsedEmptySelection() ? 'true' : undefined}
                  >
                    {companionHeaderIdentity()}
                  </div>
                </Show>
                <Show when={companionActionVisible()}>
                  <button
                    ref={companionActionRef}
                    type="button"
                    class="flower-companion-collapsed-action"
                    aria-controls={props.companionRegionID}
                    aria-expanded="false"
                    aria-label={companionEntry().text}
                    title={companionEntry().text}
                    onClick={activateCompanionEntry}
                  >
                    <span class="truncate">
                      {companionEntry().text}
                    </span>
                  </button>
                </Show>
                <Show when={companionSummaryVisible()}>
                  <button
                    type="button"
                    class={cn(
                      'flower-companion-collapsed-summary',
                      livePresentationConfirmed() && props.companionSummary?.running
                        && 'flower-companion-collapsed-summary-running',
                      props.companionSummary?.priorityStatus === 'failed'
                        && 'flower-companion-collapsed-summary-failed',
                      props.companionSummary?.ephemeralKind === 'completion'
                        && 'flower-companion-collapsed-summary-completion',
                    )}
                    data-flower-companion-status={props.companionSummary?.priorityStatus}
                    data-flower-companion-ephemeral-kind={props.companionSummary?.ephemeralKind}
                    title={props.companionSummary?.accessibleText}
                    aria-label={props.companionSummary?.accessibleText}
                    aria-controls={props.companionRegionID}
                    aria-expanded="false"
                    ref={companionSummaryRef}
                    onClick={activateCompanionEntry}
                  >
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
                <Show when={bottomActionMode() === 'chat'}>{props.embeddedConversation?.composerContext}</Show>
                <div
                  class="flower-composer-content"
                  aria-hidden={companionActionVisible() || companionSummaryVisible() ? 'true' : undefined}
                  inert={companionActionVisible() || companionSummaryVisible()}
                >
                <Switch>
                  <Match when={bottomActionMode() === 'approval'}>
                    <Show when={selectedComposerApprovalActions().length > 0}>
                      <span class="flower-visually-hidden" role="status" aria-live="polite" aria-atomic="true">{approvalQueueAnnouncement()}</span>
                      <section
                        ref={(element) => { composerApprovalCardRef = element; }}
                        class="flower-approval-surface"
                        tabIndex={-1}
                        data-flower-approval-layout={selectedComposerApprovalActions().length === 1 ? 'single' : 'multi'}
                        aria-label={selectedComposerApprovalActions().length === 1
                          ? copy().chat.toolApprovalComposerTitle
                          : copy().chat.toolApprovalPendingCount(selectedComposerApprovalActions().length)}
                      >
                        <div class="flower-approval-queue-header">
                          <span class="flower-approval-queue-progress">{copy().chat.toolApprovalPendingCount(selectedComposerApprovalActions().length)}</span>
                          <Show when={selectedApprovalBatchActions().length !== selectedComposerApprovalActions().length}>
                            <span class="flower-approval-eligible-count">{copy().chat.toolApprovalEligibleCount(selectedApprovalBatchActions().length)}</span>
                          </Show>
                        </div>
                        <div class="flower-approval-queue-list" {...props.approvalScrollViewportProps}>
                          {threadSyncErrorNotice()}
                          <FlowerKeyedList scope={selectedThreadID()} focusFallback={focusComposerIfConnected}
                            focusTarget={element => element}
                            each={selectedComposerApprovalActions()} identity={action => JSON.stringify([selectedThreadID(), action.turn_id, action.run_id, action.action_id])}>
                            {approval => {
                              const actionID = untrack(() => approval().action_id);
                              return approvalActionCard(actionID, approval, true);
                            }}
                          </FlowerKeyedList>
                        </div>
                        <div class="flower-composer-approval-actions flower-approval-queue-footer">
                          <div class="flower-approval-controls">
                            <Button variant="secondary" icon={FlowerStopIcon} size="icon" class="flower-composer-stop-thread rounded-full"
                              aria-label={selectedThreadStopLabel()} title={selectedThreadStopLabel()}
                              disabled={!selectedThreadCanStop() || selectedThreadStopPending()} loading={selectedThreadStopPending()}
                              onClick={() => void stopSelectedThreadFromComposer()} />
                            {permissionSelector()}
                          </div>
                          <span class="flower-approval-scope" title={copy().chat.toolApprovalScope}>{copy().chat.toolApprovalOnceScope}</span>
                          <Show when={selectedComposerApprovalActions().length > 1}>
                            <FlowerApprovalDecisionActions
                              label={copy().chat.toolApprovalPendingCount(selectedApprovalBatchActions().length)}
                              rejectLabel={copy().chat.toolApprovalRejectBatch(selectedApprovalBatchActions().length)}
                              approveLabel={copy().chat.toolApprovalApproveBatch(selectedApprovalBatchActions().length)}
                              rejectAriaLabel={copy().chat.toolApprovalRejectBatchAction(selectedApprovalBatchActions().length)}
                              approveAriaLabel={copy().chat.toolApprovalApproveBatchAction(selectedApprovalBatchActions().length)}
                              disabled={selectedApprovalBatchActions().length < 2 || selectedApprovalBatchActions().some(candidate => !approvalActionCanDecide(candidate))}
                              onReject={() => void submitApprovalBatchDecision(false)} onApprove={() => void submitApprovalBatchDecision(true)} />
                          </Show>
                        </div>
                      </section>
                    </Show>
                  </Match>
                  <Match when={bottomActionMode() === 'input_request'}>
                    {inputRequestPrompt(selectedInputRequest, { surface: 'composer' })}
                    <Show when={activeInputQuestionUsesTextEditor()}>
                      {composerTextEditor()}
                    </Show>
                    <Show when={!isToolOriginComputerInput(selectedInputRequest())}><div class="flower-decision-actions flower-input-request-actions">
                      <Show when={selectedThreadReadOnly()}>
                        <span class="flower-decision-readonly-status flower-composer-readonly-chip" role="status">
                          {selectedThreadReadOnlyDisplay()}
                        </span>
                      </Show>
                      <Button
                        variant="secondary"
                        icon={FlowerStopIcon}
                        size="icon"
                        class="flower-composer-stop rounded-full"
                        aria-label={selectedThreadStopLabel()}
                        title={selectedThreadStopLabel()}
                        disabled={!selectedThreadCanStop() || selectedThreadStopPending()}
                        loading={selectedThreadStopPending()}
                        onClick={() => void stopSelectedThreadFromComposer()}
                      />
                      <Button
                        variant="primary"
                        icon={ArrowUp}
                        class="flower-composer-continue rounded-full"
                        disabled={!selectedDecisionAvailable() || inputRequestIsSubmitting() || !inputRequestReadyToSubmit()}
                        loading={inputRequestIsSubmitting()}
                        onClick={() => void submitChat()}
                      >
                        {chatCopyValue('inputRequestSubmit', 'Continue')}
                      </Button>
                    </div></Show>
                  </Match>
                  <Match when={bottomActionMode() === 'chat'}>
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
                <span class="flower-visually-hidden" aria-live="polite" aria-atomic="true" data-flower-input-history-announcement>
                  {composerHistoryAnnouncement()}
                </span>
                <Show when={composerHasReferences()}>
                  <div class="flower-composer-reference-lane" role="list" aria-label={copy().chat.composerReferencesLabel}>
                    <For each={composerReferences()}>
                      {(reference, index) => (
                        <div
                          class="flower-composer-reference-chip"
                          role="listitem"
                          title={flowerDraftReferenceDescription(reference)}
                          data-reference-kind={reference.kind}
                        >
                          <Show when={reference.kind === 'page_context' || reference.kind === 'thread' || reference.kind === 'snapshot'} fallback={<>
                            <span class="flower-composer-reference-chip-icon" aria-hidden="true">
                              <FileItemIcon size={18} item={{ name: reference.label, type: reference.kind === 'directory' ? 'folder' : 'file' }} class="size-[18px] shrink-0" />
                            </span>
                            <span class="flower-composer-reference-chip-label">{reference.label}</span>
                          </>}>
                            <button type="button" class="flower-composer-reference-chip-preview" title={reference.label}
                              onClick={() => { captureSnapshotPreviewFocus(); setComposerSnapshotPreviewID(reference.local_id); }}>
                              <FlowerContextIcon tone={reference.kind === 'snapshot' ? reference.snapshot.kind === 'text' ? 'snapshot' : reference.snapshot.kind : reference.kind === 'thread' ? 'thread' : 'page_context'} name={reference.label} />
                              <span class="flower-composer-reference-chip-label">{reference.label}</span>
                            </button>
                          </Show>
                          <button
                            ref={(el) => {
                              composerReferenceRemoveButtons.set(reference.local_id, el);
                              onCleanup(() => composerReferenceRemoveButtons.delete(reference.local_id));
                            }}
                            type="button"
                            class="flower-composer-reference-chip-remove"
                            aria-label={copy().chat.composerReferenceRemove(flowerDraftReferenceDescription(reference))}
                            title={copy().chat.composerReferenceRemove(flowerDraftReferenceDescription(reference))}
                            disabled={composerReferenceMutationCount() > 0 || !composerReferenceRemovalAllowed()}
                            onClick={() => void removeComposerReference(reference, index())}
                          >
                            <XCircle class="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={composerHasAttachments()}>
                  <FlowerAttachmentLane
                    items={composerAttachmentItems()}
                    loadAdmittedPreview={loadMessageAttachmentBlob}
                    copy={attachmentCopy()}
                    disabled={!composerAttachmentEditingAllowed()}
                    onRetry={(localID) => {
                      const operation = currentComposerDraftOperation();
                      const modelID = selectedComposerModelID();
                      void ensureAttachmentStagingScope(operation.sessionKey).then(async () => {
                        if (!composerDraftOperationCurrent(operation) || selectedComposerModelID() !== modelID
                          || draftSubmissionActive(operation.session.snapshot().value)) return;
                        if (!operation.controller.snapshot().capability && props.adapter.loadAttachmentCapability) {
                          const capability = await props.adapter.loadAttachmentCapability(modelID);
                          if (!composerDraftOperationCurrent(operation) || selectedComposerModelID() !== modelID) return;
                          if (capability.model_id !== modelID) throw new Error('Attachment capability model identity changed.');
                          operation.controller.setCapability(capability);
                        }
                        if (!composerDraftOperationCurrent(operation) || selectedComposerModelID() !== modelID
                          || draftSubmissionActive(operation.session.snapshot().value)) return;
                        operation.controller.retry(localID);
                      }).catch(() => {
                        if (!composerDraftOperationCurrent(operation) || selectedComposerModelID() !== modelID
                          || draftSubmissionActive(operation.session.snapshot().value)) return;
                        operation.controller.markStagingUnavailable();
                        notifyComposerError(attachmentCopy().errorUploadFailed);
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
                <Show when={!goalCommand() && composerTextOverLimit()}>
                  <div class="flower-composer-over-limit" role="status">
                    {attachmentCopy().overLimit(FLOWER_INLINE_TEXT_CODE_POINT_LIMIT)}
                  </div>
                </Show>
                <Show when={goalCommand()?.error}><p class="flower-goal-error" role="alert">{goalCommand()?.error}</p><p class="flower-goal-current">{selectedGoal()?.text}</p></Show>
                <div class="flower-composer-entry" data-flower-goal-mode={goalCommand() ? 'true' : undefined}>
                  <Show when={goalCommand()}>
                    <span class="flower-goal-command-chip"><FlowerGoalIcon size={13} strokeWidth={1.65} aria-hidden="true" />/goal<button type="button" aria-label={copy().computer.close} title={copy().computer.close} onClick={exitGoalCommand}><X class="h-3 w-3" /></button></span>
                  </Show>
                  {composerTextEditor()}
                </div>
                <div class="flower-composer-footer">
                    <div class="flower-model-stack">
                      {composerControls()}
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
                            disabled={!composerCanAddAttachments()}
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
                      <Show when={selectedContextUsage() ?? (selectedThread()?.model_context ? {} : undefined)}>
                        {(contextUsage) => (
                          <FlowerComposerContextIndicator
                            usage={contextUsage()}
                            modelContext={selectedThread()?.model_context}
                            copy={copy()}
                          />
                        )}
                      </Show>
                      <Show when={selectedThreadCanStop() && !composerPrimaryActionIsStop()}>
                        <Button
                          variant="secondary"
                          icon={FlowerStopIcon}
                          size="icon"
                          class="flower-composer-stop flower-composer-stop-inline rounded-full"
                          aria-label={selectedThreadStopLabel()}
                          title={selectedThreadStopLabel()}
                          disabled={selectedThreadStopPending()}
                          loading={selectedThreadStopPending()}
                          onClick={() => void stopSelectedThreadFromComposer()}
                        />
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
                </div>
                  </Match>
                </Switch>
              </div>
            </div>
          </div>
        </div>
      </div>
  );

  const computerHeaderLabel = () => isBrowserInstallInput(selectedInputRequest()) || isBrowserConnectionInput(selectedInputRequest())
    ? selectedComputerAssistance().title
    : `${computerStageHistorical() ? copy().chat.computerViewLastScreenshot : copy().chat.computerStageRestore}. ${copy().chat.computerStageStatus[computerStageSessionState()]}`;
  const subagentHeaderLabel = () => {
    const items = selectedSubagentItems();
    if (!items.length) return subagentsCopy().openLabel;
    const statuses = [...new Set(items.map(item => item.status))];
    return `${subagentsCopy().openLabel} · ${statuses.map(status => (
      `${subagentStatusLabel(status)}: ${subagentsCopy().activity.agentsCount(String(items.filter(item => item.status === status).length))}`
    )).join(' · ')}`;
  };
  const headerActionDefinitions: readonly (Omit<FlowerConversationAction, 'label' | 'disabled'> & {
    visible: Accessor<boolean>;
    label: Accessor<string>;
    disabled?: Accessor<boolean>;
  })[] = [
    { id: 'connections', visible: () => Boolean(selectedThreadID() && props.adapter.computerManagement),
      label: () => copy().computer.title, icon: () => <Link class="h-4 w-4" aria-hidden="true" />,
      run: () => setComputerDialog('settings') },
    { id: 'computer-stage', visible: () => Boolean(computerStageAvailable() && selectedComputerStage()),
      label: computerHeaderLabel, icon: () => <MonitorPointer size={15} aria-hidden="true" />,
      run: source => {
        if (isBrowserInstallInput(selectedInputRequest())) { setComputerDialog('installation'); return; }
        if (isBrowserConnectionInput(selectedInputRequest())) { setComputerDialog('connection'); return; }
        restoreComputerStage(source);
      } },
    { id: 'new-conversation', visible: () => presentation() === 'companion' && !props.embeddedConversation,
      label: () => copy().chat.newChat, icon: () => <Plus class="h-4 w-4" aria-hidden="true" />,
      disabled: surfaceWarmupActive, run: startCompose },
    { id: 'subagents', visible: () => true, label: subagentHeaderLabel,
      icon: () => <Bot class="h-4 w-4" aria-hidden="true" />,
      run: source => { subagentTriggerRef = source; openSubagents(); } },
    { id: 'settings', visible: () => true, label: () => copy().chat.settingsLabel,
      icon: () => <Settings class="h-4 w-4" aria-hidden="true" />, run: openSettings },
  ];
  const conversationHeaderActions = createMemo<readonly FlowerConversationAction[]>(() => headerActionDefinitions
    .filter(action => action.visible()).map(action => ({
      id: action.id, label: action.label(), icon: action.icon, disabled: action.disabled?.(), run: action.run,
    })));

  const chatHeaderActions = () => (
          <div class="flower-chat-header-actions">
            <Show when={!props.embeddedConversation && presentation() !== 'companion'}><FlowerWorkingDirectoryControl
              variant="browse"
              name={displayedWorkingDirectoryLabel()}
              title={workingDirectoryBrowseTitle()}
              disabled={Boolean(workingDirectoryBrowseDisabledReason())}
              onClick={(event) => {
                const path = displayedWorkingDirectory();
                if (workingDirectoryBrowseDisabledReason()) return;
                const threadID = selectedThreadID();
                void browseWorkingDirectory({ path, ...(threadID ? { thread_id: threadID } : {}) }, event.currentTarget);
              }}
            /></Show>
            <For each={headerActionDefinitions}>{action => <Show when={action.visible()}><Switch fallback={
              <button type="button" class="flower-header-icon-button" aria-label={action.label()} title={action.label()}
                disabled={action.disabled?.()} aria-haspopup={action.id === 'connections' ? 'dialog' : undefined}
                aria-expanded={action.id === 'connections' ? computerDialog() !== null : undefined}
                onClick={event => action.run(event.currentTarget)}>{action.icon()}</button>
            }>
              <Match when={action.id === 'computer-stage'}>
              <button type="button" class="flower-computer-entry" aria-expanded={isBrowserInstallInput(selectedInputRequest()) || isBrowserConnectionInput(selectedInputRequest()) ? computerDialog() !== null : computerStageOpen()}
                data-session-state={computerStageSessionState()}
                data-floe-progress-shimmer={livePresentationConfirmed() && computerStageSessionState() === 'running' ? 'surface' : undefined}
                title={isBrowserInstallInput(selectedInputRequest()) || isBrowserConnectionInput(selectedInputRequest()) ? selectedComputerAssistance().title : `${computerStageHistorical() ? copy().chat.computerViewLastScreenshot : copy().chat.computerStageRestore} — ${copy().chat.computerStageStatus[computerStageSessionState()]}`}
                aria-label={action.label()}
                onClick={event => action.run(event.currentTarget)}>
                {action.icon()}
                <span class="flower-computer-entry-label" role="status" data-floe-progress-shimmer={livePresentationConfirmed() && computerStageSessionState() === 'running' ? 'text' : undefined}>{computerStageEntryLabel()}</span>
              </button>
              </Match>
              <Match when={action.id === 'subagents'}>
            <div class="flower-subagents-anchor">
              <button
                ref={element => { subagentTriggerRef = element; }}
                type="button"
                class={cn('flower-header-icon-button', selectedSubagentItems().length > 0 && 'flower-subagent-header-button', (subagentDropdownOpen() || activeSubagentID()) && 'flower-header-icon-button-active')}
                data-flower-subagent-count={selectedSubagentItems().length || undefined}
                aria-label={action.label()}
                title={action.label()}
                aria-haspopup="dialog"
                aria-expanded={subagentDropdownOpen()}
                aria-controls="flower-subagents-dropdown"
                onClick={event => action.run(event.currentTarget)}
              >
                <Show when={selectedSubagentItems().length > 0} fallback={action.icon()}>
                  <SubagentAvatarStack threadIDs={subagentHeaderItems().map(item => item.threadID)} state={subagentHeaderState()}
                    animate={livePresentationConfirmed() && !subagentDropdownOpen()} />
                </Show>
              </button>
            </div>
              </Match>
            </Switch></Show>}</For>
            {subagentDropdown()}
            <Show when={sidePanel() === 'chat'}>{props.headerTrailingActions}</Show>
          </div>
  );

  const chatPanel = () => (
    <div class="flower-chat-shell flower-chat-shell">
      <Show when={!props.embeddedConversation}>
      <div
        class="flower-chat-header border-b border-border/80"
        aria-hidden={companionCollapsed() ? 'true' : undefined}
        inert={companionCollapsed()}
      >
        <div class="flower-chat-header-row" data-title-editing={headerTitleEditing() ? 'true' : undefined}>
          <Show
            when={presentation() === 'companion'}
            fallback={(
              <div class="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  class="flower-mobile-navigation-button flower-header-icon-button"
                  ref={mobileThreadsTrigger}
                  aria-label={copy().chat.conversationsAria}
                  title={copy().chat.conversationsAria}
                  aria-haspopup="dialog"
                  aria-expanded={threadNavigationOpen()}
                  onClick={(event) => {
                    event.currentTarget.focus({ preventScroll: true });
                    setThreadNavigationOpen(true);
                  }}
                >
                  <span aria-hidden="true"><Menu class="h-5 w-5" /></span>
                </button>
                <FlowerIcon class="h-5 w-5 text-primary" />
                <div class="flower-chat-header-identity min-w-0" data-editing={headerTitleEditing() ? 'true' : undefined}
                  onFocusOut={(event) => {
                    if (!headerTitleEditing() || renameSaving() || event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                    if (!trimString(renameDraft())) finishRename(renameTarget(), false);
                    else void submitRename(false);
                  }}
                >
                  <Show when={headerTitleEditing()} fallback={<div class="flower-chat-header-title truncate" title={selectedThreadTitle()}>{selectedThreadTitle()}</div>}>
                    <div class="flower-chat-header-title-field" aria-busy={renameSaving() ? 'true' : undefined}>
                      <input ref={renameInputRef} class="flower-chat-header-title-input"
                        aria-label={copy().threadList.renameTitle}
                        value={renameDraft()} readOnly={renameSaving()}
                        aria-invalid={renameError() ? 'true' : undefined}
                        aria-describedby={renameError() ? 'flower-header-rename-error' : undefined}
                        onInput={(event) => { setRenameDraft(event.currentTarget.value); setRenameError(''); }}
                        onKeyDown={(event) => {
                          if (event.isComposing) return;
                          if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void submitRename(); }
                          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRename(); }
                        }}
                      />
                      <Show when={renameError()}>{message => <p id="flower-header-rename-error" class="flower-chat-header-title-error" role="alert">{message()}</p>}</Show>
                    </div>
                  </Show>
                  <Show when={props.adapter.renameThread && selectedThreadID()}>
                    <button
                      ref={headerRenameTriggerRef}
                      type="button"
                      class="flower-chat-header-rename flower-header-icon-button"
                      aria-label={headerTitleEditing() ? (renameSaving() ? copy().threadList.saving : copy().threadList.save) : copy().threadList.renameTitle}
                      title={headerTitleEditing() ? copy().threadList.save : copy().threadList.renameTitle}
                      aria-disabled={headerTitleEditing() && (renameSaving() || !trimString(renameDraft())) ? 'true' : undefined}
                      onClick={(event) => headerTitleEditing() ? void submitRename() : openRename(
                        selectedThreadID(),
                        canonicalFlowerThreadSnapshotTitle(selectedThreadSummary()) || canonicalFlowerThreadSnapshotTitle(selectedThread()),
                        event.currentTarget,
                        'header',
                      )}
                    >
                      <Show when={headerTitleEditing()} fallback={<Pencil class="h-3.5 w-3.5" aria-hidden="true" />}>
                        <Show when={renameSaving()} fallback={<Check class="h-3.5 w-3.5" aria-hidden="true" />}>
                          <Refresh class="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
                        </Show>
                      </Show>
                    </button>
                    <Show when={headerTitleEditing()}>
                      <button type="button" class="flower-chat-header-rename-cancel flower-header-icon-button"
                        aria-label={copy().threadList.cancel} title={copy().threadList.cancel}
                        disabled={renameSaving()} onClick={closeRename}><X class="h-3.5 w-3.5" aria-hidden="true" /></button>
                    </Show>
                  </Show>
                </div>
              </div>
            )}
          >
            <Show when={!companionCollapsed()}>{companionHeaderIdentity()}</Show>
          </Show>
          {chatHeaderActions()}
        </div>
      </div>
      </Show>
      <Show when={subagentDetailMounted()}><Suspense>{subagentDetailDialog()}</Suspense></Show>
      <FlowerComputerConnections open={computerDialog() !== null} onOpenChange={open => { if (!open) setComputerDialog(null); }}
        continuationKey={`${activeThreadID()}:${selectedInputRequest()?.prompt_id ?? ''}`}
        connectionOnly={computerDialog() === 'connection'} installationOnly={computerDialog() === 'installation'} onContinue={async (enabled) => {
          if (pendingThreadSelection()) return;
          const request = selectedInputRequest();
          if ((!isBrowserConnectionInput(request) && !isBrowserInstallInput(request)) || !request) return;
          setComputerDialog(null);
          if (!isToolOriginComputerInput(request)) return;
          const question = request.questions[0], choice = question.choices?.[isBrowserInstallInput(request) && enabled === false ? 1 : 0];
          if (!choice) return;
          selectInputChoice(question, choice);
          setComputerDialog(null);
          await submitInputRequest();
        }}
        permissionLabel={composerPermissionCopy()?.label} onEditPermissionMode={() => { queueMicrotask(() => openPermissionMenu()); }}
        threadID={selectedThreadID()} fullAccess={selectedThread()?.permission_type === 'full_access'} adapter={props.adapter} copy={copy().computer} requested={requestedComputerAccess()} />
      <Show when={composerSnapshotPreview()} keyed>{reference => (
        <Dynamic component={props.renderContextSnapshotPreview ?? FlowerChatContextPreview}
          title={reference.label} subtitle={reference.kind === 'page_context' ? reference.title : ''}
          body={reference.kind === 'thread' ? threadSnapshotBody(reference.thread) : reference.kind === 'snapshot' ? reference.snapshot.text : reference.content}
          truncated={reference.kind === 'snapshot' && reference.snapshot.truncated}
          actionLabel={reference.kind === 'thread' ? copy().chat.threadReference.open : undefined}
          onAction={reference.kind === 'thread' ? () => void openReferencedThread(reference.thread) : undefined}
          actionDisabled={referenceOpenBusy() || (reference.kind === 'thread' && !!referencedThreadUnavailable(reference.thread))}
          statusMessage={referenceOpenError() || (reference.kind === 'thread' ? referencedThreadUnavailable(reference.thread) : '')}
          truncatedLabel={copy().chat.truncatedLabel} zIndex={FLOWER_SURFACE_LAYER.contextPreview}
          onClose={closeSnapshotPreview} />
      )}</Show>
      <Show when={contextSnapshotPreview()} keyed>{preview => (
        <Dynamic component={props.renderContextSnapshotPreview ?? FlowerChatContextPreview}
          title={preview.title} subtitle={preview.action.subtitle}
          body={preview.action.type === 'open_thread_preview' ? threadSnapshotBody(preview.action.thread) : preview.action.body}
          actionLabel={preview.action.type === 'open_thread_preview' ? copy().chat.threadReference.open : undefined}
          onAction={preview.action.type === 'open_thread_preview' ? () => { if (preview.action.type === 'open_thread_preview') void openReferencedThread(preview.action.thread); } : undefined}
          actionDisabled={referenceOpenBusy() || (preview.action.type === 'open_thread_preview' && !!referencedThreadUnavailable(preview.action.thread))}
          statusMessage={referenceOpenError() || (preview.action.type === 'open_thread_preview' ? referencedThreadUnavailable(preview.action.thread) : '')}
          sourcePath={preview.action.type === 'open_text_preview' ? preview.action.source_path : preview.action.type === 'open_process_preview' ? `process://${preview.action.pid}` : undefined}
          truncated={preview.action.truncated} truncatedLabel={copy().chat.truncatedLabel}
          zIndex={FLOWER_SURFACE_LAYER.contextPreview} onClose={closeSnapshotPreview} />
      )}</Show>
      <FlowerAttachmentPreviewWindow
        source={attachmentPreview()}
        zIndex={FLOWER_SURFACE_LAYER.attachmentPreview}
        loadingLabel={attachmentCopy().uploading}
        unavailableLabel={copy().chat.media.unavailable}
        onClose={() => setAttachmentPreview(null)}
      />
      {workspaceSyncNotice()}
      <Show when={attentionNavigation() && selectedThreadID() === attentionNavigation()?.childThreadID}>
        <div class="flower-error-actions"><Button size="sm" variant="ghost" onClick={() => { const navigation = attentionNavigation(); if (navigation) { selectThread(navigation.parentThreadID); setAttentionNavigation(null); } }}>{copy().chat.subagentReturnParent}</Button></div>
      </Show>
      {settingsReadNotice()}
      <div class="flower-chat-main" data-flower-action-layout={bottomActionMode()} data-setup-welcome={showSetupWelcome() && !companionCollapsed() ? 'true' : undefined}>
        <div class="flower-transcript-region">
        <div
          ref={(node) => {
            setComputerLauncherBoundary(node);
            transcriptScroll.bind(node);
          }}
          class="flower-chat-transcript flower-chat-transcript"
          data-computer-launcher={computerStageAvailable() && !computerStageHistorical() && !computerStageOpen() ? 'true' : undefined}
          aria-hidden={companionCollapsed() ? 'true' : undefined}
          inert={companionCollapsed()}
          onPointerDown={transcriptScroll.onPointerDown}
          onContextMenu={openTranscriptMenu}
          onKeyDown={(event) => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openTranscriptMenu(event);
            if (!event.defaultPrevented) transcriptScroll.onKeyDown(event);
          }}
          tabIndex={0}
          data-flower-tail-preparing={selectedThreadTailPreparing() ? 'true' : undefined}
          aria-busy={selectedThreadTailPreparing() ? 'true' : undefined}
          onScroll={updateTranscriptNearBottom}
          onWheel={(event) => {
            if (transcriptMenu()) closeTranscriptMenu();
            transcriptScroll.onWheel(event);
          }}
          onTouchMove={(event) => {
            if (transcriptMenu()) closeTranscriptMenu();
            transcriptScroll.onTouchMove(event);
          }}
        >
          <div class="flower-transcript-stack" inert={selectedThreadTailPreparing()}>
            <Show when={livePresentationConfirmed() && selectedThreadTerminalSyncing() && !threadLoadError()}>
              {threadSyncingLatestState()}
            </Show>
            <Show
              when={selectedThreadHasContent() || selectedThreadHasLiveProgress() || visibleTransportOutbox().length > 0}
              fallback={selectedThreadFallbackState()}
            >
              {historyNavigation('before')}
              <FlowerTurnTimeline thread={selectedThread()} entries={visibleTimelineEntries()}
                failureNoticeVisible={runErrorNoticeVisible(selectedThread())}
                runtimeID={props.adapter.runtime.runtime_id} scope="main" choices={turnDisclosureChoices}
                scroll={transcriptScroll} reducedMotion={reducedMotionPreferred} liveConfirmed={livePresentationConfirmed} copy={copy().chat.turnProcess}
                renderEntry={(entry, visible) => timelineEntry(entry, transcriptScroll, selectedThread, selectedThreadMedia, visible)} />
              {historyNavigation('after')}
              {threadLevelApprovalPanel()}
            </Show>
            <Show when={parentEventReading.recovering()}>
              <div class="flower-parent-event-reading" role="alert">
                <span>{parentEventReading.timedOut() ? subagentsCopy().events.readTimeout : subagentsCopy().events.readFailed}</span>
                <Show when={props.adapter.readParentEvents} fallback={<button type="button" class="flower-parent-event-action" onClick={retrySelectedThreadDetail}>{copy().chat.handlerRetry}</button>}>
                  <button type="button" class="flower-parent-event-action" disabled={parentEventReading.busy()} aria-busy={parentEventReading.busy()} onClick={() => void parentEventReading.retry()}>{subagentsCopy().detailRetry}</button>
                </Show>
              </div>
            </Show>
            <Show when={parentEventReading.cursor() && props.adapter.readParentEvents}>
              <button type="button" class="flower-parent-event-action" disabled={parentEventReading.busy() || parentEventReading.failed()} aria-busy={parentEventReading.busy()}
                onClick={() => void parentEventReading.more()}>{subagentsCopy().events.more}</button>
            </Show>
          </div>
        </div>
        <Show when={selectedThreadTailPreparing()}>
          <div class="flower-thread-preparing">{threadLoadingState()}</div>
        </Show>
        </div>
        <Show when={props.embeddedConversation}>{progressLane(true)}</Show>
        <Show when={!props.embeddedConversation}>{composerPanel()}</Show>
      </div>
    </div>
  );

  const ThreadRail = createRetainedContent(() => (
      <aside class="flower-component-thread-rail" aria-label={copy().chat.conversationsAria}
        inert={settingsDialogPresent() || (navigationOverlay() && !threadNavigationOpen())}
        aria-hidden={settingsDialogPresent() || (navigationOverlay() && !threadNavigationOpen()) ? 'true' : undefined}>
        <div class="flower-mobile-drawer-handle" aria-hidden="true" />
        <div class="flower-sidebar-actions">
          <h2 class="flower-mobile-drawer-title">{copy().chat.conversationsAria}</h2>
          <button
            data-floe-autofocus={mobileNavigation() ? "" : undefined}
            type="button"
            class="flower-mobile-navigation-button flower-header-icon-button"
            aria-label={copy().settings.backToChat}
            title={copy().settings.backToChat}
            onClick={() => {
              setThreadNavigationOpen(false);
            }}
          >
            <ChevronDown class="h-4 w-4" />
          </button>
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
          <Show when={props.adapter.extensions}>
            <button type="button" class="flower-sidebar-extensions-button" aria-current={sidePanel() === 'extensions' ? 'page' : undefined}
              onClick={() => { setExtensionsOpened(true); setSidePanel('extensions'); setThreadNavigationOpen(false); }}>
              <Zap class="h-4 w-4 shrink-0" aria-hidden="true" /><span>{copy().extensions.t('title')}</span><ChevronRight class="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </Show>
        </div>
        <FlowerThreadList
          items={sidebarListItems()}
          activeThreadID={pendingThreadSelection() || (sidePanel() === 'chat' ? selectedThreadID() : '')}
          query={historyFilter()}
          refreshing={threadsRefreshing()}
          loading={threadListState() === 'loading'}
          error={threadListError()}
          errorTitle={copy().chat.loadErrorTitle}
          errorRetryLabel={copy().threadList.refreshLabel}
          warmup={surfaceWarmupActive()}
          copy={copy().threadList}
          onQueryChange={setHistoryFilter}
          onRefresh={() => void refreshThreads()}
          onSelect={selectThread}
          referenceDisabledReason={threadReferenceDisabledReason()}
          canFork={!!props.adapter.forkThread}
          canRename={!!props.adapter.renameThread}
          canPin={!!props.adapter.setThreadPinned}
          onMovePinned={props.adapter.movePinnedThread ? movePinnedThread : undefined}
          showStopAction
          showDeleteAction={typeof props.adapter.deleteThread === 'function'}
          busyThreadID={threadActionBusy()?.threadID}
          busyAction={threadActionBusy()?.action}
          actionsBusy={threadActionBusy() !== null}
          directoryActions={directoryMenuAvailability()}
          visible={surfaceEngaged() && transcriptVisible()}
          onMenuAction={(action, item, restore) => void handleThreadMenuAction(action, item, restore)}
        />
      </aside>
  ));

  const settingsReadNotice = () => (
    <Show when={!settingsReady()}>
      <div class="flower-settings-read-status" role={settingsError() ? 'alert' : 'status'} aria-busy={settingsLoading()}>
        <span>{settingsError() || copy().chat.loadingSettings}</span>
        <Show when={settingsError()}>
          <Button size="sm" variant="ghost" icon={Refresh} disabled={settingsLoading()} onClick={() => void refreshSettingsForRevision().catch(() => undefined)}>{copy().chat.handlerRetry}</Button>
        </Show>
      </div>
    </Show>
  );

  const SettingsContent = createRetainedContent(() => (
    <div class="min-h-0" data-flower-panel="settings" hidden={!settingsDialogPresent() && sidePanel() !== 'settings'}
      inert={!settingsDialogPresent()} aria-hidden={!settingsDialogPresent()}>
      <Show when={settingsOpened()}>
        {settingsReadNotice()}
        <Suspense fallback={<div class="p-4 flower-body-copy text-muted-foreground" role="status">{copy().chat.loadingSettings}</div>}>
          <div inert={!settingsReady() || surfaceReadOnly()} aria-busy={settingsLoading()}>
          <FlowerSettingsSurface
            onDiscoverModels={props.adapter.discoverProviderModels}
            chatGPTAuth={props.adapter.chatGPTAuth ? accountAction : undefined}
            loadChatGPTAccounts={props.adapter.loadChatGPTAccounts}
            snapshot={snapshot()}
            providerFocusRequest={providerFocusRequest()}
            onProviderRecoveryFinished={() => {
              if (providerFocusRequest()?.threadID === trimString(selectedThreadID())) returnToChat();
              setProviderFocusRequest(undefined);
            }}
            copy={copy().settings}
            onSaveDefaultPermission={saveDefaultPermission}
            onSaveComputerUseEnabled={props.adapter.saveComputerUseEnabled ? saveComputerUseEnabled : undefined}
            onSaveAutoUpdateModelCatalog={props.adapter.saveAutoUpdateModelCatalog ? saveAutoUpdateModelCatalog : undefined}
            computerCopy={copy().computer}
            onOpenComputerSettings={props.adapter.computerManagement ? () => { returnToChat(); setComputerDialog('settings'); } : undefined}
            onSaveModelProfile={saveModelProfile}
            saveError={saveError()}
            savedAt={savedAt()}
            saving={settingsSaving()}
            dialog
            headerTrailingActions={sidePanel() === 'settings' ? props.headerTrailingActions : undefined}
          />
          </div>
        </Suspense>
      </Show>
    </div>
  ));

  const guardConversationNavigation = (element: HTMLElement) => {
    // Native inert on the transcript restyles its entire history before the
    // rail can paint. Block old interactions at this fixed boundary instead.
    const events = ['click', 'dblclick', 'contextmenu', 'pointerdown', 'mousedown', 'keydown', 'beforeinput', 'input', 'submit', 'dragstart', 'drop', 'paste', 'cut'];
    const guard = (event: Event) => {
      if (!untrack(pendingThreadSelection)) return;
      if (event instanceof KeyboardEvent && event.key === 'Tab') {
        const threadID = untrack(pendingThreadSelection);
        const rows = surfaceRef?.querySelectorAll<HTMLElement>('[data-flower-thread-card]');
        const row = Array.from(rows ?? []).find(candidate => candidate.dataset.threadId === threadID);
        row?.querySelector<HTMLElement>('.flower-thread-card-select-button')?.focus({ preventScroll: true });
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const type of events) element.addEventListener(type, guard, true);
    onCleanup(() => { for (const type of events) element.removeEventListener(type, guard, true); });
  };
  const conversationPanel = () => (
      <section ref={guardConversationNavigation} class="flower-component-main"
        inert={threadDrawerPresent() || settingsDialogPresent()}
        aria-hidden={threadDrawerPresent() || settingsDialogPresent() ? 'true' : undefined}>
        <div class="h-full min-h-0" data-flower-panel="chat" hidden={visiblePanel() !== 'chat'}
          aria-hidden={visiblePanel() !== 'chat'} inert={visiblePanel() !== 'chat'}>
          {chatPanel()}
        </div>
        <div class="h-full min-h-0" data-flower-panel="extensions" hidden={visiblePanel() !== 'extensions'}
          aria-hidden={visiblePanel() !== 'extensions'} inert={visiblePanel() !== 'extensions'}>
          <Show when={extensionsOpened() && props.adapter.extensions}>{adapter => <Suspense fallback={<div class="p-6" role="status">{copy().extensions.t('loading')}</div>}>
            <FlowerExtensionsSurface adapter={adapter()} i18n={copy().extensions} onBack={returnToChat}
              headerTrailingActions={visiblePanel() === 'extensions' ? props.headerTrailingActions : undefined} />
          </Suspense>}</Show>
        </div>
      </section>
  );

  return (
    <main
      id="redeven-flower-surface"
      ref={(node) => {
        surfaceRef = node;
        setSurfaceElement(node);
        setComputerStageBoundary(node);
      }}
      tabIndex={-1}
      class={cn(
        'flower-component-shell flower-surface',
        presentation() === 'companion' && 'flower-surface-companion',
        companionCollapsed() && 'flower-surface-companion-collapsed',
        props.embeddedConversation && 'flower-surface-embedded',
        props.class,
      )}
      data-floe-dialog-surface-host={navigationOverlay() ? "true" : undefined}
      data-floe-surface-portal-layer={navigationOverlay() ? "true" : undefined}
      data-flower-presentation={presentation()}
      data-flower-interaction-mode={mobileInteraction() ? 'mobile' : 'desktop'}
      data-flower-sidebar-presentation={navigationOverlay() ? 'overlay' : 'inline'}
      data-flower-mobile-pane={mobileNavigation() ? (mobileThreadsOpen() ? 'threads' : 'detail') : undefined}
      data-flower-companion-open={presentation() === 'companion' ? (!companionCollapsed() ? 'true' : 'false') : undefined}
      data-flower-engaged={surfaceEngaged() ? 'true' : 'false'}
      data-flower-transcript-visible={transcriptVisible() ? 'true' : 'false'}
      data-flower-selected-thread-id={selectedThreadID()}
      data-flower-pending-thread-id={pendingThreadSelection() || undefined}
      data-flower-selected-thread-status={selectedThreadLiveStatus()}
      data-flower-selected-thread-loading={selectedThreadLoading() ? 'true' : 'false'}
      data-flower-warmup={surfaceWarmupActive() ? 'true' : 'false'}
      data-flower-side-panel={sidePanel()}
      style={{
        'grid-template-columns': presentation() === 'full' && !navigationOverlay() && !props.embeddedConversation ? `${threadRailWidth()}px 0 minmax(0, 1fr)` : undefined,
        '--flower-thread-drawer-width': navigationOverlay() && !mobileNavigation() ? `${threadRailWidth()}px` : undefined,
      }}
    >
      <Show when={!initialConversationPending()} fallback={warmupPanel(true)}>
      <Show when={!settingsDialogPresent()}><div hidden inert aria-hidden="true"><SettingsContent /></div></Show>
      <DialogPlacementProvider mode="global">
        <Dialog open={sidePanel() === 'settings' && !companionCollapsed() && surfaceEngaged()}
          onOpenChange={open => { if (!open) returnToChat(); }}
          onPresenceChange={present => {
            setSettingsDialogPresent(present);
            if (!present) queueMicrotask(() => {
              if (sidePanel() === 'settings' || !surfaceEngaged() || companionCollapsed()) return;
              if (document.activeElement === document.body || document.activeElement === surfaceRef) settingsRestoreFocus?.focus({ preventScroll: true });
            });
          }}
          presentation="dialog"
          title={copy().settings.title}
          closeLabel={copy().computer.close}
          bodyDescription={copy().settings.description}
          escapeKeyPhase="bubble"
          onKeyDown={event => {
            if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            returnToChat();
          }}
          class="flower-settings-dialog"
          contentClass="flower-settings-dialog-content">
          <SettingsContent />
        </Dialog>
      </DialogPlacementProvider>
      <Show when={!props.embeddedConversation}><Show when={navigationOverlay()} fallback={<ThreadRail />}>
        <DialogPlacementProvider mode="auto">
          <Dialog open={threadDrawerOpen() && surfaceEngaged()}
            onOpenChange={setThreadNavigationOpen}
            onPresenceChange={(present) => {
              const wasPresent = untrack(threadDrawerPresent);
              setThreadDrawerPresent(present);
              if (wasPresent && !present) {
                queueMicrotask(() => {
                  if (!navigationOverlay() || !surfaceEngaged()) return;
                  const active = document.activeElement;
                  if (!active || active === document.body || active === surfaceRef) mobileThreadsTrigger?.focus({ preventScroll: true });
                });
              }
            }}
            title={copy().chat.conversationsAria}
            header={mobileNavigation() ? null : undefined}
            presentation={mobileNavigation() ? 'bottom-drawer' : 'side-drawer'} drawerSide="left" escapeKeyPhase="bubble"
            class={mobileNavigation() ? 'flower-mobile-thread-drawer' : 'flower-desktop-thread-drawer'} contentClass="flex min-h-0 flex-col overflow-hidden p-0">
            <ThreadRail />
          </Dialog>
        </DialogPlacementProvider>
      </Show>
      </Show>
      <Show when={transcriptMenu()}>
        {(menu) => (
          <FlowerContextMenu
            x={menu().x}
            y={menu().y}
            label={copy().threadList.contextMenuLabel(menu().title)}
            height={220}
            resolveRestore={() => menu().restore}
            onClose={closeTranscriptMenu}
          >
            <Show when={props.adapter.manageGoal && props.adapter.canMutate !== false && !selectedThreadReadOnly()}>
              <button type="button" role="menuitem" class="flower-thread-menu-item" title={copy().chat.commandGoal} onClick={() => { setTranscriptMenu(null); enterGoalCommand(); }}>
                <FlowerGoalIcon class="h-3.5 w-3.5" strokeWidth={1.65} aria-hidden="true" /><span>/goal</span>
              </button>
            </Show>
            <Show when={menu().selection}>
              <button type="button" role="menuitem" class="flower-thread-menu-item" onClick={() => {
                const state = menu();
                setTranscriptMenu(null);
                void writeTextToClipboard(state.selection)
                  .catch((error) => notifyThreadActionError(getErrorMessage(error)))
                  .finally(() => restoreThreadMenuFocus(state.restore));
              }}>
                <Copy class="h-3.5 w-3.5" />
                <span>{copy().threadList.copySelectedText}</span>
              </button>
            </Show>
            <Show when={menu().target}>
              {(target) => (
                <FlowerDirectoryMenuItems
                  path={target().path}
                  copy={copy().threadList}
                  availability={directoryMenuAvailability()}
                  onAction={(action) => {
                    const state = menu();
                    const request = target();
                    setTranscriptMenu(null);
                    void handleDirectoryMenuAction(action, request, state.restore);
                  }}
                />
              )}
            </Show>
          </FlowerContextMenu>
        )}
      </Show>
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
      <Show when={renameTarget()?.placement === 'dialog'}>
        <div class="flower-rename-backdrop" role="presentation" onMouseDown={closeRename}>
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
                closeRename();
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
                  if (event.key === 'Enter' && !event.isComposing) {
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
              <button type="button" class="flower-rename-secondary" disabled={renameSaving()} onClick={closeRename}>{copy().threadList.cancel}</button>
              <button
                type="button"
                class="flower-rename-primary"
                disabled={renameSaving() || renameUnchanged()}
                onClick={() => void submitRename()}
              >
                <StableText reserve={[copy().threadList.saving, copy().threadList.save]}>{renameSaving() ? copy().threadList.saving : copy().threadList.save}</StableText>
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
        onPointerDown={threadRailResize.start}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            threadRailResize.nudge(-16);
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            threadRailResize.nudge(16);
          }
        }}
      >
        <GripVertical class="h-3.5 w-3.5" />
      </button>
      <Show when={props.embeddedConversation} fallback={conversationPanel()}>
        {embedded => embedded().render({ conversation: conversationPanel(), composer: composerPanel(), actionLayout: bottomActionMode, actions: conversationHeaderActions,
          actionOverlays: subagentDropdown(), get trailingActions() { return props.headerTrailingActions; },
          threadID: selectedThreadID, newConversation: startCompose })}
      </Show>
      <FlowerWorkingDirPickerDialog
        open={workingDirectoryPickerOpen() && canPickWorkingDirectory()}
        onOpenChange={(open) => {
          if (!open) setWorkingDirectoryPickerOpen(false);
        }}
        scopeKey={filesystemScopeKey()}
        scrollViewportProps={props.filesystemScrollViewportProps}
        initialPath={draftWorkingDirectory() || undefined}
        directoryFavorites={props.adapter.directoryFavorites?.(() => copy().filesystemPicker.favoritesLoadFailed)}
        suggestedPaths={recentWorkingDirectories()}
        suggestedPathsLabel={copy().chat.workingDirPickerRecent}
        loadPathContext={async () => {
          if (!props.adapter.getWorkingDirectoryPathContext) throw new Error('Filesystem context unavailable');
          return mapFilesystemPickerContext(await props.adapter.getWorkingDirectoryPathContext(), () => copy().filesystemPicker);
        }}
        loadDirectory={async (path, options) => {
          if (!props.adapter.listWorkingDirectoryEntries) throw new Error('Filesystem connection unavailable');
          return mapFilesystemPickerEntries(await props.adapter.listWorkingDirectoryEntries({ path, showHidden: options.showHidden }));
        }}
        copy={copy().filesystemPicker}
        formatError={(error) => formatFilesystemPickerError(error, copy().filesystemPicker)}
        title={copy().chat.workingDirPickerTitle}
        class="flower-working-dir-picker"
        confirmText={copy().chat.workingDirPickerConfirm}
        onSelect={(selectedPath) => {
          if (!canPickWorkingDirectory()) return;
          const realPath = selectedPath;
          if (!realPath) return;
          const sessionKey = currentComposerSessionKey();
          const adapter = props.adapter;
          updateComposerSessionDraft(sessionKey, draft => ({ ...draft, workingDirDraft: realPath }));
          setWorkingDirectoryPickerOpen(false);
          void rememberConversationPreference(adapter, { working_dir: realPath }).then(preferences => {
            if (!preferences || !preferenceAdapterCurrent(adapter)) return;
            updateComposerSessionDraft(sessionKey, draft => draft.workingDirDraft === realPath
              ? { ...draft, workingDirDraft: preferences.working_dir } : draft);
          }).catch(error => {
            if (preferenceAdapterCurrent(adapter)) notifyConversationPreferenceError(modelErrorMessage(error));
          });
        }}
      />
      <Show when={computerStageAvailable() && selectedComputerStage()}>
        {(stage) => {
          return (
            <FlowerComputerStage
              snapshot={stage()}
              revealLabel={copy().computer.reveal}
              onReveal={props.adapter.canMutate !== false && props.adapter.computerManagement?.revealTarget && stage().item.chips?.some(chip => chip.kind === 'browser_source' && chip.value === 'browser.connected') ? () => {
                void props.adapter.computerManagement!.revealTarget!(selectedThreadID(), stage().targetID!).catch(() => notifyComposerError(copy().computer.revealFailed));
              } : undefined}
              historical={computerStageHistorical()}
              frame={computerStageFrame()}
              retainLiveFrame={!computerViewerKey()}
              loading={Boolean(computerViewerKey()) && !computerViewFailed()}
              blocked={Boolean((computerViewerAssistance() || isComputerInput(selectedInputRequest())) && !privateControlRequested())}
              emptyMessage={computerViewerAssistance() && !privateControlRequested() ? computerAssistance(undefined, copy().computer, { kind: computerViewerAssistance()! }).title : computerViewFailed() ? copy().computer.frameDisconnected : computerViewerKey() ? copy().computer.frameConnecting : copy().computer.noFrame}
              staleLabel={!computerViewerKey() && !privateControlRequested() ? copy().computer.frameStale : undefined}
              privateInteractionID={privateControlRequested() ? selectedInputRequest()?.prompt_id : undefined}
              frameRate={viewerFPS()} receivedFrameRate={receivedComputerFPS()} onFrameRateChange={changeComputerFrameRate}
              onFrameReady={(frame) => {
                const privateFrame = frame.private_frame;
                if (computerStageOpen() && privateControlRequested() && !computerControlDisconnected() && !computerViewFailed()
                  && privateFrame?.observer_id === computerObserverID() && privateFrame?.viewer_revision === activeComputerViewerRevision()
                  && privateFrame?.interaction_id === selectedInputRequest()?.prompt_id) setComputerControlReady(true);
              }}
              onFrameError={() => setComputerViewFailed(true)} onRetry={resumeComputerViewer}
              onInput={!computerStageHistorical() && !computerControlDisconnected() && computerStageOpen() && computerControlReady() && privateControlRequested() && !computerResponseSubmitting() && !computerControlError() && !computerViewFailed() && isComputerInput(selectedInputRequest()) ? inputComputerControl : undefined}
              boundary={computerStageBoundary()}
              launcherBoundary={computerLauncherBoundary()}
              threadID={selectedThreadID()}
              open={computerStageOpen()}
              sessionState={computerStageSessionState()}
              restoreFocus={computerStageRestoreFocus()}
              onRestore={restoreComputerStage}
              loadFrame={props.adapter.loadComputerFrame}
              copy={{
                title: computerStageHistorical() ? copy().chat.computerStageStatus.historical : copy().chat.computerStageTitle,
                resumeControl: copy().chat.computerResumeControl,
                frameRate: copy().chat.computerFrameRate,
                frameRateHint: copy().chat.computerFrameRateHint,
                receivedFrameRate: copy().chat.computerReceivedFrameRate,
                // Closing the Stage only hides the panel; it must never read
                // like the destructive Stop action.
                close: copy().chat.computerStageClose,
                maximize: copy().chat.computerStageMaximize,
                restoreSize: copy().chat.computerStageRestoreSize,
                zoomIn: copy().chat.computerStageZoomIn,
                zoomOut: copy().chat.computerStageZoomOut,
                restore: copy().chat.computerStageRestore,
                state: copy().chat.computerStageStatus,
                move: copy().chat.computerStageMove,
                noFrame: copy().computer.noFrame,
                loading: copy().computer.frameLoading,
                retry: copy().chat.handlerRetry,
              }}
              onClose={() => { setComputerStageOpen(false); }}
            />
          );
        }}
      </Show>
      </Show>
    </main>
  );
};
