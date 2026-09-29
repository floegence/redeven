import type { FlowerBrowserInstallationSnapshot } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { BrowserSourceOperation, BrowserSourceResult, BrowserSourceSelection, BrowserSourceService } from './browserSourceContract';

const bounded = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit;
export function browserSourcePort(service: BrowserSourceService, select: (selection: BrowserSourceSelection, signal: AbortSignal) => Promise<void>, update: (status: FlowerBrowserInstallationSnapshot) => void) {
  let unsubscribe: (() => void) | undefined;
  const execute = async (operation: BrowserSourceOperation, signal: AbortSignal): Promise<BrowserSourceResult> => {
    signal.throwIfAborted();
    const management = service.management;
    switch (operation.method) {
      case 'source.preference': return service.preference(signal);
      case 'source.profiles': return service.profiles(signal);
      case 'source.status': return service.status(signal);
      case 'source.createProfile':
        if (bounded(operation.name, 120)) return service.createProfile(operation.name, signal);
        break;
      case 'source.discover':
        if (bounded(operation.endpoint, 8192)) return service.discover(operation.endpoint, signal);
        break;
      case 'source.setup':
        if (typeof operation.installationID !== 'string' || !/^browser-[a-f0-9]{24}$/u.test(operation.installationID)) throw new Error('Browser source operation unavailable');
        return management.setupExtension!(operation.installationID);
      case 'source.remoteBrowser':
        if (!management.prepareRemoteBrowser || typeof operation.installationID !== 'string' || !/^browser-[a-f0-9]{24}$/u.test(operation.installationID)) break;
        await management.prepareRemoteBrowser(operation.installationID, signal);
        return;
      case 'source.openExtension':
        if (typeof operation.installationID !== 'string' || !/^browser-[a-f0-9]{24}$/u.test(operation.installationID)) throw new Error('Browser source operation unavailable');
        if (['extensions', 'folder', 'connect'].includes(operation.action)) { await management.openExtension!(operation.action, operation.installationID); return; }
        break;
      case 'source.installation': return management.loadBrowserInstallation!();
      case 'source.enabled':
        if (typeof operation.enabled === 'boolean') return management.saveBrowserEnabled!(operation.enabled);
        break;
      case 'source.install': {
        const request = operation.request;
        // Chunk transport remains inside the environment's existing installer.
        if ((request?.action === 'start' || request?.action === 'prepare_system') && bounded(request.package_id, 256) && ['download', 'upload'].includes(request.source ?? '')) return management.installBrowser!({ action: request.action, package_id: request.package_id, source: request.source });
        if (request?.action === 'cancel' && (request.operation_id === undefined || bounded(request.operation_id, 256))) return management.installBrowser!({ action: 'cancel', operation_id: request.operation_id });
        break;
      }
      case 'source.watch':
        if (typeof operation.enabled !== 'boolean') break;
        unsubscribe?.(); unsubscribe = undefined;
        if (operation.enabled) unsubscribe = management.subscribeBrowserInstallation?.(update);
        return;
      case 'source.select': {
        const selection = operation.selection, request = selection?.request;
        if (!selection || !bounded(selection.label, 8192) || !request || typeof request !== 'object') break;
        // Runtime validates source identity/authorization; do not forward extra
        // fields from the child into the environment's product request.
        if ('workspace_id' in request && bounded(request.workspace_id, 256) && (request.initial_target === undefined || request.initial_target === '' || bounded(request.initial_target, 256))) return void await select({ label: selection.label, request: { workspace_id: request.workspace_id, initial_target: request.initial_target } }, signal);
        if ('managed_profile_id' in request && bounded(request.managed_profile_id, 256)) return void await select({ label: selection.label, request: { managed_profile_id: request.managed_profile_id } }, signal);
        if ('connection' in request && request.connection && typeof request.connection === 'object') {
          const connection = request.connection;
          if ('extension_profile_id' in connection && bounded(connection.extension_profile_id, 64) && !['tab_id', 'tab_url', 'tab_title', 'new_tab', 'cdp_url', 'profile_id', 'managed_profile_id'].some(key => key in connection)) {
            return void await select({ label: selection.label, request: { connection: { extension_profile_id: connection.extension_profile_id } } }, signal);
          }
          if ('cdp_url' in connection && bounded(connection.cdp_url, 8192) && bounded(connection.profile_id, 256) && bounded(connection.tab_id, 256) && bounded(connection.tab_url, 8192) && typeof connection.tab_title === 'string' && connection.tab_title.length <= 512) return void await select({ label: selection.label, request: { connection: { cdp_url: connection.cdp_url, profile_id: connection.profile_id, tab_id: connection.tab_id, tab_url: connection.tab_url, tab_title: connection.tab_title } } }, signal);
        }
        break;
      }
    }
    throw new Error('Browser source operation unavailable');
  };
  return { execute, close: () => { unsubscribe?.(); unsubscribe = undefined; } };
}
