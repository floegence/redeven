import { For, Show, createEffect, onCleanup } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import { Button } from '@floegence/floe-webapp-core/ui';
import { AlertTriangle, CheckCircle, Copy, FileText, Folder, GitBranch, Terminal, Trash } from '@floegence/floe-webapp-core/icons';
import type {
  GitBranchSummary,
  GitCommitSummary,
  GitListBranchesResponse,
  GitListWorkspaceChangesResponse,
  GitRepoSummaryResponse,
} from '../protocol/redeven_v1';
import {
  WORKSPACE_VIEW_SECTIONS,
  branchDisplayName,
  branchIdentity,
  describeGitHead,
  resolveGitBranchWorktreePath,
  summarizeWorkspaceCount,
  workspaceViewSectionCount,
  type GitWorkspaceViewPageState,
  type GitWorkspaceViewSection,
  type GitWorkbenchSubview,
  type GitDetachedSwitchTarget,
} from '../utils/gitWorkbench';
import {
  localizedBranchContextSummary,
  localizedBranchStatusSummary,
  localizedGitHeadDisplay,
  localizedWorkspaceHealthLabel,
  localizedWorkspaceViewSectionLabel,
} from '../utils/localizedGitWorkbench';
import {
  gitBranchTone,
  gitSelectedChipClass,
  gitSelectedSecondaryTextClass,
  gitToneActionButtonClass,
  gitToneBadgeClass,
  gitToneSelectableCardClass,
  workspaceSectionTone,
} from './GitChrome';
import { GitCommitGraph } from './GitCommitGraph';
import { GIT_WORKBENCH_SCROLL_REGION_PROPS } from './gitWorkbenchScrollRegion';
import { useI18n } from '../i18n';
import { GitMetaPill, GitSection, GitStatePane, GitSubtleNote } from './GitWorkbenchPrimitives';
import { FlowerIcon } from '../icons/FlowerIcon';
import {
  buildGitDirectoryShortcutRequest,
  type GitAskFlowerRequest,
  type GitDirectoryShortcutRequest,
} from '../utils/gitBrowserShortcuts';
import { GitEntityContextMenu, createGitEntityContextMenuController, type GitContextMenuActionItem } from './GitEntityContextMenu';

export interface GitWorkbenchSidebarProps {
  subview: GitWorkbenchSubview;
  onClose?: () => void;
  repoInfoLoading?: boolean;
  repoInfoError?: string;
  repoAvailable?: boolean;
  repoUnavailableReason?: string;
  repoSummary?: GitRepoSummaryResponse | null;
  workspace?: GitListWorkspaceChangesResponse | null;
  workspacePages?: Partial<Record<GitWorkspaceViewSection, GitWorkspaceViewPageState>>;
  workspaceLoading?: boolean;
  workspaceError?: string;
  selectedWorkspaceSection?: GitWorkspaceViewSection;
  onSelectWorkspaceSection?: (section: GitWorkspaceViewSection) => void;
  branches?: GitListBranchesResponse | null;
  branchesLoading?: boolean;
  branchesError?: string;
  selectedBranchKey?: string;
  onSelectBranch?: (branch: GitBranchSummary) => void;
  onCheckoutBranch?: (branch: GitBranchSummary) => void;
  onMergeBranch?: (branch: GitBranchSummary) => void;
  onDeleteBranch?: (branch: GitBranchSummary) => void;
  onAskFlower?: (request: Extract<GitAskFlowerRequest, { kind: 'branch' | 'commit' }>) => void;
  onOpenInTerminal?: (request: GitDirectoryShortcutRequest) => void;
  onBrowseFiles?: (request: GitDirectoryShortcutRequest) => void | Promise<void>;
  onSwitchDetached?: (target: GitDetachedSwitchTarget) => void;
  switchDetachedBusy?: boolean;
  onCopyText?: (value: string) => void;
  commits?: GitCommitSummary[];
  listLoading?: boolean;
  listLoadingMore?: boolean;
  listError?: string;
  hasMore?: boolean;
  selectedCommitHash?: string;
  onSelectCommit?: (hash: string) => void;
  onLoadMore?: () => void;
  class?: string;
}

const SELECTED_BRANCH_REVEAL_PADDING = 8;

type BranchRevealScrollInput = {
  scrollTop: number;
  viewportTop: number;
  viewportBottom: number;
  itemTop: number;
  itemBottom: number;
  padding?: number;
  maxScrollTop?: number;
};

type BranchAnchorScrollInput = {
  scrollTop: number;
  viewportTop: number;
  itemTop: number;
  anchorItemTopOffset: number;
  maxScrollTop?: number;
};

type BranchSelectionScrollAnchor = {
  key: string;
  branchesRef: GitListBranchesResponse | null | undefined;
  branchListSignature: string;
  scrollTop: number;
  itemTopOffset: number;
};

function clampGitSidebarScrollTop(value: number, maxScrollTop?: number): number {
  const minScrollTop = Math.max(0, value);
  if (!Number.isFinite(maxScrollTop)) return minScrollTop;
  return Math.min(minScrollTop, Math.max(0, Number(maxScrollTop)));
}

export function resolveGitSidebarRevealScrollTop(input: BranchRevealScrollInput): number {
  const padding = Math.max(0, input.padding ?? SELECTED_BRANCH_REVEAL_PADDING);
  const topLimit = input.viewportTop + padding;
  const bottomLimit = input.viewportBottom - padding;

  if (input.itemTop < topLimit) {
    return clampGitSidebarScrollTop(
      input.scrollTop - (topLimit - input.itemTop),
      input.maxScrollTop,
    );
  }
  if (input.itemBottom > bottomLimit) {
    return clampGitSidebarScrollTop(
      input.scrollTop + (input.itemBottom - bottomLimit),
      input.maxScrollTop,
    );
  }
  return clampGitSidebarScrollTop(input.scrollTop, input.maxScrollTop);
}

export function resolveGitSidebarAnchorScrollTop(input: BranchAnchorScrollInput): number {
  const itemTopOffset = input.itemTop - input.viewportTop;
  return clampGitSidebarScrollTop(
    input.scrollTop + (itemTopOffset - input.anchorItemTopOffset),
    input.maxScrollTop,
  );
}

function gitSidebarBranchListSignature(branches: GitListBranchesResponse | null | undefined): string {
  return [
    'local',
    ...(branches?.local ?? []).map(branchIdentity),
    'remote',
    ...(branches?.remote ?? []).map(branchIdentity),
  ].join('\u001f');
}

function resolveElementMaxScrollTop(element: HTMLElement): number | undefined {
  const maxScrollTop = element.scrollHeight - element.clientHeight;
  return Number.isFinite(maxScrollTop) && maxScrollTop > 0 ? maxScrollTop : undefined;
}

function normalizeSubview(view: GitWorkbenchSubview): GitWorkbenchSubview {
  return view === 'overview' ? 'changes' : view;
}

function selectorLabel(view: GitWorkbenchSubview, i18n: ReturnType<typeof useI18n>): string {
  switch (normalizeSubview(view)) {
    case 'branches':
      return i18n.t('gitPresentation.branchesView');
    case 'history':
      return i18n.t('gitPresentation.graphView');
    case 'changes':
    default:
      return i18n.t('git.common.changes');
  }
}

function resolveWorkspaceSectionIcon(section: GitWorkspaceViewSection): import('solid-js').Component<{ class?: string }> {
  switch (section) {
    case 'staged':
      return CheckCircle;
    case 'conflicted':
      return AlertTriangle;
    case 'changes':
    default:
      return FileText;
  }
}

function selectorDescription(view: GitWorkbenchSubview, i18n: ReturnType<typeof useI18n>): string {
  switch (normalizeSubview(view)) {
    case 'branches':
      return i18n.t('git.overview.chooseBranchToLoadCompare');
    case 'history':
      return i18n.t('uiCopy.git.chooseCommit');
    case 'changes':
    default:
      return i18n.t('git.overview.reviewWorkspaceFromSidebar');
  }
}

export function GitWorkbenchSidebar(props: GitWorkbenchSidebarProps) {
  const i18n = useI18n();
  type BranchContextTarget = Readonly<{ branch: GitBranchSummary; repoRootPath: string }>;
  const branchContextMenu = createGitEntityContextMenuController<BranchContextTarget>({
    snapshotTarget: (target) => ({ repoRootPath: target.repoRootPath, branch: { ...target.branch } }),
  });
  const closeAfterPick = () => props.onClose?.();
  const activeSubview = () => normalizeSubview(props.subview);
  const headDisplay = () => localizedGitHeadDisplay(describeGitHead(props.repoSummary), i18n);
  const workspaceSummary = () => props.workspace?.summary ?? props.repoSummary?.workspaceSummary ?? null;
  const workspaceCount = () => summarizeWorkspaceCount(workspaceSummary());
  const workspaceBlockingLoading = () => Boolean(props.workspaceLoading && !workspaceSummary());
  const workspaceBlockingError = () => Boolean(props.workspaceError && !workspaceSummary());
  const localBranchCount = () => props.branches?.local.length ?? 0;
  const remoteBranchCount = () => props.branches?.remote.length ?? 0;
  const branchButtonRefs = new Map<string, HTMLButtonElement>();
  let scrollRegionElement: HTMLDivElement | undefined;
  let scheduledBranchScrollFrame = 0;
  let scheduledBranchScrollTask: (() => void) | null = null;
  let previousBranchesRef: GitListBranchesResponse | null | undefined;
  let pendingSelectionScrollAnchor: BranchSelectionScrollAnchor | null = null;
  const repoRootPath = () => String(props.repoSummary?.repoRootPath ?? '').trim();

  const branchContextMenuItems = (target: BranchContextTarget): GitContextMenuActionItem[] => {
    const { branch } = target;
    const items: GitContextMenuActionItem[] = [];
    const branchName = branchDisplayName(branch);
    const liveRootPath = resolveGitBranchWorktreePath(branch, target.repoRootPath);
    const directoryRequest = buildGitDirectoryShortcutRequest({
      rootPath: liveRootPath,
      preferredName: branchName,
    });
    const isLocal = String(branch.kind ?? '').trim().toLowerCase() === 'local';
    const worktreeDisabledReason = directoryRequest
      ? undefined
      : !target.repoRootPath
        ? i18n.t('git.notifications.repositoryPathUnavailable')
        : branch.kind === 'remote'
          ? i18n.t('git.branches.checkoutRemoteFirst')
          : !branch.current && !branch.worktreePath
            ? i18n.t('git.branches.openBranchInWorktreeFirst')
            : i18n.t('git.branches.worktreeUnavailable');
    if (props.onAskFlower && target.repoRootPath) {
      items.push({
        id: 'ask-flower', kind: 'action', group: 'assistant', rank: 10,
        label: i18n.t('git.contextMenu.askFlower'), icon: FlowerIcon,
        onSelect: () => props.onAskFlower?.({ kind: 'branch', repoRootPath: target.repoRootPath, branch }),
      });
    }
    if (props.onOpenInTerminal) {
      items.push({
        id: 'open-terminal', kind: 'action', group: 'navigate', rank: 10,
        label: i18n.t('git.contextMenu.openTerminal'), icon: Terminal,
        disabledReason: worktreeDisabledReason,
        onSelect: () => {
          if (directoryRequest) props.onOpenInTerminal?.(directoryRequest);
        },
      });
    }
    if (props.onBrowseFiles) {
      items.push({
        id: 'browse-files', kind: 'action', group: 'navigate', rank: 20,
        label: i18n.t('git.contextMenu.browseFiles'), icon: Folder,
        disabledReason: worktreeDisabledReason,
        onSelect: () => {
          if (directoryRequest) void props.onBrowseFiles?.(directoryRequest);
        },
      });
    }
    if (!branch.current && props.onCheckoutBranch) {
      items.push({
        id: 'checkout-branch', kind: 'action', group: 'modify', rank: 10,
        label: i18n.t('git.contextMenu.checkoutBranch'), icon: GitBranch,
        disabled: Boolean(branch.worktreePath),
        disabledReason: branch.worktreePath ? i18n.t('git.overview.linkedWorktree') : undefined,
        onSelect: () => props.onCheckoutBranch?.(branch),
      });
    }
    if (!branch.current && props.onMergeBranch) {
      items.push({
        id: 'merge-branch', kind: 'action', group: 'modify', rank: 20,
        label: i18n.t('git.contextMenu.mergeBranch'), icon: GitBranch,
        onSelect: () => props.onMergeBranch?.(branch),
      });
    }
    if (isLocal && !branch.current && props.onDeleteBranch) {
      items.push({
        id: 'delete-branch', kind: 'action', group: 'destructive', rank: 10,
        label: i18n.t('git.contextMenu.deleteBranch'), icon: Trash, destructive: true,
        onSelect: () => props.onDeleteBranch?.(branch),
      });
    }
    if (props.onCopyText) {
      items.push({
        id: 'copy-branch-name', kind: 'action', group: 'clipboard', rank: 10,
        label: i18n.t('git.contextMenu.copyBranchName'), icon: Copy,
        onSelect: () => props.onCopyText?.(branchName),
      });
      if (directoryRequest) {
        items.push({
          id: 'copy-worktree-path', kind: 'action', group: 'clipboard', rank: 20,
          label: i18n.t('git.contextMenu.copyWorktreePath'), icon: Copy,
          onSelect: () => props.onCopyText?.(directoryRequest.path),
        });
      }
    }
    return items;
  };
  const openBranchContextMenu = (event: MouseEvent, branch: GitBranchSummary) => {
    const target = { branch, repoRootPath: repoRootPath() };
    if (branchContextMenuItems(target).length > 0) branchContextMenu.openFromContextMenu(event, target);
  };
  const openBranchKeyboardMenu = (event: KeyboardEvent, branch: GitBranchSummary) => {
    const target = { branch, repoRootPath: repoRootPath() };
    if (branchContextMenuItems(target).length > 0) branchContextMenu.openFromKeyboard(event, target);
  };

  const registerBranchButton = (branch: GitBranchSummary, element: HTMLButtonElement) => {
    const key = branchIdentity(branch);
    if (key) branchButtonRefs.set(key, element);
  };

  const cancelScheduledBranchScroll = () => {
    scheduledBranchScrollTask = null;
    if (!scheduledBranchScrollFrame) return;
    if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(scheduledBranchScrollFrame);
    }
    scheduledBranchScrollFrame = 0;
  };

  const scheduleBranchScrollTask = (task: () => void) => {
    cancelScheduledBranchScroll();
    scheduledBranchScrollTask = () => {
      scheduledBranchScrollFrame = 0;
      scheduledBranchScrollTask = null;
      task();
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      scheduledBranchScrollFrame = window.requestAnimationFrame(() => {
        scheduledBranchScrollTask?.();
      });
      return;
    }
    scheduledBranchScrollTask();
  };

  const captureSelectionScrollAnchor = (branch: GitBranchSummary, element: HTMLButtonElement) => {
    cancelScheduledBranchScroll();
    const key = branchIdentity(branch);
    const scrollRegion = scrollRegionElement;
    if (!key || !scrollRegion || !scrollRegion.contains(element)) {
      pendingSelectionScrollAnchor = null;
      return;
    }

    const viewportRect = scrollRegion.getBoundingClientRect();
    const itemRect = element.getBoundingClientRect();
    pendingSelectionScrollAnchor = {
      key,
      branchesRef: props.branches,
      branchListSignature: gitSidebarBranchListSignature(props.branches),
      scrollTop: scrollRegion.scrollTop,
      itemTopOffset: itemRect.top - viewportRect.top,
    };
  };

  const revealSelectedBranchIfNeeded = () => {
    const key = String(props.selectedBranchKey ?? '').trim();
    const scrollRegion = scrollRegionElement;
    const selectedButton = key ? branchButtonRefs.get(key) : undefined;
    if (!scrollRegion || !selectedButton || !scrollRegion.contains(selectedButton)) return;

    const viewportRect = scrollRegion.getBoundingClientRect();
    const itemRect = selectedButton.getBoundingClientRect();
    const nextScrollTop = resolveGitSidebarRevealScrollTop({
      scrollTop: scrollRegion.scrollTop,
      viewportTop: viewportRect.top,
      viewportBottom: viewportRect.bottom,
      itemTop: itemRect.top,
      itemBottom: itemRect.bottom,
      padding: 0,
      maxScrollTop: resolveElementMaxScrollTop(scrollRegion),
    });
    if (nextScrollTop !== scrollRegion.scrollTop) {
      scrollRegion.scrollTop = nextScrollTop;
    }
  };

  const scheduleRevealSelectedBranch = () => {
    scheduleBranchScrollTask(revealSelectedBranchIfNeeded);
  };

  const restoreSelectionScrollFromAnchor = (anchor: BranchSelectionScrollAnchor) => {
    const scrollRegion = scrollRegionElement;
    if (!scrollRegion) return;

    const selectedButton = branchButtonRefs.get(anchor.key);
    const nextSignature = gitSidebarBranchListSignature(props.branches);
    const maxScrollTop = resolveElementMaxScrollTop(scrollRegion);
    let nextScrollTop = clampGitSidebarScrollTop(anchor.scrollTop, maxScrollTop);

    if (selectedButton && scrollRegion.contains(selectedButton) && nextSignature !== anchor.branchListSignature) {
      const viewportRect = scrollRegion.getBoundingClientRect();
      const itemRect = selectedButton.getBoundingClientRect();
      const anchoredScrollTop = resolveGitSidebarAnchorScrollTop({
        scrollTop: scrollRegion.scrollTop,
        viewportTop: viewportRect.top,
        itemTop: itemRect.top,
        anchorItemTopOffset: anchor.itemTopOffset,
        maxScrollTop,
      });
      const scrollDelta = anchoredScrollTop - scrollRegion.scrollTop;
      nextScrollTop = resolveGitSidebarRevealScrollTop({
        scrollTop: anchoredScrollTop,
        viewportTop: viewportRect.top,
        viewportBottom: viewportRect.bottom,
        itemTop: itemRect.top - scrollDelta,
        itemBottom: itemRect.bottom - scrollDelta,
        padding: 0,
        maxScrollTop,
      });
    }

    if (nextScrollTop !== scrollRegion.scrollTop) {
      scrollRegion.scrollTop = nextScrollTop;
    }
  };

  createEffect(() => {
    const branches = props.branches;
    const validKeys = new Set([
      ...(branches?.local ?? []).map(branchIdentity),
      ...(branches?.remote ?? []).map(branchIdentity),
    ].filter(Boolean));
    for (const key of Array.from(branchButtonRefs.keys())) {
      if (!validKeys.has(key)) branchButtonRefs.delete(key);
    }
  });

  createEffect(() => {
    const branches = props.branches;
    const selectedBranchKey = String(props.selectedBranchKey ?? '').trim();
    const branchKeys = gitSidebarBranchListSignature(branches);
    const branchesRefChanged = branches !== previousBranchesRef;
    previousBranchesRef = branches;

    if (pendingSelectionScrollAnchor && selectedBranchKey !== pendingSelectionScrollAnchor.key) {
      pendingSelectionScrollAnchor = null;
    }

    if (
      activeSubview() !== 'branches'
      || !selectedBranchKey
      || props.branchesLoading
      || props.branchesError
      || !branches
    ) {
      return;
    }

    const pendingAnchor = pendingSelectionScrollAnchor;
    if (
      pendingAnchor
      && branchesRefChanged
      && branches !== pendingAnchor.branchesRef
    ) {
      pendingSelectionScrollAnchor = null;
      scheduleBranchScrollTask(() => restoreSelectionScrollFromAnchor(pendingAnchor));
      return;
    }

    if (branchesRefChanged && branchKeys) {
      scheduleRevealSelectedBranch();
    }
  });

  onCleanup(cancelScheduledBranchScroll);

  return (
    <div class={cn('flex h-full min-h-0 flex-col', props.class)}>
      <div
        ref={(element) => {
          scrollRegionElement = element;
        }}
        {...GIT_WORKBENCH_SCROLL_REGION_PROPS}
        data-testid="git-sidebar-scroll-region"
        class="min-h-0 flex-1 overflow-auto overscroll-contain [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch] [touch-action:pan-y_pinch-zoom]"
      >
        <div class="space-y-2">
          <Show
              when={!props.repoInfoLoading}
              fallback={<GitStatePane loading message={i18n.t('git.notifications.checkingRepository')} class="min-h-[4.5rem] py-3" />}
          >
            <Show when={!props.repoInfoError} fallback={<div class="py-3 text-xs break-words text-error">{props.repoInfoError}</div>}>
              <Show
                when={props.repoAvailable}
                fallback={<div class="py-3 text-xs text-muted-foreground">{props.repoUnavailableReason || i18n.t('git.notifications.currentPathNotGitRepo')}</div>}
              >
                <div class="space-y-2">
                  <div class="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/65">
                    {selectorLabel(activeSubview(), i18n)}
                  </div>
                  <div class="px-1 text-[11px] text-muted-foreground">
                    {selectorDescription(activeSubview(), i18n)}
                  </div>

                  <Show when={activeSubview() === 'changes'}>
                    <Show
                      when={!workspaceBlockingLoading()}
                      fallback={<GitStatePane loading message={i18n.t('git.changes.loadingWorkspaceChanges')} class="min-h-[4.5rem] py-3" />}
                    >
                      <Show when={!workspaceBlockingError()} fallback={<div class="py-3 text-xs break-words text-error">{props.workspaceError}</div>}>
                        <div class="rounded-md bg-muted/[0.08] px-2.5 py-2.5">
                          <div class="flex items-start justify-between gap-2">
                            <div class="min-w-0 flex-1">
                              <div class="flex flex-wrap items-center gap-1.5">
                                <div class="text-xs font-medium text-foreground">{headDisplay().label}</div>
                                <Show when={headDisplay().detail}>
                                  <GitMetaPill tone="neutral">{headDisplay().detail}</GitMetaPill>
                                </Show>
                              </div>
                              <div class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                                {localizedWorkspaceHealthLabel(workspaceSummary(), i18n)}
                              </div>
                              <Show when={headDisplay().detached}>
                                <div class="mt-0.5 text-[10px] leading-relaxed text-warning">{i18n.t('uiCopy.git.detachedReadOnly')}</div>
                              </Show>
                            </div>
                            <GitMetaPill tone={workspaceCount() > 0 ? 'warning' : 'success'}>
                              {workspaceCount() > 0 ? i18n.tn('git.overview.openCount', workspaceCount()) : i18n.t('git.common.clean')}
                            </GitMetaPill>
                          </div>

                          <div class="mt-2 grid grid-cols-1 gap-0.5">
                            <For each={WORKSPACE_VIEW_SECTIONS}>
                              {(section) => {
                                const count = () => workspaceViewSectionCount(workspaceSummary(), section);
                                const pageState = () => props.workspacePages?.[section];
                                const sectionLoading = () => Boolean(pageState()?.loading && !pageState()?.initialized);
                                const tone = () => workspaceSectionTone(section);
                                const active = () => props.selectedWorkspaceSection === section;
                                return (
                                  <button
                                    type="button"
                                    aria-busy={sectionLoading() ? 'true' : undefined}
                                    data-git-workspace-section-loading={sectionLoading() ? 'true' : 'false'}
                                    class={cn('w-full rounded-md px-2.5 py-2 text-left text-xs', gitToneSelectableCardClass(tone(), active()))}
                                    onClick={() => {
                                      props.onSelectWorkspaceSection?.(section);
                                      closeAfterPick();
                                    }}
                                  >
                                    <div class="flex items-start justify-between gap-2">
                                      <div class="flex min-w-0 flex-1 items-start gap-2">
                                        <Dynamic component={resolveWorkspaceSectionIcon(section)} class="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                        <div class="min-w-0 flex-1">
                                        <div class="font-medium text-current">{localizedWorkspaceViewSectionLabel(section, i18n)}</div>
                                        <div class={cn('mt-0.5 text-[10px] leading-relaxed', gitSelectedSecondaryTextClass(active()))}>
                                          {sectionLoading() ? i18n.t('files.loadingFiles') : count() === 0 ? i18n.t('git.changes.noFilesInSection') : i18n.tn('git.common.fileCount', count())}
                                        </div>
                                        </div>
                                      </div>
                                      <span
                                        class={cn(
                                          'inline-flex min-w-[1.75rem] items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                          active() ? gitSelectedChipClass(true) : gitToneBadgeClass(tone())
                                        )}
                                      >
                                        {workspaceSummary() ? count() : '–'}
                                      </span>
                                    </div>
                                  </button>
                                );
                              }}
                            </For>
                          </div>
                        </div>
                      </Show>
                    </Show>
                  </Show>

                  <Show when={activeSubview() === 'branches'}>
                    <Show
                      when={!props.branchesLoading}
                      fallback={<GitStatePane loading message={i18n.t('git.notifications.loadingBranches')} class="min-h-[4.5rem] py-3" />}
                    >
                      <Show when={!props.branchesError} fallback={<div class="py-3 text-xs break-words text-error">{props.branchesError}</div>}>
                        <GitSection label={i18n.t('uiCopy.git.local')} description={i18n.t('uiCopy.git.localBranchesDescription')} aside={String(localBranchCount())} tone="brand">
                          <Show when={localBranchCount() > 0} fallback={<GitSubtleNote>{i18n.t('uiCopy.git.noLocalBranches')}</GitSubtleNote>}>
                            <div class="space-y-px">
                              <For each={props.branches?.local ?? []}>
                                {(branch) => {
                                  const tone = () => gitBranchTone(branch);
                                  const active = () => props.selectedBranchKey === branchIdentity(branch);
                                  return (
                                    <button
                                      ref={(element) => registerBranchButton(branch, element)}
                                      type="button"
                                      data-git-sidebar-branch-key={branchIdentity(branch)}
                                      class={cn('w-full rounded px-2.5 py-1.5 text-left', gitToneSelectableCardClass(tone(), active()))}
                                      onClick={(event) => {
                                        captureSelectionScrollAnchor(branch, event.currentTarget);
                                        props.onSelectBranch?.(branch);
                                        closeAfterPick();
                                      }}
                                      onContextMenu={(event) => openBranchContextMenu(event, branch)}
                                      onKeyDown={(event) => openBranchKeyboardMenu(event, branch)}
                                    >
                                      <div class="grid min-h-5 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                                        <span class="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                                          <GitBranch class="h-3.5 w-3.5 shrink-0" />
                                          <span class="truncate text-[11.5px] font-medium text-current">{branchDisplayName(branch)}</span>
                                        </span>
                                        <Show when={branch.current}>
                                          <span class={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', active() ? gitSelectedChipClass(true) : 'bg-primary/[0.12] text-primary')}>{i18n.t('uiCopy.git.current')}</span>
                                        </Show>
                                      </div>
                                      <div class={cn('mt-0.5 min-h-4 truncate text-[10px]', gitSelectedSecondaryTextClass(active()))} title={localizedBranchStatusSummary(branch, i18n)}>{localizedBranchContextSummary(branch, i18n)}</div>
                                    </button>
                                  );
                                }}
                              </For>
                            </div>
                          </Show>
                        </GitSection>

                        <GitSection label={i18n.t('uiCopy.git.remote')} description={i18n.t('uiCopy.git.remoteBranchesDescription')} aside={String(remoteBranchCount())} tone="violet">
                          <Show when={remoteBranchCount() > 0} fallback={<GitSubtleNote>{i18n.t('uiCopy.git.noRemoteBranches')}</GitSubtleNote>}>
                            <div class="space-y-px">
                              <For each={props.branches?.remote ?? []}>
                                {(branch) => {
                                  const active = () => props.selectedBranchKey === branchIdentity(branch);
                                  return (
                                    <button
                                      ref={(element) => registerBranchButton(branch, element)}
                                      type="button"
                                      data-git-sidebar-branch-key={branchIdentity(branch)}
                                      class={cn('w-full rounded px-2.5 py-1.5 text-left', gitToneSelectableCardClass('violet', active()))}
                                      onClick={(event) => {
                                        captureSelectionScrollAnchor(branch, event.currentTarget);
                                        props.onSelectBranch?.(branch);
                                        closeAfterPick();
                                      }}
                                      onContextMenu={(event) => openBranchContextMenu(event, branch)}
                                      onKeyDown={(event) => openBranchKeyboardMenu(event, branch)}
                                    >
                                      <div class="flex items-center gap-1.5 truncate">
                                        <GitBranch class="h-3.5 w-3.5 shrink-0" />
                                        <span class="truncate text-[11.5px] font-medium text-current">{branchDisplayName(branch)}</span>
                                      </div>
                                      <div class={cn('mt-0.5 truncate text-[10px]', gitSelectedSecondaryTextClass(active()))}>{branch.subject || localizedBranchStatusSummary(branch, i18n)}</div>
                                    </button>
                                  );
                                }}
                              </For>
                            </div>
                          </Show>
                        </GitSection>
                      </Show>
                    </Show>
                  </Show>

                  <Show when={activeSubview() === 'history'}>
                    <Show
                      when={!props.listLoading}
                      fallback={<GitStatePane loading message={i18n.t('git.notifications.loadingCommits')} class="min-h-[4.5rem] py-3" />}
                    >
                      <Show when={!props.listError} fallback={<div class="py-3 text-xs break-words text-error">{props.listError}</div>}>
                        <Show when={(props.commits?.length ?? 0) > 0} fallback={<GitSubtleNote>{i18n.t('uiCopy.git.noCommits')}</GitSubtleNote>}>
                          <GitCommitGraph
                            commits={props.commits ?? []}
                            selectedCommitHash={props.selectedCommitHash}
                            onSelect={(hash) => {
                              props.onSelectCommit?.(hash);
                              closeAfterPick();
                            }}
                            repoRootPath={repoRootPath()}
                            onAskFlower={props.onAskFlower}
                            onOpenInTerminal={props.onOpenInTerminal}
                            onBrowseFiles={props.onBrowseFiles}
                            onSwitchDetached={props.onSwitchDetached}
                            switchDetachedBusy={props.switchDetachedBusy}
                            alreadyDetachedCommitHash={props.repoSummary?.detached ? props.repoSummary?.headCommit : undefined}
                            onCopyText={props.onCopyText}
                          />
                        </Show>
                      </Show>
                    </Show>

                    <Show when={props.hasMore}>
                      <div class="pt-1">
                        <Button size="sm" variant="ghost" class={cn('w-full', gitToneActionButtonClass())} onClick={props.onLoadMore} loading={props.listLoadingMore} disabled={props.listLoadingMore}>
                          {i18n.t('uiCopy.git.loadMore')}
                        </Button>
                      </div>
                    </Show>
                  </Show>
                </div>
              </Show>
            </Show>
          </Show>
        </div>
      </div>
      <GitEntityContextMenu controller={branchContextMenu} items={branchContextMenuItems} />
    </div>
  );
}
