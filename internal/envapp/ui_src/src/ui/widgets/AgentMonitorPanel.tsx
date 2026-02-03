import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { LoadingOverlay, MonitoringChart, Panel, PanelContent } from '@floegence/floe-webapp-core';
import { useProtocol, useRpc, type SysMonitorProcessInfo, type SysMonitorSnapshot, type SysMonitorSortBy } from '@floegence/floe-webapp-protocol';

export type AgentMonitorPanelVariant = 'page' | 'deck';

export interface AgentMonitorPanelProps {
  variant?: AgentMonitorPanelVariant;
}

type chart_sample = {
  ts: number;
  cpu: number;
  cpuCores: number;
  netIn: number;
  netOut: number;
};

function formatBytes(bytes: number): string {
  const b = Number(bytes ?? 0);
  if (!Number.isFinite(b) || b <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = b;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const rounded = idx === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[idx]}`;
}

function formatSpeed(bytesPerSecond: number): string {
  const bps = Number(bytesPerSecond ?? 0);
  if (!Number.isFinite(bps) || bps <= 0) return '0 B/s';

  const units = ['B/s', 'kB/s', 'MB/s', 'GB/s'];
  let value = bps;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const rounded = idx === 0 ? Math.round(value) : Math.round(value * 100) / 100;
  return `${rounded} ${units[idx]}`;
}

function formatTimeLabel(ts: number): string {
  const d = new Date(Number(ts ?? 0));
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function AgentMonitorPanel(props: AgentMonitorPanelProps) {
  const protocol = useProtocol();
  const rpc = useRpc();

  const [sortBy, setSortBy] = createSignal<SysMonitorSortBy>('cpu');
  const [data, setData] = createSignal<SysMonitorSnapshot | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);

  const [sample, setSample] = createSignal<chart_sample | null>(null);
  const [sampleSeq, setSampleSeq] = createSignal(0);
  const [chartToken, setChartToken] = createSignal(0);

  // Sort client-side as a safety net in case the agent-side ordering changes.
  const processes = createMemo<SysMonitorProcessInfo[]>(() => {
    const list = data()?.processes ?? [];
    const copied = [...list];
    const mode = sortBy();
    copied.sort((a, b) => {
      const ac = Number(a?.cpuPercent ?? 0);
      const bc = Number(b?.cpuPercent ?? 0);
      const am = Number(a?.memoryBytes ?? 0);
      const bm = Number(b?.memoryBytes ?? 0);
      return mode === 'memory' ? (bm - am) : (bc - ac);
    });
    return copied;
  });

  const isConnected = () => protocol.status() === 'connected' && !!protocol.client();

  const POLL_MS = 2000;
  const CHART_RESET_THRESHOLD_MS = 30_000;

  let pollTimer: number | undefined;
  let reqSeq = 0;
  let lastSampleTs: number | null = null;

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
    reqSeq += 1;
  };

  const fetchOnce = async (opts: { silent?: boolean } = {}) => {
    const seq = ++reqSeq;
    if (!opts.silent) setLoading(true);
    setError(null);

    try {
      const resp = await rpc.monitor.getSysMonitor({ sortBy: sortBy() });
      if (seq !== reqSeq) return;

      const ts = Number(resp.timestampMs ?? 0);
      const prevTs = lastSampleTs;
      lastSampleTs = ts;

      if (prevTs !== null) {
        const gap = ts - prevTs;
        if (gap > CHART_RESET_THRESHOLD_MS || gap < 0) {
          setChartToken((v) => v + 1);
        }
      }

      setData(resp);
      setSample({
        ts,
        cpu: Math.max(0, Math.min(100, Number(resp.cpuUsage ?? 0))),
        cpuCores: Number(resp.cpuCores ?? 0),
        netIn: Math.max(0, Number(resp.networkSpeedReceived ?? 0)),
        netOut: Math.max(0, Number(resp.networkSpeedSent ?? 0)),
      });
      setSampleSeq((v) => v + 1);
    } catch (e) {
      if (seq !== reqSeq) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === reqSeq) setLoading(false);
    }
  };

  const startPolling = () => {
    stopPolling();
    if (!isConnected()) return;

    untrack(() => void fetchOnce({ silent: false }));

    pollTimer = window.setInterval(() => {
      void fetchOnce({ silent: true });
    }, POLL_MS);
  };

  createEffect(() => {
    const connected = isConnected();
    const _sortBy = sortBy();

    if (!connected) {
      stopPolling();
      return;
    }

    setChartToken((v) => v + 1);
    startPolling();
  });

  onCleanup(() => stopPolling());

  let lastCpuSeq = 0;
  const cpuOnUpdate = () => {
    const seq = sampleSeq();
    if (seq === lastCpuSeq) return null;
    const s = sample();
    if (!s) return null;
    lastCpuSeq = seq;
    return { values: [s.cpu], label: formatTimeLabel(s.ts) };
  };

  let lastNetSeq = 0;
  const netOnUpdate = () => {
    const seq = sampleSeq();
    if (seq === lastNetSeq) return null;
    const s = sample();
    if (!s) return null;
    lastNetSeq = seq;
    return { values: [s.netIn, s.netOut], label: formatTimeLabel(s.ts) };
  };

  const cpuSeries = [{ name: 'CPU Usage', data: [] }];
  const networkSeries = [
    { name: 'Download', data: [] },
    { name: 'Upload', data: [] },
  ];

  const formatPercent = (value: number) => `${Number(value ?? 0).toFixed(2).replace(/\.?0+$/, '')}%`;

  const containerClass = () => (
    props.variant === 'deck'
      ? 'h-full min-h-0 overflow-auto p-2'
      : 'h-full min-h-0 overflow-auto p-3'
  );

  const cpuSummary = () => {
    const s = sample();
    if (!s) return '';
    const cpu = Number.isFinite(s.cpu) ? s.cpu : 0;
    const cores = Number.isFinite(s.cpuCores) ? s.cpuCores : 0;
    return `${cpu.toFixed(1)}% · ${cores} cores`;
  };

  const netSummary = () => {
    const s = sample();
    if (!s) return '';
    return `↓${formatSpeed(s.netIn)} · ↑${formatSpeed(s.netOut)}`;
  };

  const activeSortClass = 'bg-primary/10 text-primary';
  const inactiveSortClass = 'text-muted-foreground hover:text-foreground hover:bg-muted/50';

  return (
    <div class={containerClass()}>
      <div class="max-w-7xl mx-auto space-y-3 h-full flex flex-col">
        <Show when={error()}>
          <Panel class="border-error/40">
            <PanelContent class="p-3 text-xs">
              <div class="text-error font-medium">Monitor request failed</div>
              <div class="text-muted-foreground break-words mt-1">{error()}</div>
            </PanelContent>
          </Panel>
        </Show>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-shrink-0">
          <Panel class="overflow-hidden">
            <PanelContent class="p-3 space-y-2">
              <div class="flex items-center justify-between gap-3">
                <div class="text-xs font-medium">CPU Usage</div>
                <div class="text-[11px] text-muted-foreground tabular-nums">{cpuSummary()}</div>
              </div>
              <For each={[chartToken()]}>
                {() => (
                  <MonitoringChart
                    series={cpuSeries}
                    labels={[]}
                    height={140}
                    maxPoints={60}
                    realtime
                    updateInterval={POLL_MS}
                    onUpdate={cpuOnUpdate}
                    showLegend={false}
                    yMin={0}
                    yMax={100}
                    smooth={false}
                    formatYTick={(v) => `${Math.round(v)}%`}
                    formatTooltipValue={(v) => formatPercent(v)}
                    maxXAxisLabels={6}
                  />
                )}
              </For>
            </PanelContent>
          </Panel>

          <Panel class="overflow-hidden">
            <PanelContent class="p-3 space-y-2">
              <div class="flex items-center justify-between gap-3">
                <div class="text-xs font-medium">Network Traffic</div>
                <div class="text-[11px] text-muted-foreground tabular-nums">{netSummary()}</div>
              </div>
              <For each={[chartToken()]}>
                {() => (
                  <MonitoringChart
                    series={networkSeries}
                    labels={[]}
                    height={140}
                    maxPoints={60}
                    realtime
                    updateInterval={POLL_MS}
                    onUpdate={netOnUpdate}
                    showLegend
                    yMin={0}
                    smooth={false}
                    formatYTick={(v) => formatSpeed(v)}
                    formatTooltipValue={(v) => formatSpeed(v)}
                    maxXAxisLabels={6}
                  />
                )}
              </For>
            </PanelContent>
          </Panel>
        </div>

        <Panel class="flex flex-col flex-1 min-h-[220px] overflow-hidden">
          <PanelContent class="p-3 flex flex-col flex-1 min-h-0">
            <div class="flex items-center justify-between gap-3 mb-2 flex-shrink-0">
              <div class="text-xs font-medium">Top Processes</div>
              <div class="flex items-center gap-1">
                <span class="text-[11px] text-muted-foreground mr-1">Sort:</span>
                <button
                  type="button"
                  onClick={() => setSortBy('cpu')}
                  class={`px-2 py-0.5 text-[11px] rounded transition-colors ${sortBy() === 'cpu' ? activeSortClass : inactiveSortClass}`}
                >
                  CPU
                </button>
                <button
                  type="button"
                  onClick={() => setSortBy('memory')}
                  class={`px-2 py-0.5 text-[11px] rounded transition-colors ${sortBy() === 'memory' ? activeSortClass : inactiveSortClass}`}
                >
                  Memory
                </button>
              </div>
            </div>

            <div class="flex-1 min-h-0 overflow-auto rounded border border-border bg-background">
              <table class="w-full text-xs relative">
                <thead class="sticky top-0 bg-background z-10">
                  <tr class="border-b border-border/60">
                    <th class="text-left py-2 px-2 font-medium text-muted-foreground">PID</th>
                    <th class="text-left py-2 px-2 font-medium text-muted-foreground">Name</th>
                    <th class="text-right py-2 px-2 font-medium text-muted-foreground">CPU %</th>
                    <th class="text-right py-2 px-2 font-medium text-muted-foreground">Memory</th>
                    <th class="text-left py-2 px-2 font-medium text-muted-foreground">User</th>
                  </tr>
                </thead>
                <tbody>
                  <Show when={processes().length > 0} fallback={
                    <tr>
                      <td colSpan={5} class="py-6 px-2 text-[11px] text-muted-foreground text-center">
                        {loading() ? 'Loading...' : 'No process data.'}
                      </td>
                    </tr>
                  }>
                    <For each={processes()}>
                      {(proc) => (
                        <tr class="border-b border-border/40 hover:bg-muted/30 transition-colors">
                          <td class="py-2 px-2 font-mono text-[11px] text-muted-foreground">{proc.pid}</td>
                          <td class="py-2 px-2 truncate max-w-[220px]" title={proc.name}>{proc.name}</td>
                          <td class="py-2 px-2 text-right font-mono tabular-nums">{Number(proc.cpuPercent ?? 0).toFixed(1)}</td>
                          <td class="py-2 px-2 text-right font-mono tabular-nums">{formatBytes(Number(proc.memoryBytes ?? 0))}</td>
                          <td class="py-2 px-2 truncate max-w-[160px] text-muted-foreground" title={proc.username}>{proc.username}</td>
                        </tr>
                      )}
                    </For>
                  </Show>
                </tbody>
              </table>
            </div>
          </PanelContent>
        </Panel>
      </div>

      <LoadingOverlay visible={loading() && !data()} message="Loading monitoring data..." />
    </div>
  );
}
