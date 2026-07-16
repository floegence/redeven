import {
  cancelCodeRuntimeSetupOperation,
  type BrowserEditorInstallMethod,
  type CodeRuntimeStatus,
} from './codeRuntimeApi';
import {
  cancelWorkspaceEnginePreparation,
  desktopCodeWorkspacePrepareAvailable,
  prepareWorkspaceEngineWithDesktop,
} from './desktopCodeWorkspaceBridge';
import type { BrowserEditorSetupProgress } from './browserEditorSetupProgress';
import { browserEditorSetupError } from './browserEditorSetupError';
import {
  browserEditorRuntimeOperationAbsenceConfirmed,
  browserEditorRuntimeOperationIdentity,
  blockedBrowserEditorRuntimeSetupResult,
  observeBrowserEditorRuntimeOperation,
  startOrReconcileBrowserEditorRuntimeOperation,
  type BrowserEditorRuntimeOperationIdentity,
  type BrowserEditorRuntimeOperationObserver,
  type BrowserEditorRuntimeSetupResult,
} from './browserEditorRuntimeOperation';

export type BrowserEditorSetupResult = BrowserEditorRuntimeSetupResult;

export type BrowserEditorSetupOrchestrationPhase =
  | 'submitting'
  | 'desktop_preparation'
  | 'runtime_operation'
  | 'cancelling'
  | 'terminal';

export type BrowserEditorSetupOrchestrationSnapshot = Readonly<{
  requestedOperation: BrowserEditorRuntimeOperationIdentity;
  operation: BrowserEditorRuntimeOperationIdentity;
  operationObserved: boolean;
  phase: BrowserEditorSetupOrchestrationPhase;
  localProgress: BrowserEditorSetupProgress | null;
  runtimeStatus: CodeRuntimeStatus | null;
  result: BrowserEditorSetupResult | null;
}>;

export type BrowserEditorSetupOrchestrationOptions = Readonly<{
  operationID: string;
  installMethod: BrowserEditorInstallMethod;
  status?: CodeRuntimeStatus | null;
  onSnapshot?: (snapshot: BrowserEditorSetupOrchestrationSnapshot) => void;
}>;

export class BrowserEditorSetupOrchestration {
  private readonly requestedOperation: BrowserEditorRuntimeOperationIdentity;
  private readonly initialStatus: CodeRuntimeStatus | null | undefined;
  private readonly onSnapshot: ((snapshot: BrowserEditorSetupOrchestrationSnapshot) => void) | undefined;
  private readonly abortController = new AbortController();
  private readonly preparationSettled: Promise<void>;
  private settlePreparation!: () => void;
  private preparationDidSettle = false;
  private observedOperation: BrowserEditorRuntimeOperationIdentity | null = null;
  private localProgress: BrowserEditorSetupProgress | null = null;
  private runtimeStatus: CodeRuntimeStatus | null = null;
  private result: BrowserEditorSetupResult | null = null;
  private phase: BrowserEditorSetupOrchestrationPhase = 'submitting';
  private cancellationRequested = false;
  private cancellationPromise: Promise<void> | null = null;
  private runPromise: Promise<BrowserEditorSetupResult> | null = null;

  constructor(options: BrowserEditorSetupOrchestrationOptions) {
    this.requestedOperation = {
      operationID: options.operationID,
      installMethod: options.installMethod,
    };
    this.initialStatus = options.status;
    this.onSnapshot = options.onSnapshot;
    this.preparationSettled = new Promise((resolve) => {
      this.settlePreparation = resolve;
    });
    this.publish();
  }

  snapshot(): BrowserEditorSetupOrchestrationSnapshot {
    return {
      requestedOperation: this.requestedOperation,
      operation: this.observedOperation ?? this.requestedOperation,
      operationObserved: this.observedOperation !== null,
      phase: this.phase,
      localProgress: this.localProgress,
      runtimeStatus: this.runtimeStatus,
      result: this.result,
    };
  }

  isCancellationRequested(): boolean {
    return this.cancellationRequested;
  }

  run(): Promise<BrowserEditorSetupResult> {
    if (!this.runPromise) this.runPromise = this.execute();
    return this.runPromise;
  }

  async cancel(): Promise<void> {
    if (this.phase === 'terminal') return;
    if (!this.cancellationRequested) {
      this.cancellationRequested = true;
      this.phase = 'cancelling';
      this.abortController.abort();
      this.publish();
    }
    if (!this.cancellationPromise) this.cancellationPromise = this.performCancellation();
    await this.cancellationPromise;
  }

  private publish(): void {
    this.onSnapshot?.(this.snapshot());
  }

  private observeOperation(identity: BrowserEditorRuntimeOperationIdentity): void {
    if (
      this.observedOperation?.operationID === identity.operationID
      && this.observedOperation.installMethod === identity.installMethod
    ) {
      return;
    }
    this.observedOperation = identity;
    this.localProgress = null;
    if (!this.cancellationRequested) this.phase = 'runtime_operation';
    this.publish();
  }

  private observeRuntimeStatus(status: CodeRuntimeStatus): void {
    const identity = browserEditorRuntimeOperationIdentity(status);
    if (
      identity
      && this.observedOperation
      && (
        identity.operationID !== this.observedOperation.operationID
        || identity.installMethod !== this.observedOperation.installMethod
      )
    ) {
      throw browserEditorSetupError('runtime_status', 'The environment reported a different Browser Editor setup operation.');
    }
    this.runtimeStatus = status;
    this.localProgress = null;
    this.publish();
  }

  private observeLocalProgress(progress: BrowserEditorSetupProgress): void {
    if (this.observedOperation) return;
    this.localProgress = progress;
    if (!this.cancellationRequested) this.phase = 'desktop_preparation';
    this.publish();
  }

  private markPreparationSettled(): void {
    if (this.preparationDidSettle) return;
    this.preparationDidSettle = true;
    this.settlePreparation();
  }

  private async execute(): Promise<BrowserEditorSetupResult> {
    let setupResult: BrowserEditorSetupResult | null = null;
    let setupError: unknown;
    try {
      setupResult = await prepareBrowserEditorSetup({
        operationID: this.requestedOperation.operationID,
        installMethod: this.requestedOperation.installMethod,
        status: this.initialStatus,
        signal: this.abortController.signal,
        onProgress: (progress) => this.observeLocalProgress(progress),
        onOperationObserved: (identity) => this.observeOperation(identity),
        onRuntimeStatus: (status) => this.observeRuntimeStatus(status),
      });
    } catch (error) {
      setupError = error;
    } finally {
      this.markPreparationSettled();
    }

    if (this.cancellationRequested) {
      if (this.cancellationPromise) await this.cancellationPromise;
      setupResult = {
        state: 'cancelled',
        ok: false,
        prepared: false,
        cancelled: true,
        ...(this.runtimeStatus ? { status: this.runtimeStatus } : {}),
        message: 'Browser Editor setup was canceled.',
      };
    } else if (setupError !== undefined) {
      this.phase = 'terminal';
      this.publish();
      throw setupError;
    }

    if (!setupResult) {
      throw new Error('Browser Editor setup orchestration finished without a result.');
    }
    this.result = setupResult;
    this.phase = 'terminal';
    this.publish();
    return setupResult;
  }

  private async performCancellation(): Promise<void> {
    if (!this.observedOperation) await this.preparationSettled;
    if (this.observedOperation) {
      const status = await cancelBrowserEditorSetup(
        this.observedOperation.operationID,
        this.observedOperation.installMethod,
      );
      this.observeRuntimeStatus(status);
      return;
    }
    if (this.requestedOperation.installMethod !== 'desktop_transfer') return;
    const result = await cancelWorkspaceEnginePreparation(this.requestedOperation.operationID);
    if (!result.ok) {
      throw new Error(result.message || 'Desktop could not cancel Browser Editor package preparation.');
    }
  }
}

export function createBrowserEditorSetupOrchestration(
  options: BrowserEditorSetupOrchestrationOptions,
): BrowserEditorSetupOrchestration {
  return new BrowserEditorSetupOrchestration(options);
}

export { browserEditorRuntimeOperationAbsenceConfirmed };

export function defaultBrowserEditorInstallMethod(): BrowserEditorInstallMethod {
  return desktopCodeWorkspacePrepareAvailable() ? 'desktop_transfer' : 'remote_download';
}

export function browserEditorInstallMethodAvailable(method: BrowserEditorInstallMethod): boolean {
  return method === 'remote_download' || desktopCodeWorkspacePrepareAvailable();
}

export async function prepareBrowserEditorSetup(args: Readonly<{
  operationID: string;
  installMethod: BrowserEditorInstallMethod;
  status?: CodeRuntimeStatus | null;
  signal?: AbortSignal;
  onProgress?: (progress: BrowserEditorSetupProgress) => void;
  onOperationObserved?: (identity: BrowserEditorRuntimeOperationIdentity) => void;
  onRuntimeStatus?: (status: CodeRuntimeStatus) => void;
}>): Promise<BrowserEditorSetupResult> {
  const observer: BrowserEditorRuntimeOperationObserver = {
    onOperationObserved: args.onOperationObserved,
    onRuntimeStatus: args.onRuntimeStatus,
  };
  if (args.installMethod === 'desktop_transfer') {
    return prepareWorkspaceEngineWithDesktop({
      operationID: args.operationID,
      status: args.status,
      signal: args.signal,
      onProgress: args.onProgress,
      observer,
    });
  }

  let start;
  try {
    start = await startOrReconcileBrowserEditorRuntimeOperation({
      operationID: args.operationID,
      installMethod: 'remote_download',
      signal: args.signal,
      observer,
    });
  } catch (error) {
    throw browserEditorSetupError('runtime_status', error);
  }
  if (start.kind === 'blocked') return blockedBrowserEditorRuntimeSetupResult(start);
  const identity = start.kind === 'existing'
    ? start.identity
    : { operationID: start.operation.operation_id, installMethod: start.operation.install_method };
  return observeBrowserEditorRuntimeOperation({
    identity,
    ...(start.kind === 'existing' ? { initialStatus: start.status } : {}),
    signal: args.signal,
    observer,
  });
}

export async function cancelBrowserEditorSetup(
  operationID: string,
  installMethod: BrowserEditorInstallMethod,
): Promise<CodeRuntimeStatus> {
  const runtimeCancellation = cancelCodeRuntimeSetupOperation(operationID);
  const requests: Promise<unknown>[] = [runtimeCancellation];
  if (installMethod === 'desktop_transfer') {
    requests.push(cancelWorkspaceEnginePreparation(operationID).then((result) => {
      if (!result.ok) {
        throw new Error(result.message || 'Desktop could not cancel Browser Editor package preparation.');
      }
      return result;
    }));
  }
  const results = await Promise.allSettled(requests);
  const failures = results.flatMap((result) => (
    result.status === 'rejected'
      ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
      : []
  ));
  if (failures.length > 0) {
    throw new Error(failures.join(' '));
  }
  const status = await runtimeCancellation;
  if (
    status.operation.action !== 'prepare_workspace_engine'
    || status.operation.operation_id !== operationID
    || status.operation.install_method !== installMethod
    || status.operation.state !== 'cancelled'
  ) {
    throw new Error('The environment did not confirm cancellation of the requested Browser Editor setup operation.');
  }
  return status;
}
