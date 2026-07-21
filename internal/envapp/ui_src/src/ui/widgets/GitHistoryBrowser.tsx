import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { cn } from "@floegence/floe-webapp-core";
import { Calendar, FileText, Hash, User } from "@floegence/floe-webapp-core/icons";
import { Button } from "@floegence/floe-webapp-core/ui";
import { useProtocol } from "@floegence/floe-webapp-protocol";
import {
  useRedevenRpc,
  type GitCommitDetail,
  type GitCommitDiffPresentation,
  type GitCommitFileSummary,
  type GitRepoSummaryResponse,
  type GitResolveRepoResponse,
} from "../protocol/redeven_v1";
import { FlowerIcon } from "../icons/FlowerIcon";
import {
  changeSecondaryPath,
  describeGitHead,
  gitDiffEntryIdentity,
  shortGitHash,
  type GitDetachedSwitchTarget,
} from "../utils/gitWorkbench";
import {
  localizedGitCommitDiffPresentationBadge,
  localizedGitCommitDiffPresentationDetail,
  localizedGitHeadDisplay,
} from '../utils/localizedGitWorkbench';
import type { GitAskFlowerRequest } from "../utils/gitBrowserShortcuts";
import { redevenSurfaceRoleClass } from "../utils/redevenSurfaceRoles";
import { gitChangePathClass } from "./GitChrome";
import { GitDiffDialog } from "./GitDiffDialog";
import {
  GIT_CHANGED_FILES_CELL_CLASS,
  GIT_CHANGED_FILES_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_HEADER_ROW_CLASS,
  GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_TABLE_CLASS,
  GitChangedFilesActionButton,
  GitChangeMetrics,
  GitChangeStatusPill,
  GitLabelBlock,
  GitMetaPill,
  GitPanelFrame,
  GitShortcutOrbButton,
  GitStatePane,
  GitSubtleNote,
  GitTableFrame,
  gitChangedFilesRowClass,
  gitChangedFilesStickyCellClass,
} from "./GitWorkbenchPrimitives";
import { GitVirtualTable } from "./GitVirtualTable";
import {
  resolveGitBranchHeaderLayout,
  type GitBranchHeaderLayout,
} from "./gitBranchHeaderLayout";
import { GIT_WORKBENCH_SCROLL_REGION_PROPS } from "./gitWorkbenchScrollRegion";
import { useI18n } from "../i18n";

const COMMIT_BODY_PREVIEW_LINES = 2;
const COMMIT_BODY_PREVIEW_CHARS = 160;

export interface GitHistoryBrowserProps {
  repoInfo?: GitResolveRepoResponse | null;
  repoInfoLoading?: boolean;
  repoSummary?: GitRepoSummaryResponse | null;
  currentPath: string;
  selectedCommitHash?: string;
  switchDetachedBusy?: boolean;
  onSwitchDetached?: (target: GitDetachedSwitchTarget) => void;
  onAskFlower?: (
    request: Extract<GitAskFlowerRequest, { kind: "commit" }>,
  ) => void;
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

function normalizeCommitBody(
  detail: GitCommitDetail | null | undefined,
): string {
  const body = String(detail?.body ?? "").trim();
  if (!body) return "";
  const subject = String(detail?.subject ?? "").trim();
  if (!subject) return body;
  const lines = body.split(/\r?\n/);
  if (lines[0]?.trim() !== subject) return body;
  return lines.slice(1).join("\n").trim();
}

interface CommitFilesCompactListProps {
  items: GitCommitFileSummary[];
  selectedKey?: string;
  onOpenDiff?: (file: GitCommitFileSummary) => void;
}

function CommitFilesCompactList(props: CommitFilesCompactListProps) {
  const i18n = useI18n();
  return (
    <div
      {...GIT_WORKBENCH_SCROLL_REGION_PROPS}
      role="list"
      class="min-h-0 flex-1 overflow-auto divide-y divide-border/45"
      data-git-commit-files-list-layout="compact"
    >
      <For each={props.items}>
        {(file) => {
          const active = () => props.selectedKey === selectedFileIdentity(file);
          const path = () => changeSecondaryPath(file);
          return (
            <button
              type="button"
              role="listitem"
              aria-selected={active()}
              class={cn(
                "grid w-full cursor-pointer gap-1.5 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1",
                active() && "git-browser-selection-row",
              )}
              onClick={() => props.onOpenDiff?.(file)}
            >
              <div class="flex min-w-0 items-start justify-between gap-2">
                <div class="min-w-0">
                  <div
                    class={`truncate text-xs font-medium ${gitChangePathClass(file.changeType)}`}
                    title={path()}
                  >
                    {path()}
                  </div>
                </div>
                <span class="shrink-0 rounded-md bg-background/70 px-2 py-1 text-[10px] font-medium text-muted-foreground">
                  {i18n.t('shell.commandPalette.categories.view')}
                </span>
              </div>
              <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                <GitChangeStatusPill change={file.changeType} />
                <GitChangeMetrics
                  additions={file.additions}
                  deletions={file.deletions}
                />
              </div>
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
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] =
    createSignal<GitCommitFileSummary | null>(null);
  const [diffDialogCommitHash, setDiffDialogCommitHash] = createSignal("");
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
    String(props.repoInfo?.repoRootPath ?? "").trim(),
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
  const commitBodyText = createMemo(() => normalizeCommitBody(commitDetail()));
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
  const commitPresentationDetail = createMemo(() =>
    localizedGitCommitDiffPresentationDetail(commitPresentation(), i18n),
  );
  const commitOverviewLayout = createMemo<GitBranchHeaderLayout>(() =>
    resolveGitBranchHeaderLayout(commitOverviewWidth()),
  );
  const commitBodyGroupClass = () =>
    cn(
      "max-w-3xl space-y-1.5 pt-0.5",
      commitOverviewLayout() === "inline" ? "pl-4" : "pl-0",
    );

  const resetDetailState = () => {
    setCommitDetail(null);
    setCommitPresentation(null);
    setCommitFiles([]);
    setDetailError("");
    setDetailLoading(false);
  };

  const loadCommitDetail = async (hash: string) => {
    const repo = repoRootPath();
    if (!repo || !hash || !protocol.client()) return;
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
    void loadCommitDetail(hash);
  });

  createEffect(() => {
    repoRootPath();
    setDiffDialogItem(null);
    setDiffDialogCommitHash("");
    setDiffDialogOpen(false);
  });

  createEffect(() => {
    commitHash();
    setCommitBodyExpanded(false);
  });

  createEffect(() => {
    if (!diffDialogOpen()) return;
    if (diffDialogItem()) return;
    setDiffDialogOpen(false);
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
        fallback={
          <div class="flex h-full items-center justify-center rounded-lg bg-muted/[0.18] px-6 text-center">
            <div class="max-w-md space-y-2">
              <div class="text-sm font-medium text-foreground">
                {i18n.t('uiCopy.git.historyUnavailable')}
              </div>
              <div class="text-xs text-muted-foreground">
                {props.repoInfoLoading
                  ? i18n.t('git.notifications.checkingRepositoryContext')
                  : repoUnavailableReason() ||
                    i18n.t('uiCopy.git.currentPathOutsideRepository', { path: props.currentPath || '/' })}
              </div>
            </div>
          </div>
        }
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
            {(() => {
              const detail = commitDetail();
              if (!detail) {
                return (
                  <Show
                    when={detailLoading()}
                    fallback={
                      <div class="flex-1 px-3 py-4 text-xs text-muted-foreground">
                        {i18n.t('uiCopy.git.commitDetailsUnavailable')}
                      </div>
                    }
                  >
                    <GitStatePane
                      loading
                      message={i18n.t('uiCopy.git.loadingCommitDetails')}
                      class="px-4"
                    />
                  </Show>
                );
              }
              const alreadyDetachedHere = () =>
                headDisplay().detached &&
                currentHeadCommit() === detail.hash;
              const switchDetachedLabel = () => {
                if (props.switchDetachedBusy) return i18n.t('uiCopy.git.switching');
                if (alreadyDetachedHere()) return i18n.t('uiCopy.git.alreadyDetachedHere');
                return i18n.t('uiCopy.git.switchDetachHere');
              };
              return (
                <div class="relative flex-1 min-h-0">
                  <Show when={detailLoading()}>
                    <div class="absolute inset-x-0 top-0 z-10 mx-3 sm:mx-4">
                      <div class="h-0.5 w-full animate-pulse rounded-full bg-primary/40" />
                    </div>
                  </Show>
                  <div {...GIT_WORKBENCH_SCROLL_REGION_PROPS} class="flex-1 min-h-0 overflow-auto px-3 py-3 sm:px-4 sm:py-4">
                    <div class="space-y-3">
                        <GitPanelFrame as="section" class="!px-4 !py-3">
                          <div class="space-y-3">
                            <div
                              ref={setCommitOverviewElement}
                              data-git-commit-overview-layout={commitOverviewLayout()}
                              class="space-y-3"
                            >
                              <div class="text-[15px] font-bold leading-6 tracking-tight text-foreground max-w-3xl break-words">
                                {detail.subject || i18n.t('uiCopy.git.noSubject')}
                              </div>
                              <div class="flex flex-wrap items-center text-[11px] leading-4 text-muted-foreground">
                                <span class="inline-flex items-center gap-1 whitespace-nowrap">
                                  <Hash class="h-3 w-3 shrink-0 text-muted-foreground/45" />
                                  <span>{detail.shortHash}</span>
                                </span>
                                <span aria-hidden="true" class="mx-1.5 text-muted-foreground/25 select-none">—</span>
                                <span class="inline-flex items-center gap-1 whitespace-nowrap">
                                  <User class="h-3 w-3 shrink-0 text-muted-foreground/45" />
                                  <span>{detail.authorName || i18n.t('uiCopy.git.unknownAuthor')}</span>
                                </span>
                                <span aria-hidden="true" class="mx-1.5 text-muted-foreground/25 select-none">—</span>
                                <span class="inline-flex items-center gap-1 whitespace-nowrap">
                                  <Calendar class="h-3 w-3 shrink-0 text-muted-foreground/45" />
                                  <span>{formatDetailTime(detail.authorTimeMs)}</span>
                                </span>
                                <span aria-hidden="true" class="mx-1.5 text-muted-foreground/25 select-none">—</span>
                                <span class="inline-flex items-center gap-1 whitespace-nowrap">
                                  <FileText class="h-3 w-3 shrink-0 text-muted-foreground/45" />
                                  <span>{i18n.tn('git.common.fileCount', commitFiles().length)}</span>
                                </span>
                                <Show when={commitPresentationBadge()}>
                                  <span aria-hidden="true" class="mx-1.5 text-muted-foreground/25 select-none">—</span>
                                  <span class="inline-flex items-center gap-1 whitespace-nowrap text-[var(--redeven-categorical-6)] font-medium">
                                    {commitPresentationBadge()}
                                  </span>
                                </Show>
                              </div>
                              <div class="flex items-center gap-2 pt-1">
                                <Show when={props.onSwitchDetached}>
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    class={cn("rounded-md", outlineControlClass)}
                                    disabled={
                                      Boolean(props.switchDetachedBusy) ||
                                      alreadyDetachedHere()
                                    }
                                    onClick={() =>
                                      props.onSwitchDetached?.({
                                        commitHash: detail.hash,
                                        shortHash:
                                          detail.shortHash ||
                                          shortGitHash(detail.hash),
                                        source: "graph",
                                      })
                                    }
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
                                    onClick={() =>
                                      props.onAskFlower?.({
                                        kind: "commit",
                                        repoRootPath: String(
                                          props.repoInfo?.repoRootPath ?? "",
                                        ).trim(),
                                        location: "graph",
                                        commit: detail,
                                        files: commitFiles(),
                                      })
                                    }
                                  />
                                </Show>
                              </div>
                            </div>
                            </div>
                            <Show when={commitBodyText()}>
                              <div
                                data-git-commit-body-group
                                class={commitBodyGroupClass()}
                              >
                                <GitSubtleNote class="max-w-full">
                                  <div
                                    data-git-commit-body
                                    class="whitespace-pre-wrap break-words text-foreground"
                                    style={
                                      commitBodyExpanded()
                                        ? undefined
                                        : {
                                            display: "-webkit-box",
                                            "-webkit-box-orient": "vertical",
                                            "-webkit-line-clamp": String(
                                              COMMIT_BODY_PREVIEW_LINES,
                                            ),
                                            overflow: "hidden",
                                          }
                                    }
                                  >
                                    {commitBodyText()}
                                  </div>
                                </GitSubtleNote>
                                <Show when={hasExpandableCommitBody()}>
                                  <div class="flex justify-start">
                                    <button
                                      type="button"
                                      data-git-commit-body-toggle
                                      aria-expanded={commitBodyExpanded()}
                                      class="cursor-pointer rounded px-1 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted/[0.12] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                                      onClick={() =>
                                        setCommitBodyExpanded(
                                          (value) => !value,
                                        )
                                      }
                                    >
                                      {commitBodyExpanded()
                                        ? i18n.t('git.patchViewer.showLess')
                                        : i18n.t('uiCopy.git.showMore')}
                                    </button>
                                  </div>
                                </Show>
                              </div>
                            </Show>
                          <Show
                            when={
                              props.onSwitchDetached && alreadyDetachedHere()
                            }
                          >
                            <GitSubtleNote>
                              {i18n.t('uiCopy.git.alreadyDetached')}
                            </GitSubtleNote>
                          </Show>
                        </GitPanelFrame>

                        <GitPanelFrame as="section">
                          <GitLabelBlock
                            class="min-w-0"
                            bodyClass="!pl-0"
                            label={i18n.t('uiCopy.git.filesInCommit')}
                            tone="info"
                            meta={
                              <GitMetaPill tone="neutral">
                                {String(commitFiles().length)}
                              </GitMetaPill>
                            }
                          >
                            <div class="text-xs leading-relaxed text-muted-foreground">
                              {i18n.t('uiCopy.git.clickFileDiff')}
                            </div>
                          </GitLabelBlock>
                          <Show when={commitPresentationDetail()}>
                            <GitSubtleNote class="mt-2">
                              {commitPresentationDetail()}
                            </GitSubtleNote>
                          </Show>
                          <Show
                            when={commitFiles().length > 0}
                            fallback={
                              <GitSubtleNote>
                                {i18n.t('uiCopy.git.noCommitFiles')}
                              </GitSubtleNote>
                            }
                          >
                            <GitTableFrame class="mt-2.5">
                              <Show
                                when={commitOverviewLayout() === "compact"}
                                fallback={
                                  <GitVirtualTable
                                    items={commitFiles()}
                                    tableClass={`${GIT_CHANGED_FILES_TABLE_CLASS} min-w-[34rem] sm:min-w-[42rem] md:min-w-0`}
                                    header={
                                      <tr
                                        class={GIT_CHANGED_FILES_HEADER_ROW_CLASS}
                                      >
                                        <th
                                          class={
                                            GIT_CHANGED_FILES_HEADER_CELL_CLASS
                                          }
                                        >
                                          {i18n.t('git.common.path')}
                                        </th>
                                        <th
                                          class={
                                            GIT_CHANGED_FILES_HEADER_CELL_CLASS
                                          }
                                        >
                                          {i18n.t('git.common.status')}
                                        </th>
                                        <th
                                          class={
                                            GIT_CHANGED_FILES_HEADER_CELL_CLASS
                                          }
                                        >
                                          {i18n.t('git.common.changes')}
                                        </th>
                                        <th
                                          class={
                                            GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS
                                          }
                                        >
                                          {i18n.t('git.common.action')}
                                        </th>
                                      </tr>
                                    }
                                    renderRow={(file) => {
                                      const active = () =>
                                        selectedFileIdentity(diffDialogItem()) ===
                                          selectedFileIdentity(file) &&
                                        diffDialogOpen();
                                      return (
                                        <tr
                                          aria-selected={active()}
                                          class={gitChangedFilesRowClass(active())}
                                        >
                                          <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                                            <div class="min-w-0">
                                              <button
                                                type="button"
                                                class={`block max-w-full cursor-pointer truncate text-left text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${gitChangePathClass(file.changeType)}`}
                                                title={changeSecondaryPath(file)}
                                                onClick={() => {
                                                  setDiffDialogCommitHash(
                                                    commitHash(),
                                                  );
                                                  setDiffDialogItem(file);
                                                  setDiffDialogOpen(true);
                                                }}
                                              >
                                                {changeSecondaryPath(file)}
                                              </button>
                                            </div>
                                          </td>
                                          <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                                            <GitChangeStatusPill
                                              change={file.changeType}
                                            />
                                          </td>
                                          <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                                            <GitChangeMetrics
                                              additions={file.additions}
                                              deletions={file.deletions}
                                            />
                                          </td>
                                          <td
                                            class={gitChangedFilesStickyCellClass(
                                              active(),
                                            )}
                                          >
                                            <GitChangedFilesActionButton
                                              onClick={() => {
                                                setDiffDialogCommitHash(
                                                  commitHash(),
                                                );
                                                setDiffDialogItem(file);
                                                setDiffDialogOpen(true);
                                              }}
                                            >
                                              {i18n.t('files.menuViewDiff')}
                                            </GitChangedFilesActionButton>
                                          </td>
                                        </tr>
                                      );
                                    }}
                                  />
                                }
                              >
                                <CommitFilesCompactList
                                  items={commitFiles()}
                                  selectedKey={selectedFileIdentity(
                                    diffDialogItem(),
                                  )}
                                  onOpenDiff={(file) => {
                                    setDiffDialogCommitHash(commitHash());
                                    setDiffDialogItem(file);
                                    setDiffDialogOpen(true);
                                  }}
                                />
                              </Show>
                            </GitTableFrame>
                          </Show>
                        </GitPanelFrame>
                      </div>
                    </div>
                    </div>
                  );
                })()}
              </Show>
            </Show>
      </Show>

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
                presentation: commitPresentation() ?? undefined,
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
        unavailableMessage={(file) =>
          file.isBinary
            ? i18n.t('git.patchViewer.binaryDiffUnavailable')
            : undefined
        }
      />
    </div>
  );
}
