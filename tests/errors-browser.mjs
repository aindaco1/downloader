import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from './server.mjs';
const root = path.resolve('test-results/errors-regression'); await mkdir(root, { recursive: true });
const { server, base, requests, denied } = await startServer();
const extension = path.resolve(process.env.EXTENSION_DIR || 'extension');
const profile = path.join(root, `profile-${Date.now()}`);
await mkdir(path.join(profile, 'Default'), { recursive: true });
await writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ extensions: { ui: { developer_mode: true } } }));
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
// CDP installs into this disposable profile; unlike startup flags, it supports reload.
const browserCDP = await context.browser().newBrowserCDPSession();
const installed = await browserCDP.send('Extensions.loadUnpacked', { path: extension });
const bootstrap = await context.newPage(); await bootstrap.goto(`chrome-extension://${installed.id}/popup.html`);
let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extensionId = worker.url().split('/')[2];
await bootstrap.close();
const results = []; const exceptions = []; const consoleErrors = [];
context.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
async function waitFor(check, label) { for (let i = 0; i < 150; i++) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error(label); }
async function open(name) {
  const page = await context.newPage(); await page.goto(`${base}/${name}`);
  const tabId = await worker.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)?.id), page.url());
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  const api = (type, extra = {}) => popup.evaluate(message => chrome.runtime.sendMessage(message), { type, tabId, ...extra });
  const item = await waitFor(async () => (await api('snapshot')).tab.items[0], `detect ${name}`);
  return { page, popup, tabId, api, item };
}
try {
  // Exercise the built engine in its real offscreen context through the popup.
  for (const name of ['error401', 'error403', 'error404', 'denied-hls']) {
    const fixture = await open(name);
    const before = consoleErrors.length;
    let inspected;
    if (name === 'error403') {
      await fixture.popup.getByRole('button', { name: 'Choose quality' }).click();
      await fixture.popup.locator('.card-status.error').waitFor();
      inspected = { ok: false, error: await fixture.popup.locator('.card-status.error').innerText() };
      await fixture.popup.locator('body').screenshot({ path: path.join(root, 'handled-refusal.png') });
    } else inspected = await fixture.api('inspect', { itemId: fixture.item.id });
    assert.equal(inspected.ok, false);
    assert.match(inspected.error, name === 'error404' ? /HTTP 404/ : /site refused this request/i);
    const endpoint = name === 'denied-hls' ? '/denied.ts' : `/${name}.mp4`;
    const attempts = requests.filter(request => request.path === endpoint).length;
    assert.equal(attempts, 1, 'permanent refusal is requested once');
    const retryErrors = consoleErrors.slice(before).filter(message => /Retrying failed fetch/.test(message));
    assert.equal(retryErrors.length, 0);
    results.push({ test: name, passed: true, attempts, error: inspected.error, retryErrors });
    await fixture.popup.close(); await fixture.page.close();
  }
  const transient = await open('transient');
  const inspected = await transient.api('inspect', { itemId: transient.item.id });
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  assert.ok(inspected.choices.some(choice => choice.type === 'video' && choice.height === 360));
  const attempts = requests.filter(request => request.path === '/transient.mp4').length;
  assert.equal(attempts, 2, 'one retry recovers the transient server error');
  results.push({ test: 'transient 503 still recovers', passed: true, attempts });
  await transient.popup.close(); await transient.page.close();

  for (const name of ['network-fail', 'network-recover']) {
    const before = consoleErrors.length;
    const fixture = await open(name);
    const inspected = await fixture.api('inspect', { itemId: fixture.item.id });
    const attempts = requests.filter(request => request.path === `/${name}.mp4`).length;
    assert.equal(attempts, 2, 'network failure receives one bounded retry');
    assert.equal(inspected.ok, name === 'network-recover', JSON.stringify(inspected));
    if (!inspected.ok) assert.match(inspected.error, /media server could not be reached/i);
    assert.equal(consoleErrors.slice(before).filter(message => /Retrying failed fetch/.test(message)).length, 0);
    results.push({ test: name, passed: true, attempts, recovered: inspected.ok, error: inspected.error });
    await fixture.popup.close(); await fixture.page.close();
  }
  const manager = await context.newPage(); await manager.goto('chrome://extensions');
  const retryErrors = await manager.evaluate(id => new Promise(resolve => chrome.developerPrivate.getExtensionInfo(id, info => resolve(info.runtimeErrors.filter(error => /Retrying failed fetch|Attempting to resume/.test(error.message)).map(error => error.message)))), extensionId);
  assert.deepEqual(retryErrors, [], 'expected retries are not recorded in Chrome extension errors');
  await manager.close();

  const expired = await open('expired');
  const available = await expired.api('inspect', { itemId: expired.item.id });
  assert.equal(available.ok, true);
  const beforeExpiry = requests.filter(request => request.path === '/expired.mp4').length;
  denied.add('expired.mp4');
  const started = await expired.api('start', { itemId: expired.item.id, choiceId: available.choices.find(choice => choice.type === 'video').id });
  assert.equal(started.ok, true);
  const failed = await waitFor(async () => (await expired.api('snapshot')).jobs.find(job => job.id === started.job.id && job.status === 'error'), 'expired source produces a handled download error');
  assert.match(failed.error, /site refused this request/i);
  assert.equal(requests.filter(request => request.path === '/expired.mp4').length - beforeExpiry, 1);
  results.push({ test: 'source expires between inspection and download', passed: true, attempts: 1, error: failed.error });
  await expired.popup.close(); await expired.page.close();

  const reload = await open('direct');
  const cdp = await context.newCDPSession(reload.page);
  const worlds = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context.id));
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => exceptions.push(exceptionDetails.exception?.description || exceptionDetails.text));
  await cdp.send('Runtime.enable');
  let oldWorld;
  for (const contextId of worlds) {
    const { result } = await cdp.send('Runtime.evaluate', { contextId, expression: 'Boolean(globalThis.__dustWaveContent)', returnByValue: true });
    if (result.value) oldWorld = contextId;
  }
  assert.ok(oldWorld, 'real content script is active before reload');
  await reload.popup.close();
  await worker.evaluate(() => { setTimeout(() => chrome.runtime.reload(), 50); });
  await new Promise(resolve => setTimeout(resolve, 1000));
  // The existing page has not been reloaded: exercise its stale content script.
  for (let i = 0; i < 3; i++) {
    await reload.page.evaluate(() => {
      document.body.append(document.createElement('span'));
      document.dispatchEvent(new Event('play', { bubbles: true }));
      window.postMessage({ channel: 'dust-wave-media-v1', items: [{ sources: [{ url: 'https://example.com/after-reload.mp4' }] }] }, '*');
    });
    await new Promise(resolve => setTimeout(resolve, 900));
  }
  assert.deepEqual(exceptions, [], 'no uncaught errors in the old content world');
  const stopped = await cdp.send('Runtime.evaluate', { contextId: oldWorld, expression: 'Boolean(globalThis.__dustWaveContent)', returnByValue: true }).catch(() => null);
  assert.ok(!stopped || stopped.result.value === false, 'stale observer/listeners are stopped or their world was destroyed');
  // Headless Chromium leaves a programmatically reloaded unpacked extension
  // disabled. Reinstall only in this disposable profile to test fresh detection.
  await browserCDP.send('Extensions.uninstall', { id: extensionId });
  await browserCDP.send('Extensions.loadUnpacked', { path: extension });
  const wake = await context.newPage(); await wake.goto(`chrome-extension://${extensionId}/popup.html?tab=${reload.tabId}`);
  await reload.page.reload();
  await waitFor(async () => (await wake.evaluate(tabId => chrome.runtime.sendMessage({ type: 'snapshot', tabId }), reload.tabId)).tab.items.some(item => item.sources.some(source => source.url.includes('combined.mp4'))), 'fresh page detects after reload');
  assert.deepEqual(exceptions, []);
  results.push({ test: 'real context invalidation on an existing page, then fresh detection after reinstall', passed: true, uncaughtErrors: 0 });
  await wake.close(); await reload.page.close();
  console.log('ERROR REGRESSIONS PASSED', results.length);
} catch (error) { console.error('ERROR REGRESSION FAILURE', error.message); throw error; } finally {
  await writeFile(path.join(root, 'results.json'), JSON.stringify({ browser: context.browser().version(), extensionId, results, exceptions }, null, 2));
  await context.close(); server.close();
}
