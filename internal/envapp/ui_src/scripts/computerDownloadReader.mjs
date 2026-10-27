// One bounded, short-lived stream per source. Sequential chunk reads do not
// reopen and rescan the file; a different ID/offset retires the previous stream.
export function createComputerDownloadReader(source, page) {
  let active, idle;
  const close = () => {
    clearTimeout(idle);
    const previous = active; active = undefined;
    previous?.abort.abort();
    if (previous?.iterator) void Promise.resolve(previous.iterator.return?.()).catch(() => {});
  };
  const interrupted = () => { if (page.stopped || page.operationCancelled || page.invalid) close(); };
  page.listeners.add(interrupted);
  return {
    close() { close(); page.listeners.delete(interrupted); },
    async read({ id, offset = 0, limit = 16384 } = {}) {
      if (typeof id !== 'string' || !id || !Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 65536) throw new Error('INVALID_REQUEST');
      const file = source.downloads().find(item => item.state.id === id);
      if (!file || file.state.status !== 'complete') throw new Error('TARGET_CAPABILITY_UNAVAILABLE');
      if (file.state.size !== undefined && offset > file.state.size) throw new Error('INVALID_REQUEST');
      if (active?.file !== file || active.offset !== offset) close();
      clearTimeout(idle);
      try {
        if (!active) {
          const state = { file, abort: new AbortController(), offset, received: 0, buffer: Buffer.alloc(0), done: false };
          active = state; interrupted();
          state.abort.signal.throwIfAborted();
          state.iterator = (await file.open(state.abort.signal))[Symbol.asyncIterator]();
          state.abort.signal.throwIfAborted();
        }
        const state = active;
        while (!state.done && state.buffer.length <= limit) {
          const next = await state.iterator.next();
          state.abort.signal.throwIfAborted();
          if (!source.downloads().includes(file) || file.state.status !== 'complete') throw new Error('TARGET_CAPABILITY_UNAVAILABLE');
          if (next.done) {
            state.done = true;
            if (file.state.size !== undefined && state.received !== file.state.size) throw new Error('TARGET_ACTION_FAILED');
            break;
          }
          if (!(next.value instanceof Uint8Array)) throw new Error('TARGET_ACTION_FAILED');
          const start = Math.max(0, offset - state.received);
          state.received += next.value.length;
          if (file.state.size !== undefined && state.received > file.state.size) throw new Error('TARGET_ACTION_FAILED');
          if (start < next.value.length) state.buffer = Buffer.concat([state.buffer, next.value.subarray(start)]);
        }
        state.abort.signal.throwIfAborted();
        const data = state.buffer.subarray(0, limit);
        state.buffer = state.buffer.subarray(data.length); state.offset += data.length;
        const more = state.buffer.length > 0 || !state.done;
        const result = { id, filename: file.state.filename, offset, bytes: data.length, base64: data.toString('base64'), truncated: more, ...(more ? { next_offset: state.offset } : {}), ...(file.state.size === undefined ? {} : { size_bytes: file.state.size }) };
        if (more) { idle = setTimeout(close, 5000); idle.unref?.(); } else close();
        return result;
      } catch (error) { close(); throw error; }
    },
  };
}
