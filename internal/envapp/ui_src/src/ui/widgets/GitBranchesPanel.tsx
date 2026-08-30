import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  type Component,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { cn, useLayout, useNotification } from "@floegence/floe-webapp-core";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  CheckCircle,
  ChevronDown,
  Copy,
  Eye,
  FileText,
  Folder,
  History,
  Link,
  MoreHorizontal,
  Package,
  Terminal,
  Trash,
} from "@floegence/floe-webapp-core/icons";
import { Button, Dropdown, type DropdownItem } from "@floegence/floe-webapp-core/ui";
import { Dialog } from '../primitives/EnvAppModal';
import { GitBranch } from '@floegence/floe-webapp-core/icons';
import { FlowerIcon } from "../icons/FlowerIcon";
import {
  useRedevenRpc,
  type GitBranchSummary,
  type GitCommitDiffPresentation,
  type GitCommitDetail,
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
  branchDisplayName,
  branchIdentity,
  changeSecondaryPath,
  createEmptyWorkspaceViewPageStateRecord,
  describeGitHead,
  exactGitPath,
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
  resolveGitBranchWorktreePath,
  type GitStashWindowRequest,
  type GitBranchSubview,
  type GitDetachedSwitchTarget,
  type GitWorkspaceViewSection,
} from "../utils/gitWorkbench";
import {
  localizedBranchContextSummary,
  localizedBranchStatusSummary,
  localizedDetachedHeadCheckoutActionLabel,
  localizedDetachedHeadReattachSummary,
  localizedDetachedHeadViewingSummary,
  localizedGitCommitDiffPresentationBadge,
  localizedGitCommitDiffPresentationDetail,
  localizedGitBranchSubviewLabel,
  localizedGitChangeLabel,
  localizedGitHeadDisplay,
  localizedWorkspaceViewSectionLabel,
} from '../utils/localizedGitWorkbench';
import { resolveRovingTabTargetId } from "../utils/tabNavigation";
import {
  redevenDividerRoleClass,
  redevenSegmentedItemClass,
  redevenSurfaceRoleClass,
} from "../utils/redevenSurfaceRoles";
import {
  buildGitDirectoryShortcutRequest,
  buildGitFileShortcutTarget,
  type GitAskFlowerRequest,
  type GitDirectoryShortcutRequest,
  type GitFileShortcutTarget,
} from "../utils/gitBrowserShortcuts";
import {
  gitChangePathClass,
  gitChangeTone,
  gitToneAccentColor,
  gitToneActionButtonClass,
  gitToneDotClass,
  workspaceSectionTone,
} from "./GitChrome";
import { GitChangesBreadcrumb } from "./GitChangesBreadcrumb";
import { GitDiffDialog } from "./GitDiffDialog";
import { GitCommitGraph } from './GitCommitGraph';
import { GitCommitMessageDialog } from './GitCommitMessageDialog';
import { GitVirtualTable } from "./GitVirtualTable";
import { GIT_WORKBENCH_SCROLL_REGION_PROPS } from "./gitWorkbenchScrollRegion";
import { Tooltip } from "../primitives/Tooltip";
import {
  GIT_CHANGED_FILES_CELL_CLASS,
  GIT_CHANGED_FILES_CELL_MIDDLE_CLASS,
  GIT_CHANGED_FILES_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_HEADER_ROW_CLASS,
  GIT_CHANGED_FILES_SECONDARY_PATH_CLASS,
  GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_TABLE_CLASS,
  GitChangedFilesActionButton,
  GitChangeMetrics,
  GitContentSkeleton,
  GitLabelBlock,
  GitInlineLoadingStatus,
  GitMetaPill,
  GitPagedTableFooter,
  GitPrimaryTitle,
  GitShortcutOrbButton,
  GitShortcutOrbDock,
  GitStatePane,
  GitSubtleNote,
  GitTableBadge,
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
import { useI18n } from "../i18n";
import {
  GitEntityContextMenu,
  createGitEntityContextMenuController,
  type GitContextMenuActionItem,
} from "./GitEntityContextMenu";
import { isGitWorkspaceSnapshotStale, type GitCapabilityMode } from '../services/gitWorkspaceRuntime';

const BRANCH_STATUS_PAGE_SIZE = 200;
type GitBranchStatusPresentationState =
  | "loading"
  | "ready"
  | "error"
  | "unavailable";

export function gitBranchPanelIdentityKey(
  ...parts: ReadonlyArray<string | number>
): string {
  return JSON.stringify(parts);
}

const BRANCH_STATUS_TABLE_COLUMN_KEYS = [
  "git.common.path",
  "uiCopy.git.section",
  "git.common.status",
  "git.common.changes",
  "git.common.action",
] as const;

export interface GitBranchesPanelProps {
  repoRootPath?: string;
  repoSummary?: GitRepoSummaryResponse | null;
  statusRefreshToken?: number;
  protocolClientIdentity?: object | null;
  capabilityMode?: GitCapabilityMode;
  selectedBranch?: GitBranchSummary | null;
  branchDetailState?: GitBranchDetailPresentationState;
  selectedBranchSubview?: GitBranchSubview;
  onSelectBranchSubview?: (view: GitBranchSubview) => void;
  onRefreshSelectedBranch?: () => void;
  onSelectCurrentBranch?: () => void;
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
  onAskFlower?: (request: GitAskFlowerRequest) => void;
  onOpenInTerminal?: (request: GitDirectoryShortcutRequest) => void;
  onBrowseFiles?: (
    request: GitDirectoryShortcutRequest,
  ) => void | Promise<void>;
  onPreviewCurrentFile?: (target: GitFileShortcutTarget) => void;
  onCopyText?: (value: string) => void | Promise<void>;
  renderReviewDialogs?: boolean;
}

type BranchStatusScopeContextTarget = Readonly<{
  repoRootPath: string;
  liveRootPath: string;
  branch: GitBranchSummary;
  section: GitWorkspaceViewSection;
  directoryPath: string;
  items: GitWorkspaceChange[];
}>;

type BranchHeaderContextTarget = Readonly<{
  branch: GitBranchSummary;
  repoRootPath: string;
  liveRootPath: string;
  repoDetached: boolean;
}>;

function formatAbsoluteTime(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString();
}

function compareFilePath(item: GitCommitFileSummary, unknownPath: string): string {
  return exactGitPath(
    item.displayPath || item.path || item.newPath || item.oldPath,
  ) || unknownPath;
}

function worktreeFilePath(item: GitWorkspaceChange, unknownPath: string): string {
  return exactGitPath(
    item.displayPath || item.path || item.newPath || item.oldPath,
  ) || unknownPath;
}

function branchStatusPrimaryLabel(item: GitWorkspaceChange, unknownPath: string): string {
  const pathValue = isGitWorkspaceDirectoryEntry(item)
    ? workspaceDirectoryPath(item)
    : worktreeFilePath(item, unknownPath);
  const parts = pathValue.split("/").filter(Boolean);
  return parts[parts.length - 1] || pathValue || unknownPath;
}

function branchStatusDirectorySummary(item: GitWorkspaceChange, i18n: ReturnType<typeof useI18n>): string {
  const count = Number(item.descendantFileCount ?? 0);
  return i18n.tn('git.common.fileCount', count);
}

function branchStatusEmptyPresentation(
  section: GitWorkspaceViewSection,
  i18n: ReturnType<typeof useI18n>,
  directoryPath = "",
): {
  title: string;
  detail: string;
} {
  const scopedToDirectory = directoryPath.length > 0;
  if (section === "changes") {
    return {
      title: i18n.t('git.branches.noPendingFiles'),
      detail: i18n.t(scopedToDirectory ? 'git.branches.folderClean' : 'git.branches.worktreeClean'),
    };
  }
  switch (section) {
    case "staged":
      return {
        title: i18n.t('git.branches.nothingStaged'),
        detail: i18n.t(scopedToDirectory ? 'git.branches.folderNoStagedFiles' : 'git.branches.worktreeNoStagedFiles'),
      };
    case "conflicted":
      return {
        title: i18n.t('git.branches.noConflicts'),
        detail: i18n.t(scopedToDirectory ? 'git.branches.folderNoConflictedFiles' : 'git.branches.worktreeNoConflictedFiles'),
      };
    default:
      return {
        title: i18n.t('git.branches.noFiles'),
        detail: i18n.t(scopedToDirectory ? 'git.branches.folderNoFilesInSection' : 'git.branches.worktreeNoFilesInSection'),
      };
  }
}

function branchStatusEmptyIcon(section: GitWorkspaceViewSection): Component<{ class?: string }> {
  switch (section) {
    case "conflicted":
      return AlertTriangle;
    case "staged":
      return CheckCircle;
    case "changes":
    default:
      return FileText;
  }
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
  icon?: Component<{ class?: string }>;
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

type BranchStatusUnavailablePresentation = {
  title: string;
  detail: string;
  hint?: string;
  tone: "neutral" | "info" | "violet";
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
  i18n: ReturnType<typeof useI18n>,
): BranchStatusUnavailablePresentation {
  if (!branch) {
    return {
      title: i18n.t('git.branches.noBranchSelected'),
      detail: i18n.t('git.branches.chooseBranchDetail'),
      tone: "neutral",
    };
  }
  if (branch.kind === "remote") {
    return {
      title: i18n.t('uiCopy.git.statusUnavailable'),
      detail: i18n.t('git.branches.remoteNotCheckedOut'),
      hint: i18n.t('git.branches.checkoutRemoteHint'),
      tone: "violet",
    };
  }
  if (statusRepoRootPath) {
    return {
      title: i18n.t('uiCopy.git.statusUnavailable'),
      detail: i18n.t('git.branches.worktreeUnavailable'),
      hint: i18n.t('git.branches.refreshWorktreeHint'),
      tone: "info",
    };
  }
  return {
    title: i18n.t('uiCopy.git.statusUnavailable'),
    detail: i18n.t('git.branches.localNotCheckedOut'),
    hint: i18n.t('git.branches.historyCompareHint'),
    tone: "info",
  };
}

function trimTerminalSentencePeriod(value: string): string {
  const text = value.trim();
  return text.endsWith(".") ? text.slice(0, -1) : text;
}

type BranchFileContext = Readonly<
  | {
      kind: 'compare';
      repoRootPath: string;
      liveRootPath: string;
      baseRef: string;
      targetRef: string;
    }
  | {
      kind: 'commit';
      repoRootPath: string;
      liveRootPath: string;
      branchName?: string;
      commit: GitCommitSummary;
    }
>;

type BranchFileContextMenuTarget = Readonly<{
  file: GitCommitFileSummary;
  context: BranchFileContext;
}>;

interface BranchCompareFilesTableProps {
  surface?: "framed" | "inline";
  items: GitCommitFileSummary[];
  selectedKey?: string;
  context: BranchFileContext;
  onOpenDiff?: (item: GitCommitFileSummary, context: BranchFileContext) => void;
  onAskFlower?: GitBranchesPanelProps["onAskFlower"];
  onOpenInTerminal?: GitBranchesPanelProps["onOpenInTerminal"];
  onBrowseFiles?: GitBranchesPanelProps["onBrowseFiles"];
  onPreviewCurrentFile?: GitBranchesPanelProps["onPreviewCurrentFile"];
  onCopyText?: GitBranchesPanelProps["onCopyText"];
}

function BranchCompareFilesTable(props: BranchCompareFilesTableProps) {
  const i18n = useI18n();
  const contextMenu = createGitEntityContextMenuController<BranchFileContextMenuTarget>({
    snapshotTarget: (target) => ({
      file: { ...target.file },
      context: target.context.kind === 'compare'
        ? { ...target.context }
        : {
            ...target.context,
            commit: { ...target.context.commit, parents: [...target.context.commit.parents] },
          },
    }),
  });
  const contextTarget = (item: GitCommitFileSummary): BranchFileContextMenuTarget => ({
    file: item,
    context: props.context,
  });
  const fileTarget = (target: BranchFileContextMenuTarget) =>
    buildGitFileShortcutTarget({
      rootPath: target.context.liveRootPath,
      item: target.file,
    });
  const contextMenuItems = (menuTarget: BranchFileContextMenuTarget): GitContextMenuActionItem[] => {
    const item = menuTarget.file;
    const context = menuTarget.context;
    const shortcut = fileTarget(menuTarget);
    const directoryRequest = shortcut
      ? buildGitDirectoryShortcutRequest({ rootPath: shortcut.parentDirectoryPath })
      : null;
    const actions: GitContextMenuActionItem[] = [];
    if (props.onAskFlower) {
      actions.push({
        id: "ask-flower",
        kind: "action",
        group: "assistant",
        rank: 10,
        label: i18n.t("git.contextMenu.askFlower"),
        icon: FlowerIcon,
        onSelect: () => {
          if (context.kind === 'compare') {
            props.onAskFlower?.({
              kind: 'compare_file',
              repoRootPath: context.repoRootPath,
              baseRef: context.baseRef,
              targetRef: context.targetRef,
              file: item,
            });
            return;
          }
          props.onAskFlower?.({
            kind: 'commit',
            repoRootPath: context.repoRootPath,
            location: 'branch_history',
            branchName: context.branchName,
            commit: context.commit,
            files: [item],
          });
        },
      });
    }
    if (props.onOpenDiff) {
      actions.push({
        id: "view-diff",
        kind: "action",
        group: "inspect",
        rank: 10,
        label: i18n.t("git.contextMenu.viewDiff"),
        icon: ArrowRightLeft,
        onSelect: () => props.onOpenDiff?.(item, context),
      });
    }
    if (
      props.onPreviewCurrentFile
      && String(item.changeType ?? "").toLowerCase() !== "deleted"
    ) {
      actions.push({
        id: "preview-current-file",
        kind: "action",
        group: "inspect",
        rank: 20,
        label: i18n.t("git.contextMenu.previewCurrentFile"),
        icon: Eye,
        disabled: !shortcut?.canPreviewCurrentFile,
        disabledReason: !shortcut?.canPreviewCurrentFile
          ? i18n.t("git.contextMenu.previewCurrentFileUnavailable")
          : undefined,
        onSelect: () => {
          if (shortcut?.canPreviewCurrentFile) props.onPreviewCurrentFile?.(shortcut);
        },
      });
    }
    if (props.onOpenInTerminal) {
      actions.push({
        id: "open-terminal",
        kind: "action",
        group: "navigate",
        rank: 10,
        label: i18n.t("git.contextMenu.openTerminal"),
        icon: Terminal,
        disabled: !directoryRequest,
        disabledReason: !directoryRequest ? i18n.t("git.notifications.repositoryPathUnavailable") : undefined,
        onSelect: () => {
          if (directoryRequest) props.onOpenInTerminal?.(directoryRequest);
        },
      });
    }
    if (props.onBrowseFiles) {
      actions.push({
        id: "browse-files",
        kind: "action",
        group: "navigate",
        rank: 20,
        label: i18n.t("git.contextMenu.browseFiles"),
        icon: Folder,
        disabled: !directoryRequest,
        disabledReason: !directoryRequest ? i18n.t("git.notifications.repositoryPathUnavailable") : undefined,
        onSelect: () => {
          if (directoryRequest) void props.onBrowseFiles?.(directoryRequest);
        },
      });
    }
    if (props.onCopyText) {
      actions.push(
        {
          id: "copy-absolute-path",
          kind: "action",
          group: "clipboard",
          rank: 10,
          label: i18n.t("git.contextMenu.copyAbsolutePath"),
          icon: Copy,
          disabled: !shortcut,
          disabledReason: !shortcut ? i18n.t("git.notifications.repositoryPathUnavailable") : undefined,
          onSelect: () => {
            if (shortcut) void props.onCopyText?.(shortcut.absolutePath);
          },
        },
        {
          id: "copy-relative-path",
          kind: "action",
          group: "clipboard",
          rank: 20,
          label: i18n.t("git.contextMenu.copyRelativePath"),
          icon: Copy,
          disabled: !shortcut,
          disabledReason: !shortcut ? i18n.t("git.notifications.repositoryPathUnavailable") : undefined,
          onSelect: () => {
            if (shortcut) void props.onCopyText?.(shortcut.relativePath);
          },
        },
      );
    }
    return actions;
  };
  const content = () => (
      <Show
        when={props.items.length > 0}
        fallback={
          <div class={cn("px-4 py-8", props.surface === "inline" && "px-0 py-3")}>
            <GitSubtleNote>
              {i18n.t('uiCopy.git.noChangedComparison')}
            </GitSubtleNote>
          </div>
        }
      >
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
              <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>{i18n.t('git.common.path')}</th>
              <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>{i18n.t('git.common.status')}</th>
              <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>{i18n.t('git.common.changes')}</th>
              <th class={GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS}>{i18n.t('git.common.action')}</th>
            </tr>
          }
          renderRow={(item) => {
            const active = () =>
              props.selectedKey === gitDiffEntryIdentity(item);
            return (
              <tr
                aria-selected={active()}
                class={gitChangedFilesRowClass(active())}
                tabIndex={0}
                onContextMenu={(event) => {
                  event.stopPropagation();
                  contextMenu.openFromContextMenu(event, contextTarget(item));
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                  event.stopPropagation();
                  contextMenu.openFromKeyboard(event, contextTarget(item));
                }}
              >
                <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                  <div class="min-w-0">
                    <button
                      type="button"
                      class={`block max-w-full cursor-pointer truncate text-left text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${gitChangePathClass(item.changeType)}`}
                      title={changeSecondaryPath(item)}
                      onClick={() => props.onOpenDiff?.(item, props.context)}
                    >
                      {compareFilePath(item, i18n.t('filePreview.unknownPath'))}
                    </button>
                    <Show
                      when={changeSecondaryPath(item) !== compareFilePath(item, i18n.t('filePreview.unknownPath'))}
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
                <td class={GIT_CHANGED_FILES_CELL_MIDDLE_CLASS}>
                  <GitTableBadge tone={gitChangeTone(item.changeType ?? undefined)}>
                    {localizedGitChangeLabel(item.changeType, i18n)}
                  </GitTableBadge>
                </td>
                <td class={GIT_CHANGED_FILES_CELL_MIDDLE_CLASS}>
                  <GitChangeMetrics
                    additions={item.additions}
                    deletions={item.deletions}
                  />
                </td>
                <td class={gitChangedFilesStickyCellClass(active())}>
                  <GitChangedFilesActionButton
                    onClick={() => props.onOpenDiff?.(item, props.context)}
                  >
                    {i18n.t('files.menuViewDiff')}
                  </GitChangedFilesActionButton>
                </td>
              </tr>
            );
          }}
        />
      </Show>
  );

  return props.surface === "inline" ? (
    <>
      <div
        class="git-branch-history-files flex min-h-0 flex-1 flex-col"
        data-git-branch-commit-files-surface="inline"
      >
        {content()}
      </div>
      <GitEntityContextMenu controller={contextMenu} items={contextMenuItems} />
    </>
  ) : (
    <>
      <GitTableFrame class="flex min-h-0 flex-1 flex-col">
        {content()}
      </GitTableFrame>
      <GitEntityContextMenu controller={contextMenu} items={contextMenuItems} />
    </>
  );
}

interface BranchStatusTableProps {
  canonicalRepoRootPath: string;
  repoRootPath: string;
  branch: GitBranchSummary;
  section: GitWorkspaceViewSection;
  items: GitWorkspaceChange[];
  totalCount: number;
  scopeFileCount?: number;
  directoryPath?: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  selectedKey?: string;
  onOpenDiff?: (item: GitWorkspaceChange, context: BranchStatusItemContextMenuTarget) => void;
  onOpenDirectory?: (directoryPath: string) => void;
  onLoadMore?: () => void;
  onAskFlower?: GitBranchesPanelProps["onAskFlower"];
  onOpenInTerminal?: GitBranchesPanelProps["onOpenInTerminal"];
  onBrowseFiles?: GitBranchesPanelProps["onBrowseFiles"];
  onPreviewCurrentFile?: GitBranchesPanelProps["onPreviewCurrentFile"];
  onCopyText?: GitBranchesPanelProps["onCopyText"];
}

type BranchStatusItemContextMenuTarget = Readonly<{
  item: GitWorkspaceChange;
  repoRootPath: string;
  liveRootPath: string;
  branch: GitBranchSummary;
  section: GitWorkspaceViewSection;
}>;

function BranchStatusEmptyState(props: {
  section: GitWorkspaceViewSection;
  directoryPath?: string;
}) {
  const i18n = useI18n();
  const presentation = () =>
    branchStatusEmptyPresentation(
      props.section,
      i18n,
      exactGitPath(props.directoryPath),
    );
  const Icon = () => branchStatusEmptyIcon(props.section);
  return (
    <div
      class="git-branch-status-empty-state"
      data-git-branch-status-empty-section={props.section}
      role="status"
      aria-live="polite"
    >
      <div class="git-branch-status-empty-state__mark" aria-hidden="true">
        <Dynamic
          component={Icon()}
          class="git-branch-status-empty-state__icon"
        />
      </div>
      <div class="git-branch-status-empty-state__copy">
        <div class="git-branch-status-empty-state__title">
          {presentation().title}
        </div>
        <div class="git-branch-status-empty-state__detail">
          {presentation().detail}
        </div>
      </div>
    </div>
  );
}

function BranchStatusEmptyTable(props: {
  section: GitWorkspaceViewSection;
  directoryPath?: string;
}) {
  const i18n = useI18n();
  return (
    <div
      class="git-branch-status-empty-table"
      data-git-branch-status-empty-table="true"
      data-git-branch-status-empty-section={props.section}
    >
      <div class="git-branch-status-empty-table__content">
        <div class="git-branch-status-empty-table__header" aria-hidden="true">
          <For each={BRANCH_STATUS_TABLE_COLUMN_KEYS}>
            {(key) => <span>{i18n.t(key)}</span>}
          </For>
        </div>
        <div class="git-branch-status-empty-table__body">
          <BranchStatusEmptyState
            section={props.section}
            directoryPath={props.directoryPath}
          />
        </div>
      </div>
    </div>
  );
}

function BranchStatusUnavailableTable(props: {
  state: BranchStatusUnavailablePresentation;
}) {
  const i18n = useI18n();
  return (
    <div
      class="git-branch-status-empty-table git-branch-status-unavailable"
      data-git-branch-status-empty-table="true"
      data-git-branch-status-unavailable="true"
    >
      <div class="git-branch-status-empty-table__content">
        <div class="git-branch-status-empty-table__header" aria-hidden="true">
          <For each={BRANCH_STATUS_TABLE_COLUMN_KEYS}>
            {(key) => <span>{i18n.t(key)}</span>}
          </For>
        </div>
        <div class="git-branch-status-empty-table__body">
          <div
            class="git-branch-status-unavailable__state"
            role="status"
            aria-live="polite"
          >
            <div class="git-branch-status-unavailable__mark" aria-hidden="true">
              <AlertTriangle class="git-branch-status-unavailable__icon" />
            </div>
            <div class="git-branch-status-unavailable__copy">
              <div class="git-branch-status-unavailable__title">
                {props.state.title}
              </div>
              <div class="git-branch-status-unavailable__detail">
                {props.state.detail}
              </div>
              <Show when={props.state.hint}>
                <div class="git-branch-status-unavailable__hint">
                  {props.state.hint}
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BranchStatusTable(props: BranchStatusTableProps) {
  const i18n = useI18n();
  const contextMenu = createGitEntityContextMenuController<BranchStatusItemContextMenuTarget>({
    snapshotTarget: (target) => ({
      ...target,
      item: { ...target.item },
      branch: { ...target.branch },
    }),
  });
  const menuTarget = (item: GitWorkspaceChange): BranchStatusItemContextMenuTarget => ({
    item,
    repoRootPath: props.canonicalRepoRootPath,
    liveRootPath: props.repoRootPath,
    branch: props.branch,
    section: props.section,
  });
  const shortcutTarget = (target: BranchStatusItemContextMenuTarget) =>
    buildGitFileShortcutTarget({ rootPath: target.liveRootPath, item: target.item });
  const directoryRequest = (target: BranchStatusItemContextMenuTarget) => {
    if (isGitWorkspaceDirectoryEntry(target.item)) {
      return buildGitDirectoryShortcutRequest({
        rootPath: target.liveRootPath,
        directoryPath: workspaceDirectoryPath(target.item),
      });
    }
    const shortcut = shortcutTarget(target);
    return shortcut
      ? buildGitDirectoryShortcutRequest({ rootPath: shortcut.parentDirectoryPath })
      : null;
  };
  const contextMenuItems = (context: BranchStatusItemContextMenuTarget): GitContextMenuActionItem[] => {
    const item = context.item;
    const directory = isGitWorkspaceDirectoryEntry(item);
    const target = shortcutTarget(context);
    const browseRequest = directoryRequest(context);
    const actions: GitContextMenuActionItem[] = [];
    if (props.onAskFlower) {
      actions.push({
        id: "ask-flower",
        kind: "action",
        group: "assistant",
        rank: 10,
        label: i18n.t("git.contextMenu.askFlower"),
        icon: FlowerIcon,
        onSelect: () => props.onAskFlower?.({
          kind: "branch_status_item",
          repoRootPath: context.repoRootPath,
          worktreePath: context.liveRootPath,
          branch: context.branch,
          section: context.section,
          item,
        }),
      });
    }
    if (directory && props.onOpenDirectory) {
      actions.push({
        id: "open-directory",
        kind: "action",
        group: "inspect",
        rank: 10,
        label: i18n.t("git.contextMenu.openDirectory"),
        icon: Folder,
        onSelect: () => {
          const path = workspaceDirectoryPath(item);
          if (path) props.onOpenDirectory?.(path);
        },
      });
    }
    if (!directory && props.onOpenDiff) {
      actions.push({
        id: "view-diff",
        kind: "action",
        group: "inspect",
        rank: 10,
        label: i18n.t("git.contextMenu.viewDiff"),
        icon: ArrowRightLeft,
        onSelect: () => props.onOpenDiff?.(item, context),
      });
    }
    if (
      !directory
      && props.onPreviewCurrentFile
      && String(item.changeType ?? "").toLowerCase() !== "deleted"
    ) {
      actions.push({
        id: "preview-current-file",
        kind: "action",
        group: "inspect",
        rank: 20,
        label: i18n.t("git.contextMenu.previewCurrentFile"),
        icon: Eye,
        disabled: !target?.canPreviewCurrentFile,
        disabledReason: !target?.canPreviewCurrentFile
          ? i18n.t("git.contextMenu.previewCurrentFileUnavailable")
          : undefined,
        onSelect: () => {
          if (target?.canPreviewCurrentFile) props.onPreviewCurrentFile?.(target);
        },
      });
    }
    if (props.onOpenInTerminal) {
      actions.push({
        id: "open-terminal",
        kind: "action",
        group: "navigate",
        rank: 10,
        label: i18n.t("git.contextMenu.openTerminal"),
        icon: Terminal,
        disabled: !browseRequest,
        disabledReason: !browseRequest ? i18n.t("git.notifications.repositoryPathUnavailable") : undefined,
        onSelect: () => {
          if (browseRequest) props.onOpenInTerminal?.(browseRequest);
        },
      });
    }
    if (props.onBrowseFiles) {
      actions.push({
        id: "browse-files",
        kind: "action",
        group: "navigate",
        rank: 20,
        label: i18n.t("git.contextMenu.browseFiles"),
        icon: Folder,
        disabled: !browseRequest,
        disabledReason: !browseRequest ? i18n.t("git.notifications.repositoryPathUnavailable") : undefined,
        onSelect: () => {
          if (browseRequest) void props.onBrowseFiles?.(browseRequest);
        },
      });
    }
    if (props.onCopyText) {
      actions.push(
        {
          id: "copy-absolute-path",
          kind: "action",
          group: "clipboard",
          rank: 10,
          label: i18n.t("git.contextMenu.copyAbsolutePath"),
          icon: Copy,
          disabled: !target,
          disabledReason: !target ? i18n.t("git.notifications.repositoryPathUnavailable") : undefined,
          onSelect: () => {
            if (target) void props.onCopyText?.(target.absolutePath);
          },
        },
        {
          id: "copy-relative-path",
          kind: "action",
          group: "clipboard",
          rank: 20,
          label: i18n.t("git.contextMenu.copyRelativePath"),
          icon: Copy,
          disabled: !target,
          disabledReason: !target ? i18n.t("git.notifications.repositoryPathUnavailable") : undefined,
          onSelect: () => {
            if (target) void props.onCopyText?.(target.relativePath);
          },
        },
      );
    }
    return actions;
  };
  const footerSummary = () => {
    const totalRows = Math.max(0, Number(props.totalCount ?? 0));
    const scopedFiles = Math.max(
      0,
      Number(props.scopeFileCount ?? props.totalCount ?? 0),
    );
    if (props.section === "changes" && scopedFiles !== totalRows) {
      return i18n.t('uiCopy.git.showingRows', {
        range: props.items.length,
        total: totalRows,
        count: scopedFiles,
      });
    }
    return i18n.t('uiCopy.git.showingFiles', {
      range: props.items.length,
      total: scopedFiles,
    });
  };

  return (
    <GitTableFrame class="flex min-h-0 flex-1 flex-col">
      <Show
        when={props.items.length > 0}
        fallback={
          <BranchStatusEmptyTable
            section={props.section}
            directoryPath={props.directoryPath}
          />
        }
      >
        <GitVirtualTable
          items={props.items}
          tableClass={`${GIT_CHANGED_FILES_TABLE_CLASS} min-w-[36rem] sm:min-w-[52rem] md:min-w-0`}
          header={
            <tr class={GIT_CHANGED_FILES_HEADER_ROW_CLASS}>
              <For each={BRANCH_STATUS_TABLE_COLUMN_KEYS}>
                {(key) => (
                  <th
                    class={
                      key === "git.common.action"
                        ? GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS
                        : GIT_CHANGED_FILES_HEADER_CELL_CLASS
                    }
                  >
                    {i18n.t(key)}
                  </th>
                )}
              </For>
            </tr>
          }
          renderRow={(item) => {
            const active = () => props.selectedKey === workspaceEntryKey(item);
            return (
              <tr
                aria-selected={active()}
                class={`${gitChangedFilesRowClass(active())} cursor-pointer`}
                tabIndex={0}
                onContextMenu={(event) => {
                  event.stopPropagation();
                  contextMenu.openFromContextMenu(event, menuTarget(item));
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                  event.stopPropagation();
                  contextMenu.openFromKeyboard(event, menuTarget(item));
                }}
                onClick={() => {
                  if (isGitWorkspaceDirectoryEntry(item)) {
                    const nextDirectoryPath = workspaceDirectoryPath(item);
                    if (nextDirectoryPath) {
                      props.onOpenDirectory?.(nextDirectoryPath);
                    }
                    return;
                  }
                  props.onOpenDiff?.(item, menuTarget(item));
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
                        props.onOpenDiff?.(item, menuTarget(item));
                      }}
                    >
                      <Show
                        when={isGitWorkspaceDirectoryEntry(item)}
                        fallback={worktreeFilePath(item, i18n.t('filePreview.unknownPath'))}
                      >
                        <span class="inline-flex items-center gap-1.5">
                          <Folder class="size-3.5 shrink-0" />
                          <span class="truncate">
                            {branchStatusPrimaryLabel(item, i18n.t('filePreview.unknownPath'))}
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
                        && changeSecondaryPath(item) !== worktreeFilePath(item, i18n.t('filePreview.unknownPath'))
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
                <td class={`${GIT_CHANGED_FILES_CELL_MIDDLE_CLASS} text-muted-foreground`}>
                  <Show
                    when={isGitWorkspaceDirectoryEntry(item)}
                    fallback={workspaceSectionLabel(
                      (item.section as GitWorkspaceSection | undefined) ??
                        "unstaged",
                    )}
                  >
                    {localizedWorkspaceViewSectionLabel(props.section, i18n)}
                  </Show>
                </td>
                <td class={GIT_CHANGED_FILES_CELL_MIDDLE_CLASS}>
                  <Show
                    when={isGitWorkspaceDirectoryEntry(item)}
                    fallback={
                      <GitTableBadge tone={gitChangeTone(item.changeType ?? undefined)}>
                        {localizedGitChangeLabel(item.changeType, i18n)}
                      </GitTableBadge>
                    }
                  >
                    <div class="flex flex-wrap items-center gap-1.5">
                      <GitTableBadge tone="neutral">{i18n.t('git.common.folder')}</GitTableBadge>
                      <Show when={item.containsUnstaged}>
                        <GitTableBadge tone="warning">{i18n.t('git.common.unstaged')}</GitTableBadge>
                      </Show>
                      <Show when={item.containsUntracked}>
                        <GitTableBadge tone="brand">{i18n.t('git.common.untracked')}</GitTableBadge>
                      </Show>
                    </div>
                  </Show>
                </td>
                <td class={GIT_CHANGED_FILES_CELL_MIDDLE_CLASS}>
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
                      {branchStatusDirectorySummary(item, i18n)}
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
                      props.onOpenDiff?.(item, menuTarget(item));
                    }}
                  >
                    {isGitWorkspaceDirectoryEntry(item)
                      ? i18n.t('uiCopy.git.openFolder')
                      : i18n.t('uiCopy.git.viewDiff')}
                  </GitChangedFilesActionButton>
                </td>
              </tr>
            );
          }}
        />
        <Show
          when={(props.hasMore || props.loadingMore) && props.items.length > 0}
        >
          <GitPagedTableFooter
            summary={footerSummary()}
            onLoadMore={props.onLoadMore}
            hasMore={props.hasMore}
            loading={props.loadingMore}
            loadingStatus={i18n.t('git.common.loadingNextPage')}
          />
        </Show>
      </Show>
      <GitEntityContextMenu controller={contextMenu} items={contextMenuItems} />
    </GitTableFrame>
  );
}

type BranchHistoryCommitDetailState = {
  commit?: GitCommitDetail;
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

interface BranchHistoryCommitDetailsProps {
  commit: GitCommitSummary;
  detail?: BranchHistoryCommitDetailState;
  files: GitCommitFileSummary[];
  presentation?: GitCommitDiffPresentation;
  fileTotals: ReturnType<typeof summarizeCommitFileChanges>;
  selectedDiffKey?: string;
  repoRootPath: string;
  branchName?: string;
  askFlowerLabel: string;
  switchDetachedBusy?: boolean;
  alreadyDetachedHere?: boolean;
  onAskFlower?: GitBranchesPanelProps["onAskFlower"];
  onSwitchDetached?: GitBranchesPanelProps["onSwitchDetached"];
  onOpenDiff?: (item: GitCommitFileSummary, commitHash: string) => void;
  onOpenInTerminal?: GitBranchesPanelProps["onOpenInTerminal"];
  onBrowseFiles?: GitBranchesPanelProps["onBrowseFiles"];
  onPreviewCurrentFile?: GitBranchesPanelProps["onPreviewCurrentFile"];
  onCopyText?: GitBranchesPanelProps["onCopyText"];
}

function BranchHistoryCommitDetails(props: BranchHistoryCommitDetailsProps) {
  const i18n = useI18n();
  const [messageDialogOpen, setMessageDialogOpen] = createSignal(false);
  const presentationBadge = () =>
    localizedGitCommitDiffPresentationBadge(props.presentation, i18n);
  const presentationDetail = () =>
    localizedGitCommitDiffPresentationDetail(props.presentation, i18n);
  const fileCountLabel = () =>
    i18n.t('git.common.fileCount', { count: props.files.length });
  const fullCommitDetail = (): GitCommitDetail => props.detail?.commit ?? {
    hash: props.commit.hash,
    shortHash: props.commit.shortHash,
    parents: [...(props.commit.parents ?? [])],
    authorName: props.commit.authorName,
    authorEmail: props.commit.authorEmail,
    authorTimeMs: props.commit.authorTimeMs,
    subject: props.commit.subject,
    body: props.commit.bodyPreview,
  };

  return (
    <>
      <div class="git-branch-history-details" data-git-branch-history-details>
        <Show
          when={props.detail && !props.detail.loading}
          fallback={
            <GitStatePane
              loading
              loadingVariant="commit-detail"
              loadingRows={3}
              message={i18n.t('uiCopy.git.loadingChangedFiles')}
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
                      {props.commit.subject || i18n.t('uiCopy.git.noSubject')}
                    </div>
                    <div class="git-branch-history-summary-detail">
                      {props.commit.shortHash} · {props.commit.authorName || i18n.t('uiCopy.git.unknownAuthor')} · {formatAbsoluteTime(props.commit.authorTimeMs)}
                    </div>
                  </div>
                </div>
                <div class="git-branch-history-summary-meta">
                  <GitMetaPill tone="neutral">{fileCountLabel()}</GitMetaPill>
                  <Show when={presentationBadge()}>
                    {(badge) => (
                      <GitMetaPill tone="violet">{badge()}</GitMetaPill>
                    )}
                  </Show>
                </div>
              </div>

              <div class="git-branch-history-actions">
                <div class="git-branch-history-action-group">
                  <Button
                    size="sm"
                    variant="outline"
                    data-git-full-commit-message-trigger
                    class={cn(
                      "rounded-md bg-background/70",
                      redevenSurfaceRoleClass("control"),
                    )}
                    onClick={() => setMessageDialogOpen(true)}
                  >
                    <FileText class="mr-1 h-3.5 w-3.5" />
                    {i18n.t('uiCopy.git.viewFullCommitMessage')}
                  </Button>
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
                        ? i18n.t('uiCopy.git.switching')
                        : props.alreadyDetachedHere
                          ? i18n.t('uiCopy.git.alreadyDetachedHere')
                          : i18n.t('uiCopy.git.switchDetachHere')}
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
                <Show when={props.files.length > 0}>
                  <div class="git-branch-history-hint">
                    {i18n.t('uiCopy.git.selectFileDiff')}
                  </div>
                </Show>
              </div>

              <Show when={presentationDetail()}>
                {(detail) => (
                  <div class="git-branch-history-note">{detail()}</div>
                )}
              </Show>

              <Show
                when={props.onSwitchDetached && props.alreadyDetachedHere}
              >
                <div class="git-branch-history-note">
                  {i18n.t('uiCopy.git.alreadyDetached')}
                </div>
              </Show>

              <Show
                when={props.files.length > 0}
                fallback={(
                  <div class="git-branch-history-note">
                    {i18n.t('uiCopy.git.noCommitFiles')}
                  </div>
                )}
              >
                <div class="flex items-center justify-between gap-2 text-[11px] font-medium text-foreground">
                  <span>{i18n.t('uiCopy.git.filesInCommit')}</span>
                  <GitChangeMetrics
                    additions={props.fileTotals.additions}
                    deletions={props.fileTotals.deletions}
                  />
                </div>
                <BranchCompareFilesTable
                  surface="inline"
                  items={props.files}
                  selectedKey={props.selectedDiffKey}
                  context={{
                    kind: 'commit',
                    repoRootPath: props.repoRootPath,
                    liveRootPath: props.repoRootPath,
                    branchName: props.branchName,
                    commit: props.commit,
                  }}
                  onOpenDiff={(item, context) => props.onOpenDiff?.(
                    item,
                    context.kind === 'commit' ? context.commit.hash : props.commit.hash,
                  )}
                  onAskFlower={props.onAskFlower}
                  onOpenInTerminal={props.onOpenInTerminal}
                  onBrowseFiles={props.onBrowseFiles}
                  onPreviewCurrentFile={props.onPreviewCurrentFile}
                  onCopyText={props.onCopyText}
                />
              </Show>
            </div>
          </Show>
        </Show>
      </div>
      <GitCommitMessageDialog
        open={messageDialogOpen()}
        commit={fullCommitDetail()}
        onOpenChange={setMessageDialogOpen}
        onCopyText={props.onCopyText}
      />
    </>
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
    | "onOpenInTerminal"
    | "onBrowseFiles"
    | "onPreviewCurrentFile"
    | "onCopyText"
  > & {
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
    exactGitPath(props.repoRootPath),
  );
  const headDisplay = createMemo(() => localizedGitHeadDisplay(describeGitHead(props.repoSummary), i18n));
  const currentHeadCommit = createMemo(() =>
    String(props.repoSummary?.headCommit ?? "").trim(),
  );
  const historyContextKey = createMemo(() => {
    const repo = repoRootPath();
    const branchKey = String(
      props.selectedBranch?.fullName ?? props.selectedBranch?.name ?? "",
    ).trim();
    if (!repo || !branchKey) return "";
    return gitBranchPanelIdentityKey(repo, branchKey);
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
  const selectedCommit = createMemo(() =>
    (props.commits ?? []).find((commit) => commit.hash === expandedCommitHash()) ?? null,
  );
  const selectedDetail = createMemo(() => {
    const hash = expandedCommitHash();
    return hash ? commitDetails()[hash] : undefined;
  });
  const selectedBranchName = () => props.selectedBranch
    ? branchDisplayName(props.selectedBranch)
    : undefined;

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
    const requestKey = gitBranchPanelIdentityKey(contextKey, hash);
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
                commit: resp?.commit,
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
      .catch(() => {
        setCommitDetailsByContext((prev) => {
          const currentContext = prev[contextKey] ?? {};
          return {
            ...prev,
            [contextKey]: {
              ...currentContext,
              [hash]: {
                files: [],
                loading: false,
                error: i18n.t('git.common.requestFailed'),
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
              when={!props.listLoading}
              fallback={
                <GitStatePane
                  loading
                  loadingVariant="commit-graph-detail"
                  loadingRows={10}
                  message={i18n.t('uiCopy.git.loadingCommitHistory')}
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
                        {i18n.t('uiCopy.git.noBranchHistory')}
                      </GitSubtleNote>
                    }
                  >
                    <div
                      class="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-3 xl:grid-cols-[minmax(19rem,0.85fr)_minmax(26rem,1.15fr)] xl:grid-rows-1"
                      data-git-branch-history-layout="graph-detail"
                    >
                      <div {...GIT_WORKBENCH_SCROLL_REGION_PROPS} class="min-h-0 overflow-auto">
                        <GitCommitGraph
                          commits={props.commits ?? []}
                          selectedCommitHash={expandedCommitHash()}
                          onSelect={toggleCommit}
                          repoRootPath={repoRootPath()}
                          location="branch_history"
                          branchName={selectedBranchName()}
                          resolveCommitFiles={(commit) => commitDetails()[commit.hash]?.files ?? []}
                          onAskFlower={props.onAskFlower}
                          onOpenInTerminal={props.onOpenInTerminal}
                          onBrowseFiles={props.onBrowseFiles}
                          onSwitchDetached={props.onSwitchDetached}
                          switchDetachedBusy={props.switchDetachedBusy}
                          alreadyDetachedCommitHash={headDisplay().detached ? currentHeadCommit() : undefined}
                          onCopyText={props.onCopyText}
                          class="rounded-md"
                        />
                        <Show when={props.hasMore}>
                          <div class="pt-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              class={cn("w-full", gitToneActionButtonClass())}
                              onClick={props.onLoadMore}
                              disabled={props.listLoadingMore}
                            >
                              <Show when={!props.listLoadingMore} fallback={<GitInlineLoadingStatus>{i18n.t('git.common.loadingNextPage')}</GitInlineLoadingStatus>}>
                                {i18n.t('uiCopy.git.loadMore')}
                              </Show>
                            </Button>
                          </div>
                        </Show>
                      </div>

                      <div {...GIT_WORKBENCH_SCROLL_REGION_PROPS} class={cn('min-h-0 overflow-auto rounded-md border', redevenSurfaceRoleClass('panel'), redevenDividerRoleClass())}>
                        <Show
                          when={selectedCommit()}
                          fallback={(
                            <div class="flex h-full min-h-[8rem] items-center justify-center px-5 text-center text-xs text-muted-foreground">
                              {i18n.t('uiCopy.git.chooseCommit')}
                            </div>
                          )}
                        >
                          {(commit) => {
                            const detail = () => selectedDetail();
                            const files = () => detail()?.files ?? [];
                            return (
                              <BranchHistoryCommitDetails
                                commit={commit()}
                                detail={detail()}
                                files={files()}
                                presentation={detail()?.presentation}
                                fileTotals={summarizeCommitFileChanges(files())}
                                selectedDiffKey={selectedDiffKey()}
                                repoRootPath={repoRootPath()}
                                branchName={selectedBranchName()}
                                askFlowerLabel={i18n.t("git.changes.askFlower")}
                                switchDetachedBusy={props.switchDetachedBusy}
                                alreadyDetachedHere={headDisplay().detached && currentHeadCommit() === commit().hash}
                                onSwitchDetached={props.onSwitchDetached}
                                onAskFlower={props.onAskFlower}
                                onOpenInTerminal={props.onOpenInTerminal}
                                onBrowseFiles={props.onBrowseFiles}
                                onPreviewCurrentFile={props.onPreviewCurrentFile}
                                onCopyText={props.onCopyText}
                                onOpenDiff={(item, commitHash) => {
                                  setDiffDialogItem(item);
                                  setDiffDialogCommitHash(commitHash);
                                  setDiffDialogOpen(true);
                                }}
                              />
                            );
                          }}
                        </Show>
                      </div>
                    </div>
                  </Show>
                </div>
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
        title={i18n.t('uiCopy.git.commitDiff')}
        description={
          diffDialogItem()
            ? changeSecondaryPath(diffDialogItem())
            : i18n.t('uiCopy.git.reviewSelectedFileDiff')
        }
        emptyMessage={i18n.t('uiCopy.git.selectChangedFile')}
      />
    </>
  );
}

function BranchSelect(props: {
  value: string;
  branches: GitBranchSummary[];
  onChange: (name: string) => void;
  class?: string;
}) {
  const i18n = useI18n();
  const optionLabel = (branch: GitBranchSummary): string => {
    const name = branchDisplayName(branch);
    if (branch.kind === 'remote') return `${name} · ${i18n.t('uiCopy.git.remote')}`;
    if (branch.current) return `${name} · ${i18n.t('uiCopy.git.current')}`;
    return name;
  };
  const selected = () =>
    props.branches.find((b) => String(b.name ?? "").trim() === props.value);
  const items = (): DropdownItem[] =>
    props.branches.map((b) => ({
      id: String(b.name ?? "").trim(),
      label: optionLabel(b),
      icon: () => <GitBranch class="h-3.5 w-3.5" />,
    }));

  return (
    <Dropdown
      trigger={
        <button
          type="button"
          class={cn(
            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground transition-colors",
            "hover:bg-muted/[0.08] focus:outline-none focus:ring-2 focus:ring-ring/70",
            redevenSurfaceRoleClass("control"),
            props.class,
          )}
        >
          <GitBranch class="h-4 w-4 shrink-0 text-[var(--redeven-categorical-6)]" />
          <span class="min-w-0 flex-1 truncate text-left">
            {selected() ? optionLabel(selected()!) : i18n.t('uiCopy.git.selectBranch')}
          </span>
          <ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      }
      items={items()}
      value={props.value}
      onSelect={props.onChange}
      align="start"
    />
  );
}

interface BranchCompareDialogProps {
  open: boolean;
  repoRootPath?: string;
  branches?: GitListBranchesResponse | null;
  selectedBranch?: GitBranchSummary | null;
  onClose: () => void;
  onAskFlower?: GitBranchesPanelProps["onAskFlower"];
  onOpenInTerminal?: GitBranchesPanelProps["onOpenInTerminal"];
  onBrowseFiles?: GitBranchesPanelProps["onBrowseFiles"];
  onPreviewCurrentFile?: GitBranchesPanelProps["onPreviewCurrentFile"];
  onCopyText?: GitBranchesPanelProps["onCopyText"];
}

function BranchCompareDialog(props: BranchCompareDialogProps) {
  const i18n = useI18n();
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
  const [diffDialogSource, setDiffDialogSource] = createSignal<Extract<BranchFileContext, { kind: 'compare' }> | null>(null);

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
      setDiffDialogSource(null);
      return;
    }

    const repoRootPath = exactGitPath(props.repoRootPath);
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
      .catch(() => {
        if (seq !== compareReqSeq) return;
        setCompare(null);
        setError(i18n.t('git.common.requestFailed'));
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
        title={i18n.t('uiCopy.git.compareBranches')}
        description={i18n.t('uiCopy.git.compareDescription')}
        class={cn(
          "flex max-w-none flex-col overflow-hidden rounded-md border border-border/60 p-0 shadow-xl",
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
                <GitLabelBlock class="min-w-0" label={i18n.t('skillsSettings.table.source')} tone="violet">
                  <BranchSelect
                    value={sourceRef()}
                    branches={branchOptions()}
                    onChange={setSourceRef}
                  />
                </GitLabelBlock>
              </label>

              <label class="block">
                <GitLabelBlock class="min-w-0" label={i18n.t('git.common.target')} tone="violet">
                  <BranchSelect
                    value={targetRef()}
                    branches={branchOptions()}
                    onChange={setTargetRef}
                  />
                </GitLabelBlock>
              </label>
            </div>
          </div>

          <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-2 pb-4">
            <Show
              when={!loading()}
              fallback={
                <GitStatePane loading loadingVariant="comparison" loadingRows={6} message={i18n.t('uiCopy.git.loadingBranchCompare')} />
              }
            >
              <Show
                when={!error()}
                fallback={<GitStatePane tone="error" message={error()} />}
              >
                <Show
                  when={compare()}
                  fallback={
                    <GitStatePane message={i18n.t('uiCopy.git.chooseTwoBranches')} />
                  }
                >
                  {(compareAccessor) => (
                    <div class="flex min-h-0 flex-1 flex-col gap-3">
                      <div class="flex min-h-0 flex-1 flex-col gap-2">
                        <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                          <GitLabelBlock
                            class="min-w-0 flex-1"
                            label={i18n.t('uiCopy.git.changedFiles')}
                            tone="warning"
                            meta={
                              <>
                                <GitMetaPill tone="neutral">
                                  {compareAccessor().targetRef}
                                </GitMetaPill>
                                <GitMetaPill tone="neutral">
                                  {i18n.t('uiCopy.git.versus')} {compareAccessor().baseRef}
                                </GitMetaPill>
                                <GitMetaPill tone="warning">
                                  {i18n.tn('git.common.fileCount', compareFiles().length)}
                                </GitMetaPill>
                              </>
                            }
                          />
                          <div class="text-[11px] text-muted-foreground sm:text-right">
                            {i18n.t('uiCopy.git.openFileDiff')}
                          </div>
                        </div>

                        <div class="flex min-h-0 flex-1 overflow-hidden">
                          <BranchCompareFilesTable
                            items={compareFiles()}
                            selectedKey={selectedKey()}
                            context={{
                              kind: 'compare',
                              repoRootPath: exactGitPath(compareAccessor().repoRootPath ?? props.repoRootPath),
                              liveRootPath: exactGitPath(compareAccessor().repoRootPath ?? props.repoRootPath),
                              baseRef: compareAccessor().baseRef,
                              targetRef: compareAccessor().targetRef,
                            }}
                            onOpenDiff={(item, context) => {
                              if (context.kind !== 'compare') return;
                              setDiffDialogItem(item);
                              setDiffDialogSource({ ...context });
                              setDiffDialogOpen(true);
                            }}
                            onAskFlower={props.onAskFlower}
                            onOpenInTerminal={props.onOpenInTerminal}
                            onBrowseFiles={props.onBrowseFiles}
                            onPreviewCurrentFile={props.onPreviewCurrentFile}
                            onCopyText={props.onCopyText}
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
          if (!open) {
            setDiffDialogItem(null);
            setDiffDialogSource(null);
          }
        }}
        item={diffDialogItem()}
        source={
          diffDialogItem() && diffDialogSource()
            ? {
                kind: "compare",
                repoRootPath: diffDialogSource()!.repoRootPath,
                baseRef: diffDialogSource()!.baseRef,
                targetRef: diffDialogSource()!.targetRef,
              }
            : null
        }
        title={i18n.t('uiCopy.git.branchCompareDiff')}
        description={
          diffDialogItem()
            ? changeSecondaryPath(diffDialogItem())
            : i18n.t('uiCopy.git.reviewSelectedCompareDiff')
        }
        emptyMessage={i18n.t('uiCopy.git.selectComparedFile')}
      />
    </>
  );
}

export function GitBranchesPanel(props: GitBranchesPanelProps) {
  const rpc = useRedevenRpc();
  const notification = useNotification();
  const i18n = useI18n();
  const branchSubviewTabRefs = new Map<GitBranchSubview, HTMLButtonElement>();

  const [statusWorkspace, setStatusWorkspace] =
    createSignal<GitListWorkspaceChangesResponse | null>(null);
  const [statusPages, setStatusPages] = createSignal<
    Record<GitWorkspaceViewSection, GitWorkspaceViewPageState>
  >(createEmptyWorkspaceViewPageStateRecord());
  const [statusLoading, setStatusLoading] = createSignal(false);
  const [selectedStatusSection, setSelectedStatusSection] =
    createSignal<GitWorkspaceViewSection>("changes");
  const [statusSectionPinned, setStatusSectionPinned] = createSignal(false);
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] =
    createSignal<GitWorkspaceChange | null>(null);
  const [diffDialogRepoRootPath, setDiffDialogRepoRootPath] = createSignal('');
  const [compareDialogOpen, setCompareDialogOpen] = createSignal(false);
  const [compareDialogBranch, setCompareDialogBranch] = createSignal<GitBranchSummary | null>(null);
  const branchContextMenu = createGitEntityContextMenuController<BranchHeaderContextTarget>({
    snapshotTarget: (target) => ({ ...target, branch: { ...target.branch } }),
  });
  const statusScopeContextMenu = createGitEntityContextMenuController<BranchStatusScopeContextTarget>({
    snapshotTarget: (target) => ({
      ...target,
      branch: { ...target.branch },
      items: target.items.map((item) => ({ ...item })),
    }),
  });

  let statusReqSeqBySection: Record<GitWorkspaceViewSection, number> = {
    changes: 0,
    conflicted: 0,
    staged: 0,
  };
  let lastStatusDataContextKey = "";
  let lastStatusRefreshContextKey = "";
  let lastStatusSelectionContextKey = "";
  let statusWorkspaceRevision = '';
  let hasStatusProtocolContext = false;
  let lastStatusProtocolClientIdentity: object | null | undefined;
  let lastStatusCapabilityMode: GitCapabilityMode | undefined;

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
      return i18n.t('common.status.checking');
    }
    if (state.kind === "missing") return state.detail;
    if (state.kind === "error") {
      return state.message || i18n.t('common.status.failed');
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
    exactGitPath(props.repoRootPath || props.repoSummary?.repoRootPath);
  const repoHeadDisplay = () => localizedGitHeadDisplay(describeGitHead(props.repoSummary), i18n);
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
    for (const section of WORKSPACE_VIEW_SECTIONS) statusReqSeqBySection[section] += 1;
    setStatusWorkspace(null);
    setStatusPages(createEmptyWorkspaceViewPageStateRecord());
    setStatusLoading(false);
    statusWorkspaceRevision = '';
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
      directoryPath: String(page.directoryPath ?? ""),
      breadcrumbs: Array.isArray(page.breadcrumbs) ? [...page.breadcrumbs] : [],
    }));
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
      !visibleStatusPageState().initialized
        ? visibleStatusPageState().error
        : "",
    );
  const branchStatusPresentationState =
    (): GitBranchStatusPresentationState => {
      if (branchIsVerifying() || visibleStatusLoading()) return "loading";
      if (branchHasDetailIssue()) return "unavailable";
      if (!branchIsReady() || !statusRepoRootPath()) return "unavailable";
      if (visibleStatusError()) return "error";
      return visibleStatusWorkspace() ? "ready" : "unavailable";
    };
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
      ? String(visibleStatusPageState().directoryPath ?? "")
      : "";
  const statusBreadcrumbSegments = createMemo(() =>
    (visibleStatusPageState().breadcrumbs ?? []).map((crumb) => ({
      label: String(crumb.label ?? "").trim() || i18n.t('git.common.folder'),
      path: String(crumb.path ?? ""),
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
    branchStatusEmptyState(selectedBranch(), statusRepoRootPath(), i18n);
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
  const mergeLabel = () => props.mergeBusy ? i18n.t('git.branches.merging') : i18n.t('git.branches.mergeAction');
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
  const checkoutLabel = () => props.checkoutBusy ? i18n.t('gitPresentation.checkingOut') : i18n.t('git.common.checkout');
  const deleteAvailable = () =>
    Boolean(props.onDeleteBranch && selectedBranch()?.kind === "local");
  const deleteDisabled = () =>
    Boolean(
      !deleteAvailable() ||
        !interactiveBranch() ||
        props.deleteBusy ||
        interactiveBranch()?.current,
    );
  const deleteLabel = () => props.deleteBusy ? i18n.t('uiCopy.git.deleting') : i18n.t('common.actions.delete');
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
    if (!branch) return i18n.t('uiCopy.git.selectBranch');
    if (detailState.kind === "verifying")
      return i18n.t('common.status.checking');
    if (detailState.kind === "missing") return detailState.detail;
    if (detailState.kind === "error")
      return detailState.message || i18n.t('common.status.failed');
    if (branch.kind === "remote") return i18n.t('git.branches.checkoutRemoteFirst');
    if (branch.current)
      return activeRepoRootPath() ? "" : i18n.t('git.notifications.repositoryPathUnavailable');
    return i18n.t('git.branches.openBranchInWorktreeFirst');
  };
  const askFlowerStatusDisabledReason = () => {
    if (canAskFlowerStatus()) return "";
    if (!selectedBranch()) return i18n.t('uiCopy.git.selectBranch');
    if (visibleStatusLoading()) return i18n.t('common.status.loading');
    if (visibleStatusError()) return i18n.t('uiCopy.git.statusUnavailable');
    const workspaceReason = branchWorkspaceDisabledReason();
    if (workspaceReason) return workspaceReason;
    if (visibleStatusItems().length === 0) return i18n.t('git.changes.noFilesInSection');
    return i18n.t('git.notifications.askFlowerUnavailableTitle');
  };
  const branchWorkspaceShortcutDisabledReason = () => {
    if (branchDirectoryRequest()) return "";
    return branchWorkspaceDisabledReason() || i18n.t('git.notifications.repositoryPathUnavailable');
  };
  const openCompareDialog = (branch: GitBranchSummary | null | undefined) => {
    if (!branch) return;
    setCompareDialogBranch({ ...branch });
    setCompareDialogOpen(true);
  };
  const branchSummary = createMemo<BranchSummaryPresentation>(() => {
    const text = localizedBranchContextSummary(selectedBranch(), i18n);
    return {
      text,
      title: localizedBranchStatusSummary(selectedBranch(), i18n),
      visible: text !== i18n.t('gitPresentation.noExtraStatus'),
    };
  });
  const branchHeaderControls = createMemo<BranchHeaderControlGroups>(() => {
    const primaryActions: BranchPrimaryActionPresentation[] = [];
    const secondaryShortcuts: BranchShortcutPresentation[] = [];

    if (mergeAvailable() && selectedBranch()) {
      primaryActions.push({
        key: "merge",
        label: mergeLabel(),
        icon: ArrowRightLeft,
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
        icon: GitBranch,
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
        icon: Trash,
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
          label: i18n.t('git.branches.compareAction'),
          icon: ArrowRightLeft,
          emphasis: "neutral",
          disabled: !interactiveBranch(),
          disabledReason: branchVerificationDisabledReason(),
          busy: branchIsVerifying(),
          onPress: () => openCompareDialog(interactiveBranch()),
        },
      ];

      if (props.onOpenStash) {
        items.push({
          key: "stash",
          label: i18n.t('git.changes.stashAction'),
          icon: Package,
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
        label: i18n.t('git.changes.askFlower'),
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
        const countLabel = i18n.tn('git.common.fileCount', count);
        const label = localizedWorkspaceViewSectionLabel(section, i18n);
        return {
          section,
          label,
          compactLabel: label,
          shortLabel: label,
          count,
          active: selectedStatusSection() === section,
          compactCaption: count === 0 ? i18n.t('git.branches.noFiles') : countLabel,
          verboseCaption:
            count === 0
              ? i18n.t('git.branches.noFilesToReview')
              : i18n.t('git.branches.filesReady', { count: countLabel }),
        };
      });
    },
  );
  // Keep secondary, workspace, and destructive actions in one predictable
  // overflow menu at every width. The selected branch's actionable next step
  // is the only command promoted into the header.
  const branchHeaderMainAction = createMemo<
    BranchPrimaryActionPresentation | null
  >(() => {
    const actions = branchHeaderControls().primaryActions;
    return (
      actions.find((action) => action.key === "checkout" && !action.disabled) ??
      actions.find((action) => action.key === "merge" && !action.disabled) ??
      actions.find((action) => action.key !== "delete" && !action.disabled) ??
      null
    );
  });
  const branchHeaderOverflowActions = createMemo<
    BranchHeaderActionPresentation[]
  >(() => {
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

    return [...nonDangerPrimary, ...shortcuts, ...dangerPrimary];
  });
  const branchHeaderOverflowItems = createMemo<DropdownItem[]>(() =>
    branchHeaderOverflowActions().map((action) => {
      const label =
        action.key === "delete"
          ? i18n.t("git.contextMenu.deleteBranch")
          : action.key === "terminal"
            ? i18n.t("git.changes.openInTerminal")
            : action.key === "files"
              ? i18n.t("git.changes.browseFiles")
              : action.label;
      return {
        id: action.key,
        label:
          action.disabled && action.disabledReason
            ? `${label} — ${action.disabledReason}`
            : label,
        disabled: action.disabled,
      };
    }),
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
  const secondaryActionButtonClass = cn(
    "cursor-pointer rounded-md bg-background/70 px-3 hover:bg-background",
    redevenSurfaceRoleClass("control"),
  );
  const primaryActionButtonClass =
    "cursor-pointer rounded-md px-3";
  const dangerActionButtonClass =
    "cursor-pointer rounded-md border border-destructive/20 bg-destructive/[0.06] px-3 text-destructive hover:bg-destructive/[0.12] hover:text-destructive";
  const branchSubviewTabClass = (active: boolean) =>
    cn(
      "git-browser-segmented-tab cursor-pointer rounded-md px-3 py-1.5 text-center text-xs font-medium transition-colors duration-150",
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
  const branchContextMenuTarget = (branch: GitBranchSummary): BranchHeaderContextTarget => {
    const repoRootPath = activeRepoRootPath();
    return {
      branch,
      repoRootPath,
      liveRootPath: resolveGitBranchWorktreePath(branch, repoRootPath),
      repoDetached: Boolean(props.repoSummary?.detached),
    };
  };
  const branchContextMenuItems = (target: BranchHeaderContextTarget): GitContextMenuActionItem[] => {
    const branch = target.branch;
    const directoryRequest = buildGitDirectoryShortcutRequest({ rootPath: target.liveRootPath });
    const worktreeDisabledReason = directoryRequest
      ? undefined
      : !target.repoRootPath
        ? i18n.t('git.notifications.repositoryPathUnavailable')
        : branch.kind === 'remote'
          ? i18n.t('git.branches.checkoutRemoteFirst')
          : !branch.current && !branch.worktreePath
            ? i18n.t('git.branches.openBranchInWorktreeFirst')
            : i18n.t('git.branches.worktreeUnavailable');
    const actions: GitContextMenuActionItem[] = [];
    if (props.onAskFlower) {
      actions.push({
        id: "ask-flower",
        kind: "action",
        group: "assistant",
        rank: 10,
        label: i18n.t("git.contextMenu.askFlower"),
        icon: FlowerIcon,
        onSelect: () => props.onAskFlower?.({
          kind: "branch",
          repoRootPath: target.repoRootPath,
          branch,
        }),
      });
    }
    if (props.onOpenInTerminal) {
      actions.push({
        id: "open-terminal",
        kind: "action",
        group: "navigate",
        rank: 10,
        label: i18n.t("git.contextMenu.openTerminal"),
        icon: Terminal,
        disabled: !directoryRequest,
        disabledReason: worktreeDisabledReason,
        onSelect: () => {
          if (directoryRequest) props.onOpenInTerminal?.(directoryRequest);
        },
      });
    }
    if (props.onBrowseFiles) {
      actions.push({
        id: "browse-files",
        kind: "action",
        group: "navigate",
        rank: 20,
        label: i18n.t("git.contextMenu.browseFiles"),
        icon: Folder,
        disabled: !directoryRequest,
        disabledReason: worktreeDisabledReason,
        onSelect: () => {
          if (directoryRequest) void props.onBrowseFiles?.(directoryRequest);
        },
      });
    }
    if (props.onCheckoutBranch && (branch.kind === "local" || branch.kind === "remote")) {
      actions.push({
        id: "checkout-branch",
        kind: "action",
        group: "modify",
        rank: 10,
        label: i18n.t("git.contextMenu.checkoutBranch"),
        icon: GitBranch,
        disabled: Boolean(props.checkoutBusy) || Boolean(branch.current) || Boolean(branch.worktreePath),
        disabledReason: props.checkoutBusy
          ? i18n.t('gitPresentation.checkingOut')
          : branch.current
            ? i18n.t('uiCopy.git.current')
            : branch.worktreePath
              ? i18n.t('git.overview.linkedWorktree')
              : undefined,
        onSelect: () => props.onCheckoutBranch?.(branch),
      });
    }
    if (props.onMergeBranch && (branch.kind === "local" || branch.kind === "remote")) {
      actions.push({
        id: "merge-branch",
        kind: "action",
        group: "modify",
        rank: 20,
        label: i18n.t("git.contextMenu.mergeBranch"),
        icon: ArrowRightLeft,
        disabled: Boolean(props.mergeBusy) || target.repoDetached || Boolean(branch.current),
        disabledReason: props.mergeBusy
          ? i18n.t('git.branches.merging')
          : target.repoDetached
            ? i18n.t('uiCopy.git.detachedReadOnly')
            : branch.current
              ? i18n.t('uiCopy.git.current')
              : undefined,
        onSelect: () => props.onMergeBranch?.(branch),
      });
    }
    if (props.onCopyText) {
      actions.push({
        id: "copy-branch-name",
        kind: "action",
        group: "clipboard",
        rank: 10,
        label: i18n.t("git.contextMenu.copyBranchName"),
        icon: Copy,
        onSelect: () => void props.onCopyText?.(branchDisplayName(branch)),
      });
      if (target.liveRootPath) {
        actions.push({
          id: "copy-worktree-path",
          kind: "action",
          group: "clipboard",
          rank: 20,
          label: i18n.t("git.contextMenu.copyWorktreePath"),
          icon: Copy,
          onSelect: () => void props.onCopyText?.(target.liveRootPath),
        });
      }
    }
    if (props.onDeleteBranch && branch.kind === "local") {
      actions.push({
        id: "delete-branch",
        kind: "action",
        group: "destructive",
        rank: 10,
        label: i18n.t("git.contextMenu.deleteBranch"),
        icon: Trash,
        disabled: Boolean(props.deleteBusy) || Boolean(branch.current),
        disabledReason: props.deleteBusy
          ? i18n.t('uiCopy.git.deleting')
          : branch.current
            ? i18n.t('uiCopy.git.current')
            : undefined,
        onSelect: () => props.onDeleteBranch?.(branch),
      });
    }
    return actions;
  };
  const statusScopeContextTarget = (): BranchStatusScopeContextTarget | null => {
    const branch = interactiveBranch();
    const repoRootPath = activeRepoRootPath();
    const liveRootPath = statusRepoRootPath();
    if (!branch || !repoRootPath || !liveRootPath) return null;
    return {
      repoRootPath,
      liveRootPath,
      branch: { ...branch },
      section: selectedStatusSection(),
      directoryPath: activeStatusDirectoryPath(),
      items: visibleStatusItems().map((item) => ({ ...item })),
    };
  };
  const statusScopeContextMenuItems = (target: BranchStatusScopeContextTarget): GitContextMenuActionItem[] => {
    const directoryRequest = buildGitDirectoryShortcutRequest({
      rootPath: target.liveRootPath,
      directoryPath: target.directoryPath,
    });
    const items: GitContextMenuActionItem[] = [];
    if (props.onAskFlower) {
      items.push({
        id: 'ask-flower', kind: 'action', group: 'assistant', rank: 10,
        label: i18n.t('git.contextMenu.askFlower'), icon: FlowerIcon,
        onSelect: () => props.onAskFlower?.({
          kind: 'branch_status',
          repoRootPath: target.repoRootPath,
          worktreePath: target.liveRootPath,
          branch: target.branch,
          section: target.section,
          items: target.items,
        }),
      });
    }
    if (props.onOpenInTerminal) {
      items.push({
        id: 'open-terminal', kind: 'action', group: 'navigate', rank: 10,
        label: i18n.t('git.contextMenu.openTerminal'), icon: Terminal,
        disabled: !directoryRequest,
        disabledReason: directoryRequest ? undefined : i18n.t('git.notifications.repositoryPathUnavailable'),
        onSelect: () => { if (directoryRequest) props.onOpenInTerminal?.(directoryRequest); },
      });
    }
    if (props.onBrowseFiles) {
      items.push({
        id: 'browse-files', kind: 'action', group: 'navigate', rank: 20,
        label: i18n.t('git.contextMenu.browseFiles'), icon: Folder,
        disabled: !directoryRequest,
        disabledReason: directoryRequest ? undefined : i18n.t('git.notifications.repositoryPathUnavailable'),
        onSelect: () => { if (directoryRequest) void props.onBrowseFiles?.(directoryRequest); },
      });
    }
    items.push({
      id: 'compare-branch', kind: 'action', group: 'modify', rank: 10,
      label: i18n.t('git.branches.compareAction'), icon: ArrowRightLeft,
      onSelect: () => openCompareDialog(target.branch),
    });
    if (props.onOpenStash) {
      items.push({
        id: 'stash', kind: 'action', group: 'modify', rank: 20,
        label: i18n.t('git.changes.stashAction'), icon: Package,
        onSelect: () => props.onOpenStash?.({ tab: 'save', repoRootPath: target.liveRootPath, source: 'branch_status' }),
      });
    }
    return items;
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
      <span class="inline-flex items-center gap-1.5">
        <Show when={action.icon} keyed>
          {(Icon) => <Dynamic component={Icon} class="h-3.5 w-3.5" />}
        </Show>
        <span>{action.label}</span>
      </span>
    </Button>
  );
  const renderBranchHeaderOverflow = () => (
    <Show when={branchHeaderOverflowItems().length > 0}>
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
    if (state.kind === "error") return i18n.t('git.branches.unableToVerify');
    return i18n.t('common.status.checking');
  };
  const branchDetailStateDetail = () => {
    const state = branchDetailState();
    if (state.kind === "missing") return state.detail;
    if (state.kind === "error") {
      return state.message || i18n.t('common.status.failed');
    }
    return i18n.t('uiCopy.git.refreshingHistory');
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
              {state.kind === "missing" ? i18n.t('uiCopy.git.missing') : i18n.t('uiCopy.git.retryNeeded')}
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
              {i18n.t('uiCopy.git.refreshBranches')}
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
              {i18n.t('uiCopy.git.viewCurrentBranch')}
            </Button>
          </Show>
        </div>
      </div>
    );
  };
  const renderBranchStablePlaceholder = (view: GitBranchSubview) => {
    const checking = branchIsVerifying();
    const placeholderState = checking
      ? "verifying"
      : branchHasDetailIssue()
        ? "unavailable"
        : "waiting";
    const accessibilityLabel = view === "status"
      ? checking
        ? i18n.t('common.status.checking')
        : i18n.t('uiCopy.git.statusUnavailable')
      : checking
        ? i18n.t('common.status.checking')
        : i18n.t('uiCopy.git.historyUnavailable');
    return (
      <div
        class="git-branch-stable-placeholder flex min-h-0 w-full flex-col"
        data-git-branch-stable-placeholder={view}
        data-git-branch-stable-placeholder-state={placeholderState}
        data-git-branch-stable-placeholder-layout={view}
      >
        <GitContentSkeleton
          label={accessibilityLabel}
          variant={view === "status" ? "changed-files" : "commit-graph"}
          rows={view === "status" ? 3 : 7}
          busy={checking}
          surface
        />
      </div>
    );
  };

  const loadStatusSection = async (
    section: GitWorkspaceViewSection,
    options: {
      append?: boolean;
      force?: boolean;
      background?: boolean;
      directoryPath?: string;
      staleRetry?: boolean;
    } = {},
  ): Promise<GitListWorkspacePageResponse | undefined> => {
    const repoRootPath = statusRepoRootPath();
    if (!repoRootPath) return;

    const currentState = statusPageState(section);
    if (props.capabilityMode === 'capable'
      && !statusWorkspaceRevision
      && WORKSPACE_VIEW_SECTIONS.some((candidate) => statusPageState(candidate).loading)) return;
    const append = Boolean(options.append);
    const directoryPath =
      section === "changes" || props.capabilityMode === 'capable'
        ? String(options.directoryPath ?? currentState.directoryPath ?? "")
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
      } else if (currentState.initialized || currentState.loading) {
        return;
      }
    }

    const seq = (statusReqSeqBySection[section] ?? 0) + 1;
    statusReqSeqBySection[section] = seq;
    const clientIdentity = props.protocolClientIdentity;
    const capabilityMode = props.capabilityMode;
    const refreshToken = Number(props.statusRefreshToken ?? 0);
    const expectedWorkspaceRevision = capabilityMode === 'capable' ? statusWorkspaceRevision : '';
    const branch = interactiveBranch();
    if (branch) {
      lastStatusRefreshContextKey = gitBranchPanelIdentityKey(
        branchIdentity(branch),
        repoRootPath,
        refreshToken,
      );
    }

    updateStatusPageState(section, (state) => ({
      ...state,
      loading: true,
      error: background ? state.error : "",
    }));
    if (selectedStatusSection() === section && !append && !background) {
      setStatusLoading(true);
    }

    try {
      const resp = await rpc.git.listWorkspacePage({
        repoRootPath,
        section,
        directoryPath: directoryPath || undefined,
        offset,
        limit: BRANCH_STATUS_PAGE_SIZE,
        expectedWorkspaceRevision: expectedWorkspaceRevision || undefined,
      });
      if (seq !== statusReqSeqBySection[section]
        || props.protocolClientIdentity !== clientIdentity
        || props.capabilityMode !== capabilityMode
        || Number(props.statusRefreshToken ?? 0) !== refreshToken) return;
      if (props.capabilityMode === 'capable' && !resp.workspaceRevision) {
        throw new Error('Git workspace response omitted workspace_revision');
      }
      if (expectedWorkspaceRevision && resp.workspaceRevision !== expectedWorkspaceRevision) {
        throw new Error('Git workspace response changed workspace_revision');
      }
      if (props.capabilityMode === 'capable') statusWorkspaceRevision = String(resp.workspaceRevision ?? '');
      applyStatusPageSnapshot(resp, { append });
      return resp;
    } catch (err) {
      if (seq !== statusReqSeqBySection[section]) return;
      if (props.capabilityMode === 'capable' && isGitWorkspaceSnapshotStale(err) && !options.staleRetry) {
        resetStatusWorkspace();
        return loadStatusSection(section, { ...options, force: true, staleRetry: true });
      }
      const message = i18n.t('git.common.requestFailed');
      updateStatusPageState(section, (state) => ({
        ...state,
        loading: false,
        error: background ? state.error : message,
      }));
      if (selectedStatusSection() === section && !append && !background) {
        if (!currentState.initialized) {
          setStatusWorkspace(null);
        }
      } else if (background) {
        notification.warning(i18n.t('git.notifications.refreshIncompleteTitle'), message);
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
    const clientIdentity = props.protocolClientIdentity;
    const capabilityMode = props.capabilityMode;
    if (hasStatusProtocolContext
      && clientIdentity === lastStatusProtocolClientIdentity
      && capabilityMode === lastStatusCapabilityMode) return;
    hasStatusProtocolContext = true;
    lastStatusProtocolClientIdentity = clientIdentity;
    lastStatusCapabilityMode = capabilityMode;
    lastStatusDataContextKey = "";
    lastStatusRefreshContextKey = "";
    resetStatusWorkspace();
  });

  createEffect(() => {
    const branch = interactiveBranch();
    const repoRootPath = statusRepoRootPath();
    const contextKey =
      branch && repoRootPath
        ? gitBranchPanelIdentityKey(branchIdentity(branch), repoRootPath)
        : "";
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
        ? gitBranchPanelIdentityKey(branchIdentity(branch), repoRootPath)
        : "";
    if (contextKey === lastStatusDataContextKey) return;
    lastStatusDataContextKey = contextKey;
    lastStatusRefreshContextKey = contextKey
      ? gitBranchPanelIdentityKey(branchIdentity(branch!), repoRootPath, refreshToken)
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
    if (!pageState.initialized && !pageState.loading && !pageState.error) {
      void loadStatusSection(section);
    }
  });

  createEffect(() => {
    const branch = interactiveBranch();
    const subview = branchSubview();
    const repoRootPath = statusRepoRootPath();
    const refreshToken = Number(props.statusRefreshToken ?? 0);
    if (!branch || subview !== "status" || !repoRootPath) return;
    const refreshKey = gitBranchPanelIdentityKey(
      branchIdentity(branch),
      repoRootPath,
      refreshToken,
    );
    if (refreshKey === lastStatusRefreshContextKey) return;
    const section = selectedStatusSection();
    const pageState = statusPageState(section);
    if (pageState.loading || (!pageState.initialized && !pageState.error)) return;
    void loadStatusSection(section, {
      force: true,
      background: pageState.initialized,
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
      class="git-branch-status-unavailable-summary"
      data-git-branch-status-unavailable-summary="true"
    >
      <div class="min-w-0">
        <div class="git-branch-status-unavailable-summary__title">
          {i18n.t('uiCopy.git.noCheckedOutWorktree')}
        </div>
        <div class="git-branch-status-unavailable-summary__detail">
          {i18n.t('uiCopy.git.historyCompareAvailable')}
        </div>
      </div>
      <GitMetaPill tone={statusEmptyState().tone}>
        {i18n.t('uiCopy.git.statusUnavailable')}
      </GitMetaPill>
    </div>
  );
  const renderBranchStatusContentFallback = () => {
    if (
      branchStatusPresentationState() === "unavailable" &&
      branchIsReady()
    ) {
      return <BranchStatusUnavailableTable state={statusEmptyState()} />;
    }
    return renderBranchStablePlaceholder("status");
  };
  const renderBranchStatusStrip = () => {
    const presentationState = branchStatusPresentationState();
    const pending = presentationState === "loading";
    const unavailable = presentationState === "unavailable";
    if (presentationState === "error") {
      return (
        <GitStatePane
          tone="error"
          message={visibleStatusError()}
          surface
          class="py-1"
        />
      );
    }
    if (unavailable && branchIsReady()) {
      return renderStatusUnavailableSummary();
    }

    const sectionIconMap: Record<GitWorkspaceViewSection, Component<{ class?: string }>> = {
      changes: FileText,
      conflicted: AlertTriangle,
      staged: CheckCircle,
    };

    return (
        <div
          class="inline-flex max-w-full min-w-0 items-center gap-0.5 rounded-md bg-muted/[0.10] p-0.5"
          data-git-branch-status-summary-state={
            pending
              ? "loading"
              : unavailable
                ? "unavailable"
                : "ready"
          }
        >
          <For each={statusSectionCards()}>
            {(item) => {
              const tone = workspaceSectionTone(item.section);
              const Icon = sectionIconMap[item.section];
              return (
                <button
                  type="button"
                  class={cn(
                    "git-browser-interactive flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left transition-colors duration-150 focus-visible:outline-none",
                    item.active
                      ? "border-transparent git-browser-selection-surface"
                      : "border-transparent bg-transparent",
                  )}
                  aria-pressed={item.active}
                  aria-label={`${item.label}: ${
                    pending || unavailable ? i18n.t('common.status.loading') : item.compactCaption
                  }`}
                  title={
                    pending || unavailable
                      ? branchDetailStateDetail()
                      : item.verboseCaption
                  }
                  disabled={pending || unavailable}
                  onClick={() => selectStatusSection(item.section)}
                >
                  <Icon class={cn("h-3.5 w-3.5 shrink-0", gitToneAccentColor(tone))} />
                  <span class={cn(
                      "truncate text-[11px] font-medium leading-4",
                      item.active ? "text-foreground" : "text-muted-foreground",
                    )}>
                      {item.label}
                  </span>
                  <span class={cn(
                    "inline-flex min-w-[1.25rem] shrink-0 items-center justify-center rounded px-1 py-0.5 text-[9px] font-semibold tabular-nums",
                    item.active ? "git-browser-selection-chip" : "bg-background/60 text-muted-foreground",
                  )}>
                    {pending || unavailable ? "–" : item.count}
                  </span>
                </button>
              );
            }}
          </For>
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
          {i18n.t('uiCopy.git.chooseBranch')}
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
        onContextMenu={(event) => {
          const target = statusScopeContextTarget();
          if (target) statusScopeContextMenu.openFromContextMenu(event, target);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const target = statusScopeContextTarget();
          if (target) statusScopeContextMenu.openFromKeyboard(event, target);
        }}
      >
        <div class="flex min-h-0 flex-1 flex-col px-2.5 py-2">
          <div class="flex min-h-0 flex-1 flex-col gap-2">
            {renderBranchDetailIssueBanner()}
            <section class="shrink-0 space-y-0 px-0">
              {/* Unified toolbar: section cards + actions in one row */}
              <div class="flex items-center gap-2">
                <div class="min-w-0 flex-1">
                  {renderBranchStatusStrip()}
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <Show when={statusToolbarShortcut()}>
                    {(shortcut) => (
                      <GitShortcutOrbButton
                        label={shortcut().label}
                        tone={shortcut().tone}
                        icon={shortcut().icon}
                        size="sm"
                        disabled={shortcut().disabled}
                        disabledReason={shortcut().disabledReason}
                        onClick={shortcut().onPress}
                      />
                    )}
                  </Show>
                  <For each={statusToolbarActions()}>
                    {(action) => (
                      <Show
                        when={action.disabled && action.disabledReason}
                        fallback={
                          <Tooltip content={action.label} delay={0}>
                            <button
                              type="button"
                              aria-label={action.label}
                              title={action.label}
                              class={cn(
                                "inline-flex cursor-pointer items-center justify-center rounded-md p-1.5 transition-colors duration-150",
                                "text-muted-foreground hover:bg-muted/[0.16] hover:text-foreground",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                              )}
                              disabled={action.disabled}
                              onClick={action.onPress}
                            >
                              <Show when={action.icon} keyed>
                                {(Icon) => <Dynamic component={Icon} class="h-4 w-4" />}
                              </Show>
                            </button>
                          </Tooltip>
                        }
                      >
                        <Tooltip content={action.disabledReason || action.label} delay={0}>
                          <button
                            type="button"
                            aria-label={action.label}
                            title={action.disabledReason || action.label}
                            class={cn(
                              "inline-flex cursor-not-allowed items-center justify-center rounded-md p-1.5",
                              "text-muted-foreground/40",
                            )}
                            disabled
                          >
                            <Show when={action.icon} keyed>
                              {(Icon) => <Dynamic component={Icon} class="h-4 w-4" />}
                            </Show>
                          </button>
                        </Tooltip>
                      </Show>
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

            <div
              class="flex min-h-0 flex-1 overflow-hidden"
              data-git-branch-status-content-frame="true"
            >
              <Show
                when={branchStatusPresentationState() === "ready"}
                fallback={renderBranchStatusContentFallback()}
              >
                <BranchStatusTable
                  canonicalRepoRootPath={activeRepoRootPath()}
                  repoRootPath={statusRepoRootPath()}
                  branch={interactiveBranch() as GitBranchSummary}
                  section={selectedStatusSection()}
                  items={visibleStatusItems()}
                  totalCount={visibleStatusTotalRows()}
                  scopeFileCount={visibleStatusScopeFileCount()}
                  directoryPath={activeStatusDirectoryPath()}
                  hasMore={visibleStatusPageState().hasMore}
                  loadingMore={visibleStatusLoadingMore()}
                  selectedKey={visibleStatusKey()}
                  onOpenDiff={(item, context) => {
                    setDiffDialogItem(item);
                    setDiffDialogRepoRootPath(context.liveRootPath);
                    setDiffDialogOpen(true);
                  }}
                  onOpenDirectory={navigateStatusDirectory}
                  onAskFlower={props.onAskFlower}
                  onOpenInTerminal={props.onOpenInTerminal}
                  onBrowseFiles={props.onBrowseFiles}
                  onPreviewCurrentFile={props.onPreviewCurrentFile}
                  onCopyText={props.onCopyText}
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
          {i18n.t('uiCopy.git.chooseBranch')}
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
            <div class="flex min-h-0 flex-1 flex-col gap-2 px-2.5 py-2">
              {renderBranchDetailIssueBanner()}
              {renderBranchStablePlaceholder("history")}
            </div>
          }
        >
          <HistoryList
            active={active()}
            repoRootPath={statusRepoRootPath() || activeRepoRootPath()}
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
            onOpenInTerminal={props.onOpenInTerminal}
            onBrowseFiles={props.onBrowseFiles}
            onPreviewCurrentFile={props.onPreviewCurrentFile}
            onCopyText={props.onCopyText}
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
            loadingVariant="commit-detail"
            loadingRows={4}
            message={i18n.t('git.notifications.loadingBranches')}
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
                {i18n.t('uiCopy.git.chooseBranch')}
              </div>
            }
          >
            <div class="flex h-full min-h-0 flex-col overflow-hidden">
              <div
                class={cn("shrink-0 space-y-1.5 border-b px-2.5 py-1.5", redevenDividerRoleClass())}
                data-git-branch-header-layout="compact"
              >
                <div
                  class="rounded-md px-1 py-1"
                  tabIndex={0}
                  onContextMenu={(event) => {
                    const branch = selectedBranch();
                    if (branch) branchContextMenu.openFromContextMenu(event, branchContextMenuTarget(branch));
                  }}
                  onKeyDown={(event) => {
                    const branch = selectedBranch();
                    if (branch) branchContextMenu.openFromKeyboard(event, branchContextMenuTarget(branch));
                  }}
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex min-w-0 items-center gap-2.5">
                      <GitBranch class={cn("h-5 w-5 shrink-0", gitToneAccentColor("violet"))} />
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                          <GitPrimaryTitle class="min-w-0 max-w-full truncate">
                            {branchDisplayName(selectedBranch())}
                          </GitPrimaryTitle>
                          <Show when={selectedBranch()?.current}>
                            <GitMetaPill tone="success">{i18n.t('uiCopy.git.current')}</GitMetaPill>
                          </Show>
                          <Show when={selectedBranch()?.kind === "remote"}>
                            <GitMetaPill tone="violet">{i18n.t('uiCopy.git.remote')}</GitMetaPill>
                          </Show>
                        </div>
                      </div>
                    </div>
                    <Show when={shouldRenderBranchHeaderActions()}>
                      <div
                        class="flex shrink-0 items-center gap-1.5"
                        data-git-branch-header-actions="overflow"
                      >
                        <Show when={branchHeaderMainAction()}>
                          {(action) => renderBranchPrimaryAction(action())}
                        </Show>
                        {renderBranchHeaderOverflow()}
                      </div>
                    </Show>
                  </div>

                  <Show when={branchSummary().visible}>
                    <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <Show when={selectedBranch()?.upstreamRef}>
                        <span class="inline-flex items-center gap-1">
                          <GitBranch class="h-3 w-3 shrink-0" />
                          <span class="truncate max-w-[12rem]">{selectedBranch()?.upstreamRef}</span>
                        </span>
                      </Show>
                      <Show when={(selectedBranch()?.aheadCount ?? 0) > 0}>
                        <span class="inline-flex items-center gap-1">
                          <ArrowUp class="h-3 w-3 shrink-0 text-brand" />
                          <span class="font-medium tabular-nums">{selectedBranch()?.aheadCount}</span>
                        </span>
                      </Show>
                      <Show when={(selectedBranch()?.behindCount ?? 0) > 0}>
                        <span class="inline-flex items-center gap-1">
                          <ArrowDown class="h-3 w-3 shrink-0 text-warning" />
                          <span class="font-medium tabular-nums">{selectedBranch()?.behindCount}</span>
                        </span>
                      </Show>
                      <Show when={selectedBranch()?.worktreePath}>
                        <span class="inline-flex items-center gap-1">
                          <Link class="h-3 w-3 shrink-0" />
                          <span class="truncate max-w-[16rem]" title={selectedBranch()?.worktreePath}>
                            {selectedBranch()?.worktreePath}
                          </span>
                        </span>
                      </Show>
                    </div>
                  </Show>
                </div>

                <div
                  class="inline-flex max-w-full items-center gap-0.5 rounded-md bg-muted/[0.10] p-0.5"
                  role="tablist"
                  aria-label={i18n.t('git.overview.branchDetailTabs')}
                  aria-orientation="horizontal"
                >
                  <For each={GIT_BRANCH_SUBVIEW_IDS}>
                    {(view) => {
                      const active = () => branchSubview() === view;
                      const TabIcon = view === "status" ? FileText : History;
                      return (
                        <button
                          ref={(el) => { branchSubviewTabRefs.set(view, el); }}
                          type="button" role="tab"
                          id={gitBranchSubviewTabId(view)}
                          aria-selected={active()}
                          aria-controls={gitBranchSubviewPanelId(view)}
                          tabIndex={active() ? 0 : -1}
                          class={branchSubviewTabClass(active())}
                          onClick={() => props.onSelectBranchSubview?.(view)}
                          onKeyDown={(event) => handleBranchSubviewKeyDown(event, view)}
                        >
                          <span class="inline-flex items-center justify-center gap-1.5">
                            <TabIcon class="h-3.5 w-3.5" />
                            <span>{localizedGitBranchSubviewLabel(view, i18n)}</span>
                          </span>
                        </button>
                      );
                    }}
                  </For>
                </div>

                {/* Detached HEAD context */}
                <Show when={repoHeadDisplay().detached}>
                  <div
                    class="git-branch-detached-context"
                    data-git-branch-detached-context="true"
                  >
                    <div class="git-branch-detached-context__body">
                      <AlertTriangle class="git-branch-detached-context__icon" />
                      <div class="git-branch-detached-context__copy">
                        <div class="git-branch-detached-context__heading">
                          <span class="git-branch-detached-context__title">
                            {i18n.t('git.notifications.detachedHeadTitle')}
                          </span>
                          <Show when={repoHeadDisplay().detail}>
                            <GitMetaPill tone="neutral">
                              {repoHeadDisplay().detail}
                            </GitMetaPill>
                          </Show>
                        </div>
                        <div class="git-branch-detached-context__summary">
                          <span>
                            {trimTerminalSentencePeriod(
                              localizedDetachedHeadViewingSummary(
                                props.repoSummary?.headCommit,
                                i18n,
                              ),
                            )}
                          </span>
                          <Show
                            when={localizedDetachedHeadReattachSummary(
                              reattachBranch(),
                              i18n,
                              { compact: true },
                            )}
                          >
                            {(summary) => (
                              <>
                                <span
                                  class="git-branch-detached-context__separator"
                                  aria-hidden="true"
                                />
                                <span>{summary()}</span>
                              </>
                            )}
                          </Show>
                        </div>
                      </div>
                    </div>
                    <Show when={reattachBranch() && props.onCheckoutBranch}>
                      <Button
                        size="sm"
                        variant="outline"
                        class={cn(
                          "git-branch-detached-context__action",
                          secondaryActionButtonClass,
                        )}
                        disabled={Boolean(props.checkoutBusy)}
                        onClick={() => {
                          const branch = reattachBranch();
                          if (branch) props.onCheckoutBranch?.(branch);
                        }}
                      >
                        {localizedDetachedHeadCheckoutActionLabel(
                          reattachBranch(),
                          Boolean(props.checkoutBusy),
                          i18n,
                        )}
                      </Button>
                    </Show>
                  </div>
                </Show>
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
        selectedBranch={compareDialogBranch() ?? interactiveBranch()}
        onClose={() => {
          setCompareDialogOpen(false);
          setCompareDialogBranch(null);
        }}
        onAskFlower={props.onAskFlower}
        onOpenInTerminal={props.onOpenInTerminal}
        onBrowseFiles={props.onBrowseFiles}
        onPreviewCurrentFile={props.onPreviewCurrentFile}
        onCopyText={props.onCopyText}
      />

      <GitDiffDialog
        open={diffDialogOpen()}
        onOpenChange={(open) => {
          setDiffDialogOpen(open);
          if (!open) {
            setDiffDialogItem(null);
            setDiffDialogRepoRootPath('');
          }
        }}
        item={diffDialogItem()}
        source={
          diffDialogItem()
            ? {
                kind: "workspace",
                repoRootPath: diffDialogRepoRootPath(),
                workspaceSection: String(
                  diffDialogItem()?.section ?? "",
                ).trim(),
              }
            : null
        }
        title={i18n.t('uiCopy.git.branchStatusDiff')}
        description={
          diffDialogItem()
            ? changeSecondaryPath(diffDialogItem())
            : i18n.t('uiCopy.git.reviewSelectedBranchStatusDiff')
        }
        emptyMessage={i18n.t('uiCopy.git.selectBranchStatusFile')}
      />
      <GitEntityContextMenu controller={branchContextMenu} items={branchContextMenuItems} />
      <GitEntityContextMenu controller={statusScopeContextMenu} items={statusScopeContextMenuItems} />

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
