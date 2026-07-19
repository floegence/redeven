import {
  PluginBridgeClient,
  type PluginUIActionEvent,
  type PluginUIElementVNode,
  type PluginUIVNode,
} from '@floegence/redevplugin-ui/plugin';
import {
  RedevenContainerResourcesClient,
  isRedevenContainerResourcesBusinessError,
  type ContainersListResponse,
} from '../../../../spec/redevplugin/official-containers-capability/capabilities/redeven.container_resources.v2/v2.0.0/redeven.container_resources.v2.client';

type Engine = 'docker' | 'podman';
type Container = ContainersListResponse['containers'][number];

type DashboardState = {
  engine: Engine;
  engineVersion: string;
  available: boolean;
  loading: boolean;
  busyContainerID: string;
  containers: Container[];
  notice: string;
  error: string;
  logs: { containerID: string; lines: string[]; loading: boolean; error: string };
};

const bridge = new PluginBridgeClient({ timeoutMs: 30_000 });
const client = new RedevenContainerResourcesClient(bridge);
const state: DashboardState = {
  engine: 'docker',
  engineVersion: '',
  available: false,
  loading: true,
  busyContainerID: '',
  containers: [],
  notice: '',
  error: '',
  logs: { containerID: '', lines: [], loading: false, error: '' },
};

let disposed = false;
let refreshSequence = 0;

bridge.onAction('refresh-containers', () => void refresh());
bridge.onAction('select-engine', (event) => void selectEngine(event));
bridge.onAction('start-container', (event) => void runContainerOperation('start', event));
bridge.onAction('stop-container', (event) => void runContainerOperation('stop', event));
bridge.onAction('restart-container', (event) => void runContainerOperation('restart', event));
bridge.onAction('remove-container', (event) => void runContainerOperation('remove', event));
bridge.onAction('view-container-logs', (event) => void loadLogs(event));
bridge.onAction('close-container-logs', () => void closeLogs());
bridge.onLifecycle((event) => {
  if (event.type === 'dispose') {
    disposed = true;
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
  state.logs = { containerID: '', lines: [], loading: false, error: '' };
  await refresh();
}

async function refresh(): Promise<void> {
  const sequence = ++refreshSequence;
  state.loading = true;
  state.error = '';
  state.notice = '';
  await render();
  try {
    const status = await client.status({ engine: state.engine });
    if (sequence !== refreshSequence) return;
    state.available = status.available;
    state.engineVersion = status.engine_version ?? '';
    if (!status.available) {
      state.containers = [];
      return;
    }
    const result = await client.list({ engine: state.engine, all: true });
    if (sequence !== refreshSequence) return;
    state.containers = [...result.containers].sort(compareContainers);
  } catch (error) {
    if (sequence !== refreshSequence) return;
    state.available = false;
    state.containers = [];
    state.error = readableError(error, `Could not connect to ${engineLabel(state.engine)}.`);
  } finally {
    if (sequence === refreshSequence) {
      state.loading = false;
      await render();
    }
  }
}

async function runContainerOperation(kind: 'start' | 'stop' | 'restart' | 'remove', event: PluginUIActionEvent): Promise<void> {
  const containerID = event.value?.trim() ?? '';
  if (!containerID || state.busyContainerID) return;
  state.busyContainerID = containerID;
  state.error = '';
  state.notice = '';
  await render();
  try {
    const request = { engine: state.engine, container_id: containerID } as const;
    const operation = kind === 'start'
      ? await client.start(request)
      : kind === 'stop'
        ? await client.stop(request)
        : kind === 'restart'
          ? await client.restart(request)
          : await client.remove({ ...request, force: false });
    state.notice = `${operationLabel(kind)} was accepted. Refresh to reconcile the current container state.`;
  } catch (error) {
    state.error = readableError(error, `${operationLabel(kind)} could not be submitted.`);
  } finally {
    state.busyContainerID = '';
    await render();
  }
}

async function loadLogs(event: PluginUIActionEvent): Promise<void> {
  const containerID = event.value?.trim() ?? '';
  if (!containerID || state.logs.loading) return;
  state.logs = { containerID, lines: [], loading: true, error: '' };
  await render();
  try {
    const stream = await client.tailLogs({ engine: state.engine, container_id: containerID, tail_lines: 200, follow: false });
    for await (const item of stream) {
      if (state.logs.containerID !== containerID) {
        await stream.cancel('log viewer closed');
        return;
      }
      state.logs.lines.push(item.data.message);
      if (state.logs.lines.length > 500) state.logs.lines.shift();
      await render();
    }
  } catch (error) {
    if (state.logs.containerID === containerID) {
      state.logs.error = readableError(error, 'Logs are unavailable for this container.');
    }
  } finally {
    if (state.logs.containerID === containerID) {
      state.logs.loading = false;
      await render();
    }
  }
}

async function closeLogs(): Promise<void> {
  state.logs = { containerID: '', lines: [], loading: false, error: '' };
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
  const tone = state.error ? 'error' : state.available ? 'healthy' : 'muted';
  const message = state.error
    || (state.loading ? `Connecting to ${engineLabel(state.engine)}…`
      : state.available ? `${engineLabel(state.engine)} ${state.engineVersion || 'available'}`
        : `${engineLabel(state.engine)} is unavailable`);
  return element('status-strip', 'section', { class: `status-strip ${tone}`, role: 'status' }, [
    element('status-dot', 'span', { class: 'status-dot', 'aria-hidden': true }, []),
    element('status-copy', 'span', {}, [text('status-message', message)]),
    state.notice ? element('notice', 'span', { class: 'notice' }, [text('notice-text', state.notice)]) : emptyNode('notice-empty'),
  ]);
}

function content(): PluginUIVNode {
  if (state.loading) return loadingState();
  if (!state.available) return unavailableState();
  if (state.containers.length === 0) return emptyState();
  return element('container-content', 'section', { class: 'container-content' }, [
    element('content-heading', 'div', { class: 'content-heading' }, [
      element('content-copy', 'div', {}, [
        element('content-title', 'h2', {}, [text('content-title-text', 'All containers')]),
        element('content-subtitle', 'p', {}, [text('content-subtitle-text', `${state.containers.length} resources on ${engineLabel(state.engine)}`)]),
      ]),
    ]),
    element('container-grid', 'div', { class: 'container-grid' }, state.containers.map(containerCard)),
  ]);
}

function containerCard(container: Container): PluginUIVNode {
  const busy = state.busyContainerID === container.container_id;
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
      actionButton(container, 'view-container-logs', 'Logs', busy),
      actionButton(container, 'remove', 'Remove', busy || running, 'danger'),
    ]),
  ]);
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

function readableError(error: unknown, fallback: string): string {
  if (isRedevenContainerResourcesBusinessError(error)) {
    const code = error.details.business_error_code;
    if (code === 'CONTAINER_ENGINE_UNAVAILABLE') return `${engineLabel(state.engine)} is unavailable.`;
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

function operationLabel(kind: 'start' | 'stop' | 'restart' | 'remove'): string {
  return `${kind[0].toUpperCase()}${kind.slice(1)} request`;
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
