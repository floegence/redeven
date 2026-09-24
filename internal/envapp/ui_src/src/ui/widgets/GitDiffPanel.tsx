import { GitFileLabel } from './GitFileLabel';
import { useGitDiffNavigation } from './GitDiffSplit';
import {
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { cn } from "@floegence/floe-webapp-core";
import { RpcError, useProtocol } from '@floegence/floe-webapp-protocol';
import { ArrowLeft, FileText, Refresh } from '@floegence/floe-webapp-core/icons';
import {
  useRedevenRpc,
  type GitCommitDiffPresentation,
  type GitDiffFileContent,
  type GitGetDiffContentRequest,
} from "../protocol/redeven_v1";
import {
  exactGitPath,
  seedGitDiffContent,
  type GitSeededCommitFileSummary,
  type GitSeededWorkspaceChange,
} from "../utils/gitWorkbench";
import {
  localizedGitCommitDiffPresentationBadge,
  localizedGitCommitDiffPresentationDetail,
} from '../utils/localizedGitWorkbench';
import {
  redevenSegmentedItemClass,
  redevenSurfaceRoleClass,
} from "../utils/redevenSurfaceRoles";
import { GitPatchViewer } from "./GitPatchViewer";
import { GitMetaPill, GitSkeletonBlock, GitStatePane } from "./GitWorkbenchPrimitives";
import { useI18n } from "../i18n";

export type GitDiffDialogItem =
  | GitSeededCommitFileSummary
  | GitSeededWorkspaceChange
  | GitDiffFileContent;

export type GitDiffDialogSource =
  | {
      kind: "workspace";
      repoRootPath: string;
      workspaceSection: string;
    }
  | {
      kind: "commit";
      repoRootPath: string;
      commit: string;
      presentation?: GitCommitDiffPresentation;
    }
  | {
      kind: "compare";
      repoRootPath: string;
      baseRef: string;
      targetRef: string;
    }
  | {
      kind: "stash";
      repoRootPath: string;
      stashId: string;
    };

type GitDiffDialogMode = "patch" | "full-context";
type GitDiffContentMode = "preview" | "full";
type GitDiffDialogErrorState = {
  message: string;
  detail?: string;
};
type GitDiffDialogLoadPhase = "idle" | "loading" | "ready" | "error";
type GitDiffDialogLoadSlot = {
  selectionKey: string;
  requestKey: string;
  transport: ReturnType<ReturnType<typeof useProtocol>['rpcTransport']>;
  phase: GitDiffDialogLoadPhase;
  item: GitDiffFileContent | null;
  error: GitDiffDialogErrorState | null;
  presentation: GitCommitDiffPresentation | null;
};

type GitDiffDialogSelectionSession = {
  selectionKey: string;
  previewRequestKey: string;
  fullRequestKey: string;
  previewRequest: GitGetDiffContentRequest | null;
  fullRequest: GitGetDiffContentRequest | null;
  seededPreviewItem: GitDiffFileContent | null;
  unavailableItem: GitDiffFileContent | null;
  directoryUnavailableItem: GitDiffFileContent | null;
  commitPresentation: GitCommitDiffPresentation | null;
};

type GitDiffDialogBodyState =
  | {
      kind: "empty";
    }
  | {
      kind: "loading" | "waiting";
      mode: GitDiffContentMode;
    }
  | {
      kind: "error";
      mode: GitDiffContentMode;
      error: GitDiffDialogErrorState;
    }
  | {
      kind: "ready";
      mode: GitDiffContentMode;
      item: GitDiffFileContent;
    }
  | {
      kind: "unavailable";
      mode: GitDiffContentMode;
      item: GitDiffFileContent;
      message: string;
    };

export type GitDiffDialogErrorFormatterContext = {
  mode: GitDiffContentMode;
  source?: GitDiffDialogSource | null;
  item: GitDiffDialogItem | null | undefined;
};

export type GitDiffDialogErrorFormatter = (
  error: unknown,
  context: GitDiffDialogErrorFormatterContext,
) => GitDiffDialogErrorState | string | null | undefined;

const gitDiffModeButtonClass =
  "cursor-pointer rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-50";

export interface GitDiffPanelProps {
  open: boolean;
  loading?: boolean;
  refreshKey?: number;
  item: GitDiffDialogItem | null | undefined;
  source?: GitDiffDialogSource | null;
  emptyMessage: string;
  unavailableMessage?:
    | string
    | ((item: GitDiffFileContent) => string | undefined);
  errorFormatter?: GitDiffDialogErrorFormatter;
  class?: string;
}


function resolveDiffErrorState(
  error: unknown,
  fallbackMessage: string,
  context: GitDiffDialogErrorFormatterContext,
  i18n: ReturnType<typeof useI18n>,
  formatter?: GitDiffDialogErrorFormatter,
): GitDiffDialogErrorState {
  if (error instanceof RpcError && error.code === 403) {
    return { message: fallbackMessage, detail: i18n.t('gitDiff.permissionDenied') };
  }
  const formatted = formatter?.(error, context);
  if (typeof formatted === "string") {
    const message = formatted.trim();
    if (message) return { message };
  }
  if (formatted && typeof formatted === "object") {
    const message = String(formatted.message ?? "").trim();
    const detail = String(formatted.detail ?? "").trim();
    if (message) {
      return {
        message,
        detail: detail || undefined,
      };
    }
  }
  return {
    message: fallbackMessage,
    detail: i18n.t(error instanceof RpcError && error.code === 404
      ? 'gitDiff.sourceUnavailable'
      : 'gitDiff.requestFailedDetail'),
  };
}

function normalizeDiffPathCandidate(value: unknown): string {
  return typeof value === "string" ? exactGitPath(value) : "";
}

function isDirectoryDiffPlaceholder(
  item: GitDiffDialogItem | GitDiffFileContent | null | undefined,
): boolean {
  if (!item) return false;
  return [
    normalizeDiffPathCandidate(item.displayPath),
    normalizeDiffPathCandidate(item.path),
    normalizeDiffPathCandidate(item.newPath),
    normalizeDiffPathCandidate(item.oldPath),
  ].some((path) => path.endsWith("/"));
}

function createUnavailableDiffItem(
  item: GitDiffDialogItem | null | undefined,
): GitDiffFileContent | null {
  if (!item) return null;
  return {
    changeType:
      typeof item.changeType === "string" ? item.changeType : undefined,
    path: typeof item.path === "string" ? item.path : undefined,
    oldPath: typeof item.oldPath === "string" ? item.oldPath : undefined,
    newPath: typeof item.newPath === "string" ? item.newPath : undefined,
    displayPath:
      typeof item.displayPath === "string" ? item.displayPath : undefined,
    additions: typeof item.additions === "number" ? item.additions : undefined,
    deletions: typeof item.deletions === "number" ? item.deletions : undefined,
    isBinary: typeof item.isBinary === "boolean" ? item.isBinary : undefined,
    patchText: "",
  };
}

function buildDiffContentRequest(
  source: GitDiffDialogSource | null | undefined,
  item: GitDiffDialogItem | null | undefined,
  mode: GitDiffContentMode,
): GitGetDiffContentRequest | null {
  const repoRootPath = exactGitPath(source?.repoRootPath);
  if (!repoRootPath || !source || !item) return null;
  const file = {
    changeType:
      typeof item.changeType === "string" ? item.changeType : undefined,
    path: typeof item.path === "string" ? item.path : undefined,
    oldPath: typeof item.oldPath === "string" ? item.oldPath : undefined,
    newPath: typeof item.newPath === "string" ? item.newPath : undefined,
  };
  switch (source.kind) {
    case "workspace":
      return {
        repoRootPath,
        sourceKind: "workspace",
        workspaceSection: String(source.workspaceSection ?? "").trim(),
        mode,
        file,
      };
    case "commit":
      return {
        repoRootPath,
        sourceKind: "commit",
        commit: String(source.commit ?? "").trim(),
        mode,
        file,
      };
    case "compare":
      return {
        repoRootPath,
        sourceKind: "compare",
        baseRef: String(source.baseRef ?? "").trim(),
        targetRef: String(source.targetRef ?? "").trim(),
        mode,
        file,
      };
    case "stash":
      return {
        repoRootPath,
        sourceKind: "stash",
        stashId: String(source.stashId ?? "").trim(),
        stashSection: 'stashSection' in item && typeof item.stashSection === 'string'
          ? item.stashSection
          : undefined,
        mode,
        file,
      };
    default:
      return null;
  }
}

function diffRequestKey(req: GitGetDiffContentRequest | null): string {
  if (!req) return "";
  return JSON.stringify(req);
}

function buildGitDiffDialogSelectionKey(
  source: GitDiffDialogSource | null | undefined,
  item: GitDiffDialogItem | null | undefined,
): string {
  if (!source || !item) return "";
  return JSON.stringify({
    sourceKind: source.kind,
    repoRootPath: normalizeDiffPathCandidate(source.repoRootPath),
    workspaceSection:
      source.kind === "workspace"
        ? normalizeDiffPathCandidate(source.workspaceSection)
        : undefined,
    commit:
      source.kind === "commit"
        ? normalizeDiffPathCandidate(source.commit)
        : undefined,
    baseRef:
      source.kind === "compare"
        ? normalizeDiffPathCandidate(source.baseRef)
        : undefined,
    targetRef:
      source.kind === "compare"
        ? normalizeDiffPathCandidate(source.targetRef)
        : undefined,
    stashId:
      source.kind === "stash"
        ? normalizeDiffPathCandidate(source.stashId)
        : undefined,
    stashSection:
      'stashSection' in item && typeof item.stashSection === 'string'
        ? item.stashSection
        : undefined,
    file: {
      changeType:
        typeof item.changeType === "string" ? item.changeType : undefined,
      path: normalizeDiffPathCandidate(item.path),
      oldPath: normalizeDiffPathCandidate(item.oldPath),
      newPath: normalizeDiffPathCandidate(item.newPath),
      displayPath: normalizeDiffPathCandidate(item.displayPath),
    },
  });
}

function createGitDiffDialogLoadSlot(values: Partial<GitDiffDialogLoadSlot> = {}): GitDiffDialogLoadSlot {
  return {
    selectionKey: '',
    requestKey: '',
    transport: null,
    phase: 'idle',
    item: null,
    error: null,
    presentation: null,
    ...values,
  };
}

export function GitDiffPanel(props: GitDiffPanelProps) {
  const navigation = useGitDiffNavigation();
  const i18n = useI18n();
  const rpc = useRedevenRpc();
  const protocol = useProtocol();
  const [refreshRevision, setRefreshRevision] = createSignal(0);
  // The mode is a browsing preference for this inspection surface. Keep it
  // while the selected file changes so a reviewer can scan every file in the
  // same context without repeating the control selection.
  const [selectedMode, setSelectedMode] = createSignal<GitDiffDialogMode>("patch");
  const [previewSlot, setPreviewSlot] = createSignal<GitDiffDialogLoadSlot>(
    createGitDiffDialogLoadSlot(),
  );
  const [fullSlot, setFullSlot] = createSignal<GitDiffDialogLoadSlot>(
    createGitDiffDialogLoadSlot(),
  );

  let disposed = false;
  onCleanup(() => { disposed = true; });

  // A new file summary is a fresh workspace snapshot, even at the same path.
  const selectionRevision = createMemo((revision: number) => {
    void props.item;
    void props.refreshKey;
    refreshRevision();
    return revision + 1;
  }, 0);

  const selectionSession = createMemo<GitDiffDialogSelectionSession>(() => {
    const identity = buildGitDiffDialogSelectionKey(props.source, props.item);
    const selectionKey = identity ? `${identity}:${selectionRevision()}` : '';
    const directoryUnavailableItem = isDirectoryDiffPlaceholder(props.item)
      ? createUnavailableDiffItem(props.item)
      : null;
    const previewRequest = directoryUnavailableItem
      ? null
      : buildDiffContentRequest(props.source, props.item, "preview");
    const fullRequest = directoryUnavailableItem
      ? null
      : buildDiffContentRequest(props.source, props.item, "full");
    return {
      selectionKey,
      previewRequestKey: diffRequestKey(previewRequest),
      fullRequestKey: diffRequestKey(fullRequest),
      previewRequest,
      fullRequest,
      seededPreviewItem: refreshRevision() === 0 ? seedGitDiffContent(props.item) : null,
      unavailableItem: createUnavailableDiffItem(props.item),
      directoryUnavailableItem,
      commitPresentation:
        props.source?.kind === "commit"
          ? (props.source.presentation ?? null)
          : null,
    };
  });
  const canLoadFullContext = createMemo(
    () =>
      !selectionSession().directoryUnavailableItem &&
      selectionSession().fullRequestKey !== "",
  );
  const activeMode = createMemo<GitDiffDialogMode>(() => {
    return props.open ? selectedMode() : "patch";
  });
  const previewSlotMatchesSelection = createMemo(
    () => previewSlot().selectionKey === selectionSession().selectionKey
      && previewSlot().transport === protocol.rpcTransport(),
  );
  const fullSlotMatchesSelection = createMemo(
    () => fullSlot().selectionKey === selectionSession().selectionKey
      && fullSlot().transport === protocol.rpcTransport(),
  );
  const activeCommitPresentation = createMemo(() => {
    const session = selectionSession();
    const previewPresentation = previewSlotMatchesSelection()
      ? previewSlot().presentation
      : null;
    const fullPresentation = fullSlotMatchesSelection()
      ? fullSlot().presentation
      : null;
    if (props.source?.kind !== "commit") return null;
    if (activeMode() === "full-context") {
      return fullPresentation ?? previewPresentation ?? session.commitPresentation;
    }
    return previewPresentation ?? session.commitPresentation ?? fullPresentation;
  });
  const previewBodyState = createMemo<GitDiffDialogBodyState>(() => {
    const session = selectionSession();
    if (!props.item) return { kind: "empty" };
    const preview = previewSlot();
    if (session.directoryUnavailableItem) {
      return {
        kind: "unavailable",
        mode: "preview",
        item: session.directoryUnavailableItem,
        message: i18n.t('gitDiff.directoryUnavailable'),
      };
    }
    if (previewSlotMatchesSelection() && preview.phase === "ready" && !preview.item) return { kind: "empty" };
    const readyItem = previewSlotMatchesSelection()
      ? preview.item ?? session.seededPreviewItem
      : session.seededPreviewItem;
    if (readyItem) {
      return {
        kind: "ready",
        mode: "preview",
        item: readyItem,
      };
    }
    if (previewSlotMatchesSelection() && preview.phase === "error" && preview.error) {
      return {
        kind: "error",
        mode: "preview",
        error: preview.error,
      };
    }
    if (session.previewRequestKey) {
      return {
        kind: protocol.rpcTransport() ? "loading" : "waiting",
        mode: "preview",
      };
    }
    if (session.unavailableItem) {
      return {
        kind: "unavailable",
        mode: "preview",
        item: session.unavailableItem,
        message: i18n.t('gitDiff.patchUnavailable'),
      };
    }
    return { kind: "empty" };
  });
  const effectivePreviewItem = createMemo(() => {
    const state = previewBodyState();
    return state.kind === "ready" ? state.item : null;
  });
  const fullBodyState = createMemo<GitDiffDialogBodyState>(() => {
    const session = selectionSession();
    if (!props.item) return { kind: "empty" };
    const full = fullSlot();
    const previewItem = effectivePreviewItem();
    if (session.directoryUnavailableItem) {
      return {
        kind: "unavailable",
        mode: "full",
        item: session.directoryUnavailableItem,
        message: i18n.t('gitDiff.directoryUnavailable'),
      };
    }
    if (fullSlotMatchesSelection() && full.phase === "ready" && !full.item) return { kind: "empty" };
    if (fullSlotMatchesSelection() && full.item) {
      return {
        kind: "ready",
        mode: "full",
        item: full.item,
      };
    }
    if (fullSlotMatchesSelection() && full.phase === "error" && full.error) {
      return {
        kind: "error",
        mode: "full",
        error: full.error,
      };
    }
    if (previewItem) {
      return {
        kind: "ready",
        mode: "preview",
        item: previewItem,
      };
    }
    if (session.fullRequestKey) {
      return {
        kind: protocol.rpcTransport() ? "loading" : "waiting",
        mode: "full",
      };
    }
    if (session.unavailableItem) {
      return {
        kind: "unavailable",
        mode: "full",
        item: session.unavailableItem,
        message: i18n.t('gitDiff.fullContextUnavailable'),
      };
    }
    return { kind: "empty" };
  });
  const activeBodyState = createMemo(() =>
    activeMode() === "full-context" ? fullBodyState() : previewBodyState(),
  );
  const commitPresentationBadge = createMemo(() =>
    localizedGitCommitDiffPresentationBadge(activeCommitPresentation(), i18n),
  );
  const commitPresentationDetail = createMemo(() =>
    localizedGitCommitDiffPresentationDetail(activeCommitPresentation(), i18n),
  );
  const fullContextLoading = createMemo(
    () => {
      const session = selectionSession();
      return (
        activeMode() === "full-context" &&
        session.fullRequestKey !== "" &&
        (!fullSlotMatchesSelection() ||
          (fullSlot().phase !== "ready" && fullSlot().phase !== "error"))
      );
    },
  );
  const fullContextOverlayLoading = createMemo(() => {
    const state = fullBodyState();
    return (
      fullContextLoading() &&
      state.kind === "ready" &&
      state.mode === "preview"
    );
  });
  const activeBodyLoadingMessage = createMemo(() =>
    !protocol.rpcTransport() ? i18n.t('gitDiff.waitingForConnection') : activeMode() === "full-context"
      ? i18n.t('gitDiff.loadingFullContext')
      : i18n.t('gitDiff.loadingPatch'),
  );
  const activeBodyEmptyMessage = createMemo(() =>
    activeMode() === "patch"
      ? props.emptyMessage
      : i18n.t('gitDiff.fullContextUnavailable'),
  );
  const activeErrorState = createMemo(() => {
    const state = activeBodyState();
    return state.kind === "error" ? state.error : null;
  });
  const activeReadyItem = createMemo(() => {
    const state = activeBodyState();
    return state.kind === "ready" ? state.item : null;
  });
  const activeUnavailableState = createMemo(() => {
    const state = activeBodyState();
    return state.kind === "unavailable" ? state : null;
  });
  const unavailableMessage = (item: GitDiffFileContent): string | undefined => {
    if (isDirectoryDiffPlaceholder(item))
      return i18n.t('gitDiff.directoryUnavailable');
    if (typeof props.unavailableMessage === "function")
      return props.unavailableMessage(item);
    return props.unavailableMessage;
  };

  const setModeForCurrentSelection = (nextMode: GitDiffDialogMode) => {
    setSelectedMode(nextMode);
  };

  // Both modes share request ownership. Only a ready transport can start work;
  // transport replacement invalidates results without creating a reconnect owner.
  createEffect(on(
    () => [props.open, selectionSession(), activeMode(), protocol.rpcTransport()] as const,
    ([open, session, mode, transport]) => {
      for (const contentMode of ['preview', 'full'] as const) {
        const readSlot = contentMode === 'preview' ? previewSlot : fullSlot;
        const writeSlot = contentMode === 'preview' ? setPreviewSlot : setFullSlot;
        const request = contentMode === 'preview' ? session.previewRequest : session.fullRequest;
        const requestKey = contentMode === 'preview' ? session.previewRequestKey : session.fullRequestKey;
        const selectionKey = session.selectionKey;
        if (!open || !selectionKey) {
          writeSlot(createGitDiffDialogLoadSlot());
          continue;
        }

        let slot = readSlot();
        if (slot.selectionKey !== selectionKey || slot.requestKey !== requestKey || slot.transport !== transport) {
          slot = createGitDiffDialogLoadSlot({ selectionKey, requestKey, transport, presentation: session.commitPresentation });
          writeSlot(slot);
        }
        if (slot.phase !== 'idle') continue;
        if (contentMode === 'preview' && session.seededPreviewItem) {
          writeSlot({ ...slot, phase: 'ready', item: session.seededPreviewItem });
          continue;
        }
        if (!request || !transport || (contentMode === 'full' && mode !== 'full-context')) continue;

        const pending: GitDiffDialogLoadSlot = { ...slot, phase: 'loading' };
        writeSlot(pending);
        const stillOwnsRequest = () => !disposed && props.open
          && protocol.rpcTransport() === transport
          && selectionSession().selectionKey === selectionKey
          && readSlot() === pending;
        const context: GitDiffDialogErrorFormatterContext = { mode: contentMode, source: props.source, item: props.item };
        void rpc.git.getDiffContent(request).then((response) => {
          if (!stillOwnsRequest()) return;
          writeSlot({
            ...pending,
            phase: 'ready',
            item: response.file ?? null,
            presentation: response.presentation ?? session.commitPresentation,
          });
        }).catch((error) => {
          if (!stillOwnsRequest()) return;
          writeSlot({
            ...pending,
            phase: 'error',
            error: resolveDiffErrorState(error,
              i18n.t(contentMode === 'preview' ? 'gitDiff.failedPatch' : 'gitDiff.failedFullContext'),
              context, i18n, props.errorFormatter),
          });
        });
      }
    },
  ));

  const dialogContent = () => (
    <div data-git-diff-panel class={cn("git-diff-panel flex h-full min-h-0 min-w-0 flex-col", props.class)}>
      <div class="git-diff-panel__toolbar">
        <Show when={navigation}>
          <button type="button" data-git-diff-back class="git-diff-panel__back" onClick={() => navigation?.showFiles()}
            title={i18n.t('uiCopy.git.changedFiles')} aria-label={i18n.t('uiCopy.git.changedFiles')}>
            <ArrowLeft class="h-4 w-4" aria-hidden="true" />
          </button>
        </Show>
        <div class="git-diff-panel__identity">
          <Show when={!props.loading} fallback={<GitSkeletonBlock class="h-3 w-40 max-w-full" />}>
            <Show when={props.item} fallback={<span class="text-[11px] font-medium text-muted-foreground">{i18n.t('gitDiff.title')}</span>}>
              <GitFileLabel path={props.item?.newPath || props.item?.path || props.item?.oldPath || ''} />
            </Show>
          </Show>
        </div>
        <Show when={props.item}>
          <div
            class={cn(
              "git-diff-panel__modes",
              redevenSurfaceRoleClass("segmented"),
            )}
          >
            <button
              type="button"
              class={cn(
                gitDiffModeButtonClass,
                redevenSegmentedItemClass(activeMode() === "patch"),
                activeMode() === "patch"
                  ? "text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={activeMode() === "patch"}
              onClick={() => setModeForCurrentSelection("patch")}
            >
              {i18n.t('uiCopy.git.patch')}
            </button>
            <button
              type="button"
              class={cn(
                gitDiffModeButtonClass,
                redevenSegmentedItemClass(activeMode() === "full-context"),
                activeMode() === "full-context"
                  ? "text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={activeMode() === "full-context"}
              disabled={!canLoadFullContext()}
              onClick={() => setModeForCurrentSelection("full-context")}
            >
              {i18n.t('uiCopy.git.fullContext')}
            </button>
          </div>
        </Show>
        <Show when={props.source && props.item}>
          <button type="button" class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            title={i18n.t('gitDiff.refresh')} aria-label={i18n.t('gitDiff.refresh')}
            disabled={!protocol.rpcTransport() || props.loading || activeBodyState().kind === 'loading' || fullContextLoading()}
            onClick={() => setRefreshRevision((revision) => revision + 1)}>
            <Refresh class="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </Show>
      </div>
      <Show when={commitPresentationBadge() || commitPresentationDetail()}>
        <div class="flex shrink-0 flex-wrap items-center gap-2 border-b px-2.5 py-1 text-[11px] text-muted-foreground">
          <Show when={commitPresentationBadge()}><GitMetaPill tone="violet">{commitPresentationBadge()}</GitMetaPill></Show>
          <Show when={commitPresentationDetail()}><span>{commitPresentationDetail()}</span></Show>
        </div>
      </Show>

      <div class="relative min-h-0 flex-1">
        <Switch>
          <Match when={props.loading || activeBodyState().kind === "loading" || activeBodyState().kind === "waiting"}>
            <GitStatePane loading loadingVariant="patch" loadingRows={10} message={activeBodyLoadingMessage()} class="git-diff-panel__loading" />
          </Match>
          <Match when={activeErrorState()}>
            <GitStatePane
              tone="error"
              message={activeErrorState()?.message}
              detail={activeErrorState()?.detail}
              surface
              class="min-h-0 flex-1"
            />
          </Match>

          <Match when={activeUnavailableState()}>
            <GitPatchViewer
              class="h-full min-h-0 flex-1"
              fillViewport
              showMobileHint={false}
              item={activeUnavailableState()?.item}
              emptyMessage={activeBodyEmptyMessage()}
              unavailableMessage={activeUnavailableState()?.message}
            />
          </Match>

          <Match when={activeReadyItem()}>
            <GitPatchViewer
              class="h-full min-h-0 flex-1"
              fillViewport
              showMobileHint={false}
              item={activeReadyItem()}
              emptyMessage={activeBodyEmptyMessage()}
              unavailableMessage={unavailableMessage}
            />
          </Match>

          <Match when={true}>
            <div class="git-diff-panel__empty" data-git-diff-empty role="status">
              <div class="git-diff-panel__empty-content">
                <FileText class="h-6 w-6 opacity-50" aria-hidden="true" />
                <p>{activeBodyEmptyMessage()}</p>
              </div>
            </div>
          </Match>
        </Switch>

        <Show
          when={fullContextOverlayLoading()}
        >
          <GitStatePane
            loading
            loadingVariant="patch"
            loadingRows={10}
            message={activeBodyLoadingMessage()}
            class="absolute inset-0 z-10 h-full rounded-md bg-background/44 backdrop-blur-[1px]"
            surface
          />
        </Show>
      </div>
    </div>
  );

  return dialogContent();
}
