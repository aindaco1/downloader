import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(process.env.RESULTS_DIR || 'test-results/substack-live');
await mkdir(root, { recursive: true });
const extension = path.resolve(process.env.EXTENSION_DIR || 'extension');
const profile = path.join(root, `profile-${Date.now()}`);
const downloads = path.join(root, 'downloads');
await mkdir(path.join(profile, 'Default'), { recursive: true });
await mkdir(downloads, { recursive: true });
await writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false } }));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const report = { url: 'https://thehollywoodhang.substack.com/p/haley-nicole-johnson-obsession', browser: context.browser().version() };
async function waitFor(check, label, attempts = 150, delay = 200) {
  for (let i = 0; i < attempts; i++) { const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, delay)); }
  throw Error(label);
}
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  report.extensionVersion = await worker.evaluate(() => chrome.runtime.getManifest().version);
  const cdp = await context.browser().newBrowserCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true });
  const page = await context.newPage();
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await page.goto(report.url, { waitUntil: 'domcontentloaded', timeout: 30000 }); break; }
    catch (error) {
      if (attempt === 2 || !/ERR_ABORTED|interrupted by another navigation/.test(error.message)) throw error;
      report.navigationRestarts = (report.navigationRestarts || 0) + 1;
      await page.waitForLoadState('domcontentloaded');
      if (page.url() === report.url) break;
    }
  }
  const tabId = await worker.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)?.id), report.url);
  const popupUrl = `chrome-extension://${worker.url().split('/')[2]}/popup.html?tab=${tabId}`;
  let popup = await context.newPage(); await popup.goto(popupUrl);
  const api = (type, extra = {}) => popup.evaluate(message => chrome.runtime.sendMessage(message), { type, tabId, ...extra });
  const snap = await waitFor(async () => { const s = await api('snapshot'); return s.tab.items.length === 2 && s.tab.items.some(item => item.key === 'youtube:hTCMkNLMFrU') ? s : null; }, 'article narration and embedded video');
  report.items = snap.tab.items.map(({ id, key, title, thumbnail, duration }) => ({ id, type: key.startsWith('youtube:') ? 'video' : 'narration', title, thumbnail, duration }));
  assert.equal(report.items.find(item => item.type === 'narration').title, 'Haley Nicole Johnson (Obsession) (read aloud)');
  await waitFor(() => popup.locator('.thumbnail img').evaluateAll(images => images.length === 2 && images.every(image => image.complete && image.naturalWidth > 0)), 'both real preview images loaded');
  report.previewsLoaded = true;
  await popup.locator('body').screenshot({ path: path.join(root, 'detected.png') });
  console.log('DETECTED', JSON.stringify(report.items));
  if (process.env.INSPECT === '1' || process.env.DOWNLOAD === '1') for (const item of report.items) {
    const startedAt = Date.now();
    await popup.locator(`[data-item="${item.id}"]`).getByRole('button', { name: 'Choose quality' }).click();
    const result = await waitFor(async () => {
      const error = (await popup.locator(`[data-item="${item.id}"] .card-status.error`).allTextContents()).join(' ');
      if (error) throw new Error(error);
      const current = (await api('snapshot')).tab.items.find(candidate => candidate.id === item.id);
      return current?.inspection ? { ok: true, ...current.inspection } : null;
    }, 'Quality inspection did not finish', 450);
    item.inspectionSeconds = (Date.now() - startedAt) / 1000;
    item.inspection = { ok: result.ok, error: result.error, choices: result.choices?.map(({ type, label, extension }) => ({ type, label, extension })) };
    console.log('INSPECTION', item.type, JSON.stringify(item.inspection));
    assert.equal(result.ok, true, result.error);
    assert.ok(result.choices.some(choice => choice.type === (item.type === 'video' ? 'video' : 'audio')));
    if (process.env.DOWNLOAD === '1') {
      const choices = result.choices.filter(choice => choice.type === (item.type === 'video' ? 'video' : 'audio'));
      const height = Number(process.env.VIDEO_HEIGHT || 360);
      const choice = item.type === 'video' ? choices.find(choice => choice.height === height && choice.audioCodec) : choices[0];
      assert.ok(choice, `a video with audio at ${height}p, or original narration`);
      const card = popup.locator(`[data-item="${item.id}"]`);
      await card.getByRole('combobox', { name: 'Quality', exact: true }).selectOption(choice.id);
      await card.getByRole('button', { name: 'Download', exact: false }).click();
      const job = await waitFor(async () => (await api('snapshot')).jobs.find(job => job.itemId === item.id), 'download started');
      await popup.close();
      let lastProgress = 0;
      const finished = await waitFor(async () => {
        const current = await worker.evaluate(id => chrome.storage.session.get('state').then(({ state }) => state.jobs.find(job => job.id === id)), job.id);
        if (Date.now() - lastProgress > 30000) { console.log('PROGRESS', item.type, current.status, current.progress, current.bytes); lastProgress = Date.now(); }
        return ['complete', 'error', 'cancelled'].includes(current.status) ? current : null;
      }, 'download did not finish', 1200, 500);
      assert.equal(finished.status, 'complete', finished.error);
      const download = await worker.evaluate(id => chrome.downloads.search({ id }).then(items => items[0]), finished.downloadId);
      assert.ok(download.filename.startsWith(downloads + path.sep));
      const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration,size', '-of', 'json', download.filename], { encoding: 'utf8' }));
      assert.ok(metadata.streams.some(stream => stream.codec_type === 'audio'));
      if (item.type === 'video') {
        assert.ok(metadata.streams.some(stream => stream.codec_type === 'video' && stream.height === choice.height));
        assert.ok(Math.abs(Number(metadata.format.duration) - item.duration) < 2, 'full episode duration preserved');
      } else assert.ok(metadata.streams.every(stream => stream.codec_type === 'audio'));
      execFileSync('ffmpeg', ['-v', 'error', '-i', download.filename, '-f', 'null', '-'], { stdio: 'pipe' });
      item.download = { file: path.basename(download.filename), metadata, fullDecode: true, popupClosed: true };
      console.log('SAVED', item.type, JSON.stringify(item.download));
      popup = await context.newPage(); await popup.goto(popupUrl);
    }
  }
  await page.waitForTimeout(1500);
  await popup.locator('body').screenshot({ path: path.join(root, 'qualities.png') });
  const rescanned = await api('rescan'); assert.equal(rescanned.ok, true);
  await page.waitForTimeout(1500);
  assert.equal((await api('snapshot')).tab.items.length, 2);
  report.rescanStable = true;
  assert.deepEqual(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()), []);
  report.rulesCleared = true;
  report.detectionPassed = true;
} catch (error) { report.error = error.message; throw error; }
finally { await writeFile(path.join(root, process.env.DOWNLOAD === '1' ? 'download-results.json' : process.env.INSPECT === '1' ? 'inspection-results.json' : 'results.json'), JSON.stringify(report, null, 2)); await context.close(); }
