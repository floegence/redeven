import fs from 'node:fs';
import path from 'node:path';
import { sha256, verifyBundledIconIntegrity } from './terminal_agent_icon_integrity.mjs';

const repository = 'https://github.com/glincker/thesvg';
const revision = 'bdfcb7cf0209c140f38afeb73ebccd432eff5c92';
const assetRoot = 'internal/flower_ui/src/assets/source-icons';
const licenses = {
  MIT: { file: 'assets/licenses/thesvg-MIT.txt', hash: '7a679e60d78db32455aea3b4613d2d3f3bec929edf8cbb608ccc40b37c663aed' },
  'CC0-1.0': { file: 'assets/licenses/CC0-1.0.txt', hash: 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499' },
};

export function collectFlowerSourceIconAssets(repoRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'assets/flower_source_icons.json'), 'utf8'));
  if (manifest.schema_version !== 1 || manifest.source?.repository !== repository
    || manifest.source?.revision !== revision || manifest.source?.license_metadata_path !== 'src/data/icons.json'
    || !Array.isArray(manifest.assets) || manifest.assets.length !== 27) {
    throw new Error('Flower source icons must use the reviewed pinned theSVG source and metadata');
  }
  const seen = new Set();
  const domains = new Set();
  const rows = manifest.assets.map(asset => {
    const license = licenses[asset.license];
    if (!license || asset.license_file !== license.file || asset.modified !== false
      || !/^[a-z][a-z0-9-]*[.]svg$/u.test(asset.file) || seen.has(asset.file)
      || !/^public[/]icons[/][a-z0-9-]+[/][a-z0-9-]+[.]svg$/u.test(asset.source_path)
      || typeof asset.label !== 'string' || typeof asset.monochrome !== 'boolean'
      || !Array.isArray(asset.domains) || !asset.domains.length) {
      throw new Error(`invalid Flower source icon provenance: ${asset.identity}`);
    }
    seen.add(asset.file);
    for (const domain of asset.domains) {
      if (!/^[a-z0-9-]+(?:[.][a-z0-9-]+)+$/u.test(domain) || domains.has(domain)) throw new Error(`invalid or duplicate source icon domain: ${domain}`);
      domains.add(domain);
    }
    verifyBundledIconIntegrity({ filePath: path.join(repoRoot, assetRoot, asset.file), bundledSha256: asset.sha256, upstreamSha256: asset.upstream_sha256, modified: asset.modified });
    return { label: asset.label, license: asset.license, source: `[${asset.source_path}](${repository}/blob/${revision}/${asset.source_path})`, file: assetRoot + '/' + asset.file, modified: asset.monochrome ? 'No; theme-aware alpha mask' : 'No' };
  });
  if (JSON.stringify(fs.readdirSync(path.join(repoRoot, assetRoot)).sort()) !== JSON.stringify([...seen].sort())) throw new Error('Flower source icon files must match their manifest exactly');
  const licenseNotices = Object.entries(licenses).map(([license, details]) => {
    const bytes = fs.readFileSync(path.join(repoRoot, details.file));
    if (sha256(bytes) !== details.hash) throw new Error(`source icon license hash mismatch: ${details.file}`);
    return { label: license === 'MIT' ? 'theSVG' : 'Creative Commons', license, text: bytes.toString('utf8').trim() };
  });
  return { rows, revision, metadataURL: `${repository}/blob/${revision}/src/data/icons.json`, licenseNotices };
}
