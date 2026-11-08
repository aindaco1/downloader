import { chromium } from 'playwright';
import https from 'node:https';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(process.env.RESULTS_DIR || 'test-results/youtube-client-regression');
const downloads = path.join(root, 'downloads');
const profile = path.join(root, `profile-${Date.now()}`);
await mkdir(downloads, { recursive: true }); await mkdir(path.join(profile, 'Default'), { recursive: true });
await writeFile(path.join(profile, 'Default/Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false } }));
const key = path.join(root, 'fixture-key.pem'); const cert = path.join(root, 'fixture-cert.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-subj', '/CN=r.googlevideo.com', '-days', '1'], { stdio: 'pipe' });
const certificate = await readFile(cert);
const fingerprint = createHash('sha256').update(createPublicKey(certificate).export({ type: 'spki', format: 'der' })).digest('base64');
const bytes = await readFile('tests/fixtures/combined.mp4'); const poster = await readFile('tests/fixtures/poster.png');
for (const [name, size, codec] of [['4k.webm', '3840x1634', 'libvpx-vp9'], ['1080.mp4', '1920x816', 'libx264']]) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=blue:size=${size}:rate=2`, '-t', '6', '-c:v', codec, ...(codec === 'libvpx-vp9' ? ['-deadline', 'realtime', '-cpu-used', '8'] : ['-preset', 'ultrafast']), path.join(root, name)], { stdio: 'pipe' });
}
const highFiles = { 313: await readFile(path.join(root, '4k.webm')), 137: await readFile(path.join(root, '1080.mp4')), 140: await readFile('tests/fixtures/audio.m4a') };
const results = []; const errors = []; let port;
const server = https.createServer({ key: await readFile(key), cert: certificate }, (req, res) => {
  const url = new URL(req.url, 'https://fixture.invalid');
  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v');
    const player = { videoDetails: { videoId: id, title: 'Public client fixture', lengthSeconds: '6', thumbnail: { thumbnails: [{ url: `https://www.youtube.com:${port}/poster.png` }] } }, streamingData: { serverAbrStreamingUrl: 'https://r.googlevideo.com/videoplayback?sabr=1' } };
    const processor = id === 'highres0001' ? `window.ytcfg={get:()=>20760};window._yt_player={renamed:class {constructor(value){this.url=new URL(value)}get(k){return this.url.searchParams.get(k)}set(k,v){this.url.searchParams.set(k,v)}clone(){return this}serialize(){this.set('n','prepared');return this.url.href}}};` : '';
    res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Public client fixture - YouTube</title><h1>YouTube fixture</h1><script>window.ytInitialPlayerResponse=${JSON.stringify(player)};${processor}</script>`); return;
  }
  if (url.pathname === '/poster.png') { res.writeHead(200, { 'content-type': 'image/png' }).end(poster); return; }
  if (url.pathname !== '/videoplayback') { res.writeHead(404).end(); return; }
  if (!req.headers.referer?.includes('/watch?v=')) { res.writeHead(403).end(); return; }
  const itag = url.searchParams.get('itag');
  if (highFiles[itag] && url.searchParams.get('n') !== 'prepared') { res.writeHead(403).end(); return; }
  const media = highFiles[itag] || bytes;
  let body = media; let status = 200;
  const headers = { 'content-type': itag === '313' ? 'video/webm' : 'video/mp4', 'accept-ranges': 'bytes' };
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  if (range) {
    const start = Number(range[1]); const end = Math.min(Number(range[2] || media.length - 1), media.length - 1);
    status = 206; body = media.subarray(start, end + 1); headers['content-range'] = `bytes ${start}-${end}/${media.length}`;
  }
  headers['content-length'] = String(body.length); res.writeHead(status, headers).end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); port = server.address().port;
const extension = path.resolve(process.env.EXTENSION_DIR || 'extension');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, acceptDownloads: true, ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP www.youtube.com 127.0.0.1, MAP r.googlevideo.com 127.0.0.1', `--ignore-certificate-errors-spki-list=${fingerprint}`],
});
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'); const extensionId = worker.url().split('/')[2];
const cdp = await context.browser().newBrowserCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true });
async function waitFor(check, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error(`Timed out: ${label}`);
}
async function open(id) {
  assert.match(id, /^[\w-]{11}$/);
  await worker.evaluate(port => {
    globalThis.lookupCalls = []; globalThis.realFetch ||= globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://www.youtube.com/')) return realFetch(url, options);
      const body = options.body && JSON.parse(options.body);
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      lookupCalls.push({ method: options.method || 'GET', credentials: options.credentials, client: body?.context.client.clientName, clientHeader: options.headers?.['X-YouTube-Client-Name'], userAgent: body?.context.client.userAgent, ruleUserAgent: rules.find(rule => rule.id === 2)?.action.requestHeaders.find(header => header.header === 'User-Agent')?.value });
      if (!body) return new Response(JSON.stringify({ visitorData: 'fixture_visitor_data', ...(new URL(url).searchParams.get('v')?.startsWith('high') ? { STS: 20760 } : {}) }));
      const id = body.videoId;
      if (id === 'logintest01') return new Response(JSON.stringify({ playabilityStatus: { status: 'LOGIN_REQUIRED' }, videoDetails: { videoId: id } }));
      if (body.context.client.clientName === 'VISIONOS' && id !== 'adulttest01') return new Response(JSON.stringify({ playabilityStatus: { status: 'UNPLAYABLE', reason: 'This video is not available' }, videoDetails: { videoId: id } }));
      if (id === 'deniedtest1') return new Response(null, { status: 403 });
      if (body.context.client.clientName === 'TVHTML5') return new Response(JSON.stringify({ playabilityStatus: { status: 'OK' }, videoDetails: { videoId: id }, streamingData: { adaptiveFormats: [
        { itag: 313, width: 3840, height: 1634, mimeType: 'video/webm; codecs="vp9"' },
        { itag: 137, width: 1920, height: 816, mimeType: 'video/mp4; codecs="avc1.640028"' },
        { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"' },
      ].map(format => ({ ...format, url: `https://r.googlevideo.com:${port}/videoplayback?itag=${format.itag}&n=original` })) } }));
      return new Response(JSON.stringify({ playabilityStatus: { status: 'OK' }, videoDetails: { videoId: id }, streamingData: { formats: [{ url: `https://r.googlevideo.com:${port}/videoplayback?itag=18`, mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', height: 360, width: 640, fps: 30 }] } }));
    };
  }, port);
  const url = `https://www.youtube.com:${port}/watch?v=${id}`; const page = await context.newPage(); await page.goto(url);
  const tabId = await worker.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)?.id), url);
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  const api = (type, extra = {}) => popup.evaluate(message => chrome.runtime.sendMessage(message), { type, tabId, ...extra });
  const item = await waitFor(async () => (await api('snapshot')).tab.items[0], 'YouTube card');
  assert.equal(item.key, `youtube:${id}`);
  await popup.getByRole('button', { name: 'Choose quality', exact: true }).click();
  return { page, popup, api, item, tabId };
}
try {
  const fallback = await open('kidstest001');
  const inspected = await waitFor(async () => (await fallback.api('snapshot')).tab.items[0].inspection, 'Android quality inspection');
  const calls = await worker.evaluate(() => lookupCalls);
  assert.deepEqual(calls.filter(call => call.method === 'POST').map(call => call.client), ['VISIONOS', 'ANDROID']);
  assert.ok(calls.every(call => call.credentials === 'omit'));
  assert.ok(calls.filter(call => call.method === 'POST').every(call => call.ruleUserAgent === call.userAgent));
  assert.equal(calls.at(-1).clientHeader, '3');
  assert.ok(inspected.choices.some(choice => choice.height === 360 && choice.audioCodec === 'aac'));
  assert.ok(inspected.choices.some(choice => choice.type === 'audio'));
  assert.equal((await fallback.api('snapshot')).tab.items.length, 1);
  assert.deepEqual(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()), []);
  await fallback.popup.locator('body').screenshot({ path: path.join(root, 'android-choice.png') });
  results.push({ test: 'one card; anonymous VISIONOS to Android lookup; matching request identity; real video and audio inspection', passed: true });
  await fallback.popup.getByRole('button', { name: '↓ Download', exact: true }).click();
  const job = await waitFor(async () => (await fallback.api('snapshot')).jobs[0], 'download job'); await fallback.popup.close();
  const done = await waitFor(() => worker.evaluate(id => chrome.storage.session.get('state').then(({ state }) => state.jobs.find(job => job.id === id && ['complete', 'error', 'cancelled'].includes(job.status))), job.id), 'saved video');
  assert.equal(done.status, 'complete', done.error);
  const download = await worker.evaluate(id => chrome.downloads.search({ id }).then(items => items[0]), done.downloadId);
  assert.ok(download.filename.startsWith(downloads + path.sep));
  const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration', '-of', 'json', download.filename], { encoding: 'utf8' }));
  assert.ok(metadata.streams.some(stream => stream.codec_type === 'video' && stream.height === 360));
  assert.ok(metadata.streams.some(stream => stream.codec_type === 'audio' && stream.codec_name === 'aac'));
  assert.ok(Math.abs(Number(metadata.format.duration) - 6) < .1);
  execFileSync('ffmpeg', ['-v', 'error', '-i', download.filename, '-f', 'null', '-'], { stdio: 'pipe' });
  assert.deepEqual(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()), []); await fallback.page.close();
  results.push({ test: 'complete 360p video with AAC saved with popup closed; full decode and rule cleanup', passed: true });
  const normal = await open('adulttest01');
  await waitFor(async () => (await normal.api('snapshot')).tab.items[0].inspection, 'primary client inspection');
  assert.deepEqual(await worker.evaluate(() => lookupCalls.filter(call => call.method === 'POST').map(call => call.client)), ['VISIONOS']);
  await normal.popup.close(); await normal.page.close();
  results.push({ test: 'a working primary client does not call Android', passed: true });
  for (const [id, pattern, count] of [['deniedtest1', /lookup failed/, 2], ['logintest01', /account or playback verification/, 1]]) {
    const refused = await open(id);
    await waitFor(async () => pattern.test(await refused.popup.locator('.card-status.error').innerText().catch(() => '')), 'specific terminal error');
    assert.equal(await worker.evaluate(() => lookupCalls.filter(call => call.method === 'POST').length), count);
    assert.deepEqual(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()), []);
    assert.equal((await refused.api('snapshot')).tab.items[0].sources.length, 0);
    await refused.popup.close(); await refused.page.close();
  }
  results.push({ test: 'alternate HTTP refusal and account requirement remain terminal, preserve sources and clear request rules', passed: true });
  const higher = await open('highres0001');
  const highInspection = await waitFor(async () => (await higher.api('snapshot')).tab.items[0].inspection, 'prepared adaptive tracks');
  assert.deepEqual(highInspection.choices.filter(choice => choice.type === 'video').map(choice => choice.height), [1634, 816, 360]);
  assert.ok(highInspection.choices.filter(choice => choice.type === 'video').every(choice => choice.audioCodec === 'aac'));
  const highCalls = await worker.evaluate(() => lookupCalls);
  assert.deepEqual(highCalls.filter(call => call.method === 'POST').map(call => call.client), ['VISIONOS', 'ANDROID', 'TVHTML5']);
  assert.ok(highCalls.every(call => call.credentials === 'omit'));
  assert.ok(highCalls.filter(call => call.method === 'POST').every(call => call.ruleUserAgent === call.userAgent));
  assert.deepEqual(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()), []);
  await higher.popup.locator('body').screenshot({ path: path.join(root, 'high-quality-choices.png') });
  const chosen = highInspection.choices.find(choice => choice.height === 1634);
  const start = await higher.api('start', { itemId: higher.item.id, choiceId: chosen.id, filename: 'prepared-4k-with-audio' });
  assert.equal(start.ok, true, start.error); await higher.popup.close();
  const saved = await waitFor(() => worker.evaluate(id => chrome.storage.session.get('state').then(({ state }) => state.jobs.find(job => job.id === id && ['complete', 'error', 'cancelled'].includes(job.status))), start.job.id), 'saved 4K with audio');
  assert.equal(saved.status, 'complete', saved.error);
  const highDownload = await worker.evaluate(id => chrome.downloads.search({ id }).then(items => items[0]), saved.downloadId);
  const highMetadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration', '-of', 'json', highDownload.filename], { encoding: 'utf8' }));
  assert.ok(highMetadata.streams.some(stream => stream.codec_name === 'vp9' && stream.width === 3840 && stream.height === 1634));
  assert.ok(highMetadata.streams.some(stream => stream.codec_type === 'audio' && stream.codec_name === 'aac'));
  assert.ok(Math.abs(Number(highMetadata.format.duration) - 6) < .1);
  execFileSync('ffmpeg', ['-v', 'error', '-i', highDownload.filename, '-f', 'null', '-'], { stdio: 'pipe' });
  assert.deepEqual(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()), []); await higher.page.close();
  results.push({ test: '4K and 1080p prepared in the matching page, inspected and paired with AAC; complete 4K MP4 saved with popup closed and fully decoded', passed: true });
  const missing = await open('highmissing');
  const missingInspection = await waitFor(async () => (await missing.api('snapshot')).tab.items[0].inspection, 'missing page processor fallback');
  assert.deepEqual(missingInspection.choices.filter(choice => choice.type === 'video').map(choice => choice.height), [360]);
  assert.deepEqual(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()), []);
  await missing.popup.close(); await missing.page.close();
  results.push({ test: 'missing page processor retains the working Android choice and removes temporary rules', passed: true });
  assert.deepEqual(errors, []); console.log('YOUTUBE CLIENT REGRESSIONS PASSED', results.length);
} finally {
  await writeFile(path.join(root, 'results.json'), JSON.stringify({ browser: context.browser().version(), results, errors }, null, 2));
  await context.close(); server.close();
}
