const MAX_READS = 128;
const MAX_CONSUMERS = 128;
const CONCURRENCY = 2;
type Consumer = { resolve: (value: unknown) => void; reject: (error: unknown) => void; cancel: () => void; signal: AbortSignal };
type Read = { key: string; controller: AbortController; consumers: Set<Consumer>; start: (signal: AbortSignal) => Promise<unknown>; active: boolean };

// An abandoned transport keeps its slot until it settles. Closing panels
// releases their consumers immediately without multiplying outstanding IO.
export function createActivityReadQueue() {
  const reads = new Map<string, Read>();
  let active = 0;
  const detach = (read: Read) => { if (reads.get(read.key) === read) reads.delete(read.key); };
  const pump = () => {
    for (const read of reads.values()) {
      if (active >= CONCURRENCY) break;
      if (read.active) continue;
      read.active = true; active++;
      let result: Promise<unknown>;
      try { result = read.start(read.controller.signal); }
      catch (error) { result = Promise.reject(error); }
      void result.then(value => {
        for (const consumer of read.consumers) consumer.resolve(value);
      }, error => {
        for (const consumer of read.consumers) consumer.reject(error);
      }).finally(() => {
        for (const consumer of read.consumers) consumer.signal.removeEventListener('abort', consumer.cancel);
        read.consumers.clear(); detach(read); active--; pump();
      });
    }
  };
  return {
    run<T>(key: string, signal: AbortSignal, start: (signal: AbortSignal) => Promise<T>): Promise<T> {
      signal.throwIfAborted();
      let read = reads.get(key);
      if (!read) {
        if (reads.size >= MAX_READS) return Promise.reject(new RangeError('Activity read capacity exceeded.'));
        read = { key, controller: new AbortController(), consumers: new Set(), start, active: false };
        reads.set(key, read);
      }
      if (read.consumers.size >= MAX_CONSUMERS) return Promise.reject(new RangeError('Activity read consumer capacity exceeded.'));
      const owned = read;
      const promise = new Promise<T>((resolve, reject) => {
        const consumer: Consumer = { resolve: value => resolve(value as T), reject, signal, cancel: () => {
          owned.consumers.delete(consumer); signal.removeEventListener('abort', consumer.cancel);
          reject(signal.reason ?? new DOMException('Read cancelled.', 'AbortError'));
          if (!owned.consumers.size) { detach(owned); owned.controller.abort(); pump(); }
        } };
        owned.consumers.add(consumer);
        signal.addEventListener('abort', consumer.cancel, { once: true });
      });
      pump();
      return promise;
    },
    get pending() { return reads.size; },
    get active() { return active; },
  };
}
