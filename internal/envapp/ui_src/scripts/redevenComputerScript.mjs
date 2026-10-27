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
  install('__invalidArgument', () => {
    if (active) { active.sealed = true; active.diagnostic = 'SCRIPT_ARGUMENT_ERROR'; }
    return { error: vm.newError('SCRIPT_ARGUMENT_ERROR') };
  });
  install('__conditionTimeout', () => {
    if (active) { active.sealed = true; active.diagnostic = 'CONDITION_TIMEOUT'; }
    return { error: vm.newError('CONDITION_TIMEOUT') };
  });
  install('__operation', (encoded) => {
    if (!active || active.sealed || active.pending.size || ++active.count > 50) {
      if (active) { active.sealed = true; active.diagnostic ||= active.pending.size ? 'SCRIPT_CONCURRENT_OPERATION' : 'SCRIPT_OPERATION_LIMIT'; }
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
        // The Runtime already bounds the semantic tree to 256 KiB. Reserve
        // room for its metadata envelope without increasing observation limits.
        if (encoded.length > 524288) { execution.diagnostic = 'SCRIPT_OUTPUT_LIMIT'; throw new Error('SCRIPT_OUTPUT_LIMIT'); }
        const handle = vm.newString(encoded);
        deferred.resolve(handle);
        handle.dispose();
      },
    ).catch(() => {
      execution.sealed = true;
      execution.hostStopped = true;
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
      active.outputTruncated = true;
      active.diagnostic = 'SCRIPT_OUTPUT_LIMIT';
      return { error: vm.newError('SCRIPT_OUTPUT_LIMIT') };
    }
    active.outputBytes += text.length;
    active.logs.push(JSON.parse(text));
    return vm.undefined;
  });
  active = { deadline: Date.now() + 5000 };
  const bootstrap = vm.evalCode(`
    (() => {
      const invoke = __operation, emit = __log, invalid = __invalidArgument, timedOut = __conditionTimeout;
      delete globalThis.__operation; delete globalThis.__log; delete globalThis.__invalidArgument; delete globalThis.__conditionTimeout;
      const options = (value, keys) => {
        if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !keys.includes(key))) invalid();
        return value;
      };
      const string = (value) => { if (typeof value !== 'string') invalid(); return value; };
      const number = (value) => { if (!Number.isFinite(value)) invalid(); return value; };
      const waitOptions = (value) => {
        options(value, ['state', 'equals', 'timeout_ms']);
        if (value.state !== undefined && !['visible', 'hidden', 'enabled', ...(${browser ? 'true' : 'false'} ? ['text','value']:[])].includes(value.state)) invalid();
        if (['text','value'].includes(value.state) ? typeof value.equals!=='string'||value.equals.length>2000 : value.equals!==undefined) invalid();
        if (value.timeout_ms !== undefined && (!Number.isInteger(value.timeout_ms) || value.timeout_ms < 0 || value.timeout_ms > 30000)) invalid();
        return value;
      };
      const selector = (role, value) => {
        string(role); options(value, ['name', 'exact', 'root_ref']);
        if (value.name !== undefined) string(value.name);
        if (value.root_ref !== undefined) string(value.root_ref);
        if (value.exact !== undefined && typeof value.exact !== 'boolean') invalid();
        return {canonical_role: role, ...value};
      };
      const observeOptions = (value) => {
        options(value, ['root_ref', 'limit', 'emit', 'full', 'screenshot']);
        if (value.root_ref !== undefined) string(value.root_ref);
        if (value.limit !== undefined && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 1000)) invalid();
        for (const key of ['emit', 'full', 'screenshot']) if (value[key] !== undefined && typeof value[key] !== 'boolean') invalid();
        return value;
      };
      const call = async (operation) => JSON.parse(await invoke(JSON.stringify(operation)));
      const imageOptions = (value) => { options(value, ['coordinate_space','frame','document_id']); if (value.coordinate_space !== 'image_pixels' || typeof value.frame !== 'string' || typeof value.document_id !== 'string') invalid(); return value; };
      const canonicalNode = (value) => {
        const {canonical_role, platform_role, ...node} = value;
        return {...node, role: canonical_role || node.role};
      };
      const snapshot = async (value = {}) => {
        const result = await call({action:'snapshot', ...observeOptions(value)});
        const observation = result.observation || result;
        return {...observation, ...(result.url === undefined ? {} : {url:result.url}), ...(result.title === undefined ? {} : {title:result.title}), nodes:(observation.nodes || []).map(canonicalNode)};
      };
      const pageOptions = (value) => {
        options(value,['limit','cursor']);
        if(value.limit!==undefined&&(!Number.isInteger(value.limit)||value.limit<1||value.limit>200)) invalid();
        if(value.cursor!==undefined) string(value.cursor);
        return value;
      };
      const attribute = async (selector, name, href = false) => {
        string(name);
        if(!['title','aria-label','aria-checked','aria-selected','aria-expanded','aria-rowcount','aria-colcount',...(href?['href']:[])].includes(name)) invalid();
        return (await call({action:'attribute',selector,attribute:name})).value;
      };
      const screenshot = async () => {
        const result = await call({action:'screenshot'});
        if (!${browser ? 'true' : 'false'}) return result;
        // Capture scalar identities so guest mutation cannot retarget an image.
        const identity = {coordinate_space:'image_pixels',frame:result.frame_geometry?.frame,document_id:result.frame_geometry?.document_id};
        return Object.freeze({...result,
          click:(x,y)=>call({action:'pointer_click',x:number(x),y:number(y),...imageOptions(identity)}),
          doubleClick:(x,y)=>call({action:'double_click',x:number(x),y:number(y),...imageOptions(identity)}),
          drag:(from_x,from_y,to_x,to_y,duration_ms=0)=>call({action:'drag',from_x:number(from_x),from_y:number(from_y),to_x:number(to_x),to_y:number(to_y),duration_ms:number(duration_ms),...imageOptions(identity)}),
          scroll:(x,y,delta_y,delta_x=0)=>call({action:'scroll',x:number(x),y:number(y),delta_y:number(delta_y),delta_x:number(delta_x),...imageOptions(identity)}),
        });
      };
      const locator = (selector) => Object.freeze({
        node: async () => canonicalNode((await call({action:'read',selector})).node),
        snapshot: async (value={}) => {
          options(value,['limit','emit']); observeOptions(value);
          const {node} = await call({action:'read',selector});
          return snapshot({...value,root_ref:node.ref});
        },
        read: () => call({action: 'read', selector}),
        ...(${browser ? 'true' : 'false'} ? {
          query: (value={}) => call({action:'query',selector,...pageOptions(value)}),
          count: async () => (await call({action:'query',selector,limit:1})).total,
          rows: (value={}) => call({action:'table',selector,...pageOptions(value)}),
          attribute: (name) => attribute(selector,name),
          linkSummary: async () => ({url:await attribute(selector,'href',true),redacted:true}),
          getAttribute: (attribute) => { string(attribute); if(!['href','title','aria-label','aria-checked','aria-selected','aria-expanded','aria-rowcount','aria-colcount'].includes(attribute)) invalid(); return call({action:'attribute',selector,attribute}); },
        } : {}),
        click: () => call({action: 'click', selector}),
        fill: (text) => call({action: 'fill', selector, text: string(text)}),
        press: (key) => call({action: 'key', selector, key: string(key)}),
        scroll: (delta_y, delta_x = 0) => call({action: 'scroll', selector, delta_y: number(delta_y), delta_x: number(delta_x)}),
        waitFor: (value = {}) => call({action: 'wait', selector, ...waitOptions(value)}),
        requireState: async (value={}) => { const result=await call({action:'wait',selector,...waitOptions(value)}); if(result.state==='timeout') timedOut(); },
      });
      Object.defineProperties(globalThis, {
        ui: {value: Object.freeze({
          observe: (value = {}) => call({action: 'observe', ...observeOptions(value)}),
          snapshot,
          screenshot,
          help: async (topic='core') => { string(topic); const {documentation}=await call({action:'help',topic}); emit(JSON.stringify([documentation])); return documentation; },
          type: (text) => call({action:'type',text:string(text)}),
          doubleClick: (x,y) => call({action:'double_click',x:number(x),y:number(y)}),
          scroll: (delta_y,delta_x=0) => call({action:'scroll',delta_y:number(delta_y),delta_x:number(delta_x)}),
          getByRole: (role, value = {}) => locator(selector(role, value)),
          ref: (ref) => locator({ref: string(ref)}),
          click: (x, y, image) => call({action: 'pointer_click', x: number(x), y: number(y), ...(image === undefined ? {} : imageOptions(image))}),
          drag: (from_x, from_y, to_x, to_y, duration_ms = 0, image) => call({action: 'drag', from_x: number(from_x), from_y: number(from_y), to_x: number(to_x), to_y: number(to_y), duration_ms: number(duration_ms), ...(image === undefined ? {} : imageOptions(image))}),
          key: (key) => call({action: 'key', key: string(key)}),
          assert: (condition, message = 'Result check failed') => { if (!condition) throw new Error(message); },
        })},
        ...(${browser ? 'true' : 'false'} ? {browser: {value: Object.freeze({
          navigate: (url) => call({action: 'navigate', url: string(url)}),
          back: () => call({action: 'back'}),
          reload: () => call({action: 'reload'}),
          downloadCursor: async () => {
            const result=await call({action:'download_cursor'}), cursor=result.cursor;
            return Object.freeze({...result, wait:(value={})=>{
              options(value,['timeout_ms']); waitOptions(value);
              return call({action:'wait_for_download',after:string(cursor),...value});
            }});
          },
          waitForDownload: (value = {}) => {
            options(value, ['id', 'after', 'timeout_ms']);
            if ((value.id === undefined) === (value.after === undefined)) invalid();
            if (value.id !== undefined) string(value.id);
            if (value.after !== undefined) string(value.after);
            waitOptions(value.timeout_ms === undefined ? {} : {timeout_ms: value.timeout_ms});
            return call({action: 'wait_for_download', ...value});
          },
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
      const diagnose = error => {
        execution.sealed = true;
        const name = vm.getProp(error, 'name');
        const stack = vm.getProp(error, 'stack');
        const message = vm.getProp(error, 'message');
        try {
          execution.diagnostic ||= ({ReferenceError: 'SCRIPT_REFERENCE_ERROR', TypeError: 'SCRIPT_TYPE_ERROR', SyntaxError: 'SCRIPT_SYNTAX_ERROR'})[vm.getString(name)] || 'SCRIPT_RUNTIME_ERROR';
          diagnostic.phase = execution.diagnostic==='SCRIPT_SYNTAX_ERROR'?'parse':execution.hostStopped?'host_operation':'execution';
          const location = /computer-script\.js:(\d+)(?::(\d+))?/u.exec(vm.getString(stack));
          const line = location ? Number(location[1])-1 : 0;
          if (line>0 && line<=code.split('\n').length) {
            diagnostic.line=line;
            if (location[2] && Number(location[2])>0) diagnostic.column=Number(location[2]);
          }
          const symbol = /^'([A-Za-z_$][\w$]{0,79})' is not defined$/u.exec(vm.getString(message))?.[1];
          if (execution.diagnostic==='SCRIPT_REFERENCE_ERROR' && symbol && code.match(/[A-Za-z_$][\w$]*/gu)?.includes(symbol)) diagnostic.symbol=symbol;
        } finally { name.dispose(); stack.dispose(); message.dispose(); }
      };
      let handle;
      const diagnostic = {phase:'execution'};
      try {
        const evaluated = vm.evalCode(`(async () => {\n${code}\n})()`, 'computer-script.js');
        if (evaluated.error) { diagnose(evaluated.error); evaluated.error.dispose(); throw new Error('SCRIPT_FAILED'); }
        handle = evaluated.value;
        for (;;) {
          const jobs = runtime.executePendingJobs();
          if (jobs.error) { diagnose(jobs.error); jobs.error.dispose(); throw new Error('SCRIPT_FAILED'); }
          const state = vm.getPromiseState(handle);
          if (state.type === 'rejected') { diagnose(state.error); state.error.dispose(); throw new Error('SCRIPT_FAILED'); }
          if (state.type === 'fulfilled') {
            state.value.dispose();
            if (execution.pending.size || execution.sealed) throw new Error('SCRIPT_UNFINISHED_OPERATIONS');
            return { logs: execution.logs, operations: execution.count };
          }
          if (!execution.pending.size) throw new Error('SCRIPT_NO_PROGRESS');
          await Promise.race(execution.pending);
          if (Date.now() >= execution.deadline) throw new Error('SCRIPT_TIMEOUT');
        }
      } catch (error) {
        execution.sealed = true;
        if (['SCRIPT_TIMEOUT', 'SCRIPT_NO_PROGRESS', 'SCRIPT_UNFINISHED_OPERATIONS'].includes(error.message)) execution.diagnostic ||= error.message;
        // Preserve bounded output without exposing guest exception text, which
        // can include values from the page or sensitive input.
        const failure = new Error('SCRIPT_FAILED');
        failure.result = { logs: execution.logs, operations: execution.count, truncated: execution.outputTruncated === true, diagnostic: { ...diagnostic, code: execution.diagnostic || 'SCRIPT_RUNTIME_ERROR' } };
        throw failure;
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
      (failure) => {
        running = false;
        send({ type: 'error', id: message.id, error: 'SCRIPT_FAILED', result: failure.result });
        process.exitCode = 1; lines.close();
      },
    );
  });
  lines.on('close', () => {
    pending?.reject(new Error('CONNECTION_CLOSED'));
    if (!running) script.dispose();
  });
}

if (import.meta.main) await main();
