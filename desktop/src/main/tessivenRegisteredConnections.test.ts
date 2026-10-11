import { expect, it } from 'vitest';
import { registeredTessivenConnections } from './tessivenRegisteredConnections';

it('keeps saved URL and Cloud paths visible without opening or merging them', () => {
  const preferences = {
    saved_environments: [{ id: 'url-1', label: 'Saved', local_ui_url: 'https://runtime.example/' }],
    cloud_environments: [{ id: 'cloud-1', label: 'Saved', cloud_id: 'cloud', cloud_origin: 'https://cloud.example', env_public_id: 'env-1', updated_at_ms: 1 }],
  };
  const rows = registeredTessivenConnections(preferences, []);
  expect(rows).toHaveLength(2);
  expect(rows.map(row => row.target.runtime_ref)).toEqual(['desktop:url:url-1', 'desktop:cloud:cloud-1']);
  for (const row of rows) {
    expect(row.target).toMatchObject({ registered: true, connected: false, online: null, authenticated: null, actions: ['status', 'connect'] });
    expect(JSON.stringify(row.target)).not.toContain('https://');
  }
});

it('uses the exact registered path and document generation without treating a window as authentication', () => {
  const saved = { id: 'url-1', label: 'Saved', local_ui_url: 'https://runtime.example/' };
  const owner = { session_key: 'url:registered', document_generation: 'one', lifecycle: 'open' as const,
    target: { kind: 'external_local_ui' as const, environment_id: saved.id, external_local_ui_url: saved.local_ui_url } };
  const preferences = { saved_environments: [saved], cloud_environments: [] };
  const [first] = registeredTessivenConnections(preferences, [owner]);
  expect(first?.target).toMatchObject({ connected: true, online: true, authenticated: null });
  const [next] = registeredTessivenConnections(preferences, [{ ...owner, document_generation: 'two' }]);
  expect(next?.target.generation).not.toBe(first?.target.generation);
  const [replaced] = registeredTessivenConnections({ ...preferences,
    saved_environments: [{ ...saved, local_ui_url: 'https://replacement.example/' }] }, [owner]);
  expect(replaced?.target.connected).toBe(false);
  expect(replaced?.target.generation).not.toBe(first?.target.generation);
});
