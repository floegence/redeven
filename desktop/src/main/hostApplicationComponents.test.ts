import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HostApplicationComponents } from './hostApplicationComponents';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture(slow = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-native-relay-')); roots.push(root);
  const executable = path.join(root, 'runtime');
  await fs.writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs');const out=process.argv[process.argv.indexOf('--output')+1];fs.writeFileSync(require('node:path').join(require('node:path').dirname(out),'pid'),String(process.pid));console.log(JSON.stringify({received_bytes:8,expected_bytes:8}));setTimeout(()=>{fs.writeFileSync(out,'verified');},${slow ? 10000 : 5});\n`, { mode: 0o700 });
  return { manager: new HostApplicationComponents(() => executable, () => path.join(root, 'components')), root };
}
describe.skipIf(process.platform === 'win32')('Desktop component acquisition adapter', () => {
  it('delegates to the fixed Runtime and scopes chunk access to its initiating document', async () => {
    const { manager } = await fixture(); const events: unknown[] = [];
    expect(await manager.acquire(10, 'arm64', value => events.push(value))).toEqual({ ok: true, size: 8 });
    expect(events).toEqual([{ received_bytes: 8, expected_bytes: 8 }]);
    expect(await manager.read(11, 0)).toEqual({ ok: false });
    expect(await manager.read(10, -1)).toEqual({ ok: false });
    expect(Buffer.from((await manager.read(10, 0)).data!).toString()).toBe('verified');
    await manager.cancel(10); expect(await manager.read(10, 0)).toEqual({ ok: false });
  });
  it('cancels a reservation before filesystem preparation can start a process', async () => {
    const { manager, root } = await fixture(true);
    const acquisition = manager.acquire(10, 'amd64', () => {});
    await manager.cancel(10);
    expect(await acquisition).toEqual({ ok: false });
    expect((await fs.readdir(path.join(root, 'components'))).filter(name => name.startsWith('transfer-'))).toEqual([]);
  });
});

it.skipIf(process.platform === 'win32')('waits for the exact acquisition process to exit before cancellation completes', async () => {
 const { manager, root } = await fixture(true);
 let started!: () => void;
 const progress = new Promise<void>(resolve => { started = resolve; });
 const acquisition = manager.acquire(10, 'arm64', () => started());
 await progress;
 const directory = (await fs.readdir(path.join(root, 'components'))).find(name => name.startsWith('transfer-'))!;
 const pid = Number(await fs.readFile(path.join(root, 'components', directory, 'pid'), 'utf8'));
 await manager.cancel(10);
 expect(await acquisition).toEqual({ ok: false });
 expect(() => process.kill(pid, 0)).toThrow();
 expect(await manager.read(10, 0)).toEqual({ ok: false });
});
