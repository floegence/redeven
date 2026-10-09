import type {
  DesktopCloudEnvironment,
  DesktopCloudEnvironmentAccess,
} from './cloud';
import { normalizeControlPlaneOrigin } from './cloud';
import {
  normalizeDesktopCloudEnvironmentID,
  type DesktopLocalEnvironmentPreferredOpenRoute,
} from './desktopLocalEnvironmentState';

export type DesktopCloudEnvironmentRemoteCatalogEntry = Readonly<{
  region: string;
  access_point_id: string;
  access_point_origin: string;
  environment_url: string;
  description: string;
  namespace_public_id: string;
  namespace_name: string;
  status: string;
  lifecycle_status: string;
  last_seen_at_unix_ms: number;
  access?: DesktopCloudEnvironmentAccess;
}>;

export type DesktopCloudEnvironmentRecord = Readonly<{
  id: string;
  cloud_origin: string;
  cloud_id: string;
  env_public_id: string;
  region: string;
  access_point_id: string;
  access_point_origin: string;
  label: string;
  pinned: boolean;
  created_at_ms: number;
  updated_at_ms: number;
  last_used_at_ms: number;
  preferred_open_route: DesktopLocalEnvironmentPreferredOpenRoute;
  remote_web_supported: boolean;
  remote_desktop_supported: boolean;
  remote_catalog_entry?: DesktopCloudEnvironmentRemoteCatalogEntry;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function desktopCloudEnvironmentID(cloudOrigin: string, envPublicID: string): string {
  const normalizedOrigin = normalizeControlPlaneOrigin(cloudOrigin);
  const normalizedEnvPublicID = normalizeDesktopCloudEnvironmentID(envPublicID);
  return `provider:${encodeURIComponent(normalizedOrigin)}:env:${encodeURIComponent(normalizedEnvPublicID)}`;
}

export function defaultDesktopCloudEnvironmentLabel(envPublicID: string): string {
  return normalizeDesktopCloudEnvironmentID(envPublicID);
}

export function desktopCloudEnvironmentRemoteCatalogEntryFromPublished(
  published: DesktopCloudEnvironment,
): DesktopCloudEnvironmentRemoteCatalogEntry {
  return {
    region: compact(published.region),
    access_point_id: compact(published.access_point_id),
    access_point_origin: normalizeControlPlaneOrigin(published.access_point_origin),
    environment_url: compact(published.environment_url),
    description: compact(published.description),
    namespace_public_id: compact(published.namespace_public_id),
    namespace_name: compact(published.namespace_name),
    status: compact(published.status),
    lifecycle_status: compact(published.lifecycle_status),
    last_seen_at_unix_ms: Number(published.last_seen_at_unix_ms) || 0,
    ...(published.access ? { access: published.access } : {}),
  };
}

type CreateDesktopCloudEnvironmentRecordOptions = Readonly<{
  label?: string;
  pinned?: boolean;
  preferredOpenRoute?: DesktopLocalEnvironmentPreferredOpenRoute;
  cloudID: string;
  region: string;
  accessPointID: string;
  accessPointOrigin: string;
  remoteWebSupported?: boolean;
  remoteDesktopSupported?: boolean;
  remoteCatalogEntry?: DesktopCloudEnvironmentRemoteCatalogEntry;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
}>;

export function createDesktopCloudEnvironmentRecord(
  cloudOrigin: string,
  envPublicID: string,
  options: CreateDesktopCloudEnvironmentRecordOptions,
): DesktopCloudEnvironmentRecord {
  const normalizedOrigin = normalizeControlPlaneOrigin(cloudOrigin);
  const normalizedEnvPublicID = normalizeDesktopCloudEnvironmentID(envPublicID);
  const cloudID = compact(options.cloudID);
  const region = compact(options.region);
  const accessPointID = compact(options.accessPointID);
  const accessPointOrigin = normalizeControlPlaneOrigin(options.accessPointOrigin);
  if (cloudID === '') {
    throw new Error('Provider ID is required.');
  }
  if (region === '' || accessPointID === '') {
    throw new Error('Access point identity is required.');
  }
  const now = Math.max(
    Number(options.createdAtMS ?? Number.NaN) || 0,
    Number(options.updatedAtMS ?? Number.NaN) || 0,
    Number(options.lastUsedAtMS ?? Number.NaN) || 0,
    Date.now(),
  );
  return {
    id: desktopCloudEnvironmentID(normalizedOrigin, normalizedEnvPublicID),
    cloud_origin: normalizedOrigin,
    cloud_id: cloudID,
    env_public_id: normalizedEnvPublicID,
    region,
    access_point_id: accessPointID,
    access_point_origin: accessPointOrigin,
    label: compact(options.label) || defaultDesktopCloudEnvironmentLabel(normalizedEnvPublicID),
    pinned: options.pinned === true,
    created_at_ms: Number(options.createdAtMS ?? now) || now,
    updated_at_ms: Number(options.updatedAtMS ?? now) || now,
    last_used_at_ms: Number(options.lastUsedAtMS ?? 0) || 0,
    preferred_open_route: options.preferredOpenRoute ?? 'auto',
    remote_web_supported: options.remoteWebSupported !== false,
    remote_desktop_supported: options.remoteDesktopSupported !== false,
    ...(options.remoteCatalogEntry ? { remote_catalog_entry: options.remoteCatalogEntry } : {}),
  };
}

export function providerEnvironmentSupportsRemoteDesktop(
  environment: DesktopCloudEnvironmentRecord,
): boolean {
  return environment.remote_desktop_supported === true;
}

export function providerEnvironmentStableSortKey(
  environment: DesktopCloudEnvironmentRecord,
): readonly [number, number, string, string] {
  return [
    environment.pinned ? 0 : 1,
    environment.created_at_ms,
    environment.label.toLowerCase(),
    environment.id,
  ];
}
