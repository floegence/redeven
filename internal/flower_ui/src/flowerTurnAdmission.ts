import type {
  FlowerPermissionType,
  FlowerRuntimeCurrentView,
  FlowerTurnLaunchInput,
  FlowerTurnLaunchReceipt,
} from './contracts/flowerSurfaceContracts';

export type FlowerTurnAdmissionFailureKind = 'not_sent' | 'rejected' | 'unknown';

export class FlowerTurnAdmissionError extends Error {
  readonly admission_kind: FlowerTurnAdmissionFailureKind;
  readonly code?: string;
  readonly status?: number;
  readonly data?: unknown;

  constructor(kind: FlowerTurnAdmissionFailureKind, error: unknown, fallback: string) {
    const source = error && typeof error === 'object' ? error as Record<string, unknown> : null;
    const message = error instanceof Error
      ? error.message
      : String(error ?? '').trim() || fallback;
    super(message || fallback);
    this.name = 'FlowerTurnAdmissionError';
    this.admission_kind = kind;
    if (typeof source?.code === 'string' && source.code.trim()) this.code = source.code.trim();
    if (typeof source?.status === 'number' && Number.isFinite(source.status)) this.status = source.status;
    if (source && Object.prototype.hasOwnProperty.call(source, 'data')) this.data = source.data;
  }
}

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

export function flowerTurnAdmissionFailureKind(error: unknown): FlowerTurnAdmissionFailureKind {
  if (!error || typeof error !== 'object') return 'not_sent';
  const candidate = error as { admission_kind?: unknown; failureKind?: unknown };
  if (
    candidate.admission_kind === 'not_sent'
    || candidate.admission_kind === 'rejected'
    || candidate.admission_kind === 'unknown'
  ) {
    return candidate.admission_kind;
  }
  if (candidate.failureKind === 'transport_unknown') return 'unknown';
  if (candidate.failureKind === 'response') return 'rejected';
  return 'not_sent';
}

export function flowerTurnAdmissionError(
  kind: FlowerTurnAdmissionFailureKind,
  error: unknown,
  fallback = 'Flower turn request failed.',
): FlowerTurnAdmissionError {
  if (error instanceof FlowerTurnAdmissionError && error.admission_kind === kind) return error;
  return new FlowerTurnAdmissionError(kind, error, fallback);
}

export type FlowerTurnHTTPResponse = Readonly<{
  client_request_id?: unknown;
  thread_id?: unknown;
  current?: unknown;
}>;

export function buildFlowerTurnHTTPBody(input: Readonly<{
  launch: FlowerTurnLaunchInput;
  modelID: string;
  permissionType?: FlowerPermissionType;
  contextAction?: unknown;
  attachmentIDs: readonly string[];
  reasoningSelection?: unknown;
}>): Readonly<Record<string, unknown>> {
  const clientRequestID = trim(input.launch.client_request_id);
  const existingThreadID = trim(input.launch.thread_id);
  const modelID = trim(input.modelID);
  const permissionType = trim(input.permissionType);
  const workingDir = trim(input.launch.working_dir);
  const create = existingThreadID
    ? undefined
    : {
      client_request_id: clientRequestID,
      title: '',
      model_id: modelID,
      ...(permissionType ? { permission_type: permissionType } : {}),
      ...(input.reasoningSelection ? { reasoning_selection: input.reasoningSelection } : {}),
      ...(workingDir ? { working_dir: workingDir } : {}),
    };
  return {
    ...(input.launch.storage_generation ? { storage_generation: input.launch.storage_generation } : {}),
    ...(existingThreadID ? { client_request_id: clientRequestID } : {}),
    ...(input.launch.staging_scope ? { staging_scope_id: input.launch.staging_scope.staging_scope_id } : {}),
    ...(modelID ? { model: modelID } : {}),
    input: {
      text: input.launch.prompt,
      attachments: input.attachmentIDs.map((attachmentID) => ({ attachment_id: attachmentID })),
      ...(input.contextAction ? { context_action: input.contextAction } : {}),
    },
    options: {
      ...(permissionType ? { permission_type: permissionType } : {}),
      ...(input.reasoningSelection ? { reasoning_selection: input.reasoningSelection } : {}),
    },
    ...(create ? { create } : {}),
  };
}

function currentViewForThread(value: unknown, threadID: string): FlowerRuntimeCurrentView | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const current = value as Partial<FlowerRuntimeCurrentView>;
  const viewVersion = Number(current.view_version);
  if (trim(current.thread_id) !== threadID || !Number.isFinite(viewVersion) || viewVersion <= 0) {
    return undefined;
  }
  return current as FlowerRuntimeCurrentView;
}

export function normalizeFlowerTurnLaunchReceipt(
  response: FlowerTurnHTTPResponse,
  expected: Readonly<{ clientRequestID: string; existingThreadID?: string }>,
): FlowerTurnLaunchReceipt {
  const clientRequestID = trim(expected.clientRequestID);
  const existingThreadID = trim(expected.existingThreadID);
  const responseClientRequestID = trim(response.client_request_id);
  const responseThreadID = trim(response.thread_id);
  if (
    !clientRequestID
    || responseClientRequestID !== clientRequestID
    || !responseThreadID
    || (existingThreadID && responseThreadID !== existingThreadID)
  ) {
    throw flowerTurnAdmissionError(
      'unknown',
      new Error('Flower send returned an invalid acceptance receipt.'),
    );
  }
  const current = currentViewForThread(response.current, responseThreadID);
  return {
    client_request_id: clientRequestID,
    thread_id: responseThreadID,
    ...(current ? { current } : {}),
  };
}
