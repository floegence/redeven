import { describe, expect, it } from 'vitest';

import {
  buildConsoleMessageDetail,
  buildPreloadErrorDetail,
  buildRenderProcessGoneDetail,
  buildWindowLifecycleContext,
  shouldCaptureElectronBootstrapConsoleMessage,
} from './windowLifecycleDiagnostics';

describe('windowLifecycleDiagnostics', () => {
  it('captures Electron bootstrap console warnings and errors', () => {
    expect(shouldCaptureElectronBootstrapConsoleMessage({
      level: 'warning',
      sourceId: 'node:electron/js2c/sandbox_bundle',
    })).toBe(true);

    expect(shouldCaptureElectronBootstrapConsoleMessage({
      level: 'error',
      sourceId: 'node:electron/js2c/preload_realm_bundle',
    })).toBe(true);
  });

  it('ignores non-Electron or low-severity console messages', () => {
    expect(shouldCaptureElectronBootstrapConsoleMessage({
      level: 'info',
      sourceId: 'node:electron/js2c/sandbox_bundle',
    })).toBe(false);

    expect(shouldCaptureElectronBootstrapConsoleMessage({
      level: 'error',
      sourceId: 'http://127.0.0.1:23998/assets/workbench.js',
    })).toBe(false);
  });

  it('builds context with webContents and frame metadata', () => {
    const topFrame = {
      frameToken: 'top-frame-token',
      name: 'top-frame',
      origin: 'http://127.0.0.1:23998',
      osProcessId: 45001,
      processId: 41,
      routingId: 1,
      url: 'http://127.0.0.1:23998/workbench',
    };
    const context = buildWindowLifecycleContext({
      role: 'session_root',
      surface: 'session',
      stateKey: 'session:demo',
      targetURL: 'http://127.0.0.1:23998/workbench',
      preloadPath: '/Applications/Redeven.app/Contents/Resources/app.asar/dist/preload.js',
      webContents: {
        id: 19,
        getURL: () => 'http://127.0.0.1:23998/workbench',
        mainFrame: {
          frameToken: 'main-frame-token',
          name: '',
          origin: 'http://127.0.0.1:23998',
          osProcessId: 45001,
          processId: 41,
          routingId: 1,
          top: topFrame,
          url: 'http://127.0.0.1:23998/workbench',
        },
      },
    });

    expect(context).toMatchObject({
      role: 'session_root',
      surface: 'session',
      state_key: 'session:demo',
      target_url: 'http://127.0.0.1:23998/workbench',
      current_url: 'http://127.0.0.1:23998/workbench',
      preload_path: '/Applications/Redeven.app/Contents/Resources/app.asar/dist/preload.js',
      webcontents_id: 19,
      main_frame_origin: 'http://127.0.0.1:23998',
      main_frame_process_id: 41,
      main_frame_frame_token: 'main-frame-token',
      top_frame_name: 'top-frame',
      top_frame_frame_token: 'top-frame-token',
    });
  });

  it('adds console, preload, and renderer-exit details on top of context', () => {
    const context = {
      role: 'launcher',
      surface: 'utility',
      webcontents_id: 3,
      target_url: 'http://127.0.0.1:23998/',
      current_url: 'http://127.0.0.1:23998/',
      preload_path: '/tmp/launcher-preload.js',
    };

    expect(buildConsoleMessageDetail(context, {
      frame: {
        frameToken: 'workbench-frame-token',
        name: 'workbench',
        origin: 'http://127.0.0.1:23998',
        osProcessId: 45001,
        processId: 41,
        routingId: 7,
        top: {
          frameToken: 'top-frame-token',
          name: '',
          origin: 'http://127.0.0.1:23998',
          osProcessId: 45001,
          processId: 41,
          routingId: 1,
          url: 'http://127.0.0.1:23998/workbench',
        },
        url: 'http://127.0.0.1:23998/workbench',
      },
      level: 'error',
      lineNumber: 2,
      message: 'Electron sandboxed_renderer.bundle.js script failed to run',
      sourceId: 'node:electron/js2c/sandbox_bundle',
    })).toMatchObject({
      console_level: 'error',
      console_line_number: 2,
      console_source_id: 'node:electron/js2c/sandbox_bundle',
      console_message: 'Electron sandboxed_renderer.bundle.js script failed to run',
      message_frame_name: 'workbench',
      message_frame_frame_token: 'workbench-frame-token',
      message_top_frame_frame_token: 'top-frame-token',
    });

    expect(buildPreloadErrorDetail(context, '/tmp/failing-preload.js', new TypeError('object null is not iterable'))).toMatchObject({
      preload_path: '/tmp/failing-preload.js',
      error_name: 'TypeError',
      error_message: 'object null is not iterable',
    });

    expect(buildRenderProcessGoneDetail(context, {
      exitCode: 139,
      reason: 'crashed',
    })).toMatchObject({
      reason: 'crashed',
      exit_code: 139,
    });
  });
});
