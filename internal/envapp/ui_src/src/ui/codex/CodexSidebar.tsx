import { For, Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Refresh } from '@floegence/floe-webapp-core/icons';
import { SidebarContent, SidebarItemList, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Tag, type TagProps } from '@floegence/floe-webapp-core/ui';

import { CodexIcon } from '../icons/CodexIcon';
import { useCodexContext } from './CodexProvider';

function formatUpdatedAt(unixSeconds: number): string {
  const value = Number(unixSeconds ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  try {
    return new Date(value * 1000).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function statusTagVariant(status: string): TagProps['variant'] {
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

function displayStatus(status: string): string {
  const value = String(status ?? '').trim();
  if (!value) return 'Idle';
  return value.replaceAll('_', ' ');
}

export function CodexSidebar() {
  const codex = useCodexContext();

  return (
    <SidebarContent class="h-full min-h-full">
      <Card class="border-border/60">
        <CardHeader class="pb-3">
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 items-start gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/20">
                <CodexIcon class="h-5 w-5" />
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <CardTitle class="text-sm">Codex</CardTitle>
                  <Tag
                    variant={codex.hasHostBinary() ? 'success' : 'warning'}
                    tone="soft"
                    size="sm"
                  >
                    {codex.hasHostBinary() ? 'Host ready' : 'Install required'}
                  </Tag>
                </div>
                <CardDescription class="mt-1 leading-5">
                  Host-managed sessions routed through the dedicated Codex gateway.
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

        <CardContent class="space-y-3">
          <div class="grid gap-2">
            <div class="rounded-lg border border-border/60 bg-muted/10 p-3">
              <div class="flex items-center justify-between gap-2">
                <div class="text-xs font-medium text-foreground">Runtime</div>
                <Tag
                  variant={codex.hasHostBinary() ? 'success' : 'warning'}
                  tone="soft"
                  size="sm"
                >
                  {codex.hasHostBinary() ? 'Detected' : 'Waiting'}
                </Tag>
              </div>
              <div class="mt-2 text-xs leading-5 text-muted-foreground">
                {codex.status()?.binary_path || 'Redeven uses the host machine\'s `codex` binary directly as soon as it is available on PATH.'}
              </div>
            </div>

            <div class="rounded-lg border border-border/60 bg-muted/10 p-3">
              <div class="text-xs font-medium text-foreground">Workspace root</div>
              <div class="mt-2 truncate font-mono text-xs leading-5 text-muted-foreground">
                {codex.workingDirDraft() || codex.status()?.agent_home_dir || 'Set a workspace path from the Codex composer.'}
              </div>
            </div>
          </div>

          <Show when={codex.statusError()}>
            <div class="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
              {codex.statusError()}
            </div>
          </Show>

          <Button class="w-full" onClick={codex.startNewThreadDraft}>
            New thread
          </Button>
        </CardContent>
      </Card>

      <SidebarSection
        title="Threads"
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
                  {codex.hasHostBinary() ? 'No threads yet' : 'Codex is not available yet'}
                </div>
                <div class="text-xs leading-5 text-muted-foreground">
                  {codex.hasHostBinary()
                    ? 'Create a Codex thread here to keep its workstream and approvals separate from Flower.'
                    : 'Install `codex` on the host, refresh this panel, and the dedicated Codex workflow will be ready to use.'}
                </div>
              </CardContent>
            </Card>
          }
        >
          <SidebarItemList class="space-y-2">
            <For each={codex.threads()}>
              {(thread) => {
                const active = () => codex.activeThreadID() === thread.id;
                return (
                  <Card
                    class={cn(
                      'border-border/60 transition-colors',
                      active() && 'border-primary/35 bg-primary/[0.04] shadow-sm'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => codex.selectThread(thread.id)}
                      aria-pressed={active()}
                      class={cn(
                        'w-full rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
                        active() && 'ring-1 ring-primary/20'
                      )}
                    >
                      <CardContent class="space-y-3 p-3">
                        <div class="flex items-start justify-between gap-3">
                          <div class="min-w-0">
                            <div class="truncate text-sm font-medium text-foreground">
                              {String(thread.name ?? thread.preview ?? '').trim() || 'Untitled thread'}
                            </div>
                            <div class="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {thread.preview || thread.cwd || 'No thread preview yet.'}
                            </div>
                          </div>
                          <Tag variant={statusTagVariant(thread.status)} tone="soft" size="sm">
                            {displayStatus(thread.status)}
                          </Tag>
                        </div>

                        <div class="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                          <span class="truncate">{thread.model_provider || 'Host default model'}</span>
                          <span>{formatUpdatedAt(thread.updated_at_unix_s)}</span>
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
