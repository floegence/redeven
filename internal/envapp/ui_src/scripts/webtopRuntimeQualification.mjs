import assert from 'node:assert/strict';
import { readFile, readdir, open, writeFile } from 'node:fs/promises';
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
  const args = ['run', '--mode', 'local', '--state-root', state, '--local-ui-bind', '127.0.0.1:23998', '--local-ui-protocol', 'https', '--presentation', 'machine'];
  let replacement;
  let exited;
  const verifiedRuntimePID = async () => {
    const pid = Number((await readFile(pidFile, 'utf8')).trim());
    assert(Number.isSafeInteger(pid) && pid > 1);
    const cmdline = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
    assert.deepEqual(cmdline, [executable, ...args], 'unverified qualification Runtime');
    return pid;
  };
  return {
    async desktopEnvironment() {
      const pid = await verifiedRuntimePID();
      // X11 sockets live in a short ephemeral directory, not durable product
      // state. Only the verified Runtime's children can identify that desktop.
      const children = new Set();
      for (const tid of await readdir(`/proc/${pid}/task`)) {
        const ids = await readFile(`/proc/${pid}/task/${tid}/children`, 'utf8').catch(error => {
          if (error.code === 'ENOENT' || error.code === 'ESRCH') return '';
          throw error;
        });
        for (const id of ids.trim().split(/\s+/u).filter(Boolean)) children.add(id);
      }
      const desktops = [];
      for (const child of children) {
        const command = await readFile(`/proc/${child}/cmdline`, 'utf8').catch(error => {
          if (error.code === 'ENOENT' || error.code === 'ESRCH') return '';
          throw error;
        });
        if (command !== '/usr/bin/openbox\0--sm-disable\0') continue;
        const environment = Object.fromEntries((await readFile(`/proc/${child}/environ`, 'utf8')).split('\0').filter(Boolean).map(entry => {
          const separator = entry.indexOf('='); return [entry.slice(0, separator), entry.slice(separator + 1)];
        }));
        assert.match(environment.DISPLAY ?? '', /^:\d+$/u);
        assert.match(environment.XDG_RUNTIME_DIR ?? '', /^\/tmp\/redeven-x11-[^/]+$/u);
        assert.equal(environment.XAUTHORITY, `${environment.XDG_RUNTIME_DIR}/Xauthority`);
        assert.equal(environment.DBUS_SESSION_BUS_ADDRESS, `unix:path=${environment.XDG_RUNTIME_DIR}/session-bus`);
        desktops.push(Object.fromEntries(['DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'NO_AT_BRIDGE', 'GTK_A11Y', 'QT_LINUX_ACCESSIBILITY_ALWAYS_ON'].map(key => [key, environment[key]])));
      }
      assert.equal(desktops.length, 1, 'expected this Runtime to own exactly one private X11 desktop');
      return desktops[0];
    },
    async restart() {
      const pid = await verifiedRuntimePID();
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
