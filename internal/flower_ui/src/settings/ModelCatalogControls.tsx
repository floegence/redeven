import { FeedbackIndicator, StableText, Button, Input } from '@floegence/floe-webapp-core/ui';
import { Show } from 'solid-js';
import type { ModelCatalogCopy } from './modelCatalogCopy';

export function ModelCatalogControls(props: Readonly<{
  copy: ModelCatalogCopy; query: string; count: number; hasContent: boolean; loading?: boolean; error?: string; disabled?: boolean;
  onQuery: (query: string) => void; onSelectAll: () => void; onClear: () => void; onRefresh?: () => void;
}>) {
  let search: HTMLInputElement | undefined;
  return <div>
    <div class="flex flex-wrap items-center gap-2">
      <Input ref={search} value={props.query} onInput={(event) => props.onQuery(event.currentTarget.value)} placeholder={props.copy.search} aria-label={props.copy.search} size="sm" class="min-w-40 flex-1" />
      <FeedbackIndicator label={props.copy.refresh} closeLabel={props.copy.feedbackClose} restoreFocus={() => search} entries={props.hasContent && props.error ? [{ id: 'catalog', severity: 'error', summary: props.error, actions: <Show when={props.onRefresh}><Button size="sm" variant="outline" disabled={props.disabled || props.loading} onClick={props.onRefresh}>{props.copy.refresh}</Button></Show> }] : []} />
      <span class="text-xs tabular-nums text-muted-foreground" aria-live="polite">{props.copy.selected.replace('{count}', String(props.count))}</span>
      <Button size="sm" variant="outline" disabled={props.disabled || props.loading} onClick={props.onSelectAll}>{props.copy.selectAll}</Button>
      <Button size="sm" variant="ghost" disabled={props.disabled || props.loading || props.count === 0} onClick={props.onClear}>{props.copy.clearAll}</Button>
      <Show when={props.onRefresh}><Button size="sm" variant="outline" disabled={props.disabled || props.loading} loading={props.loading} onClick={() => props.onRefresh?.()}><StableText reserve={[props.copy.loading, props.copy.refresh]}>{props.loading ? props.copy.loading : props.copy.refresh}</StableText></Button></Show>
    </div>
    <Show when={!props.hasContent && props.error}><p role="alert" class="mt-2 flower-body-copy text-destructive">{props.error}</p></Show>
  </div>;
}
