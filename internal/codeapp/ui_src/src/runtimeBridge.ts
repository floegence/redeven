import {
  registerProxyAppWindow,
  type ProxyAppWindowHandle,
  type ProxyFetchRequest,
  type ProxyRuntime,
} from "@floegence/flowersec-core/proxy";

export const REDEVEN_APP_PROXY_SW_SUFFIX = "/_redeven_app_sw.js";
export const MAX_WS_FRAME_BYTES = 32 * 1024 * 1024;
export const APP_BRIDGE_CAPABILITY_NONCE_STORAGE_KEY = "redeven_app_bridge_capability_nonce";
export const APP_MAX_WS_FRAME_BYTES_STORAGE_KEY = "redeven_app_max_ws_frame_bytes";
export const APP_PROXY_FETCH_MESSAGE_TYPE = "redeven:app_proxy_fetch_v2";

export type OriginLocationLike = Readonly<{
  protocol: string;
  hostname: string;
  port?: string;
}>;

type WindowLike = Readonly<{
  location: OriginLocationLike;
  sessionStorage?: Pick<Storage, "getItem">;
}>;

type ProxyBridgeBootstrap = Readonly<{
  capabilityNonce: string;
  maxWsFrameBytes: number;
}>;

type MessageRecord = Record<string, unknown>;

function asRecord(value: unknown): MessageRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as MessageRecord
    : null;
}

export function parseAppProxyFetchMessage(value: unknown): ProxyFetchRequest | null {
  const message = asRecord(value);
  if (message?.type !== APP_PROXY_FETCH_MESSAGE_TYPE) return null;

  const raw = asRecord(message.req);
  if (
    !raw ||
    typeof raw.id !== "string" ||
    typeof raw.method !== "string" ||
    typeof raw.path !== "string" ||
    !Array.isArray(raw.headers)
  ) {
    throw new TypeError("invalid app proxy fetch request");
  }

  const headers = raw.headers.map((header) => {
    const entry = asRecord(header);
    if (!entry || typeof entry.name !== "string" || typeof entry.value !== "string") {
      throw new TypeError("invalid app proxy fetch headers");
    }
    return Object.freeze({ name: entry.name, value: entry.value });
  });

  if (raw.body !== undefined && !(raw.body instanceof ArrayBuffer)) {
    throw new TypeError("invalid app proxy fetch body");
  }
  if (raw.external_origin !== undefined && typeof raw.external_origin !== "string") {
    throw new TypeError("invalid app proxy fetch origin");
  }
  if (raw.response_flow_control !== undefined && raw.response_flow_control !== "chunk_credit_v2") {
    throw new TypeError("invalid app proxy fetch flow control");
  }

  return Object.freeze({
    id: raw.id,
    method: raw.method,
    path: raw.path,
    headers: Object.freeze(headers),
    ...(typeof raw.external_origin === "string" ? { externalOrigin: raw.external_origin } : {}),
    ...(raw.response_flow_control === "chunk_credit_v2" ? { responseFlowControl: "chunk_credit_v2" as const } : {}),
    ...(raw.body instanceof ArrayBuffer ? { body: raw.body } : {}),
  });
}

export function registerAppProxyServiceWorkerBridge(
  runtime: ProxyRuntime,
  serviceWorker: ServiceWorkerContainer = navigator.serviceWorker,
): Readonly<{ dispose(): void }> {
  const onMessage = (event: MessageEvent<unknown>): void => {
    const port = event.ports?.[0];
    if (!port) return;

    try {
      const request = parseAppProxyFetchMessage(event.data);
      if (!request) return;
      runtime.dispatchFetch(request, port);
    } catch {
      port.postMessage({
        type: "flowersec-proxy:response_error",
        status: 400,
        code: "invalid_request",
        message: "invalid proxy request",
      });
      port.close();
    }
  };

  serviceWorker.addEventListener("message", onMessage);
  return Object.freeze({
    dispose: () => serviceWorker.removeEventListener("message", onMessage),
  });
}

function splitHostname(hostname: string): string[] {
  return String(hostname ?? "")
    .trim()
    .toLowerCase()
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function runtimeIsolationIDFromAppHost(hostname: string): string {
  const labels = splitHostname(hostname);
  if (labels.length < 4) throw new Error("invalid app host");

  const [first] = labels;
  if (!first || !first.startsWith("app-")) throw new Error("invalid app host");
  const id = first.slice("app-".length).trim();
  if (!id || !/^[a-z0-9-]+$/.test(id)) throw new Error("invalid app host");
  return id;
}

function originFromLocationLike(loc: OriginLocationLike, hostname: string): string {
  const protocol = String(loc.protocol ?? "").trim();
  if (!protocol) throw new Error("invalid location protocol");
  const port = String(loc.port ?? "").trim();
  return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
}

export function controllerOriginFromAppHost(loc: OriginLocationLike): string {
  const runtimeID = runtimeIsolationIDFromAppHost(loc.hostname);
  const labels = splitHostname(loc.hostname);
  const [, ...rest] = labels;
  if (rest.length < 3) throw new Error("invalid app host");
  return originFromLocationLike(loc, `rt-${runtimeID}.${rest.join(".")}`);
}

export function controllerOriginFromAppLocation(loc: OriginLocationLike = window.location): string {
  return controllerOriginFromAppHost(loc);
}

function proxyBridgeBootstrapFromWindow(win: WindowLike): ProxyBridgeBootstrap {
  const storage = win.sessionStorage;
  if (!storage) throw new Error("proxy bridge bootstrap is unavailable");

  const capabilityNonce = String(storage.getItem(APP_BRIDGE_CAPABILITY_NONCE_STORAGE_KEY) ?? "");
  const hasInvalidNonceCharacter = Array.from(capabilityNonce).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x20 || codePoint === 0x7f;
  });
  if (
    capabilityNonce === "" ||
    capabilityNonce !== capabilityNonce.trim() ||
    hasInvalidNonceCharacter ||
    capabilityNonce.length > 256
  ) {
    throw new Error("invalid proxy bridge capability nonce");
  }

  const rawMaxWsFrameBytes = String(storage.getItem(APP_MAX_WS_FRAME_BYTES_STORAGE_KEY) ?? "");
  const maxWsFrameBytes = /^[1-9][0-9]*$/u.test(rawMaxWsFrameBytes) ? Number(rawMaxWsFrameBytes) : NaN;
  if (!Number.isSafeInteger(maxWsFrameBytes) || maxWsFrameBytes <= 0 || maxWsFrameBytes > MAX_WS_FRAME_BYTES) {
    throw new Error("invalid proxy bridge WebSocket frame limit");
  }

  return { capabilityNonce, maxWsFrameBytes };
}

export function registerCodeAppProxyBridge(targetWindow: Window = window): ProxyAppWindowHandle {
  const win = targetWindow as unknown as WindowLike;
  const bootstrap = proxyBridgeBootstrapFromWindow(win);
  const app = registerProxyAppWindow({
    targetWindow,
    controllerOrigin: controllerOriginFromAppLocation(win.location),
    ...bootstrap,
  });
  try {
    const serviceWorker = registerAppProxyServiceWorkerBridge(app.runtime, targetWindow.navigator.serviceWorker);
    return Object.freeze({
      runtime: app.runtime,
      dispose: () => {
        serviceWorker.dispose();
        app.dispose();
      },
    });
  } catch (error) {
    app.dispose();
    throw error;
  }
}
