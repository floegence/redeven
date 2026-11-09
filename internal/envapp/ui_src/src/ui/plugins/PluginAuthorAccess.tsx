import { Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../i18n';
import { PluginPermissionInventory } from './PluginCenterView';
import { PluginConnectionsDialog } from './PluginConnectionsDialog';
import { createPluginLifecycleAPI } from './pluginApi';
import { createAuthorPlatformClient } from './pluginAuthorApi';
import type { PluginInventoryItem, PluginLifecycleCommand } from './pluginTypes';

type Props = {
  workspaceID: string;
  visible?: boolean;
  embeddedConnections?: boolean;
  authorityKey?: unknown;
  refreshRevision?: number;
  canManage: boolean;
  pluginInstanceID: string;
  onChanged: () => Promise<void>;
  onError: (error: unknown) => void;
};

export function PluginAuthorAccess(props: Props): JSX.Element {
  const i18n = useI18n();
  // IMPORTANT: Draft lifetime is the exact preview identity. Revalidation and
  // management permission changes revoke admission, never the retained editor.
  const scope = createMemo(() => ({ workspace: props.workspaceID, instance: props.pluginInstanceID }));
  const authority = createMemo(() => ({ scope: scope(), key: props.authorityKey, canManage: props.canManage }));
  const api = createMemo(() => createPluginLifecycleAPI(createAuthorPlatformClient(scope().workspace), []));
  const [item, setItem] = createSignal<PluginInventoryItem>();
  const [loading, setLoading] = createSignal(true);
  const [failed, setFailed] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [connections, setConnections] = createSignal(false);
  const permissionAdmission = createMemo(() => ({ authority: authority(), loading: loading(), failed: failed(), pending: pending(), revision: item()?.managementRevision, authorization: item()?.authorization?.revisions }));
  // IMPORTANT: Connection event handlers read these props outside render. Hoist
  // conditional computations into this owner; inline JSX getters leak memos.
  const connectionsOpen = createMemo(() => props.embeddedConnections ? Boolean(item()?.networkConnectors?.length) : connections());
  const canManageConnections = createMemo(() => props.canManage && !failed() && !loading() && !pending());
  let controller: AbortController | undefined;
  let disposed = false;

  async function load() {
    if (props.authorityKey === false) return;
    controller?.abort();
    const request = new AbortController();
    controller = request;
    const target = scope(), access = authority();
    const current = () => !disposed && !request.signal.aborted && scope() === target && authority() === access;
    setLoading(true);
    setFailed(false);
    try {
      const result = await api().loadInventoryProjection({ signal: request.signal });
      if (!current()) return;
      const value = result.items.find((candidate) => candidate.pluginInstanceID === target.instance);
      setItem(value);
      setFailed(!value);
    } catch {
      if (current()) setFailed(true);
    } finally {
      if (current()) setLoading(false);
    }
  }

  let previousScope: ReturnType<typeof scope> | undefined;
  createEffect(on(authority, access => {
    controller?.abort(); controller = undefined;
    if (previousScope !== access.scope) {
      setItem(undefined); setConnections(false); previousScope = access.scope;
    }
    setPending(false);
    if (access.key === false) { setLoading(false); setFailed(true); }
    else void load();
  }));
  createEffect(on(() => props.refreshRevision, () => {
    if (props.authorityKey !== false) void load();
  }, { defer: true }));
  onCleanup(() => {
    disposed = true;
    controller?.abort();
  });

  async function command(value: PluginLifecycleCommand) {
    if (props.authorityKey === false || props.visible === false || !props.canManage || pending() || loading() || failed()) return;
    if (value.type !== 'grant_permission' && value.type !== 'revoke_permission') return;
    const target = scope(), access = authority();
    if (value.pluginInstanceID !== target.instance) return;
    const current = () => !disposed && scope() === target && authority() === access;
    setPending(true);
    try {
      await api().execute(value);
      if (!current()) return;
      await load();
      if (current()) await props.onChanged();
    } catch (error) {
      if (current()) {
        props.onError(error);
        await load();
      }
    } finally {
      if (current()) setPending(false);
    }
  }

  return (
    <div class={props.embeddedConnections ? "space-y-4" : "space-y-3 p-3"} data-plugin-author-access aria-busy={loading()}>
      <Show when={loading()}>
        <p role="status" class="text-xs text-muted-foreground">
          {i18n.t('common.status.loading')}
        </p>
      </Show>
      <Show when={failed()}>
        <div role="alert" class="flex items-center gap-2 text-xs text-destructive">
          <span class="flex-1">{i18n.t('uiCopy.plugin.creation.accessLoadFailed')}</span>
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            {i18n.t('common.actions.retry')}
          </Button>
        </div>
      </Show>
      <Show when={item()}>
        {(value) => (
          <>
            <Show when={permissionAdmission()} keyed>{_admission => <PluginPermissionInventory
              visible={props.visible}
              item={value()}
              canManage={props.visible !== false && props.canManage && !failed() && !loading()}
              commandPending={pending()}
              onCommand={(action) => void command(action)}
            />}</Show>
            <Show when={!props.embeddedConnections && value().networkConnectors?.length}>
              <Button size="sm" variant="outline" disabled={failed() || loading()} onClick={() => setConnections(true)}>
                {i18n.t('uiCopy.plugin.connections.title')}
              </Button>
            </Show>
            <PluginConnectionsDialog
              embedded={props.embeddedConnections}
              refreshRevision={props.embeddedConnections ? props.refreshRevision : undefined}
              visible={props.visible}
              open={connectionsOpen()}
              onOpenChange={setConnections}
              item={value()}
              ownerScope={scope()}
              authorityKey={props.authorityKey}
              canManage={canManageConnections()}
              api={api()}
            />
          </>
        )}
      </Show>
    </div>
  );
}
