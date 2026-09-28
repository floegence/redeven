import assert from 'node:assert/strict';
import path from 'node:path';

// The page runs real published controllers. Composition here is an explicitly
// simulated event sequence; application text receipts are real native values.
export async function checkNativeDesktopInput({page,read,waitFor,output,metadata,remote,quote,remoteRoot}) {
  const input=page.locator('.floe-remote-input');
  const shortcut=process.platform==='darwin'?'Meta':'Control';
  const point=async(y)=>page.locator('canvas').evaluate((canvas,y)=>{
    const rect=canvas.getBoundingClientRect(),scale=Math.min(rect.width/canvas.width,rect.height/canvas.height);
    return {x:rect.left+(rect.width-canvas.width*scale)/2+canvas.width*.25*scale,y:rect.top+(rect.height-canvas.height*scale)/2+y/480*canvas.height*scale};
  },y);
  const click=async(y)=>{const p=await point(y);await page.mouse.click(p.x,p.y);};
  const compose=text=>input.evaluate((element,text)=>{
    element.dispatchEvent(new CompositionEvent('compositionstart'));element.value=text;
    element.dispatchEvent(new InputEvent('input',{inputType:'insertCompositionText',data:text,isComposing:true}));
    element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true}));
    element.dispatchEvent(new CompositionEvent('compositionend',{data:text}));
    element.dispatchEvent(new InputEvent('input',{inputType:'insertText',data:text}));
    element.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter'}));
  },text);
  const unicode='中文日本語한글🙂👩🏽‍💻e\u0301𠮷';
  if(metadata.kind==='gnome'||metadata.kind==='package-editor') {
    const saved=()=>remote(`cat ${quote(metadata.document||remoteRoot+'/document.txt')}`);
    // Some editors serialize an implicit final newline. This explicit fixture
    // option qualifies that application policy; input itself is never changed.
    const serialized=text=>text+(metadata.save_newline==='append'||metadata.save_newline==='ensure'&&!text.endsWith('\n')?'\n':'');
    const save=async text=>{await page.keyboard.press(`${shortcut}+s`);await waitFor(()=>saved()===serialized(text),'Native editor did not save the exact UTF-8 bytes');};
    await click(150);await page.keyboard.type('abc');await save('abc');
    assert(await input.evaluate(element=>element===document.activeElement),'click lost editing focus');
    await compose(unicode);await compose(unicode);await page.keyboard.press('Enter');await compose('second line '+unicode);
    const text='abc'+unicode+unicode+'\nsecond line '+unicode;await save(text);
    await page.keyboard.press(`${shortcut}+a`);await compose('replaced '+unicode);await page.keyboard.press('Enter');
    const final='replaced '+unicode+'\n';await save(final);
    await page.locator('.mac-app-help').click();await page.keyboard.press('ArrowRight');assert.equal(saved(),serialized(final));
    await page.screenshot({path:path.join(output,'native-editor.png')});
    return {received:{document:serialized(final)},checks:['click then physical typing','repeated Unicode','text followed by Enter','selection replacement','actual Ctrl+S save','exact saved UTF-8 bytes','toolbar isolation']};
  }
  await click(150);await page.keyboard.type('abc');
  await waitFor(()=>read()[0]==='abc','Native click followed by typing failed');
  assert(await input.evaluate(element=>element===document.activeElement),'click lost editing focus');
  await compose(unicode);await compose(unicode);
  await waitFor(()=>read()[0]==='abc'+unicode+unicode,'Native repeated Unicode commit failed');
  await page.keyboard.type('abc');await page.keyboard.press('Backspace');
  await waitFor(()=>read()[0]==='abc'+unicode+unicode+'ab','Native deletion failed');
  await page.keyboard.press(`${shortcut}+a`);await compose('replace '+unicode);
  await waitFor(()=>read()[0]==='replace '+unicode,'Native selection replacement failed');
  // A browser layout may label a physical US key differently. These are
  // simulated layout events; delivery is still asserted in the native widget.
  await input.evaluate(element=>{
    element.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyY',bubbles:true,cancelable:true}));
    element.value='z';element.dispatchEvent(new InputEvent('input',{inputType:'insertText',data:'z',bubbles:true}));
    element.dispatchEvent(new KeyboardEvent('keyup',{key:'z',code:'KeyY',bubbles:true,cancelable:true}));
  });
  await waitFor(()=>read()[0]==='replace '+unicode+'z','Client layout character changed to a physical US key');
  await page.keyboard.press(`${shortcut}+a`);await compose('01234567890123456789');
  await page.keyboard.down('ArrowLeft');await page.waitForTimeout(1000);await page.keyboard.up('ArrowLeft');
  await page.keyboard.type('X');
  await waitFor(()=>read()[0].includes('X'),'Native held key operation did not complete');
  const repeated=read()[0];
  assert(repeated.indexOf('X')<18,'Native held arrow key did not repeat');
  await page.waitForTimeout(150);await page.keyboard.type('Y');
  await waitFor(()=>read()[0]===repeated.replace('X','XY'),'Native key release did not stop repeat');
  await page.keyboard.press(`${shortcut}+a`);await compose('replace '+unicode);
  await waitFor(()=>read()[0]==='replace '+unicode,'Native content restoration failed');
  await page.keyboard.press(`${shortcut}+a`);await page.keyboard.press(`${shortcut}+c`);
  await waitFor(()=>page.evaluate(()=>window.fixtureClipboardWrites>0),'Remote copy did not reach the client clipboard');
  await click(380);await page.keyboard.press(`${shortcut}+v`);
  await waitFor(()=>page.evaluate(()=>typeof window.fixturePastedText==='string'),'Browser did not deliver its clipboard paste');
  const pasted=await page.evaluate(()=>window.fixturePastedText);
  assert.equal(pasted.normalize('NFC'),('replace '+unicode).normalize('NFC'),'System clipboard changed the copied characters');
  await waitFor(()=>read()[1]===pasted,'Client paste did not reach the native application byte-for-byte');
  await page.keyboard.press(`${shortcut}+a`);
  await compose('第二个输入框');
  await waitFor(()=>read()[1]==='第二个输入框','Native second-field focus failed');
  const expected=read();
  await page.locator('.mac-app-help').click();await page.keyboard.press('ArrowRight');assert.deepEqual(read(),expected);
  await page.keyboard.press('Escape');await click(380);
  await page.screenshot({path:path.join(output,'native-viewer.png')});
  return {received:expected,clipboard:{copied:'replace '+unicode,pasted,systemNormalized:pasted!=='replace '+unicode},checks:['actual first-frame rendering','click then physical typing','exact repeated Unicode','deletion','selection replacement','simulated non-US layout','native held key repeat and release','real copy and paste','second field focus','toolbar isolation']};
}
