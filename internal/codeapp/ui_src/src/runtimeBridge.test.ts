import { beforeEach, describe, expect, test, vi } from "vitest";

const { registerProxyAppWindowMock } = vi.hoisted(() => ({
  registerProxyAppWindowMock: vi.fn(),
}));

vi.mock("@floegence/flowersec-core/proxy", () => ({
  registerProxyAppWindow: registerProxyAppWindowMock,
}));

import {
  APP_BRIDGE_CAPABILITY_NONCE_STORAGE_KEY,
  APP_MAX_WS_FRAME_BYTES_STORAGE_KEY,
  MAX_WS_FRAME_BYTES,
  controllerOriginFromAppHost,
  registerCodeAppProxyBridge,
} from "./runtimeBridge";

function targetWindowWithStorage(values: Readonly<Record<string, string>> = {}): Window {
  return {
    location: {
      protocol: "https:",
      hostname: "app-demo.dev.redeven-online.test",
      port: "",
    },
    sessionStorage: {
      getItem: vi.fn((key: string) => values[key] ?? null),
    },
  } as unknown as Window;
}

describe("runtimeBridge", () => {
  beforeEach(() => {
    registerProxyAppWindowMock.mockReset();
    registerProxyAppWindowMock.mockReturnValue({
      runtime: {},
      dispose: vi.fn(),
    });
  });

  test("derives the controller origin from the app origin", () => {
    expect(
      controllerOriginFromAppHost({
        protocol: "https:",
        hostname: "app-demo.dev.redeven-online.test",
        port: "",
      }),
    ).toBe("https://rt-demo.dev.redeven-online.test");

    expect(
      controllerOriginFromAppHost({
        protocol: "https:",
        hostname: "app-demo.dev.redeven-online.test",
        port: "4443",
      }),
    ).toBe("https://rt-demo.dev.redeven-online.test:4443");
  });

  test("rejects invalid app origins", () => {
    expect(() =>
      controllerOriginFromAppHost({
        protocol: "https:",
        hostname: "rt-demo.dev.redeven-online.test",
        port: "",
      }),
    ).toThrow("invalid app host");
  });

  test("registers the cross-origin bridge with the derived controller origin", () => {
    const targetWindow = targetWindowWithStorage();

    const handle = registerCodeAppProxyBridge(targetWindow);
    expect(handle).toMatchObject({ runtime: {}, dispose: expect.any(Function) });
    expect(registerProxyAppWindowMock).toHaveBeenCalledWith({
      targetWindow,
      controllerOrigin: "https://rt-demo.dev.redeven-online.test",
      maxWsFrameBytes: MAX_WS_FRAME_BYTES,
    });
  });

  test("restores the bridge capability and runtime WebSocket limit after navigation", () => {
    const targetWindow = targetWindowWithStorage({
      [APP_BRIDGE_CAPABILITY_NONCE_STORAGE_KEY]: "bridge-capability-123",
      [APP_MAX_WS_FRAME_BYTES_STORAGE_KEY]: "16777216",
    });

    registerCodeAppProxyBridge(targetWindow);

    expect(registerProxyAppWindowMock).toHaveBeenCalledWith({
      targetWindow,
      controllerOrigin: "https://rt-demo.dev.redeven-online.test",
      capabilityNonce: "bridge-capability-123",
      maxWsFrameBytes: 16 * 1024 * 1024,
    });
  });

  test.each(["0", "-1", "1.5", " 1024", "67108864", "9007199254740992"])(
    "uses the product WebSocket limit when the stored value is invalid or too large: %s",
    (storedMaxWsFrameBytes) => {
      const targetWindow = targetWindowWithStorage({
        [APP_BRIDGE_CAPABILITY_NONCE_STORAGE_KEY]: "bridge-capability-123",
        [APP_MAX_WS_FRAME_BYTES_STORAGE_KEY]: storedMaxWsFrameBytes,
      });

      registerCodeAppProxyBridge(targetWindow);

      expect(registerProxyAppWindowMock).toHaveBeenCalledWith({
        targetWindow,
        controllerOrigin: "https://rt-demo.dev.redeven-online.test",
        capabilityNonce: "bridge-capability-123",
        maxWsFrameBytes: MAX_WS_FRAME_BYTES,
      });
    },
  );

  test("keeps the legacy bridge registration when session storage is unavailable", () => {
    const targetWindow = {
      location: {
        protocol: "https:",
        hostname: "app-demo.dev.redeven-online.test",
        port: "",
      },
      get sessionStorage(): Storage {
        throw new Error("storage unavailable");
      },
    } as unknown as Window;

    registerCodeAppProxyBridge(targetWindow);

    const options = registerProxyAppWindowMock.mock.calls[0]?.[0];
    expect(options?.targetWindow).toBe(targetWindow);
    expect(options).toMatchObject({
      controllerOrigin: "https://rt-demo.dev.redeven-online.test",
      maxWsFrameBytes: MAX_WS_FRAME_BYTES,
    });
    expect(options).not.toHaveProperty("capabilityNonce");
  });
});
