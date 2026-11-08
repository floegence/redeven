import test from 'node:test';
import assert from 'node:assert/strict';
import { stageDesktopAccess, desktopAccessIdentity, desktopAccessInfo } from './stage_desktop_access.mjs';

test('desktop access uses a stable distinct application identity', () => {
  assert.deepEqual(desktopAccessIdentity(false), { name: 'Redeven Desktop Access', identifier: 'com.floegence.redeven.desktop-access' });
  assert.deepEqual(desktopAccessIdentity(true), { name: 'Redeven Desktop Access Dev', identifier: 'com.floegence.redeven.desktop-access.dev' });
  const info = desktopAccessInfo(true);
  assert.equal(info.CFBundleName, info.CFBundleDisplayName);
  assert.equal(info.CFBundleExecutable, 'redeven-computer-host');
  assert.equal(info.LSUIElement, true);
  assert.equal(info.CFBundlePackageType, 'APPL');
  assert.equal(info.LSEnvironment, undefined);
});

test('desktop access rejects ad-hoc or missing signing before creating files', () => {
  for (const identity of ['', '-']) assert.throws(() => stageDesktopAccess({binary: '/nonexistent/helper', destination: '/nonexistent/Desktop Access.app', icon: '/nonexistent/icon.icns', identity}), /Apple Development or Developer ID/);
  assert.equal(desktopAccessInfo(false, '1.2.3').CFBundleVersion, '1.2.3');
  assert.match(desktopAccessInfo(false).NSScreenCaptureUsageDescription, /choose to share/);
});

test('staged signed helper retains its resource seal when the enclosing app is signed', {skip: process.platform !== 'darwin' || !process.env.REDEVEN_DESKTOP_ACCESS_SIGNING_IDENTITY}, async t => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const {execFileSync} = await import('node:child_process');
  const {fileURLToPath} = await import('node:url');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-helper-signature-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outer = path.join(root, 'Container.app');
  const resources = path.join(outer, 'Contents/Resources');
  fs.mkdirSync(path.join(outer, 'Contents/MacOS'), {recursive:true});
  fs.mkdirSync(resources);
  fs.copyFileSync('/usr/bin/true', path.join(outer, 'Contents/MacOS/container'));
  const plist = path.join(outer, 'Contents/Info.plist');
  fs.writeFileSync(plist, JSON.stringify({CFBundleIdentifier:'com.floegence.fixture.container',CFBundleExecutable:'container',CFBundlePackageType:'APPL',CFBundleName:'Container',CFBundleVersion:'1'}));
  execFileSync('plutil', ['-convert','xml1',plist]);
  const helper = stageDesktopAccess({binary:'/usr/bin/true', destination:path.join(resources, 'Redeven Desktop Access Dev.app'),icon:path.join(source, 'desktop/build/desktop-access.icns')});
  const seal = fs.readFileSync(path.join(helper, 'Contents/_CodeSignature/CodeResources'));
  execFileSync('codesign', ['--force','--sign',process.env.REDEVEN_DESKTOP_ACCESS_SIGNING_IDENTITY,outer]);
  execFileSync('codesign', ['--verify','--deep','--strict',outer]);
  assert.deepEqual(fs.readFileSync(path.join(helper, 'Contents/_CodeSignature/CodeResources')),seal);
  const info = JSON.parse(execFileSync('plutil',['-convert','json','-o','-',path.join(helper,'Contents/Info.plist')],{encoding:'utf8'}));
  assert.equal(info.CFBundleIdentifier,desktopAccessIdentity(true).identifier);
  for (const locale of ['en-US','zh-CN','zh-TW','de-DE','fr-FR','es-ES','pt-BR','ja-JP','ko-KR','ru-RU']) assert.ok(fs.readFileSync(path.join(helper,`Contents/Resources/${locale}.lproj/InfoPlist.strings`),'utf8').includes('NSScreenCaptureUsageDescription'));
});
