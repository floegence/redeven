import assert from 'node:assert/strict';
import { readFile, open, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';

// Fixed paths exist only in the task container. A verified PID identifies the
// exact initial Runtime; neither process-name matching nor host input is used.
export function webtopRuntimeQualification() {
  assert.equal(process.platform, 'linux');
  const executable = '/qualification/bundle/redeven';
  const state = '/config/qualification-state';
  const pidFile = '/qualification/report/runtime.pid';
  const args = ['run', '--mode', 'local', '--state-root', state, '--local-ui-bind', '127.0.0.1:23998', '--presentation', 'machine'];
  let replacement;
  let exited;
  return {
    async restart() {
      const pid = Number((await readFile(pidFile, 'utf8')).trim());
      assert(Number.isSafeInteger(pid) && pid > 1);
      const cmdline = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
      assert.deepEqual(cmdline, [executable, ...args], 'refusing to stop an unverified Runtime');
      process.kill(pid, 'SIGTERM');
      const deadline = Date.now() + 30000;
      while (await readFile(`/proc/${pid}/cmdline`).then(() => true, (error) => {
        if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
        return false;
      })) {
        assert(Date.now() < deadline, 'initial Runtime did not exit');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const log = await open('/qualification/report/restarted-runtime.log', 'a');
      try {
        replacement = spawn(executable, args, { stdio: ['ignore', log.fd, log.fd] });
        exited = once(replacement, 'exit');
        await once(replacement, 'spawn');
      } finally { await log.close(); }
      await writeFile(pidFile, `${replacement.pid}\n`);
      const readinessDeadline = Date.now() + 30000;
      while (true) {
        assert.equal(replacement.exitCode, null, 'replacement Runtime exited during startup');
        try {
          await promisify(execFile)('/usr/bin/curl', ['--fail', '--silent', '--max-time', '2', '--cacert', `${state}/local-environment/local-ui-tls/device-ca.pem`, 'https://127.0.0.1:23998/_redeven_proxy/api/ai/threads']);
          break;
        } catch {
          assert(Date.now() < readinessDeadline, 'replacement Runtime was not ready');
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      await writeFile('/qualification/report/runtime-restart.json', JSON.stringify({ previous_pid: pid, replacement_pid: replacement.pid, state_preserved: true, ready: true }));
    },
    async close() {
      if (!replacement || replacement.exitCode !== null || replacement.signalCode !== null) return;
      replacement.kill('SIGTERM');
      const timer = setTimeout(() => replacement.kill('SIGKILL'), 10000);
      try { await exited; } finally { clearTimeout(timer); }
      assert.equal(replacement.signalCode, null, 'replacement Runtime required forced termination');
    },
  };
}
