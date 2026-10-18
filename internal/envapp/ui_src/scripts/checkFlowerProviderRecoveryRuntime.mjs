#!/usr/bin/env node
// Qualify provider recovery through an isolated production Runtime and Flower UI.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], path.resolve(process.argv[i + 1]));
assert(args.has('--binary') && args.has('--output'), 'Required: --binary <bundled executable> --output <fresh evidence directory>');
const binary = args.get('--binary'), output = args.get('--output');
const root = path.resolve(import.meta.dirname, '../../../..');
const state = path.join(output, 'state'), workspace = path.join(output, 'workspace'), startup = path.join(output, 'startup.json');
const report = { passed: false, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  source_dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  runtime_sha256: createHash('sha256').update(await readFile(binary)).digest('hex'), runtimes: [], requests: [], scenarios: [] };
let runtime, browser, origin, log = '';
const counts = new Map();
const provider = http.createServer(async (request, response) => {
 try {
  if (request.url === '/v1/models') { response.end(JSON.stringify({data:[{id:'gpt-5-mini'}]})); return; }
  const chunks=[]; for await (const chunk of request) chunks.push(chunk);
  const input=JSON.parse(Buffer.concat(chunks));
  const main=input.tools?.length>0;
  const latest=JSON.stringify([...(input.input??[])].reverse().find(item=>item.role==='user' && JSON.stringify(item).includes('QUALIFY_'))??{});
  const mode=['AUTO','EXHAUST','STOP'].find(mode=>latest.includes('QUALIFY_'+mode))??'OTHER';
  const count=main?(counts.get(mode)??0)+1:0;
  if(main) counts.set(mode,count);
  report.requests.push({main,mode,count,at:new Date().toISOString()});
  response.setHeader('Content-Type','text/event-stream');
  const event=value=>response.write('data: '+JSON.stringify(value)+'\n\n');
  if(main && ((mode==='AUTO'&&count===1)||(mode==='EXHAUST'&&count<=5)||mode==='STOP')) {
   event({type:'response.output_text.delta',delta:'Unconfirmed transport draft'});
   response.flushHeaders();
   setTimeout(()=>response.destroy(),30);
   return;
  }
  const item={type:'message',id:'message-'+report.requests.length,role:'assistant',status:'completed',content:[{type:'output_text',text:'ACK',annotations:[]}]};
  event({type:'response.output_text.delta',delta:'ACK'});
  event({type:'response.completed',response:{id:'recovery-'+report.requests.length,status:'completed',output:[item],usage:{input_tokens:100,output_tokens:3,total_tokens:103}}});
  response.end();
 } catch(error) {report.provider_error=error.stack;response.destroy();}
});
async function until(read, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    assert(!runtime || (runtime.exitCode === null && runtime.signalCode === null), 'Runtime exited: ' + log);
    assert(!report.provider_error, report.provider_error);
    const value = await read(); if (value) return value; await delay(50);
  }
  throw new Error('Timed out: ' + label);
}
async function api(route, method = 'GET', body) {
  const response = await fetch(new URL(route, origin), { method, headers: { 'Content-Type': 'application/json', Origin: new URL(origin).origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  assert([200, 202].includes(response.status) && result.ok !== false, method + ' ' + route + ': ' + JSON.stringify(result));
  return result.data ?? result;
}
async function start() {
  await rm(startup, { force: true });
  runtime = spawn(binary, ['run', '--mode', 'local', '--state-root', state, '--local-ui-bind', '127.0.0.1:0', '--presentation', 'machine', '--startup-report-file', startup], { cwd: workspace, env: { ...process.env, GOWORK: 'off' }, stdio: ['ignore', 'pipe', 'pipe'] });
  runtime.stdout.on('data', bytes => { log += bytes; }); runtime.stderr.on('data', bytes => { log += bytes; });
  const ready = await until(async () => { try { return JSON.parse(await readFile(startup, 'utf8')); } catch { return null; } }, 'startup');
  assert.equal(ready.status, 'ready'); origin = ready.local_ui_url; report.runtimes.push({ pid: runtime.pid, origin, state });
  await until(async () => ['ready', 'degraded'].includes((await api('/api/local/runtime')).runtime_service.ai_readiness.state), 'AI readiness');
}
async function stop() {

  if (!runtime || runtime.exitCode !== null || runtime.signalCode !== null) return;
  const exited = new Promise(resolve => runtime.once('exit', resolve));
  runtime.kill('SIGTERM');
  let timeout;
  try { await Promise.race([exited, new Promise(resolve => { timeout = setTimeout(() => { runtime.kill('SIGKILL'); resolve(); }, 5000); })]); }
  finally { clearTimeout(timeout); }
  await exited;
}
try {
 await mkdir(output,{recursive:true});await mkdir(workspace,{recursive:true});
 assert(!await readFile(startup).then(()=>true,()=>false),'Use a fresh evidence directory');
 await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
 report.provider_port=provider.address().port;
 await start();await stop();
 const configFile=path.join(state,'local-environment/config.json');
 const config=JSON.parse(await readFile(configFile,'utf8'));config.agent_home_dir=workspace;await writeFile(configFile,JSON.stringify(config));
 await start();
 await api('/_redeven_proxy/api/ai/provider_bundle','PUT',{model_profile:{current_model_id:'fixture/gpt-5-mini',providers:[{id:'fixture',name:'Recovery qualification',type:'openai',base_url:'http://127.0.0.1:'+provider.address().port+'/v1',models:[{model_name:'gpt-5-mini',input_modalities:['text'],context_window:128000,max_output_tokens:8192}]}]},provider_api_key_patches:[{provider_id:'fixture',api_key:'qualification-only'}],web_search_provider_key_patches:[]});
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:960},locale:'en-US'});
 const page=await context.newPage();await page.goto(new URL('/_redeven_proxy/env/',origin).href);
 await page.locator('[data-workbench-dock-action="tessiven"]').waitFor();
 const opened=context.waitForEvent('page');await page.locator('[data-workbench-dock-action="tessiven"]').click();
 const canvas=await opened;
 await canvas.locator('.tessiven-library-card').first().waitFor();
 await canvas.getByRole('button',{name:'Commerce / Example',exact:true}).click();
 const surface=canvas.locator('.tessiven-flower-output');
 const composer=surface.locator('.flower-composer textarea');await composer.waitFor();
 let id,route;
 const send=async mode=>{
  const receipt=canvas.waitForResponse(r=>r.request().method()==='POST'&&/\/ai\/(?:threads\/[^/]+\/)?turns$/.test(new URL(r.url()).pathname));
  await composer.fill('QUALIFY_'+mode+': reply ACK.');
  await surface.locator('.flower-composer').getByRole('button',{name:'Send',exact:true}).click();
  const admitted=(await(await receipt).json()).data;id=admitted.thread_id;route='/_redeven_proxy/api/ai/threads/'+id;return admitted.current.turn_id;
 };
 const completed=async turn=>until(async()=>{const d=await api(route);return d.current.turn_id===turn&&d.current.activity==='idle'&&d.current.last_outcome==='completed'?d:null;},'completed turn');
 const first=await send('AUTO');
 await until(async()=>{const d=await api(route);return d.current.run_progress?.retry;},'automatic recovery progress');
 await canvas.screenshot({path:path.join(output,'recovering.png')});
 const recovered=await completed(first);assert.equal(counts.get('AUTO'),2);assert(!JSON.stringify(recovered.current.items).includes('Unconfirmed transport draft'));
 report.scenarios.push('disconnect-auto-recovery-success-same-turn');
 const exhaustedTurn=await send('EXHAUST');
 const failed=await until(async()=>{const d=await api(route);return d.current.turn_id===exhaustedTurn&&d.current.activity==='idle'&&d.current.last_outcome==='failed'?d:null;},'retry exhaustion');
 assert.equal(counts.get('EXHAUST'),5);assert.equal(failed.thread.run_error_code,'provider_stream_interrupted');
 await surface.getByRole('button',{name:'Retry reply',exact:true}).waitFor();
 await canvas.screenshot({path:path.join(output,'exhausted.png')});
 await surface.getByRole('button',{name:'Retry reply',exact:true}).click();
 await until(async()=>{const d=await api(route);return d.current.activity==='idle'&&d.current.last_outcome==='completed';},'manual retry completion');
 assert.equal(counts.get('EXHAUST'),6);report.scenarios.push('bounded-exhaustion-manual-retry-success');
 await send('STOP');
 await until(async()=>{const d=await api(route);return d.current.run_progress?.retry;},'stop during recovery');
 await surface.getByRole('button',{name:'Stop',exact:true}).click();
 const stopped=await until(async()=>{const d=await api(route);return d.current.activity==='idle'?d:null;},'stopped recovery');
 assert.equal(stopped.current.last_outcome,'cancelled');const stoppedCount=counts.get('STOP');
 await delay(1500);assert.equal(counts.get('STOP'),stoppedCount);assert(await composer.isEnabled());
 report.scenarios.push('stop-cancels-retry-no-further-dispatch');
 await canvas.setViewportSize({width:360,height:640});await canvas.screenshot({path:path.join(output,'stopped-mobile.png')});
 report.passed=true;
} finally {
 await browser?.close();await stop();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));
 await writeFile(path.join(output,'runtime.log'),log);await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 if(report.passed) await rm(state,{recursive:true,force:true});
}
console.log(JSON.stringify(report,null,2));
