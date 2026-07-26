import {
  PluginBridgeClient,
  type PluginOperation,
  type PluginOperationTerminalStatus,
  type PluginUIActionEvent,
  type PluginUIElementVNode,
  type PluginUIVNode,
} from '@floegence/redevplugin-ui/plugin';
import {
  RedevenContainerResourcesClient,
  isRedevenContainerResourcesBusinessError,
  type ContainersListResponse,
} from '../../../../spec/redevplugin/official-containers-capability/capabilities/redeven.container_resources.v2/v2.0.0/redeven.container_resources.v2.client';
import {
  ContainerOperationStore,
  operationLabel,
  type ContainerOperationState,
  type ContainerOperationKind,
  type Engine,
} from './operation-state';
import { cancellationFailurePolicy, mutationOutcome, submissionFailurePolicy } from './operation-policy';

type Container = ContainersListResponse['containers'][number];
type OperationHandle = Pick<PluginOperation<object>, 'operation_id' | 'snapshot' | 'wait' | 'cancel'>;

type DashboardState = {
  engine: Engine;
  engineVersion: string;
  available: boolean;
  loading: boolean;
  containers: Container[];
  notice: string;
  noticeTone: 'neutral' | 'error';
  error: string;
  logs: { engine: Engine; containerID: string; generation: number; lines: string[]; loading: boolean; error: string };
};

const bridge = new PluginBridgeClient({ timeoutMs: 30_000 });
const client = new RedevenContainerResourcesClient(bridge);
const state: DashboardState = {
  engine: 'docker',
  engineVersion: '',
  available: false,
  loading: true,
  containers: [],
  notice: '',
  noticeTone: 'neutral',
  error: '',
  logs: { engine: 'docker', containerID: '', generation: 0, lines: [], loading: false, error: '' },
};

let disposed = false;
let refreshSequence = 0;
let logsGeneration = 0;
const inventorySequences = new Map<Engine, number>();
const operations = new ContainerOperationStore();
const operationHandles = new Map<string, { generation: number; handle: OperationHandle }>();
const observationControllers = new Map<string, { generation: number; controller: AbortController }>();

bridge.onAction('refresh-containers', () => void refresh());
bridge.onAction('select-engine', (event) => void selectEngine(event));
bridge.onAction('start-container', (event) => void runContainerOperation('start', event));
bridge.onAction('stop-container', (event) => void runContainerOperation('stop', event));
bridge.onAction('restart-container', (event) => void runContainerOperation('restart', event));
bridge.onAction('remove-container', (event) => void runContainerOperation('remove', event));
bridge.onAction('cancel-container-operation', (event) => void cancelContainerOperation(event));
bridge.onAction('resume-container-observation', (event) => void resumeContainerObservation(event));
bridge.onAction('view-container-logs', (event) => void loadLogs(event));
bridge.onAction('close-container-logs', () => void closeLogs());
bridge.onLifecycle((event) => {
  if (event.type === 'dispose') {
    disposed = true;
    refreshSequence += 1;
    for (const observation of observationControllers.values()) observation.controller.abort();
    observationControllers.clear();
  }
});

void initialize();

async function initialize(): Promise<void> {
  await bridge.ready();
  await refresh();
}

async function selectEngine(event: PluginUIActionEvent): Promise<void> {
  if (event.value !== 'docker' && event.value !== 'podman') return;
  if (state.engine === event.value) return;
  state.engine = event.value;
  state.logs = { engine: event.value, containerID: '', generation: ++logsGeneration, lines: [], loading: false, error: '' };
  await refresh();
}

async function refresh(): Promise<void> {
  const sequence = ++refreshSequence;
  const engine = state.engine;
  state.loading = true;
  state.error = '';
  state.notice = '';
  state.noticeTone = 'neutral';
  await render();
  try {
    const status = await client.status({ engine });
    if (sequence !== refreshSequence) return;
    state.available = status.available;
    state.engineVersion = status.engine_version ?? '';
    if (!status.available) {
      state.containers = [];
      return;
    }
    const inventorySequence = nextInventorySequence(engine);
    const result = await client.list({ engine, all: true });
    if (sequence !== refreshSequence) return;
    if (!isCurrentInventorySequence(engine, inventorySequence)) return;
    state.containers = [...result.containers].sort(compareContainers);
  } catch (error) {
    if (sequence !== refreshSequence) return;
    state.available = false;
    state.containers = [];
    state.error = readableError(error, `Could not connect to ${engineLabel(engine)}.`);
  } finally {
    if (sequence === refreshSequence) {
      state.loading = false;
      await render();
    }
  }
}

async function runContainerOperation(kind: ContainerOperationKind, event: PluginUIActionEvent): Promise<void> {
  const containerID = event.value?.trim() ?? '';
  if (!containerID) return;
  const engine = state.engine;
  const operationState = operations.begin(engine, containerID, kind);
  if (!operationState) return;
  state.error = '';
  state.notice = '';
  state.noticeTone = 'neutral';
  await renderSafely();
  try {
    const request = { engine, container_id: containerID } as const;
    const operation = kind === 'start'
      ? await client.start(request)
      : kind === 'stop'
        ? await client.stop(request)
        : kind === 'restart'
          ? await client.restart(request)
          : await client.remove({ ...request, force: false });
    if (disposed) return;
    const handle: OperationHandle = operation;
    operationHandles.set(operationState.key, { generation: operationState.generation, handle });
    operations.update(operationState.key, operationState.generation, {
      operationID: handle.operation_id,
      phase: 'running',
      message: `${operationLabel(kind)} is running.`,
    });
    await renderSafely();
    await observeContainerOperation(operationState.key, operationState.generation, handle);
  } catch (error) {
    if (operationHandles.has(operationState.key)) return;
    handleSubmissionError(operationState.key, operationState.generation, kind, error);
    await renderSafely();
  }
}

async function observeContainerOperation(key: string, generation: number, handle: OperationHandle): Promise<void> {
  const previous = observationControllers.get(key);
  previous?.controller.abort();
  const controller = new AbortController();
  observationControllers.set(key, { generation, controller });
  try {
    const terminal = await handle.wait({ signal: controller.signal, timeoutMs: 130_000, pollIntervalMs: 500 });
    if (!operations.update(key, generation, {
      phase: 'reconciling',
      message: `${terminalLabel(terminal)} Rechecking the authoritative container state…`,
    })) return;
    await renderSafely();
    await reconcileTerminalOperation(key, generation, terminal);
  } catch (error) {
    if (disposed || controller.signal.aborted) return;
    operations.update(key, generation, {
      phase: 'observation_paused',
      message: `${readableError(error, 'Live operation observation paused.', operations.get(key)?.engine)} Resume observation to reconcile safely.`,
    });
    await render();
  } finally {
    const current = observationControllers.get(key);
    if (current?.generation === generation && current.controller === controller) observationControllers.delete(key);
  }
}

async function reconcileTerminalOperation(
  key: string,
  generation: number,
  terminal: PluginOperationTerminalStatus,
): Promise<void> {
  const current = operations.get(key);
  if (!current || current.generation !== generation) return;
  try {
    const inventorySequence = nextInventorySequence(current.engine);
    const result = await client.list({ engine: current.engine, all: true });
    const latest = operations.current(current.engine, current.containerID);
    if (!latest || latest.generation !== generation) return;
    if (state.engine === current.engine && isCurrentInventorySequence(current.engine, inventorySequence)) {
      state.containers = [...result.containers].sort(compareContainers);
    }
    const message = terminalOutcomeMessage(current.kind, current.containerID, terminal);
    operations.finish(key, generation);
    operationHandles.delete(key);
    if (state.engine === current.engine) {
      state.error = '';
      state.notice = message;
      state.noticeTone = terminal.status === 'completed' || terminal.status === 'canceled' ? 'neutral' : 'error';
    }
  } catch (error) {
    operations.update(key, generation, {
      phase: 'observation_paused',
      message: `${terminalLabel(terminal)} Authoritative reconciliation failed. Resume observation to retry.`,
    });
    if (state.engine === current.engine) {
      state.error = readableError(error, 'The operation finished, but the container state could not be reconciled.', current.engine);
    }
  }
  await renderSafely();
}

async function cancelContainerOperation(event: PluginUIActionEvent): Promise<void> {
  const containerID = event.value?.trim() ?? '';
  const current = operations.current(state.engine, containerID);
  if (!current || current.phase !== 'running') return;
  const registered = operationHandles.get(current.key);
  if (!registered || registered.generation !== current.generation) return;
  operations.update(current.key, current.generation, {
    phase: 'cancel_requested',
    message: 'Cancellation requested. Waiting for the Host to report a terminal status…',
  });
  await renderSafely();
  try {
    await registered.handle.cancel('user requested cancellation');
  } catch (error) {
    const policy = cancellationFailurePolicy(mutationOutcome(error));
    operations.update(current.key, current.generation, {
      phase: policy.phase,
      message: policy.message,
    });
    await renderSafely();
  }
}

async function resumeContainerObservation(event: PluginUIActionEvent): Promise<void> {
  const containerID = event.value?.trim() ?? '';
  const current = operations.current(state.engine, containerID);
  if (!current || current.phase !== 'observation_paused') return;
  const registered = operationHandles.get(current.key);
  if (!registered || registered.generation !== current.generation) return;
  operations.update(current.key, current.generation, { phase: 'running', message: 'Resuming operation observation…' });
  await renderSafely();
  await observeContainerOperation(current.key, current.generation, registered.handle);
}

function handleSubmissionError(
  key: string,
  generation: number,
  kind: ContainerOperationKind,
  error: unknown,
): void {
  const current = operations.get(key);
  if (!current || current.generation !== generation) return;
  const outcome = mutationOutcome(error);
  const policy = submissionFailurePolicy(outcome);
  if (policy.retryAllowed) {
    operations.finish(key, generation);
    if (state.engine === current.engine) {
      state.error = readableError(error, `${operationLabel(kind)} was not submitted. You can try again.`, current.engine);
    }
    return;
  }
  const prefix = outcome === 'committed'
    ? `${operationLabel(kind)} was committed, but its operation handle was not returned.`
    : `${operationLabel(kind)} submission could not be confirmed.`;
  operations.update(key, generation, {
    phase: 'submission_unknown',
    message: `${prefix} Do not repeat the action. Refresh to inspect the authoritative container state.`,
  });
  if (state.engine === current.engine) {
    state.error = `${prefix} The container remains locked against duplicate mutations in this view.`;
  }
}

async function loadLogs(event: PluginUIActionEvent): Promise<void> {
  const containerID = event.value?.trim() ?? '';
  if (!containerID || state.logs.loading) return;
  const engine = state.engine;
  const generation = ++logsGeneration;
  state.logs = { engine, containerID, generation, lines: [], loading: true, error: '' };
  await render();
  try {
    const stream = await client.tailLogs({ engine, container_id: containerID, tail_lines: 200, follow: false });
    for await (const item of stream) {
      if (!isCurrentLogView(engine, containerID, generation)) {
        await stream.cancel('log viewer closed');
        return;
      }
      state.logs.lines.push(item.data.message);
      if (state.logs.lines.length > 500) state.logs.lines.shift();
      await render();
    }
  } catch (error) {
    if (isCurrentLogView(engine, containerID, generation)) {
      state.logs.error = readableError(error, 'Logs are unavailable for this container.', engine);
    }
  } finally {
    if (isCurrentLogView(engine, containerID, generation)) {
      state.logs.loading = false;
      await render();
    }
  }
}

async function closeLogs(): Promise<void> {
  state.logs = { engine: state.engine, containerID: '', generation: ++logsGeneration, lines: [], loading: false, error: '' };
  await render();
}

function render(): Promise<void> {
  if (disposed) return Promise.resolve();
  return bridge.render({
    type: 'element',
    key: 'containers-root',
    tag: 'main',
    attributes: { class: 'containers-app' },
    children: [header(), statusStrip(), content(), state.logs.containerID ? logsPanel() : emptyNode('logs-empty')],
  });
}

function header(): PluginUIVNode {
  return element('app-header', 'header', { class: 'app-header' }, [
    element('brand', 'div', { class: 'brand' }, [
      element('brand-mark', 'span', { class: 'brand-mark', 'aria-hidden': true }, []),
      element('brand-copy', 'div', {}, [
        element('eyebrow', 'p', { class: 'eyebrow' }, [text('eyebrow-text', 'Runtime resources')]),
        element('title', 'h1', {}, [text('title-text', 'Containers')]),
      ]),
    ]),
    element('toolbar', 'div', { class: 'toolbar' }, [
      element('engine-switcher', 'div', { class: 'segmented', role: 'group', 'aria-label': 'Container engine' }, [
        engineButton('docker'),
        engineButton('podman'),
      ]),
      element('refresh', 'button', {
        class: 'button secondary', type: 'button', disabled: state.loading,
        'data-redevplugin-action': 'refresh-containers', 'aria-label': 'Refresh containers',
      }, [text('refresh-text', state.loading ? 'Refreshing…' : 'Refresh')]),
    ]),
  ]);
}

function engineButton(engine: Engine): PluginUIVNode {
  return element(`engine-${engine}`, 'button', {
    type: 'button', value: engine, disabled: state.loading,
    class: state.engine === engine ? 'segment active' : 'segment',
    'aria-pressed': state.engine === engine,
    'data-redevplugin-action': 'select-engine',
  }, [text(`engine-${engine}-text`, engineLabel(engine))]);
}

function statusStrip(): PluginUIVNode {
  const activeOperations = operations.forEngine(state.engine).length;
  const tone = state.error || state.noticeTone === 'error' ? 'error' : state.available ? 'healthy' : 'muted';
  const message = state.error
    || (state.loading ? `Connecting to ${engineLabel(state.engine)}…`
      : state.available ? `${engineLabel(state.engine)} ${state.engineVersion || 'available'}`
        : `${engineLabel(state.engine)} is unavailable`);
  return element('status-strip', 'section', {
    class: `status-strip ${tone}`,
    role: state.error || state.noticeTone === 'error' ? 'alert' : 'status',
  }, [
    element('status-dot', 'span', { class: 'status-dot', 'aria-hidden': true }, []),
    element('status-copy', 'span', {}, [text('status-message', message)]),
    activeOperations > 0
      ? element('active-operations', 'span', { class: 'operation-count', 'aria-live': 'polite' }, [
        text('active-operations-text', `${activeOperations} ${activeOperations === 1 ? 'operation' : 'operations'} active`),
      ])
      : emptyNode('active-operations-empty'),
    state.notice ? element('notice', 'span', { class: `notice ${state.noticeTone}`, 'aria-live': 'polite' }, [text('notice-text', state.notice)]) : emptyNode('notice-empty'),
  ]);
}

function content(): PluginUIVNode {
  const detached = detachedOperations();
  const hasOperations = operations.forEngine(state.engine).length > 0;
  if (state.loading) {
    return hasOperations
      ? element('container-content', 'section', { class: 'container-content' }, [detachedOperations(true), loadingState()])
      : loadingState();
  }
  if (!state.available) {
    return hasOperations
      ? element('container-content', 'section', { class: 'container-content' }, [detached, unavailableState()])
      : unavailableState();
  }
  if (state.containers.length === 0) {
    return !hasOperations
      ? emptyState()
      : element('container-content', 'section', { class: 'container-content' }, [detached, emptyState()]);
  }
  return element('container-content', 'section', { class: 'container-content' }, [
    detached,
    element('content-heading', 'div', { class: 'content-heading' }, [
      element('content-copy', 'div', {}, [
        element('content-title', 'h2', {}, [text('content-title-text', 'All containers')]),
        element('content-subtitle', 'p', {}, [text('content-subtitle-text', `${state.containers.length} resources on ${engineLabel(state.engine)}`)]),
      ]),
    ]),
    element('container-grid', 'div', { class: 'container-grid' }, state.containers.map(containerCard)),
  ]);
}

function detachedOperations(includeVisible = false): PluginUIVNode {
  const visibleContainerIDs = new Set(state.containers.map((container) => container.container_id));
  const detached = operations
    .forEngine(state.engine)
    .filter((operation) => includeVisible || !visibleContainerIDs.has(operation.containerID));
  if (detached.length === 0) return emptyNode('detached-operations-empty');
  const label = includeVisible ? 'Active operations' : 'Operations awaiting reconciliation';
  return element('detached-operations', 'section', { class: 'detached-operations', 'aria-label': label }, [
    element('detached-operations-title', 'h2', {}, [text('detached-operations-title-text', label)]),
    element('detached-operations-list', 'div', { class: 'detached-operations-list' }, detached.map(operationPanel)),
  ]);
}

function containerCard(container: Container): PluginUIVNode {
  const operation = operations.current(state.engine, container.container_id);
  const busy = operation !== undefined;
  const running = container.state === 'running';
  const image = container.image.reference || container.image.digest || 'Unknown image';
  return element(`container-${container.container_id}`, 'article', { class: 'container-card' }, [
    element(`container-${container.container_id}-top`, 'div', { class: 'card-top' }, [
      element(`container-${container.container_id}-icon`, 'span', { class: `container-icon ${running ? 'running' : ''}`, 'aria-hidden': true }, []),
      element(`container-${container.container_id}-identity`, 'div', { class: 'container-identity' }, [
        element(`container-${container.container_id}-name`, 'h3', {}, [text(`container-${container.container_id}-name-text`, container.name || shortID(container.container_id))]),
        element(`container-${container.container_id}-id`, 'code', {}, [text(`container-${container.container_id}-id-text`, shortID(container.container_id))]),
      ]),
      element(`container-${container.container_id}-state`, 'span', { class: `state-pill ${stateClass(container.state)}` }, [text(`container-${container.container_id}-state-text`, container.state)]),
    ]),
    element(`container-${container.container_id}-image`, 'div', { class: 'image-row' }, [
      element(`container-${container.container_id}-image-label`, 'span', {}, [text(`container-${container.container_id}-image-label-text`, 'Image')]),
      element(`container-${container.container_id}-image-value`, 'strong', { title: image }, [text(`container-${container.container_id}-image-value-text`, image)]),
    ]),
    element(`container-${container.container_id}-meta`, 'div', { class: 'meta-row' }, [
      text(`container-${container.container_id}-ports`, portSummary(container)),
      text(`container-${container.container_id}-digest`, container.image.digest_pinned ? 'Digest pinned' : 'Tag reference'),
    ]),
    element(`container-${container.container_id}-actions`, 'div', { class: 'card-actions' }, [
      actionButton(container, running ? 'stop' : 'start', running ? 'Stop' : 'Start', busy),
      actionButton(container, 'restart', 'Restart', busy || !running),
      actionButton(container, 'view-container-logs', 'Logs', false),
      actionButton(container, 'remove', 'Remove', busy || running, 'danger'),
    ]),
    operation ? operationPanel(operation) : emptyNode(`container-${container.container_id}-operation-empty`),
  ]);
}

function operationPanel(operation: ContainerOperationState): PluginUIVNode {
  const canCancel = operation.phase === 'running';
  const canResume = operation.phase === 'observation_paused' && operation.operationID !== '';
  return element(`operation-${operation.key}`, 'section', {
    class: `operation-panel ${operation.phase}`,
    role: operation.phase === 'submission_unknown' ? 'alert' : 'status',
    'aria-live': operation.phase === 'submission_unknown' ? 'assertive' : 'polite',
  }, [
    element(`operation-${operation.key}-copy`, 'div', { class: 'operation-copy' }, [
      element(`operation-${operation.key}-title`, 'strong', {}, [
        text(`operation-${operation.key}-title-text`, `${operationLabel(operation.kind)} · ${operationPhaseLabel(operation.phase)}`),
      ]),
      element(`operation-${operation.key}-message`, 'p', {}, [text(`operation-${operation.key}-message-text`, operation.message)]),
      operation.operationID
        ? element(`operation-${operation.key}-id`, 'code', { title: operation.operationID }, [
          text(`operation-${operation.key}-id-text`, shortID(operation.operationID)),
        ])
        : emptyNode(`operation-${operation.key}-id-empty`),
    ]),
    canCancel ? operationAction(operation, 'cancel-container-operation', 'Cancel') : emptyNode(`operation-${operation.key}-cancel-empty`),
    canResume ? operationAction(operation, 'resume-container-observation', 'Resume') : emptyNode(`operation-${operation.key}-resume-empty`),
  ]);
}

function operationAction(
  operation: ContainerOperationState,
  action: string,
  label: string,
): PluginUIVNode {
  return element(`operation-${operation.key}-${action}`, 'button', {
    class: 'operation-action',
    type: 'button',
    value: operation.containerID,
    'data-redevplugin-action': action,
    'aria-label': `${label} ${operationLabel(operation.kind).toLowerCase()} for ${shortID(operation.containerID)}`,
  }, [text(`operation-${operation.key}-${action}-text`, label)]);
}

function actionButton(container: Container, action: string, label: string, disabled: boolean, tone = ''): PluginUIVNode {
  const platformAction = action === 'view-container-logs' ? action : `${action}-container`;
  return element(`container-${container.container_id}-${action}`, 'button', {
    class: `action-button ${tone}`.trim(), type: 'button', value: container.container_id, disabled,
    'data-redevplugin-action': platformAction,
    'aria-label': `${label} ${container.name || shortID(container.container_id)}`,
  }, [text(`container-${container.container_id}-${action}-text`, label)]);
}

function logsPanel(): PluginUIVNode {
  return element('logs-panel', 'aside', { class: 'logs-panel', 'aria-label': 'Container logs' }, [
    element('logs-header', 'header', { class: 'logs-header' }, [
      element('logs-copy', 'div', {}, [
        element('logs-eyebrow', 'p', { class: 'eyebrow' }, [text('logs-eyebrow-text', 'Latest output')]),
        element('logs-title', 'h2', {}, [text('logs-title-text', shortID(state.logs.containerID))]),
      ]),
      element('logs-close', 'button', {
        class: 'close-button', type: 'button', 'data-redevplugin-action': 'close-container-logs', 'aria-label': 'Close logs',
      }, [text('logs-close-text', 'Close')]),
    ]),
    element('logs-body', 'pre', { class: 'logs-body', 'aria-live': 'polite' }, [
      text('logs-body-text', state.logs.error || (state.logs.lines.length > 0 ? state.logs.lines.join('\n') : state.logs.loading ? 'Loading logs…' : 'No log lines returned.')),
    ]),
  ]);
}

function loadingState(): PluginUIVNode {
  return element('loading-state', 'section', { class: 'center-state' }, [
    element('loading-visual', 'div', { class: 'state-visual loading', 'aria-hidden': true }, []),
    element('loading-title', 'h2', {}, [text('loading-title-text', 'Loading container resources')]),
    element('loading-copy', 'p', {}, [text('loading-copy-text', 'Reading the current engine state through the signed Redeven capability.')]),
  ]);
}

function unavailableState(): PluginUIVNode {
  return element('unavailable-state', 'section', { class: 'center-state' }, [
    element('unavailable-visual', 'div', { class: 'state-visual unavailable', 'aria-hidden': true }, []),
    element('unavailable-title', 'h2', {}, [text('unavailable-title-text', `${engineLabel(state.engine)} is unavailable`)]),
    element('unavailable-copy', 'p', {}, [text('unavailable-copy-text', 'Start the engine or choose another runtime, then refresh this view.')]),
  ]);
}

function emptyState(): PluginUIVNode {
  return element('empty-state', 'section', { class: 'center-state' }, [
    element('empty-visual', 'div', { class: 'state-visual empty', 'aria-hidden': true }, []),
    element('empty-title', 'h2', {}, [text('empty-title-text', 'No containers yet')]),
    element('empty-copy', 'p', {}, [text('empty-copy-text', `No running or stopped resources were reported by ${engineLabel(state.engine)}.`)]),
  ]);
}

function readableError(error: unknown, fallback: string, engine: Engine = state.engine): string {
  if (isRedevenContainerResourcesBusinessError(error)) {
    const code = error.details.business_error_code;
    if (code === 'CONTAINER_ENGINE_UNAVAILABLE') return `${engineLabel(engine)} is unavailable.`;
    if (code === 'CONTAINER_NOT_FOUND') return 'The container no longer exists. Refresh to reconcile the list.';
    if (code === 'CONTAINER_LOGS_UNAVAILABLE') return 'Logs are unavailable for this container.';
  }
  return fallback;
}

function compareContainers(left: Container, right: Container): number {
  if (left.state === 'running' && right.state !== 'running') return -1;
  if (right.state === 'running' && left.state !== 'running') return 1;
  return (left.name || left.container_id).localeCompare(right.name || right.container_id);
}

function stateClass(value: Container['state']): string {
  return value === 'running' ? 'running' : value === 'exited' || value === 'stopped' ? 'stopped' : 'neutral';
}

function portSummary(container: Container): string {
  const ports = container.ports ?? [];
  if (ports.length === 0) return 'No published ports';
  const first = ports[0];
  const suffix = ports.length > 1 ? ` +${ports.length - 1}` : '';
  return `${first.host_port ? `${first.host_port}:` : ''}${first.port}/${first.protocol || 'tcp'}${suffix}`;
}

function terminalLabel(terminal: PluginOperationTerminalStatus): string {
  switch (terminal.status) {
    case 'completed': return 'The operation completed.';
    case 'failed': return `The operation failed (${terminal.snapshot.failure_code}).`;
    case 'canceled': return 'The Host confirmed cancellation.';
    case 'orphaned_after_disable': return 'The operation was orphaned after the plugin was disabled.';
    case 'orphaned_after_uninstall': return 'The operation was orphaned after the plugin was uninstalled.';
  }
}

function terminalOutcomeMessage(
  kind: ContainerOperationKind,
  containerID: string,
  terminal: PluginOperationTerminalStatus,
): string {
  const target = shortID(containerID);
  switch (terminal.status) {
    case 'completed': return `${operationLabel(kind)} completed for ${target}; authoritative state reconciled.`;
    case 'failed': return `${operationLabel(kind)} failed for ${target}; authoritative state reconciled.`;
    case 'canceled': return `${operationLabel(kind)} was canceled for ${target}; authoritative state reconciled.`;
    case 'orphaned_after_disable': return `${operationLabel(kind)} was orphaned after disable; authoritative state reconciled.`;
    case 'orphaned_after_uninstall': return `${operationLabel(kind)} was orphaned after uninstall; authoritative state reconciled.`;
  }
}

function operationPhaseLabel(phase: ContainerOperationState['phase']): string {
  switch (phase) {
    case 'submitting': return 'Submitting';
    case 'running': return 'Running';
    case 'cancel_requested': return 'Cancel requested';
    case 'cancel_outcome_unknown': return 'Cancellation uncertain';
    case 'reconciling': return 'Reconciling';
    case 'observation_paused': return 'Observation paused';
    case 'submission_unknown': return 'Submission uncertain';
  }
}

function nextInventorySequence(engine: Engine): number {
  const sequence = (inventorySequences.get(engine) ?? 0) + 1;
  inventorySequences.set(engine, sequence);
  return sequence;
}

function isCurrentInventorySequence(engine: Engine, sequence: number): boolean {
  return inventorySequences.get(engine) === sequence;
}

function isCurrentLogView(engine: Engine, containerID: string, generation: number): boolean {
  return state.logs.engine === engine
    && state.logs.containerID === containerID
    && state.logs.generation === generation;
}

async function renderSafely(): Promise<void> {
  try {
    await render();
  } catch {
    // Observation remains authoritative even if this transient UI projection fails.
  }
}

function engineLabel(engine: Engine): string {
  return engine === 'docker' ? 'Docker' : 'Podman';
}

function shortID(value: string): string {
  return value.length > 16 ? value.slice(0, 12) : value;
}

function element(key: string, tag: PluginUIElementVNode['tag'], attributes: Record<string, string | boolean> = {}, children: PluginUIVNode[] = []): PluginUIVNode {
  return { type: 'element', key, tag, attributes, children };
}

function text(key: string, value: string): PluginUIVNode {
  return { type: 'text', key, text: value };
}

function emptyNode(key: string): PluginUIVNode {
  return text(key, '');
}
