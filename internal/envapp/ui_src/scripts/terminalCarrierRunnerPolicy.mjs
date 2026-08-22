const chromiumReadPixelsDriverDiagnostic = /^\[\.WebGL-[^\]]+\]GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels(?: \(this message will no longer repeat\))?$/u;
// Local carrier runs intentionally omit plugin authorization; keep only these optional endpoints out of terminal smoke failures.
const optionalPluginPermissionFailure = /^https?:\/\/[^/]+\/_redevplugin\/api\/plugins\/(?:catalog\/query|runtime\/recover-enabled)$/u;

export function resolveTerminalCarrierBrowserMode(args = []) {
  const headlessRequested = args.includes('--headless');
  const headedRequested = args.includes('--headed');
  if (headlessRequested && headedRequested) {
    throw new Error('--headless and --headed cannot be used together');
  }
  return headedRequested
    ? { browserMode: 'headed', headless: false }
    : { browserMode: 'headless', headless: true };
}

export function classifyTerminalCarrierConsoleMessage(message) {
  const type = String(message?.type ?? '');
  const text = String(message?.text ?? '');
  const location = String(message?.location?.url ?? '');
  if (type !== 'warning' && type !== 'error') return 'ignore';
  if (type === 'error' && text.includes('403 (Forbidden)') && optionalPluginPermissionFailure.test(location)) {
    return 'expected_environment';
  }
  if (type === 'warning' && chromiumReadPixelsDriverDiagnostic.test(text)) {
    return 'browser_driver_diagnostic';
  }
  return 'renderer_problem';
}
