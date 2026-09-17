import readline from 'node:readline';
import { getQuickJS } from 'quickjs-emscripten';

// The guest receives JSON capabilities, never Node, Playwright, CDP or native
// objects. This process is disposable; the Runtime owns its lifetime and IPC.
export async function createComputerScript({ browser = true } = {}) {
  const engine = await getQuickJS();
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const vm = runtime.newContext();
  let active;
  runtime.setInterruptHandler(() => !active || Date.now() >= active.deadline);
  const install = (name, fn) => {
    const handle = vm.newFunction(name, fn);
    vm.setProp(vm.global, name, handle);
    handle.dispose();
  };
  install('__operation', (encoded) => {
    if (!active || active.sealed || active.pending.size || ++active.count > 50) {
      if (active) active.sealed = true;
      return { error: vm.newError('SCRIPT_OPERATION_LIMIT') };
    }
    const execution = active;
    const wire = vm.getString(encoded);
    if (wire.length > 65536) return { error: vm.newError('SCRIPT_OUTPUT_LIMIT') };
    let operation;
    try { operation = JSON.parse(wire); } catch { return { error: vm.newError('INVALID_REQUEST') }; }
    const deferred = vm.newPromise();
    const pending = Promise.resolve().then(() => execution.dispatch(operation)).then(
      (value) => {
        const encoded = JSON.stringify(value ?? null);
        if (encoded.length > 262144) throw new Error('SCRIPT_OUTPUT_LIMIT');
        const handle = vm.newString(encoded);
        deferred.resolve(handle);
        handle.dispose();
      },
    ).catch(() => {
      execution.sealed = true;
      const handle = vm.newError('HOST_OPERATION_STOPPED');
      deferred.reject(handle);
      handle.dispose();
    }).finally(() => execution.pending.delete(pending));
    execution.pending.add(pending);
    // The guest owns the returned promise. The host releases its extra handle
    // only after settlement, before context disposal.
    execution.deferred.push(deferred);
    return deferred.handle;
  });
  install('__log', (encoded) => {
    if (!active || active.sealed) return vm.undefined;
    const text = vm.getString(encoded);
    if (active.outputBytes + text.length > 65536) {
      active.sealed = true;
      return { error: vm.newError('SCRIPT_OUTPUT_LIMIT') };
    }
    active.outputBytes += text.length;
    active.logs.push(JSON.parse(text));
    return vm.undefined;
  });
  active = { deadline: Date.now() + 5000 };
  const bootstrap = vm.evalCode(`
    (() => {
      const invoke = __operation, emit = __log;
      delete globalThis.__operation; delete globalThis.__log;
      const call = async (operation) => JSON.parse(await invoke(JSON.stringify(operation)));
      const locator = (selector) => Object.freeze({
        read: () => call({action: 'read', selector}),
        click: () => call({action: 'click', selector}),
        fill: (text) => call({action: 'fill', selector, text}),
        press: (key) => call({action: 'key', selector, key}),
        scroll: (delta_y, delta_x = 0) => call({action: 'scroll', selector, delta_y, delta_x}),
        waitFor: (options = {}) => call({action: 'wait', selector, ...options}),
      });
      Object.defineProperties(globalThis, {
        ui: {value: Object.freeze({
          observe: (options = {}) => call({action: 'observe', ...options}),
          screenshot: () => call({action: 'screenshot'}),
          getByRole: (role, options = {}) => locator({role, ...options}),
          ref: (ref) => locator({ref}),
          click: (x, y) => call({action: 'pointer_click', x, y}),
          drag: (from_x, from_y, to_x, to_y, duration_ms = 0) => call({action: 'drag', from_x, from_y, to_x, to_y, duration_ms}),
          key: (key) => call({action: 'key', key}),
          assert: (condition, message = 'Result check failed') => { if (!condition) throw new Error(message); },
        })},
        ...(${browser ? 'true' : 'false'} ? {browser: {value: Object.freeze({
          navigate: (url) => call({action: 'navigate', url}),
          back: () => call({action: 'back'}),
          reload: () => call({action: 'reload'}),
          waitForDownload: (options = {}) => call({action: 'wait_for_download', ...options}),
        })}} : {}),
        log: {value: (...values) => emit(JSON.stringify(values))},
      });
    })();
  `);
  vm.unwrapResult(bootstrap).dispose();
  active = undefined;
  return {
    async execute(code, dispatch, timeout = 30000) {
      if (active || typeof code !== 'string' || !code.trim() || code.length > 65536) throw new Error('INVALID_REQUEST');
      active = { dispatch, deadline: Date.now() + Math.min(timeout, 30000), pending: new Set(), deferred: [], count: 0, logs: [], outputBytes: 0, sealed: false };
      const execution = active;
      let handle;
      try {
        handle = vm.unwrapResult(vm.evalCode(`(async () => {\n${code}\n})()`, 'computer-script.js'));
        for (;;) {
          const jobs = runtime.executePendingJobs();
          if (jobs.error) { jobs.error.dispose(); throw new Error('SCRIPT_FAILED'); }
          const state = vm.getPromiseState(handle);
          if (state.type === 'rejected') { state.error.dispose(); throw new Error('SCRIPT_FAILED'); }
          if (state.type === 'fulfilled') {
            state.value.dispose();
            if (execution.pending.size || execution.sealed) throw new Error('SCRIPT_UNFINISHED_OPERATIONS');
            return { logs: execution.logs, operations: execution.count };
          }
          if (!execution.pending.size) throw new Error('SCRIPT_NO_PROGRESS');
          await Promise.race(execution.pending);
          if (Date.now() >= execution.deadline) throw new Error('SCRIPT_TIMEOUT');
        }
      } finally {
        execution.sealed = true;
        await Promise.allSettled(execution.pending);
        handle?.dispose();
        for (const deferred of execution.deferred) deferred.dispose();
        active = undefined;
      }
    },
    dispose() { vm.dispose(); runtime.dispose(); },
  };
}

async function main() {
  const script = await createComputerScript({ browser: process.argv.includes('--browser-target') });
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let pending;
  let running = false;
  let call = 0;
  const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
  send({ type: 'ready', protocol_version: 2 });
  lines.on('line', (line) => {
    if (line.length > 1048576) process.exit(1);
    let message;
    try { message = JSON.parse(line); } catch { process.exit(1); }
    if (message.type === 'operation_result' && pending && message.id === pending.id) {
      const operation = pending;
      pending = undefined;
      if (message.error) operation.reject(new Error('HOST_OPERATION_STOPPED'));
      else operation.resolve(message.result);
      return;
    }
    if (running || message.type !== 'execute' || typeof message.id !== 'string') process.exit(1);
    running = true;
    script.execute(message.code, (operation) => new Promise((resolve, reject) => {
      const id = String(++call);
      pending = { id, resolve, reject };
      send({ type: 'operation', id, operation });
    })).then(
      (result) => { running = false; send({ type: 'result', id: message.id, result }); },
      () => { send({ type: 'error', id: message.id, error: 'SCRIPT_FAILED' }); process.exitCode = 1; lines.close(); },
    );
  });
  lines.on('close', () => {
    pending?.reject(new Error('CONNECTION_CLOSED'));
    if (!running) script.dispose();
  });
}

if (import.meta.main) await main();
