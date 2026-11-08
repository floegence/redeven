import { For, Show, createMemo, createSignal, onMount, onCleanup, type JSX } from 'solid-js';
import { Button, Input } from '@floegence/floe-webapp-core/ui';
import { ArrowLeft, ArrowRight, History, Layers, Plus, Refresh, Search } from '@floegence/floe-webapp-core/icons';
import { useI18n } from '../i18n';
import { listPluginDrafts, type PluginDraft } from './pluginCreationApi';
import './plugin-creation-workspace.css';
import './plugin-creation-history.css';

export function PluginDraftLibrary(props: { onOpen: (id: string) => void; onBack: () => void }): JSX.Element {
  const i18n = useI18n();
  const [drafts, setDrafts] = createSignal<readonly PluginDraft[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [failed, setFailed] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const title = (draft: PluginDraft) => draft.title.trim() || i18n.t('uiCopy.plugin.creation.untitled');
  const visibleDrafts = createMemo(() => {
    const search = query().trim().toLocaleLowerCase(i18n.locale());
    return drafts().filter(draft => draft.lifecycle !== 'deleted' && title(draft).toLocaleLowerCase(i18n.locale()).includes(search))
      .sort((left, right) => right.updated_at - left.updated_at || left.id.localeCompare(right.id));
  });
  const hasHistory = () => drafts().some(draft => draft.lifecycle !== 'deleted');
  let searchRef: HTMLInputElement | undefined;
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
  onCleanup(() => { disposed = true; });
  return (
    <section class="redeven-plugin-creation-page plugin-creation-history" data-plugin-draft-library>
      <header class="plugin-creation-toolbar" data-redeven-desktop-titlebar-drag-region="true">
        <Button variant="ghost" size="icon" class="h-11 w-11 shrink-0 sm:h-8 sm:w-8" onClick={props.onBack} aria-label={i18n.t('uiCopy.plugin.backToCenter')}>
          <ArrowLeft class="h-4 w-4" />
        </Button>
        <h1 class="min-w-0 flex-1 truncate text-[13px] font-medium" title={i18n.t('uiCopy.plugin.creation.drafts')}>{i18n.t('uiCopy.plugin.creation.drafts')}</h1>
        <Button variant="ghost" size="icon" class="h-11 w-11 shrink-0 sm:h-8 sm:w-8" disabled={loading()} onClick={() => void refetch()} aria-label={i18n.t('common.actions.refresh')}>
          <Refresh class="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" class="plugin-history-create shrink-0" onClick={() => props.onOpen('new')} aria-label={i18n.t('uiCopy.plugin.creationTitle')} title={i18n.t('uiCopy.plugin.creationTitle')}>
          <Plus class="h-3.5 w-3.5" /><span>{i18n.t('uiCopy.plugin.creationTitle')}</span>
        </Button>
      </header>
      <div class="plugin-history-scroll">
        <div class="plugin-history-content">
          <Show when={hasHistory()}>
            <div class="plugin-history-tools">
              <span class="plugin-history-order"><History class="h-3.5 w-3.5" aria-hidden="true" />{i18n.t('uiCopy.plugin.creation.recentlyEdited')}</span>
              <Input ref={searchRef} type="search" value={query()} onInput={event => setQuery(event.currentTarget.value)}
                aria-label={i18n.t('uiCopy.plugin.creation.searchHistory')} placeholder={i18n.t('uiCopy.plugin.creation.searchHistory')}
                leftIcon={<Search class="h-3.5 w-3.5" />} class="plugin-history-search" />
            </div>
          </Show>
          <Show when={failed()}>
            <div class="plugin-history-error" role="alert">
              <p>{i18n.t('uiCopy.plugin.creation.draftsLoadFailed')}</p>
              <Button variant="ghost" size="sm" onClick={() => void refetch()}>{i18n.t('common.actions.retry')}</Button>
            </div>
          </Show>
          <Show when={loading()}>
            <span role="status" class="sr-only">{i18n.t('common.status.loading')}</span>
            <Show when={!hasHistory()}>
              <div class="plugin-history-skeleton" aria-hidden="true"><For each={[1, 2, 3]}>{() => <div class="flex h-20 items-center gap-3 px-3 py-4"><span class="h-9 w-9 rounded-lg bg-muted" /><span class="flex w-2/3 max-w-56 flex-col gap-2.5"><span class="h-2.5 rounded bg-muted" /><span class="h-2 w-2/3 rounded bg-muted" /></span></div>}</For></div>
            </Show>
          </Show>
          <Show when={hasHistory()}>
            <ul class="plugin-history-list" aria-label={i18n.t('uiCopy.plugin.creation.drafts')} aria-busy={loading()}>
              <For each={visibleDrafts()}>{draft => (
                <li>
                  <button type="button" class="plugin-history-entry" data-plugin-history-entry={draft.id} onClick={() => props.onOpen(draft.id)}>
                    <span class="plugin-history-mark" aria-hidden="true"><Layers class="h-[18px] w-[18px]" /></span>
                    <span class="plugin-history-identity">
                      <span class="plugin-history-title" title={title(draft)} dir="auto">{title(draft)}</span>
                      <time class="plugin-history-time" dateTime={new Date(draft.updated_at).toISOString()}>
                        {i18n.formatDateTime(draft.updated_at, { dateStyle: 'medium', timeStyle: 'short' })}
                      </time>
                    </span>
                    <span class="plugin-history-action"><span>{draft.lifecycle === 'deleting' ? i18n.t('uiCopy.plugin.creation.deleting') : i18n.t('uiCopy.plugin.creation.continue')}</span><ArrowRight class="h-3.5 w-3.5 shrink-0" aria-hidden="true" /></span>
                  </button>
                </li>
              )}</For>
            </ul>
          </Show>
          <Show when={!loading() && !failed() && visibleDrafts().length === 0}>
            <div class="plugin-history-empty" role="status">
              <span class="plugin-history-empty-mark" aria-hidden="true"><Show when={hasHistory()} fallback={<History class="h-5 w-5" />}><Search class="h-5 w-5" /></Show></span>
              <p>{hasHistory() ? i18n.t('uiCopy.plugin.creation.noMatchingHistory') : i18n.t('uiCopy.plugin.creation.noDrafts')}</p>
              <Show when={hasHistory()} fallback={<Button variant="secondary" size="sm" onClick={() => props.onOpen('new')}><Plus class="h-3.5 w-3.5" />{i18n.t('uiCopy.plugin.creationTitle')}</Button>}>
                <Button variant="ghost" size="sm" onClick={() => { setQuery(''); searchRef?.focus(); }}>{i18n.t('uiCopy.plugin.creation.clearSearch')}</Button>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </section>
  );
}
