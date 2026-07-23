import { For, Index, Show, batch, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { createUIFirstSelection, deferAfterPaint, isMacLikePlatform, matchKeybind, useCurrentWidgetId, useLayout, useNotification, useResolvedFloeConfig, useTheme, useViewActivation } from '@floegence/floe-webapp-core';
import { BugIcon, Copy, Download, Folder, Menu, Refresh, Terminal, Trash, X } from '@floegence/floe-webapp-core/icons';
import '@fontsource/iosevka/400.css';

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
  TerminalCore,
  getThemeColors,
  isTerminalThemeName,
  type Logger,
  type TerminalAppearance,
  type TerminalOutputActivityInfo,
  type TerminalSessionInfo,
  type TerminalThemeName,
  type TerminalTouchScrollRuntime,
} from '@floegence/floeterm-terminal-web';
import {
  createRedevenTerminalLiveBundle,
  createTerminalConnId,
} from '../services/terminalTransport';
import { disposeRedevenTerminalSessionsCoordinator, getRedevenTerminalSessionsCoordinator } from '../services/terminalSessions';
import { useTerminalSessionCatalog } from '../services/terminalSessionCatalog';
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
import { resolveTerminalSurfaceTouchAction } from '../mobileViewportPolicy';
import { resolveTerminalFontFamily, TerminalSettingsDialog } from './TerminalSettingsDialog';
import { resolveTerminalMobileKeyboardInsetPx } from './terminalMobileKeyboardInset';
import { useFilePreviewContext } from './FilePreviewContext';
import { fileItemFromPath } from '../utils/filePreviewItem';
import { writeTextToClipboard } from '../utils/clipboard';
import type { TerminalResolvedLinkTarget } from '../services/terminalLinkProvider';
import type { TerminalShellIntegrationEvent } from '../services/terminalShellIntegration';
import { createTerminalTabActivityTracker, type TerminalSessionWorkState, type TerminalTabVisualState } from '../services/terminalTabActivity';
import {
  createTerminalForegroundPresentationScheduler,
  normalizeTerminalForegroundCommand,
  type TerminalForegroundPresentation,
} from '../services/terminalForegroundPresentation';
import { FloatingContextMenu, type FloatingContextMenuItem } from './FloatingContextMenu';
import { useI18n } from '../i18n';
import { createUIPresentationEventRecorder } from '../services/uiPresentationTransactions';
import {
  createTerminalAdaptiveWorkingSetManager,
  type TerminalWorkingSetInteraction,
  type TerminalWorkingSetRuntime,
} from '../services/terminalAdaptiveWorkingSet';
import {
  releaseTerminalRecoveryDiagnostics,
} from '../services/terminalRecoveryDiagnostics';
import {
  markTerminalPerformance,
  pseudonymousTerminalSessionRef,
} from '../services/terminalPerformance';
import {
  TerminalSessionRuntime,
  type TerminalSessionRuntimeActions,
  type TerminalSessionRuntimeStatus,
} from './TerminalSessionRuntime';
import {
  TerminalSessionNavigator,
  type TerminalSessionAttentionState,
  type TerminalSessionNavigationItem,
  type TerminalSessionProcessState,
} from './TerminalSessionNavigator';
import { deriveTerminalAgentSessionPresentation } from './terminalAgentSessionPresentation';
import { TerminalSearchOverlay } from './TerminalSearchOverlay';

type pending_terminal_session_status = 'creating' | 'failed';

export type TerminalPanelVariant = 'panel' | 'workbench';

const TERMINAL_WORK_INDICATOR_BASE_THICKNESS_PX = 3.5;
const TERMINAL_TAB_SHORTCUT_MAX_INDEX = 8;

export type TerminalPanelSessionGroupState = Readonly<{
  sessionIds: string[];
  activeSessionId: string | null;
}>;

export type TerminalPanelSessionCreateResult = TerminalSessionInfo | string | null;

export type TerminalPanelSessionOperations = Readonly<{
  createSession: (name: string | undefined, workingDir: string) => Promise<TerminalPanelSessionCreateResult>;
  deleteSession: (sessionId: string) => Promise<void>;
}>;

export type TerminalPanelGeometryPreferences = TerminalGeometryPreferences & Readonly<{
  onFontSizeChange: (value: number) => void;
  onFontFamilyChange: (id: string) => void;
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
  sessionGroupState?: TerminalPanelSessionGroupState;
  onSessionGroupStateChange?: (next: TerminalPanelSessionGroupState) => void;
  sessionOperations?: TerminalPanelSessionOperations;
  terminalGeometryPreferences?: TerminalPanelGeometryPreferences;
  workbenchSelected?: boolean;
  workbenchActivationSeq?: number;
  onWorkbenchTerminalCoreChange?: (sessionId: string, core: TerminalCore | null) => void;
  onWorkbenchTerminalSurfaceChange?: (sessionId: string, surface: HTMLDivElement | null) => void;
  onTitleChange?: (title: string) => void;
}

type TerminalPanelInnerProps = TerminalPanelProps & {
  onExecuteDenied?: () => void;
};

function buildActiveSessionStorageKey(panelId: string): string {
  return `redeven_terminal_active_session_id:${panelId}`;
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

function sameTerminalPanelSessionGroupState(
  left: TerminalPanelSessionGroupState,
  right: TerminalPanelSessionGroupState,
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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

const HISTORY_STATS_POLL_MS = 10_000;
const MAX_INLINE_TERMINAL_CONTEXT_CHARS = 10_000;

const TERMINAL_INPUT_SELECTOR = 'textarea[aria-label="Terminal input"], textarea';
const MOBILE_TERMINAL_TOUCH_SCROLL_LINE_HEIGHT_FALLBACK_PX = 20;
const MOBILE_TERMINAL_TOUCH_SCROLL_MIN_LINE_HEIGHT_PX = 12;
type TerminalSessionTabVisualStateMap = Record<string, TerminalTabVisualState>;
type TerminalSessionWorkStateMap = Record<string, TerminalSessionWorkState>;

type pending_terminal_session = {
  id: string;
  operationSequence: number;
  createdAtMs: number;
  name: string;
  workingDir: string;
  visibleSessionIdsAtCreate: string[];
  status: pending_terminal_session_status;
  errorMessage?: string;
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
  x: number;
  y: number;
  item: TerminalSessionNavigationItem;
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

type terminal_context_snapshot = {
  sessionId: string;
  selectionText: string;
  screenText: string;
  hasSelection: boolean;
};

function resolveTerminalTouchScrollTarget(core: TerminalCore | null): TerminalTouchScrollRuntime | null {
  if (!core) return null;
  return core.getTouchScrollRuntime();
}

function readTerminalSelectionText(core: TerminalCore | null): string {
  try {
    return String(core?.getSelectionText?.() ?? '');
  } catch {
    return '';
  }
}

function readTerminalScreenText(core: TerminalCore | null): string {
  if (!core) return '';

  try {
    const terminalInfo = core.getTerminalInfo();
    const rowCount = Math.max(0, Math.floor(Number(terminalInfo?.rows ?? 0)));
    const bufferLength = Math.max(0, Math.floor(Number(terminalInfo?.bufferLength ?? 0)));
    if (rowCount <= 0 || bufferLength <= 0) return '';

    const lines: string[] = [];
    const startRow = Math.max(0, bufferLength - rowCount);
    for (let row = startRow; row < bufferLength; row += 1) {
      lines.push(core.readBufferLine(row, { trimRight: true }));
    }

    const text = lines.join('\n').trim();
    const characters = Array.from(text);
    if (characters.length <= MAX_INLINE_TERMINAL_CONTEXT_CHARS) return text;
    return `...${characters.slice(-(MAX_INLINE_TERMINAL_CONTEXT_CHARS - 3)).join('')}`;
  } catch {
    return '';
  }
}

function buildTerminalContextSnapshot(sessionId: string, core: TerminalCore | null): terminal_context_snapshot {
  const normalizedSessionId = String(sessionId ?? '').trim();
  const rawSelectionText = readTerminalSelectionText(core);
  const hasSelection = (() => {
    try {
      return Boolean(core?.hasSelection?.() ?? false);
    } catch {
      return rawSelectionText.length > 0;
    }
  })();
  const normalizedSelectionText = hasSelection ? rawSelectionText : '';
  return {
    sessionId: normalizedSessionId,
    selectionText: normalizedSelectionText,
    screenText: hasSelection ? '' : readTerminalScreenText(core),
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

function resolveTerminalSidebarProcessState(foregroundRunning: boolean): TerminalSessionProcessState {
  return foregroundRunning ? 'running' : 'none';
}

function resolveTerminalSidebarAttentionState(
  visualState: TerminalTabVisualState | undefined,
): TerminalSessionAttentionState {
  return visualState === 'unread' ? 'unread' : 'none';
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

function normalizeTerminalSessionInfo(value: TerminalSessionInfo): TerminalSessionInfo | null {
  const id = String(value?.id ?? '').trim();
  if (!id) return null;
  return {
    id,
    name: String(value?.name ?? '').trim(),
    workingDir: normalizeAskFlowerAbsolutePath(String(value?.workingDir ?? '').trim()),
    createdAtMs: normalizeTerminalSessionTimestamp(value?.createdAtMs),
    lastActiveAtMs: normalizeTerminalSessionTimestamp(value?.lastActiveAtMs),
    isActive: Boolean(value?.isActive),
    foregroundCommand: normalizeTerminalForegroundCommand(value?.foregroundCommand),
    outputActivity: normalizeTerminalOutputActivity(value?.outputActivity),
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
    && a.name === b.name
    && a.workingDir === b.workingDir
    && a.createdAtMs === b.createdAtMs
    && a.lastActiveAtMs === b.lastActiveAtMs
    && a.isActive === b.isActive
    && sameTerminalForegroundCommand(a.foregroundCommand, b.foregroundCommand)
    && sameTerminalOutputActivity(a.outputActivity, b.outputActivity),
  );
}

function preserveStableTerminalSessionReferences(
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

function mergeTerminalSessionWorkStates(
  sessions: readonly TerminalSessionInfo[],
  workStateBySession: TerminalSessionWorkStateMap,
): TerminalSessionWorkState {
  let hasRunning = false;
  for (const session of sessions) {
    const state = workStateBySession[session.id] ?? 'idle';
    if (state === 'active') {
      return 'active';
    }
    if (state === 'running') {
      hasRunning = true;
    }
  }
  return hasRunning ? 'running' : 'idle';
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

function TerminalCreatingPane() {
  return <TerminalLoadingPane dataStage="creating" />;
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
  const activeSessionStorageKey = buildActiveSessionStorageKey(panelId);
  const sessionGroupState = createMemo<TerminalPanelSessionGroupState | null>(() => props.sessionGroupState ?? null);

  const [searchOpen, setSearchOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [sessionFilterQuery, setSessionFilterQuery] = createSignal('');
  const [sessionDrawerOpen, setSessionDrawerOpen] = createSignal(false);
  const [searchResultCount, setSearchResultCount] = createSignal(0);
  const [searchResultIndex, setSearchResultIndex] = createSignal(-1);
  const [panelHasFocus, setPanelHasFocus] = createSignal(false);
  const [agentHomePathAbs, setAgentHomePathAbs] = createSignal('');
  const [terminalAskMenu, setTerminalAskMenu] = createSignal<{
    x: number;
    y: number;
    workingDir: string;
    homePath?: string;
    selection: terminal_context_snapshot;
    showBrowseFiles: boolean;
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
  let searchBoundCore: TerminalCore | null = null;

  ensureTerminalPreferencesInitialized(floe.persist);
  const terminalPrefs = useTerminalPreferences();
  const terminalCatalog = useTerminalSessionCatalog();

  const terminalLive = createRedevenTerminalLiveBundle(rpc, () => protocol.client(), connId);
  const transport = terminalLive.transport;
  const eventSource = terminalLive.eventSource;
  const fallbackSessionsCoordinator = terminalCatalog
    ? null
    : getRedevenTerminalSessionsCoordinator({ connId, transport, logger: buildLogger() });
  const terminalWorkingSet = createTerminalAdaptiveWorkingSetManager({
    deviceMemoryGiB: typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  });
  const workingSetRuntimeDisposers = new Map<string, () => void>();
  let disposed = false;
  let nextCreateOperationSequence = 0;
  let lastSidebarPresentedEpoch = -1;
  const [authoritativelyClaimedSessionIds, setAuthoritativelyClaimedSessionIds] = createSignal<ReadonlySet<string>>(
    new Set<string>(),
  );
  createEffect(() => {
    transport.syncConnectionEpoch(protocol.client() ?? null);
  });
  onCleanup(() => {
    disposed = true;
    transport.dispose();
    terminalWorkingSet.dispose();
    workingSetRuntimeDisposers.clear();
    if (sidebarPathCopyResetTimer !== undefined) {
      globalThis.clearTimeout(sidebarPathCopyResetTimer);
      sidebarPathCopyResetTimer = undefined;
    }
  });

  const connected = () => protocol.status() === 'connected' && Boolean(protocol.client());
  const viewActive = () => view.active();
  const workbenchSelected = () => variant !== 'workbench' || props.workbenchSelected !== false;
  const terminalFocusOwner = () => viewActive() && workbenchSelected();
  const isEmbeddedWidget = Boolean(String(widgetId ?? '').trim());
  const permissionReady = () => env.env.state === 'ready';
  const canBrowseFiles = createMemo(() => connected() && permissionReady() && Boolean(env.env()?.permissions?.can_read));

  const captureSessionMutationFence = (): terminal_session_mutation_fence => ({
    envId: String(env.env_id() ?? '').trim(),
    connectionEpoch: terminalCatalog?.connectionEpoch() ?? 0,
    protocolClient: protocol.client(),
  });

  const sessionMutationFenceIsCurrent = (fence: terminal_session_mutation_fence): boolean => (
    !disposed
    && connected()
    && permissionReady()
    && canLaunchProcess(env.env()?.permissions)
    && String(env.env_id() ?? '').trim() === fence.envId
    && protocol.client() === fence.protocolClient
    && (terminalCatalog?.connectionEpoch() ?? 0) === fence.connectionEpoch
  );

  createEffect(() => {
    if (!terminalCatalog) return;
    terminalCatalog.setSurfaceActive(panelId, connected() && viewActive() && workbenchSelected());
    onCleanup(() => terminalCatalog.setSurfaceActive(panelId, false));
  });

  createEffect(() => {
    if (terminalFocusOwner()) return;
    // Reset focus state when the view becomes inactive to avoid stale focus affecting autoFocus decisions.
    setPanelHasFocus(false);
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
    const menu = terminalAskMenu();
    if (!menu) return;

    const closeMenu = () => {
      setTerminalAskMenu(null);
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        closeMenu();
        return;
      }
      if (terminalAskMenuEl?.contains(target)) return;
      closeMenu();
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);

    onCleanup(() => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    });
  });

  createEffect(() => {
    const menu = terminalSidebarMenu();
    if (!menu) return;

    const closeMenu = () => {
      setTerminalSidebarMenu(null);
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        closeMenu();
        return;
      }
      if (terminalSidebarMenuEl?.contains(target)) return;
      closeMenu();
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);

    onCleanup(() => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    });
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

  const fontFamily = createMemo<string>(() => {
    return resolveTerminalFontFamily(fontFamilyId());
  });

  const isMobileLayout = () => layout.isMobile();

  const persistFontSize = (value: number) => {
    const shared = sharedGeometryPreferences();
    if (shared) {
      shared.onFontSizeChange(normalizeTerminalFontSize(value));
      return;
    }
    terminalPrefs.setFontSize(value);
  };

  const persistFontFamily = (id: string) => {
    const shared = sharedGeometryPreferences();
    if (shared) {
      shared.onFontFamilyChange(normalizeTerminalFontFamilyId(id));
      return;
    }
    terminalPrefs.setFontFamily(id);
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
  const [workStateBySession, setWorkStateBySession] = createSignal<TerminalSessionWorkStateMap>({});
  const [foregroundPresentationBySession, setForegroundPresentationBySession] = createSignal<
    ReadonlyMap<string, TerminalForegroundPresentation>
  >(new Map());
  const [runtimeStatusBySession, setRuntimeStatusBySession] = createSignal<Record<string, TerminalSessionRuntimeStatus>>({});

  const handleExecuteDenied = (e: unknown): boolean => {
    if (!isPermissionDeniedError(e, 'process')) return false;
    props.onExecuteDenied?.();
    return true;
  };

  const [historyBytes, setHistoryBytes] = createSignal<number | null>(null);

  const coreRegistry = new Map<string, TerminalCore>();
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
    publishWorkState: (sessionId, state) => {
      setWorkStateBySession((prev) => {
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

  const [coreRegistrySeq, setCoreRegistrySeq] = createSignal(0);
  const [surfaceRegistrySeq, setSurfaceRegistrySeq] = createSignal(0);
  let mobileKeyboardInsetSyncRaf: number | null = null;

  const visibleAllSessions = createMemo<TerminalSessionInfo[]>((previous) => (
    preserveStableTerminalSessionReferences(
      mergeTerminalSessionLists(allSessions(), optimisticTerminalSessions(), optimisticClosingSessionIds()),
      previous,
    )
  ), []);

  const buildRegisteredTerminalAppearance = (): TerminalAppearance => ({
    theme: terminalThemeColors(),
    fontSize: fontSize(),
    fontFamily: fontFamily(),
  });

  const applyRegisteredTerminalAppearance = (
    core: TerminalCore,
    appearance: TerminalAppearance = buildRegisteredTerminalAppearance(),
  ) => {
    core.setAppearance(appearance);
  };

  const updateSessionGroupState = (
    updater: (previous: TerminalPanelSessionGroupState) => TerminalPanelSessionGroupState,
  ): boolean => {
    const current = sessionGroupState();
    if (!current || !props.onSessionGroupStateChange) {
      return false;
    }

    const next = updater(current);
    if (sameTerminalPanelSessionGroupState(current, next)) {
      return true;
    }

    props.onSessionGroupStateChange(next);
    return true;
  };

  const sessionGroupSessionIds = createMemo<readonly string[] | null>((previous) => {
    const group = sessionGroupState();
    if (!group) {
      return previous === null ? previous : null;
    }
    return previous !== null && sameSessionIdList(previous, group.sessionIds) ? previous : [...group.sessionIds];
  }, null);

  const sessions = createMemo<TerminalSessionInfo[]>(() => {
    const list = visibleAllSessions();
    const groupSessionIds = sessionGroupSessionIds();
    if (!groupSessionIds) {
      return list;
    }

    const sessionsById = new Map(list.map((session) => [session.id, session]));
    const orderedVisibleSessions: TerminalSessionInfo[] = [];
    for (const sessionId of groupSessionIds) {
      const session = sessionsById.get(sessionId);
      if (session) {
        orderedVisibleSessions.push(session);
      }
    }
    return orderedVisibleSessions;
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

    const group = sessionGroupState();
    if (group) {
      return group.activeSessionId;
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

  createEffect(() => {
    terminalWorkingSet.setActiveSession(activeSessionId());
  });

  createEffect(() => {
    const id = searchOpen() ? activeSessionId() : null;
    if (!id) return;
    terminalWorkingSet.setInteraction(id, 'search', true);
    onCleanup(() => terminalWorkingSet.setInteraction(id, 'search', false));
  });

  createEffect(() => {
    const id = terminalAskMenu()?.selection.sessionId ?? terminalSidebarMenu()?.item.id ?? null;
    if (!id) return;
    terminalWorkingSet.setInteraction(id, 'context-menu', true);
    onCleanup(() => terminalWorkingSet.setInteraction(id, 'context-menu', false));
  });

  if (typeof document !== 'undefined') {
    const handleTerminalPageVisibility = () => {
      terminalWorkingSet.setPageHidden(document.hidden);
    };
    handleTerminalPageVisibility();
    document.addEventListener('visibilitychange', handleTerminalPageVisibility);
    onCleanup(() => document.removeEventListener('visibilitychange', handleTerminalPageVisibility));
  }

  const activePendingSession = createMemo<pending_terminal_session | null>(() => {
    const activeId = activeDisplaySessionId();
    if (!activeId) return null;
    return visiblePendingTerminalSessions().find((session) => session.id === activeId) ?? null;
  });

  const ensureSessionInGroup = (sessionId: string) => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) {
      return;
    }

    updateSessionGroupState((previous) => (
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
    if (!updateSessionGroupState((previous) => ({
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
    markSessionMounted(resolved.sessionId);
    ensureSessionInGroup(resolved.sessionId);
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
    markTerminalPerformance('session-interactive', {
      session_ref: pseudonymousTerminalSessionRef(sessionId),
      variant,
    });
    terminalCatalog?.updateSessionMeta(sessionId, {
      isActive: true,
      lastActiveAtMs: Date.now(),
    });
    terminalCatalog?.startHistoryWarmup();
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

  const registerWorkingSetRuntime = (id: string, runtime: TerminalWorkingSetRuntime | null) => {
    const normalizedId = String(id ?? '').trim();
    if (!normalizedId) return;
    workingSetRuntimeDisposers.get(normalizedId)?.();
    workingSetRuntimeDisposers.delete(normalizedId);
    if (!runtime) return;
    workingSetRuntimeDisposers.set(normalizedId, terminalWorkingSet.register(normalizedId, runtime));
  };

  const setWorkingSetInteraction = (
    id: string,
    interaction: TerminalWorkingSetInteraction,
    active: boolean,
  ) => {
    terminalWorkingSet.setInteraction(id, interaction, active);
  };

  const registerCore = (id: string, core: TerminalCore | null) => {
    if (!id) return;
    if (core) {
      coreRegistry.set(id, core);
      applyRegisteredTerminalAppearance(core);
      props.onWorkbenchTerminalCoreChange?.(id, core);
      setCoreRegistrySeq((v) => v + 1);
      return;
    }
    coreRegistry.delete(id);
    props.onWorkbenchTerminalCoreChange?.(id, null);
    setCoreRegistrySeq((v) => v + 1);
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
    setRuntimeStatusBySession((current) => {
      if (
        current[id]?.state === status.state
        && current[id]?.failureCode === status.failureCode
        && current[id]?.retryable === status.retryable
        && current[id]?.diagnosticsQuery === status.diagnosticsQuery
      ) return current;
      return { ...current, [id]: status };
    });
  };

  const getActiveTerminalViewportElement = (): HTMLDivElement | null => {
    const sid = activeSessionId();
    if (!sid) return null;
    const surface = surfaceRegistry.get(sid);
    const viewport = surface?.parentElement;
    return viewport instanceof HTMLDivElement ? viewport : null;
  };

  const handleNameUpdate = (sessionId: string, newName: string, workingDir: string) => {
    if (terminalCatalog) {
      terminalCatalog.updateSessionMeta(sessionId, { name: newName, workingDir });
    } else {
      fallbackSessionsCoordinator?.updateSessionMeta(sessionId, { name: newName, workingDir });
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

    const group = sessionGroupState();
    if (group && props.onSessionGroupStateChange) {
      const nextVisibleIds = group.sessionIds.filter((sessionId) => visibleNext.some((session) => session.id === sessionId));
      const visibleSessions = nextVisibleIds
        .map((sessionId) => visibleNext.find((session) => session.id === sessionId) ?? null)
        .filter((session): session is TerminalSessionInfo => session !== null);
      const preferredActiveSessionId = group.activeSessionId && nextVisibleIds.includes(group.activeSessionId)
        ? group.activeSessionId
        : null;
      const resolvedActiveSessionId = preferredActiveSessionId ?? pickPreferredActiveId(visibleSessions, null);
      const nextGroupState: TerminalPanelSessionGroupState = {
        sessionIds: nextVisibleIds,
        activeSessionId: resolvedActiveSessionId,
      };
      if (!sameTerminalPanelSessionGroupState(group, nextGroupState)) {
        props.onSessionGroupStateChange(nextGroupState);
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
    const unsub = fallbackSessionsCoordinator?.subscribe(handleSessionsSnapshot);
    if (!unsub) return;
    onCleanup(() => unsub());
  });

  createEffect(() => {
    const appearance = buildRegisteredTerminalAppearance();
    void coreRegistrySeq();
    for (const core of coreRegistry.values()) {
      applyRegisteredTerminalAppearance(core, appearance);
    }
  });

  const shouldMarkSessionUnread = (sessionId: string): boolean => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) {
      return false;
    }

    if (!sessions().some((session) => session.id === normalizedSessionId)) {
      return false;
    }

    return activeSessionId() !== normalizedSessionId || !terminalFocusOwner();
  };

  const handleShellIntegrationEvent = (
    sessionId: string,
    event: TerminalShellIntegrationEvent,
    source: 'history' | 'live',
  ) => {
    if (event.kind === 'cwd-update') {
      const workingDir = normalizeAskFlowerAbsolutePath(event.workingDir);
      if (workingDir) {
        if (terminalCatalog) {
          terminalCatalog.updateSessionMeta(sessionId, { workingDir });
        } else {
          fallbackSessionsCoordinator?.updateSessionMeta(sessionId, { workingDir });
        }
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
      tabActivityTracker.handlePromptReady(sessionId);
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
    if (source === 'live') terminalWorkingSet.evaluate();
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
    if (!canBrowseFiles()) {
      return;
    }

    try {
      await filePreview.openPreview(fileItemFromPath(target.resolvedPath));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify.error(i18n.t('terminal.failedToOpenFilePreviewTitle'), message || i18n.t('terminal.couldNotOpenFileReference'));
    }
  };

  const activeSession = createMemo<TerminalSessionInfo | null>(() => {
    const sid = activeSessionId();
    if (!sid) return null;
    return sessions().find((session) => session.id === sid) ?? null;
  });

  createEffect(() => {
    const terminalLabel = i18n.t('terminal.title');
    const session = activeSession();
    const foregroundDisplayName = session
      ? foregroundPresentationBySession().get(session.id)?.displayName ?? ''
      : '';
    props.onTitleChange?.(session
      ? buildTerminalPanelTitle(session, terminalLabel, foregroundDisplayName)
      : buildPendingTerminalPanelTitle(activePendingSession(), terminalLabel));
  });

  const activeSessionWorkingDir = createMemo(() => {
    return normalizeAskFlowerAbsolutePath(activeSession()?.workingDir ?? '')
      || normalizeAskFlowerAbsolutePath(agentHomePathAbs())
      || '/';
  });

  const activeMobileKeyboardHistory = createMemo(() => {
    const sid = activeSessionId();
    if (!sid) return [] as string[];
    return mobileKeyboardHistoryBySession()[sid] ?? [];
  });

  const mobileKeyboardContext = createMemo(() => {
    return deriveTerminalMobileKeyboardContext({
      state: mobileKeyboardDraftState(),
      workingDirAbs: activeSessionWorkingDir(),
      agentHomePathAbs: agentHomePathAbs(),
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
    return mergeTerminalSessionWorkStates(sessions(), workStateBySession());
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

  const restoreTerminalSessionFocus = (intent: TerminalFocusRestoreIntent) => {
    requestAnimationFrame(() => {
      if (!terminalFocusOwner() || !shouldRestoreTerminalFocus()) return;
      if (activeSessionId() !== intent.sessionId || !focusOwnerMatchesRestoreIntent(intent)) return;
      actionsRegistry.get(intent.sessionId)?.focusIfInteractive();
    });
  };

  const restoreActiveTerminalFocus = () => {
    if (!shouldRestoreTerminalFocus()) return;
    const sid = activeSessionId();
    if (sid) restoreTerminalSessionFocus(captureTerminalFocusRestoreIntent(sid));
  };

  const commitSidebarSessionSelection = (sessionId: string) => {
    requestSessionSelection(sessionId, true);
  };

  const previewSidebarSessionSelection = (event: PointerEvent, sessionId: string) => {
    if (event.button !== 0) return;
    sessionSelection.preview(sessionId);
  };

  const activeTerminalHasSelection = () => {
    const core = getActiveCore();
    try {
      return Boolean(core?.hasSelection?.() ?? false);
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
    void coreRegistrySeq();
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
    const query = mobileKeyboardContext().pathQuery;
    if (!shouldUseFloeMobileKeyboard() || !query) {
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
    const workingDir = activeSessionWorkingDir();
    if (!shouldUseFloeMobileKeyboard() || !workingDir) {
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

  createEffect(() => {
    const sid = activeSessionId();
    const isConnected = connected();
    if (!isConnected || !sid) {
      setHistoryBytes(null);
      return;
    }

    setHistoryBytes(null);

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const refresh = async () => {
      try {
        const stats = await transport.getSessionStats(sid);
        if (cancelled) return;
        setHistoryBytes(stats.history.totalBytes);
      } catch {
      }
    };

    void refresh();
    if (HISTORY_STATS_POLL_MS > 0) {
      timer = setInterval(() => void refresh(), HISTORY_STATS_POLL_MS);
    }

    onCleanup(() => {
      cancelled = true;
      if (timer) clearInterval(timer);
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

    ensureSessionInGroup(normalizedSessionId);
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
  ): Promise<terminal_panel_created_session | null> => {
    const normalizedWorkingDir = normalizeAskFlowerAbsolutePath(String(workingDir ?? '').trim()) || agentHomePathAbs() || '';
    if (props.sessionOperations) {
      return normalizeTerminalPanelSessionCreateResult(
        await props.sessionOperations.createSession(name, normalizedWorkingDir),
      );
    }

    const sessionCoordinator = terminalCatalog?.getCoordinator() ?? fallbackSessionsCoordinator;
    if (!sessionCoordinator) return null;
    const session = await sessionCoordinator.createSession(String(name ?? '').trim(), normalizedWorkingDir);
    return normalizeTerminalPanelSessionCreateResult(session);
  };

  const createPendingSession = (name: string | undefined, workingDir: string): pending_terminal_session => {
    const operationSequence = ++nextCreateOperationSequence;
    const pendingSession: pending_terminal_session = {
      id: createClientId('pending-terminal'),
      operationSequence,
      createdAtMs: Date.now(),
      name: String(name ?? '').trim() || i18n.t('terminal.title'),
      workingDir: normalizeAskFlowerAbsolutePath(String(workingDir ?? '').trim()) || agentHomePathAbs() || '',
      visibleSessionIdsAtCreate: sessions().map((session) => session.id),
      status: 'creating',
    };
    batch(() => {
      setPendingTerminalSessions((previous) => [...previous, pendingSession]);
      setLocalActivePendingSessionId(pendingSession.id);
      selectOptimisticActiveDisplaySessionId(pendingSession.id);
    });
    markTerminalPerformance('create-intent', { operation_sequence: operationSequence });
    return pendingSession;
  };

  const removePendingSession = (pendingSessionId: string) => {
    const normalizedPendingSessionId = String(pendingSessionId ?? '').trim();
    if (!normalizedPendingSessionId) return;
    setPendingTerminalSessions((previous) => previous.filter((session) => session.id !== normalizedPendingSessionId));
    if (localActivePendingSessionId() === normalizedPendingSessionId) {
      setLocalActivePendingSessionId(null);
    }
  };

  const failPendingSession = (pendingSessionId: string, errorMessage: string) => {
    const normalizedPendingSessionId = String(pendingSessionId ?? '').trim();
    if (!normalizedPendingSessionId) return;
    let updated = false;
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
    setActiveSessionId(normalizedPendingSessionId);
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
    removePendingSession(normalizedPendingSessionId);
    markSessionMounted(normalizedSessionId);
    activateSession(normalizedSessionId);
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

  const beginCreateSession = async (name: string | undefined, workingDir: string): Promise<string | null> => {
    const pendingSession = createPendingSession(name, workingDir);
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
      const result = await createPanelSession(name, pendingSession.workingDir);
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

  const createSession = async () => {
    if (!connected()) return;
    setError(null);
    const nextIndex = sessions().length + pendingTerminalSessions().length + 1;
    void beginCreateSession(i18n.t('terminal.terminalName', { index: nextIndex }), agentHomePathAbs() || '');
  };

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
      terminalCatalog?.invalidateHistory(sid, 'clear');
      await transport.clear(sid);
      const actions = actionsRegistry.get(sid);
      if (actions && !await actions.resetAfterClear()) {
        throw new Error(i18n.t('terminal.clearFailedMessage'));
      }
      await transport.sendInput(sid, '\r', connId);
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

  const refreshHistoryStats = async (sid: string) => {
    if (!connected()) return;
    if (!sid) return;
    try {
      const stats = await transport.getSessionStats(sid);
      if (activeSessionId() !== sid) return;
      setHistoryBytes(stats.history.totalBytes);
    } catch {
    }
  };

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
        setHistoryBytes(null);

        // Ensure the refresh flow matches the page open path: rebuild + attach + replay history.
        const actions = await waitForActions(sid);
        await actions?.reload();

        await refreshHistoryStats(sid);
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
    const client = protocol.client();
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
    if (!terminalFocusOwner()) return;
    const id = activeSessionId();
    if (!id) return;
    tabActivityTracker.clearUnread(id);
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

    tabActivityTracker.pruneSessions(ids);

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

    setWorkStateBySession((prev) => {
      let changed = false;
      const next: TerminalSessionWorkStateMap = {};
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
          releaseTerminalRecoveryDiagnostics(id);
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
    const tabStates = tabVisualStateBySession();
    const foregroundPresentations = foregroundPresentationBySession();
    const canOpenPath = canBrowseFiles();
    const sessionItems = list.map((s, index) => {
      const fullPath = normalizeAskFlowerAbsolutePath(String(s.workingDir ?? '').trim());
      const fallbackLabel = buildTerminalSessionLabel(s, i18n.t('terminal.terminalName', { index: index + 1 }));
      const directoryTitle = buildTerminalSidebarDirectoryTitle(fullPath, fallbackLabel);
      const foregroundPresentation = foregroundPresentations.get(s.id);
      const title = foregroundPresentation?.displayName || directoryTitle;
      const agentPresentation = deriveTerminalAgentSessionPresentation(
        foregroundPresentation?.displayName ?? '',
        s.outputActivity?.phase,
      );
      return {
        id: s.id,
        label: fallbackLabel,
        title,
        avatarInitial: buildTerminalSidebarAvatarInitial(directoryTitle),
        avatarTone: buildTerminalSidebarAvatarTone(`${s.id}:${fullPath}:${directoryTitle}`),
        fullPath,
        processState: resolveTerminalSidebarProcessState(Boolean(foregroundPresentation)),
        outputState: agentPresentation.outputState,
        attentionState: resolveTerminalSidebarAttentionState(tabStates[s.id]),
        agentIdentity: agentPresentation.identity,
        canBrowsePath: Boolean(fullPath) && canOpenPath,
        canClear: true,
        canDuplicate: Boolean(fullPath),
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
        fullPath,
        processState: session.status,
        outputState: 'none' as const,
        attentionState: 'none' as const,
        agentIdentity: null,
        canBrowsePath: Boolean(fullPath) && canOpenPath,
        canClear: false,
        canDuplicate: false,
        closable: session.status === 'failed',
      };
    });
    return [...sessionItems, ...pendingItems];
  });
  const sessionListItemById = createMemo(() => new Map(sessionListItems().map((item) => [item.id, item])));
  const sessionListItemIds = createMemo((previous: readonly string[] = []) => {
    const query = sessionFilterQuery().trim().toLocaleLowerCase();
    const next = sessionListItems().filter((item) => {
      if (!query) return true;
      return [item.label, item.title, item.fullPath, item.id]
        .some((value) => value.toLocaleLowerCase().includes(query));
    }).map((item) => item.id);
    return sameSessionIdList(previous, next) ? previous : next;
  });

  let searchInputEl: HTMLInputElement | null = null;
  let rootEl: HTMLDivElement | null = null;
  const [mobileKeyboardElement, setMobileKeyboardElement] = createSignal<HTMLDivElement | null>(null);

  const getActiveCore = () => {
    const sid = activeSessionId();
    if (!sid) return null;
    return coreRegistry.get(sid) ?? null;
  };

  const getActiveSurfaceElement = () => {
    const sid = activeSessionId();
    if (!sid) return null;
    return surfaceRegistry.get(sid) ?? null;
  };

  const getActiveTerminalInputElement = () => {
    return resolveTerminalInputElement(getActiveSurfaceElement());
  };

  const getTerminalTouchScrollLineHeightPx = (surface: HTMLDivElement, core: TerminalCore) => {
    const rows = Math.max(1, core.getDimensions().rows);
    const height = surface.getBoundingClientRect().height;
    if (!Number.isFinite(height) || height <= 0) {
      return MOBILE_TERMINAL_TOUCH_SCROLL_LINE_HEIGHT_FALLBACK_PX;
    }

    return Math.max(MOBILE_TERMINAL_TOUCH_SCROLL_MIN_LINE_HEIGHT_PX, height / rows);
  };

  const applyTerminalTouchScrollLines = (sessionId: string, core: TerminalCore, lineDelta: number): boolean => {
    if (lineDelta === 0) return false;

    const target = resolveTerminalTouchScrollTarget(core);
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

    const core = coreRegistry.get(sid);
    if (!core) return;

    requestAnimationFrame(() => {
      if (activeSessionId() !== sid) return;
      if (!connected()) return;
      if (terminalViewportInsetPx() !== inset) return;
      core.forceResize();
    });
  });

  createEffect(() => {
    void surfaceRegistrySeq();
    void coreRegistrySeq();
    const sid = activeSessionId();
    const surface = getActiveSurfaceElement();
    const core = getActiveCore();
    const mobile = isMobileLayout();

    if (!mobile || !sid || !surface || !core) return;

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

      const lineHeightPx = getTerminalTouchScrollLineHeightPx(surface, core);
      const rawLineDelta = -accumulatedPx / lineHeightPx;
      const wholeLineDelta = rawLineDelta > 0 ? Math.floor(rawLineDelta) : Math.ceil(rawLineDelta);
      if (wholeLineDelta === 0) return;

      if (!applyTerminalTouchScrollLines(sid, core, wholeLineDelta)) {
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

    void transport.sendInput(sid, payload, connId).catch((e) => {
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
      restoreActiveTerminalFocus();
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

    const workingDir = normalizeAskFlowerAbsolutePath(String(resolvedSession.workingDir ?? '').trim())
      || normalizeAskFlowerAbsolutePath(agentHomePathAbs())
      || '';
    const homePath = normalizeAskFlowerAbsolutePath(agentHomePathAbs()) || undefined;
    const core = coreRegistry.get(resolvedSession.id) ?? getActiveCore();
    const selection = buildTerminalContextSnapshot(resolvedSession.id, core);
    const showBrowseFiles = Boolean(workingDir) && canBrowseFiles();

    if (!currentActiveId) {
      setActiveSessionId(resolvedSession.id);
    }

    setTerminalSidebarMenu(null);
    setTerminalAskMenu({
      x: context.x,
      y: context.y,
      workingDir,
      homePath,
      selection,
      showBrowseFiles,
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

    const core = coreRegistry.get(normalizedSessionId)
      ?? (activeSessionId() === normalizedSessionId ? getActiveCore() : null);
    if (!core) return false;

    const result = await core.copySelection(context.source === 'shortcut' ? 'shortcut' : 'command');
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
    if (!menu || !menu.showBrowseFiles) return;
    setTerminalAskMenu(null);

    void env.openFileBrowserAtPath(menu.workingDir, {
      homePath: menu.homePath,
      openStrategy: env.viewMode() === 'workbench' ? 'create_new' : undefined,
    });
  };

  const openSidebarItemFiles = (item: TerminalSessionNavigationItem) => {
    if (!item.canBrowsePath || !item.fullPath) return;

    setTerminalSidebarMenu(null);
    void env.openFileBrowserAtPath(item.fullPath, {
      homePath: normalizeAskFlowerAbsolutePath(agentHomePathAbs()) || undefined,
      title: buildTerminalSidebarDirectoryTitle(item.fullPath, item.label),
      openStrategy: env.viewMode() === 'workbench' ? 'create_new' : undefined,
    });
  };

  const copySidebarItemPath = (item: TerminalSessionNavigationItem) => {
    const fullPath = normalizeAskFlowerAbsolutePath(item.fullPath);
    if (!fullPath) return;

    void writeTextToClipboard(fullPath)
      .then(() => {
        setCopiedSidebarPathSessionId(item.id);
        if (sidebarPathCopyResetTimer !== undefined) {
          globalThis.clearTimeout(sidebarPathCopyResetTimer);
        }
        sidebarPathCopyResetTimer = globalThis.setTimeout(() => {
          sidebarPathCopyResetTimer = undefined;
          setCopiedSidebarPathSessionId((current) => (current === item.id ? null : current));
        }, 1500);
      })
      .catch(notifyTerminalCopyFailure);
  };

  const duplicateSidebarItemSession = (item: TerminalSessionNavigationItem) => {
    const fullPath = normalizeAskFlowerAbsolutePath(item.fullPath);
    if (!connected() || !item.canDuplicate || !fullPath) return;
    const nextIndex = sessions().length + pendingTerminalSessions().length + 1;
    const fallbackName = i18n.t('terminal.terminalName', { index: nextIndex });
    void beginCreateSession(resolveRequestedSessionName(undefined, fullPath, fallbackName), fullPath);
  };

  const clearSidebarItemSession = (item: TerminalSessionNavigationItem) => {
    if (!item.canClear) return;
    const menu = terminalSidebarMenu();
    const focusRestoreIntent = captureTerminalFocusRestoreIntent(
      item.id,
      menu?.triggerElement ?? null,
    );
    setTerminalSidebarMenu(null);
    void clearSession(item.id, { focusRestoreIntent });
  };

  const askFlowerFromSidebarItem = (item: TerminalSessionNavigationItem, anchor: { x: number; y: number }) => {
    const workingDir = normalizeAskFlowerAbsolutePath(item.fullPath) || normalizeAskFlowerAbsolutePath(agentHomePathAbs()) || '';
    if (!workingDir) return;
    setTerminalSidebarMenu(null);
    openTerminalAskFlowerContext({
      x: anchor.x,
      y: anchor.y,
      workingDir,
      selection: buildTerminalContextSnapshot(item.id, coreRegistry.get(item.id) ?? null),
    });
  };

  const openTerminalAskFlowerContext = (context: {
    x: number;
    y: number;
    workingDir: string;
    selection: terminal_context_snapshot;
  }) => {
    const workingDir = normalizeAskFlowerAbsolutePath(context.workingDir) || normalizeAskFlowerAbsolutePath(agentHomePathAbs()) || '';
    if (!workingDir) return;

    const selection = context.selection.hasSelection
      ? context.selection.selectionText
      : context.selection.screenText;
    const trimmedSelection = selection.trim();
    const selectionChars = Array.from(trimmedSelection).length;
    const notes: string[] = [];
    let contextItems: EnvFlowerTurnLauncherContextItem[] = [];

    if (trimmedSelection) {
      if (selectionChars > MAX_INLINE_TERMINAL_CONTEXT_CHARS) {
        notes.push(i18n.t('terminal.largeSelectionMetadataOnly'));
        contextItems = [
          {
            kind: 'terminal_selection',
            working_dir: workingDir,
            selection: '',
            selection_chars: selectionChars,
          },
        ];
      } else {
        contextItems = [
          {
            kind: 'terminal_selection',
            working_dir: workingDir,
            selection: trimmedSelection,
            selection_chars: selectionChars,
          },
        ];
      }
    } else {
      notes.push(i18n.t('terminal.noSelectionContextOnly'));
      contextItems = [
        {
          kind: 'terminal_selection',
          working_dir: workingDir,
          selection: '',
          selection_chars: 0,
        },
      ];
    }

    env.openFlowerTurnLauncher(attachAskFlowerContextAction({
      id: createClientId('ask-flower'),
      source_surface: 'terminal',
      suggested_working_dir: workingDir,
      context_items: contextItems,
      pending_attachments: [],
      notes,
    }), { x: context.x, y: context.y });
  };

  const askFlowerFromTerminal = () => {
    const menu = terminalAskMenu();
    if (!menu) return;
    setTerminalAskMenu(null);
    openTerminalAskFlowerContext({
      x: menu.x,
      y: menu.y,
      workingDir: menu.workingDir,
      selection: menu.selection,
    });
  };

  const buildTerminalAskMenuItems = (menu: NonNullable<ReturnType<typeof terminalAskMenu>>): FloatingContextMenuItem[] => {
    const primaryItems: FloatingContextMenuItem[] = [
      {
        id: 'ask-flower',
        kind: 'action',
        label: i18n.t('terminal.askFlower'),
        icon: FlowerContextMenuIcon,
        onSelect: askFlowerFromTerminal,
      },
    ];
    if (menu.showBrowseFiles) {
      primaryItems.push({
        id: 'browse-files',
        kind: 'action',
        label: i18n.t('terminal.browseFiles'),
        icon: Folder,
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
    const item = menu.item;
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
        onSelect: () => openSidebarItemFiles(item),
      },
      {
        id: 'sidebar-duplicate',
        kind: 'action',
        label: i18n.t('terminal.duplicateSession'),
        icon: Copy,
        disabled: !item.canDuplicate,
        onSelect: () => {
          setTerminalSidebarMenu(null);
          duplicateSidebarItemSession(item);
        },
      },
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
      x: event.clientX,
      y: event.clientY,
      item,
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
      x: rect ? rect.left + Math.min(rect.width - 16, 64) : 0,
      y: rect ? rect.top + Math.min(rect.height - 8, 44) : 0,
      item,
      triggerElement: target,
    });
  };

  const dismissTerminalAskMenu = (reason: 'escape' | 'tab' | 'shift-tab') => {
    const menu = terminalAskMenu();
    const focusRestoreIntent = menu
      ? captureTerminalFocusRestoreIntent(menu.selection.sessionId, menu.triggerElement)
      : null;
    setTerminalAskMenu(null);
    if (reason === 'escape' && focusRestoreIntent) {
      restoreTerminalSessionFocus(focusRestoreIntent);
    }
  };

  const dismissTerminalSidebarMenu = (reason: 'escape' | 'tab' | 'shift-tab') => {
    const menu = terminalSidebarMenu();
    setTerminalSidebarMenu(null);
    if (reason !== 'escape' || !menu?.triggerElement?.isConnected) return;
    requestAnimationFrame(() => menu.triggerElement?.focus({ preventScroll: true }));
  };

  const bindSearchCore = (core: TerminalCore | null) => {
    if (searchBoundCore && searchBoundCore !== core) {
      // Unbind callbacks from the previous core to avoid cross-session search counters.
      searchBoundCore.setSearchResultsCallback(null);
    }

    searchBoundCore = core;

    if (!core) {
      setSearchResultIndex(-1);
      setSearchResultCount(0);
      return;
    }

    core.setSearchResultsCallback(({ resultIndex, resultCount }) => {
      setSearchResultIndex(Number.isFinite(resultIndex) ? resultIndex : -1);
      setSearchResultCount(Number.isFinite(resultCount) ? resultCount : 0);
    });
  };

  createEffect(() => {
    const open = searchOpen();
    const sid = activeSessionId();
    void coreRegistrySeq();

    const core = sid ? (coreRegistry.get(sid) ?? null) : null;
    if (!open || !core) {
      bindSearchCore(null);
      searchLastAppliedKey = '';
      return;
    }

    bindSearchCore(core);
  });

  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  createEffect(() => {
    const open = searchOpen();
    const q = searchQuery();
    const sid = activeSessionId();
    void coreRegistrySeq();
    if (!open || !sid) {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
      return;
    }

    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      const core = coreRegistry.get(sid) ?? null;
      if (!core) return;

      const term = q.trim();
      const key = `${sid}:${term}`;
      if (key === searchLastAppliedKey) return;

      if (!term) {
        core.clearSearch();
        searchLastAppliedKey = key;
        return;
      }

      core.findNext(term);
      searchLastAppliedKey = key;
    }, 120);
  });

  onCleanup(() => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    bindSearchCore(null);
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
    searchLastAppliedKey = '';
    // Search UI is panel-scoped; clear all sessions on close to avoid lingering highlights.
    for (const core of coreRegistry.values()) {
      core.clearSearch();
    }
    bindSearchCore(null);
    restoreActiveTerminalFocus();
  };

  const goNextMatch = () => {
    const core = getActiveCore();
    const term = searchQuery().trim();
    if (!core || !term) return;
    core.findNext(term);
  };

  const goPrevMatch = () => {
    const core = getActiveCore();
    const term = searchQuery().trim();
    if (!core || !term) return;
    core.findPrevious(term);
  };

  createEffect(() => {
    if (!isMobileLayout() || !sessionDrawerOpen()) return;
    const closeDrawerFromHistory = () => setSessionDrawerOpen(false);
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
      setSessionDrawerOpen(false);
      restoreActiveTerminalFocus();
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

  const terminalShortcutModLabel = createMemo(() => (isMacLikePlatform() ? 'Cmd' : 'Ctrl'));
  const activeSessionListItem = createMemo(() => {
    const activeId = activeDisplaySessionId();
    if (!activeId) return null;
    return sessionListItems().find((item) => item.id === activeId) ?? null;
  });
  const activeToolbarTitle = createMemo(() => activeSessionListItem()?.title ?? i18n.t('terminal.title'));
  const activeToolbarSubtitle = createMemo(() => {
    const activeItem = activeSessionListItem();
    if (activeItem?.fullPath) return activeItem.fullPath;
    const pending = activePendingSession();
    if (pending?.workingDir) return pending.workingDir;
    return activeSession()?.id ?? '';
  });

  const body = (
    <div
      ref={(n) => (rootEl = n)}
      data-terminal-panel-variant={variant}
      class="h-full min-h-0 flex flex-col"
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
      <Show when={connected()} fallback={<div class="p-4 text-xs text-muted-foreground">{i18n.t('terminal.notConnected')}</div>}>
        <div class="relative flex min-h-0 flex-1 overflow-hidden bg-background">
          <TerminalSessionNavigator
            mobile={isMobileLayout()}
            drawerOpen={sessionDrawerOpen()}
            connected={connected()}
            refreshing={refreshing()}
            activeTitle={activeToolbarTitle()}
            shortcutModLabel={terminalShortcutModLabel()}
            filterQuery={sessionFilterQuery()}
            itemIds={sessionListItemIds()}
            itemById={sessionListItemById()}
            sidebarActiveSessionId={sidebarActiveSessionId()}
            activeSessionId={activeDisplaySessionId()}
            copiedPathSessionId={copiedSidebarPathSessionId()}
            emptyListLoading={emptySessionListLoading()}
            onCloseDrawer={() => {
              setSessionDrawerOpen(false);
              restoreActiveTerminalFocus();
            }}
            onCreateSession={createSession}
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
            <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-2">
              <Show when={isMobileLayout()}>
                <Button
                  size="sm"
                  variant="ghost"
                  class="h-7 w-7 shrink-0 p-0"
                  data-testid="terminal-session-drawer-open"
                  onClick={() => setSessionDrawerOpen(true)}
                  title={i18n.t('terminal.sessions')}
                >
                  <Menu class="h-4 w-4" />
                </Button>
              </Show>
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground">
                  <Terminal class="h-3.5 w-3.5" />
                </div>
                <div class="min-w-0">
                  <div
                    class="truncate text-xs font-semibold text-foreground"
                    data-terminal-session-title={activeSessionId() ?? ''}
                  >
                    {activeToolbarTitle()}
                  </div>
                  <Show when={activeToolbarSubtitle()}>
                    <div class="truncate text-[10px] leading-3 text-muted-foreground">{activeToolbarSubtitle()}</div>
                  </Show>
                </div>
              </div>
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
                  inputRef={(element) => {
                    searchInputEl = element;
                  }}
                  onQueryChange={setSearchQuery}
                  onPrevious={goPrevMatch}
                  onNext={goNextMatch}
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
                              protocolClient={() => protocol.client()}
                              viewActive={viewActive}
                              autoFocus={shouldAutoFocus}
                              themeColors={terminalThemeColors}
                              fontSize={fontSize}
                              fontFamily={fontFamily}
                              agentHomePathAbs={agentHomePathAbs}
                              canOpenFilePreview={canBrowseFiles}
                              bottomInsetPx={terminalViewportInsetPx}
                              connId={connId}
                              transport={transport}
                              eventSource={eventSource}
                              registerCore={registerCore}
                              registerSurfaceElement={registerSurfaceElement}
                              registerActions={registerActions}
                              registerWorkingSetRuntime={registerWorkingSetRuntime}
                              onRuntimeStatus={handleRuntimeStatus}
                              onSessionGone={handleTerminalSessionGone}
                              onInteractive={handleTerminalInteractive}
                              onLiveOutputObserved={handleLiveOutputObserved}
                              onOutputCommitted={handleOutputCommitted}
                              onOutputCoverage={handleOutputCoverage}
                              onPendingOutputReset={resetPendingOutput}
                              setWorkingSetInteraction={setWorkingSetInteraction}
                              onSurfaceClick={handleWorkbenchTerminalSurfaceClick}
                              onBell={handleSessionBell}
                              onShellIntegrationEvent={handleShellIntegrationEvent}
                              onVisibleOutput={handleVisibleOutput}
                              onTerminalFileLinkOpen={openTerminalFileLinkTarget}
                              onNameUpdate={handleNameUpdate}
                              requestPreparedHistory={terminalCatalog?.requestPreparedHistory}
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
                          <Show
                            when={session().status === 'failed'}
                            fallback={<TerminalCreatingPane />}
                          >
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
                                      void beginCreateSession(failedSession.name, failedSession.workingDir);
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

            <Show when={error()}>
              <div class="p-2 text-[11px] text-error border-t border-border bg-background/80 break-words">{error()}</div>
            </Show>
            <Show when={showTerminalStatusBar()}>
              <div
                data-testid="terminal-status-bar"
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
                  <span
                    data-terminal-history-bytes={historyBytes() === null ? '' : String(historyBytes())}
                    class="ml-auto shrink-0"
                    classList={{ hidden: useMobileRecoveryStatusBar() }}
                  >
                    {i18n.t('terminal.statusHistory')}: {historyBytes() === null ? '-' : formatBytes(historyBytes() ?? 0)}
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
          </div>
        </div>
      </Show>

      <Show when={terminalAskMenu()} keyed>
        {(menu) => (
          <FloatingContextMenu
            x={menu.x}
            y={menu.y}
            ariaLabel={i18n.t('terminal.title')}
            focusAnchor={menu.triggerElement}
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
            x={menu.x}
            y={menu.y}
            ariaLabel={i18n.t('terminal.sessions')}
            focusAnchor={menu.triggerElement}
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
