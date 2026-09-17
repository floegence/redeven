import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import readline from 'node:readline';

// Invalid protocol requests exercise short and split JSONL frames without
// capturing windows, querying accessibility or injecting system input.
assert(process.platform === 'darwin' && process.argv[2], 'provide the built macOS helper');
const helper = spawn(process.argv[2], [], { stdio: ['pipe', 'pipe', 'ignore'] });
const exited = once(helper, 'exit');
const lines = readline.createInterface({ input: helper.stdout });
const iterator = lines[Symbol.asyncIterator]();
try {
  for (const split of [false, true]) {
    const request_id = split ? 'split-frame' : 'short-frame';
    const body = JSON.stringify({ protocol_version: 1, request_id, target_id: 'desktop-main', tool_name: 'computer.targets', args: {} }) + '\n';
    if (split) {
      helper.stdin.write(body.slice(0, 20));
      await new Promise(resolve => setImmediate(resolve));
      helper.stdin.write(body.slice(20));
    } else helper.stdin.write(body);
    let timer;
    try {
      const line = await Promise.race([iterator.next(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('helper must answer a JSONL frame before stdin closes')), 3000);
      })]);
      assert.equal(line.done, false);
      const response = JSON.parse(line.value);
      assert.equal(response.request_id, request_id);
      assert.equal(response.error_code, 'PROTOCOL_VERSION_MISMATCH');
    } finally { clearTimeout(timer); }
  }
  console.log('Native short and split JSONL requests passed with stdin open.');
} finally {
  lines.close(); helper.stdin.destroy();
  if (helper.exitCode === null && helper.signalCode === null) helper.kill('SIGTERM');
  let timer;
  try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => { helper.kill('SIGKILL'); reject(new Error('helper cleanup timed out')); }, 3000); })]); }
  finally { clearTimeout(timer); }
}
