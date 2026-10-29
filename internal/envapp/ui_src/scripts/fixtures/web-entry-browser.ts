import { readFileBytesOnce, openFileByteStream } from '../../src/ui/utils/fileStreamReader';
import { openRuntimeSession, verifyRuntimeServices } from '../../../../../desktop/scripts/fixtures/gateway-runtime-browser';
import { connectTerminalLive } from '@floegence/floeterm-terminal-web/live';
import type { JsonValue } from '@floegence/flowersec-core/browser';
import { sha256 } from '@noble/hashes/sha2.js';
import { fetchLocalApi, fetchLocalApiJSONResponse, uploadLocalApiAttachment } from '../../src/ui/services/localApi';

export async function verifyAttachmentUpload() {
  const scope = await fetchLocalApiJSONResponse<{ staging_scope_id: string }>(
    '/_redeven_proxy/api/ai/upload-staging-scopes',
    { method: 'POST', body: JSON.stringify({ target_id: 'center-upload-' + crypto.randomUUID() }) },
  );
  const scopeID = scope.data.staging_scope_id;
  const capability = scope.headers.get('Upload-Staging-Capability');
  if (!scopeID || !capability) throw new Error('Upload staging authorization missing');
  const headers = { 'Upload-Staging-Scope-ID': scopeID, 'Upload-Staging-Capability': capability };
  const hex = (bytes: Uint8Array) => [...sha256(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
  const content = 'Center attachment integrity λ 中\n'.repeat(65536);
  const file = new File([content], 'center-upload.txt', { type: 'text/plain' });
  const digest = hex(new Uint8Array(await file.arrayBuffer()));
  const progress: number[] = [];
  const request = {
    file, source: 'uploaded_file' as const, requestID: crypto.randomUUID(),
    stagingScopeID: scopeID, stagingCapability: capability, contentSHA256: digest,
    displayNameSHA256: hex(new TextEncoder().encode(file.name)), signal: AbortSignal.timeout(30000),
    onProgress: (loaded: number) => { progress.push(loaded); },
  };
  let released = false;
  try {
    const uploaded = await uploadLocalApiAttachment(request);
    if (!uploaded.attachment_id || uploaded.content_sha256 !== digest || uploaded.size_bytes !== file.size) throw new Error('Uploaded metadata differs from browser File');
    const repeated = await uploadLocalApiAttachment(request);
    if (repeated.attachment_id !== uploaded.attachment_id) throw new Error('Upload retry created another attachment');
    const url = '/_redeven_proxy/api/ai/uploads/' + encodeURIComponent(uploaded.attachment_id);
    const bytes = await fetchLocalApi(url, { headers, signal: AbortSignal.timeout(30000) });
    if (!bytes.ok || hex(new Uint8Array(await bytes.arrayBuffer())) !== digest) throw new Error('Uploaded bytes did not survive Center transport');
    const denied = await fetchLocalApi(url, { headers: { ...headers, 'Upload-Staging-Capability': 'invalid-qualification-capability' } });
    if (denied.status !== 404) throw new Error('Invalid upload capability was not hidden');
    const release = await fetchLocalApi('/_redeven_proxy/api/ai/upload-staging-scopes/' + encodeURIComponent(scopeID), { method: 'DELETE', headers });
    if (!release.ok) throw new Error('Upload staging cleanup rejected');
    released = true;
    const stale = await fetchLocalApi(url, { headers });
    if (stale.status !== 404) throw new Error('Released upload remained readable');
    if (!progress.some(loaded => loaded >= file.size)) throw new Error('Browser upload progress was not observed');
    return { scope: 'Production browser XHR multipart attachment upload through Center, byte digest, idempotent retry, invalid capability and staging cleanup', bytes: file.size, sha256: digest, progressEvents: progress.length, retryReusedAttachment: true, invalidCapabilityStatus: denied.status, releasedReadStatus: stale.status };
  } finally {
    if (!released) {
      const cleanup = await fetchLocalApi('/_redeven_proxy/api/ai/upload-staging-scopes/' + encodeURIComponent(scopeID), { method: 'DELETE', headers });
      if (!cleanup.ok) throw new Error('Failed upload qualification cleanup');
    }
  }
}

async function recoveryFlowerCall(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  return (await fetchLocalApiJSONResponse<any>('/_redeven_proxy/api/ai/' + path, { method,
    signal: AbortSignal.timeout(30000), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })).data;
}

export async function inspectFlowerRecoveryProbe(threadID: string, cleanup = false) {
  if (cleanup) {
    // Recovery qualification observes terminal completion before cleanup.
    // An ordinary delete must reject still-active work, never cancel it.
    await recoveryFlowerCall('threads/' + encodeURIComponent(threadID), undefined, 'DELETE');
    const threads = await recoveryFlowerCall('threads');
    if (threads.threads?.some((thread: { thread_id: string }) => thread.thread_id === threadID)) throw new Error('Recovery thread survived deletion');
    return { deleted: true };
  }
  const detail = await recoveryFlowerCall('threads/' + encodeURIComponent(threadID));
  const items = detail.current?.items ?? [];
  return { threadID: detail.thread?.thread_id, runID: detail.current?.run_id, error: detail.current?.error,
    users: items.filter((item: { kind: string }) => item.kind === 'user').length,
    answers: items.filter((item: { kind: string }) => item.kind === 'assistant').map((item: { text?: string; live?: boolean }) => ({ text: item.text, live: item.live })),
  };
}

export async function verifyModelTurn() {
  const {current,acquisition}=await openRuntimeSession();
  const headers={'Content-Type':'application/json','X-Redeven-Plugin-Session':acquisition.plugin_session_credential};
  const call=async(path:string,body?:unknown,method=body===undefined?'GET':'POST')=>{
    const response=await fetch('/_redeven_proxy/api/ai/'+path,{method,headers,signal:AbortSignal.timeout(30_000),...(body===undefined?{}:{body:JSON.stringify(body)})});
    const result=await response.json();
    if(!response.ok || !result.ok)throw new Error('Flower '+path+': '+JSON.stringify(result));
    return result.data;
  };
  let threadID='';
  try {
    const models=await call('models');
    if(!models.current_model || !models.models?.length)throw new Error('Runtime model configuration unavailable');
    const marker='CENTER_MODEL_'+crypto.randomUUID().replaceAll('-','');
    const created=await call('threads',{client_request_id:crypto.randomUUID(),title:'Web Center model qualification',model_id:models.current_model,permission_type:'readonly'});
    threadID=created.thread.thread_id;
    const submitted=await call('threads/'+encodeURIComponent(threadID)+'/turns',{client_request_id:crypto.randomUUID(),input:{text:'Do not use tools or delegate. Reply with exactly this marker: '+marker,attachments:[]},options:{permission_type:'readonly',reasoning_only:true,max_output_tokens:512,max_cost_usd:0.1}});
    const deadline=Date.now()+90_000;
    while(Date.now()<deadline){
      const detail=await call('threads/'+encodeURIComponent(threadID));
      const view=detail.current;
      if(view?.error)throw new Error('Flower turn failed: '+view.error);
      const answer=view?.items?.find((item:{kind:string;text?:string;live?:boolean})=>item.kind==='assistant' && item.text?.includes(marker) && !item.live);
      if(answer)return {scope:'Real authorized Runtime model turn through Center, Gateway and plugin session',model:models.current_model,runID:submitted.run_id,response:answer.text};
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    const detail=await call('threads/'+encodeURIComponent(threadID));
    throw new Error('Flower turn did not complete: '+JSON.stringify(detail.current));
  } finally {
    try{if(threadID)await call('threads/'+encodeURIComponent(threadID)+'?force=true',undefined,'DELETE');}
    finally{await current.close();}
  }
}

export async function verifyContainerLifecycle() {
  const {current,acquisition}=await openRuntimeSession();
  const call=async(path:string,body?:unknown)=>{
    const response=await fetch('/_redeven_proxy/api/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Redeven-Plugin-Session':acquisition.plugin_session_credential},signal:AbortSignal.timeout(20000),...(body===undefined?{}:{body:JSON.stringify(body)})});
    const result=await response.json();if(!response.ok || !result.ok)throw new Error('Container '+path+': '+JSON.stringify(result));return result.data;
  };
  try {
    const runtimes=await call('container-resources/runtimes');
    const runtime=runtimes.engines.find((item:{engine:string;state:string})=>item.engine==='docker' && item.state==='ready');
    if(!runtime)throw new Error('Task Docker access unavailable: '+JSON.stringify(runtimes));
    const query=new URLSearchParams({engine:'docker',endpoint_id:runtime.endpoint_id});
    const inventory=await call('container-resources/containers?'+query+'&all=true');
    const container=inventory.containers.find((item:{name?:string;names?:string[]})=>item.name==='redeven-center-aef0-acceptance' || item.names?.includes('redeven-center-aef0-acceptance'));
    if(!container)throw new Error('Isolated acceptance container missing');
    const id=container.container_id;
    const perform=async(method:string)=>{
      const request={engine:'docker',endpoint_id:runtime.endpoint_id,container_id:id};
      const preflight=await call('container-resources/preflights',{method,request});
      const input={method,request,request_id:crypto.randomUUID(),request_hash:preflight.request_hash,plan_hash:preflight.plan_hash};
      const created=await call('container-resource-operations',input);
      const repeated=await call('container-resource-operations',input);
      if(created.operation_id!==repeated.operation_id)throw new Error('Container retry duplicated operation');
      for(let i=0;i<100;i++){
        const status=await call('container-resource-operations/'+created.operation_id);
        if(status.state==='succeeded')return;
        if(['failed','canceled','interrupted'].includes(status.state))throw new Error('Container operation failed: '+JSON.stringify(status));
        await new Promise(resolve=>setTimeout(resolve,200));
      }
      throw new Error('Container operation timed out');
    };
    await perform('containers.start');
    let output=false;
    for(let i=0;i<50;i++){
      const logs=await call('container-resources/containers/'+id+'/logs?'+query+'&tail=400');
      output=(logs.lines??[]).some((line:{message:string})=>line.message.includes('CENTER_CONTAINER_READY'));
      if(output)break;await new Promise(resolve=>setTimeout(resolve,200));
    }
    if(!output)throw new Error('Container output missing');
    await perform('containers.stop');
    return {scope:'udesk26 task-only Docker container started and stopped through Center/Gateway/Runtime; preflight, operation retry identity and actual log verified',engine:runtime.engine};
  } finally {await current.close();}
}

export async function verifyLargeFile(path: string, expectedBytes: number, expectedHash: string) {
  const { current } = await openRuntimeSession();
  const started = performance.now();
  const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
  const samples: { bytes: number; heapBytes: number | null }[] = [{bytes:0,heapBytes:heap()}];
  try {
    const file = await openFileByteStream({client:current,path,signal:AbortSignal.timeout(5*60_000)});
    if(file.meta.content_len!==expectedBytes) throw new Error('Large file size differs from fixture');
    const hash=sha256.create();
    let bytes=0, nextSample=64*1024*1024;
    for await(const part of file.chunks) {
      hash.update(part.bytes);bytes+=part.bytes.byteLength;
      if(bytes>=nextSample){samples.push({bytes,heapBytes:heap()});nextSample+=64*1024*1024;}
    }
    const digest=Array.from(hash.digest(),byte=>byte.toString(16).padStart(2,'0')).join('');
    if(bytes!==expectedBytes || digest!==expectedHash)throw new Error('Large streamed download hash mismatch');
    const abort=new AbortController();
    const canceled=await openFileByteStream({client:current,path,signal:abort.signal});
    let canceledBytes=0,rejected=false;
    try {
      for await(const part of canceled.chunks){canceledBytes+=part.bytes.byteLength;if(canceledBytes>=1024*1024)abort.abort();}
    } catch(error){if(!abort.signal.aborted)throw error;rejected=true;}
    if(!rejected || canceledBytes>=expectedBytes)throw new Error('Large transfer ignored cancellation');
    await current.probeLiveness({signal:AbortSignal.timeout(5000)});
    return {bytes,sha256:digest,durationMs:performance.now()-started,canceledBytes,heapSamples:samples};
  } finally {await current.close();}
}

export async function verifyWebEntryServices(): Promise<string[]> {
  const assertions = await verifyRuntimeServices();
  const { current, acquisition } = await openRuntimeSession();
  await current.probeLiveness({ signal: AbortSignal.timeout(5000) });
  const rpc = async (type: number, payload: JsonValue) => {
    const result = await current.rpc.call(type, payload, value => value, { signal: AbortSignal.timeout(10_000) });
    if (!result.ok) throw new Error('Runtime RPC rejected: ' + type + ' ' + result.error.code + ' ' + result.error.message);
    return result.payload as Record<string, JsonValue>;
  };
  const name = 'web-entry-' + crypto.randomUUID();
  const content = 'Browser roundtrip\n' + crypto.randomUUID();
  let terminalID = '';
  let filePath = '';
  let fileCreated = false;
  let repositoryPath = '';
  try {
    const context = await rpc(1010, {});
    const home = context.agent_home_path_abs;
    if (typeof home !== 'string' || !home) throw new Error('Missing isolated fixture home');
    filePath = home + '/' + name;
    await rpc(1003, { path: filePath, content, encoding: 'utf8' });
    fileCreated = true;
    const read = await rpc(1002, { path: filePath, encoding: 'utf8' });
    if (read.content !== content) throw new Error('Written file contents changed');
    const expected = new TextEncoder().encode(content);
    const ranged = await readFileBytesOnce({ client: current, path: filePath, offset: 3, maxBytes: 12 });
    if (Array.from(ranged.bytes).join(',') !== Array.from(expected.slice(3, 15)).join(',')) throw new Error('File range contents changed');
    const streamed = await openFileByteStream({ client: current, path: filePath });
    const chunks: number[] = [];
    for await (const chunk of streamed.chunks) chunks.push(...chunk.bytes);
    const digest = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).join(',');
    if (await digest(new Uint8Array(chunks)) !== await digest(expected)) throw new Error('Download hash mismatch');
    const canceled = new AbortController();
    const interrupted = await openFileByteStream({ client: current, path: filePath, signal: canceled.signal });
    canceled.abort();
    let rejected = false;
    try { for await (const _chunk of interrupted.chunks) { /* Must reject before delivery. */ } } catch { rejected = true; }
    if (!rejected) throw new Error('Canceled download delivered contents');
    const monitor = await rpc(3001, {});
    if (typeof monitor.cpu_cores !== 'number' || !Array.isArray(monitor.processes)) throw new Error('Monitor did not return host metrics');
    const git = await rpc(1101, { path: home });
    if (typeof git.git_available !== 'boolean' || typeof git.available !== 'boolean') throw new Error('Git capability response missing');
    assertions.push('streamed download SHA-256 integrity, byte range, and cancellation', 'target host monitoring and Git repository capability');
    const created = await rpc(2001, { name: 'Web entry terminal qualification', working_dir: home });
    terminalID = (created.session as Record<string, JsonValue>).id as string;
    let presentations = '';
    const presentationText = (value: unknown): string => {
      if (Array.isArray(value)) return value.map(presentationText).join('');
      if (value && typeof value === 'object') {
        const item = value as Record<string, unknown>;
        if (typeof item.text === 'string') return item.text;
        return Object.values(item).map(presentationText).join('');
      }
      return '';
    };
    const live = await connectTerminalLive({
      openStream: async (kind, options) => {
        const stream = await current.openStream(kind, options);
        return { read: () => stream.read(), write: async data => { await stream.write(data); }, close: () => stream.close(), reset: () => stream.reset() };
      },
      attach: { sessionId: terminalID, connectionId: 'web-' + crypto.randomUUID(), attachGeneration: 1, cols: 80, rows: 24 },
      onPresentation: value => { presentations += presentationText(value); },
      signal: AbortSignal.timeout(20_000),
    });
    try {
      const resized = await live.resizeWithEffectiveGeometry(100, 30);
      if (resized.effective.cols !== 100 || resized.effective.rows !== 30) throw new Error('Terminal resize not applied');
      const marker = 'verified_' + crypto.randomUUID();
      const command = 'printf "%s" "' + marker + '" > ' + name + '\rprintf "WEB_%s_%s\\n" ENTRY OUTPUT\r';
      await live.sendInput(new TextEncoder().encode(command));
      let written = false;
      for (let i = 0; i < 60; i++) {
        const result = await rpc(1002, { path: filePath, encoding: 'utf8' });
        written = result.content === marker;
        if (written && presentations.includes('WEB_ENTRY_OUTPUT')) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!written || !presentations.includes('WEB_ENTRY_OUTPUT')) throw new Error('Terminal input/output did not complete: ' + JSON.stringify({written, outputObserved:presentations.includes('WEB_ENTRY_OUTPUT')}));
      assertions.push('file write/read content integrity', 'real terminal input, output, and resize through published Floeterm SDK');
      const repo = home + '/' + name + '-repo';
      repositoryPath = repo;
      await live.sendInput(new TextEncoder().encode('mkdir '+name+'-repo && cd '+name+'-repo && git init -q && git config user.name CenterQualification && git config user.email center-qualification@example.invalid && printf seed > initial.txt && git add initial.txt && git commit -qm initial'+String.fromCharCode(13)));
      let available = false;
      for (let i=0;i<60;i++) {
        try {
          const resolved=await rpc(1101,{path:repo});
          if(resolved.available===true) {
            const history = await rpc(1102, {repo_root_path: repo});
            if (Array.isArray(history.commits) && history.commits.length === 1) {available=true;break;}
          }
        } catch (error) {
          // Terminal execution is asynchronous; the directory may not exist yet.
          if (!(error instanceof Error) || !error.message.includes('404 not found')) throw error;
        }
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!available)throw new Error('Isolated Git repository did not initialize');
      await rpc(1003,{path:repo+'/browser.txt',content:'Committed through Web Center',encoding:'utf8'});
      await rpc(1108,{repo_root_path:repo,paths:['browser.txt']});
      await rpc(1109,{repo_root_path:repo,paths:['browser.txt']});
      await rpc(1108,{repo_root_path:repo,paths:['browser.txt']});
      const committed=await rpc(1110,{repo_root_path:repo,message:'test: commit from web environment'});
      if(typeof committed.head_commit!=='string' || !committed.head_commit)throw new Error('Git commit omitted committed identity');
      const history=await rpc(1102,{repo_root_path:repo});
      if(!Array.isArray(history.commits) || history.commits.length<2)throw new Error('Git mutation did not reach history');
      assertions.push('isolated target Git stage, unstage, commit and history through Runtime RPC');
    } finally { await live.close(); }
  } finally {
    try {
      if (terminalID) await rpc(2009, { session_id: terminalID });
      if (repositoryPath) await rpc(1006, { path: repositoryPath, recursive: true });
      if (fileCreated) await rpc(1006, { path: filePath });
    } finally { await current.close(); }
  }
  return assertions;
}


export async function createNativeDownloadProbe() {
  const { current } = await openRuntimeSession();
  const rpc = async (type: number, payload: JsonValue) => {
    const result = await current.rpc.call(type, payload, value => value, { signal: AbortSignal.timeout(10000) });
    if (!result.ok) throw new Error('Download probe RPC rejected: ' + type + ' ' + result.error.code);
    return result.payload as Record<string, JsonValue>;
  };
  try {
    const owner = await rpc(1010, {});
    const home = String(owner.agent_home_path_abs);
    const name = 'center-download-' + crypto.randomUUID() + '.txt';
    const path = home + '/' + name;
    const content = 'Center native download integrity λ 中\n'.repeat(1024);
    await rpc(1003, { path, content, encoding: 'utf8' });
    return { home, name, content, async close() {
      // Native picker interaction can outlive an idle fixture connection.
      // Acquire fresh authority for cleanup instead of retaining that lease.
      const { current: cleanup } = await openRuntimeSession();
      try {
        const result = await cleanup.rpc.call(1006, { path }, value => value, { signal: AbortSignal.timeout(10000) });
        if (!result.ok) throw new Error('Download probe cleanup rejected: ' + result.error.code);
      } finally { await cleanup.close(); }
    } };
  } finally {
    await current.close();
  }
}

export async function createManualInputProbe() {
  const { current } = await openRuntimeSession();
  const rpc = async (type: number, payload: JsonValue) => {
    const result = await current.rpc.call(type, payload, value => value, { signal: AbortSignal.timeout(10_000) });
    if (!result.ok) throw new Error('Manual input probe RPC rejected: ' + type + ' ' + result.error.code);
    return result.payload as Record<string, JsonValue>;
  };
  const owner = await rpc(1010, {});
  const home = owner.agent_home_path_abs;
  if (typeof home !== 'string' || !home) {
    await current.close();
    throw new Error('Manual input probe has no isolated home');
  }
  const inventory = await rpc(2002, {});
  const priorSessions = (inventory.sessions as { id: string }[]).map(session => session.id);
  const marker = 'CENTER_MANUAL_' + crypto.randomUUID().replaceAll('-', '');
  const path = home + '/center-manual-' + crypto.randomUUID();
  let created = false;
  return {
    path, marker, priorSessions,
    async verify() {
      const result = await current.rpc.call(1002, { path, encoding: 'utf8' }, value => value, { signal: AbortSignal.timeout(5000) });
      if (!result.ok) return false;
      created = true;
      if ((result.payload as Record<string, JsonValue>).content !== marker) throw new Error('Manual terminal input changed the marker');
      return true;
    },
    async close(sessionID: string) {
      try {
        if (sessionID && !priorSessions.includes(sessionID)) await rpc(2009, { session_id: sessionID });
        if (created) await rpc(1006, { path });
      } finally { await current.close(); }
    },
  };
}

type TerminalRecoveryProbe = { path: string; startsPath: string; marker: string; priorSessions: string[]; sessionID?: string };

export async function createTerminalRecoveryProbe(): Promise<TerminalRecoveryProbe> {
  const { current } = await openRuntimeSession();
  try {
    const owner = await current.rpc.call(1010, {}, value => value);
    const inventory = await current.rpc.call(2002, {}, value => value);
    if (!owner.ok || !inventory.ok) throw new Error('Terminal recovery setup rejected');
    const home = (owner.payload as Record<string, JsonValue>).agent_home_path_abs;
    if (typeof home !== 'string' || !home) throw new Error('Recovery fixture home missing');
    const path = home + '/center-recovery-' + crypto.randomUUID();
    for (const file of [path, path + '-starts']) {
      const created = await current.rpc.call(1003, { path: file, content: '', encoding: 'utf8' }, value => value);
      if (!created.ok) throw new Error('Recovery fixture file initialization rejected');
    }
    return { path, startsPath: path + '-starts', marker: crypto.randomUUID(), priorSessions: ((inventory.payload as Record<string, JsonValue>).sessions as { id: string }[]).map(item => item.id) };
  } finally { await current.close(); }
}

export async function inspectTerminalRecoveryProbe(probe: TerminalRecoveryProbe, cleanup = false) {
  const { current } = await openRuntimeSession();
  const rpc = async (type: number, payload: JsonValue) => {
    const result = await current.rpc.call(type, payload, value => value, { signal: AbortSignal.timeout(10000) });
    if (!result.ok) throw new Error('Terminal recovery RPC rejected: ' + type + ' ' + result.error.code);
    return result.payload as Record<string, JsonValue>;
  };
  try {
    if (!probe.sessionID || probe.priorSessions.includes(probe.sessionID)) throw new Error('Terminal recovery must own its session');
    if (cleanup) {
      await rpc(2009, { session_id: probe.sessionID });
      await rpc(1006, { path: probe.path });
      await rpc(1006, { path: probe.startsPath });
      return { cleaned: true };
    }
    const inventory = await rpc(2002, {});
    const sessions = inventory.sessions as { id: string }[];
    if (sessions.filter(item => item.id === probe.sessionID).length !== 1 || sessions.length !== probe.priorSessions.length + 1) throw new Error('Recovery duplicated or lost its terminal');
    const counter = String((await rpc(1002, { path: probe.path, encoding: 'utf8' })).content);
    const starts = String((await rpc(1002, { path: probe.startsPath, encoding: 'utf8' })).content);
    if (!starts || !counter) return { iteration: 0, terminalCount: sessions.length, startedOnce: false };
    if (starts !== probe.marker || !counter.startsWith(probe.marker + ':')) throw new Error('Recovery replayed a command or changed its output');
    const iteration = Number(counter.slice(probe.marker.length + 1));
    if (!Number.isSafeInteger(iteration) || iteration < 1) throw new Error('Recovery counter invalid');
    return { iteration, terminalCount: sessions.length, startedOnce: true };
  } finally { await current.close(); }
}

export async function startControlledWorkload() {
  const { current, acquisition } = await openRuntimeSession();
  const rpc = async (type:number,payload:JsonValue) => {
    const result=await current.rpc.call(type,payload,value=>value,{signal:AbortSignal.timeout(10000)});
    if(!result.ok)throw new Error('Controlled workload RPC failed: '+type+' '+result.error.code);
    return result.payload as Record<string,JsonValue>;
  };
  const owner=await rpc(1010,{});
  const name='center-soak-'+crypto.randomUUID();
  const path=String(owner.agent_home_path_abs)+'/'+name;
  await rpc(1003,{path,content:'pending',encoding:'utf8'});
  const terminal=await rpc(2001,{name:'Center controlled workload',working_dir:String(owner.agent_home_path_abs)});
  const terminalID=(terminal.session as Record<string,JsonValue>).id as string;
  const abort=new AbortController();
  let flowerBytes=0, flowerEnded=false, terminalUpdates=0;
  const live=await connectTerminalLive({
    openStream:async(kind,options)=>{const stream=await current.openStream(kind,options);return {read:()=>stream.read(),write:async data=>{await stream.write(data);},close:()=>stream.close(),reset:()=>stream.reset()};},
    attach:{sessionId:terminalID,connectionId:name,attachGeneration:1,cols:80,rows:24},
    onPresentation:()=>{terminalUpdates++;},signal:abort.signal,
  });
  await live.resizeWithEffectiveGeometry(100,30);
  const flower=await fetch('/_redeven_proxy/api/ai/flower/stream',{headers:{'X-Redeven-Plugin-Session':acquisition.plugin_session_credential},signal:abort.signal});
  if(!flower.ok || !flower.body)throw new Error('Controlled Flower subscription rejected');
  const reader=flower.body.getReader();
  const pumping=(async()=>{try{while(true){const part=await reader.read();if(part.done)break;flowerBytes+=part.value.byteLength;}}finally{flowerEnded=true;}})().catch(error=>{if(!abort.signal.aborted)throw error;});
  void pumping.catch(()=>{});
  let iterations=0;
  return {
    async tick(){
      if(flowerEnded)throw new Error('Controlled Flower stream ended early');
      await current.probeLiveness({signal:AbortSignal.timeout(5000)});
      const marker=name+'-'+(++iterations);
      const quotedPath="'"+path.split("'").join("'\"'\"'")+"'";
      await live.sendInput(new TextEncoder().encode('printf "%s" "'+marker+'" > '+quotedPath+'\r'));
      let confirmed=false;
      for(let i=0;i<50;i++){
        confirmed=(await rpc(1002,{path,encoding:'utf8'})).content===marker;
        if(confirmed)break;await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!confirmed)throw new Error('Controlled terminal write not persisted');
      const bytes=await readFileBytesOnce({client:current,path});
      if(new TextDecoder().decode(bytes.bytes)!==marker)throw new Error('Controlled file stream content differs');
      return {iterations,terminalUpdates,flowerBytes,heapBytes:(performance as Performance & {memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize??null};
    },
    async close(){
      abort.abort();
      try{await live.close();await pumping;await rpc(2009,{session_id:terminalID});await rpc(1006,{path});}
      finally{await current.close();}
    },
  };
}

export async function observeEntryRevocation() {
  const { current } = await openRuntimeSession();
  let ended = false;
  void current.waitTermination().then(() => { ended = true; });
  return { ended: () => ended, close: () => current.close() };
}
