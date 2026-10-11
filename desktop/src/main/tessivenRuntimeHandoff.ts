// Confirmation delegates to the original launcher operation. This helper owns
// no queue, progress state, authorization receipt, or retry behavior.
export async function completeTessivenRuntimeHandoff(input: {
  confirm: () => Promise<boolean>;
  pending: () => boolean;
  validate: () => Promise<void>;
  execute: () => Promise<void>;
  canceled: () => void;
  failed: () => void;
}): Promise<void> {
  try {
    if (!(await input.confirm()) || !input.pending()) {
      input.canceled();
      return;
    }
    await input.validate();
    if (!input.pending()) {
      input.canceled();
      return;
    }
    await input.execute();
  } catch {
    input.failed();
  }
}
