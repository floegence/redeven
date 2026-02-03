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
// - code-server also registers a PWA service worker `serviceWorker.js` and explicitly sets
//   `Service-Worker-Allowed: /` for it, which can expand its scope to `/`.
//
// We must keep the root scope controlled by our proxy Service Worker, so only allow the
// webview pre service worker and block everything else.
const CODE_SERVER_WEBVIEW_SW_SUFFIX = "/out/vs/workbench/contrib/webview/browser/pre/service-worker.js";

function rejectSWRegister(): Promise<never> {
  return Promise.reject(new Error(ERR_SW_REGISTER_DISABLED));
}

function patchServiceWorkerRegisterForCodeServerWebview(): void {
  const sw = globalThis.navigator?.serviceWorker;
  if (!sw || typeof sw.register !== "function") return;

  const current = sw.register as unknown as { __redeven_sw_patched?: boolean };
  if (current.__redeven_sw_patched) return;

  const originalRegister = sw.register.bind(sw);

  const patched = ((scriptURL: string | URL, options?: RegistrationOptions) => {
    try {
      const u = new URL(String(scriptURL), window.location.href);
      if (!u.pathname.endsWith(CODE_SERVER_WEBVIEW_SW_SUFFIX)) {
        return rejectSWRegister();
      }

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

function getProxyRuntime(): ProxyRuntime | null {
  const top = window.top as unknown as Record<string, unknown> | null;
  if (!top) return null;
  const rt = top[RUNTIME_GLOBAL];
  if (!rt) return null;
  return rt as ProxyRuntime;
}

try {
  const rt = getProxyRuntime();
  if (rt) {
    patchServiceWorkerRegisterForCodeServerWebview();

    // Route same-origin WebSocket connections through flowersec-proxy/ws streams.
    installWebSocketPatch({ runtime: rt });
  }
} catch {
  // Best-effort: failing to patch should not break the page render.
}
