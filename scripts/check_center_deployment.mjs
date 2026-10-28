import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { chromium } from '../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createServer } from 'node:net';

const release = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: node scripts/check_center_deployment.mjs <release directory>');
const root = await mkdtemp(path.join(tmpdir(),'redeven-center-deployment-'));
const state = path.join(root,'state');
const certificate = path.join(root,'tls.pem'), key = path.join(root,'tls-key.pem');
const reserve = createServer();
await new Promise(resolve => reserve.listen(0,'127.0.0.1',resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const origin = 'https://center.deployment.localhost:' + port;
execFileSync('mkcert',['-cert-file',certificate,'-key-file',key,'center.deployment.localhost'],{stdio:'pipe'});
const binary = path.join(release,'redeven-center');
const socket = path.join(root, 'connector.sock');
const args = ['serve','--state-root',state,'--origin',origin,'--listen','127.0.0.1:'+port,'--tls-cert',certificate,'--tls-key',key,'--assets',path.join(release,'ui'),'--connector-socket',socket,'--connector-user',String(process.getuid())];
const report = {scope:'Packaged standalone Center binary and actual browser; no business Runtime',status:'running',cases:[]};
let processOwner, browser;
const worker = spawn(binary,['connector','--connector-socket',socket,'--center-user',String(process.getuid())],{stdio:'ignore'});
const password = 'deployment-qualification-password';
async function start() {
 processOwner = spawn(binary,args,{stdio:['ignore','pipe','pipe']});
 processOwner.stdout.on('data',()=>{}); processOwner.stderr.on('data',()=>{});
 for (let i=0;i<100;i++) {
  try { await stat(path.join(state,'owner.sock')); return; } catch {}
  if (processOwner.exitCode !== null) throw new Error('Standalone Center exited before owner readiness');
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw new Error('Standalone Center owner socket not ready');
}
async function stop() { const child=processOwner; processOwner=undefined; if (!child || child.exitCode!==null) return; const done=new Promise(resolve=>child.once('exit',resolve)); child.kill('SIGTERM'); await done; }
function owner(command,offline=false) { return execFileSync(binary,[command,'--state-root',state,...(offline?['--offline','--origin',origin]:[])],{encoding:'utf8'}).trim(); }
function totp(secret) {
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; const bits=[...secret].map(c=>alphabet.indexOf(c).toString(2).padStart(5,'0')).join('');
 const key=Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2))); const step=Buffer.alloc(8);step.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const hash=createHmac('sha1',key).update(step).digest();return String((hash.readUInt32BE(hash.at(-1)&15)&0x7fffffff)%1000000).padStart(6,'0');
}
async function setup(page,token) {
 await page.getByLabel('One-time setup credential',{exact:true}).fill(token);
 await page.getByLabel('Entry password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 const secret=await page.getByTestId('totp-secret').textContent();
 await page.getByLabel('Authenticator code',{exact:true}).fill(totp(secret));
 await page.getByRole('button',{name:'Verify',exact:true}).click();
 const codes=(await page.getByTestId('recovery-codes').textContent()).trim().split(/\s+/);
 await page.getByLabel('I saved these recovery codes',{exact:true}).check();
 await page.getByRole('button',{name:'Continue',exact:true}).click(); return codes;
}
async function login(page,code) {
 await page.getByLabel('Entry password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Recovery code',exact:true}).click();
 await page.getByLabel('Recovery code',{exact:true}).fill(code);
 await page.getByRole('button',{name:'Verify',exact:true}).click();
 await page.getByRole('heading',{name:'Environments',exact:true}).first().waitFor();
}
try {
 await start(); browser=await chromium.launch({headless:true}); const context=await browser.newContext({locale:'en-US'}); const page=await context.newPage();
 await page.goto(origin); let codes=await setup(page,owner('setup')); await login(page,codes[0]);
 report.cases.push('Standalone package starts and completes owner-authorized three-step setup in Chromium without Runtime');
 const health=await page.evaluate(async()=> (await fetch('/healthz')).status); if(health!==200)throw new Error('Readiness failed');
 await stop(); await start(); await page.goto(origin); await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor(); await login(page,codes[1]);
 report.cases.push('Clean process restart preserves credentials and directory but invalidates old device sessions');
 let locked=false;try { owner('recover',true); } catch {locked=true;}if(!locked)throw new Error('Offline recovery acquired a running store');
 const token=owner('recover'); await page.reload(); await page.getByLabel('One-time setup credential',{exact:true}).waitFor();
 await stop(); await start(); await page.goto(origin); codes=await setup(page,token); await login(page,codes[0]);
 report.cases.push('Running owner recovery fences normal business and survives restart until new factors commit');
 await stop(); const offline=owner('recover',true); await start(); await page.goto(origin); codes=await setup(page,offline); await login(page,codes[0]);
 report.cases.push('Offline recovery requires exclusive stopped state and completes after startup');
 await stop(); const wrong=[...args]; wrong[wrong.indexOf('--origin')+1]='https://wrong.deployment.localhost:'+port;
 let rejected=false;try {execFileSync(binary,wrong,{stdio:'pipe'});}catch{rejected=true;}if(!rejected)throw new Error('Mismatched TLS hostname accepted');
 const keyBytes=await readFile(path.join(state,'center.key')); await rm(path.join(state,'center.key'));
 let missing=false;try {execFileSync(binary,args,{stdio:'pipe'});}catch{missing=true;}if(!missing)throw new Error('Missing key silently reset Center');
 await writeFile(path.join(state,'center.key'),keyBytes,{mode:0o600}); await start(); await stop();
 report.cases.push('Invalid certificate hostname and missing committed key fail closed; matching restored state starts');
 for(const file of ['center.key','center.sqlite'])if((await stat(path.join(state,file))).mode&0o077)throw new Error('State is not private');
 report.status='passed';console.log(JSON.stringify(report));
} catch(error){ report.status='failed';report.error=String(error);throw error;}
finally {await stop();await browser?.close();if(worker.exitCode===null){const done=new Promise(resolve=>worker.once('exit',resolve));worker.kill('SIGTERM');await done;}if(process.env.REDEVEN_CENTER_REPORT_DIR){await mkdir(process.env.REDEVEN_CENTER_REPORT_DIR,{recursive:true,mode:0o700});await writeFile(path.join(process.env.REDEVEN_CENTER_REPORT_DIR,'deployment-report.json'),JSON.stringify(report,null,2),{mode:0o600});}await rm(root,{recursive:true,force:true});}
