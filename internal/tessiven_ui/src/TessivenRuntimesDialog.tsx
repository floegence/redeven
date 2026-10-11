import { secureRandomUUID } from '@floegence/floe-webapp-core';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { TessivenText, TessivenTransport } from './types';

type Target = {
  runtime_ref: string;
  generation: string;
  identity?: string;
  name: string;
  source: string;
  location: string;
  observed_at: string;
  registered: boolean;
  online: boolean | null;
  connected: boolean;
  authenticated: boolean;
  actions: string[];
  reason?: string;
};
type Directory = {
  targets: Target[];
  sources: {
    source: string;
    location: string;
    state: string;
    name?: string;
    reason?: string;
  }[];
};
type Outcome = { status: string; operation_id?: string; target?: Target };
const actionKeys: Record<string, string> = {
  status: 'runtimeInspect',
  connect: 'runtimeConnect',
  start: 'runtimeStart',
  stop: 'runtimeStop',
  restart: 'runtimeRestart',
  update: 'runtimeUpdate',
};
const reasonKeys: Record<string, string> = {
  desktop_source_required: 'runtimeDesktopUnavailable',
  desktop_disconnected: 'runtimeDesktopUnavailable',
  gateway_unavailable: 'runtimeGatewayUnavailable',
  desktop_gateway_required: 'runtimeGatewayConnectionRequired',
  direct_disconnected: 'runtimeDirectDisconnected',
  gateway_business_only: 'runtimeGatewayBusinessOnly',
};
const statusKeys: Record<string, string> = {
  handoff_required: 'runtimeHandoff',
  needs_confirmation: 'runtimeHandoff',
  authentication_required: 'runtimeAuthenticationRequired',
  recovery_required: 'runtimeRecoveryRequired',
  connected: 'runtimeConnected',
  disconnected: 'runtimeDisconnected',
  pending: 'operation.pending',
  queued: 'operation.queued',
  running: 'operation.running',
  cleanup_running: 'operation.running',
  succeeded: 'operation.succeeded',
  failed: 'operation.failed',
  canceling: 'operation.canceling',
  canceled: 'operation.canceled',
};
const terminal = new Set(['succeeded', 'failed', 'canceled']);

export function TessivenRuntimesDialog(props: {
  transport: TessivenTransport;
  t: TessivenText;
  canWrite: boolean;
  runtimeRef?: string;
  onClose: () => void;
}) {
  const [directory, setDirectory] = createStore<Directory>({
    targets: [],
    sources: [],
  });
  const [query, setQuery] = createSignal('');
  const [selected, setSelected] = createSignal(props.runtimeRef ?? '');
  const [loading, setLoading] = createSignal(false);
  const [busy, setBusy] = createSignal<string[]>([]);
  const [messages, setMessages] = createStore<Record<string, string>>({});
  const [operations, setOperations] = createStore<Record<string, string>>({});
  const [uncertain, setUncertain] = createSignal<string[]>([]);
  const [error, setError] = createSignal('');
  let disposed = false,
    refreshGeneration = 0;
  onCleanup(() => {
    disposed = true;
    refreshGeneration++;
  });
  const targets = createMemo(() =>
    directory.targets.filter((target) =>
      `${target.name} ${target.runtime_ref} ${target.source}`
        .toLocaleLowerCase()
        .includes(query().toLocaleLowerCase()),
    ),
  );
  const reason = (code?: string) =>
    props.t(reasonKeys[code ?? ''] ?? 'runtimeChanged');
  async function refresh() {
    const generation = ++refreshGeneration;
    setLoading(true);
    setError('');
    try {
      const next = await props.transport.request<Directory>('GET', '/runtimes');
      if (disposed || generation !== refreshGeneration) return;
      setDirectory(reconcile(next, { key: 'runtime_ref' }));
    } catch {
      if (!disposed && generation === refreshGeneration)
        setError(props.t('runtimeLoadFailed'));
    } finally {
      if (!disposed && generation === refreshGeneration) setLoading(false);
    }
  }
  async function execute(target: Target, action: string) {
    if (busy().includes(target.runtime_ref)) return;
    const mutation = action !== 'status' && action !== 'operation';
    if (
      mutation &&
      (!props.canWrite || uncertain().includes(target.runtime_ref))
    )
      return;
    const requestID = mutation ? secureRandomUUID() : undefined;
    const snapshot = {
      runtime_ref: target.runtime_ref,
      generation: target.generation,
      ...(target.identity ? { identity: target.identity } : {}),
    };
    setBusy((previous) => [...previous, target.runtime_ref]);
    setMessages(target.runtime_ref, '');
    try {
      const result = await props.transport.request<Outcome>(
        'POST',
        mutation ? '/runtimes/actions' : '/runtimes/inspect',
        {
          ...snapshot,
          action,
          ...(requestID ? { request_id: requestID } : {}),
          ...(action === 'operation'
            ? { operation_id: operations[target.runtime_ref] }
            : {}),
        },
      );
      if (disposed) return;
      if (result.operation_id)
        setOperations(target.runtime_ref, result.operation_id);
      if (action === 'operation' && terminal.has(result.status)) {
        setUncertain((previous) =>
          previous.filter((ref) => ref !== target.runtime_ref),
        );
      }
      setMessages(
        target.runtime_ref,
        props.t(statusKeys[result.status] ?? 'runtimeUnknown'),
      );
      await refresh();
    } catch (cause) {
      if (disposed) return;
      const code =
        (cause as { code?: string; error_code?: string }).code ??
        (cause as { error_code?: string }).error_code;
      if (mutation && (!code || code === 'TESSIVEN_OUTCOME_UNKNOWN')) {
        setUncertain((previous) => [...previous, target.runtime_ref]);
        // Lifecycle uses this deterministic key in the original launcher owner.
        // Querying it recovers a lost handoff response without replaying an effect.
        if (action !== 'connect')
          setOperations(target.runtime_ref, `tessiven:${requestID}`);
        setMessages(target.runtime_ref, props.t('runtimeUnknownOutcome'));
      } else {
        setMessages(
          target.runtime_ref,
          props.t(
            code === 'TESSIVEN_RESOURCE_CONFLICT'
              ? 'runtimeChanged'
              : 'runtimeActionFailed',
          ),
        );
      }
    } finally {
      if (!disposed)
        setBusy((previous) =>
          previous.filter((ref) => ref !== target.runtime_ref),
        );
    }
  }
  onMount(() => void refresh());
  return (
    <Dialog
      open
      title={props.t('runtimePanel')}
      bodyDescription={props.t('runtimePanelDescription')}
      closeLabel={props.t('close')}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      class="tessiven-runtimes-dialog"
    >
      <div class="tessiven-runtimes-controls">
        <input
          aria-label={props.t('runtimeSearch')}
          placeholder={props.t('runtimeSearch')}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={loading()}
          onClick={() => void refresh()}
        >
          {props.t('runtimeRefresh')}
        </Button>
      </div>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
      <div class="tessiven-runtime-sources">
        <For
          each={directory.sources.filter(
            (source) => source.state !== 'available',
          )}
        >
          {(source) => (
            <p role="status">
              <strong>
                {source.name ??
                  props.t(
                    source.source === 'desktop'
                      ? 'runtimeSourceDesktop'
                      : 'runtimeSourceGateway',
                  )}
              </strong>
              {' · '}
              {props.t(
                source.location === 'current_device'
                  ? 'runtimeCurrentDevice'
                  : 'runtimeExecutionMachine',
              )}
              <br />
              {reason(source.reason)}
            </p>
          )}
        </For>
      </div>
      <div class="tessiven-runtime-list" aria-busy={loading()}>
        <Show
          when={targets().length > 0}
          fallback={<p>{props.t(loading() ? 'working' : 'runtimeEmpty')}</p>}
        >
          <For each={targets()}>
            {(target) => (
              <article
                class="tessiven-runtime-card"
                data-selected={selected() === target.runtime_ref}
              >
                <button
                  class="tessiven-runtime-card-title"
                  onClick={() => setSelected(target.runtime_ref)}
                  aria-pressed={selected() === target.runtime_ref}
                >
                  <strong>{target.name}</strong>
                  <small>
                    {props.t(
                      target.location === 'current_device'
                        ? 'runtimeCurrentDevice'
                        : 'runtimeExecutionMachine',
                    )}
                    {' · '}
                    {props.t(
                      target.source === 'desktop'
                        ? 'runtimeSourceDesktop'
                        : 'runtimeSourceGateway',
                    )}
                  </small>
                </button>
                <code>{target.runtime_ref}</code>
                <div class="tessiven-runtime-facts">
                  <span>
                    {props.t(
                      target.online === null
                        ? 'runtimeUnknown'
                        : target.online
                          ? 'runtimeOnline'
                          : 'runtimeOffline',
                    )}
                  </span>
                  <span>
                    {props.t(
                      target.connected
                        ? 'runtimeConnected'
                        : 'runtimeDisconnected',
                    )}
                  </span>
                  <span>
                    {props.t(
                      target.authenticated
                        ? 'runtimeAuthenticated'
                        : 'runtimeAuthenticationRequired',
                    )}
                  </span>
                </div>
                <Show when={target.reason}>
                  <p>{reason(target.reason)}</p>
                </Show>
                <div class="tessiven-runtime-actions">
                  <For
                    each={target.actions.filter(
                      (action) => action in actionKeys,
                    )}
                  >
                    {(action) => (
                      <Button
                        size="sm"
                        variant={action === 'connect' ? 'primary' : 'ghost'}
                        disabled={
                          busy().includes(target.runtime_ref) ||
                          (action !== 'status' &&
                            (!props.canWrite ||
                              uncertain().includes(target.runtime_ref)))
                        }
                        onClick={() => void execute(target, action)}
                      >
                        {props.t(actionKeys[action]!)}
                      </Button>
                    )}
                  </For>
                  <Show when={operations[target.runtime_ref]}>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy().includes(target.runtime_ref)}
                      onClick={() => void execute(target, 'operation')}
                    >
                      {props.t('runtimeOperation')}
                    </Button>
                  </Show>
                </div>
                <Show when={messages[target.runtime_ref]}>
                  <p role="status">{messages[target.runtime_ref]}</p>
                </Show>
              </article>
            )}
          </For>
        </Show>
      </div>
    </Dialog>
  );
}
