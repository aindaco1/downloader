import test from 'node:test';
import assert from 'node:assert/strict';
import { httpUrl, sourceUrl, mediaKind, upsert, safeFilename, readableError } from '../src/core.js';
import { extractJsonMedia, youtubeMedia } from '../src/adapters.js';
import { youtubePageId, youtubeContext, withYoutubeContext } from '../src/youtube.js';
import { dashToHls } from '../src/dash.js';

test('rejects non-web, credentialed and control-character URLs', () => {
  for (const url of ['', ' ', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.com/video.mp4', 'https://example.com/\nfoo']) assert.equal(httpUrl(url), null);
  assert.equal(httpUrl('/media.mp4', 'https://example.com/page'), 'https://example.com/media.mp4');
});
test('preserves signed URLs and only removes known YouTube byte-range parameters', () => {
  const signed = 'https://cdn.example.com/movie.mp4?token=abc&range=123';
  assert.equal(sourceUrl(signed), signed);
  assert.equal(sourceUrl('https://r1.googlevideo.com/videoplayback?itag=137&sig=abc&range=0-99&rn=3'), 'https://r1.googlevideo.com/videoplayback?itag=137&sig=abc');
  assert.equal(mediaKind('https://r1.googlevideo.com/videoplayback?itag=137&sq=2', 'video/mp4'), null);
  assert.equal(mediaKind('https://cdn.example.com/segment.m4s', 'video/mp4'), null);
  assert.equal(mediaKind('https://cdn.example.com/manifest', 'application/dash+xml'), 'dash');
  assert.equal(sourceUrl('https://scontent.cdninstagram.com/a.mp4?oh=signed&bytestart=892&byteend=995'), 'https://scontent.cdninstagram.com/a.mp4?oh=signed');
  assert.equal(mediaKind('https://www.youtube.com/s/search/audio/success.mp3'), null);
  assert.equal(mediaKind('https://lf16.tiktokcdn-us.com/obj/tiktok/webapp/main/playback1.mp4'), null);
});
test('groups known variants, not unrelated items with matching titles', () => {
  const items = [];
  upsert(items, { key: 'post:1', title: 'One', sources: [{ url: 'https://cdn.example/a.mp4' }] }, {});
  upsert(items, { key: 'post:1', title: 'One', sources: [{ url: 'https://cdn.example/b.mp4' }] }, {});
  upsert(items, { title: 'One', sources: [{ url: 'https://cdn.example/c.mp4' }] }, {});
  assert.equal(items.length, 2); assert.equal(items[0].sources.length, 2);
});
test('filenames remain valid on Windows and cannot contain paths', () => {
  assert.equal(safeFilename('../a/b:clip.mp4', 'm4a'), '..-a-b-clip.m4a');
  assert.equal(safeFilename('CON', 'mp4'), 'Media-CON.mp4');
  assert.equal(safeFilename('Música', 'm4a'), 'Música.m4a');
});
test('site metadata combines separately detected tracks without duplicate cards', () => {
  const items = [];
  upsert(items, { sources: [{ url: 'https://cdn.example/video.mp4' }] }, {});
  upsert(items, { sources: [{ url: 'https://cdn.example/audio.m4a' }] }, {});
  upsert(items, { key: 'clip:1', title: 'Clip', rank: 3, sources: [{ url: 'https://cdn.example/video.mp4' }, { url: 'https://cdn.example/audio.m4a' }] }, {});
  assert.equal(items.length, 1); assert.equal(items[0].sources.length, 2);
  assert.equal(items[0].title, 'Clip');
});
test('site adapters retain variants and decline ciphered YouTube sources', () => {
  const media = extractJsonMedia({ items: [
    { id: 'ig1', caption: { text: 'A reel' }, video_versions: [{ url: 'https://cdn.example/low.mp4', height: 360 }, { url: 'https://cdn.example/high.mp4', height: 720 }] },
    { videoDetails: { videoId: 'yt1', title: 'A video' }, streamingData: { formats: [{ url: 'https://cdn.example/yt.mp4' }, { signatureCipher: 'cipher' }] } },
    { id: 'tk1', desc: 'A TikTok', video: { playAddr: 'https://cdn.example/tk.mp4', duration: 5, height: 720 } },
  ] });
  assert.equal(media.find(item => item.key === 'instagram:ig1').sources.length, 2);
  assert.equal(media.find(item => item.key === 'youtube:yt1').sources.length, 1);
  assert.equal(media.find(item => item.key === 'tiktok:tk1').sources[0].height, 720);
});
test('does not offer DRM or live DASH as an ordinary download', () => {
  assert.throws(() => dashToHls('<MPD><ContentProtection schemeIdUri="widevine"/></MPD>', 'https://example.com/v.mpd'), /DRM/);
  assert.throws(() => dashToHls('<MPD type="dynamic"/>', 'https://example.com/v.mpd'), /Live/);
});
test('Instagram groups complete video and audio representations with the individual clip', () => {
  const items = extractJsonMedia({ id: 'clip', video_versions: [{ url: 'https://cdn.example/video.mp4' }], video_dash_manifest: '<MPD><Representation><BaseURL>https://cdn.example/audio.mp4?token=a&amp;quality=1</BaseURL><SegmentBase/></Representation></MPD>' });
  assert.equal(items.length, 1);
  assert.equal(items[0].key, 'instagram:clip');
  assert.equal(items[0].sources[1].url, 'https://cdn.example/audio.mp4?token=a&quality=1');
});
test('errors do not expose signed media URLs', () => {
  assert.equal(readableError('Cannot parse https://cdn.example/file?secret=abc'), 'Cannot parse [media URL]');
});
test('YouTube watch, Shorts and embedded variants share a video identity and thumbnail', () => {
  for (const url of ['https://www.youtube.com/watch?v=3HcahTc7kIk', 'https://www.youtube.com/shorts/3HcahTc7kIk', 'https://www.youtube-nocookie.com/embed/3HcahTc7kIk', 'https://youtu.be/3HcahTc7kIk']) assert.equal(youtubePageId(url), '3HcahTc7kIk');
  assert.equal(youtubePageId('https://notyoutube.com/watch?v=3HcahTc7kIk'), null);
  const context = { pageUrl: 'https://www.youtube.com/watch?v=3HcahTc7kIk', youtube: youtubeContext('https://www.youtube.com/watch?v=3HcahTc7kIk', { title: 'A film - YouTube' }) };
  const items = [];
  for (const url of ['https://manifest.googlevideo.com/api/manifest/hls_playlist/avc.m3u8', 'https://www.youtube.com/api/manifest/hls_playlist/vp9.m3u8']) upsert(items, withYoutubeContext({ sources: [{ url }], title: 'YouTube' }, context), context);
  assert.equal(items.length, 1); assert.equal(items[0].sources.length, 2);
  assert.equal(items[0].title, 'A film');
  assert.equal(items[0].thumbnail, 'https://i.ytimg.com/vi/3HcahTc7kIk/hqdefault.jpg');
  upsert(items, withYoutubeContext({ key: 'youtube:J4T7G4MfCqE', sources: [{ url: 'https://manifest.googlevideo.com/different.m3u8' }] }, context), context);
  assert.equal(items.length, 2, 'different videos remain separate');
});
test('late YouTube metadata enriches observed streams without creating an empty card', () => {
  const items = [];
  const metadata = youtubeMedia({ videoDetails: { videoId: '3HcahTc7kIk', title: 'Actual title' } })[0];
  upsert(items, metadata, {}); assert.equal(items.length, 0);
  upsert(items, { key: metadata.key, title: 'YouTube', sources: [{ url: 'https://manifest.googlevideo.com/movie.m3u8' }] }, {});
  upsert(items, metadata, {});
  assert.equal(items.length, 1); assert.equal(items[0].title, 'Actual title'); assert.ok(items[0].thumbnail);
});
