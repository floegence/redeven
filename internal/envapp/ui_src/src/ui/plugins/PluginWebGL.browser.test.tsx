import { expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { PluginSurfaceSlot } from '@floegence/redevplugin-ui';
import { bindTestSessionHTTP } from '../../test/sessionHTTPFixture';
import {
  createPluginSurfacePlacementCoordinator,
  createRedevenPluginPlatform,
  redevPluginAPIPath,
  redevPluginCSRFHeader,
  redevPluginCSRFProof,
} from './pluginPlatform';

const fixtureCommands = commands as unknown as { buildPluginWebGLWorker(): Promise<string> };

async function digest(content: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

it('renders WebGL through released SDK placements and retires each exact surface', async () => {
  const worker = await fixtureCommands.buildPluginWebGLWorker();
  const workerHash = await digest(worker);
  const entryHash = await digest('webgl-entry');
  const reports: Array<{ surface: string; phase: string; samples?: Record<string, number[]>; message?: string }> = [];
  const requests: string[] = [];
  const surfaces = new Map<string, { nonce: string; closed: boolean }>();
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 600_000).toISOString();
  const envelope = (data: unknown) => Response.json({ ok: true, data });
  const unbind = await bindTestSessionHTTP(async (input, init) => {
    const path = new URL(String(input), location.origin).pathname;
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get(redevPluginCSRFHeader)).toBe(redevPluginCSRFProof);
    const body = JSON.parse(String(init?.body));
    requests.push(path);
    if (path === `${redevPluginAPIPath}/surfaces/open`) {
      const id = `webgl_surface_${surfaces.size + 1}`;
      const nonce = `webgl_nonce_${surfaces.size + 1}`;
      surfaces.set(id, { nonce, closed: false });
      return envelope({
        plugin_id: 'example.webgl', plugin_instance_id: 'webgl_instance', plugin_version: '1.0.0',
        surface_id: 'webgl.view', surface_instance_id: id, active_fingerprint: entryHash,
        entry_path: 'ui/index.html', entry_sha256: entryHash, asset_session_nonce: `asset_nonce_${id}`,
        management_revision: 1, revoke_epoch: 1, runtime_generation_id: 'webgl_runtime',
        asset_ticket: `ticket_${id}`, asset_ticket_id: `ticket_id_${id}`, bridge_nonce: nonce,
        issued_at: issuedAt, expires_at: expiresAt,
      });
    }
    const route = path.match(/\/surfaces\/([^/]+)\/(prepare|bridge-token|dispose)$/);
    if (route) {
      const [, id, action] = route;
      const surface = surfaces.get(id)!;
      expect(surface.closed).toBe(false);
      if (action === 'prepare') return envelope({
        asset_session: `asset_${id}`, asset_session_id: `asset_id_${id}`, asset_session_nonce: `asset_nonce_${id}`,
        entry_path: 'ui/index.html', entry_sha256: entryHash, management_revision: 1, revoke_epoch: 1,
        issued_at: issuedAt, expires_at: expiresAt,
        document: {
          schema_version: 'redevplugin.opaque_surface_document.v3', entry_path: 'ui/index.html', entry_sha256: entryHash,
          title: 'WebGL fixture', language: 'en', direction: 'ltr', body_html: '<main></main>', styles: [], assets: [],
          worker: { path: 'ui/worker.js', sha256: workerHash, type: 'classic', content: worker },
          critical_bytes: new TextEncoder().encode(worker).byteLength + 13,
        },
      });
      if (action === 'bridge-token') {
        expect(body.handshake.surface_instance_id).toBe(id);
        expect(body.handshake.bridge_nonce).toBe(surface.nonce);
        return envelope({
          plugin_gateway_token: `gateway_${id}`, plugin_gateway_token_id: `gateway_id_${id}`,
          asset_session: `asset_${id}`, asset_session_id: `asset_id_${id}`, issued_at: issuedAt, expires_at: expiresAt,
        });
      }
      expect(body.bridge_nonce).toBe(surface.nonce);
      surface.closed = true;
      return envelope({ disposed: true, state: 'closed', previous_state: 'active', revoked: true });
    }
    if (path === `${redevPluginAPIPath}/rpc`) {
      expect(body.method).toBe('webgl.report');
      expect(body.plugin_gateway_token).toBe(`gateway_${body.surface_instance_id}`);
      reports.push({ surface: body.surface_instance_id, ...body.params });
      return envelope({ data: {} });
    }
    throw new Error(`Unexpected WebGL fixture request: ${path}`);
  });
  const platform = createRedevenPluginPlatform();
  const coordinator = createPluginSurfacePlacementCoordinator(platform.client);
  const stage = document.createElement('div');
  Object.assign(stage.style, { position: 'fixed', inset: '0' });
  document.body.append(stage);
  const errors: unknown[] = [];
  try {
    for (let generation = 1; generation <= 2; generation++) {
      const slot = PluginSurfaceSlot.create({ stage });
      const host = await coordinator.open(slot, {
        plugin_instance_id: 'webgl_instance', surface_id: 'webgl.view', expected_management_revision: 1,
      }, { onError: (error) => errors.push(error) });
      const id = `webgl_surface_${generation}`;
      expect(host.element.getAttribute('sandbox')).toBe('allow-scripts');
      await expect.poll(() => reports.find((report) => report.surface === id && ['rendered', 'failed'].includes(report.phase)), { timeout: 10_000 }).toBeDefined();
      const rendered = reports.find((report) => report.surface === id && ['rendered', 'failed'].includes(report.phase))!;
      expect(rendered.message).toBeUndefined();
      expect(rendered.samples).toEqual({ webgl: [255, 0, 0, 255], webgl2: [0, 255, 0, 255] });
      coordinator.setVisible(slot, true);
      await expect.poll(() => reports.some((report) => report.surface === id && report.phase === 'visible')).toBe(true);
      coordinator.setVisible(slot, false);
      await expect.poll(() => reports.some((report) => report.surface === id && report.phase === 'hidden')).toBe(true);
      await coordinator.release(slot);
      expect(surfaces.get(id)?.closed).toBe(true);
      expect(stage.querySelector('iframe')).toBeNull();
    }
    expect(requests.filter((path) => path.endsWith('/dispose'))).toEqual([
      `${redevPluginAPIPath}/surfaces/webgl_surface_1/dispose`,
      `${redevPluginAPIPath}/surfaces/webgl_surface_2/dispose`,
    ]);
    expect(errors).toEqual([]);
  } finally {
    try { await coordinator.dispose(); } finally { stage.remove(); unbind(); }
  }
}, 30_000);
