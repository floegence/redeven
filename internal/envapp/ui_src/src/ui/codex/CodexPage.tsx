import { For, Show, type JSX } from 'solid-js';
import { Code, FileText, Refresh, Terminal, Trash } from '@floegence/floe-webapp-core/icons';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Input, Tag, Textarea, type TagProps } from '@floegence/floe-webapp-core/ui';

import { CodexIcon } from '../icons/CodexIcon';
import { useCodexContext } from './CodexProvider';
import type { CodexItem, CodexTranscriptItem } from './types';

function itemTitle(item: CodexItem): string {
  switch (item.type) {
    case 'userMessage':
      return 'You';
    case 'agentMessage':
      return 'Codex';
    case 'commandExecution':
      return 'Command';
    case 'fileChange':
      return 'File change';
    case 'reasoning':
      return 'Reasoning';
    case 'plan':
      return 'Plan';
    default:
      return item.type || 'Event';
  }
}

function displayStatus(value: string | null | undefined, fallback = 'Idle'): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return fallback;
  return normalized.replaceAll('_', ' ');
}

function statusTagVariant(status: string | null | undefined): TagProps['variant'] {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (!normalized) return 'neutral';
  if (normalized === 'idle' || normalized === 'ready' || normalized === 'archived') return 'neutral';
  if (normalized === 'completed' || normalized === 'success') return 'success';
  if (
    normalized === 'running' ||
    normalized === 'accepted' ||
    normalized === 'recovering' ||
    normalized === 'finalizing'
  ) {
    return 'info';
  }
  if (normalized.includes('approval') || normalized.includes('waiting') || normalized.includes('input')) {
    return 'warning';
  }
  if (normalized.includes('error') || normalized.includes('fail') || normalized.includes('decline')) {
    return 'error';
  }
  return 'neutral';
}

function requestTagVariant(type: string): TagProps['variant'] {
  const normalized = String(type ?? '').trim().toLowerCase();
  if (normalized === 'user_input') return 'info';
  if (normalized.includes('approval') || normalized === 'permissions') return 'warning';
  return 'neutral';
}

function itemText(item: CodexTranscriptItem): string {
  if (String(item.text ?? '').trim()) return String(item.text);
  if ((item.content?.length ?? 0) > 0) return (item.content ?? []).join('\n');
  return 'No content.';
}

function itemGlyph(item: CodexItem): JSX.Element {
  switch (item.type) {
    case 'agentMessage':
      return <CodexIcon class="h-4 w-4" />;
    case 'commandExecution':
      return <Terminal class="h-4 w-4" />;
    case 'reasoning':
    case 'plan':
      return <Code class="h-4 w-4" />;
    default:
      return <FileText class="h-4 w-4" />;
  }
}

function SummaryField(props: {
  label: string;
  value: string;
  helper?: string;
  mono?: boolean;
  tag?: JSX.Element;
}) {
  return (
    <div class="rounded-lg border border-border/60 bg-muted/10 p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-xs font-medium text-foreground">{props.label}</div>
        {props.tag}
      </div>
      <div class={props.mono ? 'mt-2 truncate font-mono text-xs text-foreground' : 'mt-2 text-sm text-foreground'}>
        {props.value}
      </div>
      <Show when={props.helper}>
        <div class="mt-1 text-xs leading-5 text-muted-foreground">{props.helper}</div>
      </Show>
    </div>
  );
}

function itemBody(item: CodexTranscriptItem): JSX.Element {
  switch (item.type) {
    case 'commandExecution':
      return (
        <div class="space-y-3">
          <div class="rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-100">
            <div class="mb-2 text-[11px] text-slate-400">{item.cwd || 'Working directory unavailable'}</div>
            <div>{item.command || 'Command unavailable'}</div>
            <Show when={item.aggregated_output}>
              <pre class="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-900/80 p-2 text-[11px] text-slate-300">
                {item.aggregated_output}
              </pre>
            </Show>
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
          </div>
        </div>
      );
    case 'fileChange':
      return (
        <div class="space-y-3">
          <For each={item.changes ?? []}>
            {(change) => (
              <Card class="border-border/60 bg-muted/10">
                <CardHeader class="pb-2">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <CardTitle class="truncate font-mono text-xs">{change.path}</CardTitle>
                      <Show when={change.move_path}>
                        <CardDescription class="mt-1 font-mono text-[11px]">
                          Move path: {change.move_path}
                        </CardDescription>
                      </Show>
                    </div>
                    <Tag variant="info" tone="soft" size="sm">
                      {change.kind}
                    </Tag>
                  </div>
                </CardHeader>
                <CardContent>
                  <pre class="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-background p-3 font-mono text-[11px] text-muted-foreground">
                    {change.diff || 'No diff provided.'}
                  </pre>
                </CardContent>
              </Card>
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
            <ul class="list-disc space-y-1 pl-5 text-sm text-foreground">
              <For each={item.summary}>{(entry) => <li>{entry}</li>}</For>
            </ul>
          </Show>
          <Show when={item.text}>
            <pre class="whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-muted/10 p-3 text-sm text-muted-foreground">
              {item.text}
            </pre>
          </Show>
        </div>
      );
    case 'plan':
    case 'agentMessage':
    case 'userMessage':
    default:
      return <div class="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{itemText(item)}</div>;
  }
}

export function CodexPage() {
  const codex = useCodexContext();

  const emptyStateTitle = () => (codex.hasHostBinary() ? 'Start a dedicated Codex thread' : 'Install Codex on the host');
  const emptyStateBody = () =>
    codex.hasHostBinary()
      ? 'Use the dedicated Codex sidebar to switch threads or create a fresh session. The transcript, approvals, and gateway contract all stay isolated from Flower.'
      : 'Redeven does not configure Codex for you. Install the host machine\'s `codex` binary, expose it on PATH, then refresh diagnostics to start local Codex sessions.';

  return (
    <div class="flex h-full min-h-0 flex-col bg-muted/[0.04]">
      <Show when={codex.statusLoading()}>
        <LoadingOverlay visible message="Loading Codex..." />
      </Show>

      <div class="min-h-0 flex-1 overflow-auto">
        <div class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-6">
          <Card class="border-border/60">
            <CardHeader class="gap-4">
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div class="flex min-w-0 items-start gap-3">
                  <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/20">
                    <CodexIcon class="h-6 w-6" />
                  </div>
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <CardTitle class="text-base">{codex.threadTitle()}</CardTitle>
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
                    <CardDescription class="mt-1 max-w-3xl leading-6">
                      Dedicated Codex workspace that uses the host machine&apos;s binary directly and keeps threads, approvals, and request handling outside Flower.
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
            </CardHeader>

            <CardContent class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <SummaryField
                label="Bridge"
                value={codex.status()?.ready ? 'Connected' : 'Starts on demand'}
                helper="Redeven owns the gateway boundary and spawns the host runtime only when needed."
                tag={
                  <Tag variant={codex.status()?.ready ? 'success' : 'neutral'} tone="soft" size="sm">
                    {codex.status()?.ready ? 'Ready' : 'Idle'}
                  </Tag>
                }
              />
              <SummaryField
                label="Binary"
                value={codex.status()?.binary_path || 'Not detected'}
                helper="The host machine owns the Codex installation and defaults."
                mono
              />
              <SummaryField
                label="Working directory"
                value={codex.workingDirDraft() || codex.status()?.agent_home_dir || 'Set below'}
                helper="The first turn can override the workspace path for a new thread."
                mono
              />
              <SummaryField
                label="Model"
                value={codex.modelDraft() || codex.activeThread()?.model_provider || 'Host default'}
                helper="Model override is optional and only applied when you provide one."
              />
            </CardContent>
          </Card>

          <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div class="flex min-h-0 flex-col gap-6">
              <Show when={codex.pendingRequests().length > 0}>
                <section aria-label="Pending Codex requests" class="space-y-3">
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-sm font-medium text-foreground">Pending Codex requests</div>
                    <Tag variant="warning" tone="soft" size="sm">
                      {codex.pendingRequests().length}
                    </Tag>
                  </div>

                  <div class="space-y-3">
                    <For each={codex.pendingRequests()}>
                      {(request) => (
                        <Card class="border-border/60">
                          <CardHeader class="pb-3">
                            <div class="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div class="flex items-center gap-2">
                                  <CardTitle class="text-sm capitalize">
                                    {request.type.replaceAll('_', ' ')}
                                  </CardTitle>
                                  <Tag variant={requestTagVariant(request.type)} tone="soft" size="sm">
                                    {displayStatus(request.type, 'Request')}
                                  </Tag>
                                </div>
                                <CardDescription class="mt-1">
                                  {request.reason || 'Codex needs a response to continue this turn.'}
                                </CardDescription>
                              </div>
                              <Tag variant="neutral" tone="soft" size="sm">
                                Item: {request.item_id}
                              </Tag>
                            </div>
                          </CardHeader>

                          <CardContent class="space-y-3">
                            <Show when={request.command}>
                              <div class="rounded-lg border border-border/60 bg-muted/10 p-3 font-mono text-xs text-foreground">
                                <div class="mb-2 text-[11px] text-muted-foreground">
                                  {request.cwd || 'Working directory unavailable'}
                                </div>
                                {request.command}
                              </div>
                            </Show>

                            <Show when={request.permissions}>
                              <div class="rounded-lg border border-border/60 bg-muted/10 p-3 text-sm text-muted-foreground">
                                <div class="mb-2 font-medium text-foreground">Requested permissions</div>
                                <div class="space-y-2">
                                  <Show when={(request.permissions?.file_system_write?.length ?? 0) > 0}>
                                    <div>
                                      <div class="text-xs uppercase tracking-wide text-muted-foreground">Write</div>
                                      <div class="mt-1 font-mono text-xs text-foreground">
                                        {(request.permissions?.file_system_write ?? []).join(', ')}
                                      </div>
                                    </div>
                                  </Show>
                                  <Show when={(request.permissions?.file_system_read?.length ?? 0) > 0}>
                                    <div>
                                      <div class="text-xs uppercase tracking-wide text-muted-foreground">Read</div>
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
                                    <div class="rounded-lg border border-border/60 bg-muted/10 p-3">
                                      <div class="text-sm font-medium text-foreground">{question.header}</div>
                                      <div class="mt-1 text-sm text-muted-foreground">{question.question}</div>
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

              <section aria-label="Codex transcript" class="space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="text-sm font-medium text-foreground">Transcript</div>
                  <Tag variant="neutral" tone="soft" size="sm">
                    {codex.transcriptItems().length}
                  </Tag>
                </div>

                <Show
                  when={codex.transcriptItems().length > 0}
                  fallback={
                    <Card class="border-dashed border-border/60 bg-background/80">
                      <CardContent class="flex min-h-[18rem] flex-col items-center justify-center p-8 text-center">
                        <div class="flex h-16 w-16 items-center justify-center rounded-lg border border-border/60 bg-muted/20">
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
                            Independent from Flower state
                          </Tag>
                        </div>
                      </CardContent>
                    </Card>
                  }
                >
                  <div class="space-y-4">
                    <For each={codex.transcriptItems()}>
                      {(item) => (
                        <Card class="border-border/60">
                          <CardHeader class="pb-3">
                            <div class="flex items-start justify-between gap-3">
                              <div class="flex items-start gap-3">
                                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/20 text-foreground">
                                  {itemGlyph(item)}
                                </div>
                                <div>
                                  <div class="flex flex-wrap items-center gap-2">
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
                          <CardContent>{itemBody(item)}</CardContent>
                        </Card>
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            </div>

            <div class="flex flex-col gap-6">
              <Card class="border-border/60">
                <CardHeader>
                  <div class="flex items-start gap-3">
                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/20">
                      <Code class="h-4 w-4" />
                    </div>
                    <div>
                      <CardTitle class="text-sm">Codex composer</CardTitle>
                      <CardDescription class="mt-1">
                        Send implementation tasks here while keeping Codex routes, thread state, and approvals isolated from Flower.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>

                <CardContent class="space-y-4">
                  <div class="space-y-3">
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
                      <div class="mb-1 text-xs font-medium text-foreground">Prompt</div>
                      <Textarea
                        value={codex.composerText()}
                        onInput={(event) => codex.setComposerText(event.currentTarget.value)}
                        rows={8}
                        placeholder="Describe the change, bug, or task for Codex..."
                        class="min-h-[10rem] w-full"
                      />
                    </label>
                  </div>
                </CardContent>

                <CardFooter class="flex-col items-stretch gap-3 border-t border-border/60 pt-4">
                  <div class="text-xs leading-6 text-muted-foreground">
                    The dedicated sidebar owns thread navigation, so this page stays focused on transcript, approvals, and the next turn.
                  </div>
                  <Button
                    onClick={() => void codex.sendTurn()}
                    disabled={!String(codex.composerText() ?? '').trim() || codex.submitting()}
                  >
                    {codex.submitting() ? 'Sending...' : codex.activeThreadID() ? 'Send to Codex' : 'Create thread and send'}
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
                <Card class="border-border/60">
                  <CardHeader class="pb-3">
                    <CardTitle class="text-sm">Runtime flags</CardTitle>
                    <CardDescription>Codex-reported state flags for the active thread.</CardDescription>
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
