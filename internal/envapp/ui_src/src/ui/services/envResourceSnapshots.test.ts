import { describe, expect, it } from 'vitest';
import { containerInventorySnapshot, containerRuntimeSnapshot, containerServiceSnapshot, forwardSnapshot, hostApplicationSnapshot, managedServiceSnapshot } from './envResourceSnapshots';

describe('disposable resource presentation contracts', () => {
  it('keeps application icons and process identities but excludes viewer capabilities', () => {
    const application = { id: 'editor', name: 'Editor', description: '', categories: [], icon: 'data:image/png;base64,aGVsbG8=', launch_token: 'secret' };
    const result = hostApplicationSnapshot({ availability: { ready: true, supported: true, backend: 'macos', token: 'secret' }, applications: [application],
      sessions: [{ id: 'session', state: 'running', application, forward: { target_url: 'http://secret' } }], running: [{ application_id: 'editor', instances: ['process-1'] }], logs: ['secret'] });
    expect(result.applications[0].icon).toBe(application.icon);
    expect(result.running?.[0].instances).toEqual(['process-1']);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(() => hostApplicationSnapshot({ ...result, applications: [{ ...application, categories: [{}] }] })).toThrow();
  });
  it('retains only container summary fields and never inspect, logs or configuration contents', () => {
    const inventory = containerInventorySnapshot('containers', [{ container_id: 'one', name: 'API', state: 'running', ports: [{ port: 80, host_port: 8080, token: 'secret' }], inspect: { Env: ['TOKEN=secret'] }, logs: 'secret' }]);
    expect(inventory[0]).toMatchObject({ ports: [{ port: 80, host_port: 8080 }] });
    const services = containerServiceSnapshot([{ service_id: 'docker', name: 'Docker', engine: 'docker', state: 'running', capabilities: { start: true, stop: true, restart: true, plan: 'secret' }, configuration: { mode: 'local', sources: ['engine'], content: 'secret' } }]);
    expect(JSON.stringify([inventory, services])).not.toContain('secret');
    expect(() => containerInventorySnapshot('volumes', [{}])).toThrow();
    expect(() => containerRuntimeSnapshot([{ engine: 'docker', state: 'ready' }])).toThrow();
    expect(() => containerInventorySnapshot('images', [{ id: 'id', tags: [{ token: 'secret' }] }])).toThrow();
  });
  it('never persists saved URL credentials, query secrets, active operations or execution plans', () => {
    const forwards = forwardSnapshot([{ forward_id: 'web', name: 'Web', target_url: 'http://user:secret@localhost:3000/path?token=secret#secret', health: { status: 'healthy', last_error: 'secret' }, default_app_path: '/secret', token: 'secret' }]);
    expect(forwards[0].target_url).toBe('http://localhost:3000/path');
    const managed = managedServiceSnapshot([{ service_id: 'managed', name: 'Managed', deployment: 'host', release_status: { schema_version: 2, check_status: 'fresh' }, icon: { media_type: 'image/svg+xml', data: '<svg/>', sha256: 'icon' }, active_operation: { token: 'secret' }, plan: 'secret', configuration: { secret: true }, actions: { start: { available: true, plan: 'secret' } } }]);
    expect(managed[0].icon?.data).toBe('<svg/>');
    expect(JSON.stringify([forwards, managed])).not.toContain('secret');
    expect(() => forwardSnapshot([{ forward_id: 'bad', target_url: 'invalid' }])).toThrow();
    expect(() => managedServiceSnapshot([{ service_id: 'bad' }])).toThrow();
  });
  it('accepts successful empty inventories for every surface', () => {
    expect(containerRuntimeSnapshot([])).toEqual([]);
    expect(containerServiceSnapshot([])).toEqual([]);
    expect(containerInventorySnapshot('pods', [])).toEqual([]);
    expect(forwardSnapshot([])).toEqual([]);
    expect(managedServiceSnapshot([])).toEqual([]);
  });
  it('rejects corrupt presentation field types before rendering them', () => {
    expect(() => containerInventorySnapshot('containers', [{ container_id: 'one', name: 42, state: 'running' }])).toThrow();
    expect(() => containerInventorySnapshot('images', [{ id: 'one', tags: 'not-an-array' }])).toThrow();
    expect(() => containerRuntimeSnapshot([{ engine: 'docker', state: 'ready', endpoint_id: 'one', capabilities: { exec: 'false' } }])).toThrow();
    expect(() => forwardSnapshot([{ forward_id: 'one', target_url: 'http://localhost', health: { latency_ms: 'slow' } }])).toThrow();
  });
});
