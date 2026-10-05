import { secureRandomUUID } from '@floegence/floe-webapp-core';
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import type {
  Instance,
  TessivenText,
  TessivenTransport,
  Version,
} from './types';

type Operation = {
  operation_id: string;
  state: string;
  error?: unknown;
  progress?: unknown;
  [key: string]: unknown;
};
type Inspection = {
  name: string;
  runtime_ref: string;
  state: string;
  observed_at: string;
  identity: string;
  actions: string[];
  operation?: Operation;
};
type Result = {
  runtime_ref: string;
  inspection?: Inspection;
  operation?: Operation;
  logs?: unknown;
  opening?: {
    opened_by_host?: boolean;
    state: string;
    app_path?: string;
    forward?: unknown;
    operation?: Operation;
  };
};

export function TessivenResourceDialog(props: {
  instance: Instance;
  version: Version;
  historical: boolean;
  transport: TessivenTransport;
  t: TessivenText;
  locale?: string;
  onClose: () => void;
  onOpen: (
    opening: { app_path: string; forward: unknown },
    runtime: string,
  ) => void | Promise<void>;
}) {
  const [result, setResult] = createSignal<Result>();
  const [operation, setOperation] = createSignal<Operation>();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [logs, setLogs] = createSignal<unknown>();
  const [uncertain, setUncertain] = createSignal(false);
  const [readyOpening, setReadyOpening] = createSignal<{
    app_path: string;
    forward: unknown;
    runtime: string;
  }>();
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending:
    | { action: string; requestID: string; identity: string }
    | undefined;
  const runtime = () =>
    props.version.document.nodes?.find(
      (value) => value.id === props.instance.nodeRef,
    )?.runtimeRef ?? '';
  const terminal = (value: Operation) =>
    !['pending', 'queued', 'running', 'canceling', 'cancelling'].includes(
      value.state,
    );
  const request = (action: string, extra: Record<string, unknown> = {}) =>
    props.transport.request<Result>('POST', '/resources', {
      canvas_id: props.version.canvas_id,
      version_id: props.version.number,
      instance_id: props.instance.id,
      runtime_ref: runtime(),
      action,
      ...extra,
    });
  async function observe(value: Operation) {
    if (disposed) return;
    setOperation(value);
    if (terminal(value)) {
      setBusy(false);
      pending = undefined;
      try {
        const next = await request('inspect');
        if (!disposed) setResult(next);
      } catch (cause) {
        if (!disposed) setError(String(cause));
      }
      return;
    }
    // Read the owning manager's operation; Tessiven never invents progress or retries a mutation.
    timer = setTimeout(async () => {
      try {
        const next = await request('operation', {
          operation_id: value.operation_id,
        });
        if (next.operation) void observe(next.operation);
        else throw new Error(props.t('operationMissing'));
      } catch (cause) {
        if (!disposed) {
          setError(String(cause));
          setBusy(false);
        }
      }
    }, 1000);
  }
  async function run(action: string) {
    if (busy()) return;
    const mutation = ['start', 'stop', 'restart', 'open'].includes(action);
    if (mutation && (props.historical || uncertain())) return;
    setBusy(true);
    setError('');
    try {
      if (mutation && (!pending || pending.action !== action))
        pending = {
          action,
          requestID: secureRandomUUID(),
          identity: result()?.inspection?.identity ?? '',
        };
      const next = await request(
        action,
        mutation
          ? { request_id: pending!.requestID, identity: pending!.identity }
          : {},
      );
      if (disposed) return;
      if (action === 'logs') setLogs(next.logs);
      else setResult(next);
      if (
        !next.opening?.opened_by_host &&
        next.opening?.state === 'ready' &&
        next.opening.app_path &&
        next.opening.forward
      ) {
        // Browser opening must start from a fresh user gesture after the
        // manager has prepared its route, not after an awaited network call.
        setReadyOpening({
          app_path: next.opening.app_path,
          forward: next.opening.forward,
          runtime: next.runtime_ref,
        });
      }
      const original = next.operation ?? next.opening?.operation;
      if (original) {
        void observe(original);
        return;
      }
      pending = undefined;
    } catch (cause) {
      if (!disposed) {
        setError(cause instanceof Error ? cause.message : String(cause));
        const code =
          (cause as { code?: string; error_code?: string }).code ??
          (cause as { error_code?: string }).error_code;
        if (mutation && (!code || code === 'TESSIVEN_OUTCOME_UNKNOWN'))
          setUncertain(true);
      }
    }
    if (!disposed) setBusy(false);
  }
  onMount(() => {
    void run('inspect');
  });
  onCleanup(() => {
    disposed = true;
    clearTimeout(timer);
  });
  return (
    <Dialog
      class="tessiven-resource-dialog"
      closeLabel={props.t('close')}
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={props.t('serviceDetails')}
      bodyDescription={
        props.historical
          ? props.t('historyNotice')
          : props.t('serviceDescription')
      }
    >
      <div class="tessiven-resource-detail">
        <strong>
          {result()?.inspection?.name ??
            props.instance.name ??
            props.instance.id}
        </strong>
        <p>
          <code>{runtime()}</code> · <code>{props.instance.id}</code>
        </p>
        <Show when={error()}>
          <div role="alert" class="tessiven-error">
            {error()}
          </div>
        </Show>
        <Show when={result()?.inspection} keyed>
          {(value) => (
            <>
              <p>
                {props.t('observedState', {
                  state: value.state,
                  time: new Date(value.observed_at).toLocaleString(
                    props.locale,
                  ),
                })}
              </p>
              <div class="tessiven-actions">
                <For
                  each={value.actions.filter(
                    (action) => action !== 'open' || !readyOpening(),
                  )}
                >
                  {(action) => (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        busy() ||
                        ((props.historical || uncertain()) &&
                          !['inspect', 'logs'].includes(action))
                      }
                      onClick={() => void run(action)}
                    >
                      {props.t(`action.${action}`)}
                    </Button>
                  )}
                </For>
              </div>
            </>
          )}
        </Show>
        <Show when={readyOpening()} keyed>
          {(opening) => (
            <Button
              onClick={() => {
                setError('');
                void Promise.resolve(
                  props.onOpen(opening, opening.runtime),
                ).catch((cause: unknown) => {
                  if (!disposed)
                    setError(
                      cause instanceof Error ? cause.message : String(cause),
                    );
                });
              }}
            >
              {props.t('action.open')}
            </Button>
          )}
        </Show>
        <Show when={uncertain()}>
          <p role="alert">{props.t('outcomeUnknown')}</p>
        </Show>
        <Show when={busy()}>
          <p role="status">{props.t('working')}</p>
        </Show>
        <Show when={operation()} keyed>
          {(value) => (
            <section aria-live="polite">
              <p>{props.t(`operation.${value.state}`)}</p>
              <code>{value.operation_id}</code>
              <Show when={value.error}>
                <pre>{JSON.stringify(value.error, null, 2)}</pre>
              </Show>
              <Show when={!terminal(value) && !busy()}>
                <Button
                  onClick={() => {
                    setBusy(true);
                    void observe(value);
                  }}
                >
                  {props.t('refreshOperation')}
                </Button>
              </Show>
              <Show
                when={
                  result()?.opening?.state === 'preparing' &&
                  value.state === 'succeeded'
                }
              >
                <Button onClick={() => void run('open')}>
                  {props.t('action.open')}
                </Button>
              </Show>
            </section>
          )}
        </Show>
        <Show when={logs() !== undefined}>
          <pre tabIndex={0}>
            {typeof logs() === 'string'
              ? (logs() as string)
              : JSON.stringify(logs(), null, 2)}
          </pre>
        </Show>
      </div>
    </Dialog>
  );
}
