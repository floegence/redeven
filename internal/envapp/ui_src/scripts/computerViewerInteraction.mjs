import assert from 'node:assert/strict';

// Runs against real browser input, also reused by the built Flower qualification.
export async function qualifyComputerViewer({ page, root = page, output }) {
  const viewer = root.locator('.flower-computer-viewer');
  const stage = root.locator('.flower-computer-stage');
  const grip = root.locator('.flower-computer-stage-drag');
  const pixels = () => stage.locator('img').evaluate(img => img.complete && img.naturalWidth > 0 && img.src.startsWith('blob:'));
  assert(await pixels(), 'viewer requires decoded pixels before interaction');
  await grip.click({ trial: true });
  const initial = await viewer.boundingBox();
  const drag = async (handle, dx, dy) => {
    const box = await handle.boundingBox(); assert(box);
    const x = box.x + box.width / 2; const y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 12 }); await page.mouse.up();
  };
  await drag(grip, -60, -40);
  const moved = await viewer.boundingBox();
  assert(Math.abs(moved.x - initial.x + 60) < 2 && Math.abs(moved.y - initial.y + 40) < 2, `viewer must follow pointer in client coordinates: ${JSON.stringify({ initial, moved })}`);
  await root.locator('.flower-computer-stage-minimize').click();
  const ball = root.locator('.flower-computer-stage-ball'); await ball.waitFor();
  assert.equal(await stage.count(), 0, 'minimize must hide media and private input');
  await ball.click({ trial: true });
  const collapsed = await ball.boundingBox();
  assert(Math.abs(collapsed.width - collapsed.height) < 1, 'launcher must be circular');
  if (output) await page.screenshot({ path: `${output}/viewer-minimized.png` });
  await drag(ball, -40, -20);
  assert.equal(await ball.count(), 1, 'dragging must not restore the viewer');
  const draggedBall = await ball.boundingBox();
  assert(Math.abs(draggedBall.x - collapsed.x + 40) < 2, `ball must move: ${JSON.stringify({collapsed, draggedBall})}`);
  const keyboardStart = await ball.evaluate(el => el.getBoundingClientRect().x);
  await ball.press('ArrowLeft');
  const keyedBall = await ball.boundingBox();
  const keyboardEnd = await ball.evaluate(el => el.getBoundingClientRect().x);
  assert(Math.abs(keyboardEnd - keyboardStart + 10) < 2, `arrow keys must reposition the ball: ${JSON.stringify({ keyboardStart, keyboardEnd })}`);
  await ball.press('Enter'); await stage.waitFor();
  await stage.locator('img').evaluate(img => img.decode());
  assert(await pixels(), 'restore must retain decoded pixels');
  assert.equal(await stage.innerText(), '', 'viewer must remain media-only');
  const restored = await viewer.boundingBox();
  if (output) await page.screenshot({ path: `${output}/viewer-restored.png` });
  return { initial, moved, collapsed, draggedBall, keyedBall, restored, pixelsDecoded: true, visibleText: '' };
}
