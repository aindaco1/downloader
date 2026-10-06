import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { youtubePageId } from '../src/youtube.js';

const url = process.env.YOUTUBE_TEST_URL;
assert.ok(youtubePageId(url), 'Set YOUTUBE_TEST_URL to an authorized YouTube video to test.');
const root = path.resolve(process.env.RESULTS_DIR || 'test-results/youtube-live');
const extension = path.resolve(process.env.EXTENSION_DIR || 'extension');
const downloads = path.join(root, 'downloads');
const profile = path.join(root, `profile-${Date.now()}`);
await mkdir(path.join(profile, 'Default'), { recursive: true });
await mkdir(downloads, { recursive: true });
await writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false } }));
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
const result = { browser: context.browser().version(), downloads: [] };
const waitFor = async (check, label, attempts = 120) => {
  for (let n = 0; n < attempts; n++) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 500)); }
  throw new Error(label);
};
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  result.extensionVersion = await worker.evaluate(() => chrome.runtime.getManifest().version);
  const extensionId = worker.url().split('/')[2];
  const cdp = await context.browser().newBrowserCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('video').evaluateAll(elements => elements.forEach(video => { video.muted = true; void video.play().catch(() => {}); }));
  const tabId = await worker.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)?.id), page.url());
  let popup = await context.newPage();
  const popupUrl = `chrome-extension://${extensionId}/popup.html?tab=${tabId}`;
  await popup.goto(popupUrl);
  const snapshot = () => popup.evaluate(tabId => chrome.runtime.sendMessage({ type: 'snapshot', tabId }), tabId);
  const item = await waitFor(async () => (await snapshot()).tab.items.find(item => item.key === `youtube:${youtubePageId(url)}`), 'YouTube item was not detected');
  result.discovery = { sourceCount: item.sources.length, playback: item.unavailable || 'observed sources' };
  console.log('LIVE DISCOVERY', JSON.stringify(result.discovery));
  await popup.getByRole('button', { name: 'Choose quality' }).click();
  const inspected = await waitFor(async () => {
    const current = (await snapshot()).tab.items.find(candidate => candidate.id === item.id);
    const error = await popup.locator('.card-status.error').innerText().catch(() => '');
    if (error) throw new Error(error);
    return current?.inspection ? current : null;
  }, 'Quality inspection did not finish', 180);
  result.choices = inspected.inspection.choices.map(({ type, label, height, extension }) => ({ type, label, height, extension }));
  assert.ok(result.choices.some(choice => choice.type === 'video'));
  assert.ok(result.choices.some(choice => choice.type === 'audio'));
  assert.deepEqual(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()), [], 'temporary request rules were removed');
  console.log('LIVE CHOICES', JSON.stringify(result.choices));
  await popup.locator('body').screenshot({ path: path.join(root, 'qualities.png') });
  for (const type of ['video', 'audio']) {
    const choices = inspected.inspection.choices.filter(choice => choice.type === type);
    const choice = type === 'video' ? choices.find(choice => choice.audioCodec && choice.extension === 'mp4') || choices[0] : choices.find(choice => choice.extension === 'm4a') || choices[0];
    const started = await popup.evaluate(data => chrome.runtime.sendMessage({ type: 'start', ...data }), { tabId, itemId: item.id, choiceId: choice.id, filename: `youtube-${type}` });
    assert.equal(started.ok, true, started.error);
    await popup.close();
    const finished = await waitFor(async () => {
      const job = await worker.evaluate(id => chrome.storage.session.get('state').then(({ state }) => state.jobs.find(job => job.id === id)), started.job.id);
      return ['complete', 'error', 'cancelled'].includes(job.status) ? job : null;
    }, `${type} download did not finish`, 600);
    assert.equal(finished.status, 'complete', finished.error);
    const download = await worker.evaluate(id => chrome.downloads.search({ id }).then(items => items[0]), finished.downloadId);
    assert.ok(download.filename.startsWith(downloads + path.sep));
    const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration,size', '-of', 'json', download.filename], { encoding: 'utf8' }));
    assert.ok(metadata.streams.some(stream => stream.codec_type === 'audio'));
    if (type === 'video') assert.ok(metadata.streams.some(stream => stream.codec_type === 'video' && stream.height === choice.height));
    else assert.ok(metadata.streams.every(stream => stream.codec_type === 'audio'));
    assert.ok(Math.abs(Number(metadata.format.duration) - Number(item.duration || choice.duration)) < 2, 'full duration preserved');
    execFileSync('ffmpeg', ['-v', 'error', '-i', download.filename, '-f', 'null', '-'], { stdio: 'pipe' });
    result.downloads.push({ type, file: path.basename(download.filename), metadata, fullDecode: true, popupClosed: true });
    console.log('LIVE SAVED', type, metadata.format.duration, metadata.format.size);
    popup = await context.newPage(); await popup.goto(popupUrl);
  }
  result.passed = true;
} catch (error) { result.error = error.message; throw error; }
finally { await writeFile(path.join(root, 'results.json'), JSON.stringify(result, null, 2)); await context.close(); }
