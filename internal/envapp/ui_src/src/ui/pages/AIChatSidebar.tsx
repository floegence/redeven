import { For, Show, createSignal } from 'solid-js';
import { MessageSquare, Plus, Trash } from '@floegence/floe-webapp-core/icons';
import { useNotification } from '@floegence/floe-webapp-core';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { SidebarContent, SidebarSection, SidebarItem, SidebarItemList } from '@floegence/floe-webapp-core/layout';
import { Button, ConfirmDialog, Tooltip } from '@floegence/floe-webapp-core/ui';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useAIChatContext } from './AIChatContext';
import { fetchGatewayJSON } from '../services/gatewayApi';

// Format a unix-ms timestamp as a relative time string.
function fmtRelativeTime(ms: number): string {
  if (!ms) return 'Never';
  try {
    const now = Date.now();
    const diff = now - ms;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  } catch {
    return String(ms);
  }
}

/**
 * AI chat thread list rendered in Shell's native sidebar.
 * Uses standard floe-webapp SidebarContent / SidebarSection / SidebarItem.
 */
export function AIChatSidebar() {
  const ctx = useAIChatContext();
  const protocol = useProtocol();
  const notify = useNotification();

  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleteThreadId, setDeleteThreadId] = createSignal<string | null>(null);
  const [deleteThreadTitle, setDeleteThreadTitle] = createSignal('');
  const [deleting, setDeleting] = createSignal(false);

  const openDelete = (threadId: string, title: string) => {
    setDeleteThreadId(threadId);
    setDeleteThreadTitle(String(title ?? '').trim() || 'New chat');
    setDeleteOpen(true);
  };

  const doDelete = async () => {
    const tid = deleteThreadId();
    if (!tid) return;

    setDeleting(true);
    try {
      await fetchGatewayJSON<void>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}`, { method: 'DELETE' });
      setDeleteOpen(false);
      setDeleteThreadId(null);

      if (tid === ctx.activeThreadId()) {
        ctx.clearActiveThreadPersistence();
        ctx.enterDraftChat();
      }

      ctx.bumpThreadsSeq();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to delete chat', msg || 'Request failed.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SidebarContent>
      <SidebarSection
        title="AI Chats"
        actions={
          <Tooltip content="New chat" placement="bottom" delay={0}>
            <Button
              size="icon"
              variant="ghost"
              icon={Plus}
              onClick={() => ctx.enterDraftChat()}
              disabled={protocol.status() !== 'connected'}
              class="w-6 h-6"
              aria-label="New chat"
            />
          </Tooltip>
        }
      >
        <Show
          when={!ctx.threads.loading}
          fallback={
            <div class="px-2.5 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <SnakeLoader size="sm" />
              <span>Loading chats...</span>
            </div>
          }
        >
          <Show
            when={!ctx.threads.error}
            fallback={
              <div class="px-2.5 py-2 text-xs text-error">
                {ctx.threads.error instanceof Error ? ctx.threads.error.message : String(ctx.threads.error)}
              </div>
            }
          >
            <Show
              when={(ctx.threads()?.threads?.length ?? 0) > 0}
              fallback={
                <div class="px-2.5 py-4 text-xs text-muted-foreground text-center">
                  <MessageSquare class="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                  <div>No chats yet</div>
                  <div class="mt-1 text-[11px]">Start a new conversation</div>
                </div>
              }
            >
              <SidebarItemList>
                <For each={ctx.threads()?.threads ?? []}>
                  {(t) => (
                    <SidebarItem
                      icon={<MessageSquare class="w-4 h-4" />}
                      active={t.thread_id === ctx.activeThreadId()}
                      onClick={() => ctx.selectThreadId(t.thread_id)}
                    >
                      <div class="flex flex-col gap-0.5 min-w-0 w-full">
                        <div class="flex items-center justify-between gap-2">
                          <span class="truncate">{t.title?.trim() || 'New chat'}</span>
                          <div class="flex items-center gap-1.5 shrink-0">
                            <span class="text-[10px] text-muted-foreground">{fmtRelativeTime(t.updated_at_unix_ms)}</span>
                            <Tooltip content="Delete chat" placement="bottom" delay={0}>
                              <Button
                                size="icon"
                                variant="ghost"
                                icon={Trash}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDelete(t.thread_id, t.title);
                                }}
                                disabled={protocol.status() !== 'connected' || (t.thread_id === ctx.activeThreadId() && ctx.running())}
                                class="w-6 h-6 text-muted-foreground hover:text-error hover:bg-error/10"
                                aria-label="Delete chat"
                              />
                            </Tooltip>
                          </div>
                        </div>
                        <Show when={!!t.last_message_preview?.trim()}>
                          <span class="text-[11px] text-muted-foreground/70 truncate">{t.last_message_preview}</span>
                        </Show>
                      </div>
                    </SidebarItem>
                  )}
                </For>
              </SidebarItemList>
            </Show>
          </Show>
        </Show>
      </SidebarSection>

      <ConfirmDialog
        open={deleteOpen()}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteOpen(false);
            setDeleteThreadId(null);
            setDeleteThreadTitle('');
            return;
          }
          setDeleteOpen(true);
        }}
        title="Delete Chat"
        confirmText="Delete"
        variant="destructive"
        loading={deleting()}
        onConfirm={() => void doDelete()}
      >
        <div class="space-y-2">
          <p class="text-sm">
            Delete <span class="font-semibold">"{deleteThreadTitle()}"</span>?
          </p>
          <p class="text-xs text-muted-foreground">This cannot be undone.</p>
        </div>
      </ConfirmDialog>
    </SidebarContent>
  );
}
