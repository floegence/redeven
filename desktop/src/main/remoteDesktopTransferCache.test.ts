import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { desktopTransferNames, desktopTransferProbeCommand, type DesktopTransferFile } from './remoteDesktopTransferCache';

const content = new Map(desktopTransferNames.map(name => [name, Buffer.from(`verified-${name}`)]));
const files: DesktopTransferFile[] = [...content].map(([name, data]) => ({ name, size: data.length, sha256: createHash('sha256').update(data).digest('hex') }));
describe('batched transfer cache commands', () => {
  it('uses a single fixed-size batch with no remote downloads or per-file SSH commands', () => {
    const script = desktopTransferProbeCommand(files);
    expect(script.match(/stage=\$\(mktemp/g)).toHaveLength(1);
    expect(script.match(/sha256sum -c/g)).toHaveLength(4);
    expect(script).not.toMatch(/curl|wget|find |sudo|\/proc\//);
  });
});
