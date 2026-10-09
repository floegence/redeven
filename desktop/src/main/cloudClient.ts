import {
  normalizeControlPlaneOrigin,
  normalizeDesktopControlPlaneAccount,
  normalizeDesktopCloudAccessPointList,
  normalizeDesktopCloud,
  normalizeDesktopCloudEnvironmentList,
  normalizeDesktopCloudEnvironmentRuntimeHealthList,
  type DesktopControlPlaneAccount,
  type DesktopCloud,
  type DesktopCloudAccessPoint,
  type DesktopCloudEnvironment,
  type DesktopCloudEnvironmentRuntimeHealth,
} from '../shared/cloud';
import {
  DesktopProviderRequestError,
  electronDesktopProviderTransport,
  type DesktopProviderTransport,
  type DesktopProviderTransportResponse,
} from './cloudTransport';

const CLOUD_DISCOVERY_PATH = '/.well-known/redeven-cloud.json';
const CLOUD_ME_PATH = '/api/rcpp/v4/me';
const CLOUD_ENVIRONMENTS_PATH = '/api/rcpp/v4/environments';
const CLOUD_ENVIRONMENTS_RUNTIME_HEALTH_QUERY_PATH = '/api/rcpp/v4/environments/runtime-health/query';
const CLOUD_DESKTOP_CONNECT_EXCHANGE_PATH = '/api/rcpp/v4/desktop/connect/exchange';
const CLOUD_DESKTOP_TOKEN_REFRESH_PATH = '/api/rcpp/v4/desktop/token/refresh';
const CLOUD_DESKTOP_TOKEN_REVOKE_PATH = '/api/rcpp/v4/desktop/token/revoke';
const CLOUD_DESKTOP_OPEN_SESSION_PATH_SUFFIX = '/desktop/open-session';
const CLOUD_RUNTIME_LINK_AUTHORIZATION_PATH_SUFFIX = '/runtime-link/authorizations';
const CLOUD_PROTOCOL_VERSION = 'rcpp-v4';
const DEFAULT_CLOUD_TIMEOUT_MS = 15_000;

export type ProviderDesktopOpenSession = Readonly<{
  remote_session_url: string;
  access_point_origin: string;
  expires_at_unix_ms: number;
}>;

export type ProviderDesktopConnectExchangeResult = Readonly<{
  access_token: string;
  access_expires_at_unix_ms: number;
  refresh_token: string;
  authorization_expires_at_unix_ms: number;
  account: DesktopControlPlaneAccount;
  access_points: readonly DesktopCloudAccessPoint[];
}>;

export type ProviderDesktopConnectAuthorization = Readonly<{
  authorization_code: string;
  code_verifier: string;
}>;

export type ProviderDesktopTokenRefreshResult = Readonly<{
  access_token: string;
  access_expires_at_unix_ms: number;
  authorization_expires_at_unix_ms: number;
}>;

export type CloudEnvironmentRuntimeHealthQuery = Readonly<{
  env_public_ids: readonly string[];
}>;

export type CloudRuntimeLinkAuthorization = Readonly<{
  runtime_link_ticket: string;
  expires_at_unix_ms: number;
}>;

type ProviderJSONErrorEnvelope = Readonly<{
  error?: Readonly<{
    code?: unknown;
    message?: unknown;
  }> | null;
}>;

type ProviderClientRequestOptions = Readonly<{
  transport?: DesktopProviderTransport;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function requireCloudProtocolVersion(cloudOrigin: string, value: unknown, message: string): void {
  if (compact(value) !== CLOUD_PROTOCOL_VERSION) {
    throw invalidProviderResponseError(cloudOrigin, message);
  }
}

function normalizeUnixMS(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error('Provider response is invalid.');
  }
  return Math.floor(numeric);
}

function providerRequestURL(cloudOrigin: string, pathname: string): string {
  const base = new URL(normalizeControlPlaneOrigin(cloudOrigin));
  base.pathname = pathname;
  base.search = '';
  base.hash = '';
  return base.toString();
}

function accessPointRequestURL(accessPointOrigin: string, pathname: string): string {
  return providerRequestURL(accessPointOrigin, pathname);
}

function headersRecord(headers: Headers): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};
  headers.forEach((value, key) => {
    normalized[key] = value;
  });
  return normalized;
}

function invalidProviderResponseError(
  cloudOrigin: string,
  message: string,
): DesktopProviderRequestError {
  return new DesktopProviderRequestError('provider_invalid_response', message, { cloudOrigin });
}

function normalizeProviderUnixMS(
  cloudOrigin: string,
  value: unknown,
  message: string,
): number {
  try {
    return normalizeUnixMS(value);
  } catch {
    throw invalidProviderResponseError(cloudOrigin, message);
  }
}

async function readResponseJSON(
  cloudOrigin: string,
  response: DesktopProviderTransportResponse,
  operationLabel: string,
): Promise<unknown> {
  const body = response.body_text;
  if (compact(body) === '') {
    return null;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new DesktopProviderRequestError(
      'provider_invalid_json',
      `The provider returned invalid JSON for ${operationLabel}.`,
      {
        cloudOrigin,
        status: response.status,
      },
    );
  }
}

function providerErrorMessage(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const envelope = body as ProviderJSONErrorEnvelope;
    const message = compact(envelope.error?.message);
    if (message !== '') {
      return message;
    }
  }
  return `Provider request failed (${status}).`;
}

export async function fetchProviderJSON(
  url: string,
  options: Readonly<{
    method?: 'GET' | 'POST';
    bearerToken?: string;
    body?: unknown;
    extraHeaders?: Readonly<Record<string, string>>;
    operationLabel: string;
    transport?: DesktopProviderTransport;
  }>,
): Promise<Readonly<{ body: unknown; headers: Readonly<Record<string, string>>; status: number }>> {
  const headers = new Headers({
    Accept: 'application/json',
    'Cache-Control': 'no-store',
  });
  for (const [name, value] of Object.entries(options.extraHeaders ?? {})) {
    const cleanName = compact(name);
    const cleanValue = String(value ?? '').trim();
    if (cleanName !== '' && cleanValue !== '') {
      headers.set(cleanName, cleanValue);
    }
  }
  const bearerToken = compact(options.bearerToken);
  if (bearerToken !== '') {
    headers.set('Authorization', `Bearer ${bearerToken}`);
  }
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const cloudOrigin = normalizeControlPlaneOrigin(url);
  const transport = options.transport ?? electronDesktopProviderTransport;
  const response = await transport({
    url,
    method: options.method ?? 'GET',
    headers: headersRecord(headers),
    body_text: options.body === undefined ? undefined : JSON.stringify(options.body),
    timeout_ms: DEFAULT_CLOUD_TIMEOUT_MS,
  });
  const body = await readResponseJSON(cloudOrigin, response, options.operationLabel);
  if (response.status < 200 || response.status >= 300) {
    throw new DesktopProviderRequestError(
      'provider_request_failed',
      providerErrorMessage(response.status, body),
      {
        cloudOrigin,
        status: response.status,
      },
    );
  }
  return {
    body,
    headers: response.headers,
    status: response.status,
  };
}

function normalizeProviderOpenSessionResponse(
  accessPointOrigin: string,
  body: unknown,
  message: string,
): ProviderDesktopOpenSession {
  if (!body || typeof body !== 'object') {
    throw invalidProviderResponseError(accessPointOrigin, message);
  }

  const candidate = body as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(candidate, 'bootstrap_ticket')) {
    throw invalidProviderResponseError(accessPointOrigin, message);
  }
  const remoteSessionURL = compact(candidate.remote_session_url);
  let responseAccessPointOrigin = '';
  try {
    responseAccessPointOrigin = normalizeControlPlaneOrigin(compact(candidate.access_point_origin));
  } catch {
    throw invalidProviderResponseError(accessPointOrigin, message);
  }
  if (remoteSessionURL === '') {
    throw invalidProviderResponseError(accessPointOrigin, message);
  }
  if (responseAccessPointOrigin !== normalizeControlPlaneOrigin(accessPointOrigin)) {
    throw invalidProviderResponseError(accessPointOrigin, message);
  }
  return {
    remote_session_url: remoteSessionURL,
    access_point_origin: responseAccessPointOrigin,
    expires_at_unix_ms: normalizeProviderUnixMS(accessPointOrigin, candidate.expires_at_unix_ms, message),
  };
}

function normalizeProviderDesktopTokenRefreshResponse(
  cloudOrigin: string,
  body: unknown,
): ProviderDesktopTokenRefreshResult {
  if (!body || typeof body !== 'object') {
    throw invalidProviderResponseError(
      cloudOrigin,
      'The provider desktop token refresh response is invalid.',
    );
  }

  const candidate = body as Record<string, unknown>;
  const accessToken = compact(candidate.access_token);
  if (accessToken === '') {
    throw invalidProviderResponseError(
      cloudOrigin,
      'The provider desktop token refresh response is invalid.',
    );
  }
  return {
    access_token: accessToken,
    access_expires_at_unix_ms: normalizeProviderUnixMS(
      cloudOrigin,
      candidate.access_expires_at_unix_ms,
      'The provider desktop token refresh response is invalid.',
    ),
    authorization_expires_at_unix_ms: normalizeProviderUnixMS(
      cloudOrigin,
      candidate.authorization_expires_at_unix_ms,
      'The provider desktop token refresh response is invalid.',
    ),
  };
}

function normalizeProviderDesktopConnectExchangeResponse(
  provider: DesktopCloud,
  body: unknown,
): ProviderDesktopConnectExchangeResult {
  if (!body || typeof body !== 'object') {
    throw invalidProviderResponseError(
      provider.cloud_origin,
      'The provider desktop connect response is invalid.',
    );
  }

  const candidate = body as Record<string, unknown>;
  const accessToken = compact(candidate.access_token);
  const refreshToken = compact(candidate.refresh_token);
  const cloudID = compact(candidate.cloud_id);
  let cloudOrigin = '';
  try {
    cloudOrigin = normalizeControlPlaneOrigin(compact(candidate.cloud_origin));
  } catch {
    throw invalidProviderResponseError(
      provider.cloud_origin,
      'The provider desktop connect response is invalid.',
    );
  }
  const authorizationExpiresAtUnixMS = normalizeProviderUnixMS(
    provider.cloud_origin,
    candidate.authorization_expires_at_unix_ms,
    'The provider desktop connect response is invalid.',
  );
  if (
    accessToken === ''
    || refreshToken === ''
    || cloudID !== provider.cloud_id
    || cloudOrigin !== provider.cloud_origin
  ) {
    throw invalidProviderResponseError(
      provider.cloud_origin,
      'The provider desktop connect response is invalid.',
    );
  }

  const account = normalizeDesktopControlPlaneAccount({
    ...(candidate.account && typeof candidate.account === 'object'
      ? candidate.account as Record<string, unknown>
      : {}),
    authorization_expires_at_unix_ms: authorizationExpiresAtUnixMS,
  }, { cloud: provider });
  if (!account) {
    throw invalidProviderResponseError(
      provider.cloud_origin,
      'The provider desktop connect response is invalid.',
    );
  }
  const accessPoints = normalizeDesktopCloudAccessPointList(candidate.access_points);
  if (accessPoints.length === 0) {
    throw invalidProviderResponseError(
      provider.cloud_origin,
      'The provider desktop connect response is invalid.',
    );
  }

  return {
    access_token: accessToken,
    access_expires_at_unix_ms: normalizeProviderUnixMS(
      provider.cloud_origin,
      candidate.access_expires_at_unix_ms,
      'The provider desktop connect response is invalid.',
    ),
    refresh_token: refreshToken,
    authorization_expires_at_unix_ms: authorizationExpiresAtUnixMS,
    account,
    access_points: accessPoints,
  };
}

export async function fetchProviderDiscovery(
  cloudOrigin: string,
  requestOptions: ProviderClientRequestOptions = {},
): Promise<DesktopCloud> {
  const normalizedOrigin = normalizeControlPlaneOrigin(cloudOrigin);
  const { body } = await fetchProviderJSON(providerRequestURL(normalizedOrigin, CLOUD_DISCOVERY_PATH), {
    operationLabel: 'the provider discovery document',
    transport: requestOptions.transport,
  });
  const provider = normalizeDesktopCloud(body);
  if (!provider) {
    throw invalidProviderResponseError(
      normalizedOrigin,
      'The provider discovery document is invalid.',
    );
  }
  return provider;
}

export async function exchangeProviderDesktopConnectAuthorization(
  provider: DesktopCloud,
  authorization: ProviderDesktopConnectAuthorization,
  requestOptions: ProviderClientRequestOptions = {},
): Promise<ProviderDesktopConnectExchangeResult> {
  const { body } = await fetchProviderJSON(
    providerRequestURL(provider.cloud_origin, CLOUD_DESKTOP_CONNECT_EXCHANGE_PATH),
    {
      method: 'POST',
      body: {
        authorization_code: compact(authorization.authorization_code),
        code_verifier: compact(authorization.code_verifier),
      },
      operationLabel: 'the desktop connect exchange',
      transport: requestOptions.transport,
    },
  );
  return normalizeProviderDesktopConnectExchangeResponse(provider, body);
}

export async function refreshProviderDesktopAccessToken(
  provider: DesktopCloud,
  refreshToken: string,
  requestOptions: ProviderClientRequestOptions = {},
): Promise<ProviderDesktopTokenRefreshResult> {
  const { body } = await fetchProviderJSON(
    providerRequestURL(provider.cloud_origin, CLOUD_DESKTOP_TOKEN_REFRESH_PATH),
    {
      method: 'POST',
      body: {
        refresh_token: compact(refreshToken),
      },
      operationLabel: 'the desktop token refresh response',
      transport: requestOptions.transport,
    },
  );
  return normalizeProviderDesktopTokenRefreshResponse(provider.cloud_origin, body);
}

export async function revokeProviderDesktopAuthorization(
  provider: DesktopCloud,
  refreshToken: string,
  requestOptions: ProviderClientRequestOptions = {},
): Promise<void> {
  await fetchProviderJSON(
    providerRequestURL(provider.cloud_origin, CLOUD_DESKTOP_TOKEN_REVOKE_PATH),
    {
      method: 'POST',
      body: {
        refresh_token: compact(refreshToken),
      },
      operationLabel: 'the desktop token revoke response',
      transport: requestOptions.transport,
    },
  );
}

export async function fetchProviderAccount(
  provider: DesktopCloud,
  accessToken: string,
  requestOptions: ProviderClientRequestOptions = {},
): Promise<DesktopControlPlaneAccount> {
  const { body } = await fetchProviderJSON(
    providerRequestURL(provider.cloud_origin, CLOUD_ME_PATH),
    {
      bearerToken: accessToken,
      operationLabel: 'the account summary',
      transport: requestOptions.transport,
    },
  );
  const account = normalizeDesktopControlPlaneAccount(body, { cloud: provider });
  if (!account) {
    throw invalidProviderResponseError(
      provider.cloud_origin,
      'The provider account summary is invalid.',
    );
  }
  return account;
}

export async function fetchCloudEnvironments(
  provider: DesktopCloud,
  accessPoint: DesktopCloudAccessPoint,
  accessToken: string,
  requestOptions: ProviderClientRequestOptions = {},
): Promise<readonly DesktopCloudEnvironment[]> {
  const accessPointOrigin = accessPoint.access_point_origin;
  const { body } = await fetchProviderJSON(
    accessPointRequestURL(accessPointOrigin, CLOUD_ENVIRONMENTS_PATH),
    {
      bearerToken: accessToken,
      operationLabel: 'the published environment list',
      transport: requestOptions.transport,
    },
  );
  if (!body || typeof body !== 'object' || !Array.isArray((body as { environments?: unknown }).environments)) {
    throw invalidProviderResponseError(
      accessPointOrigin,
      'The provider environment list is invalid.',
    );
  }
  requireCloudProtocolVersion(
    accessPointOrigin,
    (body as { protocol_version?: unknown }).protocol_version,
    'The provider environment list protocol is invalid.',
  );
  return normalizeDesktopCloudEnvironmentList(body, { cloud: provider });
}

export async function requestCloudRuntimeLinkAuthorization(
  provider: DesktopCloud,
  accessPoint: DesktopCloudAccessPoint,
  accessToken: string,
  envPublicID: string,
  requestOptions: ProviderClientRequestOptions = {},
): Promise<CloudRuntimeLinkAuthorization> {
  const cleanEnvPublicID = compact(envPublicID);
  if (cleanEnvPublicID === '') throw new Error('Environment ID is required.');
  const accessPointOrigin = accessPoint.access_point_origin;
  const { body } = await fetchProviderJSON(accessPointRequestURL(
    accessPointOrigin,
    `${CLOUD_ENVIRONMENTS_PATH}/${encodeURIComponent(cleanEnvPublicID)}${CLOUD_RUNTIME_LINK_AUTHORIZATION_PATH_SUFFIX}`,
  ), {
    method: 'POST',
    bearerToken: accessToken,
    body: { protocol_version: CLOUD_PROTOCOL_VERSION, env_public_id: cleanEnvPublicID },
    operationLabel: 'the Runtime link authorization',
    transport: requestOptions.transport,
  });
  if (!body || typeof body !== 'object') {
    throw invalidProviderResponseError(accessPointOrigin, 'The Runtime link authorization response is invalid.');
  }
  const candidate = body as Record<string, unknown>;
  requireCloudProtocolVersion(accessPointOrigin, candidate.protocol_version, 'The Runtime link authorization protocol is invalid.');
  if (Object.prototype.hasOwnProperty.call(candidate, 'bootstrap_ticket')) {
    throw invalidProviderResponseError(accessPointOrigin, 'The Runtime link authorization response is invalid.');
  }
  const runtimeLinkTicket = compact(candidate.runtime_link_ticket);
  const expiresAtUnixMS = Number(candidate.expires_at_unix_ms);
  if (runtimeLinkTicket === '' || !Number.isSafeInteger(expiresAtUnixMS) || expiresAtUnixMS <= Date.now()) {
    throw invalidProviderResponseError(accessPointOrigin, 'The Runtime link authorization response is invalid.');
  }
  return { runtime_link_ticket: runtimeLinkTicket, expires_at_unix_ms: expiresAtUnixMS };
}

export async function queryCloudEnvironmentRuntimeHealth(
  provider: DesktopCloud,
  accessPoint: DesktopCloudAccessPoint,
  accessToken: string,
  query: CloudEnvironmentRuntimeHealthQuery,
  requestOptions: ProviderClientRequestOptions = {},
): Promise<readonly DesktopCloudEnvironmentRuntimeHealth[]> {
  const envPublicIDs = query.env_public_ids
    .map((value) => compact(value))
    .filter((value) => value !== '');
  if (envPublicIDs.length === 0) {
    return [];
  }
  const accessPointOrigin = accessPoint.access_point_origin;
  const { body } = await fetchProviderJSON(
    accessPointRequestURL(accessPointOrigin, CLOUD_ENVIRONMENTS_RUNTIME_HEALTH_QUERY_PATH),
    {
      method: 'POST',
      bearerToken: accessToken,
      body: {
        env_public_ids: envPublicIDs,
      },
      operationLabel: 'the provider runtime health response',
      transport: requestOptions.transport,
    },
  );
  if (!body || typeof body !== 'object' || !Array.isArray((body as { environments?: unknown }).environments)) {
    throw invalidProviderResponseError(
      accessPointOrigin,
      'The provider runtime health response is invalid.',
    );
  }
  return normalizeDesktopCloudEnvironmentRuntimeHealthList(body);
}

export async function requestDesktopOpenSession(
  provider: DesktopCloud,
  accessPoint: DesktopCloudAccessPoint,
  accessToken: string,
  envPublicID: string,
  requestOptions: ProviderClientRequestOptions = {},
): Promise<ProviderDesktopOpenSession> {
  const cleanEnvPublicID = compact(envPublicID);
  if (cleanEnvPublicID === '') {
    throw new Error('Environment ID is required.');
  }
  const accessPointOrigin = accessPoint.access_point_origin;
  const { body } = await fetchProviderJSON(
    accessPointRequestURL(
      accessPointOrigin,
      `${CLOUD_ENVIRONMENTS_PATH}/${encodeURIComponent(cleanEnvPublicID)}${CLOUD_DESKTOP_OPEN_SESSION_PATH_SUFFIX}`,
    ),
    {
      method: 'POST',
      bearerToken: accessToken,
      operationLabel: 'the desktop open session',
      transport: requestOptions.transport,
    },
  );
  return normalizeProviderOpenSessionResponse(
    accessPointOrigin,
    body,
    'The provider desktop open session response is invalid.',
  );
}

export function providerFloeproxyBootExchangeURL(accessPointOrigin: string): string {
  return accessPointRequestURL(accessPointOrigin, '/api/srv/v1/floeproxy/boot/exchange');
}

export function providerFloeproxyEntryURL(accessPointOrigin: string): string {
  return accessPointRequestURL(accessPointOrigin, '/api/srv/v1/floeproxy/entry');
}
