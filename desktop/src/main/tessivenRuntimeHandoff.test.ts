import { expect, it, vi } from 'vitest';
import { completeTessivenRuntimeHandoff } from './tessivenRuntimeHandoff';

function fixture() {
  let accept!: (value: boolean) => void;
  const input = {
    confirm: () =>
      new Promise<boolean>((resolve) => {
        accept = resolve;
      }),
    pending: () => true,
    validate: vi.fn(async () => {}),
    execute: vi.fn(async () => {}),
    canceled: vi.fn(),
    failed: vi.fn(),
  };
  return { input, accept: (value: boolean) => accept(value) };
}
it('does not close a conversation or start lifecycle before native acceptance', async () => {
  const { input, accept } = fixture();
  const completion = completeTessivenRuntimeHandoff(input);
  expect(input.validate).not.toHaveBeenCalled();
  expect(input.execute).not.toHaveBeenCalled();
  accept(true);
  await completion;
  expect(input.execute).toHaveBeenCalledTimes(1);
});
it('cancel leaves the Runtime untouched', async () => {
  const { input, accept } = fixture();
  const completion = completeTessivenRuntimeHandoff(input);
  accept(false);
  await completion;
  expect(input.execute).not.toHaveBeenCalled();
  expect(input.canceled).toHaveBeenCalledTimes(1);
});
it('revocation or a changed target after confirmation prevents execution', async () => {
  const { input, accept } = fixture();
  input.validate.mockRejectedValue(new Error('source revoked'));
  const completion = completeTessivenRuntimeHandoff(input);
  accept(true);
  await completion;
  expect(input.execute).not.toHaveBeenCalled();
  expect(input.failed).toHaveBeenCalledTimes(1);
});
it('original owner cancellation while validating prevents execution', async () => {
  const { input, accept } = fixture();
  let pending = true;
  input.pending = () => pending;
  input.validate.mockImplementation(async () => {
    pending = false;
  });
  const completion = completeTessivenRuntimeHandoff(input);
  accept(true);
  await completion;
  expect(input.execute).not.toHaveBeenCalled();
  expect(input.canceled).toHaveBeenCalledTimes(1);
});
