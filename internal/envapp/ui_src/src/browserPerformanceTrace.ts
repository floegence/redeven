import type { BrowserTrace } from '@floegence/floebrowser/viewer';

const stages = new Set<BrowserTrace['stage']>([
  'selection_intent', 'command_dispatch', 'command_ack', 'selection',
  'first_snapshot', 'control', 'usable_paint',
]);

// Keep one mark per stage in this trusted document. The mark's detail contains
// only opaque IDs and timing, never source-page URLs, input or DOM content.
export function markBrowserTrace(event: BrowserTrace): void {
  if (!stages.has(event.stage) || !Number.isFinite(event.at) || event.at < 0) return;
  const name = `redeven:browser:${event.stage}`;
  performance.clearMarks(name);
  performance.mark(name, {
    startTime: event.at,
    detail: {
      target: event.target,
      generation: event.generation,
      ...(event.request === undefined ? {} : { request: event.request }),
      ...(event.duration === undefined ? {} : { duration: event.duration }),
      ...(event.action === undefined ? {} : { action: event.action }),
    },
  });
}
