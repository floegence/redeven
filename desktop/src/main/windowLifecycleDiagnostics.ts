import type { RenderProcessGoneDetails } from 'electron';

type DiagnosticFrameLike = Readonly<{
  frameToken?: string | null;
  name?: string | null;
  origin?: string | null;
  osProcessId?: number | null;
  processId?: number | null;
  routingId?: number | null;
  top?: DiagnosticFrameLike | null;
  url?: string | null;
}>;

type DiagnosticWebContentsLike = Readonly<{
  id: number;
  getURL: () => string;
  mainFrame?: DiagnosticFrameLike | null;
}>;

type DiagnosticConsoleMessageLike = Readonly<{
  frame?: DiagnosticFrameLike | null;
  level: 'info' | 'warning' | 'error' | 'debug' | string;
  lineNumber: number;
  message: string;
  sourceId: string;
}>;

type WindowLifecycleContextInput = Readonly<{
  currentURL?: string;
  preloadPath: string;
  role: 'launcher' | 'session_root' | 'session_child';
  stateKey: string;
  surface: 'utility' | 'session';
  targetURL: string;
  webContents: DiagnosticWebContentsLike;
}>;

function cleanString(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text ? text : undefined;
}

function cleanNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeCurrentURL(webContents: DiagnosticWebContentsLike, preferredURL?: string): string | undefined {
  const direct = cleanString(preferredURL);
  if (direct) {
    return direct;
  }
  try {
    return cleanString(webContents.getURL());
  } catch {
    return undefined;
  }
}

function frameDetail(prefix: string, frame: DiagnosticFrameLike | null | undefined): Record<string, unknown> {
  if (!frame) {
    return {};
  }
  return {
    [`${prefix}_url`]: cleanString(frame.url),
    [`${prefix}_origin`]: cleanString(frame.origin),
    [`${prefix}_name`]: cleanString(frame.name),
    [`${prefix}_process_id`]: cleanNumber(frame.processId),
    [`${prefix}_routing_id`]: cleanNumber(frame.routingId),
    [`${prefix}_os_process_id`]: cleanNumber(frame.osProcessId),
    [`${prefix}_frame_token`]: cleanString(frame.frameToken),
  };
}

function consoleLevelName(level: DiagnosticConsoleMessageLike['level']): string {
  switch (level) {
    case 'debug':
      return 'debug';
    case 'info':
      return 'info';
    case 'warning':
      return 'warning';
    case 'error':
      return 'error';
    default:
      return 'unknown';
  }
}

export function buildWindowLifecycleContext(input: WindowLifecycleContextInput): Record<string, unknown> {
  const mainFrame = input.webContents.mainFrame ?? null;
  const topFrame = mainFrame?.top ?? mainFrame;
  return {
    role: input.role,
    surface: input.surface,
    state_key: cleanString(input.stateKey),
    target_url: cleanString(input.targetURL),
    current_url: safeCurrentURL(input.webContents, input.currentURL),
    preload_path: cleanString(input.preloadPath),
    webcontents_id: cleanNumber(input.webContents.id),
    ...frameDetail('main_frame', mainFrame),
    ...frameDetail('top_frame', topFrame),
  };
}

export function shouldCaptureElectronBootstrapConsoleMessage(
  details: Pick<DiagnosticConsoleMessageLike, 'level' | 'sourceId'>,
): boolean {
  if (details.level !== 'warning' && details.level !== 'error') {
    return false;
  }
  return String(details.sourceId ?? '').trim().startsWith('node:electron/js2c/');
}

export function buildConsoleMessageDetail(
  context: Record<string, unknown>,
  details: Pick<DiagnosticConsoleMessageLike, 'frame' | 'level' | 'lineNumber' | 'message' | 'sourceId'>,
): Record<string, unknown> {
  return {
    ...context,
    console_level: consoleLevelName(details.level),
    console_source_id: cleanString(details.sourceId),
    console_line_number: cleanNumber(details.lineNumber),
    console_message: cleanString(details.message),
    ...frameDetail('message_frame', details.frame),
    ...frameDetail('message_top_frame', details.frame?.top ?? details.frame),
  };
}

export function buildPreloadErrorDetail(
  context: Record<string, unknown>,
  preloadPath: string,
  error: Error,
): Record<string, unknown> {
  return {
    ...context,
    preload_path: cleanString(preloadPath) ?? cleanString(context.preload_path),
    error_name: cleanString(error?.name),
    error_message: cleanString(error?.message),
    error_stack: cleanString(error?.stack),
  };
}

export function buildRenderProcessGoneDetail(
  context: Record<string, unknown>,
  details: RenderProcessGoneDetails,
): Record<string, unknown> {
  return {
    ...context,
    reason: cleanString(details.reason),
    exit_code: cleanNumber(details.exitCode),
  };
}
