import {
  normalizeDesktopLocalUIPasswordMode,
  type DesktopSettingsDraft,
} from './settingsIPC';
import type {
  DesktopAccessMode,
  DesktopAccessModeOption,
  DesktopSettingsSummaryItem,
} from './desktopSettingsSurface';

export const DEFAULT_DESKTOP_FIXED_PORT = 23998;
export const DEFAULT_DESKTOP_FIXED_PORT_TEXT = String(DEFAULT_DESKTOP_FIXED_PORT);
export const DEFAULT_DESKTOP_LOCAL_UI_BIND = `localhost:${DEFAULT_DESKTOP_FIXED_PORT_TEXT}`;
export const DEFAULT_DESKTOP_SHARED_LOCAL_UI_BIND = `0.0.0.0:${DEFAULT_DESKTOP_FIXED_PORT_TEXT}`;
export const DEFAULT_DESKTOP_AUTO_LOOPBACK_BIND = '127.0.0.1:0';

export const DESKTOP_ACCESS_MODE_OPTIONS: readonly DesktopAccessModeOption[] = [
  {
    value: 'local_only',
    label: 'Local only',
    description: 'Keep the Local Environment available only on this machine.',
  },
  {
    value: 'shared_local_network',
    label: 'Shared on your local network',
    description: 'Expose the Local Environment on your LAN with a fixed port and password.',
  },
  {
    value: 'custom_exposure',
    label: 'Custom exposure',
    description: 'Edit the bind host, port, and password directly.',
  },
] as const;

export type DesktopAccessPortMode = 'fixed' | 'auto';

export type DesktopAccessDraftModel = Readonly<{
  access_mode: DesktopAccessMode;
  bind_host: string;
  bind_port_text: string;
  fixed_port_value: string;
  port_mode: DesktopAccessPortMode;
  next_start_address_display: string;
  next_start_address_detail: string;
  password_required: boolean;
  password_configured: boolean;
  password_state_label: string;
  password_state_tone: 'default' | 'warning' | 'success';
  current_runtime_url: string;
}>;

export type DesktopAccessModelOptions = Readonly<{
  current_runtime_url?: string;
  local_ui_password_configured?: boolean;
  runtime_password_required?: boolean;
  mode_override?: DesktopAccessMode | null;
}>;

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function splitHostPortLoose(raw: string): Readonly<{ host: string; port: string }> | null {
  const value = trimString(raw);
  if (value === '') {
    return null;
  }
  if (value.startsWith('[')) {
    const closingBracket = value.indexOf(']');
    if (closingBracket <= 1 || closingBracket === value.length - 1 || value[closingBracket + 1] !== ':') {
      return null;
    }
    return {
      host: value.slice(1, closingBracket).trim(),
      port: value.slice(closingBracket + 2).trim(),
    };
  }
  const separator = value.lastIndexOf(':');
  if (separator <= 0 || separator === value.length - 1) {
    return null;
  }
  return {
    host: value.slice(0, separator).trim(),
    port: value.slice(separator + 1).trim(),
  };
}

function formatHostPort(host: string, port: string): string {
  const cleanHost = trimString(host);
  const cleanPort = trimString(port);
  if (cleanHost === '' || cleanPort === '') {
    return trimString(`${cleanHost}${cleanPort}`);
  }
  if (cleanHost.includes(':') && !cleanHost.startsWith('[')) {
    return `[${cleanHost}]:${cleanPort}`;
  }
  return `${cleanHost}:${cleanPort}`;
}

export function isLoopbackHost(host: string): boolean {
  const clean = trimString(host).toLowerCase();
  return clean === 'localhost' || clean === '::1' || clean === '127.0.0.1' || clean.startsWith('127.');
}

export function isWildcardHost(host: string): boolean {
  const clean = trimString(host).toLowerCase();
  return clean === '0.0.0.0' || clean === '::';
}

function localUIPasswordMode(
  draft: DesktopSettingsDraft,
  localUIPasswordConfigured: boolean,
) {
  return normalizeDesktopLocalUIPasswordMode(
    draft.local_ui_password_mode,
    localUIPasswordConfigured ? 'keep' : 'replace',
  );
}

function effectiveLocalUIPasswordConfigured(
  draft: DesktopSettingsDraft,
  localUIPasswordConfigured: boolean,
): boolean {
  switch (localUIPasswordMode(draft, localUIPasswordConfigured)) {
    case 'keep':
      return localUIPasswordConfigured;
    case 'clear':
      return false;
    default:
      return trimString(draft.local_ui_password) !== '';
  }
}

export function desktopAccessModeLabel(mode: DesktopAccessMode): string {
  return DESKTOP_ACCESS_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? 'Custom exposure';
}

export function desktopAccessModeForDraft(
  draft: DesktopSettingsDraft,
  options: DesktopAccessModelOptions = {},
): DesktopAccessMode {
  const bind = splitHostPortLoose(trimString(draft.local_ui_bind) || DEFAULT_DESKTOP_LOCAL_UI_BIND);
  const hasPassword = effectiveLocalUIPasswordConfigured(
    draft,
    options.local_ui_password_configured === true,
  );
  if (bind && isLoopbackHost(bind.host) && !hasPassword) {
    return 'local_only';
  }
  if (bind && isWildcardHost(bind.host)) {
    return 'shared_local_network';
  }
  return 'custom_exposure';
}

function fixedPortValue(portText: string): string {
  const clean = trimString(portText);
  if (clean === '' || clean === '0') {
    return DEFAULT_DESKTOP_FIXED_PORT_TEXT;
  }
  return clean;
}

function nextStartAddressDisplay(
  accessMode: DesktopAccessMode,
  host: string,
  portMode: DesktopAccessPortMode,
  fixedPort: string,
  bindRaw: string,
): Readonly<{ value: string; detail: string }> {
  if (accessMode === 'local_only') {
    if (portMode === 'auto') {
      return {
        value: 'Auto-select on localhost',
        detail: 'Desktop will show the actual localhost port after the next successful start.',
      };
    }
    return {
      value: `localhost:${fixedPort}`,
      detail: 'Only this machine can open the Local Environment.',
    };
  }
  if (accessMode === 'shared_local_network') {
    return {
      value: `Your device IP:${fixedPort}`,
      detail: 'Other devices on your local network can open the Local Environment.',
    };
  }
  return {
    value: bindRaw || formatHostPort(host, fixedPort),
    detail: isLoopbackHost(host) ? 'Custom loopback bind.' : 'Custom bind and password rules.',
  };
}

function passwordState(
  accessMode: DesktopAccessMode,
  bindHost: string,
  draft: DesktopSettingsDraft,
  options: DesktopAccessModelOptions = {},
): Readonly<{
  label: string;
  tone: 'default' | 'warning' | 'success';
  required: boolean;
  configured: boolean;
}> {
  const storedPasswordConfigured = options.local_ui_password_configured === true;
  const passwordRequired = !isLoopbackHost(bindHost);
  const passwordMode = localUIPasswordMode(draft, storedPasswordConfigured);
  const typedPassword = trimString(draft.local_ui_password) !== '';
  const hasEffectivePassword = effectiveLocalUIPasswordConfigured(draft, storedPasswordConfigured);
  if (accessMode === 'local_only') {
    return {
      label: 'No password required',
      tone: 'default',
      required: false,
      configured: false,
    };
  }
  if (passwordMode === 'clear') {
    return {
      label: 'Password will be removed on save',
      tone: 'warning',
      required: passwordRequired,
      configured: false,
    };
  }
  if (passwordMode === 'replace' && typedPassword) {
    return {
      label: storedPasswordConfigured ? 'Password will be replaced on save' : 'Password will be configured on save',
      tone: 'success',
      required: passwordRequired,
      configured: true,
    };
  }
  if (hasEffectivePassword) {
    return {
      label: 'Password configured',
      tone: 'success',
      required: passwordRequired,
      configured: true,
    };
  }
  if (passwordRequired) {
    return {
      label: 'Password required before the next open of Local Environment',
      tone: 'warning',
      required: true,
      configured: false,
    };
  }
  return {
    label: 'Password optional',
    tone: 'default',
    required: false,
    configured: false,
  };
}

export function deriveDesktopAccessDraftModel(
  draft: DesktopSettingsDraft,
  options: DesktopAccessModelOptions = {},
): DesktopAccessDraftModel {
  const bindRaw = trimString(draft.local_ui_bind) || DEFAULT_DESKTOP_LOCAL_UI_BIND;
  const bind = splitHostPortLoose(bindRaw);
  const bindHost = trimString(bind?.host) || 'localhost';
  const bindPortText = trimString(bind?.port);
  const accessMode = options.mode_override ?? desktopAccessModeForDraft(draft, options);
  const portMode: DesktopAccessPortMode = accessMode === 'local_only' && bindPortText === '0' ? 'auto' : 'fixed';
  const fixedPort = fixedPortValue(bindPortText);
  const addressDisplay = nextStartAddressDisplay(accessMode, bindHost, portMode, fixedPort, bindRaw);
  const password = passwordState(accessMode, bindHost, draft, options);

  return {
    access_mode: accessMode,
    bind_host: bindHost,
    bind_port_text: bindPortText,
    fixed_port_value: fixedPort,
    port_mode: portMode,
    next_start_address_display: addressDisplay.value,
    next_start_address_detail: addressDisplay.detail,
    password_required: password.required,
    password_configured: password.configured,
    password_state_label: password.label,
    password_state_tone: password.tone,
    current_runtime_url: trimString(options.current_runtime_url),
  };
}

export function buildDesktopAccessSummaryItems(
  model: DesktopAccessDraftModel,
): readonly DesktopSettingsSummaryItem[] {
  return [
    {
      id: 'visibility',
      label: 'Visibility',
      value: desktopAccessModeLabel(model.access_mode),
      detail: DESKTOP_ACCESS_MODE_OPTIONS.find((option) => option.value === model.access_mode)?.description,
      tone: 'default',
    },
    {
      id: 'next_start_address',
      label: 'Next start address',
      value: model.next_start_address_display,
      detail: model.next_start_address_detail,
      tone: 'default',
    },
    {
      id: 'password_state',
      label: 'Password',
      value: model.password_state_label,
      tone: model.password_state_tone,
    },
  ] as const;
}

export function buildDesktopSettingsSummaryItems(
  draft: DesktopSettingsDraft,
  options: DesktopAccessModelOptions = {},
): readonly DesktopSettingsSummaryItem[] {
  return buildDesktopAccessSummaryItems(deriveDesktopAccessDraftModel(draft, options));
}

function nextFixedPortForDraft(draft: DesktopSettingsDraft): string {
  const model = deriveDesktopAccessDraftModel(draft);
  return fixedPortValue(model.fixed_port_value);
}

export function applyDesktopAccessModeToDraft(
  draft: DesktopSettingsDraft,
  mode: DesktopAccessMode,
): DesktopSettingsDraft {
  if (mode === 'custom_exposure') {
    return draft;
  }
  if (mode === 'local_only') {
    const model = deriveDesktopAccessDraftModel(draft);
    if (model.access_mode === 'local_only' && model.port_mode === 'auto') {
      return {
        ...draft,
        local_ui_bind: DEFAULT_DESKTOP_AUTO_LOOPBACK_BIND,
        local_ui_password: '',
      };
    }
    return {
      ...draft,
      local_ui_bind: formatHostPort('localhost', nextFixedPortForDraft(draft)),
      local_ui_password: '',
    };
  }
  return {
    ...draft,
    local_ui_bind: formatHostPort('0.0.0.0', nextFixedPortForDraft(draft)),
  };
}

export function applyDesktopAccessFixedPortToDraft(
  draft: DesktopSettingsDraft,
  portText: string,
): DesktopSettingsDraft {
  const model = deriveDesktopAccessDraftModel(draft);
  const nextPort = trimString(portText);
  const nextHost = model.access_mode === 'shared_local_network' ? '0.0.0.0' : 'localhost';
  return {
    ...draft,
    local_ui_bind: formatHostPort(nextHost, nextPort),
  };
}

export function applyDesktopAccessAutoPortToDraft(
  draft: DesktopSettingsDraft,
  enabled: boolean,
): DesktopSettingsDraft {
  if (enabled) {
    return {
      ...draft,
      local_ui_bind: DEFAULT_DESKTOP_AUTO_LOOPBACK_BIND,
      local_ui_password: '',
    };
  }
  return {
    ...draft,
    local_ui_bind: formatHostPort('localhost', nextFixedPortForDraft(draft)),
    local_ui_password: '',
  };
}
