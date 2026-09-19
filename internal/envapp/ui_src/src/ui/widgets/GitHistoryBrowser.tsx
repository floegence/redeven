import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { cn } from "@floegence/floe-webapp-core";
import { GitFileLabel } from "./GitFileLabel";
import { Calendar, Copy, Eye, FileText, Folder, Hash, Terminal, User } from "@floegence/floe-webapp-core/icons";
import { Button } from "@floegence/floe-webapp-core/ui";
import { useProtocol } from "@floegence/floe-webapp-protocol";
import {
  useRedevenRpc,
  type GitCommitDetail,
  type GitCommitSummary,
  type GitCommitDiffPresentation,
  type GitCommitFileSummary,
  type GitRepoSummaryResponse,
  type GitResolveRepoResponse,
} from "../protocol/redeven_v1";
import { FlowerIcon } from "../icons/FlowerIcon";
import {
  changeSecondaryPath,
  describeGitHead,
  exactGitPath,
  gitDiffEntryIdentity,
  shortGitHash,
  type GitDetachedSwitchTarget,
} from "../utils/gitWorkbench";
import {
  localizedGitCommitDiffPresentationBadge,
  localizedGitHeadDisplay,
} from '../utils/localizedGitWorkbench';
import {
  buildGitFileShortcutTarget,
  type GitAskFlowerRequest,
  type GitDirectoryShortcutRequest,
  type GitFileShortcutTarget,
} from "../utils/gitBrowserShortcuts";
import { redevenSurfaceRoleClass } from "../utils/redevenSurfaceRoles";
import { GitDiffPanel } from "./GitDiffPanel";
import { GitDiffSplit } from "./GitDiffSplit";
import { GitCommitMessageDialog, normalizedGitCommitBody } from './GitCommitMessageDialog';
import {
  GitChangeMetrics,
  GitChangeStatusPill,
  GitContentSkeleton,
  GitMetaPill,
  GitSkeletonBlock,
  GitPanelFrame,
  GitShortcutOrbButton,
  GitStatePane,
  GitSubtleNote,
} from "./GitWorkbenchPrimitives";
import {
  resolveGitBranchHeaderLayout,
  type GitBranchHeaderLayout,
} from "./gitBranchHeaderLayout";
import { GIT_WORKBENCH_SCROLL_REGION_PROPS } from "./gitWorkbenchScrollRegion";
import { useI18n } from "../i18n";
import { GitEntityContextMenu, createGitEntityContextMenuController, type GitContextMenuActionItem } from './GitEntityContextMenu';

const COMMIT_BODY_PREVIEW_LINES = 2;
const COMMIT_BODY_PREVIEW_CHARS = 160;

export interface GitHistoryBrowserProps {
  repoInfo?: GitResolveRepoResponse | null;
  repoInfoLoading?: boolean;
  repoSummary?: GitRepoSummaryResponse | null;
  currentPath: string;
  selectedCommitHash?: string;
  selectedCommit?: GitCommitSummary;
  switchDetachedBusy?: boolean;
  onSwitchDetached?: (target: GitDetachedSwitchTarget) => void;
  onAskFlower?: (
    request: Extract<GitAskFlowerRequest, { kind: "commit" }>,
  ) => void;
  onOpenInTerminal?: (request: GitDirectoryShortcutRequest) => void;
  onBrowseFiles?: (request: GitDirectoryShortcutRequest) => void | Promise<void>;
  onPreviewCurrentFile?: (target: GitFileShortcutTarget) => void;
  onCopyText?: (value: string) => void;
  class?: string;
}

function formatDetailTime(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return "-";
  return new Date(ms).toLocaleString();
}

function selectedFileIdentity(
  file: GitCommitFileSummary | null | undefined,
): string {
  return gitDiffEntryIdentity(file);
}

interface CommitFilesCompactListProps {
  items: GitCommitFileSummary[];
  selectedKey?: string;
  onOpenDiff?: (file: GitCommitFileSummary) => void;
  onContextMenu?: (event: MouseEvent, file: GitCommitFileSummary) => void;
  onKeyDown?: (event: KeyboardEvent, file: GitCommitFileSummary) => void;
}

function CommitFilesCompactList(props: CommitFilesCompactListProps) {
  const i18n = useI18n();
  return (
    <div
      {...GIT_WORKBENCH_SCROLL_REGION_PROPS}
      role="listbox"
      aria-label={i18n.t('uiCopy.git.filesInCommit')}
      class="git-table-frame min-h-0 flex-1 overflow-auto"
      data-git-commit-files-list-layout="compact"
    >
      <For each={props.items}>
        {(file) => {
          const active = () => props.selectedKey === selectedFileIdentity(file);
          const path = () => changeSecondaryPath(file);
          const displayPath = () => file.newPath || file.path || file.displayPath || file.oldPath || '';
          return (
            <button
              type="button"
              role="option"
              tabIndex={active() ? 0 : -1}
              aria-selected={active()}
              class={cn(
                "git-browser-interactive git-file-row w-full cursor-pointer text-left focus-visible:outline-none",
                active() && "git-browser-selection-row",
              )}
              onClick={() => props.onOpenDiff?.(file)}
              onContextMenu={(event) => props.onContextMenu?.(event, file)}
              onKeyDown={(event) => props.onKeyDown?.(event, file)}
            >
              <GitFileLabel path={displayPath()} secondaryPath={path()} />
              <GitChangeStatusPill compact change={file.changeType} />
              <GitChangeMetrics compact additions={file.additions} deletions={file.deletions} />
            </button>
          );
        }}
      </For>
    </div>
  );
}

export function GitHistoryBrowser(props: GitHistoryBrowserProps) {
  const i18n = useI18n();
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const outlineControlClass = redevenSurfaceRoleClass("control");
  type CommitContextTarget = Readonly<{
    repoRootPath: string;
    commit: GitCommitDetail;
    files: GitCommitFileSummary[];
  }>;
  const commitContextMenu = createGitEntityContextMenuController<CommitContextTarget>({
    snapshotTarget: (target) => ({
      repoRootPath: target.repoRootPath,
      commit: { ...target.commit, parents: [...target.commit.parents] },
      files: target.files.map((file) => ({ ...file })),
    }),
  });
  type FileContextTarget = Readonly<{
    repoRootPath: string;
    commit: GitCommitDetail;
    file: GitCommitFileSummary;
    shortcut: GitFileShortcutTarget | null;
  }>;
  const fileContextMenu = createGitEntityContextMenuController<FileContextTarget>({
    snapshotTarget: (target) => ({
      repoRootPath: target.repoRootPath,
      commit: { ...target.commit, parents: [...target.commit.parents] },
      file: { ...target.file },
      shortcut: target.shortcut ? { ...target.shortcut } : null,
    }),
  });

  const [commitDetail, setCommitDetail] = createSignal<GitCommitDetail | null>(
    null,
  );
  const [commitPresentation, setCommitPresentation] =
    createSignal<GitCommitDiffPresentation | null>(null);
  const [commitFiles, setCommitFiles] = createSignal<GitCommitFileSummary[]>(
    [],
  );
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailError, setDetailError] = createSignal("");
  const [commitBodyExpanded, setCommitBodyExpanded] = createSignal(false);
  const [commitMessageDialogOpen, setCommitMessageDialogOpen] = createSignal(false);
  const [selectedDiffKey, setSelectedDiffKey] = createSignal('');
  const diffItem = createMemo(() => commitFiles().find((file) => selectedFileIdentity(file) === selectedDiffKey()) ?? commitFiles()[0] ?? null);
  const [commitOverviewWidth, setCommitOverviewWidth] = createSignal(0);
  const [commitOverviewElement, setCommitOverviewElement] =
    createSignal<HTMLDivElement>();

  let detailReqSeq = 0;

  const repoAvailable = createMemo(() =>
    Boolean(props.repoInfo?.available && props.repoInfo?.repoRootPath),
  );
  const repoUnavailableReason = createMemo(() =>
    String(props.repoInfo?.unavailableReason ?? "").trim(),
  );
  const repoRootPath = createMemo(() =>
    exactGitPath(props.repoInfo?.repoRootPath),
  );
  const commitHash = createMemo(() =>
    String(props.selectedCommitHash ?? "").trim(),
  );
  const headDisplay = createMemo(() =>
    localizedGitHeadDisplay(describeGitHead(props.repoSummary, props.repoInfo), i18n),
  );
  const currentHeadCommit = createMemo(() =>
    String(
      props.repoSummary?.headCommit ?? props.repoInfo?.headCommit ?? "",
    ).trim(),
  );
  const displayCommit = createMemo<GitCommitDetail>(() => {
    const loaded = commitDetail();
    if (loaded) return loaded;
    const summary = props.selectedCommit?.hash === commitHash() ? props.selectedCommit : undefined;
    return {
      ...summary,
      hash: commitHash(),
      shortHash: summary?.shortHash || shortGitHash(commitHash()),
      parents: summary?.parents ?? [],
      subject: summary?.subject ?? '',
      body: summary?.bodyPreview,
    };
  });
  const commitBodyText = createMemo(() => normalizedGitCommitBody(displayCommit()));
  const hasExpandableCommitBody = createMemo(() => {
    const body = commitBodyText();
    if (!body) return false;
    const logicalLines = body.split(/\r?\n/);
    return (
      logicalLines.length > COMMIT_BODY_PREVIEW_LINES ||
      body.length > COMMIT_BODY_PREVIEW_CHARS
    );
  });
  const commitPresentationBadge = createMemo(() =>
    localizedGitCommitDiffPresentationBadge(commitPresentation(), i18n),
  );
  const commitOverviewLayout = createMemo<GitBranchHeaderLayout>(() =>
    resolveGitBranchHeaderLayout(commitOverviewWidth()),
  );
  const commitBodyGroupClass = () =>
    cn(
      "max-w-3xl space-y-1.5 pt-0.5",
      commitOverviewLayout() === "inline" ? "pl-4" : "pl-0",
    );
  const alreadyDetachedHere = () =>
    headDisplay().detached &&
    currentHeadCommit() === displayCommit().hash;
  const switchDetachedLabel = () => {
    if (props.switchDetachedBusy) return i18n.t('uiCopy.git.switching');
    if (alreadyDetachedHere()) return i18n.t('uiCopy.git.alreadyDetachedHere');
    return i18n.t('uiCopy.git.switchDetachHere');
  };

  const openDiff = (file: GitCommitFileSummary, hash = commitHash()) => {
    if (hash === commitHash()) setSelectedDiffKey(selectedFileIdentity(file));
  };
  const commitContextMenuItems = (target: CommitContextTarget): GitContextMenuActionItem[] => {
    const commit = target.commit;
    const items: GitContextMenuActionItem[] = [];
    if (props.onAskFlower && target.repoRootPath) {
      items.push({
        id: 'ask-flower', kind: 'action', group: 'assistant', rank: 10,
        label: i18n.t('git.contextMenu.askFlower'), icon: FlowerIcon,
        onSelect: () => props.onAskFlower?.({ kind: 'commit', repoRootPath: target.repoRootPath, location: 'graph', commit, files: target.files }),
      });
    }
    if (props.onOpenInTerminal && target.repoRootPath) {
      items.push({ id: 'open-terminal', kind: 'action', group: 'navigate', rank: 10, label: i18n.t('git.contextMenu.openTerminal'), icon: Terminal, onSelect: () => props.onOpenInTerminal?.({ path: target.repoRootPath }) });
    }
    if (props.onBrowseFiles && target.repoRootPath) {
      items.push({ id: 'browse-files', kind: 'action', group: 'navigate', rank: 20, label: i18n.t('git.contextMenu.browseFiles'), icon: Folder, onSelect: () => void props.onBrowseFiles?.({ path: target.repoRootPath }) });
    }
    if (props.onSwitchDetached) {
      const alreadyDetached = headDisplay().detached && currentHeadCommit() === commit.hash;
      items.push({ id: 'switch-detached', kind: 'action', group: 'modify', rank: 10, label: i18n.t('git.contextMenu.switchDetached'), icon: Hash, disabled: Boolean(props.switchDetachedBusy) || alreadyDetached, disabledReason: props.switchDetachedBusy ? i18n.t('uiCopy.git.switching') : alreadyDetached ? i18n.t('uiCopy.git.alreadyDetachedHere') : undefined, onSelect: () => props.onSwitchDetached?.({ commitHash: commit.hash, shortHash: commit.shortHash, source: 'graph' }) });
    }
    if (props.onCopyText) {
      items.push({ id: 'copy-commit-hash', kind: 'action', group: 'clipboard', rank: 10, label: i18n.t('git.contextMenu.copyCommitHash'), icon: Copy, onSelect: () => props.onCopyText?.(commit.hash) });
    }
    return items;
  };
  const fileContextMenuItems = (target: FileContextTarget): GitContextMenuActionItem[] => {
    const items: GitContextMenuActionItem[] = [];
    if (props.onAskFlower && target.repoRootPath) {
      items.push({ id: 'ask-flower', kind: 'action', group: 'assistant', rank: 10, label: i18n.t('git.contextMenu.askFlower'), icon: FlowerIcon, onSelect: () => props.onAskFlower?.({ kind: 'commit', repoRootPath: target.repoRootPath, location: 'graph', commit: target.commit, files: [target.file] }) });
    }
    items.push({ id: 'view-diff', kind: 'action', group: 'inspect', rank: 10, label: i18n.t('git.contextMenu.viewDiff'), icon: FileText, onSelect: () => openDiff(target.file, target.commit.hash) });
    if (
      props.onPreviewCurrentFile
      && target.shortcut
      && String(target.file.changeType ?? '').toLowerCase() !== 'deleted'
    ) {
      items.push({ id: 'preview-current-file', kind: 'action', group: 'inspect', rank: 20, label: i18n.t('git.contextMenu.previewCurrentFile'), icon: Eye, disabledReason: target.shortcut.canPreviewCurrentFile ? undefined : i18n.t('git.contextMenu.previewCurrentFileUnavailable'), onSelect: () => props.onPreviewCurrentFile?.(target.shortcut!) });
    }
    if (target.shortcut && props.onOpenInTerminal) {
      items.push({ id: 'open-parent-terminal', kind: 'action', group: 'navigate', rank: 10, label: i18n.t('git.contextMenu.openTerminal'), icon: Terminal, onSelect: () => props.onOpenInTerminal?.({ path: target.shortcut!.parentDirectoryPath }) });
    }
    if (target.shortcut && props.onBrowseFiles) {
      items.push({ id: 'browse-parent-files', kind: 'action', group: 'navigate', rank: 20, label: i18n.t('git.contextMenu.browseFiles'), icon: Folder, onSelect: () => void props.onBrowseFiles?.({ path: target.shortcut!.parentDirectoryPath }) });
    }
    if (target.shortcut && props.onCopyText) {
      items.push(
        { id: 'copy-absolute-path', kind: 'action', group: 'clipboard', rank: 10, label: i18n.t('git.contextMenu.copyAbsolutePath'), icon: Copy, onSelect: () => props.onCopyText?.(target.shortcut!.absolutePath) },
        { id: 'copy-relative-path', kind: 'action', group: 'clipboard', rank: 20, label: i18n.t('git.contextMenu.copyRelativePath'), icon: Copy, onSelect: () => props.onCopyText?.(target.shortcut!.relativePath) },
      );
    }
    return items;
  };
  const buildFileContextTarget = (file: GitCommitFileSummary): FileContextTarget | null => {
    const commit = commitDetail();
    if (!commit) return null;
    return { repoRootPath: repoRootPath(), commit, file, shortcut: buildGitFileShortcutTarget({ rootPath: repoRootPath(), item: file }) };
  };
  const openFileContextMenu = (event: MouseEvent, file: GitCommitFileSummary) => {
    const target = buildFileContextTarget(file);
    if (target && fileContextMenuItems(target).length > 0) fileContextMenu.openFromContextMenu(event, target);
  };
  const openFileKeyboardMenu = (event: KeyboardEvent, file: GitCommitFileSummary) => {
    const target = buildFileContextTarget(file);
    if (target && fileContextMenuItems(target).length > 0) fileContextMenu.openFromKeyboard(event, target);
  };

  onCleanup(() => { detailReqSeq += 1; });

  const resetDetailState = () => {
    detailReqSeq += 1;
    setCommitDetail(null);
    setCommitPresentation(null);
    setCommitFiles([]);
    setDetailError("");
    setDetailLoading(false);
  };

  const loadCommitDetail = async (hash: string) => {
    const repo = repoRootPath();
    if (!repo || !hash || !protocol.session?.()) return;
    const seq = ++detailReqSeq;
    setDetailLoading(true);
    setDetailError("");
    try {
      const resp = await rpc.git.getCommitDetail({
        repoRootPath: repo,
        commit: hash,
      });
      if (seq !== detailReqSeq) return;
      const files = Array.isArray(resp?.files) ? resp.files : [];
      setCommitDetail(resp?.commit ?? null);
      setCommitPresentation(resp?.presentation ?? null);
      setCommitFiles(files);
    } catch (err) {
      if (seq !== detailReqSeq) return;
      setDetailError(
        err instanceof Error
          ? err.message
          : String(err ?? "Failed to load commit detail"),
      );
      setCommitDetail(null);
      setCommitPresentation(null);
      setCommitFiles([]);
    } finally {
      if (seq === detailReqSeq) setDetailLoading(false);
    }
  };

  createEffect(() => {
    if (!repoAvailable()) {
      resetDetailState();
      return;
    }
    const hash = commitHash();
    if (!hash) {
      resetDetailState();
      return;
    }
    resetDetailState();
    void loadCommitDetail(hash);
  });

  createEffect(() => {
    repoRootPath();
    commitHash();
    setSelectedDiffKey('');
  });

  createEffect(() => {
    commitHash();
    setCommitBodyExpanded(false);
    setCommitMessageDialogOpen(false);
  });

  createEffect(() => {
    void commitDetail();
    const element = commitOverviewElement();
    if (!element) {
      setCommitOverviewWidth(0);
      return;
    }
    const syncCommitOverviewWidth = () => {
      setCommitOverviewWidth(element.offsetWidth ?? 0);
    };
    syncCommitOverviewWidth();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(syncCommitOverviewWidth);
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div class={cn("relative flex h-full min-h-0 flex-col", props.class)}>
      <Show
        when={repoAvailable()}
        fallback={(
          <Show
            when={!props.repoInfoLoading}
            fallback={(
              <div class="h-full px-3 py-4 sm:px-4">
                <GitContentSkeleton
                  label={i18n.t('git.notifications.checkingRepositoryContext')}
                  variant="commit-detail"
                  rows={4}
                  surface
                />
              </div>
            )}
          >
            <div class="flex h-full items-center justify-center rounded-lg bg-muted/[0.18] px-6 text-center">
              <div class="max-w-md space-y-2">
                <div class="text-sm font-medium text-foreground">
                  {i18n.t('uiCopy.git.historyUnavailable')}
                </div>
                <div class="text-xs text-muted-foreground">
                  {repoUnavailableReason() || i18n.t('uiCopy.git.currentPathOutsideRepository', { path: props.currentPath || '/' })}
                </div>
              </div>
            </div>
          </Show>
        )}
      >
        <Show
          when={commitHash()}
          fallback={
            <div class="flex-1 px-3 py-4 text-xs text-muted-foreground">
              {i18n.t('uiCopy.git.chooseCommit')}
            </div>
          }
        >
          <Show
            when={!detailError()}
            fallback={
              <GitStatePane
                tone="error"
                message={detailError()}
                class="px-3 py-4"
              />
            }
          >
            <Show when={detailLoading() || commitDetail()} fallback={
              <div class="flex-1 px-3 py-4 text-xs text-muted-foreground">{i18n.t('uiCopy.git.commitDetailsUnavailable')}</div>
            }>
              <div class="relative flex min-h-0 flex-1 flex-col" aria-busy={detailLoading()}>
                <div {...GIT_WORKBENCH_SCROLL_REGION_PROPS} class="max-h-[40%] shrink-0 overflow-auto border-b border-border">
                  <GitPanelFrame as="section" class="!px-4 !py-3">
                    <div
                      ref={setCommitOverviewElement}
                      tabIndex={0}
                      data-git-commit-overview-layout={commitOverviewLayout()}
                      class="space-y-3"
                      onContextMenu={(event) => {
                        if (detailLoading()) return;
                        const target = { repoRootPath: repoRootPath(), commit: displayCommit(), files: commitFiles() };
                        if (commitContextMenuItems(target).length > 0) commitContextMenu.openFromContextMenu(event, target);
                      }}
                      onKeyDown={(event) => {
                        if (detailLoading()) return;
                        const target = { repoRootPath: repoRootPath(), commit: displayCommit(), files: commitFiles() };
                        if (commitContextMenuItems(target).length > 0) commitContextMenu.openFromKeyboard(event, target);
                      }}
                    >
                      <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div class="min-w-0 flex-1 space-y-2">
                          <div class="max-w-4xl break-words text-[15px] font-bold leading-6 tracking-tight text-foreground">
                            <Show when={!detailLoading() || props.selectedCommit?.hash === commitHash()} fallback={<GitSkeletonBlock class="my-1.5 h-3 w-3/5" />}>
                              {displayCommit().subject || i18n.t('uiCopy.git.noSubject')}
                            </Show>
                          </div>
                          <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] leading-4 text-muted-foreground">
                            <span class="inline-flex items-center gap-1 whitespace-nowrap">
                              <Hash class="h-3 w-3 shrink-0 text-muted-foreground/45" />
                              <span>{displayCommit().shortHash}</span>
                            </span>
                            <span class="inline-flex items-center gap-1 whitespace-nowrap">
                              <User class="h-3 w-3 shrink-0 text-muted-foreground/45" />
                              <Show when={!detailLoading() || props.selectedCommit?.hash === commitHash()} fallback={<GitSkeletonBlock class="h-2 w-20" />}><span>{displayCommit().authorName || i18n.t('uiCopy.git.unknownAuthor')}</span></Show>
                            </span>
                            <span class="inline-flex items-center gap-1 whitespace-nowrap">
                              <Calendar class="h-3 w-3 shrink-0 text-muted-foreground/45" />
                              <Show when={!detailLoading() || props.selectedCommit?.hash === commitHash()} fallback={<GitSkeletonBlock class="h-2 w-28" />}><span>{formatDetailTime(displayCommit().authorTimeMs)}</span></Show>
                            </span>
                            <span class="inline-flex items-center gap-1 whitespace-nowrap">
                              <FileText class="h-3 w-3 shrink-0 text-muted-foreground/45" />
                              <Show when={!detailLoading()} fallback={<GitSkeletonBlock class="h-2 w-10" />}><span>{i18n.tn('git.common.fileCount', commitFiles().length)}</span></Show>
                            </span>
                            <Show when={commitPresentationBadge()}>
                              <GitMetaPill tone="violet">{commitPresentationBadge()}</GitMetaPill>
                            </Show>
                          </div>
                          <Show when={commitBodyText()}>
                            <div data-git-commit-body-group class={commitBodyGroupClass()}>
                              <div class="border-l-2 border-border/70 pl-3 text-xs leading-5 text-muted-foreground">
                                <div
                                  data-git-commit-body
                                  class="whitespace-pre-wrap break-words"
                                  style={
                                    commitBodyExpanded()
                                      ? undefined
                                      : {
                                          display: "-webkit-box",
                                          "-webkit-box-orient": "vertical",
                                          "-webkit-line-clamp": String(COMMIT_BODY_PREVIEW_LINES),
                                          overflow: "hidden",
                                        }
                                  }
                                >
                                  {commitBodyText()}
                                </div>
                              </div>
                              <Show when={hasExpandableCommitBody()}>
                                <div class="flex justify-start">
                                  <button
                                    type="button"
                                    data-git-commit-body-toggle
                                    aria-expanded={commitBodyExpanded()}
                                    class="cursor-pointer rounded px-1 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted/[0.12] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                                    onClick={() => setCommitBodyExpanded((value) => !value)}
                                  >
                                    {commitBodyExpanded()
                                      ? i18n.t('git.patchViewer.showLess')
                                      : i18n.t('uiCopy.git.showMore')}
                                  </button>
                                </div>
                              </Show>
                            </div>
                          </Show>
                        </div>

                        <div class="flex shrink-0 flex-wrap items-center gap-1.5">
                          <Button
                            size="xs"
                            variant="outline"
                            data-git-full-commit-message-trigger
                            disabled={detailLoading()}
                            class={cn("rounded-md", outlineControlClass)}
                            onClick={() => setCommitMessageDialogOpen(true)}
                          >
                            <FileText class="mr-1 h-3.5 w-3.5" />
                            {i18n.t('uiCopy.git.viewFullCommitMessage')}
                          </Button>
                          <Show when={props.onSwitchDetached}>
                            <Button
                              size="xs"
                              variant="outline"
                              class={cn("rounded-md", outlineControlClass)}
                              disabled={detailLoading() || Boolean(props.switchDetachedBusy) || alreadyDetachedHere()}
                              onClick={() => props.onSwitchDetached?.({
                                commitHash: displayCommit().hash,
                                shortHash: displayCommit().shortHash || shortGitHash(displayCommit().hash),
                                source: "graph",
                              })}
                            >
                              {switchDetachedLabel()}
                            </Button>
                          </Show>
                          <Show when={props.onAskFlower}>
                            <GitShortcutOrbButton
                              label={i18n.t('git.changes.askFlower')}
                              tone="flower"
                              icon={FlowerIcon}
                              size="sm"
                              disabled={detailLoading()}
                              onClick={() => props.onAskFlower?.({
                                kind: "commit",
                                repoRootPath: exactGitPath(props.repoInfo?.repoRootPath),
                                location: "graph",
                                commit: displayCommit(),
                                files: commitFiles(),
                              })}
                            />
                          </Show>
                        </div>
                      </div>

                      <Show when={props.onSwitchDetached && alreadyDetachedHere()}>
                        <GitSubtleNote>{i18n.t('uiCopy.git.alreadyDetached')}</GitSubtleNote>
                      </Show>
                    </div>
                  </GitPanelFrame>
                </div>

                <GitDiffSplit
                  loading={detailLoading()}
                  filesHeader={<>{i18n.t('uiCopy.git.filesInCommit')}<Show when={!detailLoading()}> · {commitFiles().length}</Show></>}
                  detail={(
                    <GitDiffPanel
                      loading={detailLoading()}
                      open={Boolean(diffItem())}
                      item={diffItem()}
                      source={diffItem() ? {
                        kind: 'commit',
                        repoRootPath: repoRootPath(),
                        commit: commitHash(),
                        presentation: commitPresentation() ?? undefined,
                      } : null}
                      emptyMessage={i18n.t('uiCopy.git.selectChangedFile')}
                    />
                  )}
                >
                  <CommitFilesCompactList
                    items={commitFiles()}
                    selectedKey={selectedFileIdentity(diffItem())}
                    onOpenDiff={(file) => openDiff(file)}
                    onContextMenu={openFileContextMenu}
                    onKeyDown={openFileKeyboardMenu}
                  />
                </GitDiffSplit>
              </div>
            </Show>
          </Show>
        </Show>
      </Show>

      <GitCommitMessageDialog
        open={commitMessageDialogOpen()}
        commit={commitDetail()}
        onOpenChange={setCommitMessageDialogOpen}
        onCopyText={props.onCopyText}
      />
      <GitEntityContextMenu controller={commitContextMenu} items={commitContextMenuItems} />
      <GitEntityContextMenu controller={fileContextMenu} items={fileContextMenuItems} />
    </div>
  );
}
