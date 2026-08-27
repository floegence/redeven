import type { DesktopRuntimeControlEndpoint } from '../shared/runtimeControl';
import { normalizeDesktopPrivateBridgeToken } from './desktopPrivateBridge';
import {
  normalizeRuntimeServiceSnapshot,
  type RuntimeServiceSnapshot,
} from '../shared/runtimeService';

export const RUNTIME_PLACEMENT_BRIDGE_PROTOCOL_VERSION = 'redeven-desktop-placement-h2/1';
export const RUNTIME_PLACEMENT_BRIDGE_AUTHORITY = 'redeven-placement';
export const RUNTIME_PLACEMENT_BRIDGE_HELLO_PATH = '/redeven/placement/v1/hello';
export const RUNTIME_PLACEMENT_BRIDGE_SHUTDOWN_PATH = '/redeven/placement/v1/actions/shutdown-runtime';
export const RUNTIME_PLACEMENT_BRIDGE_ERROR_CODE_HEADER = 'x-redeven-placement-error-code';
export const RUNTIME_PLACEMENT_BRIDGE_MAX_CONTROL_RESPONSE_BYTES = 1024 * 1024;
export const RUNTIME_PLACEMENT_BRIDGE_MAX_CONCURRENT_STREAMS = 64;
export const RUNTIME_PLACEMENT_BRIDGE_STREAM_WINDOW_BYTES = 256 * 1024;
export const RUNTIME_PLACEMENT_BRIDGE_SESSION_WINDOW_BYTES = 16 * 1024 * 1024;
export const RUNTIME_PLACEMENT_BRIDGE_MAX_SESSION_MEMORY_MB = 32;
export const RUNTIME_PLACEMENT_BRIDGE_MAX_HEADER_PAIRS = 16;
export const RUNTIME_PLACEMENT_BRIDGE_MAX_HEADER_BLOCK_BYTES = 8 * 1024;

export type RuntimePlacementBridgeSurface = 'local_ui' | 'runtime_control' | 'gateway_protocol';

export type RuntimePlacementBridgeHello = Readonly<{
  protocol_version: typeof RUNTIME_PLACEMENT_BRIDGE_PROTOCOL_VERSION;
  runtime_version: string;
  runtime_commit?: string;
  started_at_unix_ms?: number;
  local_ui: Readonly<{
    available: boolean;
    base_path: string;
    bridge_token?: string;
  }>;
  runtime_control: Readonly<{
    available: boolean;
    protocol_version?: string;
    base_url?: string;
    token?: string;
  }>;
  runtime_service?: RuntimeServiceSnapshot;
  gateway_service?: Readonly<{
    state_root: string;
    executable_path: string;
    service_pid: number;
    managed_bridge_token: string;
  }>;
}>;

export type RuntimePlacementBridgeStreamError = Readonly<{
  code: string;
  message: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : undefined;
}

export function runtimePlacementBridgeSurfaceAuthority(surface: RuntimePlacementBridgeSurface): string {
  switch (surface) {
    case 'local_ui':
      return 'local-ui';
    case 'runtime_control':
      return 'runtime-control';
    case 'gateway_protocol':
      return 'gateway-protocol';
  }
}

export function parseRuntimePlacementBridgeHello(payload: Buffer): RuntimePlacementBridgeHello {
  if (payload.length <= 0 || payload.length > RUNTIME_PLACEMENT_BRIDGE_MAX_CONTROL_RESPONSE_BYTES) {
    throw new Error('Runtime Placement Bridge hello length is invalid.');
  }
  const parsed = JSON.parse(payload.toString('utf8')) as Record<string, unknown>;
  const protocolVersion = compact(parsed.protocol_version);
  if (protocolVersion !== RUNTIME_PLACEMENT_BRIDGE_PROTOCOL_VERSION) {
    throw new Error(`Unsupported Runtime Placement Bridge protocol version: ${protocolVersion || '<empty>'}`);
  }
  const localUI = parsed.local_ui && typeof parsed.local_ui === 'object'
    ? parsed.local_ui as Record<string, unknown>
    : {};
  const runtimeControl = parsed.runtime_control && typeof parsed.runtime_control === 'object'
    ? parsed.runtime_control as Record<string, unknown>
    : {};
  const gatewayService = parsed.gateway_service && typeof parsed.gateway_service === 'object'
    ? parsed.gateway_service as Record<string, unknown>
    : null;
  const localUIAvailable = localUI.available === true;
  const localUIBridgeToken = normalizeDesktopPrivateBridgeToken(localUI.bridge_token);
  if (localUIAvailable && localUIBridgeToken === '') {
    throw new Error('Runtime Placement Bridge did not provide valid private Local UI authorization.');
  }
  return {
    protocol_version: RUNTIME_PLACEMENT_BRIDGE_PROTOCOL_VERSION,
    runtime_version: compact(parsed.runtime_version),
    runtime_commit: compact(parsed.runtime_commit) || undefined,
    started_at_unix_ms: normalizePositiveInteger(parsed.started_at_unix_ms),
    local_ui: {
      available: localUIAvailable,
      base_path: compact(localUI.base_path) || '/',
      ...(localUIBridgeToken ? { bridge_token: localUIBridgeToken } : {}),
    },
    runtime_control: {
      available: runtimeControl.available === true,
      protocol_version: compact(runtimeControl.protocol_version) || undefined,
      base_url: compact(runtimeControl.base_url) || undefined,
      token: compact(runtimeControl.token) || undefined,
    },
    ...(parsed.runtime_service
      ? { runtime_service: normalizeRuntimeServiceSnapshot(parsed.runtime_service) }
      : {}),
    ...(gatewayService
      ? {
          gateway_service: {
            state_root: compact(gatewayService.state_root),
            executable_path: compact(gatewayService.executable_path),
            service_pid: normalizePositiveInteger(gatewayService.service_pid) ?? 0,
            managed_bridge_token: compact(gatewayService.managed_bridge_token),
          },
        }
      : {}),
  };
}

export function runtimeControlEndpointFromBridgeHello(
  hello: RuntimePlacementBridgeHello,
  loopbackBaseURL: string,
): DesktopRuntimeControlEndpoint | undefined {
  if (!hello.runtime_control.available) {
    return undefined;
  }
  const protocolVersion = compact(hello.runtime_control.protocol_version);
  const token = compact(hello.runtime_control.token);
  if (protocolVersion === '' || token === '') {
    return undefined;
  }
  return {
    protocol_version: protocolVersion,
    base_url: `${compact(loopbackBaseURL).replace(/\/+$/u, '')}/__redeven_runtime_control/`,
    token,
  };
}

export function runtimePlacementBridgeStreamError(code: unknown): RuntimePlacementBridgeStreamError {
  const normalized = compact(code) || 'BRIDGE_STREAM_ERROR';
  return {
    code: normalized,
    message: `Runtime Placement Bridge stream failed (${normalized}).`,
  };
}
