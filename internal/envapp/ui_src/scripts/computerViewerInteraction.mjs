import assert from 'node:assert/strict';

export async function qualifyComputerLauncherTouch({ page, root = page }) {
  const viewport = page.viewportSize();
  const session = await page.context().newCDPSession(page);
  const stage = root.locator('.flower-computer-stage');
  try {
    await root.locator('[data-floe-floating-window-control="close"]').click();
    await stage.waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 390, height: 740 });
    await session.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 2, mobile: false });
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const ball = root.locator('.flower-computer-stage-ball');
    await ball.waitFor({ state: 'visible' });
    await page.waitForTimeout(100);
    assert.equal(await ball.evaluate(element => element.ownerDocument.defaultView.devicePixelRatio), 2);
    const before = await ball.boundingBox(); assert(before);
    const start = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x - 70, y: start.y - 80 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(50);
    assert.equal(await stage.count(), 0, 'touch drag must not restore the window');
    const after = await ball.boundingBox(); assert(after);
    assert(Math.abs(before.x - after.x) > 4 || Math.abs(before.y - after.y) > 4, 'touch drag must move the launcher');
    assert(after.x >= 0 && after.y >= 0 && after.x + after.width <= 391 && after.y + after.height <= 741, 'launcher must remain visible on a narrow high-DPI screen');
    await ball.press('Enter');
    await stage.waitFor();
    return { deviceScaleFactor: 2, touch: true, width: 390 };
  } finally {
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await session.send('Emulation.clearDeviceMetricsOverride');
    await session.detach();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    if (viewport) await page.setViewportSize(viewport);
  }
}

// Runs against real browser input, also reused by the built Flower qualification.
export async function qualifyComputerViewer({ page, root = page, output }) {
  const stage = root.locator('.flower-computer-stage');
  const boxOf = locator => locator.evaluate(element => element.getBoundingClientRect().toJSON());
  const viewer = root.locator('[data-floe-geometry-surface="floating-window"]').filter({ has: stage });
  const grip = viewer.locator('[data-floe-floating-window-titlebar="true"]');
  const content = stage.locator('[data-floe-floating-window-content="true"]');
  const pixels = () => stage.locator('img').evaluate(img => img.complete && img.naturalWidth > 0 && img.src.startsWith('blob:'));
  assert(await pixels(), 'viewer requires decoded pixels before interaction');
  await grip.click({ trial: true });
  const initial = await boxOf(viewer);
  assert(initial, 'native FloatingWindow geometry is unavailable');
  const drag = async (handle, dx, dy) => {
    const box = await handle.boundingBox(); assert(box);
    const local = await boxOf(handle);
    const scaleX = box.width / local.width; const scaleY = box.height / local.height;
    const x = box.x + box.width / 2; const y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx * scaleX, y + dy * scaleY, { steps: 12 }); await page.mouse.up();
  };
  await drag(grip, -60, -40);
  const moved = await boxOf(viewer);
  assert(moved);
  assert(Math.abs(moved.x - initial.x + 60) < 2 && Math.abs(moved.y - initial.y + 40) < 2, `viewer must follow pointer in client coordinates: ${JSON.stringify({ initial, moved })}`);

  const resize = viewer.locator('[data-floe-floating-window-resize-handle="se"]');
  await drag(resize, -80, -60);
  const resized = await boxOf(viewer);
  assert(resized && resized.width < moved.width && resized.height < moved.height, `native resize must change viewer geometry: ${JSON.stringify({ moved, resized })}`);
  const imageLayout = await stage.locator('img').evaluate((image) => {
    const frame = image.closest('.flower-computer-stage-frame-wrap').getBoundingClientRect();
    const rect = image.getBoundingClientRect();
    return { fit: image.ownerDocument.defaultView.getComputedStyle(image).objectFit, width: rect.width, height: rect.height, frameWidth: frame.width, frameHeight: frame.height };
  });
  assert(imageLayout.fit === 'contain' && Math.abs(imageLayout.width - imageLayout.frameWidth) < 2
    && Math.abs(imageLayout.height - imageLayout.frameHeight) < 2, 'image must follow the resized content box without cropping');

  await viewer.locator('[data-floe-floating-window-control="close"]').click();
  const ball = root.locator('.flower-computer-stage-ball');
  const settleBall = () => ball.evaluate(async element => {
    const animations = [...element.getAnimations({ subtree: true }), ...element.parentElement.getAnimations()];
    await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
  });
  const waitForBall = async (predicate) => {
    let box;
    for (let attempt = 0; attempt < 150; attempt++) {
      box = await boxOf(ball);
      if (box && predicate(box)) {
        await settleBall();
        box = await boxOf(ball);
        if (predicate(box)) return box;
      }
      await page.waitForTimeout(16);
    }
    assert.fail(`launcher did not settle: ${JSON.stringify(box)}`);
  };
  await ball.waitFor({ state: 'visible' });
  await stage.waitFor({ state: 'detached' });
  await ball.click({ trial: true });
  await settleBall();
  const collapsed = await boxOf(ball);
  const logicalSize = await ball.evaluate(element => ({ width: element.ownerDocument.defaultView.getComputedStyle(element).width, height: element.ownerDocument.defaultView.getComputedStyle(element).height }));
  assert(collapsed && logicalSize.width === '56px' && logicalSize.height === '56px' && Math.abs(collapsed.width - collapsed.height) < 1,
    `launcher must expose a 56px circular hit target before projection: ${JSON.stringify({ collapsed, logicalSize })}`);
  assert.equal(await ball.locator('.flower-computer-stage-ball-icon').count(), 1, 'launcher requires the dedicated Computer Use icon');
  const visual = await ball.evaluate((element) => {
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return { cursor: style.cursor, state: element.dataset.sessionState, ring: style.getPropertyValue('--flower-computer-stage-state').trim(), shadow: style.boxShadow };
  });
  assert.equal(visual.cursor, 'grab');
  assert(visual.state && visual.ring && visual.shadow !== 'none', `launcher state ring must be visible: ${JSON.stringify(visual)}`);
  if (output) await page.screenshot({ path: `${output}/viewer-minimized.png` });

  const boundary = await boxOf(root.locator('.flower-chat-transcript'));
  assert(boundary, 'viewer launcher requires the Flower transcript safety boundary');
  const expectedLeft = boundary.x + 12;
  await drag(ball.locator('.flower-computer-stage-ball-icon'), expectedLeft + 8 - collapsed.x, -20);
  assert.equal(await ball.count(), 1, 'dragging must not restore the viewer');
  assert.equal(await stage.count(), 0, 'dragging the launcher must not restore private media input');
  await waitForBall(box => Math.abs(box.x - expectedLeft) < 2);
  const draggedBall = await boxOf(ball);
  assert(draggedBall
    && Math.abs(draggedBall.x - expectedLeft) < 2
    && draggedBall.y >= boundary.y + 10
    && draggedBall.y + draggedBall.height <= boundary.y + boundary.height - 10,
  `launcher must snap inside the Flower content boundary: ${JSON.stringify({ boundary, collapsed, draggedBall })}`);
  const header = await boxOf(root.locator('.flower-chat-header'));
  const dock = await boxOf(root.locator('.flower-chat-bottom-dock'));
  assert(!header || draggedBall.y >= header.y + header.height, 'launcher must not overlap the Env App header');
  assert(!dock || draggedBall.y + draggedBall.height <= dock.y, 'launcher must not overlap the Flower composer dock');
  const safe = { left: boundary.x + 12, top: boundary.y + 12,
    right: boundary.x + boundary.width - 12, bottom: boundary.y + boundary.height - 12 };
  const center = { x: (safe.left + safe.right - draggedBall.width) / 2, y: (safe.top + safe.bottom - draggedBall.height) / 2 };
  for (const edge of ['right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-right', 'bottom-left', 'left']) {
    const current = await boxOf(ball); assert(current);
    const x = edge.includes('left') ? safe.left : edge.includes('right') ? safe.right - current.width : center.x;
    const y = edge.includes('top') ? safe.top : edge.includes('bottom') ? safe.bottom - current.height : center.y;
    await drag(ball, x - current.x, y - current.y);
    await waitForBall(box => Math.abs(box.x - x) < 2 && Math.abs(box.y - y) < 2);
    assert.equal(await stage.count(), 0, `${edge} drag must not restore the viewer`);
  }

  const beforeCancel = await boxOf(ball);
  await ball.evaluate(element => {
    element.addEventListener('pointerdown', () => {
      element.addEventListener('pointermove', event => {
        element.dispatchEvent(new element.ownerDocument.defaultView.PointerEvent('pointercancel', {
          bubbles: true, pointerId: event.pointerId, pointerType: event.pointerType,
          clientX: event.clientX, clientY: event.clientY,
        }));
      }, { once: true });
    }, { once: true });
  });
  await drag(ball, 70, 40);
  await waitForBall(box => Math.abs(box.x - beforeCancel.x) < 2 && Math.abs(box.y - beforeCancel.y) < 2);
  assert.equal(await stage.count(), 0, 'cancelled dragging must preserve placement without opening');

  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  const accessibleStyle = await ball.evaluate(element => {
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return { border: style.borderWidth, shadow: style.boxShadow, transition: style.transitionDuration };
  });
  assert.equal(accessibleStyle.border, '2px');
  assert.equal(accessibleStyle.shadow, 'none');
  assert(!accessibleStyle.transition.split(',').some(value => Number.parseFloat(value) > 0.001), 'reduced motion must disable decorative movement');
  await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' });
  const keyboardStart = await ball.evaluate(el => el.getBoundingClientRect().x);
  await ball.press('ArrowRight');
  await settleBall();
  const keyedBall = await boxOf(ball);
  const keyboardEnd = await ball.evaluate(el => el.getBoundingClientRect().x);
  assert(Math.abs(keyboardEnd - keyboardStart - 10) < 2, `arrow keys must reposition the launcher: ${JSON.stringify({ keyboardStart, keyboardEnd })}`);
  await ball.press('Enter'); await stage.waitFor();
  await grip.click({ trial: true });
  await stage.locator('img').evaluate(img => img.decode());
  assert(await pixels(), 'restore must retain decoded pixels');
  assert.equal((await content.innerText()).trim(), '', 'viewer content must remain media-only');
  const restored = await boxOf(viewer);
  assert(restored && Math.abs(restored.width - resized.width) < 2 && Math.abs(restored.height - resized.height) < 2
    && Math.abs(restored.x - resized.x) < 2 && Math.abs(restored.y - resized.y) < 2,
    `restore must preserve native FloatingWindow geometry: ${JSON.stringify({ resized, restored })}`);
  await viewer.locator('[data-floe-floating-window-control="close"]').click();
  await ball.waitFor({ state: 'visible' });
  await stage.waitFor({ state: 'detached' });
  await settleBall();
  const retainedBall = await boxOf(ball);
  assert(retainedBall && keyedBall
    && Math.abs(retainedBall.x - keyedBall.x) < 2
    && Math.abs(retainedBall.y - keyedBall.y) < 2,
  `close and restore must preserve launcher placement: ${JSON.stringify({ keyedBall, retainedBall })}`);
  await ball.press('Space');
  await stage.waitFor();
  await viewer.locator('[data-floe-floating-window-control="maximize"]').click();
  const maximized = await boxOf(viewer);
  assert(maximized && maximized.y >= 56 && maximized.width > resized.width, 'maximized window must respect the app header');
  await viewer.locator('[data-floe-floating-window-control="close"]').click();
  await stage.waitFor({ state: 'detached' });
  await ball.press('Enter');
  await stage.waitFor();
  const reopenedMaximized = await boxOf(viewer);
  assert(reopenedMaximized && Math.abs(reopenedMaximized.width - maximized.width) < 2
    && Math.abs(reopenedMaximized.height - maximized.height) < 2, 'restoring must retain maximization');
  await viewer.locator('[data-floe-floating-window-control="maximize"]').click();
  const unmaximized = await boxOf(viewer);
  assert(unmaximized && Math.abs(unmaximized.width - resized.width) < 2
    && Math.abs(unmaximized.height - resized.height) < 2, 'native restore must retain pre-maximize size');
  if (output) await page.screenshot({ path: `${output}/viewer-restored.png` });
  return { initial, moved, resized, collapsed, draggedBall, keyedBall, retainedBall, restored, visual,
    snapEdgesAndCorners: true, cancelledDragRestored: true, keyboardRestore: ['Enter', 'Space'],
    maximizationRetained: true, forcedColors: true, reducedMotion: true, pixelsDecoded: true, visibleText: '' };
}
