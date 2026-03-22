import { buildDesktopPreloads } from './desktopPreloadBundle';

async function main(): Promise<void> {
  await buildDesktopPreloads();
}

const isEntrypoint = typeof module !== 'undefined'
  && typeof require !== 'undefined'
  && require.main === module;

if (isEntrypoint) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
