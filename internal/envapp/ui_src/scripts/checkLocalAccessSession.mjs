import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const fixture = JSON.parse(process.argv[2]);
const browser = await chromium.launch({ args: [
  '--no-proxy-server',
  `--ignore-certificate-errors-spki-list=${fixture.certificateSPKI}`,
] });
const pageURL = base => `${base}/_redeven_proxy/env/`;
const cookieName = base => {
  const url = new URL(base);
  return `redeven_local_access_${url.protocol.slice(0, -1)}_${url.port}`;
};
const status = page => page.evaluate(async () => {
  const response = await fetch('/api/local/access/status', { credentials: 'same-origin' });
  const unlocked = (await response.json()).data.unlocked;
  const protectedResponse = await fetch('/api/local/runtime', { credentials: 'same-origin' });
  if (protectedResponse.status !== (unlocked ? 200 : 423)) throw new Error('Protected API and gate status disagree');
  return unlocked;
});
const authenticate = (page, body = { password: 'cookie-fixture-password' }) => page.evaluate(async body => {
  const response = await fetch('/api/local/access/unlock', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  // Retain no session/resume token: continuity must come from the browser cookie.
  return { ok: response.ok, unlocked: result.data?.unlocked, challenge: result.data?.challenge_id };
}, body);
const unlock = async page => assert.equal((await authenticate(page)).unlocked, true, 'Password login succeeds');
const logout = page => page.evaluate(async () => {
  const response = await fetch('/api/local/access/logout', { method: 'POST', credentials: 'same-origin' });
  if (!response.ok) throw new Error('Logout failed');
});
const control = async action => {
  const response = await fetch(`${fixture.control}/${action}`, {
    method: 'POST', headers: { Authorization: `Bearer ${fixture.controlToken}` },
  });
  assert.equal(response.status, 204, `Fixture ${action} succeeds`);
};
const reloadAuthenticated = async page => {
  await page.reload();
  assert.equal(await status(page), true, 'Reload keeps the current authenticated session');
};

try {
  const context = await browser.newContext();
  try {
    // Both historical fixed-name and HTTPS scoped credentials must coexist with
    // a later HTTP login, including a TLS-to-HTTP change on the same port.
    await context.addCookies(['redeven_local_access', cookieName(fixture.httpA).replace('_http_', '_https_')].map(name => ({
      name, value: 'obsolete-secure-session',
      domain: new URL(fixture.httpA).hostname, path: '/', secure: true, httpOnly: true,
      sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600,
    })));
    const page = await context.newPage();
    await page.goto(pageURL(fixture.httpA));
    await unlock(page);
    for (let index = 0; index < 3; index++) await reloadAuthenticated(page);
    console.log('PASS HTTP reload with legacy and same-port HTTPS Secure cookies');

    const originalCookie = (await context.cookies()).find(cookie => cookie.name === cookieName(fixture.httpA));
    assert.ok(originalCookie?.httpOnly && !originalCookie.secure);
    assert.equal(originalCookie.sameSite, 'Lax');
    assert.ok(originalCookie.expires > Date.now() / 1000 + 11 * 3600, 'Default lifetime remains twelve hours');
    assert.equal(await page.evaluate(() => globalThis.document.cookie.includes('redeven_local_access')), false);
    const newTab = await context.newPage();
    await newTab.goto(pageURL(fixture.httpA));
    assert.equal(await status(newTab), true, 'A new tab shares the valid cookie');
    await context.setOffline(true);
    assert.equal(await status(page).catch(() => 'offline'), 'offline');
    await context.setOffline(false);
    await reloadAuthenticated(page);
    const unchangedCookie = (await context.cookies()).find(cookie => cookie.name === originalCookie.name);
    assert.equal(unchangedCookie.expires, originalCookie.expires, 'Reload and reconnection do not renew the deadline');
    console.log('PASS new tab, brief disconnect and unchanged absolute deadline');

    const second = await context.newPage();
    await second.goto(pageURL(fixture.httpB));
    assert.equal(await status(second), false, 'Another port starts locked');
    await unlock(second);
    const secure = await context.newPage();
    await secure.goto(pageURL(fixture.https));
    assert.equal(await status(secure), false, 'HTTPS starts locked');
    await unlock(secure);
    assert.equal((await context.cookies()).find(cookie => cookie.name === cookieName(fixture.https))?.secure, true);
    for (const target of [page, second, secure]) await reloadAuthenticated(target);
    await logout(second);
    assert.equal(await status(second), false);
    assert.equal((await context.cookies()).some(cookie => cookie.name === cookieName(fixture.httpB)), false);
    await reloadAuthenticated(page);
    await reloadAuthenticated(secure);
    // An actual HTTPS login must not prevent the next HTTP login on this host.
    await unlock(second);
    await reloadAuthenticated(second);
    await logout(secure);
    await reloadAuthenticated(page);
    await reloadAuthenticated(second);
    console.log('PASS independent HTTP ports, HTTPS-to-HTTP login and scoped logout');

    await control('restart');
    await page.reload();
    assert.equal(await status(page), false, 'Restart rejects the old cookie');
    assert.equal(await status(newTab), false, 'Restart invalidates all tabs');
    await reloadAuthenticated(second);
    await unlock(page);
    await control('recover');
    assert.equal(await status(page), false, 'Owner security recovery revokes the session');
    await reloadAuthenticated(second);
    console.log('PASS Runtime restart and security change revoke only their own sessions');

    const expires = await context.newPage();
    await expires.goto(pageURL(fixture.expiring));
    await unlock(expires);
    const shortCookie = (await context.cookies()).find(cookie => cookie.name === cookieName(fixture.expiring));
    assert.ok(shortCookie);
    // Wait for the real server deadline, then deliberately retain the credential
    // in Chromium to prove the gate, rather than browser expiry, rejects it.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, shortCookie.expires * 1000 - Date.now()) + 1200));
    await context.addCookies([{ ...shortCookie, expires: Math.floor(Date.now() / 1000) + 3600 }]);
    await expires.reload();
    assert.equal(await status(expires), false, 'Expired credentials cannot authenticate');
    console.log('PASS absolute expiry is enforced even if the browser retains the cookie');

    const mfaA = await context.newPage();
    const mfaB = await context.newPage();
    await mfaA.goto(pageURL(fixture.mfaA));
    await mfaB.goto(pageURL(fixture.mfaB));
    const challengeA = await authenticate(mfaA);
    const challengeB = await authenticate(mfaB);
    assert.ok(challengeA.challenge && challengeB.challenge);
    assert.equal(await status(mfaA), false, 'Password-only MFA challenge grants no access');
    for (const base of [fixture.mfaA, fixture.mfaB]) {
      const name = cookieName(base).replace('redeven_local_access', 'redeven_auth_challenge');
      const cookie = (await context.cookies()).find(item => item.name === name);
      assert.ok(cookie?.secure && cookie.httpOnly);
      assert.equal(cookie.path, '/api/local/access');
      assert.equal(cookie.sameSite, 'Strict');
    }
    assert.equal((await authenticate(mfaA, { challenge_id: challengeA.challenge, recovery_code: fixture.mfaCodeA })).unlocked, true);
    assert.equal((await authenticate(mfaB, { challenge_id: challengeB.challenge, recovery_code: fixture.mfaCodeB })).unlocked, true);
    await reloadAuthenticated(mfaA);
    await reloadAuthenticated(mfaB);
    console.log('PASS concurrent MFA challenges on separate Runtime ports');
  } finally {
    await context.close();
  }
  for (const base of [fixture.httpB, fixture.https]) {
    const clean = await browser.newContext();
    try {
      const page = await clean.newPage();
      await page.goto(pageURL(base));
      assert.equal(await status(page), false);
      await unlock(page);
      await reloadAuthenticated(page);
    } finally {
      await clean.close();
    }
  }
  console.log('PASS fresh HTTP and HTTPS browser profiles');
} finally {
  await browser.close();
}
