import { Button, Dialog, StableText } from '@floegence/floe-webapp-core/ui';
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js';
import type { DesktopCloudRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import type { GatewayMembershipStatus } from '../shared/gatewayJoin';
import type { DesktopI18n } from '../shared/i18n';

/** The Runtime owns the selected member and verifies Cloud interruption consent. */
export function RuntimeGatewayConnectionsDialog(props: Readonly<{
  targetID: DesktopCloudRuntimeLinkTargetID;
  i18n: DesktopI18n;
  mode?: 'leave' | 'publish';
  gatewayID?: string;
  onClose: () => void;
  onChanged: () => void;
  focusOwner?: () => void;
}>) {
  const [status, setStatus] = createSignal<GatewayMembershipStatus>();
  const [selected, setSelected] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [displayMode, setDisplayMode] = createSignal<'leave' | 'publish'>(props.mode ?? 'leave');
  const targetID = createMemo(() => props.targetID);
  const mode = createMemo(() => props.mode);
  const gatewayID = createMemo(() => props.gatewayID);
  const members = () => status()?.memberships ?? [];
  const member = () => members().find(item => item.gateway_id === selected());
  const text = props.i18n.t;
  let generation = 0;
  let select: HTMLSelectElement | undefined;
  let confirm: HTMLButtonElement | undefined;

  const close = () => {
    generation++;
    props.onClose();
    queueMicrotask(() => props.focusOwner?.());
  };
  onCleanup(() => { generation++; });

  // Equivalent snapshots do not reinitialize a target's confirmation session.
  createEffect(on([targetID, mode, gatewayID], ([target, operation, requestedGateway]) => {
    const current = ++generation;
    if (!operation) return;
    setDisplayMode(operation);
    setError('');
    setStatus(undefined);
    setSelected('');
    setBusy(false);
    void (async () => {
      try {
        const result = await window.redevenDesktopLauncher?.performAction({
          kind: 'manage_runtime_gateway', runtime_target_id: target, operation: 'status',
        });
        if (current !== generation) return;
        if (!result?.ok || !result.gateway_membership) {
          setError(text('gatewayJoin.failed'));
          return;
        }
        setStatus(result.gateway_membership);
        const available = result.gateway_membership.memberships ?? [];
        if (requestedGateway && available.some(item => item.gateway_id === requestedGateway)) setSelected(requestedGateway);
        else if (!requestedGateway && available.length === 1) setSelected(available[0]!.gateway_id!);
        queueMicrotask(() => available.length > 1 && !requestedGateway ? select?.focus() : confirm?.focus());
      } catch {
        if (current === generation) setError(text('gatewayJoin.failed'));
      }
    })();
  }));

  async function submit() {
    const target = member();
    const operation = mode();
    if (!target || !operation || busy()) return;
    const current = generation;
    setBusy(true);
    setError('');
    try {
      const result = await window.redevenDesktopLauncher?.performAction({
        kind: 'manage_runtime_gateway', runtime_target_id: targetID(), operation,
        gateway_id: target.gateway_id,
        ...(operation === 'leave' ? { route_impact_acknowledged: target.route_selected === true } : {}),
      });
      if (current !== generation) return;
      if (!result?.ok) {
        setError(text(result?.gateway_error_code === 'GATEWAY_ROUTE_IMPACT_REQUIRED'
          ? 'gatewayConnections.cloudChanged' : 'gatewayJoin.failed'));
        return;
      }
      props.onChanged();
      close();
    } catch {
      if (current === generation) setError(text('gatewayJoin.failed'));
    } finally {
      if (current === generation) setBusy(false);
    }
  }

  const submitDisabled = () => !mode() || busy() || !member() || member()?.phase === 'removal_pending'
    || mode() === 'publish' && Boolean(status()?.existing_environment_id) && !status()?.cloud_enrollment_required;

  return (
    <Dialog open={!!mode()} onOpenChange={value => { if (!value) close(); }}
      title={text(displayMode() === 'publish' ? 'gatewayConnections.publishTitle' : 'gatewayConnections.unpairTitle')}
      closeLabel={text('common.close')} class="redeven-gateway-dialog">
      <div class="space-y-4">
        <Show when={members().length > 1 && !gatewayID()}>
          <label class="block space-y-2 text-sm">
            <span>{text('gatewayConnections.select')}</span>
            <select ref={select} class="w-full cursor-pointer rounded-md border border-border bg-background px-3 py-2.5"
              value={selected()} disabled={busy()} onChange={event => {
                setSelected(event.currentTarget.value);
                            setError('');
              }}>
              <option value="" disabled>{text('gatewayConnections.select')}</option>
              <For each={members()}>{item => <option value={item.gateway_id}>{item.gateway_name || item.gateway_id}</option>}</For>
            </select>
          </label>
        </Show>
        <Show when={member()}>{item => (
          <div class="space-y-2">
            <p class="truncate font-medium" title={item().gateway_name || item().gateway_id}>{item().gateway_name || item().gateway_id}</p>
            <p class="break-all text-xs text-muted-foreground">{item().endpoints?.[0]?.address}</p>
            <p class="text-sm text-muted-foreground">{text(displayMode() === 'publish' ? 'gatewayConnections.publishHelp' : 'gatewayConnections.unpairImpact')}</p>
            <Show when={displayMode() === 'leave' && item().route_selected}>
              <p role="alert" class="text-sm text-warning">{text('gatewayConnections.cloudImpact')}</p>
            </Show>
          </div>
        )}</Show>
        <Show when={displayMode() === 'publish' && status()?.existing_environment_id}>
          <p role="status" class="text-sm text-muted-foreground">{text('gatewayConnections.useRouteChange')}</p>
        </Show>
        <Show when={status() && !members().length}>
          <p class="text-sm text-muted-foreground">{text('gatewayConnections.empty')}</p>
        </Show>
        <Show when={status() && gatewayID() && !member() && members().length}>
          <p class="text-sm text-muted-foreground">{text('gatewayConnections.empty')}</p>
        </Show>
        <Show when={error()}><p role="alert" class="text-sm text-error">{error()}</p></Show>
        <div class="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" class="cursor-pointer whitespace-nowrap" onClick={close}>{text('common.cancel')}</Button>
          <Button ref={confirm} variant={displayMode() === 'leave' ? 'destructive' : 'default'} class="cursor-pointer whitespace-nowrap"
            disabled={submitDisabled()} onClick={() => void submit()}>
            <StableText reserve={[text('gatewayConnections.unpair'), text('gatewayConnections.publish')]}>
              {text(displayMode() === 'publish' ? 'gatewayConnections.publish' : 'gatewayConnections.unpair')}
            </StableText>
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
