export const DESKTOP_CODE_WORKSPACE_PREPARE_CHANNEL = 'redeven-desktop:code-workspace-prepare';
export const DESKTOP_CODE_WORKSPACE_PACKAGE_PREPARE_CHANNEL = 'redeven-desktop:code-workspace-package-prepare';
export const DESKTOP_CODE_WORKSPACE_PACKAGE_CHUNK_CHANNEL = 'redeven-desktop:code-workspace-package-chunk';
export const DESKTOP_CODE_WORKSPACE_PACKAGE_DISPOSE_CHANNEL = 'redeven-desktop:code-workspace-package-dispose';

export type DesktopCodeWorkspacePrepareRequest = Readonly<{
  reason?: 'open' | 'start' | 'settings' | 'retry';
  prefer_session_upload?: boolean;
}>;

export type DesktopCodeWorkspacePrepareResponse = Readonly<{
  ok: boolean;
  prepared: boolean;
  message?: string;
  status?: unknown;
}>;

export type DesktopCodeWorkspacePlatform = Readonly<{
  os: 'linux' | 'darwin';
  arch: 'amd64' | 'arm64';
  libc?: 'glibc' | 'unknown';
  platform_id: string;
}>;

export type DesktopCodeWorkspacePackagePrepareRequest = Readonly<{
  platform: DesktopCodeWorkspacePlatform;
}>;

export type DesktopCodeWorkspacePackageJob = Readonly<{
  job_id: string;
  manifest: unknown;
  archive_size_bytes: number;
  chunk_size_bytes: number;
  from_cache: boolean;
}>;

export type DesktopCodeWorkspacePackagePrepareResponse = Readonly<{
  ok: boolean;
  job?: DesktopCodeWorkspacePackageJob;
  message?: string;
}>;

export type DesktopCodeWorkspacePackageChunkRequest = Readonly<{
  job_id: string;
  offset_bytes: number;
  length_bytes: number;
}>;

export type DesktopCodeWorkspacePackageChunkResponse = Readonly<{
  ok: boolean;
  chunk?: Uint8Array<ArrayBuffer>;
  offset_bytes?: number;
  length_bytes?: number;
  done?: boolean;
  message?: string;
}>;

export type DesktopCodeWorkspacePackageDisposeRequest = Readonly<{
  job_id: string;
}>;

export type DesktopCodeWorkspacePackageDisposeResponse = Readonly<{
  ok: boolean;
  message?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  return Math.floor(numeric);
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return undefined;
  }
  return Math.floor(numeric);
}

function normalizeJobID(value: unknown): string {
  const jobID = compact(value);
  return jobID.length > 0 && jobID.length <= 160 ? jobID : '';
}

function normalizeDesktopCodeWorkspacePlatform(value: unknown): DesktopCodeWorkspacePlatform | null {
  const record = value && typeof value === 'object' ? value as Partial<DesktopCodeWorkspacePlatform> : {};
  const osName = compact(record.os);
  const arch = compact(record.arch);
  const libc = compact(record.libc);
  const platformID = compact(record.platform_id);
  if (osName !== 'linux' && osName !== 'darwin') {
    return null;
  }
  if (arch !== 'amd64' && arch !== 'arm64') {
    return null;
  }
  if (osName === 'linux' && libc !== '' && libc !== 'glibc' && libc !== 'unknown') {
    return null;
  }
  const normalizedLibc = libc === 'unknown' ? 'unknown' : libc === 'glibc' ? 'glibc' : '';
  return {
    os: osName,
    arch,
    ...(osName === 'linux' && normalizedLibc ? { libc: normalizedLibc } : {}),
    platform_id: platformID || (osName === 'linux' ? `${osName}-${arch}-${normalizedLibc || 'glibc'}` : `${osName}-${arch}`),
  };
}

export function normalizeDesktopCodeWorkspacePrepareRequest(value: unknown): DesktopCodeWorkspacePrepareRequest {
  const record = value && typeof value === 'object' ? value as Partial<DesktopCodeWorkspacePrepareRequest> : {};
  const reason = compact(record.reason);
  const preferSessionUpload = record.prefer_session_upload === true;
  switch (reason) {
    case 'open':
    case 'start':
    case 'settings':
    case 'retry':
      return { reason, ...(preferSessionUpload ? { prefer_session_upload: true } : {}) };
    default:
      return preferSessionUpload ? { prefer_session_upload: true } : {};
  }
}

export function normalizeDesktopCodeWorkspacePrepareResponse(value: unknown): DesktopCodeWorkspacePrepareResponse {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      prepared: false,
      message: 'Desktop could not prepare the workspace.',
    };
  }
  const record = value as Partial<DesktopCodeWorkspacePrepareResponse>;
  return {
    ok: record.ok === true,
    prepared: record.prepared === true,
    message: compact(record.message) || undefined,
    status: record.status,
  };
}

export function normalizeDesktopCodeWorkspacePackagePrepareRequest(value: unknown): DesktopCodeWorkspacePackagePrepareRequest | null {
  const record = value && typeof value === 'object' ? value as Partial<DesktopCodeWorkspacePackagePrepareRequest> : {};
  const platform = normalizeDesktopCodeWorkspacePlatform(record.platform);
  return platform ? { platform } : null;
}

export function normalizeDesktopCodeWorkspacePackagePrepareResponse(value: unknown): DesktopCodeWorkspacePackagePrepareResponse {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      message: 'Desktop could not prepare the workspace package.',
    };
  }
  const record = value as Partial<DesktopCodeWorkspacePackagePrepareResponse>;
  const job = normalizeDesktopCodeWorkspacePackageJob(record.job);
  return {
    ok: record.ok === true,
    ...(job ? { job } : {}),
    message: compact(record.message) || undefined,
  };
}

export function normalizeDesktopCodeWorkspacePackageChunkRequest(value: unknown): DesktopCodeWorkspacePackageChunkRequest | null {
  const record = value && typeof value === 'object' ? value as Partial<DesktopCodeWorkspacePackageChunkRequest> : {};
  const jobID = normalizeJobID(record.job_id);
  const offsetBytes = normalizeNonNegativeInteger(record.offset_bytes);
  const lengthBytes = normalizePositiveInteger(record.length_bytes);
  if (!jobID || offsetBytes === undefined || lengthBytes === undefined) {
    return null;
  }
  return {
    job_id: jobID,
    offset_bytes: offsetBytes,
    length_bytes: lengthBytes,
  };
}

export function normalizeDesktopCodeWorkspacePackageChunkResponse(value: unknown): DesktopCodeWorkspacePackageChunkResponse {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      message: 'Desktop could not read the workspace package.',
    };
  }
  const record = value as Partial<DesktopCodeWorkspacePackageChunkResponse>;
  const chunk = normalizeChunk(record.chunk);
  const offsetBytes = normalizeNonNegativeInteger(record.offset_bytes);
  const lengthBytes = normalizePositiveInteger(record.length_bytes);
  return {
    ok: record.ok === true,
    ...(chunk ? { chunk } : {}),
    ...(offsetBytes !== undefined ? { offset_bytes: offsetBytes } : {}),
    ...(lengthBytes !== undefined ? { length_bytes: lengthBytes } : {}),
    done: record.done === true,
    message: compact(record.message) || undefined,
  };
}

export function normalizeDesktopCodeWorkspacePackageDisposeRequest(value: unknown): DesktopCodeWorkspacePackageDisposeRequest | null {
  const record = value && typeof value === 'object' ? value as Partial<DesktopCodeWorkspacePackageDisposeRequest> : {};
  const jobID = normalizeJobID(record.job_id);
  return jobID ? { job_id: jobID } : null;
}

export function normalizeDesktopCodeWorkspacePackageDisposeResponse(value: unknown): DesktopCodeWorkspacePackageDisposeResponse {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      message: 'Desktop could not release the workspace package.',
    };
  }
  const record = value as Partial<DesktopCodeWorkspacePackageDisposeResponse>;
  return {
    ok: record.ok === true,
    message: compact(record.message) || undefined,
  };
}

function normalizeDesktopCodeWorkspacePackageJob(value: unknown): DesktopCodeWorkspacePackageJob | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Partial<DesktopCodeWorkspacePackageJob>;
  const jobID = normalizeJobID(record.job_id);
  const archiveSizeBytes = normalizePositiveInteger(record.archive_size_bytes);
  const chunkSizeBytes = normalizePositiveInteger(record.chunk_size_bytes);
  if (!jobID || archiveSizeBytes === undefined || chunkSizeBytes === undefined || !record.manifest) {
    return undefined;
  }
  return {
    job_id: jobID,
    manifest: record.manifest,
    archive_size_bytes: archiveSizeBytes,
    chunk_size_bytes: chunkSizeBytes,
    from_cache: record.from_cache === true,
  };
}

function normalizeChunk(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (value instanceof Uint8Array && value.buffer instanceof ArrayBuffer) {
    return value as Uint8Array<ArrayBuffer>;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    if (!(view.buffer instanceof ArrayBuffer)) {
      return null;
    }
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  return null;
}
