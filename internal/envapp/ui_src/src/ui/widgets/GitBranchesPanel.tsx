import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
  type JSX,
} from "solid-js";
import { cn, useLayout, useNotification } from "@floegence/floe-webapp-core";
import {
  ChevronRight,
  Folder,
  MoreHorizontal,
  Terminal,
} from "@floegence/floe-webapp-core/icons";
import { Button, Dialog, Dropdown, type DropdownItem } from "@floegence/floe-webapp-core/ui";
import { FlowerIcon } from "../icons/FlowerIcon";
import {
  useRedevenRpc,
  type GitBranchSummary,
  type GitCommitDiffPresentation,
  type GitCommitFileSummary,
  type GitCommitSummary,
  type GitGetBranchCompareResponse,
  type GitListBranchesResponse,
  type GitListWorkspaceChangesResponse,
  type GitListWorkspacePageResponse,
  type GitPreviewDeleteBranchResponse,
  type GitPreviewMergeBranchResponse,
  type GitRepoSummaryResponse,
  type GitWorkspaceChange,
  type GitWorkspaceSection,
} from "../protocol/redeven_v1";
import {
  WORKSPACE_VIEW_SECTIONS,
  applyWorkspaceViewPageSnapshot,
  allGitBranches,
  branchContextSummary,
  branchDisplayName,
  branchIdentity,
  branchStatusSummary,
  branchSubviewLabel,
  changeSecondaryPath,
  createEmptyWorkspaceViewPageStateRecord,
  describeGitHead,
  detachedHeadCheckoutActionLabel,
  detachedHeadReattachSummary,
  detachedHeadViewingSummary,
  EMPTY_BRANCH_CONTEXT_SUMMARY,
  gitCommitDiffPresentationBadge,
  gitCommitDiffPresentationDetail,
  gitDiffEntryIdentity,
  isGitWorkspaceDirectoryEntry,
  pickDefaultWorkspaceViewSectionFromSummary,
  reattachBranchFromRepoSummary,
  shortGitHash,
  workspaceEntryKey,
  workspaceDirectoryPath,
  workspacePageItems,
  workspaceSectionLabel,
  type GitBranchDetailPresentationState,
  type GitWorkspaceViewPageState,
  workspaceViewSectionCount,
  workspaceViewSectionLabel,
  resolveGitBranchWorktreePath,
  type GitStashWindowRequest,
  type GitBranchSubview,
  type GitDetachedSwitchTarget,
  type GitWorkspaceViewSection,
} from "../utils/gitWorkbench";
import { resolveRovingTabTargetId } from "../utils/tabNavigation";
import {
  redevenDividerRoleClass,
  redevenSegmentedItemClass,
  redevenSurfaceRoleClass,
} from "../utils/redevenSurfaceRoles";
import {
  buildGitDirectoryShortcutRequest,
  type GitAskFlowerRequest,
  type GitDirectoryShortcutRequest,
} from "../utils/gitBrowserShortcuts";
import {
  gitBranchTone,
  gitChangePathClass,
  gitToneActionButtonClass,
  gitToneDotClass,
} from "./GitChrome";
import { GitChangesBreadcrumb } from "./GitChangesBreadcrumb";
import { GitDiffDialog } from "./GitDiffDialog";
import { GitVirtualTable } from "./GitVirtualTable";
import { GIT_WORKBENCH_SCROLL_REGION_PROPS } from "./gitWorkbenchScrollRegion";
import {
  GIT_CHANGED_FILES_CELL_CLASS,
  GIT_CHANGED_FILES_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_HEADER_ROW_CLASS,
  GIT_CHANGED_FILES_SECONDARY_PATH_CLASS,
  GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_TABLE_CLASS,
  GitChangedFilesActionButton,
  GitChangeMetrics,
  GitChangeStatusPill,
  GitLabelBlock,
  GitInlineLoadingStatus,
  GitMetaPill,
  GitPagedTableFooter,
  GitPrimaryTitle,
  GitShortcutOrbButton,
  GitShortcutOrbDock,
  GitStatePane,
  GitSubtleNote,
  GitTableFrame,
  type GitShortcutOrbTone,
  gitChangedFilesRowClass,
  gitChangedFilesStickyCellClass,
} from "./GitWorkbenchPrimitives";
import {
  GitDeleteBranchDialog,
  type GitDeleteBranchDialogConfirmOptions,
  type GitDeleteBranchDialogState,
} from "./GitDeleteBranchDialog";
import {
  GitMergeBranchDialog,
  type GitMergeBranchDialogConfirmOptions,
  type GitMergeBranchDialogState,
} from "./GitMergeBranchDialog";
import {
  resolveGitBranchHeaderLayout,
  type GitBranchHeaderLayout,
} from "./gitBranchHeaderLayout";
import { useI18n } from "../i18n";

const BRANCH_STATUS_PAGE_SIZE = 200;

export interface GitBranchesPanelProps {
  repoRootPath?: string;
  repoSummary?: GitRepoSummaryResponse | null;
  statusRefreshToken?: number;
  selectedBranch?: GitBranchSummary | null;
  branchDetailState?: GitBranchDetailPresentationState;
  selectedBranchSubview?: GitBranchSubview;
  onSelectBranchSubview?: (view: GitBranchSubview) => void;
  onRefreshSelectedBranch?: () => void;
  onSelectCurrentBranch?: () => void;
  onBranchDetailLoadFailure?: () => void;
  branches?: GitListBranchesResponse | null;
  branchesLoading?: boolean;
  branchesError?: string;
  commits?: GitCommitSummary[];
  listLoading?: boolean;
  listRefreshing?: boolean;
  listLoadingMore?: boolean;
  listError?: string;
  hasMore?: boolean;
  selectedCommitHash?: string;
  onSelectCommit?: (hash: string) => void;
  onLoadMore?: () => void;
  switchDetachedBusy?: boolean;
  checkoutBusy?: boolean;
  mergeBusy?: boolean;
  deleteBusy?: boolean;
  mergeReviewOpen?: boolean;
  mergeReviewBranch?: GitBranchSummary | null;
  mergePreview?: GitPreviewMergeBranchResponse | null;
  mergePreviewError?: string;
  mergeActionError?: string;
  mergeDialogState?: GitMergeBranchDialogState;
  deleteReviewOpen?: boolean;
  deleteReviewBranch?: GitBranchSummary | null;
  deletePreview?: GitPreviewDeleteBranchResponse | null;
  deletePreviewError?: string;
  deleteActionError?: string;
  deleteDialogState?: GitDeleteBranchDialogState;
  onCheckoutBranch?: (branch: GitBranchSummary) => void;
  onMergeBranch?: (branch: GitBranchSummary) => void;
  onDeleteBranch?: (branch: GitBranchSummary) => void;
  onSwitchDetached?: (target: GitDetachedSwitchTarget) => void;
  onCloseMergeReview?: () => void;
  onRetryMergePreview?: (branch: GitBranchSummary) => void;
  onConfirmMergeBranch?: (
    branch: GitBranchSummary,
    options: GitMergeBranchDialogConfirmOptions,
  ) => void;
  onOpenStash?: (request: GitStashWindowRequest) => void;
  onCloseDeleteReview?: () => void;
  onRetryDeletePreview?: (branch: GitBranchSummary) => void;
  onConfirmDeleteBranch?: (
    branch: GitBranchSummary,
    options: GitDeleteBranchDialogConfirmOptions,
  ) => void;
  onAskFlower?: (
    request: Extract<GitAskFlowerRequest, { kind: "branch_status" | "commit" }>,
  ) => void;
  onOpenInTerminal?: (request: GitDirectoryShortcutRequest) => void;
  onBrowseFiles?: (
    request: GitDirectoryShortcutRequest,
  ) => void | Promise<void>;
  renderReviewDialogs?: boolean;
}

function formatAbsoluteTime(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString();
}

function compareFilePath(item: GitCommitFileSummary): string {
  return (
    String(
      item.displayPath || item.path || item.newPath || item.oldPath || "",
    ).trim() || "(unknown path)"
  );
}

function worktreeFilePath(item: GitWorkspaceChange): string {
  return (
    String(
      item.displayPath || item.path || item.newPath || item.oldPath || "",
    ).trim() || "(unknown path)"
  );
}

function branchStatusPrimaryLabel(item: GitWorkspaceChange): string {
  const pathValue = isGitWorkspaceDirectoryEntry(item)
    ? workspaceDirectoryPath(item)
    : worktreeFilePath(item);
  const parts = pathValue.split("/").filter(Boolean);
  return parts[parts.length - 1] || pathValue || "(unknown path)";
}

function branchStatusDirectorySummary(item: GitWorkspaceChange): string {
  const count = Number(item.descendantFileCount ?? 0);
  return count === 1 ? "1 file" : `${count} files`;
}

function branchStatusEmptyMessage(
  section: GitWorkspaceViewSection,
  directoryPath = "",
): string {
  if (section === "changes" && directoryPath) {
    return "No pending files are available in this folder.";
  }
  switch (section) {
    case "staged":
      return "No staged files are available in this worktree.";
    case "conflicted":
      return "No conflicted files are available in this worktree.";
    case "changes":
    default:
      return "No pending files are available in this worktree.";
  }
}

function branchStatusSummaryLabel(section: GitWorkspaceViewSection): string {
  if (section === "conflicted") return "Conflicts";
  return workspaceViewSectionLabel(section);
}

function compareOptionLabel(branch: GitBranchSummary): string {
  const name = branchDisplayName(branch);
  if (branch.kind === "remote") return `${name} · remote`;
  if (branch.current) return `${name} · current`;
  return name;
}

function defaultCompareTarget(
  branches: GitListBranchesResponse | null | undefined,
  sourceRef: string,
): string {
  const items = allGitBranches(branches);
  const names = items
    .map((branch) => String(branch.name ?? "").trim())
    .filter(Boolean);
  const exactMain = names.find((name) => name === "main");
  if (exactMain) return exactMain;
  const remoteMain = names.find((name) => name.endsWith("/main"));
  if (remoteMain) return remoteMain;
  const current = (branches?.local ?? []).find(
    (branch) =>
      branch.current && String(branch.name ?? "").trim() !== sourceRef,
  );
  if (current?.name) return current.name;
  const firstDifferent = names.find((name) => name !== sourceRef);
  if (firstDifferent) return firstDifferent;
  return names[0] ?? "main";
}

const GIT_BRANCH_SUBVIEW_IDS = [
  "status",
  "history",
] as const satisfies readonly GitBranchSubview[];

type BranchSummaryPresentation = {
  text: string;
  title: string;
  visible: boolean;
};

type BranchPrimaryActionPresentation = {
  key: string;
  label: string;
  emphasis: "neutral" | "accent" | "danger";
  disabled: boolean;
  disabledReason?: string;
  busy?: boolean;
  onPress: () => void;
};

type BranchShortcutPresentation = {
  key: string;
  label: string;
  tone: GitShortcutOrbTone;
  icon: Component<{ class?: string }>;
  disabled: boolean;
  disabledReason?: string;
  onPress: () => void;
};

type BranchHeaderActionPresentation =
  | (BranchPrimaryActionPresentation & { kind: "primary" })
  | (BranchShortcutPresentation & { kind: "shortcut" });

type BranchHeaderControlGroups = {
  primaryActions: BranchPrimaryActionPresentation[];
  secondaryShortcuts: BranchShortcutPresentation[];
};

type BranchStatusSectionPresentation = {
  section: GitWorkspaceViewSection;
  label: string;
  compactLabel: string;
  shortLabel: string;
  count: number;
  active: boolean;
  compactCaption: string;
  verboseCaption: string;
};

function gitBranchSubviewTabId(view: GitBranchSubview): string {
  return `git-branch-subview-tab-${view}`;
}

function gitBranchSubviewPanelId(view: GitBranchSubview): string {
  return `git-branch-subview-panel-${view}`;
}

function branchStatusEmptyState(
  branch: GitBranchSummary | null | undefined,
  statusRepoRootPath: string,
): {
  title: string;
  detail: string;
  hint?: string;
  tone: "neutral" | "info" | "violet";
} {
  if (!branch) {
    return {
      title: "No branch selected",
      detail:
        "Choose a branch from the sidebar to inspect its status or history.",
      tone: "neutral",
    };
  }
  if (branch.kind === "remote") {
    return {
      title: "Remote branch is not checked out",
      detail: "Status is only available for checked-out local worktrees.",
      hint: "Use Compare to inspect file diffs, or check out this branch locally to review workspace changes.",
      tone: "violet",
    };
  }
  if (statusRepoRootPath) {
    return {
      title: "Branch status is unavailable",
      detail:
        "The checked-out workspace for this branch could not be resolved right now.",
      hint: "Refresh the repository view or reopen the worktree to load the latest workspace status.",
      tone: "info",
    };
  }
  return {
    title: "Branch is not checked out",
    detail: "Status is only available for checked-out local worktrees.",
    hint: "Use Compare to inspect file diffs, or open this branch in a worktree to review workspace changes.",
    tone: "info",
  };
}

interface BranchCompareFilesTableProps {
  layout?: GitBranchHeaderLayout;
  surface?: "framed" | "inline";
  items: GitCommitFileSummary[];
  selectedKey?: string;
  onOpenDiff?: (item: GitCommitFileSummary) => void;
}

function BranchCompareFilesCompactList(
  props: Pick<
    BranchCompareFilesTableProps,
    "items" | "selectedKey" | "onOpenDiff"
  >,
) {
  return (
    <div
      {...GIT_WORKBENCH_SCROLL_REGION_PROPS}
      role="list"
      class="min-h-0 flex-1 overflow-auto divide-y divide-border/45"
      data-git-branch-commit-files-list-layout="compact"
    >
      <For each={props.items}>
        {(item) => {
          const active = () => props.selectedKey === gitDiffEntryIdentity(item);
          const primaryPath = () => compareFilePath(item);
          const secondaryPath = () => changeSecondaryPath(item);
          return (
            <button
              type="button"
              role="listitem"
              aria-selected={active()}
              class={cn(
                "grid w-full cursor-pointer gap-1.5 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1",
                active() && "git-browser-selection-row",
              )}
              onClick={() => props.onOpenDiff?.(item)}
            >
              <div class="flex min-w-0 items-start justify-between gap-2">
                <div class="min-w-0">
                  <div
                    class={`truncate text-xs font-medium ${gitChangePathClass(item.changeType)}`}
                    title={primaryPath()}
                  >
                    {primaryPath()}
                  </div>
                  <Show when={secondaryPath() !== primaryPath()}>
                    <div
                      class="mt-0.5 truncate text-[10px] text-muted-foreground"
                      title={secondaryPath()}
                    >
                      {secondaryPath()}
                    </div>
                  </Show>
                </div>
                <span class="shrink-0 rounded-md bg-background/70 px-2 py-1 text-[10px] font-medium text-muted-foreground">
                  View
                </span>
              </div>
              <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                <GitChangeStatusPill change={item.changeType} />
                <GitChangeMetrics
                  additions={item.additions}
                  deletions={item.deletions}
                />
              </div>
            </button>
          );
        }}
      </For>
    </div>
  );
}

function BranchCompareFilesTable(props: BranchCompareFilesTableProps) {
  const content = () => (
      <Show
        when={props.items.length > 0}
        fallback={
          <div class={cn("px-4 py-8", props.surface === "inline" && "px-0 py-3")}>
            <GitSubtleNote>
              No changed files were found in this comparison.
            </GitSubtleNote>
          </div>
        }
      >
        <Show
          when={props.layout === "compact"}
          fallback={
            <GitVirtualTable
              items={props.items}
              viewportClass={props.surface === "inline" ? "git-branch-history-files__viewport" : undefined}
              tableClass={cn(
                GIT_CHANGED_FILES_TABLE_CLASS,
                "min-w-[34rem] sm:min-w-[46rem] md:min-w-0",
                props.surface === "inline" && "git-branch-history-files__table",
              )}
              header={
                <tr class={GIT_CHANGED_FILES_HEADER_ROW_CLASS}>
                  <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Path</th>
                  <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Status</th>
                  <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Changes</th>
                  <th class={GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS}>Action</th>
                </tr>
              }
              renderRow={(item) => {
                const active = () =>
                  props.selectedKey === gitDiffEntryIdentity(item);
                return (
                  <tr
                    aria-selected={active()}
                    class={gitChangedFilesRowClass(active())}
                  >
                    <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                      <div class="min-w-0">
                        <button
                          type="button"
                          class={`block max-w-full cursor-pointer truncate text-left text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${gitChangePathClass(item.changeType)}`}
                          title={changeSecondaryPath(item)}
                          onClick={() => props.onOpenDiff?.(item)}
                        >
                          {compareFilePath(item)}
                        </button>
                        <Show
                          when={changeSecondaryPath(item) !== compareFilePath(item)}
                        >
                          <div
                            class={GIT_CHANGED_FILES_SECONDARY_PATH_CLASS}
                            title={changeSecondaryPath(item)}
                          >
                            {changeSecondaryPath(item)}
                          </div>
                        </Show>
                      </div>
                    </td>
                    <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                      <GitChangeStatusPill change={item.changeType} />
                    </td>
                    <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                      <GitChangeMetrics
                        additions={item.additions}
                        deletions={item.deletions}
                      />
                    </td>
                    <td class={gitChangedFilesStickyCellClass(active())}>
                      <GitChangedFilesActionButton
                        onClick={() => props.onOpenDiff?.(item)}
                      >
                        View Diff
                      </GitChangedFilesActionButton>
                    </td>
                  </tr>
                );
              }}
            />
          }
        >
          <BranchCompareFilesCompactList
            items={props.items}
            selectedKey={props.selectedKey}
            onOpenDiff={props.onOpenDiff}
          />
        </Show>
      </Show>
  );

  return props.surface === "inline" ? (
    <div
      class="git-branch-history-files flex min-h-0 flex-1 flex-col"
      data-git-branch-commit-files-surface="inline"
    >
      {content()}
    </div>
  ) : (
    <GitTableFrame class="flex min-h-0 flex-1 flex-col">
      {content()}
    </GitTableFrame>
  );
}

interface BranchStatusTableProps {
  layout?: GitBranchHeaderLayout;
  section: GitWorkspaceViewSection;
  items: GitWorkspaceChange[];
  totalCount: number;
  scopeFileCount?: number;
  directoryPath?: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  selectedKey?: string;
  onOpenDiff?: (item: GitWorkspaceChange) => void;
  onOpenDirectory?: (directoryPath: string) => void;
  onLoadMore?: () => void;
}

function BranchStatusCompactList(
  props: Pick<
    BranchStatusTableProps,
    | "section"
    | "items"
    | "selectedKey"
    | "onOpenDiff"
    | "onOpenDirectory"
  >,
) {
  const openItem = (item: GitWorkspaceChange) => {
    if (isGitWorkspaceDirectoryEntry(item)) {
      const nextDirectoryPath = workspaceDirectoryPath(item);
      if (nextDirectoryPath) {
        props.onOpenDirectory?.(nextDirectoryPath);
      }
      return;
    }
    props.onOpenDiff?.(item);
  };

  return (
    <div
      {...GIT_WORKBENCH_SCROLL_REGION_PROPS}
      role="list"
      class="min-h-0 flex-1 overflow-auto divide-y divide-border/45"
      data-git-branch-status-list-layout="compact"
    >
      <For each={props.items}>
        {(item) => {
          const active = () => props.selectedKey === workspaceEntryKey(item);
          const primaryLabel = () =>
            isGitWorkspaceDirectoryEntry(item)
              ? branchStatusPrimaryLabel(item)
              : worktreeFilePath(item);
          const secondaryLabel = () =>
            isGitWorkspaceDirectoryEntry(item)
              ? workspaceDirectoryPath(item)
              : changeSecondaryPath(item);
          return (
            <button
              type="button"
              role="listitem"
              aria-selected={active()}
              class={cn(
                "grid w-full cursor-pointer gap-1.5 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1",
                active() && "git-browser-selection-row",
              )}
              onClick={() => openItem(item)}
            >
              <div class="flex min-w-0 items-start justify-between gap-2">
                <div class="min-w-0">
                  <div
                    class={`flex min-w-0 items-center gap-1.5 truncate text-xs font-medium ${gitChangePathClass(item.changeType)}`}
                    title={primaryLabel()}
                  >
                    <Show when={isGitWorkspaceDirectoryEntry(item)}>
                      <Folder class="size-3.5 shrink-0" />
                    </Show>
                    <span class="truncate">{primaryLabel()}</span>
                  </div>
                  <Show when={secondaryLabel() !== primaryLabel()}>
                    <div
                      class="mt-0.5 truncate text-[10px] text-muted-foreground"
                      title={secondaryLabel()}
                    >
                      {secondaryLabel()}
                    </div>
                  </Show>
                </div>
                <span class="shrink-0 rounded-md bg-background/70 px-2 py-1 text-[10px] font-medium text-muted-foreground">
                  {isGitWorkspaceDirectoryEntry(item) ? "Open" : "View"}
                </span>
              </div>
              <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                <GitMetaPill tone="neutral">
                  {isGitWorkspaceDirectoryEntry(item)
                    ? workspaceViewSectionLabel(props.section)
                    : workspaceSectionLabel(
                        (item.section as GitWorkspaceSection | undefined) ??
                          "unstaged",
                      )}
                </GitMetaPill>
                <Show
                  when={isGitWorkspaceDirectoryEntry(item)}
                  fallback={<GitChangeStatusPill change={item.changeType} />}
                >
                  <GitMetaPill tone="neutral">Folder</GitMetaPill>
                  <Show when={item.containsUnstaged}>
                    <GitMetaPill tone="warning">Unstaged</GitMetaPill>
                  </Show>
                  <Show when={item.containsUntracked}>
                    <GitMetaPill tone="brand">Untracked</GitMetaPill>
                  </Show>
                </Show>
                <Show
                  when={isGitWorkspaceDirectoryEntry(item)}
                  fallback={
                    <GitChangeMetrics
                      additions={item.additions}
                      deletions={item.deletions}
                    />
                  }
                >
                  <span class="text-[11px] font-medium text-muted-foreground">
                    {branchStatusDirectorySummary(item)}
                  </span>
                </Show>
              </div>
            </button>
          );
        }}
      </For>
    </div>
  );
}

function BranchStatusTable(props: BranchStatusTableProps) {
  const footerSummary = () => {
    const totalRows = Math.max(0, Number(props.totalCount ?? 0));
    const scopedFiles = Math.max(
      0,
      Number(props.scopeFileCount ?? props.totalCount ?? 0),
    );
    if (props.section === "changes" && scopedFiles !== totalRows) {
      return (
        <>
          Showing{" "}
          <span class="font-semibold tabular-nums text-foreground/90">
            {props.items.length}
          </span>{" "}
          of{" "}
          <span class="font-semibold tabular-nums text-foreground/90">
            {totalRows}
          </span>{" "}
          rows covering{" "}
          <span class="font-semibold tabular-nums text-foreground/90">
            {scopedFiles}
          </span>{" "}
          file{scopedFiles === 1 ? "" : "s"}.
        </>
      );
    }
    return (
      <>
        Showing{" "}
        <span class="font-semibold tabular-nums text-foreground/90">
          {props.items.length}
        </span>{" "}
        of{" "}
        <span class="font-semibold tabular-nums text-foreground/90">
          {scopedFiles}
        </span>{" "}
        file{scopedFiles === 1 ? "" : "s"}.
      </>
    );
  };

  return (
    <GitTableFrame class="flex min-h-0 flex-1 flex-col">
      <Show
        when={props.items.length > 0}
        fallback={
          <div class="px-4 py-8">
            <GitSubtleNote>
              {branchStatusEmptyMessage(
                props.section,
                String(props.directoryPath ?? "").trim(),
              )}
            </GitSubtleNote>
          </div>
        }
      >
        <Show
          when={props.layout === "compact"}
          fallback={
            <GitVirtualTable
              items={props.items}
              tableClass={`${GIT_CHANGED_FILES_TABLE_CLASS} min-w-[36rem] sm:min-w-[52rem] md:min-w-0`}
              header={
                <tr class={GIT_CHANGED_FILES_HEADER_ROW_CLASS}>
                  <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Path</th>
                  <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Section</th>
                  <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Status</th>
                  <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Changes</th>
                  <th class={GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS}>Action</th>
                </tr>
              }
              renderRow={(item) => {
                const active = () => props.selectedKey === workspaceEntryKey(item);
                return (
                  <tr
                    aria-selected={active()}
                    class={`${gitChangedFilesRowClass(active())} cursor-pointer`}
                    onClick={() => {
                      if (isGitWorkspaceDirectoryEntry(item)) {
                        const nextDirectoryPath = workspaceDirectoryPath(item);
                        if (nextDirectoryPath) {
                          props.onOpenDirectory?.(nextDirectoryPath);
                        }
                        return;
                      }
                      props.onOpenDiff?.(item);
                    }}
                  >
                    <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                      <div class="min-w-0">
                        <button
                          type="button"
                          class={`block max-w-full cursor-pointer truncate text-left text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${gitChangePathClass(item.changeType)}`}
                          title={
                            isGitWorkspaceDirectoryEntry(item)
                              ? workspaceDirectoryPath(item)
                              : changeSecondaryPath(item)
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            if (isGitWorkspaceDirectoryEntry(item)) {
                              const nextDirectoryPath = workspaceDirectoryPath(item);
                              if (nextDirectoryPath) {
                                props.onOpenDirectory?.(nextDirectoryPath);
                              }
                              return;
                            }
                            props.onOpenDiff?.(item);
                          }}
                        >
                          <Show
                            when={isGitWorkspaceDirectoryEntry(item)}
                            fallback={worktreeFilePath(item)}
                          >
                            <span class="inline-flex items-center gap-1.5">
                              <Folder class="size-3.5 shrink-0" />
                              <span class="truncate">
                                {branchStatusPrimaryLabel(item)}
                              </span>
                            </span>
                          </Show>
                        </button>
                        <Show when={isGitWorkspaceDirectoryEntry(item)}>
                          <div
                            class={GIT_CHANGED_FILES_SECONDARY_PATH_CLASS}
                            title={workspaceDirectoryPath(item)}
                          >
                            {workspaceDirectoryPath(item)}
                          </div>
                        </Show>
                        <Show
                          when={
                            !isGitWorkspaceDirectoryEntry(item)
                            && changeSecondaryPath(item) !== worktreeFilePath(item)
                          }
                        >
                          <div
                            class={GIT_CHANGED_FILES_SECONDARY_PATH_CLASS}
                            title={changeSecondaryPath(item)}
                          >
                            {changeSecondaryPath(item)}
                          </div>
                        </Show>
                      </div>
                    </td>
                    <td
                      class={`${GIT_CHANGED_FILES_CELL_CLASS} text-muted-foreground`}
                    >
                      <Show
                        when={isGitWorkspaceDirectoryEntry(item)}
                        fallback={workspaceSectionLabel(
                          (item.section as GitWorkspaceSection | undefined) ??
                            "unstaged",
                        )}
                      >
                        {workspaceViewSectionLabel(props.section)}
                      </Show>
                    </td>
                    <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                      <Show
                        when={isGitWorkspaceDirectoryEntry(item)}
                        fallback={<GitChangeStatusPill change={item.changeType} />}
                      >
                        <div class="flex flex-wrap items-center gap-1.5">
                          <GitMetaPill tone="neutral">Folder</GitMetaPill>
                          <Show when={item.containsUnstaged}>
                            <GitMetaPill tone="warning">Unstaged</GitMetaPill>
                          </Show>
                          <Show when={item.containsUntracked}>
                            <GitMetaPill tone="brand">Untracked</GitMetaPill>
                          </Show>
                        </div>
                      </Show>
                    </td>
                    <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                      <Show
                        when={isGitWorkspaceDirectoryEntry(item)}
                        fallback={
                          <GitChangeMetrics
                            additions={item.additions}
                            deletions={item.deletions}
                          />
                        }
                      >
                        <div class="text-[11px] font-medium text-muted-foreground">
                          {branchStatusDirectorySummary(item)}
                        </div>
                      </Show>
                    </td>
                    <td class={gitChangedFilesStickyCellClass(active())}>
                      <GitChangedFilesActionButton
                        onClick={(event) => {
                          event.stopPropagation();
                          if (isGitWorkspaceDirectoryEntry(item)) {
                            const nextDirectoryPath = workspaceDirectoryPath(item);
                            if (nextDirectoryPath) {
                              props.onOpenDirectory?.(nextDirectoryPath);
                            }
                            return;
                          }
                          props.onOpenDiff?.(item);
                        }}
                      >
                        {isGitWorkspaceDirectoryEntry(item)
                          ? "Open Folder"
                          : "View Diff"}
                      </GitChangedFilesActionButton>
                    </td>
                  </tr>
                );
              }}
            />
          }
        >
          <BranchStatusCompactList
            section={props.section}
            items={props.items}
            selectedKey={props.selectedKey}
            onOpenDiff={props.onOpenDiff}
            onOpenDirectory={props.onOpenDirectory}
          />
        </Show>
        <Show
          when={(props.hasMore || props.loadingMore) && props.items.length > 0}
        >
          <GitPagedTableFooter
            summary={footerSummary()}
            onLoadMore={props.onLoadMore}
            hasMore={props.hasMore}
            loading={props.loadingMore}
            loadingStatus="Loading next page"
          />
        </Show>
      </Show>
    </GitTableFrame>
  );
}

type BranchHistoryCommitDetailState = {
  files: GitCommitFileSummary[];
  presentation?: GitCommitDiffPresentation;
  loading: boolean;
  error: string;
  loaded: boolean;
};

function summarizeCommitFileChanges(files: GitCommitFileSummary[]): {
  additions: number;
  deletions: number;
} {
  return files.reduce<{ additions: number; deletions: number }>(
    (acc, file) => ({
      additions: acc.additions + Number(file.additions ?? 0),
      deletions: acc.deletions + Number(file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  );
}

const BRANCH_HISTORY_REVEAL_CLOSE_MS = 220;

type BranchHistoryRevealState = "opening" | "open" | "closing";

interface BranchHistoryCommitDetailsRevealProps {
  expanded: boolean;
  children: JSX.Element;
}

function BranchHistoryCommitDetailsReveal(
  props: BranchHistoryCommitDetailsRevealProps,
) {
  const [shouldRender, setShouldRender] = createSignal(props.expanded);
  const [revealState, setRevealState] = createSignal<BranchHistoryRevealState>(
    props.expanded ? "open" : "closing",
  );
  let closeTimer: number | undefined;
  let openFrame: number | undefined;

  const clearCloseTimer = () => {
    if (closeTimer === undefined || typeof window === "undefined") return;
    window.clearTimeout(closeTimer);
    closeTimer = undefined;
  };
  const clearOpenFrame = () => {
    if (
      openFrame === undefined ||
      typeof window === "undefined" ||
      typeof window.cancelAnimationFrame !== "function"
    ) {
      return;
    }
    window.cancelAnimationFrame(openFrame);
    openFrame = undefined;
  };
  const finishClose = () => {
    if (props.expanded || revealState() !== "closing") return;
    setShouldRender(false);
    clearCloseTimer();
  };

  createEffect(() => {
    if (props.expanded) {
      clearCloseTimer();
      setShouldRender(true);
      setRevealState("opening");
      clearOpenFrame();
      if (
        typeof window === "undefined" ||
        typeof window.requestAnimationFrame !== "function"
      ) {
        setRevealState("open");
        return;
      }
      openFrame = window.requestAnimationFrame(() => {
        openFrame = undefined;
        setRevealState("open");
      });
      return;
    }

    clearOpenFrame();
    if (!shouldRender()) return;
    setRevealState("closing");
    clearCloseTimer();
    if (typeof window === "undefined") {
      finishClose();
      return;
    }
    closeTimer = window.setTimeout(finishClose, BRANCH_HISTORY_REVEAL_CLOSE_MS);
  });

  onCleanup(() => {
    clearCloseTimer();
    clearOpenFrame();
  });

  return (
    <Show when={shouldRender()}>
      <tr
        class="git-branch-history-details-row"
        data-state={revealState()}
        data-git-branch-history-details-row
      >
        <td colSpan={3} class="p-0 align-top">
          <div
            class="git-branch-history-reveal"
            data-state={revealState()}
            onTransitionEnd={(event) => {
              if (event.target !== event.currentTarget) return;
              finishClose();
            }}
          >
            <div class="git-branch-history-reveal__content">
              {props.children}
            </div>
          </div>
        </td>
      </tr>
    </Show>
  );
}

interface BranchHistoryCommitDetailsProps {
  commit: GitCommitSummary;
  detail?: BranchHistoryCommitDetailState;
  files: GitCommitFileSummary[];
  presentation?: GitCommitDiffPresentation;
  fileTotals: ReturnType<typeof summarizeCommitFileChanges>;
  layout?: GitBranchHeaderLayout;
  selectedDiffKey?: string;
  repoRootPath: string;
  branchName?: string;
  askFlowerLabel: string;
  switchDetachedBusy?: boolean;
  alreadyDetachedHere?: boolean;
  onAskFlower?: GitBranchesPanelProps["onAskFlower"];
  onSwitchDetached?: GitBranchesPanelProps["onSwitchDetached"];
  onOpenDiff?: (item: GitCommitFileSummary) => void;
}

function BranchHistoryCommitDetails(props: BranchHistoryCommitDetailsProps) {
  const presentationBadge = () =>
    gitCommitDiffPresentationBadge(props.presentation);
  const presentationDetail = () =>
    gitCommitDiffPresentationDetail(props.presentation);
  const fileCountLabel = () =>
    `${props.files.length} file${props.files.length === 1 ? "" : "s"}`;

  return (
    <div class="git-branch-history-details" data-git-branch-history-details>
      <Show
        when={props.detail && !props.detail.loading}
        fallback={
          <GitStatePane
            loading
            message="Loading changed files..."
            class="git-branch-history-state min-h-[5rem] px-1 py-2"
          />
        }
      >
        <Show
          when={!props.detail?.error}
          fallback={
            <GitStatePane
              tone="error"
              message={props.detail?.error}
              class="git-branch-history-state min-h-[5rem] px-1 py-2"
            />
          }
        >
          <Show
            when={props.files.length > 0}
            fallback={
              <div class="git-branch-history-note">
                No changed files are available for this commit.
              </div>
            }
          >
            <div class="git-branch-history-detail-stack">
              <div class="git-branch-history-summary">
                <div class="git-branch-history-summary-main">
                  <span
                    class={cn(
                      "git-branch-history-summary-dot",
                      gitToneDotClass("info"),
                    )}
                    aria-hidden="true"
                  />
                  <div class="min-w-0">
                    <div class="git-branch-history-summary-title">
                      Files in Commit
                    </div>
                    <Show when={presentationDetail()}>
                      {(detail) => (
                        <div class="git-branch-history-summary-detail">
                          {detail()}
                        </div>
                      )}
                    </Show>
                  </div>
                </div>
                <div class="git-branch-history-summary-meta">
                  <GitMetaPill tone="neutral">{fileCountLabel()}</GitMetaPill>
                  <Show when={presentationBadge()}>
                    {(badge) => (
                      <GitMetaPill tone="violet">{badge()}</GitMetaPill>
                    )}
                  </Show>
                  <div class="git-branch-history-metrics">
                    <GitChangeMetrics
                      additions={props.fileTotals.additions}
                      deletions={props.fileTotals.deletions}
                    />
                  </div>
                </div>
              </div>

              <div class="git-branch-history-actions">
                <div class="git-branch-history-action-group">
                  <Show when={props.onSwitchDetached}>
                    <Button
                      size="sm"
                      variant="outline"
                      class={cn(
                        "rounded-md bg-background/70",
                        redevenSurfaceRoleClass("control"),
                      )}
                      disabled={
                        Boolean(props.switchDetachedBusy) ||
                        Boolean(props.alreadyDetachedHere)
                      }
                      onClick={() =>
                        props.onSwitchDetached?.({
                          commitHash: props.commit.hash,
                          shortHash:
                            props.commit.shortHash ||
                            shortGitHash(props.commit.hash),
                          source: "branch_history",
                          branchName: props.branchName,
                        })
                      }
                    >
                      {props.switchDetachedBusy
                        ? "Switching..."
                        : props.alreadyDetachedHere
                          ? "Already detached here"
                          : "Switch --detach here"}
                    </Button>
                  </Show>
                  <Show when={props.onAskFlower}>
                    <GitShortcutOrbDock>
                      <GitShortcutOrbButton
                        label={props.askFlowerLabel}
                        tone="flower"
                        icon={FlowerIcon}
                        size="sm"
                        onClick={() =>
                          props.onAskFlower?.({
                            kind: "commit",
                            repoRootPath: props.repoRootPath,
                            location: "branch_history",
                            branchName: props.branchName,
                            commit: props.commit,
                            files: props.files,
                          })
                        }
                      />
                    </GitShortcutOrbDock>
                  </Show>
                </div>
                <div class="git-branch-history-hint">
                  Select a file to inspect the diff.
                </div>
              </div>

              <Show
                when={props.onSwitchDetached && props.alreadyDetachedHere}
              >
                <div class="git-branch-history-note">
                  Repository is already detached at this commit.
                </div>
              </Show>

              <BranchCompareFilesTable
                layout={props.layout}
                surface="inline"
                items={props.files}
                selectedKey={props.selectedDiffKey}
                onOpenDiff={props.onOpenDiff}
              />
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

function HistoryList(
  props: Pick<
    GitBranchesPanelProps,
    | "repoRootPath"
    | "repoSummary"
    | "selectedBranch"
    | "commits"
    | "listLoading"
    | "listRefreshing"
    | "listLoadingMore"
    | "listError"
    | "hasMore"
    | "selectedCommitHash"
    | "switchDetachedBusy"
    | "onSelectCommit"
    | "onLoadMore"
    | "onAskFlower"
    | "onSwitchDetached"
  > & {
    layout?: GitBranchHeaderLayout;
    active?: boolean;
  },
) {
  const rpc = useRedevenRpc();
  const i18n = useI18n();

  const [commitDetailsByContext, setCommitDetailsByContext] = createSignal<
    Record<string, Record<string, BranchHistoryCommitDetailState>>
  >({});
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] =
    createSignal<GitCommitFileSummary | null>(null);
  const [diffDialogCommitHash, setDiffDialogCommitHash] = createSignal("");
  const requestedCommitDetailKeys = new Set<string>();

  const expandedCommitHash = createMemo(() =>
    String(props.selectedCommitHash ?? "").trim(),
  );
  const repoRootPath = createMemo(() =>
    String(props.repoRootPath ?? "").trim(),
  );
  const headDisplay = createMemo(() => describeGitHead(props.repoSummary));
  const currentHeadCommit = createMemo(() =>
    String(props.repoSummary?.headCommit ?? "").trim(),
  );
  const historyContextKey = createMemo(() => {
    const repo = repoRootPath();
    const branchKey = String(
      props.selectedBranch?.fullName ?? props.selectedBranch?.name ?? "",
    ).trim();
    if (!repo || !branchKey) return "";
    return `${repo}|${branchKey}`;
  });
  const commitDetails = createMemo(() => {
    const contextKey = historyContextKey();
    if (!contextKey) return {};
    return commitDetailsByContext()[contextKey] ?? {};
  });
  const selectedDiffKey = () => gitDiffEntryIdentity(diffDialogItem());
  const diffDialogPresentation = createMemo(() => {
    const hash = diffDialogCommitHash();
    if (!hash) return undefined;
    return commitDetails()[hash]?.presentation;
  });

  const toggleCommit = (hash: string) => {
    props.onSelectCommit?.(expandedCommitHash() === hash ? "" : hash);
  };

  createEffect(() => {
    void historyContextKey();
    setDiffDialogItem(null);
    setDiffDialogCommitHash("");
    setDiffDialogOpen(false);
  });

  createEffect(() => {
    if (!props.active) return;
    const repo = repoRootPath();
    const hash = expandedCommitHash();
    const contextKey = historyContextKey();
    if (!repo || !hash || !contextKey) return;
    const existing = commitDetails()[hash];
    if (existing?.loading || existing?.loaded) return;
    const requestKey = `${contextKey}|${hash}`;
    if (requestedCommitDetailKeys.has(requestKey)) return;
    requestedCommitDetailKeys.add(requestKey);

    setCommitDetailsByContext((prev) => {
      const currentContext = prev[contextKey] ?? {};
      return {
        ...prev,
        [contextKey]: {
          ...currentContext,
          [hash]: { files: [], loading: true, error: "", loaded: false },
        },
      };
    });

    void rpc.git
      .getCommitDetail({ repoRootPath: repo, commit: hash })
      .then((resp) => {
        const files = Array.isArray(resp?.files) ? resp.files : [];
        setCommitDetailsByContext((prev) => {
          const currentContext = prev[contextKey] ?? {};
          return {
            ...prev,
            [contextKey]: {
              ...currentContext,
              [hash]: {
                files,
                presentation: resp?.presentation,
                loading: false,
                error: "",
                loaded: true,
              },
            },
          };
        });
      })
      .catch((err) => {
        setCommitDetailsByContext((prev) => {
          const currentContext = prev[contextKey] ?? {};
          return {
            ...prev,
            [contextKey]: {
              ...currentContext,
              [hash]: {
                files: [],
                loading: false,
                error:
                  err instanceof Error
                    ? err.message
                    : String(err ?? "Failed to load commit detail"),
                loaded: true,
              },
            },
          };
        });
      });
  });

  return (
    <>
      <div class="flex h-full min-h-0 flex-col overflow-hidden">
        <div class="flex flex-1 min-h-0 flex-col px-3 py-3 sm:px-4 sm:py-4">
          <div class="flex min-h-0 flex-1 flex-col gap-3">
            <Show
              when={props.listRefreshing && (props.commits?.length ?? 0) > 0}
            >
              <div
                class={cn(
                  "rounded-md px-2.5 py-1.5",
                  redevenSurfaceRoleClass("inset"),
                )}
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="text-[11px] text-muted-foreground">
                    Refreshing branch history in the background.
                  </div>
                  <GitMetaPill tone="neutral">Refreshing...</GitMetaPill>
                </div>
              </div>
            </Show>
            <Show
              when={!props.listLoading}
              fallback={
                <GitStatePane
                  loading
                  message="Loading commit history..."
                  class="px-1"
                />
              }
            >
              <Show
                when={!props.listError}
                fallback={
                  <GitStatePane
                    tone="error"
                    message={props.listError}
                    class="px-1"
                  />
                }
              >
                <div class="flex min-h-0 flex-1 overflow-hidden">
                  <Show
                    when={(props.commits?.length ?? 0) > 0}
                    fallback={
                      <GitSubtleNote>
                        No commit history is available for this branch.
                      </GitSubtleNote>
                    }
                  >
                    <GitTableFrame class="flex min-h-0 flex-1 flex-col">
                      <div {...GIT_WORKBENCH_SCROLL_REGION_PROPS} class="min-h-0 flex-1 overflow-auto">
                        <table class="w-full min-w-[30rem] text-xs xl:min-w-0">
                          <thead class="sticky top-0 z-10 bg-background/85 backdrop-blur">
                            <tr
                              class={cn(
                                "text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground",
                                redevenDividerRoleClass("strong"),
                                "border-b",
                              )}
                            >
                              <th class="px-3 py-2.5 font-medium">Commit</th>
                              <th class="hidden px-3 py-2.5 font-medium xl:table-cell">
                                Author
                              </th>
                              <th class="hidden px-3 py-2.5 font-medium xl:table-cell">
                                When
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={props.commits ?? []}>
                              {(commit) => {
                                const expanded = () =>
                                  expandedCommitHash() === commit.hash;
                                const detail = () =>
                                  commitDetails()[commit.hash];
                                const files = () => detail()?.files ?? [];
                                const presentation = () =>
                                  detail()?.presentation;
                                const fileTotals = createMemo(() =>
                                  summarizeCommitFileChanges(files()),
                                );
                                const alreadyDetachedHere = () =>
                                  headDisplay().detached &&
                                  currentHeadCommit() === commit.hash;
                                return (
                                  <>
                                    <tr
                                      class={cn(
                                        "git-branch-history-row cursor-pointer border-b",
                                        redevenDividerRoleClass(),
                                        expanded()
                                          ? "git-branch-history-row--expanded"
                                          : "hover:bg-muted/25",
                                      )}
                                      data-expanded={expanded() ? "true" : "false"}
                                      onClick={() => toggleCommit(commit.hash)}
                                    >
                                      <td class="px-3 py-2.5 align-top">
                                        <div class="flex min-w-0 items-start gap-2">
                                          <button
                                            type="button"
                                            aria-label={
                                              expanded()
                                                ? "Collapse commit"
                                                : "Expand commit"
                                            }
                                            aria-expanded={expanded()}
                                            class={cn(
                                              "mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded bg-background/80 text-muted-foreground transition-colors duration-150 hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                                              redevenSurfaceRoleClass(
                                                "control",
                                              ),
                                            )}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              toggleCommit(commit.hash);
                                            }}
                                          >
                                            <ChevronRight
                                              class={cn(
                                                "h-3 w-3 transition-transform duration-150",
                                                expanded() && "rotate-90",
                                              )}
                                            />
                                          </button>
                                          <div class="min-w-0">
                                            <div class="truncate text-xs font-medium text-foreground">
                                              {commit.subject || "(no subject)"}
                                            </div>
                                            <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                                              <GitMetaPill tone="neutral">
                                                {commit.shortHash}
                                              </GitMetaPill>
                                              <GitMetaPill
                                                tone="info"
                                                class="xl:hidden"
                                              >
                                                {commit.authorName ||
                                                  "Unknown author"}
                                              </GitMetaPill>
                                              <GitMetaPill
                                                tone="neutral"
                                                class="xl:hidden"
                                              >
                                                {formatAbsoluteTime(
                                                  commit.authorTimeMs,
                                                )}
                                              </GitMetaPill>
                                              <Show
                                                when={
                                                  (commit.parents?.length ??
                                                    0) > 1
                                                }
                                              >
                                                <GitMetaPill tone="violet">
                                                  Merge x
                                                  {commit.parents?.length}
                                                </GitMetaPill>
                                              </Show>
                                            </div>
                                          </div>
                                        </div>
                                      </td>
                                      <td class="hidden px-3 py-2.5 align-top text-muted-foreground xl:table-cell">
                                        {commit.authorName || "Unknown author"}
                                      </td>
                                      <td class="hidden px-3 py-2.5 align-top text-muted-foreground xl:table-cell">
                                        {formatAbsoluteTime(
                                          commit.authorTimeMs,
                                        )}
                                      </td>
                                    </tr>

                                    <BranchHistoryCommitDetailsReveal
                                      expanded={expanded()}
                                    >
                                      <BranchHistoryCommitDetails
                                        commit={commit}
                                        detail={detail()}
                                        files={files()}
                                        presentation={presentation()}
                                        fileTotals={fileTotals()}
                                        layout={props.layout}
                                        selectedDiffKey={selectedDiffKey()}
                                        repoRootPath={repoRootPath()}
                                        branchName={
                                          props.selectedBranch
                                            ? branchDisplayName(
                                                props.selectedBranch,
                                              )
                                            : undefined
                                        }
                                        askFlowerLabel={i18n.t("git.changes.askFlower")}
                                        switchDetachedBusy={
                                          props.switchDetachedBusy
                                        }
                                        alreadyDetachedHere={
                                          alreadyDetachedHere()
                                        }
                                        onSwitchDetached={
                                          props.onSwitchDetached
                                        }
                                        onAskFlower={props.onAskFlower}
                                        onOpenDiff={(item) => {
                                          setDiffDialogItem(item);
                                          setDiffDialogCommitHash(
                                            commit.hash,
                                          );
                                          setDiffDialogOpen(true);
                                        }}
                                      />
                                    </BranchHistoryCommitDetailsReveal>
                                  </>
                                );
                              }}
                            </For>
                          </tbody>
                        </table>
                      </div>
                    </GitTableFrame>
                  </Show>
                </div>

                <Show when={props.hasMore}>
                  <div class="pt-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      class={cn("w-full", gitToneActionButtonClass())}
                      onClick={props.onLoadMore}
                      loading={props.listLoadingMore}
                      disabled={props.listLoadingMore}
                    >
                      Load More
                    </Button>
                  </div>
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </div>

      <GitDiffDialog
        open={diffDialogOpen()}
        onOpenChange={(open) => {
          setDiffDialogOpen(open);
          if (!open) {
            setDiffDialogItem(null);
            setDiffDialogCommitHash("");
          }
        }}
        item={diffDialogItem()}
        source={
          diffDialogItem()
            ? {
                kind: "commit",
                repoRootPath: repoRootPath(),
                commit: diffDialogCommitHash(),
                presentation: diffDialogPresentation(),
              }
            : null
        }
        title="Commit Diff"
        description={
          diffDialogItem()
            ? changeSecondaryPath(diffDialogItem())
            : "Review the selected file diff."
        }
        emptyMessage="Select a changed file to inspect its diff."
      />
    </>
  );
}

interface BranchCompareDialogProps {
  open: boolean;
  repoRootPath?: string;
  branches?: GitListBranchesResponse | null;
  selectedBranch?: GitBranchSummary | null;
  onClose: () => void;
}

function BranchCompareDialog(props: BranchCompareDialogProps) {
  const layout = useLayout();
  const rpc = useRedevenRpc();

  const [sourceRef, setSourceRef] = createSignal("");
  const [targetRef, setTargetRef] = createSignal("");
  const [compare, setCompare] =
    createSignal<GitGetBranchCompareResponse | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] =
    createSignal<GitCommitFileSummary | null>(null);

  let compareReqSeq = 0;

  const branchOptions = createMemo(() => {
    const seen = new Set<string>();
    const result: GitBranchSummary[] = [];
    for (const branch of allGitBranches(props.branches)) {
      const key = branchIdentity(branch);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(branch);
    }
    return result;
  });

  createEffect(() => {
    const source = String(props.selectedBranch?.name ?? "").trim();
    setSourceRef(source);
    setTargetRef(defaultCompareTarget(props.branches, source));
  });

  createEffect(() => {
    if (!props.open) {
      compareReqSeq += 1;
      setLoading(false);
      setError("");
      setCompare(null);
      return;
    }

    const repoRootPath = String(props.repoRootPath ?? "").trim();
    const nextSource = String(sourceRef()).trim();
    const nextTarget = String(targetRef()).trim();
    if (!repoRootPath || !nextSource || !nextTarget) {
      setCompare(null);
      setError("");
      setLoading(false);
      return;
    }

    const seq = ++compareReqSeq;
    setLoading(true);
    setError("");
    void rpc.git
      .getBranchCompare({
        repoRootPath,
        baseRef: nextTarget,
        targetRef: nextSource,
        limit: 30,
      })
      .then((resp) => {
        if (seq !== compareReqSeq) return;
        setCompare(resp);
      })
      .catch((err) => {
        if (seq !== compareReqSeq) return;
        setCompare(null);
        setError(
          err instanceof Error
            ? err.message
            : String(err ?? "Failed to load branch compare"),
        );
      })
      .finally(() => {
        if (seq === compareReqSeq) setLoading(false);
      });
  });

  const compareFiles = () => compare()?.files ?? [];
  const selectedKey = () => gitDiffEntryIdentity(diffDialogItem());

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={(open) => {
          if (!open) props.onClose();
        }}
        title="Compare branches"
        description="Pick the source and target branches, then review the changed files."
        class={cn(
          "flex max-w-none flex-col overflow-hidden rounded-md p-0",
          "[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2",
          "[&>div:last-child]:min-h-0 [&>div:last-child]:flex [&>div:last-child]:flex-1 [&>div:last-child]:flex-col [&>div:last-child]:!overflow-hidden [&>div:last-child]:!p-0",
          layout.isMobile()
            ? "h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none"
            : "max-h-[88vh] w-[min(1100px,94vw)]",
        )}
      >
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="flex shrink-0 flex-col gap-2 px-4 pb-1">
            <div class="grid gap-3 md:grid-cols-2">
              <label class="block">
                <GitLabelBlock class="min-w-0" label="Source" tone="violet">
                  <select
                    class={cn(
                      "w-full rounded-md bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/70",
                      redevenSurfaceRoleClass("control"),
                    )}
                    value={sourceRef()}
                    onInput={(event) => setSourceRef(event.currentTarget.value)}
                  >
                    <For each={branchOptions()}>
                      {(branch) => (
                        <option value={String(branch.name ?? "").trim()}>
                          {compareOptionLabel(branch)}
                        </option>
                      )}
                    </For>
                  </select>
                </GitLabelBlock>
              </label>

              <label class="block">
                <GitLabelBlock class="min-w-0" label="Target" tone="violet">
                  <select
                    class={cn(
                      "w-full rounded-md bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/70",
                      redevenSurfaceRoleClass("control"),
                    )}
                    value={targetRef()}
                    onInput={(event) => setTargetRef(event.currentTarget.value)}
                  >
                    <For each={branchOptions()}>
                      {(branch) => (
                        <option value={String(branch.name ?? "").trim()}>
                          {compareOptionLabel(branch)}
                        </option>
                      )}
                    </For>
                  </select>
                </GitLabelBlock>
              </label>
            </div>
          </div>

          <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-2 pb-4">
            <Show
              when={!loading()}
              fallback={
                <GitStatePane loading message="Loading branch compare..." />
              }
            >
              <Show
                when={!error()}
                fallback={<GitStatePane tone="error" message={error()} />}
              >
                <Show
                  when={compare()}
                  fallback={
                    <GitStatePane message="Choose two branches to inspect file changes." />
                  }
                >
                  {(compareAccessor) => (
                    <div class="flex min-h-0 flex-1 flex-col gap-3">
                      <div class="flex min-h-0 flex-1 flex-col gap-2">
                        <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                          <GitLabelBlock
                            class="min-w-0 flex-1"
                            label="Changed Files"
                            tone="warning"
                            meta={
                              <>
                                <GitMetaPill tone="neutral">
                                  {compareAccessor().targetRef}
                                </GitMetaPill>
                                <GitMetaPill tone="neutral">
                                  vs {compareAccessor().baseRef}
                                </GitMetaPill>
                                <GitMetaPill tone="warning">
                                  {compareFiles().length} file
                                  {compareFiles().length === 1 ? "" : "s"}
                                </GitMetaPill>
                              </>
                            }
                          />
                          <div class="text-[11px] text-muted-foreground sm:text-right">
                            Open any file to inspect the diff.
                          </div>
                        </div>

                        <div class="flex min-h-0 flex-1 overflow-hidden">
                          <BranchCompareFilesTable
                            items={compareFiles()}
                            selectedKey={selectedKey()}
                            onOpenDiff={(item) => {
                              setDiffDialogItem(item);
                              setDiffDialogOpen(true);
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </Dialog>

      <GitDiffDialog
        open={diffDialogOpen()}
        onOpenChange={(open) => {
          setDiffDialogOpen(open);
          if (!open) setDiffDialogItem(null);
        }}
        item={diffDialogItem()}
        source={
          diffDialogItem() && compare()
            ? {
                kind: "compare",
                repoRootPath: String(
                  compare()?.repoRootPath ?? props.repoRootPath ?? "",
                ).trim(),
                baseRef: String(compare()?.baseRef ?? targetRef()).trim(),
                targetRef: String(compare()?.targetRef ?? sourceRef()).trim(),
              }
            : null
        }
        title="Branch Compare Diff"
        description={
          diffDialogItem()
            ? changeSecondaryPath(diffDialogItem())
            : "Review the selected compare diff."
        }
        emptyMessage="Select a compared file to inspect its diff."
      />
    </>
  );
}

export function GitBranchesPanel(props: GitBranchesPanelProps) {
  const rpc = useRedevenRpc();
  const notification = useNotification();
  const i18n = useI18n();
  const branchSubviewTabRefs = new Map<GitBranchSubview, HTMLButtonElement>();
  const [branchHeaderTopRowElement, setBranchHeaderTopRowElement] =
    createSignal<HTMLDivElement>();
  const [branchHeaderWidth, setBranchHeaderWidth] = createSignal(0);

  const [statusWorkspace, setStatusWorkspace] =
    createSignal<GitListWorkspaceChangesResponse | null>(null);
  const [statusPages, setStatusPages] = createSignal<
    Record<GitWorkspaceViewSection, GitWorkspaceViewPageState>
  >(createEmptyWorkspaceViewPageStateRecord());
  const [statusLoading, setStatusLoading] = createSignal(false);
  const [statusError, setStatusError] = createSignal("");
  const [selectedStatusSection, setSelectedStatusSection] =
    createSignal<GitWorkspaceViewSection>("changes");
  const [statusSectionPinned, setStatusSectionPinned] = createSignal(false);
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] =
    createSignal<GitWorkspaceChange | null>(null);
  const [compareDialogOpen, setCompareDialogOpen] = createSignal(false);

  let statusReqSeqBySection: Record<GitWorkspaceViewSection, number> = {
    changes: 0,
    conflicted: 0,
    staged: 0,
  };
  let lastStatusDataContextKey = "";
  let lastStatusRefreshContextKey = "";
  let lastStatusSelectionContextKey = "";

  const branchDetailState = (): GitBranchDetailPresentationState =>
    props.branchDetailState ??
    (props.selectedBranch
      ? { kind: "ready", branch: props.selectedBranch }
      : { kind: "idle", branch: null });
  const selectedBranch = () => branchDetailState().branch ?? null;
  const branchIsVerifying = () => branchDetailState().kind === "verifying";
  const branchIsReady = () => branchDetailState().kind === "ready";
  const branchHasDetailIssue = () =>
    branchDetailState().kind === "missing" ||
    branchDetailState().kind === "error";
  const branchVerificationDisabledReason = () => {
    const state = branchDetailState();
    if (state.kind === "verifying") {
      return "Checking whether this branch still exists.";
    }
    if (state.kind === "missing") return state.detail;
    if (state.kind === "error") {
      return state.message || "Branch verification failed.";
    }
    return "";
  };
  const interactiveBranch = () => {
    const state = branchDetailState();
    return state.kind === "ready" ? state.branch : null;
  };
  const branchSubview = () => props.selectedBranchSubview ?? "status";
  const statusTabActive = () => branchSubview() === "status";
  const historyTabActive = () => branchSubview() === "history";
  const activeRepoRootPath = () =>
    String(props.repoRootPath || props.repoSummary?.repoRootPath || "").trim();
  const repoHeadDisplay = () => describeGitHead(props.repoSummary);
  const reattachBranch = () => reattachBranchFromRepoSummary(props.repoSummary);
  const statusRepoRootPath = () =>
    resolveGitBranchWorktreePath(interactiveBranch(), activeRepoRootPath());
  const branchDirectoryRequest = (
    directoryPath = activeStatusDirectoryPath(),
  ): GitDirectoryShortcutRequest | null =>
    buildGitDirectoryShortcutRequest({
      rootPath: statusRepoRootPath(),
      directoryPath,
    });
  const resetStatusWorkspace = () => {
    statusReqSeqBySection = { changes: 0, conflicted: 0, staged: 0 };
    setStatusWorkspace(null);
    setStatusPages(createEmptyWorkspaceViewPageStateRecord());
    setStatusLoading(false);
    setStatusError("");
  };
  const updateStatusPageState = (
    section: GitWorkspaceViewSection,
    updater: (state: GitWorkspaceViewPageState) => GitWorkspaceViewPageState,
  ) => {
    setStatusPages((prev) => ({
      ...prev,
      [section]: updater(prev[section]),
    }));
  };
  const statusPageState = (section: GitWorkspaceViewSection) =>
    statusPages()[section];
  const selectStatusSection = (
    section: GitWorkspaceViewSection,
    options: { pinned?: boolean } = {},
  ) => {
    setSelectedStatusSection(section);
    setStatusSectionPinned(options.pinned ?? true);
  };
  const applyStatusPageSnapshot = (
    page: GitListWorkspacePageResponse | null | undefined,
    options: { append?: boolean } = {},
  ) => {
    if (!page) return;
    const section = page.section ?? "changes";
    setStatusWorkspace((prev) =>
      applyWorkspaceViewPageSnapshot(prev, page, options),
    );
    updateStatusPageState(section, (state) => ({
      ...state,
      items: options.append ? [...state.items, ...page.items] : [...page.items],
      totalCount: Number(page.totalCount ?? 0),
      scopeFileCount: Number(page.scopeFileCount ?? page.totalCount ?? 0),
      nextOffset: Number(page.nextOffset ?? 0),
      hasMore: Boolean(page.hasMore),
      loading: false,
      error: "",
      initialized: true,
      directoryPath: String(page.directoryPath ?? "").trim(),
      breadcrumbs: Array.isArray(page.breadcrumbs) ? [...page.breadcrumbs] : [],
    }));
    setStatusError("");
  };
  const visibleStatusPageState = () => statusPageState(selectedStatusSection());
  const visibleStatusWorkspace = () => statusWorkspace();
  const visibleStatusSummary = () => visibleStatusWorkspace()?.summary ?? null;
  const visibleStatusLoading = () =>
    Boolean(
      statusLoading() ||
        (visibleStatusPageState().loading &&
          !visibleStatusPageState().initialized),
    );
  const visibleStatusError = () =>
    String(
      statusError() ||
        (!visibleStatusPageState().initialized
          ? visibleStatusPageState().error
          : ""),
    );
  const visibleStatusTotalRows = () =>
    visibleStatusPageState().initialized
      ? Number(visibleStatusPageState().totalCount ?? 0)
      : workspaceViewSectionCount(
          visibleStatusSummary(),
          selectedStatusSection(),
        );
  const visibleStatusScopeFileCount = () =>
    selectedStatusSection() === "changes"
      ? visibleStatusPageState().initialized
        ? Number(
            visibleStatusPageState().scopeFileCount
              ?? visibleStatusPageState().totalCount
              ?? 0,
          )
        : workspaceViewSectionCount(
            visibleStatusSummary(),
            selectedStatusSection(),
          )
      : visibleStatusTotalRows();
  const visibleStatusLoadingMore = () =>
    Boolean(
      visibleStatusPageState().loading && visibleStatusPageState().initialized,
    );
  const visibleStatusItems = () =>
    workspacePageItems(
      visibleStatusWorkspace(),
      selectedStatusSection(),
      visibleStatusPageState(),
    );
  const activeStatusDirectoryPath = () =>
    selectedStatusSection() === "changes"
      ? String(visibleStatusPageState().directoryPath ?? "").trim()
      : "";
  const statusBreadcrumbSegments = createMemo(() =>
    (visibleStatusPageState().breadcrumbs ?? []).map((crumb) => ({
      label: String(crumb.label ?? "").trim() || "Folder",
      path: String(crumb.path ?? "").trim(),
    })),
  );
  const showStatusBreadcrumbRail = () =>
    selectedStatusSection() === "changes"
    && Boolean(activeStatusDirectoryPath())
    && statusBreadcrumbSegments().length > 0;
  const navigateStatusDirectory = (directoryPath: string) => {
    selectStatusSection("changes");
    void loadStatusSection("changes", {
      directoryPath,
      force: true,
      background: Boolean(statusWorkspace()),
    });
  };
  const selectStatusBreadcrumb = (segment: { path: string }) => {
    navigateStatusDirectory(segment.path);
  };
  const browseFilesForStatusBreadcrumb = (segment: { path: string }) => {
    const request = branchDirectoryRequest(segment.path);
    if (!request) return;
    void props.onBrowseFiles?.(request);
  };
  const visibleStatusKey = () => workspaceEntryKey(diffDialogItem());
  const statusEmptyState = () =>
    branchStatusEmptyState(selectedBranch(), statusRepoRootPath());
  const mergeReviewBranch = () =>
    props.mergeReviewBranch ?? interactiveBranch() ?? selectedBranch() ?? null;
  const mergePreview = () => props.mergePreview ?? null;
  const mergeReviewState = () => props.mergeDialogState ?? "idle";
  const deleteReviewBranch = () =>
    props.deleteReviewBranch ?? interactiveBranch() ?? selectedBranch() ?? null;
  const deletePreview = () => props.deletePreview ?? null;
  const deleteReviewState = () => props.deleteDialogState ?? "idle";
  const shouldRenderReviewDialogs = () => props.renderReviewDialogs ?? true;
  const mergeAvailable = () =>
    Boolean(
      props.onMergeBranch &&
        (selectedBranch()?.kind === "local" ||
          selectedBranch()?.kind === "remote"),
    );
  const mergeDisabled = () =>
    Boolean(
      !mergeAvailable() ||
        !interactiveBranch() ||
        props.mergeBusy ||
        props.repoSummary?.detached ||
        interactiveBranch()?.current,
    );
  const mergeLabel = () => (props.mergeBusy ? "Merging..." : "Merge");
  const linkedWorktreeDeleteDialog = () => {
    const branch = deleteReviewBranch();
    if (!props.deleteReviewOpen || !branch) return false;
    if (deletePreview()?.requiresWorktreeRemoval) return true;
    return String(branch.worktreePath ?? "").trim() !== "";
  };
  const checkoutDisabled = () =>
    Boolean(
      !interactiveBranch() ||
        props.checkoutBusy ||
        interactiveBranch()?.current ||
        (interactiveBranch()?.kind === "local" &&
          interactiveBranch()?.worktreePath),
    );
  const checkoutLabel = () =>
    props.checkoutBusy ? "Checking Out..." : "Checkout";
  const deleteAvailable = () =>
    Boolean(props.onDeleteBranch && selectedBranch()?.kind === "local");
  const deleteDisabled = () =>
    Boolean(
      !deleteAvailable() ||
        !interactiveBranch() ||
        props.deleteBusy ||
        interactiveBranch()?.current,
    );
  const deleteLabel = () => (props.deleteBusy ? "Deleting..." : "Delete");
  const canAskFlowerStatus = () =>
    Boolean(
      props.onAskFlower &&
        interactiveBranch() &&
        statusRepoRootPath() &&
        visibleStatusItems().length > 0,
    );
  const canOpenStash = () => Boolean(props.onOpenStash && statusRepoRootPath());
  const canOpenInTerminal = () =>
    Boolean(props.onOpenInTerminal && branchDirectoryRequest());
  const canBrowseFiles = () =>
    Boolean(props.onBrowseFiles && branchDirectoryRequest());
  const branchWorkspaceDisabledReason = () => {
    const branch = selectedBranch();
    const detailState = branchDetailState();
    if (!branch) return "Select a branch first.";
    if (detailState.kind === "verifying")
      return "Checking whether this branch still exists.";
    if (detailState.kind === "missing") return detailState.detail;
    if (detailState.kind === "error")
      return detailState.message || "Branch verification failed.";
    if (branch.kind === "remote") return "Check out this branch locally first.";
    if (branch.current)
      return activeRepoRootPath() ? "" : "Repository path is unavailable.";
    return "Open this branch in a worktree first.";
  };
  const askFlowerStatusDisabledReason = () => {
    if (canAskFlowerStatus()) return "";
    if (!selectedBranch()) return "Select a branch first.";
    if (visibleStatusLoading()) return "Branch status is still loading.";
    if (visibleStatusError()) return "Branch status is unavailable right now.";
    const workspaceReason = branchWorkspaceDisabledReason();
    if (workspaceReason) return workspaceReason;
    if (visibleStatusItems().length === 0) return "No files in this section.";
    return "Ask Flower is unavailable right now.";
  };
  const branchWorkspaceShortcutDisabledReason = () => {
    if (branchDirectoryRequest()) return "";
    return branchWorkspaceDisabledReason() || "Repository path is unavailable.";
  };
  const branchSummary = createMemo<BranchSummaryPresentation>(() => {
    const text = branchContextSummary(selectedBranch());
    return {
      text,
      title: branchStatusSummary(selectedBranch()),
      visible: text !== EMPTY_BRANCH_CONTEXT_SUMMARY,
    };
  });
  const branchHeaderPendingLabel = () => {
    if (branchIsVerifying()) return "Checking";
    if (props.branchesLoading && selectedBranch()) return "Refreshing";
    return "";
  };
  const branchHeaderControls = createMemo<BranchHeaderControlGroups>(() => {
    const primaryActions: BranchPrimaryActionPresentation[] = [];
    const secondaryShortcuts: BranchShortcutPresentation[] = [];

    if (mergeAvailable() && selectedBranch()) {
      primaryActions.push({
        key: "merge",
        label: mergeLabel(),
        emphasis: mergeDisabled() ? "neutral" : "accent",
        disabled: mergeDisabled(),
        disabledReason: branchVerificationDisabledReason(),
        busy: branchIsVerifying(),
        onPress: () => {
          const branch = interactiveBranch();
          if (branch) props.onMergeBranch?.(branch);
        },
      });
    }

    if (props.onCheckoutBranch && selectedBranch()) {
      primaryActions.push({
        key: "checkout",
        label: checkoutLabel(),
        emphasis: "neutral",
        disabled: checkoutDisabled(),
        disabledReason: branchVerificationDisabledReason(),
        busy: branchIsVerifying(),
        onPress: () => {
          const branch = interactiveBranch();
          if (branch) props.onCheckoutBranch?.(branch);
        },
      });
    }

    if (deleteAvailable() && selectedBranch()) {
      primaryActions.push({
        key: "delete",
        label: deleteLabel(),
        emphasis: "danger",
        disabled: deleteDisabled(),
        disabledReason: branchVerificationDisabledReason(),
        busy: branchIsVerifying(),
        onPress: () => {
          const branch = interactiveBranch();
          if (branch) props.onDeleteBranch?.(branch);
        },
      });
    }

    if (props.onOpenInTerminal) {
      secondaryShortcuts.push({
        key: "terminal",
        label: i18n.t("git.changes.terminal"),
        tone: "terminal",
        icon: Terminal,
        disabled: !canOpenInTerminal(),
        disabledReason: branchWorkspaceShortcutDisabledReason(),
        onPress: () => {
          const request = branchDirectoryRequest();
          if (!request) return;
          props.onOpenInTerminal?.(request);
        },
      });
    }

    if (props.onBrowseFiles) {
      secondaryShortcuts.push({
        key: "files",
        label: i18n.t("git.changes.files"),
        tone: "files",
        icon: Folder,
        disabled: !canBrowseFiles(),
        disabledReason: branchWorkspaceShortcutDisabledReason(),
        onPress: () => {
          const request = branchDirectoryRequest();
          if (!request) return;
          void props.onBrowseFiles?.(request);
        },
      });
    }

    return { primaryActions, secondaryShortcuts };
  });
  const statusToolbarActions = createMemo<BranchPrimaryActionPresentation[]>(
    () => {
      const items: BranchPrimaryActionPresentation[] = [
        {
          key: "compare",
          label: "Compare",
          emphasis: "neutral",
          disabled: !interactiveBranch(),
          disabledReason: branchVerificationDisabledReason(),
          busy: branchIsVerifying(),
          onPress: () => setCompareDialogOpen(true),
        },
      ];

      if (props.onOpenStash) {
        items.push({
          key: "stash",
          label: "Stash...",
          emphasis: "neutral",
          disabled: !canOpenStash(),
          disabledReason: branchWorkspaceDisabledReason(),
          busy: branchIsVerifying(),
          onPress: () => {
            const repoRoot = statusRepoRootPath();
            if (!repoRoot) return;
            props.onOpenStash?.({
              tab: "save",
              repoRootPath: repoRoot,
              source: "branch_status",
            });
          },
        });
      }

      return items;
    },
  );
  const statusToolbarShortcut = createMemo<BranchShortcutPresentation | null>(
    () => {
      if (!props.onAskFlower) return null;
      return {
        key: "ask-flower",
        label: "Ask Flower",
        tone: "flower",
        icon: FlowerIcon,
        disabled: !canAskFlowerStatus(),
        disabledReason: askFlowerStatusDisabledReason(),
        onPress: () => {
          if (!interactiveBranch() || !canAskFlowerStatus()) return;
          props.onAskFlower?.({
            kind: "branch_status",
            repoRootPath: activeRepoRootPath(),
            worktreePath: statusRepoRootPath(),
            branch: interactiveBranch() as GitBranchSummary,
            section: selectedStatusSection(),
            items: visibleStatusItems(),
          });
        },
      };
    },
  );
  const statusSectionCards = createMemo<BranchStatusSectionPresentation[]>(
    () => {
      const summary = visibleStatusSummary();
      return WORKSPACE_VIEW_SECTIONS.map((section) => {
        const count = workspaceViewSectionCount(summary, section);
        const countLabel = `${count} file${count === 1 ? "" : "s"}`;
        return {
          section,
          label: workspaceViewSectionLabel(section),
          compactLabel: branchStatusSummaryLabel(section),
          shortLabel:
            section === "conflicted"
              ? "Conf."
              : branchStatusSummaryLabel(section),
          count,
          active: selectedStatusSection() === section,
          compactCaption: count === 0 ? "No files" : countLabel,
          verboseCaption:
            count === 0 ? "No files to review." : `${countLabel} ready.`,
        };
      });
    },
  );
  const branchHeaderLayout = createMemo(() =>
    resolveGitBranchHeaderLayout(branchHeaderWidth()),
  );
  const branchHeaderUsesOverflow = () => branchHeaderLayout() !== "inline";
  const branchHeaderMainAction = createMemo<
    BranchPrimaryActionPresentation | null
  >(() => {
    const actions = branchHeaderControls().primaryActions;
    return (
      actions.find((action) => action.key === "merge") ??
      actions.find((action) => action.key !== "delete") ??
      null
    );
  });
  const branchHeaderOverflowActions = createMemo<
    BranchHeaderActionPresentation[]
  >(() => {
    if (!branchHeaderUsesOverflow()) return [];
    const mainKey = branchHeaderMainAction()?.key ?? "";
    const controls = branchHeaderControls();
    const nonDangerPrimary = controls.primaryActions
      .filter((action) => action.key !== mainKey && action.key !== "delete")
      .map((action) => ({ ...action, kind: "primary" as const }));
    const shortcuts = controls.secondaryShortcuts.map((shortcut) => ({
      ...shortcut,
      kind: "shortcut" as const,
    }));
    const dangerPrimary = controls.primaryActions
      .filter((action) => action.key !== mainKey && action.key === "delete")
      .map((action) => ({ ...action, kind: "primary" as const }));

    return [...nonDangerPrimary, ...shortcuts, ...dangerPrimary].filter(
      (action) => !action.disabled,
    );
  });
  const branchHeaderOverflowCandidateCount = createMemo(() => {
    if (!branchHeaderUsesOverflow()) return 0;
    const mainKey = branchHeaderMainAction()?.key ?? "";
    const controls = branchHeaderControls();
    return (
      controls.primaryActions.filter((action) => action.key !== mainKey)
        .length + controls.secondaryShortcuts.length
    );
  });
  const branchHeaderOverflowItems = createMemo<DropdownItem[]>(() =>
    branchHeaderOverflowActions().map((action) => ({
      id: action.key,
      label:
        action.key === "delete"
          ? "Delete branch"
          : action.key === "terminal"
            ? i18n.t("git.changes.openInTerminal")
            : action.key === "files"
              ? i18n.t("git.changes.browseFiles")
              : action.label,
    })),
  );
  const branchHeaderOverflowActionById = (id: string) =>
    branchHeaderOverflowActions().find((action) => action.key === id);
  const runBranchHeaderOverflowAction = (id: string) => {
    const action = branchHeaderOverflowActionById(id);
    if (!action || action.disabled) return;
    action.onPress();
  };
  const shouldRenderBranchHeaderActions = () =>
    branchHeaderControls().primaryActions.length > 0 ||
    branchHeaderControls().secondaryShortcuts.length > 0;
  const branchHeaderSurfaceClass = () =>
    cn(
      "border-b px-3 py-2 sm:px-4",
      redevenDividerRoleClass(),
      redevenSurfaceRoleClass("panel"),
    );
  const branchHeaderSummaryBandClass = "grid gap-2";
  const branchHeaderTopRowClass = () =>
    cn(
      "grid gap-2",
      branchHeaderLayout() === "inline" &&
        "grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5",
      branchHeaderLayout() === "stacked" &&
        "grid-cols-1 items-start",
      branchHeaderLayout() === "compact" && "grid-cols-1",
    );
  const branchHeaderTabRailClass = () =>
    cn(
      "flex",
      branchHeaderLayout() === "inline"
        ? "w-auto justify-end"
        : "w-full justify-start",
      branchHeaderLayout() === "stacked" && "order-3",
      branchHeaderLayout() === "compact" && "order-3",
    );
  const branchHeaderTabListClass = () =>
    cn(
      "grid grid-cols-2 rounded-md bg-muted/[0.10] p-0.5",
      redevenSurfaceRoleClass("segmented"),
      branchHeaderLayout() === "inline" ? "w-[12rem]" : "w-full",
    );
  const branchHeaderTitleClass = () =>
    branchHeaderLayout() === "inline" ? "min-w-0 truncate" : "";
  const branchHeaderSummaryClass = () =>
    cn(
      "text-[11px] leading-relaxed text-muted-foreground",
      branchHeaderLayout() === "inline" ? "truncate" : "line-clamp-2",
    );
  const branchHeaderCommandRailClass = () =>
    cn(
      branchHeaderLayout() === "inline"
        ? "flex min-w-0 items-center justify-end gap-2"
        : "flex min-w-0 flex-wrap items-center gap-1.5",
      branchHeaderLayout() === "stacked" && "order-2 justify-start",
      branchHeaderLayout() === "compact" && "order-2 justify-start",
    );
  const branchHeaderShortcutGroupClass = () =>
    cn(
      "flex shrink-0 flex-wrap items-center gap-1.5",
      branchHeaderLayout() === "inline" ? "justify-end" : "justify-start",
    );
  const branchHeaderActionsGroupClass = () =>
    cn(
      "flex min-w-0 flex-wrap items-center gap-1.5",
      branchHeaderLayout() === "inline" || branchHeaderLayout() === "stacked"
        ? "justify-end"
        : "justify-start",
    );
  const branchHeaderMetaClass = () =>
    cn(
      "flex min-w-0 flex-wrap items-center gap-1.5",
      branchHeaderLayout() === "inline" ? "justify-start" : "justify-start",
    );
  const branchHeaderShortcutDockClass = "gap-1";
  const branchStatusToolbarClass = cn(
    "shrink-0 rounded-md bg-muted/[0.035] px-2 py-2",
    redevenSurfaceRoleClass("inset"),
  );
  const branchStatusToolbarGridClass = () =>
    cn(
      "grid gap-2",
      branchHeaderLayout() === "inline"
        ? "grid-cols-[minmax(0,1fr)_auto] items-center"
        : "grid-cols-1",
    );
  const branchStatusSummaryRailClass = () =>
    cn(
      "grid min-w-0 gap-1.5",
      branchHeaderLayout() === "inline"
        ? "grid-cols-[auto_minmax(0,1fr)] items-center"
        : "grid-cols-1",
    );
  const branchStatusStripClass = cn(
    "grid w-full min-w-0 grid-cols-3 gap-0.5 rounded-md bg-muted/[0.08] p-0.5 text-[11px]",
    redevenSurfaceRoleClass("segmented"),
  );
  const branchStatusActionsClass =
    "flex min-w-0 flex-wrap items-center justify-start gap-1.5";
  const secondaryActionButtonClass = cn(
    "cursor-pointer rounded-md bg-background/70 px-3 hover:bg-background",
    redevenSurfaceRoleClass("control"),
  );
  const primaryActionButtonClass =
    "cursor-pointer rounded-md px-3";
  const dangerActionButtonClass =
    "cursor-pointer rounded-md border border-destructive/20 bg-destructive/[0.06] px-3 text-destructive hover:bg-destructive/[0.12] hover:text-destructive";
  const branchStatusSectionCardClass = (active: boolean) =>
    cn(
      "w-full cursor-pointer rounded-md border border-transparent bg-transparent px-2.5 py-1.5 text-left text-xs transition-[background-color,border-color,color] duration-150 hover:bg-muted/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1",
      redevenSegmentedItemClass(active),
      active
        ? "text-foreground"
        : "text-foreground/90",
    );
  const branchSubviewTabClass = (active: boolean) =>
    cn(
      "cursor-pointer rounded-md px-3 py-1.5 text-center text-xs font-medium transition-colors duration-150",
      redevenSegmentedItemClass(active),
      active
        ? "text-foreground"
        : "text-muted-foreground hover:text-foreground",
    );
  const branchActionButtonClass = (
    emphasis: BranchPrimaryActionPresentation["emphasis"],
  ) => {
    switch (emphasis) {
      case "accent":
        return primaryActionButtonClass;
      case "danger":
        return dangerActionButtonClass;
      case "neutral":
      default:
        return secondaryActionButtonClass;
    }
  };
  const renderBranchPrimaryAction = (
    action: BranchPrimaryActionPresentation,
  ) => (
    <Button
      size="sm"
      variant={
        action.emphasis === "accent"
          ? "default"
          : action.emphasis === "danger"
            ? "ghost"
            : "outline"
      }
      class={branchActionButtonClass(action.emphasis)}
      disabled={action.disabled}
      aria-busy={action.busy ? "true" : undefined}
      title={action.disabledReason || undefined}
      onClick={action.onPress}
    >
      {action.label}
    </Button>
  );
  const renderBranchHeaderOverflow = () => (
    <Show when={branchHeaderOverflowCandidateCount() > 0}>
      <Show
        when={branchHeaderOverflowItems().length > 0}
        fallback={
          <Button
            size="sm"
            variant="outline"
            class={cn(
              "rounded-md px-2.5",
              redevenSurfaceRoleClass("control"),
            )}
            disabled
            aria-busy={branchIsVerifying() ? "true" : undefined}
            aria-label={i18n.t("git.common.moreActions")}
            title={
              branchVerificationDisabledReason() ||
              i18n.t("git.common.moreActions")
            }
          >
            <MoreHorizontal class="size-3.5" />
          </Button>
        }
      >
      <Dropdown
        trigger={(
          <Button
            size="sm"
            variant="outline"
            class={cn(
              "rounded-md px-2.5",
              redevenSurfaceRoleClass("control"),
            )}
            aria-label={i18n.t("git.common.moreActions")}
            title={i18n.t("git.common.moreActions")}
          >
            <MoreHorizontal class="size-3.5" />
          </Button>
        )}
        items={branchHeaderOverflowItems()}
        onSelect={runBranchHeaderOverflowAction}
        align="end"
      />
      </Show>
    </Show>
  );
  const handleBranchSubviewKeyDown = (
    event: KeyboardEvent,
    currentView: GitBranchSubview,
  ) => {
    const nextView = resolveRovingTabTargetId(
      GIT_BRANCH_SUBVIEW_IDS,
      currentView,
      event.key,
      "horizontal",
    );
    if (!nextView || nextView === currentView) return;
    event.preventDefault();
    props.onSelectBranchSubview?.(nextView);
    queueMicrotask(() => branchSubviewTabRefs.get(nextView)?.focus());
  };

  const branchDetailStateTitle = () => {
    const state = branchDetailState();
    if (state.kind === "missing") return state.title;
    if (state.kind === "error") return "Unable to verify branch";
    return "Checking branch";
  };
  const branchDetailStateDetail = () => {
    const state = branchDetailState();
    if (state.kind === "missing") return state.detail;
    if (state.kind === "error") {
      return state.message || "Branch verification failed.";
    }
    return "Refreshing branches to confirm that this selection still exists.";
  };
  const branchDetailStateTone = () => {
    const state = branchDetailState();
    if (state.kind === "missing") return "warning" as const;
    if (state.kind === "error") return "danger" as const;
    return "neutral" as const;
  };
  const renderBranchDetailIssueBanner = () => {
    if (!branchHasDetailIssue()) return null;
    const state = branchDetailState();
    return (
      <div
        class="git-branch-detail-banner"
        data-git-branch-detail-state={state.kind}
      >
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-1.5">
            <GitMetaPill tone={branchDetailStateTone()}>
              {state.kind === "missing" ? "Missing" : "Retry needed"}
            </GitMetaPill>
            <div class="text-xs font-semibold text-foreground">
              {branchDetailStateTitle()}
            </div>
          </div>
          <div class="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {branchDetailStateDetail()}
          </div>
        </div>
        <div class="flex shrink-0 flex-wrap items-center gap-1.5">
          <Show when={props.onRefreshSelectedBranch}>
            <Button
              size="sm"
              variant="outline"
              class={secondaryActionButtonClass}
              onClick={() => props.onRefreshSelectedBranch?.()}
            >
              Refresh branches
            </Button>
          </Show>
          <Show
            when={
              state.kind === "missing" &&
              props.onSelectCurrentBranch &&
              (props.branches?.local ?? []).some((branch) => branch.current)
            }
          >
            <Button
              size="sm"
              variant="default"
              class={primaryActionButtonClass}
              onClick={() => props.onSelectCurrentBranch?.()}
            >
              View current branch
            </Button>
          </Show>
        </div>
      </div>
    );
  };
  const renderBranchStablePlaceholder = (view: GitBranchSubview) => {
    const checking = branchIsVerifying();
    return (
      <GitTableFrame
        class="git-branch-stable-placeholder flex min-h-0 flex-1 flex-col"
      >
        <div
          class="git-branch-stable-placeholder__body"
          data-git-branch-stable-placeholder={view}
        >
          <Show
            when={checking}
            fallback={
              <GitSubtleNote class="max-w-xl">
                {view === "status"
                  ? "Branch status will appear here after this selection is available."
                  : "Commit history will appear here after this selection is available."}
              </GitSubtleNote>
            }
          >
            <GitInlineLoadingStatus>
              Checking branch selection
            </GitInlineLoadingStatus>
            <div class="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {view === "status"
                ? "Status will appear here after verification."
                : "History will appear here after verification."}
            </div>
          </Show>
          <div class="git-branch-stable-placeholder__rows" aria-hidden="true">
            <div />
            <div />
            <div />
          </div>
        </div>
      </GitTableFrame>
    );
  };

  const loadStatusSection = async (
    section: GitWorkspaceViewSection,
    options: {
      append?: boolean;
      force?: boolean;
      background?: boolean;
      directoryPath?: string;
    } = {},
  ): Promise<GitListWorkspacePageResponse | undefined> => {
    const repoRootPath = statusRepoRootPath();
    if (!repoRootPath) return;

    const currentState = statusPageState(section);
    const append = Boolean(options.append);
    const directoryPath =
      section === "changes"
        ? String(
            options.directoryPath ?? currentState.directoryPath ?? "",
          ).trim()
        : "";
    const offset = append ? currentState.nextOffset : 0;
    const background = Boolean(
      options.background && !append && currentState.initialized,
    );

    if (!options.force) {
      if (append) {
        if (
          !currentState.initialized ||
          currentState.loading ||
          !currentState.hasMore
        ) {
          return;
        }
      } else if (currentState.initialized && !currentState.loading) {
        return;
      }
    }

    const seq = (statusReqSeqBySection[section] ?? 0) + 1;
    statusReqSeqBySection[section] = seq;

    updateStatusPageState(section, (state) => ({
      ...state,
      loading: true,
      error: background ? state.error : "",
    }));
    if (selectedStatusSection() === section && !append && !background) {
      setStatusLoading(true);
      setStatusError("");
    }

    try {
      const resp = await rpc.git.listWorkspacePage({
        repoRootPath,
        section,
        directoryPath: section === "changes" && directoryPath
          ? directoryPath
          : undefined,
        offset,
        limit: BRANCH_STATUS_PAGE_SIZE,
      });
      if (seq !== statusReqSeqBySection[section]) return;
      applyStatusPageSnapshot(resp, { append });
      return resp;
    } catch (err) {
      if (seq !== statusReqSeqBySection[section]) return;
      const message =
        err instanceof Error
          ? err.message
          : String(err ?? "Failed to load branch status");
      updateStatusPageState(section, (state) => ({
        ...state,
        loading: false,
        error: background ? state.error : message,
      }));
      if (selectedStatusSection() === section && !append && !background) {
        if (!currentState.initialized) {
          setStatusWorkspace(null);
        }
        setStatusError(message);
        props.onBranchDetailLoadFailure?.();
      } else if (background) {
        notification.warning("Git refresh incomplete", message);
      }
    } finally {
      if (seq === statusReqSeqBySection[section]) {
        updateStatusPageState(section, (state) => ({
          ...state,
          loading: false,
        }));
      }
      if (
        selectedStatusSection() === section &&
        !append &&
        !background &&
        seq === statusReqSeqBySection[section]
      ) {
        setStatusLoading(false);
      }
    }
  };

  const loadMoreStatusSection = async (section: GitWorkspaceViewSection) => {
    const state = statusPageState(section);
    if (!state.initialized || state.loading || !state.hasMore) return;
    return loadStatusSection(section, { append: true, force: true });
  };

  createEffect(() => {
    const branch = selectedBranch();
    const element = branchHeaderTopRowElement();
    if (!branch || !element) {
      setBranchHeaderWidth(0);
      return;
    }

    const syncBranchHeaderWidth = () => {
      setBranchHeaderWidth(element.offsetWidth ?? 0);
    };

    syncBranchHeaderWidth();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      syncBranchHeaderWidth();
    });
    observer.observe(element);

    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    const branch = interactiveBranch();
    const repoRootPath = statusRepoRootPath();
    const contextKey =
      branch && repoRootPath ? `${branchIdentity(branch)}|${repoRootPath}` : "";
    if (contextKey === lastStatusSelectionContextKey) return;
    lastStatusSelectionContextKey = contextKey;
    setSelectedStatusSection("changes");
    setStatusSectionPinned(false);
  });

  createEffect(() => {
    const branch = interactiveBranch();
    const repoRootPath = statusRepoRootPath();
    const refreshToken = Number(props.statusRefreshToken ?? 0);
    const contextKey =
      branch && repoRootPath
        ? `${branchIdentity(branch)}|${repoRootPath}`
        : "";
    if (contextKey === lastStatusDataContextKey) return;
    lastStatusDataContextKey = contextKey;
    lastStatusRefreshContextKey = contextKey
      ? `${contextKey}|${refreshToken}`
      : "";
    resetStatusWorkspace();
  });

  createEffect(() => {
    const branch = interactiveBranch();
    const subview = branchSubview();
    const repoRootPath = statusRepoRootPath();
    const section = selectedStatusSection();
    if (!branch || subview !== "status" || !repoRootPath) return;
    const pageState = statusPageState(section);
    if (!pageState.initialized && !pageState.loading) {
      void loadStatusSection(section);
    }
  });

  createEffect(() => {
    const branch = interactiveBranch();
    const subview = branchSubview();
    const repoRootPath = statusRepoRootPath();
    const refreshToken = Number(props.statusRefreshToken ?? 0);
    if (!branch || subview !== "status" || !repoRootPath) return;
    const contextKey = `${branchIdentity(branch)}|${repoRootPath}`;
    const refreshKey = `${contextKey}|${refreshToken}`;
    if (refreshKey === lastStatusRefreshContextKey) return;
    lastStatusRefreshContextKey = refreshKey;
    const section = selectedStatusSection();
    const pageState = statusPageState(section);
    if (!pageState.initialized || pageState.loading) return;
    void loadStatusSection(section, {
      force: true,
      background: true,
    });
  });

  createEffect(() => {
    const summary = visibleStatusSummary();
    const section = selectedStatusSection();
    const pageState = statusPageState(section);
    if (!summary || !pageState.initialized || pageState.loading) return;
    if (workspaceViewSectionCount(summary, section) > 0) return;
    if (statusSectionPinned()) return;
    const nextSection = pickDefaultWorkspaceViewSectionFromSummary(summary);
    if (nextSection !== section) {
      selectStatusSection(nextSection, { pinned: false });
    }
  });

  createEffect(() => {
    if (!diffDialogOpen()) return;
    if (diffDialogItem()) return;
    setDiffDialogOpen(false);
  });

  const renderStatusUnavailableSummary = () => (
    <div
      class={cn(
        "rounded-md px-2.5 py-2",
        redevenSurfaceRoleClass("inset"),
      )}
    >
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-xs font-medium text-foreground">
            {statusEmptyState().title}
          </div>
          <div class="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {statusEmptyState().detail}
          </div>
        </div>
        <GitMetaPill tone={statusEmptyState().tone}>
          Status unavailable
        </GitMetaPill>
      </div>
      <Show when={statusEmptyState().hint}>
        <div class="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {statusEmptyState().hint}
        </div>
      </Show>
    </div>
  );
  const renderBranchStatusStrip = () => {
    const pending = branchIsVerifying() || visibleStatusLoading();
    const unavailable = branchHasDetailIssue();
    if (
      branchIsReady() &&
      !pending &&
      visibleStatusError()
    ) {
      return (
        <GitStatePane
          tone="error"
          message={visibleStatusError()}
          surface
          class="py-1"
        />
      );
    }
    if (
      branchIsReady() &&
      !pending &&
      !visibleStatusWorkspace()
    ) {
      return renderStatusUnavailableSummary();
    }

    return (
      <div>
        <div
          class={branchStatusStripClass}
          data-git-branch-status-summary-state={
            pending
              ? "loading"
              : unavailable
                ? "unavailable"
                : "ready"
          }
        >
          <For each={statusSectionCards()}>
            {(item) => (
              <button
                type="button"
                class={branchStatusSectionCardClass(item.active)}
                aria-pressed={item.active}
                aria-label={`${item.label}: ${
                  pending || unavailable ? "pending" : item.compactCaption
                }`}
                title={
                  pending || unavailable
                    ? branchDetailStateDetail()
                    : item.verboseCaption
                }
                disabled={pending || unavailable}
                onClick={() => selectStatusSection(item.section)}
              >
                <div class="flex min-h-[1.55rem] items-center justify-between gap-1.5">
                  <div
                    class={cn(
                      "min-w-0 truncate text-[9px] font-semibold uppercase tracking-[0.08em] sm:text-[10px] sm:tracking-[0.14em]",
                      item.active
                        ? "text-current opacity-80"
                        : "text-muted-foreground/80",
                    )}
                  >
                    {branchHeaderLayout() === "compact"
                      ? item.shortLabel
                      : item.compactLabel}
                  </div>
                  <div
                    class={cn(
                      "shrink-0 text-[12px] font-semibold tabular-nums leading-none",
                      item.active ? "text-current" : "text-foreground",
                    )}
                  >
                    {pending || unavailable ? "–" : item.count}
                  </div>
                </div>
              </button>
            )}
          </For>
        </div>
        <Show when={pending}>
          <GitInlineLoadingStatus class="mt-1.5">
            {branchIsVerifying()
              ? "Checking branch..."
              : "Loading branch status..."}
          </GitInlineLoadingStatus>
        </Show>
      </div>
    );
  };

  const renderStatus = () => {
    const active = statusTabActive;
    const branch = selectedBranch();
    if (!branch) {
      return (
        <div
          class={cn(
            "flex-1 px-3 py-4 text-xs text-muted-foreground",
            !active() && "hidden",
          )}
          role="tabpanel"
          id={gitBranchSubviewPanelId("status")}
          aria-labelledby={gitBranchSubviewTabId("status")}
          aria-hidden={!active()}
          hidden={!active()}
          tabIndex={active() ? 0 : -1}
        >
          Choose a branch from the sidebar to inspect its status or history.
        </div>
      );
    }

    return (
      <div
        class={cn(
          "flex h-full min-h-0 flex-col overflow-hidden",
          !active() && "hidden",
        )}
        role="tabpanel"
        id={gitBranchSubviewPanelId("status")}
        aria-labelledby={gitBranchSubviewTabId("status")}
        aria-hidden={!active()}
        hidden={!active()}
        tabIndex={active() ? 0 : -1}
      >
        <div class="flex min-h-0 flex-1 flex-col px-3 py-2 sm:px-4">
          <div class="flex min-h-0 flex-1 flex-col gap-2">
            {renderBranchDetailIssueBanner()}
            <section class={branchStatusToolbarClass}>
              <div
                class={branchStatusToolbarGridClass()}
                data-git-branch-status-toolbar-layout={branchHeaderLayout()}
              >
                <div
                  class={branchStatusSummaryRailClass()}
                  data-git-branch-status-summary-layout={branchHeaderLayout()}
                >
                  <div class="flex min-h-5 items-center gap-2">
                    <span
                      class={cn(
                        "h-2 w-2 shrink-0 rounded-full ring-1 ring-current/20",
                        gitToneDotClass("neutral"),
                      )}
                      aria-hidden="true"
                    />
                    <div class="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/75">
                      Status
                    </div>
                  </div>

                  <div class="min-w-0">
                    {renderBranchStatusStrip()}
                  </div>
                </div>

                <div class={branchStatusActionsClass}>
                  <Show when={statusToolbarShortcut()}>
                    {(shortcut) => (
                      <GitShortcutOrbDock>
                        <GitShortcutOrbButton
                          label={shortcut().label}
                          tone={shortcut().tone}
                          icon={shortcut().icon}
                          size="sm"
                          disabled={shortcut().disabled}
                          disabledReason={shortcut().disabledReason}
                          onClick={shortcut().onPress}
                        />
                      </GitShortcutOrbDock>
                    )}
                  </Show>
                  <For each={statusToolbarActions()}>
                    {(action) => (
                      <Button
                        size="sm"
                        variant={
                          action.emphasis === "accent" ? "default" : "outline"
                        }
                        class={branchActionButtonClass(action.emphasis)}
                        disabled={action.disabled}
                        aria-busy={action.busy ? "true" : undefined}
                        title={action.disabledReason || undefined}
                        onClick={action.onPress}
                      >
                        {action.label}
                      </Button>
                    )}
                  </For>
                </div>
              </div>

              <Show when={visibleStatusWorkspace() && showStatusBreadcrumbRail()}>
                <GitChangesBreadcrumb
                  segments={statusBreadcrumbSegments()}
                  onSelect={selectStatusBreadcrumb}
                  onBrowseFiles={props.onBrowseFiles ? browseFilesForStatusBreadcrumb : undefined}
                  class="mt-1.5"
                />
              </Show>
            </section>

            <div class="flex min-h-0 flex-1 overflow-hidden">
              <Show
                when={branchIsReady() && visibleStatusWorkspace()}
                fallback={renderBranchStablePlaceholder("status")}
              >
                <BranchStatusTable
                  layout={branchHeaderLayout()}
                  section={selectedStatusSection()}
                  items={visibleStatusItems()}
                  totalCount={visibleStatusTotalRows()}
                  scopeFileCount={visibleStatusScopeFileCount()}
                  directoryPath={activeStatusDirectoryPath()}
                  hasMore={visibleStatusPageState().hasMore}
                  loadingMore={visibleStatusLoadingMore()}
                  selectedKey={visibleStatusKey()}
                  onOpenDiff={(item) => {
                    setDiffDialogItem(item);
                    setDiffDialogOpen(true);
                  }}
                  onOpenDirectory={navigateStatusDirectory}
                  onLoadMore={() => {
                    void loadMoreStatusSection(selectedStatusSection());
                  }}
                />
              </Show>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderHistory = () => {
    const active = historyTabActive;
    const branch = selectedBranch();
    if (!branch) {
      return (
        <div
          class={cn(
            "flex-1 px-3 py-4 text-xs text-muted-foreground",
            !active() && "hidden",
          )}
          role="tabpanel"
          id={gitBranchSubviewPanelId("history")}
          aria-labelledby={gitBranchSubviewTabId("history")}
          aria-hidden={!active()}
          hidden={!active()}
          tabIndex={active() ? 0 : -1}
        >
          Choose a branch from the sidebar to inspect its status or history.
        </div>
      );
    }

    return (
      <div
        role="tabpanel"
        id={gitBranchSubviewPanelId("history")}
        aria-labelledby={gitBranchSubviewTabId("history")}
        aria-hidden={!active()}
        hidden={!active()}
        tabIndex={active() ? 0 : -1}
        class={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden",
          !active() && "hidden",
        )}
      >
        <Show
          when={branchIsReady()}
          fallback={
            <div class="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2 sm:px-4">
              {renderBranchDetailIssueBanner()}
              {renderBranchStablePlaceholder("history")}
            </div>
          }
        >
          <HistoryList
            active={active()}
            layout={branchHeaderLayout()}
            repoRootPath={activeRepoRootPath()}
            repoSummary={props.repoSummary}
            selectedBranch={interactiveBranch()}
            commits={props.commits}
            listLoading={props.listLoading}
            listRefreshing={props.listRefreshing}
            listLoadingMore={props.listLoadingMore}
            listError={props.listError}
            hasMore={props.hasMore}
            selectedCommitHash={props.selectedCommitHash}
            switchDetachedBusy={props.switchDetachedBusy}
            onSelectCommit={props.onSelectCommit}
            onLoadMore={props.onLoadMore}
            onSwitchDetached={props.onSwitchDetached}
            onAskFlower={props.onAskFlower}
          />
        </Show>
      </div>
    );
  };
  const branchPanelBlockingLoading = () =>
    Boolean(props.branchesLoading && !selectedBranch() && !props.branches);
  const branchPanelBlockingError = () =>
    Boolean(props.branchesError && !selectedBranch());

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <Show
        when={!branchPanelBlockingLoading()}
        fallback={
          <GitStatePane
            loading
            message="Loading branches..."
            class="px-3 py-4"
          />
        }
      >
        <Show
          when={!branchPanelBlockingError()}
          fallback={
            <GitStatePane
              tone="error"
              message={props.branchesError}
              class="px-3 py-4"
            />
          }
        >
          <Show
            when={selectedBranch()}
            fallback={
              <div class="flex-1 px-3 py-4 text-xs text-muted-foreground">
                Choose a branch from the sidebar to inspect its status or
                history.
              </div>
            }
          >
            <div class="flex h-full min-h-0 flex-col overflow-hidden">
              <div class={branchHeaderSurfaceClass()}>
                <div class={branchHeaderSummaryBandClass}>
                  <div
                    ref={setBranchHeaderTopRowElement}
                    class={branchHeaderTopRowClass()}
                    data-git-branch-header-layout={branchHeaderLayout()}
                  >
                    <div class="min-w-0 flex-1">
                      <GitLabelBlock
                        class="min-w-0 flex-1"
                        bodyClass="!pl-0"
                        label="Branch"
                        tone={gitBranchTone(selectedBranch())}
                        meta={
                          <div class={branchHeaderMetaClass()}>
                            <Show when={selectedBranch()?.current}>
                              <GitMetaPill tone="success">
                                Current
                              </GitMetaPill>
                            </Show>
                            <Show when={selectedBranch()?.kind === "remote"}>
                              <GitMetaPill tone="violet">Remote</GitMetaPill>
                            </Show>
                          </div>
                        }
                      >
                        <div class="flex min-w-0 items-center gap-1.5">
                          <GitPrimaryTitle
                            class={cn(
                              "min-w-0 flex-1",
                              branchHeaderTitleClass(),
                            )}
                          >
                            {branchDisplayName(selectedBranch())}
                          </GitPrimaryTitle>
                          <Show when={branchHeaderPendingLabel()}>
                            {(label) => (
                              <GitInlineLoadingStatus class="git-branch-header-inline-status">
                                {label()}
                              </GitInlineLoadingStatus>
                            )}
                          </Show>
                        </div>
                        <Show when={branchSummary().visible}>
                          <div
                            class={branchHeaderSummaryClass()}
                            title={branchSummary().title}
                          >
                            {branchSummary().text}
                          </div>
                        </Show>
                      </GitLabelBlock>
                    </div>

                    <div class={branchHeaderTabRailClass()}>
                      <div
                        class={branchHeaderTabListClass()}
                        role="tablist"
                        aria-label="Branch detail tabs"
                        aria-orientation="horizontal"
                      >
                        <For each={GIT_BRANCH_SUBVIEW_IDS}>
                          {(view) => {
                            const active = () => branchSubview() === view;
                            return (
                              <button
                                ref={(el) => {
                                  branchSubviewTabRefs.set(view, el);
                                }}
                                type="button"
                                role="tab"
                                id={gitBranchSubviewTabId(view)}
                                aria-selected={active()}
                                aria-controls={gitBranchSubviewPanelId(view)}
                                tabIndex={active() ? 0 : -1}
                                class={branchSubviewTabClass(active())}
                                onClick={() =>
                                  props.onSelectBranchSubview?.(view)
                                }
                                onKeyDown={(event) =>
                                  handleBranchSubviewKeyDown(event, view)
                                }
                              >
                                {branchSubviewLabel(view)}
                              </button>
                            );
                          }}
                        </For>
                      </div>
                    </div>

                    <Show
                      when={shouldRenderBranchHeaderActions()}
                    >
                      <div
                        class={branchHeaderCommandRailClass()}
                        data-git-branch-header-actions={
                          branchHeaderUsesOverflow() ? "overflow" : "inline"
                        }
                      >
                        <div class={branchHeaderActionsGroupClass()}>
                          <Show
                            when={!branchHeaderUsesOverflow()}
                            fallback={
                              <>
                                <Show when={branchHeaderMainAction()}>
                                  {(action) =>
                                    renderBranchPrimaryAction(action())
                                  }
                                </Show>
                                {renderBranchHeaderOverflow()}
                              </>
                            }
                          >
                            <Show
                              when={
                                branchHeaderControls().secondaryShortcuts
                                  .length > 0
                              }
                            >
                              <div class={branchHeaderShortcutGroupClass()}>
                                <GitShortcutOrbDock
                                  class={branchHeaderShortcutDockClass}
                                >
                                  <For
                                    each={
                                      branchHeaderControls()
                                        .secondaryShortcuts
                                    }
                                  >
                                    {(shortcut) => (
                                      <GitShortcutOrbButton
                                        label={shortcut.label}
                                        tone={shortcut.tone}
                                        icon={shortcut.icon}
                                        size="sm"
                                        disabled={shortcut.disabled}
                                        disabledReason={
                                          shortcut.disabledReason
                                        }
                                        onClick={shortcut.onPress}
                                      />
                                    )}
                                  </For>
                                </GitShortcutOrbDock>
                              </div>
                            </Show>
                            <For each={branchHeaderControls().primaryActions}>
                              {(action) => renderBranchPrimaryAction(action)}
                            </For>
                          </Show>
                        </div>
                      </div>
                    </Show>
                  </div>

                    <Show when={repoHeadDisplay().detached}>
                      <div class="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed">
                        <div class="flex flex-wrap items-center gap-1.5">
                          <GitMetaPill tone="warning">
                            Detached HEAD
                          </GitMetaPill>
                          <Show when={repoHeadDisplay().detail}>
                            <GitMetaPill tone="neutral">
                              {repoHeadDisplay().detail}
                            </GitMetaPill>
                          </Show>
                        </div>
                        <div class="mt-2 text-foreground">
                          {detachedHeadViewingSummary(
                            props.repoSummary?.headCommit,
                          )}
                        </div>
                        <div class="mt-1 text-muted-foreground">
                          Checkout a local branch to reattach HEAD before pull,
                          push, or merge.
                        </div>
                        <Show when={reattachBranch()}>
                          <div class="mt-1 text-muted-foreground">
                            {detachedHeadReattachSummary(reattachBranch())}
                          </div>
                        </Show>
                        <Show when={reattachBranch() && props.onCheckoutBranch}>
                          <div class="mt-2">
                            <Button
                              size="sm"
                              variant="default"
                              class={primaryActionButtonClass}
                              disabled={Boolean(props.checkoutBusy)}
                              onClick={() => {
                                const branch = reattachBranch();
                                if (branch) props.onCheckoutBranch?.(branch);
                              }}
                            >
                              {detachedHeadCheckoutActionLabel(
                                reattachBranch(),
                                props.checkoutBusy,
                              )}
                            </Button>
                          </div>
                        </Show>
                      </div>
                    </Show>
                </div>
              </div>

              {renderStatus()}
              {renderHistory()}
            </div>
          </Show>
        </Show>
      </Show>

      <BranchCompareDialog
        open={compareDialogOpen()}
        repoRootPath={activeRepoRootPath()}
        branches={props.branches}
        selectedBranch={interactiveBranch()}
        onClose={() => setCompareDialogOpen(false)}
      />

      <GitDiffDialog
        open={diffDialogOpen()}
        onOpenChange={(open) => {
          setDiffDialogOpen(open);
          if (!open) setDiffDialogItem(null);
        }}
        item={diffDialogItem()}
        source={
          diffDialogItem()
            ? {
                kind: "workspace",
                repoRootPath: statusRepoRootPath(),
                workspaceSection: String(
                  diffDialogItem()?.section ?? "",
                ).trim(),
              }
            : null
        }
        title="Branch Status Diff"
        description={
          diffDialogItem()
            ? changeSecondaryPath(diffDialogItem())
            : "Review the selected branch status diff."
        }
        emptyMessage="Select a branch status file to inspect its diff."
      />

      <Show when={shouldRenderReviewDialogs()}>
        <GitMergeBranchDialog
          open={Boolean(props.mergeReviewOpen && mergeReviewBranch())}
          branch={mergeReviewBranch()}
          preview={mergePreview()}
          previewError={props.mergePreviewError}
          actionError={props.mergeActionError}
          state={mergeReviewState()}
          onClose={() => props.onCloseMergeReview?.()}
          onRetryPreview={(branch) => props.onRetryMergePreview?.(branch)}
          onOpenStash={(request) => props.onOpenStash?.(request)}
          onConfirm={(branch, options) =>
            props.onConfirmMergeBranch?.(branch, options)
          }
        />

        <GitDeleteBranchDialog
          open={Boolean(props.deleteReviewOpen && deleteReviewBranch())}
          branch={deleteReviewBranch()}
          preview={deletePreview()}
          previewError={props.deletePreviewError}
          actionError={props.deleteActionError}
          state={deleteReviewState()}
          worktreeMode={linkedWorktreeDeleteDialog()}
          onClose={() => props.onCloseDeleteReview?.()}
          onRetryPreview={(branch) => props.onRetryDeletePreview?.(branch)}
          onConfirm={(branch, options) =>
            props.onConfirmDeleteBranch?.(branch, options)
          }
        />
      </Show>
    </div>
  );
}
