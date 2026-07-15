import { registerProxyAppWindow, type ProxyAppWindowHandle } from "@floegence/flowersec-core/proxy";

export const REDEVEN_APP_PROXY_SW_SUFFIX = "/_redeven_app_sw.js";
export const MAX_WS_FRAME_BYTES = 32 * 1024 * 1024;
export const APP_BRIDGE_CAPABILITY_NONCE_STORAGE_KEY = "redeven_app_bridge_capability_nonce";
export const APP_MAX_WS_FRAME_BYTES_STORAGE_KEY = "redeven_app_max_ws_frame_bytes";

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
  capabilityNonce?: string;
  maxWsFrameBytes: number;
}>;

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
  try {
    const storage = win.sessionStorage;
    if (!storage) return { maxWsFrameBytes: MAX_WS_FRAME_BYTES };
    const capabilityNonce = String(storage.getItem(APP_BRIDGE_CAPABILITY_NONCE_STORAGE_KEY) ?? "").trim();
    const rawMaxWsFrameBytes = String(storage.getItem(APP_MAX_WS_FRAME_BYTES_STORAGE_KEY) ?? "");
    const parsedMaxWsFrameBytes = /^[1-9][0-9]*$/.test(rawMaxWsFrameBytes) ? Number(rawMaxWsFrameBytes) : NaN;
    const maxWsFrameBytes = Number.isSafeInteger(parsedMaxWsFrameBytes)
      ? Math.min(parsedMaxWsFrameBytes, MAX_WS_FRAME_BYTES)
      : MAX_WS_FRAME_BYTES;
    const hasInvalidNonceCharacter = Array.from(capabilityNonce).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return /\s/.test(character) || codePoint < 0x20 || codePoint === 0x7f;
    });

    return {
      ...(capabilityNonce && !hasInvalidNonceCharacter ? { capabilityNonce } : {}),
      maxWsFrameBytes,
    };
  } catch {
    return { maxWsFrameBytes: MAX_WS_FRAME_BYTES };
  }
}

export function registerCodeAppProxyBridge(targetWindow: Window = window): ProxyAppWindowHandle {
  const win = targetWindow as unknown as WindowLike;
  const bootstrap = proxyBridgeBootstrapFromWindow(win);
  return registerProxyAppWindow({
    targetWindow,
    controllerOrigin: controllerOriginFromAppLocation(win.location),
    ...bootstrap,
  });
}
