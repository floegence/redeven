import type { NormalizedDesktopShellOpenWebServiceWindowRequest, ManagedWebEntranceContext } from '../shared/desktopShellWebServiceWindowIPC';

/** Only the declared entrance's first document chain owns bootstrap auth. */
export class ManagedWebEntranceNavigation {
  private pending = false;
  constructor(public context?: ManagedWebEntranceContext) { this.begin(context); }
  begin(context?: ManagedWebEntranceContext): void { this.context = context; this.pending = Boolean(context); }
  observe(resourceType: string, statusCode: number): boolean {
    if (!this.pending || resourceType !== 'mainFrame') return false;
    if (statusCode >= 300 && statusCode < 400) return false;
    this.pending = false;
    return statusCode === 401 || statusCode === 403;
  }
}

export function redactManagedEntranceAddress(address: string): string {
  try {
    const url = new URL(address);
    for (const key of Array.from(url.searchParams.keys())) {
      if (/token|password|secret|authorization|api[_-]?key/iu.test(key)) url.searchParams.set(key, '…');
    }
    return url.toString();
  } catch { return ''; }
}

/** Preserve the authorized route and remote bootstrap ticket when retrying. */
export function applyManagedWebEntrance(request: NormalizedDesktopShellOpenWebServiceWindowRequest, value: unknown): NormalizedDesktopShellOpenWebServiceWindowRequest {
  const opening = value as { state?: string; app_path?: string; managed_entrance?: ManagedWebEntranceContext; forward?: { forward_id?: string; target_url?: string } } | null;
  if (opening?.state !== 'ready' || typeof opening.app_path !== 'string' || opening.forward?.forward_id !== request.forward_id || opening.forward.target_url !== request.target_url || opening.managed_entrance?.service_id !== request.managed_entrance?.service_id || !opening.managed_entrance?.launch_generation || opening.managed_entrance.launch_generation.length > 512) throw new Error('The managed service entrance could not be prepared.');
  const app = new URL(opening.app_path, 'http://redeven.invalid');
  if (app.origin !== 'http://redeven.invalid' || decodeURIComponent(app.pathname).startsWith('//') || !opening.app_path.startsWith('/') || opening.app_path.startsWith('//') || /[\\\r\n\t ]/u.test(decodeURIComponent(app.pathname))) throw new Error('The managed service entrance is invalid.');
  const route = new URL(request.url);
  if (route.hostname === `pf-${request.forward_id}.localhost`) route.pathname = app.pathname;
  else if (route.pathname.startsWith(`/pf/${request.forward_id}/`)) route.pathname = `/pf/${request.forward_id}${app.pathname}`;
  else if (route.pathname === '/_redeven_boot/' || route.pathname === '/_redeven_boot') {
    if (!route.hash.startsWith('#redeven=')) throw new Error('The protected bootstrap is unavailable.');
    const init = JSON.parse(Buffer.from(route.hash.slice(9), 'base64url').toString('utf8'));
    if (init.v !== 2 || init.code_space_id !== request.forward_id || init.floe_app !== 'com.floegence.redeven.portforward') throw new Error('The protected bootstrap identity is invalid.');
    init.app_path = opening.app_path;
    route.hash = `redeven=${Buffer.from(JSON.stringify(init)).toString('base64url')}`;
    return { ...request, url: route.toString(), managed_entrance: opening.managed_entrance };
  } else throw new Error('The managed service protected route is unavailable.');
  route.search = app.search; route.hash = app.hash;
  return { ...request, url: route.toString(), managed_entrance: opening.managed_entrance };
}
