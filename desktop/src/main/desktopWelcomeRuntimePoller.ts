/** Runtime probes deduplicate per target in the health store. A slow Cloud
 * observation must never hold the next tick's local or managed Runtime probes. */
export class DesktopWelcomeRuntimePoller {
  private cloudTask: Promise<void> | null = null;

  constructor(
    private readonly refreshRuntime: (options: Readonly<{ force: true }>) => Promise<void>,
    private readonly refreshCloud: () => Promise<void>,
  ) {}

  async poll(): Promise<void> {
    const runtime = this.refreshRuntime({ force: true });
    if (!this.cloudTask) {
      this.cloudTask = this.refreshCloud().catch(() => undefined).finally(() => { this.cloudTask = null; });
    }
    await runtime;
  }
}
