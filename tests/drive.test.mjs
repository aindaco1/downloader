import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { drivePageId, driveDownloadId, driveExtension, driveMedia } from '../src/drive.js';
import { driveConfirmation, fetchDriveDownload, DRIVE_SCAN_NOTICE } from '../src/drive-download.js';
import { upsert, safeFilename, readableError } from '../src/core.js';

const id = 'driveExampleFile_12345';
const page = `https://drive.google.com/file/d/${id}/view`;
const download = `https://drive.usercontent.google.com/u/2/uc?id=${id}&export=download&resourcekey=shared-key`;
const confirmed = `https://drive.usercontent.google.com/download?id=${id}&export=download`;
function viewer() {
  const itemJson = Array(67).fill(null);
  Object.assign(itemJson, { 1: 'My movie.mov', 2: 'https://drive.google.com/thumbnail.jpg', 11: 'video/quicktime', 18: download, 25: [null, null, '1316746153'] });
  return { config: { id, title: 'My movie.mov', documentResourceKey: 'shared-key' }, itemJson };
}
const html = (fields = '') => `<html><body><p>This file is too large for Google to scan for viruses.</p><form id="download-form" action="https://drive.usercontent.google.com/download" method="get"><input type="hidden" name="id" value="${id}"><input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="temporary-confirmation">${fields}</form></body></html>`;
const response = (body, options, url = confirmed) => Object.defineProperty(new Response(body, options), 'url', { value: url });

test('Drive file identity supports viewer, account-specific, preview and shared open links only', () => {
  for (const url of [page, `https://drive.google.com/file/u/2/d/${id}/preview`, `https://drive.google.com/open?id=${id}`]) assert.equal(drivePageId(url), id);
  for (const url of [page.replace('drive.google.com', 'drive.google.com.example.org'), `https://drive.google.com/drive/folders/${id}`, 'https://example.org/open?id='+id]) assert.equal(drivePageId(url), null);
  assert.equal(driveDownloadId(download), id);
  for (const url of [download.replace('https:', 'http:'), download.replace('drive.usercontent.google.com', 'example.org'), download.replace('export=download', 'export=view'), page]) assert.equal(driveDownloadId(url), null);
});

test('Drive viewer metadata produces one original-file card and preserves account/resource key', () => {
  const data = viewer(); const items = [];
  for (let n = 0; n < 3; n++) for (const raw of driveMedia(data, page)) upsert(items, raw, { pageUrl: page });
  assert.equal(items.length, 1); assert.equal(items[0].sources.length, 1); assert.equal(items[0].key, `drive:${id}`);
  assert.equal(items[0].sources[0].url, download); assert.equal(items[0].sources[0].size, 1316746153);
  assert.equal(items[0].thumbnail, data.itemJson[2]);
  data.itemJson[18] = download.replace('&resourcekey=shared-key', '');
  assert.equal(driveMedia(data, page)[0].sources[0].url, download);
  assert.equal(safeFilename('My movie.mov', 'mov'), 'My movie.mov');
});

test('Drive rejects stale identities, missing download permission, foreign URLs and non-media documents', () => {
  for (const modify of [v => v.config.id = 'another_file_id', v => v.itemJson[18] = null, v => v.itemJson[18] = download.replace(id, 'another_file_id'), v => v.itemJson[18] = download.replace('drive.usercontent.google.com', 'example.org'), v => v.itemJson[11] = 'application/pdf']) {
    const data = viewer(); modify(data); assert.deepEqual(driveMedia(data, page), []);
  }
  assert.deepEqual(driveMedia(viewer(), 'https://example.com/'), []);
  assert.equal(driveExtension('audio/mp4', 'Track.m4a'), 'm4a');
  assert.equal(driveExtension('video/mp4', 'movie.exe'), 'mp4');
});

test('large-file confirmation retains the matching file, account, resource key and fresh token', () => {
  const url = new URL(driveConfirmation(html(), confirmed, download, DOMParser));
  assert.equal(url.searchParams.get('id'), id); assert.equal(url.searchParams.get('confirm'), 't');
  assert.equal(url.searchParams.get('uuid'), 'temporary-confirmation'); assert.equal(url.searchParams.get('authuser'), '2');
  assert.equal(url.searchParams.get('resourcekey'), 'shared-key');
});

test('Drive confirmation declines login, CAPTCHA, malware, quota, different files and off-site forms', () => {
  const cases = [html().replace('https://drive.usercontent.google.com/download', 'https://evil.example/download'), html().replace(`value="${id}"`, 'value="different_file"'), html().replace('method="get"', 'method="post"'), html('<input type="hidden" name="g-recaptcha-response" value="required">'), html('<input type="hidden" name="id" value="duplicate">'), '<html><body>Download quota exceeded</body></html>', '<form action="https://accounts.google.com/">Sign in</form>', html().replace('too large for Google to scan for viruses', 'infected with a virus')];
  for (const text of cases) assert.throws(() => driveConfirmation(text, confirmed, download, DOMParser), { code: 'DRIVE_DOWNLOAD' });
  assert.throws(() => driveConfirmation(html(), 'https://accounts.google.com/ServiceLogin', download, DOMParser), /sign in/);
});

test('Drive resolves a large-file confirmation once and keeps credentials and byte range on both requests', async () => {
  const calls = [];
  const resolved = await fetchDriveDownload(download, { headers: { Range: 'bytes=0-0' } }, async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? response(html(), { headers: { 'content-type': 'text/html' } }) : response('x', { status: 206, headers: { 'content-type': 'video/quicktime', 'content-range': 'bytes 0-0/1316746153' } });
  }, DOMParser);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.options.credentials === 'include' && new Headers(call.options.headers).get('range') === 'bytes=0-0'));
  assert.equal(resolved.notice, DRIVE_SCAN_NOTICE); assert.equal(await resolved.response.text(), 'x');
});

test('Drive never saves sign-in/confirmation HTML or silently retries permission and partial-file failures', async () => {
  let calls = 0;
  await assert.rejects(fetchDriveDownload(download, {}, async () => { calls++; return response(html(), { headers: { 'content-type': 'text/html' } }); }, DOMParser), /still requires confirmation/);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(fetchDriveDownload(download, {}, async () => { calls++; return response('', { status: 403 }); }, DOMParser), /refused/);
  assert.equal(calls, 1);
  await assert.rejects(fetchDriveDownload(download, {}, async () => response('x', { status: 206, headers: { 'content-type': 'video/mp4' } })), /only part/);
  await assert.rejects(fetchDriveDownload(download, {}, async () => response('x', { headers: { 'content-type': 'video/mp4' } }, 'https://example.org/file.mp4')), /unsupported download host/);
  await assert.rejects(fetchDriveDownload(download, {}, async () => response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } }, 'https://accounts.google.com/ServiceLogin')), /sign in/);
  try { driveConfirmation('<html>Download quota exceeded</html>', confirmed, download, DOMParser); }
  catch (error) { assert.match(readableError(readableError(error)), /permission or download limit in Drive/); }
});

test('Drive times out stalled reads while allowing a continuously progressing original to take longer', async () => {
  const streaming = async (_url, { signal }) => {
    let chunks = 0;
    return response(new ReadableStream({
      start(controller) { signal.addEventListener('abort', () => controller.error(signal.reason), { once: true }); },
      async pull(controller) {
        await new Promise(resolve => setTimeout(resolve, 15));
        if (++chunks > 6) controller.close(); else controller.enqueue(new Uint8Array([chunks]));
      },
    }), { headers: { 'content-type': 'video/quicktime' } });
  };
  const progressing = await fetchDriveDownload(download, {}, streaming, DOMParser, 60);
  assert.equal((await progressing.response.arrayBuffer()).byteLength, 6);
  const stalled = await fetchDriveDownload(download, {}, async (_url, { signal }) => response(new ReadableStream({
    start(controller) { signal.addEventListener('abort', () => controller.error(signal.reason), { once: true }); },
  }), { headers: { 'content-type': 'video/quicktime' } }), DOMParser, 30);
  await assert.rejects(stalled.response.arrayBuffer(), { name: 'TimeoutError' });
});
