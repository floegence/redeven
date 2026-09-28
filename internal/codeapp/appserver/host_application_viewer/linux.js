// Linux native protocol adapter. The released controllers own editing and
// gestures; the helper owns surfaces, ordering, clipboard and process lifetime.
(() => {
  const canvas = createHostApplicationCanvas();
  const chrome = createHostApplicationToolbar();
  const {controls, toolbar, menu, windowToggle, windowCount, keyboard, help, close, quit, popover,
    windowPanel, windowList, helpPanel, quitPanel, cancelQuit, confirmQuit} = chrome;
  const identity = document.createElement('div');
  identity.className = 'host-app-identity'; identity.append(...menu.childNodes);
  identity.querySelector('.mac-app-dropdown-chevron').remove(); menu.replaceWith(identity);
  chrome.menuPanel.remove();
  popover.append(windowPanel, helpPanel, quitPanel);
  const icon = document.getElementById('icon');
  if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(config.icon)) {
    icon.src = config.icon; icon.hidden = false; document.getElementById('fallback-icon').setAttribute('hidden', '');
    const image = document.createElement('img'); image.src = config.icon; image.alt = ''; image.className = 'mac-app-toolbar-icon';
    identity.querySelector('svg').replaceWith(image);
  }
  const feedback = document.createElement('div'); feedback.className = 'mac-app-feedback';
  feedback.setAttribute('role', 'status'); feedback.hidden = true; document.body.append(feedback);
  function notify(key) { hostApplicationAppearance.copy(feedback, key); feedback.hidden = false; }
  let socket, attempt = 0, serial = 0, connection = 0, current = null, painted = null, windows = [], abort, deadline;
  let established = false, attachmentEstablished = false, quitRequested = false, panel = null, binary = null;
  const pending = new Map(), held = new Map(), modifiers = new Set();
  let copying;
  function beginCopy(target) {
    copying?.reject();
    if(!navigator.clipboard?.write || !window.ClipboardItem){notify('clipboardUnavailable');return;}
    const transfer={target};copying=transfer;
    const content=new Promise((resolve,reject)=>{
      transfer.resolve=text=>resolve(new Blob([text],{type:'text/plain'}));
      transfer.reject=()=>reject(new Error('Clipboard target changed'));
    });
    void content.catch(()=>{});
    // Start permission handling in the actual shortcut gesture. The native
    // selection arrives asynchronously without losing browser user activation.
    navigator.clipboard.write([new ClipboardItem({'text/plain':content})]).catch(()=>{
      transfer.reject();
      if(valid(target))notify('clipboardUnavailable');
    });
  }
  let streamVersion = 0, receivedBytes = 0, paintedFrames = 0, measuredAt = performance.now(), paintTick;
  const picture = {mode:'auto'}, preferenceKey = 'redeven.native-app.picture.v1';
  try {
    const saved = localStorage.getItem(preferenceKey);
    if (['auto','clarity','smooth','data'].includes(saved)) picture.mode = saved;
  } catch { /* Picture preferences are optional in private browsing. */ }
  const picturePanel = document.createElement('section');
  picturePanel.tabIndex=-1; picturePanel.id = 'picture-settings'; picturePanel.className = 'mac-app-picture';
  hostApplicationAppearance.copy(picturePanel, 'picture', 'aria-label');
  const pictureTitle = document.createElement('strong');
  hostApplicationAppearance.copy(pictureTitle, 'picture'); picturePanel.append(pictureTitle);
  const {modes, modeButtons} = createHostApplicationPictureModes(picture, () => {
    try {localStorage.setItem(preferenceKey,picture.mode);} catch { /* Preferences are optional. */ }
    configurePicture();
  });
  picturePanel.append(modes);
  const pictureHint = document.createElement('p'); picturePanel.append(pictureHint);
  const statistics = document.createElement('div'); statistics.className = 'mac-app-picture-statistics';
  const statisticValues = {};
  for (const [key,title] of [['resolution','picturePixels'],['rate','pictureActualRate'],['bandwidth','pictureBandwidth'],['transport','pictureTransport']]) {
    const row = document.createElement('div'), label = document.createElement('span'), value = document.createElement('output');
    hostApplicationAppearance.copy(label,title); hostApplicationAppearance.copy(value,title,'aria-label'); value.textContent='—';
    statisticValues[key]=value; row.append(label,value); statistics.append(row);
  }
  hostApplicationAppearance.copy(statisticValues.transport,'pictureImages');
  picturePanel.append(statistics); popover.append(picturePanel);
  const statisticsTimer = setInterval(() => {
    const now=performance.now(), elapsed=(now-measuredAt)/1000;
    statisticValues.rate.textContent=`${hostApplicationAppearance.number(paintedFrames/elapsed,1)} FPS`;
    statisticValues.bandwidth.textContent=`${hostApplicationAppearance.number(receivedBytes*8/elapsed/1e6,2)} Mb/s`;
    paintedFrames=receivedBytes=0; measuredAt=now;
  },1000);
  function configurePicture() {
    if(streamVersion===2)request({method:'configure_stream',mode:picture.mode},reply=>{if(reply.error)notify('operationFailed');});
  }
  const toggles = {windows:windowToggle, picture:chrome.controlsButton, help, quit};
  const panels = {windows:windowPanel, picture:picturePanel, help:helpPanel, quit:quitPanel};
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || navigator.platform === 'MacIntel';
  const cursor = new FloeRemoteCursor(result => {canvas.style.cursor = result?.css || 'default';});
  const valid = target => target && target === current && target === painted && socket?.readyState === WebSocket.OPEN && document.body.dataset.state === 'active';
  function request(value, callback) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    if (pending.size >= 256) { disconnect('disconnected'); return false; }
    const id = ++serial; pending.set(id, {callback, target:current, method:value.method});
    socket.send(JSON.stringify({id, ...value})); return true;
  }
  function input(operation, target = current) {
    if (!valid(target)) return false;
    return request({method:'input', connection:target.connection, window:target.window, generation:target.generation, operation});
  }
  // DOM physical codes map once to the Linux evdev protocol. Held releases keep
  // their original mapping even if modifiers or keyboard layout change mid-key.
  const codes = {Escape:1, Minus:12, Equal:13, Backspace:14, Tab:15, BracketLeft:26, BracketRight:27,
    Enter:28, ControlLeft:29, Semicolon:39, Quote:40, Backquote:41, ShiftLeft:42, Backslash:43,
    Comma:51, Period:52, Slash:53, ShiftRight:54, NumpadMultiply:55, AltLeft:56, Space:57, CapsLock:58,
    NumLock:69, ScrollLock:70, NumpadSubtract:74, NumpadAdd:78, NumpadDecimal:83, IntlBackslash:86,
    F11:87, F12:88, IntlRo:89, KanaMode:93, Convert:92, NonConvert:94, NumpadEnter:96,
    ControlRight:97, NumpadDivide:98, PrintScreen:99, AltRight:100, Home:102, ArrowUp:103,
    PageUp:104, ArrowLeft:105, ArrowRight:106, End:107, ArrowDown:108, PageDown:109, Insert:110,
    Delete:111, AudioVolumeMute:113, AudioVolumeDown:114, AudioVolumeUp:115, Pause:119,
    IntlYen:124, MetaLeft:125, MetaRight:126, ContextMenu:127};
  ['Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0',
    'KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP', 'KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL',
    'KeyZ KeyX KeyC KeyV KeyB KeyN KeyM', 'F1 F2 F3 F4 F5 F6 F7 F8 F9 F10'].forEach((row, i) =>
    row.split(' ').forEach((code, j) => {codes[code] = [2,16,30,44,59][i] + j;}));
  Object.entries({Numpad7:71,Numpad8:72,Numpad9:73,Numpad4:75,Numpad5:76,Numpad6:77,Numpad1:79,Numpad2:80,Numpad3:81,Numpad0:82}).forEach(([key,value])=>{codes[key]=value;});
  const modifierNames = new Set(['ControlLeft','ControlRight','MetaLeft','MetaRight','ShiftLeft','ShiftRight','AltLeft','AltRight']);
  function syncModifiers(event,target,shift=event.shiftKey) {
    const next=new Set([shift&&42,event.altKey&&56,(isMac?event.metaKey:event.ctrlKey)&&29,(isMac?event.ctrlKey:event.metaKey)&&125].filter(Boolean));
    for(const code of modifiers)if(!next.has(code))input({kind:'key',code,pressed:false},target);
    for(const code of next)if(!modifiers.has(code))input({kind:'key',code,pressed:true},target);
    modifiers.clear();for(const code of next)modifiers.add(code);
  }
  const printable = {};
  for(const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')printable['Key'+letter]=[letter.toLowerCase(),letter];
  for(const [code,plain,shifted] of [['Space',' ',' '],['Backquote','`','~'],['Minus','-','_'],['Equal','=','+'],['BracketLeft','[','{'],['BracketRight',']','}'],['Backslash','\\','|'],['Semicolon',';',':'],['Quote',"'",'"'],['Comma',',','<'],['Period','.','>'],['Slash','/','?']])printable[code]=[plain,shifted];
  for(let i=0;i<10;i++)printable['Digit'+i]=[String(i),')!@#$%^&*('[i]];
  function key(key, target) {
    const name = key.code || key.key;
    syncModifiers(key,target);
    if(modifierNames.has(name))return;
    // The native seat has a fixed US keymap. A confirmed character from another
    // layout is text, never a differently labelled physical key on that map.
    if(key.pressed && Array.from(key.key).length===1 && !key.ctrlKey && !key.metaKey &&
      printable[name]?.[key.shiftKey?1:0]!==key.key) {
      held.set(name,0);input({kind:'text',text:key.key},target);return;
    }
    let code = held.get(name);
    if (key.pressed && !code) {
      code = codes[name];
      if (!code) {notify('operationFailed'); return;}
      held.set(name, code);
    }
    if (!code) {if(!key.pressed)held.delete(name);return;}
    // Native seat repeat owns a held key. Browser repeat notifications must not
    // introduce extra releases/presses on top of the toolkit's native repeat.
    if (key.pressed && key.repeat) return;
    input({kind:'key',code,pressed:key.pressed},target);
    if (!key.pressed) held.delete(name);
  }
  function shortcut(code, target) {
    const modifier = modifiers.has(29);
    if (!modifier) input({kind:'key',code:29,pressed:true},target);
    input({kind:'key',code,pressed:true},target); input({kind:'key',code,pressed:false},target);
    if (!modifier) input({kind:'key',code:29,pressed:false},target);
  }
  const binding = createHostApplicationCanvasInput({
    canvas, target:()=>current, isValid:valid,
    commitText(text,target) {input({kind:'text',text},target);}, sendKey:key,
    releaseInput(target) {
      held.clear();modifiers.clear();
      if (target === current && socket?.readyState === WebSocket.OPEN)
        request({method:'release_input',connection:target.connection,window:target.window,generation:target.generation});
    },
    // The controller releases exactly its held buttons through sendPointer.
    // Native scrolling has no adapter remainder; it must not release the seat's
    // keyboard state when a touch or wheel gesture ends.
    releasePointer() {},
    onKeyboardVisibilityChange(visible) {keyboard.setAttribute('aria-pressed',String(visible));},
    clipboard(event,target) {
      syncModifiers(event,target);
      const modifier = isMac ? event.metaKey : event.ctrlKey;
      if (event.shiftKey && event.key === 'Insert' || modifier && event.key.toLowerCase() === 'v') return true;
      if (modifier && ['c','x'].includes(event.key.toLowerCase())) {
        event.preventDefault(); beginCopy(target);shortcut(event.key.toLowerCase()==='c'?46:45,target); return true;
      }
      return false;
    },
    sendPointer(command,target) {
      if(!valid(target))return false;
      syncModifiers(command,target);
      const point = hostApplicationCanvasPoint(canvas,command);
      const position = {x:Math.min(canvas.width-1,point.x*canvas.width),y:Math.min(canvas.height-1,point.y*canvas.height)};
      if (command.kind==='move') return input({kind:'move',...position},target);
      if (command.kind==='down'||command.kind==='up') return input({kind:'button',...position,button:command.button,pressed:command.kind==='down'},target);
      if (command.kind==='scroll') return input({kind:'scroll',...position,dx:command.dx,dy:command.dy},target);
      return false;
    },
    activate:()=>collapse(),
  });
  binding.input.element.addEventListener('paste',event=>{
    event.preventDefault(); event.stopPropagation(); binding.pointer.flush();
    if (!valid(current) || !event.clipboardData || event.clipboardData.files.length) return;
    const target=current;
    // The native scheduler retires input and cancels following operations when
    // publication fails, so a failed paste cannot use the previous selection.
    input({kind:'clipboard',text:event.clipboardData.getData('text/plain')},target);
    shortcut(47,target);
  });
  const player = new FloeDesktopFrames({canvas,
    isValid:packet=>packet?.target===current && packet.attempt===attempt && socket?.readyState===WebSocket.OPEN,
    onResize:()=>binding.pointer.reset(),
    onPaint(packet) {
      statisticValues.resolution.textContent=`${packet.meta.width} × ${packet.meta.height}`;
      if(!paintTick)paintTick=requestAnimationFrame(()=>{paintTick=null;paintedFrames++;});
      painted=current; binding.input.bindTarget(current); canvas.setAttribute('aria-busy','false');
      request({method:'frame_ack',frame:packet.meta.sequence});
      established=attachmentEstablished=true; clearTimeout(deadline); present('active');
    },
    onError:()=>disconnect('failed'),
  });
  function invalidate() {
    copying?.reject();copying=null;
    binding.pointer.reset(); binding.input.bindTarget(null); held.clear(); player.invalidate();
    painted=null; binary=null; cursor.reset();
  }
  function present(state) {
    hostApplicationConnection.present(state);
    canvas.setAttribute('aria-hidden',String(state!=='active'));
    canvas.tabIndex=state==='active'?0:-1;
    controls.hidden=!window.redevenHostApplicationWindow && !['active','waiting','captureUnavailable'].includes(state);
    if (state!=='active') {binding.input.bindTarget(null); collapse();}
    syncChrome();
  }
  function syncChrome() {
    const available=['active','waiting','captureUnavailable'].includes(document.body.dataset.state);
    chrome.controlsButton.disabled=!available;
    for(const button of modeButtons.values())button.disabled=streamVersion!==2;
    hostApplicationAppearance.copy(pictureHint,streamVersion===2?'nativePictureHint':'pictureUpgradeHint');
    keyboard.disabled=!valid(current); help.disabled=!available; close.disabled=!valid(current);
    windowToggle.disabled=!available||!windows.length; quit.disabled=!available||!windows.length;
    windowCount.textContent=hostApplicationAppearance.number(windows.length); windowCount.hidden=windows.length<2;
    const title=windows.find(window=>window.window===current?.window)?.title||config.copy.windows;
    windowToggle.querySelector('span').textContent=title;
    windowToggle.title=`${config.copy.windows} · ${hostApplicationAppearance.number(windows.length)} — ${title}`;
    windowToggle.setAttribute('aria-label',windowToggle.title);
    for(const button of windowList.children) button.setAttribute('aria-pressed',String(Number(button.dataset.window)===current?.window));
    if(!toolbar.querySelector('button:not(:disabled)[tabindex="0"]')) {
      const first=toolbar.querySelector('button:not(:disabled)');
      for(const button of toolbar.querySelectorAll('button')) button.tabIndex=button===first?0:-1;
    }
  }
  function updateState(state, observation=false) {
    // The native registry retains minimized/unfocused windows and removes only
    // destroyed surfaces. An empty initial snapshot or unavailable capture is
    // not retirement evidence. This ends sharing, never the live application.
    if(observation && windows.length && !state.windows.length && state.state==='waiting' && (attachmentEstablished||quitRequested)) {
      const owner=socket, epoch=connection;
      queueMicrotask(()=>{
        if(socket===owner && connection===epoch && !windows.length && document.body.dataset.state==='waiting')disconnect('windowsClosed');
      });
    }
    windows=state.windows;
    const focused=document.activeElement?.dataset.window;
    windowList.replaceChildren();
    for(const item of windows) {
      const button=document.createElement('button'); button.dataset.window=String(item.window);
      const title=document.createElement('span'); title.textContent=item.title||document.title; button.title=title.textContent; button.append(title);
      button.insertAdjacentHTML('beforeend','<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>');
      button.onclick=()=>{binding.pointer.reset(); binding.input.reset(); request({method:'select_window',window:item.window}); collapse();};
      windowList.append(button); if(focused===button.dataset.window)button.focus({preventScroll:true});
    }
    if(!current || current.window!==state.window || current.generation!==state.generation || current.connection!==connection) {
      invalidate(); current=state.window?Object.freeze({connection,window:state.window,generation:state.generation}):null;
      canvas.setAttribute('aria-busy','true');
    }
    if(state.state!=='running')present(state.state==='waiting'?'waiting':'captureUnavailable');
    else if(!painted)present('waiting');
    syncChrome();
  }
  function positionPanel() {
    if(!panel)return;
    const viewport=hostApplicationViewport.readViewportSnapshot(window), anchor=toggles[panel].getBoundingClientRect();
    popover.style.left=`${Math.max(viewport.visible.left+8,Math.min(anchor.left,viewport.visible.right-popover.offsetWidth-8))+viewport.fixedOffset.left}px`;
  }
  function collapse(restore=false) {
    const toggle=toggles[panel]; panel=null; popover.hidden=true;
    for(const element of Object.values(panels))element.hidden=true;
    for(const button of Object.values(toggles))button.setAttribute('aria-expanded','false');
    if(restore&&!toggle?.disabled)toggle?.focus({preventScroll:true});
  }
  for(const [name,toggle] of Object.entries(toggles)) {
    toggle.setAttribute('aria-controls',popover.id); toggle.setAttribute('aria-expanded','false');
    toggle.onclick=()=>{
      const opening=panel!==name; binding.pointer.reset(); binding.input.reset(); collapse();
      if(!opening)return;
      panel=name; popover.dataset.section=name; popover.hidden=false; panels[name].hidden=false; toggle.setAttribute('aria-expanded','true'); positionPanel();
      (name==='windows'?windowList.querySelector('[aria-pressed="true"]')||windowList.querySelector('button'):name==='quit'?cancelQuit:name==='picture'?(streamVersion===2?modeButtons.get(picture.mode):picturePanel):helpPanel)?.focus();
    };
  }
  keyboard.onclick=()=>{const visible=!binding.keyboardVisible;collapse();binding.pointer.reset();binding.input.reset();binding.input.setKeyboardVisible(visible);};
  keyboard.addEventListener('mousedown',event=>event.preventDefault());
  controls.addEventListener('pointerdown',event=>{binding.pointer.reset();if(!keyboard.contains(event.target))binding.input.reset();},true);
  close.onclick=()=>{collapse();if(valid(current))request({method:'close_window',window:current.window});};
  cancelQuit.onclick=()=>collapse(true);
  confirmQuit.onclick=()=>{
    collapse(true); quitRequested=true;
    for(const window of windows.filter(window=>!window.parent))request({method:'close_window',window:window.window},event=>notify(event.error?'quitFailed':'quitPending'));
  };
  toolbar.addEventListener('focusin',event=>{for(const button of toolbar.querySelectorAll('button'))button.tabIndex=button===event.target?0:-1;});
  for(const list of [toolbar,windowList])list.addEventListener('keydown',event=>{
    const buttons=[...list.querySelectorAll('button:not(:disabled)')], index=buttons.indexOf(document.activeElement);
    const forward=list===toolbar?'ArrowRight':'ArrowDown', backward=list===toolbar?'ArrowLeft':'ArrowUp';
    const next=event.key===forward?buttons[(index+1)%buttons.length]:event.key===backward?buttons[(index-1+buttons.length)%buttons.length]:event.key==='Home'?buttons[0]:event.key==='End'?buttons.at(-1):null;
    if(next){event.preventDefault();next.focus();}
  });
  controls.addEventListener('focusout',event=>{if(event.relatedTarget&&!controls.contains(event.relatedTarget))collapse();});
  document.addEventListener('pointerdown',event=>{if(!controls.contains(event.target))collapse();},true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&panel){event.preventDefault();event.stopImmediatePropagation();collapse(true);}},true);
  function disconnect(state) {
    clearTimeout(deadline); abort?.abort(); invalidate(); socket?.close(); socket=null; current=null;
    pending.clear(); connection=0; streamVersion=0; windows=[]; receivedBytes=paintedFrames=0; measuredAt=performance.now();
    cancelAnimationFrame(paintTick);paintTick=null;statisticValues.resolution.textContent='—'; attachmentEstablished=false; feedback.hidden=true; present(state);
    hostApplicationConnection.dismissEnded(state,established,quitRequested);
  }
  async function connect() {
    const mine=++attempt; disconnect(established?'reconnecting':'connecting');
    abort=new AbortController();
    deadline=setTimeout(()=>{if(mine===attempt)disconnect('disconnected');},6000);
    try {
      const state=await hostApplicationConnection.read(abort.signal);
      if(mine!==attempt||abort.signal.aborted)return;
      if(!['starting','running'].includes(state.state)){disconnect(state.state);return;}
      clearTimeout(deadline);
      const url=new URL(config.base+'/_redeven_host_app/stream',location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';
      const ws=new WebSocket(url,['redeven-host-application-v1',state.password]);socket=ws;ws.binaryType='arraybuffer';serial=0;
      ws.onmessage=event=>{
        if(mine!==attempt||socket!==ws)return;
        try {
          receivedBytes+=typeof event.data==='string'?new TextEncoder().encode(event.data).byteLength:event.data.byteLength;
          if(event.data instanceof ArrayBuffer){
            const meta=binary; binary=null;
            if(!meta||event.data.byteLength!==meta.bytes)throw Error('Invalid native payload');
            if(meta.target!==current)return;
            if(meta.event==='frame')player.receive({bytes:event.data,meta:meta.frame,target:meta.target,attempt:mine});
            else cursor.receive({...meta.cursor,logicalWidth:meta.cursor.logical_width,logicalHeight:meta.cursor.logical_height,png:new Uint8Array(event.data)});
            return;
          }
          if(binary)throw Error('Missing native payload');
          const value=JSON.parse(event.data);
          if(value.id){
            const reply=pending.get(value.id); if(!reply)throw Error('Unknown reply');pending.delete(value.id);
            if(reply.target!==current)return;
            reply.callback?.(value);
            if(value.error){
              if(!['INPUT_TARGET_UNAVAILABLE','FRAME_TARGET_UNAVAILABLE','WINDOW_UNAVAILABLE'].includes(value.error)) {
                if(reply.method==='input')disconnect('inputUnavailable');
                else notify('operationFailed');
              }
            }
          }else if(value.event==='attached'){
            if(value.version!==1||connection||![0,2].includes(value.stream_version||0))throw Error('Unsupported native attachment');
            connection=value.connection;streamVersion=value.stream_version||0;updateState(value.state);configurePicture();
          }else if(value.event==='state'){
            if(value.connection!==connection)throw Error('Stale native state');updateState(value.state,true);
          }else if(value.event==='frame'||value.event==='cursor'){
            const meta=value.frame||value.cursor;
            const target=current&&meta.connection===connection&&meta.window===current.window&&meta.generation===current.generation?current:null;
            if(value.event==='cursor'&&meta.mode==='default'){cursor.reset();return;}
            if(value.event==='cursor'&&meta.mode==='hidden'){if(target)cursor.hide();return;}
            binary={...value,target};
          }else if(value.event==='clipboard'){
            const clipboard=value.clipboard;
            if(valid(current)&&clipboard.connection===connection&&clipboard.window===current.window&&clipboard.generation===current.generation){
              if(copying?.target===current){
                const transfer=copying;copying=null;
                if(clipboard.error){transfer.reject();notify('operationFailed');}else transfer.resolve(clipboard.text);
              }else if(clipboard.error)notify('operationFailed');
              // A new private seat starts without a selection. Attaching a
              // viewer must not erase the user's clipboard or request access.
              else if(clipboard.text) navigator.clipboard?.writeText(clipboard.text).catch(()=>notify('clipboardUnavailable'));
            }
          }else if(value.event==='capture_unavailable'||value.event==='unavailable'){invalidate();present('captureUnavailable');}
          else throw Error('Unsupported native event');
        }catch{disconnect('failed');}
      };
      ws.onclose=async()=>{
        if(mine!==attempt||socket!==ws)return;
        disconnect('checking');abort=new AbortController();const signal=abort.signal;
        deadline=setTimeout(()=>{if(mine===attempt&&!signal.aborted)disconnect('disconnected');},6000);
        try{const state=await hostApplicationConnection.read(signal);if(mine===attempt&&!signal.aborted)disconnect(['starting','running'].includes(state.state)?'disconnected':state.state);}
        catch{if(mine===attempt&&!signal.aborted)disconnect('disconnected');}
      };
    }catch{if(mine===attempt&&!abort?.signal.aborted)disconnect('disconnected');}
  }
  const stopViewport=hostApplicationViewport.observeViewport(window,viewport=>{
    binding.pointer.reset();Object.assign(document.body.style,hostApplicationViewport.viewportStyle(viewport));
    for(const axis of ['left','top','width','height'])document.body.style.setProperty(`--mac-viewport-${axis}`,document.body.style[axis]);positionPanel();
  });
  hostApplicationAppearance.subscribe(()=>{syncChrome();positionPanel();});
  window.addEventListener('beforeunload',()=>{attempt++;clearInterval(statisticsTimer);cancelAnimationFrame(paintTick);stopViewport();binding.dispose();player.invalidate();cursor.dispose();socket?.close();abort?.abort();clearTimeout(deadline);});
  document.getElementById('retry').onclick=()=>void connect();
  if(hostApplicationConnection.initial)present(hostApplicationConnection.initial);else void connect();
})();
