import { build } from 'esbuild';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const cache = path.resolve('node_modules/.cache');
await mkdir(cache, { recursive: true });
const root = await mkdtemp(path.join(cache, 'native-remote-'));
let peer;
try {
  const cert = path.join(root, 'cert.pem'),
    key = path.join(root, 'key.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    { stdio: 'ignore' },
  );
  const launcher = 'https://cs-space.region.example.test';
  peer = spawn(
    process.env.REDEVEN_NATIVE_REMOTE_PEER,
    [
      '--certificate',
      cert,
      '--private-key',
      key,
      '--allowed-origin',
      launcher,
      '--native-codespace',
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  let text = '';
  const ready = await new Promise((resolve, reject) => {
    peer.stdout.on('data', (data) => {
      text += data;
      for (const line of text.split('\n')) {
        try {
          const value = JSON.parse(line);
          if (value.type === 'ready') resolve(value);
        } catch {}
      }
    });
    peer.once('exit', () => reject(new Error('peer exited before readiness')));
  });
  await build({
    entryPoints: [
      'src/main/codespaceNativeRemote.ts',
      'src/main/codespaceNativeGateway.ts',
    ],
    outdir: root,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outExtension: { '.js': '.cjs' },
    external: ['electron'],
  });
  await writeFile(
    path.join(root, 'input.json'),
    JSON.stringify({ ready, launcher }),
  );
  const worker = String.raw`
 const fs=require('node:fs');const assert=require('node:assert/strict');const crypto=require('node:crypto');
 const {createRemoteNativeCodeSpaceRoute}=require('./codespaceNativeRemote.cjs');const {createNativeCodeSpaceGateway,CODESPACE_NATIVE_AUTH_HEADER}=require('./codespaceNativeGateway.cjs');
 const {ready,launcher}=JSON.parse(fs.readFileSync(__dirname+'/input.json'));
 const hash=s=>crypto.createHash('sha256').update(s).digest('base64url');
 const projection=JSON.stringify({scope:'proxy.runtime',scope_version:2,critical:true,payload:{version:2,appBasePath:'/',mode:'controller_bridge',controllerBridge:{allowedOrigins:['https://app.native.test']}}});
 const binding={v:1,kind:'codespace',env_public_id:'env',floe_app:'com.floegence.redeven.code',code_space_id:'space',launcher_kind:'cs',launcher_id:'space'};
 let spends=0,entries=0;
 const webSession={fetch:async(url,options)=>{
  if(url.endsWith('/entry')&&!url.includes('/artifact/')){entries++;assert.equal(JSON.parse(options.body).session_kind,'codeapp');return Response.json({success:true,data:{entry_ticket:'entry'}})}
  if(url.endsWith('/artifact/spend')){spends++;assert.deepEqual(JSON.parse(options.body).target_binding,binding);return new Response(null,{status:204})}
  assert.equal(url,launcher+'/v1/connect/artifact/entry');
  const payload={v:6,env_public_id:'env',floe_app:'com.floegence.redeven.code',code_space_id:'space',app_path:'/',launcher_kind:'cs',launcher_id:'space',launcher_origin:launcher,runtime_origin:'https://runtime.native.test',app_origin:'https://app.native.test',acquisition:{v:1,connect_artifact:ready.artifact,critical_scope_projection_json:projection,spend_scope:{v:1,receipt:'r1.k.'+Buffer.alloc(32,7).toString('base64url'),artifact_digest_b64u:hash(ready.artifact),projection_digest_b64u:hash(projection),launcher_origin:launcher,runtime_origin:'https://runtime.native.test',app_origin:'https://app.native.test',consumer:'isolated',target_binding:binding,expires_at:ready.expires_at}}};
  return Response.json({v:6,runtime_origin:payload.runtime_origin,runtime_handoff_b64u:Buffer.from(JSON.stringify(payload)).toString('base64url')});
 }};
 const watchdog=setTimeout(()=>{console.error('remote fixture timed out');process.exit(1)},25000);
 (async()=>{const signal=AbortSignal.timeout(20000);await assert.rejects(createRemoteNativeCodeSpaceRoute({webSession,environmentOrigin:'https://env-env.region.example.test',envPublicID:'wrong',codeSpaceID:'space',password:'native-secret',signal}));assert.equal(spends,0);entries=0;const route=await createRemoteNativeCodeSpaceRoute({webSession,environmentOrigin:'https://env-env.region.example.test',envPublicID:'env',codeSpaceID:'space',password:'native-secret',signal});const gateway=await createNativeCodeSpaceGateway(route);try{const bytes=Buffer.alloc(1024*1024+321,0xab);const response=await fetch(gateway.origin+'/echo?x=%2F&x=2',{method:'POST',headers:{[CODESPACE_NATIVE_AUTH_HEADER]:gateway.token},body:bytes,signal});assert.equal(response.status,200);assert.equal(response.headers.get('x-native-path'),'/echo?x=%2F&x=2');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal(entries,1);assert.equal(spends,1);console.log('Native remote: isolated artifact, spend binding, Node TLS session, access password, raw HTTP, and binary body passed');}finally{await gateway.close()}})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>clearTimeout(watchdog));`;
  await writeFile(path.join(root, 'worker.cjs'), worker);
  const child = spawn(process.execPath, [path.join(root, 'worker.cjs')], {
    stdio: 'inherit',
    env: { ...process.env, NODE_EXTRA_CA_CERTS: cert },
  });
  const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
  const [code] = await once(child, 'exit');
  clearTimeout(timer);
  assert.equal(code, 0);
} finally {
  if (peer && peer.exitCode === null) {
    peer.stdin.end();
    await once(peer, 'exit');
  }
  await rm(root, { recursive: true, force: true });
}
