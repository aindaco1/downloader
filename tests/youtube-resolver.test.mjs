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
  assert.equal(sources.filter(source => source.mime.startsWith('audio/')).length, 1);
});

test('long multilingual videos inspect one compatible stream per quality and retain default audio', () => {
  const formats = [];
  for (const height of [144, 240, 360, 480, 720, 1080]) {
    for (const [itag, codec] of [[1, 'avc1.640028'], [2, 'vp9'], [3, 'av01.0.08M.08']]) {
      formats.push({ ...format(height + itag, `video/mp4; codecs="${codec}"`), width: height * 16 / 9, height, fps: 24 });
    }
  }
  for (const language of ['es', 'fr', 'de', 'pt', 'id', 'it', 'en']) {
    for (const [itag, codec, bitrate] of [[139, 'mp4a.40.5', 50000], [140, 'mp4a.40.2', 130000], [249, 'opus', 50000], [251, 'opus', 150000]]) {
      formats.push({ ...format(itag, `audio/${codec === 'opus' ? 'webm' : 'mp4'}; codecs="${codec}"`), url: `https://r.googlevideo.com/videoplayback?itag=${itag}&lang=${language}`, bitrate: bitrate + (language === 'en' ? 0 : 5000), audioTrack: { id: language, audioIsDefault: language === 'en' } });
    }
  }
  const sources = youtubeResolvedSources(player(formats), id);
  assert.equal(sources.length, 7, 'six qualities and default AAC audio, rather than filling the source cap');
  assert.deepEqual(sources.filter(source => source.mime.startsWith('video/')).map(source => source.height), [1080, 720, 480, 360, 240, 144]);
  assert.ok(sources.filter(source => source.mime.startsWith('video/')).every(source => source.mime.includes('avc1')));
  const audio = sources.filter(source => source.mime.startsWith('audio/'));
  assert.ok(audio.every(source => new URL(source.url).searchParams.get('lang') === 'en'));
  assert.deepEqual(audio.map(source => new URL(source.url).searchParams.get('itag')), ['140']);
  const onlyNewCodec = youtubeResolvedSources(player([{ ...format(), mimeType: 'video/mp4; codecs="av01.0.12M.08"', height: 2160 }]), id);
  assert.equal(onlyNewCodec[0].height, 2160, 'a resolution without H.264 remains available');
  const onlyOpus = youtubeResolvedSources(player([format(249, 'audio/webm; codecs="opus"')]), id);
  assert.equal(onlyOpus.length, 1, 'audio without AAC remains available');
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

test('an unavailable matching VISIONOS video gets one anonymous Android lookup with a matching request identity', async t => {
  const requests = []; const prepared = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, ...options });
    if (requests.length === 1) return new Response(JSON.stringify({ visitorData: visitor }));
    if (requests.length === 2) return new Response(JSON.stringify({ playabilityStatus: { status: 'UNPLAYABLE', reason: 'This video is not available' }, videoDetails: { videoId: id } }));
    return new Response(JSON.stringify({ ...player([]), streamingData: { formats: [{ ...format(18, 'video/mp4; codecs="avc1.42001E, mp4a.40.2"'), height: 360, width: 640 }] } }));
  });
  const sources = await resolveYoutube(id, undefined, async name => prepared.push(name));
  assert.deepEqual(prepared, ['visionos', 'android']); assert.equal(requests.length, 3);
  assert.ok(requests.every(request => request.credentials === 'omit' && request.redirect === 'error'));
  const android = JSON.parse(requests[2].body);
  assert.equal(android.videoId, id); assert.equal(android.context.client.clientName, 'ANDROID');
  assert.equal(requests[2].headers['X-YouTube-Client-Name'], '3');
  assert.equal(requests[2].headers['X-YouTube-Client-Version'], android.context.client.clientVersion);
  assert.equal(android.context.client.visitorData, visitor); assert.equal(android.contentCheckOk, undefined);
  assert.equal(youtubePlayerRule('extension-id', 'android').action.requestHeaders.find(header => header.header === 'User-Agent').value, android.context.client.userAgent);
  assert.equal(sources.length, 1); assert.equal(sources[0].height, 360); assert.match(sources[0].mime, /mp4a/);
});

test('the alternate client does not retry account, mismatched, live, protected or repeated unavailable responses', async t => {
  const cases = [
    { playabilityStatus: { status: 'LOGIN_REQUIRED' }, videoDetails: { videoId: id } },
    { playabilityStatus: { status: 'UNPLAYABLE' }, videoDetails: { videoId: 'differentid' } },
    { playabilityStatus: { status: 'UNPLAYABLE' }, videoDetails: { videoId: id, isLive: true } },
    { playabilityStatus: { status: 'UNPLAYABLE' }, videoDetails: { videoId: id }, streamingData: { drmFamilies: ['WIDEVINE'] } },
  ];
  let reply; let calls;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify(calls === 1 ? { visitorData: visitor } : reply)); });
  for (const candidate of cases) {
    calls = 0; reply = candidate; await assert.rejects(resolveYoutube(id)); assert.equal(calls, 2);
  }
  calls = 0; reply = { playabilityStatus: { status: 'UNPLAYABLE' }, videoDetails: { videoId: id } };
  await assert.rejects(resolveYoutube(id), /did not make this video available/); assert.equal(calls, 3);
});

test('response size limits cancel reading before parsing oversized manifests or player data', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(101)); }, cancel() { cancelled = true; } }));
  await assert.rejects(boundedText(response, 100), /too large/);
  assert.equal(cancelled, true);
  assert.equal(await boundedText(new Response('héllo'), 10), 'héllo');
});
