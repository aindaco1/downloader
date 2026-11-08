import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { prepareYoutubeUrls } from '../src/youtube-page-urls.js';
import { resolveYoutube, youtubePreparedSources, youtubePlayerRule } from '../src/youtube-resolver.js';

const id = 'abcdefghijk';
const url = 'https://r.googlevideo.com/videoplayback?itag=137&n=original&sig=keep';
const prepared = url.replace('n=original', 'n=prepared');
class Wrapper {
  constructor(value) { this.url = new URL(value); }
  get(key) { return this.url.searchParams.get(key); }
  set(key, value) { this.url.searchParams.set(key, value); }
  clone() { return new Wrapper(this.url.href); }
  renamedSerializer() { this.set('n', 'prepared'); return this.url.href; }
}
const environment = overrides => ({ URL, location: { href: `https://www.youtube.com/watch?v=${id}` }, ytcfg: { get: () => 20760 }, _yt_player: { renamedExport: Wrapper }, ...overrides });
const invoke = (env = {}, urls = [url]) => runInNewContext(`(${prepareYoutubeUrls.toString()})(...args)`, { ...environment(env), args: [id, urls, 20760] });

test('loaded player URL wrapper survives renamed exports and methods; no remote code required', () => {
  assert.deepEqual(Array.from(invoke()), [prepared]);
  const plain = url.replace('&n=original', '');
  assert.deepEqual(Array.from(invoke({}, [plain])), [plain]);
  for (const env of [
    { _yt_player: {} }, { _yt_player: { one: Wrapper, two: Wrapper } },
    { location: { href: 'https://example.com/watch?v=' + id } },
    { location: { href: 'https://www.youtube.com/watch?v=differentid' } },
    { ytcfg: { get: () => 20761 } },
  ]) assert.equal(invoke(env), null);
  assert.equal(invoke({}, Array(25).fill(url)), null);
  assert.equal(invoke({}, ['https://evil.example/videoplayback?itag=137&n=original']), null);
});

test('page output can change only n, preserving every signed URL field and source metadata', () => {
  const source = { url, height: 816, width: 1920 };
  assert.deepEqual(youtubePreparedSources([source], [prepared]), [{ ...source, url: prepared }]);
  for (const invalid of [null, [], [url], [prepared.replace('r.googlevideo.com', 'evil.example')], [prepared + '&extra=1'], [prepared.replace('sig=keep', 'sig=changed')], [prepared.replace('n=prepared', 'n=bad%20value')], [prepared + '#fragment']]) {
    assert.throws(() => youtubePreparedSources([source], invalid));
  }
});

const format = (itag, height, mimeType) => ({ url: `https://r.googlevideo.com/videoplayback?itag=${itag}&n=original&sig=keep`, mimeType, height, width: height * 2, fps: 24 });
const ok = formats => ({ playabilityStatus: { status: 'OK' }, videoDetails: { videoId: id }, streamingData: { adaptiveFormats: formats } });
const low = ok([{ ...format(18, 272, 'video/mp4; codecs="avc1.42001E, mp4a.40.2"'), url: url.replace('137', '18').replace('&n=original', '') }]);
const high = ok([format(137, 816, 'video/mp4; codecs="avc1.640028"'), format(313, 1634, 'video/webm; codecs="vp9"'), format(140, 0, 'audio/mp4; codecs="mp4a.40.2"')]);

test('made-for-kids fallback adds prepared 4K/1080p tracks and AAC while retaining the working combined stream', async t => {
  const requests = []; const clients = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(options);
    const body = options.body && JSON.parse(options.body);
    if (!body) return new Response(JSON.stringify({ visitorData: 'fixture_visitor_data', STS: 20760 }));
    const name = body.context.client.clientName;
    return new Response(JSON.stringify(name === 'VISIONOS' ? { playabilityStatus: { status: 'UNPLAYABLE' }, videoDetails: { videoId: id } } : name === 'ANDROID' ? low : high));
  });
  const sources = await resolveYoutube(id, undefined, async name => clients.push(name), async (urls, stamp) => {
    assert.equal(stamp, 20760); return urls.map(value => value.replace('n=original', 'n=prepared'));
  });
  assert.deepEqual(clients, ['visionos', 'android', 'television']);
  assert.deepEqual(sources.filter(source => source.mime.startsWith('video/')).map(source => source.height), [1634, 816, 272]);
  assert.equal(sources.filter(source => source.mime.startsWith('audio/')).length, 1);
  assert.ok(sources.slice(0, -1).every(source => source.url.includes('n=prepared')));
  assert.equal(sources.at(-1).url, low.streamingData.adaptiveFormats[0].url);
  const body = JSON.parse(requests.at(-1).body);
  assert.equal(body.playbackContext.contentPlaybackContext.signatureTimestamp, 20760);
  assert.ok(requests.every(request => request.credentials === 'omit'));
  assert.equal(youtubePlayerRule('extension', 'television').action.requestHeaders[1].value, body.context.client.userAgent);
});

test('optional high-resolution refusal or changed player preserves the successful low-resolution fallback', async t => {
  let television = high; let prepare = urls => urls.map(value => value.replace('n=original', 'n=prepared'));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = options.body && JSON.parse(options.body);
    if (!body) return new Response(JSON.stringify({ visitorData: 'fixture_visitor_data', STS: 20760 }));
    const name = body.context.client.clientName;
    if (name === 'TVHTML5' && television === 403) return new Response(null, { status: 403 });
    return new Response(JSON.stringify(name === 'VISIONOS' ? { playabilityStatus: { status: 'UNPLAYABLE' }, videoDetails: { videoId: id } } : name === 'ANDROID' ? low : television));
  });
  for (const candidate of [403, { ...high, playabilityStatus: { status: 'LOGIN_REQUIRED' } }, { ...high, videoDetails: { videoId: 'differentid' } }, { ...high, streamingData: { ...high.streamingData, drmFamilies: ['WIDEVINE'] } }]) {
    television = candidate;
    assert.equal((await resolveYoutube(id, undefined, undefined, prepare)).length, 1);
  }
  television = high;
  for (const callback of [() => null, () => { throw Error('Page closed'); }, urls => urls, urls => urls.map(value => value.replace('r.googlevideo.com', 'evil.example'))]) {
    prepare = callback;
    assert.equal((await resolveYoutube(id, undefined, undefined, prepare)).length, 1);
  }
});
