import { installWebSocketPatch } from "@floegence/flowersec-core/proxy";
import { registerCodeAppProxyBridge, REDEVEN_APP_PROXY_SW_SUFFIX } from "./runtimeBridge";

// This script is injected into code-server HTML responses by our custom Service Worker.
// It MUST be an external script (no inline) to satisfy code-server's strict CSP.

const ERR_SW_REGISTER_DISABLED = "service worker register is disabled by flowersec-proxy runtime";
const CODE_APP_PROXY_BOOTSTRAP_FATAL_CODE = "REDEVEN_CODE_APP_PROXY_BOOTSTRAP_FAILED";
const CODE_APP_NETWORK_DISABLED_MESSAGE = "Code App network is disabled because secure proxy bootstrap failed";
const CODE_APP_FATAL_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "worker-src 'none'",
].join("; ");

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
    const controllerIsRedevenProxy = isServiceWorkerScriptPathSuffix(controllerScriptURL, REDEVEN_APP_PROXY_SW_SUFFIX);
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

function normalizedFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = Array.from(raw, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
  })
    .join("")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 512);
  return normalized || "unknown secure proxy bootstrap failure";
}

function networkDisabledError(): Error {
  return new Error(CODE_APP_NETWORK_DISABLED_MESSAGE);
}

function lockProperty(target: object, property: PropertyKey, value: unknown): void {
  try {
    Object.defineProperty(target, property, {
      configurable: false,
      enumerable: true,
      value,
      writable: false,
    });
    return;
  } catch {
    // Window and browser API objects can expose non-configurable properties.
  }

  try {
    Reflect.set(target, property, value);
  } catch {
    // The fatal CSP and window.stop remain the final browser-level boundary.
  }
}

function blockUnpatchedCodeAppNetwork(targetWindow: Window): void {
  const DisabledNetworkConstructor = function DisabledCodeAppNetwork(): never {
    throw networkDisabledError();
  };
  for (const property of ["EventSource", "SharedWorker", "WebSocket", "WebTransport", "Worker", "XMLHttpRequest"] as const) {
    lockProperty(targetWindow, property, DisabledNetworkConstructor);
  }

  lockProperty(targetWindow, "fetch", () => Promise.reject(networkDisabledError()));

  try {
    lockProperty(targetWindow.navigator, "sendBeacon", () => false);
    const serviceWorker = targetWindow.navigator.serviceWorker;
    if (serviceWorker) {
      lockProperty(serviceWorker, "register", () => Promise.reject(networkDisabledError()));
      if (serviceWorker.controller) {
        lockProperty(serviceWorker.controller, "postMessage", () => {
          throw networkDisabledError();
        });
      }
    }
  } catch {
    // Access to navigator or its service worker can itself be denied.
  }
}

function renderCodeAppFatalDocument(targetWindow: Window, failureDetail: string): void {
  const document = targetWindow.document;
  const head = document.head ?? document.createElement("head");
  const body = document.body ?? document.createElement("body");

  const policy = document.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", CODE_APP_FATAL_CSP);

  const style = document.createElement("style");
  style.textContent = `
    html, body { min-height: 100%; margin: 0; }
    body {
      display: grid;
      place-items: center;
      background: #0f1115;
      color: #f5f7fa;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      letter-spacing: 0;
    }
    body > :not([data-redeven-code-app-fatal]) { display: none !important; }
    [data-redeven-code-app-fatal] {
      box-sizing: border-box;
      width: min(42rem, calc(100% - 2rem));
      padding: 1.5rem;
      border-left: 4px solid #e5484d;
      background: #181b20;
    }
    h1 { margin: 0; font-size: 1rem; line-height: 1.5; overflow-wrap: anywhere; }
    code { display: block; margin-top: 0.75rem; color: #b8bec8; line-height: 1.5; overflow-wrap: anywhere; }
  `;

  const fatal = document.createElement("main");
  fatal.setAttribute("data-redeven-code-app-fatal", "true");
  fatal.setAttribute("role", "alert");
  fatal.setAttribute("aria-live", "assertive");

  const title = document.createElement("h1");
  title.textContent = CODE_APP_PROXY_BOOTSTRAP_FATAL_CODE;
  const detail = document.createElement("code");
  detail.textContent = failureDetail;
  fatal.append(title, detail);

  head.replaceChildren(policy, style);
  body.replaceChildren(fatal);
  document.documentElement.replaceChildren(head, body);
  document.title = CODE_APP_PROXY_BOOTSTRAP_FATAL_CODE;
}

function failClosedCodeAppBootstrap(error: unknown, targetWindow: Window = window): never {
  const detail = normalizedFailureMessage(error);
  const failure = new Error(`${CODE_APP_PROXY_BOOTSTRAP_FATAL_CODE}: ${detail}`, { cause: error });

  blockUnpatchedCodeAppNetwork(targetWindow);
  try {
    targetWindow.stop();
  } catch {
    // The remaining fatal boundaries still apply when window.stop is unavailable.
  }
  try {
    renderCodeAppFatalDocument(targetWindow, detail);
  } catch (renderError) {
    console.error(CODE_APP_PROXY_BOOTSTRAP_FATAL_CODE, "failed to render fatal document", renderError);
  }

  console.error(failure);
  throw failure;
}

function startCodeAppProxyRuntime(): void {
  let bridge: ReturnType<typeof registerCodeAppProxyBridge> | undefined;
  let webSocketPatch: ReturnType<typeof installWebSocketPatch> | undefined;
  try {
    bridge = registerCodeAppProxyBridge();

    // Native same-origin WebSockets must not be available after bridge registration.
    webSocketPatch = installWebSocketPatch({ runtime: bridge.runtime });

    patchServiceWorkerRegisterForCodeServer();
    installWebviewPreProxyFetchForwarder();
    void uninstallConflictingServiceWorkersBestEffort();

    window.addEventListener("pagehide", (event) => {
      // A bfcache entry resumes this same JavaScript realm. Keep its bridge alive so
      // the installed WebSocket patch cannot resume against a disposed runtime.
      if (event.persisted) return;
      bridge?.dispose();
    });
  } catch (error) {
    try {
      webSocketPatch?.uninstall();
    } catch {
      // The fatal path replaces all native network constructors below.
    }
    try {
      bridge?.dispose();
    } catch {
      // The startup error remains authoritative.
    }
    throw error;
  }
}

try {
  startCodeAppProxyRuntime();
} catch (error) {
  failClosedCodeAppBootstrap(error);
}
