import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/gateway-network-acceptance/',import.meta.url));
await mkdir(output,{recursive:true});
const server = await createSSHSettingsPreviewServer(0,['gateway-network.html']);
await server.watcher.close();
const browser = await chromium.launch({headless:true});
const report = {cases:[],errors:[]};
function mockGatewayActions() {
 window.gatewayRequests=[];
 window.redevenDesktopLauncher={performAction:async request=>{
  window.gatewayRequests.push(request);
  if(request.operation==='status')return {ok:true,outcome:'gateway_membership_updated',gateway_membership:{joined:false,phase:'not_joined'}};
  if(request.operation==='preview')return {ok:true,outcome:'gateway_membership_updated',gateway_preview:{preview_id:'a'.repeat(43),purpose:'join',gateway_id:'gateway',gateway_name:'Office Gateway',target_runtime_id:'runtime',expires_at_unix_ms:Date.now()+600000}};
  if(request.kind==='update_gateway_network_settings')return {ok:true,outcome:'gateway_members_updated',gateway_network_settings:{settings:request.settings,restart_required:true}};
  return {ok:true,outcome:'gateway_membership_updated',gateway_membership:{joined:true,phase:'joined'}};
 }};
}
try {
 const {createDesktopI18n,listDesktopI18nLocales} = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/i18n/desktopI18n.ts',import.meta.url)));
 for(const locale of listDesktopI18nLocales()) {
  const i18n=createDesktopI18n(locale);
  for(const view of ['join','settings']) {
   const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
   page.on('pageerror',error=>report.errors.push(error.message));
   await page.addInitScript(mockGatewayActions);
   await page.goto(new URL(`gateway-network.html?locale=${locale}&view=${view}`,server.resolvedUrls.local[0]).href);
   if(view==='join') {
    await page.getByRole('button',{name:i18n.t('gatewayJoin.title'),exact:true}).click();
    const join=page.getByRole('dialog');
    const inputs=join.locator('input');
    const savedTab=page.getByRole('tab',{name:i18n.t('gatewayDiscovery.savedGateway'),exact:true});
    const newAddressTab=page.getByRole('tab',{name:i18n.t('gatewayDiscovery.enterAddress'),exact:true});
    const savedPanel=join.locator('[role="tabpanel"]:not([aria-hidden="true"])');
    const picker=savedPanel.getByRole('combobox',{name:i18n.t('gatewayDiscovery.savedGateway')});
    assert.equal(await savedTab.getAttribute('aria-selected'),'true');
    assert.equal(await savedPanel.locator('input').count(),0,'saved Gateway tab has no manual address field');
    assert.equal(await picker.inputValue(),'');
    assert.equal(await picker.locator('option').count(),2);
    assert.match(await picker.locator('option').nth(1).innerText(),/Office Gateway.*office\.local:7443/);
    if(['en-US','zh-CN','de-DE'].includes(locale))await page.screenshot({path:`${output}/${locale}-join-saved.png`});
    await newAddressTab.click();
    const manualPanel=join.locator('[role="tabpanel"]:not([aria-hidden="true"])');
    const manualAddress=manualPanel.getByRole('textbox',{name:i18n.t('gatewayJoin.address')});
    await manualAddress.fill('https://draft.example:7443');
    assert.equal(await manualPanel.locator('[data-gateway-picker]').count(),0,'manual entry tab has no saved Gateway picker');
    if(['en-US','zh-CN','de-DE'].includes(locale))await page.screenshot({path:`${output}/${locale}-join-manual.png`});
    await savedTab.click();
    await picker.selectOption('local-gateway');
    assert.equal(await picker.inputValue(),'local-gateway');
    assert.equal(await savedPanel.locator('input').count(),0);
    await newAddressTab.click();
    assert.equal(await manualAddress.inputValue(),'https://draft.example:7443','manual draft survives switching to a saved Gateway');
    await savedTab.click();
    await inputs.nth(1).fill('123456789ABCDEFGHJKMNPQRSTV');
    await join.getByRole('button',{name:i18n.t('gatewayJoin.verify'),exact:true}).click();
    await join.getByRole('button',{name:i18n.t('gatewayJoin.confirmEnable'),exact:true}).waitFor();
    await newAddressTab.click();
    await join.locator('.redeven-gateway-join-summary').waitFor({state:'detached'});
    assert.equal(await inputs.nth(1).inputValue(),'123456789ABCDEFGHJKMNPQRSTV');
    assert.equal(await page.evaluate(()=>window.gatewayRequests.filter(r=>r.operation==='preview').at(-1)?.address),'https://office.local:7443');
    assert.equal(await page.evaluate(()=>window.gatewayRequests.filter(r=>r.operation==='join').length),0);
   } else {
    const advanced=page.locator('[data-gateway-network-advanced]');
    if(locale==='zh-CN')await page.screenshot({path:`${output}/zh-CN-settings-default.png`});
    assert.equal(await advanced.evaluate(el=>el.open),false);
    await advanced.locator('summary').click();
    await page.locator('#gateway-listen-addresses').fill('0.0.0.0:7555');
    await page.locator('#gateway-allowed-hosts').fill('office.local');
    await page.getByRole('button',{name:i18n.t('gatewayNetwork.save'),exact:true}).click();
    await page.getByText(i18n.t('gatewayNetwork.restartRequired'),{exact:true}).waitFor();
    const request=await page.evaluate(()=>window.gatewayRequests[0]);
    assert.deepEqual(request.settings.listen_addresses,['0.0.0.0:7555']);
    assert.deepEqual(request.settings.allowed_hosts,['office.local']);
    assert.equal(request.settings.endpoints[0].address,'https://office.local:7443');
   }
   const layout=await page.locator('[role="dialog"]').evaluate(dialog=>({width:dialog.getBoundingClientRect().width,overflow:dialog.scrollWidth-dialog.clientWidth,buttons:[...dialog.querySelectorAll('button')].filter(el=>el.getClientRects().length).map(el=>({text:el.textContent,nowrap:getComputedStyle(el).whiteSpace}))}));
   assert.ok(layout.width<=374,`${locale}/${view}: dialog exceeds viewport`);
   assert.ok(layout.overflow<=1,`${locale}/${view}: horizontal overflow`);
   assert.ok(layout.buttons.every(button=>button.nowrap==='nowrap'),`${locale}/${view}: action text wraps`);
   if(['en-US','zh-CN','de-DE'].includes(locale))await page.screenshot({path:`${output}/${locale}-${view}.png`});
   report.cases.push({locale,view,status:'passed'});
   await page.close();
  }
 }
 for (const [locale,width,theme,scenario] of [
  ['zh-CN',1280,'light','default'],['zh-CN',1280,'dark','default'],
  ['zh-CN',390,'light','long'],['de-DE',390,'dark','long'],
  ['zh-CN',390,'light','multiple'],['zh-CN',1280,'light','multiple'],
  ['zh-CN',390,'light','none'],['en-US',1280,'light','none'],
 ]) {
  const i18n=createDesktopI18n(locale);
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.addInitScript(mockGatewayActions);
  await page.goto(new URL(`gateway-network.html?locale=${locale}&theme=${theme}&scenario=${scenario}`,server.resolvedUrls.local[0]).href);
  const trigger=page.getByRole('button',{name:i18n.t('gatewayJoin.title'),exact:true});
  await trigger.click();
  const picker=page.locator('[data-gateway-picker]');
  const optionCount=scenario==='none' ? 0 : 2;
  assert.equal(await picker.count(),scenario==='none' ? 0 : 1);
  if(scenario!=='none')assert.equal(await picker.locator('option').count(),optionCount);
  const dialog=page.getByRole('dialog');
  const layout=await dialog.evaluate(el=>({width:el.getBoundingClientRect().width,overflow:el.scrollWidth-el.clientWidth}));
  assert.ok(layout.width<=width-16 && layout.overflow<=1);
  if(scenario==='long') {
   assert.match(await picker.locator('option').nth(1).innerText(),/design and engineering team/);
   await picker.selectOption('local-gateway');
   const bounds=await picker.boundingBox();
   assert.ok(bounds && bounds.width<=width-32,'long selected names fit the narrow panel');
  }
  if(scenario==='multiple') {
   assert.match(await picker.locator('option').nth(1).innerText(),/office\.local:7443/);
   await picker.selectOption('local-gateway');
   assert.match(await page.locator('[data-gateway-address-picker] option').nth(2).innerText(),/office\.example:7443/);
  }
  await page.screenshot({path:`${output}/${locale}-${width}-${theme}-${scenario}.png`});
  if(locale==='zh-CN' && width===1280 && scenario==='default')await dialog.screenshot({path:`${output}/zh-CN-dialog-${theme}.png`});
  await page.keyboard.press('Escape');
  assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
  report.cases.push({locale,width,theme,scenario,status:'passed'});
  await page.close();
 }
 assert.deepEqual(report.errors,[]);
 report.status='passed';
} finally {
 await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');
 await browser.close();await server.close();
}
