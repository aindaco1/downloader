import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(process.env.RESULTS_DIR || 'test-results/rescan-regression');
const extension = path.resolve(process.env.EXTENSION_DIR || 'extension');
const profile = path.join(root, `profile-${Date.now()}`);
await mkdir(path.join(profile, 'Default'), { recursive: true });
await writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ extensions: { ui: { developer_mode: true } } }));
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
const browserCDP = await context.browser().newBrowserCDPSession();
const installed = await browserCDP.send('Extensions.loadUnpacked', { path: extension });
const bootstrap = await context.newPage(); await bootstrap.goto(`chrome-extension://${installed.id}/popup.html`);
const results = []; const exceptions = []; let runtimeErrors = [];
const url = 'https://www.youtube.com/watch?v=hidw3Hp4tIk';
async function waitFor(check, label) { for (let i = 0; i < 100; i++) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error(label); }
async function recordInjections(worker) {
  await worker.evaluate(() => {
    globalThis.testInjections = [];
    const execute = chrome.scripting.executeScript.bind(chrome.scripting);
    chrome.scripting.executeScript = options => { globalThis.testInjections.push(options.files); return execute(options); };
  });
}
try {
  await context.route(url, route => route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Rescan fixture - YouTube</title><script>
    window.ytInitialPlayerResponse = { videoDetails: { videoId: 'hidw3Hp4tIk', title: 'Rescan fixture', lengthSeconds: '6' }, streamingData: { formats: [{ url: 'https://fixture.googlevideo.com/videoplayback?itag=18', mimeType: 'video/mp4', qualityLabel: '360p' }] } };
    window.documentToken = crypto.randomUUID(); window.scanCount = 0;
    window.addEventListener('message', event => { if (event.data?.command === 'scan') window.scanCount++; });
  </script>` }));
  await context.route('https://i.ytimg.com/**', route => route.abort());
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const worlds = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context.id));
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => exceptions.push(exceptionDetails.exception?.description || exceptionDetails.text));
  await cdp.send('Runtime.enable');
  await page.goto(url);
  const documentToken = await page.evaluate(() => window.documentToken);
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await recordInjections(worker);
  await bootstrap.close();
  const tabId = await worker.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url).id), url);
  let popup = await context.newPage();
  const openPopup = () => popup.goto(`chrome-extension://${installed.id}/popup.html?tab=${tabId}`);
  await openPopup();
  const snapshot = () => popup.evaluate(tabId => chrome.runtime.sendMessage({ type: 'snapshot', tabId }), tabId);
  await waitFor(async () => (await snapshot()).tab.items.length === 1, 'initial detection');
  let oldWorld;
  for (const contextId of worlds) {
    const evaluated = await cdp.send('Runtime.evaluate', { contextId, expression: 'Boolean(globalThis.__dustWaveContent)', returnByValue: true }).catch(() => null);
    if (evaluated?.result.value) oldWorld = contextId;
  }
  assert.ok(oldWorld, 'initial isolated content world');
  await popup.locator('#rescan').click();
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.deepEqual(exceptions, []);
  assert.deepEqual(await worker.evaluate(() => globalThis.testInjections), [], 'a healthy rescan must not reinject scripts');
  results.push({ test: 'rescan before extension reload without reinjection', passed: true });

  await popup.close();
  const manager = await context.newPage(); await manager.goto('chrome://extensions');
  await manager.evaluate(id => new Promise((resolve, reject) => chrome.developerPrivate.reload(id, { failQuietly: true }, () => chrome.runtime.lastError ? reject(Error(chrome.runtime.lastError.message)) : resolve())), installed.id);
  await new Promise(resolve => setTimeout(resolve, 600));
  await page.evaluate(() => window.postMessage({ channel: 'dust-wave-media-v1', items: [] }, '*'));
  let worldDestroyed = false;
  await waitFor(async () => {
    const evaluated = await cdp.send('Runtime.evaluate', { contextId: oldWorld, expression: '!globalThis.__dustWaveContent && !chrome.runtime.id', returnByValue: true }).catch(error => {
      if (!/Cannot find context/.test(error.message)) throw error;
      worldDestroyed = true;
    });
    return worldDestroyed || evaluated.result.value;
  }, 'old detector stops in the invalidated world');
  // Re-enter the real built script in that world: the previous setup path
  // called onMessage.addListener even though its Chrome context was gone.
  if (!worldDestroyed) {
    const reinjected = await cdp.send('Runtime.evaluate', { contextId: oldWorld, expression: await readFile(path.join(extension, 'content.js'), 'utf8') });
    assert.equal(reinjected.exceptionDetails, undefined, 'initialization in an invalidated world must not throw');
  }
  results.push({ test: 'old content world stops or is destroyed after reload', passed: true, worldDestroyed });
  // This headless build marks a CDP-installed extension disabled on reload;
  // re-enable it in the disposable profile while preserving the old page.
  await manager.evaluate(id => chrome.management.setEnabled(id, true), installed.id);
  popup = await context.newPage(); await openPopup();
  worker = context.serviceWorkers().find(worker => worker.url().includes(installed.id));
  await recordInjections(worker);
  const alreadyConnected = await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: 'ping' }, { frameId: 0 }).then(response => response?.ok === true).catch(() => false), tabId);
  await page.evaluate(() => { window.ytInitialPlayerResponse.videoDetails.title = 'Updated after reload'; });
  await popup.locator('#rescan').click();
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.deepEqual(exceptions, [], 'rescan on the existing YouTube document after extension reload');
  await waitFor(async () => {
    const { tab } = await snapshot();
    return tab.items.length === 1 && tab.items[0].title === 'Updated after reload';
  }, 'rescan recovers current player metadata without page refresh');
  const sameDocument = await page.evaluate(() => window.documentToken) === documentToken;
  results.push({ test: 'rescan after extension reload reads current player metadata', passed: true, sameDocument });
  const afterReconnect = await worker.evaluate(() => globalThis.testInjections.length);
  assert.equal(afterReconnect, alreadyConnected ? 0 : 2, 'inject only when the page needs reconnection');
  for (let i = 0; i < 3; i++) {
    await popup.locator('#rescan').click();
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.equal(await worker.evaluate(() => globalThis.testInjections.length), afterReconnect, 'repeated rescans keep the reconnected listener');
  assert.equal((await snapshot()).tab.items.length, 1);
  assert.deepEqual(exceptions, []);
  results.push({ test: 'repeated rescans keep one detector and one video card', passed: true });

  // Model an orphaned main-frame receiver while other messages still work.
  // Rescan must show recovery advice rather than silently report success.
  await worker.evaluate(() => {
    const send = chrome.tabs.sendMessage.bind(chrome.tabs);
    chrome.tabs.sendMessage = (tabId, message, options) => message.type === 'ping' ? Promise.resolve(null) : send(tabId, message, options);
  });
  await popup.locator('#rescan').click();
  await waitFor(async () => (await popup.locator('#status').innerText()).includes('Refresh this page to reconnect'), 'handled rescan recovery message');
  assert.deepEqual(exceptions, []);
  results.push({ test: 'unresponsive main frame shows a handled refresh instruction', passed: true });
  runtimeErrors = await manager.evaluate(id => new Promise(resolve => chrome.developerPrivate.getExtensionInfo(id, info => resolve(info.runtimeErrors.map(error => ({ message: error.message, source: error.source }))))), installed.id);
  assert.deepEqual(runtimeErrors, [], 'no errors recorded by the extension manager');
  console.log('RESCAN REGRESSIONS PASSED', results.length);
} finally {
  await writeFile(path.join(root, 'results.json'), JSON.stringify({ browser: context.browser().version(), results, exceptions, runtimeErrors }, null, 2));
  await context.close();
}
