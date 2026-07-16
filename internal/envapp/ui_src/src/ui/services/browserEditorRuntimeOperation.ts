import {
  createCodeRuntimeSetupOperation,
  fetchCodeRuntimeStatus,
  type BrowserEditorInstallMethod,
  type CodeRuntimeSetupOperation,
  type CodeRuntimeStatus,
} from './codeRuntimeApi';
import {
  BrowserEditorSetupError,
  browserEditorRuntimeFailureSource,
  browserEditorSetupError,
  type BrowserEditorSetupFailureSource,
} from './browserEditorSetupError';
import { LocalApiError } from './localApi';

export const CODE_RUNTIME_OPERATION_CONFLICT_ERROR_CODE = 'CODE_RUNTIME_OPERATION_CONFLICT';

export class BrowserEditorRuntimeCreateError extends BrowserEditorSetupError {
  readonly operationAbsenceConfirmed: boolean;

  constructor(error: unknown, operationAbsenceConfirmed: boolean) {
    super('runtime_status', error instanceof Error ? error.message : String(error));
    this.name = 'BrowserEditorRuntimeCreateError';
    this.operationAbsenceConfirmed = operationAbsenceConfirmed;
  }
}

export function browserEditorRuntimeOperationAbsenceConfirmed(error: unknown): boolean {
  return !(error instanceof BrowserEditorRuntimeCreateError) || error.operationAbsenceConfirmed;
}

export type BrowserEditorRuntimeOperationIdentity = Readonly<{
  operationID: string;
  installMethod: BrowserEditorInstallMethod;
}>;

export type BrowserEditorRuntimeOperationObserver = Readonly<{
  onOperationObserved?: (identity: BrowserEditorRuntimeOperationIdentity) => void;
  onRuntimeStatus?: (status: CodeRuntimeStatus) => void;
}>;

export type BrowserEditorRuntimeSetupStart =
  | Readonly<{ kind: 'created'; operation: CodeRuntimeSetupOperation }>
  | Readonly<{ kind: 'existing'; identity: BrowserEditorRuntimeOperationIdentity; status: CodeRuntimeStatus }>
  | Readonly<{ kind: 'blocked'; status: CodeRuntimeStatus; message: string }>;

export type BrowserEditorRuntimeSetupResult =
  | Readonly<{ state: 'succeeded'; ok: true; prepared: true; status: CodeRuntimeStatus }>
  | Readonly<{
    state: 'failed';
    ok: false;
    prepared: false;
    status: CodeRuntimeStatus;
    source: BrowserEditorSetupFailureSource;
    message: string;
  }>
  | Readonly<{ state: 'cancelled'; ok: false; prepared: false; cancelled: true; status?: CodeRuntimeStatus; message: string }>
  | Readonly<{ state: 'blocked'; ok: false; prepared: false; blocked: true; status: CodeRuntimeStatus; message: string }>;

export function browserEditorRuntimeOperationIdentity(
  status: CodeRuntimeStatus,
): BrowserEditorRuntimeOperationIdentity | null {
  const operation = status.operation;
  const operationID = String(operation.operation_id ?? '').trim();
  const installMethod = String(operation.install_method ?? '').trim();
  if (
    operation.action !== 'prepare_workspace_engine'
    || !operationID
    || (installMethod !== 'desktop_transfer' && installMethod !== 'remote_download')
  ) {
    return null;
  }
  return { operationID, installMethod };
}

function publishObservedOperation(
  observer: BrowserEditorRuntimeOperationObserver,
  status: CodeRuntimeStatus,
): BrowserEditorRuntimeOperationIdentity | null {
  observer.onRuntimeStatus?.(status);
  const identity = browserEditorRuntimeOperationIdentity(status);
  if (identity) observer.onOperationObserved?.(identity);
  return identity;
}

function shouldReconcileCreateError(error: unknown): boolean {
  return !(error instanceof LocalApiError) || (
    error.status === 409
    && error.code === CODE_RUNTIME_OPERATION_CONFLICT_ERROR_CODE
  );
}

export async function startOrReconcileBrowserEditorRuntimeOperation(args: Readonly<{
  operationID: string;
  installMethod: BrowserEditorInstallMethod;
  manifest?: unknown;
  signal?: AbortSignal;
  observer?: BrowserEditorRuntimeOperationObserver;
}>): Promise<BrowserEditorRuntimeSetupStart> {
  const observer = args.observer ?? {};
  try {
    const operation = await createCodeRuntimeSetupOperation({
      operationID: args.operationID,
      installMethod: args.installMethod,
      manifest: args.manifest,
      signal: args.signal,
    });
    if (operation.operation_id !== args.operationID || operation.install_method !== args.installMethod) {
      throw new Error('Runtime confirmed a different Browser Editor setup operation.');
    }
    observer.onOperationObserved?.({
      operationID: operation.operation_id,
      installMethod: operation.install_method,
    });
    return { kind: 'created', operation };
  } catch (error) {
    if (!shouldReconcileCreateError(error)) {
      throw new BrowserEditorRuntimeCreateError(error, true);
    }

    let status: CodeRuntimeStatus;
    try {
      status = await fetchCodeRuntimeStatus();
    } catch {
      throw new BrowserEditorRuntimeCreateError(error, false);
    }
    observer.onRuntimeStatus?.(status);
    const identity = browserEditorRuntimeOperationIdentity(status);
    const conflict = error instanceof LocalApiError
      && error.status === 409
      && error.code === CODE_RUNTIME_OPERATION_CONFLICT_ERROR_CODE;
    if (identity && (conflict || (
      identity.operationID === args.operationID
      && identity.installMethod === args.installMethod
    ))) {
      observer.onOperationObserved?.(identity);
      return { kind: 'existing', identity, status };
    }
    if (conflict && status.operation.state === 'running') {
      return {
        kind: 'blocked',
        status,
        message: error.message,
      };
    }
    throw new BrowserEditorRuntimeCreateError(error, true);
  }
}

export async function observeBrowserEditorRuntimeOperation(args: Readonly<{
  identity: BrowserEditorRuntimeOperationIdentity;
  initialStatus?: CodeRuntimeStatus;
  signal?: AbortSignal;
  observer?: BrowserEditorRuntimeOperationObserver;
}>): Promise<BrowserEditorRuntimeSetupResult> {
  const observer = args.observer ?? {};
  let status = args.initialStatus;
  for (;;) {
    if (args.signal?.aborted) {
      return {
        state: 'cancelled',
        ok: false,
        prepared: false,
        cancelled: true,
        ...(status ? { status } : {}),
        message: 'Browser Editor setup was canceled.',
      };
    }
    if (!status) {
      try {
        status = await fetchCodeRuntimeStatus();
      } catch {
        await waitForNextRuntimeStatus(args.signal);
        continue;
      }
    }
    const identity = publishObservedOperation(observer, status);
    if (
      !identity
      || identity.operationID !== args.identity.operationID
      || identity.installMethod !== args.identity.installMethod
    ) {
      throw browserEditorSetupError('runtime_status', 'The environment reported a different Browser Editor setup operation.');
    }
    const terminalResult = browserEditorRuntimeTerminalResult(status, identity);
    if (terminalResult) return terminalResult;
    await waitForNextRuntimeStatus(args.signal);
    status = undefined;
  }
}

export function browserEditorRuntimeTerminalResult(
  status: CodeRuntimeStatus,
  identity: BrowserEditorRuntimeOperationIdentity,
): BrowserEditorRuntimeSetupResult | null {
  const observedIdentity = browserEditorRuntimeOperationIdentity(status);
  if (
    !observedIdentity
    || observedIdentity.operationID !== identity.operationID
    || observedIdentity.installMethod !== identity.installMethod
  ) {
    throw browserEditorSetupError('runtime_status', 'The environment reported a different Browser Editor setup operation.');
  }
  switch (status.operation.state) {
    case 'succeeded':
      return { state: 'succeeded', ok: true, prepared: true, status };
    case 'failed': {
      const source = browserEditorRuntimeFailureSource(status.operation.last_error_code, identity.installMethod);
      return {
        state: 'failed',
        ok: false,
        prepared: false,
        status,
        source,
        message: status.operation.last_error || 'The environment could not install the Browser Editor.',
      };
    }
    case 'cancelled':
      return {
        state: 'cancelled',
        ok: false,
        prepared: false,
        cancelled: true,
        status,
        message: 'Browser Editor setup was canceled.',
      };
    default:
      return null;
  }
}

export function blockedBrowserEditorRuntimeSetupResult(
  start: Extract<BrowserEditorRuntimeSetupStart, { kind: 'blocked' }>,
): BrowserEditorRuntimeSetupResult {
  return {
    state: 'blocked',
    ok: false,
    prepared: false,
    blocked: true,
    status: start.status,
    message: start.message,
  };
}

function waitForNextRuntimeStatus(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(resolve, 750);
    signal?.addEventListener('abort', () => {
      globalThis.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
