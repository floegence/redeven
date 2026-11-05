import { For, Show, createSignal, onMount, onCleanup, type JSX } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { ArrowLeft, Plus, Refresh } from '@floegence/floe-webapp-core/icons';
import { useI18n } from '../i18n';
import { listPluginDrafts, type PluginDraft } from './pluginCreationApi';
export function PluginDraftLibrary(props: { onOpen: (id: string) => void; onBack: () => void }): JSX.Element {
  const i18n = useI18n();
  const [drafts, setDrafts] = createSignal<readonly PluginDraft[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [failed, setFailed] = createSignal(false);
  let disposed = false;
  let reading = false;
  const refetch = async () => {
    if (reading) return;
    reading = true;
    setLoading(true);
    setFailed(false);
    try {
      const values = await listPluginDrafts();
      if (!disposed) setDrafts(values);
    } catch {
      if (!disposed) setFailed(true);
    } finally {
      reading = false;
      if (!disposed) setLoading(false);
    }
  };
  onMount(() => void refetch());
  onCleanup(() => {
    disposed = true;
  });
  return (
    <section class="flex h-full min-h-0 flex-col" data-plugin-draft-library>
      <header class="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button
          variant="ghost"
          size="icon"
          class="h-11 w-11 sm:h-8 sm:w-8"
          onClick={props.onBack}
          aria-label={i18n.t('uiCopy.plugin.backToCenter')}
        >
          <ArrowLeft class="h-4 w-4" />
        </Button>
        <h1 class="flex-1 text-[13px] font-medium">{i18n.t('uiCopy.plugin.creation.drafts')}</h1>
        <Button
          variant="ghost"
          size="icon"
          class="h-11 w-11 sm:h-8 sm:w-8"
          disabled={loading()}
          onClick={() => void refetch()}
          aria-label={i18n.t('common.actions.refresh')}
        >
          <Refresh class="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" class="min-h-11 sm:min-h-8" onClick={() => props.onOpen('new')}>
          <Plus class="h-3.5 w-3.5" />
          {i18n.t('uiCopy.plugin.creationTitle')}
        </Button>
      </header>
      <div class="min-h-0 flex-1 overflow-auto p-3">
        <Show when={failed()}>
          <p role="alert" class="text-xs text-destructive">
            {i18n.t('uiCopy.plugin.creation.draftsLoadFailed')}
          </p>
        </Show>
        <Show when={loading()}>
          <p role="status" class="text-xs text-muted-foreground">
            {i18n.t('common.status.loading')}
          </p>
        </Show>
        <Show when={!loading() && !failed() && drafts()?.length === 0}>
          <p class="py-12 text-center text-xs text-muted-foreground">{i18n.t('uiCopy.plugin.creation.noDrafts')}</p>
        </Show>
        <div class="mx-auto flex max-w-4xl flex-col divide-y">
          <For each={drafts()}>
            {(draft) => (
              <button
                class="flex min-h-16 w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => props.onOpen(draft.id)}
              >
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[13px] font-medium">
                    {draft.title || i18n.t('uiCopy.plugin.creation.untitled')}
                  </span>
                  <time class="mt-1 block text-[11px] text-muted-foreground">
                    {new Intl.DateTimeFormat(i18n.locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
                      draft.updated_at,
                    )}
                  </time>
                </span>
                <span class="text-xs text-muted-foreground">
                  {draft.lifecycle === 'deleting'
                    ? i18n.t('uiCopy.plugin.creation.deleting')
                    : i18n.t('uiCopy.plugin.creation.continue')}
                </span>
              </button>
            )}
          </For>
        </div>
      </div>
    </section>
  );
}
