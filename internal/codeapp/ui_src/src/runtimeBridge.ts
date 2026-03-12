import { registerProxyAppWindow, type ProxyAppWindowHandle } from "@floegence/flowersec-core/proxy";

export const REDEVEN_APP_PROXY_SW_SUFFIX = "/_redeven_app_sw.js";
export const MAX_WS_FRAME_BYTES = 32 * 1024 * 1024;

export type OriginLocationLike = Readonly<{
  protocol: string;
  hostname: string;
  port?: string;
}>;

type WindowLike = Readonly<{
  location: OriginLocationLike;
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

export function registerCodeAppProxyBridge(targetWindow: Window = window): ProxyAppWindowHandle {
  const win = targetWindow as unknown as WindowLike;
  return registerProxyAppWindow({
    targetWindow,
    controllerOrigin: controllerOriginFromAppLocation(win.location),
    maxWsFrameBytes: MAX_WS_FRAME_BYTES,
  });
}
