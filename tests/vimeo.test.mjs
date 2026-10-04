import test from 'node:test';
import assert from 'node:assert/strict';
import { upsert } from '../src/core.js';
import { extractJsonMedia } from '../src/adapters.js';
import { vimeoPageId } from '../src/vimeo.js';
import { siteContext, withSiteContext } from '../src/site-context.js';

test('Vimeo watch, unlisted, channel and embedded URLs identify the same video', () => {
  for (const url of ['https://vimeo.com/1232424785/fixturehash?share=copy', 'https://player.vimeo.com/video/1232424785?h=fixturehash', 'https://vimeo.com/channels/example/1232424785', 'https://vimeo.com/groups/example/videos/1232424785', 'https://vimeo.com/showcase/123/video/1232424785']) assert.equal(vimeoPageId(url), '1232424785');
  for (const url of ['https://notvimeo.com/1232424785', 'https://vimeo.com/showcase/123', 'https://example.com/1232424785']) assert.equal(vimeoPageId(url), null);
});
test('Vimeo groups 21 sources with late metadata but keeps different IDs and other hosts separate', () => {
  const pageUrl = 'https://vimeo.com/1232424785/fixturehash';
  const context = { pageUrl, video: siteContext(pageUrl, { title: 'Vimeo' }) };
  const items = [];
  for (let i = 0; i < 21; i++) upsert(items, withSiteContext({ sources: [{ url: `https://vod-adaptive-ak.vimeocdn.com/variant-${i}.m3u8?signature=keep-${i}` }] }, context), context);
  assert.equal(items.length, 1); assert.equal(items[0].sources.length, 21);
  context.video = siteContext(pageUrl, { title: 'Session | Videos & Movies on Vimeo', thumbnail: 'https://i.vimeocdn.com/video/poster.jpg' });
  upsert(items, withSiteContext(items[0], context), context);
  assert.equal(items[0].title, 'Session'); assert.ok(items[0].thumbnail); assert.match(items[0].sources[0].url, /signature=keep-0$/);
  upsert(items, withSiteContext({ key: 'vimeo:998877', title: 'Another film', rank: 3, sources: [{ url: 'https://vod.vimeocdn.com/other.mp4' }] }, context), context);
  upsert(items, withSiteContext({ sources: [{ url: 'https://example.com/unrelated.mp4' }] }, context), context);
  assert.equal(items.length, 3); assert.equal(items[1].title, 'Another film'); assert.ok(!items[1].thumbnail);
});
test('Vimeo reads current and legacy posters, retains HLS variants, and excludes its non-DASH JSON transport', () => {
  const config = { video: { id: 1232424785, title: 'Session', thumbnail_url: 'https://i.vimeocdn.com/video/poster.jpg' }, request: { files: {
    hls: { default_cdn: 'primary', cdns: { primary: { url: 'https://vod.vimeocdn.com/all.m3u8?sig=a', avc_url: 'https://vod.vimeocdn.com/avc.m3u8?sig=b' } } },
    dash: { default_cdn: 'primary', cdns: { primary: { url: 'https://vod.vimeocdn.com/playlist.json?sig=c' } } },
  } } };
  const [item] = extractJsonMedia(config); assert.equal(item.thumbnail, config.video.thumbnail_url); assert.equal(item.sources.length, 2);
  delete config.video.thumbnail_url; config.video.thumbs = { base: 'https://i.vimeocdn.com/video/old.jpg' };
  config.request.files.dash.cdns.primary.url = 'https://vod.vimeocdn.com/manifest.mpd';
  const [legacy] = extractJsonMedia(config); assert.equal(legacy.thumbnail, config.video.thumbs.base); assert.equal(legacy.sources.length, 3);
});
