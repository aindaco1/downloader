import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, mediaRetryDelay } from '../src/engine.js';
import { Logging } from 'mediabunny';
import { readableError } from '../src/core.js';

test('retry diagnostics stay out of error logs without hiding unexpected library errors', t => {
  const errors = []; const debug = []; const warnings = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  t.mock.method(console, 'debug', (...args) => debug.push(args));
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  Logging._error('Retrying failed fetch. Error:', new TypeError('Failed to fetch https://example.com?private=token'));
  Logging._error('Error while reading response stream. Attempting to resume.', new TypeError('Failed to fetch'));
  assert.equal(errors.length, 0);
  assert.equal(debug.length, 2);
  assert.ok(debug.every(args => !args.join(' ').includes('private=token')));
  Logging._error('Unexpected parser failure');
  Logging._warn('Unsupported track');
  assert.deepEqual(errors, [['Unexpected parser failure']]);
  assert.deepEqual(warnings, [['Unsupported track']]);
});

test('network failures do not claim the server refused access', () => {
  assert.match(readableError(new TypeError('Failed to fetch')), /could not be reached/);
  assert.match(readableError(new Error('HTTP 403')), /site refused/);
});

test('fetch complete HLS playlists but preserve byte ranges for media segments', async t => {
  const requested = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requested.push({ url: String(url), range: new Headers(options.headers).get('range'), custom: new Headers(options.headers).get('x-fixture') });
    return new Response('fixture');
  });
  const session = createSession(new AbortController().signal);
  await session.open({ url: 'https://example.com/playlist?token=abc', kind: 'hls' });
  for (const url of ['https://example.com/playlist?token=abc', 'https://example.com/variant.m3u8?token=abc', 'https://example.com/segment.mp4']) {
    await session.fetch(url, { headers: { Range: 'bytes=100-', 'X-Fixture': 'preserved' } });
  }
  assert.deepEqual(requested.map(request => request.range), [null, null, 'bytes=100-']);
  assert.ok(requested.every(request => request.custom === 'preserved'));
  session.dispose();
});

test('HTTP refusal status survives fetch without retaining its signed URL', async t => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 403 }));
  const session = createSession(new AbortController().signal);
  await assert.rejects(session.fetch('https://example.com/video.mp4?secret=private'), error => {
    assert.equal(error.status, 403);
    assert.equal(error.message, 'The media server returned HTTP 403.');
    return true;
  });
  assert.ok(cancelled);
});
test('retry only transient failures, once; never retry denial, missing media or cancellation', () => {
  for (const status of [400, 401, 403, 404, 410, 416, 451, 501]) assert.equal(mediaRetryDelay(1, { status }), null);
  for (const error of [{ status: 408 }, { status: 429 }, { status: 500 }, { status: 502 }, { status: 503 }, { status: 504 }, new TypeError('Failed to fetch')]) {
    assert.equal(mediaRetryDelay(1, error), 1);
    assert.equal(mediaRetryDelay(2, error), null);
  }
  assert.equal(mediaRetryDelay(1, new DOMException('Cancelled', 'AbortError')), null);
});
