import type {
  FlowerRuntimeCurrentView,
  FlowerTurnLaunchReceipt,
} from './contracts/flowerSurfaceContracts';

type FlowerTurnResponse = Readonly<{
  client_request_id?: unknown;
  thread_id?: unknown;
  current?: unknown;
}>;

function trim(value: unknown): string {
  return String(value ?? '').trim();
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
  response: FlowerTurnResponse,
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
    throw new Error('Flower send returned an invalid acceptance receipt.');
  }
  const threadID = responseThreadID;
  const current = currentViewForThread(response.current, threadID);
  return {
    client_request_id: clientRequestID,
    thread_id: threadID,
    ...(current ? { current } : {}),
  };
}
