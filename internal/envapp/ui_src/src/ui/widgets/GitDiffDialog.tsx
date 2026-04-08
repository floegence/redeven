import {
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
} from "solid-js";
import { cn, useLayout } from "@floegence/floe-webapp-core";
import { Dialog } from "@floegence/floe-webapp-core/ui";
import {
  useRedevenRpc,
  type GitCommitDiffPresentation,
  type GitDiffFileContent,
  type GitGetDiffContentRequest,
} from "../protocol/redeven_v1";
import {
  gitCommitDiffPresentationBadge,
  gitCommitDiffPresentationDetail,
  seedGitDiffContent,
  type GitSeededCommitFileSummary,
  type GitSeededWorkspaceChange,
} from "../utils/gitWorkbench";
import {
  redevenSegmentedItemClass,
  redevenSurfaceRoleClass,
} from "../utils/redevenSurfaceRoles";
import { GitPatchViewer } from "./GitPatchViewer";
import { PreviewWindow } from "./PreviewWindow";
import { GitMetaPill, GitStatePane } from "./GitWorkbenchPrimitives";

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
type GitDiffDialogModeState = {
  token: string;
  value: GitDiffDialogMode;
};

type GitDiffDialogLoadSlot = {
  selectionKey: string;
  requestKey: string;
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
      kind: "loading";
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

export interface GitDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: GitDiffDialogItem | null | undefined;
  source?: GitDiffDialogSource | null;
  title?: string;
  description?: string;
  emptyMessage: string;
  unavailableMessage?:
    | string
    | ((item: GitDiffFileContent) => string | undefined);
  errorFormatter?: GitDiffDialogErrorFormatter;
  desktopWindowZIndex?: number;
  class?: string;
}

const GIT_DIFF_WINDOW_DEFAULT_SIZE = { width: 1100, height: 760 };
const GIT_DIFF_WINDOW_MIN_SIZE = { width: 720, height: 520 };

function defaultDiffErrorState(
  error: unknown,
  fallbackMessage: string,
): GitDiffDialogErrorState {
  if (error instanceof Error && String(error.message ?? "").trim()) {
    return { message: String(error.message).trim() };
  }
  const raw = String(error ?? "").trim();
  return { message: raw || fallbackMessage };
}

function resolveDiffErrorState(
  error: unknown,
  fallbackMessage: string,
  context: GitDiffDialogErrorFormatterContext,
  formatter?: GitDiffDialogErrorFormatter,
): GitDiffDialogErrorState {
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
  return defaultDiffErrorState(error, fallbackMessage);
}

function normalizeDiffPathCandidate(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
  const repoRootPath = String(source?.repoRootPath ?? "").trim();
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

function createGitDiffDialogLoadSlot(
  selectionKey = "",
  requestKey = "",
  phase: GitDiffDialogLoadPhase = "idle",
  item: GitDiffFileContent | null = null,
  error: GitDiffDialogErrorState | null = null,
  presentation: GitCommitDiffPresentation | null = null,
): GitDiffDialogLoadSlot {
  return {
    selectionKey,
    requestKey,
    phase,
    item,
    error,
    presentation,
  };
}

function createLoadingGitDiffDialogLoadSlot(
  selectionKey: string,
  requestKey: string,
  presentation?: GitCommitDiffPresentation | null,
): GitDiffDialogLoadSlot {
  return createGitDiffDialogLoadSlot(
    selectionKey,
    requestKey,
    "loading",
    null,
    null,
    presentation ?? null,
  );
}

function createIdleGitDiffDialogLoadSlot(
  selectionKey: string,
  requestKey: string,
  presentation?: GitCommitDiffPresentation | null,
): GitDiffDialogLoadSlot {
  return createGitDiffDialogLoadSlot(
    selectionKey,
    requestKey,
    "idle",
    null,
    null,
    presentation ?? null,
  );
}

function createReadyGitDiffDialogLoadSlot(
  selectionKey: string,
  requestKey: string,
  item: GitDiffFileContent | null,
  presentation?: GitCommitDiffPresentation | null,
): GitDiffDialogLoadSlot {
  return createGitDiffDialogLoadSlot(
    selectionKey,
    requestKey,
    item ? "ready" : "idle",
    item,
    null,
    presentation ?? null,
  );
}

function createErrorGitDiffDialogLoadSlot(
  selectionKey: string,
  requestKey: string,
  error: GitDiffDialogErrorState,
  presentation?: GitCommitDiffPresentation | null,
): GitDiffDialogLoadSlot {
  return createGitDiffDialogLoadSlot(
    selectionKey,
    requestKey,
    "error",
    null,
    error,
    presentation ?? null,
  );
}

export function GitDiffDialog(props: GitDiffDialogProps) {
  const layout = useLayout();
  const rpc = useRedevenRpc();
  const [modeState, setModeState] = createSignal<GitDiffDialogModeState>({
    token: "",
    value: "patch",
  });
  const [dialogCycle, setDialogCycle] = createSignal(0);
  const [previewSlot, setPreviewSlot] = createSignal<GitDiffDialogLoadSlot>(
    createGitDiffDialogLoadSlot(),
  );
  const [fullSlot, setFullSlot] = createSignal<GitDiffDialogLoadSlot>(
    createGitDiffDialogLoadSlot(),
  );

  let previewReqSeq = 0;
  let fullReqSeq = 0;

  const selectionSession = createMemo<GitDiffDialogSelectionSession>(() => {
    const selectionKey = buildGitDiffDialogSelectionKey(props.source, props.item);
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
      seededPreviewItem: seedGitDiffContent(props.item),
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
  const activeModeToken = createMemo(() => {
    if (!props.open) return "";
    const selectionKey = selectionSession().selectionKey;
    if (!selectionKey) return "";
    return `${dialogCycle()}:${selectionKey}`;
  });
  const activeMode = createMemo<GitDiffDialogMode>(() => {
    const currentToken = activeModeToken();
    if (!currentToken) return "patch";
    const state = modeState();
    return state.token === currentToken ? state.value : "patch";
  });
  const previewSlotMatchesSelection = createMemo(
    () => previewSlot().selectionKey === selectionSession().selectionKey,
  );
  const fullSlotMatchesSelection = createMemo(
    () => fullSlot().selectionKey === selectionSession().selectionKey,
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
        message: "Diff preview is unavailable for directory entries.",
      };
    }
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
        kind: "loading",
        mode: "preview",
      };
    }
    if (session.unavailableItem) {
      return {
        kind: "unavailable",
        mode: "preview",
        item: session.unavailableItem,
        message: "Patch preview is unavailable for this file.",
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
        message: "Diff preview is unavailable for directory entries.",
      };
    }
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
        kind: "loading",
        mode: "full",
      };
    }
    if (session.unavailableItem) {
      return {
        kind: "unavailable",
        mode: "full",
        item: session.unavailableItem,
        message: "Full-context diff is unavailable for this file.",
      };
    }
    return { kind: "empty" };
  });
  const activeBodyState = createMemo(() =>
    activeMode() === "full-context" ? fullBodyState() : previewBodyState(),
  );
  const commitPresentationBadge = createMemo(() =>
    gitCommitDiffPresentationBadge(activeCommitPresentation()),
  );
  const commitPresentationDetail = createMemo(() =>
    gitCommitDiffPresentationDetail(activeCommitPresentation()),
  );
  const title = createMemo(() => props.title ?? "Diff");
  const useDesktopFloatingWindow = createMemo(
    () =>
      typeof props.desktopWindowZIndex === "number" &&
      Number.isFinite(props.desktopWindowZIndex) &&
      !layout.isMobile(),
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
    activeMode() === "full-context"
      ? "Loading full-context diff..."
      : "Loading patch preview...",
  );
  const headerHintMessage = createMemo(() => {
    if (selectionSession().directoryUnavailableItem) {
      return "Directory entries do not expose a single-file diff preview.";
    }
    if (activeMode() === "full-context") {
      return fullContextLoading()
        ? "Loading full context..."
        : "Includes unchanged lines for broader review context.";
    }
    return previewBodyState().kind === "loading"
      ? "Loading patch preview..."
      : "Loads a single-file patch on demand.";
  });
  const activeBodyEmptyMessage = createMemo(() =>
    activeMode() === "patch"
      ? props.emptyMessage
      : "Full-context diff is unavailable for this file.",
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
      return "Diff preview is unavailable for directory entries.";
    if (typeof props.unavailableMessage === "function")
      return props.unavailableMessage(item);
    return props.unavailableMessage;
  };

  createEffect(
    on(
      () => props.open,
      (open, wasOpen) => {
        if (!open && wasOpen) {
          setDialogCycle((value) => value + 1);
        }
      },
      { defer: true },
    ),
  );

  const setModeForCurrentSelection = (nextMode: GitDiffDialogMode) => {
    setModeState({
      token: activeModeToken(),
      value: nextMode,
    });
  };

  createEffect(
    on(
      () => {
        const session = selectionSession();
        return [props.open, session.selectionKey, session.previewRequestKey] as const;
      },
      ([open, selectionKey, previewRequestKey]) => {
        const session = selectionSession();
        previewReqSeq += 1;

        if (!open || !selectionKey) {
          setPreviewSlot(createGitDiffDialogLoadSlot());
          return;
        }
        if (session.seededPreviewItem) {
          setPreviewSlot(
            createReadyGitDiffDialogLoadSlot(
              selectionKey,
              previewRequestKey,
              session.seededPreviewItem,
              session.commitPresentation,
            ),
          );
          return;
        }
        if (!session.previewRequest || !previewRequestKey) {
          setPreviewSlot(
            createIdleGitDiffDialogLoadSlot(
              selectionKey,
              previewRequestKey,
              session.commitPresentation,
            ),
          );
          return;
        }

        const seq = previewReqSeq;
        setPreviewSlot(
          createLoadingGitDiffDialogLoadSlot(
            selectionKey,
            previewRequestKey,
            session.commitPresentation,
          ),
        );

        void rpc.git
          .getDiffContent(session.previewRequest)
          .then((resp) => {
            const currentSession = selectionSession();
            if (
              seq !== previewReqSeq ||
              !props.open ||
              currentSession.selectionKey !== selectionKey ||
              currentSession.previewRequestKey !== previewRequestKey
            )
              return;
            setPreviewSlot(
              createReadyGitDiffDialogLoadSlot(
                selectionKey,
                previewRequestKey,
                resp.file ?? null,
                resp?.presentation ?? currentSession.commitPresentation,
              ),
            );
          })
          .catch((err) => {
            const currentSession = selectionSession();
            if (
              seq !== previewReqSeq ||
              !props.open ||
              currentSession.selectionKey !== selectionKey ||
              currentSession.previewRequestKey !== previewRequestKey
            )
              return;
            setPreviewSlot(
              createErrorGitDiffDialogLoadSlot(
                selectionKey,
                previewRequestKey,
                resolveDiffErrorState(
                  err,
                  "Failed to load patch preview.",
                  {
                    mode: "preview",
                    source: props.source,
                    item: props.item,
                  },
                  props.errorFormatter,
                ),
                currentSession.commitPresentation,
              ),
            );
          });
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      () => {
        const session = selectionSession();
        return [
          props.open,
          activeMode(),
          session.selectionKey,
          session.fullRequestKey,
        ] as const;
      },
      ([open, nextMode, selectionKey, fullRequestKey]) => {
        const session = selectionSession();
        const slot = fullSlot();
        const slotMatchesRequest =
          slot.selectionKey === selectionKey &&
          slot.requestKey === fullRequestKey;

        if (!open || !selectionKey) {
          fullReqSeq += 1;
          setFullSlot(createGitDiffDialogLoadSlot());
          return;
        }
        if (!session.fullRequest || !fullRequestKey) {
          fullReqSeq += 1;
          setFullSlot(
            createIdleGitDiffDialogLoadSlot(
              selectionKey,
              fullRequestKey,
              session.commitPresentation,
            ),
          );
          return;
        }
        if (nextMode !== "full-context") {
          if (!slotMatchesRequest) {
            fullReqSeq += 1;
            setFullSlot(
              createIdleGitDiffDialogLoadSlot(
                selectionKey,
                fullRequestKey,
                session.commitPresentation,
              ),
            );
          }
          return;
        }
        if (slotMatchesRequest && (slot.phase === "ready" || slot.phase === "loading")) {
          return;
        }

        fullReqSeq += 1;
        const seq = fullReqSeq;
        setFullSlot(
          createLoadingGitDiffDialogLoadSlot(
            selectionKey,
            fullRequestKey,
            session.commitPresentation,
          ),
        );

        void rpc.git
          .getDiffContent(session.fullRequest)
          .then((resp) => {
            const currentSession = selectionSession();
            if (
              seq !== fullReqSeq ||
              !props.open ||
              currentSession.selectionKey !== selectionKey ||
              currentSession.fullRequestKey !== fullRequestKey
            )
              return;
            setFullSlot(
              createReadyGitDiffDialogLoadSlot(
                selectionKey,
                fullRequestKey,
                resp.file ?? null,
                resp?.presentation ?? currentSession.commitPresentation,
              ),
            );
          })
          .catch((err) => {
            const currentSession = selectionSession();
            if (
              seq !== fullReqSeq ||
              !props.open ||
              currentSession.selectionKey !== selectionKey ||
              currentSession.fullRequestKey !== fullRequestKey
            )
              return;
            setFullSlot(
              createErrorGitDiffDialogLoadSlot(
                selectionKey,
                fullRequestKey,
                resolveDiffErrorState(
                  err,
                  "Failed to load full-context diff.",
                  {
                    mode: "full",
                    source: props.source,
                    item: props.item,
                  },
                  props.errorFormatter,
                ),
                currentSession.commitPresentation,
              ),
            );
          });
      },
      { defer: true },
    ),
  );

  const dialogContent = () => (
    <div class="flex h-full min-h-0 flex-col">
      <Show when={useDesktopFloatingWindow() && props.description}>
        <div class="shrink-0 pb-2 text-xs text-muted-foreground">
          {props.description}
        </div>
      </Show>

      <div class="flex shrink-0 flex-col gap-2 pb-2 sm:flex-row sm:items-start sm:justify-between">
        <div
          class={cn(
            "inline-flex items-center gap-1 rounded-md border p-1",
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
            Patch
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
            Full Context
          </button>
        </div>

        <div class="flex min-w-0 flex-col items-start gap-1 sm:items-end sm:text-right">
          <Show when={commitPresentationBadge()}>
            <div class="flex flex-wrap items-center gap-1 sm:justify-end">
              <GitMetaPill tone="violet">
                {commitPresentationBadge()}
              </GitMetaPill>
            </div>
          </Show>
          <Show when={commitPresentationDetail()}>
            <div class="text-[11px] text-muted-foreground">
              {commitPresentationDetail()}
            </div>
          </Show>
          <div class="text-[11px] text-muted-foreground">
            {headerHintMessage()}
          </div>
        </div>
      </div>

      <div class="relative min-h-0 flex-1">
        <Switch>
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
              class="min-h-0 flex-1"
              item={activeUnavailableState()?.item}
              emptyMessage={activeBodyEmptyMessage()}
              unavailableMessage={activeUnavailableState()?.message}
            />
          </Match>

          <Match when={activeReadyItem()}>
            <GitPatchViewer
              class="min-h-0 flex-1"
              item={activeReadyItem()}
              emptyMessage={activeBodyEmptyMessage()}
              unavailableMessage={unavailableMessage}
            />
          </Match>

          <Match when={activeBodyState().kind === "loading"}>
            <GitStatePane
              loading
              message={activeBodyLoadingMessage()}
              surface
              class="min-h-0 flex-1"
            />
          </Match>

          <Match when={true}>
            <GitStatePane
              message={activeBodyEmptyMessage()}
              surface
              class="min-h-0 flex-1"
            />
          </Match>
        </Switch>

        <Show
          when={fullContextOverlayLoading()}
        >
          <GitStatePane
            loading
            message={activeBodyLoadingMessage()}
            class="absolute inset-0 z-10 h-full rounded-md bg-background/44 backdrop-blur-[1px]"
            contentClass={cn(
              "rounded-md border px-4 py-3 shadow-sm",
              redevenSurfaceRoleClass("overlay"),
            )}
          />
        </Show>
      </div>
    </div>
  );

  return (
    <Show
      when={useDesktopFloatingWindow()}
      fallback={
        <Dialog
          open={props.open}
          onOpenChange={props.onOpenChange}
          title={title()}
          description={props.description}
          class={cn(
            "flex max-w-none flex-col overflow-hidden rounded-md p-0",
            "[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2",
            "[&>div:last-child]:min-h-0 [&>div:last-child]:flex-1 [&>div:last-child]:overflow-hidden [&>div:last-child]:pt-2",
            layout.isMobile()
              ? "h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none"
              : "max-h-[88vh] w-[min(1100px,94vw)]",
            props.class,
          )}
        >
          {dialogContent()}
        </Dialog>
      }
    >
      <PreviewWindow
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={title()}
        description={props.description}
        persistenceKey="git-diff-dialog"
        defaultSize={GIT_DIFF_WINDOW_DEFAULT_SIZE}
        minSize={GIT_DIFF_WINDOW_MIN_SIZE}
        zIndex={props.desktopWindowZIndex}
        floatingClass="bg-background"
        mobileClass="bg-background"
      >
        {dialogContent()}
      </PreviewWindow>
    </Show>
  );
}
