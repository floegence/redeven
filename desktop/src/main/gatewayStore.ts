import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

import {
  desktopGatewayConnectionKindLabel,
  desktopGatewayManagementCapability,
  type DesktopGatewayConnectionKind,
  type DesktopGatewayEnvironment,
  type DesktopGatewayCapability,
  type DesktopGatewayServiceState,
  type DesktopGatewayStatus,
  type DesktopGatewaySource,
  type DesktopGatewayTrustState,
} from '../shared/desktopGateway';
import {
  DEFAULT_DESKTOP_SSH_AUTH_MODE,
  DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
  DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS,
  DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL,
  type DesktopSSHAuthMode,
  type DesktopSSHBootstrapStrategy,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import type { DesktopContainerEngine } from '../shared/desktopRuntimePlacement';

export const GATEWAY_STORE_SCHEMA_VERSION = 1;

export type GatewayURLConnection = Readonly<{
  kind: 'url';
  base_url: string;
  allow_loopback_http?: boolean;
}>;

export type GatewaySSHHostConnection = Readonly<{
  kind: 'ssh_host';
  ssh_destination: string;
  ssh_port?: number;
  auth_mode?: DesktopSSHAuthMode;
  ssh_password_configured?: boolean;
  ssh_password_ref?: string;
  connect_timeout_seconds?: number;
  bootstrap_strategy?: DesktopSSHBootstrapStrategy;
  release_base_url?: string;
  username?: string;
  runtime_root: string;
}>;

export type GatewaySSHContainerConnection = Readonly<{
  kind: 'ssh_container';
  ssh_destination: string;
  ssh_port?: number;
  auth_mode?: DesktopSSHAuthMode;
  ssh_password_configured?: boolean;
  ssh_password_ref?: string;
  connect_timeout_seconds?: number;
  container_engine: DesktopContainerEngine;
  username?: string;
  container_id: string;
  container_ref?: string;
  container_label?: string;
  runtime_root: string;
}>;

export type GatewayConnection =
  | GatewayURLConnection
  | GatewaySSHHostConnection
  | GatewaySSHContainerConnection;

export type GatewayTrustProfile = Readonly<{
  trust_profile_id: string;
  paired_client_key_id: string;
  paired_client_private_key_ref: string;
  gateway_id: string;
  gateway_public_key: string;
  gateway_public_key_fingerprint: string;
  binding_audience: string;
  created_at_unix_ms: number;
  last_verified_at_unix_ms?: number;
  revoked_at_unix_ms?: number;
}>;

export type GatewayRecord = Readonly<{
  schema_version: 1;
  gateway_id: string;
  display_name: string;
  local_enabled: boolean;
  connection: GatewayConnection;
  trust_profile?: GatewayTrustProfile;
  created_at_ms: number;
  updated_at_ms: number;
  last_catalog_sync_at_ms?: number;
}>;

export type GatewayStoreSnapshot = Readonly<{
  schema_version: 1;
  gateways: readonly GatewayRecord[];
}>;

type GatewayStoreFile = Readonly<{
  schema_version?: unknown;
  gateways?: readonly unknown[];
}>;

export class GatewayStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly filePath?: string,
  ) {
    super(message);
    this.name = 'GatewayStoreError';
  }
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function positiveInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  return Math.floor(numeric);
}

function normalizeGatewaySSHAuthMode(value: unknown): DesktopSSHAuthMode | undefined {
  switch (compact(value)) {
    case 'key_agent':
    case 'password':
      return compact(value) as DesktopSSHAuthMode;
    default:
      return undefined;
  }
}

function normalizeGatewaySSHPasswordRef(value: unknown): string | undefined {
  const ref = compact(value);
  return ref.startsWith('gateway-ssh-password:') ? ref : undefined;
}

export function gatewaySSHPasswordSecretRef(gatewayID: string): string {
  const cleanGatewayID = normalizeGatewayID(gatewayID);
  return cleanGatewayID ? `gateway-ssh-password:${cleanGatewayID}` : '';
}

function normalizeGatewaySSHPasswordState(value: Record<string, unknown>): Readonly<{
  auth_mode?: DesktopSSHAuthMode;
  ssh_password_configured?: boolean;
  ssh_password_ref?: string;
}> {
  const authMode = normalizeGatewaySSHAuthMode(value.auth_mode);
  if (authMode !== 'password') {
    return authMode
      ? { auth_mode: authMode, ssh_password_configured: false }
      : {};
  }
  const ref = normalizeGatewaySSHPasswordRef(value.ssh_password_ref);
  const configured = value.ssh_password_configured === true || !!ref;
  return {
    auth_mode: 'password',
    ssh_password_configured: configured,
    ...(configured && ref ? { ssh_password_ref: ref } : {}),
  };
}

function gatewayConnectionSSHDetails(connection: Exclude<GatewayConnection, GatewayURLConnection>): DesktopSSHEnvironmentDetails {
  return {
    ssh_destination: connection.ssh_destination,
    ssh_port: connection.ssh_port ?? null,
    auth_mode: connection.auth_mode ?? DEFAULT_DESKTOP_SSH_AUTH_MODE,
    connect_timeout_seconds: connection.connect_timeout_seconds ?? DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS,
    runtime_root: connection.runtime_root,
    bootstrap_strategy: connection.kind === 'ssh_host'
      ? connection.bootstrap_strategy ?? DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY
      : DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
    release_base_url: connection.kind === 'ssh_host'
      ? connection.release_base_url ?? DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL
      : DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL,
  };
}

export function gatewayRecordSSHPasswordRef(record: GatewayRecord): string {
  const connection = record.connection;
  if (connection.kind === 'url' || connection.auth_mode !== 'password') {
    return '';
  }
  return connection.ssh_password_ref ?? gatewaySSHPasswordSecretRef(record.gateway_id);
}

function normalizeGatewaySSHPasswordRefForRecord(connection: GatewayConnection, gatewayID: string): GatewayConnection {
  if (connection.kind === 'url') {
    return connection;
  }
  if (connection.auth_mode !== 'password') {
    const { ssh_password_ref: _sshPasswordRef, ssh_password_configured: _sshPasswordConfigured, ...rest } = connection;
    return rest;
  }
  if (!connection.ssh_password_configured) {
    const { ssh_password_ref: _sshPasswordRef, ...rest } = connection;
    return rest;
  }
  return {
    ...connection,
    ssh_password_ref: connection.ssh_password_ref ?? gatewaySSHPasswordSecretRef(gatewayID),
  };
}

function normalizeGatewaySSHBootstrapStrategy(value: unknown): DesktopSSHBootstrapStrategy | undefined {
  switch (compact(value)) {
    case 'auto':
    case 'desktop_upload':
    case 'remote_install':
      return compact(value) as DesktopSSHBootstrapStrategy;
    default:
      return undefined;
  }
}

function normalizeGatewayContainerEngine(value: unknown): DesktopContainerEngine {
  return compact(value).toLowerCase() === 'podman' ? 'podman' : 'docker';
}

function timestampMS(value: unknown, fallback: number): number {
  return positiveInteger(value) ?? fallback;
}

function normalizeGatewayID(value: unknown): string {
  const clean = compact(value).replace(/\s+/gu, '-');
  return /^[A-Za-z0-9._-]+$/u.test(clean) ? clean : '';
}

function sha256Base64URL(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

export function stableGatewayID(bindingAudience: string): string {
  return `gw_${sha256Base64URL(compact(bindingAudience)).slice(0, 24)}`;
}

function normalizeURLConnection(value: Record<string, unknown>): GatewayURLConnection | null {
  const baseURL = normalizeGatewayBaseURL(value.base_url);
  if (!baseURL) {
    return null;
  }
  return {
    kind: 'url',
    base_url: baseURL,
    allow_loopback_http: value.allow_loopback_http === true,
  };
}

export function normalizeGatewayBaseURL(value: unknown): string {
  const raw = compact(value);
  if (!raw) {
    return '';
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new GatewayStoreError('GATEWAY_URL_INVALID', 'Gateway URL is invalid.');
  }
  if (parsed.username || parsed.password) {
    throw new GatewayStoreError('GATEWAY_URL_EMBEDDED_CREDENTIALS', 'Gateway URL must not include embedded credentials.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new GatewayStoreError('GATEWAY_URL_UNSUPPORTED_SCHEME', 'Gateway URL must use HTTP or HTTPS.');
  }
  parsed.hash = '';
  parsed.search = '';
  if (!parsed.pathname.endsWith('/')) {
    parsed.pathname = `${parsed.pathname}/`;
  }
  return parsed.toString();
}

function normalizeSSHHostConnection(value: Record<string, unknown>): GatewaySSHHostConnection | null {
  const sshDestination = compact(value.ssh_destination);
  const runtimeRoot = compact(value.runtime_root);
  if (!sshDestination || !runtimeRoot) {
    return null;
  }
  return {
    kind: 'ssh_host',
    ssh_destination: sshDestination,
    ...(positiveInteger(value.ssh_port) ? { ssh_port: positiveInteger(value.ssh_port) } : {}),
    ...normalizeGatewaySSHPasswordState(value),
    ...(positiveInteger(value.connect_timeout_seconds) ? { connect_timeout_seconds: positiveInteger(value.connect_timeout_seconds) } : {}),
    ...(normalizeGatewaySSHBootstrapStrategy(value.bootstrap_strategy) ? { bootstrap_strategy: normalizeGatewaySSHBootstrapStrategy(value.bootstrap_strategy) } : {}),
    ...(compact(value.release_base_url) ? { release_base_url: compact(value.release_base_url) } : {}),
    ...(compact(value.username) ? { username: compact(value.username) } : {}),
    runtime_root: runtimeRoot,
  };
}

function normalizeSSHContainerConnection(value: Record<string, unknown>): GatewaySSHContainerConnection | null {
  const base = normalizeSSHHostConnection(value);
  const containerID = compact(value.container_id);
  if (!base || !containerID) {
    return null;
  }
  return {
    kind: 'ssh_container',
    ssh_destination: base.ssh_destination,
    ...(base.ssh_port ? { ssh_port: base.ssh_port } : {}),
    ...(base.auth_mode ? { auth_mode: base.auth_mode } : {}),
    ...(base.ssh_password_configured ? { ssh_password_configured: base.ssh_password_configured } : {}),
    ...(base.ssh_password_ref ? { ssh_password_ref: base.ssh_password_ref } : {}),
    ...(base.connect_timeout_seconds ? { connect_timeout_seconds: base.connect_timeout_seconds } : {}),
    container_engine: normalizeGatewayContainerEngine(value.container_engine),
    ...(base.username ? { username: base.username } : {}),
    container_id: containerID,
    ...(compact(value.container_ref) ? { container_ref: compact(value.container_ref) } : {}),
    ...(compact(value.container_label) ? { container_label: compact(value.container_label) } : {}),
    runtime_root: base.runtime_root,
  };
}

export function normalizeGatewayConnection(value: unknown): GatewayConnection | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  switch (compact(candidate.kind)) {
    case 'url':
      return normalizeURLConnection(candidate);
    case 'ssh_host':
      return normalizeSSHHostConnection(candidate);
    case 'ssh_container':
      return normalizeSSHContainerConnection(candidate);
    default:
      return null;
  }
}

export function gatewayBindingAudience(connection: GatewayConnection): string {
  switch (connection.kind) {
    case 'url':
      return connection.base_url;
    case 'ssh_host':
      return `ssh://${connection.username ? `${connection.username}@` : ''}${connection.ssh_destination}:${connection.ssh_port ?? 22}${connection.runtime_root}`;
    case 'ssh_container':
      return `ssh-container://${connection.username ? `${connection.username}@` : ''}${connection.ssh_destination}:${connection.ssh_port ?? 22}/${connection.container_id}${connection.runtime_root}`;
  }
}

export function gatewayEndpointLabel(connection: GatewayConnection): string {
  switch (connection.kind) {
    case 'url':
      return connection.base_url;
    case 'ssh_host':
      return `${connection.ssh_destination}:${connection.ssh_port ?? 22}`;
    case 'ssh_container':
      return `${connection.container_label || connection.container_id} on ${connection.ssh_destination}:${connection.ssh_port ?? 22}`;
  }
}

function normalizeTrustProfile(value: unknown, gatewayID: string): GatewayTrustProfile | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const trustProfileID = compact(candidate.trust_profile_id);
  const pairedClientKeyID = compact(candidate.paired_client_key_id);
  const pairedClientPrivateKeyRef = compact(candidate.paired_client_private_key_ref);
  const gatewayPublicKey = compact(candidate.gateway_public_key);
  const fingerprint = compact(candidate.gateway_public_key_fingerprint);
  const bindingAudience = compact(candidate.binding_audience);
  const createdAt = positiveInteger(candidate.created_at_unix_ms);
  if (!trustProfileID || !pairedClientKeyID || !pairedClientPrivateKeyRef || !gatewayID || !gatewayPublicKey || !fingerprint || !bindingAudience || !createdAt) {
    return undefined;
  }
  return {
    trust_profile_id: trustProfileID,
    paired_client_key_id: pairedClientKeyID,
    paired_client_private_key_ref: pairedClientPrivateKeyRef,
    gateway_id: gatewayID,
    gateway_public_key: gatewayPublicKey,
    gateway_public_key_fingerprint: fingerprint,
    binding_audience: bindingAudience,
    created_at_unix_ms: createdAt,
    ...(positiveInteger(candidate.last_verified_at_unix_ms) ? { last_verified_at_unix_ms: positiveInteger(candidate.last_verified_at_unix_ms) } : {}),
    ...(positiveInteger(candidate.revoked_at_unix_ms) ? { revoked_at_unix_ms: positiveInteger(candidate.revoked_at_unix_ms) } : {}),
  };
}

export function normalizeGatewayRecord(value: unknown, now = Date.now()): GatewayRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const gatewayID = normalizeGatewayID(candidate.gateway_id);
  let connection = normalizeGatewayConnection(candidate.connection);
  if (!gatewayID || !connection) {
    return null;
  }
  connection = normalizeGatewaySSHPasswordRefForRecord(connection, gatewayID);
  const rawTrustProfile = normalizeTrustProfile(candidate.trust_profile, gatewayID);
  const trustProfile = rawTrustProfile?.binding_audience === gatewayBindingAudience(connection)
    ? rawTrustProfile
    : undefined;
  return {
    schema_version: 1,
    gateway_id: gatewayID,
    display_name: compact(candidate.display_name) || gatewayID,
    local_enabled: candidate.local_enabled !== false,
    connection,
    ...(trustProfile ? { trust_profile: trustProfile } : {}),
    created_at_ms: timestampMS(candidate.created_at_ms, now),
    updated_at_ms: timestampMS(candidate.updated_at_ms, now),
    ...(positiveInteger(candidate.last_catalog_sync_at_ms) ? { last_catalog_sync_at_ms: positiveInteger(candidate.last_catalog_sync_at_ms) } : {}),
  };
}

export function gatewayTrustState(record: Pick<GatewayRecord, 'trust_profile'>): DesktopGatewayTrustState {
  if (!record.trust_profile) {
    return 'unpaired';
  }
  if (record.trust_profile.revoked_at_unix_ms) {
    return 'revoked';
  }
  return 'paired';
}

export function gatewayRecordToSource(record: GatewayRecord): DesktopGatewaySource {
  const trustState = gatewayTrustState(record);
  const connectionKind = record.connection.kind as DesktopGatewayConnectionKind;
  return {
    gateway_id: record.gateway_id,
    display_name: record.display_name,
    local_enabled: record.local_enabled,
    connection_kind: connectionKind,
    management_capability: desktopGatewayManagementCapability(connectionKind),
    capabilities: [],
    status: trustState === 'paired' ? 'unknown' : 'pairing_required',
    trust_state: trustState,
    status_message: trustState === 'paired'
      ? 'Gateway status has not been checked yet.'
      : 'Pair this Gateway before listing environments.',
    endpoint_label: gatewayEndpointLabel(record.connection),
    ...(record.connection.kind === 'url' ? {
      gateway_url: record.connection.base_url,
      allow_loopback_http: record.connection.allow_loopback_http === true,
    } : {
      ssh_details: gatewayConnectionSSHDetails(record.connection),
      ssh_password_configured: record.connection.auth_mode === 'password'
        && record.connection.ssh_password_configured === true,
      ...(record.connection.kind === 'ssh_container' ? {
        container_engine: record.connection.container_engine,
        container_id: record.connection.container_id,
        container_ref: record.connection.container_ref,
        container_label: record.connection.container_label,
      } : {}),
    }),
    ...(record.connection.kind === 'url' ? { service_state: notApplicableGatewayServiceState() } : {}),
    created_at_ms: record.created_at_ms,
    updated_at_ms: record.updated_at_ms,
    environments: [],
  };
}

function notApplicableGatewayServiceState(): DesktopGatewayServiceState {
  return {
    status: 'not_applicable',
    can_start: false,
    can_stop: false,
    can_restart: false,
    can_update: false,
    can_pair_after_start: false,
  };
}

export function gatewayRecordToSourceWithCatalog(
  record: GatewayRecord,
  catalog: Readonly<{
    status?: DesktopGatewayStatus;
    status_message?: string;
    capabilities?: readonly DesktopGatewayCapability[];
    environments?: readonly DesktopGatewayEnvironment[];
  }>,
): DesktopGatewaySource {
  const base = gatewayRecordToSource(record);
  const trustState = gatewayTrustState(record);
  if (trustState !== 'paired') {
    return base;
  }
  const status = catalog.status ?? 'online';
  return {
    ...base,
    status,
    trust_state: status === 'trust_changed' ? 'trust_changed' : base.trust_state,
    status_message: compact(catalog.status_message)
      || (status === 'online'
        ? 'Gateway catalog is ready.'
        : 'Gateway catalog could not be refreshed.'),
    capabilities: [...new Set(catalog.capabilities ?? [])],
    environments: [...(catalog.environments ?? [])],
  };
}

export function gatewayRecordToSourceWithError(record: GatewayRecord, message: string, code = ''): DesktopGatewaySource {
  const base = gatewayRecordToSource(record);
  if (base.trust_state !== 'paired') {
    return base;
  }
  if (compact(code) === 'GATEWAY_TRUST_CHANGED') {
    return {
      ...base,
      status: 'trust_changed',
      trust_state: 'trust_changed',
      status_message: redactGatewayStatusMessage(message) || 'Gateway identity changed and must be paired again.',
      environments: [],
    };
  }
  return {
    ...base,
    status: 'error',
    status_message: redactGatewayStatusMessage(message),
    environments: [],
  };
}

function redactGatewayStatusMessage(message: string): string {
  const clean = compact(message);
  if (!clean) {
    return 'Gateway catalog could not be refreshed.';
  }
  return clean
    .replace(/token/giu, '[redacted]')
    .replace(/secret/giu, '[redacted]')
    .replace(/password/giu, '[redacted]')
    .replace(/signature/giu, '[redacted]')
    .replace(/private_key/giu, '[redacted]')
    .replace(/proof/giu, '[redacted]')
    .slice(0, 240);
}

export function defaultGatewayDisplayName(connection: GatewayConnection): string {
  return `${desktopGatewayConnectionKindLabel(connection.kind as DesktopGatewayConnectionKind)} Gateway`;
}

export function normalizeGatewayStoreSnapshot(value: unknown, now = Date.now()): GatewayStoreSnapshot {
  const candidate = value && typeof value === 'object' ? value as GatewayStoreFile : {};
  const byID = new Map<string, GatewayRecord>();
  for (const rawRecord of candidate.gateways ?? []) {
    const record = normalizeGatewayRecord(rawRecord, now);
    if (record) {
      byID.set(record.gateway_id, record);
    }
  }
  return {
    schema_version: 1,
    gateways: [...byID.values()].sort((left, right) => (
      left.display_name.toLowerCase().localeCompare(right.display_name.toLowerCase())
      || left.gateway_id.localeCompare(right.gateway_id)
    )),
  };
}

export function defaultGatewayStorePath(stateRoot: string): string {
  return path.join(stateRoot, 'local-environment', 'gateway', 'gateways.json');
}

function replaceGatewayRecord(snapshot: GatewayStoreSnapshot, record: GatewayRecord, now: number): GatewayStoreSnapshot {
  return {
    schema_version: 1,
    gateways: normalizeGatewayStoreSnapshot({
      gateways: [
        ...snapshot.gateways.filter((item) => item.gateway_id !== record.gateway_id),
        record,
      ],
    }, now).gateways,
  };
}

export class GatewayStore {
  private snapshot: GatewayStoreSnapshot | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<GatewayStoreSnapshot> {
    if (this.snapshot) {
      return this.snapshot;
    }
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.snapshot = normalizeGatewayStoreSnapshot(JSON.parse(raw));
      return this.snapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.snapshot = normalizeGatewayStoreSnapshot(null);
        return this.snapshot;
      }
      if (error instanceof SyntaxError) {
        throw new GatewayStoreError('GATEWAY_STORE_INVALID_JSON', 'Gateway store contains invalid JSON.', this.filePath);
      }
      throw error;
    }
  }

  async list(): Promise<readonly GatewayRecord[]> {
    return (await this.load()).gateways;
  }

  async get(gatewayID: string): Promise<GatewayRecord | null> {
    const cleanGatewayID = normalizeGatewayID(gatewayID);
    if (!cleanGatewayID) {
      return null;
    }
    return (await this.load()).gateways.find((record) => record.gateway_id === cleanGatewayID) ?? null;
  }

  async upsert(input: Readonly<{
    gateway_id: string;
    display_name?: string;
    connection: GatewayConnection;
    trust_profile?: GatewayTrustProfile;
    now_ms?: number;
  }>): Promise<GatewayRecord> {
    return this.mutate(async () => {
      const now = timestampMS(input.now_ms, Date.now());
      const gatewayID = normalizeGatewayID(input.gateway_id);
      if (!gatewayID) {
        throw new GatewayStoreError('GATEWAY_ID_REQUIRED', 'Gateway id is required.');
      }
      const snapshot = await this.load();
      const existing = snapshot.gateways.find((record) => record.gateway_id === gatewayID);
      const nextBindingAudience = gatewayBindingAudience(input.connection);
      const connectionIdentityUnchanged = existing ? gatewayBindingAudience(existing.connection) === nextBindingAudience : false;
      const existingTrustProfile = existing?.trust_profile?.binding_audience === nextBindingAudience
        ? existing.trust_profile
        : undefined;
      const record = normalizeGatewayRecord({
        schema_version: 1,
        gateway_id: gatewayID,
        display_name: compact(input.display_name) || existing?.display_name || defaultGatewayDisplayName(input.connection),
        local_enabled: existing?.local_enabled ?? true,
        connection: input.connection,
        trust_profile: input.trust_profile ?? existingTrustProfile,
        created_at_ms: existing?.created_at_ms ?? now,
        updated_at_ms: now,
        last_catalog_sync_at_ms: connectionIdentityUnchanged ? existing?.last_catalog_sync_at_ms : undefined,
      }, now);
      if (!record) {
        throw new GatewayStoreError('GATEWAY_RECORD_INVALID', 'Gateway record is invalid.');
      }
      this.snapshot = replaceGatewayRecord(snapshot, record, now);
      await this.persist();
      return record;
    });
  }

  async updateTrustProfile(gatewayID: string, trustProfile: GatewayTrustProfile | undefined): Promise<GatewayRecord> {
    return this.mutate(async () => {
      const cleanGatewayID = normalizeGatewayID(gatewayID);
      const snapshot = await this.load();
      const existing = snapshot.gateways.find((record) => record.gateway_id === cleanGatewayID);
      if (!existing) {
        throw new GatewayStoreError('GATEWAY_NOT_FOUND', 'Gateway was not found.');
      }
      const now = Date.now();
      const record = normalizeGatewayRecord({
        ...existing,
        trust_profile: trustProfile,
        updated_at_ms: now,
      }, now);
      if (!record) {
        throw new GatewayStoreError('GATEWAY_RECORD_INVALID', 'Gateway record is invalid.');
      }
      this.snapshot = replaceGatewayRecord(snapshot, record, now);
      await this.persist();
      return record;
    });
  }

  async markCatalogSynced(gatewayID: string, syncedAtMS = Date.now()): Promise<GatewayRecord> {
    return this.mutate(async () => {
      const cleanGatewayID = normalizeGatewayID(gatewayID);
      const snapshot = await this.load();
      const existing = snapshot.gateways.find((record) => record.gateway_id === cleanGatewayID);
      if (!existing) {
        throw new GatewayStoreError('GATEWAY_NOT_FOUND', 'Gateway was not found.');
      }
      const now = timestampMS(syncedAtMS, Date.now());
      const record = normalizeGatewayRecord({
        ...existing,
        updated_at_ms: now,
        last_catalog_sync_at_ms: now,
      }, now);
      if (!record) {
        throw new GatewayStoreError('GATEWAY_RECORD_INVALID', 'Gateway record is invalid.');
      }
      this.snapshot = replaceGatewayRecord(snapshot, record, now);
      await this.persist();
      return record;
    });
  }

  async setLocalEnabled(gatewayID: string, enabled: boolean, nowMS = Date.now()): Promise<GatewayRecord> {
    return this.mutate(async () => {
      const cleanGatewayID = normalizeGatewayID(gatewayID);
      const snapshot = await this.load();
      const existing = snapshot.gateways.find((record) => record.gateway_id === cleanGatewayID);
      if (!existing) {
        throw new GatewayStoreError('GATEWAY_NOT_FOUND', 'Gateway was not found.');
      }
      const now = timestampMS(nowMS, Date.now());
      const record = normalizeGatewayRecord({
        ...existing,
        local_enabled: enabled,
        updated_at_ms: now,
      }, now);
      if (!record) {
        throw new GatewayStoreError('GATEWAY_RECORD_INVALID', 'Gateway record is invalid.');
      }
      this.snapshot = replaceGatewayRecord(snapshot, record, now);
      await this.persist();
      return record;
    });
  }

  async delete(gatewayID: string): Promise<GatewayRecord | null> {
    return this.mutate(async () => {
      const cleanGatewayID = normalizeGatewayID(gatewayID);
      const snapshot = await this.load();
      const existing = snapshot.gateways.find((record) => record.gateway_id === cleanGatewayID) ?? null;
      if (!existing) {
        return null;
      }
      this.snapshot = {
        schema_version: 1,
        gateways: snapshot.gateways.filter((record) => record.gateway_id !== cleanGatewayID),
      };
      await this.persist();
      return existing;
    });
  }

  private async persist(): Promise<void> {
    const snapshot = await this.load();
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await fs.writeFile(this.filePath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  }

  private mutate<T>(callback: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release: () => void = () => {};
    this.mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(callback, callback).finally(release);
  }
}
