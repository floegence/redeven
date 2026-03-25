import { For, Show, createMemo, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Code, FileText, Refresh, Trash } from '@floegence/floe-webapp-core/icons';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Input, Tag, Textarea } from '@floegence/floe-webapp-core/ui';

import { CodexIcon } from '../icons/CodexIcon';
import { useCodexContext } from './CodexProvider';
import {
  buildTranscriptSnapshot,
  collectRecentArtifacts,
  displayStatus,
  formatUpdatedAt,
  itemGlyph,
  itemText,
  itemTitle,
  requestTagVariant,
  statusTagVariant,
} from './presentation';
import type { CodexItem, CodexTranscriptItem } from './types';

function SnapshotField(props: {
  label: string;
  value: string;
  helper?: string;
  mono?: boolean;
  tag?: JSX.Element;
}) {
  return (
    <div class="rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm">
      <div class="flex items-start justify-between gap-2">
        <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{props.label}</div>
        {props.tag}
      </div>
      <div class={cn('mt-3 text-sm font-medium leading-6 text-foreground', props.mono && 'font-mono text-xs')}>
        {props.value}
      </div>
      <Show when={props.helper}>
        <div class="mt-2 text-xs leading-5 text-muted-foreground">{props.helper}</div>
      </Show>
    </div>
  );
}

function artifactDiffPreview(diff: string | null | undefined): string {
  const value = String(diff ?? '').trim();
  if (!value) return 'Diff preview unavailable.';
  const lines = value.split('\n').slice(0, 6);
  return lines.join('\n');
}

function transcriptShellClass(item: CodexItem): string {
  switch (item.type) {
    case 'userMessage':
      return 'border-primary/25 bg-primary/[0.05]';
    case 'fileChange':
      return 'border-emerald-500/25 bg-emerald-500/[0.04]';
    case 'reasoning':
    case 'plan':
      return 'border-sky-500/20 bg-sky-500/[0.04]';
    default:
      return 'border-border/60 bg-background/90';
  }
}

function transcriptEyebrow(item: CodexItem): string {
  switch (item.type) {
    case 'userMessage':
      return 'Review brief';
    case 'agentMessage':
      return 'Review response';
    case 'fileChange':
      return 'Artifact bundle';
    case 'commandExecution':
      return 'Execution evidence';
    case 'reasoning':
      return 'Internal note';
    case 'plan':
      return 'Execution outline';
    default:
      return 'Transcript item';
  }
}

function itemBody(item: CodexTranscriptItem): JSX.Element {
  switch (item.type) {
    case 'commandExecution':
      return (
        <div class="space-y-3">
          <div class="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
            <div class="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
              <div class="min-w-0">
                <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Working directory</div>
                <div class="mt-1 truncate font-mono text-xs text-slate-200">{item.cwd || 'Working directory unavailable'}</div>
              </div>
              <div class="rounded-full border border-slate-700 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300">
                Command
              </div>
            </div>
            <div class="space-y-3 p-4 font-mono text-xs text-slate-100">
              <div>{item.command || 'Command unavailable'}</div>
              <Show when={item.aggregated_output}>
                <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-900/80 p-3 text-[11px] text-slate-300">
                  {item.aggregated_output}
                </pre>
              </Show>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <Show when={item.status}>
              <Tag variant={statusTagVariant(item.status)} tone="soft" size="sm">
                Status: {displayStatus(item.status)}
              </Tag>
            </Show>
            <Show when={typeof item.exit_code === 'number'}>
              <Tag variant={item.exit_code === 0 ? 'success' : 'error'} tone="soft" size="sm">
                Exit code: {item.exit_code}
              </Tag>
            </Show>
            <Show when={typeof item.duration_ms === 'number'}>
              <Tag variant="neutral" tone="soft" size="sm">
                {item.duration_ms} ms
              </Tag>
            </Show>
          </div>
        </div>
      );
    case 'fileChange':
      return (
        <div class="space-y-3">
          <For each={item.changes ?? []}>
            {(change) => (
              <div class="rounded-2xl border border-emerald-500/20 bg-background/85 p-4 shadow-sm">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Changed file
                    </div>
                    <div class="mt-1 truncate font-mono text-xs text-foreground">{change.path}</div>
                    <Show when={change.move_path}>
                      <div class="mt-1 text-xs text-muted-foreground">Move path: {change.move_path}</div>
                    </Show>
                  </div>
                  <Tag variant="success" tone="soft" size="sm">
                    {change.kind}
                  </Tag>
                </div>
                <pre class="mt-4 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border/60 bg-muted/15 p-3 font-mono text-[11px] text-muted-foreground">
                  {change.diff || 'No diff provided.'}
                </pre>
              </div>
            )}
          </For>
          <Show when={(item.changes?.length ?? 0) === 0}>
            <div class="text-sm text-muted-foreground">No file change details were provided yet.</div>
          </Show>
        </div>
      );
    case 'reasoning':
      return (
        <div class="space-y-3">
          <Show when={(item.summary?.length ?? 0) > 0}>
            <ul class="list-disc space-y-1 pl-5 text-sm leading-6 text-foreground">
              <For each={item.summary}>{(entry) => <li>{entry}</li>}</For>
            </ul>
          </Show>
          <Show when={item.text}>
            <pre class="whitespace-pre-wrap break-words rounded-xl border border-border/60 bg-background/80 p-4 text-sm leading-6 text-muted-foreground">
              {item.text}
            </pre>
          </Show>
        </div>
      );
    case 'agentMessage':
      return <div class="whitespace-pre-wrap break-words text-[15px] leading-7 text-foreground">{itemText(item)}</div>;
    case 'plan':
    case 'userMessage':
    default:
      return <div class="whitespace-pre-wrap break-words text-sm leading-7 text-foreground">{itemText(item)}</div>;
  }
}

export function CodexPage() {
  const codex = useCodexContext();

  const snapshot = createMemo(() => buildTranscriptSnapshot(codex.transcriptItems()));
  const recentArtifacts = createMemo(() => collectRecentArtifacts(codex.transcriptItems(), 4));
  const workspaceLabel = createMemo(() => {
    const thread = codex.activeThread();
    const candidates = [thread?.path, thread?.cwd, codex.workingDirDraft(), codex.status()?.agent_home_dir];
    for (const candidate of candidates) {
      const value = String(candidate ?? '').trim();
      if (value) return value;
    }
    return 'Set a workspace path below';
  });
  const modelLabel = createMemo(() =>
    codex.modelDraft() || codex.activeThread()?.model_provider || 'Host default model'
  );
  const latestActivityLabel = createMemo(() => {
    const updatedAt = formatUpdatedAt(codex.activeThread()?.updated_at_unix_s ?? 0);
    return updatedAt || 'No thread activity yet';
  });
  const nextActionLabel = createMemo(() => {
    if (!codex.hasHostBinary()) return 'Install the host Codex binary and refresh diagnostics.';
    if (codex.pendingRequests().length > 0) return 'Resolve pending approvals or user-input requests to continue the run.';
    if (!codex.activeThreadID()) return 'Create the first review thread and send a brief.';
    return 'Send the next review instruction or implementation follow-up.';
  });
  const reviewSummary = createMemo(() => {
    if (!codex.hasHostBinary()) {
      return 'Redeven keeps this surface visible even when host Codex is unavailable, so diagnostics and setup guidance stay in one place.';
    }
    if (!codex.activeThreadID()) {
      return 'This workbench is tuned for review-heavy Codex sessions: briefs, approvals, artifacts, and transcript evidence all live together without borrowing Flower state.';
    }
    if (codex.pendingRequests().length > 0) {
      return `Codex is waiting on ${codex.pendingRequests().length} review response${codex.pendingRequests().length === 1 ? '' : 's'} before it can continue the active run.`;
    }
    if (recentArtifacts().length > 0) {
      return `${recentArtifacts().length} recent artifact ${recentArtifacts().length === 1 ? 'preview is' : 'previews are'} surfaced here so review and sign-off can happen without leaving the transcript.`;
    }
    if (codex.transcriptItems().length > 0) {
      return 'The active thread is ready for the next review turn, with transcript evidence and runtime diagnostics aligned in the same workbench.';
    }
    return 'The active thread is ready for its first review prompt.';
  });

  const emptyStateTitle = () => (codex.hasHostBinary() ? 'Start a dedicated Codex review' : 'Install Codex on the host');
  const emptyStateBody = () =>
    codex.hasHostBinary()
      ? 'Use the dedicated Codex sidebar to open or create a review thread. Artifacts, approvals, and transcript evidence stay isolated from Flower while still living inside the shared Env shell.'
      : 'Redeven does not configure Codex for you. Install the host machine\'s `codex` binary, expose it on PATH, then refresh diagnostics to start local Codex review sessions.';

  return (
    <div class="flex h-full min-h-0 flex-col bg-muted/[0.04]">
      <Show when={codex.statusLoading()}>
        <LoadingOverlay visible message="Loading Codex..." />
      </Show>

      <div class="min-h-0 flex-1 overflow-auto">
        <div class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6">
          <Card class="overflow-hidden border-border/60 bg-background/95 shadow-sm">
            <CardHeader class="gap-5 border-b border-border/60 pb-5">
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div class="flex min-w-0 items-start gap-4">
                  <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-muted/20 shadow-sm">
                    <CodexIcon class="h-7 w-7" />
                  </div>
                  <div class="min-w-0">
                    <div class="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                      Artifact review workbench
                    </div>
                    <div class="mt-2 flex flex-wrap items-center gap-2">
                      <CardTitle class="text-lg">{codex.threadTitle()}</CardTitle>
                      <Tag variant={statusTagVariant(codex.activeStatus())} tone="soft" size="sm">
                        {displayStatus(codex.activeStatus())}
                      </Tag>
                      <Tag
                        variant={codex.hasHostBinary() ? 'success' : 'warning'}
                        tone="soft"
                        size="sm"
                      >
                        {codex.hasHostBinary() ? 'Host runtime detected' : 'Host install needed'}
                      </Tag>
                    </div>
                    <CardDescription class="mt-2 max-w-3xl leading-6">
                      Production Codex surface for review-heavy work: briefs, approvals, artifacts, and runtime evidence stay together while Codex itself remains host-native and independent from Flower.
                    </CardDescription>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void codex.refreshActiveThread()}
                    disabled={!codex.activeThreadID() || codex.refreshingThread()}
                  >
                    <Refresh class="mr-2 h-4 w-4" />
                    {codex.refreshingThread() ? 'Refreshing...' : 'Refresh'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void codex.archiveActiveThread()}
                    disabled={!codex.activeThreadID()}
                  >
                    <Trash class="mr-2 h-4 w-4" />
                    Archive
                  </Button>
                </div>
              </div>

              <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SnapshotField
                  label="Workspace"
                  value={workspaceLabel()}
                  helper="The active review can override the workspace before its first turn."
                  mono
                />
                <SnapshotField
                  label="Model"
                  value={modelLabel()}
                  helper="Model override is optional and only applied when you provide one."
                />
                <SnapshotField
                  label="Artifacts"
                  value={String(snapshot().artifactCount)}
                  helper="Changed files surfaced from Codex transcript items."
                  tag={
                    <Tag variant={snapshot().artifactCount > 0 ? 'success' : 'neutral'} tone="soft" size="sm">
                      {snapshot().artifactCount > 0 ? 'Ready' : 'None yet'}
                    </Tag>
                  }
                />
                <SnapshotField
                  label="Pending"
                  value={String(codex.pendingRequests().length)}
                  helper="Approval and user-input requests that still block progress."
                  tag={
                    <Tag
                      variant={codex.pendingRequests().length > 0 ? 'warning' : 'neutral'}
                      tone="soft"
                      size="sm"
                    >
                      {codex.pendingRequests().length > 0 ? 'Needs review' : 'Clear'}
                    </Tag>
                  }
                />
              </div>
            </CardHeader>

            <CardContent class="grid gap-3 pt-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
              <div class="rounded-2xl border border-border/60 bg-muted/10 p-5">
                <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Review summary
                </div>
                <div class="mt-3 max-w-3xl text-base font-medium leading-7 text-foreground">{reviewSummary()}</div>
                <div class="mt-4 flex flex-wrap gap-2">
                  <Tag variant="neutral" tone="soft" size="sm">
                    {snapshot().responseCount} review response{snapshot().responseCount === 1 ? '' : 's'}
                  </Tag>
                  <Tag variant="neutral" tone="soft" size="sm">
                    {snapshot().commandCount} command evidence block{snapshot().commandCount === 1 ? '' : 's'}
                  </Tag>
                  <Tag variant="neutral" tone="soft" size="sm">
                    {snapshot().reasoningCount} reasoning note{snapshot().reasoningCount === 1 ? '' : 's'}
                  </Tag>
                </div>
              </div>

              <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <SnapshotField
                  label="Next action"
                  value={nextActionLabel()}
                  helper="This keeps the active review moving without mixing Codex behavior into Flower."
                />
                <SnapshotField
                  label="Latest activity"
                  value={latestActivityLabel()}
                  helper={codex.activeThreadID() ? 'Pulled from the active thread metadata.' : 'Starts once a review thread is created.'}
                />
              </div>
            </CardContent>
          </Card>

          <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
            <div class="flex min-h-0 flex-col gap-6">
              <Show when={codex.pendingRequests().length > 0}>
                <section aria-label="Pending Codex requests" class="space-y-3">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Pending review queue
                      </div>
                      <div class="mt-1 text-sm font-medium text-foreground">Requests that need a response before Codex can continue.</div>
                    </div>
                    <Tag variant="warning" tone="soft" size="sm">
                      {codex.pendingRequests().length}
                    </Tag>
                  </div>

                  <div class="space-y-3">
                    <For each={codex.pendingRequests()}>
                      {(request) => (
                        <Card class="overflow-hidden border-border/60 bg-background/90">
                          <CardHeader class="gap-3 border-b border-border/60 pb-4">
                            <div class="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                  Review request
                                </div>
                                <div class="mt-2 flex flex-wrap items-center gap-2">
                                  <CardTitle class="text-sm capitalize">
                                    {request.type.replaceAll('_', ' ')}
                                  </CardTitle>
                                  <Tag variant={requestTagVariant(request.type)} tone="soft" size="sm">
                                    {displayStatus(request.type, 'Request')}
                                  </Tag>
                                  <Tag variant="neutral" tone="soft" size="sm">
                                    Item {request.item_id}
                                  </Tag>
                                </div>
                                <CardDescription class="mt-2 max-w-3xl">
                                  {request.reason || 'Codex needs a response to continue this turn.'}
                                </CardDescription>
                              </div>
                            </div>
                          </CardHeader>

                          <CardContent class="space-y-4 pt-4">
                            <Show when={request.command}>
                              <div class="rounded-2xl border border-border/60 bg-muted/10 p-4 font-mono text-xs text-foreground">
                                <div class="mb-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                  {request.cwd || 'Working directory unavailable'}
                                </div>
                                {request.command}
                              </div>
                            </Show>

                            <Show when={request.permissions}>
                              <div class="rounded-2xl border border-border/60 bg-muted/10 p-4 text-sm text-muted-foreground">
                                <div class="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                  Requested permissions
                                </div>
                                <div class="space-y-3">
                                  <Show when={(request.permissions?.file_system_write?.length ?? 0) > 0}>
                                    <div>
                                      <div class="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Write</div>
                                      <div class="mt-1 font-mono text-xs text-foreground">
                                        {(request.permissions?.file_system_write ?? []).join(', ')}
                                      </div>
                                    </div>
                                  </Show>
                                  <Show when={(request.permissions?.file_system_read?.length ?? 0) > 0}>
                                    <div>
                                      <div class="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Read</div>
                                      <div class="mt-1 font-mono text-xs text-foreground">
                                        {(request.permissions?.file_system_read ?? []).join(', ')}
                                      </div>
                                    </div>
                                  </Show>
                                  <Show when={request.permissions?.network_enabled}>
                                    <Tag variant="info" tone="soft" size="sm">
                                      Network access requested
                                    </Tag>
                                  </Show>
                                </div>
                              </div>
                            </Show>

                            <Show when={(request.questions?.length ?? 0) > 0}>
                              <div class="space-y-3">
                                <For each={request.questions ?? []}>
                                  {(question) => (
                                    <div class="rounded-2xl border border-border/60 bg-muted/10 p-4">
                                      <div class="text-sm font-medium text-foreground">{question.header}</div>
                                      <div class="mt-1 text-sm leading-6 text-muted-foreground">{question.question}</div>
                                      <Input
                                        type={question.is_secret ? 'password' : 'text'}
                                        value={codex.requestDraftValue(request.id, question.id)}
                                        onInput={(event) => codex.setRequestDraftValue(request.id, question.id, event.currentTarget.value)}
                                        placeholder={question.options?.[0]?.label || 'Enter response'}
                                        class="mt-3 w-full"
                                      />
                                      <Show when={(question.options?.length ?? 0) > 0}>
                                        <div class="mt-3 flex flex-wrap gap-2">
                                          <For each={question.options ?? []}>
                                            {(option) => (
                                              <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                onClick={() => codex.setRequestDraftValue(request.id, question.id, option.label)}
                                              >
                                                {option.label}
                                              </Button>
                                            )}
                                          </For>
                                        </div>
                                      </Show>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </CardContent>

                          <CardFooter class="flex flex-wrap gap-2 border-t border-border/60 pt-4">
                            <Show
                              when={request.type === 'user_input'}
                              fallback={
                                <>
                                  <Button size="sm" onClick={() => void codex.answerRequest(request, 'accept')}>
                                    Approve once
                                  </Button>
                                  <Show when={(request.available_decisions ?? []).includes('accept_for_session')}>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => void codex.answerRequest(request, 'accept_for_session')}
                                    >
                                      Approve for session
                                    </Button>
                                  </Show>
                                  <Button size="sm" variant="outline" onClick={() => void codex.answerRequest(request, 'decline')}>
                                    Decline
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => void codex.answerRequest(request, 'cancel')}>
                                    Cancel
                                  </Button>
                                </>
                              }
                            >
                              <Button size="sm" onClick={() => void codex.answerRequest(request)}>
                                Submit response
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => void codex.answerRequest(request, 'cancel')}>
                                Cancel
                              </Button>
                            </Show>
                          </CardFooter>
                        </Card>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <Show when={recentArtifacts().length > 0}>
                <section aria-label="Recent Codex artifacts" class="space-y-3">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Latest artifacts
                      </div>
                      <div class="mt-1 text-sm font-medium text-foreground">Changed files surfaced from the active review thread.</div>
                    </div>
                    <Tag variant="success" tone="soft" size="sm">
                      {recentArtifacts().length}
                    </Tag>
                  </div>

                  <div class="grid gap-3 lg:grid-cols-2">
                    <For each={recentArtifacts()}>
                      {(artifact) => (
                        <Card class="overflow-hidden border-border/60 bg-background/90">
                          <CardHeader class="gap-2 border-b border-border/60 pb-4">
                            <div class="flex items-start justify-between gap-3">
                              <div class="min-w-0">
                                <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                  Artifact preview
                                </div>
                                <CardTitle class="mt-2 truncate font-mono text-xs">{artifact.path}</CardTitle>
                                <Show when={artifact.movePath}>
                                  <CardDescription class="mt-1 font-mono text-[11px]">
                                    Move path: {artifact.movePath}
                                  </CardDescription>
                                </Show>
                              </div>
                              <Tag variant="success" tone="soft" size="sm">
                                {artifact.kind}
                              </Tag>
                            </div>
                          </CardHeader>
                          <CardContent class="pt-4">
                            <pre class="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border/60 bg-muted/10 p-3 font-mono text-[11px] text-muted-foreground">
                              {artifactDiffPreview(artifact.diff)}
                            </pre>
                          </CardContent>
                        </Card>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <section aria-label="Codex transcript" class="space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      Review transcript
                    </div>
                    <div class="mt-1 text-sm font-medium text-foreground">All review notes, artifacts, and runtime evidence for the active Codex thread.</div>
                  </div>
                  <Tag variant="neutral" tone="soft" size="sm">
                    {codex.transcriptItems().length}
                  </Tag>
                </div>

                <Show
                  when={codex.transcriptItems().length > 0}
                  fallback={
                    <Card class="border-dashed border-border/60 bg-background/80">
                      <CardContent class="flex min-h-[20rem] flex-col items-center justify-center p-8 text-center">
                        <div class="flex h-16 w-16 items-center justify-center rounded-2xl border border-border/60 bg-muted/20">
                          <CodexIcon class="h-8 w-8" />
                        </div>
                        <div class="mt-5 text-lg font-semibold text-foreground">{emptyStateTitle()}</div>
                        <div class="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{emptyStateBody()}</div>
                        <div class="mt-5 flex flex-wrap justify-center gap-2">
                          <Tag variant="neutral" tone="soft" size="sm">
                            Dedicated activity-bar entry
                          </Tag>
                          <Tag variant="neutral" tone="soft" size="sm">
                            Separate gateway namespace
                          </Tag>
                          <Tag variant="neutral" tone="soft" size="sm">
                            Review-oriented workbench
                          </Tag>
                        </div>
                      </CardContent>
                    </Card>
                  }
                >
                  <div class="space-y-4">
                    <For each={codex.transcriptItems()}>
                      {(item) => (
                        <Card class={cn('overflow-hidden shadow-sm', transcriptShellClass(item))}>
                          <CardHeader class="gap-3 border-b border-border/60 pb-4">
                            <div class="flex items-start justify-between gap-3">
                              <div class="flex items-start gap-3">
                                <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-background/80 text-foreground shadow-sm">
                                  {itemGlyph(item)}
                                </div>
                                <div>
                                  <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                    {transcriptEyebrow(item)}
                                  </div>
                                  <div class="mt-2 flex flex-wrap items-center gap-2">
                                    <CardTitle class="text-sm">{itemTitle(item)}</CardTitle>
                                    <Tag variant="neutral" tone="soft" size="sm">
                                      {displayStatus(item.type, 'Event')}
                                    </Tag>
                                    <Show when={item.status}>
                                      <Tag variant={statusTagVariant(item.status)} tone="soft" size="sm">
                                        {displayStatus(item.status)}
                                      </Tag>
                                    </Show>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent class="pt-4">{itemBody(item)}</CardContent>
                        </Card>
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            </div>

            <div class="flex flex-col gap-6 xl:sticky xl:top-6 xl:self-start">
              <Card class="overflow-hidden border-border/60 bg-background/95 shadow-sm">
                <CardHeader class="gap-3 border-b border-border/60 pb-4">
                  <div class="flex items-start gap-3">
                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/20">
                      <Code class="h-4 w-4" />
                    </div>
                    <div>
                      <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Composer
                      </div>
                      <CardTitle class="mt-2 text-sm">Send the next review turn</CardTitle>
                      <CardDescription class="mt-1">
                        Use this to open a fresh review, request a change, or ask Codex to summarize artifacts without borrowing Flower thread behavior.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>

                <CardContent class="space-y-4 pt-4">
                  <label class="block">
                    <div class="mb-1 text-xs font-medium text-foreground">Working directory</div>
                    <Input
                      value={codex.workingDirDraft()}
                      onInput={(event) => codex.setWorkingDirDraft(event.currentTarget.value)}
                      placeholder={codex.status()?.agent_home_dir || 'Absolute workspace path'}
                      class="w-full"
                    />
                  </label>

                  <label class="block">
                    <div class="mb-1 text-xs font-medium text-foreground">Model override</div>
                    <Input
                      value={codex.modelDraft()}
                      onInput={(event) => codex.setModelDraft(event.currentTarget.value)}
                      placeholder="Use host Codex default model"
                      class="w-full"
                    />
                  </label>

                  <label class="block">
                    <div class="mb-1 text-xs font-medium text-foreground">Review brief</div>
                    <Textarea
                      value={codex.composerText()}
                      onInput={(event) => codex.setComposerText(event.currentTarget.value)}
                      rows={8}
                      placeholder="Describe the implementation review, bug, diff, or follow-up for Codex..."
                      class="min-h-[10rem] w-full"
                    />
                  </label>
                </CardContent>

                <CardFooter class="flex-col items-stretch gap-3 border-t border-border/60 pt-4">
                  <div class="text-xs leading-6 text-muted-foreground">
                    The dedicated sidebar owns review-thread navigation, so this workbench can stay focused on transcript evidence, approvals, and the next turn.
                  </div>
                  <Button
                    onClick={() => void codex.sendTurn()}
                    disabled={!String(codex.composerText() ?? '').trim() || codex.submitting()}
                  >
                    {codex.submitting() ? 'Sending...' : codex.activeThreadID() ? 'Send to Codex' : 'Create review and send'}
                  </Button>
                </CardFooter>
              </Card>

              <Show when={!codex.hasHostBinary()}>
                <Card class="border-warning/30 bg-warning/5">
                  <CardHeader class="pb-3">
                    <CardTitle class="text-sm">Host diagnostics</CardTitle>
                    <CardDescription>
                      Redeven uses the host machine&apos;s <span class="font-mono">codex</span> binary directly.
                    </CardDescription>
                  </CardHeader>
                  <CardContent class="text-sm leading-6 text-muted-foreground">
                    Install it on the host and keep it on <span class="font-mono">PATH</span>; there is no separate in-app Codex runtime toggle to manage here.
                  </CardContent>
                </Card>
              </Show>

              <Show when={codex.statusError()}>
                <Card class="border-warning/30 bg-warning/5">
                  <CardHeader class="pb-3">
                    <CardTitle class="text-sm">Status error</CardTitle>
                  </CardHeader>
                  <CardContent class="text-sm text-warning">{codex.statusError()}</CardContent>
                </Card>
              </Show>

              <Show when={codex.streamError()}>
                <Card class="border-warning/30 bg-warning/5">
                  <CardHeader class="pb-3">
                    <CardTitle class="text-sm">Live event stream</CardTitle>
                  </CardHeader>
                  <CardContent class="text-sm text-warning">
                    Live event stream disconnected: {codex.streamError()}
                  </CardContent>
                </Card>
              </Show>

              <Show when={codex.activeStatusFlags().length > 0}>
                <Card class="border-border/60 bg-background/90">
                  <CardHeader class="pb-3">
                    <CardTitle class="text-sm">Runtime flags</CardTitle>
                    <CardDescription>Codex-reported state flags for the active review thread.</CardDescription>
                  </CardHeader>
                  <CardContent class="flex flex-wrap gap-2">
                    <For each={codex.activeStatusFlags()}>
                      {(flag) => (
                        <Tag variant={statusTagVariant(flag)} tone="soft" size="sm">
                          {displayStatus(flag, 'Flag')}
                        </Tag>
                      )}
                    </For>
                  </CardContent>
                </Card>
              </Show>

              <Card class="border-border/60 bg-background/90">
                <CardHeader class="pb-3">
                  <div class="flex items-start gap-3">
                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/20">
                      <FileText class="h-4 w-4" />
                    </div>
                    <div>
                      <CardTitle class="text-sm">Review contract</CardTitle>
                      <CardDescription class="mt-1">
                        Codex owns the host execution and Redeven owns the shell around it.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent class="space-y-2 text-sm leading-6 text-muted-foreground">
                  <div>Codex threads, approvals, and artifacts stay separate from Flower.</div>
                  <div>The gateway surface stays under the dedicated `/_redeven_proxy/api/codex/*` namespace.</div>
                  <div>Host defaults remain owned by the local Codex installation unless you override a field explicitly in this composer.</div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
