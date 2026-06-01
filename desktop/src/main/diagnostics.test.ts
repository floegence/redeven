import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DesktopDiagnosticsRecorder } from "./diagnostics";

describe("DesktopDiagnosticsRecorder", () => {
  it("records request timing with a shared trace header", async () => {
    const stateDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "redeven-desktop-diagnostics-"),
    );
    try {
      const recorder = new DesktopDiagnosticsRecorder();
      await recorder.configureRuntime(
        {
          local_ui_url: "http://127.0.0.1:23998/",
          local_ui_urls: ["http://127.0.0.1:23998/"],
          state_dir: stateDir,
          diagnostics_enabled: true,
        },
        "http://127.0.0.1:23998/",
      );

      const headers = recorder.startRequest({
        requestID: 7,
        method: "GET",
        url: "http://127.0.0.1:23998/api/local/runtime",
        requestHeaders: {},
      });
      expect(headers?.["X-Redeven-Debug-Trace-ID"]).toBeTypeOf("string");

      await recorder.completeRequest({
        requestID: 7,
        url: "http://127.0.0.1:23998/api/local/runtime",
        statusCode: 200,
        responseHeaders: headers,
      });

      const raw = await fs.readFile(
        path.join(stateDir, "diagnostics", "desktop-events.jsonl"),
        "utf8",
      );
      const lines = raw
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(
        lines.some(
          (line) =>
            line.scope === "desktop_http" && line.path === "/api/local/runtime",
        ),
      ).toBe(true);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("does not track requests when diagnostics mode is disabled", async () => {
    const stateDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "redeven-desktop-diagnostics-disabled-"),
    );
    try {
      const recorder = new DesktopDiagnosticsRecorder();
      await recorder.configureRuntime(
        {
          local_ui_url: "http://127.0.0.1:23998/",
          local_ui_urls: ["http://127.0.0.1:23998/"],
          state_dir: stateDir,
          diagnostics_enabled: false,
        },
        "http://127.0.0.1:23998/",
      );

      expect(
        recorder.startRequest({
          requestID: 1,
          method: "GET",
          url: "http://127.0.0.1:23998/api/local/runtime",
        }),
      ).toBeNull();
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("can store desktop diagnostics under a local override instead of the runtime state dir", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "redeven-desktop-diagnostics-override-"),
    );
    const runtimeStateDir = path.join(root, "remote-runtime-state");
    const desktopStateDir = path.join(root, "desktop-session-state");
    try {
      const recorder = new DesktopDiagnosticsRecorder();
      await recorder.configureRuntime(
        {
          local_ui_url: "http://127.0.0.1:23998/",
          local_ui_urls: ["http://127.0.0.1:23998/"],
          state_dir: runtimeStateDir,
          diagnostics_enabled: true,
        },
        "http://127.0.0.1:23998/",
        { stateDirOverride: desktopStateDir },
      );

      await recorder.recordLifecycle("opened", "desktop opened a session");

      await expect(
        fs.readFile(
          path.join(desktopStateDir, "diagnostics", "desktop-events.jsonl"),
          "utf8",
        ),
      ).resolves.toContain('"state_dir_source":"desktop_override"');
      await expect(fs.stat(runtimeStateDir)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("skips diagnostics API requests to avoid self-observation noise", async () => {
    const stateDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "redeven-desktop-diagnostics-self-requests-"),
    );
    try {
      const recorder = new DesktopDiagnosticsRecorder();
      await recorder.configureRuntime(
        {
          local_ui_url: "http://127.0.0.1:23998/",
          local_ui_urls: ["http://127.0.0.1:23998/"],
          state_dir: stateDir,
          diagnostics_enabled: true,
        },
        "http://127.0.0.1:23998/",
      );

      expect(
        recorder.startRequest({
          requestID: 9,
          method: "GET",
          url: "http://127.0.0.1:23998/_redeven_proxy/api/debug/diagnostics?limit=60",
        }),
      ).toBeNull();
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("skips static asset requests so the console stays focused on API and RPC traffic", async () => {
    const stateDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "redeven-desktop-diagnostics-static-assets-"),
    );
    try {
      const recorder = new DesktopDiagnosticsRecorder();
      await recorder.configureRuntime(
        {
          local_ui_url: "http://127.0.0.1:23998/",
          local_ui_urls: ["http://127.0.0.1:23998/"],
          state_dir: stateDir,
          diagnostics_enabled: true,
        },
        "http://127.0.0.1:23998/",
      );

      expect(
        recorder.startRequest({
          requestID: 10,
          method: "GET",
          url: "http://127.0.0.1:23998/_redeven_proxy/env/assets/index.css",
        }),
      ).toBeNull();

      expect(
        recorder.startRequest({
          requestID: 11,
          method: "GET",
          url: "http://127.0.0.1:23998/_redeven_proxy/env/assets/index.js",
        }),
      ).toBeNull();
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("does not track Gateway protocol routes even when the session URL shares the same origin", async () => {
    const stateDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "redeven-desktop-diagnostics-gateway-routes-"),
    );
    try {
      const recorder = new DesktopDiagnosticsRecorder();
      await recorder.configureRuntime(
        {
          local_ui_url: "https://gateway.example/session/env-app",
          local_ui_urls: ["https://gateway.example/session/env-app"],
          state_dir: stateDir,
          diagnostics_enabled: true,
        },
        "https://gateway.example/session/env-app",
      );

      expect(
        recorder.startRequest({
          requestID: 12,
          method: "POST",
          url: "https://gateway.example/gateway/v1/open-session",
          requestHeaders: {
            "x-redeven-request-signature": "signature-secret",
          },
        }),
      ).toBeNull();
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("redacts Gateway-sensitive lifecycle detail keys", async () => {
    const stateDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "redeven-desktop-diagnostics-gateway-redaction-"),
    );
    try {
      const recorder = new DesktopDiagnosticsRecorder();
      await recorder.configureRuntime(
        {
          local_ui_url: "https://gateway.example/session/env-app",
          local_ui_urls: ["https://gateway.example/session/env-app"],
          state_dir: stateDir,
          diagnostics_enabled: true,
        },
        "https://gateway.example/session/env-app",
      );

      await recorder.recordLifecycle("gateway_artifact_seen", "artifact received", {
        proof: "proof-secret",
        signature: "signature-secret",
        private_key: "PRIVATE KEY",
        artifact_nonce: "artifact-nonce-secret",
        connect_artifact: { url: "https://gateway.example/session?proof=secret" },
      });

      const raw = await fs.readFile(
        path.join(stateDir, "diagnostics", "desktop-events.jsonl"),
        "utf8",
      );
      expect(raw).toContain("[redacted]");
      expect(raw).not.toContain("proof-secret");
      expect(raw).not.toContain("signature-secret");
      expect(raw).not.toContain("PRIVATE KEY");
      expect(raw).not.toContain("artifact-nonce-secret");
      expect(raw).not.toContain("https://gateway.example/session?proof=secret");
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("can enable request tracking from a response header after startup began disabled", async () => {
    const stateDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "redeven-desktop-diagnostics-header-enable-"),
    );
    try {
      const recorder = new DesktopDiagnosticsRecorder();
      await recorder.configureRuntime(
        {
          local_ui_url: "http://127.0.0.1:23998/",
          local_ui_urls: ["http://127.0.0.1:23998/"],
          state_dir: stateDir,
          diagnostics_enabled: false,
        },
        "http://127.0.0.1:23998/",
      );

      expect(
        recorder.startRequest({
          requestID: 1,
          method: "GET",
          url: "http://127.0.0.1:23998/api/local/runtime",
        }),
      ).toBeNull();

      await recorder.completeRequest({
        requestID: 404,
        url: "http://127.0.0.1:23998/api/local/runtime",
        statusCode: 200,
        responseHeaders: { "X-Redeven-Debug-Console-Enabled": "true" },
      });

      const headers = recorder.startRequest({
        requestID: 2,
        method: "GET",
        url: "http://127.0.0.1:23998/api/local/runtime",
      });
      expect(headers?.["X-Redeven-Debug-Trace-ID"]).toBeTypeOf("string");
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
