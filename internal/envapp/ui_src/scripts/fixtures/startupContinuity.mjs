import { createBuiltDistServer } from '../checkPackagedRenderer.mjs';

export const navigationPages = ['terminal', 'monitor', 'files', 'codespaces', 'ports', 'applications', 'containers', 'ai', 'settings', 'plugin-center'];
export const cachePages = {
  applications: { row: 'button.host-app-tile', skeleton: '[data-testid="host-applications-initial-loading"]', title: 'Continuity Editor' },
  ports: { row: '[data-testid="unified-web-services-list"] .web-service-row', skeleton: '[data-testid="web-services-initial-loading"]', title: 'Continuity Web' },
  containers: { row: '.container-resource-table-shell tbody tr:not([data-container-skeleton-row])', skeleton: '[data-container-list-loading]', title: 'continuity-container' },
  codespaces: { row: '.codespace-card:not([data-codespace-skeleton])', skeleton: '[data-testid="codespaces-initial-loading"]', title: 'Continuity Workspace' },
};
export const icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
export const navigationKey = 'redeven-envapp:env_local-activity-navigation';
export const navigationRecord = page => ({ version: 1, target: { kind: 'builtin', page }, recentBuiltins: [page, 'terminal'] });

export async function createContinuityServer(tls) {
  const gates = new Map();
  const requests = [];
  let empty = false;
  let dataFailure = false;
  const app = { id: 'continuity-editor', name: 'Continuity Editor', description: '', categories: [], icon, custom: false };
  const catalog = () => ({ availability: { backend: 'macos', supported: true, ready: true, native_ready: true }, applications: empty ? [] : [app], sessions: [], running: empty ? [] : [{ application_id: app.id, instances: ['process-1'] }] });
  const fixtures = {
    '/api/local/runtime': () => ({ env_public_id: 'env_local', effective_run_mode: 'local' }),
    '/api/local/environment': () => ({ public_id: 'env_local', name: 'Continuity host', namespace_public_id: 'namespace', status: 'online', lifecycle_status: 'running', permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true, is_owner: true } }),
    '/_redeven_proxy/api/ui-cache-scope': () => ({ scope_id: 'c'.repeat(64) }),
    '/_redeven_proxy/api/host-applications': catalog,
    '/_redeven_proxy/api/host-applications/sessions': () => [],
    '/_redeven_proxy/api/host-applications/running': () => catalog().running,
    '/_redeven_proxy/api/forwards': () => ({ forwards: empty ? [] : [{ forward_id: 'continuity-web', name: 'Continuity Web', target_url: 'http://localhost:3000', saved: true, description: '', access_mode: 'unified_proxy', created_at_unix_ms: 1, updated_at_unix_ms: 1, last_opened_at_unix_ms: 1, health: { status: 'healthy' } }] }),
    '/_redeven_proxy/api/managed-web-services': () => ({ services: [] }),
    '/_redeven_proxy/api/managed-web-services/catalog': () => ({ templates: [] }),
    '/_redeven_proxy/api/container-resources/runtimes': () => ({ engines: [{ endpoint_id: 'local-engine', engine: 'docker', state: 'ready', engine_version: '27.0', capabilities: { collection_stats: true } }] }),
    '/_redeven_proxy/api/container-resources/containers': () => ({ containers: empty ? [] : [{ container_id: 'continuity-container', name: 'continuity-container', state: 'running', image: { reference: 'example:latest' }, ports: [], created_at_unix_ms: 1 }] }),
    '/_redeven_proxy/api/container-resource-operations': () => ({ operations: [] }),
    '/_redeven_proxy/api/spaces': () => ({ spaces: empty ? [] : [{ code_space_id: 'continuity-space', name: 'Continuity Workspace', description: 'Workspace description', workspace_path: '/workspace', running: true, pid: 42, code_port: 13337, created_at_unix_ms: 1, updated_at_unix_ms: 1, last_opened_at_unix_ms: 1 }] }),
    '/_redeven_proxy/api/code-runtime/status': () => ({ active_runtime: { detection_state: 'ready', present: true }, operation: { state: 'idle' } }),
  };
  const group = path => path === '/api/local/environment' ? 'permissions' : path.endsWith('/ui-cache-scope') ? 'scope' : path.startsWith('/_redeven_proxy/api/') ? 'data' : 'runtime';
  const server = await createBuiltDistServer({ accessReady: true, tls, renewPeerOnConnect: true, handleRequest: async (_request, response, url) => {
    const fixture = fixtures[url.pathname];
    if (!fixture) return false;
    requests.push(url.pathname);
    const gate = gates.get(group(url.pathname));
    if (gate) await gate.promise;
    response.writeHead(dataFailure && group(url.pathname) === 'data' ? 503 : 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(dataFailure && group(url.pathname) === 'data' ? { error: 'Fixture unavailable' } : fixture()));
    return true;
  } });
  return { ...server, requests, setEmpty: value => { empty = value; }, setDataFailure: value => { dataFailure = value; }, hold(name) {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    gates.set(name, { promise, release });
    return () => { gates.delete(name); release(); };
  }, releaseAll() { for (const gate of gates.values()) gate.release(); gates.clear(); } };
}

// Installed before the first frame; records observable page transitions rather than timers.
export function observeContinuityFrames({ row, skeleton }) {
  const frames = globalThis.__continuityFrames = [];
  const sample = () => {
    const visible = element => !!element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 && globalThis.getComputedStyle(element).visibility !== 'hidden';
    const main = globalThis.document.querySelector('[data-floe-shell-slot="main"]');
    const views = [...globalThis.document.querySelectorAll('[data-floe-keep-alive-view]')].filter(visible).map(element => element.getAttribute('data-floe-keep-alive-view')).filter(id => id !== 'activity' && id !== 'workbench');
    const value = { main: visible(main), views, row: visible(globalThis.document.querySelector(row)), skeleton: visible(globalThis.document.querySelector(skeleton)) };
    const last = frames[frames.length - 1];
    if (JSON.stringify(value) !== JSON.stringify(last)) frames.push(value);
    globalThis.requestAnimationFrame(sample);
  };
  globalThis.requestAnimationFrame(sample);
}
