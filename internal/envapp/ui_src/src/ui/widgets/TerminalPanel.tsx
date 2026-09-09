import { For, Index, Show, batch, createEffect, createMemo, createSignal, createUniqueId, onCleanup } from 'solid-js';
import { createUIFirstSelection, deferAfterPaint, isMacLikePlatform, matchKeybind, useCurrentWidgetId, useLayout, useNotification, useResolvedFloeConfig, useTheme, useViewActivation } from '@floegence/floe-webapp-core';
import { BugIcon, Copy, Download, Folder, FolderPlus, Link, Menu, Pencil, Refresh, Terminal, Trash, X } from '@floegence/floe-webapp-core/icons';

import {
  Button,
  Dropdown,
  MobileKeyboard,
  TabPanel,
  type DropdownItem,
} from '@floegence/floe-webapp-core/ui';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { FlowerContextMenuIcon } from '../icons/FlowerSoftAuraIcon';
import { useRedevenRpc } from '../protocol/redeven_v1';
import {
  getThemeColors,
  isTerminalThemeName,
  normalizeTerminalExecutionContextInfo,
  normalizeTerminalWorkStateInfo,
  type Logger,
  type TerminalExecutionContextInfo,
  type TerminalOutputActivityInfo,
  type TerminalSessionInfo as FloetermTerminalSessionInfo,
  type TerminalThemeName,
  type TerminalWorkStateInfo,
} from '@floegence/floeterm-terminal-web';
import type { TerminalGroup, TerminalSessionInfo } from '../protocol/redeven_v1/sdk/terminal';
import {
  createRedevenTerminalLiveBundle,
  createTerminalConnId,
  type RedevenTerminalTransport,
} from '../services/terminalTransport';
import { disposeRedevenTerminalSessionsCoordinator, getRedevenTerminalSessionsCoordinator } from '../services/terminalSessions';
import { useTerminalSessionCatalog } from '../services/terminalSessionCatalog';
import {
  deriveTerminalSessionChrome,
  TERMINAL_AGENT_INITIALIZATION_SPINNER_MS,
  TERMINAL_REMOTE_OPENING_SPINNER_MS,
  type TerminalSessionChrome,
  type TerminalSessionChromeTransition,
} from '../services/terminalSessionChrome';
import {
  ensureTerminalPreferencesInitialized,
  resolveTerminalUserTheme,
  TERMINAL_MAX_FONT_SIZE,
  TERMINAL_MIN_FONT_SIZE,
  type TerminalMobileInputMode,
  useTerminalPreferences,
} from '../services/terminalPreferences';
import {
  normalizeTerminalFontFamilyId,
  normalizeTerminalFontSize,
  type TerminalGeometryPreferences,
} from '../services/terminalGeometry';
import {
  applyTerminalMobileKeyboardPayload,
  buildTerminalMobileKeyboardSuggestions,
  createEmptyTerminalMobileKeyboardDraftState,
  deriveTerminalMobileKeyboardContext,
  parseTerminalMobileKeyboardScripts,
  rememberTerminalMobileKeyboardHistory,
  resolveTerminalMobileKeyboardPackageJsonPath,
  type TerminalMobileKeyboardPathEntry,
  type TerminalMobileKeyboardScript,
  type TerminalMobileKeyboardSuggestion,
  TERMINAL_MOBILE_KEYBOARD_QUICK_INSERTS,
} from '../services/terminalMobileKeyboard';
import { useEnvContext } from '../pages/EnvContext';
import { canLaunchProcess, isPermissionDeniedError } from '../utils/permission';
import { createClientId } from '../utils/clientId';
import { sortContextActionMenuItems } from '../contextActions/menu';
import { PermissionEmptyState } from './PermissionEmptyState';
import { attachAskFlowerContextAction, type EnvFlowerTurnLauncherContextItem } from '../contextActions/askFlower';
import { basenameFromAbsolutePath, normalizeAbsolutePath as normalizeAskFlowerAbsolutePath } from '../utils/askFlowerPath';
import { canonicalAbsolutePath } from '../utils/canonicalAbsolutePath';
import { resolveTerminalSurfaceTouchAction } from '../mobileViewportPolicy';
import { TerminalSettingsDialog } from './TerminalSettingsDialog';
import { createResolvedTerminalFont } from '../services/terminalFonts';
import { TerminalFontStatus } from './TerminalFontStatus';
import { resolveTerminalMobileKeyboardInsetPx } from './terminalMobileKeyboardInset';
import { useFilePreviewContext } from './FilePreviewContext';
import { fileItemFromPath } from '../utils/filePreviewItem';
import { writeTextToClipboard } from '../utils/clipboard';
import {
  desktopShellExternalURLOpenAvailable,
  openExternalURLInDesktopShell,
} from '../services/desktopShellBridge';
import { readUIStorageJSON, writeUIStorageJSON } from '../services/uiStorage';
import type { TerminalResolvedLinkTarget } from '../services/terminalLinkProvider';
import type { TerminalShellIntegrationEvent } from '../services/terminalShellIntegration';
import {
  createTerminalTabActivityTracker,
  shouldMarkTerminalSessionUnread,
  type TerminalSessionWorkState,
  type TerminalTabVisualState,
} from '../services/terminalTabActivity';
import {
  createTerminalForegroundPresentationScheduler,
  normalizeTerminalForegroundCommand,
  type TerminalForegroundPresentation,
} from '../services/terminalForegroundPresentation';
import {
  FloatingContextMenu,
  type FloatingContextMenuDismissReason,
  type FloatingContextMenuItem,
} from './FloatingContextMenu';
import { useI18n } from '../i18n';
import { Tooltip } from '../primitives/Tooltip';
import { createUIPresentationEventRecorder } from '../services/uiPresentationTransactions';
import {
  markTerminalPerformance,
  pseudonymousTerminalSessionRef,
} from '../services/terminalPerformance';
import {
  TerminalSessionRuntime,
  type TerminalSessionRuntimeActions,
  type TerminalSessionRuntimeStatus,
} from './TerminalSessionRuntime';
import type {
  SemanticTerminalAppearance,
  SemanticTerminalTouchScrollRuntime,
  SemanticTerminalViewportHandle,
} from './semanticTerminalViewport';
import {
  TerminalSessionNavigator,
  TerminalSessionChromeIcon,
  TerminalSessionTransitionBadge,
  TerminalOutputStatusGlyph,
  describeTerminalSessionNavigationItem,
  joinTerminalStatusAnnouncements,
  terminalStatusSentence,
  type TerminalSessionAttentionState,
  type TerminalSessionNavigationItem,
  type TerminalSessionNavigationGroup,
  type TerminalSessionTransitionIndicator,
} from './TerminalSessionNavigator';
import { TerminalGroupDeleteDialog, TerminalGroupEditorDialog } from './TerminalGroupDialogs';
import { TerminalSearchOverlay } from './TerminalSearchOverlay';
import { TerminalSharedGeometryNotice } from './TerminalSharedGeometryNotice';
import type { TerminalSharedGeometryPresentation } from './terminalSharedGeometryPresentation';
import { REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR } from '../workbench/surface/workbenchInputRouting';
import { useEnvFilesystemPicker } from '../services/filesystemPicker';

type pending_terminal_session_status = 'creating' | 'failed';

export type TerminalPanelVariant = 'panel' | 'workbench';

const TERMINAL_WORK_INDICATOR_BASE_THICKNESS_PX = 3.5;
const TERMINAL_TAB_SHORTCUT_MAX_INDEX = 8;

export type TerminalPanelSessionPlacementState = Readonly<{
  sessionIds: string[];
  activeSessionId: string | null;
}>;

export type TerminalPanelSessionCreateResult = TerminalSessionInfo | string | null;

export type TerminalPanelSessionOperations = Readonly<{
  createSession: (name: string | undefined, workingDir: string, groupId: string) => Promise<TerminalPanelSessionCreateResult>;
  deleteSession: (sessionId: string) => Promise<void>;
}>;

export type TerminalPanelGeometryPreferences = TerminalGeometryPreferences & Readonly<{
  onFontSizeChange: (value: number) => void | Promise<void>;
  onFontFamilyChange: (id: string) => void | Promise<void>;
}>;

type ShellTerminalTokenName =
  | '--terminal-background'
  | '--terminal-foreground'
  | '--selection-bg'
  | '--selection-fg';

function readShellTerminalToken(
  tokenName: ShellTerminalTokenName,
  presetTokens?: Readonly<Record<string, string>>,
): string | undefined {
  const presetValue = presetTokens?.[tokenName]?.trim();
  if (presetValue) return presetValue;
  if (typeof document === 'undefined') return undefined;
  const computedValue = getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim();
  return computedValue || undefined;
}

export function resolveSystemTerminalThemeColors(
  baseColors: Readonly<Record<string, string>>,
  presetTokens?: Readonly<Record<string, string>>,
): Record<string, string> {
  const background = readShellTerminalToken('--terminal-background', presetTokens) ?? baseColors.background;
  const foreground = readShellTerminalToken('--terminal-foreground', presetTokens) ?? baseColors.foreground;
  const selectionBackground = readShellTerminalToken('--selection-bg', presetTokens)
    ?? baseColors.selectionBackground
    ?? baseColors.selection;
  const selectionForeground = readShellTerminalToken('--selection-fg', presetTokens)
    ?? baseColors.selectionForeground;

  return {
    ...baseColors,
    ...(background ? { background, cursorAccent: background } : {}),
    ...(foreground ? { foreground, cursor: foreground } : {}),
    ...(selectionBackground ? { selectionBackground } : {}),
    ...(selectionForeground ? { selectionForeground } : {}),
  };
}

export interface TerminalPanelProps {
  variant?: TerminalPanelVariant;
  openSessionRequest?: {
    requestId: string;
    workingDir: string;
    preferredName?: string;
    targetMode?: 'activity' | 'workbench';
  } | null;
  onOpenSessionRequestHandled?: (requestId: string) => void;
  sessionPlacementState?: TerminalPanelSessionPlacementState;
  onSessionPlacementStateChange?: (next: TerminalPanelSessionPlacementState) => void;
  sessionOperations?: TerminalPanelSessionOperations;
  terminalGeometryPreferences?: TerminalPanelGeometryPreferences;
  workbenchSelected?: boolean;
  workbenchActivationSeq?: number;
  onWorkbenchTerminalViewportChange?: (
    sessionId: string,
    viewport: SemanticTerminalViewportHandle | null,
  ) => void;
  onWorkbenchTerminalSurfaceChange?: (sessionId: string, surface: HTMLDivElement | null) => void;
  onTitleChange?: (title: string) => void;
}

type TerminalPanelInnerProps = TerminalPanelProps & {
  onExecuteDenied?: () => void;
};

function buildActiveSessionStorageKey(panelId: string): string {
  return `redeven_terminal_active_session_id:${panelId}`;
}

function buildCollapsedTerminalGroupsStorageKey(envId: string, panelId: string): string {
  return `redeven_terminal_collapsed_groups:${String(envId ?? '').trim()}:${panelId}`;
}

function readCollapsedTerminalGroupIds(storageKey: string): ReadonlySet<string> {
  const parsed = readUIStorageJSON<unknown>(storageKey, []);
  return new Set(Array.isArray(parsed) ? parsed.map((value) => String(value).trim()).filter(Boolean) : []);
}

function writeCollapsedTerminalGroupIds(storageKey: string, groupIds: ReadonlySet<string>) {
  writeUIStorageJSON(storageKey, [...groupIds]);
}

export function expandTerminalGroupInCollapsedSet(
  collapsedGroupIds: ReadonlySet<string>,
  groupId: string,
): ReadonlySet<string> {
  if (!collapsedGroupIds.has(groupId)) return collapsedGroupIds;
  const next = new Set(collapsedGroupIds);
  next.delete(groupId);
  return next;
}

function readActiveSessionId(storageKey: string): string | null {
  try {
    const v = sessionStorage.getItem(storageKey);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function writeActiveSessionId(storageKey: string, id: string | null) {
  try {
    if (id && id.trim()) {
      sessionStorage.setItem(storageKey, id.trim());
      return;
    }
    sessionStorage.removeItem(storageKey);
  } catch {
  }
}

function sameSessionIdList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function sameTerminalPanelSessionPlacementState(
  left: TerminalPanelSessionPlacementState,
  right: TerminalPanelSessionPlacementState,
): boolean {
  return left.activeSessionId === right.activeSessionId
    && sameSessionIdList(left.sessionIds, right.sessionIds);
}

function pickPreferredActiveId(list: TerminalSessionInfo[], preferredId: string | null): string | null {
  if (preferredId && list.some((s) => s.id === preferredId)) return preferredId;
  const active = list.find((s) => s.isActive);
  if (active) return active.id;
  const byLastActive = [...list].sort((a, b) => (b.lastActiveAtMs ?? 0) - (a.lastActiveAtMs ?? 0));
  return byLastActive[0]?.id ?? null;
}

function resolveRequestedSessionName(
  preferredName: string | undefined,
  workingDir: string,
  fallbackName: string,
): string {
  const normalizedPreferredName = String(preferredName ?? '').trim();
  if (normalizedPreferredName) return normalizedPreferredName;

  const normalizedWorkingDir = String(workingDir ?? '').trim();
  if (normalizedWorkingDir && normalizedWorkingDir !== '/') {
    const parts = normalizedWorkingDir.split('/').filter(Boolean);
    const basename = parts[parts.length - 1] ?? '';
    if (basename) return basename;
  }

  return fallbackName.trim() || 'Terminal';
}

function buildLogger(): Logger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

const MAX_INLINE_TERMINAL_CONTEXT_CHARS = 10_000;

const TERMINAL_INPUT_SELECTOR = 'textarea[aria-label="Terminal input"], textarea';
const MOBILE_TERMINAL_TOUCH_SCROLL_LINE_HEIGHT_FALLBACK_PX = 20;
const MOBILE_TERMINAL_TOUCH_SCROLL_MIN_LINE_HEIGHT_PX = 12;
type TerminalSessionTabVisualStateMap = Record<string, TerminalTabVisualState>;

type pending_terminal_session = {
  id: string;
  operationSequence: number;
  createdAtMs: number;
  name: string;
  workingDir: string;
  groupId: string;
  visibleSessionIdsAtCreate: string[];
  status: pending_terminal_session_status;
  errorMessage?: string;
};

type terminal_creation_transition = {
  pendingSessionId: string;
  sessionId: string;
  phase: 'creating' | 'attaching';
};

type resolved_pending_terminal_session = {
  pendingSessionId: string;
  sessionId: string;
  session: TerminalSessionInfo;
};

type terminal_session_avatar_tone = Readonly<{
  background: string;
  border: string;
  foreground: string;
}>;

type terminal_sidebar_context_menu = Readonly<{
  kind: 'session';
  x: number;
  y: number;
  sessionId: string;
  triggerElement: HTMLElement | null;
}> | Readonly<{
  kind: 'group';
  x: number;
  y: number;
  groupId: string;
  triggerElement: HTMLElement | null;
}> | Readonly<{
  kind: 'tree';
  x: number;
  y: number;
  triggerElement: HTMLElement | null;
}> | null;

type terminal_panel_created_session = {
  sessionId: string;
  session: TerminalSessionInfo | null;
};

type terminal_session_mutation_fence = Readonly<{
  envId: string;
  connectionEpoch: number;
  protocolClient: object | null;
}>;

function waitForTerminalUiPaint(): Promise<void> {
  return new Promise((resolve) => deferAfterPaint(resolve));
}

export async function clearSemanticTerminalContent(
  transport: RedevenTerminalTransport,
  sessionId: string,
) {
  const normalizedSessionId = String(sessionId ?? '').trim();
  if (!normalizedSessionId || !transport.clearSemanticContent) {
    throw new Error('Semantic terminal clear is unavailable');
  }
  return await transport.clearSemanticContent(normalizedSessionId);
}

type terminal_context_snapshot = {
  sessionId: string;
  selectionText: string;
  screenText: string;
  hasSelection: boolean;
};

function resolveTerminalTouchScrollTarget(
  viewport: SemanticTerminalViewportHandle | null,
): SemanticTerminalTouchScrollRuntime | null {
  if (!viewport) return null;
  return viewport.getTouchScrollRuntime();
}

function readTerminalSelectionText(viewport: SemanticTerminalViewportHandle | null): string {
  try {
    return String(viewport?.getSelectionText?.() ?? '');
  } catch {
    return '';
  }
}

function readTerminalScreenText(viewport: SemanticTerminalViewportHandle | null): string {
  if (!viewport) return '';

  try {
    const terminalInfo = viewport.getTerminalInfo();
    const rowCount = Math.max(0, Math.floor(Number(terminalInfo?.rows ?? 0)));
    const bufferLength = Math.max(0, Math.floor(Number(terminalInfo?.bufferLength ?? 0)));
    if (rowCount <= 0 || bufferLength <= 0) return '';

    const lines: string[] = [];
    const startRow = Math.max(0, bufferLength - rowCount);
    for (let row = startRow; row < bufferLength; row += 1) {
      lines.push(viewport.readBufferLine(row, { trimRight: true }));
    }

    const text = lines.join('\n').trim();
    const characters = Array.from(text);
    if (characters.length <= MAX_INLINE_TERMINAL_CONTEXT_CHARS) return text;
    return `...${characters.slice(-(MAX_INLINE_TERMINAL_CONTEXT_CHARS - 3)).join('')}`;
  } catch {
    return '';
  }
}

function buildTerminalContextSnapshot(
  sessionId: string,
  viewport: SemanticTerminalViewportHandle | null,
): terminal_context_snapshot {
  const normalizedSessionId = String(sessionId ?? '').trim();
  const rawSelectionText = readTerminalSelectionText(viewport);
  const hasSelection = (() => {
    try {
      return Boolean(viewport?.hasSelection?.() ?? false);
    } catch {
      return rawSelectionText.length > 0;
    }
  })();
  const normalizedSelectionText = hasSelection ? rawSelectionText : '';
  return {
    sessionId: normalizedSessionId,
    selectionText: normalizedSelectionText,
    screenText: hasSelection ? '' : readTerminalScreenText(viewport),
    hasSelection,
  };
}

function buildTerminalSessionLabel(session: TerminalSessionInfo, fallbackLabel: string): string {
  return session.name?.trim() ? session.name.trim() : fallbackLabel;
}

function buildPendingTerminalSessionLabel(session: pending_terminal_session, fallbackLabel: string): string {
  return session.name?.trim() ? session.name.trim() : fallbackLabel;
}

function buildTerminalSidebarDirectoryTitle(workingDir: string, fallbackLabel: string): string {
  const normalizedWorkingDir = normalizeAskFlowerAbsolutePath(workingDir);
  if (normalizedWorkingDir === '/') {
    return 'Root';
  }

  if (normalizedWorkingDir) {
    const basename = basenameFromAbsolutePath(normalizedWorkingDir).trim();
    if (basename && basename !== 'File') {
      return basename;
    }
  }

  const fallback = String(fallbackLabel ?? '').trim();
  return fallback || 'Terminal';
}

function buildTerminalSidebarAvatarInitial(title: string): string {
  const trimmed = String(title ?? '').trim();
  const readableTitle = trimmed.replace(/^[^A-Za-z0-9]+/, '') || trimmed;
  const first = Array.from(readableTitle)[0] ?? 'T';
  return first.toLocaleUpperCase();
}

const TERMINAL_SIDEBAR_AVATAR_TONES: readonly terminal_session_avatar_tone[] = [
  {
    background: 'color-mix(in srgb, var(--redeven-categorical-1) 22%, var(--sidebar) 78%)',
    border: 'color-mix(in srgb, var(--redeven-categorical-1) 42%, var(--sidebar-border) 58%)',
    foreground: 'color-mix(in srgb, var(--redeven-categorical-1) 72%, var(--sidebar-foreground) 28%)',
  },
  {
    background: 'color-mix(in srgb, var(--redeven-categorical-2) 24%, var(--sidebar) 76%)',
    border: 'color-mix(in srgb, var(--redeven-categorical-2) 48%, var(--sidebar-border) 52%)',
    foreground: 'color-mix(in srgb, var(--redeven-categorical-2) 68%, var(--sidebar-foreground) 32%)',
  },
  {
    background: 'color-mix(in srgb, var(--redeven-categorical-3) 24%, var(--sidebar) 76%)',
    border: 'color-mix(in srgb, var(--redeven-categorical-3) 46%, var(--sidebar-border) 54%)',
    foreground: 'color-mix(in srgb, var(--redeven-categorical-3) 68%, var(--sidebar-foreground) 32%)',
  },
  {
    background: 'color-mix(in srgb, var(--redeven-categorical-4) 23%, var(--sidebar) 77%)',
    border: 'color-mix(in srgb, var(--redeven-categorical-4) 46%, var(--sidebar-border) 54%)',
    foreground: 'color-mix(in srgb, var(--redeven-categorical-4) 68%, var(--sidebar-foreground) 32%)',
  },
  {
    background: 'color-mix(in srgb, var(--redeven-categorical-5) 23%, var(--sidebar) 77%)',
    border: 'color-mix(in srgb, var(--redeven-categorical-5) 44%, var(--sidebar-border) 56%)',
    foreground: 'color-mix(in srgb, var(--redeven-categorical-5) 68%, var(--sidebar-foreground) 32%)',
  },
  {
    background: 'color-mix(in srgb, var(--redeven-categorical-6) 24%, var(--sidebar) 76%)',
    border: 'color-mix(in srgb, var(--redeven-categorical-6) 46%, var(--sidebar-border) 54%)',
    foreground: 'color-mix(in srgb, var(--redeven-categorical-6) 68%, var(--sidebar-foreground) 32%)',
  },
] as const;

function buildTerminalSidebarAvatarTone(seed: string): terminal_session_avatar_tone {
  let hash = 0;
  for (const char of String(seed ?? '')) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  const index = Math.abs(hash) % TERMINAL_SIDEBAR_AVATAR_TONES.length;
  return TERMINAL_SIDEBAR_AVATAR_TONES[index] ?? TERMINAL_SIDEBAR_AVATAR_TONES[0];
}

function resolveTerminalChromeTransition(
  status: TerminalSessionRuntimeStatus | undefined,
): TerminalSessionChromeTransition {
  if (status?.state === 'blocking') return 'failed';
  if (status?.state === 'reconnecting' || status?.state === 'retrying') return 'reconnecting';
  return 'none';
}

function resolveTerminalTransitionIndicator(chrome: TerminalSessionChrome): TerminalSessionTransitionIndicator {
  if (chrome.status === 'failed') return 'failed';
  return chrome.status === 'spinner' ? 'spinner' : 'none';
}

function resolveTerminalSidebarAttentionState(
  chrome: TerminalSessionChrome,
): TerminalSessionAttentionState {
  if (chrome.status === 'failed' || chrome.status === 'spinner') return 'none';
  return chrome.attention;
}

function buildTerminalPanelTitle(
  session: TerminalSessionInfo | null,
  terminalLabel: string,
  foregroundDisplayName = '',
): string {
  const titlePrefix = terminalLabel.trim() || 'Terminal';
  if (!session) return titlePrefix;
  const fallbackLabel = buildTerminalSessionLabel(session, titlePrefix);
  const sessionTitle = foregroundDisplayName
    || buildTerminalSidebarDirectoryTitle(session.workingDir, fallbackLabel);
  return sessionTitle ? `${titlePrefix} · ${sessionTitle}` : titlePrefix;
}

function buildPendingTerminalPanelTitle(session: pending_terminal_session | null, terminalLabel: string): string {
  const titlePrefix = terminalLabel.trim() || 'Terminal';
  const sessionName = String(session?.name ?? '').trim();
  if (sessionName) {
    return `${titlePrefix} · ${sessionName}`;
  }
  return titlePrefix;
}

function normalizeTerminalSessionTimestamp(value: unknown): number {
  const timestamp = Number(value ?? 0);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

const UNKNOWN_TERMINAL_OUTPUT_ACTIVITY: TerminalOutputActivityInfo = Object.freeze({
  phase: 'unknown',
  revision: 0,
  updatedAtMs: 0,
});

function normalizeTerminalOutputActivity(
  value: TerminalSessionInfo['outputActivity'] | null | undefined,
): TerminalOutputActivityInfo {
  if (!value || typeof value !== 'object') return UNKNOWN_TERMINAL_OUTPUT_ACTIVITY;
  if (value.phase !== 'unknown' && value.phase !== 'streaming' && value.phase !== 'settled') {
    return UNKNOWN_TERMINAL_OUTPUT_ACTIVITY;
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) return UNKNOWN_TERMINAL_OUTPUT_ACTIVITY;
  if (!Number.isSafeInteger(value.updatedAtMs) || value.updatedAtMs < 0) return UNKNOWN_TERMINAL_OUTPUT_ACTIVITY;
  return value;
}

function sameTerminalExecutionContext(
  left: TerminalSessionInfo['executionContext'],
  right: TerminalSessionInfo['executionContext'],
): boolean {
  const normalizedLeft: TerminalExecutionContextInfo = normalizeTerminalExecutionContextInfo(left);
  const normalizedRight: TerminalExecutionContextInfo = normalizeTerminalExecutionContextInfo(right);
  return normalizedLeft.location.kind === normalizedRight.location.kind
    && normalizedLeft.location.phase === normalizedRight.location.phase
    && normalizedLeft.location.label === normalizedRight.location.label
    && normalizedLeft.location.authority === normalizedRight.location.authority
    && normalizedLeft.location.workingDirectory === normalizedRight.location.workingDirectory
    && normalizedLeft.location.source === normalizedRight.location.source
    && normalizedLeft.application.kind === normalizedRight.application.kind
    && normalizedLeft.application.identity === normalizedRight.application.identity
    && normalizedLeft.application.displayName === normalizedRight.application.displayName
    && normalizedLeft.revision === normalizedRight.revision
    && normalizedLeft.updatedAtMs === normalizedRight.updatedAtMs;
}

function sameTerminalWorkState(
  left: TerminalSessionInfo['workState'],
  right: TerminalSessionInfo['workState'],
): boolean {
  const normalizedLeft: TerminalWorkStateInfo = normalizeTerminalWorkStateInfo(left);
  const normalizedRight: TerminalWorkStateInfo = normalizeTerminalWorkStateInfo(right);
  return normalizedLeft.phase === normalizedRight.phase
    && normalizedLeft.source === normalizedRight.source
    && normalizedLeft.contextRevision === normalizedRight.contextRevision
    && normalizedLeft.foregroundCommandRevision === normalizedRight.foregroundCommandRevision
    && normalizedLeft.revision === normalizedRight.revision
    && normalizedLeft.updatedAtMs === normalizedRight.updatedAtMs;
}

function normalizeTerminalSessionInfo(value: TerminalSessionInfo): TerminalSessionInfo | null {
  const id = String(value?.id ?? '').trim();
  const groupId = String(value?.groupId ?? '').trim();
  if (!id || !groupId) return null;
  const localCapabilityWorkingDir = canonicalAbsolutePath(value?.localPathCapability?.workingDir);
  return {
    id,
    groupId,
    name: String(value?.name ?? '').trim(),
    workingDir: String(value?.workingDir ?? ''),
    createdAtMs: normalizeTerminalSessionTimestamp(value?.createdAtMs),
    lastActiveAtMs: normalizeTerminalSessionTimestamp(value?.lastActiveAtMs),
    isActive: Boolean(value?.isActive),
    foregroundCommand: normalizeTerminalForegroundCommand(value?.foregroundCommand),
    outputActivity: normalizeTerminalOutputActivity(value?.outputActivity),
    executionContext: normalizeTerminalExecutionContextInfo(value?.executionContext),
    workState: normalizeTerminalWorkStateInfo(value?.workState),
    ...(localCapabilityWorkingDir
      ? { localPathCapability: { workingDir: localCapabilityWorkingDir } }
      : {}),
  };
}

function sameTerminalOutputActivity(
  left: TerminalSessionInfo['outputActivity'],
  right: TerminalSessionInfo['outputActivity'],
): boolean {
  const normalizedLeft = normalizeTerminalOutputActivity(left);
  const normalizedRight = normalizeTerminalOutputActivity(right);
  return normalizedLeft.phase === normalizedRight.phase
    && normalizedLeft.revision === normalizedRight.revision
    && normalizedLeft.updatedAtMs === normalizedRight.updatedAtMs;
}

function sameTerminalForegroundCommand(
  left: TerminalSessionInfo['foregroundCommand'],
  right: TerminalSessionInfo['foregroundCommand'],
): boolean {
  const normalizedLeft = normalizeTerminalForegroundCommand(left);
  const normalizedRight = normalizeTerminalForegroundCommand(right);
  return normalizedLeft.phase === normalizedRight.phase
    && normalizedLeft.displayName === normalizedRight.displayName
    && normalizedLeft.revision === normalizedRight.revision
    && normalizedLeft.updatedAtMs === normalizedRight.updatedAtMs;
}

function sameTerminalSessionInfo(a: TerminalSessionInfo | null | undefined, b: TerminalSessionInfo | null | undefined): boolean {
  return Boolean(
    a
    && b
    && a.id === b.id
    && a.groupId === b.groupId
    && a.name === b.name
    && a.workingDir === b.workingDir
    && a.createdAtMs === b.createdAtMs
    && a.lastActiveAtMs === b.lastActiveAtMs
    && a.isActive === b.isActive
    && sameTerminalForegroundCommand(a.foregroundCommand, b.foregroundCommand)
    && sameTerminalOutputActivity(a.outputActivity, b.outputActivity)
    && sameTerminalExecutionContext(a.executionContext, b.executionContext)
    && sameTerminalWorkState(a.workState, b.workState)
    && (a.localPathCapability?.workingDir ?? '') === (b.localPathCapability?.workingDir ?? ''),
  );
}

export function preserveStableTerminalSessionReferences(
  nextSessions: readonly TerminalSessionInfo[],
  previousSessions: readonly TerminalSessionInfo[] = [],
): TerminalSessionInfo[] {
  if (nextSessions.length === 0) {
    return previousSessions.length === 0 ? previousSessions as TerminalSessionInfo[] : [];
  }

  const previousById = new Map(previousSessions.map((session) => [session.id, session]));
  let changed = nextSessions.length !== previousSessions.length;
  const stableSessions = nextSessions.map((session, index) => {
    const previous = previousById.get(session.id);
    if (previous && sameTerminalSessionInfo(previous, session)) {
      if (previousSessions[index] !== previous) {
        changed = true;
      }
      return previous;
    }
    changed = true;
    return session;
  });

  return changed ? stableSessions : previousSessions as TerminalSessionInfo[];
}

function normalizeTerminalPanelSessionCreateResult(
  value: TerminalPanelSessionCreateResult,
): terminal_panel_created_session | null {
  if (typeof value === 'string') {
    const sessionId = String(value ?? '').trim();
    return sessionId ? { sessionId, session: null } : null;
  }

  if (!value) {
    return null;
  }

  const session = normalizeTerminalSessionInfo(value);
  return session ? { sessionId: session.id, session } : null;
}

function mergeTerminalSessionLists(
  baseSessions: readonly TerminalSessionInfo[],
  optimisticSessions: readonly TerminalSessionInfo[],
  closingSessionIds: ReadonlySet<string>,
): TerminalSessionInfo[] {
  const merged: TerminalSessionInfo[] = [];
  const indexesById = new Map<string, number>();

  for (const session of baseSessions) {
    const normalized = normalizeTerminalSessionInfo(session);
    if (!normalized || closingSessionIds.has(normalized.id)) continue;
    indexesById.set(normalized.id, merged.length);
    merged.push(normalized);
  }

  for (const session of optimisticSessions) {
    const normalized = normalizeTerminalSessionInfo(session);
    if (!normalized || closingSessionIds.has(normalized.id)) continue;
    const existingIndex = indexesById.get(normalized.id);
    if (typeof existingIndex === 'number') {
      merged[existingIndex] = normalized;
      continue;
    }
    indexesById.set(normalized.id, merged.length);
    merged.push(normalized);
  }

  return merged;
}

function normalizeTerminalSessionMatchName(value: string | undefined): string {
  return String(value ?? '').trim();
}

function normalizeTerminalSessionMatchWorkingDir(value: string | undefined): string {
  return normalizeAskFlowerAbsolutePath(String(value ?? '').trim());
}

function terminalSessionMatchesPendingSession(
  session: TerminalSessionInfo,
  pendingSession: pending_terminal_session,
): boolean {
  if (pendingSession.visibleSessionIdsAtCreate.includes(session.id)) {
    return false;
  }
  if (session.groupId !== pendingSession.groupId) return false;

  const sessionName = normalizeTerminalSessionMatchName(session.name);
  const pendingName = normalizeTerminalSessionMatchName(pendingSession.name);
  if (!sessionName || sessionName !== pendingName) {
    return false;
  }

  const sessionWorkingDir = normalizeTerminalSessionMatchWorkingDir(session.workingDir);
  const pendingWorkingDir = normalizeTerminalSessionMatchWorkingDir(pendingSession.workingDir);
  return !sessionWorkingDir || !pendingWorkingDir || sessionWorkingDir === pendingWorkingDir;
}

function pendingTerminalSessionsCompete(
  left: pending_terminal_session,
  right: pending_terminal_session,
): boolean {
  return normalizeTerminalSessionMatchName(left.name) === normalizeTerminalSessionMatchName(right.name)
    && left.groupId === right.groupId
    && normalizeTerminalSessionMatchWorkingDir(left.workingDir) === normalizeTerminalSessionMatchWorkingDir(right.workingDir);
}

export function resolvePendingTerminalSessions(
  pendingSessions: readonly pending_terminal_session[],
  visibleSessions: readonly TerminalSessionInfo[],
  authoritativeSessionIds: ReadonlySet<string> = new Set<string>(),
): resolved_pending_terminal_session[] {
  const claimedSessionIds = new Set(authoritativeSessionIds);
  const resolved: resolved_pending_terminal_session[] = [];

  const orderedPending = pendingSessions
    .filter((session) => session.status === 'creating')
    .sort((left, right) => (
      left.operationSequence - right.operationSequence
        || left.createdAtMs - right.createdAtMs
        || left.id.localeCompare(right.id)
    ));
  const orderedVisible = [...visibleSessions].sort((left, right) => (
    left.createdAtMs - right.createdAtMs
      || left.id.localeCompare(right.id)
  ));
  for (const pendingSession of orderedPending) {
    const session = orderedVisible.find((candidate) => (
      !claimedSessionIds.has(candidate.id)
        && terminalSessionMatchesPendingSession(candidate, pendingSession)
    ));
    if (!session) continue;
    claimedSessionIds.add(session.id);
    resolved.push({
      pendingSessionId: pendingSession.id,
      sessionId: session.id,
      session,
    });
  }

  return resolved;
}

const PendingTerminalTabStatusIcon = (props: { status: pending_terminal_session_status }) => {
  if (props.status === 'failed') {
    return (
      <span class="inline-flex h-3 w-3 items-center justify-center text-error" data-terminal-tab-status="failed" aria-hidden="true">
        <span class="h-2 w-2 rounded-full bg-current" />
      </span>
    );
  }

  return (
    <span class="inline-flex h-3 w-3 items-center justify-center text-muted-foreground" data-terminal-tab-status="creating" aria-hidden="true">
      <svg
        class="h-3 w-3 animate-spin"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle cx="12" cy="12" r="8" class="opacity-20" stroke="currentColor" stroke-width="3" />
        <path d="M20 12a8 8 0 0 0-8-8" class="opacity-100" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
      </svg>
    </span>
  );
};

function TerminalLoadingPane(props: {
  message?: string;
  progressLabel?: string;
  dataStage?: string;
  tone?: 'system' | 'terminal';
}) {
  const i18n = useI18n();
  const message = createMemo(() => String(props.message ?? '').trim() || i18n.t('terminal.creatingMessage'));
  const progressLabel = createMemo(() => String(props.progressLabel ?? '').trim() || i18n.t('terminal.creatingAria'));
  const dataStage = createMemo(() => String(props.dataStage ?? '').trim() || 'creating');
  const tone = createMemo(() => props.tone ?? 'terminal');

  return (
    <div
      class={`redeven-loading-curtain${tone() === 'terminal' ? ' redeven-terminal-loading-curtain' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-redeven-loading-curtain-surface="component"
      data-redeven-loading-curtain-stage={dataStage()}
      style={tone() === 'terminal' ? {
        'background-color': 'var(--redeven-terminal-loading-background, var(--background))',
      } : undefined}
    >
      <div class="redeven-loading-curtain__panel">
        <div class="redeven-loading-curtain__eyebrow">{i18n.t('terminal.creatingEyebrow')}</div>
        <div
          class="redeven-loading-curtain__indicator"
          role="progressbar"
          aria-label={progressLabel()}
        >
          <div class="redeven-loading-curtain__indicator-bar" />
        </div>
        <div class="redeven-loading-curtain__message">{message()}</div>
      </div>
    </div>
  );
}

function matchesPlainPrimaryModShortcut(event: KeyboardEvent, key: string): boolean {
  if (event.altKey || event.shiftKey) return false;
  if (isMacLikePlatform()) {
    if (!event.metaKey || event.ctrlKey) return false;
  } else if (!event.ctrlKey || event.metaKey) {
    return false;
  }
  return matchKeybind(event, `mod+${key}`);
}

function terminalTabShortcutIndex(event: KeyboardEvent): number | null {
  const key = event.key?.toLowerCase?.() ?? '';
  if (!/^[1-9]$/u.test(key)) return null;
  if (!matchesPlainPrimaryModShortcut(event, key)) return null;
  const index = Number(key) - 1;
  return index >= 0 && index <= TERMINAL_TAB_SHORTCUT_MAX_INDEX ? index : null;
}

const MoreVerticalIcon = (props: { class?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={props.class}
  >
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="19" r="1" />
  </svg>
);

function TerminalPanelInner(props: TerminalPanelInnerProps = {}) {
  const i18n = useI18n();
  const accessibilityIdPrefix = `terminal-panel-${createUniqueId()}`;
  const activeContextStatusId = `${accessibilityIdPrefix}-active-context-status`;
  const terminalAskMenuId = `${accessibilityIdPrefix}-ask-menu`;
  const terminalSidebarMenuId = `${accessibilityIdPrefix}-sidebar-menu`;
  const variant: TerminalPanelVariant = props.variant ?? 'panel';
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const env = useEnvContext();
  const filePreview = useFilePreviewContext();
  const layout = useLayout();
  const notify = useNotification();
  const theme = useTheme();
  const floe = useResolvedFloeConfig();
  const widgetId = (() => {
    try {
      return useCurrentWidgetId();
    } catch {
      return null;
    }
  })();
  const view = (() => {
    try {
      return useViewActivation();
    } catch {
      // Embedded surfaces can mount terminals outside tab activation providers.
      const fallbackId = String(widgetId ?? '').trim();
      return {
        id: fallbackId ? `embedded:${fallbackId}` : 'terminal_page',
        active: () => true,
        activationSeq: () => 0,
      };
    }
  })();
  const connId = createTerminalConnId();
  const panelId = (() => {
    const wid = String(widgetId ?? '').trim();
    return wid ? `embedded:${wid}` : 'terminal_page';
  })();
  const agentAttentionReaderId = createClientId('terminal-agent-reader');
  const activeSessionStorageKey = buildActiveSessionStorageKey(panelId);
  const sessionPlacementState = createMemo<TerminalPanelSessionPlacementState | null>(() => props.sessionPlacementState ?? null);

  const collapsedGroupsStorageKey = createMemo(() => buildCollapsedTerminalGroupsStorageKey(String(env.env_id() ?? ''), panelId));
  const [collapsedGroupIds, setCollapsedGroupIds] = createSignal<ReadonlySet<string>>(new Set());
  let loadedCollapsedGroupsStorageKey = '';
  createEffect(() => {
    const storageKey = collapsedGroupsStorageKey();
    if (storageKey === loadedCollapsedGroupsStorageKey) return;
    loadedCollapsedGroupsStorageKey = storageKey;
    setCollapsedGroupIds(readCollapsedTerminalGroupIds(storageKey));
  });
  createEffect(() => {
    const storageKey = collapsedGroupsStorageKey();
    const collapsed = collapsedGroupIds();
    if (storageKey !== loadedCollapsedGroupsStorageKey) return;
    writeCollapsedTerminalGroupIds(storageKey, collapsed);
  });
  const expandNavigationGroup = (groupId: string) => {
    setCollapsedGroupIds((current) => expandTerminalGroupInCollapsedSet(current, groupId));
  };

  const [groupEditorTarget, setGroupEditorTarget] = createSignal<TerminalGroup | 'create' | null>(null);
  const [groupDeleteTarget, setGroupDeleteTarget] = createSignal<TerminalGroup | null>(null);

  const [searchOpen, setSearchOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [sessionFilterQuery, setSessionFilterQuery] = createSignal('');
  const [sessionDrawerOpen, setSessionDrawerOpen] = createSignal(false);
  const [terminalStatusAnnouncement, setTerminalStatusAnnouncement] = createSignal<Readonly<{
    sequence: number;
    text: string;
  }> | null>(null);
  let terminalStatusAnnouncementSequence = 0;
  let sessionDrawerTriggerEl: HTMLButtonElement | null = null;
  const [searchResultCount, setSearchResultCount] = createSignal(0);
  const [searchResultIndex, setSearchResultIndex] = createSignal(-1);
  const [searchState, setSearchState] = createSignal<'idle' | 'searching' | 'ready' | 'error'>('idle');
  const [panelHasFocus, setPanelHasFocus] = createSignal(false);
  const [agentHomePathAbs, setAgentHomePathAbs] = createSignal('');
  const [terminalAskMenu, setTerminalAskMenu] = createSignal<{
    x: number;
    y: number;
    selection: terminal_context_snapshot;
    triggerElement: HTMLElement | null;
  } | null>(null);
  let terminalAskMenuEl: HTMLDivElement | null = null;
  const [terminalSidebarMenu, setTerminalSidebarMenu] = createSignal<terminal_sidebar_context_menu>(null);
  let terminalSidebarMenuEl: HTMLDivElement | null = null;
  const [copiedSidebarPathSessionId, setCopiedSidebarPathSessionId] = createSignal<string | null>(null);
  let mirroredCatalogError: string | null = null;
  let sidebarPathCopyResetTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const [terminalContextMenuHostEl, setTerminalContextMenuHostEl] = createSignal<HTMLDivElement | null>(null);

  let searchLastAppliedKey = '';
  let searchBoundViewport: SemanticTerminalViewportHandle | null = null;

  ensureTerminalPreferencesInitialized(floe.persist);
  const terminalPrefs = useTerminalPreferences();
  const terminalCatalog = useTerminalSessionCatalog();
  const groupPathPicker = useEnvFilesystemPicker();

  const terminalLive = createRedevenTerminalLiveBundle(rpc, () => protocol.session?.(), connId);
  const transport = terminalLive.transport;
  const eventSource = terminalLive.eventSource;
  const fallbackSessionsCoordinator = terminalCatalog
    ? null
    : getRedevenTerminalSessionsCoordinator({ connId, transport, logger: buildLogger() });
  let disposed = false;
  let nextCreateOperationSequence = 0;
  let lastSidebarPresentedEpoch = -1;
  const [authoritativelyClaimedSessionIds, setAuthoritativelyClaimedSessionIds] = createSignal<ReadonlySet<string>>(
    new Set<string>(),
  );
  createEffect(() => {
    transport.syncConnectionEpoch(protocol.session?.() ?? null);
  });
  onCleanup(() => {
    disposed = true;
    transport.dispose();
    if (sidebarPathCopyResetTimer !== undefined) {
      globalThis.clearTimeout(sidebarPathCopyResetTimer);
      sidebarPathCopyResetTimer = undefined;
    }
  });

  const connected = () => protocol.status() === 'connected' && Boolean(protocol.session?.());
  const viewActive = () => view.active();
  const displayModeSelected = () => env.viewMode() === (variant === 'workbench' ? 'workbench' : 'activity');
  const workbenchSelected = () => variant !== 'workbench' || props.workbenchSelected !== false;
  const terminalFocusOwner = () => viewActive() && displayModeSelected() && workbenchSelected();
  const isEmbeddedWidget = Boolean(String(widgetId ?? '').trim());
  const permissionReady = () => env.env.state === 'ready';
  const canBrowseFiles = createMemo(() => connected() && permissionReady() && Boolean(env.env()?.permissions?.can_read));

  const captureSessionMutationFence = (): terminal_session_mutation_fence => ({
    envId: String(env.env_id() ?? '').trim(),
    connectionEpoch: terminalCatalog?.connectionEpoch() ?? 0,
    protocolClient: protocol.session?.(),
  });

  const sessionMutationFenceIsCurrent = (fence: terminal_session_mutation_fence): boolean => (
    !disposed
    && connected()
    && permissionReady()
    && canLaunchProcess(env.env()?.permissions)
    && String(env.env_id() ?? '').trim() === fence.envId
    && protocol.session?.() === fence.protocolClient
    && (terminalCatalog?.connectionEpoch() ?? 0) === fence.connectionEpoch
  );

  createEffect(() => {
    if (terminalFocusOwner()) return;
    // Inactive KeepAlive views must release every document-level focus owner without restoring focus into hidden DOM.
    setPanelHasFocus(false);
    setSessionDrawerOpen(false);
    setTerminalSidebarMenu(null);
    setTerminalAskMenu(null);
  });

  createEffect(() => {
    if (!connected()) return;
    void (async () => {
      try {
        const resp = await rpc.fs.getPathContext();
        const home = normalizeAskFlowerAbsolutePath(String(resp?.agentHomePathAbs ?? '').trim());
        if (home) setAgentHomePathAbs(home);
      } catch {
        // ignore
      }
    })();
  });

  createEffect(() => {
    const host = terminalContextMenuHostEl();
    if (!host) return;

    const onContextMenuCapture = (event: MouseEvent) => {
      handleTerminalContextMenuCapture(event);
    };

    const onKeyDownCapture = (event: KeyboardEvent) => {
      handleTerminalContextMenuKeyDownCapture(event);
    };

    host.addEventListener('contextmenu', onContextMenuCapture, true);
    host.addEventListener('keydown', onKeyDownCapture, true);
    onCleanup(() => {
      host.removeEventListener('contextmenu', onContextMenuCapture, true);
      host.removeEventListener('keydown', onKeyDownCapture, true);
    });
  });

  createEffect(() => {
    const host = terminalContextMenuHostEl();
    if (!host) return;

    const onPointerDownCapture = (event: PointerEvent) => {
      if (!shouldUseFloeMobileKeyboard()) return;
      if (!isTerminalSurfaceContextMenuEvent(event as unknown as MouseEvent)) return;
      openFloeMobileKeyboard();
    };

    const onFocusInCapture = (event: FocusEvent) => {
      if (!shouldUseFloeMobileKeyboard()) return;
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (!host.contains(target)) return;

      requestAnimationFrame(() => {
        target.blur();
      });
    };

    host.addEventListener('pointerdown', onPointerDownCapture, true);
    host.addEventListener('focusin', onFocusInCapture, true);

    onCleanup(() => {
      host.removeEventListener('pointerdown', onPointerDownCapture, true);
      host.removeEventListener('focusin', onFocusInCapture, true);
    });
  });

  const userTheme = terminalPrefs.userTheme;
  const sharedGeometryPreferences = createMemo(() => props.terminalGeometryPreferences ?? null);
  const fontSize = createMemo(() => {
    const shared = sharedGeometryPreferences();
    if (shared) {
      return normalizeTerminalFontSize(shared.fontSize);
    }
    return terminalPrefs.fontSize();
  });
  const fontFamilyId = createMemo(() => {
    const shared = sharedGeometryPreferences();
    if (shared) {
      return normalizeTerminalFontFamilyId(shared.fontFamilyId);
    }
    return terminalPrefs.fontFamilyId();
  });
  const mobileInputMode = terminalPrefs.mobileInputMode;
  const workIndicatorEnabled = terminalPrefs.workIndicatorEnabled;

  const resolvedFont = createResolvedTerminalFont(fontFamilyId);
  const fontFamily = () => resolvedFont().family;

  const isMobileLayout = () => layout.isMobile();

  let fontSelectionGeneration = 0;
  const resizeAfterFontSelection = async (persist: () => void | Promise<void>) => {
    const generation = ++fontSelectionGeneration;
    const sid = activeSessionId();
    try {
      await persist();
    } catch {
      // The shared preference owner reports persistence failures.
      return;
    }
    queueMicrotask(() => {
      if (generation !== fontSelectionGeneration || sid !== activeSessionId()) return;
      if (sid) viewportRegistry.get(sid)?.forceResize();
    });
  };

  const persistFontSize = (value: number) => {
    const shared = sharedGeometryPreferences();
    void resizeAfterFontSelection(() => shared
      ? shared.onFontSizeChange(normalizeTerminalFontSize(value))
      : terminalPrefs.setFontSize(value));
  };

  const persistFontFamily = (id: string) => {
    const shared = sharedGeometryPreferences();
    void resizeAfterFontSelection(() => shared
      ? shared.onFontFamilyChange(normalizeTerminalFontFamilyId(id))
      : terminalPrefs.setFontFamily(id));
  };

  const persistMobileInputMode = (value: TerminalMobileInputMode) => {
    terminalPrefs.setMobileInputMode(value);
  };

  const terminalThemeName = createMemo<TerminalThemeName>(() => {
    const selected = resolveTerminalUserTheme(userTheme());
    if (selected === 'system') {
      return theme.resolvedTheme() === 'light' ? 'light' : 'dark';
    }
    return selected;
  });

  const terminalWorkIndicatorTheme = createMemo(() => {
    return theme.resolvedTheme() === 'light' ? 'light' : 'dark';
  });

  const terminalThemeColors = createMemo<Record<string, string>>(() => {
    const colors = getThemeColors(terminalThemeName()) as Record<string, string>;
    if (userTheme() !== 'system') return colors;

    const resolvedTheme = theme.resolvedTheme();
    const preset = theme.shellPresetForMode(resolvedTheme);
    return resolveSystemTerminalThemeColors(
      colors,
      preset?.tokens?.[resolvedTheme] as Readonly<Record<string, string>> | undefined,
    );
  });
  const terminalThemeBackground = createMemo(() => terminalThemeColors().background ?? '#1e1e1e');
  const terminalThemeForeground = createMemo(() => terminalThemeColors().foreground ?? '#c9d1d9');
  const terminalThemeMutedForeground = createMemo(() => (
    `color-mix(in srgb, ${terminalThemeForeground()} 70%, transparent)`
  ));
  const terminalLoadingVars = createMemo(() => ({
    '--redeven-terminal-loading-background': terminalThemeBackground(),
    '--redeven-terminal-loading-foreground': terminalThemeForeground(),
    '--redeven-terminal-search-background': `color-mix(in srgb, ${terminalThemeBackground()} 94%, ${terminalThemeForeground()} 6%)`,
    '--redeven-terminal-search-input': `color-mix(in srgb, ${terminalThemeBackground()} 86%, ${terminalThemeForeground()} 14%)`,
    '--redeven-terminal-search-border': `color-mix(in srgb, ${terminalThemeForeground()} 24%, transparent)`,
    '--redeven-terminal-search-foreground': terminalThemeForeground(),
    '--redeven-terminal-search-muted': terminalThemeMutedForeground(),
    '--redeven-terminal-search-hover': `color-mix(in srgb, ${terminalThemeForeground()} 12%, transparent)`,
    '--redeven-terminal-search-accent': terminalThemeColors().selectionBackground ?? terminalThemeColors().selection ?? terminalThemeForeground(),
  }));

  const [allSessions, setAllSessions] = createSignal<TerminalSessionInfo[]>([]);
  const [optimisticTerminalSessions, setOptimisticTerminalSessions] = createSignal<TerminalSessionInfo[]>([]);
  const [optimisticClosingSessionIds, setOptimisticClosingSessionIds] = createSignal<Set<string>>(new Set());
  const [pendingTerminalSessions, setPendingTerminalSessions] = createSignal<pending_terminal_session[]>([]);
  const [terminalCreationTransitions, setTerminalCreationTransitions] = createSignal<terminal_creation_transition[]>([]);
  const [sessionsHydrated, setSessionsHydrated] = createSignal(terminalCatalog?.hydrated() ?? false);
  const [sessionsLoading, setSessionsLoading] = createSignal(terminalCatalog?.loading() ?? false);
  const [localActiveSessionId, setLocalActiveSessionId] = createSignal<string | null>(readActiveSessionId(activeSessionStorageKey));
  const [localActivePendingSessionId, setLocalActivePendingSessionId] = createSignal<string | null>(null);
  const [optimisticActiveDisplaySessionId, setOptimisticActiveDisplaySessionId] = createSignal<string | null>(null);
  const [mountedSessionIds, setMountedSessionIds] = createSignal<Set<string>>(new Set());
  const [retainedClosingSessions, setRetainedClosingSessions] = createSignal<Record<string, TerminalSessionInfo>>({});
  const [error, setError] = createSignal<string | null>(null);
  const [mobileKeyboardVisible, setMobileKeyboardVisible] = createSignal(
    isMobileLayout() && mobileInputMode() === 'floe',
  );
  const [mobileKeyboardInsetPx, setMobileKeyboardInsetPx] = createSignal(0);
  const [mobileKeyboardDraftState, setMobileKeyboardDraftState] = createSignal(
    createEmptyTerminalMobileKeyboardDraftState(),
  );
  const [mobileKeyboardHistoryBySession, setMobileKeyboardHistoryBySession] = createSignal<Record<string, string[]>>({});
  const [mobileKeyboardPathEntries, setMobileKeyboardPathEntries] = createSignal<TerminalMobileKeyboardPathEntry[]>([]);
  const [mobileKeyboardPackageScripts, setMobileKeyboardPackageScripts] = createSignal<TerminalMobileKeyboardScript[]>([]);
  const [tabVisualStateBySession, setTabVisualStateBySession] = createSignal<TerminalSessionTabVisualStateMap>({});
  const [foregroundPresentationBySession, setForegroundPresentationBySession] = createSignal<
    ReadonlyMap<string, TerminalForegroundPresentation>
  >(new Map());
  const [runtimeStatusBySession, setRuntimeStatusBySession] = createSignal<Record<string, TerminalSessionRuntimeStatus>>({});
  const [geometryPresentationBySession, setGeometryPresentationBySession] = createSignal<
    Record<string, TerminalSharedGeometryPresentation>
  >({});
  const [sharedGeometryAnnouncement, setSharedGeometryAnnouncement] = createSignal('');
  const announcedGeometryLifecycles = new Set<string>();

  const beginTerminalCreationTransition = (pendingSessionId: string) => {
    setTerminalCreationTransitions((previous) => (
      previous.some((transition) => transition.pendingSessionId === pendingSessionId)
        ? previous
        : [...previous, { pendingSessionId, sessionId: '', phase: 'creating' }]
    ));
  };

  const handoffTerminalCreationTransition = (pendingSessionId: string, sessionId: string) => {
    setTerminalCreationTransitions((previous) => {
      let changed = false;
      const next = previous.map((transition) => {
        if (transition.pendingSessionId !== pendingSessionId) return transition;
        if (transition.phase === 'attaching' && transition.sessionId === sessionId) return transition;
        changed = true;
        return { ...transition, sessionId, phase: 'attaching' as const };
      });
      return changed ? next : previous;
    });
  };

  const removeTerminalCreationTransitionByPendingId = (pendingSessionId: string) => {
    setTerminalCreationTransitions((previous) => {
      const next = previous.filter((transition) => transition.pendingSessionId !== pendingSessionId);
      return next.length === previous.length ? previous : next;
    });
  };

  const removeTerminalCreationTransitionBySessionId = (sessionId: string) => {
    setTerminalCreationTransitions((previous) => {
      const next = previous.filter((transition) => transition.sessionId !== sessionId);
      return next.length === previous.length ? previous : next;
    });
  };

  const terminalCreationTransitionForSession = (sessionId: string) => (
    terminalCreationTransitions().find((transition) => transition.sessionId === sessionId) ?? null
  );

  const terminalCreationTransitionIds = createMemo(() => (
    terminalCreationTransitions().map((transition) => transition.pendingSessionId)
  ));

  const handleExecuteDenied = (e: unknown): boolean => {
    if (!isPermissionDeniedError(e, 'process')) return false;
    props.onExecuteDenied?.();
    return true;
  };

  const [historyRowsBySession, setHistoryRowsBySession] = createSignal<Readonly<Record<string, number>>>({});

  const viewportRegistry = new Map<string, SemanticTerminalViewportHandle>();
  const surfaceRegistry = new Map<string, HTMLDivElement>();
  const actionsRegistry = new Map<string, TerminalSessionRuntimeActions>();
  const mobileKeyboardPathCache = new Map<string, TerminalMobileKeyboardPathEntry[]>();
  const mobileKeyboardPackageScriptsCache = new Map<string, TerminalMobileKeyboardScript[]>();
  const selectOptimisticActiveDisplaySessionId = (sessionId: string | null) => {
    const normalizedSessionId = String(sessionId ?? '').trim() || null;
    setOptimisticActiveDisplaySessionId(normalizedSessionId);
  };
  const tabActivityTracker = createTerminalTabActivityTracker({
    publishVisualState: (sessionId, state) => {
      setTabVisualStateBySession((prev) => {
        if (prev[sessionId] === state) {
          return prev;
        }
        return {
          ...prev,
          [sessionId]: state,
        };
      });
    },
  });

  const [viewportRegistrySeq, setViewportRegistrySeq] = createSignal(0);
  const [surfaceRegistrySeq, setSurfaceRegistrySeq] = createSignal(0);
  let mobileKeyboardInsetSyncRaf: number | null = null;

  const visibleAllSessions = createMemo<TerminalSessionInfo[]>((previous) => (
    preserveStableTerminalSessionReferences(
      mergeTerminalSessionLists(allSessions(), optimisticTerminalSessions(), optimisticClosingSessionIds()),
      previous,
    )
  ), []);

  const buildRegisteredTerminalAppearance = (): SemanticTerminalAppearance => ({
    theme: terminalThemeColors(),
    fontSize: fontSize(),
    fontFamily: fontFamily(),
  });

  const applyRegisteredTerminalAppearance = (
    viewport: SemanticTerminalViewportHandle,
    appearance: SemanticTerminalAppearance = buildRegisteredTerminalAppearance(),
  ) => {
    viewport.setAppearance(appearance);
  };

  const updateSessionPlacementState = (
    updater: (previous: TerminalPanelSessionPlacementState) => TerminalPanelSessionPlacementState,
  ): boolean => {
    const current = sessionPlacementState();
    if (!current || !props.onSessionPlacementStateChange) {
      return false;
    }

    const next = updater(current);
    if (sameTerminalPanelSessionPlacementState(current, next)) {
      return true;
    }

    props.onSessionPlacementStateChange(next);
    return true;
  };

  const placedSessionIds = createMemo<readonly string[] | null>((previous) => {
    const placement = sessionPlacementState();
    if (!placement) {
      return previous === null ? previous : null;
    }
    return previous !== null && sameSessionIdList(previous, placement.sessionIds) ? previous : [...placement.sessionIds];
  }, null);

  const sessions = createMemo<TerminalSessionInfo[]>(() => {
    const list = visibleAllSessions();
    const placementSessionIds = placedSessionIds();
    if (!placementSessionIds) {
      return list;
    }

    const placedIds = new Set(placementSessionIds);
    return list.filter((session) => placedIds.has(session.id));
  });

  const foregroundPresentationScheduler = createTerminalForegroundPresentationScheduler({
    publish: setForegroundPresentationBySession,
  });

  createEffect(() => {
    foregroundPresentationScheduler.sync(sessions());
  });

  onCleanup(() => foregroundPresentationScheduler.dispose());

  const pendingTerminalSessionById = (sessionId: string): pending_terminal_session | null => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) return null;
    return pendingTerminalSessions().find((session) => session.id === normalizedSessionId) ?? null;
  };

  const resolvedPendingTerminalSessions = createMemo<resolved_pending_terminal_session[]>(() => (
    resolvePendingTerminalSessions(
      pendingTerminalSessions(),
      sessions(),
      authoritativelyClaimedSessionIds(),
    )
  ));

  const resolvedPendingTerminalSessionByPendingId = (pendingSessionId: string): resolved_pending_terminal_session | null => {
    const normalizedPendingSessionId = String(pendingSessionId ?? '').trim();
    if (!normalizedPendingSessionId) return null;
    return resolvedPendingTerminalSessions().find((session) => session.pendingSessionId === normalizedPendingSessionId) ?? null;
  };

  const visiblePendingTerminalSessions = createMemo<pending_terminal_session[]>(() => {
    const resolvedPendingIds = new Set(resolvedPendingTerminalSessions().map((session) => session.pendingSessionId));
    return pendingTerminalSessions().filter((session) => !resolvedPendingIds.has(session.id));
  });

  const emptySessionListLoading = createMemo(() => (
    connected()
    && sessions().length === 0
    && visiblePendingTerminalSessions().length === 0
    && (!sessionsHydrated() || sessionsLoading())
  ));

  createEffect(() => {
    if (!sessionsHydrated()) return;
    const epoch = terminalCatalog?.connectionEpoch() ?? 0;
    const sessionCount = sessions().length;
    if (lastSidebarPresentedEpoch === epoch) return;
    const frame = requestAnimationFrame(() => {
      if (lastSidebarPresentedEpoch === epoch) return;
      lastSidebarPresentedEpoch = epoch;
      markTerminalPerformance('sidebar-presented', {
        connection_epoch: epoch,
        session_count: sessionCount,
      });
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const visiblePendingTerminalSessionById = (sessionId: string): pending_terminal_session | null => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) return null;
    return visiblePendingTerminalSessions().find((session) => session.id === normalizedSessionId) ?? null;
  };

  const sessionDisplayIdExists = (sessionId: string | null): boolean => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) return false;
    return sessions().some((session) => session.id === normalizedSessionId)
      || visiblePendingTerminalSessionById(normalizedSessionId) !== null;
  };

  const canonicalActiveDisplaySessionId = createMemo<string | null>(() => {
    const activePendingId = localActivePendingSessionId();
    if (activePendingId) {
      const resolved = resolvedPendingTerminalSessionByPendingId(activePendingId);
      if (resolved) {
        return resolved.sessionId;
      }
    }
    if (activePendingId && visiblePendingTerminalSessionById(activePendingId)) {
      return activePendingId;
    }

    const placement = sessionPlacementState();
    if (placement) {
      return placement.activeSessionId;
    }
    return localActiveSessionId();
  });

  const activeDisplaySessionId = createMemo<string | null>(() => {
    const optimisticActiveId = optimisticActiveDisplaySessionId();
    if (optimisticActiveId && sessionDisplayIdExists(optimisticActiveId)) {
      return optimisticActiveId;
    }

    return canonicalActiveDisplaySessionId();
  });

  createEffect(() => {
    const optimisticActiveId = optimisticActiveDisplaySessionId();
    if (!optimisticActiveId) return;
    if (canonicalActiveDisplaySessionId() === optimisticActiveId || !sessionDisplayIdExists(optimisticActiveId)) {
      setOptimisticActiveDisplaySessionId(null);
    }
  });

  const activeSessionId = createMemo<string | null>(() => {
    const activeId = activeDisplaySessionId();
    return activeId && !visiblePendingTerminalSessionById(activeId) ? activeId : null;
  });
  const activeHistoryRows = createMemo(() => {
    const sessionId = activeSessionId();
    return sessionId ? historyRowsBySession()[sessionId] ?? null : null;
  });

  const activePendingSession = createMemo<pending_terminal_session | null>(() => {
    const activeId = activeDisplaySessionId();
    if (!activeId) return null;
    return visiblePendingTerminalSessions().find((session) => session.id === activeId) ?? null;
  });

  const ensureSessionInPlacement = (sessionId: string) => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) {
      return;
    }

    updateSessionPlacementState((previous) => (
      previous.sessionIds.includes(normalizedSessionId)
        ? previous
        : {
          sessionIds: [...previous.sessionIds, normalizedSessionId],
          activeSessionId: previous.activeSessionId,
        }
    ));
  };

  const markSessionMounted = (sessionId: string) => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) return;
    setMountedSessionIds((prev) => {
      if (prev.has(normalizedSessionId)) return prev;
      const next = new Set(prev);
      next.add(normalizedSessionId);
      return next;
    });
  };

  const retainMountedSessionUntilAfterPaint = (sessionId: string) => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) return;
    if (!mountedSessionIds().has(normalizedSessionId)) return;

    const retainedSession = sessions().find((session) => session.id === normalizedSessionId);
    if (!retainedSession) return;

    setRetainedClosingSessions((previous) => (
      previous[normalizedSessionId]
        ? previous
        : {
          ...previous,
          [normalizedSessionId]: retainedSession,
        }
    ));

    void waitForTerminalUiPaint().then(() => {
      if (disposed) return;
      setRetainedClosingSessions((previous) => {
        if (!previous[normalizedSessionId]) return previous;
        const next = { ...previous };
        delete next[normalizedSessionId];
        return next;
      });
    });
  };

  const setActiveRealSessionId = (sessionId: string | null) => {
    const normalizedSessionId = String(sessionId ?? '').trim() || null;
    setLocalActivePendingSessionId(null);
    if (!updateSessionPlacementState((previous) => ({
      sessionIds: previous.sessionIds,
      activeSessionId: normalizedSessionId === null
        ? null
        : previous.sessionIds.includes(normalizedSessionId)
          ? normalizedSessionId
          : previous.activeSessionId,
    }))) {
      setLocalActiveSessionId(normalizedSessionId);
    }
  };

  const activateResolvedPendingSession = (resolved: resolved_pending_terminal_session) => {
    handoffTerminalCreationTransition(resolved.pendingSessionId, resolved.sessionId);
    markSessionMounted(resolved.sessionId);
    ensureSessionInPlacement(resolved.sessionId);
    selectOptimisticActiveDisplaySessionId(resolved.sessionId);
    setActiveRealSessionId(resolved.sessionId);
  };

  createEffect(() => {
    const resolvedSessions = resolvedPendingTerminalSessions();
    if (resolvedSessions.length === 0) return;

    const activePendingId = localActivePendingSessionId();
    const activeResolvedSession = activePendingId
      ? resolvedSessions.find((session) => session.pendingSessionId === activePendingId)
      : null;
    if (activeResolvedSession) {
      activateResolvedPendingSession(activeResolvedSession);
    }

  });

  const setActiveSessionId = (value: string | null) => {
    const normalizedValue = String(value ?? '').trim() || null;
    selectOptimisticActiveDisplaySessionId(normalizedValue);
    if (normalizedValue && pendingTerminalSessionById(normalizedValue)) {
      const resolved = resolvedPendingTerminalSessionByPendingId(normalizedValue);
      if (resolved) {
        activateResolvedPendingSession(resolved);
        return;
      }
      setLocalActivePendingSessionId(normalizedValue);
      return;
    }

    setActiveRealSessionId(normalizedValue);
  };

  type PendingTerminalFocusIntent = Readonly<{
    generation: number;
    sessionId: string;
    anchor: Element | null;
    originSurface: HTMLDivElement | null;
  }>;

  type TerminalSessionSelectionMetadata = Readonly<{
    restoreFocus: boolean;
    focusIntent?: PendingTerminalFocusIntent;
  }>;

  let terminalFocusIntentGeneration = 0;
  let pendingTerminalFocusIntent: PendingTerminalFocusIntent | null = null;

  const clearPendingTerminalFocusIntent = (intent?: PendingTerminalFocusIntent) => {
    if (intent && pendingTerminalFocusIntent !== intent) return;
    pendingTerminalFocusIntent = null;
  };

  const focusOwnerMatchesIntent = (intent: PendingTerminalFocusIntent, owner: Element | null) => {
    if (owner == null || (typeof document !== 'undefined' && owner === document.body)) return true;
    if (owner === intent.anchor || intent.anchor?.contains(owner)) return true;
    if (intent.originSurface?.contains(owner)) return true;
    return Boolean(surfaceRegistry.get(intent.sessionId)?.contains(owner));
  };

  const tryPendingTerminalFocus = (intent: PendingTerminalFocusIntent) => {
    if (disposed || pendingTerminalFocusIntent !== intent) return false;
    if (!terminalFocusOwner() || !shouldAutoFocus()) {
      clearPendingTerminalFocusIntent(intent);
      return false;
    }
    if (intent.generation !== terminalFocusIntentGeneration || activeSessionId() !== intent.sessionId) {
      clearPendingTerminalFocusIntent(intent);
      return false;
    }

    const owner = typeof document === 'undefined' ? null : document.activeElement;
    if (!focusOwnerMatchesIntent(intent, owner)) {
      clearPendingTerminalFocusIntent(intent);
      return false;
    }
    if (owner && surfaceRegistry.get(intent.sessionId)?.contains(owner)) {
      clearPendingTerminalFocusIntent(intent);
      return true;
    }

    const focusResult = actionsRegistry.get(intent.sessionId)?.focusIfInteractive() ?? 'not_interactive';
    if (focusResult !== 'not_interactive') clearPendingTerminalFocusIntent(intent);
    return focusResult === 'focused';
  };

  const beginPendingTerminalFocus = (sessionId: string | null) => {
    terminalFocusIntentGeneration += 1;
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId || !terminalFocusOwner() || !shouldAutoFocus()) {
      pendingTerminalFocusIntent = null;
      return null;
    }

    const originSessionId = activeSessionId();
    const intent: PendingTerminalFocusIntent = {
      generation: terminalFocusIntentGeneration,
      sessionId: normalizedSessionId,
      anchor: typeof document === 'undefined' ? null : document.activeElement,
      originSurface: originSessionId ? surfaceRegistry.get(originSessionId) ?? null : null,
    };
    pendingTerminalFocusIntent = intent;
    return intent;
  };

  const handleTerminalInteractive = (sessionId: string) => {
    removeTerminalCreationTransitionBySessionId(sessionId);
    markTerminalPerformance('session-interactive', {
      session_ref: pseudonymousTerminalSessionRef(sessionId),
      variant,
    });
    terminalCatalog?.updateSessionMeta(sessionId, {
      isActive: true,
      lastActiveAtMs: Date.now(),
    });
    const intent = pendingTerminalFocusIntent;
    if (!intent || intent.sessionId !== sessionId) return;
    tryPendingTerminalFocus(intent);
  };

  const handlePendingTerminalFocusChange = (event: FocusEvent) => {
    const intent = pendingTerminalFocusIntent;
    if (!intent) return;
    const owner = event.target instanceof Element ? event.target : null;
    if (!focusOwnerMatchesIntent(intent, owner)) clearPendingTerminalFocusIntent(intent);
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('focusin', handlePendingTerminalFocusChange, true);
    onCleanup(() => document.removeEventListener('focusin', handlePendingTerminalFocusChange, true));
  }

  const sessionSelection = createUIFirstSelection<string | null, TerminalSessionSelectionMetadata>({
    committed: activeDisplaySessionId,
    commit: (sessionId, metadata) => {
      const focusIntent = metadata?.restoreFocus ? metadata.focusIntent ?? null : null;
      if (!metadata?.restoreFocus) clearPendingTerminalFocusIntent();
      setActiveSessionId(sessionId);
      if (isMobileLayout()) {
        setSessionDrawerOpen(false);
      }
      if (!focusIntent) return;
      deferAfterPaint(() => {
        tryPendingTerminalFocus(focusIntent);
      });
    },
    commitEqualRequests: true,
    onEvent: createUIPresentationEventRecorder({
      surface: 'terminal',
      source: 'session-nav',
      target: (sessionId) => sessionId ?? 'none',
    }),
  });
  const sidebarActiveSessionId = sessionSelection.visual;

  const requestSessionSelection = (sessionId: string, restoreFocus: boolean) => {
    const focusIntent = restoreFocus ? beginPendingTerminalFocus(sessionId) : null;
    sessionSelection.request(sessionId, {
      restoreFocus,
      ...(focusIntent ? { focusIntent } : {}),
    });
  };

  onCleanup(() => {
    tabActivityTracker.dispose();
  });

  const registerViewport = (id: string, viewport: SemanticTerminalViewportHandle | null) => {
    if (!id) return;
    if (viewport) {
      viewportRegistry.set(id, viewport);
      applyRegisteredTerminalAppearance(viewport);
      props.onWorkbenchTerminalViewportChange?.(id, viewport);
      setViewportRegistrySeq((v) => v + 1);
      return;
    }
    viewportRegistry.delete(id);
    props.onWorkbenchTerminalViewportChange?.(id, null);
    setViewportRegistrySeq((v) => v + 1);
  };

  const registerSurfaceElement = (id: string, surface: HTMLDivElement | null) => {
    if (!id) return;
    if (surface) {
      surfaceRegistry.set(id, surface);
      props.onWorkbenchTerminalSurfaceChange?.(id, surface);
      setSurfaceRegistrySeq((v) => v + 1);
      return;
    }
    surfaceRegistry.delete(id);
    props.onWorkbenchTerminalSurfaceChange?.(id, null);
    setSurfaceRegistrySeq((v) => v + 1);
  };

  const registerActions = (id: string, actions: TerminalSessionRuntimeActions | null) => {
    if (!id) return;
    if (actions) {
      actionsRegistry.set(id, actions);
      return;
    }
    actionsRegistry.delete(id);
  };

  const handleRuntimeStatus = (id: string, status: TerminalSessionRuntimeStatus) => {
    batch(() => {
      if (status.state === 'blocking') {
        removeTerminalCreationTransitionBySessionId(id);
      }
      setRuntimeStatusBySession((current) => {
        if (
          current[id]?.state === status.state
          && current[id]?.failureCode === status.failureCode
          && current[id]?.retryable === status.retryable
          && current[id]?.diagnosticsQuery === status.diagnosticsQuery
        ) return current;
        return { ...current, [id]: status };
      });
    });
  };

  const handleHistorySummary = (
    id: string,
    summary: Readonly<{ totalRows: number }>,
  ) => {
    const totalRows = Math.max(0, Math.floor(Number(summary.totalRows) || 0));
    setHistoryRowsBySession((current) => (
      current[id] === totalRows ? current : { ...current, [id]: totalRows }
    ));
  };

  const handleGeometryPresentation = (
    id: string,
    presentation: TerminalSharedGeometryPresentation | null,
  ) => {
    setGeometryPresentationBySession(current => {
      if (!presentation) {
        if (!current[id]) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      const previous = current[id];
      if (previous
        && previous.lifecycleEpoch === presentation.lifecycleEpoch
        && previous.rendererEpoch === presentation.rendererEpoch
        && previous.requestEpoch === presentation.requestEpoch
        && previous.local.cols === presentation.local.cols
        && previous.local.rows === presentation.local.rows
        && previous.effective.generation === presentation.effective.generation
        && previous.effective.presentationSequence === presentation.effective.presentationSequence
        && previous.effective.cols === presentation.effective.cols
        && previous.effective.rows === presentation.effective.rows) return current;
      return { ...current, [id]: presentation };
    });
  };

  const getActiveTerminalViewportElement = (): HTMLDivElement | null => {
    const sid = activeSessionId();
    if (!sid) return null;
    const surface = surfaceRegistry.get(sid);
    const viewport = surface?.parentElement;
    return viewport instanceof HTMLDivElement ? viewport : null;
  };

  const handleNameUpdate = (
    sessionId: string,
    newName: string,
    workingDir: string,
    localPathCapability: TerminalSessionInfo['localPathCapability'] | null,
  ) => {
    if (terminalCatalog) {
      terminalCatalog.updateSessionMeta(sessionId, {
        name: newName,
        workingDir,
        localPathCapability,
      });
    } else {
      fallbackSessionsCoordinator?.updateSessionMeta(sessionId, { name: newName, workingDir });
      const current = fallbackSessionsCoordinator?.getSnapshot()
        .find((session) => session.id === sessionId) as TerminalSessionInfo | undefined;
      if (current) {
        if (localPathCapability) {
          const nextSession: TerminalSessionInfo = { ...current, localPathCapability };
          fallbackSessionsCoordinator?.upsertSession(nextSession);
        } else {
          const { localPathCapability: _revoked, ...withoutCapability } = current;
          fallbackSessionsCoordinator?.upsertSession(withoutCapability);
        }
      }
    }
  };

  const handleThemeChange = (value: string): boolean => {
    if (value !== 'system' && !isTerminalThemeName(value)) return false;
    terminalPrefs.setUserTheme(value);
    return true;
  };

  let prevSessionsSnapshot: TerminalSessionInfo[] = [];
  let prevAuthoritativeSessionIds = new Set<string>();
  const handleSessionsSnapshot = (next: TerminalSessionInfo[]) => {
    const prev = prevSessionsSnapshot;
    const nextSessionIds = new Set(next.map((session) => String(session.id ?? '').trim()).filter(Boolean));
    for (const previousSessionId of prevAuthoritativeSessionIds) {
      if (!nextSessionIds.has(previousSessionId)) transport.forgetSession(previousSessionId);
    }
    prevAuthoritativeSessionIds = nextSessionIds;
    const visibleNext = mergeTerminalSessionLists(next, optimisticTerminalSessions(), optimisticClosingSessionIds());
    prevSessionsSnapshot = visibleNext;

    setAllSessions(next);
    setOptimisticTerminalSessions((previous) => {
      const filtered = previous.filter((session) => !nextSessionIds.has(session.id));
      return filtered.length === previous.length ? previous : filtered;
    });
    setOptimisticClosingSessionIds((previous) => {
      let changed = false;
      const filtered = new Set<string>();
      for (const sessionId of previous) {
        if (nextSessionIds.has(sessionId)) {
          filtered.add(sessionId);
        } else {
          changed = true;
        }
      }
      return changed ? filtered : previous;
    });

    const placement = sessionPlacementState();
    if (placement && props.onSessionPlacementStateChange) {
      const nextVisibleIds = placement.sessionIds.filter((sessionId) => visibleNext.some((session) => session.id === sessionId));
      const visibleSessions = nextVisibleIds
        .map((sessionId) => visibleNext.find((session) => session.id === sessionId) ?? null)
        .filter((session): session is TerminalSessionInfo => session !== null);
      const preferredActiveSessionId = placement.activeSessionId && nextVisibleIds.includes(placement.activeSessionId)
        ? placement.activeSessionId
        : null;
      const resolvedActiveSessionId = preferredActiveSessionId ?? pickPreferredActiveId(visibleSessions, null);
      const nextPlacementState: TerminalPanelSessionPlacementState = {
        sessionIds: nextVisibleIds,
        activeSessionId: resolvedActiveSessionId,
      };
      if (!sameTerminalPanelSessionPlacementState(placement, nextPlacementState)) {
        props.onSessionPlacementStateChange(nextPlacementState);
      }
      return;
    }

    const currentActive = activeDisplaySessionId();
    if (currentActive && pendingTerminalSessionById(currentActive)) {
      return;
    }
    if (currentActive && visibleNext.some((session) => session.id === currentActive)) {
      return;
    }

    let nextActive: string | null = null;
    if (currentActive) {
      const prevIdx = prev.findIndex((session) => session.id === currentActive);
      if (prevIdx >= 0) {
        nextActive = visibleNext[prevIdx]?.id ?? visibleNext[prevIdx - 1]?.id ?? null;
      }
    }

    if (!nextActive) {
      nextActive = pickPreferredActiveId(visibleNext, null);
    }

    setActiveSessionId(nextActive);
  };

  createEffect(() => {
    if (terminalCatalog) {
      handleSessionsSnapshot([...terminalCatalog.sessions()]);
      return;
    }
    const unsub = fallbackSessionsCoordinator?.subscribe((next: FloetermTerminalSessionInfo[]) => {
      handleSessionsSnapshot(next.flatMap((session) => {
        const groupId = String((session as Partial<TerminalSessionInfo>).groupId ?? '').trim();
        return groupId ? [{ ...session, groupId } as TerminalSessionInfo] : [];
      }));
    });
    if (!unsub) return;
    onCleanup(() => unsub());
  });

  createEffect(() => {
    const appearance = buildRegisteredTerminalAppearance();
    void viewportRegistrySeq();
    for (const viewport of viewportRegistry.values()) {
      applyRegisteredTerminalAppearance(viewport, appearance);
    }
  });

  const shouldMarkSessionUnread = (sessionId: string): boolean => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    return shouldMarkTerminalSessionUnread({
      sessionExists: sessions().some((session) => session.id === normalizedSessionId),
      sessionId: normalizedSessionId,
      activeSessionId: activeSessionId(),
      terminalFocusOwner: terminalFocusOwner(),
      panelHasFocus: panelHasFocus(),
    });
  };

  const handleShellIntegrationEvent = (
    sessionId: string,
    event: TerminalShellIntegrationEvent,
    source: 'history' | 'live',
  ) => {
    if (event.kind === 'cwd-update') {
      const workingDir = String(event.workingDir ?? '');
      if (terminalCatalog) {
        terminalCatalog.updateSessionMeta(sessionId, { workingDir });
      } else {
        fallbackSessionsCoordinator?.updateSessionMeta(sessionId, { workingDir });
      }
      return;
    }

    if (event.kind === 'command-start') {
      tabActivityTracker.handleCommandStart(sessionId);
      return;
    }

    if (event.kind === 'command-finish' || event.kind === 'prompt-ready') {
      if (event.kind === 'command-finish' && source === 'live') {
        tabActivityTracker.handleCommandFinish(sessionId, shouldMarkSessionUnread(sessionId));
        return;
      }
      tabActivityTracker.handlePromptReady(sessionId, source === 'live' && shouldMarkSessionUnread(sessionId));
      return;
    }

    if (event.kind === 'program-activity') {
      tabActivityTracker.handleProgramActivity(sessionId, event.phase);
    }
  };

  const handleOutputCommitted = (
    sessionId: string,
    source: 'history' | 'live',
    sequence: number | undefined,
  ) => {
    tabActivityTracker.handleOutputCommitted(sessionId, { source, sequence });
  };

  const handleOutputCoverage = (
    sessionId: string,
    update: { attachGeneration: number; coveredThroughSequence: number; rebased?: boolean },
  ) => {
    tabActivityTracker.handleOutputCoverage(sessionId, update);
  };

  const resetPendingOutput = (sessionId: string, opts?: { preserveUnread?: boolean }) => {
    tabActivityTracker.resetPendingOutput(sessionId, opts);
  };

  const handleVisibleOutput = (
    sessionId: string,
    source: 'history' | 'live',
    byteLength: number,
  ) => {
    tabActivityTracker.handleVisibleOutput(sessionId, {
      source,
      byteLength,
      shouldMarkUnread: shouldMarkSessionUnread(sessionId),
    });
  };

  const handleLiveOutputObserved = (
    sessionId: string,
    byteLength: number,
    sequence: number | undefined,
  ) => {
    if (byteLength <= 0) return;
    tabActivityTracker.handlePendingLiveOutput(sessionId, {
      sequence,
      shouldMarkUnread: shouldMarkSessionUnread(sessionId),
    });
  };

  const handleSessionBell = (sessionId: string) => {
    tabActivityTracker.handleBell(sessionId, shouldMarkSessionUnread(sessionId));
  };

  const openTerminalFileLinkTarget = async (target: TerminalResolvedLinkTarget) => {
    if (!canBrowseFiles() || !activeSessionChrome()?.canUseLocalPath) {
      return;
    }

    try {
      await filePreview.openPreview(fileItemFromPath(target.resolvedPath));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify.error(i18n.t('terminal.failedToOpenFilePreviewTitle'), message || i18n.t('terminal.couldNotOpenFileReference'));
    }
  };

  const openTerminalExternalLink = async (url: string) => {
    if (desktopShellExternalURLOpenAvailable()) {
      const result = await openExternalURLInDesktopShell(url);
      if (result?.ok) return;
      notify.error(
        i18n.t('terminal.failedToOpenFilePreviewTitle'),
        result?.message || i18n.t('terminal.couldNotOpenFileReference'),
      );
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const activeSession = createMemo<TerminalSessionInfo | null>(() => {
    const sid = activeSessionId();
    if (!sid) return null;
    return sessions().find((session) => session.id === sid) ?? null;
  });

  const [terminalChromeDeadlineRevision, setTerminalChromeDeadlineRevision] = createSignal(0);
  const fallbackRemoteOpeningObservedAtBySession = new Map<string, number>();
  const agentInitializationObservedAtBySession = new Map<string, number>();
  const agentIdentityBySession = new Map<string, string>();

  createEffect(() => {
    const currentSessions = sessions();
    terminalChromeDeadlineRevision();
    const nowMs = Date.now();
    let nextExpiryMs = Number.POSITIVE_INFINITY;
    const openingSessionIds = new Set<string>();

    for (const session of currentSessions) {
      const context = session.executionContext;
      const agentIdentity = context?.application.kind === 'agent_cli'
        ? String(context.application.identity ?? '').trim()
        : '';
      if (agentIdentity) {
        if (agentIdentityBySession.get(session.id) !== agentIdentity) {
          agentIdentityBySession.set(session.id, agentIdentity);
          agentInitializationObservedAtBySession.set(session.id, nowMs);
        }
        const workStateReady = session.workState?.phase !== undefined
          && session.workState.phase !== 'unknown'
          && session.workState.contextRevision === (session.executionContext?.revision ?? 0)
          && session.workState.foregroundCommandRevision === (session.foregroundCommand?.revision ?? 0);
        const outputStateReady = session.outputActivity?.phase !== undefined
          && session.outputActivity.phase !== 'unknown';
        if (workStateReady || outputStateReady) {
          agentInitializationObservedAtBySession.delete(session.id);
        } else {
          const observedAtMs = agentInitializationObservedAtBySession.get(session.id);
          if (observedAtMs !== undefined) {
            const deadlineMs = observedAtMs + TERMINAL_AGENT_INITIALIZATION_SPINNER_MS;
            if (deadlineMs > nowMs) nextExpiryMs = Math.min(nextExpiryMs, deadlineMs);
          }
        }
      } else {
        agentIdentityBySession.delete(session.id);
        agentInitializationObservedAtBySession.delete(session.id);
      }
      if (context?.location.kind !== 'remote' || context.location.phase !== 'opening') continue;
      openingSessionIds.add(session.id);
      const sharedObservedAtMs = terminalCatalog?.remoteOpeningObservedAtMs?.(session.id);
      const hasSharedObservation = typeof sharedObservedAtMs === 'number' && Number.isFinite(sharedObservedAtMs);
      const observedAtMs = hasSharedObservation
        ? sharedObservedAtMs
        : (fallbackRemoteOpeningObservedAtBySession.get(session.id) ?? nowMs);
      if (!hasSharedObservation) {
        fallbackRemoteOpeningObservedAtBySession.set(session.id, observedAtMs);
      }
      const deadlineMs = observedAtMs + TERMINAL_REMOTE_OPENING_SPINNER_MS;
      if (deadlineMs > nowMs) nextExpiryMs = Math.min(nextExpiryMs, deadlineMs);
    }

    for (const sessionId of fallbackRemoteOpeningObservedAtBySession.keys()) {
      if (!openingSessionIds.has(sessionId)) fallbackRemoteOpeningObservedAtBySession.delete(sessionId);
    }
    const currentSessionIds = new Set(currentSessions.map((session) => session.id));
    for (const sessionId of agentIdentityBySession.keys()) {
      if (!currentSessionIds.has(sessionId)) agentIdentityBySession.delete(sessionId);
    }
    for (const sessionId of agentInitializationObservedAtBySession.keys()) {
      if (!currentSessionIds.has(sessionId)) agentInitializationObservedAtBySession.delete(sessionId);
    }

    if (!Number.isFinite(nextExpiryMs)) return;
    const timer = globalThis.setTimeout(() => {
      setTerminalChromeDeadlineRevision((value) => value + 1);
    }, Math.max(1, nextExpiryMs - nowMs));
    onCleanup(() => globalThis.clearTimeout(timer));
  });

  const terminalChromeBySession = createMemo<ReadonlyMap<string, TerminalSessionChrome>>(() => {
    const foregroundPresentations = foregroundPresentationBySession();
    const tabStates = tabVisualStateBySession();
    const sharedAgentUnreadSessionIds = terminalCatalog?.agentUnreadSessionIds?.() ?? new Set<string>();
    const runtimeStatuses = runtimeStatusBySession();
    terminalChromeDeadlineRevision();
    const nowMs = Date.now();
    const chromeBySession = new Map<string, TerminalSessionChrome>();

    sessions().forEach((session, index) => {
      const fullPath = normalizeAskFlowerAbsolutePath(String(session.workingDir ?? '').trim());
      const fallbackLabel = buildTerminalSessionLabel(
        session,
        i18n.t('terminal.terminalName', { index: index + 1 }),
      );
      chromeBySession.set(session.id, deriveTerminalSessionChrome({
        session,
        directoryTitle: buildTerminalSidebarDirectoryTitle(fullPath, fallbackLabel),
        fallbackTitle: fallbackLabel,
        foregroundDisplayName: foregroundPresentations.get(session.id)?.displayName ?? '',
        foregroundRunning: foregroundPresentations.has(session.id),
        transition: resolveTerminalChromeTransition(runtimeStatuses[session.id]),
        unread: tabStates[session.id] === 'unread' || sharedAgentUnreadSessionIds.has(session.id),
        nowMs,
        remoteOpeningObservedAtMs: terminalCatalog?.remoteOpeningObservedAtMs?.(session.id)
          ?? fallbackRemoteOpeningObservedAtBySession.get(session.id),
        agentInitializationObservedAtMs: agentInitializationObservedAtBySession.get(session.id),
      }));
    });

    return chromeBySession;
  });

  const activeSessionChrome = createMemo(() => {
    const sessionId = activeSessionId();
    return sessionId ? terminalChromeBySession().get(sessionId) ?? null : null;
  });

  createEffect(() => {
    const terminalLabel = i18n.t('terminal.title');
    const session = activeSession();
    props.onTitleChange?.(session
      ? buildTerminalPanelTitle(session, terminalLabel, activeSessionChrome()?.title ?? '')
      : buildPendingTerminalPanelTitle(activePendingSession(), terminalLabel));
  });

  const activeSessionWorkingDir = createMemo(() => {
    const chrome = activeSessionChrome();
    if (!chrome?.canUseLocalPath) return '';
    return normalizeAskFlowerAbsolutePath(chrome?.localWorkingDir ?? '')
      || normalizeAskFlowerAbsolutePath(agentHomePathAbs())
      || '/';
  });

  const activeMobileKeyboardHistory = createMemo(() => {
    const sid = activeSessionId();
    if (!sid) return [] as string[];
    return mobileKeyboardHistoryBySession()[sid] ?? [];
  });

  const mobileKeyboardContext = createMemo(() => {
    const canUseLocalPath = Boolean(activeSessionChrome()?.canUseLocalPath);
    return deriveTerminalMobileKeyboardContext({
      state: mobileKeyboardDraftState(),
      workingDirAbs: activeSessionWorkingDir(),
      agentHomePathAbs: canUseLocalPath ? agentHomePathAbs() : '',
    });
  });

  const shouldUseFloeMobileKeyboard = createMemo(() => {
    return isMobileLayout() && mobileInputMode() === 'floe';
  });

  const mobileKeyboardSuggestions = createMemo<TerminalMobileKeyboardSuggestion[]>(() => {
    if (!shouldUseFloeMobileKeyboard()) return [];
    return buildTerminalMobileKeyboardSuggestions({
      context: mobileKeyboardContext(),
      history: activeMobileKeyboardHistory(),
      pathEntries: mobileKeyboardPathEntries(),
      packageScripts: mobileKeyboardPackageScripts(),
    });
  });

  const terminalViewportInsetPx = createMemo(() => {
    if (!shouldUseFloeMobileKeyboard() || !mobileKeyboardVisible()) return 0;
    return mobileKeyboardInsetPx();
  });

  const panelWorkState = createMemo<TerminalSessionWorkState>(() => {
    let hasTransition = false;
    for (const chrome of terminalChromeBySession().values()) {
      if (chrome.status === 'wave') return 'active';
      if (chrome.status === 'spinner') hasTransition = true;
    }
    return hasTransition ? 'running' : 'idle';
  });

  const terminalWorkIndicatorState = createMemo<TerminalSessionWorkState>(() => {
    if (!workIndicatorEnabled()) {
      return 'idle';
    }
    return variant === 'workbench' ? panelWorkState() : 'idle';
  });

  const terminalWorkIndicatorThicknessPx = createMemo(() => {
    return TERMINAL_WORK_INDICATOR_BASE_THICKNESS_PX;
  });

  const useMobileRecoveryStatusBar = createMemo(() => (
    shouldUseFloeMobileKeyboard() && mobileKeyboardVisible()
  ));

  const statusBarSessionLabel = createMemo(() => {
    const sid = activeSessionId();
    if (sid) return sid;

    const pending = activePendingSession();
    if (!pending) return '';
    return pending.status === 'failed' ? i18n.t('terminal.creationFailedStatus') : i18n.t('terminal.creatingStatus');
  });

  const activeRuntimeStatus = createMemo<TerminalSessionRuntimeStatus>(() => {
    const sid = activeSessionId();
    return sid ? runtimeStatusBySession()[sid] ?? { state: 'idle' } : { state: 'idle' };
  });

  const activeGeometryPresentation = createMemo<TerminalSharedGeometryPresentation | null>(() => {
    if (activeRuntimeStatus().state !== 'idle') return null;
    const id = activeDisplaySessionId();
    return id ? geometryPresentationBySession()[id] ?? null : null;
  });

  createEffect(() => {
    const presentation = activeGeometryPresentation();
    const id = activeDisplaySessionId();
    if (!presentation || !id || !viewActive() || !workbenchSelected()) {
      setSharedGeometryAnnouncement('');
      return;
    }
    const key = `${id}:${presentation.lifecycleEpoch}`;
    if (announcedGeometryLifecycles.has(key)) return;
    setSharedGeometryAnnouncement('');
    queueMicrotask(() => {
      if (activeDisplaySessionId() !== id || activeGeometryPresentation()?.lifecycleEpoch !== presentation.lifecycleEpoch) return;
      if (!viewActive() || !workbenchSelected() || announcedGeometryLifecycles.has(key)) return;
      announcedGeometryLifecycles.add(key);
      setSharedGeometryAnnouncement(i18n.t('terminal.sharedGeometry.announcement'));
    });
  });

  const showTerminalStatusBar = createMemo(() => {
    const hasSession = Boolean(activeSession() || activePendingSession());
    return hasSession;
  });

  const activeRuntimeStatusMessage = createMemo(() => {
    switch (activeRuntimeStatus().state) {
      case 'reconnecting':
        return i18n.t('terminal.reconnecting');
      case 'retrying':
        return i18n.t('terminal.retryingOlderOutput');
      case 'degraded':
        return i18n.t('terminal.olderOutputUnavailable');
      case 'blocking':
        return i18n.t('terminal.terminalUnavailable');
      default:
        return '';
    }
  });

  const retryActiveRuntime = async (trigger: HTMLButtonElement) => {
    const sid = activeSessionId();
    if (!sid) return;
    await actionsRegistry.get(sid)?.retryOutputRecovery();
    requestAnimationFrame(() => {
      if (activeSessionId() !== sid || !shouldAutoFocus()) return;
      if (document.activeElement === trigger) return;
      if (document.activeElement && document.activeElement !== document.body) return;
      actionsRegistry.get(sid)?.focusIfInteractive();
    });
  };

  const openActiveRuntimeDiagnostics = () => {
    const sid = activeSessionId();
    if (!sid) return;
    env.openDebugConsole({
      query: activeRuntimeStatus().diagnosticsQuery ?? 'terminal_recovery',
    });
  };

  const openRuntimeUpdate = () => {
    env.openSettings('runtime');
  };

  const shouldRestoreTerminalFocus = () => {
    return !isMobileLayout() || mobileInputMode() === 'system';
  };

  const ownsTerminalAttachment = () => {
    return workbenchSelected() && (!isEmbeddedWidget || panelHasFocus());
  };

  const shouldAutoFocus = () => {
    return ownsTerminalAttachment() && shouldRestoreTerminalFocus();
  };

  const blurActiveElement = () => {
    if (typeof document === 'undefined') return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  };

  const resolveTerminalInputElement = (surface: HTMLDivElement | null): HTMLTextAreaElement | null => {
    if (!surface) return null;
    const input = surface.querySelector(TERMINAL_INPUT_SELECTOR);
    return input instanceof HTMLTextAreaElement ? input : null;
  };

  const syncTerminalInputElementMode = (surface: HTMLDivElement | null) => {
    const input = resolveTerminalInputElement(surface);
    if (!input) return;

    input.autocapitalize = 'off';
    input.autocomplete = 'off';
    (input as unknown as { autocorrect?: string }).autocorrect = 'off';
    input.spellcheck = false;

    if (shouldUseFloeMobileKeyboard()) {
      input.setAttribute('inputmode', 'none');
      input.setAttribute('enterkeyhint', 'done');
      input.setAttribute('virtualkeyboardpolicy', 'manual');
      return;
    }

    input.setAttribute('inputmode', 'text');
    input.setAttribute('enterkeyhint', 'enter');
    input.removeAttribute('virtualkeyboardpolicy');
  };

  const syncAllTerminalInputElementModes = () => {
    for (const surface of surfaceRegistry.values()) {
      syncTerminalInputElementMode(surface);
    }
  };

  type TerminalFocusRestoreIntent = Readonly<{
    sessionId: string;
    anchor: Element | null;
    triggerElement: HTMLElement | null;
  }>;

  const captureTerminalFocusRestoreIntent = (
    sessionId: string,
    triggerElement: HTMLElement | null = null,
  ): TerminalFocusRestoreIntent => ({
    sessionId,
    anchor: typeof document === 'undefined' ? null : document.activeElement,
    triggerElement,
  });

  const focusOwnerMatchesRestoreIntent = (intent: TerminalFocusRestoreIntent) => {
    if (typeof document === 'undefined') return true;
    const owner = document.activeElement;
    if (owner === null || owner === document.body) return true;
    if (owner === intent.anchor || intent.anchor?.contains(owner)) return true;
    if (owner === intent.triggerElement || intent.triggerElement?.contains(owner)) return true;
    return Boolean(surfaceRegistry.get(intent.sessionId)?.contains(owner));
  };

  const restoreTerminalSessionFocus = (intent: TerminalFocusRestoreIntent, options: { activate?: boolean } = {}) => {
    requestAnimationFrame(async () => {
      if (!terminalFocusOwner() || !shouldRestoreTerminalFocus()) return;
      if (activeSessionId() !== intent.sessionId || !focusOwnerMatchesRestoreIntent(intent)) return;
      const viewport = viewportRegistry.get(intent.sessionId);
      if (!viewport) return;
      if (options.activate !== false) {
        try {
          await viewport.activate();
        } catch {
          // TerminalSessionRuntime already publishes the precise fail-closed status.
          return;
        }
      }
      if (!terminalFocusOwner() || activeSessionId() !== intent.sessionId) return;
      if (!focusOwnerMatchesRestoreIntent(intent)) return;
      if (options.activate === false) viewport.focus({ preventScroll: true });
      else actionsRegistry.get(intent.sessionId)?.focusIfInteractive();
    });
  };

  const restoreActiveTerminalFocus = () => {
    if (!shouldRestoreTerminalFocus()) return;
    const sid = activeSessionId();
    if (sid) restoreTerminalSessionFocus(captureTerminalFocusRestoreIntent(sid));
  };

  const dismissSessionDrawer = () => {
    setSessionDrawerOpen(false);
    queueMicrotask(() => {
      if (isMobileLayout() && sessionDrawerTriggerEl?.isConnected) {
        sessionDrawerTriggerEl.focus({ preventScroll: true });
        return;
      }
      restoreActiveTerminalFocus();
    });
  };

  const commitSidebarSessionSelection = (sessionId: string) => {
    requestSessionSelection(sessionId, true);
  };

  const previewSidebarSessionSelection = (event: PointerEvent, sessionId: string) => {
    if (event.button !== 0) return;
    sessionSelection.preview(sessionId);
  };

  const activeTerminalHasSelection = () => {
    const viewport = getActiveViewport();
    try {
      return Boolean(viewport?.hasSelection?.() ?? false);
    } catch {
      return false;
    }
  };

  const handleWorkbenchTerminalSurfaceClick = (event: MouseEvent) => {
    if (variant !== 'workbench') return;
    if (event.button !== 0) return;
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!terminalFocusOwner()) return;
    if (activeTerminalHasSelection()) return;
    restoreActiveTerminalFocus();
  };

  createEffect(() => {
    const activationSeq = props.workbenchActivationSeq ?? 0;
    void viewportRegistrySeq();
    if (variant !== 'workbench') return;
    if (activationSeq <= 0) return;
    if (!terminalFocusOwner()) return;
    restoreActiveTerminalFocus();
  });

  const openFloeMobileKeyboard = () => {
    if (!shouldUseFloeMobileKeyboard()) return;
    setMobileKeyboardVisible(true);
    requestAnimationFrame(() => {
      syncAllTerminalInputElementModes();
      getActiveTerminalInputElement()?.blur();
      blurActiveElement();
    });
  };

  let lastMobileKeyboardEligible = false;
  createEffect(() => {
    const eligible = shouldUseFloeMobileKeyboard() && connected() && Boolean(activeSessionId());
    if (eligible && !lastMobileKeyboardEligible) {
      setMobileKeyboardVisible(true);
    } else if (!eligible) {
      setMobileKeyboardVisible(false);
    }
    lastMobileKeyboardEligible = eligible;
  });

  createEffect(() => {
    void surfaceRegistrySeq();
    void viewportRegistrySeq();
    void shouldUseFloeMobileKeyboard();

    requestAnimationFrame(() => {
      syncAllTerminalInputElementModes();
    });
  });

  createEffect(() => {
    void surfaceRegistrySeq();
    const mobile = isMobileLayout();

    for (const surface of surfaceRegistry.values()) {
      surface.style.touchAction = resolveTerminalSurfaceTouchAction(mobile);
      surface.style.overscrollBehavior = mobile ? 'contain' : '';
    }
  });

  createEffect(() => {
    void activeSessionId();
    setMobileKeyboardDraftState(createEmptyTerminalMobileKeyboardDraftState());
  });

  createEffect(() => {
    const canUseLocalPath = Boolean(activeSessionChrome()?.canUseLocalPath);
    const query = mobileKeyboardContext().pathQuery;
    if (!canUseLocalPath || !shouldUseFloeMobileKeyboard() || !query) {
      setMobileKeyboardPathEntries([]);
      return;
    }

    const cacheKey = `${query.baseDirAbs}:${query.showHidden ? 'hidden' : 'visible'}`;
    const cached = mobileKeyboardPathCache.get(cacheKey);
    if (cached) {
      setMobileKeyboardPathEntries(cached);
    } else {
      setMobileKeyboardPathEntries([]);
    }

    let cancelled = false;
    void (async () => {
      if (cached) return;
      try {
        const resp = await rpc.fs.list({ path: query.baseDirAbs, showHidden: query.showHidden });
        if (cancelled) return;
        const entries: TerminalMobileKeyboardPathEntry[] = Array.isArray(resp?.entries)
          ? resp.entries.map((entry) => ({
            name: String(entry.name ?? '').trim(),
            path: String(entry.path ?? '').trim(),
            isDirectory: Boolean(entry.isDirectory),
          })).filter((entry) => entry.name && entry.path)
          : [];
        mobileKeyboardPathCache.set(cacheKey, entries);
        setMobileKeyboardPathEntries(entries);
      } catch {
        if (!cancelled) {
          setMobileKeyboardPathEntries([]);
        }
      }
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });

  createEffect(() => {
    const canUseLocalPath = Boolean(activeSessionChrome()?.canUseLocalPath);
    const workingDir = activeSessionWorkingDir();
    if (!canUseLocalPath || !shouldUseFloeMobileKeyboard() || !workingDir) {
      setMobileKeyboardPackageScripts([]);
      return;
    }

    const packageJsonPath = resolveTerminalMobileKeyboardPackageJsonPath(workingDir);
    if (!packageJsonPath) {
      setMobileKeyboardPackageScripts([]);
      return;
    }

    const cached = mobileKeyboardPackageScriptsCache.get(packageJsonPath);
    if (cached) {
      setMobileKeyboardPackageScripts(cached);
    } else {
      setMobileKeyboardPackageScripts([]);
    }

    let cancelled = false;
    void (async () => {
      if (cached) return;
      try {
        const resp = await rpc.fs.readFile({ path: packageJsonPath, encoding: 'utf8' });
        if (cancelled) return;
        const scripts = parseTerminalMobileKeyboardScripts(String(resp?.content ?? ''));
        mobileKeyboardPackageScriptsCache.set(packageJsonPath, scripts);
        setMobileKeyboardPackageScripts(scripts);
      } catch {
        if (!cancelled) {
          setMobileKeyboardPackageScripts([]);
        }
      }
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });

  const refreshSessions = async () => {
    if (!connected()) return;
    setSessionsLoading(true);
    try {
      await (terminalCatalog?.refresh() ?? fallbackSessionsCoordinator?.refresh());
    } catch (e) {
      if (handleExecuteDenied(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSessionsHydrated(true);
      setSessionsLoading(false);
    }
  };

  const handleTerminalSessionGone = (sessionId: string) => {
    removeTerminalCreationTransitionBySessionId(sessionId);
    transport.forgetSession(sessionId);
    prevAuthoritativeSessionIds.delete(sessionId);
    if (terminalCatalog) {
      terminalCatalog.removeSession(sessionId);
    } else {
      handleSessionsSnapshot(allSessions().filter((session) => session.id !== sessionId));
    }
    setOptimisticClosingSessionIds((previous) => {
      if (previous.has(sessionId)) return previous;
      const next = new Set(previous);
      next.add(sessionId);
      return next;
    });
    void (terminalCatalog?.refresh() ?? fallbackSessionsCoordinator?.refresh() ?? Promise.resolve()).catch(() => undefined);
  };

  const activateSession = (sessionId: string) => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) return;

    ensureSessionInPlacement(normalizedSessionId);
    setActiveSessionId(normalizedSessionId);
  };

  const mergeOptimisticTerminalSession = (session: TerminalSessionInfo): TerminalSessionInfo | null => {
    const normalized = normalizeTerminalSessionInfo(session);
    if (!normalized) return null;

    setOptimisticClosingSessionIds((previous) => {
      if (!previous.has(normalized.id)) return previous;
      const next = new Set(previous);
      next.delete(normalized.id);
      return next;
    });
    setOptimisticTerminalSessions((previous) => {
      const existingIndex = previous.findIndex((entry) => entry.id === normalized.id);
      if (existingIndex < 0) {
        return [...previous, normalized];
      }
      const next = [...previous];
      next[existingIndex] = normalized;
      return next;
    });
    return normalized;
  };

  const removeOptimisticTerminalSession = (sessionId: string) => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) return;
    setOptimisticTerminalSessions((previous) => previous.filter((session) => session.id !== normalizedSessionId));
  };

  const setOptimisticSessionClosing = (sessionId: string, closing: boolean) => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) return;
    setOptimisticClosingSessionIds((previous) => {
      if (closing && previous.has(normalizedSessionId)) return previous;
      if (!closing && !previous.has(normalizedSessionId)) return previous;
      const next = new Set(previous);
      if (closing) {
        next.add(normalizedSessionId);
      } else {
        next.delete(normalizedSessionId);
      }
      return next;
    });
  };

  const pickActiveSessionAfterClose = (sessionId: string): string | null => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    const realSessions = sessions();
    const currentIndex = realSessions.findIndex((session) => session.id === normalizedSessionId);
    if (currentIndex >= 0) {
      return realSessions[currentIndex + 1]?.id ?? realSessions[currentIndex - 1]?.id ?? null;
    }
    return realSessions.find((session) => session.id !== normalizedSessionId)?.id ?? null;
  };

  const createPanelSession = async (
    name: string | undefined,
    workingDir: string,
    groupId: string,
  ): Promise<terminal_panel_created_session | null> => {
    const normalizedWorkingDir = normalizeAskFlowerAbsolutePath(String(workingDir ?? '').trim()) || agentHomePathAbs() || '';
    if (props.sessionOperations) {
      return normalizeTerminalPanelSessionCreateResult(
        await props.sessionOperations.createSession(name, normalizedWorkingDir, groupId),
      );
    }

    const sessionCoordinator = terminalCatalog?.getCoordinator() ?? fallbackSessionsCoordinator;
    if (!sessionCoordinator) return null;
    const response = await rpc.terminal.createSession({
      name: String(name ?? '').trim() || undefined,
      workingDir: normalizedWorkingDir || undefined,
      groupId,
    });
    const session = response.session;
    if (!terminalCatalog) sessionCoordinator.upsertSession(session);
    return normalizeTerminalPanelSessionCreateResult(session);
  };

  const createPendingSession = (name: string | undefined, workingDir: string, groupId: string): pending_terminal_session => {
    const operationSequence = ++nextCreateOperationSequence;
    const pendingSession: pending_terminal_session = {
      id: createClientId('pending-terminal'),
      operationSequence,
      createdAtMs: Date.now(),
      name: String(name ?? '').trim() || i18n.t('terminal.title'),
      workingDir: normalizeAskFlowerAbsolutePath(String(workingDir ?? '').trim()) || agentHomePathAbs() || '',
      groupId,
      visibleSessionIdsAtCreate: sessions().map((session) => session.id),
      status: 'creating',
    };
    batch(() => {
      setPendingTerminalSessions((previous) => [...previous, pendingSession]);
      beginTerminalCreationTransition(pendingSession.id);
      setLocalActivePendingSessionId(pendingSession.id);
      selectOptimisticActiveDisplaySessionId(pendingSession.id);
    });
    markTerminalPerformance('create-intent', { operation_sequence: operationSequence });
    return pendingSession;
  };

  const removePendingSession = (
    pendingSessionId: string,
    options: Readonly<{ retainCreationTransition?: boolean }> = {},
  ) => {
    const normalizedPendingSessionId = String(pendingSessionId ?? '').trim();
    if (!normalizedPendingSessionId) return;
    batch(() => {
      setPendingTerminalSessions((previous) => previous.filter((session) => session.id !== normalizedPendingSessionId));
      if (!options.retainCreationTransition) {
        removeTerminalCreationTransitionByPendingId(normalizedPendingSessionId);
      }
      if (localActivePendingSessionId() === normalizedPendingSessionId) {
        setLocalActivePendingSessionId(null);
      }
    });
  };

  const failPendingSession = (pendingSessionId: string, errorMessage: string) => {
    const normalizedPendingSessionId = String(pendingSessionId ?? '').trim();
    if (!normalizedPendingSessionId) return;
    let updated = false;
    batch(() => {
      setPendingTerminalSessions((previous) => {
        const next = previous.map((session) => {
          if (session.id !== normalizedPendingSessionId) {
            return session;
          }
          updated = true;
          return {
            ...session,
            status: 'failed' as const,
            errorMessage: String(errorMessage ?? '').trim() || i18n.t('terminal.sessionCouldNotBeCreated'),
          };
        });
        return updated ? next : previous;
      });
      if (!updated) return;
      removeTerminalCreationTransitionByPendingId(normalizedPendingSessionId);
      setActiveSessionId(normalizedPendingSessionId);
    });
  };

  const resolvePendingSession = (pendingSessionId: string, sessionId: string) => {
    const normalizedPendingSessionId = String(pendingSessionId ?? '').trim();
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedPendingSessionId || !normalizedSessionId) return;

    setAuthoritativelyClaimedSessionIds((previous) => {
      if (previous.has(normalizedSessionId)) return previous;
      const next = new Set(previous);
      next.add(normalizedSessionId);
      return next;
    });

    if (!pendingTerminalSessionById(normalizedPendingSessionId)) {
      markSessionMounted(normalizedSessionId);
      activateSession(normalizedSessionId);
      return;
    }
    batch(() => {
      handoffTerminalCreationTransition(normalizedPendingSessionId, normalizedSessionId);
      removePendingSession(normalizedPendingSessionId, { retainCreationTransition: true });
      markSessionMounted(normalizedSessionId);
      activateSession(normalizedSessionId);
    });
  };

  const findResolvedSessionForRemovedPendingSession = (pendingSession: pending_terminal_session): string | null => {
    const authoritativeSessionIds = authoritativelyClaimedSessionIds();
    const session = sessions()
      .filter((candidate) => (
        !authoritativeSessionIds.has(candidate.id)
          && terminalSessionMatchesPendingSession(candidate, pendingSession)
      ))
      .sort((left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id))[0];
    return String(session?.id ?? '').trim() || null;
  };

  const beginCreateSession = async (name: string | undefined, workingDir: string, groupId: string): Promise<string | null> => {
    const pendingSession = createPendingSession(name, workingDir, groupId);
    terminalCatalog?.getCoordinator();
    const createFence = captureSessionMutationFence();
    // Let the optimistic tab reach the screen before starting the heavier RPC/state reconciliation path.
    await waitForTerminalUiPaint();
    markTerminalPerformance('pending-row-painted', { operation_sequence: pendingSession.operationSequence });
    if (!pendingTerminalSessionById(pendingSession.id)) return null;
    if (!sessionMutationFenceIsCurrent(createFence)) {
      removePendingSession(pendingSession.id);
      return null;
    }
    try {
      const result = await createPanelSession(name, pendingSession.workingDir, pendingSession.groupId ?? 'default');
      if (!sessionMutationFenceIsCurrent(createFence)) {
        removePendingSession(pendingSession.id);
        return null;
      }
      if (!result) throw new Error(i18n.t('terminal.invalidCreateResponse'));
      if (result.session) {
        mergeOptimisticTerminalSession(result.session);
        terminalCatalog?.upsertSession(result.session);
      } else {
        await (terminalCatalog?.refresh() ?? fallbackSessionsCoordinator?.refresh());
        if (!sessionMutationFenceIsCurrent(createFence)) {
          removePendingSession(pendingSession.id);
          return null;
        }
      }
      const sessionId = result.sessionId;
      markTerminalPerformance('create-ack', {
        operation_sequence: pendingSession.operationSequence,
        session_ref: pseudonymousTerminalSessionRef(sessionId),
      });
      resolvePendingSession(pendingSession.id, sessionId);
      return sessionId;
    } catch (e) {
      if (!sessionMutationFenceIsCurrent(createFence)) {
        removePendingSession(pendingSession.id);
        return null;
      }
      const hasCompetingCreate = pendingTerminalSessions().some((candidate) => (
        candidate.id !== pendingSession.id
          && candidate.status === 'creating'
          && pendingTerminalSessionsCompete(candidate, pendingSession)
      ));
      const resolvedSessionId = hasCompetingCreate
        ? null
        : findResolvedSessionForRemovedPendingSession(pendingSession);
      if (resolvedSessionId) {
        resolvePendingSession(pendingSession.id, resolvedSessionId);
        return resolvedSessionId;
      }
      if (handleExecuteDenied(e)) {
        removePendingSession(pendingSession.id);
        return null;
      }
      failPendingSession(pendingSession.id, e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const createSessionInGroup = async (groupId: string) => {
    if (!connected()) return;
    setError(null);
    const nextIndex = sessions().length + pendingTerminalSessions().length + 1;
    const group = terminalCatalog?.groups().find((candidate) => candidate.id === groupId);
    if (!group) {
      void terminalCatalog?.refreshGroups().catch(() => undefined);
      return;
    }
    expandNavigationGroup(group.id);
    void beginCreateSession(i18n.t('terminal.terminalName', { index: nextIndex }), group.defaultWorkingDir, group.id);
  };

  const activeGroupId = createMemo(() => activeSession()?.groupId || 'default');
  const createSession = () => createSessionInGroup(activeGroupId());

  let lastHandledOpenSessionRequestId = '';
  createEffect(() => {
    const request = props.openSessionRequest;
    const requestId = String(request?.requestId ?? '').trim();
    if (!requestId || requestId === lastHandledOpenSessionRequestId) return;
    if (!connected()) return;
    const currentMode = variant === 'workbench' ? 'workbench' : 'activity';
    const targetMode = request?.targetMode ?? currentMode;
    if (targetMode !== currentMode) return;

    const workingDir = normalizeAskFlowerAbsolutePath(String(request?.workingDir ?? '').trim());
    if (!workingDir) {
      lastHandledOpenSessionRequestId = requestId;
      props.onOpenSessionRequestHandled?.(requestId);
      setError(i18n.t('terminal.invalidWorkingDirectory'));
      return;
    }

    lastHandledOpenSessionRequestId = requestId;
    void (async () => {
      setError(null);
      try {
        const nextIndex = sessions().length + pendingTerminalSessions().length + 1;
        await beginCreateSession(
          resolveRequestedSessionName(request?.preferredName, workingDir, i18n.t('terminal.terminalName', { index: nextIndex })),
          workingDir,
          activeGroupId(),
        );
      } finally {
        props.onOpenSessionRequestHandled?.(requestId);
      }
    })();
  });

  const [clearingSessionId, setClearingSessionId] = createSignal<string | null>(null);

  const clearSession = async (
    sessionId: string,
    options?: { focusRestoreIntent?: TerminalFocusRestoreIntent },
  ) => {
    const sid = String(sessionId ?? '').trim();
    if (!sid || clearingSessionId()) return;
    setClearingSessionId(sid);
    setError(null);

    try {
      await clearSemanticTerminalContent(transport, sid);
      notify.success(
        i18n.t('terminal.clearSucceededTitle'),
        i18n.t('terminal.clearSucceededMessage'),
      );
      if (options?.focusRestoreIntent) {
        restoreTerminalSessionFocus(options.focusRestoreIntent);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!handleExecuteDenied(e)) {
        setError(message);
      }
      notify.error(
        i18n.t('terminal.clearFailedTitle'),
        message || i18n.t('terminal.clearFailedMessage'),
      );
    } finally {
      setClearingSessionId((current) => current === sid ? null : current);
    }
  };

  const clearActive = async () => {
    const sessionId = activeSessionId() ?? '';
    await clearSession(sessionId, {
      focusRestoreIntent: captureTerminalFocusRestoreIntent(sessionId),
    });
  };

  const [refreshing, setRefreshing] = createSignal(false);

  const waitForActions = async (sid: string, maxFrames = 4) => {
    for (let i = 0; i < maxFrames; i += 1) {
      const actions = actionsRegistry.get(sid);
      if (actions) return actions;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return null;
  };

  const handleRefresh = async () => {
    if (!connected() || refreshing()) return;

    setRefreshing(true);
    setError(null);

    try {
      await refreshSessions();

      const sid = activeSessionId();
      if (sid) {
        // Explicit refresh replaces only this view attachment and bootstraps
        // the latest atomic semantic Presentation.
        const actions = await waitForActions(sid);
        await actions?.reload();
      }
    } catch (e) {
      if (handleExecuteDenied(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const closeSession = (id: string) => {
    void (async () => {
      const normalizedSessionId = String(id ?? '').trim();
      let deleteFence: terminal_session_mutation_fence | null = null;
      try {
        if (!normalizedSessionId) return;
        if (pendingTerminalSessionById(normalizedSessionId)) {
          removePendingSession(normalizedSessionId);
          return;
        }
        removeTerminalCreationTransitionBySessionId(normalizedSessionId);
        terminalCatalog?.getCoordinator();
        deleteFence = captureSessionMutationFence();
        if (!sessionMutationFenceIsCurrent(deleteFence)) return;

        const nextActiveSessionId = activeDisplaySessionId() === normalizedSessionId
          ? pickActiveSessionAfterClose(normalizedSessionId)
          : activeDisplaySessionId();
        retainMountedSessionUntilAfterPaint(normalizedSessionId);
        setOptimisticSessionClosing(normalizedSessionId, true);
        removeOptimisticTerminalSession(normalizedSessionId);
        if (activeDisplaySessionId() === normalizedSessionId) {
          setActiveSessionId(nextActiveSessionId);
        }

        await waitForTerminalUiPaint();
        if (!sessionMutationFenceIsCurrent(deleteFence)) {
          setOptimisticSessionClosing(normalizedSessionId, false);
          return;
        }

        if (props.sessionOperations) {
          await props.sessionOperations.deleteSession(normalizedSessionId);
          if (!sessionMutationFenceIsCurrent(deleteFence)) {
            setOptimisticSessionClosing(normalizedSessionId, false);
            return;
          }
          terminalCatalog?.removeSession(normalizedSessionId);
        } else {
          const sessionCoordinator = terminalCatalog?.getCoordinator() ?? fallbackSessionsCoordinator;
          if (!sessionCoordinator) throw new Error('Terminal session catalog is unavailable');
          await sessionCoordinator.deleteSession(normalizedSessionId);
          if (!sessionMutationFenceIsCurrent(deleteFence)) {
            setOptimisticSessionClosing(normalizedSessionId, false);
            return;
          }
          if (terminalCatalog) await terminalCatalog.refresh();
        }
        transport.forgetSession(normalizedSessionId);
      } catch (e) {
        setOptimisticSessionClosing(normalizedSessionId, false);
        if (deleteFence && !sessionMutationFenceIsCurrent(deleteFence)) return;
        void (terminalCatalog?.refresh() ?? fallbackSessionsCoordinator?.refresh() ?? Promise.resolve()).catch(() => undefined);
        if (handleExecuteDenied(e)) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  createEffect(() => {
    if (terminalCatalog) {
      setSessionsHydrated(terminalCatalog.hydrated());
      setSessionsLoading(terminalCatalog.loading());
      const catalogError = terminalCatalog.error();
      if (catalogError) {
        mirroredCatalogError = catalogError;
        setError(catalogError);
      } else if (mirroredCatalogError) {
        const previousCatalogError = mirroredCatalogError;
        mirroredCatalogError = null;
        setError((current) => current === previousCatalogError ? null : current);
      }
      return;
    }
    const client = protocol.session?.();
    if (!client) {
      batch(() => {
        setSessionsHydrated(false);
        setSessionsLoading(false);
      });
      return;
    }

    let cancelled = false;
    batch(() => {
      setSessionsHydrated(false);
      setSessionsLoading(true);
    });
    void (async () => {
      try {
        await fallbackSessionsCoordinator?.refresh();
      } catch (e) {
        if (cancelled) return;
        if (handleExecuteDenied(e)) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) {
          batch(() => {
            setSessionsHydrated(true);
            setSessionsLoading(false);
          });
        }
      }
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });

  const renderableSessions = createMemo<TerminalSessionInfo[]>((previous) => {
    const list = sessions();
    const visibleSessionIds = new Set(list.map((session) => session.id));
    const retainedSessions = Object.values(retainedClosingSessions())
      .filter((session) => !visibleSessionIds.has(session.id));
    return preserveStableTerminalSessionReferences([...list, ...retainedSessions], previous);
  }, []);
  const sessionPanelIds = createMemo(() => renderableSessions().map((session) => session.id));
  const activeUnmountedSession = createMemo<TerminalSessionInfo | null>(() => {
    const activeId = activeSessionId();
    if (!activeId) return null;
    if (mountedSessionIds().has(activeId)) return null;
    return sessions().find((session) => session.id === activeId) ?? null;
  });

  let mountedInitialActiveSession = false;
  createEffect(() => {
    const id = activeSessionId();
    if (!id) return;
    if (!sessions().some((s) => s.id === id)) return;
    if (mountedSessionIds().has(id)) return;

    if (!mountedInitialActiveSession) {
      mountedInitialActiveSession = true;
      markSessionMounted(id);
      return;
    }

    mountedInitialActiveSession = true;
    markSessionMounted(id);
  });

  createEffect(() => {
    const sharedReaderSessionId = terminalFocusOwner() && panelHasFocus()
      ? activeSessionId()
      : null;
    terminalCatalog?.setAgentSessionReader?.(agentAttentionReaderId, sharedReaderSessionId);
    if (!sharedReaderSessionId) return;
    const id = activeSessionId();
    if (!id) return;
    tabActivityTracker.clearUnread(id);
  });

  onCleanup(() => {
    terminalCatalog?.setAgentSessionReader?.(agentAttentionReaderId, null);
  });

  createEffect(() => {
    const mountedIds = new Set(renderableSessions().map((s) => s.id));
    setMountedSessionIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (mountedIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  });

  createEffect(() => {
    const ids = new Set(sessions().map((s) => s.id));
    const pendingIds = new Set(pendingTerminalSessions().map((session) => session.id));

    tabActivityTracker.pruneSessions(ids);

    setTerminalCreationTransitions((previous) => {
      const next = previous.filter((transition) => (
        pendingIds.has(transition.pendingSessionId)
        || Boolean(transition.sessionId && ids.has(transition.sessionId))
      ));
      return next.length === previous.length ? previous : next;
    });

    setTabVisualStateBySession((prev) => {
      let changed = false;
      const next: TerminalSessionTabVisualStateMap = {};
      for (const [id, state] of Object.entries(prev)) {
        if (ids.has(id)) {
          next[id] = state;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    setRuntimeStatusBySession((prev) => {
      let changed = false;
      const next: Record<string, TerminalSessionRuntimeStatus> = {};
      for (const [id, status] of Object.entries(prev)) {
        if (ids.has(id)) {
          next[id] = status;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  });

  createEffect(() => {
    const id = activeSessionId();
    writeActiveSessionId(activeSessionStorageKey, id && !pendingTerminalSessionById(id) ? id : null);
  });

  const sessionListItems = createMemo<TerminalSessionNavigationItem[]>(() => {
    const list = sessions();
    const chromeBySession = terminalChromeBySession();
    const runtimeStatuses = runtimeStatusBySession();
    const canOpenPath = canBrowseFiles();
    const sessionItems = list.map((s, index) => {
      const fallbackLabel = buildTerminalSessionLabel(s, i18n.t('terminal.terminalName', { index: index + 1 }));
      const chrome = chromeBySession.get(s.id) ?? deriveTerminalSessionChrome({
        session: s,
        directoryTitle: buildTerminalSidebarDirectoryTitle(s.workingDir, fallbackLabel),
        fallbackTitle: fallbackLabel,
      });
      return {
        id: s.id,
        label: fallbackLabel,
        title: chrome.title,
        avatarInitial: buildTerminalSidebarAvatarInitial(chrome.title),
        avatarTone: buildTerminalSidebarAvatarTone(`${s.id}:${chrome.displayPath}:${chrome.title}`),
        avatar: chrome.avatar,
        subtitleIcon: chrome.subtitleIcon,
        subtitle: chrome.subtitle,
        fullPath: chrome.displayPath,
        localWorkingDir: chrome.localWorkingDir,
        transitionIndicator: resolveTerminalTransitionIndicator(chrome),
        processRunning: chrome.processRunning,
        transitionState: chrome.status === 'failed'
          ? 'failed' as const
          : resolveTerminalChromeTransition(runtimeStatuses[s.id]) === 'reconnecting'
            ? 'reconnecting' as const
            : chrome.remotePhase === 'opening'
              ? 'opening' as const
              : 'none' as const,
        failureKind: chrome.status === 'failed' ? 'runtime' as const : 'none' as const,
        outputState: chrome.status === 'wave' ? 'streaming' as const : 'none' as const,
        activitySource: chrome.status === 'wave' && chrome.statusSource === 'semantic'
          ? 'semantic' as const
          : chrome.status === 'wave' && chrome.statusSource === 'output'
            ? 'output' as const
            : 'none' as const,
        attentionState: resolveTerminalSidebarAttentionState(chrome),
        remote: chrome.remote,
        canBrowsePath: chrome.canUseLocalPath && Boolean(chrome.localWorkingDir) && canOpenPath,
        filesAvailability: chrome.remote
          ? 'remote' as const
          : !canOpenPath
            ? 'permission' as const
            : s.executionContext?.location.kind !== 'local'
              || s.executionContext.location.phase !== 'ready'
              || s.executionContext.location.source !== 'shell_integration'
              ? 'verifying' as const
              : !chrome.canUseLocalPath || !chrome.localWorkingDir
                ? 'invalid' as const
                : 'available' as const,
        canClear: true,
        canDuplicate: chrome.canUseLocalPath && Boolean(chrome.localWorkingDir),
        closable: true,
      };
    });
    const pendingItems = visiblePendingTerminalSessions().map((session) => {
      const fullPath = normalizeAskFlowerAbsolutePath(String(session.workingDir ?? '').trim());
      const fallbackLabel = buildPendingTerminalSessionLabel(session, i18n.t('terminal.title'));
      const title = buildTerminalSidebarDirectoryTitle(fullPath, fallbackLabel);
      return {
        id: session.id,
        label: fallbackLabel,
        title,
        avatarInitial: buildTerminalSidebarAvatarInitial(title),
        avatarTone: buildTerminalSidebarAvatarTone(`${session.id}:${fullPath}:${title}`),
        avatar: { kind: 'initial' as const },
        subtitleIcon: 'none' as const,
        subtitle: fullPath,
        fullPath,
        localWorkingDir: '',
        transitionIndicator: session.status === 'failed' ? 'failed' as const : 'spinner' as const,
        processRunning: false,
        transitionState: session.status === 'failed' ? 'failed' as const : 'creating' as const,
        failureKind: session.status === 'failed' ? 'creation' as const : 'none' as const,
        outputState: 'none' as const,
        activitySource: 'none' as const,
        attentionState: 'none' as const,
        remote: false,
        canBrowsePath: false,
        filesAvailability: 'verifying' as const,
        canClear: false,
        canDuplicate: false,
        closable: session.status === 'failed',
      };
    });
    return [...sessionItems, ...pendingItems];
  });
  const sessionListItemById = createMemo(() => new Map(sessionListItems().map((item) => [item.id, item])));
  createEffect(() => {
    const menu = terminalSidebarMenu();
    if (menu?.kind === 'session' && !sessionListItemById().has(menu.sessionId)) {
      setTerminalSidebarMenu(null);
    }
  });
  const sessionListItemIds = createMemo((previous: readonly string[] = []) => {
    const query = sessionFilterQuery().trim().toLocaleLowerCase();
    const next = sessionListItems().filter((item) => {
      if (!query) return true;
      return [item.label, item.title, item.subtitle, item.fullPath, item.id]
        .some((value) => value.toLocaleLowerCase().includes(query));
    }).map((item) => item.id);
    return sameSessionIdList(previous, next) ? previous : next;
  });
  const terminalGroups = createMemo<readonly TerminalGroup[]>(() => terminalCatalog?.groups() ?? []);
  createEffect(() => {
    const menu = terminalSidebarMenu();
    if (menu?.kind === 'group' && !terminalGroups().some((group) => group.id === menu.groupId)) {
      setTerminalSidebarMenu(null);
    }
  });
  const groupIdBySessionItem = createMemo(() => {
    const byId = new Map(sessions().map((session) => [session.id, session.groupId]));
    for (const pending of visiblePendingTerminalSessions()) byId.set(pending.id, pending.groupId);
    return byId;
  });
  createEffect(() => {
    const knownGroupIds = new Set(terminalGroups().map((group) => group.id));
    if (sessions().some((session) => session.groupId && !knownGroupIds.has(session.groupId))) {
      void terminalCatalog?.refreshGroups().catch(() => undefined);
    }
  });
  const navigationGroups = createMemo<readonly TerminalSessionNavigationGroup[]>(() => {
    const query = sessionFilterQuery().trim().toLocaleLowerCase();
    const visibleItemIds = new Set(sessionListItemIds());
    const allItemIdsByGroup = new Map<string, string[]>();
    for (const item of sessionListItems()) {
      const groupId = groupIdBySessionItem().get(item.id);
      if (!groupId) continue;
      const ids = allItemIdsByGroup.get(groupId) ?? [];
      ids.push(item.id);
      allItemIdsByGroup.set(groupId, ids);
    }
    const globalCounts = new Map<string, number>();
    for (const session of terminalCatalog?.sessions() ?? sessions()) {
      if (!session.groupId) continue;
      globalCounts.set(session.groupId, (globalCounts.get(session.groupId) ?? 0) + 1);
    }
    return terminalGroups().flatMap((group) => {
      const allItemIds = allItemIdsByGroup.get(group.id) ?? [];
      const groupMatches = Boolean(query) && [group.name, group.defaultWorkingDir]
        .some((value) => value.toLocaleLowerCase().includes(query));
      const itemIds = groupMatches ? allItemIds : allItemIds.filter((id) => visibleItemIds.has(id));
      if (query && !groupMatches && itemIds.length === 0) return [];
      const searchRevealsGroup = Boolean(query) && (groupMatches || itemIds.length > 0);
      return [{
        id: group.id,
        name: group.name,
        defaultWorkingDir: group.defaultWorkingDir,
        isDefault: group.isDefault,
        pending: group.pending,
        expanded: searchRevealsGroup || !collapsedGroupIds().has(group.id),
        itemIds,
        totalSessionCount: globalCounts.get(group.id) ?? 0,
      }];
    });
  });

  const toggleNavigationGroup = (groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const openGroupEditor = (groupId: string) => {
    const group = terminalGroups().find((candidate) => candidate.id === groupId);
    if (!group) return;
    setGroupEditorTarget(group);
  };

  const submitGroupEditor = (name: string, defaultWorkingDir: string) => {
    const target = groupEditorTarget();
    if (!target || !terminalCatalog) return;
    setGroupEditorTarget(null);
    const operation = target === 'create'
      ? terminalCatalog.createGroup({ name, defaultWorkingDir })
      : terminalCatalog.updateGroup({
          groupId: target.id,
          ...(target.isDefault ? {} : { name }),
          defaultWorkingDir,
        });
    void operation.catch((cause) => {
      notify.error(
        target === 'create' ? i18n.t('terminal.newGroup') : i18n.t('terminal.editGroup'),
        cause instanceof Error ? cause.message : String(cause),
      );
    });
  };

  const confirmDeleteGroup = () => {
    const target = groupDeleteTarget();
    if (!target || !terminalCatalog) return;
    setGroupDeleteTarget(null);
    void terminalCatalog.deleteGroup(target.id).then((result) => {
      if (result.failedSessionIds.length > 0) {
        notify.error(
          i18n.t('terminal.groupDeletePartialFailureTitle'),
          i18n.t('terminal.groupDeletePartialFailureMessage', { count: result.failedSessionIds.length }),
        );
      }
    }).catch((cause) => {
      notify.error(i18n.t('terminal.groupDeleteFailedTitle'), cause instanceof Error ? cause.message : String(cause));
    });
  };

  const relocateSession = (sessionId: string, groupId: string, beforeSessionId: string | null) => {
    if (!terminalCatalog) return;
    expandNavigationGroup(groupId);
    const previousOrder = terminalCatalog.sessions().map((session) => session.id);
    const previousIndex = previousOrder.indexOf(sessionId);
    const previousBeforeSessionId = previousIndex >= 0 ? previousOrder[previousIndex + 1] ?? null : null;
    const sourceGroupId = terminalCatalog.sessions().find((session) => session.id === sessionId)?.groupId;

    terminalCatalog.reorderSession(sessionId, beforeSessionId);

    if (!sourceGroupId || sourceGroupId === groupId) return;
    void terminalCatalog.moveSession(sessionId, groupId).catch((cause) => {
      terminalCatalog.reorderSession(sessionId, previousBeforeSessionId);
      notify.error(i18n.t('terminal.groupMoveFailedTitle'), cause instanceof Error ? cause.message : String(cause));
    });
  };

  const moveSessionToGroup = (sessionId: string, groupId: string) => {
    relocateSession(sessionId, groupId, null);
  };

  const reorderTerminalGroup = (groupId: string, beforeGroupId: string | null) => {
    if (!terminalCatalog) return;
    const groupName = terminalGroups().find((group) => group.id === groupId)?.name ?? '';
    void terminalCatalog.reorderGroup(groupId, beforeGroupId).catch((cause) => {
      notify.error(
        i18n.t('terminal.groupActions', { group: groupName }),
        cause instanceof Error ? cause.message : String(cause),
      );
    });
  };
  let statusBoundaryBySessionId = new Map<string, 'none' | 'waiting' | 'failed'>();
  let statusBoundaryConnectionEpoch = terminalCatalog?.connectionEpoch() ?? 0;
  createEffect(() => {
    const connectionEpoch = terminalCatalog?.connectionEpoch() ?? 0;
    if (connectionEpoch !== statusBoundaryConnectionEpoch) {
      statusBoundaryBySessionId = new Map();
      statusBoundaryConnectionEpoch = connectionEpoch;
    }
    const nextBoundaries = new Map<string, 'none' | 'waiting' | 'failed'>();
    const enteredDescriptions: string[] = [];
    for (const item of sessionListItems()) {
      const boundary = item.failureKind !== 'none'
        ? 'failed' as const
        : item.attentionState === 'waiting'
          ? 'waiting' as const
          : 'none' as const;
      nextBoundaries.set(item.id, boundary);
      if (boundary !== 'none' && statusBoundaryBySessionId.get(item.id) !== boundary) {
        const status = item.failureKind === 'creation'
          ? i18n.t('terminal.creationFailedStatus')
          : item.failureKind === 'runtime'
            ? i18n.t('terminal.terminalUnavailable')
            : item.attentionState === 'waiting'
              ? i18n.t('terminalAgentActivity.userInputRequired')
              : '';
        if (status) {
          const label = item.label.trim();
          const title = item.title.trim();
          const identity = label && title && label !== title
            ? i18n.t('terminal.sessionIdentityWithTitle', { label, title })
            : label || title;
          enteredDescriptions.push(i18n.t('terminal.statusAnnouncement', {
            identity,
            status: terminalStatusSentence(status, i18n.t),
          }));
        }
      }
    }
    statusBoundaryBySessionId = nextBoundaries;
    if (enteredDescriptions.length > 0) {
      terminalStatusAnnouncementSequence += 1;
      setTerminalStatusAnnouncement({
        sequence: terminalStatusAnnouncementSequence,
        text: joinTerminalStatusAnnouncements(enteredDescriptions, i18n.t),
      });
    }
  });

  let searchInputEl: HTMLInputElement | null = null;
  let rootEl: HTMLDivElement | null = null;
  let mobileToolbarEl: HTMLDivElement | null = null;
  const [mobileKeyboardElement, setMobileKeyboardElement] = createSignal<HTMLDivElement | null>(null);

  const getActiveViewport = () => {
    const sid = activeSessionId();
    if (!sid) return null;
    return viewportRegistry.get(sid) ?? null;
  };

  const getActiveSurfaceElement = () => {
    const sid = activeSessionId();
    if (!sid) return null;
    return surfaceRegistry.get(sid) ?? null;
  };

  const getActiveTerminalInputElement = () => {
    return resolveTerminalInputElement(getActiveSurfaceElement());
  };

  const getTerminalTouchScrollLineHeightPx = (
    surface: HTMLDivElement,
    viewport: SemanticTerminalViewportHandle,
  ) => {
    const rows = Math.max(1, viewport.getDimensions().rows);
    const height = surface.getBoundingClientRect().height;
    if (!Number.isFinite(height) || height <= 0) {
      return MOBILE_TERMINAL_TOUCH_SCROLL_LINE_HEIGHT_FALLBACK_PX;
    }

    return Math.max(MOBILE_TERMINAL_TOUCH_SCROLL_MIN_LINE_HEIGHT_PX, height / rows);
  };

  const applyTerminalTouchScrollLines = (
    sessionId: string,
    viewport: SemanticTerminalViewportHandle,
    lineDelta: number,
  ): boolean => {
    if (lineDelta === 0) return false;

    const target = resolveTerminalTouchScrollTarget(viewport);
    if (!target) return false;

    if (target.isAlternateScreen?.()) {
      const sequence = (lineDelta > 0 ? '\x1B[B' : '\x1B[A').repeat(Math.abs(lineDelta));
      if (!sequence) return false;

      target.sendAlternateScreenInput(sequence);
      return true;
    }

    if ((target.getScrollbackLength?.() ?? 0) <= 0) return false;
    if (typeof target.scrollLines !== 'function') return false;

    target.scrollLines(lineDelta);
    return true;
  };

  const recordMobileKeyboardHistory = (sessionId: string, command: string) => {
    setMobileKeyboardHistoryBySession((prev) => {
      const current = prev[sessionId] ?? [];
      const next = rememberTerminalMobileKeyboardHistory(current, command);
      if (next === current) return prev;
      return { ...prev, [sessionId]: next };
    });
  };

  const syncMobileKeyboardInset = () => {
    const keyboardEl = mobileKeyboardElement();
    if (!shouldUseFloeMobileKeyboard() || !mobileKeyboardVisible() || !keyboardEl) {
      setMobileKeyboardInsetPx(0);
      return;
    }

    setMobileKeyboardInsetPx(resolveTerminalMobileKeyboardInsetPx({
      viewportEl: getActiveTerminalViewportElement(),
      keyboardEl,
    }));
  };

  const cancelScheduledMobileKeyboardInsetSync = () => {
    if (mobileKeyboardInsetSyncRaf === null) return;
    cancelAnimationFrame(mobileKeyboardInsetSyncRaf);
    mobileKeyboardInsetSyncRaf = null;
  };

  const scheduleMobileKeyboardInsetSync = () => {
    if (mobileKeyboardInsetSyncRaf !== null) return;
    mobileKeyboardInsetSyncRaf = requestAnimationFrame(() => {
      mobileKeyboardInsetSyncRaf = null;
      syncMobileKeyboardInset();
    });
  };

  createEffect(() => {
    void shouldUseFloeMobileKeyboard();
    void mobileKeyboardVisible();
    void activeSessionId();
    void surfaceRegistrySeq();
    const el = mobileKeyboardElement();

    const viewportEl = getActiveTerminalViewportElement();
    if (!el || !viewportEl) {
      setMobileKeyboardInsetPx(0);
      return;
    }

    scheduleMobileKeyboardInsetSync();

    if (!shouldUseFloeMobileKeyboard() || !mobileKeyboardVisible()) {
      return;
    }

    const scheduleSync = () => {
      scheduleMobileKeyboardInsetSync();
    };
    const visualViewport = typeof window !== 'undefined' ? window.visualViewport : null;
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
        scheduleSync();
      });
    observer?.observe(el);
    observer?.observe(viewportEl);
    window.addEventListener('resize', scheduleSync);
    window.addEventListener('orientationchange', scheduleSync);
    visualViewport?.addEventListener('resize', scheduleSync);
    visualViewport?.addEventListener('scroll', scheduleSync);

    onCleanup(() => {
      cancelScheduledMobileKeyboardInsetSync();
      observer?.disconnect();
      window.removeEventListener('resize', scheduleSync);
      window.removeEventListener('orientationchange', scheduleSync);
      visualViewport?.removeEventListener('resize', scheduleSync);
      visualViewport?.removeEventListener('scroll', scheduleSync);
    });
  });

  createEffect(() => {
    const sid = activeSessionId();
    const inset = terminalViewportInsetPx();
    if (!sid) return;
    if (!connected()) return;

    const viewport = viewportRegistry.get(sid);
    if (!viewport) return;

    requestAnimationFrame(() => {
      if (activeSessionId() !== sid) return;
      if (!connected()) return;
      if (terminalViewportInsetPx() !== inset) return;
      viewport.forceResize();
    });
  });

  createEffect(() => {
    void surfaceRegistrySeq();
    void viewportRegistrySeq();
    const sid = activeSessionId();
    const surface = getActiveSurfaceElement();
    const viewport = getActiveViewport();
    const mobile = isMobileLayout();

    if (!mobile || !sid || !surface || !viewport) return;

    let pointerId: number | null = null;
    let lastY = 0;
    let accumulatedPx = 0;

    const resetGesture = () => {
      if (pointerId === null) return;

      if (typeof surface.hasPointerCapture === 'function' && surface.hasPointerCapture(pointerId)) {
        try {
          surface.releasePointerCapture(pointerId);
        } catch {
        }
      }

      pointerId = null;
      lastY = 0;
      accumulatedPx = 0;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !event.isPrimary) return;

      pointerId = event.pointerId;
      lastY = event.clientY;
      accumulatedPx = 0;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;

      const deltaY = event.clientY - lastY;
      lastY = event.clientY;
      accumulatedPx += deltaY;

      const lineHeightPx = getTerminalTouchScrollLineHeightPx(surface, viewport);
      const rawLineDelta = -accumulatedPx / lineHeightPx;
      const wholeLineDelta = rawLineDelta > 0 ? Math.floor(rawLineDelta) : Math.ceil(rawLineDelta);
      if (wholeLineDelta === 0) return;

      if (!applyTerminalTouchScrollLines(sid, viewport, wholeLineDelta)) {
        accumulatedPx = 0;
        return;
      }

      accumulatedPx += wholeLineDelta * lineHeightPx;
      if (typeof surface.setPointerCapture === 'function') {
        try {
          surface.setPointerCapture(event.pointerId);
        } catch {
        }
      }
      event.preventDefault();
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      resetGesture();
    };

    surface.addEventListener('pointerdown', onPointerDown);
    surface.addEventListener('pointermove', onPointerMove);
    surface.addEventListener('pointerup', onPointerEnd);
    surface.addEventListener('pointercancel', onPointerEnd);

    onCleanup(() => {
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerup', onPointerEnd);
      surface.removeEventListener('pointercancel', onPointerEnd);
      resetGesture();
    });
  });

  const handleMobileKeyboardPayload = (payload: string) => {
    const sid = activeSessionId();
    if (!sid || !connected()) return;

    const update = applyTerminalMobileKeyboardPayload({
      state: mobileKeyboardDraftState(),
      payload,
      history: activeMobileKeyboardHistory(),
    });
    setMobileKeyboardDraftState(update.nextState);
    if (update.committedCommand) {
      recordMobileKeyboardHistory(sid, update.committedCommand);
    }

    void transport.sendInput(sid, payload).catch((e) => {
      if (handleExecuteDenied(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    });
  };

  const handleMobileKeyboardSuggestionSelect = (suggestion: TerminalMobileKeyboardSuggestion) => {
    if (!suggestion.insertText) return;
    handleMobileKeyboardPayload(suggestion.insertText);
  };

  const handleMobileInputModeChange = (
    value: TerminalMobileInputMode,
    options?: { focusTerminal?: boolean },
  ) => {
    persistMobileInputMode(value);
    if (!isMobileLayout()) return;

    if (value === 'floe') {
      setMobileKeyboardVisible(true);
      if (options?.focusTerminal !== false) {
        openFloeMobileKeyboard();
      }
      return;
    }

    setMobileKeyboardVisible(false);
    if (options?.focusTerminal !== false) {
      restoreActiveTerminalFocus();
    }
  };

  const handleSettingsOpenChange = (open: boolean) => {
    setSettingsOpen(open);
    if (!open) {
      const sid = activeSessionId();
      if (sid) restoreTerminalSessionFocus(captureTerminalFocusRestoreIntent(sid), { activate: false });
    }
  };

  const moreItems = createMemo<DropdownItem[]>(() => {
    const items: DropdownItem[] = [{ id: 'search', label: i18n.t('terminal.search') }];
    if (isMobileLayout() && mobileInputMode() === 'floe') {
      items.push({
        id: mobileKeyboardVisible() ? 'hide_floe_keyboard' : 'show_floe_keyboard',
        label: mobileKeyboardVisible() ? i18n.t('terminal.hideFloeKeyboard') : i18n.t('terminal.showFloeKeyboard'),
      });
    }
    items.push({ id: 'settings', label: i18n.t('terminal.terminalSettings') });
    return items;
  });

  const isTerminalSurfaceContextMenuEvent = (event: Event): boolean => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const host = terminalContextMenuHostEl();
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      if (node.classList.contains('redeven-terminal-surface')) return true;
      if (node === host) break;
    }

    const target = event.target;
    if (target instanceof Element) {
      return !!target.closest('.redeven-terminal-surface');
    }

    return false;
  };

  const resolveTerminalSurfaceContext = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : null;
    if (!element) return null;
    for (const [sessionId, surface] of surfaceRegistry.entries()) {
      if (surface === element || surface.contains(element)) {
        return { sessionId, surface };
      }
    }
    return null;
  };

  const openTerminalAskMenuAt = (context: {
    x: number;
    y: number;
    sessionId: string;
    triggerElement: HTMLElement | null;
  }) => {
    if (!connected()) return;

    const requestedSessionId = String(context.sessionId ?? '').trim();
    const currentActiveId = String(activeSessionId() ?? '').trim();
    const activeSession = requestedSessionId
      ? sessions().find((item) => item.id === requestedSessionId) ?? null
      : null;
    const resolvedSession = activeSession ?? sessions()[0] ?? null;
    if (!resolvedSession) return;

    const viewport = viewportRegistry.get(resolvedSession.id) ?? getActiveViewport();
    const selection = buildTerminalContextSnapshot(resolvedSession.id, viewport);

    if (!currentActiveId) {
      setActiveSessionId(resolvedSession.id);
    }

    setTerminalSidebarMenu(null);
    setTerminalAskMenu({
      x: context.x,
      y: context.y,
      selection,
      triggerElement: context.triggerElement,
    });
  };

  const openTerminalAskMenu = (event: MouseEvent) => {
    const surfaceContext = resolveTerminalSurfaceContext(event.target);
    const sessionId = surfaceContext?.sessionId ?? String(activeSessionId() ?? '').trim();
    if (!sessionId) return;

    event.preventDefault();
    event.stopPropagation();
    openTerminalAskMenuAt({
      x: event.clientX,
      y: event.clientY,
      sessionId,
      triggerElement: surfaceContext
        ? resolveTerminalInputElement(surfaceContext.surface)
        : null,
    });
  };

  function handleTerminalContextMenuCapture(event: MouseEvent) {
    if (!connected()) return;
    if (!isTerminalSurfaceContextMenuEvent(event)) return;
    openTerminalAskMenu(event);
  }

  function handleTerminalContextMenuKeyDownCapture(event: KeyboardEvent) {
    if (event.isComposing) return;
    const contextMenuKey = event.key === 'ContextMenu'
      && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    const shiftF10 = event.key === 'F10'
      && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
    if (!contextMenuKey && !shiftF10) return;
    if (!isTerminalSurfaceContextMenuEvent(event)) return;

    const surfaceContext = resolveTerminalSurfaceContext(event.target);
    if (!surfaceContext) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;

    const triggerElement = event.target instanceof HTMLElement ? event.target : null;
    const rect = triggerElement?.getBoundingClientRect();
    openTerminalAskMenuAt({
      x: rect ? rect.left + Math.min(rect.width - 8, 48) : 0,
      y: rect ? rect.top + Math.min(rect.height - 8, 32) : 0,
      sessionId: surfaceContext.sessionId,
      triggerElement,
    });
  }

  const executeTerminalCopyCommand = async (context: { source: 'shortcut' | 'context_menu'; sessionId: string }): Promise<boolean> => {
    const normalizedSessionId = String(context.sessionId ?? '').trim();
    if (!normalizedSessionId) return false;

    const viewport = viewportRegistry.get(normalizedSessionId)
      ?? (activeSessionId() === normalizedSessionId ? getActiveViewport() : null);
    if (!viewport) return false;

    const result = await viewport.copySelection(context.source === 'shortcut' ? 'shortcut' : 'command');
    if (result.copied) return true;
    if (result.reason === 'clipboard_unavailable') {
      throw new Error(i18n.t('terminal.clipboardUnavailable'));
    }
    return false;
  };

  const notifyTerminalCopyFailure = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    notify.error(i18n.t('terminal.copyFailedTitle'), message || i18n.t('terminal.failedToCopyClipboard'));
  };

  const handleCopyTerminalSelection = () => {
    const menu = terminalAskMenu();
    const focusRestoreIntent = menu
      ? captureTerminalFocusRestoreIntent(menu.selection.sessionId, menu.triggerElement)
      : null;
    setTerminalAskMenu(null);
    if (!menu) return;
    void executeTerminalCopyCommand({
      source: 'context_menu',
      sessionId: menu.selection.sessionId,
    }).catch(notifyTerminalCopyFailure).finally(() => {
      if (focusRestoreIntent) restoreTerminalSessionFocus(focusRestoreIntent);
    });
  };

  const handleClearTerminalContent = () => {
    const menu = terminalAskMenu();
    const focusRestoreIntent = menu
      ? captureTerminalFocusRestoreIntent(menu.selection.sessionId, menu.triggerElement)
      : null;
    setTerminalAskMenu(null);
    if (!menu) return;
    void clearSession(menu.selection.sessionId, {
      ...(focusRestoreIntent ? { focusRestoreIntent } : {}),
    });
  };

  const handleBrowseFilesFromTerminal = () => {
    const menu = terminalAskMenu();
    if (!menu) return;
    const item = sessionListItemById().get(menu.selection.sessionId);
    const workingDir = item?.remote
      ? ''
      : normalizeAskFlowerAbsolutePath(item?.localWorkingDir ?? '');
    if (!item?.canBrowsePath || !workingDir) return;
    setTerminalAskMenu(null);

    void env.openFileBrowserAtPath(workingDir, {
      homePath: normalizeAskFlowerAbsolutePath(agentHomePathAbs()) || undefined,
      openStrategy: env.viewMode() === 'workbench' ? 'create_new' : undefined,
    });
  };

  const openSidebarItemFiles = (item: TerminalSessionNavigationItem) => {
    const currentItem = sessionListItemById().get(item.id);
    if (!currentItem?.canBrowsePath || currentItem.remote || !currentItem.localWorkingDir) return;

    setTerminalSidebarMenu(null);
    const handoff = () => void env.openFileBrowserAtPath(currentItem.localWorkingDir, {
      homePath: normalizeAskFlowerAbsolutePath(agentHomePathAbs()) || undefined,
      title: buildTerminalSidebarDirectoryTitle(currentItem.localWorkingDir, currentItem.label),
      openStrategy: env.viewMode() === 'workbench' ? 'create_new' : undefined,
    });
    if (isMobileLayout() && sessionDrawerOpen()) {
      setSessionDrawerOpen(false);
      queueMicrotask(handoff);
    } else {
      handoff();
    }
  };

  const copySidebarItemPath = (item: TerminalSessionNavigationItem) => {
    const currentItem = sessionListItemById().get(item.id);
    const fullPath = normalizeAskFlowerAbsolutePath(currentItem?.fullPath ?? '');
    if (!currentItem || !fullPath) return;
    const sessionId = currentItem.id;

    void writeTextToClipboard(fullPath)
      .then(() => {
        setCopiedSidebarPathSessionId(sessionId);
        if (sidebarPathCopyResetTimer !== undefined) {
          globalThis.clearTimeout(sidebarPathCopyResetTimer);
        }
        sidebarPathCopyResetTimer = globalThis.setTimeout(() => {
          sidebarPathCopyResetTimer = undefined;
          setCopiedSidebarPathSessionId((current) => (current === sessionId ? null : current));
        }, 1500);
      })
      .catch(notifyTerminalCopyFailure);
  };

  const copyTerminalGroupPath = (groupId: string) => {
    const group = terminalGroups().find((candidate) => candidate.id === groupId);
    const path = normalizeAskFlowerAbsolutePath(group?.defaultWorkingDir ?? '');
    if (!group || !path) return;
    setTerminalSidebarMenu(null);
    void writeTextToClipboard(path).catch(notifyTerminalCopyFailure);
  };

  const duplicateSidebarItemSession = (item: TerminalSessionNavigationItem) => {
    const currentItem = sessionListItemById().get(item.id);
    const fullPath = currentItem?.remote
      ? ''
      : normalizeAskFlowerAbsolutePath(currentItem?.localWorkingDir ?? '');
    if (!connected() || !currentItem?.canDuplicate || !fullPath) return;
    const nextIndex = sessions().length + pendingTerminalSessions().length + 1;
    const fallbackName = i18n.t('terminal.terminalName', { index: nextIndex });
    const sourceGroupId = sessions().find((session) => session.id === item.id)?.groupId ?? 'default';
    void beginCreateSession(resolveRequestedSessionName(undefined, fullPath, fallbackName), fullPath, sourceGroupId);
  };

  const clearSidebarItemSession = (item: TerminalSessionNavigationItem) => {
    const currentItem = sessionListItemById().get(item.id);
    if (!currentItem?.canClear) return;
    const menu = terminalSidebarMenu();
    const focusRestoreIntent = captureTerminalFocusRestoreIntent(
      currentItem.id,
      menu?.triggerElement ?? null,
    );
    setTerminalSidebarMenu(null);
    void clearSession(currentItem.id, { focusRestoreIntent });
  };

  const askFlowerFromSidebarItem = (item: TerminalSessionNavigationItem, anchor: { x: number; y: number }) => {
    const currentItem = sessionListItemById().get(item.id);
    if (!currentItem) return;
    const workingDir = normalizeAskFlowerAbsolutePath(currentItem.localWorkingDir);
    const selection = buildTerminalContextSnapshot(
      currentItem.id,
      viewportRegistry.get(currentItem.id) ?? null,
    );
    setTerminalSidebarMenu(null);
    const handoff = () => openTerminalAskFlowerContext({ x: anchor.x, y: anchor.y, workingDir, selection });
    if (isMobileLayout() && sessionDrawerOpen()) {
      setSessionDrawerOpen(false);
      queueMicrotask(handoff);
    } else {
      handoff();
    }
  };

  const openTerminalAskFlowerContext = (context: {
    x: number;
    y: number;
    workingDir?: string;
    selection: terminal_context_snapshot;
  }) => {
    const workingDir = normalizeAskFlowerAbsolutePath(context.workingDir ?? '');

    const selection = context.selection.hasSelection
      ? context.selection.selectionText
      : context.selection.screenText;
    const trimmedSelection = selection.trim();
    const selectionChars = Array.from(trimmedSelection).length;
    const notes: string[] = [];
    let contextItems: EnvFlowerTurnLauncherContextItem[] = [];
    const terminalContextItem = (text: string, characters: number): EnvFlowerTurnLauncherContextItem => ({
      kind: 'terminal_selection',
      ...(workingDir ? { working_dir: workingDir } : {}),
      selection: text,
      selection_chars: characters,
    });

    if (trimmedSelection) {
      if (selectionChars > MAX_INLINE_TERMINAL_CONTEXT_CHARS) {
        notes.push(i18n.t('terminal.largeSelectionMetadataOnly'));
        contextItems = [terminalContextItem('', selectionChars)];
      } else {
        contextItems = [terminalContextItem(trimmedSelection, selectionChars)];
      }
    } else {
      notes.push(i18n.t(workingDir
        ? 'terminal.noSelectionContextOnly'
        : 'terminal.noTerminalContextAvailable'));
      contextItems = [terminalContextItem('', 0)];
    }

    env.openFlowerTurnLauncher(attachAskFlowerContextAction({
      id: createClientId('ask-flower'),
      source_surface: 'terminal',
      ...(workingDir ? { suggested_working_dir: workingDir } : {}),
      context_items: contextItems,
      pending_attachments: [],
      notes,
    }), { x: context.x, y: context.y });
  };

  const askFlowerFromTerminal = () => {
    const menu = terminalAskMenu();
    if (!menu) return;
    const item = sessionListItemById().get(menu.selection.sessionId);
    if (!item) return;
    const workingDir = normalizeAskFlowerAbsolutePath(item.localWorkingDir);
    setTerminalAskMenu(null);
    openTerminalAskFlowerContext({
      x: menu.x,
      y: menu.y,
      workingDir,
      selection: menu.selection,
    });
  };

  const buildTerminalAskMenuItems = (menu: NonNullable<ReturnType<typeof terminalAskMenu>>): FloatingContextMenuItem[] => {
    const item = sessionListItemById().get(menu.selection.sessionId);
    const primaryItems: FloatingContextMenuItem[] = [
      {
        id: 'ask-flower',
        kind: 'action',
        label: i18n.t('terminal.askFlower'),
        icon: FlowerContextMenuIcon,
        onSelect: askFlowerFromTerminal,
      },
    ];
    if (item?.canBrowsePath || item?.remote) {
      primaryItems.push({
        id: 'browse-files',
        kind: 'action',
        label: i18n.t('terminal.browseFiles'),
        icon: Folder,
        disabled: item?.remote || !item?.canBrowsePath,
        disabledReason: item?.remote ? i18n.t('terminal.remotePathActionsUnavailable') : undefined,
        onSelect: handleBrowseFilesFromTerminal,
      });
    }

    const items: FloatingContextMenuItem[] = sortContextActionMenuItems(primaryItems);
    items.push({
      id: 'priority-secondary-separator',
      kind: 'separator',
    });
    items.push({
      id: 'copy-selection',
      kind: 'action',
      label: i18n.t('terminal.copySelection'),
      icon: Copy,
      onSelect: handleCopyTerminalSelection,
      disabled: !menu.selection.hasSelection,
    });
    items.push({
      id: 'clear-terminal-content',
      kind: 'action',
      label: i18n.t('terminal.clearTerminalContent'),
      icon: Trash,
      onSelect: handleClearTerminalContent,
      disabled: clearingSessionId() !== null,
    });

    return items;
  };

  const buildTerminalSidebarMenuItems = (menu: NonNullable<ReturnType<typeof terminalSidebarMenu>>): FloatingContextMenuItem[] => {
    if (menu.kind === 'tree') {
      return [{
        id: 'group-create',
        kind: 'action',
        label: i18n.t('terminal.newGroup'),
        icon: FolderPlus,
        disabled: !connected(),
        onSelect: () => {
          setTerminalSidebarMenu(null);
          setGroupEditorTarget('create');
        },
      }];
    }
    if (menu.kind === 'group') {
      const group = terminalGroups().find((candidate) => candidate.id === menu.groupId);
      if (!group) return [];
      return [
        {
          id: 'group-copy-path',
          kind: 'action',
          label: i18n.t('terminal.copyPath'),
          icon: Copy,
          onSelect: () => copyTerminalGroupPath(group.id),
        },
        {
          id: 'group-edit',
          kind: 'action',
          label: i18n.t('terminal.editGroup'),
          icon: Pencil,
          onSelect: () => {
            setTerminalSidebarMenu(null);
            openGroupEditor(group.id);
          },
        },
        ...(!group.isDefault ? [
          {
            id: 'group-danger-separator',
            kind: 'separator' as const,
          },
          {
            id: 'group-delete',
            kind: 'action' as const,
            label: i18n.t('terminal.deleteGroup'),
            icon: Trash,
            destructive: true,
            onSelect: () => {
              setTerminalSidebarMenu(null);
              setGroupDeleteTarget(group);
            },
          },
        ] : []),
      ];
    }
    const item = sessionListItemById().get(menu.sessionId);
    if (!item) return [];
    const moveTargets = terminalGroups()
      .filter((group) => group.id !== sessions().find((session) => session.id === item.id)?.groupId);
    return [
      {
        id: 'sidebar-ask-flower',
        kind: 'action',
        label: i18n.t('terminal.askFlower'),
        icon: FlowerContextMenuIcon,
        onSelect: () => askFlowerFromSidebarItem(item, { x: menu.x, y: menu.y }),
      },
      {
        id: 'sidebar-files',
        kind: 'action',
        label: i18n.t('terminal.files'),
        icon: Folder,
        disabled: !item.canBrowsePath,
        disabledReason: item.remote ? i18n.t('terminal.remotePathActionsUnavailable') : undefined,
        onSelect: () => openSidebarItemFiles(item),
      },
      {
        id: 'sidebar-duplicate',
        kind: 'action',
        label: i18n.t('terminal.duplicateSession'),
        icon: Copy,
        disabled: !item.canDuplicate,
        disabledReason: item.remote ? i18n.t('terminal.remotePathActionsUnavailable') : undefined,
        onSelect: () => {
          setTerminalSidebarMenu(null);
          duplicateSidebarItemSession(item);
        },
      },
      ...(moveTargets.length > 0 ? [
        {
          id: 'sidebar-move-separator',
          kind: 'separator' as const,
        },
        ...moveTargets
        .map((group): FloatingContextMenuItem => ({
          id: `sidebar-move-${group.id}`,
          kind: 'action',
          label: i18n.t('terminal.moveToGroupNamed', { group: group.name }),
          icon: Folder,
          onSelect: () => {
            setTerminalSidebarMenu(null);
            moveSessionToGroup(item.id, group.id);
          },
        })),
      ] : []),
      {
        id: 'sidebar-clear',
        kind: 'action',
        label: i18n.t('terminal.clearTerminalContent'),
        icon: Trash,
        disabled: !item.canClear || clearingSessionId() !== null,
        onSelect: () => clearSidebarItemSession(item),
      },
      {
        id: 'sidebar-danger-separator',
        kind: 'separator',
      },
      {
        id: 'sidebar-delete',
        kind: 'action',
        label: i18n.t('terminal.deleteSession'),
        icon: X,
        destructive: true,
        disabled: !item.closable,
        onSelect: () => {
          setTerminalSidebarMenu(null);
          closeSession(item.id);
        },
      },
    ];
  };

  const openTerminalSidebarMenu = (event: MouseEvent, item: TerminalSessionNavigationItem) => {
    event.preventDefault();
    event.stopPropagation();
    const currentTarget = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const triggerElement = currentTarget
      ? Array.from(currentTarget.querySelectorAll<HTMLButtonElement>('button[data-terminal-session-id]'))
          .find((button) => button.dataset.terminalSessionId === item.id) ?? null
      : null;
    markSessionMounted(item.id);
    setTerminalAskMenu(null);
    setTerminalSidebarMenu({
      kind: 'session',
      x: event.clientX,
      y: event.clientY,
      sessionId: item.id,
      triggerElement,
    });
  };

  const openTerminalSidebarKeyboardMenu = (event: KeyboardEvent, item: TerminalSessionNavigationItem) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const rect = target?.getBoundingClientRect();
    markSessionMounted(item.id);
    setTerminalAskMenu(null);
    setTerminalSidebarMenu({
      kind: 'session',
      x: rect ? rect.left + Math.min(rect.width - 16, 64) : 0,
      y: rect ? rect.top + Math.min(rect.height - 8, 44) : 0,
      sessionId: item.id,
      triggerElement: target,
    });
  };

  const openTerminalGroupMenu = (event: MouseEvent, groupId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const rect = target?.getBoundingClientRect();
    const fromContextMenu = event.type === 'contextmenu';
    setTerminalAskMenu(null);
    setTerminalSidebarMenu({
      kind: 'group',
      x: fromContextMenu ? event.clientX : rect?.right ?? event.clientX,
      y: fromContextMenu ? event.clientY : rect?.bottom ?? event.clientY,
      groupId,
      triggerElement: target,
    });
  };

  const openTerminalTreeMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    setTerminalAskMenu(null);
    setTerminalSidebarMenu({
      kind: 'tree',
      x: event.clientX,
      y: event.clientY,
      triggerElement: target,
    });
  };

  const dismissTerminalAskMenu = (reason: FloatingContextMenuDismissReason) => {
    const menu = terminalAskMenu();
    const focusRestoreIntent = menu
      ? captureTerminalFocusRestoreIntent(menu.selection.sessionId, menu.triggerElement)
      : null;
    setTerminalAskMenu(null);
    if (reason === 'escape' && focusRestoreIntent) {
      restoreTerminalSessionFocus(focusRestoreIntent);
    }
  };

  const dismissTerminalSidebarMenu = (reason: FloatingContextMenuDismissReason) => {
    const menu = terminalSidebarMenu();
    setTerminalSidebarMenu(null);
    if (reason !== 'escape' || !menu?.triggerElement?.isConnected) return;
    requestAnimationFrame(() => menu.triggerElement?.focus({ preventScroll: true }));
  };

  const bindSearchViewport = (viewport: SemanticTerminalViewportHandle | null) => {
    if (searchBoundViewport && searchBoundViewport !== viewport) {
      // Unbind callbacks from the previous viewport to avoid cross-session search counters.
      searchBoundViewport.setSearchResultsCallback(null);
    }

    searchBoundViewport = viewport;

    if (!viewport) {
      setSearchResultIndex(-1);
      setSearchResultCount(0);
      setSearchState('idle');
      return;
    }

    viewport.setSearchResultsCallback(({ resultIndex, resultCount, state }) => {
      setSearchResultIndex(Number.isFinite(resultIndex) ? resultIndex : -1);
      setSearchResultCount(Number.isFinite(resultCount) ? resultCount : 0);
      setSearchState(state);
    });
  };

  createEffect(() => {
    const open = searchOpen();
    const sid = activeSessionId();
    void viewportRegistrySeq();

    const viewport = sid ? (viewportRegistry.get(sid) ?? null) : null;
    if (!open || !viewport) {
      bindSearchViewport(null);
      searchLastAppliedKey = '';
      return;
    }

    bindSearchViewport(viewport);
  });

  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  createEffect(() => {
    const open = searchOpen();
    const q = searchQuery();
    const sid = activeSessionId();
    void viewportRegistrySeq();
    if (!open || !sid) {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
      return;
    }

    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      const viewport = viewportRegistry.get(sid) ?? null;
      if (!viewport) return;

      const term = q.trim();
      const key = `${sid}:${term}`;
      if (key === searchLastAppliedKey) return;

      if (!term) {
        viewport.clearSearch();
        searchLastAppliedKey = key;
        return;
      }

      viewport.findNext(term);
      searchLastAppliedKey = key;
    }, 120);
  });

  onCleanup(() => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    bindSearchViewport(null);
  });

  const openSearch = () => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputEl?.focus();
      searchInputEl?.select?.();
    });
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResultIndex(-1);
    setSearchResultCount(0);
    setSearchState('idle');
    searchLastAppliedKey = '';
    // Search UI is panel-scoped; clear all sessions on close to avoid lingering highlights.
    for (const viewport of viewportRegistry.values()) {
      viewport.clearSearch();
    }
    bindSearchViewport(null);
    restoreActiveTerminalFocus();
  };

  const goNextMatch = () => {
    const viewport = getActiveViewport();
    const term = searchQuery().trim();
    if (!viewport || !term) return;
    viewport.findNext(term);
  };

  const goPrevMatch = () => {
    const viewport = getActiveViewport();
    const term = searchQuery().trim();
    if (!viewport || !term) return;
    viewport.findPrevious(term);
  };

  createEffect(() => {
    if (!isMobileLayout() || !sessionDrawerOpen()) return;
    const closeDrawerFromHistory = dismissSessionDrawer;
    window.addEventListener('popstate', closeDrawerFromHistory);
    onCleanup(() => window.removeEventListener('popstate', closeDrawerFromHistory));
  });

  const handleRootShortcutKeyDown: (e: KeyboardEvent) => void = (e) => {
    if (e.isComposing) return;
    if (matchesPlainPrimaryModShortcut(e, 'f')) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) openSearch();
      return;
    }

    const shortcutTabIndex = terminalTabShortcutIndex(e);
    if (shortcutTabIndex !== null) {
      const target = sessionListItems()[shortcutTabIndex] ?? null;
      if (target) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) requestSessionSelection(target.id, true);
      }
    }
  };

  const handleRootKeyDown: (e: KeyboardEvent) => void = (e) => {
    if (e.key === 'Escape' && searchOpen()) {
      e.preventDefault();
      closeSearch();
      return;
    }

    if (e.key === 'Escape' && sessionDrawerOpen()) {
      e.preventDefault();
      dismissSessionDrawer();
      return;
    }

    if (e.key === 'Enter' && searchOpen()) {
      // Enter/Shift+Enter navigates to next/previous match.
      e.preventDefault();
      if (e.shiftKey) goPrevMatch();
      else goNextMatch();
    }
  };

  createEffect(() => {
    const root = rootEl;
    if (!root) return;
    root.addEventListener('keydown', handleRootShortcutKeyDown, true);
    onCleanup(() => root.removeEventListener('keydown', handleRootShortcutKeyDown, true));
  });

  const handleMoreSelect = (id: string) => {
    if (id === 'search') {
      openSearch();
      return;
    }

    if (id === 'show_floe_keyboard') {
      openFloeMobileKeyboard();
      return;
    }

    if (id === 'hide_floe_keyboard') {
      setMobileKeyboardVisible(false);
      return;
    }

    if (id === 'settings') {
      handleSettingsOpenChange(true);
    }
  };

  const terminalDisclosureFallbackFocus = () => {
    if (variant === 'workbench') {
      const widgetRoot = rootEl?.closest<HTMLElement>(`[${REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR}]`);
      if (widgetRoot) return widgetRoot;
    }
    return (isMobileLayout() ? mobileToolbarEl : null) ?? rootEl;
  };
  const terminalDisclosureSurfaceBoundary = () => rootEl;
  const previousMobileToolbarControl = () => (
    mobileToolbarEl?.querySelector<HTMLElement>('[data-testid="terminal-session-drawer-open"]') ?? null
  );
  const nextMobileToolbarControl = () => (
    mobileToolbarEl?.querySelector<HTMLElement>('[data-testid="terminal-clear-active-session"]') ?? null
  );
  const activeSessionListItem = createMemo(() => {
    const activeId = activeDisplaySessionId();
    if (!activeId) return null;
    return sessionListItems().find((item) => item.id === activeId) ?? null;
  });
  const activeToolbarTitle = createMemo(() => activeSessionListItem()?.title ?? i18n.t('terminal.title'));
  const activeToolbarAvatar = createMemo(() => activeSessionListItem()?.avatar ?? { kind: 'initial' as const });
  const activeToolbarTransitionIndicator = createMemo(() => activeSessionListItem()?.transitionIndicator ?? 'none');
  const activeToolbarSubtitleIcon = createMemo(() => activeSessionListItem()?.subtitleIcon ?? 'none');
  const activeToolbarSubtitle = createMemo(() => {
    const activeItem = activeSessionListItem();
    if (activeItem?.subtitle) return activeItem.subtitle;
    const pending = activePendingSession();
    if (pending?.workingDir) return pending.workingDir;
    return activeSession()?.id ?? '';
  });
  const activeToolbarActivityDescription = createMemo(() => {
    const item = activeSessionListItem();
    if (!item) return '';
    if (item.outputState !== 'none') {
      const activity = item.activitySource === 'semantic'
        ? i18n.t('terminalAgentActivity.working')
        : i18n.t('terminal.outputStreaming');
      return item.attentionState === 'unread'
        ? i18n.t('terminal.activityWithUnreadOutput', {
          activity,
          unread: i18n.t('terminal.unreadOutputDescription'),
        })
        : activity;
    }
    if (item.attentionState === 'waiting') {
      return i18n.t('terminalAgentActivity.userInputRequired');
    }
    if (item.attentionState === 'unread') {
      return i18n.t('terminal.unreadOutputDescription');
    }
    return '';
  });
  const activeToolbarStatusDescription = createMemo(() => {
    const item = activeSessionListItem();
    return item ? describeTerminalSessionNavigationItem(item, i18n.t) : '';
  });
  const mobileBackgroundAttention = createMemo<TerminalSessionAttentionState>(() => {
    const activeId = activeDisplaySessionId();
    let unread = false;
    for (const item of sessionListItems()) {
      if (item.id === activeId) continue;
      if (item.attentionState === 'waiting') return 'waiting';
      if (item.attentionState === 'unread') unread = true;
    }
    return unread ? 'unread' : 'none';
  });
  const mobileSessionDrawerLabel = createMemo(() => {
    const attention = mobileBackgroundAttention();
    if (attention === 'waiting') {
      return i18n.t('terminal.sessionsWithWaitingAttention', {
        sessions: i18n.t('terminal.sessions'),
        attention: i18n.t('terminalAgentActivity.userInputRequired'),
      });
    }
    if (attention === 'unread') {
      return i18n.t('terminal.sessionsWithUnreadOutput', {
        sessions: i18n.t('terminal.sessions'),
        unread: i18n.t('terminal.unreadOutputDescription'),
      });
    }
    return i18n.t('terminal.sessions');
  });

  const body = (
    <div
      ref={(n) => (rootEl = n)}
      tabIndex={-1}
      data-terminal-panel-variant={variant}
      data-terminal-font-requested={resolvedFont().requestedID}
      data-terminal-font-effective={resolvedFont().effectiveID ?? 'monospace'}
      data-terminal-display-mode-selected={displayModeSelected() ? 'true' : 'false'}
      data-terminal-workbench-selected={workbenchSelected() ? 'true' : 'false'}
      class="terminal-shared-geometry-container h-full min-h-0 flex flex-col outline-none"
      onKeyDown={handleRootKeyDown}
      onFocusIn={() => setPanelHasFocus(true)}
      onPointerDown={() => setPanelHasFocus(true)}
      onFocusOut={() => {
        // focusout also fires when moving within the subtree; re-check on the next frame to confirm if we really left the panel.
        requestAnimationFrame(() => {
          const active = typeof document !== 'undefined' ? document.activeElement : null;
          setPanelHasFocus(Boolean(active && rootEl?.contains(active)));
        });
      }}
    >
      <div class="sr-only" aria-live="polite" aria-atomic="true" data-terminal-status-live-region="">
        <Show when={terminalStatusAnnouncement()} keyed>
          {(announcement) => (
            <span
              data-terminal-status-announcement=""
              data-terminal-status-announcement-sequence={announcement.sequence}
            >
              {announcement.text}
            </span>
          )}
        </Show>
      </div>
      <Show when={connected()} fallback={<div class="p-4 text-xs text-muted-foreground">{i18n.t('terminal.notConnected')}</div>}>
        <div class="relative flex min-h-0 flex-1 overflow-hidden bg-background">
          <TerminalSessionNavigator
            accessibilityIdPrefix={accessibilityIdPrefix}
            mobile={isMobileLayout()}
            drawerOpen={sessionDrawerOpen()}
            connected={connected()}
            refreshing={refreshing()}
            activeTitle={activeToolbarTitle()}
            activeAvatar={activeToolbarAvatar()}
            filterQuery={sessionFilterQuery()}
            itemIds={sessionListItemIds()}
            itemById={sessionListItemById()}
            groups={navigationGroups()}
            sidebarActiveSessionId={sidebarActiveSessionId()}
            activeSessionId={activeDisplaySessionId()}
            copiedPathSessionId={copiedSidebarPathSessionId()}
            emptyListLoading={emptySessionListLoading()}
            ownedLayerIds={[
              ...(terminalSidebarMenu() ? [terminalSidebarMenuId] : []),
              ...(terminalAskMenu() ? [terminalAskMenuId] : []),
            ]}
            isFocusWithinOwnedLayer={(target) => Boolean(
              terminalSidebarMenuEl?.contains(target)
              || terminalAskMenuEl?.contains(target),
            )}
            onCloseDrawer={dismissSessionDrawer}
            onCreateSessionInGroup={(groupId) => void createSessionInGroup(groupId)}
            onCreateGroup={() => setGroupEditorTarget('create')}
            onToggleGroup={toggleNavigationGroup}
            onRelocateSession={relocateSession}
            onReorderGroup={reorderTerminalGroup}
            onOpenGroupContextMenu={openTerminalGroupMenu}
            onOpenTreeContextMenu={openTerminalTreeMenu}
            onRefresh={handleRefresh}
            onFilterQueryChange={setSessionFilterQuery}
            onPreviewSession={previewSidebarSessionSelection}
            onResetSessionPreview={sessionSelection.resetPreview}
            onSelectSession={commitSidebarSessionSelection}
            onOpenKeyboardMenu={openTerminalSidebarKeyboardMenu}
            onOpenContextMenu={openTerminalSidebarMenu}
            onCopyPath={copySidebarItemPath}
            onCloseSession={closeSession}
            onOpenFiles={openSidebarItemFiles}
          />

          <div class="min-w-0 min-h-0 flex flex-1 flex-col">
            <div
              ref={(element) => {
                mobileToolbarEl = element;
              }}
              tabIndex={-1}
              class="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-2 outline-none"
            >
              <Show when={isMobileLayout()}>
                <Button
                  ref={(element) => {
                    sessionDrawerTriggerEl = element;
                  }}
                  size="sm"
                  variant="ghost"
                  class="relative h-7 w-7 shrink-0 p-0"
                  data-testid="terminal-session-drawer-open"
                  onClick={() => setSessionDrawerOpen(true)}
                  aria-label={mobileSessionDrawerLabel()}
                  title={mobileSessionDrawerLabel()}
                >
                  <Menu class="h-4 w-4" />
                  <Show when={mobileBackgroundAttention() !== 'none'}>
                    <span
                      class={`absolute right-0.5 top-0.5 rounded-full border border-background forced-colors:border-current ${mobileBackgroundAttention() === 'waiting'
                        ? 'h-2 w-2 bg-warning'
                        : 'h-1.5 w-1.5 bg-primary'}`}
                      data-terminal-background-attention={mobileBackgroundAttention()}
                      aria-hidden="true"
                    />
                  </Show>
                </Button>
              </Show>
              <div class="contents">
                <div class="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground">
                  <TerminalSessionChromeIcon avatar={activeToolbarAvatar()} class="h-3.5 w-3.5" />
                  <TerminalSessionTransitionBadge state={activeToolbarTransitionIndicator()} />
                </div>
                <div class="min-w-0 flex-1 overflow-hidden">
                  <Tooltip
                    placement="bottom"
                    delay={0}
                    clickToToggle
                    content={(
                      <span class="flex max-w-[min(82vw,360px)] flex-col gap-0.5 text-left">
                        <span class="break-words font-semibold">{activeToolbarTitle()}</span>
                        <Show when={activeToolbarSubtitle()}>
                          <span class="break-all text-popover-foreground/75">{activeToolbarSubtitle()}</span>
                        </Show>
                      </span>
                    )}
                  >
                    <button
                      type="button"
                      class="block w-full min-w-0 max-w-full cursor-pointer overflow-hidden text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      aria-label={[activeToolbarTitle(), activeToolbarSubtitle()].filter(Boolean).join(', ')}
                      aria-describedby={activeToolbarStatusDescription() ? activeContextStatusId : undefined}
                      data-testid="terminal-active-context-disclosure"
                    >
                      <span
                        class="block truncate text-xs font-semibold text-foreground"
                        data-terminal-session-title={activeSessionId() ?? ''}
                      >
                        {activeToolbarTitle()}
                      </span>
                      <Show when={activeToolbarSubtitle()}>
                        <span class="flex min-w-0 items-center text-[10px] leading-3 text-muted-foreground">
                          <Show when={activeToolbarSubtitleIcon() === 'link'}>
                            <span class="mr-1 flex h-2.5 w-2.5 shrink-0" data-terminal-toolbar-location-icon="link" aria-hidden="true">
                              <Link class="h-2.5 w-2.5" />
                            </span>
                          </Show>
                          <span class="truncate">{activeToolbarSubtitle()}</span>
                        </span>
                      </Show>
                    </button>
                  </Tooltip>
                  <Show when={activeToolbarStatusDescription()}>
                    <span class="sr-only" id={activeContextStatusId}>{activeToolbarStatusDescription()}</span>
                  </Show>
                </div>
              </div>
              <Show when={isMobileLayout()}>
                <span
                  class="flex h-7 w-7 shrink-0 items-center justify-center"
                  data-terminal-mobile-activity-slot=""
                >
                  <Show when={activeSessionListItem()?.outputState !== 'none'} fallback={(
                    <Show when={activeSessionListItem()?.attentionState !== 'none'}>
                      <Tooltip content={activeToolbarActivityDescription()} placement="bottom" delay={0} clickToToggle>
                        <button
                          type="button"
                          class={`flex h-7 w-7 cursor-pointer items-center justify-center rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-ring forced-colors:border forced-colors:border-current ${activeSessionListItem()?.attentionState === 'waiting'
                            ? 'text-warning hover:bg-warning/10'
                            : 'text-primary hover:bg-primary/10'}`}
                          aria-label={activeToolbarActivityDescription()}
                          data-terminal-mobile-attention={activeSessionListItem()?.attentionState}
                        >
                          <span class={`rounded-full bg-current ${activeSessionListItem()?.attentionState === 'waiting' ? 'h-2 w-2' : 'h-1.5 w-1.5'}`} aria-hidden="true" />
                        </button>
                      </Tooltip>
                    </Show>
                  )}>
                    <Tooltip content={activeToolbarActivityDescription()} placement="bottom" delay={0} clickToToggle>
                      <button
                        type="button"
                        class="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-primary hover:bg-primary/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring forced-colors:border forced-colors:border-current"
                        aria-label={activeToolbarActivityDescription()}
                        data-terminal-mobile-activity={activeSessionListItem()?.activitySource}
                      >
                        <TerminalOutputStatusGlyph state="streaming" />
                      </button>
                    </Tooltip>
                  </Show>
                </span>
              </Show>
              <Show when={isMobileLayout() ? activeGeometryPresentation() : null}>
                {(presentation) => (
                  <TerminalSharedGeometryNotice
                    presentation={presentation()}
                    mobile
                    interactive={workbenchSelected()}
                    fallbackFocus={terminalDisclosureFallbackFocus}
                    surfaceBoundary={terminalDisclosureSurfaceBoundary}
                    previousFocus={previousMobileToolbarControl}
                    nextFocus={nextMobileToolbarControl}
                  />
                )}
              </Show>
              <Button
                aria-busy={clearingSessionId() !== null}
                data-terminal-clear-state={clearingSessionId() ? 'pending' : 'idle'}
                data-testid="terminal-clear-active-session"
                size="sm"
                variant="ghost"
                onClick={clearActive}
                disabled={!connected() || !activeSessionId() || clearingSessionId() !== null}
                title={i18n.t('terminal.clear')}
              >
                <Trash class="w-3.5 h-3.5" />
              </Button>
              <Dropdown
                trigger={
                  <Button size="sm" variant="ghost" disabled={!connected()} title={i18n.t('terminal.moreOptions')}>
                    <MoreVerticalIcon class="w-3.5 h-3.5" />
                  </Button>
                }
                items={moreItems()}
                onSelect={handleMoreSelect}
                align="end"
              />
            </div>

            <div
              ref={setTerminalContextMenuHostEl}
              data-testid="terminal-content"
              data-terminal-work-state={terminalWorkIndicatorState()}
              data-terminal-work-theme={terminalWorkIndicatorTheme()}
              class="flex-1 min-h-0 relative"
              style={terminalLoadingVars()}
            >
              <Show when={workIndicatorEnabled()}>
                <div
                  class="redeven-terminal-work-indicator"
                  data-terminal-work-state={terminalWorkIndicatorState()}
                  data-terminal-work-theme={terminalWorkIndicatorTheme()}
                  style={{
                    '--redeven-terminal-work-indicator-size': `${terminalWorkIndicatorThicknessPx()}px`,
                  }}
                  aria-hidden="true"
                />
              </Show>
              <Show when={searchOpen()}>
                <TerminalSearchOverlay
                  mobile={isMobileLayout()}
                  query={searchQuery()}
                  resultCount={searchResultCount()}
                  resultIndex={searchResultIndex()}
                  state={searchState()}
                  inputRef={(element) => {
                    searchInputEl = element;
                  }}
                  onQueryChange={setSearchQuery}
                  onPrevious={goPrevMatch}
                  onNext={goNextMatch}
                  onRetry={goNextMatch}
                  onClose={closeSearch}
                />
              </Show>
              <Show when={sessions().length > 0 || visiblePendingTerminalSessions().length > 0}>
                <div class="h-full">
                  <For each={sessionPanelIds()}>
                    {(sessionId) => {
                      const sessionForId = createMemo(() => renderableSessions().find((session) => session.id === sessionId) ?? null);
                      const mountedSessionForId = createMemo(() => (
                        mountedSessionIds().has(sessionId) ? sessionForId() : null
                      ));
                      return (
                        <Show when={mountedSessionForId()}>
                          {/* Keep runtime identity tied to sessionId; metadata snapshots may replace session objects. */}
                          <TabPanel active={activeDisplaySessionId() === sessionId} keepMounted class="h-full">
                            <TerminalSessionRuntime
                              session={mountedSessionForId() as TerminalSessionInfo}
                              variant={variant}
                              active={() => activeDisplaySessionId() === sessionId}
                              connected={connected}
                              protocolClient={() => protocol.session?.()}
                              viewActive={() => viewActive() && displayModeSelected()}
                              autoFocus={shouldAutoFocus}
                              themeColors={terminalThemeColors}
                              fontSize={fontSize}
                              fontFamily={fontFamily}
                              agentHomePathAbs={agentHomePathAbs}
                              canOpenFilePreview={() => (
                                canBrowseFiles()
                                && Boolean(terminalChromeBySession().get(sessionId)?.canUseLocalPath)
                              )}
                              bottomInsetPx={terminalViewportInsetPx}
                              connId={connId}
                              transport={transport}
                              eventSource={eventSource}
                              registerViewport={registerViewport}
                              registerSurfaceElement={registerSurfaceElement}
                              registerActions={registerActions}
                              initialLoadingCurtainOwnedByParent={() => (
                                terminalCreationTransitionForSession(sessionId) !== null
                              )}
                              onRuntimeStatus={handleRuntimeStatus}
                              onGeometryPresentation={handleGeometryPresentation}
                              onSessionGone={handleTerminalSessionGone}
                              onInteractive={handleTerminalInteractive}
                              onLiveOutputObserved={handleLiveOutputObserved}
                              onOutputCommitted={handleOutputCommitted}
                              onOutputCoverage={handleOutputCoverage}
                              onHistorySummary={handleHistorySummary}
                              onPendingOutputReset={resetPendingOutput}
                              onSurfaceClick={handleWorkbenchTerminalSurfaceClick}
                              onBell={handleSessionBell}
                              onShellIntegrationEvent={handleShellIntegrationEvent}
                              onVisibleOutput={handleVisibleOutput}
                              onTerminalFileLinkOpen={openTerminalFileLinkTarget}
                              onTerminalExternalLinkOpen={openTerminalExternalLink}
                              onNameUpdate={handleNameUpdate}
                            />
                          </TabPanel>
                        </Show>
                      );
                    }}
                  </For>
                  <Show when={activeUnmountedSession()}>
                    <TabPanel active keepMounted class="h-full">
                      <div
                        class="h-full min-h-0 relative overflow-hidden redeven-terminal-surface"
                        data-terminal-deferred-surface="true"
                        style={{
                          'background-color': terminalThemeBackground(),
                          color: terminalThemeForeground(),
                          ...terminalLoadingVars(),
                        }}
                      >
                        <TerminalLoadingPane
                          message={i18n.t('terminal.initializing')}
                          progressLabel={i18n.t('terminal.initializing')}
                          dataStage="initializing"
                        />
                      </div>
                    </TabPanel>
                  </Show>
                  <Index each={visiblePendingTerminalSessions()}>
                    {(session) => (
                      <TabPanel active={activeDisplaySessionId() === session().id} keepMounted class="h-full">
                        <div
                          class="h-full min-h-0 relative overflow-hidden redeven-terminal-surface"
                          data-terminal-pending-surface="true"
                          style={{
                            'background-color': terminalThemeBackground(),
                            color: terminalThemeForeground(),
                            ...terminalLoadingVars(),
                          }}
                        >
                          <Show when={session().status === 'failed'}>
                            <div class="absolute inset-0 flex items-center justify-center p-8">
                              <div class="max-w-sm text-center flex flex-col items-center gap-3">
                                <PendingTerminalTabStatusIcon status="failed" />
                                <div class="text-sm font-medium">{i18n.t('terminal.creationFailed')}</div>
                                <div class="text-xs break-words" style={{ color: terminalThemeMutedForeground() }}>
                                  {session().errorMessage || i18n.t('terminal.creationFailedMessage')}
                                </div>
                                <div class="flex items-center justify-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="primary"
                                    onClick={() => {
                                      const failedSession = session();
                                      removePendingSession(failedSession.id);
                                      void beginCreateSession(failedSession.name, failedSession.workingDir, failedSession.groupId ?? 'default');
                                    }}
                                    disabled={!connected()}
                                  >
                                    {i18n.t('terminal.retry')}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => removePendingSession(session().id)}
                                  >
                                    {i18n.t('terminal.dismiss')}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </Show>
                        </div>
                      </TabPanel>
                    )}
                  </Index>
                </div>
              </Show>

              <For each={terminalCreationTransitionIds()}>
                {(pendingSessionId) => {
                  const transition = createMemo(() => (
                    terminalCreationTransitions().find((candidate) => (
                      candidate.pendingSessionId === pendingSessionId
                    )) ?? null
                  ));
                  const active = createMemo(() => {
                    const current = transition();
                    if (!current) return false;
                    const displaySessionId = activeDisplaySessionId();
                    return current.phase === 'creating'
                      ? displaySessionId === current.pendingSessionId
                      : displaySessionId === current.sessionId;
                  });
                  const attaching = createMemo(() => transition()?.phase === 'attaching');
                  const message = createMemo(() => (
                    attaching() ? i18n.t('terminal.attaching') : i18n.t('terminal.creatingMessage')
                  ));
                  return (
                    <div
                      class="absolute inset-0 z-[46]"
                      hidden={!active()}
                      aria-hidden={active() ? undefined : 'true'}
                      data-terminal-creation-transition={pendingSessionId}
                      data-terminal-creation-transition-session={transition()?.sessionId || undefined}
                    >
                      <TerminalLoadingPane
                        message={message()}
                        progressLabel={message()}
                        dataStage={attaching() ? 'attaching' : 'creating'}
                      />
                    </div>
                  );
                }}
              </For>

              <Show when={emptySessionListLoading()}>
                <TerminalLoadingPane
                  message={i18n.t('terminal.loadingSessions')}
                  progressLabel={i18n.t('terminal.loadingSessions')}
                  dataStage="sessions"
                  tone="system"
                />
              </Show>

              <Show when={sessionsHydrated() && !sessionsLoading() && sessions().length === 0 && visiblePendingTerminalSessions().length === 0}>
                <div class="absolute inset-0 flex items-center justify-center p-8">
                  <div class="max-w-sm text-center flex flex-col items-center gap-4">
                    <div class="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                      <Terminal class="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div class="text-sm font-medium text-foreground">{i18n.t('terminal.noSessionsTitle')}</div>
                    <div class="text-xs text-muted-foreground">
                      {i18n.t('terminal.noSessionsDescription')}
                    </div>
                    <Button
                      size="lg"
                      variant="primary"
                      onClick={createSession}
                      disabled={!connected()}
                    >
                      {i18n.t('terminal.createSession')}
                    </Button>
                  </div>
                </div>
              </Show>
            </div>

            <TerminalSettingsDialog
              open={settingsOpen()}
              userTheme={userTheme()}
              fontSize={fontSize()}
              fontFamilyId={fontFamilyId()}
              mobileInputMode={mobileInputMode()}
              systemAppearance={theme.resolvedTheme()}
              workIndicatorEnabled={workIndicatorEnabled()}
              fontScope={sharedGeometryPreferences() ? 'shared-workbench' : 'local'}
              minFontSize={TERMINAL_MIN_FONT_SIZE}
              maxFontSize={TERMINAL_MAX_FONT_SIZE}
              onOpenChange={handleSettingsOpenChange}
              onThemeChange={handleThemeChange}
              onFontSizeChange={persistFontSize}
              onFontFamilyChange={persistFontFamily}
              onMobileInputModeChange={(value) => handleMobileInputModeChange(value, { focusTerminal: false })}
              onWorkIndicatorEnabledChange={terminalPrefs.setWorkIndicatorEnabled}
            />

            <TerminalGroupEditorDialog
              open={groupEditorTarget() !== null}
              group={groupEditorTarget() === 'create' ? null : groupEditorTarget() as TerminalGroup | null}
              defaultWorkingDir={agentHomePathAbs() || '/'}
              pickerProps={groupPathPicker}
              onCancel={() => {
                setGroupEditorTarget(null);
              }}
              onSubmit={submitGroupEditor}
            />
            <TerminalGroupDeleteDialog
              open={groupDeleteTarget() !== null}
              group={groupDeleteTarget()}
              sessionCount={(terminalCatalog?.sessions() ?? sessions()).filter((session) => session.groupId === groupDeleteTarget()?.id).length}
              onCancel={() => setGroupDeleteTarget(null)}
              onConfirm={confirmDeleteGroup}
            />

            <Show when={error()}>
              <div class="p-2 text-[11px] text-error border-t border-border bg-background/80 break-words">{error()}</div>
            </Show>
            <Show when={showTerminalStatusBar()}>
              <div
                data-testid="terminal-status-bar"
                data-terminal-runtime-state={activeRuntimeStatus().state}
                class="relative z-10 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 overflow-hidden border-t border-border bg-background leading-none text-muted-foreground"
                classList={{
                  'h-11 min-h-11 max-h-11 px-1 text-[11px]': useMobileRecoveryStatusBar(),
                  'h-7 min-h-7 max-h-7 px-2 text-[10px]': !useMobileRecoveryStatusBar(),
                }}
                style={{
                  transform: useMobileRecoveryStatusBar()
                    ? `translateY(-${terminalViewportInsetPx()}px)`
                    : undefined,
                }}
              >
                <div class="flex min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap">
                  <TerminalFontStatus font={resolvedFont()} inline />
                  <span
                    class="min-w-0 max-w-[40%] truncate"
                    classList={{ hidden: useMobileRecoveryStatusBar() }}
                  >
                    {i18n.t('terminal.statusSession')}: {statusBarSessionLabel()}
                  </span>
                  <span
                    data-testid="terminal-recovery-status-message"
                    class="min-w-0 truncate"
                    classList={{
                      'text-error': activeRuntimeStatus().state === 'blocking',
                      'text-foreground': activeRuntimeStatus().state === 'degraded',
                      'invisible': activeRuntimeStatus().state === 'idle',
                    }}
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {activeRuntimeStatusMessage()}
                  </span>
                  <Show when={!isMobileLayout() ? activeGeometryPresentation() : null}>
                    {(presentation) => (
                      <TerminalSharedGeometryNotice
                        presentation={presentation()}
                        mobile={false}
                        interactive={workbenchSelected()}
                        fallbackFocus={terminalDisclosureFallbackFocus}
                        surfaceBoundary={terminalDisclosureSurfaceBoundary}
                      />
                    )}
                  </Show>
                  <span
                    data-terminal-history-rows={activeHistoryRows() === null ? '' : String(activeHistoryRows())}
                    class="terminal-shared-geometry-history ml-auto shrink-0"
                    classList={{ hidden: useMobileRecoveryStatusBar() }}
                  >
                    {i18n.t('terminal.statusHistory')}: {activeHistoryRows() === null ? '-' : activeHistoryRows()}
                  </span>
                </div>
                <Show when={activeRuntimeStatus().state === 'degraded' || activeRuntimeStatus().state === 'blocking'}>
                  <div
                    data-testid="terminal-recovery-status-actions"
                    class="flex min-w-max shrink-0 items-center gap-1 whitespace-nowrap"
                  >
                      <Show
                        when={activeRuntimeStatus().retryable !== false}
                        fallback={(
                          <button
                            type="button"
                            class="inline-flex cursor-pointer items-center justify-center text-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            classList={{
                              'size-11': useMobileRecoveryStatusBar(),
                              'size-7': !useMobileRecoveryStatusBar(),
                            }}
                            aria-label={i18n.t('terminal.updateRuntime')}
                            title={i18n.t('terminal.updateRuntime')}
                            onClick={openRuntimeUpdate}
                          >
                            <Download class="size-3.5" aria-hidden="true" />
                          </button>
                        )}
                      >
                        <button
                          type="button"
                          class="inline-flex cursor-pointer items-center justify-center text-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          classList={{
                            'size-11': useMobileRecoveryStatusBar(),
                            'size-7': !useMobileRecoveryStatusBar(),
                          }}
                          aria-label={i18n.t('terminal.retry')}
                          title={i18n.t('terminal.retry')}
                          onClick={(event) => void retryActiveRuntime(event.currentTarget)}
                        >
                          <Refresh class="size-3.5" aria-hidden="true" />
                        </button>
                      </Show>
                      <button
                        type="button"
                        class="inline-flex cursor-pointer items-center justify-center text-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        classList={{
                          'size-11': useMobileRecoveryStatusBar(),
                          'size-7': !useMobileRecoveryStatusBar(),
                        }}
                        aria-label={i18n.t('terminal.viewDiagnostics')}
                        title={i18n.t('terminal.viewDiagnostics')}
                        onClick={openActiveRuntimeDiagnostics}
                      >
                        <BugIcon class="size-3.5" aria-hidden="true" />
                      </button>
                  </div>
                </Show>
              </div>
            </Show>
            <span
              class="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              data-testid="terminal-shared-geometry-announcement"
            >
              {sharedGeometryAnnouncement()}
            </span>
          </div>
        </div>
      </Show>

      <Show when={terminalAskMenu()} keyed>
        {(menu) => (
          <FloatingContextMenu
            id={terminalAskMenuId}
            x={menu.x}
            y={menu.y}
            ariaLabel={i18n.t('terminal.title')}
            focusAnchor={menu.triggerElement}
            focusDisabledItems={sessionListItemById().get(menu.selection.sessionId)?.remote === true}
            items={buildTerminalAskMenuItems(menu)}
            onDismiss={dismissTerminalAskMenu}
            menuRef={(el) => {
              terminalAskMenuEl = el;
            }}
          />
        )}
      </Show>

      <Show when={terminalSidebarMenu()} keyed>
        {(menu) => (
          <FloatingContextMenu
            id={terminalSidebarMenuId}
            x={menu.x}
            y={menu.y}
            ariaLabel={menu.kind === 'group'
              ? i18n.t('terminal.groupActions', { group: terminalGroups().find((group) => group.id === menu.groupId)?.name ?? '' })
              : menu.kind === 'tree'
                ? i18n.t('terminal.newGroup')
                : i18n.t('terminal.sessions')}
            focusAnchor={menu.triggerElement}
            focusDisabledItems={menu.kind === 'session' && sessionListItemById().get(menu.sessionId)?.remote === true}
            restoreFocusOnTab={isMobileLayout() && sessionDrawerOpen()}
            items={buildTerminalSidebarMenuItems(menu)}
            onDismiss={dismissTerminalSidebarMenu}
            menuRef={(el) => {
              terminalSidebarMenuEl = el;
            }}
          />
        )}
      </Show>

      <Show when={shouldUseFloeMobileKeyboard()}>
        <MobileKeyboard
          ref={(el) => {
            setMobileKeyboardElement(el);
            syncMobileKeyboardInset();
          }}
          visible={mobileKeyboardVisible()}
          quickInserts={TERMINAL_MOBILE_KEYBOARD_QUICK_INSERTS}
          suggestions={mobileKeyboardSuggestions()}
          onKey={handleMobileKeyboardPayload}
          onSuggestionSelect={handleMobileKeyboardSuggestionSelect}
          onDismiss={() => setMobileKeyboardVisible(false)}
        />
      </Show>
    </div>
  );

  if (variant === 'workbench') return body;

  return (
    <div class="h-full overflow-hidden">{body}</div>
  );
}

export function TerminalPanel(props: TerminalPanelProps = {}) {
  const i18n = useI18n();
  const protocol = useProtocol();
  const ctx = useEnvContext();
  const terminalCatalog = useTerminalSessionCatalog();

  const [executeDenied, setExecuteDenied] = createSignal(false);

  const permissionReady = () => ctx.env.state === 'ready';
  const processLaunchAllowed = () => canLaunchProcess(ctx.env()?.permissions);
  const noExecute = createMemo(() => (
    executeDenied()
    || terminalCatalog?.permissionDenied?.()
    || (permissionReady() && !processLaunchAllowed())
  ));

  createEffect(() => {
    // Reset when disconnected so users can reconnect after policy changes.
    if (protocol.status() !== 'connected') {
      setExecuteDenied(false);
    }
  });

  createEffect(() => {
    if (noExecute()) {
      if (terminalCatalog) terminalCatalog.clearForPermissionDenied();
      else disposeRedevenTerminalSessionsCoordinator();
    }
  });

  return (
    <Show
      when={!noExecute()}
      fallback={
        <PermissionEmptyState
          variant={props.variant === 'workbench' ? 'workbench' : 'panel'}
          title={i18n.t('terminal.executePermissionRequired')}
          description={i18n.t('terminal.executePermissionDescription')}
        />
      }
    >
      <TerminalPanelInner {...props} onExecuteDenied={() => setExecuteDenied(true)} />
    </Show>
  );
}
