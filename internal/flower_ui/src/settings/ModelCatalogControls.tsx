import { Show } from 'solid-js';
import { Button, Input } from '@floegence/floe-webapp-core/ui';
import type { ModelCatalogCopy } from './modelCatalogCopy';

export function ModelCatalogControls(props: Readonly<{
  copy: ModelCatalogCopy; query: string; count: number; loading?: boolean; error?: string; disabled?: boolean;
  onQuery: (query: string) => void; onSelectAll: () => void; onClear: () => void; onRefresh?: () => void;
}>) {
  return <div class="space-y-2">
    <div class="flex flex-wrap items-center gap-2">
      <Input value={props.query} onInput={(event) => props.onQuery(event.currentTarget.value)} placeholder={props.copy.search} aria-label={props.copy.search} size="sm" class="min-w-40 flex-1" />
      <span class="text-xs tabular-nums text-muted-foreground" aria-live="polite">{props.copy.selected.replace('{count}', String(props.count))}</span>
      <Button size="sm" variant="outline" disabled={props.disabled || props.loading} onClick={props.onSelectAll}>{props.copy.selectAll}</Button>
      <Button size="sm" variant="ghost" disabled={props.disabled || props.loading || props.count === 0} onClick={props.onClear}>{props.copy.clearAll}</Button>
      <Show when={props.onRefresh}><Button size="sm" variant="outline" disabled={props.disabled || props.loading} onClick={() => props.onRefresh?.()}>{props.loading ? props.copy.loading : props.copy.refresh}</Button></Show>
    </div>
    <Show when={props.error}><p role="alert" class="text-sm text-destructive">{props.error}</p></Show>
  </div>;
}
