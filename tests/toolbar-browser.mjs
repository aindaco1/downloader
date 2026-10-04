import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from './server.mjs';

const root = path.resolve(process.env.RESULTS_DIR || 'test-results/toolbar-regression');
const extension = path.resolve(process.env.EXTENSION_DIR || 'extension');
const profile = path.join(root, `profile-${Date.now()}`);
const extensionId = 'jbfbmmbegnijoakbebdiclmphlgjlkfd';
await mkdir(path.join(profile, 'Default'), { recursive: true });
await mkdir(path.join(root, 'downloads'), { recursive: true });
await writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ extensions: { pinned_extensions: [extensionId] }, download: { default_directory: path.join(root, 'downloads'), prompt_for_download: false } }));
const { server, base } = await startServer();
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: process.env.HEADED !== '1', executablePath: process.env.CHROMIUM_EXECUTABLE, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
const results = []; const errors = [];
context.on('console', message => { if (message.type() === 'error' && /setIcon|extension context/i.test(message.text())) errors.push(message.text()); });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label) { for (let i = 0; i < 100; i++) { const value = await check(); if (value) return value; await wait(100); } throw Error(label); }
async function navigate(page, url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await page.goto(url); return; }
    catch (error) {
      // Helium can refresh tabs while activating its installed extensions.
      if (attempt === 2 || !/ERR_ABORTED|interrupted by another navigation/.test(error.message)) throw error;
      await page.waitForLoadState('domcontentloaded');
    }
  }
}
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    self.iconCalls = [];
    const setIcon = chrome.action.setIcon.bind(chrome.action);
    chrome.action.setIcon = async options => { await setIcon(options); self.iconCalls.push(options.path[16]); };
  });
  assert.equal((await worker.evaluate(() => chrome.action.getUserSettings())).isOnToolbar, true, 'extension is pinned in this profile');
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const page = await context.newPage(); await navigate(page, `${base}/direct`);
  const tabId = await worker.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url).id), page.url());
  const api = (type, extra = {}) => popup.evaluate(message => chrome.runtime.sendMessage(message), { type, tabId, ...extra });
  const calls = () => worker.evaluate(() => self.iconCalls);
  const resetCalls = () => worker.evaluate(() => { self.iconCalls = []; });
  await waitFor(async () => (await api('snapshot')).tab.items.length, 'media is detected');
  await waitFor(async () => new Set((await calls()).filter(name => name.includes('detected-'))).size >= 5 && (await calls()).at(-1) === 'icons/available-16.png', 'detection pulse returns to idle');
  assert.ok(new Set((await calls()).filter(name => name.includes('detected-'))).size >= 5);
  assert.equal((await calls()).at(-1), 'icons/available-16.png');
  const badge = await worker.evaluate(async tabId => ({ text: await chrome.action.getBadgeText({ tabId }), background: await chrome.action.getBadgeBackgroundColor({ tabId }), color: await chrome.action.getBadgeTextColor({ tabId }) }), tabId);
  assert.equal(badge.text, '', 'native backplate is replaced by a dot in the icon');
  assert.match(await worker.evaluate(() => chrome.action.getTitle({})), /1 media item available/);
  results.push({ test: 'pinned detection pulse and compact dot without a native badge backplate', passed: true, badge });

  const empty = await context.newPage(); await empty.goto('about:blank');
  await resetCalls(); await page.bringToFront();
  await waitFor(async () => new Set((await calls()).filter(name => name.includes('detected-'))).size >= 3, 'returning to a media tab pulses the icon');
  results.push({ test: 'returning to a media tab replays the toolbar pulse', passed: true });

  await navigate(page, `${base}/slow`);
  const item = await waitFor(async () => (await api('snapshot')).tab.items.find(item => item.sources.some(source => source.kind === 'hls')), 'slow HLS media');
  const inspected = await api('inspect', { itemId: item.id }); assert.equal(inspected.ok, true, inspected.error);
  const started = await api('start', { itemId: item.id, choiceId: inspected.choices[0].id, filename: 'toolbar-cancel-test' });
  assert.equal(started.ok, true, started.error);
  await resetCalls();
  await popup.close(); await page.bringToFront(); await wait(900);
  assert.ok(new Set((await calls()).filter(name => name.includes('download-'))).size >= 3);
  assert.match(await worker.evaluate(() => chrome.action.getTitle({})), /^Downloading toolbar-cancel-test/);
  results.push({ test: 'pinned download animation continues with popup closed', passed: true });
  if (process.env.HEADED === '1') { console.log('TOOLBAR VISUAL CHECK READY'); await wait(Number(process.env.VISUAL_WAIT || 4000)); }
  const control = await context.newPage(); await control.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  await control.locator('#jobsTab').click();
  // Hold the engine's cancel request to model slow cleanup. Real progress keeps
  // arriving: the toolbar and popup must stop before the terminal event.
  await worker.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (...args) => {
      if (args[0]?.target === 'offscreen' && args[0].type === 'cancel') {
        await new Promise(resolve => { self.releaseCancel = resolve; });
        chrome.runtime.sendMessage = send;
      }
      return send(...args);
    };
  });
  await control.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.bringToFront();
  await waitFor(() => worker.evaluate(() => Boolean(self.releaseCancel)), 'cancel reaches the held engine request');
  const cancelling = await control.evaluate(async id => (await chrome.runtime.sendMessage({ type: 'snapshot' })).jobs.find(job => job.id === id), started.job.id);
  assert.equal(cancelling.cancelRequested, true);
  assert.equal(cancelling.status, 'processing', 'engine cleanup has not completed');
  const overlapping = await control.evaluate(message => chrome.runtime.sendMessage(message), { type: 'start', tabId, itemId: item.id, choiceId: inspected.choices[0].id });
  assert.equal(overlapping.ok, false, 'another download waits until cancellation cleanup is complete');
  assert.equal((await control.evaluate(() => chrome.runtime.sendMessage({ type: 'snapshot' }))).jobs.length, 1, 'no overlapping job is created');
  assert.equal((await calls()).at(-1), 'icons/available-16.png', 'Cancel immediately restores the available icon');
  assert.match(await worker.evaluate(() => chrome.action.getTitle({})), /media item.*available/);
  await control.getByText('Cancelling…', { exact: true }).waitFor();
  assert.notEqual(await control.locator('#activityMark').getAttribute('data-activity'), 'download');
  assert.equal(await control.locator('.job-progress').isVisible(), false);
  const stoppedCount = (await calls()).length;
  await wait(900); assert.equal((await calls()).length, stoppedCount, 'no frames while cancellation is pending');
  results.push({ test: 'Cancel stops toolbar and popup immediately while engine cleanup is pending', passed: true });
  await worker.evaluate(() => { self.releaseCancel(); delete self.releaseCancel; });
  await waitFor(() => control.evaluate(async id => (await chrome.runtime.sendMessage({ type: 'snapshot' })).jobs.find(job => job.id === id)?.status === 'cancelled', started.job.id), 'engine finishes cancellation');
  await wait(500); assert.equal((await calls()).length, stoppedCount, 'terminal cancellation cannot restart the pulse');
  assert.deepEqual(errors, []);
  results.push({ test: 'toolbar timer stops after cancellation', passed: true });
  console.log('TOOLBAR REGRESSIONS PASSED', results.length);
} finally {
  await writeFile(path.join(root, 'results.json'), JSON.stringify({ browser: context.browser().version(), results, errors }, null, 2));
  await context.close(); server.close();
}
