import { describe, expect, it } from 'vitest';
import { buildContainerServiceFlowerIntent, containerServiceDiagnosticKey, containerServiceNeedsAssistance } from './containerServiceAskFlower';
import { parseAskFlowerContextActionEnvelope } from '../../../../../flower_ui/src/contextActionWire';
import { containerServiceSnapshot } from '../services/envResourceSnapshots';
import type { ContainerService } from '../services/containerResourcesApi';

const service: ContainerService = {
  service_id: 'service-docker', engine: 'docker', name: 'Docker Engine', implementation: 'docker_engine', state: 'permission',
  remote: false, rootless: false, guidance_code: 'host_manager',
  capabilities: { start: false, stop: false, restart: false }, configuration: { mode: 'unavailable' },
  diagnostic: { phase: 'health', code: 'permission_denied', observed_at_unix_ms: 1720000000000 },
};

describe('Container engine Ask Flower', () => {
  it('preserves safe diagnostics through the cache and freezes one selected engine without secrets or authority', () => {
    const cached = containerServiceSnapshot([{ ...service, endpoint: 'ssh://secret', content: 'private config',
      diagnostic: { ...service.diagnostic, stderr: 'secret output' } }])[0];
    expect(cached.diagnostic).toEqual(service.diagnostic);
    const intent = buildContainerServiceFlowerIntent({ service: cached, environmentID: 'env-26', environmentName: 'udesk26', summary: 'Access denied', capturedAtMs: 1720000001000 });
    expect(intent).toMatchObject({ source_surface: 'container_services', notes: [], pending_attachments: [] });
    expect(intent).not.toHaveProperty('initial_prompt');
    const action = parseAskFlowerContextActionEnvelope(intent.context_action)!;
    expect(action.source).toEqual({ surface: 'container_services', surface_id: 'service-docker' });
    expect(action.target).toEqual({ target_id: 'current', locality: 'auto' });
    expect(action.context).toHaveLength(1);
    const item = intent.context_items[0];
    expect(item.kind).toBe('text_snapshot');
    if (item.kind !== 'text_snapshot') throw new Error('Expected text snapshot');
    const snapshot = JSON.parse(item.content);
    expect(snapshot).toMatchObject({ environment: { id: 'env-26', name: 'udesk26' }, service: { service_id: 'service-docker', rootless: false, remote: false, version: null }, diagnostic: service.diagnostic });
    expect(item.content).not.toMatch(/secret|private config|stderr/);
    expect(action).not.toHaveProperty('execution_context');
    (cached as { state: string }).state = 'running';
    expect(JSON.parse(item.content).service.state).toBe('permission');
  });
  it('does not guess missing diagnostics or runtime identity', () => {
    const older = { ...service, diagnostic: undefined, rootless: undefined, remote: undefined };
    expect(containerServiceDiagnosticKey(older)).toBe('containers.services.diagnostics.permission');
    const intent = buildContainerServiceFlowerIntent({ service: older, environmentID: 'env-26', environmentName: '', summary: 'Permission required', capturedAtMs: 1 });
    const item = intent.context_items[0];
    if(item.kind !== 'text_snapshot') throw new Error('Expected text snapshot');
    expect(JSON.parse(item.content)).toMatchObject({ diagnostic: null, service: { rootless: null, remote: null } });
  });
  it('prioritizes the observed probe phase and retains normal service actions', () => {
    expect(containerServiceDiagnosticKey(service)).toBe('containers.services.diagnostics.permissionHealth');
    expect(containerServiceDiagnosticKey({ ...service, diagnostic: { ...service.diagnostic!, phase: 'management' } })).toBe('containers.services.diagnostics.permissionManagement');
    expect(containerServiceNeedsAssistance(service)).toBe(true);
    expect(containerServiceNeedsAssistance({ ...service, state: 'running', diagnostic: undefined })).toBe(false);
    expect(containerServiceNeedsAssistance({ ...service, state: 'not_installed' })).toBe(false);
    expect(containerServiceNeedsAssistance({ ...service, state: 'stopped', capabilities: { start: true, stop: false, restart: false } })).toBe(false);
  });
});
