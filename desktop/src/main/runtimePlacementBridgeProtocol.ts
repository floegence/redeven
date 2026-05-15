import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Readable, Writable } from 'node:stream';

import type { DesktopRuntimeControlEndpoint } from '../shared/runtimeControl';
import {
  normalizeRuntimeServiceSnapshot,
  type RuntimeServiceSnapshot,
} from '../shared/runtimeService';

export const RUNTIME_PLACEMENT_BRIDGE_PROTOCOL_VERSION = 'redeven-desktop-bridge-v1';
export const RUNTIME_PLACEMENT_BRIDGE_MAX_HEADER_BYTES = 1024 * 1024;
export const RUNTIME_PLACEMENT_BRIDGE_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;

export type RuntimePlacementBridgeFrameType =
  | 'hello'
  | 'stream_open'
  | 'stream_data'
  | 'stream_close'
  | 'stream_error'
  | 'shutdown_runtime'
  | 'ping'
  | 'pong';

export type RuntimePlacementBridgeFrameHeader = Readonly<{
  protocol_version: typeof RUNTIME_PLACEMENT_BRIDGE_PROTOCOL_VERSION;
  stream_id: string;
  type: RuntimePlacementBridgeFrameType;
  payload_bytes?: number;
}>;

export type RuntimePlacementBridgeFrame = Readonly<{
  header: RuntimePlacementBridgeFrameHeader;
  payload: Buffer;
}>;

export type RuntimePlacementBridgeSurface = 'local_ui' | 'runtime_control';

export type RuntimePlacementBridgeHello = Readonly<{
  protocol_version: typeof RUNTIME_PLACEMENT_BRIDGE_PROTOCOL_VERSION;
  runtime_version: string;
  runtime_commit?: string;
  local_ui: Readonly<{
    available: boolean;
    base_path: string;
  }>;
  runtime_control: Readonly<{
    available: boolean;
    protocol_version?: string;
    base_url?: string;
    token?: string;
    desktop_owner_id?: string;
  }>;
  runtime_service?: RuntimeServiceSnapshot;
}>;

export type RuntimePlacementBridgeStreamError = Readonly<{
  code: string;
  message: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeFrameType(value: unknown): RuntimePlacementBridgeFrameType {
  const clean = compact(value) as RuntimePlacementBridgeFrameType;
  switch (clean) {
    case 'hello':
    case 'stream_open':
    case 'stream_data':
    case 'stream_close':
    case 'stream_error':
    case 'shutdown_runtime':
    case 'ping':
    case 'pong':
      return clean;
    default:
      throw new Error(`Unsupported Runtime Placement Bridge frame type: ${clean || '<empty>'}`);
  }
}

function normalizeFrameHeader(value: unknown, payloadBytes: number): RuntimePlacementBridgeFrameHeader {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const protocolVersion = compact(record.protocol_version);
  if (protocolVersion !== RUNTIME_PLACEMENT_BRIDGE_PROTOCOL_VERSION) {
    throw new Error(`Unsupported Runtime Placement Bridge protocol version: ${protocolVersion || '<empty>'}`);
  }
  if (payloadBytes < 0 || payloadBytes > RUNTIME_PLACEMENT_BRIDGE_MAX_PAYLOAD_BYTES) {
    throw new Error('Runtime Placement Bridge payload length is invalid.');
  }
  const headerPayloadBytes = Number(record.payload_bytes ?? payloadBytes);
  if (!Number.isInteger(headerPayloadBytes) || headerPayloadBytes !== payloadBytes) {
    throw new Error('Runtime Placement Bridge payload length does not match the frame header.');
  }
  return {
    protocol_version: RUNTIME_PLACEMENT_BRIDGE_PROTOCOL_VERSION,
    stream_id: compact(record.stream_id),
    type: normalizeFrameType(record.type),
    payload_bytes: payloadBytes,
  };
}

function readUint32BE(buffer: Buffer, offset: number): number {
  return buffer.readUInt32BE(offset);
}

function writeUint32BE(buffer: Buffer, value: number, offset: number): void {
  buffer.writeUInt32BE(value >>> 0, offset);
}

async function readExactly(stream: Readable, length: number): Promise<Buffer | null> {
  if (length === 0) {
    return Buffer.alloc(0);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  while (total < length) {
    const chunk = stream.read(length - total) as Buffer | string | null;
    if (chunk != null) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      total += buffer.length;
      continue;
    }
    const state = stream as Readable & Readonly<{ readableEnded?: boolean; destroyed?: boolean }>;
    if (state.readableEnded || state.destroyed) {
      return null;
    }
    const event = await Promise.race([
      once(stream, 'readable').then(() => 'readable' as const),
      once(stream, 'end').then(() => 'end' as const),
      once(stream, 'close').then(() => 'close' as const),
      once(stream, 'error').then(([error]) => {
        throw error instanceof Error ? error : new Error(String(error));
      }),
    ]);
    if (event !== 'readable') {
      return null;
    }
  }
  return Buffer.concat(chunks, total);
}

export async function readRuntimePlacementBridgeFrame(
  stream: Readable,
): Promise<RuntimePlacementBridgeFrame | null> {
  const prefix = await readExactly(stream, 8);
  if (!prefix) {
    return null;
  }
  const headerLength = readUint32BE(prefix, 0);
  const payloadLength = readUint32BE(prefix, 4);
  if (headerLength <= 0 || headerLength > RUNTIME_PLACEMENT_BRIDGE_MAX_HEADER_BYTES) {
    throw new Error('Runtime Placement Bridge frame header length is invalid.');
  }
  if (payloadLength > RUNTIME_PLACEMENT_BRIDGE_MAX_PAYLOAD_BYTES) {
    throw new Error('Runtime Placement Bridge frame payload is too large.');
  }
  const headerBytes = await readExactly(stream, headerLength);
  const payload = await readExactly(stream, payloadLength);
  if (!headerBytes || payload == null) {
    return null;
  }
  const parsed = JSON.parse(headerBytes.toString('utf8')) as unknown;
  return {
    header: normalizeFrameHeader(parsed, payloadLength),
    payload,
  };
}

export function encodeRuntimePlacementBridgeFrame(
  input: Readonly<{
    type: RuntimePlacementBridgeFrameType;
    stream_id?: string;
    payload?: Buffer | string | object | null;
  }>,
): Buffer {
  const payload = (() => {
    if (input.payload == null) {
      return Buffer.alloc(0);
    }
    if (Buffer.isBuffer(input.payload)) {
      return input.payload;
    }
    if (typeof input.payload === 'string') {
      return Buffer.from(input.payload);
    }
    return Buffer.from(JSON.stringify(input.payload));
  })();
  if (payload.length > RUNTIME_PLACEMENT_BRIDGE_MAX_PAYLOAD_BYTES) {
    throw new Error('Runtime Placement Bridge payload is too large.');
  }
  const header: RuntimePlacementBridgeFrameHeader = {
    protocol_version: RUNTIME_PLACEMENT_BRIDGE_PROTOCOL_VERSION,
    stream_id: compact(input.stream_id),
    type: input.type,
    payload_bytes: payload.length,
  };
  const headerBytes = Buffer.from(JSON.stringify(header));
  if (headerBytes.length > RUNTIME_PLACEMENT_BRIDGE_MAX_HEADER_BYTES) {
    throw new Error('Runtime Placement Bridge header is too large.');
  }
  const prefix = Buffer.alloc(8);
  writeUint32BE(prefix, headerBytes.length, 0);
  writeUint32BE(prefix, payload.length, 4);
  return Buffer.concat([prefix, headerBytes, payload]);
}

export async function writeRuntimePlacementBridgeFrame(
  stream: Writable,
  frame: Readonly<{
    type: RuntimePlacementBridgeFrameType;
    stream_id?: string;
    payload?: Buffer | string | object | null;
  }>,
): Promise<void> {
  const encoded = encodeRuntimePlacementBridgeFrame(frame);
  if (stream.write(encoded)) {
    return;
  }
  await once(stream, 'drain');
}

export function runtimePlacementBridgeStreamID(prefix = 'stream'): string {
  return `${prefix}-${randomUUID()}`;
}

export function parseRuntimePlacementBridgeHello(payload: Buffer): RuntimePlacementBridgeHello {
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
  return {
    protocol_version: RUNTIME_PLACEMENT_BRIDGE_PROTOCOL_VERSION,
    runtime_version: compact(parsed.runtime_version),
    runtime_commit: compact(parsed.runtime_commit) || undefined,
    local_ui: {
      available: localUI.available === true,
      base_path: compact(localUI.base_path) || '/',
    },
    runtime_control: {
      available: runtimeControl.available === true,
      protocol_version: compact(runtimeControl.protocol_version) || undefined,
      base_url: compact(runtimeControl.base_url) || undefined,
      token: compact(runtimeControl.token) || undefined,
      desktop_owner_id: compact(runtimeControl.desktop_owner_id) || undefined,
    },
    ...(parsed.runtime_service
      ? { runtime_service: normalizeRuntimeServiceSnapshot(parsed.runtime_service) }
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
  const desktopOwnerID = compact(hello.runtime_control.desktop_owner_id);
  if (protocolVersion === '' || token === '' || desktopOwnerID === '') {
    return undefined;
  }
  return {
    protocol_version: protocolVersion,
    base_url: `${compact(loopbackBaseURL).replace(/\/+$/u, '')}/__redeven_runtime_control/`,
    token,
    desktop_owner_id: desktopOwnerID,
  };
}

export function parseRuntimePlacementBridgeStreamError(payload: Buffer): RuntimePlacementBridgeStreamError {
  try {
    const record = JSON.parse(payload.toString('utf8')) as Record<string, unknown>;
    return {
      code: compact(record.code) || 'BRIDGE_STREAM_ERROR',
      message: compact(record.message) || 'Runtime Placement Bridge stream failed.',
    };
  } catch {
    return {
      code: 'BRIDGE_STREAM_ERROR',
      message: payload.toString('utf8').trim() || 'Runtime Placement Bridge stream failed.',
    };
  }
}
