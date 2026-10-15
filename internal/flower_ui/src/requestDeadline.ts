// The request may have reached storage before its response is lost. A deadline
// releases UI ownership without retrying the command or claiming cancellation.
export async function withFlowerRequestDeadline<T>(operation: () => Promise<T>, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(), new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutMessage)), 120_000);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
