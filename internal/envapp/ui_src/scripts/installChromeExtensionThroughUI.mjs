import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

// First-install acceptance uses Chrome's visible controls and the native folder
// picker. No load-extension flag, developerPrivate call or preinstalled profile.
export async function installChromeExtensionThroughUI(context, extension, extensionID) {
  assert.equal(process.platform, 'darwin', 'native folder-picker acceptance currently requires macOS');
  const browser = await context.browser().newBrowserCDPSession();
  const { processInfo } = await browser.send('SystemInfo.getProcessInfo');
  const pid = processInfo.find(value => value.type === 'browser')?.id;
  assert(Number.isSafeInteger(pid) && pid > 0, 'identify the exact test Chrome process');
  const { stdout: args } = await execute('/bin/ps', ['-p', String(pid), '-o', 'command=']);
  assert(!args.includes('--no-sandbox') && !args.includes('--load-extension'), 'installation must start with sandbox enabled and no preloaded extension');
  const page = await context.newPage(); await page.goto('chrome://extensions/');
  const card = page.locator(`extensions-item[id="${extensionID}"]`);
  assert.equal(await card.count(), 0, 'Flower must not be installed before the visible workflow');
  const developer = page.locator('extensions-toolbar #devMode');
  if (await developer.getAttribute('aria-pressed') !== 'true') await developer.click();
  await page.locator('extensions-toolbar #loadUnpacked').click();
  const quote = value => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
  try {
    await execute('/usr/bin/osascript', ['-e', `tell application "System Events"
      tell (first application process whose unix id is ${pid})
        set windowIndex to 1
        repeat with candidateIndex from 1 to count of windows
          if (count of sheets of window candidateIndex) > 0 then set windowIndex to candidateIndex as integer
        end repeat
        if (count of sheets of window windowIndex) is 0 then error "Chrome did not open the folder picker"
        perform action "AXRaise" of window windowIndex
        set frontmost to true
        delay 0.5
        set focused of sheet 1 of window windowIndex to true
        keystroke "g" using {command down, shift down}
        repeat 50 times
          if (count of sheets of sheet 1 of window windowIndex) > 0 then exit repeat
          delay 0.1
        end repeat
        set value of text field 1 of sheet 1 of sheet 1 of window windowIndex to ${quote(extension)}
        set focused of text field 1 of sheet 1 of sheet 1 of window windowIndex to true
        key code 36
        repeat 50 times
          if (count of sheets of sheet 1 of window windowIndex) is 0 then exit repeat
          delay 0.1
        end repeat
        click last button of splitter group 1 of sheet 1 of window windowIndex
      end tell
    end tell`], { timeout: 20000 });
  } catch (error) { throw new Error('Chrome native installation UI could not complete; check macOS Automation and Accessibility permission for this test runner.', { cause: error }); }
  await card.waitFor({ state: 'visible', timeout: 10000 });
  return page;
}
