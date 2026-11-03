import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = process.env.REDEVEN_GATEWAY_QA_OUTPUT || fileURLToPath(new URL('../dist/gateway-typography-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0, ['environment-settings.html']);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
}
try {
  const load = relative => server.ssrLoadModule(fileURLToPath(new URL(relative, import.meta.url)));
  const { compactEnvironmentPreviewFixture } = await load('../src/testSupport/compactEnvironmentPreviewFixture.ts');
  const { catalogFixture } = await load('../src/testSupport/gatewayMembershipFixture.ts');
  const { createDesktopI18n } = await load('../src/shared/i18n/index.ts');
  const source = compactEnvironmentPreviewFixture().coverage;
  const gateway = { ...source.gateway_sources[0], display_name: 'Gateway-gzcom', connection_kind: 'ssh_host', management_capability: 'managed_ssh_host',
    ssh_details: { ...source.gateway_sources[0].ssh_details, ssh_destination: 'gzcom' },
    client_key_id: 'studio', status: 'online', trust_state: 'paired', sync_state: 'ready', local_enabled: true, policy: catalogFixture.policy, endpoints: [],
    listener_address: ':7443', listener_addresses: [':7443'], active_listener_addresses: ['[::]:7443'], listener_running: true,
    permissions: { access: true, manage_attachments: true, manage_network: true }, environments: [],
    service_state: { status: 'ready', service_state_root: 'remote_default/gateways/gw_diwKq11XgLVp-1YRK1EHkPFw/state', can_start: false, can_stop: true, can_restart: true, can_update: true, can_pair_after_start: false } };
  const snapshot = { ...source, gateway_sources: [gateway], open_windows: [] };
  const locales = (process.env.REDEVEN_GATEWAY_QA_LOCALES || 'en-US,zh-CN,de-DE').split(',');
  const widths = (process.env.REDEVEN_GATEWAY_QA_WIDTHS || '390,430,768,1280,1600').split(',').map(Number);
  for (const locale of locales) {
    const variants = [...widths.map(width => ({width, touch:false, largeText:false})), {width:430, touch:true, largeText:false}, {width:430, touch:false, largeText:true}];
    for (const {width,touch,largeText} of variants) {
      const dark = width === 430 || width === 1600;
      const context = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => report.errors.push(error.message));
      await page.exposeFunction('reportGatewayWindowError', message => report.errors.push(message));
      try {
        await page.addInitScript(({ snapshot, locale }) => {
          window.addEventListener('error', event => window.reportGatewayWindowError(event.message));
          window.settingsFixtureSnapshot = snapshot;
          const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
          window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
        }, { snapshot, locale });
        await page.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href, { timeout: 60000 });
        await page.evaluate(dark => {
          document.documentElement.classList.toggle('dark', dark);
          document.documentElement.classList.toggle('light', !dark);
          window.settingsFixture.actionResult = request => {
            if (request.kind === 'list_gateway_clients') return { ok: true, gateway_clients: [
              { client_key_id: 'studio', client_name: 'MacBook-Pro.local', paired_at_unix_ms: 1792824938000, last_verified_at_unix_ms: 1793613681000, revoked_at_unix_ms: 0 },
              { client_key_id: 'workstation', client_name: 'Build-and-deployment-workstation', paired_at_unix_ms: 1792824938000, last_verified_at_unix_ms: 1793613681000, revoked_at_unix_ms: 0 },
            ] };
            return { ok: true, outcome: 'saved_gateway' };
          };
        }, dark);
        if (largeText) await page.evaluate(() => document.documentElement.style.fontSize='20px');
        const i18n = createDesktopI18n(locale);
        const button = (scope, key) => scope.getByRole('button', { name: i18n.t(key), exact: true });
        await button(page, 'environmentCenter.gatewaysSection').click();
        await button(page.locator('.redeven-gateway-card'), 'gatewayExperience.manage').click();
        const workspace = page.locator('[data-gateway-management-page]');
        const nav = workspace.locator('[data-gateway-management-nav]');
        for (const [section, key] of [['network', 'gatewayExperience.network'], ['clients', 'gatewayExperience.clients'], ['maintenance', 'gatewayExperience.maintenance']]) {
          await button(nav, key).click();
          const panel = workspace.locator('.redeven-gateway-workspace-section:visible');
          if (section === 'network') {
            await panel.locator('[data-gateway-network-advanced] > summary').click();
            await panel.locator('#gateway-allowed-hosts').waitFor({state:'visible'});
            const hostField = panel.getByLabel(i18n.t('gatewayNetwork.allowedHosts'), {exact:true});
            assert.equal(await hostField.count(), 1, 'Host label remains associated with its input');
            await button(panel, 'gatewayNetwork.hostsHelp').focus();
            await page.getByRole('tooltip').filter({hasText:i18n.t('gatewayNetwork.hostsHelp')}).waitFor();
            await hostField.focus();
          }
          if (section === 'clients') await panel.locator('.redeven-gateway-authorized-client-row').first().waitFor();
          await settle(page);
          const metrics = await panel.evaluate(element => {
            const rect = node => { const r = node.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
            return {
              bounds: rect(element), overflow: element.scrollWidth - element.clientWidth,
              font: getComputedStyle(element).fontFamily,
              controls: [...element.querySelectorAll('[data-floe-control=button], .redeven-gateway-network-input')].filter(node=>node.getBoundingClientRect().height).map(node=>({...rect(node),font:getComputedStyle(node).fontSize})),
              fields: [...element.querySelectorAll('.redeven-gateway-network-input, .redeven-gateway-maintenance-path')].map(node => ({...rect(node),font:getComputedStyle(node).fontFamily,size:getComputedStyle(node).fontSize})),
              labels: [...element.querySelectorAll('.redeven-gateway-setting-label')].map(rect),
              identities: [...element.querySelectorAll('.redeven-gateway-client-identity')].map(rect),
              metadata: [...element.querySelectorAll('.redeven-gateway-client-metadata')].map(rect),
              actions: [...element.querySelectorAll('.redeven-gateway-client-actions')].map(rect),
              facts: [...element.querySelectorAll('.redeven-gateway-maintenance-facts dd')].map(rect),
              buttons: [...element.querySelectorAll('.redeven-gateway-maintenance-actions button')].map(rect),
            };
          });
          report.cases.push({locale,width,dark,touch,largeText,section,...metrics});
          await workspace.screenshot({path: output + '/' + locale + '-' + width + (touch ? '-touch' : largeText ? '-large-text' : '') + '-' + section + '.png'});
          assert.ok(metrics.overflow <= 1, locale + '/' + width + '/' + section + ' has horizontal overflow');
          if (touch) assert.ok(metrics.controls.every(control=>control.height>=44), 'Touch controls retain 44px targets');
          if (width >= 1280) assert.ok(Math.max(...metrics.controls.map(control=>control.height))-Math.min(...metrics.controls.map(control=>control.height))<=1, 'Section actions and inputs share one control height');
          assert.ok(metrics.fields.every(field => field.font === metrics.font), 'Settings values must use the same readable UI font as their labels');
          if (section === 'network' && width > 1050) {
            assert.ok(Math.abs(metrics.fields[0].x-metrics.fields[1].x)<1, 'Listener and host fields share one content edge');
            assert.ok(metrics.labels.every(label=>label.right<=metrics.fields[0].x), 'Labels do not overlap the field column');
          }
          if (section === 'maintenance' && width > 600) assert.ok(metrics.facts.every(fact=>Math.abs(fact.x-metrics.facts[0].x)<1), 'Maintenance values align');
          if (section === 'clients') {
            assert.equal(await panel.locator('time[datetime][title]').count(), 4, 'Full timestamps remain available');
            assert.ok(metrics.actions.every(action=>action.right<=metrics.bounds.right+1), 'Client actions fit');
            assert.ok(metrics.metadata.every(row=>Math.abs(row.x-metrics.metadata[0].x)<1), 'Metadata columns align across clients');
          }
        }
      } finally { await context.close(); }
    }
  }
  assert.deepEqual(report.errors, []);
  console.log('Gateway typography accepted: '+report.cases.length+' page cases.');
} finally {
  await writeFile(output+'/report.json',JSON.stringify(report,null,2)+'\n');
  await browser.close(); await server.close();
}
