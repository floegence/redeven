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
  canManage: boolean;
  pluginInstanceID: string;
  onChanged: () => Promise<void>;
  onError: (error: unknown) => void;
};

export function PluginAuthorAccess(props: Props): JSX.Element {
  const i18n = useI18n();
  const scope = createMemo(() => ({ workspace: props.workspaceID, instance: props.pluginInstanceID }));
  const api = createMemo(() => createPluginLifecycleAPI(createAuthorPlatformClient(scope().workspace), []));
  const [item, setItem] = createSignal<PluginInventoryItem>();
  const [loading, setLoading] = createSignal(true);
  const [failed, setFailed] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [connections, setConnections] = createSignal(false);
  let controller: AbortController | undefined;
  let disposed = false;

  async function load() {
    controller?.abort();
    const request = new AbortController();
    controller = request;
    const target = scope();
    const current = () => !disposed && !request.signal.aborted && scope() === target;
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

  createEffect(
    on(scope, () => {
      setItem(undefined);
      setConnections(false);
      setPending(false);
      void load();
    }),
  );
  onCleanup(() => {
    disposed = true;
    controller?.abort();
  });

  async function command(value: PluginLifecycleCommand) {
    if (!props.canManage || pending() || loading() || failed()) return;
    if (value.type !== 'grant_permission' && value.type !== 'revoke_permission') return;
    const target = scope();
    const current = () => !disposed && scope() === target;
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
    <div class="space-y-3 p-3" data-plugin-author-access aria-busy={loading()}>
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
            <PluginPermissionInventory
              item={value()}
              canManage={props.canManage && !failed() && !loading()}
              commandPending={pending()}
              onCommand={(action) => void command(action)}
            />
            <Show when={value().networkConnectors?.length}>
              <Button size="sm" variant="outline" disabled={failed() || loading()} onClick={() => setConnections(true)}>
                {i18n.t('uiCopy.plugin.connections.title')}
              </Button>
            </Show>
            <PluginConnectionsDialog
              open={connections()}
              onOpenChange={setConnections}
              item={value()}
              ownerScope={scope()}
              canManage={props.canManage}
              api={api()}
            />
          </>
        )}
      </Show>
    </div>
  );
}
