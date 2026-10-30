import { PluginPlatformClient, PluginSurfaceSlot, createPluginSurfaceScope, createReDevPluginSurfaceTransport, type FetchLike, type PluginSurfaceHost } from '@floegence/redevplugin-ui';
import { prepareCenterPluginOrigin } from '../ui/services/pluginWebOrigin';
import { openRuntimeSession } from '../../../../../desktop/scripts/fixtures/gateway-runtime-browser';

// A backend-free package tests the actual product routes and published sandbox.
// Its messages are test observations only; the SDK owns all surface authority.
export async function verifyPluginWebApplication(packageBase64: string, center: boolean): Promise<string[]> {
  const { current, acquisition } = await openRuntimeSession();
  const authenticatedFetch: FetchLike = (input, init) => {
    const headers = new Headers(init.headers);
    headers.set('X-ReDevPlugin-CSRF', 'redeven-env-v1');
    headers.set('X-Redeven-Plugin-Session', acquisition.plugin_session_credential);
    return fetch(input, { ...init, headers });
  };
  const scope = createPluginSurfaceScope();
  const client = new PluginPlatformClient({ fetch: authenticatedFetch, surfaceScope: scope, surfaceTransport: createReDevPluginSurfaceTransport({ fetch: authenticatedFetch }) });
  const stage = document.createElement('div');
  stage.style.cssText = 'position:fixed;inset:80px;z-index:10000;background:white;display:flex';
  document.body.append(stage);
  const observations: MessageEvent[] = [];
  const observe = (event: MessageEvent) => {
    if (event.data?.type === 'redeven.web-qualification') observations.push(event);
  };
  window.addEventListener('message', observe);
  const slots: PluginSurfaceSlot[] = [];
  let pluginID: string | undefined;
  let consent = false;
  let confirmations = 0;
  const require = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const evidence = async (host: PluginSurfaceHost) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const event = observations.find(item => item.source === host.element.contentWindow);
      if (event) {
        const value = event.data;
        require(event.origin === new URL(host.element.src).origin && value.origin === event.origin, 'Plugin observation came from another origin');
        require(value.parentDenied && value.managementStatus === 404, 'Plugin reached parent or management authority');
        require(value.count === 1 && value.workerValue === 2 && JSON.stringify(value.pixel) === '[255,0,0,255]', 'Native module, DOM, Worker or Canvas failed');
        return event.origin;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Native Web application evidence was not received');
  };
  try {
    const bytes = Uint8Array.from(atob(packageBase64), value => value.charCodeAt(0));
    const inspection = await client.inspectUploadedExternalPackage({ action: 'install' }, new Blob([bytes]));
    const installed = await client.installInspectedPackage({ inspection_id: inspection.inspection_id, expected_package_sha256: inspection.inspected_hashes.package_sha256 });
    pluginID = installed.plugin.plugin_instance_id;
    require(installed.plugin.enable_state === 'enabled', 'Explicit install was not enabled');
    const open = async () => {
      const container = document.createElement('div');
      container.style.cssText = 'width:50%;height:400px';
      stage.append(container);
      const slot = PluginSurfaceSlot.create({ stage: container });
      slots.push(slot);
      const host = await client.openSurfaceInSlot(slot, { plugin_instance_id: pluginID!, surface_id: 'web.view', expected_management_revision: installed.plugin.management_revision }, {
        prepareWebOrigin: center ? prepareCenterPluginOrigin : undefined,
        confirmClose: () => { confirmations++; return consent; },
      });
      return { slot, host, origin: await evidence(host) };
    };
    const first = await open();
    const second = await open();
    require(first.origin !== second.origin && first.host.element !== second.host.element, 'Simultaneous containers shared a surface');
    require(await first.slot.requestClose() === undefined && first.host.element.isConnected && confirmations === 1, 'Unsaved close cancellation removed the application');
    consent = true;
    require(await first.slot.requestClose() !== undefined && !first.host.element.isConnected && second.host.element.isConnected, 'Closing one application affected another');
    const reopened = await open();
    require(reopened.origin !== first.origin && reopened.host.surfaceInstanceId !== first.host.surfaceInstanceId, 'Reopen reused revoked surface authority');
    const confirmationCount = confirmations;
    const record = (await client.catalog()).plugins.find(item => item.plugin_instance_id === pluginID)!;
    await client.disablePlugin({ plugin_instance_id: pluginID, expected_management_revision: record.management_revision, reason: 'qualification' });
    // The host may retain its layout container; the SDK clears the document
    // and removes same-origin authority without asking the application.
    for (const surface of [second, reopened]) {
      require(surface.host.element.src === 'about:blank' && !surface.host.element.sandbox.contains('allow-same-origin'), 'Disabled application retained its document or origin authority');
    }
    require(confirmations === confirmationCount, 'Forced invalidation asked for an unsaved-close veto');
    return ['Published Web package installs and runs native ESM, dynamic import, DOM, Worker and Canvas through the product route', 'Plugin origin cannot read parent DOM or Runtime management', 'Independent simultaneous surfaces, cancelled unsaved close, confirmed close and fresh reopen', 'Disable invalidates all plugin surfaces without an unsaved-close veto'];
  } finally {
    try {
      await Promise.all(slots.map(slot => slot.dispose()));
      if (pluginID) {
        const record = (await client.catalog()).plugins.find(item => item.plugin_instance_id === pluginID);
        if (record) await client.uninstallPlugin({ plugin_instance_id: pluginID, expected_management_revision: record.management_revision, delete_data: true });
      }
    } finally {
      window.removeEventListener('message', observe);
      stage.remove();
      await current.close();
    }
  }
}
