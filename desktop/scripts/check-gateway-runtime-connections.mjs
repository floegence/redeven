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
 const {createDesktopI18n}=await load('../src/shared/i18n/index.ts');
 for(const locale of ['en-US','zh-CN','zh-TW','ja-JP','ko-KR','de-DE','fr-FR','es-ES','pt-BR','ru-RU']) {
  const i18n=createDesktopI18n(locale);
  for(const width of [430,1280]) {
   const {snapshot,memberships}=runtimeConnectionFixture({cloudManagement:false,gatewayWindow:true,
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
    assert.ok(icons.every(icon=>Math.abs(icon.width-icon.rem)<.5 && Math.abs(icon.height-icon.rem)<.5),JSON.stringify(icons));
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
    report.cases.push(`${locale}/${width}: original tabs, upward menu, explicit target, Cloud impact, retained draft and independent pairing`);
   } finally {await context.close();}
  }
 }
 assert.deepEqual(report.errors,[]);report.status='passed';
} catch(error){report.status='failed';report.failure=String(error.stack||error);throw error;}
finally{await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();await server.close();}
console.log(`PASS Runtime Gateway connections (${report.cases.length} cases)`);
