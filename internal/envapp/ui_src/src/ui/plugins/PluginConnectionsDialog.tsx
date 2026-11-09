import { For, Show, createEffect, createSignal, on, onCleanup, type JSX } from 'solid-js';
import { Button, Input } from '@floegence/floe-webapp-core/ui';
import { pluginMutationOutcome } from '@floegence/redevplugin-ui';
import { PLUGIN_MOBILE_TOUCH_TARGET_CLASS } from './pluginPresentation';
import { useI18n } from '../i18n';
import { Dialog } from '../primitives/EnvAppModal';
import type { PluginLifecycleAPI } from './pluginApi';
import type { PluginInventoryItem } from './pluginTypes';

export type PluginConnectionsAPI = Pick<PluginLifecycleAPI,
  'listConnections' | 'reviewConnection' | 'approveConnection' | 'cancelConnectionReview' | 'revokeConnection'>;
type Connection = Awaited<ReturnType<PluginConnectionsAPI['listConnections']>>['connections'][number];
type Review = Awaited<ReturnType<PluginConnectionsAPI['reviewConnection']>>['review'];

type Props = {
  visible?: boolean;
  embedded?: boolean;
  authorityKey?: unknown;
  open: boolean; item?: PluginInventoryItem; ownerScope?: object | false; canManage: boolean;
  api: PluginConnectionsAPI; onOpenChange: (open: boolean) => void;
};

export function PluginConnectionsDialog(props: Props): JSX.Element {
  const i18n = useI18n();
  const [connections, setConnections] = createSignal<Connection[]>([]);
  const [connectorID, setConnectorID] = createSignal('');
  const [destination, setDestination] = createSignal('');
  const [prefixes, setPrefixes] = createSignal('');
  const [methods, setMethods] = createSignal<string[]>([]);
  const [dirty, setDirty] = createSignal(false);
  const [draftRevision, setDraftRevision] = createSignal(0);
  const [review, setReview] = createSignal<Review>();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [loaded, setLoaded] = createSignal(false);
  const [reviewExpired, setReviewExpired] = createSignal(false);
  createEffect(() => {
    const pending = review();
    setReviewExpired(Boolean(pending && Date.parse(pending.review_expires_at) <= Date.now()));
    if (!pending) return;
    const timeout = setTimeout(() => setReviewExpired(true), Math.min(2147483647, Math.max(0, Date.parse(pending.review_expires_at) - Date.now())));
    onCleanup(() => clearTimeout(timeout));
  });
  let controller: AbortController | undefined;
  let generation = 0;
  const selected = () => connections().find((connection) => connection.connector_id === connectorID());
  const declaration = () => props.item?.networkConnectors?.find((connector) => connector.connectorID === connectorID());
  const editable = () => props.authorityKey !== false && props.visible !== false && props.open && !!props.ownerScope && props.canManage && declaration()?.configurable && loaded() && !busy();
  const statusLabel = (status: Connection['status']) => i18n.t(({
    fixed: 'uiCopy.plugin.connections.fixed', unconfigured: 'uiCopy.plugin.connections.unconfigured',
    active: 'uiCopy.plugin.connections.active', expired: 'uiCopy.plugin.connections.expired',
    revoked: 'uiCopy.plugin.connections.revoked', stale: 'uiCopy.plugin.connections.stale',
  } as const)[status]);
  const date = (value: string) => i18n.formatDateTime(value, { dateStyle: 'medium', timeStyle: 'short' });

  function choose(id: string) {
    const connection = connections().find((entry) => entry.connector_id === id);
    setConnectorID(id);
    setDirty(false); setDraftRevision(connection?.revision ?? 0);
    setDestination(connection?.destination ?? '');
    setPrefixes(connection?.private_prefixes?.join(', ') ?? '');
    setMethods(connection?.http_methods ?? []);
  }
  async function refresh(signal: AbortSignal, id: string, current: () => boolean, preserveDraft = true) {
    setLoaded(false);
    const result = await props.api.listConnections({ plugin_instance_id: id }, { signal });
    if (!current()) return;
    setConnections(result.connections);
    // IMPORTANT: A refreshed authority revision cannot be paired with old draft
    // content. Retain both the draft and its original CAS revision until save.
    if (!preserveDraft || !dirty()) choose(result.connections.some((entry) => entry.connector_id === connectorID()) ? connectorID() : result.connections[0]?.connector_id ?? '');
    setLoaded(true);
  }
  async function run(action: (signal: AbortSignal, id: string, current: () => boolean) => Promise<void>) {
    const id = props.item?.pluginInstanceID;
    if (props.authorityKey === false || !props.open || !props.ownerScope || !id || busy()) return;
    const currentGeneration = generation;
    const operation = new AbortController();
    controller = operation;
    const current = () => currentGeneration === generation && !operation.signal.aborted;
    setBusy(true); setError(undefined);
    try { await action(operation.signal, id, current); }
    catch (cause) {
      if (current()) setError(i18n.t(pluginMutationOutcome(cause) === 'unknown'
        ? 'uiCopy.plugin.connections.unknown' : 'uiCopy.plugin.connections.failed'));
    } finally { if (current()) { setBusy(false); controller = undefined; } }
  }
  async function cancelReview(closeAfter = false) {
    const pending = review();
    setReview(undefined);
    const currentGeneration = generation;
    if (pending && props.ownerScope && props.canManage) {
      await run(async (signal) => { await props.api.cancelConnectionReview({ plugin_instance_id: pending.plugin_instance_id, review_id: pending.review_id }, { signal }); });
    }
    if (closeAfter && currentGeneration === generation) props.onOpenChange(false);
  }
  createEffect(on(() => [props.open, props.ownerScope, props.item?.pluginInstanceID,
    props.authorityKey, props.item?.recoveryIdentity?.active_fingerprint, props.item?.managementRevision, props.canManage] as const,
  ([open, scope, id], previous) => {
    const sameOwner = previous && previous[0] === open && previous[1] === scope && previous[2] === id;
    generation += 1; controller?.abort(); controller = undefined;
    setReview(undefined); setBusy(false); setLoaded(false); setError(undefined);
    // IMPORTANT: Owner replacement discards a draft. Temporary permission or
    // transport loss only invalidates the review and current write admission.
    if (!sameOwner) { setConnections([]); choose(''); }
    if (open && (!scope || !id)) { props.onOpenChange(false); return; }
    if (open && scope && id && props.authorityKey !== false) void run((signal, target, current) => refresh(signal, target, current, Boolean(sameOwner)));
  }));
  onCleanup(() => { generation += 1; controller?.abort(); });

  function prepareReview() {
    if (!editable() || !selected() || !destination().trim()) return;
    const connection = selected()!;
    const privatePrefixes = prefixes().split(/[\s,]+/u).filter(Boolean);
    void run(async (signal, id, current) => {
      const result = await props.api.reviewConnection({
        plugin_instance_id: id, connector_id: connection.connector_id, destination: destination().trim(),
        expected_revision: draftRevision(),
        ...(methods().length ? { http_methods: methods() as NonNullable<Review['http_methods']> } : {}),
        ...(privatePrefixes.length ? { private_prefixes: privatePrefixes } : {}),
        ...(connection.secret_ref ? { secret_ref: connection.secret_ref } : {}),
      }, { signal });
      if (current()) setReview(result.review);
    });
  }
  function mutate(kind: 'approve' | 'revoke') {
    const pending = review(); const connection = selected();
    if (!editable() || (kind === 'approve' ? !pending || reviewExpired() : !connection)) return;
    // A review is one-use even if the response is lost. Reconcile by listing;
    // never keep an approval button that can replay an uncertain write.
    setReview(undefined);
    void run(async (signal, id, current) => {
      let failure: unknown;
      try {
        if (kind === 'approve') await props.api.approveConnection({ plugin_instance_id: id, review_id: pending!.review_id }, { signal });
        else await props.api.revokeConnection({ plugin_instance_id: id, connector_id: connection!.connector_id, expected_revision: connection!.revision }, { signal });
      } catch (cause) { failure = cause; }
      if (current()) await refresh(signal, id, current, Boolean(failure));
      if (failure) throw failure;
    });
  }

  const body = () => <div class="space-y-4" data-plugin-connections aria-busy={busy()}>
      <Show when={busy() && !loaded()}><p role="status" class="text-sm text-muted-foreground">{i18n.t('common.status.loading')}</p></Show>
      <Show when={error()}>{(message) => <p role="alert" class="text-sm text-error">{message()}</p>}</Show>
      <Show when={!review()} fallback={<Show when={review()}>{(pending) => <>
        <dl class="space-y-2 break-words text-sm" data-connection-review>
          <dt class="font-medium">{i18n.t('uiCopy.plugin.connections.destination')}</dt><dd>{pending().destination}</dd>
          <dt class="font-medium">{i18n.t('uiCopy.plugin.connections.scope')}</dt><dd>{i18n.t(pending().scope === 'environment' ? 'uiCopy.plugin.connections.environment' : 'uiCopy.plugin.connections.user')}</dd>
          <Show when={pending().http_methods?.length}><dt>{i18n.t('uiCopy.plugin.connections.methods')}</dt><dd>{pending().http_methods?.join(', ')}</dd></Show>
          <Show when={pending().private_prefixes?.length}><dt>{i18n.t('uiCopy.plugin.connections.privatePrefixes')}</dt><dd>{pending().private_prefixes?.join(', ')}</dd></Show>
          <Show when={pending().secret_ref}><dt>{i18n.t('uiCopy.plugin.external.secretRefs')}</dt><dd>{pending().secret_ref}</dd></Show>
          <dt>{i18n.t('uiCopy.plugin.connections.expires')}</dt><dd>{date(pending().expires_at)}</dd>
          <dt>{i18n.t('uiCopy.plugin.connections.reviewExpires')}</dt><dd>{date(pending().review_expires_at)}</dd>
        </dl>
        <div class="flex flex-wrap justify-end gap-2">
          <Button class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS} variant="outline" disabled={busy()} onClick={() => void cancelReview()}>{i18n.t('common.actions.cancel')}</Button>
          <Button class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS} disabled={!editable() || reviewExpired()} onClick={() => mutate('approve')}>{i18n.t('uiCopy.plugin.connections.approve')}</Button>
        </div>
      </>}</Show>}>
        <Show when={connections().length} fallback={<Show when={!busy()}><p class="text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.connections.empty')}</p></Show>}>
          <label class="block space-y-1 text-sm"><span>{i18n.t('uiCopy.plugin.connections.connector')}</span>
            <select class="w-full rounded-md border bg-background px-3 py-2" value={connectorID()} disabled={busy()} onChange={(event) => choose(event.currentTarget.value)}>
              <Show when={dirty() && connectorID() && !selected()}><option value={connectorID()}>{connectorID()} · {i18n.t('settings.targetUnavailable')}</option></Show>
              <For each={connections()}>{(connection) => <option value={connection.connector_id}>{connection.connector_id} · {statusLabel(connection.status)}</option>}</For>
            </select>
          </label>
          <label class="block space-y-1 text-sm"><span>{i18n.t('uiCopy.plugin.connections.destination')}</span><Input value={destination()} disabled={!editable()} onInput={(event) => { setDirty(true); setDestination(event.currentTarget.value); }} /></label>
          <label class="block space-y-1 text-sm"><span>{i18n.t('uiCopy.plugin.connections.privatePrefixes')}</span><Input value={prefixes()} disabled={!editable()} onInput={(event) => { setDirty(true); setPrefixes(event.currentTarget.value); }} /><span class="block text-xs text-muted-foreground">{i18n.t('uiCopy.plugin.connections.privateHelp')}</span></label>
          <Show when={declaration()?.httpMethods.length}><fieldset class="flex flex-wrap gap-3 text-sm"><legend>{i18n.t('uiCopy.plugin.connections.methods')}</legend>
            <For each={declaration()?.httpMethods}>{(method) => <label class="inline-flex items-center gap-2"><input type="checkbox" disabled={!editable()} checked={methods().includes(method)} onChange={(event) => { setDirty(true); setMethods((previous) => event.currentTarget.checked ? [...previous, method] : previous.filter((entry) => entry !== method)); }} />{method}</label>}</For>
          </fieldset></Show>
          <Show when={selected()?.expires_at}>{(expires) => <p class="text-xs text-muted-foreground">{i18n.t('uiCopy.plugin.connections.expires')}: {date(expires())}</p>}</Show>
        </Show>
        <div class="flex flex-wrap justify-end gap-2">
          <Show when={dirty()}><Button class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS} variant="ghost" disabled={busy() || props.authorityKey === false} onClick={() => void run((signal, id, current) => refresh(signal, id, current, false))}>{i18n.t('filePreview.discardChanges')}</Button></Show>
          <Button class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS} variant="outline" loading={busy()} disabled={busy() || props.authorityKey === false} onClick={() => void run((signal, id, current) => refresh(signal, id, current))}>{i18n.t('common.actions.refresh')}</Button>
          <Show when={selected()?.status === 'active'}><Button class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS} variant="outline" disabled={!editable()} onClick={() => mutate('revoke')}>{i18n.t('uiCopy.plugin.connections.revoke')}</Button></Show>
          <Show when={declaration()?.configurable}><Button class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS} disabled={!editable() || !selected() || !destination().trim() || (declaration()?.transport === 'http' && !methods().length)} onClick={prepareReview}>{i18n.t('uiCopy.plugin.connections.review')}</Button></Show>
        </div>
      </Show>
    </div>;
  // IMPORTANT: The author preview editor lives in the global Settings dialog.
  // This presentation reuses the same owner and review protocol, never a second store.
  if (props.embedded) return <section hidden={!props.open || props.visible === false}><h3 class="mb-3 font-medium">{i18n.t('uiCopy.plugin.connections.title')}</h3>{body()}</section>;
  return <Dialog open={props.open && props.visible !== false} title={i18n.t('uiCopy.plugin.connections.title')}
    onOpenChange={(open) => { if (!open && !busy()) { void cancelReview(true); } }}>{body()}</Dialog>;
}
