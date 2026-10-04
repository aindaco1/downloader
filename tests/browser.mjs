import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from './server.mjs';

const root = path.resolve('test-results');
await mkdir(path.join(root, 'downloads'), { recursive: true });
const { server, base, requests } = await startServer();
const extension = path.resolve('extension');
const results = [];
const errors = [];
const profile = path.join(root, `profile-${Date.now()}`);
await mkdir(path.join(profile, 'Default'), { recursive: true });
await writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: path.join(root, 'downloads'), prompt_for_download: false, directory_upgrade: true } }));
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], acceptDownloads: true });
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extensionId = worker.url().split('/')[2];
const browserCDP = await context.browser().newBrowserCDPSession();
// DevTools' forced download path bypasses extension-suggested filenames. Use
// Chromium's actual filename path, scoped by this disposable profile's prefs.
await browserCDP.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true });
let popup;
const api = (type, data = {}) => popup.evaluate(message => chrome.runtime.sendMessage(message), { type, ...data });
async function waitFor(check, label, timeout = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 150)); }
  throw new Error(`Timed out: ${label}`);
}
async function openFixture(name) {
  const page = await context.newPage();
  await page.goto(`${base}/${name}`);
  const tabId = await worker.evaluate(url => new Promise(resolve => chrome.tabs.query({}, tabs => resolve(tabs.find(tab => tab.url === url)?.id))), `${base}/${name}`);
  popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  await waitFor(async () => (await api('snapshot', { tabId })).tab.items.length > 0, `automatic ${name} detection`);
  return { page, tabId };
}
function probe(file) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,duration,nb_frames:format=duration', '-of', 'json', file], { encoding: 'utf8' }));
}
async function finish(job, expectedVideo, expectedAudio = true) {
  const done = await waitFor(() => worker.evaluate(id => chrome.storage.session.get('state').then(({ state }) => { const job = state?.jobs.find(job => job.id === id); return ['complete', 'error', 'cancelled'].includes(job?.status) ? job : null; }), job.id), `download ${job.id}`);
  assert.equal(done.status, 'complete', JSON.stringify(done));
  const download = await worker.evaluate(id => chrome.downloads.search({ id }).then(items => items[0]), done.downloadId);
  assert.ok(download.filename.startsWith(root));
  console.log('SAVED FILE', JSON.stringify({ filename: path.basename(download.filename), expected: done.filename, mime: download.mime }));
  assert.ok(path.basename(download.filename).startsWith(done.filename.replace(/\.[^.]+$/, '')));
  assert.equal(path.extname(download.filename), path.extname(done.filename));
  const metadata = probe(download.filename);
  assert.equal(metadata.streams.some(stream => stream.codec_type === 'video'), expectedVideo);
  assert.equal(metadata.streams.some(stream => stream.codec_type === 'audio'), expectedAudio);
  execFileSync('ffmpeg', ['-v', 'error', '-i', download.filename, '-f', 'null', '-'], { stdio: 'pipe' });
  return { download: path.basename(download.filename), metadata };
}
try {
  for (const [name, mode, height = 360] of [['direct', 'video'], ['hls', 'video'], ['hls', 'video', 180], ['gzip-hls', 'video'], ['dash', 'video'], ['split', 'video'], ['signed', 'video'], ['direct', 'audio']]) {
    const { page, tabId } = await openFixture(name);
    let item = (await api('snapshot', { tabId })).tab.items.find(item => name === 'split' ? item.key === 'youtube:test' : name === 'hls' ? item.sources.some(source => source.url.includes('master.m3u8')) : name === 'dash' ? item.sources.some(source => source.kind === 'dash') : true);
    assert.ok(item, `${name} item exists`);
    const inspected = await api('inspect', { tabId, itemId: item.id });
    assert.equal(inspected.ok, true, JSON.stringify(inspected));
    if (name === 'hls') assert.ok(inspected.choices.some(choice => choice.height === 180) && inspected.choices.some(choice => choice.height === 360), 'real HLS quality ladder');
    const choice = inspected.choices.find(choice => choice.type === mode && (mode !== 'video' || choice.height === height));
    assert.ok(choice, `${name} has ${mode} choice`);
    console.log('INSPECT', name, mode, JSON.stringify(inspected.choices.map(({ label, type, extension, directUrl }) => ({ label, type, extension, direct: Boolean(directUrl) }))));
    const started = await api('start', { tabId, itemId: item.id, choiceId: choice.id, filename: `${name}-${mode}` });
    assert.equal(started.ok, true, JSON.stringify(started));
    if (name === 'split') await popup.close();
    const checked = await finish(started.job, mode === 'video');
    if (name === 'gzip-hls') {
      assert.ok(requests.some(request => request.path === '/high.m3u8'));
      assert.ok(requests.filter(request => request.path.endsWith('.m3u8')).every(request => !request.range), 'playlists are fetched without byte ranges');
      assert.ok(requests.some(request => request.path.endsWith('.ts') && request.range), 'media byte ranges are preserved');
    }
    if (mode === 'video') assert.equal(checked.metadata.streams.find(stream => stream.codec_type === 'video').height, height);
    results.push({ test: `${name}-${mode}${mode === 'video' ? `-${height}p` : ''}`, passed: true, ...checked });
    console.log('PASS', name, mode);
    await popup.close().catch(() => {}); await page.close();
  }
  for (const name of ['slow', 'direct?throttle=1', 'direct?throttle=1&unknown=1', 'split?throttle=1', 'split?throttle=1&faststart=1', 'dash?throttle=1']) {
    const { page, tabId } = await openFixture(name);
    const item = (await api('snapshot', { tabId })).tab.items.find(item => name === 'slow' ? item.sources.some(source => source.url.includes('master.m3u8')) : name.startsWith('split') ? item.key === 'youtube:test' : true);
    const inspected = await api('inspect', { tabId, itemId: item.id });
    assert.equal(inspected.ok, true, JSON.stringify(inspected));
    const choice = inspected.choices.find(choice => choice.type === 'video' && choice.height === 360);
    const started = await api('start', { tabId, itemId: item.id, choiceId: choice.id, filename: `progress-${name.split('?')[0]}` });
    assert.equal(started.ok, true, JSON.stringify(started));
    await popup.locator('#jobsTab').click();
    const samples = [];
    let marked = false; let captured = false; let reopened = false;
    await waitFor(async () => {
      const job = (await api('snapshot', { tabId })).jobs.find(job => job.id === started.job.id);
      const bar = popup.locator(`[data-job="${job.id}"] .job-progress`);
      if (job.status === 'processing' && await bar.count()) {
        const sample = await bar.evaluate((element, marked) => {
          const retained = !marked || element.dataset.retained === 'true';
          element.dataset.retained = 'true';
          const fill = element.firstElementChild;
          return { retained, percent: element.getAttribute('aria-valuenow'), label: element.parentElement.querySelector('.job-state').textContent,
            fill: fill.getBoundingClientRect().width, width: element.getBoundingClientRect().width, transform: getComputedStyle(fill).transform,
            color: getComputedStyle(fill).backgroundColor, motion: getComputedStyle(fill).animationName };
        }, marked);
        assert.ok(sample.retained, 'progress element survives refreshes'); marked = true;
        if (sample.percent !== null) {
          assert.match(sample.label, new RegExp(`${sample.percent}%$`));
          assert.equal(sample.color, 'rgb(70, 185, 237)');
        }
        samples.push({ bytes: job.bytes, progress: job.progress, ...sample });
        if (!captured && Number(sample.percent) >= 30) {
          await popup.locator('body').screenshot({ path: path.join(root, `progress-${name.split('?')[0]}.png`) }); captured = true;
        }
        if (name === 'slow' && !reopened && Number(sample.percent) >= 30) {
          await popup.close();
          popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
          await popup.locator('#jobsTab').click();
          marked = false; reopened = true;
        }
      }
      return ['complete', 'error', 'cancelled'].includes(job.status);
    }, `visible progress: ${name}`);
    const moving = samples.filter(sample => sample.bytes > 0);
    if (name.includes('unknown') || name === 'split?throttle=1') {
      // A tail-indexed MP4 must load its metadata before assembly can report a
      // duration-based percentage. Show genuine activity throughout that phase.
      const indeterminate = moving.filter(sample => sample.percent === null);
      assert.ok(indeterminate.length > 5, 'unknown-total phase is sampled while active');
      assert.ok(new Set(indeterminate.map(sample => sample.bytes)).size > 2, 'received bytes advance while preparing');
      if (name.includes('unknown')) assert.ok(moving.every(sample => sample.progress === null && sample.percent === null), 'unknown size does not invent a percentage');
      assert.ok(new Set(indeterminate.map(sample => sample.transform)).size > 2, 'unknown-total indicator visibly moves');
      assert.ok(indeterminate.every(sample => sample.motion === 'download-progress'));
    } else {
      const percentages = [...new Set(samples.filter(sample => Number(sample.percent) > 0).map(sample => Number(sample.percent)))];
      assert.ok(percentages.length >= 2, `percentage advances before completion: ${JSON.stringify(percentages)}`);
      assert.deepEqual(percentages, [...percentages].sort((a, b) => a - b), 'percentage never goes backwards');
      assert.ok(samples.some(sample => Number(sample.percent) >= 30 && sample.fill / sample.width > .25), 'fill is visibly wider as progress increases');
    }
    const checked = await finish(started.job, true);
    results.push({ test: `download-progress-${name}`, passed: true, reopened, samples, ...checked });
    console.log('PASS progress', name, [...new Set(samples.map(sample => sample.percent))]);
    await popup.close(); await page.close();
  }
  const { page, tabId } = await openFixture('slow');
  const item = (await api('snapshot', { tabId })).tab.items.find(item => item.sources.some(source => source.url.includes('master.m3u8')));
  const inspected = await api('inspect', { tabId, itemId: item.id });
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  const start = await api('start', { tabId, itemId: item.id, choiceId: inspected.choices[0].id, filename: 'cancel-test' });
  await waitFor(() => popup.locator('#activityMark').getAttribute('data-activity').then(value => value === 'download'), 'popup download animation');
  assert.match(await worker.evaluate(() => chrome.action.getTitle({})), /^Downloading cancel-test/);
  await api('cancel', { id: start.job.id });
  const cancelled = await waitFor(async () => (await api('snapshot', { tabId })).jobs.find(job => job.id === start.job.id && job.status === 'cancelled'), 'cancellation');
  assert.equal(cancelled.status, 'cancelled'); results.push({ test: 'cancel-slow-stream', passed: true });
  await waitFor(() => worker.evaluate(() => chrome.action.getTitle({}).then(title => title === 'Dust Wave Downloader')), 'toolbar stops after cancellation');
  await waitFor(() => popup.locator('#activityMark').getAttribute('data-activity').then(value => value !== 'download'), 'popup animation stops after cancellation');
  results.push({ test: 'installed-download-activity-and-stop', passed: true });
  await popup.close(); await page.close();
  const gallery = await openFixture('gallery');
  await popup.getByRole('button', { name: 'Choose quality' }).first().click();
  await popup.getByRole('button', { name: '↓ Download', exact: true }).first().waitFor();
  await popup.locator('body').screenshot({ path: path.join(root, 'popup.png') });
  const overflow = await popup.evaluate(() => document.documentElement.scrollWidth > 700);
  // Extension page rendered in a normal test tab; its body retains the real popup width.
  const cardWidth = await popup.locator('.media-card').first().evaluate(element => element.getBoundingClientRect().right);
  assert.ok(cardWidth <= 700);
  results.push({ test: 'quality-picker-ui', passed: true, cardRight: cardWidth, tabDocumentOverflow: overflow });
  await api('settings', { settings: { automatic: false } });
  const paused = await context.newPage(); await paused.goto(`${base}/direct`);
  const pausedId = await worker.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)?.id), `${base}/direct`);
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal((await api('snapshot', { tabId: pausedId })).tab.items.length, 0);
  await api('rescan', { tabId: pausedId });
  await waitFor(async () => (await api('snapshot', { tabId: pausedId })).tab.items.length > 0, 'manual scan while automatic detection is paused');
  results.push({ test: 'pause-and-manual-rescan', passed: true });
  await api('settings', { settings: { automatic: true } });
  assert.ok(requests.some(request => request.path === '/signed.mp4' && request.cookie && request.referer === `${base}/signed`), 'signed media used the active session and page referer');
  console.log('BROWSER TESTS PASSED', results.length);
} catch (error) {
  console.error('FAIL', error.message);
  if (popup && !popup.isClosed()) {
    console.error((await popup.locator('body').innerText()).slice(0, 2500));
    await popup.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {});
  }
  console.error('PAGE ERRORS', errors);
  process.exitCode = 1;
} finally {
  await writeFile(path.join(root, 'browser-results.json'), JSON.stringify({ extensionId, browser: context.browser().version(), results, errors }, null, 2));
  await context.close(); server.close();
}
