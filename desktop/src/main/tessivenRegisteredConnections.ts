import { createHash } from 'node:crypto';
import type { TessivenRuntimeTarget } from './tessivenRuntimes';

type SavedURL = { id: string; label: string; local_ui_url: string };
type SavedCloud = { id: string; label: string; cloud_id: string; cloud_origin: string; env_public_id: string; updated_at_ms: number };
type ConnectionOwner = {
  session_key: string;
  document_generation: string;
  lifecycle: string;
  target: { kind: string; environment_id: string; external_local_ui_url?: string; route?: string; cloud_id?: string; cloud_origin?: string; env_public_id?: string };
};
export type TessivenRegisteredConnection = { target: TessivenRuntimeTarget } & (
  { registration: SavedURL; kind: 'url' } | { registration: SavedCloud; kind: 'cloud' }
);

// Public application registrations retain their original native connection
// owner. They do not imply private control or a new remote business adapter.
export function registeredTessivenConnections(
  preferences: { saved_environments: readonly SavedURL[]; cloud_environments: readonly SavedCloud[] },
  owners: readonly ConnectionOwner[],
): TessivenRegisteredConnection[] {
  const rows: TessivenRegisteredConnection[] = [];
  const registrations = [
    ...preferences.saved_environments.map(registration => ({ kind: 'url' as const, registration })),
    ...preferences.cloud_environments.map(registration => ({ kind: 'cloud' as const, registration })),
  ];
  for (const entry of registrations) {
    const saved = entry.registration;
    const matches = owners.filter(owner => owner.lifecycle === 'open'
      && owner.target.environment_id === saved.id
      && (entry.kind === 'url'
        ? owner.target.kind === 'external_local_ui' && owner.target.external_local_ui_url === entry.registration.local_ui_url
        : owner.target.kind === 'local_environment' && owner.target.route === 'remote_desktop'
          && owner.target.cloud_id === entry.registration.cloud_id
          && owner.target.cloud_origin === entry.registration.cloud_origin
          && owner.target.env_public_id === entry.registration.env_public_id));
    const connected = matches.length === 1;
    const binding = entry.kind === 'url' ? entry.registration.local_ui_url
      : [entry.registration.cloud_origin, entry.registration.cloud_id, entry.registration.env_public_id, entry.registration.updated_at_ms];
    rows.push({ ...entry, target: {
      runtime_ref: `desktop:${entry.kind}:${encodeURIComponent(saved.id)}`,
      generation: createHash('sha256').update(JSON.stringify([saved.id, binding,
        matches.map(owner => [owner.session_key, owner.document_generation])])).digest('hex'),
      name: saved.label, source: `desktop:${entry.kind}`, location: 'current_device',
      observed_at: new Date().toISOString(), registered: true, online: connected ? true : null,
      connected, authenticated: null, actions: ['status', 'connect'], reason: 'registered_application_only',
    } });
  }
  return rows;
}
