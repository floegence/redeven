import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../../i18n';
import { fetchLocalApiJSON } from '../../services/localApi';
import { CopyButton } from './SettingsPrimitives';

type StorageEntry = Readonly<{ id: string; path: string; kind: string; backup: string; bytes: number; complete: boolean; present: boolean }>;
export function StorageSettings(props: { canAdmin: boolean; scope: string; openFlower: () => void; openTooling: () => void }) {
  const i18n = useI18n();
  const [entries, setEntries] = createSignal<readonly StorageEntry[] | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let epoch = 0;
  let abort: AbortController | undefined;
  createEffect(() => { void props.scope; void props.canAdmin; epoch++; abort?.abort(); setEntries(null); setLoading(false); setFailed(false); });
  onCleanup(() => { epoch++; abort?.abort(); });
  const load = async () => {
    if (!props.canAdmin || loading()) return;
    const current = epoch;
    abort = new AbortController();
    setLoading(true); setFailed(false);
    try {
      const result = await fetchLocalApiJSON<{ entries: StorageEntry[] }>('/_redeven_proxy/api/storage', { method: 'GET', signal: abort.signal });
      if (current === epoch) setEntries(result.entries);
    } catch { if (current === epoch) setFailed(true); }
    finally { if (current === epoch) setLoading(false); }
  };
  const label = (group: 'owners' | 'kinds' | 'backups', key: string) => i18n.t(`storage.${group}.${key}` as Parameters<typeof i18n.t>[0]);
  const size = (entry: StorageEntry) => `${entry.complete ? '' : '≥ '}${new Intl.NumberFormat(i18n.locale(), { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(entry.bytes / 1_000_000)}`;
  return (
    <section class="min-w-0 space-y-3" aria-label={i18n.t('storage.title')}>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 class="text-sm font-semibold">{i18n.t('storage.title')}</h3>
        <Button size="sm" variant="outline" disabled={!props.canAdmin || loading()} aria-busy={loading()} onClick={() => void load()}>{i18n.t(loading() ? 'storage.loading' : 'storage.inspect')}</Button>
      </div>
      <p class="text-xs leading-relaxed text-muted-foreground">{i18n.t('storage.scope')}</p>
      <Show when={!props.canAdmin}><p class="text-xs text-muted-foreground">{i18n.t('aiReadiness.storage.adminOnly')}</p></Show>
      <Show when={failed()}><p role="alert" class="text-xs text-destructive">{i18n.t('storage.failed')}</p></Show>
      <Show when={entries()}>{items => <ul class="divide-y divide-border rounded-lg border border-border">
        <For each={items()}>{entry => <li class="min-w-0 space-y-2 p-3">
          <div class="flex flex-wrap justify-between gap-2 text-xs"><span class="font-medium">{label('owners', entry.id)}</span><span class="text-muted-foreground">{entry.present ? size(entry) : i18n.t(entry.complete ? 'storage.absent' : 'storage.unavailable')}</span></div>
          <div class="flex min-w-0 items-start gap-2"><code class="min-w-0 flex-1 break-all text-[11px] text-muted-foreground">{entry.path}</code><CopyButton value={entry.path} /></div>
          <p class="text-[11px] text-muted-foreground">{label('kinds', entry.kind)} · {label('backups', entry.backup)}</p>
          <Show when={!entry.complete}><p class="text-[11px] text-warning">{i18n.t('storage.partial')}</p></Show>
        </li>}</For>
      </ul>}</Show>
      <div class="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={props.openFlower}>{i18n.t('storage.flower')}</Button>
        <Button size="sm" variant="outline" onClick={props.openTooling}>{i18n.t('storage.tooling')}</Button>
      </div>
      <p class="text-xs leading-relaxed text-muted-foreground">{i18n.t('storage.cleanup')}</p>
    </section>
  );
}
