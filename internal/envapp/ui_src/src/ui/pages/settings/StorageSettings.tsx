import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { ChevronRight, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { useI18n } from '../../i18n';
import { fetchLocalApiJSON } from '../../services/localApi';
import { CopyButton, SettingsSection } from './SettingsPrimitives';
import { formatStorageBytes, orderStorageEntries, storageDestination, type StorageDestination, type StorageEntry } from './storageOverview';
import './storage-overview.css';

export function StorageSettings(props: { canAdmin: boolean; active: boolean; scope: string; onManage: (destination: StorageDestination) => void }) {
  const i18n = useI18n();
  const [entries, setEntries] = createSignal<readonly StorageEntry[] | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let epoch = 0;
  let abort: AbortController | undefined;
  let attempted = false;
  const allowed = () => props.canAdmin && props.active;
  const load = async () => {
    if (!allowed() || loading()) return;
    const current = epoch;
    attempted = true;
    abort = new AbortController();
    setLoading(true); setFailed(false);
    try {
      const result = await fetchLocalApiJSON<{ entries: StorageEntry[] }>('/_redeven_proxy/api/storage', { method: 'GET', signal: abort.signal });
      if (current === epoch && allowed()) setEntries(result.entries);
    } catch { if (current === epoch && allowed()) setFailed(true); }
    finally { if (current === epoch) setLoading(false); }
  };
  // IMPORTANT: Retained pages are not read authority. Scope/access loss clears
  // sensitive paths; hiding aborts in-flight work and cannot publish a late reply.
  createEffect(() => {
    void props.scope; void props.canAdmin;
    epoch++; abort?.abort(); attempted = false;
    setEntries(null); setLoading(false); setFailed(false);
  });
  createEffect(() => {
    void props.scope;
    if (!props.active) {
      epoch++; abort?.abort(); attempted = false;
      setLoading(false);
      return;
    }
    if (props.canAdmin) untrack(() => { if (!attempted) void load(); });
  });
  onCleanup(() => { epoch++; abort?.abort(); });
  const ordered = createMemo(() => orderStorageEntries(entries() ?? []));
  const observed = createMemo(() => ordered().filter(entry => entry.present || !entry.complete));
  const absent = createMemo(() => ordered().filter(entry => !entry.present && entry.complete));
  const max = createMemo(() => Math.max(1, ...observed().map(entry => entry.bytes)));
  const partial = createMemo(() => ordered().some(entry => !entry.complete));
  const label = (group: 'owners' | 'kinds' | 'backups', key: string) => i18n.t(`storage.${group}.${key}` as Parameters<typeof i18n.t>[0]);
  const size = (entry: StorageEntry) => !entry.present ? i18n.t(entry.complete ? 'storage.absent' : 'storage.unavailable')
    : `${entry.complete ? '' : '≥ '}${formatStorageBytes(entry.bytes, i18n.locale())}`;
  const manage = (entry: StorageEntry) => {
    const destination = storageDestination(entry);
    if (allowed() && destination) props.onManage(destination);
  };
  const UsageRow = (row: { entry: StorageEntry }) => <li class="storage-usage-row">
    <Show when={storageDestination(row.entry)} fallback={<div class="storage-usage-main"><span>{label('owners', row.entry.id)}</span><span class="storage-usage-size">{size(row.entry)}</span><span /></div>}>
      <button type="button" class="storage-usage-main storage-usage-link" disabled={!allowed()} onClick={() => manage(row.entry)} aria-label={i18n.t('storage.manageOwner', { owner: label('owners', row.entry.id) })}>
        <span>{label('owners', row.entry.id)}</span><span class="storage-usage-size">{size(row.entry)}</span><ChevronRight aria-hidden="true" />
      </button>
    </Show>
    <Show when={row.entry.present && row.entry.bytes > 0}><div class="storage-usage-track" aria-hidden="true"><span style={{ width: `${row.entry.bytes / max() * 100}%` }} /></div></Show>
  </li>;
  return <SettingsSection variant="page" title={i18n.t('storage.title')}>
    <div class="storage-overview" aria-busy={loading()}>
      <div class="storage-overview-heading"><div><h2>{i18n.t('storage.usage')}</h2><p>{i18n.t('storage.measuredScope')}</p></div>
        <Button size="icon" variant="ghost" icon={RefreshIcon} disabled={!allowed() || loading()} aria-label={i18n.t('storage.inspect')} onClick={() => void load()} />
      </div>
      <Show when={!props.canAdmin}><p class="storage-overview-note">{i18n.t('aiReadiness.storage.adminOnly')}</p></Show>
      <Show when={loading() && !entries()}><p role="status" class="storage-overview-note">{i18n.t('storage.loading')}</p></Show>
      <Show when={failed()}><p role="alert" class="text-xs text-destructive">{i18n.t('storage.failed')}</p></Show>
      <Show when={entries()}>
        {/* IMPORTANT: Bars compare observed locations, never disk capacity. No
            global total, completeness or backup-success claim follows from a scan. */}
        <Show when={partial()}><p class="storage-overview-note">{i18n.t('storage.partial')}</p></Show>
        <ul class="storage-usage-list"><For each={observed()}>{entry => <UsageRow entry={entry} />}</For></ul>
        <Show when={absent().length}><details class="storage-overview-details"><summary>{i18n.t('storage.absent')} <span>{absent().length}</span></summary><ul class="storage-usage-list"><For each={absent()}>{entry => <UsageRow entry={entry} />}</For></ul></details></Show>
        <details class="storage-overview-details"><summary>{i18n.t('storage.locations')}</summary>
          <ul class="storage-location-list"><For each={ordered()}>{entry => <li><div class="storage-location-label"><span>{label('owners', entry.id)}</span><CopyButton value={entry.path} /></div><code>{entry.path}</code><p>{label('kinds', entry.kind)} · {label('backups', entry.backup)}</p></li>}</For></ul>
        </details>
      </Show>
    </div>
  </SettingsSection>;
}
