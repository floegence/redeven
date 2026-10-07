import type { PluginDiagnosticEvent } from '@floegence/redevplugin-ui';

import type { PluginProcessStatus } from './pluginTypes';

const processDiagnosticTypes = new Set([
  'plugin.process.starting',
  'plugin.process.started',
  'plugin.process.exited',
  'plugin.process.stream_gap',
  'plugin.process.operation_failed',
  'plugin.background.failed',
]);

export function projectPluginProcessStatus(
  events: readonly PluginDiagnosticEvent[],
): PluginProcessStatus | undefined {
  const relevant = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => processDiagnosticTypes.has(event.type))
    .sort((left, right) => {
      const leftTime = Date.parse(left.event.occurred_at ?? '');
      const rightTime = Date.parse(right.event.occurred_at ?? '');
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) {
        return Number.isFinite(leftTime) ? 1 : -1;
      }
      return left.index - right.index;
    });
  const latest = relevant.at(-1)?.event;
  if (!latest) return undefined;

  const details = latest.details;
  const base = {
    eventType: latest.type,
    ...(latest.occurred_at ? { occurredAt: latest.occurred_at } : {}),
    ...(details?.operation ? { operation: details.operation } : {}),
    ...(details?.stream ? { stream: details.stream } : {}),
    ...(details?.code ? { code: details.code } : {}),
  };
  switch (latest.type) {
    case 'plugin.process.starting': return { ...base, state: 'starting' };
    case 'plugin.process.started': return { ...base, state: 'running' };
    case 'plugin.process.exited': return { ...base, state: 'exited' };
    case 'plugin.process.stream_gap': return { ...base, state: 'stream_gap' };
    case 'plugin.background.failed':
    case 'plugin.process.operation_failed':
      return { ...base, state: details?.code === 'PERMISSION_DENIED' ? 'blocked' : 'crashed' };
    default: return undefined;
  }
}
