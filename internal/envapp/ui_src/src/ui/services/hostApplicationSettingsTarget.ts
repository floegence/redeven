import { getSandboxWindowInfo } from './sandboxWindowRegistry';

/** IMPORTANT: Only an exact product viewer opened by this Env can route Settings.
 * No message may name an environment, initiate a runtime, or choose a category. */
export function isHostApplicationSettingsRequest(event: MessageEvent): boolean {
  const owner = getSandboxWindowInfo(event.source);
  return event.data?.type === 'redeven:host-application-settings' && !!owner
    && event.origin === owner.origin && owner.app_path === '/_redeven_host_app/';
}
