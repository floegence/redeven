import { beforeEach, describe, expect, test, vi } from "vitest";

const { registerProxyAppWindowMock } = vi.hoisted(() => ({
  registerProxyAppWindowMock: vi.fn(),
}));

vi.mock("@floegence/flowersec-core/proxy", () => ({
  registerProxyAppWindow: registerProxyAppWindowMock,
}));

import { MAX_WS_FRAME_BYTES, controllerOriginFromAppHost, registerCodeAppProxyBridge } from "./runtimeBridge";

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
    const targetWindow = {
      location: {
        protocol: "https:",
        hostname: "app-demo.dev.redeven-online.test",
        port: "",
      },
    } as unknown as Window;

    const handle = registerCodeAppProxyBridge(targetWindow);
    expect(handle).toMatchObject({ runtime: {}, dispose: expect.any(Function) });
    expect(registerProxyAppWindowMock).toHaveBeenCalledWith({
      targetWindow,
      controllerOrigin: "https://rt-demo.dev.redeven-online.test",
      maxWsFrameBytes: MAX_WS_FRAME_BYTES,
    });
  });
});
