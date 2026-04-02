import { type EventEmitter } from 'node:events';

type StdioStream = Pick<EventEmitter, 'on'> & object;

const guardedStreams = new WeakSet<object>();

export function isBrokenPipeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  return Reflect.get(error, 'code') === 'EPIPE';
}

export function installStdioBrokenPipeGuards(streams: readonly (StdioStream | null | undefined)[] = [process.stdout, process.stderr]): void {
  for (const stream of streams) {
    if (!stream || guardedStreams.has(stream)) {
      continue;
    }
    guardedStreams.add(stream);
    stream.on('error', (error: unknown) => {
      if (isBrokenPipeError(error)) {
        return;
      }
      throw error;
    });
  }
}
