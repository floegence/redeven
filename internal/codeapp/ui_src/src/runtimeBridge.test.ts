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

function targetWindowWithStorage(values: Readonly<Record<string, string>> = {
  [APP_BRIDGE_CAPABILITY_NONCE_STORAGE_KEY]: "bridge-capability-123",
  [APP_MAX_WS_FRAME_BYTES_STORAGE_KEY]: String(MAX_WS_FRAME_BYTES),
}): Window {
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
      capabilityNonce: "bridge-capability-123",
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

  test.each(["", "0", "-1", "1.5", " 1024", "67108864", "9007199254740992"])(
    "rejects an invalid or oversized stored WebSocket limit: %s",
    (storedMaxWsFrameBytes) => {
      const targetWindow = targetWindowWithStorage({
        [APP_BRIDGE_CAPABILITY_NONCE_STORAGE_KEY]: "bridge-capability-123",
        [APP_MAX_WS_FRAME_BYTES_STORAGE_KEY]: storedMaxWsFrameBytes,
      });

      expect(() => registerCodeAppProxyBridge(targetWindow)).toThrow("invalid proxy bridge WebSocket frame limit");
      expect(registerProxyAppWindowMock).not.toHaveBeenCalled();
    },
  );

  test.each(["", " leading", "trailing ", "line\nbreak", "a".repeat(257)])(
    "rejects an invalid bridge capability nonce",
    (capabilityNonce) => {
      const targetWindow = targetWindowWithStorage({
        [APP_BRIDGE_CAPABILITY_NONCE_STORAGE_KEY]: capabilityNonce,
        [APP_MAX_WS_FRAME_BYTES_STORAGE_KEY]: String(MAX_WS_FRAME_BYTES),
      });

      expect(() => registerCodeAppProxyBridge(targetWindow)).toThrow("invalid proxy bridge capability nonce");
      expect(registerProxyAppWindowMock).not.toHaveBeenCalled();
    },
  );

  test("fails closed when session storage is unavailable", () => {
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

    expect(() => registerCodeAppProxyBridge(targetWindow)).toThrow("storage unavailable");
    expect(registerProxyAppWindowMock).not.toHaveBeenCalled();
  });
});
