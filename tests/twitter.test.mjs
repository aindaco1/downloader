import test from 'node:test';
import assert from 'node:assert/strict';
import { upsert, sourceUrl, mediaKind, cleanSource } from '../src/core.js';

const base = 'https://video.twimg.com/amplify_video/2118079583056740352';
const urls = ['pl/master.m3u8?v=e4d', 'pl/avc1/270.m3u8', 'pl/avc1/360.m3u8', 'pl/avc1/720.m3u8', 'pl/avc1/1080.m3u8', 'pl/avc1/2160.m3u8', 'pl/mp4a/audio.m3u8', 'pl/avc1/alternate.m3u8'].map(p => `${base}/${p}`);
const context = { pageUrl: 'https://x.com/AppleTV/status/2118086064502170057', title: 'The same page title' };
const add = (items, url, extra = {}) => upsert(items, { key: url, sources: [{ url }], ...extra }, context);

test('X HLS audio/video initialization MP4s are not standalone downloads, even with an explicit kind', () => {
  const items = [];
  for (const suffix of ['aud/mp4a/0/0/32000/audio.mp4', 'aud/mp4a/0/0/128000/audio.mp4', 'vid/avc1/0/0/640x360/video.mp4', 'vid/avc1/0/0/1920x1080/video.mp4']) {
    const url = `${base}/${suffix}?tag=12`;
    assert.equal(mediaKind(url, 'video/mp4'), null);
    assert.equal(cleanSource({ url, kind: 'file' }), null);
    add(items, url);
  }
  assert.equal(items.length, 0);
  add(items, urls[0]);
  add(items, `${base}/vid/avc1/640x360/movie.mp4`);
  assert.equal(items.length, 1); assert.equal(items[0].sources.length, 2);
  assert.equal(mediaKind('https://example.com/vid/avc1/0/0/640x360/movie.mp4'), 'file');
});

test('eight X playlists become one card while every original source is retained', () => {
  const items = [];
  for (const url of urls) add(items, url);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].sources.map(s => s.url), urls);
  const id = items[0].id;
  for (const url of urls.toReversed()) add(items, url);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, id);
  assert.equal(items[0].sources.length, 8);
});

test('X MP4, HLS, audio and alternate signed URLs share the media identity', () => {
  const items = [];
  const sources = [...urls, `${base}/vid/avc1/1920x1080/movie.mp4?tag=12&token=keep%2Fthis`, `${urls[0]}&signature=new`];
  for (const url of sources) add(items, url);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].sources.map(s => s.url), sources);
  for (const url of sources) assert.equal(sourceUrl(url), url);
});

test('different X videos, path namespaces and unrelated hosts stay separate even with identical titles', () => {
  const items = [];
  for (const url of [urls[0], urls[1], urls[0].replace('2118079583056740352', '2118079583056740353'), urls[0].replace('amplify_video', 'ext_tw_video'), urls[0].replace('video.twimg.com', 'notvideo.twimg.com'), urls[0].replace('video.twimg.com', 'video.twimg.com.example.org')]) add(items, url);
  assert.equal(items.length, 5);
});

test('legacy external-video paths and animated clips use their own media identities on embedded pages', () => {
  const items = [];
  for (const url of ['https://video.twimg.com/ext_tw_video/123/pu/pl/master.m3u8', 'https://video.twimg.com/ext_tw_video/123/pu/vid/640x360/movie.mp4', 'https://video.twimg.com/tweet_video/Ab_c-123.mp4?tag=1', 'https://video.twimg.com/tweet_video/Ab_c-123.mp4?tag=2']) upsert(items, { sources: [{ url }] }, { pageUrl: 'https://example.com/embed' });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(item => item.sources.length), [2, 2]);
});

test('new discovery collapses cached X duplicates and preserves the first card ID and late metadata', () => {
  const items = urls.map((url, i) => ({ id: `old-${i}`, key: url, title: context.title, rank: 0, pageUrl: context.pageUrl, sources: [{ url, kind: 'hls' }] }));
  add(items, urls[0], { title: 'Video title', rank: 2, thumbnail: 'https://pbs.twimg.com/media/poster.jpg', duration: 92.125 });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'old-0');
  assert.equal(items[0].title, 'Video title');
  assert.equal(items[0].duration, 92.125);
  assert.equal(items[0].sources.length, 8);
});

test('unknown CDN paths are not grouped and mixed-source cards do not infer a single X video', () => {
  const items = [];
  for (const url of ['https://video.twimg.com/other/a.m3u8', 'https://video.twimg.com/other/b.m3u8']) add(items, url);
  assert.equal(items.length, 2);
  upsert(items, { key: 'explicit:pair', sources: [{ url: urls[0] }, { url: urls[0].replace('2118079583056740352', '123') }] }, context);
  assert.equal(items[2].key, 'explicit:pair');
});
