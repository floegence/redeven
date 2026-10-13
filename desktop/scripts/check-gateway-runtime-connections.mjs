import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import {createSSHSettingsPreviewServer} from './ssh-settings-preview.mjs';

const output=fileURLToPath(new URL('../dist/gateway-runtime-connections/',import.meta.url));
await mkdir(output,{recursive:true});
const server=await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser=await chromium.launch({headless:true});
const report={cases:[],errors:[]};
try {
 const load=relative=>server.ssrLoadModule(fileURLToPath(new URL(relative,import.meta.url)));
 const {runtimeConnectionFixture}=await load('../src/testSupport/runtimeConnectionFixture.ts');
 const {runtimeGatewayAccessFixture}=await load('../src/testSupport/runtimeGatewayAccessFixture.ts');
 const {buildDesktopWelcomeSnapshot}=await load('../src/main/desktopWelcomeState.ts');
 const {createDesktopI18n}=await load('../src/shared/i18n/index.ts');
 for(const locale of ['en-US','zh-CN','zh-TW','ja-JP','ko-KR','de-DE','fr-FR','es-ES','pt-BR','ru-RU']) {
  const i18n=createDesktopI18n(locale);
  for(const width of [430,1280]) {
   const {snapshot,memberships,inputs:fixtureInputs}=runtimeConnectionFixture({cloudManagement:false,gatewayWindow:true,
    cloudDirectoryAccessPointOrigin:'https://rotated-region.example.invalid'});
   const runtime=snapshot.environments.find(entry=>entry.kind==='local_environment');
   const context=await browser.newContext({viewport:{width,height:1050},reducedMotion:'reduce'});
   try {
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
    await page.addInitScript(({snapshot,locale})=>{
     window.settingsFixtureSnapshot=snapshot;
     const language={preference:locale,resolved_locale:locale,source:'explicit',system_candidates:[]};
     window.redevenDesktopLanguage={getSnapshot:()=>language,setPreference:()=>language,subscribe:()=>()=>{}};
    },{snapshot,locale});
    await page.goto(new URL('environment-settings.html',server.resolvedUrls.local[0]).href);
    await page.evaluate(()=>document.fonts.ready);
    await page.evaluate(({memberships,runtime})=>{
     window.settingsFixture.actionResult=request=>{
      if(request.kind!=='manage_runtime_gateway')return undefined;
      if(request.operation==='preview')return {ok:true,gateway_preview:{preview_id:'a'.repeat(43),purpose:'join',gateway_id:'next',gateway_name:'Gateway',target_runtime_id:'runtime',expires_at_unix_ms:Date.now()+300000,existing_environment_id:'existing'}};
      return {ok:true,gateway_membership:{joined:true,phase:'joined',existing_environment_id:'existing',memberships:memberships.map(item=>({...item,joined:true}))}};
     };
     window.gatewayAcceptanceRuntime=runtime;
    },{memberships,runtime});
    const card=page.locator(`[data-environment-group="${runtime.id}"]`);
    assert.equal(await page.locator('[data-environment-group]:visible').count(),8);
    assert.equal(await card.getByRole('tab').count(),3);
    const icons=await card.locator('[role="tab"] .redeven-owner-tab-icon > svg').evaluateAll(elements=>{
     const rem=parseFloat(getComputedStyle(document.documentElement).fontSize);
     return elements.map(element=>({width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height,rem}));
    });
    assert.equal(icons.length,3);
    assert.ok(icons.every(icon=>Math.abs(icon.width-icon.rem*.875)<.5 && Math.abs(icon.height-icon.rem*.875)<.5),JSON.stringify(icons));
    const bounds=await card.boundingBox();
    for(const tab of await card.getByRole('tab').all()) {
     await tab.click();
     const title=card.locator('[role="tabpanel"]:visible .redeven-environment-owner-heading').first();
     assert.ok((await title.textContent()).includes(runtime.label),'Runtime title survives connection selection');
     assert.ok(Math.abs((await card.boundingBox()).height-bounds.height)<1,'tabs retain original card geometry');
    }
    await page.screenshot({path:`${output}/${locale}-${width}-card.png`});
    await card.getByRole('tab').nth(2).click();
    const panel=card.getByRole('tabpanel',{name:i18n.t('gatewayConnections.tab'),exact:true});
    await panel.getByRole('combobox').selectOption('service-1');
    await panel.getByText('https://lab.internal:7443',{exact:true}).waitFor();
    const toggle=panel.getByRole('button',{name:i18n.t('environmentAction.runtimeActions'),exact:true});
    await toggle.focus();await page.keyboard.press('Enter');const menu=page.getByRole('menu');await menu.waitFor();
    await page.waitForFunction(([menu, toggle]) => menu.getBoundingClientRect().bottom <= toggle.getBoundingClientRect().top + 2,
      [await menu.elementHandle(), await toggle.elementHandle()]);
    const menuBounds=await menu.boundingBox(),toggleBounds=await toggle.boundingBox();
    await page.screenshot({path:`${output}/${locale}-${width}-menu.png`});
    assert.ok(menuBounds.y+menuBounds.height<=toggleBounds.y+2,`split menu must open upward: ${JSON.stringify({menuBounds,toggleBounds})}`);
    assert.ok(menuBounds.x>=0 && menuBounds.x+menuBounds.width<=width+1);
    await menu.getByRole('menuitem',{name:`${i18n.t('gatewayConnections.unpairTitle')}…`,exact:true}).waitFor();
    assert.equal(await menu.getByRole('separator').count(),1);
    await page.keyboard.press('End');
    assert.equal(await menu.getByRole('menuitem').last().evaluate(element => element === document.activeElement),true);
    await page.keyboard.press('Home');
    assert.equal(await menu.getByRole('menuitem').first().evaluate(element => element === document.activeElement),true);
    await page.screenshot({path:`${output}/${locale}-${width}-menu.png`});
    await page.keyboard.press('Escape');await menu.waitFor({state:'detached'});
    assert.equal(await toggle.evaluate(element => element === document.activeElement),true);
    await toggle.click();await page.getByRole('menu').getByRole('menuitem',{name:`${i18n.t('gatewayConnections.unpairTitle')}…`,exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.waitFor();
    assert.equal(await dialog.getByRole('combobox').count(),0);
    await dialog.getByText('Lab',{exact:true}).waitFor();
    const confirm=dialog.getByRole('button',{name:i18n.t('gatewayConnections.unpair'),exact:true});assert.equal(await confirm.isDisabled(),false);
    await dialog.getByText(i18n.t('gatewayConnections.cloudImpact'),{exact:true}).waitFor();
    await page.screenshot({path:`${output}/${locale}-${width}-unpair.png`});
    await dialog.getByRole('button',{name:i18n.t('common.cancel'),exact:true}).click();await dialog.waitFor({state:'detached'});
    await toggle.click();await page.getByRole('menu').getByRole('menuitem',{name:i18n.t('gatewayJoin.menuAction'),exact:true}).click();
    const join=page.getByRole('dialog');await join.waitFor();
    await join.getByRole('button',{name:i18n.t('gatewayJoin.connectAndContinue'),exact:true}).click();
    const inputs=join.locator('input');await inputs.nth(0).fill('https://draft.internal:7443');await inputs.nth(1).fill('TEST-ONLY-CODE');
    await page.evaluate(()=>window.settingsFixture.publish({...structuredClone(window.settingsFixtureSnapshot),snapshot_revision:4}));
    assert.equal(await inputs.nth(0).inputValue(),'https://draft.internal:7443');assert.equal(await inputs.nth(1).inputValue(),'TEST-ONLY-CODE');
    assert.equal(await inputs.nth(1).evaluate(element => element === document.activeElement),true);
    await join.getByRole('button',{name:i18n.t('gatewayJoin.verify'),exact:true}).click();
    await join.getByRole('button',{name:i18n.t('gatewayJoin.confirmEnable'),exact:true}).waitFor();
    assert.equal(await join.locator('input[type="radio"]').count(),0);
    for(const surface of [join]) {
     const bounds=await surface.boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+1);
     const controls=await surface.locator('button').evaluateAll(elements=>elements.map(element=>({width:element.scrollWidth,client:element.clientWidth,whiteSpace:getComputedStyle(element).whiteSpace})));
     assert.ok(controls.every(item=>item.width<=item.client+1 && item.whiteSpace==='nowrap'));
    }
    await page.screenshot({path:`${output}/${locale}-${width}-join.png`});
    await join.getByRole('button',{name:i18n.t('gatewayJoin.confirmEnable'),exact:true}).click();await join.waitFor({state:'detached'});
    const requests=await page.evaluate(()=>window.settingsFixture.requests);
    assert.equal(requests.filter(item=>item.operation==='leave').length,0);
    assert.ok(requests.some(item=>item.operation==='join' && item.preview_id && !item.environment_choice));
    const accessOnly=buildDesktopWelcomeSnapshot({...fixtureInputs,managedRuntimePresenceByTargetID:{},preferences:{...fixtureInputs.preferences,
      saved_environments:[{id:'https://runtime.example/',local_ui_url:'https://runtime.example/',label:'URL-only Runtime',pinned:false,created_at_ms:1,last_used_at_ms:1}],
    }});
    accessOnly.environments=accessOnly.environments.filter(entry=>['external_local_ui','provider_environment','gateway_environment'].includes(entry.kind));
    await page.evaluate(snapshot=>window.settingsFixture.publish({...snapshot,snapshot_revision:50}),accessOnly);
    for(const kind of ['external_local_ui','provider_environment','gateway_environment']) {
     const entry=accessOnly.environments.find(item=>item.kind===kind);assert.ok(entry,`missing access-only fixture: ${kind}`);
     const owner=page.locator(`[data-owner-id="${entry.id}"]`);await owner.waitFor({state:'visible'});
     const actions=owner.getByRole('button',{name:i18n.t('environmentAction.runtimeActions'),exact:true});
     if(await actions.count()) {
      await actions.click();const menu=page.getByRole('menu');await menu.waitFor();
      assert.equal(await menu.getByRole('menuitem',{name:i18n.t('gatewayJoin.menuAction'),exact:true}).count(),0);
      await page.keyboard.press('Escape');await menu.waitFor({state:'detached'});
     }
    }
    report.cases.push(`${locale}/${width}: original tabs, upward menu, explicit target, Cloud impact, retained draft and independent pairing`);
   } finally {await context.close();}
   for(const kind of ['local','ssh','wsl','local_container','ssh_container']) {
    const fixtures=Object.fromEntries(['unknown','stopped','control_missing','connection_required','ready','update_required','management_unavailable']
      .map(state=>[state,runtimeGatewayAccessFixture(kind,state)]));
    const runtime=fixtures.ready.environment;
    const context=await browser.newContext({viewport:{width,height:1050},reducedMotion:'reduce'});
    try {
     const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
     await page.addInitScript(({snapshot,locale})=>{
      window.settingsFixtureSnapshot=snapshot;
      const language={preference:locale,resolved_locale:locale,source:'explicit',system_candidates:[]};
      window.redevenDesktopLanguage={getSnapshot:()=>language,setPreference:()=>language,subscribe:()=>()=>{}};
     },{snapshot:fixtures.unknown.snapshot,locale});
     await page.goto(new URL('environment-settings.html',server.resolvedUrls.local[0]).href);
     await page.evaluate(()=>document.fonts.ready);
     await page.evaluate(({fixtures})=>{
      window.gatewayAcceptanceState='unknown';window.gatewayAcceptanceFailRecovery=false;
      window.gatewayAcceptanceRevision=20;
      window.gatewayAcceptancePublish=snapshot=>window.settingsFixture.publish({...snapshot,snapshot_revision:++window.gatewayAcceptanceRevision});
      window.settingsFixture.actionResult=request=>{
       if(request.kind==='refresh_environment_runtime') {
        if(['unknown','management_unavailable'].includes(window.gatewayAcceptanceState)) {
         window.gatewayAcceptanceState=window.gatewayAcceptanceState==='unknown'?'stopped':'ready';
         window.gatewayAcceptancePublish(fixtures[window.gatewayAcceptanceState].snapshot);
        }
        return {ok:true,outcome:'refreshed_environment_runtime'};
       }
       const outcomes={start_environment_runtime:'started_environment_runtime',restart_environment_runtime:'restarted_environment_runtime',update_environment_runtime:'updated_environment_runtime'};
       if(outcomes[request.kind]) {
        if(window.gatewayAcceptanceFailRecovery)return {ok:false,code:'action_invalid',scope:'environment',message:'Fixture recovery failed'};
        window.gatewayAcceptanceState='ready';window.gatewayAcceptancePublish(fixtures.ready.snapshot);
        return {ok:true,outcome:outcomes[request.kind]};
       }
       if(request.kind==='manage_runtime_gateway') {
        if(request.operation==='status' && window.gatewayAcceptanceFailConnection)return {ok:false,code:'cloud_link_failed',gateway_error_code:'RUNTIME_CONTROL_UNREACHABLE'};
        if(request.operation==='preview')return {ok:true,gateway_preview:{preview_id:'a'.repeat(43),purpose:'join',gateway_id:'office',gateway_name:'Office',target_runtime_id:'runtime',expires_at_unix_ms:Date.now()+300000}};
        return {ok:true,gateway_membership:{joined:false,phase:'not_joined'}};
       }
       return undefined;
      };
     },{fixtures});
     const card=page.locator(`[data-environment-group="${runtime.id}"]`);
     const toggle=card.getByRole('button',{name:i18n.t('environmentAction.runtimeActions'),exact:true});
     await toggle.focus();await page.keyboard.press('Enter');
     const menu=page.getByRole('menu');await menu.waitFor();
     const entry=menu.getByRole('menuitem',{name:i18n.t('gatewayJoin.menuAction'),exact:true});
     assert.equal(await entry.isDisabled(),false);await entry.click();
     const dialog=page.getByRole('dialog');await dialog.waitFor();
     await dialog.locator('[data-gateway-preparation="not_started"]').waitFor();
     await dialog.getByText(runtime.label,{exact:true}).waitFor();
     const lifecycle=()=>page.evaluate(()=>window.settingsFixture.requests.filter(request=>['start_environment_runtime','restart_environment_runtime','update_environment_runtime'].includes(request.kind)));
     assert.equal((await lifecycle()).length,0,'opening performs a read-only check');
     const preparationControls=await dialog.locator('button:visible').evaluateAll(elements=>elements.map(element=>({width:element.scrollWidth,client:element.clientWidth,whiteSpace:getComputedStyle(element).whiteSpace})));
     assert.ok(preparationControls.every(item=>item.width<=item.client+1 && item.whiteSpace==='nowrap'));
     await page.screenshot({path:`${output}/${locale}-${width}-${kind}-preparation.png`});
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.startAndContinue'),exact:true}).click();
     const inputs=dialog.locator('input');await inputs.nth(0).waitFor({state:'visible'});
     await inputs.nth(0).fill('https://office.example:7443');await inputs.nth(1).fill('DRAFT-CODE');
     await page.evaluate(snapshot=>window.gatewayAcceptancePublish(snapshot),fixtures.ready.snapshot);
     assert.equal(await inputs.nth(1).evaluate(element=>element===document.activeElement),true);
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.verify'),exact:true}).click();
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.confirmEnable'),exact:true}).waitFor();
     const publish=async state=>page.evaluate(({snapshot,state})=>{
      window.gatewayAcceptanceState=state;window.gatewayAcceptancePublish(snapshot);
     },{snapshot:fixtures[state].snapshot,state});
     for(const [state,key] of [['control_missing','environmentAction.restartRuntime'],['update_required','environmentAction.updateRuntime']]) {
      await publish(state);await dialog.locator(`[data-gateway-preparation="${state}"]`).waitFor();
      assert.equal(await inputs.nth(0).isDisabled(),true);
      await page.evaluate(()=>{window.gatewayAcceptanceFailRecovery=true;});
      await dialog.getByRole('button',{name:i18n.t(key),exact:true}).click();
      await dialog.getByText(i18n.t('gatewayJoin.recoveryFailed'),{exact:true}).waitFor();
      assert.equal(await inputs.nth(0).inputValue(),'https://office.example:7443');
      assert.equal(await inputs.nth(1).inputValue(),'DRAFT-CODE');
      assert.equal(await dialog.locator('.redeven-gateway-join-summary').textContent().then(text=>text.includes('Office')),true);
      await page.evaluate(()=>{window.gatewayAcceptanceFailRecovery=false;});
      await dialog.getByRole('button',{name:i18n.t(key),exact:true}).click();
      await dialog.getByRole('button',{name:i18n.t('gatewayJoin.confirmEnable'),exact:true}).waitFor();
     }
     await publish('management_unavailable');
     await dialog.getByText(i18n.t('gatewayJoin.credentialsHelp'),{exact:true}).waitFor();
     await dialog.getByRole('button',{name:i18n.t('common.retry'),exact:true}).click();
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.confirmEnable'),exact:true}).waitFor();
     assert.equal(await inputs.nth(1).inputValue(),'DRAFT-CODE');
     await page.evaluate(({snapshot,id})=>window.gatewayAcceptancePublish({...snapshot,action_progress:[{
      action:'restart_environment_runtime',environment_id:id,operation_key:'acceptance-operation',started_at_unix_ms:Date.now(),
      status:'running',phase:'checking_runtime_service',title:'Restart Runtime',detail:'',active_progress_surface:'runtime_lifecycle',cancelable:true,
     }]}),{snapshot:fixtures.ready.snapshot,id:runtime.id});
     await dialog.locator('[data-gateway-preparation="busy"]').waitFor();
     assert.equal(await dialog.getByRole('button',{name:i18n.t('common.settings'),exact:true}).isDisabled(),false);
     assert.equal(await inputs.nth(1).isDisabled(),true);
     await publish('ready');await dialog.getByRole('button',{name:i18n.t('gatewayJoin.confirmEnable'),exact:true}).waitFor();
     const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+1);
     const controls=await dialog.locator('button:visible').evaluateAll(elements=>elements.map(element=>({width:element.scrollWidth,client:element.clientWidth,whiteSpace:getComputedStyle(element).whiteSpace})));
     assert.ok(controls.every(item=>item.width<=item.client+1 && item.whiteSpace==='nowrap'));
     await page.screenshot({path:`${output}/${locale}-${width}-${kind}-setup.png`});
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.back'),exact:true}).click();
     assert.equal(await inputs.nth(1).inputValue(),'DRAFT-CODE');
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.back'),exact:true}).click();
     await publish('connection_required');
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.connectAndContinue'),exact:true}).waitFor();
     assert.equal(await inputs.nth(0).isVisible(),false);
     await page.screenshot({path:`${output}/${locale}-${width}-${kind}-connect.png`});
     await page.evaluate(()=>{window.gatewayAcceptanceFailConnection=true;});
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.connectAndContinue'),exact:true}).click();
     await dialog.getByText(i18n.t('gatewayJoin.connectFailed'),{exact:true}).waitFor();
     assert.equal(await dialog.locator('[data-gateway-step]').getAttribute('data-gateway-step'),'0');
     assert.equal(await inputs.nth(0).isVisible(),false);
     await page.evaluate(()=>{window.gatewayAcceptanceFailConnection=false;});
     await dialog.getByRole('button',{name:i18n.t('common.retry'),exact:true}).click();
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.confirmEnable'),exact:true}).waitFor();
     await dialog.getByRole('button',{name:i18n.t('common.cancel'),exact:true}).click();await dialog.waitFor({state:'detached'});
     await page.waitForFunction(element=>element===document.activeElement,await toggle.elementHandle());
     const requests=await page.evaluate(()=>window.settingsFixture.requests);
     assert.ok((await lifecycle()).every(request=>request.environment_id===runtime.id),'recovery stays on the original owner');
     assert.ok(requests.filter(request=>request.kind==='manage_runtime_gateway').every(request=>request.runtime_target_id===runtime.provider_runtime_link_target.id));
     assert.ok(requests.some(request=>request.operation==='status'));
     assert.equal(requests.filter(request=>request.operation==='join').length,0,'cancel never consumes an invitation');
     report.cases.push(`${locale}/${width}/${kind}: unchecked entry, horizontal steps, explicit bridge connection and failure, startup/recovery, retained preview, busy controls and focus return`);
    } finally {await context.close();}
   }
  }
 }
 assert.deepEqual(report.errors,[]);report.status='passed';
} catch(error){report.status='failed';report.failure=String(error.stack||error);throw error;}
finally{await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();await server.close();}
console.log(`PASS Runtime Gateway connections (${report.cases.length} cases)`);
