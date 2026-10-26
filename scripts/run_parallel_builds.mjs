import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Each task owns a process group. Nested runners receive TERM first and get
// time to clean their groups before the outer runner escalates. No shell eval.
const tasks = [];
for (const value of process.argv.slice(2)) {
  if (value === '--task') tasks.push([]);
  else if (tasks.length) tasks.at(-1).push(value);
  else throw new Error('Expected --task <label> <executable> [arguments...]');
}
if (!tasks.length || tasks.some(task => task.length < 2)) throw new Error('Every build task needs a label and executable.');
const depth = Number(process.env.REDEVEN_BUILD_RUNNER_DEPTH || 0);
const groups = new Set();
let failure = 0;
let stopping = false;
let escalation;
function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
function stop(code) {
  if (stopping) return;
  stopping = true;
  failure = code;
  for (const pid of groups) signalGroup(pid, 'SIGTERM');
  // The timer also covers grandchildren that inherited output pipes after the
  // direct child exited. Keep it alive until every owned group has been killed.
  escalation = setTimeout(() => {
    for (const pid of groups) signalGroup(pid, 'SIGKILL');
  }, Math.max(500, 4000 / (depth + 1)));
}
process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));
const completed = tasks.map(([label, command, ...args]) => new Promise(resolve => {
  const started = performance.now();
  const child = spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, REDEVEN_BUILD_RUNNER_DEPTH: String(depth + 1) } });
  if (child.pid) groups.add(child.pid);
  for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    createInterface({ input: stream }).on('line', line => output.write('[' + label + '] ' + line + '\n'));
  }
  child.once('error', error => { console.error('[' + label + '] ' + error.message); stop(1); });
  child.once('exit', (code, signal) => {
    if (code !== 0 && !stopping) stop(code || (signal === 'SIGINT' ? 130 : 143));
  });
  child.once('close', code => {
    if (!stopping && child.pid) groups.delete(child.pid);
    console.error('[' + label + '] ' + (code === 0 ? 'Complete' : 'Stopped') + ': ' + ((performance.now() - started) / 1000).toFixed(1) + 's');
    resolve();
  });
}));
await Promise.all(completed);
// Successful children cannot retain running descendants; failed groups get one
// final cleanup even if all inherited streams happened to close early.
if (stopping) for (const pid of groups) signalGroup(pid, 'SIGKILL');
clearTimeout(escalation);
process.exitCode = failure;
