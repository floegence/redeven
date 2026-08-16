import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { installWebSocketPatchMock, registerProxyAppWindowMock } = vi.hoisted(() => ({
  installWebSocketPatchMock: vi.fn(),
  registerProxyAppWindowMock: vi.fn(),
}));

vi.mock("@floegence/flowersec-core/proxy", () => ({
  installWebSocketPatch: installWebSocketPatchMock,
  registerProxyAppWindow: registerProxyAppWindowMock,
}));

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  textContent = "";

  constructor(readonly tagName: string) {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }
}

class FakeDocument {
  readonly documentElement = new FakeElement("html");
  readonly head = new FakeElement("head");
  readonly body = new FakeElement("body");
  title = "Code Server";

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }
}

function elementText(element: FakeElement): string {
  return [element.textContent, ...element.children.map(elementText)].join("");
}

describe("Code App injection entry", () => {
  beforeEach(() => {
    vi.resetModules();
    installWebSocketPatchMock.mockReset();
    registerProxyAppWindowMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("fails closed before Code App starts when bridge bootstrap is missing", async () => {
    const document = new FakeDocument();
    const stop = vi.fn();
    const nativeFetch = vi.fn(async () => new Response("native response"));
    const NativeWebSocket = class {};
    const targetWindow = {
      document,
      location: {
        protocol: "https:",
        hostname: "app-demo.dev.redeven-online.test",
        port: "",
        origin: "https://app-demo.dev.redeven-online.test",
        href: "https://app-demo.dev.redeven-online.test/",
      },
      sessionStorage: {
        getItem: vi.fn(() => null),
      },
      navigator: {},
      fetch: nativeFetch,
      WebSocket: NativeWebSocket,
      stop,
      addEventListener: vi.fn(),
    } as unknown as Window;

    vi.stubGlobal("window", targetWindow);
    vi.stubGlobal("document", document);
    vi.stubGlobal("navigator", targetWindow.navigator);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(import("./inject")).rejects.toThrow(
      "REDEVEN_CODE_APP_PROXY_BOOTSTRAP_FAILED: invalid proxy bridge capability nonce",
    );

    expect(registerProxyAppWindowMock).not.toHaveBeenCalled();
    expect(installWebSocketPatchMock).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
    expect(document.title).toBe("REDEVEN_CODE_APP_PROXY_BOOTSTRAP_FAILED");
    expect(elementText(document.documentElement)).toContain("REDEVEN_CODE_APP_PROXY_BOOTSTRAP_FAILED");
    const [fatalHead] = document.documentElement.children;
    expect(fatalHead.children[0]?.attributes.get("content")).toContain("script-src 'none'");
    expect(fatalHead.children[0]?.attributes.get("content")).toContain("connect-src 'none'");
    const blockedWindow = targetWindow as unknown as { WebSocket: typeof WebSocket };
    expect(() => new blockedWindow.WebSocket("wss://example.test")).toThrow("Code App network is disabled");
    await expect(targetWindow.fetch("https://example.test")).rejects.toThrow("Code App network is disabled");
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledOnce();
  });

  test("keeps the proxy bridge alive across bfcache restoration", async () => {
    const document = new FakeDocument();
    const runtime = {};
    const dispose = vi.fn();
    const uninstall = vi.fn();
    let pageHideListener: ((event: PageTransitionEvent) => void) | undefined;
    const targetWindow = {
      document,
      location: {
        protocol: "https:",
        hostname: "app-demo.dev.redeven-online.test",
        port: "",
        origin: "https://app-demo.dev.redeven-online.test",
        href: "https://app-demo.dev.redeven-online.test/",
      },
      sessionStorage: {
        getItem: vi.fn((key: string) => {
          if (key === "redeven_app_bridge_capability_nonce") return "bridge-capability-123";
          if (key === "redeven_app_max_ws_frame_bytes") return String(32 * 1024 * 1024);
          return null;
        }),
      },
      navigator: {},
      WebSocket: class {},
      stop: vi.fn(),
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === "pagehide" && typeof listener === "function") {
          pageHideListener = listener as (event: PageTransitionEvent) => void;
        }
      }),
    } as unknown as Window;

    registerProxyAppWindowMock.mockReturnValue({ runtime, dispose });
    installWebSocketPatchMock.mockReturnValue({ uninstall });
    vi.stubGlobal("window", targetWindow);
    vi.stubGlobal("document", document);
    vi.stubGlobal("navigator", targetWindow.navigator);

    await import("./inject");

    expect(installWebSocketPatchMock).toHaveBeenCalledWith({ runtime });
    expect(pageHideListener).toBeTypeOf("function");

    pageHideListener?.({ persisted: true } as PageTransitionEvent);
    expect(dispose).not.toHaveBeenCalled();

    pageHideListener?.({ persisted: false } as PageTransitionEvent);
    expect(dispose).toHaveBeenCalledOnce();
    expect(uninstall).not.toHaveBeenCalled();
  });
});
