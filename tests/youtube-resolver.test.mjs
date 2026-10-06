import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveYoutube, youtubePlayerRule, youtubeResolvedSources, youtubeVisitor } from '../src/youtube-resolver.js';
import { boundedText } from '../src/network.js';
import { MAX_SOURCES, readableError } from '../src/core.js';
import { youtubeItemId } from '../src/youtube.js';

const id = 'abcdefghijk';
const visitor = 'public_visitor%3D';
const format = (itag = 137, mimeType = 'video/mp4') => ({ url: `https://r.googlevideo.com/videoplayback?itag=${itag}&range=0-99&signature=keep`, mimeType, height: 1080, bitrate: 2000000 });
const player = formats => ({ playabilityStatus: { status: 'OK' }, videoDetails: { videoId: id }, streamingData: { adaptiveFormats: formats } });

test('fallback is restricted to a matching YouTube page and item', () => {
  assert.equal(youtubeItemId({ pageUrl: `https://www.youtube.com/watch?v=${id}`, key: `youtube:${id}` }), id);
  assert.equal(youtubeItemId({ pageUrl: `https://example.com/watch?v=${id}`, key: `youtube:${id}` }), null);
  assert.equal(youtubeItemId({ pageUrl: `https://www.youtube.com/watch?v=${id}`, key: 'youtube:differentid' }), null);
});

test('visitor data is decoded as JSON without running page scripts', () => {
  assert.equal(youtubeVisitor('ytcfg.set({"VISITOR_DATA":"public_visitor\\u00253D"})'), visitor);
  assert.equal(youtubeVisitor(JSON.stringify({ visitorData: visitor })), visitor);
  for (const value of ['', '"visitorData":"short"', '"visitorData":"bad value long enough"', '"visitorData":"' + 'x'.repeat(9000) + '"']) assert.throws(() => youtubeVisitor(value), /download session/);
});

test('only finite clear direct tracks for the requested video are accepted', () => {
  const response = player([format(), format(), format(140, 'audio/mp4'), ...[
    'https://evil.example/videoplayback?itag=1', 'https://googlevideo.com.evil.example/videoplayback?itag=1',
    'http://r.googlevideo.com/videoplayback?itag=1', 'https://r.googlevideo.com/videoplayback?itag=1&sabr=1',
    'https://r.googlevideo.com/videoplayback?itag=1&sq=3', 'https://r.googlevideo.com/other?itag=1',
  ].map(url => ({ ...format(), url })), { ...format(141), drmTrackType: 'DRM' }]);
  const sources = youtubeResolvedSources(response, id);
  assert.equal(sources.length, 2);
  assert.ok(sources.every(source => !source.url.includes('range=') && source.url.includes('signature=keep')));
  assert.throws(() => youtubeResolvedSources(response, 'differentid'), /different video/);
  assert.throws(() => youtubeResolvedSources({ playabilityStatus: { status: 'LOGIN_REQUIRED' } }, id), /account or playback verification/);
  assert.throws(() => youtubeResolvedSources({ ...response, videoDetails: { videoId: id, isLive: true } }, id), /Live recording/);
  assert.throws(() => youtubeResolvedSources({ ...response, streamingData: { ...response.streamingData, drmFamilies: ['WIDEVINE'] } }, id), /protected/);
  assert.throws(() => youtubeResolvedSources(player([{ signatureCipher: 'unresolved', mimeType: 'video/mp4' }]), id), /compatible download tracks/);
});

test('format limits preserve audio and highest video qualities', () => {
  const formats = Array.from({ length: 40 }, (_, n) => ({ ...format(n), height: 100 + n }));
  formats.push(format(140, 'audio/mp4'), format(251, 'audio/webm'));
  const sources = youtubeResolvedSources(player(formats), id);
  assert.equal(sources.length, MAX_SOURCES);
  assert.equal(sources[0].height, 139);
  assert.equal(sources.filter(source => source.mime.startsWith('audio/')).length, 2);
});

test('public lookup uses fresh visitor context and omits credentials in both requests', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, ...options });
    return new Response(requests.length === 1 ? JSON.stringify({ visitorData: visitor }) : JSON.stringify(player([format()])));
  });
  const sources = await resolveYoutube(id);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.credentials === 'omit' && request.redirect === 'error' && request.signal));
  assert.equal(requests[1].headers['X-Goog-Visitor-Id'], visitor);
  const body = JSON.parse(requests[1].body);
  assert.equal(body.context.client.visitorData, visitor);
  assert.equal(body.videoId, id);
  assert.equal(body.contentCheckOk, undefined);
  assert.ok(sources.length);
  assert.ok(!JSON.stringify(sources).includes(visitor));
  const rule = youtubePlayerRule('extension-id');
  assert.deepEqual(rule.condition.initiatorDomains, ['extension-id']);
  assert.deepEqual(rule.condition.requestMethods, ['post']);
  assert.equal(rule.condition.urlFilter, '|https://www.youtube.com/youtubei/v1/player?prettyPrint=false|');
});

test('lookup denial is not retried or converted to sign-in advice', async t => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => { attempts++; return new Response(null, { status: 403 }); });
  await assert.rejects(resolveYoutube(id), error => {
    assert.match(readableError(error), /YouTube download lookup failed/);
    assert.doesNotMatch(readableError(error), /signed in|rescan/);
    return true;
  });
  assert.equal(attempts, 1);
});

test('response size limits cancel reading before parsing oversized manifests or player data', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(101)); }, cancel() { cancelled = true; } }));
  await assert.rejects(boundedText(response, 100), /too large/);
  assert.equal(cancelled, true);
  assert.equal(await boundedText(new Response('héllo'), 10), 'héllo');
});
