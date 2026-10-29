import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { packageCenter, verifyCenterPackage, validateCenterReceipt } from './package_center_release.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
function fixture(root, target = 'linux/amd64') {
  const directory = path.join(root, 'package');
  mkdirSync(path.join(directory, 'ui'), {recursive:true});
  const binary = Buffer.alloc(64); binary.set([0x7f,0x45,0x4c,0x46,2,1]); binary.writeUInt16LE(target.endsWith('amd64')?62:183,18);
  const files = new Map([['redeven-center', binary], ['ui/index.html','<html></html>'],['.env','CENTER_VERSION=v1.2.3\n']]);
  for (const name of ['redeven-center.service','redeven-center-connector.service','center.env.example','Dockerfile','compose.yaml','LICENSE','THIRD_PARTY_NOTICES.md','DEPLOYMENT.md']) files.set(name, name);
  const manifest = {schema_version:'redeven.center.package.v1',version:'v1.2.3',base_commit:'a'.repeat(40),dirty:false,target:{GOOS:'linux',GOARCH:target.split('/')[1]},source_sha256:'c'.repeat(64),artifacts:[]};
  for (const [name,bytes] of files) { writeFileSync(path.join(directory,name),bytes,{mode:name==='redeven-center'?0o755:0o644}); manifest.artifacts.push({path:name,sha256:digest(bytes)}); }
  writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest));
  return {directory, manifest};
}
for (const target of ['linux/amd64','linux/arm64']) test('packages complete versioned '+target+' installation and receipt',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'center-package-'));
  try {
    const {directory}=fixture(root,target), output=path.join(root,'output');
    packageCenter(directory,output,'v1.2.3',target,'a'.repeat(40));
    const archive=readdirSync(output).find(name=>name.endsWith('.tar.gz'));
    const bytes=readFileSync(path.join(output,archive));
    const receipt=JSON.parse(readFileSync(path.join(output,archive+'.manifest.json')));
    assert.equal(validateCenterReceipt(receipt,{name:archive,sha256:digest(bytes),size:bytes.length},'v1.2.3',target),'a'.repeat(40));
    const names=execFileSync('tar',['-tzf',path.join(output,archive)],{encoding:'utf8'});
    for (const required of ['.env','ui/index.html','redeven-center-connector.service','DEPLOYMENT.md']) assert.ok(names.includes(required));
    assert.throws(()=>packageCenter(directory,output,'v1.2.3',target,'a'.repeat(40)),/already exists/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
for (const scenario of ['dirty','version','commit','target','extra','tampered','missing','symlink','architecture','compose-version']) test('rejects '+scenario+' Center packages before archiving',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'center-package-'));
 try {
  const {directory,manifest}=fixture(root);
  if(scenario==='dirty') manifest.dirty=true;
  if(scenario==='version') manifest.version='v1.2.4';
  if(scenario==='commit') manifest.base_commit='b'.repeat(40);
  if(scenario==='target') manifest.target.GOARCH='arm64';
  if(scenario==='extra') writeFileSync(path.join(directory,'private.key'),'not allowed');
  if(scenario==='tampered') writeFileSync(path.join(directory,'ui/index.html'),'tampered');
  if(scenario==='missing') rmSync(path.join(directory,'LICENSE'));
  if(scenario==='symlink') {rmSync(path.join(directory,'Dockerfile'));symlinkSync('LICENSE',path.join(directory,'Dockerfile'));}
  if(scenario==='architecture'||scenario==='compose-version') {
    const name=scenario==='architecture'?'redeven-center':'.env';
    const bytes=scenario==='architecture'?Buffer.alloc(64):Buffer.from('CENTER_VERSION=v9.9.9\n');
    writeFileSync(path.join(directory,name),bytes); manifest.artifacts.find(item=>item.path===name).sha256=digest(bytes);
  }
  writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest));
  assert.throws(()=>verifyCenterPackage(directory,'v1.2.3','linux/amd64','a'.repeat(40)),/Center/);
 }finally {rmSync(root,{recursive:true,force:true});}
});
test('release workflow requires Center artifacts in collection, signed checksums and publication',()=>{
 const source=readFileSync(new URL('../.github/workflows/release.yml',import.meta.url),'utf8');
 assert.match(source,/needs.center.result == 'success'/);
 assert.match(source,/name: center-linux-/);
 assert.match(source,/--pattern "center-\*"/);
 assert.match(source,/node scripts\/package_center_release.mjs/);
 for(const block of ['Generate checksums','Publish release assets']) {
   const section=source.slice(source.indexOf('- name: '+block)).split(/\n      - name:/)[0];
   assert.ok(section.includes('redeven-center_*.tar.gz'));
   assert.ok(section.includes('redeven-center_*.tar.gz.manifest.json'));
 }
});
