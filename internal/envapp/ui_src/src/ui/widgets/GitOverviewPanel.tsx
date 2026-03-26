import { For, Show } from 'solid-js';
import type {
  GitBranchSummary,
  GitGetBranchCompareResponse,
  GitListBranchesResponse,
  GitListWorkspaceChangesResponse,
  GitRepoSummaryResponse,
} from '../protocol/redeven_v1';
import { branchDisplayName, branchStatusSummary, compareHeadline, describeGitHead, summarizeWorkspaceCount } from '../utils/gitWorkbench';
import { gitCompareTone } from './GitChrome';
import { GitSection, GitStatStrip, GitSubtleNote } from './GitWorkbenchPrimitives';

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

export function GitOverviewPanel(props: GitOverviewPanelProps) {
  return (
    <div class="h-full min-h-0 overflow-auto px-3 py-3">
      <Show when={!props.summaryLoading} fallback={<div class="text-xs text-muted-foreground">Loading repository summary...</div>}>
        <Show when={!props.summaryError} fallback={<div class="text-xs break-words text-error">{props.summaryError}</div>}>
          <Show when={props.repoSummary} fallback={<div class="text-xs text-muted-foreground">Repository summary is unavailable.</div>}>
            {(summaryAccessor) => {
              const summary = summaryAccessor();
              const workspaceSummary = props.workspace?.summary ?? summary.workspaceSummary;
              const workspaceCount = summarizeWorkspaceCount(workspaceSummary);
              const localBranches = props.branches?.local?.length ?? 0;
              const remoteBranches = props.branches?.remote?.length ?? 0;
              const compareTone = () => gitCompareTone(props.compare?.targetAheadCount, props.compare?.targetBehindCount);
              const headDisplay = describeGitHead(summary);
              const repoSignals = () => [
                { label: 'Head', value: headDisplay.label, tone: headDisplay.detached ? 'warning' as const : 'brand' as const },
                headDisplay.detail ? { label: 'Commit', value: headDisplay.detail, tone: 'neutral' as const } : null,
                summary.upstreamRef ? { label: 'Upstream', value: summary.upstreamRef, tone: 'violet' as const } : null,
                summary.isWorktree
                  ? { label: 'Checkout', value: 'Linked worktree', tone: 'info' as const }
                  : { label: 'Checkout', value: 'Primary checkout', tone: 'neutral' as const },
                { label: 'Stashes', value: String(summary.stashCount ?? 0), tone: 'neutral' as const },
                { label: 'Context', value: summaryValue(props.currentPath, '/'), tone: 'info' as const },
              ].filter(Boolean) as { label: string; value: string; tone: 'neutral' | 'info' | 'brand' | 'warning' | 'violet' }[];

              return (
                <div class="space-y-1.5 sm:space-y-2">
                  <GitSection
                    label="Workspace Summary"
                    description={workspaceCount > 0 ? 'Files need review.' : 'Working tree is clean.'}
                    aside={workspaceCount > 0 ? `${workspaceCount} open` : 'Clean'}
                    tone={workspaceCount > 0 ? 'warning' : 'success'}
                  >
                    <GitStatStrip
                      columnsClass="grid-cols-2 xl:grid-cols-4"
                      items={[
                        { label: 'Staged', value: String(workspaceSummary?.stagedCount ?? 0) },
                        { label: 'Unstaged', value: String(workspaceSummary?.unstagedCount ?? 0) },
                        { label: 'Untracked', value: String(workspaceSummary?.untrackedCount ?? 0) },
                        { label: 'Conflicted', value: String(workspaceSummary?.conflictedCount ?? 0) },
                      ]}
                    />
                    <GitSubtleNote class="mt-2">
                      {workspaceCount > 0
                        ? 'Review staged, unstaged, untracked, and conflicted files from the Git sidebar.'
                        : 'No workspace changes are blocking the current review flow.'}
                    </GitSubtleNote>
                  </GitSection>

                  <GitSection
                    label="Selected Branch"
                    description={props.selectedBranch ? 'Branch context stays visible while you inspect compare details.' : 'Choose a branch from the sidebar to load compare context.'}
                    aside={`↑${summary.aheadCount ?? 0} ↓${summary.behindCount ?? 0}`}
                    tone={props.selectedBranch ? 'violet' : 'neutral'}
                  >
                    <div class="text-xs font-medium text-foreground">{props.selectedBranch ? branchDisplayName(props.selectedBranch) : 'Choose a branch'}</div>
                    <div class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      {props.selectedBranch ? branchStatusSummary(props.selectedBranch) : 'Branch compare details appear here after you pick a branch from the sidebar.'}
                    </div>
                    <Show when={props.selectedBranch?.subject}>
                      <GitSubtleNote class="mt-2 text-foreground">{props.selectedBranch?.subject}</GitSubtleNote>
                    </Show>
                    <GitStatStrip
                      class="mt-2"
                      columnsClass="grid-cols-2"
                      items={[
                        { label: 'Local branches', value: String(localBranches) },
                        { label: 'Remote branches', value: String(remoteBranches) },
                      ]}
                    />
                  </GitSection>

                  <GitSection
                    label="Repository Signals"
                    description="Fast repo context without leaving the current view."
                    aside={`${repoSignals().length} signals`}
                    tone="info"
                  >
                    <div class="space-y-0.5 rounded-md bg-muted/[0.12] p-0.5">
                      <For each={repoSignals()}>
                        {(signal) => (
                          <div class="flex items-start justify-between gap-3 rounded bg-background/70 px-2 py-1.5 text-[11px] transition-shadow duration-150 hover:shadow-sm" title={signal.value}>
                            <div class="shrink-0 text-muted-foreground/80">{signal.label}</div>
                            <div class="min-w-0 flex-1 truncate text-right font-medium text-foreground">{signal.value}</div>
                          </div>
                        )}
                      </For>
                    </div>
                  </GitSection>

                  <GitSection
                    label="Compare Snapshot"
                    description={compareHeadline(props.compare)}
                    aside={props.compare ? `${props.compare.commits.length} commits · ${props.compare.files.length} files` : undefined}
                    tone={compareTone()}
                  >
                    <Show when={props.compare} fallback={<div class="text-[11px] text-muted-foreground">Choose a branch from the sidebar to load compare details.</div>}>
                      {(compareAccessor) => {
                        const compare = compareAccessor();
                        return (
                          <GitStatStrip
                            columnsClass="grid-cols-2 lg:grid-cols-4"
                            items={[
                              { label: 'Base', value: compare.baseRef },
                              { label: 'Target', value: compare.targetRef },
                              { label: 'Ahead / Behind', value: `↑${compare.targetAheadCount ?? 0} ↓${compare.targetBehindCount ?? 0}` },
                              { label: 'Merge base', value: compare.mergeBase ? compare.mergeBase.slice(0, 7) : '—' },
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
