import assert from 'node:assert/strict';

/** Check the rendered selection stage, including the production Electron surface. */
export async function assertGatewayEnvironmentChoiceLayout(dialog, { empty = false } = {}) {
  await dialog.locator('[data-gateway-environment-choice]').waitFor();
  await dialog.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
  });
  const layout = await dialog.evaluate(panel => {
    const rect = element => {
      if (!element) return null;
      const { x, y, width, height, bottom, right } = element.getBoundingClientRect();
      return { x, y, width, height, bottom, right };
    };
    const choice = panel.querySelector('[data-gateway-environment-choice]');
    const trigger = choice.querySelector('[data-floe-dropdown-trigger]');
    const cancel = [...panel.querySelectorAll('button')].at(-1);
    const copy = choice.querySelector('p');
    const style = trigger && getComputedStyle(trigger);
    return { panel: rect(panel), trigger: rect(trigger), cancel: rect(cancel), copy: rect(copy),
      triggerBorder: style && parseFloat(style.borderTopWidth), triggerCue: !!trigger?.querySelector('svg'),
      overflow: panel.scrollWidth > panel.clientWidth + 1, viewport: { width: innerWidth, height: innerHeight },
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize), coarse: matchMedia('(pointer: coarse)').matches };
  });
  const { panel, trigger, cancel, copy, viewport, rem } = layout;
  const evidence = JSON.stringify(layout);
  assert.ok(panel.x >= 0 && panel.right <= viewport.width + 1 && panel.y >= 0 && panel.bottom <= viewport.height + 1, evidence);
  assert.equal(layout.overflow, false, evidence);
  for (const content of [trigger, copy, cancel].filter(Boolean)) {
    assert.ok(content.x - panel.x >= rem - 1 && panel.right - content.right >= rem - 1, 'Selection content needs horizontal padding: ' + evidence);
  }
  assert.ok(panel.bottom - cancel.bottom <= 2 * rem, 'Selection must not inherit the wizard empty height: ' + evidence);
  if (!empty) {
    assert.ok(trigger && trigger.height >= (layout.coarse ? 44 : 36), 'Environment selector needs a full control target: ' + evidence);
    assert.ok(layout.triggerBorder >= 1 && layout.triggerCue, 'Environment selector needs its field boundary and dropdown cue: ' + evidence);
  }
  return layout;
}
