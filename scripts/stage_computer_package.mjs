import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

// A copied package retains its published layout and licenses. Source maps are
// debugging artifacts, not runtime resources. Never follow links outside it.
export function copyComputerPackage(source, destination, { mediaTarget } = {}) {
  const root = realpathSync(source);
  let selectedMedia;
  if (mediaTarget) {
    const { platform, arch } = mediaTarget;
    if (!['darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported media target');
    const metadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(path.join(root, 'dist/bin/manifest.json'), 'utf8'));
    const artifacts = manifest.artifacts?.filter(item => item.platform === platform && item.arch === arch);
    selectedMedia = `${platform}-${arch}/floebrowser-media`;
    if (manifest.version !== metadata.version || manifest.mediaWireVersion !== 1 || artifacts?.length !== 1 || artifacts[0].path !== selectedMedia) throw new Error('Published media manifest does not match target');
    const file = path.join(root, 'dist/bin', selectedMedia);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !realpathSync(file).startsWith(root + path.sep)) throw new Error('Published media helper must be a contained regular file');
    const bytes = readFileSync(file);
    if (bytes.length !== artifacts[0].bytes || createHash('sha256').update(bytes).digest('hex') !== artifacts[0].sha256) throw new Error('Published media helper failed integrity verification');
  }
  function copy(relative) {
    if (relative.endsWith('.map')) return;
    if (selectedMedia && relative.startsWith('dist/bin/')) {
      const name = relative.slice('dist/bin/'.length);
      if (name !== 'manifest.json' && name !== selectedMedia && !selectedMedia.startsWith(name + '/')) return;
    }
    const file = path.join(root, relative);
    const resolved = realpathSync(file);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('Package resource escapes published package');
    const stat = lstatSync(resolved);
    const target = path.join(destination, relative);
    if (stat.isDirectory()) {
      mkdirSync(target, { recursive: true });
      for (const name of readdirSync(resolved).sort()) copy(path.join(relative, name).split(path.sep).join('/'));
    } else if (stat.isFile()) {
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(resolved, target);
    } else throw new Error('Unsupported published package resource');
  }
  copy('');
  if (selectedMedia) copyFileSync(path.join(root, 'dist/bin/manifest.json'), path.join(destination, 'dist/bin/manifest.upstream.json'));
}
