import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import {createSSHSettingsPreviewServer} from './ssh-settings-preview.mjs';

const supportedLocales=['en-US','zh-CN','zh-TW','ja-JP','ko-KR','de-DE','fr-FR','es-ES','pt-BR','ru-RU'];
// Optional locale arguments restrict focused iteration; no arguments runs the complete matrix.
const locales=process.argv.slice(2);
assert.ok(locales.every(locale=>supportedLocales.includes(locale)),'arguments must be supported locale codes');
const localGateway={gateway_id:'local-gateway',display_name:'Office Gateway',local_enabled:true,connection_kind:'local_host',
 management_capability:'managed_local_host',capabilities:[],status:'online',trust_state:'paired',listener_running:true,
 created_at_ms:1,updated_at_ms:1,environments:[],member_endpoints:[{endpoint_id:'lan',address:'https://office.local:7443',scope:'lan',priority:0}]};
const output=fileURLToPath(new URL('../dist/gateway-runtime-connections/',import.meta.url));
await mkdir(output,{recursive:true});
const server=await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser=await chromium.launch({headless:true});
const report={cases:[],layouts:[],errors:[]};
const wizardLayout=dialog=>dialog.evaluate(panel=>{
 const bounds=element=>{const {x,y,width,height}=element.getBoundingClientRect();return {x,y,width,height};};
 const scroll=panel.querySelector('.redeven-gateway-join-scroll');
 return {panel:bounds(panel),steps:bounds(panel.querySelector('.redeven-gateway-wizard-steps')),
  actions:bounds(panel.querySelector('.redeven-gateway-join-actions')),scroll:bounds(scroll),
  scrollWidth:scroll.scrollWidth,clientWidth:scroll.clientWidth};
});
async function assertStableWizard(dialog,initial,stage) {
 const layout=await wizardLayout(dialog);
 for(const part of ['panel','steps'])for(const coordinate of ['x','y','width','height']) {
  assert.ok(Math.abs(layout[part][coordinate]-initial[part][coordinate])<1,
   `${stage}: ${part}.${coordinate} must stay stable: ${JSON.stringify({initial,layout})}`);
 }
 assert.ok(Math.abs(layout.actions.y+layout.actions.height-initial.actions.y-initial.actions.height)<1,
  `${stage}: actions must stay pinned to the same bottom edge`);
 assert.ok(layout.actions.y+layout.actions.height<=layout.panel.y+layout.panel.height+1,
  `${stage}: actions must remain inside the panel`);
 assert.ok(layout.scrollWidth<=layout.clientWidth+1,`${stage}: content must not overflow horizontally`);
 assert.ok(layout.scroll.y>=layout.steps.y+layout.steps.height-1);
 assert.ok(layout.scroll.y+layout.scroll.height<=layout.actions.y+1);
}
async function assertWizardTypography(dialog) {
 const typography=await dialog.evaluate(panel=>{
  const rem=parseFloat(getComputedStyle(document.documentElement).fontSize);
  const font=selector=>[...panel.querySelectorAll(selector)].filter(element=>element.checkVisibility())
   .map(element=>parseFloat(getComputedStyle(element).fontSize)/rem);
  return {coarse:matchMedia('(pointer: coarse)').matches,title:font('h2'),heading:font('h3'),
   copy:font('.redeven-gateway-join-section p'),labels:font('label'),inputs:font('input'),
   suggestions:font('.redeven-gateway-local-name'),localLabels:font('.redeven-gateway-local-label')};
 });
 assert.ok(typography.title.every(size=>Math.abs(size-1)<.01),JSON.stringify(typography));
 assert.ok(typography.heading.every(size=>Math.abs(size-.8125)<.01),JSON.stringify(typography));
 assert.ok(typography.copy.every(size=>Math.abs(size-(typography.coarse ? .875 : .75))<.01),JSON.stringify(typography));
 assert.ok(typography.labels.every(size=>Math.abs(size-(typography.coarse ? .8125 : .75))<.01),JSON.stringify(typography));
 assert.ok(typography.inputs.every(size=>Math.abs(size-(typography.coarse ? 1 : .75))<.01),JSON.stringify(typography));
 assert.ok(typography.suggestions.every(size=>Math.abs(size-(typography.coarse ? .875 : .75))<.01),JSON.stringify(typography));
 assert.ok(typography.localLabels.every(size=>Math.abs(size-.6875)<.01),JSON.stringify(typography));
 return typography;
}
async function holdAction(page) {
 await page.evaluate(()=>{window.settingsFixture.beforeAction=()=>new Promise(resolve=>{window.gatewayResolveAction=resolve;});});
}
async function releaseAction(page) {
 await page.evaluate(()=>{window.settingsFixture.beforeAction=undefined;window.gatewayResolveAction();});
}
try {
 const load=relative=>server.ssrLoadModule(fileURLToPath(new URL(relative,import.meta.url)));
 const {runtimeConnectionFixture}=await load('../src/testSupport/runtimeConnectionFixture.ts');
 const {runtimeGatewayAccessFixture}=await load('../src/testSupport/runtimeGatewayAccessFixture.ts');
 const {runtimeGatewayBackgroundProbeFixture}=await load('../src/testSupport/runtimeGatewayBackgroundProbeFixture.ts');
 const {buildDesktopWelcomeSnapshot}=await load('../src/main/desktopWelcomeState.ts');
 const {createDesktopI18n}=await load('../src/shared/i18n/index.ts');
 for(const locale of locales.length ? locales : supportedLocales) {
  const i18n=createDesktopI18n(locale);
  for(const width of [430,1280]) {
   const {snapshot,memberships,inputs:fixtureInputs}=runtimeConnectionFixture({cloudManagement:false,gatewayWindow:true,
    cloudDirectoryAccessPointOrigin:'https://rotated-region.example.invalid'});
   snapshot.gateway_sources=[...snapshot.gateway_sources,localGateway];
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
    const initialLayout=await wizardLayout(join);
    await assertWizardTypography(join);
    await holdAction(page);
    await join.getByRole('button',{name:i18n.t('gatewayJoin.connectAndContinue'),exact:true}).click();
    await join.getByRole('button',{name:i18n.t('gatewayJoin.connecting'),exact:true}).waitFor();
    await assertStableWizard(join,initialLayout,'connecting');
    await releaseAction(page);
    const inputs=join.locator('input');await inputs.nth(0).fill('https://draft.internal:7443');await inputs.nth(1).fill('TEST-ONLY-CODE');
    await assertStableWizard(join,initialLayout,'invitation');
    await assertWizardTypography(join);
    await page.screenshot({path:`${output}/${locale}-${width}-invitation.png`});
    await page.evaluate(()=>window.settingsFixture.publish({...structuredClone(window.settingsFixtureSnapshot),snapshot_revision:4}));
    assert.equal(await inputs.nth(0).inputValue(),'https://draft.internal:7443');assert.equal(await inputs.nth(1).inputValue(),'TEST-ONLY-CODE');
    assert.equal(await inputs.nth(1).evaluate(element => element === document.activeElement),true);
    await assertStableWizard(join,initialLayout,'same-target snapshot');
    await holdAction(page);
    await join.getByRole('button',{name:i18n.t('gatewayJoin.verify'),exact:true}).click();
    await join.getByRole('button',{name:i18n.t('gatewayJoin.verifying'),exact:true}).waitFor();
    await assertStableWizard(join,initialLayout,'verifying');
    await releaseAction(page);
    await join.getByRole('button',{name:i18n.t('gatewayJoin.confirmEnable'),exact:true}).waitFor();
    await assertStableWizard(join,initialLayout,'confirmation');
    await assertWizardTypography(join);
    report.layouts.push({locale,width,initial:initialLayout,confirmation:await wizardLayout(join)});
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
    const startedAtUnixMS=Date.now()-120000;
    const fixtures=Object.fromEntries(['unknown','stopped','control_missing','connection_required','ready','update_required','management_unavailable']
      .map(state=>[state,runtimeGatewayAccessFixture(kind,state,startedAtUnixMS)]));
    for(const fixture of Object.values(fixtures))fixture.snapshot.gateway_sources=[...fixture.snapshot.gateway_sources,localGateway];
    const runtime=fixtures.ready.environment;
    const context=await browser.newContext({viewport:{width,height:1050},reducedMotion:'reduce',hasTouch:locale==='zh-TW' && width===430});
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
     const initialLayout=await wizardLayout(dialog);
     const observer=await runtimeGatewayBackgroundProbeFixture(kind,'ready',startedAtUnixMS);
     async function assertBackgroundContinuity(stage) {
      // Capture after explicit step focus and font layout settle, before injecting observations.
      await page.evaluate(async()=>{await document.fonts.ready;await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));});
      await dialog.evaluate(panel=>{
       const inputs=[...panel.querySelectorAll('input')];
       const buttons=[...panel.querySelectorAll('.redeven-gateway-join-actions button')].filter(button=>button.checkVisibility());
       window.gatewayContinuity={panel,inputs,buttons,labels:buttons.map(button=>button.textContent),disabled:buttons.map(button=>button.disabled),
        focus:document.activeElement,selection:inputs.map(input=>[input.selectionStart,input.selectionEnd]),values:inputs.map(input=>input.value),
        step:panel.querySelector('[data-gateway-step]').dataset.gatewayStep,scroll:panel.querySelector('.redeven-gateway-join-scroll').scrollTop};
      });
      async function assertContinuity() {
       const errors=await page.evaluate(()=>{
        const old=window.gatewayContinuity,panel=document.querySelector('[role="dialog"]');
        const inputs=[...panel.querySelectorAll('input')];
        const buttons=[...panel.querySelectorAll('.redeven-gateway-join-actions button')].filter(button=>button.checkVisibility());
        return [panel===old.panel,inputs.every((input,index)=>input===old.inputs[index]),buttons.length===old.buttons.length,
         buttons.every((button,index)=>button===old.buttons[index] && button.textContent===old.labels[index] && button.disabled===old.disabled[index]),
         document.activeElement===old.focus,JSON.stringify(inputs.map(input=>input.value))===JSON.stringify(old.values),
         JSON.stringify(inputs.map(input=>[input.selectionStart,input.selectionEnd]))===JSON.stringify(old.selection),
         panel.querySelector('[data-gateway-step]').dataset.gatewayStep===old.step,
         panel.querySelector('.redeven-gateway-join-scroll').scrollTop===old.scroll,
         !panel.querySelector('[data-gateway-connection-blocked]')].map((valid,index)=>valid?null:index).filter(index=>index!==null);
       });
       assert.deepEqual(errors,[],`${locale}/${width}/${kind}/${stage}: background continuity`);
       await assertStableWizard(dialog,initialLayout,`${stage} background probe`);
      }
      for(let cycle=0;cycle<3;cycle++) {
       const check=observer.beginProbe();
       await page.evaluate(({snapshot,gateways})=>window.gatewayAcceptancePublish({...snapshot,gateway_sources:gateways}),
        {snapshot:check.checking,gateways:fixtures.ready.snapshot.gateway_sources});
       await assertContinuity();
       await page.evaluate(({snapshot,gateways})=>window.gatewayAcceptancePublish({...snapshot,gateway_sources:gateways}),
        {snapshot:await check.finish(),gateways:fixtures.ready.snapshot.gateway_sources});
       await assertContinuity();
      }
      report.cases.push(`${locale}/${width}/${kind}/${stage}: three production observer cycles preserve controls, focus, selection and geometry`);
     }

     await assertWizardTypography(dialog);
     await dialog.getByText(runtime.label,{exact:true}).waitFor();
     const lifecycle=()=>page.evaluate(()=>window.settingsFixture.requests.filter(request=>['start_environment_runtime','restart_environment_runtime','update_environment_runtime'].includes(request.kind)));
     assert.equal((await lifecycle()).length,0,'opening performs a read-only check');
     const preparationControls=await dialog.locator('button:visible').evaluateAll(elements=>elements.map(element=>({width:element.scrollWidth,client:element.clientWidth,whiteSpace:getComputedStyle(element).whiteSpace})));
     assert.ok(preparationControls.every(item=>item.width<=item.client+1 && item.whiteSpace==='nowrap'));
     await page.screenshot({path:`${output}/${locale}-${width}-${kind}-preparation.png`});
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.startAndContinue'),exact:true}).click();
     const inputs=dialog.locator('input');await inputs.nth(0).waitFor({state:'visible'});
     await dialog.locator('[data-gateway-suggestion="local-gateway"]').waitFor();
     await assertStableWizard(dialog,initialLayout,'startup');
     await inputs.nth(0).fill('https://office.example:7443');await inputs.nth(1).fill('DRAFT-CODE');
     await inputs.nth(1).evaluate(input=>input.setSelectionRange(1,4));
     await assertBackgroundContinuity('invitation');
     await page.evaluate(snapshot=>window.gatewayAcceptancePublish(snapshot),fixtures.ready.snapshot);
     assert.equal(await inputs.nth(1).evaluate(element=>element===document.activeElement),true);
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.verify'),exact:true}).click();
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.confirmEnable'),exact:true}).waitFor();
     await assertStableWizard(dialog,initialLayout,'verified preview');
     await assertBackgroundContinuity('confirmation');
     const publish=async state=>page.evaluate(({snapshot,state})=>{
      window.gatewayAcceptanceState=state;window.gatewayAcceptancePublish(snapshot);
     },{snapshot:fixtures[state].snapshot,state});
     for(const [state,key] of [['control_missing','environmentAction.restartRuntime'],['update_required','environmentAction.updateRuntime']]) {
      await publish(state);await dialog.locator(`[data-gateway-preparation="${state}"]`).waitFor();
      await assertStableWizard(dialog,initialLayout,state);
      assert.equal(await inputs.nth(0).isDisabled(),false);
      assert.equal(await dialog.getByRole('button',{name:i18n.t('gatewayJoin.confirmEnable'),exact:true}).isDisabled(),true);
      assert.equal(await dialog.locator('[data-gateway-step]').getAttribute('data-gateway-step'),'2');
      await dialog.getByRole('button',{name:i18n.t('gatewayJoin.restoreConnection'),exact:true}).click();
      await page.evaluate(()=>{window.gatewayAcceptanceFailRecovery=true;});
      await holdAction(page);
      await dialog.getByRole('button',{name:i18n.t(key),exact:true}).click();
      await dialog.getByRole('status').first().waitFor();
      await assertStableWizard(dialog,initialLayout,`${state} pending`);
      await releaseAction(page);
      await dialog.getByText(i18n.t('gatewayJoin.recoveryFailed'),{exact:true}).waitFor();
      await assertStableWizard(dialog,initialLayout,`${state} failure`);
      assert.equal(await inputs.nth(0).inputValue(),'https://office.example:7443');
      assert.equal(await inputs.nth(1).inputValue(),'DRAFT-CODE');
      assert.equal(await dialog.locator('.redeven-gateway-join-summary').textContent().then(text=>text.includes('Office')),true);
      await page.evaluate(()=>{window.gatewayAcceptanceFailRecovery=false;});
      await dialog.getByRole('button',{name:i18n.t(key),exact:true}).click();
      await dialog.getByRole('button',{name:i18n.t('gatewayJoin.verify'),exact:true}).waitFor();
      await dialog.getByRole('button',{name:i18n.t('gatewayJoin.verify'),exact:true}).click();
      await dialog.getByRole('button',{name:i18n.t('gatewayJoin.confirmEnable'),exact:true}).waitFor();
      await assertStableWizard(dialog,initialLayout,`${state} recovery`);
     }
     await publish('management_unavailable');
     await dialog.getByText(i18n.t('gatewayJoin.credentialsHelp'),{exact:true}).waitFor();
     await assertStableWizard(dialog,initialLayout,'credentials unavailable');
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.restoreConnection'),exact:true}).click();
     await dialog.getByRole('button',{name:i18n.t('common.retry'),exact:true}).click();
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.confirmEnable'),exact:true}).waitFor();
     assert.equal(await inputs.nth(1).inputValue(),'DRAFT-CODE');
     await page.evaluate(({snapshot,id})=>window.gatewayAcceptancePublish({...snapshot,action_progress:[{
      action:'restart_environment_runtime',environment_id:id,operation_key:'acceptance-operation',started_at_unix_ms:Date.now(),
      status:'running',phase:'checking_runtime_service',title:'Restart Runtime',detail:'',active_progress_surface:'runtime_lifecycle',cancelable:true,
     }]}),{snapshot:fixtures.ready.snapshot,id:runtime.id});
     await dialog.locator('[data-gateway-connection-blocked]').waitFor();
     await assertStableWizard(dialog,initialLayout,'lifecycle progress');
     assert.equal(await dialog.getByRole('button',{name:i18n.t('gatewayJoin.restoreConnection'),exact:true}).isDisabled(),false);
     assert.equal(await inputs.nth(1).isDisabled(),false);
     assert.equal(await dialog.getByRole('button',{name:i18n.t('gatewayJoin.confirmEnable'),exact:true}).isDisabled(),true);
     await publish('ready');await dialog.getByRole('button',{name:i18n.t('gatewayJoin.confirmEnable'),exact:true}).waitFor();
     const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+1);
     const controls=await dialog.locator('button:visible').evaluateAll(elements=>elements.map(element=>({width:element.scrollWidth,client:element.clientWidth,whiteSpace:getComputedStyle(element).whiteSpace})));
     assert.ok(controls.every(item=>item.width<=item.client+1 && item.whiteSpace==='nowrap'));
     await page.screenshot({path:`${output}/${locale}-${width}-${kind}-setup.png`});
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.back'),exact:true}).click();
     await assertStableWizard(dialog,initialLayout,'back to invitation');
     assert.equal(await inputs.nth(1).inputValue(),'DRAFT-CODE');
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.back'),exact:true}).click();
     await publish('connection_required');
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.connectAndContinue'),exact:true}).waitFor();
     assert.equal(await inputs.nth(0).isVisible(),false);
     await assertBackgroundContinuity('connection');
     await page.screenshot({path:`${output}/${locale}-${width}-${kind}-connect.png`});
     await page.evaluate(()=>{window.gatewayAcceptanceFailConnection=true;});
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.connectAndContinue'),exact:true}).click();
     await dialog.getByText(i18n.t('gatewayJoin.connectFailed'),{exact:true}).waitFor();
     await assertStableWizard(dialog,initialLayout,'connection failure');
     assert.equal(await dialog.locator('[data-gateway-step]').getAttribute('data-gateway-step'),'0');
     assert.equal(await inputs.nth(0).isVisible(),false);
     await page.evaluate(()=>{window.gatewayAcceptanceFailConnection=false;});
     await dialog.getByRole('button',{name:i18n.t('common.retry'),exact:true}).click();
     await dialog.getByRole('button',{name:i18n.t('gatewayJoin.confirmEnable'),exact:true}).waitFor();
     if(kind==='ssh' && ['en-US','zh-CN','de-DE'].includes(locale)) {
      for(const fontSize of width===430 ? [16,24] : [24]) {
       const shortWidth=fontSize===16 ? 320 : width;
       await page.setViewportSize({width:shortWidth,height:460});
       await page.evaluate(fontSize=>document.documentElement.style.fontSize=`${fontSize}px`,fontSize);
       const shortLayout=await wizardLayout(dialog);
       assert.ok(shortLayout.panel.y>=56 && shortLayout.panel.y+shortLayout.panel.height<=444,
        `short window must respect titlebar and bottom clearance: ${JSON.stringify(shortLayout)}`);
       assert.ok(shortLayout.panel.x>=0 && shortLayout.panel.x+shortLayout.panel.width<=shortWidth);
       await assertWizardTypography(dialog);
       const scroll=dialog.locator('.redeven-gateway-join-scroll');
       assert.equal(await scroll.evaluate(element=>element.scrollHeight>element.clientHeight),true);
       await scroll.evaluate(element=>{element.scrollTop=element.scrollHeight;});
       await assertStableWizard(dialog,shortLayout,'short window scrolling');
       const scrollTop=await scroll.evaluate(element=>element.scrollTop);
       await publish('ready');
       assert.equal(await scroll.evaluate(element=>element.scrollTop),scrollTop,'same-target snapshots retain the reading position');
       const copyBounds=await scroll.locator('section:visible > p').last().boundingBox();
       assert.ok(copyBounds.y+copyBounds.height<=shortLayout.actions.y+1,'final guidance remains reachable above actions');
       for(const step of ['invitation','connection']) {
        await dialog.getByRole('button',{name:i18n.t('gatewayJoin.back'),exact:true}).click();
        await assertStableWizard(dialog,shortLayout,`short window ${step}`);
        await assertWizardTypography(dialog);
        if(step==='connection')assert.equal(await scroll.evaluate(element=>element.scrollTop),0,'the connection step starts at the top');
       }
       await dialog.getByRole('button',{name:i18n.t('gatewayJoin.connectAndContinue'),exact:true}).click();
       await dialog.getByRole('button',{name:i18n.t('gatewayJoin.confirmEnable'),exact:true}).waitFor();
       await assertStableWizard(dialog,shortLayout,'short window reconnection');
       assert.equal(await scroll.evaluate(element=>element.scrollTop),0);
       const controls=await dialog.locator('button:visible').evaluateAll(elements=>elements.map(element=>({
        width:element.scrollWidth,client:element.clientWidth,whiteSpace:getComputedStyle(element).whiteSpace,
        left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right,
       })));
       assert.ok(controls.every(item=>item.width<=item.client+1 && item.whiteSpace==='nowrap'
        && item.left>=shortLayout.panel.x && item.right<=shortLayout.panel.x+shortLayout.panel.width),JSON.stringify(controls));
       assert.equal(await inputs.nth(0).inputValue(),'https://office.example:7443');
       assert.equal(await inputs.nth(1).inputValue(),'DRAFT-CODE');
       await page.screenshot({path:`${output}/${locale}-${shortWidth}-short-${fontSize}.png`});
       report.layouts.push({locale,width:shortWidth,height:460,fontSize,initial:shortLayout,confirmation:await wizardLayout(dialog)});
       report.cases.push(`${locale}/${shortWidth}/460/${fontSize}px: stable steps, reachable scrolling guidance, pinned single-line actions and retained draft`);
      }
     }
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
