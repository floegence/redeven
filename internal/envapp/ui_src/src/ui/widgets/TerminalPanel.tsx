import { For, Index, Show, batch, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { deferAfterPaint, isMacLikePlatform, matchKeybind, useCurrentWidgetId, useLayout, useNotification, useResolvedFloeConfig, useTheme, useViewActivation } from '@floegence/floe-webapp-core';
import { Sidebar, SidebarContent, SidebarItemList, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { Check, Copy, ExternalLink, Folder, Terminal, Trash, X } from '@floegence/floe-webapp-core/icons';

import {
  Button,
  Dropdown,
  Input,
  MobileKeyboard,
  TabPanel,
  type DropdownItem,
} from '@floegence/floe-webapp-core/ui';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { FlowerContextMenuIcon } from '../icons/FlowerSoftAuraIcon';
import { useRedevenRpc } from '../protocol/redeven_v1';
import {
  TerminalCore,
  getDefaultTerminalConfig,
  getThemeColors,
  type Logger,
  type TerminalAppearance,
  type TerminalEventSource,
  type TerminalResponsiveConfig,
  type TerminalSessionInfo,
  type TerminalThemeName,
} from '@floegence/floeterm-terminal-web';
import {
  createRedevenTerminalEventSource,
  createRedevenTerminalTransport,
  getOrCreateTerminalConnId,
  type RedevenTerminalTransport,
} from '../services/terminalTransport';
import { disposeRedevenTerminalSessionsCoordinator, getRedevenTerminalSessionsCoordinator } from '../services/terminalSessions';
import {
  ensureTerminalPreferencesInitialized,
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
import { isPermissionDeniedError } from '../utils/permission';
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
import { createTerminalFileLinkProvider, type TerminalResolvedLinkTarget } from '../services/terminalLinkProvider';
import { TerminalShellIntegrationParser, type TerminalShellIntegrationEvent } from '../services/terminalShellIntegration';
import { createTerminalTabActivityTracker, type TerminalSessionWorkState, type TerminalTabVisualState } from '../services/terminalTabActivity';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchTextSelectionSurface';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import { FloatingContextMenu, type FloatingContextMenuItem } from './FloatingContextMenu';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { useI18n } from '../i18n';

type session_loading_state = 'idle' | 'initializing' | 'attaching' | 'loading_history';
type pending_terminal_session_status = 'creating' | 'failed';

export type TerminalPanelVariant = 'panel' | 'workbench';

const TERMINAL_LIVE_FLUSH_MAX_CHUNKS = 64;
const TERMINAL_LIVE_FLUSH_MAX_BYTES = 256 * 1024;
const TERMINAL_LIVE_FLUSH_INTERVAL_MS = 100;
const TERMINAL_DEFERRED_LIVE_MAX_CHUNKS = 256;
const TERMINAL_DEFERRED_LIVE_MAX_BYTES = 512 * 1024;
const TERMINAL_HISTORY_REPLAY_MAX_CHUNKS = 64;
const TERMINAL_HISTORY_REPLAY_MAX_BYTES = 512 * 1024;
const TERMINAL_HISTORY_REPLAY_MODE_MS = 120_000;
const TERMINAL_HISTORY_REPLAY_MAX_PAGES = 4096;
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
    debug: (message, meta) => (typeof meta === 'undefined' ? console.debug(message) : console.debug(message, meta)),
    info: (message, meta) => (typeof meta === 'undefined' ? console.info(message) : console.info(message, meta)),
    warn: (message, meta) => (typeof meta === 'undefined' ? console.warn(message) : console.warn(message, meta)),
    error: (message, meta) => (typeof meta === 'undefined' ? console.error(message) : console.error(message, meta)),
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

function mergeTerminalChunks(chunks: readonly Uint8Array[]): Uint8Array | null {
  if (chunks.length === 0) return null;
  if (chunks.length === 1) return chunks[0] ?? null;

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function takeTerminalChunkBatch(
  queue: terminal_display_chunk[],
  maxChunks: number,
  maxBytes: number,
): terminal_display_chunk[] {
  if (queue.length === 0) return [];

  let count = 0;
  let byteLength = 0;
  while (count < queue.length && count < maxChunks) {
    const next = queue[count];
    if (!next) break;
    if (count > 0 && byteLength + next.data.byteLength > maxBytes) break;
    byteLength += next.data.byteLength;
    count += 1;
    if (byteLength >= maxBytes) break;
  }

  return queue.splice(0, Math.max(1, count));
}

function takeTerminalHistoryChunkBatch(
  queue: terminal_history_chunk[],
  maxChunks: number,
  maxBytes: number,
): terminal_history_chunk[] {
  if (queue.length === 0) return [];

  let count = 0;
  let byteLength = 0;
  while (count < queue.length && count < maxChunks) {
    const next = queue[count];
    if (!next) break;
    if (count > 0 && byteLength + next.data.byteLength > maxBytes) break;
    byteLength += next.data.byteLength;
    count += 1;
    if (byteLength >= maxBytes) break;
  }

  return queue.splice(0, Math.max(1, count));
}

function terminalNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

type terminal_session_view_props = {
  session: TerminalSessionInfo;
  variant: TerminalPanelVariant;
  active: () => boolean;
  connected: () => boolean;
  protocolClient: () => unknown;
  viewActive: () => boolean;
  autoFocus: () => boolean;
  themeColors: () => Record<string, string>;
  fontSize: () => number;
  fontFamily: () => string;
  agentHomePathAbs: () => string;
  canOpenFilePreview: () => boolean;
  bottomInsetPx: () => number;
  connId: string;
  transport: RedevenTerminalTransport;
  eventSource: TerminalEventSource;
  registerCore: (sessionId: string, core: TerminalCore | null) => void;
  registerSurfaceElement: (sessionId: string, surface: HTMLDivElement | null) => void;
  registerActions: (sessionId: string, actions: terminal_session_actions | null) => void;
  onSurfaceClick?: (event: MouseEvent) => void;
  onBell?: (sessionId: string) => void;
  onShellIntegrationEvent?: (sessionId: string, event: TerminalShellIntegrationEvent, source: 'history' | 'live') => void;
  onVisibleOutput?: (sessionId: string, source: 'history' | 'live', byteLength: number) => void;
  onTerminalFileLinkOpen?: (target: TerminalResolvedLinkTarget) => Promise<void> | void;
  onNameUpdate?: (sessionId: string, newName: string, workingDir: string) => void;
};

const HISTORY_STATS_POLL_MS = 10_000;
const MAX_INLINE_TERMINAL_SELECTION_CHARS = 10_000;
const ASK_FLOWER_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

const TERMINAL_SELECTION_BACKGROUND = 'rgba(255, 234, 0, 0.72)';
const TERMINAL_SELECTION_FOREGROUND = '#000000';
const TERMINAL_INPUT_SELECTOR = 'textarea[aria-label="Terminal input"], textarea';
const MOBILE_TERMINAL_TOUCH_SCROLL_LINE_HEIGHT_FALLBACK_PX = 20;
const MOBILE_TERMINAL_TOUCH_SCROLL_MIN_LINE_HEIGHT_PX = 12;
type TerminalSessionTabVisualStateMap = Record<string, TerminalTabVisualState>;
type TerminalSessionWorkStateMap = Record<string, TerminalSessionWorkState>;

type pending_terminal_session = {
  id: string;
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

type terminal_session_sidebar_item = Readonly<{
  id: string;
  label: string;
  title: string;
  avatarInitial: string;
  avatarTone: terminal_session_avatar_tone;
  fullPath: string;
  status: terminal_session_sidebar_status;
  canBrowsePath: boolean;
  canClear: boolean;
  canDuplicate: boolean;
  closable: boolean;
}>;

type terminal_session_sidebar_status = 'none' | 'running' | 'unread' | 'creating' | 'failed';

type terminal_session_avatar_tone = Readonly<{
  background: string;
  border: string;
  foreground: string;
}>;

type terminal_sidebar_context_menu = Readonly<{
  x: number;
  y: number;
  item: terminal_session_sidebar_item;
}> | null;

type terminal_panel_created_session = {
  sessionId: string;
  session: TerminalSessionInfo | null;
};

type terminal_touch_scroll_target = {
  scrollLines?: (amount: number) => void;
  getScrollbackLength?: () => number;
  isAlternateScreen?: () => boolean;
  input?: (data: string, wasUserInput?: boolean) => void;
};

function waitForTerminalUiPaint(): Promise<void> {
  return new Promise((resolve) => deferAfterPaint(resolve));
}

type terminal_history_chunk = {
  sequence: number;
  data: Uint8Array;
};

type terminal_display_chunk = {
  sequence?: number;
  data: Uint8Array;
};

type terminal_session_actions = {
  reload: () => Promise<void>;
  resetAfterClear: () => void;
};

type terminal_selection_snapshot = {
  sessionId: string;
  selectionText: string;
  hasSelection: boolean;
};

function resolveTerminalTouchScrollTarget(core: TerminalCore | null): terminal_touch_scroll_target | null {
  if (!core) return null;
  const inner = (core as unknown as { terminal?: terminal_touch_scroll_target | null }).terminal;
  return inner ?? null;
}

function readTerminalSelectionText(core: TerminalCore | null): string {
  try {
    return String(core?.getSelectionText?.() ?? '');
  } catch {
    return '';
  }
}

function buildTerminalSelectionSnapshot(sessionId: string, core: TerminalCore | null): terminal_selection_snapshot {
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
    background: 'color-mix(in srgb, var(--primary) 22%, var(--sidebar) 78%)',
    border: 'color-mix(in srgb, var(--primary) 42%, var(--sidebar-border) 58%)',
    foreground: 'color-mix(in srgb, var(--primary) 72%, var(--sidebar-foreground) 28%)',
  },
  {
    background: 'color-mix(in srgb, #0891b2 24%, var(--sidebar) 76%)',
    border: 'color-mix(in srgb, #0891b2 48%, var(--sidebar-border) 52%)',
    foreground: 'color-mix(in srgb, #67e8f9 58%, var(--sidebar-foreground) 42%)',
  },
  {
    background: 'color-mix(in srgb, #d97706 24%, var(--sidebar) 76%)',
    border: 'color-mix(in srgb, #d97706 46%, var(--sidebar-border) 54%)',
    foreground: 'color-mix(in srgb, #fbbf24 62%, var(--sidebar-foreground) 38%)',
  },
  {
    background: 'color-mix(in srgb, #db2777 23%, var(--sidebar) 77%)',
    border: 'color-mix(in srgb, #db2777 46%, var(--sidebar-border) 54%)',
    foreground: 'color-mix(in srgb, #f9a8d4 62%, var(--sidebar-foreground) 38%)',
  },
  {
    background: 'color-mix(in srgb, #16a34a 23%, var(--sidebar) 77%)',
    border: 'color-mix(in srgb, #16a34a 44%, var(--sidebar-border) 56%)',
    foreground: 'color-mix(in srgb, #86efac 60%, var(--sidebar-foreground) 40%)',
  },
  {
    background: 'color-mix(in srgb, #7c3aed 24%, var(--sidebar) 76%)',
    border: 'color-mix(in srgb, #7c3aed 46%, var(--sidebar-border) 54%)',
    foreground: 'color-mix(in srgb, #c4b5fd 62%, var(--sidebar-foreground) 38%)',
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

function resolveTerminalSidebarStatus(
  workState: TerminalSessionWorkState | undefined,
  visualState: TerminalTabVisualState | undefined,
): terminal_session_sidebar_status {
  if (workState && workState !== 'idle') {
    return 'running';
  }
  return visualState === 'unread' ? 'unread' : 'none';
}

function buildTerminalPanelTitle(session: TerminalSessionInfo | null, terminalLabel: string): string {
  const titlePrefix = terminalLabel.trim() || 'Terminal';
  const sessionName = String(session?.name ?? '').trim();
  if (sessionName) {
    return `${titlePrefix} · ${sessionName}`;
  }

  const workingDir = normalizeAskFlowerAbsolutePath(String(session?.workingDir ?? '').trim());
  if (workingDir && workingDir !== '/') {
    const parts = workingDir.split('/').filter(Boolean);
    const basename = parts[parts.length - 1] ?? '';
    if (basename) {
      return `${titlePrefix} · ${basename}`;
    }
  }

  return titlePrefix;
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
  };
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
    && a.isActive === b.isActive,
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

function resolvePendingTerminalSessions(
  pendingSessions: readonly pending_terminal_session[],
  visibleSessions: readonly TerminalSessionInfo[],
): resolved_pending_terminal_session[] {
  const claimedSessionIds = new Set<string>();
  const resolved: resolved_pending_terminal_session[] = [];

  for (const pendingSession of pendingSessions) {
    const session = visibleSessions.find((candidate) => (
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

const TerminalSidebarStatusBadge = (props: { status: terminal_session_sidebar_status }) => (
  <>
    <Show when={props.status === 'running'}>
      <span
        class="absolute -bottom-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-sidebar bg-sidebar text-sidebar-foreground shadow-sm"
        data-terminal-tab-status="running"
        aria-hidden="true"
      >
        <svg
          class="h-2.5 w-2.5 animate-spin motion-reduce:animate-none"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle cx="12" cy="12" r="8" class="opacity-20" stroke="currentColor" stroke-width="3" />
          <path d="M20 12a8 8 0 0 0-8-8" class="opacity-100" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        </svg>
      </span>
    </Show>
    <Show when={props.status === 'unread'}>
      <span
        class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-sidebar bg-primary/75 shadow-sm"
        data-terminal-tab-status="unread"
        aria-hidden="true"
      />
    </Show>
    <Show when={props.status === 'creating'}>
      <span
        class="absolute -bottom-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-sidebar bg-sidebar text-muted-foreground shadow-sm"
        data-terminal-tab-status="creating"
        aria-hidden="true"
      >
        <svg
          class="h-2.5 w-2.5 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle cx="12" cy="12" r="8" class="opacity-20" stroke="currentColor" stroke-width="3" />
          <path d="M20 12a8 8 0 0 0-8-8" class="opacity-100" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        </svg>
      </span>
    </Show>
    <Show when={props.status === 'failed'}>
      <span
        class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-sidebar bg-error shadow-sm"
        data-terminal-tab-status="failed"
        aria-hidden="true"
      />
    </Show>
    <Show when={props.status === 'none'}>
      <span class="hidden" data-terminal-tab-status="none" aria-hidden="true" />
    </Show>
  </>
);

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

const PlusIcon = (props: { class?: string }) => (
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
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

const RefreshIcon = (props: { class?: string }) => (
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
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </svg>
);

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

function TerminalSessionView(props: terminal_session_view_props) {
  const i18n = useI18n();
  const stableSessionId = props.session.id;
  const sessionId = () => stableSessionId;
  const colors = () => props.themeColors();
  const fontSize = () => props.fontSize();
  const fontFamily = () => props.fontFamily();
  const [loading, setLoading] = createSignal<session_loading_state>('initializing');
  const [error, setError] = createSignal<string | null>(null);
  const [readyOnce, setReadyOnce] = createSignal(false);
  const [historyReplayProgress, setHistoryReplayProgress] = createSignal<{ loadedBytes: number; totalBytes: number } | null>(null);

  const [showLoading, setShowLoading] = createSignal(false);
  let loadingDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const loadingMessage = createMemo(() => {
    if (loading() === 'initializing') return i18n.t('terminal.initializing');
    if (loading() === 'attaching') return i18n.t('terminal.attaching');
    if (loading() === 'loading_history') {
      const progress = historyReplayProgress();
      if (progress && progress.totalBytes > 0) {
        return i18n.t('terminal.loadingHistoryProgress', {
          loaded: formatBytes(Math.min(progress.loadedBytes, progress.totalBytes)),
          total: formatBytes(progress.totalBytes),
        });
      }
      return i18n.t('terminal.loadingHistory');
    }
    return undefined;
  });

  createEffect(() => {
    const isLoading = loading() !== 'idle';
    if (loadingDebounceTimer) {
      clearTimeout(loadingDebounceTimer);
      loadingDebounceTimer = null;
    }
    if (isLoading) {
      loadingDebounceTimer = setTimeout(() => {
        setShowLoading(true);
      }, 150);
    } else {
      setShowLoading(false);
    }
  });

  onCleanup(() => {
    if (loadingDebounceTimer) {
      clearTimeout(loadingDebounceTimer);
    }
  });

  let container: HTMLDivElement | null = null;
  let term: TerminalCore | null = null;
  let unsubData: (() => void) | null = null;
  let unsubNameUpdate: (() => void) | null = null;
  let appearanceRaf: number | null = null;
  let activationRaf: number | null = null;

  const buildTerminalAppearance = (): TerminalAppearance => ({
    theme: colors(),
    fontSize: fontSize(),
    fontFamily: fontFamily(),
  });

  const applyTerminalAppearance = (
    core: TerminalCore,
    appearance: TerminalAppearance = buildTerminalAppearance(),
    opts?: { forceResize?: boolean; focus?: boolean },
  ) => {
    core.setAppearance(appearance);
    if (opts?.forceResize) {
      core.forceResize();
    }
    if (opts?.focus && props.viewActive() && props.active() && props.autoFocus()) {
      core.focus();
    }
  };

  const cancelPendingAppearanceApply = () => {
    if (appearanceRaf !== null) {
      cancelAnimationFrame(appearanceRaf);
      appearanceRaf = null;
    }
  };

  const cancelPendingActivationRefresh = () => {
    if (activationRaf !== null) {
      cancelAnimationFrame(activationRaf);
      activationRaf = null;
    }
  };

  const scheduleTerminalAppearanceApply = (appearance: TerminalAppearance) => {
    cancelPendingAppearanceApply();
    appearanceRaf = requestAnimationFrame(() => {
      appearanceRaf = null;
      const core = term;
      if (!core) return;
      applyTerminalAppearance(core, appearance);
    });
  };

  const scheduleTerminalActivationRefresh = () => {
    cancelPendingActivationRefresh();
    activationRaf = requestAnimationFrame(() => {
      activationRaf = null;
      const core = term;
      if (!core) return;
      applyTerminalAppearance(core, buildTerminalAppearance(), {
        forceResize: true,
        focus: true,
      });
    });
  };

  let historyMaxSeq = 0;
  let replaying = false;
  let bufferedLive: Array<{ sequence?: number; data: Uint8Array }> = [];
  const shellIntegrationParser = new TerminalShellIntegrationParser();

  let queued: terminal_display_chunk[] = [];
  let flushScheduled = false;
  let flushRaf: number | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAtMs = 0;
  let deferredLive: terminal_display_chunk[] = [];
  let deferredLiveBytes = 0;
  let firstDeferredSeq: number | null = null;
  let needsHistoryCatchup = false;
  let catchupInProgress = false;
  let catchupRunSeq = 0;
  let lastObservedSeq = 0;
  let lastRenderedSeq = 0;
  let focusAfterCatchup = false;
  const appliedSequences = new Set<number>();
  const observedUnrenderedSequences = new Set<number>();

  const liveRenderActive = () => props.viewActive() && props.active();

  const normalizeLiveSequence = (sequence: number | undefined): number | undefined => (
    typeof sequence === 'number' && Number.isFinite(sequence) && sequence > 0
      ? Math.floor(sequence)
      : undefined
  );

  const markSequenceApplied = (sequence: number | undefined) => {
    const seq = normalizeLiveSequence(sequence);
    if (!seq || seq <= lastRenderedSeq) return;
    appliedSequences.add(seq);
    while (appliedSequences.has(lastRenderedSeq + 1)) {
      const nextSeq = lastRenderedSeq + 1;
      appliedSequences.delete(nextSeq);
      observedUnrenderedSequences.delete(nextSeq);
      lastRenderedSeq = nextSeq;
    }
  };

  const markChunksApplied = (chunks: readonly terminal_display_chunk[] | readonly terminal_history_chunk[]) => {
    for (const chunk of chunks) {
      markSequenceApplied(chunk.sequence);
    }
  };

  const clearDeferredLive = () => {
    deferredLive = [];
    deferredLiveBytes = 0;
    firstDeferredSeq = null;
  };

  const resetVisualCatchupState = (opts?: { resetParser?: boolean }) => {
    queued = [];
    clearDeferredLive();
    needsHistoryCatchup = false;
    catchupInProgress = false;
    catchupRunSeq += 1;
    focusAfterCatchup = false;
    lastFlushAtMs = 0;
    lastObservedSeq = 0;
    lastRenderedSeq = 0;
    historyMaxSeq = 0;
    appliedSequences.clear();
    observedUnrenderedSequences.clear();
    if (opts?.resetParser) {
      shellIntegrationParser.reset();
    }
  };

  const markHistoryCatchupNeeded = () => {
    needsHistoryCatchup = true;
    clearDeferredLive();
  };

  const enqueueDeferredLive = (chunk: terminal_display_chunk) => {
    if (needsHistoryCatchup) return;
    const nextBytes = deferredLiveBytes + chunk.data.byteLength;
    if (
      deferredLive.length >= TERMINAL_DEFERRED_LIVE_MAX_CHUNKS
      || nextBytes > TERMINAL_DEFERRED_LIVE_MAX_BYTES
    ) {
      markHistoryCatchupNeeded();
      return;
    }
    if (firstDeferredSeq === null && typeof chunk.sequence === 'number') {
      firstDeferredSeq = chunk.sequence;
    }
    deferredLive.push(chunk);
    deferredLiveBytes = nextBytes;
  };

  const deferQueuedLive = () => {
    if (queued.length === 0) return;
    const pending = queued;
    queued = [];
    for (const chunk of pending) {
      enqueueDeferredLive(chunk);
      if (needsHistoryCatchup) break;
    }
  };

  const cancelPendingLiveFlush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (flushRaf !== null) {
      cancelAnimationFrame(flushRaf);
      flushRaf = null;
    }
    flushScheduled = false;
  };

  const requestFlushFrame = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    flushRaf = requestAnimationFrame(() => {
      flushRaf = null;
      flushScheduled = false;
      if (!liveRenderActive()) {
        deferQueuedLive();
        return;
      }
      lastFlushAtMs = terminalNowMs();
      const batch = takeTerminalChunkBatch(
        queued,
        TERMINAL_LIVE_FLUSH_MAX_CHUNKS,
        TERMINAL_LIVE_FLUSH_MAX_BYTES,
      );
      const merged = mergeTerminalChunks(batch.map((chunk) => chunk.data));
      if (merged) {
        term?.write(merged);
        markChunksApplied(batch);
      }
      if (queued.length > 0) {
        scheduleFlush();
        return;
      }
      if (focusAfterCatchup) {
        focusAfterCatchup = false;
        scheduleTerminalActivationRefresh();
      }
    });
  };

  const scheduleFlush = () => {
    if (flushScheduled || flushTimer) return;
    if (!liveRenderActive()) {
      deferQueuedLive();
      return;
    }

    const elapsedMs = lastFlushAtMs > 0 ? terminalNowMs() - lastFlushAtMs : TERMINAL_LIVE_FLUSH_INTERVAL_MS;
    const delayMs = Math.max(0, TERMINAL_LIVE_FLUSH_INTERVAL_MS - elapsedMs);
    if (delayMs <= 0) {
      requestFlushFrame();
      return;
    }

    flushTimer = setTimeout(() => {
      flushTimer = null;
      requestFlushFrame();
    }, delayMs);
  };

  const clearOutputSubscription = () => {
    unsubData?.();
    unsubData = null;
    unsubNameUpdate?.();
    unsubNameUpdate = null;
  };

  const writeHistoryChunks = async (
    chunks: terminal_history_chunk[],
    seq: number,
    opts?: { publishActivityForObservedLive?: boolean },
  ) => {
    const core = term;
    if (!core) return;

    if (chunks.length === 0) return;

    await new Promise<void>((resolve) => {
      const step = () => {
        if (seq !== initSeq) {
          resolve();
          return;
        }

        const batch = takeTerminalHistoryChunkBatch(
          chunks,
          TERMINAL_HISTORY_REPLAY_MAX_CHUNKS,
          TERMINAL_HISTORY_REPLAY_MAX_BYTES,
        );
        const displayChunks = batch
          .map((chunk) => consumeTerminalChunk(chunk.data, 'history', {
            publishActivity: opts?.publishActivityForObservedLive !== false
              || !observedUnrenderedSequences.has(chunk.sequence),
          }))
          .filter((chunk) => chunk.byteLength > 0);
        const merged = mergeTerminalChunks(displayChunks);
        if (merged) {
          core.write(merged);
        }
        markChunksApplied(batch);
        if (chunks.length > 0) {
          requestAnimationFrame(step);
          return;
        }
        resolve();
      };
      requestAnimationFrame(step);
    });
  };

  const consumeTerminalChunk = (
    data: Uint8Array,
    source: 'history' | 'live',
    opts?: { publishActivity?: boolean },
  ): Uint8Array => {
    const result = shellIntegrationParser.parse(data);
    if (opts?.publishActivity !== false) {
      for (const event of result.events) {
        props.onShellIntegrationEvent?.(sessionId(), event, source);
      }
      if (result.displayData.byteLength > 0) {
        props.onVisibleOutput?.(sessionId(), source, result.displayData.byteLength);
      }
    }
    return result.displayData;
  };

  const replayHistoryPages = async (id: string, seq: number) => {
    const core = term;
    if (!core) return;

    core.clear();
    setHistoryReplayProgress(null);
    core.startHistoryReplay(TERMINAL_HISTORY_REPLAY_MODE_MS);

    let cursor = 0;
    let coveredBytes = 0;
    let totalBytes = 0;

    try {
      for (let pageIndex = 0; pageIndex < TERMINAL_HISTORY_REPLAY_MAX_PAGES; pageIndex += 1) {
        const page = await props.transport.historyPage(id, cursor, -1);
        if (seq !== initSeq) return;

        totalBytes = page.totalBytes > 0 ? page.totalBytes : totalBytes;
        coveredBytes += Math.max(0, page.coveredBytes);
        if (totalBytes > 0) {
          setHistoryReplayProgress({
            loadedBytes: Math.min(coveredBytes, totalBytes),
            totalBytes,
          });
        }

        if (page.lastSequence > historyMaxSeq) {
          historyMaxSeq = page.lastSequence;
        }

        const sorted = [...page.chunks].sort((a, b) => a.sequence - b.sequence);
        await writeHistoryChunks(sorted, seq);
        if (seq !== initSeq) return;

        if (!page.hasMore) return;
        if (page.nextStartSeq <= cursor) {
          throw new Error('terminal history pagination did not advance');
        }
        cursor = page.nextStartSeq;
      }

      throw new Error('terminal history pagination did not converge');
    } finally {
      core.endHistoryReplay();
      setHistoryReplayProgress(null);
    }
  };

  const replayHistoryCatchupPages = async (id: string, startSeq: number, seq: number) => {
    const core = term;
    if (!core) return;

    core.startHistoryReplay(TERMINAL_HISTORY_REPLAY_MODE_MS);

    let cursor = Math.max(0, startSeq);
    let resetForCoveredGap = false;

    try {
      for (let pageIndex = 0; pageIndex < TERMINAL_HISTORY_REPLAY_MAX_PAGES; pageIndex += 1) {
        const page = await props.transport.historyPage(id, cursor, -1);
        if (seq !== catchupRunSeq || !catchupInProgress) return;

        if (page.lastSequence > historyMaxSeq) {
          historyMaxSeq = page.lastSequence;
        }

        const sorted = [...page.chunks].sort((a, b) => a.sequence - b.sequence);
        if (
          !resetForCoveredGap
          && cursor > 0
          && page.firstSequence > cursor
          && sorted.length > 0
        ) {
          core.clear();
          shellIntegrationParser.reset();
          appliedSequences.clear();
          lastRenderedSeq = Math.max(0, page.firstSequence - 1);
          resetForCoveredGap = true;
        }

        await writeHistoryChunks(sorted, initSeq, { publishActivityForObservedLive: false });
        if (seq !== catchupRunSeq || !catchupInProgress) return;

        if (!page.hasMore) return;
        if (page.nextStartSeq <= cursor) {
          throw new Error('terminal history pagination did not advance');
        }
        cursor = page.nextStartSeq;
      }

      throw new Error('terminal history pagination did not converge');
    } finally {
      core.endHistoryReplay();
    }
  };

  const flushDeferredOrCatchup = () => {
    if (!liveRenderActive()) return;
    if (!term) return;
    if (loading() !== 'idle') return;
    if (catchupInProgress) return;

    if (needsHistoryCatchup) {
      const id = sessionId();
      const startSeq = firstDeferredSeq ?? (lastRenderedSeq > 0 ? lastRenderedSeq + 1 : 0);
      const seq = ++catchupRunSeq;
      catchupInProgress = true;
      needsHistoryCatchup = false;
      focusAfterCatchup = true;
      clearDeferredLive();
      queued = [];
      cancelPendingLiveFlush();
      void replayHistoryCatchupPages(id, startSeq, seq)
        .catch((e) => {
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (seq !== catchupRunSeq) return;
          catchupInProgress = false;
          if (liveRenderActive()) {
            scheduleTerminalActivationRefresh();
          }
          if (deferredLive.length > 0 || needsHistoryCatchup) {
            flushDeferredOrCatchup();
          }
        });
      return;
    }

    if (deferredLive.length > 0) {
      queued.push(...deferredLive);
      clearDeferredLive();
      focusAfterCatchup = true;
      scheduleFlush();
    }
  };

  const handleLiveTerminalData = (data: Uint8Array, sequence: number | undefined) => {
    const seq = normalizeLiveSequence(sequence);
    if (seq) {
      if (seq <= lastRenderedSeq || appliedSequences.has(seq) || observedUnrenderedSequences.has(seq)) {
        return;
      }
      const expectedNextSeq = Math.max(lastObservedSeq, lastRenderedSeq) + 1;
      if (seq > expectedNextSeq) {
        markHistoryCatchupNeeded();
      }
      lastObservedSeq = Math.max(lastObservedSeq, seq);
      observedUnrenderedSequences.add(seq);
    }

    const displayData = consumeTerminalChunk(data, 'live');
    if (displayData.byteLength === 0) {
      markSequenceApplied(seq);
      return;
    }

    const displayChunk: terminal_display_chunk = { sequence: seq, data: displayData };
    if (!liveRenderActive()) {
      enqueueDeferredLive(displayChunk);
      return;
    }

    if (needsHistoryCatchup) {
      flushDeferredOrCatchup();
      return;
    }

    queued.push(displayChunk);
    scheduleFlush();
  };

  let reloadSeq = 0;
  const disposeTerminal = () => {
    clearOutputSubscription();
    cancelPendingAppearanceApply();
    cancelPendingActivationRefresh();
    term?.dispose();
    term = null;
    queued = [];
    flushScheduled = false;
    cancelPendingLiveFlush();
    lastFlushAtMs = 0;
    bufferedLive = [];
    replaying = false;
    resetVisualCatchupState({ resetParser: true });
    shellIntegrationParser.reset();
    setReadyOnce(false);
    props.registerCore(sessionId(), null);
  };

  let initSeq = 0;
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const nextAnimationFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const confirmAttachedViewportSize = async (core: TerminalCore, id: string, seq: number) => {
    await nextAnimationFrame();
    if (seq !== initSeq) return;

    core.forceResize();

    await nextAnimationFrame();
    if (seq !== initSeq) return;

    const dims = core.getDimensions();
    if (dims.cols <= 0 || dims.rows <= 0) return;
    await props.transport.resize(id, dims.cols, dims.rows);
  };

  const reload = async (opts?: { fadeOut?: boolean }) => {
    const id = sessionId();
    if (!id) return;
    if (!props.connected()) return;
    if (!container) return;

    const seq = ++reloadSeq;

    // Keep the surface hidden until the new terminal is attached and history is replayed (same as page open).
    setError(null);
    setLoading('initializing');

    if (opts?.fadeOut) {
      container.style.opacity = '0';
      await sleep(150);
      if (seq !== reloadSeq) return;
    }

    // Cancel any in-flight init and dispose the previous core before rebuilding.
    initSeq += 1;
    disposeTerminal();

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (seq !== reloadSeq) return;
    if (!props.connected()) return;
    if (!container) return;

    try {
      await initOnce();
    } catch (e) {
      setLoading('idle');
      setError(e instanceof Error ? e.message : String(e));
      const el = container;
      if (el) el.style.opacity = '1';
    }
  };

  createEffect(() => {
    const id = sessionId();
    if (!id) return;
    props.registerActions(id, {
      reload: () => reload(),
      resetAfterClear: () => {
        cancelPendingLiveFlush();
        resetVisualCatchupState({ resetParser: true });
      },
    });
    onCleanup(() => {
      props.registerActions(id, null);
    });
  });

  const initOnce = async () => {
    const id = sessionId();
    const target = container;
    if (!target) throw new Error('Terminal not mounted');

    const seq = ++initSeq;
    setError(null);
    setLoading('initializing');

    const core = new TerminalCore(
      target,
      getDefaultTerminalConfig('dark', {
        cursorBlink: false,
        rendererType: 'webgl',
        fontSize: fontSize(),
        // Workbench zoom is an outer visual transform; terminal geometry stays stable.
        presentationScale: 1,
        fit: props.variant === 'workbench' ? { scrollbarReservePx: 0 } : undefined,
        allowTransparency: false,
        theme: colors(),
        fontFamily: fontFamily(),
        clipboard: {
          copyOnSelect: false,
        },
        // When multiple views/panels show the same terminal session, only the focused terminal should emit remote resize.
        // Focus also re-fits and re-emits the current size so the active surface can reclaim remote PTY ownership after
        // another view with a different width was previously attached to the same session/connection.
        responsive: {
          fitOnFocus: true,
          emitResizeOnFocus: true,
          notifyResizeOnlyWhenFocused: true,
        } satisfies TerminalResponsiveConfig,
      }),
      {
        onData: (data: string) => {
          if (!props.viewActive() || !props.active()) return;
          if (catchupInProgress || needsHistoryCatchup || deferredLive.length > 0 || focusAfterCatchup) return;
          void props.transport.sendInput(id, data, props.connId);
        },
        onResize: (size: { cols: number; rows: number }) => {
          if (!props.viewActive() || !props.active()) return;
          void props.transport.resize(id, size.cols, size.rows);
        },
        onError: (e: Error) => {
          setError(e.message);
        },
        onBell: () => {
          props.onBell?.(id);
        },
      },
      buildLogger(),
    );

    core.registerLinkProvider?.(createTerminalFileLinkProvider({
      core,
      isEnabled: () => props.canOpenFilePreview(),
      getContext: () => ({
        workingDirAbs: normalizeAskFlowerAbsolutePath(props.session.workingDir ?? '')
          || normalizeAskFlowerAbsolutePath(props.agentHomePathAbs())
          || '/',
        agentHomePathAbs: normalizeAskFlowerAbsolutePath(props.agentHomePathAbs()) || undefined,
      }),
      onActivate: (target) => props.onTerminalFileLinkOpen?.(target),
    }));

    term = core;
    props.registerCore(id, core);

    try {
      await core.initialize();
      if (seq !== initSeq) return;

      // After core.initialize(), the underlying terminal instance is ready: re-register to keep the outer registry consistent.
      props.registerCore(id, core);

      applyTerminalAppearance(core, buildTerminalAppearance(), { forceResize: true });

      clearOutputSubscription();
      historyMaxSeq = 0;
      replaying = true;
      bufferedLive = [];
      unsubData = props.eventSource.onTerminalData(id, (ev) => {
        if (replaying) {
          bufferedLive.push({ sequence: ev.sequence, data: ev.data });
          return;
        }
        if (typeof ev.sequence === 'number' && ev.sequence > 0 && ev.sequence <= historyMaxSeq) return;
        handleLiveTerminalData(ev.data, ev.sequence);
      });

      if (props.eventSource.onTerminalNameUpdate) {
        unsubNameUpdate = props.eventSource.onTerminalNameUpdate(id, (ev) => {
          props.onNameUpdate?.(ev.sessionId, ev.newName, ev.workingDir);
        });
      }

      setLoading('attaching');
      const dims = core.getDimensions();
      await props.transport.attach(id, dims.cols, dims.rows);
      if (seq !== initSeq) return;

      setLoading('loading_history');
      await replayHistoryPages(id, seq);
      if (seq !== initSeq) return;

      replaying = false;
      const liveSorted = [...bufferedLive]
        .filter((c) => typeof c.sequence !== 'number' || c.sequence <= 0 || c.sequence > historyMaxSeq)
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      bufferedLive = [];
      for (const c of liveSorted) {
        handleLiveTerminalData(c.data, c.sequence);
      }
      if (queued.length > 0) scheduleFlush();
      flushDeferredOrCatchup();

      await confirmAttachedViewportSize(core, id, seq);
      if (seq !== initSeq) return;

      setLoading('idle');
      setReadyOnce(true);

      requestAnimationFrame(() => {
        core.forceResize();
        if (props.viewActive() && props.active() && props.autoFocus()) core.focus();
        const el = container;
        if (el && el.style.opacity !== '1') {
          el.style.opacity = '1';
        }
      });
    } catch (e) {
      if (seq !== initSeq) return;
      replaying = false;
      bufferedLive = [];
      queued = [];
      clearDeferredLive();
      cancelPendingLiveFlush();
      setLoading('idle');
      setError(e instanceof Error ? e.message : String(e));
      const el = container;
      if (el) el.style.opacity = '1';
    }
  };

  createEffect(() => {
    if (!liveRenderActive()) return;
    flushDeferredOrCatchup();
  });

  createEffect(() => {
    const client = props.protocolClient();
    if (!client) return;
    if (!container) return;

    // Untrack to avoid capturing theme/font reactivity as init dependencies.
    untrack(() => void reload());
  });

  createEffect(() => {
    const appearance = buildTerminalAppearance();
    if (!term) return;
    scheduleTerminalAppearanceApply(appearance);
  });

  createEffect(() => {
    if (!props.viewActive() || !props.active()) return;
    if (!term) return;
    if (catchupInProgress || needsHistoryCatchup || deferredLive.length > 0 || focusAfterCatchup) return;
    scheduleTerminalActivationRefresh();
  });

  onCleanup(() => {
    initSeq += 1;
    reloadSeq += 1;
    disposeTerminal();
    props.registerCore(sessionId(), null);
    props.registerSurfaceElement(sessionId(), null);
  });

  const terminalBackground = () => colors().background ?? '#1e1e1e';
  const terminalForeground = () => colors().foreground ?? '#c9d1d9';
  const terminalLoadingVars = () => ({
    '--redeven-terminal-loading-background': terminalBackground(),
    '--redeven-terminal-loading-foreground': terminalForeground(),
  });

  return (
    <div
      class="h-full min-h-0 relative overflow-hidden"
      style={{
        'background-color': terminalBackground(),
        '--terminal-bottom-inset': `${props.bottomInsetPx()}px`,
        '--background': terminalBackground(),
        '--foreground': terminalForeground(),
        '--primary': terminalForeground(),
        '--muted': `color-mix(in srgb, ${terminalForeground()} 12%, ${terminalBackground()})`,
        '--muted-foreground': `color-mix(in srgb, ${terminalForeground()} 70%, transparent)`,
        ...terminalLoadingVars(),
      }}
    >
      <div
        ref={(n) => {
          container = n;
          props.registerSurfaceElement(sessionId(), n);
        }}
        {...REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS}
        class="absolute top-2 left-2 right-0 bottom-0 redeven-terminal-surface"
        onClick={(event) => props.onSurfaceClick?.(event)}
        style={{
          transition: 'opacity 0.15s ease-out',
          bottom: 'var(--terminal-bottom-inset)',
          opacity: readyOnce() ? (showLoading() ? '0' : '1') : (loading() === 'idle' ? '1' : '0'),
        }}
      />

      <RedevenLoadingCurtain
        visible={showLoading()}
        eyebrow={i18n.t('terminal.creatingEyebrow')}
        message={loadingMessage()}
        class="redeven-terminal-loading-curtain"
      />

      <Show when={error()}>
        <div
          class="absolute left-3 right-3 bottom-3 text-[11px] px-2 py-1 rounded border border-border text-error break-words"
          style={{
            'background-color': `color-mix(in srgb, ${terminalBackground()} 80%, transparent)`,
            bottom: 'calc(var(--terminal-bottom-inset) + 0.75rem)',
          }}
        >
          {error()}
        </div>
      </Show>
    </div>
  );
}

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
  const connId = getOrCreateTerminalConnId();
  const panelId = (() => {
    const wid = String(widgetId ?? '').trim();
    return wid ? `embedded:${wid}` : 'terminal_page';
  })();
  const activeSessionStorageKey = buildActiveSessionStorageKey(panelId);
  const sessionGroupState = createMemo<TerminalPanelSessionGroupState | null>(() => props.sessionGroupState ?? null);

  const [searchOpen, setSearchOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchResultCount, setSearchResultCount] = createSignal(0);
  const [searchResultIndex, setSearchResultIndex] = createSignal(-1);
  const [panelHasFocus, setPanelHasFocus] = createSignal(false);
  const [agentHomePathAbs, setAgentHomePathAbs] = createSignal('');
  const [terminalAskMenu, setTerminalAskMenu] = createSignal<{
    x: number;
    y: number;
    workingDir: string;
    homePath?: string;
    selection: terminal_selection_snapshot;
    showBrowseFiles: boolean;
  } | null>(null);
  let terminalAskMenuEl: HTMLDivElement | null = null;
  const [terminalSidebarMenu, setTerminalSidebarMenu] = createSignal<terminal_sidebar_context_menu>(null);
  let terminalSidebarMenuEl: HTMLDivElement | null = null;
  const [copiedSidebarPathSessionId, setCopiedSidebarPathSessionId] = createSignal<string | null>(null);
  let sidebarPathCopyResetTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let sidebarVisualActiveResetTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const [terminalContextMenuHostEl, setTerminalContextMenuHostEl] = createSignal<HTMLDivElement | null>(null);

  let searchLastAppliedKey = '';
  let searchBoundCore: TerminalCore | null = null;

  ensureTerminalPreferencesInitialized(floe.persist);
  const terminalPrefs = useTerminalPreferences();

  const transport = createRedevenTerminalTransport(rpc, connId);
  const eventSource = createRedevenTerminalEventSource(rpc);
  const sessionsCoordinator = getRedevenTerminalSessionsCoordinator({ connId, transport, logger: buildLogger() });
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    if (sidebarPathCopyResetTimer !== undefined) {
      globalThis.clearTimeout(sidebarPathCopyResetTimer);
      sidebarPathCopyResetTimer = undefined;
    }
    if (sidebarVisualActiveResetTimer !== undefined) {
      globalThis.clearTimeout(sidebarVisualActiveResetTimer);
      sidebarVisualActiveResetTimer = undefined;
    }
  });

  const connected = () => Boolean(protocol.client());
  const viewActive = () => view.active();
  const workbenchSelected = () => variant !== 'workbench' || props.workbenchSelected !== false;
  const terminalFocusOwner = () => viewActive() && workbenchSelected();
  const isEmbeddedWidget = Boolean(String(widgetId ?? '').trim());
  const permissionReady = () => env.env.state === 'ready';
  const canBrowseFiles = createMemo(() => connected() && permissionReady() && Boolean(env.env()?.permissions?.can_read));

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

    host.addEventListener('contextmenu', onContextMenuCapture, true);
    onCleanup(() => {
      host.removeEventListener('contextmenu', onContextMenuCapture, true);
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
    const selected = userTheme();
    if (selected === 'system') {
      return theme.resolvedTheme() === 'light' ? 'light' : 'dark';
    }
    return selected as TerminalThemeName;
  });

  const terminalWorkIndicatorTheme = createMemo(() => {
    return theme.resolvedTheme() === 'light' ? 'light' : 'dark';
  });

  const terminalThemeColors = createMemo<Record<string, string>>(() => {
    // Unify and slightly brighten selection colors to keep readability consistent across themes.
    return {
      ...getThemeColors(terminalThemeName()),
      selectionBackground: TERMINAL_SELECTION_BACKGROUND,
      selectionForeground: TERMINAL_SELECTION_FOREGROUND,
      selection: TERMINAL_SELECTION_BACKGROUND,
    } as Record<string, string>;
  });
  const terminalThemeBackground = createMemo(() => terminalThemeColors().background ?? '#1e1e1e');
  const terminalThemeForeground = createMemo(() => terminalThemeColors().foreground ?? '#c9d1d9');
  const terminalThemeMutedForeground = createMemo(() => (
    `color-mix(in srgb, ${terminalThemeForeground()} 70%, transparent)`
  ));
  const terminalLoadingVars = createMemo(() => ({
    '--redeven-terminal-loading-background': terminalThemeBackground(),
    '--redeven-terminal-loading-foreground': terminalThemeForeground(),
  }));

  const [allSessions, setAllSessions] = createSignal<TerminalSessionInfo[]>([]);
  const [optimisticTerminalSessions, setOptimisticTerminalSessions] = createSignal<TerminalSessionInfo[]>([]);
  const [optimisticClosingSessionIds, setOptimisticClosingSessionIds] = createSignal<Set<string>>(new Set());
  const [pendingTerminalSessions, setPendingTerminalSessions] = createSignal<pending_terminal_session[]>([]);
  const [sessionsHydrated, setSessionsHydrated] = createSignal(false);
  const [sessionsLoading, setSessionsLoading] = createSignal(false);
  const [localActiveSessionId, setLocalActiveSessionId] = createSignal<string | null>(readActiveSessionId(activeSessionStorageKey));
  const [localActivePendingSessionId, setLocalActivePendingSessionId] = createSignal<string | null>(null);
  const [optimisticActiveDisplaySessionId, setOptimisticActiveDisplaySessionId] = createSignal<string | null>(null);
  const [sidebarVisualActiveSessionId, setSidebarVisualActiveSessionId] = createSignal<string | null>(null);
  const [mountedSessionIds, setMountedSessionIds] = createSignal<Set<string>>(new Set());
  const [scheduledMountSessionIds, setScheduledMountSessionIds] = createSignal<Set<string>>(new Set());
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

  const handleExecuteDenied = (e: unknown): boolean => {
    if (!isPermissionDeniedError(e, 'execute')) return false;
    props.onExecuteDenied?.();
    return true;
  };

  const [historyBytes, setHistoryBytes] = createSignal<number | null>(null);

  const coreRegistry = new Map<string, TerminalCore>();
  const surfaceRegistry = new Map<string, HTMLDivElement>();
  const actionsRegistry = new Map<string, terminal_session_actions>();
  const mobileKeyboardPathCache = new Map<string, TerminalMobileKeyboardPathEntry[]>();
  const mobileKeyboardPackageScriptsCache = new Map<string, TerminalMobileKeyboardScript[]>();
  const deferredInitialMountSessionIds = new Set<string>();
  const scheduledMountSelectionEpochs = new Map<string, number>();
  let activeDisplaySelectionEpoch = 0;
  const selectOptimisticActiveDisplaySessionId = (sessionId: string | null) => {
    const normalizedSessionId = String(sessionId ?? '').trim() || null;
    if (activeDisplaySessionId() !== normalizedSessionId) {
      activeDisplaySelectionEpoch += 1;
    }
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

  const pendingTerminalSessionById = (sessionId: string): pending_terminal_session | null => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) return null;
    return pendingTerminalSessions().find((session) => session.id === normalizedSessionId) ?? null;
  };

  const resolvedPendingTerminalSessions = createMemo<resolved_pending_terminal_session[]>(() => (
    resolvePendingTerminalSessions(pendingTerminalSessions(), sessions())
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

  const clearSidebarVisualActiveSession = () => {
    if (sidebarVisualActiveResetTimer !== undefined) {
      globalThis.clearTimeout(sidebarVisualActiveResetTimer);
      sidebarVisualActiveResetTimer = undefined;
    }
    setSidebarVisualActiveSessionId(null);
  };

  const previewSidebarActiveSession = (sessionId: string | null) => {
    const normalizedSessionId = String(sessionId ?? '').trim() || null;
    if (!normalizedSessionId || !sessionDisplayIdExists(normalizedSessionId)) {
      clearSidebarVisualActiveSession();
      return;
    }

    if (sidebarVisualActiveResetTimer !== undefined) {
      globalThis.clearTimeout(sidebarVisualActiveResetTimer);
    }
    setSidebarVisualActiveSessionId(normalizedSessionId);
    sidebarVisualActiveResetTimer = globalThis.setTimeout(() => {
      sidebarVisualActiveResetTimer = undefined;
      setSidebarVisualActiveSessionId((current) => (
        current === normalizedSessionId && activeDisplaySessionId() !== normalizedSessionId
          ? null
          : current
      ));
    }, 1200);
  };

  const sidebarActiveSessionId = createMemo<string | null>(() => {
    const visualActiveId = sidebarVisualActiveSessionId();
    if (visualActiveId && sessionDisplayIdExists(visualActiveId)) {
      return visualActiveId;
    }
    return activeDisplaySessionId();
  });

  createEffect(() => {
    const visualActiveId = sidebarVisualActiveSessionId();
    if (!visualActiveId) return;
    if (activeDisplaySessionId() === visualActiveId || !sessionDisplayIdExists(visualActiveId)) {
      clearSidebarVisualActiveSession();
    }
  });

  const activeSessionId = createMemo<string | null>(() => {
    const activeId = activeDisplaySessionId();
    return activeId && !visiblePendingTerminalSessionById(activeId) ? activeId : null;
  });

  createEffect(() => {
    const activeId = activeSessionId();
    for (const scheduledSessionId of [...scheduledMountSelectionEpochs.keys()]) {
      if (scheduledSessionId !== activeId) {
        scheduledMountSelectionEpochs.delete(scheduledSessionId);
      }
    }
    setScheduledMountSessionIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const scheduledSessionId of prev) {
        if (scheduledSessionId === activeId) {
          next.add(scheduledSessionId);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  });

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
    deferredInitialMountSessionIds.delete(normalizedSessionId);
    setScheduledMountSessionIds((prev) => {
      if (!prev.has(normalizedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(normalizedSessionId);
      return next;
    });
    setMountedSessionIds((prev) => {
      if (prev.has(normalizedSessionId)) return prev;
      const next = new Set(prev);
      next.add(normalizedSessionId);
      return next;
    });
  };

  const deferInitialSessionMount = (sessionId: string) => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) return;
    deferredInitialMountSessionIds.add(normalizedSessionId);
  };

  const scheduleSessionMountAfterPaint = (sessionId: string) => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) return;
    if (mountedSessionIds().has(normalizedSessionId)) return;
    const selectionEpoch = activeDisplaySelectionEpoch;
    scheduledMountSelectionEpochs.set(normalizedSessionId, selectionEpoch);
    if (scheduledMountSessionIds().has(normalizedSessionId)) return;

    setScheduledMountSessionIds((prev) => {
      if (prev.has(normalizedSessionId)) return prev;
      const next = new Set(prev);
      next.add(normalizedSessionId);
      return next;
    });

    void waitForTerminalUiPaint().then(() => {
      const scheduledSelectionEpoch = scheduledMountSelectionEpochs.get(normalizedSessionId);
      scheduledMountSelectionEpochs.delete(normalizedSessionId);
      setScheduledMountSessionIds((prev) => {
        if (!prev.has(normalizedSessionId)) return prev;
        const next = new Set(prev);
        next.delete(normalizedSessionId);
        return next;
      });
      if (disposed) return;
      if (scheduledSelectionEpoch !== activeDisplaySelectionEpoch) return;
      if (activeSessionId() !== normalizedSessionId) return;
      if (!sessions().some((session) => session.id === normalizedSessionId)) return;
      markSessionMounted(normalizedSessionId);
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
    deferInitialSessionMount(resolved.sessionId);
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

    const resolvedPendingIds = new Set(resolvedSessions.map((session) => session.pendingSessionId));
    setPendingTerminalSessions((previous) => {
      const next = previous.filter((session) => !resolvedPendingIds.has(session.id));
      return next.length === previous.length ? previous : next;
    });
  });

  const setActiveSessionId = (value: string | null) => {
    const normalizedValue = String(value ?? '').trim() || null;
    clearSidebarVisualActiveSession();
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

  onCleanup(() => {
    tabActivityTracker.dispose();
  });

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

  const registerActions = (id: string, actions: terminal_session_actions | null) => {
    if (!id) return;
    if (actions) {
      actionsRegistry.set(id, actions);
      return;
    }
    actionsRegistry.delete(id);
  };

  const getActiveTerminalViewportElement = (): HTMLDivElement | null => {
    const sid = activeSessionId();
    if (!sid) return null;
    const surface = surfaceRegistry.get(sid);
    const viewport = surface?.parentElement;
    return viewport instanceof HTMLDivElement ? viewport : null;
  };

  const handleNameUpdate = (sessionId: string, newName: string, workingDir: string) => {
    sessionsCoordinator.updateSessionMeta(sessionId, { name: newName, workingDir });
  };

  const handleThemeChange = (value: string) => {
    terminalPrefs.setUserTheme(value);
  };

  let prevSessionsSnapshot: TerminalSessionInfo[] = [];
  const handleSessionsSnapshot = (next: TerminalSessionInfo[]) => {
    const prev = prevSessionsSnapshot;
    const nextSessionIds = new Set(next.map((session) => String(session.id ?? '').trim()).filter(Boolean));
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
    const unsub = sessionsCoordinator.subscribe(handleSessionsSnapshot);
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
        sessionsCoordinator.updateSessionMeta(sessionId, { workingDir });
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

  const handleVisibleOutput = (sessionId: string, source: 'history' | 'live', byteLength: number) => {
    tabActivityTracker.handleVisibleOutput(sessionId, {
      source,
      byteLength,
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
    props.onTitleChange?.(activeSession()
      ? buildTerminalPanelTitle(activeSession(), terminalLabel)
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

  const showTerminalStatusBar = createMemo(() => {
    return Boolean(activeSession() || activePendingSession()) && !(shouldUseFloeMobileKeyboard() && mobileKeyboardVisible());
  });

  const statusBarSessionLabel = createMemo(() => {
    const sid = activeSessionId();
    if (sid) return sid;

    const pending = activePendingSession();
    if (!pending) return '';
    return pending.status === 'failed' ? i18n.t('terminal.creationFailedStatus') : i18n.t('terminal.creatingStatus');
  });

  const shouldRestoreTerminalFocus = () => {
    return !isMobileLayout() || mobileInputMode() === 'system';
  };

  const shouldAutoFocus = () => {
    return workbenchSelected() && (!isEmbeddedWidget || panelHasFocus()) && shouldRestoreTerminalFocus();
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

  const restoreActiveTerminalFocus = () => {
    if (!shouldRestoreTerminalFocus()) return;
    requestAnimationFrame(() => {
      getActiveCore()?.focus();
    });
  };

  const commitSidebarSessionSelection = (sessionId: string) => {
    setActiveSessionId(sessionId);
    restoreActiveTerminalFocus();
  };

  const previewSidebarSessionSelection = (event: PointerEvent, sessionId: string) => {
    if (event.button !== 0) return;
    previewSidebarActiveSession(sessionId);
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
      await sessionsCoordinator.refresh();
    } catch (e) {
      if (handleExecuteDenied(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSessionsHydrated(true);
      setSessionsLoading(false);
    }
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

  const createPanelSession = async (name: string | undefined, workingDir: string): Promise<string | null> => {
    const normalizedWorkingDir = normalizeAskFlowerAbsolutePath(String(workingDir ?? '').trim()) || agentHomePathAbs() || '';
    if (props.sessionOperations) {
      const result = normalizeTerminalPanelSessionCreateResult(
        await props.sessionOperations.createSession(name, normalizedWorkingDir),
      );
      if (!result) return null;
      if (result.session) {
        mergeOptimisticTerminalSession(result.session);
        void sessionsCoordinator.refresh().catch(() => undefined);
      } else {
        await sessionsCoordinator.refresh();
      }
      return result.sessionId;
    }

    const session = await sessionsCoordinator.createSession(String(name ?? '').trim(), normalizedWorkingDir);
    return String(session?.id ?? '').trim() || null;
  };

  const createPendingSession = (name: string | undefined, workingDir: string): pending_terminal_session => {
    const pendingSession: pending_terminal_session = {
      id: createClientId('pending-terminal'),
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

    if (!pendingTerminalSessionById(normalizedPendingSessionId)) {
      deferInitialSessionMount(normalizedSessionId);
      activateSession(normalizedSessionId);
      return;
    }
    removePendingSession(normalizedPendingSessionId);
    deferInitialSessionMount(normalizedSessionId);
    activateSession(normalizedSessionId);
  };

  const findResolvedSessionForRemovedPendingSession = (pendingSession: pending_terminal_session): string | null => {
    const session = sessions().find((candidate) => terminalSessionMatchesPendingSession(candidate, pendingSession));
    return String(session?.id ?? '').trim() || null;
  };

  const beginCreateSession = async (name: string | undefined, workingDir: string): Promise<string | null> => {
    const pendingSession = createPendingSession(name, workingDir);
    // Let the optimistic tab reach the screen before starting the heavier RPC/state reconciliation path.
    await waitForTerminalUiPaint();
    if (disposed || !pendingTerminalSessionById(pendingSession.id)) return null;
    try {
      const sessionId = await createPanelSession(name, pendingSession.workingDir);
      if (!sessionId) throw new Error(i18n.t('terminal.invalidCreateResponse'));
      resolvePendingSession(pendingSession.id, sessionId);
      return sessionId;
    } catch (e) {
      const resolvedSessionId = findResolvedSessionForRemovedPendingSession(pendingSession);
      if (resolvedSessionId) {
        deferInitialSessionMount(resolvedSessionId);
        activateSession(resolvedSessionId);
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

  const clearSession = async (sessionId: string) => {
    const sid = String(sessionId ?? '').trim();
    if (!sid) return;
    setError(null);

    coreRegistry.get(sid)?.clear();
    try {
      await transport.clear(sid);
      actionsRegistry.get(sid)?.resetAfterClear();
      await transport.sendInput(sid, '\r', connId);
    } catch (e) {
      if (handleExecuteDenied(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const clearActive = async () => {
    await clearSession(activeSessionId() ?? '');
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
      try {
        if (!normalizedSessionId) return;
        if (pendingTerminalSessionById(normalizedSessionId)) {
          removePendingSession(normalizedSessionId);
          return;
        }

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
        if (disposed) return;

        if (props.sessionOperations) {
          await props.sessionOperations.deleteSession(normalizedSessionId);
          void sessionsCoordinator.refresh().catch(() => undefined);
        } else {
          await sessionsCoordinator.deleteSession(normalizedSessionId);
        }
      } catch (e) {
        setOptimisticSessionClosing(normalizedSessionId, false);
        void sessionsCoordinator.refresh().catch(() => undefined);
        if (handleExecuteDenied(e)) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  createEffect(() => {
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
        await sessionsCoordinator.refresh();
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

    const shouldDeferInitialMount = deferredInitialMountSessionIds.has(id);
    if (!mountedInitialActiveSession && !shouldDeferInitialMount) {
      mountedInitialActiveSession = true;
      markSessionMounted(id);
      return;
    }

    mountedInitialActiveSession = true;
    scheduleSessionMountAfterPaint(id);
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
  });

  createEffect(() => {
    const id = activeSessionId();
    writeActiveSessionId(activeSessionStorageKey, id && !pendingTerminalSessionById(id) ? id : null);
  });

  const sessionListItems = createMemo<terminal_session_sidebar_item[]>(() => {
    const list = sessions();
    const tabStates = tabVisualStateBySession();
    const workStates = workStateBySession();
    const canOpenPath = canBrowseFiles();
    const sessionItems = list.map((s, index) => {
      const fullPath = normalizeAskFlowerAbsolutePath(String(s.workingDir ?? '').trim());
      const fallbackLabel = buildTerminalSessionLabel(s, i18n.t('terminal.terminalName', { index: index + 1 }));
      const title = buildTerminalSidebarDirectoryTitle(fullPath, fallbackLabel);
      return {
        id: s.id,
        label: fallbackLabel,
        title,
        avatarInitial: buildTerminalSidebarAvatarInitial(title),
        avatarTone: buildTerminalSidebarAvatarTone(`${s.id}:${fullPath}:${title}`),
        fullPath,
        status: resolveTerminalSidebarStatus(workStates[s.id], tabStates[s.id]),
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
        status: session.status,
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
    const next = sessionListItems().map((item) => item.id);
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

      if (typeof target.input === 'function') {
        target.input(sequence, true);
      } else {
        void transport.sendInput(sessionId, sequence, connId);
      }
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

  const isTerminalSurfaceContextMenuEvent = (event: MouseEvent): boolean => {
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

  const openTerminalAskMenu = (event: MouseEvent) => {
    if (!connected()) return;

    const currentActiveId = String(activeSessionId() ?? '').trim();
    const activeSession = currentActiveId
      ? sessions().find((item) => item.id === currentActiveId) ?? null
      : null;
    const resolvedSession = activeSession ?? sessions()[0] ?? null;
    if (!resolvedSession) return;

    const workingDir = normalizeAskFlowerAbsolutePath(String(resolvedSession.workingDir ?? '').trim())
      || normalizeAskFlowerAbsolutePath(agentHomePathAbs())
      || '';
    const homePath = normalizeAskFlowerAbsolutePath(agentHomePathAbs()) || undefined;
    const core = coreRegistry.get(resolvedSession.id) ?? getActiveCore();
    const selection = buildTerminalSelectionSnapshot(resolvedSession.id, core);
    const showBrowseFiles = Boolean(workingDir) && canBrowseFiles();

    event.preventDefault();
    event.stopPropagation();

    if (!currentActiveId) {
      setActiveSessionId(resolvedSession.id);
    }

    setTerminalSidebarMenu(null);
    setTerminalAskMenu({
      x: event.clientX,
      y: event.clientY,
      workingDir,
      homePath,
      selection,
      showBrowseFiles,
    });
  };

  function handleTerminalContextMenuCapture(event: MouseEvent) {
    if (!connected()) return;
    if (!isTerminalSurfaceContextMenuEvent(event)) return;
    openTerminalAskMenu(event);
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
    setTerminalAskMenu(null);
    if (!menu) return;
    void executeTerminalCopyCommand({
      source: 'context_menu',
      sessionId: menu.selection.sessionId,
    }).catch(notifyTerminalCopyFailure);
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

  const openSidebarItemFiles = (item: terminal_session_sidebar_item) => {
    if (!item.canBrowsePath || !item.fullPath) return;

    setTerminalSidebarMenu(null);
    void env.openFileBrowserAtPath(item.fullPath, {
      homePath: normalizeAskFlowerAbsolutePath(agentHomePathAbs()) || undefined,
      title: item.title,
      openStrategy: env.viewMode() === 'workbench' ? 'create_new' : undefined,
    });
  };

  const copySidebarItemPath = (item: terminal_session_sidebar_item) => {
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

  const duplicateSidebarItemSession = (item: terminal_session_sidebar_item) => {
    const fullPath = normalizeAskFlowerAbsolutePath(item.fullPath);
    if (!connected() || !item.canDuplicate || !fullPath) return;
    const nextIndex = sessions().length + pendingTerminalSessions().length + 1;
    const fallbackName = i18n.t('terminal.terminalName', { index: nextIndex });
    void beginCreateSession(resolveRequestedSessionName(undefined, fullPath, fallbackName), fullPath);
  };

  const clearSidebarItemSession = (item: terminal_session_sidebar_item) => {
    if (!item.canClear) return;
    setTerminalSidebarMenu(null);
    void clearSession(item.id);
  };

  const askFlowerFromSidebarItem = (item: terminal_session_sidebar_item, anchor: { x: number; y: number }) => {
    const workingDir = normalizeAskFlowerAbsolutePath(item.fullPath) || normalizeAskFlowerAbsolutePath(agentHomePathAbs()) || '';
    if (!workingDir) return;
    setTerminalSidebarMenu(null);
    openTerminalAskFlowerContext({
      x: anchor.x,
      y: anchor.y,
      workingDir,
      selection: {
        sessionId: item.id,
        selectionText: '',
        hasSelection: false,
      },
    });
  };

  const openTerminalAskFlowerContext = (context: {
    x: number;
    y: number;
    workingDir: string;
    selection: terminal_selection_snapshot;
  }) => {
    const workingDir = normalizeAskFlowerAbsolutePath(context.workingDir) || normalizeAskFlowerAbsolutePath(agentHomePathAbs()) || '';
    if (!workingDir) return;

    const selection = context.selection.selectionText;
    const trimmedSelection = selection.trim();
    const pendingAttachments: File[] = [];
    const notes: string[] = [];
    let contextItems: EnvFlowerTurnLauncherContextItem[] = [];

    if (trimmedSelection) {
      if (trimmedSelection.length > MAX_INLINE_TERMINAL_SELECTION_CHARS) {
        const attachmentName = `terminal-selection-${Date.now()}.txt`;
        const attachmentBlob = new Blob([trimmedSelection], { type: 'text/plain' });
        if (attachmentBlob.size > ASK_FLOWER_ATTACHMENT_MAX_BYTES) {
          notes.push(i18n.t('terminal.largeSelectionSkipped'));
        } else {
          pendingAttachments.push(new File([attachmentBlob], attachmentName, { type: 'text/plain' }));
          notes.push(i18n.t('terminal.largeSelectionAttached', { name: attachmentName }));
        }
        contextItems = [
          {
            kind: 'terminal_selection',
            working_dir: workingDir,
            selection: '',
            selection_chars: trimmedSelection.length,
          },
        ];
      } else {
        contextItems = [
          {
            kind: 'terminal_selection',
            working_dir: workingDir,
            selection: trimmedSelection,
            selection_chars: trimmedSelection.length,
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
      pending_attachments: pendingAttachments,
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

    return items;
  };

  const buildTerminalSidebarMenuItems = (menu: NonNullable<ReturnType<typeof terminalSidebarMenu>>): FloatingContextMenuItem[] => {
    const item = menu.item;
    return [
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
        disabled: !item.canClear,
        onSelect: () => clearSidebarItemSession(item),
      },
      {
        id: 'sidebar-ask-flower',
        kind: 'action',
        label: i18n.t('terminal.askFlower'),
        icon: FlowerContextMenuIcon,
        onSelect: () => askFlowerFromSidebarItem(item, { x: menu.x, y: menu.y }),
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

  const openTerminalSidebarMenu = (event: MouseEvent, item: terminal_session_sidebar_item) => {
    event.preventDefault();
    event.stopPropagation();
    setTerminalAskMenu(null);
    setTerminalSidebarMenu({
      x: event.clientX,
      y: event.clientY,
      item,
    });
  };

  const openTerminalSidebarKeyboardMenu = (event: KeyboardEvent, item: terminal_session_sidebar_item) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const rect = target?.getBoundingClientRect();
    setTerminalAskMenu(null);
    setTerminalSidebarMenu({
      x: rect ? rect.left + Math.min(rect.width - 16, 64) : 0,
      y: rect ? rect.top + Math.min(rect.height - 8, 44) : 0,
      item,
    });
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

  const handleRootKeyDown: (e: KeyboardEvent) => void = (e) => {
    if (matchesPlainPrimaryModShortcut(e, 'f')) {
      // Common terminal shortcut: intercept browser find.
      e.preventDefault();
      openSearch();
      return;
    }

    const shortcutTabIndex = terminalTabShortcutIndex(e);
    if (shortcutTabIndex !== null) {
      const target = sessionListItems()[shortcutTabIndex] ?? null;
      if (target) {
        e.preventDefault();
        setActiveSessionId(target.id);
        restoreActiveTerminalFocus();
      }
      return;
    }

    if (e.key === 'Escape' && searchOpen()) {
      e.preventDefault();
      closeSearch();
      return;
    }

    if (e.key === 'Enter' && searchOpen()) {
      // Enter/Shift+Enter navigates to next/previous match.
      e.preventDefault();
      if (e.shiftKey) goPrevMatch();
      else goNextMatch();
    }
  };

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
  const terminalSidebarWidth = createMemo(() => (isMobileLayout() ? 232 : 286));
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
        <div class="flex min-h-0 flex-1 overflow-hidden bg-background">
          <Sidebar
            width={terminalSidebarWidth()}
            ariaLabel={i18n.t('terminal.title')}
            class="redeven-terminal-session-sidebar"
          >
            <SidebarContent class="flex h-full min-h-0 flex-col overflow-hidden">
              <div class="shrink-0 space-y-2">
                <div class="flex items-center gap-2 px-0.5">
                  <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent/55 text-sidebar-accent-foreground">
                    <Terminal class="h-3.5 w-3.5" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">{i18n.t('terminal.title')}</div>
                    <div class="truncate text-xs font-semibold text-sidebar-foreground">{activeToolbarTitle()}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-7 w-7 cursor-pointer p-0 disabled:cursor-not-allowed"
                    data-testid="terminal-sidebar-add-session"
                    onClick={createSession}
                    disabled={!connected()}
                    title={i18n.t('terminal.newSession')}
                  >
                    <PlusIcon class="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-7 w-7 cursor-pointer p-0 disabled:cursor-not-allowed"
                    data-testid="terminal-sidebar-refresh"
                    onClick={handleRefresh}
                    disabled={!connected() || refreshing()}
                    loading={refreshing()}
                    title={i18n.t('terminal.refresh')}
                  >
                    <RefreshIcon class="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <SidebarSection
                title={i18n.t('terminal.title')}
                actions={<span class="text-[9px] font-medium normal-case tracking-normal text-muted-foreground/60">{terminalShortcutModLabel()}+1-9</span>}
                class="min-h-0 flex flex-1 flex-col overflow-hidden [&>div:last-child]:min-h-0 [&>div:last-child]:flex [&>div:last-child]:flex-1 [&>div:last-child]:flex-col [&>div:last-child]:overflow-hidden"
              >
                <div data-testid="terminal-session-list" class="min-h-0 flex-1 overflow-hidden">
                  <SidebarItemList
                    {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
                    class="min-h-0 h-full overflow-y-auto overflow-x-hidden pr-0.5 [scrollbar-gutter:stable]"
                  >
                  <For
                    each={sessionListItemIds()}
                    fallback={
                      <div class="rounded-md border border-sidebar-border/70 bg-sidebar-accent/25 px-2.5 py-3 text-xs text-muted-foreground">
                        {emptySessionListLoading() ? i18n.t('terminal.loadingSessions') : i18n.t('terminal.noSessionsTitle')}
                      </div>
                    }
                  >
                    {(sessionId, index) => {
                      const item = createMemo(() => sessionListItemById().get(sessionId)!);
                      const sidebarActive = () => sidebarActiveSessionId() === sessionId;
                      const committedActive = () => activeDisplaySessionId() === sessionId;
                      return (
                        <div
                          class={`group relative rounded-md border px-2.5 py-2 pr-9 text-xs transition-colors duration-75 ${
                            sidebarActive()
                              ? 'border-border/20 bg-sidebar-accent text-sidebar-accent-foreground shadow-[0_1px_3px_rgba(0,0,0,0.06)]'
                              : 'border-transparent text-sidebar-foreground/80 hover:border-border/15 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground'
                          }`}
                          onContextMenu={(event) => openTerminalSidebarMenu(event, item())}
                        >
                          <button
                            type="button"
                            class="absolute inset-0 z-0 w-full cursor-pointer rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sidebar-ring"
                            data-terminal-session-id={sessionId}
                            data-terminal-session-active={sidebarActive() ? 'true' : 'false'}
                            data-terminal-session-index={index() + 1}
                            aria-label={`${item().label}: ${item().title}${item().fullPath ? ` ${item().fullPath}` : ''}`}
                            aria-current={committedActive() ? 'page' : undefined}
                            title={item().fullPath || item().title}
                            onPointerDown={(event) => previewSidebarSessionSelection(event, sessionId)}
                            onClick={() => commitSidebarSessionSelection(sessionId)}
                            onKeyDown={(event) => openTerminalSidebarKeyboardMenu(event, item())}
                          >
                            <span class="sr-only">{item().label}</span>
                            <span class="sr-only" data-terminal-tab-status={item().status}>
                              {item().status}
                            </span>
                          </button>
                          <Show when={sidebarActive()}>
                            <span class="absolute left-0 top-2 bottom-2 z-10 w-[2px] rounded-full bg-primary" aria-hidden="true" />
                          </Show>
                          <div class="relative z-10 flex min-w-0 items-start gap-2.5 pointer-events-none">
                            <span
                              class="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold uppercase leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
                              style={{
                                background: item().avatarTone.background,
                                'border-color': item().avatarTone.border,
                                color: item().avatarTone.foreground,
                              }}
                              data-terminal-session-avatar={sessionId}
                              aria-hidden="true"
                            >
                              {item().avatarInitial}
                              <TerminalSidebarStatusBadge status={item().status} />
                            </span>
                            <span class="min-w-0 flex-1 text-left">
                              <span class="flex min-w-0 items-center gap-1.5">
                                <span class="truncate text-sm font-semibold leading-5">{item().title}</span>
                                <span class="shrink-0 rounded border border-sidebar-border/80 bg-sidebar/35 px-1 py-[1px] text-[9px] leading-none text-muted-foreground/80">{index() + 1}</span>
                              </span>
                              <Show when={item().fullPath}>
                                <span class="mt-0.5 flex h-6 min-w-0 max-w-full items-center gap-1.5">
                                  <span
                                    class="pointer-events-none min-w-0 flex-1 cursor-pointer truncate text-[11px] leading-6 text-muted-foreground/75"
                                    title={item().fullPath}
                                    data-terminal-session-path={sessionId}
                                    data-testid={`terminal-session-path-${sessionId}`}
                                  >
                                    {item().fullPath}
                                  </span>
                                  <button
                                    type="button"
                                    class={`pointer-events-auto flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/70 transition-colors duration-75 focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring ${
                                      copiedSidebarPathSessionId() === sessionId
                                        ? 'bg-primary/10 text-primary'
                                        : 'hover:bg-sidebar-accent hover:text-sidebar-foreground'
                                    }`}
                                    title={copiedSidebarPathSessionId() === sessionId ? i18n.t('terminal.pathCopied') : i18n.t('terminal.copyPath')}
                                    aria-label={`${copiedSidebarPathSessionId() === sessionId ? i18n.t('terminal.pathCopied') : i18n.t('terminal.copyPath')}: ${item().fullPath}`}
                                    data-testid={`terminal-session-path-copy-${sessionId}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      copySidebarItemPath(item());
                                    }}
                                  >
                                    <Show when={copiedSidebarPathSessionId() === sessionId} fallback={<Copy class="h-3 w-3" />}>
                                      <Check class="h-3 w-3" />
                                    </Show>
                                  </button>
                                </span>
                              </Show>
                            </span>
                          </div>
                          <div class="pointer-events-none absolute right-1.5 top-1.5 z-20 flex w-5 flex-col items-center gap-1 group-hover:pointer-events-auto focus-within:pointer-events-auto">
                            <Show when={item().closable}>
                              <button
                                type="button"
                                class="pointer-events-auto flex h-5 w-5 cursor-pointer items-center justify-center rounded text-[11px] text-muted-foreground/70 opacity-0 transition-opacity duration-75 hover:bg-error/10 hover:text-error focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring group-hover:opacity-100"
                                data-testid={`close-session-${sessionId}`}
                                aria-label={`${i18n.t('terminal.deleteSession')} ${item().title}`}
                                title={i18n.t('terminal.deleteSession')}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  closeSession(sessionId);
                                }}
                              >
                                <X class="h-3 w-3" />
                              </button>
                            </Show>
                            <Show when={item().canBrowsePath}>
                              <button
                                type="button"
                                class="pointer-events-auto flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground/70 opacity-0 transition-opacity duration-75 hover:bg-sidebar-accent hover:text-sidebar-foreground focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring group-hover:opacity-100"
                                data-testid={`terminal-session-files-${sessionId}`}
                                aria-label={`${i18n.t('terminal.files')}: ${item().fullPath}`}
                                title={`${i18n.t('terminal.files')}: ${item().fullPath}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openSidebarItemFiles(item());
                                }}
                              >
                                <ExternalLink class="h-3 w-3" />
                              </button>
                            </Show>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                  </SidebarItemList>
                </div>
              </SidebarSection>
            </SidebarContent>
          </Sidebar>

          <div class="min-w-0 min-h-0 flex flex-1 flex-col">
            <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-2">
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground">
                  <Terminal class="h-3.5 w-3.5" />
                </div>
                <div class="min-w-0">
                  <div class="truncate text-xs font-semibold text-foreground">{activeToolbarTitle()}</div>
                  <Show when={activeToolbarSubtitle()}>
                    <div class="truncate text-[10px] leading-3 text-muted-foreground">{activeToolbarSubtitle()}</div>
                  </Show>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={clearActive} disabled={!connected() || !activeSessionId()} title={i18n.t('terminal.clear')}>
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
                <div class="absolute top-2 right-2 z-20 flex items-center gap-1 rounded-md border border-white/15 bg-[#0b0f14]/95 px-2 py-1 shadow-md backdrop-blur">
                  <Input
                    ref={(n) => (searchInputEl = n)}
                    size="sm"
                    value={searchQuery()}
                    placeholder={i18n.t('terminal.searchPlaceholder')}
                    class="w-[220px] bg-black/20 border-white/20 text-[#e5e7eb] placeholder:text-[#94a3b8] focus:ring-yellow-400 focus:border-yellow-400 shadow-none"
                    onInput={(e) => setSearchQuery(e.currentTarget.value)}
                  />
                  <div class="text-[10px] text-[#94a3b8] tabular-nums min-w-[54px] text-right">
                    {searchResultCount() <= 0 || searchResultIndex() < 0 ? '0/0' : `${searchResultIndex() + 1}/${searchResultCount()}`}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    class="text-[#e5e7eb] hover:bg-white/10 hover:text-white"
                    onClick={goPrevMatch}
                    disabled={searchResultCount() <= 0}
                    title={i18n.t('terminal.previous')}
                  >
                    {i18n.t('terminal.previousShort')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    class="text-[#e5e7eb] hover:bg-white/10 hover:text-white"
                    onClick={goNextMatch}
                    disabled={searchResultCount() <= 0}
                    title={i18n.t('terminal.next')}
                  >
                    {i18n.t('terminal.next')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    class="text-[#e5e7eb] hover:bg-white/10 hover:text-white"
                    onClick={closeSearch}
                    title={i18n.t('terminal.close')}
                  >
                    {i18n.t('terminal.close')}
                  </Button>
                </div>
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
                          {/* Keep TerminalSessionView identity tied to sessionId; metadata snapshots may replace session objects. */}
                          <TabPanel active={activeDisplaySessionId() === sessionId} keepMounted class="h-full">
                            <TerminalSessionView
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
                              onSurfaceClick={handleWorkbenchTerminalSurfaceClick}
                              onBell={handleSessionBell}
                              onShellIntegrationEvent={handleShellIntegrationEvent}
                              onVisibleOutput={handleVisibleOutput}
                              onTerminalFileLinkOpen={openTerminalFileLinkTarget}
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
              <div data-testid="terminal-status-bar" class="flex items-center justify-between px-3 py-1 border-t border-border text-[10px] text-muted-foreground">
                <span>{i18n.t('terminal.statusSession')}: {statusBarSessionLabel()}</span>
                <span>{i18n.t('terminal.statusHistory')}: {historyBytes() === null ? '-' : formatBytes(historyBytes() ?? 0)}</span>
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
            items={buildTerminalAskMenuItems(menu)}
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
            items={buildTerminalSidebarMenuItems(menu)}
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

  const [executeDenied, setExecuteDenied] = createSignal(false);

  const permissionReady = () => ctx.env.state === 'ready';
  const canExecute = () => Boolean(ctx.env()?.permissions?.can_execute);
  const noExecute = createMemo(() => executeDenied() || (permissionReady() && !canExecute()));

  createEffect(() => {
    // Reset when disconnected so users can reconnect after policy changes.
    if (protocol.status() !== 'connected') {
      setExecuteDenied(false);
    }
  });

  createEffect(() => {
    if (noExecute()) {
      disposeRedevenTerminalSessionsCoordinator();
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
