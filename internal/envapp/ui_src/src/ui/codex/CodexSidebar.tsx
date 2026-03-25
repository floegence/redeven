import { For, Show, createMemo } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Refresh } from '@floegence/floe-webapp-core/icons';
import { SidebarContent, SidebarItemList, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Tag } from '@floegence/floe-webapp-core/ui';

import { CodexIcon } from '../icons/CodexIcon';
import { useCodexContext } from './CodexProvider';
import { buildTranscriptSnapshot, displayStatus, formatUpdatedAt, statusTagVariant } from './presentation';

function SidebarMetric(props: {
  label: string;
  value: string;
  helper?: string;
  tag?: string;
}) {
  return (
    <div class="rounded-xl border border-border/60 bg-background/80 p-3">
      <div class="flex items-start justify-between gap-2">
        <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {props.label}
        </div>
        <Show when={props.tag}>
          <div class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {props.tag}
          </div>
        </Show>
      </div>
      <div class="mt-2 text-sm font-medium leading-6 text-foreground">{props.value}</div>
      <Show when={props.helper}>
        <div class="mt-1 text-xs leading-5 text-muted-foreground">{props.helper}</div>
      </Show>
    </div>
  );
}

export function CodexSidebar() {
  const codex = useCodexContext();

  const activeSnapshot = createMemo(() => buildTranscriptSnapshot(codex.transcriptItems()));
  const activeThreadPath = createMemo(() => {
    const thread = codex.activeThread();
    const candidates = [thread?.path, thread?.cwd, codex.workingDirDraft(), codex.status()?.agent_home_dir];
    for (const candidate of candidates) {
      const value = String(candidate ?? '').trim();
      if (value) return value;
    }
    return 'Set a workspace path in the Codex composer.';
  });
  const hostSummary = createMemo(() =>
    codex.status()?.binary_path || 'Redeven uses the host machine\'s `codex` binary directly as soon as it is available on PATH.'
  );

  return (
    <SidebarContent class="h-full min-h-full gap-4">
      <Card class="overflow-hidden border-border/60 bg-background/90">
        <CardHeader class="gap-4 border-b border-border/60 pb-4">
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 items-start gap-3">
              <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/25 shadow-sm">
                <CodexIcon class="h-5 w-5" />
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <CardTitle class="text-sm">Codex review navigator</CardTitle>
                  <Tag
                    variant={codex.hasHostBinary() ? 'success' : 'warning'}
                    tone="soft"
                    size="sm"
                  >
                    {codex.hasHostBinary() ? 'Host ready' : 'Install required'}
                  </Tag>
                </div>
                <CardDescription class="mt-1 leading-5">
                  Dedicated thread navigation and runtime context for host-native Codex reviews.
                </CardDescription>
              </div>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() => void codex.refreshSidebar()}
              disabled={codex.statusLoading()}
              aria-label="Refresh Codex sidebar"
            >
              <Refresh class="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent class="space-y-4 pt-4">
          <div class="grid gap-2">
            <SidebarMetric
              label="Runtime"
              value={codex.hasHostBinary() ? 'Host Codex detected' : 'Waiting for host install'}
              helper={hostSummary()}
              tag={codex.hasHostBinary() ? 'Connected' : 'Pending'}
            />
            <SidebarMetric
              label="Active workspace"
              value={activeThreadPath()}
              helper={codex.activeThread()?.model_provider || 'Host default model'}
              tag={codex.activeThreadID() ? 'Thread open' : 'Draft'}
            />
            <div class="grid grid-cols-3 gap-2">
              <SidebarMetric
                label="Threads"
                value={String(codex.threads().length)}
              />
              <SidebarMetric
                label="Pending"
                value={String(codex.pendingRequests().length)}
              />
              <SidebarMetric
                label="Artifacts"
                value={String(activeSnapshot().artifactCount)}
              />
            </div>
          </div>

          <Show when={codex.statusError()}>
            <div class="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
              {codex.statusError()}
            </div>
          </Show>

          <Button class="w-full" onClick={codex.startNewThreadDraft}>
            New review
          </Button>
        </CardContent>
      </Card>

      <SidebarSection
        title="Review threads"
        actions={
          <Tag variant="neutral" tone="soft" size="sm">
            {codex.threads().length}
          </Tag>
        }
      >
        <Show
          when={codex.threads().length > 0}
          fallback={
            <Card class="border-dashed border-border/60 bg-muted/10">
              <CardContent class="space-y-2 p-4">
                <div class="text-sm font-medium text-foreground">
                  {codex.hasHostBinary() ? 'No review threads yet' : 'Codex is not available yet'}
                </div>
                <div class="text-xs leading-5 text-muted-foreground">
                  {codex.hasHostBinary()
                    ? 'Start a dedicated Codex review here to keep its transcript, approvals, and artifacts independent from Flower.'
                    : 'Install `codex` on the host, refresh this panel, and the dedicated Codex review workflow will be ready to use.'}
                </div>
              </CardContent>
            </Card>
          }
        >
          <SidebarItemList class="space-y-2">
            <For each={codex.threads()}>
              {(thread) => {
                const active = () => codex.activeThreadID() === thread.id;
                const workspaceLabel = () => String(thread.path ?? thread.cwd ?? '').trim() || 'Workspace not reported';
                return (
                  <Card
                    class={cn(
                      'overflow-hidden border-border/60 bg-background/80 transition-all',
                      active() && 'border-primary/35 bg-primary/[0.05] shadow-sm'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => codex.selectThread(thread.id)}
                      aria-pressed={active()}
                      class={cn(
                        'w-full cursor-pointer rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
                        active() && 'ring-1 ring-primary/20'
                      )}
                    >
                      <CardContent class="space-y-3 p-4">
                        <div class="flex items-start justify-between gap-3">
                          <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-2">
                              <div class="truncate text-sm font-semibold text-foreground">
                                {String(thread.name ?? thread.preview ?? '').trim() || 'Untitled thread'}
                              </div>
                              <Show when={active()}>
                                <Tag variant="info" tone="soft" size="sm">
                                  Active
                                </Tag>
                              </Show>
                            </div>
                            <div class="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {thread.preview || 'No review summary yet.'}
                            </div>
                          </div>
                          <Tag variant={statusTagVariant(thread.status)} tone="soft" size="sm">
                            {displayStatus(thread.status)}
                          </Tag>
                        </div>

                        <div class="grid gap-2 text-[11px] leading-5 text-muted-foreground">
                          <div class="rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
                            <div class="uppercase tracking-[0.16em]">Workspace</div>
                            <div class="mt-1 truncate font-mono text-foreground" title={workspaceLabel()}>
                              {workspaceLabel()}
                            </div>
                          </div>
                          <div class="flex items-center justify-between gap-3">
                            <span class="truncate">{thread.model_provider || 'Host default model'}</span>
                            <span>{formatUpdatedAt(thread.updated_at_unix_s)}</span>
                          </div>
                        </div>
                      </CardContent>
                    </button>
                  </Card>
                );
              }}
            </For>
          </SidebarItemList>
        </Show>
      </SidebarSection>
    </SidebarContent>
  );
}
