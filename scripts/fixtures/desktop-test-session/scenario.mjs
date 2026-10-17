import { createDesktopTestSession } from '../../desktop_test_session.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
const [name, directory] = process.argv.slice(2);
const session = await createDesktopTestSession(import.meta.url, {
  timeoutMs: 3000,
  gracefulMs: 200,
  termMs: 200,
  killMs: 1000,
  reportFile: path.join(directory, 'result.json'),
});
await session.run(async () => {
  await session.defer('independent-service', null, {
    command: {
      file: process.execPath,
      args: ['-e', 'require("node:fs").writeFileSync(process.argv[1],"yes")', path.join(directory, 'cleaned')],
    },
  });
  if (name.startsWith('browser-')) {
    await session.launchBrowser(
      {
        launch: async () => {
          const childProcess = await import('node:child_process');
          const child = childProcess.default.spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
          if (name === 'browser-startup-error') throw new Error('browser startup failed after spawn');
          return { close: () => new Promise(() => {}) };
        },
      },
      {},
    );
    process.exit(3);
  }
  if (name === 'unexpected-child-exit') {
    await session.launchElectron(
      {
        launch: async () => {
          const { spawn } = await import('node:child_process');
          const child = spawn(process.execPath, ['-e', 'setTimeout(()=>process.exit(7),100)']);
          return {
            process: () => child,
            close: async () => {},
            evaluate: async () => {},
          };
        },
      },
      { executablePath: process.execPath },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    return;
  }
  if (name === 'startup-error') await session.spawn('/nonexistent-redeven-electron', []);
  const child = await session.spawn(process.execPath, [
    '-e',
    name === 'ignore-term' ? "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)" : 'setInterval(()=>{},1000)',
  ]);
  await session.setGracefulClose(
    child,
    name === 'hung-close' || name === 'ignore-term' ? () => new Promise(() => {}) : () => child.kill('SIGTERM'),
  );
  if (name === 'assertion') throw new Error('original assertion');
  if (name === 'cleanup-error')
    await session.defer('broken-service', () => {
      throw new Error('service stop failed');
    });
  await session.writeEvidence(path.join(directory, 'evidence.json'), {
    status: 'passed',
  });
  if (name === 'deadline') await new Promise(() => {});
  if (name === 'blocked-worker') {
    while (true) {}
  }
  if (name === 'command-timeout')
    await session.command('hung command', process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {
      timeoutMs: 200,
    });
  if (name === 'port-conflict') {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    await session.port(server.address().port);
  }
  if (name === 'worker-exit') process.exit(3);
  if (name === 'duplicate-interrupt') {
    process.kill(process.ppid, 'SIGTERM');
    process.kill(process.ppid, 'SIGINT');
    await new Promise(() => {});
  }
  await new Promise((resolve) => setTimeout(resolve, 80));
});
