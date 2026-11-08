import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonMedia } from '../src/adapters.js';
import { upsert } from '../src/core.js';
import { youtubeEmbedMedia, youtubeItemId } from '../src/youtube.js';

const pageUrl = 'https://example.substack.com/p/current-article';
const post = (id, slug) => ({ id, slug, publication_id: 99, title: `Article ${id}`, cover_image: `https://substackcdn.com/image/${id}.jpg`, audio_items: [
  { post_id: id, type: 'tts', audio_url: `https://substack-video.s3.amazonaws.com/video_upload/post/${id}/tts/voice.mp3?signature=keep` },
] });
const current = post(1, 'current-article');

test('Substack recommendation payload yields only the current article with its own preview and read-aloud label', () => {
  const archive = [current, ...Array.from({ length: 5 }, (_, i) => post(i + 2, `recommended-${i}`))];
  const items = extractJsonMedia(archive, { pageUrl, title: '(1) Current tab' });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Article 1 (read aloud)');
  assert.equal(items[0].thumbnail, current.cover_image);
  assert.equal(items[0].sources[0].url, current.audio_items[0].audio_url);
  assert.deepEqual(extractJsonMedia(archive.slice(1), { pageUrl, post: current }), []);
});

test('Substack preload and repeated API detection deduplicate while keeping podcast/video and read-aloud tracks separate', () => {
  const withVideo = { ...current, videoUpload: { video_url: 'https://cdn.example/video.mp4', hls_url: 'https://cdn.example/master.m3u8' } };
  const items = [];
  for (const payload of [withVideo, [withVideo], { audio_items: current.audio_items }]) {
    for (const raw of extractJsonMedia(payload, { pageUrl, post: current })) upsert(items, raw, { pageUrl });
  }
  assert.equal(items.length, 3);
  assert.ok(items.every(item => item.thumbnail === current.cover_image));
  assert.equal(items.filter(item => item.title.endsWith('(read aloud)')).length, 1);
  assert.ok(items.filter(item => !item.title.endsWith('(read aloud)')).every(item => item.title === current.title));
});

test('Substack ignores foreign bare audio and stale preload context after navigation', () => {
  const foreign = post(2, 'another-article');
  assert.deepEqual(extractJsonMedia(foreign.audio_items, { pageUrl, post: current }), []);
  assert.deepEqual(extractJsonMedia(current.audio_items, { pageUrl }), [], 'unattributed audio is not assigned the page title');
  assert.deepEqual(extractJsonMedia(current, { pageUrl: 'https://example.substack.com/p/another-article', post: current }), []);
  const [item] = extractJsonMedia(foreign, { pageUrl: 'https://example.substack.com/p/another-article?utm_source=test', post: current });
  assert.equal(item.title, 'Article 2 (read aloud)');
  assert.equal(item.thumbnail, foreign.cover_image);
});

test('Substack scoping does not alter generic JSON discovery or trust lookalike hosts', () => {
  for (const url of ['https://example.com/p/current-article', 'https://notsubstack.com/p/current-article']) {
    assert.equal(extractJsonMedia([current, post(2, 'another')], { pageUrl: url }).length, 2);
  }
  const [item] = extractJsonMedia({ contentUrl: 'https://cdn.example/clip.mp4', name: 'Clip', thumbnailUrl: 'https://cdn.example/poster.jpg' }, { pageUrl });
  assert.equal(item.title, 'Clip');
  assert.equal(item.thumbnail, 'https://cdn.example/poster.jpg');
});

test('YouTube preview-only embeds identify a playable matching video and accept late resolved sources', () => {
  const id = 'hTCMkNLMFrU';
  const pageUrl = `https://www.youtube-nocookie.com/embed/${id}`;
  const response = { previewPlayabilityStatus: { status: 'OK' }, embedPreview: { thumbnailPreviewRenderer: {
    title: { runs: [{ text: 'Podcast' }] }, videoDurationSeconds: '3653',
    playButton: { buttonRenderer: { navigationEndpoint: { watchEndpoint: { videoId: id } } } },
  } } };
  const config = () => ({ video_id: id, embedded_player_response: JSON.stringify(response) });
  const [raw] = youtubeEmbedMedia(config(), pageUrl);
  const items = []; upsert(items, raw, { pageUrl });
  assert.equal(youtubeItemId(items[0]), id);
  assert.equal(items[0].duration, 3653); assert.equal(items[0].title, 'Podcast');
  assert.equal(items[0].thumbnail, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  assert.equal(items[0].unavailable, 'youtube-preview');
  upsert(items, { key: raw.key, sources: [{ url: 'https://r.googlevideo.com/video.mp4?itag=18' }] }, { pageUrl });
  upsert(items, raw, { pageUrl });
  assert.equal(items.length, 1); assert.equal(items[0].unavailable, undefined);
  assert.deepEqual(youtubeEmbedMedia(config(), 'https://notyoutube.com/embed/hTCMkNLMFrU'), []);
  assert.deepEqual(youtubeEmbedMedia(config(), 'https://www.youtube.com/embed/3HcahTc7kIk'), []);
  assert.deepEqual(youtubeEmbedMedia({ video_id: id, embedded_player_response: '{bad' }, pageUrl), []);
  assert.deepEqual(youtubeEmbedMedia({ video_id: id, embedded_player_response: ' '.repeat(3000001) }, pageUrl), []);
  response.previewPlayabilityStatus.status = 'ERROR';
  assert.deepEqual(youtubeEmbedMedia(config(), pageUrl), []);
  response.previewPlayabilityStatus.status = 'OK';
  response.embedPreview.thumbnailPreviewRenderer.playButton.buttonRenderer.navigationEndpoint.watchEndpoint.videoId = '3HcahTc7kIk';
  assert.deepEqual(youtubeEmbedMedia(config(), pageUrl), []);
});
