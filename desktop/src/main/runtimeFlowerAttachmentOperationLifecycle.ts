export type RuntimeFlowerAttachmentLifecycleSender = Readonly<{
  once(event: 'destroyed', listener: () => void): unknown;
  removeListener(event: 'destroyed', listener: () => void): unknown;
}>;

export type RuntimeFlowerAttachmentLifecycleOperation = {
	key: string;
	sender: RuntimeFlowerAttachmentLifecycleSender;
	settled: boolean;
	writeInFlight?: boolean;
	senderDestroyedListener?: () => void;
};

export function beginRuntimeFlowerAttachmentWrite(operation: RuntimeFlowerAttachmentLifecycleOperation): boolean {
	if (operation.settled || operation.writeInFlight === true) return false;
	operation.writeInFlight = true;
	return true;
}

export function endRuntimeFlowerAttachmentWrite(operation: RuntimeFlowerAttachmentLifecycleOperation): void {
	operation.writeInFlight = false;
}

export function finishRuntimeFlowerAttachmentOperation<Operation extends RuntimeFlowerAttachmentLifecycleOperation>(
  operations: Map<string, Operation>,
  operation: Operation,
): void {
  operation.settled = true;
  if (operations.get(operation.key) === operation) {
    operations.delete(operation.key);
  }
  const listener = operation.senderDestroyedListener;
  if (!listener) return;
  operation.sender.removeListener('destroyed', listener);
  operation.senderDestroyedListener = undefined;
}

export function trackRuntimeFlowerAttachmentOperation<Operation extends RuntimeFlowerAttachmentLifecycleOperation>(
  operations: Map<string, Operation>,
  operation: Operation,
  onSenderDestroyed: (operation: Operation) => void,
): void {
  if (operations.has(operation.key)) {
    throw new Error('A Flower attachment upload with this operation id is already active.');
  }
  const listener = (): void => {
    if (operations.get(operation.key) !== operation) return;
    try {
      onSenderDestroyed(operation);
    } finally {
      finishRuntimeFlowerAttachmentOperation(operations, operation);
    }
  };
  operation.senderDestroyedListener = listener;
  operations.set(operation.key, operation);
  operation.sender.once('destroyed', listener);
}
