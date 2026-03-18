export type StartupReport = Readonly<{
  local_ui_url: string;
  local_ui_urls: string[];
  effective_run_mode?: string;
  remote_enabled?: boolean;
  desktop_managed?: boolean;
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
    effective_run_mode: String(parsed.effective_run_mode ?? '').trim() || undefined,
    remote_enabled: typeof parsed.remote_enabled === 'boolean' ? parsed.remote_enabled : undefined,
    desktop_managed: typeof parsed.desktop_managed === 'boolean' ? parsed.desktop_managed : undefined,
  };
}
