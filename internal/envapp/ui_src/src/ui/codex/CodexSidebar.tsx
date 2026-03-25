import { For, Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Refresh } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';

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

export function CodexSidebar() {
  const codex = useCodexContext();

  return (
    <div class="flex h-full min-h-0 flex-col bg-background/95">
      <div class="border-b border-border/70 px-4 py-4">
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 items-start gap-3">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <CodexIcon class="h-5 w-5" />
            </div>
            <div class="min-w-0">
              <div class="text-sm font-semibold text-foreground">Codex</div>
              <div class="mt-1 text-xs leading-5 text-muted-foreground">Host-managed sessions with a dedicated gateway surface.</div>
            </div>
          </div>

          <Button size="sm" variant="outline" onClick={() => void codex.refreshSidebar()} disabled={codex.statusLoading()}>
            <Refresh class="h-4 w-4" />
          </Button>
        </div>

        <div class="mt-4 grid gap-2">
          <div class="rounded-2xl border border-border/70 bg-muted/15 p-3">
            <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Host runtime</div>
            <div class="mt-2 text-sm font-medium text-foreground">
              {codex.hasHostBinary() ? 'Codex detected on PATH' : 'Install Codex on the host'}
            </div>
            <div class="mt-1 text-xs leading-5 text-muted-foreground">
              {codex.status()?.binary_path || 'Redeven will use the host machine\'s `codex` binary as soon as it is available on PATH.'}
            </div>
          </div>

          <div class="rounded-2xl border border-border/70 bg-background p-3">
            <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Workspace root</div>
            <div class="mt-2 truncate font-mono text-xs text-foreground">
              {codex.workingDirDraft() || codex.status()?.agent_home_dir || 'Use the composer below to set a workspace path.'}
            </div>
          </div>
        </div>

        <Show when={codex.statusError()}>
          <div class="mt-4 rounded-2xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
            {codex.statusError()}
          </div>
        </Show>

        <Button size="sm" class="mt-4 w-full" onClick={codex.startNewThreadDraft}>
          New thread
        </Button>
      </div>

      <div class="min-h-0 flex-1 overflow-auto px-3 py-3">
        <div class="mb-3 flex items-center justify-between gap-3 px-1">
          <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Threads</div>
          <div class="text-[11px] text-muted-foreground">{codex.threads().length}</div>
        </div>

        <Show
          when={codex.threads().length > 0}
          fallback={
            <div class="rounded-2xl border border-dashed border-border/80 bg-muted/15 p-4 text-sm leading-6 text-muted-foreground">
              {codex.hasHostBinary()
                ? 'Create a thread to keep Codex work separated from Flower while staying inside the same env shell.'
                : 'Install `codex` on the host, refresh this panel, then create the first Codex thread here.'}
            </div>
          }
        >
          <div class="space-y-2">
            <For each={codex.threads()}>
              {(thread) => {
                const active = () => codex.activeThreadID() === thread.id;
                return (
                  <button
                    type="button"
                    onClick={() => codex.selectThread(thread.id)}
                    class={cn(
                      'w-full rounded-2xl border px-3 py-3 text-left transition-colors',
                      active()
                        ? 'border-primary/35 bg-primary/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]'
                        : 'border-border/70 bg-background hover:border-primary/25 hover:bg-muted/20'
                    )}
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="truncate text-sm font-semibold text-foreground">
                          {String(thread.name ?? thread.preview ?? '').trim() || 'Untitled thread'}
                        </div>
                        <div class="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {thread.preview || thread.cwd || 'No thread preview yet.'}
                        </div>
                      </div>

                      <div class="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {thread.status}
                      </div>
                    </div>

                    <div class="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                      <span class="truncate">{thread.model_provider || 'default model'}</span>
                      <span>{formatUpdatedAt(thread.updated_at_unix_s)}</span>
                    </div>
                  </button>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
