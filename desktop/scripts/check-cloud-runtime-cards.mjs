import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm,mkdir,copyFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import electron from 'electron';
import {chromium} from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
const desktop=fileURLToPath(new URL('../',import.meta.url));
const output=process.env.REDEVEN_CLOUD_CARD_ACCEPTANCE_DIR??path.join(desktop,'dist/cloud-runtime-cards');
await mkdir(output,{recursive:true});
execFileSync(path.join(desktop,'../scripts/check_desktop_electron_test_runtime.sh'),[desktop],{stdio:'inherit'});
const bundle=path.join(output,'bundle');
const gatewayBinary=path.join(bundle,'redeven-gateway');
const compatibility=JSON.parse(await readFile(path.join(desktop,'../internal/runtimeservice/compatibility_contract.json'),'utf8'));
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:desktop,encoding:'utf8'}).trim();
const sourceDirty=Boolean(execFileSync('git',['status','--porcelain'],{cwd:desktop,encoding:'utf8'}).trim());
const binaryIdentity=binary=>{
 const metadata=execFileSync('go',['version','-m',binary],{encoding:'utf8'});
 return {commit:/vcs.revision=([^\s]+)/u.exec(metadata)?.[1],dirty:/vcs.modified=([^\s]+)/u.exec(metadata)?.[1],
  flowersec:/github.com\/floegence\/flowersec\/flowersec-go\/v5\s+([^\s]+)/u.exec(metadata)?.[1]};
};
const runtimeBuild=binaryIdentity(path.join(bundle,'redeven')),gatewayBuild=binaryIdentity(gatewayBinary);
assert.equal(sourceDirty,false);assert.equal(runtimeBuild.commit,sourceCommit);assert.equal(runtimeBuild.dirty,'false');
assert.equal(gatewayBuild.commit,sourceCommit);assert.equal(gatewayBuild.dirty,'false');
const state=await mkdtemp(path.join(tmpdir(),'redeven-connection-cards-'));
const fixture=JSON.parse(await readFile(path.join(output,'cloud-config.json'),'utf8'));
fixture.agent_home_dir=path.join(state,'home');await mkdir(fixture.agent_home_dir,{recursive:true});
await mkdir(path.join(state,'local-environment'),{recursive:true});
await writeFile(path.join(state,'local-environment/config.json'),JSON.stringify(fixture)+'\n',{mode:0o600});
const require=createRequire(import.meta.url);
const prefs=require(path.join(desktop,'dist/main/desktopPreferences.js'));
const cloud=require(path.join(desktop,'dist/shared/desktopCloudEnvironment.js'));
const preferences=prefs.defaultDesktopPreferences();
const cloudModule=require(path.join(desktop,'dist/shared/cloud.js'));
const cloudSource=cloudModule.normalizeDesktopCloud({protocol_version:'rcpp-v5',cloud_id:fixture.cloud_id,
 display_name:'Redeven Cloud',cloud_origin:fixture.cloud_origin,documentation_url:`${fixture.cloud_origin}/help`,access_points:[{
 access_point_id:'dev',region:'dev',display_name:'Development',description:'',access_point_origin:fixture.access_point_origin,
 country_code:'SG',city:'Singapore',status:'active',health_status:'healthy',
 }]});assert.ok(cloudSource);
preferences.control_planes=[{cloud:cloudSource,account:{cloud_id:fixture.cloud_id,cloud_origin:fixture.cloud_origin,
 display_name:'Acceptance',user_public_id:'acceptance-user',user_display_name:'Acceptance',authorization_expires_at_unix_ms:1},
 display_label:'Acceptance Cloud',last_synced_at_ms:1}];
preferences.control_plane_refresh_tokens[cloudModule.desktopControlPlaneKey(fixture.cloud_origin,fixture.cloud_id)]='test-only-invalid-refresh-token';
preferences.cloud_environments=[cloud.createDesktopCloudEnvironmentRecord(fixture.cloud_origin,fixture.environment_id,{
 cloudID:fixture.cloud_id,region:'dev',accessPointID:'dev',accessPointOrigin:fixture.access_point_origin,label:'Dev Local',
})];
await prefs.saveDesktopPreferences(prefs.defaultDesktopPreferencesPaths(path.join(state,'desktop'),{stateRoot:state}),preferences,prefs.createPlaintextSecretCodec());
const loaded=await prefs.loadDesktopPreferences(prefs.defaultDesktopPreferencesPaths(path.join(state,'desktop'),{stateRoot:state}),prefs.createPlaintextSecretCodec());
assert.equal(loaded.cloud_environments.length,1);assert.equal(loaded.control_planes.length,1);
// Persist the owned test account with the same Electron secret codec as the
// production app before its preference cache is initialized.
const host=path.join(state,'electron-host');await mkdir(host,{recursive:true});
await writeFile(path.join(host,'package.json'),JSON.stringify({name:'@floegence/redeven-desktop',version:'0.1.0',main:'main.cjs'}));
await writeFile(path.join(host,'main.cjs'),`
const {app,safeStorage}=require('electron');
app.setAppPath(${JSON.stringify(desktop)});
app.setPath('userData',${JSON.stringify(path.join(state,'desktop'))});
app.whenReady().then(async()=>{
 const prefs=require(${JSON.stringify(path.join(desktop,'dist/main/desktopPreferences.js'))});
 await prefs.saveDesktopPreferences(prefs.defaultDesktopPreferencesPaths(app.getPath('userData'),{stateRoot:${JSON.stringify(state)}}),
  ${JSON.stringify(preferences)},prefs.createSafeStorageSecretCodec(safeStorage));
 require(${JSON.stringify(path.join(desktop,'dist/main/main.js'))});
}).catch(error=>{console.error(error);app.exit(1)});
`);
const marker=randomUUID();
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const runtimePort=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const child=spawn(electron,[host,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',
 '--host-resolver-rules=MAP redeven.test ~NOTFOUND, MAP dev.redeven.test ~NOTFOUND',`--redeven-connection-cards=${marker}`],{
 cwd:state,detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,
 REDEVEN_STATE_ROOT:state,REDEVEN_DESKTOP_USER_DATA_ROOT:path.join(state,'desktop'),REDEVEN_DESKTOP_TEMP_ROOT:path.join(state,'temp'),
 REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT:bundle,REDEVEN_DESKTOP_BUNDLE_VERSION:'v0.0.0-dev',REDEVEN_DESKTOP_AUTO_START_RUNTIME:'0',
 REDEVEN_DESKTOP_LOCAL_UI_BIND:`127.0.0.1:${runtimePort}`}});
const floeVersion=JSON.parse(await readFile(path.join(desktop,'node_modules/@floegence/floe-webapp-core/package.json'),'utf8')).version;
const report={status:'running',sourceCommit,sourceDirty,runtimeBuild,gatewayBuild,nodeVersion:process.version,floeVersion,pid:child.pid,marker,state,runtimePort,cases:[],gateways:[]};
const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
let diagnostic='',browser,page,action,snapshot;
child.stdout.on('data',bytes=>{diagnostic+=bytes.toString()});
const signal=()=>{if(child.exitCode===null&&child.signalCode===null)process.kill(-child.pid,'SIGTERM')};
const timer=setTimeout(signal,240000);
try{
 const endpoint=await Promise.race([new Promise(resolve=>child.stderr.on('data',bytes=>{diagnostic+=bytes.toString();const found=/DevTools listening on (ws:\/\/[^\s]+)/u.exec(diagnostic);if(found)resolve(found[1])})),exited.then(result=>{throw new Error(`Desktop exited before CDP: ${JSON.stringify(result)}`)})]);
 report.cdpPort=Number(new URL(endpoint).port);browser=await chromium.connectOverCDP(endpoint);
 const context=browser.contexts()[0];page=context.pages()[0]??await context.waitForEvent('page');
 await page.waitForFunction(()=>Boolean(window.redevenDesktopLauncher));
 assert.ok(page.url().includes(desktop)||page.url().includes('redeven'),`Unexpected Desktop page: ${page.url()}`);
 await page.evaluate(async()=>{await window.redevenDesktopLanguage.setPreference('en-US');await window.redevenDesktopShell.openConnectionCenter()});
 snapshot=()=>page.evaluate(()=>window.redevenDesktopLauncher.getSnapshot());
 const waitSnapshot=async(check,timeout=60000)=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await snapshot();if(check(value))return value;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Runtime snapshot did not reach the expected state');};
 action=request=>page.evaluate(request=>window.redevenDesktopLauncher.performAction(request),request);
 let current=await snapshot();let local=current.environments.find(entry=>entry.kind==='local_environment');
 const started=await action({kind:'start_environment_runtime',environment_id:local.id});
 if(!started.ok)report.failedRuntimeStart=started;
 assert.equal(started.ok,true);
 await waitSnapshot(snapshot=>snapshot.environments.find(entry=>entry.kind==='local_environment')?.runtime_service?.compatibility_epoch===compatibility.compatibility_epoch);
 report.cases.push(`production Desktop and live Runtime report compatibility epoch ${compatibility.compatibility_epoch}`);
 const cloudID=preferences.cloud_environments[0].id;
 const assertCloudCard=async expectedGateways=>{
  await page.waitForFunction(({cloudID,expectedGateways})=>{
   const cards=[...document.querySelectorAll('[data-environment-group]')];
   const tabs=cards[0]?.querySelectorAll('[role=tab]');
   return cards.length===1&&cards[0].getAttribute('data-environment-group')==='local'
    &&[...tabs??[]].some(tab=>tab.textContent.trim()==='Cloud')
    &&tabs.length===(expectedGateways?3:2)&&!document.querySelector(`[data-environment-group="${cloudID}"]`);
  },{cloudID,expectedGateways},{timeout:15000});
  const value=await waitSnapshot(snapshot=>(snapshot.environments.find(entry=>entry.kind==='local_environment')?.runtime_service?.gateway_memberships?.length??0)===expectedGateways);const runtime=value.environments.find(entry=>entry.kind==='local_environment');
  const remote=value.environments.find(entry=>entry.id===cloudID);
  assert.equal(runtime.runtime_service.bindings.cloud_link.state,'linked');
  assert.equal(remote.access_group_id,runtime.id);
  assert.equal(runtime.runtime_service.gateway_memberships?.length??0,expectedGateways);
  const card=page.locator('[data-environment-group="local"]');
  assert.deepEqual(await card.getByRole('tab').allTextContents(),expectedGateways?['Local','Cloud','Gateway']:['Local','Cloud']);
  await card.getByRole('tab').nth(1).click();
  const tab=card.getByRole('tab').nth(1); const panelID=await tab.getAttribute('aria-controls'); assert.ok(panelID); const panel=card.locator(`[id="${panelID}"]`); assert.equal(await panel.getAttribute('aria-labelledby'),await tab.getAttribute('id')); await panel.waitFor();
  return card;
 };
 await page.getByRole('button',{name:'Environments',exact:true}).first().click();
 await assertCloudCard(0);
 report.cases.push('real Cloud exchange config produces Local and offline Cloud tabs in one card');
 for(let index=0;index<2;index++){
  const label=index?'Lab':'Office';const dataRoot=path.join(state,`gateway-${index}`);
  assert.equal((await action({kind:'upsert_gateway',display_name:label,connection_kind:'local_host',host_access:{kind:'local_host'},placement:{kind:'host_process',runtime_root:dataRoot,release_base_url:''}})).ok,true);
  current=await snapshot();const source=current.gateway_sources.find(item=>item.display_name===label);assert.ok(source);
  const serviceRoot=path.join(dataRoot,'gateways',source.gateway_id,'state');report.gateways.push({id:source.gateway_id,serviceRoot});
  await mkdir(path.join(serviceRoot,'managed','bin'),{recursive:true});
  await copyFile(gatewayBinary,path.join(serviceRoot,'managed','bin','redeven-gateway'));
  await writeFile(path.join(serviceRoot,'managed','managed-gateway.stamp'),`schema_version=3\ninstalled_by=redeven-desktop\nslot_release_tag=v0.0.0-dev\nsource_commit=${sourceCommit}\ninstall_strategy=desktop_upload\n`);
  execFileSync(gatewayBinary,['service-start','--state-root',serviceRoot,'--member-listen','127.0.0.1:0'],{stdio:'pipe'});
  execFileSync(gatewayBinary,['service-stop','--state-root',serviceRoot],{stdio:'pipe'});
  const trustPath=path.join(serviceRoot,'gateway-trust.json');
  const trust=JSON.parse(await readFile(trustPath,'utf8'));trust.gateway.display_name=label;
  await writeFile(trustPath,JSON.stringify(trust)+'\n');
  const started=await action({kind:'start_gateway',gateway_id:source.gateway_id});
  if(!started.ok)report.failedGatewayStart=started;
  assert.equal(started.ok,true);
  assert.equal((await action({kind:'pair_gateway',gateway_id:source.gateway_id})).ok,true);
  current=await snapshot();const paired=current.gateway_sources.find(item=>item.gateway_id===source.gateway_id);
  assert.equal(paired.permissions.manage_members,true);
  const active=paired.active_listener_addresses?.[0];assert.ok(active,`No listener in ${JSON.stringify(paired.service_state)}`);
  const address=`https://${active}`;new URL(address);
  assert.equal((await action({kind:'update_gateway_network_settings',gateway_id:source.gateway_id,settings:{listen_addresses:paired.listener_addresses,allowed_hosts:[],endpoints:[{endpoint_id:'local',address,scope:'lan',priority:0}]}})).ok,true);
  const invitation=await action({kind:'invite_gateway_runtime',gateway_id:source.gateway_id});assert.equal(invitation.ok,true);
  await page.getByRole('button',{name:'Environments',exact:true}).first().click();
  const card=page.locator(`[data-environment-group="${local.id}"]`);await card.waitFor();
  await card.getByRole('tab').first().click();
  const owner=card.locator('[role=tabpanel][aria-label="Local"]');await owner.getByRole('button',{name:'Actions',exact:true}).click();
  await page.getByRole('menuitem',{name:'Add Gateway access',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Connect and continue',exact:true}).click();await dialog.locator('input').nth(0).fill(invitation.gateway_invitation_code.share_address);await dialog.locator('input').nth(1).fill(invitation.gateway_invitation_code.code);
  await dialog.getByRole('button',{name:'Verify',exact:true}).click();await dialog.getByRole('button',{name:'Confirm and enable',exact:true}).click();
  await dialog.waitFor({state:'detached'});
  await waitSnapshot(snapshot=>{const members=snapshot.environments.find(entry=>entry.kind==='local_environment')?.runtime_service?.gateway_memberships??[];return members.length===index+1&&members.every(member=>member.phase==='joined')});
  await action({kind:'refresh_gateway_catalog',gateway_id:source.gateway_id});
  await waitSnapshot(snapshot=>snapshot.environments.find(entry=>entry.kind==='local_environment')?.runtime_service?.gateway_memberships?.length===index+1&&snapshot.environments.filter(entry=>entry.kind==='gateway_environment').length===index+1);
  report.ownership=(await snapshot()).environments.map(entry=>({id:entry.id,kind:entry.kind,owner:entry.access_group_id,member:entry.gateway_member?.runtime_public_id,fingerprint:entry.gateway_identity_fingerprint,memberships:entry.runtime_service?.gateway_memberships}));
  await page.waitForFunction(()=>document.querySelectorAll('[data-environment-group]').length===1,null,{timeout:10000});
  assert.equal(await page.locator('[data-environment-group]:visible').count(),1);
  await assertCloudCard(index+1);
  report.cases.push(`live ${label} WSS invitation exchange retains Local, Cloud and Gateway in one card`);
 }
 assert.equal((await action({kind:'stop_environment_runtime',environment_id:local.id})).ok,true);
 const configPath=path.join(state,'local-environment/config.json');
 const legacy=JSON.parse(await readFile(configPath,'utf8'));
 assert.ok(legacy.gateways[0]);
 const saved=await readFile(configPath,'utf8');
 legacy.gateway_membership_schema_version=2;
 await writeFile(configPath,JSON.stringify(legacy)+'\n',{mode:0o600});
 const rejected=await action({kind:'start_environment_runtime',environment_id:local.id});
 assert.equal(rejected.ok,false);
 assert.equal(await readFile(configPath,'utf8'),JSON.stringify(legacy)+'\n');
 await writeFile(configPath,saved,{mode:0o600});
 assert.equal((await action({kind:'start_environment_runtime',environment_id:local.id})).ok,true);
 await assertCloudCard(2);
 report.cases.push('retired Runtime configuration fails read-only; restoring the current configuration resumes both independent members');
 const card=await assertCloudCard(2);await card.getByRole('tab').last().click();
 await waitSnapshot(snapshot=>{const members=snapshot.environments.find(entry=>entry.kind==='local_environment')?.runtime_service?.gateway_memberships??[];return members.length===2&&members.every(member=>member.phase==='joined')});
 report.cases.push('both live Gateway member connections reach joined state');
 const panel=card.locator('[role=tabpanel][aria-label="Gateway"]');const selector=panel.getByRole('combobox');
 const runtime=(await snapshot()).environments.find(entry=>entry.kind==='local_environment');
 const lab=runtime.runtime_service.gateway_memberships.find(member=>member.gateway_name==='Lab');assert.ok(lab);
 await selector.selectOption(lab.gateway_id);await panel.getByRole('button',{name:'Actions',exact:true}).click();
 const menu=page.getByRole('menu');await menu.waitFor();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const menuBounds=await menu.boundingBox(),buttonBounds=await panel.getByRole('button',{name:'Actions',exact:true}).boundingBox();assert.ok(menuBounds.y+menuBounds.height<=buttonBounds.y+2);
 await page.screenshot({path:path.join(output,'real-desktop-menu.png')});
 await menu.getByRole('menuitem',{name:'Cancel Gateway pairing…',exact:true}).click();
 const confirmation=page.getByRole('dialog');await confirmation.getByText('Lab',{exact:true}).waitFor();assert.equal(await confirmation.getByRole('combobox').count(),0);
 await page.screenshot({path:path.join(output,'real-desktop-unpair-confirmation.png')});
 await confirmation.getByRole('button',{name:'Cancel pairing',exact:true}).click();await confirmation.waitFor({state:'detached'});
 await page.waitForFunction(()=>document.querySelectorAll('[data-environment-group]').length===1,null,{timeout:10000});
 await waitSnapshot(snapshot=>{const members=snapshot.environments.find(entry=>entry.kind==='local_environment')?.runtime_service?.gateway_memberships??[];return members.length===1&&members[0].gateway_name==='Office'});
 await page.waitForFunction(()=>{const panel=[...document.querySelectorAll('[role="tabpanel"]')].find(element=>element.getAttribute('aria-label')==='Gateway'&&element.getAttribute('aria-hidden')!=='true');return panel?.textContent?.includes('Office')&&!panel.querySelector('select')},null,{timeout:10000});
 await assertCloudCard(1);
 report.cases.push('upward menu removes only selected Lab pairing and preserves Cloud plus live Office membership');
 assert.equal(await page.locator('[data-environment-group]:visible').count(),1);
 await page.locator('[data-floe-dialog-overlay-root]').waitFor({state:'detached'});
 report.remainingMemberships=(await snapshot()).environments.find(entry=>entry.kind==='local_environment').runtime_service.gateway_memberships;
 await page.screenshot({path:path.join(output,'real-desktop-cloud-tab.png')});
 await card.getByRole('tab').last().click();
 await page.screenshot({path:path.join(output,'real-desktop-gateway-tab.png')});
 report.binding=(await snapshot()).environments.find(entry=>entry.kind==='local_environment').runtime_service.bindings.cloud_link;
 report.status='passed';console.log(`PASS real Desktop connection cards (${report.cases.length} cases)`);
}catch(error){
 report.status='failed';report.error=String(error);
 const failedSnapshot=snapshot?await snapshot().catch(()=>null):null;
 report.lastMembershipCounts=failedSnapshot?.environments.map(entry=>({id:entry.id,kind:entry.kind,memberships:entry.runtime_service?.gateway_memberships?.map(m=>({name:m.gateway_name,phase:m.phase})),catalog:entry.gateway_member?.runtime_public_id}));
 report.panels=await page?.locator('[role="tabpanel"]').evaluateAll(elements=>elements.map(element=>({
  label:element.getAttribute('aria-label'),hidden:element.getAttribute('aria-hidden'),inert:element.inert,
  visibility:getComputedStyle(element).visibility,buttons:[...element.querySelectorAll('button')].map(button=>({
   label:button.getAttribute('aria-label'),text:button.textContent,visibility:getComputedStyle(button).visibility,
   bounds:button.getBoundingClientRect().toJSON(),display:getComputedStyle(button).display,
  })),
 }))).catch(()=>[]);
 await writeFile(path.join(output,'failure-diagnostics.log'),diagnostic,{mode:0o600});
 await page?.screenshot({path:path.join(output,'real-desktop-failure.png')}).catch(()=>{});throw error;
}
finally{
 clearTimeout(timer);
 for(const gateway of report.gateways){try{execFileSync(gatewayBinary,['service-stop','--state-root',gateway.serviceRoot],{stdio:'ignore',timeout:15000})}catch(error){report.cleanupError=String(error)}}
 if(action)await action({kind:'stop_environment_runtime',environment_id:'local'}).catch(()=>{});
 await browser?.close();
 signal();
 const stopped=await Promise.race([exited,new Promise(resolve=>setTimeout(()=>resolve(null),5000))]);
 if(!stopped&&child.exitCode===null&&child.signalCode===null){
  try{process.kill(-child.pid,'SIGKILL');report.cleanupError='The owned Desktop required SIGKILL after its bounded SIGTERM shutdown.'}catch(error){report.cleanupError=String(error)}
  await exited;
 }
 if((child.exitCode!==null||child.signalCode!==null)&&!report.cleanupError){
  try{await rm(state,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
  catch(error){report.cleanupError=String(error)}
 }
 if(report.cleanupError)report.status='failed';
 await writeFile(path.join(output,'real-desktop-report.json'),JSON.stringify(report,null,2)+'\n');
 if(report.cleanupError&&!report.error)throw new Error(report.cleanupError);
}
