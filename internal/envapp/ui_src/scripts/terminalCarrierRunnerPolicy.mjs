const chromiumReadPixelsDriverDiagnostic = /^\[\.WebGL-[^\]]+\]GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels(?: \(this message will no longer repeat\))?$/u;

export function classifyTerminalCarrierConsoleMessage(message) {
  const type = String(message?.type ?? '');
  const text = String(message?.text ?? '');
  if (type !== 'warning' && type !== 'error') return 'ignore';
  if (type === 'warning' && chromiumReadPixelsDriverDiagnostic.test(text)) {
    return 'browser_driver_diagnostic';
  }
  return 'renderer_problem';
}
