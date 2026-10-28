import readline from 'node:readline';
import { getQuickJS } from 'quickjs-emscripten';

// The guest receives JSON capabilities, never Node, Playwright, CDP or native
// objects. This process is disposable; the Runtime owns its lifetime and IPC.
// Explicit arity includes optional/default parameters; function.length cannot.
export const computerScriptMethods = Object.freeze({
  ui: {budget:[0,0],observe:[0,1],snapshot:[0,1],screenshot:[0,0],help:[0,1],type:[1,1],doubleClick:[2,2],scroll:[1,2],scrollAt:[3,4],getByRole:[1,2],ref:[1,1],click:[2,3],drag:[4,6],key:[1,1],assert:[1,2]},
  locator: {node:[0,0],snapshot:[0,1],read:[0,0],text:[0,0],query:[0,1],count:[0,0],rows:[0,1],attribute:[1,1],linkSummary:[0,0],getAttribute:[1,1],click:[0,0],fill:[1,1],press:[1,1],scroll:[1,2],waitFor:[0,1],requireState:[0,1]},
  browser: {navigate:[1,1],back:[0,0],reload:[0,0],saveDownload:[1,1],readDownload:[1,2],downloadCursor:[0,0],waitForDownload:[0,1]},
  image: {click:[2,2],doubleClick:[2,2],drag:[4,5],scroll:[3,4]},
  downloadCursor: {wait:[0,1]},
});

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
  install('__budget', () => vm.newString(JSON.stringify({remaining_ms:Math.max(0, active.deadline-Date.now()),remaining_operations:Math.max(0,50-active.count)})));
  install('__invalidArgument', (method, field, expected) => {
    if (active) { active.sealed = true; active.diagnostic = 'SCRIPT_ARGUMENT_ERROR'; active.argumentDiagnostic={method:vm.getString(method),field:vm.getString(field),expected:vm.getString(expected),recovery:'correct_arguments'}; }
    return { error: vm.newError('SCRIPT_ARGUMENT_ERROR') };
  });
  install('__conditionTimeout', (state, timeout) => {
    if (active) {
      active.sealed = true; active.diagnostic = 'CONDITION_TIMEOUT';
      active.conditionDiagnostic = {method:'locator.requireState',state:vm.getString(state),timeout_ms:vm.getNumber(timeout),operation_index:active.count-1};
    }
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
    if (active.outputBytes + Buffer.byteLength(text) > 65536) {
      active.sealed = true;
      active.outputTruncated = true;
      active.diagnostic = 'SCRIPT_OUTPUT_LIMIT';
      return { error: vm.newError('SCRIPT_OUTPUT_LIMIT') };
    }
    active.outputBytes += Buffer.byteLength(text);
    const values = JSON.parse(text);
    active.logs.push(values);
    active.onLog?.(values);
    return vm.undefined;
  });
  active = { deadline: Date.now() + 5000 };
  const bootstrap = vm.evalCode(`
    (() => {
      const invoke = __operation, emit = __log, reject = __invalidArgument, timedOut = __conditionTimeout, budget = __budget;
      let currentMethod = 'ui';
      const invalid = (field='arguments',expected='documented_fields') => reject(currentMethod,field,expected);
      const methodContracts = ${JSON.stringify(computerScriptMethods)};
      const expose = (prefix, methods) => Object.freeze(Object.fromEntries(Object.entries(methods).map(([name,method])=>{
        const bounds=methodContracts[prefix]?.[name];
        if(!bounds) throw new Error('Missing method contract');
        return [name,(...args)=>{
          currentMethod=prefix+'.'+name;
          if(args.length<bounds[0]||args.length>bounds[1]) invalid('arguments','documented_arity');
          return method(...args);
        }];
      })));
      delete globalThis.__operation; delete globalThis.__log; delete globalThis.__invalidArgument; delete globalThis.__conditionTimeout; delete globalThis.__budget;
      const options = (value, keys) => {
        if (!value || Object.getPrototypeOf(value) !== Object.prototype) invalid();
        const unknown = Object.keys(value).find(key => !keys.includes(key));
        // Name only product-authored option keys; arbitrary keys may be secret.
        if (unknown !== undefined) invalid(['state','equals','timeout_ms','limit','emit','full','screenshot','root_ref','cursor','coordinate_space','url','id','after'].includes(unknown) ? unknown : 'arguments');
        return value;
      };
      const string = (value,field='text') => { if (typeof value !== 'string') invalid(field,'string'); return value; };
      const number = (value) => { if (!Number.isFinite(value)) invalid('coordinates','finite_number'); return value; };
      const waitOptions = (value) => {
        options(value, ['state', 'equals', 'timeout_ms']);
        if (value.state !== undefined && !['visible', 'hidden', 'enabled', ...(${browser ? 'true' : 'false'} ? ['text','value']:[])].includes(value.state)) invalid('state','documented_condition');
        if (['text','value'].includes(value.state) ? typeof value.equals!=='string'||value.equals.length>2000 : value.equals!==undefined) invalid('equals','condition_text_max_2000');
        if (value.timeout_ms !== undefined && (!Number.isInteger(value.timeout_ms) || value.timeout_ms < 0 || value.timeout_ms > 30000)) invalid('timeout_ms','integer_0_30000');
        return value;
      };
      const selector = (role, value) => {
        string(role,'selector'); options(value, ['name', 'exact', 'root_ref']);
        if (value.name !== undefined) string(value.name,'selector');
        if (value.root_ref !== undefined) string(value.root_ref,'root_ref');
        if (value.exact !== undefined && typeof value.exact !== 'boolean') invalid();
        return {canonical_role: role, ...value};
      };
      const observeOptions = (value) => {
        options(value, ['root_ref', 'limit', 'emit', 'full', 'screenshot']);
        if (value.root_ref !== undefined) string(value.root_ref,'root_ref');
        if (value.limit !== undefined && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 1000)) invalid('limit','integer_1_1000');
        for (const key of ['emit', 'full', 'screenshot']) if (value[key] !== undefined && typeof value[key] !== 'boolean') invalid(key,'boolean');
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
        const observation = result.observation;
        return {...observation, ...(result.url === undefined ? {} : {url:result.url}), ...(result.title === undefined ? {} : {title:result.title}), nodes:observation.nodes.map(canonicalNode)};
      };
      const pageOptions = (value) => {
        options(value,['limit','cursor']);
        if(value.limit!==undefined&&(!Number.isInteger(value.limit)||value.limit<1||value.limit>200)) invalid('limit','integer_1_200');
        if(value.cursor!==undefined) string(value.cursor,'cursor');
        return value;
      };
      const attribute = async (selector, name, href = false) => {
        string(name,'attribute');
        if(!['title','aria-label','aria-checked','aria-selected','aria-expanded','aria-rowcount','aria-colcount',...(href?['href']:[])].includes(name)) invalid();
        return (await call({action:'attribute',selector,attribute:name})).value;
      };
      const screenshot = async () => {
        const result = await call({action:'screenshot'});
        if (!${browser ? 'true' : 'false'}) return result;
        // Capture scalar identities so guest mutation cannot retarget an image.
        const identity = {coordinate_space:'image_pixels',frame:result.frame_geometry?.frame,document_id:result.frame_geometry?.document_id};
        return Object.freeze({...result, ...expose('image',{
          click:(x,y)=>call({action:'pointer_click',x:number(x),y:number(y),...imageOptions(identity)}),
          doubleClick:(x,y)=>call({action:'double_click',x:number(x),y:number(y),...imageOptions(identity)}),
          drag:(from_x,from_y,to_x,to_y,duration_ms=0)=>call({action:'drag',from_x:number(from_x),from_y:number(from_y),to_x:number(to_x),to_y:number(to_y),duration_ms:number(duration_ms),...imageOptions(identity)}),
          scroll:(x,y,delta_y,delta_x=0)=>call({action:'scroll',x:number(x),y:number(y),delta_y:number(delta_y),delta_x:number(delta_x),...imageOptions(identity)}),
        })});
      };
      const locator = (selector) => expose('locator',{
        node: async () => canonicalNode((await call({action:'read',selector})).node),
        snapshot: async (value={}) => {
          options(value,['limit','emit']); observeOptions(value);
          const {node} = await call({action:'read',selector});
          return snapshot({...value,root_ref:node.ref});
        },
        read: () => call({action: 'read', selector}),
        ...(${browser ? 'true' : 'false'} ? {
          text: () => call({action:'text',selector}),
          query: (value={}) => call({action:'query',selector,...pageOptions(value)}),
          count: async () => (await call({action:'query',selector,limit:1})).total,
          rows: (value={}) => call({action:'table',selector,...pageOptions(value)}),
          attribute: (name) => attribute(selector,name),
          linkSummary: async () => ({url:await attribute(selector,'href',true),redacted:true}),
          getAttribute: (attribute) => { string(attribute,'attribute'); if(!['href','title','aria-label','aria-checked','aria-selected','aria-expanded','aria-rowcount','aria-colcount'].includes(attribute)) invalid(); return call({action:'attribute',selector,attribute}); },
        } : {}),
        click: () => call({action: 'click', selector}),
        fill: (text) => call({action: 'fill', selector, text: string(text)}),
        press: (key) => call({action: 'key', selector, key: string(key,'key')}),
        scroll: (delta_y, delta_x = 0) => call({action: 'scroll', selector, delta_y: number(delta_y), delta_x: number(delta_x)}),
        waitFor: (value = {}) => call({action: 'wait', selector, ...waitOptions(value)}),
        requireState: async (value={}) => {
          const condition=waitOptions(value), state=condition.state ?? 'visible', timeout=condition.timeout_ms ?? 10000;
          const result=await call({action:'wait',selector,...condition});
          if(result.state==='timeout') timedOut(state,timeout);
        },
      });
      Object.defineProperties(globalThis, {
        ui: {value: expose('ui',{
          budget: () => JSON.parse(budget()),
          observe: (value = {}) => call({action: 'observe', ...observeOptions(value)}),
          snapshot,
          screenshot,
          help: async (topic='core') => { string(topic,'topic'); const {documentation}=await call({action:'help',topic}); emit(JSON.stringify([documentation])); return documentation; },
          type: (text) => call({action:'type',text:string(text)}),
          doubleClick: (x,y) => call({action:'double_click',x:number(x),y:number(y)}),
          scroll: (delta_y,delta_x=0) => call({action:'scroll',delta_y:number(delta_y),delta_x:number(delta_x)}),
          scrollAt: (x,y,delta_y,delta_x=0) => call({action:'scroll',x:number(x),y:number(y),delta_y:number(delta_y),delta_x:number(delta_x)}),
          getByRole: (role, value = {}) => locator(selector(role, value)),
          ref: (ref) => locator({ref: string(ref,'selector')}),
          click: (x, y, image) => call({action: 'pointer_click', x: number(x), y: number(y), ...(image === undefined ? {} : imageOptions(image))}),
          drag: (from_x, from_y, to_x, to_y, duration_ms = 0, image) => call({action: 'drag', from_x: number(from_x), from_y: number(from_y), to_x: number(to_x), to_y: number(to_y), duration_ms: number(duration_ms), ...(image === undefined ? {} : imageOptions(image))}),
          key: (key) => call({action: 'key', key: string(key,'key')}),
          assert: (condition, message = 'Result check failed') => { if (!condition) throw new Error(message); },
        })},
        ...(${browser ? 'true' : 'false'} ? {browser: {value: expose('browser',{
          navigate: (url) => call({action: 'navigate', url: string(url,'url')}),
          back: () => call({action: 'back'}),
          reload: () => call({action: 'reload'}),
          saveDownload: (id) => call({action:'save_download',id:string(id,'id')}),
          readDownload: (id, value={}) => {
            string(id,'id'); options(value,['offset','limit']);
            if (value.offset !== undefined && (!Number.isSafeInteger(value.offset) || value.offset < 0)) invalid();
            if (value.limit !== undefined && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 65536)) invalid();
            return call({action:'read_download',id,...value});
          },
          downloadCursor: async () => {
            const result=await call({action:'download_cursor'}), cursor=result.cursor;
            return Object.freeze({...result, ...expose('downloadCursor',{wait:(value={})=>{
              options(value,['timeout_ms']); waitOptions(value);
              return call({action:'wait_for_download',after:string(cursor,'cursor'),...value});
            }})});
          },
          waitForDownload: (value = {}) => {
            options(value, ['id', 'after', 'timeout_ms']);
            if ((value.id === undefined) === (value.after === undefined)) invalid();
            if (value.id !== undefined) string(value.id,'id');
            if (value.after !== undefined) string(value.after,'after');
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
    async execute(code, dispatch, timeout = 30000, onLog) {
      if (active || typeof code !== 'string' || !code.trim() || code.length > 65536) throw new Error('INVALID_REQUEST');
      active = { dispatch, onLog, deadline: Date.now() + Math.min(timeout, 30000), pending: new Set(), deferred: [], count: 0, logs: [], outputBytes: 0, sealed: false };
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
        failure.result = { logs: execution.logs, operations: execution.count, truncated: execution.outputTruncated === true, diagnostic: { ...diagnostic, ...execution.argumentDiagnostic, ...execution.conditionDiagnostic, code: execution.diagnostic || 'SCRIPT_RUNTIME_ERROR' } };
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
  send({ type: 'ready', protocol_version: 3 });
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
    }), message.timeout_ms, values => send({ type: 'log', id: message.id, values })).then(
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
