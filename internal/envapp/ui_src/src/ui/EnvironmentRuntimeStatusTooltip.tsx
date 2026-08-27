import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { useProtocol } from '@floegence/floe-webapp-protocol';

import { useI18n } from './i18n';
import { Tooltip } from './primitives/Tooltip';
import { useRedevenRpc, type SysMonitorSnapshot, type SysPingResponse } from './protocol/redeven_v1';

export type EnvSessionSource =
  | 'local_runtime'
  | 'provider_environment'
  | 'ssh_environment'
  | 'external_local_ui'
  | 'runtime_gateway'
  | 'region_sandbox';

export type EnvSessionIdentity = Readonly<{
  source: EnvSessionSource;
  displayName: string;
  displayID: string;
}>;

export type EnvironmentRuntimeConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

type EnvironmentRuntimeStatusTooltipProps = Readonly<{
  identity: EnvSessionIdentity;
  connectionStatus: EnvironmentRuntimeConnectionStatus;
  connectionLabel?: string;
  canRead: boolean | null;
  mobile: boolean;
}>;

type EnvironmentMetricSample = Readonly<{
  cpuPercent: number;
  memoryBytes: number;
  sampledAtMs: number;
}>;

const METRICS_REFRESH_INTERVAL_MS = 2_000;
const METRIC_HISTORY_LIMIT = 18;
const SPARKLINE_WIDTH = 120;
const SPARKLINE_HEIGHT = 28;
const SPARKLINE_PADDING = 2;

type SparklineGeometry = Readonly<{
  linePath: string;
  areaPath: string;
  lastX: number;
  lastY: number;
}>;

function sparklineGeometry(values: readonly number[]): SparklineGeometry | null {
  const samples = values.filter(Number.isFinite);
  if (samples.length === 0) return null;

  const minimum = Math.min(...samples);
  const maximum = Math.max(...samples);
  const spread = maximum - minimum;
  const rangePadding = spread > 0
    ? spread * 0.18
    : Math.max(Math.abs(maximum) * 0.08, 1);
  const lowerBound = minimum - rangePadding;
  const upperBound = maximum + rangePadding;
  const range = Math.max(upperBound - lowerBound, 1);
  const drawableHeight = SPARKLINE_HEIGHT - (SPARKLINE_PADDING * 2);

  const pointFor = (value: number, index: number, count: number) => ({
    x: count === 1 ? SPARKLINE_WIDTH : (index / (count - 1)) * SPARKLINE_WIDTH,
    y: SPARKLINE_PADDING + ((upperBound - value) / range) * drawableHeight,
  });
  const points = samples.length === 1
    ? [{ ...pointFor(samples[0], 0, 1), x: 0 }, pointFor(samples[0], 0, 1)]
    : samples.map((value, index) => pointFor(value, index, samples.length));
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];

  return {
    linePath,
    areaPath: `${linePath} L${last.x.toFixed(2)},${SPARKLINE_HEIGHT} L${first.x.toFixed(2)},${SPARKLINE_HEIGHT} Z`,
    lastX: last.x,
    lastY: last.y,
  };
}

function sourceAccentClass(source: EnvSessionSource): string {
  if (source === 'local_runtime') return 'text-primary';
  if (source === 'ssh_environment') return 'text-info';
  return 'text-accent';
}

function sourceBadgeClass(source: EnvSessionSource): string {
  if (source === 'local_runtime') return 'bg-primary/10 text-primary';
  if (source === 'ssh_environment') return 'bg-info/10 text-info';
  return 'bg-accent/10 text-accent';
}

function statusClass(status: EnvironmentRuntimeConnectionStatus): string {
  switch (status) {
    case 'connected': return 'environment-runtime-status-connected';
    case 'connecting': return 'environment-runtime-status-connecting';
    case 'error': return 'environment-runtime-status-error';
    default: return 'environment-runtime-status-disconnected';
  }
}

function formatMemoryBytes(
  bytes: number,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${formatNumber(size, { maximumFractionDigits: unitIndex === 0 ? 0 : 1 })} ${units[unitIndex]}`;
}

function MetricSparkline(props: Readonly<{ values: readonly number[]; tone: 'cpu' | 'memory'; loading: boolean }>) {
  const geometry = createMemo(() => sparklineGeometry(props.values));
  return (
    <svg
      class={`environment-runtime-sparkline environment-runtime-sparkline-${props.tone}`}
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      data-environment-sparkline={props.tone}
      data-sample-count={props.values.length}
    >
      <path class="environment-runtime-sparkline-guide" d={`M0,${SPARKLINE_HEIGHT - 1} L${SPARKLINE_WIDTH},${SPARKLINE_HEIGHT - 1}`} />
      <Show
        when={geometry()}
        fallback={(
          <rect
            class="environment-runtime-sparkline-skeleton"
            x="0"
            y="5"
            width={SPARKLINE_WIDTH}
            height="17"
            rx="4"
            data-loading={props.loading ? 'true' : 'false'}
          />
        )}
      >
        {(current) => (
          <>
            <path class="environment-runtime-sparkline-area" d={current().areaPath} />
            <path class="environment-runtime-sparkline-line" d={current().linePath} />
            <circle class="environment-runtime-sparkline-point" cx={current().lastX} cy={current().lastY} r="1.6" />
          </>
        )}
      </Show>
    </svg>
  );
}

function environmentTooltipViewportMargin() {
  const margin = 8;
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { top: margin, right: margin, bottom: margin, left: margin };
  }

  const activityBar = document.querySelector<HTMLElement>('[data-floe-shell-slot="activity-bar"]');
  const activityBarRect = activityBar?.getBoundingClientRect();
  const viewportLeft = window.visualViewport?.offsetLeft ?? 0;
  const activityBarRight = activityBarRect && activityBarRect.width > 0
    ? activityBarRect.right - viewportLeft
    : 0;

  return {
    top: margin,
    right: margin,
    bottom: margin,
    left: Math.max(margin, activityBarRight + margin),
  };
}

function EnvironmentSourceIcon(props: Readonly<{ source: EnvSessionSource }>) {
  return (
    <span class={`shrink-0 w-3.5 h-3.5 flex items-center justify-center ${sourceAccentClass(props.source)}`}>
      {props.source === 'ssh_environment' ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
      ) : props.source !== 'local_runtime' ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      )}
    </span>
  );
}

export function EnvironmentRuntimeStatusTooltip(props: EnvironmentRuntimeStatusTooltipProps) {
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const i18n = useI18n();
  const [tooltipOpen, setTooltipOpen] = createSignal(false);
  const [ping, setPing] = createSignal<SysPingResponse | null>(null);
  const [metricHistory, setMetricHistory] = createSignal<EnvironmentMetricSample[]>([]);
  const [pingLoading, setPingLoading] = createSignal(false);
  const [metricsLoading, setMetricsLoading] = createSignal(false);
  const [clock, setClock] = createSignal(Date.now());
  const [connectionGeneration, setConnectionGeneration] = createSignal(0);

  let requestGeneration = 0;
  let pendingPing: { connection: number; promise: Promise<SysPingResponse> } | null = null;
  let pendingMetrics: { connection: number; promise: Promise<SysMonitorSnapshot> } | null = null;

  const connected = () => props.connectionStatus === 'connected' && protocol.status() === 'connected';
  const connectionKey = () => [
    protocol.status(),
    props.connectionStatus,
    props.identity.source,
    props.identity.displayID,
  ].join(':');
  let previousConnectionKey = connectionKey();
  const metrics = () => metricHistory().at(-1) ?? null;
  const cpuHistory = createMemo(() => metricHistory().map((sample) => sample.cpuPercent));
  const memoryHistory = createMemo(() => metricHistory().map((sample) => sample.memoryBytes));

  const sourceLabel = createMemo(() => {
    switch (props.identity.source) {
      case 'ssh_environment': return i18n.t('shell.status.envTypeSSH');
      case 'provider_environment': return i18n.t('shell.status.envTypeProvider');
      case 'external_local_ui':
      case 'runtime_gateway':
      case 'region_sandbox': return i18n.t('shell.status.envTypeRemote');
      default: return i18n.t('shell.status.envTypeLocal');
    }
  });

  const connectionLabel = createMemo(() => {
    if (props.connectionLabel) return props.connectionLabel;
    switch (props.connectionStatus) {
      case 'connected': return i18n.t('shell.framework.connected');
      case 'connecting': return i18n.t('shell.framework.connecting');
      case 'error': return i18n.t('shell.framework.error');
      default: return i18n.t('shell.framework.disconnected');
    }
  });

  const runtimeVersion = () => {
    const snapshot = ping();
    return snapshot?.runtimeService?.runtimeVersion?.trim() || snapshot?.version?.trim() || '';
  };

  const startedAt = () => {
    const value = Number(ping()?.processStartedAtMs ?? Number.NaN);
    if (!Number.isFinite(value) || value <= 0) return '';
    void clock();
    return `${i18n.formatDateTime(value, { dateStyle: 'medium', timeStyle: 'short' })} · ${i18n.formatRelativeTime(value)}`;
  };

  const cpuLabel = () => {
    const value = metrics()?.cpuPercent;
    if (typeof value !== 'number') return '';
    return `${i18n.formatNumber(Math.max(0, Math.min(100, value)), { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
  };

  const memoryLabel = () => {
    const value = metrics()?.memoryBytes;
    if (typeof value !== 'number') return '';
    return formatMemoryBytes(value, i18n.formatNumber);
  };

  const requestPing = (generation: number, connection: number) => {
    setPingLoading(true);
    const activeRequest = pendingPing?.connection === connection
      ? pendingPing.promise
      : rpc.sys.ping();
    pendingPing = { connection, promise: activeRequest };
    void activeRequest.then((value) => {
      if (generation !== requestGeneration) return;
      setPing(value);
    }).catch(() => undefined).finally(() => {
      if (pendingPing?.promise === activeRequest) pendingPing = null;
      if (generation === requestGeneration) setPingLoading(false);
    });
  };

  const requestMetrics = (generation: number, connection: number) => {
    if (props.canRead === false) {
      setMetricsLoading(false);
      return;
    }
    if (props.canRead === null) {
      setMetricsLoading(true);
      return;
    }

    setMetricsLoading(true);
    const activeRequest = pendingMetrics?.connection === connection
      ? pendingMetrics.promise
      : rpc.monitor.getSysMonitor();
    pendingMetrics = { connection, promise: activeRequest };
    void activeRequest.then((value) => {
      if (generation !== requestGeneration) return;
      const cpuPercent = Number(value.cpuUsage);
      const memoryTotalBytes = Number(value.memoryTotalBytes);
      const memoryUsedBytes = Number(value.memoryUsedBytes);
      const sampledAtMs = Number(value.timestampMs);
      if (
        !Number.isFinite(cpuPercent)
        || !Number.isFinite(memoryTotalBytes)
        || memoryTotalBytes <= 0
        || !Number.isFinite(memoryUsedBytes)
        || memoryUsedBytes < 0
        || !Number.isFinite(sampledAtMs)
        || sampledAtMs <= 0
      ) return;
      const sample: EnvironmentMetricSample = {
        cpuPercent: Math.max(0, Math.min(100, cpuPercent)),
        memoryBytes: Math.min(memoryUsedBytes, memoryTotalBytes),
        sampledAtMs,
      };
      setMetricHistory((current) => {
        const last = current.at(-1);
        if (last?.sampledAtMs === sample.sampledAtMs) {
          return [...current.slice(0, -1), sample];
        }
        return [...current, sample].slice(-METRIC_HISTORY_LIMIT);
      });
    }).catch(() => undefined).finally(() => {
      if (pendingMetrics?.promise === activeRequest) pendingMetrics = null;
      if (generation === requestGeneration) setMetricsLoading(false);
    });
  };

  createEffect(() => {
    const currentConnectionKey = connectionKey();
    if (currentConnectionKey === previousConnectionKey) return;
    previousConnectionKey = currentConnectionKey;
    setConnectionGeneration((current) => current + 1);
    pendingPing = null;
    pendingMetrics = null;
    setPing(null);
    setMetricHistory([]);
    setPingLoading(false);
    setMetricsLoading(false);
  });

  createEffect(() => {
    const active = tooltipOpen() && !props.mobile && connected();
    const canRead = props.canRead;
    const connection = connectionGeneration();
    const generation = ++requestGeneration;
    let interval: ReturnType<typeof setInterval> | undefined;

    if (canRead === false) {
      pendingMetrics = null;
      setMetricHistory([]);
    }

    if (active) {
      setClock(Date.now());
      requestPing(generation, connection);
      requestMetrics(generation, connection);
      if (canRead !== false) {
        interval = setInterval(() => {
          setClock(Date.now());
          requestMetrics(generation, connection);
        }, METRICS_REFRESH_INTERVAL_MS);
      }
    } else if (!connected()) {
      setPing(null);
      setMetricHistory([]);
      setPingLoading(false);
      setMetricsLoading(false);
    }
    onCleanup(() => {
      if (interval) clearInterval(interval);
    });
  });

  onCleanup(() => {
    requestGeneration += 1;
    pendingPing = null;
    pendingMetrics = null;
  });

  const tooltipContent = (
    <div class="environment-runtime-tooltip" data-environment-runtime-tooltip>
      <div class="environment-runtime-tooltip-header">
        <div class="min-w-0">
          <div class="environment-runtime-tooltip-name" title={props.identity.displayName}>{props.identity.displayName}</div>
          <div class="environment-runtime-tooltip-context">
            <span>{sourceLabel()}</span>
            <span aria-hidden="true">·</span>
            <span>{i18n.t('shell.runtimeStatus.runtime')}</span>
            <span class="environment-runtime-tooltip-version" data-runtime-version>
              <Show
                when={runtimeVersion()}
                fallback={<span class="environment-runtime-value-skeleton environment-runtime-version-skeleton" data-loading={pingLoading() ? 'true' : 'false'} aria-hidden="true" />}
              >{(version) => version()}</Show>
            </span>
          </div>
        </div>
        <div class={`environment-runtime-tooltip-status ${statusClass(props.connectionStatus)}`}>
          <span class="environment-runtime-tooltip-status-dot" aria-hidden="true" />
          <span>{connectionLabel()}</span>
        </div>
      </div>

      <div class="environment-runtime-tooltip-metrics">
        <section class="environment-runtime-tooltip-metric">
          <div class="environment-runtime-tooltip-metric-heading">
            <span>{i18n.t('shell.runtimeStatus.cpu')}</span>
            <strong data-environment-cpu>
              <Show
                when={cpuLabel()}
                fallback={<span class="environment-runtime-value-skeleton environment-runtime-metric-value-skeleton" data-loading={metricsLoading() ? 'true' : 'false'} aria-hidden="true" />}
              >{(value) => value()}</Show>
            </strong>
          </div>
          <MetricSparkline values={cpuHistory()} tone="cpu" loading={metricsLoading()} />
        </section>
        <section class="environment-runtime-tooltip-metric">
          <div class="environment-runtime-tooltip-metric-heading">
            <span>{i18n.t('shell.runtimeStatus.memory')}</span>
            <strong data-environment-memory>
              <Show
                when={memoryLabel()}
                fallback={<span class="environment-runtime-value-skeleton environment-runtime-metric-value-skeleton" data-loading={metricsLoading() ? 'true' : 'false'} aria-hidden="true" />}
              >{(value) => value()}</Show>
            </strong>
          </div>
          <MetricSparkline values={memoryHistory()} tone="memory" loading={metricsLoading()} />
        </section>
      </div>

      <div class="environment-runtime-tooltip-started">
        <span>{i18n.t('shell.runtimeStatus.started')}</span>
        <span data-runtime-started>
          <Show
            when={startedAt()}
            fallback={<span class="environment-runtime-value-skeleton environment-runtime-started-skeleton" data-loading={pingLoading() ? 'true' : 'false'} aria-hidden="true" />}
          >{(value) => value()}</Show>
        </span>
      </div>
    </div>
  );

  return (
    <Tooltip
      content={tooltipContent}
      placement="top"
      delay={180}
      disabled={props.mobile}
      dismissOnTriggerClick={false}
      viewportMargin={environmentTooltipViewportMargin}
      onOpenChange={setTooltipOpen}
      anchorClass="flower-activity-env-runtime-anchor"
      class="environment-runtime-tooltip-layer"
    >
      <div
        class="flower-activity-env-runtime-trigger"
        data-environment-runtime-trigger
        tabindex={props.mobile ? undefined : 0}
        aria-label={props.mobile ? undefined : i18n.t('shell.runtimeStatus.triggerLabel', { environment: props.identity.displayName })}
      >
        <div class="flower-activity-env-identity">
          <EnvironmentSourceIcon source={props.identity.source} />
          <span class="truncate text-[11px] font-medium text-foreground">{props.identity.displayName}</span>
          <span class="flower-activity-env-secondary w-px h-3.5 bg-border shrink-0" />
          <span class="flower-activity-env-secondary truncate text-[11px] text-muted-foreground">
            {props.identity.displayID || i18n.t('shell.status.missingEnvId')}
          </span>
        </div>
        <span class={`flower-activity-env-type text-[10px] px-1.5 py-0.5 rounded-full font-semibold leading-tight shrink-0 whitespace-nowrap ${sourceBadgeClass(props.identity.source)}`}>
          {sourceLabel()}
        </span>
      </div>
    </Tooltip>
  );
}
