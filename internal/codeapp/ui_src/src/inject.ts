import type { ProxyRuntime } from "@floegence/flowersec-core/proxy";
import { installWebSocketPatch } from "@floegence/flowersec-core/proxy";

// This script is injected into code-server HTML responses by our custom Service Worker.
// It MUST be an external script (no inline) to satisfy code-server's strict CSP.

const RUNTIME_GLOBAL = "__flowersecProxyRuntime";

const ERR_SW_REGISTER_DISABLED = "service worker register is disabled by flowersec-proxy runtime";

// Allow the VSCode webview pre service worker from code-server.
//
// Facts (from ../code-server patches):
// - Webview pre registers `service-worker.js?...` under `/out/vs/workbench/contrib/webview/browser/pre/`.
// - code-server also registers a PWA service worker `serviceWorker.js` which can claim a broad scope.
//
// We must keep the root scope controlled by our proxy Service Worker:
// - Allow the webview pre service worker (required for webviews to work).
// - Block the PWA service worker from actually registering (it is optional), but return a no-op
//   registration to avoid noisy user-facing errors.
const CODE_SERVER_WEBVIEW_SW_SUFFIX = "/out/vs/workbench/contrib/webview/browser/pre/service-worker.js";
const CODE_SERVER_PWA_SW_SUFFIX = "/out/browser/serviceWorker.js";
const REDEVEN_PROXY_SW_SUFFIX = "/_redeven_sw.js";

// Redeven patches the code-server webview pre Service Worker script (served from code-server)
// to add a fallback proxy path: if the upstream SW does not call respondWith, it asks
// the page (this injected script) to forward the request to the Redeven proxy SW.
//
// Message flow:
// - webview-pre SW -> webview page: { type: WEBVIEW_PRE_PROXY_FETCH, req } + MessagePort
// - webview page -> Redeven proxy SW(scope=/): { type: REDEVEN_PROXY_FETCH, req } + same MessagePort
// - Redeven proxy SW -> runtime: { type: flowersec-proxy:fetch, req } + same MessagePort
// - runtime -> webview-pre SW: response_meta/chunks/end via MessagePort
const WEBVIEW_PRE_PROXY_FETCH_MSG_TYPE = "redeven:webview_pre_proxy_fetch";
const REDEVEN_PROXY_FETCH_MSG_TYPE = "redeven:proxy_fetch";

async function forwardProxyFetchToRedevenSW(req: unknown, port: MessagePort): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sw = reg?.active;
    if (!sw) {
      port.postMessage({ type: "flowersec-proxy:response_error", status: 503, message: "redeven proxy service worker not available" });
      try {
        port.close();
      } catch {
        // ignore
      }
      return;
    }

    sw.postMessage({ type: REDEVEN_PROXY_FETCH_MSG_TYPE, req }, [port]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    port.postMessage({ type: "flowersec-proxy:response_error", status: 502, message: msg });
    try {
      port.close();
    } catch {
      // ignore
    }
  }
}

function installWebviewPreProxyFetchForwarder(): void {
  const sw = globalThis.navigator?.serviceWorker;
  if (!sw) return;

  const current = sw as unknown as { __redeven_webview_pre_proxy_forwarder?: boolean };
  if (current.__redeven_webview_pre_proxy_forwarder) return;
  current.__redeven_webview_pre_proxy_forwarder = true;

  sw.addEventListener("message", (ev: MessageEvent) => {
    const data = ev.data as any;
    if (!data || typeof data !== "object") return;
    if (data.type !== WEBVIEW_PRE_PROXY_FETCH_MSG_TYPE) return;
    const port = ev.ports?.[0];
    if (!port) return;
    void forwardProxyFetchToRedevenSW(data.req, port);
  });
}

function rejectSWRegister(): Promise<never> {
  return Promise.reject(new Error(ERR_SW_REGISTER_DISABLED));
}

function noopSWRegister(options?: RegistrationOptions): Promise<ServiceWorkerRegistration> {
  // A minimal stub: code-server only awaits the promise and logs on success/failure.
  let scope = `${window.location.origin}/`;
  try {
    const scopeRaw = String(options?.scope ?? "").trim();
    if (scopeRaw) scope = new URL(scopeRaw, window.location.href).toString();
  } catch {
    // ignore
  }

  const reg = {
    scope,
    update: async () => {},
    unregister: async () => true,
  } as unknown as ServiceWorkerRegistration;

  return Promise.resolve(reg);
}

function patchServiceWorkerRegisterForCodeServer(): void {
  const sw = globalThis.navigator?.serviceWorker;
  if (!sw || typeof sw.register !== "function") return;

  const current = sw.register as unknown as { __redeven_sw_patched?: boolean };
  if (current.__redeven_sw_patched) return;

  const originalRegister = sw.register.bind(sw);

  const patched = ((scriptURL: string | URL, options?: RegistrationOptions) => {
    try {
      const u = new URL(String(scriptURL), window.location.href);
      if (u.pathname.endsWith(CODE_SERVER_WEBVIEW_SW_SUFFIX)) {
        // Hardening: only allow scopes within the webview pre directory.
        // If a caller tries to widen the scope, reject it.
        const scopeRaw = String(options?.scope ?? "").trim();
        if (scopeRaw) {
          const scopeURL = new URL(scopeRaw, window.location.href);
          const dir = u.pathname.slice(0, u.pathname.lastIndexOf("/") + 1);
          if (!scopeURL.pathname.startsWith(dir)) {
            return rejectSWRegister();
          }
        }

        return originalRegister(scriptURL as any, options as any);
      }

      if (u.pathname.endsWith(CODE_SERVER_PWA_SW_SUFFIX)) {
        // Keep root scope controlled by our proxy SW, but avoid noisy workbench errors.
        return noopSWRegister(options);
      }

      return rejectSWRegister();
    } catch {
      return rejectSWRegister();
    }
  }) as unknown as ServiceWorkerContainer["register"] & { __redeven_sw_patched?: boolean };

  patched.__redeven_sw_patched = true;

  // Best-effort: some environments may not allow overriding the property.
  try {
    sw.register = patched;
  } catch {
    // ignore
  }
}

function isServiceWorkerScriptPathSuffix(raw: string, suffix: string): boolean {
  const v = String(raw ?? "").trim();
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.pathname.endsWith(suffix);
  } catch {
    return v.endsWith(suffix);
  }
}

async function uninstallConflictingServiceWorkersBestEffort(): Promise<void> {
  // code-server's PWA service worker registers at scope "/" (see productConfiguration.serviceWorker)
  // and can take control away from Redeven's proxy SW. Uninstall it if it's present from a
  // previous browser session so the E2EE/runtime proxy remains stable.
  try {
    const sw = globalThis.navigator?.serviceWorker;
    if (!sw) return;

    const controllerScriptURL = String(sw.controller?.scriptURL ?? "").trim();
    const controllerIsCodeServerPwa = isServiceWorkerScriptPathSuffix(controllerScriptURL, CODE_SERVER_PWA_SW_SUFFIX);
    const controllerIsRedevenProxy = isServiceWorkerScriptPathSuffix(controllerScriptURL, REDEVEN_PROXY_SW_SUFFIX);
    if (!controllerIsCodeServerPwa || controllerIsRedevenProxy) {
      // Either we're already on the correct controller or the controller is unrelated.
      // Still try to uninstall stale code-server registrations below.
    }

    const regs = typeof sw.getRegistrations === "function" ? await sw.getRegistrations() : [];
    let uninstalled = false;
    for (const reg of regs) {
      const script = String(reg?.active?.scriptURL ?? reg?.waiting?.scriptURL ?? reg?.installing?.scriptURL ?? "").trim();
      if (!isServiceWorkerScriptPathSuffix(script, CODE_SERVER_PWA_SW_SUFFIX)) continue;
      try {
        const ok = await reg.unregister();
        uninstalled = uninstalled || ok;
      } catch {
        // ignore
      }
    }

    // If code-server's PWA SW was controlling this page, a reload is required for the proxy SW
    // to take control (unregister does not immediately change the active controller).
    if (uninstalled && controllerIsCodeServerPwa && !controllerIsRedevenProxy) {
      try {
        const key = "redeven_sw_cleanup_ts";
        const last = Number(sessionStorage.getItem(key) ?? "0");
        const now = Date.now();
        // Avoid reload loops: allow at most one cleanup-triggered reload per 10s.
        if (!Number.isFinite(last) || now-last > 10_000) {
          sessionStorage.setItem(key, String(now));
          window.top?.location.reload();
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

function getProxyRuntime(): ProxyRuntime | null {
  const top = window.top as unknown as Record<string, unknown> | null;
  if (!top) return null;
  const rt = top[RUNTIME_GLOBAL];
  if (!rt) return null;
  return rt as ProxyRuntime;
}

try {
  void uninstallConflictingServiceWorkersBestEffort();
  const rt = getProxyRuntime();
  if (rt) {
    patchServiceWorkerRegisterForCodeServer();
    installWebviewPreProxyFetchForwarder();

    // Route same-origin WebSocket connections through flowersec-proxy/ws streams.
    installWebSocketPatch({ runtime: rt });
  }
} catch {
  // Best-effort: failing to patch should not break the page render.
}
