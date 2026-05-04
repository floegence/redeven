import { normalizeRuntimeServiceSnapshot, type RuntimeServiceSnapshot } from '../shared/runtimeService';

export type StartupReport = Readonly<{
  local_ui_url: string;
  local_ui_urls: string[];
  password_required?: boolean;
  effective_run_mode?: string;
  remote_enabled?: boolean;
  desktop_managed?: boolean;
  controlplane_base_url?: string;
  controlplane_provider_id?: string;
  env_public_id?: string;
  state_dir?: string;
  diagnostics_enabled?: boolean;
  pid?: number;
  runtime_service?: RuntimeServiceSnapshot;
}>;

export function parseStartupReport(raw: string): StartupReport {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const localUIURL = String(parsed.local_ui_url ?? '').trim();
  if (!localUIURL) {
    throw new Error('startup report missing local_ui_url');
  }

  const localUIURLs = Array.isArray(parsed.local_ui_urls)
    ? parsed.local_ui_urls.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];

  return {
    local_ui_url: localUIURL,
    local_ui_urls: localUIURLs.length > 0 ? localUIURLs : [localUIURL],
    password_required: typeof parsed.password_required === 'boolean' ? parsed.password_required : undefined,
    effective_run_mode: String(parsed.effective_run_mode ?? '').trim() || undefined,
    remote_enabled: typeof parsed.remote_enabled === 'boolean' ? parsed.remote_enabled : undefined,
    desktop_managed: typeof parsed.desktop_managed === 'boolean' ? parsed.desktop_managed : undefined,
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
