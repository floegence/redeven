import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { StartupReport } from './startup';

const TRACE_HEADER = 'X-Redeven-Debug-Trace-ID';
const ENABLED_HEADER = 'X-Redeven-Debug-Console-Enabled';
const DEFAULT_MAX_BYTES = 4 << 20;
const DEFAULT_MAX_BACKUPS = 3;

type DiagnosticsEvent = Readonly<{
  created_at: string;
  source?: string;
  scope: string;
  kind: string;
  trace_id?: string;
  method?: string;
  path?: string;
  status_code?: number;
  duration_ms?: number;
  slow?: boolean;
  message?: string;
  detail?: Record<string, unknown>;
}>;

type DiagnosticsHeaders = Record<string, string | string[]>;

type InFlightRequest = Readonly<{
  method: string;
  path: string;
  traceID: string;
  startedAtMs: number;
}>;

export type DesktopLifecycleDetail = Record<string, unknown>;

export type DesktopRequestStart = Readonly<{
  requestID: number;
  method: string;
  url: string;
  requestHeaders?: DiagnosticsHeaders | null;
}>;

export type DesktopRequestComplete = Readonly<{
  requestID: number;
  url: string;
  statusCode?: number;
  responseHeaders?: DiagnosticsHeaders | null;
  fromCache?: boolean;
}>;

export type DesktopRequestFailure = Readonly<{
  requestID: number;
  url: string;
  error: string;
}>;

function normalizeURLPath(rawURL: string): string {
  try {
    return new URL(rawURL).pathname || '/';
  } catch {
    return '';
  }
}

function normalizeOrigin(rawURL: string): string {
  try {
    return new URL(rawURL).origin;
  } catch {
    return '';
  }
}

function isDiagnosticsAPIPath(path: string): boolean {
  return path.startsWith('/_redeven_proxy/api/debug/diagnostics');
}

function isTrackedRPCPath(path: string): boolean {
  const cleanPath = String(path ?? '').trim();
  if (!cleanPath) {
    return false;
  }
  if (cleanPath.startsWith('/_redeven_proxy/api/')) {
    return !isDiagnosticsAPIPath(cleanPath);
  }
  return cleanPath.startsWith('/api/local/');
}

function shouldTrackRequest(rawURL: string, allowedOrigin: string): boolean {
  if (normalizeOrigin(rawURL) !== allowedOrigin) {
    return false;
  }
  const path = normalizeURLPath(rawURL);
  // Only capture operator-meaningful API/RPC traffic.
  // Static assets, document loads, and other shell resources stay out of the debug console.
  return isTrackedRPCPath(path);
}

function headerValue(headers: DiagnosticsHeaders | null | undefined, name: string): string {
  if (!headers) {
    return '';
  }
  const expected = String(name ?? '').trim().toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key ?? '').trim().toLowerCase() !== expected) {
      continue;
    }
    if (Array.isArray(value)) {
      const joined = value.map((item) => String(item ?? '').trim()).filter(Boolean).join(', ');
      return joined.trim();
    }
    return String(value ?? '').trim();
  }
  return '';
}

function parseEnabledHeader(headers: DiagnosticsHeaders | null | undefined): boolean | null {
  const raw = headerValue(headers, ENABLED_HEADER).toLowerCase();
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  return null;
}

function cloneHeaders(headers: DiagnosticsHeaders | null | undefined): DiagnosticsHeaders {
  if (!headers) {
    return {};
  }
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? [...value] : String(value ?? '')]));
}

function sanitizeText(value: unknown, max = 240): string {
  const text = String(value ?? '').trim().replace(/\r/g, ' ').replace(/\n/g, ' ');
  if (!max || text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}

function isSensitiveKey(key: string): boolean {
  const lowered = String(key ?? '').trim().toLowerCase();
  if (!lowered) {
    return false;
  }
  return ['token', 'secret', 'password', 'authorization', 'cookie', 'api_key', 'apikey', 'psk'].some((fragment) => lowered.includes(fragment));
}

function sanitizeDetailValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDetailValue(item));
  }
  if (value && typeof value === 'object') {
    return sanitizeDetail(value as Record<string, unknown>);
  }
  if (typeof value === 'string') {
    return sanitizeText(value, 512);
  }
  return value;
}

function sanitizeDetail(detail: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!detail) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    const cleanKey = String(key ?? '').trim();
    if (!cleanKey) {
      continue;
    }
    out[cleanKey] = isSensitiveKey(cleanKey) ? '[redacted]' : sanitizeDetailValue(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function shouldMarkSlow(scope: string, kind: string, durationMs: number): boolean {
  if (!Number.isFinite(durationMs) || durationMs < 1000) {
    return false;
  }
  const cleanScope = String(scope ?? '').trim();
  const cleanKind = String(kind ?? '').trim();
  if (cleanScope === 'desktop_http') {
    return true;
  }
  if (cleanScope === 'direct_session') {
    return cleanKind === 'opened' || cleanKind === 'handshake_failed';
  }
  return false;
}

function normalizeEvent(event: Omit<DiagnosticsEvent, 'created_at' | 'source'> & Partial<Pick<DiagnosticsEvent, 'created_at' | 'source'>>): DiagnosticsEvent {
  const durationMs = Number.isFinite(Number(event.duration_ms)) ? Number(event.duration_ms) : undefined;
  return {
    created_at: sanitizeText(event.created_at || new Date().toISOString(), 64),
    source: 'desktop',
    scope: sanitizeText(event.scope, 64),
    kind: sanitizeText(event.kind, 64),
    trace_id: sanitizeText(event.trace_id, 128) || undefined,
    method: sanitizeText(event.method, 16).toUpperCase() || undefined,
    path: sanitizeText(event.path, 512) || undefined,
    status_code: typeof event.status_code === 'number' ? event.status_code : undefined,
    duration_ms: durationMs,
    slow: typeof durationMs === 'number' ? shouldMarkSlow(String(event.scope ?? ''), String(event.kind ?? ''), durationMs) : false,
    message: sanitizeText(event.message, 240) || undefined,
    detail: sanitizeDetail(event.detail),
  };
}

function diagnosticsDir(stateDir: string): string {
  return path.join(stateDir, 'diagnostics');
}

function activeFilePath(stateDir: string): string {
  return path.join(diagnosticsDir(stateDir), 'desktop-events.jsonl');
}

function rotatedFilePrefix(): string {
  return 'desktop-events-';
}

async function rotateIfNeeded(stateDir: string): Promise<void> {
  const activePath = activeFilePath(stateDir);
  let stat;
  try {
    stat = await fs.stat(activePath);
  } catch {
    return;
  }
  if (stat.size <= DEFAULT_MAX_BYTES) {
    return;
  }
  const dir = diagnosticsDir(stateDir);
  const rotatedPath = path.join(dir, `desktop-events-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jsonl`);
  await fs.rename(activePath, rotatedPath);
  await fs.writeFile(activePath, '', { mode: 0o600 });
  const names = (await fs.readdir(dir)).filter((name) => name.startsWith(rotatedFilePrefix()) && name.endsWith('.jsonl')).sort();
  const stale = names.slice(0, Math.max(0, names.length - DEFAULT_MAX_BACKUPS));
  await Promise.all(stale.map((name) => fs.rm(path.join(dir, name), { force: true })));
}

async function appendEvent(stateDir: string, event: DiagnosticsEvent): Promise<void> {
  await fs.mkdir(diagnosticsDir(stateDir), { recursive: true, mode: 0o700 });
  await fs.appendFile(activeFilePath(stateDir), `${JSON.stringify(event)}\n`, { mode: 0o600 });
  await rotateIfNeeded(stateDir);
}

export class DesktopDiagnosticsRecorder {
  private enabled = false;
  private stateDir = '';
  private allowedOrigin = '';
  private inFlight = new Map<number, InFlightRequest>();
  private writeQueue: Promise<void> = Promise.resolve();

  async configureRuntime(startup: StartupReport, allowedBaseURL: string): Promise<void> {
    this.inFlight.clear();
    this.allowedOrigin = normalizeOrigin(allowedBaseURL);
    this.stateDir = String(startup.state_dir ?? '').trim();
    this.enabled = Boolean(startup.diagnostics_enabled) && this.stateDir !== '' && this.allowedOrigin !== '';
    await this.recordLifecycle(
      'runtime_configured',
      this.enabled ? 'desktop diagnostics enabled' : 'desktop diagnostics disabled',
      {
        allowed_origin: this.allowedOrigin,
        effective_run_mode: startup.effective_run_mode ?? '',
        diagnostics_enabled: this.enabled,
      },
    );
  }

  clearRuntime(): void {
    this.inFlight.clear();
    this.enabled = false;
    this.stateDir = '';
    this.allowedOrigin = '';
  }

  startRequest(params: DesktopRequestStart): DiagnosticsHeaders | null {
    if (!this.enabled || !shouldTrackRequest(params.url, this.allowedOrigin)) {
      return null;
    }
    const headers = cloneHeaders(params.requestHeaders);
    const traceID = headerValue(headers, TRACE_HEADER) || crypto.randomBytes(12).toString('hex');
    headers[TRACE_HEADER] = traceID;
    this.inFlight.set(params.requestID, {
      method: String(params.method ?? '').trim().toUpperCase() || 'GET',
      path: normalizeURLPath(params.url),
      traceID,
      startedAtMs: Date.now(),
    });
    return headers;
  }

  async completeRequest(params: DesktopRequestComplete): Promise<void> {
    const enabledFromResponse = parseEnabledHeader(params.responseHeaders);
    if (enabledFromResponse != null) {
      this.enabled = enabledFromResponse && this.stateDir !== '' && this.allowedOrigin !== '';
    }
    const started = this.inFlight.get(params.requestID);
    this.inFlight.delete(params.requestID);
    if (!started) {
      return;
    }
    const traceID = headerValue(params.responseHeaders, TRACE_HEADER) || started.traceID;
    await this.enqueueEvent({
      scope: 'desktop_http',
      kind: 'completed',
      trace_id: traceID,
      method: started.method,
      path: started.path || normalizeURLPath(params.url),
      status_code: typeof params.statusCode === 'number' ? params.statusCode : undefined,
      duration_ms: Date.now() - started.startedAtMs,
      message: 'desktop request completed',
      detail: {
        from_cache: Boolean(params.fromCache),
      },
    });
  }

  async failRequest(params: DesktopRequestFailure): Promise<void> {
    const started = this.inFlight.get(params.requestID);
    this.inFlight.delete(params.requestID);
    if (!started) {
      return;
    }
    await this.enqueueEvent({
      scope: 'desktop_http',
      kind: 'failed',
      trace_id: started.traceID,
      method: started.method,
      path: started.path || normalizeURLPath(params.url),
      duration_ms: Date.now() - started.startedAtMs,
      message: sanitizeText(params.error || 'desktop request failed', 240),
    });
  }

  async recordLifecycle(kind: string, message: string, detail?: DesktopLifecycleDetail): Promise<void> {
    await this.enqueueEvent({
      scope: 'desktop_lifecycle',
      kind,
      message,
      detail,
    });
  }

  private async enqueueEvent(event: Omit<DiagnosticsEvent, 'created_at' | 'source'> & Partial<Pick<DiagnosticsEvent, 'created_at' | 'source'>>): Promise<void> {
    if (!this.enabled || !this.stateDir) {
      return;
    }
    const normalized = normalizeEvent(event);
    this.writeQueue = this.writeQueue.then(() => appendEvent(this.stateDir, normalized), () => appendEvent(this.stateDir, normalized));
    await this.writeQueue;
  }
}
