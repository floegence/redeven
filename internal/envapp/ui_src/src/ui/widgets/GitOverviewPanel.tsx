import { For, Show } from 'solid-js';
import type {
  GitBranchSummary,
  GitGetBranchCompareResponse,
  GitListBranchesResponse,
  GitListWorkspaceChangesResponse,
  GitRepoSummaryResponse,
} from '../protocol/redeven_v1';
import { branchDisplayName, branchStatusSummary, describeGitHead, summarizeWorkspaceCount } from '../utils/gitWorkbench';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import { gitCompareTone } from './GitChrome';
import { GitSection, GitStatStrip, GitSubtleNote } from './GitWorkbenchPrimitives';
import { useI18n, type I18nHelpers } from '../i18n';

export interface GitOverviewPanelProps {
  repoSummary?: GitRepoSummaryResponse | null;
  summaryLoading?: boolean;
  summaryError?: string;
  workspace?: GitListWorkspaceChangesResponse | null;
  branches?: GitListBranchesResponse | null;
  selectedBranch?: GitBranchSummary | null;
  compare?: GitGetBranchCompareResponse | null;
  currentPath: string;
}

function summaryValue(value: unknown, fallback = '—'): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function compareHeadline(compare: GitGetBranchCompareResponse | null | undefined, i18n: I18nHelpers): string {
  if (!compare) return i18n.t('git.overview.selectBranchesForCompare');
  const ahead = Number(compare.targetAheadCount ?? 0);
  const behind = Number(compare.targetBehindCount ?? 0);
  if (ahead <= 0 && behind <= 0) return i18n.t('git.overview.compareMatches');
  if (ahead > 0 && behind <= 0) return i18n.tn('git.overview.compareAhead', ahead);
  if (behind > 0 && ahead <= 0) return i18n.tn('git.overview.compareBehind', behind);
  return i18n.t('git.overview.compareDiverged', { ahead, behind });
}

export function GitOverviewPanel(props: GitOverviewPanelProps) {
  const i18n = useI18n();
  return (
    <div {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class="h-full min-h-0 overflow-auto px-3 py-3 sm:px-4 sm:py-4">
      <Show when={!props.summaryLoading} fallback={<div class="text-xs text-muted-foreground">{i18n.t('git.overview.loadingRepositorySummary')}</div>}>
        <Show when={!props.summaryError} fallback={<div class="text-xs break-words text-error">{props.summaryError}</div>}>
          <Show when={props.repoSummary} fallback={<div class="text-xs text-muted-foreground">{i18n.t('git.overview.repositorySummaryUnavailable')}</div>}>
            {(summaryAccessor) => {
              const summary = summaryAccessor();
              const workspaceSummary = props.workspace?.summary ?? summary.workspaceSummary;
              const workspaceCount = summarizeWorkspaceCount(workspaceSummary);
              const localBranches = props.branches?.local?.length ?? 0;
              const remoteBranches = props.branches?.remote?.length ?? 0;
              const compareTone = () => gitCompareTone(props.compare?.targetAheadCount, props.compare?.targetBehindCount);
              const headDisplay = describeGitHead(summary);
              const repoSignals = () => [
                { label: i18n.t('git.common.head'), value: headDisplay.label, tone: headDisplay.detached ? 'warning' as const : 'brand' as const },
                headDisplay.detail ? { label: i18n.t('git.common.commit'), value: headDisplay.detail, tone: 'neutral' as const } : null,
                summary.upstreamRef ? { label: i18n.t('git.common.upstream'), value: summary.upstreamRef, tone: 'violet' as const } : null,
                summary.isWorktree
                  ? { label: i18n.t('git.common.checkout'), value: i18n.t('git.overview.linkedWorktree'), tone: 'info' as const }
                  : { label: i18n.t('git.common.checkout'), value: i18n.t('git.overview.primaryCheckout'), tone: 'neutral' as const },
                { label: i18n.t('git.common.stashes'), value: String(summary.stashCount ?? 0), tone: 'neutral' as const },
                { label: i18n.t('git.common.context'), value: summaryValue(props.currentPath, '/'), tone: 'info' as const },
              ].filter(Boolean) as { label: string; value: string; tone: 'neutral' | 'info' | 'brand' | 'warning' | 'violet' }[];

              return (
                <div class="space-y-1.5 sm:space-y-2">
                  <GitSection
                    label={i18n.t('git.overview.workspaceSummary')}
                    description={workspaceCount > 0 ? i18n.t('git.overview.filesNeedReview') : i18n.t('git.overview.workingTreeClean')}
                    aside={workspaceCount > 0 ? i18n.tn('git.overview.openCount', workspaceCount) : i18n.t('git.common.clean')}
                    tone={workspaceCount > 0 ? 'warning' : 'success'}
                  >
                    <GitStatStrip
                      columnsClass="grid-cols-2 xl:grid-cols-4"
                      items={[
                        { label: i18n.t('git.common.staged'), value: String(workspaceSummary?.stagedCount ?? 0) },
                        { label: i18n.t('git.common.unstaged'), value: String(workspaceSummary?.unstagedCount ?? 0) },
                        { label: i18n.t('git.common.untracked'), value: String(workspaceSummary?.untrackedCount ?? 0) },
                        { label: i18n.t('git.common.conflicted'), value: String(workspaceSummary?.conflictedCount ?? 0) },
                      ]}
                    />
                    <GitSubtleNote class="mt-2">
                      {workspaceCount > 0
                        ? i18n.t('git.overview.reviewWorkspaceFromSidebar')
                        : i18n.t('git.overview.noWorkspaceBlockingReview')}
                    </GitSubtleNote>
                  </GitSection>

                  <GitSection
                    label={i18n.t('git.overview.selectedBranch')}
                    description={props.selectedBranch ? i18n.t('git.overview.branchContextVisible') : i18n.t('git.overview.chooseBranchToLoadCompare')}
                    aside={`↑${summary.aheadCount ?? 0} ↓${summary.behindCount ?? 0}`}
                    tone={props.selectedBranch ? 'violet' : 'neutral'}
                  >
                    <div class="text-xs font-medium text-foreground">{props.selectedBranch ? branchDisplayName(props.selectedBranch) : i18n.t('git.overview.chooseBranch')}</div>
                    <div class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      {props.selectedBranch ? branchStatusSummary(props.selectedBranch) : i18n.t('git.overview.branchCompareAppears')}
                    </div>
                    <Show when={props.selectedBranch?.subject}>
                      <GitSubtleNote class="mt-2 text-foreground">{props.selectedBranch?.subject}</GitSubtleNote>
                    </Show>
                    <GitStatStrip
                      class="mt-2"
                      columnsClass="grid-cols-2"
                      items={[
                        { label: i18n.t('git.common.localBranches'), value: String(localBranches) },
                        { label: i18n.t('git.common.remoteBranches'), value: String(remoteBranches) },
                      ]}
                    />
                  </GitSection>

                  <GitSection
                    label={i18n.t('git.overview.repositorySignals')}
                    description={i18n.t('git.overview.repositorySignalsDescription')}
                    aside={i18n.tn('git.common.signalCount', repoSignals().length)}
                    tone="info"
                  >
                    <div class="space-y-0.5 rounded-md bg-muted/[0.12] p-0.5">
                      <For each={repoSignals()}>
                        {(signal) => (
                          <div class="flex flex-col gap-1.5 rounded px-2 py-1.5 text-[11px] transition-colors duration-150 hover:bg-muted/[0.14] sm:flex-row sm:items-start sm:justify-between" title={signal.value}>
                            <div class="shrink-0 text-muted-foreground/80">{signal.label}</div>
                            <div class="min-w-0 break-words text-left font-medium text-foreground sm:flex-1 sm:truncate sm:text-right">{signal.value}</div>
                          </div>
                        )}
                      </For>
                    </div>
                  </GitSection>

                  <GitSection
                    label={i18n.t('git.overview.compareSnapshot')}
                    description={compareHeadline(props.compare, i18n)}
                    aside={props.compare ? `${i18n.tn('git.common.commitCount', props.compare.commits.length)} · ${i18n.tn('git.common.fileCount', props.compare.files.length)}` : undefined}
                    tone={compareTone()}
                  >
                    <Show when={props.compare} fallback={<div class="text-[11px] text-muted-foreground">{i18n.t('git.overview.chooseBranchToLoadDetails')}</div>}>
                      {(compareAccessor) => {
                        const compare = compareAccessor();
                        return (
                          <GitStatStrip
                            columnsClass="grid-cols-2 lg:grid-cols-4"
                            items={[
                              { label: i18n.t('git.common.base'), value: compare.baseRef },
                              { label: i18n.t('git.common.target'), value: compare.targetRef },
                              { label: i18n.t('git.common.aheadBehind'), value: `↑${compare.targetAheadCount ?? 0} ↓${compare.targetBehindCount ?? 0}` },
                              { label: i18n.t('git.common.mergeBase'), value: compare.mergeBase ? compare.mergeBase.slice(0, 7) : '—' },
                            ]}
                          />
                        );
                      }}
                    </Show>
                  </GitSection>
                </div>
              );
            }}
          </Show>
        </Show>
      </Show>
    </div>
  );
}
