import { normalizeRuntimeServiceSnapshot, type RuntimeServiceSnapshot } from '../shared/runtimeService';
import type { DesktopRuntimeControlEndpoint } from '../shared/runtimeControl';

export type StartupReport = Readonly<{
  local_ui_url: string;
  local_ui_urls: string[];
  runtime_control?: DesktopRuntimeControlEndpoint;
  password_required?: boolean;
  effective_run_mode?: string;
  remote_enabled?: boolean;
  desktop_managed?: boolean;
  desktop_owner_id?: string;
  controlplane_base_url?: string;
  controlplane_provider_id?: string;
  env_public_id?: string;
  state_dir?: string;
  diagnostics_enabled?: boolean;
  pid?: number;
  runtime_service?: RuntimeServiceSnapshot;
}>;

function parseRuntimeControlEndpoint(value: unknown): DesktopRuntimeControlEndpoint | undefined {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const protocolVersion = String(record.protocol_version ?? '').trim();
  const baseURL = String(record.base_url ?? '').trim();
  const token = String(record.token ?? '').trim();
  const desktopOwnerID = String(record.desktop_owner_id ?? '').trim();
  if (!protocolVersion || !baseURL || !token || !desktopOwnerID) {
    return undefined;
  }
  const expiresAt = Number(record.expires_at_unix_ms);
  return {
    protocol_version: protocolVersion,
    base_url: baseURL,
    token,
    desktop_owner_id: desktopOwnerID,
    ...(Number.isFinite(expiresAt) && expiresAt > 0 ? { expires_at_unix_ms: Math.floor(expiresAt) } : {}),
  };
}

export function parseStartupReport(raw: string): StartupReport {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const localUIURL = String(parsed.local_ui_url ?? '').trim();
  if (!localUIURL) {
    throw new Error('startup report missing local_ui_url');
  }

  const localUIURLs = Array.isArray(parsed.local_ui_urls)
    ? parsed.local_ui_urls.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  const runtimeControl = parseRuntimeControlEndpoint(parsed.runtime_control);

  return {
    local_ui_url: localUIURL,
    local_ui_urls: localUIURLs.length > 0 ? localUIURLs : [localUIURL],
    ...(runtimeControl ? { runtime_control: runtimeControl } : {}),
    password_required: typeof parsed.password_required === 'boolean' ? parsed.password_required : undefined,
    effective_run_mode: String(parsed.effective_run_mode ?? '').trim() || undefined,
    remote_enabled: typeof parsed.remote_enabled === 'boolean' ? parsed.remote_enabled : undefined,
    desktop_managed: typeof parsed.desktop_managed === 'boolean' ? parsed.desktop_managed : undefined,
    desktop_owner_id: String(parsed.desktop_owner_id ?? '').trim() || undefined,
    controlplane_base_url: String(parsed.controlplane_base_url ?? '').trim() || undefined,
    controlplane_provider_id: String(parsed.controlplane_provider_id ?? '').trim() || undefined,
    env_public_id: String(parsed.env_public_id ?? '').trim() || undefined,
    state_dir: String(parsed.state_dir ?? '').trim() || undefined,
    diagnostics_enabled: typeof parsed.diagnostics_enabled === 'boolean' ? parsed.diagnostics_enabled : undefined,
    pid: Number.isInteger(parsed.pid) && Number(parsed.pid) > 0 ? Number(parsed.pid) : undefined,
    ...(parsed.runtime_service ? { runtime_service: normalizeRuntimeServiceSnapshot(parsed.runtime_service, {
      desktopManaged: typeof parsed.desktop_managed === 'boolean' ? parsed.desktop_managed : undefined,
      effectiveRunMode: String(parsed.effective_run_mode ?? '').trim(),
      remoteEnabled: typeof parsed.remote_enabled === 'boolean' ? parsed.remote_enabled : undefined,
    }) } : {}),
  };
}
