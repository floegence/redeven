import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const verifier=fileURLToPath(new URL('./verify_macos_desktop_update_package.sh',import.meta.url));
const publicKey='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
function verify(t,arch='arm64',failure='') {
  const root=mkdtempSync(join(tmpdir(),'redeven-mac-package-tools-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bin=join(root,'bin'), log=join(root,'commands');
  mkdirSync(bin); writeFileSync(join(root,'fixture.dmg'),'fixture');
  const tool=(name,body)=>writeFileSync(join(bin,name),`#!/bin/sh\nset -eu\nprintf '%s\\n' '${name}' >> "$FIXTURE_LOG"\n${body}\n`,{mode:0o755});
  tool('rg','echo "rg is unavailable on this runner" >&2; exit 127');
  tool('hdiutil',`if [ "$1" = attach ]; then
while [ "$1" != -mountpoint ]; do shift; done
root="$2/Redeven Desktop.app/Contents"
mkdir -p "$root/Frameworks/Sparkle.framework/Versions/Current" "$root/Resources/native"
touch "$root/Info.plist" "$root/Resources/native/redeven_sparkle.node"
fi`);
  tool('file','printf "Mach-O 64-bit %s\\n" "$FIXTURE_MACHINE"');
  tool('lipo','test "$1" = -verify_arch && test "$2" = "$FIXTURE_MACHINE"');
  tool('otool',`if [ "$1" = -L ]; then
printf '%s\\n' '@rpath/Sparkle.framework/Versions/B/Sparkle'
else
printf '%s\\n' '@loader_path/../../Frameworks'
# Readers must consume the entire producer output under pipefail.
i=0; while [ "$i" -lt 2048 ]; do
printf '%s\\n' 'load command padding with enough bytes to exceed a platform pipe buffer'
i=$((i+1))
done
fi`);
  tool('plutil',`if [ "$FIXTURE_FAILURE" = key ] && [ "$2" = SUPublicEDKey ]; then exit 1; fi
case "$2" in
SUPublicEDKey) if [ "$FIXTURE_FAILURE" = key ]; then echo mismatch; else echo "$FIXTURE_KEY"; fi ;;
SURequireSignedFeed|SUVerifyUpdateBeforeExtraction|SUEnableAutomaticChecks) echo true ;;
SUEnableSystemProfiling|SUAutomaticallyUpdate|SUAllowsAutomaticUpdates) echo false ;;
SUScheduledCheckInterval) echo 86400 ;;
SUFeedURL) echo "https://example.test/appcast-mac-$FIXTURE_ARCH.xml" ;;
*) exit 1 ;;
esac`);
  tool('codesign',`if [ "$FIXTURE_FAILURE" = signature ]; then exit 1; fi
if [ "$1" = -dv ]; then
if [ "$FIXTURE_FAILURE" = team ]; then echo 'TeamIdentifier=WRONGTEAM1' >&2; else echo 'TeamIdentifier=ABCDEFGHIJ' >&2; fi
if [ "$FIXTURE_FAILURE" = hardening ]; then echo 'flags=0x0' >&2; else echo 'flags=0x10000(runtime)' >&2; fi
fi`);
  tool('xcrun','test "$1" = stapler && test "$2" = validate && test "$FIXTURE_FAILURE" != stapling');
  tool('syspolicy_check','test "$1" = distribution && test "$FIXTURE_FAILURE" != policy');
  const result=spawnSync('/bin/bash',[verifier,'--dmg',join(root,'fixture.dmg'),'--arch',arch,'--expected-team-id','ABCDEFGHIJ','--sparkle-public-key',publicKey],{
    encoding:'utf8',env:{...process.env,PATH:`${bin}:/usr/bin:/bin`,FIXTURE_LOG:log,FIXTURE_KEY:failure==='key'?'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=':publicKey,FIXTURE_ARCH:arch,FIXTURE_MACHINE:arch==='x64'?'x86_64':arch,FIXTURE_FAILURE:failure},
  });
  return {...result,commands:readFileSync(log,'utf8').trim().split('\n')};
}

for(const arch of ['arm64','x64']) test(`macOS ${arch} package verification uses system tools without ripgrep`,t=>{
  const result=verify(t,arch);
  assert.equal(result.status,0,result.stderr);
  assert(!result.commands.includes('rg'));
  assert.equal(result.commands.filter(name=>name==='xcrun').length,2);
  assert(result.commands.includes('syspolicy_check'));
});
for(const failure of ['team','hardening','signature','stapling','policy']) test(`macOS package verification rejects ${failure} failure`,t=>{
  const result=verify(t,'arm64',failure);
  assert.notEqual(result.status,0);
  assert.equal(result.commands.at(-1),'hdiutil','mounted fixture must be detached on failure');
});
