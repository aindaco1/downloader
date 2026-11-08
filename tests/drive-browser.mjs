import { chromium } from 'playwright';
import https from 'node:https';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(process.env.RESULTS_DIR || 'test-results/drive-regression');
await mkdir(path.join(root, 'downloads'), { recursive: true });
const profile = path.join(root, `profile-${Date.now()}`);
await mkdir(path.join(profile, 'Default'), { recursive: true });
await writeFile(path.join(profile, 'Default/Preferences'), JSON.stringify({ download: { default_directory: path.join(root, 'downloads'), prompt_for_download: false } }));
const key = path.join(root, 'fixture-key.pem'); const cert = path.join(root, 'fixture-cert.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-subj', '/CN=drive.usercontent.google.com', '-days', '1'], { stdio: 'pipe' });
const certificate = await readFile(cert);
const fingerprint = createHash('sha256').update(createPublicKey(certificate).export({ type: 'spki', format: 'der' })).digest('base64');
const bytes = await readFile('tests/fixtures/drive-original.mov');
const poster = await readFile('tests/fixtures/poster.png');
const requests = []; const results = []; const errors = [];
let port;
const server = https.createServer({ key: await readFile(key), cert: certificate }, async (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const id = url.searchParams.get('id');
  requests.push({ path: url.pathname, id, confirmed: url.searchParams.get('confirm') === 't', range: req.headers.range, cookie: req.headers.cookie?.includes('drive_fixture=yes') || false, referer: req.headers.referer });
  const fileId = url.pathname.match(/^\/file\/d\/([\w-]+)\/view$/)?.[1];
  if (fileId) {
    const itemJson = Array(67).fill(null);
    Object.assign(itemJson, { 1: 'Drive fixture.mov', 2: `https://drive.google.com:${port}/poster.png`, 11: 'video/quicktime', 18: `https://drive.usercontent.google.com:${port}/u/2/uc?id=${fileId}&export=download&resourcekey=fixture-key`, 25: [null, null, String(bytes.length)] });
    if (fileId === 'fixtureDriveNoLink') itemJson[18] = null;
    const viewer = { config: { id: fileId, title: 'Drive fixture.mov', documentResourceKey: 'fixture-key' }, itemJson };
    res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Drive fixture.mov - Google Drive</title><h1>Drive media fixture</h1><script>setTimeout(()=>{window.viewerData=${JSON.stringify(viewer)};document.body.append(document.createElement('span'));},300);</script>`); return;
  }
  if (url.pathname === '/poster.png') { res.writeHead(200, { 'content-type': 'image/png' }).end(poster); return; }
  if (!['/u/2/uc', '/download'].includes(url.pathname)) { res.writeHead(404).end(); return; }
  if (!req.headers.cookie?.includes('drive_fixture=yes') || id === 'fixtureDriveDenied') { res.writeHead(403).end(); return; }
  if (!req.headers.referer?.includes(`/file/d/${id}/view`)) { res.writeHead(401).end(); return; }
  if (!url.searchParams.has('confirm')) {
    const challenge = id === 'fixtureDriveCaptcha' ? '<input type="hidden" name="g-recaptcha-response" value="required">' : '';
    res.writeHead(200, { 'content-type': 'text/html' }).end(`<html><body><p>This file is too large for Google to scan for viruses.</p><form id="download-form" method="get" action="https://drive.usercontent.google.com:${port}/download"><input type="hidden" name="id" value="${id}"><input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="fixture-fresh-token">${challenge}</form></body></html>`); return;
  }
  if (url.searchParams.get('authuser') !== '2' || url.searchParams.get('resourcekey') !== 'fixture-key') { res.writeHead(403).end(); return; }
  const headers = { 'content-type': 'video/quicktime', 'content-disposition': 'attachment; filename="Drive fixture.mov"', 'accept-ranges': 'bytes' };
  let body = bytes; let status = 200;
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  if (range) { const start = Number(range[1]); const end = Math.min(Number(range[2] || bytes.length - 1), bytes.length - 1); headers['content-range'] = `bytes ${start}-${end}/${bytes.length}`; body = bytes.subarray(start, end + 1); status = 206; }
  headers['content-length'] = String(body.length);
  res.writeHead(status, headers);
  if (id === 'fixtureDriveSlow' && !range) {
    for (let i = 0; i < body.length && !res.destroyed; i += 4096) { res.write(body.subarray(i, i + 4096)); await new Promise(resolve => setTimeout(resolve, 50)); }
    res.end();
  } else res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); port = server.address().port;
const extension = path.resolve(process.env.EXTENSION_DIR || 'extension');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, acceptDownloads: true, ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP drive.google.com 127.0.0.1, MAP drive.usercontent.google.com 127.0.0.1', `--ignore-certificate-errors-spki-list=${fingerprint}`],
});
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await context.addCookies([{ name: 'drive_fixture', value: 'yes', domain: 'drive.usercontent.google.com', path: '/', secure: true, httpOnly: true, sameSite: 'None' }]);
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extensionId = worker.url().split('/')[2];
const cdp = await context.browser().newBrowserCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true });
async function waitFor(check, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error(`Timed out: ${label}`);
}
async function open(id, hasMedia = true) {
  const page = await context.newPage(); const url = `https://drive.google.com:${port}/file/d/${id}/view`;
  await page.goto(url);
  const tabId = await worker.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)?.id), url);
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  const api = (type, extra = {}) => popup.evaluate(message => chrome.runtime.sendMessage(message), { type, tabId, ...extra });
  if (hasMedia) await waitFor(async () => (await api('snapshot')).tab.items.length === 1, 'Drive media discovery');
  return { page, popup, tabId, api };
}
try {
  const main = await open('fixtureDriveVideo');
  const item = (await main.api('snapshot')).tab.items[0];
  assert.equal(item.key, 'drive:fixtureDriveVideo'); assert.equal(item.title, 'Drive fixture.mov');
  await main.popup.locator('#rescan').click(); await main.page.waitForTimeout(1000);
  assert.equal((await main.api('snapshot')).tab.items.length, 1);
  await main.popup.getByRole('button', { name: 'Choose quality', exact: true }).click();
  await main.popup.getByLabel('Quality', { exact: true }).waitFor();
  const snapshot = await main.api('snapshot'); const inspected = snapshot.tab.items[0].inspection;
  assert.equal(inspected.choices[0].extension, 'mov'); assert.match(inspected.notice, /cannot scan/);
  assert.equal(inspected.choices[0].original, true); assert.ok(!JSON.stringify(snapshot).includes('fixture-fresh-token'));
  assert.match(await main.popup.locator('.detail').innerText(), /Original file/);
  assert.equal(await main.popup.locator('.media-card').count(), 1);
  await main.popup.locator('body').screenshot({ path: path.join(root, 'drive-original-choice.png') });
  results.push({ test: 'one Drive card after late viewer metadata and rescan; original MOV choice and large-file notice; confirmation token stays transient', passed: true });
  await main.popup.getByRole('button', { name: '↓ Download', exact: true }).click();
  const job = await waitFor(async () => (await main.api('snapshot')).jobs[0], 'download start');
  await main.popup.close();
  const done = await waitFor(() => worker.evaluate(id => chrome.storage.session.get('state').then(({ state }) => state?.jobs.find(j => j.id === id && ['complete', 'error', 'cancelled'].includes(j.status))), job.id), 'original MOV saved');
  assert.equal(done.status, 'complete', JSON.stringify(done));
  const saved = await worker.evaluate(id => chrome.downloads.search({ id }).then(items => items[0]), done.downloadId);
  assert.equal(path.basename(saved.filename), 'Drive fixture.mov'); assert.ok(saved.filename.startsWith(root+path.sep));
  assert.deepEqual(await readFile(saved.filename), bytes);
  execFileSync('ffmpeg', ['-v', 'error', '-i', saved.filename, '-f', 'null', '-'], { stdio: 'pipe' });
  assert.deepEqual(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()), []);
  results.push({ test: 'authenticated confirmation then exact original MOV bytes saved with popup closed; full decode and rule cleanup', passed: true, bytes: bytes.length });
  await main.page.close();

  for (const [id, expected] of [['fixtureDriveDenied', /refused/], ['fixtureDriveCaptcha', /confirmation/]]) {
    const denied = await open(id); const item = (await denied.api('snapshot')).tab.items[0];
    const inspected = await denied.api('inspect', { itemId: item.id });
    assert.equal(inspected.ok, false); assert.match(inspected.error, expected);
    assert.deepEqual(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()), []);
    await denied.popup.close(); await denied.page.close();
  }
  const missing = await open('fixtureDriveNoLink', false);
  await missing.page.waitForTimeout(1200); await missing.api('rescan');
  assert.equal((await missing.api('snapshot')).tab.items.length, 0);
  await missing.popup.close(); await missing.page.close();
  results.push({ test: 'denied permission and CAPTCHA never become a download; absent original link produces no invented source', passed: true });

  const slow = await open('fixtureDriveSlow'); const slowItem = (await slow.api('snapshot')).tab.items[0];
  assert.equal((await slow.api('inspect', { itemId: slowItem.id })).ok, true);
  const started = await slow.api('start', { itemId: slowItem.id, choiceId: '0', filename: 'cancel-drive' });
  assert.equal(started.ok, true);
  await waitFor(async () => (await slow.api('snapshot')).jobs.some(j => j.id === started.job.id && j.bytes > 0), 'visible Drive byte progress');
  await slow.api('cancel', { id: started.job.id });
  await waitFor(async () => (await slow.api('snapshot')).jobs.some(j => j.id === started.job.id && j.status === 'cancelled'), 'Drive cancellation');
  assert.deepEqual(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()), []);
  await slow.popup.close(); await slow.page.close();
  results.push({ test: 'original-file transfer reports byte progress and cancels with request rules removed', passed: true });
  assert.ok(requests.some(r => r.confirmed && r.range === 'bytes=0-0' && r.cookie));
  assert.ok(requests.some(r => r.confirmed && !r.range && r.cookie));
  assert.deepEqual(errors, []);
  console.log('DRIVE REGRESSIONS PASSED', results.length);
} finally {
  await writeFile(path.join(root, 'results.json'), JSON.stringify({ browser: context.browser().version(), results, errors, requests }, null, 2));
  await context.close(); await new Promise(resolve => server.close(resolve));
}
