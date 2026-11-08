import { chromium } from 'playwright';
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(process.env.RESULTS_DIR || 'test-results/twitter-regression');
await mkdir(path.join(root, 'downloads'), { recursive: true });
const profile = path.join(root, `profile-${Date.now()}`);
await mkdir(path.join(profile, 'Default'), { recursive: true });
await writeFile(path.join(profile, 'Default/Preferences'), JSON.stringify({ download: { default_directory: path.join(root, 'downloads'), prompt_for_download: false } }));
// The offscreen engine bypasses Playwright routes, so serve media over real
// HTTP with a host mapping confined to this disposable browser.
const requests = [];
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://video.twimg.com');
    requests.push(url.pathname + url.search);
    if (url.pathname === '/fixture') {
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><title>One X video</title><h1>One X video</h1><button onclick="readAll()">Repeat discovery</button><button onclick="secondClip()">Second clip</button><script>window.secondUrls=${JSON.stringify([`${base}/vid/avc1/640x360/movie.mp4?token=keep`, urls[0].replace('2118079583056740352', '2118079583056740353')])}; window.secondClip=()=>{sessionStorage.setItem('second','1'); return readAll();}; window.urls=${JSON.stringify([...urls, ...fragments])}; window.readAll=()=>Promise.all([...urls,...(sessionStorage.getItem('second')?secondUrls:[])].map(url=>fetch(url).then(r=>r.text()))); readAll();</script>`);
      return;
    }
    let file = path.basename(url.pathname);
    if (file.startsWith('variant-')) file = Number(file.match(/\d+/)[0]) % 2 ? 'low.m3u8' : 'high.m3u8';
    if (file.endsWith('.mp4')) file = 'combined.mp4';
    let body = await readFile(path.join('tests/fixtures', file));
    if (file === 'master.m3u8') body = Buffer.from(body.toString().replaceAll('high.m3u8', 'avc1/variant-0.m3u8?signature=keep-0').replaceAll('low.m3u8', 'avc1/variant-1.m3u8?signature=keep-1'));
    const contentType = file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : file.endsWith('.ts') ? 'video/mp2t' : 'video/mp4';
    const headers = { 'content-type': contentType, 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
    const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    let status = 200;
    if (range && !file.endsWith('.m3u8')) {
      const start = Number(range[1]); const end = Math.min(Number(range[2] || body.length - 1), body.length - 1);
      headers['content-range'] = `bytes ${start}-${end}/${body.length}`; body = body.subarray(start, end + 1); status = 206;
    }
    res.writeHead(status, headers).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const extension = path.resolve(process.env.EXTENSION_DIR || 'extension');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, acceptDownloads: true, ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP video.twimg.com 127.0.0.1'],
});
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extensionId = worker.url().split('/')[2];
const cdp = await context.browser().newBrowserCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true });
const results = [];
const base = `http://video.twimg.com:${port}/amplify_video/2118079583056740352`;
const urls = ['pl/master.m3u8?v=e4d', ...Array.from({ length: 7 }, (_, i) => `pl/avc1/variant-${i}.m3u8?signature=keep-${i}`)].map(p => `${base}/${p}`);
const fragments = ['aud/mp4a/0/0/32000/audio.mp4', 'aud/mp4a/0/0/128000/audio.mp4', 'vid/avc1/0/0/640x360/video.mp4', 'vid/avc1/0/0/1920x1080/video.mp4'].map(p => `${base}/${p}`);
async function waitFor(check, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error(`Timed out: ${label}`);
}
try {
  const pageUrl = `http://127.0.0.1:${port}/fixture`;
  const page = await context.newPage(); await page.goto(pageUrl);
  const tabId = await worker.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)?.id), pageUrl);
  let popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  const api = (type, extra = {}) => popup.evaluate(message => chrome.runtime.sendMessage(message), { type, tabId, ...extra });
  let snap = await waitFor(async () => { const s = await api('snapshot'); return s.tab.items.length === 1 && s.tab.items[0].sources.length === 8 ? s : null; }, 'eight observed playlists grouped');
  const item = snap.tab.items[0];
  assert.equal(item.key, 'twitter:amplify_video:2118079583056740352');
  assert.deepEqual(item.sources.map(s => s.url).sort(), [...urls].sort());
  await waitFor(() => popup.locator('.media-card').count().then(count => count === 1), 'one visible card');
  assert.equal(await popup.locator('#mediaTab').innerText(), 'On this page 1');
  await popup.locator('body').screenshot({ path: path.join(root, 'one-card.png') });
  assert.ok(fragments.every(url => requests.includes(new URL(url).pathname)), 'all four initialization files were requested');
  results.push({ test: 'eight playlists and four initialization files display one card with only the eight downloadable source URLs unchanged', passed: true });

  await page.getByRole('button', { name: 'Repeat discovery', exact: true }).click();
  await popup.locator('#rescan').click();
  await page.waitForTimeout(1200);
  snap = await api('snapshot');
  assert.equal(snap.tab.items.length, 1); assert.equal(snap.tab.items[0].id, item.id); assert.equal(snap.tab.items[0].sources.length, 8);
  results.push({ test: 'repeated requests and popup rescan retain one stable card', passed: true });

  await popup.getByRole('button', { name: 'Choose quality', exact: true }).click();
  await popup.getByLabel('Quality', { exact: true }).waitFor();
  snap = await api('snapshot');
  const choices = snap.tab.items[0].inspection.choices;
  assert.ok(choices.some(c => c.type === 'video' && c.height === 180));
  assert.ok(choices.some(c => c.type === 'video' && c.height === 360 && c.audioCodec));
  assert.ok(choices.some(c => c.type === 'audio'));
  const selected = choices.find(c => c.type === 'video' && c.height === 360 && c.audioCodec);
  await popup.getByLabel('Quality', { exact: true }).selectOption(selected.id);
  await popup.getByRole('button', { name: '↓ Download', exact: true }).click();
  const job = await waitFor(async () => (await api('snapshot')).jobs[0], 'download started');
  await popup.close();
  const done = await waitFor(() => worker.evaluate(id => chrome.storage.session.get('state').then(({ state }) => state?.jobs.find(job => job.id === id && ['complete', 'error', 'cancelled'].includes(job.status))), job.id), 'download saved', 60000);
  assert.equal(done.status, 'complete', JSON.stringify(done));
  const download = await worker.evaluate(id => chrome.downloads.search({ id }).then(items => items[0]), done.downloadId);
  assert.ok(download.filename.startsWith(root + path.sep));
  const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration', '-of', 'json', download.filename], { encoding: 'utf8' }));
  assert.ok(metadata.streams.some(s => s.codec_type === 'video' && s.height === 360));
  assert.ok(metadata.streams.some(s => s.codec_type === 'audio'));
  execFileSync('ffmpeg', ['-v', 'error', '-i', download.filename, '-f', 'null', '-'], { stdio: 'pipe' });
  assert.deepEqual(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()), []);
  results.push({ test: 'one card offers both video qualities and original audio; complete video saves and decodes with popup closed', passed: true, metadata });

  popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  await page.getByRole('button', { name: 'Second clip', exact: true }).click();
  snap = await waitFor(async () => { const s = await api('snapshot'); return s.tab.items.length === 2 && s.tab.items.find(i => i.id === item.id)?.sources.some(s => s.kind === 'file') ? s : null; }, 'second clip stays separate');
  assert.equal(snap.tab.items.find(i => i.id === item.id).sources.length, 9);
  await waitFor(() => popup.locator('.media-card').count().then(count => count === 2), 'two distinct clip cards');
  results.push({ test: 'direct MP4 joins its existing card while another clip with the same title stays separate', passed: true });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('X REGRESSIONS PASSED', results.length);
} finally {
  await writeFile(path.join(root, 'results.json'), JSON.stringify({ browser: context.browser().version(), results, errors, requests }, null, 2));
  await context.close();
  await new Promise(resolve => server.close(resolve));
}
