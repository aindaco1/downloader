import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, inspectMedia, mediaRetryDelay } from '../src/engine.js';
import { EncodedPacketSink, Logging } from 'mediabunny';
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

test('only explicit user cancellation is labeled Cancelled; interrupted requests and timeouts keep their causes', () => {
  assert.equal(readableError(Object.assign(new Error('cancel'), { code: 'USER_CANCELLED' })), 'Cancelled.');
  assert.equal(readableError(new Error('Cancelled.')), 'Cancelled.', 'serialized cancellation remains stable');
  assert.match(readableError(new DOMException('The operation was aborted.', 'AbortError')), /request was interrupted/);
  assert.match(readableError(new DOMException('signal timed out', 'TimeoutError')), /request timed out/);
  assert.match(readableError(new Error('Inspection timed out. Play the media and try again.')), /request timed out/);
  const redacted = readableError(new Error('Could not parse https://cdn.example/aborted.mp4?token=403'));
  assert.equal(redacted, 'Could not parse [media URL]');
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

test('YouTube bounded requests preserve the signed URL and read every packet across response boundaries', async t => {
  const size = 12 * 1024 * 1024;
  const wave = Buffer.alloc(44 + size, 42);
  wave.write('RIFF', 0); wave.writeUInt32LE(36 + size, 4); wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(48000, 24); wave.writeUInt32LE(96000, 28);
  wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(size, 40);
  const url = 'https://r.googlevideo.com/videoplayback?itag=140&signature=keep';
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (resource, options) => {
    assert.equal(resource, url);
    const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(options.headers).get('range'));
    assert.ok(range, 'open-ended reads are bounded');
    const start = Number(range[1]); const end = Math.min(Number(range[2]), wave.length - 1);
    assert.ok(end - start < 10 * 1024 * 1024);
    requests.push({ start, end });
    return new Response(wave.subarray(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${wave.length}`, 'Content-Length': String(end - start + 1) } });
  });
  const session = createSession(new AbortController().signal);
  try {
    const input = await session.open({ url, kind: 'file' });
    const track = await input.getPrimaryAudioTrack();
    const packets = [];
    for await (const packet of new EncodedPacketSink(track).packets()) packets.push(packet.data);
    assert.deepEqual(Buffer.concat(packets), wave.subarray(44), 'all original audio bytes survive chunk boundaries');
    assert.ok(requests.length > 1 && requests.some(request => request.start >= 10 * 1024 * 1024));
  } finally { session.dispose(); }
});
test('retry only transient failures, once; never retry denial, missing media or cancellation', () => {
  for (const status of [400, 401, 403, 404, 410, 416, 451, 501]) assert.equal(mediaRetryDelay(1, { status }), null);
  for (const error of [{ status: 408 }, { status: 429 }, { status: 500 }, { status: 502 }, { status: 503 }, { status: 504 }, new TypeError('Failed to fetch')]) {
    assert.equal(mediaRetryDelay(1, error), 1);
    assert.equal(mediaRetryDelay(2, error), null);
  }
  assert.equal(mediaRetryDelay(1, new DOMException('Cancelled', 'AbortError')), null);
});

test('YouTube denial survives inspection without misleading sign-in advice or private URLs', async t => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => { attempts++; return new Response(null, { status: 403 }); });
  const signal = new AbortController().signal;
  const url = 'https://r.googlevideo.com/videoplayback?itag=18&secret=private';
  await assert.rejects(inspectMedia({ sources: [{ url, kind: 'file' }] }, signal), error => {
    assert.match(error.message, /YouTube refused this stream/);
    assert.doesNotMatch(error.message, /sign.?in|rescan|private|https:/i);
    return true;
  });
  assert.equal(attempts, 1);
  const session = createSession(signal);
  await assert.rejects(session.fetch('https://notyoutube.com/video.mp4'), error => {
    assert.match(readableError(error), /The site refused this request/);
    return true;
  });
  session.dispose();
});
