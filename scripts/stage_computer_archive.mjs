import { stageComputerResources } from './stage_computer_resources.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const destination = path.resolve(process.argv[2]);
const root = mkdtempSync(path.join(os.tmpdir(), 'redeven-computer-archive-'));
try {
  const suppliedResources = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : undefined;
  const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
  const resources = suppliedResources ? path.resolve(suppliedResources) : path.join(root, 'resources');
  if (!suppliedResources) stageComputerResources(resources, argument('--platform'), argument('--arch'));
  execFileSync('python3', ['-c', `
import pathlib,sys,zipfile
source=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
 for file in sorted(source.rglob('*')):
  if file.is_file(): archive.write(file,file.relative_to(source).as_posix())
`, resources, destination], { stdio: 'inherit' });
} finally { rmSync(root, { recursive: true, force: true }); }
